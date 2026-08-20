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

Verified against the staging database and a clean-tree build on 2026-08-19.

**Phase 1 implementation is complete.** **The design foundation is complete.** **Phase 2 is in progress:**

| Slice                                    | State                                            |
| ---------------------------------------- | ------------------------------------------------ |
| Collection schema and service layer      | **complete and committed** (`7ce0851`)           |
| Add / remove collection, wired to the UI | **complete and committed** (`da83b82`)           |
| Rating                                   | **complete and committed** (`8256aa0`)           |
| Like                                     | **complete and committed** (`957cf5f`)           |
| Relisten                                 | **complete and committed** (`e40874a`)           |
| Review service corrections               | **complete and committed** (`0715c50`)           |
| Review interface                         | **complete and committed** (`c486093`)           |
| Profile collection surface               | **complete and committed** — see §18             |
| Favourites (profile row + album toggle)  | **complete and committed** (`895e018`)           |
| Want to Listen (album card)              | **complete and committed** (`badc816`) — see §20 |
| Optional `listened_on` date on add       | **complete and committed** (`cc8018a`) — see §21 |
| Artist page date sorting                 | **complete and committed** (`e1daffc`) — see §22 |

Lists, follows, activity, feed, notifications, messaging, taste overlap and profile photo/city do not exist, in schema or in code. **Favourites are built** — a row on the profile overview and a toggle on the album card — but **no favourites destination and no reordering interface exist**. **Want to Listen now has an album-card toggle** and nothing else: **no profile surface, no route, no tab, no heading, no placeholder**. Both destinations are named in `product-spec.md` §6 so the paths are decided; naming a path is not scheduling the surface, and neither has been built.

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
| Unit + component | **153**                                               |
| Integration      | **332** (need a local database)                       |
| Seed             | **1**                                                 |
| End-to-end       | **55** (Playwright)                                   |
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

**Ten migrations applied; local and staging are in sync**, confirmed with `npx supabase migration list --linked` on 2026-08-19. Two were pushed to staging that day: `20260818120000_create_collection`, and `20260819100000_clear_wishlist_on_create_only` correcting the clearing rule (§15). Staging can be queried read-only with `npx supabase db query --linked "<sql>"`, which is how these numbers were checked.

### Git state

**`HEAD` and `origin/main` are both `e1daffc`.** The working tree is clean, nothing is uncommitted, and the branch is neither ahead nor behind. The design foundation and every Phase 2 slice through artist date sorting are committed and pushed:

| Commit    | Slice                                                 |
| --------- | ----------------------------------------------------- |
| `c486093` | Review interface, plus the auth-row cleanup fix       |
| `7dd8260` | Collection read path on the profile                   |
| `b2aff93` | Profile collection surface — overview and destination |
| `895e018` | Favourites — profile row and album-card toggle        |
| `badc816` | Want to Listen on album actions                       |
| `cc8018a` | Optional `listened_on` date on add                    |
| `e1daffc` | Artist discography date sorting                       |

`e1f29c3`, earlier, recorded the Want to Listen profile-visibility decision and changed no code.

**CI run #41 on `e1daffc` is green** — both jobs succeeded in 594s, every step passed, and no retry was consumed. It executed **153 unit and component, 332 integration, 1 seed and 55 end-to-end** tests on Node 22, matching the local `verify:full` exactly. That run is the first to exercise Want to Listen, the `listened_on` date and artist sorting together, and the first on Node 22 rather than the local Node 20; the three commits were pushed as one fast-forward, so they share a single run rather than having one each.

The counts in §1 are therefore the **committed and CI-verified state of `e1daffc`**, not of a working tree.

The habit of leaving implementation uncommitted while documentation lands ahead of it is deliberate, but it has a cost worth naming: for several checkpoints this paragraph described a working tree that no longer existed. A checkpoint that describes the wrong tree is worse than one that says nothing.

**Local database is clean** — zero auth users, profiles, collection entries, wishlist rows and favourites; seven fixture albums from `npm run db:seed:fixtures`. Every suite deletes the accounts it creates, and deletion cascades to every user-authored row.

**Staging is untouched by both the Favourites and Want to Listen work** — 338 albums, 241 artists, 6,388 releases, 4,751 tracks, 3 profiles, 11 relisten events, 2 reviews, **0 favourites and 0 wishlist rows**. The `@darryl` fixture (§19) is exactly as approved.

**Collection entries stood at 13 on 2026-08-20**, which is the twelve-row fixture plus one album added by hand through the deployed app (_Born to Die_, unrated, 2026-08-20 09:53 UTC). **That count moves whenever the maintainer uses staging, and is not a number to assert from memory** — read it before quoting it. The fixture itself is unchanged.

No branch protection — GitHub gates it behind a paid plan for private repositories, and that was declined. **`rm -rf .next && npm run verify:full` before pushing is the compensating control**, per `CLAUDE.md`; an earlier version of this line said `verify`, which is the fast loop and does not run Playwright.

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

