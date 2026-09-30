import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function asRecord(value, label) {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${label} did not return an object`);
  }
  return value;
}

function asString(value, label) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${label} is missing`);
  }
  return value;
}

const projectUrl = requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL');
const anonymousKey = requiredEnvironment('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY');

const service = createClient(projectUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const createdUserIds = [];
let createdRoomId = null;

async function createAnonymousUser() {
  const bootstrap = createClient(projectUrl, anonymousKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await bootstrap.auth.signInAnonymously();
  if (error || !data.session || !data.user) {
    throw new Error(`Anonymous sign-in failed: ${error?.message ?? 'missing session'}`);
  }

  createdUserIds.push(data.user.id);
  return {
    id: data.user.id,
    client: createClient(projectUrl, anonymousKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    }),
  };
}

function queueInput(videoId, requestId) {
  return {
    p_youtube_video_id: videoId,
    p_video: {
      id: `yt-${videoId}`,
      youtube_video_id: videoId,
      title: `Integration test ${videoId}`,
      channel_name: 'Test channel',
      thumbnail_url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      duration: 180,
      embeddable: true,
      karaoke_score: 100,
    },
    p_singers: [{ id: requestId, name: 'Integration singer' }],
    p_user_notes: '',
    p_client_request_id: requestId,
  };
}

try {
  const [host, guest] = await Promise.all([createAnonymousUser(), createAnonymousUser()]);
  const roomCode = `T${crypto.randomUUID().replaceAll('-', '').slice(0, 9).toUpperCase()}`;

  const { data: roomPayload, error: createError } = await service.rpc('create_karaoke_room_for_user', {
    p_host_user_id: host.id,
    p_room_code: roomCode,
    p_name: 'Phase 2 integration test',
  });
  if (createError) throw new Error(`Room creation failed: ${createError.message}`);
  const created = asRecord(roomPayload, 'Room creation');
  const room = asRecord(created.room, 'Room');
  createdRoomId = asString(room.id, 'Room id');

  const { error: joinError } = await service.rpc('join_karaoke_room_for_user', {
    p_user_id: guest.id,
    p_room_code: roomCode,
    p_nickname: 'Guest integration test',
  });
  if (joinError) throw new Error(`Room join failed: ${joinError.message}`);

  const hostRequestId = crypto.randomUUID();
  const guestRequestId = crypto.randomUUID();
  const secondHostRequestId = crypto.randomUUID();

  const { data: firstSong, error: firstSongError } = await host.client.rpc('enqueue_song', {
    p_room_id: createdRoomId,
    ...queueInput('a1b2c3d4e5F', hostRequestId),
  });
  if (firstSongError) throw new Error(`First enqueue failed: ${firstSongError.message}`);
  const first = asRecord(firstSong, 'First enqueue');
  assert.equal(first.status, 'playing');

  const [guestSongResult, secondHostSongResult] = await Promise.all([
    guest.client.rpc('enqueue_song', {
      p_room_id: createdRoomId,
      ...queueInput('b1c2d3e4f5G', guestRequestId),
    }),
    host.client.rpc('enqueue_song', {
      p_room_id: createdRoomId,
      ...queueInput('c1d2e3f4g5H', secondHostRequestId),
    }),
  ]);
  if (guestSongResult.error) throw new Error(`Guest enqueue failed: ${guestSongResult.error.message}`);
  if (secondHostSongResult.error) throw new Error(`Second host enqueue failed: ${secondHostSongResult.error.message}`);

  const guestSong = asRecord(guestSongResult.data, 'Guest enqueue');
  const secondHostSong = asRecord(secondHostSongResult.data, 'Second host enqueue');
  assert.equal(guestSong.status, 'queued');
  assert.equal(secondHostSong.status, 'queued');

  const { data: queuedBeforeCancel, error: queuedBeforeCancelError } = await service
    .from('queue_items')
    .select('id,status,position')
    .eq('room_id', createdRoomId)
    .in('status', ['playing', 'queued'])
    .order('position', { ascending: true });
  if (queuedBeforeCancelError) throw new Error(`Queue read failed: ${queuedBeforeCancelError.message}`);
  assert.equal(queuedBeforeCancel.filter((item) => item.status === 'playing').length, 1);
  assert.equal(queuedBeforeCancel.filter((item) => item.status === 'queued').length, 2);

  const unauthorizedPlay = await guest.client.rpc('play_queue_item_now', {
    p_room_id: createdRoomId,
    p_item_id: asString(guestSong.id, 'Guest queue item id'),
    p_expected_playing_id: asString(first.id, 'First queue item id'),
  });
  assert.ok(unauthorizedPlay.error, 'Guest must not be allowed to force playback');

  const { error: cancelError } = await guest.client.rpc('cancel_own_song', {
    p_item_id: asString(guestSong.id, 'Guest queue item id'),
  });
  if (cancelError) throw new Error(`Guest cancel failed: ${cancelError.message}`);

  const { data: advancePayload, error: advanceError } = await host.client.rpc('advance_queue', {
    p_room_id: createdRoomId,
    p_expected_playing_id: asString(first.id, 'First queue item id'),
    p_reason: 'skipped',
  });
  if (advanceError) throw new Error(`Host skip failed: ${advanceError.message}`);
  const advanced = asRecord(advancePayload, 'Advance');
  assert.equal(advanced.changed, true);
  const next = asRecord(advanced.next, 'Advance next');
  assert.equal(next.id, secondHostSong.id);
  assert.equal(next.status, 'playing');

  const { data: finalRows, error: finalRowsError } = await service
    .from('queue_items')
    .select('id,status,position')
    .eq('room_id', createdRoomId)
    .order('created_at', { ascending: true });
  if (finalRowsError) throw new Error(`Final queue read failed: ${finalRowsError.message}`);
  assert.equal(finalRows.filter((item) => item.status === 'playing').length, 1);
  assert.equal(finalRows.find((item) => item.id === first.id)?.status, 'skipped');
  assert.equal(finalRows.find((item) => item.id === guestSong.id)?.status, 'cancelled');
  assert.equal(finalRows.find((item) => item.id === secondHostSong.id)?.status, 'playing');

  console.log('Phase 2 queue authority integration test passed.');
} finally {
  if (createdRoomId) {
    await service.from('queue_items').delete().eq('room_id', createdRoomId);
    await service.from('room_members').delete().eq('room_id', createdRoomId);
    await service.from('rooms').delete().eq('id', createdRoomId);
  }
  await Promise.all(createdUserIds.map((userId) => service.auth.admin.deleteUser(userId)));
}
