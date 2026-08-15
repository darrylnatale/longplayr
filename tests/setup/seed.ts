import { config } from 'dotenv';

/**
 * Setup for seeding utilities.
 *
 * Deliberately NOT the integration setup. That one refuses any non-local
 * database because those tests truncate tables; seeding is the opposite — it
 * writes a catalogue, and staging is its intended target.
 *
 * What it does instead is make the target impossible to miss. Seeding the wrong
 * database wastes hundreds of rate-limited requests and puts data somewhere it
 * was not wanted, so the destination is printed before any work begins.
 */

config({ path: '.env.local', quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL is not set.\n' +
      'For local: npm run db:start && npm run db:env\n' +
      'For staging: pass it inline — see docs/staging-setup.md §5',
  );
}

if (!serviceKey) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY is not set. Seeding writes catalogue data and ' +
      'needs the service role.',
  );
}

const isLocal = /localhost|127\.0\.0\.1/.test(url);
const host = new URL(url).host;

console.info(
  [
    '',
    '  ────────────────────────────────────────────────',
    `  SEED TARGET: ${host}`,
    `  ${isLocal ? 'LOCAL — the integration suite will delete this.' : 'REMOTE — this is not your local database.'}`,
    '  ────────────────────────────────────────────────',
    '',
  ].join('\n'),
);
