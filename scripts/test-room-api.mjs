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
const appUrl = process.env.KARAOKE_APP_URL || 'http://localhost:3000';

if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY');

const service = createClient(projectUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const userIds = [];
let roomId = null;

async function createAnonymousSession() {
  const client = createClient(projectUrl, anonymousKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session || !data.user) {
    throw new Error(`Anonymous sign-in failed: ${error?.message ?? 'missing session'}`);
  }
  userIds.push(data.user.id);
  return data.session.access_token;
}

async function postRoom(token, body) {
  const response = await fetch(`${appUrl}/api/rooms`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

try {
  const [hostToken, guestToken] = await Promise.all([
    createAnonymousSession(),
    createAnonymousSession(),
  ]);
  const roomCode = `A${crypto.randomUUID().replaceAll('-', '').slice(0, 9).toUpperCase()}`;

  const created = await postRoom(hostToken, {
    action: 'create',
    roomCode,
    name: 'Phase 2 API integration test',
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.payload.success, true);
  assert.equal(created.payload.member.role, 'host');
  roomId = created.payload.room.id;

  const joined = await postRoom(guestToken, {
    action: 'join',
    roomCode,
    nickname: 'Guest API integration test',
  });
  assert.equal(joined.response.status, 200);
  assert.equal(joined.payload.success, true);
  assert.equal(joined.payload.room.id, roomId);
  assert.equal(joined.payload.member.role, 'guest');

  const unauthorized = await fetch(`${appUrl}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', roomCode: 'NOAUTH01', name: 'No auth' }),
  });
  assert.equal(unauthorized.status, 401);

  console.log('Phase 2 room API integration test passed.');
} finally {
  if (roomId) {
    await service.from('queue_items').delete().eq('room_id', roomId);
    await service.from('room_members').delete().eq('room_id', roomId);
    await service.from('rooms').delete().eq('id', roomId);
  }
  await Promise.all(userIds.map((userId) => service.auth.admin.deleteUser(userId)));
}
