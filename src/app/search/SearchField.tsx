'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The search input, which searches as you type - F-002.
 *
 * **It updates the URL rather than holding results in client state**, so the
 * page stays a server component and there is exactly one renderer for a
 * result row. A client-side results list would be a second implementation of
 * the same markup, free to drift from the server's.
 *
 * **`replace`, not `push`.** Typing nine characters must not leave nine
 * entries for the back button to walk out of.
 *
 * **`scroll: false`**, because a result list that jumps to the top on every
 * keystroke is worse than pressing enter was.
 */

/**
 * How long typing must pause before the URL moves.
 *
 * **Chosen for the upstream request, not for the local one.** The catalogue
 * search is ~24ms measured, so local results could update far more eagerly.
 * What costs is the MusicBrainz panel the same render triggers: up to three
 * requests against a ceiling of **one per second**. At 400ms, typing a query
 * straight through produces **one** navigation.
 */
const DEBOUNCE_MS = 400;

export function SearchField({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  /*
   * **The committed query, tracked so an unchanged one is never re-navigated.**
   * Without it, returning to a value already in the URL - deleting a character
   * and retyping it - would fire another render and another upstream search
   * for a query whose results are already on screen.
   */
  const committed = useRef(initialQuery);

  useEffect(() => {
    if (value === committed.current) return;

    const timer = setTimeout(() => {
      committed.current = value;
      const trimmed = value.trim();
      router.replace(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search', {
        scroll: false,
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value, router]);

  return (
    <input
      id="q"
      name="q"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      placeholder="Search albums, artists, people"
      autoFocus
      autoComplete="off"
      /*
       * **Still a real form field.** The surrounding `<form action="/search">`
       * is left in place, so with scripting off this submits on enter exactly
       * as it did before - the as-you-type behaviour is an enhancement rather
       * than a replacement.
       */
      className="w-full rounded-md border border-border bg-surface py-3 pl-11 pr-4 text-base text-text outline-none transition-colors placeholder:text-text-faint focus:border-accent-dim"
    />
  );
}
