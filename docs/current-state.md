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

**Phase 1 implementation is complete**, reviewed and accepted on 2026-08-17. Every number below was verified directly against the staging database that day.

**Phase 2 has NOT started.** Nothing from the core loop — collection entries, ratings, likes, reviews, relistens — exists.

---

## 1. Current state

**Phase 1 (catalogue): implemented, seeded, deployed and validated against real data.**

|                  |                                                       |
| ---------------- | ----------------------------------------------------- |
| Unit + component | **110**                                               |
| Integration      | **111** (need a local database)                       |
| End-to-end       | **4** (Playwright)                                    |
| Repository       | <https://github.com/darrylnatale/longplayr> (private) |
| **Staging app**  | <https://longplayr.vercel.app>                        |
| **Staging DB**   | `oexuqjpvyeijmlirxtal.supabase.co`                    |
| Production       | does not exist                                        |

### Staging catalogue

| Entity                          | Count         |
| ------------------------------- | ------------- |
| Albums                          | **338**       |
| Artists                         | **241**       |
| Releases                        | **6,388**     |
| Tracks                          | **4,751**     |
| Albums with no tracklist        | **0**         |
| Representative releases `found` | **338 / 338** |

### Artwork

| `artwork_status` | Albums  |
| ---------------- | ------- |
| `found`          | **336** |
| `absent`         | **0**   |
| `failed`         | **2**   |
| `pending`        | **0**   |

### Queue and audit

|                       |                                                       |
| --------------------- | ----------------------------------------------------- |
| `ingestion_jobs`      | 81 succeeded, 2 failed (exhausted artwork), 0 pending |
| `catalogue_additions` | 3                                                     |
| `profiles`            | 2 (test accounts from smoke testing — see §7)         |

Eight migrations applied; local and remote in sync, confirmed with `npx supabase migration list --linked`. The Supabase CLI is authenticated and the project linked, so staging can be queried read-only with `npx supabase db query --linked "<sql>"` — that is how these numbers were checked and the fastest way to re-check them.

Local development: `npm run db:start && npm run db:env && npm run dev`.

No branch protection — GitHub gates it behind a paid plan for private repositories, and that was declined. `rm -rf .next && npm run verify` before pushing is the compensating control.

---

## 2. Completed work

**Phase 0 — foundation.** Next.js 16, TypeScript, Tailwind 4, Supabase Auth (email/password; Google decided but unbuilt), handle selection, public profiles, service layer with an ESLint boundary rule, Vitest and Playwright, GitHub Actions.

**Phase 1 — catalogue.** Schema, rate-limited MusicBrainz client with contact guard and 503 diagnostics, scope filter, partial dates, representative-release selection, two-request ingestion, artwork pipeline with a four-state lifecycle, tracklist pipeline with a four-state lifecycle, job queue with atomic claiming and retry/backoff/exhaustion, recovery sweeps for artwork and tracklists, tiered search, self-service add with audit and rate limiting, browse surface, ListenBrainz popularity behind `PopularitySource`, seed selection with artist cap.

---

## 3. Real-data validation

The Phase 1 gate was never "no errors during ingest" — it was that each case which drove a modelling decision is exercised against real MusicBrainz data. Results, with the actual records used:

