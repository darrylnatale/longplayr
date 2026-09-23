import { describe, expect, it } from 'vitest';

import { exportFilename } from './index';

/**
 * The download's name.
 *
 * **Pure and tested separately** because it is the one part of the export that
 * can be proven without a database, and because a filename that collides or
 * carries a path separator is a real problem on the receiving machine.
 */

describe('exportFilename', () => {
  it('names the file for the person and the day', () => {
    expect(exportFilename('darryl', new Date('2026-09-23T14:31:00Z'))).toBe(
      'longplayr-darryl-2026-09-23.json',
    );
  });

  it('uses the UTC date rather than the local one', () => {
    // Two people exporting at the same instant get the same date, whatever
    // their machines say.
    expect(exportFilename('darryl', new Date('2026-09-23T23:59:59Z'))).toBe(
      'longplayr-darryl-2026-09-23.json',
    );
  });

  it('cannot produce a path separator, because a handle cannot contain one', () => {
    // Handles are `^[a-z][a-z0-9_]{2,29}$` (`src/services/profiles/handle.ts`),
    // so no escaping is needed here — and this asserts the dependency rather
    // than leaving it implicit for whoever loosens that pattern.
    const name = exportFilename('a_valid_handle_9');
    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
    expect(name).not.toContain('..');
  });
});
