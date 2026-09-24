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
| Follow model    | Asymmetric follow. **[DECIDED 2026-08-30 — confirmed and built.** Previously `[INFERRED]`. Mutual-friend semantics are explicitly not the model, and no surface derives one direction from the other]                                                                                           |
| Feed contents   | Interactive listens (collection adds), relistens, ratings, reviews, list creation/updates, **Want to Listen additions** (§10.1). Not a closed list — it grows by phase                                                                                                                          |
| Feed exclusions | Likes and follows do **not** generate feed events — they'd dominate by volume and crowd out reviews                                                                                                                                                                                             |
| Silent actions  | **Historical and backfilled collection data** populates the collection without generating feed events, which is what makes onboarding backfill possible without flooding followers. **A backdated `listened_on` is not itself a request for silence** — see the amended rule in `data-model.md` |
| Feed recency    | Feed shows relative time ("2h"). Profiles show no dates anywhere                                                                                                                                                                                                                                |
| Interactions    | Likes only. **No comments in v1**                                                                                                                                                                                                                                                               |
| Notifications   | In-app page only — new followers, likes on your reviews, likes on your lists, with an unread count. ~~No email, no push~~ **Push reopened 2026-09-24, §7a. Email remains no**                                                                                                                   |

**Want to Listen additions are in that list and are not yet written. [RECORDED 2026-09-01]** §10.1's decision stands unchanged — Want to Listen generates a normal feed event — but the `Activity` write path does not yet carry that event type, so the first following feed ships without it. **This is a sequencing boundary, not a reversal or a new product decision**: the Feed-contents row above says plainly "Not a closed list — it grows by phase", and this is one of the entries that has not arrived yet. Two questions block it, and both must be asked rather than inferred:

1. Does **removing** an album from Want to Listen generate an event? (§10.1, still `[OPEN]` — "Expected no — still ask".)
2. **Newly identified 2026-09-01:** should **collecting** an album erase a Want to Listen event it had already generated? Any action that creates a collection entry clears the Want to Listen row, so a cascade would take the event with it — silently unsaying "I want to hear this" at the moment the wish is granted. Whether that is correct undoing or the destruction of something that genuinely happened is unresolved.

A later Phase 3 slice owns both, together with the schema change that adds the event type. **Nothing here changes what §10.1 decided**, and the absence must not be read as a reversal of it.

### Lists

| Decision   | Value                                                       |
| ---------- | ----------------------------------------------------------- |
| Scope      | Title, description, albums, optional ranked ordering, likes |
| Not in v1  | Per-item commentary, collaborative lists                    |
| Visibility | **Public. [DECIDED 2026-09-03]**                            |

**Visibility was `[INFERRED from the all-public model]` and is now decided outright**, because Phase 4 slice 1 builds the table and an inference is not a thing a migration can be written against. **There is no visibility column and no privacy control** — everything user-generated is public, so a field with one legal value would be schema implying an option that does not exist.

**Slice 1 of Phase 4 builds the Lists identity and its core surfaces**: create, edit, hard delete, add and remove albums, ranked or unranked, reordering, the public list page and lists on profiles. **Likes on lists, `list_liked` notifications, and list activity events are later slices of the same phase**, and the row above still says likes are in scope for Lists. **`ListLike` remains `[INFERRED]` in `data-model.md` §5 and is not built by slice 1** — that is sequencing, not a change of intent. See `development-plan.md` Phase 4.

### Privacy, safety, moderation

| Decision      | Value                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility    | Everything public. No private accounts, no per-entry visibility                                                                                     |
| Deletion      | **Hard delete.** Collection, ratings, reviews, lists, follows all removed; averages recompute. **The handle is reserved permanently** (§6 Settings) |
| Export        | Users can export their data                                                                                                                         |
| Blocking      | Cuts interaction (follow, like, feed, notifications) in both directions. **Does not hide content** — must be labelled truthfully in the UI          |
| Reporting     | Users can report reviews, lists, and accounts. **Five reasons, §4.1** — one shared list across all three targets                                    |
| Admin actions | Soft-delete content; suspend or ban accounts. Content and users carry status fields from day one                                                    |

#### 4.1 Report reasons **[DECIDED 2026-09-24]**

**Five, and the same five whatever is being reported.**

| Reason                        | Covers                                                             |
| ----------------------------- | ------------------------------------------------------------------ |
| **Spam or advertising**       | Promotion, repetition, anything posted to be seen rather than read |
| **Harassment or hate**        | Directed abuse, and hatred aimed at a group                        |
| **Sexual or violent content** | Material inappropriate to the surface rather than to a person      |
| **Illegal content**           | Kept separate deliberately — see below                             |
| **Something else**            | With optional free text                                            |

**`Illegal content` is separate because it is a different obligation, not a worse adjective.** Under the EU Digital Services Act a notice alleging illegality carries handling duties that a complaint about rudeness does not, and `product-spec.md` §10.4 already records DSA obligations as live for a small service in Germany. **Separating it lets the queue treat it differently rather than discovering the distinction under time pressure.** It invites some misuse — _"illegal because I disagree"_ — which is an acceptable trade at this scale and with one moderator.

**One list across reviews, lists and accounts**, rather than a tailored set per target. A per-target list reads better and triples the thing that must stay consistent with the queue, the enum and the copy; the categories above apply to all three without strain.

**Free text is optional and only on `Something else`.** `product-spec.md` §7 defers comments as _"the largest moderation liability in the product"_, and free text is a smaller version of that concern — **but a report is private to moderators rather than published**, so the liability is a fraction of a comment's. Without it, everything the list failed to anticipate becomes uncategorisable.

**These are not a legal taxonomy** and should not be mistaken for one. They are the shape of a triage queue for a product with one moderator. **§10.4's legal research, still outstanding, is what would tell us whether they are sufficient.**

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

**Accounts** — sign up, sign in, sign out, **reset a forgotten password**, delete account, export data. Email/password plus Google. Public profile with handle, display name, avatar, short bio.

**Password reset was never in this list until 2026-09-24**, and its absence was not a deferral — it was unnoticed. Someone who forgot their password could not sign in, could not delete their account, and could not export their data: **the collection was simply gone.** See `architecture.md` §6.1.

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

**Notifications** — an in-app notifications page: new follower, like on your review, like on your list. Unread count. ~~**No email, no push.**~~ **[PUSH REOPENED 2026-09-24 — see §7a. Email is unchanged and still no.]** **[DECIDED — resolves former open decision 8.1]**

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

### Home

**The front door, and the first definition this section has ever carried for it. [DECIDED 2026-09-05 — Phase 5 slice 3. Approved scope; not implemented.]** §6 has defined nine surfaces and not this one, while the Feed entry below assigns the signed-in home page to Phase 5. This supplies the definition that absence left open.

**Recently added shows albums that have a cover, and one album per artist. [DECIDED 2026-09-16 — approved scope; not implemented]** Browse's lead section applies neither rule today: `getRecentAlbums` is a plain recency query, so a tranche ingesting eight albums by one artist fills a third of the section, and albums with no cover render a placeholder in the product's most prominent grid.

**The conflict this had with the cover-art prompt was put to the maintainer rather than resolved by inference**, because hiding uncovered albums removes the most visible route to the prompt that fixes them. **Hiding won**: the prompt remains reachable from search, artist pages and lists, and the lead grid stays clean.

**Both were settled on 2026-09-16, along with two further questions the cycle raised.**

~~A collaboration counts against its first credited artist only. _Watch the Throne_ spends JAY-Z's slot; Kanye West can still appear with a solo record. The stricter reading was rejected: counting against every credit lets one collaboration block two artists from the entire section, which is a large effect for a rule about visual variety.~~

**REVERSED THE SAME DAY, ON EVIDENCE THE DECISION DID NOT HAVE. [DECIDED 2026-09-16]** The line above is struck rather than deleted, because it was the approved rule and the reasoning it gives is still the cost of what replaced it.

**A collaboration counts against every credited artist.** An album is excluded when **any** of its credited artists has already appeared in the section, and appearing claims **all** of them.

**What changed the answer was looking at the rendered page.** Recently added carried **four albums and one artist**: _A Transparent Night_ by Tame Impala, then three collaborations — with Justice, The Flaming Lips and ZHU — on each of which **Tame Impala is credited second**. Under the first-credit rule all four survived, because Tame Impala led only one of them. **One artist occupying four slots is precisely the failure this rule exists to prevent**, and the decision was taken without that case in front of it.

**The cost the original decision named is real and is now accepted rather than answered.** A collaboration does block its guests: if _Watch the Throne_ appears, Kanye West cannot also appear with a solo record. **The evidence that reversed this shows the cost of the old rule and says nothing about the cost of the new one** — that remains a judgement, and it was made knowingly.

**A middle reading was constructed and rejected, and it is recorded because it is not obvious.** Blocking on any credit while claiming only the first credit's slot fixes the Tame Impala case **and** leaves a guest free to appear later with their own record — strictly better on both known cases. **It was rejected because it still permits a guest to appear twice** before being claimed, a weaker guarantee than the section's purpose wants.

**Which album survives is not a new decision.** The rule keeps the **first** album it sees for an artist, and the query is recency-ordered, so that is their most recent.

**One interaction neither decision examined.** Three of the four albums in the observed case are remix or tour releases, and the cover rule may already remove some of them for an unrelated reason — uncovered albums skew to exactly that material. **The two rules compound here**, and the combined effect is unmeasured.

~~**Read depth is a multiple of what is rendered — roughly eight times.** It scales with the section rather than with the catalogue, which a flat constant does not.~~

**CORRECTED ON MEASUREMENT 2026-09-17.** The struck sentence had it backwards, and the product showed it: **Browse rendered 11 cells of 24 and Home 8 of 12.**

**Depth scales with how clustered the catalogue is, not with how many cells a section draws.** Ingestion is **artist-batched** — a curated tranche or a discography expansion writes an artist's whole catalogue at once — so a recency window is really a window over a handful of artists. Measured on the deployed catalogue: **the 192 most recently added albums held 21 distinct artists**, with Dalida at 37, Radiohead 31 and Belle and Sebastian 24. Home and Browse must read past the same clusters whether they draw 12 cells or 24, so scaling depth off the render count is wrong by construction.

**Measured rather than tuned by feel**: reading 192 yielded 11 survivors, 300 yielded 15, 400 yielded 23, 500 yielded 29 and 700 yielded 47. **Depth is now a fixed 750**, chosen for headroom rather than sufficiency — 400 would fill the section today, and one more large discography landing in front of it would silently shorten the grid again.

**The cover filter was measured and cleared as a cause**: only 22 of the 240 most recent albums lacked a cover.

> **⚠️ This is a scan, accepted knowingly.** There is **no index on `created_at`**, so the read sorts most of the table on the product's two busiest pages. At roughly a thousand albums that costs nothing and **it does not survive growth.** The replacement is known — ask the database for one album per artist directly, bounded by artist count rather than album count — and it needs a migration, which was deliberately not taken here.

**When it still cannot fill, the section under-fills rather than scanning further.** A tranche of uncovered albums by a single artist can defeat any depth, and **an honest short grid is better than an unbounded scan** on the product's front door.

**The two rules are independently reversible.** They are separate options on the query, not one fixed behaviour, because **they move in opposite directions over time**: the cover rule does less as artwork coverage improves and more as catalogue depth grows. Reversing either must be a change at the call site rather than surgery on the query.

**Home and Browse take the same rules at different sizes.** They already read the same query, and §6 holds that the two must never give different answers about what is recent.

**One tension recorded rather than waved away.** Uncovered albums skew toward remixes, demos and live records — measured at 13, 4 and 4 of 45 — and coverage falls as discography depth grows. **So this rule systematically hides that material, and hides more of it over time**, which cuts against §8.9's completion-oriented depth principle and against wanting a catalogue that is not mostly-mainstream. It is accepted with that cost stated.

**An orientation surface carrying one discovery section — not a second catalogue wall.** It shows **Popular this week** (§8.3) and nothing else of the catalogue: no Recently added, no catalogue-size line, no pagination, sorting or filtering. Browse owns the wall and is unchanged. **Home reads the same result Browse reads**, so the two cannot give different answers to what is popular, and it shows **twelve** albums where Browse shows its own larger count. It carries a route onward into the catalogue, which Phase 5's definition of done requires rather than leaves optional.

