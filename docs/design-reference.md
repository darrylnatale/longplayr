# longplayr — Design Reference

**Status: pass 2 complete for desktop.** Written from analysis of 13 supplied screenshots of the live Letterboxd site, not from description. One gap remains — see §9.

**Scope and boundaries.** Letterboxd is a reference for _structure, information hierarchy, and interaction_. It is not a source for visual identity. No Letterboxd branding, palette, typography, copy, iconography, or assets are reproduced. §7 records their exact colour values specifically so we can diverge from them deliberately rather than accidentally landing nearby.

---

## 1. The framing that governs everything below

> **Letterboxd is a diary. longplayr is a collection.**

Letterboxd's atomic act is _watching a film on a date_; its profile is a chronology and its feed is powered by repeat logging. longplayr's atomic act is _having listened to an album_; an album appears in a collection exactly once, and profiles show no dates.

A meaningful portion of Letterboxd's design solves a problem we don't have. The diary widget and diary page in particular are references for almost nothing. Patterns get evaluated against our model, never adopted because they work there.

---

## 2. What was analysed

| Screenshot                           | Read as                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| Film detail (signed in / signed out) | Detail page anatomy, personal-state controls, ratings display |
| Member profile                       | Profile structure — directly informs open decision 8.2        |
| Member films grid                    | Our collection view's closest analogue                        |
| Activity feed                        | Event vocabulary and item density                             |
| List detail (ranked / unranked)      | List presentation and sidebar widgets                         |
| Lists index                          | Lists-as-cards                                                |
| Browse popular films                 | Our discovery surface's analogue                              |
| Search results                       | Cross-entity result grouping                                  |
| Review permalink                     | Long-form review presentation                                 |
| Director page                        | Mostly a negative reference — see §5.4                        |
| Mobile film detail                   | Responsive behaviour (partial — see §9)                       |

Rating interaction was deliberately omitted, which is now moot: the score input is decided (§6.2).

---

## 3. Measured observations

Findings from the actual pixels, expressed as ratios and counts where possible since the captures are high-DPR and absolute CSS values can't be inferred reliably.

### Detail page anatomy

A **full-bleed backdrop** occupies roughly the top third, with the navigation bar overlaid transparently on it. Below that, a **three-column layout**:

```
 ┌──────────┬────────────────────────────┬──────────────┐
 │  poster  │  title · year · director   │ action panel │
 │  ~13%    │  tagline                   │  ~20%        │
 │          │  synopsis (~55ch measure)  │              │
 │ stats    │  ─────────────────────────  │ ratings      │
 │ where to │  CAST CREW DETAILS GENRES  │ histogram    │
 │ watch    │  chip grid                 │ + average    │
 └──────────┴────────────────────────────┴──────────────┘
```

The centre column carries a **serif** face for title and synopsis at a generous line height; interface chrome is **sans**, small, uppercase, and letterspaced. That pairing is doing a lot of the work — it makes editorial content feel like content and controls feel like controls.

### The action panel — the most transferable component

Personal state lives in a **discrete raised card**, not scattered inline:

```
 ┌────────────────────────────────┐
 │  ◉ Watch   ♡ Like   ◷ Watchlist│   ← three icon toggles
 ├────────────────────────────────┤
 │  Rate      ★ ★ ★ ★ ★           │   ← rating control
 ├────────────────────────────────┤
 │  Show your activity            │   ← full-width stacked
 │  Review or log…                │      actions
 │  Add to lists…                 │
 │  Share                         │
 └────────────────────────────────┘
```

This is the single most directly reusable pattern in the whole reference, and §6.4 describes how it maps onto our states.

### Ratings display

A ten-bar histogram sits beside a **large numeric average** (`3.4`), with a single star at the low end and five at the high end, and a "7.6K FANS" count in the header. Notably, **Letterboxd itself displays its average as a decimal** even though its input is stars — which quietly validates our decision to make the score numeric throughout.

### Profile page — answers open decision 8.2

The profile is an **overview, not a raw grid**:

