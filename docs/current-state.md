# Current State

**Purpose:** let a future session pick up immediately. Where we are _right now_ — not what the product is or how it is designed.

**This document is not the source of truth.** It is a checkpoint, not an authority, and it goes stale fastest of anything in `docs/`. It records progress and observations, never decisions. When it disagrees with anything below, the other document wins:

| Authority                                    | Document                                     |
| -------------------------------------------- | -------------------------------------------- |
| 1. Non-negotiable rules and locked decisions | `CLAUDE.md`                                  |
| 2. What the product is                       | `docs/product-spec.md`                       |
| 3. How it is designed                        | `docs/architecture.md`, `docs/data-model.md` |
| 4. What gets built and when                  | `docs/development-plan.md`                   |
| 5. Where we are right now                    | this file                                    |

Numbers below were **verified directly against the staging database on 2026-08-16**, not copied from the seed report — the report is a snapshot taken mid-run and several of its figures no longer describe the current state.

**Staging has not been modified.** Every staging query behind the figures in this document was a read-only `select`. The artwork recovery described in §4 is built, fully tested locally, and **not yet run against staging**.

**Phase 2 has NOT started.** Nothing from the core loop — collection entries, ratings, likes, reviews, relistens — exists.

---

## 1. Current state

**Phase 1 (catalogue), seeded and deployed to staging.**

|                   |                                                       |
| ----------------- | ----------------------------------------------------- |
| Unit tests        | 110                                                   |
| Integration tests | 81 (need a local database)                            |
| End-to-end tests  | 4 (Playwright)                                        |
| Repository        | <https://github.com/darrylnatale/longplayr> (private) |
| **Staging app**   | <https://longplayr.vercel.app>                        |
| **Staging DB**    | `oexuqjpvyeijmlirxtal.supabase.co`                    |
| Production        | does not exist                                        |
| Staging catalogue | 335 albums, 239 artists, 6,339 releases, 4,019 tracks |

Local development: `npm run db:start && npm run db:env && npm run dev`.

**Staging is deployed and verified.** Seven migrations applied, artwork bucket present, all five environment variables set in Vercel for Production and Preview, cron endpoint returns 401 without a token, unknown handles 404, sign-up flow works.

Migrations are in sync: all seven local files are applied remotely, confirmed with `npx supabase migration list --linked`. The Supabase CLI is authenticated and the project is linked, so staging can be queried read-only with `npx supabase db query --linked "<sql>"` — that is how the numbers in this document were checked, and it is the fastest way to re-check them.

No branch protection — GitHub gates it behind a paid plan for private repositories, and that was declined. `rm -rf .next && npm run verify` before pushing is the compensating control.

---

## 2. Completed work

**Phase 0 — foundation.** Next.js 16, TypeScript, Tailwind 4, Supabase Auth (email/password; Google decided but unbuilt), handle selection, public profiles, service layer with an ESLint boundary rule, Vitest and Playwright, GitHub Actions.

**Phase 1 — catalogue.** Schema, rate-limited MusicBrainz client with contact guard, scope filter, partial dates, representative-release selection, two-request tracklist ingestion, artwork pipeline, job queue with atomic claiming, tiered search, self-service add, browse surface, ListenBrainz popularity behind `PopularitySource`, seed selection with artist cap.

---

## 3. The staging seed

Ran the approved strategy: **ListenBrainz all-time, 500 candidates, maximum 2 albums per artist, MBID-only.** 358 selected. Took ~55 minutes across two sessions (the first was interrupted around 180; the seed skips albums already present, so it resumed).

### Result

| Catalogue outcome              |                             |
| ------------------------------ | --------------------------- |
| Selected                       | 358                         |
| Newly ingested                 | **170**                     |
| Already present (from run one) | **165**                     |
| Rejected — out of scope        | **2**                       |
| MusicBrainz failures           | **21**                      |
| **Catalogue**                  | **335 albums, 239 artists** |

Both rejections were singles, which is the scope filter working correctly. The 21 MusicBrainz failures are why 335 rather than 356 — those albums were never ingested and would likely succeed on a re-run. Verified against staging: all 21 are absent from `albums`, and `358 − 21 − 2 = 335` reconciles exactly.

> **Reading `seed-report.txt`:** its headline `Failed 89` mixes both axes — 21 MusicBrainz failures (no album row written) plus 68 Cover Art Archive failures (album written, no cover). Those are different kinds of failure with different remedies. The report also predates the four-state artwork model, so its `Artwork absent 0 / Coverage 100%` lines should not be read as current.

### Artwork outcome (independent)

The catalogue and artwork axes are reported separately, because an album can be catalogued perfectly and still lack artwork. Mixing them made an earlier report sum to 426 against 358 selected.

**Two different numbers are in play, and they are not the same measurement:**

