/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTypeScriptModule(file) {
  const modules = new Map();

  function load(target) {
    const absolute = path.resolve(__dirname, '..', target);
    if (modules.has(absolute)) return modules.get(absolute).exports;

    const module = { exports: {} };
    modules.set(absolute, module);
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const localRequire = (name) => name.startsWith('.')
      ? load(path.resolve(path.dirname(absolute), `${name}.ts`))
      : require(name);
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: absolute })(localRequire, module, module.exports);
    return module.exports;
  }

  return load(file);
}

const video = {
  id: 'video-1',
  youtube_video_id: 'DmftZuj-8vI',
  title: 'ขอบฟ้า karaoke',
  channel_name: 'Karaoke',
  thumbnail_url: 'https://i.ytimg.com/vi/DmftZuj-8vI/hqdefault.jpg',
  duration: 240,
  embeddable: true,
  karaoke_score: 95,
};

function queueItem(id, overrides = {}) {
  return {
    id,
    youtube_video_id: video.youtube_video_id,
    video,
    status: 'queued',
    position: 1,
    requested_by: 'Host',
    singers: [{ id: 'singer-1', name: 'Host' }],
    created_at: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

test('fresh playback state starts empty instead of injecting demo songs', () => {
  const { restoreStoredPlaybackState } = loadTypeScriptModule('src/lib/player-state.ts');
  assert.deepEqual(restoreStoredPlaybackState(null, null), { nowPlaying: null, queue: [] });
});

test('legacy demo playback is removed without deleting real queue items', () => {
  const { restoreStoredPlaybackState } = loadTypeScriptModule('src/lib/player-state.ts');
  const realItem = queueItem('real-item');
  const restored = restoreStoredPlaybackState(
    JSON.stringify(queueItem('initial-playing-1', { status: 'playing' })),
    JSON.stringify([queueItem('sample-q-1'), realItem, queueItem('sample-q-2')])
  );

  assert.equal(restored.nowPlaying, null);
  assert.deepEqual(restored.queue, [realItem]);
});

test('valid saved playback is restored and malformed storage is ignored', () => {
  const { restoreStoredPlaybackState } = loadTypeScriptModule('src/lib/player-state.ts');
  const playing = queueItem('playing-real-item', { status: 'playing' });
  assert.deepEqual(
    restoreStoredPlaybackState(JSON.stringify(playing), JSON.stringify([queueItem('queued-real-item')])),
    { nowPlaying: playing, queue: [queueItem('queued-real-item')] }
  );
  assert.deepEqual(restoreStoredPlaybackState('{bad-json', 'not-json'), { nowPlaying: null, queue: [] });
});

test('player keyboard shortcuts recognize Windows key values and adjust one percent', () => {
  const { adjustPlayerVolume, getPlayerVolumeShortcut, isPlayerAutoLevelShortcut, isPlayerVocalCutShortcut, shouldMutePlayer } =
    loadTypeScriptModule('src/lib/player-keyboard.ts');
  const event = (overrides = {}) => ({
    altKey: false,
    code: '',
    ctrlKey: false,
    key: '',
    metaKey: false,
    shiftKey: true,
    ...overrides,
  });

  assert.equal(getPlayerVolumeShortcut(event({ key: '+', code: 'Equal' })), 'increase');
  assert.equal(getPlayerVolumeShortcut(event({ key: '_', code: 'Minus' })), 'decrease');
  assert.equal(getPlayerVolumeShortcut(event({ key: '+', code: 'NumpadAdd' })), 'increase');
  assert.equal(getPlayerVolumeShortcut(event({ key: '-', code: 'NumpadSubtract' })), 'decrease');
  assert.equal(getPlayerVolumeShortcut(event({ key: '+', code: 'Equal', shiftKey: false })), null);
  assert.equal(getPlayerVolumeShortcut(event({ key: '+', code: 'Equal', ctrlKey: true })), null);
  assert.equal(isPlayerVocalCutShortcut(event({ key: '*', code: 'Digit8' })), true);
  assert.equal(isPlayerVocalCutShortcut(event({ key: '*', code: 'NumpadMultiply', shiftKey: false })), true);
  assert.equal(isPlayerVocalCutShortcut(event({ key: '*', code: 'Digit8', ctrlKey: true })), false);
  assert.equal(isPlayerAutoLevelShortcut(event({ key: '/', code: 'Slash', shiftKey: false })), true);
  assert.equal(isPlayerAutoLevelShortcut(event({ key: '/', code: 'NumpadDivide', shiftKey: false })), true);
  assert.equal(isPlayerAutoLevelShortcut(event({ key: '?', code: 'Slash' })), false);
  assert.equal(isPlayerAutoLevelShortcut(event({ key: '/', code: 'Slash', shiftKey: false, ctrlKey: true })), false);

  assert.equal(adjustPlayerVolume(85, 'increase'), 86);
  assert.equal(adjustPlayerVolume(85, 'decrease'), 84);
  assert.equal(adjustPlayerVolume(100, 'increase'), 100);
  assert.equal(adjustPlayerVolume(0, 'decrease'), 0);
  assert.equal(shouldMutePlayer(0, false), true, 'zero volume must be a real mute');
  assert.equal(shouldMutePlayer(1, false), false, 'raising zero to one restores sound');
  assert.equal(shouldMutePlayer(85, true), true, 'explicit mute stays authoritative');
});
