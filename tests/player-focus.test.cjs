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
const video = { id: 'one', youtube_video_id: 'DmftZuj-8vI', title: 'สิ่งสำคัญ karaoke',
  channel_name: 'Karaoke', thumbnail_url: '', duration: 180, embeddable: true, karaoke_score: 95 };

async function environment(t, { mobile = true, playing = false } = {}) {
  const windowListeners = new Map(), documentListeners = new Map(), tasks = new Map();
  let timer = 0;
  const state = { focus: 0, blur: 0, added: 0, played: 0, restarted: 0, skipped: 0, volume: 50 };
  const document = { activeElement: null, body: { style: { overflow: 'auto' } },
    querySelector: () => null, hasFocus: () => true, getElementById: () => null,
    addEventListener: (name, fn) => documentListeners.set(name, fn),
    removeEventListener: (name, fn) => { if (documentListeners.get(name) === fn) documentListeners.delete(name); },
  };
  class Element {
    constructor(tagName) { this.tagName = tagName; this.isContentEditable = false; }
    focus() { state.focus++; document.activeElement = this; }
    blur() { state.blur++; if (document.activeElement === this) document.activeElement = document.body; }
    matches(selector) { return ['INPUT', 'TEXTAREA'].includes(this.tagName) && /input|textarea/.test(selector); }
    closest(selector) {
      if (this.control && selector.includes('[data-player-controls]')) return this;
      return this.matches(selector) || (this.tagName === 'BUTTON' && selector.includes('button')) ? this : null;
    }
  }
  document.body = Object.assign(new Element('BODY'), document.body);
  document.activeElement = document.body;
  const setTimeout = (fn, delay = 0) => { const id = ++timer; tasks.set(id, { fn, delay }); return id; };
  const clearTimeout = id => tasks.delete(id);
  const navigator = { maxTouchPoints: mobile ? 5 : 0, userAgent: mobile ? 'Android 15 Mobile' : 'Windows NT 10.0', platform: mobile ? 'Linux' : 'Win32' };
  const window = { navigator, matchMedia: query => ({ matches: mobile && ['(pointer: coarse)', '(hover: none)'].includes(query) }),
    setTimeout, clearTimeout, requestAnimationFrame: fn => setTimeout(fn),
    addEventListener: (name, fn) => windowListeners.set(name, fn),
    removeEventListener: (name, fn) => { if (windowListeners.get(name) === fn) windowListeners.delete(name); },
  };
  const mainInput = new Element('INPUT');
  const context = { activeRoom: null, nowPlaying: playing ? { id: 'playing', video } : null,
    queue: [{ id: 'queued', video, singers: [], requested_by: 'Host' }], roomMembers: [], volume: 50,
    addToQueue: async () => { state.added++; return { status: 'queued' }; },
    playQueueItem: async () => { state.played++; }, skipSong: async () => { state.skipped++; },
    setVolume: value => { state.volume = value; }, setIsMuted: noop,
  };
  const localCatalog = { initialized: true, mode: 'supabase', busy: null, panelOpen: false,
    search: noop, cancelSearch: noop, setPanelOpen: noop, chooseLocal: noop, chooseSupabase: noop, progress: 12 };
  const overrides = {
    '@/context/AuthContext': { useAuth: () => ({ nickname: 'Host' }) },
    '@/context/KaraokeContext': { useKaraoke: () => context },
    '@/hooks/usePlayerSearchVersion': { usePlayerSearchVersion: () => ({ version: 'karaoke', setVersion: noop, desktop: false }) },
    '@/lib/use-local-catalog': { useLocalCatalog: () => localCatalog },
    '@/lib/use-catalog-preview': { useCatalogPreview: () => '' },
    '@/lib/youtube-search-client': { getLocalSearchPreview: query => query.trim().length >= 2 ? [video] : [],
      isDirectVideoQuery: () => false, searchPlayerKaraoke: async () => ({ videos: [video], source: 'catalog' }),
      getPopularKaraokeVideos: async () => ({ videos: [video] }) },
    './OfficialChannelBadge': { OfficialChannelBadge: () => null },
    './PlayerIdleGuide': { PlayerIdleWelcome: () => null, PlayerIdleKeyboardHeading: () => null,
      PlayerIdleKeyboardHints: () => null, PlayerIdleRoom: () => null },
    './LyricsGoogleSearchModal': { LyricsGoogleSearchModal: () => null },
    'next/image': { default: props => React.createElement('img', props) },
    'next/script': { default: () => null },
    'react-dom': { createPortal: (content, target) => { state.portalTarget = target; (state.portalTargets ??= []).push(target); return content; } },
  };
  const modules = new Map();
  function load(file) {
    const absolute = path.resolve(__dirname, '..', file);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} }; modules.set(absolute, module);
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.endsWith('.css')) return { default: {} };
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
      if (name.startsWith('.')) return load(path.resolve(path.dirname(absolute), `${name}.ts`));
      return require(name);
    };
    vm.runInNewContext(code, { module, exports: module.exports, require: localRequire,
      window, navigator, document, HTMLElement: Element, console, setTimeout, clearTimeout,
      AbortController, AbortSignal, URL, process: { env: {} },
    }, { filename: absolute });
    return module.exports;
  }
  let renderer;
  const h = { state, document, window, windowListeners, documentListeners, mainInput, Element, context, localCatalog,
    async flush() {
      await act(async () => {
        for (const [id, task] of [...tasks]) if (task.delay === 0) { tasks.delete(id); task.fn(); }
        await Promise.resolve();
      });
    },
    async mountOverlay(extraProps = {}) {
      const { PlayerSearchOverlay } = load('src/components/PlayerSearchOverlay.tsx');
      await act(async () => { renderer = create(React.createElement(PlayerSearchOverlay, {
        onQueueBrowserActiveChange: noop, onRestartCurrentSong: () => { state.restarted++; },
        onToggleVocalCut: noop, onToggleAutoLevel: noop, onAdjustTempo: noop, onTempoShortcut: noop,
        ...extraProps,
      }), { createNodeMock: element => element.props.role === 'combobox' ? mainInput : new Element(element.type.toUpperCase()) }); });
      return renderer;
    },
    async mountModal(previousFocus, extraProps = {}) {
      document.activeElement = previousFocus;
      const { LyricsGoogleSearchModal } = load('src/components/LyricsGoogleSearchModal.tsx');
      const props = { open: true, query: 'เพลง', onClose: noop, ...extraProps };
      await act(async () => { renderer = create(React.createElement(LyricsGoogleSearchModal, props),
        { createNodeMock: element => new Element(element.type.toUpperCase()) }); });
      await h.flush();
      h.setModalOpen = async open => { await act(async () => renderer.update(React.createElement(LyricsGoogleSearchModal, { ...props, open }))); };
      return () => h.setModalOpen(false);
    },
    async type(value) { await act(async () => renderer.root.findByProps({ role: 'combobox' }).props.onChange({ target: { value } })); },
    async key(key, overrides = {}) {
      await act(async () => { windowListeners.get('keydown')?.({ key, code: key, target: document.body,
        altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false,
        preventDefault: noop, stopPropagation: noop, ...overrides }); });
    },
    get root() { return renderer.root; },
  };
  t.after(async () => { if (renderer) await act(async () => renderer.unmount()); });
  return h;
}

