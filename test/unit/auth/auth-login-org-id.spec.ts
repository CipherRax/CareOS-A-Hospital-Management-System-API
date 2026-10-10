import {
  LoginSchema,
  RequestPasswordResetSchema,
} from '../../../src/modules/auth/dto/auth.dto';

describe('auth login organization id', () => {
  it('accepts a seeded-style string organization id (not necessarily a uuid)', () => {
    const result = LoginSchema.safeParse({
      organizationId: 'demo-org-nairobi',
      email: 'nurse@example.org',
      password: 'EXAMPLE-password',
    });
    expect(result.success).toBe(true);
  });

  it('still accepts a uuid organization id', () => {
    const result = LoginSchema.safeParse({
      organizationId: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
      email: 'nurse@example.org',
      password: 'EXAMPLE-password',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a blank organization id', () => {
    const result = LoginSchema.safeParse({
      organizationId: '   ',
      email: 'nurse@example.org',
      password: 'EXAMPLE-password',
    });
    expect(result.success).toBe(false);
  });

  it('bounds the organization id against absurd input', () => {
    const result = LoginSchema.safeParse({
      organizationId: 'x'.repeat(129),
      email: 'nurse@example.org',
      password: 'EXAMPLE-password',
    });
    expect(result.success).toBe(false);
  });

  it('applies the same rule to password reset requests', () => {
    const result = RequestPasswordResetSchema.safeParse({
      organizationId: 'demo-org-westlands',
      email: 'nurse@example.org',
    });
    expect(result.success).toBe(true);
  });
});
