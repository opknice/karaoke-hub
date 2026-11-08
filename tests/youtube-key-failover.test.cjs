const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(overrides = {}) {
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://pool-test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test', YOUTUBE_API_KEY: 'primary-test',
    YOUTUBE_API_KEY_BACKUP: 'backup-test', YOUTUBE_SEARCH_DAILY_LIMIT: '2',
    YOUTUBE_SEARCH_BACKUP_DAILY_LIMIT: '2', ...overrides };
  const state = { day: '2026-11-08', rows: new Map(), calls: [], rpc: [], logs: [],
    cache: new Map(), lease: undefined, begins: 0, outage: false, catalogRemaining: 2000, catalogUsed: 0,
    respond: () => Response.json({ items: [] }) };
  const row = (id, bucket) => {
    const name = `${state.day}:${bucket}:${id}`;
    if (!state.rows.has(name)) state.rows.set(name, { used: 0, exhausted: false });
    return state.rows.get(name);
  };
  const fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname !== 'pool-test.supabase.co') {
      state.calls.push(url);
      return state.respond(url);
    }
    const name = url.pathname.split('/').pop();
    const body = JSON.parse(init.body ?? '{}');
    state.rpc.push({ name, body });
    if (name === 'karaoke_youtube_reserve') {
      for (const key of body.p_keys) {
        const entry = row(key.id, body.p_bucket);
        if (body.p_excluded?.includes(key.id)) continue;
        if (entry.exhausted || (body.p_bucket === 'search' && entry.used >= key.limit)) continue;
        if (body.p_catalog) {
          if (state.catalogRemaining <= 0) return Response.json({ ok: false, reason: 'catalog_budget_exhausted' });
          state.catalogRemaining--;
          state.catalogUsed++;
        }
        entry.used++;
        return Response.json({ ok: true, keyId: key.id, day: state.day });
      }
      return Response.json({ ok: false, reason: 'upstream_exhausted' });
    }
    if (name === 'karaoke_youtube_mark_exhausted') {
      const name = `${body.p_day}:${body.p_bucket}:${body.p_key_id}`;
      const entry = state.rows.get(name) ?? { used: 0 };
      entry.exhausted = true;
      state.rows.set(name, entry);
      return new Response(null, { status: 204 });
    }
    if (name === 'karaoke_youtube_get_budget') {
      const entries = body.p_keys.map(key => ({ ...row(key.id, 'search'), limit: key.limit }));
      const used = entries.reduce((n, entry) => n + entry.used, 0);
      const limit = entries.reduce((n, entry) => n + entry.limit, 0);
      return Response.json({ used, limit,
        remaining: entries.reduce((n, e) => n + (e.exhausted ? 0 : Math.max(0, e.limit - e.used)), 0),
        warning: used >= limit * 0.8, upstreamExhausted: entries.every(e => e.exhausted) });
    }
    if (name === 'karaoke_search_pool_begin') {
      assert.equal(state.lease, undefined, 'same logical request must not acquire another lease');
      state.begins++;
      state.lease = 'test-lease';
      return Response.json({ ok: true, token: state.lease });
    }
    if (name === 'karaoke_search_release') {
      assert.equal(body.p_token, state.lease);
      state.lease = undefined;
      return new Response(null, { status: 204 });
    }
    if (name === 'karaoke_search_get') return Response.json(state.cache.get(body.p_query) ?? []);
    if (name === 'karaoke_search_store') {
      state.cache.set(body.p_query, [{ payload: body.p_payload, updated_at: new Date().toISOString() }]);
      return new Response(null, { status: 204 });
    }
    if (name === 'karaoke_catalog_reserve') {
      if (state.catalogRemaining <= 0) return Response.json(false);
      state.catalogRemaining--;
      state.catalogUsed++;
      return Response.json(true);
    }
    if (name === 'karaoke_catalog_lock') return Response.json(true);
    if (name.startsWith('karaoke_catalog_sync')) return init.method === 'POST'
      ? new Response(null, { status: 204 }) : Response.json([]);
    if (name.startsWith('karaoke_catalog_leases')) return new Response(null, { status: 204 });
    if (name === 'karaoke_search_mark_outage') { state.outage = true; return new Response(null, { status: 204 }); }
    throw new Error(`Unexpected RPC ${name}`);
  };
  function loader() {
    const modules = new Map();
    function load(file) {
      const absolute = path.resolve(__dirname, '..', file);
      if (modules.has(absolute)) return modules.get(absolute).exports;
      const module = { exports: {} };
      modules.set(absolute, module);
      const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      vm.runInNewContext(source, { module, exports: module.exports,
        require(name) {
          if (name === 'server-only') return {};
          if (name.startsWith('.')) return load(path.resolve(path.dirname(absolute), `${name}.ts`));
          return require(name);
        }, process: { env }, fetch, URL, Headers, Response, AbortSignal,
        console: { warn(...args) { state.logs.push(args); }, error(...args) { state.logs.push(args); } },
      }, { filename: absolute });
      return module.exports;
    }
    return load;
  }
  return { env, state, loader, api: () => loader()('src/lib/youtube-api-request.ts') };
}

