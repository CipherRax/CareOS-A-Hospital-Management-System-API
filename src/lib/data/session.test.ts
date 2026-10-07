import { describe, expect, it } from 'vitest';

import { normaliseSessionUser } from '@/lib/data/queries';

/**
 * The header persona comes from `/auth/me`, whose success body the export types
 * as unknown. The mapping is deliberately the single choke point; a drifting
 * response should starve the header, not crash it.
 */
describe('normaliseSessionUser', () => {
  it('joins first name, other names and last name into the display name', () => {
    const result = normaliseSessionUser({
      user: { id: 'usr_1', firstName: 'EXAMPLE', otherNames: 'N.', lastName: 'Wanjiru' },
      roleDetails: [{ name: 'Registrar' }],
    });
    expect(result).toEqual({
      id: 'usr_1',
      displayName: 'EXAMPLE N. Wanjiru',
      roleLabel: 'Registrar',
    });
  });

  it('uses the first role detail as the role label', () => {
    const result = normaliseSessionUser({
      user: { id: 'usr_1', firstName: 'EXAMPLE' },
      roleDetails: [{ name: 'Triage' }, { name: 'Fellowship' }],
    });
    expect(result.roleLabel).toBe('Triage');
  });

  it('empties the persona when parts are missing', () => {
    expect(normaliseSessionUser(null)).toEqual({ id: '', displayName: '', roleLabel: '' });
    expect(normaliseSessionUser({ user: undefined })).toEqual({
      id: '',
      displayName: '',
      roleLabel: '',
    });
    expect(normaliseSessionUser({ user: { firstName: 4 } })).toEqual({
      id: '',
      displayName: '',
      roleLabel: '',
    });
  });
});
