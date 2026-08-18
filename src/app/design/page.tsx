import { notFound } from 'next/navigation';

import { ActionCard, type ActionCardState } from '@/components/ActionCard';
import { AlbumCover } from '@/components/AlbumCover';
import { AlbumGridShell } from '@/components/AlbumGrid';
import { CollectionGrid } from '@/components/CollectionGrid';
import { Container } from '@/components/Container';
import { ScoreBadge } from '@/components/ScoreBadge';
import { SectionHeader } from '@/components/SectionHeader';

import { GALLERY_ALBUMS } from './fixtures';

/**
 * The design foundation, made inspectable.
 *
 * **Development only.** This is a working surface for reviewing tokens,
 * geometry and component states against real artwork — not a product route. It
 * 404s outside development so it can never be reached in a deployed
 * environment, and it is excluded from the sitemap by simply not existing there.
 *
 * Verification method per docs/design-reference.md §10: build it, screenshot
 * it, compare against intent, iterate. Comparison is against our own design —
 * never against the structural reference.
 */

export const dynamic = 'force-static';

const INK = [
  ['--ink-950', 'bg / page ground'],
  ['--ink-900', 'surface / card'],
  ['--ink-850', 'raised panel'],
  ['--ink-800', 'chip'],
  ['--ink-700', 'border'],
  ['--ink-600', 'border-strong'],
  ['--ink-500', 'text-faint'],
  ['--ink-400', 'text-text-muted'],
  ['--ink-300', '—'],
  ['--ink-200', 'text-secondary'],
  ['--ink-100', '—'],
  ['--ink-50', 'text'],
] as const;

const BRASS = [
  ['--brass-300', 'accent-strong'],
  ['--brass-400', 'accent-hover / like'],
  ['--brass-500', 'accent'],
  ['--brass-600', '—'],
  ['--brass-700', 'accent-dim'],
] as const;

const TYPE_SCALE = [
  ['text-5xl', '3.25rem', 'Display'],
  ['text-4xl', '2.5rem', 'Page title'],
  ['text-3xl', '1.875rem', 'Album title'],
  ['text-2xl', '1.5rem', 'Section title'],
  ['text-xl', '1.25rem', 'Subhead'],
  ['text-lg', '1.125rem', 'Lead'],
  ['text-base', '1rem', 'Body'],
  ['text-sm', '0.875rem', 'UI default'],
  ['text-xs', '0.75rem', 'Labels, metadata'],
] as const;

const SPACING = [1, 2, 3, 4, 6, 8, 12, 16, 20, 24] as const;

const ACTION_STATES: [string, string, ActionCardState][] = [
  ['Signed out', 'No session. Invites sign-in rather than failing.', { kind: 'signed-out' }],
  [
    'Onboarding required',
    'Authenticated, no profile row. Decision E — no mutation is offered.',
    { kind: 'onboarding-required' },
  ],
  [
    'Not in collection',
    'Add is dominant; rate and like add implicitly.',
    { kind: 'not-collected' },
  ],
  [
    'Collected, unrated',
    'Rate becomes dominant — the obvious next act.',
    { kind: 'collected-unrated', relistens: 1 },
  ],
  [
    'Collected, rated',
    'Score leads; relisten becomes the recurring action.',
    { kind: 'collected-rated', score: 9.4, liked: true, relistens: 3 },
  ],
];

function Swatch({ token, role }: { token: string; role: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-10 w-10 shrink-0 rounded-sm border border-border"
        style={{ background: `var(${token})` }}
      />
      <div className="min-w-0">
        <p className="truncate font-mono text-xs text-text-secondary">{token}</p>
        <p className="truncate text-xs text-text-muted">{role}</p>
      </div>
    </div>
  );
}

function Block({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 py-10">
      <SectionHeader>{title}</SectionHeader>
      {note && <p className="mb-5 max-w-[60ch] text-sm text-text-muted">{note}</p>}
      {children}
    </section>
  );
}