| Measurement                                               | Value  |
| --------------------------------------------------------- | ------ |
| Cover Art Archive 5xx **request failures** during the run | **68** |
| Albums **currently lacking artwork** on staging           | **36** |

Both are correct. 68 distinct albums hit a Cover Art Archive 5xx at some point during the seed; **32 of those later succeeded** on a subsequent attempt within the run. The remaining 36 never got a cover. Confirmed by querying the 68 failed MBIDs against staging: 32 are now `found`, 36 are still `pending`.

Current staging artwork state, queried directly:

| `artwork_status` | Albums |
| ---------------- | ------ |
| `found`          | 299    |
| `pending`        | 36     |
| `absent`         | 0      |
| `failed`         | 0      |
| **Total**        | 335    |

**The 36 gaps sit in `pending`, not `failed`.** The seed ran before the four-state model existed, so no album was ever written as `failed`. Two consequences that matter:

- **`artworkCoverage()` still reports 100%.** It computes `found / (found + absent + failed)` = `299 / 299`, with the 36 counted separately as pending. The metric is behaving exactly as designed — the fix was real — but on _this_ data it does not yet surface the gap, because these rows predate the state that would have surfaced it. Do not read "100%" as "no missing covers" until these 36 have been re-attempted under the four-state model.
- **Nothing is queued to fix them.** `ingestion_jobs` is **empty**. The 36 will not resolve on their own via the daily cron drain; they need an explicit re-attempt.

---

## 4. Technical state

**Local Supabase is deliberately trimmed.** Realtime, Edge Runtime, analytics, `storage.vector` and `storage.s3_protocol` are disabled in `supabase/config.toml`, each with a comment explaining why. The full stack exceeds the ~3.8 GiB available to Docker and fails its health checks. Trimmed, it starts in about 40 seconds. Do not re-enable without a concrete need.

**MusicBrainz live calls are blocked locally.** The client throws before `fetch` when `MUSICBRAINZ_CONTACT` looks like a placeholder. Local `.env.local` ships a placeholder on purpose; staging uses the repository URL. Do not work around this guard.

**Artwork has four states** (`albums.artwork_status`):

- `pending` — not attempted
- `found` — retrieved and stored
- `absent` — Cover Art Archive answered and holds no front cover (a real gap)
- `failed` — the request errored (retryable)

`absent` is a fact about the artwork; `failed` is a fact about the network. A failed request must never be counted as absent.

**Corrected coverage calculation.** `artworkCoverage()` reports `found / (found + absent + failed)` as observed coverage, with `pending` counted separately. Failures are never hidden from the denominator. The earlier metric excluded failures entirely, which is how a catalogue missing 36 of 335 covers was reported as "100% coverage".

**The fix is not yet visible in the staging numbers**, and this is the single easiest thing here to misread. No staging album is in `failed` or `absent` — the seed predates those states, so all 36 gaps are `pending`. Coverage therefore computes as `299 / 299` and still prints 100%. The denominator is honest; there is simply nothing in it yet to be honest about. Re-attempting the 36 under the current model is what will make the number mean something. See §3.

**Ingestion costs two MusicBrainz requests per album** — release group, then representative release for the tracklist. Release-group responses carry no `media` and no `track-count`.

**Job queue exists and is drained** by `/api/cron/drain-jobs`, scheduled daily in `vercel.json`. Vercel's Hobby plan caps cron at once per day, so queued artwork can lag up to 24 hours. Nothing breaks; pages render placeholders.

**The queue is currently empty** (`ingestion_jobs` = 0 rows), as is `catalogue_additions`. Nothing is pending, which also means the 36 missing covers are not scheduled to be retried by anything. Waiting will not fix them.

**The artwork retry path was missing, and now exists.** The cause was subtler than an unbuilt feature. `fetchAndStoreArtwork` records its outcome and returns rather than throwing — deliberate, so that a Cover Art Archive problem cannot fail a metadata ingest that already succeeded. But the job runner discarded the returned status, so a failed fetch marked the job **`succeeded`** and no retry was ever scheduled. The album was left at `failed` with nothing queued and nothing to notice.

`runJob` now re-raises a `failed` artwork result, handing it to the queue's existing retry, backoff and exhaustion machinery. `absent` is not a failure and completes the job. The lifecycle is:

| Cover Art Archive says | Album becomes | Job becomes                                   |
| ---------------------- | ------------- | --------------------------------------------- |
| an image               | `found`       | `succeeded`                                   |
| 404                    | `absent`      | `succeeded` — answered, no retry              |
| 5xx or network error   | `failed`      | back to `pending`, retried behind backoff     |
| 5xx three times        | `failed`      | `failed` — stops, awaiting a deliberate sweep |

