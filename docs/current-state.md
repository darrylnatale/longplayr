# Current State

**Purpose:** let a future session pick up immediately. Where we are _right now_ — not what the product is or how it is designed.

**This document is not the source of truth.** It goes stale fastest of anything in `docs/`. When it disagrees with anything below, the other document wins:

| Authority                                    | Document                                     |
| -------------------------------------------- | -------------------------------------------- |
| 1. Non-negotiable rules and locked decisions | `CLAUDE.md`                                  |
| 2. What the product is                       | `docs/product-spec.md`                       |
| 3. How it is designed                        | `docs/architecture.md`, `docs/data-model.md` |
| 4. What gets built and when                  | `docs/development-plan.md`                   |
| 5. Where we are right now                    | this file                                    |

Last updated at commit `c47d461`.

---

## 1. Current state

**Phase 1 (catalogue), roughly two-thirds through.** The application runs locally: `npm run db:start && npm run db:env && npm run dev`.

|                   |                                                       |
| ----------------- | ----------------------------------------------------- |
| Unit tests        | 70                                                    |
| Integration tests | 31 (need the local database)                          |
| End-to-end tests  | 4 (Playwright)                                        |
| Latest commit     | `c47d461` — artwork pipeline                          |
| Repository        | <https://github.com/darrylnatale/longplayr> (private) |
| Deployed          | **No.** Nothing is deployed anywhere yet              |

CI runs on every push and is green. There is **no branch protection** — GitHub gates it behind a paid plan for private repos, and paying or going public for it was declined. The compensating control is `rm -rf .next && npm run verify` before pushing.

---

## 2. Completed work

**Phase 0 — foundation. Complete locally, not deployed.** Next.js 16 + TypeScript + Tailwind 4, Supabase Auth (email/password only — Google is decided but unbuilt), handle selection at `/onboarding`, public profile at `/<handle>`, service layer with an ESLint rule enforcing the boundary, Vitest + Playwright, GitHub Actions.

Its definition of done requires a deployed staging URL, so Phase 0 is **not formally complete** until Supabase and Vercel exist (`docs/deployment.md`).

**Phase 1 — catalogue, in progress.** Done and tested:

- Catalogue schema: `artists`, `albums`, `album_artists`, `releases`, `tracks`, plus `ingestion_jobs` and `catalogue_additions`
- `RateLimiter` — serialises rather than bursting
- MusicBrainz client with retry/backoff and a hard contact guard
- Scope filter (albums, EPs, mixtapes; no singles), partial-date handling, representative-release selection
- Mapping layer plus fixtures covering the smoke-test cases
- Ingestion writes — upsert by MBID, idempotent
- Artwork pipeline — Cover Art Archive only, with coverage measurement

---

## 3. Technical state

**Local Supabase is deliberately trimmed.** Realtime, Edge Runtime, analytics, `storage.vector` and `storage.s3_protocol` are disabled in `supabase/config.toml`, each with a comment saying why. This is not cosmetic: the full stack exceeds the ~3.8 GiB available to Docker, containers miss health checks, and `supabase start` rolls everything back. The trimmed stack starts clean in about 40 seconds. **Do not re-enable these without a concrete need.**

**MusicBrainz live calls are blocked.** `src/services/catalogue/musicbrainz.ts` throws before `fetch` when `MUSICBRAINZ_CONTACT` looks like a placeholder. Local `.env.local` ships a placeholder on purpose. The production value is `https://github.com/darrylnatale/longplayr`, to be set in Vercel. **Do not work around this guard** — an unidentified client can get longplayr blocked for every user at once.

**Artwork is Cover Art Archive only.** Both fallbacks were rejected on their terms (`docs/architecture.md` §7). Coverage gaps are permanent and expected. `albums.artwork_status` (`pending`/`found`/`absent`) is always written, so coverage is queryable via `artworkCoverage()`.

**Job queue exists but is not drained.** `ingestion_jobs` is created and indexed; nothing enqueues or consumes it yet. That is the next task.

