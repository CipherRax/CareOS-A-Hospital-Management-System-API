import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { OutboxPublisherService } from '../../src/database/outbox-publisher.service';
import { EventTypes } from '../../src/events/catalog';
import { newId } from '../../src/common/lib/uuidv7';

/**
 * Phase 2 — object storage. Exercises the real upload path end to end against
 * an in-memory SigV4-capable S3 server (s3rver): initiate returns a presigned
 * PUT URL, a raw client PUT uploads the bytes, complete finalises the row, and
 * download returns a working presigned GET URL. Permission boundaries and the
 * outbox event are verified too.
 */
describe('documents & object storage (Phase 2)', () => {
  // These tests drive a real S3 server and, in the Phase 8 block, spawn the
  // scanner. That is genuinely slower than an in-process handler call, so the
  // 5s default is not a real bound for them — under a full parallel run they
  // were timing out on work they legitimately do, not on a hang.
  jest.setTimeout(120_000);

  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let publisher: OutboxPublisherService;
  let env: Env;
  let orgA: string;
  let orgB: string;
  let uploaderId: string;

  const url = (path: string): string => `${env.API_PREFIX}${path}`;

  const headerFor = (
    organizationId: string,
    permissions: string[],
    userId?: string,
  ) => ({ ...principalHeaders({ organizationId, userId: userId ?? uploaderId, permissions }) });

  const DOWNLOAD_BYTES = Buffer.from('careOS phase 2 document payload', 'utf8');

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
    publisher = app.get(OutboxPublisherService);
    env = app.get(ENV);
    const sc = prisma.unscoped();

    orgA = newId();
    orgB = newId();
    uploaderId = newId();
    await sc.organization.createMany({
      data: [
        { id: orgA, name: 'Documents Org A' },
        { id: orgB, name: 'Documents Org B' },
      ],
    });
    await sc.user.create({
      data: {
        id: uploaderId,
        organizationId: orgA,
        email: 'uploader@documents.test',
        firstName: 'Doc',
        lastName: 'Uploader',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('initiate requires documents.create', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: url('/documents'),
      headers: headerFor(orgA, ['documents.read']),
      payload: { fileName: 'x.txt', contentType: 'text/plain' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');
  });

  it('full lifecycle: initiate → presigned PUT → complete → download roundtrip', async () => {
    const initiate = await app.inject({
      method: 'POST',
      url: url('/documents'),
      headers: headerFor(orgA, ['documents.create', 'documents.read', 'documents.manage']),
      payload: {
        fileName: 'lab-results.txt',
        contentType: 'text/plain',
        sizeBytes: DOWNLOAD_BYTES.length,
      },
    });
    expect(initiate.statusCode).toBe(201);
    const initiated = initiate.json();
    expect(initiated.success).toBe(true);
    const documentId = initiated.data.document.id;
    const uploadUrl = initiated.data.upload.url;
    expect(initiated.data.upload.method).toBe('PUT');
    expect(initiated.data.document.status).toBe('PENDING_UPLOAD');
    expect(uploadUrl).toContain('127.0.0.1');

    // The raw client PUTs directly to S3 — no Nest hop.
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      body: DOWNLOAD_BYTES,
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(put.status).toBe(200);

    const complete = await app.inject({
      method: 'POST',
      url: url(`/documents/${documentId}/complete`),
      headers: headerFor(orgA, ['documents.create', 'documents.read']),
    });
    expect(complete.statusCode).toBe(200);
    const completed = complete.json();
    expect(completed.data.status).toBe('UPLOADED');
    expect(completed.data.sizeBytes).toBe(DOWNLOAD_BYTES.length);
    // P8: `complete` proves the object exists, not that it is safe. The row is
    // PENDING and unservable until the scan consumer records a verdict.
    expect(completed.data.scanStatus).toBe('PENDING');
    expect(completed.data.downloadable).toBe(false);

    const get = await app.inject({
      method: 'GET',
      url: url(`/documents/${documentId}`),
      headers: headerFor(orgA, ['documents.read']),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.fileName).toBe('lab-results.txt');

    // The outbox got the Storage.DocumentUploaded event in the same txn.
    const ev = await prisma.unscoped().outboxEvent.findFirst({
      where: { organizationId: orgA, aggregateId: documentId, type: EventTypes.DocumentUploaded },
    });
    expect(ev).not.toBeNull();
    expect((ev?.payload as { documentId: string }).documentId).toBe(documentId);

    // Still unscanned: the download gate refuses with 409, not 404 — the
    // document exists and the caller may see it.
    const premature = await app.inject({
      method: 'GET',
      url: url(`/documents/${documentId}/download`),
      headers: headerFor(orgA, ['documents.read']),
    });
    expect(premature.statusCode).toBe(409);
    expect(premature.json().error.code).toBe('DOCUMENT_NOT_CLEARED');

    // Drain the outbox so the scan consumer reads the bytes and rules.
    let guard = 0;
    while ((await publisher.publishReadyEvents(100)) > 0 && guard < 20) guard += 1;

    const scanned = await prisma.unscoped().document.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(scanned.scanStatus).toBe('CLEAN');
    expect(scanned.scanEngine).toBe('heuristic');
    expect(scanned.scannedAt).not.toBeNull();
    expect(scanned.scannedBytes).toBe(DOWNLOAD_BYTES.length);
    expect(scanned.scanTruncated).toBe(false);

    const download = await app.inject({
      method: 'GET',
      url: url(`/documents/${documentId}/download`),
      headers: headerFor(orgA, ['documents.read']),
    });
    expect(download.statusCode).toBe(200);
    const remote = await fetch(download.json().data.url);
    expect(remote.status).toBe(200);
    expect(Buffer.from(await remote.arrayBuffer()).equals(DOWNLOAD_BYTES)).toBe(true);
  });

  it('rejects cross-tenant access to a document', async () => {
    const initiate = await app.inject({
      method: 'POST',
      url: url('/documents'),
      headers: headerFor(orgA, ['documents.create']),
      payload: { fileName: 'cross.txt', contentType: 'text/plain' },
    });
    const documentId = initiate.json().data.document.id;

    // Org B principal asks for Org A's document row.
    const denied = await app.inject({
      method: 'GET',
      url: url(`/documents/${documentId}`),
      headers: headerFor(orgB, ['documents.read']),
    });
    expect(denied.statusCode).toBe(404);
  });

  it('complete fails when object was never uploaded (expired/aborted)', async () => {
    const initiate = await app.inject({
      method: 'POST',
      url: url('/documents'),
      headers: headerFor(orgA, ['documents.create']),
      payload: { fileName: 'never-uploaded.txt', contentType: 'text/plain' },
    });
    const documentId = initiate.json().data.document.id;

    const complete = await app.inject({
      method: 'POST',
      url: url(`/documents/${documentId}/complete`),
      headers: headerFor(orgA, ['documents.create']),
    });
    expect(complete.statusCode).toBe(503);
    expect(complete.json().error.code).toBe('S3_UNAVAILABLE');
  });

  it('lists documents (paginated) and hides deleted ones by default', async () => {
    const headers = headerFor(orgA, ['documents.read', 'documents.create', 'documents.manage']);

    const a = await app.inject({
      method: 'POST',
      url: url('/documents'),
      headers: headerFor(orgA, ['documents.create']),
      payload: { fileName: 'list-a.txt', contentType: 'text/plain' },
    });
    const aId = a.json().data.document.id;
    const b = await app.inject({
      method: 'POST',
      url: url('/documents'),
      headers: headerFor(orgA, ['documents.create']),
      payload: { fileName: 'list-b.txt', contentType: 'text/plain' },
    });
    const bId = b.json().data.document.id;

    const zeroth = await app.inject({
      method: 'GET',
      url: url('/documents?page=1&limit=10'),
      headers,
    });
    expect(zeroth.statusCode).toBe(200);
    expect(zeroth.json().data.some((d: { id: string }) => d.id === aId)).toBe(true);

    const del = await app.inject({
      method: 'DELETE',
      url: url(`/documents/${aId}`),
      headers: headerFor(orgA, ['documents.manage']),
    });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: url(`/documents/${aId}`),
      headers,
    });
    expect(after.statusCode).toBe(404);
    const listAfter = await app.inject({
      method: 'GET',
      url: url(`/documents?page=1&limit=10`),
      headers,
    });
    expect(listAfter.json().data.filter((d: { id: string }) => d.id === aId)).toHaveLength(0);

    void bId;
  });

  it('delete requires documents.manage', async () => {
    const initiate = await app.inject({
      method: 'POST',
      url: url('/documents'),
      headers: headerFor(orgA, ['documents.create']),
      payload: { fileName: 'no-delete.txt', contentType: 'text/plain' },
    });
    const documentId = initiate.json().data.document.id;

    const denied = await app.inject({
      method: 'DELETE',
      url: url(`/documents/${documentId}`),
      headers: headerFor(orgA, ['documents.read']),
    });
    expect(denied.statusCode).toBe(403);
  });

  it('rejects a fileName that is a path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: url('/documents'),
      headers: headerFor(orgA, ['documents.create']),
      payload: { fileName: '../../etc/passwd', contentType: 'text/plain' },
    });
    expect(res.statusCode).toBe(400);
  });
});