| Item                                                     | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `absent` artwork unobserved against real CAA data        | §4 — verify opportunistically; do not manufacture it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Synthetic catalogue rows in integration tests**        | **RESOLVED before `895e018`, and recorded so it is not re-litigated.** A draft of the favourites cap test inserted eleven minimal `albums` rows, because the fixture catalogue yields seven and a user may pin an album only once. It was removed on instruction: the rule _"do not manufacture catalogue records"_ applies to the whole slice, not only to end-to-end tests. The cap is now proven on the **position range** instead — every slot 1-10 accepted, 11 and 0 refused, each taken slot exclusive, concurrent inserts contesting one slot leaving one row — which needs no eleventh album because ten slots, not ten albums, are what bound the table. `createAlbums` no longer exists |
| **One pre-existing direct catalogue insert**             | `tests/integration/search.test.ts:44` writes `albums` rows directly. It predates the collection work, is unrelated to Favourites and Want to Listen, and was deliberately left alone rather than swept up in an unrelated slice. **The only such insert in the suite** — every other test builds its catalogue through `ingestReleaseGroupPayload` with real fixtures                                                                                                                                                                                                                                                                                                                              |
| Two exhausted artwork jobs (CAA 502)                     | §4 — deliberate sweep whenever wanted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Live album never observed                                | §3 — soundtrack covers the secondary-type path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Longer, jittered MusicBrainz backoff**                 | **[OPEN]** — see §9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `"Added — view"` unreachable                             | After a successful add the page revalidates and the upstream row unmounts before its `useActionState` can render the link. Harmless; the album appears in local results                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Staging rejects `@example.com` on public signup          | GoTrue validates the domain on self-signup but not via the admin API, so `tests/e2e/auth.spec.ts` would fail against staging                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Email confirmation disabled on staging                   | Turned off deliberately so signup works without SMTP. **Production must have it on**, which means real SMTP configured before launch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Three test accounts on staging                           | Two own `catalogue_additions` rows; deleting them nulls `user_id` and leaves the rows as anonymous audit records, which is the designed behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Local Node drifted to v20                                | CI pins Node 22. `@supabase/supabase-js` needs a global WebSocket, so integration and seed commands need `NODE_OPTIONS=--experimental-websocket` until the local runtime is restored                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Artists have at most 3 releases                          | The seed capped at 2 per artist, so the deep-discography case is untested against real data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Design-foundation code uncommitted                       | §1 — verified clean-tree at every step, held for review                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ~~Integration tests leak local auth rows~~               | **RESOLVED 2026-08-19, and the attribution was wrong.** It was never the integration suite: measured from an empty `auth.users`, a full run of 253 tests across 15 files returns it to **zero**. The leak was entirely `tests/e2e/auth.spec.ts`, which created three real users per run and had no cleanup hook at all — three runs had left exactly nine rows. Fixed in `c486093` with the pattern `collection.spec.ts` already used, and confirmed at zero after a full `verify:full`                                                                                                                                                                                                            |
| **Intermittent sign-out failure in `auth.spec.ts`**      | **[OPEN] — flaky, cause not established.** One of **two** unexplained flakes now on record; the other is the row below, and neither has been reproduced deliberately. One run of `verify:full` failed `sign up, choose a handle, sign out, sign back in` on a 30s test timeout: the click on Sign out landed, but the header never swapped to the signed-out state. **Not reproduced in four subsequent runs**, including a cold-`.next` run and two full `verify:full` runs, so cold compilation was tested and ruled out. Unrelated to the review and collection slices — it predates both. Watch it; do not "fix" it with a longer timeout until the cause is known                             |
| **Intermittent timeout in `collection-actions.test.ts`** | **[OPEN] — flaky, cause not established.** One `verify:full` failed a single test in that file on the 15s budget the file sets for itself, with the whole file taking **82s where it takes 11s alone**. Integration files run sequentially (`fileParallelism: false`), so this is not parallel contention between files. Passed in isolation, in a full integration run, and in two subsequent `verify:full` runs. The machine had been running Docker, a dev server and Playwright all session, which is a plausible cause and not a demonstrated one. **The file was not modified by the slice that observed this.** Watch it; **do not raise the budget to make it go away**                    |
| **Browse is very tall at phone width**                   | **[OPEN]** — 8,122px at 390px. `relaxed` is 2-up on a phone, so Popular's 24 captioned albums run 12 rows before Recently added begins. Observation, not a defect: consistency with the migrated artist page was the stronger constraint, and the alternatives were changing the query limit or inventing a per-breakpoint density. Revisit when the real charts arrive and a "show more" boundary has to be decided anyway                                                                                                                                                                                                                                                                        |
| **`AlbumGrid` passes no `priority`**                     | **[OPEN]** — Next flags the first Popular cover as LCP and asks for eager loading. Pre-existing and identical on the artist page. Deliberately not fixed during a presentation-only migration: choosing how many leading cells get `priority` is its own decision and it affects every grid surface at once                                                                                                                                                                                                                                                                                                                                                                                        |

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
- **Every unresolved question in `docs/product-spec.md` §10** — remaining Want to Listen behaviour, taste-overlap algorithm, profile photo and location handling, and the full messaging question set. Recorded as open _by design_; see §12
  - **Two Want to Listen questions are no longer among them.** Profile visibility resolved 2026-08-19 (public, own profile tab), and **whether the interface should offer Want to Listen on an already-collected album resolved 2026-08-20 — yes, it is offered in every collection state** (§20). The remaining two are whether _removing_ generates a feed event and whether Want to Listen feeds discovery or popularity ranking, plus the separate feed-hiding question. All three are Phase 3 or later and none is reachable while Activity does not exist
- Report reason categories (Phase 6)
- MBID merge handling, handle reuse after deletion
- Genre and tag data

---

## 12. Recorded product direction — decided, mostly not implemented

New direction was recorded on 2026-08-18. **None of it is implemented.** Nothing below exists in schema or in code, nothing is scheduled into a phase, and no application code was written for any of it. The authoritative record is `docs/product-spec.md` §10; this is the pointer a resuming session will actually read first.

