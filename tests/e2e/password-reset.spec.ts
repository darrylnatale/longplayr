import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

/**
 * Resetting a forgotten password, end to end (`architecture.md` §6.1).
 *
 * **This has to run in a browser, and that is a security property rather than
 * an inconvenience.** The flow is PKCE: the code in the emailed link is bound
 * to a verifier stored in the cookie of the browser that asked for the reset.
 * A shell script can drive every other part of this — it cannot complete the
 * exchange, and it should not be able to.
 *
 * **The email is read from Mailpit**, the local stack's inbox, so the link
 * under test is the real one Supabase generated rather than one constructed
 * here. A hand-built link would prove only that the route parses a parameter.
 *
 * **The route's destination is in its path, not a query parameter**, and the
 * reason is worth carrying: Supabase appends its own `?code=` to `redirectTo`,
 * so a query string there comes back with an ampersand where the question mark
 * should be. Found by probing a real link — see `auth/callback/handler.ts`.
 */

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const NAV = { timeout: 15_000 };

const admin: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const createdEmails: string[] = [];

function uniqueUser() {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  return {
    email: `reset-${stamp}@example.com`,
    password: 'correct-horse-battery-staple',
    newPassword: 'a-completely-different-one',
    handle: `r_${stamp}`.slice(0, 30),
  };
}

/** The most recent message for an address, polled until it lands. */
async function latestLinkFor(email: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(email)}`);
    if (response.ok) {
      const { messages } = (await response.json()) as { messages: { ID: string }[] };
      if (messages?.length) {
        const detail = await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`);
        const body = (await detail.json()) as { Text?: string; HTML?: string };
        const text = `${body.Text ?? ''}${body.HTML ?? ''}`;
        const link = text.match(/https?:\/\/[^\s"<>]*verify[^\s"<>]*/)?.[0];
        if (link) return link.replace(/&amp;/g, '&');
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No reset email arrived for ${email}`);
}

/**
 * Creates the account this test needs, without driving the signup UI.
 *
 * **Setup, not subject.** This test is about resetting a password; signing up
 * has its own end-to-end test and does not need proving twice. Driving the
 * signup form cost **four navigations** — signup, onboarding, handle claim,
 * profile — before the journey under test began, and that is a third of a
 * test that was timing out at 90 seconds on its total budget (F-063).
 *
 * **`email_confirm` is set so the account is immediately usable.** The flow
 * under test starts from a user who already has a password and has forgotten
 * it, not from an unconfirmed signup.
 */
async function createAccount(user: ReturnType<typeof uniqueUser>) {
  createdEmails.push(user.email);

  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (error) throw error;

  // The handle is claimed directly for the same reason: the onboarding journey
  // is another test's subject. A profile row is still needed, because the app
  // sends a user without one to `/onboarding`.
  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id: data.user!.id, handle: user.handle });
  if (profileError) throw profileError;
}

/** Signs in through the UI, which this test does need to exercise. */
async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.afterAll(async () => {
  for (const email of createdEmails) {
    const { data } = await admin.auth.admin.listUsers();
    const found = data?.users.find((u) => u.email === email);
    if (found) await admin.auth.admin.deleteUser(found.id).catch(() => undefined);
  }
});

test('a forgotten password can be reset from the emailed link', async ({ page }) => {
  /*
   * **The longest journey in this suite, and an explicit budget rather than a
   * multiplier.** `test.slow()` triples Playwright's 30s default to 90s, and
   * 90s was not enough: this test was the single flaky test in three
   * consecutive CI runs, timing out at its *last* step with
   * `locator.fill: Test timeout of 90000ms exceeded` (F-063).
   *
   * **The budget is stated as a number because the number is the decision.**
   * A multiplier of a framework default silently changes meaning if that
   * default ever moves.
   *
   * **Four navigations were also removed rather than merely paid for**: the
   * account is now created through the admin API instead of by driving the
   * signup UI, which has its own test. Setup is not the subject.
   */
  test.setTimeout(180_000);

  const user = uniqueUser();
  await createAccount(user);

  // **No sign-out is needed, and that is stronger than signing out.** The
  // account was created server-side, so this browser has never held a session
  // and nothing below can succeed because one survived.
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL('/forgot-password', NAV);

  await page.getByLabel('Email').fill(user.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();

  // Deliberately conditional wording: the response must be identical whether or
  // not the address has an account.
  await expect(page.getByText(/if that address has an account/i)).toBeVisible(NAV);

  // **The same browser follows the link**, which is what makes the PKCE
  // exchange possible — the verifier is in this context's cookie.
  await page.goto(await latestLinkFor(user.email));
  await expect(page).toHaveURL('/reset-password', NAV);

  await page.getByLabel('New password', { exact: true }).fill(user.newPassword);
  await page.getByLabel('Confirm new password').fill(user.newPassword);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page).toHaveURL('/', NAV);

  // The real assertion: the new password works and the old one does not.
  await page.getByRole('button', { name: 'Sign out' }).first().click();

  await signIn(page, user.email, user.password);
  // The real message, read from the action rather than guessed at — a regex
  // that matched nothing would make this assertion pass for the wrong reason.
  await expect(page.getByText('Those details did not match an account.')).toBeVisible(NAV);

  // **Both fields are refilled, because a failed sign-in clears them.**
  // `AuthForm` is uncontrolled with no `defaultValue`, so the re-render after a
  // rejected attempt empties the form — including the email the reader just
  // typed. Filling only the password submits an empty address and fails
  // validation, which is what this test did on its first run.
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.newPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // **Signing in lands on `/`, not on the profile.** The earlier expectation
  // here was `/${handle}`, copied from the signup flow — which ends at the
  // profile only because claiming a handle redirects there. `signIn` has always
  // gone to the home page.
  //
  // **The URL alone is a weak assertion**, since a rejected sign-in also leaves
  // you on a page. The handle in the header is what proves a session exists.
  await expect(page).toHaveURL('/', NAV);
  await expect(page.getByRole('link', { name: user.handle }).first()).toBeVisible(NAV);
});

test('a reset link cannot be used twice', async ({ page }) => {
  const user = uniqueUser();
  await createAccount(user);

  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(user.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/if that address has an account/i)).toBeVisible(NAV);

  const link = await latestLinkFor(user.email);
  await page.goto(link);
  await expect(page).toHaveURL('/reset-password', NAV);

  // **The session the first visit created is cleared first, and that models the
  // real case rather than working around a failure.** Somebody re-opening an
  // old link days later has no session; keeping this one makes the login page
  // redirect to `/` before the message renders, because it sends signed-in
  // visitors away. The test was asserting against a state no real reader is in.
  //
  // **A signed-in reader following a dead link is therefore sent home in
  // silence.** That is acceptable — they are signed in, which is what the link
  // was for — and it is noted here so the absence of a message is understood
  // rather than rediscovered.
  await page.context().clearCookies();

  // **A recovery code is single-use, and the rejection happens one hop earlier
  // than expected.** Supabase's verify endpoint refuses the token itself and
  // redirects to the Site URL with the reason in a *fragment* — which no server
  // route can read. `LinkErrorRedirect` is what turns that into a sentence.
  await page.goto(link);
  await expect(page).toHaveURL(/\/login\?error=link_/, NAV);
  await expect(page.getByText(/expired or has already been used|could not be read/i)).toBeVisible();
});

test('the reset form is unreachable without a link', async ({ page }) => {
  // No token in the URL and no separate state: the session the link establishes
  // is the only key, so a direct visit has nothing to act on.
  await page.goto('/reset-password');
  await expect(page).toHaveURL(/\/login\?error=link_expired/, NAV);
});
