import { createAdminClient } from '@/lib/supabase/admin';
import { COUNT_ONLY, countRows } from '@/services/count';

import { toUncoveredAlbum, WORKLIST_LIMIT } from './artwork-worklist';
import { classifyMissingDate, isCaptureFault, payloadDateValue } from './date-capture';

import type { DateCaptureRow, DateCaptureVerdict } from './date-capture';

import type { ArtworkWorklist, UncoveredAlbumRow } from './artwork-worklist';

import type { Database } from '@/lib/supabase/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

type Admin = SupabaseClient<Database>;
type Job = Database['public']['Tables']['ingestion_jobs']['Row'];

/**
 * Read-only queue inspection for the temporary operator surface.
 *
 * `architecture.md` §17a. **Nothing here mutates, and one thing here must never
 * start to**: it must not call `claim_ingestion_jobs`. That function marks rows
 * `running` and increments `attempts`, so routing this page through it would
 * spend a job's retry budget merely because somebody looked at the page.
 *
 * The ordering instead **mirrors** the claim's — `priority asc, id asc` over
 * rows that are `pending` with `run_after <= now()`. Mirroring rather than
 * sharing means the two can drift; that is accepted, because the alternative is
 * a diagnostic with side effects. The migration that owns the real ordering is
 * `20260831120000_enforce_claim_batch_size.sql`.
 */

/**
 * What a reader of the page needs to know about one job, in words.
 *
 * **This is the page's whole value and it lives here rather than in JSX**, so it
 * is testable. The distinction the maintainer could not previously make —
 * "failed" versus "waiting until the next drain" — is `run_after` against the
 * clock, and it is invisible in the raw row.
 */
export type QueuedJobState =
  | 'running now'
  | 'next to be claimed'
  | 'waiting for a drain'
  | 'backing off'
  | 'terminally failed — awaiting the sweep';

export type InspectedJob = {
  id: number;
  kind: Job['kind'];
  target_mbid: string;
  priority: number;
  attempts: number;
  run_after: string;
  updated_at: string;
  last_error: string | null;
  state: QueuedJobState;
  /** Present only while `state` is `backing off`. */
  claimableAt: string | null;
};

export function stateFor(job: Job, now: Date, isNext: boolean): QueuedJobState {
  if (job.status === 'running') return 'running now';
  if (job.status === 'failed') return 'terminally failed — awaiting the sweep';
  if (new Date(job.run_after) > now) return 'backing off';
  return isNext ? 'next to be claimed' : 'waiting for a drain';
}

function inspect(job: Job, now: Date, isNext: boolean): InspectedJob {
  const state = stateFor(job, now, isNext);
  return {
    id: job.id,
    kind: job.kind,
    target_mbid: job.target_mbid,
    priority: job.priority,
    attempts: job.attempts,
    run_after: job.run_after,
    updated_at: job.updated_at,
    last_error: job.last_error,
    state,
    claimableAt: state === 'backing off' ? job.run_after : null,
  };
}

export type QueueSnapshot = {
  takenAt: string;
  /** Claim-ordered, so the first entry is genuinely what a drain would take. */
  next: InspectedJob[];
  running: InspectedJob[];
  failed: InspectedJob[];
  backingOff: InspectedJob[];
  depthByKind: Record<string, number>;
  artwork: Record<string, number>;
  worklist: ArtworkWorklist;
  dateCapture: DateCaptureReport;
  /** When a job was last settled — the practical answer to "did work happen?" */
  lastActivityAt: string | null;
  /**
   * What the drain itself last did.
   *
   * **`lastActivityAt` answers a different question**, and the gap is the whole
   * reason this exists: a drain that claimed nothing, stopped on its budget, or
   * skipped because another process held the lease leaves `lastActivityAt`
   * untouched. F-033, `architecture.md` §7.3c.
   */
  lastDrain: LastDrain;
};

export type LastDrain = {
  /** Why the last drain that held the lease stopped. Null before any ran. */
  outcome: string | null;
  at: string | null;
  claimed: number | null;
  /** Drains taken by another process. Monotonic — read against `ran`. */
  skipped: number;
  /** Times the lease was taken, so `skipped` has a denominator. */
  ran: number;
  /** Whether a drain is holding the lease right now. */
  heldNow: boolean;
};

