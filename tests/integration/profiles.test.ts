import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';

/**
 * Database contract for profiles.
 *
 * These test the guarantees the schema itself makes — format constraints,
 * uniqueness, cascade deletion and Row Level Security. They deliberately do not
 * go through the service layer: the point is to prove the database holds the
 * line even if application code has a bug.
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

const createdUserIds: string[] = [];

async function createUser() {
  const email = `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'correct-horse-battery',
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  return data.user;
}

function uniqueHandle(prefix = 'it') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`.slice(0, 30);
}

beforeAll(() => {
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing. Run `npm run db:env`.');
});

afterAll(async () => {
  // Deleting the auth user cascades to the profile, which is itself the
  // behaviour hard deletion depends on.
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe('profiles schema', () => {
  it('accepts a valid handle', async () => {
    const user = await createUser();
    const handle = uniqueHandle();

    const { data, error } = await admin
      .from('profiles')
      .insert({ id: user.id, handle })
      .select('*')
      .single();

    expect(error).toBeNull();
    expect(data?.handle).toBe(handle);
    expect(data?.status).toBe('active');
  });

  it('rejects handles that break the format constraint', async () => {
    const user = await createUser();

    for (const bad of ['ab', '1leading', '_leading', 'has-hyphen', 'has space', 'UPPER']) {
      const { error } = await admin.from('profiles').insert({ id: user.id, handle: bad });
      expect(error, `expected "${bad}" to be rejected`).not.toBeNull();
      expect(error?.message).toContain('profiles_handle_format');
    }
  });

  it('rejects a handle longer than 30 characters', async () => {
    const user = await createUser();
    const { error } = await admin
      .from('profiles')
      .insert({ id: user.id, handle: `a${'b'.repeat(30)}` });
    expect(error).not.toBeNull();
  });

  it('enforces handle uniqueness', async () => {
    const first = await createUser();
    const second = await createUser();
    const handle = uniqueHandle();

    const { error: firstError } = await admin.from('profiles').insert({ id: first.id, handle });
    expect(firstError).toBeNull();

    const { error: secondError } = await admin.from('profiles').insert({ id: second.id, handle });
    expect(secondError?.code).toBe('23505');
  });

  it('allows only one profile per user', async () => {
    const user = await createUser();

    const { error: firstError } = await admin
      .from('profiles')
      .insert({ id: user.id, handle: uniqueHandle() });
    expect(firstError).toBeNull();

    const { error: secondError } = await admin
      .from('profiles')
      .insert({ id: user.id, handle: uniqueHandle() });
    expect(secondError?.code).toBe('23505');
    expect(secondError?.message).toContain('pkey');
  });

  it('cascades profile deletion when the auth user is deleted', async () => {
    const user = await createUser();
    const handle = uniqueHandle();
    await admin.from('profiles').insert({ id: user.id, handle });

    await admin.auth.admin.deleteUser(user.id);
    createdUserIds.splice(createdUserIds.indexOf(user.id), 1);

    const { data } = await admin.from('profiles').select('id').eq('handle', handle).maybeSingle();

    // An orphaned row here would be a privacy failure, not a bug.
    expect(data).toBeNull();
  });

  it('moves updated_at forward on update', async () => {
    const user = await createUser();
    const { data: created } = await admin
      .from('profiles')
      .insert({ id: user.id, handle: uniqueHandle() })
      .select('updated_at')
      .single();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const { data: updated } = await admin
      .from('profiles')
      .update({ display_name: 'Changed' })
      .eq('id', user.id)
      .select('updated_at')
      .single();

    expect(new Date(updated!.updated_at).getTime()).toBeGreaterThan(
      new Date(created!.updated_at).getTime(),
    );
  });
});

describe('profiles row level security', () => {
  it('lets anyone read profiles, because everything is public', async () => {
    const user = await createUser();
    const handle = uniqueHandle();
    await admin.from('profiles').insert({ id: user.id, handle });

    const { data, error } = await anon
      .from('profiles')
      .select('handle')
      .eq('handle', handle)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data?.handle).toBe(handle);
  });

  it('stops an anonymous client creating a profile', async () => {
    const user = await createUser();
    const { error } = await anon.from('profiles').insert({ id: user.id, handle: uniqueHandle() });
    expect(error).not.toBeNull();
  });

  it('stops an anonymous client editing someone else’s profile', async () => {
    const user = await createUser();
    const handle = uniqueHandle();
    await admin.from('profiles').insert({ id: user.id, handle });

    const { error } = await anon
      .from('profiles')
      .update({ display_name: 'Hijacked' })
      .eq('id', user.id);

    // RLS may reject outright or match zero rows; either way nothing changed.
    const { data } = await admin.from('profiles').select('display_name').eq('id', user.id).single();

    expect(error ?? data?.display_name).not.toBe('Hijacked');
    expect(data?.display_name).toBeNull();
  });
});
