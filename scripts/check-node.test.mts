import { describe, expect, it } from 'vitest';

import { nodeVersionProblem } from './check-node.mjs';

/**
 * The Node version guard - F-062.
 *
 * **The boundary is 22.12, not 22.** `require(esm)` is unflagged from 22.12,
 * so a major-version check would pass 22.0 through 22.11 and leave them
 * failing with the cryptic worker crash this script exists to replace.
 */
describe('nodeVersionProblem', () => {
  it('rejects the version that produced the original failure', () => {
    // The real local runtime on 2026-10-03.
    expect(nodeVersionProblem('v20.17.0')).toContain('too old');
  });

  it('rejects a 22 that is still too early, which a major check would pass', () => {
    expect(nodeVersionProblem('v22.11.0')).toContain('too old');
  });

  it('accepts the first version that actually works', () => {
    expect(nodeVersionProblem('v22.12.0')).toBeNull();
  });

  it('accepts the version CI resolves to', () => {
    expect(nodeVersionProblem('v22.23.2')).toBeNull();
  });

  it('accepts a later major', () => {
    expect(nodeVersionProblem('v24.0.0')).toBeNull();
  });

  it('says nothing about a version string it cannot parse', () => {
    // **Silence, not a block.** A string this did not anticipate is not
    // evidence of a problem, and refusing to run on one would turn a guard
    // into an outage on somebody's working machine.
    expect(nodeVersionProblem('weird')).toBeNull();
    expect(nodeVersionProblem('')).toBeNull();
  });

  it('names the cause, not just the rule', () => {
    const message = nodeVersionProblem('v20.17.0') ?? '';
    // The whole point is that the original failure named neither.
    expect(message).toMatch(/jsdom/i);
    expect(message).toMatch(/22\.12/);
    expect(message).toMatch(/nvm use/);
  });
});
