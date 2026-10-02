/**
 * Says which layer of the local stack is missing, and what to run.
 *
 * **F-044: the test environment fails more often than the code does.** That
 * entry recorded three of five cycles losing time to the environment and none
 * to a product defect. **The session of 2026-10-02 produced five distinct
 * instances**, and each failure named something other than its cause:
 *
 * | What was wrong | What was reported |
 * | --- | --- |
 * | Docker daemon not running | `Timed out waiting 120000ms from config.webServer` |
 * | Docker daemon not running | `LegacyLocalDbRunningError: failed to connect to the docker API` |
 * | Docker half-started | `docker info` hanging, then a 500 from the API route |
 * | `supabase start` not run | `No such container: supabase_db_longplayr` |
 * | `supabase start` not run | `LegacyResetLocalDbNotRunningError` |
 *
 * **Two of those were fixed at their own site** — `architecture.md` §12.2 for
 * the Playwright timeout, §12.3 for `db:types` destroying its output. **This is
 * the general case**: one check, run by every database script, that distinguishes
 * *Docker is not running* from *the stack is not started* from *the stack is up*.
 *
 * **It diagnoses and never acts.** Starting Docker on somebody's machine is not
 * a thing a check should decide to do, and `supabase start` takes long enough
 * that doing it implicitly would hide the one fact the reader needs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Milliseconds before a hanging daemon is treated as down. The 2026-10-02 */
/** session saw `docker info` hang rather than fail, which is why this exists. */
const DOCKER_TIMEOUT_MS = 8000;

export const LAYERS = ['docker', 'stack', 'env', 'ready'];

/**
 * Which layer is missing, as a plain string.
 *
 * Exported for its test: a guard whose wording goes stale causes the confusion
 * it exists to prevent — `architecture.md` §11.1's reasoning for testing
 * `migration-warning.mjs`.
 */
export function remedyFor(layer) {
  switch (layer) {
    case 'docker':
      return {
        problem: 'The Docker daemon is not responding.',
        remedy:
          'Start Docker Desktop, then re-run.\n' +
          '  If it is already running and still unresponsive, quit it fully and\n' +
          '  reopen — a half-started daemon answers `docker info` with a 500 or\n' +
          '  hangs, which is what happened on 2026-10-02.',
      };
    case 'stack':
      return {
        problem: 'Docker is up, but the local Supabase stack is not started.',
        remedy: 'Run: npm run db:start',
      };
    case 'env':
      return {
        problem: 'The stack is up, but .env.local is missing.',
        remedy: 'Run: npm run db:env',
      };
    default:
      return null;
  }
}

function dockerUp() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: DOCKER_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

function stackUp() {
  try {
    const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], {
      encoding: 'utf8',
      timeout: DOCKER_TIMEOUT_MS,
    });
    // The database container specifically. `supabase stop` leaves others
    // briefly, and studio being up is not the same as Postgres being up.
    return names.split('\n').some((n) => n.startsWith('supabase_db_'));
  } catch {
    return false;
  }
}

/** The first missing layer, or `ready`. */
export function detect({
  docker = dockerUp,
  stack = stackUp,
  env = () => existsSync('.env.local'),
} = {}) {
  if (!docker()) return 'docker';
  if (!stack()) return 'stack';
  if (!env()) return 'env';
  return 'ready';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const layer = detect();
  const remedy = remedyFor(layer);

  if (!remedy) {
    console.log('✓ Docker is up, the Supabase stack is running, and .env.local exists.');
    process.exit(0);
  }

  console.error(`\n  ${remedy.problem}\n\n  ${remedy.remedy}\n`);
  console.error('  `architecture.md` §12.4, `product-feedback.md` F-044.\n');
  process.exit(1);
}
