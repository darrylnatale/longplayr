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

Verified against the staging database and a clean-tree build on 2026-08-18.

**Phase 1 implementation is complete.** **Phase 2 is in progress** — its first slice, the collection schema and service layer, is built and tested. No UI is wired to it. Lists, follows, activity, feed, notifications and messaging do not exist, in schema or in code.

**The design-foundation track is complete.** Every surface is migrated and verified by screenshot at 390, 768 and 1440px — see §7.

**New product direction was recorded on 2026-08-18 and none of it is implemented** — Want to Listen, taste overlap, profile photo/bio/city, and direct messaging. Want to Listen is intended to generate feed events; messaging is intended functionality rather than a possibility, and is blocked on legal research; dating-specific profile fields are explicitly excluded. See §12, and `docs/product-spec.md` §10 for the authoritative record.

> ### ✅ The two `CLAUDE.md` contradictions are resolved
>
> Both were carried as open items across three checkpoints and were closed by the maintainer on 2026-08-18, which is the only way a top-authority statement should ever change.
>
> - The status line was corrected to read "Design foundation complete", replacing "Phase 1 (catalogue), in progress". It has since been advanced again as Phase 2 began.
> - The styling line no longer calls `globals.css` provisional placeholder tokens; it describes the semantic design-token system that is actually there.
>
> No contradiction between this document and `CLAUDE.md` is currently known.

---

## 1. Current state

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

### Queue and accounts

|                       |                                                       |
| --------------------- | ----------------------------------------------------- |
| `ingestion_jobs`      | 81 succeeded, 2 failed (exhausted artwork), 0 pending |
| `catalogue_additions` | 3                                                     |
| `profiles`            | 3 (test accounts — see §8)                            |

Eight migrations applied; local and remote in sync, confirmed with `npx supabase migration list --linked`. Staging can be queried read-only with `npx supabase db query --linked "<sql>"`, which is how these numbers were checked.

### Git state

The last commit is this documentation checkpoint. **The entire design-foundation implementation is uncommitted** in the working tree — **17 modified files, 8 new components and the 2-file development gallery**, listed in §7. It has been verified clean-tree at every step but deliberately left uncommitted while each surface was reviewed.

Every surface has now been migrated, and the last four — Browse, Home, login/signup/onboarding — were inspected against a running app at all three widths rather than by markup alone. Browse used real staging data; Home and the auth surfaces were driven through the real signup, sign-in and handle-claiming flows against a local database, with the temporary accounts deleted afterwards.

No branch protection — GitHub gates it behind a paid plan for private repositories, and that was declined. `rm -rf .next && npm run verify` before pushing is the compensating control.

Local development: `npm run db:start && npm run db:env && npm run dev`.

---

## 2. Completed work

**Phase 0 — foundation.** Next.js 16, TypeScript, Tailwind 4, Supabase Auth (email/password; Google decided but unbuilt), handle selection, public profiles, service layer with an ESLint boundary rule, Vitest and Playwright, GitHub Actions.

**Phase 1 — catalogue.** Schema, rate-limited MusicBrainz client with contact guard and 503 diagnostics, scope filter, partial dates, representative-release selection, two-request ingestion, artwork pipeline with a four-state lifecycle, tracklist pipeline with a four-state lifecycle, job queue with atomic claiming and retry/backoff/exhaustion, recovery sweeps for artwork and tracklists, tiered search, self-service add with audit and rate limiting, browse surface, ListenBrainz popularity behind `PopularitySource`, seed selection with artist cap.

**Design foundation — in progress.** See §7.

---

## 3. Real-data validation

Each case that drove a modelling decision, exercised against real MusicBrainz data. The records are named so any row can be re-checked rather than taken on trust.

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
| Album **with** cover art     | **PASS**         | OK Computer, image decoded                                                              |
| Album with **no** cover art  | **NOT OBSERVED** | see §4 — no genuine CAA 404 has occurred                                                |
| Tracklist ingestion          | **PASS**         | 338/338 representative releases `found`                                                 |
| Tracklist recovery           | **PASS**         | 44 recovered, §5                                                                        |
| Self-service addition        | **PASS**         | audit row written and attributed, §6                                                    |
| MusicBrainz fallback add     | **PASS**         | Radiohead — Kid A · `e75c0549-ad55-39e3-8025-c72c5d4a3c5d`                              |
| Duplicate prevention         | **PASS**         | re-ingest left counts unchanged; held albums not re-offered                             |
| Artwork retry lifecycle      | **PASS**         | failure → retry → found, and exhaustion, §4                                             |

