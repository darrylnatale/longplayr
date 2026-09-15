import { describe, expect, it } from 'vitest';

import { signUpDestination } from './signup-destination';

/**
 * Where a completed signup should send someone. `architecture.md` §6.
 *
 * **This is the branch the action used to discard.** `signUpWithPassword`
 * reported whether a session was issued, and `signUp` redirected to
 * `/onboarding` regardless — so with confirmation enabled a brand-new account
 * was bounced to a sign-in form with no mention of an email.
 *
 * **`enable_confirmations` is `false` everywhere today, so the confirmation
 * branch does not fire in any environment.** That is exactly why it is tested
 * here: nothing else exercises it, and this file is the only thing standing
 * between the decision and a regression when the switch is eventually flipped.
 */

describe('where a completed signup goes', () => {
  it('goes to onboarding when a session was issued', () => {
    expect(signUpDestination({ needsEmailConfirmation: false, email: 'reader@example.com' })).toBe(
      '/onboarding',
    );
  });

  it('goes to the confirmation page when no session was issued', () => {
    expect(signUpDestination({ needsEmailConfirmation: true, email: 'reader@example.com' })).toBe(
      '/check-your-email?address=reader%40example.com',
    );
  });

  it('encodes an address that would otherwise break the query string', () => {
    // A plus-addressed email is both legal and exactly the character that a
    // query string decodes as a space — the same trap that made a base64
    // secret unusable in a URL earlier in this project.
    expect(
      signUpDestination({ needsEmailConfirmation: true, email: 'reader+longplayr@example.com' }),
    ).toContain('reader%2Blongplayr%40example.com');
  });

  it('never sends an unconfirmed account to onboarding', () => {
    // The regression this file exists for. Onboarding redirects a sessionless
    // visitor to sign in, which is the behaviour being fixed.
    expect(
      signUpDestination({ needsEmailConfirmation: true, email: 'reader@example.com' }),
    ).not.toBe('/onboarding');
  });
});