export default function DesignPage() {
  // Never reachable outside development.
  if (process.env.NODE_ENV === 'production') notFound();

  const gridSample = GALLERY_ALBUMS;

  return (
    <Container variant="wide" className="py-10">
      <header className="mb-4">
        <p className="text-xs uppercase tracking-widest text-accent">Development only</p>
        <h1 className="mt-2 font-serif text-4xl leading-tight">Design foundation</h1>
        <p className="mt-3 max-w-[60ch] text-sm text-text-muted">
          Tokens, geometry and component states against real staging artwork. Point the dev server
          at staging to see covers; against a local database the images will 404 and every tile
          falls back to the placeholder.
        </p>
      </header>

      <Block
        id="colour"
        title="Colour"
        note="A warm-neutral ground rather than the blue-cool grey of the structural reference, with brass as the accent. Album art supplies nearly all saturated colour; the interface stays recessive."
      >
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <p className="mb-3 text-xs uppercase tracking-widest text-text-muted">
              Ink — warm neutral
            </p>
            <div className="grid grid-cols-2 gap-3">
              {INK.map(([token, role]) => (
                <Swatch key={token} token={token} role={role} />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-3 text-xs uppercase tracking-widest text-text-muted">Brass — accent</p>
            <div className="grid grid-cols-2 gap-3">
              {BRASS.map(([token, role]) => (
                <Swatch key={token} token={token} role={role} />
              ))}
            </div>
            <p className="mb-3 mt-8 text-xs uppercase tracking-widest text-text-muted">Signal</p>
            <Swatch token="--oxblood-500" role="danger" />

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-accent-contrast"
              >
                Primary action
              </button>
              <button
                type="button"
                className="rounded-sm border border-border bg-raised px-4 py-2 text-sm text-text-secondary"
              >
                Secondary
              </button>
              <button
                type="button"
                className="rounded-sm border border-accent-dim bg-bg px-4 py-2 text-sm text-accent"
              >
                Active state
              </button>
            </div>
          </div>
        </div>
      </Block>

      <Block
        id="type"
        title="Typography"
        note="Newsreader for editorial content, Geist Sans for chrome — writing feels like writing, controls feel like controls. Numerals are tabular wherever they sit in a column."
      >
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <p className="mb-4 text-xs uppercase tracking-widest text-text-muted">
              Scale — sans (chrome)
            </p>
            <div className="space-y-3">
              {TYPE_SCALE.map(([cls, rem, role]) => (
                <div key={cls} className="flex items-baseline gap-4 border-b border-border/50 pb-2">
                  <span className={`${cls} min-w-0 flex-1 truncate`}>Kind of Blue</span>
                  <span className="shrink-0 font-mono text-xs text-text-muted">{cls}</span>
                  <span className="tabular w-16 shrink-0 text-right text-xs text-text-faint">
                    {rem}
                  </span>
                  <span className="hidden w-28 shrink-0 text-xs text-text-muted sm:block">
                    {role}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-4 text-xs uppercase tracking-widest text-text-muted">
              Serif — editorial
            </p>
            <h3 className="font-serif text-3xl leading-tight">The Dark Side of the Moon</h3>
            <p className="mt-1 text-sm text-text-muted">Pink Floyd · 1973</p>
            <p className="mt-5 max-w-[62ch] font-serif text-base leading-[1.65] text-text-secondary">
              Forty years on it still sounds like it was assembled rather than played — every
              transition load-bearing, every silence deliberate. What surprises is how warm it is
              underneath the engineering. The record is famous for its precision, but precision is
              not the reason anyone keeps returning to it.
            </p>
            <p className="mt-3 max-w-[62ch] font-serif text-base italic leading-[1.65] text-text-muted">
              Italic, for emphasis inside a review body.
            </p>
            <p className="mt-6 text-xs text-text-faint">
              Body measure above is capped at 62ch — reviews are short by nature.
            </p>
          </div>
        </div>
      </Block>

      <Block
        id="spacing"
        title="Spacing"
        note="A 4px base, adopting Tailwind's scale rather than inventing one. Semantic layout tokens sit on top for page padding, section rhythm and grid gutters."
      >
        <div className="space-y-2">
          {SPACING.map((step) => (
            <div key={step} className="flex items-center gap-4">
              <span className="tabular w-10 shrink-0 text-xs text-text-muted">{step}</span>
              <span className="tabular w-14 shrink-0 text-xs text-text-faint">{step * 4}px</span>
              <div className="h-3 bg-accent-dim" style={{ width: `${step * 4}px` }} />
            </div>
          ))}
        </div>
      </Block>

      <Block
        id="containers"
        title="Containers"
        note="Two widths, kept explicit. A twelve-across grid and a readable text measure cannot be the same number, so grids get their own container rather than shrinking to fit prose."
      >
        <div className="space-y-4">
          <div className="rounded-sm border border-dashed border-border-strong p-3">
            <p className="mb-2 font-mono text-xs text-text-muted">
              content — 1120px · album, artist, review, settings
            </p>
            <div className="h-8 max-w-[var(--width-content)] rounded-sm bg-raised" />
          </div>
          <div className="rounded-sm border border-dashed border-border-strong p-3">
            <p className="mb-2 font-mono text-xs text-text-muted">
              wide — min(94vw, 1680px) · grid surfaces
            </p>
            <div className="h-8 max-w-[var(--width-wide)] rounded-sm bg-accent-dim" />
          </div>
        </div>
      </Block>

      <Block
        id="grid"
        title="Grid geometry"
        note="Density is defined once, in AlbumGrid. The ramp lands on twelve columns at desktop; cell size stays near-constant across breakpoints and it is the column count that changes. Resize the window to walk the ramp: 3 → 4 → 5 → 7 → 9 → 11 → 12."
      >
        <p className="mb-3 text-xs uppercase tracking-widest text-text-muted">Standard density</p>
        <AlbumGridShell density="standard">
          {gridSample.map((a) => (
            <li key={a.mbid}>
              <AlbumCover
                mbid={a.mbid}
                title={a.title}
                hasArtwork={a.hasArtwork}
                px={160}
                size={250}
              />
            </li>
          ))}
        </AlbumGridShell>

        <p className="mb-3 mt-10 text-xs uppercase tracking-widest text-text-muted">
          Dense — one step tighter
        </p>
        <AlbumGridShell density="dense">
          {gridSample.map((a) => (
            <li key={a.mbid}>
              <AlbumCover
                mbid={a.mbid}
                title={a.title}
                hasArtwork={a.hasArtwork}
                px={120}
                size={250}
              />
            </li>
          ))}
        </AlbumGridShell>
      </Block>

      <Block
        id="cover"
        title="Cover and placeholder"
        note="Square, 2px radius so covers read as objects rather than buttons, hairline border so pale artwork does not bleed into the ground. The placeholder is a real deliverable — with a thin catalogue it may be among the most-viewed components in the product."
      >
        <div className="flex flex-wrap items-end gap-6">
          {[64, 96, 140, 200, 260].map((px) => (
            <div key={px} style={{ width: px }}>
              <AlbumCover
                mbid="b1392450-e666-3926-a536-22c65f834433"
                title="OK Computer"
                hasArtwork
                px={px}
                size={px > 150 ? 500 : 250}
              />
              <p className="tabular mt-2 text-xs text-text-muted">{px}px</p>
            </div>
          ))}
        </div>

        <p className="mb-3 mt-10 text-xs uppercase tracking-widest text-text-muted">
          Placeholder — deterministic tint, hue from the MBID
        </p>
        <div className="flex flex-wrap items-end gap-6">
          {[
            ['f6b1b900-6108-32f0-abbd-2855af9151eb', 'Remain in Light'],
            ['19e7c9f3-7c4c-3a56-ba50-4156b39f76ca', 'Rust in Peace'],
            ['00000000-0000-4000-8000-0000000000aa', 'Selected Ambient Works'],
            ['11111111-1111-4111-8111-111111111111', 'Untitled'],
          ].map(([mbid, title]) => (
            <div key={mbid} style={{ width: 140 }}>
              <AlbumCover mbid={mbid} title={title} hasArtwork={false} px={140} />
              <p className="mt-2 truncate text-xs text-text-muted">{title}</p>
            </div>
          ))}
        </div>
      </Block>

      <Block
        id="score"
        title="Score"
        note="Monochrome by decision — never tinted by value. A green-to-red ramp is the grammar of score-obsessed discourse, and this product is meant to push against that. Your score carries the accent because it is a statement; the average stays neutral because it is a fact. Unrated renders nothing: 0.0 is a real score."
      >
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <p className="mb-4 text-xs uppercase tracking-widest text-text-muted">
              Your score — chip
            </p>
            <div className="flex flex-wrap items-center gap-6">
              {(['sm', 'md', 'lg'] as const).map((size) => (
                <div key={size} className="flex flex-col items-start gap-2">
                  <ScoreBadge score={8.7} variant="user" size={size} />
                  <span className="font-mono text-xs text-text-faint">{size}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {[10.0, 9.4, 7.5, 5.0, 0.0].map((s) => (
                <ScoreBadge key={s} score={s} variant="user" size="md" />
              ))}
              <span className="text-xs text-text-faint">
                ← 0.0 is a score. Unrated renders nothing →
              </span>
              <ScoreBadge score={null} variant="user" size="md" />
            </div>
          </div>

          <div>
            <p className="mb-4 text-xs uppercase tracking-widest text-text-muted">
              Album average — bare numeral
            </p>
            <div className="space-y-5">
              <ScoreBadge score={8.4} variant="average" size="lg" count={126} />
              <div>
                <ScoreBadge score={8.4} variant="average" size="md" count={126} />
              </div>
              <div>
                <ScoreBadge score={9.0} variant="average" size="sm" count={3} />
              </div>
            </div>
            <p className="mt-6 max-w-[46ch] text-xs text-text-faint">
              Size and container separate the two, not colour. The average is the loudest thing on
              an album page by scale alone, with no box competing with the artwork.
            </p>
          </div>
        </div>
      </Block>

      <Block
        id="action-card"
        title="Action card — five states"
        note="The spec names three collection states. The real set includes two that precede them: signed out, and authenticated without a profile. That second one exists because collection rows reference profiles(id), and Phase 1 already shipped a silent failure from exactly that gap. Every control here is inert."
      >
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-5">
          {ACTION_STATES.map(([label, note, state]) => (
            <div key={label}>
              <p className="mb-1 text-xs font-medium uppercase tracking-widest text-accent">
                {label}
              </p>
              <p className="mb-3 min-h-[3.5rem] text-xs leading-relaxed text-text-muted">{note}</p>
              <ActionCard state={state} />
            </div>
          ))}
        </div>
      </Block>

      <Block
        id="collection"
        title="Collection grid — two modes"
        note="Decided: a user density toggle. Compact is the default, keeping the primary browsing experience an artwork-led record shelf; Detailed is an explicit opt-in for more information on screen. Detailed also relaxes the column ramp, because a title under a 105px cell is unreadable — adding metadata has to buy the room it needs rather than cram."
      >
        <div className="space-y-12">
          <div>
            <div className="mb-3 flex flex-wrap items-baseline gap-3">
              <h3 className="text-sm font-medium text-accent">Compact — default</h3>
              <p className="text-xs text-text-muted">
                Artwork only. Nothing burned into the cover; the wall reads uninterrupted.
              </p>
            </div>
            <CollectionGrid albums={gridSample} mode="compact" />
          </div>

          <div>
            <div className="mb-3 flex flex-wrap items-baseline gap-3">
              <h3 className="text-sm font-medium text-accent">Detailed — opt in</h3>
              <p className="text-xs text-text-muted">
                Hierarchy held deliberately: artwork, then title and credit, then collection state
                as the quietest line.
              </p>
            </div>
            <CollectionGrid albums={gridSample} mode="detailed" />
          </div>

          <p className="max-w-[68ch] text-xs leading-relaxed text-text-faint">
            Rejected and deleted rather than carried forward: gradient overlays burned onto the
            artwork, a permanent indicator band beneath every tile, and hover-reveal as a layout.
            Hover may later enhance Detailed, but collection state must never depend on it — on a
            touch device that would make it unknowable.
          </p>
        </div>
      </Block>
    </Container>
  );
}
