import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { countRows, COUNT_ONLY } from '@/services/count';
import {
  remainingAllowance,
  RATE_LIMIT_PER_DAY,
  RATE_LIMIT_PER_HOUR,
} from '@/services/catalogue/self-service';

/**
 * The counting boundary, against a real database and a real client.
 *
 * **The defect this guards is unreachable in a healthy schema**, which is what
 * made it survive: every count in CI resolves, so nothing ever produced the
 * failing state. The way in is a relation that has never existed — a missing
 * relation is a missing relation, whether it was dropped, renamed, or simply
 * absent from the PostgREST schema cache after a migration.
 *
 * **Nothing here mutates the schema.** No table is dropped, no grant revoked,
 * no fixture disturbed. That matters: a test that corrupted the database to
 * reach this state would be weakening the invariant it exists to protect.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * A relation that has never existed.
 *
 * The cast is the one concession this file makes: the generated `Database` type
 * knows every real table, which is exactly why it cannot name this one.
 */
const MISSING = 'no_such_relation_for_count_test' as never;

describe('the failure state is real, not hypothetical', () => {
  it('a head:true count against a missing relation returns no count and no error', async () => {
    // This is the whole defect, observed rather than argued. PostgREST answers
    // 404; a HEAD response carries no body; the client cannot parse an error
    // out of an empty body, so it reports success with nothing in it.
    const response = await admin.from(MISSING).select('id', COUNT_ONLY);

    expect(response.error).toBeNull();
    expect(response.count).toBeNull();
    // `count ?? 0` here is what produced a confident zero in production.
    expect(response.count ?? 0).toBe(0);
  });

  it('the same query without head:true does report the error', async () => {
    // The contrast that proves the defect is specific to HEAD rather than to
    // missing relations generally. Here the body survives, so the error does.
    const response = await admin.from(MISSING).select('id', { count: 'exact' });

    expect(response.error).not.toBeNull();
    expect(response.error?.message).toMatch(/schema cache|does not exist/i);
  });
});

describe('countRows against that same state', () => {
  it('throws rather than reporting zero', async () => {
    await expect(
      countRows(admin.from(MISSING).select('id', COUNT_ONLY), 'test.missing_relation'),
    ).rejects.toThrow(/test\.missing_relation/);
  });

  it('explains what happened', async () => {
    await expect(
      countRows(admin.from(MISSING).select('id', COUNT_ONLY), 'test.missing_relation'),
    ).rejects.toThrow(/no count returned and no error reported/);
  });

  it('still counts a real relation correctly', async () => {
    // The guard must not have made honest counts fail. `albums` is truncated
    // between cases in other files, so this asserts a number exists rather than
    // a particular one.
    const count = await countRows(
      admin.from('albums').select('id', COUNT_ONLY),
      'test.real_relation',
    );

    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

describe('remainingAllowance fails closed', () => {
  /**
   * A client whose counts resolve the way a missing relation does.
   *
   * A stub, and worth being explicit about why it is not a brittle one: the
   * shape it returns is not invented here, it is the shape the first test in
   * this file observes coming back from a real database.
   */
  const brokenAdmin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => Promise.resolve({ count: null, error: null, status: 204, statusText: '' }),
        }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;

  it('throws instead of granting the full allowance when a count cannot be obtained', async () => {
    // The consequence this cycle exists for. Reading the failed count as zero
    // additions used made the allowance maximal, so the gate in addToCatalogue
    // never fired and the rate limit ceased to exist.
    await expect(remainingAllowance('any-user', brokenAdmin)).rejects.toThrow(
      /catalogue_additions/,
    );
  });

  it('does not report a full allowance on failure', async () => {
    const outcome = await remainingAllowance('any-user', brokenAdmin).catch(() => 'threw' as const);

    expect(outcome).toBe('threw');
    expect(outcome).not.toEqual({ hour: RATE_LIMIT_PER_HOUR, day: RATE_LIMIT_PER_DAY });
  });

  it('still computes the allowance from a working count', async () => {
    // Preserves the arithmetic: a working client must still produce the
    // documented limits, so the guard cannot be said to have changed behaviour
    // on the path that matters.
    const workingAdmin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => Promise.resolve({ count: 0, error: null, status: 200, statusText: 'OK' }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(remainingAllowance('any-user', workingAdmin)).resolves.toEqual({
      hour: RATE_LIMIT_PER_HOUR,
      day: RATE_LIMIT_PER_DAY,
    });
  });
});
