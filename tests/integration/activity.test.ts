import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { collaborationAlbum, singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * Activity events, against the real database.
 *
 * **The anti-flood invariant is the reason this file exists.**
 * `development-plan.md` calls it the single most important test in the phase,
 * because its failure floods every follower's feed and is not recoverable. It
 * is proved here, before any feed exists to render it.
 *
 * The rule is that **the write path decides**, not the date. An interactive add
 * produces a `listened` event; a bulk or imported write produces none. Both
 * reach the same `ensure_collection_entry`, so the distinction lives one level
 * up — in `addToCollection` versus `ensureEntry` — and that is exactly what
 * these tests pin.
 *
 * The services build a cookie-bound client and cannot be called without a
 * request scope, so these issue the statements the services issue. Where that
 * matters the replication is exact and says so.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

vi.setConfig({ testTimeout: 15_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds: string[] = [];
let albumA: string;
let albumB: string;

async function createUser(): Promise<{ id: string; email: string }> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `activity-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'correct-horse-battery',
    email_confirm: true,
  });
  if (error) throw error;

  const id = data.user!.id;
  createdUserIds.push(id);
  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id, handle: `a_${stamp}`.slice(0, 30) });
  if (profileError) throw profileError;
  return { id, email };
}

/** `ensureEntry`'s statement — the creation path shared by every caller. */
async function ensureEntry(userId: string, albumId: string, listenedOn?: string) {
  const { data, error } = await admin.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
    p_listened_on: listenedOn,
  });
  if (error) throw error;
  return data as Database['public']['Tables']['collection_entries']['Row'];
}

/** `addToCollection`'s two statements: create the entry, then record the event. */
async function addToCollection(userId: string, albumId: string, listenedOn?: string) {
  const entry = await ensureEntry(userId, albumId, listenedOn);
  const { error } = await admin
    .from('activity')
    .insert({ actor_id: userId, type: 'listened', collection_entry_id: entry.id });
  if (error && error.code !== '23505') throw error;
  return entry;
}

/** `createList`'s two statements: insert the list, then record the event. */
async function createList(userId: string, title: string): Promise<string> {
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

  return data.id;
}

/** Like `activityFor`, but carrying the fourth subject column. */
async function listActivityFor(userId: string) {
  const { data, error } = await admin
    .from('activity')
    .select('type, list_id, collection_entry_id, relisten_event_id, review_id')
    .eq('actor_id', userId);
  if (error) throw error;
  return data ?? [];
}

async function activityFor(userId: string) {
  const { data, error } = await admin
    .from('activity')
    .select('type, collection_entry_id, relisten_event_id, review_id')
    .eq('actor_id', userId);
  if (error) throw error;
  return data ?? [];
}

beforeEach(async () => {
  await admin.from('activity').delete().neq('id', '00000000-0000-0000-0000-000000000000');
});

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

beforeEach(async () => {
  if (albumA) return;
  await ingestReleaseGroupPayload(singleArtistAlbum, admin);
  await ingestReleaseGroupPayload(collaborationAlbum, admin);
  const { data } = await admin.from('albums').select('id, mbid').order('mbid');
  albumA = data![0].id;
  albumB = data![1].id;
});

describe('the anti-flood invariant', () => {
  it('generates nothing for a bulk write through the creation path', async () => {
    const user = await createUser();

    // The path an import or backfill uses. Forty entries, no interaction.
    for (let i = 0; i < 20; i++) {
      await ensureEntry(user.id, albumA);
      await ensureEntry(user.id, albumB);
    }

    // The failure this asserts against floods every follower and cannot be
    // undone, which is why it is checked at volume rather than once.
    expect(await activityFor(user.id)).toEqual([]);
  });

  it('generates one event for an interactive add', async () => {
    const user = await createUser();

    await addToCollection(user.id, albumA);

    const events = await activityFor(user.id);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('listened');
  });

  it('still generates one when the add is backdated', async () => {
    const user = await createUser();

    // The inverse of the rule, and the case that would silently regress if
    // anyone reinstated the old date-based condition. Backdating is a claim
    // about the past, not a request for silence.
    await addToCollection(user.id, albumA, '1997-05-21');

    const events = await activityFor(user.id);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('listened');
  });

  it('writes every event when a user adds many albums by hand', async () => {
    const user = await createUser();

    // [DECIDED 2026-08-31] Bulk interactive adds are not suppressed, not
    // aggregated and not rate-limited. Grouping is the feed's problem at read
    // time; an event never written could not be recovered.
    await addToCollection(user.id, albumA);
    await addToCollection(user.id, albumB);

    expect(await activityFor(user.id)).toHaveLength(2);
  });
});

describe('implicit collection creation stays silent', () => {
  it('rating an uncollected album fires rated and never listened', async () => {
    const user = await createUser();

    const entry = await ensureEntry(user.id, albumA);
    await admin.from('collection_entries').update({ rating: 8.5 }).eq('id', entry.id);
    await admin
      .from('activity')
      .insert({ actor_id: user.id, type: 'rated', collection_entry_id: entry.id });

    const events = await activityFor(user.id);
    expect(events.map((e) => e.type)).toEqual(['rated']);
  });

  it('liking produces no event at all', async () => {
    const user = await createUser();

    const entry = await ensureEntry(user.id, albumA);
    await admin.from('collection_entries').update({ liked: true }).eq('id', entry.id);

    // Likes are excluded from the feed by decision — they would dominate by
    // volume and crowd out reviews.
    expect(await activityFor(user.id)).toEqual([]);
  });
});

describe('ratings', () => {
  it('re-rating leaves one event, not two', async () => {
    const user = await createUser();
    const entry = await ensureEntry(user.id, albumA);

    for (const rating of [7.0, 8.0, 9.0]) {
      await admin.from('collection_entries').update({ rating }).eq('id', entry.id);
      const { error } = await admin
        .from('activity')
        .insert({ actor_id: user.id, type: 'rated', collection_entry_id: entry.id });
      if (error && error.code !== '23505') throw error;
    }

    // The event reads the entry's live value, so an edit changes what the feed
    // shows without announcing it again.
    expect(await activityFor(user.id)).toHaveLength(1);
  });

  it('clearing the rating removes its event', async () => {
    const user = await createUser();
    const entry = await ensureEntry(user.id, albumA);

    await admin.from('collection_entries').update({ rating: 8.5 }).eq('id', entry.id);
    await admin
      .from('activity')
      .insert({ actor_id: user.id, type: 'rated', collection_entry_id: entry.id });
    expect(await activityFor(user.id)).toHaveLength(1);

    // `removeRated`, replicated. The entry survives, so no cascade fires — this
    // is the one undo that needs an explicit delete.
    await admin.from('collection_entries').update({ rating: null }).eq('id', entry.id);
    await admin
      .from('activity')
      .delete()
      .eq('actor_id', user.id)
      .eq('type', 'rated')
      .eq('collection_entry_id', entry.id);

    expect(await activityFor(user.id)).toEqual([]);
  });
});

describe('relistens', () => {
  it('three relistens produce three events', async () => {
    const user = await createUser();
    const entry = await ensureEntry(user.id, albumA);

    for (let i = 0; i < 3; i++) {
      const { data: relisten } = await admin
        .from('relisten_events')
        .insert({ collection_entry_id: entry.id })
        .select('id')
        .single();
      await admin
        .from('activity')
        .insert({ actor_id: user.id, type: 'relistened', relisten_event_id: relisten!.id });
    }

    // Deliberately unlike ratings: three feed items cannot come from a counter.
    const events = await activityFor(user.id);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.type === 'relistened')).toBe(true);
  });
});

describe('reviews', () => {
  it('editing a review leaves one event', async () => {
    const user = await createUser();
    const entry = await ensureEntry(user.id, albumA);

    for (const body of ['First thoughts.', 'Second thoughts, longer.']) {
      const { data: review } = await admin
        .from('reviews')
        .upsert({ collection_entry_id: entry.id, body }, { onConflict: 'collection_entry_id' })
        .select('id')
        .single();
      const { error } = await admin
        .from('activity')
        .insert({ actor_id: user.id, type: 'reviewed', review_id: review!.id });
      if (error && error.code !== '23505') throw error;
    }

    expect(await activityFor(user.id)).toHaveLength(1);
  });
});

describe('undoing an action removes its event', () => {
  it('removing the album removes every event hanging off it', async () => {
    const user = await createUser();
    const entry = await addToCollection(user.id, albumA);

    await admin
      .from('activity')
      .insert({ actor_id: user.id, type: 'rated', collection_entry_id: entry.id });
    const { data: relisten } = await admin
      .from('relisten_events')
      .insert({ collection_entry_id: entry.id })
      .select('id')
      .single();
    await admin
      .from('activity')
      .insert({ actor_id: user.id, type: 'relistened', relisten_event_id: relisten!.id });
    const { data: review } = await admin
      .from('reviews')
      .insert({ collection_entry_id: entry.id, body: 'A review.' })
      .select('id')
      .single();
    await admin
      .from('activity')
      .insert({ actor_id: user.id, type: 'reviewed', review_id: review!.id });

    expect(await activityFor(user.id)).toHaveLength(4);

    await admin.from('collection_entries').delete().eq('id', entry.id);

    // All four, including the two that reach the entry only transitively
    // through relisten_events and reviews.
    expect(await activityFor(user.id)).toEqual([]);
  });

  it('removing one relisten removes only that event', async () => {
    const user = await createUser();
    const entry = await addToCollection(user.id, albumA);

    const { data: relisten } = await admin
      .from('relisten_events')
      .insert({ collection_entry_id: entry.id })
      .select('id')
      .single();
    await admin
      .from('activity')
      .insert({ actor_id: user.id, type: 'relistened', relisten_event_id: relisten!.id });

    await admin.from('relisten_events').delete().eq('id', relisten!.id);

    expect((await activityFor(user.id)).map((e) => e.type)).toEqual(['listened']);
  });

  it('deleting a review removes only that event', async () => {
    const user = await createUser();
    const entry = await addToCollection(user.id, albumA);

    const { data: review } = await admin
      .from('reviews')
      .insert({ collection_entry_id: entry.id, body: 'A review.' })
      .select('id')
      .single();
    await admin
      .from('activity')
      .insert({ actor_id: user.id, type: 'reviewed', review_id: review!.id });

    await admin.from('reviews').delete().eq('id', review!.id);

    expect((await activityFor(user.id)).map((e) => e.type)).toEqual(['listened']);
  });

  it('deleting the account removes their activity', async () => {
    const user = await createUser();
    await addToCollection(user.id, albumA);
    expect(await activityFor(user.id)).toHaveLength(1);

    await admin.auth.admin.deleteUser(user.id);
    createdUserIds.splice(createdUserIds.indexOf(user.id), 1);

    expect(await activityFor(user.id)).toEqual([]);
  });
});

describe('the schema refuses states the feed would have to defend against', () => {
  it('rejects a type whose subject does not match', async () => {
    const user = await createUser();
    const entry = await ensureEntry(user.id, albumA);

    // A `reviewed` event pointing at a collection entry.
    const { error } = await admin
      .from('activity')
      .insert({ actor_id: user.id, type: 'reviewed', collection_entry_id: entry.id });

    expect(error?.message).toContain('activity_subject_matches_type');
  });

  it('rejects an event with no subject at all', async () => {
    const user = await createUser();

    const { error } = await admin.from('activity').insert({ actor_id: user.id, type: 'listened' });

    expect(error?.message).toContain('activity_subject_matches_type');
  });

  it('rejects a second listened for one entry', async () => {
    const user = await createUser();
    const entry = await addToCollection(user.id, albumA);

    const { error } = await admin
      .from('activity')
      .insert({ actor_id: user.id, type: 'listened', collection_entry_id: entry.id });

    expect(error?.code).toBe('23505');
  });

  it('rejects a second rated for one entry', async () => {
    const user = await createUser();
    const entry = await ensureEntry(user.id, albumA);

    await admin
      .from('activity')
      .insert({ actor_id: user.id, type: 'rated', collection_entry_id: entry.id });
    const { error } = await admin
      .from('activity')
      .insert({ actor_id: user.id, type: 'rated', collection_entry_id: entry.id });

    expect(error?.code).toBe('23505');
  });

  it('allows a listened and a rated on the same entry', async () => {
    const user = await createUser();
    const entry = await addToCollection(user.id, albumA);

    const { error } = await admin
      .from('activity')
      .insert({ actor_id: user.id, type: 'rated', collection_entry_id: entry.id });

    expect(error).toBeNull();
    expect((await activityFor(user.id)).map((e) => e.type).sort()).toEqual(['listened', 'rated']);
  });
});

describe('authorisation', () => {
  it('refuses activity attributed to another actor', async () => {
    const a = await createUser();
    const b = await createUser();
    const entry = await ensureEntry(b.id, albumA);

    const client = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await client.auth.signInWithPassword({
      email: a.email,
      password: 'correct-horse-battery',
    });
    if (signInError) throw signInError;

    const { error } = await client
      .from('activity')
      .insert({ actor_id: b.id, type: 'listened', collection_entry_id: entry.id });

    expect(error?.code).toBe('42501');
  });

  it('is readable signed out', async () => {
    const user = await createUser();
    await addToCollection(user.id, albumA);

    const anon = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anon.from('activity').select('id').eq('actor_id', user.id);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe('list activity — creation only', () => {
  it('creating a list writes exactly one list_created event', async () => {
    const user = await createUser();
    const listId = await createList(user.id, 'Long drive records');

    const rows = await listActivityFor(user.id);

    expect(rows).toEqual([
      {
        type: 'list_created',
        list_id: listId,
        collection_entry_id: null,
        relisten_event_id: null,
        review_id: null,
      },
    ]);
  });

  it('deleting the list removes its event, by cascade', async () => {
    const user = await createUser();
    const listId = await createList(user.id, 'Undone');
    expect(await listActivityFor(user.id)).toHaveLength(1);

    await admin.from('lists').delete().eq('id', listId);

    expect(await listActivityFor(user.id)).toEqual([]);
  });

  /**
   * **The constraint used to fail open, and these are what prove it no longer
   * does.** The original `CASE` had no `ELSE`: an unmatched type returns NULL,
   * and a CHECK with a NULL result passes. Every combination below would have
   * been accepted before the rewrite.
   */
  describe('the subject constraint rejects every wrong shape', () => {
    it('rejects a list_created row with no list_id', async () => {
      const user = await createUser();

      const { error } = await admin
        .from('activity')
        .insert({ actor_id: user.id, type: 'list_created' });

      expect(error).not.toBeNull();
      expect(await listActivityFor(user.id)).toEqual([]);
    });

    it('rejects a list_created row that also names another subject', async () => {
      const user = await createUser();
      const listId = await createList(user.id, 'Mixed subject');
      const entry = await ensureEntry(user.id, albumA);

      const { error } = await admin.from('activity').insert({
        actor_id: user.id,
        type: 'list_created',
        list_id: listId,
        collection_entry_id: entry.id,
      });

      expect(error).not.toBeNull();
    });

    it('rejects each existing type carrying a stray list_id', async () => {
      const user = await createUser();
      const listId = await createList(user.id, 'Stray reference');
      const entry = await ensureEntry(user.id, albumA);

      // Each type needs its own valid subject, so the row is rejected for the
      // stray `list_id` and not for missing the subject its type requires.
      const { data: relisten } = await admin
        .from('relisten_events')
        .insert({ collection_entry_id: entry.id })
        .select('id')
        .single();
      const { data: review } = await admin
        .from('reviews')
        .upsert(
          { collection_entry_id: entry.id, body: 'A body long enough to be a review.' },
          { onConflict: 'collection_entry_id' },
        )
        .select('id')
        .single();

      const cases = [
        { type: 'listened' as const, subject: { collection_entry_id: entry.id } },
        { type: 'rated' as const, subject: { collection_entry_id: entry.id } },
        { type: 'relistened' as const, subject: { relisten_event_id: relisten!.id } },
        { type: 'reviewed' as const, subject: { review_id: review!.id } },
      ];

      for (const { type, subject } of cases) {
        const { error } = await admin.from('activity').insert({
          actor_id: user.id,
          type,
          ...subject,
          list_id: listId,
        });
        expect(error, `${type} must reject a stray list_id`).not.toBeNull();
      }

      // Nothing was written: the constraint refused all four.
      expect(await listActivityFor(user.id)).toHaveLength(1);
    });
  });

  /**
   * **The anti-burst boundary, asserted as silence rather than as a bound.**
   * There is no `list_updated` event in this slice, so repeated editing must
   * produce no additional rows at all — a stronger property than an index that
   * collapses many events into one.
   */
  it('editing, adding, removing and reordering write nothing', async () => {
    const user = await createUser();
    const listId = await createList(user.id, 'Rapidly edited');

    for (let i = 0; i < 5; i++) {
      await admin
        .from('lists')
        .update({ title: `Rapidly edited ${i}` })
        .eq('id', listId);

      const { error: addError } = await admin.rpc('add_list_item', {
        p_list_id: listId,
        p_album_id: albumA,
      });
      if (addError && addError.code !== '23505') throw addError;

      const { data: item } = await admin
        .from('list_items')
        .select('id')
        .eq('list_id', listId)
        .maybeSingle();
      if (item) {
        const { error: reorderError } = await admin.rpc('reorder_list_item', {
          p_item_id: item.id,
          p_to_position: 1,
        });
        if (reorderError) throw reorderError;
      }

      const { error: removeError } = await admin.rpc('remove_list_item', {
        p_list_id: listId,
        p_album_id: albumA,
      });
      if (removeError) throw removeError;
    }

    expect(await listActivityFor(user.id)).toHaveLength(1);
  });
});
