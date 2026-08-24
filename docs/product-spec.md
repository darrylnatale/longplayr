# longplayr — Product Spec

Status: **draft, pre-implementation.** Every decision recorded here was made explicitly. Anything not yet decided is listed in §8 as an open decision rather than assumed.

Notation: **[DECIDED]** = explicitly chosen. **[INFERRED]** = follows necessarily from a decision; flagged so it can be corrected. **[OPEN]** = needs a decision before or during the phase that depends on it.

---

## 1. What longplayr is

longplayr is a place to keep a record of the albums you've listened to, say what you think of them, and see what the people you follow are listening to.

The unit is the **album**. Not the track, not the playlist, not the artist. A user's account accumulates into a library of records they've heard, scored, and written about — a durable, browsable representation of their taste that gets more valuable the longer they use it.

It is inspired by Letterboxd structurally, but the core model diverged deliberately during definition and it's worth naming that plainly:

> **Letterboxd is a diary. longplayr is a collection.**
>
> On Letterboxd, the atomic act is _watching a film on a date_, and your profile is a chronology. On longplayr, the atomic act is _having listened to an album_, and your profile is a library. Dates exist but are never displayed on profiles. An album appears in your collection exactly once, however many times you've played it.

This is the right call for music — you don't watch _Blonde_ forty times, but you might well listen to it that often, and a chronological diary of that would be noise rather than a record of taste. But it changes the shape of the product, and it means Letterboxd is a reference for _structure and interaction_, not for the underlying model. See `docs/design-reference.md`.

### Tone

Album artwork carries the product visually; the interface stays out of its way. Scoring is 0.0–10.0 to one decimal, which reads more analytical than five stars would — closer to music-criticism register than casual-social register. That's a deliberate identity choice, with a known risk: decimal scoring is associated with score-obsessed music discourse, and the product's copy and design should push against that rather than lean into it.

---

## 2. Non-goals

Stating these plainly because each one is something a music-social product could plausibly become, and each is out of scope:

- **Not a streaming service.** No playback, no audio hosting. longplayr links out; it doesn't play.
- **Not a scrobbler.** Listening is recorded deliberately by the user, not captured passively. There is no background ingestion of play data.
- **Not a metadata authority.** MusicBrainz is upstream truth. longplayr does not host a competing catalogue or accept user-authored metadata.
- **Not a score authority.** Averages exist to inform, not to rank the canon. The product should not present itself as arbitrating what's good.
- **Not track-level.** Tracks appear as tracklists for context. They are never rated, reviewed, logged, or listed.

---

## 3. The core loop

Every MVP feature exists to serve one of these steps. Anything that doesn't is either justified explicitly or deferred.

| Step                            | Served by                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------- |
| **Discover music**              | Popular / highly rated this week; the following feed; artist pages; lists; search |
| **Listen to an album**          | Off-platform — longplayr links out to streaming services                          |
| **Log it**                      | Add to collection (one click; optional date)                                      |
| **Rate / review it**            | Optional 0.0–10.0 score, optional like, optional standing review                  |
| **Build a personal history**    | The collection: a sortable library of everything you've heard                     |
| **See other people's activity** | The following feed                                                                |
| **Discover more music**         | Loops back to row one                                                             |

**The known weak link is step one for a new user.** Someone who follows nobody has an empty feed, so _popular / highly rated this week_ is what fills that screen. That surface is load-bearing for onboarding, not a nice-to-have, and it is itself weak on day one when there's little aggregate activity to draw on. This is the product's most significant cold-start risk. See §8.

---

## 4. Decisions of record

Revised entries supersede earlier choices made during the same session.

### Core model

| Decision        | Value                                                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomic model    | **Collection.** One entry per user per album, permanently. **[DECIDED — supersedes an earlier "dated diary" choice]**                                                                                     |
| Adding an album | One click. Date is optional; defaults to today, may be backdated, may be omitted entirely                                                                                                                 |
| Relistens       | A **count** on the collection entry, incremented by the user. The album still appears once in the collection, marked `×N`                                                                                 |
| Rating          | **Optional.** 0.0–10.0, one decimal. Updates in place; no history shown. Unrated entries don't count toward averages **[DECIDED — supersedes an earlier 0.5–5 star choice]**                              |
| Like            | Optional, independent of rating. You can like without scoring and score without liking                                                                                                                    |
| Review          | **One standing review** per user per album, editable in place                                                                                                                                             |
| Granularity     | Album only. Tracklists display; tracks are never rateable                                                                                                                                                 |
| Album identity  | MusicBrainz **release group** is the social object. A collection entry may optionally reference a specific release/edition                                                                                |
| Catalogue scope | Albums, EPs, mixtapes — including live albums, compilations, soundtracks. **Singles excluded**                                                                                                            |
| Timestamps      | Two: `listened_on` (nullable, user-supplied) and `added_at` (always set by the system). **Collection sorts by `added_at` descending by default** — see §6; `listened_on` is available as an explicit sort |
| Average display | One decimal                                                                                                                                                                                               |

### Social

| Decision        | Value                                                                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Follow model    | Asymmetric follow **[INFERRED — standard for this product shape; correct if you want mutual-friend semantics]**                                                                                                                                                                                 |
| Feed contents   | Interactive listens (collection adds), relistens, ratings, reviews, list creation/updates, **Want to Listen additions** (§10.1). Not a closed list — it grows by phase                                                                                                                          |
| Feed exclusions | Likes and follows do **not** generate feed events — they'd dominate by volume and crowd out reviews                                                                                                                                                                                             |
| Silent actions  | **Historical and backfilled collection data** populates the collection without generating feed events, which is what makes onboarding backfill possible without flooding followers. **A backdated `listened_on` is not itself a request for silence** — see the amended rule in `data-model.md` |
| Feed recency    | Feed shows relative time ("2h"). Profiles show no dates anywhere                                                                                                                                                                                                                                |
| Interactions    | Likes only. **No comments in v1**                                                                                                                                                                                                                                                               |
| Notifications   | In-app page only — new followers, likes on your reviews, likes on your lists, with an unread count. No email, no push                                                                                                                                                                           |

### Lists

| Decision   | Value                                                       |
| ---------- | ----------------------------------------------------------- |
| Scope      | Title, description, albums, optional ranked ordering, likes |
| Not in v1  | Per-item commentary, collaborative lists                    |
| Visibility | Public **[INFERRED from the all-public model]**             |

### Privacy, safety, moderation

| Decision      | Value                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Visibility    | Everything public. No private accounts, no per-entry visibility                                                                            |
| Deletion      | **Hard delete.** Collection, ratings, reviews, lists, follows all removed; averages recompute                                              |
| Export        | Users can export their data                                                                                                                |
| Blocking      | Cuts interaction (follow, like, feed, notifications) in both directions. **Does not hide content** — must be labelled truthfully in the UI |
| Reporting     | Users can report reviews, lists, and accounts                                                                                              |
| Admin actions | Soft-delete content; suspend or ban accounts. Content and users carry status fields from day one                                           |

### Catalogue

| Decision        | Value                                                                                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metadata source | MusicBrainz                                                                                                                                                                                                                 |
| Artwork         | Cover Art Archive plus a fallback source                                                                                                                                                                                    |
| Ingestion       | Seed a popular subset, then fetch on demand and cache. **Superseded in part 2026-08-23 (§8.9)** — "grow on demand" is no longer the whole model; depth is expanded deliberately for included artists                        |
| Missing albums  | **Self-service.** Users search MusicBrainz in-app and add any in-scope release instantly. Scope filter blocks singles; rate limit prevents bulk junk **[DECIDED — supersedes an earlier "admin-approved requests" choice]** |
| User edits      | None. Catalogue is read-only downstream of MusicBrainz                                                                                                                                                                      |
| Streaming       | Outbound links only. No OAuth, no import, no playback                                                                                                                                                                       |

---

## 5. Product areas

### Core — in the MVP

**Accounts** — sign up, sign in, sign out, delete account, export data. Email/password plus Google. Public profile with handle, display name, avatar, short bio.

**Catalogue** — albums (release groups) with title, artist credit, release year, type, tracklist, artwork, and available editions. Artists with name, and a discography of in-scope releases.

**Collection** — the central object. Add an album; optionally set a date; optionally rate, like, review, or note the edition; increment a relisten count. Remove an entry.

