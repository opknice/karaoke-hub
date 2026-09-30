begin;

-- The current UI stores favorites, playlists, history and ratings locally. Keep
-- their legacy tables private until a real authenticated persistence flow exists.
-- Revoke inherited PUBLIC access as well as direct anon/authenticated grants.
revoke all privileges on table
  public.songs,
  public.youtube_videos,
  public.playlists,
  public.playlist_items,
  public.favorites,
  public.queue_item_singers,
  public.karaoke_ratings,
  public.song_history,
  public.profiles
from public, anon, authenticated;

drop policy if exists "Allow all to read youtube_videos" on public.youtube_videos;
drop policy if exists "Allow all to insert youtube_videos" on public.youtube_videos;

-- Room clients read rows allowed by the Phase 2 member-scoped SELECT policies.
-- All mutations go through the authorization-checked RPC state machine.
revoke all privileges on table public.rooms, public.room_members, public.queue_items
from public, anon, authenticated;
grant select on table public.rooms, public.room_members, public.queue_items to authenticated;

-- Catalog data and quota/lease tables remain server-only.
revoke all privileges on table
  public.karaoke_catalog,
  public.karaoke_catalog_sync,
  public.karaoke_catalog_usage,
  public.karaoke_catalog_leases
from public, anon, authenticated;

commit;
