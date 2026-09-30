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
const contextSource = fs.readFileSync(
  path.join(projectRoot, 'src/context/KaraokeContext.tsx'),
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
