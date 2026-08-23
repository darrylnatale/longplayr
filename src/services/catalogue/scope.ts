import type { Database } from '@/lib/supabase/database.types';

import type { MbReleaseGroup } from './musicbrainz';

export type AlbumType = Database['public']['Enums']['album_type'];
export type AlbumSecondaryType = Database['public']['Enums']['album_secondary_type'];
export type DatePrecision = Database['public']['Enums']['date_precision'];

/**
 * Catalogue scope.
 *
 * Albums, EPs and mixtapes — including live albums, compilations and
 * soundtracks. **Singles are outside the current boundary.** Enforced here, at
 * ingest, so an out-of-scope release group never becomes a row; filtering at
 * query time would mean carrying the exclusion in every read.
 *
 * **This boundary is not permanent, and this comment used to say it was.** It
 * read "Singles are never ingested", which is no longer the rule: the exclusion
 * holds today, but "singles are permanently excluded" is explicitly undecided
 * (`docs/product-spec.md` §8.9, amended 2026-08-23). Completionism should not
 * exclude material by release type as a matter of principle, and the eventual
 * treatment turns on the single *release* versus the unique *recordings* it
 * carries — a standalone track or a B-side found nowhere else.
 *
 * **Nothing here changes until that is decided.** Do not relax the filter, and
 * do not read the two rejection sets below as the same kind of rule: one is a
 * boundary, the other is a judgement about what counts as music.
 */

/** MusicBrainz primary types we accept, lowercased. */
const ACCEPTED_PRIMARY: Record<string, AlbumType> = {
  album: 'album',
  ep: 'ep',
};

/**
 * Outside the **current** boundary, by primary type. A release group whose
 * primary type is Single is out of scope even when it carries a secondary type
 * we otherwise accept.
 *
 * Both entries are temporary in principle rather than excluded on merit, and
 * `broadcast` in particular has never been discussed in any document — it is
 * recorded as an open item in `docs/product-spec.md` §8.9. Note that it is
 * remix and demo *singles* that this rejects; remix and demo *albums* are
 * accepted secondary types below.
 */
const REJECTED_PRIMARY = new Set(['single', 'broadcast']);

const SECONDARY_TYPES: Record<string, AlbumSecondaryType> = {
  compilation: 'compilation',
  soundtrack: 'soundtrack',
  live: 'live',
  remix: 'remix',
  mixtape: 'mixtape',
  'mixtape/street': 'mixtape',
  demo: 'demo',
  spokenword: 'spokenword',
  interview: 'interview',
  audiobook: 'audiobook',
  'dj-mix': 'dj_mix',
};

/**
 * Secondary types that are out of scope regardless of primary type: these are
 * not music in the sense this product is about.
 */
const REJECTED_SECONDARY = new Set(['audiobook', 'audio drama', 'interview', 'spokenword']);

export type ScopeDecision =
  | { inScope: true; primaryType: AlbumType; secondaryTypes: AlbumSecondaryType[] }
  | { inScope: false; reason: string };

export function classify(group: {
  'primary-type'?: string | null;
  'secondary-types'?: string[];
}): ScopeDecision {
  const primaryRaw = (group['primary-type'] ?? '').toLowerCase();
  const secondaryRaw = (group['secondary-types'] ?? []).map((type) => type.toLowerCase());

  if (REJECTED_PRIMARY.has(primaryRaw)) {
    return { inScope: false, reason: `primary type "${primaryRaw}" is out of scope` };
  }

  for (const type of secondaryRaw) {
    if (REJECTED_SECONDARY.has(type)) {
      return { inScope: false, reason: `secondary type "${type}" is out of scope` };
    }
  }

  // A mixtape may arrive with no primary type at all, since MusicBrainz treats
  // "Mixtape/Street" as a secondary type. Accept those as albums.
  const isMixtape = secondaryRaw.some((type) => type.startsWith('mixtape'));

  const primaryType = ACCEPTED_PRIMARY[primaryRaw] ?? (isMixtape ? 'album' : undefined);

  if (!primaryType) {
    return {
      inScope: false,
      reason: primaryRaw ? `primary type "${primaryRaw}" is out of scope` : 'no primary type',
    };
  }

  const secondaryTypes = [
    ...new Set(
      secondaryRaw.map((type) => SECONDARY_TYPES[type]).filter((t): t is AlbumSecondaryType => !!t),
    ),
  ];

  return { inScope: true, primaryType, secondaryTypes };
}

export function isInScope(group: MbReleaseGroup): boolean {
  return classify(group).inScope;
}

/**
 * MusicBrainz dates are frequently partial: "2004", "2004-03", "2004-03-12".
 *
 * Stored as a full date with the gaps defaulted so sorting and range queries
 * stay trivial, alongside a precision marker so display never claims a day it
 * does not know.
 */
export function parsePartialDate(
  value: string | null | undefined,
): { date: string; precision: DatePrecision } | null {
  if (!value) return null;

  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day] = match;

  if (day) return { date: `${year}-${month}-${day}`, precision: 'day' };
  if (month) return { date: `${year}-${month}-01`, precision: 'month' };
  return { date: `${year}-01-01`, precision: 'year' };
}

/** Renders a stored date honestly, showing only what the source actually knew. */
export function formatPartialDate(
  date: string | null,
  precision: DatePrecision | null,
): string | null {
  if (!date) return null;

  const [year, month, day] = date.split('-');

  if (precision === 'year' || !precision) return year;
  if (precision === 'month') {
    return new Date(`${year}-${month}-01T00:00:00Z`).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  return new Date(`${year}-${month}-${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
