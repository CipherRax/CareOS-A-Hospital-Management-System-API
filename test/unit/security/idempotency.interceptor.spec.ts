import { from, type Observable } from 'rxjs';
import { first } from 'rxjs/operators';
import { IdempotencyInterceptor } from '../../../src/common/interceptors/idempotency.interceptor';
import { ErrorCodes } from '../../../src/common/errors/codes';

function makeContext(
  headers: Record<string, string | string[] | undefined>,
  opts: { method?: string; statusCode?: number } = {},
) {
  const { method = 'POST', statusCode = 201 } = opts;
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        url: '/api/v1/emergency/requests',
        headers,
        body: { note: 'x' },
      }),
      getResponse: () => ({
        statusCode,
        raw: { writableEnded: true, once: jest.fn() },
        code: jest.fn(),
      }),
    }),
  } as never;
}

function makeInterceptor(): {
  interceptor: IdempotencyInterceptor;
  prisma: { tenant: { idempotencyRecord: Record<string, jest.Mock> } };
  tenantContext: { scope: { organizationId?: string | null }; requires: jest.Mock };
} {
  const prisma = {
    tenant: {
      idempotencyRecord: {
        create: jest.fn().mockResolvedValue({ id: 'rec-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
      },
    },
  };
  const tenantContext = {
    scope: {},
    requires: jest.fn(),
  };
  const interceptor = new IdempotencyInterceptor(
    prisma as never,
    tenantContext as never,
    {} as never,
  );
  return { interceptor, prisma, tenantContext };
}

async function run(observable: Observable<unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    observable.pipe(first()).subscribe({ next: resolve, error: reject });
  });
}

describe('IdempotencyInterceptor', () => {
  it('passes through anonymous / public routes with an Idempotency-Key instead of raising', async () => {
    const { interceptor, prisma } = makeInterceptor();
    const next = { handle: jest.fn(() => from(Promise.resolve({ ok: true }))) };

    const result = await run(
      interceptor.intercept(makeContext({ 'idempotency-key': 'abc-123' }), next as never),
    );

    expect(result).toEqual({ ok: true });
    expect(next.handle).toHaveBeenCalled();
    expect(prisma.tenant.idempotencyRecord.create).not.toHaveBeenCalled();
  });

  it('still applies full idempotency guarding on tenant-scoped routes', async () => {
    const { interceptor, prisma } = makeInterceptor();
    (interceptor as unknown as {
      tenantContext: { scope: Record<string, unknown> };
    }).tenantContext.scope.organizationId = 'org-1';
    const next = { handle: jest.fn(() => from(Promise.resolve({ ok: true }))) };

    await run(
      interceptor.intercept(makeContext({ 'idempotency-key': 'abc-456' }), next as never),
    );

    expect(prisma.tenant.idempotencyRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-1', status: 'IN_PROGRESS' }),
      }),
    );
  });

  it('throws on an empty key without touching the store', async () => {
    const { interceptor, prisma } = makeInterceptor();
    const next = { handle: jest.fn(() => from(Promise.resolve({}))) };

    await expect(
      run(interceptor.intercept(makeContext({ 'idempotency-key': '  ' }), next as never)),
    ).rejects.toMatchObject({ code: ErrorCodes.IDEMPOTENCY_KEY_INVALID });
    expect(next.handle).not.toHaveBeenCalled();
    expect(prisma.tenant.idempotencyRecord.create).not.toHaveBeenCalled();
  });
});