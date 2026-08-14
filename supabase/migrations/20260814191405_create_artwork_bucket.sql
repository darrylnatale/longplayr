-- longplayr — artwork storage
--
-- Album art is fetched from Cover Art Archive and stored by us rather than
-- hotlinked, so album pages do not depend on an upstream service staying
-- available (docs/architecture.md §7).
--
-- Objects are keyed by release-group MBID and size:
--   artwork/<mbid>/<size>.jpg      e.g. artwork/a1b2.../500.jpg
--
-- Public, because album covers are public. Writes are service-role only:
-- artwork is catalogue data, and the catalogue is never user-authored.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artwork',
  'artwork',
  true,
  5242880, -- 5 MiB; Cover Art Archive images are well under this
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Anyone may read cover art.
create policy artwork_public_read
  on storage.objects
  for select
  using (bucket_id = 'artwork');

-- No insert, update or delete policies. The service role bypasses RLS, so
-- ingestion can write; everyone else is read-only by omission.
