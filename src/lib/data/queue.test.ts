import { describe, expect, it } from 'vitest';

import {
  ACTIVE_QUEUE_STATUSES,
  QUEUE_TRANSITIONS,
  boardOrder,
  extractDepartmentList,
  extractQueuePage,
  extractQueueStats,
  extractRegisteredWalkIn,
  minutesBetween,
  readQueueEntry,
  waitingMinutes,
  type QueueEntryRow,
} from '@/lib/data/queue';

/**
 * F3 queue data layer.
 *
 * The export mis-types every queue 200 as its request DTO (GAP-017), so these
 * readers — the ones the board trusts — are pinned directly. A reader that accepts
 * a drifted body is a ticket that silently disappears from the board.
 */

const row = {
  id: 'qe_example_2001',
  ticketNumber: 'Q-001',
  patientId: 'pat_example_1003',
  patient: 'EXAMPLE Chebet',
  visitId: 'vis_example_3001',
  departmentId: 'dep_example_emergency',
  branchId: 'br_example_0001',
  status: 'WAITING',
  operationalPriority: 'URGENT',
  enteredAt: '2026-10-11T08:00:00.000Z',
  calledAt: null,
  serviceStartedAt: null,
  completedAt: null,
  note: 'Chest pain.',
};

describe('readQueueEntry', () => {
  it('reads a serialized ticket', () => {
    expect(readQueueEntry(row)).toMatchObject({
      id: 'qe_example_2001',
      ticketNumber: 'Q-001',
      patient: 'EXAMPLE Chebet',
      status: 'WAITING',
      operationalPriority: 'URGENT',
    });
  });

  it('rejects a row that cannot be a ticket', () => {
    expect(readQueueEntry({})).toBeNull();
    expect(readQueueEntry({ id: 1, ticketNumber: 'Q', status: 'WAITING' })).toBeNull();
    expect(readQueueEntry(null)).toBeNull();
  });

  it('defaults a missing priority instead of failing the row', () => {
    const minimal = {
      id: row.id,
      ticketNumber: row.ticketNumber,
      status: row.status,
    };
    expect(readQueueEntry(minimal)?.operationalPriority).toBe('NORMAL');
    expect(readQueueEntry(minimal)?.patient).toBeNull();
  });
});

describe('extractQueuePage', () => {
  it('reads the { items, meta } body', () => {
    const parsed = extractQueuePage({ items: [row], meta: { total: 1 } });
    expect(parsed.ok && parsed.page.items).toHaveLength(1);
    expect(parsed.ok && parsed.page.total).toBe(1);
  });

  it('treats an empty items array as an empty board, not a broken body', () => {
    const parsed = extractQueuePage({ items: [], meta: { total: 0 } });
    expect(parsed.ok && parsed.page.items).toHaveLength(0);
  });

  it('fails closed when items is missing or malformed', () => {
    expect(extractQueuePage({ meta: {} })).toEqual({ ok: false });
    expect(extractQueuePage({ items: [{}] })).toEqual({ ok: false });
    expect(extractQueuePage(null)).toEqual({ ok: false });
  });

  it('falls back to the item count when meta.total is absent', () => {
    const parsed = extractQueuePage({ items: [row] });
    expect(parsed.ok && parsed.page.total).toBe(1);
  });
});

describe('extractQueueStats', () => {
  it('reads the { stats } body', () => {
    const parsed = extractQueueStats({
      stats: {
        avgCallWaitMinutes: 9,
        avgServiceMinutes: 14,
        abandonmentRate: 0.2,
        currentlyWaiting: 3,
      },
    });
    expect(parsed.ok && parsed.stats).toMatchObject({
      avgCallWaitMinutes: 9,
      avgServiceMinutes: 14,
      abandonmentRate: 0.2,
      currentlyWaiting: 3,
    });
  });

  it('nulls unknown averages and defaults the waiting count', () => {
    const parsed = extractQueueStats({ stats: {} });
    expect(parsed.ok && parsed.stats.avgCallWaitMinutes).toBeNull();
    expect(parsed.ok && parsed.stats.currentlyWaiting).toBe(0);
  });

  it('fails closed without a stats object', () => {
    expect(extractQueueStats({})).toEqual({ ok: false });
    expect(extractQueueStats(null)).toEqual({ ok: false });
  });
});

