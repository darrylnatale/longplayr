'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createProfile } from '@/services/profiles';

export type OnboardingFormState = { error?: string };

export async function chooseHandle(
  _prevState: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const result = await createProfile({
    handle: String(formData.get('handle') ?? ''),
    displayName: String(formData.get('displayName') ?? '') || null,
  });

  if (!result.ok) {
    if (result.error === 'unauthenticated') redirect('/login');
    if (result.error === 'already_exists') redirect('/');
    return { error: result.message };
  }

  revalidatePath('/', 'layout');
  redirect(`/${result.data.handle}`);
}
