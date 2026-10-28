const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadModule(file, globals = {}, overrides = {}) {
  const modules = new Map();
  function load(target) {
    const absolute = path.resolve(__dirname, '..', target);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} };
    modules.set(absolute, module);
    const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === 'server-only') return {};
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
      if (name.startsWith('.')) return load(path.resolve(path.dirname(absolute), `${name}.ts`));
      return require(name);
    };
    vm.runInNewContext(source, {
      module, exports: module.exports, require: localRequire,
      console, setTimeout, clearTimeout, AbortController, AbortSignal, URL,
      Headers, Request, Response, DOMException, ...globals,
    }, { filename: absolute });
    return module.exports;
  }
  return load(file);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const turn = () => new Promise(resolve => setImmediate(resolve));

test('cancelling one search settles immediately while another shared caller still receives results', async () => {
  const response = deferred();
  let calls = 0;
  const api = loadModule('src/lib/youtube-search-client.ts', {
    fetch() { calls++; return response.promise; },
  });
  const first = new AbortController();
  const second = new AbortController();
  const cancelled = api.searchYouTubeKaraoke('ขอบฟ้า', first.signal, 'youtube');
  const remaining = api.searchYouTubeKaraoke('ขอบฟ้า', second.signal, 'youtube');
  let cancellation;
  const observed = cancelled.catch(error => { cancellation = error.name; });
  first.abort();
  await turn();
  assert.equal(cancellation, 'AbortError', 'cancellation must settle before the network responds');
  assert.equal(calls, 1);
  response.resolve(Response.json({ success: true, data: [] }));
  await observed;
  assert.equal((await remaining).length, 0);
});

test('cancelling the last search aborts the network and allows a new request for the same query', async () => {
  const signals = [];
  const api = loadModule('src/lib/youtube-search-client.ts', {
    fetch(_input, init) {
      signals.push(init.signal);
      return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    },
  });
  const first = new AbortController();
  const abandoned = api.searchYouTubeKaraoke('ขอบฟ้า', first.signal, 'youtube').catch(error => error.name);
  first.abort();
  await turn();
  assert.equal(signals[0]?.aborted, true, 'the unused network request must be aborted');
  assert.equal(await abandoned, 'AbortError');
  const second = new AbortController();
  const replacement = api.searchYouTubeKaraoke('ขอบฟ้า', second.signal, 'youtube').catch(error => error.name);
  assert.equal(signals.length, 2, 'an abandoned request must not poison the in-flight cache');
  second.abort();
  await replacement;
});

test('search has a bounded deadline and reports a retryable error instead of waiting indefinitely', async () => {
  const timeout = new AbortController();
  const api = loadModule('src/lib/youtube-search-client.ts', {
    AbortSignal: { any: AbortSignal.any.bind(AbortSignal), timeout: () => timeout.signal },
    fetch(_input, init) {
      return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    },
  });
  const request = api.searchYouTubeKaraoke('ขอบฟ้า', undefined, 'youtube');
  const observed = request.catch(error => error);
  timeout.abort(new DOMException('Timed out', 'TimeoutError'));
  let settled = false;
  void observed.then(() => { settled = true; });
  await turn();
  assert.equal(settled, true, 'the search must settle when its deadline expires');
  assert.match((await observed).message, /นาน|เวลา|ลองใหม่/);
});

