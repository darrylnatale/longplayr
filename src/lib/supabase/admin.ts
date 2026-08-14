import { createClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

/**
 * Service-role Supabase client.
 *
 * Bypasses Row Level Security entirely, so it exists only for work no user
 * performs: catalogue ingestion, artwork, the job queue, and admin tooling.
 *
 * **Server only.** Importing this into anything the browser can reach would
 * hand out full database access. The key is deliberately not prefixed
 * NEXT_PUBLIC_, so a client-side import fails at build rather than shipping.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'createAdminClient requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
