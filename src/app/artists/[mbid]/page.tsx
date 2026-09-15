import { after } from 'next/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AlbumGrid } from '@/components/AlbumGrid';
import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { expansionStateFor } from '@/services/catalogue/artist-depth';
import { drainJobs } from '@/services/catalogue/jobs';
import { enqueueJob, DEFAULT_JOB_PRIORITY } from '@/services/catalogue/queue';
import { getArtistByMbid, type DiscographySort } from '@/services/catalogue/queries';

/**
 * Artist page — the canonical discography composition.
 *
 * Where the album page is a detail surface, this is a **browse** surface, so it
 * takes the wide container and the grid is the page rather than a section of
 * it. The reference under-serves us badly here: its director page is a thin
 * filmography because filmography is not how people browse film, whereas
 * discography is exactly how people browse music (design-reference.md §5.4).
 *
 * The discography is one interleaved chronological run, newest first — albums,
 * EPs and mixtapes together, never grouped by type (product-spec.md §6). That
 * ordering is done in the query and deliberately not re-sorted here.
 *
 * **Sorting is by release date only.** Newest first by default, oldest first on
 * request, and undated releases stay last either way. Sorting by rating, and an
 * artist-level aggregate rating, are **deferred** — `product-spec.md` §6 carried
 * both as `[INFERRED]` on the stated premise that they would reuse the
 * collection view's sort machinery. That machinery does not exist, so the
 * premise did not hold, and the question was resolved in favour of date alone
 * rather than built around.
 */

export async function generateMetadata({ params }: PageProps<'/artists/[mbid]'>) {
  const { mbid } = await params;
  const artist = await getArtistByMbid(mbid);
  if (!artist) return { title: 'Not found · longplayr' };
  return { title: `${artist.name} · longplayr` };
}

/**
 * `?sort=` is user input and arrives as anything at all.
 *
 * Anything that is not `oldest` resolves to the default rather than erroring —
 * the same shape as `pageFrom` on the collection destination, and for the same
 * reason: a malformed sort is not worth a 404.
 */
function sortFrom(value: string | string[] | undefined): DiscographySort {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'oldest' ? 'oldest' : 'newest';
}

/**
 * Newest / Oldest, as two links rather than a control with state.
 *
 * The page is server-rendered and the sort lives in the URL, so this needs no
 * client component: each option is the address of the page sorted that way, and
 * the browser's own back button moves between them.
 *
 * Newest is the default, so it is the bare address — the same convention page
 * one uses on the collection destination, where `?page=1` is never written.
 */
function DiscographySortLinks({ mbid, sort }: { mbid: string; sort: DiscographySort }) {
  const options: { value: DiscographySort; label: string; href: string }[] = [
    { value: 'newest', label: 'Newest', href: `/artists/${mbid}` },
    { value: 'oldest', label: 'Oldest', href: `/artists/${mbid}?sort=oldest` },
  ];

  return (
    <span className="flex items-baseline gap-3">
      {options.map((option) =>
        option.value === sort ? (
          <span key={option.value} aria-current="true" className="text-accent">
            {option.label}
          </span>
        ) : (
          <Link
            key={option.value}
            href={option.href}
            className="text-text-muted underline decoration-border-strong underline-offset-4 transition-colors hover:text-text"
          >
            {option.label}
          </Link>
        ),
      )}
    </span>
  );
}

/** Earliest and latest dated release, when there are enough to describe a span. */
function activeSpan(dates: (string | null)[]): string | null {
  const years = dates
    .filter((d): d is string => Boolean(d))
    .map((d) => d.slice(0, 4))
    .sort();
  if (years.length < 2) return null;
  const [first, last] = [years[0], years[years.length - 1]];
  return first === last ? first : `${first}–${last}`;
}