**Album page** — artwork, credits, year, type, tracklist, editions, average rating and count, your own entry state and controls, reviews from others, links out to streaming.

**Artist page** — name, discography of in-scope releases, aggregate signal across their catalogue.

**Profile page** — identity, collection (sortable, filterable), lists, follower/following counts, review activity.

**Lists** — create, edit, delete; ordered or unordered; public; likeable.

**Follows** — follow and unfollow; follower and following lists.

**Feed** — reverse-chronological activity from people you follow, per §4.

**Discovery** — popular this week and highest rated this week, computed from recent activity.

**Search** — albums, artists, users. Includes the in-app MusicBrainz fallback for records not yet in the catalogue.

**Notifications** — an in-app notifications page: new follower, like on your review, like on your list. Unread count. **No email, no push.** **[DECIDED — resolves former open decision 8.1]**

**Safety** — report content and accounts; block accounts.

**Admin** — reports queue; remove content; suspend and ban accounts.

### Important but later

- **Notification delivery beyond the in-app page** — email digests, push, per-type preferences.
- **Genres and tags**, and browsing by them.
- **Rating distribution** on album pages (a histogram rather than a bare average).
- **Per-item list commentary.**
- **Richer artist pages** — grouping by type, related artists, aggregate stats. **Note the latent conflict:** §6 decided the discography is "never grouped by type", settled when no artist held more than three releases. Catalogue depth (§8.9) makes that conflict live, though not at the immediate boundary.
- **History import** from Last.fm or Spotify, as a bulk collection backfill.
- **Profile favourites** — a small set of pinned albums representing your taste at a glance.
- **Year in review** — the annual personal-stats artifact that drives enormous organic sharing for Letterboxd and Spotify.

### Potential future

- ~~Algorithmic recommendations based on collection overlap.~~ **SUPERSEDED — see §10.2**, which raises taste overlap from a maybe to decided direction.
- Comments on reviews and lists.
- Collaborative lists.
- Native mobile apps.
- Editorial curation and featured content.
- Concert and live-show logging.
- Paid tier.

### Should probably not exist

- **In-app playback.** Licensing cost and complexity dwarf the entire rest of the product, and it competes with the services users already pay for.
- **Passive scrobbling as the primary input.** Explicitly rejected: it produces volume, not judgement, and the product's value is in deliberate acts.
- **Track ratings.** Fragments the album-centric identity and multiplies the data model for marginal gain.
- ~~**Direct messages.**~~ **SUPERSEDED — see §10.4.** This read "moderation liability far exceeding their value here". Messaging is now intended functionality from the beginning of the social product. The liability concern was not wrong and is carried forward as a blocking legal-research precondition rather than as a reason to omit the feature.
- **An engagement-ranked feed.** Reverse-chronological is honest; optimising the feed for time-on-site works against a product about considered taste.
- **Streaks, badges, gamification.** Rewards logging volume, which is exactly the wrong incentive.
- **User-authored catalogue metadata.** MusicBrainz already solved this and does it better.

---

## 6. Surface definitions

Information hierarchy per surface. Visual treatment is `docs/design-reference.md`; this is about what exists and what matters most.

### Album page

Primary: artwork, title, artist, year, average rating with count. Then: your entry controls — add / rate / like / review / relisten, and edition if you care. Then: tracklist and editions. Then: reviews from others, most recent first. Then: outbound streaming links.

The page must read correctly in three states: **not in your collection**, **in your collection unrated**, and **in your collection rated**. The primary action changes in each.

### Artist page

Primary: name and discography as an artwork grid. **One interleaved chronological run, newest first — albums, EPs and mixtapes together, never grouped by type. [DECIDED]** Release type is available as a small label on each item, but it never fragments the grid.

**Sortable by release date — newest first and oldest first. [DECIDED 2026-08-20]** Newest is the default, and the date is `albums.first_release_date`. **Undated releases stay last in both directions**, rather than being reversed to the top of an oldest-first run where they would read as the earliest releases instead of as releases with no date.

**Sorting by average rating is deferred, and so is any artist-level aggregate rating.** This line previously carried both as `[INFERRED]`, on the stated grounds that sorting "reuses the collection view's sort machinery". **That rationale no longer holds**: the collection view has no sort machinery, and building it is blocked on product decisions of its own. The question the note asked — whether to ship date-only and defer the rest — was answered in favour of date-only, so artist sorting proceeds independently and collection sorting is **not** a prerequisite for it.

Sorting by popularity waits for the popularity layer in Phase 5.

**The interleaved run stands at the immediate depth boundary, and is a known casualty of the long-term one. [2026-08-23]** "Never grouped by type" was decided when no artist held more than three releases. At the boundary in §8.9 — albums, EPs and mixtapes — a major artist reads as roughly ten to twenty items and the run stays readable. If depth later admits live albums and compilations, sixty items interleaved chronologically with eighteen albums is not a readable run, and this decision reopens. **It is not reopened now**, and it must not be pre-emptively redesigned; see `design-reference.md` §12.

### Profile page

Primary: identity (avatar, display name, handle, bio) and a stat cluster (albums, listened this year, following, followers). Then an overview of sections — recent listens, lists, recent reviews — with the **full collection behind its own tab** rather than dumped onto the profile.

**Tabs: Collection | Want to Listen | Favourites.** **[DECIDED 2026-08-19]** Want to Listen is public and sits on the profile as its own tab; see §10.1. This is the eventual structure — only Collection is built.

**The profile root is an overview, and each full set is its own destination.** **[DECIDED 2026-08-19]** This restates what this section always said — _"the full collection behind its own tab rather than dumped onto the profile"_ — after an implementation rendered the entire collection on the profile root with no limit and no destination to link to.

| Destination            | Holds                                                                                                                          | State         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `/<handle>`            | **Profile overview.** Identity, available statistics, favourites, and a **bounded preview** of the collection                  | **Built**     |
| `/<handle>/collection` | **Full Collection.** The whole collection, `wide` container, paginated                                                         | **Built**     |
| `/<handle>/wishlist`   | **Want to Listen.** Reserved. The album-card control exists; this destination does not, and there is no profile tab or surface | **Not built** |
| `/<handle>/favourites` | **Favourites.** Reserved. The profile row and the album toggle exist; this destination does not                                | **Not built** |

**These are four distinct things and the distinction is load-bearing.** The overview is a summary that links onward; the other three are full sets. The overview is not "the collection page with less on it", and the Collection destination is not "the profile" — they answer different questions and take different containers.

**The two unbuilt paths are reserved, not stubbed.** Nothing renders for them: no route, no tab, no empty section, no placeholder. **The tab bar arrives with the second destination, not before** — one tab is not a tab bar, and inert tabs are an interface for features that do not exist. Reserving a path means the naming is decided so the second destination does not force the first to be renamed; it does not mean anything is drawn.

**The same applies to favourites on the overview.** Its place in the overview's running order is decided — above the collection preview — but until the feature is built the overview renders identity and collection only. An empty `FAVOURITES` heading on every profile would be the scaffold of zeroed counters this spec already rejects.

**The preview's count is the navigation.** The section header's count becomes the link to the full collection, which is the borrowed "count or MORE at the far right" pattern in `design-reference.md` §3 doing the job it was borrowed for.

**A profile must never render an unbounded collection.** The overview shows a fixed preview; the collection destination pages. A 400-album account is the size this product is designed for, and 400 covers on the profile root is not a page.

**Favourites: up to ten pinned albums**, user-ordered, shown as an artwork row near the top of the profile. **[DECIDED]** Ten is more than Letterboxd's four, which changes the layout — it reads as a grid rather than a single row, and at square proportions likely sits as 5×2 or 10-across depending on breakpoint.

### Collection view

An artwork grid, each item showing its cover, your score if any, a like indicator if liked, and a `×N` marker if relistened. **No title and no credit** — the grid is artwork plus a minimal state line, which is the reading `design-reference.md` §11.9 settles. **Sortable — six modes, decided and built; see below.** Filterable by rated/unrated, liked, and reviewed **remains direction rather than a decision**: that option list has never carried a marker, and the questions it raises are unanswered.

The sort list here previously read _"sortable by date, rating, title, artist, release year"_ — five options, unmarked, with "date" ambiguous between the two the entry holds. It is superseded by the six-mode block below, which splits that word into **Added** and **Listened** rather than choosing between them.

