/**
 * Whether an album's missing release date was ever ours to lose.
 *
 * **`parsePartialDate` returns null on two paths and only one of them is
 * honest.** The upstream value can be absent or empty — upstream truth, common
 * for compilations, remix collections and live releases — or it can be present
 * and fail the `YYYY(-MM)?(-DD)?` pattern, which is **silent loss**. Nothing in
 * the product has ever recorded which happened. `architecture.md` §17c.
 *
 * **Answerable at all because of `architecture.md` §7a**, which keeps every
 * upstream response verbatim and indefinitely — so this compares a stored
 * payload against a column with **no MusicBrainz round trip and no rate-limit
 * exposure.** Without that decision the question would mean re-fetching the
 * catalogue at one request per second.
 *
 * **This module reports and never corrects.** A classifier that quietly
 * normalised a bad value would make the fault invisible in the act of
 * measuring it.
 */

import { parsePartialDate } from './scope';

/**
 * What the stored payload says about an album whose column holds no date.
 *
 * **Three outcomes, not two, and the third is the one a narrower check would
 * hide.** Testing only whether the value parses would report a payload that
 * *has* a perfectly good date as though upstream had given us nothing —
 * concealing a loss that happened after parsing rather than during it.
 */
export type DateCaptureVerdict =
  /** Upstream held no date either. Expected, and the common case. */
  | 'upstream-empty'
  /** The payload carries a value the date pattern rejects. Silent loss at parse. */
  | 'malformed'
  /** The payload carries a valid date the column does not hold. Loss after parse. */
  | 'lost'
  /** No payload stored, so nothing can be concluded either way. */
  | 'no-payload'
  /** A payload exists but is not the shape this reads. Reported, never guessed at. */
  | 'unreadable';

/** Whether a verdict means something went wrong on our side. */
export function isCaptureFault(verdict: DateCaptureVerdict): boolean {
  return verdict === 'malformed' || verdict === 'lost';
}

/**
 * Reads the first-release-date out of a stored release-group payload.
 *
 * **Defensive because the payload is deliberately untyped.** §7a stores
 * responses verbatim so that nothing depends on their shape; this reads one
 * field and treats anything unexpected as `unreadable` rather than throwing or
 * assuming.
 */
function payloadDate(payload: unknown): { present: boolean; raw: string | null } | null {
  if (payload === null || typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;
  if (!('first-release-date' in record)) {
    // The key being absent is a real answer: MusicBrainz omits it rather than
    // sending an empty string, so this is upstream silence rather than a shape
    // this code failed to understand.
    return { present: false, raw: null };
  }

  const value = record['first-release-date'];
  if (value === null || value === undefined || value === '') return { present: false, raw: null };
  if (typeof value !== 'string') return null;

  return { present: true, raw: value };
}

/**
 * Classifies one album whose stored `first_release_date` is null.
 *
 * **Only call this for albums with no date**, since an album that has one is
 * not evidence of anything either way.
 */
export function classifyMissingDate(payload: unknown): DateCaptureVerdict {
  if (payload === null || payload === undefined) return 'no-payload';

  const found = payloadDate(payload);
  if (found === null) return 'unreadable';
  if (!found.present) return 'upstream-empty';

  // A value is there. Whether it parses decides which fault this is — and both
  // are faults, because either way the catalogue is missing a date the payload
  // was holding all along.
  return parsePartialDate(found.raw) === null ? 'malformed' : 'lost';
}

/** One album's verdict, with what the payload actually held. */
export type DateCaptureRow = {
  mbid: string;
  title: string;
  verdict: DateCaptureVerdict;
  /** The raw upstream value, when there was one. Shown so a fault is diagnosable. */
  payloadValue: string | null;
};

/** The raw upstream value, for reporting alongside a verdict. */
export function payloadDateValue(payload: unknown): string | null {
  const found = payloadDate(payload);
  return found?.raw ?? null;
}
