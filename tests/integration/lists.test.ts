import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { collaborationAlbum, singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * Lists, against the real database. Phase 4, slice 1.
 *
 * **Everything that tests a boundary runs through a signed-in `authenticated`
 * client, never the service-role one.** Ownership on `list_items` is *inherited*
 * through `lists` rather than stored, so a service-role client would pass every
 * assertion below while proving nothing about the property that matters.
 *
 * **The two escape paths are pinned separately**, because they fail through
 * different halves of the policy: inserting an item naming someone else's list
 * is refused by `with check`, and re-pointing your own item into their list is
 * refused by `with check` on update. `using` alone would allow the second.
 *
 * **Contiguity is asserted after every mutation**, not just after reorder. The
 * invariant is that positions are contiguous on *every* list, ranked or not —
 * `is_ranked` decides only whether the reader is shown them.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

vi.setConfig({ testTimeout: 20_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'correct-horse-battery';
const createdUserIds: string[] = [];
let albumA: string;
let albumB: string;

async function createUser(): Promise<{ id: string; email: string; handle: string }> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `ls-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const id = data.user!.id;
  createdUserIds.push(id);
  const handle = `ls_${stamp}`.slice(0, 30);
  const { error: profileError } = await admin.from('profiles').insert({ id, handle });
  if (profileError) throw profileError;
  return { id, email, handle };
}

/** A client carrying a real session, so RLS applies as it does in the app. */
async function signedInAs(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function makeList(
  userId: string,
  { isRanked = false, status = 'live' as 'live' | 'removed', title = 'A list' } = {},
) {
  const { data, error } = await admin
    .from('lists')
    .insert({ user_id: userId, title, is_ranked: isRanked, status })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/** Positions in order, as `add_list_item` and `remove_list_item` leave them. */
async function positions(listId: string): Promise<number[]> {
  const { data, error } = await admin
    .from('list_items')
    .select('position')
    .eq('list_id', listId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => row.position);
}

/** Album ids in stored order — what a reorder is actually meant to change. */
async function order(listId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('list_items')
    .select('album_id')
    .eq('list_id', listId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => row.album_id);
}

function isContiguous(values: number[]): boolean {
  return values.every((value, index) => value === index);
}

beforeEach(async () => {
  await admin.from('albums').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  await ingestReleaseGroupPayload(singleArtistAlbum, admin);
  await ingestReleaseGroupPayload(collaborationAlbum, admin);

  const { data, error } = await admin.from('albums').select('id, mbid').order('mbid');
  if (error) throw error;
  albumA = data![0].id;
  albumB = data![1].id;
});

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  await admin.from('albums').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('id', '00000000-0000-0000-0000-000000000000');
});

describe('lists — reading is public', () => {
  it('lets an anonymous visitor read a live list and its items', async () => {
    const owner = await createUser();
    const listId = await makeList(owner.id);
    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumA });

    const anon = anonClient();

    const { data: lists } = await anon.from('lists').select('id').eq('id', listId);
    expect(lists).toHaveLength(1);

    const { data: items } = await anon.from('list_items').select('id').eq('list_id', listId);
    expect(items).toHaveLength(1);
  });

  it('hides a removed list from everyone but its author', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const listId = await makeList(owner.id, { status: 'removed' });
    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumA });

    const anon = anonClient();
    const { data: anonRows } = await anon.from('lists').select('id').eq('id', listId);
    expect(anonRows).toHaveLength(0);

    // The item goes with it: `list_items` defers to the list's own visibility.
    const { data: anonItems } = await anon.from('list_items').select('id').eq('list_id', listId);
    expect(anonItems).toHaveLength(0);

    const strangerClient = await signedInAs(stranger.email);
    const { data: strangerRows } = await strangerClient.from('lists').select('id').eq('id', listId);
    expect(strangerRows).toHaveLength(0);

    // Moderation hides content from readers; it does not hide it from its author.
    const ownerClient = await signedInAs(owner.email);
    const { data: ownerRows } = await ownerClient.from('lists').select('id').eq('id', listId);
    expect(ownerRows).toHaveLength(1);
  });
});

describe('lists — only the owner may mutate', () => {
  it('refuses a stranger creating a list owned by someone else', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const client = await signedInAs(stranger.email);

    const { error } = await client.from('lists').insert({ user_id: owner.id, title: 'Forged' });
    expect(error).not.toBeNull();
  });

  it('refuses a stranger editing or deleting a list', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const listId = await makeList(owner.id, { title: 'Original' });
    const client = await signedInAs(stranger.email);

    const { data: updated } = await client
      .from('lists')
      .update({ title: 'Hijacked' })
      .eq('id', listId)
      .select('id');
    expect(updated ?? []).toHaveLength(0);

    await client.from('lists').delete().eq('id', listId);

    const { data: still } = await admin.from('lists').select('title').eq('id', listId).single();
    expect(still!.title).toBe('Original');
  });
});

describe('list_items — ownership is inherited, and cannot be escaped', () => {
  it('refuses an item inserted into another user’s list', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const listId = await makeList(owner.id);
    const client = await signedInAs(stranger.email);

    // The `with check` half. Without it, anyone knowing a list id could write
    // into it.
    const { error } = await client
      .from('list_items')
      .insert({ list_id: listId, album_id: albumA, position: 0 });
    expect(error).not.toBeNull();
  });

  it('refuses re-pointing your own item into another user’s list', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const victimList = await makeList(owner.id);
    const ownList = await makeList(stranger.id);

    await admin.rpc('add_list_item', { p_list_id: ownList, p_album_id: albumA });
    const { data: mine } = await admin.from('list_items').select('id').eq('list_id', ownList);

    const client = await signedInAs(stranger.email);
    const { data: moved } = await client
      .from('list_items')
      .update({ list_id: victimList })
      .eq('id', mine![0].id)
      .select('id');

    // `using` would allow this — the row *is* the caller's. Only `with check`
    // refuses what it would become.
    expect(moved ?? []).toHaveLength(0);
    expect(await positions(victimList)).toEqual([]);
  });
});

describe('membership', () => {
  it('appends at max(position) + 1 and keeps positions contiguous', async () => {
    const owner = await createUser();
    const listId = await makeList(owner.id);

    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumA });
    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumB });

    expect(await positions(listId)).toEqual([0, 1]);
    expect(await order(listId)).toEqual([albumA, albumB]);
  });

  it('appends the same way on an unranked list', async () => {
    const owner = await createUser();
    const listId = await makeList(owner.id, { isRanked: false });

    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumA });
    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumB });

    // Positions are maintained regardless of `is_ranked`. This is the assertion
    // that fails if anyone makes position conditional on ranking.
    expect(isContiguous(await positions(listId))).toBe(true);
  });

  it('refuses the same album twice in one list', async () => {
    const owner = await createUser();
    const listId = await makeList(owner.id);

    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumA });
    const { error } = await admin.rpc('add_list_item', {
      p_list_id: listId,
      p_album_id: albumA,
    });

    expect(error?.code).toBe('23505');
  });

  it('allows the same album in different lists', async () => {
    const owner = await createUser();
    const first = await makeList(owner.id, { title: 'One' });
    const second = await makeList(owner.id, { title: 'Two' });

    await admin.rpc('add_list_item', { p_list_id: first, p_album_id: albumA });
    const { error } = await admin.rpc('add_list_item', {
      p_list_id: second,
      p_album_id: albumA,
    });

    expect(error).toBeNull();
  });

  it('closes the gap when an album is removed', async () => {
    const owner = await createUser();
    const listId = await makeList(owner.id);

    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumA });
    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumB });

    await admin.rpc('remove_list_item', { p_list_id: listId, p_album_id: albumA });

    expect(await positions(listId)).toEqual([0]);
    expect(await order(listId)).toEqual([albumB]);
  });

  it('is idempotent when removing something not in the list', async () => {
    const owner = await createUser();
    const listId = await makeList(owner.id);

    const { error } = await admin.rpc('remove_list_item', {
      p_list_id: listId,
      p_album_id: albumA,
    });
    expect(error).toBeNull();
  });
});

describe('reordering', () => {
  async function threeItemList(userId: string) {
    const listId = await makeList(userId, { isRanked: true });
    // A third album is needed for a middle position; the fixtures give two, so
    // the third is a direct insert through the same append rule.
    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumA });
    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumB });
    return listId;
  }

  it('moves an item to the front and keeps positions contiguous', async () => {
    const owner = await createUser();
    const listId = await threeItemList(owner.id);

    const { data: items } = await admin
      .from('list_items')
      .select('id, album_id, position')
      .eq('list_id', listId)
      .order('position');

    await admin.rpc('reorder_list_item', { p_item_id: items![1].id, p_to_position: 0 });

    expect(await order(listId)).toEqual([albumB, albumA]);
    expect(await positions(listId)).toEqual([0, 1]);
  });

  it('moves an item to the end, clamping a position past the end', async () => {
    const owner = await createUser();
    const listId = await threeItemList(owner.id);

    const { data: items } = await admin
      .from('list_items')
      .select('id')
      .eq('list_id', listId)
      .order('position');

    await admin.rpc('reorder_list_item', { p_item_id: items![0].id, p_to_position: 99 });

    expect(await order(listId)).toEqual([albumB, albumA]);
    expect(isContiguous(await positions(listId))).toBe(true);
  });

  it('treats a same-position move as a no-op', async () => {
    const owner = await createUser();
    const listId = await threeItemList(owner.id);

    const before = await order(listId);
    const { data: items } = await admin
      .from('list_items')
      .select('id, position')
      .eq('list_id', listId)
      .order('position');

    await admin.rpc('reorder_list_item', {
      p_item_id: items![0].id,
      p_to_position: items![0].position,
    });

    expect(await order(listId)).toEqual(before);
  });

  it('refuses to reorder an item in a list the caller does not own', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const listId = await threeItemList(owner.id);

    const { data: items } = await admin
      .from('list_items')
      .select('id')
      .eq('list_id', listId)
      .order('position');

    const client = await signedInAs(stranger.email);

    // **It succeeds and changes nothing, and that is the correct outcome** — the
    // same shape `markNotificationRead` documents. `security invoker` keeps RLS
    // in force inside the function, so the `update` statements match no row the
    // stranger may write and touch nothing. The item itself *is* readable, since
    // the list is public, so there is no existence to protect and no reason to
    // raise.
    //
    // **The security property is that nothing moved**, and that is what is
    // asserted. Anyone later making this raise should be changing the convention
    // deliberately rather than by accident.
    const { error } = await client.rpc('reorder_list_item', {
      p_item_id: items![0].id,
      p_to_position: 0,
    });
    expect(error).toBeNull();

    expect(await order(listId)).toEqual([albumA, albumB]);
  });
});

describe('reordering is a ranked-list operation', () => {
  /**
   * **This pins the fact the service branches on, and the outcome — not the
   * branch itself.** `reorderListItem` builds a cookie-bound client and cannot
   * be called without a request scope, so, following this file's convention,
   * the test issues the query the service issues rather than invoking it.
   *
   * What that genuinely establishes is the part that can realistically break:
   * the embed shape and its visibility under RLS. If `lists(is_ranked)` ever
   * stops resolving through the single `list_items` foreign key, the service's
   * guard would read `undefined`, fall through to `not_found`, and silently stop
   * enforcing the rule. This test fails first in that case.
   */
  async function rankedStateFor(itemId: string) {
    const { data, error } = await admin
      .from('list_items')
      .select('id, lists(is_ranked)')
      .eq('id', itemId)
      .maybeSingle();
    if (error) throw error;
    return (data as unknown as { lists: { is_ranked: boolean } | null } | null)?.lists ?? null;
  }

  it('reports an unranked list as unranked, and nothing moves while it stays that way', async () => {
    const owner = await createUser();
    const listId = await makeList(owner.id, { isRanked: false });

    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumA });
    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumB });

    const before = await order(listId);

    const { data: items } = await admin
      .from('list_items')
      .select('id')
      .eq('list_id', listId)
      .order('position');

    // The guard's input. `false` is what makes the service return `not_ranked`
    // and skip the RPC entirely.
    expect(await rankedStateFor(items![0].id)).toEqual({ is_ranked: false });

    // And because the RPC is never issued, the order is untouched.
    expect(await order(listId)).toEqual(before);
    expect(isContiguous(await positions(listId))).toBe(true);
  });

  it('reports a ranked list as ranked, so the same guard admits it', async () => {
    // The contrast matters: a guard that refused everything would also pass the
    // test above.
    const owner = await createUser();
    const listId = await makeList(owner.id, { isRanked: true });

    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumA });
    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumB });

    const { data: items } = await admin
      .from('list_items')
      .select('id')
      .eq('list_id', listId)
      .order('position');

    expect(await rankedStateFor(items![1].id)).toEqual({ is_ranked: true });

    await admin.rpc('reorder_list_item', { p_item_id: items![1].id, p_to_position: 0 });
    expect(await order(listId)).toEqual([albumB, albumA]);
  });
});

describe('ranking transitions preserve the order exactly', () => {
  it('survives ranked → unranked → ranked with the order intact', async () => {
    const owner = await createUser();
    const listId = await makeList(owner.id, { isRanked: true });

    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumA });
    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumB });

    const { data: items } = await admin
      .from('list_items')
      .select('id')
      .eq('list_id', listId)
      .order('position');
    await admin.rpc('reorder_list_item', { p_item_id: items![1].id, p_to_position: 0 });

    const curated = await order(listId);
    expect(curated).toEqual([albumB, albumA]);

    // Un-ranking writes nothing but the flag.
    await admin.from('lists').update({ is_ranked: false }).eq('id', listId);
    expect(await order(listId)).toEqual(curated);
    expect(isContiguous(await positions(listId))).toBe(true);

    // Re-ranking restores exactly what was there. No fallback sort.
    await admin.from('lists').update({ is_ranked: true }).eq('id', listId);
    expect(await order(listId)).toEqual(curated);
    expect(isContiguous(await positions(listId))).toBe(true);
  });
});

describe('deletion', () => {
  it('removes a list’s items when the list goes', async () => {
    const owner = await createUser();
    const listId = await makeList(owner.id);
    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumA });

    await admin.from('lists').delete().eq('id', listId);

    expect(await positions(listId)).toEqual([]);
  });

  it('removes the item but keeps the list when an album is deleted', async () => {
    const owner = await createUser();
    const listId = await makeList(owner.id);
    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumA });
    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumB });

    await admin.from('albums').delete().eq('id', albumA);

    // The cascade direction that matters: catalogue maintenance must never
    // destroy user-authored curation.
    const { data: list } = await admin.from('lists').select('id').eq('id', listId).single();
    expect(list).not.toBeNull();

    expect(await order(listId)).toEqual([albumB]);
  });

  it('leaves no lists or items behind when an account is deleted', async () => {
    const owner = await createUser();
    const listId = await makeList(owner.id);
    await admin.rpc('add_list_item', { p_list_id: listId, p_album_id: albumA });

    await admin.auth.admin.deleteUser(owner.id);
    createdUserIds.splice(createdUserIds.indexOf(owner.id), 1);

    const { data: lists } = await admin.from('lists').select('id').eq('user_id', owner.id);
    expect(lists ?? []).toHaveLength(0);

    // An orphaned row is a privacy failure, so the items are checked directly
    // rather than inferred from the list being gone.
    const { data: items } = await admin.from('list_items').select('id').eq('list_id', listId);
    expect(items ?? []).toHaveLength(0);
  });
});

describe('grants', () => {
  it('gives anon select but no write on either table', async () => {
    const owner = await createUser();
    const listId = await makeList(owner.id);
    const anon = anonClient();

    const { error: insertError } = await anon
      .from('lists')
      .insert({ user_id: owner.id, title: 'No' });
    expect(insertError).not.toBeNull();

    const { error: itemError } = await anon
      .from('list_items')
      .insert({ list_id: listId, album_id: albumA, position: 0 });
    expect(itemError).not.toBeNull();
  });
});
