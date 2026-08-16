import { describe, expect, it } from 'vitest';

import { artworkPath, coverArtUrl, storedArtworkUrl } from './artwork';

const MBID = 'b1392450-e666-3926-a536-22c65f834433';

describe('coverArtUrl', () => {
  it('addresses the release group, so a cover cannot land on the wrong album', () => {
    expect(coverArtUrl(MBID, 500)).toBe(
      `https://coverartarchive.org/release-group/${MBID}/front-500`,
    );
  });
});

describe('artworkPath', () => {
  it('keys objects by MBID and size', () => {
    expect(artworkPath(MBID, 250)).toBe(`${MBID}/250.jpg`);
  });
});

describe('storedArtworkUrl', () => {
  it('builds a public storage URL', () => {
    expect(storedArtworkUrl('https://x.supabase.co', MBID, 500)).toBe(
      `https://x.supabase.co/storage/v1/object/public/artwork/${MBID}/500.jpg`,
    );
  });

  it('survives whitespace in the environment variable', () => {
    // A tab pasted into a Vercel env var broke every cover on staging: the URL
    // constructor tolerated it, string concatenation did not.
    for (const dirty of [
      'https://x.supabase.co\t',
      'https://x.supabase.co\n',
      ' https://x.supabase.co ',
    ]) {
      expect(storedArtworkUrl(dirty, MBID, 500)).toBe(
        `https://x.supabase.co/storage/v1/object/public/artwork/${MBID}/500.jpg`,
      );
    }
  });

  it('survives a trailing slash', () => {
    expect(storedArtworkUrl('https://x.supabase.co/', MBID, 500)).toBe(
      `https://x.supabase.co/storage/v1/object/public/artwork/${MBID}/500.jpg`,
    );
  });
});