export default async function ArtistPage({ params, searchParams }: PageProps<'/artists/[mbid]'>) {
  const { mbid } = await params;
  const sort = sortFrom((await searchParams).sort);
  const artist = await getArtistByMbid(mbid, sort);

  if (!artist) notFound();

  /*
   * On-demand depth (`product-spec.md` §8.9, `[DECIDED 2026-09-07]`).
   *
   * 62.5% of artists held exactly one album, against a Phase 1 criterion that
   * promises browsing a discography. Opening an artist longplayr has not
   * expanded enqueues one — **once per artist, ever**. The state is derived
   * from job history rather than a column, because `artists` has none and this
   * slice adds no migration.
   *
   * **Never awaited.** A browse costs a rate-limited request per hundred
   * release groups, and the page renders from what is already held; the rest
   * arrives on a later view. Same shape as the album page's hydration trigger.
   *
   * **Any view drains, not only the first.** This block was gated on `start`,
   * so every later view did nothing at all and refreshing could not help by
   * construction — a job that had failed its attempts, or that sat behind
   * others, waited for a *different* artist's first view or for the daily
   * cron. The album page has always run on **every** view of a pending album;
   * the artist page was the outlier, and that was not deliberate.
   * `architecture.md` §7, *A later view drains too*.
   */
  const expansion = await expansionStateFor(mbid);

  /*
   * **Enqueue on `start` and `outstanding` only — never on `failed`.**
   * Re-enqueueing a terminally failed expansion from a page view would restart
   * the three-attempt retry policy on every visit; the recovery sweep owns that
   * retry, behind a 24-hour cooling-off. The status line below *does* speak for
   * `failed`, and that divergence is deliberate — `artist-depth.ts`.
   */
  if (expansion === 'start' || expansion === 'outstanding') {
    after(async () => {
      try {
        /*
         * **Background priority, and that is the one deliberate difference
         * from the album page.** A tracklist is wanted on the page being read
         * now; a discography benefits a *later* view, so it must never be
         * claimed ahead of interactive work — the claim orders `priority asc`,
         * and interactive is 10 against this 100.
         *
         * Draining anyway is what makes "a later view" mean minutes rather
         * than tomorrow: the cron runs daily on this plan. Because the claim
         * is priority-ordered, this unit of capacity may well execute someone
         * else's interactive job first, which is the correct outcome.
         *
         * Safe under concurrent first views, **and on every later view**: the
         * partial unique index on (kind, target_mbid) rejects the second
         * insert and `enqueueJob` treats that rejection as success. So the
         * enqueue needs no second condition — one path serves both states,
         * which is how the album page is written too.
         *
         * **The drain is the part a later view is here for**, and it claims
         * the *oldest* ready job rather than this artist's: the claim has no
         * target filter. A reader behind a backlog therefore refreshes more
         * than once. A target-filtered claim is the recorded escalation and
         * costs a migration.
         */
        await enqueueJob('discover_curated_artist', mbid, { priority: DEFAULT_JOB_PRIORITY });
        await drainJobs(1);
      } catch {
        // Swallowed, exactly as the album page swallows its own: the reader
        // never asked for this work, and failing here would turn a rendered
        // page into an error. `ingestion_jobs` owns retry and error state.
      }
    });
  }

  const count = artist.albums.length;
  const span = activeSpan(artist.albums.map((a) => a.first_release_date));

  return (
    <Container variant="wide">
      <header className="border-b border-border pb-6">
        <h1 className="font-serif text-3xl leading-[1.15] text-text sm:text-4xl">{artist.name}</h1>

        {artist.disambiguation && (
          <p className="mt-2 text-base text-text-secondary">{artist.disambiguation}</p>
        )}

        <p className="mt-3 text-sm text-text-muted">
          {artist.type ?? 'Artist'} · {count} {count === 1 ? 'release' : 'releases'}
          {span && <> · {span}</>}
        </p>
      </header>

      <section className="mt-8">
        {/*
         * The sort takes the trailing slot, which exists for exactly one
         * right-aligned affordance. The bare count that sat here is not lost —
         * the page header two lines above already reads "N releases", so it was
         * saying the same thing twice.
         */}
        <SectionHeader
          trailing={count > 1 ? <DiscographySortLinks mbid={mbid} sort={sort} /> : undefined}
        >
          Discography
        </SectionHeader>

        {/*
         * Captions are on, and the density relaxed to make room for them. This
         * follows the collection grid's Detailed convention: metadata has to buy
         * the space it needs rather than being crammed under a shelf-density
         * cell. It matters more here than on a browse wall — a discography is
         * read chronologically, and the year is half the point.
         *
         * `creditFor` shows the credit whenever it differs from this artist's
         * current name. That keeps collaborations legible — Watch the Throne
         * reads as Jay-Z & Kanye West on both of their pages rather than looking
         * like a solo record on each — and it also surfaces upstream renames,
         * since albums credited to Kanye West sit under an artist MusicBrainz
         * now calls Ye. Both are worth saying out loud.
         */}
        <AlbumGrid
          albums={artist.albums}
          density="relaxed"
          showCaptions
          creditForArtistMbid={artist.mbid}
          emptyMessage="No releases in the catalogue yet."
        />

        {/*
         * An intentional state, not an empty one — the same reasoning the album
         * page gives for its pending tracklist. A discography shown without
         * comment claims that this is the artist's body of work, which is a
         * fact longplayr has not established while an expansion is in flight.
         *
         * One line, and deliberately nothing more: no spinner, no skeleton, no
         * count, no "load more". A progress indicator would promise a finish
         * time the one-request-per-second ceiling cannot honour.
         */}
        {/*
         * **Three renderings from four states. `product-spec.md` §6.**
         *
         * `start`, `outstanding` and a sweep-re-queued expansion all say the
         * same thing because **the reader's action is identical** — come back.
         * `failed` differs in kind: more is coming, but not soon. It said
         * *nothing* until 2026-09-13, so a discography truncated by a transient
         * upstream error presented itself as complete.
         *
         * **"Look again in a moment" earns its horizon and the failure line has
         * none.** A later view drains a job, so looking again genuinely helps;
         * the sweep's timing is not promisable, and an unhonourable horizon is
         * the defect being fixed here rather than one to repeat.
         *
         * The error itself is never shown — it is operator text, and lives on
         * the queue view in `architecture.md` §17a.
         */}
        {expansion === 'failed' ? (
          <p className="mt-6 text-sm text-text-muted" data-testid="discography-failed">
            Couldn&rsquo;t finish fetching this discography from MusicBrainz. It will be retried.
          </p>
        ) : (
          /*
           * **Enumerated rather than `!== 'settled'`, and that is the lesson of
           * this change rather than a style choice.** A negated condition lets a
           * future state fall silently into this branch and claim work is in
           * progress — which is the shape of the defect being fixed here: a
           * state nobody enumerated, quietly taking someone else's treatment.
           */
          (expansion === 'start' || expansion === 'outstanding') && (
            <p className="mt-6 text-sm text-text-muted" data-testid="discography-pending">
              Fetching the rest of this discography from MusicBrainz. Look again in a moment.
            </p>
          )
        )}
      </section>
    </Container>
  );
}
