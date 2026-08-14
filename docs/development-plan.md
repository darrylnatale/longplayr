# longplayr — Development Plan

Implementation broken into vertical slices. Each phase ships something demonstrable and settles specific architectural questions, rather than building all features in parallel at partial depth.

Two ordering principles:

1. **Highest technical risk first.** Catalogue ingestion depends on an external service with a hard rate limit — it's the most likely thing to go wrong, so it happens before features are built on top of it.
2. **Foundations before breadth.** Auth, deployment and CI exist before any product feature, so every subsequent phase ships through a working pipeline instead of accumulating undeployed work.

---

## Phase sequence

```
  0  Foundation          auth, deploy, CI, service layer
  1  Catalogue           MusicBrainz, artwork, album/artist pages, search
     ├ Design foundation (parallel, gated on screenshots)
  2  Core loop           collection, rating, review, relisten
  3  Social              follows, activity, feed
  4  Lists
  5  Discovery           popularity, charts, cold start
  6  Safety              reporting, blocking, admin
  7  Launch readiness    deletion, export, security, observability
```

Phases 0–2 constitute the product's spine. If work stopped after Phase 2, longplayr would be a functioning personal album-logging tool — useful to one person, but not yet social. Phases 3–5 make it a social product. Phases 6–7 make it launchable.

---

## Phase 0 — Foundation

**Goal.** A deployed, authenticated skeleton with CI green. Prove the entire pipeline end to end before writing any product logic.

**Features**

- Next.js App Router project, TypeScript, styling system, lint and format configuration
- Supabase projects: local, staging, production
- Migration tooling and the first migration (`User` profile table)
- Sign up, sign in, sign out via Supabase Auth (email/password + Google)
- Profile creation on first sign-in; handle selection
- Service layer skeleton with module boundaries
- GitHub Actions: lint, typecheck, test, build
- Vercel deployment; preview deploys pointed at staging

**Dependencies.** None. This is the entry point.

**Architectural decisions settled here**

- Migration tooling and workflow
- Service-layer boundary and module structure (`catalogue`, `collection`, `social`, `lists`, `discovery`, `search`, `moderation`)
- Environment and secret configuration across three environments
- Test harness — Vitest for unit and integration, Playwright for end-to-end
- Authorisation pattern in application code (RLS is not the primary mechanism)

**Tests required**

- Auth flow integration tests: sign up, sign in, sign out, session persistence
- Handle validation and uniqueness
- CI pipeline itself verified green on a pull request

**Definition of done.** A new user can sign up on the deployed staging URL, choose a handle, sign out, and sign back in. Their empty profile renders at `/<handle>`. CI passes on pull requests and blocks merge on failure.

---

## Phase 1 — Catalogue

**Goal.** Albums and artists exist, are findable, and look right. This is the highest-risk phase — it owns every external dependency.

**Features**

- MusicBrainz client with rate limiting and a descriptive User-Agent
- Job queue table plus cron endpoint to drain it
- Ingestion: release groups, artists, artist credits, representative release, tracklist
- Scope filter at ingest — albums, EPs, mixtapes; **no singles**
- Artwork pipeline: Cover Art Archive → fallback → stored in Supabase Storage, with derivative sizes
- Designed artwork placeholder for coverage gaps
- Album page (read-only, no personal state)
- Artist page with discography
- Search over albums, artists, users — Postgres full-text plus trigram
- MusicBrainz fallback in search with one-click self-service add, scope-filtered and rate-limited
- Seed job populating a popular subset via the popularity abstraction

**Dependencies.** Phase 0.

**Blocked by verification tasks only** _(every product decision for this phase is settled)_

- Apple/iTunes terms — determines the artwork fallback source (`architecture.md` §18)
- MusicBrainz rate-limit policy confirmation
- ListenBrainz endpoint shapes

**Architectural decisions settled here**

- Rate-limiting and retry strategy against MusicBrainz
- Job queue schema and drain cadence
- Upsert and deduplication semantics keyed on MBID
- Representative-release selection and its deterministic fallback chain (`data-model.md` §2)
- Partial-date storage with a precision marker
- Artwork storage layout and derivative generation
- Search ranking formula — text match, artist weighting, popularity signal
- The `PopularitySource` interface, with ListenBrainz as first implementation

**Tests required**

- Scope filter: singles never enter the catalogue, under every input shape
- Self-service additions are capped at 30/hour and 100/day per user
- Upsert idempotency: re-ingesting an album produces no duplicates
- Rate limiter genuinely limits — this is easy to get subtly wrong and expensive to discover in production
- Artwork fallback chain, including the case where every source fails
- Search ranking: a title shared by several albums returns the most popular first
- Representative-release selection is **deterministic** — re-ingesting picks the same release, including when no Official release exists and when dates tie
- Year-only and month-only dates round-trip and display without invented precision
- Job queue: retry, backoff, and failure states