The collaboration and the Various Artists compilation were added **through the app's own MusicBrainz fallback**, not written into the database. Neither existed in the ListenBrainz seed, and the seed strategy was not changed to obtain them.

The collaboration appears on **both** credited artists' pages — JAŸ-Z (`f82bcf78-…`) and Ye (`164f0d73-…`) — which is the `album_artists` guarantee.

---

## 4. Artwork lifecycle

Four states on `albums.artwork_status`: `pending` (not attempted), `found`, `absent` (Cover Art Archive answered and holds no front cover), `failed` (the request errored, retryable).

`absent` is a fact about the artwork; `failed` is a fact about the network. A failed request must never be counted as absent.

| Cover Art Archive says | Album becomes | Job becomes                                   |
| ---------------------- | ------------- | --------------------------------------------- |
| an image               | `found`       | `succeeded`                                   |
| 404                    | `absent`      | `succeeded` — answered, no retry              |
| 5xx or network error   | `failed`      | back to `pending`, retried behind backoff     |
| 5xx three times        | `failed`      | `failed` — stops, awaiting a deliberate sweep |

`artworkCoverage()` reports `found / (found + absent + failed)`, with `pending` counted separately. Recovery is `enqueueMissingArtwork()`, exposed as `npm run db:backfill:artwork`; queue-only by default, `BACKFILL_DRAIN=true` also drains.

**`absent` remains NOT OBSERVED.** No genuine Cover Art Archive 404 has occurred across 338 albums, so that branch is unverified against real data. The two `failed` albums are service errors and must not be read as evidence for it.

### Two exhausted artwork jobs

| Album                           | Attempts | Last error                             |
| ------------------------------- | -------- | -------------------------------------- |
| Talking Heads — Remain in Light | 3 / 3    | `Cover Art Archive returned 502 (250)` |
| Megadeth — Rust in Peace        | 3 / 3    | `Cover Art Archive returned 502 (250)` |

The lifecycle working as designed: the retry stopped on its own and said why. Reviving them requires a deliberate sweep.

---

## 5. Tracklist lifecycle

Ingestion costs **two** MusicBrainz requests per album, because release-group responses carry no `media` and no `track-count`. The second request used to fail invisibly — the album was written, nothing recorded the attempt, no work was queued — leaving **44 of 335** albums with no tracklist, indistinguishable from albums nobody had looked at.

Four states now live on **`releases.tracklist_status`**, not on `albums`: a tracklist is a property of one release, and were `representative_release_id` ever to move, an album-level status would keep reporting `found` for a release with no tracks.

| MusicBrainz says     | Release becomes | Job becomes                                 |
| -------------------- | --------------- | ------------------------------------------- |
| 200 with media       | `found`         | `succeeded`                                 |
| 200, zero tracks     | `absent`        | `succeeded` — answered, no retry            |
| 404 on the release   | `absent`        | `succeeded` — a merge; retrying cannot help |
| 5xx or network error | `failed`        | back to `pending`, retried behind backoff   |
| 5xx three times      | `failed`        | `failed` — exhausted and observable         |

The injected fetcher returns a discriminated `ReleaseDetailOutcome` rather than `MappedRelease | null`, because null could not distinguish "no tracks" from "no answer". **An album whose tracklist fails is still ingested.**

`enqueueMissingTracklists()` (`npm run db:backfill:tracklists`) sweeps **representative releases only** — the other ~6,000 release rows are permanently and correctly `pending`, so sweeping by status alone would queue thousands of jobs where dozens are wanted.

**All 44 recovered.**

---

## 6. Self-service addition integrity

`catalogue_additions.user_id` is a foreign key to **`profiles`**, not `auth.users`. An authenticated user who had not chosen a handle violated it, and the insert error was discarded — the album was written, artwork queued, and no audit row recorded. Because `remainingAllowance()` counts those rows, such a user was also exempt from the 30/hour and 100/day limits entirely.

**The invariant is that an addition reaching the catalogue always has its audit row.** Enforced two ways: a profile is required (`onboarding_required`), and the insert error is checked rather than swallowed. Verified against deployed staging, not only locally.

---

## 7. Design foundation

Established before Phase 2 deliberately: Phase 2 multiplies UI, and retrofitting a design system across built components costs far more than setting one first.

### Locked decisions