**The same discovery content for every viewer who can see any.** Signed out, and signed in with a completed profile, both get it — and **the surface does not change shape with the viewer's follow graph.** Following nobody and following people see the same front door. That is a decision rather than an omission: the follow graph is the Feed's subject, the Feed below already distinguishes _following nobody_ from _following people who have done nothing_, and a second follow-conditional surface would answer the same question in two places and let the two drift. `MobileTabBar`'s own reasoning applies to a page as much as to a tab — a destination that moves under the reader is one they have to re-read every time. **No follow-count query, no suggested accounts, no taste overlap, no personalisation.**

**The signed-in-without-a-profile state is untouched.** Decision E makes a completed profile a precondition for collecting, so that state asks for a handle and nothing competes with it.

**When Popular returns nothing the section is not rendered at all** — no heading, no panel, no placeholder, no zeroed count — and the page is exactly what it was before. This is the rule this document already applies to absent favourites and to the Feed's empty states, and Browse already applies it to this same signal. **The Feed's empty-state copy is not borrowed**: the Feed explains why _your_ feed is empty because that is a fact about you, while an absent chart is a fact about the catalogue, and the answer to that is silence.

**Not in scope for the slice that defines this surface:** _Highest rated this week_, which remains Phase 5 work; any change to the Feed; any change to Browse; blending; and everything §10 holds as recorded direction.

### Album page

Primary: artwork, title, artist, year, average rating with count. Then: your entry controls — add / rate / like / review / relisten, and edition if you care. Then: tracklist and editions. Then: reviews from others, most recent first. Then: outbound streaming links.

The page must read correctly in three states: **not in your collection**, **in your collection unrated**, and **in your collection rated**. The primary action changes in each.

**Reviews from others can be liked. [DECIDED 2026-09-02 — Phase 3 slice 4. Decided, not built.]** This is the "Likes only" interaction §4 names, given its first surface. The album page is where it belongs because it is already where other people's reviews are rendered.

| Behaviour                   | Decision                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Toggle                      | Like and unlike, like every other like in the product                                    |
| One per user per review     | Enforced by the database                                                                 |
| Unliking                    | Hard-deletes the like. Unliking what you have not liked is a no-op                       |
| The review is deleted       | Its likes go with it, by cascade                                                         |
| Liking your own review      | **Not offered, and refused** — see the limit below                                       |
| A moderation-removed review | Cannot be liked. It is not publicly readable, and that rule is not restated for likes    |
| Activity                    | **None.** A like is a notification trigger, never a feed event — §4's standing exclusion |
| Notification to the author  | **Decided and not built.** The Notifications slice owns it                               |

**Self-like prevention is a service guarantee, not an integrity boundary**, and the distinction is recorded because the two look alike in use. One like per user per review is enforced by the database; refusing to like your own review is not, because a review's author is not a column on the like. `data-model.md` §5 records why no trigger is added for it.

**Until the Notifications slice lands, a like is visible to nobody but the person who gave it.** That is the expected intermediate state, not an oversight: §6's Notifications surface is the only thing that makes a like legible to its recipient, which is the argument that put it in the MVP at all.

### Artist page

Primary: name and discography as an artwork grid. **One interleaved chronological run, newest first — albums, EPs and mixtapes together, never grouped by type. [DECIDED]** Release type is available as a small label on each item, but it never fragments the grid.

**Sortable by release date — newest first and oldest first. [DECIDED 2026-08-20]** Newest is the default, and the date is `albums.first_release_date`. **Undated releases stay last in both directions**, rather than being reversed to the top of an oldest-first run where they would read as the earliest releases instead of as releases with no date.

**Sorting by average rating is deferred, and so is any artist-level aggregate rating.** This line previously carried both as `[INFERRED]`, on the stated grounds that sorting "reuses the collection view's sort machinery". **That rationale no longer holds**: the collection view has no sort machinery, and building it is blocked on product decisions of its own. The question the note asked — whether to ship date-only and defer the rest — was answered in favour of date-only, so artist sorting proceeds independently and collection sorting is **not** a prerequisite for it.

Sorting by popularity waits for the popularity layer in Phase 5.

**The interleaved run stands at the immediate depth boundary, and is a known casualty of the long-term one. [2026-08-23]** "Never grouped by type" was decided when no artist held more than three releases. At the boundary in §8.9 — albums, EPs and mixtapes — a major artist reads as roughly ten to twenty items and the run stays readable. If depth later admits live albums and compilations, sixty items interleaved chronologically with eighteen albums is not a readable run, and this decision reopens. **It is not reopened now**, and it must not be pre-emptively redesigned; see `design-reference.md` §12.

**The page fills its own discography on first view. [DECIDED 2026-09-07]** Opening an artist longplayr has not yet expanded **enqueues a discography expansion after the response is sent**, and the page itself is unchanged in shape: it renders immediately from the albums already held, and newly discovered ones appear **on a later view**. This is the album page's hydration behaviour applied to a second surface, not a new one.

**While an expansion is outstanding the page says so**, in one quiet line and the same register as the album page's _"Fetching the tracklist from MusicBrainz. Refresh in a moment."_ The reasoning transfers exactly: a page showing one album and saying nothing **implicitly claims that artist has one album**, which is a fact longplayr has not established, and a bare silence reads as a defect rather than as work in progress.

**The line now distinguishes three states, and the missing one was a lie by omission. [DECIDED 2026-09-13 — DECIDED AND DELIBERATELY UNBUILT at the time of writing]**

**The defect.** _"Fetching the rest of this discography"_ rendered whenever an expansion was outstanding, and **nothing rendered when one had terminally failed** — so a discography truncated by a transient upstream error **presented itself as complete.** Radiohead sat in that state for six days after three attempts inside 47 minutes against MusicBrainz load shedding.

| The reader is in this position                                           | The page says                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| More is coming — never attempted, backing off, or re-queued by the sweep | _"Fetching the rest of this discography from MusicBrainz. Look again in a moment."_   |
| **More is coming, but not soon**                                         | **"Couldn't finish fetching this discography from MusicBrainz. It will be retried."** |
| Nothing more is coming                                                   | Nothing                                                                               |

**Three states collapse into one rendering because the reader's action is identical** — come back — **and the fourth differs in kind.** This is the same judgement §6 already applies elsewhere: the page states a fact about longplayr's knowledge, not a report on a job queue.

**"Look again in a moment" earns its horizon now and did not before.** It was written when refreshing could not help; a later view drains a job, so the sentence is both true and actionable. **The failure line carries no horizon at all**, deliberately — the retry depends on a sweep whose timing is not promisable, and an unhonourable horizon is exactly the defect being fixed.

**The error itself is never shown to a reader.** `503 for /release-group — server busy [zone=global remaining=13/15]` is diagnostic text for an operator, and belongs on the surface in `architecture.md` §17a.

**This resolves the question the entry below leaves open** — _"whether an artist page should signal in-progress enrichment at all"_ — in the affirmative, and adds that **it must also signal enrichment that stopped.** The rest of that paragraph stands.

**There is no spinner, skeleton, "load more" control or other new interaction.** A progress indicator would promise a completion time the one-request-per-second ceiling cannot honour — an artist with a hundred release groups queued behind other work may take minutes — and inventing an interaction model is not what this buys. **Whether an artist page should signal in-progress enrichment at all is worth revisiting once real use has been observed; the line above is the honest minimum, not a settled treatment.**

### Profile page

Primary: identity (avatar, display name, handle, bio) and a stat cluster (albums, listened this year, following, followers).

**The stat cluster is built as of 2026-08-30, and carries two of those four. [DECIDED]** Following and followers.

**Albums is deliberately not in the cluster.** It already has an established role in the Collection section header, where **the count is the navigation** — the 2026-08-19 decision below, which remains authoritative. Putting it in both places duplicates the same information without adding a function, and removing it from the Collection section would overturn a decided interaction pattern. Two social statistics are enough to establish the cluster. Recorded because a first implementation did carry it in both places and broke four profile tests on the duplicated string.

**"Listened this year" is deliberately absent, and is not to be added as a substitute third statistic**: whether it means a calendar or a rolling year, and what an entry with no `listened_on` counts as, are undecided, and inventing an answer would settle a product question by implementing it. The following and followers counts are the navigation into their destinations — the same "count becomes the way through" pattern the collection preview uses. A follow control sits in the header for a signed-in visitor on someone else's profile; **signed out, the counts render and no control is offered**, and an anonymous visitor is never redirected to authentication merely for looking. Then an overview of sections — recent listens, lists, recent reviews — with the **full collection behind its own tab** rather than dumped onto the profile.

**Tabs: Collection | Want to Listen | Favourites.** **[DECIDED 2026-08-19]** Want to Listen is public and sits on the profile as its own tab; see §10.1. This is the eventual structure — only Collection is built.

**The profile root is an overview, and each full set is its own destination.** **[DECIDED 2026-08-19]** This restates what this section always said — _"the full collection behind its own tab rather than dumped onto the profile"_ — after an implementation rendered the entire collection on the profile root with no limit and no destination to link to.

| Destination            | Holds                                                                                                                          | State         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `/<handle>`            | **Profile overview.** Identity, available statistics, favourites, and a **bounded preview** of the collection                  | **Built**     |
| `/<handle>/collection` | **Full Collection.** The whole collection, `wide` container, paginated                                                         | **Built**     |
| `/<handle>/wishlist`   | **Want to Listen.** Reserved. The album-card control exists; this destination does not, and there is no profile tab or surface | **Not built** |
| `/<handle>/favourites` | **Favourites.** Reserved. The profile row and the album toggle exist; this destination does not                                | **Not built** |
| `/<handle>/followers`  | **Followers.** The people who follow this account, newest first, paginated at 50                                               | **Built**     |
| `/<handle>/following`  | **Following.** The people this account follows, newest first, paginated at 50                                                  | **Built**     |

**The two relationship destinations are separate addresses, not one page with tabs. [DECIDED 2026-08-30]** They hold different sets, and each profile stat count links to exactly one of them — a combined `/follows` could not express which. They take the `content` container rather than `wide`: every other destination is a cover grid, and this is rows of people.

**These are six distinct things and the distinction is load-bearing.** The overview is a summary that links onward; the other three are full sets. The overview is not "the collection page with less on it", and the Collection destination is not "the profile" — they answer different questions and take different containers.

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

**`/feed` is the feed's address, and the home page is not it. [DECIDED 2026-09-01]** Its own top-level destination, reachable from the navigation at every width. `/` is unchanged and stays the orientation surface that makes no catalogue queries — **the signed-in home page belongs to Phase 5**, along with the cold-start and no-follows states, and claiming it here would settle that phase's work by implementing it.

| Destination | Holds                                                                              | State     |
| ----------- | ---------------------------------------------------------------------------------- | --------- |
| `/feed`     | **Following feed.** The events of the people you follow, newest first, 20 per page | **Built** |

**The navigation entry is present regardless of session state. [DECIDED 2026-09-01]** A nav item that appears on sign-in changes the shape of the bar underneath the user, which the mobile tab bar's own rationale rejects. `You` already resolves to `/login` when signed out, so a nav entry leading to authentication is the established pattern rather than a new one.

**Two item weights, split by event type. [DECIDED 2026-09-01]** This is `design-reference.md` §4's borrowed two-tier feed, resolved onto the event types that exist:

| Weight      | Types                             | Carries                                                                    |
| ----------- | --------------------------------- | -------------------------------------------------------------------------- |
| **Full**    | `reviewed`                        | Cover, actor, album title and credit, their score if given, review excerpt |
| **Compact** | `listened`, `rated`, `relistened` | Avatar, one sentence, relative time, on a quieter row                      |

`design-reference.md` §5.5 asks whether two tiers still earn their complexity, given that we exclude the like and follow events that populate Letterboxd's second tier. They do, and the concern inverts here: the compact tier carries adds, ratings and relistens and will hold most of the volume, while the **full** tier is the thin one. The excerpt is required either way, so a single tier would mean rendering prose inside a one-line row.

**20 per page. [DECIDED 2026-09-01]** Smaller than the collection's 60 and the relationship lists' 50, deliberately: the full review item is the heaviest repeating unit in the product, and the page size has to be safe when a page happens to be all of them. It is a presentation number, not a performance one — pagination bounds the query either way.