**Definition of done.** Search for a well-known album, land on its page with artwork, tracklist and editions available, click through to the artist, browse their discography. Search for something not yet in the catalogue, add it from the MusicBrainz fallback, and reach its page within seconds. The seed job has populated a browsable catalogue.

---

## Design foundation _(parallel track, begins when screenshots arrive)_

Not a blocking phase, but it must land **before Phase 2**, because Phase 2 is where UI starts multiplying and retrofitting a design system across built components is far more expensive than establishing one first.

**Work**

- Pass 2 of `docs/design-reference.md` — pixel-level analysis of supplied screenshots
- Visual identity: dark-first palette distinct from Letterboxd's measured values (`design-reference.md` §7), type scale, spacing system
- Square-artwork grid system at every breakpoint (`design-reference.md` §5.1)
- Core components: cover card, grid, score badge, album row, nav, section header, stat cluster
- The collection-entry action card and its three states (`design-reference.md` §6.4)
- Artwork placeholder design (`design-reference.md` §6.6)
- **Mobile behaviour below ~768px**, which the supplied screenshots don't cover (`design-reference.md` §9)

**Definition of done.** A component set and design tokens exist, verified by screenshot comparison against intent, and Phase 1's album and artist pages have been brought onto them.

---

## Phase 2 — Core loop

**Goal.** The product's reason to exist. After this phase longplayr is genuinely useful to a single user.

**Features**

- Add album to collection — one click, optional date (default today, backdatable, omittable)
- Rating: optional, 0.0–10.0, one decimal
- Like: independent of rating
- Review: one standing review per album, create and edit
- Relisten: increment, producing discrete events
- Remove from collection
- Album page in all three states — not collected, collected unrated, collected rated
- Collection view on profile: cover grid, sortable and filterable, showing score, like indicator and `×N` marker
- Optional edition selection, with lazy release fetching
- Album averages computed on read, one decimal

**Dependencies.** Phase 1 (albums must exist), design foundation.

**Additional features from resolved decisions**

- Profile favourites — up to ten pinned albums, user-ordered, independent of the collection
- Artist page sorting by date and rating
- Implicit collection creation when rating, liking or reviewing an uncollected album

**No open decisions block this phase.**

**Architectural decisions settled here**

- Collection entry uniqueness and upsert semantics
- Dual-timestamp handling: `listened_on` versus `added_at`, and the sort fallback
- Rating aggregation query and index strategy
- Review as a separate table with a status field

**Tests required**

- One entry per user per album, enforced under concurrent writes
- Rating aggregation: nulls excluded, rounding correct, thin-data behaviour sane
- Collection sort falls back from `listened_on` to `added_at` correctly
- Relisten events accumulate while the entry count stays denormalised and accurate
- Album page renders correctly in all three collection states
- **Implicit add is silent** — rating an uncollected album creates the entry and fires a `rated` event, but no `listened` event
- Favourites cap at ten, are user-orderable, and pinning does **not** add to the collection
- End-to-end: search → add → rate → review → appears in collection

**Definition of done.** A user can find an album, add it, score it, write a review, mark relistens, and see it once in their collection with the correct markers. The album page shows an average drawn from real ratings and lists reviews from other users.

---

## Phase 3 — Social

**Goal.** Other people become visible. The product becomes social rather than personal.

**Features**

- Follow and unfollow; follower and following lists
- `Activity` writes for every event type: listened, relistened, rated, reviewed
- **Feed eligibility rule** — only today-dated adds generate events; undated and backdated adds are silent
- Following feed, reverse-chronological, with relative timestamps
- Likes on reviews
- **Notifications page** — new followers and likes on your reviews, with an unread count. In-app only
- Profiles show follower and following counts

**Dependencies.** Phase 2.

**Architectural decisions settled here**

- Activity write points within the service layer
- Feed query and pagination strategy over the follow graph
- Event lifecycle: cascade deletion when the underlying action is undone
- Confirmation that events read live values rather than snapshots
- The `Activity` / `Notification` split — broadcast versus directed, with disjoint event types

**Tests required**

- **The silent-add rule** — a backdated bulk add of many albums generates zero events. This is the single most important test in the phase: its failure floods every follower's feed and is not recoverable
- Feed returns only followed users' activity, correctly ordered
- Editing a rating updates what the feed displays
- Removing an album deletes its events
- Likes generate no activity events, but **do** generate notifications
- Unfollowing or unliking removes the corresponding notification
- Unread count is accurate and clears correctly
- End-to-end: two accounts, follow, act, verify feed contents and notifications

**Definition of done.** Account A follows account B. B adds an album dated today, relistens another, rates a third, and writes a review — all four appear in A's feed with correct relative times. B backfills forty undated albums and A's feed shows nothing new. B sees a notification that A followed them, and another when A likes one of their reviews.

---

## Phase 4 — Lists

**Goal.** Users can curate, not just record.

**Features**

- Create, edit, delete lists
- Ranked or unranked; reordering for ranked lists
- Add and remove albums
- Public list pages; lists shown on profiles
- Likes on lists, extending notifications to list likes
- List creation and updates generate activity events

