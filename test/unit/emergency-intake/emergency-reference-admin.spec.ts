import { ErrorCodes } from '../../../src/common/errors/codes';
import { FieldEncryption } from '../../../src/common/security/crypto';
import { EmergencyIntakeService } from '../../../src/modules/emergency-intake/emergency-intake.service';

const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function build() {
  const emergencyNumber = {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(({ data }: { data: { id: string } }) => ({ ...data })),
    update: jest.fn().mockImplementation(({ data }: { data: unknown }) => data),
    delete: jest.fn().mockResolvedValue({}),
  };
  const publicNotice = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(({ data }: { data: { id: string } }) => ({ ...data })),
    update: jest.fn().mockImplementation(({ data }: { data: unknown }) => data),
    delete: jest.fn().mockResolvedValue({}),
  };
  const auditLog = { create: jest.fn().mockResolvedValue({ id: 'a-1' }) };
  const unscoped = { emergencyNumber, publicNotice };
  const tenant = { auditLog };

  // Records which operations the transaction performed, in order, so the test can
  // assert the change and its audit record commit or roll back together.
  const committed: string[] = [];
  const scoped = {
    ...tenant,
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const tx = makeTx();
      try {
        return await work(tx);
      } catch (err) {
        // Rollback: nothing the transaction did reaches the database.
        committed.length = 0;
        throw err;
      }
    },
  };

  function makeTx() {
    return {
      emergencyNumber: {
        findUnique: emergencyNumber.findUnique,
        findFirst: emergencyNumber.findFirst,
        create: jest.fn(async (args: unknown) => {
          committed.push('number.create');
          return emergencyNumber.create(args as never);
        }),
        update: jest.fn(async (args: unknown) => {
          committed.push('number.update');
          return emergencyNumber.update(args as never);
        }),
        delete: jest.fn(async (args: unknown) => {
          committed.push('number.delete');
          return emergencyNumber.delete(args as never);
        }),
      },
      publicNotice: {
        create: jest.fn(async (args: unknown) => {
          committed.push('notice.create');
          return publicNotice.create(args as never);
        }),
        update: jest.fn(async (args: unknown) => {
          committed.push('notice.update');
          return publicNotice.update(args as never);
        }),
        delete: jest.fn(async (args: unknown) => {
          committed.push('notice.delete');
          return publicNotice.delete(args as never);
        }),
      },
      auditLog: {
        create: jest.fn(async (args: unknown) => {
          committed.push('audit');
          return auditLog.create(args as never);
        }),
      },
    };
  }

  const prisma = { unscoped: () => unscoped, tenantFor: jest.fn(() => scoped) };
  const tenantContext = {
    scope: {},
    requireOrg: jest.fn(() => 'org-1'),
    requireUserId: jest.fn(() => 'user-1'),
  };
  const service = new EmergencyIntakeService(
    prisma as never,
    tenantContext as never,
    {
      run: async (work: (ctx: { db: unknown; organizationId: string }) => Promise<unknown>, opts?: { organizationId?: string }) => {
        const organizationId = opts?.organizationId ?? 'org-1';
        return scoped.$transaction((tx) => work({ db: tx, organizationId }));
      },
    } as never,
    { publish: jest.fn() } as never,
    new FieldEncryption(SECRET),
    { add: jest.fn() } as never,
    { EMERGENCY_DEDUPE_SECONDS: 120, EMERGENCY_RETENTION_DAYS: 90 } as never,
  );
  return { service, emergencyNumber, publicNotice, auditLog, tenantContext, committed };
}

const NUMBER = { country: 'KE', purpose: 'ambulance', label: 'Ambulance', phone: '199' };

