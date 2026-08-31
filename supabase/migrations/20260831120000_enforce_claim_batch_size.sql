-- longplayr — claim_ingestion_jobs must honour its own batch size
--
-- **This fixes a demonstrated production defect, not a stylistic concern.**
--
-- The previous definition selected rows with
--
--   where id in (select id … order by … for update skip locked limit batch_size)
--
-- which is the unsafe spelling of this pattern. `IN (subquery)` may be planned
-- as a semi-join and the subquery re-evaluated, and a `language sql` body can be
-- inlined into the caller's plan; `limit` then bounds each evaluation rather
-- than the total. More rows are locked, marked `running` and returned than were
-- asked for.
--
-- **Observed, not theorised.** CI run #66 logged `claim_ingestion_jobs` called
-- with `batch_size := 1` returning **three** rows, ten times in one run. Because
-- `drainJobs` consumed only the first, two jobs were left `running` with their
-- attempt already spent — invisible to the retry path, invisible to every
-- failure metric, and not recoverable until the 90-minute stale reclaim. That is
-- the "work that stops silently" failure class `architecture.md` §17 names, and
-- in production it would apply to the cron drain and both `after()` drains.
--
-- **The fix is to abandon the `id in (subquery)` shape.** What is established
-- is this: replacing it with a row-selecting CTE joined to the update by
-- primary key yields a single, bounded claim set — the CTE produces at most
-- `batch_size` ids, and the join is 1:1 on the key, so no row can be updated
-- that the CTE did not select.
--
-- **`materialized` is belt and braces, not the proven load-bearing part.**
-- PostgreSQL already declines to inline a CTE containing `for update`, so the
-- keyword is very likely redundant here; it is written so the requirement is
-- stated rather than inferred from a behaviour the planner is not obliged to
-- keep. Which of the two changes was strictly necessary has not been isolated,
-- and this comment does not claim otherwise.
--
-- **Everything else is unchanged and deliberately so**: the `pending` predicate,
-- `run_after <= now()`, priority ordering with the deterministic `id` tie-break,
-- `for update skip locked`, the attempt increment, `updated_at`, and the
-- `setof ingestion_jobs` return shape. Concurrency is unaffected — the CTE still
-- takes the locks, and a competing claimer still skips them.
--
-- `security definer` and `set search_path` are restated because `create or
-- replace` replaces the whole definition. The grants are restated too: execute
-- privileges do survive a replace, but a `security definer` function is the
-- wrong place to rely on that implicitly.

create or replace function public.claim_ingestion_jobs(batch_size integer)
returns setof public.ingestion_jobs
language sql
volatile
security definer
set search_path = public
as $$
  with claimed as materialized (
    select id
    from public.ingestion_jobs
    where status = 'pending'
      and run_after <= now()
    order by priority asc, id asc
    for update skip locked
    limit batch_size
  )
  update public.ingestion_jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      updated_at = now()
  from claimed c
  where j.id = c.id
  returning j.*;
$$;

comment on function public.claim_ingestion_jobs is
  'Atomically claims at most batch_size ready jobs, marking them running and incrementing attempts. The materialized CTE is what bounds the count: an IN-subquery form could be re-evaluated and claim more rows than requested.';

-- Only the ingestion service calls this.
revoke all on function public.claim_ingestion_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_ingestion_jobs(integer) to service_role;
