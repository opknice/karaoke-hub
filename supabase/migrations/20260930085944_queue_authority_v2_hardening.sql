begin;

-- Queue writes are only valid through the state-machine RPCs. SECURITY DEFINER
-- lets those RPCs perform their checked mutations without granting callers a
-- way to bypass ordering, ownership, or host-only transition rules.
alter function public.enqueue_song(uuid, text, jsonb, jsonb, text, uuid) security definer;
alter function public.cancel_own_song(uuid) security definer;
alter function public.advance_queue(uuid, uuid, text) security definer;
alter function public.skip_and_play_next(uuid, uuid) security definer;
alter function public.play_queue_item_now(uuid, uuid, uuid) security definer;
alter function public.reorder_room_queue(uuid, uuid[]) security definer;
alter function public.clear_room_queue(uuid) security definer;

revoke insert, update, delete on public.queue_items from authenticated;

drop policy if exists queue_items_member_insert_v2 on public.queue_items;
drop policy if exists queue_items_owner_cancel_v2 on public.queue_items;
drop policy if exists queue_items_host_manage_v2 on public.queue_items;

commit;
