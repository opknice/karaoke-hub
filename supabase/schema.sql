-- Karaoke Playlist Manager Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Profiles / Users table (Extending auth.users)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 2. Songs (Logical Song)
create table if not exists public.songs (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  artist text not null,
  language text default 'th',
  genre text default 'pop',
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 3. YouTube Videos (Karaoke Versions)
create table if not exists public.youtube_videos (
  id uuid default uuid_generate_v4() primary key,
  youtube_video_id text unique not null,
  song_id uuid references public.songs(id) on delete set null,
  title text not null,
  artist text,
  channel_id text,
  channel_name text,
  thumbnail_url text,
  duration integer default 0, -- seconds
  embeddable boolean default true,
  karaoke_score integer default 90, -- 0-100
  last_synced_at timestamptz default timezone('utc'::text, now()),
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 4. Playlists
create table if not exists public.playlists (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  description text,
  is_public boolean default false,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 5. Playlist Items
create table if not exists public.playlist_items (
  id uuid default uuid_generate_v4() primary key,
  playlist_id uuid references public.playlists(id) on delete cascade not null,
  youtube_video_id text not null,
  position integer not null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 6. Favorites
create table if not exists public.favorites (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  youtube_video_id text not null,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  unique(user_id, youtube_video_id)
);

-- 7. Karaoke Rooms
create table if not exists public.rooms (
  id uuid default uuid_generate_v4() primary key,
  host_user_id uuid references auth.users(id) on delete set null,
  room_code text unique not null,
  name text not null,
  status text default 'active' check (status in ('active', 'paused', 'closed')),
  queue_mode text default 'smart' check (queue_mode in ('fifo', 'round_robin', 'smart')),
  request_mode text default 'auto_accept' check (request_mode in ('auto_accept', 'host_approval')),
  is_queue_locked boolean default false,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  closed_at timestamptz
);

-- 8. Room Members
create table if not exists public.room_members (
  id uuid default uuid_generate_v4() primary key,
  room_id uuid references public.rooms(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete set null,
  nickname text not null,
  role text default 'guest' check (role in ('host', 'guest')),
  joined_at timestamptz default timezone('utc'::text, now()) not null
);

-- 9. Queue Items
create table if not exists public.queue_items (
  id uuid default uuid_generate_v4() primary key,
  room_id uuid references public.rooms(id) on delete cascade,
  youtube_video_id text not null,
  status text default 'queued' check (status in ('pending', 'queued', 'playing', 'completed', 'skipped', 'cancelled')),
  position integer not null,
  requested_by text not null,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  started_at timestamptz,
  completed_at timestamptz,
  notes text
);

-- 10. Queue Item Singers (Solo, Duet, Group)
create table if not exists public.queue_item_singers (
  id uuid default uuid_generate_v4() primary key,
  queue_item_id uuid references public.queue_items(id) on delete cascade not null,
  room_member_id uuid references public.room_members(id) on delete set null,
  singer_name text not null
);

-- 11. Karaoke Ratings
create table if not exists public.karaoke_ratings (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete set null,
  youtube_video_id text not null,
  rating integer check (rating between 1 and 5),
  lyrics_correct boolean default true,
  instrumental_quality integer default 5 check (instrumental_quality between 1 and 5),
  audio_quality integer default 5 check (audio_quality between 1 and 5),
  video_quality integer default 5 check (video_quality between 1 and 5),
  has_vocal boolean default false,
  is_karaoke boolean default true,
  feedback_tags text[],
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 12. Song History
create table if not exists public.song_history (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  youtube_video_id text not null,
  queue_item_id uuid references public.queue_items(id) on delete set null,
  singers text[] default array[]::text[],
  performed_at timestamptz default timezone('utc'::text, now()) not null,
  duration integer default 0,
  rating integer
);

-- Realtime publication for Party Mode
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.queue_items;
alter publication supabase_realtime add table public.room_members;

-- Enable Row Level Security (RLS). Legacy persistence tables stay private until
-- their authenticated application flows are implemented.
alter table public.profiles enable row level security;
alter table public.songs enable row level security;
alter table public.youtube_videos enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_items enable row level security;
alter table public.favorites enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.queue_items enable row level security;
alter table public.queue_item_singers enable row level security;
alter table public.karaoke_ratings enable row level security;
alter table public.song_history enable row level security;

-- Room data is readable only by an authenticated room member. Queue mutations
-- must go through authorization-checked RPCs, never direct table writes.
create policy rooms_member_select
on public.rooms for select to authenticated
using (
  host_user_id = (select auth.uid())
  or exists (
    select 1 from public.room_members as member
    where member.room_id = rooms.id
      and member.user_id = (select auth.uid())
  )
);

create policy room_members_self_select
on public.room_members for select to authenticated
using (user_id = (select auth.uid()));

create policy queue_items_member_select
on public.queue_items for select to authenticated
using (
  exists (
    select 1 from public.room_members as member
    where member.room_id = queue_items.room_id
      and member.user_id = (select auth.uid())
  )
);

revoke all privileges on table
  public.profiles,
  public.songs,
  public.youtube_videos,
  public.playlists,
  public.playlist_items,
  public.favorites,
  public.queue_item_singers,
  public.karaoke_ratings,
  public.song_history
from public, anon, authenticated;

revoke all privileges on table public.rooms, public.room_members, public.queue_items
from public, anon, authenticated;
grant select on table public.rooms, public.room_members, public.queue_items to authenticated;