- Header: large circular avatar, username, `EDIT PROFILE` button, overflow menu
- A **stat cluster** right-aligned — big number over small uppercase label, separated by hairline rules: `1,909 FILMS · 7 THIS YEAR · 6 FOLLOWING · 3 FOLLOWERS`
- Tab bar: Profile · Activity · Films · Diary · Reviews · Watchlist · Lists · Likes · Tags · Network
- Body: `FAVORITE FILMS` (four large posters, no captions) then `RECENT ACTIVITY` (poster row)
- Sidebar: `WATCHLIST` as a fanned overlapping poster stack, `DIARY` as a compact date-grouped list, `ACTIVITY` as a text feed

The **full grid lives behind the Films tab**, not on the profile itself. Favourite films are pure artwork with no titles — identity communicated entirely through covers.

### Collection grid density

The member films grid runs **12 posters per row**, occupying ~93% of viewport width, with a poster-to-gutter ratio of roughly **5:1**. Crucially, there are **no titles, no captions, nothing but artwork** — with tiny heart glyphs beneath liked entries as the only overlay. A filter bar sits above: `RATING · DECADE · GENRE · SERVICE · Sort by RELEASE DATE`, plus view-density toggles.

### Feed — two tiers

The feed uses **two distinct item weights**:

1. **Full items** for reviews — poster thumbnail, actor name, relative time right-aligned, large serif title with year, star rating, several lines of review text, like footer.
2. **One-line items** for low-signal events — avatar, a single sentence (`Sebastjan liked katiealicegreer's ★★★★½ review of Kiss Me Deadly`), timestamp, on a subtly tinted row.

Sub-tabs split `FRIENDS · YOU · INCOMING`. Relative times are terse: `14h`, `2d`, `3d`.

### Discovery uses size as hierarchy

Browse leads with **four large posters** carrying engagement stats beneath (views, lists, likes), then drops to a **twelve-across strip** of small posters for a secondary section. Size alone communicates importance — no badges or ribbons needed.

### Recurring section-header pattern

Consistent throughout: small uppercase letterspaced label, a hairline rule extending to the right edge, and a `MORE` or count link at the far right. Cheap, repeatable, and it makes long pages scannable.

---

## 4. Borrow

| Pattern                                          | Why it transfers                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Dark ground, artwork supplies colour**         | Cover art is wildly inconsistent in palette; a dark desaturated interface makes a grid read as a coherent wall rather than a clash |
| **Detail page as three columns**                 | Cleanly separates identity (artwork), content (metadata, tracklist), and personal action                                           |
| **Personal state as a discrete card**            | Collecting is our core action; it deserves a dedicated, always-visible home                                                        |
| **Large numeric average beside a distribution**  | Directly applicable — we already display one decimal                                                                               |
| **Profile as overview, full grid behind a tab**  | Keeps the profile expressive rather than an undifferentiated wall of covers                                                        |
| **Stat cluster** (big number / small caps label) | Compact, readable, works for albums · listened · following · followers                                                             |
| **Two-tier feed**                                | Lets high-signal events breathe while keeping low-signal ones present but quiet                                                    |
| **Section header with hairline + MORE**          | Makes long pages scannable at almost no cost                                                                                       |
| **Size as hierarchy in discovery**               | Avoids badges and decoration to signal importance                                                                                  |
| **Caption-free artwork grids**                   | Trusts recognition over reading; much denser                                                                                       |
| **Serif for content, sans for chrome**           | Makes reviews feel editorial and controls feel functional                                                                          |
| **Terse relative times** (`14h`, `2d`)           | Right for a feed; and it's the only place we show time at all                                                                      |

---

## 5. Adapt

### 5.1 Square artwork instead of portrait posters — the largest divergence

Film posters are **2:3 portrait**; album art is **1:1 square**. At Letterboxd's measured 12-across density, square covers make each row **a third shorter**, so the same screen holds substantially more. Two options:

- **Keep ~12 columns** — rows get shorter, more albums per screen, calmer rhythm.
- **Increase density** — squares tile more efficiently, so more columns remain legible.

Either way the mosaic reads differently: portrait posters create strong vertical rhythm, squares create a uniform grid. **Thematically this is a gift** — a wall of square covers reads as a record shelf, which is exactly right, and it's immediately distinguishable from Letterboxd at a glance.

**Resolve before building any grid component.** Every downstream layout depends on cell proportion.

### 5.2 Numeric scores replace star glyphs

