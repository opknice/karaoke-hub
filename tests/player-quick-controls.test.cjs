const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
const noop = () => {};
const video = { youtube_video_id: 'DmftZuj-8vI', title: 'Test Karaoke', version_type: 'karaoke' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function mountPage(t, { playing = true, native = true } = {}) {
  const listeners = new Map();
  const state = { restart: 0, skip: 0, queue: false, requests: 0, exits: 0, request: null, end: null };
  const media = { matches: true, addEventListener: (_name, fn) => { state.orientation = fn; }, removeEventListener: noop };
  const document = { fullscreenEnabled: native, fullscreenElement: null,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
    querySelector: () => null,
    exitFullscreen: async () => { state.exits++; document.fullscreenElement = null; listeners.get('fullscreenchange')?.(); },
  };
  const stage = { requestFullscreen: native ? async () => {
    state.requests++;
    if (state.request) await state.request();
    document.fullscreenElement = stage;
    listeners.get('fullscreenchange')?.();
  } : undefined };
  const context = { activeRoom: { room_code: 'TEST01' }, nowPlaying: playing ? { id: 'song-one', video } : null,
    volume: 50, isMuted: false, ensureActiveRoom: async () => {}, refreshRoomQueue: async () => {},
    skipSong: async () => { state.skip++; if (state.end) await state.end(); },
  };
  const modules = new Map();
  const overrides = {
    '@/context/KaraokeContext': { useKaraoke: () => context },
    '@/hooks/useVocalCutExtension': { useVocalCutExtension: () => ({ state: {}, toggle: noop, toggleNormalize: noop, setPlaybackRate: noop }) },
    '@/lib/vocal-playback': { getContinuousVocalPlayback: () => null, getVocalPlaybackDelay: () => 0 },
    '@/components/PlayerVocalCutStatus': { PlayerVocalCutStatus: () => null },
    '@/components/PlayerQRGuideCard': { PlayerQRGuideCard: () => null },
    '@/components/YouTubePlayer': { YouTubePlayer: React.forwardRef(function PlayerStub(_props, ref) {
      React.useImperativeHandle(ref, () => ({ restartCurrentSong: () => { state.restart++; } })); return null;
    }) },
    '@/components/PlayerSearchOverlay': { PlayerSearchOverlay: React.forwardRef(function SearchStub(props, ref) {
      state.overlayProps = props;
      React.useImperativeHandle(ref, () => ({ toggleQueueBrowser: () => { state.queue = !state.queue; props.onQueueBrowserActiveChange(state.queue); } }));
      return null;
    }) },
  };
  function load(file) {
    const absolute = path.resolve(__dirname, '..', file);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} }; modules.set(absolute, module);
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_target, key) => String(key) }) };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/') ? path.resolve(__dirname, '../src', name.slice(2)) : path.resolve(path.dirname(absolute), name);
        return load(fs.existsSync(`${base}.tsx`) ? `${base}.tsx` : `${base}.ts`);
      }
      return require(name);
    };
    vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, document,
      window: { matchMedia: () => media, addEventListener: noop, removeEventListener: noop },
      console, setTimeout, clearTimeout, queueMicrotask,
    }, { filename: absolute });
    return module.exports;
  }
  const Page = load('src/app/player/page.tsx').default;
  let renderer;
  await act(async () => { renderer = create(React.createElement(Page), { createNodeMock: element => element.props['data-player-stage'] ? stage : {} }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { state, document, stage, media, listeners, context,
    get root() { return renderer.root; },
    button: label => renderer.root.findByProps({ 'aria-label': label }),
    async click(label) { await act(async () => { renderer.root.findByProps({ 'aria-label': label }).props.onClick(); }); },
    async update() { await act(async () => renderer.update(React.createElement(Page))); },
  };
}

test('four real quick controls replace the legend and share replay and queue actions', async t => {
  const h = await mountPage(t);
  assert.equal(h.state.overlayProps.portalRootRef.current, h.stage);
  await h.click('เล่นซ้ำ'); assert.equal(h.state.restart, 1);
  assert.equal(h.button('เปิดเพลงในคิว').props['aria-expanded'], false);
  await h.click('เปิดเพลงในคิว'); assert.equal(h.state.queue, true);
  assert.equal(h.button('ปิดเพลงในคิว').props['aria-expanded'], true);
  await h.click('ปิดเพลงในคิว'); assert.equal(h.state.queue, false);
});

test('end button and keyboard delegate cannot advance twice while one request is pending', async t => {
  const h = await mountPage(t), pending = deferred(); h.state.end = () => pending.promise;
  await act(async () => { h.button('จบเพลง').props.onClick(); h.state.overlayProps.onEndCurrentSong(); });
  assert.equal(h.state.skip, 1);
  assert.equal(h.button('จบเพลง').props.disabled, true);
  await act(async () => pending.resolve());
  assert.equal(h.button('จบเพลง').props.disabled, false);
});

test('failed end command is visible and can be retried, while an empty player disables transport', async t => {
  const h = await mountPage(t); h.state.end = async () => { throw new Error('offline'); };
  await h.click('จบเพลง'); assert.ok(h.root.findAllByProps({ role: 'alert' }).length);
  assert.equal(h.button('จบเพลง').props.disabled, false);
  h.state.end = null; await h.click('จบเพลง'); assert.equal(h.state.skip, 2);
  h.context.nowPlaying = null; await h.update();
  assert.equal(h.button('เล่นซ้ำ').props.disabled, true);
  assert.equal(h.button('จบเพลง').props.disabled, true);
});

test('native fullscreen targets the entire stage and stays synchronized with browser exit', async t => {
  const h = await mountPage(t);
  await h.click('เต็มจอ'); assert.equal(h.state.requests, 1); assert.equal(h.document.fullscreenElement, h.stage);
  await h.click('ออกจากเต็มจอ'); assert.equal(h.state.exits, 1);
  await h.click('เต็มจอ');
  await act(async () => { h.document.fullscreenElement = null; h.listeners.get('fullscreenchange')(); });
  assert.ok(h.button('เต็มจอ'));
});

test('fullscreen request rejection allows retry and duplicate taps cannot send another request', async t => {
  const h = await mountPage(t), pending = deferred(); h.state.request = () => pending.promise;
  await act(async () => { const click = h.button('เต็มจอ').props.onClick; click(); click(); });
  assert.equal(h.state.requests, 1);
  await act(async () => pending.reject(new Error('denied')));
  assert.equal(h.button('เต็มจอ').props.disabled, false);
  assert.ok(h.root.findAllByProps({ role: 'alert' }).length);
  h.state.request = null; await h.click('เต็มจอ'); assert.equal(h.state.requests, 2);
});

test('unsupported fullscreen uses a named in-page mode with a working exit and Escape', async t => {
  const h = await mountPage(t, { native: false });
  await h.click('ขยายเวที'); assert.equal(h.state.requests, 0);
  assert.equal(h.root.findByProps({ 'data-player-stage': true }).props['data-stage-mode'], 'expanded');
  await h.click('คืนขนาดเวที');
  await h.click('ขยายเวที');
  await act(async () => h.listeners.get('keydown')({ key: 'Escape', defaultPrevented: false, preventDefault: noop }));
  assert.ok(h.button('ขยายเวที'));
});

test('rotation exits only a fullscreen owned by this stage and never exits a foreign element', async t => {
  const h = await mountPage(t);
  await h.click('เต็มจอ');
  await act(async () => { h.media.matches = false; h.state.orientation(); });
  assert.equal(h.state.exits, 1);
  h.document.fullscreenElement = {}; await h.click('เต็มจอ');
  assert.equal(h.state.exits, 1); assert.equal(h.state.requests, 1);
});

test('quick controls do not remain clickable over QR or lyrics dialogs', async t => {
  const h = await mountPage(t);
  const qr = h.root.findAll(node => node.type === 'button' && /แสดง QR/.test(node.props['aria-label'] ?? ''))[0];
  await act(async () => qr.props.onClick());
  assert.equal(h.root.findAllByProps({ 'aria-label': 'เล่นซ้ำ' }).length, 0);
  await h.click('ปิดหน้าต่าง QR Code');
  assert.ok(h.button('เล่นซ้ำ'));
  await act(async () => h.state.overlayProps.onLyricsModalOpenChange(true));
  assert.equal(h.root.findAllByProps({ 'aria-label': 'เล่นซ้ำ' }).length, 0);
});
