-- longplayr — discovery charts
--
-- Phase 5, slice 1. `product-spec.md` §8.3 holds the definition, `architecture.md`
-- §8 the boundaries, `data-model.md` §7 the entity.
--
-- **This is a materialised chart, not a second popularity signal.** It is the
-- stored answer to one query. `albums.popularity_score` stays the external-source
-- prominence signal with its four existing consumers — Browse's fallback,
-- `search_albums`' tie-break, and three job-priority queries in `jobs.ts` — and
-- nothing here writes it. §8.9's question of whether the two popularity concepts
-- become one field or two is untouched and stays open.
--
-- **The inputs are collection data, never `activity`.** §8.3 requires backfilled
-- collection data to count — "interest is still interest" — while `activity`
-- exists precisely to exclude backfills, which is a `CLAUDE.md` non-negotiable.
-- Sourcing the chart from `activity` would silently contradict a decided product
-- rule. Charts and the feed ask different questions about the same act.

create table public.discovery_chart_entries (
  -- **A discriminator rather than a table per chart.** §8.3 and `architecture.md`
  -- §9 both describe discovery charts sharing one cached table, so this follows
  -- the record rather than anticipating it. Only `popular_this_week` is legal
  -- today; "highest rated this week" is Phase 5 slice 2 and is not built.
  --
  -- **Text with a CHECK, deliberately not an enum.** `ALTER TYPE … ADD VALUE` is
  -- one-way and cannot be used in the transaction that adds it; extending a CHECK
  -- is a single reversible migration.
  chart text not null
    constraint discovery_chart_entries_known_chart
    check (chart in ('popular_this_week')),

  album_id uuid not null references public.albums (id) on delete cascade,

  -- Stored rather than re-derived at read time. Browse must reproduce the
  -- ordering without recomputing the tie-break, which would be a second query
  -- that changes the semantics.
  rank integer not null
    constraint discovery_chart_entries_rank_positive check (rank > 0),

  -- The chart's own numbers, kept so the ordering is assertable rather than
  -- merely observable.
  distinct_users integer not null
    constraint discovery_chart_entries_distinct_users_positive check (distinct_users > 0),
  collection_count integer not null
    constraint discovery_chart_entries_collection_count_non_negative check (collection_count >= 0),

  -- Not read by anything in this slice. It exists so staleness is observable:
  -- the deployed cadence is daily, so a snapshot can be up to a day old.
  computed_at timestamptz not null default now(),

  -- One row per album per chart. Natural rather than surrogate: nothing
  -- references this table, so there is nothing for a surrogate key to serve, and
  -- the composite makes a duplicated album impossible by construction.
  constraint discovery_chart_entries_pkey primary key (chart, album_id)
);

comment on table public.discovery_chart_entries is
  'Materialised discovery charts. Replaced wholesale by a refresh; never appended to.';
comment on column public.discovery_chart_entries.rank is
  '1-based position within the chart. Stored so readers never re-derive the tie-break.';
comment on column public.discovery_chart_entries.collection_count is
  'All-time collection count for the album. The first tie-break, per product-spec.md §8.3.';

-- **No cap of 20 anywhere in this schema, and that is load-bearing.** §8.3's 20 is
-- a *floor* the external fill completes the chart to, never a ceiling: internal
-- results must not be truncated merely because they exceed it. The floor is
-- applied at read time in `src/services/discovery/chart.ts`, so "the chart is
-- never truncated to 20" is structural rather than a convention to remember.

-- The primary key leads on `chart`, so it does not serve a lookup by `album_id`,
-- and **the cascade needs that direction**: without this index every album
-- deletion sequentially scans this table. `list_likes` indexes its cascade for
-- the same reason.
create index discovery_chart_entries_album_idx
  on public.discovery_chart_entries (album_id);

-- Table privileges, evaluated before RLS. Every new table needs this block.
--
-- **Read-only to both public roles.** Only the scheduled refresh writes, and it
-- runs as `service_role`, so no insert, update or delete is granted to `anon` or
-- `authenticated` at all.
grant select on public.discovery_chart_entries to anon, authenticated;
grant all on public.discovery_chart_entries to service_role;

-- **Granting is not restricting.** The privileges below are removed because
-- nothing here should offer them, not because anything can currently reach them.
-- See `CLAUDE.md` and `architecture.md` §16.5.
revoke truncate, trigger, references, maintain
  on public.discovery_chart_entries
  from anon, authenticated;

