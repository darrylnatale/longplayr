import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';

/**
 * Ceilings on the writes that notify other people (`architecture.md` §14.4).
 *
 * **Asserted from a real user token, because that is the point.** The limits
 * are enforced by trigger rather than in the service layer precisely so that
 * somebody posting straight to PostgREST is bound by them too — and a suite
 * using the service-role client would be testing a path no attacker takes.
 * That distinction is §14.1's lesson, and this is what it looks like applied.
 *
 * **The daily ceilings are not exercised.** Reaching 300 follows means creating
 * 300 accounts, and the hourly limit binds first regardless, so the test would
 * cost minutes to prove the same mechanism twice. The function counts both
 * windows with the same code path.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

vi.setConfig({ testTimeout: 120_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = 'correct-horse-battery';

/** Postgres `raise_exception`, which a bare `raise` produces. */
const RAISE_EXCEPTION = 'P0001';
const MARKER = 'longplayr_rate_limited';

/** Matches the trigger arguments in `20260924160000`. */
const FOLLOWS_PER_HOUR = 60;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds: string[] = [];
const actor = { id: '' };
let asActor: SupabaseClient<Database>;
let targets: string[] = [];

async function createUser(handle: string): Promise<string> {
  const email = `${handle}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const id = data.user!.id;
  createdUserIds.push(id);

  const { error: profileError } = await admin.from('profiles').insert({ id, handle });
  if (profileError) throw profileError;

  return id;
}

beforeAll(async () => {
  const stamp = `${Date.now()}`.slice(-9);

  actor.id = await createUser(`rl${stamp}`);

  asActor = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await asActor.auth.signInWithPassword({
    email: `rl${stamp}@example.com`,
    password: PASSWORD,
  });
  if (error) throw error;

  // One more than the ceiling, so the refusal is reached exactly once.
  targets = [];
  for (let i = 0; i <= FOLLOWS_PER_HOUR; i += 1) {
    targets.push(await createUser(`rt${stamp}x${i}`));
  }
});

afterAll(async () => {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
});

describe('follows', () => {
  it('accepts exactly the hourly ceiling and refuses the next', async () => {
    let accepted = 0;
    let refusal: { code?: string; message?: string } | null = null;

    for (const followeeId of targets) {
      const { error } = await asActor
        .from('follows')
        .insert({ follower_id: actor.id, followee_id: followeeId });

      if (!error) {
        accepted += 1;
        continue;
      }
      refusal = error;
      break;
    }

    // **Exactly the ceiling, not merely "some".** An off-by-one here would mean
    // the limit is one out in production and nothing would ever say so.
    expect(accepted).toBe(FOLLOWS_PER_HOUR);

    expect(refusal).not.toBeNull();
    expect(refusal!.code).toBe(RAISE_EXCEPTION);
    // The marker rather than the prose, matching what `isRateLimited` keys on.
    expect(refusal!.message).toContain(MARKER);
  });

  it('leaves the accepted follows in place', async () => {
    // A refusal at the ceiling must not roll back what came before it. The
    // trigger is BEFORE INSERT on a single row, so each statement stands alone
    // — asserted rather than assumed, because the opposite would be silent.
    const { count, error } = await admin
      .from('follows')
      .select('id', { count: 'exact', head: true })
      .eq('follower_id', actor.id);
    if (error) throw error;

    expect(count).toBe(FOLLOWS_PER_HOUR);
  });

  it('still refuses on a later attempt within the window', async () => {
    // The window is rolling, so the ceiling stays shut rather than reopening at
    // a clock boundary — which is the behaviour a fixed hour would get wrong.
    const { error } = await asActor
      .from('follows')
      .insert({ follower_id: actor.id, followee_id: targets[targets.length - 1] });

    expect(error?.message).toContain(MARKER);
  });

  it('does not limit a different account', async () => {
    // Per actor, not global. A shared counter would let one script deny the
    // action to everybody, which is a worse failure than the one being fixed.
    const stamp = `${Date.now()}`.slice(-9);
    const otherId = await createUser(`ro${stamp}`);

    const other = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await other.auth.signInWithPassword({
      email: `ro${stamp}@example.com`,
      password: PASSWORD,
    });
    if (signInError) throw signInError;

    const { error } = await other
      .from('follows')
      .insert({ follower_id: otherId, followee_id: targets[0] });

    expect(error).toBeNull();
  });
});
