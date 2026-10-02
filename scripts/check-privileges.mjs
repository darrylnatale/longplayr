/**
 * Asserts the Phase 0 privilege conventions on every table and function the
 * migrations create.
 *
 * **This is a completeness check, not a correctness check**, and the
 * distinction is the whole reason it exists alongside
 * `tests/integration/privileges.test.ts` rather than instead of it.
 *
 * - **It checks whether somebody remembered.** A table added without RLS, or a
 *   function added without an `EXECUTE` revoke, fails here before review.
 * - **It cannot see what the database actually holds.** `architecture.md` §16.5
 *   measured seven of eight functions `anon`-executable **against migrations
 *   that appeared to withhold it** — this check would have passed. The
 *   integration suite is what catches that, by executing against a real
 *   database.
 * - **The integration suite works from a hardcoded list**, so an object added
 *   tomorrow is outside it. That is the gap this closes.
 *
 * **Written because the manual sweep that preceded it produced two false
 * findings.** A pattern matching only `revoke all on function` reported seven
 * functions unprotected when the real form was `revoke execute on function`;
 * a second pass misattributed a neighbouring function's `security definer` and
 * promoted a harmless function to a serious hole. **A hand-rolled grep at the
 * moment of wanting to find something is how both happened.** §16.12.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';

const sql = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(DIR, f), 'utf8'))
  .join('\n');

const problems = [];

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const tables = [
  ...new Set([...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/g)].map((m) => m[1])),
];

for (const table of tables) {
  if (!new RegExp(String.raw`alter table public\.${table}\s+enable row level security`).test(sql)) {
    problems.push(`table ${table}: no "enable row level security"`);
  }
}

// ---------------------------------------------------------------------------
// Column-level grants
// ---------------------------------------------------------------------------
//
// **The §14.1 shape, and the one grant question decidable from the text.** A
// `grant update (col)` narrows nothing unless the table-level privilege was
// revoked first, because Supabase's default privileges already gave it.
//
// **A broad "any grant needs a revoke" rule was tried and removed.** It cannot
// distinguish *no revoke needed, because nothing was granted* from *revoke
// missing*, since the baseline lives in the database's default privileges
// rather than in these files — so it reported seven tables and could not say
// which, if any, were real. **A check that cannot tell is worse than no check**:
// it trains people to ignore it. §16.12.

for (const m of sql.matchAll(
  /grant\s+(\w+)\s*\(([^)]*)\)\s*\n?\s*on\s+(?:table\s+)?public\.(\w+)[^;]*to([^;]*);/gs,
)) {
  const [, privilege, , table, roles] = m;
  if (!/\b(anon|authenticated)\b/.test(roles)) continue;

  const priv = privilege.toLowerCase();
  const narrowed =
    new RegExp(
      String.raw`revoke\s+[^;]*\b${priv}\b[^;]*on\s+(?:table\s+)?public\.${table}\b[^;]*from`,
      's',
    ).test(sql) ||
    new RegExp(String.raw`revoke\s+all\s+on\s+(?:table\s+)?public\.${table}\b[^;]*from`, 's').test(
      sql,
    );

  if (!narrowed) {
    problems.push(
      `table ${table}: "grant ${priv} (…)" with no prior "revoke ${priv} on public.${table}" — the column list narrows nothing (§14.1, §16.5)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------
//
// **Matches `revoke all` and `revoke execute` both**, which is the exact
// oversight that made the manual sweep report seven false positives.

const functions = [
  ...new Set([...sql.matchAll(/create (?:or replace )?function public\.(\w+)/g)].map((m) => m[1])),
];

for (const fn of functions) {
  const revoked = new RegExp(
    String.raw`revoke (?:all|execute)[^;]*on function public\.${fn}\b[^;]*from[^;]*\bpublic\b`,
    's',
  ).test(sql);

  if (!revoked) {
    problems.push(
      `function ${fn}: no "revoke all|execute on function … from public" — Postgres grants EXECUTE to PUBLIC on creation (§16.5)`,
    );
  }
}

// ---------------------------------------------------------------------------
// anon must never hold a write
// ---------------------------------------------------------------------------

for (const m of sql.matchAll(
  /grant\s+([^;]*?)\s+on\s+(?:table\s+)?public\.(\w+)[^;]*?to([^;]*);/gs,
)) {
  const [, privileges, table, roles] = m;
  if (!/\banon\b/.test(roles)) continue;
  if (/\b(insert|update|delete|truncate|all)\b/i.test(privileges)) {
    problems.push(`table ${table}: write privilege "${privileges.trim()}" granted to anon`);
  }
}

// ---------------------------------------------------------------------------

export function auditMigrations() {
  return { tables: tables.length, functions: functions.length, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (problems.length > 0) {
    console.error(`\nPrivilege conventions not met (${problems.length}):\n`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('\n`architecture.md` §16.5 and §16.12.\n');
    process.exit(1);
  }
  console.log(
    `✓ ${tables.length} tables and ${functions.length} functions meet the privilege conventions.`,
  );
}
