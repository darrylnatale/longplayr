/**
 * Refuses to start the end-to-end suite when the environment, not the code, is
 * what is broken.
 *
 * **The failure this exists to prevent was observed, not imagined.** With Docker
 * stopped, Playwright reports `Timed out waiting 120000ms from config.webServer`
 * — because it waits for `baseURL` to return a success status, `/` calls
 * Supabase, and that call fails with `ECONNREFUSED 127.0.0.1:54321`. **The
 * message names the Next dev server, which is working perfectly**, and the two
 * remedies it suggests — killing stale servers, freeing port 3000 — are both
 * wrong. `architecture.md` §12.2, `product-feedback.md` F-036.
 *
 * **Checks only what masquerades as something else.** A missing spec, a wrong
 * selector or a genuine product fault must still fail as themselves; this adds
 * no opinion about any of them.
 *
 * **Skipped entirely when `PLAYWRIGHT_BASE_URL` is set**, because the suite is
 * then pointed at a server somebody else is running and local Supabase may be
 * irrelevant. That is the same escape hatch `playwright.config.ts` honours.
 */
import { readFileSync } from 'node:fs';

import { detect, remedyFor } from './check-env.mjs';

const ENV_FILE = '.env.local';

function fail(problem, remedy) {
  console.error(`\nCannot start the end-to-end suite.\n\n  ${problem}\n\n  ${remedy}\n`);
  process.exit(1);
}

if (process.env.PLAYWRIGHT_BASE_URL) {
  process.exit(0);
}

/*
 * **Delegated rather than duplicated.** `check-env.mjs` distinguishes *Docker
 * is down* from *the stack is not started* from *`.env.local` is missing* —
 * three causes this file previously collapsed into one message about Supabase
 * not answering. `architecture.md` §12.4.
 *
 * **What stays here is the one thing it cannot tell**: whether Supabase is
 * actually answering. A stack whose container is up but wedged passes every
 * check above and still fails the suite.
 */
const layer = detect();
const remedy = remedyFor(layer);
if (remedy) fail(remedy.problem, remedy.remedy);

// Read the URL from the file rather than from the environment: the suite is
// started by npm, which does not load `.env.local` itself.
const match = readFileSync(ENV_FILE, 'utf8').match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
if (!match) {
  fail(
    `${ENV_FILE} has no NEXT_PUBLIC_SUPABASE_URL, so the dev server cannot reach Supabase.`,
    'Run: npm run db:env',
  );
}

const url = match[1].trim().replace(/\/+$/, '');

/*
 * **A plain fetch with a short timeout, rather than asking Docker.** The thing
 * that matters is whether Supabase answers; Docker being up is a cause, not the
 * condition. Checking the cause would miss a stack that is up but wedged, and
 * would couple this to a container runtime the project does not otherwise name.
 */
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 5000);

try {
  await fetch(`${url}/rest/v1/`, { signal: controller.signal });
} catch {
  fail(
    `Supabase is not answering at ${url} — this is what reports itself as a` +
      '\n  Playwright `webServer` timeout, because the dev server starts fine and' +
      '\n  then cannot render a page.',
    'Run: npm run db:start   (and start Docker first if it is not running)',
  );
} finally {
  clearTimeout(timer);
}
