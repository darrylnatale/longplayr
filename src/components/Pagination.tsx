import Link from 'next/link';

import { pageWindow } from './page-window';

/**
 * Previous and Next rather than Newer and Older.
 *
 * The collection destination uses the time-flavoured pair because its axis is
 * when albums were added and the reader is moving through a history. A
 * relationship list is ordered newest first too, but the reader is looking for
 * a *person*, not scrubbing a timeline — "Older followers" describes the
 * ordering rather than what the reader is doing, so the neutral pair is
 * honest where the other would be decorative.
 *
 * **It is now the only pager.** The collection and lists destinations each
 * carried their own copy of this markup until 2026-10-02 — which F-046's own
 * entry had not noticed, and which would have left `design-reference.md` §13
 * claiming one control served every surface while two did not use it.
 *
 * **Extracted from `RelationshipPage` on 2026-09-16**, when the catalogue-wide
 * destination became a second consumer. It was already written generically —
 * an `href` callback and a label — so extraction changed nothing about it.
 * Unlike `pageFrom`, which `[handle]/pagination.ts` records as deliberately
 * duplicated, there is no decision here to duplicate: copying forty lines of
 * markup is a worse trade than copying four lines of parsing.
 *
 * **Page numbers as well as Previous and Next, since 2026-10-02.** You could
 * not reach page 5 without clicking through to it — F-046. The window is
 * computed by `pageWindow`, which keeps the control a fixed width however
 * large the catalogue grows, so **the three consumers need no variant between
 * them**: a two-page follower list shows two numbers, a forty-page catalogue
 * shows a window. `design-reference.md` §13.
 *
 * Renders nothing when everything fits on one page.
 */
export function Pagination({
  page,
  totalPages,
  href,
  label,
  backward = 'Previous',
  forward = 'Next',
}: {
  page: number;
  totalPages: number;
  href: (page: number) => string;
  label: string;
  /**
   * **Newer / Older where the leading key is a date running newest first.**
   * The collection destination passes them under Added, Listened and Year, and
   * the neutral pair under Rating, Title and Artist — where those words are
   * simply untrue. Carried here on 2026-10-02 when the two inline copies of
   * this markup were retired into it; previously the label difference was the
   * stated reason they were separate, which made it the reason to support it
   * rather than to duplicate forty lines. `design-reference.md` §13.
   */
  backward?: string;
  forward?: string;
}) {
  if (totalPages <= 1) return null;

  const link = 'rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text';

  return (
    <nav
      aria-label={label}
      className="mt-8 flex items-center justify-between border-t border-border pt-4"
    >
      <div className="flex-1">
        {page > 1 && (
          <Link href={href(page - 1)} rel="prev" className={link}>
            <span aria-hidden>←</span> {backward}
          </Link>
        )}
      </div>

      {/*
       * **An ordered list, because it is one.** The numbers are a sequence a
       * reader moves through, and a screen reader announcing "list, 7 items"
       * is more use here than a row of anonymous links.
       *
       * The current page is a `span` rather than a link, so it cannot be
       * clicked to go where you already are, and carries `aria-current`.
       */}
      {/*
       * **No `aria-label` on the list.** Callers pass the complete nav label
       * — "Catalogue pages", "Collection pages" — so deriving one here read
       * "Catalogue pages pages". The surrounding `nav` already names this, and
       * a list inside a labelled landmark needs no second name.
       */}
      <ol className="flex items-center gap-1">
        {pageWindow(page, totalPages).map((slot, i) =>
          slot === 'gap' ? (
            // Keyed on position: two gaps in one window are not distinguishable
            // by value, and there is never more than one at each end.
            <li key={`gap-${i}`} aria-hidden className="px-1 text-xs text-text-faint">
              …
            </li>
          ) : (
            <li key={slot}>
              {slot === page ? (
                <span
                  aria-current="page"
                  className="tabular rounded-sm px-2 py-1.5 text-xs font-medium text-text"
                >
                  {slot}
                </span>
              ) : (
                <Link
                  href={href(slot)}
                  aria-label={`Page ${slot}`}
                  className={`tabular ${link.replace('px-3', 'px-2')}`}
                >
                  {slot}
                </Link>
              )}
            </li>
          ),
        )}
      </ol>

      <div className="flex flex-1 justify-end">
        {page < totalPages && (
          <Link href={href(page + 1)} rel="next" className={link}>
            {forward} <span aria-hidden>→</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
