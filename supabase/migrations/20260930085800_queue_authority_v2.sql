begin;

-- Phase 2: make Postgres the authoritative queue state machine.
alter table public.queue_items
  add column if not exists requested_by_member_id uuid references public.room_members(id) on delete set null,
  add column if not exists client_request_id uuid;

alter table public.queue_items
  alter column room_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rooms_room_code_format_check'
      and conrelid = 'public.rooms'::regclass
  ) then
    alter table public.rooms
      add constraint rooms_room_code_format_check
      check (room_code ~ '^[A-Z0-9]{4,12}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'rooms_name_length_check'
      and conrelid = 'public.rooms'::regclass
  ) then
    alter table public.rooms
      add constraint rooms_name_length_check
      check (char_length(name) between 1 and 80);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'room_members_nickname_length_check'
      and conrelid = 'public.room_members'::regclass
  ) then
    alter table public.room_members
      add constraint room_members_nickname_length_check
      check (char_length(nickname) between 1 and 40);
  end if;
end
$$;

create unique index if not exists room_members_room_user_unique_idx
  on public.room_members (room_id, user_id)
  where user_id is not null;

create index if not exists room_members_user_room_idx
  on public.room_members (user_id, room_id)
  where user_id is not null;

create index if not exists room_members_room_id_idx
  on public.room_members (room_id);

create index if not exists queue_items_requested_by_member_id_idx
  on public.queue_items (requested_by_member_id)
  where requested_by_member_id is not null;

create unique index if not exists queue_items_room_client_request_unique_idx
  on public.queue_items (room_id, client_request_id)
  where client_request_id is not null;

create unique index if not exists queue_items_one_playing_per_room_idx
  on public.queue_items (room_id)
  where status = 'playing';

create index if not exists queue_items_room_status_position_idx
  on public.queue_items (room_id, status, position, created_at);

create index if not exists rooms_host_user_id_idx
  on public.rooms (host_user_id)
  where host_user_id is not null;

