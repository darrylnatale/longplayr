import { config } from 'dotenv';

// Integration tests run against the local Supabase stack, never staging or
// production. `.env.test.local` is written by `npm run db:env`.
config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!url) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL is not set. Run `npm run db:start` then `npm run db:env`.',
  );
}

// Guard against ever pointing integration tests at a remote project: they
// truncate tables between runs.
if (!/localhost|127\.0\.0\.1/.test(url)) {
  throw new Error(
    `Integration tests refuse to run against a non-local database (${url}). ` +
      'These tests delete data.',
  );
}
