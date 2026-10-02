const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Load the actual TypeScript modules with server-only replaced for Node tests.
// Each loader represents an independent server process/module cache.
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

test('persistent cache, explicit search budget, concurrency and URL handling', async () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalLimit = process.env.YOUTUBE_SEARCH_DAILY_LIMIT;
  const originalYouTube = process.env.YOUTUBE_API_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://search-store-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  process.env.YOUTUBE_SEARCH_DAILY_LIMIT = '2';
  process.env.YOUTUBE_API_KEY = 'test-only';
  const originalFetch = global.fetch;
  const cache = new Map();
  const leases = new Map();
  const clients = new Map();
  let budgetUsed = 0;
  let outage = false;
  let tokenCounter = 0;
  let searches = 0;
  let details = 0;
  const requestedIds = [];
  global.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === 'search-store-test.supabase.co') {
      const body = init.body ? JSON.parse(init.body) : {};
      if (url.pathname.endsWith('/karaoke_search_get_budget')) {
        return Response.json({ used: budgetUsed, limit: 2, remaining: Math.max(0, 2 - budgetUsed),
          warning: budgetUsed >= 1, upstreamExhausted: outage });
      }
      if (url.pathname.endsWith('/karaoke_search_get')) {
        const row = cache.get(body.p_query);
        return Response.json(row && row.expiresAt > Date.now()
          ? [{ payload: row.payload, updated_at: new Date(row.updatedAt).toISOString() }] : []);
      }
      if (url.pathname.endsWith('/karaoke_search_store')) {
        cache.set(body.p_query, { payload: body.p_payload, updatedAt: Date.now(),
          expiresAt: Date.now() + body.p_ttl_seconds * 1000 });
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/karaoke_search_reserve')) {
        const now = Date.now();
        if (outage) return Response.json({ ok: false, reason: 'upstream_exhausted' });
        if (leases.has(body.p_query)) return Response.json({ ok: false, reason: 'query_in_progress' });
        if (now - (clients.get(body.p_client) ?? 0) < 3000) {
          return Response.json({ ok: false, reason: 'client_cooldown' });
        }
        if (budgetUsed >= body.p_daily_limit) return Response.json({ ok: false, reason: 'budget_exhausted' });
        budgetUsed++;
        clients.set(body.p_client, now);
        const token = `00000000-0000-4000-8000-${String(++tokenCounter).padStart(12, '0')}`;
        leases.set(body.p_query, token);
        return Response.json({ ok: true, token });
      }
      if (url.pathname.endsWith('/karaoke_search_release')) {
        if (leases.get(body.p_query) === body.p_token) leases.delete(body.p_query);
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/karaoke_search_mark_outage')) {
        outage = true;
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/karaoke_search_cleanup')) return new Response(null, { status: 204 });
      throw new Error(`Unexpected Supabase request: ${url.pathname}`);
    }
    if (url.pathname.endsWith('/search')) {
      searches++;
      return Response.json({ items: [{ id: { videoId: 'DmftZuj-8vI' }, snippet: {
        title: `${url.searchParams.get('q')} karaoke`, channelId: 'channel', channelTitle: 'Karaoke',
      } }] });
    }
    details++;
    requestedIds.push(url.searchParams.get('id'));
    return Response.json({ items: [{ id: 'DmftZuj-8vI', snippet: {
      title: 'ขอบฟ้า karaoke', channelId: 'channel', channelTitle: 'Karaoke',
    }, contentDetails: { duration: 'PT3M' }, statistics: { viewCount: '12345' }, status: { embeddable: true } }] });
  };
  try {
    const first = loader();
    const api = first('src/lib/youtube.ts');
    const store = first('src/lib/youtube-search-store.ts');
    const [a, b] = await Promise.all([
      api.searchKaraokeVideos('ขอบฟ้า', 'client-a'), api.searchKaraokeVideos('ขอบฟ้า', 'client-b'),
    ]);
    assert.equal(searches, 1, 'same-query concurrent searches share one upstream call');
    assert.equal(a.length, 1);
    assert.deepEqual(a, b);
    assert.equal(a[0].views_count, 12345);
    assert.equal((await store.getSearchBudget()).used, 1);

    const restarted = loader();
    const restartedApi = restarted('src/lib/youtube.ts');
    await restartedApi.searchKaraokeVideos('ขอบฟ้า', 'client-c');
    assert.equal(searches, 1, 'database cache survives module/server restart');
    assert.equal((await restarted('src/lib/youtube-search-store.ts').getSearchBudget()).used, 1);

    // Expire details without expiring the search: refresh statistics only.
    cache.get('ขอบฟ้า').updatedAt = Date.now() - 3_600_001;
    const refreshed = loader();
    await refreshed('src/lib/youtube.ts').searchKaraokeVideos('ขอบฟ้า', 'client-d');
    assert.equal(searches, 1);
    assert.ok(details >= 2, 'old view counts refresh through videos.list');

    const token = await store.reserveSearch('different search', 'client-e');
    await assert.rejects(store.reserveSearch('different search', 'client-f'), /กำลังดำเนินการ/);
    await store.releaseSearch('different search', token);
    assert.equal((await store.getSearchBudget()).used, 2);
    await assert.rejects(api.searchKaraokeVideos('unmatched-budget-test', 'client-g'), /ครบงบ/);
    assert.equal(searches, 1, 'budget blocks outbound requests');

    const direct = await api.searchKaraokeVideos('https://www.youtube.com/watch?v=DmftZuj-8vI', 'client-g');
    assert.equal(direct[0].youtube_video_id, 'DmftZuj-8vI');
    assert.ok(requestedIds.every((id) => id === 'DmftZuj-8vI'), 'IDs preserve case');
    assert.equal(searches, 1, 'video URL uses no search quota even at daily cap');
    await assert.rejects(api.searchKaraokeVideos('https://www.youtube.com/results?search_query=test', 'client-g'), /ลิงก์วิดีโอ YouTube/);
    await assert.rejects(api.searchKaraokeVideos('https://example.com/watch?v=DmftZuj-8vI', 'client-g'), /ลิงก์วิดีโอ YouTube/);
    assert.equal(searches, 1, 'invalid pasted links never consume search quota');

    budgetUsed = 0;
    await store.markUpstreamQuotaExhausted();
    await assert.rejects(restarted('src/lib/youtube-search-store.ts').reserveSearch('new query', 'client-h'), /รายวันเต็ม/);
  } finally {
    global.fetch = originalFetch;
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: originalUrl,
      SUPABASE_SERVICE_ROLE_KEY: originalKey, YOUTUBE_SEARCH_DAILY_LIMIT: originalLimit,
      YOUTUBE_API_KEY: originalYouTube })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('remote lyric matches survive title filtering and use the shared rank order', () => {
  const { rankKaraokeVideos } = loader()('src/lib/youtube-ranking.ts');
  const base = { id: 'one', youtube_video_id: 'DmftZuj-8vI', title: 'ขอบฟ้า karaoke',
    channel_name: 'Karaoke', thumbnail_url: '', duration: 180, embeddable: true, karaoke_score: 90 };
  const second = { ...base, id: 'two', youtube_video_id: 'eZ22Am2Qe2s', title: 'งมงาย karaoke', views_count: 999999 };
  const blocked = { ...base, id: 'blocked', embeddable: false };
  const musicVideo = { ...base, id: 'mv', title: 'Official MV', channel_name: 'Artist' };
  const query = 'ท่อนเนื้อร้องที่ไม่มีในชื่อวิดีโอ';
  assert.equal(rankKaraokeVideos([base, second], query).length, 0);
  assert.deepEqual(rankKaraokeVideos([base, second, blocked, musicVideo], query, 'song', true).map(v => v.id), ['two', 'one'],
    'remote lyric matches stay eligible, then follow official, karaoke, views, and score ordering');
  assert.equal(rankKaraokeVideos([second, base], 'ขอบฟ้า', 'song', true)[0].id, 'one');
});

