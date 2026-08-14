import { createBrowserClient } from '@supabase/ssr';

import type { Database } from './database.types';

/**
 * Supabase client for Client Components.
 *
 * Deliberately thin: nearly all data access happens on the server through the
 * service layer. Reach for this only when a component genuinely needs live
 * client-side auth state.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