No dates are displayed, by decision — the date only orders the grid.

**Default order is `added_at` descending** — most recently added first. **[DECIDED 2026-08-19]** Not `coalesce(listened_on, added_at)`: the collection answers "what have I most recently added", which is a fact about the account, while `listened_on` is a backdatable claim about the past. Ordering by it would let a backfill of old records displace everything added this week, around a date the page never shows. `listened_on` remains available as an explicit sort.

**The full collection is paginated.** **[DECIDED 2026-08-19]** The overview previews **12**; the Collection destination shows **60 per page** with `?page=n`, server-rendered, navigated by `← Newer` / `Page n of m` / `Older →`. The preview count links to the destination **only when there is more to see** — at 12 or fewer it stays plain text rather than pointing at a page showing the same covers.

**Six sort modes, each with one fixed direction. [DECIDED 2026-08-21]**

| Mode                  | Orders by                   | Direction                                    |
| --------------------- | --------------------------- | -------------------------------------------- |
| **Added** _(default)_ | `added_at`                  | Newest first                                 |
| **Listened**          | `listened_on`               | Newest first, **no listen date last**        |
| **Rating**            | `rating`                    | Highest first, **unrated last, still shown** |
| **Title**             | `albums.title`              | A–Z                                          |
| **Artist**            | `albums.display_credit`     | A–Z                                          |
| **Year**              | `albums.first_release_date` | Newest first, **undated last**               |

**There is no ascending / descending toggle.** Each field has one reading worth offering — newest, highest, A–Z — and choosing the mode is the whole choice. This diverges from the artist page's Newest / Oldest pair deliberately: that surface sorts one field, so there direction _is_ the choice, whereas six fields times two directions is twelve addresses for a control that sits above a grid.

**Unrated albums sort last under Rating, and stay visible. [DECIDED 2026-08-21]** Excluding them would have been a reading of _"unrated entries are excluded from averages"_, but that rule is about aggregation. Dropping them here would hide albums from a collection, which is a far larger claim than leaving them out of a mean. `0.0` is a real score and sorts as the lowest one, never as unrated.

**Undated albums sort last under Year**, consistent with the artist-page release-date rule above: an undated release is not the earliest one, it is one with no date. **Entries with no `listened_on` sort last under Listened** for the same reason.

**Title sorts the raw album title — no article stripping**, so _The Bends_ files under T. **Artist sorts `display_credit`**, the credit the album itself carries, so _The Clash_ files under T and _Jay-Z & Kanye West_ under J. An artist's own `sort_name` is deliberately not used here: it is two relations away from a collection entry, and a joint credit has two of them with no rule to choose between.

**Sort state lives in the query string, beside `page`. [DECIDED 2026-08-21]** The bare collection address means Added; the rest are `?sort=listened`, `rating`, `title`, `artist`, `year`. `?sort=added` is a valid address and is never emitted by the control. Anything unrecognised, empty or repeated follows the artist page's convention — the first value wins and anything unrecognised falls back silently to Added, because a malformed sort is not worth a 404. There is no direction parameter, and no client state: every mode is an address the page is server-rendered at.

**Changing sort returns to page 1; paging preserves the sort. [DECIDED 2026-08-21]** Sort links carry no `page` at all, which is what makes the reset true by construction rather than something a redirect has to remember. Pagination links carry the active mode, so paging under Title stays under Title instead of silently reverting.

**The pagination labels follow the axis.** The `← Newer` / `Older →` pair named above is literal only while the leading sort key is a date, so it holds under Added, Listened and Year and gives way to `← Previous` / `Next →` under Rating, Title and Artist. The 2026-08-19 decision chose those words for a collection that could only be ordered by when albums were added; keeping them under a title-sorted page would state something untrue about the ordering on screen.

**The control is public, and withheld below two albums.** It is drawn for owners, visitors and signed-out readers alike — everything user-generated is public, sorting is a read, and a viewer-conditional control would be the first anywhere in the product. At zero or one album it is withheld rather than rendered inert, on the artist page's rule that sorting one thing is meaningless.

**The overview preview is unaffected.** `?sort=` addresses the Collection destination only; the profile's 12-album preview keeps `added_at` descending, because it is a summary rather than the collection with less on it.

**Filtering is not built.** Sorting is. When the filter controls are decided they join the same row above the grid, which is why that row exists as its own element rather than as links crammed into the section header.

### Feed

Reverse-chronological. Each item: who, what they did, the album (with artwork), their score if given, relative time. Review events include an excerpt. List events include a few covers.

### Notifications

A dedicated page listing events directed at you: new followers, likes on your reviews, likes on your lists. Newest first, with an unread count surfaced in the navigation. In-app only — no email, no push, no per-type preferences in v1.

This exists because likes and follows deliberately generate **no feed events**. Without a notifications surface they would be invisible entirely, and a user could be liked fifty times without ever knowing.

### List page

Title, description, author, like count. Then the albums — numbered if ranked, plain grid if not.

### Search

One input, results grouped by albums, artists, users. When an in-scope album isn't in the catalogue, results offer the MusicBrainz fallback with a one-click add.

**The fallback is available for every signed-in search that carries a query, whatever the local catalogue returned. [DECIDED 2026-08-22]** It is not conditional on how many albums matched locally. This is stated explicitly because the implementation had quietly made it conditional — the panel rendered only when the local catalogue returned fewer than five albums, which meant a record the catalogue did not hold could become **unreachable** whenever five loose local matches crowded it out (§8.10). The sentence above always promised the fallback unconditionally; the condition was never a decision, and it is now removed rather than ratified.

**Signed-out searches do not reach MusicBrainz. [DECIDED]** Restating an existing rule because the change above sits next to it: searching an external service on behalf of anonymous traffic is rate-limit exposure longplayr does not take. A signed-out visitor is told the fallback exists and invited to sign in, rather than being shown a thin page that looks like an empty catalogue.

**Local results never wait for the upstream request. [DECIDED 2026-08-22]** Catalogue results, and the local empty state, are shown as soon as the catalogue answers. The MusicBrainz panel arrives separately, beneath them, whenever it arrives.

**When the catalogue holds nothing for a query, that is said immediately** — before MusicBrainz has answered — and the fallback then fills in below it. The two facts are reported when each becomes true rather than being held back until both are known.

**The fallback renders nothing when MusicBrainz returns no eligible result.** An empty panel is not drawn, and neither is a "nothing found upstream" notice; the absence of the section is the answer.

**This makes the fallback reachable. It does not make it faster.** The upstream request costs what it costs — MusicBrainz is rate-limited to one request per second and answers when it answers. What changes is that the rest of the page no longer waits for it. Search latency is recorded separately as an open item and is untouched here.

### Admin

Reports queue with content preview and actions (dismiss, remove, suspend, ban). Not a public surface; access-gated.

---

## 7. Explicitly deferred

| Deferred                    | Reasoning                                                                                                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comments                    | Largest moderation liability in the product. Likes give reciprocity at a fraction of the risk. Revisit once there's a community worth moderating                                                                                                                 |
| Private accounts            | All-public keeps every read path simple — no viewer-permission filtering in feeds, album pages, or search. Retrofitting is genuinely expensive, so this is a real bet, made knowingly                                                                            |
| Track-level anything        | Would double the data model to dilute the album-centric identity. **Still deferred.** §10.7 records a direction in which a track becomes a **catalogue and discovery** object without becoming a social one — that is not a reversal, and does not move this row |
| Streaming OAuth / import    | Adds third-party dependency, ToS exposure, and token management before the core loop is proven. **Still deferred, and passive scrobbling remains a §2 non-goal.** §8.11 records it as a capability under investigation; an investigation is not a scope decision |
| Algorithmic recommendations | Requires a userbase that doesn't exist yet. Collection-overlap recs need collections to overlap                                                                                                                                                                  |
| Per-item list notes         | Additive later without migration, unlike ranked ordering which is settled now                                                                                                                                                                                    |
| Genres and tags             | Useful for discovery, but MusicBrainz genre data needs evaluation before committing                                                                                                                                                                              |
| Year in review              | High organic-growth value, but needs a year of data to exist first                                                                                                                                                                                               |
| Native apps                 | Responsive web first. **Still deferred.** `architecture.md` §19 records the constraints that keep a second client from becoming expensive — which is not a commitment to build one                                                                               |

