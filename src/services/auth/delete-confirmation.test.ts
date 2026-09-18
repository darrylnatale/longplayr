import { describe, expect, it } from 'vitest';

import { confirmationMatches } from './delete-confirmation';

/**
 * The one check standing in front of an action with no undo.
 *
 * **The leniency is deliberate and is what most of this file tests.** A person
 * who typed their handle correctly and lost to a pasted `@` or a trailing space
 * would reasonably decide the form was broken — while any difference in the
 * handle itself must still fail.
 */

describe('confirmationMatches', () => {
  it('accepts the handle typed exactly', () => {
    expect(confirmationMatches('darryl', 'darryl')).toBe(true);
  });

  it('forgives surrounding whitespace', () => {
    expect(confirmationMatches('  darryl  ', 'darryl')).toBe(true);
  });

  it('forgives a pasted @ prefix', () => {
    // `@darryl` is how people write a handle, and how it is copied from a URL
    // bar or another app.
    expect(confirmationMatches('@darryl', 'darryl')).toBe(true);
    expect(confirmationMatches('  @darryl ', 'darryl')).toBe(true);
  });

  it('forgives capitalisation, since handles are stored lowercase', () => {
    expect(confirmationMatches('Darryl', 'darryl')).toBe(true);
  });

  it('rejects a different handle', () => {
    expect(confirmationMatches('darry', 'darryl')).toBe(false);
    expect(confirmationMatches('darryll', 'darryl')).toBe(false);
    expect(confirmationMatches('someoneelse', 'darryl')).toBe(false);
  });

  it('rejects empty input', () => {
    // The default state of the form. It must never confirm anything.
    expect(confirmationMatches('', 'darryl')).toBe(false);
    expect(confirmationMatches('   ', 'darryl')).toBe(false);
  });

  it('rejects everything when the handle itself is empty', () => {
    // Only reachable through a caller passing something it should not, and the
    // dangerous failure would be empty input confirming an empty handle.
    expect(confirmationMatches('', '')).toBe(false);
    expect(confirmationMatches('@', '')).toBe(false);
  });

  it('strips only one @, so a handle cannot be reached by piling them up', () => {
    expect(confirmationMatches('@@darryl', 'darryl')).toBe(false);
  });
});
