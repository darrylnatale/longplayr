/**
 * Collection sorting — the modes, how they are addressed, and how they order.
 *
 * One module holds three things that must never disagree: the set of modes, the
 * URL that names each one, and the `order` clauses each one issues. Splitting
 * them is how the parse half and the serialise half drift, and a sort whose
 * link says `title` while its query says something else is invisible until
 * someone reads the grid carefully.
 *
 * Nothing here touches Supabase. It is pure so the unit suite can exercise
 * every mode directly — the same seam `byReleaseDate` and `toCollectionListItem`
 * already use, because `listCollection` builds a cookie-bound client and cannot
 * be called from a test.
 *
 * **Each mode has one fixed semantic direction. There is no ascending /
 * descending toggle**, which is a deliberate divergence from the artist page's
 * Newest / Oldest pair. That page sorts one field, so direction is the whole
 * choice; here six fields times two directions is twelve addresses for a
 * control that sits above a grid, and "Rating, ascending" is not a question
 * anyone asks of their own collection. Newest, highest and A–Z are the readings
 * each field has, and the mode is the choice.
 *
 * **Filtering is not here and must not be built here.** The next slice adds
 * filter controls beside these; it does not extend this module into a generic
 * query builder.
 */

/**
 * The six modes. The value is also the `?sort=` value, so there is no mapping
 * table between what the URL says and what the code calls it.
 */
export type CollectionSort = 'added' | 'listened' | 'rating' | 'title' | 'artist' | 'year';

/** One mode, and the label the control draws for it. */
export type CollectionSortOption = {
  value: CollectionSort;
  label: string;
};

/**
 * The six modes, in the order the control draws them.
 *
 * Added leads because it is the default; the rest run from the other personal
 * field through the catalogue ones.
 */
export const COLLECTION_SORT_OPTIONS: readonly CollectionSortOption[] = [
  { value: 'added', label: 'Added' },
  { value: 'listened', label: 'Listened' },
  { value: 'rating', label: 'Rating' },
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
  { value: 'year', label: 'Year' },
] as const;

/**
 * `added_at` descending. `product-spec.md` §6, decided 2026-08-19.
 *
 * The default is a mode like any other, and it is also the bare address — the
 * same convention `?page=1` follows, and the same one the artist page's
 * `newest` follows.
 */
export const DEFAULT_COLLECTION_SORT: CollectionSort = 'added';

/** One `order` clause, in the shape `supabase-js` takes. */
export type CollectionOrderClause = {
  /**
   * A column on `collection_entries`, or an embedded album column written
   * `albums(column)` — see `collectionOrder` for why that spelling.
   */
  column: string;
  ascending: boolean;
  /** Omitted where the column cannot be null, so no null rule is emitted. */
  nullsFirst?: boolean;
};

/**
 * `?sort=` is user input and arrives as anything at all.
 *
 * Anything unrecognised resolves to the default rather than erroring, which is
 * the shape `pageFrom` and the artist page's `sortFrom` already use: a
 * malformed sort is not worth a 404. A repeated key hands back an array, and
 * the first value wins — if that first value is itself nonsense the whole thing
 * falls back, rather than hunting the array for something valid.
 *
 * Case-sensitive, deliberately and consistently with the artist page, where
 * `?sort=NEWEST` is already an invalid value that renders the default.
 */
export function parseCollectionSort(value: string | string[] | undefined): CollectionSort {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = COLLECTION_SORT_OPTIONS.find((option) => option.value === raw);
  return match ? match.value : DEFAULT_COLLECTION_SORT;
}

/**
 * The address of a collection under a given sort and page.
 *
 * The serialise half of `parseCollectionSort`, kept beside it so the two cannot
 * drift. **Both the sort control and the pagination control call this**, which
 * is what makes two rules true by construction rather than by discipline:
 *
 *  - **Changing sort resets to page 1.** The sort links pass no `page`, so the
 *    parameter is simply absent from the href. There is no redirect and no
 *    clamp — page 1 is what a missing `page` already means.
 *  - **Paging preserves the sort.** The pagination links pass the active mode,
 *    so `Older →` under Title stays under Title instead of silently reverting.
 *
 * The default mode and page 1 are both omitted, so the canonical collection
 * address stays `/<handle>/collection` with no query string at all.
 */