| #   | Decision                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Design foundation built **before** Phase 2 implementation, not in parallel                                                                  |
| B   | Grid geometry: ~12-column square artwork grid at desktop, treated as an explicit system decision                                            |
| C   | Favourites are independent of the collection                                                                                                |
| D   | Collection grid uses a **user density toggle**: Compact (artwork only) is the default; Detailed adds title, credit and collection state     |
| E   | A completed profile is required before collecting; user-authored rows reference `profiles(id)`                                              |
| F   | _(was the overlay question — resolved as D)_                                                                                                |
| G   | `Activity` deferred entirely to Phase 3; Phase 2 mutations structured so write points can be added without duplicating logic                |
| H   | **RESOLVED 2026-08-18** — pages stay dynamically rendered; catalogue caching moves to the data layer behind a cookie-free client. See below |

Visual identity: **brass `#C9A227`** accent on a warm-neutral ground; **Newsreader** for editorial content and titles, **Geist Sans** for chrome; monochrome scores, never tinted by value; content container **1120px**, wide container **min(94vw, 1680px)**; mobile navigation is a **bottom tab bar** below 768px with Browse · Search · You, where "You" is a stable destination whose label never changes.

### Components

New: `Container`, `SectionHeader`, `ScoreBadge`, `ActionCard`, `CollectionTile`, `CollectionGrid`, `MobileTabBar`, `Avatar`, `AuthShell`, `Field`.
Migrated: `AlbumCover`, `AlbumGrid`.

`AuthShell` and `Field` exist because login and signup live in `(auth)/` while onboarding lives in `onboarding/`, so no route-group layout can cover all three. A user meets all three within a minute of arriving and any difference between them reads as a bug.

`src/app/design/` is a **development-only** gallery making tokens, geometry and component states inspectable against real staging artwork. It 404s in production.

### Migration status

| Surface                    | State                                                          |
| -------------------------- | -------------------------------------------------------------- |
| Root layout and navigation | **migrated** — width cap removed, page width explicit per page |
| Album detail               | **migrated** — the canonical detail composition                |
| Artist                     | **migrated** — the canonical discography composition           |
| Search                     | **migrated**                                                   |
| Profile                    | **migrated** — identity only                                   |
| Browse                     | **migrated** — verified against staging at 390/768/1440        |
| Home                       | **migrated** — three session states, no catalogue queries      |
| Login                      | **migrated**                                                   |
| Signup                     | **migrated**                                                   |
| Onboarding                 | **migrated**                                                   |

**All nine surfaces are migrated and screenshot-verified at 390, 768 and 1440px.** Earlier checkpoints counted eight rows because login, signup and onboarding shared one "Auth" row; they are listed separately here because they were migrated together but are three distinct routes across two route trees.

The definition of done for this track in `docs/development-plan.md` — a component set and tokens verified by screenshot, with Phase 1's album and artist pages brought onto them — was met several surfaces ago. Everything past that was deliberate: retrofitting a design system across Phase 2's UI would cost far more than finishing it first.

`docs/development-plan.md`'s definition of done for this track — a component set and tokens verified by screenshot, with Phase 1's album and artist pages brought onto them — **is met**. Search and profile went beyond it; Browse, Home and Auth remain.

### Implementation decisions

Seven are recorded in `docs/design-reference.md` §11: the 200–240px square artwork column rather than the reference's ~13%, sans tracklists, rating in the right rail, the `max-w-sm` action-card cap below 1024px, and — from the Browse migration — stacked grids ranked by density, stored artwork size following density, and a page title taking the serif only when it names a catalogue entity.

Others made during migration and not yet written into `design-reference.md`:

- **`AlbumGrid` gained `creditFor`** — it _suppresses_ the credit line when it equals the artist whose page the grid is on, rather than gating whether a credit renders at all. On an artist page that hides the redundant repetition while still surfacing collaborations _and_ upstream renames (albums credited to Kanye West sit under an artist MusicBrainz now calls Ye). On a page with no artist context the credit always shows, because a caption without an artist is barely a caption.
- **Search uses rows, not a grid.** Results are ranked and cross entity types, so vertical order carries meaning a wall of covers would discard, and artists and people have no artwork to tile.
- **Upstream search results sit in a panel with a dashed "add slot"** rather than a cover. A grey square would read as "cover missing" and imply we already hold the record.
- **The profile shows no stat cluster.** `0 albums · 0 following · 0 followers` would imply those surfaces are live and merely unused. `CollectionGrid` is deliberately unused there — there is no collection data, and manufacturing some would make every later screenshot a lie.
- **The artist discography uses `relaxed` density with captions**, following the Detailed convention: metadata buys the room it needs rather than being crammed under a shelf-density cell.
- **Browse keeps its Popular section conditional and its Recently added section unconditional.** "No popularity data" and "no albums" are different conditions and only the second deserves a sentence, so Popular hides itself while Recently added states the empty case once.

