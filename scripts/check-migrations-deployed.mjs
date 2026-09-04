#!/usr/bin/env node
/**
 * Refuses a push that would deploy code ahead of its migrations.
 *
 * **This exists because the failure has happened twice.** Vercel deploys on
 * push, so pushing *is* deploying — but a migration only reaches the database
 * when someone runs `supabase db push`. Push code first and the deployed app
 * queries tables that do not exist yet. `docs/current-state.md` §42 and §46 both
 * record the outage: the second one took every profile page down for every
 * visitor, and was found by opening the site rather than by any check.
 *
 * **CI cannot catch it.** CI applies migrations to a fresh database and passes.
 * A green run says nothing about the deployed schema. `verify:full`, CI and the
 * deployed database are three separate things.
 *
 * The rule this enforces: **migrations deploy before the code that needs them.**
 *
 * Exits 0 when the deployed database is up to date, 1 when it is behind, and
 * **0 with a warning when it cannot tell** — being unable to reach Supabase is
 * not evidence of a problem, and blocking every offline push would get the hook
 * disabled, which is worse than the risk it manages.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const BOLD = '[1m';
const RED = '[31m';
const YELLOW = '[33m';
const GREEN = '[32m';
const OFF = '[0m';

let stdout;
try {
  ({ stdout } = await run('npx', ['supabase', 'migration', 'list', '--linked'], {
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  }));
} catch (error) {
  // Offline, unlinked, or the CLI failed. Say so and let the push through.
  console.warn(
    `${YELLOW}⚠ Could not check the deployed database${OFF} — ${error.shortMessage ?? error.message}`,
  );
  console.warn('  Pushing anyway. If this push adds a migration, apply it manually:');
  console.warn('    npx supabase db push --linked');
  process.exit(0);
}

// The CLI prints progress lines before its JSON payload.
const line = stdout
  .split('\n')
  .reverse()
  .find((candidate) => candidate.trim().startsWith('{'));

if (!line) {
  console.warn(`${YELLOW}⚠ Could not parse the migration list. Pushing anyway.${OFF}`);
  process.exit(0);
}

/** @type {{ migrations?: { local?: string; remote?: string }[] }} */
let payload;
try {
  payload = JSON.parse(line);
} catch {
  console.warn(`${YELLOW}⚠ Could not parse the migration list. Pushing anyway.${OFF}`);
  process.exit(0);
}

// A migration exists locally but not remotely when `remote` is empty.
const pending = (payload.migrations ?? [])
  .filter((row) => row.local && !row.remote)
  .map((row) => row.local);

if (pending.length === 0) {
  console.log(`${GREEN}✓ Deployed database is up to date with local migrations.${OFF}`);
  process.exit(0);
}

console.error('');
console.error(`${RED}${BOLD}✗ Push blocked: the deployed database is behind.${OFF}`);
console.error('');
console.error(`  ${pending.length} migration${pending.length === 1 ? '' : 's'} not applied:`);
for (const id of pending) console.error(`    • ${id}`);
console.error('');
console.error('  Vercel deploys on push, so pushing now ships code against a schema');
console.error('  that does not have these yet. That is what took every profile page');
console.error('  down on 2026-09-04 (docs/current-state.md §46).');
console.error('');
console.error(`  ${BOLD}Apply them first, then push:${OFF}`);
console.error('    npx supabase db push --linked');
console.error('');
console.error('  If you genuinely need to push without deploying them:');
console.error('    git push --no-verify');
console.error('');
process.exit(1);
