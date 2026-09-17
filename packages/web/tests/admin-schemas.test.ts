import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD_LENGTH, createUserSchema, resetPasswordSchema,
} from '../src/lib/admin-schemas.ts';

const valid = {
  email: 'someone@example.com',
  displayName: 'Someone',
  password: 'a-long-enough-password',
  roleIds: [],
};

describe('the rules the admin form enforces', () => {
  it('accepts a complete, valid user', () => {
    expect(createUserSchema.safeParse(valid).success).toBe(true);
  });

  it('states the password rule instead of leaving it to the server', () => {
    // The whole point of the schema. This sentence used to sit above the form
    // as decoration while nothing checked it, so you found out after a round
    // trip, with the form already cleared.
    const short = createUserSchema.safeParse({ ...valid, password: 'x'.repeat(11) });
    expect(short.success).toBe(false);
    expect(short.error?.issues[0]?.message)
      .toBe(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  });

  it('accepts a password of exactly the minimum length', () => {
    // Off-by-one, asserted rather than assumed: 12 is allowed, 11 is not.
    expect(createUserSchema.safeParse(
      { ...valid, password: 'x'.repeat(MIN_PASSWORD_LENGTH) }).success).toBe(true);
  });

  it('agrees with the Worker, which is the real gate', () => {
    // packages/worker/src/routes/admin.ts enforces the same minimum at :142
    // and :207. If someone changes one side, this is the test that should make
    // them change the other — the schema is a nicer way to hear the answer,
    // not a replacement for the route's own check.
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it('rejects an address that is not one', () => {
    for (const email of ['', 'someone', 'someone@', '@example.com']) {
      expect(createUserSchema.safeParse({ ...valid, email }).success).toBe(false);
    }
  });

  it('treats a display name of spaces as absent, not as a name', () => {
    const parsed = createUserSchema.safeParse({ ...valid, displayName: '   ' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.displayName).toBe('');
  });

  it('lets a user be created with no roles at all', () => {
    // Deliberate: an account with no role can sign in and see nothing, which
    // is the safe default. Roles are granted afterwards from the table.
    const { roleIds: _omitted, ...withoutRoles } = valid;
    const parsed = createUserSchema.safeParse(withoutRoles);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.roleIds).toEqual([]);
  });

  it('asks only for the password when resetting one', () => {
    expect(resetPasswordSchema.safeParse({ password: 'a-long-enough-password' }).success)
      .toBe(true);
    expect(resetPasswordSchema.safeParse({ password: 'short' }).success).toBe(false);
  });
});
