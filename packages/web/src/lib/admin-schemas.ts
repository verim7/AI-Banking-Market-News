import { z } from 'zod';

/**
 * The rules the admin forms enforce, in one place.
 *
 * Before this, "Passwords must be at least 12 characters" was a sentence
 * rendered above the form. Nothing checked it: you learned your password was
 * too short when the server said so, after a round trip, with the form already
 * cleared. A schema turns that sentence into the thing that actually decides,
 * so the message and the rule cannot drift apart.
 *
 * The minimum is 12 because that is what the Worker enforces, in two places:
 * `packages/worker/src/routes/admin.ts:142` when a user is created and `:207`
 * when a password is reset. This is a nicer way to hear the same answer, never
 * a replacement for the server's check — the form can be bypassed, the route
 * cannot.
 */
export const MIN_PASSWORD_LENGTH = 12;

const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);

export const createUserSchema = z.object({
  email: z.string().min(1, 'Email is required.').email('That is not a valid email address.'),
  // Optional, and blank is a legitimate answer — the users table renders an
  // em dash for it. `.trim()` first so a space bar is not a display name.
  displayName: z.string().trim().optional(),
  password,
  roleIds: z.array(z.string()).default([]),
});

export const resetPasswordSchema = z.object({ password });

export type CreateUserValues = z.infer<typeof createUserSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