---

## 8. Open decisions

Listed rather than assumed. Each names who it blocks.

**~~8.1 — Notifications in v1?~~ RESOLVED.** A simple in-app notifications page is in the MVP: new followers, likes on your reviews, likes on your lists, with an unread count. No push or email infrastructure. See §5 Core and §6.

**~~8.2 — Profile page structure.~~ RESOLVED.** Overview with sections, full collection behind its own tab, and **up to ten pinned favourites**. See §6.

**~~8.3 — What "popular this week" means.~~ RESOLVED** — defined below, by me rather than by you, so it's the most likely thing in this document to want changing once there's real activity to look at.

**Popular this week.** Count of **distinct users** who added an album to their collection or marked a relisten, where the _event_ occurred in the last 7 days — measured by `added_at`, not the user-supplied `listened_on`. Ranked descending; ties broken by all-time collection count, then album identifier for stability.

Distinct users is the load-bearing choice: it stops one person relistening an album twenty times from manufacturing a chart position, and it means a user backfilling three hundred albums contributes at most +1 to each.

**This definition is already longplayr's own popularity, and it excludes album likes.** Recorded 2026-08-23 because §8.9 names engagement popularity as a direction that would include hearts. The two must be reconciled when a formula is decided rather than one silently overriding the other — **and this chart definition is the one that is currently decided.**

**Backfilled collection data still counts here, even where it generates no feed events.** Feed silence is about not spamming followers; interest is still interest, and an album someone adds while backfilling is an album they cared enough to record. Note that this is measured by `added_at`, so a backdated `listened_on` has no effect on chart eligibility either way — the same separation the amended feed-eligibility rule makes.

**Highest rated this week.** Albums that received at least one new rating in the last 7 days, ranked by **all-time average**, requiring **at least 5 ratings total** to qualify. Ties broken by rating count.

Ranking by the week's own ratings would be far too noisy at this scale — a single 10.0 would top the chart. Note this threshold governs _chart eligibility only_; album pages still display an average at any rating count, per the one-decimal decision.

**Cold-start fallback.** When either chart yields fewer than 20 albums from internal activity, the remainder is filled from the external popularity source. This is precisely what the `PopularitySource` abstraction exists for, and it's what makes the discovery surface work on launch day when there is essentially no internal activity at all.

Recomputed hourly into a cached table rather than per request.

**~~8.4 — Rate limit for self-service catalogue additions.~~ RESOLVED.** **30 per hour, 100 per day, per user.** **[DECIDED]**

Never touches genuine behaviour — an enthusiastic user filling gaps might add ten or twenty in a sitting — while capping a bad actor at a nuisance. It protects two things: search quality, and the shared MusicBrainz request budget that all ingestion depends on. Expect to revisit the numbers once real usage exists; what mattered was having a ceiling from day one rather than retrofitting one after a cleanup.

**~~8.5 — Can you rate, like, or review an album that isn't in your collection?~~ RESOLVED.** **No — any of those actions implicitly adds it.** **[DECIDED]**

Since a collection entry carries no date requirement, membership is a trivial precondition rather than a meaningful barrier.

**How the implicit add behaves:** it is created with `listened_on` unset and `added_at` set to now, and it generates **no `listened` event**. The triggering action fires its own event normally, so rating produces a `rated` event and reviewing produces a `reviewed` event, while liking produces nothing in the feed.

The reason is that **an event must reflect the action the user actually took.** They rated a record; they did not claim to have listened to it. (This used to be justified by `listened_on` being unset, which stopped being the discriminator when the eligibility rule was amended on 2026-08-18. The behaviour is unchanged; only its justification is, and the new one is sturdier.)

This matters because the alternative would be a surprise: rating an album you'd never logged would otherwise announce to your followers that you'd just listened to it, which you may not have.

**Favourites are the exception** — they are independent of the collection. You may pin an album you haven't added, and pinning does not add it, because a favourite is a statement about taste rather than a record of listening.

**~~8.6 — Artist page discography organisation.~~ RESOLVED.** One interleaved chronological run, newest first, type-agnostic, with sorting. See §6.

**~~8.7 — Review constraints.~~ RESOLVED.** **Plain text with line breaks, maximum 10,000 characters** (~1,700 words) — comfortably an essay, while bounding storage and abuse.

Markdown is deliberately excluded from v1: it adds a sanitisation surface, an editor, and a preview mode, for a product where the writing is short by nature. No spoiler mechanism — the concept doesn't transfer meaningfully to music. **[INFERRED on formatting; you specified length only.]**

**8.8 — Handle rules and reuse.**
Character set, length, reserved names, and whether a deleted account's handle becomes available again. Interacts with the hard-delete decision.

---

**8.9 — Catalogue breadth, depth and popularity. [RESOLVED IN PRINCIPLE 2026-08-23 — raised 2026-08-21 as "curated seed versus external popularity"]**

**The original title was wrong, and so was the question.** This was framed as a choice between a curated seed and an external popularity chart — one axis, two options. There are **three** separable things here, and conflating them is what made the section unanswerable:

|                                                            | Decided                                                                                                                                                                                                                                          | Not decided                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **Breadth** — which artists and albums enter at all        | **Initially curated, eventually open-ended.** The curated set is the primary expression of longplayr's identity; popularity seeding continues alongside it. A curated list is a **bootstrapping mechanism, not the definition of the catalogue** | The list itself                           |
| **Depth** — how much of an artist we hold once they are in | **Completion-oriented.** _If longplayr includes an artist, we aim to include everything we can find for that artist, rather than only their most popular releases_                                                                               | What "complete" means, and its algorithm  |
| **Popularity** — how albums are ranked                     | **A separate signal from membership.** Catalogue membership never depends on popularity                                                                                                                                                          | The formula, and the field question below |

**Do not describe any of this as "curation" in a way that implies a permanently hand-curated finite collection.** It is not one. There is no fixed universe of artists, and an artist absent today is not permanently outside the catalogue. Self-service addition remains a valid route in.

**The measured evidence that reframed the question, 2026-08-23.** The catalogue held 362 albums across 261 artists, and **163 artists (62.5%) held exactly one album**, 94 held two, 4 held three.

**The per-artist cap was not the cause, and this section previously said it was.** It read _"the existing seed capped at 2 albums per artist, **which is why** every artist page currently holds at most three releases and discographies read thin."_ The first clause is true and the causal claim is false. The cap only ever removes an artist's _third and subsequent_ album, so an artist holding one was never capped. Measured from the committed dry run: **140 of the 249 artists in the seed source contributed exactly one album**, and **the artist count is invariant under the cap** — for any cap ≥ 1 the same 249 artists appear, and only the album total moves (249 at cap 1, 358 at cap 2, 497 uncapped). Removing the cap recovers 139 albums, **78 of them in 15 artists, and adds no artist at all.** Fleetwood Mac, Massive Attack, Black Sabbath, The Clash and Depeche Mode each hold one album and none of them was ever capped.

**The binding constraint is that the source is a global _album_ chart**, which selects albums and admits artists incidentally. Depth cannot come from it at any cap.

**The cap therefore has no permanent status.** It survives only as a temporary cold-start device on the popularity seed, at 2, unchanged — reclassified rather than retuned. **"Raise the cap to 5" is explicitly rejected as the product answer.** Once depth exists the cap converges to irrelevance, since a depth pass restores those 139 albums anyway and more evenly.

**A one-album artist page is acceptable for a genuinely one-album artist, and not acceptable as the dominant catalogue state.** `design-reference.md` §5.4 makes the artist page primary for this product; §5 above requires "aggregate signal across their catalogue", which one cover cannot deliver.

**The 27 hand-added albums are evidence, not a specification.** They demonstrate that the seeded catalogue and the product's intent diverge — which is what this section asserted in 2026-08-21 and had never measured. They are 27 records, most added in a single session while testing search, and **no editorial policy has been inferred from them.**

**The immediate implementation boundary, which is narrower than every principle above:**

