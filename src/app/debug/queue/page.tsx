import { notFound } from 'next/navigation';

import { Container } from '@/components/Container';
import { inspectQueue, type InspectedJob } from '@/services/catalogue/queue-view';
import type { UncoveredAlbum } from '@/services/catalogue/artwork-worklist';
import { authoriseQueueView } from '@/services/catalogue/queue-view-auth';

/**
 * Temporary operator surface for the ingestion queue. `architecture.md` §17a.
 *
 * **This is a diagnostic, not a feature.** It is unlinked, `noindex`, read-only,
 * and it exists because queue state has been observable only by querying the
 * deployed database by hand — so "is it failed or just waiting for the cron?" was
 * a question nobody could answer from the product.
 *
 * **It is scheduled for removal**, and the trigger is printed on the page so it
 * travels with the thing rather than living only in a document.
 */

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const STATE_TONE: Record<InspectedJob['state'], string> = {
  'running now': 'text-text',
  'next to be claimed': 'text-accent',
  'waiting for a drain': 'text-text-secondary',
  'backing off': 'text-text-muted',
  'terminally failed — awaiting the sweep': 'text-like',
};

function Rows({ jobs, empty }: { jobs: InspectedJob[]; empty: string }) {
  if (jobs.length === 0) return <p className="text-sm text-text-muted">{empty}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
            <th className="py-2 pr-4 font-normal">#</th>
            <th className="py-2 pr-4 font-normal">Kind</th>
            <th className="py-2 pr-4 font-normal">Target</th>
            <th className="py-2 pr-4 font-normal">Pri</th>
            <th className="py-2 pr-4 font-normal">Att</th>
            <th className="py-2 pr-4 font-normal">State</th>
            <th className="py-2 font-normal">Last error</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className="border-b border-border/50 align-top">
              <td className="tabular py-2 pr-4 text-text-muted">{job.id}</td>
              <td className="py-2 pr-4">{job.kind}</td>
              <td className="py-2 pr-4 font-mono text-xs">{job.target_mbid}</td>
              <td className="tabular py-2 pr-4">{job.priority}</td>
              <td className="tabular py-2 pr-4">{job.attempts}</td>
              <td className={`py-2 pr-4 ${STATE_TONE[job.state]}`}>
                {job.state}
                {job.claimableAt && (
                  <span className="block text-xs text-text-faint">
                    until {job.claimableAt.slice(11, 16)}Z
                  </span>
                )}
              </td>
              <td className="py-2 text-xs text-text-muted">
                {job.last_error ? job.last_error.slice(0, 160) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One group of uncovered albums.
 *
 * **The count is the true total, not the number of rows shown**, and the page
 * says so when they differ. A capped list that reported its own length would be
 * a confidently wrong number on a diagnostic — the failure §16.2's counting
 * contract exists to prevent.
 */
function Worklist({
  label,
  albums,
  total,
  limit,
  empty,
}: {
  label: string;
  albums: UncoveredAlbum[];
  total: number;
  limit: number;
  empty: string;
}) {
  return (
    <div>
      <h3 className="text-xs font-medium text-text-secondary">
        {label}
        <span className="tabular ml-2 font-normal text-text-muted">{total}</span>
      </h3>

      {albums.length === 0 ? (
        <p className="mt-2 text-xs text-text-faint">{empty}</p>
      ) : (
        <>
          <ul className="mt-2 flex flex-col gap-1">
            {albums.map((album) => (
              <li key={album.id} className="flex items-baseline justify-between gap-4 text-xs">
                <span className="min-w-0 truncate text-text">
                  {album.title}
                  <span className="ml-2 text-text-muted">{album.credit}</span>
                </span>

                {/*
                 * A row with no representative release has nowhere to link to.
                 * It is still listed, with the reason — dropping it would leave
                 * the list disagreeing with the count above it.
                 */}
                {album.addCoverArtUrl ? (
                  <a
                    href={album.addCoverArtUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-accent underline underline-offset-2"
                  >
                    Add art ↗
                  </a>
                ) : (
                  <span className="shrink-0 text-text-faint">no release to link to</span>
                )}
              </li>
            ))}
          </ul>

          {total > limit && (
            <p className="mt-2 text-xs text-text-faint">
              Showing the first <span className="tabular">{limit}</span> of{' '}
              <span className="tabular">{total}</span>.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Counts({ label, counts }: { label: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-text-muted">{label}</h2>
      {entries.length === 0 ? (
        <p className="mt-1 text-sm text-text-muted">nothing</p>
      ) : (
        <ul className="mt-1 text-sm">
          {entries.map(([key, n]) => (
            <li key={key}>
              <span className="tabular">{n}</span> {key}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function QueueViewPage({ searchParams }: PageProps<'/debug/queue'>) {
  const { key } = await searchParams;

  const auth = authoriseQueueView({
    key: typeof key === 'string' ? key : null,
    secret: process.env.QUEUE_VIEW_SECRET,
    isProduction: process.env.NODE_ENV === 'production',
  });

  /*
   * **`notFound()` rather than a 401, deliberately.** An unauthorised visitor
   * should not learn that this path exists, and the reason for refusal is not
   * theirs to know. The rule itself is unit-tested in `queue-view-auth.test.ts`,
   * so nothing here depends on being able to read the failure from a response.
   */
  if (!auth.authorised) notFound();

  const snapshot = await inspectQueue();

  return (
    <Container variant="wide">
      <header className="border-b border-border pb-6">
        <h1 className="font-serif text-3xl text-text">Ingestion queue</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Read-only. Nothing on this page claims, mutates or spends a job&rsquo;s attempts.
        </p>
        <p className="mt-2 text-sm text-text-muted">
          Snapshot{' '}
          <span className="tabular">{snapshot.takenAt.slice(0, 19).replace('T', ' ')}Z</span>
          {' · last job settled '}
          <span className="tabular">
            {snapshot.lastActivityAt
              ? snapshot.lastActivityAt.slice(0, 19).replace('T', ' ') + 'Z'
              : 'never'}
          </span>
        </p>

        {/*
         * **The drain's own last word, which "last activity" does not give.**
         * A drain that claimed nothing, stopped on its budget, or skipped
         * because another process held the lease leaves `lastActivityAt`
         * untouched — F-033, `architecture.md` §7.3c.
         *
         * `skipped` is monotonic and is shown against `ran` on purpose: the
         * useful reading is a ratio, and a high one means page views are
         * routinely arriving while a drain is already in flight, which is the
         * lease working rather than a fault.
         */}
        <p className="mt-1 text-sm text-text-muted">
          Last drain:{' '}
          <span className="tabular text-text">
            {snapshot.lastDrain.outcome
              ? `${snapshot.lastDrain.outcome}, ${snapshot.lastDrain.claimed ?? 0} claimed`
              : 'never'}
          </span>
          {snapshot.lastDrain.at && (
            <>
              {' at '}
              <span className="tabular text-text">
                {snapshot.lastDrain.at.slice(0, 19).replace('T', ' ')}Z
              </span>
            </>
          )}
          {snapshot.lastDrain.heldNow && <span className="ml-2 text-accent">running now</span>}
        </p>
        <p className="mt-1 text-sm text-text-muted">
          Drains: <span className="tabular text-text">{snapshot.lastDrain.ran} ran</span>,{' '}
          <span className="tabular text-text">{snapshot.lastDrain.skipped} skipped</span>{' '}
          <span className="text-text-faint">(another process already draining)</span>
        </p>

        <p className="mt-3 text-xs text-text-faint">
          <strong>Temporary.</strong> Remove this page when the ingestion queue is no longer under
          active investigation, or when longplayr takes its first real users — whichever comes
          first. <code>architecture.md</code> §17a.
        </p>
      </header>

      <div className="mt-8 flex flex-col gap-10">
        <div className="grid gap-8 sm:grid-cols-2">
          <Counts label="Outstanding jobs" counts={snapshot.depthByKind} />
          <Counts label="Album artwork" counts={snapshot.artwork} />
        </div>

        {/*
         * **The one section of this page that is a task rather than a reading.**
         * Everything above tells the maintainer what the queue is doing; this
         * tells them what only a person can do. `architecture.md` §17b.
         *
         * **The two groups are kept apart deliberately.** "No art upstream" is
         * work for a human; "our fetch failed" is work the sweep is already
         * retrying, and presenting them together would ask for effort the
         * system has not finished spending.
         */}
        {/*
         * **Whether a missing release date was ever ours to lose**
         * (`architecture.md` §17c). An album with no year is usually upstream
         * truth; one whose stored payload held a date is not. §7a keeps every
         * response verbatim, so this costs no MusicBrainz request.
         *
         * **It reports and never corrects.** A backfill rewrites catalogue rows
         * and is a separate decision — a fault found here does not silently
         * become a migration.
         */}
        <section>
          <h2 className="text-sm font-medium text-text">
            Albums with no release year
            <span className="ml-2 text-xs font-normal text-text-muted">
              upstream truth, or something we dropped
            </span>
          </h2>

          <div className="mt-3">
            {snapshot.dateCapture.checked === 0 ? (
              <p className="text-xs text-text-faint">Every album carries a release date.</p>
            ) : (
              <>
                <Counts
                  label={`Checked ${snapshot.dateCapture.checked}`}
                  counts={snapshot.dateCapture.counts}
                />

                {snapshot.dateCapture.faults.length === 0 ? (
                  <p className="mt-3 text-xs text-text-faint">
                    No album lost a date the payload was holding. Every missing year is upstream
                    truth.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-1">
                    {snapshot.dateCapture.faults.map((fault) => (
                      <li
                        key={fault.mbid}
                        className="flex items-baseline justify-between gap-4 text-xs"
                      >
                        <span className="min-w-0 truncate text-text">
                          {fault.title}
                          <span className="ml-2 text-text-muted">{fault.verdict}</span>
                        </span>
                        <span className="shrink-0 text-text-faint">
                          payload held {fault.payloadValue ?? '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-text">
            Albums with no cover art
            <span className="ml-2 text-xs font-normal text-text-muted">
              the only part of this page that needs a person
            </span>
          </h2>

          <div className="mt-3 flex flex-col gap-6">
            <Worklist
              label="No art upstream — someone must upload one"
              albums={snapshot.worklist.missingUpstream}
              total={snapshot.worklist.totals.absent}
              limit={snapshot.worklist.limit}
              empty="Every album Cover Art Archive holds art for has it."
            />
            <Worklist
              label="Our fetch failed — the sweep re-queues these, nothing to do"
              albums={snapshot.worklist.fetchFailed}
              total={snapshot.worklist.totals.failed}
              limit={snapshot.worklist.limit}
              empty="No artwork fetch is currently in a failed state."
            />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-text">
            Next to be claimed
            <span className="ml-2 text-xs font-normal text-text-muted">
              same order a drain uses — priority, then id
            </span>
          </h2>
          <div className="mt-3">
            <Rows jobs={snapshot.next} empty="Nothing is ready to claim." />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-text">Running</h2>
          <p className="mt-1 text-xs text-text-muted">
            More than one, or one for a long time, means a drain was killed mid-job. Reclaim is 90
            minutes and only fires when a drain starts.
          </p>
          <div className="mt-3">
            <Rows jobs={snapshot.running} empty="Nothing running." />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-text">Backing off</h2>
          <p className="mt-1 text-xs text-text-muted">
            Tried and failed, waiting out 30s / 5min / 30min before the next attempt.
          </p>
          <div className="mt-3">
            <Rows jobs={snapshot.backingOff} empty="Nothing backing off." />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-text">Terminally failed</h2>
          <p className="mt-1 text-xs text-text-muted">
            Attempts exhausted. An expansion here is re-queued by the sweep 24 hours after its last
            failure; artwork is re-queued by the artwork sweep on any drain.
          </p>
          <div className="mt-3">
            <Rows jobs={snapshot.failed} empty="Nothing terminally failed." />
          </div>
        </section>
      </div>
    </Container>
  );
}
