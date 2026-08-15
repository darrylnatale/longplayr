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

Last updated at commit `8907306`.

---

## 1. Current state

**Phase 1 (catalogue), staging deployed, seed in progress.**

|                      |                                                       |
| -------------------- | ----------------------------------------------------- |
| Unit tests           | 94                                                    |
| Integration tests    | 65                                                    |
| End-to-end tests     | 4                                                     |
| Latest commit        | `8907306`                                             |
| Repository           | <https://github.com/darrylnatale/longplayr> (private) |
| **Staging app**      | <https://longplayr.vercel.app>                        |
| **Staging database** | `oexuqjpvyeijmlirxtal.supabase.co`                    |
| Production           | does not exist                                        |

Local: `npm run db:start && npm run db:env && npm run dev`.

Staging is verified clean: schema pushed (6 migrations), artwork bucket present,
`/albums` served 0 albums, unknown handles 404, cron endpoint 401 without a
token. All five environment variables are set in Vercel for Production and
Preview.

No branch protection — GitHub gates it behind a paid plan for private repos and
that was declined. `rm -rf .next && npm run verify` before pushing is the
compensating control.

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

Search, discovery, self-service add, album/artist pages, tracklists and the job
queue are all built and tested.

**In progress:** the approved seed running against staging — ListenBrainz
all-time, 500 candidates, max 2 albums per artist, expecting 358 albums and
~716 MusicBrainz requests over ~12 minutes. It writes `seed-report.json` and
`seed-report.txt` (both gitignored) into the project root.

**Next, once it finishes:** produce the full data report — ingested, scope
rejections, failures, artists, releases, tracks, type distribution, artwork
coverage, incomplete dates, multi-disc, collaborations, Various Artists, and any
unexpected MusicBrainz shapes — then capture the real pages for inspection and
stop.

**Completion gate unchanged.** Phase 1 is not complete until the representative
real-data cases in `docs/development-plan.md` are confirmed present in the
seeded catalogue.

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

**Verify from a clean tree.** `PageProps`/`LayoutProps` are generated into
`.next/types`; a stale directory made typecheck pass locally and fail in CI.

**Fixtures encoded a wrong assumption and hid a real bug for hours.**
Release-group responses carry no `media` and no `track-count` — tracklists need
a second request for the representative release, and `track-count` is per
medium. The fixture suite passed throughout because the fixtures made the same
mistake. Only real data exposed it. Ingestion now costs two MusicBrainz requests
per album.

**Three failures looked like product bugs and were not.** A PostgREST embed was
ambiguous because two foreign keys join `albums` and `releases` — queries must
name the key. A Cover Art Archive stub replaced `globalThis.fetch` wholesale and
broke every Supabase query in the file. Next 16 blocks image optimisation from
local IPs by default, returning 400. Do not assume the code is at fault first.

**Duplicated defaults drift.** The seed runner hardcoded `SEED_LIMIT ?? 50` and
`SEED_RANGE ?? 'month'`, silently overriding the approved strategy and seeding
14 wrong albums. The runner now carries no defaults; `seedCatalogue` owns them.

**Swallowed errors report success.** `dryRunSeed` ignored a failed lookup, so an
unreachable database looked like an empty catalogue.

**An interrupted tool call may already have run.** A rejected seed command had
ingested most of a catalogue before being killed, which made a later report look
inconsistent.

**Testing conventions to preserve.** Unit tests are pure logic. Integration
tests use the local database and refuse any non-local URL. Seeding uses a
separate vitest project whose setup permits remote targets and names them. No
test makes a live MusicBrainz, ListenBrainz or Cover Art Archive call.

---

## 8. Next action

**Read `seed-report.json` and produce the data report**, then capture the
staging pages — browse, an album with artwork, one without, an artist, and
several search queries — and stop for inspection.

The report is a file on disk, so it does not depend on conversation context.

Do not start Phase 2. Do not add infrastructure without a demonstrated need.
