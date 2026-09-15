import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * Notifications, end to end.
 *
 * **The subject is the read path and the per-item read interaction**, so those
 * are what run through the browser. One account signs up through the UI because
 * a real session is what the route's guards and the recipient-scoped RLS act on;
 * the second account is built through the API, the pattern `follows.spec.ts`
 * established.
 *
 * **The notification rows are written by statements that replicate the service
 * layer, and that is a limitation rather than a shortcut.** The services build a
 * cookie-bound client and cannot be called from Node. **This file therefore
 * proves that notifications render, clear and paginate — not that following
 * someone writes one.** That half has its own coverage in
 * `tests/integration/notifications.test.ts`, and the division is deliberate.
 *
 * **Relative times are not asserted**, for the reason `feed.spec.ts` records:
 * the formatter has unit tests with an injected clock, and asserting "1m" here
 * would be a timing-dependent assertion.
 *
 * Accounts are cleaned up afterwards. Deleting the auth user cascades to the
 * profile and from there to follows, likes and notifications.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

const NAV = { timeout: 15_000 };

const IN_RAINBOWS = '0b0e4f1e-1111-4000-8000-000000000001';

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-notif-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2ent_${id}`.slice(0, 30),
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
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByLabel('Confirm password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL('/onboarding', NAV);
  await page.getByLabel('Handle').fill(user.handle);
  await page.getByRole('button', { name: 'Claim handle' }).click();
  await expect(page).toHaveURL(`/${user.handle}`, NAV);

  return user;
}

/** A second account, built through the API. It asserts its own postconditions. */
async function createAccount(displayName?: string) {
  const user = uniqueUser();
  createdEmails.push(user.email);

  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (error) throw error;

  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id: data.user!.id, handle: user.handle, display_name: displayName ?? null });
  if (profileError) throw profileError;

  const { data: written } = await admin
    .from('profiles')
    .select('handle')
    .eq('id', data.user!.id)
    .single();
  expect(written?.handle).toBe(user.handle);

  return { ...user, id: data.user!.id };
}

async function profileIdFor(handle: string): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin.from('profiles').select('id').eq('handle', handle).single();
  if (error) throw error;
  return data!.id as string;
}

/**
 * A follow and its notification, as the service performs them.
 *
 * The notification insert carries no `.select()`, exactly as the service has
 * none: the read policy is recipient-scoped, so an actor cannot read back the
 * row they wrote.
 */
async function followAndNotify(actorId: string, recipientId: string) {
  const admin = adminClient();
  const { data: follow, error } = await admin
    .from('follows')
    .insert({ follower_id: actorId, followee_id: recipientId })
    .select()
    .single();
  if (error) throw error;

  const { error: notifyError } = await admin.from('notifications').insert({
    recipient_id: recipientId,
    actor_id: actorId,
    type: 'followed',
    follow_id: follow!.id,
  });
  if (notifyError) throw notifyError;
}

/** A review by the recipient, liked by the actor, and the notification for it. */
async function likeReviewAndNotify(actorId: string, recipientId: string) {
  const admin = adminClient();

  const { data: album } = await admin.from('albums').select('id').eq('mbid', IN_RAINBOWS).single();

  const { data: entry, error: entryError } = await admin.rpc('ensure_collection_entry', {
    p_user_id: recipientId,
    p_album_id: album!.id as string,
  });
  if (entryError) throw entryError;

  const { data: review, error: reviewError } = await admin
    .from('reviews')
    .insert({
      collection_entry_id: (entry as unknown as { id: string }).id,
      body: 'A considered paragraph about this record.',
    })
    .select()
    .single();
  if (reviewError) throw reviewError;

  const { data: like, error: likeError } = await admin
    .from('review_likes')
    .insert({ user_id: actorId, review_id: review!.id })
    .select()
    .single();
  if (likeError) throw likeError;

  const { error: notifyError } = await admin.from('notifications').insert({
    recipient_id: recipientId,
    actor_id: actorId,
    type: 'review_liked',
    review_like_id: like!.id,
  });
  if (notifyError) throw notifyError;
}

test('signed out, notifications sends you to sign in', async ({ page }) => {
  await page.goto('/notifications');
  await expect(page).toHaveURL(/\/login/, NAV);
});

test('an account with nothing directed at it sees the empty state', async ({ page }) => {
  await signUp(page);

  await page.goto('/notifications');
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
});

test('a follow and a review like both arrive, and the badge counts them', async ({ page }) => {
  const me = await signUp(page);
  const myId = await profileIdFor(me.handle);
  const follower = await createAccount('Nadia Okonkwo');
  const liker = await createAccount('Sam Delacroix');

  await followAndNotify(follower.id, myId);
  await likeReviewAndNotify(liker.id, myId);

  await page.goto('/');
  // The badge is the whole point of the count being in global navigation.
  await expect(page.getByLabel('2 unread')).toBeVisible();

  await page.goto('/notifications');
  await expect(page.getByText('Nadia Okonkwo followed you')).toBeVisible();
  await expect(page.getByText(/Sam Delacroix liked your review of/)).toBeVisible();
});

test('opening one notification clears only that one', async ({ page }) => {
  const me = await signUp(page);
  const myId = await profileIdFor(me.handle);
  const follower = await createAccount('Ida Bergström');
  const liker = await createAccount('Tomas Neves');

  await followAndNotify(follower.id, myId);
  await likeReviewAndNotify(liker.id, myId);

  await page.goto('/notifications');
  await expect(page.getByLabel('2 unread')).toBeVisible();

  // Clicking the follow notification navigates to the follower's profile and
  // clears that row — the redirect route derives the destination from the row
  // rather than accepting one from the URL.
  await page.getByText('Ida Bergström followed you').click();
  await expect(page).toHaveURL(`/${follower.handle}`, NAV);

  await page.goto('/notifications');
  // One left, so the badge dropped by exactly one rather than clearing entirely.
  await expect(page.getByLabel('1 unread')).toBeVisible();
  await expect(page.getByText(/Tomas Neves liked your review of/)).toBeVisible();
});

test('a review-like notification opens the album it was written about', async ({ page }) => {
  const me = await signUp(page);
  const myId = await profileIdFor(me.handle);
  const liker = await createAccount('Yusuf Karim');

  await likeReviewAndNotify(liker.id, myId);

  await page.goto('/notifications');
  await page.getByText(/Yusuf Karim liked your review of/).click();
  await expect(page).toHaveURL(`/albums/${IN_RAINBOWS}`, NAV);
});

test('the list paginates without repeating a notification', async ({ page }) => {
  const me = await signUp(page);
  const myId = await profileIdFor(me.handle);

  // One more than a page, so a second page exists with exactly one row on it.
  const actors = [];
  for (let i = 0; i < 21; i += 1) actors.push(await createAccount(`Follower ${i}`));
  for (const actor of actors) await followAndNotify(actor.id, myId);

  await page.goto('/notifications');
  const firstPage = await page.getByRole('listitem').count();
  expect(firstPage).toBe(20);

  await page.getByRole('link', { name: /Older/ }).click();
  await expect(page).toHaveURL(/before=/, NAV);
  const secondPage = await page.getByRole('listitem').count();
  expect(secondPage).toBe(1);
});

/**
 * The mobile route in, and the reason these tests set a viewport at all.
 *
 * The header's notifications link lives in a `hidden md:flex` container and the
 * tab bar has four locked tabs, so below 768px the unread dot on "You" pointed
 * at a destination with no way to reach it. 390x844 follows the precedent in
 * `collection.spec.ts`; the profile link is always addressed through `main`,
 * because the header's own link stays in the DOM at every width and would
 * otherwise satisfy the same accessible name.
 */
const PHONE = { width: 390, height: 844 };

/** The profile's own notifications link, never the header's. */
const profileNotificationsLink = (page: Page) =>
  page.getByRole('main').getByRole('link', { name: 'Notifications' });

test('at phone width the owner reaches notifications from their own profile', async ({ page }) => {
  await page.setViewportSize(PHONE);

  const me = await signUp(page);
  await page.goto(`/${me.handle}`);

  // The header route is genuinely gone at this width — not merely unused. This
  // is what makes the click below load-bearing rather than incidental.
  await expect(page.getByRole('banner').getByRole('link', { name: 'Notifications' })).toBeHidden();

  await profileNotificationsLink(page).click();

  await expect(page).toHaveURL('/notifications', NAV);
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
});

test('at phone width a visitor sees no notifications link on someone else’s profile', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);

  const other = await createAccount('Nadia Okonkwo');
  await signUp(page);

  await page.goto(`/${other.handle}`);

  // Signed in, but not the owner: the gate is ownership, not authentication.
  await expect(profileNotificationsLink(page)).toHaveCount(0);
});

test('at phone width a signed-out visitor sees no notifications link', async ({ page }) => {
  await page.setViewportSize(PHONE);

  const owner = await createAccount('Sam Delacroix');

  await page.goto(`/${owner.handle}`);

  await expect(profileNotificationsLink(page)).toHaveCount(0);
});

test('at desktop width both routes are present and the header one still shows', async ({
  page,
}) => {
  const me = await signUp(page);
  await page.goto(`/${me.handle}`);

  // The header's responsive behaviour is undisturbed by the profile addition —
  // the only way this change could affect desktop. Navigation through the
  // header is deliberately not asserted: this cycle does not change it.
  await expect(page.getByRole('banner').getByRole('link', { name: 'Notifications' })).toBeVisible();
  await expect(profileNotificationsLink(page)).toBeVisible();
});