test('official identity and karaoke strength precede views within matching relevance', () => {
  const load = loader();
  const { rankKaraokeVideos } = load('src/lib/youtube-ranking.ts');
  const { getOfficialYouTubeChannel, OFFICIAL_YOUTUBE_CHANNELS } = load('src/lib/official-youtube-channels.ts');
  const officialId = OFFICIAL_YOUTUBE_CHANNELS[0].channelId;
  const base = { id: 'popular', youtube_video_id: 'DmftZuj-8vI', title: 'ขอบฟ้า bodyslam karaoke',
    channel_name: 'GMM Karaoke Official', channel_id: 'impersonator', thumbnail_url: '',
    duration: 180, embeddable: true, karaoke_score: 90, views_count: 9000000 };
  const official = { ...base, id: 'official', channel_id: officialId, views_count: 100 };
  const rank = (videos, query = 'ขอบฟ้า bodyslam') => rankKaraokeVideos(videos, query, 'song', true).map(v => v.id);
  assert.deepEqual(rank([base, official]), ['official', 'popular']);
  assert.equal(getOfficialYouTubeChannel(base.channel_id), undefined, 'official-looking names are not evidence');
  assert.equal(getOfficialYouTubeChannel(undefined), undefined);
  assert.equal(getOfficialYouTubeChannel(officialId.toLowerCase()), undefined, 'channel IDs are case sensitive');
  assert.deepEqual(rank([base, { ...official, title: 'เพลงอื่น karaoke' }]), ['popular', 'official']);
  assert.deepEqual(rank([base, { ...official, embeddable: false }]), ['popular']);
  assert.deepEqual(rank([base, { ...official, title: 'ขอบฟ้า bodyslam Official MV', channel_name: 'Record label' }]), ['popular']);
  assert.deepEqual(rank([base, official], 'เนื้อร้องที่ไม่ตรงชื่อ'), ['official', 'popular'],
    'remote lyric matches follow official priority when text relevance ties');
  assert.deepEqual(rank([{ ...base, id: 'low', views_count: 1 }, base]), ['popular', 'low']);
  assert.deepEqual(rank([{ ...base, channel_id: undefined }, official]), ['official', 'popular']);
  assert.deepEqual(rank([{ ...base, views_count: 100 }, official]), ['official', 'popular'],
    'official identity breaks a tie before views');
  const weakKaraoke = { ...base, id: 'weak-karaoke', title: 'ขอบฟ้า bodyslam',
    channel_name: 'Karaoke', views_count: 99000000 };
  assert.deepEqual(rank([weakKaraoke, { ...base, id: 'strong-karaoke', views_count: 1 }]),
    ['strong-karaoke', 'weak-karaoke'], 'clear karaoke metadata precedes views');
});