- **Albums, EPs and mixtapes only.** No live albums, compilations, soundtracks or DJ-mixes yet — even though catalogue scope already admits them, so adding them later is a **depth-policy decision, not a scope decision**
- **Singles excluded**, and **not permanently** — see below
- **MusicBrainz only.** No Discogs
- **Cap 2 retained** on the popularity seed as a temporary mechanism
- **Additive expansion only.** No destructive reseed and no catalogue deletion: `collection_entries`, `favourite_albums` and `want_to_listen` all cascade from `albums`, so deleting a catalogue row deletes user data

**Singles: the boundary is decided, the permanence is not. [AMENDED 2026-08-23]** `CLAUDE.md` previously carried _"Singles are never ingested"_ as a non-negotiable. The exclusion stands for the initial boundary; **the permanence does not.** Completionism should not exclude material by release type as a matter of principle, and there are cases it must eventually reach: an artist who released only singles, a standalone single whose track appears on no album, a unique B-side, and obscure regional or promotional releases carrying material relevant to the eventual completion concept.

**The distinction that has to be preserved is between the single _release_ and the unique _recordings_ it contains.** A conventional single whose A-side already exists on an album may never need to be a separate catalogue object; a standalone recording or unique B-side may eventually need representing as a discovery or completion object, or as a catalogue release. **Which of those is right is undecided and must be asked.** It converges on questions already open — `data-model.md` §11.10 on recording identity, and §10.7 with §11.12 on a track becoming a catalogue and discovery object without becoming a social one. Nothing here adds a `recording_mbid` column, and deferring stays cheap because stored payloads already preserve recording MBIDs (`architecture.md` §19.5).

**One consequence of enforcing scope at ingest, recorded so the future decision is informed.** `architecture.md` §7a keeps every upstream response verbatim so that recovering a field later never costs a round trip per album. **The scope filter is the one place the system discards upstream records outright** — no row, no payload, no ledger of what was rejected. Admitting singles later is therefore a full upstream re-traversal per artist rather than a local reshape. **This is an observation about cost, not a recommendation to build a ledger.**

**Popularity is two concepts, and they are not the same thing. [DECIDED 2026-08-23]**

1. **External source prominence** — what `albums.popularity_score` holds today: an ordinal signal from the active `PopularitySource`, legitimately sparse, meaningless across sources.
2. **longplayr's own engagement popularity** — how many users added an album, hearted it, and possibly other signals later.

**Membership never depends on either.** An album must not become invisible or second-class because no external source has heard of it: measured on 2026-08-23, **all 27 self-service albums carried `popularity_score = null` and all 335 seeded albums carried a score**, an exact correlation, which put every hand-added record last in search and excluded it from Browse Popular outright. **Absence of an external signal must never gate membership, search visibility or discovery, and must never be read as low merit.** It may break ties.

**`popularity_score` is not being redefined as engagement.** Whether these become one field or two is undecided, and it interacts with `architecture.md` §8, whose `PopularitySource` model assumes **one active source writing one field** — a shape that cannot hold two coexisting signals. Note also that longplayr's own popularity is **already partly specified**: §8.3's "Popular this week" counts distinct users who added or relistened, measured by `added_at`. **It deliberately excludes album likes**, which the direction above would include, and that divergence must be reconciled when the formula is decided rather than assumed away.

**Scheduling. [DECIDED 2026-08-23]** Catalogue composition is a **Phase 1 reopening, not Phase 5 work and not building ahead.** Phase 1's definition of done requires "click through to the artist, browse their discography", and a discography of one album does not satisfy it — the same shape of finding as the reachability reopening. **Discovery charts remain Phase 5 and remain undecided**, including whether they carry an editorial voice, which collides with §2's "not a score authority" non-goal. Nothing here decides how Browse Popular should behave once the null filter stops being defensible.

**The operational consequence that most affects sequencing.** `architecture.md` §10 justifies Postgres search on the grounds that the hard problem is disambiguation, naming the popularity signal as one of three levers; §17 then records that **search relevance degrades with catalogue size before it degrades with traffic**; and §8.10 faults 1 and 2 remain unfixed. Depth pushes on all three at once — a much larger catalogue, with the popularity lever now confirmed as legitimately sparse, leaving the two levers that have known faults. **Whether search precision is settled before or after expansion is a planning question, deliberately not answered here.**

**The first curated tranche. [DECIDED 2026-08-24]**

The curated starting set now exists in part. Its **first tranche is the 28 artists followed on Spotify**, selected deliberately from a candidate pool built outside this repository from twenty years of listening history. **It is a starting set, not a whitelist and not a membership boundary** — further tranches will be drawn from the same pool, self-service addition remains a valid route in, and no artist is permanently outside the catalogue.

**Under the immediate boundary above this is 353 albums**, taking the catalogue from 362 to 715. The same artists yield 638 release groups under the full scope filter; the 285-album difference is live albums, compilations, soundtracks and DJ-mixes, which the immediate boundary holds out. **That difference is a depth-policy decision and remains undecided**, exactly as this section already says.

**Identity was established per artist rather than assumed.** Of the 28: **19** confirmed where MusicBrainz's own provider relationship agreed with the identifier already held, **2** of those additionally corroborated by comparing discographies, **5** resolved by looking up the Spotify URL MusicBrainz holds where no identifier was held at all, and **2 settled by human decision** — `K`, via an external identity trail and MusicBrainz's alias and rename relationships, and **The Wake, against two contradictory upstream cross-links**. That last case produced a general architectural rule; see `architecture.md` §19.1. **No artist in the tranche is absent from MusicBrainz.**

**One artist is included and ingests nothing, deliberately.** `K` holds two release groups upstream and both are singles, so under the current boundary she contributes no albums. **This is the singles exception made concrete** rather than a failure of resolution: `CLAUDE.md` already records that a singles-only artist is presently unreachable by every route, and this is what that looks like in practice. She stays in the curated set, and what the catalogue should do for such an artist remains open below.

**Popularity is untouched by this.** These albums carry no external popularity score, which is precisely the case this section already decided must never gate membership. **How Browse Popular should behave once its null filter stops being defensible is still not decided**, and 353 albums makes the question larger without answering it.

**Still unresolved:** the rest of the curated list — the first tranche above is decided, the remainder is not; the definition and algorithm for "complete"; the eventual treatment of singles; regional duplicates, alternate editions, remixes, promos, appearances and reissues; which further release types are admitted and when — **`broadcast` is rejected in code and discussed in no document**; how Discogs would supplement MusicBrainz as enrichment; the longplayr popularity formula and whether likes count; whether the two popularity concepts are one field or two; how discovery consumes popularity; and whether discovery charts receive an editorial voice.

**8.10 — Upstream search: breadth, and whether it matches artists. [PARTLY RESOLVED — raised 2026-08-21; the reachability half decided 2026-08-22]**

Two limitations of the "not in longplayr yet" panel, both observed in use, neither previously recorded.

**It shows at most five candidates**, hard-coded, with no way to ask for more — and it appears at all **only when the local catalogue returns fewer than five album matches**. So an album that exists upstream can be unreachable simply because five local records matched the same words. The local catalogue search itself returns up to 20 albums, 8 artists and 5 users, so the five is specific to the upstream panel.

**It does not match artist names.** The typed string is handed to MusicBrainz's Lucene index for release groups, whose default field is the release-group **title** — so typing an artist returns titles containing that word, not that artist's albums. Field-qualified syntax (`artist:"…"`) is the documented route and would likely work today as an undocumented power-user trick, but **this must be verified against the live API before anything depends on it** — the `referencedTable` finding is the standing reminder that a documented behaviour is not a verified one.

**Observed in use 2026-08-21, and worse than the two limitations above suggest.** Searching for **"the warning" (Hot Chip)**, an album not in the catalogue, returned a page of albums already held — mostly titles beginning with "The" — and **offered no route to add the one being looked for**. Reproduced at the database level; **three faults compound**, and only the third makes the album unreachable:

1. **The fuzzy tier is too permissive for short common words.** `search_albums` falls back to `similarity(title, query) > 0.3`, and trigram similarity is inflated when a short title shares a leading article: measured, `similarity('The Wall', 'the warning')` is **0.4** and matches, while `similarity('The Bends', 'the warning')` is 0.22 and does not. So any short `The …` title in a 338-album catalogue is a candidate.
2. **The `simple` text configuration keeps stopwords.** `websearch_to_tsquery('simple', 'the warning')` yields `'the' & 'warning'`, so "the" is a required lexeme rather than being discarded — which degrades precision for every title containing an article.
3. ~~**The upstream panel is suppressed by exactly the flood the first two produce.**~~ **RESOLVED 2026-08-22.** It rendered only when the local catalogue returned **fewer than five** albums, so noisy local matches removed the only route to the record. **This was the fault that turned a ranking annoyance into a dead end**, and it is the one now decided: the fallback is available for every signed-in query regardless of local result count (§6). **Faults 1 and 2 are untouched** — they still produce the noisy results; they can simply no longer hide the way out.

