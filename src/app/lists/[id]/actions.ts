'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { deleteList, removeAlbumFromList, reorderListItem, updateList } from '@/services/lists';

/**
 * Mutations on one list.
 *
 * **None of these takes an owner.** Every one resolves the caller from the
 * session and relies on RLS to match nothing when the list is not theirs, which
 * is why a forged `id` in the form achieves nothing. That is the same shape the
 * album page's actions use.
 */

export type ListActionState = { error?: string };

export async function updateListAction(
  id: string,
  _prev: ListActionState,
  formData: FormData,
): Promise<ListActionState> {
  const result = await updateList(id, {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    isRanked: formData.get('is_ranked') === 'on',
  });

  if (!result.ok) return { error: result.message };

  revalidatePath(`/lists/${id}`);
  return {};
}

/**
 * Deletes the list and sends the owner back to their profile.
 *
 * **The redirect target comes from the session**, never from the form — taking
 * it from the request would make this an open redirect.
 */
export async function deleteListAction(id: string, handle: string): Promise<void> {
  const result = await deleteList(id);
  if (!result.ok) return;

  revalidatePath(`/${handle}/lists`);
  revalidatePath(`/${handle}`);
  redirect(`/${handle}/lists`);
}

export async function removeItemAction(listId: string, albumId: string): Promise<void> {
  await removeAlbumFromList(listId, albumId);
  revalidatePath(`/lists/${listId}`);
}

export async function reorderItemAction(
  listId: string,
  itemId: string,
  toPosition: number,
): Promise<void> {
  await reorderListItem(itemId, toPosition);
  revalidatePath(`/lists/${listId}`);
}
