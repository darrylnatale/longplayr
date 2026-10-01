import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';

/**
 * Statements of reasons — Phase 6 slice 3a (`architecture.md` §16.10).
 *
 * **What this suite is really testing is a column grant**, and that is the
 * reason it exists as its own file. §16.10a says the acting administrator is
 * recorded and never shown. The RLS policy on `moderation_actions` scopes rows
 * to the subject and **says nothing whatever about `actor_id`** — so if the
 * grant were table-level, every moderated person could read the name of the
 * person who moderated them, and **every row policy would still look correct.**
 *
 * **RLS answers which rows; grants answer which columns.** §92 and §94 each
 * paid for that lesson after the fact. This is the first slice to assert it
 * before shipping, and the assertion that matters is a query that *fails*.
 *
 * **Asserted in both directions throughout.** A denial proves nothing unless a
 * legitimate read through the same token succeeds — otherwise a grant that
 * denies everything is indistinguishable from one that is right.
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

/** Postgres `insufficient_privilege` — what a missing column grant returns. */
const PERMISSION_DENIED = '42501';
/** Postgres `check_violation` — what the Art 17 constraint returns. */
const CHECK_VIOLATION = '23514';

const PASSWORD = 'correct-horse-battery';
const createdUserIds: string[] = [];

let moderator: { id: string; handle: string; email: string };
let author: { id: string; handle: string; email: string };
let stranger: { id: string; handle: string; email: string };
let asAuthor: SupabaseClient<Database>;
let asStranger: SupabaseClient<Database>;
const anon: SupabaseClient<Database> = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let albumId = '';
let reviewId = '';
let listId = '';

async function createUser(prefix: string, isAdmin = false) {
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
  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id, handle, is_admin: isAdmin });
  if (profileError) throw profileError;

  return { id, handle, email };
}

async function signIn(account: { email: string }) {
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: account.email,
    password: PASSWORD,
  });
  if (error) throw error;
  return client;
}