**Paginated forward-only by keyset on `(created_at desc, id desc)`, not by numbered pages. [DECIDED 2026-09-01]** One control, `Older →`, with the bare `/feed` as the way back to the top. This is a deliberate departure from the `?page=` convention every other paginated surface uses, and the reasoning is recorded in `architecture.md` §16.1: a feed grows at the top while it is being read, so numbered offsets re-show rows the reader has already passed. No total is computed — "page 3 of 47" is not a fact about a feed worth the scan it would cost.

**Your own activity is not in your feed. [DECIDED 2026-09-01]** The feed holds the events of people you follow and nothing else. Your own actions already have a home in your collection, and because every hand-added album writes its own event (`data-model.md` §11.9), a user backfilling two hundred albums would bury their own feed before anyone else's. A separate `YOU` view is a possible later surface; merging it into this one is not the same thing.

**An event whose subject no longer supports it disappears rather than degrading. [DECIDED 2026-09-01]** Three cases, one behaviour: a `reviewed` event whose review is no longer publicly readable, a `rated` event on an entry whose rating has since been cleared, and any event by a suspended or banned account. `data-model.md` §7 requires that the feed never display a claim that has stopped being true, and a tombstone would advertise a removal to people who never saw the original. **The disappearance costs the reader nothing — a full page is still a full page.** [CORRECTED 2026-09-01] These are conditions of the query rather than a filter applied to its results, so a disqualified event is never counted against the page: 20 items come back whenever 20 qualifying events exist. This sentence previously read _"A page therefore sometimes renders fewer than 20 items"_, which was wrong and is corrected rather than deleted.

**Grouping a burst of adds is deferred, deliberately. [DECIDED 2026-09-01]** Every qualifying event renders as its own item. `data-model.md` §11.9 routed grouping to read time rather than to the write path, and deciding its shape before a feed exists to look at would repeat the error that resolution avoided. Revisit when a real account produces a burst large enough to fill a page — twenty consecutive events from one actor.

**Two empty states, and they say different things. [DECIDED 2026-09-01]** Following nobody is not the same as following people who have done nothing, and one shared message would tell the second reader that they had made a mistake. Neither renders a panel, a heading or a zeroed counter — the rule this spec already applies to absent favourites. The follows-nobody state points at album pages, where other people are currently visible through their reviews; suggested accounts would be §10.2's taste overlap and charts are Phase 5, and neither is to be improvised here.

**Reaching the end of the feed is a third state, and it is not one of the two above. [DECIDED 2026-09-01]** A cursor that returns no rows renders **"You've reached the end of your feed."** with a **Back to top** link. **It is not a 404, and it does not silently redirect or clamp to `/feed`.**

**The decision above is unchanged and still governs an empty feed.** It answers _"why is your feed empty?"_ — a question about contents. This one answers _"why is this page empty?"_ — a question about position in a feed that is not empty at all. They are different questions, and the earlier decision was not wrong for having answered only the first: this case was identified later, during implementation review, and is recorded separately rather than folded backwards into it.

**Why not a 404, when the three profile destinations do exactly that.** Their convention depends on knowing `page > totalPages` — an offset page count makes "this page never existed" a computed fact. **The feed has no total, by the decision above, and its sequence is mutable**: following someone new inserts their older events _below_ a cursor the reader has already passed, so a cursor returning nothing today can legitimately return rows tomorrow. A 404 would assert permanent non-existence about an address that is conditional, which is the same untruth that convention exists to prevent — so honouring its reasoning here means not copying its behaviour. A silent redirect is rejected for the other half of the same convention: it is the clamp, and it throws away the reader's place with no explanation.

**Signed out, `/feed` redirects to `/login`; signed in without a profile, to `/onboarding`. [DECIDED 2026-09-01]** The same treatment `/onboarding` already gives an anonymous visitor. This is not an exception to the all-public model: that rule governs user-generated content, and a feed is not content — it is a per-viewer query whose only input is the viewer's own follow graph, so there is nothing in it to make public. A user without a profile cannot follow anyone, by foreign key, so an empty feed would be an accurate answer to a question they cannot yet ask.

### Notifications

A dedicated page listing events directed at you: new followers, likes on your reviews, likes on your lists. Newest first, with an unread count surfaced in the navigation. In-app only — no email, no push, no per-type preferences in v1.

This exists because likes and follows deliberately generate **no feed events**. Without a notifications surface they would be invisible entirely, and a user could be liked fifty times without ever knowing.

**A follow notification carries a follow button. [DECIDED 2026-09-16 — approved scope]** Someone follows you and you can follow them back **without opening their profile**, which is what the page otherwise forces.

**It shows live state, not the state at the time of the notification.** From somebody you already follow it reads _Following_ and unfollows if pressed — **the same component and the same semantics as the profile**. The notification stays a truthful record of a past event and the control stays a truthful control of the present, which are two different things and should not be conflated.

**Hiding the button once satisfied was rejected**, though it looks tidier: an old notification would then **silently change what it shows**, and _"already followed"_ would be indistinguishable from _"this row has no button"_. **A disabled marker was also rejected** — a control that cannot be used is worse than one that can.

**This is the follow notification only, and deliberately not a general pattern. [DECIDED 2026-09-16]** A liked review and a liked list have **no obvious counterpart action**, so defining one now would be designing for a need nobody has expressed — and `§10.6`'s warning about how many controls a row can carry before it stops reading as a list applies here as much as to a tile. **Both keep their existing link through to the thing that was liked.**

**The cost is a query shape rather than a feature**, and the trap is named because the codebase has recorded it twice already. The page needs the viewer's follow state for **every actor on it**, and `getMyFollow` is single-subject — calling it per row is the N+1 the feed query and the counting contract both warn against. **One batched lookup per page**, and the notification read does not learn who is reading: the follow state is fetched beside it rather than embedded in it.

### List page

Title, description, author, like count. Then the albums — numbered if ranked, plain grid if not.

**Liking a list. [DECIDED 2026-09-04 — not built]** Any signed-in user may like a list that is readable to them; **a user cannot like their own.** Liking is a toggle, and a moderation-removed list cannot be liked by a stranger for the same reason a removed review cannot — it is not publicly readable, and that rule is not restated for likes.

**Self-like prevention is a service guarantee, not an integrity boundary**, exactly as it is for reviews above. One like per user per list is enforced by the database; refusing to like your own list is not, because a list's owner is not a column on the like. **The distinction matters more here than it does on a review**, because this page displays a like count and a review surface does not — see `data-model.md` §5.

**A list like generates a notification to the owner and no feed event**, which is §4's standing exclusion applied unchanged. §8.1 already specifies "likes on your lists" as part of the notifications surface; **that surface does not yet carry them.**

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

### Settings **[DECIDED 2026-09-18 — approved scope; not implemented]**

**There is no settings surface at all today**, and account deletion — a `CLAUDE.md` non-negotiable and a Phase 7 obligation — has nowhere to live. `/settings` is created to hold it.

**It contains account deletion and nothing else.** No display-name editing, no avatar upload, no preferences. Those are separate work with separate decisions; a settings page is not a licence to fill it.

**The surface was already anticipated.** `settings` sits in the handle blocklist as a routing collision, so the handle system reserved the path long before anything was built there.

| Element        | Behaviour                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Access         | Signed-in only, and acts on the viewer's own account. There is no route to delete anyone else's — admin-initiated removal is Phase 6 |
| What it says   | Plainly what deletion does: immediate, permanent, everything goes, **and the handle can never be used again** — including by you     |
| Confirmation   | **Type your own handle.** Not a password                                                                                             |
| After deletion | Signed out, returned to the signed-out home page                                                                                     |

**Confirmation is the handle rather than the password, and the reason is structural.** The stack is email/password **plus Google**, and a Google-authenticated account has no password to re-enter. **A confirmation half the users cannot complete is not a confirmation.** Typing the handle is universal, deliberate, and hard to do by accident.

**Deletion is immediate and total. No grace period, no soft-delete, no recovery window** — the non-negotiable says hard delete, and an account that can be restored is not deleted.

**What survives, and it is two things.** The reserved handle (`data-model.md` §9.5), and `catalogue_additions` rows with their user reference cleared — already designed that way, because the record of what entered the catalogue matters when the person is gone and carries nothing personal once the reference is null. **Nothing else survives.**

**What disappears from other people's surfaces is correct, not collateral.** Likes by the deleted account vanish and counts drop; their follows vanish and follower counts drop; their reviews, ratings, lists and activity vanish. **Album averages need no work at all** — they are computed on read, so there is nothing materialised to go stale.

**Deletion generates no feed event.** The feed invariant records interactions; this removes them.

---

### Browse everything **[DECIDED 2026-09-16 — approved scope; not implemented]**

**There is currently no way to see the whole catalogue.** Browse is two fixed sections with no pagination and no sort, so a record that is neither recent nor externally popular is reachable only by already knowing to search for it. That is F-005, and at 948 albums it is a real gap rather than a theoretical one.

**Decided: a paginated catalogue-wide surface, reached from Browse, sorted only by things the catalogue itself owns** — recently added, release year, title.

**There is no popularity sort, and that follows directly from the prominence decision in §8.3.** An external score exists to complete a chart, never to order a surface. Offering it as a sort would reintroduce by the back door exactly what that decision removed from the front.

**Two constraints inherited rather than invented.** §8.9 holds that **absence of an external signal must never gate discovery**, so a see-everything surface must include albums whose `popularity_score` is null — which is every self-service addition, and which Browse's Popular section excludes by design. And the grid density, captions and artwork sizing all follow `design-reference.md` §11.5 and §11.6 unchanged; **this surface introduces no new grid.**

**Four sorts, and artist is the one the decision did not originally name. [DECIDED 2026-09-16]** Recently added, release year, title **and artist** — because a catalogue wall is the surface where walking by artist is most natural, and the ordering rule for it is **already decided and reused rather than re-argued**: sorted by the album's own `display_credit` rather than an artist's `sort_name`, so _The Clash_ files under T. That was settled on 2026-08-21 for the collection, on the grounds that the alternative needs two joins — unreachable in one PostgREST query — and is **undefined for a joint credit**, which has two sort names and no rule to choose between them. **The same reasoning holds here unchanged.**

**It gets its own sort vocabulary rather than the collection's. [DECIDED 2026-09-16]** The six collection modes include `rating` and `listened`, which **a catalogue has no version of**, and its `added` means _when you added it_ where a catalogue's means _when the catalogue got it_ — **the same word for two different facts.** Sharing the type would let this surface express states it must then reject at runtime.

**Sixty per page, matching the collection. [DECIDED 2026-09-16]** The number is already chosen for a paginated grid of covers in this product, and a reader moving between a collection and the catalogue meets the same rhythm. **A larger page was considered** — a wall is for scanning rather than reading — and rejected because it would make this the heaviest single render in the product.

**Reached by a "See all" link from Browse. [DECIDED 2026-09-16]** Browse keeps its two curated sections and gains one route onward. **A nav item was rejected**: the navigation is deliberately short, and _Browse_ and _All_ sitting beside each other would be two things a reader has to tell apart. **This also answers an open question** — `current-state.md` §11 carries _"whether Browse needs a length boundary at phone width"_, and a see-all link is that boundary.

**Every sort runs both ways, and the direction is a second press on the active one. [DECIDED 2026-09-16]** The page first shipped with four sorts of **one fixed direction each**, which meant the catalogue could be read newest-first but never oldest-first — and `§6` had already decided for the artist page, on 2026-08-20, that release date is wanted **both** ways.

**All four rather than release date alone.** Reversing only the axis that was asked about would leave three that behave differently for no reason a reader could infer. **The cost is eight addressable states instead of four**, and that one of them — oldest added first — is probably the least useful ordering the catalogue has.

**Direction is expressed by pressing the sort that is already active**, with an arrow on it showing which way it runs. **No second control**: the row stays four items, the arrow appears only on the active sort where it means something, and a page that currently has one control keeps having one.

**"Reversed" is relative, because the natural direction differs by axis.** Recently added and release year default **newest first**; title and artist default **A–Z**. The address omits whichever is the default, so **each ordering still has exactly one URL** — the rule the page already applies to its default sort and its first page.