**Still unresolved, and deliberately not decided alongside the reachability fix:** whether the panel gets a "show more"; whether the fuzzy threshold should rise, be length-aware, or be dropped when the query contains a leading article; whether the text configuration should switch to `english` for stopword removal, and what that costs for non-English titles — the catalogue is deliberately international, and `simple` was chosen for that reason; whether the query should search title _and_ artist, and if so whether that is separate inputs, a blended Lucene query, or a heuristic; and whether any of it is worth doing before the search latency in `current-state.md` §8 is addressed, since every additional upstream candidate is fetched in the render path.

**Follow-ups from manual testing of the shipped fix, 2026-08-23.** Observations from using the deployed product, recorded as **unresolved**. None is decided, none is scheduled, and none should be inferred into scope.

**One is settled, by testing rather than by decision:** the MusicBrainz panel **arriving after the rest of the page reads naturally**. That was the open risk in streaming it — content appearing late is new behaviour for this product — and manual use confirms it works. **No change needed.**

**The rest remain open:**

- **The page is substantially faster** because local results no longer wait. Confirmed, and recorded so a future reader knows the change achieved what it claimed.
- **The remaining ~20-second MusicBrainz wait is still too long.** Making it non-blocking was not a latency fix and was never claimed to be. This is **a separate future performance problem**, tracked alongside the add-path latency in `current-state.md` §8. The candidate levers — streaming was one, queueing the tracklist fetch is another — are unexamined here.
- **Search should not require pressing Enter.** The interaction is **undecided**: search-as-you-type, an explicit button, clearer instruction, or something else. Search-as-you-type in particular interacts badly with a rate-limited upstream call, which is a reason to think rather than a reason to reject.
- **Five upstream suggestions are not enough.** Revisit the limit, and whether the answer is "show more", a different limit, or another discovery mechanism entirely.
- **Upstream candidates should ideally show artwork.** Currently they render the `AddSlot` placeholder, which is deliberate — it distinguishes "could be added" from "held, no cover" — so this is a change to a considered decision rather than a gap. Cover Art Archive is keyed by release-group MBID, which the candidates carry, so the data is reachable; the cost is per-candidate requests on a path already slow.

**These are follow-ups to a shipped feature, not architectural direction.** They belong to Search, not to `product-spec.md` §10.

**The interaction with §8.9 is what made this urgent, and it is now defused.** A larger curated catalogue would have made fault 3 _more_ likely, not less — more local records means more chances that five match loosely enough to hide the fallback. With the gate gone, catalogue growth no longer degrades reachability. Faults 1 and 2 still mean a bigger catalogue produces noisier results, which remains a reason to settle them before a large reseed, but it is no longer a reason a record becomes unreachable.

**8.11 — Listening ingestion: should longplayr accept automatically detected listening? [OPEN — raised 2026-08-22, under investigation]**

**Filed here, and deliberately not in §10, because it is not decided.** §10 records direction that has been chosen; this has not been. It is recorded as a capability to investigate.

**The scope status is unchanged.** §2 still reads _"**Not a scrobbler.** Listening is recorded deliberately by the user, not captured passively"_, and `CLAUDE.md` still lists **passive scrobbling** under _Deliberately not in scope_. Recording an investigation does not move an item off that list — only an explicit scope decision does, by the mechanism `CLAUDE.md` names and that messaging and taste overlap went through.

**The question.** A user who listens through a supported service might have that activity reflected in longplayr without adding every record by hand. Last.fm-style scrobbling is the reference point.

**What must not be assumed:**

- **That Spotify integration is available**, technically or legally. Their terms, their API surface and their attitude to derived listening data are all unexamined here.
- **That Last.fm is the right path**, or any path.
- **That every source behaves alike.** YouTube in particular may offer nothing comparable, so any design that assumes a single provider is wrong before it is written.

**What the investigation would have to answer, none of it inferable:**

- Whether an automatically detected listen creates a **collection entry** at all, or something weaker that never becomes one without a deliberate act.
- **How automatic listening is distinguished from deliberate collection** — §5 of the direction brief requires the distinction, and the current model has **no home for it**: `collection_entries` carries no origin or provenance column.
- Whether automatic listening generates **feed events**. The existing eligibility rule turns on write path — _"an interactive add produces an event; a bulk or imported write does not"_ — which **suggests** silence, but that rule was written about backfills, and reading a scrobble decision out of it would be inference rather than decision.
- How it interacts with **one entry per user per album, permanently**, which is non-negotiable and says nothing about repeated plays beyond the relisten counter.
- Whether ingestion changes what a **rating or review** means when the entry arrived without the user asking for it.

**Nothing here authorises building any of it.**

## 9. Consistency check

- Every §5 core feature maps to a §3 loop step. Two features have no direct loop role: **admin**, which keeps the other surfaces safe, and **notifications**, which exists because likes and follows deliberately produce no feed events and would otherwise be invisible.
- Every §4 decision is reflected in §5 and §6 without contradiction.
- Three decisions were revised mid-definition (core model, rating scale, album requests). All revisions are marked at the point of change.
- One open decision has since been resolved (8.1, notifications) and one partially informed by screenshot analysis (8.2, profile structure).
- No material decision here was made unilaterally. Items marked **[INFERRED]** follow necessarily from explicit decisions and are flagged for correction; items marked **[OPEN]** are unresolved by design.
- **§10 is direction, not scope.** Nothing in it is built, scheduled or implied by §5. Where it supersedes an earlier entry — direct messages, collection-overlap recommendations — the earlier entry is struck through in place rather than deleted, so the reversal stays visible. Two entries in §10.3 are _already_ in scope (avatar and bio) and are recorded there only so they are not mistaken for new work.

---

## 10. Recorded product direction — decided, not implemented

Everything in this section is **decided direction, not built scope**. None of it exists in schema or in code, and none of it is scheduled into a phase yet. It is recorded here so that it survives context resets and so that a future session neither forgets it nor quietly builds it.

Three rules govern this section, and they matter more than the content:

1. **Decided direction is decided.** Where something is marked decided below, it does not need re-litigating, and it supersedes any older entry elsewhere in this document. Superseded entries are annotated at the point of change.
2. **Unresolved questions must be asked, never inferred.** Every question listed under "Ask before implementing" is unresolved _by design_. Answering one silently — by picking the obvious default, by following the reference product, or by reasoning from the rest of the spec — is the specific failure this section exists to prevent.
3. **Preconditions are blocking.** Where a precondition is named, the feature is not startable until it is met.

### 10.1 Want to Listen

**Decided.** A listening wishlist, held **separately from the collection**. The conceptual distinction across all five user–album relations:

| Relation           | Means                               |
| ------------------ | ----------------------------------- |
| **Collection**     | I have listened to this / I hold it |
| **Want to Listen** | I intend to listen to this          |
| **Favourite**      | I particularly value this           |
| **Like**           | Lightweight positive signal         |
| **Relisten**       | I listened to this again            |

**Decided: Want to Listen generates a normal feed event.**

This is a deliberate departure from the volume argument in §4 that keeps likes and follows out of the feed, and it should be understood as such rather than as an oversight. Intent is treated as genuinely interesting social signal here — "I want to hear this" is closer to a review than to a like. The consequence is accepted: wishlist activity is high-frequency, and the feed will carry more of it than it carries listens.

**How this sits against the feed-eligibility rule — resolved 2026-08-18.** The ambiguity flagged here has been closed. `CLAUDE.md` no longer says that only today-dated adds and relistens generate events; it now states the actual invariant — **feed events record interactions, not history** — and says explicitly that it is not an enumeration of event types.

Under that wording Want to Listen needs no special case. Adding to a wishlist is an interaction, it happens at the moment the user acts, and it generates an event. There was never a date to backdate.

**Deferred, and deliberately not to be designed now:** a per-user setting to hide Want to Listen activity from the feed. It is anticipated, it is not being specified, and no schema should be shaped in advance to accommodate it.

