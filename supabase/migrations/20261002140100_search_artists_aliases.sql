-- longplayr — search_artists reads aliases
--
-- **A separate migration from the table, and the reason is Postgres.** A new
-- enum value cannot be *used* in the transaction that added it — the error is
-- `unsafe use of new value`, which `20260904170100_create_list_likes.sql`
-- already records hitting. The previous migration adds `fetch_artist_aliases`
-- to `job_kind`; keeping any use of it out of that transaction is simplest
-- achieved by keeping this file separate.
--
-- **`artists.search_vector` cannot carry aliases.** It is
-- `generated always as (to_tsvector('simple', coalesce(name, ''))) stored`, and
-- **a generated column may not reference another table.** So the aliases are
-- joined here rather than folded into the vector, which also keeps the alias
-- tiers distinguishable from name tiers in the result.
--
-- **Two new tiers, and they do not renumber the existing five.** §111's
-- phonetic fallback is tier 5 and `architecture.md` §10.4 names it as such;
-- renumbering for tidiness would churn that record and three tests for no
-- behavioural gain.
--
--   tier 2 — an **exact** alias match. About as good as a name prefix: the
--            reader typed a real name for this artist, just not the canonical
--            one. `Kanye West` → Ye belongs here.
--   tier 4 — a **fuzzy** alias match, alongside the name's own trigram tier.
--
-- **So the numbers are not in strict quality order, and that is stated rather
-- than left to be discovered**: 2 and 4 are chosen to slot aliases between the
-- existing tiers without moving them.

create or replace function public.search_artists(query text, max_results integer default 10)
returns table(
  id uuid,
  mbid uuid,
  slug text,
  name text,
  disambiguation text,
  album_count bigint,
  tier smallint
)
language plpgsql
stable
as $$
begin
  return query
  with normalised as (
    select
      lower(btrim(query)) as q,
      websearch_to_tsquery('simple', btrim(query)) as tsq,
      regexp_replace(lower(btrim(query)), '^(the|a|an)\s+', '', 'i') as fuzzy_q
  ),
  -- **Collapsed to one row per artist before the join**, so an artist with six
  -- aliases does not multiply its own `album_count` by six. That is the bug
  -- this CTE exists to prevent, and it is the kind that looks like a ranking
  -- problem rather than a counting one.
  alias_hits as (
    select
      al.artist_id,
      min(case when lower(al.name) = n.q then 2 else 4 end)::smallint as alias_tier
    from public.artist_aliases al
    cross join normalised n
    where
      n.q <> ''
      and (
        lower(al.name) = n.q
        or lower(al.name) like n.q || '%'
        or similarity(al.name, n.fuzzy_q) > 0.3
      )
    group by al.artist_id
  )
  select
    ar.id, ar.mbid, ar.slug, ar.name, ar.disambiguation,
    count(aa.album_id) as album_count,
    least(
      min(
        case
          when lower(ar.name) = n.q then 1
          when lower(ar.name) like n.q || '%' then 2
          when ar.search_vector @@ n.tsq then 3
          else 4
        end
      ),
      -- An artist matching on both its name and an alias takes the better of
      -- the two, which `least` over the aggregate gives directly.
      coalesce(min(ah.alias_tier), 5)
    )::smallint as tier
  from public.artists ar
  cross join normalised n
  left join public.album_artists aa on aa.artist_id = ar.id
  left join alias_hits ah on ah.artist_id = ar.id
  where
    n.q <> ''
    and (
      ar.search_vector @@ n.tsq
      or lower(ar.name) like n.q || '%'
      or similarity(regexp_replace(ar.name, '^(the|a|an)\s+', '', 'i'), n.fuzzy_q) > 0.3
      -- The alias predicate. Without this an alias-only match never enters the
      -- result set at all, and the tier arithmetic above would never see it.
      or ah.artist_id is not null
    )
  group by ar.id, ar.mbid, ar.slug, ar.name, ar.disambiguation, n.q, n.tsq
  order by
    tier asc,
    album_count desc,
    ar.name asc
  limit greatest(1, least(max_results, 50));

  -- **The phonetic fallback is unchanged** — still only when everything above
  -- returns nothing, still tier 5. §10.4.
  if not found then
    return query
    with normalised as (
      select
        btrim(query) as raw,
        regexp_replace(lower(btrim(query)), '^(the|a|an)\s+', '', 'i') as fuzzy_q
    )
    select
      ar.id, ar.mbid, ar.slug, ar.name, ar.disambiguation,
      count(aa.album_id) as album_count,
      5::smallint as tier
    from public.artists ar
    cross join normalised n
    left join public.album_artists aa on aa.artist_id = ar.id
    where
      n.raw <> ''
      and length(n.fuzzy_q) >= 3
      and dmetaphone(ar.name) = dmetaphone(n.fuzzy_q)
    group by ar.id, ar.mbid, ar.slug, ar.name, ar.disambiguation
    order by album_count desc, ar.name asc
    limit greatest(1, least(max_results, 50));
  end if;
end;
$$;

comment on function public.search_artists is
  'Tiered artist search over names and aliases, with a phonetic fallback at tier 5. architecture.md §10.4, §10.5.';

revoke all on function public.search_artists(text, integer) from public;
grant execute on function public.search_artists(text, integer) to anon, authenticated, service_role;
