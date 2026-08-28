import { createAdminClient } from '@/lib/supabase/admin';

import { CURATED_ARTISTS, type CuratedArtist } from './curated-artists';
import { withinCurrentDepth } from './depth-policy';
import { classify } from './scope';
import { createMinimalAlbum, findHeldAlbum, reconcileCredits } from './ingest';
import {
  BACKGROUND_RETRY,
  browseAllReleaseGroupsByArtist,
  type MbReleaseGroup,
} from './musicbrainz';
import { enqueueJob } from './queue';

import type { Database } from '@/lib/supabase/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

type Admin = SupabaseClient<Database>;

/**
 * Expands the catalogue across a curated artist list, using progressive
 * hydration (`docs/architecture.md` §7).
 *
 * One MusicBrainz request per hundred release groups, and **none per album**:
 * the browse response carries everything an album card needs, and the two
 * requests a full ingest costs are deferred until someone opens the album.
 *
 * **Additive only.** Albums already held are counted and skipped; nothing is
 * updated, deleted or reseeded. Running this twice creates nothing the second
 * time.
 */

export type ArtistOutcome = {
  name: string;
  mbid: string;
  /** Release groups returned by browse, before any filtering. */
  discovered: number;
  /** Passing the global scope filter. */
  inScope: number;
  /** Passing the current depth boundary — what this tranche would take. */
  inDepth: number;
  browseRequests: number;
  /** Browse stopped at the page ceiling with pages still arriving. */
  truncated: boolean;
  error?: string;
};

export type CuratedTrancheReport = {
  target: string;
  artists: number;
  artistsFailed: number;
  browseRequests: number;
  discovered: number;
  inScope: number;
  /** The tranche size under the current boundary. */
  inDepth: number;
  /** Release groups credited to more than one curated artist. */
  duplicatesAcrossArtists: number;
  alreadyPresent: number;
  created: number;
  artworkQueued: number;
  failed: { mbid: string; title: string; reason: string }[];
  perArtist: ArtistOutcome[];
  durationSeconds: number;
};

/** Browses one artist and classifies what came back. Makes no writes. */
async function discoverArtist(
  artist: CuratedArtist,
): Promise<{ outcome: ArtistOutcome; inDepth: MbReleaseGroup[] }> {
  try {
    const { groups, requests, truncated } = await browseAllReleaseGroupsByArtist(
      artist.mbid,
      BACKGROUND_RETRY,
    );

    const inDepth: MbReleaseGroup[] = [];
    let inScope = 0;

    for (const group of groups) {
      // Scope and depth are counted from their own classifiers rather than by
      // reading a rejection message. The report exists to show the gap between
      // what the catalogue may hold and what this tranche takes, and that
      // number must not depend on the wording of a reason string.
      if (classify(group).inScope) inScope += 1;
      if (withinCurrentDepth(group).inDepth) inDepth.push(group);
    }

    return {
      outcome: {
        name: artist.name,
        mbid: artist.mbid,
        discovered: groups.length,
        inScope,
        inDepth: inDepth.length,
        browseRequests: requests,
        truncated,
      },
      inDepth,
    };
  } catch (error) {
    // One artist failing must not abandon the other twenty-seven. Recorded and
    // reported; the run continues.
    return {
      outcome: {
        name: artist.name,
        mbid: artist.mbid,
        discovered: 0,
        inScope: 0,
        inDepth: 0,
        browseRequests: 0,
        truncated: false,
        error: error instanceof Error ? error.message : String(error),
      },
      inDepth: [],
    };
  }
}

/**
 * Discovers what the tranche would take, and writes nothing.
 *
 * Costs one browse request per hundred release groups per artist and **zero**
 * writes, so the selection is inspectable before anything is committed — the
 * same guarantee `dryRunSeed` provides for the popularity path.
 */
