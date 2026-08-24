import { describe, expect, it } from 'vitest';

import { withinCurrentDepth } from './depth-policy';

import type { MbReleaseGroup } from './musicbrainz';

/**
 * The current depth boundary (`docs/product-spec.md` §8.9).
 *
 * **These assertions encode a temporary boundary, not a principle.** Live
 * albums, compilations, soundtracks and DJ-mixes are all in catalogue *scope*;
 * they are held out of this expansion only. When that changes it is a product
 * decision recorded in §8.9, and these tests change with it — but they must not
 * be weakened to let an implementation pass.
 */
const group = (over: Partial<MbReleaseGroup> = {}): MbReleaseGroup =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Test',
    'primary-type': 'Album',
    'secondary-types': [],
    'artist-credit': [],
    ...over,
  }) as MbReleaseGroup;

describe('withinCurrentDepth — included', () => {
  it('includes a plain album', () => {
    expect(withinCurrentDepth(group())).toEqual({ inDepth: true });
  });

  it('includes an EP', () => {
    expect(withinCurrentDepth(group({ 'primary-type': 'EP' }))).toEqual({ inDepth: true });
  });

  it('includes a mixtape carrying no primary type', () => {
    expect(
      withinCurrentDepth(
        group({ 'primary-type': undefined, 'secondary-types': ['Mixtape/Street'] }),
      ),
    ).toEqual({ inDepth: true });
  });

  it('includes a remix album — not named by the current boundary', () => {
    expect(withinCurrentDepth(group({ 'secondary-types': ['Remix'] }))).toEqual({ inDepth: true });
  });

  it('includes a demo album — not named by the current boundary', () => {
    expect(withinCurrentDepth(group({ 'secondary-types': ['Demo'] }))).toEqual({ inDepth: true });
  });
});

describe('withinCurrentDepth — outside the current boundary', () => {
  it.each([
    ['Live', 'live'],
    ['Compilation', 'compilation'],
    ['Soundtrack', 'soundtrack'],
    ['DJ-mix', 'dj-mix'],
  ])('excludes %s', (upstream, normalised) => {
    const result = withinCurrentDepth(group({ 'secondary-types': [upstream] }));
    expect(result.inDepth).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining(normalised) });
  });

  it('excludes a live album even though scope accepts it', () => {
    // The distinction this whole module exists for: in scope, out of depth.
    const live = group({ 'secondary-types': ['Live'] });
    expect(withinCurrentDepth(live).inDepth).toBe(false);
  });

  it('excludes when any one secondary type is out of depth', () => {
    expect(withinCurrentDepth(group({ 'secondary-types': ['Remix', 'Live'] })).inDepth).toBe(false);
  });
});

describe('withinCurrentDepth — defers to scope', () => {
  it('rejects a single, with scope’s reason rather than a depth reason', () => {
    const result = withinCurrentDepth(group({ 'primary-type': 'Single' }));
    expect(result.inDepth).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining('single') });
  });

  it('rejects a spokenword release as scope does', () => {
    expect(withinCurrentDepth(group({ 'secondary-types': ['Spokenword'] })).inDepth).toBe(false);
  });

  it('rejects a release group with no primary type and no mixtape marker', () => {
    expect(withinCurrentDepth(group({ 'primary-type': undefined })).inDepth).toBe(false);
  });
});
