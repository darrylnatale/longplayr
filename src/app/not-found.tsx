import Link from 'next/link';

import { Container } from '@/components/Container';

/**
 * Where every missing page lands - `architecture.md` section 13.1.
 *
 * **Before this existed, a 404 rendered nothing at all.** Not Next.js's own
 * "404 | This page could not be found" - an empty `<div hidden>`, measured on
 * production. There are **24 `notFound()` call sites** across profiles,
 * collections, lists, albums, artists and the admin surface, and every one of
 * them led a reader to a blank screen.
 *
 * **It deliberately does not say why, and that is a security property rather
 * than a copy choice.** `admin/page.tsx` calls `notFound()` instead of
 * returning a 403 precisely so a visitor who is not an admin cannot learn the
 * admin surface exists, and four further call sites fire on a profile that is
 * not `active`, where naming the cause would leak a moderation outcome.
 *
 * **So one generic message serves every cause, and must continue to.** A
 * friendlier "we don't have that album" would make an admin probe
 * distinguishable from a missing record by its response body - reintroducing,
 * in the error page, the exact disclosure `notFound()` was chosen to avoid.
 */
export default function NotFound() {
  return (
    <Container variant="content">
      <div className="flex flex-col gap-5 py-10 sm:py-16">
        <h1 className="font-serif text-3xl leading-[1.15] text-text sm:text-4xl">
          We can&rsquo;t find that page
        </h1>

        <p className="text-base text-text-secondary">
          The link may be out of date, or the address may have a typo in it.
        </p>

        {/*
         * The part that earns the page. A dead end was the defect; somewhere to
         * go is the fix.
         */}
        <p className="text-base text-text-secondary">
          You can{' '}
          <Link
            href="/albums"
            className="text-accent underline decoration-accent-dim underline-offset-4 transition-colors hover:decoration-accent"
          >
            browse every album
          </Link>
          ,{' '}
          <Link
            href="/search"
            className="text-accent underline decoration-accent-dim underline-offset-4 transition-colors hover:decoration-accent"
          >
            search for something
          </Link>
          , or go back to the{' '}
          <Link
            href="/"
            className="text-accent underline decoration-accent-dim underline-offset-4 transition-colors hover:decoration-accent"
          >
            home page
          </Link>
          .
        </p>
      </div>
    </Container>
  );
}
