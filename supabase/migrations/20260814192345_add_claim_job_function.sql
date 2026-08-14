-- longplayr — atomic job claiming
--
-- Claiming has to be atomic. Two overlapping cron runs that both read the same
-- pending row would each fetch the same album from MusicBrainz, which wastes
-- the one-request-per-second budget the whole ingestion design is built around.
--
-- `for update skip locked` is the standard Postgres queue pattern: each caller
-- locks the rows it takes and passes over rows another caller already holds,
-- so concurrent drains divide the work instead of duplicating it.

create or replace function public.claim_ingestion_jobs(batch_size integer)
returns setof public.ingestion_jobs
language sql
volatile
security definer
set search_path = public
as $$
  update public.ingestion_jobs
  set status = 'running',
      attempts = attempts + 1,
      updated_at = now()
  where id in (
    select id
    from public.ingestion_jobs
    where status = 'pending'
      and run_after <= now()
    order by priority asc, id asc
    for update skip locked
    limit batch_size
  )
  returning *;
$$;

comment on function public.claim_ingestion_jobs is
  'Atomically claims up to batch_size ready jobs, marking them running and incrementing attempts.';

-- Only the ingestion service calls this.
revoke all on function public.claim_ingestion_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_ingestion_jobs(integer) to service_role;
