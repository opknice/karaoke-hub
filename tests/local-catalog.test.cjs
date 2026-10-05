const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loader() {
  const modules = new Map();
  return function load(file) {
    const absolute = path.resolve(__dirname, '..', file);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} };
    modules.set(absolute, module);
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const localRequire = (name) => {
      if (name === 'server-only') return {};
      if (name.startsWith('.')) return load(path.resolve(path.dirname(absolute), `${name}.ts`));
      return require(name);
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: absolute })(localRequire, module, module.exports);
    return module.exports;
  };
}

function video(id, title = 'ขอบฟ้า Karaoke') {
  return {
    id: `yt-${id}`, youtube_video_id: id, title, artist: 'Bodyslam',
    channel_id: 'test-channel', channel_name: 'Karaoke', thumbnail_url: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    duration: 240, embeddable: true, karaoke_score: 90, views_count: 123,
    private_field: 'MUST_NOT_LEAK',
  };
}

test('local catalog export uses keyset pages, filters songs and whitelists metadata', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://local-catalog-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  const expires_at = new Date(Date.now() + 86400_000).toISOString();
  const rows = Array.from({ length: 503 }, (_, i) => {
    const id = String(i).padStart(11, '0');
    return { video_id: id, expires_at, payload: video(id, i === 123 ? 'Official Music Video' : 'ขอบฟ้า Karaoke') };
  });
  const queries = [];
  global.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.hostname, 'local-catalog-test.supabase.co');
    assert.equal(url.pathname, '/rest/v1/karaoke_catalog');
    assert.equal(url.searchParams.get('limit'), '500');
    assert.equal(url.searchParams.get('order'), 'video_id.asc');
    queries.push(url);
    const cursor = url.searchParams.get('video_id')?.slice(3);
    return Response.json(rows.filter((row) => !cursor || row.video_id > cursor).slice(0, 500));
  };
  try {
    const api = loader()('src/lib/local-catalog-export.ts');
    const first = await api.getLocalCatalogPage(null);
    assert.equal(first.songs.length, 499);
    assert.equal(first.nextCursor, '00000000499');
    assert.equal(first.hasMore, true);
    assert.equal(first.songs[0].video.private_field, undefined);
    const second = await api.getLocalCatalogPage(first.nextCursor);
    assert.equal(second.songs.length, 3);
    assert.equal(second.hasMore, false);
    assert.equal(queries.length, 2);
    assert.equal(queries[1].searchParams.get('video_id'), 'gt.00000000499');
    assert.equal(new Set([...first.songs, ...second.songs].map((song) => song.video_id)).size, 502);
    const since = '2026-10-01T00:00:00.000Z';
    const until = '2026-10-05T00:00:00.000Z';
    await api.getLocalCatalogPage(null, since, until);
    assert.equal(queries[2].searchParams.get('and'), `(refreshed_at.gt.${since},refreshed_at.lte.${until})`);
    assert.equal(queries[2].searchParams.get('refreshed_at'), null);
    await api.getLocalCatalogPage(null, since);
    assert.equal(queries[3].searchParams.get('refreshed_at'), `gt.${since}`);
    await assert.rejects(() => api.getLocalCatalogPage('invalid!'), RangeError);
    await assert.rejects(() => api.getLocalCatalogPage(null, 'not-a-date'), RangeError);
  } finally {
    global.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test('local search worker ranks Thai matches without network', () => {
  const originalSelf = global.self;
  const originalFetch = global.fetch;
  const messages = [];
  global.self = { postMessage: (message) => messages.push(message) };
  global.fetch = () => { throw new Error('worker must not fetch'); };
  try {
    loader()('src/lib/local-catalog-worker.ts');
    const expires_at = new Date(Date.now() + 86400_000).toISOString();
    global.self.onmessage({ data: { type: 'init', songs: [
      { video_id: '00000000001', expires_at, video: video('00000000001', 'ขอบฟ้า Karaoke') },
      { video_id: '00000000002', expires_at, video: video('00000000002', 'รัก Karaoke') },
    ] } });
    global.self.onmessage({ data: { type: 'search', query: 'ขอบฟ้า', requestId: 7 } });
    assert.equal(messages[0].type, 'ready');
    assert.equal(messages[1].requestId, 7);
    assert.deepEqual(messages[1].results.map((item) => item.youtube_video_id), ['00000000001']);
    global.self.onmessage({ data: { type: 'search', query: 'Bodyslam', mode: 'artist', requestId: 8 } });
    assert.equal(messages[2].requestId, 8);
    assert.deepEqual(messages[2].results.map((item) => item.youtube_video_id), ['00000000001', '00000000002']);
  } finally {
    global.self = originalSelf;
    global.fetch = originalFetch;
  }
});
