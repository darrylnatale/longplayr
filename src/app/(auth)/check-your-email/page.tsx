import Link from 'next/link';

import { Container } from '@/components/Container';

import { ResendForm } from './ResendForm';

/**
 * Shown after a signup that issued no session, which means email confirmation
 * is enabled and the account is not usable yet. `architecture.md` §6.
 *
 * **It exists because the alternative is worse than nothing.** Without it the
 * new account is redirected to `/onboarding`, which bounces it to a sign-in
 * form — asking somebody who has just registered to sign in, with no mention of
 * an email.
 *
 * **It states the account is unusable rather than implying it.** "Check your
 * email" alone reads as a courtesy; the reason someone cannot sign in is the
 * thing they need to know.
 */
export const metadata = { title: 'Check your email' };

export default async function CheckYourEmailPage({ searchParams }: PageProps<'/check-your-email'>) {
  const { address } = await searchParams;
  /*
   * **Rendered as text, never as markup or a link.** It arrives in a query
   * parameter, so it is attacker-controllable — anyone can construct this URL
   * with any address in it. React escapes it on output, and nothing here
   * interpolates it into an href, an attribute or a mail command.
   */
  const email = typeof address === 'string' && address.includes('@') ? address : null;

  return (
    <Container variant="content">
      <div className="flex flex-col gap-5 py-10 sm:py-16">
        <h1 className="font-serif text-3xl leading-[1.15] text-text sm:text-4xl">
          Check your email
        </h1>

        <p className="text-base text-text-secondary">
          {email ? (
            <>
              We&rsquo;ve sent a confirmation link to <span className="text-text">{email}</span>.
            </>
          ) : (
            <>We&rsquo;ve sent you a confirmation link.</>
          )}
        </p>

        {/*
         * The sentence that earns the page. Somebody who tries to sign in before
         * clicking will otherwise read the failure as a wrong password.
         */}
        <p className="text-base text-text-secondary">
          <strong className="text-text">Your account isn&rsquo;t usable until you click it.</strong>{' '}
          Signing in before then won&rsquo;t work, and it isn&rsquo;t your password.
        </p>

        <ResendForm address={email} />

        <p className="text-sm text-text-muted">
          Once you&rsquo;ve confirmed, you can{' '}
          <Link
            href="/login"
            className="text-accent underline decoration-accent-dim underline-offset-4 transition-colors hover:decoration-accent"
          >
            sign in
          </Link>
          .
        </p>
      </div>
    </Container>
  );
}
