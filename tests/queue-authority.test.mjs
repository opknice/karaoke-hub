import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const queueMigration = fs.readFileSync(
  path.join(projectRoot, 'supabase/migrations/20260930085800_queue_authority_v2.sql'),
  'utf8'
);
const hardeningMigration = fs.readFileSync(
  path.join(projectRoot, 'supabase/migrations/20260930085944_queue_authority_v2_hardening.sql'),
  'utf8'
);
const sharedQueueManagementMigration = fs.readFileSync(
  path.join(projectRoot, 'supabase/migrations/20261001020131_allow_room_members_manage_queue.sql'),
  'utf8'
);
const postgrestCacheMigration = fs.readFileSync(
  path.join(projectRoot, 'supabase/migrations/20261001020324_reload_postgrest_schema_cache.sql'),
  'utf8'
);
const sharedPlaybackControlsMigration = fs.readFileSync(
  path.join(projectRoot, 'supabase/migrations/20261001024319_shared_room_playback_controls.sql'),
  'utf8'
);
const contextSource = fs.readFileSync(
  path.join(projectRoot, 'src/context/KaraokeContext.tsx'),
  'utf8'
);
const floatingQueueManagerSource = fs.readFileSync(
  path.join(projectRoot, 'src/components/FloatingQueueManager.tsx'),
  'utf8'
);
const roomRouteSource = fs.readFileSync(
  path.join(projectRoot, 'src/app/api/rooms/route.ts'),
  'utf8'
);

test('queue migration serializes transitions and enforces one playing item per room', () => {
  assert.match(queueMigration, /queue_items_one_playing_per_room_idx/);
  assert.match(queueMigration, /where status = 'playing'/);
  assert.match(queueMigration, /pg_advisory_xact_lock/g);
  assert.match(queueMigration, /create or replace function public\.enqueue_song/);
  assert.match(queueMigration, /create or replace function public\.advance_queue/);
  assert.match(queueMigration, /create or replace function public\.play_queue_item_now/);
});

test('authenticated clients cannot bypass queue RPCs with direct writes', () => {
  assert.match(hardeningMigration, /security definer/g);
  assert.match(
    hardeningMigration,
    /revoke insert, update, delete on public\.queue_items from authenticated/
  );
  assert.doesNotMatch(contextSource, /\.from\('queue_items'\)\s*\.insert/);
  assert.doesNotMatch(contextSource, /\.from\('queue_items'\)\s*\.update/);
});

test('room members can manage waiting songs without being able to alter the playing song', () => {
  assert.match(sharedQueueManagementMigration, /create or replace function public\.reorder_room_queue/);
  assert.match(sharedQueueManagementMigration, /member\.room_id = p_room_id/);
  assert.match(sharedQueueManagementMigration, /member\.user_id = v_user_id/);
  assert.match(sharedQueueManagementMigration, /create or replace function public\.cancel_room_queue_item/);
  assert.match(sharedQueueManagementMigration, /v_item\.status not in \('pending', 'queued'\)/);
  assert.match(sharedQueueManagementMigration, /security definer/);
  assert.match(sharedQueueManagementMigration, /set search_path = ''/);
  assert.match(sharedQueueManagementMigration, /revoke execute on function public\.cancel_room_queue_item\(uuid\) from public, anon/);
  assert.match(sharedQueueManagementMigration, /grant execute on function public\.cancel_room_queue_item\(uuid\) to authenticated/);
  assert.match(contextSource, /rpc\('cancel_room_queue_item'/);
  assert.match(postgrestCacheMigration, /notify pgrst, 'reload schema'/);
});

test('shared floating queue exposes ordering and deletion controls only for queued songs', () => {
  assert.match(floatingQueueManagerSource, /คิวเพลงของห้อง/);
  assert.match(floatingQueueManagerSource, /moveQueueItem\(item\.id, 'up'\)/);
  assert.match(floatingQueueManagerSource, /moveQueueItem\(item\.id, 'down'\)/);
  assert.match(floatingQueueManagerSource, /removeFromQueue\(item\.id\)/);
  assert.match(floatingQueueManagerSource, /nowPlaying && \(/);
  assert.match(floatingQueueManagerSource, /isQueueExpanded/);
  assert.match(floatingQueueManagerSource, /aria-expanded=\{isQueueVisible\}/);
  assert.match(floatingQueueManagerSource, /useSyncExternalStore/);
  assert.match(floatingQueueManagerSource, /max-h-\[25dvh\]/);
  assert.doesNotMatch(floatingQueueManagerSource, /removeFromQueue\(nowPlaying/);
});

test('all room members can synchronously pause, resume, or end the current song', () => {
  assert.match(sharedPlaybackControlsMigration, /add column if not exists playback_is_playing boolean/);
  assert.match(sharedPlaybackControlsMigration, /create or replace function public\.set_room_playback/);
  assert.match(sharedPlaybackControlsMigration, /member\.room_id = p_room_id/);
  assert.match(sharedPlaybackControlsMigration, /member\.user_id = v_user_id/);
  assert.match(sharedPlaybackControlsMigration, /create or replace function public\.advance_queue/);
  assert.match(sharedPlaybackControlsMigration, /set playback_is_playing = v_next\.id is not null/);
  assert.doesNotMatch(sharedPlaybackControlsMigration, /host permission required/);
  assert.match(sharedPlaybackControlsMigration, /security definer/g);
  assert.match(sharedPlaybackControlsMigration, /set search_path = ''/g);
  assert.match(sharedPlaybackControlsMigration, /grant execute on function public\.set_room_playback\(uuid, uuid, boolean\) to authenticated/);
  assert.match(sharedPlaybackControlsMigration, /notify pgrst, 'reload schema'/);
  assert.match(contextSource, /rpc\('set_room_playback'/);
  assert.match(contextSource, /table: 'rooms'/);
  assert.match(floatingQueueManagerSource, /setRoomPlayback\(!isPlaying\)/);
  assert.match(floatingQueueManagerSource, /runPlaybackAction\(skipSong\)/);
});

test('rooms bind verified auth users to persisted memberships', () => {
  assert.match(roomRouteSource, /supabase\.auth\.getUser\(accessToken\)/);
  assert.match(roomRouteSource, /create_karaoke_room_for_user/);
  assert.match(roomRouteSource, /join_karaoke_room_for_user/);
  assert.match(contextSource, /ensureSupabaseIdentity/);
  assert.match(contextSource, /member\.user_id !== identity\.userId/);
});

test('Realtime reflects database state instead of promoting songs locally', () => {
  assert.match(contextSource, /Realtime is reflection-only/);
  assert.doesNotMatch(contextSource, /Auto-promote/);
  assert.match(contextSource, /refreshRoomQueue/);
});
