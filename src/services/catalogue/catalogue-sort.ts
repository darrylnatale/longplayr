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

/**
 * Whether a sort runs the other way from its natural direction.
 *
 * **Intent rather than direction, deliberately.** The natural direction differs
 * by axis — dates default newest first, alphabetical defaults A–Z — so a raw
 * `asc`/`desc` parameter would mean "the default" on one sort and "reversed" on
 * another. A boolean says the same thing about every axis.
 */
export type CatalogueDirection = { reversed: boolean };

/** `?dir=` is user input; anything but the one recognised value is the default. */
export function catalogueReversedFrom(value: string | string[] | undefined): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === REVERSED_PARAM;
}

/** The only value `?dir=` ever carries. Its absence is the natural direction. */
export const REVERSED_PARAM = 'rev';

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

/**
 * Order clauses for one mode, run the other way if asked.
 *
 * **Only the leading clause flips, and the two things it leaves alone are the
 * point.**
 *
 * **`nullsFirst` does not flip.** With `nullsFirst: false` an undated release
 * sorts last under *both* directions, which is exactly how `product-spec.md`
 * §6's _"undated releases stay last in both directions"_ is satisfied. Flipping
 * it would put undated albums at the top of an oldest-first run, where they
 * would read as **the earliest records held** — the specific failure that rule
 * was written to name.
 *
 * **Tiebreakers do not flip.** They are what make the ordering total, and
 * `range()` pagination depends on totality: two rows that can compare equal may
 * swap between requests, and an album then appears twice or not at all across a
 * page boundary. Reversing the artist sort therefore gives artists Z–A while
 * each artist's own albums still read A–Z — which is also what a reader
 * reversing *artist* is asking for.
 */
export function catalogueOrderFor(sort: CatalogueSort, reversed = false): CatalogueOrderClause[] {
  const clauses = catalogueOrder(sort);
  if (!reversed) return clauses;

  const [leading, ...rest] = clauses;
  return [{ ...leading, ascending: !leading.ascending }, ...rest];
}