Stars are compact and scannable at grid density; a decimal is a different object. It is **more precise to read** (`8.7` beats counting four-and-a-half glyphs) but **colder in register**. Design should soften that rather than amplify it. A fixed-width numeric badge needs its own treatment at grid scale, in feed rows, and on detail pages — where Letterboxd can rely on a glyph run, we need a considered badge.

### 5.3 The diary becomes a sortable collection

Letterboxd's diary — both the sidebar widget and the full page — has **no analogue for us**. Profiles show no dates and each album appears once. What transfers is the idea of a personal record as dense, scannable, and sortable; what replaces the date-grouped table is a cover grid with sort and filter controls, per-item score, like indicator, and relisten marker.

### 5.4 Artist pages must be far richer than director pages

The director page is thin — a filmography grid and little else — because filmography isn't how people browse film. **Discography absolutely is how people browse music.** The artist page is primary for us and secondary for them. This is a case where the reference under-serves us and we design past it.

### 5.5 Feed vocabulary is ours, not theirs

Rendering patterns transfer; event types don't. Ours: adds, relistens, ratings, reviews, list activity — and explicitly **no likes or follows in the feed**. Note that Letterboxd's one-line tier is populated largely by exactly the like/follow events we excluded, so **our second tier will be thinner** — worth checking whether two tiers still earn their complexity, or whether ratings-without-reviews become the natural second tier.

### 5.6 Filter bars, minus the film-specific facets

`RATING · DECADE · GENRE · SERVICE` becomes something like rated/unrated, liked, reviewed, decade, and sort options. Genre depends on whether genre data lands (deferred).

---

## 6. Where we design from scratch

**6.1 — Edition disclosure.** An album may have dozens of releases. Our model makes the release group primary with an optional edition on a collection entry. Expose editions to the few who care without cluttering the page for everyone else. Film has no equivalent.

**6.2 — The score input. RESOLVED: a numeric input.** Decided: numeric entry for 0.0–10.0. This removes what was the highest-risk unsolved interaction. Remaining detail work is presentational, not conceptual — sensible mobile keyboard, validation and clamping, clear empty-versus-zero distinction (an unrated album is _not_ 0.0), and a comfortable clearing gesture. Letterboxd's star control is explicitly **not** the model here.

**6.3 — The relisten marker.** A `×N` count on grid items plus an increment action on the album page. No film analogue. Should read as devotion, not as a statistic.

**6.4 — Collection entry states.** Our action card must resolve three states where Letterboxd resolves a watched/liked/rated triad:

| State                  | Primary action                                                     |
| ---------------------- | ------------------------------------------------------------------ |
| Not in collection      | **Add to collection** dominant; everything else secondary          |
| In collection, unrated | **Rate** dominant; relisten and review available                   |
| In collection, rated   | Score shown prominently; **relisten** becomes the recurring action |

The state machine differs from theirs and the card needs designing around it.

**6.5 — MusicBrainz fallback in search.** A result that isn't quite a result — an in-scope record we don't hold yet, addable in one click. Must read as a feature, not an error.

**6.6 — Thin-data states.** On-demand catalogue growth means many albums arrive with no ratings, no reviews, and often no artwork. **The artwork placeholder is a real deliverable** and may be the most-viewed component in the product's early life. Letterboxd, with a mature catalogue, barely has this problem; we will have it constantly.

---

## 7. Avoid — including the exact palette

Letterboxd's measured values, recorded so we can diverge deliberately:

| Role                            | Their value                    |
| ------------------------------- | ------------------------------ |
| Page ground                     | `#14181c` (≈39% of all pixels) |
| Navigation                      | `#13171b`                      |
| Surface / card                  | `#2c3440`                      |
| Raised panel                    | `#445566`                      |
| Chip                            | `#5d6874`                      |
| Green (ratings, primary action) | `#00ac1c` · `#00e054`          |
| Blue (links, lists)             | `#40bcf4`                      |
| Orange (likes)                  | `#ff8001`                      |

**We take the principle — a very dark, slightly cool ground with a small set of saturated accents — and none of the values.** Their green/orange/blue triad is strong branding and must not be echoed.

Also avoid: their Pro/Patron upsell surfaces, woven throughout the UI; their dated form styling; their denser statistics tables; the diary table as a layout (§5.3); and any microcopy lifted from their interface.

