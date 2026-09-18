-- longplayr — search's credited artists carry their slug
--
-- `search_albums` already returns the album's own slug. The artists it
-- aggregates do not, and those are links too: `ArtistCredit` renders every
-- credited artist on a search result as a route to their page
-- (`product-spec.md` §6, "Reaching an artist from a credit").
--
-- **`create or replace` is sufficient here, unlike `20260918170000`.** Nothing
-- in the return table changes — `artists` is already `jsonb` and only its
-- contents gain a key — so the signature is untouched and the privileges stay
-- where they are.
--
-- **The aggregate must keep matching the PostgREST embed exactly.** Both feed
-- `toCreditedArtists`, which is why search needed no mapper of its own
-- (`architecture.md` §16.8). A key added to one belongs in the other.

create or replace function public.search_albums(query text, max_results integer default 20)
returns table (
  id uuid,
  mbid uuid,
  slug text,
  title text,
  display_credit text,
  primary_type public.album_type,
  artwork_status public.artwork_status,
  first_release_date date,
  first_release_date_precision public.date_precision,
  popularity_score integer,
  tier smallint,
  text_rank real,
  artists jsonb
)
language sql
stable
as $function$
  with normalised as (
    select
      lower(btrim(query)) as q,
      websearch_to_tsquery('simple', btrim(query)) as tsq,
      regexp_replace(lower(btrim(query)), '^(the|a|an)\s+', '', 'i') as fuzzy_q
  )
  select
    a.id, a.mbid, a.slug, a.title, a.display_credit, a.primary_type, a.artwork_status,
    a.first_release_date, a.first_release_date_precision, a.popularity_score,
    case
      when lower(a.title) = n.q then 1
      when lower(a.display_credit) = n.q then 2
      when lower(a.title) like n.q || '%' then 2
      when a.search_vector @@ n.tsq then 3
      else 4
    end::smallint as tier,
    round(ts_rank(a.search_vector, n.tsq)::numeric, 2)::real as text_rank,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'position', aa.position,
            'artists', jsonb_build_object(
              'id', ar.id, 'mbid', ar.mbid, 'slug', ar.slug, 'name', ar.name
            )
          )
          order by aa.position
        ),
        '[]'::jsonb
      )
      from public.album_artists aa
      join public.artists ar on ar.id = aa.artist_id
      where aa.album_id = a.id
    ) as artists
  from public.albums a, normalised n
  where
    n.q <> ''
    and (
      a.search_vector @@ n.tsq
      or lower(a.title) like n.q || '%'
      or similarity(a.title, n.q) > 0.3
      or similarity(regexp_replace(a.display_credit, '^(the|a|an)\s+', '', 'i'), n.fuzzy_q) > 0.3
    )
  order by
    tier asc,
    text_rank desc,
    coalesce(a.popularity_score, 0) desc,
    a.title asc
  limit greatest(1, least(max_results, 50));
$function$;

comment on function public.search_albums is
  'Tiered album search. Returns the album slug and each credited artist''s slug, so results link without a second lookup.';
