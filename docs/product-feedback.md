# longplayr — Product Feedback

**Status: inbox. Not a specification, not a roadmap, not an authority.**

Observations captured while actually using longplayr — during a development cycle, between cycles, or at any other time. The point of the file is that **testing the product and running a development cycle are independent activities**, and neither should be able to derail the other.

Notation follows the rest of `docs/`: absolute dates, and **[OPEN]** / **[DECIDED]** reserved for the authoritative documents. Nothing here is marked decided, because nothing here is decided.

---

## Contents

- [1. Purpose](#1-purpose) · 92 words
- [2. Where this sits in the document hierarchy](#2-where-this-sits-in-the-document-hierarchy) · 187 words
- [3. Operating rules](#3-operating-rules) · 253 words
- [4. How to write an entry](#4-how-to-write-an-entry) · 264 words
- [5. Intake](#5-intake) · 37,161 words
- [6. Triage](#6-triage) · 310 words
- [7. Promotion — where an item goes when it leaves this file](#7-promotion--where-an-item-goes-when-it-leaves-this-file) · 251 words
- [8. Relationship to the development cycle](#8-relationship-to-the-development-cycle) · 498 words
- [9. Boundary with `docs/current-state.md`](#9-boundary-with-docscurrent-statemd) · 479 words

---

## 1. Purpose

Somewhere to dump a thought the moment it happens, without first working out what it means.

Bugs, small annoyances, "this felt confusing", design reactions, half-formed feature ideas, larger ideas that are plainly out of scope, and questions — all of it belongs in the same inbox. Sorting them out is a later, deliberate act; requiring the sort up front is what stops observations getting written down at all.

**The value of this file is capture, not organisation.** Resist any change to it that makes adding an entry harder.

---

## 2. Where this sits in the document hierarchy

It sits **outside** it. `docs/current-state.md` is the lowest authority in the project; this file has none at all.

| Authority                                    | Document                                     |
| -------------------------------------------- | -------------------------------------------- |
| 1. Non-negotiable rules and locked decisions | `CLAUDE.md`                                  |
| 2. What the product is                       | `docs/product-spec.md`                       |
| 3. How it is designed                        | `docs/architecture.md`, `docs/data-model.md` |
| 4. What gets built and when                  | `docs/development-plan.md`                   |
| 5. Where we are right now                    | `docs/current-state.md`                      |
| —                                            | **this file — observations, not decisions**  |

An entry here **never** overrides, amends, softens or reopens anything in those documents, however plainly it seems to contradict one. If an observation appears to conflict with a decision of record, that conflict is itself the thing to record — and the decision stands until it is changed in the document that owns it.

**This is not a second product spec and not a second roadmap.** It contains no decisions, no phase assignments and no requirements. When an item deserves to become one of those, it leaves this file (§6).

---

## 3. Operating rules

- **Add observations without deciding what they mean.** No classification required at intake. No evidence required. No reproduction steps required.
- **Feedback is not an instruction.** Writing something here is not asking for it to be built, fixed or investigated.
- **Feedback does not change the active development cycle.** An entry added mid-cycle changes nothing about that cycle's approved boundary.
- **Messy and incomplete is fine.** "Something about the album page feels wrong, not sure what" is a legitimate entry. Half-remembered, contradictory, and duplicate entries are all preferable to unwritten ones.
- **Everything coexists.** A crash, a font size, a five-year product idea and a question can sit next to each other. They get separated at triage, not at intake.
- **Decisions do not live here.** They live in `product-spec.md`, `design-reference.md`, `architecture.md`, `data-model.md` and `development-plan.md`. An entry may _record_ that a decision seems needed; it may not _be_ the decision.
- **Nothing is built from this file directly.** An item enters development only by being deliberately promoted (§6) and then planned through the normal cycle (§7).
- **Genuine emergencies may interrupt.** Data integrity, security, authentication, destructive behaviour, or a serious regression on a deployed environment. These are marked **`URGENT`** and raised out loud rather than filed quietly. Everything else waits. See §7.
- **Preserve the record.** Consistent with `CLAUDE.md`'s historical-integrity rule: when an item turns out to be wrong, already decided, or superseded, mark it and say why. Do not delete it and do not silently rewrite it.

---

## 4. How to write an entry

A date, optionally where you were, and what you noticed. That is the whole format.

An ID and a state are assigned when the entry is filed — not something to supply. `NEW` is the default and means nothing has been evaluated.

```markdown
### F-000 — short label

**2026-08-30 · album page · NEW**

Free-form text. As long or short, as certain or uncertain, as you like.
```

**Illustrative examples only.** The three below are fabricated to show the intended level of messiness. **They are not real observations, not requirements, and must never be triaged or promoted.**

```markdown
### EXAMPLE-A — rating control feels fiddly on the phone

**2026-08-30 · album page, 390px · NEW**

Tried to give something an 8.4 on my phone and gave it an 8.7 twice. Might just be
my thumbs. Might be that one decimal is finer than a touch target can do. Not sure
this is a real problem — noting it in case it comes up again.

### EXAMPLE-B — searched for an artist, got albums

**2026-08-30 · search · NEW**

Was looking for the artist and got a wall of records instead. Took a second to
work out where the artist page was. No idea whether that is wrong or just me.

### EXAMPLE-C — idea: something for records I own physically

**2026-08-30 · — · NEW**

Half-thought. Would be nice to mark that I actually have the vinyl, separately
from having heard it. Probably out of scope and possibly a bad idea, writing it
down anyway.
```

---

## 5. Intake

Newest at the bottom. Add freely.

### Open items

### F-001 — favourites should be a curated top N, edited from the profile

**2026-08-30 · profile, album page · TRIAGED — DECIDED 2026-09-16: NO CHANGE FOR NOW**

**Favourites stay exactly as they are** — a toggle on the album page, up to ten, in the order added. **The reordering interaction model stays open** (`current-state.md` §11), and so does whether choosing and reordering are one interface. Decided deliberately rather than left unanswered; revisit when there is real use to look at.

Reconsider how favourites work. The mental model should be closer to a Letterboxd top four — a deliberately chosen, small, ordered set that says something about you — rather than a pin you toggle wherever you happen to be.

Two parts to it:

- **Size.** Four feels a bit low. Maybe eight, maybe ten.
- **Where you edit them.** They should be chosen on a profile edit page, not from a control on each individual album page. Picking your top albums is an act of curation you sit down to do; toggling one while browsing is not the same gesture.

**Likes stay exactly as they are.** This is only about favourites.

**Context, not a resolution.** The cap is already 1–10 (`MAX_FAVOURITES`, enforced by the schema), so the size question may be about presentation rather than the limit. A profile-side editing surface also lands on the existing open item _"Favourites reordering needs an interaction model"_ (`current-state.md` §11) — reordering and choosing may be one interface rather than two. Neither of these settles anything; flagging both for triage.

### F-002 — search should autocomplete as you type

**2026-08-30 · search · NEW**

You shouldn't have to press enter to search. It should update as you type, the way the Spotify app does.

**Raised with a caveat.** This may have implications for search speed — unsure whether that makes it impractical.

**Related:** **F-020** records that this is the one trigger that would realistically justify revisiting the search-engine decision — whether the two are one decision is for triage.

**Context, not a resolution.** `current-state.md` §8 carries an open item, _"Search and add are slow"_, measuring roughly **20s** for a search that reaches MusicBrainz. That is the caveat above, measured. It does not decide anything here — a local-catalogue-only as-you-type search and an upstream-reaching one may be different questions. Flagged for triage.

### F-003 — act on an album without leaving the page you're on

**2026-08-30 · search, any grid · NEW** — _widened 2026-08-30; original observation preserved below_

**Original observation (search).** When results come up, you should be able to add one to your collection from the result itself, rather than clicking through to the album page first.

**Widened, same day — the whole pattern, not just search.** An easier way to hover over an album anywhere and act on it — add to collection, like, and the rest — instead of clicking through to the album page every time.

The reference is Letterboxd's tile hover, described as three controls:

- an **eye** — watched / unwatched
- a **heart** — like
- an **ellipsis**, opening a small menu: rate one to five stars, then show activity, review or log, add to watchlist, add to lists, show in lists, where to watch

And the behaviours in that menu are deliberately mixed: **some navigate away** (show in lists), **some open a modal** (review or log), **and some toggle in place without leaving the page** (add to watchlist).

**Context, not a resolution.**

- This is `product-spec.md` §10.6 — _"Quick actions on a tile, and on an upstream search result"_ — recorded direction, decided, nothing built and nothing scheduled. The original observation was its part **(a)**; the widening is its part **(b)**. Both halves of the entry now sit inside one recorded direction.
- §10.6 lists **seven questions that must be asked rather than inferred**, and the description above **is a candidate answer to two of them** — how many controls a tile can carry, and possibly the touch question, since §10.6 already names "a per-tile overflow control" as one candidate. **Describing a preferred pattern in the inbox is not deciding it.** Promotion is where that becomes a decision; this entry only records that the maintainer has a shape in mind.
- **The recorded rejection it has to clear** is in `CollectionTile.tsx`, which rejects _"hover-reveal as a layout (invisible on touch, so collection state would be unknowable)"_ and concludes _"Hover may later **enhance** Detailed, but must never be required to understand state."_ The file already notes quick actions do not reopen that rejection — reading state stays the state line's job — **but that they raise the same touch problem for acting, and that question is unanswered by design.**

**Four places the reference does not transfer cleanly, recorded as observations only:**

- **Rating.** Letterboxd's quick-rate is five stars. longplayr is **0.0–10.0 to one decimal**, which is a different interaction inside a small hover menu.
- **"Log film".** longplayr has no diary — one collection entry per album, permanently. There is no repeat log to offer, so that item has no counterpart.
- **Lists.** "Add to lists" and "show in lists" are **Phase 4**; nothing exists to add to.
- **Review in a modal.** The review interface is currently a page-level editor, so a modal would be a new interaction pattern rather than a shortcut to an existing one.

Flagged for triage as the clearest overlap with recorded direction in this file.

### F-004 — album and artist URLs should be slugs, not MBIDs

**⚠️ Appears delivered, observed 2026-10-02.** The URL supplied with F-061 is `/albums/popstar` — a slug, not an MBID. **Recorded as an observation from a link rather than from a check of the routes**; whether this entry is closed, and how collisions and artist paths were resolved, is triage's call.

**2026-08-30 · album page, artist page · CLOSED — DELIVERED 2026-09-18**

> **Status corrected at STEP 00 on 2026-09-26.** This read _PROMOTED — NOT YET BUILT_ for eight days after it shipped. Both `/albums/[slug]` and `/artists/[slug]` are live, backed by `20260918190000_bare_slugs_with_counter.sql` and two follow-on migrations carrying the slug into search credits and the feed. The two collision defects the cycle hit are `cycle-log.md` §88 and §89. **An inbox showing delivered work as open corrupts STEP A's ranking**, which is why this is corrected rather than carried.

**Readable slugs, and a clean switch: identifier URLs stop resolving.** The timing is the argument — four profiles and nothing meaningfully shared, so stranding links costs about as little as it ever will. **Three constraints go to its cycle**: slug collisions must resolve deterministically, an upstream rename changes a slug's source, and the MBID stays canonical identity — a slug is a label. Destination: `product-spec.md` §6.

The URL for an album or artist currently carries its MBID. A name-based path would be a better experience — something like the artist name and the album name instead.

For collisions, something like appending a year or a counter: `album-name-year-1` where two albums share a name and a year, or `artist-name-1` for two artists with the same name.

**Context, not a resolution.** Current routes are `/albums/[mbid]` and `/artists/[mbid]`; profiles sit at the root as `/[handle]`. Whether the proposal is a root-level path or a prefixed one is left as written rather than assumed — a root-level `/album-name` would share a namespace with handles. `data-model.md` §8 records **MBID as natural key**, and `CLAUDE.md` holds the catalogue read-only downstream of MusicBrainz, so a user-facing slug raises questions about where the slug is derived, stored and disambiguated, and what happens when upstream renames something or merges two MBIDs. **None of that is answered here.** Flagged for triage as carrying data-model and architectural implications.

### F-005 — no way to browse the whole catalogue

**2026-08-30 · browse · CLOSED — DELIVERED 2026-09-16**

**Shipped as `/albums/all`** (`7c88d9a`, PR #15, CI #124), and **confirmed on production**: 18 pages at 60 per page, four sorts, out-of-range correctly 404ing. **It filters nothing**, which is §8.9's rule that absence of an external signal must never gate discovery, finally expressed as a query. `cycle-log.md` §80.

**It immediately produced three follow-on entries** — F-046 (no page picker), F-047 (albums with no year) and F-048 (year sort runs one way) — which is what a surface being used looks like.

**A paginated catalogue-wide surface, sorted only by what the catalogue owns** — recently added, release year, title. **No popularity sort**, which follows from the prominence decision in `product-spec.md` §8.3 and is what unblocked this entry: the sort question it raised had no answer until then. §8.9's rule that absence of an external signal must never gate discovery binds it. Destination: `product-spec.md` §6.

There's currently no way to see all the albums on the site — you have to go looking for something by artist. Nothing lets you just look at everything that's there.

Sketch: a **See all** button on the main Browse page, opening another page showing all of them, paginated, and sortable — by year, by popularity, that sort of thing.

**Context, not a resolution.** Browse (`/albums`) is two fixed sections of 24 — Popular and Recently added — with no pagination and no sort, so the observation holds as stated. Three things it touches, none of them settled here:

- `current-state.md` §11 already carries _"Whether Browse needs a length boundary at phone width — a 'show more' or a shorter chart, decided alongside the real charts rather than now"_. A **See all** button is one candidate answer to that open item, which may mean these are one decision rather than two.
- **Sorting by popularity is not a settled thing to sort by.** `product-spec.md` §8.9 decided popularity is **two concepts** — external source prominence and longplayr's own engagement popularity — and whether they become one field or two is explicitly undecided.
- Browse Popular reads `popularity_score` and **excludes rows where it is null**, which is every self-service album. §8.9 decided that absence of an external signal must never gate search visibility or discovery. A see-everything surface bears directly on that principle — but whether it is the right instrument for it is a question, not a conclusion.

Whether a catalogue-wide sort reuses the six decided collection sort modes or needs its own vocabulary is also unasked. Flagged for triage.

### F-006 — sort an artist's discography by more than date

**2026-08-30 · artist page · TRIAGED 2026-10-02 — BOTH HALVES NEED A DECISION; NOT AGENT WORK**

> **Re-triaged at STEP A on 2026-10-02 and deliberately not built.** Each half is blocked on a decision rather than on effort. **The popularity half** hits the constraint this entry itself records — `popularity_score` is null on every self-service album, so a naive popularity sort sinks all of them — and how to handle that is a product question. **The open-ended half**, "other metrics", is undecided scope, and `product-spec.md` §10 is explicit that answering an open question by taking the obvious default is a scope violation rather than a judgement call. **Adding `title` alone was considered and rejected on exactly that ground.**

> **Re-triaged at STEP 00 on 2026-09-26.** The ask — sort by something other than date — is **unmet**: `DiscographySort` in `src/services/catalogue/queries.ts` offers `newest | oldest`, which is two directions of one field. **But a sort control, a URL parameter, a tested pure comparator and a rendering component all now exist on the artist page**, where none did when this was filed. The entry is unchanged in substance and materially cheaper to build.

On an artist page the discography can only be read oldest-first or newest-first. It should be sortable by other metrics too — popularity, for example.

**Context, and this one may already be answered.** Two parts of it are decided in `product-spec.md` §6:

- **Popularity sorting is already decided direction with a phase attached** — _"Sorting by popularity waits for the popularity layer in Phase 5."_ So the example given is not a new idea; it is scheduled work that has not been reached.
- **Rating sorting is explicitly deferred**, along with any artist-level aggregate rating, by decision on 2026-08-20. `current-state.md` records that item as **closed rather than outstanding**.

**What is not covered** is the open-ended half — "other metrics" may include axes neither decision addresses. This entry is therefore a strong **already decided** candidate for the popularity half, and possibly not for the rest. Triage should decide which, rather than this note doing it.

One constraint worth having on record before a popularity sort is built: `popularity_score` is **null on every self-service album**, so a naive popularity sort sinks all of them to the bottom. `product-spec.md` §8.9 decided that absence of an external signal must never gate discovery, and that popularity is two concepts whose reconciliation is undecided. That does not resolve anything here; it is the thing Phase 5 will have to answer.

### F-007 — hydrate an artist's discography on first view of the artist page

**2026-08-30 · artist page · CLOSED — DELIVERED 2026-09-07**

**Outcome: built as proposed.** On-demand expansion ships in `aba3a07` (CI #95) — opening an artist page enqueues a discography expansion once per artist, within the existing depth boundary. **Destination:** `product-spec.md` §8.9 and §6, `architecture.md` §7 _Progressive hydration_, `cycle-log.md` §59. Its own defects were filed separately as F-026, F-027, F-029, F-030 and F-034 rather than reopening this entry.

Artist pages read thin. Opening Joanna Newsom shows a single album, and that one appears to be a record I added myself through search rather than anything that arrived in the seed.

The idea: **the first time an artist page is viewed, go and populate that artist's albums** — the same shape as the way a tracklist and the rest of an album's detail are fetched the first time you open an album.

**Context, and this one is closer to existing machinery than it looks.**

- **The mechanism already exists.** `discoverAndIngestArtist` fetches an artist's in-scope release groups and ingests them, driven by a `discover_curated_artist` job kind that is already in the schema and already has a runner. What does not exist is a **trigger from viewing an artist page** — today it is enqueued only by the operator-driven curated-tranche flow. So this reads as a new trigger on existing machinery rather than new ingestion work.
- **The goal is decided principle, not a new idea.** `CLAUDE.md` and `product-spec.md` §8.9 hold the catalogue **completion-oriented in depth** — once an artist is in, the aim is their whole in-scope body of work. Thin artist pages are the known symptom: measured 2026-08-23, **163 of 261 artists (62.5%) held exactly one album**, because the seed source was a global _album_ chart that admitted artists incidentally. Joanna Newsom looks like exactly that pattern.
- **The numbers in the observation are close but not quite the shape of the record.** The 27 is the count of hand-added self-service albums, not the size of a curated artist set; the seed was 362 albums across 261 artists. This does not change the observation — it sharpens what it is evidence of.
- **The depth work is assigned to a Phase 1 reopening and is blocked on a curated starting set that does not exist yet.** A view-triggered hydration needs no list, so it may sidestep that blocker entirely. **That is a question for triage, not a recommendation** — whether demand-driven depth is an acceptable substitute for, or complement to, list-driven depth is undecided.

**Three things that would have to be answered, recorded so they are not assumed:**

- **It cannot be synchronous, and the analogy drawn is already the asynchronous one.** Artwork and tracklists are **queued jobs drained by cron**, not fetched during the request. MusicBrainz is capped at one request per second per IP as a `CLAUDE.md` non-negotiable, and an artist discovery is many requests. So the realistic behaviour is _"queued on first view, appears some time later"_, not _"populated when the page loads"_ — a materially different experience from the one the idea describes, and worth deciding deliberately.
- **A page view is an unauthenticated trigger.** Anyone, signed out, including crawlers, could enqueue upstream work by opening a page. `product-spec.md` §8.4 rate-limits self-service additions at 30/hour and 100/day **per user**, which does not cover an anonymous view. What guards this is unanswered.
- **Queue capacity.** The job queue has been badly backed up before — drained 2026-08-25 after a long backlog. A view-triggered source of jobs interacts with drain throughput.

Also note "all the albums" is bounded by the current ingest scope — albums, EPs and mixtapes only — so hydration would not produce a complete discography in the everyday sense.

Related: F-005 and F-006 both touch the same underlying thinness from different surfaces.

### F-008 — contributing upstream as the answer to catalogue gaps

**2026-08-30 · catalogue, ingestion · CLOSED — DECIDED 2026-09-16: YES, IT IS THE STRATEGY**

**Noticing a gap and routing someone to fix it upstream is now a stated principle**, recorded in `product-spec.md` §8.9. longplayr never authors metadata itself. **It opened an unresolved conflict rather than closing cleanly**: material MusicBrainz will not accept would require user-authored metadata, which `CLAUDE.md` forbids — filed as F-037.

Two separate gaps keep resolving to the same answer, and that answer appears nowhere in the docs: **when something is missing, add it upstream rather than adding a source.** Missing covers go to Cover Art Archive; missing releases go to MusicBrainz. longplayr then picks both up through the ingest path that already exists — no schema change, no second provider, no terms compliance to satisfy.

**The open question is whether this is longplayr's actual strategy for upstream sparsity, or just something I do by hand occasionally.** It bears on the completion-oriented depth principle in `product-spec.md` §8.9.

**Context, not a resolution.**

- **This turns on a reading of a non-negotiable, and the reading should be made deliberately rather than assumed.** `CLAUDE.md` holds _"The catalogue is read-only downstream of MusicBrainz. No user-authored metadata, ever."_ The reading offered here is that the rule governs **longplayr's relationship to the catalogue, not the maintainer's relationship to MusicBrainz** — contributing to MusicBrainz as a person is outside what that rule addresses. That reading is coherent and is **not** recorded anywhere. Because it interprets a non-negotiable, it is the maintainer's call and belongs in `CLAUDE.md` or `product-spec.md` if adopted — not settled here.
- **If adopted as strategy it is a genuinely different answer** from the ones §8.9 already weighs. §8.9's immediate boundary says **"MusicBrainz only. No Discogs"**, framing the alternative to sparsity as a second provider. "Fix it upstream" is neither adding a provider nor accepting the gap, and it is unrepresented in that framing.
- It also interacts with depth: §8.9 aims at eventual completion of an artist's in-scope work, and an upstream gap is a ceiling on that which no ingest change can lift.

**Worked example, supplied as evidence — Venise.**

|             |                                                          |
| ----------- | -------------------------------------------------------- |
| MusicBrainz | `c831ea9c-4f91-49eb-a085-a23eca00a141` — **one release** |
| Discogs     | `discogs.com/artist/86857-Venise` — **three releases**   |

`discogs.com/release/13774980` (**_Heaven Is_**) is not in MusicBrainz at all.

**_Heaven Is_ is the cleaner case**: it reads as an album, so it is **in scope under today's boundary** and is simply missing upstream — **it needs no singles decision to count.** The remaining Venise material may be 12" singles, which today's ingest boundary excludes regardless of source; **formats could not be confirmed, because Discogs blocks automated fetches.** That last point is itself evidence for F-010.

**Related, and the record is close but not exact.** `current-state.md` documents the artwork gap this sits beside: measured 2026-08-25 across 707 albums, coverage is **93.4%** with **45 albums holding no upstream cover**, clustering by what a release _is_ rather than by artist obscurity — `remix` is **13** of the 45, the largest named secondary type, behind _(none)_ at 24. The specific album cited (SOPHIE — _PRODUCT (CUPCAKKE REMIX)_, `1dfb7401-0759-497c-9ede-0f4d0b5a2d6e`, `artwork_status 'absent'`) **is not itself in that document** — the cluster is recorded, that row appears to come from direct observation.

### F-009 — can upstream contribution be automated?

**2026-08-30 · catalogue, ingestion · NEW**

Follows F-008. If contributing upstream is the answer, can it be mechanised — detect something present in Discogs but absent from MusicBrainz or Cover Art Archive, push it upstream automatically, then ingest normally?

**Findings so far. None of these are verified to this repo's standard, and they are recorded as leads, not as established fact.**

- **Assisted import exists and is an established community norm.** A userscript adds an "Import into MB" button on Discogs release pages, pre-filling the MusicBrainz add-release form. Human-reviewed, submitted one at a time.
- **Full automation looks blocked.** MusicBrainz guidance is reportedly that data should not be transferred blindly between databases; its edit-review system exists to catch exactly that, and unattended mass edits require a sanctioned bot account.
- **Discogs terms get _harder_ under automation, not easier.** Bulk redistribution of their content into another public database is a more aggressive use than display, and their terms reportedly already restrict caching and storage and prohibit commercial use of Restricted Data.
- **Artwork is the hardest case, and it fails on copyright rather than on terms.** A Discogs cover scan belongs to the user who uploaded it, so re-uploading it to Cover Art Archive is not the contributor's to license.

**The asymmetry is the finding worth keeping:** **metadata is assisted-importable; artwork is largely not.** Which matters, because the measured longplayr gap is **an artwork gap** — 45 albums with no upstream cover — and that is the half this approach appears least able to fix.

**Context, not a resolution.** Every claim above needs verification before it can inform a decision; `architecture.md` §18 is where that is done and none of this is in it (F-010). The MusicBrainz side also brushes the `CLAUDE.md` rate-limit non-negotiable — 1 req/sec per IP, `503` on every request from that address when exceeded — which constrains any detection pass that walks a catalogue, quite apart from what submitting would involve.

### F-010 — Discogs API terms have never been verified

**2026-08-30 · architecture · NEW**

`architecture.md` §18 is where API terms get confirmed before anything depends on them. **Discogs is absent from that table entirely** — despite being named as recorded direction in §7a and raised as an open enrichment question in `product-spec.md` §8.9. It should probably become a **[VERIFY]** row.

**Preliminary and unverified.** Discogs rate limits are reportedly fine — 60/min authenticated, better than MusicBrainz. But their terms reportedly forbid caching content _"longer than is necessary"_ and displaying content more than **six hours** staler than their own site.

**If accurate, that is incompatible with how longplayr stores upstream data** — the fetch-and-store model, and `upstream_payloads` specifically, which deliberately keeps responses **verbatim and indefinitely with no refresh policy**.

**Context, not a resolution.**

- **The table's shape supports this.** §18 already carries two resolved rejections on exactly these grounds — **iTunes** (terms do not permit our use, ~20 req/min too tight) and **Deezer** (prohibits storing images). A Discogs row would sit naturally beside them, and its absence is the anomaly.
- **A second, sharper point: `product-spec.md` §8.9's recorded open question is narrower than the real one.** It asks how Discogs would supplement MusicBrainz **"as enrichment"** — and enrichment, per the `CLAUDE.md` non-negotiable, hangs off an entity **already identified by an MBID**. **A release that exists only on Discogs has no MBID to hang off**, and no home in the schema at all: `albums.mbid` is `not null unique` (confirmed in `20260814172931_create_catalogue.sql`). So the question as recorded cannot reach the Venise case in F-008. **Whether the recorded question should be widened is itself a decision, and is not taken here.**
- Verification is a `[VERIFY]` obligation against **current** Discogs documentation, not against these notes.

### F-011 — intent: singles and other out-of-scope release types, eventually

**2026-08-30 · catalogue · CLOSED — FULLY ANSWERED 2026-09-24**

**All three open halves are decided** (`product-spec.md` §8.9a). **A single is a full catalogue release**, collectable and rated like any album. **The discography hides singles by default with a control to include them** — a filter rather than a grouping, so §6's _never grouped by type_ survives intact rather than being reversed. **And the Bandcamp half was answered by amending a non-negotiable**: `CLAUDE.md` no longer says _no user-authored metadata, ever_. **Decided, unscheduled, unbuilt** — and the first question is whether anything genuinely cannot go upstream at all. See F-040.

**The maintainer said singles do enter the catalogue**, and then asked what the difference between a _catalogue release_ and a _discovery object_ actually is — **so the direction is settled and the form is not.** Recorded here rather than promoted, because the form is where every consequence lives.

**The three forms, stated plainly, since the entry names them without defining them.**

- **A catalogue release.** The single becomes a row like any album: it appears in discographies, and **can be collected, rated, reviewed and listed.** Simplest to build.
- **A discovery object.** The single is findable and leads somewhere, but **is not something a person adds to their collection.** Keeps _one entry per user per album_ meaning what it means; costs a second kind of catalogue thing.
- **Only through its unique recordings.** The single is not an entity at all — only a **standalone track or B-side appearing nowhere else** is represented. Narrowest, and it needs track-level identity, which `CLAUDE.md` currently constrains: _tracks are never rated, reviewed, logged or listed._

**⚠️ The consequence that makes this a real decision rather than a formality.** `product-spec.md` §6 decided a discography is **one interleaved chronological run, never grouped by type**, and that release type _"never fragments the grid"_. **An artist with forty singles would swamp their eight albums.** §5 of this file already records that as a _latent conflict_, noting the rule was settled when no artist held more than three releases — **admitting singles is what makes it live.**

**Two further things a catalogue release would touch**, neither of which the direction answers: whether a single is **collectable** — which changes what a collection is — and how it interacts with the depth boundary and the cold-start cap.

Stated intent: I expect to eventually want **singles**, and other release types not currently in scope, included in the catalogue.

**Extended and sharpened 2026-09-18, and the extension is larger than the original entry.** The intent is not only singles. It is **catalogue depth in the Discogs sense** — **bootlegs, remixes, and other release types currently out of scope** — and it reaches further than any release type:

> **A musician who releases a single track on Bandcamp should be findable.** Even where there is no official release at all.

**And the purpose was stated, which the original entry did not carry.** The site is meant to be a way for people to share their tastes **and to discover music from their favourite artists that is less known than the album releases**.

**Context on the extension, not a resolution.**

- **That purpose is almost word for word an already-recorded concept.** `product-spec.md` §10.7 absorbs the earlier _Unheard_ idea as _"helping a listener find lesser-known material associated with an artist, including recordings a normal discography hides"_ — and §10.7's catalogue-depth half is **decided principle** as of 2026-08-23. **So the goal is recorded; what is not is how far the catalogue reaches to serve it.**
- **The Bandcamp case is a different problem from singles, and should not be triaged as the same one.** A single, a bootleg and a remix are **release types MusicBrainz already models** — admitting them is a scope-boundary decision. **A self-released Bandcamp track may not be in MusicBrainz at all**, which makes it a question about **what the catalogue is downstream of**, not about which release types it admits. `CLAUDE.md` holds the catalogue **read-only downstream of MusicBrainz** with **no user-authored metadata, ever** — a non-negotiable that the release-type question never touches and this one runs straight into.
- **There is a route that does not breach it, and it is already in this file.** **F-008** records contributing upstream rather than adding a source: MusicBrainz does accept self-released and standalone material, so a Bandcamp-only track could be **added upstream and then ingested normally**. That keeps the non-negotiable intact — but F-008's own open question is whether upstream contribution is longplayr's actual strategy or an occasional manual act, **and at this scale it would have to be the former.**
- **The remix and bootleg half interacts with two things already measured.** Uncovered albums skew to remixes and demos (F-037's recorded tension), and `current-state.md` states coverage falls further as discographies deepen. **A catalogue deliberately reaching for that material inherits that artwork gap by design**, which is F-012 through F-014's territory.
- **Everything §8.9 and §10.7 list as must-be-asked remains unasked**, including whether a single becomes a catalogue release, a discovery object, or is represented only through the unique recordings it contains. **This extension does not answer any of it.**

**Recorded as stated intent only, and deliberately not as an answer.**

`CLAUDE.md` and `product-spec.md` §8.9 both hold the **eventual treatment of singles as undecided and explicitly must-be-asked** — in particular whether a single becomes a catalogue release, a discovery object, or is represented only through the unique recordings it contains, such as a standalone track or a B-side appearing nowhere else. §8.9 separately lists **which further release types are admitted, and when**, among its unresolved items.

**This entry answers neither.** It records that the maintainer has a direction in mind. It becomes a decision only through triage, STEP A and STEP B, recorded in `product-spec.md`.

**Context, not a resolution.** One cost is already on the record and bears on timing rather than on the decision: §8.9 notes that the scope filter is **the one place the system discards upstream records outright** — no row, no payload, no ledger of what was rejected — so admitting singles later is **a full upstream re-traversal per artist** rather than a local reshape. §8.9 states plainly that this is an observation about cost, **not a recommendation to build a ledger**. Related: F-008's Venise material, whose possible 12" singles are excluded by today's boundary regardless of source.

### F-012 — fanart.tv as a candidate second artwork source

**2026-08-30 · artwork, architecture · TRIAGED — DEFERRED 2026-09-16 PENDING TERMS VERIFICATION**

**Not admitted, and not rejected.** The entry's reading was accepted — §7's objection was about **keying**, and fanart.tv is MBID-keyed, so that objection does not apply. **Licensing and rate limits are unverified**, and a `[VERIFY]` row now exists in `architecture.md` §18. Nothing may depend on it until that clears.

A candidate for the artwork coverage gap. **Unlike every previously rejected fallback, it is keyed by MusicBrainz release-group ID** — the same key longplayr already fetches on.

Why that distinction carries weight: `architecture.md` §7 chose Cover Art Archive only for a stated reason, and the reason is about **keying, not about exclusivity**. The section is headed _"Artwork: one source, no fallback"_ **[DECIDED — verified]**, and its justification reads: _"**Keyed by MBID**, so a cover can never be attached to the wrong album. Both rejected options relied on fuzzy name matching, which produces exactly that class of bug."_ iTunes and Deezer additionally died on terms.

**The reading offered here is that fanart.tv fails neither test on its face**, so admitting it would be a **much narrower amendment than "add a fallback source" sounds** — the rule's own justification would survive intact. Recorded as a reading, not as a finding.

**Two things unverified, and both must be before anything depends on this:**

- **Its terms of use**, including commercial use and image storage. `architecture.md` §18 is where API terms get confirmed; **fanart.tv is absent from that table entirely.** Likely belongs there as a **[VERIFY]** row.
- **Its actual coverage of longplayr's real 45 uncovered albums.** It requires a free personal API key, so measuring is cheap. fanart.tv is media-centre oriented and **likely skews to popular releases, which is the wrong skew for our gap.**

**Context, not a resolution.**

- **The rule it touches is a top-authority statement, but it is not one of the bulleted non-negotiables.** `CLAUDE.md` line 58 carries it in the **Stack table** — _"Cover Art Archive only, by release-group MBID. No fallback source"_ — rather than under "Non-negotiable rules". **The procedural conclusion is unchanged**: `CLAUDE.md` is top authority, so amending it needs an explicit decision and cannot happen by promotion from this file. Only the label differs, and it is recorded precisely so the amendment is described accurately if it is ever made.
- **The separation drawn is worth keeping.** Measuring coverage and verifying terms **does not require the decision** and would inform it. Neither touches code, schema or the rule itself.
- **§18 now has two candidate gaps in this file** — this one and Discogs (F-010). Whether that is one verification pass or two is a triage question.
- The claim about fanart.tv's popularity skew carried a cross-reference to a further entry that **did not arrive in the same message** — see the note at the end of this batch. The claim itself is recorded above; its supporting entry is not yet filed.

### F-013 — internal worklist for albums with no cover art

**2026-08-30 · artwork, admin · CLOSED — DELIVERED 2026-09-16**

**Shipped as a section on `/debug/queue`** (`cycle-log.md` §76). Two groups: albums Cover Art Archive holds nothing for, each deep-linked to the upload page, and albums whose fetch failed — shown but **deliberately not presented as a task**, since the sweep is already retrying them.

longplayr already knows which albums lack art: `artwork_status = 'absent'`, **currently 45 rows, queryable today**. The manual path is presently _"notice a placeholder, go find the album on MusicBrainz, find the right release, upload"_.

The idea: **an internal view listing every uncovered album, each deep-linked straight to the add-cover-art page for its representative release on MusicBrainz.** Turns the manual step into two clicks instead of a search.

**Attractions, as stated:** pure local data plus URL construction. No third-party API, no terms exposure, no fuzzy matching, nothing written to a shared database, and **no non-negotiable involved.** It also stays correct as coverage drifts down with catalogue depth.

**Open:** whether it is admin-only or public; whether it belongs in the product at all versus being a script; whether it should rank by anything.

**Context, not a resolution.**

- **Both factual premises check out.** `artwork_status = 'absent'` is **exactly 45**, measured 2026-08-28 (`found` 661, `failed` 1, `pending` 0). And `albums.representative_release_id` exists in the schema, so the release the deep link would target is already held locally — the construction needs no lookup.
- **The drift expectation is not an inference; it is on the record.** `current-state.md` states that deepening a discography _"reaches proportionally more remixes, demos and live records, so artwork coverage"_ falls — and the measured clustering supports it: of the 45, `remix` is 13, `demo` 4, `mixtape` 4, with `(none)` at 24. Under the completion-oriented depth principle this worklist gets **longer**, not shorter.
- **It overlaps F-014**, which is the user-facing version of the same routing idea. Whether they are one feature at two audiences or two separate things is a triage question.
- Note the "admin-only or public" question is not idle: `product-spec.md` §6 defines an Admin surface and Phase 6 owns it, so a public version and an admin version land in different phases.

### F-014 — users contributing cover art, routed to CAA rather than hosted here

**2026-08-30 · artwork · CLOSED — DELIVERED 2026-09-16**

**Shipped** (`5e41623`, PR #13, CI #119). An album page with no cover upstream offers a route to add one at Cover Art Archive, shown signed out as well as in. **The prompt alone would have been a dead end** — `absent` was never re-checked, so an uploaded cover would have been invisible forever — and `absent` now re-enters the artwork sweep behind a staleness window. `cycle-log.md` §78.

**The prompt-and-route variant is approved, from the album page.** Where an album has no cover, the page offers a route to add one at Cover Art Archive; the existing `fetch_artwork` job collects it. **It costs no rules** — catalogue stays read-only, artwork stays single-sourced, nothing user-authored is stored here. It is the public half of the operator worklist shipped in `architecture.md` §17b. Destination: `product-spec.md` §8.9.

**A question rather than a proposal.** Where an album has no cover, could longplayr users supply one — and if so, where does the image land?

**The variant that costs no rules:** longplayr **prompts and routes**, the image lands at **Cover Art Archive**, and the existing `fetch_artwork` job picks it up **with no code change**. The catalogue stays read-only downstream, CAA-only holds, nothing user-authored is stored locally, and the art becomes permanent and benefits every MusicBrainz consumer.

**Context, not a resolution.**

- **The mechanical claim holds.** `fetch_artwork` already exists as a job kind with a working runner, and artwork is fetched by release-group MBID — so a cover appearing at CAA is picked up by machinery that is already built. Nothing here proposes new ingestion.
- **It is the inverse of the copyright problem in F-009, and that inversion is the whole point.** F-009 found that re-uploading a Discogs scan fails because the scan belongs to whoever uploaded it there. A user supplying **their own** image does not hit that — but **whether they hold the rights they would be asserting is a question this entry does not answer**, and CAA contribution carries its own licensing terms.
- **Unasked, and listed so they are not assumed:** whether contributing requires a MusicBrainz account and what that does to the flow; what longplayr's responsibility is for what it routes into a shared database; whether anything is shown in-product before CAA has accepted it; and whether this is a feature or simply a link.
- **Overlaps F-013** — same routing idea, different audience.

### F-015 — the end-to-end suite tracks machine load, not randomness

**2026-09-02 · testing, environment · CLOSED — DUPLICATE of F-025**

**Outcome: superseded.** F-025 covers the same subject with measurement — 8 GB RAM, 0.015 GB free, 93% of swap consumed — and carries the maintainer's constraint that verification must not compete with the working machine. **Nothing here is refuted; it is simply the weaker statement of it.**

The three `[OPEN]` end-to-end flake items in `current-state.md` §8 are recorded as unexplained. Six measurements taken across the Feed and Review-likes cycles suggest they may not be: **the failure rate tracks system load closely enough to be worth testing deliberately.**

| Load average (1-min) | Run                               | Result                                            |
| -------------------- | --------------------------------- | ------------------------------------------------- |
| **3.4**              | `want-to-listen.spec.ts` isolated | **7 of 7 passed**, 44.5s                          |
| ~4                   | full `verify:full`                | 85 of 89, 4 failed                                |
| **12–20**            | full `verify:full`                | 47 passed, **20 failed** at 67 tests in — aborted |
| **50.1**             | `want-to-listen.spec.ts` isolated | **0 of 7 passed**                                 |

The 50.1 reading coincided with a macOS Software Update at 37% CPU. The 12–20 readings coincided with ordinary use of the machine — browsing and video — during which `SkyLight.framework`, the window server, sat at 34% CPU.

**The same three tests that failed at load 50 passed in 4.2–6.9s at load 3.4**, against the 30-second timeout they had exceeded.

**Context, not a resolution.**

- **Two configuration facts make this plausible rather than surprising.** `playwright.config.ts` sets `retries: 0` locally against `2` on CI, so a single local hiccup fails the whole run where CI absorbs it — `CLAUDE.md` already records that hazard. And every documented flake signature is a **timeout or a process death** — `signUp` timeouts, `net::ERR_ABORTED`, `session closed` — never an assertion about wrong output. Those are what CPU starvation produces.
- **It would also explain the integration outlier**, which is currently filed separately: one `collection.test.ts` test stalled ~880s against its own 15s budget while the suite ran 8.5× slow. CI ran the same 509 tests in 139.81s.
- **It does not explain everything, and should not be assumed to.** `collection.spec.ts:277` has an identified cause of its own — a missing `toHaveURL` wait — and has failed on otherwise-quiet runs. Load may be a trigger for a real race rather than the whole story.
- **§34 already investigated the end-to-end flakes once and did not converge**, concluding that baseline test duration does not predict failure under load. That finding is not contradicted here: this is about _machine_ load, not test duration.
- **What would test it:** run the full suite twice on a deliberately idle machine and twice under measured load, and compare. Cheap, and it either produces a reproducible relationship or rules one out.

**If it holds, the practical consequence is a documentation change rather than a code one** — that the local suite needs an idle machine, which is not currently written down anywhere. Flagged for triage.

### F-016 — the signup flow needs work

**2026-09-04 · signup, auth · TRIAGED — PARTLY ADDRESSED 2026-09-15, TWO ITEMS OPEN AND ONE NARROWED**

**[Updated 2026-09-15, after the two cycles below shipped.]** The **verification email** item has since split, and only its code half is done. `cycle-log.md` §71 built the unconfirmed-signup destination and §72 added a resend, both merged. **What remains is not code**: the built-in email provider caps the whole project at **two emails per hour**, so confirmation cannot be enabled at all until custom SMTP is configured, and **no provider is chosen** (`architecture.md` §6). The other two items — **Google sign-in** and **other providers** — are unchanged and still open. The list below is left as written.

**Two of the five items shipped**, on branch `signup-password-policy` (`31d8a42`, PR #5, **CI pending at the time of writing**). **The password is now typed twice**, and **a password policy exists**: a 12-character minimum, **no composition rules**, recorded in `architecture.md` §6 with the reasoning that requiring a digit or a symbol pushes people towards predictable substitutions while adding little entropy.

**The entry's own framing was right that these are separable, and one dependency it did not foresee made the split mandatory.** Sign-in and signup shared one validation schema, so **raising the minimum would have locked out every existing account with a shorter password** — the three staging accounts among them. Splitting the schema was a prerequisite rather than a refinement.

**Still open, and all three are gated on things only the maintainer can do:**

- **Google sign-in** — decided and unbuilt, blocked on a Google Cloud project with OAuth credentials (`deployment.md` §5), not on code.
- ~~**Verification email** — a deployment decision needing real SMTP.~~ **[DONE 2026-09-24]** Resend on a verified subdomain, confirmation ON in production, auth email limit raised to 60/hour. `deployment.md` and `architecture.md` §6 carry the settings. **Google sign-in remains open**, and so does the question of other providers.
- **Other providers** — recorded nowhere. Only Google is named.

**Also deliberately not built:** a breach-list check, which is the genuinely effective addition length does not give. It means an external call on every signup and a privacy question even under k-anonymity, and is `[OPEN]` in `architecture.md` §6.

Signing up today is an email and a password, and that creates the account. **The password should have to be typed twice.** Other things need looking at too: **integrating Google or other services**, **password complexity**, and a **verification email**. Unsure how much of this is already planned.

**Context, not a resolution. Some of it is planned, some is not, and the split is uneven.**

| Raised                      | Already on the record?                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type the password twice** | **No. Nothing anywhere.** The form has one password field, confirmed in `AuthForm.tsx`                                                                                                      |
| **Google sign-in**          | **Yes — decided, unbuilt.** `CLAUDE.md`'s stack says "email/password + Google", Phase 0's feature list says the same, and `architecture.md` §18 records Google OAuth as still unbuilt       |
| **Other providers**         | **No.** Only Google is named anywhere                                                                                                                                                       |
| **Password complexity**     | **No policy exists.** The only rule is a minimum length of 8, in the signup action's schema. No character, dictionary or breach-list requirement is recorded anywhere                       |
| **Verification email**      | **Yes, as a deliberate deployment decision rather than a build task.** `deployment.md` says to decide it deliberately; it is off locally and off on staging so end-to-end runs without SMTP |

Three details worth having alongside that table:

- **Google is blocked on an account, not on code.** `deployment.md` §5 records that it needs a Google Cloud project with OAuth credentials — a signup no amount of local development avoids. (`architecture.md` §18 points at "`deployment.md` §4" for this; the section is now §5.)
- **Verification email is already a stated launch prerequisite.** `current-state.md` carries _"Email confirmation disabled on staging... **Production must have it on**, which means real SMTP configured before launch."_ So the gap is known; what is absent is any scheduling of it.
- **The code already anticipates confirmation being on.** The signup action branches on there being no session when email confirmation is enabled, so turning it on is not expected to break the flow.

**Not flagged urgent, and the reasoning is recorded because this is auth.** The file reserves `URGENT` for cases where continuing would leave the product materially unsafe or insecure. This is a **hardening and UX gap on a pre-launch product**, not a live exposure: no production users exist, and the weakest item — an 8-character minimum with no complexity rule — is a policy gap rather than a defect. **Say if you read it otherwise and it will be re-flagged.**

**One process note for whoever triages this.** `CLAUDE.md` treats auth-adjacent work as always warranting plan mode and the full A–K cycle, and holds that auth goes through `src/services/auth/` rather than directly to Supabase. So even the smallest item here — a second password field — is not a trivial fix by this repo's own rules.

Whether this is one slice or several is a triage question: the confirm field is local form work, Google is a deployment prerequisite plus a provider integration, complexity is a policy decision, and verification email is an infrastructure decision. They share a surface, not a shape.

### F-017 — notifications cannot be reached at all on mobile

**2026-09-05 · notifications, mobile navigation · CLOSED — DELIVERED 2026-09-05**

**Outcome: fixed as the entry implied, without a fifth tab.** A `/notifications` link now sits on the personal surface at `src/app/[handle]/page.tsx:201`, shipped in `311bd70`. **Destination:** `architecture.md` §16.3, `cycle-log.md` §53.

There is no notifications link anywhere on the mobile version. Unclear whether that is intentional or planned for later — but if not, it needs addressing.

**Context, not a resolution. This one was checked, and it is a confirmed defect rather than an impression.**

**The four-tab shape is a decision, and it is not what is broken.** `architecture.md` §16.3 records **[DECIDED 2026-09-03]**: _"`MobileTabBar` keeps its four tabs — Browse, Search, Feed, You. The unread indicator attaches to the existing 'You' tab, **and notifications are reached on mobile through the user's personal surface**."_ Adding a fifth tab was explicitly weighed and rejected — it would narrow every other tab.

**What is broken is the second half of that sentence.** Traced through the code:

|                                |                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every link to `/notifications` | **One** — `layout.tsx:100`                                                                                                                                         |
| That link's container          | `<div className="hidden items-center gap-6 md:flex">` — **hidden below the `md` breakpoint**                                                                       |
| Mobile tab bar                 | Four tabs; **no notifications tab**, by decision                                                                                                                   |
| "You" tab                      | Carries the unread indicator (`indicate: unread > 0`, plus an `sr-only` ", unread notifications")                                                                  |
| The profile page it leads to   | **No link to `/notifications`.** Renders `Avatar`, `CollectionGrid`, `FavouriteRow`, `FollowButton`, `ProfileStats`, `SectionHeader` — none of them an entry point |

**So the dot promises a destination that does not exist on mobile.** A signed-in user is told they have unread notifications and has no route to them — the personal surface the decision relies on was never given the link. The only remaining way in is to type the URL.

**This reads as an implementation gap against a recorded decision, not as a decision anyone made.** The fix implied by §16.3 as written is a link on the personal surface, **not** a fifth tab — but which surface, and where on it, is not specified, and the decision predates the profile page gaining Lists and Follow. Triage's call, not this entry's.

**Not flagged urgent**, on the file's own test: no data integrity, security, authentication or destructive behaviour, and the product is pre-launch. It is a **confirmed defect with evidence**, which under §9 of this file is the class that belongs in `current-state.md` §8 once triage agrees.

### F-018 — the upstream "add to catalogue" search shows five results and cannot be expanded

**2026-09-05 · search, catalogue · TRIAGED — PARTLY ADDRESSED, STILL OPEN**

**One of at least two mechanisms is repaired; the entry does not close.** `abb3adc` (CI #94) separated fetch depth from display limit — `UPSTREAM_FETCH_DEPTH = 25`, `UPSTREAM_RESULTS = 10` — so the panel no longer shows four candidates because a `limit * 2` pool was filtered twice. **Still open:** whether the panel gets a "show more", and §8.10's **artist-matching** half, which is blocked on verifying field-qualified syntax against the live API. **Which mechanism caused the failures observed in use is unestablished**, and cannot be established locally or in CI because the placeholder contact prevents the panel populating. **Destination of the part that shipped:** `product-spec.md` §8.10, `cycle-log.md` §58.

When adding an album that longplayr does not already hold, the MusicBrainz panel returns only **four or five results**, and **there is no way to expand the search.** Tried several times; the record being looked for was not among them.

**Context, not a resolution. Already recorded as an open question — and this is new evidence for it, not a new finding.**

- **`product-spec.md` §8.10 records exactly this**, raised 2026-08-21: _"**It shows at most five candidates**, hard-coded, with no way to ask for more."_ It remains listed under **"Still unresolved"**, where the first item is _"whether the panel gets a 'show more'"_.
- **The limit is still five and still hard-coded** — `searchUpstream(query, 5)` at `UpstreamPanel.tsx:82`. Nothing has changed it.
- **The other half of §8.10 may be what is actually biting, and is worth checking before a "show more" is assumed to be the fix.** §8.10 also records that the panel **does not match artist names**: the typed string goes to MusicBrainz's release-group index, whose default field is the **title** — so searching by artist returns titles containing that word rather than that artist's albums. If the searches being attempted are artist-shaped, more results may not help; **which of the two limitations is responsible here is not established.**

**What this entry adds is recurrence and impact.** §8.10's original entry was a single observation from 2026-08-21. This is repeated failure in ordinary use, on the specific task the panel exists to serve — getting a missing record into the catalogue. That strengthens the case for scheduling without deciding the mechanism.

**Related:** F-005 (no way to browse everything) and F-007 (thin artist pages) are the other two entries where catalogue reach is the underlying complaint.

### F-019 — MusicBrainz aliases are not ingested, and they are the cheapest unused lever on search quality

**2026-09-05 · search, catalogue, ingestion · SPLIT 2026-10-02 — BOTH HALVES BUILT 2026-10-02**

> **Closed 2026-10-02. Both halves are built** — phonetic matching as §10.4's fallback tier, and alias ingestion as §10.5. **The deferral below lasted hours, not weeks**, and is preserved rather than deleted because its reasoning was sound: one of its two premises simply stopped being true the same day, when `write-local-env.mjs` was changed to preserve a real `MUSICBRAINZ_CONTACT` through `db:env`. The other premise — that this is a queue-and-ingest cycle with a new job kind rather than a search change — **held, and was honoured.** The live response also settled a question this entry raises without answering: **of Ye's twelve aliases, `Legal name` and untyped are refused** on privacy and noise grounds respectively, so "legal names" below is **not** what shipped.
>
> **Split at STEP B on a finding this entry does not contain.** **Artists only ever arrive embedded in `artist-credits`**, there is no direct `artist/{mbid}` lookup anywhere, and that include does not carry aliases — so **ingesting aliases needs a new upstream request per artist** against the one-per-second budget, plus a new job kind. This entry says aliases would arrive _"without touching the search engine"_, which is true and was never the hard part; what it does not say is that **nothing currently fetches them.** `architecture.md` §10.4a.
> **The second lever named here — phonetic matching — needs no upstream request and is being built.** §10.4: Double Metaphone as a **fallback only when the four existing tiers return nothing**, so no query that works today can change. Artists only.

From asking how Spotify, Discogs and Letterboxd tolerate badly misspelled queries. **The answer appears to be mostly data rather than algorithm** — and two of those data sources are available to longplayr and currently unused.

**MusicBrainz has a full alias system** — artist aliases, alternate spellings, transliterations, legal names, and common misspellings recorded as aliases. Discogs has the same idea as **Artist Name Variations**; Letterboxd carries alternate titles for foreign films. It appears to be a large part of why those products feel forgiving.

**longplayr ingests none of it**, and this was checked rather than assumed. The only occurrence of "alias" anywhere in `src/` or `supabase/` is a prose comment at `curated-artists.ts:155`, explaining how the K identity was resolved by hand. **No alias table, no alias column, nothing in the ingest path that reads them.**

Aliases would plausibly let **"Ye" reach Kanye West**, handle **transliterations** for the non-Latin titles already in the catalogue, and absorb **common misspellings** — without touching the search engine, moving the similarity threshold, or accepting another recall trade.

**A second unused lever, smaller: phonetic matching.** Postgres ships `fuzzystrmatch` (Soundex, Metaphone, Double Metaphone), which matches smith/smyth and suits names well. **Only `pg_trgm` is enabled** — confirmed, it is the sole `create extension` in the migrations.

**Cost, stated honestly rather than as a small change:** a new table, an ingest change, and a backfill of roughly **one rate-limited request per artist**.

**Context, not a resolution.**

- **The cost is a known, already-flagged cost rather than a new one.** `development-plan.md` records that _"Artist details remain unbuilt, and they are the only item needing an extra request, one per artist, since `/artist/` has never been called at all"_ — and notes that fact _"became load-bearing on 2026-08-23"_. So this proposal lands on an identified gap, not an unexamined one.
- **The recall trade it would avoid is real and quantified.** `architecture.md` records the article-normalisation change as an explicit tradeoff: roughly **42% fewer false-positive admissions for roughly 5 percentage points** of legitimate partial-prefix recall — _"The product accepts a 5 percentage point reduction ... in exchange for materially reducing article-driven fuzzy-credit noise."_ The claim above is that aliases add recall **without** spending precision, which is a different kind of lever from the ones tuned so far. **Whether that holds is untested.**
- **Adjacent to `product-spec.md` §8.10's open "upstream artist matching" question, and deliberately not the same item.** §8.10 concerns how the typed string is handed to MusicBrainz's Lucene index for the **upstream fallback panel**; aliases would improve **local catalogue** matching. **Related, and should not be collapsed into one item without deciding to.**
- Related in this file: **F-018** (upstream panel capped at five, and its artist-matching half) and **F-020** (why the engine is not the lever).

### F-020 — search engine choice, recorded so it is not re-litigated

**2026-09-05 · search, architecture · NEW**

Question raised: should longplayr be using Lucene, Elasticsearch or one of the newer engines, and if not, why not.

**This is already decided, and the record is specific.** `architecture.md` §10 chose **Postgres full-text search plus `pg_trgm`** **[DECIDED — E3]**, having explicitly evaluated **Typesense**, **Meilisearch** and **Algolia**. The recorded reasons: no additional service, no index-sync failure mode, adequate well past MVP scale, and the diagnosis that _"The real difficulty in this product is **disambiguation, not matching**"_. Algolia was additionally rejected on per-operation pricing suiting a browse-heavy product poorly. Search sits **behind the service layer** specifically so replacement stays contained.

**The implementation is a real one, not a `LIKE` query** — confirmed in the migrations: generated `search_vector` columns on `albums` and `artists`, `setweight` ranking title **A** above credit **B**, GIN indexes on both vectors, GIN trigram indexes on `albums.title` and `artists.name`, and a tiered `search_albums` combining exact, prefix, full-text and fuzzy tiers.

**Three things worth recording alongside that, none of which reopen it.**

- **For reference, and unverified to this repo's standard:** Spotify's search is reportedly built on Lucene, with separate indexes per entity type at around 30M entities. If so, the engine layer is commodity across the industry and the differentiation is **ranking and data**.
- **The single largest lever in world-class typo tolerance appears to be query logs** — having seen a misspelling before and knowing what users then clicked. **That is behavioural data a new product structurally cannot have**, which usefully bounds what any engine change could achieve here. Also unverified.
- **`architecture.md` §17 now names search relevance the load-bearing scalability concern** — confirmed, it is marked _"Now the load-bearing one"_ — because two of §10's three ranking levers have known problems: popularity is confirmed legitimately sparse (§8.9), and §8.10's faults 1 and 2 are unfixed. **Neither fault is one an engine swap would fix**: fault 1 is a fuzzy threshold too permissive for short words, which exists in any fuzzy system, and fault 2 is a deliberate choice of the `simple` text configuration, made because the catalogue is international.

**The concrete trigger that would justify revisiting.** **F-002** in this file asks for search-as-you-type. **That is precisely the use case Typesense, Meilisearch and Algolia are built for**, and it is the realistic reason an engine change would be considered — **not "search feels imprecise"**. Whether F-002 and this entry are one decision is for triage.

**Suggested ordering of search-quality work, as an observation and not a plan: aliases first (F-019), tuning second, engine last.**

### F-021 — discovery scoped to your network, rather than to everyone

**2026-09-06 · discovery, social · NEW**

Because of the social element the product is meant to have, two ways of using the follow graph for discovery rather than only for a feed:

- **Albums popular with people in your network** — a section, or a filter, showing what is popular among the people you follow rather than across the whole site.
- **Albums other people have and you do not** — a filter for records that are in another user's collection but not in yours. Albums you have not listened to yet that your friends have.

**Context, not a resolution.**

- **The second one is already recorded as candidate functionality, and is the closer to a decided home.** `product-spec.md` §10.2 (_Taste overlap and social discovery_) lists among its candidates _"albums one user holds that the other has not heard"_ — which is this, stated almost identically. §10.2 is **decided direction with the algorithm explicitly not being decided**, and it carries **six questions that must be asked**, including where any of it surfaces — profile, search, or a dedicated people-discovery surface.
- **The first one is not recorded anywhere.** No network-scoped popularity concept exists in any document. What exists is **global**: §8.3's "Popular this week" counts **distinct users site-wide**, measured by `added_at`. A network-scoped chart is a **different chart with a different denominator**, not a filter on that one, and nothing decides whether it should exist.
- **It also inherits an unresolved definitional problem.** §8.9 holds that popularity is **two concepts** — external source prominence and longplayr's own engagement popularity — and whether they become one field or two is undecided. A network-scoped chart can only be built on the engagement half, which sharpens that question rather than avoiding it. F-005 and F-006 both already point at it.
- **Both are cold-start sensitive in a way the global charts are not.** §3 already names the empty-feed problem for a user who follows nobody as _"the product's most significant cold-start risk"_. A network-scoped chart is empty under exactly the same condition, and the second filter needs someone else's collection to compare against.
- **Phase placement is not obvious and is not assumed here.** Follows are Phase 3 and charts are Phase 5, and these sit across that line.

**Related:** F-022 is the third idea from the same conversation and was filed separately, because it is a communication feature rather than a discovery one.

### F-022 — recommend an album to someone directly

**2026-09-06 · social · NEW**

An option to **recommend an album to another user directly**.

**Context, not a resolution. This is filed apart from F-021 deliberately, because it is a different kind of feature and carries a blocking precondition that a discovery item does not.**

- **Nothing in the documents records this.** It is not in §10.2's candidate list, which is about **inference** — similarity, overlap, what one user holds that another has not heard. A recommendation is **an act**: one user deliberately sending a specific album to a specific person.
- **That makes it directed, private, user-initiated communication, which is what `product-spec.md` §10.4 governs.** §10.4 holds direct messaging as decided direction, **unscheduled**, and behind an explicit **blocking precondition**: _"Before any messaging code is written"_, legal requirements must be researched for a small Germany/EU-based service carrying user-generated content and private messaging.
- **Whether a recommendation is messaging is genuinely open, and must not be answered by default in either direction.** A structured recommendation carrying no free text is not obviously the same thing as an open message; equally, a channel from one user to another is the thing the precondition exists to cover, and §10.4's own unresolved list — _who may message whom, whether a follow relationship is required, whether first-contact is permitted, blocking behaviour, reporting_ — applies almost word for word to a recommendation. **This entry does not decide it.**
- **The safe reading until it is decided** is that this cannot be built ahead of the §10.4 research, and that assuming otherwise would route around a precondition rather than discharge it.
- **A softer variant exists and is not the same feature**: surfacing a recommendation without a directed channel — for instance through taste overlap on a profile. That is F-021's territory and carries none of this.

**Related:** F-021, and `CLAUDE.md`'s standing rule that neither messaging nor taste overlap is implemented, scheduled, or authorised by being recorded.

### F-023 — a section on the album page showing who else has this album

**2026-09-06 · album page, social, discovery · NEW**

A section on each album page — **Collected by** — showing which users have collected that album. Ordered so that people already in your network come first, but open enough to **discover other people who like the same album even if they never wrote a review**. At scale it reads as a directory: three hundred people hold this record, click through to any of their profiles, and follow them from there.

**Refined the same day, and the refinement may change what the section is.** Perhaps it should not be _collected by_ at all. Being in someone's collection may be too weak a signal to be worth a directory — where **being in someone's ten favourites**, or **liked** by them, says something. Something along those lines rather than the flat collector list above.

**Context, not a resolution.**

- **The sharpest argument for it is in the observation itself, and it is a real gap.** Today the **only** way another user appears on an album page is by **writing a review** — `product-spec.md` §6 lists the album page as artwork, title, artist, year, average with count; your entry controls; tracklist and editions; **reviews from others**; then outbound links. But this product makes **rating optional and reviewing optional**, so everyone who added the record without writing about it is invisible on it. The average tells you 40 people rated it and gives you no way to reach one.
- **It is a concrete route to a §10.2 candidate, by a different mechanism than §10.2 imagines.** §10.2 lists _"discovering people through overlapping taste"_ verbatim among its candidates. But §10.2's framing is **inference** — similarity scores, counts in common — whereas this is **enumeration**: who holds this record. Same goal, different machinery, and the enumeration version needs no algorithm. §10.2's six open questions include _where does it surface_; **this proposes an answer, which is not the same as deciding one.**
- **The privacy model permits it, and that is worth stating because it is the obvious objection.** `CLAUDE.md` holds _"Everything user-generated is public. No private accounts, no per-entry visibility."_ A collector list exposes nothing that is not already public on each profile. **One observation rather than an objection:** it makes that public data **enumerable per album**, which browsing profiles one at a time does not — a difference in reach, not in permission. Recorded for triage rather than raised as a blocker.
- **Two access rules would govern this surface, and one of them does not answer the question.** `data-model.md` records blocking as suppressing _"following, liking, feed presence and notifications **in both directions**, but ... **not** restrict viewing — content stays publicly readable"_. **A collector list is neither a feed nor plain content**, so whether a blocked user appears in it is genuinely unanswered — and it is a surface whose whole purpose is to invite following, which blocking suppresses. Separately, Phase 6 requires _content and user status enforced across every read path_, so suspended and banned accounts must not appear. **Blocking is decided and unbuilt.**
- **The machinery mostly exists.** `/[handle]/followers` and `/[handle]/following` already render paginated user lists, and `src/services/social/` exports `listFollowers`, `listFollowing` and `toFollowUser`. A collector list is the same shape over a different query — this is not novel construction.
- **Ordering is the undecided part, and "people you follow first" is only the first rule.** What follows them — recency, rating, whether raters outrank plain adds, or nothing at all — is unspecified. And at three hundred collectors the album page needs the **bounded preview versus full destination** distinction §6 already makes load-bearing for profiles: _"A profile must never render an unbounded collection."_ The same reasoning applies here.
- **Terminology, not a correction of intent:** longplayr has **asymmetric follows**, not friends. "Add them as a friend" would be following them, with no reciprocity implied.
- **Cold-start caveat, shared with F-021:** with few accounts the section is either empty or effectively lists the entire userbase.

- **The refinement identifies a real problem with the original framing, and the product already has the three signals it needs.** longplayr distinguishes **collected**, **liked** and **favourited**, and they are not equivalent strengths. A favourite is capped at **ten per user** and `data-model.md` calls it _"a statement about taste rather than a record of listening"_ — independent of the collection, so you may favourite an album you have never added. **That cap is what makes the signal scarce**: "in nine people's top ten" is intrinsically bounded and legible in a way "collected by three hundred people" is not, and it answers the directory-at-scale problem rather than paginating around it. A like sits between the two, and note §8.5 means liking **implicitly adds** to the collection, so likes are a strict subset of collectors in a way favourites are not.
- **Which signal the section uses is undecided and is now the central question of this entry**, not a detail of it. Nothing here picks one, and the three produce different surfaces: a favourites-scoped section is short, high-signal and rarely empty for popular records; a collector list is long, low-signal and complete.
- **It has a dependency inside this file.** **F-001** proposes reconsidering favourites — how many, and editing them from a profile page rather than per album. A favourites-scoped section here inherits whatever that resolves to, including the count.

**Related:** F-021 (network-scoped discovery) and F-022 (direct recommendation) are the other two social-discovery entries; this is the one that needs no algorithm and no new communication channel.

### F-024 — the first seed batch is too mainstream to be the site's front page

**2026-09-07 · browse, catalogue identity · TRIAGED — DEMOTION HALF DELIVERED 2026-09-13, REMOVAL HALF OPEN**

**[Updated 2026-09-15.]** Item 6 below separates two fixes, and **the demoting one has shipped.** `design-reference.md` §11.11 gave the lead to **Recently added** — `relaxed` and captioned — and made Popular the caption-free secondary strip, on both Browse and Home. It is live in `src/app/albums/page.tsx` and `src/app/page.tsx`. **It is a cold-start treatment with an exit**, reopening when the internal chart reaches §8.3's floor of 20 from real activity.

**The removal half is untouched and item 3's warning stands in full.** Nothing has been deleted, and nothing should be.

**[Item 7 is now answered. 2026-09-16.]** Whether a high external score justifies prominence — the question this entry raised and no document answered — is decided: **an external popularity score exists only to stop a surface looking empty and never orders a lead section.** Not provisionally, and not only while the internal chart is thin. `product-spec.md` §8.3 carries it, and `design-reference.md` §11.11's exit condition narrows accordingly. **The removal half remains blocked** by §8.9's additive-expansion boundary.

The whole batch of artists ingested **before** the curated tranche — the all-time-most-popular seed — is rather basic, and it is currently what a viewer sees front and centre. **Remove it for now, or at least stop it being the lead.**

**The identity being described: Pitchfork, not Rolling Stone.** Not a rule that popular artists are excluded — some indie listeners legitimately hold Madonna, and users with more mainstream taste are welcome. **It is about the impression the default surface gives.** Beatles / Linkin Park / Rolling Stone as the opening statement reads mass-market, and that is not what this is.

**Context, not a resolution.**

**1. The mechanism is identified, and it explains the complaint exactly.** Browse Popular is an internal chart with an external fill: it reads `discovery_chart_entries` for `popular_this_week`, and when that yields fewer than 20 it tops up from `albums` **ordered by `popularity_score` descending, nulls excluded**. The internal chart needs collection activity that barely exists yet. **So Browse Popular is currently close to pure external fill — which is the ListenBrainz seed, ranked by how mainstream each record is.** The front page is not accidentally basic; it is sorted that way.

**2. The layout then gives that section the lead.** Browse ranks its two sections **by size alone** — Popular is `relaxed` and captioned as the lead, Recently added is the caption-free secondary strip. **The curated tranche, being recent, sits in the quieter strip while the mainstream seed occupies the lead.** The hierarchy is currently inverted relative to the identity above.

**3. ⚠️ The "remove them" half collides with a decided boundary — and is now more dangerous than that decision says.** `product-spec.md` §8.9 records: _"**Additive expansion only.** No destructive reseed and no catalogue deletion: `collection_entries`, `favourite_albums` and `want_to_listen` all cascade from `albums`, so deleting a catalogue row deletes user data."_ **Since that was written the cascade surface has grown.** `list_items` and `discovery_chart_entries` now also reference `albums`, so deleting catalogue rows would additionally destroy **list membership** — user-authored curation from Phase 4. **Nothing should be deleted on the strength of this entry.** Recorded prominently because the observation says "remove", and acting on that literally would be irreversible.

**4. "The first batch" is not identifiable today.** There is **no provenance column** on `albums` — only `created_at`, `popularity_score` and `hydration_status`. Separating seed from curated relies on proxies: `popularity_score is not null` (§8.9 measured the correlation exactly — all 335 seeded albums scored, all 27 self-service null) or `created_at` before the tranche. **Those are proxies, not provenance**, and either would misclassify a curated album that happens to carry a score.

**5. The identity statement is new input on something §8.9 deliberately left open.** §8.9 settled breadth, depth and popularity but explicitly did **not** settle _the list itself_, and stated that the hand-added albums are _"evidence, not a specification"_ from which _"no editorial policy has been inferred"_. **This is the first time an editorial direction has been stated.** It is recorded here as stated direction and becomes policy only through triage and STEP B, in `product-spec.md`.

**6. Two very different fixes are on the table, and the observation permits either.** **Demoting** is a Browse-composition change touching no data. **Removing** is a catalogue operation touching user data and a decided boundary. They should not be triaged as one thing.

**7. One question this raises that no document answers.** §8.9 decided that **membership never depends on popularity**, and that absence of an external signal must never be read as low merit. The converse is unaddressed: **does a high external score justify prominence?** Browse currently behaves as though it does — that is what the fill ordering asserts — and whether that is intended is not recorded anywhere.

**Related:** F-005 (no way to browse the whole catalogue) is the other Browse-composition entry; F-021 raises network-scoped popularity, which would change what the lead section even means.

### F-025 — the local verification gate is bounded by this machine's memory, not by the tests

**2026-09-07 · development process · CLOSED — RESOLVED 2026-09-15**

**The gate moved.** Work now happens on a branch and reaches `main` only through a green CI run; STEP F runs `npm run verify` plus targeted suites. **`CLAUDE.md` was amended on 2026-09-15** — _Where the full gate runs_ — and the decision is `architecture.md` §12.

**What resolved it was measurement this entry did not yet have.** Across eight cycles on 2026-09-13 the local end-to-end suite failed **9, 5, 2, 9, 7, 14, 19 and 6** times on eight different trees. **Every failing set passed on isolated rerun. CI was green on all eight. Not one was a real defect.** Host load rose 6.15 → 12.51 and runtime 10.5m → 25.3m. On one identical tree: **25.3 minutes locally against 11.2 on CI, with CI absorbing nothing.**

**This entry's own constraint is what selected the answer.** It ruled out every remedy depending on the host being idle, which left moving the suite off the machine. **It also identified the unused mechanism correctly**: `ci.yml` already triggered on `pull_request`, and _"branch protection is not required in order to use a branch"_ was the step `CLAUDE.md` had skipped.

**Not resolved by this, and still open:** `architecture.md` §12's `[OPEN]` production-build question; whether the local Supabase stack needs all nine containers for the test path.

`verify:full` takes up to **45 minutes** locally, against roughly **14 minutes** for the same suite on CI. The wait is worst when tests fail, because a failure costs its full 30-second timeout while a pass costs a couple of seconds — so the slowest runs are the least useful ones.

**The measured cause is memory exhaustion on this machine, not test design.** Measured 2026-09-07 during a run: **8 GB total RAM, 0.015 GB free, and 14.3 GB of 15.4 GB swap consumed (93%)**, with 451M pageins. Docker was holding **nine Supabase containers totalling ~1.3 GB**, alongside a Next dev server, Chromium, the editor and a browser. Under that pressure the machine is paging rather than computing.

**This plausibly explains the flake cluster in `current-state.md` §8**, including the finding recorded there as inexplicable — that **baseline duration does not predict failure**, with a 1.8s test exceeding 30s in the same run where a 12.9s test passed. Under thrashing, what fails is not the slow test but whichever process was paged out when it needed to run. It would also account for `net::ERR_ABORTED` and browser-process death, which the timeout explanation never covered. **This is a hypothesis consistent with the evidence, not an established cause.**

**Why CI is faster, established from `.github/workflows/ci.yml`.** CI splits into **two jobs with no `needs:` between them**, so they run in parallel on two separate clean runners — one doing format, lint, typecheck, unit and build; the other doing Supabase, integration and end-to-end. Locally all of it runs serially on one exhausted machine.

**CI is not failure-free, and believing it is has been a live misunderstanding.** `playwright.config.ts` sets `retries: 2` on CI against `0` locally, so CI absorbs the very flakes a local run exposes. `current-state.md` §8 already records **two CI runs that consumed both retries and reported `1 flaky`**, described there as _"one attempt short of red."_

**The capability to move the gate already exists and is unused.** `ci.yml` triggers on `push` to `main` **and on `pull_request`**. Work currently goes straight to `main`, which is why local `verify:full` is treated as the safety net — `CLAUDE.md` says so explicitly, on the grounds that there is no branch protection. **Branch protection is not required in order to use a branch.** A cycle pushed to a branch would run the full suite on CI's clean parallel runners with `main` untouched until green.

**Context, not a resolution.**

- This would change **STEP H, I and J**, not just a habit. STEP I currently means "push to `main`, and pushing is deploying"; under a branch model the deploy and the verification gate separate, and the migration-before-push rule needs re-examining against that.
- It interacts with an existing `[OPEN]` item rather than replacing it: `architecture.md` §12 carries **whether the end-to-end gate should run the production build**, with a measured 41% direction and a 2.8× swap-growth difference, explicitly unresolved on magnitude. If the suite moves to a machine with adequate memory, the performance half of that question may become moot while the **correctness** half — that Vercel serves an artifact the local gate never exercises — does not.
- `architecture.md` §12 also records a **`[DEFERRED]` `verify:full` policy question**. This entry is adjacent to it and should be triaged alongside rather than separately.
- **Whether targeted local tests plus a CI gate is acceptable is a process decision, not an optimisation.** Running a subset locally is already what STEP F does first; what would change is whether the full suite must pass _locally_ before push. Note that on 2026-09-06 what established a red run as safe was running **everything** and proving the changed code could not execute in the failing tests — a subset could not have shown that.
- **Nothing here is a defect in the tests.** No test is slow because it is badly written, and the two fixture conversions already made (`architecture.md` §12) saved ~12s and were **not detectable at suite level**. Further micro-optimisation is not the lever.

**The constraint this must be solved within, stated by the maintainer 2026-09-07.** This is the machine used for other work, and **verification is expected to run in the background while it is used normally.** Freeing memory by quitting applications is acceptable as a one-off diagnostic and is **explicitly rejected as a solution** — a gate that requires the developer to stop using their computer has moved the cost rather than removed it. **The requirement is therefore that verification must not compete with the working machine**, which rules out every option whose benefit depends on the host being otherwise idle.

**That reframes the candidates rather than ranking them.** Moving the suite off this machine satisfies the constraint directly. Making the suite cheaper on this machine — the production server, further fixture work, worker counts — does not, because it still consumes the host it is trying to share.

**One reduction is compatible with the constraint and is not a workaround.** The local Supabase stack runs **nine containers**, of which `supabase_studio` (~270 MB) and `supabase_inbucket` (~34 MB) serve no test purpose — Studio is the web UI, Inbucket is local mail capture. `supabase/config.toml` is already deliberately trimmed for this exact reason (`current-state.md` §10). Whether the test path needs the full stack is unexamined.

**Not addressed:** whether `workers: 1` and `fullyParallel: false` should ever change — deliberate for shared database state and readable failures, and unavailable on this host regardless; whether a paid CI accelerator or a larger hosted runner is warranted; and whether a cloud development environment is a better fit than a branch-and-CI model, which is a different answer to the same constraint.

### F-026 — a discography expansion that fails its first attempt is not retried until the next day

**2026-09-07 · artist page, catalogue, ingestion · CLOSED — FIXED 2026-09-12**

**Outcome: fixed, and the diagnosis in this entry was right on both counts.** `f34c0b4` (CI #97) makes an artist page drain on **every** view rather than only the first, so refreshing moves an outstanding expansion along — and it unsticks jobs stranded in `running`, since the stale reclaim only fires when a drain starts. **The amended starvation reading and the original retry reading were both real**; the retry half became F-034. **Destination:** `architecture.md` §7 _A later view drains too_, `cycle-log.md` §61. **Still not guaranteed:** the claim has no target filter, so a refresh serves the oldest waiting job rather than this artist's.

Opened Kate Bush on the deployed site after the on-demand depth cycle shipped. The page said the discography was being fetched, and several minutes later it still held two albums. **Nothing was wrong with the page and nothing was wrong with the request — the retry simply has nothing to run it.**

**Observed on the deployed database, not inferred.** The job exists: `discover_curated_artist` for `4b585938-…`, created 09:13:12, `attempts: 1`, back to `pending` with `run_after` 09:14:06, and `last_error` recording _"MusicBrainz returned 503 for /release-group — server busy (edge load shedding, not our rate) [zone=global remaining=14/15]"_. So the first attempt was made and MusicBrainz shed it; our own rate limit was nowhere near. The queue held **one pending job with nothing ahead of it**.

**The gap is that nothing drains it.** `src/app/artists/[mbid]/page.tsx` enqueues **and** drains only when the state is `start` — no attempt ever made. On every later view the state is `outstanding`, so the page does nothing at all. **Refreshing the artist page can never help.** The only other drain is the cron at `0 4 * * *`, which Vercel's Hobby plan caps at once per day.

**Context, not a resolution.**

- **The job-level backoff implies retries that nothing performs.** `BACKOFF_SECONDS = [30, 300, 1800]` in `jobs.ts` schedules a retry 30 seconds out, then 5 minutes, then 30 minutes, against `max_attempts` of 3. Those windows are meaningless when the only thing that claims work is a daily cron or another artist's _first_ view.
- **A first attempt is a single shot at a busy upstream.** The 503 seen here was explicitly MusicBrainz's own load shedding, which is transient and common — so the case that fails is not exotic.
- **It is invisible.** See F-027; the page reports the same thing whether the job is running, backing off for 30 seconds, or parked until tomorrow.
- **Candidate mechanisms, none of them decided here:** letting an `outstanding` view drain as well as a `start` view; draining more than one job per view; or a more frequent schedule, which the Hobby plan's once-per-day cap constrains (`current-state.md` §8).
- **Related:** F-007 proposed exactly the feature that shipped; this is a defect in it, not a reconsideration of it.

**[AMENDED 2026-09-07, after three more artists were opened.] The mechanism above is right and was not the dominant cause. Starvation is.**

- **The Kate Bush job succeeded on its retry** — `attempts=2`, `succeeded`, **2 albums to 10**. What ran it was the maintainer's _next_ artist clicks: each first view drains one job, the claim orders `priority asc, id asc`, and hers was the oldest pending. So the daily-cron worst case is real but **self-heals while new artists keep being opened**.
- **Two further artists showed nothing after a minute and had `attempts=0` — never tried once.** Marine Girls (`#1329`) and Poly Styrene (`#1342`) were queued behind a backlog, not failing. **A job that has never been attempted and a job that failed and is waiting look identical from the page**, which is F-027.
- **The backlog is generated by success, and that is F-030.** Kate Bush's expansion created 8 albums, each enqueueing a `fetch_artwork` job at the same priority with a lower id than the next artist's discovery job.
- **What this entry should be read as covering** is the retry path specifically. The throughput problem underneath it is filed separately.

**[CONFIRMED IN USE 2026-09-07, after the priority-band fix shipped in `2be9b3c`.] The starvation mechanism is exactly as amended above, and it is not the retry path.**

Radiohead was opened and sat on _"Fetching the rest of this discography from MusicBrainz. Look again in a moment."_ for several minutes. Opening a few more artists then **visibly hydrated the earlier ones one by one** — each new first view draining one job, oldest pending first.

- **This is the queue working as designed, and the design is the complaint.** The claim is `priority asc, id asc`, so a discovery job queued today sits behind every discovery job queued before it. **Radiohead's own first view almost certainly ran somebody else's job**, and every later Radiohead view did nothing at all, because the page enqueues and drains only on the `start` state.
- **The bulk artwork band did not address this and was never meant to.** It stopped `fetch_artwork` outranking `discover_curated_artist`; it changed nothing about one drain per first view, or about later views draining none.
- **One mechanism was raised during diagnosis and is _not_ ruled out.** Neither `src/app/artists/[mbid]/page.tsx` nor `src/app/albums/[mbid]/page.tsx` sets `maxDuration`, so the `after()` drain runs under the platform default — an existing `[OPEN]` in `architecture.md` §7, recorded there as _"its worker ceiling is unknown to the repository"_. A Radiohead browse pages at 100 release groups per request through the one-per-second limiter and then inserts every in-scope album sequentially. **If that exceeds the ceiling the job is killed mid-run and left `running`, recovered only by the 90-minute stale reclaim.** Whether this happened here was **not** established — the observation is consistent with plain starvation alone.
- **The states remain indistinguishable from the page**, which is F-027, and this is a clean example of it: "never attempted", "backing off" and "killed mid-run" all render the same sentence.

### F-027 — the artist page cannot distinguish "fetching" from "stuck until tomorrow"

**2026-09-07 · artist page, UX · CLOSED — DELIVERED 2026-09-13**

**Outcome: three renderings from four states**, shipped in `dbb7865` (CI #103). A terminally failed expansion now says _"Couldn't finish fetching this discography from MusicBrainz. It will be retried."_ rather than **rendering nothing at all** — which `product-spec.md` §6 records as a lie by omission, since a truncated discography presented itself as complete.

**This entry's stated dependency was correct and was discharged in order.** It said the decision _"may depend on F-026"_ — and it did. F-026 shipped in `f34c0b4`, making _"look again in a moment"_ true and actionable; **the recovery sweep in `c5e5c85` then added a fourth state this entry never anticipated**, a sweep-re-queued expansion.

**Destination:** `product-spec.md` §6, `architecture.md` §7, `cycle-log.md` §67. **`last_error` is deliberately never shown to a reader** and lives on the operator queue view instead.

The status line on an artist page reads _"Fetching the rest of this discography from MusicBrainz. Look again in a moment."_ It says that identically whether the work is running now, has failed once and is backing off, or has failed and is waiting up to 24 hours for the daily cron. **"In a moment" was not true in the observed case and there was no way to tell.**

**Context, not a resolution.**

- **The line is truthful about the fact and wrong about the timing.** An expansion genuinely is outstanding in all three states — the sentence's error is the implied horizon, not the claim.
- **The distinguishing information exists and is not surfaced.** `ingestion_jobs` carries `attempts`, `run_after` and `last_error`; the page reads only whether a row exists and whether it is `pending`/`running`.
- **It was recorded as a known limitation of a different kind, and this is sharper.** `cycle-log.md` §59 notes the line can momentarily claim work a swallowed enqueue never made — a one-render window. This is the opposite: work that really is queued, and stays queued far longer than the copy suggests.
- **`product-spec.md` §6 deliberately left the treatment provisional**, recording the line as _"the honest minimum, not a settled treatment"_ and worth revisiting once real use had been observed. **This is that observation.**
- **Deciding this may depend on F-026.** If a failed attempt retried within minutes, the current copy would be roughly accurate and nothing else would be needed.

### F-028 — the MusicBrainz rate limiter does not span serverless invocations

**2026-09-07 · ingestion, infrastructure · CLOSED — DELIVERED 2026-10-02 (§107, PR #43)**

> **The framing in this entry is what kept it open, and `architecture.md` §7.3a says so.** It assumed the fix was shared-state rate limiting and called that _"materially larger"_. **Constraining the drainer rather than the request is much smaller** and makes the existing in-process limiter authoritative, because there is then only one process. A lease row with an expiry, not an advisory lock — Supabase's pooler makes session-level locks unreliable.
> **Also corrected: this is routine rather than theoretical.** `drainJobs` has **four** call sites, two inside `after()` on album and artist pages, against twelve cron runs a day. That no failure had been observed was luck.

`musicbrainz.ts:84` creates the limiter as a **module-level** object, so it serialises requests within one Node process. On Vercel, concurrent requests run in **separate lambda instances, each with its own limiter** — so simultaneous page views can collectively exceed one request per second to MusicBrainz.

**Context, not a resolution.**

- **The consequence of exceeding it is severe and already documented.** `CLAUDE.md` holds that MusicBrainz returns `503` for **every** request from the address once the limit is passed, not merely the excess — so a burst degrades all ingestion, not just the burst.
- **This is pre-existing, and on-demand artist depth widens the exposure.** The album page has always enqueued and drained inside `after()`; artist pages are more numerous and are browsed in sequence, so more surfaces now initiate upstream work.
- **It has not been observed causing a failure.** The one 503 seen so far reported `zone=global` and `remaining=14/15` — MusicBrainz's own load shedding, not our rate. **The client already distinguishes the two**, which is what makes this diagnosable at all.
- **A serialising limiter across invocations needs shared state**, which is a materially larger change than anything in this area so far. Nothing here proposes one.
- **Related:** F-026, which is about the same drain path from the opposite direction — too little work being done rather than too much at once.

### F-029 — an expanded discography is never refreshed, so new releases never appear

**2026-09-07 · artist page, catalogue · CLOSED — DELIVERED 2026-09-17**

**Shipped** (`44b03ac`, PR #21, CI #136). A discography is re-checked when its last **successful** expansion is over thirty days old. **Only a success goes stale** — a failed artist stays the sweep's job, which is what stops a page view restarting the retry policy. `cycle-log.md` §86.

**A discography refreshes on view when it is stale.** Work follows attention. It repairs terminally failed artists as a side effect. **One hazard goes to its cycle and is written into the decision**: the once-per-artist rule exists to stop a page view restarting the retry policy, and a staleness window must not become that loop under another name — a refresh is scheduled against a **successful** expansion, a retry answers failure. Destination: `product-spec.md` §8.9.

Once an artist's discography has been expanded, it is never expanded again. A new album released afterwards, or an older release MusicBrainz gains later, will not appear on that artist's page — ever.

**Context, not a resolution. This is a recorded deferral rather than an oversight, and the observation is what makes it concrete.**

- **`product-spec.md` §8.9 decided it explicitly:** expansion is attempted _"once per artist"_ with _"no staleness rule and no revisit"_. That was the right scope for the slice; what it did not have was a real example of the cost.
- **The queue was built to allow re-sync.** The partial unique index covers only `pending` and `running` **specifically so completed jobs do not block requeueing** — its own comment says _"a re-sync, say"_. The mechanism is anticipated; the policy is not decided.
- **It interacts with the ratified attempt guarantee.** `product-spec.md` §8.9 `[RATIFIED 2026-09-07]` records the rule as _"once per artist for as long as its job record survives"_, resting on nothing deleting job rows. **A re-sync policy is the deliberate version of the thing that guarantee treats as an accident.**
- **It also interacts with terminal failure.** An artist whose single attempt exhausted its retries is permanently unexpanded (`cycle-log.md` §59), and a refresh policy would repair that as a side effect.
- **Undecided and not to be inferred:** what triggers a refresh — elapsed time, a view, an external signal — and whether it applies to every artist or only some. Catalogue **depth** and **completion** are separate questions already open in `product-spec.md` §10.7, and this is neither.

### F-030 — each successful expansion queues more work than a page view can drain

**2026-09-07 · catalogue, ingestion, performance · CLOSED — BACKLOG CLEARED, MEASURED 2026-10-02 (§116)**

> **Measured on production on 2026-10-02 through the public REST API** — the same read the site performs on every page load. **`artwork_status`: pending 0 · found 990 · absent 85 · failed 0, of 1,075 albums.**
> **This entry is about work queueing faster than a page view can drain it. There is nothing queued.** `pending` is **0** and `failed` is **0** — not falling, finished. The entry's own trajectory was 289 albums without a cover on 13 September to 161 on 15 September; seventeen days later the queue is empty.
> **The 85 `absent` are not a backlog.** They are albums Cover Art Archive has no cover for — a fact about the world rather than work outstanding, and `architecture.md` §7 records that there is no fallback source. They are the population the cover-art prompt (F-014) exists to serve.
> **Closed on evidence rather than on age.** The throughput work this entry asked for would now relieve nothing.

**[MEASURED 2026-09-15.] The backlog has turned and is falling without further work.** Albums without a cover: **289 on 13 September → 161 on 15 September**, with **145 covers fetched in two days** and outstanding artwork jobs down from 290 to 162. Nothing is stuck in `running`.

**What turned it was cadence, not per-job cost.** The twelve-a-day schedule (`3647c37`) began clearing artwork only once metadata work was exhausted — exactly as predicted on the 13th, when three drain windows fetched **zero** covers because discovery and hydration correctly preceded them. **The three-day clearance figure quoted on the 13th was wrong for that reason and is not restated.**

**Still open:** whether cadence is sufficient at a larger catalogue, and `architecture.md` §7's `[OPEN]` note that per-job cost is necessary and nowhere near sufficient.

**The contention half is fixed.** `2be9b3c` (CI #96) put bulk artwork in its own band below metered work, so covers can no longer outrank the discovery jobs that create them. Verified in production: four expansions succeeded while 54 artwork jobs waited.
**The throughput half is not.** `f68e050` (CI #98) cut per-job cost ~30% by dropping an unserved size — about six covers a night, against 211 albums without one and a backlog that grew 54 → 174 → 207 in six days. **Cadence, capped at once a day by the hosting plan, is the binding ceiling and is recorded `[OPEN]`** in `architecture.md` §7. **Destination:** `architecture.md` §7 _Queue fairness_ and _Store only the sizes that are served_, `cycle-log.md` §60 and §62.

**The queue grows faster than it is drained, and it is successful expansions that grow it.** Measured on the deployed database after three artist pages were opened: **20 pending jobs — 18 `fetch_artwork` and 2 `discover_curated_artist`** — with the two discovery jobs at `attempts=0`, sitting behind six artwork jobs.

**The arithmetic, per successful expansion.** An artist page view drains **one** job. Kate Bush's expansion created **8** albums, and every created album enqueues a `fetch_artwork` job (`curated-tranche.ts:294`) at `DEFAULT_JOB_PRIORITY` with an id **lower** than the next artist's discovery job. So one expansion consumes one drain and produces roughly eight jobs that outrank everything queued after it. **The backlog diverges rather than clearing.**

**Context, not a resolution.**

- **The observable symptom is two-sided.** Later artists never populate — they are starved, not failing (F-026) — and newly created albums show placeholder covers, because 18 albums sit at `artwork_status: 'pending'` behind the same queue.
- **Priority already works where it is used.** An album opened directly hydrated in seconds, because album hydration enqueues at `INTERACTIVE_JOB_PRIORITY` (10) and jumps the whole priority-100 backlog. **The mechanism exists; artwork and discovery simply share one bucket.**
- **Unmetered work is consuming metered budget.** `architecture.md` records that **Cover Art Archive imposes no rate limit**, so artwork fetching "does not compete with metadata for the same budget" — yet in the drain it does, occupying the same one-job-per-view slot as rate-limited MusicBrainz work and outranking it by id.
- **Candidate directions, none of them decided here:** draining more than one job per view; separating artwork onto its own priority band or its own drain; ordering discovery ahead of artwork; or a schedule more frequent than the daily cron, which the Hobby plan caps (`current-state.md` §8).
- **Whether the drain belongs on a page view at all is the larger question.** It was adopted because the cron is daily and "a later view" would otherwise mean tomorrow; that reasoning holds, and it is not the same as this being the right long-term shape.
- **The cron drain has the same one-number-for-two-kinds problem, and its own source already says so.** `DEFAULT_BATCH_SIZE = 10` in `src/app/api/cron/drain-jobs/route.ts`, whose comment reads that the batch is sized for _"a rate-limited job at about a second each. That is right for `fetch_tracklist` and wrong for `fetch_artwork`, which does not touch the MusicBrainz limiter."_ **Raising that single number is not the fix**: MusicBrainz jobs cost roughly a second each against Vercel's 60-second function ceiling, so ~10 is genuinely near the limit for that kind, and a larger global batch would overrun the invocation — which is the stranding failure mode `current-state.md` §8 already records, where a killed drain abandons the rest of its claimed batch. **A per-kind batch size is what the comment implies and it is not decided**, neither the shape nor the numbers. For scale: artwork touches no limiter and Cover Art Archive imposes none, and an out-of-band run historically cleared **~300 artwork jobs in 52.9 minutes**. **Batch size and cadence are separate ceilings** — per-kind batching changes what one run can do and nothing about the run happening once a day.
- **Related:** F-026 (the retry path), F-027 (the states are indistinguishable), F-028 (limiter scope), and `cycle-log.md` §59.

### F-031 — an artwork job spends ten seconds on six serial round trips, and nothing forces them to be serial

**2026-09-07 · artwork, ingestion, performance · CLOSED — THE BACKLOG IT WOULD RELIEVE NO LONGER EXISTS (§116)**

> **Measured on production on 2026-10-02 through the public REST API** — the same read the site performs on every page load. **`artwork_status`: pending 0 · found 990 · absent 85 · failed 0, of 1,075 albums.**
> **This entry proposes parallelising six serial round trips inside an artwork job.** The case for it was always the backlog, and **the backlog is gone**: `pending` 0, `failed` 0.
> **The optimisation is still correct and is no longer worth doing.** Nothing forces those requests to be serial, and if a future bulk load creates a backlog again this is the entry to reopen — **F-039 database dumps is the realistic trigger**, and F-059 records the two limits standing in front of it.
> **Closing an idea that is right but unneeded is the point of this file having a triage step.**

**[MEASURED 2026-09-15.] The case for building this has weakened, not strengthened.** The backlog this entry was meant to relieve is **clearing on its own** — 289 → 161 in two days — because cadence did the work per-job cost was being asked to do. **Optimising a queue that is currently draining would be tuning against a moving number.**

**The mechanism remains available and correct**: with two sizes there are still two independent fetches and two independent uploads. **It is the right lever if throughput is ever the binding constraint again** — at a much larger catalogue, or if cadence is capped further.

**The diagnosis held; the premise underneath it was never checked by this entry or by the cycle that read it.** One of the three sizes was never served, and dropping it in `f68e050` was a cheaper fix than parallelising — three round trips instead of six. **But the parallel-fetch mechanism this entry proposes is not superseded**: two sizes still means two independent fetches and two independent uploads, so it remains the next per-job lever. **It is also not sufficient** — `architecture.md` §7 records per-job cost as necessary and nowhere near enough against a once-a-day cadence.

Raised by the maintainer asking the obvious question: if Cover Art Archive has no rate limit, why do covers arrive at roughly four a night?

**Because it is not a rate limit. Three separate ceilings multiply out to that number.** The cron runs **once a day** (Hobby-plan cap). Each invocation gets **45 seconds** — `DRAIN_BUDGET_MS`, derived from a 60-second `maxDuration` with 15 seconds of headroom, checked before each claim. And an artwork job takes **about 9–10.6 seconds**, measured twice: ~9s on staging (recorded in the cron route's own comment) and 300 jobs in 52.9 minutes out of band. 45 ÷ 10 ≈ 4.

**Where the ten seconds goes.** `fetchAndStoreArtwork` loops `ARTWORK_SIZES = [250, 500, 1200]` and **awaits each size in turn** (`artwork.ts:133`). Per size it fetches from Cover Art Archive — which `307`-redirects to archive.org, so two round trips — then uploads separately to Supabase Storage. **Roughly six sequential network round trips per album, one of them a 1200px file.**

**The observation worth keeping: the serialism is unforced.** The MusicBrainz loop is serial because it must be — one request per second per IP, enforced by a shared limiter, a `CLAUDE.md` non-negotiable. **Artwork inherited that shape without inheriting the reason.** CAA imposes no rate limit, and the three sizes are independent files written to three independent paths.

**Context, not a resolution.**

- **Unmeasured and unverified.** That concurrency would cut a job to roughly the cost of its slowest size is a plausible reading of the code, not a benchmark. Supabase Storage's own behaviour under three concurrent uploads is unexamined, and the 1200px fetch may dominate regardless.
- **It is a cheaper lever than the one already deferred.** `architecture.md` §7 defers kind-aware claiming and per-kind batch sizes, which need a change to `claim_ingestion_jobs`. This needs no migration, no schema change and no plan change.
- **It was missed because everyone was reasoning about the queue.** F-026, F-030 and the cycle that closed them all asked how jobs are ordered. **Nobody asked what one job spends its ten seconds doing.**
- **Batch size, cadence and per-job duration are three different ceilings.** Fixing this one changes what a 45-second invocation can do and nothing about the invocation happening once a day.

### F-032 — `verify:full` can pass without ever parsing a cycle's migration

**2026-09-07 · development process, testing · CLOSED — THE SURVIVING HALF IS ADDRESSED 2026-10-02 (§112)**

> **The half CI cannot help with now has a check.** `npm run db:drift` compares the **deployed** schema against the migrations — `architecture.md` §12.5 — where CI only ever proves a fresh database and `db:pending` only compares the ledger. **First run found no real drift across 44 migrations**, and found one privilege the project never granted (**F-060**).
> **The other half is accepted rather than fixed**: `verify:full` still does not reset the database, so a local run can pass without the migration being parsed. That is a **less-travelled path** — `CLAUDE.md` says `verify:full` is not to be run at all without being asked — and the cost of resetting it for everyone exceeds the exposure. Stated so it is not mistaken for an oversight.

**The risk this names has moved rather than gone.** The gate change means a migration is now applied at **STEP J, after CI has passed the exact tree** — so CI _does_ parse it before it reaches the deployed database, which is the opposite of the old order.

**What survives is the half CI cannot help with**: CI applies migrations to a **fresh** database, so a migration that parses and applies cleanly there still proves nothing about the **deployed** schema. `CLAUDE.md` retains that warning verbatim.

**And `verify:full` still never resets the database**, so a cycle that chooses to run it locally can still pass without the migration being parsed. **That is now a smaller exposure on a less-travelled path**, which is why this is downgraded rather than closed.

Found during the queue-fairness cycle, and hand-closed there. **`npm run verify:full` does not reset the database.** It runs the integration suite against whatever schema the local database already has, then seeds fixtures, then Playwright. **A migration added during the cycle is therefore never applied and never parsed** — the suite that "verified" the change ran against a schema without it.

**A syntax error would have reached CI after the push**, since CI applies migrations to a fresh database and `git push` is a deploy. The migration-before-push rule and its `pre-push` hook both check that migrations are **deployed**; neither checks that they **work**.

**Closed by hand this time** — `npm run db:reset`, `npm run db:types`, then re-running the affected suites. **Nothing prevents a recurrence.**

**Context, not a resolution.**

- **The gap is narrow but the consequence is the documented expensive one.** `CLAUDE.md` records that pushing before a migration is applied has taken every profile page down once. This is the adjacent failure: applying a migration that does not parse.
- **`db:reset` is deliberately not in `verify:full`**, and that is not obviously wrong — it costs minutes, and most cycles carry no migration. Whether the check should be conditional, a separate gate, or part of STEP I rather than STEP F is undecided.
- **It interacts with F-025.** Any addition to `verify:full` lands on a gate the maintainer has already said takes 45 minutes and must not compete with the working machine.
- **Adjacent, and not the same:** `db:types` drift is already covered by convention (`db:reset` then `db:types`, never hand-edit). What is uncovered is that nothing makes anyone run it.

### F-033 — a page view's background drain sometimes does not run at all, and leaves no trace

**2026-09-07 · ingestion, infrastructure · TRIAGED — STILL OPEN, AND THE RECOVERY PATH IS NOW OBSERVED**

> **Narrowed again on 2026-10-02, and still not closed.** A drain now records why it stopped and how much it claimed, and a drain that could not take the lease is counted — all three visible on `/debug/queue`. `architecture.md` §7.3c. **The unexplained observation in this entry still has no mechanism**; what changed is that the next occurrence leaves a record, which is the precondition for explaining it. **§107's lease also added a legitimate reason for a drain to do nothing**, which would otherwise have made this entry harder to reason about rather than easier. — _measured 2026-09-07, filed 2026-09-12, corrected 2026-09-12, evidence added 2026-09-15_

**[2026-09-15.] A lost attempt was observed and recovered, which narrows this without closing it.** Radiohead's sweep-queued job `#1630` sat `running` for 69 minutes on 13 September and completed as `succeeded` with **`attempts = 2`** — **the second attempt is the 90-minute stale reclaim doing its job.** So a job was plausibly killed mid-run and the recovery path caught it.

**That is evidence for the mechanism F-026 raised and could not establish** — neither route sets `maxDuration`, so an `after()` drain runs under the platform default. **It remains unconfirmed**: nothing distinguishes "killed by a ceiling" from "lost for another reason", and a single instance establishes neither.

**Deliberately not closed.** The observation was weakened by its own correction below — the drain was delayed rather than absent — and a lock race under `for update skip locked` fits as well as a failed callback. **It stays open because the mechanism F-026's fix depends on is the same one**, so deployed reliability remains unestablished.

**One unexplained observation, recorded because it has no mechanism and because the fix for F-026 depends on the same machinery.**

Measured on the deployed database at 14:04 UTC. A new artist page was opened at **14:00:02**, creating discovery job `#1418`. That view should also have drained one job, and the job first in line was **`#1350` (Radiohead)** — `pending`, ready since `13:42:16`, and the lowest id among claimable rows. **It was untouched: still `attempts = 2`.**

**What rules the obvious explanations out.**

- **It was not claimed and abandoned.** `claim_ingestion_jobs` increments `attempts` before the work runs, so a claim followed by a crash would read `attempts = 3`. It read 2.
- **It was not stranded.** **Zero rows in `running`** across the whole table, and **zero terminally failed expansions**. The 90-minute stale-reclaim path was not involved.
- **It was not outranked.** 54 pending `fetch_artwork` rows all sat at priority 200 against `#1350` at 100, and four expansions had succeeded earlier the same hour while that artwork backlog existed — so ordering was working.
- **It was not out of backoff range.** `run_after` was 18 minutes in the past.

**So the most likely reading is that the `after()` callback did not execute, or threw before reaching the claim.** Both are invisible: the artist page swallows failures in that block by design, because the reader never asked for the work.

**Context, not a resolution.**

- **This is a single observation and no mechanism is established.** It is filed so it is not lost, not because it is understood.
- **It bears directly on F-026's fix.** Draining on later views relies on exactly this callback. If the callback is sometimes skipped, the fix is **strictly better than never draining and still not a guarantee** — which is worth knowing before its effect is judged in use.
- **It is a different failure from the two already recorded.** Not starvation (nothing outranked it) and not a killed mid-run job (nothing in `running`).
- **It is unobservable by design, which is the sharper problem.** A swallowed callback failure writes no row, no error and no log the product surfaces. Whether that block should record _something_ is undecided — `architecture.md` §17 names work that stops silently as a failure class the project already worries about.
- **Deliberately not investigated here:** whether Vercel executes `after()` reliably on this plan, whether the route's absent `maxDuration` interacts with it, and whether the enqueue succeeded while the drain did not — `#1418` exists, which means the callback ran at least as far as the enqueue. **That last detail argues against "the callback never ran" and for "it failed between the enqueue and the claim", and no cause for that is known.**

**[CORRECTED 2026-09-12 — the drain was delayed, not absent. This entry was overstated.]** Re-queried on 2026-09-12: job `#1350` reached `attempts = 3` at **14:07:16**, three minutes after the 14:04 snapshot above. **So something did claim it, just not the 14:00 view.** The finding is therefore "one view's drain did not claim the job first in line, and a later one did" — weaker than what this entry originally implied, and consistent with a lock race under `for update skip locked` between concurrent invocations as easily as with a failed callback. **No mechanism is established and the observation is no longer strong enough to imply one.**

### F-034 — a transient upstream error permanently excludes an artist's discography

**2026-09-12 · artist page, catalogue, ingestion · CLOSED — VERIFIED ON REAL DATA 2026-09-15**

**Repaired, end to end, on the one artist that mattered.** Measured on the deployed database 2026-09-15: job `#1630` — **queued by `enqueueFailedExpansions`, claimed by a drain** — reads `succeeded`, `attempts = 2`, at 18:45 on 13 September. **Radiohead went from 3 albums to 35.**

**Every part of the chain is now observed rather than argued**: the sweep queued it, the 24-hour cooling-off did not suppress it, the twelve-a-day cadence gave it a drain, and the stale reclaim caught it when one attempt was lost — `attempts = 2` is that reclaim, visible in the data.

**The withdrawn approval stands withdrawn.** `cycle-log.md` §59's _"terminal failure permanently settles an artist, which is approved behaviour"_ remains marked `[APPROVAL WITHDRAWN]`.

**Addressed, and deliberately not closed yet.** `c5e5c85` adds `enqueueFailedExpansions` and has the daily cron call all three sweeps; a failed expansion becomes re-queueable 24 hours after its last failure. **An attempt cap was ruled out rather than unchosen — any cap reintroduces the permanent exclusion this entry got ruled a defect for.** **Not closed because:** CI #99 has not completed, and the effect is only observable after a deployed cron run, on exactly one artist. **Destination:** `architecture.md` §7 _Recovery sweeps_, `cycle-log.md` §63.

**Radiohead, measured on the deployed database 2026-09-12.** Discovery job `#1350`: `status = failed`, `attempts = 3` of 3, exhausted at 2026-09-07 14:07:16. **All three attempts failed with the same error** — `MusicBrainz returned 503 for /release-group — server busy (edge load shedding, not our rate)`. The artist holds **3 albums** and will hold 3 forever.

**`attemptStateFor` reads any row that is not `pending` or `running` as `settled`**, so a terminally failed expansion is indistinguishable from a successful one. The artist page therefore shows **no status line at all** — it presents a truncated discography as complete — and **nothing will ever retry it**, including the later-view drain built in the cycle that found this.

**The maintainer's ruling, 2026-09-12: this is a defect, not acceptable behaviour.** It was previously recorded as approved — `cycle-log.md` §59, _"Terminal failure permanently settles an artist, which is approved behaviour. Its only correction is deleting the job row."_ **That approval is withdrawn.**

**What makes it a defect rather than a consequence.** The failure was transient and upstream — MusicBrainz's own load shedding, with our own rate budget nowhere near exhausted (`remaining=13/15`). **Three attempts inside one 47-minute window against a busy upstream is not evidence that an artist has no discography**, yet the outcome is identical to that conclusion and is permanent. It also silently contradicts the completion-oriented depth principle in `CLAUDE.md` and `product-spec.md` §8.9.

**Context, not a resolution.**

- **The naive fix is unsafe and must not be taken by default.** Simply allowing a fresh attempt after failure makes every page view able to start a new three-attempt cycle. A page view is an unauthenticated trigger, so an artist that genuinely cannot be expanded would generate unbounded upstream work from crawler traffic. **Some bound is required; which bound is undecided.**
- **Candidate bounds, none decided:** a cooling-off period before a failed expansion becomes retryable; a cap on total attempts across all rows for one artist; distinguishing transient errors from permanent ones, which the MusicBrainz client already does well enough to log; or folding it into a general staleness policy.
- **It reopens a ratified decision.** `product-spec.md` §8.9 `[RATIFIED 2026-09-07]` records the guarantee as _"once per artist for as long as its job record survives"_, and the ratification rested partly on nothing deleting job rows. **A retry-after-failure rule is a deliberate exception to it**, and the wording will need revisiting rather than reinterpreting.
- **It overlaps F-029 without being the same thing.** F-029 asks when an already-expanded discography should be refreshed. This asks whether a _failed_ expansion may be re-attempted. A refresh policy would repair this as a side effect, which is an argument for deciding them together and not an argument that they are one item.
- **The immediate repair for Radiohead specifically is deleting job row `#1350`**, which returns `attemptStateFor` to `none`. That is a one-row production write and is the maintainer's to authorise; it repairs one artist and changes no policy.
- **How many artists are affected is unmeasured.** Six jobs are in `failed` state overall, of unknown kind. **The population of permanently-excluded artists has not been counted** and should be before a bound is chosen.

### F-035 — artist names should be clickable wherever they appear

**2026-09-13 · browse, search, lists · CLOSED — FULLY DELIVERED, CONFIRMED 2026-10-02**

> **Closed at STEP A on 2026-10-02 after checking the code rather than the status line.** All the surfaces this entry named now use `ArtistCredit`: search album results (`search/page.tsx`), the list detail page, the grids and the artist page. **The album page's plain `display_credit` fallback is correct rather than outstanding** — it renders only when an album has no credited artists, where there is nothing to link to.

**[Updated 2026-09-15.]** Artist credits are now links on **Home**, **Browse**, **ranked list rows** and the **artist page** (`8544330`, CI #110), and on **search's album results** in the cycle immediately after. The entry's own surface table **undercounted** — it omitted Home, and described Browse's captioned section as _Popular_, which `design-reference.md` §11.11 had changed to _Recently added_ on the day this was filed.

**The obstacle was one the entry did not name**: every affected surface wrapped its whole tile or row in an album link, and an `<a>` inside an `<a>` is invalid HTML — so the caption had to leave the anchor first. **Still excluded, and by structure rather than deferral:** the upstream MusicBrainz panel, whose candidates are not in the catalogue and have no artist rows to link to. Decisions in `product-spec.md` §6.

Artist names should link to the artist page. **Right now you have to open an album first, and then click the artist from there.**

**Context, not a resolution.**

**The observation is exact.** Artist credits render as **plain text** in four places — `AlbumGrid` captions, the search album results, the list detail page, and the album page's fallback — and the **only** two artist links in the product are on the album page and in search's separate _artists_ result section. From a grid, the credit is dead text.

**Three surfaces are affected, and two grids are deliberately not:**

| Surface             | State                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| **Browse**          | Affected — Popular is the captioned grid, so the credit is visible and inert                             |
| **Search** (albums) | Affected                                                                                                 |
| **List detail**     | Affected                                                                                                 |
| Artist page         | Not affected — `AlbumGrid` suppresses the credit when it equals the page's own artist                    |
| Collection grids    | Not affected — `design-reference.md` §11.9 gives the tile **no title and no credit** at all, by decision |

**The part that makes this less trivial than it looks: `display_credit` is a denormalised string, not a relation.** The linkable identity lives in `album_artists → artists`, which the album page already reads as `album_artists(position, artists(id, mbid, name))` — and it renders **one link per artist**, comma-separated, falling back to the flat credit string only when no artist rows exist. **`AlbumSummary`, the type every grid and search result uses, does not carry artists at all.**

So two things follow, neither decided here:

- **The grid and search queries would need the artist embed added**, which is a join on the most-visited page in the product — Browse alone renders 48 albums.
- **A credit covering several artists is one string in a caption and several links on the album page.** Whether a tile caption becomes multiple links, links only the primary artist, or does something else is a real design question, and `design-reference.md` §11.5 and §11.9 already govern how much a tile may carry. **Parsing the credit string is not an option** — it is a display string.

**⚠️ Overtaken by implementation, observed 2026-09-15 — two days after filing.** `ArtistCredit.tsx` now exists and renders a `/artists/<mbid>` link per credited artist, with `display_credit` as the fallback; `AlbumGrid` passes `album.artists` to it, and `ALBUM_SUMMARY_COLUMNS` now embeds `album_artists(position, artists(id, mbid, name))`. **So the two obstacles recorded above — that grid queries carried no artists, and that the multi-artist case was undecided — have both been resolved in code**, with the multi-link reading chosen. **Recorded as an observation; whether this entry is closed is triage's call, and each surface should be checked individually rather than assumed uniform.**

**Related:** F-003 asks for actions on a tile without leaving the page; both are about a grid tile doing more than being a link to one album, and §10.6's warning about how many controls a tile can carry before the record-shelf reading breaks applies to both.

### F-036 — a stopped Docker daemon is reported as a Playwright server-start timeout

**2026-09-15 · development process, testing · CLOSED — DELIVERED 2026-10-02 (§103, PR #39)**

> **Decision: `architecture.md` §12.2.** A preflight script checks `.env.local` and the Supabase endpoint before Playwright starts, and `playwright.config.ts` refuses to run when the WebSocket global is missing — the config being the one file both entry points load. **Promoted on fresh evidence**: the `npx playwright test` half cost this session time twice on 2026-10-02, after the agent had already read this entry.

**[Filed as `F-035` and renumbered 2026-09-15.]** The ID collided with the artist-links entry above, which was filed two days earlier and keeps `F-035`. No content changed.

Docker was not running, so the local Supabase stack was down. The end-to-end suite failed with **`Error: Timed out waiting 120000ms from config.webServer`**, which points at the Next dev server. **The dev server was fine** — it logged `✓ Ready in 349ms`.

**What actually happened** is that `playwright.config.ts` waits for `baseURL` to return a success status, `/` calls Supabase, and the call failed with `connect ECONNREFUSED 127.0.0.1:54321`. So the page returned **500**, the health check never passed, and the timeout was reported against the wrong thing.

**It cost several minutes to diagnose**, and the first two remedies attempted — killing stale servers and clearing port 3000 — were wrong because the message pointed there.

**Context, not a resolution.**

- **The misdirection is structural rather than a bad message.** Playwright cannot know why a URL is unhealthy; it can only report that it never became healthy. **Anything that makes `/` return non-2xx produces this same timeout** — a down database, a broken migration, a crashing layout.
- **`reuseExistingServer` is deliberately off** (`playwright.config.ts`), for a good recorded reason: an orphaned server from an interrupted run would otherwise be adopted silently and a run could exercise stale code. **That decision is not implicated and should not be reopened on the strength of this.**
- **Candidate directions, none decided:** a preflight check in the test command that pings Supabase and fails with its own message; a health endpoint that does not touch the database, used as the `webServer` URL; or simply documenting the signature. **The third is the cheapest and may be sufficient.**
- **It interacts with the gate change of 2026-09-15.** STEP F now runs targeted suites locally, so **this failure mode is hit more often, not less** — a full local run was rarer.
- **Not urgent:** a developer-experience defect with no product consequence.

### F-037 — Recently added should show one album per artist, and nothing without a cover

**2026-09-15 · browse · DELIVERED 2026-09-16 — BUT ONE HALF OF ITS RULE IS NOW CONTESTED**

**Shipped** (`5ae5270`, PR #14, CI #122). Both rules are live on Home and Browse. `cycle-log.md` §79.

**⚠️ F-049 is a reversal request against the collaboration half**, filed the same day with evidence the decision did not have in front of it: **one artist occupying four slots** because they are the first credit on only one of the four albums. **That defeats the visual-variety purpose the rule exists to serve**, and it is a STEP B question rather than a defect.

**The cover half raised a consequence the decision did accept knowingly**: artwork arrives through a queue, so a newly ingested album is `pending` and hidden until its job drains — **a section about recency excluding the most recent albums.**

**⚠️ Partly reversed the same day — see F-049.** The multi-artist half of this decision (a collaboration counting against its first credited artist only) has a reversal request against it, with evidence. **The rest of the decision is unaffected.**

**Both rules approved.** One album per artist, and no album without a cover. **The entry's own flagged conflict was put to the maintainer rather than inferred**: hiding uncovered albums removes the most visible route to the cover-art prompt decided the same day. **Hiding won** — the prompt stays reachable from search, artist pages and lists.

**The tension this entry raised is accepted with its cost stated**, not dismissed: uncovered albums skew to remixes, demos and live records, so the rule hides exactly that material and hides more of it as depth grows. **Two questions go to its cycle**: which artist a collaboration dedupes on, and that deduplicating after a limit under-fills the section. Destination: `product-spec.md` §6.

Two rules for the **Recently added** section on Browse:

- **One album per artist.**
- **No album without a cover image.**

**Context, not a resolution.**

**Both are absent today, and the query is as plain as it gets.** `getRecentAlbums` is `order by created_at desc limit 24` — no artist grouping, no artwork condition. So a tranche that ingests eight albums by one artist fills a third of the section with that artist.

**Both rules are presentation-only.** Unlike F-024's other half, neither deletes anything or touches the catalogue — they change what one section selects. That is worth stating because the two entries share a motivation.

**One album per artist is now cheap, and was not always.** `ALBUM_SUMMARY_COLUMNS` already embeds `album_artists(position, artists(id, mbid, name))`, so artist identity is in the payload — no extra join needed. Two details are unspecified: **which artist a multi-artist album dedupes on** (position 1, or every credited artist), and that **deduping after a `limit 24` under-fills the section**, so the read depth has to exceed the render cap. `discovery/index.ts` already solves that shape with `internalReadDepth`, and the same reasoning applies.

**The no-cover rule needs a definition, and the obvious one has a side effect.** `artwork_status` has four states: `found`, `absent` (Cover Art Archive answered and has nothing), `failed`, and `pending` (not attempted yet). Filtering to `found` is the natural reading — but **artwork is fetched by an asynchronous queued job**, so a newly added album is `pending` at first. **A section about recency would then not show the most recent thing until its artwork job drains.** Whether that is acceptable, or whether `pending` should be treated differently from `absent`, is a real decision and not a detail.

**The exclusion is not neutral about what it hides.** `current-state.md` measured the uncovered albums by release type — of 45, `remix` is 13, `demo` 4, `mixtape` 4 — and records that deepening a discography _"reaches proportionally more remixes, demos and live records"_, so coverage falls as depth grows. **So this rule systematically hides exactly that material**, and it hides more of it over time. Set against F-024's _"Pitchfork not Rolling Stone"_ framing, that may cut the wrong way: the records with no cover skew obscure, not mainstream. **Raised as a tension, not resolved.**

**It also reverses a stated premise.** `product-spec.md` §8.9 defers the artwork backlog as _"an operational matter. Not a blocker"_, partly because _"a missing cover renders the designed placeholder"_. Hiding those albums treats the placeholder as unacceptable where the deferral treats it as fine. Both positions are defensible; they are not both currently written down.

**Related:** F-024 (same motivation, but that one proposes touching the catalogue); F-013 (a worklist for uncovered albums — hiding them removes the visible prompt to go and fix them); F-005 (whether Browse needs a "see all" at all).

### F-038 — a temporary marker distinguishing "awaiting artwork fetch" from "no cover exists"

**2026-09-15 · artwork, build-time tooling · TRIAGED — PARTLY ADDRESSED 2026-09-16, STILL OPEN**

**The distinction this asks for becomes reader-visible as a side effect of another decision.** The cover-art prompt appears **only on `absent`** and never on `pending`, so a placeholder with a prompt and a placeholder without one now mean different things on every album page. **That is not a marker and does not close this entry** — it distinguishes two of the four states, says nothing about `failed`, and is a consequence rather than a designed signal.

**What remains open is what this entry actually asked**: whether a deliberate, temporary marker should exist, with the removal mechanism the entry itself identifies as load-bearing.

Where an album has no artwork, **a small marker showing which kind of nothing it is** — still awaiting the fetch, or genuinely not in Cover Art Archive. **Explicitly temporary**, and only wanted while the site is being built.

**Context, not a resolution.**

**The cause is one prop.** `AlbumCover` takes **`hasArtwork: boolean`**, so every non-`found` state renders the same tinted initials placeholder. The data is not missing — `artwork_status` is already in `ALBUM_SUMMARY_COLUMNS` and reaches the call sites — it is **collapsed to a boolean at the component boundary**.

**There are four states, not two.** `found`; `pending` (not attempted yet); `absent` (Cover Art Archive answered and holds no front cover — a settled fact); and `failed` (the request errored, retryable). The observation names the first two kinds of nothing; **`failed` is a third and is meaningfully different from `absent`**, since one will never resolve and the other might.

**This exact class of problem was solved and closed two days ago, which makes it a precedent rather than a coincidence.** F-027 — _"the artist page cannot distinguish 'fetching' from 'stuck until tomorrow'"_ — delivered **three renderings from four states**, and established the principle that operator detail (`last_error`) is _"deliberately never shown to a reader"_ and lives on an operator surface instead. **Whether artwork should follow the same shape is worth asking rather than assuming, but the shape exists.**

**An operator surface already exists, and may be the whole answer.** `/debug/queue` was built _"to make queue state visible from the product rather than from ad-hoc queries"_ — which is close to word-for-word what this request is for. If the need is build-time visibility rather than a reader-facing signal, **that page may satisfy it without putting a marker on any tile.** Not a recommendation; the two are different in where you have to look.

**"Temporary" is the load-bearing word, and it cuts two ways.**

- It **sidesteps a recorded rejection**. `CollectionTile` rejects _"a permanent indicator band beneath every tile (imposes the cost on people who never asked for it)"_. A marker gated to development, or confined to an operator page, never becomes that.
- It needs **an actual removal mechanism** — an environment gate, a debug route, or a dated note — or it becomes permanent by default, which is how the rejected alternative arrives anyway.

**Related:** **F-037** asks that Recently added exclude albums with no cover, and I flagged there that the rule cannot be written without deciding whether `pending` differs from `absent`. **This request is the same distinction, surfacing visually rather than as a filter** — one decision may serve both. Also **F-013**, the uncovered-album worklist, which is the operator-side version of the same need.

### F-039 — MusicBrainz publishes full database dumps, and we have never considered them

**2026-09-16 · catalogue, ingestion, architecture · NEW**

MusicBrainz publishes its entire database as downloadable PostgreSQL dumps, updated **twice weekly, Wednesdays and Saturdays**. Loaded into a local Postgres, the whole catalogue is queryable directly — **no API, no network, no rate limit.** A **Live Data Feed** additionally keeps a loaded mirror in sync hourly. `musicbrainz-docker` is the recommended import tooling and `mbslave` the lighter replication-only alternative.

`mbdump.tar.bz2` is the relevant one — core catalogue, artists, release groups, releases, recordings — and it is **CC0, the same licence as the API data**. Most other dumps are `BY-NC-SA` and irrelevant here (edit history, editor data, statistics). `mbdump-cover-art-archive.tar.bz2` carries the **connections** to Cover Art Archive; **no dump contains images**.

**This has never been raised.** Verified by grep across `CLAUDE.md` and every file in `docs/` — no mention of dumps, mirrors, replication or the live feed anywhere. **It is an unexamined option, not a rejected one**, and it is recorded here so it stops being invisible.

**Why it is worth more than an ordinary idea.** The one-request-per-second limit is a `CLAUDE.md` non-negotiable, and `architecture.md` §17 names ingestion throughput _"the hardest constraint in the system"_. The job queue, progressive hydration, the cron drain, batch sizing, the 503 retry policy, the controlled curated-tranche run, and the whole F-026 to F-030 cluster all exist to **manage** that limit. A dump removes it for catalogue reads. **This question sits above that cluster rather than inside it: those entries ask how to drain a narrow pipe better; this asks whether the pipe is the right mechanism.**

**Context, not a resolution.**

- **This is not a proposal to mirror MusicBrainz into longplayr.** `architecture.md` §7a already rejects mirroring for `upstream_payloads` and that reasoning is untouched. The shape worth examining is narrower: **a dump as a local lookup source for deciding what to ingest**, with Supabase remaining the product database and in-scope albums still written through the existing path.
- **It would make one blocked capability cheap.** Depth work needs a browse-by-artist call the client does not have, and `development-plan.md` warns against building it against a guessed response shape. Against a dump that question is local SQL. The same applies to several open items: the `Various Artists` depth question, the singles boundary, F-019's aliases, and the remaining curated tranches.
- **The costs are real and two of them are specific to this project.** The loaded core database runs to tens of gigabytes — **neither source states a figure and none is invented here**. That is not hostable on the development machine (8 GB, already swap-exhausted, F-025) and is not something to put in Supabase beside application data at sensible cost. **A dump is a second database with its own home**, and where that home is, is the first unanswered question.
- **It does not touch the current artwork backlog.** Images are in no dump, so Cover Art Archive fetching is unchanged — and artwork is where the present queue pressure actually sits.
- **MetaBrainz asks commercial users to support the project financially even for CC0 data.** Not a blocker at this stage; recorded so it is known rather than discovered later.
- **Download requires registration**, per the MetaBrainz datasets page.

**What would have to be established before any of this is decidable:** the actual compressed and loaded sizes; where such a database would live and what that costs; whether the twice-weekly cadence is sufficient or the Live Data Feed is needed, and what that feed requires; and whether a local lookup source changes the **non-negotiable** — which it may not, since ingestion into longplayr could still go through the live API even if discovery does not. **That last question is the one that decides whether this is an architecture change or a tooling change**, and it must be asked rather than assumed.

**Related:** F-025 (the development machine cannot host much of anything), F-026 to F-030 (the queue cluster this sits above), F-019 (aliases, which a dump would make cheap), and `architecture.md` §17.

### F-040 — can longplayr ever hold what MusicBrainz will not?

**2026-09-16 · catalogue, architecture · CLOSED — DECIDED 2026-09-24: YES, AND THE NON-NEGOTIABLE WAS AMENDED**

**The rule was changed rather than worked around**, by the explicit mechanism that section requires. **Nothing is built and nothing is scheduled.**

**What it costs, honestly.** `albums`, `artists` and `releases` all declare `mbid` **not null unique**; **Cover Art Archive is MBID-keyed with no fallback**, so a user-authored album has no artwork path; **ListenBrainz popularity is MBID-keyed** too. Four questions must be asked rather than inferred — who may author, what happens when the record later appears upstream, who corrects a wrong one, and what prevents duplicating an MBID row. `product-spec.md` §8.9a holds the record.

**The first work is establishing the exception is needed at all** — MusicBrainz accepts bootlegs, demos, DJ mixes and self-released material.

**Raised while deciding F-008**, and it is a question rather than an objection to that decision.

Contributing upstream is now longplayr's stated strategy for gaps (`product-spec.md` §8.9). That assumes anything longplayr wants is **admissible upstream**. There may be material it wants that MusicBrainz will not take — **DJ mixes, remixes and bootlegs** were the examples given.

**Context, not a resolution.**

- **⚠️ It collides with a non-negotiable, and there is no third option.** `CLAUDE.md` holds _"The catalogue is read-only downstream of MusicBrainz. No user-authored metadata, ever."_ **Holding something MusicBrainz refuses means authoring that metadata.** Either the rule bends or the material stays out. **This must not be resolved by inference.**
- **The premise may be largely wrong, and checking it first could dissolve the question entirely.** MusicBrainz appears considerably more permissive than assumed: secondary release-group types reportedly include **DJ-mix, Remix, Live, Compilation, Soundtrack, Mixtape/Street and Demo**, and **Bootleg** is available as a release status. **Unverified to this project's standard** — recorded as a `[VERIFY]` row in `architecture.md` §18, and **nothing should be decided on the strength of it until that clears.**
- **Verification is cheap and comes first.** If the named examples are admissible upstream, the conflict never arises in practice and this entry closes without any rule changing.
- **F-039 changes what "checking" costs.** A MusicBrainz database dump would make admissible types a **local SQL question** rather than a documentation-reading exercise — so if that entry is ever pursued, this one gets much cheaper as a side effect.
- **Adjacent to F-011** (singles, and other out-of-scope release types) but **not the same question**. F-011 asks what longplayr's own boundary should admit; this asks what happens when longplayr's boundary is **wider than the upstream source's**.
- **Not urgent.** Nothing is blocked on it today, and the depth boundary currently sits well inside whatever MusicBrainz allows.

### F-041 — filtering, sorting and exclusion, on Browse and on a collection

**2026-09-16 · browse, collection · NEW**

Eventually I want to filter and sort what a grid shows, and exclude things from it — **show only albums from a certain year, or a genre, or above some popularity**, that sort of thing. **Both on Browse and on a user's own collection.** Not necessarily this round.

**Context, not a resolution.**

**Half of it exists on one surface and none of it on the other.** A collection already has **six decided sort modes** — added, listened, rating, title, artist, year — with the ordering rules recorded in `product-spec.md` and implemented in `collection/sort.ts`. **It has no filtering and no exclusion at all.** Browse has **neither sorting nor filtering**: it is two fixed sections, and F-005's see-everything page is decided-and-unbuilt with sorts named but no filters.

**The reference does exactly this and the analysis already captured it.** `design-reference.md` §3 records the member films grid carrying a filter bar of **`RATING · DECADE · GENRE · SERVICE`** plus a sort control. So this is a pattern the project has looked at directly rather than a new idea — but it was never promoted into a decision.

**⚠️ One of the named filters does not exist in the data, and that is the biggest thing here.** **longplayr holds no genre.** The ingest path deliberately excludes it: `development-plan.md` records `genres` and `tags` as **explicitly not requested** from MusicBrainz in the widened `inc` parameters. So **a genre filter is not a UI feature — it is an ingest change, a schema change and a backfill**, and it would reopen a recorded decision rather than extend one.

**A second one is decided against.** Sorting or filtering by **popularity** on a catalogue surface runs into `product-spec.md` §8.3's decision of 2026-09-16 that **an external popularity score never orders a surface** — it exists only to stop one looking empty. §8.9 also holds that **absence of an external signal must never gate discovery**, and every self-service album has a null score, so a popularity filter would hide exactly the albums the catalogue gained deliberately. **Neither forbids a filter outright, but both constrain what it may mean**, and that has to be settled before it is built.

**Year is the one that is cheap today.** `first_release_date` is held, indexed (`albums_release_date_idx`), and already drives a decided sort mode. A decade or year-range filter needs no new data.

**Exclusion is a different shape from filtering and should not be assumed to be the same feature.** "Show only 1990s" narrows a view; "never show me this" is a persistent preference belonging to a person, which is closer to a setting than to a control — and nothing in the product currently stores per-user display preferences.

**Related:** **F-005** (browse everything — its sorts are decided, its filters are not, and this entry is the natural extension) · **F-006** (sorting an artist's discography by more than date, where the popularity half is already deferred to Phase 5) · **F-024** and **F-037** (what Browse chooses to show, decided by rule rather than by the reader) · `design-reference.md` §3.

### F-042 — filtering a grid by what is already in my collection

**2026-09-16 · browse, collection · CLOSED — DELIVERED 2026-10-02**

> **Decision and evidence: `architecture.md` §16.13 and §16.13a.** `?mine=hide` on `/albums/all`, signed-in only and **not rendered at all when signed out** — this entry's own observation that it is a different kind of filter is what drove that. **The service takes a user id rather than a boolean**, so a signed-out visitor is structurally unable to receive a personal filter.
> **The anti-join was verified against a running PostgREST before anything was built on it** — 4 of 7, with the exact count respecting the filter, which pagination needs. **Scope is `/albums/all` only**: Home's Recently added has no controls at all and adding one there is a different decision.

A way to see only albums I do **not** already have. A filter, or a toggle on a grid.

**Context, not a resolution.**

**The data is there and the join is trivial.** `collection_entries` is keyed `(user_id, album_id)`, so "albums with no row for me" is a straightforward anti-join. **No new table, no ingest change, no backfill** — which makes this materially cheaper than the genre filter in F-041.

**It is a different kind of filter from everything else asked for, and that is the interesting part.** Year, genre and popularity narrow by facts about the **album**. This narrows by facts about **the reader**. Three consequences follow, none of them settled:

- **It cannot exist for a signed-out visitor.** Browse is public and identical for everyone today. A personal filter would be the first control on a catalogue surface that simply **is not there** when signed out — different from a control that is present and refuses, which is the pattern the product uses elsewhere.
- **The result stops being the same page for everybody.** Browse currently renders one answer for all readers. A per-user filter makes it per-user, which is a caching and query-shape change rather than a UI one.
- **It is meaningless on your own collection view.** Everything there is in your collection by definition, so despite F-041 asking for filters on both surfaces, **this one belongs to catalogue surfaces only** — Browse, the see-everything page, possibly an artist's discography.

**Where it would earn the most is the surface that does not exist yet.** F-005's browse-everything page is decided and unbuilt; _"show me what I haven't got"_ is arguably the main thing a person wants from a catalogue-wide wall, and it is worth deciding alongside it rather than bolted on after.

**One adjacent question it raises rather than answers.** longplayr already holds **Want to Listen**, so "not in my collection" and "on my want list" are different sets, and a reader might plausibly want either or both. **Whether this is one toggle, two filters, or a small set of states is undecided** — and `product-spec.md` §10.1 holds Want to Listen's profile destination and feed integration as decided-but-unbuilt, so that area has open ground already.

**Extended the same day, and the extension is the harder half.** The same axis pointed the other way — **show only albums I _do_ have** — and specifically **on an artist page**, where _"how much of this discography have I got?"_ is the natural question. Plus a third presentation: **not a filter at all, but two sections** — the albums in your collection, and the ones that are not.

**The filter direction is cheap and raises nothing new.** Only-mine and only-not-mine are the same anti-join with the condition inverted, and the three consequences above apply unchanged.

**⚠️ The two-sections version collides with a decided rule, and the collision is exact.** `product-spec.md` §6 decides the artist discography is **"one interleaved chronological run, newest first … never grouped by type"**, and states that release type _"is available as a small label on each item, but **it never fragments the grid**."_ **Splitting by collection state fragments the grid.** The decided rule is about release _type_ rather than collection state, so this is not a direct contradiction — **but "never fragments the grid" is the property it was protecting**, and that is what two sections would break.

**That conflict is already known to be live for another reason.** §5 records _"Richer artist pages — grouping by type … **Note the latent conflict**"_, observing the rule was settled when no artist held more than three releases and that catalogue depth makes it live. **So this arrives at a decision the project already expects to revisit**, from a different direction — and the two should be considered together.

**A filter and a split are not the same request and must not be triaged as one.** A filter narrows what is shown and needs no visual state on a tile. **Two sections assert something about every album in the grid**, which is closer to what `design-reference.md` §11.9 settled for the _collection_ grid — state, but only there — while catalogue grids deliberately carry none. **The cheaper half ships without touching any of that; the richer half reopens two decisions.**

**Related:** **F-041** (the general filtering and sorting request this arrived with — same surfaces, different axis) · **F-021**, whose second bullet is the network-scoped cousin: _"albums other people have and you do not"_, which is this filter plus a follow graph · **F-005** (browse everything) · **F-006** (sorting a discography by more than date — the same surface, and the other open question about how that grid may be reordered) · **F-003** (acting on an album without leaving the grid, which is what you would want to do next once you have found one).

### F-043 — follow back from the notifications page, without opening a profile

**2026-09-16 · notifications, social · CLOSED — DELIVERED 2026-09-16**

**Shipped** (`af8a8b5`, PR #16, CI #126). The control shows **live state** — _Following_ from somebody already followed — rather than the state when the notification arrived. **Only the follow notification carries an action.** `cycle-log.md` §81.

When someone follows you, the notification should let you **follow them back there and then**, rather than making you click through to their profile to do it.

**Context, not a resolution.**

**Everything needed already exists except one fact.** `followed` is one of three notification types; `FollowButton` is already a component; `followAction` and `unfollowAction` already exist. **What the notification list does not carry is whether you already follow that person** — `NotificationListItem` flattens to `actor: { handle, displayName, avatarUrl }` and nothing else.

**So the cost is a query shape, not a feature.** Rendering the control needs the viewer's follow state for every actor on the page — one batched lookup over the actors in the list, not one per row. **The same trap the feed and the counting contract have both already recorded**: a per-row query on a paginated list is the easy wrong answer.

**One design question the request does not settle: what the control shows when you already follow them.** A follow notification is a permanent record of a past event, but follow state is live and can change afterwards. **Three plausible answers** — a button that becomes _Following_, a control that disappears once satisfied, or nothing at all on notifications from people you already follow. **They read very differently on an old notification**, and the second quietly rewrites history.

**Two smaller ones.** `followAction` currently lives in `src/app/[handle]/actions.ts`, scoped to the profile route, so using it from notifications means moving it or importing across routes — a small structural choice worth making deliberately. And **the other two notification types have the same shape of question** — a liked review or list could plausibly offer an action too — so it is worth deciding whether this is _"notifications can carry actions"_ or _"the follow notification specifically gets a button"_.

**Related:** **F-017** (notifications were unreachable on mobile — same surface, already delivered) · **F-003** (acting on something without leaving the page you are on — the same instinct applied to album tiles, and the entry that records §10.6's seven unanswered questions about it).

### F-056 — CI jobs are failing before they start, and it blocks the whole workflow

**2026-09-24 · development process, CI · CLOSED — SYMPTOM GONE 2026-10-01, COST HALVED, BUDGET RISK STANDS**

> **Reconciled at STEP 00 on 2026-10-01.** **The blocking symptom is gone**: minutes refreshed, and run `36925511766` reached a runner and passed green — 534 unit, 788 integration, 137 end-to-end, **attempt 1, zero flaky**. The cause was confirmed as exhausted minutes by the refresh itself, which is the evidence this entry said it lacked.
> **The structural half is addressed, not solved.** PR #32 added `paths-ignore` for `docs/**` and markdown, so documentation-only pushes cost nothing — 14 of 40 recent commits, and three of the four runs after the last green one. `architecture.md` §20 and `CLAUDE.md`'s new `CI SKIPPED` state carry it.
> **What is NOT fixed and is deliberately left open**: a code run still costs ~23 billed minutes, 22 of them the integration and end-to-end job, so the ceiling is still roughly 87 code runs a month. **September used 99+.** If that bites again the lever is the job's own cost, not the trigger — and **that reverses what `architecture.md` §12 deliberately moved to CI**, so it is a decision rather than a tweak. **Related: F-045.**

**The post-merge run on `main` for §96 failed with zero steps executed and no logs retained.** Both jobs died within seconds of starting. **Re-run twice — `run_attempt: 3` — failing identically each time.**

**Not a test failure, and `main` is not broken.** Established by tree hash: `e7fd345`, which CI passed **green and zero-flaky** twenty-five minutes earlier, and `4f660bc` on `main` have the **identical tree** `12e5794`. The branch also sat directly on `main`'s tip, so the merge introduced nothing. **`main` holds exactly what was verified.**

**What it blocks is everything.** `CLAUDE.md`'s STEP J requires _a completed successful run on the exact pushed SHA_ before a merge, and `architecture.md` §12 moved the full gate to CI on the reasoning that it runs on clean runners. **If runners will not start, the project has no gate at all** — and the local `verify:full` that used to be the fallback was deliberately retired.

**The likeliest cause is exhausted GitHub Actions minutes on a private repository**, and it is **unconfirmed**: reading billing needs a `user` auth scope this session does not have and should not grant itself. The signature fits — a 15.8-minute run succeeding at 16:24, then instant failures from 16:49 — but **the evidence is circumstantial and is recorded as such.**

**What the maintainer can check**: GitHub → Settings → Billing → Actions minutes. If it is quota, the options are paying for minutes, making the repository public (declined before, `CLAUDE.md`), or reducing CI cost — the end-to-end suite is ~15 minutes of the ~16.

> ### ⚠️ The 1 October refresh does not solve this
>
> **Measured 2026-09-24.** A run costs **23 billed minutes** — 1 for _Format, lint, types, unit tests, build_, and **22 for _Integration and end-to-end_**. The free plan gives **2,000 a month**, so the budget is **about 87 runs**. **Between 1 and 24 September, 99+ ran.**
>
> **So the allowance will be exhausted again, on current habits, before the end of October.** Waiting for the refresh buys a working gate, not a fixed problem.

**Four ways out, and they are not exclusive.**

| Option                         | Cost                    | Note                                                                                                                                                                             |
| ------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Make the repository public** | **Free, unlimited**     | Permanent fix. **But the documentation here is candid** — `current-state.md` and `architecture.md` record every defect and near-miss in the project, and that becomes public too |
| **GitHub Pro**                 | **$4/month, 3,000 min** | ≈130 runs. At the observed rate of ~124/month **this is marginal**, not comfortable                                                                                              |
| **Pay overage**                | $0.008/min              | ~$8/month for 3,000 total; ~$21 for 200 runs' worth                                                                                                                              |
| **Cut the cost per run**       | Free, engineering       | **22 of 23 minutes is one job** — see below                                                                                                                                      |

**The structural fix is the last one, and it is specific.** `ci.yml` triggers on `push: [main]` and on `pull_request`, and **`pull_request` fires on every push to an open PR.** That is why one branch cost six full runs on 2026-09-24: five of those were iterations on the same work. **Running the fast job on every push and the heavy job only on `main` — or on a PR marked ready — would make an iteration ~1 billed minute instead of 23.**

**The trade is real and must be stated**: it moves the full gate later, which is the thing `architecture.md` §12 deliberately moved _earlier_ when it put the gate on a branch. **That decision should be revisited rather than quietly reversed.**

**One habit is also worth naming, and it is the agent's rather than the maintainer's.** Of the six runs on that branch, **five failed on the agent's own test mistakes** — a substring label match, a field not refilled, a redirect destination never verified. **That is ~138 minutes, roughly 7% of a month's allowance, spent on avoidable errors.** A single changed end-to-end spec can be run locally in seconds; the suite cannot. **`CLAUDE.md` currently forbids both**, and whether the narrow case should be excepted is a maintainer decision that has not been taken.

**Related**: F-044 records the test environment failing more often than the code; this is that class, at the infrastructure layer rather than the suite. F-045 records what moving every slow test to CI would cost if it bit — **this is that cost arriving.**

### F-044 — the test environment fails more often than the code does

**2026-09-16 · development process, testing · PARTLY ADDRESSED 2026-10-02 — THREE INSTANCES FIXED, THE PATTERN STANDS**

> **This entry was right, and 2026-10-02 produced five more instances in a single session** — each naming something other than its cause. **Three are now fixed**: `architecture.md` §12.2 (a stopped Docker daemon reported as a Playwright `webServer` timeout, and `npx playwright test` reported as a missing WebSocket), §12.3 (`db:types` writing its own error into the file it generates), and **§12.4** — one check guarding `db:reset`, `db:types`, `db:seed:fixtures` and `test:integration` that says which layer is missing.
> **The pattern is not closed.** What is fixed is the _reporting_, not the fragility: Docker still needs a full quit-and-reopen on this machine rather than `open -a Docker`, which cost time across four cycles before the right remedy was found. **That is an environment problem the repository cannot fix**, and the check now names it.

**A pattern rather than an incident**, filed because three of the last five cycles lost time to the environment and none of them to a product defect.

**The measured record, all from 2026-09-15 and 2026-09-16.**

- **A stopped Docker daemon** reported as `Timed out waiting 120000ms from config.webServer`, pointing at a dev server that was healthy in 349ms. Two wrong remedies attempted first because the message pointed there. **Filed separately as F-036.**
- **`npx playwright test` silently bypasses `scripts/with-websocket.mjs`**, so under Node 20 every spec constructing an admin client dies in its hook with a missing-WebSocket error rather than anything resembling the cause. `npm run test:e2e` is the supported path and the difference is invisible at the call site.
- **The integration suite truncates `albums` and `artists`**, so running Playwright after it without re-seeding produces failures that look exactly like assertion defects. **Documented in `CLAUDE.md`, and still walked into twice.**
- **A 5-second per-test budget on tests that drain real queue work.** CI run #121 failed one case in `curated-recovery.test.ts` on a 5020ms timeout; an isolated local run failed a **different** case in the same file with the same signature. Six samples measured **5.6s to 15.7s on unchanged code** — a 3× spread, with the slowest cases sitting against the ceiling. **Fixed on 2026-09-16** by raising that file's budget, following the precedent `upstream-search.test.ts` already set.
- **Failed end-to-end runs leave orphaned users and lists behind**, and `current-state.md` §8 records residue from an aborted run once producing a **deterministic failure that everyone read as a flake**.

**What these have in common is not flakiness.** Each is a **precondition that was not met**, reported as a **test failure**. The suite says "this assertion failed" when the truth is "the database was empty", "the daemon was not running", or "this had four seconds and needed six". **The cost is not the failure; it is the time spent looking in the wrong place.**

**Why this is worth an entry rather than five fixes.** F-025 records that local end-to-end failures on this machine have **never once identified a real defect**, across eight measured cycles. The gate moved to CI on that evidence. **These incidents are the residue of that same problem on a smaller scale**, and they are being fixed one at a time as they bite. **A preflight that fails with its own message** — is the database reachable, is it seeded, is the wrapper in use — would have caught three of the five at the point of failure rather than after a diagnosis.

**Context, not a resolution.**

- **Not urgent, and no product consequence whatsoever.** This is developer time, not user-facing behaviour.
- **It interacts with the gate change of 2026-09-15.** STEP F now runs targeted suites locally every cycle, so these failure modes are hit **more often, not less**.
- **F-036 proposes the narrowest version of the fix** — documenting the Docker signature — and this entry is the argument for something slightly wider. **They should be triaged together**; this one may simply widen F-036 rather than stand alone.
- **Two of the five are already closed**, so a fix would be against the remaining ones plus whatever comes next. **That is the honest case against acting now**: each incident is cheap in isolation and only the pattern is expensive.

**Related:** **F-025** (the measurement that moved the gate) · **F-036** (the Docker misdirection, the narrowest instance) · **F-032** (a migration can go unparsed locally — the same family, a different precondition).

### F-049 — reversal: the one-album-per-artist rule should count every credited artist, not just the first

**2026-09-16 · browse · CLOSED — REVERSAL ACCEPTED AND DELIVERED 2026-09-16**

**Shipped** (`460069a`, PR #17, CI #127). An album is now excluded when **any** credited artist has already appeared. **The cost the original decision named is accepted rather than answered**: a collaboration blocks its guests. **A middle reading was constructed during the decision and rejected**, and is asserted against by a test so it is not rediscovered as an obvious improvement. `cycle-log.md` §82.

**Changed my mind on a decision made during a cycle.** The rule as approved counts a collaboration against its **first credited artist only**. It should instead **look at every credited artist**: if an artist already appears anywhere in Recently added, show a different album.

**The evidence, from Recently added as it currently renders** — four albums, one artist across all of them:

| Album                          | Credited                          |
| ------------------------------ | --------------------------------- |
| _A Transparent Night_          | Tame Impala                       |
| _Neverender (Remixes)_         | Justice, **Tame Impala**          |
| _Peace and Paranoia Tour 2013_ | The Flaming Lips, **Tame Impala** |
| _My Life (remixes)_            | ZHU, **Tame Impala**              |

Under the rule as approved all four survive, because Tame Impala is the first credit on only one of them. **Under the change, one Tame Impala album appears.**

**Context, not a resolution.**

- **This reverses a specific, dated line.** `product-spec.md` §6 records **[DECIDED 2026-09-16]**: _"**A collaboration counts against its first credited artist only.** Watch the Throne spends JAY-Z's slot; Kanye West can still appear with a solo record. **The stricter reading was rejected**: counting against every credit lets one collaboration block two artists from the entire section, which is a large effect for a rule about visual variety."_ **The stricter reading is exactly what is now being asked for.**
- **The timing is as cheap as it gets: the decision is approved scope and _not implemented_.** `getRecentAlbums` is still a plain recency query, which is also why all four albums are visible right now. **Changing it costs no code**, only the decision record — but it is still a decision, and belongs to STEP B rather than to this file.
- **The evidence cuts directly at the rejected reading's stated rationale, and that is what makes it worth weighing rather than merely noting.** The rejection was argued on a cost — one collaboration blocking two artists. **The observed cost of the other choice is that one artist occupies four of the section's slots**, which defeats the visual-variety purpose the rule exists to serve. The decision did not have this case in front of it.
- **The counter-argument the decision raised is not answered by this evidence and should not be dropped.** Under the stricter reading, a prolific collaborator can be blocked from the section by a record they only guested on. Whether that matters more or less than the Tame Impala case is a judgement, not a measurement.
- **One detail the change leaves unspecified:** when several albums share a credited artist, **which one survives**. Most recent is the obvious reading, since the section is recency-ordered, but it is not stated.
- **A middle reading exists and has not been considered in either direction** — for instance suppressing repeats of any credited artist while still spending only the first credit's slot. Recorded so it is visible, **not proposed.**
- **Interaction worth noting:** three of the four examples are remix or tour releases. The approved cover rule may already remove some of them for an unrelated reason, and `current-state.md` records that uncovered albums skew to exactly that material. **The two rules interact on this specific case**, and their combined effect is not something either decision examined.

**Related:** **F-037** is the entry that became this decision, and is marked `PROMOTED — DECIDED 2026-09-16, NOT YET BUILT`. **F-035** notes that grid queries now embed every credited artist via `album_artists(position, artists(...))`, so the stricter reading needs no new data — the position ordering it would ignore is already there.

### F-045 — what it costs to have moved every slow test to CI

**2026-09-16 · development process, testing · CLOSED — ANSWERED WITH DATA 2026-10-02 (§115)**

> **This entry asked what the arrangement costs, and there was no data then. `architecture.md` §12.6 has it.**
> **The arrangement works**: 32 of 32 green on attempt 1, zero flaky, **zero failures in 36 completed runs** — against the eight local runs §12 measured that lost 9, 5, 2, 9, 7, 14, 19 and 6 tests to the machine. The latency is real and is **23 minutes** to a verdict.
> **The cost is ~790 of 2,000 billed minutes in two days, and the runway ends around 5 October.** The slow job is **92–95% of a run** across six measurements, and **half the spend is post-merge runs which F-051 established are not redundant** — so the lever is per-run cost, not run count.
> **No change is recommended to the gate.** What the entry wanted was the number, and splitting the slow job would reverse what §12.1 deliberately decided — a decision rather than a tweak.

**Filed after the change rather than before it**, so the exposure it creates is visible if it starts to bite. The decision itself is `architecture.md` §12.1 and `CLAUDE.md`'s STEP F; this entry is the part nobody has measured yet.

**What changed.** STEP F now runs `npm run verify` and **nothing that needs a database or a browser**. Integration and end-to-end belong to CI. The reason is that the development host is the maintainer's working computer and Playwright makes it unusable, against a measurement showing local end-to-end failures **never once identified a real defect** across eight cycles.

**Context, not a resolution.**

- **The feedback loop on a real defect is now roughly fifteen minutes instead of two**, and a defect found there **reopens the cycle**. That has happened once — `cycle-log.md` §79 — and cost one extra CI run plus a separate commit. **Whether it stays that cheap at a higher rate is unknown**, and it is the number worth watching.
- **The double-CI cost compounds it.** The branch model already runs CI twice per cycle — once on the pull request and once after the merge on an identical tree — which is **recorded as an open cost across several cycles and still undecided**. More reliance on CI makes that waste more expensive, not less.
- **A render probe is the replacement and it is not nothing.** Starting the dev server and fetching the changed page costs a fraction of a browser suite, and **has produced better evidence than Playwright did more than once** — §80's two defects were both found that way, and neither would have been caught by any assertion that existed. **It still uses the machine**, just far less, and nobody has said where its limit is.
- **The failure mode to watch for is a pull request that goes red twice.** One reopened cycle is cheap; a pattern of them would mean the local gate is now too thin, and the honest response would be to move something back rather than to push harder.
- **It interacts with F-044.** That entry records the test environment failing more often than the code does — five measured incidents. **Fewer local runs means fewer of those incidents**, which is a genuine benefit of this change and was not the reason for it.

**Not urgent, and no product consequence.** This is about how the work is verified, not about what users see.

**Related:** **F-025** (the measurement that moved the gate the first time, closed) · **F-044** (the environment failing more often than the code) · **F-032** (a migration can go unparsed locally — a gap that widens slightly when less runs locally).

### F-046 — pagination offers only Previous and Next, with no way to jump to a page

**2026-09-16 · browse, pagination · CLOSED — DELIVERED 2026-10-02 (§105, PR #41)**

> **Decision: `design-reference.md` §13.** One windowed control for all three surfaces rather than a per-surface variant — first and last always shown, a span around the current page, runs collapsed to an ellipsis. **It answers this entry's scale question by degrading rather than by branching.** A run of exactly one page never collapses, because an ellipsis the same width as the number it replaces is strictly worse.

On the all-albums page you can go **next** or **previous**, but there is no way to go **to a specific page** — you cannot ask for page 5 without clicking through to it.

**Context, not a resolution.**

- **Confirmed.** `Pagination.tsx` renders exactly three things: a Previous link when `page > 1`, the text `Page {page} of {totalPages}`, and a Next link when `page < totalPages`. **The total is already known and displayed**, so the information a page picker needs is present; only the control is missing.
- **It is a shared component, and that is the main thing to weigh.** `Pagination` is used by the **all-albums page**, the **collection destination** and `RelationshipPage` (followers and following). A change here lands on every paginated surface at once — which may be desirable for consistency, but it is not a single-surface change and should not be scoped as one.
- **The surfaces differ in how many pages they plausibly have**, which bears on whether one control suits all of them: a catalogue of hundreds of pages, a collection of a few, a follower list of one or two. A picker that helps the first may be noise on the others.
- **Related:** this page exists because of **F-005**; the sort half of the same observation is the next entry.

### F-047 — albums with no release year at all, and whether that is a capture fault

**2026-09-16 · catalogue, ingestion · CLOSED — INSTRUMENTED 2026-09-17, ANSWER NOT YET READ**

**The check shipped** (`dbbd887`, PR #20, CI #133): `/debug/queue` compares each undated album's stored payload against its column. **The entry closes; the question it asked is now answerable from the product** rather than by reasoning. **A third case the entry did not name is covered** — a payload holding a valid date the column lacks, which a parse-only check would have reported as upstream silence. `cycle-log.md` §85.

On the last page of the all-albums list there are albums carrying **no year at all** — for example `7d420176-a7df-4696-9eb6-5512fb3374f7`. **Is this a capture problem?**

**Context, not a resolution. Partly answerable from the code, and the rest is answerable locally without asking MusicBrainz.**

- **Finding them on the last page is the designed behaviour, not a symptom.** The year sort orders `first_release_date` descending with `nullsFirst: false`, so undated albums are placed last **deliberately**. `product-spec.md` §6 records the same rule for the artist page: _"**Undated releases stay last in both directions**, rather than being reversed to the top of an oldest-first run where they would read as the earliest releases."_ So their **position** is expected; whether their **emptiness** is expected is the real question.
- **The mapping has exactly two paths to null, and one of them would be a genuine fault.** `parsePartialDate` returns null when the upstream value is **absent or empty**, and also when it is present but **fails the `YYYY(-MM)?(-DD)?` pattern**. The first is upstream truth — MusicBrainz release groups, especially compilations, remix collections and live releases, frequently carry no first-release-date. **The second would be silent loss**, and nothing records whether it has ever happened.
- **This is checkable locally and cheaply, which is the useful part.** `architecture.md` §7a keeps every upstream response **verbatim**, so the stored payload for that MBID can be compared against the `first_release_date` column **with no MusicBrainz round trip and no rate-limit exposure**. If the payload carries a date the column does not, it is a capture fault; if the payload is empty too, it is upstream truth. **Neither has been established here.**
- **Partial dates are handled rather than discarded** — `first_release_date_precision` records `year`, `month` or `day`, and `formatPartialDate` _"renders a stored date honestly, showing only what the source actually knew"_ — so a year-only release shows a year rather than nothing. **An album showing no year is therefore not a precision artefact.**
- **Not flagged urgent**: no data is being destroyed, and the worst case is a field that was never captured, recoverable from the stored payload.

### F-048 — release-year sort runs one way only

**2026-09-16 · browse · CLOSED — DELIVERED 2026-09-16**

**Shipped** (`2a19751`, PR #18, CI #129), and **wider than asked**: all four catalogue sorts reverse, not just release year. Direction is a second press on the active sort. **The undated-albums rule was inherited rather than re-decided** — they stay last in both directions. `cycle-log.md` §83.

The all-albums page sorts by release year **most recent first**, and there is no way to reverse it.

**Context, not a resolution.**

- **Confirmed, and it is true of every sort on that page.** `catalogueOrder` gives each of the four sorts — `added`, `year`, `title`, `artist` — **one fixed direction**. `year` is `ascending: false, nullsFirst: false`. There is no direction parameter anywhere in `CatalogueSort`.
- **A decided precedent already exists for exactly this, on another surface.** `product-spec.md` §6 **[DECIDED 2026-08-20]** makes the artist page _"Sortable by release date — newest first and oldest first"_, with newest as the default. **So the product already holds that both directions are wanted for release date** — the catalogue page simply did not inherit it.
- **That precedent also settles the hard part.** The same decision fixes what happens to undated albums: _"**Undated releases stay last in both directions**"_, with the stated reason that reversing them to the top of an oldest-first run would make them read as the earliest releases. The current code already encodes the one-directional half of this as `nullsFirst: false`. **A reverse option inherits a rule rather than needing a new one** — though whether it inherits it is still a decision.
- **Whether the other three sorts also become bidirectional is a separate question** and is not implied by this one.
- **Related:** the pagination half of the same observation is two entries above; **F-005** is why this page exists.

### Triage pass — 2026-09-16, second pass

**Run at the maintainer's request.** The first pass this morning covered 36 entries; **thirteen have been filed or changed state since**, and four items shipped. **Classifies and recommends; decides nothing.**

#### What moved

**Four delivered since the first pass** — F-005 (browse everything), F-014 (cover-art prompt), F-037 (Recently added's two rules) and F-043 (follow back, pending CI). **Their state lines were stale and are corrected above**, which is the main housekeeping output of this pass.

**Nine new entries**, eight of them filed by the maintainer: F-041 to F-049. **Six arose directly from using what shipped**, which is the clearest signal in this pass — a surface built in the morning generated three follow-on observations by the afternoon.

#### The one that is not like the others

| Item      | Disposition                                                            | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F-049** | **NEEDS A DECISION — reversal, and time-critical in one narrow sense** | Reverses a **[DECIDED 2026-09-16]** line in `product-spec.md` §6 with evidence that decision did not have: **one artist occupying four of the section's slots**, because they are the first credit on only one of the four albums. **That defeats the purpose the rule exists to serve.** The counter-argument the decision raised — a prolific collaborator blocked by a record they guested on — **is not answered by this evidence and must not be dropped.** Narrowly time-critical only because the rule is decided-and-shipped: reversing it now is a small change, and it gets no cheaper |

#### Ready with no decision needed

| Item      | Disposition                                   | Reasoning                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-048** | **READY**                                     | Bidirectional release-year sort. **The hard part is already decided elsewhere**: §6's artist-page rule of 2026-08-20 makes release date sortable both ways and fixes that **undated releases stay last in both directions**. The catalogue page simply did not inherit it. **Whether it inherits is still a decision**, but there is nothing to design                                   |
| **F-047** | **READY — as an investigation, not a change** | Whether an album with no year is a capture fault is **answerable locally with no MusicBrainz round trip**, because §7a keeps every upstream response verbatim. Compare the stored payload against the column: a date in one and not the other is silent loss; empty in both is upstream truth. **Neither has been established**, and the answer decides whether there is any work at all |
| **F-004** | **READY — decided, unbuilt**                  | Readable URLs. **Larger than its decision suggests**: 14 link sites, 56 end-to-end references, and three constraints its cycle must settle — collision resolution, upstream renames, and that a slug is a label not an identity                                                                                                                                                          |
| **F-029** | **READY — decided, unbuilt**                  | Discography refresh on view when stale. **Carries a hazard written into its own decision**: a staleness window must not become the retry loop the once-per-artist rule exists to prevent                                                                                                                                                                                                 |

#### Needs a decision

| Item                                                | Disposition                            | Reasoning                                                                                                                                                                                                                                            |
| --------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-046**                                           | **NEEDS A DECISION**                   | A page picker. **`Pagination` is shared by three surfaces**, so this is not a single-surface change — and they differ in how many pages they plausibly have. A picker useful on a catalogue of eighteen pages may be noise on a follower list of one |
| **F-041**                                           | **NEEDS A DECISION**                   | Filtering and sorting. **A genre filter is an ingest, schema and backfill change** — genre is deliberately not captured. Year is cheap and indexed. Popularity is constrained by §8.3                                                                |
| **F-042**                                           | **NEEDS A DECISION**                   | Filtering by collection state. Cheap as a query; **would be the first catalogue control that cannot exist signed out**, and makes Browse per-reader. The two-section variant fragments a grid §6 decided is never fragmented                         |
| **F-039**                                           | **NEEDS INVESTIGATION FIRST**          | MusicBrainz database dumps. **Still the largest thing in the file.** Its own entry names what must be established before it is decidable — sizes, hosting, cadence — and none of it is known                                                         |
| **F-040**                                           | **BLOCKED ON VERIFICATION**            | Whether longplayr can hold what MusicBrainz will not. **Verifying the premise may dissolve it entirely**; the `[VERIFY]` row exists and nothing should be decided before it clears                                                                   |
| **F-003, F-011, F-024's item, F-038's remainder**   | **NEEDS A DECISION — ask-don't-infer** | Unchanged from the first pass                                                                                                                                                                                                                        |
| **F-002, F-006, F-012, F-021, F-023, F-009, F-010** | **NEEDS A DECISION**                   | Unchanged from the first pass                                                                                                                                                                                                                        |

#### Waiting, blocked, and closed

**Waiting on a trigger:** F-028, F-030, F-031, F-032, F-033, F-036, **F-044** (which gained a third instance in §80 and is looking less speculative), **F-045** (filed after today's gate change so its exposure stays visible — **watch for a pull request going red twice**).

**Blocked on accounts or environment:** F-016, F-018's remaining half. **F-019 left this list on 2026-10-02** — its blocker was the placeholder `MUSICBRAINZ_CONTACT`, which a real contact surviving `db:env` removed.

**Closed:** F-005, F-007, F-008, F-014, F-015, F-017, F-025, F-026, F-027, F-034.

#### What this pass concludes

**The ready pile refilled itself from use rather than from planning.** Every one of F-046 to F-049 came from opening a page that shipped hours earlier — which is the loop `docs/product-feedback.md` exists to support, working as intended for the first time at this pace.

**And the sharpest item is a reversal, not a feature.** F-049 says a rule decided and shipped today does not do what it was meant to. **That is worth more than any of the new features**, because it is the only entry backed by observing the product rather than reasoning about it.

### F-050 — ask the database for one album per artist, instead of scanning for it

**2026-09-17 · browse, performance · TRIAGED 2026-10-02 — STILL DEFERRED ON ITS OWN TRIGGER; THE SEPARABLE INDEX IS DONE**

> **Re-triaged at STEP A on 2026-10-02 and deliberately not built.** This entry sets its own trigger — the catalogue roughly doubling, or Home and Browse appearing in a latency measurement — and **neither held**, so building it would have been manufacturing work against `CLAUDE.md`'s explicit instruction not to.
> **The separable piece named here has shipped**: there was indeed no index on `albums.created_at`, and `architecture.md` §16.11 records it with an explicit note that it claimed no measured improvement. **§109 then measured it** — an index scan at 8.1 ms over 50,007 albums — so that claim is discharged. **The scan this entry wants to remove is still not the bottleneck**; §17.2 found slug assignment is.
> **[Status corrected 2026-10-02.]** This re-triage was reported as done during the §104 cycle and **was never written**: the script carrying it raised on an unrelated anchor lookup before reaching this edit, and only the `architecture.md` half was re-applied.

**Filed as the known replacement for a fix that shipped knowingly incomplete.** Recently added renders 11 of 24 cells because ingestion is artist-batched; the immediate fix raised the read depth to a fixed 750, which works today and **is a scan**. This entry is the version that does not scan.

**The shape of it.** Instead of _read the newest 750 albums, then drop every album whose artists have already appeared_, ask for **each artist's most recent album** and take the newest of those. **Bounded by artist count rather than album count** — roughly 260 rows against 1,050 today, and the ratio only improves as discographies deepen.

**Why the current fix cannot simply be tuned further.** Depth is not the variable. The **192 most recently added albums held 21 distinct artists** — Dalida 37, Radiohead 31, Belle and Sebastian 24 — because a curated tranche or a discography expansion writes a whole catalogue at once. **Filling a 24-cell section therefore means reading back through 24 complete discographies**, which is most of the table now and a larger share of it later.

**Context, not a resolution.**

- **⚠️ There is no index on `created_at`**, so the present read sorts most of the table on the product's **two busiest pages**. That is the cost being carried, and it is invisible at this catalogue size — which is exactly what makes it easy to forget until it is expensive.
- **The rule it must reproduce is greedy and order-dependent, which is the hard part.** An album is excluded when **any** of its credited artists has already appeared, and appearing claims **all** of them (`product-spec.md` §6, reversed 2026-09-16). **That is not a plain `DISTINCT ON`**: with a many-to-many `album_artists`, whether an album survives depends on which albums before it were kept. A SQL function can express it; a single PostgREST query probably cannot.
- **So this likely needs a migration**, which is why it was not folded into the immediate fix. **`CLAUDE.md` gates STEP J on a migration**, and bundling one into an urgent correction would have delayed the correction.
- **An index on `created_at` is a smaller, separable change** that helps the current implementation immediately and would remain useful afterwards. **It is not the same decision** and should not be assumed into this one.
- **The trigger to act is growth, not taste.** At ~1,050 albums the scan costs nothing measurable. **The honest signal is the catalogue roughly doubling, or Home and Browse showing up in any latency measurement** — neither of which is observed today.
- **A weaker variant exists and is worth naming**: keep the scan but **cap it against catalogue size** rather than at a constant, so it degrades predictably instead of silently reading a fixed fraction that shrinks as the catalogue grows. **Recorded, not proposed.**

**Related:** **F-037** is the entry that asked for one album per artist; **F-049** reversed its collaboration half, which is the rule this must reproduce; **F-005** is why the catalogue-wide page exists; **F-041** and **F-042** would add filters on top of the same query and make its cost matter more.

### F-051 — the post-merge CI run is not redundant, and the reason took a correction to find

**2026-09-17 · development process, CI · CLOSED — RECORDED, NO ACTION 2026-10-02**

> **This entry's purpose was the correction, and it achieved it.** The conclusion is that the post-merge run is **not** redundant: it tests a different tree from the pull-request run, which tests the merge result rather than `main` itself. **So there is nothing to remove and no saving to take** — closing it as a recorded finding rather than leaving it open as if it proposed work. Relevant to F-056's budget arithmetic, which should not count post-merge runs as waste.

**Filed after a wrong answer was given and checked.** Asked whether a cancelled run mattered, the first answer was that post-merge runs duplicate the pull-request run and cost only runner minutes. **The timing shows that is false in exactly the case that matters.**

**What actually happened, from the API rather than from memory.**

| Run      | Event          | Tree tested                         | When                                |
| -------- | -------------- | ----------------------------------- | ----------------------------------- |
| **#129** | `pull_request` | `5497d6a` merged into **`af8a8b5`** | 2026-09-16 20:54                    |
| **#130** | `push`         | `460069a`                           | 2026-09-17 02:10:02 — **cancelled** |
| **#131** | `push`         | `2a19751`                           | 2026-09-17 02:10:05 — passed        |

**A `pull_request` run tests head merged into base _as the base was when the run started_.** PR #18's run finished at 20:54 against `af8a8b5`. It was merged **seven hours later**, after PR #17 had landed as `460069a` — so **it merged onto a base its own CI never saw**, and **#131 is the only run that tested the result**.

**So the post-merge run is redundant when merges are isolated and load-bearing when they are not.** The distinction is whether the base moved between a pull request's run and its merge, and **nothing in the process notices when it did.**

**Context, not a resolution.**

- **The cancellation itself was harmless here**, and that is a separate point from the general one. `concurrency` in `ci.yml` groups by `workflow-ref` with `cancel-in-progress: true`, so two merges three seconds apart left only the later run alive. **`460069a`'s exact tree had already been tested by #127**, so nothing went unchecked — this time.
- **⚠️ The dangerous version of this is silent.** Two pull requests that pass independently can fail together, and the only thing standing between that and `main` is a post-merge run that **cancel-in-progress may discard** if another merge follows quickly. **A cancelled post-merge run on a superseded commit is fine; a cancelled one on the newest commit would not be**, and the configuration does not distinguish them.
- **This bears directly on the open "double CI" cost**, which has been recorded across several cycles as waste and is **partly not waste.** Any decision to drop the post-merge run would remove the only check on a moved base, and should not be taken on the grounds that it merely repeats the pull-request run.
- **GitHub offers a mechanism for the underlying problem** — requiring branches to be up to date before merging, or a merge queue — and both are **branch-protection features the project has already declined**, since they are paid on private repositories (`architecture.md` §12). **So the gap is known to be unclosable by configuration here**, which makes noticing it the only available control.
- **Not urgent, and nothing is known to have broken.** Every run on `main` so far has passed. This is filed because the reasoning that would have dismissed it was wrong, not because a failure has been observed.

**Related:** `architecture.md` §12 (why the gate is on CI and why branch protection was declined) · **F-045** (what moving every slow test to CI costs — this is a second cost on the same bet) · **F-044** (the test environment failing more often than the code).

### F-052 — no way to set a profile picture, though the field exists and renders everywhere

**2026-09-18 · profile · CLOSED — DECIDED 2026-09-24: BUILD IT, NARROWLY**

Supabase Storage in its own bucket, strict server-side size and format limits, **EXIF stripped**, no cropping UI, the initial-based avatar stays the default, and moderation rides on the reporting slice rather than inventing its own. `product-spec.md` §10.3a. **Unbuilt and unscheduled.**

**The consequence most likely to be forgotten**: it creates the **first user-owned storage objects**, so the hard-delete cascade must grow to take them. `architecture.md` §15.1 already warns about this, and §87's orphan test is where it gets proven.

Being able to **upload a profile picture** — part of wanting the social side of the product to feel like somewhere people are present.

**Context, not a resolution.**

- **This is further along than it looks, and stops one step short.** `profiles.avatar_url` exists in the schema, `Avatar.tsx` renders it, and it is denormalised into feed activity as `actor_avatar_url` — so avatars already appear on profiles, followers and following lists, the album page, the feed, notifications and user rows. **There is no upload path anywhere**: nothing in `src/services/profiles/`, nothing in onboarding, no settings surface. The column is readable and unsettable.
- **It is already recorded as in scope rather than as new direction.** `product-spec.md` §10.3 records photo and bio as **already in scope (Phase 0/2)**, with only _city_ being new and dating-specific fields explicitly excluded. So this is closer to an unfinished item than a feature request.
- **What is unstated is everything upload implies**: where the file is stored (Supabase Storage already holds artwork), size and format limits, whether images are moderated, and what a default looks like. **None of that is decided**, and an uploaded image is the first user-supplied binary in the product.

### F-053 — posting to the feed, and being able to respond to what is posted

**2026-09-18 · social, feed · CLOSED — DECIDED 2026-09-24, DIFFERENTLY FOR EACH HALF**

**Comments: deferred until reporting ships**, and the deferral now has a trigger rather than an open end — Phase 6 slice 3. §7's reasoning stands: adding the highest-liability content type before the mechanism to handle it exists is backwards. **A permanent no was offered and declined.**

**Status posts: out of scope, and this is a no rather than a deferral.** Every feed event today derives from an action on an album; a free-text post is a microblog with its own rules. **The narrower version survives** — F-022's album recommendation is anchored to a catalogue row and remains open.

**Messaging is untouched**, and its blocking precondition is now discharged as researched (`docs/legal-obligations.md`). `product-spec.md` §10.8.

Beyond logging albums: **posting what you are listening to, or a recommendation, into the feed** — and crucially **something people can respond to and interact with**. Plus **messaging one another**.

**Context, not a resolution. This is the entry in this batch that collides hardest with recorded scope, and the collision is in the second half rather than the first.**

- **"Respond to and interact with" is comments, and comments are explicitly deferred.** `product-spec.md` §7 defers them with the reason stated plainly: _"**Largest moderation liability in the product.** Likes give reciprocity at a fraction of the risk. Revisit once there's a community worth moderating."_ `CLAUDE.md` lists comments first among things _"Deliberately not in scope"_ and requires an explicit scope decision to add them. **This entry does not make that decision** — it records that the maintainer wants the interaction they were deferred to avoid.
- **A post is also a new content type, and the product currently has none.** Every feed event today is **derived from an action on an album** — added, rated, reviewed, relistened, listed. A status post is **user-authored content with no album behind it**, which is a different object with its own moderation, deletion, reporting and feed-eligibility questions. `CLAUDE.md`'s feed invariant — _"an event is generated when a user acts, at the moment they act"_ — was written for actions on albums and does not obviously describe posting.
- **Messaging is already decided direction, and already blocked.** §10.4 holds it as intended functionality behind a **blocking precondition**: the Germany/EU legal research must exist _"before any messaging code is written"_. **Restating the want does not discharge the precondition**, and the interaction half above may fall under the same research, since it is the same category of obligation — user-generated content and directed communication on a small EU service.
- **A recommendation posted to a feed is a third thing**, distinct from both. **F-022** records recommending an album to someone **directly**, and flags that whether that counts as messaging is open. **A recommendation posted publicly to a feed avoids the directed-channel question entirely** — which may make it the cheapest form of the idea, or a different feature altogether. Not resolved here.
- **Sequencing observation, not a plan:** the three parts have very different costs. Posting is new scope; responding reopens a firm deferral; messaging is blocked on research that has not started.

### F-054 — a native app, for push notifications specifically

**2026-09-18 · platform · CLOSED — DECIDED 2026-09-24: BOTH REOPENED**

**Push and the native client were both `[DECIDED]` against and both are reopened.** `product-spec.md` §7a. **Neither is scheduled, designed or assigned to a phase.**

**The narrower option was offered and declined**, and that is recorded: a PWA can do push on current mobile platforms, so reopening push alone would have served the stated goal without a second client.

**What it costs.** `architecture.md` §19.3's _a second client is plausible_ stops being a precaution and becomes a requirement — **`CLAUDE.md`'s domain-logic rule turns from advice into an obligation**, and the two drifts it already names become debt. Push additionally leaves the product, which §16.3's _directed, private, in-app only_ model does not cover: **consent is a legal question rather than a settings toggle**, per `docs/legal-obligations.md`. **Email stays decided against.**

The product should eventually be **an app, not a PWA**. The stated reason is specific: **push notifications on a phone are what gets people coming back.**

**Context, not a resolution. Two separate recorded positions stand in the way, and they are not the same position.**

- **Push is decided against, explicitly, and that is the sharper of the two.** `product-spec.md` §4 and §5 both record notifications as **in-app only** — _"new followers, likes on your reviews, likes on your lists, with an unread count. **No email, no push.**"_ marked **[DECIDED]**. `architecture.md` §16.3 repeats it for the built slice. **So the capability this entry exists to obtain is currently a decided exclusion**, and a native client would not change that by itself — push is a product decision before it is a platform one.
- **Native apps are deferred, with the reasoning already qualified.** §7 records _"Responsive web first. **Still deferred.** `architecture.md` §19 records the constraints that keep a second client from becoming expensive — **which is not a commitment to build one**."_ So the architecture has been kept deliberately client-agnostic — §19.3's plausible second client, and the domain-logic rule in `CLAUDE.md` that exists because of it — **without that ever amounting to a plan.**
- **The distinction worth preserving: the stated goal is re-engagement, and "a native app" is one means to it.** Push is available to a PWA on current mobile platforms, and email is a third route — both excluded by the same `[DECIDED]` line rather than by any technical limit. **Whether the goal warrants reopening that line, and separately whether it warrants a second client, are two decisions and not one.** Neither is taken here.
- **Nothing in this entry authorises platform work**, and it should not be read as reopening §7 or §16.3.

### F-055 — a failed sign-in clears the email you just typed

**2026-09-24 · signup, auth · CLOSED — DELIVERED 2026-10-02 (§99, PR #35)**

> **Decision: `architecture.md` §6.2.** The address is echoed back, no password ever is, and signup clears both password fields because a mismatch means one of them is wrong. `/login` and `/signup` only — the two forms `AuthForm` serves.

Get your password wrong and **both fields empty**, so you retype your address as well as your password. On a phone that is a real annoyance at exactly the moment somebody is already mildly frustrated.

**Context, not a resolution.**

- **Found by a test rather than by using the product.** The password-reset end-to-end spec filled only the password on its second attempt and submitted an empty address; the cause was the form, not the test.
- **`AuthForm` is uncontrolled and sets no `defaultValue`**, so the re-render after a rejected attempt empties every field. The fix is small — echo the submitted email back through the action state — and it is **deliberately not taken here**, being outside the boundary of the cycle that found it.
- **The password must still clear**, which is the one part worth thinking about rather than copying: refilling a password field for somebody is a different decision from refilling an email, and browsers already own that behaviour through their own password managers.
- **It applies to signup too**, where the cost is higher: signup has three fields and clearing all three after one mismatch is a worse loss than clearing two.

**A decision session on 2026-09-24, during the CI outage.** With GitHub Actions minutes exhausted until 1 October no cycle can reach STEP J, so the week is being spent on decisions and documentation, which need no CI. **Ten answered.** Report reason categories (`product-spec.md` §4.1); suspended actors in notifications (`architecture.md` §16.9a); the moderation audit trail (Phase 6 slice 3); **singles, the discography filter and the catalogue source** (§8.9a — the last of which **amended a `CLAUDE.md` non-negotiable**); **avatars** (§10.3a); **comments and status posts** (§10.8); and **push and a native client, both reopened** (§7a).

**Phase 6 has no open decision blocking any slice**, and **F-011, F-040, F-052, F-053 and F-054 are closed.** `docs/legal-obligations.md` was also written, discharging §10.4's precondition as researched.

### F-062 — the `component` test project has never been able to run, and nobody could have noticed

**2026-10-03 · development process, testing · NEW — FOUND BY A CYCLE THAT WAS NOT LOOKING FOR IT**

**`vitest.config.mts` has defined a `component` project since Phase 0** — jsdom, `@testing-library/react`, a setup file, `include: ['src/**/*.test.tsx']`. **It matches zero files, and always has.** `@testing-library/react`, `@testing-library/jest-dom` and `jsdom` are all installed.

**It does not work.** Adding the repository's first `.test.tsx` fails before any test runs:

> `require() of ES Module @exodus/bytes/encoding-lite.js from html-encoding-sniffer/lib/html-encoding-sniffer.js not supported`

**jsdom 29.1.1 depends on `@exodus/bytes@1.15.1`, which is `"type": "module"`, and `html-encoding-sniffer` requires it from CommonJS.** Nothing in this repository is at fault.

**Two fixes were tried and neither worked**, which is the part worth recording so the next attempt does not repeat them:

| Attempt                                                 | Result                                             |
| ------------------------------------------------------- | -------------------------------------------------- |
| Bump `jsdom` to `^30` (pulls `html-encoding-sniffer@7`) | **Same error.** The require is unchanged           |
| `--pool=threads` instead of forks                       | **Same error.** It is not a pool-isolation problem |

**Untried and most likely to work: `happy-dom` instead of jsdom.** It is ESM-native. That adds a dependency and swaps the DOM implementation, so it is a decision rather than a fix to apply quietly.

**Why this matters more than it looks.** The gap is invisible by construction — a project with no files always passes, so the suite is green and the capability is absent. **Any presentational assertion is currently unwritable**, which is why §13.1's not-found page ships with its security property verified by render probe rather than by a test that would fail if somebody made the page more helpful.

**Related:** F-044 (the test environment fails more often than the code does), `architecture.md` §13.1.

### F-061 — a tracklist fetched before full release is never updated afterwards

**2026-10-02 · album page, catalogue · NEW**

An album added a few weeks ago, **before it was released**, held only **three tracks** because that was all upstream had. **The album has since come out, and the page still shows three tracks.** `https://longplayr.vercel.app/albums/popstar`

**Asked directly: is this already handled, or does it need a cycle?** Answer below — **it is explicitly not handled, and it is recorded as undecided rather than overlooked.**

**Context, not a resolution.**

- **`found` is deliberately terminal.** `jobs.ts` declares `TRACKLIST_RETRYABLE = ['pending', 'failed']` under the comment _"`found` and `absent` are settled."_ So once any tracklist has been fetched successfully, **nothing re-fetches it, ever** — the three-track list is final by design, not by accident.
- **The exclusion is stated on purpose, in the exact terms this observation describes.** `architecture.md` records: _"A sweep over `failed` jobs is **recovery**. A sweep over `succeeded` ones is a **refresh policy** — that is `product-feedback.md` F-029, it is undecided, and `product-spec.md` §8.9 explicitly records 'no staleness rule and no revisit'. **The two differ by one value in a `where` clause**, which is exactly how F-029 would get answered by accident, so both the code and this record state the exclusion rather than implying it."_ **This entry is that question arriving with a concrete case behind it.**
- **The blanket position has already been partly lifted, which changes the argument.** Two refresh policies now exist: **artwork** `absent` re-enters the sweep behind a staleness window read from `artwork_updated_at`, and **F-029 shipped a 30-day staleness rule on successful discography expansions** (`44b03ac`, CI #136). **So "no refresh policy" is no longer the product's uniform position — tracklists are now the outlier**, and `architecture.md`'s pointer at F-029 as the open question is itself stale, since F-029 closed on 2026-09-17. `releases.tracklist_updated_at` is already written on every attempt, so the column a staleness window needs exists.
- **The mechanism is already safe for refresh.** `writeTracklist` does _"wholesale replacement rather than diffing"_, so a second fetch would correctly replace three tracks with the full list. **Nothing would need to merge or reconcile.**
- **⚠️ But re-fetching the tracklist may not be sufficient, and this is the part most likely to be missed.** A tracklist belongs to the **representative release**, not to the album. A pre-release three-track version and the finished album may be **two different releases inside the same release group** — in which case the correct fix is **re-selecting the representative release**, which `representative-release.ts` decides, rather than re-fetching tracks for the one already chosen. **Which of the two this case is has not been established** — it is answerable from the stored payload for that release group, per §7a, without a MusicBrainz round trip.
- **This is a product decision rather than a defect fix**, on the project's own framing: a refresh policy needs a staleness window, a scope (tracklists only, or every settled state), and a cost estimate against the one-request-per-second limit. **Whether that becomes a cycle is triage's call**, but it cannot be done as a one-line change without answering F-029's question by accident — which is precisely what `architecture.md` warns against.
- **A narrower case worth separating at triage:** an album ingested **before its release date** is a knowable category, and could be revisited on that basis alone rather than by a general staleness rule. `albums.first_release_date` is held, so "ingested before it came out" is queryable.

### Triaged, promoted or closed

**Entries stay in place with their state and destination marked**, per §7's third constraint, so the path from observation to decision stays traceable. This is the index.

| Item      | State                                                           | Outcome                                                                                                                                                                                     |
| --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-007** | `CLOSED` — delivered                                            | On-demand expansion, `aba3a07` (CI #95)                                                                                                                                                     |
| **F-015** | `CLOSED` — duplicate                                            | Superseded by F-025, which measures the same thing                                                                                                                                          |
| **F-017** | `CLOSED` — delivered                                            | Mobile notifications link on the profile, `311bd70`                                                                                                                                         |
| **F-018** | `TRIAGED` — partly addressed                                    | Fetch depth separated from display limit, `abb3adc`. **Show-more and artist matching still open**                                                                                           |
| **F-026** | `CLOSED` — fixed                                                | Later views drain, `f34c0b4` (CI #97)                                                                                                                                                       |
| **F-030** | `TRIAGED` — half fixed                                          | Contention fixed `2be9b3c`; **throughput and cadence still open**                                                                                                                           |
| **F-031** | `TRIAGED` — partly superseded                                   | Unserved size dropped `f68e050`; **parallel fetch still live**                                                                                                                              |
| **F-033** | `TRIAGED` — still open                                          | Weakened by its own correction; no mechanism established                                                                                                                                    |
| **F-034** | `CLOSED` — verified on real data                                | `c5e5c85`; Radiohead **3 → 35 albums**, job `#1630` succeeded on deployed data                                                                                                              |
| **F-016** | `TRIAGED` — partly addressed                                    | Confirm field and policy (PR #5); confirmation path (PR #6) and resend (PR #7). **Google and other providers open; verification email now blocked on an SMTP provider choice, not on code** |
| **F-025** | `CLOSED` — resolved                                             | The gate moved to CI on a branch; `CLAUDE.md` amended 2026-09-15                                                                                                                            |
| **F-027** | `CLOSED` — delivered                                            | Three renderings from four states, `dbb7865` (CI #103)                                                                                                                                      |
| **F-032** | `TRIAGED` — premise changed                                     | The migration now reaches CI before the deployed database. **The fresh-database blind spot survives**                                                                                       |
| **F-036** | `NEW`                                                           | A stopped Docker daemon reported as a Playwright server-start timeout. **Filed as `F-035`, renumbered 2026-09-15**                                                                          |
| **F-024** | `TRIAGED` — item 7 now decided                                  | Recently added took the lead, `design-reference.md` §11.11. **Item 7 answered 2026-09-16: external popularity never leads.** Removal half still blocked                                     |
| **F-001** | `TRIAGED` — decided, no change                                  | Favourites unchanged. **Reordering interaction model still open**                                                                                                                           |
| **F-004** | `PROMOTED` — decided, unbuilt                                   | Readable slugs, clean switch. `product-spec.md` §6                                                                                                                                          |
| **F-005** | `PROMOTED` — decided, unbuilt                                   | Browse everything, sorted by catalogue-owned fields only. `product-spec.md` §6                                                                                                              |
| **F-008** | `CLOSED` — decided                                              | Contributing upstream is the strategy. `product-spec.md` §8.9. **Opened F-040**                                                                                                             |
| **F-012** | `TRIAGED` — deferred                                            | fanart.tv pending terms verification. `architecture.md` §18                                                                                                                                 |
| **F-014** | `PROMOTED` — decided, unbuilt                                   | Prompt to add cover art, from the album page. `product-spec.md` §8.9                                                                                                                        |
| **F-029** | `PROMOTED` — decided, unbuilt                                   | Discography refreshes on view when stale. `product-spec.md` §8.9                                                                                                                            |
| **F-040** | `NEW`                                                           | Can longplayr ever hold what MusicBrainz will not? **Raised by F-008's decision; collides with a non-negotiable**                                                                           |
| **F-037** | `PROMOTED` — decided, unbuilt                                   | Recently added: one album per artist, covered albums only. **Its conflict with the cover prompt was decided in hiding's favour**                                                            |
| **F-038** | `TRIAGED` — partly addressed                                    | The prompt makes `absent` distinguishable from `pending`. **A deliberate marker, and `failed`, still open**                                                                                 |
| **F-041** | `NEW`                                                           | Filtering, sorting and exclusion on Browse and on a collection. **A genre filter would need ingest, schema and a backfill — genre is deliberately not held**                                |
| **F-042** | `NEW`                                                           | Filtering a grid by collection state, both directions. **Cheap as a filter; the two-section variant fragments the artist grid, which §6 decided it never does**                             |
| **F-043** | `NEW`                                                           | Follow back from the notifications page. **Everything exists except the viewer's follow state, which the list does not carry**                                                              |
| **F-044** | `NEW`                                                           | The test environment fails more often than the code does. **Five measured incidents in two days, none a product defect**                                                                    |
| **F-045** | `NEW`                                                           | What it costs to have moved every slow test to CI. **Filed after the change so the exposure is visible if it bites**                                                                        |
| **F-050** | `NEW`                                                           | One album per artist, asked of the database instead of scanned for. **The known replacement for a fix that shipped knowingly incomplete**                                                   |
| **F-051** | `NEW`                                                           | The post-merge CI run is not redundant. **A pull-request run tests the base as it was when it started; the post-merge run is the only check on a moved base**                               |
| **F-046** | `TRIAGED` — ready, decision-light                               | Pagination offers only Previous and Next. **Buildable now; the only open choice is how many page links a narrow screen shows**                                                              |
| **F-047** | `TRIAGED` — instrumented, unread                                | Whether a missing release year is a capture fault. **The classifier shipped 2026-09-17 and nothing has read its answer** — the cheapest open item in the file                               |
| **F-048** | `CLOSED` — delivered                                            | Release-year sort runs both ways, 2026-09-16                                                                                                                                                |
| **F-049** | `CLOSED` — delivered                                            | One album per artist now counts every credited artist, 2026-09-16                                                                                                                           |
| **F-011** | `TRIAGED` — direction given, form open, **extended 2026-09-18** | Singles enter the catalogue. **Which form, and the Bandcamp half, both unanswered.** The Bandcamp half is F-040's question, not a release-type question                                     |
| **F-052** | `TRIAGED` — unfinished scope                                    | Profile picture. **Already in scope per `product-spec.md` §10.3; the column and every renderer exist and no upload path does.** First user-supplied binary in the product                   |
| **F-053** | `TRIAGED` — three parts, three states                           | Posting is new scope; **responding reopens a firm deferral (`product-spec.md` §7 comments)**; messaging is blocked on §10.4's legal research, which has not started                         |
| **F-054** | `TRIAGED` — reopens a decision                                  | Native app for push. **Push is `[DECIDED]` against in §4 and §5; a second client does not change that.** Two decisions, not one                                                             |

**Updated 2026-09-15 on measured evidence rather than on elapsed time.** F-034 closed because Radiohead is repaired on the deployed database; F-025 closed because the gate actually moved and `CLAUDE.md` carries it; F-027 closed because it shipped; F-016 and F-032 changed state because their circumstances changed under them.

**A second pass later the same day, at cycle intake.** **F-024** changed state because its demoting half had already shipped as `design-reference.md` §11.11 and the entry still read `NEW`; **F-016** narrowed again once PR #6 and PR #7 merged; and the Docker entry was **renumbered `F-035` → `F-036`**, having been filed under an ID the artist-links entry already held. **No entry was closed and nothing was promoted.**

~~**Nothing is marked `PROMOTED`.**~~ **That stopped being true on 2026-09-16**, and the sentence is struck rather than deleted because it described the file accurately for its first three weeks.

**A decision session on 2026-09-16 answered eight questions and promoted four entries** — F-004, F-005, F-014 and F-029 are now recorded direction in `product-spec.md` with destinations named, **decided and unbuilt.** F-008 closed as a stated principle, F-012 deferred pending verification, F-001 decided as no change, and F-024's item 7 answered. **Promotion was the maintainer's deliberate act in every case**, as §7 requires. One new entry, **F-040**, was opened by a decision rather than by use — the first time that has happened.

### Triage pass — 2026-09-16

**Run at the maintainer's request, covering every open entry rather than the recent ones.** This pass **classifies and recommends; it decides nothing.** A recommendation here is an input to STEP A's ranking, and scope is still settled only at STEP B.

**Six dispositions are used**, and the distinction between the middle two is the one that matters most:

| Disposition          | Meaning                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **READY**            | Decided or decision-free, unblocked, and could be a cycle now                                                                                |
| **NEEDS A DECISION** | Cannot be scoped until a product question is answered. **Several are marked ask-don't-infer, where answering silently is a scope violation** |
| **BLOCKED**          | Waiting on something outside the code — an account, terms verification, a live API, or the maintainer                                        |
| **WAIT**             | Deliberately deferred against a stated trigger or measurement, not neglected                                                                 |
| **CLOSE**            | Already decided, no longer true, or not worth doing                                                                                          |
| **SPLIT**            | Contains parts with different dispositions and should stop being one item                                                                    |

#### Search

| Item                     | Disposition                                                                                                                                                                                                                                                                    | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-002** autocomplete   | **NEEDS A DECISION**                                                                                                                                                                                                                                                           | Whether it searches the local catalogue only or reaches upstream is unasked, and the two are different features. §8 measures ~20s when a search reaches MusicBrainz                                                                                                                                                                                                                                            |
| **F-018** upstream panel | **SPLIT**                                                                                                                                                                                                                                                                      | _Show more_ is **READY** and small. **Artist matching is BLOCKED** on verifying field-qualified syntax against the live API, which the placeholder contact forbids locally                                                                                                                                                                                                                                     |
| **F-019** aliases        | **BUILT 2026-10-02** — the unblocking condition below was met the same day the row was written: a real `MUSICBRAINZ_CONTACT` now survives `db:env`. The response shape was read from the live API before any code was written, so nothing was guessed. `architecture.md` §10.5 | Formerly **BLOCKED**: needs `/artist/?inc=aliases`. **The client has no `/artist/` call at all** and the local contact is a placeholder that refuses live requests — so the work would encode a **guessed response shape**, the documented failure in `fixtures.ts` and the exact reason `browseReleaseGroupsByArtist` was not built ahead of real data. **Unblocks when a real `MUSICBRAINZ_CONTACT` exists** |
| **F-020** engine choice  | **CLOSE**                                                                                                                                                                                                                                                                      | It is a record, not work — filed explicitly _"so it is not re-litigated"_. Its own trigger for revisiting is F-002                                                                                                                                                                                                                                                                                             |

#### Catalogue, ingestion and artwork

| Item                               | Disposition                            | Reasoning                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-005** browse everything        | **NEEDS A DECISION**                   | Three unsettled questions, including §8.9's undecided split of popularity into two concepts and whether a catalogue-wide sort reuses the six collection sort modes                                                                                                                                                                          |
| **F-008** contribute upstream      | **NEEDS A DECISION**                   | Asks whether this is longplayr's _strategy_ for upstream sparsity or an occasional manual habit. A product principle, and it bears on §8.9's depth rule                                                                                                                                                                                     |
| **F-009** automate contribution    | **BLOCKED**                            | Depends on F-008 being answered first, and its own findings are recorded as unverified leads                                                                                                                                                                                                                                                |
| **F-010** Discogs terms            | **SPLIT**                              | Adding a **[VERIFY]** row to `architecture.md` §18 is **READY** and overdue — Discogs is named as direction while absent from the table. The terms question itself is **BLOCKED** on verification, and the reported six-hour staleness limit would be **incompatible with `upstream_payloads`** storing responses verbatim and indefinitely |
| **F-011** singles                  | **NEEDS A DECISION — ask-don't-infer** | `CLAUDE.md` and §8.9 both hold the treatment of singles explicitly must-be-asked                                                                                                                                                                                                                                                            |
| **F-012** fanart.tv                | **NEEDS A DECISION**                   | Amends a **[DECIDED — verified]** rule. The entry's reading — that §7's justification is about _keying_, not exclusivity, and fanart.tv is MBID-keyed — is plausible and still a scope decision                                                                                                                                             |
| **F-013** uncovered-album worklist | **READY**                              | **The strongest unblocked item in this pass.** Pure local data plus URL construction: no third-party API, no terms exposure, no fuzzy matching, nothing written to a shared database, **no non-negotiable engaged**. `/debug/queue` (§17a) is the precedent, including its removal trigger                                                  |
| **F-014** user-contributed art     | **NEEDS A DECISION**                   | The prompt-and-route variant costs no rules, but where the prompt lives and what it says is a product surface                                                                                                                                                                                                                               |
| **F-028** lambda rate limiter      | **WAIT**                               | Highest theoretical risk in the file and **never observed firing** — the one 503 seen was upstream load shedding at `remaining=14/15`. **Trigger: a 503 attributable to our own rate.** The fix needs distributed shared state and is disproportionate before then                                                                          |
| **F-029** discography refresh      | **NEEDS A DECISION — ask-don't-infer** | What triggers a refresh, and whether it applies to every artist, is undecided and must not be inferred                                                                                                                                                                                                                                      |
| **F-030** expansion throughput     | **WAIT**                               | Contention fixed; the backlog is measurably clearing                                                                                                                                                                                                                                                                                        |
| **F-031** artwork serial fetches   | **WAIT**                               | Mechanism live, urgency gone                                                                                                                                                                                                                                                                                                                |
| **F-033** drains that vanish       | **WAIT**                               | No mechanism established. A lost attempt was observed being recovered, which narrows it without closing it                                                                                                                                                                                                                                  |

#### Discovery and social

| Item                               | Disposition          | Reasoning                                                                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-021** network-scoped discovery | **NEEDS A DECISION** | `product-spec.md` §10 direction. Also changes what Browse's lead section _means_, so it interacts with F-024                                                                                                                                                                       |
| **F-022** recommend directly       | **BLOCKED**          | Carries a precondition a discovery item does not, and sits next to §10.4's blocking legal research                                                                                                                                                                                 |
| **F-023** collected by             | **NEEDS A DECISION** | Its own same-day refinement questions whether _collected by_ is the right signal at all — favourites or likes may be. **The refinement changes what the feature is**, so it cannot be scoped as filed                                                                              |
| **F-024** seed too mainstream      | **SPLIT**            | **Demotion delivered** (§11.11). **Removal is BLOCKED** by §8.9's additive-expansion boundary — deleting catalogue rows would destroy `list_items` and other user data. **Item 7 — whether a high external score justifies prominence — is NEEDS A DECISION and answered nowhere** |

#### Product surfaces

| Item                              | Disposition                            | Reasoning                                                                                                                                               |
| --------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-001** favourites top N        | **NEEDS A DECISION**                   | Lands on `current-state.md` §11's open _"favourites reordering needs an interaction model"_; choosing and reordering are plausibly one interface        |
| **F-003** quick actions on a tile | **NEEDS A DECISION — ask-don't-infer** | `product-spec.md` §10.6 lists **seven** questions that must be asked. The entry describes a preferred pattern, which **is not the same as deciding it** |
| **F-004** slugs not MBIDs         | **NEEDS A DECISION**                   | Self-contained, but URL permanence and whether old MBID URLs redirect is unasked                                                                        |
| **F-006** discography sort        | **SPLIT**                              | The **popularity half is already decided** and scheduled to Phase 5 — close it as such. The open-ended _"other metrics"_ half is **NEEDS A DECISION**   |

#### Process and tooling

| Item                                              | Disposition                   | Reasoning                                                                                                                                                                |
| ------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F-016** signup and auth                         | **BLOCKED — maintainer only** | Google needs a Google Cloud project; verification email needs an **SMTP provider choice**. Neither is code                                                               |
| **F-032** `verify:full` and migrations            | **WAIT**                      | Downgraded when the gate moved: CI now parses a migration before the deployed database sees it. What survives is the fresh-database blind spot, on a less-travelled path |
| **F-036** Docker reported as a Playwright timeout | **READY**                     | Cheapest sufficient fix is documenting the signature. **Reproduced on 2026-09-15**, and the misdirection cost time twice in one session                                  |

#### Two observations from use that are not filed

**Neither is an entry yet, and filing is the maintainer's.**

- **Failed end-to-end runs leave orphaned users and lists behind** — four remained locally after the §73 cycle. `current-state.md` §8 records that residue from an aborted run once produced a **deterministic failure that read as a flake**, so this plausibly contributes to the local instability that has cost several cycles. **Recommend filing.**
- **`npx playwright test` bypasses `scripts/with-websocket.mjs`**, so under Node 20 every spec constructing an admin client dies in its hook with a missing-WebSocket error rather than anything resembling the real cause. `npm run test:e2e` is the supported path. **Recommend filing, and it is close kin to F-036** — both are the suite reporting an environment problem as a test failure.

**A third was found and fixed inside a cycle rather than filed**: the `pre-push` hook instructing a branch push to apply migrations ahead of CI. Addressed in `cycle-log.md` §75; recorded here only so the pass is complete.

#### What this pass concludes

**Three items are READY and need no decision from anyone**: **F-013**, **F-018's show-more half**, and **F-036** — plus the **[VERIFY]** row for Discogs split out of F-010.

**Fifteen are NEEDS A DECISION, and four of those are explicitly ask-don't-infer** (F-003, F-011, F-029, and F-024's item 7). **That is the pass's main finding**: the open backlog is gated far more by unanswered product questions than by engineering effort.

### F-057 — the documentation is written for the record, and read by an agent

**2026-09-26 · development process, documentation · PARTLY DELIVERED 2026-09-26 — THE `CLAUDE.md` HALF IS OPEN BY DECISION**

> **Promoted the same day it was filed.** The decision is `architecture.md` §20: `current-state.md` splits at §13, standing sections staying and cycle checkpoints moving to `docs/cycle-log.md`; the blockquote wrapper goes; every long document gains a table of contents. **Nothing is renumbered, rewritten or deleted** — §20.3. **The half of this entry about `CLAUDE.md`'s own length is deliberately not in that scope** and stays open; §20.5 records why, including that it was proposed by the agent that would benefit from it.

**Raised by the maintainer**, who observes that this project is built by an agent under light human direction, that the documents have grown by continuous accretion, and who asks whether their structure and formatting are actually suited to being read by an agent. **Explicitly not a complaint about length** — long is fine if it is legible and navigable.

**Measured 2026-09-26.** The corpus is **269,567 words, roughly 360,000 tokens** across 16 files, which exceeds any single context window.

| File                       | Words   | ~Tokens | Loaded            |
| -------------------------- | ------- | ------- | ----------------- |
| `CLAUDE.md`                | 8,467   | 11,300  | **every session** |
| `docs/current-state.md`    | 115,533 | 154,000 | on demand         |
| `docs/architecture.md`     | 44,312  | 59,100  | on demand         |
| `docs/product-feedback.md` | 35,545  | 47,400  | on demand         |
| `docs/product-spec.md`     | 28,477  | 38,000  | on demand         |
| `docs/development-plan.md` | 8,989   | 12,000  | on demand         |
| `docs/data-model.md`       | 9,259   | 12,300  | on demand         |
| remaining nine             | 18,985  | 25,300  | on demand         |

**Five observations, each measured rather than asserted.**

**1. `current-state.md` is told to be read first and cannot be.** At **154,000 tokens** it is larger than the context available to read it, so in practice a session reads the top and nothing else — which makes the rest write-only, and write-only documentation is pure cost.

**2. Its first 1,683 lines contain exactly one heading.** That is **33,516 words — around 45,000 tokens — of unnavigable prose** before the first `##`, most of it nested inside blockquotes. There is nothing for a `grep` for a heading to find and nothing for a targeted read to anchor on.

**3. No document has a table of contents**, and section sizes defeat section-level reading anyway. The largest single `##` section is **11,415 words in `architecture.md`** and **33,111 in `product-feedback.md`**. Reading "just the relevant section" can still cost 15,000 tokens.

**4. `CLAUDE.md` spends a meaningful share of every session on its own history.** It carries **15 amendment markers** and **6 passages describing what it used to say**. The distinction that matters is between **rationale**, which stops an agent helpfully reverting a decision and is load-bearing, and **history of the wording**, which serves the maintainer's audit trail and is paid for on every turn by every session.

**5. The append-only checkpoint model is at war with the file's stated purpose.** `current-state.md` says it records _where we are right now_; it is structurally a chronological log of 86 numbered checkpoints. Both are useful. They are not the same document, and `CLAUDE.md`'s own current-state paragraph was **fifteen pull requests out of date** at one point, which is the same duplication failing.

**What this entry does not do.** It proposes nothing and decides nothing — per this file's standing rules it is an observation. **A restructuring of the governing documents is a material change** and belongs to a deliberate cycle with the maintainer deciding the shape. The obvious hazard to weigh there: **the verbosity is partly deliberate and partly effective.** Dense rationale demonstrably stops an agent reverting hard-won decisions, and several passages exist because exactly that happened. **Cutting for brevity could cost more than it saves**, and any proposal should say which parts are load-bearing and why.

---

### F-058 — `npm run db:types` destroys the file it generates when the database is unreachable

**2026-10-02 · development process, build tooling · CLOSED — FIXED 2026-10-02, SAME DAY (§108)**

> **The mechanism was worse than this entry first described, and `architecture.md` §12.3 records the correction.** It is not that a failing command wrote to the file — **the shell `>` truncated the file before the command ran**, so an exit-code check could never have helped. `db:types` now captures the output and writes only on success, with a content guard for a CLI that fails while exiting zero. **Verified by stopping the stack and confirming the file stays byte-identical to the committed version.**

Running `npm run db:types` with Docker stopped **wrote the CLI's error JSON into `src/lib/supabase/database.types.ts`**, replacing the generated types with `{"_tag":"Error","error":{"code":"UnknownError",...}}`. Every subsequent `tsc` run then failed with `TS1005: ';' expected` on line 1, which points at the file rather than at the missing database.

**Observed on 2026-10-02 during §107** and recovered with `git checkout --`, so nothing was lost. **The reason it matters is that `CLAUDE.md` forbids hand-editing this file**: the only correct repair is regeneration or `git`, and somebody who does not realise what happened may try to fix the syntax error.

**Context, not a resolution.**

- **The script redirects stdout into the file**, so a failure that still exits writing to stdout overwrites it. The fix is to generate to a temporary file and move it into place only on success — the ordinary shape for this.
- **Same family as F-036**, which this session closed: a tool reporting an environment problem as something else. **This one is worse than a confusing message**, because it damages a tracked file and the real cause is two steps back.
- **A guard would be cheap and is worth weighing against the fix**: if the output does not begin with `export type Json`, do not write it.
- **Not urgent.** `git checkout --` is a complete recovery and the file is always committed. **Filed because the next person to hit it will be looking at a TypeScript error, not at Docker.**
- **Related:** **F-036** is the closed entry on environment failures reported as test failures; `architecture.md` §12.2 is the pattern it established.

---

### F-059 — slug assignment is quadratic in albums sharing a title, and caps a bulk insert

**2026-10-02 · catalogue, ingestion, performance · TRIAGED 2026-10-02 — FIX EXAMINED AND REJECTED AS DESCRIBED; STILL NOT BUILT (§117)**

> **The fix this entry calls _"plausible but unexamined"_ is now examined, and it is wrong twice** — `architecture.md` §17.4.
> **Wrong once**: `slug like base || '-%'` matches `kid-a-live` and `kid-a-2-3`, and `substring` on the first yields `'live'`, which cannot cast to `int`. **It errors on any album whose title extends another album's title** — §89's own bug family.
> **Wrong twice**: `slug = …` is an index probe, but the pattern lookup gets **no `Index Cond` at all** without a `text_pattern_ops` index — it reads the whole index. **So the naive fix replaces one or two probes with a whole-table scan per insert**, strictly worse in the common case.
> **The correct recipe is a numeric-anchored regex plus a second index on `slug`** — and pleasingly, Postgres derives the prefix range from the regex itself, so no separate `LIKE` is needed.
> **Still not built: this entry's own trigger has not fired.** What changed is that the fix is no longer unexamined, which was the perishable part.

**Found by the Phase 7 performance pass** (§107's successor, `architecture.md` §17.2 and §17.3). Both numbers are measured at 50,007 synthetic albums locally — roughly **48× the live catalogue**.

**`assign_album_slug` costs O(albums already sharing that title) per insert**, because §89's free-slug search probes upward from the base until it finds an unused counter.

| Rows inserted | Sharing one title  | All distinct titles |
| ------------- | ------------------ | ------------------- |
| 250           | 0.80 s             | 0.19 s              |
| 1,000         | 4.01 s             | 0.14 s              |
| 2,000         | 11.79 s            | 0.21 s              |
| 50,000        | **did not finish** | ~2 s (batched)      |

**Distinct titles are flat; a shared title is quadratic.**

**And `pg_advisory_xact_lock` per slug base caps a single transaction** at somewhere between **12,000 and 20,000 distinct titles** before `out of shared memory`. Re-locking the same base is not a new lock entry, so the limit is distinct titles rather than rows.

**Context, not a resolution.**

- **Reachable rather than contrived.** _Greatest Hits_ is among the most common album titles there is, and `CLAUDE.md` makes the catalogue **completion-oriented in depth** — which is the direction that accumulates shared titles.
- **Not a problem today.** Ingestion inserts one album per transaction, so the cost is the number of existing albums with that base: a handful. **The trigger is a single title reaching the low hundreds, or any attempt at bulk loading.**
- **This is the thing standing in front of F-039** (MusicBrainz full database dumps), which is precisely a large single-transaction insert and would meet both limits. **Batching under 12,000 distinct titles is the mechanical workaround** — 50,000 in ten batches took about two seconds.
- **No fix is proposed, deliberately.** Both are properties of a trigger written to fix a real collision defect (§88, §89), and replacing the probe loop with a direct `max(counter)` lookup is a plausible but unexamined idea that would need its own cycle and its own collision tests.
- **What was missing was the number.** The read paths that serve pages were measured in the same pass and are fine — `architecture.md` §17.1.
- **Related:** **F-039** database dumps; **F-050**, deferred on its own trigger in the same way.

---

### F-060 — `anon` and `authenticated` hold `UPDATE ON SEQUENCES` by Supabase default

**2026-10-02 · security, database · NEW — NOT URGENT, NEEDS A DECISION**

**Found by the first run of `npm run db:drift`** (§112, `architecture.md` §12.5). The deployed database carries default privileges granting **`UPDATE ON SEQUENCES` in schema `public` to `anon`, `authenticated` and `service_role`** — which **no migration declares.** It is a Supabase project default.

**Same family as §106.** `architecture.md` §16.5's whole point is that the platform's defaults grant what a migration appears to withhold, and this is a grant the project never wrote and has never revoked.

**Context, not a resolution.**

- **Reachability is the open question and it looks low.** `UPDATE` on a sequence permits `nextval` and `setval`. **PostgREST does not expose sequence functions**, so there is no route to `setval` without an RPC that calls it, and none exists. **The grant is real; a path to it is not evident.**
- **The tables that have sequences are few.** Most identifiers are `gen_random_uuid()`; `ingestion_jobs.id` is a `bigint` and is the clear case.
- **Revoking is not obviously safe, which is why this is filed rather than fixed.** An insert that draws from a sequence needs `USAGE` **or** `UPDATE` on it, and revoking the default could break `ingestion_jobs` inserts — the drain, the sweeps and the seed runners all do that. **Verifying which privilege each path actually relies on is the work**, and it is a deviation from the platform baseline either way.
- **It is deliberately allowlisted in the drift check** so the check stays readable, which means **this entry is the only record that it exists.** If the entry is closed without a decision, the knowledge goes with it.
- **Related:** **§106** is the same shape found by reading migrations; **F-032** is the entry whose surviving half produced the check that found this.

---

---

## 6. Triage

A deliberate pass over the inbox. It never runs by itself, and it happens on **two** occasions:

- **When the maintainer explicitly asks for it** — a standalone pass, outside any cycle.
- **At STEP 00 of a development cycle**, which triages relevant feedback as part of establishing the starting state. **[CORRECTED 2026-09-07 — this section previously said triage was not part of a development cycle, which stopped being true when `CLAUDE.md` gained STEP 00.]**

Neither occasion changes what triage may produce, and neither makes an entry scope.

Triage produces two things and nothing else: a classification, and a recommendation. **It does not make product decisions**, and it does not edit the authoritative documents.

| Item state | Meaning                                                                            |
| ---------- | ---------------------------------------------------------------------------------- |
| `NEW`      | Raw. Not looked at.                                                                |
| `URGENT`   | Suspected data integrity, security, auth, destructive or serious regression issue. |
| `TRIAGED`  | Classified, with a recommendation. Still not scope.                                |
| `PROMOTED` | Deliberately moved into an owning document or a phase. Destination recorded.       |
| `CLOSED`   | Duplicate, already decided, no longer true, or discarded — with the reason.        |

Classifications, kept deliberately coarse:

`urgent defect` · `defect` · `product improvement` · `design issue` · `feature idea` · `product question` · `architectural or data-model implication` · `duplicate` · `already decided` · `discard`

The only distinction that really matters is **raw observation** versus **deliberately evaluated item**. The labels exist to sort a list, not to model the work.

**Two classifications carry a standing obligation.** `already decided` must name the document and section that decided it. `product question` must be written as a question and left unanswered — `CLAUDE.md` and `product-spec.md` §10 both require open questions to be asked rather than inferred, and triage is exactly the moment that rule is easiest to break by supplying the obvious default.

---

## 7. Promotion — where an item goes when it leaves this file

Promotion is a deliberate act by the maintainer. It follows the project's existing conventions; it does not introduce new ones.

| Outcome                                   | Destination                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Product decision                          | `docs/product-spec.md` — §4 or the relevant §5/§6 entry                                                    |
| Product question needing a decision       | `docs/product-spec.md` §8, as **[OPEN]**                                                                   |
| Decided direction that is not to be built | `docs/product-spec.md` §10, mirrored in `docs/development-plan.md` "Recorded direction, not yet scheduled" |
| Design decision                           | `docs/design-reference.md` — §11 for decisions derived during implementation                               |
| Architectural decision                    | `docs/architecture.md`; something to confirm first goes to §18 as **[VERIFY]**                             |
| Data-model decision or open question      | `docs/data-model.md`, §9 or §11 for questions                                                              |
| Work to be scheduled                      | `docs/development-plan.md`, into the phase that owns it                                                    |
| Confirmed defect with evidence            | `docs/current-state.md` §8 (residual items) or §11 (open decisions)                                        |
| Implementation                            | a future development cycle, STEP A onward                                                                  |

Three constraints on promotion:

1. **Being promoted is not being scheduled.** Recording direction in `product-spec.md` §10 assigns no phase. `development-plan.md` is the only document that schedules anything, and `product-spec.md` §9 and `CLAUDE.md` both make this distinction load-bearing.
2. **Anything touching a non-negotiable in `CLAUDE.md` is the maintainer's decision alone**, raised explicitly under the working agreement. Promotion cannot route around it.
3. **The entry stays here**, marked `PROMOTED` with its destination, so the path from observation to decision remains traceable.

---

## 8. Relationship to the development cycle

The A–K cycle in `CLAUDE.md` stays coherent and bounded. This file is how that stays true while the product is being used.

**Testing can happen at any time**, including in the middle of a cycle. When something turns up:

- it goes in §5;
- **it does not need to be judged** against the current cycle;
- **it is not silently added to the current cycle**, and no cycle changes its approved boundary because of an entry here;
- it becomes eligible for consideration at the next deliberate triage or planning step.

**The connection point is STEP 00. [CORRECTED 2026-09-07]** This previously read _"The single connection point is STEP A"_, which was true when this file was written and stopped being true when `CLAUDE.md` gained **STEP 00 — Cycle Intake and Triage**. The substance is unchanged; the entry point moved one step earlier.

| Step        | What it does with this file                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **STEP 00** | Triages relevant feedback alongside existing open work and prepares a **neutral candidate field** for STEP A. **It never selects or recommends the next cycle**         |
| **STEP A**  | Takes that field as input **without inheriting its ordering, grouping or emphasis as a recommendation**, ranks it against everything else, and recommends the strongest |
| **STEP B**  | **Decides** — whether that candidate and its scope are accepted, or picks another                                                                                       |

**Nothing here shortcuts any of the three, and STEP 00 is not a slice-selection step.** `CLAUDE.md` is explicit that no step may be invented to take over slice selection, and that STEP 00 is not an exception: _"the moment a step ranks candidates or names a recommendation, it is doing STEP A's job."_ Preparing a neutral field is the whole of what it does with this file.

**A cycle already past STEP D is closed to new input.** The whole reason the cycle separates Decide, Document, Plan / Review and Implement is to stop implementation assumptions becoming product decisions by default; letting an observation in mid-implementation does exactly that.

### The one exception

An item marked **`URGENT`** — data integrity, security, authentication, destructive behaviour, or a serious regression on a deployed environment, where continuing the current work would leave the product materially broken, unsafe, insecure or corrupting data.

Three things follow, and they are narrow:

- It is **flagged explicitly and immediately**, not filed and mentioned later.
- **The decision to interrupt is the maintainer's.** The flag pauses; it does not rescope. The current cycle's state — commit, verification status, pending CI — is recorded before anything is set down, per the CI-and-cycle-continuity rules.
- **Interrupting the ordering is not skipping the process.** An urgent fix still gets a cycle, at whatever depth its scope warrants under `CLAUDE.md`'s "full cycle is not required for every tiny bug fix".

Urgency is about consequence, not annoyance. Something that looks bad, reads awkwardly or works badly is not urgent.

---

## 9. Boundary with `docs/current-state.md`

Both files hold observations, and the difference is where the observation came from and what has been established about it.

|                | `docs/product-feedback.md`    | `docs/current-state.md` §8 / §11                                                        |
| -------------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| **Source**     | Manual product use, any time  | A development cycle — STEP A investigation, STEP F verification, STEP K checkpoint      |
| **Standard**   | None. Impressions are welcome | Evidence. Items are measured, located in code, or verified against a database or CI run |
| **Written by** | Whoever is using the product  | The cycle that established the finding                                                  |
| **Reconciled** | Only at a deliberate triage   | Every STEP K                                                                            |

A raw observation starts here. If a cycle later confirms it with evidence, it is promoted into `current-state.md` §8 or §11 and marked `PROMOTED` here — which is also what keeps `current-state.md` a checkpoint of established state rather than a second inbox.

**A full triage on 2026-09-18, covering every entry rather than the new batch.** The four entries added that day were classified — **F-011**'s extension, **F-052** profile picture, **F-053** posting and responding, **F-054** native app — and four entries missing from this index were added to it. **Nothing was promoted and nothing was closed.**

**Two findings from that pass are worth more than the classifications.**

**§8.9's cost argument for deciding singles early no longer holds, and the change that dissolved it was ours.** §8.9 records that admitting singles later means _"a full upstream re-traversal per artist"_, because the scope filter runs **before** `storeUpstreamPayload` — so a refused single leaves no row and no payload, which remains true. **What changed is that the traversal is already happening.** `browseReleaseGroupsByArtist` requests every release group with no type filter, so singles are fetched and discarded locally today; and **F-029's refresh-on-view, delivered 2026-09-17, re-runs that walk every 30 days.** A boundary change would therefore be picked up on the next refresh of any artist whose page is viewed, at **no additional upstream cost**. The decision is still consequential — §6's interleaved discography is the live conflict — but **it is no longer time-sensitive, and §8.9 should be corrected when something next touches it.**

**The two entirely unbuilt phases are each blocked by one small decision, and neither has ever been ranked.** `development-plan.md` gates **Phase 6** on _report reason categories_ and **Phase 7** on _handle reuse after deletion_ (`data-model.md` §9.5). **Both phases are the kind whose cost scales with how much else exists** — Phase 6 enforces content status across **every** read path, Phase 7 is a deletion cascade across **every** table — so each feature shipped before them is a retrofit into them later. **F-052 and F-053 are exactly that shape**: an avatar is a storage object the cascade must delete, and a post is a content type that must be reportable, blockable and deletable.
