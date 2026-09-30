-- Catalog reads use the general YouTube Data API quota bucket. Keep an
-- application-side reserve by limiting catalog maintenance to 2,000/day.
create or replace function public.karaoke_catalog_reserve()
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  insert into public.karaoke_catalog_usage(day, used)
    values ((now() at time zone 'America/Los_Angeles')::date, 1)
    on conflict(day) do update set used = karaoke_catalog_usage.used + 1
    where karaoke_catalog_usage.used < 2000;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.karaoke_catalog_reserve() from public, anon, authenticated;
grant execute on function public.karaoke_catalog_reserve() to service_role;