| Direction                            | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Want to Listen**                   | Decided, and **schema resolved 2026-08-18**. **Profile visibility resolved 2026-08-19 — public, own profile tab** (`Collection \| Want to Listen \| Favourites`); **the already-collected question resolved 2026-08-20 — offered in every collection state.** The **album-card relation is now built** (§20); the profile surface is not, and the visibility decision does not schedule it. **Generates a normal feed event** — decided, unbuildable, Activity does not exist. Two questions remain, plus feed hiding |
| **Taste overlap / social discovery** | Decided as direction, in the spirit of Last.fm's compatibility notion. **Algorithm explicitly not decided.** Six questions unresolved                                                                                                                                                                                                                                                                                                                                                                                 |
| **Profile photo, bio, city**         | Photo and bio were **already in scope**. Only city/location is new. Dating-specific fields **explicitly excluded**                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Direct messaging**                 | Decided — intended from the beginning of the social product, **not merely a possibility.** Unscheduled. Not required in the single-user collection phase. Blocked on legal research                                                                                                                                                                                                                                                                                                                                   |

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

## 14. Phase 2 progress and staging schema state

### Slices delivered

**Add and remove**, wired to the album action card (`da83b82`). All five card states render from real session and collection state. Removal semantics were locked on 2026-08-19 after being found unspecified: the review and relisten history are deleted by cascade and **the interface warns first**, naming what this particular removal destroys; favourites and Want to Listen are untouched, because the clearing rule runs one way only.

**Rating.** Numeric input, never stars. 0.0-10.0 to one decimal, `0.0` a real score, unrated is `null`. Rating an uncollected album collects it through the canonical path, which clears Want to Listen and writes no activity event. Clearing a score returns the entry to unrated without leaving the collection. The album average is computed on read and rendered as a bare numeral beside the user's own score as a brass chip — `ScoreBadge`'s two variants, which exist for exactly that separation.

Three defects in the rating slice were found by running it rather than by reading it, and are worth remembering as a class:

- **Clearing silently re-saved the score.** The clear button and the input shared the field name, and `FormData.get` returns the first entry, so the input's value won. Clearing now carries its own intent. **Only the end-to-end test could have caught this** — every integration test passed throughout.
- **The control stayed open after a save**, showing a stale value, because the card's kind does not change on a rated-to-rated edit and React preserves component state. It is now keyed to the confirmed score.
- **The expanded form squashed a sibling control into a sliver.** Visible only in a screenshot.

### Verification

CI runs the full path — format, lint, typecheck, unit tests, build, integration against a real database, fixture seed, then Playwright. `npm run verify:full` runs the same sequence locally and is now the documented pre-push check; `npm run verify` remains the fast loop. That distinction exists because `verify` alone let a commit break two end-to-end assertions and leave `main` red for three commits.

### Staging schema

**The collection migration was applied to staging on 2026-08-19** and verified rather than assumed:

| Check                     | Result                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Five tables present       | `collection_entries`, `relisten_events`, `reviews`, `favourite_albums`, `want_to_listen`               |
| RLS                       | enabled on all five, two policies each                                                                 |
| Grants                    | `anon` select; `authenticated` write; `service_role` full                                              |
| `ensure_collection_entry` | present, `security invoker` — not a privilege-escalation path                                          |
| `sync_relisten_count`     | present, `security definer`                                                                            |
| Catalogue                 | **unchanged** — 338 / 241 / 6,388 / 4,751, identical to the pre-apply baseline                         |
| Collection rows           | zero at the time of that check. **No longer true — see §19**, which records the deliberate fixture     |
| Deployed app              | album, browse, profile, login and signup all 200; `/onboarding` still redirects to `/login` signed out |

**That was true when written and is not true now.** Staging carries a deliberate design fixture on one account — see §19. The integration suite still cannot reach staging: `tests/setup/integration.ts` throws on any non-localhost URL, because those tests truncate tables.

One observation, not a finding: `anon` holds `TRUNCATE`, `TRIGGER` and `REFERENCES` on the new tables. That is a **project-wide Supabase default** — `albums` and `profiles` carry exactly the same set — and was not introduced by this migration. RLS is what actually constrains access.

---

## 15. Review readiness — decisions and service corrections

Reviews are **not implemented**: no UI exists, and the three `Write a review…` / `Edit review…` links in the action card remain inert. What follows are decisions taken and defects fixed **before** building anything, in response to a readiness review on 2026-08-19.

### Three decisions

| #   | Decision                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **An author deleting their own review is a hard delete.** `status = 'removed'` stays a moderation state and is not the mechanism for ordinary author deletion. **No third status, no `removed_by` column** — the two are distinguished by which code path runs |
| B   | **Editing preserves review identity.** `id` and `created_at` survive an edit; only `body` and `updated_at` change. No edit history, no versioning                                                                                                              |
| C   | **The clearing rule fires on creation, not on invocation.** Creating a collection entry clears Want to Listen; calling `ensure_collection_entry` for an album already held clears nothing                                                                      |

**B is load-bearing rather than cosmetic.** Phase 3 hangs review likes, notifications and reports off the review id. A delete-and-insert would satisfy every visible behaviour and silently orphan all three, so it is pinned by test rather than left to whoever next simplifies the query.

### One migration

`20260819100000_clear_wishlist_on_create_only` rewrites `ensure_collection_entry`. The original deleted the wishlist row unconditionally, so for an album already in the collection **any** rate, like, review or relisten destroyed a Want to Listen row it had no business touching — silent loss on a relation the independence decision deliberately keeps separate.

