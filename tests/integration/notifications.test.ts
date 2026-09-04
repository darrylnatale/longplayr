import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { collaborationAlbum, singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';
import { cursorFrom } from '@/app/notifications/pagination';

/**
 * Notifications, against the real database.
 *
 * **The privacy boundary is the point of this file, and it is proved with two
 * genuinely signed-in users rather than a service-role client.** Notifications
 * are the first private rows in this schema — every other social table is
 * world-readable — so a test that queried them as `service_role` would bypass
 * RLS entirely and pass while proving nothing.
 *
 * The services build a cookie-bound client and cannot be called without a
 * request scope, so these issue the statements the services issue. Where that
 * matters the replication is exact and says so.
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

const anon: SupabaseClient<Database> = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'correct-horse-battery';
const ANY_UUID = '0b0e4f1e-1111-4000-8000-000000000001';
const createdUserIds: string[] = [];
let albumA: string;

async function createUser(): Promise<{ id: string; email: string; handle: string }> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `nt-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const id = data.user!.id;
  createdUserIds.push(id);
  const handle = `nt_${stamp}`.slice(0, 30);
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

async function writeReview(userId: string, albumId: string) {
  const { data: entry, error } = await admin.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
  });
  if (error) throw error;

  const { data: review, error: reviewError } = await admin
    .from('reviews')
    .insert({ collection_entry_id: (entry as unknown as { id: string }).id, body: 'A paragraph.' })
    .select()
    .single();
  if (reviewError) throw reviewError;
  return review;
}

/**
 * `recordFollowed`'s insert, as the acting user.
 *
 * **No `.select()`, exactly as the service has none.** The read policy is
 * recipient-scoped, so an actor cannot read the row they just created and
 * `INSERT … RETURNING` is refused. That is correct — the notification is the
 * recipient's private row — and it means any write path here must not ask for
 * the inserted row back.
 */
function notifyFollowed(
  client: SupabaseClient<Database>,
  recipientId: string,
  actorId: string,
  followId: string,
) {
  return client.from('notifications').insert({
    recipient_id: recipientId,
    actor_id: actorId,
    type: 'followed',
    follow_id: followId,
  });
}

async function notificationsFor(recipientId: string) {
  const { data, error } = await admin
    .from('notifications')
    .select('*')
    .eq('recipient_id', recipientId);
  if (error) throw error;
  return data ?? [];
}

beforeEach(async () => {
  await admin.from('notifications').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('follows').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('review_likes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
});

beforeAll(async () => {
  await ingestReleaseGroupPayload(singleArtistAlbum, admin);
  await ingestReleaseGroupPayload(collaborationAlbum, admin);
  const { data } = await admin.from('albums').select('id, mbid').order('mbid');
  albumA = data![0].id;
});

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('schema', () => {
  it('refuses a list_liked notification carrying a follow as its subject', async () => {
    // **This test previously asserted that `list_liked` was not a member of the
    // enum at all** — a schema-absence proxy pinning the Phase 3 boundary, whose
    // comment said adding the member speculatively should break a test. Phase 4
    // slice 2 added it deliberately, with the table its foreign key needs, so
    // the proxy did its job and is now converted rather than deleted.
    //
    // What guards the seam now is stronger: the type exists, and the rewritten
    // `notifications_subject_matches_type` rejects it unless its own subject is
    // the one present. The same insert still fails; it fails on the constraint
    // instead of on the enum. See §39 for the identical conversion when Activity
    // landed.
    const [recipient, actor] = [await createUser(), await createUser()];
    const { data: follow } = await admin
      .from('follows')
      .insert({ follower_id: actor.id, followee_id: recipient.id })
      .select()
      .single();

    const { error } = await admin.from('notifications').insert({
      recipient_id: recipient.id,
      actor_id: actor.id,
      type: 'list_liked',
      follow_id: follow!.id,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/notifications_subject_matches_type|check constraint/i);
  });

  it('rejects a subject that does not match its type', async () => {
    const [recipient, actor] = [await createUser(), await createUser()];
    const { data: follow } = await admin
      .from('follows')
      .insert({ follower_id: actor.id, followee_id: recipient.id })
      .select()
      .single();

    // A `review_liked` row carrying a follow is exactly what the check exists
    // to refuse.
    const { error } = await admin.from('notifications').insert({
      recipient_id: recipient.id,
      actor_id: actor.id,
      type: 'review_liked',
      follow_id: follow!.id,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/notifications_subject_matches_type/);
  });

  it('refuses a row carrying no subject at all', async () => {
    // The `else false` branch, reached by a type with neither column set. A
    // `CASE` without it would return NULL, and NULL satisfies a CHECK.
    const [recipient, actor] = [await createUser(), await createUser()];
    const { error } = await admin.from('notifications').insert({
      recipient_id: recipient.id,
      actor_id: actor.id,
      type: 'followed',
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/notifications_subject_matches_type/);
  });

  it('allows one notification per follow and refuses a second', async () => {
    const [recipient, actor] = [await createUser(), await createUser()];
    const { data: follow } = await admin
      .from('follows')
      .insert({ follower_id: actor.id, followee_id: recipient.id })
      .select()
      .single();

    const first = await admin.from('notifications').insert({
      recipient_id: recipient.id,
      actor_id: actor.id,
      type: 'followed',
      follow_id: follow!.id,
    });
    expect(first.error).toBeNull();

    const second = await admin.from('notifications').insert({
      recipient_id: recipient.id,
      actor_id: actor.id,
      type: 'followed',
      follow_id: follow!.id,
    });
    expect(second.error?.code).toBe('23505');
  });

  it('allows one notification per review like and refuses a second', async () => {
    const [author, liker] = [await createUser(), await createUser()];
    const review = await writeReview(author.id, albumA);
    const { data: rl } = await admin
      .from('review_likes')
      .insert({ user_id: liker.id, review_id: review.id })
      .select()
      .single();

    const first = await admin.from('notifications').insert({
      recipient_id: author.id,
      actor_id: liker.id,
      type: 'review_liked',
      review_like_id: rl!.id,
    });
    expect(first.error).toBeNull();

    const second = await admin.from('notifications').insert({
      recipient_id: author.id,
      actor_id: liker.id,
      type: 'review_liked',
      review_like_id: rl!.id,
    });
    expect(second.error?.code).toBe('23505');
  });

  it('permits many notifications of the other type alongside', async () => {
    // Both subject columns are nullable and a unique constraint permits many
    // NULLs, which is what lets the two types coexist without a partial index.
    const [recipient, a, b] = [await createUser(), await createUser(), await createUser()];
    for (const actor of [a, b]) {
      const { data: follow } = await admin
        .from('follows')
        .insert({ follower_id: actor.id, followee_id: recipient.id })
        .select()
        .single();
      const { error } = await admin.from('notifications').insert({
        recipient_id: recipient.id,
        actor_id: actor.id,
        type: 'followed',
        follow_id: follow!.id,
      });
      expect(error).toBeNull();
    }

    expect(await notificationsFor(recipient.id)).toHaveLength(2);
  });
});

describe('cascades — a notification is the current existence of its source', () => {
  it('unfollowing removes the notification', async () => {
    const [recipient, actor] = [await createUser(), await createUser()];
    const { data: follow } = await admin
      .from('follows')
      .insert({ follower_id: actor.id, followee_id: recipient.id })
      .select()
      .single();
    await admin.from('notifications').insert({
      recipient_id: recipient.id,
      actor_id: actor.id,
      type: 'followed',
      follow_id: follow!.id,
    });
    expect(await notificationsFor(recipient.id)).toHaveLength(1);

    await admin.from('follows').delete().eq('id', follow!.id);
    expect(await notificationsFor(recipient.id)).toHaveLength(0);
  });

  it('unliking removes the notification', async () => {
    const [author, liker] = [await createUser(), await createUser()];
    const review = await writeReview(author.id, albumA);
    const { data: rl } = await admin
      .from('review_likes')
      .insert({ user_id: liker.id, review_id: review.id })
      .select()
      .single();
    await admin.from('notifications').insert({
      recipient_id: author.id,
      actor_id: liker.id,
      type: 'review_liked',
      review_like_id: rl!.id,
    });

    await admin.from('review_likes').delete().eq('id', rl!.id);
    expect(await notificationsFor(author.id)).toHaveLength(0);
  });

  it('deleting the review removes the notification', async () => {
    const [author, liker] = [await createUser(), await createUser()];
    const review = await writeReview(author.id, albumA);
    const { data: rl } = await admin
      .from('review_likes')
      .insert({ user_id: liker.id, review_id: review.id })
      .select()
      .single();
    await admin.from('notifications').insert({
      recipient_id: author.id,
      actor_id: liker.id,
      type: 'review_liked',
      review_like_id: rl!.id,
    });

    await admin.from('reviews').delete().eq('id', review.id);
    expect(await notificationsFor(author.id)).toHaveLength(0);
  });

  it('deleting the actor removes the notifications they caused', async () => {
    const [recipient, actor] = [await createUser(), await createUser()];
    const { data: follow } = await admin
      .from('follows')
      .insert({ follower_id: actor.id, followee_id: recipient.id })
      .select()
      .single();
    await admin.from('notifications').insert({
      recipient_id: recipient.id,
      actor_id: actor.id,
      type: 'followed',
      follow_id: follow!.id,
    });

    await admin.auth.admin.deleteUser(actor.id);
    expect(await notificationsFor(recipient.id)).toHaveLength(0);
  });

  it('re-following after an unfollow produces a new notification', async () => {
    const [recipient, actor] = [await createUser(), await createUser()];

    const { data: first } = await admin
      .from('follows')
      .insert({ follower_id: actor.id, followee_id: recipient.id })
      .select()
      .single();
    await admin.from('notifications').insert({
      recipient_id: recipient.id,
      actor_id: actor.id,
      type: 'followed',
      follow_id: first!.id,
    });
    await admin.from('follows').delete().eq('id', first!.id);

    const { data: second } = await admin
      .from('follows')
      .insert({ follower_id: actor.id, followee_id: recipient.id })
      .select()
      .single();
    const { error } = await admin.from('notifications').insert({
      recipient_id: recipient.id,
      actor_id: actor.id,
      type: 'followed',
      follow_id: second!.id,
    });

    expect(error).toBeNull();
    const rows = await notificationsFor(recipient.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].follow_id).toBe(second!.id);
  });
});

describe('privacy — the first private table in this schema', () => {
  it('a recipient reads only their own, and another user sees none of them', async () => {
    const [recipient, actor, stranger] = [
      await createUser(),
      await createUser(),
      await createUser(),
    ];
    const { data: follow } = await admin
      .from('follows')
      .insert({ follower_id: actor.id, followee_id: recipient.id })
      .select()
      .single();
    await admin.from('notifications').insert({
      recipient_id: recipient.id,
      actor_id: actor.id,
      type: 'followed',
      follow_id: follow!.id,
    });

    const asRecipient = await signedInAs(recipient.email);
    const mine = await asRecipient.from('notifications').select('*');
    expect(mine.error).toBeNull();
    expect(mine.data).toHaveLength(1);

    // **The assertion the whole feature rests on.** A copied `using (true)`
    // policy would return the row here.
    const asStranger = await signedInAs(stranger.email);
    const theirs = await asStranger.from('notifications').select('*');
    expect(theirs.error).toBeNull();
    expect(theirs.data).toHaveLength(0);

    // Not even the person who caused it may read it.
    const asActor = await signedInAs(actor.email);
    const caused = await asActor.from('notifications').select('*');
    expect(caused.data).toHaveLength(0);
  });

  it('an anonymous visitor reads nothing', async () => {
    const [recipient, actor] = [await createUser(), await createUser()];
    const { data: follow } = await admin
      .from('follows')
      .insert({ follower_id: actor.id, followee_id: recipient.id })
      .select()
      .single();
    await admin.from('notifications').insert({
      recipient_id: recipient.id,
      actor_id: actor.id,
      type: 'followed',
      follow_id: follow!.id,
    });

    const { data } = await anon.from('notifications').select('*');
    expect(data ?? []).toHaveLength(0);
  });

  it('an actor may insert as themselves and not as somebody else', async () => {
    const [recipient, actor, impostor] = [
      await createUser(),
      await createUser(),
      await createUser(),
    ];
    const { data: follow } = await admin
      .from('follows')
      .insert({ follower_id: actor.id, followee_id: recipient.id })
      .select()
      .single();

    const asActor = await signedInAs(actor.email);
    const mine = await notifyFollowed(asActor, recipient.id, actor.id, follow!.id);
    expect(mine.error).toBeNull();
    expect(await notificationsFor(recipient.id)).toHaveLength(1);

    // The actor wrote it and still cannot read it back — asking for the
    // inserted row is refused, which is why the service never uses RETURNING.
    const returning = await asActor
      .from('notifications')
      .insert({
        recipient_id: recipient.id,
        actor_id: actor.id,
        type: 'followed',
        follow_id: follow!.id,
      })
      .select();
    expect(returning.error).not.toBeNull();

    await admin.from('notifications').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    // Forging the actor is refused by the insert policy.
    const asImpostor = await signedInAs(impostor.email);
    const forged = await notifyFollowed(asImpostor, recipient.id, actor.id, follow!.id);
    expect(forged.error).not.toBeNull();
  });
});

describe('read state', () => {
  async function oneNotification() {
    const [recipient, actor] = [await createUser(), await createUser()];
    const { data: follow } = await admin
      .from('follows')
      .insert({ follower_id: actor.id, followee_id: recipient.id })
      .select()
      .single();
    const { data: row } = await admin
      .from('notifications')
      .insert({
        recipient_id: recipient.id,
        actor_id: actor.id,
        type: 'followed',
        follow_id: follow!.id,
      })
      .select()
      .single();
    return { recipient, actor, row: row! };
  }

  it('the recipient can mark their own read, and it is idempotent', async () => {
    const { recipient, row } = await oneNotification();
    const client = await signedInAs(recipient.email);

    const first = await client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('read_at', null);
    expect(first.error).toBeNull();

    const [after] = await notificationsFor(recipient.id);
    expect(after.read_at).not.toBeNull();

    // Running it again matches nothing and is still a success.
    const again = await client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('read_at', null);
    expect(again.error).toBeNull();
  });

  it('another user cannot mark it read', async () => {
    const { recipient, row } = await oneNotification();
    const stranger = await createUser();
    const client = await signedInAs(stranger.email);

    await client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', row.id);

    // RLS matches no row, so nothing changed — and no error was returned, which
    // is deliberate: an error would confirm the row exists.
    const [unchanged] = await notificationsFor(recipient.id);
    expect(unchanged.read_at).toBeNull();
  });

  it('the recipient cannot rewrite anything but read_at', async () => {
    // RLS cannot restrict columns; the column-level grant is what does it.
    const { recipient, row } = await oneNotification();
    const client = await signedInAs(recipient.email);

    const { error } = await client
      .from('notifications')
      .update({ actor_id: recipient.id })
      .eq('id', row.id);

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/permission|denied|column/i);
  });
});

describe('keyset pagination — the boundary must not move', () => {
  /**
   * The keyset query `listNotifications` issues, with an explicit cursor.
   *
   * **Replicated rather than called**, for the reason this file records at the
   * top: the service builds a cookie-bound client. The filter string below is
   * character-for-character the one the service composes, so a change there that
   * broke the predicate would break these too.
   */
  async function page(
    client: SupabaseClient<Database>,
    limit: number,
    cursor?: { before: string; beforeId: string },
  ) {
    let q = client
      .from('notifications')
      .select('id, created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (cursor) {
      q = q.or(
        `created_at.lt.${cursor.before},and(created_at.eq.${cursor.before},id.lt.${cursor.beforeId})`,
      );
    }

    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Notifications at timestamps chosen by the test rather than by `now()`.
   *
   * `created_at` carries a default but is writable, which is what makes the
   * equal-timestamp and sub-millisecond cases constructible instead of hoped
   * for.
   */
  async function seed(recipientId: string, stamps: string[]) {
    const rows = [];
    for (const created_at of stamps) {
      const actor = await createUser();
      const { data: follow, error: followError } = await admin
        .from('follows')
        .insert({ follower_id: actor.id, followee_id: recipientId })
        .select()
        .single();
      if (followError) throw followError;

      const { data, error } = await admin
        .from('notifications')
        .insert({
          recipient_id: recipientId,
          actor_id: actor.id,
          type: 'followed',
          follow_id: follow!.id,
          created_at,
        })
        .select('id, created_at')
        .single();
      if (error) throw error;
      rows.push(data!);
    }
    return rows;
  }

  it('breaks a tie on id when two notifications share an instant', async () => {
    // The load-bearing case. Both rows carry the identical timestamp, so only
    // the id half of the predicate can separate them.
    const recipient = await createUser();
    const stamp = '2026-09-03T08:40:31.106813+00:00';
    await seed(recipient.id, [stamp, stamp]);

    const client = await signedInAs(recipient.email);

    const first = await page(client, 1);
    expect(first).toHaveLength(1);

    const second = await page(client, 1, {
      before: first[0].created_at,
      beforeId: first[0].id,
    });

    expect(second).toHaveLength(1);
    expect(second[0].id).not.toBe(first[0].id);
    // Same instant, and the ordering is still total.
    expect(second[0].created_at).toBe(first[0].created_at);
    expect(second[0].id < first[0].id).toBe(true);
  });

  it('does not skip a row inside the boundary millisecond', async () => {
    // This is the precision regression, expressed as data. `.106001` is older
    // than `.106813` but shares its millisecond, so a cursor truncated to
    // `.106` would exclude it from both pages.
    const recipient = await createUser();
    const boundary = '2026-09-03T08:40:31.106813+00:00';
    const inside = '2026-09-03T08:40:31.106001+00:00';
    await seed(recipient.id, [boundary, inside]);

    const client = await signedInAs(recipient.email);

    const first = await page(client, 1);
    expect(first[0].created_at).toBe(boundary);

    const second = await page(client, 1, {
      before: first[0].created_at,
      beforeId: first[0].id,
    });

    expect(second).toHaveLength(1);
    expect(second[0].created_at).toBe(inside);
  });

  it('shows the boundary row once and only once', async () => {
    const recipient = await createUser();
    const stamps = [
      '2026-09-03T08:40:31.106813+00:00',
      '2026-09-03T08:40:31.106500+00:00',
      '2026-09-03T08:40:31.106001+00:00',
      '2026-09-03T08:40:30.999999+00:00',
    ];
    await seed(recipient.id, stamps);

    const client = await signedInAs(recipient.email);

    // Walk the whole list one row at a time, which is the harshest traversal:
    // every step crosses a boundary.
    const seen: string[] = [];
    let cursor: { before: string; beforeId: string } | undefined;
    for (let i = 0; i < 10; i += 1) {
      const rows = await page(client, 1, cursor);
      if (rows.length === 0) break;
      seen.push(rows[0].id);
      cursor = { before: rows[0].created_at, beforeId: rows[0].id };
    }

    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
  });

  it('traverses rows sharing one millisecond without loss or repetition', async () => {
    const recipient = await createUser();
    const stamps = [
      '2026-09-03T08:40:31.106999+00:00',
      '2026-09-03T08:40:31.106500+00:00',
      '2026-09-03T08:40:31.106100+00:00',
      '2026-09-03T08:40:31.106000+00:00',
    ];
    const rows = await seed(recipient.id, stamps);
    const client = await signedInAs(recipient.email);

    const seen: string[] = [];
    let cursor: { before: string; beforeId: string } | undefined;
    for (let i = 0; i < 10; i += 1) {
      const got = await page(client, 2, cursor);
      if (got.length === 0) break;
      for (const r of got) seen.push(r.id);
      const last = got[got.length - 1];
      cursor = { before: last.created_at, beforeId: last.id };
      if (got.length < 2) break;
    }

    // Every notification exactly once, across a boundary that a
    // millisecond-truncated cursor would have collapsed.
    expect(new Set(seen).size).toBe(4);
    expect(seen.sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it('accepts a cursor built from what PostgREST returned', async () => {
    // The round trip that matters: the timestamp goes out of the database, into
    // a cursor, and back into a filter unchanged.
    const recipient = await createUser();
    await seed(recipient.id, [
      '2026-09-03T08:40:31.106813+00:00',
      '2026-09-03T08:40:31+00:00',
      '2026-09-03T08:40:30.5+00:00',
    ]);

    const client = await signedInAs(recipient.email);
    const first = await page(client, 1);

    const second = await page(client, 5, {
      before: first[0].created_at,
      beforeId: first[0].id,
    });

    expect(second).toHaveLength(2);
  });

  it('rejects the crafted cursor before it can reach PostgREST', async () => {
    // The end of the defect, proved from both sides: the filter genuinely
    // breaks, and the validator is what stops it being built.
    const recipient = await createUser();
    await seed(recipient.id, ['2026-09-03T08:40:31.106813+00:00']);
    const client = await signedInAs(recipient.email);

    const broken = await client
      .from('notifications')
      .select('id')
      .or(`created_at.lt.2020-01-01,,and(created_at.eq.2020-01-01,,id.lt.${ANY_UUID})`);

    expect(broken.error?.code).toBe('PGRST100');

    // And the page never builds that filter, because the cursor is refused.
    expect(cursorFrom('2020-01-01,', ANY_UUID)).toBeNull();
  });
});
