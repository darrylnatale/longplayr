import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * Filing a report, and acting on it — Phase 6 slice 3b.
 *
 * **What only a browser can establish here** is that the control appears for
 * the right person and not the wrong one, and that a filed report reaches the
 * queue. `tests/integration/reports.test.ts` proves the privileges — including
 * that a reporter cannot read the table at all — and a browser cannot see a
 * column that was never sent.
 *
 * **The negative case is the one that would be missed.** A control rendered
 * unconditionally would satisfy the positive assertion alone, and `reports` has
 * a check constraint refusing self-reports precisely because the UI is not the
 * thing that should be relied on for it.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

const NAV = { timeout: 15_000 };
const PASSWORD = 'correct-horse-battery';
const createdUserIds: string[] = [];

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function createAccount(admin: SupabaseClient, isAdmin = false) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `e2e-report-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const id = data.user!.id;
  createdUserIds.push(id);
  const handle = `e2erep_${stamp}`.slice(0, 30);
  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id, handle, is_admin: isAdmin });
  if (profileError) throw profileError;
  return { id, email, handle };
}

async function signIn(page: Page, account: { email: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/', NAV);
}

test.afterAll(async () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const admin = adminClient();
  await admin.from('reports').delete().in('reporter_id', createdUserIds);
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
});

test('an account can be reported, and the report reaches the queue', async ({ page }) => {
  const admin = adminClient();
  const moderator = await createAccount(admin, true);
  const reporter = await createAccount(admin);
  const subject = await createAccount(admin);

  await signIn(page, reporter);
  await page.goto(`/${subject.handle}`);

  const control = page.getByRole('group').filter({ hasText: 'Report this account' });
  await expect(control).toBeVisible(NAV);
  await control.getByText('Report this account').click();
  await control.getByLabel('Reason').selectOption('spam');
  await control.getByRole('button', { name: 'Report' }).click();

  // **It says what will and will not happen**, rather than thanking the person
  // in a way that implies a process — `product-spec.md` §4.2.
  await expect(page.getByText('you will not be told the outcome')).toBeVisible(NAV);

  // **Cookies cleared before signing in as somebody else.** `/login` redirects
  // an already-signed-in visitor away, so reusing the session leaves no Email
  // field to fill and the failure reads as a missing selector.
  await page.context().clearCookies();
  await signIn(page, moderator);
  await page.goto('/admin');

  await expect(page.getByRole('heading', { name: 'Open reports' })).toBeVisible(NAV);
  await expect(page.getByText(`@${subject.handle}`).first()).toBeVisible();
  await expect(page.getByText('Spam or advertising')).toBeVisible();

  // **Dismissing clears it from the queue, and that is what is asserted.** The
  // action also returns a confirmation, but it revalidates `/admin` in the same
  // breath — so the row unmounts and the message is a flash rather than a
  // state. Asserting the flash would be asserting a race.
  await page.getByRole('button', { name: 'Dismiss' }).first().click();
  await expect(page.getByText('Spam or advertising')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Open reports' })).toBeVisible();
});

test('you cannot report your own profile', async ({ page }) => {
  // The negative direction. The schema refuses a self-report anyway, so this
  // asserts the surface is honest rather than that the rule is enforced.
  const admin = adminClient();
  const account = await createAccount(admin);

  await signIn(page, account);
  await page.goto(`/${account.handle}`);

  await expect(page.getByText('Report this account')).toHaveCount(0);
});

test('a signed-out visitor is offered no report control', async ({ page }) => {
  const admin = adminClient();
  const account = await createAccount(admin);

  await page.goto(`/${account.handle}`);
  // **The `h1` is `display_name ?? handle`, with no `@`.** The `@handle` line
  // renders only when a display name differs from it, and these fixtures set
  // none — read from the page source rather than assumed.
  await expect(page.getByRole('heading', { name: account.handle }).first()).toBeVisible(NAV);
  await expect(page.getByText('Report this account')).toHaveCount(0);
});