The fix turns the upsert's `do update` into `do nothing`, which is what makes the two cases distinguishable: a returned row means this call created the entry, an empty result means it already existed. A `do update` returns a row either way and cannot tell them apart. Everything else is unchanged — still the single sanctioned path, still `security invoker`, still never overwriting a `listened_on` the user set, still creating no activity event.

**Applied to staging on 2026-08-19** and verified by reading the deployed definition back with `pg_get_functiondef`: the insert uses `on conflict … do nothing`, the early return guards on `entry.id is null`, and the function is still `security invoker`. The catalogue was unchanged by the migration — 338 / 241 / 6,388 / 4,751, identical to the pre-apply baseline — and all five collection tables remain empty.

Behaviour was verified statically rather than by exercising it, deliberately: proving the create-only path by running it would have meant writing collection and wishlist rows into staging, and staging holds no user data on purpose.

### Two service defects fixed

**`deleteReview` no longer calls `ensureEntry`.** It used to, so deleting a review you did not have, on an album you did not hold, created a collection entry and cleared your wishlist. It now looks the entry up and does nothing when there isn't one.

**`getAlbumReviews` carries author identity.** It previously returned no handle, display name or avatar, which made the result unrenderable — a review with no one attached to it. The embed reaches `profiles` through `collection_entries.user_id`; only one relationship exists between those tables, so it needs no disambiguation. **Moderation visibility is unchanged**: live reviews are public, removed ones remain readable only by their author.

### Still open before the UI is built

None of these blocks the service work, and none affects the schema.

| Question                                              | Recommendation offered, not adopted                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| Edit interaction — immediate, or explicit save/cancel | Explicit save/cancel, counter only near the limit                     |
| Is `status = removed` shown to its author             | Moderation-only for now; revisit with Phase 6                         |
| Activity on edit and delete                           | Unspecified; §8.5 covers creation only. Answer before Phase 3         |
| URLs in review text                                   | Plain text, no autolinking                                            |
| Profile review activity                               | Album page first; profile when it gains its overview                  |
| Editor accessibility                                  | Labelled textarea, `aria-describedby`, `role="alert"`, no unload trap |
| Client-side length enforcement                        | `maxLength` plus the server check                                     |

One wrinkle worth remembering on the last: HTML `maxLength` counts UTF-16 code units while Postgres `char_length` counts code points, so a review heavy in astral characters would be blocked by the client while the server would accept it. That is the safe direction — it cannot lose writing — but the client is slightly stricter than the rule.

---

## 16. Review slice — implemented, verified and **committed**

Built and committed 2026-08-19 as `c486093`. Everything below has been exercised, not assumed.

### Verified state at the point of commit

| Suite            | Count   |
| ---------------- | ------- |
| Unit + component | **121** |
| Integration      | **241** |
| Seed             | **1**   |
| End-to-end       | **11**  |

`rm -rf .next && npm run verify:full` — **green**, all four suites.

Write, edit, delete and the public list are each verified end to end: writing about an uncollected album collects it and clears Want to Listen, the editor prefills with what is already there, deletion warns first and leaves the album collected, and the album page lists other people's live reviews.

### Decisions implemented

| Decision                                                                                                 |
| -------------------------------------------------------------------------------------------------------- |
| **Author deletion is a hard delete.** `status = 'removed'` stays a moderation state                      |
| **Review identity is stable across edits** — `id` and `created_at` survive, `updated_at` moves           |
| **Explicit Save and Cancel**, never save-as-you-type                                                     |
| **The character counter is hidden** until the last 500 characters                                        |
| **`maxLength={10000}`** on the field, on top of the service check and the check constraint               |
| **Whitespace-only is rejected**; the stored body is trimmed                                              |
| **Plain text only** — no Markdown, no automatic URL linking                                              |
| **A removed review gets no special author-facing presentation** in this phase                            |
| **Review creation will eventually produce an Activity event.** Activity does not exist and was not built |

Three enforcement points for the length limit is deliberate: the field and the service produce a message a person can act on, and the constraint is the guarantee. Rejecting whitespace-only is a **service** rule — `char_length('   ')` is 3, so the constraint alone would store a blank review, and an integration test documents that gap so nobody removes the check believing the schema covers it.

Rendering is `whitespace-pre-wrap` with React's default escaping. `dangerouslySetInnerHTML` appears nowhere in the codebase except two comments forbidding it.

### One bug worth remembering

**The editor stayed open after a saved edit**, showing a stale draft, because the card's kind does not change on an edit and React preserved the component's state. It is now keyed on the server-confirmed `updated_at`, which is why the collection-state read returns it.

This is the **second** time this exact failure has appeared — the rating control had it too — and both times **only the end-to-end test caught it** while every integration test passed. Any future disclosure control on this card should be assumed to have it until proven otherwise.

### Test-infrastructure changes, not product changes

`tests/e2e/auth.spec.ts` also gained the account cleanup it never had — see §8. That file created three real users per run and deleted none, which is the whole of the local `auth.users` growth previously recorded against the integration suite.

`tests/e2e/auth.spec.ts` gained a scoped 15s budget on the navigations that follow a server action. **No assertion, expectation or test was changed** — a timeout argument was added to existing `toHaveURL` calls.

Sign-up, handle claim and sign-in each round-trip to GoTrue and then redirect. That test measured 5.7s in isolation against Playwright's 5s per-assertion default, so growing the suite from 9 to 11 auth-creating tests pushed it over. The **test** timeout stays at Playwright's 30s default, so a flow that genuinely hangs still fails. Same shape as the integration timeout scoping in `4ee628d`: tight defaults, longer only where real auth work happens.

