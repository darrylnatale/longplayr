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

**Status: complete.** Verified against staging — 338 albums, 241 artists, 6,388 releases, 4,751 tracks, 336 covers found and 2 exhausted. See `docs/current-state.md`.

**Features**

- MusicBrainz client with rate limiting and a descriptive User-Agent
- Job queue table plus cron endpoint to drain it
- Ingestion: release groups, artists, artist credits, representative release, tracklist
- Scope filter at ingest — albums, EPs, mixtapes; **no singles**
- Artwork pipeline: Cover Art Archive alone, keyed by release-group MBID, stored in Supabase Storage at three derivative sizes (250, 500, 1200). **No fallback source** — see `architecture.md` §7
- Designed artwork placeholder for coverage gaps
- Album page (read-only, no personal state)
- Artist page with discography
- Search over albums, artists, users — Postgres full-text plus trigram
- MusicBrainz fallback in search with one-click self-service add, scope-filtered and rate-limited
- Seed job populating a popular subset via the popularity abstraction

**Dependencies.** Phase 0.

**Verification complete** — see `architecture.md` §18. Outcomes that changed the plan:

- **No artwork fallback source.** Both candidates were rejected on their terms, so Cover Art Archive is the only source. Ingestion records whether art was found, making coverage measurable rather than assumed.
- **ListenBrainz MBIDs are optional**, so seed lists must filter to entries carrying one — the usable seed is smaller than the raw response.

**Architectural decisions settled here**

- Rate-limiting and retry strategy against MusicBrainz
- Job queue schema and drain cadence
- Upsert and deduplication semantics keyed on MBID
- Representative-release selection and its deterministic fallback chain (`data-model.md` §2)
- Partial-date storage with a precision marker
- Artwork storage layout and derivative generation
- The four artwork states — `pending`, `found`, `absent`, `failed` — and a coverage metric that counts failures rather than hiding them
- Search ranking formula — text match, artist weighting, popularity signal
- The `PopularitySource` interface, with ListenBrainz as first implementation

**Tests required**

- Scope filter: singles never enter the catalogue, under every input shape
- Self-service additions are capped at 30/hour and 100/day per user
- Upsert idempotency: re-ingesting an album produces no duplicates
- Rate limiter genuinely limits — this is easy to get subtly wrong and expensive to discover in production
- Artwork status is recorded on every outcome, and `absent` is never conflated with `failed` — a 404 from Cover Art Archive records `absent`, a 5xx or network error records `failed` and stays retryable. Coverage counts failures in the denominator
- Search ranking: a title shared by several albums returns the most popular first
- Representative-release selection is **deterministic** — re-ingesting picks the same release, including when no Official release exists and when dates tie
- Year-only and month-only dates round-trip and display without invented precision
- Job queue: retry, backoff, and failure states

**Definition of done.** Search for a well-known album, land on its page with artwork, tracklist and editions available, click through to the artist, browse their discography. Search for something not yet in the catalogue, add it from the MusicBrainz fallback, and reach its page within seconds. The seed job has populated a browsable catalogue.

### Phase 1 is not verified until the real-data smoke test passes

All Phase 1 work is built and tested **against fixtures**. Live MusicBrainz calls are blocked in code while `MUSICBRAINZ_CONTACT` is a placeholder, which is deliberate — an unidentified client risks getting longplayr blocked for every user at once.

Fixtures prove the logic; they cannot prove that our reading of MusicBrainz's actual response shapes is correct. **Phase 1 stays unverified until a small controlled ingest runs in a deployed environment with the genuine contact value.**

The smoke test must cover a representative set, chosen so each case that has caused a modelling decision is exercised at least once:

