import type { ReactNode } from 'react';

/**
 * Page width.
 *
 * Two widths, kept explicit rather than merged into one compromise value:
 *
 *   content  1120px. Reading surfaces — album, artist, review, settings. Wide
 *            enough for a three-column detail layout, narrow enough that a
 *            review body lands near a 60-68ch measure.
 *   wide     min(94vw, 1680px). Grid surfaces. A twelve-across square grid at
 *            1120px would give ~78px cells, which is too small to recognise a
 *            cover by — so grids get their own width rather than shrinking to
 *            fit the text measure.
 *
 * Passing the variant is deliberate. Defaulting it would let the wrong width
 * spread by omission, which is exactly how grid geometry ends up decided by
 * whichever component happened to be written first.
 */

type Props = {
  variant: 'content' | 'wide';
  children: ReactNode;
  className?: string;
};

const WIDTH = {
  content: 'max-w-[var(--width-content)]',
  wide: 'max-w-[var(--width-wide)]',
} as const;

export function Container({ variant, children, className = '' }: Props) {
  return (
    <div className={`mx-auto w-full px-4 sm:px-6 ${WIDTH[variant]} ${className}`}>{children}</div>
  );
}