### Deferred

**The review editor is cramped at large desktop widths.** It opens inside the action card's `max-w-sm` aside — roughly a 340px column for a field capped at 10,000 characters. Fine for the short reviews `product-spec.md` §8.7 anticipates, cramped for an essay. Opening it full-width in the main column instead is a composition change and a deliberate decision, not a tweak. **Explicitly not to be changed** as part of this slice.

### Not implemented

The Want to Listen interface, Activity, review likes, reports, notifications, messaging, taste overlap, and profile photo or city. None existed in code at this point, and Favourites did not either — it landed later, after the profile collection surface.

---

## 18. Profile collection surface — implemented, verified and committed

Built 2026-08-19. Two surfaces, not one: the profile became an **overview**, and the full collection moved to its **own destination**.

### Verified state

| Suite            | Count   |
| ---------------- | ------- |
| Unit + component | **136** |
| Integration      | **259** |
| Seed             | **1**   |
| End-to-end       | **22**  |

`rm -rf .next && npm run verify:full` — green, all four suites. Inspected at 390, 768 and 1440px signed out, with a populated collection, an empty one, and across page boundaries; no horizontal overflow at any width.

### What it is

| Surface                | What it holds                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `/<handle>`            | Overview — identity, then a **12-album preview** whose count links onward when there is more |
| `/<handle>/collection` | The full collection — **60 per page**, `?page=n`, `← Newer · Page n of m · Older →`          |

Both render through the existing `CollectionGrid` and `CollectionTile`. **No new grid and no new density value.** Both take the `wide` container (§11.8 of `design-reference.md`), which moved covers from **83px to 104px** at 1440 — the ~105px `standard` was always meant to reach.

`listCollection(userId, { limit, offset })` returns `{ items, total }` from one query using `count: 'exact'`, so the preview's count and the destination's page count arrive with the rows.

**`limit` is a required parameter, deliberately.** The first version had no limit at all, so a 400-album account would have rendered 400 covers on the profile root. The bound is now in the type rather than in a reviewer's memory.

### Decisions implemented

| Decision                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Default ordering is `added_at desc`** — never `coalesce(listened_on, added_at)`. The collection answers "what have I most recently added", a fact about the account; `listened_on` is a backdatable claim      |
| **`listened_on` is untouched** and stays available for explicit sorting, which is a later slice                                                                                                                  |
| **The collection draws artwork plus a state line — score, like, `×N` — and no captions** (`design-reference.md` §11.9). Compact is the locked default; there is **no density control**, and that deferral stands |
| **No tab bar, and no Favourites or Want to Listen anything.** No route, no tab, no heading, no placeholder — only the documented placement in `product-spec.md` §6. One tab is not a tab bar                     |
| **Out-of-range pages 404** rather than clamping. A URL that renders page 3 while claiming page 9 is worse than one that admits it is gone                                                                        |
| **No stat cluster.** The album count sits on the section header, where it counts something that exists                                                                                                           |
| **`TileAlbum.year` widened to `number \| null`** — carried but rendered in neither mode, and real albums may hold no release date                                                                                |

**The ordering decision is index-backed, which is worth knowing.** `collection_entries_user_idx` is `(user_id, added_at desc)` — exactly this query. The coalesce ordering cannot be indexed at all, because casting timestamptz to date is not `IMMUTABLE` and Postgres rejects the expression. The correct ordering is also the cheap one; that is a coincidence, but a load-bearing one if the default is ever revisited.

### The density toggle — considered, built, and explicitly deferred

A user-facing Compact / Detailed switch was built during this work and **removed by decision.** It is not deferred by oversight and should not be reintroduced without one: a density switch is a **product control**, and adding one as a side effect of building a read path decides a question nobody asked.

**What made removing it safe was giving Compact the state line.** The original objection to Compact-only was real — score, like and relisten markers rendered only in Detailed, so a profile showed what someone held and nothing about what they thought of it, which is the whole difference between a collection and the catalogue. §11.9 of `design-reference.md` resolved that without a control: Compact now carries the state line, and Detailed keeps the captions it was always about.

An end-to-end test pins both halves — the markers appear, the captions do not, and no density link exists — so reintroducing a control or flipping the default fails loudly rather than shipping a postponed decision by accident.

Detailed remains in the design system and in the gallery at `/design`. **No product surface uses it.**

### Where marker correctness is covered

All three levels, now that a surface draws them:

- **Unit** — `toCollectionListItem`: `0.0` surviving as a real score, a null release date, artwork `found` versus `absent`/`failed`/`pending`, relisten counts.
- **Integration** — the rows: rated versus unrated with `0.0` distinguished from null, liked versus unliked, the trigger-maintained relisten count, and that one user's state never appears in another user's row.
- **End to end** — the rendered tile: each marker on its own album and no other, `0.0` drawn as a score, **`×1` not drawn at all**, an album with no state drawing no line, and no artist credit anywhere on the surface.

### Two bounds are not covered end to end

The overview previews 12 and the destination pages at 60. **The local fixture catalogue holds seven albums**, so no account a test can build exceeds either bound, and expanding the catalogue to manufacture the case was explicitly ruled out.

Covered instead: the windowing at the query level in `tests/integration/collection-list.test.ts` — pages tile the collection with no gaps or repeats, and the count reports the whole collection rather than the window — plus the small-end behaviour end to end: the count staying plain text when everything already fits, pagination not rendering on a single page, `?page=2` returning 404, and `?page=0` and `?page=abc` resolving to the first page. The constants themselves are pinned in a unit test.

