begin;

-- Fingerprints only: API key values never enter Postgres or the Data API.
create table public.karaoke_youtube_key_usage (
  day date not null,
  bucket text not null check (bucket in ('search', 'general')),
  key_id text not null check (key_id ~ '^[a-f0-9]{64}$'),
  used integer not null default 0 check (used >= 0),
  exhausted boolean not null default false,
  primary key (day, bucket, key_id)
);
alter table public.karaoke_youtube_key_usage enable row level security;
revoke all on public.karaoke_youtube_key_usage from public, anon, authenticated;
grant select, insert, update, delete on public.karaoke_youtube_key_usage to service_role;

create function public.karaoke_youtube_validate_keys(p_keys jsonb)
returns void language plpgsql immutable security invoker set search_path = '' as $$
begin
  if p_keys is null or jsonb_typeof(p_keys) <> 'array' then
    raise exception 'invalid YouTube key configuration' using errcode = '22023';
  end if;
  if jsonb_array_length(p_keys) not between 1 and 2 then
    raise exception 'invalid YouTube key count' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_keys) k
    where jsonb_typeof(k) <> 'object'
      or coalesce(k->>'id', '') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(k->'limit') is distinct from 'number'
      or coalesce(k->>'limit', '') !~ '^[0-9]{1,5}$'
  ) then
    raise exception 'invalid YouTube key entry' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_keys) k where (k->>'limit')::integer not between 1 and 10000)
    or (select count(distinct k->>'id') from jsonb_array_elements(p_keys) k) <> jsonb_array_length(p_keys) then
    raise exception 'invalid YouTube key limits or duplicate keys' using errcode = '22023';
  end if;
end;
$$;

-- Called before each individual outbound attempt, including backup retries.
-- Keep the transaction short: no network operation happens while locked.
create function public.karaoke_youtube_reserve(
  p_keys jsonb, p_bucket text, p_excluded text[] default '{}', p_catalog boolean default false
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
  v_key jsonb;
  v_index integer := 0;
  v_row public.karaoke_youtube_key_usage%rowtype;
  v_all_exhausted boolean := true;
begin
  perform public.karaoke_youtube_validate_keys(p_keys);
  if p_bucket is null or p_bucket not in ('search', 'general') or p_excluded is null or p_catalog is null then
    raise exception 'invalid YouTube quota bucket' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('karaoke-youtube:' || v_day::text || ':' || p_bucket, 0));
  for v_key in select value from jsonb_array_elements(p_keys) loop
    v_index := v_index + 1;
    -- Import today's legacy primary usage/outage conservatively when enabling
    -- the pool. Never charge that history to the backup or general bucket.
    insert into public.karaoke_youtube_key_usage(day, bucket, key_id, used, exhausted)
      values (v_day, p_bucket, v_key->>'id',
        case when p_bucket = 'search' and v_index = 1 then coalesce((
          select used from public.karaoke_search_budget where day = v_day
        ), 0) else 0 end,
        p_bucket = 'search' and v_index = 1 and exists (
          select 1 from public.karaoke_search_outages where day = v_day
        )) on conflict (day, bucket, key_id) do nothing;
    select * into v_row from public.karaoke_youtube_key_usage
      where day = v_day and bucket = p_bucket and key_id = v_key->>'id' for update;
    if not v_row.exhausted then v_all_exhausted := false; end if;
    if v_row.exhausted or v_row.key_id = any(p_excluded)
      or (p_bucket = 'search' and v_row.used >= (v_key->>'limit')::integer) then
      continue;
    end if;
    if p_catalog then
      -- Coordinate both budgets in this transaction. A maintenance-cap denial
      -- must not consume an attempt from the user-facing search allowance.
      if not public.karaoke_catalog_reserve() then
        return jsonb_build_object('ok', false, 'reason', 'catalog_budget_exhausted');
      end if;
    end if;
    update public.karaoke_youtube_key_usage set used = used + 1
      where day = v_day and bucket = p_bucket and key_id = v_row.key_id;
    return jsonb_build_object('ok', true, 'keyId', v_row.key_id, 'day', v_day);
  end loop;
  return jsonb_build_object('ok', false, 'reason',
    case when v_all_exhausted then 'upstream_exhausted' else 'budget_exhausted' end);
end;
$$;

create function public.karaoke_youtube_mark_exhausted(p_key_id text, p_bucket text, p_day date)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_key_id is null or p_key_id !~ '^[a-f0-9]{64}$' or p_bucket is null
    or p_bucket not in ('search', 'general') or p_day is null then
    raise exception 'invalid YouTube outage' using errcode = '22023';
  end if;
  -- Use the reservation's date so a pre-midnight request cannot disable the
  -- primary for the new day when its response arrives after midnight.
  insert into public.karaoke_youtube_key_usage(day, bucket, key_id, exhausted)
    values (p_day, p_bucket, p_key_id, true)
    on conflict (day, bucket, key_id) do update set exhausted = true;
