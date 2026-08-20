import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { collaborationAlbum, singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * The optional listen date on an explicit add.
 *
 * `listened_on` is what the user asserts; `added_at` is what actually happened.
 * The column has existed since the collection migration and the RPC has always
 * accepted it — what was missing was a way to supply it, so what these cover is
 * the contract that interface now depends on.
 *
 * Two properties matter most and are easy to break without noticing:
 *
 *  - **`added_at` is never influenced by it.** A 1997 listen added today is an
 *    entry added today, which is what keeps feed eligibility and the collection
 *    ordering honest (`product-spec.md` §6).
 *  - **The date applies on creation only**, because that is where
 *    `ensure_collection_entry` applies it — a later call must not overwrite a
 *    date the user set, or set one where they chose none.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

/** Auth-heavy, same budget and the same reasoning as every sibling suite. */
vi.setConfig({ testTimeout: 15_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds: string[] = [];
let albumA: string;
let albumB: string;

async function createUser() {
  const email = `lo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'correct-horse-battery',
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);

  const handle = `lo_${Math.random().toString(36).slice(2, 10)}`.slice(0, 30);
  const { error: profileError } = await admin.from('profiles').insert({ id: data.user.id, handle });
  if (profileError) throw profileError;

  return data.user.id;
}

/** `ensureEntry`, statement for statement — the one sanctioned creation path. */
async function ensureEntry(userId: string, albumId: string, listenedOn?: string | null) {
  return admin.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
    p_listened_on: listenedOn ?? undefined,
  });
}

async function readEntry(userId: string, albumId: string) {
  const { data } = await admin
    .from('collection_entries')
    .select('id, listened_on, added_at')
    .eq('user_id', userId)
    .eq('album_id', albumId)
    .maybeSingle();
  return data;
}

/**
 * `parseListenedOn` from the album action, replicated.
 *
 * The action rejects a malformed or impossible date before it can reach
 * Postgres. Replicated rather than imported for the usual reason — the action
 * is a server action and cannot be called from a test — and exercised against
 * the database afterwards so the two halves are known to agree.
 */
function parseListenedOn(raw: string): { ok: true; value: string | null } | { ok: false } {
  const value = raw.trim();
  if (value === '') return { ok: true, value: null };

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { ok: false };

  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const real =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;

  return real ? { ok: true, value } : { ok: false };
}

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
  await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('adding without a date', () => {
  it('leaves listened_on null, exactly as before the field existed', async () => {
    const user = await createUser();

    await ensureEntry(user, albumA);

    const entry = await readEntry(user, albumA);
    expect(entry!.listened_on).toBeNull();
    expect(entry!.added_at).toBeTruthy();
  });

  it('treats a blank submission as no date at all', async () => {
    // What the form sends when the disclosure was opened and left empty.
    const user = await createUser();
    const parsed = parseListenedOn('');
    expect(parsed.ok && parsed.value).toBeNull();

    await ensureEntry(user, albumA, parsed.ok ? parsed.value : undefined);

    expect((await readEntry(user, albumA))!.listened_on).toBeNull();
  });
});

describe('adding with a date', () => {
  it('persists the date the user supplied', async () => {
    const user = await createUser();

    await ensureEntry(user, albumA, '2026-08-14');

    expect((await readEntry(user, albumA))!.listened_on).toBe('2026-08-14');
  });

  it('persists a date backdated by decades', async () => {
    // The whole point of a user-supplied date: it is a claim about the past,
    // and the past may be a long way back.
    const user = await createUser();

    await ensureEntry(user, albumA, '1997-05-21');

    expect((await readEntry(user, albumA))!.listened_on).toBe('1997-05-21');
  });

  it('stores a calendar date, with no time component', async () => {
    // `listened_on` is a `date`. If it ever became a timestamp, a listen would
    // acquire a clock time the user never gave and a time zone to be wrong in.
    const user = await createUser();

    await ensureEntry(user, albumA, '2026-01-02');

    const value = (await readEntry(user, albumA))!.listened_on!;
    expect(value).toBe('2026-01-02');
    expect(value).not.toMatch(/[T:]/);
  });

  it('does not influence added_at, which stays system-generated', async () => {
    // The property that keeps feed eligibility and collection ordering honest:
    // a 1997 listen recorded today is an entry added today.
    const user = await createUser();
    const before = Date.now();

    await ensureEntry(user, albumA, '1997-05-21');

    const entry = await readEntry(user, albumA);
    const addedAt = new Date(entry!.added_at).getTime();

    expect(entry!.listened_on).toBe('1997-05-21');
    expect(addedAt).toBeGreaterThanOrEqual(before - 60_000);
    expect(addedAt).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(new Date(entry!.added_at).getUTCFullYear()).not.toBe(1997);
  });

  it('does not change collection membership — still one entry', async () => {
    const user = await createUser();

    await ensureEntry(user, albumA, '2020-03-03');
    await ensureEntry(user, albumB);

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user);
    expect(count).toBe(2);
  });
});

describe('the date applies on creation only', () => {
  it('never overwrites a date the user already set', async () => {
    // `ensure_collection_entry` returns the existing row untouched when the
    // entry is already there. A later rate or like must not silently move a
    // date the user chose.
    const user = await createUser();
    await ensureEntry(user, albumA, '1997-05-21');

    await ensureEntry(user, albumA, '2026-01-01');

    expect((await readEntry(user, albumA))!.listened_on).toBe('1997-05-21');
  });

  it('never sets a date on an entry that was created without one', async () => {
    const user = await createUser();
    await ensureEntry(user, albumA);

    await ensureEntry(user, albumA, '2026-01-01');

    expect((await readEntry(user, albumA))!.listened_on).toBeNull();
  });
});

describe('rejecting a date the database would refuse', () => {
  it.each(['banana', '2026-8-2', '20260802', '2026-02-30', '2026-13-01', '2026-04-31'])(
    'refuses %s before it reaches Postgres',
    (raw) => {
      expect(parseListenedOn(raw).ok).toBe(false);
    },
  );

  it.each(['2026-08-20', '1997-05-21', '2024-02-29', '2000-01-01'])('accepts %s', (raw) => {
    const parsed = parseListenedOn(raw);
    expect(parsed.ok && parsed.value).toBe(raw);
  });

  it('would genuinely have 500’d — Postgres rejects an impossible date', async () => {
    // Why the round-trip check exists rather than a bare `Date.parse`:
    // `Date.parse('2026-02-30')` returns a number, because V8 rolls the day
    // over into March. Postgres does not, and `ensureEntry` maps only `23503`,
    // so an unvalidated value would have thrown rather than rendered.
    const user = await createUser();

    const { error } = await ensureEntry(user, albumA, '2026-02-30');

    expect(error).not.toBeNull();
    expect(await readEntry(user, albumA)).toBeNull();
  });
});

describe('Want to Listen, through the same single path', () => {
  it('is cleared by an add that carries a date', async () => {
    // The architectural invariant: the clearing rule lives in
    // `ensure_collection_entry`, and adding a date changes nothing about which
    // path runs. No clearing logic is duplicated in the action.
    const user = await createUser();
    await admin.from('want_to_listen').insert({ user_id: user, album_id: albumA });

    await ensureEntry(user, albumA, '1997-05-21');

    const { count } = await admin
      .from('want_to_listen')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user)
      .eq('album_id', albumA);

    expect(count).toBe(0);
    expect((await readEntry(user, albumA))!.listened_on).toBe('1997-05-21');
  });

  it('clears only the album added, leaving the rest of the wishlist alone', async () => {
    const user = await createUser();
    await admin.from('want_to_listen').insert([
      { user_id: user, album_id: albumA },
      { user_id: user, album_id: albumB },
    ]);

    await ensureEntry(user, albumA, '2020-06-06');

    const { data } = await admin.from('want_to_listen').select('album_id').eq('user_id', user);
    expect(data!.map((r) => r.album_id)).toEqual([albumB]);
  });
});