test('an exact song title outranks an official title that only starts with the query', () => {
  const { getSearchRelevanceTier, rankKaraokeVideos } = loader()('src/lib/youtube-ranking.ts');
  const common = { thumbnail_url: '', duration: 240, embeddable: true, karaoke_score: 80 };
  const exact = { ...common, id: 'exact', youtube_video_id: 'CAYSVrjYFw0',
    title: 'ทน -SPRITE x GUYGEEGEE คาราโอเกะ+เนื้อร้อง',
    channel_name: 'Big Karaoke OFFICIAL', views_count: 73303 };
  const officialPrefix = { ...common, id: 'official-prefix', youtube_video_id: 'YF9BlDRGS9w',
    title: 'ทนดูไม่ได้ - เท่ห์ อุเทน พรหมมินทร์ (คาราโอเกะซาวด์ดนตรี)',
    channel_id: 'UCnm6ohF4dI3h9GiIUTtKxfg',
    channel_name: 'Rose Media & Entertainment', views_count: 2496433 };

  assert.equal(getSearchRelevanceTier(exact, 'ทน'), 5);
  assert.equal(getSearchRelevanceTier(officialPrefix, 'ทน'), 4);
  assert.deepEqual(rankKaraokeVideos([officialPrefix, exact], 'ทน').map(video => video.id),
    ['exact', 'official-prefix']);
});

test('official titles with transliteration and artist metadata remain exact song matches', () => {
  const load = loader();
  const { getSearchRelevanceTier, rankKaraokeVideos } = load('src/lib/youtube-ranking.ts');
  const { OFFICIAL_YOUTUBE_CHANNELS } = load('src/lib/official-youtube-channels.ts');
  const common = { youtube_video_id: 'tIsNBk6kla0', channel_name: 'GMM Karaoke',
    thumbnail_url: '', duration: 240, embeddable: true, karaoke_score: 92 };
  const exact = { ...common, id: 'exact', title: 'ทรายกับทะเล - คาราโอเกะ',
    channel_id: 'not-official', views_count: 228809 };
  const official = { ...common, id: 'official', channel_id: OFFICIAL_YOUTUBE_CHANNELS[0].channelId,
    title: 'คาราโอเกะ ทรายกับทะเล (Sai-Gub-Ta-Lay) - นันทิดา แก้วบัวสาย [ Original Karaoke ]',
    views_count: 668579 };

  assert.equal(getSearchRelevanceTier(exact, 'ทรายกับทะเล'), 5);
  assert.equal(getSearchRelevanceTier(official, 'ทรายกับทะเล'), 5,
    'transliteration, artist and karaoke labels are title metadata, not a weaker match');
  assert.deepEqual(rankKaraokeVideos([exact, official], 'ทรายกับทะเล').map(video => video.id),
    ['official', 'exact'], 'verified official identity resolves equal exact-title relevance');
});

test('optimized ranking preserves the original order across song and artist searches', () => {
  const load = loader();
  const { rankKaraokeVideos, getSearchRelevanceTier, getKaraokeTier } = load('src/lib/youtube-ranking.ts');
  const { getOfficialYouTubeChannel, OFFICIAL_YOUTUBE_CHANNELS } = load('src/lib/official-youtube-channels.ts');
  const titles = ['รัก - Bodyslam Karaoke', 'ใจ - แอม [Original Karaoke]', 'ขอบฟ้า karaoke',
    'ทน - SPRITE x GUYGEEGEE คาราโอเกะ', 'Official Music Video', 'รักแท้ instrumental'];
  const artists = ['Bodyslam', 'แอม เสาวลักษณ์', 'Unknown', 'รักใจ'];
  const videos = Array.from({ length: 240 }, (_, index) => ({
    id: `video-${index}`, youtube_video_id: String(index).padStart(11, '0'),
    title: titles[index % titles.length], artist: artists[index % artists.length],
    channel_id: index % 7 === 0 ? OFFICIAL_YOUTUBE_CHANNELS[0].channelId : 'other-channel',
    channel_name: index % 5 === 0 ? 'Karaoke' : 'Music Label',
    thumbnail_url: '', duration: 240, embeddable: index % 13 !== 0,
    karaoke_score: index % 100,
    views_count: index % 4 === 0 ? undefined : (index * 7919) % 100000,
  }));
  // Preserve the pre-optimization comparator as an independent ordering oracle.
  const originalRank = (query, mode, preserveSearchMatches) => videos
    .filter(video => preserveSearchMatches || getSearchRelevanceTier(video, query, mode) > 0)
    .filter(video => getKaraokeTier(video) > 0)
    .map((video, originalIndex) => ({ video, originalIndex }))
    .sort((left, right) => {
      const relevance = getSearchRelevanceTier(right.video, query, mode)
        - getSearchRelevanceTier(left.video, query, mode);
      if (relevance !== 0) return relevance;
      const official = Number(Boolean(getOfficialYouTubeChannel(right.video.channel_id)))
        - Number(Boolean(getOfficialYouTubeChannel(left.video.channel_id)));
      if (official !== 0) return official;
      const karaoke = getKaraokeTier(right.video) - getKaraokeTier(left.video);
      if (karaoke !== 0) return karaoke;
      const leftHasViews = left.video.views_count !== undefined;
      const rightHasViews = right.video.views_count !== undefined;
      if (leftHasViews !== rightHasViews) return rightHasViews ? 1 : -1;
      const views = (right.video.views_count ?? 0) - (left.video.views_count ?? 0);
      if (views !== 0) return views;
      const score = right.video.karaoke_score - left.video.karaoke_score;
      return score || left.originalIndex - right.originalIndex;
    }).map(({ video }) => video.id);

  for (const query of ['รัก', 'ใจ', 'ขอบฟ้า', 'bodyslam', 'ทน', 'เสียงเอื้อน', '']) {
    for (const mode of ['song', 'artist']) {
      for (const preserve of [false, true]) {
        assert.deepEqual(rankKaraokeVideos(videos, query, mode, preserve).map(video => video.id),
          originalRank(query, mode, preserve), `${query || '<empty>'}/${mode}/${preserve}`);
      }
    }
  }
});

