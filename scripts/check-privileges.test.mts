import { describe, expect, it } from 'vitest';

import { auditMigrations } from './check-privileges.mjs';

/**
 * The privilege completeness check, checked.
 *
 * **A guard whose wording or logic goes stale causes the problem it exists to
 * prevent** — the same reasoning `architecture.md` §11.1 gives for testing the
 * pre-push migration warning, which is why `scripts/` has tests at all.
 *
 * **This asserts the check passes on the real migrations**, which is the useful
 * assertion: it fails the moment somebody adds a table without RLS or a
 * function without a revoke. It cannot assert *what* is wrong, because by
 * design nothing is.
 */
describe('the migrations meet the privilege conventions', () => {
  const audit = auditMigrations();

  it('finds no problem', () => {
    // Printed rather than summarised, so a failure names the object.
    expect(audit.problems).toEqual([]);
  });

  it('actually examined the schema, rather than finding nothing because it looked at nothing', () => {
    // **The assertion that stops this passing vacuously.** A regex that stopped
    // matching `create table` would report zero problems and look green — which
    // is the failure mode of every check built out of patterns, and the one
    // that produced two false findings by hand in this cycle.
    expect(audit.tables).toBeGreaterThanOrEqual(25);
    expect(audit.functions).toBeGreaterThanOrEqual(20);
  });
});
