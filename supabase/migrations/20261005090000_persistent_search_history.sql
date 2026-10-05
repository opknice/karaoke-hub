begin;

-- Permanent audit trail for explicit YouTube searches. This is deliberately
-- separate from karaoke_search_cache, whose rows are disposable by design.
create table public.karaoke_search_history (
  id bigint generated always as identity primary key,
  query text not null check (char_length(query) between 1 and 250),
  payload jsonb not null check (jsonb_typeof(payload) = 'array'),
  result_count integer not null check (result_count >= 0),
  source text not null check (source in ('youtube', 'video')),
  searched_at timestamptz not null default now()
);
create index karaoke_search_history_query_idx
  on public.karaoke_search_history (query, searched_at desc);
create index karaoke_search_history_searched_at_idx
  on public.karaoke_search_history (searched_at desc);

alter table public.karaoke_search_history enable row level security;
revoke all privileges on table public.karaoke_search_history from public, anon, authenticated;
grant insert on table public.karaoke_search_history to service_role;
grant usage on sequence public.karaoke_search_history_id_seq to service_role;

-- Preserve searches already present in the old expiring cache when this
-- migration is installed. Future searches are appended by the application.
insert into public.karaoke_search_history(query, payload, result_count, source, searched_at)
select query, payload, jsonb_array_length(payload), 'youtube', updated_at
from public.karaoke_search_cache;

create function public.karaoke_search_history_store(
  p_query text,
  p_payload jsonb,
  p_source text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if char_length(trim(p_query)) not between 1 and 250
    or jsonb_typeof(p_payload) <> 'array'
    or p_source not in ('youtube', 'video') then
    raise exception 'invalid search history input' using errcode = '22023';
  end if;

  insert into public.karaoke_search_history(query, payload, result_count, source)
    values (trim(regexp_replace(p_query, '[[:space:]]+', ' ', 'g')),
      p_payload, jsonb_array_length(p_payload), p_source);
end;
$$;

revoke all on function public.karaoke_search_history_store(text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.karaoke_search_history_store(text, jsonb, text)
  to service_role;

commit;
