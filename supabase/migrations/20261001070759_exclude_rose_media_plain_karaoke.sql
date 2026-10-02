-- Rose Media's “(KARAOKE)” uploads retain a lead vocal. Keep only videos
-- carrying its instrumental-sound label in the searchable catalog.
delete from public.karaoke_catalog
where channel_id = 'UCnm6ohF4dI3h9GiIUTtKxfg'
  and coalesce(payload ->> 'title', '') not ilike '%คาราโอเกะซาวด์ดนตรี%';