end;
$$;

create function public.karaoke_youtube_get_budget(p_keys jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
  v_used integer;
  v_limit integer;
  v_remaining integer;
  v_exhausted boolean;
begin
  perform public.karaoke_youtube_validate_keys(p_keys);
  with entries as (
    select (k.value->>'limit')::integer as allowance,
      coalesce(u.used, case when k.ordinality = 1 then (
        select used from public.karaoke_search_budget where day = v_day
      ) end, 0) as used,
      coalesce(u.exhausted, k.ordinality = 1 and exists (
        select 1 from public.karaoke_search_outages where day = v_day
      )) as exhausted
    from jsonb_array_elements(p_keys) with ordinality k(value, ordinality)
    left join public.karaoke_youtube_key_usage u
      on u.day = v_day and u.bucket = 'search' and u.key_id = k.value->>'id'
  )
  select sum(used), sum(allowance),
    sum(case when exhausted then 0 else greatest(0, allowance - used) end), bool_and(exhausted)
    into v_used, v_limit, v_remaining, v_exhausted from entries;
  return jsonb_build_object('used', v_used, 'limit', v_limit, 'remaining', v_remaining,
    'warning', v_remaining <= floor(v_limit * 0.2), 'upstreamExhausted', v_exhausted);
end;
$$;

-- The logical search owns one duplicate-query lease and one client cooldown.
-- Quota is reserved separately for each actual request by the key pool.
create function public.karaoke_search_pool_begin(p_query text, p_client text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
  v_now timestamptz := clock_timestamp();
  v_token uuid := gen_random_uuid();
begin
  if p_query is null or char_length(p_query) not between 1 and 250
    or p_client is null or p_client !~ '^[A-Za-z0-9-]{1,64}$' then
    raise exception 'invalid search reservation input' using errcode = '22023';
  end if;
  -- Share the legacy lock order during rolling deployments. Leave the legacy
  -- count unchanged so first pool initialization can import it exactly once.
  insert into public.karaoke_search_budget(day, used) values (v_day, 0) on conflict(day) do nothing;
  perform 1 from public.karaoke_search_budget where day = v_day for update;
  delete from public.karaoke_search_leases where expires_at <= v_now;
  delete from public.karaoke_search_clients where last_request < v_now - interval '1 day';
  delete from public.karaoke_search_cache where expires_at <= v_now;
  if exists (select 1 from public.karaoke_search_leases where query = p_query) then
    return jsonb_build_object('ok', false, 'reason', 'query_in_progress');
  end if;
  if exists (select 1 from public.karaoke_search_clients
    where client = p_client and last_request > v_now - interval '3 seconds') then
    return jsonb_build_object('ok', false, 'reason', 'client_cooldown');
  end if;
  insert into public.karaoke_search_leases(query, token, expires_at)
    values (p_query, v_token, v_now + interval '2 minutes');
  insert into public.karaoke_search_clients(client, last_request) values (p_client, v_now)
    on conflict(client) do update set last_request = excluded.last_request;
  return jsonb_build_object('ok', true, 'token', v_token);
end;
$$;

create or replace function public.karaoke_search_cleanup()
returns void language plpgsql security invoker set search_path = '' as $$
declare v_day date := (now() at time zone 'America/Los_Angeles')::date;
begin
  delete from public.karaoke_search_cache where expires_at <= now();
  delete from public.karaoke_search_leases where expires_at <= now();
  delete from public.karaoke_search_clients where last_request < now() - interval '1 day';
  delete from public.karaoke_search_budget where day < v_day - 30;
  delete from public.karaoke_search_outages where day < v_day - 30;
  delete from public.karaoke_youtube_key_usage where day < v_day - 30;
end;
$$;

revoke all on function
  public.karaoke_youtube_validate_keys(jsonb),
  public.karaoke_youtube_reserve(jsonb,text,text[],boolean),
  public.karaoke_youtube_mark_exhausted(text,text,date),
  public.karaoke_youtube_get_budget(jsonb),
  public.karaoke_search_pool_begin(text,text)
from public, anon, authenticated;
grant execute on function
  public.karaoke_youtube_validate_keys(jsonb),
  public.karaoke_youtube_reserve(jsonb,text,text[],boolean),
  public.karaoke_youtube_mark_exhausted(text,text,date),
  public.karaoke_youtube_get_budget(jsonb),
  public.karaoke_search_pool_begin(text,text)
to service_role;

commit;