### Browse verification

Checked against real staging data at 390, 768 and 1440px, following the build-screenshot-compare loop `docs/design-reference.md` §10 asks for. Recorded because the artwork-scale defect below was invisible in markup, in tests and in the DOM — it was only visible in the pixels, which is §12's standing lesson arriving again.

| Check                             | Result                                                                                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wall consistency with artist page | **PASS** — identical geometry, both `relaxed` at ~175px cells at 1440, same section header and caption stack                                                                                               |
| Popularity ordering               | **PASS** — rendered order matches `popularity_score desc` on staging exactly: OK Computer 500, Nevermind 499, Hybrid Theory 498, Meteora 497, Discovery 495, Toxicity 494, In Rainbows 493, Demon Days 492 |
| Real and placeholder artwork      | **PASS** — the `RIP` tile (Megadeth — Rust in Peace, exhausted CAA 502) reads as intentional among real covers, not as broken                                                                              |
| Empty state                       | **PASS** — checked against the empty local database rather than by mutating staging                                                                                                                        |
| Mobile tab bar                    | **PASS** — `aria-current` correct on `/albums` and moves on tap; 34.6px clearance between the last tile and the fixed bar                                                                                  |
| Artwork scale                     | **CORRECTED** — `AlbumGrid` hardcoded the 250px asset, so `relaxed` cells were being interpolated upward. Now density-mapped                                                                               |

The ranking itself was not touched. `getPopularAlbums`, `getRecentAlbums`, `getCatalogueSize`, the limits, `popularity_score` and the `PopularitySource` abstraction are all unchanged; the migration was presentation only.

### Decision H — album page caching, resolved

Investigated against the bundled Next.js 16 docs in `node_modules/next/dist/docs/` and against the build manifest, not from memory.

#### What is actually happening today

**The whole application is dynamically rendered, and the site header is why.**

`cookies()` is a Request-time API, and in the caching model this project uses, touching it anywhere in a route's render tree opts that route into dynamic rendering. Three facts compound:

1. `src/lib/supabase/server.ts` `createClient()` awaits `cookies()` — it is a session-bound client by design, so RLS applies as the signed-in user.
2. Every service-layer read goes through it, including purely public catalogue reads.
3. `RootLayout` and `SiteHeader` both call `getCurrentUser()` and `getCurrentProfile()`, and they wrap **every** route.

The build manifest confirms it: every route renders `f` (dynamic) except `/design`, and that one is static only because it sets `dynamic = 'force-static'` explicitly.

**So there is no leak today, and there is also no caching.** The album page cannot serve one user's collection state to another because nothing is cached at all. The risk decision H was raised against is not a bug that exists — it is the bug someone creates by adding `export const revalidate` or `force-static` to a route that renders personal state, in order to "fix" the performance this arrangement costs.

**This project is not on Cache Components.** `next.config.ts` does not set `cacheComponents`, so `use cache`, `cacheLife`, `use cache: private` and the Suspense-shell prerendering model do not apply here. Enabling it is a whole-application migration with its own guide, and it changes the prerendering model for `GET` route handlers too — `/api/cron/drain-jobs` is one.

#### Decided

**Pages that render personal state stay dynamic. Catalogue caching happens at the data layer, behind a client that cannot see cookies.**

1. **No route-level caching on any route that renders per-user state.** No `revalidate`, no `force-static`, no `dynamic` overrides. This is the rule that prevents the leak, and it is binding from day one of Phase 2.
2. **Catalogue reads that are genuinely public get a cookie-free path.** A public Supabase client — anon key, no cookie binding — alongside the existing session-bound `createClient()`. The catalogue is read-only downstream of MusicBrainz and already carries `anon` grants, so this changes no authorisation.
3. **Cache those reads, not the pages.** A cached catalogue read is leak-proof by construction: no session is in scope to leak.
4. **Do not enable Cache Components during Phase 2.** Record it as the migration target afterwards, at which point `use cache` replaces the caching primitive and the header's session read moves behind `<Suspense>` so a static shell becomes possible.

#### Why this and not the alternatives

