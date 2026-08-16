import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { ListenBrainzSource } from '../discovery/listenbrainz';
import type { PopularityRange } from '../discovery/popularity';

import { artworkCoverage, fetchAndStoreArtwork } from './artwork';
import { ingestReleaseGroup } from './ingest';
import { enqueueJob } from './jobs';
import { OutOfScopeError } from './map';
import { selectSeedCandidates } from './seed-selection';
import { NotFoundError } from './musicbrainz';

type Admin = SupabaseClient<Database>;

/**
 * Catalogue seeding.
 *
 * Fetches a popularity-ranked list, then ingests each entry through the normal
 * path. Sequential by necessity: MusicBrainz allows one request per second, so
 * a thousand albums is a thousand seconds no matter how the code is arranged.
 *
 * The report is the point. "It worked" is not a useful outcome for a job whose
 * whole purpose is populating a catalogue we have never seen — what matters is
 * how many were rejected and why, and how much artwork actually exists.
 */

export type SeedReport = {
  /** Host actually written to. Recorded so the target is never in doubt. */
  target: string;
  source: string;
  range: PopularityRange;
  requested: number;

  /** Straight from ListenBrainz, before any filtering. */
  returnedByPopularitySource: number;
  droppedMissingMbid: number;
  usableFromPopularitySource: number;

  maxPerArtist: number | null;
  duplicatesSkipped: number;
  selectedForSeeding: number;
  excludedByArtistCap: number;

  /**
   * Catalogue outcome per selected album. Mutually exclusive — every selected
   * album lands in exactly one bucket, so these sum to selectedForSeeding.
   */
  catalogueOutcome: {
    ingested: number;
    alreadyPresent: number;
    rejected: { mbid: string; title: string; reason: string }[];
    notFoundUpstream: { mbid: string; title: string }[];
    failed: { mbid: string; title: string; error: string }[];
  };

  /**
   * Artwork outcome, independent of the above. An album can be catalogued
   * successfully and still have no cover, so mixing the two made a run look
   * worse than it was and hid which failure actually occurred.
   */
  artworkOutcome: { mbid: string; title: string; error: string }[];

  artwork: {
    found: number;
    absent: number;
    failed: number;
    pending: number;
    total: number;
    observedCoveragePercent: number;
  };
  catalogue: { albums: number; artists: number };

  durationSeconds: number;
};

/**
 * Initial seed strategy, decided from measured evidence (see the four-way
 * comparison in the Phase 1 notes):
 *
 *  - **all-time**, not monthly. MBID coverage is dramatically better — 2
 *    missing per 500 against 35 — and the result reads as a canon rather than
 *    a snapshot of one fandom's month.
 *  - **500 candidates**, enough to be useful while remaining operationally
 *    manageable at roughly two seconds per album.
 *  - **2 albums per artist**, a cold-start diversification device only. It is
 *    not a catalogue constraint: see seed-selection.ts.
 */
export const DEFAULT_SEED_RANGE: PopularityRange = 'all_time';
export const DEFAULT_SEED_CANDIDATES = 500;
export const DEFAULT_MAX_PER_ARTIST = 2;

export type SeedOptions = {
  /** Candidates requested from the popularity source, before selection. */
  limit?: number;
  range?: PopularityRange;
  /** Albums per artist during initial selection. `null` disables the cap. */
  maxPerArtist?: number | null;
  /** Skip artwork to keep a run short. Artwork can be queued separately. */
  includeArtwork?: boolean;
  admin?: Admin;
  onProgress?: (done: number, total: number, label: string) => void;
};

/**
 * What a seed *would* do, without writing anything.
 *
 * Album type is deliberately absent. ListenBrainz returns no type, so
 * determining it means fetching each candidate from MusicBrainz — 500 requests
 * to decide what to fetch. Type distribution is reported after ingestion
 * instead, where it costs nothing.
 */
export type SeedDryRunReport = {
  /** Host actually written to. Recorded so the target is never in doubt. */
  target: string;
  source: string;
  range: PopularityRange;
  requested: number;

  returnedByPopularitySource: number;
  droppedMissingMbid: number;
  usableFromPopularitySource: number;
  distinctCandidateMbids: number;

  maxPerArtist: number | null;
  duplicatesSkipped: number;
  selected: number;
  excludedByCap: number;
  distinctArtists: number;
  largestArtistShare: number;
  cappedArtists: { name: string; kept: number; excluded: number }[];

  /** From the source's own hint, not from Cover Art Archive. Advisory. */
  candidatesWithArtworkHint: number;

  alreadyInCatalogue: number;
  wouldIngest: number;

  sample: { rank: number; artist: string; title: string }[];
  estimatedMusicBrainzRequests: number;
  estimatedMinutes: number;
};

/**
 * Reports what a seed would do, without writing anything.
 *
 * Costs exactly one ListenBrainz request and no MusicBrainz requests, so the
 * selection can be inspected before any catalogue data is committed.
 */
