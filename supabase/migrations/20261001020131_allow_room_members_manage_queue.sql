-- Every authenticated member of a room may reorder its waiting queue.
-- The complete submitted ID list is validated while holding a room-level
-- transaction lock, so concurrent moves cannot drop or duplicate a song.
create or replace function public.reorder_room_queue(
  p_room_id uuid,
  p_item_ids uuid[]
)
returns boolean
language plpgsql
security definer
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
    select 1
    from public.room_members as member
    where member.room_id = p_room_id
      and member.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'room membership required';
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
         select 1
         from public.queue_items as item
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

-- This deliberately has a new name: cancel_own_song remains the narrowly
-- scoped legacy operation, while this endpoint makes the shared-room policy
-- explicit. A song already playing is never eligible for removal.
create or replace function public.cancel_room_queue_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_item public.queue_items%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  select item.*
  into v_item
  from public.queue_items as item
  where item.id = p_item_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'queue item not found';
  end if;

  if not exists (
    select 1
    from public.room_members as member
    where member.room_id = v_item.room_id
      and member.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'room membership required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_item.room_id::text, 0));

  select item.*
  into v_item
  from public.queue_items as item
  where item.id = p_item_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'queue item not found';
  end if;

  if v_item.status not in ('pending', 'queued') then
    raise exception using errcode = '55000', message = 'only waiting requests can be cancelled';
  end if;

  update public.queue_items
  set status = 'cancelled', completed_at = now()
  where id = v_item.id
  returning * into v_item;

  with ordered as (
    select item.id,
           row_number() over (order by item.position, item.created_at, item.id)::integer as next_position
    from public.queue_items as item
    where item.room_id = v_item.room_id and item.status = 'queued'
  )
  update public.queue_items as item
  set position = ordered.next_position
  from ordered
  where item.id = ordered.id and item.position is distinct from ordered.next_position;

  return to_jsonb(v_item);
end;
$$;

revoke execute on function public.reorder_room_queue(uuid, uuid[]) from public, anon;
revoke execute on function public.cancel_room_queue_item(uuid) from public, anon;
grant execute on function public.reorder_room_queue(uuid, uuid[]) to authenticated;
grant execute on function public.cancel_room_queue_item(uuid) to authenticated;