**Dependencies.** Phase 3 (list activity needs the feed).

**Architectural decisions settled here**

- Position maintenance on reorder
- Which list edits are feed-worthy, and how repeated edits avoid spamming the feed

**Tests required**

- An album appears at most once per list
- Reordering maintains contiguous positions
- Unranked lists ignore position entirely
- List events appear in followers' feeds
- Rapid successive edits don't produce a burst of feed events

**Definition of done.** A user creates a ranked list, reorders it, and it renders numbered. It appears on their profile, is likeable by others, and its creation appears in followers' feeds.

---

## Phase 5 — Discovery

**Goal.** Close the loop. A new user with no follows sees something worth looking at.

**Features**

- Popular this week and highest rated this week
- Popularity abstraction extended with an internal-activity source
- Scheduled recomputation of charts
- Home page for signed-out and no-follows states

**Dependencies.** Phase 3 (activity data), Phase 1 (popularity abstraction).

**Chart definitions are settled** (`product-spec.md` §8.3) — distinct-user counts over a 7-day window, a 5-rating chart-eligibility threshold, and an external fallback below 20 results. Expect to revisit them once there's real activity to look at; they were defined against imagined data.

**Architectural decisions settled here**

- Chart computation and caching cadence
- Blending external and internal popularity signals

**Tests required**

- Chart computation over known fixture data produces expected ordering
- Distinct-user counting: one user relistening twenty times moves the chart by one
- A user backfilling 300 albums adds at most +1 to each
- Minimum-rating threshold prevents a single high score topping a chart
- External fallback fills the chart when internal activity is below threshold
- Signed-out and no-follows home pages render populated
- Charts survive an empty-activity period without erroring

**Definition of done.** A brand-new account with zero follows lands on a populated home page showing albums genuinely worth exploring, and can navigate from there into the catalogue.

---

## Phase 6 — Safety and admin

**Goal.** The product can survive contact with bad actors.

**Features**

- Report reviews, lists and accounts
- Block accounts — cutting interaction bidirectionally, with truthful UI copy about what blocking does and does not do
- Admin reports queue with content preview
- Soft-delete content; suspend and ban accounts
- Content and user status enforced across every read path

**Dependencies.** Phases 3 and 4 (there must be content to moderate).

**Blocked by open decisions**

- Report reason categories

**Architectural decisions settled here**

- Status enforcement in the service layer, so removed content cannot leak through any query
- Admin role checks and route separation

**Tests required**

- Removed content disappears from **every** surface — album pages, profiles, feeds, lists, search
- Suspended and banned users cannot write
- Blocking prevents follow and like in both directions
- Blocking does **not** hide content from signed-out viewing — verifying the honest behaviour, so the UI copy can't drift from reality
- Admin routes reject non-admin users

**Definition of done.** A review is reported, appears in the admin queue, is removed, and vanishes from every surface. A blocked user cannot follow or like. An account can be suspended and can no longer write.

---

## Phase 7 — Launch readiness

**Goal.** Legal, operational and security obligations met.

**Features**

- Account deletion — hard delete with complete cascade
- Data export — collection, ratings, reviews, lists in a portable format
- Error tracking on server and client
- Ingestion health monitoring — queue depth, failure rates
- Uptime checks
- Rate limits on all abuse-prone write paths
- Security review focused on auth flows, authorisation checks and the admin surface
- Performance pass on the heaviest surfaces: large collections, feed, search

**Dependencies.** All prior phases.

**Blocked by open decisions**

- Handle reuse after deletion (`data-model.md` §9.5)

**Tests required**

- **Deletion leaves no orphans** — every table verified. An orphan here is a privacy failure, not a bug
- Averages recompute correctly after a deletion, with no manual step required
- Export completeness against a fully-populated account
- Rate limits actually trigger
- Authorisation tests across every protected path

**Definition of done.** An account with substantial history can be deleted, verifiably leaving no rows anywhere, with album averages adjusting automatically. Export produces complete, portable data. The security review is complete and its findings addressed.

---

## Working method

Consistent with `docs/claude-code-playbook.md`:

- **Plan mode before each phase**, and before any non-trivial decision within one. Schema changes and auth-adjacent work always warrant it.
- **Reviewer and QA subagents** become worthwhile from Phase 1 onward, once there's real code and a real test suite. Not before.
- **Screenshot verification** for all UI work from the design foundation onward.
- **Git worktrees** only when genuinely parallel workstreams exist — likely first around Phases 4 and 5, which are independent of each other.
- **CLAUDE.md updated at each phase boundary** as conventions actually solidify. It should describe what exists, never what's planned.

## Deliberately not scheduled

Comments, private accounts, track-level features, streaming integration, algorithmic recommendations, per-item list notes, genres and tags, year-in-review, and native apps. Each is deferred with reasoning in `docs/product-spec.md` §7. None should be added to a phase above without an explicit decision to change scope.