export async function dryRunSeed(options: SeedOptions = {}): Promise<SeedDryRunReport> {
  const {
    limit = DEFAULT_SEED_CANDIDATES,
    range = DEFAULT_SEED_RANGE,
    maxPerArtist = DEFAULT_MAX_PER_ARTIST,
    admin = createAdminClient(),
  } = options;

  const source = new ListenBrainzSource();
  const candidates = (await source.topReleaseGroups({ limit, range })).slice(0, limit);

  const selection = selectSeedCandidates(candidates, { maxPerArtist });

  const { data: existing, error: existingError } = await admin
    .from('albums')
    .select('mbid')
    .in(
      'mbid',
      selection.selected.map((e) => e.mbid),
    );

  // Not optional. Swallowing this made an unreachable database look like an
  // empty catalogue, which would report "would ingest 358" against a database
  // that already held them.
  if (existingError) throw existingError;

  const held = new Set((existing ?? []).map((row) => row.mbid));
  const wouldIngest = selection.selected.filter((e) => !held.has(e.mbid)).length;

  // Two MusicBrainz requests per new album: the release group, then the
  // representative release for its tracklist.
  const requests = wouldIngest * 2;

  return {
    target: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host,
    source: source.name,
    range,
    requested: limit,
    returnedByPopularitySource: source.lastDiagnostics.returned,
    droppedMissingMbid: source.lastDiagnostics.missingMbid,
    usableFromPopularitySource: source.lastDiagnostics.usable,
    distinctCandidateMbids: new Set(candidates.map((c) => c.mbid)).size,
    maxPerArtist,
    duplicatesSkipped: selection.duplicatesSkipped,
    selected: selection.selected.length,
    excludedByCap: selection.excludedByCap.length,
    distinctArtists: selection.distinctArtists,
    largestArtistShare: maxPerArtist ?? Math.max(0, ...selection.cappedArtists.map((a) => a.kept)),
    cappedArtists: selection.cappedArtists.slice(0, 15),
    candidatesWithArtworkHint: candidates.filter((c) => c.hasArtwork).length,
    alreadyInCatalogue: selection.selected.length - wouldIngest,
    wouldIngest,
    sample: selection.selected
      .slice(0, 25)
      .map((e, i) => ({ rank: i + 1, artist: e.artistName, title: e.title })),
    estimatedMusicBrainzRequests: requests,
    estimatedMinutes: Math.ceil(requests / 60),
  };
}

