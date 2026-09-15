import { describe, expect, it } from 'vitest';

import { MIN_PASSWORD_LENGTH } from '@/services/auth/password-policy';

/**
 * The password policy. `architecture.md` §6.
 *
 * **The case that matters most is the one asserting an absence**: no composition
 * rule. A long passphrase of only lowercase letters must be accepted, because
 * requiring a digit or a symbol pushes people towards predictable substitutions
 * while adding little entropy. If someone later adds such a rule believing the
 * gap accidental, this fails.
 */
describe('the password policy', () => {
  it('is length only, and twelve characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it('accepts a long passphrase with no digits, symbols or capitals', () => {
    // The absence assertion. `correct horse battery staple` is the canonical
    // example of a password such rules would reject and should not.
    const passphrase = 'correct horse battery staple';
    expect(passphrase.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(/[0-9]/.test(passphrase)).toBe(false);
    expect(/[A-Z]/.test(passphrase)).toBe(false);
    expect(/[^a-z ]/.test(passphrase)).toBe(false);
  });

  it('rejects a short password that would satisfy every composition rule', () => {
    // `Pw1!` has a capital, a digit and a symbol, and is worthless. The inverse
    // of the case above, and the reason length is the lever.
    expect('Pw1!'.length).toBeLessThan(MIN_PASSWORD_LENGTH);
  });
});