Caching the album page itself is the thing that leaks, and no amount of care makes a route-level cache safe while personal state renders in the same pass. Enabling Cache Components now would be correct in the long run and is where this eventually goes, but it is an application-wide change landing in the middle of the phase that introduces the collection — two large migrations at once, with a privacy leak as the failure mode of getting it wrong.

#### The tradeoffs, stated plainly

- **No static shell, no partial prerendering.** Every request still renders on the server. The saving is database round-trips, which is the real cost here — Supabase is in `eu-west-3` and the catalogue read is the expensive part, not the render.
- **The caching primitive available today is deprecated.** `unstable_cache` is marked in the Next 16 docs as replaced by `use cache`. Anything written now is written knowing it gets replaced.
- **A second Supabase client is a real service-layer addition**, and it must stay narrow: public catalogue reads only, never anything user-scoped. A cache scope cannot read cookies, so this is not stylistic — it is the only way to cache these reads at all.
- **The header remains the ceiling.** Until the session read moves behind `<Suspense>`, no page can be static regardless of what its own data does.

**This belongs in `docs/architecture.md` once implemented.** It is recorded here because decision H is recorded here, and no code has been written.

### Deferred design polish — none of these block Phase 2

Recorded so they are not rediscovered as bugs. Each was found during migration, judged real, and deliberately left.

| Item                                       | Detail                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Search focus and error tokens lag auth** | The auth migration moved focus to the full `accent` (5.94:1 against the resting border, where `accent-dim` measured 2.54:1) and error text to `--color-danger-text`. The search input still uses `accent-dim`, which makes it the outlier. One token each; no behaviour involved           |
| **`text-muted` measures 4.14:1**           | `--ink-400` on `--ink-950`, marginally under the 4.5:1 WCAG AA needs for body text. Product-wide and pre-existing, so changing it is a palette decision rather than a fix — it would shift every metadata line in the product at once                                                      |
| **Form values lost after a failed submit** | Uncontrolled inputs plus `useActionState`: a rejected sign-in clears the email you just typed. Fixing it means the server action echoing submitted values back in its state, which changes the action contract — a behaviour change, deliberately not made during a presentation-only pass |

Two smaller ones, already fixed and recorded only so they are not re-introduced: every error message in the product used a raw Tailwind red before `--color-danger-text` existed, and `--color-danger` itself measures 2.96:1 and **cannot** carry text — it is for fills and borders only.

### Divergence from `design-reference.md`

§3 describes the profile as an overview with a stat cluster, favourites row and tabs. None of that is built, because none of the data exists. This is a **deferral, not a disagreement** — the reference describes the destination.

§9 records phone-width behaviour as a known gap. It has since been **closed by decision** — the bottom tab bar was designed from first principles rather than borrowed. §9 has not been amended and is stale in that respect.

---

## 8. Residual items

None of these reopen Phase 1.

| Item                                              | Status                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `absent` artwork unobserved against real CAA data | §4 — verify opportunistically; do not manufacture it                                                                                                                                                                                                                                                                                                                                                                        |
| Two exhausted artwork jobs (CAA 502)              | §4 — deliberate sweep whenever wanted                                                                                                                                                                                                                                                                                                                                                                                       |
| Live album never observed                         | §3 — soundtrack covers the secondary-type path                                                                                                                                                                                                                                                                                                                                                                              |
| **Longer, jittered MusicBrainz backoff**          | **[OPEN]** — see §9                                                                                                                                                                                                                                                                                                                                                                                                         |
| `"Added — view"` unreachable                      | After a successful add the page revalidates and the upstream row unmounts before its `useActionState` can render the link. Harmless; the album appears in local results                                                                                                                                                                                                                                                     |
| Staging rejects `@example.com` on public signup   | GoTrue validates the domain on self-signup but not via the admin API, so `tests/e2e/auth.spec.ts` would fail against staging                                                                                                                                                                                                                                                                                                |
| Email confirmation disabled on staging            | Turned off deliberately so signup works without SMTP. **Production must have it on**, which means real SMTP configured before launch                                                                                                                                                                                                                                                                                        |
| Three test accounts on staging                    | Two own `catalogue_additions` rows; deleting them nulls `user_id` and leaves the rows as anonymous audit records, which is the designed behaviour                                                                                                                                                                                                                                                                           |
| Local Node drifted to v20                         | CI pins Node 22. `@supabase/supabase-js` needs a global WebSocket, so integration and seed commands need `NODE_OPTIONS=--experimental-websocket` until the local runtime is restored                                                                                                                                                                                                                                        |
| Artists have at most 3 releases                   | The seed capped at 2 per artist, so the deep-discography case is untested against real data                                                                                                                                                                                                                                                                                                                                 |
| Design-foundation code uncommitted                | §1 — verified clean-tree at every step, held for review                                                                                                                                                                                                                                                                                                                                                                     |
| **Browse is very tall at phone width**            | **[OPEN]** — 8,122px at 390px. `relaxed` is 2-up on a phone, so Popular's 24 captioned albums run 12 rows before Recently added begins. Observation, not a defect: consistency with the migrated artist page was the stronger constraint, and the alternatives were changing the query limit or inventing a per-breakpoint density. Revisit when the real charts arrive and a "show more" boundary has to be decided anyway |
| **`AlbumGrid` passes no `priority`**              | **[OPEN]** — Next flags the first Popular cover as LCP and asks for eager loading. Pre-existing and identical on the artist page. Deliberately not fixed during a presentation-only migration: choosing how many leading cells get `priority` is its own decision and it affects every grid surface at once                                                                                                                 |

