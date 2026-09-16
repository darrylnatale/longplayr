import Link from 'next/link';

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
 * **Extracted from `RelationshipPage` on 2026-09-16**, when the catalogue-wide
 * destination became a second consumer. It was already written generically —
 * an `href` callback and a label — so extraction changed nothing about it.
 * Unlike `pageFrom`, which `[handle]/pagination.ts` records as deliberately
 * duplicated, there is no decision here to duplicate: copying forty lines of
 * markup is a worse trade than copying four lines of parsing.
 *
 * Renders nothing when everything fits on one page.
 */
export function Pagination({
  page,
  totalPages,
  href,
  label,
}: {
  page: number;
  totalPages: number;
  href: (page: number) => string;
  label: string;
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
            <span aria-hidden>←</span> Previous
          </Link>
        )}
      </div>

      <p className="tabular text-xs text-text-faint">
        Page {page} of {totalPages}
      </p>

      <div className="flex flex-1 justify-end">
        {page < totalPages && (
          <Link href={href(page + 1)} rel="next" className={link}>
            Next <span aria-hidden>→</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