test('typing previews never fetch; concurrent clients share a request and preserve video-ID case', async () => {
  const originalFetch = global.fetch;
  const storageDescriptor = Object.getOwnPropertyDescriptor(global, 'localStorage');
  const saved = new Map();
  Object.defineProperty(global, 'localStorage', { configurable: true, value: {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  } });
  let calls = 0;
  let requestedQuery;
  global.fetch = async (_input, options) => {
    calls++;
    requestedQuery = JSON.parse(options.body).query;
    return Response.json({ success: true, data: [{ id: 'test-video', youtube_video_id: 'DmftZuj-8vI',
      title: 'ขอบฟ้า karaoke', channel_name: 'Karaoke', thumbnail_url: 'https://example.com/image.jpg',
      duration: 180, embeddable: true, karaoke_score: 90 }] });
  };
  try {
    const client = loader()('src/lib/youtube-search-client.ts');
    client.getLocalSearchPreview('ขอบ');
    client.getLocalSearchPreview('ขอบฟ้า');
    assert.equal(calls, 0, 'local previews never invoke network search');
    const controller = new AbortController();
    const abandoned = client.searchYouTubeKaraoke('https://youtu.be/DmftZuj-8vI', controller.signal);
    const active = client.searchYouTubeKaraoke('https://youtu.be/DmftZuj-8vI');
    controller.abort();
    await assert.rejects(abandoned, { name: 'AbortError' });
    assert.equal((await active)[0].youtube_video_id, 'DmftZuj-8vI');
    assert.equal(requestedQuery, 'https://youtu.be/DmftZuj-8vI');
    assert.equal(calls, 1);
    await client.searchYouTubeKaraoke('https://youtu.be/DmftZuj-8vI');
    assert.equal(calls, 1, 'repeat submission uses cache');
  } finally {
    global.fetch = originalFetch;
    if (storageDescriptor) Object.defineProperty(global, 'localStorage', storageDescriptor);
    else delete global.localStorage;
  }
});

