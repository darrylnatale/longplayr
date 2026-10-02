-- longplayr — a drain that stops should say why
--
-- **`inspectQueue` reports `lastActivityAt`, which is when a job was last
-- settled.** That answers *did work happen*, not *did a drain run* — a drain
-- that claimed nothing, or that stopped on its budget, leaves it unchanged.
-- `product-feedback.md` F-033: a background drain that does not run leaves no
-- trace.
--
-- **§107 made this worse before making it better.** The lease gave the drain a
-- fourth and entirely legitimate reason to stop — somebody else is draining —
-- and the two `after()` callers on the album and artist pages **discard the
-- summary**, so a skipped drain was invisible by construction.
--
-- **Recorded on the lease row rather than in a new table.** It is already the
-- per-concern singleton and already carries `acquired_at` and
-- `acquired_count` for exactly this purpose. A log table would need retention,
-- a read path and a privilege decision to answer a question with one row.
--
-- **The holder records the outcome; a would-be drainer records the skip.** They
-- are different facts and must not share a column: a skip that overwrote the
-- last real outcome would destroy the information being added.

alter table public.drain_leases
  add column last_outcome text,
  add column last_outcome_at timestamptz,
  add column last_claimed integer,
  -- Monotonic. **Not reset on a successful drain**: the useful reading is
  -- "skips since this row existed" against `acquired_count`, and a ratio
  -- survives a restart where a since-last-drain counter does not.
  add column skipped_count bigint not null default 0;

comment on column public.drain_leases.last_outcome is
  'Why the last drain that held this lease stopped. architecture.md §7.3c.';
comment on column public.drain_leases.skipped_count is
  'Drains that could not take the lease. Monotonic; read against acquired_count.';

-- ---------------------------------------------------------------------------
-- Acquire: count the refusals
-- ---------------------------------------------------------------------------

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

  if coalesce(v_got, false) then
    return true;
  end if;

  -- **Counted here rather than in the caller**, so every refusal is recorded
  -- whatever the caller then does — including the two `after()` drains that
  -- throw their summary away. A `where id` guard keeps an unknown lease from
  -- silently creating one.
  update public.drain_leases
     set skipped_count = skipped_count + 1
   where id = p_id;

  return false;
end;
$$;

comment on function public.try_acquire_drain_lease is
  'Takes the named lease if lapsed, counting the refusal if not. architecture.md §7.3, §7.3c.';

-- ---------------------------------------------------------------------------
-- Release: record what happened
-- ---------------------------------------------------------------------------
--
-- **Both arguments are optional with defaults**, so the one-argument form in
-- §107's tests and any future caller keeps working rather than failing to
-- resolve. Postgres treats this as a distinct signature from the old one, so
-- the old function is dropped explicitly — leaving both would make
-- `release_drain_lease('ingest')` ambiguous.

drop function if exists public.release_drain_lease(text);

create or replace function public.release_drain_lease(
  p_id text,
  p_outcome text default null,
  p_claimed integer default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.drain_leases
     set held_until = now(),
         last_outcome = coalesce(p_outcome, last_outcome),
         last_outcome_at = case when p_outcome is null then last_outcome_at else now() end,
         last_claimed = coalesce(p_claimed, last_claimed)
   where id = p_id;
$$;

comment on function public.release_drain_lease is
  'Ends the named lease now, recording why the drain stopped. architecture.md §7.3c.';

revoke all on function public.release_drain_lease(text, text, integer) from public, anon, authenticated;
grant execute on function public.release_drain_lease(text, text, integer) to service_role;
