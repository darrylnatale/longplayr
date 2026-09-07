-- longplayr — move already-queued bulk artwork into the bulk band
--
-- **A data operation, not a schema change.** Nothing here alters a table, a
-- type, a function or a privilege. It exists because a priority constant only
-- governs rows enqueued after it ships, and the rows that caused the defect
-- were enqueued before.
--
-- **The defect.** `discover_curated_artist` and `fetch_artwork` shared
-- `DEFAULT_JOB_PRIORITY`, and the claim orders `priority asc, id asc`. One
-- successful discography expansion creates roughly eight artwork rows, every
-- one with a lower `id` than the next artist page's discovery job, so every one
-- is claimed first. A page view drains a single job. The queue therefore grew
-- faster than it drained: success generated the backlog that starved the next
-- success. Measured on the deployed database after three artist pages were
-- opened — 20 pending, 18 `fetch_artwork`, and 2 `discover_curated_artist`
-- still at `attempts = 0`. See `architecture.md` §7, *Queue fairness*.
--
-- **`priority = 100` is part of the predicate, not an optimisation.** Artwork a
-- reader is waiting on is enqueued at `INTERACTIVE_JOB_PRIORITY` (10) — the
-- self-service add path, and now album-page hydration. Matching on kind alone
-- would demote exactly the case the interactive band exists to protect, and
-- `tests/integration/self-service.test.ts` asserts that case. The literal 100
-- is `DEFAULT_JOB_PRIORITY` and 200 is `BULK_ARTWORK_PRIORITY`, both in
-- `src/services/catalogue/queue.ts`; they are spelled out here because a
-- migration is a point-in-time record and must not drift with a constant.
--
-- **`pending` only.** A `running` row has already been claimed, so its priority
-- no longer decides anything. Confining the update to `pending` also keeps it
-- clear of `reclaimStaleJobs`, which finds abandoned work by `updated_at` on
-- rows that are `running` — the `ingestion_jobs_set_updated_at` trigger fires
-- here, and on a `pending` row that reaches nothing.
--
-- **Nothing is deleted and no work is lost.** Each row keeps its target, its
-- attempts and its error history; only the order it is claimed in changes.
--
-- **Idempotent, and inert on a fresh database.** Re-running matches nothing,
-- because the first run leaves no row at the old value. A newly created
-- database — CI, or a local `db:reset` — has no rows at all, which is also why
-- no test can observe this statement doing anything.

update public.ingestion_jobs
set priority = 200
where kind = 'fetch_artwork'
  and status = 'pending'
  and priority = 100;