Rendered pagination was inspected by temporarily setting both constants to 3, capturing all three widths, and reverting.

### A bug only the browser could find

`?page=2` on a one-page collection returned **500, not 404.** PostgREST answers an out-of-range offset with an error — `PGRST103`, "Requested range not satisfiable" — rather than an empty window, and the service re-threw it.

An integration test had been written asserting that query returns `[]`. **It does not**, and that test now pins the real contract so nobody deletes the fallback believing otherwise. The count does not come back on the failing response, so the fallback re-reads the total: one extra round trip in the rare case, happy path unchanged.

This is the third time in Phase 2 that every integration test passed while the browser found the defect. The other two were disclosure controls holding stale state.

### One test deleted rather than kept

A component test for `CollectionTile` was written to cover marker rendering, and removed. **The `component` vitest project has never run a file** — it matches `src/**/*.test.tsx` and no such file existed — and adding the first one surfaced that **jsdom cannot load on the local Node 20**: `html-encoding-sniffer` requires an ES module, which needs Node 22.12 or later. CI pins Node 22, so it may well pass there, but a test that cannot run locally breaks the documented development loop.

Fixing that is test-infrastructure work, not part of a read path, so the test was removed rather than left broken or committed unverified. **The `component` project is configured and non-functional on the local runtime** — worth knowing before anyone writes the first component test.

### Not implemented

Sorting, filtering, inert tabs, a stat cluster, Activity, and the density control — none of which this slice built, and none of which renders anything today. **Favourites and Want to Listen were not built by this slice either**; both landed afterwards — the favourites row on the overview with `895e018`, and the Want to Listen card toggle in the uncommitted slice at §20.

---

## 19. Staging design fixture — `@darryl`, deliberate

Created 2026-08-19, deliberately, and recorded here so nobody mistakes it for user data or deletes it as debris.

**`@darryl` (`3ee7bc2a-…`) is intentional staging fixture data. It is not production data and it is not a real user's collection.** It exists so design work on collection surfaces can be judged against real cover art at real densities, which is exactly what the review that prompted it could not do.

### What it is designed to exercise

Twelve entries, chosen so every state a tile can render is present at least once and every state that must **not** render is present too.

| Album                     | Rating  | Liked | Relistens | Review | `listened_on` | Exercises                                         |
| ------------------------- | ------- | ----- | --------- | ------ | ------------- | ------------------------------------------------- |
| Nevermind                 | 8.2     | —     | 0         | —      | —             | the original hand-made row, newest by `added_at`  |
| OK Computer               | 9.6     | ✓     | 3         | ✓      | —             | every marker at once, plus a review               |
| Kid A                     | 8.8     | ✓     | 0         | —      | —             | rated and liked                                   |
| In Rainbows               | 7.4     | —     | 1         | —      | —             | **`×1`, which must not be drawn**                 |
| The Dark Side of the Moon | **0.0** | —     | 0         | —      | 1973-03-01    | **a real `0.0`**, and a backdated listen          |
| Abbey Road                | —       | ✓     | 0         | —      | 1969-09-26    | **liked but unrated**, and a backdated listen     |
| Illmatic                  | 9.1     | —     | 2         | ✓      | —             | a second review, relistens without a like         |
| Discovery                 | —       | —     | 0         | —      | —             | **no state at all** — the tile that draws no line |
| AM                        | 6.5     | —     | 0         | —      | —             | a plain middling score                            |
| Blonde                    | —       | —     | 4         | —      | —             | **heavily relistened but never rated**            |
| DAMN.                     | 8.0     | ✓     | 1         | —      | —             | rated, liked, and `×1` again                      |
| Unknown Pleasures         | 5.0     | —     | 0         | —      | 1979-06-15    | a third backdated listen                          |

**The backdated listens are load-bearing, not decoration.** Three entries claim listens from 1969, 1973 and 1979 and sit in the middle of the ordering, because the collection sorts on `added_at`. The fixture is therefore a standing check that ordering ignores `listened_on`: if that ever regresses, those three jump to the end and the profile visibly reshuffles.

**`0.0` is the other one.** The lowest score in the product is falsy, and it sits on a famous cover where a wrong render is obvious at a glance.

### How it was written, and what it did not touch

Entries were created through `ensure_collection_entry` — the single sanctioned path — rather than by direct insert, and relisten counts come from inserting `relisten_events` and letting the trigger maintain the counter. Verified before and after:

|                                      | Before                    | After         |
| ------------------------------------ | ------------------------- | ------------- |
| Albums / artists / releases / tracks | 338 / 241 / 6,388 / 4,751 | **unchanged** |
| Profiles                             | 3                         | **3**         |
| Collection entries                   | 1                         | 12            |
| Relisten events                      | 0                         | 11            |
| Reviews                              | 0                         | 2             |
| Favourites / Want to Listen          | 0 / 0                     | **0 / 0**     |
| Entries on any other account         | 0                         | **0**         |

**No catalogue row was created, updated or deleted, and the other two staging profiles were not touched.**

### Standing rules for it

- It may be extended for design work. Use existing catalogue albums; never write catalogue data to make a fixture look better.
- If a state stops being exercised because the fixture changed, update the table above in the same pass.
- It is not a substitute for tests. It exists to be **looked at**, and the suites still own correctness.
- **The account also receives real hand-adds.** `@darryl` is the maintainer's own staging account, so rows appear on it that are not part of this fixture — _Born to Die_ on 2026-08-20, for one. A row count higher than twelve is expected and is not fixture drift; the twelve above are identified by album.

