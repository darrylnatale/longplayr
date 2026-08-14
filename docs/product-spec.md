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

| Decision        | Value                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomic model    | **Collection.** One entry per user per album, permanently. **[DECIDED — supersedes an earlier "dated diary" choice]**                                                        |
| Adding an album | One click. Date is optional; defaults to today, may be backdated, may be omitted entirely                                                                                    |
| Relistens       | A **count** on the collection entry, incremented by the user. The album still appears once in the collection, marked `×N`                                                    |
| Rating          | **Optional.** 0.0–10.0, one decimal. Updates in place; no history shown. Unrated entries don't count toward averages **[DECIDED — supersedes an earlier 0.5–5 star choice]** |
| Like            | Optional, independent of rating. You can like without scoring and score without liking                                                                                       |
| Review          | **One standing review** per user per album, editable in place                                                                                                                |
| Granularity     | Album only. Tracklists display; tracks are never rateable                                                                                                                    |
| Album identity  | MusicBrainz **release group** is the social object. A collection entry may optionally reference a specific release/edition                                                   |
| Catalogue scope | Albums, EPs, mixtapes — including live albums, compilations, soundtracks. **Singles excluded**                                                                               |
| Timestamps      | Two: `listened_on` (nullable, user-supplied) and `added_at` (always set by the system). Collection sorts by `listened_on` when present, else `added_at`                      |
| Average display | One decimal                                                                                                                                                                  |

### Social

| Decision        | Value                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Follow model    | Asymmetric follow **[INFERRED — standard for this product shape; correct if you want mutual-friend semantics]**                                               |
| Feed contents   | Listens (today-dated adds), relistens, ratings, reviews, list creation/updates                                                                                |
| Feed exclusions | Likes and follows do **not** generate feed events — they'd dominate by volume and crowd out reviews                                                           |
| Silent actions  | Undated and backdated adds populate the collection without generating feed events. This is what makes onboarding backfill possible without flooding followers |
| Feed recency    | Feed shows relative time ("2h"). Profiles show no dates anywhere                                                                                              |
| Interactions    | Likes only. **No comments in v1**                                                                                                                             |
| Notifications   | In-app page only — new followers, likes on your reviews, likes on your lists, with an unread count. No email, no push                                         |

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
| Ingestion       | Seed a popular subset, then fetch on demand and cache                                                                                                                                                                       |
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
- **Richer artist pages** — grouping by type, related artists, aggregate stats.
- **History import** from Last.fm or Spotify, as a bulk collection backfill.
- **Profile favourites** — a small set of pinned albums representing your taste at a glance.
- **Year in review** — the annual personal-stats artifact that drives enormous organic sharing for Letterboxd and Spotify.

### Potential future

- Algorithmic recommendations based on collection overlap.
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
- **Direct messages.** Moderation liability far exceeding their value here.
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

Sortable by release date (newest and oldest first) and by average rating. **[INFERRED — sorting was not previously in MVP scope; adding it here because it reuses the collection view's sort machinery and you flagged wanting it. Say if you'd rather ship date-only and defer sorting.]** Sorting by popularity waits for the popularity layer in Phase 5.

### Profile page

Primary: identity (avatar, display name, handle, bio) and a stat cluster (albums, listened this year, following, followers). Then an overview of sections — recent listens, lists, recent reviews — with the **full collection behind its own tab** rather than dumped onto the profile.

**Favourites: up to ten pinned albums**, user-ordered, shown as an artwork row near the top of the profile. **[DECIDED]** Ten is more than Letterboxd's four, which changes the layout — it reads as a grid rather than a single row, and at square proportions likely sits as 5×2 or 10-across depending on breakpoint.

### Collection view

An artwork grid, each item showing its cover, your score if any, a like indicator if liked, and a `×N` marker if relistened. Sortable by date (using `listened_on` falling back to `added_at`), rating, title, artist, release year. Filterable by rated/unrated, liked, and reviewed.

No dates are displayed, by decision — the date only orders the grid.

### Feed

Reverse-chronological. Each item: who, what they did, the album (with artwork), their score if given, relative time. Review events include an excerpt. List events include a few covers.

### Notifications

A dedicated page listing events directed at you: new followers, likes on your reviews, likes on your lists. Newest first, with an unread count surfaced in the navigation. In-app only — no email, no push, no per-type preferences in v1.

This exists because likes and follows deliberately generate **no feed events**. Without a notifications surface they would be invisible entirely, and a user could be liked fifty times without ever knowing.

### List page

Title, description, author, like count. Then the albums — numbered if ranked, plain grid if not.

### Search

One input, results grouped by albums, artists, users. When an in-scope album isn't in the catalogue, results offer the MusicBrainz fallback with a one-click add.

### Admin

Reports queue with content preview and actions (dismiss, remove, suspend, ban). Not a public surface; access-gated.

---

## 7. Explicitly deferred

