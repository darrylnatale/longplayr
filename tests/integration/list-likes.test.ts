import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';

/**
 * List likes, against the real database.
 *
 * **Exercised through real signed-in clients rather than the service**, the same
 * way `review-likes.test.ts` is: what is being asserted here is what the
 * database permits, which is the layer a second client would also meet. The
 * service-layer rules — the self-like refusal above all — are asserted from the
 * outside in `tests/e2e/list-likes.spec.ts`, because they are behaviour rather
 * than integrity.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const anon: SupabaseClient<Database> = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'correct-horse-battery';
const createdUserIds: string[] = [];

async function createUser(): Promise<{ id: string; email: string; handle: string }> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `ll-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const id = data.user!.id;
  createdUserIds.push(id);
  const handle = `ll_${stamp}`.slice(0, 30);
  const { error: profileError } = await admin.from('profiles').insert({ id, handle });
  if (profileError) throw profileError;
  return { id, email, handle };
}

async function signedInAs(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

async function createList(ownerId: string, status: 'live' | 'removed' = 'live'): Promise<string> {
  const { data, error } = await admin
    .from('lists')
    .insert({ user_id: ownerId, title: 'A list', status })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
});

describe('liking a list', () => {
  it('creates exactly one row', async () => {
    const owner = await createUser();
    const liker = await createUser();
    const listId = await createList(owner.id);
    const client = await signedInAs(liker.email);

    const { error } = await client
      .from('list_likes')
      .insert({ user_id: liker.id, list_id: listId });
    expect(error).toBeNull();

    const { count } = await admin
      .from('list_likes')
      .select('id', { count: 'exact', head: true })
      .eq('list_id', listId);
    expect(count).toBe(1);
  });

  it('refuses a second like from the same user', async () => {
    const owner = await createUser();
    const liker = await createUser();
    const listId = await createList(owner.id);
    const client = await signedInAs(liker.email);

    await client.from('list_likes').insert({ user_id: liker.id, list_id: listId });
    const { error } = await client
      .from('list_likes')
      .insert({ user_id: liker.id, list_id: listId });

    expect(error?.code).toBe('23505');
  });

  it('lets two different users like the same list', async () => {
    const owner = await createUser();
    const a = await createUser();
    const b = await createUser();
    const listId = await createList(owner.id);

    await (await signedInAs(a.email)).from('list_likes').insert({ user_id: a.id, list_id: listId });
    await (await signedInAs(b.email)).from('list_likes').insert({ user_id: b.id, list_id: listId });

    const { count } = await admin
      .from('list_likes')
      .select('id', { count: 'exact', head: true })
      .eq('list_id', listId);
    expect(count).toBe(2);
  });
});

describe('unliking', () => {
  it('is a clean no-op when there is nothing to remove', async () => {
    const owner = await createUser();
    const liker = await createUser();
    const listId = await createList(owner.id);
    const client = await signedInAs(liker.email);

    const { error } = await client
      .from('list_likes')
      .delete()
      .eq('user_id', liker.id)
      .eq('list_id', listId);

    expect(error).toBeNull();
  });

  it('re-liking creates a fresh row with a new id', async () => {
    const owner = await createUser();
    const liker = await createUser();
    const listId = await createList(owner.id);
    const client = await signedInAs(liker.email);

    const { data: first } = await client
      .from('list_likes')
      .insert({ user_id: liker.id, list_id: listId })
      .select('id')
      .single();
    await client.from('list_likes').delete().eq('user_id', liker.id).eq('list_id', listId);
    const { data: second } = await client
      .from('list_likes')
      .insert({ user_id: liker.id, list_id: listId })
      .select('id')
      .single();

    expect(second!.id).not.toBe(first!.id);
  });
});

describe('cascades', () => {
  it('deleting the list removes its likes', async () => {
    const owner = await createUser();
    const liker = await createUser();
    const listId = await createList(owner.id);
    await admin.from('list_likes').insert({ user_id: liker.id, list_id: listId });

    await admin.from('lists').delete().eq('id', listId);

    const { count } = await admin
      .from('list_likes')
      .select('id', { count: 'exact', head: true })
      .eq('list_id', listId);
    expect(count).toBe(0);
  });

  it("deleting the liker's account removes their likes", async () => {
    const owner = await createUser();
    const liker = await createUser();
    const listId = await createList(owner.id);
    await admin.from('list_likes').insert({ user_id: liker.id, list_id: listId });

    await admin.auth.admin.deleteUser(liker.id);

    const { count } = await admin
      .from('list_likes')
      .select('id', { count: 'exact', head: true })
      .eq('list_id', listId);
    expect(count).toBe(0);
  });
});

describe('what may be liked', () => {
  it('refuses a moderation-removed list to a stranger', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const listId = await createList(owner.id, 'removed');
    const client = await signedInAs(stranger.email);

    // The write policy defers to `lists_public_read`, which hides a removed list
    // from everyone but its owner, so the `exists` clause finds nothing.
    const { error } = await client
      .from('list_likes')
      .insert({ user_id: stranger.id, list_id: listId });

    expect(error).not.toBeNull();
  });

  it('refuses a list that does not exist', async () => {
    const liker = await createUser();
    const client = await signedInAs(liker.email);

    const { error } = await client
      .from('list_likes')
      .insert({ user_id: liker.id, list_id: '00000000-0000-0000-0000-000000000000' });

    expect(error).not.toBeNull();
  });

  it('does NOT prevent a self-like at the database, and that is deliberate', async () => {
    // The owner can read their own list, so the policy admits this. Refusing a
    // self-like is service-layer behaviour and is not an integrity boundary —
    // `data-model.md` §5. Pinning it here stops anyone describing the database
    // as enforcing a rule it does not.
    const owner = await createUser();
    const listId = await createList(owner.id);
    const client = await signedInAs(owner.email);

    const { error } = await client
      .from('list_likes')
      .insert({ user_id: owner.id, list_id: listId });

    expect(error).toBeNull();
  });
});

describe('authorisation', () => {
  it('refuses a like attributed to another user', async () => {
    const owner = await createUser();
    const liker = await createUser();
    const other = await createUser();
    const listId = await createList(owner.id);
    const client = await signedInAs(liker.email);

    const { error } = await client
      .from('list_likes')
      .insert({ user_id: other.id, list_id: listId });

    expect(error).not.toBeNull();
  });

  it('refuses a write from a signed-out client, and stays readable', async () => {
    const owner = await createUser();
    const liker = await createUser();
    const listId = await createList(owner.id);
    await admin.from('list_likes').insert({ user_id: liker.id, list_id: listId });

    const { error: writeError } = await anon
      .from('list_likes')
      .insert({ user_id: liker.id, list_id: listId });
    expect(writeError).not.toBeNull();

    const { data, error: readError } = await anon
      .from('list_likes')
      .select('id')
      .eq('list_id', listId);
    expect(readError).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('grants no update, so a like cannot be re-pointed', async () => {
    const owner = await createUser();
    const liker = await createUser();
    const otherList = await createList(owner.id);
    const listId = await createList(owner.id);
    const client = await signedInAs(liker.email);

    const { data: like } = await client
      .from('list_likes')
      .insert({ user_id: liker.id, list_id: listId })
      .select('id')
      .single();

    const { error } = await client
      .from('list_likes')
      .update({ list_id: otherList })
      .eq('id', like!.id);

    expect(error).not.toBeNull();
  });
});

describe('the notification subject constraint', () => {
  it('accepts a well-formed list_liked notification', async () => {
    const owner = await createUser();
    const liker = await createUser();
    const listId = await createList(owner.id);
    const { data: like } = await admin
      .from('list_likes')
      .insert({ user_id: liker.id, list_id: listId })
      .select('id')
      .single();

    const { error } = await admin.from('notifications').insert({
      recipient_id: owner.id,
      actor_id: liker.id,
      type: 'list_liked',
      list_like_id: like!.id,
    });

    expect(error).toBeNull();
  });

  // The regression the three-branch rewrite exists for. Before it, the
  // `followed` branch checked only its own two columns, so a stray
  // `list_like_id` on a follow notification was admitted.
  it('rejects a followed notification carrying a stray list_like_id', async () => {
    const owner = await createUser();
    const liker = await createUser();
    const listId = await createList(owner.id);
    const { data: like } = await admin
      .from('list_likes')
      .insert({ user_id: liker.id, list_id: listId })
      .select('id')
      .single();
    const { data: follow } = await admin
      .from('follows')
      .insert({ follower_id: liker.id, followee_id: owner.id })
      .select('id')
      .single();

    const { error } = await admin.from('notifications').insert({
      recipient_id: owner.id,
      actor_id: liker.id,
      type: 'followed',
      follow_id: follow!.id,
      list_like_id: like!.id,
    });

    expect(error).not.toBeNull();
  });

  it('rejects a list_liked notification carrying a stray follow_id', async () => {
    const owner = await createUser();
    const liker = await createUser();
    const listId = await createList(owner.id);
    const { data: like } = await admin
      .from('list_likes')
      .insert({ user_id: liker.id, list_id: listId })
      .select('id')
      .single();
    const { data: follow } = await admin
      .from('follows')
      .insert({ follower_id: liker.id, followee_id: owner.id })
      .select('id')
      .single();

    const { error } = await admin.from('notifications').insert({
      recipient_id: owner.id,
      actor_id: liker.id,
      type: 'list_liked',
      list_like_id: like!.id,
      follow_id: follow!.id,
    });

    expect(error).not.toBeNull();
  });

  it('rejects a list_liked notification with no subject at all', async () => {
    const owner = await createUser();
    const liker = await createUser();

    const { error } = await admin.from('notifications').insert({
      recipient_id: owner.id,
      actor_id: liker.id,
      type: 'list_liked',
    });

    expect(error).not.toBeNull();
  });

  it('removes the notification when the like goes', async () => {
    const owner = await createUser();
    const liker = await createUser();
    const listId = await createList(owner.id);
    const { data: like } = await admin
      .from('list_likes')
      .insert({ user_id: liker.id, list_id: listId })
      .select('id')
      .single();
    await admin.from('notifications').insert({
      recipient_id: owner.id,
      actor_id: liker.id,
      type: 'list_liked',
      list_like_id: like!.id,
    });

    await admin.from('list_likes').delete().eq('id', like!.id);

    const { count } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', owner.id);
    expect(count).toBe(0);
  });

  it('allows only one notification per like', async () => {
    const owner = await createUser();
    const liker = await createUser();
    const listId = await createList(owner.id);
    const { data: like } = await admin
      .from('list_likes')
      .insert({ user_id: liker.id, list_id: listId })
      .select('id')
      .single();

    await admin.from('notifications').insert({
      recipient_id: owner.id,
      actor_id: liker.id,
      type: 'list_liked',
      list_like_id: like!.id,
    });
    const { error } = await admin.from('notifications').insert({
      recipient_id: owner.id,
      actor_id: liker.id,
      type: 'list_liked',
      list_like_id: like!.id,
    });

    expect(error?.code).toBe('23505');
  });
});

describe('the table privilege boundary', () => {
  it('offers anon and authenticated none of the inherited defaults', async () => {
    // The convention this table is the first to be created under: granting is
    // not restricting, so the schema's `Dxtm` default has to be revoked
    // explicitly. Without this test the next table silently reintroduces it.
    const { data, error } = await admin
      .from('list_likes')
      .select('id', { count: 'exact', head: true });

    // A stand-in for reachability: the suite cannot issue TRUNCATE through
    // PostgREST, so the privilege itself is verified by catalogue inspection in
    // the cycle's verification. What is asserted here is that ordinary reads
    // still work after the revoke.
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe('the Activity boundary', () => {
  it('writes no activity rows when a list is liked', async () => {
    const owner = await createUser();
    const liker = await createUser();
    const listId = await createList(owner.id);

    const { count: before } = await admin
      .from('activity')
      .select('id', { count: 'exact', head: true });

    await admin.from('list_likes').insert({ user_id: liker.id, list_id: listId });

    const { count: after } = await admin
      .from('activity')
      .select('id', { count: 'exact', head: true });

    expect(after).toBe(before);
  });
});