test('catalog previews never call YouTube; explicit refresh uses only videos.list and hides stale views', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalYouTube = process.env.YOUTUBE_API_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://catalog-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  process.env.YOUTUBE_API_KEY = 'test-only';
  const savedRows = [];
  let details = 0;
  let searches = 0;
  let reserves = 0;
  let catalogRequest;
  const video = { id: 'yt-DmftZuj-8vI', youtube_video_id: 'DmftZuj-8vI', title: 'ขอบฟ้า bodyslam karaoke',
    channel_id: 'UCHmKRqvKPYVx23RJ8uF6AtA', channel_name: 'GMM Karaoke', thumbnail_url: '',
    duration: 180, embeddable: true, karaoke_score: 90, views_count: 123,
    last_synced_at: new Date(Date.now() - 2 * 3_600_000).toISOString() };
  global.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === 'www.googleapis.com') {
      if (url.pathname.endsWith('/search')) { searches++; throw new Error('Unexpected search'); }
      details++;
      return Response.json({ items: [{ id: video.youtube_video_id, snippet: { title: video.title,
        channelId: video.channel_id, channelTitle: video.channel_name },
        contentDetails: { duration: 'PT3M' }, statistics: { viewCount: '456' }, status: { embeddable: true } }] });
    }
    if (url.pathname.endsWith('/karaoke_catalog_search_v2')) {
      catalogRequest = JSON.parse(init.body);
      return Response.json([video]);
    }
    if (url.pathname.endsWith('/karaoke_catalog_reserve')) { reserves++; return Response.json(true); }
    if (url.pathname.endsWith('/karaoke_catalog_lock')) return Response.json(true);
    if (url.pathname.endsWith('/karaoke_catalog') && init.method === 'POST') savedRows.push(...JSON.parse(init.body));
    return new Response(null, { status: 204 });
  };
  try {
    const api = loader()('src/lib/youtube-catalog.ts');
    assert.deepEqual(api.catalogPatterns('ขอบฟ้า  bodyslam'), ['%ขอบฟ้า%', '%bodyslam%']);
    assert.deepEqual(api.catalogPatterns(' %_ '), []);
    assert.equal((await api.searchCatalog('ขอบฟ้า'))[0].views_count, undefined);
    await api.searchCatalog('ขอบฟ้า');
    assert.equal(details, 0, 'typing reads Supabase only');
    assert.equal(reserves, 0);
    assert.equal(catalogRequest.p_query, 'ขอบฟ้า');
    const result = await api.searchCatalogWithRefresh('ขอบฟ้า');
    assert.equal(result.videos[0].views_count, 456);
    assert.equal(details, 1);
    assert.equal(reserves, 1);
    assert.equal(searches, 0);
    assert.equal(savedRows[0].video_id, video.youtube_video_id);
    assert.equal(Date.parse(savedRows[0].expires_at) - Date.parse(savedRows[0].refreshed_at), 29 * 86_400_000);
    assert.equal(api.hideStaleViews({ ...video, last_synced_at: undefined }).views_count, undefined);
  } finally {
    global.fetch = originalFetch;
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: originalUrl,
      SUPABASE_SERVICE_ROLE_KEY: originalKey, YOUTUBE_API_KEY: originalYouTube })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('popular catalog reads 50 playable songs ordered by stored YouTube views without calling YouTube', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalSecretKey = process.env.SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://popular-catalog-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  delete process.env.SUPABASE_SECRET_KEY;
  const requests = [];
  const makeVideo = (id, views) => ({
    id: `yt-${id}`,
    youtube_video_id: id,
    title: `เพลง ${id} karaoke`,
    channel_id: 'channel',
    channel_name: 'Karaoke',
    thumbnail_url: '',
    duration: 180,
    embeddable: true,
    karaoke_score: 90,
    views_count: views,
  });
  const highest = makeVideo('ABCDEFGHIJK', 5_000_000);
  const second = makeVideo('LMNOPQRSTUV', 4_000_000);
  global.fetch = async (input) => {
    const url = new URL(input);
    requests.push(url);
    assert.equal(url.hostname, 'popular-catalog-test.supabase.co');
    assert.equal(url.pathname, '/rest/v1/karaoke_catalog');
    return Response.json([{ payload: highest }, { payload: second }, { payload: { invalid: true } }]);
  };
  try {
    const catalog = loader()('src/lib/youtube-catalog.ts');
    const popular = await catalog.getTopCatalogVideos(100);
    assert.deepEqual(popular, [highest, second]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].searchParams.get('select'), 'payload');
    assert.equal(requests[0].searchParams.get('payload->>embeddable'), 'eq.true');
    assert.equal(requests[0].searchParams.get('order'), 'payload->views_count.desc,video_id.asc');
    assert.equal(requests[0].searchParams.get('limit'), '50');
    assert.match(requests[0].searchParams.get('expires_at'), /^gt\./);
    await catalog.getTopCatalogVideos(50);
    assert.equal(requests.length, 1, 'popular catalog results are briefly cached');
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
    if (originalSecretKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecretKey;
  }
});

test('popular catalog pages load 50 valid songs at a time and stop at the end', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalSecretKey = process.env.SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://popular-pages-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  delete process.env.SUPABASE_SECRET_KEY;
  const gmmChannelId = 'UCHmKRqvKPYVx23RJ8uF6AtA';
  const rows = Array.from({ length: 121 }, (_, index) => ({ payload: {
    id: `yt-${index}`,
    youtube_video_id: String(index).padStart(11, '0'),
    title: `เพลง ${index} karaoke`,
    channel_id: gmmChannelId, channel_name: 'GMM Karaoke', thumbnail_url: '',
    duration: 180, embeddable: true, karaoke_score: 90, views_count: 121 - index,
  } }));
  rows.splice(1, 0, { payload: { invalid: true } });
  const requests = [];
  global.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.hostname, 'popular-pages-test.supabase.co');
    assert.equal(url.pathname, '/rest/v1/karaoke_catalog');
    assert.equal(url.searchParams.get('channel_id'), `eq.${gmmChannelId}`);
    assert.equal(url.searchParams.get('order'), 'payload->views_count.desc,video_id.asc');
    requests.push(url);
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    return Response.json(rows.slice(offset, offset + limit));
  };
  try {
    const catalog = loader()('src/lib/youtube-catalog.ts');
    const first = await catalog.getPopularCatalogPage(0, gmmChannelId);
    const second = await catalog.getPopularCatalogPage(first.nextOffset, gmmChannelId);
    const third = await catalog.getPopularCatalogPage(second.nextOffset, gmmChannelId);
    assert.equal(first.videos.length, 50);
    assert.equal(second.videos.length, 50);
    assert.equal(third.videos.length, 21);
    assert.equal(first.nextOffset, 51, 'cursor skips the invalid catalog row');
    assert.equal(second.nextOffset, 101);
    assert.equal(first.hasMore, true);
    assert.equal(second.hasMore, true);
    assert.equal(third.hasMore, false);
    assert.equal(new Set([...first.videos, ...second.videos, ...third.videos]
      .map((video) => video.youtube_video_id)).size, 121);
    assert.ok(requests.every((url) => url.searchParams.get('limit') === '51'));
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    if (originalSecretKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecretKey;
  }
});