export function collectionPath(
  handle: string,
  { sort = DEFAULT_COLLECTION_SORT, page = 1 }: { sort?: CollectionSort; page?: number } = {},
): string {
  const params = new URLSearchParams();
  if (sort !== DEFAULT_COLLECTION_SORT) params.set('sort', sort);
  if (page > 1) params.set('page', String(page));

  const query = params.toString();
  return query ? `/${handle}/collection?${query}` : `/${handle}/collection`;
}

/**
 * The `order` clauses one mode issues, in precedence order.
 *
 * **Album fields are spelled `albums(column)` in the top-level `order`
 * parameter**, not passed as `referencedTable`. This is not a style choice and
 * the obvious alternative is silently wrong: `.order(column, { referencedTable:
 * 'albums' })` emits `albums.order=`, which PostgREST applies *within* an
 * embedded collection and ignores entirely for a to-one embed. Measured against
 * PostgREST 16.1, `albums.order=title.asc` and `albums.order=title.desc` return
 * byte-identical rows — the sort appears to work and does nothing. `postgrest-js`
 * documents the opposite ("it only affects the ordering of the parent table if
 * you use `!inner`"); that comment is wrong for this version. The spelling used
 * here goes through the top-level `order` key, which does reorder the parent,
 * composes with `range()` and leaves `count: 'exact'` intact.
 *
 * `!inner` is deliberately not used: `collection_entries.album_id` is `not
 * null` with a foreign key, so the join is already inner in effect, and the
 * plain embed needs no disambiguation.
 *
 * **Every non-default mode ends with `added_at` descending.** Rating, year,
 * listened date and credit all tie in a real collection, and a tie has no
 * defined order — so the same album can land on page 1 and page 2 of the same
 * collection, or on neither, as the planner pleases. `added_at` is effectively
 * unique per user, so one extra key makes every window deterministic. Added
 * itself needs no tiebreaker for the same reason.
 *
 * Null rules, and where each came from:
 *
 *  - **`listened_on` nulls last.** An album with no asserted date is not the
 *    oldest listen; it is one with no listen date. The per-user index is
 *    already `(user_id, listened_on desc nulls last)`, so this ordering is the
 *    index rather than a sort over it.
 *  - **`first_release_date` nulls last**, carrying over the artist page's
 *    `[DECIDED 2026-08-20]` rule that undated releases stay last in both
 *    directions (`product-spec.md` §6), and matching
 *    `albums_release_date_idx (first_release_date desc nulls last)`.
 *  - **`rating` nulls last, and unrated albums stay visible.** Decided
 *    2026-08-21. Excluding them would have been the reading of "unrated entries
 *    are excluded from averages", but that rule is about aggregation: dropping
 *    them here would hide albums from a collection, which is a different and
 *    much larger claim. `0.0` is a real score and sorts as the lowest one, not
 *    as unrated — the distinction `toCollectionListItem` exists to protect.
 *
 * `added_at`, `albums.title` and `albums.display_credit` are all `not null`, so
 * they carry no null rule at all.
 */
export function collectionOrder(sort: CollectionSort): CollectionOrderClause[] {
  /** The tiebreaker, and on its own the default mode's whole ordering. */
  const byAdded: CollectionOrderClause = { column: 'added_at', ascending: false };

  switch (sort) {
    case 'added':
      return [byAdded];

    case 'listened':
      return [{ column: 'listened_on', ascending: false, nullsFirst: false }, byAdded];

    case 'rating':
      return [{ column: 'rating', ascending: false, nullsFirst: false }, byAdded];

    case 'title':
      return [{ column: 'albums(title)', ascending: true }, byAdded];

    case 'artist':
      // Sorted by the album's own `display_credit` rather than by an artist's
      // `sort_name` (decided 2026-08-21), so The Clash files under T. The
      // alternative is two joins from here — unreachable in one PostgREST
      // query — and undefined for a joint credit, which has two sort names and
      // no rule to pick between them. Title breaks the tie before `added_at`
      // so an artist's own albums read alphabetically rather than by when they
      // happened to be added.
      return [
        { column: 'albums(display_credit)', ascending: true },
        { column: 'albums(title)', ascending: true },
        byAdded,
      ];

    case 'year':
      return [
        { column: 'albums(first_release_date)', ascending: false, nullsFirst: false },
        byAdded,
      ];
  }
}
