import type { PopularEntry } from '../discovery/popularity';

/**
 * Initial seed selection.
 *
 * Deliberately separate from the popularity source. A `PopularitySource`
 * answers "what is popular"; this answers "what should we seed", which is a
 * different question with different reasons behind it. Keeping them apart is
 * what lets longplayr's own activity replace ListenBrainz later without
 * touching selection policy, and vice versa.
 *
 * ## The artist cap is a cold-start device, not a catalogue rule
 *
 * Without it, a handful of artists dominate: measured against ListenBrainz,
 * all-time popularity gives one artist 17 of the top 500. A first-time visitor
 * would see a catalogue that looks like a fan site rather than a music
 * collection.
 *
 * **It applies only to this initial selection.** It is not a constraint on the
 * catalogue. Users can add any number of albums by any artist through
 * self-service, later seeds can raise or drop the cap entirely, and nothing in
 * the schema or the ingestion path enforces it. An artist capped here today is
 * fully reachable tomorrow.
 *
 * ## What is deliberately not done
 *
 * No genre or era diversification. The ListenBrainz endpoint returns neither,
 * so either would require an extra MusicBrainz request per candidate — 500
 * requests, roughly eight minutes, purely to decide what to fetch. Artist
 * identity is the one diversification dimension the data supports for free.
 */

export type SelectionOptions = {
  /** Maximum albums per artist. `null` disables the cap entirely. */
  maxPerArtist: number | null;
  /** Stop after this many selections. */
  limit?: number;
};

export type SelectionResult = {
  selected: PopularEntry[];
  /** Dropped by the cap. Retained so the dry run can show what was set aside. */
  excludedByCap: PopularEntry[];
  distinctArtists: number;
  /** Artists whose albums were capped, most affected first. */
  cappedArtists: { name: string; kept: number; excluded: number }[];
};

/**
 * Groups an artist's entries.
 *
 * Prefers the MBID, since names are neither unique nor stable — two artists can
 * share one, and one artist can be credited several ways. Falls back to a
 * normalised name only when no MBID is present, which is rare and better than
 * treating every such entry as a distinct artist.
 */
function artistKey(entry: PopularEntry): string {
  return entry.artistMbid ?? `name:${entry.artistName.trim().toLowerCase()}`;
}

export function selectSeedCandidates(
  candidates: readonly PopularEntry[],
  options: SelectionOptions,
): SelectionResult {
  const { maxPerArtist, limit } = options;

  const keptByArtist = new Map<string, number>();
  const excludedByArtist = new Map<string, number>();
  const names = new Map<string, string>();

  const selected: PopularEntry[] = [];
  const excludedByCap: PopularEntry[] = [];

  // Candidates arrive in popularity order and stay in it: the cap decides what
  // is included, never how it is ranked.
  for (const entry of candidates) {
    if (limit !== undefined && selected.length >= limit) break;

    const key = artistKey(entry);
    names.set(key, entry.artistName);

    const kept = keptByArtist.get(key) ?? 0;

    if (maxPerArtist !== null && kept >= maxPerArtist) {
      excludedByCap.push(entry);
      excludedByArtist.set(key, (excludedByArtist.get(key) ?? 0) + 1);
      continue;
    }

    keptByArtist.set(key, kept + 1);
    selected.push(entry);
  }

  const cappedArtists = [...excludedByArtist.entries()]
    .map(([key, excluded]) => ({
      name: names.get(key) ?? key,
      kept: keptByArtist.get(key) ?? 0,
      excluded,
    }))
    .sort((a, b) => b.excluded - a.excluded);

  return {
    selected,
    excludedByCap,
    distinctArtists: keptByArtist.size,
    cappedArtists,
  };
}
