create or replace function public.karaoke_catalog_search(p_patterns text[], p_official_ids text[])
returns setof jsonb language sql stable security invoker set search_path = '' as $$
  select v.payload from public.karaoke_catalog v
  where cardinality(p_patterns) between 1 and 20
    and v.expires_at > now()
    and v.search_text like p_patterns[1]
    and v.search_text like all(p_patterns)
    and v.payload->>'embeddable' = 'true'
  order by (v.channel_id = any(p_official_ids)) desc,
    case
      when lower(v.payload->>'title') like any(array[
        '%karaoke%', '%คาราโอเกะ%', '%instrumental%', '%backing track%',
        '%minus one%', '%no vocal%', '%no vocals%'
      ]) then 2
      when lower(v.payload->>'channel_name') like any(array[
        '%karaoke%', '%คาราโอเกะ%', '%sing king%', '%backing track%'
      ]) then 1
      else 0
    end desc,
    case when v.refreshed_at > now() - interval '1 hour'
      then (v.payload->>'views_count')::bigint end desc nulls last,
    v.video_id
  limit 100;
$$;

revoke all on function public.karaoke_catalog_search(text[],text[]) from public, anon, authenticated;
grant execute on function public.karaoke_catalog_search(text[],text[]) to service_role;
