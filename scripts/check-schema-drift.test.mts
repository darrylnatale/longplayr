import { describe, expect, it } from 'vitest';

import { PLATFORM_BASELINE, unexplained } from './check-schema-drift.mjs';

/**
 * The allowlist that keeps the drift check readable.
 *
 * **A check that always fails is a check nobody reads**, which is why the
 * Supabase baseline is excluded — and **a stale allowlist stops reporting the
 * thing the check exists for**, which is why it is tested.
 */
describe('unexplained', () => {
  it('treats an empty diff as no drift', () => {
    expect(unexplained('')).toEqual([]);
    expect(unexplained('   \n  ')).toEqual([]);
    expect(unexplained(undefined)).toEqual([]);
  });

  it('ignores the Supabase baseline, which is present on every diff', () => {
    // The exact payload observed against the linked project on 2026-10-02.
    const diff = [
      '-- Migration unit 1: schema_changes',
      '',
      'DROP EXTENSION pg_net;',
      '',
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM anon;',
      '',
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM authenticated;',
      '',
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM service_role;',
    ].join('\n');

    expect(unexplained(diff)).toEqual([]);
  });

  it('reports a real difference alongside the baseline', () => {
    // **The assertion that matters.** Baseline noise must not swallow a genuine
    // statement sitting next to it.
    const diff = 'DROP EXTENSION pg_net;\n\nDROP TABLE public.reports;';
    const problems = unexplained(diff);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('DROP TABLE public.reports');
  });

  it('reports a dropped index, which is the quiet kind of drift', () => {
    const problems = unexplained('DROP INDEX public.albums_created_at_idx;');
    expect(problems).toHaveLength(1);
  });

  it('does not report a chunk that is only comments', () => {
    expect(unexplained('-- Migration unit 1\n-- Transaction mode: transactional')).toEqual([]);
  });

  it('matches the baseline by statement rather than by role name alone', () => {
    // A revoke on TABLES is not the sequences baseline, and must still report.
    const problems = unexplained(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE ON TABLES FROM anon;',
    );
    expect(problems).toHaveLength(1);
  });

  it('keeps the baseline non-empty, so an emptied allowlist fails loudly', () => {
    expect(PLATFORM_BASELINE.length).toBeGreaterThan(0);
  });
});
