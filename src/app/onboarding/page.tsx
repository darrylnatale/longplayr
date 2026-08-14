import { redirect } from 'next/navigation';

import { getCurrentProfile, getCurrentUser } from '@/services/profiles';

import { HandleForm } from './HandleForm';

export const metadata = { title: 'Choose your handle · longplayr' };

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Onboarding is the act of creating a profile, so having one means it's done.
  const profile = await getCurrentProfile();
  if (profile) redirect(`/${profile.handle}`);

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Choose your handle</h1>
      <p className="mb-6 text-sm text-muted">
        This is how people will find you. You can change your display name later.
      </p>

      <HandleForm />
    </div>
  );
}