test('mobile mount never auto-focuses the idle or hidden search field or binds recapture listeners', async t => {
  for (const playing of [false, true]) {
    await t.test(playing ? 'while playing' : 'idle', async t => {
      const h = await environment(t, { playing });
      await h.mountOverlay(); await h.flush();
      assert.equal(h.state.focus, 0);
      assert.equal(h.documentListeners.has('click'), false);
      assert.equal(h.windowListeners.has('blur'), false);
      assert.equal(h.windowListeners.has('karaoke-player-focus-search'), false);
    });
  }
});

test('mobile clear and close buttons dismiss search and blur without recapturing focus', async t => {
  const h = await environment(t); await h.mountOverlay();
  for (const label of ['ล้างและปิดค้นหา', 'ปิดค้นหา']) {
    h.mainInput.focus(); await h.type('สิ่งสำคัญ');
    const focused = h.state.focus;
    await act(async () => h.root.findByProps({ 'aria-label': label }).props.onClick());
    await h.flush();
    assert.equal(h.root.findByProps({ role: 'combobox' }).props.value, '');
    assert.notEqual(h.document.activeElement, h.mainInput);
    assert.equal(h.state.focus, focused);
  }
});

test('successful mobile song selection dismisses the keyboard and search results', async t => {
  const h = await environment(t); await h.mountOverlay();
  h.mainInput.focus(); await h.type('สิ่งสำคัญ');
  const focused = h.state.focus;
  await act(async () => h.root.findAllByProps({ role: 'option' })[0].props.onClick());
  await h.flush();
  assert.equal(h.state.added, 1);
  assert.equal(h.root.findByProps({ role: 'combobox' }).props.value, '');
  assert.notEqual(h.document.activeElement, h.mainInput);
  assert.equal(h.state.focus, focused);
});

