/**
 * Says so when Node is too old, rather than letting jsdom say something else.
 *
 * **F-062, and it is the same failure shape as §112's.** The `component` vitest
 * project was configured in Phase 0 and matched no file until 2026-10-03, so
 * nobody discovered that it cannot run on Node 20. jsdom reaches an ESM-only
 * dependency through a CommonJS `require`, which Node supports only from
 * **22.12**, and the first component test in the repository failed with:
 *
 *     Failed to start forks worker ...
 *     Caused by: require() of ES Module @exodus/bytes/encoding-lite.js
 *
 * **Nothing in that names the cause.** Two reasonable fixes were tried against
 * it and neither could work: bumping jsdom to 30, and switching the pool to
 * threads. The problem was never the dependency or the pool — it was the
 * runtime, and nothing in the repository pinned one.
 *
 * **It diagnoses and never acts**, like `check-env.mjs`: switching somebody's
 * Node version is not a thing a check should decide to do.
 */

/** CI already runs this, and `.nvmrc` and `package.json#engines` both say it. */
const REQUIRED_MAJOR = 22;

/**
 * `require(esm)` is unflagged from 22.12, not from 22.0.
 *
 * Checked as a real lower bound rather than a major-version comparison,
 * because 22.0 through 22.11 would pass a major check and still fail the way
 * this exists to explain.
 */
const REQUIRED_MINOR = 12;

export function nodeVersionProblem(version = process.version) {
  const match = /^v(\d+)\.(\d+)\./.exec(version);
  // An unparseable version is not evidence of a problem. Saying nothing is
  // better than blocking a working machine on a string this did not expect.
  if (!match) return null;

  const [major, minor] = [Number(match[1]), Number(match[2])];
  if (major > REQUIRED_MAJOR) return null;
  if (major === REQUIRED_MAJOR && minor >= REQUIRED_MINOR) return null;

  return (
    `Node ${version} is too old for this project — ${REQUIRED_MAJOR}.${REQUIRED_MINOR} or newer is required.\n\n` +
    `  Component tests run in jsdom, which reaches an ESM-only dependency through a\n` +
    `  CommonJS require. Node supports that only from 22.12. On an older runtime the\n` +
    `  failure reads as a vitest worker crash and names neither Node nor jsdom.\n\n` +
    `  CI already runs Node ${REQUIRED_MAJOR}, so this machine is the odd one out.\n\n` +
    `    nvm use          # reads .nvmrc\n` +
    `    brew install node@${REQUIRED_MAJOR}   # if you do not use nvm\n`
  );
}

// Only when run directly, so importing it from a test asserts nothing and exits
// nothing.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const problem = nodeVersionProblem();
  if (problem) {
    console.error(`\n${problem}`);
    process.exit(1);
  }
}