| Deferred                    | Reasoning                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comments                    | Largest moderation liability in the product. Likes give reciprocity at a fraction of the risk. Revisit once there's a community worth moderating                                      |
| Private accounts            | All-public keeps every read path simple — no viewer-permission filtering in feeds, album pages, or search. Retrofitting is genuinely expensive, so this is a real bet, made knowingly |
| Track-level anything        | Would double the data model to dilute the album-centric identity                                                                                                                      |
| Streaming OAuth / import    | Adds third-party dependency, ToS exposure, and token management before the core loop is proven                                                                                        |
| Algorithmic recommendations | Requires a userbase that doesn't exist yet. Collection-overlap recs need collections to overlap                                                                                       |
| Per-item list notes         | Additive later without migration, unlike ranked ordering which is settled now                                                                                                         |
| Genres and tags             | Useful for discovery, but MusicBrainz genre data needs evaluation before committing                                                                                                   |
| Year in review              | High organic-growth value, but needs a year of data to exist first                                                                                                                    |
| Native apps                 | Responsive web first                                                                                                                                                                  |

---

## 8. Open decisions

Listed rather than assumed. Each names who it blocks.

**~~8.1 — Notifications in v1?~~ RESOLVED.** A simple in-app notifications page is in the MVP: new followers, likes on your reviews, likes on your lists, with an unread count. No push or email infrastructure. See §5 Core and §6.

**~~8.2 — Profile page structure.~~ RESOLVED.** Overview with sections, full collection behind its own tab, and **up to ten pinned favourites**. See §6.

**~~8.3 — What "popular this week" means.~~ RESOLVED** — defined below, by me rather than by you, so it's the most likely thing in this document to want changing once there's real activity to look at.

**Popular this week.** Count of **distinct users** who added an album to their collection or marked a relisten, where the _event_ occurred in the last 7 days — measured by `added_at`, not the user-supplied `listened_on`. Ranked descending; ties broken by all-time collection count, then album identifier for stability.

Distinct users is the load-bearing choice: it stops one person relistening an album twenty times from manufacturing a chart position, and it means a user backfilling three hundred albums contributes at most +1 to each.

Backdated and undated adds **do** count here, even though they generate no feed events. Silence in the feed is about not spamming followers; interest is still interest.

**Highest rated this week.** Albums that received at least one new rating in the last 7 days, ranked by **all-time average**, requiring **at least 5 ratings total** to qualify. Ties broken by rating count.

Ranking by the week's own ratings would be far too noisy at this scale — a single 10.0 would top the chart. Note this threshold governs _chart eligibility only_; album pages still display an average at any rating count, per the one-decimal decision.

**Cold-start fallback.** When either chart yields fewer than 20 albums from internal activity, the remainder is filled from the external popularity source. This is precisely what the `PopularitySource` abstraction exists for, and it's what makes the discovery surface work on launch day when there is essentially no internal activity at all.

Recomputed hourly into a cached table rather than per request.

**~~8.4 — Rate limit for self-service catalogue additions.~~ RESOLVED.** **30 per hour, 100 per day, per user.** **[DECIDED]**

Never touches genuine behaviour — an enthusiastic user filling gaps might add ten or twenty in a sitting — while capping a bad actor at a nuisance. It protects two things: search quality, and the shared MusicBrainz request budget that all ingestion depends on. Expect to revisit the numbers once real usage exists; what mattered was having a ceiling from day one rather than retrofitting one after a cleanup.

**~~8.5 — Can you rate, like, or review an album that isn't in your collection?~~ RESOLVED.** **No — any of those actions implicitly adds it.** **[DECIDED]**

Since a collection entry carries no date requirement, membership is a trivial precondition rather than a meaningful barrier.

**How the implicit add behaves:** it is created with `listened_on` unset and `added_at` set to now, which makes it a **silent add** under the feed-eligibility rule — it generates no `listened` event. The triggering action fires its own event normally, so rating produces a `rated` event and reviewing produces a `reviewed` event, while liking produces nothing in the feed.

This matters because the alternative would be a surprise: rating an album you'd never logged would otherwise announce to your followers that you'd just listened to it, which you may not have.

**Favourites are the exception** — they are independent of the collection. You may pin an album you haven't added, and pinning does not add it, because a favourite is a statement about taste rather than a record of listening.

**~~8.6 — Artist page discography organisation.~~ RESOLVED.** One interleaved chronological run, newest first, type-agnostic, with sorting. See §6.

**~~8.7 — Review constraints.~~ RESOLVED.** **Plain text with line breaks, maximum 10,000 characters** (~1,700 words) — comfortably an essay, while bounding storage and abuse.

Markdown is deliberately excluded from v1: it adds a sanitisation surface, an editor, and a preview mode, for a product where the writing is short by nature. No spoiler mechanism — the concept doesn't transfer meaningfully to music. **[INFERRED on formatting; you specified length only.]**

**8.8 — Handle rules and reuse.**
Character set, length, reserved names, and whether a deleted account's handle becomes available again. Interacts with the hard-delete decision.

---

## 9. Consistency check

- Every §5 core feature maps to a §3 loop step. Two features have no direct loop role: **admin**, which keeps the other surfaces safe, and **notifications**, which exists because likes and follows deliberately produce no feed events and would otherwise be invisible.
- Every §4 decision is reflected in §5 and §6 without contradiction.
- Three decisions were revised mid-definition (core model, rating scale, album requests). All revisions are marked at the point of change.
- One open decision has since been resolved (8.1, notifications) and one partially informed by screenshot analysis (8.2, profile structure).
- No material decision here was made unilaterally. Items marked **[INFERRED]** follow necessarily from explicit decisions and are flagged for correction; items marked **[OPEN]** are unresolved by design.
