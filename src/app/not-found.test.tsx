import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import NotFound from './not-found';

/**
 * The not-found page - `architecture.md` section 13.1.
 *
 * **The first component test in this repository**, and it exists because the
 * cycle that wrote the page could not write it. The `component` vitest project
 * has been configured since Phase 0 and had never matched a file, so nobody
 * had discovered that it cannot run on Node 20: jsdom reaches an ESM-only
 * dependency through a CommonJS `require`, which Node only supports from
 * 22.12. CI was already on 22; this machine was not, and nothing pinned it
 * (F-062).
 *
 * **What is under test is mostly what the page does *not* say.** The wording
 * is generic on purpose: `admin/page.tsx` calls `notFound()` rather than
 * returning a 403 so a visitor who is not an admin cannot learn the admin
 * surface exists, and four further call sites fire on a profile that is not
 * `active`, where naming the cause would leak a moderation outcome.
 *
 * **These assertions exist to fail when somebody makes this page friendlier.**
 */
describe('NotFound', () => {
  it('says something, which is more than the framework default did here', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { name: /can.t find that page/i })).toBeInTheDocument();
  });

  it('offers a way onward', () => {
    render(<NotFound />);

    expect(screen.getByRole('link', { name: /browse every album/i })).toHaveAttribute(
      'href',
      '/albums',
    );
    expect(screen.getByRole('link', { name: /search for something/i })).toHaveAttribute(
      'href',
      '/search',
    );
    expect(screen.getByRole('link', { name: /home page/i })).toHaveAttribute('href', '/');
  });

  it('never names the cause', () => {
    render(<NotFound />);
    const text = document.body.textContent ?? '';

    // **The security assertion.** Any of these would separate "no such record"
    // from "you may not see this", which is the distinction `notFound()` is
    // chosen over a 403 precisely to hide.
    for (const leak of [
      /\badmin\b/i,
      /suspend/i,
      /\bremoved\b/i,
      /permission/i,
      /not allowed/i,
      /does not exist/i,
    ]) {
      expect(text).not.toMatch(leak);
    }
  });

  it('does not say what kind of thing was missing', () => {
    render(<NotFound />);

    // One page serves albums, artists, profiles, lists and the admin surface.
    // Naming any of them is how a generic page stops being generic.
    //
    // Scoped to the prose rather than the whole page: the navigation offer
    // mentions albums as a *destination*, which asserts nothing about what was
    // being looked for.
    const prose = screen.getByText(/the link may be out of date/i).textContent ?? '';
    expect(prose).not.toMatch(/\b(album|artist|profile|list|user|page you)\b/i);
  });
});