test('catalog search falls back to an indexed title-prefix pool before the v2 RPC is installed', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://catalog-fallback-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  const common = { thumbnail_url: '', duration: 240, embeddable: true, karaoke_score: 80 };
  const exact = { ...common, id: 'exact', youtube_video_id: 'CAYSVrjYFw0',
    title: 'ทน -SPRITE x GUYGEEGEE คาราโอเกะ+เนื้อร้อง',
    channel_name: 'Big Karaoke OFFICIAL', views_count: 73303 };
  const officialPrefix = { ...common, id: 'official-prefix', youtube_video_id: 'YF9BlDRGS9w',
    title: 'ทนดูไม่ได้ - เท่ห์ อุเทน พรหมมินทร์ (คาราโอเกะซาวด์ดนตรี)',
    channel_id: 'UCnm6ohF4dI3h9GiIUTtKxfg', channel_name: 'Rose Media & Entertainment',
    views_count: 2496433 };
  const requests = [];
  global.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/karaoke_catalog_search_v2')) {
      return Response.json({ message: 'not installed' }, { status: 404 });
    }
    if (url.pathname.endsWith('/karaoke_catalog_search')) {
      const body = JSON.parse(init.body);
      requests.push(body.p_patterns);
      return Response.json(body.p_patterns[0] === 'ทน%' ? [exact] : [officialPrefix]);
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  try {
    const api = loader()('src/lib/youtube-catalog.ts');
    const result = await api.searchCatalog('ทน');
    assert.deepEqual(result.map(video => video.id), ['exact', 'official-prefix']);
    assert.deepEqual(requests, [['%ทน%'], ['ทน%']]);
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test('RSMUSIC-X catalog import accepts only titles ending in Official karaoke', () => {
  const load = loader();
  const { OFFICIAL_YOUTUBE_CHANNELS } = load('src/lib/official-youtube-channels.ts');
  const { isOfficialCatalogImportEligible } = load('src/lib/youtube-catalog.ts');
  const { getSearchRelevanceTier } = load('src/lib/youtube-ranking.ts');
  const channel = OFFICIAL_YOUTUBE_CHANNELS.find(({ channelId }) => (
    channelId === 'UC8GkZ5dlOrw-yN_nkOAIzPA'
  ));
  assert.ok(channel, 'verified RSMUSIC-X channel ID is registered');
  assert.equal(channel.catalogTitleSuffix, 'Official karaoke');

  const video = { channel_id: channel.channelId,
    title: 'ดวงดาวแห่งรัก : Dr.Fuu [Official karaoke]' };
  assert.equal(isOfficialCatalogImportEligible(video, channel), true);
  assert.equal(getSearchRelevanceTier({ ...video, id: 'rs-official',
    youtube_video_id: 'sKuamJKa0oE', channel_name: 'RSMUSIC-X', thumbnail_url: '',
    duration: 240, embeddable: true, karaoke_score: 90 }, 'ดวงดาวแห่งรัก'), 5,
  'a colon-delimited artist name does not weaken an exact song-title match');
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'ดวงดาวแห่งรัก : Dr.Fuu [OFFICIAL KARAOKE]  ' }, channel), true);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'ดวงดาวแห่งรัก : Dr.Fuu [Official karaoke] lyrics' }, channel), false);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'ดวงดาวแห่งรัก : Dr.Fuu [Official MV]' }, channel), false);
  assert.equal(isOfficialCatalogImportEligible({ ...video, channel_id: 'another-channel' }, channel), false);
});

test('Rose Media catalog import excludes plain (KARAOKE) titles but keeps instrumental-sound titles', () => {
  const load = loader();
  const { OFFICIAL_YOUTUBE_CHANNELS } = load('src/lib/official-youtube-channels.ts');
  const { isOfficialCatalogImportEligible } = load('src/lib/youtube-catalog.ts');
  const { getKaraokeTier } = load('src/lib/youtube-ranking.ts');
  const channel = OFFICIAL_YOUTUBE_CHANNELS.find(({ channelId }) => (
    channelId === 'UCnm6ohF4dI3h9GiIUTtKxfg'
  ));
  assert.ok(channel, 'verified Rose Media channel ID is registered');
  assert.deepEqual(channel.catalogTitleIncludesAny, ['คาราโอเกะซาวด์ดนตรี']);
  assert.deepEqual(channel.catalogExcludedTitleSuffixes, ['(KARAOKE)']);

  const video = { channel_id: channel.channelId,
    title: 'จดหมายผิดซอง | ผิดซองเพราะลองใจ (KARAOKE)​' };
  assert.equal(isOfficialCatalogImportEligible(video, channel), false);
  assert.equal(getKaraokeTier({ ...video, id: 'rose-plain', youtube_video_id: 'r0sePl41n00',
    channel_name: channel.name, thumbnail_url: '', duration: 240, embeddable: true, karaoke_score: 90 }), 0);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'รวมฮิต - อมตะเพลงลูกทุ่ง ชุด 51 (Karaoke Album)' }, channel), false);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'หัวใจกระดาษ - ดาวใจ ไพจิตร (คาราโอเกะซาวด์ดนตรี)' }, channel), true);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'รวมเพลงลูกทุ่ง [Official Audio]' }, channel), false);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'KARAOKE จากช่องอื่น', channel_id: 'another-channel' }, channel), false);
});

