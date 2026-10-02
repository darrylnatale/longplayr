import Link from 'next/link';

/**
 * A moderation decision the person has not read yet.
 *
 * **Deliberately intrusive, and that is the whole justification.** DSA Art 17
 * requires that someone whose content is removed or whose account is restricted
 * **is told** — providing a page they might find does not discharge it. A
 * dismissible dot in a navigation bar can be missed for weeks; this cannot.
 *
 * **It is not folded into the notification badge, which was the obvious
 * shortcut.** That badge counts `notifications` and leads to `/notifications`.
 * Adding statements to it would make one number mean two things and send the
 * reader to the wrong page — and `architecture.md` §16.10 separated these
 * records precisely because they are not the same kind of thing.
 *
 * **It clears itself when `/notices` is read**, so there is no dismiss control
 * to ignore.
 */
export function NoticeBanner({ count }: { count: number }) {
  if (count < 1) return null;

  return (
    <div role="status" className="border-b border-danger/40 bg-danger/10">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-2.5 sm:px-6">
        <p className="text-sm text-danger-text">
          {count === 1
            ? 'A moderation decision affects your content or your account.'
            : `${count} moderation decisions affect your content or your account.`}{' '}
          {/*
           * **Points at the hop, and `prefetch={false}` is load-bearing here.**
           * `/notices/read` marks everything seen and redirects, so prefetching
           * *this* link would clear the banner on hover — the one thing it
           * exists not to do.
           *
           * **The flag now lives in exactly one place**, which is the whole
           * point of §16.10h: when the write was inside `/notices`, every
           * future link to that page carried this responsibility. A link to
           * `/notices` may now prefetch freely.
           */}
          <Link
            href="/notices/read"
            prefetch={false}
            className="font-medium underline underline-offset-4"
          >
            Read why
          </Link>
        </p>
      </div>
    </div>
  );
}