| Case                         | Result           | Record                                                                                  |
| ---------------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| Single-artist studio album   | **PASS**         | Radiohead — OK Computer · `b1392450-e666-3926-a536-22c65f834433`                        |
| Multi-artist collaboration   | **PASS**         | Jay‐Z & Kanye West — Watch the Throne · `a96597aa-93b4-4e14-9e6e-03892ab24979`          |
| Various Artists compilation  | **PASS**         | Various Artists — Now That's What I Call Music · `bcd7ac33-7a46-346d-b2f2-72dcf51012af` |
| EP                           | **PASS**         | Jin — Echo · `62f46692-ce41-4474-b34e-946516fa55dd`                                     |
| Mixtape                      | **PASS**         | Agust D — Agust D · `5e23f1d2-6055-4b29-9aa5-9578debf5960`                              |
| Single **rejected** by scope | **PASS**         | Slik — The Kid's a Punk (`d171358e-…`) excluded live from fallback results              |
| Soundtrack                   | **PASS**         | Toby Fox — UNDERTALE: Soundtrack · `f98e6631-f10a-40e0-953e-c9b32ab18570`               |
| Live album                   | **NOT OBSERVED** | zero in the catalogue; the soundtrack case covers the secondary-type path               |
| Year-only date               | **PASS**         | Bloc Party — Silent Alarm · `f3f82b80-…` renders `2004`, no invented day                |
| Full-precision date          | **PASS**         | OK Computer renders `21 May 1997`                                                       |
| Album with many releases     | **PASS**         | OK Computer, 25 releases → `25 editions`                                                |
| Album **with** cover art     | **PASS**         | OK Computer, image decoded (`naturalWidth > 0`)                                         |
| Album with **no** cover art  | **NOT OBSERVED** | see below — no genuine CAA 404 has occurred                                             |
| Tracklist ingestion          | **PASS**         | 338/338 representative releases `found`                                                 |
| Tracklist recovery           | **PASS**         | 44 recovered, §5                                                                        |
| Self-service addition        | **PASS**         | audit row written and attributed, §6                                                    |
| MusicBrainz fallback add     | **PASS**         | Radiohead — Kid A · `e75c0549-ad55-39e3-8025-c72c5d4a3c5d`                              |
| Duplicate prevention         | **PASS**         | re-ingest left albums/artists/releases unchanged; held albums not re-offered            |
| Artwork retry lifecycle      | **PASS**         | failure → retry → found, and exhaustion, §4                                             |

**The collaboration appears on both credited artists' pages** — JAŸ-Z (`f82bcf78-…`, position 0) and Ye (`164f0d73-…`, position 1) — which is the `album_artists` guarantee, not merely a rendering detail.

The collaboration and the Various Artists compilation were both added **through the app's own MusicBrainz fallback**, not written into the database. Neither existed in the ListenBrainz seed, which is dominated by canonical single-artist albums; the seed strategy was not changed to obtain them.

### `absent` artwork — NOT OBSERVED

`artwork_status = 'absent'` is **0 across 338 albums**. No genuine Cover Art Archive 404 has been encountered, so the "Cover Art Archive answered and holds no front cover" path is **unverified against real data**.

The two `failed` albums are **not** evidence for this case. They are service errors, and treating a failed request as absence is precisely the conflation the four-state model exists to prevent. The placeholder rendering itself is verified — Talking Heads — Remain in Light renders `role="img"` with `aria-label="Remain in Light — no cover art available"` — but via `failed`, not `absent`.

---

## 4. Artwork lifecycle

Four states on `albums.artwork_status`:

- `pending` — not attempted
- `found` — retrieved and stored
- `absent` — Cover Art Archive answered and holds no front cover (a real gap)
- `failed` — the request errored (retryable)

`absent` is a fact about the artwork; `failed` is a fact about the network. A failed request must never be counted as absent.

| Cover Art Archive says | Album becomes | Job becomes                                   |
| ---------------------- | ------------- | --------------------------------------------- |
| an image               | `found`       | `succeeded`                                   |
| 404                    | `absent`      | `succeeded` — answered, no retry              |
| 5xx or network error   | `failed`      | back to `pending`, retried behind backoff     |
| 5xx three times        | `failed`      | `failed` — stops, awaiting a deliberate sweep |

`artworkCoverage()` reports `found / (found + absent + failed)`, with `pending` counted separately. Failures are never hidden from the denominator.

**Recovery is `enqueueMissingArtwork()`**, exposed as `npm run db:backfill:artwork`. Queues a `fetch_artwork` job for every album in `pending` or `failed`, bounded and idempotent twice over: the partial unique index skips albums with outstanding work, and a re-run after a successful drain finds nothing. Queue-only by default; `BACKFILL_DRAIN=true` also drains.

**Recovery result.** The seed left 36 albums at `pending` — attempted, failed, and recorded as nothing, because the seed predated the four-state model. The sweep queued 36 jobs and recovered **34**; 68 Cover Art Archive request failures during the seed had already resolved down to 36 affected albums, since 32 succeeded on later attempts within the run.

### Two exhausted artwork jobs

| Album                           | Attempts | Last error                             |
| ------------------------------- | -------- | -------------------------------------- |
| Talking Heads — Remain in Light | 3 / 3    | `Cover Art Archive returned 502 (250)` |
| Megadeth — Rust in Peace        | 3 / 3    | `Cover Art Archive returned 502 (250)` |