| Case                             | Why it matters                                                             |
| -------------------------------- | -------------------------------------------------------------------------- |
| Single-artist studio album       | The baseline path                                                          |
| Multi-artist collaboration       | `album_artists` must place it on every credited artist's page              |
| "Various Artists" compilation    | A special MusicBrainz artist, and a secondary type we accept               |
| EP and mixtape                   | In scope, and mixtapes may arrive with no primary type at all              |
| Single                           | Must be **rejected** — the one case where success means nothing is written |
| Live album or soundtrack         | Secondary types that must not exclude an otherwise in-scope album          |
| Year-only and full-date releases | Precision must round-trip without inventing a day                          |
| Album with many releases         | Representative-release selection, including no Official release present    |
| Album with no cover art          | `artwork_status = 'absent'` and the placeholder rendering                  |
| Album with cover art             | `artwork_status = 'found'`                                                 |

Keep the run small — a few dozen requests at one per second — and check the resulting rows directly rather than trusting the absence of errors.

---

## Design foundation _(parallel track, begins when screenshots arrive)_ — **complete**

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

## Phase 1 reopened — upstream payload capture

**Recorded as a reopening rather than folded into Phase 2, because it is catalogue infrastructure and pretending otherwise makes the phase boundaries meaningless. [2026-08-21]**

**Why it could not wait for Phase 2 to finish.** Every album ingested without capture loses data permanently, recoverable only at one request per second. The remaining Phase 2 items — filtering, edition selection, favourites reordering — have no such decay; they are exactly as easy to build later. The ordering that matters is **capture → curated seed (`product-spec.md` §8.9) → back to Phase 2**: seeding a larger catalogue first would push a thousand albums through the narrow pipe and then require re-fetching every one.

**Delivered**

- `upstream_payloads`, keyed `(source, source_id, kind)`, source-agnostic from the start
- Widened `inc` — `url-rels` on the release group, `artist-rels+url-rels` on the release; `genres` and `tags` deliberately excluded
- Capture on the single ingest path, for both the release group and the representative release
- `enqueueMissingPayloads` plus `npm run db:backfill:payloads`, reusing `ingest_release_group` rather than inventing a job kind

**Explicitly not delivered.** Labels, external links, track recording MBIDs and producer credits are **captured but not modelled** — they get columns when a feature needs them, from stored payloads, at no fetch cost. **Artist details remain an open decision** (`product-spec.md` §8.9 neighbourhood): they are the only item needing an extra request, one per artist, since `/artist/` has never been called at all.

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
- **Want to Listen, album level** — the independent relation on the album card: per-album read state, the ActionCard control, server mutations, and integration and end-to-end coverage. **The profile destination is not part of this** — see below
- **Profile overview** — identity, available statistics, favourites, and a bounded collection preview whose count links onward
- **Collection destination** at `/<handle>/collection` — the full collection in the `wide` container, paginated
- Collection view: cover grid showing score, like indicator and `×N` marker, **no captions** (`design-reference.md` §11.9). **Sorting is complete; filtering is not** — see below
- Optional edition selection, with lazy release fetching
- Album averages computed on read, one decimal

**Dependencies.** Phase 1 (albums must exist), design foundation. **Both are complete** — Phase 1 implementation closed with 338 albums on staging, and the design foundation is finished with all nine surfaces migrated and screenshot-verified. Neither needs re-checking.

**Additional features from resolved decisions**

- Profile favourites — up to ten pinned albums, user-ordered, independent of the collection
- **Artist page sorting by release date — complete.** Newest and oldest, `first_release_date`, undated releases last in both directions, selected via `?sort=oldest`. **Rating sorting and any artist-level aggregate rating are deferred** (`product-spec.md` §6, resolved 2026-08-20); neither was built, and collection sorting is not a prerequisite
- **Collection sorting — complete.** Six fixed modes selected via `?sort=` on the Collection destination — Added (default), Listened, Rating, Title, Artist, Year — each with one fixed direction and no ascending/descending toggle. Nulls last on Listened, Rating and Year; unrated albums stay visible. Changing sort resets to page 1, paging preserves the sort, and the control is public. Delivered with **no migration, no new index and no schema change** (`product-spec.md` §6, decided 2026-08-21). **Collection filtering is not built and remains undecided**, including the decade filter `design-reference.md` §5.6 raises and `product-spec.md` §6 omits
- Implicit collection creation when rating, liking or reviewing an uncollected album

