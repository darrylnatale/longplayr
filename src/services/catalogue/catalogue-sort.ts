/**
 * How the catalogue-wide surface orders itself.
 *
 * **Its own vocabulary, not the collection's** (`product-spec.md` §6). The six
 * collection modes include `rating` and `listened`, which a catalogue has no
 * version of, and its `added` means *when you added it* where this one means
 * *when the catalogue got it* — the same word for two different facts. Sharing
 * the type would let this surface express states it must then reject.
 *
 * **Pure and exported so the ordering can be proven directly**, the way
 * `collectionOrder` and `byReleaseDate` already are.
 */

export type CatalogueSort = 'added' | 'year' | 'title' | 'artist';

export type CatalogueSortOption = { value: CatalogueSort; label: string };

/** The four modes, in the order the control draws them. */
export const CATALOGUE_SORT_OPTIONS: readonly CatalogueSortOption[] = [
  { value: 'added', label: 'Recently added' },
  { value: 'year', label: 'Release year' },
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
];

export const DEFAULT_CATALOGUE_SORT: CatalogueSort = 'added';

/** Whether a string is a mode this surface offers. */
export function isCatalogueSort(value: string | undefined): value is CatalogueSort {
  return CATALOGUE_SORT_OPTIONS.some((option) => option.value === value);
}

/**
 * `?sort=` is user input and arrives as anything at all.
 *
 * Anything unrecognised resolves to the default rather than erroring — a
 * malformed sort is not worth a 404, which is the same rule `?page=` already
 * applies on the relationship destinations.
 */
export function catalogueSortFrom(value: string | string[] | undefined): CatalogueSort {
  const raw = Array.isArray(value) ? value[0] : value;
  return isCatalogueSort(raw) ? raw : DEFAULT_CATALOGUE_SORT;
}

export type CatalogueOrderClause = {
  column: string;
  ascending: boolean;
  nullsFirst?: boolean;
};

/**
 * Order clauses for one mode, applied in sequence.
 *
 * **Every mode ends at `created_at`**, so the ordering is total and a page
 * boundary cannot shuffle between requests — the property `range()` pagination
 * depends on and the reason `collectionOrder` carries the same tiebreaker.
 */
export function catalogueOrder(sort: CatalogueSort): CatalogueOrderClause[] {
  /** The tiebreaker, and on its own the default mode's whole ordering. */
  const byAdded: CatalogueOrderClause = { column: 'created_at', ascending: false };

  switch (sort) {
    case 'added':
      return [byAdded];

    case 'title':
      return [{ column: 'title', ascending: true }, byAdded];

    case 'artist':
      // **The 2026-08-21 rule, reused rather than re-argued.** Sorted by the
      // album's own `display_credit` rather than an artist's `sort_name`, so
      // The Clash files under T. The alternative needs two joins — unreachable
      // in one PostgREST query — and is undefined for a joint credit, which has
      // two sort names and no rule to choose between them. Title breaks the tie
      // before `created_at` so an artist's albums read alphabetically rather
      // than by when they happened to be ingested.
      return [
        { column: 'display_credit', ascending: true },
        { column: 'title', ascending: true },
        byAdded,
      ];

    case 'year':
      // **Undated releases stay last**, matching the discography sort rather
      // than surfacing them as though they were the oldest records held.
      return [
        { column: 'first_release_date', ascending: false, nullsFirst: false },
        { column: 'title', ascending: true },
        byAdded,
      ];
  }
}