describe('extractRegisteredWalkIn', () => {
  it('reads the ticket receipt', () => {
    const parsed = extractRegisteredWalkIn({
      ticketNumber: 'Q-007',
      visitId: 'vis_example_3007',
      position: 2,
      status: 'WAITING',
    });
    expect(parsed.ok && parsed.receipt).toMatchObject({
      ticketNumber: 'Q-007',
      position: 2,
      status: 'WAITING',
    });
  });

  it('fails closed without a ticket number', () => {
    expect(extractRegisteredWalkIn({ visitId: 'vis' })).toEqual({ ok: false });
    expect(extractRegisteredWalkIn(null)).toEqual({ ok: false });
  });
});

describe('extractDepartmentList', () => {
  it('reads { departments, meta } rather than { items }', () => {
    const parsed = extractDepartmentList({
      departments: [
        { id: 'dep_1', name: 'Outpatient', code: 'OPD', kind: 'STANDARD', active: true },
      ],
      meta: { total: 1 },
    });
    expect(parsed.ok && parsed.departments).toHaveLength(1);
    expect(parsed.ok && parsed.departments[0]?.name).toBe('Outpatient');
  });

  it('drops entries that are not departments instead of inventing a blank option', () => {
    const parsed = extractDepartmentList({
      departments: [{ id: 'dep_1', name: 'Outpatient' }, { name: 'No id' }, 42],
    });
    expect(parsed.ok && parsed.departments).toHaveLength(1);
  });

  it('fails closed without a departments array', () => {
    expect(extractDepartmentList({ items: [] })).toEqual({ ok: false });
    expect(extractDepartmentList(null)).toEqual({ ok: false });
  });
});

describe('boardOrder', () => {
  it('sorts urgent before normal before low', () => {
    const entries = [
      { ...row, id: 'low', operationalPriority: 'LOW', enteredAt: '2026-10-11T07:00:00.000Z' },
      { ...row, id: 'urgent', operationalPriority: 'URGENT', enteredAt: '2026-10-11T09:00:00.000Z' },
      { ...row, id: 'normal', operationalPriority: 'NORMAL', enteredAt: '2026-10-11T08:00:00.000Z' },
    ] as QueueEntryRow[];
    expect(boardOrder(entries).map((entry) => entry.id)).toEqual(['urgent', 'normal', 'low']);
  });

  it('breaks ties on waiting time, oldest first', () => {
    const entries = [
      { ...row, id: 'later', operationalPriority: 'NORMAL', enteredAt: '2026-10-11T08:30:00.000Z' },
      { ...row, id: 'earlier', operationalPriority: 'NORMAL', enteredAt: '2026-10-11T08:00:00.000Z' },
    ] as QueueEntryRow[];
    expect(boardOrder(entries).map((entry) => entry.id)).toEqual(['earlier', 'later']);
  });
});

describe('time helpers', () => {
  it('computes whole minutes between two stamps', () => {
    expect(minutesBetween('2026-10-11T08:00:00.000Z', '2026-10-11T08:12:00.000Z')).toBe(12);
  });

  it('returns null when a stamp is missing or invalid', () => {
    expect(minutesBetween(null, '2026-10-11T08:12:00.000Z')).toBeNull();
    expect(minutesBetween('nonsense', '2026-10-11T08:12:00.000Z')).toBeNull();
  });

  it('measures waiting time against a supplied clock', () => {
    const at = Date.parse('2026-10-11T08:12:00.000Z');
    expect(waitingMinutes(row as QueueEntryRow, at)).toBe(12);
    expect(waitingMinutes({ ...row, enteredAt: null } as QueueEntryRow, at)).toBeNull();
  });
});

describe('the queue flow', () => {
  it('offers the API transition graph', () => {
    expect(QUEUE_TRANSITIONS.WAITING).toContain('CALLED');
    expect(QUEUE_TRANSITIONS.CALLED).toContain('IN_SERVICE');
    expect(QUEUE_TRANSITIONS.IN_SERVICE).toContain('COMPLETED');
  });

  it('treats finished tickets as terminal', () => {
    for (const status of ['COMPLETED', 'NO_SHOW', 'ABANDONED', 'CANCELLED', 'TRANSFERRED']) {
      expect(QUEUE_TRANSITIONS[status]).toEqual([]);
    }
  });

  it('counts only waiting, called and in-service as active', () => {
    expect([...ACTIVE_QUEUE_STATUSES]).toEqual(['WAITING', 'CALLED', 'IN_SERVICE']);
  });
});