#### Resolved 2026-08-18

**The two relations are independent.** An album **can** be both collected and on Want to Listen. Collection means _listened to / held_; Want to Listen means _intent to listen_. They are separate relations with separate lifecycles, not two states of one thing.

This settles the schema question that was blocking Phase 2: Want to Listen is **its own table**, and the collection table needs no status column to accommodate it.

**The clearing rule.** _Any action that causes a collection entry to exist clears Want to Listen for that album._

That covers the explicit add and every implicit one — rating, liking, reviewing and relistening all create a collection entry under §8.5, and all of them therefore clear the wishlist entry. One rule rather than five, so a sixth path added later inherits it automatically instead of being forgotten.

**Read "causes to exist" literally.** **[Clarified 2026-08-19]** The trigger is the entry being _created_, not the mutation being _attempted_. Rating an album already in the collection does not cause the entry to exist — it was already there — so it clears nothing. The first implementation got this wrong and cleared the wishlist on every call, which silently destroyed the legal coexistence the independence decision permits.

**These two facts are not in tension, and the distinction matters when implementing.** The relations are independent in the _schema_; the clearing rule is a **one-directional side effect triggered by collection-entry creation only**. It does not run in the other direction, and it does not run when a wishlist entry is created. An album that is already collected and is _then_ added to Want to Listen therefore stays in both — which is why the schema must permit coexistence even though the common path never produces it.

**Newly surfaced by that resolution, and since answered:** should the interface _offer_ Want to Listen on an album already in the collection? The data model permits it, and whether it is a sensible thing to show a user was a product question rather than a modelling one. **Resolved 2026-08-20 — yes.** See below.

#### Resolved 2026-08-19 — Want to Listen is public, on its own profile tab

**Decided.** Want to Listen is **publicly visible on the profile, as its own tab.**

This keeps the all-public model intact rather than carving the first exception into it, which is what the alternative would have cost: a single private relation would have forced per-viewer filtering into a model that currently admits no exceptions, and §7 names that as the expensive retrofit.

The profile tab structure it implies:

| Collection | Want to Listen | Favourites |
| ---------- | -------------- | ---------- |

**This is the eventual structure, not a build instruction.** Only Collection is being built now. The other two tabs have schema and service support and no interface, and this decision does not schedule either of them.

**What this decision does not answer.** These remain open, and remain subject to the rule that they be asked rather than inferred — being public on the profile settles nothing about any of them:

- Can Want to Listen activity be hidden from the **feed**? (A per-user setting is anticipated in §10.1 above and is still not to be designed, or accommodated in schema, now.)
- Does _removing_ an album from Want to Listen generate a feed event? (Expected no — still ask.)
- Does Want to Listen contribute to any popularity or discovery ranking, or is it purely a social and personal signal?

**Profile visibility and feed visibility are separate questions.** Answering the first did not answer the second, and the two must not be collapsed: a relation can be public on a profile — where someone chooses to look — and still be something a user does not want pushed to every follower.

**Ask before implementing.** None of the three above may be answered by inference.

#### Resolved 2026-08-20 — offered on an already-collected album

**Decided.** Want to Listen is offered **independently in all three collection states**: not collected, collected and unrated, and collected and rated. The control does not depend on collection membership and is not hidden once an album is held.

This follows from the relations being independent rather than from convenience. An album may be collected _and_ wanted at once — §10.1 above already requires the schema to permit that state — and an interface that withheld the control from a collected album would assert an exclusivity the model does not have. Wanting to hear a record again is an ordinary thing to mean.

**What it does not touch.** Want to Listen modifies no other relation: not collection membership, rating, like, relisten, favourite or review. The reverse also holds — wanting an album never removes it from the collection.

**The one-way clearing rule is unchanged by this.** Creating a collection entry still clears that album's Want to Listen row, through the existing rule and the existing path. That rule fires on creation, runs in one direction only, and is not made mutually exclusive by anything here: an album collected first and wanted second stays in both.

**This resolves the interface question only.** It says nothing about the feed, about removal generating an event, or about discovery ranking — those remain open above.

### 10.2 Taste overlap and social discovery

**Decided.** longplayr will have a social layer built on **taste overlap between users** — conceptually similar to Last.fm's musical-compatibility notion. This supersedes the "algorithmic recommendations based on collection overlap" line in §5 _Potential future_, which understated it as a maybe.

Candidate functionality, none of it committed: a similarity score or qualitative label between two users, counts of albums and artists in common, shared favourites, albums one user holds that the other has not heard, and discovering people through overlapping taste.

**The algorithm is explicitly not being decided now.**

**Ask before implementing.**

- What data counts toward similarity — collection only, or favourites, ratings, likes and reviews too?
- Are all albums weighted equally?
- Should widely-held albums contribute less than obscure shared ones?
- Is similarity symmetric?
- Numeric score, qualitative label, or both?
- Where does it surface — profile, search, a dedicated people-discovery surface?

### 10.3 Profile identity

**Decided.** Profiles should read as real people rather than anonymous database rows. The intended fields are **profile photo, short bio, and city/location**.

**Two of the three are already in scope.** §5 _Core_ already specifies "public profile with handle, display name, avatar, short bio", and `data-model.md` already carries `display_name`, `avatar` and `bio` on the profile entity. **Only city/location is new.** This is recorded so nobody treats photo and bio as new scope, or re-decides them.

**Explicitly excluded from the product direction:** relationship status, "looking", age, and dating preferences. longplayr is not a dating service and no dating-specific functionality is to be added. The purpose of these fields is social legibility, not matching.

**Ask before implementing photos.** Upload and storage constraints; image size and format; cropping; deletion; whether EXIF metadata is stripped; reporting and takedown; moderation expectations.

**Ask before implementing location.** Whether only city-level granularity is permitted; whether it is public by default; whether users can hide it; whether it is free text or structured; whether historical location is retained.

EXIF stripping and location granularity interact — photo metadata can carry precise coordinates, so a decision to allow only city-level location is undermined if uploads retain GPS tags. Raise them together.

### 10.4 Direct messaging

**Decided, and this reverses an earlier decision.** §5 _Should probably not exist_ previously read "**Direct messages.** Moderation liability far exceeding their value here." That entry is superseded. Messaging is now **intended functionality from the beginning of the social product**, not a future maybe.

**Purpose.** Low-friction contact between people who have found each other through music taste. It exists to serve the discovery loop in §10.5, not to become the product.

**Constraint.** The simplest viable system. The maintainer is a solo developer and is not building a large ongoing moderation operation.

**This constraint does not imply that zero moderation work is legally or operationally available**, and no design may assume it does.

**Timing, stated precisely (2026-08-18).** Three separate claims, which had been collapsed into one and read as a scheduling instruction:

1. Messaging is **desired from the beginning of the social product**.
2. It is **not necessarily required to exist in the single-user collection phase** — the phase where there is no social graph and therefore nobody to message.
3. What must exist before it ships is a **minimum viable safety and legal layer, not the entire Phase 6 moderation system**.

The third point is the one that changes the plan's shape. The earlier reading — that messaging needs Phase 6's full reports queue and admin tooling — would have pushed it several phases out. It does not. It needs the smallest safety surface that discharges the actual obligations, which is what the legal research below exists to determine. **It remains unscheduled until that research says what that surface is.**

**Initial assumptions, to be treated as NO unless explicitly approved:** no image or file attachments; no read receipts; no typing indicators.

**One thing that is cheaper than it first appears.** Blocking and reporting are **already decisions of record** in §4 _Privacy, safety, moderation_, and blocking is already specified as cutting interaction in both directions while explicitly **not** hiding content. Messaging therefore does not force the all-public model open, and does not require per-viewer visibility filtering to be retrofitted. It extends existing moderation scaffolding rather than inventing it.

**Ask before implementing.** Who may message whom; whether anyone can message anyone or a follow relationship is required; whether first-contact messages are permitted; blocking behaviour for messages specifically; reporting messages and conversations; deleting conversations; retention and deletion policy; what happens to messages when an account is hard-deleted, given that a message has two parties and `CLAUDE.md` treats an orphaned row as a privacy failure; whether blocked users can still see public profiles; spam and rate limiting; whether links are permitted; attachments; read receipts and typing indicators; notification behaviour; abuse handling; account suspension interaction; moderation and admin tooling; privacy expectations.