Both are `artwork_status = 'failed'` with `ingestion_jobs.status = 'failed'`. This is the lifecycle working as designed: the retry stopped on its own and said why, rather than failing silently or being misrecorded as absence. Reviving them requires a deliberate `npm run db:backfill:artwork`. **Residual, not a blocker.**

---

## 5. Tracklist lifecycle

Ingestion costs **two** MusicBrainz requests per album — release group, then representative release — because release-group responses carry no `media` and no `track-count`. The second request can fail independently, and it used to fail invisibly:

```ts
} catch {
  // A missing or broken tracklist must not fail an otherwise good album.
  return null;
}
```

The instinct was right and the implementation was not. The album was written, nothing recorded that a tracklist had been attempted, and no work was queued. **44 of 335 albums** had no tracks as a result — 13%, matching the rate MusicBrainz sheds load at its edge — and each was indistinguishable from an album nobody had looked at.

Four states now live on **`releases.tracklist_status`**, not on `albums`. A tracklist is a property of one release: were `representative_release_id` ever to move, an album-level status would keep reporting `found` for a release with no tracks.

| MusicBrainz says     | Tracks    | Release becomes | Job becomes                                 |
| -------------------- | --------- | --------------- | ------------------------------------------- |
| 200 with media       | written   | `found`         | `succeeded`                                 |
| 200, zero tracks     | none      | `absent`        | `succeeded` — answered, no retry            |
| 404 on the release   | none      | `absent`        | `succeeded` — a merge; retrying cannot help |
| 5xx or network error | untouched | `failed`        | back to `pending`, retried behind backoff   |
| 5xx three times      | untouched | `failed`        | `failed` — exhausted and observable         |

The injected fetcher returns a discriminated `ReleaseDetailOutcome` rather than `MappedRelease | null`, because null could not tell "no tracks" from "no answer". **An album whose tracklist fails is still ingested** — that principle is unchanged and directly tested.

**Recovery is `enqueueMissingTracklists()`**, exposed as `npm run db:backfill:tracklists`. It sweeps **representative releases only**, and that restriction is the design: the other ~6,000 release rows are permanently and correctly `pending`, so sweeping by status alone would queue 6,072 jobs where 44 were wanted.

**Recovery result: 44 of 44 recovered** in 119 seconds. Staging now has 0 albums without tracks and 338/338 representative releases `found`. No seed re-run was needed.

The migration backfilled releases that already had tracks to `found` (292) and left the 44 at `pending` rather than `failed` — they were attempted, but nothing observed it, and asserting a history we do not have would be its own kind of error. The sweep covers both states, so accuracy cost nothing.

---

## 6. Self-service addition integrity

`catalogue_additions.user_id` is a foreign key to **`profiles`**, not `auth.users`. An authenticated user who had not chosen a handle therefore violated it — and the insert error was discarded. The album was written, artwork queued, and no audit row recorded. Because `remainingAllowance()` counts exactly those rows, such a user was also **exempt from the 30/hour and 100/day limits entirely**.

Observed on deployed staging during smoke testing: album present, audit table empty.

**The invariant is that an addition reaching the catalogue always has its audit row.** Enforced two ways:

1. **A profile is required** — new `onboarding_required` error. An un-onboarded user cannot add at all, closing the hole at its source rather than patching the symptom.
2. **The insert error is checked.** With the guard in place a foreign-key violation should be impossible, so a failure there is genuinely unexpected and throws, per `src/services/result.ts`.

**Verified against deployed staging**, not only locally: an un-onboarded user is shown _"Choose a handle before adding to the catalogue."_ and nothing is written. 14 integration tests cover the onboarded user, the user without a profile, a failed audit insert, allowance calculation and windowing, hourly-limit refusal, repeat attempts and upstream failures.

`enqueueJob` moved to `src/services/catalogue/queue.ts` so ingestion can queue a retry without importing `jobs.ts`, which already imports ingestion. `jobs.ts` re-exports it.

---

## 7. Residual items

**None of these reopen Phase 1.** They are recorded so a future session does not rediscover them as though they were new.

