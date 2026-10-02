/**
 * Compares the **deployed** schema against the migrations.
 *
 * **This is the half of F-032 that CI structurally cannot cover.** CI applies
 * migrations to a **fresh** database, so a clean run proves the migrations are
 * internally consistent and says nothing about the database users are actually
 * served by. `npm run db:pending` compares the migration *ledger*, which tells
 * you a file was recorded — not that it did what it should.
 *
 * **Not part of `npm run verify`, deliberately.** `supabase db diff --linked`
 * applies every migration to a shadow database first; it took minutes on 44
 * migrations. A check that slow in the fast loop would be turned off.
 *
 * **The baseline below is Supabase's, not this project's.** A new Supabase
 * project ships `pg_net` and default privileges granting sequence access to
 * `anon`, `authenticated` and `service_role`. No migration declares either, so
 * the diff proposes removing them **every time** — and a check that always
 * fails is a check nobody reads. They are allowlisted by exact statement so
 * that a *change* to the baseline still surfaces.
 */
import { spawnSync } from 'node:child_process';

/**
 * Statements the Supabase platform produces that this project never wrote.
 *
 * **Matched as substrings of the diff, not as a parsed schema.** Crude on
 * purpose: anything this does not recognise is reported rather than guessed at,
 * which is the failure direction that matters.
 */
export const PLATFORM_BASELINE = [
  'DROP EXTENSION pg_net',
  'REVOKE UPDATE ON SEQUENCES FROM anon',
  'REVOKE UPDATE ON SEQUENCES FROM authenticated',
  'REVOKE UPDATE ON SEQUENCES FROM service_role',
];

/**
 * The diff statements that are not platform baseline.
 *
 * Exported for its test: a guard whose allowlist goes stale stops reporting the
 * thing it exists to report — `architecture.md` §11.1's reasoning for testing
 * `migration-warning.mjs`.
 */
export function unexplained(diff) {
  if (!diff || !diff.trim()) return [];

  return (
    diff
      .split(/;\s*\n/)
      .map((statement) => statement.trim())
      .filter(Boolean)
      // Comment-only chunks are the diff's own section headers.
      .filter((statement) => statement.split('\n').some((line) => !line.trim().startsWith('--')))
      .filter((statement) => !PLATFORM_BASELINE.some((known) => statement.includes(known)))
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const run = spawnSync('npx', ['supabase', 'db', 'diff', '--linked'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  if (run.status !== 0) {
    console.error(`\n  supabase db diff exited ${run.status} — nothing was compared.\n`);
    process.exit(1);
  }

  // The CLI prints progress and then one JSON object. Take the last line that
  // parses, rather than assuming the shape of everything before it.
  let payload = null;
  for (const line of run.stdout.split('\n').reverse()) {
    if (!line.trim().startsWith('{')) continue;
    try {
      payload = JSON.parse(line);
      break;
    } catch {
      /* keep looking */
    }
  }

  if (!payload) {
    console.error('\n  Could not read a diff from supabase db diff. Nothing was compared.\n');
    process.exit(1);
  }

  const problems = unexplained(payload.diff ?? '');

  if (problems.length === 0) {
    console.log('✓ The deployed schema matches the migrations (Supabase baseline aside).');
    process.exit(0);
  }

  console.error(
    `\n  The deployed schema differs from the migrations in ${problems.length} way(s):\n`,
  );
  for (const problem of problems) console.error(`  ${problem.replace(/\n/g, '\n  ')}\n`);
  console.error(
    '  A statement here means the deployed database holds something no migration\n' +
      '  declares, or is missing something one does. `architecture.md` §12.5.\n',
  );
  process.exit(1);
}
