import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
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
  let app: NestFastifyApplication;
  let prisma: PrismaService;
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

    const get = await app.inject({
      method: 'GET',
      url: url(`/documents/${documentId}`),
      headers: headerFor(orgA, ['documents.read']),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.fileName).toBe('lab-results.txt');

    const download = await app.inject({
      method: 'GET',
      url: url(`/documents/${documentId}/download`),
      headers: headerFor(orgA, ['documents.read']),
    });
    expect(download.statusCode).toBe(200);
    const remote = await fetch(download.json().data.url);
    expect(remote.status).toBe(200);
    expect(Buffer.from(await remote.arrayBuffer()).equals(DOWNLOAD_BYTES)).toBe(true);

    // The outbox got the Storage.DocumentUploaded event in the same txn.
    const ev = await prisma.unscoped().outboxEvent.findFirst({
      where: { organizationId: orgA, aggregateId: documentId, type: EventTypes.DocumentUploaded },
    });
    expect(ev).not.toBeNull();
    expect((ev?.payload as { documentId: string }).documentId).toBe(documentId);
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