**Sequencing is unresolved.** The direction was given as "an intended Phase 2 feature", but `development-plan.md` Phase 2 is the **single-user core loop** — follows and the social graph do not exist until Phase 3, so there is nobody to message in Phase 2 as currently planned. The intent recorded is "from the beginning of the social product". **Ask which phase this actually lands in before scheduling it.** Do not resolve this by renumbering phases.

#### Precondition — legal research, blocking

**Before any messaging code is written**, current legal requirements must be researched for a **small Germany/EU-based online service carrying user-generated content and private messaging**. This is a blocking precondition, not a recommendation.

The research must:

- Identify what obligations **actually apply to a service of this size and type**, rather than producing a generic "you need moderation" answer.
- **Distinguish legal requirements from good-practice recommendations**, explicitly and per item.
- **Cite current authoritative sources.**
- **Flag anything requiring professional legal advice** rather than presenting it as settled law.

Specifically to investigate: applicable **Digital Services Act** obligations for a small online platform or hosting service — notice-and-action mechanisms, handling reports of illegal content, statements of reasons for moderation decisions, complaint and appeal handling, and any obligations triggered by hosting and disseminating user content. German national implementation and any transposition specifics must be checked, not assumed to be covered by the DSA text alone.

**Do not assume that being small means having no obligations.** The DSA is proportionate, not exempting; the European Commission describes easy-to-use illegal-content reporting mechanisms and proportionate obligations that reach smaller services. Micro and small enterprises are relieved of some obligations but not all, and the boundaries must be verified against current sources at the time of implementation rather than taken from this paragraph.

**The goal is the minimum viable safety and legal architecture that lets a solo developer offer messaging responsibly** — not a moderation platform.

### 10.6 Quick actions on a tile, and on an upstream search result

**Recorded 2026-08-21. Decided direction; nothing is built and nothing is scheduled.**

**The problem.** Every collection action currently requires a round trip to the album page. Adding an album found through the MusicBrainz fallback means adding it to the _catalogue_, then finding it again, then opening it, then adding it to your _collection_ — and the "Added — view" link that would have shortened that does not render (`current-state.md` §8). Managing a collection of any size means navigating away and back for every single change.

**The direction, in two parts.**

**(a) Adding from MusicBrainz should offer collection in the same gesture.** A record you just went and found is a record you almost certainly want. The catalogue add and the collection add are currently two separate acts separated by two navigations.

**(b) A grid tile should carry quick actions.** On hover, a small control set on the artwork — **add / remove from collection, like / unlike, and add / remove from Want to Listen** — so a wall of covers is something you can act on rather than only look at.

**This does not reopen §11.9 or §11.5 of `design-reference.md`.** Those decide what a tile _displays_: artwork plus a minimal state line, no captions. Quick actions are an interaction layer, not a caption, and the state line stays the record of what is true.

**It does collide with a recorded rejection, and that collision is the hard part.** `CollectionTile`'s own notes reject "hover-reveal as a layout (invisible on touch, so collection state would be unknowable)" and conclude: **"Hover may later _enhance_ Detailed, but must never be required to understand state."** Quick actions are consistent with that as far as _reading_ goes — state stays in the state line — but they raise it again for _acting_: **a hover-only affordance is unreachable on touch**, and touch is not a minority case for a music product. Whatever is built must have a touch answer that is not "hover harder".

**Ask before implementing. None of the following is inferable, and taking the obvious default on any of them is a scope violation:**

- **The touch equivalent.** Always-visible controls on small screens, long-press, a per-tile overflow control, an explicit edit mode, or something else. This is the question the whole feature stands on.
- **Whether quick actions appear on every grid or only some.** Browse, artist discographies, the profile overview, the collection destination and search results are five different surfaces with different intents — acting on someone _else's_ collection tile is meaningless, so at minimum the set is not uniform.
- **Whether they are offered to a signed-out visitor**, and what happens when one is clicked — silently nothing, a prompt, or the control being withheld.
- **What "remove from collection" does here.** Removal destroys the entry, its review and its relisten events, and the album page warns before doing it. A one-click removal from a hover control **must not** be a quieter path to the same destruction, so either it confirms, or it is excluded from the quick set.
- **Whether a like or a Want to Listen from a tile creates a collection entry**, given liking already implicitly adds (§8.5) and Want to Listen is cleared by that same implicit add. The interaction between the three on one control cluster is not obvious and must not be guessed.
- **Whether any of it generates feed events**, which is a Phase 3 question and inherits the rule that an event records an interaction at the moment it happens.
- **How many controls a tile can carry** before the record-shelf reading the grid exists for is damaged — the reference carries none, and `design-reference.md` §8 says the interface is a frame, not a picture.

**Phase.** Unscheduled. Part (a) is reachable inside Phase 2 since every relation it touches exists; part (b) spans surfaces that Phases 3–5 will still be changing, and the touch question should be answered before either is built.

### 10.7 Catalogue depth, and eventual completion

**Recorded 2026-08-22. The completion algorithm is explicitly undecided and must not be inferred.**

> **This section split on 2026-08-23, and only one half moved.** Its **catalogue-depth** half — that once an artist is included the goal is eventual completion of their in-scope body of work — is now **decided product principle**, recorded in §8.9 and in `CLAUDE.md`, with a deliberately narrow immediate boundary **identified and assigned to a Phase 1 reopening — assigned, not scheduled, and blocked on a curated starting set that does not exist yet.** Its **completion** half did not move: everything below about how completion is calculated, whether a percentage is the right framing, and where it would surface remains **direction, not built scope**. **Deepening a discography is not completion tracking.**

The album is longplayr's social object and remains so. This section is about the **catalogue** underneath it becoming capable of representing more of recorded music than a canonical album list does.

**The illustrative case is an artist like Madonna**, whose documented output includes canonical albums, alternate and regional editions, bonus tracks — Japanese bonus tracks being the standing example — deluxe editions, soundtrack appearances, guest appearances, compilation-only material, and recordings that no conventional discography surfaces at all. A catalogue that can only say "here are the twelve albums" cannot describe that artist honestly.

**This absorbs the earlier _Unheard_ concept** — helping a listener find lesser-known material associated with an artist, including recordings a normal discography hides.

**The eventual experience might be something like _"you've heard 80% of this artist's documented output"_**, with the remainder browsable. That phrasing is illustrative, not a specification.

**This paragraph is superseded in part.** It read _"What is decided here is only the constraint, and it is architectural rather than product."_ **That is no longer true**: a product decision on catalogue depth was taken on 2026-08-23 (§8.9). The architectural constraint still stands alongside it — the domain model must not make these relationships impossible to represent later, recorded in `architecture.md` §19 — but it is no longer the only decided thing here.

**Everything else is speculative and must stay that way:**

- **How completion is calculated.** Whether remixes, live recordings, bonus tracks, regional editions, guest appearances, bootlegs and promotional recordings count — and whether they count equally — is **undecided**. There is no default here to fall back on; several defensible answers exist and they produce very different products.
- **Whether a percentage is the right framing at all**, or whether it gamifies listening in a way §7's rejection of gamification would refuse.
- **Whether this ships as an artist-page feature, a discovery surface, or neither.**

**This does not reverse the track decision.** §2 keeps _"Not track-level"_, and `CLAUDE.md` keeps _"Tracks are never rated, reviewed, logged or listed."_ The direction preserved is narrower: an album may remain the only **social** object while a track becomes usable as a **catalogue and discovery** object. That split is coherent, but it is a direction rather than a decision, and it **strains two existing rules** — see §11 of `data-model.md`, where the tension is recorded rather than resolved.

### 10.5 Social philosophy

longplayr is fundamentally a **music collection and discovery product**. The social layer must emerge from taste rather than turning the product into a generic social network.

The intended loop:

```
collection → taste becomes legible → discover people with overlapping taste
    → explore their profiles → discover music → follow / interact → potentially message
```

Messaging **supports** this loop; it does not become the centre of the product. Profile photo, bio and city exist to make people socially legible. Neither is a step toward dating functionality, and dating-specific features are not to be added.

This philosophy is the tie-breaker when a question in this section has no obvious answer: prefer the option that makes taste more legible, and reject the option that makes longplayr more like a general social network.
