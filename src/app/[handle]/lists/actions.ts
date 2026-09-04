'use server';

import { revalidatePath } from 'next/cache';

import { createList } from '@/services/lists';

/**
 * Creating a list from the owner's own lists destination.
 *
 * **The handle is used only to revalidate the page that submitted**, never to
 * decide ownership — `createList` takes the owner from the session. Trusting a
 * handle from the form would let anyone create a list on someone else's profile.
 */

export type CreateListState = { error?: string };

export async function createListAction(
  handle: string,
  _prev: CreateListState,
  formData: FormData,
): Promise<CreateListState> {
  const result = await createList({
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    isRanked: formData.get('is_ranked') === 'on',
  });

  if (!result.ok) return { error: result.message };

  revalidatePath(`/${handle}/lists`);
  revalidatePath(`/${handle}`);

  return {};
}