| Item                                                    | Status                                                                                                                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `absent` artwork state unobserved against real CAA data | §3 — verify opportunistically; do not manufacture it                                                                                                                                                             |
| Two exhausted artwork jobs (CAA 502)                    | §4 — deliberate sweep whenever wanted                                                                                                                                                                            |
| Live album never observed                               | §3 — soundtrack covers the secondary-type path                                                                                                                                                                   |
| **Longer, jittered MusicBrainz backoff**                | **[OPEN]** — see §8                                                                                                                                                                                              |
| `"Added — view"` unreachable                            | After a successful add the page revalidates, the album moves into local results, and the upstream row unmounts before its `useActionState` can render the link. Harmless; the album appears immediately          |
| Staging rejects `@example.com` on public signup         | GoTrue validates the domain on self-signup but not via the admin API. `tests/e2e/auth.spec.ts` uses `@example.com`, so the e2e suite would fail against staging. Test-environment mismatch, not a product defect |
| Two test accounts on staging                            | `fb_1786909208`, `cov_1786972656`. Kept because they own the `catalogue_additions` rows; deleting them nulls `user_id` and leaves the rows as anonymous audit records, which is the designed behaviour           |
| Local Node drifted to v20.17.0                          | CI pins Node 22. `@supabase/supabase-js` needs a global WebSocket, so integration and seed commands need `NODE_OPTIONS=--experimental-websocket` until the local runtime is restored                             |

---

## 8. The MusicBrainz 503s — resolved, not rate limiting

**Answered by capturing a live 503.** The body and headers settle it:

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

1. **The message is the wrong one for rate limiting.** MusicBrainz's rate-limit 503 reads _"Your requests are exceeding the allowable rate limit."_ This one says the server is busy.
2. **The zone is `global`** — a shared bucket, not a budget longplayr can exhaust on its own.
3. **We were rejected with budget remaining** — 12 of 15.
4. **`retry-after: 0`** — MusicBrainz is not asking us to slow down.

Corroborating: on 200 responses the per-IP zone reports `x-ratelimit-limit: 1200` with `remaining` swinging 290 → 1023 → 884 between our own requests at 1.5s spacing. A budget moving by hundreds while we make one request is not being moved by us.

**The 503s were MusicBrainz shedding load at its edge proxy. The rate limiter was never the problem, and the request never reached the application.**

This same shedding explains three separate symptoms: the seed's 21 ingest failures, the 44 missing tracklists, and the intermittently empty MusicBrainz fallback on the search page. That last one presents as "the fallback is broken" — it is not; `searchUpstream` turns any failure into an empty list by design. Measured on deployed staging, the fallback appeared on **7 of 8** and **8 of 8** renders in two samples, and every empty render was one of the slow ones (~6–8s), which is the retry backoff.

### Policy — unchanged

The rate limiter and retry policy are **untouched**, and a test pins the attempt count at three so a future change trips a test rather than passing silently.

**[OPEN] — longer, jittered backoff.** Three attempts at 2s and 4s all land inside roughly six seconds, which is exactly what the seed observed. Against edge shedding a six-second window is too narrow to escape, and the remedy is a longer, jittered backoff rather than a slower request rate. Raised, deliberately not resolved.

### Instrumentation

`musicbrainz.ts` captures the response body and rate-limit headers on any non-OK response and classifies 503s as `server busy` or `rate limited` (`isServerBusy`, `isRateLimited`, `describeFailure`). The classification lands in the error message and in job `last_error`, so the next occurrence explains itself instead of needing another investigation.

---

## 9. Other technical state

**Local Supabase is deliberately trimmed.** Realtime, Edge Runtime, analytics, `storage.vector` and `storage.s3_protocol` are disabled in `supabase/config.toml`, each with a comment explaining why. The full stack exceeds the ~3.8 GiB available to Docker and fails its health checks. Trimmed, it starts in about 40 seconds. Do not re-enable without a concrete need.

**MusicBrainz live calls are blocked locally.** The client throws before `fetch` when `MUSICBRAINZ_CONTACT` looks like a placeholder. Local `.env.local` ships a placeholder on purpose; staging uses the repository URL. Do not work around this guard.

**Job queue is drained** by `/api/cron/drain-jobs`, scheduled daily in `vercel.json`. Vercel's Hobby plan caps cron at once per day, so queued work can lag up to 24 hours. Nothing breaks; pages render placeholders.

**Staging artwork URL issue — fixed.** `NEXT_PUBLIC_SUPABASE_URL` in Vercel carried a trailing tab from pasting. `new URL()` tolerates it, so `remotePatterns` matched and pages served; string concatenation preserved it, producing a malformed URL the image optimiser rejected with 400. Fixed on both sides: the variable was corrected, and `storedArtworkUrl()` now trims whitespace and trailing slashes, with `next.config.ts` trimming before parsing. Next 16 also blocks image optimisation from local IPs by default; `dangerouslyAllowLocalIP` is enabled for development only.