---

## 9. The MusicBrainz 503s — resolved, not rate limiting

Answered by capturing a live 503:

```
{"error": "The MusicBrainz web server is currently busy. Please try again later."}

x-ratelimit-zone:      global          ← not our per-IP budget
x-ratelimit-limit:     15
x-ratelimit-remaining: 12              ← rejected with 12 of 15 left
retry-after:           0               ← retry immediately, no penalty
server:                openresty       ← the edge proxy; 200s come from Plack::Handler::Starlet
```

The message is not the rate-limit one, the zone is global rather than per-IP, we were rejected with budget remaining, and `retry-after: 0` is not a request to slow down. **The 503s were MusicBrainz shedding load at its edge proxy; the request never reached the application.**

This one cause explains three separate symptoms: the seed's 21 ingest failures, the 44 missing tracklists, and the intermittently empty MusicBrainz fallback on the search page.

**Policy is unchanged**, and a test pins the attempt count at three. **[OPEN] — longer, jittered backoff.** Three attempts at 2s and 4s all land inside roughly six seconds, which is too narrow a window to escape a shed. Raised, deliberately not resolved.

`musicbrainz.ts` captures the response body and rate-limit headers on any non-OK response and classifies 503s as `server busy` or `rate limited`, so the next occurrence explains itself.

---

## 10. Other technical state

**Local Supabase is deliberately trimmed.** Realtime, Edge Runtime, analytics, `storage.vector` and `storage.s3_protocol` are disabled in `supabase/config.toml`. The full stack exceeds the ~3.8 GiB available to Docker. Do not re-enable without a concrete need.

**MusicBrainz live calls are blocked locally.** The client throws before `fetch` when `MUSICBRAINZ_CONTACT` looks like a placeholder. Do not work around this guard.

**Job queue is drained** by `/api/cron/drain-jobs`, scheduled daily in `vercel.json`. Vercel's Hobby plan caps cron at once per day.

**Staging artwork URL issue — fixed.** A trailing tab in `NEXT_PUBLIC_SUPABASE_URL` produced a malformed URL the image optimiser rejected. Corrected in Vercel, and `storedArtworkUrl()` now trims whitespace and trailing slashes.

**Design reference screenshots** live in `docs/screenshots/` and are **gitignored** — 79 MB of third-party interface captures. The written analysis in `docs/design-reference.md` §3 is the artefact worth keeping.

---

## 11. Open decisions

See `docs/product-spec.md` §8 and `docs/data-model.md` §9 for the authoritative list.

- **Longer, jittered MusicBrainz backoff** (§9)
- **Whether Browse needs a length boundary at phone width** (§8) — a "show more" or a shorter chart, decided alongside the real charts rather than now
- **How many leading grid cells should carry `priority`** (§8) — one decision affecting every grid surface
- **Whether the daily cron should sweep for missing artwork and tracklists itself.** Both sweeps exist but nothing calls them automatically
- **Album page caching strategy** — decision H; the mixed catalogue/personal page needs investigation before Phase 2 builds on it
- **Whether `CLAUDE.md` line 5 should be updated** to reflect Phase 1 completion
- **Which phase direct messaging lands in** — the stated intent and `development-plan.md`'s phase numbering disagree (§12)
- **Every unresolved question in `docs/product-spec.md` §10** — Want to Listen behaviour, taste-overlap algorithm, profile photo and location handling, and the full messaging question set. Recorded as open _by design_; see §12
- Report reason categories (Phase 6)
- MBID merge handling, handle reuse after deletion
- Genre and tag data

