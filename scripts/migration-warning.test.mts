import { describe, expect, it } from 'vitest';

import { buildBlockedMessage, parsePushTarget } from './migration-warning.mjs';

/**
 * The pre-push warning's wording, which had become actively wrong.
 *
 * **This is the first test of anything in `scripts/`**, and it exists because
 * the message it covers instructed the developer to apply a migration to the
 * deployed database *before* pushing — the exact ordering `CLAUDE.md` reversed
 * on 2026-09-15. A stale sentence in a guard is not cosmetic when following it
 * causes the outage the guard exists to prevent. `architecture.md` §11.1.
 */

/** A pre-push stdin line: `<local ref> <local sha> <remote ref> <remote sha>`. */
function pushLine(remoteRef: string, localRef = 'refs/heads/work') {
  return `${localRef} aaaa1111 ${remoteRef} bbbb2222`;
}

describe('parsePushTarget', () => {
  it('reads a push to main as deploying', () => {
    expect(parsePushTarget(pushLine('refs/heads/main'))).toBe('main');
  });

  it('reads a push to any other branch as not deploying', () => {
    expect(parsePushTarget(pushLine('refs/heads/search-artist-links'))).toBe('branch');
  });

  it('treats main among several refs as deploying', () => {
    // Being too cautious here costs a message; the other direction is the outage.
    const stdin = [pushLine('refs/heads/some-branch'), pushLine('refs/heads/main')].join('\n');

    expect(parsePushTarget(stdin)).toBe('main');
  });

  it('ignores a branch deletion, which ships no code', () => {
    expect(parsePushTarget('(delete) 0000000 refs/heads/main bbbb2222')).toBe('unknown');
  });

  it('answers unknown when there is no stdin at all', () => {
    // `npm run db:pending` runs the same check by hand, with no git involved.
    expect(parsePushTarget('')).toBe('unknown');
    expect(parsePushTarget('   \n  \n')).toBe('unknown');
    expect(parsePushTarget(undefined as unknown as string)).toBe('unknown');
  });

  it('ignores a malformed line rather than guessing at it', () => {
    expect(parsePushTarget('garbage')).toBe('unknown');
  });
});

describe('buildBlockedMessage', () => {
  const pending = ['20260915160000'];

  it('names every pending migration', () => {
    const text = buildBlockedMessage({
      pending: ['20260915160000', '20260916120000'],
      target: 'branch',
    }).join('\n');

    expect(text).toContain('20260915160000');
    expect(text).toContain('20260916120000');
    expect(text).toContain('2 migrations');
  });

  it('tells a main push to apply the migration first', () => {
    const text = buildBlockedMessage({ pending, target: 'main' }).join('\n');

    expect(text).toContain('npx supabase db push --linked');
    expect(text).toContain('deploys');
  });

  it('tells a branch push NOT to apply it, and points at STEP J', () => {
    // The regression this file exists to prevent: the old message said the
    // opposite, and following it would apply schema ahead of CI.
    const text = buildBlockedMessage({ pending, target: 'branch' }).join('\n');

    expect(text).toContain('STEP J');
    expect(text).toContain('deploys nothing');
    expect(text).toContain('Do not apply it now');
    expect(text).toContain('git push --no-verify');
  });

  it('never instructs a branch push to run the deploy command', () => {
    const text = buildBlockedMessage({ pending, target: 'branch' }).join('\n');

    // `db push --linked` must not appear as an instruction on this path at all.
    expect(text).not.toContain('npx supabase db push --linked');
  });

  it('gives the unknown case both halves rather than guessing', () => {
    const text = buildBlockedMessage({ pending, target: 'unknown' }).join('\n');

    expect(text).toContain('STEP J');
    expect(text).toContain('npx supabase db push --linked');
  });
});
