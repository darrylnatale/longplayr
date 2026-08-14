-- longplayr — search ranking and popularity
--
-- Ranking is TIERED, not weighted. Text relevance decides the tier; popularity
-- only orders results *within* a tier.
--
-- This is deliberate. A weighted score (text * a + popularity * b) requires
-- tuning a and b, and any tuning done now would be fitted to a handful of
-- fixture albums and tell us nothing. Tiers need no weights at all: a strong
-- title match outranks a weak one no matter how popular the weak one is,
-- which is the stated requirement.
--
-- The "Blonde" case falls out naturally. Frank Ocean's Blonde and Blondie's
-- Blonde both land in the exact-title tier and tie on text, so popularity
-- breaks the tie — which is precisely the disambiguation role it should play.

-- Populated by whichever PopularitySource is active: ListenBrainz now,
-- longplayr's own activity later. Search reads the column and neither knows
-- nor cares where the number came from.
alter table public.albums add column popularity_score integer;

comment on column public.albums.popularity_score is
  'Relative popularity from the active PopularitySource. Ordering only — not a rating, and not comparable across sources.';

create index albums_popularity_idx on public.albums (popularity_score desc nulls last);

-- ---------------------------------------------------------------------------
-- Album search
-- ---------------------------------------------------------------------------

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
      websearch_to_tsquery('simple', btrim(query)) as tsq
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
      or similarity(a.display_credit, n.q) > 0.3
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
  'Tiered album search: text relevance selects the tier, popularity orders within it.';

-- ---------------------------------------------------------------------------
-- Artist search
-- ---------------------------------------------------------------------------

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
      websearch_to_tsquery('simple', btrim(query)) as tsq
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
      or similarity(ar.name, n.q) > 0.3
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
  'Tiered artist search. Album count stands in for popularity until an artist-level signal exists.';

grant execute on function public.search_albums(text, integer) to anon, authenticated, service_role;
grant execute on function public.search_artists(text, integer) to anon, authenticated, service_role;
