import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * Liking someone else's list, end to end.
 *
 * **One account signs up through the browser; the list it reads is created
 * through the API.** The subject is the like control and the notification it
 * produces, not list authoring — that is `lists.spec.ts`'s — and signing both
 * accounts up through the UI would double the slowest operation in the suite to
 * build a fixture (`architecture.md` §12).
 *
 * **This file carries the two rules the database deliberately does not enforce.**
 * The self-like refusal and the owner seeing no control are service and
 * presentation behaviour; `tests/integration/list-likes.test.ts` proves the
 * database admits a self-like, which is precisely why the refusal has to be
 * asserted from the outside.
 *
 * **The toggle is cycled in both directions rather than asserting one
 * transition**, the same reason `review-likes.spec.ts` gives: the surrounding
 * subtree does not change and only the control's own state moves.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

const NAV = { timeout: 15_000 };
const ACTION = { timeout: 30_000 };

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-ll-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2ell_${id}`.slice(0, 30),
  };
}

const createdEmails: string[] = [];

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

test.afterAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || createdEmails.length === 0) return;

  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data?.users ?? []) {
    if (user.email && createdEmails.includes(user.email)) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }
});

async function signUp(page: Page) {
  const user = uniqueUser();
  createdEmails.push(user.email);

  await page.goto('/signup');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL('/onboarding', NAV);
  await page.getByLabel('Handle').fill(user.handle);
  await page.getByRole('button', { name: 'Claim handle' }).click();
  await expect(page).toHaveURL(`/${user.handle}`, NAV);

  return user;
}

/**
 * An account owning one list, created through the API.
 *
 * **It asserts its own postconditions**, the vacuity guard `architecture.md` §12
 * records: a fixture that silently wrote nothing would leave the assertions
 * below comparing an absent control to an absent one and passing.
 */
async function accountWithList(title: string) {
  const user = uniqueUser();
  createdEmails.push(user.email);

  const admin = adminClient();
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (userError) throw userError;

  const id = created.user!.id;
  const { error: profileError } = await admin.from('profiles').insert({ id, handle: user.handle });
  if (profileError) throw profileError;

  const { data: list, error: listError } = await admin
    .from('lists')
    .insert({ user_id: id, title })
    .select('id')
    .single();
  if (listError) throw listError;
  if (!list?.id) throw new Error('fixture list was not created');

  return { ...user, id, listId: list.id as string };
}

test('a signed-in reader likes and unlikes someone else’s list, and the count follows', async ({
  page,
}) => {
  const owner = await accountWithList(`Owner list ${Date.now()}`);
  await signUp(page);

  await page.goto(`/lists/${owner.listId}`);
  await expect(page.getByTestId('list-like-count')).toHaveText('0 likes');

  await page.getByRole('button', { name: 'Like' }).click();
  await expect(page.getByTestId('list-like-count')).toHaveText('1 like', ACTION);
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible();

  await page.getByRole('button', { name: 'Liked' }).click();
  await expect(page.getByTestId('list-like-count')).toHaveText('0 likes', ACTION);
  await expect(page.getByRole('button', { name: 'Like' })).toBeVisible();
});

test('the like reaches the owner as a notification that opens the list', async ({ page }) => {
  const owner = await accountWithList(`Notified list ${Date.now()}`);
  await signUp(page);

  await page.goto(`/lists/${owner.listId}`);
  await page.getByRole('button', { name: 'Like' }).click();
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible(ACTION);

  // Sign out, then in as the owner, to read what was directed at them.
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible(NAV);
  await page.goto('/login');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/', NAV);

  await page.goto('/notifications');
  const item = page.getByText('liked your list', { exact: false });
  await expect(item).toBeVisible(ACTION);

  await item.click();
  await expect(page).toHaveURL(`/lists/${owner.listId}`, NAV);
});

test('unliking removes the notification it created', async ({ page }) => {
  const owner = await accountWithList(`Undone list ${Date.now()}`);
  await signUp(page);

  await page.goto(`/lists/${owner.listId}`);
  await page.getByRole('button', { name: 'Like' }).click();
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible(ACTION);
  await page.getByRole('button', { name: 'Liked' }).click();
  await expect(page.getByRole('button', { name: 'Like' })).toBeVisible(ACTION);

  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible(NAV);
  await page.goto('/login');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/', NAV);

  await page.goto('/notifications');
  await expect(page.getByText('liked your list', { exact: false })).toHaveCount(0);
});

test('the owner is offered no like control on their own list', async ({ page }) => {
  const owner = await accountWithList(`Own list ${Date.now()}`);

  await page.goto('/login');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/', NAV);

  await page.goto(`/lists/${owner.listId}`);

  // The count is still theirs to see; the control is not. The database would
  // accept a self-like, so this is the boundary that actually prevents one.
  await expect(page.getByTestId('list-like-count')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Like' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Liked' })).toHaveCount(0);
});

test('a signed-out visitor sees the count and no control', async ({ page }) => {
  const owner = await accountWithList(`Public list ${Date.now()}`);

  await page.goto(`/lists/${owner.listId}`);

  // `product-spec.md` §6 specifies the count unconditionally; the control
  // follows the review-like convention and is signed-in only.
  await expect(page.getByTestId('list-like-count')).toHaveText('0 likes');
  await expect(page.getByRole('button', { name: 'Like' })).toHaveCount(0);
});
