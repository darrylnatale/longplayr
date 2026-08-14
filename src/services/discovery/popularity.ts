/**
 * Popularity.
 *
 * Popularity is consumed by three things — catalogue seeding, search
 * disambiguation, and (later) discovery charts — and its source will change.
 * At launch there is no internal activity to rank by, so an external signal is
 * unavoidable. As usage accumulates, longplayr's own data becomes both more
 * relevant and more defensible than a third party's.
 *
 * Callers never learn which source is active. They read
 * `albums.popularity_score`; sources write it.
 *
 * The scores are ordinal, not absolute. They rank albums against each other
 * within one source and are meaningless across sources — which is exactly why
 * search treats popularity as a tiebreak rather than a weighted term.
 */

export type PopularEntry = {
  /** MusicBrainz release-group MBID. Entries without one are unusable to us. */
  mbid: string;
  title: string;
  artistName: string;
  /**
   * Primary credited artist's MBID, when the source provides one.
   *
   * Used to group an artist's albums reliably. Grouping by name would merge
   * distinct artists who share one and split artists credited inconsistently,
   * so a missing MBID falls back to the name rather than pretending otherwise.
   */
  artistMbid: string | null;
  /** Higher is more popular. Comparable only within a single source. */
  score: number;
  /**
   * Whether the source believes cover art exists. Advisory only — artwork is
   * still resolved through Cover Art Archive at ingest.
   */
  hasArtwork?: boolean;
};

export type PopularityRange = 'week' | 'month' | 'year' | 'all_time';

export interface PopularitySource {
  readonly name: string;
  /**
   * Most popular release groups, most popular first.
   *
   * Implementations must drop entries lacking an MBID rather than inventing
   * one: without it there is no reliable way to reach the right MusicBrainz
   * release group, and guessing by name is how wrong records enter a catalogue.
   */
  topReleaseGroups(options: { limit: number; range: PopularityRange }): Promise<PopularEntry[]>;
}
