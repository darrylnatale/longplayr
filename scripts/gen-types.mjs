/**
 * Regenerates `database.types.ts`, and leaves it alone when it cannot.
 *
 * **The old form was `supabase gen types typescript --local > …types.ts`, and
 * the shell is what broke it.** A `>` redirect **truncates the target before
 * the command runs**, so with the database unreachable the file was already
 * empty when the CLI then wrote its error JSON into it:
 *
 *     {"_tag":"Error","error":{"code":"UnknownError", …
 *
 * Every later `tsc` run failed with `TS1005: ';' expected` **on line 1**,
 * pointing at the file rather than at the missing database. `CLAUDE.md` forbids
 * hand-editing this file, so the only correct repair is regeneration or `git` —
 * and the next person to hit it is looking at a TypeScript error two steps from
 * the cause. `product-feedback.md` F-058.
 *
 * **The exit code alone cannot fix this, which is why the shape changed rather
 * than gaining a check.** The CLI does exit non-zero, but the truncation
 * happened before it started. **Capture first, write only on success.**
 *
 * **The content guard is the second half and is not redundant.** A future
 * version of the CLI that prints a warning, or succeeds while emitting
 * something that is not a module, would still pass an exit-code check. The
 * cheapest reliable signal is that generated output begins with the `Json`
 * type alias, which it has for every version this project has used.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = 'src/lib/supabase/database.types.ts';

/**
 * Whether captured output is plausibly a generated types module.
 *
 * Exported for its test: a guard whose logic goes stale causes the problem it
 * exists to prevent — the reasoning `architecture.md` §11.1 gives for testing
 * `migration-warning.mjs`.
 */
export function looksLikeGeneratedTypes(text) {
  if (typeof text !== 'string') return false;
  const head = text.slice(0, 400);
  return head.includes('export type Json') && !head.trimStart().startsWith('{');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const run = spawnSync(
    'npx',
    ['supabase', 'gen', 'types', 'typescript', '--local'],
    // stdout captured, stderr inherited: the CLI's progress and errors should
    // still reach the terminal, and only stdout is the artefact.
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );

  const fail = (why) => {
    console.error(
      `\nDid not write ${TARGET}: ${why}\n\n` +
        '  The previous file is untouched — nothing to repair.\n' +
        '  If the local stack is down: npm run db:start\n',
    );
    process.exit(1);
  };

  if (run.error) fail(run.error.message);
  if (run.status !== 0) fail(`supabase gen types exited ${run.status}`);
  if (!looksLikeGeneratedTypes(run.stdout)) {
    fail('the output does not look like generated types');
  }

  // Idempotence is worth reporting: a no-op run should say so rather than
  // leaving the reader to check `git status`.
  let previous = '';
  try {
    previous = readFileSync(TARGET, 'utf8');
  } catch {
    previous = '';
  }

  if (previous === run.stdout) {
    console.log(`✓ ${TARGET} already matches the local schema.`);
    process.exit(0);
  }

  writeFileSync(TARGET, run.stdout);
  console.log(`✓ ${TARGET} regenerated from the local schema.`);
}
