import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { listOwnStatements, type Statement } from '@/services/moderation';
import { getCurrentProfile, getCurrentUser } from '@/services/profiles';

/**
 * What an administrator did to your content or your account, and why.
 *
 * **This page is how DSA Art 17 is discharged.** When content is removed or an
 * account restricted, the affected person must be told why — the facts relied
 * on, the ground, and how to dispute it. `architecture.md` §16.10 and
 * `docs/legal-obligations.md` §2.1.
 *
 * **Separate from `/notifications`, because the records are separate.** A
 * notification is glanced at and cascades away when its cause is undone; a
 * statement of reasons is retained and must outlive its subject. §16.10 refused
 * to put one inside the other, and this is the read side of that decision.
 *
 * **Signed out redirects to `/login`; no profile to `/onboarding`** — the
 * treatment `/notifications` and `/feed` already give. Like a notification this
 * is a per-person view rather than user-generated content, so it is not an
 * exception to the all-public rule.
 *
 * **This page performs no write.** Marking notices seen is `/notices/read`, a
 * route handler that writes and redirects here — `architecture.md` §16.10h.
 * **The earlier version wrote during render**, which made every future link to
 * this page responsible for remembering `prefetch={false}`. Now only the hop
 * is, and a link here may prefetch freely.
 *
 * **So arriving directly leaves the banner up.** That is the correct trade: the
 * banner's job is to deliver somebody once, and a badge that cleared on any
 * direct visit would be the harder failure to notice. No per-item dismissal
 * either, because a statement is not a task.
 */

const INLINE_LINK =
  'text-text underline decoration-border-strong underline-offset-4 transition-colors hover:decoration-accent';

/** Plain language per kind. The reader is not an administrator. */
const HEADLINE: Record<Statement['kind'], (subject: string) => string> = {
  content_removed: (subject) => `${subject} was removed`,
  content_restored: (subject) => `${subject} was restored`,
  account_suspended: (subject) => `${subject} was suspended`,
  account_reinstated: (subject) => `${subject} was reinstated`,
};

function Notice({ item }: { item: Statement }) {
  const restrictive = item.kind === 'content_removed' || item.kind === 'account_suspended';

  return (
    <li className="border-b border-border py-5">
      <p className="text-text">{HEADLINE[item.kind](item.subject)}</p>

      <p className="mt-1 text-sm text-text-muted">
        Ground: <span className="text-text">{item.ground}</span>
      </p>

      {item.statement && (
        <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-text">{item.statement}</p>
      )}

      {/*
       * Redress, rendered rather than stored. Art 17 requires the person be
       * told how to dispute the decision, and the route is the address
       * `/moderation` publishes — `architecture.md` §16.10b makes that page the
       * notice-and-action channel this product relies on.
       */}
      {restrictive && (
        <p className="mt-3 text-sm text-text-muted">
          If you think this is wrong, you can dispute it — see{' '}
          <Link href="/moderation" className={INLINE_LINK}>
            how moderation works
          </Link>
          .
        </p>
      )}
    </li>
  );
}

export default async function NoticesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const profile = await getCurrentProfile();
  if (!profile) redirect('/onboarding');

  const items = await listOwnStatements();

  return (
    <Container variant="content">
      <div className="py-10">
        <SectionHeader>Notices</SectionHeader>

        {items.length === 0 ? (
          <p className="mt-6 max-w-[46ch] text-sm leading-relaxed text-text-muted">
            Nothing here. This page shows moderation decisions about your content or your account,
            and there have been none.{' '}
            <Link href="/moderation" className={INLINE_LINK}>
              How moderation works
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-2">
            {items.map((item) => (
              <Notice key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </Container>
  );
}
