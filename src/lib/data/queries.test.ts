import { describe, expect, it } from 'vitest';

import { unwrapForTest } from '@/lib/data/queries';
import { resolveApiError } from '@/lib/errors/catalog';

/**
 * The envelope layer. Everything above it renders whatever code comes out of here,
 * so a code read from the wrong depth turns a specific, correct message into a
 * generic one — which is exactly what happened once already.
 */

const ok = (data: unknown) =>
  ({ data: { success: true, data }, response: new Response(null, { status: 200 }) }) as never;

const errored = (status: number, body: unknown) =>
  ({
    data: undefined,
    error: body,
    response: new Response(null, { status }),
  }) as never;

describe('unwrap', () => {
  it('returns the payload from a success envelope', async () => {
    await expect(unwrapForTest(ok({ reference: 'EX-0001' }))).resolves.toMatchObject({
      data: { reference: 'EX-0001' },
    });
  });

  it('treats a 2xx carrying success: false as an error', async () => {
    // Trusting the status alone would render an error body as if it were a record.
    await expect(
      unwrapForTest({
        data: { success: false, error: { code: 'CONFLICT' } },
        response: new Response(null, { status: 200 }),
      } as never),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('reads the code out of a nested error envelope', async () => {
    // The real shape: `{ error: { code } }`, handed back as `error` by openapi-fetch,
    // so the code is at `error.error.code`. Reading one level too shallow turned
    // every nested error into INTERNAL_ERROR.
    await expect(
      unwrapForTest(errored(503, { success: false, error: { code: 'SERVICE_UNAVAILABLE' } })),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('still reads a flat code', async () => {
    await expect(unwrapForTest(errored(404, { code: 'RESOURCE_NOT_FOUND' }))).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('resolves the code to a catalogue entry so screens show a mapped message', async () => {
    await expect(
      unwrapForTest(errored(401, { success: false, error: { code: 'UNAUTHORIZED' } })),
    ).rejects.toMatchObject({ resolved: expect.objectContaining({ code: 'UNAUTHORIZED' }) });
  });

  it('falls back to a generic code rather than throwing on an unrecognised body', async () => {
    // A body we cannot read must still produce a renderable error, not an exception.
    await expect(unwrapForTest(errored(500, 'gateway exploded'))).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('reports an unmapped code as unmapped rather than hiding it', async () => {
    await expect(
      unwrapForTest(errored(500, { error: { code: 'SOMETHING_NEW' } })),
    ).rejects.toMatchObject({ code: 'SOMETHING_NEW', resolved: null });
  });

  it('keeps the catalogue honest about the codes it knows', () => {
    expect(resolveApiError('SERVICE_UNAVAILABLE')).not.toBeNull();
  });
});