---

## 8. Visual identity direction

Decided: **dark-first, artwork-forward, distinct identity.**

- **The interface is a frame, not a picture.** Album art supplies nearly all saturated colour; chrome stays recessive.
- **A ground distinct from `#14181c`.** Warmer or genuinely neutral, rather than their blue-cool grey.
- **An accent that isn't green.** Their green is strongly associated; ours should read as its own product immediately.
- **Typography with more character than theirs**, which is functional but neutral — though never at the cost of density.
- **The square grid is the signature.** Leaning into the record-shelf reading is thematically right and instantly differentiating.
- **Density is a feature.** A 400-album collection must be browsable, not scrolled through.

---

## 9. Known gap

**No true phone-width capture.** The supplied mobile screenshot renders at roughly tablet width — it still shows the full horizontal nav and the three-column detail layout, merely compressed. **Collapse behaviour below ~768px is therefore unknown**, specifically: how the action panel relocates when there's no room for a third column, what the nav becomes, and how far grid density drops.

This is worth resolving before mobile layouts are built. Either a narrow capture (~390px) or, more usefully, designing our own mobile behaviour from first principles — album art being square changes the mobile calculus enough that borrowing may not help much anyway.

---

## 10. Verification approach for implementation

When UI work begins, per `docs/claude-code-playbook.md` §7: build, screenshot the implementation, compare against intent, iterate.

**Comparison is against our own design, never against Letterboxd.** The reference informs structure; pixel-matching it would be both wrong and a violation of §1's boundaries. Browser automation is not set up yet and becomes worth adding when there's a real UI to capture.

---

## 11. Implementation decisions derived from the reference

Recorded as the album detail page was built, and approved as the baseline other
detail surfaces follow. Each is a point where applying the reference literally
would have produced the wrong result for this product, so the divergence is
written down rather than left implicit in a component.

### 11.1 Square artwork uses a 200–240px detail column, not ~13%

§3 measured the reference's poster column at roughly **13%** of the page. That
proportion is calibrated to a **2:3 portrait** poster, which is tall enough to
carry a detail page at a narrow width. Album art is **1:1**, so the same 13% of
our 1120px content measure yields a ~145px square — too small to act as the
page's primary identity element.

**Decided: `minmax(200px, 240px)`**, roughly 21% of the content measure. This is
§5.1's square-artwork divergence arriving on the detail page. Anything narrower
made the cover read as a thumbnail rather than the subject.

### 11.2 Tracklists are set in Geist, not Newsreader

§4 borrows "serif for content, sans for chrome", and a tracklist is arguably
content. In practice it is **scanned, not read**, and it sits directly against
tabular figures for position and duration. Newsreader at 14px in a dense list
was measurably worse to scan.

**Decided: sans for tracklists**, with tabular figures and a right-aligned
position rail so single-disc `7` and multi-disc `1.12` share an edge. Newsreader
is reserved for the material that is genuinely read: titles and, from Phase 2,
review bodies.

### 11.3 Rating information sits in the right rail

The reference places its ratings histogram beside the action panel rather than
in the title block, and that placement transfers directly. Putting an average in
the identity block would interrupt the run from title to credit to metadata, and
would give the number more prominence than a product that deliberately avoids a
score-obsessed register should.

**Decided: average and rating count live in the right rail, beneath the action
card.** The identity block stays title, credit, metadata — nothing else.

### 11.4 The action card is capped below 1024px

Once the three-column layout collapses, the card has the full content measure
available and will take it. At 768px an uncapped card produced a 720px-wide
primary button, which reads as a banner rather than a control.

**Decided: `max-w-sm` below the three-column breakpoint, uncapped at and above
it.** On a phone the cap is wider than the viewport, so it has no effect there —
it exists solely for the tablet range.

### 11.5 Stacked grids are ranked by density, never by decoration

§3 records that the reference's browse page leads with four large posters and
then drops to a twelve-across strip, and that **size alone** carries the
importance — no badges, no ribbons. Browse originally ran both of its sections
at the same density, which meant the page said nothing about which one mattered.

Adopting the reference literally would have meant a bespoke four-poster row, and
building one would have produced a second grid implementation — the exact
outcome the single-source density ramp exists to prevent.