function quota(reason = 'quotaExceeded', message = 'The request cannot be completed because you have exceeded your quota.') {
  return Response.json({ error: { message, errors: [{ reason }] } }, { status: 403 });
}
const searchUrl = () => new URL('https://www.googleapis.com/youtube/v3/search?q=unmatched-pool-song&part=snippet');

test('primary success keeps query parameters and stores fingerprints, never API keys', async () => {
  const h = harness();
  assert.equal((await h.api().requestYouTubeApi(searchUrl())).status, 200);
  assert.equal(h.state.calls[0].searchParams.get('key'), 'primary-test');
  assert.equal(h.state.calls[0].searchParams.get('q'), 'unmatched-pool-song');
  assert.equal(h.state.calls[0].searchParams.get('part'), 'snippet');
  const serialized = JSON.stringify(h.state.rpc);
  assert.ok(!serialized.includes('primary-test') && !serialized.includes('backup-test'));
  assert.match(h.state.rpc[0].body.p_keys[0].id, /^[a-f0-9]{64}$/);
});

test('daily-quota error retries the same request on backup and persists across server restarts', async () => {
  const h = harness();
  h.state.respond = url => url.searchParams.get('key') === 'primary-test' ? quota() : Response.json({ items: [] });
  await h.api().requestYouTubeApi(searchUrl());
  await h.api().requestYouTubeApi(searchUrl());
  assert.deepEqual(h.state.calls.map(url => url.searchParams.get('key')), ['primary-test', 'backup-test', 'backup-test']);
  assert.equal(new Set(h.state.calls.map(url => url.searchParams.get('q'))).size, 1);
  assert.equal(h.state.outage, false, 'one exhausted key must not disable the whole application');
});

test('search exhaustion does not disable the primary general quota bucket', async () => {
  const h = harness();
  h.state.respond = url => url.pathname.endsWith('/search') && url.searchParams.get('key') === 'primary-test'
    ? quota('dailyLimitExceeded') : Response.json({ items: [] });
  const api = h.api();
  await api.requestYouTubeApi(searchUrl());
  await api.requestYouTubeApi(new URL('https://www.googleapis.com/youtube/v3/videos?id=DmftZuj-8vI'));
  assert.deepEqual(h.state.calls.map(url => url.searchParams.get('key')), ['primary-test', 'backup-test', 'primary-test']);
});

test('both exhausted keys stop requests until the next Pacific quota day', async () => {
  const h = harness();
  h.state.respond = () => quota();
  const api = h.api();
  await assert.rejects(api.requestYouTubeApi(searchUrl()), e => e.name === 'YouTubeQuotaError' && e.status === 429);
  await assert.rejects(h.api().requestYouTubeApi(searchUrl()), /โควตา/);
  assert.equal(h.state.calls.length, 2);
  h.state.day = '2026-11-09';
  h.state.respond = () => Response.json({ items: [] });
  await h.api().requestYouTubeApi(searchUrl());
  assert.equal(h.state.calls[2].searchParams.get('key'), 'primary-test');
});

test('late quota response marks its reservation day and cannot poison tomorrow', async () => {
  const h = harness();
  h.state.respond = url => {
    if (url.searchParams.get('key') === 'primary-test') {
      h.state.day = '2026-11-09';
      return quota();
    }
    return Response.json({ items: [] });
  };
  await h.api().requestYouTubeApi(searchUrl());
  const marked = h.state.rpc.find(r => r.name === 'karaoke_youtube_mark_exhausted');
  assert.equal(marked.body.p_day, '2026-11-08');
  h.state.respond = () => Response.json({ items: [] });
  await h.api().requestYouTubeApi(searchUrl());
  assert.equal(h.state.calls.at(-1).searchParams.get('key'), 'primary-test');
});

