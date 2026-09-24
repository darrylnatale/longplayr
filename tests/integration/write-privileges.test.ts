import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';

/**
 * What a user's token may write, table by table (`architecture.md` §14.3).
 *
 * **The companion to `admin-privileges.test.ts`**, which covers the moderation
 * columns §14.1 closed. This covers the deliberate sweep that followed: every
 * remaining table, its grants, its policies, and whether the pair expresses the
 * rule the service layer assumes.
 *
 * **Signed in as a real user, which is the only way any of this is visible.**
 * Every other integration suite uses the service-role client, and that bypasses
 * grants and RLS entirely — so the whole privilege surface was invisible to the
 * test suite as it stood.
 *
 * **Both directions, always.** A denial proves nothing unless the legitimate
 * write through the same token succeeds: a grant that forbids everything looks
 * exactly like one that is correct.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

vi.setConfig({ testTimeout: 30_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = 'correct-horse-battery';

/** Postgres `insufficient_privilege` — a missing column grant. */
const PERMISSION_DENIED = '42501';
/** Postgres `insufficient_privilege` via RLS — a `with check` that refused. */
const RLS_VIOLATION = '42501';

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds: string[] = [];
const createdAlbumIds: string[] = [];

let alice = { id: '', handle: '' };
let bob = { id: '', handle: '' };
let asAlice: SupabaseClient<Database>;
let albumId = '';
let aliceEntryId = '';
let bobReviewId = '';
let aliceFavouriteId = '';

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
  const a = await createUser('wp_alice');
  const b = await createUser('wp_bob');
  alice = { id: a.id, handle: a.handle };
  bob = { id: b.id, handle: b.handle };

  asAlice = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await asAlice.auth.signInWithPassword({
    email: a.email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;

  const { data: album, error: albumError } = await admin
    .from('albums')
    .insert({
      mbid: crypto.randomUUID(),
      title: `Write Privileges ${Date.now()}`,
      display_credit: 'Someone',
      primary_type: 'album',
    })
    .select('id')
    .single();
  if (albumError) throw albumError;
  albumId = album.id;
  createdAlbumIds.push(albumId);

  const { data: aliceEntry } = await admin
    .from('collection_entries')
    .insert({ user_id: alice.id, album_id: albumId })
    .select('id')
    .single();
  aliceEntryId = aliceEntry!.id;

  const { data: bobEntry } = await admin
    .from('collection_entries')
    .insert({ user_id: bob.id, album_id: albumId })
    .select('id')
    .single();
  const { data: bobReview } = await admin
    .from('reviews')
    .insert({ collection_entry_id: bobEntry!.id, body: 'Bob’s review.' })
    .select('id')
    .single();
  bobReviewId = bobReview!.id;

  const { data: favourite } = await admin
    .from('favourite_albums')
    .insert({ user_id: alice.id, album_id: albumId, position: 1 })
    .select('id')
    .single();
  aliceFavouriteId = favourite!.id;
});

afterAll(async () => {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
  if (createdAlbumIds.length) await admin.from('albums').delete().in('id', createdAlbumIds);
});

describe('collection_entries', () => {
  it('lets the owner set a rating and a like', async () => {
    const { error } = await asAlice
      .from('collection_entries')
      .update({ rating: 8, liked: true })
      .eq('id', aliceEntryId);
    expect(error).toBeNull();
  });

  it('refuses to let the owner forge relisten_count', async () => {
    // The column its own migration calls "nothing but arithmetic… no business
    // rule reads it". Three relistens are three rows; the counter is a
    // convenience, and it was writable to anything.
    const { error } = await asAlice
      .from('collection_entries')
      .update({ relisten_count: 9999 })
      .eq('id', aliceEntryId);

    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it('refuses to let the owner backdate added_at', async () => {
    const { error } = await asAlice
      .from('collection_entries')
      .update({ added_at: '1999-01-01T00:00:00Z' })
      .eq('id', aliceEntryId);

    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it('still lets ensure_collection_entry re-add an album already held', async () => {
    // **The §14.1 trap, and the reason `updated_at` is granted.** The function
    // is SECURITY INVOKER and its `on conflict do update set updated_at = …`
    // runs with the caller's privileges — so narrowing the grant without that
    // column would break adding an album you already hold.
    const { error } = await asAlice.rpc('ensure_collection_entry', {
      p_user_id: alice.id,
      p_album_id: albumId,
    });
    expect(error).toBeNull();
  });
});

describe('favourite_albums', () => {
  it('refuses an update, because no update path exists', async () => {
    // Reordering is unbuilt and its interaction model is open (F-001). When it
    // ships it will need a grant on `position` and will fail loudly without
    // one, which is the intended outcome.
    const { error } = await asAlice
      .from('favourite_albums')
      .update({ position: 3 })
      .eq('id', aliceFavouriteId);

    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

describe('activity', () => {
  it('lets a user post an event about their own entry', async () => {
    const { error } = await asAlice
      .from('activity')
      .insert({ actor_id: alice.id, type: 'rated', collection_entry_id: aliceEntryId });
    expect(error).toBeNull();
  });

  it('refuses an event claiming somebody else’s review', async () => {
    // The policy checked `actor_id` and nothing about the subject, while the
    // constraint required only that a subject column be non-null. The feed
    // joins the review body in, so this put another person's writing under
    // Alice's handle in her followers' feeds.
    const { error } = await asAlice
      .from('activity')
      .insert({ actor_id: alice.id, type: 'reviewed', review_id: bobReviewId });

    expect(error).not.toBeNull();
    expect(error!.code).toBe(RLS_VIOLATION);
  });
});

describe('notifications', () => {
  it('lets a user notify somebody of their own follow', async () => {
    const { data: follow, error: followError } = await asAlice
      .from('follows')
      .insert({ follower_id: alice.id, followee_id: bob.id })
      .select('id')
      .single();
    if (followError) throw followError;

    const { error } = await asAlice.from('notifications').insert({
      actor_id: alice.id,
      recipient_id: bob.id,
      type: 'followed',
      follow_id: follow.id,
    });
    expect(error).toBeNull();
  });

  it('refuses a notification fabricated from somebody else’s follow', async () => {
    // `follows` is publicly readable, so any follow id can be named. The policy
    // checked the actor and nothing about the relationship being claimed.
    const { data: bobFollow } = await admin
      .from('follows')
      .insert({ follower_id: bob.id, followee_id: alice.id })
      .select('id')
      .single();

    const { error } = await asAlice.from('notifications').insert({
      actor_id: alice.id,
      recipient_id: bob.id,
      type: 'followed',
      follow_id: bobFollow!.id,
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe(RLS_VIOLATION);
  });
});
