# longplayr — Design Reference

**Status: pass 2 complete for desktop.** Written from analysis of 13 supplied screenshots of the live Letterboxd site, not from description. One gap remains — see §9.

**Scope and boundaries.** Letterboxd is a reference for _structure, information hierarchy, and interaction_. It is not a source for visual identity. No Letterboxd branding, palette, typography, copy, iconography, or assets are reproduced. §7 records their exact colour values specifically so we can diverge from them deliberately rather than accidentally landing nearby.

---

## Contents

- [1. The framing that governs everything below](#1-the-framing-that-governs-everything-below) · 100 words
- [2. What was analysed](#2-what-was-analysed) · 152 words
- [3. Measured observations](#3-measured-observations) · 674 words
- [4. Borrow](#4-borrow) · 245 words
- [5. Adapt](#5-adapt) · 446 words
- [6. Where we design from scratch](#6-where-we-design-from-scratch) · 307 words
- [7. Avoid — including the exact palette](#7-avoid--including-the-exact-palette) · 152 words
- [8. Visual identity direction](#8-visual-identity-direction) · 116 words
- [9. Known gap](#9-known-gap) · 106 words
- [10. Verification approach for implementation](#10-verification-approach-for-implementation) · 65 words
- [11. Implementation decisions derived from the reference](#11-implementation-decisions-derived-from-the-reference) · 3,582 words
- [12. Surfaces that recorded direction will reopen](#12-surfaces-that-recorded-direction-will-reopen) · 510 words

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

### 11.11 Which section leads is a separate decision from how leading is expressed **[DECIDED 2026-09-13]**

**11.5 settled how a lead is signalled — density, never decoration — and said nothing about which section deserves it.** Browse assigned `relaxed` to Popular, and that assignment was never examined as a decision. This examines it.

**Decided: Recently added takes the lead — `relaxed`, captioned — and Popular becomes the `standard`, caption-free secondary strip. Home's single discovery section follows the same choice.** 11.5's mechanism is unchanged and is used exactly as written.

**Why, measured rather than felt.** Browse Popular is an internal chart with an external top-up. On the deployed database the internal chart held **7 rows against a caller limit of 24**, so **the lead section was roughly 70% external ListenBrainz fill, ordered by how mainstream each record is.** The front page was not accidentally mass-market; it was sorted that way. Meanwhile **the curated tranche, being recent, sat in the quieter strip** — the hierarchy was inverted relative to the catalogue's own identity.

**Recency is not a quality signal, and this decision does not claim it is.** At 948 albums and 4 profiles, _recent_ happens to be _curated_, which is why this works now and is not a permanent ranking principle. **It is a cold-start treatment with an exit: it reopens when the internal chart reaches §8.3's floor of 20 from real activity.** Recorded that way so it is revisited on a measurement rather than on taste.

**Nothing about composition changes.** §8.3's external fill and its floor of 20 are untouched, `getPopularAlbums` is unchanged, and no catalogue row is added, reordered or removed. **Capping the fill was considered and rejected**: with 7 internal rows, Popular would render seven cells on a 948-album catalogue, which reads as broken rather than as honest.

**The exit condition narrowed on 2026-09-16, and half of this decision became permanent.** The paragraph above frames the whole arrangement as a cold-start treatment that reopens at twenty internal entries. `product-spec.md` §8.3 has since decided that **an external popularity score never orders a lead section** — not "not yet", but never.

**So the trigger survives and what it can restore does not.** This may still reopen when the internal chart reaches §8.3's floor of twenty, and **what would then take the lead is longplayr's own engagement data.** The **external fill can never take the lead back**, whatever the chart does. Recorded here rather than left to be reconciled, because this section is where a future reader will come looking for the exit and would otherwise read it as unconditional.

### 11.12 A caption's credit is a link, and the tile link makes room for it **[DECIDED 2026-09-15]**

**11.5 ties captions to `relaxed` cells and says what a caption may contain. It does not say whether any of it is clickable, and the answer turned out to be structural rather than cosmetic.**

**The obstacle.** `AlbumGrid` wraps the cover **and the whole caption** in one anchor to the album. An `<a>` inside an `<a>` is invalid HTML, so a credit link could not simply be nested — the caption had to leave the anchor first. This is why an apparently one-line change touches the most-visited component in the product.

**Decided: the album anchor wraps the cover and the title; the credit line sits outside it as its own element, carrying one link per credited artist.** The year line stays outside with the credit.

**What this costs, stated rather than discovered later.** The cell stops being one uniform album target — the credit strip now goes somewhere else, which is the entire point, but it does mean **the tile is no longer clickable-anywhere.** `CollectionTile` records "the whole tile is a link" as a property that was missing _"for far longer than it should have been"_, so this is a deliberate partial retreat from it and not a regression to be repaired later.

**Title hover is unaffected.** The `group` marker stays on the anchor and the title stays inside it, so `group-hover:underline` behaves exactly as before. Hovering the credit no longer underlines the title, which is correct: the two now lead to different pages.

**The stretched-link alternative was considered and rejected.** Making the anchor cover the cell via `::after` and floating the credit above it in stacking order would have preserved a large uniform album target using real anchors. It was rejected because the hit-testing becomes something a future reader has to reconstruct from two positioned pseudo-elements, and this grid is the one place in the product where that cost is paid on every surface at once. **Density and legibility are unchanged; only what is inside the anchor moved.**

**The artist page's suppression rule changes meaning, and this is where that shows. [2026-09-15]** `creditFor` suppresses a credit equal to the page's own artist. With the credit rendered from the relation rather than from `display_credit`, **the comparison becomes one of identity rather than of two strings that happened to differ** — so an album by a renamed artist, which previously rendered a credit because the cached string and the current name disagreed, is now correctly recognised as being by that same artist and suppressed. **That is the decided behaviour and not a defect**, and `product-spec.md` §6 records what it costs.

**The search result row takes the same treatment, and it is a different shape. [2026-09-15]** That row is a **flex** layout rather than a stacked caption, and the whole of it — cover, title and metadata line — was one anchor to the album. Lifting the credit out therefore **restructures the row** rather than merely re-nesting it: the cover and the title each become their own anchor, and the metadata line sits beside them as a sibling.

**The consequence is the same one, and it lands harder here.** A result row stops being clickable anywhere, and a list of results is scanned and clicked more freely than a grid of covers. **It is accepted for consistency**: the same album must not behave differently depending on which surface found it, and the credit genuinely leads somewhere else now. The stretched-link alternative was rejected a second time, on the reasoning already recorded above.

**A multi-artist credit becomes several links inside a truncated single line**, and that is accepted under 11.5's existing bargain — metadata buys the cell that pays for it, and `relaxed` is the only density that carries a caption at all. **No new control is added to a tile**, so §10.6's warning about how many controls a tile can carry before the record-shelf reading breaks is not engaged: a link on text that was already printed is not a control.

### 11.6 Stored artwork size follows grid density

Cover Art Archive offers three sizes. Which one a grid draws from is a property
of the **density**, not of the page that happens to be rendering it.

**[CORRECTED 2026-09-13 — this paragraph said the pipeline stores all three, which
stopped being true the previous day.]** `f68e050` dropped **1200** because nothing
requested it; `ARTWORK_SIZES` is `[250, 500]`. **Both sizes this decision names
are still stored, so the rule below is unaffected** — and `architecture.md` §7
records that a dropped size is deferred rather than foreclosed, since artwork is
re-fetchable from Cover Art Archive at will.

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

### 11.10 Image loading priority follows grid density too — and no grid gets a length boundary

**[DECIDED 2026-09-06. Approved scope; not implemented.]** Two questions
`current-state.md` §11 has carried against §8, taken together because they are
the same kind of question about the same surfaces. §11.6 above established that
_which asset_ a grid draws is a property of density rather than of the page; the
first decision here says the same of _when_ it loads.

#### The rule

**`AlbumGrid` marks the leading cells of one row at its narrowest breakpoint as
`priority`: two for `relaxed`, three for `standard`, four for `dense`.**

**The number is derived, not chosen.** It is each density's base column count
from the ramp §11.5 records — `relaxed` opens at two across, `standard` at
three, `dense` at four — so it stays correct if the ramp ever moves, and no new
number enters the system.

**One row at the narrowest breakpoint rather than the widest, deliberately.**
`priority` exists to mark the LCP element, and the first cell in DOM order is
top-left at every breakpoint, so a small leading set covers the LCP candidate on
every viewport. Marking a first row at the widest breakpoint instead — eight
cells at `relaxed`, twelve at `standard` — would guarantee above-the-fold
coverage but over-mark on a phone, where only the opening row is visible and
where a slow connection makes the cost highest. **A browser deprioritises when
everything is high**, so over-marking defeats the mechanism it is reaching for.

**The accepted cost:** on a wide viewport, cells past the opening row stay lazy
although they are above the fold. That is ordinary `next/image` behaviour and is
not what the recorded evidence — Next flagging the first Popular cover as LCP —
is about.

#### Where it applies, and where it stops

**Every `AlbumGrid` instance**, because the decision is a property of how a grid
loads rather than of what a surface wants: Home's discovery section, Browse's
Popular and Recently added, the list page and the artist discography. Expressed
**inside `AlbumGrid`** rather than at each call site, so the surfaces cannot
drift apart. `AlbumCover` already accepts and forwards `priority`; **no new
abstraction is created and no density, breakpoint, cell size or asset size
changes.**

**It stops at the `AlbumGridShell` consumers that build their own cells** —
`CollectionGrid`, `FavouriteRow` and the design gallery. Reaching those means
editing the collection and profile surfaces, and **no LCP evidence has been
recorded for either.** That residue is open, not scope.

#### No length boundary, and why the recorded trigger has not fired

**No length boundary is introduced at any width on any surface.** No "show
more", no shorter chart at narrow widths, no responsive hiding of surplus cells,
no query-limit change and no per-breakpoint density. Home and Browse keep their
counts, composition, ordering and captions exactly as they are.

`current-state.md` §8 measured Browse at **8,122px on a 390px viewport** and
recorded it as **"observation, not a defect"**, deferring the question to when
"the real charts arrive **and** a 'show more' boundary has to be decided
anyway". **The charts arrived; the second half did not.** Nothing in the product
requires a show-more, and the only thing that would is a decided browsing model
— `product-spec.md` §8.9's deferred F-005 question, which that section says must
not "be answered by implementation under pressure". **Introducing a boundary now
would answer part of it by implication.**

§8 also named the two alternatives it declined: changing the query limit, or
inventing a per-breakpoint density. **Hiding surplus cells responsively is the
second wearing different clothes**, and it would additionally make Browse's
section-header count untrue, since that count reflects what was fetched.

**What would reverse this:** a measurement showing the height costs readers
something, or F-005 being decided. Both are outside this decision.

#### What stays open

- **Whether the discovery surfaces ever need a length boundary.** Restated above
  rather than answered; the trigger is now precise.
- **What Browse's Popular and Recently added counts should be as product
  decisions.** `product-spec.md` §8.3 records that Browse's limit "is not a
  product decision and never was — it is a grid default shared verbatim with
  Recently added". **Choosing a different number without evidence that any
  particular number reads better would be invention**, so the numbers stand and
  the question stands with them.
- **Whether `FavouriteRow` and `CollectionGrid` should carry the rule**, pending
  LCP evidence for the profile and collection surfaces.
- **Whether this document should eventually carry a full Home surface entry.**
  `product-spec.md` §6 now defines what Home is; its visual treatment belongs
  here and is absent. **Deliberately not written in this cycle**: an entry saying
  only how images load would be a stub, and a fuller one would mean deciding
  Home's density, captions and count, which is a design pass rather than a
  documentation correction.

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
