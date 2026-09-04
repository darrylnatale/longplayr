import { describe, expect, it } from 'vitest';

import {
  LIST_DESCRIPTION_MAX,
  LIST_TITLE_MAX,
  LISTS_PAGE_SIZE,
  LISTS_PREVIEW_LIMIT,
  validateListFields,
} from './index';

/**
 * List field rules, without a database.
 *
 * **These bounds exist twice on purpose** — here and as check constraints in
 * `20260903150000_create_lists.sql`. The database is the integrity boundary; the
 * service exists so a caller gets a message instead of a raw Postgres error.
 * **If either side changes, these tests are what makes the two disagree
 * loudly.**
 */

describe('validateListFields — title', () => {
  it('rejects an empty title', () => {
    const result = validateListFields('', null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('title_required');
  });

  it('rejects a title that is only whitespace', () => {
    // The constraint checks `char_length(btrim(title))`, so a space-only title
    // would be refused by the database too. This is the friendlier half.
    const result = validateListFields('   \n  ', null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('title_required');
  });

  it('trims the title it returns', () => {
    const result = validateListFields('  Records for a long drive  ', null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.title).toBe('Records for a long drive');
  });

  it('accepts a title at the maximum length', () => {
    expect(validateListFields('a'.repeat(LIST_TITLE_MAX), null).ok).toBe(true);
  });

  it('rejects a title one character past the maximum', () => {
    const result = validateListFields('a'.repeat(LIST_TITLE_MAX + 1), null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('title_too_long');
  });

  it('measures the trimmed length, not the raw input', () => {
    // Padding a maximum-length title must not push it over: the database sees
    // the trimmed value, so the service must judge the same string.
    const padded = `  ${'a'.repeat(LIST_TITLE_MAX)}  `;
    expect(validateListFields(padded, null).ok).toBe(true);
  });
});

describe('validateListFields — description', () => {
  it('treats an empty description as absent', () => {
    const result = validateListFields('Title', '');
    expect(result.ok).toBe(true);
    // Null rather than an empty string, so "no description" has one
    // representation rather than two that render identically.
    if (result.ok) expect(result.data.description).toBeNull();
  });

  it('treats a whitespace-only description as absent', () => {
    const result = validateListFields('Title', '   ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.description).toBeNull();
  });

  it('trims a description it keeps', () => {
    const result = validateListFields('Title', '  Something about it.  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.description).toBe('Something about it.');
  });

  it('accepts a description at the maximum length', () => {
    expect(validateListFields('Title', 'a'.repeat(LIST_DESCRIPTION_MAX)).ok).toBe(true);
  });

  it('rejects a description one character past the maximum', () => {
    const result = validateListFields('Title', 'a'.repeat(LIST_DESCRIPTION_MAX + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('description_too_long');
  });
});

describe('page sizes', () => {
  it('previews fewer lists than a page holds', () => {
    // Otherwise the profile preview and its destination would show the same
    // thing, and the "All N" link would be a link to what you are already
    // looking at.
    expect(LISTS_PREVIEW_LIMIT).toBeLessThan(LISTS_PAGE_SIZE);
  });
});