test('rate limits, invalid credentials and server failures never rotate keys', async () => {
  for (const [status, reason, message] of [
    [403, 'rateLimitExceeded', 'Rate Limit Exceeded'],
    [429, 'quotaExceeded', 'Quota exceeded for Requests per minute'],
    [403, 'keyInvalid', 'Invalid API key: primary-test'],
    [403, 'forbidden', 'Forbidden'], [500, 'backendError', 'Internal error'],
  ]) {
    const h = harness();
    h.state.respond = () => Response.json({ error: { message, errors: [{ reason }] } }, { status });
    assert.equal((await h.api().requestYouTubeApi(searchUrl())).status, status);
    assert.equal(h.state.calls.length, 1);
    assert.ok(!h.state.rpc.some(r => r.name === 'karaoke_youtube_mark_exhausted'));
    assert.ok(!JSON.stringify(h.state.logs).includes('primary-test'));
  }
});

test('network errors are sanitized and database failure sends no upstream request', async () => {
  const h = harness();
  h.state.respond = () => { throw new Error('fetch failed https://example.test/?key=primary-test'); };
  await assert.rejects(h.api().requestYouTubeApi(searchUrl()), e => !e.message.includes('primary-test'));
  assert.equal(h.state.calls.length, 1);
  const missingDb = harness({ NEXT_PUBLIC_SUPABASE_URL: undefined });
  await assert.rejects(missingDb.api().requestYouTubeApi(searchUrl()));
  assert.equal(missingDb.state.calls.length, 0);
});

test('per-key app search limits select backup and count each outbound attempt', async () => {
  const h = harness({ YOUTUBE_SEARCH_DAILY_LIMIT: '1' });
  await h.api().requestYouTubeApi(searchUrl());
  await h.api().requestYouTubeApi(searchUrl());
  assert.deepEqual(h.state.calls.map(url => url.searchParams.get('key')), ['primary-test', 'backup-test']);
  const budget = await h.loader()('src/lib/youtube-search-store.ts').getSearchBudget();
  assert.equal(budget.used, 2);
  assert.equal(budget.limit, 3);
  assert.equal(budget.remaining, 1);
});

test('missing or duplicated backup retains single-key operation without pool RPCs', async () => {
  for (const backup of [undefined, '', ' primary-test ']) {
    const h = harness({ YOUTUBE_API_KEY_BACKUP: backup });
    await h.api().requestYouTubeApi(searchUrl());
    assert.equal(h.state.calls[0].searchParams.get('key'), 'primary-test');
    assert.equal(h.state.rpc.length, 0);
  }
});

test('an explicit search retries inside one logical lease and then reuses its cache', async () => {
  const h = harness();
  const videoId = 'DmftZuj-8vI';
  h.state.respond = url => {
    if (url.pathname.endsWith('/search')) return url.searchParams.get('key') === 'primary-test' ? quota()
      : Response.json({ items: [{ id: { videoId }, snippet: { title: 'unmatched-pool-song karaoke',
        channelId: 'test-channel', channelTitle: 'Karaoke' } }] });
    return Response.json({ items: [{ id: videoId, snippet: { title: 'unmatched-pool-song karaoke',
      channelId: 'test-channel', channelTitle: 'Karaoke' }, contentDetails: { duration: 'PT3M' },
      statistics: { viewCount: '10' }, status: { embeddable: true } }] });
  };
  const api = h.loader()('src/lib/youtube.ts');
  const results = await api.searchKaraokeVideos('unmatched-pool-song', 'test-client');
  assert.equal(results[0].youtube_video_id, videoId);
  assert.equal(h.state.begins, 1);
  assert.equal(h.state.lease, undefined);
  assert.deepEqual(h.state.calls.filter(url => url.pathname.endsWith('/search'))
    .map(url => url.searchParams.get('key')), ['primary-test', 'backup-test']);
  const calls = h.state.calls.length;
  await h.loader()('src/lib/youtube.ts').searchKaraokeVideos('unmatched-pool-song', 'test-client-2');
  assert.equal(h.state.calls.length, calls, 'persistent cache must not consume another attempt');
});

