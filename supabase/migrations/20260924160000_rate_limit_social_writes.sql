-- longplayr — ceilings on the writes that notify other people
--
-- **Moderation reacts; nothing prevented.** §91 to §94 built enforcement, an
-- admin, and a locked-down privilege surface — every one of which acts *after*
-- somebody has flooded the product. A signed-in account could follow and like
-- without any ceiling, and **each of those generates a notification for
-- somebody else**, which is the harm a ceiling actually bounds.
-- `architecture.md` §14.4.
--
-- **Enforced here rather than in the service layer, and that is the decision.**
-- The existing limiter — `remainingAllowance`, counting `catalogue_additions`
-- — lives in the service layer, and copying it was the obvious move.
-- `follows`, `review_likes` and `list_likes` all grant `insert` to
-- `authenticated` and let an owner insert freely, so a service-layer ceiling is
-- bypassed by anybody posting straight to PostgREST with their own token.
-- **That is the identical shape as §14.1's hole**, where a rule the application
-- assumed was one the database did not hold. A limit only the app respects is a
-- product preference dressed as a control.
--
-- **Catalogue additions are deliberately not migrated to match.** That limiter
-- also drives a remaining-allowance display, and it guards a rate-limited
-- upstream rather than other users' notifications. Rewriting a working control
-- to satisfy a new convention is not what this cycle is for; the inconsistency
-- is named rather than tidied.

-- ---------------------------------------------------------------------------
-- Indexes the counts run on
-- ---------------------------------------------------------------------------
--
-- `follows` already has `(follower_id, created_at desc)`. Both like tables have
-- a `(user_id, target_id)` unique index, so a count filtered on `user_id` can
-- use it — but it must then fetch each row to test the timestamp. These make it
-- a range scan instead, and make the three tables consistent with each other.

create index review_likes_user_recent_idx
  on public.review_likes (user_id, created_at desc);

create index list_likes_user_recent_idx
  on public.list_likes (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- enforce_rate_limit
-- ---------------------------------------------------------------------------
--
-- One function for all three, parameterised by trigger argument: the column
-- naming the actor, then the hourly and daily ceilings. Three copies of the
-- same counting logic is three places for it to drift.
--
-- **`P0001` deliberately, which is what a bare `raise exception` produces.**
-- PostgREST renders it as a `400` with the message intact, so the service layer
-- can recognise it. `53400` (configuration_limit_exceeded) reads better as SQL
-- and surfaces as a `500`, which would make a limit look like an outage.
--
-- **The marker in the message is what the service matches on**, rather than
-- prose that might be reworded — the same device `profiles_handle_not_reserved`
-- uses in `20260918120000`.
--
-- **SECURITY DEFINER so the count sees every row.** A limit that only counted
-- rows the caller can read would be no limit at all the moment a policy
-- narrowed.

create or replace function public.enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_column text := tg_argv[0];
  per_hour integer := tg_argv[1]::integer;
  per_day integer := tg_argv[2]::integer;
  actor uuid;
  used integer;
begin
  execute format('select ($1).%I', actor_column) into actor using new;

  -- Rolling windows rather than calendar ones: a fixed hour boundary lets an
  -- entire allowance be spent twice over across it, which is the behaviour a
  -- ceiling exists to stop.
  execute format(
    'select count(*) from public.%I where %I = $1 and created_at >= now() - interval ''1 hour''',
    tg_table_name, actor_column
  ) into used using actor;

  if used >= per_hour then
    raise exception
      'longplayr_rate_limited: % per hour on %', per_hour, tg_table_name;
  end if;

  execute format(
    'select count(*) from public.%I where %I = $1 and created_at >= now() - interval ''1 day''',
    tg_table_name, actor_column
  ) into used using actor;

  if used >= per_day then
    raise exception
      'longplayr_rate_limited: % per day on %', per_day, tg_table_name;
  end if;

  return new;
end;
$$;

comment on function public.enforce_rate_limit is
  'Rolling per-actor ceilings for insert-only social tables. Raises P0001 carrying longplayr_rate_limited.';

-- ---------------------------------------------------------------------------
-- The ceilings
-- ---------------------------------------------------------------------------
--
-- **Chosen, not measured** — the same standing as the twelve-character password
-- minimum in `architecture.md` §6, and stated in the same words. There is no
-- usage data to tune against. Generous enough that no genuine user should meet
-- them, tight enough to bound a script. **Raising them when real usage says so
-- is expected and is not a finding.**
--
-- Likes sit higher than follows because liking is the cheaper, more frequent
-- gesture, and because following the same person twice is impossible while
-- liking is spread across everything a person reads.

create trigger follows_rate_limit
  before insert on public.follows
  for each row
  execute function public.enforce_rate_limit('follower_id', '60', '300');

create trigger review_likes_rate_limit
  before insert on public.review_likes
  for each row
  execute function public.enforce_rate_limit('user_id', '120', '600');

create trigger list_likes_rate_limit
  before insert on public.list_likes
  for each row
  execute function public.enforce_rate_limit('user_id', '120', '600');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- Nothing calls this directly; it is only ever reached through its triggers.

revoke all on function public.enforce_rate_limit() from public;