---

## 10. Open decisions

See `docs/product-spec.md` §8 and `docs/data-model.md` §9 for the authoritative list.

- **Longer, jittered MusicBrainz backoff** (§8)
- **Whether the daily cron should sweep for missing artwork and tracklists itself.** Both sweeps exist but nothing calls them automatically, so recovery is a deliberate act. Auto-sweeping would make the system self-healing at the cost of a cron that enqueues work on its own
- Report reason categories (Phase 6)
- MBID merge handling, handle reuse after deletion
- Genre and tag data

---

## 11. Lessons carried forward

**A returned failure is not a raised failure.** This one cost the most, twice. `fetchAndStoreArtwork` returns `{ status: 'failed' }` rather than throwing, and ingestion returned `null` for a failed tracklist. Both are right for their immediate caller and wrong for the one that owns retrying — nothing threw, no job failed, no alert fired, and 36 albums plus 44 tracklists were quietly never retried. When a function reports failure by return value, every caller must decide what to do with it, and the easiest place to forget is a `switch` that ignores the result.

**Encode the distinction in the type.** The tracklist fetcher returned `MappedRelease | null`, and `null` cannot express the difference between "this release has no tracks" and "we never got an answer". A discriminated union made the bug impossible to reintroduce; a comment would not have.

**Capture the evidence before theorising about upstream.** Three plausible mechanisms were argued from status codes alone across two sessions. One captured 503 body settled it in a single request — and disproved the leading hypothesis, since the shed happened on a bare lookup rather than the heavy query everyone suspected. Log the body, not just the status.

**A shared bucket is not your bucket.** MusicBrainz reports `x-ratelimit-zone: global` on shed requests and a per-IP zone on served ones. Reading `remaining` without reading its zone would have led straight to throttling a client already nine times under the limit.

**Metrics that exclude failures lie**, and **fixing a metric does not fix the rows it already mismeasured.** Coverage reported 100% while 36 albums had no cover. Correcting the formula did not change the number, because every existing row predated the state that would have surfaced the gap. Backfill, or say plainly that the number is not yet meaningful.

**Count the right noun.** "68 artwork failures" and "36 albums without artwork" were both true — one counts failed requests during a run, the other counts albums in a final state. A count is meaningless without its unit and its moment.

**Sweep the right population.** Only representative releases ever get a tracklist. A recovery query written against status alone would have queued 6,072 jobs where 44 were wanted, and spent a one-per-second budget for weeks on editions no page displays.

**Foreign keys decide who can act.** `catalogue_additions.user_id` references `profiles`, not `auth.users`, which quietly made un-onboarded users both unauditable and unrateable. The invariant was not "check the error" but "do not let anyone act whom the audit table cannot reference".

**Verify from a clean tree.** `PageProps`/`LayoutProps` are generated into `.next/types`; a stale directory made typecheck pass locally and fail in CI.

**Fixtures encoded a wrong API assumption and hid a real bug.** Release-group responses carry no tracklist; the fixture suite passed because the fixtures made the same mistake. Only real data exposed it.

**Several failures looked like product bugs and were not.** An ambiguous PostgREST embed (name the key — `releases!releases_album_id_fkey`, `releases!albums_representative_release_fk`). A `fetch` stub that replaced the global and broke every Supabase query. Next 16's local-IP image restriction. A tab in an environment variable. A readiness check that raced a migration. Do not assume the code is at fault first.

**Duplicated defaults drift.** The seed runner hardcoded stale values that silently overrode the approved strategy and seeded 14 wrong albums.

**ListenBrainz went down twice on consecutive days**, while MusicBrainz and Cover Art Archive stayed healthy. Worth designing around when charts eventually refresh on a schedule.

**Testing conventions.** Unit tests are pure logic. Integration tests use the local database and refuse any non-local URL. Seeding and backfills use a separate vitest project whose setup permits remote targets and names them. No test makes a live MusicBrainz, ListenBrainz or Cover Art Archive call.

> **⚠️ `npm run test:integration` deletes all catalogue data.** It truncates `albums` and `artists` between cases. Never run it against a seeded database.
