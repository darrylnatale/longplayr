import Link from 'next/link';

import { Container } from '@/components/Container';

/**
 * How moderation works, stated publicly.
 *
 * **A legal obligation rather than a courtesy.** DSA Art 14 requires a provider
 * to state the restrictions it imposes on use of its service — content
 * moderation policies, procedures, measures and tools — in clear, plain,
 * intelligible language. It applies to every intermediary service with **no
 * micro-enterprise exclusion**. `docs/legal-obligations.md` §2.1.
 *
 * **It describes only what the product actually does.** Every sentence here is
 * checkable against the code: the statuses in `20260818120000`, the enforcement
 * in `architecture.md` §16.9, the admin surface from §92, the deletion cascade
 * from §87. **Nothing describes a process that does not exist**, which is the
 * failure this kind of page usually has — and which would be worse than having
 * no page, because it would be a published claim that is untrue.
 *
 * **It is deliberately not "Terms and Conditions".** A full terms document
 * carries liability, governing law and contract formation, and belongs to a
 * lawyer. This discharges the *substance* Art 14 asks for — what is restricted
 * and how — and says so.
 */

export const metadata = {
  title: 'Moderation · longplayr',
  description: 'What can be reported, what happens then, and what longplayr does about it.',
};

const UPDATED = '24 September 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium text-text">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-text-muted">
        {children}
      </div>
    </section>
  );
}

export default function ModerationPage() {
  return (
    <Container variant="content" className="py-10">
      <h1 className="font-serif text-3xl text-text">How moderation works</h1>
      <p className="mt-3 max-w-prose text-sm text-text-muted">Last updated {UPDATED}.</p>

      <div className="max-w-prose">
        <Section title="Everything here is public">
          <p>
            Collections, ratings, reviews, lists and profiles are visible to anyone, whether or not
            they have an account. There are no private accounts and no per-item visibility settings.
            Treat anything you write here as published.
          </p>
          <p>
            The one exception is your notifications, which only you can see, and your email address,
            which is never shown to anyone.
          </p>
        </Section>

        <Section title="What you can report">
          <p>You can report a review, a list, or an account. The reasons are:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li>Spam or advertising</li>
            <li>Harassment or hate</li>
            <li>Sexual or violent content</li>
            <li>Illegal content</li>
            <li>Something else, with a short explanation</li>
          </ul>
          <p>
            {/*
             * Stated plainly because it is true today, and a page that implied a
             * working mechanism would be a published falsehood. This paragraph
             * is removed by the slice that builds reporting.
             */}
            <span className="text-text">Reporting is not built yet.</span> Until it is, use the
            contact address below — it reaches the same person.
          </p>
        </Section>

        <Section title="What happens to content that is removed">
          <p>
            A review or list that is removed stops appearing anywhere on the site — album pages,
            profiles, feeds, search and lists. It is not deleted, and{' '}
            <span className="text-text">its author can still see it</span>, so moderation never
            makes someone&rsquo;s own writing vanish without explanation.
          </p>
          <p>Removal can be undone.</p>
        </Section>

        <Section title="What happens to an account that is suspended">
          <p>
            Everything the account has published stops being visible to other people. Its ratings
            stop counting towards album averages, its reviews leave album pages, its lists stop
            resolving, its likes stop counting and its profile returns a not-found page.
          </p>
          <p>
            Nothing is deleted, and suspension can be undone. Records of what happened <em>to</em>{' '}
            other people — a notification saying this account followed you — are kept, because they
            are your history rather than theirs.
          </p>
        </Section>

        <Section title="Who decides">
          <p>
            A person does. longplayr runs no automated moderation, no filtering and no algorithmic
            decisions about content. It is one maintainer reading reports.
          </p>
          <p>
            That means decisions can be slow, and it means they are made by someone who can be
            argued with.
          </p>
        </Section>

        <Section title="Your own data">
          <p>
            You can download everything you have added, rated, written and listed from your settings
            page, including anything that has been removed — it is still yours.
          </p>
          <p>
            You can also delete your account. That is a permanent deletion rather than a
            deactivation: your collection, ratings, reviews, lists and follows are destroyed and
            cannot be recovered. Your handle is then reserved permanently so that nobody else can
            take it.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            For anything on this page — reporting something, disputing a decision, or a legal or
            regulatory enquiry — write to{' '}
            {/*
             * DSA Arts 11 and 12 require a point of contact for authorities and
             * for users, reachable by direct and rapid electronic means. One
             * address serves both at this size, which the articles permit.
             */}
            <span className="text-text">hello@longplayr.dev-guides.com</span>.
          </p>
          <p>
            This page describes how moderation works. It is not a full terms of service, and it is
            not legal advice.
          </p>
        </Section>

        <p className="mt-10 text-sm">
          <Link href="/" className="text-accent hover:underline">
            Back to longplayr
          </Link>
        </p>
      </div>
    </Container>
  );
}