test('RsiamMusic catalog import accepts only channel videos with karaoke in the title', () => {
  const load = loader();
  const { OFFICIAL_YOUTUBE_CHANNELS } = load('src/lib/official-youtube-channels.ts');
  const { isOfficialCatalogImportEligible } = load('src/lib/youtube-catalog.ts');
  const channel = OFFICIAL_YOUTUBE_CHANNELS.find(({ channelId }) => (
    channelId === 'UCLcCpNY-zaL3vEERD5rh5Ew'
  ));
  assert.ok(channel, 'verified RsiamMusic channel ID is registered');
  assert.deepEqual(channel.catalogTitleIncludesAny, ['karaoke', 'คาราโอเกะ']);

  const video = { channel_id: channel.channelId,
    title: 'เพลงตัวอย่าง - ศิลปินอาร์สยาม [Karaoke Version]' };
  assert.equal(isOfficialCatalogImportEligible(video, channel), true);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'เพลงตัวอย่าง - ศิลปินอาร์สยาม (คาราโอเกะ)' }, channel), true);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'เพลงตัวอย่าง - ศิลปินอาร์สยาม [Official MV]' }, channel), false);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    channel_id: 'another-channel' }, channel), false);
});

test('welovekamikaze catalog import accepts only KAMIOKE and KARAOKE titles', () => {
  const load = loader();
  const { OFFICIAL_YOUTUBE_CHANNELS } = load('src/lib/official-youtube-channels.ts');
  const { isOfficialCatalogImportEligible } = load('src/lib/youtube-catalog.ts');
  const channel = OFFICIAL_YOUTUBE_CHANNELS.find(({ channelId }) => (
    channelId === 'UCjqZeIIXmNj3WS7auJjJFpg'
  ));
  assert.ok(channel, 'verified welovekamikaze channel ID is registered');
  assert.deepEqual(channel.catalogTitleIncludesAny, ['kamioke', 'karaoke']);

  const video = { channel_id: channel.channelId,
    title: 'คาราโอเกะ รักแล้วไปไหน (After Love) - MIN [KAMIOKE]' };
  assert.equal(isOfficialCatalogImportEligible(video, channel), true);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'รักกันอย่าบังคับ (Dictator) – All KAMIKAZE [Official MV]' }, channel), false);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    channel_id: 'another-channel' }, channel), false);
});

test('Music Train catalog import accepts only channel videos with karaoke in the title', () => {
  const load = loader();
  const { OFFICIAL_YOUTUBE_CHANNELS } = load('src/lib/official-youtube-channels.ts');
  const { isOfficialCatalogImportEligible } = load('src/lib/youtube-catalog.ts');
  const channel = OFFICIAL_YOUTUBE_CHANNELS.find(({ channelId }) => (
    channelId === 'UCGCNIdJPo0ZFkVbo_IBo9eQ'
  ));
  assert.ok(channel, 'verified Music Train channel ID is registered');
  assert.deepEqual(channel.catalogTitleIncludesAny, ['karaoke', 'คาราโอเกะ']);

  const video = { channel_id: channel.channelId,
    title: 'สุดใจ - พงษ์สิทธิ์ คำภีร์【 OFFICIAL KARAOKE 】' };
  assert.equal(isOfficialCatalogImportEligible(video, channel), true);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'สุดใจ - พงษ์สิทธิ์ คำภีร์ (คาราโอเกะ)' }, channel), true);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'สุดใจ - พงษ์สิทธิ์ คำภีร์【 OFFICIAL MV 】' }, channel), false);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    channel_id: 'another-channel' }, channel), false);
});

test('Sure Karaoke catalog import rejects MV Lyrics and accepts karaoke titles', () => {
  const load = loader();
  const { OFFICIAL_YOUTUBE_CHANNELS } = load('src/lib/official-youtube-channels.ts');
  const { isOfficialCatalogImportEligible } = load('src/lib/youtube-catalog.ts');
  const channel = OFFICIAL_YOUTUBE_CHANNELS.find(({ channelId }) => (
    channelId === 'UCL8S9ONDLDRqz7s0wljA5Ug'
  ));
  assert.ok(channel, 'verified Sure Karaoke channel ID is registered');
  assert.equal(channel.catalogTitleSuffix, undefined);
  assert.deepEqual(channel.catalogTitleIncludesAny, ['karaoke', 'คาราโอเกะ']);

  const video = { channel_id: channel.channelId,
    title: 'มาลัยน้ำใจ - มนต์สิทธิ์ คำสร้อย [KARAOKE OFFICIAL]' };
  assert.equal(isOfficialCatalogImportEligible(video, channel), true);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'เพลงตัวอย่าง (คาราโอเกะ)' }, channel), true);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'รักที่อยากลืม - สุนารี ราชสีมา [OFFICIAL MV Lyrics]' }, channel), false);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    channel_id: 'another-channel' }, channel), false);
});