**Open decisions affecting this phase.** The line that stood here — "No open decisions block this phase" — was written before decision H was raised and before the product direction in `product-spec.md` §10 existed. It was wrong on both counts and is corrected rather than deleted, because a plan that once said a phase was unblocked should show that it changed its mind.

| Item                                  | State                                                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Want to Listen schema**             | **RESOLVED 2026-08-18.** Independent relation, own table; the collection table needs no status column. This was the real blocker and it is cleared                                                                                                     |
| **Decision H — album page caching**   | **RESOLVED 2026-08-18.** Pages stay dynamic; catalogue caching moves to the data layer behind a cookie-free client. See `current-state.md` §7                                                                                                          |
| Want to Listen profile visibility     | **RESOLVED 2026-08-19.** Public, as its own profile tab — `Collection \| Want to Listen \| Favourites`. Only Collection is built in this phase; the decision fixes the structure, it does not schedule the other two tabs. See `product-spec.md` §10.1 |
| Want to Listen feed behaviour         | **[OPEN]** — Phase 3 concern. Events do not exist until then                                                                                                                                                                                           |
| **Manual bulk backfill and the feed** | **[OPEN]** — Phase 3. The amended eligibility rule keys on the write path, which covers a future import cleanly; a user hand-adding two hundred albums in one sitting is not covered. See `data-model.md` §11.9                                        |

**Nothing now blocks Phase 2 from starting.**

**Architectural decisions settled here**

- Collection entry uniqueness and upsert semantics
- Dual-timestamp handling: `listened_on` versus `added_at`, and **which of them orders the collection** — resolved 2026-08-19 as `added_at` descending, rejecting the fallback (`product-spec.md` §6)
- **Where the Want to Listen clearing rule lives.** Not whether — that is decided — but whether it is a trigger or service-layer logic. Service-layer is more consistent with decision G, which asks that collection mutations have single write points so Phase 3 can add `Activity` writes without duplicating them
- Rating aggregation query and index strategy
- Review as a separate table with a status field

**Tests required**

- One entry per user per album, enforced under concurrent writes
- Rating aggregation: nulls excluded, rounding correct, thin-data behaviour sane
- Collection **default** sort is `added_at` descending, and a backdated `listened_on` does **not** reorder it — under every mode except Listened, where reordering by it is the point
- Relisten events accumulate while the entry count stays denormalised and accurate
- Album page renders correctly in all three collection states
- **Implicit add is silent** — rating an uncollected album creates the entry and fires a `rated` event, but no `listened` event
- Favourites cap at ten, are user-orderable, and pinning does **not** add to the collection
- End-to-end: search → add → rate → review → appears in collection

**Definition of done.** A user can find an album, add it, score it, write a review, mark relistens, and see it once in their collection with the correct markers. The album page shows an average drawn from real ratings and lists reviews from other users.

**Ordering within the phase.** The profile architecture — overview, collection destination, `wide` container, pagination, and the state line on the tile — lands **before Favourites**. Favourites is specified to sit near the top of the profile, so it needs the overview to exist; adding a second grid to a profile that is already an unbounded first grid would double the problem rather than reveal it. Recorded because the reverse order looks equally reasonable and is not.

---

## Phase 3 — Social

**Goal.** Other people become visible. The product becomes social rather than personal.

**Features**

- Follow and unfollow; follower and following lists
- `Activity` writes for every event type: listened, relistened, rated, reviewed
- **Feed eligibility rule** — interactive actions generate events; historical and backfilled collection data does not. **`listened_on` is not the discriminator** (amended 2026-08-18 — see `data-model.md`, Feed eligibility rule)
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

- **The anti-flood rule** — a bulk backfill of many albums generates zero events. This is the single most important test in the phase: its failure floods every follower's feed and is not recoverable. **The test's premise changed with the rule** — it can no longer be written as "backdate the adds and assert silence", because backdating is no longer what makes an add silent. It must exercise whatever write path backfill actually uses
- **A backdated interactive add still generates an event** — the inverse of the above, and the case that would silently regress if anyone reinstated the old date-based condition
- **Implicit adds generate no `listened` event** — rating an uncollected album fires `rated` and nothing else, now that the date no longer explains why
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

