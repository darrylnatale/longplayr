import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getReleaseGroup, isPlaceholderContact, userAgent } from './musicbrainz';

/**
 * The contact guard is a safety mechanism, not a nicety: an unidentifiable
 * client can get longplayr blocked at MusicBrainz for every user at once.
 * These tests make no network calls.
 */

const originalContact = process.env.MUSICBRAINZ_CONTACT;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  if (originalContact === undefined) delete process.env.MUSICBRAINZ_CONTACT;
  else process.env.MUSICBRAINZ_CONTACT = originalContact;
});

describe('isPlaceholderContact', () => {
  it('treats a missing or empty value as a placeholder', () => {
    expect(isPlaceholderContact(undefined)).toBe(true);
    expect(isPlaceholderContact('')).toBe(true);
    expect(isPlaceholderContact('   ')).toBe(true);
  });

  it('recognises common placeholder markers', () => {
    for (const value of [
      'https://placeholder.invalid',
      'dev@example.com',
      'http://localhost:3000',
      'changeme',
      'TODO',
    ]) {
      expect(isPlaceholderContact(value), `${value} should be a placeholder`).toBe(true);
    }
  });

  it('accepts a real contact URL or email', () => {
    expect(isPlaceholderContact('https://github.com/darrylnatale/longplayr')).toBe(false);
    expect(isPlaceholderContact('hello@longplayr.com')).toBe(false);
  });
});

describe('userAgent', () => {
  it('embeds the contact in the format MusicBrainz asks for', () => {
    expect(userAgent('https://github.com/darrylnatale/longplayr')).toMatch(
      /^longplayr\/\S+ \( https:\/\/github\.com\/darrylnatale\/longplayr \)$/,
    );
  });
});

describe('request guard', () => {
  it('refuses to call MusicBrainz with a placeholder contact', async () => {
    process.env.MUSICBRAINZ_CONTACT = 'https://placeholder.invalid';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(getReleaseGroup('some-mbid')).rejects.toThrow(/placeholder contact/i);

    // The important assertion: nothing left the machine.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses when the contact is unset entirely', async () => {
    delete process.env.MUSICBRAINZ_CONTACT;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(getReleaseGroup('some-mbid')).rejects.toThrow(/MUSICBRAINZ_CONTACT/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
