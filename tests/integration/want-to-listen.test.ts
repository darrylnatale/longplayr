import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { collaborationAlbum, singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * The Want to Listen relation itself.
 *
 * **This file exists because the service had no coverage at all.**
 * `addWantToListen`, `removeWantToListen` and `listWantToListen` shipped with
 * the collection schema and were referenced by nothing — no caller, no test —
 * so the unique constraint that makes `add` idempotent had never been
 * exercised. `wishlist-clearing.test.ts` covers the *clearing rule* thoroughly
 * and writes its rows with a direct insert, which proves the rule while proving
 * nothing about the service.
 *
 * What is asserted here is the relation's own behaviour. The clearing rule is
 * re-checked only at the three points where it touches this path, and is not
 * re-proven across all five mutation paths — that is the sibling file's job.
 *
 * The services build a cookie-bound client and cannot be called without a
 * request scope, so these issue the same statements they issue. Where that
 * matters — the idempotency branch in particular — the replication is exact and
 * says so.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

/** Auth-heavy, same budget and the same reasoning as every sibling suite. */
vi.setConfig({ testTimeout: 15_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon: SupabaseClient<Database> = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds: string[] = [];
let albumA: string;
let albumB: string;

async function createUser(withProfile = true) {
  const email = `w2l-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'correct-horse-battery',
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);

  if (withProfile) {
    const handle = `w2_${Math.random().toString(36).slice(2, 10)}`.slice(0, 30);
    const { error: profileError } = await admin
      .from('profiles')
      .insert({ id: data.user.id, handle });
    if (profileError) throw profileError;
  }

  return data.user.id;
}

/**
 * `addWantToListen`, replicated statement for statement.
 *
 * The idempotency branch is the reason this is exact rather than a convenient
 * upsert: the service inserts, and only on a `23505` re-reads the existing row
 * and returns it as a success. An `upsert` here would pass every assertion
 * below while testing a code path the service does not have.
 */
async function wish(userId: string, albumId: string) {
  const { data, error } = await admin
    .from('want_to_listen')
    .insert({ user_id: userId, album_id: albumId })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await admin
        .from('want_to_listen')
        .select('*')
        .eq('user_id', userId)
        .eq('album_id', albumId)
        .single();
      if (existing) return { ok: true as const, row: existing, created: false as const };
    }
    if (error.code === '23503') return { ok: false as const, error: 'not_found' as const };
    return { ok: false as const, error: error.code };
  }
  return { ok: true as const, row: data, created: true as const };
}

/** `removeWantToListen`, replicated. A delete matching nothing is not an error. */
async function unwish(userId: string, albumId: string) {
  const { error } = await admin
    .from('want_to_listen')
    .delete()
    .eq('user_id', userId)
    .eq('album_id', albumId);

  if (error) return { ok: false as const, error: error.code };
  return { ok: true as const };
}

/** `listWantToListen`, replicated — newest intention first. */
async function listWishes(client: SupabaseClient<Database>, userId: string) {
  const { data, error } = await client
    .from('want_to_listen')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

async function ensureEntry(userId: string, albumId: string) {
  const { data, error } = await admin.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
  });
  if (error) throw error;
  return data!;
}

const countEntries = async (userId: string) =>
  (
    await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
  ).count;

beforeAll(() => {
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing. Run `npm run db:env`.');
});

beforeEach(async () => {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');

  await ingestReleaseGroupPayload(singleArtistAlbum, admin);
  await ingestReleaseGroupPayload(collaborationAlbum, admin);

  const { data } = await admin.from('albums').select('id').order('title');
  albumA = data![0].id;
  albumB = data![1].id;
});

afterAll(async () => {
  // Deleting the auth user cascades to the profile and from there to
  // `want_to_listen`, which is the same cascade account deletion relies on.
  await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('adding', () => {
  it('records the intention', async () => {
    const user = await createUser();

    const result = await wish(user, albumA);

    expect(result.ok).toBe(true);
    expect(result.ok && result.created).toBe(true);
    expect(await listWishes(admin, user)).toHaveLength(1);
  });

  it('is idempotent — a second add returns the first row', async () => {
    // The branch that had never run. The service does not upsert: it inserts,
    // catches the unique violation, reads the existing row back and returns it
    // as a success. A caller cannot tell the two calls apart, which is the
    // point — a double-submitted form must not error.
    const user = await createUser();

    const first = await wish(user, albumA);
    const second = await wish(user, albumA);

    expect(second.ok).toBe(true);
    expect(second.ok && second.created).toBe(false);
    expect(second.ok && second.row.id).toBe(first.ok && first.row.id);
    expect(second.ok && second.row.added_at).toBe(first.ok && first.row.added_at);
  });

  it('never writes a second row for the same album', async () => {
    const user = await createUser();

    await wish(user, albumA);
    await wish(user, albumA);
    await wish(user, albumA);

    expect(await listWishes(admin, user)).toHaveLength(1);
  });

  it('is refused by the schema when the service check is bypassed', async () => {
    // `unique (user_id, album_id)` is what makes the idempotency above possible
    // rather than a race between a read and an insert.
    const user = await createUser();
    await wish(user, albumA);

    const { error } = await admin
      .from('want_to_listen')
      .insert({ user_id: user, album_id: albumA });

    expect(error?.code).toBe('23505');
  });

  it('keeps one row per album, not one per user', async () => {
    const user = await createUser();

    await wish(user, albumA);
    await wish(user, albumB);

    const rows = await listWishes(admin, user);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.album_id))).toEqual(new Set([albumA, albumB]));
  });

  it('refuses an album that is not in the catalogue', async () => {
    const user = await createUser();

    const result = await wish(user, '00000000-0000-0000-0000-0000000000ff');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe('not_found');
  });
});

describe('removing', () => {
  it('removes the intention', async () => {
    const user = await createUser();
    await wish(user, albumA);

    const result = await unwish(user, albumA);

    expect(result.ok).toBe(true);
    expect(await listWishes(admin, user)).toHaveLength(0);
  });

  it('is safe when there is nothing to remove', async () => {
    // The actual contract: a delete matching no rows is a success, not an
    // error, so `removeWantToListen` returns `ok(null)` rather than a
    // `not_found`. A double-clicked control must not produce a failure.
    const user = await createUser();

    const result = await unwish(user, albumA);

    expect(result.ok).toBe(true);
    expect(await listWishes(admin, user)).toHaveLength(0);
  });

  it('removes only the album asked for', async () => {
    const user = await createUser();
    await wish(user, albumA);
    await wish(user, albumB);

    await unwish(user, albumA);

    const rows = await listWishes(admin, user);
    expect(rows).toHaveLength(1);
    expect(rows[0].album_id).toBe(albumB);
  });

  it('can be re-added afterwards', async () => {
    const user = await createUser();
    await wish(user, albumA);
    await unwish(user, albumA);

    const again = await wish(user, albumA);

    expect(again.ok).toBe(true);
    expect(again.ok && again.created).toBe(true);
  });
});

describe('isolation', () => {
  it('keeps one user’s intentions out of another’s list', async () => {
    const mine = await createUser();
    const theirs = await createUser();

    await wish(mine, albumA);
    await wish(theirs, albumB);

    expect((await listWishes(admin, mine)).map((r) => r.album_id)).toEqual([albumA]);
    expect((await listWishes(admin, theirs)).map((r) => r.album_id)).toEqual([albumB]);
  });

  it('lets two users want the same album', async () => {
    // The uniqueness is per user. Wanting a record is not a claim on it.
    const mine = await createUser();
    const theirs = await createUser();

    expect((await wish(mine, albumA)).ok).toBe(true);
    expect((await wish(theirs, albumA)).ok).toBe(true);
  });

  it('removes only the acting user’s row', async () => {
    const mine = await createUser();
    const theirs = await createUser();
    await wish(mine, albumA);
    await wish(theirs, albumA);

    await unwish(mine, albumA);

    expect(await listWishes(admin, mine)).toHaveLength(0);
    expect(await listWishes(admin, theirs)).toHaveLength(1);
  });
});

describe('a user without a profile', () => {
  it('cannot hold an intention at all', async () => {
    // The invariant behind `onboarding_required`: `want_to_listen.user_id`
    // references `profiles`, so an authenticated user mid-onboarding has no row
    // to reference. The service checks the profile first and returns a friendly
    // outcome; this is why it has to.
    const user = await createUser(false);

    const { error } = await admin
      .from('want_to_listen')
      .insert({ user_id: user, album_id: albumA });

    expect(error?.code).toBe('23503');
  });
});

describe('visibility', () => {
  it('is readable signed out, like everything else user-generated', async () => {
    // `for select using (true)` plus a select grant to `anon`. Recorded as
    // resolved on 2026-08-19 — Want to Listen is public on the profile — and
    // asserted here because the policy is what actually decides it.
    const user = await createUser();
    await wish(user, albumA);
    await wish(user, albumB);

    expect(await listWishes(anon, user)).toHaveLength(2);
  });

  it('returns nothing for a user who wants nothing', async () => {
    const user = await createUser();
    expect(await listWishes(admin, user)).toEqual([]);
  });

  it('returns newest intention first', async () => {
    const user = await createUser();
    const first = await wish(user, albumA);
    await admin
      .from('want_to_listen')
      .update({ added_at: '2026-01-01T00:00:00Z' })
      .eq('id', first.ok ? first.row.id : '');
    await wish(user, albumB);

    expect((await listWishes(admin, user)).map((r) => r.album_id)).toEqual([albumB, albumA]);
  });
});

describe('the collection, which is a separate relation', () => {
  /**
   * Three points where this path meets the clearing rule. The rule itself —
   * all five mutation paths, both directions, its edges and its behaviour under
   * concurrency — is proven in `wishlist-clearing.test.ts` and is not repeated.
   */
  it('wishing an already-collected album leaves it collected, and in both', async () => {
    // The coexistence the independence decision exists to permit. The clearing
    // rule is one-directional: creating a wish clears no collection entry.
    const user = await createUser();
    const entry = await ensureEntry(user, albumA);
    await admin.from('collection_entries').update({ rating: 7.5, liked: true }).eq('id', entry.id);

    const result = await wish(user, albumA);

    expect(result.ok).toBe(true);
    expect(await listWishes(admin, user)).toHaveLength(1);
    expect(await countEntries(user)).toBe(1);

    const { data: after } = await admin
      .from('collection_entries')
      .select('id, rating, liked, relisten_count')
      .eq('id', entry.id)
      .single();

    expect(after!.id).toBe(entry.id);
    expect(Number(after!.rating)).toBe(7.5);
    expect(after!.liked).toBe(true);
  });

  it('unwishing leaves the collection entry untouched', async () => {
    const user = await createUser();
    const entry = await ensureEntry(user, albumA);
    await wish(user, albumA);

    await unwish(user, albumA);

    expect(await listWishes(admin, user)).toHaveLength(0);
    expect(await countEntries(user)).toBe(1);

    const { data: after } = await admin
      .from('collection_entries')
      .select('id')
      .eq('id', entry.id)
      .single();
    expect(after!.id).toBe(entry.id);
  });

  it('is cleared when a collection entry is created for that album', async () => {
    const user = await createUser();
    await wish(user, albumA);
    await wish(user, albumB);

    await ensureEntry(user, albumA);

    // Only the collected album leaves the wishlist.
    expect((await listWishes(admin, user)).map((r) => r.album_id)).toEqual([albumB]);
  });

  it('is not cleared by merely acting on an entry that already exists', async () => {
    // The distinction the corrected function turns on: the trigger is the entry
    // being created, not `ensure_collection_entry` being called.
    const user = await createUser();
    await ensureEntry(user, albumA);
    await wish(user, albumA);

    await ensureEntry(user, albumA);

    expect(await listWishes(admin, user)).toHaveLength(1);
  });
});