function iframeEnvironment() {
  const scripts = [];
  const timers = new Map();
  const window = {};
  const document = {
    querySelector: () => scripts.find(script => !script.removed) ?? null,
    createElement() {
      const listeners = new Map();
      return {
        removed: false,
        addEventListener: (name, listener) => listeners.set(name, listener),
        removeEventListener: name => listeners.delete(name),
        remove() { this.removed = true; },
        dispatch(name) { listeners.get(name)?.(); },
      };
    },
    head: { appendChild(script) { scripts.push(script); } },
  };
  const api = loadModule('src/lib/youtube-iframe-api.ts', {
    window, document,
    setTimeout(callback) { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return { api, window, scripts, timers };
}

test('a failed YouTube API load can be retried without keeping the failed script or promise', async () => {
  const env = iframeEnvironment();
  const first = env.api.loadYouTubeIframeApi();
  const failed = assert.rejects(first, /YouTube/);
  env.scripts[0].dispatch('error');
  await failed;
  const retry = env.api.loadYouTubeIframeApi();
  void retry.catch(() => {});
  assert.notEqual(retry, first);
  assert.equal(env.scripts[0].removed, true);
  assert.equal(env.scripts.length, 2);
  assert.equal(env.api.loadYouTubeIframeApi(), retry, 'concurrent callers still share one attempt');
  env.window.YT = { Player() {} };
  env.window.onYouTubeIframeAPIReady();
  assert.equal(await retry, env.window.YT);
  assert.equal(env.timers.size, 0);
});

test('YouTube readiness timeout rejects and restores the previous callback before retrying', async () => {
  const env = iframeEnvironment();
  const previous = () => {};
  env.window.onYouTubeIframeAPIReady = previous;
  const attempt = env.api.loadYouTubeIframeApi();
  const failed = assert.rejects(attempt, /YouTube/);
  assert.equal(env.timers.size, 1, 'readiness must have a deadline');
  [...env.timers.values()][0]();
  await failed;
  assert.equal(env.window.onYouTubeIframeAPIReady, previous);
  assert.equal(env.scripts[0].removed, true);
});

test('playback clock notifies only clock subscribers and reuses unchanged snapshots', () => {
  const { createPlaybackClock } = loadModule('src/lib/playback-clock.ts');
  const clock = createPlaybackClock();
  assert.equal(clock.getSnapshot().currentTime, 0);
  assert.equal(clock.getSnapshot().duration, 0);
  let notifications = 0;
  const unsubscribe = clock.subscribe(() => notifications++);
  const initial = clock.getSnapshot();
  clock.setCurrentTime(0);
  assert.equal(clock.getSnapshot(), initial);
  assert.equal(notifications, 0);
  clock.setDuration(180);
  clock.setCurrentTime(0.5);
  assert.equal(clock.getSnapshot().duration, 180);
  assert.equal(clock.getSnapshot().currentTime, 0.5);
  assert.equal(notifications, 2);
  const playing = clock.getSnapshot();
  clock.setDuration(180);
  assert.equal(clock.getSnapshot(), playing);
  unsubscribe();
  clock.setCurrentTime(1);
  assert.equal(notifications, 2);
  assert.equal(clock.getServerSnapshot(), initial, 'SSR must always use the stable initial clock');
});

test('queue transition retries temporary errors with the same operation and stops after recovery', async () => {
  const { retryQueueOperation, QueueRequestError } = loadModule('src/lib/queue-recovery.ts');
  let attempts = 0;
  const delays = [];
  const result = await retryQueueOperation(async () => {
    attempts++;
    if (attempts < 3) throw new QueueRequestError('Temporary outage', 503);
    return { changed: true, expectedItem: 'song-one' };
  }, () => true, async delay => { delays.push(delay); });
  assert.equal(result.expectedItem, 'song-one');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [500, 1500]);
});

test('queue transition does not retry authorization failures or advance a song that has changed', async () => {
  const { retryQueueOperation, QueueRequestError } = loadModule('src/lib/queue-recovery.ts');
  let attempts = 0;
  await assert.rejects(retryQueueOperation(async () => {
    attempts++;
    throw new QueueRequestError('Permission denied', 403);
  }, () => true, async () => {}), /Permission denied/);
  assert.equal(attempts, 1);
  let current = true;
  const result = await retryQueueOperation(async () => {
    attempts++;
    throw new QueueRequestError('Connection lost', 0);
  }, () => current, async () => { current = false; });
  assert.equal(result, undefined);
  assert.equal(attempts, 2, 'a retry for the old song must not run after another song starts');
});

test('queue transition surfaces exhausted retries instead of looping indefinitely', async () => {
  const { retryQueueOperation, QueueRequestError } = loadModule('src/lib/queue-recovery.ts');
  let attempts = 0;
  await assert.rejects(retryQueueOperation(async () => {
    attempts++;
    throw new QueueRequestError('Connection lost', 0);
  }, () => true, async () => {}), /Connection lost/);
  assert.equal(attempts, 3);
});

test('a delayed queue refresh cannot overwrite a newer refresh or another room', () => {
  const { createRoomRefreshGuard } = loadModule('src/lib/queue-recovery.ts');
  let room = 'room-one';
  const guard = createRoomRefreshGuard();
  const first = guard.begin('room-one');
  const second = guard.begin('room-one');
  assert.equal(first(room), false);
  assert.equal(second(room), true);
  room = 'room-two';
  assert.equal(second(room), false);
  const third = guard.begin('room-two');
  assert.equal(third(room), true);
});

test('search returns usable results before optional catalog and history writes finish', async () => {
  const { NextRequest, NextResponse } = require('next/server');
  const jobs = [];
  const storage = deferred();
  let catalogWrites = 0;
  let historyWrites = 0;
  const video = { id: 'one', youtube_video_id: 'DmftZuj-8vI', title: 'ขอบฟ้า karaoke',
    channel_name: 'Karaoke', thumbnail_url: '', duration: 180, embeddable: true, karaoke_score: 90 };
  const route = loadModule('src/app/api/search/route.ts', {}, {
    'next/server': { NextRequest, NextResponse, after: job => jobs.push(job) },
    '@/lib/youtube': { searchKaraokeVideos: async () => [video], YouTubeSearchError: class extends Error {} },
    '@/lib/youtube-search-store': {
      getSearchBudget: async () => ({ used: 1, limit: 100, remaining: 99, warning: false, upstreamExhausted: false }),
      writeSearchHistory: async () => { historyWrites++; await storage.promise; },
    },
    '@/lib/youtube-catalog': {
      saveCatalogVideos: async () => { catalogWrites++; await storage.promise; },
    },
  });
  let response;
  const request = route.POST(new NextRequest('http://localhost/api/search', {
    method: 'POST', body: JSON.stringify({ query: 'ขอบฟ้า', source: 'youtube' }),
  })).then(value => { response = value; });
  await turn();
  assert.equal(response?.status, 200, 'background persistence must not delay valid search results');
  assert.equal((await response.json()).data[0].youtube_video_id, 'DmftZuj-8vI');
  const finished = jobs.map(job => job());
  await turn();
  assert.equal(catalogWrites, 1);
  assert.equal(historyWrites, 1);
  storage.resolve();
  await Promise.all(finished);
  await request;
});

test('catalog-only search does not wait for or read YouTube search quota', async () => {
  const { NextRequest, NextResponse } = require('next/server');
  let budgetReads = 0;
  const route = loadModule('src/app/api/search/route.ts', {}, {
    'next/server': { NextRequest, NextResponse, after() {} },
    '@/lib/youtube': { YouTubeSearchError: class extends Error {} },
    '@/lib/youtube-search-store': { getSearchBudget: async () => { budgetReads++; return {}; } },
    '@/lib/youtube-catalog': { searchCatalogWithRefresh: async () => ({ videos: [] }) },
  });
  const response = await route.POST(new NextRequest('http://localhost/api/search', {
    method: 'POST', body: JSON.stringify({ query: 'ขอบฟ้า', source: 'catalog' }),
  }));
  assert.equal(response.status, 200);
  assert.equal(budgetReads, 0);
});

test('starting the app does not schedule a full catalog scan unless explicitly enabled', () => {
  let scheduled = 0;
  const { startCatalogMaintenance } = loadModule('src/lib/catalog-maintenance.ts', {
    process: { env: { YOUTUBE_API_KEY: 'test-only', SUPABASE_SERVICE_ROLE_KEY: 'test-only' } },
    setTimeout() { scheduled++; return { unref() {} }; },
  }, { './youtube-catalog': { syncOfficialCatalog: async () => {} } });
  startCatalogMaintenance();
  assert.equal(scheduled, 0, 'opening Player must not silently start scanning every official channel');
});

test('enabled background maintenance uses bounded daily updates instead of a full historical import', async () => {
  const timers = [];
  let fullImports = 0;
  let dailyUpdates = 0;
  const { startCatalogMaintenance } = loadModule('src/lib/catalog-maintenance.ts', {
    process: { env: { KARAOKE_CATALOG_AUTO_SYNC: '1', YOUTUBE_API_KEY: 'test-only', SUPABASE_SERVICE_ROLE_KEY: 'test-only' } },
    setTimeout(callback) { timers.push(callback); return { unref() {} }; },
    console: { info() {}, warn() {} },
  }, { './youtube-catalog': {
    syncOfficialCatalog: async () => { fullImports++; },
    syncOfficialCatalogDaily: async () => { dailyUpdates++; return { messages: ['updated'] }; },
  } });
  startCatalogMaintenance();
  startCatalogMaintenance();
  assert.equal(timers.length, 1, 'hot reload must not start a duplicate maintenance job');
  timers[0]();
  await turn();
  assert.equal(dailyUpdates, 1);
  assert.equal(fullImports, 0, 'full historical import must remain an explicit operator command');
});