---

## 20. Want to Listen — implemented, verified and committed

Built and committed 2026-08-20 as `badc816`. The album card gains a Want to Listen toggle. **Nothing else** — no profile surface, no route, no tab.

### Verified state

| Suite            | Count   |
| ---------------- | ------- |
| Unit + component | **144** |
| Integration      | **310** |
| Seed             | **1**   |
| End-to-end       | **41**  |

`rm -rf .next && npm run verify:full` — exit 0, all four suites. Inspected at 390, 768 and 1440px across all three collection states: no horizontal overflow, and the two chips in the independent-relation row never wrap.

### What the relation does

|                               |                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Independent of the collection | Wanting an album creates no collection entry; unwanting removes none                                  |
| Coexists with membership      | An album may be collected **and** wanted at once, and the card offers it in every collection state    |
| Reachable while uncollected   | Wanting does not collect, so `not-collected` stays `not-collected`                                    |
| Touches nothing else          | No rating, like, favourite, relisten or review is read or written                                     |
| Mutations                     | `addWantToListen` / `removeWantToListen`, never Supabase from the UI, never `ensure_collection_entry` |
| Per-album read                | `getMyWantToListen(albumId)`, mirroring `getMyFavourite` — returns the row or null                    |
| Form pattern                  | Desired-next-value in the form, as for Like and Favourite, so a stale page cannot toggle twice        |
| Collection state model        | **Unchanged** — still five kinds; `wanted` is an orthogonal prop beside `favourited`                  |
| Activity                      | **None.** Additions are decided to generate a feed event, but Activity does not exist                 |

### The one-way rule, unchanged and not reframed

`ensure_collection_entry` remains the sanctioned application path for creating a collection entry, and it is where the clearing rule lives. Nothing in this slice duplicates or relocates it.

- Creating a collection entry **clears** that album's Want to Listen row.
- Merely acting on an entry that already exists clears **nothing** — the trigger is creation, not invocation.
- Creating a wishlist row **never** removes collection membership.

**This is not mutual exclusion, and must not be read as it.** The two relations may legally hold the same album at once; the common path simply does not produce that state, because collecting clears the wish on the way in. Wanting an album you already hold is legal, reachable from the card, and covered by test.

### The ActionCard decision — an implementation choice, not a product decision

The product decisions taken on 2026-08-20 were two: **offer Want to Listen on an already-collected album**, and **make it reachable while uncollected**. Everything below is how that was drawn, and was not previously locked by any document.

- **Want to Listen joins Favourite in the existing quiet-action row**, rather than taking a fourth row. That row already draws the card's one real boundary: Rate, Like and Relisten create a collection entry implicitly (`product-spec.md` §8.5); Favourite and Want to Listen never do.
- Both are visually distinct from the collection-creating actions by sitting on the other side of that boundary, and the `not-collected` note now reads for both: _"Neither of these adds it to your collection."_
- **Neither uses a heart.** That glyph already means _liked_ on collection tiles; a second one here would blur three relations rather than two.
- `aria-pressed` carries state; active and inactive follow the established quiet-action treatment — brass on active, neutral otherwise.
- **Copy, chosen here and not documented elsewhere:** inactive **"Want to listen"**, active **"On your list"**. "Wanted" was rejected because it reads as past tense where "Liked" and "Favourited" read as states.
- The five collection states are untouched. `wanted` and `favourited` stay orthogonal props, so the union does not become a cross-product.

### Coverage

`tests/integration/want-to-listen.test.ts` (21) covers the relation itself, which **had no test and no caller at all before this slice** — the unique constraint that makes `addWantToListen` idempotent had never run. Adding, idempotency, removal (including the safe no-op), user and album isolation, the profile foreign key behind `onboarding_required`, public read, and the three points where the path meets the clearing rule. The rule's own full matrix stays in `wishlist-clearing.test.ts` and is not duplicated.

`tests/e2e/want-to-listen.spec.ts` (7) covers what only a browser can see: that wanting does not collect, the full toggle cycle with reloads in both directions, coexistence with a rated and liked album, the one-way rule seen from the interface, and mutual non-interference with Favourite.

### Not implemented

The Want to Listen profile destination, any profile section or tab, reordering, Activity, feed events, feed hiding, and discovery or popularity ranking. **Public profile visibility is decided** (`product-spec.md` §10.1) — that fixes the eventual structure and does not schedule the surface, which is why none exists.

---

## 21. Optional `listened_on` date on add — implemented, verified and committed

Built and committed 2026-08-20 as `cc8018a`. Adding an uncollected album may now carry the date the user says they listened. **Nothing else** — no sorting, no filtering.

### Verified state

| Suite            | Count   |
| ---------------- | ------- |
| Unit + component | **144** |
| Integration      | **332** |
| Seed             | **1**   |
| End-to-end       | **48**  |

`rm -rf .next && npm run verify:full` — exit 0, all four suites. Inspected at 390, 768 and 1440px, open and closed; no horizontal overflow, and the field matches the primary button's width.

### What it does

|                  |                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where it appears | The explicit **Add to collection** flow only, and only while the album is uncollected                                                                  |
| Blank or omitted | `null`, and the request is byte-for-byte what it was before the field existed                                                                          |
| Supplied         | A **user-supplied calendar date**, freely backdated. A `date`, never a timestamp                                                                       |
| `added_at`       | Untouched and system-generated. It remains what orders the collection and what drives feed eligibility                                                 |
| When applied     | **On creation only**, inside `ensure_collection_entry`                                                                                                 |
| Later actions    | A subsequent rate, like, review or relisten **never overwrites** a date the user set, and never sets one where they chose none                         |
| Path             | The single sanctioned creation path. No second path, and **no migration** — the column, the service argument and the RPC parameter all already existed |