test('touch users can reopen search during playback after closing or adding a song', async t => {
  const h = await environment(t, { playing: true }); await h.mountOverlay();
  for (const action of ['close', 'select']) {
    const focused = h.state.focus;
    await act(async () => h.root.findByProps({ 'aria-label': 'เปิดค้นหาเพลง' }).props.onClick());
    assert.equal(h.root.findByProps({ role: 'combobox' }).props['aria-expanded'], true);
    assert.equal(h.state.focus, focused, 'opening search must wait for a direct input tap');
    h.mainInput.focus(); await h.type('สิ่งสำคัญ');
    if (action === 'close') {
      await act(async () => h.root.findByProps({ 'aria-label': 'ปิดค้นหา' }).props.onClick());
    } else {
      await act(async () => h.root.findAllByProps({ role: 'option' })[0].props.onClick());
    }
    await h.flush();
    assert.notEqual(h.document.activeElement, h.mainInput);
    assert.equal(h.root.findByProps({ role: 'combobox' }).props['aria-expanded'], false);
    assert.equal(h.root.findByProps({ 'aria-label': 'เปิดค้นหาเพลง' }).type, 'button');
  }
});

test('mobile queue activation blurs the search input without restoring it', async t => {
  const h = await environment(t, { playing: true }); await h.mountOverlay();
  h.mainInput.focus(); const focused = h.state.focus;
  await h.key('ArrowDown'); await h.key('Enter'); await h.flush();
  assert.equal(h.state.played, 1);
  assert.notEqual(h.document.activeElement, h.mainInput);
  assert.equal(h.state.focus, focused);
});

test('desktop recapture, immediate typing, queue navigation and shortcuts remain available', async t => {
  const h = await environment(t, { mobile: false, playing: true }); await h.mountOverlay(); await h.flush();
  assert.equal(h.document.activeElement, h.mainInput);
  assert.equal(h.documentListeners.has('click'), true);
  assert.equal(h.windowListeners.has('blur'), true);
  h.mainInput.blur();
  h.documentListeners.get('click')({ target: new h.Element('BUTTON') }); await h.flush();
  assert.equal(h.document.activeElement, h.mainInput);
  await h.key('Home'); await h.key('End');
  assert.equal(h.state.restarted, 1); assert.equal(h.state.skipped, 1);
  await h.key('+', { code: 'Equal', shiftKey: true }); assert.equal(h.state.volume, 51);
  await h.key('ArrowDown'); await h.key('Enter'); await h.flush(); assert.equal(h.state.played, 1);
  h.mainInput.blur(); await h.key('a'); assert.equal(h.document.activeElement, h.mainInput);
});

test('a real keyboard can still initiate search on a touch device or Android TV', async t => {
  const h = await environment(t, { playing: true }); await h.mountOverlay();
  assert.notEqual(h.document.activeElement, h.mainInput);
  await h.key('a');
  assert.equal(h.document.activeElement, h.mainInput);
});

test('lyrics form waits for an explicit field tap on mobile', async t => {
  const h = await environment(t); await h.mountOverlay(); await h.type('เพลง');
  await act(async () => h.root.findByProps({ 'aria-controls': 'player-lyrics-search-form' }).props.onClick());
  assert.equal(h.root.findByProps({ id: 'player-remembered-lyrics' }).props.autoFocus, false);
});

test('lyrics modal restores desktop input focus and mobile button focus without reopening mobile input', async t => {
  for (const [mobile, tag, restore] of [[true, 'INPUT', false], [true, 'TEXTAREA', false], [true, 'BUTTON', true], [false, 'INPUT', true]]) {
    await t.test(`${mobile ? 'mobile' : 'desktop'} ${tag}`, async t => {
      const h = await environment(t, { mobile });
      const previous = new h.Element(tag);
      const close = await h.mountModal(previous);
      await close();
      assert.equal(h.document.activeElement === previous, restore);
      assert.equal(h.document.body.style.overflow, 'auto');
    });
  }
});