---

## 12. Recorded product direction — decided, not implemented

New direction was recorded on 2026-08-18. **None of it is implemented.** Nothing below exists in schema or in code, nothing is scheduled into a phase, and no application code was written for any of it. The authoritative record is `docs/product-spec.md` §10; this is the pointer a resuming session will actually read first.

| Direction                            | State                                                                                                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Want to Listen**                   | Decided, and **schema resolved 2026-08-18** — independent relation, own table; the collection table needs no status column. **Generates a normal feed event.** Four questions remain, none blocking a migration |
| **Taste overlap / social discovery** | Decided as direction, in the spirit of Last.fm's compatibility notion. **Algorithm explicitly not decided.** Six questions unresolved                                                                           |
| **Profile photo, bio, city**         | Photo and bio were **already in scope**. Only city/location is new. Dating-specific fields **explicitly excluded**                                                                                              |
| **Direct messaging**                 | Decided — intended from the beginning of the social product, **not merely a possibility.** Unscheduled. Not required in the single-user collection phase. Blocked on legal research                             |

Four things a resuming session most often gets wrong about this list:

1. **Want to Listen generates feed events.** This is deliberate and departs from the volume argument that keeps likes and follows out of the feed. A per-user setting to hide that activity is anticipated but is **not** to be designed or accommodated in schema now.
2. **Messaging is intended, not hypothetical.** It reverses the earlier "should probably not exist" entry. The moderation concern was not dismissed — it became a blocking precondition instead.
3. **Dating functionality is excluded.** Relationship status, "looking", age and dating preferences are explicitly not part of the direction. Photo, bio and city exist for social legibility only.
4. **The unresolved questions must be asked, never inferred.** Answering one by picking a sensible default is the specific failure `product-spec.md` §10 exists to prevent.

### Two blockers recorded against messaging

**Legal research is a blocking precondition.** Current DSA and German/EU obligations for a small service hosting user-generated content and private messaging must be researched before any messaging code — legal requirements distinguished from good practice, current authoritative sources cited, anything needing professional legal advice flagged rather than presented as settled. Small does not mean exempt. Full brief in `product-spec.md` §10.4.

**Phase placement — clarified, and no longer a contradiction.** Messaging is desired from the beginning of the social product and is **not required in the single-user collection phase**. Phase 2 has no social graph, so messaging's absence there costs nothing; Phase 2 is not "too early", messaging is simply not part of what Phase 2 is. No phases were renumbered.

**What gates it is a precondition, not a phase number**, and the precondition is a **minimum viable safety and legal layer — not the whole of Phase 6**. The earlier reading, that messaging needed Phase 6's complete reports queue and admin tooling, is rejected. The legal research is what determines how large that layer actually is, and therefore where messaging can sit.

### One finding worth carrying

**Blocking and reporting already exist as decisions of record** (`product-spec.md` §4) — blocking cuts interaction in both directions and explicitly **does not hide content**. Messaging therefore does not force per-viewer visibility filtering into the all-public model, which is the expensive retrofit §7 warns about. It extends existing moderation scaffolding rather than inventing it. An earlier assessment in conversation overstated this cost before the decision was found; the documents were right and the assessment was wrong.

---

## 13. Phase 2, slice one — collection schema and service layer

Built and verified 2026-08-18. **No UI is wired to any of it**, deliberately: the data model and its invariants were proven before anything renders them.

### What exists

One migration, `20260818120000_create_collection.sql`: five tables, one function, one trigger, each with the `grant` block and RLS policies the Phase 0 convention requires.

| Table                | Holds                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| `collection_entries` | One row per user per album, permanently. Rating, like, relisten count, dates |
| `relisten_events`    | Discrete relistens. The source of truth behind the counter                   |
| `reviews`            | One-to-one with an entry, separately moderatable via `status`                |
| `favourite_albums`   | Up to ten pinned albums, independent of the collection                       |
| `want_to_listen`     | Intent. Independent of the collection; both may hold the same album          |

Service layer at `src/services/collection/` — core mutations, relistens, reviews, favourites, want-to-listen, and read-time rating aggregates. Every mutation requires a completed profile and returns `Result`.

### The four decisions taken in this slice