Comments, private accounts, track-level features, streaming integration, per-item list notes, genres and tags, year-in-review, and native apps. Each is deferred with reasoning in `docs/product-spec.md` §7. None should be added to a phase above without an explicit decision to change scope.

**Algorithmic recommendations** left this list by decision — see the next section.

---

## Recorded direction, not yet scheduled

`docs/product-spec.md` §10 records four areas of **decided but largely unbuilt** product direction. They are named here so nobody re-derives them, and so nobody schedules them by accident.

**One exception, and only one.** The **album-level** Want to Listen relation was explicitly scheduled as a Phase 2 slice on 2026-08-20 and is built; it is listed in Phase 2 above. Everything else in this section, **including every remaining part of Want to Listen**, still has no phase.

| Direction                                    | State                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Want to Listen** (§10.1)                   | **Partly scheduled and built.** The album-level relation shipped as a Phase 2 slice — card control, mutations, per-album read. **Unscheduled and unbuilt: `/<handle>/wishlist`, any profile tab or surface, and feed/Activity integration.** Public profile visibility is decided (§10.1) — that fixes the eventual structure and does not schedule the surface. Two questions remain, plus feed hiding |
| **Taste overlap / social discovery** (§10.2) | Decided as direction. Algorithm explicitly undecided. Six product questions unresolved                                                                                                                                                                                                                                                                                                                  |
| **Profile photo, bio, city** (§10.3)         | Photo and bio are **already in scope** (Phase 0/2). Only city is new. Dating-specific fields explicitly excluded                                                                                                                                                                                                                                                                                        |
| **Direct messaging** (§10.4)                 | Decided. **Unscheduled, and blocked on legal research.** Desired from the beginning of the social product; not required in the single-user collection phase                                                                                                                                                                                                                                             |

**Every unresolved question in §10 must be asked, not inferred.** That is the whole reason the section exists. A phase must not be planned around a guessed answer.

### Two things that block scheduling

**Messaging placement, clarified 2026-08-18.** The earlier contradiction is resolved without renumbering anything. Messaging is **desired from the beginning of the social product** and is **not required in the single-user collection phase** — Phase 2 has no social graph, so there is nobody to message and its absence there costs nothing. Phase 2 is not "too early for messaging"; messaging is simply not part of what Phase 2 is.

**It remains unscheduled**, and deliberately so: what gates it is a precondition rather than a phase number.

**That precondition is a minimum viable safety and legal layer — not the whole of Phase 6.** An earlier reading held that messaging needed Phase 6's complete reports queue and admin tooling, which would have pushed it several phases out. That reading is rejected. What it needs is the smallest safety surface that discharges the obligations which actually apply, and determining that surface is precisely what the legal research is for.

**The legal research is blocking.** Current DSA and German/EU obligations for a small service hosting user-generated content and private messaging must be researched, with legal requirements distinguished from good practice, current authoritative sources cited, and anything needing professional legal advice flagged as such rather than presented as settled. See `docs/product-spec.md` §10.4. **No messaging code, and no phase assignment, before that research exists** — the research is what tells us how large the prerequisite is, and therefore where messaging can sit.

### Where Want to Listen landed, and what is left

This section previously read "where Want to Listen would land **if** scheduled", and recorded as an observation that it shared the action card with Phase 2 and the feed with Phase 3, but was in neither phase's scope. **The first half of that has happened.**

The album-level relation was scheduled and built in Phase 2, which is where the observation said it would be cheapest. **The feed half has not**, and remains Phase 3 machinery that does not exist: no Activity, no events, and no decision on whether removal generates one.

**The profile surface is the part most likely to be assumed built, and is not.** Public visibility is decided (`product-spec.md` §10.1), which fixes the eventual tab structure — `Collection | Want to Listen | Favourites` — and schedules nothing. `/<handle>/wishlist` does not exist, and neither does any tab, section or placeholder for it.

The schema question was answered before any of this, which is why the relation could be added additively rather than as a rewrite.
