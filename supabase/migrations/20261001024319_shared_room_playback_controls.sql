begin;

-- Playback is room state, rather than browser state. This makes the active
-- player, TV display, and every joined singer agree about pause/play.
alter table public.rooms
  add column if not exists playback_is_playing boolean not null default true,
  add column if not exists playback_updated_at timestamptz not null default now();

-- Preserve the correct state for rooms that already have a current song.
update public.rooms as room
set playback_is_playing = true,
    playback_updated_at = now()
where exists (
  select 1
  from public.queue_items as item
  where item.room_id = room.id
    and item.status = 'playing'
);

-- A song that becomes the active item should start playback, regardless of
-- whether it was started by enqueue_song or play_queue_item_now.
create or replace function public.sync_room_playback_on_queue_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'playing'
     and (tg_op = 'INSERT' or old.status is distinct from 'playing') then
    update public.rooms
    set playback_is_playing = true,
        playback_updated_at = now()
    where id = new.room_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_room_playback_on_queue_start on public.queue_items;
create trigger sync_room_playback_on_queue_start
after insert or update of status on public.queue_items
for each row
execute function public.sync_room_playback_on_queue_start();

-- Everyone currently joined to a room may end its current song. The expected
-- item guard prevents a stale screen from ending a newer song.
create or replace function public.advance_queue(
  p_room_id uuid,
  p_expected_playing_id uuid default null,
  p_reason text default 'ended'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_current public.queue_items%rowtype;
  v_completed public.queue_items%rowtype;
  v_next public.queue_items%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  if p_reason not in ('ended', 'skipped', 'error') then
    raise exception using errcode = '22023', message = 'invalid advance reason';
  end if;

  if not exists (
    select 1
    from public.room_members as member
    where member.room_id = p_room_id
      and member.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'room membership required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text, 0));

  select item.*
  into v_current
  from public.queue_items as item
  where item.room_id = p_room_id and item.status = 'playing'
  order by item.started_at desc nulls last, item.created_at
  limit 1
  for update;

  if p_expected_playing_id is not null
     and (not found or v_current.id <> p_expected_playing_id) then
    return jsonb_build_object(
      'changed', false,
      'current', case when v_current.id is null then null else to_jsonb(v_current) end,
      'next', null
    );
  end if;

  if v_current.id is not null then
    update public.queue_items
    set status = case when p_reason = 'ended' then 'completed' else 'skipped' end,
        completed_at = now()
    where id = v_current.id
    returning * into v_completed;
  end if;

  select item.*
  into v_next
  from public.queue_items as item
  where item.room_id = p_room_id and item.status = 'queued'
  order by item.position, item.created_at, item.id
  limit 1
  for update skip locked;

  if v_next.id is not null then
    update public.queue_items
    set status = 'playing', position = 1, started_at = now(), completed_at = null
    where id = v_next.id
    returning * into v_next;
  end if;

  with ordered as (
    select item.id,
           row_number() over (order by item.position, item.created_at, item.id)::integer as new_position
    from public.queue_items as item
    where item.room_id = p_room_id and item.status = 'queued'
  )
  update public.queue_items as item
  set position = ordered.new_position
  from ordered
  where item.id = ordered.id and item.position is distinct from ordered.new_position;

  update public.rooms
  set playback_is_playing = v_next.id is not null,
      playback_updated_at = now()
  where id = p_room_id;

  return jsonb_build_object(
    'changed', true,
    'current', case when v_completed.id is null then null else to_jsonb(v_completed) end,
    'next', case when v_next.id is null then null else to_jsonb(v_next) end
  );
end;
$$;

-- Any current member can pause or resume the current song. The room row is
-- the shared source of truth and is already included in the Realtime
-- publication used by the client.
create or replace function public.set_room_playback(
  p_room_id uuid,
  p_expected_playing_id uuid,
  p_is_playing boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_current public.queue_items%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  if not exists (
    select 1
    from public.room_members as member
    where member.room_id = p_room_id
      and member.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'room membership required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text, 0));

  select item.*
  into v_current
  from public.queue_items as item
  where item.room_id = p_room_id and item.status = 'playing'
  order by item.started_at desc nulls last, item.created_at
  limit 1
  for update;

  if not found or v_current.id <> p_expected_playing_id then
    return jsonb_build_object(
      'changed', false,
      'playing_item_id', case when v_current.id is null then null else v_current.id end
    );
  end if;

  update public.rooms
  set playback_is_playing = p_is_playing,
      playback_updated_at = now()
  where id = p_room_id;

  return jsonb_build_object(
    'changed', true,
    'playing_item_id', v_current.id,
    'is_playing', p_is_playing
  );
end;
$$;

revoke execute on function public.advance_queue(uuid, uuid, text) from public, anon;
grant execute on function public.advance_queue(uuid, uuid, text) to authenticated;
revoke execute on function public.set_room_playback(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_room_playback(uuid, uuid, boolean) to authenticated;

-- Makes the newly added room fields and RPC available immediately through the
-- PostgREST API used by supabase-js.
notify pgrst, 'reload schema';

commit;
