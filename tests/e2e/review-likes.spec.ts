import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * Liking someone else's review, end to end.
 *
 * **One account signs up through the browser; the review it reads is written
 * through the API.** The subject is the like control, not authoring — that is
 * `collection.spec.ts`'s — and signing both accounts up through the UI would
 * double the slowest operation in the suite to build a fixture
 * (`architecture.md` §12).
 *
 * **The review is written by statements replicating the service layer**, which
 * the entry creation genuinely shares: `ensure_collection_entry` is the same RPC
 * the application calls. This proves the control renders and toggles, **not**
 * that reviews are authored correctly.
 *
 * **The toggle is cycled in both directions rather than asserting one
 * transition.** The like and favourite controls have each shipped stale-state
 * bugs that every integration test passed through, because the surrounding
 * subtree does not change and only the control's own state moves.
 *
 * Accounts are cleaned up afterwards. Deleting the auth user cascades to the
 * profile and from there to reviews and likes alike.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

const NAV = { timeout: 15_000 };
const ACTION = { timeout: 30_000 };

const ALBUM_MBID = '0b0e4f1e-1111-4000-8000-000000000001';

/**
 * A body unique to each test.
 *
 * **Every test in this file reviews the same fixture album**, so reviews from
 * earlier tests are still on the page when later ones run. Locating by a unique
 * body and scoping to that review's own list item makes each test independent of
 * what its predecessors left behind — which is sturdier than cleaning up
 * between them, and it is why the assertions below never count page-wide.
 */
function uniqueBody(): string {
  return `The restraint is what makes it land ${Date.now()}${Math.floor(Math.random() * 1000)}.`;
}

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-rl-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2erl_${id}`.slice(0, 30),
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
 * An account that has written a review of the fixture album.
 *
 * **It asserts its own postconditions.** An API fixture that silently wrote
 * nothing would leave the assertions below comparing an empty review list to an
 * empty one and passing — the vacuity `architecture.md` §12 records from the
 * first fixture conversion.
 */
async function accountWithReview(body: string) {
  const user = uniqueUser();
  createdEmails.push(user.email);

  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (error) throw error;
  const id = data.user!.id;

  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id, handle: user.handle, display_name: 'Nadia Okonkwo' });
  if (profileError) throw profileError;

  const { data: album } = await admin.from('albums').select('id').eq('mbid', ALBUM_MBID).single();

  const { data: entry, error: entryError } = await admin.rpc('ensure_collection_entry', {
    p_user_id: id,
    p_album_id: album!.id,
    p_listened_on: null,
  });
  if (entryError) throw entryError;

  const { error: reviewError } = await admin
    .from('reviews')
    .insert({ collection_entry_id: (entry as { id: string }).id, body });
  if (reviewError) throw reviewError;

  const { data: written } = await admin
    .from('reviews')
    .select('id, body')
    .eq('collection_entry_id', (entry as { id: string }).id)
    .single();
  expect(written?.body).toBe(body);

  return { ...user, id };
}

/**
 * The review's like control, in either state.
 *
 * **Named for the review, not just "Like".** The album's own like control lives
 * in the action card on this same page and carries the same visible word, so an
 * unscoped `name: 'Like'` matches two buttons — which is why the control has a
 * distinct accessible name rather than the test merely working around it.
 */
const reviewItem = (page: Page, body: string) =>
  page.getByRole('listitem').filter({ hasText: body });

const likeButton = (page: Page, body: string) =>
  reviewItem(page, body).getByRole('button', { name: /^(Like|Liked) this review$/ });

test('a signed-in reader likes and unlikes someone else’s review', async ({ page }) => {
  const body = uniqueBody();
  await accountWithReview(body);
  await signUp(page);

  await page.goto(`/albums/${ALBUM_MBID}`);

  // The review is there to be liked, and the control starts unpressed.
  await expect(reviewItem(page, body)).toBeVisible();
  await expect(likeButton(page, body)).toHaveAttribute('aria-pressed', 'false');
  await expect(likeButton(page, body)).toHaveText('Like');

  await likeButton(page, body).click();
  await expect(likeButton(page, body)).toHaveAttribute('aria-pressed', 'true', ACTION);
  await expect(likeButton(page, body)).toHaveText('Liked');

  // Survives a reload — the state is in the database, not in the component.
  await page.reload();
  await expect(likeButton(page, body)).toHaveAttribute('aria-pressed', 'true', ACTION);

  // And back again. Both directions, because only the control's own state moves.
  await likeButton(page, body).click();
  await expect(likeButton(page, body)).toHaveAttribute('aria-pressed', 'false', ACTION);
  await expect(likeButton(page, body)).toHaveText('Like');
});

test('no like count is rendered beside a review', async ({ page }) => {
  const body = uniqueBody();
  await accountWithReview(body);
  await signUp(page);

  await page.goto(`/albums/${ALBUM_MBID}`);
  await likeButton(page, body).click();
  await expect(likeButton(page, body)).toHaveAttribute('aria-pressed', 'true', ACTION);

  // Slice 4 shows your own state and nothing else. Scoped to this review's own
  // item, so a count could not hide behind another review's markup.
  await expect(likeButton(page, body)).toHaveText('Liked');
  await expect(reviewItem(page, body).getByText(/\d+\s+likes?/)).toHaveCount(0);
});

test('the review author is offered no like control on their own review', async ({ page }) => {
  const body = uniqueBody();
  const author = await accountWithReview(body);

  await page.goto('/login');
  await page.getByLabel('Email').fill(author.email);
  await page.getByLabel('Password').fill(author.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/', NAV);

  await page.goto(`/albums/${ALBUM_MBID}`);

  // Their own review is not in the list at all — it has a home in the action
  // card instead — so there is nothing to like and no control to offer. Scoped
  // to their review, because other tests' reviews are on this page too and do
  // carry a control.
  await expect(reviewItem(page, body)).toHaveCount(0);
  await expect(likeButton(page, body)).toHaveCount(0);
});

test('a signed-out visitor sees the review and no control', async ({ page }) => {
  const body = uniqueBody();
  await accountWithReview(body);

  await page.goto(`/albums/${ALBUM_MBID}`);

  await expect(reviewItem(page, body)).toBeVisible();
  await expect(likeButton(page, body)).toHaveCount(0);
});