### The clearing rule is where it was

Adding a wanted album **with** a date collects it and clears the Want to Listen row, through `ensure_collection_entry` exactly as an undated add does. **No clearing logic was added to the action** — the date changes which value travels, never which path runs. Covered at both levels.

### Validation

Rejected before the value can reach Postgres, following the convention `rateAlbumAction` set — inline in the action, returning a message the card renders rather than throwing.

**The round-trip check earns its place.** `Date.parse('2026-02-30')` returns a number, because V8 rolls the day into March; Postgres does not, and `ensureEntry` maps only `23503`, so an unvalidated value would have produced a 500 rather than a message. The parsed components are compared back against the submitted ones, and an integration test confirms Postgres genuinely refuses the date that check catches.

**No upper bound.** Whether a listen may be dated in the future is unanswered, and imposing a rule here would answer it by implementing it. The model has always permitted it; this slice is simply the first way to enter one.

### Ordering is unchanged, and three documents now say so

The default remains **`added_at` descending**, with `listened_on` available as an explicit sort. This slice made no ordering change; what it did was force the reconciliation that preceded it. `product-spec.md` §4, `data-model.md` and `development-plan.md` all still described the superseded `coalesce(listened_on, added_at)` fallback, which the 2026-08-19 decision had rejected and the code had never implemented. All three now match §6 and the code, and `data-model.md` records why the fallback was rejected rather than quietly dropping it.

### Not implemented

Collection sorting and filtering, artist sorting, edition selection, favourites reordering, the profile wishlist destination, Activity and feed. `listened_on` is stored and never rendered — profiles and collections display no dates, by decision — so the slice is verified against the row rather than the page.

---

## 22. Artist page date sorting — implemented, verified and committed

Built and committed 2026-08-20 as `e1daffc`. The discography can be read newest first or oldest first. **Nothing else** — no rating sort, no aggregate.

### Verified state

| Suite            | Count   |
| ---------------- | ------- |
| Unit + component | **153** |
| Integration      | **332** |
| Seed             | **1**   |
| End-to-end       | **55**  |

`rm -rf .next && npm run verify:full` — exit 0, run twice: once before the visual inspection and again on the reverted tree. Inspected at 390, 768 and 1440px in both directions; no horizontal overflow, and the control sits on the section-header baseline at every width.

### What it does

|                |                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Sort key       | `albums.first_release_date` — the release date, never `added_at` or `listened_on`                            |
| Directions     | **Newest first** (default) and **oldest first**                                                              |
| Undated albums | **Last in both directions**                                                                                  |
| State          | The URL: `?sort=oldest`. Newest is the bare address, the same convention `?page=1` follows on the collection |
| Rendering      | Server-rendered. No client component, no client state                                                        |
| Visibility     | The control is withheld for a single-release discography — sorting one album is meaningless                  |

**Undated-last in both directions is the subtle part, and is pinned by two tests.** Reversing the comparator wholesale is the obvious way to implement "oldest", and it is wrong: it floats undated releases to the top, where they read as the earliest releases rather than as releases with no date, and it jumbles the interleaved chronological run that `product-spec.md` §6 exists to keep readable.

### The `[INFERRED]` requirement, resolved

`product-spec.md` §6 carried "sortable by release date and by average rating" as **`[INFERRED]`** — provisional, and explicitly asking whether to ship date-only. The note justified including rating sorting on the grounds that it "reuses the collection view's sort machinery".

**That rationale did not hold.** The collection view has no sort machinery, and building it is blocked on six product decisions of its own. Resolved 2026-08-20 in favour of **date-only**: rating sorting and any artist-level aggregate rating are deferred, and artist sorting proceeds independently rather than waiting on the collection.

### Coverage, and one limitation worth stating plainly

The comparator is **exported and pure** — the same pattern as the collection and favourites mappers — so ordering is proven directly rather than through the page: both directions, undated-last in each, the two directions genuinely inverse for dated releases, partial dates (year-only against full, where lexical order is chronological), and the empty, all-undated and single-release cases.

**Multi-album ordering is not covered end to end, and cannot be on this catalogue.** `db:seed:fixtures` ingests eight fixtures producing seven albums, and **every artist holds exactly one release** — the only pair is _Watch the Throne_ appearing under both of its credits. Proving ordering in a browser would require manufacturing catalogue records, which is excluded; **no fixture was added.** The unit tests are the authoritative proof of the ordering invariant, and the end-to-end spec says so in its own header rather than leaving the gap implicit.

What the browser does cover: the discography renders, the control is absent for a single release, `?sort=oldest` is a valid addressable 200, five malformed values and a repeated parameter all fall back without erroring, and **sorting mutates nothing** — rating, like, favourite, Want to Listen, relisten count, `listened_on` and review count are compared before and after visiting four sort URLs.

### One small removal

The bare count in the discography section header is gone. The slot holds one right-aligned affordance and now holds the sort; the page header two lines above already reads "N releases", so the count was saying the same thing twice.

### Not implemented

Artist rating sorting, artist-level aggregate rating, collection sorting and filtering, edition selection, favourites reordering, the wishlist profile surface, and Activity or feed. No migration, and no change to the fixture catalogue.

---

## 17. Lessons carried forward

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
