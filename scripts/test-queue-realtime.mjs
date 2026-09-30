import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const projectUrl = requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL');
const anonymousKey = requiredEnvironment('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY');

const service = createClient(projectUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const userIds = [];
let roomId = null;
let channel = null;

async function createAnonymousUser() {
  const bootstrap = createClient(projectUrl, anonymousKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await bootstrap.auth.signInAnonymously();
  if (error || !data.session || !data.user) {
    throw new Error(`Anonymous sign-in failed: ${error?.message ?? 'missing session'}`);
  }
  userIds.push(data.user.id);

  const client = createClient(projectUrl, anonymousKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  await client.realtime.setAuth(data.session.access_token);
  return { id: data.user.id, client };
}

function waitForSubscription(realtimeChannel) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Realtime subscription timed out')), 10_000);
    realtimeChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        resolve();
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timeout);
        reject(new Error(`Realtime subscription failed: ${status}`));
      }
    });
  });
}

try {
  const [host, guest] = await Promise.all([createAnonymousUser(), createAnonymousUser()]);
  const roomCode = `R${crypto.randomUUID().replaceAll('-', '').slice(0, 9).toUpperCase()}`;
  const { data: createdRoom, error: roomError } = await service.rpc('create_karaoke_room_for_user', {
    p_host_user_id: host.id,
    p_room_code: roomCode,
    p_name: 'Phase 2 Realtime integration test',
  });
  if (roomError || !createdRoom?.room?.id) {
    throw new Error(`Room creation failed: ${roomError?.message ?? 'missing room'}`);
  }
  roomId = createdRoom.room.id;

  const { error: joinError } = await service.rpc('join_karaoke_room_for_user', {
    p_user_id: guest.id,
    p_room_code: roomCode,
    p_nickname: 'Realtime guest',
  });
  if (joinError) throw new Error(`Room join failed: ${joinError.message}`);

  const eventPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Realtime queue event timed out')), 10_000);
    channel = guest.client
      .channel(`phase2-realtime-${roomCode}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'queue_items',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          clearTimeout(timeout);
          resolve(payload);
        }
      );
  });

  await waitForSubscription(channel);
  const requestId = crypto.randomUUID();
  const { error: enqueueError } = await host.client.rpc('enqueue_song', {
    p_room_id: roomId,
    p_youtube_video_id: 'z1y2x3w4v5U',
    p_video: { title: 'Realtime test' },
    p_singers: [{ id: requestId, name: 'Realtime host' }],
    p_user_notes: '',
    p_client_request_id: requestId,
  });
  if (enqueueError) throw new Error(`Queue enqueue failed: ${enqueueError.message}`);

  const payload = await eventPromise;
  assert.equal(payload.eventType, 'INSERT');
  assert.equal(payload.new.room_id, roomId);
  assert.equal(payload.new.status, 'playing');
  console.log('Phase 2 Realtime integration test passed.');
} finally {
  if (channel) await channel.unsubscribe();
  if (roomId) {
    await service.from('queue_items').delete().eq('room_id', roomId);
    await service.from('room_members').delete().eq('room_id', roomId);
    await service.from('rooms').delete().eq('id', roomId);
  }
  await Promise.all(userIds.map((userId) => service.auth.admin.deleteUser(userId)));
}