**Decided: where a page stacks more than one grid, the sections are ranked by
density drawn from the existing ramp — `relaxed` for the lead, `standard` for
what follows.** `dense` stays available for a third tier or for a surface that
is pure recognition. Importance is never signalled by a badge, a rule weight or
a colour.

**Captions travel with density rather than varying independently.** A title and
credit belong under `relaxed` cells and under no others: `standard` tops out
near 105px, where a caption is unreadable. A section that wants metadata has to
take the larger cell that pays for it. This is the same bargain the Detailed
collection mode strikes (decision D), applied to catalogue surfaces.

### 11.6 Stored artwork size follows grid density

Cover Art Archive offers three sizes and the pipeline stores all three — 250,
500 and 1200. Which one a grid draws from is a property of the **density**, not
of the page that happens to be rendering it.

A `relaxed` cell reaches 170–240px, which is 340–720 device pixels on the 2× and
3× displays most people are reading on. Serving the 250px asset there meant the
image optimiser was interpolating the largest cells in the product upward from a
smaller original.

**Decided: `relaxed` draws the 500px asset, `standard` and `dense` draw 250, and
detail pages draw 500.** 1200 stays reserved. Delivered bytes are effectively
unchanged — the optimiser emits the same rendered width either way; what changes
is whether that width was invented rather than photographed.

Recorded as a design rule rather than a delivery detail because on these
surfaces the artwork **is** the content (§8). A soft cover is not a performance
characteristic, it is a degraded product.

### 11.8 Grid surfaces take the `wide` container. The profile did not.

**Decided: every grid of covers renders in `wide`, including the profile's.**

§3 measured the reference's member films grid — named in §2 as our collection
view's closest analogue — at **~93% of viewport width**. `Container`'s `wide`
variant is `min(94vw, 1680px)`, which is that measurement. `content` is 1120px
and exists for reading measure.

The profile collection shipped in `content`, because the profile was an identity
surface before it held a grid and the container was never revisited when one
arrived. The cost was measured on staging rather than estimated:

| Surface            | Container | Density  | Cols @1440 | Cover @1440 |
| ------------------ | --------- | -------- | ---------- | ----------- |
| Browse — Popular   | `wide`    | relaxed  | 7          | ~175px      |
| Artist discography | `wide`    | relaxed  | 7          | ~175px      |
| Profile collection | `content` | standard | 11         | **83px**    |

`Container`'s own documentation warns that a twelve-across grid at 1120px yields
~78px cells, _"too small to recognise a cover by"_, and §11.5 puts the ceiling of
`standard` near 105px. At 83px the profile was rendering **below the floor this
document sets and 20% under the size its own density intends** — and the loss is
not subtle: twelve real covers occupy two thirds of one row and the record-shelf
reading disappears entirely.

The same density in `wide` yields ~105px, which is the intended figure. **The fix
is the container, not the density** — no new ramp value, and Browse and the
artist page are unaffected.

### 11.9 The collection grid carries state, not captions

§3 and §5.3 have been read as contradicting each other, and the tension is
recorded here so it is resolved once rather than rediscovered.

- **§3**, describing the reference: _"no titles, no captions, nothing but
  artwork — with tiny heart glyphs beneath liked entries as the only overlay."_
- **§5.3**, describing ours: _"a cover grid with sort and filter controls,
  per-item score, like indicator, and relisten marker."_

**They do not conflict.** §3 rules out **captions** — title and credit. §5.3
requires **state** — score, like, relisten. The reference itself carries state
(the heart glyphs) while carrying no captions, so both statements describe the
same object: artwork-forward, dense, with a minimal state overlay.

**Decided: the collection's default presentation is square artwork plus a state
line — score, like indicator and `×N` where each applies — and no title or
credit.**

This does not reopen §11.5. That decision ties **captions** to `relaxed` cells
because _"`standard` tops out near 105px, where a caption is unreadable"_, and it
is right: "Jay-Z & Kanye West" is not legible at 105px. A state line is not a
caption. `9.6`, a heart glyph and `×3` are three characters, a glyph and two
characters set in tabular figures — legible at 105px where a credit is not. The
bargain §11.5 strikes is that metadata must buy the cell that pays for it;
state costs one short line and pays for itself at the existing density.

