# longplayr — Product Feedback

**Status: inbox. Not a specification, not a roadmap, not an authority.**

Observations captured while actually using longplayr — during a development cycle, between cycles, or at any other time. The point of the file is that **testing the product and running a development cycle are independent activities**, and neither should be able to derail the other.

Notation follows the rest of `docs/`: absolute dates, and **[OPEN]** / **[DECIDED]** reserved for the authoritative documents. Nothing here is marked decided, because nothing here is decided.

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

**2026-08-30 · profile, album page · NEW**

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

**Context, not a resolution.** `current-state.md` §8 carries an open item, _"Search and add are slow"_, measuring roughly **20s** for a search that reaches MusicBrainz. That is the caveat above, measured. It does not decide anything here — a local-catalogue-only as-you-type search and an upstream-reaching one may be different questions. Flagged for triage.

### F-003 — add to collection directly from search results

**2026-08-30 · search · NEW**

When results come up, you should be able to add one to your collection from the result itself, rather than clicking through to the album page first.

**Context, not a resolution.** This overlaps `product-spec.md` §10.6, _"Quick actions on a tile, and on an upstream search result"_ — recorded direction, decided, nothing built and nothing scheduled. §10.6 lists seven questions that must be asked rather than inferred, including what a quick "remove from collection" is allowed to do and what the touch equivalent is. **This entry does not answer any of them**, and it may be narrower than §10.6 or identical to part of it. Flagged for triage as a likely overlap with recorded direction.

### F-004 — album and artist URLs should be slugs, not MBIDs

**2026-08-30 · album page, artist page · NEW**

The URL for an album or artist currently carries its MBID. A name-based path would be a better experience — something like the artist name and the album name instead.

For collisions, something like appending a year or a counter: `album-name-year-1` where two albums share a name and a year, or `artist-name-1` for two artists with the same name.

**Context, not a resolution.** Current routes are `/albums/[mbid]` and `/artists/[mbid]`; profiles sit at the root as `/[handle]`. Whether the proposal is a root-level path or a prefixed one is left as written rather than assumed — a root-level `/album-name` would share a namespace with handles. `data-model.md` §8 records **MBID as natural key**, and `CLAUDE.md` holds the catalogue read-only downstream of MusicBrainz, so a user-facing slug raises questions about where the slug is derived, stored and disambiguated, and what happens when upstream renames something or merges two MBIDs. **None of that is answered here.** Flagged for triage as carrying data-model and architectural implications.

### Triaged, promoted or closed

_Nothing yet._ Items move here with their outcome and destination recorded, rather than being deleted.

---

## 6. Triage

A separate, deliberate pass over the inbox. It is **not** part of a development cycle and does not run automatically — it happens when the maintainer explicitly asks for it.

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

**The single connection point is STEP A.** `CLAUDE.md` gives STEP A discovery, ranking and recommendation of the next slice; triaged feedback is _candidate input_ to that ranking, alongside everything else STEP A weighs. **STEP B decides.** Nothing here shortcuts either step, and there is no separate slice-selection step to add.

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
