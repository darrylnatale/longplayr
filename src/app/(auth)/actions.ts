'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { signInWithPassword, signOutCurrentUser, signUpWithPassword } from '@/services/auth';

export type AuthFormState = {
  error?: string;
  fieldErrors?: { email?: string; password?: string };
};

const credentialsSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(8, 'Passwords must be at least 8 characters.'),
});

function parseCredentials(formData: FormData) {
  return credentialsSchema.safeParse({
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  });
}

function fieldErrorsFrom(error: z.ZodError): AuthFormState['fieldErrors'] {
  const fieldErrors: NonNullable<AuthFormState['fieldErrors']> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === 'email' || field === 'password') {
      fieldErrors[field] ??= issue.message;
    }
  }
  return fieldErrors;
}

export async function signUp(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = parseCredentials(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const result = await signUpWithPassword(parsed.data);
  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath('/', 'layout');

  // A new account has no profile yet, so onboarding is the only sensible
  // destination. When email confirmation is on there is no session, and
  // /onboarding sends them back to sign in.
  redirect('/onboarding');
}

export async function signIn(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = parseCredentials(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const result = await signInWithPassword(parsed.data);
  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function signOut() {
  await signOutCurrentUser();
  revalidatePath('/', 'layout');
  redirect('/');
}
