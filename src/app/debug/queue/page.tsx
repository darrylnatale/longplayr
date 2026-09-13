import { notFound } from 'next/navigation';

import { Container } from '@/components/Container';
import { inspectQueue, type InspectedJob } from '@/services/catalogue/queue-view';
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