describe('emergency reference-data administration', () => {
  describe('audit trail', () => {
    it('audits number creation', async () => {
      const { service, auditLog } = build();
      await service.setNumber(NUMBER as never);
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'emergency.number_created',
            resource: 'emergency_number',
            organizationId: 'org-1',
            userId: 'user-1',
          }),
        }),
      );
    });

    it('audits number updates with before and after values', async () => {
      // The number is what a distressed caller is told to phone: a silent change
      // to it must be reconstructable after the fact.
      const { service, emergencyNumber, auditLog } = build();
      emergencyNumber.findUnique.mockResolvedValue({
        id: 'n-1',
        ...NUMBER,
        phone: '999',
        verified: false,
        public: true,
      });
      await service.setNumber({ ...NUMBER, phone: '112', verified: true } as never, 'n-1');
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'emergency.number_updated',
            previousState: expect.objectContaining({ phone: '999', verified: false }),
            newState: expect.objectContaining({ phone: '112', verified: true }),
          }),
        }),
      );
    });

    it('audits number deletion', async () => {
      const { service, emergencyNumber, auditLog } = build();
      emergencyNumber.findUnique.mockResolvedValue({ id: 'n-1', ...NUMBER });
      await service.deleteNumber('n-1');
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'emergency.number_deleted' }),
        }),
      );
    });

    it('audits notice creation, update and deletion', async () => {
      const { service, publicNotice, auditLog } = build();
      await service.setNotice({ title: 't', message: 'm', severity: 'WARNING' } as never);
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'emergency.notice_created' }),
        }),
      );

      auditLog.create.mockClear();
      publicNotice.findUnique.mockResolvedValue({
        id: 'n-2',
        title: 't',
        message: 'm',
        severity: 'WARNING',
        active: true,
        startsAt: new Date(),
        endsAt: null,
      });
      await service.setNotice({ title: 't', message: 'm2', active: false } as never, 'n-2');
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'emergency.notice_updated',
            previousState: expect.objectContaining({ active: true }),
            newState: expect.objectContaining({ active: false }),
          }),
        }),
      );

      auditLog.create.mockClear();
      await service.deleteNotice('n-2');
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'emergency.notice_deleted' }),
        }),
      );
    });

    it('never writes caller data into the audit record', async () => {
      const { service, auditLog } = build();
      await service.setNumber(NUMBER as never);
      const serialized = JSON.stringify(auditLog.create.mock.calls);
      expect(serialized).not.toContain('callerPhoneEnc');
      expect(serialized).not.toContain('descriptionEnc');
    });
  });

  describe('guard rails', () => {
    it('rejects a second number for the same country and purpose', async () => {
      const { service, emergencyNumber } = build();
      emergencyNumber.findFirst.mockResolvedValue({ id: 'n-1', ...NUMBER });
      await expect(service.setNumber(NUMBER as never)).rejects.toMatchObject({
        code: ErrorCodes.CONFLICT,
      });
      expect(emergencyNumber.create).not.toHaveBeenCalled();
    });

    it('rolls the change back when the audit record cannot be written', async () => {
      // Audit is the point of these endpoints. If it fails, the reference data
      // must not change: an unlogged change to the number a distressed caller is
      // told to phone is the worst possible outcome here.
      const { service, auditLog, committed } = build();
      auditLog.create.mockRejectedValue(new Error('audit unavailable'));
      await expect(service.setNumber(NUMBER as never)).rejects.toThrow('audit unavailable');
      // The write was attempted inside the transaction, and the whole thing rolled
      // back, so nothing committed.
      expect(committed).toHaveLength(0);
    });

    it('commits the change and its audit record together', async () => {
      const { service, committed } = build();
      await service.setNumber(NUMBER as never);
      expect(committed).toEqual(['number.create', 'audit']);
    });

    it('rolls a notice change back when its audit record fails', async () => {
      const { service, auditLog, committed } = build();
      auditLog.create.mockRejectedValue(new Error('audit unavailable'));
      await expect(
        service.setNotice({ title: 't', message: 'm' } as never),
      ).rejects.toThrow('audit unavailable');
      expect(committed).toHaveLength(0);
    });

    it('rejects updating a number that does not exist', async () => {
      const { service, emergencyNumber } = build();
      await expect(service.setNumber(NUMBER as never, 'missing')).rejects.toMatchObject({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
      });
      expect(emergencyNumber.update).not.toHaveBeenCalled();
    });

    it('rejects deleting a number that does not exist', async () => {
      const { service, emergencyNumber } = build();
      await expect(service.deleteNumber('missing')).rejects.toMatchObject({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
      });
      expect(emergencyNumber.delete).not.toHaveBeenCalled();
    });
  });

  describe('number verification and retirement', () => {
    it('records when an operator confirmed the number and keeps the flag in sync', async () => {
      // `verified` alone cannot tell an operator when the check happened, which
      // matters when the national number for a purpose changes over time.
      const { service, emergencyNumber } = build();
      await service.setNumber({
        ...NUMBER,
        verifiedAt: '2026-01-15T10:00:00.000Z',
      } as never);
      expect(emergencyNumber.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          verified: true,
          verifiedAt: new Date('2026-01-15T10:00:00.000Z'),
        }),
      });
    });

    it('clears the confirmation when an operator revokes it', async () => {
      const { service, emergencyNumber } = build();
      emergencyNumber.findUnique.mockResolvedValue({ id: 'n-1', ...NUMBER });
      await service.setNumber({ ...NUMBER, verifiedAt: null } as never, 'n-1');
      expect(emergencyNumber.update).toHaveBeenCalledWith({
        where: { id: 'n-1' },
        data: expect.objectContaining({ verifiedAt: null }),
      });
    });

    it('records a retirement in the audit trail', async () => {
      // `active: false` withdraws a number from callers without deleting the
      // row, so the withdrawal still has to be reconstructable.
      const { service, auditLog, emergencyNumber } = build();
      emergencyNumber.findUnique.mockResolvedValue({
        id: 'n-1',
        ...NUMBER,
        active: true,
        verified: false,
        verifiedAt: null,
        public: true,
      });
      await service.setNumber({ ...NUMBER, active: false } as never, 'n-1');
      const [payload] = auditLog.create.mock.calls[0];
      expect(JSON.stringify(payload)).toContain('"active":false');
      const { data } = payload as { data: { previousState: { active: boolean } } };
      expect(data.previousState.active).toBe(true);
    });
  });

  describe('notice review provenance', () => {
    it('stamps the acting operator and review time on a published notice', async () => {
      // Brief §6.14: published copy must be attributable to a reviewer.
      const { service, publicNotice } = build();
      await service.setNotice({ title: 't', message: 'm' } as never);
      expect(publicNotice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reviewedBy: 'user-1',
          reviewedAt: expect.any(Date),
        }),
      });
    });

    it('re-stamps the review time when published copy is edited', async () => {
      const { service, publicNotice } = build();
      publicNotice.findUnique.mockResolvedValue({
        id: 'n-1',
        title: 't',
        message: 'm',
        severity: 'INFO',
        active: true,
        reviewedBy: 'user-1',
      });
      await service.setNotice({ title: 't2', message: 'm2' } as never, 'n-1');
      expect(publicNotice.update).toHaveBeenCalledWith({
        where: { id: 'n-1' },
        data: expect.objectContaining({ reviewedBy: 'user-1', reviewedAt: expect.any(Date) }),
      });
    });

    it('leaves review provenance untouched when a notice is deactivated', async () => {
      // Retiring a notice must not erase who reviewed the copy it published.
      const { service, publicNotice } = build();
      publicNotice.findUnique.mockResolvedValue({
        id: 'n-1',
        title: 't',
        message: 'm',
        severity: 'INFO',
        active: true,
        reviewedBy: 'user-1',
      });
      await service.setNotice({ title: 't', message: 'm', active: false } as never, 'n-1');
      const [args] = publicNotice.update.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(args.data).not.toHaveProperty('reviewedBy');
      expect(args.data).not.toHaveProperty('reviewedAt');
    });
  });
});