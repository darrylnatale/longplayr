import { describe, expect, it } from 'vitest';

import { detect, LAYERS, remedyFor } from './check-env.mjs';

/**
 * The environment check, checked.
 *
 * **Injected probes rather than a real daemon**, so the layering is tested
 * without needing the thing being detected — which is the only way to assert
 * the *Docker down* branch while Docker is up, and vice versa.
 */
describe('detect', () => {
  const probes = (docker: boolean, stack: boolean, env: boolean) => ({
    docker: () => docker,
    stack: () => stack,
    env: () => env,
  });

  it('reports the first missing layer, not the last', () => {
    // **The ordering is the whole value.** With Docker down, "the stack is not
    // started" is true but useless — starting it is impossible until Docker is.
    expect(detect(probes(false, false, false))).toBe('docker');
    expect(detect(probes(true, false, false))).toBe('stack');
    expect(detect(probes(true, true, false))).toBe('env');
    expect(detect(probes(true, true, true))).toBe('ready');
  });

  it('does not report docker as up merely because the stack probe succeeds', () => {
    // A stale container listing could otherwise mask a dead daemon.
    expect(detect(probes(false, true, true))).toBe('docker');
  });
});

describe('remedyFor', () => {
  it('names a command for every layer that is not ready', () => {
    for (const layer of LAYERS.filter((l) => l !== 'ready')) {
      const remedy = remedyFor(layer);
      expect(remedy).not.toBeNull();
      expect(remedy!.problem.length).toBeGreaterThan(0);
      expect(remedy!.remedy.length).toBeGreaterThan(0);
    }
  });

  it('returns nothing for ready, so the caller cannot print a remedy for a healthy stack', () => {
    expect(remedyFor('ready')).toBeNull();
  });

  it('tells somebody with a half-started daemon to quit it fully', () => {
    // **The specific failure of 2026-10-02**: `open -a Docker` was not enough
    // three times over, and a full quit-and-reopen was. A message that only
    // said "start Docker" would have been true and useless.
    expect(remedyFor('docker')!.remedy).toMatch(/quit it fully/);
  });
});
