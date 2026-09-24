import { describe, expect, it } from 'vitest';

import { MIN_PASSWORD_LENGTH, passwordChoiceSchema } from './password-policy';

/**
 * The rule for **choosing** a password, shared by signup and reset.
 *
 * **Shared rather than copied**, and `architecture.md` §6 records why that
 * distinction is load-bearing here: sign-in once shared a schema with signup,
 * and raising the minimum would have locked out every existing account. The
 * lesson was not *never share* — it was that **a rule for choosing a password
 * is not a rule for presenting one you already have.**
 */

const valid = 'a-perfectly-fine-password';

describe('passwordChoiceSchema', () => {
  it('accepts a long enough password typed twice', () => {
    const result = passwordChoiceSchema.safeParse({
      password: valid,
      confirmPassword: valid,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a password below the minimum', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    const result = passwordChoiceSchema.safeParse({
      password: short,
      confirmPassword: short,
    });
    expect(result.success).toBe(false);
  });

  it('reports a mismatch against the confirmation field', () => {
    // Against the field the reader must change, not the first they typed.
    const result = passwordChoiceSchema.safeParse({
      password: valid,
      confirmPassword: `${valid}x`,
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toEqual(['confirmPassword']);
  });

  it('applies no composition rule', () => {
    // §6: requiring a digit or symbol pushes people towards predictable
    // substitutions while adding little entropy. Length is the whole policy,
    // and this asserts that rather than leaving it to be re-litigated.
    const lettersOnly = 'abcdefghijklmnop';
    expect(
      passwordChoiceSchema.safeParse({
        password: lettersOnly,
        confirmPassword: lettersOnly,
      }).success,
    ).toBe(true);
  });
});
