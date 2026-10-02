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
 * **It describes only what the product actually does, and that has to be
 * re-checked every time moderation changes.** It once said reporting was not
 * built, which was true when written and false the moment slice 3b shipped —
 * `architecture.md` §16.10b now makes this page a deliverable of any moderation
 * slice. Every sentence here is checkable against the code: the statuses in `20260818120000`, the enforcement
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
          {/*
           * **This paragraph replaced one reading "Reporting is not built yet."**
           * That was true when written and was made false by the slice that
           * built reporting — on the page whose whole value is being checkable.
           * `architecture.md` §16.10b now records that this page is a
           * deliverable of any moderation slice rather than a neighbour of one.
           */}
          <p>
            The control is on the review, the list, or the profile itself. You need an account to
            use it. <span className="text-text">Anyone without one can use the address below</span>{' '}
            — it reaches the same person and carries the same weight.
          </p>
          <p>
            Filing a report changes nothing straight away. It joins a queue, and the content stays
            visible until somebody has looked at it.{' '}
            <span className="text-text">
              You will not be told the outcome of a report you file.
            </span>{' '}
            That is deliberate: it would reveal whether a particular account was acted on, and the
            person acted on is the one with the right to know.
          </p>
        </Section>

        <Section title="If something of yours is removed, you are told why">
          <p>
            When a review or list of yours is removed, or your account is suspended, you get a
            notice saying <span className="text-text">what was acted on, and on what ground</span>.
            It appears as a banner and lives at{' '}
            <Link href="/notices" className="text-accent hover:underline">
              your notices
            </Link>
            .
          </p>
          <p>
            {/*
             * Art 17 does not require naming the individual moderator, and with
             * one admin it would expose a named person to everybody they
             * moderate. `architecture.md` §16.10a — and the column grant, not
             * this page, is what enforces it.
             */}
            It does not say which administrator made the decision. It does tell you how to dispute
            it, which is the address below.
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
          {/*
           * **Added 2026-10-02, after reading this page against the product.**
           * The sentence above was literally true and materially incomplete:
           * four ceilings exist — follows, review likes, list likes and reports
           * — and none was disclosed. **Art 14 asks for the restrictions a
           * service imposes on its use, not only the ones about content**, so
           * silence about a real automated restriction is a gap even when every
           * sentence present is accurate. `architecture.md` §14.4 and §16.10f.
           */}
          <p>
            There is one automated restriction, and it is about pace rather than content: following,
            liking and reporting are capped per hour and per day.{' '}
            <span className="text-text">Nothing is judged automatically</span> — a cap only stops
            the same action being repeated very fast, and it never looks at what you wrote.
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
             *
             * **It is a personal mailbox, deliberately and temporarily.** The
             * intended address was `hello@longplayr.dev-guides.com`, and on
             * 2026-10-01 that domain had no MX record and did not resolve —
             * so mail to it bounced. **An address that bounces fails Art 11
             * harder than an informal one does**, which is the whole reason
             * this is a working mailbox rather than a tidy-looking one.
             *
             * Replace it when longplayr has its own domain. Note that the
             * address is public and will be scraped; that was raised and
             * accepted.
             */}
            <span className="text-text">streetclasharchives@gmail.com</span>.
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