**Service role.** `src/lib/supabase/admin.ts` bypasses RLS and is server-only. Catalogue writes use it; no user has write access to the catalogue.

---

## 4. Remaining Phase 1 work

In intended order:

1. **Job queue drain** — claim-and-run loop plus a cron route handler, respecting the rate limiter. Retry, backoff and failure states need tests.
2. **Album and artist pages** — read-only, no personal state (that is Phase 2). Album page needs the three-state shell but only the not-collected state is reachable now.
3. **Search** — Postgres full-text plus trigram over albums, artists, users. Ranking combines text match, artist weighting and the popularity signal.
4. **MusicBrainz fallback in search** — self-service add, scope-filtered, capped at 30/hour and 100/day per user via `catalogue_additions`.
5. **ListenBrainz seed** — `PopularitySource` interface with a ListenBrainz implementation, then a seed job. Filter to entries carrying MBIDs; they are optional in responses.

**Completion gate.** Phase 1 is _not_ complete when these pass. It requires the **real-data smoke test** in a deployed environment with the genuine contact value, covering the case table in `docs/development-plan.md`. The user wants to inspect real pages and catalogue behaviour before Phase 1 is signed off. Everything to date is fixture-verified only.

---

## 5. Genuinely open decisions

Only these. Everything else is locked in the documents above.

- **Deployment**: Supabase projects and Vercel do not exist yet. Blocks the smoke test, Phase 0 sign-off, and Google sign-in.
- **Search ranking weights**: the formula is described but the actual weights are unset, and can only be tuned against real data.
- **Seed size**: how many albums to seed, and what "popular" resolves to in practice.
- **Report categories**, **MBID merge handling**, **handle reuse after deletion** — all deferred, none blocking.

---

## 6. Risks and things to watch

**Real MusicBrainz behaviour is unproven.** Every fixture is hand-built from documented shapes, not captured responses. Field presence, `artist-credit` ordering, and secondary-type spellings are the likely sources of surprise. This is the single biggest known unknown.

**Artwork coverage is unmeasured.** With no fallback source, the gap could be worse than expected on less-popular records. `artworkCoverage()` gives the number as soon as real ingestion runs — get it early.

**Search disambiguation is the hard part**, not matching. Many albums share a title, and ranking depends on the popularity signal, which itself depends on ListenBrainz. Two unproven things stacked.

**Rate limit is the throughput ceiling.** One request per second means seeding is slow by construction. Do not parallelise around the limiter.

**No branch protection.** A red commit can land on `main`. Already happened once.

---

## 7. Lessons from this session

**Verify from a clean tree.** `PageProps`/`LayoutProps` are generated into `.next/types`; a stale directory made typecheck pass locally and fail in CI. `npm run typecheck` now runs `next typegen` first, but always `rm -rf .next` before verifying.

**Two failures looked like product bugs and were test bugs.** Embedding `releases` from `albums` is ambiguous — two foreign key paths exist, so queries must name the key: `releases!releases_album_id_fkey(...)`. And a Cover Art Archive stub that replaced `globalThis.fetch` wholesale also intercepted supabase-js, breaking every query in the file. **Scope fetch stubs by URL.** In both cases the code was right and the test was wrong; do not assume the opposite by default.

**Diagnose containers from their logs.** Storage looked broken but was starting successfully, just slower than its health check allowed. The logs said so plainly.

**Fixture MBIDs must be valid UUIDs.** The schema types them as `uuid` and rejects readable placeholders. Real MBIDs are UUIDs.

**Testing conventions to preserve.** Unit tests are pure logic, no database, no network. Integration tests use the real local database and refuse to run against a non-local URL. Nothing in the suite makes a live MusicBrainz or Cover Art Archive call.

---

## 8. Next action

**Build the job queue drain.** A claim-and-run function over `ingestion_jobs` (respecting `run_after`, `priority`, `attempts`/`max_attempts`), a cron route handler that drains at the MusicBrainz rate, and integration tests for retry, backoff, exhaustion and the partial unique index. Then continue in the order in §4.
