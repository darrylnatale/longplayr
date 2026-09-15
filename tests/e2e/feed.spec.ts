import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * The following feed, end to end.
 *
 * **The subject is the read path**, so it is the only thing driven through the
 * browser. One account signs up through the UI because a real session is what
 * the route's guards act on; the two accounts it looks at are built through the
 * API, which is the pattern `follows.spec.ts` established and the cost
 * `architecture.md` §12 records as avoidable.
 *
 * **The activity rows are written by statements that replicate the service
 * layer, and that is a real limitation rather than a shortcut.** The services
 * build a cookie-bound client and cannot be called from Node, so this file
 * cannot exercise them. **It therefore proves that the feed renders events, not
 * that the application writes them** — the write path has its own 21 tests in
 * `tests/integration/activity.test.ts`, and that division is deliberate.
 *
 * **Relative times are not asserted.** The formatter has exhaustive unit tests
 * with an injected clock; asserting "1m" here would be a timing-dependent
 * assertion, which is the class of flake this suite already carries three open
 * items about. Identity, order and tier are asserted instead.
 *
 * Accounts are cleaned up afterwards. Deleting the auth user cascades to the
 * profile and from there to follows, entries and activity.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

const NAV = { timeout: 15_000 };

const IN_RAINBOWS = '0b0e4f1e-1111-4000-8000-000000000001';
const WATCH_THE_THRONE = '0b0e4f1e-1111-4000-8000-000000000002';

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-feed-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2efd_${id}`.slice(0, 30),
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

/**
 * A second account, built through the API.
 *
 * **It asserts its own postconditions.** An API fixture that silently wrote
 * nothing would leave the assertions below comparing an empty feed to an empty
 * feed and passing — the vacuity `architecture.md` §12 records from the first
 * fixture conversion.
 */
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
    .select('id, handle')
    .eq('id', data.user!.id)
    .single();
  expect(written?.handle).toBe(user.handle);

  return { ...user, id: data.user!.id };
}

async function albumIds(): Promise<Map<string, string>> {
  const admin = adminClient();
  const { data, error } = await admin
    .from('albums')
    .select('id, mbid')
    .in('mbid', [IN_RAINBOWS, WATCH_THE_THRONE]);
  if (error) throw error;
  return new Map((data ?? []).map((a) => [a.mbid as string, a.id as string]));
}

/** The follow row. The control itself is `follows.spec.ts`'s subject, not this file's. */
async function follow(followerId: string, followeeId: string) {
  const admin = adminClient();
  const { error } = await admin
    .from('follows')
    .insert({ follower_id: followerId, followee_id: followeeId });
  if (error) throw error;
}

/**
 * All four event types for one account.
 *
 * **These statements replicate the service layer; they do not call it.** Each
 * pair below is what the corresponding service performs — `ensure_collection_entry`
 * followed by the activity row — and the entry creation genuinely goes through
 * the same RPC the application uses, so the collection state is the product's
 * own rather than an approximation of it.
 */
/** `createList`'s two statements: insert the list, then record the event. */
async function createList(userId: string, title: string): Promise<string> {
  const admin = adminClient();

  const { data, error } = await admin
    .from('lists')
    .insert({ user_id: userId, title })
    .select('id')
    .single();
  if (error) throw error;

  const { error: eventError } = await admin
    .from('activity')
    .insert({ actor_id: userId, type: 'list_created', list_id: data.id });
  if (eventError) throw eventError;

  return data.id as string;
}

async function fourEvents(userId: string) {
  const admin = adminClient();
  const ids = await albumIds();
  const a = ids.get(IN_RAINBOWS)!;
  const b = ids.get(WATCH_THE_THRONE)!;

  const ensure = async (albumId: string) => {
    const { data, error } = await admin.rpc('ensure_collection_entry', {
      p_user_id: userId,
      p_album_id: albumId,
      p_listened_on: null,
    });
    if (error) throw error;
    return data as { id: string };
  };

  // addToCollection: ensure, then the listened event.
  const entryA = await ensure(a);
  await admin
    .from('activity')
    .insert({ actor_id: userId, type: 'listened', collection_entry_id: entryA.id });

  // rateAlbum: ensure, update the rating, then the rated event.
  const entryB = await ensure(b);
  await admin.from('collection_entries').update({ rating: 9.6 }).eq('id', entryB.id);
  await admin
    .from('activity')
    .insert({ actor_id: userId, type: 'rated', collection_entry_id: entryB.id });

  // markRelisten: ensure, insert the relisten, then the relistened event.
  const { data: relisten } = await admin
    .from('relisten_events')
    .insert({ collection_entry_id: entryA.id })
    .select()
    .single();
  await admin
    .from('activity')
    .insert({ actor_id: userId, type: 'relistened', relisten_event_id: relisten!.id });

  // saveReview: ensure, insert the review, then the reviewed event.
  const { data: review } = await admin
    .from('reviews')
    .insert({
      collection_entry_id: entryB.id,
      body: 'The maximalism never tips into noise, which is the trick of it.',
    })
    .select()
    .single();
  await admin
    .from('activity')
    .insert({ actor_id: userId, type: 'reviewed', review_id: review!.id });

  // Postconditions, so a silent failure cannot pass as an empty feed.
  // Scoped with `list_id is null` to the four events this helper actually
  // writes. A `list_created` event from the same actor is somebody else's
  // postcondition, and asserting over it would make this helper fail for a
  // reason that has nothing to do with what it did.
  const { data: written } = await admin
    .from('activity')
    .select('type')
    .eq('actor_id', userId)
    .is('list_id', null);
  expect((written ?? []).map((r) => r.type).sort()).toEqual([
    'listened',
    'rated',
    'relistened',
    'reviewed',
  ]);
}

test('signed out, the feed sends you to sign in', async ({ page }) => {
  await page.goto('/feed');
  await expect(page).toHaveURL('/login', NAV);
});

test('the feed distinguishes following nobody from following quiet people', async ({ page }) => {
  const quiet = await createAccount('Quiet Account');
  const me = await signUp(page);

  const admin = adminClient();
  const { data: mine } = await admin.from('profiles').select('id').eq('handle', me.handle).single();

  // Following nobody.
  await page.goto('/feed');
  await expect(page.getByText('You aren’t following anyone yet.')).toBeVisible();

  // Following someone who has done nothing. A different fact, and it says so.
  await follow(mine!.id, quiet.id);
  await page.goto('/feed');
  await expect(page.getByText('Nobody you follow has done anything yet.')).toBeVisible();
  await expect(page.getByText('You aren’t following anyone yet.')).toHaveCount(0);
});

test('all five event types appear, and a silent backfill adds nothing', async ({ page }) => {
  const actor = await createAccount('Nadia Okonkwo');
  const me = await signUp(page);

  const admin = adminClient();
  const { data: mine } = await admin.from('profiles').select('id').eq('handle', me.handle).single();

  await follow(mine!.id, actor.id);

  // **Phase 4's definition of done, in one line**: a followed account creates a
  // list, and the follower sees its creation in their feed. Written before the
  // four album events so the review still lands last and the newest-first
  // assertion below keeps testing what it always did.
  const listId = await createList(actor.id, 'Long drive records');

  await fourEvents(actor.id);

  await page.goto('/feed');

  // Scoped to the feed's own list. The mobile tab bar is also a <ul> of <li>,
  // and an unscoped listitem count would silently include it.
  const list = page.getByRole('list', { name: 'Feed' });
  const items = list.getByRole('listitem');
  await expect(items).toHaveCount(5);

  // The compact tier. "added … to their collection", never "listened to" — a
  // collection is not a diary.
  await expect(list).toContainText('added');
  await expect(list).toContainText('to their collection');
  await expect(list).toContainText('relistened to');
  await expect(list).toContainText('rated');

  // The full tier carries the excerpt; the compact ones do not.
  await expect(list).toContainText('The maximalism never tips into noise');

  // Newest first: the review was written last, so it leads.
  await expect(items.first()).toContainText('reviewed');

  // A relisten never advertises a count, so no ×N marker reaches the feed.
  await expect(list).not.toContainText('×');

  // **The list event, and it links through to the list itself.**
  await expect(list).toContainText('made a list');
  await expect(list.getByRole('link', { name: 'Long drive records' })).toHaveAttribute(
    'href',
    `/lists/${listId}`,
  );

  // **The anti-flood half.** Forty entries through the creation path — what an
  // import or backfill uses — generate nothing, so the feed is unchanged.
  const ids = await albumIds();
  for (let i = 0; i < 40; i++) {
    const { error } = await admin.rpc('ensure_collection_entry', {
      p_user_id: actor.id,
      p_album_id: ids.get(i % 2 === 0 ? IN_RAINBOWS : WATCH_THE_THRONE)!,
      p_listened_on: null,
    });
    if (error) throw error;
  }

  await page.goto('/feed');
  await expect(page.getByRole('list', { name: 'Feed' }).getByRole('listitem')).toHaveCount(5);

  /**
   * **Running out of feed is not an empty feed.**
   *
   * Appended to this test rather than given its own, deliberately: it needs an
   * account that follows someone with a non-empty feed, which is exactly what
   * the fixture above has already built. A fourth test would rebuild two
   * accounts and a signup to assert three lines, and fixture cost is the
   * dominant cost in this suite (`architecture.md` §12).
   *
   * The cursor is an epoch one rather than a real one paged to: nothing predates
   * 1970, so it returns zero rows deterministically without a lookup, and it is
   * also the stale-or-shared-cursor case in the same navigation.
   */
  await page.goto(
    '/feed?before=1970-01-01T00:00:00.000Z&before_id=00000000-0000-0000-0000-000000000000',
  );

  await expect(page.getByText("You've reached the end of your feed.")).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to top' })).toHaveAttribute('href', '/feed');

  // Neither empty-feed state belongs here. The feed is not empty — the reader has
  // reached the end of it — and saying otherwise is the defect this pins.
  await expect(page.getByText('Nobody you follow has done anything yet.')).toHaveCount(0);
  await expect(page.getByText('You aren’t following anyone yet.')).toHaveCount(0);
});
