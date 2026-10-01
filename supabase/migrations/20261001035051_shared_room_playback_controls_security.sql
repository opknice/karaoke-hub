begin;

-- This function is invoked only by the queue_items trigger, never through the
-- Data API. Keep it unavailable as a direct SECURITY DEFINER RPC endpoint.
revoke execute on function public.sync_room_playback_on_queue_start() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