test('catalog verification uses backup for general quota exhaustion', async () => {
  const h = harness();
  h.state.respond = url => url.searchParams.get('key') === 'primary-test' ? quota()
    : Response.json({ items: url.pathname.endsWith('/channels') ? [{ id: 'test-channel',
      snippet: { title: 'Test channel' }, contentDetails: { relatedPlaylists: { uploads: 'test-playlist' } } }] : [] });
  const catalog = h.loader()('src/lib/youtube-catalog.ts');
  const result = await catalog.syncYouTubeChannelUploads('@test-channel', () => {});
  assert.equal(result.completed, true);
  assert.equal(result.videosImported, 0);
  assert.deepEqual(h.state.calls.map(url => url.searchParams.get('key')), ['primary-test', 'backup-test', 'backup-test']);
  assert.equal(h.state.catalogUsed, h.state.calls.length,
    'every outbound catalog attempt, including retry, must respect the maintenance cap');
});

test('cold-worker cached search survives general quota exhaustion but direct lookup stays strict', async () => {
  const h = harness();
  const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const cacheKey = h.loader()('src/lib/youtube-search-store.ts').karaokeSearchKey('unmatched-pool-song');
  h.state.cache.set(cacheKey, [{ updated_at: old, payload: [{
    id: 'yt-DmftZuj-8vI', youtube_video_id: 'DmftZuj-8vI', title: 'unmatched-pool-song karaoke',
    channel_id: 'test-channel', channel_name: 'Karaoke', thumbnail_url: '', duration: 180,
    embeddable: true, karaoke_score: 1, views_count: 10, last_synced_at: old,
  }] }]);
  h.state.respond = () => quota();
  const api = h.loader()('src/lib/youtube.ts');
  const results = await api.searchKaraokeVideos('unmatched-pool-song', 'cache-client');
  assert.equal(results[0].youtube_video_id, 'DmftZuj-8vI');
  assert.equal(results[0].views_count, undefined);
  assert.equal(h.state.calls.filter(url => url.pathname.endsWith('/search')).length, 0);
  await assert.rejects(api.searchKaraokeVideos('id:DmftZuj-8vI', 'video-client'), e => e.status === 429);
});

test('denied catalog attempts and retries never charge the user search budget', async () => {
  const h = harness();
  h.state.catalogRemaining = 0;
  const api = h.api();
  await assert.rejects(api.requestYouTubeApi(searchUrl(), { catalog: true }), /คลัง/);
  assert.equal(h.state.calls.length, 0);
  const store = h.loader()('src/lib/youtube-search-store.ts');
  assert.equal((await store.getSearchBudget()).used, 0);
  h.state.catalogRemaining = 1;
  h.state.respond = url => url.searchParams.get('key') === 'primary-test' ? quota() : Response.json({ items: [] });
  await assert.rejects(api.requestYouTubeApi(searchUrl(), { catalog: true }), /คลัง/);
  assert.equal(h.state.calls.length, 1, 'catalog cap must prevent the backup retry before charging it');
  assert.equal((await store.getSearchBudget()).used, 1);
  await api.requestYouTubeApi(searchUrl());
  assert.equal(h.state.calls[1].searchParams.get('key'), 'backup-test');
  assert.equal((await store.getSearchBudget()).used, 2);
});

test('latest MV search shares automatic backup selection without changing its result version', async () => {
  const h = harness();
  const videoId = 'DmftZuj-8vI';
  h.state.respond = url => {
    if (url.pathname.endsWith('/search')) return url.searchParams.get('key') === 'primary-test' ? quota()
      : Response.json({ items: [{ id: { videoId }, snippet: { title: 'unmatched-pool-song Official MV',
        channelId: 'test-channel', channelTitle: 'Official Music' } }] });
    return Response.json({ items: [{ id: videoId, snippet: { title: 'unmatched-pool-song Official MV',
      channelId: 'test-channel', channelTitle: 'Official Music' }, contentDetails: { duration: 'PT3M' },
      status: { embeddable: true } }] });
  };
  const results = await h.loader()('src/lib/youtube.ts').searchMusicVideos('unmatched-pool-song', 'mv-client');
  assert.equal(results[0].version_type, 'mv');
  assert.deepEqual(h.state.calls.filter(url => url.pathname.endsWith('/search'))
    .map(url => url.searchParams.get('key')), ['primary-test', 'backup-test']);
});

test('direct MV verification reports quota exhaustion consistently with direct karaoke lookup', async () => {
  const h = harness();
  h.state.respond = () => quota();
  await assert.rejects(h.loader()('src/lib/youtube.ts').searchMusicVideos('id:DmftZuj-8vI', 'mv-video-client'),
    e => e.status === 429);
});