export async function dryRunCuratedTranche(
  options: { artists?: readonly CuratedArtist[]; admin?: Admin } = {},
): Promise<CuratedTrancheReport> {
  const artists = options.artists ?? CURATED_ARTISTS;
  const admin = options.admin ?? createAdminClient();
  const startedAt = Date.now();

  const perArtist: ArtistOutcome[] = [];
  const byMbid = new Map<string, MbReleaseGroup>();
  let duplicates = 0;

  for (const artist of artists) {
    const { outcome, inDepth } = await discoverArtist(artist);
    perArtist.push(outcome);
    for (const group of inDepth) {
      // A release group credited to two curated artists is one album, not two.
      if (byMbid.has(group.id)) duplicates += 1;
      else byMbid.set(group.id, group);
    }
  }

  const mbids = [...byMbid.keys()];
  const alreadyPresent = mbids.length === 0 ? 0 : await countExisting(admin, mbids);

  return {
    target: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host,
    artists: artists.length,
    artistsFailed: perArtist.filter((a) => a.error).length,
    browseRequests: perArtist.reduce((n, a) => n + a.browseRequests, 0),
    discovered: perArtist.reduce((n, a) => n + a.discovered, 0),
    inScope: perArtist.reduce((n, a) => n + a.inScope, 0),
    inDepth: byMbid.size,
    duplicatesAcrossArtists: duplicates,
    alreadyPresent,
    created: 0,
    artworkQueued: 0,
    failed: [],
    perArtist,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
}

/** How many of these release-group MBIDs the catalogue already holds. */
async function countExisting(admin: Admin, mbids: string[]): Promise<number> {
  let found = 0;
  // Chunked because the list is a query parameter, and 353 identifiers in one
  // `in` clause is close enough to a URL limit to be worth not discovering in
  // production.
  for (let i = 0; i < mbids.length; i += 100) {
    const { count, error } = await admin
      .from('albums')
      .select('mbid', { count: 'exact', head: true })
      .in('mbid', mbids.slice(i, i + 100));
    if (error) throw error;
    found += count ?? 0;
  }
  return found;
}

/** Human-readable summary, mirroring `formatSeedReport`. */
export function formatCuratedTrancheReport(report: CuratedTrancheReport): string {
  const lines = [
    `Curated tranche — ${report.target}`,
    ``,
    `  artists              ${report.artists}${report.artistsFailed ? ` (${report.artistsFailed} failed)` : ''}`,
    `  browse requests      ${report.browseRequests}`,
    `  release groups seen  ${report.discovered}`,
    `  in scope             ${report.inScope}`,
    `  within depth         ${report.inDepth}`,
    `  shared across artists ${report.duplicatesAcrossArtists}`,
    `  already held         ${report.alreadyPresent}`,
    `  created              ${report.created}`,
    `  artwork queued       ${report.artworkQueued}`,
    `  failed               ${report.failed.length}`,
    `  duration             ${report.durationSeconds}s`,
  ];

  const truncated = report.perArtist.filter((a) => a.truncated);
  if (truncated.length > 0) {
    lines.push(``, `  TRUNCATED (hit the page ceiling):`);
    for (const a of truncated) lines.push(`    ${a.name}`);
  }

  const errored = report.perArtist.filter((a) => a.error);
  if (errored.length > 0) {
    lines.push(``, `  ARTIST FAILURES:`);
    for (const a of errored) lines.push(`    ${a.name}: ${a.error}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Durable, per-artist recovery
// ---------------------------------------------------------------------------

/**
 * Discovers one curated artist and creates whatever the tranche is missing.
 *
 * The unit of work behind a `discover_curated_artist` job. **Throws** when the
 * browse cannot be completed, so the queue's existing retry, backoff and
 * exhaustion machinery decides what happens next — this function does not
 * decide, and does not swallow.
 *
 * Request-level and artist-level retry stay separate: the browse below already
 * makes up to five attempts under `BACKGROUND_RETRY`. Throwing means those are
 * spent, and the *artist* now needs a later attempt.
 */
/**
 * What one artist's discovery did.
 *
 * `reconciled` and `unreconciled` are reported separately from `alreadyPresent`
 * rather than folded into it. An album that was already held and an album that
 * was already held **and had to be repaired** are different facts, and an album
 * that could not be repaired must never be counted among those that were.
 */
export type ArtistIngestOutcome = {
  discovered: number;
  inDepth: number;
  created: number;
  /** Held before this run — including any that needed reconciling. */
  alreadyPresent: number;
  /** Held but credit-less, and successfully repaired from a payload. */
  reconciled: number;
  /** Held, credit-less, and NOT repaired — no stored payload, or out of scope. */
  unreconciled: number;
};

export async function discoverAndIngestArtist(
  artistMbid: string,
  admin: Admin = createAdminClient(),
): Promise<ArtistIngestOutcome> {
  const { groups } = await browseAllReleaseGroupsByArtist(artistMbid, BACKGROUND_RETRY);

  const inDepth = groups.filter((g) => withinCurrentDepth(g).inDepth);
  let created = 0;
  let alreadyPresent = 0;
  let reconciled = 0;
  let unreconciled = 0;

  for (const group of inDepth) {
    const held = await findHeldAlbum(admin, group.id);

    // Not created again. A release group may already be held by an earlier run
    // or by another curated artist crediting the same record, and rewriting it
    // would be pointless work. `upsertAlbum` refuses to downgrade hydration in
    // any case, so this is a second line of defence rather than the only one.
    //
    // **But held is not the same as complete.** An interrupted run can leave an
    // album row whose credits were never written, and the check this replaced
    // could not see the difference — so it skipped the one album that needed
    // the work, permanently. The browse record is already in hand here, so
    // repairing costs nothing upstream.
    if (held) {
      alreadyPresent += 1;
      if (!held.hasCredits) {
        const outcome = await reconcileCredits(admin, held.id, group.id, group);
        if (outcome.status === 'reconciled') reconciled += 1;
        else unreconciled += 1;
      }
      continue;
    }

    await createMinimalAlbum(group, admin);
    created += 1;
    await enqueueJob('fetch_artwork', group.id, { admin });
  }

  return {
    discovered: groups.length,
    inDepth: inDepth.length,
    created,
    alreadyPresent,
    reconciled,
    unreconciled,
  };
}

export type TrancheStatus = {
  artists: number;
  succeeded: number;
  /** Queued or awaiting a later attempt. */
  retryable: number;
  /** Exhausted their job attempts. Still recoverable by enqueueing again. */
  exhausted: number;
  neverAttempted: number;
  complete: boolean;
  unresolved: { name: string; mbid: string; state: string; lastError: string | null }[];
};

/**
 * The tranche's state, read from the job table rather than from memory.
 *
 * A report built from an in-process list says only what this run saw. The
 * question that matters — which curated artists remain unresolved — has to
 * survive the process exiting, so it is answered from `ingestion_jobs`.
 */
export async function curatedTrancheStatus(
  options: { artists?: readonly CuratedArtist[]; admin?: Admin } = {},
): Promise<TrancheStatus> {
  const artists = options.artists ?? CURATED_ARTISTS;
  const admin = options.admin ?? createAdminClient();

  const { data, error } = await admin
    .from('ingestion_jobs')
    .select('target_mbid, status, last_error')
    .eq('kind', 'discover_curated_artist')
    .in(
      'target_mbid',
      artists.map((a) => a.mbid),
    );
  if (error) throw error;

  const rows = data ?? [];
  const status = new Map<string, { status: string; last_error: string | null }[]>();
  for (const row of rows) {
    const list = status.get(row.target_mbid) ?? [];
    list.push({ status: row.status, last_error: row.last_error });
    status.set(row.target_mbid, list);
  }

  let succeeded = 0;
  let retryable = 0;
  let exhausted = 0;
  let neverAttempted = 0;
  const unresolved: TrancheStatus['unresolved'] = [];

  for (const artist of artists) {
    const jobs = status.get(artist.mbid) ?? [];
    // Any succeeded job resolves the artist, whatever else is on record — a
    // terminal failure followed by a successful re-enqueue leaves both rows.
    if (jobs.some((j) => j.status === 'succeeded')) {
      succeeded += 1;
      continue;
    }
    if (jobs.some((j) => j.status === 'pending' || j.status === 'running')) {
      retryable += 1;
      unresolved.push({
        name: artist.name,
        mbid: artist.mbid,
        state: 'retryable',
        lastError: null,
      });
      continue;
    }
    const failed = jobs.find((j) => j.status === 'failed');
    if (failed) {
      exhausted += 1;
      unresolved.push({
        name: artist.name,
        mbid: artist.mbid,
        state: 'exhausted',
        lastError: failed.last_error,
      });
      continue;
    }
    neverAttempted += 1;
    unresolved.push({
      name: artist.name,
      mbid: artist.mbid,
      state: 'never_attempted',
      lastError: null,
    });
  }

  return {
    artists: artists.length,
    succeeded,
    retryable,
    exhausted,
    neverAttempted,
    complete: succeeded === artists.length,
    unresolved,
  };
}

/**
 * Queues discovery for every curated artist not already resolved.
 *
 * Skips artists holding a `succeeded` job — the partial unique index stops a
 * second *pending* job, but says nothing about a completed one, so that check
 * belongs here. An artist whose job is terminally `failed` is enqueued again,
 * which the index permits and which needs no status to be reset or invented.
 */
export async function enqueueCuratedTranche(
  options: { artists?: readonly CuratedArtist[]; admin?: Admin } = {},
): Promise<{ queued: string[]; alreadyResolved: string[] }> {
  const artists = options.artists ?? CURATED_ARTISTS;
  const admin = options.admin ?? createAdminClient();

  const state = await curatedTrancheStatus({ artists, admin });
  const unresolved = new Set(state.unresolved.map((u) => u.mbid));

  const queued: string[] = [];
  const alreadyResolved: string[] = [];

  for (const artist of artists) {
    if (!unresolved.has(artist.mbid)) {
      alreadyResolved.push(artist.name);
      continue;
    }
    // Tolerates the 23505 the index raises for an artist already queued.
    await enqueueJob('discover_curated_artist', artist.mbid, { admin });
    queued.push(artist.name);
  }

  return { queued, alreadyResolved };
}

/** Human-readable tranche state, mirroring `formatCuratedTrancheReport`. */
export function formatTrancheStatus(status: TrancheStatus): string {
  const lines = [
    `  Artists:        ${status.artists}`,
    `  Succeeded:      ${status.succeeded}`,
    `  Retryable:      ${status.retryable}`,
    `  Exhausted:      ${status.exhausted}`,
    `  Never attempted:${status.neverAttempted}`,
    `  Tranche:        ${status.complete ? 'COMPLETE' : 'INCOMPLETE'}`,
  ];
  if (status.unresolved.length > 0) {
    lines.push('', '  UNRESOLVED ARTISTS:');
    for (const u of status.unresolved) {
      lines.push(
        `    ${u.name} [${u.state}]${u.lastError ? ` — ${u.lastError.slice(0, 90)}` : ''}`,
      );
    }
  }
  return lines.join('\n');
}
