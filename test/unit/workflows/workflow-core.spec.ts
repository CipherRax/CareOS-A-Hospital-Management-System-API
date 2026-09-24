import type { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  WORKFLOW_ENTITY_TYPES,
  WORKFLOW_VALID_STATUSES,
  SYSTEM_TRANSITIONS,
  addableEdges,
  assertWorkflowTransition,
  effectiveEdges,
  isValidWorkflowEntityType,
  isValidWorkflowStatus,
} from '../../../src/modules/workflows/domain/workflow-core';

describe('workflow-core', () => {
  describe('shape safety', () => {
    it('exports one valid-status map and system map per entity type', () => {
      for (const entityType of WORKFLOW_ENTITY_TYPES) {
        expect(WORKFLOW_VALID_STATUSES[entityType].length).toBeGreaterThan(0);
        expect(SYSTEM_TRANSITIONS[entityType].length).toBeGreaterThan(0);
      }
    });

    it('system edges reference only valid statuses', () => {
      for (const entityType of WORKFLOW_ENTITY_TYPES) {
        for (const edge of SYSTEM_TRANSITIONS[entityType]) {
          expect(isValidWorkflowStatus(entityType, edge.fromStatus)).toBe(true);
          expect(isValidWorkflowStatus(entityType, edge.toStatus)).toBe(true);
        }
      }
    });

    it('no self-referential system edges', () => {
      for (const entityType of WORKFLOW_ENTITY_TYPES) {
        for (const edge of SYSTEM_TRANSITIONS[entityType]) {
          expect(edge.fromStatus).not.toBe(edge.toStatus);
        }
      }
    });
  });

  describe('isValidWorkflowEntityType', () => {
    it('accepts known types and rejects unknowns', () => {
      expect(isValidWorkflowEntityType('encounter')).toBe(true);
      expect(isValidWorkflowEntityType('task')).toBe(true);
      expect(isValidWorkflowEntityType('prescription')).toBe(false);
      expect(isValidWorkflowEntityType('$sql')).toBe(false);
    });
  });

  describe('effectiveEdges / addableEdges', () => {
    const encounterSystem = SYSTEM_TRANSITIONS.encounter;

    it('union of system + custom, deduplicated', () => {
      const custom = [
        { fromStatus: 'OPEN', toStatus: 'COMPLETED' },
        { fromStatus: 'OPEN', toStatus: 'IN_PROGRESS' }, // duplicate of system edge
      ];
      const edges = effectiveEdges('encounter', custom);
      expect(edges).toContainEqual({ fromStatus: 'OPEN', toStatus: 'COMPLETED' });
      expect(edges).toContainEqual({ fromStatus: 'OPEN', toStatus: 'IN_PROGRESS' });
      expect(edges).toHaveLength(encounterSystem.length + 1);
    });

    it('addable excludes everything already present', () => {
      const addable = addableEdges('encounter', []);
      expect(addable).not.toContainEqual({ fromStatus: 'OPEN', toStatus: 'IN_PROGRESS' });
      expect(addable).toContainEqual({ fromStatus: 'OPEN', toStatus: 'COMPLETED' });
    });

    it('addable coverage: every valid from→to pair is a system or addable edge', () => {
      for (const entityType of WORKFLOW_ENTITY_TYPES) {
        const present = new Set(
          effectiveEdges(entityType, []).map((e) => `${e.fromStatus}\u0000${e.toStatus}`),
        );
        const addable = new Set(
          addableEdges(entityType, []).map((e) => `${e.fromStatus}\u0000${e.toStatus}`),
        );
        for (const from of WORKFLOW_VALID_STATUSES[entityType]) {
          for (const to of WORKFLOW_VALID_STATUSES[entityType]) {
            if (from === to) continue;
            expect(present.has(`${from}\u0000${to}`) || addable.has(`${from}\u0000${to}`)).toBe(true);
          }
        }
      }
    });
  });

  describe('assertWorkflowTransition', () => {
    it('allows every system edge', () => {
      for (const entityType of WORKFLOW_ENTITY_TYPES) {
        for (const edge of SYSTEM_TRANSITIONS[entityType]) {
          expect(() =>
            assertWorkflowTransition(entityType, edge.fromStatus, edge.toStatus, []),
          ).not.toThrow();
        }
      }
    });

    it('is a no-op for identical statuses', () => {
      expect(() => assertWorkflowTransition('encounter', 'OPEN', 'OPEN', [])).not.toThrow();
    });

    it('allows custom edges once configured', () => {
      expect(() =>
        assertWorkflowTransition('encounter', 'OPEN', 'COMPLETED', [
          { fromStatus: 'OPEN', toStatus: 'COMPLETED' },
        ]),
      ).not.toThrow();
      try {
        assertWorkflowTransition('encounter', 'OPEN', 'COMPLETED', []);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    });

    it('rejects unknown statuses and illegal moves', () => {
      const cases: Array<[string, [string, string]]> = [
        ['encounter', ['OPEN', 'BOGUS']],
        ['encounter', ['BOGUS', 'OPEN']],
        ['encounter', ['COMPLETED', 'OPEN']], // terminal → anything
        ['task', ['DONE', 'OPEN']], // terminal → reopen
        ['referral', ['ACCEPTED', 'SENT']],
        ['diagnosis', ['RESOLVED', 'ACTIVE']],
      ];
      for (const [entityType, [from, to]] of cases) {
        try {
          assertWorkflowTransition(entityType as never, from, to, []);
          throw new Error(`expected throw for ${entityType} ${from} → ${to}`);
        } catch (err) {
          expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
        }
      }
    });
  });
});