export async function inspectQueue(
  options: { limit?: number; admin?: Admin } = {},
): Promise<QueueSnapshot> {
  const admin = options.admin ?? createAdminClient();
  const limit = options.limit ?? 25;
  const now = new Date();

  // Mirrors the claim exactly, as a read. See the note above.
  const { data: ready, error: readyError } = await admin
    .from('ingestion_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('run_after', now.toISOString())
    .order('priority', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);
  if (readyError) throw readyError;

  const { data: running, error: runningError } = await admin
    .from('ingestion_jobs')
    .select('*')
    .eq('status', 'running')
    .order('updated_at', { ascending: true });
  if (runningError) throw runningError;

  const { data: failed, error: failedError } = await admin
    .from('ingestion_jobs')
    .select('*')
    .eq('status', 'failed')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (failedError) throw failedError;

  const { data: waiting, error: waitingError } = await admin
    .from('ingestion_jobs')
    .select('*')
    .eq('status', 'pending')
    .gt('run_after', now.toISOString())
    .order('run_after', { ascending: true })
    .limit(limit);
  if (waitingError) throw waitingError;

  const { data: allOutstanding, error: depthError } = await admin
    .from('ingestion_jobs')
    .select('kind, status')
    .in('status', ['pending', 'running']);
  if (depthError) throw depthError;

  const depthByKind: Record<string, number> = {};
  for (const row of allOutstanding ?? []) {
    const key = `${row.kind} · ${row.status}`;
    depthByKind[key] = (depthByKind[key] ?? 0) + 1;
  }

  // Through `countRows`, not a raw `head: true`. §16.2's counting contract exists
  // because a bare head count reports zero instead of failing — which on a
  // diagnostic page would be the worst possible failure mode: a confident zero.
  const artwork: Record<string, number> = {};
  for (const status of ['pending', 'found', 'absent', 'failed'] as const) {
    artwork[status] = await countRows(
      admin.from('albums').select('id', COUNT_ONLY).eq('artwork_status', status),
      `albums.artwork_status.${status}`,
    );
  }

  const { data: latest, error: latestError } = await admin
    .from('ingestion_jobs')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (latestError) throw latestError;

  const worklist = await listUncoveredAlbums(admin, {
    absent: artwork.absent ?? 0,
    failed: artwork.failed ?? 0,
  });

  const dateCapture = await checkDateCapture(admin);
  const lastDrain = await readLastDrain(admin, now);

  return {
    takenAt: now.toISOString(),
    next: (ready ?? []).map((job, index) => inspect(job, now, index === 0)),
    running: (running ?? []).map((job) => inspect(job, now, false)),
    failed: (failed ?? []).map((job) => inspect(job, now, false)),
    backingOff: (waiting ?? []).map((job) => inspect(job, now, false)),
    depthByKind,
    artwork,
    worklist,
    dateCapture,
    lastActivityAt: latest?.[0]?.updated_at ?? null,
    lastDrain,
  };
}

/**
 * The drain's own last word, from the lease row.
 *
 * **Read, never written, by this module.** `inspectQueue` is a read-only
 * surface and `queue-view.ts` already states that it must not call
 * `claim_ingestion_jobs`; taking or releasing the lease here would be the same
 * category of mistake.
 *
 * **A missing row is reported as "nothing yet" rather than thrown.** The
 * operator view exists to say what is happening, and failing to render it
 * because one observability field is absent would be the worse outcome.
 */
async function readLastDrain(admin: Admin, now: Date): Promise<LastDrain> {
  const { data } = await admin
    .from('drain_leases')
    .select(
      'last_outcome, last_outcome_at, last_claimed, skipped_count, acquired_count, held_until',
    )
    .eq('id', 'ingest')
    .maybeSingle();

  return {
    outcome: data?.last_outcome ?? null,
    at: data?.last_outcome_at ?? null,
    claimed: data?.last_claimed ?? null,
    skipped: data?.skipped_count ?? 0,
    ran: data?.acquired_count ?? 0,
    heldNow: data ? new Date(data.held_until).getTime() > now.getTime() : false,
  };
}

/** Counts by verdict, plus the albums where something was actually lost. */
export type DateCaptureReport = {
  counts: Record<DateCaptureVerdict, number>;
  /** Only the faults, since only they need looking at. */
  faults: DateCaptureRow[];
  /** Albums checked. Undated albums only — the rest are evidence of nothing. */
  checked: number;
};

/** How many undated albums to examine in one pass. */
const DATE_CAPTURE_LIMIT = 500;

/**
 * Whether any album's missing release date was ours to lose.
 *
 * **`architecture.md` §17c and §7a.** Every upstream response is kept verbatim,
 * so this compares a stored payload against a column with **no MusicBrainz
 * round trip and no rate-limit exposure**.
 *
 * **Payloads are fetched in one batch, not one per album.** That is the N+1 the
 * feed query, the counting contract and the notifications page have each
 * recorded — and here it would be several hundred round trips on a page render.
 *
 * **Reads only.** §17a's service-role client is safe on that page because
 * authorisation runs before the read and this module contains no write verb.
 */
async function checkDateCapture(admin: Admin): Promise<DateCaptureReport> {
  const counts: Record<DateCaptureVerdict, number> = {
    'upstream-empty': 0,
    malformed: 0,
    lost: 0,
    'no-payload': 0,
    unreadable: 0,
  };

  const { data: undated, error } = await admin
    .from('albums')
    .select('mbid, title')
    .is('first_release_date', null)
    .order('created_at', { ascending: false })
    .limit(DATE_CAPTURE_LIMIT);

  if (error) throw error;

  const rows = undated ?? [];
  if (rows.length === 0) return { counts, faults: [], checked: 0 };

  const { data: payloads, error: payloadError } = await admin
    .from('upstream_payloads')
    .select('source_id, payload')
    .eq('kind', 'release_group')
    .in(
      'source_id',
      rows.map((row) => row.mbid),
    );

  if (payloadError) throw payloadError;

  const byId = new Map((payloads ?? []).map((row) => [row.source_id, row.payload]));
  const faults: DateCaptureRow[] = [];

  for (const row of rows) {
    const payload = byId.has(row.mbid) ? byId.get(row.mbid) : null;
    const verdict = classifyMissingDate(payload);
    counts[verdict] += 1;

    if (isCaptureFault(verdict)) {
      faults.push({
        mbid: row.mbid,
        title: row.title,
        verdict,
        payloadValue: payloadDateValue(payload),
      });
    }
  }

  return { counts, faults, checked: rows.length };
}

/**
 * Albums a person could put a cover on, and albums whose fetch broke.
 *
 * **`architecture.md` §17b.** Two groups rather than one, because they ask
 * different things: `absent` means Cover Art Archive holds no image and
 * somebody must upload one; `failed` means **our** fetch broke and the artwork
 * sweep re-queues it on any drain. Presenting the second as a task would ask
 * the maintainer to do work the system is still retrying.
 *
 * **`pending` is in neither group** — it means not attempted yet, which is not
 * actionable and not a failure.
 *
 * **Reads only.** §17a's service-role client is safe on this page because
 * authorisation runs before the read and this module contains no write verb.
 * That second property is the one a future edit could quietly remove.
 *
 * **The embed names its foreign key.** `releases.album_id` and
 * `albums.representative_release_id` are two relationships between the same two
 * tables, so a bare `releases(...)` embed fails outright.
 */
async function listUncoveredAlbums(
  admin: Admin,
  totals: { absent: number; failed: number },
): Promise<ArtworkWorklist> {
  const select = 'id, mbid, title, display_credit, releases!albums_representative_release_fk(mbid)';

  const [absent, failed] = await Promise.all([
    admin
      .from('albums')
      .select(select)
      .eq('artwork_status', 'absent')
      .order('title', { ascending: true })
      .limit(WORKLIST_LIMIT),
    admin
      .from('albums')
      .select(select)
      .eq('artwork_status', 'failed')
      .order('title', { ascending: true })
      .limit(WORKLIST_LIMIT),
  ]);

  if (absent.error) throw absent.error;
  if (failed.error) throw failed.error;

  return {
    missingUpstream: ((absent.data ?? []) as unknown as UncoveredAlbumRow[]).map(toUncoveredAlbum),
    fetchFailed: ((failed.data ?? []) as unknown as UncoveredAlbumRow[]).map(toUncoveredAlbum),
    totals,
    limit: WORKLIST_LIMIT,
  };
}