**Undated releases stay last in both directions, and this is inherited rather than decided.** §6 settled it for the artist page on 2026-08-20 with the reason that reversing them to the top of an oldest-first run would make them read as **the earliest releases rather than releases with no date**. The catalogue page already encodes half of it; the direction flip leaves it alone.

**Only the leading clause flips.** Reversing the artist sort gives artists Z–A while **each artist's own albums still read A–Z**, because the tiebreakers are what make the ordering total and stable across a page boundary — and a reader reversing "artist" is asking about artists, not about titles.

**Larger captioned cells, because the sort control requires them. [DECIDED 2026-09-16 — returned from implementation]** The page was first built on the caption-free density that `design-reference.md` §11.5 calls the record-shelf wall, and **rendering it showed the mistake**: three of the four sorts — artist, title and year — order the grid by data that density does not display, so the page reordered itself for reasons **the reader could not see**. §11.5 ties captions to `relaxed` cells and forbids them on `standard`, where a cell tops out near 105px and a credit is unreadable, **so there is no middle option**. Legibility wins over density on the one surface whose purpose is finding a specific record.

**Two alternatives were considered and rejected.** Keeping the dense wall and **dropping the sort control** — defensible, since a caption-free grid is the product's visual identity, but it removes the thing that makes a 948-album page usable. And keeping both and accepting the opacity, which would leave a control that changes the page for unstated reasons.

**Deliberately not decided here:** whether a chosen sort persists across visits, and whether the page ever gains filters — `docs/product-feedback.md` F-041 and F-042 both propose them, and **filtering a surface before it exists is the wrong order.**

### Readable URLs **[DECIDED 2026-09-16 — approved scope; not implemented]**

**Album and artist URLs become readable slugs, and the identifier form stops resolving.** A clean switch rather than a dual-resolving one.

**The timing is the argument.** Four profiles, no real users, and nothing meaningfully shared — so the cost of stranding existing links is **as close to zero as it will ever be**. The identical change after launch would break real bookmarks and real shared links, and would then be worth the redirect machinery this deliberately skips.

**Three constraints this must satisfy, none of them settled here.** A slug is derived from catalogue data, so **slug collisions are inevitable** — two albums share a title far more often than intuition suggests — and the resolution must be deterministic rather than insertion-ordered. The catalogue is **read-only downstream of MusicBrainz**, so an upstream rename changes the source of a slug; whether a slug is stored once or regenerated is an open design question with different failure modes either way. And the MBID remains the **canonical identity** in every case — `architecture.md` §19.1 holds that provider identifiers are enrichment and never identity, and **a slug is weaker still: it is a label, not an identifier.**

### Reaching an artist from a credit **[DECIDED 2026-09-15]**

**A printed credit is a route to the artist, on every surface that prints one.** This is a cross-surface rule rather than a property of one page, recorded here because the defect it fixes was invisible exactly because no surface owned it.

**The defect.** An artist credit rendered as plain text everywhere except the album page. From a grid — Home's discovery section and Browse's captioned lead — the credit was dead text, so **reaching an artist required opening one of their albums first and clicking through from there.** The artist page is `design-reference.md` §5.4's primary surface for this product, and it had one route in.

**Decided: a credit renders as one link per credited artist, and the album page's existing treatment is the model.** The album page already renders `album_artists` names, each linked, comma-separated, falling back to the flat `display_credit` string only when no artist rows exist. That treatment is extended rather than reinvented, so the same record describes its artists the same way wherever it appears.

**The cost is paid in text fidelity on multi-artist records, and it is accepted with the reason stated.** `display_credit` preserves the credit **as printed on the release** — the join phrase and any credited-as spelling. The joined artist names are the canonical ones. Measured against the fixture catalogue, `Jay-Z & Kanye West` renders as `JAY-Z, Kanye West`: the separator changes and so does the spelling. **Single-artist albums are unaffected and are the overwhelming majority**, so the divergence appears only where several artists are credited — and there it buys the thing the rule exists for, which is that **every** credited artist becomes reachable rather than only the first.

**Parsing the credit string was never available.** It is a display string, not a delimited list, and treating it as one would invent structure the catalogue does not hold.

**This trade is not new, and the record should not imply it is.** The album page has made it since it was built. What changes is where it applies, not what it does.

**The cost is larger than the sentence above, and the fuller version was established at STEP D and ratified here rather than discovered later. [RETURNED TO STEP B AND RE-RATIFIED 2026-09-15]** The paragraph above is left as written because it is true; what it missed is that the divergence is not always cosmetic. `display_credit` is the credit **as released** and `artists.name` is the **current canonical** name, so where MusicBrainz has renamed an artist the two are **different names for the same person**, not two spellings of one. `AlbumGrid` already argues this case in writing — _"the record really was credited to Kanye West, and the catalogue is read-only downstream of MusicBrainz, so the two names legitimately differ"_ — and under this decision that credit line **is replaced by the current name, and on that artist's own page it disappears entirely**, because it then equals the page's subject and is suppressed.

**That loss is accepted deliberately, with the alternative in front of it.** Linking the whole credit string to the primary artist would have preserved the as-released text exactly. It was rejected because on an artist page a collaboration credit would then link **back to the page being viewed** rather than to the collaborator — making the single most useful link on that surface the one the rule does not provide. **Reachability of every credited artist is the thing this decision exists to buy**, and it is bought here at a known price rather than an unexamined one.

**The evidence is partial and is recorded as such.** The divergence is confirmed on the fixture catalogue as separator and casing (`Jay-Z & Kanye West` → `JAY-Z, Kanye West`). **The rename case is documented in `AlbumGrid` but was not verified against deployed data**, for which no read path exists from the development host.

**Pseudo-artists are not linked, and this is a deferral rather than an answer. [DECIDED 2026-09-15]** A `Various Artists` credit renders as plain text. Every compilation in the catalogue carries it, so linking it would point many tiles at a single page.

**The reasoning is recorded because the adjacent question must not be answered by accident.** `current-state.md` §11 holds _whether depth applies to pseudo-artists — `Various Artists` above all_ open, and states it must not be answered implicitly. `isExcludedFromExpansion` already prevents an artist-page view from enqueueing expansion for that identifier, so **a link would not itself have answered the depth question** — the suppression here is the narrower choice taken deliberately, so that neither the link nor its absence is mistaken for a ruling. It reuses the same single identifier, and **it is one identifier rather than a class**: MusicBrainz's other special-purpose artists are not covered, for the reason `artist-depth.ts` already records.

**Scope.** The rule binds **Home**, **Browse**, the **list page's ranked rows**, the **artist page** and **search's album results**. It does not bind the **collection grid**, which carries no credit at all by §11.9.

**[SEARCH DEFERRAL CLOSED 2026-09-15.]** This paragraph previously excluded search as _"a known inconsistency for the duration of that deferral"_. The deferral lasted one cycle and is now discharged, so the rule binds every catalogue surface that prints a credit. **The sentence is corrected rather than deleted**, because the inconsistency was real while it stood.

**The upstream panel is excluded by structure, not by choice, and that is a stronger statement than a deferral.** `UpstreamCandidate` carries a flat `credit` string fetched from MusicBrainz for albums **the catalogue does not hold**. There are no `album_artists` rows to resolve, and frequently no artist page to point at — so the panel **cannot** link a credit even in principle, and will not become able to by any decision short of ingesting the album. **This is not revisited when search's local results change.**

**[CORRECTED 2026-09-15 — this said the artist page was unaffected, and that was wrong.]** The artist page suppresses a credit only when it **equals** its own subject, so **collaborations and renames both still render there** and it shares the same `AlbumGrid`. It was in scope whichever way the decision above went. The original sentence is corrected rather than silently replaced because it was the premise of a scope answer.

**Two surfaces that print no credit at all were also found, and they are why this costs less than expected.** Browse's _Popular_ section and an unranked list both render caption-free grids, so neither needs an artist relation and neither changes.

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
| Native apps                 | ~~Responsive web first. **Still deferred.**~~ **[REOPENED 2026-09-24 — see §7a.]** `architecture.md` §19's constraints stop being a precaution and become a requirement                                                                                          |

---

### 7a. Push and a native client, reopened **[DECIDED 2026-09-24 — direction only]**

**Both were `[DECIDED]` against and both are now reopened**, at the maintainer's decision. The stated goal is re-engagement: **push notifications on a phone are what brings people back** (`product-feedback.md` F-054).

> **⚠️ Reopened is not scheduled, and neither is built, designed or assigned to a phase.** What changed is that two closed decisions are open again.

**The narrower option was offered and declined**, and recording that matters: **a PWA can do push on current mobile platforms**, so reopening push alone would have addressed the stated goal without a second client. **Both were reopened deliberately.**

#### What reopening the native client actually costs

**`architecture.md` §19.3 stops being a precaution.** It has said all along that _a second client is plausible_, and `CLAUDE.md`'s domain-logic rule exists because of it — _if a native client would need this rule to behave correctly, it belongs in `src/services/`_. **That rule has been advice. It becomes a requirement**, and every existing drift from it is now debt rather than an accepted wrinkle. `CLAUDE.md` already names two: `shouldOfferFallback` encodes a product rule in `src/app/search/`, and `collectionPath` builds a web URL inside `src/services/`.

**A second codebase, plus app store review, signing, release cadence and version skew.** The web app can deploy on every merge; a native client cannot, so **the service layer acquires a compatibility obligation it has never had.**

#### What reopening push actually costs

**`architecture.md` §16.3 holds notifications to be directed, private and disjoint from the feed** — and in-app only. Push makes them leave the product, which raises questions none of the existing machinery answers: **consent, per-type preferences, and what a notification says when its subject has since been removed or its actor suspended.**

**Consent is not a preference toggle.** Push requires explicit opt-in, and `docs/legal-obligations.md` flags the TDDDG angle for anything touching a user's terminal equipment. **That is a legal question, not a settings screen.**

**Email stays decided against**, and is untouched by this. Only push was reopened.

#### What must be asked before either is built

Which phase owns them; whether push is delivered by PWA or native; which notification types push at all; per-type and per-device preferences; what happens to a queued push whose subject is removed between send and open; quiet hours; and whether a native client is iOS, Android or both. **None has an obvious default.**

## 8. Open decisions

Listed rather than assumed. Each names who it blocks.

**~~8.1 — Notifications in v1?~~ RESOLVED.** A simple in-app notifications page is in the MVP: new followers, likes on your reviews, likes on your lists, with an unread count. No push or email infrastructure. See §5 Core and §6.

**~~8.2 — Profile page structure.~~ RESOLVED.** Overview with sections, full collection behind its own tab, and **up to ten pinned favourites**. See §6.

**~~8.3 — What "popular this week" means.~~ RESOLVED** — defined below, by me rather than by you, so it's the most likely thing in this document to want changing once there's real activity to look at.

**One half of it is now answered, and it is a question this document had never asked. [DECIDED 2026-09-13]** §8.9 decided that **membership never depends on popularity**, and that the absence of an external signal implies nothing about an album's merit. **The converse was unaddressed: does a high external score justify prominence?** Browse behaved as though it does — that is what the fill ordering asserts.

**Answered narrowly: external prominence is a legitimate way to _complete_ a chart, and not a reason to _lead_ a surface.** The external fill and its floor of 20 stand exactly as decided; what changes is that the section carrying mostly-external results is no longer the page's lead. See `design-reference.md` §11.11.

**Hardened from a narrow answer into a standing principle. [DECIDED 2026-09-16]** The paragraph above answered this **contingently**, as part of a cold-start treatment with an exit. It is now unconditional: **an external popularity score exists only to stop a surface looking empty, and never orders a lead section.** Not "not yet", and not "not while the internal chart is thin" — **never**.

**What may still lead is a different thing entirely.** longplayr's own engagement data — what its users actually collect and return to — remains a legitimate basis for prominence. **This decision is about the external signal alone**, and it must not be read as a ruling on the internal one.

**The consequence is that `design-reference.md` §11.11's exit condition narrows rather than disappears.** That section frames "Recently added leads" as reopening when the internal chart reaches §8.3's floor of twenty. **It may still reopen on that trigger** — but what would take the lead is internal activity, and **the external fill can never take it back.**

**Deliberately still not settled:** how longplayr's own engagement popularity and external source prominence reconcile, or whether they become one field or two. §8.9 holds that open, and **this decision does not close it** — it constrains what the external half may be used for without deciding how the two are stored.

**Measured, because the decision rests on a number rather than a preference.** On 2026-09-13 the internal `popular_this_week` chart held **7 entries against a caller limit of 24** — with **4 profiles, 29 collection entries and 2 ratings** in the entire product. **The lead section was therefore roughly 70% external fill.**

**Popular this week.** Count of **distinct users** who added an album to their collection or marked a relisten, where the _event_ occurred in the last 7 days — measured by `added_at`, not the user-supplied `listened_on`. Ranked descending; ties broken by all-time collection count, then album identifier for stability.

Distinct users is the load-bearing choice: it stops one person relistening an album twenty times from manufacturing a chart position, and it means a user backfilling three hundred albums contributes at most +1 to each.

**This definition is already longplayr's own popularity, and it excludes album likes.** Recorded 2026-08-23 because §8.9 names engagement popularity as a direction that would include hearts. The two must be reconciled when a formula is decided rather than one silently overriding the other — **and this chart definition is the one that is currently decided.**

**Backfilled collection data still counts here, even where it generates no feed events.** Feed silence is about not spamming followers; interest is still interest, and an album someone adds while backfilling is an album they cared enough to record. Note that this is measured by `added_at`, so a backdated `listened_on` has no effect on chart eligibility either way — the same separation the amended feed-eligibility rule makes.

**Highest rated this week.** Albums that received at least one new rating in the last 7 days, ranked by **all-time average**, requiring **at least 5 ratings total** to qualify. Ties broken by rating count.

Ranking by the week's own ratings would be far too noisy at this scale — a single 10.0 would top the chart. Note this threshold governs _chart eligibility only_; album pages still display an average at any rating count, per the one-decimal decision.

**Cold-start fallback.** When either chart yields fewer than 20 albums from internal activity, the remainder is filled from the external popularity source. This is precisely what the `PopularitySource` abstraction exists for, and it's what makes the discovery surface work on launch day when there is essentially no internal activity at all.

**The 20 is a floor on chart length. It is not a cap, and it is not derived from any consumer's request. [DECIDED 2026-09-05]** This clarifies the sentence above rather than amending it — the rule and its purpose are unchanged, and what is settled is a relationship the sentence never addressed. **The chart holds every qualifying internal album in internal rank order**; external entries complete it to 20 **only when internal activity yields fewer than that**, and are appended after the internal results rather than interleaved. **Internal results are never truncated to 20**, so a chart with 30 qualifying albums is 30 long. Like the feed's page size, the floor is subject to supply: 20 come back whenever 20 exist to come back.

**A consumer's own limit is independent of the floor and caps separately.** Browse calls `getPopularAlbums(24)` and that 24 is a **rendering cap**, never a fill target: at an empty internal corpus Browse renders the 20 the floor produced, and the section grows toward 24 as longplayr's own activity accumulates. **The 24 is not a product decision and never was** — it is a grid default shared verbatim with _Recently added_, a section with no chart semantics at all, which is why it must not be read as setting the chart's length. **Do not reinterpret the 20 as a target derived from the caller's limit.**

Recomputed hourly into a cached table rather than per request.

**Slice 1 of Phase 5 is "Popular this week", and the definition above is implemented exactly as written. [DECIDED 2026-09-05]** This section anticipated wanting to change _"once there's real activity to look at"_, and **there is none** — the only internal collection data in existence is the twelve-entry staging design fixture. Revising thresholds against a corpus of one fixture user would be preference wearing the clothes of evidence. **This is not a judgement that the thresholds are right, only that nothing available can establish that they are wrong.** The trigger for revisiting them is unchanged and has not fired.

**What slice 1 delivers.** Collection additions and relistens, distinct users, seven days, measured by `added_at`; **persisted as a cached chart and recomputed on a schedule rather than per request**; the cold-start fallback **completing the chart to a floor of 20** when internal activity yields fewer, subject to external supply; and **Browse's existing Popular section as the first consumer**, keeping its own caller limit of 24 as a rendering cap.

**The chart reads collection data, not the feed, and that follows from this section rather than from convenience.** This section requires backfilled collection data to count — _"interest is still interest"_ — while the `activity` table exists precisely to **exclude** backfills, which is a `CLAUDE.md` non-negotiable. Sourcing the chart from `activity` would silently contradict a decided product rule. **Charts and the feed ask different questions about the same act.**

**Excluded from this chart, restated because each was checked rather than assumed.** Ratings belong to _Highest rated this week_ and not here. **Album likes are excluded by this section already.** Reviews are not named by it. `list_created` postdates this section entirely and is a feed event rather than a collection interaction, so it does not count. Follows, review likes and list likes are not statements about an album.

**Distinct-user counting is the entire anti-domination rule.** No weighting, decay or recency curve is decided and none is needed: this section's own two consequences — twenty relistens moving a chart by one, a three-hundred-album backfill adding at most +1 to each — follow from the count alone.

**The deployed recomputation cadence is daily, and the hourly intent above stands.** Vercel's Hobby plan permits one cron execution per day. This is a **platform constraint recorded as a divergence, not a revision**: if the plan changes, hourly needs no further product decision. See `architecture.md` §8.

**Slice 3 consumes this chart on the home page, and ships with it alone. [DECIDED 2026-09-05]** The home surface defined in §6 reads the same result Browse reads, at twelve albums, and **does not wait for _Highest rated this week_**. §3's core-loop table names "Popular / highly rated this week" as what serves discovery for a new user; that table records what serves each step rather than requiring every named item to exist at once, so shipping one is **partial delivery of that row rather than a contradiction of it**, and the row stays partially served until slice 2 lands. **Nothing about the chart, its floor, its refresh or its schedule changes for this**, and slice 3 introduces no migration.

**[OPEN — raised 2026-09-05] _Highest rated this week_ as defined above is not computable from the current schema, and this is recorded rather than solved.** The definition needs to know when an album most recently received a rating, and nothing records that.

- **`collection_entries` carries no rating-specific timestamp.** Its only timestamps are `added_at`, which is row creation, and `updated_at`.
- **`updated_at` cannot stand in for it.** The trigger behind it is `BEFORE UPDATE … FOR EACH ROW` with no `WHEN` clause, and its whole body sets `updated_at = now()`, so it moves for a like, an edited `listened_on`, and a relisten — the relisten-count denormalisation issues its own `UPDATE` against the row.
- **`activity` cannot establish it either.** `activity_one_rated_per_entry` admits at most one `rated` event per entry, so **re-rating creates no new event** and the surviving event's `created_at` is the _first_ rating's time. Clearing and re-rating deletes and recreates the event, producing a timestamp whose product meaning is not obviously the intended one.
- **Backfilled ratings produce no `activity` event at all**, which is the same reason the sibling chart had to read collection data rather than the feed.
- **The cold-start fallback is semantically unresolved for this chart.** The external source is a ListenBrainz listen-count signal; filling a _ratings_ chart from a _popularity_ signal is a category difference this section does not address.

**None of this is decided here, and slice 3 does not touch it.** What "a new rating" means, whether a timestamp column is added and what a backfill of it would mean, whether the chart discriminator is widened, and what the fallback should be, **all belong to the slice 2 decision cycle.**

**Deferred to later Phase 5 slices and not decided here.** _Highest rated this week_; the home discovery surface; **blending** internal and external signals rather than filling; and whether discovery charts carry an editorial voice. **§8.9's question of whether longplayr popularity and external prominence become one field or two is untouched and remains open** — slice 1 adds a materialised chart, and a stored query result is not a second popularity signal.

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

**8.8 — Handle rules and reuse. [REUSE HALF RESOLVED 2026-09-18; the rest stays open.]**
Character set, length and reserved names are **unchanged and still provisional**.

**The reuse half is decided: a deleted handle is reserved permanently and never becomes claimable again.** Taken on the impersonation case — a freed handle makes every old link and mention resolve to a stranger, with nothing in the product to signal the substitution. The mechanism, the tension it creates with hard deletion, and the answer to that tension are recorded in `data-model.md` §9.5.

---

#### 8.9a Singles, and what the catalogue may hold **[DECIDED 2026-09-24 — resolves F-011 and F-040]**

**A single is a full catalogue release.** A row like any album: it appears in discographies and **can be collected, rated, reviewed and listed.** The alternatives — a findable-but-not-collectable _discovery object_, or representing only the unique recordings a single contains — were considered and rejected. The first invents a second kind of catalogue thing that every surface must then distinguish; the second needs track-level identity, which `CLAUDE.md` constrains with _tracks are never rated, reviewed, logged or listed_.

**The cost is real and accepted**: _one entry per user per album, permanently_ now spans singles, so a collection can fill with two-minute releases. That is the price of a catalogue that is completion-oriented in depth.

##### The discography: singles hidden by default, and §6 survives intact

**§6's rule — one interleaved chronological run, never grouped by type — is not reversed.** It was settled when no artist held more than three releases, and §5 of `product-feedback.md` has flagged since August that admitting singles would make the conflict live: **an artist with forty singles buries their eight albums.**

**The answer is a filter, not a grouping.** Singles are excluded from the discography by default, with a control to include them. **When everything is shown it is still one interleaved chronological run**, which is exactly what §6 decided. Nothing is grouped by type at any point.

**This was chosen deliberately over reversing §6.** Grouping is what most music sites do and reads conventionally; §6 rejected it on purpose, and reversing a deliberate decision should itself be deliberate rather than a side effect of admitting singles.

##### The catalogue may hold what MusicBrainz will not — decided, unscheduled, unbuilt

**`CLAUDE.md`'s non-negotiable was amended on 2026-09-24**, removing _"no user-authored metadata, ever"_. The reason is concrete: **a musician who self-releases a single track should be findable even where no official release exists.**

> **⚠️ Decided is not scheduled, and this is further from built than anything else in this document.**
>
> **The first question is not technical.** MusicBrainz accepts bootlegs, demos, DJ mixes and self-released material, so **most cases this exception was opened for are addressable upstream** — and §8.9 already decided contributing upstream is the strategy. **What genuinely cannot go upstream is unestablished.** Building an exception for a case that turns out not to exist is the expensive mistake available here, and establishing it is the first work rather than the last.
>
> **Three technical consequences are already visible.** `albums`, `artists` and `releases` all declare `mbid` **`not null unique`** — three tables and every relation through them. **Cover Art Archive is keyed by release-group MBID with no fallback source**, so a user-authored album has **no artwork path at all**. **ListenBrainz popularity is MBID-keyed**, so such a record can never carry a popularity signal.
>
> **And four questions must be asked rather than inferred**: who may author a record — any user, or an admin? What happens when the same record later appears in MusicBrainz? Who corrects a wrong one, given the catalogue has never needed an editing surface? What stops a user-authored row duplicating an MBID row that already exists? **None has an obvious default, and answering one silently would be a scope violation.**

**`architecture.md` §19.1 is untouched and still holds.** Canonical identity stays MusicBrainz-shaped; a provider identifier is enrichment, never identity. **This exception concerns records MusicBrainz does not have — not a second source of truth for records it does.**

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

### Closing a gap means fixing it upstream **[DECIDED 2026-09-16]**

**When the catalogue is missing something, longplayr's job is to notice the gap and route someone to fix it at the source** — never to author the metadata itself. A missing cover goes to Cover Art Archive; a missing release or artist goes to MusicBrainz. longplayr then collects the result through the ingest path it already has.

**This is now a stated principle rather than an occasional habit**, which is the question F-008 raised: the answer kept being _"add it upstream"_ without that ever being written down.

**It costs no rules, and that is why it works.** The catalogue stays read-only downstream of MusicBrainz, artwork stays single-sourced, nothing user-authored is stored here, and the material becomes permanent and benefits every consumer of those databases rather than only this product.

**The first surface it authorises: an album page with no cover offers a route to add one. [DECIDED 2026-09-16]** The image lands at Cover Art Archive and the existing `fetch_artwork` job collects it with no code change. This is the public half of the operator worklist already shipped (`architecture.md` §17b) — the worklist tells the maintainer what is missing; this lets anyone looking at the record do something about it.

**The prompt's rules, settled 2026-09-16.** It appears **only where Cover Art Archive has answered and holds nothing** — `absent`. Not on `pending`, where the fetch has not run and art may well be waiting; not on `failed`, which is our own error and is already being retried. **Every prompt shown is therefore a real task**, and the rule has a useful side effect: it makes the difference between _not fetched yet_ and _none exists_ visible to a reader for the first time, which is part of what F-038 asks for.

**It is shown to everyone, signed in or not.** The work happens at MusicBrainz and needs an account **there**, not here, so a longplayr session is not what gates it and requiring one would turn away help.

**No prompt is shown when the album has no representative release**, because there is no page to send anyone to. The operator worklist lists those rows with the reason, since a count that disagrees with its list is an operator's problem; **a reader does not need that and "no release to link to" is jargon on an album page.**

> **⚠️ The prompt required a second decision to work at all, and it was found before building.** An album marked `absent` was **never re-checked** — `found` and `absent` were both treated as settled. So a cover uploaded after being prompted would have been **invisible to longplayr forever.** `absent` now re-enters the artwork sweep behind a staleness window; `architecture.md` §7 carries it and the reasoning, including why Cover Art Archive's **absence of any rate limit** makes it affordable. **A prompt without that is worse than no prompt.**

**Recorded as direction and deliberately not scheduled:** the same treatment for a **missing release** — a reader who knows an album should be there is routed to add it to MusicBrainz. **Marked explicitly as a decision for later** at the point it was raised, and it must not be inferred into scope from the artwork decision above.

> **⚠️ An unresolved conflict was opened by this decision and must not be answered by inference. [OPEN 2026-09-16]**
>
> The principle assumes anything longplayr wants is admissible upstream. **That may not hold.** The examples raised were **DJ mixes, remixes and bootlegs** — material MusicBrainz might not accept.
>
> **If longplayr ever holds what MusicBrainz will not, it must author that metadata**, which `CLAUDE.md` forbids outright: _"The catalogue is read-only downstream of MusicBrainz. No user-authored metadata, ever."_ **There is no third option**, so this is a genuine collision between a new principle and a non-negotiable.
>
> **The premise may also be largely wrong, and verifying it could dissolve the conflict entirely.** MusicBrainz appears considerably more permissive than assumed — secondary release-group types reportedly include **DJ-mix, Remix, Live, Compilation, Soundtrack, Mixtape/Street and Demo**, with **Bootleg** available as a release status. **This is unverified to this project's standard and must not be relied on**; it is recorded as a `[VERIFY]` row in `architecture.md` §18.
>
> **The question to answer is scope, not tooling:** can longplayr ever hold material MusicBrainz will not? It is filed as a question rather than settled here.

**Singles: the boundary is decided, the permanence is not. [AMENDED 2026-08-23]** `CLAUDE.md` previously carried _"Singles are never ingested"_ as a non-negotiable. The exclusion stands for the initial boundary; **the permanence does not.** Completionism should not exclude material by release type as a matter of principle, and there are cases it must eventually reach: an artist who released only singles, a standalone single whose track appears on no album, a unique B-side, and obscure regional or promotional releases carrying material relevant to the eventual completion concept.

**The distinction that has to be preserved is between the single _release_ and the unique _recordings_ it contains.** A conventional single whose A-side already exists on an album may never need to be a separate catalogue object; a standalone recording or unique B-side may eventually need representing as a discovery or completion object, or as a catalogue release. **Which of those is right is undecided and must be asked.** It converges on questions already open — `data-model.md` §11.10 on recording identity, and §10.7 with §11.12 on a track becoming a catalogue and discovery object without becoming a social one. Nothing here adds a `recording_mbid` column, and deferring stays cheap because stored payloads already preserve recording MBIDs (`architecture.md` §19.5).

**One consequence of enforcing scope at ingest, recorded so the future decision is informed.** `architecture.md` §7a keeps every upstream response verbatim so that recovering a field later never costs a round trip per album. **The scope filter is the one place the system discards upstream records outright** — no row, no payload, no ledger of what was rejected. Admitting singles later is therefore a full upstream re-traversal per artist rather than a local reshape. **This is an observation about cost, not a recommendation to build a ledger.**

**Popularity is two concepts, and they are not the same thing. [DECIDED 2026-08-23]**

1. **External source prominence** — what `albums.popularity_score` holds today: an ordinal signal from the active `PopularitySource`, legitimately sparse, meaningless across sources.
2. **longplayr's own engagement popularity** — how many users added an album, hearted it, and possibly other signals later.

**Membership never depends on either.** An album must not become invisible or second-class because no external source has heard of it: measured on 2026-08-23, **all 27 self-service albums carried `popularity_score = null` and all 335 seeded albums carried a score**, an exact correlation, which put every hand-added record last in search and excluded it from Browse Popular outright. **Absence of an external signal must never gate membership, search visibility or discovery, and must never be read as low merit.** It may break ties.

**`popularity_score` is not being redefined as engagement.** Whether these become one field or two is undecided, and it interacts with `architecture.md` §8, whose `PopularitySource` model assumes **one active source writing one field** — a shape that cannot hold two coexisting signals. Note also that longplayr's own popularity is **already partly specified**: §8.3's "Popular this week" counts distinct users who added or relistened, measured by `added_at`. **It deliberately excludes album likes**, which the direction above would include, and that divergence must be reconciled when the formula is decided rather than assumed away.

**On-demand artist depth. [DECIDED 2026-09-07]**

**The 62.5% finding above is addressed by expanding an artist's discography when someone opens their page**, rather than by a larger seed, a raised cap or a new source. The evidence is unchanged and is not restated: 163 of 261 artists holding exactly one album, against a Phase 1 definition of done that requires clicking through to an artist and browsing their discography.

**It is triggered by first view, once per artist.** Opening an artist page enqueues an expansion **after the response**, for an artist that has **not previously had one attempted**. There is **no staleness rule and no revisit** in this decision, and failures are governed entirely by the existing job-queue retry policy rather than by a new one.

**The guarantee is "once per artist for as long as its job record survives", and that is the approved rule rather than an approximation of it. [RATIFIED 2026-09-07]** There is no artist-level column recording expansion, and this slice deliberately adds none, so "has this been attempted" is read from the discovery job's own history in `ingestion_jobs`. **That makes the rule conditional on those rows persisting**, and the wording above is narrowed here to say so rather than promising a permanence the mechanism does not provide.

**The condition holds today, established by measurement rather than assumed.** No production code deletes a job row — every access in the service layer is an insert, a select or a status update, and neither cron route purges. The five test files that empty the table are fenced to a local database by a setup guard that refuses to run against anything else. Nothing in any document records an intent to purge, prune or archive jobs, and the queue's own repair decision returns stranded rows to `pending` rather than deleting them. Growth creates no pressure either: roughly two to three rows per album, on the order of two thousand at the present catalogue.

**What losing those rows would cost, since that is the question the narrower wording raises.** One MusicBrainz browse request per artist, once, incurred as those artist pages are next viewed and drained at background priority behind interactive work. **No album is duplicated and no data is corrupted** — re-expansion is idempotent, de-duplicating by release-group MBID and counting already-held albums rather than recreating them. **One effect is a repair rather than a cost**: an artist whose single attempt terminally failed, and which is otherwise permanently unexpanded, would get a fresh one.

**A discography now refreshes on view when it is stale. [DECIDED 2026-09-16 — amends "no staleness rule and no revisit" above]** Opening an artist page re-queues expansion when the last one was long enough ago. **Work follows attention**: an artist nobody looks at costs nothing, and an artist people do look at stays current. This answers F-029, which observed that a release issued after an artist's first expansion would otherwise **never** appear.

**It repairs terminal failure as a side effect**, exactly as the paragraph above anticipates — an artist whose single attempt exhausted its retries stops being permanently unexpanded.

> **⚠️ The hazard this must be designed against, carried forward to its implementation cycle.** The _once per artist_ rule exists precisely to stop a page view restarting the retry policy — `attemptStateFor` has always warned against it, and the sweep owns failure retries for that reason. **A staleness window must not become that loop under another name.**
>
> **The distinction to preserve is that a refresh and a retry are different events.** A refresh is scheduled against elapsed time since a **successful** expansion; a retry is a response to failure and belongs to the queue. **If the implementation cannot tell them apart, it is wrong**, and the correct move is to return that to STEP B rather than ship the approximation.
>
> **Settled 2026-09-17, and the hazard above is what shaped all three answers.**

**The window is 30 days, matching the artwork re-check.** `architecture.md` §7 already chose that figure for re-examining a settled-absent cover, and **one staleness idea is easier to reason about than two.** Seven days would roughly quadruple upstream traffic against a limit where exceeding one request per second returns `503` for **every** request from this address — and most artists release nothing in any given week.

**Only a _successful_ expansion goes stale, and this is the whole answer to the hazard.** A terminally failed artist stays the recovery sweep's job. **So a page view can never restart the three-attempt policy**, and a refresh and a retry remain different events rather than the same event under two names. **Refreshing failures was rejected** despite repairing stuck artists sooner: it would re-queue a failing artist every time its window elapsed and somebody visited, which is a slow version of exactly the loop this rule exists to prevent.

**The reader is told nothing.** The discography already shown is complete as far as the product knows; a refresh looks for **additions**. The existing status line — _"Fetching the rest of this discography…"_ — belongs to a genuinely unfinished first fetch, and reusing it would **claim the grid is incomplete when it is not**.

**One thing the queue already anticipated.** The partial unique index covers only `pending` and `running`, and its own comment says _"a re-sync, say"_ — **a completed job does not block re-queueing**, so this needs no schema change. `ingestion_jobs.updated_at` supplies the completion time, so **no migration**.

**The alternative was widening the boundary to permit an artist-level column, and it was declined.** That would make the guarantee unconditional and put artist state on the artist, at the cost of a schema change and a deployed migration. It remains available if a purge is ever contemplated, and **contemplating one is the trigger to revisit this**.

**"Needs expansion" means no expansion has been attempted — not an album count.** An artist already expanded is as complete as the current boundary allows however few albums that yields, and **some artists genuinely have one album**; a count threshold would re-fire on them forever while an attempt record fires once and stops.

**It populates the catalogue.** Discovered release groups are ingested as **minimally hydrated album rows**, exactly as the curated tranche does — not fetched and displayed as upstream results. The alternative would put objects on the artist page that cannot be collected, rated, reviewed or listed, in a surface that otherwise means _held_. It also makes the improvement shared: one reader opening an artist page enriches the catalogue for everyone.

**The boundary is used unchanged and is not reopened.** Expansion applies `withinCurrentDepth` exactly as it stands, so **live albums, compilations, soundtracks and DJ-mixes stay outside it**. The 285-album difference this section already records **remains deferred and is not resolved here** — deciding it under cover of a reach improvement would be a boundary change wearing a different name, and nothing about the value of this depends on it.

**Provenance does not matter.** The rule applies to every artist the catalogue holds, **whether they arrived through curation or through a self-service add**. `CLAUDE.md` holds that once an artist is included the goal is eventual completion of their in-scope body of work; an artist present because a user added one of their albums **is included**. The job kind's `curated` name is an artefact of where the capability was first used, not a policy boundary.

**Pseudo-artists are excluded from automatic expansion, and that is a scope deferral rather than a ruling.** `Various Artists` above all. Whether depth applies to pseudo-artists is recorded as open and must not be answered implicitly — which is precisely what letting the trigger fire on every artist page would do the first time someone opened one. **If that question is later answered affirmatively the exclusion lifts without reopening anything decided here.**

**The seeding cap is untouched, because it governs a different path.** `DEFAULT_MAX_PER_ARTIST = 2` belongs to the cold-start selection path and its own note already calls it a cold-start device rather than a catalogue rule; the expansion path never consults it. **A seeded artist held at two albums may therefore end up with a full discography**, which is intended and consistent with there being no permanent per-artist cap.

**What this decision does not claim.** It does not make the artist catalogue complete, does not reopen the depth boundary, does not resolve pseudo-artist policy, does not introduce re-expansion or staleness, and does not establish that every MusicBrainz release group for an artist is now held. **It adds on-demand expansion within the boundary that already exists.**

