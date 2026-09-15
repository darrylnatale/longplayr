/**
 * What the pre-push migration check should say, given where the push is going.
 *
 * **Split out from the check itself so it can be tested.** The check performs
 * network I/O and calls `process.exit`, so it cannot be imported; this module is
 * pure and is where the decision actually lives.
 *
 * **Why the target matters.** The check's original message asserted "Vercel
 * deploys on push, so pushing is deploying". That holds for `main` and is false
 * for a branch, which is where all work now happens — and it told the developer
 * to apply the migration **before** pushing, which would put schema on the
 * deployed database before CI had ever parsed it. `CLAUDE.md` moved that step to
 * **STEP J**, after a green run and before the merge. `architecture.md` §11.1.
 */

/** The branch a push to which is a deploy. */
const DEPLOYING_BRANCH = 'main';

/**
 * Where a push is going, from the refs git hands a `pre-push` hook on stdin.
 *
 * Each line is `<local ref> <local sha> <remote ref> <remote sha>`. A deleted
 * ref arrives with `(delete)` as the local ref and is ignored — deleting a
 * branch ships no code, so it cannot deploy anything.
 *
 * **`unknown` is a real answer, not a failure.** `npm run db:pending` runs the
 * same check by hand with no git and no stdin, and the honest message there is
 * one that does not claim to know which case it is.
 *
 * @param {string} stdin
 * @returns {'main' | 'branch' | 'unknown'}
 */
export function parsePushTarget(stdin) {
  const remoteRefs = String(stdin ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 3 && parts[0] !== '(delete)')
    .map((parts) => parts[2]);

  if (remoteRefs.length === 0) return 'unknown';

  // A push touching `main` at all is treated as deploying, even alongside other
  // refs. The consequence of being wrong in that direction is a message that is
  // too cautious; the other direction is the outage this check exists for.
  return remoteRefs.some((ref) => ref === `refs/heads/${DEPLOYING_BRANCH}`) ? 'main' : 'branch';
}

/**
 * The lines printed when the deployed database is behind.
 *
 * **Returns lines rather than printing them** so the wording is assertable. The
 * caller owns the colours and the exit code.
 *
 * @param {{ pending: string[]; target: 'main' | 'branch' | 'unknown' }} input
 * @returns {string[]}
 */
export function buildBlockedMessage({ pending, target }) {
  const lines = [
    `${pending.length} migration${pending.length === 1 ? '' : 's'} not applied to the deployed database:`,
    ...pending.map((id) => `  • ${id}`),
    '',
  ];

  if (target === 'main') {
    lines.push(
      'This push targets main, and pushing main deploys. Shipping now would run',
      'code against a schema that does not have these yet — which took every',
      'profile page down on 2026-09-04 (docs/current-state.md §46).',
      '',
      'Apply them first, then push:',
      '  npx supabase db push --linked',
    );
  } else if (target === 'branch') {
    // The case the old message got wrong, and the one that happens every time.
    lines.push(
      'This push targets a branch, so it deploys nothing and this is expected.',
      'The migration belongs at STEP J — after CI is green on this commit and',
      'before the merge, because merging is what deploys.',
      '',
      'Do not apply it now: that would put schema on the deployed database',
      'before CI has ever parsed it.',
      '',
      'Push past this, then apply at STEP J:',
      '  git push --no-verify',
    );
  } else {
    // No refs on stdin — run by hand rather than by git.
    lines.push(
      'Where this push is going could not be determined, so the safe reading is',
      'that it might deploy.',
      '',
      'Pushing a branch deploys nothing — apply the migration at STEP J, after',
      'CI is green and before the merge. Pushing or merging main does deploy,',
      'and the migration must land first:',
      '  npx supabase db push --linked',
    );
  }

  return lines;
}

export const __testing = { DEPLOYING_BRANCH };
