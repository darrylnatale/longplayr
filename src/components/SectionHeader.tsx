import type { ReactNode } from 'react';

/**
 * Small uppercase label, hairline rule to the right edge, optional trailing
 * link or count.
 *
 * Borrowed wholesale from the structural reference, where it recurs on every
 * long page (docs/design-reference.md §3). It costs almost nothing and it is
 * what makes a page of stacked sections scannable instead of undifferentiated.
 */

type Props = {
  children: ReactNode;
  /** Right-aligned affordance — a count, or a "More" link. */
  trailing?: ReactNode;
  as?: 'h2' | 'h3';
};

export function SectionHeader({ children, trailing, as: Tag = 'h2' }: Props) {
  return (
    <div className="mb-3 flex items-baseline gap-4 border-b border-border pb-2">
      <Tag className="text-xs font-medium uppercase tracking-widest text-text-muted">
        {children}
      </Tag>
      <span className="h-px flex-1" aria-hidden />
      {trailing && <span className="text-xs text-text-muted">{trailing}</span>}
    </div>
  );
}
