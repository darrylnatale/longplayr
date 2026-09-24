import { z } from 'zod';

/**
 * The password policy. `architecture.md` §6, *Password policy: length, and
 * deliberately nothing else*.
 *
 * **In the service layer because a native client would need this rule to behave
 * correctly** — the test `CLAUDE.md` sets for where domain logic lives. A second
 * client must reject a nine-character password for the same reason and with the
 * same message, and a rule that lives in a server action cannot be shared.
 *
 * **It also cannot live in the action**: `actions.ts` carries `'use server'`,
 * where only async functions may be exported. That constraint pointed at the
 * right home rather than merely away from the wrong one.
 */

/**
 * **Length only, and the absence of composition rules is a decision.**
 *
 * Requiring a digit, a symbol or a capital pushes people towards predictable
 * substitutions — `Password1!` satisfies every such rule and is worthless —
 * while adding little real entropy. Length is the lever that works.
 *
 * **Twelve is considered, not measured.** No dictionary, entropy estimate or
 * breach corpus informed it. What is decided is the shape.
 *
 * A breach-list check is the genuinely effective addition and is deliberately
 * `[OPEN]`: it means an external call on every signup and a privacy question,
 * since even under k-anonymity a hash prefix of a user's password leaves the
 * system.
 */
export const MIN_PASSWORD_LENGTH = 12;

/** The hint shown under the signup field, derived so the two cannot drift. */
export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters.`;

/**
 * The rule for **choosing** a password, shared by every surface that asks for
 * one — signup today, reset since 2026-09-24.
 *
 * **Shared rather than copied, and §6 records why that matters here
 * specifically.** Sign-in and signup once ran one schema between them, and the
 * consequence was that raising the minimum would have locked out every existing
 * account. The lesson was not *"never share"* — it was that **a rule for
 * choosing a password is not a rule for presenting one you already have.**
 * Signup and reset are both the former, so they share; sign-in is the latter,
 * and does not.
 *
 * **Confirmation is part of the rule, not decoration.** A password typed once
 * and mistyped is a lockout, which on a reset form is the failure the whole
 * flow exists to repair.
 */
export const passwordChoiceSchema = z
  .object({
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    // Reported against the field the reader must change, not the first they
    // typed.
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });
