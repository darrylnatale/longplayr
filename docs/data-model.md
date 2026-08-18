# longplayr — Conceptual Data Model

Entities and relationships, deliberately ahead of schema. Column names are illustrative; types, indexes, and constraints get settled at implementation. What matters here is **what exists, what it means, and how the pieces relate**.

Notation: **[DECIDED]** = explicitly chosen. **[INFERRED]** = follows necessarily; flagged for correction. **[OPEN]** = unresolved.

---

## 1. Shape of the model

Three layers that behave very differently:

```
  ┌─── CATALOGUE ─────────────────────────────┐
  │  read-only, sourced from MusicBrainz      │
  │  shared by all users, never user-authored  │
  │                                            │
  │  Artist ──< AlbumArtist >── Album ──< Release
  │                              │
  │                              └──< Track
  └────────────────────────────────────────────┘
                    ▲
                    │  referenced by
                    │
  ┌─── USER CONTENT ──────────────────────────┐
  │  authored by users, hard-deleted with them │
  │                                            │
  │  User ──< CollectionEntry >── Album        │
  │            │                               │
  │            ├──< RelistenEvent              │
  │            └──── Review                    │
  │                                            │
  │  User ──< List ──< ListItem >── Album      │
  │  User ──< Follow >── User                  │
  │  User ──< Block >── User                   │
  └────────────────────────────────────────────┘
                    ▲
                    │  derived from
                    │
  ┌─── DERIVED / OPERATIONAL ─────────────────┐
  │  Activity     (broadcast — feed events)    │
  │  Notification (directed — likes, follows)  │
  │  Report       (moderation)                 │
  │  CatalogueAddition (audit + rate limiting)  │
  └────────────────────────────────────────────┘
```

The layering matters because it maps to different lifecycles. Catalogue data outlives every user. User content is hard-deleted on request. Derived data is disposable and rebuildable.

---

## 2. Catalogue entities

Sourced from MusicBrainz, cached locally, never edited by users. Each carries its **MBID as a unique natural key** alongside our own surrogate primary key.

### Artist

The performer or group. One artist page per record.

| Field            | Notes                                                             |
| ---------------- | ----------------------------------------------------------------- |
| `mbid`           | Unique. MusicBrainz artist identifier                             |
| `name`           | Canonical name                                                    |
| `sort_name`      | For alphabetical ordering ("Beatles, The")                        |
| `disambiguation` | MusicBrainz's short qualifier, used when two artists share a name |
| `type`           | Person, Group, Orchestra, Choir, etc.                             |

"Various Artists" is a real MusicBrainz artist and arrives as an ordinary row. **[INFERRED]** It gets an artist page like any other, which is the correct behaviour for compilation browsing.

### Album

A MusicBrainz **release group** — the abstract record, independent of pressing. This is the social object: ratings, reviews, collection entries and list items all attach here.