test('Oke Online catalog import accepts only titles ending in Thai karaoke', () => {
  const load = loader();
  const { OFFICIAL_YOUTUBE_CHANNELS } = load('src/lib/official-youtube-channels.ts');
  const { isOfficialCatalogImportEligible } = load('src/lib/youtube-catalog.ts');
  const channel = OFFICIAL_YOUTUBE_CHANNELS.find(({ channelId }) => (
    channelId === 'UCn7W1BoMzSMz1cdhILDp-jg'
  ));
  assert.ok(channel, 'verified Oke Online channel ID is registered');
  assert.equal(channel.catalogTitleSuffix, 'คาราโอเกะ');

  const video = { channel_id: channel.channelId,
    title: 'มหาลัยวัวชน คาราโอเกะ' };
  assert.equal(isOfficialCatalogImportEligible(video, channel), true);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'มหาลัยวัวชน คาราโอเกะ  ' }, channel), true);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    title: 'มหาลัยวัวชน Official MV' }, channel), false);
  assert.equal(isOfficialCatalogImportEligible({ ...video,
    channel_id: 'another-channel' }, channel), false);
});

test('catalog submit and explicit YouTube search have separate client caches', async () => {
  const originalFetch = global.fetch;
  const sources = [];
  global.fetch = async (_url, init) => {
    sources.push(JSON.parse(init.body).source);
    return Response.json({ success: true, data: [] });
  };
  try {
    const client = loader()('src/lib/youtube-search-client.ts');
    await client.searchYouTubeKaraoke('catalog-miss');
    assert.deepEqual(sources, ['catalog'], 'miss never triggers automatic remote search');
    await client.searchYouTubeKaraoke('catalog-miss', undefined, 'youtube');
    assert.deepEqual(sources, ['catalog', 'youtube'], 'local empty cache must not suppress explicit remote search');
    await client.searchYouTubeKaraoke('catalog-miss', undefined, 'youtube');
    assert.equal(sources.length, 2);
  } finally { global.fetch = originalFetch; }
});

test('Player searches YouTube only after a confirmed empty catalog result', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  const video = { id: 'yt-DmftZuj-8vI', youtube_video_id: 'DmftZuj-8vI',
    title: 'hit track karaoke', channel_name: 'Karaoke', thumbnail_url: '',
    duration: 180, embeddable: true, karaoke_score: 90 };
  global.fetch = async (_url, init) => {
    const { query, source } = JSON.parse(init.body);
    calls.push({ query, source });
    if (query === 'catalog-error') return Response.json({ success: false, error: 'คลังไม่พร้อม' }, { status: 503 });
    return Response.json({ success: true, data: query === 'hit-track' && source === 'catalog'
      ? [video] : query === 'miss-track' && source === 'youtube' ? [{ ...video, title: 'miss track karaoke' }] : [] });
  };
  try {
    const client = loader()('src/lib/youtube-search-client.ts');
    const signal = new AbortController().signal;
    let fallbacks = 0;
    const onFallback = () => { fallbacks++; };

    const found = await client.searchPlayerKaraoke('hit-track', signal, 'catalog', onFallback);
    assert.equal(found.source, 'catalog');
    assert.equal(found.videos.length, 1);
    assert.deepEqual(calls, [{ query: 'hit-track', source: 'catalog' }]);
    assert.equal(fallbacks, 0);

    const missing = await client.searchPlayerKaraoke('miss-track', signal, 'catalog', onFallback);
    assert.equal(missing.source, 'youtube');
    assert.equal(missing.videos.length, 1);
    assert.deepEqual(calls.slice(1), [
      { query: 'miss-track', source: 'catalog' }, { query: 'miss-track', source: 'youtube' },
    ]);
    assert.equal(fallbacks, 1);

    await assert.rejects(client.searchPlayerKaraoke('catalog-error', signal, 'catalog', onFallback), /คลังไม่พร้อม/);
    assert.deepEqual(calls.at(-1), { query: 'catalog-error', source: 'catalog' });
    assert.equal(fallbacks, 1, 'catalog errors must not spend YouTube search quota');

    const direct = await client.searchPlayerKaraoke('id:DmftZuj-8vI', signal, 'catalog', onFallback);
    assert.equal(direct.source, 'catalog');
    assert.equal(direct.videos.length, 0);
    assert.equal(fallbacks, 1, 'direct video IDs must not use Search Queries');

    await client.searchPlayerKaraoke('manual-track', signal, 'youtube', onFallback);
    assert.deepEqual(calls.at(-1), { query: 'manual-track', source: 'youtube' });
    assert.equal(fallbacks, 1, 'manual remote search does not start with a catalog call');
  } finally { global.fetch = originalFetch; }
});
