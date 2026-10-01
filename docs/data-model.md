# longplayr — Conceptual Data Model

Entities and relationships, deliberately ahead of schema. Column names are illustrative; types, indexes, and constraints get settled at implementation. What matters here is **what exists, what it means, and how the pieces relate**.

Notation: **[DECIDED]** = explicitly chosen. **[INFERRED]** = follows necessarily; flagged for correction. **[OPEN]** = unresolved.

---

## Contents

- [1. Shape of the model](#1-shape-of-the-model) · 173 words
- [2. Catalogue entities](#2-catalogue-entities) · 1,172 words
- [3. User and social entities](#3-user-and-social-entities) · 864 words
- [4. The core entity](#4-the-core-entity) · 1,591 words
- [5. Lists and interactions](#5-lists-and-interactions) · 1,662 words
- [6. Artwork](#6-artwork) · 221 words
- [7. Derived and operational entities](#7-derived-and-operational-entities) · 1,031 words
- [8. Cross-cutting behaviour](#8-cross-cutting-behaviour) · 195 words
- [9. Open questions](#9-open-questions) · 486 words
- [10. Entities implied by recorded product direction](#10-entities-implied-by-recorded-product-direction) · 1,009 words
- [11. Open questions carried from product direction](#11-open-questions-carried-from-product-direction) · 800 words

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
| `hydration_status`       | `pending` / `fetched` — whether the full release-group detail has been fetched. See below **[DECIDED 2026-08-24]**                               |

**On dates.** MusicBrainz dates are frequently year-only or year-month. Storing a full date keeps sorting and range queries trivial; the separate precision marker keeps display honest, so a year-only release shows as `2004` rather than the invented `1 January 2004`. Storing the date without precision would make that distinction unrecoverable — the marker is what leaves room to handle dates more precisely later, as you flagged, without a migration or a re-ingest. **[INFERRED — a small addition to what was decided; drop it if you'd rather keep the column count down and accept lossy display.]**

**On hydration.** An album may exist before its full detail has been fetched. Progressive hydration (`architecture.md` §7) creates album rows from a MusicBrainz _browse_ response, which carries every column the album card needs but no releases; the full `release-group` fetch is deferred until someone opens the album.

`hydration_status` records which of those has happened, and it is read together with `representative_release_id`:

| `hydration_status` | `representative_release_id` | Meaning                                                            |
| ------------------ | --------------------------- | ------------------------------------------------------------------ |
| `pending`          | null                        | minimal record; full detail not successfully fetched               |
| `fetched`          | not null                    | full detail fetched, release group has releases                    |
| `fetched`          | null                        | full detail fetched, release group genuinely holds **no** releases |

**Two states, not four, and the omissions are deliberate.** `artwork_status` and `tracklist_status` both carry `absent` and `failed`; neither belongs here.

- **No `absent`.** The fact it would record — fetched, and genuinely empty — is already carried by the column pair above. A third value would encode the same fact twice.
- **No `failed`.** `pending` means "not successfully fetched", which is honest whether the attempt never happened, failed, or exhausted its retries. **The job queue remains the source of truth for retry and error state**, and duplicating it on the album would give one fact two homes that can disagree. The artwork precedent does not transfer: `failed` earns its place there because `artworkCoverage()` would otherwise report success it had not achieved, and hydration has no equivalent metric — a `pending` album is simply not hydrated.

Adding a value later is a small migration, and there is precedent for exactly that in `artwork_status`, which shipped without `failed` and gained it when evidence demanded it.

**Scope constraint.** Per the catalogue scope decision, only albums, EPs and mixtapes are ingested; singles are excluded. Live albums, compilations and soundtracks are included. This is enforced **at ingest**, not at query time — an out-of-scope release group should never become a row.

**This is a current boundary, not a permanent one. [AMENDED 2026-08-23]** The singles exclusion holds today and no code changed with this amendment, but **"singles are permanently excluded" is explicitly not decided** (`product-spec.md` §8.9). The eventual treatment turns on a distinction this model does not yet make: **the single _release_ versus the unique _recordings_ it contains** — a standalone track or a B-side appearing on no album. That converges on §11.10 rather than opening a new question, and **nothing here adds a column.**

Note also that the **immediate depth boundary is narrower than this scope**: live albums, compilations and soundtracks are in scope but are not being ingested by the depth work, so admitting them is a depth-policy decision rather than a scope one.

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

**Maximum ten per user, enforced in two places and for two different reasons.** **[DECIDED — 2026-08-18]**

| Layer         | What it provides                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service layer | The **friendly user-facing error** — a `favourites_full` `Result` the interface can render, checked before the write is attempted                     |
| Database      | The **concurrency-safe invariant** — `check (position between 1 and 10)` plus `unique (user_id, position)` caps the table at ten rows by construction |

The division matters. A count-then-insert check in application code is racy: two concurrent requests can each observe nine existing rows and each insert, yielding eleven. **The service-layer check is a courtesy, not a guarantee**, and it must never be treated as one. The constraints are what actually hold the line, and a request that loses the race still returns `favourites_full` rather than crashing, because the service catches the constraint violation and maps it back to the same outcome.

This is the same division as handle uniqueness on `Profile`: the service checks availability for a good message, the unique index is the truth.

The position constraint is `deferrable initially immediate` so a reorder can move several rows inside one transaction without tripping over itself mid-update.

Independent of the collection — **[INFERRED]** you may favourite an album you haven't added, and favouriting does not add it, since a favourite is a statement about taste rather than a record of listening. Say if you'd rather favourites be restricted to your collection.

### Follow

Asymmetric. `follower_id` → `followee_id`, with `created_at`. Composite unique; self-follows rejected.

**Built 2026-08-30 as Phase 3's first slice.** The asymmetry was carried as `[INFERRED]` in `product-spec.md` §4 and is now **[DECIDED]**: A following B implies nothing about B following A, and a reciprocal follow is an ordinary second row. Nothing derives one direction from the other, and an integration test asserts it rather than assuming it.

| Field         | Notes                                                                |
| ------------- | -------------------------------------------------------------------- |
| `id`          | Surrogate uuid. See below — this is the one part that is not obvious |
| `follower_id` | → `profiles(id)`, `on delete cascade`                                |
| `followee_id` | → `profiles(id)`, `on delete cascade`                                |
| `created_at`  | Orders both relationship lists, newest first. No `updated_at`        |

**Why a surrogate key and not a composite primary key on the pair.** `album_artists` is the model for a pure join table and uses the composite. This one does not, because §7 gives `Notification` a nullable **`follow_id`** alongside `review_like_id` and `list_like_id`, and requires that unfollowing removes the notification by cascade. A composite key would force that table to carry two columns for one of its four subject references. The pair still carries `unique (follower_id, followee_id)`, so identity is unchanged — only its spelling.

**Two indexes, because the relation is read in both directions**: `(followee_id, created_at desc)` for followers, `(follower_id, created_at desc)` for following. Neither query can use the other's leading column. The "am I following this person" lookup is served by the unique constraint's own index.

**Self-follows are rejected in two places, for two different reasons** — the same division as the favourites cap. The service returns a `self_follow` `Result` for the message; `check (follower_id <> followee_id)` is the guarantee, and holds regardless of what the service does.

**Duplicate follows are idempotent.** A unique violation is caught, the existing row read back, and returned as success, so a double submit produces one row rather than an error.

**Counts are computed on read**, per §8 — no denormalised follower or following counter exists. Both counts apply the same active-profile filter as the lists, so a count never disagrees with the list it links to.

**No `Activity` row and no `Notification` row is written.** A follow is decided to generate a notification and decided _not_ to generate a feed event (`product-spec.md` §4). Neither table exists yet.

**No block interaction. [LIMITATION]** Follow creation and the relationship lists currently have no block check, because blocking is a later-phase feature (Phase 6). This is a stated gap rather than an oversight, and no abstraction was added in anticipation of it: when blocking arrives it is a service-layer precondition plus a filter on two queries, needing nothing from this schema.

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

**Why two timestamps.** `listened_on` is what the user asserts; `added_at` is what actually happened. **Collections sort by `added_at` descending by default** — `product-spec.md` §6, decided 2026-08-19 — because the collection answers what was most recently added, which is a fact about the account, while `listened_on` is a user-editable claim about the past that may be backdated. `listened_on` remains available as an explicit sort. `added_at` is also what drives feed eligibility.

An earlier version of this paragraph described the default as `listened_on` falling back to `added_at`. That fallback was **rejected** by the later decision, for a product reason — a backfill of old listens would displace everything added this week, around a date the page never displays — and for a technical one: the expression is not indexable, because casting `timestamptz` to `date` depends on the session time zone and is therefore not `IMMUTABLE`.

**Feed eligibility rule.** **[DECIDED — B1, amended 2026-08-18]**

An entry generates a `listened` activity event when a user **adds it interactively** — at the moment they act. It generates none when the entry arrives as **historical or backfilled data**. The rule is applied **once, at write time**, which is the reason the materialised activity table is worth having.

**`listened_on` does not decide this**, and the earlier version of this rule — "only when `listened_on` is today" — has been replaced. That version conflated two separate things: the anti-flood invariant, and a user's assertion about when they heard a record. Backdating is a claim about the past, not a request for silence.

**The discriminator is now the write path, not the date.** An interactive add produces an event; a bulk or imported write does not. That relocation is deliberate and it leaves one thing genuinely undecided — see §11.9.

**Implicit creation.** Rating, liking or reviewing an album the user hasn't added **creates the entry automatically**, with `listened_on` unset. **No `listened` event fires**, while the triggering action still produces its own event (`rated`, `reviewed`) or none at all (liking). **[DECIDED]**

**The reason changed with the eligibility rule, and the behaviour did not.** This used to be silent as a side effect of `listened_on` being unset. It is now silent for a better reason: **the event must reflect the action the user took.** They rated a record; they did not claim to have listened to it. Inferring a listen from a rating and broadcasting it is precisely the surprise this rule exists to prevent, and that reasoning no longer depends on a date field.

Without this, rating an album you'd never logged would announce to your followers that you had just listened to it, which may not be true. `FavouriteAlbum` is deliberately outside this behaviour.

### The single mutation path

**`ensure_collection_entry(user_id, album_id, listened_on)` is the only sanctioned way a collection entry comes to exist.** **[DECIDED — 2026-08-18]**

Every action that causes an entry goes through it — the explicit add, and the implicit ones behind rating, liking, reviewing and relistening. One path rather than five, so the Want to Listen clearing rule is implemented once and cannot be forgotten in the fifth place.

It is a database function because the upsert and the wishlist clear **must be atomic**. Two statements from the client would leave a window in which a collected album is still on the wishlist if the second call fails.

**It runs `security invoker`.** **[DECIDED]** Row Level Security therefore still applies to whoever calls it, and the function is deliberately **not** a privilege-escalation path — it cannot be used to write an entry for somebody else. Authorisation remains the service layer's job, exactly as it is everywhere else; this is defence in depth, not a substitute.

**It creates no activity event.** Activity belongs to the social phase, and an implicit add must never announce a listen the user did not claim.

`listened_on` is applied only on creation. Re-running the function for an album already held never rewrites a date the user set.

#### Direct writes to `CollectionEntry` are prohibited

**No application code may insert into `collection_entries` directly.** All writes go through `ensure_collection_entry`. **[DECIDED — 2026-08-18]**

The clearing rule is a property of that one code path, **not of the schema** — there is deliberately no trigger and no constraint enforcing it, because Want to Listen and the collection are independent relations that may legally hold the same album. A direct insert therefore creates an entry and silently leaves the wishlist row behind, which is a wrong state produced by a legal-looking write.

The prohibition covers application code and service functions. **Migrations and tests are exempt** — a migration may need to backfill, and the integration suite asserts the schema's behaviour precisely by bypassing the function to show what the schema does and does not guarantee. Anything else needs explicit authorisation.

**A trigger is not being added yet.** It would make the invariant self-enforcing, but it would also make the clearing rule a schema property, which is exactly the coupling the independence decision rejected. Revisit if a second writer ever appears.

### RelistenEvent

Discrete, timestamped rows — one per relisten.

| Field                 | Notes  |
| --------------------- | ------ |
| `collection_entry_id` | Parent |
| `occurred_at`         |        |

**These rows are the source of truth.** Marking a relisten on Monday, Tuesday and Wednesday produces three separate feed items, which a single count column cannot express.

**`CollectionEntry.relisten_count` is denormalised, and it is maintained by a database trigger.** **[DECIDED — 2026-08-18]** The trigger fires on insert and delete of `RelistenEvent` and adjusts the counter in the same transaction as the row it is counting.

**The reason is concurrency correctness, not convenience.** supabase-js exposes no multi-statement transaction API, so a service-layer counter would be two round-trips — insert the event, then update the count — with a window in between where a failure leaves the number permanently wrong, and where twenty concurrent relistens can interleave into a lost update. Making it atomic in application code would mean writing a database function anyway. The trigger holds the row lock for the duration, so the counter cannot drift and cannot lose a write.

It also survives write paths that do not exist yet: a backfill, an admin tool or a future import gets a correct counter without knowing it was supposed to maintain one.

**Nothing but arithmetic lives in the trigger.** No business rule reads `relisten_count`; it exists so a grid can render `×3` without a subquery. If the two ever disagree, the rows win and the counter is the thing to rebuild.

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

#### Three invariants, decided 2026-08-19

**An author deleting their own review is a hard delete.** **[DECIDED — A]** The row goes. `status = 'removed'` is a **moderation** state and is not the mechanism for ordinary author deletion — a hidden copy is the opposite of what a delete control promises. There is deliberately **no third status and no `removed_by` column**: the two mechanisms are distinguished by which code path runs, not by a discriminator on the row.

**Editing a review preserves its identity.** **[DECIDED — B]** `id` and `created_at` survive an edit; only `body` and `updated_at` change. This is load-bearing rather than incidental: Phase 3 hangs review likes, notifications and reports off the review id, and an id that changed on edit would orphan all three. It is guaranteed by writing edits as an update — an `upsert` on the unique `collection_entry_id` resolves to `insert … on conflict do update`, which keeps the row. **A delete-and-insert would satisfy every visible behaviour and silently break Phase 3**, so this is pinned by test rather than left to whoever next simplifies the query.

**No edit history, no versioning.** Editing replaces the body outright.

#### Author identity on a review

A review reaches its author through `collection_entries.user_id`, which references `profiles(id)`. Reads that render reviews must embed the profile — a review without an author is not renderable, and the reference already exists, so this is a query concern rather than a schema one. Moderation visibility is unaffected: live reviews are public, removed ones remain readable only by their author.

---

## 5. Lists and interactions

**[DECIDED 2026-09-03 — Phase 4 slice 1. Nothing here is built yet.]** The two tables below are the slice's whole schema. `ListLike` is **not** part of it and stays `[INFERRED]` below.

### List

| Field                             | Notes                                                     |
| --------------------------------- | --------------------------------------------------------- |
| `user_id`, `title`, `description` | `user_id` is the owner; only the owner mutates the list   |
| `is_ranked`                       | Whether items carry meaningful order                      |
| `status`                          | `live` / `removed` — moderation, **present from day one** |

**No visibility column.** Lists are public (`product-spec.md` §Lists, decided 2026-09-03), and a column with one legal value would imply an option the product does not offer.

### ListItem

| Field                 | Notes                                                    |
| --------------------- | -------------------------------------------------------- |
| `list_id`, `album_id` | Unique together — an album appears at most once per list |
| `position`            | Ordering. Meaningful only when the list is ranked        |

**The uniqueness is per list, not global** — the same album may appear in any number of different lists, which is the point of lists.

**Reordering leaves positions contiguous.** That is the invariant the phase's tests assert; **the mechanism that maintains it is an implementation decision, not a modelling one**, and no sparse or fractional positioning is implied by recording the invariant here.

**`position` is always stored and always maintained contiguous, on every list, ranked or not. [DECIDED 2026-09-03]** `is_ranked` decides whether that order is _meaningful to the reader_, not whether it exists. Read the row above as "meaningful only when ranked" — never as "maintained only when ranked", which would let an unranked list accumulate gaps and lose the order on the way back.

**Toggling ranking preserves the order in both directions, and that is the whole point.** Un-ranking **does not** null, reset or rewrite positions; re-ranking restores exactly the order that was there before, **with no fallback sort** — not by title, creation date or album metadata. The ordering is user curation, so turning ranking off must not destroy it, and the transition stays reversible without inventing an arbitrary reconstruction rule.

**Adding appends; removing closes the gap.** A new item takes `max(position) + 1` — at the end of a ranked list, and simply next in sequence on an unranked one. Removing an item closes the gap it leaves. **Reordering itself is offered only for ranked lists**, though the positions it maintains exist regardless.

**Deletion is hard, and the cascade directions are not symmetric.** Deleting a profile removes their lists; deleting a list removes its items. **Deleting an album removes the `ListItem` and leaves the List standing** — a list that loses one entry is still that list, and cascading upward would let catalogue maintenance silently destroy user-authored curation.

Per-item commentary is deferred; adding it later is a nullable column, requiring no restructuring. Ranked ordering is settled **now** precisely because it isn't. **[DECIDED — B7]**

### Likes

Three distinct things can be liked, and they are **not** modelled polymorphically:

| Liking a…  | Stored as                                                      |
| ---------- | -------------------------------------------------------------- |
| **Album**  | `CollectionEntry.liked` — already a column, no separate table  |
| **Review** | `ReviewLike` (`user_id`, `review_id`) **[DECIDED 2026-09-02]** |
| **List**   | `ListLike` (`user_id`, `list_id`) **[DECIDED 2026-09-04]**     |

Separate tables rather than a polymorphic `Like` table: polymorphic foreign keys can't be enforced by the database, and there are only two of them. The cost of the general solution exceeds its benefit here.

**`ReviewLike` is now decided, and only `ReviewLike`. [DECIDED 2026-09-02 — Phase 3 slice 4. Nothing below is built.]** This line previously carried the whole paragraph above as **`[INFERRED]`**, which by this document's own notation means "follows necessarily; flagged for correction". It is confirmed for reviews on the same reasoning that confirmed `Follow` on 2026-08-30, and **`ListLike` is deliberately left `[INFERRED]`** — Phase 4 owns it, and confirming a shape for an entity that does not exist would be deciding for a phase that has not started.

| Field                         | Notes                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `id`                          | uuid primary key. **Surrogate, not a composite key on the pair** — see below |
| `user_id`                     | → `profiles(id)`, `on delete cascade`                                        |
| `review_id`                   | → `reviews(id)`, `on delete cascade`                                         |
| `created_at`                  |                                                                              |
| `unique (user_id, review_id)` | One like per user per review, enforced by the database                       |

**The surrogate key is a downstream requirement, not a style choice.** §7 gives `Notification` a nullable `review_like_id` alongside `follow_id` and `list_like_id`, and requires that unliking removes the notification by cascade. **A foreign key must reference one column**, so a composite key on the pair would force that table to carry two columns for one of its four subject references. This is the identical argument that gave `follows` a surrogate key, and it is recorded here for the same reason.

**Cascades in both directions, and each covers a real case.** An author hard-deletes their review and its likes go with it; an account is deleted and both its own likes and the likes on its reviews go. Neither leaves an orphan, which the hard-deletion rule in §8 requires.

**Behaviour. [DECIDED 2026-09-02]** Liking is a **toggle**. Unliking **hard-deletes** the row; unliking something not liked is a **no-op**, matching `unfollowUser` and `removeWantToListen`. Liking requires the review to be **publicly readable**, so a moderation-removed review cannot be liked by someone who guesses its id — `reviews_public_read` stays the single authority on that rather than being restated.

> **Uniqueness and self-like prevention are not the same kind of guarantee, and the difference must not be blurred.**
>
> **One like per user per review is enforced by the database**, by the unique constraint above.
>
> **A user cannot like their own review, and that is service-layer behaviour only. [DECIDED 2026-09-02]** It is **not** an integrity boundary. `follows_no_self_follow` can be a check constraint because both columns sit in the same row; a review's author lives in another table, so a `CHECK` cannot express this and only a trigger could. **No trigger is introduced**: a self-like is a vanity annoyance rather than an integrity or privacy failure, and its worst outcome is one meaningless row and — once notifications exist — one notification to yourself. Describing it as enforced would be false.

Likes generate **no activity events** — they'd dominate the feed by volume. **[DECIDED — B5]** They do generate **notifications** to the content's author, which is the only way they become visible at all.

**That decision is unchanged, and slice 4 changes nothing about `Activity`. [2026-09-02]** No new enum value, no new subject column, no write. A review like is a **notification trigger, never a feed event**, and the four types `Activity` already carries stay exactly four.

**Notifications are not built in slice 4.** `ReviewLike` is the durable primitive the later Notifications slice consumes; until then a like is recorded and visible to nobody but its owner. One consequence of the cascades above is worth naming because that slice inherits it: **unliking destroys the like row, so a notification hanging off it cascades away too** — which is exactly what §7 requires of an undone action. Whether re-liking should therefore produce a second notification is the Notifications slice's question and is deliberately not answered here.

### ListLike

**[DECIDED 2026-09-04 — Phase 4 slice 2. Nothing here is built.]** This line was **`[INFERRED]`** until now, which by this document's notation means "follows necessarily; flagged for correction". It is confirmed rather than assumed: it mirrors `ReviewLike` because the same downstream requirement produces the same shape, and the two differences are stated below rather than left to be discovered.

| Field                       | Notes                                                                        |
| --------------------------- | ---------------------------------------------------------------------------- |
| `id`                        | uuid primary key. **Surrogate, not a composite key on the pair** — see below |
| `user_id`                   | → `profiles(id)`, `on delete cascade`                                        |
| `list_id`                   | → `lists(id)`, `on delete cascade`                                           |
| `created_at`                |                                                                              |
| `unique (user_id, list_id)` | One like per user per list, enforced by the database                         |

**The surrogate key is required for the same reason `ReviewLike` carries one.** §7 gives `Notification` a nullable `list_like_id`, and a foreign key must reference **one** column; a composite key on the pair would force that table to carry two columns for one of its subject references.

**Cascades in both directions.** An owner hard-deletes their list and its likes go with it; an account is deleted and both the likes it gave and the likes on its lists go. Neither leaves an orphan, which §8's hard-deletion rule requires.

**Behaviour. [DECIDED 2026-09-04]** Liking is a **toggle**, unliking **hard-deletes**, and unliking something not liked is a **no-op** — the same shape as `ReviewLike`, `unfollowUser` and `removeWantToListen`. Liking requires the list to be **readable to the caller**, so a moderation-removed list cannot be liked by a stranger.

> **A user cannot like their own list, and that is service-layer behaviour only. [DECIDED 2026-09-04]**
>
> **It is not an integrity boundary**, and the reason is identical to `ReviewLike`'s: a list's owner is `lists.user_id`, which sits in a **different table** from the like, so no `CHECK` can express the rule and only a trigger could. **None is added.**
>
> **One difference from `ReviewLike` is worth stating rather than discovering.** Because the rule is not enforced by the database, a caller writing directly to the table can still create a self-like. On a review that inflates nothing a reader sees; **`product-spec.md` §6 requires a like count on the list page**, so on a list it inflates a number the product displays. It remains a vanity annoyance rather than an integrity or privacy failure, and the decision is unchanged — but the consequence is not identical and should not be described as if it were.

**Likes generate no activity events**, exactly as review likes do not — the standing decision in §4 and above. A list like is a **notification trigger, never a feed event**. `list_created` and `list_updated` are **slice 3's** concern and are not affected by this decision.
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

**That sketch is now resolved into the query's actual semantics. [DECIDED 2026-09-01; built 2026-09-01 — see the correction below.]** The filter set in full — the sketch restated, then four decisions it left open:

| Rule                                                                       | Why                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events belong to actors the viewer **follows**                             | The sketch, unchanged                                                                                                                                                                                                                    |
| **Own activity is excluded**                                               | Confirmed as a decision rather than inherited from the sentence above it. The self-follow check constraint already makes this true of the follow graph, so no extra predicate is needed — pin it by test rather than leaving it emergent |
| The actor must be **active**                                               | `profiles_public_read` is `using (true)`, so RLS will **not** do this. The same filter the follower and following lists apply                                                                                                            |
| A `reviewed` event **disappears** when its review is not publicly readable | RLS does do this one: `reviews_public_read` restricts a `removed` review to its author, so an inner join drops the row. Recorded so nobody later relaxes that join to a left join and starts rendering events for removed reviews        |
| A `rated` event **disappears** when the entry's current rating is null     | The claim has stopped being true, which is what the paragraph above forbids. **This tolerates the non-atomic rating write; it does not fix it** — that remains `[OPEN]` and belongs to its own cycle                                     |

**These filters belong in the query and the domain layer, not in presentation.** They govern what the feed _is_, so a second client must get the same events — `CLAUDE.md`'s test for where domain logic lives.

**[CORRECTED 2026-09-02] These filters are built.** The block above opened "recorded before implementation, nothing below is built", which was accurate on 2026-09-01 and stopped being so the same day — the feed shipped in `0b73851`, CI-verified by run #71. **The filter set itself is unchanged**; only the build-state claim was stale, and it is marked rather than quietly rewritten. Who keeps such markers current between cycles is an unresolved process question and is not settled here.

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

### Discovery chart

The stored answer to a discovery chart, recomputed on a schedule rather than per request. **[DECIDED 2026-09-05 — Phase 5 slice 1. Nothing here is built yet, and no shape is chosen.]**

`product-spec.md` §8.3 decides a cached table rather than per-request computation, so a persisted read model exists **as a consequence of that decision**. **Its name, columns, keys, indexes and retention are deliberately not decided** — the product decision requires that it exist, not what it looks like. A schema author reaching this entry should expect to design it, not to find it designed.

**Distinct from `albums.popularity_score`**, which stays the external-source prominence signal with its existing consumers. **A materialised chart is not a popularity signal**, so `product-spec.md` §8.9's open question — whether the two popularity concepts become one field or two — is **not** answered by this entity and must not be read as answered by it.

**Its inputs are `CollectionEntry` and `RelistenEvent`, not `Activity`.** §8.3 requires backfilled collection data to count and `Activity` exists to exclude backfills, so they cannot be the same source. This is the one thing about the entity that is settled, and it is settled by product decision rather than by convenience.

**The chart is not capped at 20 and may hold more. [DECIDED 2026-09-05]** §8.3's 20 is a **floor** the external fill completes the chart to, never a ceiling: a chart with more than 20 qualifying internal albums stays that long, because internal results must not be truncated merely because they exceed the floor. **A row count is therefore unbounded by the product rule**, which a schema author should know before choosing keys or indexes. Whether the chart is materialised deeper than any consumer reads, and how the floor is applied at read time, **remain implementation concerns** and are unchanged by this entry.

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

**9.2 — MusicBrainz identifier changes.** MBIDs can be merged upstream when duplicate entities are reconciled; the old identifier redirects rather than disappearing. Our unique constraints assume stability. A re-sync strategy that follows redirects and merges local rows is needed — not for launch, but before the catalogue is large enough that a merge causes visible breakage. **That line moved closer on 2026-08-23:** the catalogue is now open-ended in breadth and completion-oriented in depth (`product-spec.md` §8.9), so "large enough" arrives sooner than a bounded seed implied. Still not scheduled.

**~~9.3 — Partial release dates.~~ RESOLVED.** Store as precise as the source allows, with defaults filling the gaps. See §2, Album.

**9.4 — Genre and tag data.** Deferred from the MVP, but if it lands later it attaches to albums and artists and is worth leaving room for rather than bolting on.

**~~9.5 — Handle reuse after deletion.~~ RESOLVED 2026-09-18. A deleted handle is reserved permanently and never becomes claimable again.**

**Decided on the impersonation case rather than on tidiness.** Freeing `@darryl` means every old link, mention and follower memory resolves to a stranger, and **the product has no mechanism to signal the substitution** — the new holder simply appears to be the old one. Reclaiming a scarce string is worth less than that.

**The mechanism holds the handle and nothing else.** A `reserved_handles` table of one column — the handle text, primary key — written by a `before delete` trigger on `profiles`. **It is deliberately not cascaded**, which is the entire point: it is the one row that must survive the deletion that creates it.

**No user id, no email, no timestamp.** A reservation needs none of them, and the less the row carries the less there is to justify keeping. **The omission of `created_at` is deliberate** and breaks this file's usual convention: a timestamp would tie a handle to a moment and give a correlation handle where none is needed.

**The tension with hard deletion is real and is answered rather than waved away.** `CLAUDE.md` calls an orphaned row a privacy failure, and a handle can identify a person — so retaining one after erasure needs a reason. **The reason is that the surviving row asserts nothing about anybody**: no link to a person, no way to recover who held it, no content. It is the same shape as the static reserved list that already refuses `admin` and `staff`. **This is recorded as defensible, not as settled forever** — `development-plan.md` Phase 7's security review should examine it again with the whole deletion path in front of it.

**Interaction with §8.8 of `product-spec.md`**, which held handle rules open and named this question as part of them: **this resolves the reuse half only.** Character set, length and the reserved-name list are unchanged and still provisional.

---

## 10. Entities implied by recorded product direction

`product-spec.md` §10 records several areas of decided-but-unbuilt direction. None of the entities below exist, none are designed, and none should be created without first asking the product questions §10 lists. They are named here so that a future migration does not discover them late.

**Want to Listen** (§10.1). **Schema resolved 2026-08-18.** A user–album relation held in **its own table**, separate from the collection. It is the **third** independent user–album relation after collection entries and favourites, and that is the point at which a generic `user_album_relation` table starts to look attractive — it should be resisted, because it makes every read polymorphic and forces a discriminator into queries that are currently direct. Keep the relations as separate tables.

The blocking question — _can an album be both collected and on Want to Listen?_ — is answered **yes**. They are independent concepts with independent lifecycles. Consequences for the schema:

- Want to Listen is a separate table keyed on `(profile_id, album_id)`, unique, referencing `profiles(id)` per decision E.
- **The collection table needs no status column.** This is what unblocks Phase 2: the collection migration can be written now without waiting on wishlist design.
- The two tables must be able to hold the same album for the same user simultaneously. Nothing may enforce mutual exclusion — no partial unique index across the pair, no check constraint.

**The clearing rule is one-directional, and it fires on creation only.** **[DECIDED — C, corrected 2026-08-19]**

_Any action that **causes a collection entry to exist** clears Want to Listen for that album_ — the explicit add and every implicit one (rating, liking, reviewing, relistening). It does **not** run in reverse, and it does not fire when a wishlist row is created.

**The precise trigger is the creation of the entry, not the invocation of the function.** The distinction matters and was originally implemented wrongly: `ensure_collection_entry` deleted the wishlist row unconditionally, so for an album already held, _any_ subsequent rate, like, review or relisten destroyed a wishlist entry it had no business touching. For an album already in the collection the action does not cause the entry to exist, so nothing is cleared.

That mattered because the two relations are deliberately independent and may legally hold the same album — an album collected first and wished second stays in both, and the unconditional delete quietly removed that state. Silent loss of a row on an independent relation is exactly the failure the independence decision exists to prevent.

Model it as an effect of collection-entry **creation**, in one place, so a sixth creation path inherits it rather than forgetting it.

Whether that effect is a database trigger or service-layer logic is an open implementation choice, not a product one. Service-layer logic is more consistent with the existing architecture — the collection mutation already has to write an `Activity` event in Phase 3, and decision G asks that those write points be single rather than duplicated.

Want to Listen additions generate feed events, so whatever `Activity` becomes in Phase 3 needs an event type for them.

**Taste overlap** (§10.2). Any similarity computation is a read-side aggregate over collections and possibly favourites, ratings, likes and reviews. It has no entity of its own until a decision is made to cache it, and that decision should follow the algorithm rather than precede it. Whether it is symmetric determines whether a cache is keyed by an ordered or unordered user pair.

**Profile location** (§10.3). `display_name`, `avatar` and `bio` already exist on the profile entity, per §2. **Only location is new.** Whether it is free text or structured is an open product question, and it decides whether this is a column or a reference to a place table. Whether historical location is retained decides whether it is versioned at all — the default assumption of a single mutable column silently answers "no".

**Messaging** (§10.4). Conversations and messages. Two aspects touch existing invariants directly:

- **Hard delete.** `CLAUDE.md` requires a complete cascade and treats an orphaned row as a privacy failure. A message has two parties, so "delete the user's messages" is ambiguous — deleting the sender's copy from the recipient's inbox and retaining it are both defensible, and both are work. This must be answered before the schema, not after.
- **Blocking already exists as a decision of record** (`product-spec.md` §4) and cuts interaction in both directions without hiding content. Messaging extends it rather than introducing it.

Message retention is an open question with a legal dimension, so the schema must not assume indefinite retention.

---

**Catalogue depth** (§10.7, recorded 2026-08-22). Nothing is designed and nothing should be. The direction is that the catalogue may eventually represent more than a canonical album list — alternate and regional editions, bonus tracks, soundtrack and guest appearances, compilation-only material. **The current model is already shaped for most of this**: `albums` (release group) → `releases` (edition) → `tracks` is the MusicBrainz shape, and `album_artists` already carries credit position, so a guest appearance has somewhere to live in principle.

**Two things are absent rather than wrong.** There is **no appearance entity** distinguishing "this artist performed on this recording" from "this album is credited to this artist"; and **`tracks` carries no MusicBrainz identifier at all** — see §11.10. Neither should be added speculatively. They are named so a future migration does not meet them cold.

**External provider identity** (`architecture.md` §19.1). If streaming links are ever stored rather than constructed, they belong in a relation **keyed to a catalogue entity and carrying a provider discriminator** — never as columns on `albums` or `tracks`, and never as the identity of either. `upstream_payloads` already demonstrates the shape with `(source, source_id, kind)`.

**Listening ingestion** (`product-spec.md` §8.11). **Undecided, and passive scrobbling remains a §2 non-goal.** If it is ever built, `architecture.md` §19.2 and §19.4 record the two constraints that would apply: a source discriminator from the first row, and a provenance distinction between deliberate and automatic entries. **`collection_entries` has no such column today**, which is worth knowing before anyone assumes ingestion is a small change.

## 11. Open questions carried from product direction

These duplicate `product-spec.md` §10 deliberately, because a schema author reads this document and not that one. **The authoritative list is in `product-spec.md` §10. Do not answer any of them here.**

- **11.10** — **Should `tracks` carry a MusicBrainz recording MBID?** Raised 2026-08-22. MusicBrainz distinguishes a **recording** (the audio, shared across every release it appears on) from a **track** (that recording's position on one release). `tracks` stores neither, so a track has **no upstream identity**: it cannot be reconciled when MusicBrainz corrects or merges a recording, cannot be recognised as the same recording across releases, and cannot be counted toward anything. Harmless while tracklists are display-only; a prerequisite for the completion direction in `product-spec.md` §10.7. Adding the column later is cheap, **backfilling it is not** — roughly one rate-limited request per release, and the cost grows with the catalogue
- **11.11** — **Does the collection need a provenance concept?** Raised 2026-08-22, and reachable only if `product-spec.md` §8.11 is ever decided. `collection_entries` distinguishes nothing about how a row came to exist. See `architecture.md` §19.4
- **11.12** — **A tension, recorded rather than resolved.** `CLAUDE.md` states _"Tracks are never rated, reviewed, **logged** or listed. **Tracklists are display-only**."_ The catalogue-depth direction would have tracks read for discovery and completion, which is neither rating nor reviewing nor listing — but is also not display-only. **The rule is unchanged and this is not a request to change it.** It is recorded because a completion feature would have to face it
- ~~**11.1** — Can an album be simultaneously collected and on Want to Listen?~~ **RESOLVED — yes, independent relations.** See §10.
- ~~**11.2** — Do collection adds, ratings, likes, reviews or relistens remove an album from Want to Listen?~~ **RESOLVED — yes, all of them.** One rule: any action that causes a collection entry to exist clears Want to Listen. See §10.
- ~~**11.3** — Is Want to Listen public on the profile?~~ **RESOLVED 2026-08-19 — yes, public, as its own profile tab.** The all-public model keeps its no-exceptions property, so no per-viewer filtering enters the schema. See `product-spec.md` §10.1. **This settles profile visibility only** — whether the same activity can be hidden from the _feed_ is a separate, still-open question, and no schema should be shaped for it yet.
- ~~**11.8** — Should Want to Listen be offered on an album already in the collection?~~ **RESOLVED 2026-08-20 — yes, in all three collection states.** The schema already permitted the state; this settles only whether the interface produces it. See `product-spec.md` §10.1. **Nothing about the schema changes** — the relations were already independent, the one-way clearing rule is untouched, and this is not mutual exclusion.
- ~~**11.9** — How is a manual bulk backfill kept out of the feed?~~ **RESOLVED 2026-08-31 — every interactive add writes its event; grouping is the feed's problem at read time.** The three candidates raised here — suppressing, aggregating into one item, or rate-limiting event creation — were all rejected at the write path. An event never written cannot be recovered, and deciding presentation before a feed existed to look at would have been deciding it blind; grouping at read time keeps both options open. **The anti-flood invariant is unaffected**: imports and backfills still generate nothing, because the discriminator is the write path — `addToCollection` writes a `listened` event and `ensureEntry` stays silent. Implemented in `src/services/social/activity.ts` as Phase 3 slice 2. **Read time has now arrived, and grouping is deferred there too. [DECIDED 2026-09-01]** The first following feed renders **every qualifying row as its own item**; nothing is collapsed. The reasoning that resolved this question one level up applies again unchanged — deciding presentation before a feed exists to look at is deciding it blind, and the feed slice is what produces the thing to look at. **Revisit when a real account produces a burst large enough to fill a page: twenty consecutive events from one actor**, at the page size decided in `product-spec.md` §6. Two things make the deferral cheap for now, recorded so it stays deliberate rather than forgotten: the feed excludes the viewer's own activity, so a backfiller floods followers rather than themselves, and grouping interacts with **keyset pagination** — a group spanning a page boundary is a genuine design problem, which suggests that when it arrives the query returns groups rather than the renderer collapsing rows.
- **11.4** — Is taste similarity symmetric? _(Decides the key shape of any cache.)_
- **11.5** — Is location free text or structured, and is history retained? _(Decides column versus reference, and versioned versus mutable.)_
- **11.6** — What happens to a two-party message when one party hard-deletes? _(Decides the cascade, and is a privacy commitment.)_
- **11.7** — What is the message retention policy? _(Has a legal dimension — see `product-spec.md` §10.4.)_