| Field                    | Notes                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mbid`                   | Unique. Release-group identifier                                                                                                                 |
| `title`                  |                                                                                                                                                  |
| `display_credit`         | **The rendered credit string cached from MusicBrainz** — e.g. `"Jay-Z & Kanye West"`. Avoids reimplementing join-phrase logic **[DECIDED — D1]** |
| `primary_type`           | Album, EP, Other                                                                                                                                 |
| `secondary_types`        | Compilation, Live, Soundtrack, Mixtape, Remix, Demo — a set, not a single value                                                                  |
| `first_release_date`     | Earliest known release. Stored as a **full date with defaults filled**: missing day → the 1st, missing month → January. **[DECIDED]**            |
| `release_date_precision` | `day` / `month` / `year` — records what was _actually_ known **[INFERRED]**                                                                      |
| `artwork_*`              | See §6                                                                                                                                           |

**On dates.** MusicBrainz dates are frequently year-only or year-month. Storing a full date keeps sorting and range queries trivial; the separate precision marker keeps display honest, so a year-only release shows as `2004` rather than the invented `1 January 2004`. Storing the date without precision would make that distinction unrecoverable — the marker is what leaves room to handle dates more precisely later, as you flagged, without a migration or a re-ingest. **[INFERRED — a small addition to what was decided; drop it if you'd rather keep the column count down and accept lossy display.]**

**Scope constraint.** Per the catalogue scope decision, only albums, EPs and mixtapes are ingested; singles are excluded. Live albums, compilations and soundtracks are included. This is enforced **at ingest**, not at query time — an out-of-scope release group should never become a row.

### AlbumArtist

Join table connecting albums to every credited artist. **This is what makes _Watch the Throne_ appear on both Jay-Z's and Kanye West's pages.**

| Field                   | Notes                                               |
| ----------------------- | --------------------------------------------------- |
| `album_id`, `artist_id` | Composite key                                       |
| `position`              | Credit order, so the primary artist is identifiable |

Display always uses `Album.display_credit`; this table exists for **linking and discography queries**, not for rendering. **[DECIDED — D1]**

### Release

A specific edition — original pressing, remaster, deluxe, regional variant. Referenced optionally by a collection entry when a user cares which one they heard.

| Field                                                                          | Notes                |
| ------------------------------------------------------------------------------ | -------------------- |
| `mbid`                                                                         | Unique               |
| `album_id`                                                                     | Parent release group |
| `title`, `date`, `country`, `format`, `label`, `track_count`, `disambiguation` |                      |

**Fetched lazily.** A popular album can have fifty releases, and the overwhelming majority of users never open the editions UI. Eager fetching would multiply ingestion cost for a feature most people won't touch. **[INFERRED — confirmed as an architecture decision in Gate E]**

### Track

Tracklist entries, shown on album pages for context. Never rated, reviewed, or logged.

**A real modelling wrinkle:** MusicBrainz attaches tracklists to _releases_, not release groups. Our album page needs a tracklist, so we nominate a **representative release** to source it from, stored as `Album.representative_release_id`.

**Selection rule — earliest official release. [DECIDED]** Resolved in this order:

1. Earliest release with status **Official**, by release date.
2. If none is Official, earliest release of any status.
3. If dates tie or are missing, prefer the release with the most complete data — a known date, then a track count, then a country.
4. If still tied, lowest MBID, purely so the choice is deterministic and stable across re-ingests.

Steps 2–4 exist because "earliest official" is underdetermined more often than it sounds: bootlegs and promos predate official pressings, many releases carry year-only dates, and some release groups have no Official release at all. Without a deterministic tail, the same album could pick a different tracklist on each re-sync.

---

## 3. User and social entities

### User

| Field                           | Notes                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `handle`                        | Unique, user-facing identifier in URLs                                                     |
| `display_name`, `avatar`, `bio` | Profile presentation                                                                       |
| `email`                         | Authentication; never public                                                               |
| `status`                        | `active` / `suspended` / `banned` — required by the moderation decision **[DECIDED — C3]** |
| `created_at`                    |                                                                                            |

Authentication credentials live with the managed auth provider, **not in this table**. This table holds the profile, keyed to the provider's user identifier.

### FavouriteAlbum

Pinned albums summarising a user's taste, shown on their profile. **[DECIDED]**

| Field                 | Notes                    |
| --------------------- | ------------------------ |
| `user_id`, `album_id` | Unique together          |
| `position`            | User-controlled ordering |

**Maximum ten per user**, enforced in the service layer. Independent of the collection — **[INFERRED]** you may favourite an album you haven't added, and favouriting does not add it, since a favourite is a statement about taste rather than a record of listening. Say if you'd rather favourites be restricted to your collection.

### Follow

Asymmetric. `follower_id` → `followee_id`, with `created_at`. Composite unique; self-follows rejected.

### Block

`blocker_id` → `blocked_id`. Per the block decision, this suppresses following, liking, feed presence and notifications **in both directions**, but does **not** restrict viewing — content stays publicly readable. The model can't enforce more than that, and the UI must say so. **[DECIDED — C2]**

---

## 4. The core entity

### CollectionEntry

**The centre of the product.** One row per user per album, permanently — this uniqueness constraint _is_ the collection model.

| Field                 | Notes                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `user_id`, `album_id` | **Unique together.** The album appears once in a collection no matter how many times it's played |
| `release_id`          | Nullable. The edition, if the user cared to specify one                                          |
| `rating`              | **Nullable.** 0.0–10.0, one decimal. Null means unrated and excluded from averages               |
| `liked`               | Boolean, independent of rating                                                                   |
| `relisten_count`      | Denormalised count of related `RelistenEvent` rows, for cheap `×N` display in grids              |
| `listened_on`         | **Nullable date, user-supplied.** May be backdated, or omitted entirely                          |
| `added_at`            | **Always set by the system.** Never null                                                         |
| `updated_at`          |                                                                                                  |

**Why two timestamps.** `listened_on` is what the user asserts; `added_at` is what actually happened. Collections sort by `listened_on` when present, falling back to `added_at` — so a user who bulk-adds forty undated albums still gets them ordered sensibly by when they added them. `added_at` is also what drives feed eligibility.

**Feed eligibility rule.** **[DECIDED — B1, amended 2026-08-18]**

An entry generates a `listened` activity event when a user **adds it interactively** — at the moment they act. It generates none when the entry arrives as **historical or backfilled data**. The rule is applied **once, at write time**, which is the reason the materialised activity table is worth having.

**`listened_on` does not decide this**, and the earlier version of this rule — "only when `listened_on` is today" — has been replaced. That version conflated two separate things: the anti-flood invariant, and a user's assertion about when they heard a record. Backdating is a claim about the past, not a request for silence.

**The discriminator is now the write path, not the date.** An interactive add produces an event; a bulk or imported write does not. That relocation is deliberate and it leaves one thing genuinely undecided — see §11.9.

**Implicit creation.** Rating, liking or reviewing an album the user hasn't added **creates the entry automatically**, with `listened_on` unset. **No `listened` event fires**, while the triggering action still produces its own event (`rated`, `reviewed`) or none at all (liking). **[DECIDED]**

**The reason changed with the eligibility rule, and the behaviour did not.** This used to be silent as a side effect of `listened_on` being unset. It is now silent for a better reason: **the event must reflect the action the user took.** They rated a record; they did not claim to have listened to it. Inferring a listen from a rating and broadcasting it is precisely the surprise this rule exists to prevent, and that reasoning no longer depends on a date field.

Without this, rating an album you'd never logged would announce to your followers that you had just listened to it, which may not be true. `FavouriteAlbum` is deliberately outside this behaviour.

### RelistenEvent

Discrete, timestamped rows — one per relisten.

| Field                 | Notes  |
| --------------------- | ------ |
| `collection_entry_id` | Parent |
| `occurred_at`         |        |

**These must exist as rows, not merely as a counter.** Marking a relisten on Monday, Tuesday and Wednesday produces three separate feed items, which a single count column cannot express. `CollectionEntry.relisten_count` is a denormalised convenience for grid display; these rows are the truth.

### Review

One standing review per user per album, editable in place.

| Field                      | Notes                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `collection_entry_id`      | One-to-one. Unique                                                                      |
| `body`                     | Plain text with line breaks. **Maximum 10,000 characters** (~1,700 words) **[DECIDED]** |
| `status`                   | `live` / `removed` — soft-delete for moderation                                         |
| `created_at`, `updated_at` |                                                                                         |

**Modelled as its own table rather than a column on `CollectionEntry`** — because moderation must soft-delete a review without destroying the user's collection entry, and likes and reports need a stable identifier to reference. **[INFERRED — flagged in Gate D, correct if unwanted]**

Editing replaces the body; no version history is kept, per the rating-and-review decision.

---

## 5. Lists and interactions

### List

| Field                             | Notes                                |
| --------------------------------- | ------------------------------------ |
| `user_id`, `title`, `description` |                                      |
| `is_ranked`                       | Whether items carry meaningful order |
| `status`                          | `live` / `removed` — moderation      |

### ListItem

| Field                 | Notes                                                    |
| --------------------- | -------------------------------------------------------- |
| `list_id`, `album_id` | Unique together — an album appears at most once per list |
| `position`            | Ordering. Meaningful only when the list is ranked        |

Per-item commentary is deferred; adding it later is a nullable column, requiring no restructuring. Ranked ordering is settled **now** precisely because it isn't. **[DECIDED — B7]**

### Likes

Three distinct things can be liked, and they are **not** modelled polymorphically:

| Liking a…  | Stored as                                                     |
| ---------- | ------------------------------------------------------------- |
| **Album**  | `CollectionEntry.liked` — already a column, no separate table |
| **Review** | `ReviewLike` (`user_id`, `review_id`)                         |
| **List**   | `ListLike` (`user_id`, `list_id`)                             |

**[INFERRED]** Separate tables rather than a polymorphic `Like` table: polymorphic foreign keys can't be enforced by the database, and there are only two of them. The cost of the general solution exceeds its benefit here.

Likes generate **no activity events** — they'd dominate the feed by volume. **[DECIDED — B5]** They do generate **notifications** to the content's author, which is the only way they become visible at all.

---

## 6. Artwork

Album artwork is the visual backbone of the product, so it gets first-class treatment rather than a URL column.

| Field                               | Notes                                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `album_id`                          |                                                                                                                                                          |
| `source`                            | Cover Art Archive, or the fallback provider                                                                                                              |
| `storage_key`                       | **Our own storage.** Artwork is fetched and stored, not hotlinked — upstream availability and rate limits are not something album pages should depend on |
| `width`, `height`, derivative sizes | Grids, feed rows and detail pages need different dimensions                                                                                              |

**Coverage will be incomplete, and there is no fallback source.** Both candidate fallbacks were rejected on their terms (`architecture.md` §7), so Cover Art Archive is all we have. On-demand catalogue growth means many albums arrive with nothing at all.

Two consequences the model must carry:

- **`artwork_status`** on the album — `found` / `absent` / `pending` — so coverage is a number we can query rather than a guess. This is what makes revisiting the decision an evidence-based conversation.
- **The placeholder is a real component**, likely among the most-viewed in the product's early life.

Because Cover Art Archive is keyed by MBID, a cover can never be attached to the wrong album — a class of bug both rejected alternatives would have introduced through fuzzy name matching. **[DECIDED]**

---

## 7. Derived and operational entities

### Activity

Materialised feed events. **[DECIDED — D2]**

| Field                                                              | Notes                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `actor_id`                                                         | Who did it                                                                         |
| `type`                                                             | `listened` / `relistened` / `rated` / `reviewed` / `list_created` / `list_updated` |
| `collection_entry_id`, `relisten_event_id`, `review_id`, `list_id` | Nullable references to the subject, depending on type                              |
| `created_at`                                                       | Feed ordering                                                                      |

**Events reference live data; they do not snapshot values.** A feed item displaying a rating reads the current value from the collection entry, so edits propagate everywhere. Undoing the action deletes the event — cascading from the referenced row. The feed therefore never displays a claim that has stopped being true. **[DECIDED — D3]**

Feed query: events whose actor is someone you follow, newest first.

### Notification

Events directed at a specific user. **[DECIDED]**

| Field                                         | Notes                                                 |
| --------------------------------------------- | ----------------------------------------------------- |
| `recipient_id`                                | Who is being notified                                 |
| `actor_id`                                    | Who caused it                                         |
| `type`                                        | `followed` / `review_liked` / `list_liked`            |
| `follow_id`, `review_like_id`, `list_like_id` | Nullable references to the subject, depending on type |
| `read_at`                                     | Nullable. Drives the unread count                     |
| `created_at`                                  |                                                       |

**Distinct from `Activity`, despite the similar shape.** `Activity` is broadcast — things you did, shown to your followers. `Notification` is directed — things others did _to you_. The two carry disjoint event types: likes and follows generate notifications and never activity; listens, ratings, reviews and lists generate activity and never notifications. Collapsing them into one table would mean every feed query filtering out notification types and vice versa.

Like activity events, notifications **reference live data and cascade on deletion** — unfollowing or unliking removes the notification, so the page never reports something that has been undone.

### Report

| Field                                               | Notes                             |
| --------------------------------------------------- | --------------------------------- |
| `reporter_id`, `target_type`, `target_id`, `reason` |                                   |
| `status`                                            | `open` / `actioned` / `dismissed` |
| `resolved_by`, `resolved_at`                        |                                   |

Targets are reviews, lists, and users.

### CatalogueAddition

Audit trail for self-service catalogue additions: which user added which album, and when.

Exists for two reasons: **rate limiting** (the ceiling that prevents bulk junk-adding, which is the only real risk self-service introduces), and **retrospective review** if something out of scope slips through. **[DECIDED — C4]**

---

## 8. Cross-cutting behaviour

### Hard deletion

Deleting a user removes every row they authored: collection entries, relisten events, reviews, lists and items, follows, blocks, likes, and activity. It also removes **notifications they caused** for other users — a notification naming a deleted account would leak a handle that no longer exists. Catalogue rows are untouched; they were never theirs.

**Two decisions interact well here.** Because averages are computed on read rather than stored, deletion requires **no recomputation step** — the aggregate simply stops including those rows. Had we chosen stored counters, every deletion would need a careful decrement across potentially thousands of albums, each an opportunity for permanent drift. **[DECIDED — C1 + D4]**

### Averages

Computed at query time from non-null ratings on collection entries. No stored aggregates, so no drift is possible. **[DECIDED — D4]**

### Moderation status

`Review.status`, `List.status` and `User.status` exist from day one. Retrofitting content status across populated tables later is exactly the kind of migration worth avoiding. **[DECIDED — C3]**

### MBID as natural key

Every catalogue entity has a unique MBID. Re-ingesting an album is an upsert on that key, which is what prevents duplicate rows.

---

## 9. Open questions

**~~9.1 — Representative release for tracklists.~~ RESOLVED.** Earliest official release, with a deterministic fallback chain. See §2, Track.

**9.2 — MusicBrainz identifier changes.** MBIDs can be merged upstream when duplicate entities are reconciled; the old identifier redirects rather than disappearing. Our unique constraints assume stability. A re-sync strategy that follows redirects and merges local rows is needed — not for launch, but before the catalogue is large enough that a merge causes visible breakage.

**~~9.3 — Partial release dates.~~ RESOLVED.** Store as precise as the source allows, with defaults filling the gaps. See §2, Album.

**9.4 — Genre and tag data.** Deferred from the MVP, but if it lands later it attaches to albums and artists and is worth leaving room for rather than bolting on.

**9.5 — Handle reuse after deletion.** Hard deletion frees a handle. Whether it becomes immediately claimable affects whether old links resolve to a different person — a small decision with an impersonation edge case behind it.

---

## 10. Entities implied by recorded product direction

`product-spec.md` §10 records four areas of decided-but-unbuilt direction. None of the entities below exist, none are designed, and none should be created without first asking the product questions §10 lists. They are named here so that a future migration does not discover them late.

**Want to Listen** (§10.1). **Schema resolved 2026-08-18.** A user–album relation held in **its own table**, separate from the collection. It is the **third** independent user–album relation after collection entries and favourites, and that is the point at which a generic `user_album_relation` table starts to look attractive — it should be resisted, because it makes every read polymorphic and forces a discriminator into queries that are currently direct. Keep the relations as separate tables.

The blocking question — _can an album be both collected and on Want to Listen?_ — is answered **yes**. They are independent concepts with independent lifecycles. Consequences for the schema:

- Want to Listen is a separate table keyed on `(profile_id, album_id)`, unique, referencing `profiles(id)` per decision E.
- **The collection table needs no status column.** This is what unblocks Phase 2: the collection migration can be written now without waiting on wishlist design.
- The two tables must be able to hold the same album for the same user simultaneously. Nothing may enforce mutual exclusion — no partial unique index across the pair, no check constraint.

**The clearing rule is one-directional.** _Any action that causes a collection entry to exist clears Want to Listen for that album_ — the explicit add and every implicit one (rating, liking, reviewing, relistening). It does **not** run in reverse, and it does not fire when a wishlist row is created. So the common path never leaves both rows present, while an album collected first and wished second does. Model it as an effect of collection-entry creation, in one place, so a sixth creation path inherits it rather than forgetting it.

Whether that effect is a database trigger or service-layer logic is an open implementation choice, not a product one. Service-layer logic is more consistent with the existing architecture — the collection mutation already has to write an `Activity` event in Phase 3, and decision G asks that those write points be single rather than duplicated.

Want to Listen additions generate feed events, so whatever `Activity` becomes in Phase 3 needs an event type for them.

**Taste overlap** (§10.2). Any similarity computation is a read-side aggregate over collections and possibly favourites, ratings, likes and reviews. It has no entity of its own until a decision is made to cache it, and that decision should follow the algorithm rather than precede it. Whether it is symmetric determines whether a cache is keyed by an ordered or unordered user pair.

**Profile location** (§10.3). `display_name`, `avatar` and `bio` already exist on the profile entity, per §2. **Only location is new.** Whether it is free text or structured is an open product question, and it decides whether this is a column or a reference to a place table. Whether historical location is retained decides whether it is versioned at all — the default assumption of a single mutable column silently answers "no".

**Messaging** (§10.4). Conversations and messages. Two aspects touch existing invariants directly:

- **Hard delete.** `CLAUDE.md` requires a complete cascade and treats an orphaned row as a privacy failure. A message has two parties, so "delete the user's messages" is ambiguous — deleting the sender's copy from the recipient's inbox and retaining it are both defensible, and both are work. This must be answered before the schema, not after.
- **Blocking already exists as a decision of record** (`product-spec.md` §4) and cuts interaction in both directions without hiding content. Messaging extends it rather than introducing it.

Message retention is an open question with a legal dimension, so the schema must not assume indefinite retention.

---

## 11. Open questions carried from product direction

These duplicate `product-spec.md` §10 deliberately, because a schema author reads this document and not that one. **The authoritative list is in `product-spec.md` §10. Do not answer any of them here.**

- ~~**11.1** — Can an album be simultaneously collected and on Want to Listen?~~ **RESOLVED — yes, independent relations.** See §10.
- ~~**11.2** — Do collection adds, ratings, likes, reviews or relistens remove an album from Want to Listen?~~ **RESOLVED — yes, all of them.** One rule: any action that causes a collection entry to exist clears Want to Listen. See §10.
- **11.3** — Is Want to Listen public on the profile? _(Interacts with the all-public model, which currently admits no exceptions.)_
- **11.8** — Should Want to Listen be offered on an album already in the collection? _(The schema permits the state; whether the interface should produce it is unanswered.)_
- **11.9** — **How is a manual bulk backfill kept out of the feed?** The amended eligibility rule keys on the write path rather than on `listened_on`, which covers a future import cleanly — but a user adding two hundred albums by hand in one sitting is two hundred interactions by that definition. Suppressing them, aggregating them into one feed item, or rate-limiting event creation are all plausible and none is decided. **Phase 3. Ask.**
- **11.4** — Is taste similarity symmetric? _(Decides the key shape of any cache.)_
- **11.5** — Is location free text or structured, and is history retained? _(Decides column versus reference, and versioned versus mutable.)_
- **11.6** — What happens to a two-party message when one party hard-deletes? _(Decides the cascade, and is a privacy commitment.)_
- **11.7** — What is the message retention policy? _(Has a legal dimension — see `product-spec.md` §10.4.)_