export async function seedCatalogue(options: SeedOptions = {}): Promise<SeedReport> {
  const {
    limit = DEFAULT_SEED_CANDIDATES,
    range = DEFAULT_SEED_RANGE,
    maxPerArtist = DEFAULT_MAX_PER_ARTIST,
    includeArtwork = true,
    admin = createAdminClient(),
    onProgress,
  } = options;

  const startedAt = Date.now();
  const source = new ListenBrainzSource();

  const fetched = await source.topReleaseGroups({ limit, range });

  // Hard cap, independent of what ListenBrainz actually returned.
  //
  // Asking for `count=N` is a request, not a guarantee: if the API ignored it,
  // returned more, or changed its paging behaviour, the loop below would
  // happily ingest every extra row. A bounded run must not be able to become a
  // larger one because an upstream response was bigger than asked for.
  const candidates = fetched.slice(0, limit);

  // Selection policy — the artist cap — applied before anything is fetched.
  const selection = selectSeedCandidates(candidates, { maxPerArtist });
  const entries = selection.selected;

  const report: SeedReport = {
    target: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host,
    source: source.name,
    range,
    requested: limit,
    returnedByPopularitySource: source.lastDiagnostics.returned,
    droppedMissingMbid: source.lastDiagnostics.missingMbid,
    usableFromPopularitySource: source.lastDiagnostics.usable,
    maxPerArtist,
    duplicatesSkipped: selection.duplicatesSkipped,
    selectedForSeeding: entries.length,
    excludedByArtistCap: selection.excludedByCap.length,
    catalogueOutcome: {
      ingested: 0,
      alreadyPresent: 0,
      rejected: [],
      notFoundUpstream: [],
      failed: [],
    },
    artworkOutcome: [],
    artwork: { found: 0, absent: 0, failed: 0, pending: 0, total: 0, observedCoveragePercent: 0 },
    catalogue: { albums: 0, artists: 0 },
    durationSeconds: 0,
  };

  // Second, independent stop: counts requests actually sent to MusicBrainz.
  // The slice above bounds the list; this bounds the network. If they ever
  // disagree, the run aborts rather than quietly continuing.
  let upstreamFetches = 0;

  for (const [index, entry] of entries.entries()) {
    if (upstreamFetches > entries.length) {
      throw new Error(
        `Seed aborted: attempted more fetches than the ${entries.length} selected albums. ` +
          'This should be unreachable — investigate before re-running.',
      );
    }

    onProgress?.(index + 1, entries.length, `${entry.artistName} — ${entry.title}`);

    const { data: existing } = await admin
      .from('albums')
      .select('mbid')
      .eq('mbid', entry.mbid)
      .maybeSingle();

    try {
      if (existing) {
        report.catalogueOutcome.alreadyPresent += 1;
      } else {
        upstreamFetches += 1;
        const result = await ingestReleaseGroup(entry.mbid, admin);
        if (result.status === 'out_of_scope') {
          report.catalogueOutcome.rejected.push({
            mbid: entry.mbid,
            title: `${entry.artistName} — ${entry.title}`,
            reason: result.reason,
          });
          continue;
        }
        report.catalogueOutcome.ingested += 1;
      }

      // Popularity is written for everything we hold, including albums that
      // were already present, so the ranking reflects the current signal.
      await admin.from('albums').update({ popularity_score: entry.score }).eq('mbid', entry.mbid);

      if (includeArtwork) {
        // Records its own outcome rather than throwing, so a Cover Art Archive
        // failure never masquerades as a catalogue failure.
        const art = await fetchAndStoreArtwork(entry.mbid, admin);
        if (art.status === 'failed') {
          report.artworkOutcome.push({
            mbid: entry.mbid,
            title: `${entry.artistName} — ${entry.title}`,
            error: art.reason,
          });
          // Queue a retry rather than leaving the failure in the report and
          // nowhere else. The first seed did exactly that: 68 covers failed,
          // the report listed them, and nothing was scheduled to try again.
          // Idempotent — the partial unique index collapses duplicates.
          await enqueueJob('fetch_artwork', entry.mbid, { admin });
        }
      }
    } catch (error) {
      if (error instanceof OutOfScopeError) {
        report.catalogueOutcome.rejected.push({
          mbid: entry.mbid,
          title: `${entry.artistName} — ${entry.title}`,
          reason: error.reason,
        });
      } else if (error instanceof NotFoundError) {
        // ListenBrainz knows an MBID that MusicBrainz no longer resolves —
        // usually a merged or removed release group.
        report.catalogueOutcome.notFoundUpstream.push({
          mbid: entry.mbid,
          title: `${entry.artistName} — ${entry.title}`,
        });
      } else {
        report.catalogueOutcome.failed.push({
          mbid: entry.mbid,
          title: `${entry.artistName} — ${entry.title}`,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  report.artwork = await artworkCoverage(admin);

  const [albums, artists] = await Promise.all([
    admin.from('albums').select('id', { count: 'exact', head: true }),
    admin.from('artists').select('id', { count: 'exact', head: true }),
  ]);
  report.catalogue = { albums: albums.count ?? 0, artists: artists.count ?? 0 };

  report.durationSeconds = Math.round((Date.now() - startedAt) / 1000);
  return report;
}

/** Human-readable summary for the terminal. */
export function formatSeedReport(report: SeedReport): string {
  const lines = [
    `Seed report — ${report.source} (${report.range}), ${report.durationSeconds}s`,
    `  Target                       ${report.target}`,
    '',
    `  Returned by ListenBrainz     ${report.returnedByPopularitySource}`,
    `  Dropped, no MBID             ${report.droppedMissingMbid}`,
    `  Usable                       ${report.usableFromPopularitySource}`,
    `  Duplicate release groups     ${report.duplicatesSkipped}`,
    `  Selected (cap ${String(report.maxPerArtist ?? 'none').padEnd(4)})          ${report.selectedForSeeding}`,
    `  Excluded by artist cap       ${report.excludedByArtistCap}`,
    '',

    `  Catalogue                    ${report.catalogue.albums} albums, ${report.catalogue.artists} artists`,
    '',
    '  Catalogue outcome (mutually exclusive)',
    `    ingested                   ${report.catalogueOutcome.ingested}`,
    `    already present            ${report.catalogueOutcome.alreadyPresent}`,
    `    rejected (out of scope)    ${report.catalogueOutcome.rejected.length}`,
    `    not found upstream         ${report.catalogueOutcome.notFoundUpstream.length}`,
    `    failed                     ${report.catalogueOutcome.failed.length}`,
    '',
    '  Artwork outcome (independent of the above)',
    `    found                      ${report.artwork.found}`,
    `    absent (confirmed no art)  ${report.artwork.absent}`,
    `    failed (service error)     ${report.artwork.failed}`,
    `    pending (not attempted)    ${report.artwork.pending}`,
    `    observed coverage          ${report.artwork.observedCoveragePercent}%  (found / attempted)`,
  ];

  if (report.catalogueOutcome.rejected.length > 0) {
    lines.push('', '  Rejected (first 10):');
    for (const item of report.catalogueOutcome.rejected.slice(0, 10)) {
      lines.push(`    ${item.title} — ${item.reason}`);
    }
  }

  if (report.catalogueOutcome.failed.length > 0) {
    lines.push('', '  Catalogue failures (first 10):');
    for (const item of report.catalogueOutcome.failed.slice(0, 10)) {
      lines.push(`    ${item.title} — ${item.error}`);
    }
  }

  if (report.artworkOutcome.length > 0) {
    lines.push('', '  Artwork failures (first 10):');
    for (const item of report.artworkOutcome.slice(0, 10)) {
      lines.push(`    ${item.title} — ${item.error}`);
    }
  }

  return lines.join('\n');
}
