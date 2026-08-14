import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { ListenBrainzSource } from '../discovery/listenbrainz';
import type { PopularityRange } from '../discovery/popularity';

import { artworkCoverage, fetchAndStoreArtwork } from './artwork';
import { ingestReleaseGroup } from './ingest';
import { OutOfScopeError } from './map';
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
  source: string;
  range: PopularityRange;
  requested: number;

  /** Straight from ListenBrainz, before any filtering. */
  returnedByPopularitySource: number;
  droppedMissingMbid: number;
  usableFromPopularitySource: number;

  ingested: number;
  alreadyPresent: number;
  rejectedOutOfScope: { mbid: string; title: string; reason: string }[];
  notFoundUpstream: { mbid: string; title: string }[];
  failed: { mbid: string; title: string; error: string }[];

  artwork: { found: number; absent: number; pending: number; coveragePercent: number };
  catalogue: { albums: number; artists: number };

  durationSeconds: number;
};

export type SeedOptions = {
  limit?: number;
  range?: PopularityRange;
  /** Skip artwork to keep a run short. Artwork can be queued separately. */
  includeArtwork?: boolean;
  admin?: Admin;
  onProgress?: (done: number, total: number, label: string) => void;
};

export async function seedCatalogue(options: SeedOptions = {}): Promise<SeedReport> {
  const {
    limit = 100,
    range = 'month',
    includeArtwork = true,
    admin = createAdminClient(),
    onProgress,
  } = options;

  const startedAt = Date.now();
  const source = new ListenBrainzSource();

  const entries = await source.topReleaseGroups({ limit, range });

  const report: SeedReport = {
    source: source.name,
    range,
    requested: limit,
    returnedByPopularitySource: source.lastDiagnostics.returned,
    droppedMissingMbid: source.lastDiagnostics.missingMbid,
    usableFromPopularitySource: source.lastDiagnostics.usable,
    ingested: 0,
    alreadyPresent: 0,
    rejectedOutOfScope: [],
    notFoundUpstream: [],
    failed: [],
    artwork: { found: 0, absent: 0, pending: 0, coveragePercent: 0 },
    catalogue: { albums: 0, artists: 0 },
    durationSeconds: 0,
  };

  for (const [index, entry] of entries.entries()) {
    onProgress?.(index + 1, entries.length, `${entry.artistName} — ${entry.title}`);

    const { data: existing } = await admin
      .from('albums')
      .select('mbid')
      .eq('mbid', entry.mbid)
      .maybeSingle();

    try {
      if (existing) {
        report.alreadyPresent += 1;
      } else {
        const result = await ingestReleaseGroup(entry.mbid, admin);
        if (result.status === 'out_of_scope') {
          report.rejectedOutOfScope.push({
            mbid: entry.mbid,
            title: `${entry.artistName} — ${entry.title}`,
            reason: result.reason,
          });
          continue;
        }
        report.ingested += 1;
      }

      // Popularity is written for everything we hold, including albums that
      // were already present, so the ranking reflects the current signal.
      await admin.from('albums').update({ popularity_score: entry.score }).eq('mbid', entry.mbid);

      if (includeArtwork) {
        await fetchAndStoreArtwork(entry.mbid, admin);
      }
    } catch (error) {
      if (error instanceof OutOfScopeError) {
        report.rejectedOutOfScope.push({
          mbid: entry.mbid,
          title: `${entry.artistName} — ${entry.title}`,
          reason: error.reason,
        });
      } else if (error instanceof NotFoundError) {
        // ListenBrainz knows an MBID that MusicBrainz no longer resolves —
        // usually a merged or removed release group.
        report.notFoundUpstream.push({
          mbid: entry.mbid,
          title: `${entry.artistName} — ${entry.title}`,
        });
      } else {
        report.failed.push({
          mbid: entry.mbid,
          title: `${entry.artistName} — ${entry.title}`,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const coverage = await artworkCoverage(admin);
  report.artwork = {
    found: coverage.found,
    absent: coverage.absent,
    pending: coverage.pending,
    coveragePercent: coverage.coverage,
  };

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
    '',
    `  Returned by ListenBrainz     ${report.returnedByPopularitySource}`,
    `  Dropped, no MBID             ${report.droppedMissingMbid}`,
    `  Usable                       ${report.usableFromPopularitySource}`,
    '',
    `  Newly ingested               ${report.ingested}`,
    `  Already present              ${report.alreadyPresent}`,
    `  Rejected, out of scope       ${report.rejectedOutOfScope.length}`,
    `  Not found in MusicBrainz     ${report.notFoundUpstream.length}`,
    `  Failed                       ${report.failed.length}`,
    '',
    `  Catalogue                    ${report.catalogue.albums} albums, ${report.catalogue.artists} artists`,
    `  Artwork found                ${report.artwork.found}`,
    `  Artwork absent               ${report.artwork.absent}`,
    `  Artwork pending              ${report.artwork.pending}`,
    `  Coverage                     ${report.artwork.coveragePercent}%`,
  ];

  if (report.rejectedOutOfScope.length > 0) {
    lines.push('', '  Rejected (first 10):');
    for (const item of report.rejectedOutOfScope.slice(0, 10)) {
      lines.push(`    ${item.title} — ${item.reason}`);
    }
  }

  if (report.failed.length > 0) {
    lines.push('', '  Failures (first 10):');
    for (const item of report.failed.slice(0, 10)) {
      lines.push(`    ${item.title} — ${item.error}`);
    }
  }

  return lines.join('\n');
}