**Scheduling. [DECIDED 2026-08-23]** Catalogue composition is a **Phase 1 reopening, not Phase 5 work and not building ahead.** Phase 1's definition of done requires "click through to the artist, browse their discography", and a discography of one album does not satisfy it — the same shape of finding as the reachability reopening. **Discovery charts remain Phase 5 and remain undecided**, including whether they carry an editorial voice, which collides with §2's "not a score authority" non-goal. Nothing here decides how Browse Popular should behave once the null filter stops being defensible.

**The operational consequence that most affects sequencing.** `architecture.md` §10 justifies Postgres search on the grounds that the hard problem is disambiguation, naming the popularity signal as one of three levers; §17 then records that **search relevance degrades with catalogue size before it degrades with traffic**; and §8.10 faults 1 and 2 remain unfixed. Depth pushes on all three at once — a much larger catalogue, with the popularity lever now confirmed as legitimately sparse, leaving the two levers that have known faults. **Whether search precision is settled before or after expansion is a planning question, deliberately not answered here.**

**The first curated tranche. [DECIDED 2026-08-24]**

The curated starting set now exists in part. Its **first tranche is the 28 artists followed on Spotify**, selected deliberately from a candidate pool built outside this repository from twenty years of listening history. **It is a starting set, not a whitelist and not a membership boundary** — further tranches will be drawn from the same pool, self-service addition remains a valid route in, and no artist is permanently outside the catalogue.

**Under the immediate boundary above this is 353 albums**, taking the catalogue from 362 to 715. The same artists yield 638 release groups under the full scope filter; the 285-album difference is live albums, compilations, soundtracks and DJ-mixes, which the immediate boundary holds out. **That difference is a depth-policy decision and remains undecided**, exactly as this section already says.

**Identity was established per artist rather than assumed.** Of the 28: **19** confirmed where MusicBrainz's own provider relationship agreed with the identifier already held, **2** of those additionally corroborated by comparing discographies, **5** resolved by looking up the Spotify URL MusicBrainz holds where no identifier was held at all, and **2 settled by human decision** — `K`, via an external identity trail and MusicBrainz's alias and rename relationships, and **The Wake, against two contradictory upstream cross-links**. That last case produced a general architectural rule; see `architecture.md` §19.1. **No artist in the tranche is absent from MusicBrainz.**

**One artist is included and ingests nothing, deliberately.** `K` holds two release groups upstream and both are singles, so under the current boundary she contributes no albums. **This is the singles exception made concrete** rather than a failure of resolution: `CLAUDE.md` already records that a singles-only artist is presently unreachable by every route, and this is what that looks like in practice. She stays in the curated set, and what the catalogue should do for such an artist remains open below.

**Popularity is untouched by this.** These albums carry no external popularity score, which is precisely the case this section already decided must never gate membership. **How Browse Popular should behave once its null filter stops being defensible is still not decided**, and 353 albums makes the question larger without answering it.

**Ingestion terms for the first tranche. [DECIDED 2026-08-24]**

**The tranche is approved for ingestion**, against **staging**, by the documented procedure in `docs/staging-setup.md`. **It must never run against the local database or any database the integration suite touches** — that suite truncates `albums` and `artists`, and on a database holding users the truncation cascades into their collections.

**Four decisions, and the distinction between resolved and deferred is load-bearing:**

|                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ingest the 28 now**     | **RESOLVED.** Deferring had no exit criterion — this section decided there is **no target size** and that the list emerges from curation, so no measurable state exists at which the set becomes "ready". Against that, the tranche is verified in one run and **reversible today**, since no user holds a collection, favourite or wishlist entry on any curated album. That reversibility expires when real users arrive.                                                                                                                 |
| **`K` may remain absent** | **RESOLVED.** The catalogue represents artists **through the albums it holds** — `artists` rows exist only via `album_artists`, created by album ingestion. K yields no album, so no artist row, so no page. The cause is **scope, not depth**: both her release groups are singles. **K stays in `CURATED_ARTISTS`** with her human-verified identity, so she is already present if the singles boundary ever moves. **Making artists exist independently of albums is a separate product and data-model change and is not part of this.** |
| **Browse Popular**        | **DEFERRED, not accepted and not resolved.** Ingestion proceeds with current behaviour because nothing regresses: Popular is unchanged, and Recently added — which applies no null filter — surfaces the curated albums. **The question gets more pressing as the curated share grows**, since the lead section stays a pure external-chart artefact. It is not to be answered by implementation under pressure to unblock ingestion.                                                                                                       |
| **Artwork backlog**       | **[FALSIFIED then RESTORED 2026-09-07 — see below the table.]** **DEFERRED as an operational matter. Not a blocker.** No correctness or operational constraint exists: Cover Art Archive imposes no rate limit, the drain route already accepts a larger batch without code change, and a missing cover renders the designed placeholder. The honest cost is that curated albums show placeholders until the queue drains, which affects how the tranche **looks**, not whether it is **correct**.                                          |

**The artwork-backlog deferral above was falsified, and is restored rather than revised. [2026-09-07]**

**It was not wrong when written.** It rested on artwork competing with nothing: Cover Art Archive imposes no rate limit, so a slow artwork queue cost appearance and not correctness. **On-demand artist depth (`aba3a07`) introduced a competitor into the same priority band**, and each successful expansion enqueues roughly eight artwork jobs whose `id` outranks the next artist's discovery job. Measured on the deployed database after three artist pages: 20 pending jobs, 18 of them artwork, with 2 discovery jobs never attempted. **At that point the backlog was no longer only about how the catalogue looks — it was stopping metadata being fetched at all.**

**What restores the deferral is separating the bands, not draining faster.** Bulk artwork now enqueues below metered work (`architecture.md` §7, _Queue fairness_), so **bulk** artwork can no longer displace discovery. Artwork a reader is actually waiting on — a self-service add, or an album page being opened — still outranks it, which is the rule working rather than an exception to it. **Throughput is unchanged and is deliberately still deferred**: roughly four artwork jobs clear per nightly cron run, and a large backlog still takes days. With contention gone, that is once again a question of appearance rather than correctness — which is exactly what this cell claimed.

**The lesson worth keeping is about the shape of the deferral, not this instance.** A deferral resting on "nothing else competes for this" expires silently the moment something does, and nothing in the queue announces that. **The next kind to share a band will falsify it again.**

**What ingestion does not settle.** It does not make the 28 a whitelist, does not close the curated list, does not decide the expansion policy for later tranches, and does not endorse the current Browse composition. **A tranche being ingested is not the set being finished.**

**Still unresolved:** the rest of the curated list — the first tranche above is decided, the remainder is not; the definition and algorithm for "complete"; the eventual treatment of singles; regional duplicates, alternate editions, remixes, promos, appearances and reissues; which further release types are admitted and when — **`broadcast` is rejected in code and discussed in no document**; how Discogs would supplement MusicBrainz as enrichment; the longplayr popularity formula and whether likes count; whether the two popularity concepts are one field or two; how discovery consumes popularity; and whether discovery charts receive an editorial voice.

**8.10 — Upstream search: breadth, and whether it matches artists. [PARTLY RESOLVED — raised 2026-08-21; the reachability half decided 2026-08-22; the breadth half decided 2026-09-06. Artist matching remains open, and attribution of the failures observed in use remains unestablished]**

Two limitations of the "not in longplayr yet" panel, both observed in use, neither previously recorded.

**It shows at most five candidates**, hard-coded, with no way to ask for more. The local catalogue search itself returns up to 20 albums, 8 artists and 5 users, so the five is specific to the upstream panel.

**[MECHANISM ESTABLISHED 2026-09-06] The paragraph above is an incomplete account of the breadth limit rather than a wrong one, and the half it omits is the larger one.** The display cap was recorded; **the size of the pool that cap slices was not, and appears nowhere in this document.** `searchUpstream(query, limit)` requests **`limit * 2`** release groups from MusicBrainz, so the caller's display limit of five produces an upstream pool of **ten**. That pool is then filtered twice before anything is shown — through `classify().inScope`, and again to remove every MBID the catalogue already holds — and only the survivors are sliced to the display limit.

**Three consequences, established by reading the code rather than inferred from any observation.** A displayed count below five is produced by **filtering**, not by upstream supply, so **an observed four-result panel cannot be attributed to the display cap alone** and establishes nothing about how many matches exist upstream. The pool is fixed at ten regardless of catalogue size while the already-held filter removes a growing share of it, so **the defect deepens as the catalogue does**. And the multiplier is undocumented — no comment, no document, no stated reason — which is **the structural defect being corrected**, rather than the number five.

**[CORRECTED 2026-09-05]** This paragraph also read _"and it appears at all **only when the local catalogue returns fewer than five album matches**. So an album that exists upstream can be unreachable simply because five local records matched the same words."_ **That gate was removed on 2026-08-22 and shipped**, and the sentence has been describing behaviour that no longer exists since. `shouldOfferFallback` takes no result count at all — the panel is offered for any non-empty query from a signed-in visitor — and its own comment records that a future caller cannot reintroduce the gate without changing the signature. **The five-candidate cap is untouched and remains open**; only the unreachability half was fixed. The original text is preserved here rather than deleted.

**It does not match artist names.** The typed string is handed to MusicBrainz's Lucene index for release groups, whose default field is the release-group **title** — so typing an artist returns titles containing that word, not that artist's albums. Field-qualified syntax (`artist:"…"`) is the documented route and would likely work today as an undocumented power-user trick, but **this must be verified against the live API before anything depends on it** — the `referencedTable` finding is the standing reminder that a documented behaviour is not a verified one.

**Breadth is decided. [DECIDED 2026-09-06]**

**The panel's job is to let a user reach the specific record they came for.** It is a retrieval tool — not a discovery surface and not a representative sample — and its success criterion is reachability of a known target rather than breadth of selection. This is the footing the reachability half was already decided on in 2026-08-22, and it is stated explicitly so that no implementation settles it by default.

**Fetch depth and display limit become independent, because they answer different questions.** How much MusicBrainz is asked for is a question about surviving two filters; how much is shown is a question about a section deliberately subordinate to the local results above it. A multiplier let the second silently determine the first.

- **MusicBrainz is asked for 25 release groups**, by an explicit constant rather than `limit * 2`. **A deeper fetch costs nothing against the constraint that governs everything else here**: the rate limiter serialises _requests_, not results, so twenty-five rows and ten rows are the same single request. Twenty-five is MusicBrainz's own default limit, and that is why it was chosen — it depends on no assumption about the API's maximum, which cannot be read from bundled documentation and cannot be verified live under the contact rule. **It is a judgement of proportionate headroom — two and a half times the display — and is not an empirically established sufficient depth.**
- **The panel displays up to 10 surviving candidates.** Ten is `searchUpstream`'s own signature default; the caller's five was the undocumented narrowing. Local catalogue search returns up to 20 albums, so ten keeps the panel visibly subordinate. **It is not an empirically optimal number**, and no measurement supports it over any nearby one.

**Nothing else about the panel's matching changes.** The query string handed to MusicBrainz is unchanged — no field qualification, no artist matching. `classify().inScope` and the already-held filter keep their current semantics, and MusicBrainz's own relevance ordering is preserved. **The response's `count` and per-result Lucene `score` remain unused and are deliberately not surfaced**: `count` counts upstream matches _before_ both filters, so any figure shown would state a denominator the panel cannot deliver from, and ranking or filtering on `score` would be the broader relevance redesign `architecture.md` reserves.

**"Show more" is deferred with a reason, not merely left unaddressed.** Once the pool is twenty-five and the display is ten, a show-more would be **meaningful** rather than a re-slice of the same ten — which is what it would have been before this decision. It is still not built, because its value cannot be assessed until a deeper fetch has been observed, and **both outcomes argue against building it now**: if depth plus a larger display resolves the reported failures it is unnecessary interaction on a subordinate section, and if it does not then the residual failures are artist-shaped and a show-more over a title index would not have fixed them either.

**Artist matching is not decided here and is not implemented.** The paragraph above stands unchanged, its precondition included: field-qualified syntax **must be verified against the live API before anything depends on it**, and this decision does not discharge that. It was examined and deliberately left. Re-ranking the fetched results by their `artist-credit` is available at no cost, since the credits are already in the search response and the panel already displays them — but **it cannot reach an album the title index never returned**, which is precisely the failure case. **It belongs to a successor slice and must be taken deliberately.**

