-- longplayr — at most one drainer, so the rate limiter means something
--
-- **`RateLimiter` is a module-level object**, so it serialises requests within
-- one Node process. On Vercel, concurrent requests run in separate lambda
-- instances **each with its own limiter**, so the one-per-second budget can be
-- exceeded by exactly the number of concurrent drainers. `product-feedback.md`
-- F-028.
--
-- **This is routine rather than theoretical.** `drainJobs` is called from four
-- places, two of them inside `after()` on the album and artist pages — so two
-- people browsing two artist pages, or one browsing while the cron fires on the
-- hour, is enough. There are twelve cron runs a day.
--
-- **The consequence is a total catalogue outage, not a slow ingest.**
-- MusicBrainz returns `503` for *every* request from the address once the limit
-- is passed, not merely the excess — a `CLAUDE.md` non-negotiable.
--
-- **The insight that makes this small: a distributed rate limiter is not
-- needed. At most one drainer is.** F-028 assumed shared-state rate limiting
-- and called it "a materially larger change"; constraining the *drainer* rather
-- than the *request* makes the existing in-process limiter authoritative again,
-- because there is only ever one process to be authoritative for.
--
-- **A lease row, not `pg_advisory_lock`.** Session-level advisory locks are
-- held until the session ends, and Supabase's pooler hands a different
-- connection to each request — so a lock taken through PostgREST may outlive
-- its holder and is not reliably releasable. **A lease with an expiry is
-- pooler-safe and self-healing**, which is the same reasoning `jobs.ts` already
-- applies to a `running` row abandoned after 90 minutes.

create table public.drain_leases (
  -- One row per drain concern. `id` is the concern, not the holder.
  id text primary key,

  -- **When the lease lapses, not who holds it.** A holder identity would invite
  -- a release-by-owner check, and a crashed holder can never release — the
  -- expiry is what recovers, so the expiry is what is stored.
  held_until timestamptz not null default now(),

  -- Observability only. Nothing branches on these.
  acquired_at timestamptz,
  acquired_count bigint not null default 0
);

comment on table public.drain_leases is
  'Mutual exclusion for the ingestion drain, so the in-process MusicBrainz limiter is authoritative. architecture.md §7.3.';

insert into public.drain_leases (id, held_until) values ('ingest', now())
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Acquire and release
-- ---------------------------------------------------------------------------
--
-- **One statement each, so the check and the claim cannot separate.** A read
-- followed by a write would let two callers both see a lapsed lease and both
-- take it, which is the bug this table exists to prevent — in the same shape
-- §98 found between a status change and its statement.

create or replace function public.try_acquire_drain_lease(
  p_id text,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_got boolean;
begin
  update public.drain_leases
     set held_until = now() + make_interval(secs => p_ttl_seconds),
         acquired_at = now(),
         acquired_count = acquired_count + 1
   where id = p_id
     and held_until <= now()
  returning true into v_got;

  return coalesce(v_got, false);
end;
$$;

comment on function public.try_acquire_drain_lease is
  'Takes the named lease if it has lapsed. False means somebody else holds it. architecture.md §7.3.';

-- **Releasing early is the point.** A drain that finishes in two seconds should
-- not hold a sixty-second lease, or a page view would block the cron behind it
-- for a minute. The TTL is the crash recovery, not the schedule.
create or replace function public.release_drain_lease(p_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.drain_leases set held_until = now() where id = p_id;
$$;

comment on function public.release_drain_lease is
  'Ends the named lease now. Safe to call when not held. architecture.md §7.3.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- **Only the service layer drains**, and it reaches this through the
-- service-role key. The revoke is the fix; the grant only states intent
-- (§16.5), and `scripts/check-privileges.mjs` now fails the build without it.

alter table public.drain_leases enable row level security;

revoke all on table public.drain_leases from anon, authenticated;
grant all on table public.drain_leases to service_role;

revoke all on function public.try_acquire_drain_lease(text, integer) from public, anon, authenticated;
revoke all on function public.release_drain_lease(text) from public, anon, authenticated;

grant execute on function public.try_acquire_drain_lease(text, integer) to service_role;
grant execute on function public.release_drain_lease(text) to service_role;
