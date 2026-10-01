import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * A moderated person is told why — Phase 6 slice 3a.
 *
 * **This layer is the only one that can prove the obligation is discharged.**
 * `tests/integration/moderation-statements.test.ts` proves the record is
 * written, scoped and privilege-bounded. It cannot prove **the person is
 * informed**, and DSA Art 17 requires informing rather than recording — a
 * statement nobody is shown discharges nothing. `architecture.md` §16.10.
 *
 * **So the assertion that earns its place is the banner.** It is rendered from
 * the root layout on every page, and that it appears for the subject and for
 * nobody else is a property of two separate mechanisms — the RLS policy and the
 * per-request count — which only a browser sees combined.
 *
 * **What is deliberately not proved here.** That the acting administrator's
 * identity is unreachable is a column grant, asserted where it can be asserted:
 * a query that returns `42501`. A browser cannot see a column that was never
 * sent, so testing it here would look like coverage and be none.
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
  const email = `e2e-notice-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const id = data.user!.id;
  createdUserIds.push(id);

  const handle = `e2enotice_${stamp}`.slice(0, 30);
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
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
});

test('a suspended account is told why, and can reach the policy from the notice', async ({
  page,
}) => {
  const admin = adminClient();
  const moderator = await createAccount(admin, true);
  const subject = await createAccount(admin);

  const { error } = await admin.rpc('moderate_account', {
    p_actor_id: moderator.id,
    p_target_id: subject.id,
    p_status: 'suspended',
    p_ground: 'repeated violations of the policy',
    p_statement: 'Your account is suspended because of repeated reports.',
  });
  expect(error).toBeNull();

  await signIn(page, subject);

  // **The banner, on an ordinary page.** Not on `/notices` — the point is that
  // it finds the person rather than waiting to be found.
  const banner = page.getByRole('status').filter({ hasText: 'moderation decision' });
  await expect(banner).toBeVisible(NAV);

  // Arrival, not link presence.
  await banner.getByRole('link', { name: 'Read why' }).click();
  await expect(page).toHaveURL('/notices', NAV);

  await expect(page.getByText('repeated reports')).toBeVisible();
  await expect(page.getByText('repeated violations of the policy')).toBeVisible();

  // Redress — Art 17 wants the person told how to dispute it.
  await page.getByRole('link', { name: 'how moderation works' }).click();
  await expect(page).toHaveURL('/moderation', NAV);

  // **Reading clears it.** The banner exists to deliver the person here once.
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'moderation decision' })).toHaveCount(0);
});

test('an unmoderated account sees no banner and an empty notices page', async ({ page }) => {
  // The negative direction. Without it, a banner rendered unconditionally would
  // pass the case above.
  const admin = adminClient();
  const bystander = await createAccount(admin);

  await signIn(page, bystander);
  await expect(page.getByRole('status').filter({ hasText: 'moderation decision' })).toHaveCount(0);

  await page.goto('/notices');
  await expect(page.getByRole('heading', { name: 'Notices' })).toBeVisible(NAV);
  await expect(page.getByText('there have been none')).toBeVisible();
});

test('a signed-out visitor is sent to sign in', async ({ page }) => {
  await page.goto('/notices');
  await expect(page).toHaveURL(/\/login/, NAV);
});
