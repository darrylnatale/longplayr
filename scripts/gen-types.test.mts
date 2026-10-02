import { describe, expect, it } from 'vitest';

import { looksLikeGeneratedTypes } from './gen-types.mjs';

/**
 * The guard that stops a failed generation overwriting a tracked file.
 *
 * **The case that actually happened is the second one.** `supabase gen types`
 * with the database unreachable printed its error as JSON on stdout, and the
 * old shell redirect had already truncated the target — so the file became
 * that JSON and `tsc` failed on line 1. F-058.
 */
describe('looksLikeGeneratedTypes', () => {
  it('accepts real generated output', () => {
    expect(
      looksLikeGeneratedTypes('export type Json =\n  | string\n  | number\n  | boolean\n'),
    ).toBe(true);
  });

  it('rejects the CLI error JSON that caused F-058', () => {
    expect(
      looksLikeGeneratedTypes(
        '{"_tag":"Error","error":{"code":"UnknownError","message":"failed to inspect service"}}',
      ),
    ).toBe(false);
  });

  it('rejects empty and non-string output', () => {
    // An empty capture is the other way a redirect leaves a broken file.
    expect(looksLikeGeneratedTypes('')).toBe(false);
    expect(looksLikeGeneratedTypes(undefined)).toBe(false);
    expect(looksLikeGeneratedTypes(null)).toBe(false);
  });

  it('rejects JSON that happens to mention the marker', () => {
    // **Belt and braces, and the reason the check is two conditions.** An error
    // payload quoting the file's own contents back would otherwise pass.
    expect(looksLikeGeneratedTypes('{"error":"cannot write export type Json"}')).toBe(false);
  });

  it('accepts output preceded by a leading comment or blank line', () => {
    // A future CLI version adding a header must not be treated as a failure —
    // the guard exists to catch error payloads, not to pin a format.
    expect(looksLikeGeneratedTypes('\n// generated\nexport type Json = string\n')).toBe(true);
  });
});
