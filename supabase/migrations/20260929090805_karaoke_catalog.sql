-- Separate from user playlists/queue. Only the application server can access it.
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_cron;

create table public.karaoke_catalog (
  video_id text primary key check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  channel_id text not null,
  search_text text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  refreshed_at timestamptz not null,
  expires_at timestamptz not null
);
create index karaoke_catalog_search_idx on public.karaoke_catalog using gin (search_text extensions.gin_trgm_ops);
create index karaoke_catalog_expiry_idx on public.karaoke_catalog (expires_at);
create index karaoke_catalog_refresh_idx on public.karaoke_catalog (refreshed_at);

create table public.karaoke_catalog_sync (
  channel_id text primary key,
  playlist_id text not null,
  page_token text,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.karaoke_catalog_usage (
  day date primary key,
  used integer not null default 0 check (used >= 0)
);
create table public.karaoke_catalog_leases (
  name text primary key,
  token uuid not null,
  expires_at timestamptz not null
);
alter table public.karaoke_catalog enable row level security;
alter table public.karaoke_catalog_sync enable row level security;
alter table public.karaoke_catalog_usage enable row level security;
alter table public.karaoke_catalog_leases enable row level security;
revoke all on public.karaoke_catalog, public.karaoke_catalog_sync, public.karaoke_catalog_usage, public.karaoke_catalog_leases from public, anon, authenticated;
grant select, insert, update, delete on public.karaoke_catalog, public.karaoke_catalog_sync, public.karaoke_catalog_usage, public.karaoke_catalog_leases to service_role;

create function public.karaoke_catalog_search(p_patterns text[], p_official_ids text[])
returns setof jsonb language sql stable security invoker set search_path = '' as $$
  select v.payload from public.karaoke_catalog v
  where cardinality(p_patterns) between 1 and 20
    and v.expires_at > now()
    and v.search_text like p_patterns[1]
    and v.search_text like all(p_patterns)
    and v.payload->>'embeddable' = 'true'
  order by (v.channel_id = any(p_official_ids)) desc,
    case when v.refreshed_at > now() - interval '1 hour'
      then (v.payload->>'views_count')::bigint end desc nulls last,
    v.video_id
  limit 100;
$$;

create function public.karaoke_catalog_reserve()
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  insert into public.karaoke_catalog_usage(day, used)
    values ((now() at time zone 'America/Los_Angeles')::date, 1)
    on conflict(day) do update set used = karaoke_catalog_usage.used + 1
    where karaoke_catalog_usage.used < 500;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create function public.karaoke_catalog_lock(p_name text, p_token uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  insert into public.karaoke_catalog_leases(name, token, expires_at)
    values (p_name, p_token, now() + interval '5 minutes')
    on conflict(name) do update set token=excluded.token, expires_at=excluded.expires_at
    where karaoke_catalog_leases.expires_at < now() or karaoke_catalog_leases.token = p_token;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function public.karaoke_catalog_search(text[],text[]), public.karaoke_catalog_reserve(), public.karaoke_catalog_lock(text,uuid) from public, anon, authenticated;
grant execute on function public.karaoke_catalog_search(text[],text[]), public.karaoke_catalog_reserve(), public.karaoke_catalog_lock(text,uuid) to service_role;

-- Expire metadata at 29 days; daily deletion stays within the 30-day limit.
-- This does not touch user playlists/history or any pre-existing table.
select cron.schedule('karaoke-catalog-retention', '17 2 * * *', $job$
  delete from public.karaoke_catalog where expires_at <= now();
  delete from public.karaoke_catalog_usage where day < current_date - 30;
  delete from public.karaoke_catalog_leases where expires_at < now();
  delete from cron.job_run_details where jobid in
    (select jobid from cron.job where jobname = 'karaoke-catalog-retention')
    and end_time < now() - interval '7 days';
$job$);