**Consequence for `CollectionTile`.** Its Compact mode currently draws artwork
alone, which satisfies §3 and fails §5.3 — a profile that shows what someone
holds and nothing about what they think of it, which is the whole difference
between a collection and the catalogue. Compact gains the state line. Detailed
keeps its captions and stays in the design system and the gallery.

**This is a collection-context presentation, not a new global density.** No ramp
value is added and no catalogue surface changes.

### 11.7 A page title is serif only when it names something the catalogue holds

§4 borrows "serif for content, sans for chrome". That settles album titles and
review bodies but not **page titles**, which sit awkwardly between the two — the
album, artist and profile pages all set their `h1` in Newsreader, and applying
that by analogy would have made Browse's `h1` serif too.

The distinction that actually holds is what the heading _names_. An album title,
an artist name and a member's name are things the catalogue **holds**, and those
`h1`s are serif because the page is about that named thing. "Browse" names no
such thing — it is a word the interface supplies about itself.

**Decided: a page title takes Newsreader when it is the name of a catalogue
entity, and Geist when it is a navigational label.** On a wall of covers a serif
"Browse" would claim the heading is the content, when the content is the grid
beneath it.

**This is a rule about titles and chrome, not a ban on the serif elsewhere.**
Newsreader deliberately continues to carry the short editorial sentences that
front empty and pre-query states — "Search for a record.", "Your collection is
empty." — and the initials in cover placeholders and avatars. Those are register
choices already built into search, profile and `AlbumCover`, and they stand.

---

## 12. Surfaces that recorded direction will reopen

`docs/product-spec.md` §10 records decided-but-unbuilt product direction. Three pieces of it land on components this document already treats as settled, so they are flagged here to stop a future session marking those components finished.

**The action card gains a fourth toggle.** Want to Listen (§10.1) is a fifth user–album relation alongside collection, favourite, like and relisten. §3 measured the reference's card as three icon toggles — Watch, Like, Watchlist — and §11.4 already caps the card's width below 1024px. A Want to Listen control fits that borrowed pattern almost exactly, which is fortunate, but the card's five documented states in the development gallery describe collection state only. **They will need revisiting, not extending by analogy** — in particular, "not collected" is currently one state and would become two, since an album can plausibly be uncollected-and-wanted. Whether that state is even reachable is an unresolved product question (§10.1) and must not be answered by drawing it.

**The profile gains identity fields.** Photo and bio are already specified (§3, and `product-spec.md` §5); only city is new (§10.3). The current profile migration deliberately shows identity only, because no collection data exists. When those fields arrive the profile header composition is the thing that changes, not the collection grid.

**The artist page stops being thin, and eventually outgrows its own composition. [2026-08-23]** §5.4 of this document says the artist page is primary for us and that we design past the reference's thin filmography. **We had not** — 163 of 261 artists held exactly one album, so 62.5% of artist pages rendered a name, one cover, and neither the sort control nor the active span, both of which the page suppresses below two releases. Catalogue depth (`product-spec.md` §8.9) fixes the input, not the composition.

**At the immediate boundary the composition holds.** Albums, EPs and mixtapes put a major artist at roughly ten to twenty items, which the `relaxed` captioned grid and `product-spec.md` §6's interleaved chronological run were designed for and have simply never been shown. **The first honest test of §5.4's claim is still ahead of us**, and the grid should not be judged finished until a genuinely deep discography has been looked at.

**The long-term direction breaks it.** If depth later admits live albums and compilations, sixty items interleaved chronologically with eighteen albums is not a readable run, and §6's "never grouped by type" **[DECIDED]** reopens — alongside `product-spec.md` §5's "richer artist pages: grouping by type", which already says the opposite. **That conflict is recorded, not resolved, and must not be pre-emptively designed.**

**None of these is a design task yet.** All depend on product questions that `product-spec.md` §10 and §8.9 require be asked rather than inferred, and a design that answers them by drawing them is the same failure as code that answers them by implementing them.

Taste overlap (§10.2) and messaging (§10.4) have **no design work recorded at all**, deliberately — messaging in particular is blocked on a legal precondition, and sketching an inbox would imply a shape the safety architecture has not earned yet.
