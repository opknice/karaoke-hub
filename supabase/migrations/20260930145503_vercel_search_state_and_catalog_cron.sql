begin;

-- Persistent state for explicit YouTube searches. These tables replace the
-- single-host SQLite database so quota and duplicate-query protection work
-- across all Vercel Function instances.
create table public.karaoke_search_cache (
  query text primary key check (char_length(query) between 1 and 250),
  payload jsonb not null check (jsonb_typeof(payload) = 'array'),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index karaoke_search_cache_expiry_idx
  on public.karaoke_search_cache (expires_at);

create table public.karaoke_search_budget (
  day date primary key,
  used integer not null default 0 check (used >= 0)
);

create table public.karaoke_search_leases (
  query text primary key check (char_length(query) between 1 and 250),
  token uuid not null,
  expires_at timestamptz not null
);
create index karaoke_search_leases_expiry_idx
  on public.karaoke_search_leases (expires_at);

create table public.karaoke_search_clients (
  client text primary key check (client ~ '^[A-Za-z0-9-]{1,64}$'),
  last_request timestamptz not null
);
create index karaoke_search_clients_last_request_idx
  on public.karaoke_search_clients (last_request);

create table public.karaoke_search_outages (
  day date primary key
);

alter table public.karaoke_search_cache enable row level security;
alter table public.karaoke_search_budget enable row level security;
alter table public.karaoke_search_leases enable row level security;
alter table public.karaoke_search_clients enable row level security;
alter table public.karaoke_search_outages enable row level security;

revoke all privileges on table
  public.karaoke_search_cache,
  public.karaoke_search_budget,
  public.karaoke_search_leases,
  public.karaoke_search_clients,
  public.karaoke_search_outages
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.karaoke_search_cache,
  public.karaoke_search_budget,
  public.karaoke_search_leases,
  public.karaoke_search_clients,
  public.karaoke_search_outages
to service_role;

create function public.karaoke_search_get(p_query text)
returns table(payload jsonb, updated_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.payload, c.updated_at
  from public.karaoke_search_cache c
  where c.query = p_query
    and c.expires_at > now()
  limit 1;
$$;

create function public.karaoke_search_store(
  p_query text,
  p_payload jsonb,
  p_ttl_seconds integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if char_length(p_query) not between 1 and 250
    or jsonb_typeof(p_payload) <> 'array'
    or p_ttl_seconds not between 1 and 604800 then
    raise exception 'invalid search cache input' using errcode = '22023';
  end if;

  delete from public.karaoke_search_cache where expires_at <= now();
  insert into public.karaoke_search_cache(query, payload, updated_at, expires_at)
    values (p_query, p_payload, now(), now() + make_interval(secs => p_ttl_seconds))
    on conflict(query) do update set
      payload = excluded.payload,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at;
end;
$$;

create function public.karaoke_search_reserve(
  p_query text,
  p_client text,
  p_daily_limit integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
  v_now timestamptz := clock_timestamp();
  v_used integer;
  v_token uuid := gen_random_uuid();
begin
  if char_length(p_query) not between 1 and 250
    or p_client !~ '^[A-Za-z0-9-]{1,64}$'
    or p_daily_limit not between 1 and 10000 then
    raise exception 'invalid search reservation input' using errcode = '22023';
  end if;

  -- Lock the one budget row first. This gives every reservation the same lock
  -- order and serializes quota, lease and per-client checks for this day.
  insert into public.karaoke_search_budget(day, used)
    values (v_day, 0)
    on conflict(day) do nothing;
  select used into v_used
    from public.karaoke_search_budget
    where day = v_day
    for update;

  delete from public.karaoke_search_leases where expires_at <= v_now;
  delete from public.karaoke_search_clients where last_request < v_now - interval '1 day';
  delete from public.karaoke_search_cache where expires_at <= v_now;
  delete from public.karaoke_search_budget where day < v_day - 30;
  delete from public.karaoke_search_outages where day < v_day - 30;

  if exists (select 1 from public.karaoke_search_outages where day = v_day) then
    return jsonb_build_object('ok', false, 'reason', 'upstream_exhausted');
  end if;
  if exists (select 1 from public.karaoke_search_leases where query = p_query) then
    return jsonb_build_object('ok', false, 'reason', 'query_in_progress');
  end if;
  if exists (
    select 1 from public.karaoke_search_clients
    where client = p_client and last_request > v_now - interval '3 seconds'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'client_cooldown');
  end if;
  if v_used >= p_daily_limit then
    return jsonb_build_object('ok', false, 'reason', 'budget_exhausted');
  end if;

  update public.karaoke_search_budget set used = used + 1 where day = v_day;
  insert into public.karaoke_search_leases(query, token, expires_at)
    values (p_query, v_token, v_now + interval '2 minutes');
  insert into public.karaoke_search_clients(client, last_request)
    values (p_client, v_now)
    on conflict(client) do update set last_request = excluded.last_request;

  return jsonb_build_object('ok', true, 'token', v_token);
end;
$$;

create function public.karaoke_search_release(p_query text, p_token uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.karaoke_search_leases
  where query = p_query and token = p_token;
$$;

create function public.karaoke_search_get_budget(p_daily_limit integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
  v_used integer;
begin
  if p_daily_limit not between 1 and 10000 then
    raise exception 'invalid daily limit' using errcode = '22023';
  end if;
  select used into v_used from public.karaoke_search_budget where day = v_day;
  v_used := coalesce(v_used, 0);
  return jsonb_build_object(
    'used', v_used,
    'limit', p_daily_limit,
    'remaining', greatest(0, p_daily_limit - v_used),
    'warning', v_used >= floor(p_daily_limit * 0.8),
    'upstreamExhausted', exists (
      select 1 from public.karaoke_search_outages where day = v_day
    )
  );
end;
$$;

create function public.karaoke_search_mark_outage()
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.karaoke_search_outages(day)
    values ((now() at time zone 'America/Los_Angeles')::date)
    on conflict(day) do nothing;
$$;

create function public.karaoke_search_cleanup()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
begin
  delete from public.karaoke_search_cache where expires_at <= now();
  delete from public.karaoke_search_leases where expires_at <= now();
  delete from public.karaoke_search_clients where last_request < now() - interval '1 day';
  delete from public.karaoke_search_budget where day < v_day - 30;
  delete from public.karaoke_search_outages where day < v_day - 30;
end;
$$;

revoke all on function
  public.karaoke_search_get(text),
  public.karaoke_search_store(text,jsonb,integer),
  public.karaoke_search_reserve(text,text,integer),
  public.karaoke_search_release(text,uuid),
  public.karaoke_search_get_budget(integer),
  public.karaoke_search_mark_outage(),
  public.karaoke_search_cleanup()
from public, anon, authenticated;

grant execute on function
  public.karaoke_search_get(text),
  public.karaoke_search_store(text,jsonb,integer),
  public.karaoke_search_reserve(text,text,integer),
  public.karaoke_search_release(text,uuid),
  public.karaoke_search_get_budget(integer),
  public.karaoke_search_mark_outage(),
  public.karaoke_search_cleanup()
to service_role;

commit;
