-- longplayr — the clearing rule fires on creation, not on invocation
--
-- `ensure_collection_entry` deleted the Want to Listen row unconditionally, so
-- calling it for an album the user **already held** cleared a wishlist entry it
-- had no business touching. Any rate, like, review or relisten on a collected
-- album silently destroyed that row.
--
-- The locked rule is "any action that **causes a collection entry to exist**
-- clears Want to Listen". For an album already in the collection the action
-- does not cause the entry to exist, so nothing should be cleared.
--
-- This matters because the two relations are deliberately independent and may
-- legally hold the same album at once — collected first, wished second. Silent
-- loss of a row on an independent relation is precisely the failure that
-- independence decision exists to prevent.
--
-- Everything else about the function is unchanged: it remains the single
-- sanctioned path by which an entry comes to exist, it stays `security
-- invoker`, it still never overwrites a `listened_on` the user set, and it
-- still creates no activity event.

create or replace function public.ensure_collection_entry(
  p_user_id uuid,
  p_album_id uuid,
  p_listened_on date default null
)
returns public.collection_entries
language plpgsql
security invoker
set search_path = public
as $$
declare
  entry public.collection_entries;
begin
  -- `do nothing` rather than a no-op `do update`, so that a returned row means
  -- "this call created it" and an empty result means "it already existed".
  -- That distinction is the whole fix; a `do update` returns a row either way
  -- and cannot tell the two apart.
  insert into public.collection_entries (user_id, album_id, listened_on)
  values (p_user_id, p_album_id, p_listened_on)
  on conflict (user_id, album_id) do nothing
  returning * into entry;

  if entry.id is null then
    -- Already held. Read it back and touch nothing else: no wishlist delete,
    -- and no overwrite of a listened_on the user set earlier.
    select * into entry
      from public.collection_entries
     where user_id = p_user_id
       and album_id = p_album_id;

    return entry;
  end if;

  -- Created by this call, so the clearing rule applies.
  delete from public.want_to_listen
   where user_id = p_user_id
     and album_id = p_album_id;

  return entry;
end;
$$;

comment on function public.ensure_collection_entry is
  'The single path by which a collection entry comes to exist. Clears Want to Listen only when this call creates the entry. Creates no activity event.';
