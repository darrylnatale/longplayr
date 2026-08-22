import { SectionHeader } from '@/components/SectionHeader';
import { searchUpstream } from '@/services/catalogue/self-service';

import { AddFromUpstream } from './AddFromUpstream';

/**
 * The MusicBrainz fallback, streamed.
 *
 * **This component exists to hold one `await` away from the page.** The search
 * page used to await `searchUpstream` in its own body, before returning any
 * JSX, so nothing painted — not even catalogue results already in hand — until
 * MusicBrainz answered. MusicBrainz is rate-limited to one request per second
 * and is not quick; that is a measured ~20s on the deployed environment.
 *
 * Rendered inside a `<Suspense>` boundary, this resolves independently: local
 * results and the local empty state are sent immediately, and the panel arrives
 * whenever it arrives (`product-spec.md` §6, `[DECIDED 2026-08-22]`).
 *
 * **It does not make MusicBrainz faster, and nothing here should try.** The
 * upstream request costs what it costs. What changed is that the rest of the
 * page no longer waits for it.
 *
 * **The first Suspense boundary in this repository**, so the pattern is spelled
 * out rather than assumed: the boundary lives in the page, this component is an
 * async Server Component, and the only client component inside it —
 * `AddFromUpstream` — is unchanged and hydrates from the streamed chunk exactly
 * as it did from a blocking render.
 */

const ROW = 'border-b border-border/50 last:border-0';

/**
 * Stands in for the cover an upstream candidate does not have.
 *
 * Keeps the row aligned with catalogue results without impersonating one: a
 * dashed outline and a plus read as "could be added", where a grey square would
 * read as "cover missing" and imply we already hold the record.
 */
function AddSlot() {
  return (
    <div
      aria-hidden
      className="flex aspect-square w-12 shrink-0 items-center justify-center rounded-[var(--radius-cover)] border border-dashed border-border-strong text-text-faint"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/**
 * Shown while the upstream request is outstanding.
 *
 * Quiet and textual rather than a skeleton. A shimmering placeholder would
 * over-promise for a section that is deliberately subordinate — these are not
 * catalogue records, they are records we could hold — and at twenty seconds,
 * showing nothing at all would read as a page that had finished and found
 * nothing.
 */
export function UpstreamPending({ centred = false }: { centred?: boolean }) {
  return (
    <p className={`text-xs text-text-faint ${centred ? 'text-center' : ''}`}>
      Searching MusicBrainz…
    </p>
  );
}

export async function UpstreamPanel({
  query,
  nothingLocal,
}: {
  query: string;
  nothingLocal: boolean;
}) {
  const candidates = await searchUpstream(query, 5);

  if (candidates.length === 0) {
    // Nothing upstream either. When the catalogue also held nothing, this is
    // where the "try a different spelling" advice belongs — it is the same
    // condition the page used to evaluate as `nothingAtAll`, moved to the point
    // where the information exists. Offering it before MusicBrainz had answered
    // would have been telling someone to give up while a result was still on
    // its way.
    //
    // When there were local results, the absence of this section is the whole
    // answer: no empty panel, and no "nothing found upstream" notice.
    if (!nothingLocal) return null;

    return (
      <p className="mx-auto max-w-[46ch] text-center text-sm text-text-muted">
        Try a different spelling, or search for the artist instead.
      </p>
    );
  }

  return (
    <section className="rounded-md border border-border bg-surface/50 p-4 sm:p-5">
      <SectionHeader as="h3">Not in longplayr yet</SectionHeader>
      <p className="-mt-1 mb-2 text-xs text-text-muted">
        Found in MusicBrainz. Adding one brings it into the catalogue for everyone.
      </p>
      <ul className="flex flex-col">
        {candidates.map((candidate) => (
          <li key={candidate.mbid} className={`flex items-center gap-4 py-2.5 ${ROW}`}>
            <AddSlot />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-text-secondary">{candidate.title}</p>
              <p className="truncate text-xs text-text-muted">
                {candidate.credit}
                {candidate.year && <span className="tabular"> · {candidate.year}</span>}
                {candidate.primaryType && ` · ${candidate.primaryType}`}
              </p>
            </div>
            <AddFromUpstream mbid={candidate.mbid} />
          </li>
        ))}
      </ul>
    </section>
  );
}