beforeAll(async () => {
  moderator = await createUser('mod', true);
  author = await createUser('subj');
  stranger = await createUser('other');
  asAuthor = await signIn(author);
  asStranger = await signIn(stranger);

  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const { data: album, error: albumError } = await admin
    .from('albums')
    .insert({
      mbid: crypto.randomUUID(),
      title: `Statements ${stamp}`,
      display_credit: 'Someone',
      primary_type: 'album',
    })
    .select('id')
    .single();
  if (albumError) throw albumError;
  albumId = album.id;

  const { data: entry, error: entryError } = await admin
    .from('collection_entries')
    .insert({ user_id: author.id, album_id: albumId })
    .select('id')
    .single();
  if (entryError) throw entryError;

  const { data: review, error: reviewError } = await admin
    .from('reviews')
    .insert({ collection_entry_id: entry.id, body: 'A review about to be removed.' })
    .select('id')
    .single();
  if (reviewError) throw reviewError;
  reviewId = review.id;

  const { data: list, error: listError } = await admin
    .from('lists')
    .insert({ user_id: author.id, title: `Statements List ${stamp}` })
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

describe('the action and its statement are written together', () => {
  it('removes a review and records why, in one call', async () => {
    const { data: action, error } = await admin.rpc('moderate_review', {
      p_actor_id: moderator.id,
      p_review_id: reviewId,
      p_status: 'removed',
      p_ground: 'spam or advertising',
      p_statement: 'Removed for promotional content.',
    });
    expect(error).toBeNull();
    expect(action).toBeTruthy();

    // Both halves, from the one call. This is the §92 defect's absence.
    const { data: review } = await admin
      .from('reviews')
      .select('status')
      .eq('id', reviewId)
      .single();
    expect(review?.status).toBe('removed');

    const { data: rows } = await admin
      .from('moderation_actions')
      .select('kind, subject_label, subject_user_id, statement')
      .eq('review_id', reviewId);
    expect(rows).toHaveLength(1);
    expect(rows![0].kind).toBe('content_removed');
    expect(rows![0].subject_user_id).toBe(author.id);
    // The snapshot names the album, so the statement reads without the review.
    expect(rows![0].subject_label).toContain('Statements');
  });

  it('refuses a restriction with no statement, in the schema', async () => {
    const { error } = await admin.rpc('moderate_list', {
      p_actor_id: moderator.id,
      p_list_id: listId,
      p_status: 'removed',
      p_ground: 'harassment or hate',
      p_statement: '   ',
    });
    // **The obligation is a constraint, not a service-layer convention.** A
    // future caller that forgets the statement cannot write the restriction.
    expect(error?.code).toBe(CHECK_VIOLATION);

    const { data: list } = await admin.from('lists').select('status').eq('id', listId).single();
    expect(list?.status).toBe('live');
  });

  it('returns null for a target that does not exist', async () => {
    const { data, error } = await admin.rpc('moderate_review', {
      p_actor_id: moderator.id,
      p_review_id: crypto.randomUUID(),
      p_status: 'removed',
      p_ground: 'x',
      p_statement: 'y',
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe('what the moderated person can read', () => {
  it('reads the statement addressed to them', async () => {
    // The positive direction. Without it, a grant denying everything would
    // satisfy every denial below.
    const { data, error } = await asAuthor
      .from('moderation_actions')
      .select('id, kind, subject_label, ground, statement, created_at, acknowledged_at');
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
    expect(data![0].statement).toContain('promotional');
  });

  it('CANNOT read which administrator acted', async () => {
    // **The assertion this file exists for.** The row policy is satisfied — this
    // is the subject's own row — and the request still fails, because the
    // column is in no grant. §16.10e.
    const { error } = await asAuthor.from('moderation_actions').select('actor_id');
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it('cannot mark one read, because that write belongs to the service role', async () => {
    const { error } = await asAuthor
      .from('moderation_actions')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('review_id', reviewId);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it('cannot write a statement of its own', async () => {
    const { error } = await asAuthor.from('moderation_actions').insert({
      actor_id: author.id,
      subject_user_id: author.id,
      kind: 'content_removed',
      subject_label: 'invented',
      ground: 'invented',
      statement: 'invented',
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it('cannot call the moderation functions', async () => {
    // EXECUTE is revoked from PUBLIC, anon and authenticated. Postgres grants
    // it to PUBLIC on creation, so the revoke is the whole control — §16.5.
    const { error } = await asAuthor.rpc('moderate_review', {
      p_actor_id: author.id,
      p_review_id: reviewId,
      p_status: 'live',
      p_ground: 'self-service',
      p_statement: 'restoring my own content',
    });
    expect(error).not.toBeNull();
  });
});

describe('what everybody else can read', () => {
  it('another signed-in user sees none of it', async () => {
    const { data, error } = await asStranger.from('moderation_actions').select('id, statement');
    // RLS, not privileges: the query is permitted and matches no row.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('a signed-out visitor cannot read the table at all', async () => {
    const { error } = await anon.from('moderation_actions').select('id');
    expect(error).not.toBeNull();
  });
});

describe('what survives, and what must not', () => {
  it('keeps the statement when the author deletes the content', async () => {
    // **The decision this proves is §16.10c-i**, and the first draft of the
    // constraint made this delete fail. `on delete set null` plus the snapshot
    // is what lets the explanation outlive its subject — a cascade here would
    // mean deleting your review erases the record of why it was removed.
    const { error } = await admin.from('reviews').delete().eq('id', reviewId);
    expect(error).toBeNull();

    const { data } = await admin
      .from('moderation_actions')
      .select('review_id, subject_label, statement')
      .eq('subject_user_id', author.id);
    expect(data?.length).toBeGreaterThan(0);
    expect(data![0].review_id).toBeNull();
    expect(data![0].subject_label).toContain('Statements');
    expect(data![0].statement).toContain('promotional');
  });

  it('destroys the statement when the account is deleted', async () => {
    // **The non-negotiable wins, deliberately.** `CLAUDE.md`: account deletion
    // is a hard delete with a complete cascade, and an orphaned row is a
    // privacy failure. §16.10c records that a retention duty may pull the other
    // way and that it is a question for a lawyer, not for this test.
    const doomed = await createUser('doomed');
    const { error: writeError } = await admin.rpc('moderate_account', {
      p_actor_id: moderator.id,
      p_target_id: doomed.id,
      p_status: 'suspended',
      p_ground: 'repeated violations',
      p_statement: 'Your account is suspended.',
    });
    expect(writeError).toBeNull();

    const { count: before } = await admin
      .from('moderation_actions')
      .select('id', { count: 'exact', head: true })
      .eq('subject_user_id', doomed.id);
    expect(before).toBe(1);

    await admin.auth.admin.deleteUser(doomed.id);

    const { count: after } = await admin
      .from('moderation_actions')
      .select('id', { count: 'exact', head: true })
      .eq('subject_user_id', doomed.id);
    expect(after).toBe(0);
  });
});