test('a closed lyrics portal no longer blocks later desktop kiosk focus', async t => {
  const h = await environment(t, { mobile: false });
  const close = await h.mountModal(h.mainInput);
  await close();
  const dialog = h.root.findByProps({ role: 'dialog' });
  assert.equal(dialog.props['aria-hidden'], true);
  assert.equal(dialog.props['aria-modal'], false,
    'the mounted Google-results portal must stop advertising an active modal after closing');
});

test('the toolbar handle switches from search into the real queue and can close an empty queue without mobile focus', async t => {
  const h = await environment(t, { playing: true });
  const ref = React.createRef(); await h.mountOverlay({ ref });
  h.mainInput.focus(); await h.type('สิ่งสำคัญ');
  const focused = h.state.focus;
  await act(async () => ref.current.toggleQueueBrowser()); await h.flush();
  assert.equal(h.root.findByProps({ role: 'combobox' }).props.value, '');
  assert.equal(h.root.findByProps({ id: 'player-queue-results' }).props.role, 'listbox');
  assert.equal(h.state.focus, focused);
  assert.notEqual(h.document.activeElement, h.mainInput);
  await act(async () => h.root.findByProps({ 'aria-label': 'ปิดคิว' }).props.onClick()); await h.flush();
  assert.equal(h.root.findAllByProps({ id: 'player-queue-results' }).length, 0);
  h.context.queue = [];
  await act(async () => ref.current.toggleQueueBrowser());
  assert.equal(h.root.findByProps({ id: 'player-queue-results' }).findByProps({ 'aria-disabled': 'true' }).props.role, 'option');
  await act(async () => ref.current.toggleQueueBrowser()); await h.flush();
  assert.equal(h.state.focus, focused);
});

test('keyboard End uses the shared guarded page command and Space keeps native button activation', async t => {
  const h = await environment(t, { mobile: false, playing: true });
  let ended = 0;
  await h.mountOverlay({ onEndCurrentSong: async () => { ended++; } }); await h.flush();
  await h.key('End'); assert.equal(ended, 1); assert.equal(h.state.skipped, 0);
  const button = new h.Element('BUTTON'); button.control = true; button.focus();
  const focused = h.state.focus;
  h.documentListeners.get('click')({ target: button }); await h.flush();
  await h.key(' ', { target: button });
  assert.equal(h.state.focus, focused);
  assert.equal(h.document.activeElement, button);
});

test('lyrics results render inside the active fullscreen stage', async t => {
  const h = await environment(t);
  const fullscreenStage = new h.Element('DIV'); h.document.fullscreenElement = fullscreenStage;
  await h.mountModal(h.mainInput, { portalRoot: fullscreenStage });
  assert.equal(h.state.portalTarget, fullscreenStage);
});

test('an initialized lyrics widget keeps the same portal host across fullscreen entry and exit', async t => {
  const h = await environment(t), stage = new h.Element('DIV');
  let widget, executions = 0;
  h.window.google = { search: { cse: { element: {
    getElement: () => widget,
    render: () => { widget = { execute: () => { executions++; } }; },
  } } } };
  const close = await h.mountModal(h.mainInput, { portalRoot: stage });
  const script = h.root.find(node => String(node.props.src).startsWith('https://cse.google.com/cse.js'));
  await act(async () => script.props.onReady()); await h.flush(); assert.equal(executions, 1);
  await close(); h.document.fullscreenElement = stage; await h.setModalOpen(true); await h.flush();
  h.document.fullscreenElement = null; await h.setModalOpen(true);
  assert.equal(new Set(h.state.portalTargets).size, 1, 'changing portal host would recreate the Google results DOM');
  assert.equal(h.state.portalTarget, stage);
});

test('the explicit queue command takes precedence over a running catalog download without cancelling it', async t => {
  const h = await environment(t, { playing: true });
  h.localCatalog.busy = 'downloading';
  const ref = React.createRef(); await h.mountOverlay({ ref });
  await act(async () => ref.current.toggleQueueBrowser());
  assert.equal(h.root.findAllByProps({ id: 'player-queue-results' }).length, 1);
  assert.equal(h.localCatalog.busy, 'downloading');
  await act(async () => h.root.findByProps({ 'aria-label': 'ปิดคิว' }).props.onClick()); await h.flush();
  assert.equal(h.root.findAllByProps({ id: 'player-queue-results' }).length, 0);
  assert.equal(h.root.findByProps({ role: 'combobox' }).props['aria-expanded'], true, 'closing queue returns to the download view');
  assert.equal(h.state.focus, 0);
});
