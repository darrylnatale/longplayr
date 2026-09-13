import { createAdminClient } from '@/lib/supabase/admin';
import { COUNT_ONLY, countRows } from '@/services/count';

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
  /** When a job was last settled — the practical answer to "did a drain run?" */
  lastActivityAt: string | null;
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

  return {
    takenAt: now.toISOString(),
    next: (ready ?? []).map((job, index) => inspect(job, now, index === 0)),
    running: (running ?? []).map((job) => inspect(job, now, false)),
    failed: (failed ?? []).map((job) => inspect(job, now, false)),
    backingOff: (waiting ?? []).map((job) => inspect(job, now, false)),
    depthByKind,
    artwork,
    lastActivityAt: latest?.[0]?.updated_at ?? null,
  };
}
