import type { ReactNode } from 'react';

import { Container } from '@/components/Container';

/**
 * Shared composition for the three account surfaces — sign in, create account
 * and choose a handle.
 *
 * They live in two different route trees (`(auth)/` and `onboarding/`), so a
 * route-group layout cannot cover all three. A component can, and consistency
 * across them is the point: a user meets all three within a minute of arriving,
 * and any difference between them reads as a bug rather than as variety.
 *
 * Centred vertically, like Home, because these pages are short and top-aligning
 * them leaves most of the screen empty below the fold. The min-height stops
 * applying once content is taller than the band, which is what happens at phone
 * width with the keyboard open, so nothing is ever trapped under the fixed tab
 * bar.
 *
 * The title is Geist, not Newsreader. Per design-reference.md §11.7 the serif is
 * reserved for headings that name something the catalogue holds; "Sign in" names
 * a task, and setting it in the editorial face would claim a register this page
 * does not have.
 */

type Props = {
  title: string;
  /** One line at most. These pages should not need explaining. */
  description?: string;
  children: ReactNode;
  /** The route out — the other account action, or nothing. */
  footer?: ReactNode;
};

export function AuthShell({ title, description, children, footer }: Props) {
  return (
    <Container variant="content">
      <div className="flex min-h-[calc(100dvh-12rem)] flex-col justify-center py-10">
        {/*
         * Capped well below the 1120px content measure. A 1120px-wide email
         * field is not a form, it is a horizon — and the eye has to travel the
         * whole width to get from the label to the value.
         */}
        <div className="mx-auto w-full max-w-[22rem]">
          <h1 className="text-2xl font-semibold tracking-tight text-text">{title}</h1>

          {description && (
            <p className="mt-2 text-sm leading-relaxed text-text-muted">{description}</p>
          )}

          <div className="mt-7">{children}</div>

          {footer && <div className="mt-7 text-sm text-text-muted">{footer}</div>}
        </div>
      </div>
    </Container>
  );
}