**Recovery is `enqueueMissingArtwork()`**, exposed as `npm run db:backfill:artwork`. It queues a `fetch_artwork` job for every album in `pending` or `failed`, bounded and idempotent twice over: the partial unique index skips albums with an outstanding job, and a re-run after a successful drain finds nothing because those albums are no longer in a retryable state. Queue-only by default; `BACKFILL_DRAIN=true` also drains, which is what makes recovery a single operation rather than four days of daily cron.

---

## 5. The MusicBrainz 503s — resolved, not rate limiting

**Answered on 2026-08-16 by capturing a live 503.** The body and headers settle it:

```
{"error": "The MusicBrainz web server is currently busy. Please try again later."}

x-ratelimit-zone:      global          ← not our per-IP budget
x-ratelimit-limit:     15
x-ratelimit-remaining: 12              ← rejected with 12 of 15 left
retry-after:           0               ← retry immediately, no penalty
x-mb-rate-limiter:     lua
server:                openresty       ← the edge proxy; 200s come from Plack::Handler::Starlet
```

Four things follow, and together they close the question:

1. **The message is the wrong one for rate limiting.** MusicBrainz's rate-limit 503 reads _"Your requests are exceeding the allowable rate limit."_ This one says the server is busy. They are different responses for different causes.
2. **The zone is `global`.** This is a shared bucket across MusicBrainz traffic, not a budget longplayr can exhaust on its own.
3. **We were rejected with budget remaining** — 12 of 15. Nothing of ours ran out.
4. **`retry-after: 0`** — MusicBrainz is not asking us to slow down. It is asking us to come back.

Corroborating: on the 200 responses the per-IP zone reports `x-ratelimit-limit: 1200` with `remaining` swinging 290 → 1023 → 884 between our own requests at 1.5s spacing. A budget that refills and drains by hundreds while we make one request is not being moved by us.

**The 503s were MusicBrainz shedding load at its edge proxy. The rate limiter was never the problem, and the request never reached the application.** During the probe, 1 request in 6 was shed — a higher rate than the seed's 21 in 191.

### What this means for policy

**Nothing has been changed.** The rate limiter and the retry policy are untouched, deliberately, and the evidence says the limiter is not what needs attention.

The retry policy is a different matter and is now worth a decision. Three attempts at 2s and 4s means all three land inside roughly six seconds — which is exactly what the seed observed, all 21 failing three attempts in ~6s. If the edge is shedding load, a six-second window is simply too narrow to escape it, and the fix is a longer, jittered backoff rather than a slower request rate. **[OPEN]** — raised, not resolved.

### What was instrumented

`musicbrainz.ts` now captures the response body and the rate-limit headers on any non-OK response, and classifies 503s as `server busy` or `rate limited` (`isServerBusy`, `isRateLimited`, `describeFailure`). The classification lands in the error message and in job `last_error`, so the next occurrence explains itself instead of needing another investigation. Timing, attempt count and backoff are unchanged.

### Original investigation

21 failures, all on `/release-group/`. Investigated without changing rate or retry policy.

| Question                                  | Finding                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| Do all requests pass through the limiter? | Yes — one `limiter.schedule()` call site, module-level singleton                             |
| Can the two-request flow bunch requests?  | No — the limiter chains on a promise, so the next task waits for the previous to **resolve** |
| Do retries interact with the limiter?     | Only conservatively; backoff happens outside `schedule()`, then re-enters and waits its turn |
| Concurrent processes?                     | No evidence. Dry runs make no MusicBrainz calls; `searchUpstream` requires a signed-in user  |
| Consistent with rate limiting?            | **Probably not** — see below                                                                 |

Evidence against rate limiting:

- **0.104 req/s observed** over 3,279 seconds — roughly nine times under the 0.9/s limit, because artwork fetches and uploads dominate wall time
- **21 failures on `/release-group/`, zero across 170 `/release/` calls**, despite being interleaved at the same rate
- **All 21 failed three attempts across ~6 seconds** — a rolling rate-limit window would have cleared

Working hypothesis at the time: server-side load or query timeouts on the heavier `release-group?inc=artist-credits+releases` query. **Confirmed as to load, wrong as to the query** — the captured 503 came from a bare lookup with no includes at all, so the weight of the query is not what triggers the shed. The release-group asymmetry remains unexplained and is most likely an artefact of when each endpoint happened to be called; with a global bucket, which endpoint is in flight during a shed is chance.

---

## 6. Staging artwork URL issue — fixed

Every cover rendered broken on staging while pages worked and direct fetches returned 200.

Cause: `NEXT_PUBLIC_SUPABASE_URL` in Vercel carried a **trailing tab** from pasting. `new URL()` tolerates it, so `remotePatterns` matched and pages served; string concatenation preserved it, producing a malformed URL that Next's image optimiser rejected with 400.

Fixed on both sides: the environment variable was corrected and redeployed, and `storedArtworkUrl()` now trims whitespace and trailing slashes, with `next.config.ts` trimming before parsing. Five tests cover tab, newline, surrounding spaces and trailing slash.

