const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { webcrypto } = require('node:crypto');

global.IS_REACT_ACT_ENVIRONMENT = true;
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const USER = '20000000-0000-4000-8000-000000000001';
const video = { id: 'one', youtube_video_id: 'DmftZuj-8vI', title: 'ขอบฟ้า karaoke',
  channel_name: 'Karaoke', thumbnail_url: '', duration: 180, embeddable: true, karaoke_score: 90 };
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function row(roomId, status = 'playing') {
  return { id: roomId === A ? 'item-a' : 'item-b', room_id: roomId,
    youtube_video_id: video.youtube_video_id, status, position: 1, requested_by: 'Host',
    requested_by_member_id: 'member', client_request_id: 'request',
    created_at: '2026-10-28T00:00:00Z', started_at: null, completed_at: null,
    notes: JSON.stringify({ video, singers: [{ id: 'singer', name: 'Host' }] }) };
}

async function mountProvider(t) {
  const storage = new Map();
  const state = { playing: false, rows: [], read: null, rpc: null };
  const client = {
    from(table) {
      let roomId;
      const builder = {
        select() { return this; }, eq(_column, value) { roomId = value; return this; },
        in() { return this; }, order() { return this; }, maybeSingle() { return this; }, abortSignal() { return this; },
        then(resolve, reject) {
          const data = state.read ? state.read(table, roomId) : table === 'rooms'
            ? { playback_is_playing: state.playing } : structuredClone(state.rows);
          return Promise.resolve(data).then(data => ({ data, error: null, status: 200 })).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc(name, parameters) {
      const promise = Promise.resolve(state.rpc?.(name, parameters));
      return { abortSignal() { return this; }, then: promise.then.bind(promise) };
    },
  };
  const overrides = {
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => client, isSupabaseConfigured: () => false },
    '@/lib/supabase/anonymous-auth': { ensureSupabaseIdentity: async () => ({ userId: USER, accessToken: 'test-token' }) },
  };
  const globals = {
    window: { addEventListener() {}, removeEventListener() {}, setInterval() { return 0; }, clearInterval() {} },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      const roomId = body.roomCode === 'BBBBBB' ? B : A;
      return Response.json({ success: true, room: { id: roomId, host_user_id: USER,
        room_code: body.roomCode, name: body.name, status: 'active', queue_mode: 'fifo',
        request_mode: 'auto_accept', is_queue_locked: false, created_at: '2026-10-28T00:00:00Z' },
      member: { id: 'member', room_id: roomId, user_id: USER, nickname: 'Host', role: 'host', joined_at: '2026-10-28T00:00:00Z' } });
    },
  };
  const modules = new Map();
  function load(file) {
    const absolute = path.resolve(__dirname, '..', file);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} };
    modules.set(absolute, module);
    const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
      if (name.startsWith('.')) return load(path.resolve(path.dirname(absolute), `${name}.ts`));
      return require(name);
    };
    vm.runInNewContext(source, { module, exports: module.exports, require: localRequire,
      console, setTimeout, clearTimeout, queueMicrotask, crypto: webcrypto, Response, AbortSignal, ...globals });
    return module.exports;
  }
  const { KaraokeProvider, useKaraoke, usePlaybackClock } = load('src/context/KaraokeContext.tsx');
  let api;
  let roomRenders = 0;
  let clockRenders = 0;
  function RoomProbe() { api = useKaraoke(); roomRenders++; return null; }
  function ClockProbe() { usePlaybackClock(); clockRenders++; return null; }
  let root;
  await act(async () => {
    root = create(React.createElement(KaraokeProvider, null,
      React.createElement(RoomProbe), React.createElement(ClockProbe)));
    await turn();
  });
  t.after(async () => { await act(async () => root.unmount()); });
  return { state, get api() { return api; }, get renders() { return { room: roomRenders, clock: clockRenders }; } };
}

test('an identical database response restores playback after local state diverges', async t => {
  const h = await mountProvider(t);
  h.state.rows = [row(A)];
  await act(async () => { await h.api.createRoom('A', 'AAAAAA'); });
  await act(async () => { await h.api.refreshRoomQueue(); });
  assert.equal(h.api.isPlaying, false);
  await act(async () => { h.api.setIsPlaying(true); });
  assert.equal(h.api.isPlaying, true);
  await act(async () => { await h.api.refreshRoomQueue(); });
  assert.equal(h.api.isPlaying, false, 'an authoritative pause must be applied even when the DB snapshot is unchanged');
});

test('a delayed enqueue in an old room cannot corrupt or supersede the new room refresh', async t => {
  const h = await mountProvider(t);
  const enqueue = deferred();
  const readB = deferred();
  h.state.rpc = () => enqueue.promise;
  await act(async () => { await h.api.createRoom('A', 'AAAAAA'); });
  let adding;
  await act(async () => { adding = h.api.addToQueue(video, 'Host', ['Host']); await turn(); });
  await act(async () => { await h.api.createRoom('B', 'BBBBBB'); });
  h.state.read = (table, roomId) => table === 'rooms' ? { playback_is_playing: true }
    : roomId === B ? readB.promise : [row(A, 'queued')];
  let refreshing;
  await act(async () => { refreshing = h.api.refreshRoomQueue(); await turn(); });
  await act(async () => { enqueue.resolve({ data: row(A, 'queued'), error: null, status: 200 }); await adding; await turn(); });
  await act(async () => { readB.resolve([row(B)]); await refreshing; });
  assert.equal(h.api.activeRoom.id, B);
  assert.equal(h.api.nowPlaying?.room_id, B, 'the current room snapshot must still apply');
  assert.equal(h.api.queue.some(item => item.room_id === A), false);
});

test('leaving and rejoining the same room discards a refresh from the prior room session', async t => {
  const h = await mountProvider(t);
  const readA = deferred();
  await act(async () => { await h.api.createRoom('A', 'AAAAAA'); });
  h.state.read = table => table === 'rooms' ? { playback_is_playing: true } : readA.promise;
  let refreshing;
  await act(async () => { refreshing = h.api.refreshRoomQueue(); await turn(); });
  await act(async () => { h.api.leaveRoom(); });
  await act(async () => { await h.api.createRoom('A', 'AAAAAA'); });
  await act(async () => { readA.resolve([row(A)]); await refreshing; });
  assert.equal(h.api.nowPlaying, null, 'a response from the previous room session is stale');
});

test('real provider playback ticks update the clock consumer without rendering room consumers', async t => {
  const h = await mountProvider(t);
  const before = h.renders;
  await act(async () => { h.api.setCurrentTime(0.5); });
  assert.equal(h.renders.room, before.room);
  assert.equal(h.renders.clock, before.clock + 1);
});
