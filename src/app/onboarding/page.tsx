import { redirect } from 'next/navigation';

import { AuthShell } from '@/components/AuthShell';
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
    <AuthShell
      title="Choose your handle"
      description="This is how people will find you. You can change your display name later."
    >
      <HandleForm />
    </AuthShell>
  );
}
