import {
  formatTicket,
  nextQueueSequence,
  queueCounterKey,
  ticketPrefixFor,
} from '../../../src/modules/queue/domain/ticket';

describe('ticket', () => {
  describe('queueCounterKey', () => {
    it('embeds branch, department and UTC date', () => {
      const key = queueCounterKey('br-1', 'dept-2', new Date('2026-09-23T19:00:00Z'));
      expect(key).toBe('queue:br-1:dept-2:2026-09-23');
    });
  });

  describe('formatTicket', () => {
    it('pads to three digits after the prefix', () => {
      expect(formatTicket('A', 1)).toBe('A001');
      expect(formatTicket('A', 34)).toBe('A034');
      expect(formatTicket('Q', 512)).toBe('Q512');
    });
  });

  describe('ticketPrefixFor', () => {
    it('derives the uppercase first letter', () => {
      expect(ticketPrefixFor('Outpatient')).toBe('O');
      expect(ticketPrefixFor('  laboratory ')).toBe('L');
    });

    it('falls back to Q for non-letters', () => {
      expect(ticketPrefixFor('9XX')).toBe('Q');
      expect(ticketPrefixFor('')).toBe('Q');
    });
  });

  describe('nextQueueSequence', () => {
    it('runs the org-scoped upsert and returns the raw counter', async () => {
      const db = { $queryRaw: jest.fn().mockResolvedValue([{ value: 7n }]) };
      const seq = await nextQueueSequence(
        db as unknown as Parameters<typeof nextQueueSequence>[0],
        'org-1',
        'br-1',
        'dept-2',
        new Date('2026-09-23T00:00:00Z'),
      );
      expect(seq).toBe(7n);
      const sql: TemplateStringsArray = (db.$queryRaw as jest.Mock).mock.calls[0][0];
      expect(sql.join('')).toContain('INSERT INTO "counters"');
      expect(sql.join('')).toContain('ON CONFLICT ("organizationId", "key")');
      expect((db.$queryRaw as jest.Mock).mock.calls[0][1]).toBe(
        'cnt-org-1-queue:br-1:dept-2:2026-09-23',
      );
    });

    it('defaults to 1 when no row comes back', async () => {
      const db = { $queryRaw: jest.fn().mockResolvedValue([]) };
      const seq = await nextQueueSequence(
        db as unknown as Parameters<typeof nextQueueSequence>[0],
        'org-1',
        'br-1',
        'dept-2',
        new Date('2026-09-23T00:00:00Z'),
      );
      expect(seq).toBe(1n);
    });
  });
});