**What this decision does not establish.** That deeper fetching resolves the failures reported in use. It repairs one of at least two mechanisms capable of producing them, on the strength of the code rather than of an attribution, and **which mechanism was responsible in any observed search remains unknown**. Establishing it means observing the populated panel against the live API, which requires a real `MUSICBRAINZ_CONTACT` — a maintainer decision outside this slice, and not to be worked around. **The reported problem therefore stays open after this decision is implemented.**

**Aliases and phonetic matching stay a separate item.** This section already records that alias work and upstream matching are related and "should not be collapsed into one item without deciding to". That decision is taken here, and it is **not to combine them**: alias work improves _local catalogue_ matching where this decision improves _upstream reach_, and it carries a new table, a migration, an endpoint no code path has ever called, and a rate-limited backfill whose benefit is untested. It remains a separate candidate at unchanged status.

**Observed in use 2026-08-21, and worse than the two limitations above suggest.** Searching for **"the warning" (Hot Chip)**, an album not in the catalogue, returned a page of albums already held — mostly titles beginning with "The" — and **offered no route to add the one being looked for**. Reproduced at the database level; **three faults compound**, and only the third makes the album unreachable:

1. **The fuzzy tier is too permissive for short common words.** `search_albums` falls back to `similarity(title, query) > 0.3`, and trigram similarity is inflated when a short title shares a leading article: measured, `similarity('The Wall', 'the warning')` is **0.4** and matches, while `similarity('The Bends', 'the warning')` is 0.22 and does not. So any short `The …` title in a 338-album catalogue is a candidate.
2. **The `simple` text configuration keeps stopwords.** `websearch_to_tsquery('simple', 'the warning')` yields `'the' & 'warning'`, so "the" is a required lexeme rather than being discarded — which degrades precision for every title containing an article.
3. ~~**The upstream panel is suppressed by exactly the flood the first two produce.**~~ **RESOLVED 2026-08-22.** It rendered only when the local catalogue returned **fewer than five** albums, so noisy local matches removed the only route to the record. **This was the fault that turned a ranking annoyance into a dead end**, and it is the one now decided: the fallback is available for every signed-in query regardless of local result count (§6). **Faults 1 and 2 are untouched** — they still produce the noisy results; they can simply no longer hide the way out.

**The panel gets a "show more", and it spends no upstream request to do it. [DECIDED 2026-09-16]** This resolves the first item in the list below, which had been open since 2026-08-21.

**The mechanism is what makes it cheap.** The upstream search already fetches **25** release groups in one request and filtering leaves roughly fifteen, of which **ten** were rendered — so several candidates were being retrieved and thrown away. The panel now keeps all survivors and reveals the remainder behind an expander. **No additional MusicBrainz request is made, and no client JavaScript is required.** Against a limit where exceeding one request per second returns `503` for **every** request from the address, spending a request per expansion would have been the wrong trade.

**Fetch depth is untouched at 25.** Deepening it is free in request count — one call with a larger `limit` — but the breadth decision of 2026-09-06 settled that number deliberately, and reopening it is wider than this slice.

**The panel stays subordinate.** Ten remains what it shows first, for the reason already recorded: catalogue results above it return up to twenty, and the fallback must not out-length them. **Showing every survivor unconditionally was rejected on exactly that ground.**

**When everything has been shown, the panel says so. [DECIDED 2026-09-16]** A search whose survivors all fit states that MusicBrainz returned nothing further, rather than leaving the reader to infer it from a missing control. **This is a different condition from finding nothing at all**, which keeps its existing "try a different spelling" advice.

**What this does not establish.** §8.10 records that **which mechanism caused the failures observed in use is unestablished**, and it stays that way: the panel cannot be populated against real data locally or in CI while `MUSICBRAINZ_CONTACT` is a placeholder. **This fixes a documented limitation without evidence that it was the one encountered**, and that distinction is recorded rather than smoothed over.

**Still unresolved, and deliberately not decided alongside the reachability fix** — **[AMENDED 2026-09-16: the "show more" item is now resolved above and is struck from this list in substance, though the wording is preserved.] [AMENDED 2026-09-06: the first item below is now _deferred with a stated reason_ rather than simply open, and the item on searching title and artist is unchanged and still open. The list is preserved as written; see the breadth decision above]**: whether the panel gets a "show more"; whether the fuzzy threshold should rise, be length-aware, or be dropped when the query contains a leading article; whether the text configuration should switch to `english` for stopword removal, and what that costs for non-English titles — the catalogue is deliberately international, and `simple` was chosen for that reason; whether the query should search title _and_ artist, and if so whether that is separate inputs, a blended Lucene query, or a heuristic; and whether any of it is worth doing before the search latency in `current-state.md` §8 is addressed, since every additional upstream candidate is fetched in the render path.

**Follow-ups from manual testing of the shipped fix, 2026-08-23.** Observations from using the deployed product, recorded as **unresolved**. None is decided, none is scheduled, and none should be inferred into scope.

**One is settled, by testing rather than by decision:** the MusicBrainz panel **arriving after the rest of the page reads naturally**. That was the open risk in streaming it — content appearing late is new behaviour for this product — and manual use confirms it works. **No change needed.**

**The rest remain open:**

- **The page is substantially faster** because local results no longer wait. Confirmed, and recorded so a future reader knows the change achieved what it claimed.
- **The remaining ~20-second MusicBrainz wait is still too long.** Making it non-blocking was not a latency fix and was never claimed to be. This is **a separate future performance problem**, tracked alongside the add-path latency in `current-state.md` §8. The candidate levers — streaming was one, queueing the tracklist fetch is another — are unexamined here.
- **Search should not require pressing Enter.** The interaction is **undecided**: search-as-you-type, an explicit button, clearer instruction, or something else. Search-as-you-type in particular interacts badly with a rate-limited upstream call, which is a reason to think rather than a reason to reject.
- **Five upstream suggestions are not enough.** Revisit the limit, and whether the answer is "show more", a different limit, or another discovery mechanism entirely. **[DECIDED 2026-09-06 — a different limit, and not "show more": the panel fetches 25 and displays up to 10. The observation was right and its implied cause was incomplete — the binding constraint was the pool of ten behind the cap, not the cap alone. See the breadth decision above.]**
- **Upstream candidates should ideally show artwork.** Currently they render the `AddSlot` placeholder, which is deliberate — it distinguishes "could be added" from "held, no cover" — so this is a change to a considered decision rather than a gap. Cover Art Archive is keyed by release-group MBID, which the candidates carry, so the data is reachable; the cost is per-candidate requests on a path already slow.

**These are follow-ups to a shipped feature, not architectural direction.** They belong to Search, not to `product-spec.md` §10.

**[CORRECTED 2026-09-06] The paragraph below is too strong in one sentence, and is preserved rather than rewritten.** It concludes that _"with the gate gone, catalogue growth no longer degrades reachability"_. **A second growth-sensitive mechanism was established on 2026-09-06 and that paragraph did not know of it**: the already-held filter removes a growing share of a **fixed** upstream pool as the catalogue deepens, so catalogue growth did still degrade reachability — by a different route from fault 3, and one the gate's removal left untouched. **The breadth decision above enlarges the pool rather than eliminating the sensitivity**, since the filter scales with catalogue size and twenty-five does not.

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

**The decision above is unchanged and unbuilt, and the first feed ships without it. [RECORDED 2026-09-01]** `Activity` carries four event types — `listened`, `relistened`, `rated`, `reviewed` — and none of them is Want to Listen. That was the Activity slice's recorded boundary, not an oversight in the feed slice: the feed is a query over `Activity` and renders the types that exist. **Do not read the omission as a reversal of this section.** Two questions block writing the event, and neither is answered here — whether _removing_ generates an event, which is the `[OPEN]` question above, and whether **collecting** an album should erase a Want to Listen event it had already generated, since the clearing rule deletes the underlying row and a cascade would take the event with it. The second is newly identified and is recorded alongside the first in §4. A later Phase 3 slice owns both, plus the schema change adding the type.

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

#### 10.3a Profile pictures: scope, decided **[DECIDED 2026-09-24 — resolves F-052]**

**Build it, narrowly.** `profiles.avatar_url` has existed since Phase 0, `Avatar.tsx` renders it on profiles, followers, the album page, the feed and notifications, and it is denormalised into activity as `actor_avatar_url`. **There has never been an upload path.** This is unfinished scope rather than a new feature — §10.3 already records photo and bio as in scope.

| Decision   | Value                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Storage    | **Supabase Storage.** The `artwork` bucket exists; avatars get their own, because one is catalogue-owned and the other user-owned       |
| Limits     | **Strict size and format**, enforced server-side. Numbers set at implementation                                                         |
| EXIF       | **Stripped on upload.** A photo carries GPS coordinates by default, and this product is public by decision                              |
| Cropping   | **None.** A client-side cropper is meaningful work for a 40px circle beside a handle                                                    |
| Default    | **Unchanged** — the existing initial-based avatar                                                                                       |
| Moderation | **Rides on the reporting slice**, not its own mechanism. An avatar is content on an account, and reporting an account already covers it |

**It extends the deletion cascade, and that is the part most likely to be forgotten.** `architecture.md` §15.1 records that **no user-owned storage objects exist today** — the only bucket is catalogue-owned — and that this stops being true the moment avatars ship. **Whoever builds this owns extending the hard delete**, and §87's orphan test is where that gets proven.

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

#### ~~Precondition — legal research, blocking~~ **DISCHARGED AS RESEARCHED 2026-09-24 — see `docs/legal-obligations.md`**

**The research exists and the brief below was met.** One question inside it remains open and needs a lawyer — **whether Art 16 notice-and-action reaches private messages, and how it is discharged without a moderator reading them.** So the precondition is discharged _as researched_, not _as cleared_, and the brief is preserved below rather than deleted.

**What it found, in one line:** the minimum safety layer messaging needs is **Art 16 notice-and-action plus Art 17 statements of reasons** — which Phase 6 slice 3 is already scoped to build. **Messaging needs the moderation system the public product already owes, extended, rather than one of its own.**

**And the larger finding was not about messaging at all.** Most of what applies, applies **today**: terms and conditions, two points of contact, notice-and-action, statements of reasons. **§92 built the ability to remove content and nothing tells the author why**, which Art 17 requires.

#### The brief, preserved

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

### 10.8 Comments and status posts **[DECIDED 2026-09-24 — resolves F-053's first two halves]**

**Comments stay deferred until reporting ships.** §7 deferred them as _"the largest moderation liability in the product"_, and that reasoning is unchanged — but the deferral now has a **trigger rather than a vibe**: Phase 6 slice 3 builds reporting, the admin queue and statements of reasons, all of which are legally owed. **Adding the highest-liability content type before the mechanism to handle it exists is backwards.** Revisit when slice 3 lands.

**This is not a permanent no.** That option was offered and declined.

**Status posts are out of scope, and this is a no rather than a deferral.** Every feed event today is **derived from doing something with an album** — added, rated, relistened, reviewed, listed. A free-text post with no album behind it is **a different product**: a microblog with its own moderation, deletion, reporting and feed-eligibility rules, and `CLAUDE.md`'s feed invariant — _an event is generated when a user acts, at the moment they act_ — was written for actions on albums and does not obviously describe posting.

**The narrower version is still available and was not rejected.** F-022 records recommending an album to somebody directly, and a recommendation **anchored to a catalogue row** is a different proposition from free text. **That remains open.**

**Messaging is untouched by this** and is separately recorded in §10.4, where its blocking precondition is now discharged as researched.

### 10.5 Social philosophy

longplayr is fundamentally a **music collection and discovery product**. The social layer must emerge from taste rather than turning the product into a generic social network.

The intended loop:

```
collection → taste becomes legible → discover people with overlapping taste
    → explore their profiles → discover music → follow / interact → potentially message
```

Messaging **supports** this loop; it does not become the centre of the product. Profile photo, bio and city exist to make people socially legible. Neither is a step toward dating functionality, and dating-specific features are not to be added.

This philosophy is the tie-breaker when a question in this section has no obvious answer: prefer the option that makes taste more legible, and reject the option that makes longplayr more like a general social network.
