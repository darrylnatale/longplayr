#!/usr/bin/env node
/**
 * Refuses a push that would deploy code ahead of its migrations.
 *
 * **This exists because the failure has happened twice.** A migration only
 * reaches the database when someone runs `supabase db push`. Deploy code first
 * and the deployed app queries tables that do not exist yet.
 * `docs/current-state.md` §42 and §46 both record the outage: the second one
 * took every profile page down for every visitor, and was found by opening the
 * site rather than by any check.
 *
 * **[CORRECTED 2026-09-15 — this said "Vercel deploys on push, so pushing *is*
 * deploying".]** That holds for `main` and is false for a branch, which is
 * where all work now happens. The message it produced told the developer to
 * apply the migration *before* pushing — which would put schema on the deployed
 * database **before CI had ever parsed it**, the exact ordering `CLAUDE.md`
 * reversed when it moved that step to **STEP J**. The wording now depends on
 * where the push is going; see `scripts/migration-warning.mjs` and
 * `docs/architecture.md` §11.1.
 *
 * **What this can no longer do, stated plainly.** Under the branch model the
 * deploy happens at merge time on GitHub, which no local hook observes. This is
 * a **reminder**, not a gate — the gate is STEP J's ordering.
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

import { buildBlockedMessage, parsePushTarget } from './migration-warning.mjs';

const run = promisify(execFile);

/**
 * The refs git hands a `pre-push` hook on stdin, or `''` when there are none.
 *
 * **Guarded against hanging, which would be worse than the bug being fixed.**
 * `npm run db:pending` runs this same check by hand, where stdin is a terminal
 * nobody will ever close — reading it to EOF there would lock up a diagnostic
 * command forever. A TTY is treated as no input, and any other stdin is raced
 * against a short timeout so an unexpected environment degrades to `unknown`
 * rather than stalling.
 */
async function readPushRefs() {
  if (process.stdin.isTTY) return '';

  return await new Promise((resolve) => {
    let data = '';
    const done = (value) => {
      clearTimeout(timer);
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      resolve(value);
    };

    const timer = setTimeout(() => done(data), 200);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => done(data));
    process.stdin.on('error', () => done(''));
  });
}

const pushTarget = parsePushTarget(await readPushRefs());

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
for (const line of buildBlockedMessage({ pending, target: pushTarget })) {
  console.error(line ? `  ${line}` : '');
}
console.error('');
process.exit(1);
