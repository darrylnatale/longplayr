-- longplayr — search precision: article normalisation in the fuzzy operands
--
-- **The defect.** A shared leading article inflates trigram overlap between
-- otherwise unrelated strings, so the fuzzy tier floods for any article-leading
-- query. Measured at 707 albums: `similarity('The Wake', 'the warning') = 0.400`,
-- comfortably over the 0.3 threshold, which admitted all eight of that artist's
-- albums. For the query "the warning", 11 albums entered through the credit
-- predicate, 2 through title and 1 through full text.
--
-- **What changes: only the two fuzzy similarity operands.** A leading `the`,
-- `a` or `an` is removed from *both* sides before comparing. Removing it from
-- one side would not help — it is the shared trigrams that inflate the score.
--
-- **The threshold stays at 0.3, deliberately.** Raising it was tried and
-- rejected: an 883-query sweep across all 317 artists showed the legitimate and
-- false-positive distributions materially overlap (legitimate self-matches
-- reach down to 0.231, false positives up to 0.667). At `> 0.5` only 55% of
-- ordinary partial-name queries survived — `michael `, `arctic m`, `olivia r`,
-- `imagine ` and `nine inc` all score exactly 0.500 and would have been lost.
-- See `docs/architecture.md` §10.
--
-- **This is a tradeoff, not a free win.** Across the same 883 queries:
-- legitimate recall 97% -> 92%, false-positive admission 21% -> 12%. The lost
-- 5 points are short prefixes of article-leading artists (`the we` no longer
-- reaches The Weeknd's albums through fuzzy credit). Those artists remain
-- discoverable through `search_artists`, whose name-prefix predicate is
-- untouched. The product accepts that exchange.
--
-- **Deliberately unchanged:** the tsquery, `search_vector`, both generated
-- columns, both GIN indexes, every exact and prefix predicate, tier numbering,
-- tier ordering, result ordering, limits, signatures, return types, grants and
-- volatility. Stripping the article from the *tsquery* was also tried and
-- produced no change in any measured result — the full-text tier was never the
-- problem, and that change is not made here.

create or replace function public.search_albums(query text, max_results integer default 20)
returns table (
  id uuid,
  mbid uuid,
  title text,
  display_credit text,
  primary_type public.album_type,
  artwork_status public.artwork_status,
  first_release_date date,
  first_release_date_precision public.date_precision,
  popularity_score integer,
  tier smallint,
  text_rank real
)
language sql
stable
as $$
  with normalised as (
    select
      lower(btrim(query)) as q,
      websearch_to_tsquery('simple', btrim(query)) as tsq,
      -- Used by the fuzzy comparison only. `q` above is untouched, so every
      -- exact and prefix predicate keeps its existing semantics.
      regexp_replace(lower(btrim(query)), '^(the|a|an)\s+', '', 'i') as fuzzy_q
  )
  select
    a.id, a.mbid, a.title, a.display_credit, a.primary_type, a.artwork_status,
    a.first_release_date, a.first_release_date_precision, a.popularity_score,
    case
      -- Tier 1: the title is exactly what was typed.
      when lower(a.title) = n.q then 1
      -- Tier 2: exact artist match, or the title begins with the query.
      when lower(a.display_credit) = n.q then 2
      when lower(a.title) like n.q || '%' then 2
      -- Tier 3: full-text match across title (weight A) and credit (weight B).
      when a.search_vector @@ n.tsq then 3
      -- Tier 4: fuzzy, for typos and partial words.
      else 4
    end::smallint as tier,
    -- Rounded so near-identical relevance collapses into a tie and popularity
    -- can act. Without this, ts_rank's continuous values would almost never
    -- tie and popularity would effectively never be consulted.
    round(ts_rank(a.search_vector, n.tsq)::numeric, 2)::real as text_rank
  from public.albums a, normalised n
  where
    n.q <> ''
    and (
      a.search_vector @@ n.tsq
      or lower(a.title) like n.q || '%'
      or similarity(a.title, n.q) > 0.3
      -- Article-normalised on both sides. See the header.
      or similarity(regexp_replace(a.display_credit, '^(the|a|an)\s+', '', 'i'), n.fuzzy_q) > 0.3
    )
  order by
    tier asc,
    text_rank desc,
    -- Secondary only. Never lifts a weaker text match above a stronger one,
    -- because tier and text_rank are both compared first.
    a.popularity_score desc nulls last,
    a.title asc
  limit greatest(1, least(max_results, 100));
$$;

comment on function public.search_albums is
  'Tiered album search: text relevance selects the tier, popularity orders within it. Fuzzy credit matching is article-normalised on both operands.';

create or replace function public.search_artists(query text, max_results integer default 10)
returns table (
  id uuid,
  mbid uuid,
  name text,
  disambiguation text,
  album_count bigint,
  tier smallint
)
language sql
stable
as $$
  with normalised as (
    select
      lower(btrim(query)) as q,
      websearch_to_tsquery('simple', btrim(query)) as tsq,
      regexp_replace(lower(btrim(query)), '^(the|a|an)\s+', '', 'i') as fuzzy_q
  )
  select
    ar.id, ar.mbid, ar.name, ar.disambiguation,
    count(aa.album_id) as album_count,
    min(
      case
        when lower(ar.name) = n.q then 1
        when lower(ar.name) like n.q || '%' then 2
        when ar.search_vector @@ n.tsq then 3
        else 4
      end
    )::smallint as tier
  from public.artists ar
  cross join normalised n
  left join public.album_artists aa on aa.artist_id = ar.id
  where
    n.q <> ''
    and (
      ar.search_vector @@ n.tsq
      or lower(ar.name) like n.q || '%'
      -- Same mechanism as the album credit predicate, and justified on its own
      -- evidence: `search_artists('the wall')` returned The Wake, The Weeknd,
      -- The Who and The xx, none of them relevant.
      or similarity(regexp_replace(ar.name, '^(the|a|an)\s+', '', 'i'), n.fuzzy_q) > 0.3
    )
  group by ar.id, ar.mbid, ar.name, ar.disambiguation, n.q, n.tsq
  order by
    tier asc,
    -- No popularity signal for artists yet, so catalogue depth stands in as a
    -- rough proxy for prominence.
    album_count desc,
    ar.name asc
  limit greatest(1, least(max_results, 50));
$$;

comment on function public.search_artists is
  'Tiered artist search. Album count stands in for popularity until an artist-level signal exists. Fuzzy name matching is article-normalised on both operands.';