/**
 * Phase 8 — document content security (ADR-047).
 *
 * The point of these tests is that the *bytes* are now the subject of a verdict.
 * Each case uploads through the real presigned path, drains the outbox so the
 * scan consumer runs, and then asserts on both the persisted verdict and the
 * download gate. A test that only checked the row would pass even if the gate
 * were missing, so each one also attempts a download.
 */
describe('document content security (Phase 8)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let publisher: OutboxPublisherService;
  let env: Env;
  let orgId: string;
  let userId: string;

  const url = (path: string): string => `${env.API_PREFIX}${path}`;
  const headers = (permissions: string[]) => ({
    ...principalHeaders({ organizationId: orgId, userId, permissions }),
  });

  /** Uploads real bytes through the presigned URL and completes the row. */
  async function uploadAndComplete(
    fileName: string,
    contentType: string,
    bytes: Buffer,
  ): Promise<string> {
    const initiated = await app.inject({
      method: 'POST',
      url: url('/documents'),
      headers: headers(['documents.create']),
      payload: { fileName, contentType, sizeBytes: bytes.length },
    });
    expect(initiated.statusCode).toBe(201);
    const documentId = initiated.json().data.document.id as string;

    const put = await fetch(initiated.json().data.upload.url, {
      method: 'PUT',
      // Uint8Array rather than Buffer: Node's fetch types do not accept Buffer
      // as a BodyInit, though it works at runtime.
      body: new Uint8Array(bytes),
      headers: { 'Content-Type': contentType },
    });
    expect(put.status).toBe(200);

    const complete = await app.inject({
      method: 'POST',
      url: url(`/documents/${documentId}/complete`),
      headers: headers(['documents.create']),
    });
    expect(complete.statusCode).toBe(200);
    return documentId;
  }

  const drain = async (): Promise<void> => {
    let guard = 0;
    while ((await publisher.publishReadyEvents(100)) > 0 && guard < 20) guard += 1;
  };

  const row = (id: string) => prisma.unscoped().document.findUniqueOrThrow({ where: { id } });

  const tryDownload = (id: string) =>
    app.inject({
      method: 'GET',
      url: url(`/documents/${id}/download`),
      headers: headers(['documents.read']),
    });

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
    publisher = app.get(OutboxPublisherService);
    env = app.get(ENV);
    const sc = prisma.unscoped();

    orgId = newId();
    userId = newId();
    await sc.organization.create({ data: { id: orgId, name: 'Scan Org' } });
    await sc.user.create({
      data: {
        id: userId,
        organizationId: orgId,
        email: 'scanner@documents.test',
        firstName: 'Scan',
        lastName: 'Tester',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('quarantines an EICAR sample and refuses the download', async () => {
    // The industry test signature every scanner must flag. A harmless string, so
    // the quarantine path is provable without shipping a real virus.
    const eicar = Buffer.from(
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
      'binary',
    );
    const documentId = await uploadAndComplete('notes.txt', 'text/plain', eicar);
    await drain();

    const doc = await row(documentId);
    expect(doc.scanStatus).toBe('INFECTED');
    expect(doc.scanDetail).toBe('Eicar-Test-Signature');
    // The verdict and the rule name are recorded; the sample is not.
    expect(JSON.stringify(doc)).not.toContain('X5O!P%@AP');

    const download = await tryDownload(documentId);
    expect(download.statusCode).toBe(422);
    expect(download.json().error.code).toBe('DOCUMENT_CONTENT_REJECTED');
  });

  it('refuses an executable renamed as a PDF (type confusion)', async () => {
    // Declared application/pdf, actual PE header. This is the renamed-payload
    // case the magic-byte check exists for.
    const pe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(256, 0x41)]);
    const documentId = await uploadAndComplete('invoice.pdf', 'application/pdf', pe);
    await drain();

    const doc = await row(documentId);
    expect(doc.scanStatus).toBe('REJECTED');
    expect(doc.scanDetail).toBe('EXECUTABLE_PE');

    const download = await tryDownload(documentId);
    expect(download.statusCode).toBe(422);
    expect(download.json().error.code).toBe('DOCUMENT_CONTENT_REJECTED');
  });

  it('refuses a file whose magic bytes do not match its declared type', async () => {
    // Declared PDF, not a PDF and not an executable: the softer mismatch check.
    const notAPdf = Buffer.from('Dear clinician, this is a letter, not a PDF.', 'utf8');
    const documentId = await uploadAndComplete('letter.pdf', 'application/pdf', notAPdf);
    await drain();

    const doc = await row(documentId);
    expect(doc.scanStatus).toBe('REJECTED');
    expect(doc.scanDetail).toBe('MAGIC_MISMATCH');
    expect((await tryDownload(documentId)).statusCode).toBe(422);
  });

  it('flags a document containing a national ID but still serves it', async () => {
    // FLAGGED is a review signal, not a verdict. Withholding a clinical document
    // over a pattern match would be the worse failure.
    const bytes = Buffer.from('Patient record 123-45-6789 reviewed.', 'utf8');
    const documentId = await uploadAndComplete('record.txt', 'text/plain', bytes);
    await drain();

    const doc = await row(documentId);
    expect(doc.scanStatus).toBe('FLAGGED');
    expect(doc.scanDetail).toBe('NATIONAL_ID');
    // The matched number is not persisted anywhere on the row.
    expect(JSON.stringify(doc)).not.toContain('123-45-6789');

    const download = await tryDownload(documentId);
    expect(download.statusCode).toBe(200);
  });

  it('marks a scan over the byte cap as truncated', async () => {
    // A file larger than DOCUMENT_SCAN_MAX_BYTES is only partly inspected. The
    // row has to say so rather than implying full coverage.
    const oversized = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(env.DOCUMENT_SCAN_MAX_BYTES + 4096, 0x20),
    ]);
    const documentId = await uploadAndComplete('big.pdf', 'application/pdf', oversized);
    await drain();

    const doc = await row(documentId);
    expect(doc.scanStatus).toBe('CLEAN');
    expect(doc.scanTruncated).toBe(true);
    expect(doc.scannedBytes).toBe(env.DOCUMENT_SCAN_MAX_BYTES);
    expect(doc.scannedBytes!).toBeLessThan(oversized.length);
  });

  it('re-scans a document on request and re-gates it while pending', async () => {
    const bytes = Buffer.from('clean clinical note', 'utf8');
    const documentId = await uploadAndComplete('note.txt', 'text/plain', bytes);
    await drain();
    expect((await row(documentId)).scanStatus).toBe('CLEAN');

    const rescan = await app.inject({
      method: 'POST',
      url: url(`/documents/${documentId}/rescan`),
      headers: headers(['documents.create']),
    });
    expect(rescan.statusCode).toBe(200);
    expect(rescan.json().data.scanStatus).toBe('PENDING');

    // Unservable during the re-scan, then cleared again once the consumer runs.
    expect((await tryDownload(documentId)).statusCode).toBe(409);
    await drain();
    expect((await row(documentId)).scanStatus).toBe('CLEAN');
    expect((await tryDownload(documentId)).statusCode).toBe(200);
  });

  it('rescan requires documents.create', async () => {
    const documentId = await uploadAndComplete('guarded.txt', 'text/plain', Buffer.from('x'));
    const denied = await app.inject({
      method: 'POST',
      url: url(`/documents/${documentId}/rescan`),
      headers: headers(['documents.read']),
    });
    expect(denied.statusCode).toBe(403);
  });

  it('rescan rejects a document that is not uploaded', async () => {
    const initiated = await app.inject({
      method: 'POST',
      url: url('/documents'),
      headers: headers(['documents.create']),
      payload: { fileName: 'pending.txt', contentType: 'text/plain' },
    });
    const documentId = initiated.json().data.document.id as string;

    const res = await app.inject({
      method: 'POST',
      url: url(`/documents/${documentId}/rescan`),
      headers: headers(['documents.create']),
    });
    expect(res.statusCode).toBe(409);
  });

  it('does not scan a deleted document and leaves it deleted', async () => {
    const documentId = await uploadAndComplete('doomed.txt', 'text/plain', Buffer.from('bye'));
    const del = await app.inject({
      method: 'DELETE',
      url: url(`/documents/${documentId}`),
      headers: headers(['documents.manage']),
    });
    expect(del.statusCode).toBe(204);

    await drain();

    const doc = await row(documentId);
    expect(doc.status).toBe('DELETED');
    // A re-scan event for a deleted row must not resurrect its scan state.
    expect(doc.scanStatus).toBe('PENDING');
  });
});