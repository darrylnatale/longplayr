'use server';

import { revalidatePath } from 'next/cache';

import { addAlbumFromUpstream } from '@/services/catalogue/self-service';

export type AddState = { error?: string; addedMbid?: string };

export async function addAlbum(_prev: AddState, formData: FormData): Promise<AddState> {
  const mbid = String(formData.get('mbid') ?? '');
  if (!mbid) return { error: 'Missing record identifier.' };

  const result = await addAlbumFromUpstream(mbid);

  if (!result.ok) return { error: result.message };

  revalidatePath('/search');
  return { addedMbid: result.data.mbid };
}