| Decision                                                 | Rationale                                                                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Favourites cap enforced in the database as well**      | The service check is racy under concurrency and provides the friendly error; the constraints are the invariant. See `data-model.md` |
| **`relisten_count` maintained by trigger**               | supabase-js has no multi-statement transaction API, so a service-layer counter is two round-trips that can drift and lose updates   |
| **`ensure_collection_entry` is `security invoker`**      | RLS still applies to callers, so the function is not a privilege-escalation path                                                    |
| **Direct writes to `collection_entries` are prohibited** | The clearing rule is a property of that one path, not of the schema. Migrations and tests are exempt                                |

The last one is the fragile invariant in this slice and is worth restating: **the Want to Listen clearing rule is enforced by convention, not by the database.** A trigger would make it self-enforcing but would also make it a schema property, which is the coupling the independence decision rejected. Not added. Revisit if a second writer appears.

### Tests

**11 unit** (121 total) — rating validation and one-decimal rounding, including that `0.0` survives a `if (!rating)`-shaped bug.

**39 integration** (150 total) — concurrent duplicate creation, idempotent implicit adds, the clearing rule and its scoping, coexistence created in the reverse order, the canonical path clearing the wishlist for all four implicit actions, relisten counter under twenty concurrent writes, review uniqueness and length, favourite independence and cap under concurrency, ownership as a second signed-in user, profile-required, cascade across all five tables, and averages across every rating case including `0.0` counting and nulls excluded.

One test bypasses `ensure_collection_entry` deliberately, to pin down what the schema does and does not guarantee. It is labelled a schema-contract test rather than a sanctioned pattern.

### Two things worth knowing before the next slice

**`coalesce(listened_on, added_at::date)` cannot be indexed** — casting timestamptz to date depends on the session time zone, so it is not `IMMUTABLE` and Postgres rejects it in an index expression. The collection sort is indexed on `added_at` with a companion index on `listened_on`. The interleaved ordering the collection view wants is not index-backed; at 338 albums that does not matter, and it becomes a Phase 5 question.

**The generated RPC type has `isSetofReturn: false`**, so calling `.single()` on `ensure_collection_entry` narrows the result to `never`. Typecheck catches it; it cost a build to discover.

---

## 14. Lessons carried forward

**A returned failure is not a raised failure.** This cost the most, twice. `fetchAndStoreArtwork` returns `{ status: 'failed' }` rather than throwing, and ingestion returned `null` for a failed tracklist. Both are right for their immediate caller and wrong for the one that owns retrying — nothing threw, no job failed, and 36 albums plus 44 tracklists were quietly never retried.

**Encode the distinction in the type.** `MappedRelease | null` could not express "no tracks" versus "no answer". A discriminated union made the bug impossible to reintroduce; a comment would not have.

**Capture the evidence before theorising about upstream.** One captured 503 body settled in a single request what two sessions of reasoning from status codes could not — and disproved the leading hypothesis.

**A shared bucket is not your bucket.** Reading `remaining` without reading its zone would have led straight to throttling a client already nine times under the limit.

**Metrics that exclude failures lie**, and **fixing a metric does not fix the rows it already mismeasured.**

**Count the right noun.** "68 artwork failures" and "36 albums without artwork" were both true — one counts failed requests during a run, the other albums in a final state.

**Sweep the right population.** Only representative releases ever get a tracklist; a query written against status alone would have queued thousands of jobs where dozens were wanted.

**Foreign keys decide who can act.** `catalogue_additions.user_id` references `profiles`, which quietly made un-onboarded users both unauditable and unrateable.

**Inspect the render, not the test result.** Green tests said the search fallback panel was captured; the screenshot showed a signed-out page, because the login step's URL assertion matched `/login` itself. Several design errors — a 720px primary button at tablet width, an avatar initial taken from the handle instead of the displayed name, a grid silently capped at 928px by a parent — were visible only in the image.

**Verify from a clean tree.** `PageProps`/`LayoutProps` are generated into `.next/types`; a stale directory made typecheck pass locally and fail in CI.

**Several failures looked like product bugs and were not.** An ambiguous PostgREST embed (name the key). A `fetch` stub that replaced the global. Next 16's local-IP image restriction. A tab in an environment variable. A readiness check that raced a migration.

**Testing conventions.** Unit tests are pure logic. Integration tests use the local database and refuse any non-local URL. Seeding and backfills use a separate vitest project whose setup permits remote targets and names them. No test makes a live MusicBrainz, ListenBrainz or Cover Art Archive call.

> **⚠️ `npm run test:integration` deletes all catalogue data.** It truncates `albums` and `artists` between cases. Never run it against a seeded database.
