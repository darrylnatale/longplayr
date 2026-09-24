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

async function signUp(page: Page, user: ReturnType<typeof uniqueUser>) {
  createdEmails.push(user.email);

  await page.goto('/signup');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByLabel('Confirm password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL('/onboarding', NAV);
  await page.getByLabel('Handle').fill(user.handle);
  await page.getByRole('button', { name: 'Claim handle' }).click();
  await expect(page).toHaveURL(`/${user.handle}`, NAV);
}

test.afterAll(async () => {
  for (const email of createdEmails) {
    const { data } = await admin.auth.admin.listUsers();
    const found = data?.users.find((u) => u.email === email);
    if (found) await admin.auth.admin.deleteUser(found.id).catch(() => undefined);
  }
});

test('a forgotten password can be reset from the emailed link', async ({ page }) => {
  const user = uniqueUser();
  await signUp(page, user);

  // Sign out, so nothing below succeeds merely because a session survived.
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page).toHaveURL('/', NAV);

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

  await page.getByLabel('New password').fill(user.newPassword);
  await page.getByLabel('Confirm new password').fill(user.newPassword);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page).toHaveURL('/', NAV);

  // The real assertion: the new password works and the old one does not.
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The real message, read from the action rather than guessed at — a regex
  // that matched nothing would make this assertion pass for the wrong reason.
  await expect(page.getByText('Those details did not match an account.')).toBeVisible(NAV);

  await page.getByLabel('Password', { exact: true }).fill(user.newPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`/${user.handle}`, NAV);
});

test('a reset link cannot be used twice', async ({ page }) => {
  const user = uniqueUser();
  await signUp(page, user);
  await page.getByRole('button', { name: 'Sign out' }).first().click();

  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(user.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/if that address has an account/i)).toBeVisible(NAV);

  const link = await latestLinkFor(user.email);
  await page.goto(link);
  await expect(page).toHaveURL('/reset-password', NAV);

  // A recovery code is single-use. Re-following it must land somewhere that
  // tells the reader what to do, not on a form that cannot work.
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