-- Server-only atomic room creation. The Route Handler verifies the JWT first and
-- invokes this function with the verified auth user id using the service role.
create or replace function public.create_karaoke_room_for_user(
  p_host_user_id uuid,
  p_room_code text,
  p_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_member public.room_members%rowtype;
begin
  if p_host_user_id is null then
    raise exception using errcode = '22023', message = 'host user is required';
  end if;

  if p_room_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception using errcode = '22023', message = 'invalid room code';
  end if;

  if char_length(btrim(p_name)) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'invalid room name';
  end if;

  insert into public.rooms (
    host_user_id,
    room_code,
    name,
    status,
    queue_mode,
    request_mode,
    is_queue_locked
  )
  values (
    p_host_user_id,
    p_room_code,
    btrim(p_name),
    'active',
    'smart',
    'auto_accept',
    false
  )
  returning * into v_room;

  insert into public.room_members (room_id, user_id, nickname, role)
  values (v_room.id, p_host_user_id, 'Host', 'host')
  on conflict (room_id, user_id) where user_id is not null
  do update set nickname = excluded.nickname, role = 'host', joined_at = now()
  returning * into v_member;

  return jsonb_build_object('room', to_jsonb(v_room), 'member', to_jsonb(v_member));
end;
$$;

create or replace function public.join_karaoke_room_for_user(
  p_user_id uuid,
  p_room_code text,
  p_nickname text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_member public.room_members%rowtype;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'user is required';
  end if;

  if p_room_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception using errcode = '22023', message = 'invalid room code';
  end if;

  if char_length(btrim(p_nickname)) not between 1 and 40 then
    raise exception using errcode = '22023', message = 'invalid nickname';
  end if;

  select room.*
  into v_room
  from public.rooms as room
  where room.room_code = p_room_code
    and room.status = 'active'
    and room.host_user_id is not null
  limit 1;

  if not found then
    raise exception using errcode = 'P0002', message = 'active room not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_room.id::text, 0));

  insert into public.room_members (room_id, user_id, nickname, role)
  values (v_room.id, p_user_id, btrim(p_nickname), 'guest')
  on conflict (room_id, user_id) where user_id is not null
  do update set nickname = excluded.nickname, joined_at = now()
  returning * into v_member;

  return jsonb_build_object('room', to_jsonb(v_room), 'member', to_jsonb(v_member));
end;
$$;

-- Adds one request exactly once. The per-room advisory lock serializes position
-- allocation and the decision whether the first request should start playing.
create or replace function public.enqueue_song(
  p_room_id uuid,
  p_youtube_video_id text,
  p_video jsonb,
  p_singers jsonb,
  p_user_notes text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_member public.room_members%rowtype;
  v_item public.queue_items%rowtype;
  v_starts_playing boolean;
  v_position integer;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  if p_client_request_id is null then
    raise exception using errcode = '22023', message = 'client request id is required';
  end if;

  if p_youtube_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception using errcode = '22023', message = 'invalid YouTube video id';
  end if;

  if jsonb_typeof(p_video) <> 'object' or jsonb_typeof(p_singers) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid queue metadata';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text, 0));

  select member.*
  into v_member
  from public.room_members as member
  join public.rooms as room on room.id = member.room_id
  where member.room_id = p_room_id
    and member.user_id = v_user_id
    and room.status = 'active'
    and room.is_queue_locked is false
  limit 1;

  if not found then
    raise exception using errcode = '42501', message = 'room membership required or queue is locked';
  end if;

  select item.*
  into v_item
  from public.queue_items as item
  where item.room_id = p_room_id
    and item.client_request_id = p_client_request_id
  limit 1;

  if found then
    return to_jsonb(v_item);
  end if;

  select not exists (
    select 1
    from public.queue_items as item
    where item.room_id = p_room_id
      and item.status = 'playing'
  ) into v_starts_playing;

  if v_starts_playing then
    v_position := 1;
  else
    select coalesce(max(item.position), 0) + 1
    into v_position
    from public.queue_items as item
    where item.room_id = p_room_id
      and item.status in ('pending', 'queued');
  end if;

  insert into public.queue_items (
    room_id,
    youtube_video_id,
    status,
    position,
    requested_by,
    requested_by_member_id,
    client_request_id,
    started_at,
    notes
  )
  values (
    p_room_id,
    p_youtube_video_id,
    case when v_starts_playing then 'playing' else 'queued' end,
    v_position,
    v_member.nickname,
    v_member.id,
    p_client_request_id,
    case when v_starts_playing then now() else null end,
    jsonb_build_object(
      'video', p_video,
      'singers', p_singers,
      'client_queue_item_id', p_client_request_id::text,
      'user_notes', nullif(p_user_notes, '')
    )::text
  )
  returning * into v_item;

  return to_jsonb(v_item);
end;
$$;

create or replace function public.cancel_own_song(p_item_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_item public.queue_items%rowtype;
  v_is_host boolean;
  v_is_owner boolean;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  select item.*
  into v_item
  from public.queue_items as item
  where item.id = p_item_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'queue item not found';
  end if;

  select exists (
           select 1 from public.rooms as room
           where room.id = v_item.room_id and room.host_user_id = v_user_id
         ),
         exists (
           select 1 from public.room_members as member
           where member.id = v_item.requested_by_member_id
             and member.room_id = v_item.room_id
             and member.user_id = v_user_id
         )
  into v_is_host, v_is_owner;

  if not v_is_host and not v_is_owner then
    raise exception using errcode = '42501', message = 'not allowed to cancel this request';
  end if;

  if v_item.status not in ('pending', 'queued') then
    raise exception using errcode = '55000', message = 'only queued requests can be cancelled';
  end if;

  update public.queue_items
  set status = 'cancelled', completed_at = now()
  where id = v_item.id
  returning * into v_item;

  return to_jsonb(v_item);
end;
$$;

create or replace function public.advance_queue(
  p_room_id uuid,
  p_expected_playing_id uuid default null,
  p_reason text default 'ended'
)
returns jsonb
language plpgsql
security invoker
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
    select 1 from public.rooms as room
    where room.id = p_room_id and room.host_user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'host permission required';
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

  return jsonb_build_object(
    'changed', true,
    'current', case when v_completed.id is null then null else to_jsonb(v_completed) end,
    'next', case when v_next.id is null then null else to_jsonb(v_next) end
  );
end;
$$;

create or replace function public.skip_and_play_next(
  p_room_id uuid,
  p_expected_playing_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.advance_queue(p_room_id, p_expected_playing_id, 'skipped');
$$;

create or replace function public.play_queue_item_now(
  p_room_id uuid,
  p_item_id uuid,
  p_expected_playing_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_current public.queue_items%rowtype;
  v_selected public.queue_items%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  if not exists (
    select 1 from public.rooms as room
    where room.id = p_room_id and room.host_user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'host permission required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text, 0));

  select item.* into v_current
  from public.queue_items as item
  where item.room_id = p_room_id and item.status = 'playing'
  limit 1
  for update;

  if p_expected_playing_id is not null
     and (not found or v_current.id <> p_expected_playing_id) then
    return jsonb_build_object('changed', false, 'current', to_jsonb(v_current), 'next', null);
  end if;

  select item.* into v_selected
  from public.queue_items as item
  where item.id = p_item_id and item.room_id = p_room_id and item.status = 'queued'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'queued item not found';
  end if;

  if v_current.id is not null then
    update public.queue_items
    set status = 'skipped', completed_at = now()
    where id = v_current.id;
  end if;

  update public.queue_items
  set status = 'playing', position = 1, started_at = now(), completed_at = null
  where id = v_selected.id
  returning * into v_selected;

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

  return jsonb_build_object('changed', true, 'current', to_jsonb(v_current), 'next', to_jsonb(v_selected));
end;
$$;

create or replace function public.reorder_room_queue(
  p_room_id uuid,
  p_item_ids uuid[]
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_queue_count integer;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  if not exists (
    select 1 from public.rooms as room
    where room.id = p_room_id and room.host_user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'host permission required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text, 0));

  select count(*) into v_queue_count
  from public.queue_items as item
  where item.room_id = p_room_id and item.status = 'queued';

  if coalesce(cardinality(p_item_ids), 0) <> v_queue_count
     or (
       select count(distinct requested.id)
       from unnest(coalesce(p_item_ids, array[]::uuid[])) as requested(id)
     ) <> v_queue_count
     or exists (
       select 1
       from unnest(coalesce(p_item_ids, array[]::uuid[])) as requested(requested_id)
       where not exists (
         select 1 from public.queue_items as item
         where item.id = requested.requested_id
           and item.room_id = p_room_id
           and item.status = 'queued'
       )
     ) then
    raise exception using errcode = '22023', message = 'queue order does not match current queued items';
  end if;

  update public.queue_items as item
  set position = requested.ordinality::integer
  from unnest(coalesce(p_item_ids, array[]::uuid[])) with ordinality as requested(id, ordinality)
  where item.id = requested.id and item.room_id = p_room_id and item.status = 'queued';

  return true;
end;
$$;

create or replace function public.clear_room_queue(p_room_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count integer;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  if not exists (
    select 1 from public.rooms as room
    where room.id = p_room_id and room.host_user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'host permission required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text, 0));

  update public.queue_items
  set status = 'cancelled', completed_at = now()
  where room_id = p_room_id and status in ('pending', 'queued');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Replace permissive v1 policies with authenticated, room-scoped access.
drop policy if exists "Allow all to read rooms" on public.rooms;
drop policy if exists "Allow all to read queue_items" on public.queue_items;
drop policy if exists "Allow all to insert queue_items" on public.queue_items;
drop policy if exists "Allow all to update queue_items" on public.queue_items;
drop policy if exists rooms_member_select_v2 on public.rooms;
drop policy if exists room_members_self_select_v2 on public.room_members;
drop policy if exists queue_items_member_select_v2 on public.queue_items;
drop policy if exists queue_items_member_insert_v2 on public.queue_items;
drop policy if exists queue_items_owner_cancel_v2 on public.queue_items;
drop policy if exists queue_items_host_manage_v2 on public.queue_items;

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.queue_items enable row level security;

create policy rooms_member_select_v2
on public.rooms for select
to authenticated
using (
  host_user_id = (select auth.uid())
  or exists (
    select 1
    from public.room_members as member
    where member.room_id = rooms.id
      and member.user_id = (select auth.uid())
  )
);

create policy room_members_self_select_v2
on public.room_members for select
to authenticated
using (user_id = (select auth.uid()));

create policy queue_items_member_select_v2
on public.queue_items for select
to authenticated
using (
  exists (
    select 1
    from public.room_members as member
    where member.room_id = queue_items.room_id
      and member.user_id = (select auth.uid())
  )
);

create policy queue_items_member_insert_v2
on public.queue_items for insert
to authenticated
with check (
  requested_by_member_id is not null
  and exists (
    select 1
    from public.room_members as member
    where member.id = queue_items.requested_by_member_id
      and member.room_id = queue_items.room_id
      and member.user_id = (select auth.uid())
  )
);

create policy queue_items_owner_cancel_v2
on public.queue_items for update
to authenticated
using (
  status in ('pending', 'queued')
  and exists (
    select 1
    from public.room_members as member
    where member.id = queue_items.requested_by_member_id
      and member.room_id = queue_items.room_id
      and member.user_id = (select auth.uid())
  )
)
with check (
  status = 'cancelled'
  and exists (
    select 1
    from public.room_members as member
    where member.id = queue_items.requested_by_member_id
      and member.room_id = queue_items.room_id
      and member.user_id = (select auth.uid())
  )
);

create policy queue_items_host_manage_v2
on public.queue_items for update
to authenticated
using (
  exists (
    select 1 from public.rooms as room
    where room.id = queue_items.room_id
      and room.host_user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.rooms as room
    where room.id = queue_items.room_id
      and room.host_user_id = (select auth.uid())
  )
);

revoke all on public.rooms, public.room_members, public.queue_items from anon;
grant select on public.rooms, public.room_members, public.queue_items to authenticated;
grant insert, update on public.queue_items to authenticated;

revoke execute on function public.create_karaoke_room_for_user(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.join_karaoke_room_for_user(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_karaoke_room_for_user(uuid, text, text) to service_role;
grant execute on function public.join_karaoke_room_for_user(uuid, text, text) to service_role;

revoke execute on function public.enqueue_song(uuid, text, jsonb, jsonb, text, uuid) from public, anon;
revoke execute on function public.cancel_own_song(uuid) from public, anon;
revoke execute on function public.advance_queue(uuid, uuid, text) from public, anon;
revoke execute on function public.skip_and_play_next(uuid, uuid) from public, anon;
revoke execute on function public.play_queue_item_now(uuid, uuid, uuid) from public, anon;
revoke execute on function public.reorder_room_queue(uuid, uuid[]) from public, anon;
revoke execute on function public.clear_room_queue(uuid) from public, anon;

grant execute on function public.enqueue_song(uuid, text, jsonb, jsonb, text, uuid) to authenticated;
grant execute on function public.cancel_own_song(uuid) to authenticated;
grant execute on function public.advance_queue(uuid, uuid, text) to authenticated;
grant execute on function public.skip_and_play_next(uuid, uuid) to authenticated;
grant execute on function public.play_queue_item_now(uuid, uuid, uuid) to authenticated;
grant execute on function public.reorder_room_queue(uuid, uuid[]) to authenticated;
grant execute on function public.clear_room_queue(uuid) to authenticated;

commit;
