import { redirect } from 'next/navigation';

import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { getCurrentProfile, getCurrentUser } from '@/services/profiles';

import { DeleteAccountForm } from './DeleteAccountForm';

/**
 * Settings.
 *
 * **Account deletion and nothing else** (`product-spec.md` §6). A settings page
 * is not a licence to fill one — display name, avatar and preferences are
 * separate work with separate decisions.
 *
 * **Signed out redirects to `/login`; signed in without a profile redirects to
 * `/onboarding`** — the same treatment `/feed` and `/notifications` already
 * give, and here it is also a precondition: a user mid-onboarding has no handle
 * to type and none to reserve.
 */

export const metadata = { title: 'Settings · longplayr' };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const profile = await getCurrentProfile();
  if (!profile) redirect('/onboarding');

  return (
    <Container variant="content" className="py-8">
      <SectionHeader>Settings</SectionHeader>

      <section className="mt-8 max-w-prose">
        <h2 className="text-lg font-medium text-text">Delete your account</h2>

        {/*
         * Stated plainly and in full before the control, rather than as fine
         * print under it. Deletion is the one action in the product with no
         * undo, and the permanence of the handle is the part people are least
         * likely to expect.
         */}
        <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-text-muted">
          <p>
            This removes your collection, ratings, reviews, lists, follows and everything else you
            have written here. It happens immediately and cannot be undone.
          </p>
          <p>
            Your handle <span className="text-text">{profile.handle}</span> is reserved permanently
            afterwards, so nobody else can take it — including you.
          </p>
        </div>

        <div className="mt-6">
          <DeleteAccountForm handle={profile.handle} />
        </div>
      </section>
    </Container>
  );
}
