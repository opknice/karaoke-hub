-- Rank title relevance before limiting the candidate pool. The previous RPC
-- limited official-channel matches first, which could discard an exact song
-- title before the application-level ranker received it.
create or replace function public.karaoke_catalog_search_v2(
  p_query text,
  p_patterns text[],
  p_official_ids text[]
)
returns setof jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with candidates as (
    select
      v.*,
      lower(trim(regexp_replace(
        v.payload->>'title',
        '^[[:space:]]*(คาราโอเกะ|karaoke)[[:space:]]*',
        '',
        'i'
      ))) as title_text
    from public.karaoke_catalog v
    where char_length(p_query) between 2 and 250
      and cardinality(p_patterns) between 1 and 20
      and v.expires_at > now()
      and v.search_text like p_patterns[1]
      and v.search_text like all(p_patterns)
      and v.payload->>'embeddable' = 'true'
  ),
  scored as (
    select
      c.*,
      trim(regexp_replace(
        c.title_text,
        '[[:space:]]+[-–—|/:：•·][[:space:]]*.*$',
        ''
      )) as primary_title
    from candidates c
  )
  select s.payload
  from scored s
  order by
    case
      when s.primary_title = p_query or s.title_text = p_query then 5
      when s.title_text like p_query || '%' then 4
      when s.title_text like '%' || p_query || '%' then 3
      else 1
    end desc,
    (s.channel_id = any(p_official_ids)) desc,
    case
      when lower(s.payload->>'title') like any(array[
        '%karaoke%', '%คาราโอเกะ%', '%instrumental%', '%backing track%',
        '%minus one%', '%no vocal%', '%no vocals%'
      ]) then 2
      when lower(s.payload->>'channel_name') like any(array[
        '%karaoke%', '%คาราโอเกะ%', '%sing king%', '%backing track%'
      ]) then 1
      else 0
    end desc,
    case when s.refreshed_at > now() - interval '1 hour'
      then (s.payload->>'views_count')::bigint end desc nulls last,
    s.video_id
  limit 100;
$$;

revoke all on function public.karaoke_catalog_search_v2(text,text[],text[])
  from public, anon, authenticated;
grant execute on function public.karaoke_catalog_search_v2(text,text[],text[])
  to service_role;
