import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';

/**
 * Reports — Phase 6 slice 3b (`architecture.md` §16.10f).
 *
 * **The shape under test is an absence.** `authenticated` has `insert` on six
 * named columns and `select` on nothing at all, because `product-spec.md` §4.2
 * decided the reporter is never told the outcome. **There is no read policy
 * here**, which is stronger than a correct one and much harder to get subtly
 * wrong — §92 and §94 each found a hole in a policy that looked right.
 *
 * **Asserted in both directions.** A denial proves nothing unless a legitimate
 * insert through the same token succeeds.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

vi.setConfig({ testTimeout: 30_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PERMISSION_DENIED = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
/** `raise_exception` — what `enforce_rate_limit` produces. */
const RAISE_EXCEPTION = 'P0001';

const PASSWORD = 'correct-horse-battery';
const createdUserIds: string[] = [];

let reporter: { id: string; email: string; handle: string };
let subject: { id: string; email: string; handle: string };
let asReporter: SupabaseClient<Database>;
const anon: SupabaseClient<Database> = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let albumId = '';
let reviewId = '';

async function createUser(prefix: string) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `${prefix}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const id = data.user!.id;
  createdUserIds.push(id);
  const handle = `${prefix}_${stamp}`.slice(0, 30);
  const { error: profileError } = await admin.from('profiles').insert({ id, handle });
  if (profileError) throw profileError;
  return { id, email, handle };
}

beforeAll(async () => {
  reporter = await createUser('rep');
  subject = await createUser('sub');

  asReporter = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await asReporter.auth.signInWithPassword({
    email: reporter.email,
    password: PASSWORD,
  });
  if (error) throw error;

  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const { data: album, error: albumError } = await admin
    .from('albums')
    .insert({
      mbid: crypto.randomUUID(),
      title: `Reports ${stamp}`,
      display_credit: 'Someone',
      primary_type: 'album',
    })
    .select('id')
    .single();
  if (albumError) throw albumError;
  albumId = album.id;

  const { data: entry, error: entryError } = await admin
    .from('collection_entries')
    .insert({ user_id: subject.id, album_id: albumId })
    .select('id')
    .single();
  if (entryError) throw entryError;

  const { data: review, error: reviewError } = await admin
    .from('reviews')
    .insert({ collection_entry_id: entry.id, body: 'A review somebody reports.' })
    .select('id')
    .single();
  if (reviewError) throw reviewError;
  reviewId = review.id;
});

afterAll(async () => {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
  await admin.from('albums').delete().eq('id', albumId);
});

describe('filing a report', () => {
  it('a signed-in user can report a review', async () => {
    // The positive direction, without which every denial below is vacuous.
    const { error } = await asReporter
      .from('reports')
      .insert({ reporter_id: reporter.id, review_id: reviewId, reason: 'spam' });
    expect(error).toBeNull();
  });

  it('refuses a second open report about the same thing', async () => {
    const { error } = await asReporter
      .from('reports')
      .insert({ reporter_id: reporter.id, review_id: reviewId, reason: 'harassment' });
    // Rendered as "you have already reported this" — which leaks nothing,
    // because the reporter knows what they did. §16.10f.
    expect(error?.code).toBe(UNIQUE_VIOLATION);
  });

  it('refuses a report filed in somebody else’s name', async () => {
    const { error } = await asReporter
      .from('reports')
      .insert({ reporter_id: subject.id, review_id: reviewId, reason: 'spam' });
    expect(error).not.toBeNull();
  });

  it('refuses free text on any reason but “other”', async () => {
    const { error } = await asReporter.from('reports').insert({
      reporter_id: reporter.id,
      subject_user_id: subject.id,
      reason: 'spam',
      detail: 'words that do not belong here',
    });
    // **The database holds this line, not the form.** `product-spec.md` §7
    // defers comments as the largest moderation liability in the product.
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it('accepts free text on “other”', async () => {
    const { error } = await asReporter.from('reports').insert({
      reporter_id: reporter.id,
      subject_user_id: subject.id,
      reason: 'other',
      detail: 'something specific',
    });
    expect(error).toBeNull();
  });

  it('refuses reporting yourself', async () => {
    const { error } = await asReporter
      .from('reports')
      .insert({ reporter_id: reporter.id, subject_user_id: reporter.id, reason: 'spam' });
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it('a signed-out visitor cannot file one', async () => {
    const { error } = await anon
      .from('reports')
      .insert({ reporter_id: reporter.id, review_id: reviewId, reason: 'spam' });
    expect(error).not.toBeNull();
  });
});

describe('what a reporter cannot do', () => {
  it('CANNOT read the reports table at all, including their own', async () => {
    // **The assertion this file exists for.** There is no read policy, so this
    // fails on privileges rather than matching no rows — and the distinction
    // matters: a policy returning zero rows would silently start returning
    // some if it were ever loosened.
    const { error } = await asReporter.from('reports').select('id');
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it('cannot set the state of a report it files', async () => {
    const { error } = await asReporter.from('reports').insert({
      reporter_id: reporter.id,
      review_id: reviewId,
      reason: 'illegal',
      state: 'resolved',
    });
    // `state` is in no insert grant, so filing a pre-resolved report is
    // refused on privileges rather than quietly accepted and ignored.
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it('cannot settle a report', async () => {
    const { error } = await asReporter
      .from('reports')
      .update({ state: 'dismissed' })
      .eq('review_id', reviewId);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it('is stopped by a ceiling before it can flood the queue', async () => {
    // The trigger §96 built, reused unchanged. 20 an hour; this account has
    // already filed some, so the loop needs no more than the remainder.
    let limited: string | undefined;
    for (let i = 0; i < 30 && !limited; i += 1) {
      const { data: other } = await admin
        .from('albums')
        .insert({
          mbid: crypto.randomUUID(),
          title: `Ceiling ${i}`,
          display_credit: 'x',
          primary_type: 'album',
        })
        .select('id')
        .single();
      const { data: e } = await admin
        .from('collection_entries')
        .insert({ user_id: subject.id, album_id: other!.id })
        .select('id')
        .single();
      const { data: r } = await admin
        .from('reviews')
        .insert({ collection_entry_id: e!.id, body: `body ${i}` })
        .select('id')
        .single();

      const { error } = await asReporter
        .from('reports')
        .insert({ reporter_id: reporter.id, review_id: r!.id, reason: 'spam' });
      if (error?.code === RAISE_EXCEPTION) limited = error.message;
    }
    expect(limited).toContain('longplayr_rate_limited');
  });
});

describe('the queue, through the service role', () => {
  it('sees open reports and the admin can settle one', async () => {
    const { data: open, error } = await admin
      .from('reports')
      .select('id, reason, state')
      .eq('state', 'open')
      .order('created_at', { ascending: true });
    expect(error).toBeNull();
    expect(open!.length).toBeGreaterThan(0);

    const { error: settleError } = await admin
      .from('reports')
      .update({ state: 'dismissed', settled_at: new Date().toISOString() })
      .eq('id', open![0].id);
    expect(settleError).toBeNull();
  });

  it('a settled report no longer blocks a new one about the same thing', async () => {
    // The partial index is what makes this true, and it is the reason the
    // uniqueness is partial rather than absolute.
    //
    // **A fresh reporter, and the reason is a trap worth recording.** The first
    // version reused `reporter`, which the ceiling case above had already taken
    // to its 20-per-hour limit — and it failed through the **service-role**
    // client, because `enforce_rate_limit` is a BEFORE INSERT trigger and
    // **service_role bypasses RLS, not triggers.** The ceiling counts the actor
    // column whoever performs the write.
    const fresh = await createUser('fresh');

    await admin
      .from('reports')
      .update({ state: 'dismissed', settled_at: new Date().toISOString() })
      .eq('review_id', reviewId);

    const { error } = await admin
      .from('reports')
      .insert({ reporter_id: fresh.id, review_id: reviewId, reason: 'illegal' });
    expect(error).toBeNull();
  });
});
