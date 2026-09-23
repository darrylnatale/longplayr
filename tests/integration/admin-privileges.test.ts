import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';

/**
 * What a user's own token can and cannot reach (`architecture.md` §14.1).
 *
 * **This is the security half of Phase 6 slice 2, and the reason it exists.**
 * §91 made `status` mean something on every read path; it did not make it
 * stick. `profiles` granted `update` at **table level**, and
 * `profiles_update_own` permits any update to your own row — so a suspended
 * account holding its own token could `PATCH {"status":"active"}` onto itself.
 * The same shape let an author restore their own removed review or list.
 *
 * **RLS answers *which rows*; it never answers *which columns*.** That is the
 * defect in one line, and why the fix is column-level grants rather than
 * another policy.
 *
 * **Every case is asserted in both directions.** A denial proves nothing unless
 * a legitimate write through the same token succeeds — otherwise a grant that
 * denies everything looks identical to one that is correct.
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

const createdUserIds: string[] = [];
const PASSWORD = 'correct-horse-battery';

let user: { id: string; handle: string; email: string };
/** The user's own client, carrying their JWT — not the service role. */
let asUser: SupabaseClient<Database>;
let albumId = '';
let entryId = '';
let reviewId = '';
let listId = '';

/** Postgres `insufficient_privilege`. What a missing column grant returns. */
const PERMISSION_DENIED = '42501';

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

  return { id, handle, email };
}

beforeAll(async () => {
  user = await createUser('priv');

  asUser = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await asUser.auth.signInWithPassword({
    email: user.email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;

  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const { data: album, error: albumError } = await admin
    .from('albums')
    .insert({
      mbid: crypto.randomUUID(),
      title: `Admin Privileges ${stamp}`,
      display_credit: 'Someone',
      primary_type: 'album',
    })
    .select('id')
    .single();
  if (albumError) throw albumError;
  albumId = album.id;

  const { data: entry, error: entryError } = await admin
    .from('collection_entries')
    .insert({ user_id: user.id, album_id: albumId })
    .select('id')
    .single();
  if (entryError) throw entryError;
  entryId = entry.id;

  const { data: review, error: reviewError } = await admin
    .from('reviews')
    .insert({
      collection_entry_id: entryId,
      body: 'A review its author must not be able to restore.',
    })
    .select('id')
    .single();
  if (reviewError) throw reviewError;
  reviewId = review.id;

  const { data: list, error: listError } = await admin
    .from('lists')
    .insert({ user_id: user.id, title: `Admin Privileges List ${stamp}` })
    .select('id')
    .single();
  if (listError) throw listError;
  listId = list.id;
});

afterAll(async () => {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
  await admin.from('albums').delete().eq('id', albumId);
});

describe('a user’s own token can still do what it should', () => {
  // Without these, a grant that denies everything would pass the denials below.
  it('edits its own profile fields', async () => {
    const { error } = await asUser
      .from('profiles')
      .update({ display_name: 'Legitimate' })
      .eq('id', user.id);
    expect(error).toBeNull();
  });

  it('rewrites the body of its own review', async () => {
    const { error } = await asUser
      .from('reviews')
      .update({ body: 'Edited by its author, which is allowed.' })
      .eq('id', reviewId);
    expect(error).toBeNull();
  });

  it('saves and then edits its own review, which an upsert makes subtler than it looks', async () => {
    // **The near-miss this case exists for.** `saveReview` is a PostgREST
    // upsert, which compiles to `INSERT … ON CONFLICT DO UPDATE SET …` over
    // every column in the payload — and Postgres checks UPDATE privilege on
    // that SET list whether or not a conflict occurs. Granting `body` alone
    // therefore returned 42501 on the *first* save, not merely on an edit.
    //
    // **No existing test could have caught it**: the review suites use the
    // service-role client, which bypasses grants entirely. Only a real user
    // token sees a column grant at all.
    const { error: first } = await asUser
      .from('reviews')
      .upsert(
        { collection_entry_id: entryId, body: 'First version, written by its author.' },
        { onConflict: 'collection_entry_id' },
      );
    expect(first).toBeNull();

    const { error: edit } = await asUser
      .from('reviews')
      .upsert(
        { collection_entry_id: entryId, body: 'Edited version, still by its author.' },
        { onConflict: 'collection_entry_id' },
      );
    expect(edit).toBeNull();
  });

  it('renames its own list', async () => {
    const { error } = await asUser
      .from('lists')
      .update({ title: 'Renamed by its author, which is allowed.' })
      .eq('id', listId);
    expect(error).toBeNull();
  });
});

describe('a user’s own token cannot reach moderation columns', () => {
  it('cannot set its own account status', async () => {
    // The defect this slice closes: a suspended account could reinstate itself.
    const { error } = await asUser.from('profiles').update({ status: 'active' }).eq('id', user.id);

    expect(error).not.toBeNull();
    expect(error!.code).toBe(PERMISSION_DENIED);
  });

  it('cannot promote itself to admin', async () => {
    const { error } = await asUser.from('profiles').update({ is_admin: true }).eq('id', user.id);

    expect(error).not.toBeNull();
    expect(error!.code).toBe(PERMISSION_DENIED);
  });

  it('cannot restore its own removed review', async () => {
    await admin.from('reviews').update({ status: 'removed' }).eq('id', reviewId);

    const { error } = await asUser.from('reviews').update({ status: 'live' }).eq('id', reviewId);
    expect(error).not.toBeNull();
    expect(error!.code).toBe(PERMISSION_DENIED);

    const { data } = await admin.from('reviews').select('status').eq('id', reviewId).single();
    expect(data!.status).toBe('removed');
  });

  it('cannot restore its own removed list', async () => {
    await admin.from('lists').update({ status: 'removed' }).eq('id', listId);

    const { error } = await asUser.from('lists').update({ status: 'live' }).eq('id', listId);
    expect(error).not.toBeNull();
    expect(error!.code).toBe(PERMISSION_DENIED);

    const { data } = await admin.from('lists').select('status').eq('id', listId).single();
    expect(data!.status).toBe('removed');
  });

  it('cannot set another account’s status either', async () => {
    // Row scoping was never the hole — column scoping was — so this passes
    // before and after the fix. It is asserted so a future widening of the
    // column grant cannot quietly reopen the row question as well.
    const other = await createUser('priv2');
    const { error } = await asUser.from('profiles').update({ status: 'banned' }).eq('id', other.id);
    expect(error).not.toBeNull();
  });
});

describe('is_admin defaults to false', () => {
  it('gives a new account no privilege', async () => {
    // A default of true, or a nullable column read as truthy, would hand
    // moderation to everyone who signed up.
    const { data, error } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();
    if (error) throw error;
    expect(data.is_admin).toBe(false);
  });
});