Also note: Next 16 blocks image optimisation from local IPs by default (400). `dangerouslyAllowLocalIP` is enabled for development only.

---

## 7. Unresolved decisions and next steps

**Open decisions** (see `docs/product-spec.md` §8 and `docs/data-model.md` §9 for the authoritative list):

- **Whether to widen the MusicBrainz retry window.** Now that the 503s are known to be edge load shedding (§5), three attempts inside ~6s is the part worth revisiting — not the request rate. Longer, jittered backoff, and possibly more attempts. **Nothing changed yet**
- **Whether the daily cron should sweep for missing artwork itself.** `enqueueMissingArtwork()` exists but nothing calls it automatically, so recovery is currently a deliberate act. Auto-sweeping would make the system self-healing at the cost of a cron that enqueues work on its own
- Report reason categories (Phase 6)
- MBID merge handling, handle reuse after deletion
- Genre and tag data

**Next steps:**

1. Run `npm run db:backfill:artwork` against staging to recover the 36 — dry by default, `BACKFILL_DRAIN=true` to fetch. **Not yet run; staging is untouched**
2. Re-run the seed to pick up the 21 MusicBrainz failures — retryable, and the seed is idempotent. Expect some to shed again; that is upstream load, not a defect
3. Confirm the representative real-data cases in `docs/development-plan.md` are present in the seeded catalogue: collaboration, Various Artists, EP, mixtape, compilation, live album, year-only date, multi-disc tracklist, and albums with and without artwork
4. Inspect the seeded catalogue and pages

**Phase 1 completion gate is unchanged and not yet met.** It requires the representative real-data cases to be confirmed present.

---

## 8. Lessons carried forward

**Verify from a clean tree.** `PageProps`/`LayoutProps` are generated into `.next/types`; a stale directory made typecheck pass locally and fail in CI.

**Fixtures encoded a wrong API assumption and hid a real bug.** Release-group responses carry no tracklist; the fixture suite passed because the fixtures made the same mistake. Only real data exposed it.

**Several failures looked like product bugs and were not.** An ambiguous PostgREST embed (two foreign keys join `albums` and `releases` — name the key). A `fetch` stub that replaced the global and broke every Supabase query. Next 16's local-IP image restriction. A tab in an environment variable. Do not assume the code is at fault first.

**Duplicated defaults drift.** The seed runner hardcoded stale values that silently overrode the approved strategy and seeded 14 wrong albums.

**Swallowed errors report success.** `dryRunSeed` ignored a failed lookup, so an unreachable database looked like an empty catalogue.

**Metrics that exclude failures lie.** Artwork coverage reported 100% while 36 albums had no cover.

**Fixing a metric does not fix the rows it already mismeasured.** The four-state model corrects how coverage is computed from now on, but every existing staging row predates it and sits in `pending`, so coverage still prints 100%. A corrected formula over uncorrected data reads exactly like the bug it replaced. Backfill, or say plainly that the number is not yet meaningful.

**Count the right noun.** "68 artwork failures" and "36 albums without artwork" were both true and neither was wrong — one counts failed requests during a run, the other counts albums in a final state, and 32 albums appear in the first but not the second because they succeeded on a later attempt. A count is meaningless without its unit and its moment. Say which noun and which point in time.

**A returned failure is not a raised failure.** `fetchAndStoreArtwork` returns `{ status: 'failed' }` rather than throwing, which is right for the seed and wrong for the job runner — the runner ignored the value and marked the job succeeded. Nothing was broken enough to notice: no exception, no failed job, no alert, just 36 albums quietly never retried. When a function reports failure by return value, every caller has to decide what to do with it, and a `switch` that ignores the result is the easiest place to forget.

**Capture the evidence before theorising about upstream.** Three plausible mechanisms were argued from status codes alone across two sessions. One captured 503 body settled it in a single request — and disproved the leading hypothesis, since the shed happened on a bare lookup rather than the heavy query everyone suspected. Log the body, not just the status.

**A shared bucket is not your bucket.** MusicBrainz reports `x-ratelimit-zone: global` on shed requests and a per-IP zone on served ones. Reading a `remaining` number without reading its zone would have led straight to throttling a client that was already nine times under the limit.

**ListenBrainz went down twice on consecutive days**, while MusicBrainz and Cover Art Archive stayed healthy. Worth designing around when charts eventually refresh on a schedule.

**Testing conventions.** Unit tests are pure logic. Integration tests use the local database and refuse any non-local URL. Seeding uses a separate vitest project whose setup permits remote targets and names them. No test makes a live MusicBrainz, ListenBrainz or Cover Art Archive call.

> **⚠️ `npm run test:integration` deletes all catalogue data.** It truncates `albums` and `artists` between cases. Never run it against a seeded database.
