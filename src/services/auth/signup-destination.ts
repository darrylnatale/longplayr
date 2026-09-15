/**
 * Where a completed signup sends someone. `architecture.md` §6.
 *
 * **In the service layer, and tested directly rather than mirrored.** `signUp`
 * ends in `redirect()`, which throws by design and cannot be asserted on in a
 * unit test — so the rule lives here and the action calls it. A test that
 * re-implemented the rule alongside the code would pass while the code was
 * wrong, which is the failure this project has already corrected once.
 *
 * It also meets `CLAUDE.md`'s test for where domain logic belongs: a second
 * client would need this rule to behave correctly, because it decides what
 * happens to an account that exists but cannot yet be used.
 */

export const CHECK_YOUR_EMAIL_PATH = '/check-your-email';
export const ONBOARDING_PATH = '/onboarding';

/**
 * **The branch that was being discarded.** `signUpWithPassword` reports whether
 * a session was issued; the action used to ignore it and send everyone to
 * onboarding — which bounces a sessionless visitor to a sign-in form, asking
 * somebody who has just registered to sign in with no mention of an email.
 *
 * `enable_confirmations` is `false` in every environment today, so the
 * confirmation branch does not fire yet. That is deliberate, and it is why this
 * rule is tested: nothing else exercises it.
 */
export function signUpDestination(options: {
  needsEmailConfirmation: boolean;
  email: string;
}): string {
  if (!options.needsEmailConfirmation) return ONBOARDING_PATH;

  // Encoded because an address legally contains `+`, and a query string decodes
  // `+` as a space.
  return `${CHECK_YOUR_EMAIL_PATH}?address=${encodeURIComponent(options.email)}`;
}