alter table public.discovery_chart_entries enable row level security;

-- Derived entirely from public data, and everything user-generated is public.
create policy discovery_chart_entries_public_read on public.discovery_chart_entries
  for select using (true);

-- ---------------------------------------------------------------------------
-- The refresh
-- ---------------------------------------------------------------------------

-- Recomputes "Popular this week" and replaces the previous snapshot.
--
-- **One function body, therefore one transaction.** The delete and the insert
-- cannot be separated, which is what makes a failed refresh leave the previous
-- snapshot intact rather than an empty table. Browse keeps serving the last good
-- chart through any failure.
--
-- **`security invoker`, and that is deliberate.** The caller is `service_role`,
-- which bypasses RLS and must, since the chart aggregates every user's
-- collection. Any other caller is refused twice — no `execute` below, and no
-- insert privilege on the table above.
--
-- **Zero qualifying albums is a valid empty snapshot**, not a failure. Browse
-- then fills entirely from the external signal, which is exactly the pre-slice
-- behaviour.
create function public.refresh_popular_this_week()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- **Evaluated once per invocation.** Re-evaluating `now()` inside the query
  -- would let the window drift between the two halves of the union.
  cutoff constant timestamptz := now() - interval '7 days';
  written integer;
begin
  delete from public.discovery_chart_entries where chart = 'popular_this_week';

  with qualifying as (
    -- Additions, measured by `added_at` — what actually happened. **Never
    -- `listened_on`**, which is user-supplied and freely backdated, so a
    -- backdated listen has no effect on chart eligibility either way.
    --
    -- **Backfilled entries count**, and that is the point: this reads collection
    -- state, not the feed.
    select ce.album_id, ce.user_id
      from public.collection_entries ce
     where ce.added_at >= cutoff

    -- `union`, not `union all`: a user who both added and relistened in the
    -- window is one qualifying user, not two.
    union

    -- Relistens. `relisten_events` carries no `user_id`, so ownership comes
    -- through `collection_entry_id` — unambiguous because
    -- `collection_entries` is unique on (user_id, album_id).
    select ce.album_id, ce.user_id
      from public.relisten_events re
      join public.collection_entries ce on ce.id = re.collection_entry_id
     where re.occurred_at >= cutoff
  ),
  counts as (
    -- **Distinct users is the entire anti-domination rule.** Twenty relistens by
    -- one person move a chart by one; a three-hundred-album backfill adds at
    -- most +1 to each. The `union` above already collapses duplicate pairs, so
    -- `distinct` is redundant — kept because the invariant should be legible in
    -- the query rather than implied by an operator choice.
    select q.album_id, count(distinct q.user_id)::integer as distinct_users
      from qualifying q
     group by q.album_id
  ),
  all_time as (
    -- The first tie-break: all-time collection count, no window. Restricted to
    -- the qualifying set rather than aggregating the whole table.
    select ce.album_id, count(*)::integer as collection_count
      from public.collection_entries ce
     where ce.album_id in (select c.album_id from counts c)
     group by ce.album_id
  )
  insert into public.discovery_chart_entries
    (chart, album_id, rank, distinct_users, collection_count)
  select
    'popular_this_week',
    c.album_id,
    (row_number() over (
       order by c.distinct_users desc,
                coalesce(a.collection_count, 0) desc,
                c.album_id
     ))::integer,
    c.distinct_users,
    coalesce(a.collection_count, 0)
  from counts c
  left join all_time a on a.album_id = c.album_id;

  get diagnostics written = row_count;
  return written;
end;
$$;

comment on function public.refresh_popular_this_week() is
  'Recomputes product-spec.md §8.3 "Popular this week" and replaces the snapshot transactionally.';

-- **The revoke is not optional and is not implied by the grant.** Postgres grants
-- `EXECUTE` on a new function to `PUBLIC`, so naming the intended audience adds a
-- grant and removes nothing. Measured on 2026-09-04, seven of eight
-- project-authored functions were `anon`-executable against migrations that
-- appeared to withhold it. See `architecture.md` §16.5.
revoke execute on function public.refresh_popular_this_week() from public;
grant execute on function public.refresh_popular_this_week() to service_role;
