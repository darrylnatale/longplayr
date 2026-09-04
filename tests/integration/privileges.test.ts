import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * The privilege boundary, exercised through the surface an attacker would use.
 *
 * **This file exists because the defect it guards regenerates.** The default ACL
 * that produced it (`architecture.md` §16.5) is deliberately unchanged, so every
 * future table and function inherits the same unwanted privileges again. The
 * `CLAUDE.md` convention is the primary control; this is the mechanical one.
 *
 * **Boundaries are asserted behaviourally, not by reading the catalogue.** The
 * integration suite reaches the database only through PostgREST, so a privilege
 * is tested by attempting the operation as the role in question. That is the
 * stronger form — it proves what a caller can actually do rather than what a
 * grant table says.
 *
 * > **One half of the boundary is not reachable from here, and it is not
 * > silently omitted.** `TRUNCATE`, `TRIGGER`, `REFERENCES` and `MAINTAIN` have
 * > no PostgREST verb, so `anon` cannot be made to attempt them through this
 * > client. **The table-level revoke is verified by direct catalogue inspection
 * > instead**, recorded in the cycle's verification, and it has no automated
 * > regression coverage. A future cycle wanting that would need SQL access the
 * > suite does not currently have.
 *
 * **A `42501` alone proves nothing**, which is the trap `CLAUDE.md` warns about:
 * a missing grant and an RLS refusal share that code. Every negative assertion
 * here matches the *message* — `permission denied for function` — so a test
 * cannot pass because RLS happened to refuse for an unrelated reason.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const anon: SupabaseClient<Database> = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'correct-horse-battery';
const createdUserIds: string[] = [];
let album: string;

async function createUser(): Promise<{ id: string; email: string }> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `priv-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const id = data.user!.id;
  createdUserIds.push(id);
  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id, handle: `p_${stamp}`.slice(0, 30) });
  if (profileError) throw profileError;
  return { id, email };
}

async function signedIn(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

/** A grant failure, distinguished from an RLS refusal by its message. */
function isPermissionDenied(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '42501' && /permission denied for function/i.test(error.message ?? '');
}

/**
 * The intended boundary, stated as data.
 *
 * **A function added to `public` without being added here is not covered**, and
 * that is a known limit rather than an oversight: enumerating the catalogue
 * needs SQL this suite cannot issue. The convention in `CLAUDE.md` is what
 * catches the new object; this table is what stops an existing one regressing.
 */
const RESTRICTED_FROM_ANON = [
  {
    name: 'feed_activity',
    args: { p_viewer: null, p_limit: 1, p_before: null, p_before_id: null },
  },
  { name: 'ensure_collection_entry', args: { p_user_id: null, p_album_id: null } },
  { name: 'add_list_item', args: { p_list_id: null, p_album_id: null } },
  { name: 'remove_list_item', args: { p_list_id: null, p_album_id: null } },
  { name: 'reorder_list_item', args: { p_item_id: null, p_to_position: 0 } },
] as const;

const PUBLIC_TO_ANON = [
  { name: 'search_albums', args: { query: 'test', max_results: 1 } },
  { name: 'search_artists', args: { query: 'test', max_results: 1 } },
] as const;

beforeEach(async () => {
  // Re-ingested whenever the catalogue is empty rather than once. The
  // `service_role` case below deletes every album on purpose — that *is* the
  // privilege being asserted — so a fixture captured once would be a dangling
  // id by the time the trigger cases run.
  const { data: existing } = await admin.from('albums').select('id').order('mbid').limit(1);
  if (existing && existing.length > 0) {
    album = existing[0].id;
    return;
  }

  await ingestReleaseGroupPayload(singleArtistAlbum, admin);
  const { data } = await admin.from('albums').select('id').order('mbid').limit(1);
  album = data![0].id;
});

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('anon cannot execute the restricted project functions', () => {
  for (const fn of RESTRICTED_FROM_ANON) {
    it(`${fn.name} is refused for anon on a grant, not on RLS`, async () => {
      const { error } = await anon.rpc(fn.name as never, fn.args as never);

      // The assertion is the message. A bare 42501 would also be produced by an
      // RLS refusal, which would let this pass while the grant was wide open.
      expect(isPermissionDenied(error)).toBe(true);
    });
  }
});

describe('signed-out search keeps working', () => {
  for (const fn of PUBLIC_TO_ANON) {
    it(`${fn.name} remains executable by anon`, async () => {
      const { error } = await anon.rpc(fn.name as never, fn.args as never);

      expect(error).toBeNull();
    });
  }
});

describe('authenticated retains what it needs', () => {
  it('feed_activity executes and returns a page', async () => {
    const user = await createUser();
    const client = await signedIn(user.email);

    // The first page, exactly as `listFeed` requests it: the two cursor
    // parameters are optional and omitted rather than passed as null.
    const { data, error } = await client.rpc('feed_activity', {
      p_viewer: user.id,
      p_limit: 5,
    });

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('the mutation functions are reached, whatever they then decide', async () => {
    const user = await createUser();
    const client = await signedIn(user.email);

    // The call is expected to do nothing useful — the ids are the caller's own
    // or absent. What matters is that it is not turned away at the grant.
    const { error } = await client.rpc('ensure_collection_entry', {
      p_user_id: user.id,
      p_album_id: album,
    });

    expect(isPermissionDenied(error)).toBe(false);
  });
});

describe('service_role keeps the privileges the suite itself depends on', () => {
  it('can truncate the catalogue tables by delete-all, as every suite teardown does', async () => {
    // Not a formality: if the table-level revoke had caught service_role, this
    // is the operation that would break, and it would break every file at once.
    const { error } = await admin
      .from('albums')
      .delete()
      .neq('mbid', '00000000-0000-0000-0000-000000000000');

    expect(error).toBeNull();
  });
});

describe('triggers still fire after their functions lost PUBLIC EXECUTE', () => {
  it('set_updated_at moves updated_at on an update', async () => {
    const user = await createUser();
    const { data: before } = await admin
      .from('profiles')
      .select('updated_at')
      .eq('id', user.id)
      .single();

    await new Promise((resolve) => setTimeout(resolve, 10));
    const { error } = await admin
      .from('profiles')
      .update({ display_name: 'trigger probe' })
      .eq('id', user.id);
    expect(error).toBeNull();

    const { data: after } = await admin
      .from('profiles')
      .select('updated_at')
      .eq('id', user.id)
      .single();

    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(
      new Date(before!.updated_at).getTime(),
    );
  });

  it('sync_relisten_count still increments the denormalised counter', async () => {
    const user = await createUser();
    const { data: entry, error: entryError } = await admin.rpc('ensure_collection_entry', {
      p_user_id: user.id,
      p_album_id: album,
    });
    if (entryError) throw entryError;

    const { error } = await admin
      .from('relisten_events')
      .insert({ collection_entry_id: entry!.id });
    expect(error).toBeNull();

    const { data: after } = await admin
      .from('collection_entries')
      .select('relisten_count')
      .eq('id', entry!.id)
      .single();

    expect(after!.relisten_count).toBe(1);
  });
});
