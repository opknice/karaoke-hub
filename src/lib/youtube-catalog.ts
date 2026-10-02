import 'server-only';
import { randomUUID } from 'node:crypto';
import { catalogRest } from './supabase/catalog-rest';
import {
  OFFICIAL_YOUTUBE_CHANNELS,
  isOfficialChannelTitleExcluded,
  type OfficialYouTubeChannel,
} from './official-youtube-channels';
import { normalizeYouTubeSearchText, rankKaraokeVideos } from './youtube-ranking';
import { isYouTubeVideo } from './youtube-video-validation';
import { videosFromDetailsPayload } from './youtube';
import type { YouTubeVideo } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RANKED_CATALOG_RETRY_DELAY = 60_000;
const DAILY_REFRESH_BATCHES = 16;
const DAILY_SYNC_BUDGET_MS = 240_000;
const POPULAR_CATALOG_CACHE_TTL = 60_000;
const queryCache = new Map<string, { expires: number; promise: Promise<YouTubeVideo[]> }>();
const popularCatalogCache = new Map<number, { expires: number; promise: Promise<YouTubeVideo[]> }>();
let rankedCatalogUnavailableUntil = 0;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function hideStaleViews(video: YouTubeVideo): YouTubeVideo {
  return Date.now() - Date.parse(video.last_synced_at ?? '') < HOUR
    ? video : { ...video, views_count: undefined };
}

export function catalogPatterns(query: string): string[] {
  // Preserve Thai combining vowels/tone marks; bound work on arbitrary input.
  return normalizeYouTubeSearchText(query).split(' ').filter(Boolean).slice(0, 20)
    .map((token) => `%${token}%`);
}

function catalogVideos(value: unknown): YouTubeVideo[] {
  if (!Array.isArray(value)) throw new Error('รูปแบบข้อมูลคลังเพลงไม่ถูกต้อง');
  return value.filter((video): video is YouTubeVideo => (
    isYouTubeVideo(video) && !isCatalogTitleExcluded(video)
  ));
}

function catalogPayloadVideos(value: unknown): YouTubeVideo[] {
  if (!Array.isArray(value)) throw new Error('รูปแบบข้อมูลคลังเพลงไม่ถูกต้อง');
  return value.flatMap((row): YouTubeVideo[] => (
    record(row) && isYouTubeVideo(row.payload) && !isCatalogTitleExcluded(row.payload)
      ? [row.payload] : []
  ));
}

function uniqueVideos(groups: readonly YouTubeVideo[][]): YouTubeVideo[] {
  const videos = new Map<string, YouTubeVideo>();
  for (const group of groups) {
    for (const video of group) videos.set(video.youtube_video_id, video);
  }
  return [...videos.values()];
}

async function searchLegacyCatalog(
  normalizedQuery: string,
  patterns: readonly string[]
): Promise<YouTubeVideo[]> {
  const officialIds = OFFICIAL_YOUTUBE_CHANNELS.map((channel) => channel.channelId);
  const body = (searchPatterns: readonly string[]) => JSON.stringify({
    p_patterns: searchPatterns,
    p_official_ids: officialIds,
  });
  // The old RPC limits results after sorting by Official. A second, indexed prefix
  // lookup guarantees exact non-Official song titles reach the final JS ranker.
  const [general, titlePrefix] = await Promise.all([
    catalogRest('rpc/karaoke_catalog_search', {
      method: 'POST', body: body(patterns),
    }),
    catalogRest('rpc/karaoke_catalog_search', {
      method: 'POST', body: body([`${normalizedQuery}%`]),
    }),
  ]);
  return uniqueVideos([catalogVideos(general), catalogVideos(titlePrefix)]);
}

async function searchCatalogCandidates(
  normalizedQuery: string,
  patterns: readonly string[]
): Promise<YouTubeVideo[]> {
  if (Date.now() >= rankedCatalogUnavailableUntil) {
    try {
      const value = await catalogRest('rpc/karaoke_catalog_search_v2', {
        method: 'POST', body: JSON.stringify({
          p_query: normalizedQuery,
          p_patterns: patterns,
          p_official_ids: OFFICIAL_YOUTUBE_CHANNELS.map((channel) => channel.channelId),
        }),
      });
      rankedCatalogUnavailableUntil = 0;
      return catalogVideos(value);
    } catch {
      // Keep existing deployments working until the v2 migration is installed.
      rankedCatalogUnavailableUntil = Date.now() + RANKED_CATALOG_RETRY_DELAY;
    }
  }
  return searchLegacyCatalog(normalizedQuery, patterns);
}

export function isOfficialCatalogImportEligible(
  video: Pick<YouTubeVideo, 'channel_id' | 'title'>,
  channel: OfficialYouTubeChannel
): boolean {
  if (video.channel_id !== channel.channelId) return false;
  const title = normalizeYouTubeSearchText(video.title);
  if (channel.catalogTitleSuffix
    && !title.endsWith(normalizeYouTubeSearchText(channel.catalogTitleSuffix))) return false;
  if (channel.catalogTitleIncludesAny
    && !channel.catalogTitleIncludesAny.some((term) => (
      title.includes(normalizeYouTubeSearchText(term))
    ))) return false;
  if (isCatalogTitleExcluded(video, channel)) return false;
  return true;
}

export function isCatalogTitleExcluded(
  video: Pick<YouTubeVideo, 'channel_id' | 'title'>,
  knownChannel?: OfficialYouTubeChannel
): boolean {
  return isOfficialChannelTitleExcluded(knownChannel?.channelId ?? video.channel_id, video.title);
}

export async function searchCatalog(query: string): Promise<YouTubeVideo[]> {
  const patterns = catalogPatterns(query);
  if (query.trim().length < 2 || patterns.length === 0) return [];
  const normalizedQuery = normalizeYouTubeSearchText(query);
  const key = patterns.join('|');
  let cached = queryCache.get(key);
  if (!cached || cached.expires <= Date.now()) {
    if (queryCache.size >= 200) queryCache.clear();
    const promise = searchCatalogCandidates(normalizedQuery, patterns);
    cached = { expires: Date.now() + 15_000, promise };
    queryCache.set(key, cached);
    void promise.catch(() => { if (queryCache.get(key)?.promise === promise) queryCache.delete(key); });
  }
  return rankKaraokeVideos((await cached.promise).map(hideStaleViews), query).slice(0, 25);
}

// Reads only the server-private catalog. The payload stores the numeric
// YouTube view count, so PostgREST can rank the cached songs without spending
// any YouTube API quota.
export async function getTopCatalogVideos(limit = 50): Promise<YouTubeVideo[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  let cached = popularCatalogCache.get(safeLimit);
  if (!cached || cached.expires <= Date.now()) {
    const params = new URLSearchParams({
      select: 'payload',
      'expires_at': `gt.${new Date().toISOString()}`,
      'payload->>embeddable': 'eq.true',
      'order': 'payload->views_count.desc,video_id.asc',
      limit: String(safeLimit),
    });
    const promise = catalogRest(`karaoke_catalog?${params.toString()}`)
      .then(catalogPayloadVideos);
    cached = { expires: Date.now() + POPULAR_CATALOG_CACHE_TTL, promise };
    popularCatalogCache.set(safeLimit, cached);
    void promise.catch(() => {
      if (popularCatalogCache.get(safeLimit)?.promise === promise) {
        popularCatalogCache.delete(safeLimit);
      }
    });
  }
  return (await cached.promise).filter((video) => !isCatalogTitleExcluded(video));
}

export async function getPopularCatalogPage(offset: number, channelId: string): Promise<{
  videos: YouTubeVideo[];
  nextOffset: number;
  hasMore: boolean;
}> {
  const pageSize = 50;
  const videos: YouTubeVideo[] = [];
  let cursor = offset;
  let nextOffset = offset;
  const expiresAt = new Date().toISOString();

  // Some older catalog rows are excluded after reading. Keep scanning until
  // the page contains 50 playable songs, then look ahead for one more.
  while (true) {
    const params = new URLSearchParams({
      select: 'payload',
      channel_id: `eq.${channelId}`,
      expires_at: `gt.${expiresAt}`,
      'payload->>embeddable': 'eq.true',
      order: 'payload->views_count.desc,video_id.asc',
      offset: String(cursor),
      limit: String(pageSize + 1),
    });
    const rows = await catalogRest(`karaoke_catalog?${params.toString()}`);
    if (!Array.isArray(rows)) throw new Error('รูปแบบข้อมูลคลังเพลงไม่ถูกต้อง');
    for (const row of rows) {
      cursor++;
      const video = catalogPayloadVideos([row])[0];
      if (!video) continue;
      if (videos.length === pageSize) return { videos, nextOffset, hasMore: true };
      videos.push(video);
      if (videos.length === pageSize) nextOffset = cursor;
    }
    if (rows.length < pageSize + 1) {
      return { videos, nextOffset: videos.length === pageSize ? nextOffset : cursor, hasMore: false };
    }
  }
}

export async function saveCatalogVideos(videos: readonly YouTubeVideo[]): Promise<void> {
  const rows = videos.filter((video) => !isCatalogTitleExcluded(video)).flatMap((video) => {
    const refreshed = Date.parse(video.last_synced_at ?? '');
    if (!video.channel_id || !Number.isFinite(refreshed) || Date.now() - refreshed >= 29 * DAY) return [];
    return [{ video_id: video.youtube_video_id, channel_id: video.channel_id,
      search_text: normalizeYouTubeSearchText(`${video.title} ${video.artist ?? ''} ${video.channel_name}`),
      payload: video, refreshed_at: new Date(refreshed).toISOString(),
      expires_at: new Date(refreshed + 29 * DAY).toISOString() }];
  });
  if (!rows.length) return;
  await catalogRest('karaoke_catalog?on_conflict=video_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows),
  });
  queryCache.clear();
  popularCatalogCache.clear();
}

async function youtubeCatalogRequest(endpoint: 'channels' | 'playlistItems' | 'search' | 'videos', params: Record<string, string>): Promise<Record<string, unknown>> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('ยังไม่ได้ตั้งค่า YouTube API Key');
  const reserved = await catalogRest('rpc/karaoke_catalog_reserve', { method: 'POST', body: '{}' });
  if (reserved !== true) throw new Error('ครบงบอัปเดตคลังเพลง 2,000 คำขอต่อวันแล้ว ยังค้นในคลังได้');
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set('key', apiKey);
  let response: Response;
  try { response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error('เชื่อมต่อ YouTube เพื่ออัปเดตคลังไม่สำเร็จ'); }
  if (!response.ok) throw new Error(`YouTube ปฏิเสธการอัปเดตคลัง (HTTP ${response.status})`);
  const value: unknown = await response.json();
  if (!record(value) || !Array.isArray(value.items)) throw new Error('ข้อมูลอัปเดตคลังจาก YouTube ไม่ถูกต้อง');
  return value;
}

async function lock(name: string, token: string): Promise<boolean> {
  return await catalogRest('rpc/karaoke_catalog_lock', {
    method: 'POST', body: JSON.stringify({ p_name: name, p_token: token }),
  }) === true;
}

async function unlock(name: string, token: string): Promise<void> {
  try {
    await catalogRest(`karaoke_catalog_leases?name=eq.${encodeURIComponent(name)}&token=eq.${token}`, { method: 'DELETE' });
  } catch {
    // A transient cleanup failure must not replace a successful result; the lease expires.
    console.warn('[catalog] ปลดล็อกไม่สำเร็จ ล็อกจะหมดอายุอัตโนมัติภายใน 5 นาที');
  }
}

async function resolveUploadsPlaylist(
  channel: OfficialYouTubeChannel,
  existingPlaylistId = ''
): Promise<string> {
  if (existingPlaylistId) return existingPlaylistId;
  const data = await youtubeCatalogRequest('channels', {
    part: 'contentDetails', id: channel.channelId,
  });
  const item = Array.isArray(data.items) ? data.items[0] as unknown : undefined;
  const details = record(item) && record(item.contentDetails) ? item.contentDetails : undefined;
  const playlists = details && record(details.relatedPlaylists) ? details.relatedPlaylists : undefined;
  if (typeof playlists?.uploads !== 'string') throw new Error('ไม่พบ uploads playlist ของช่อง');
  return playlists.uploads;
}

async function refreshIds(
  ids: readonly string[],
  importChannel?: OfficialYouTubeChannel
): Promise<YouTubeVideo[]> {
  if (!ids.length || ids.length > 50) return [];
  const payload = await youtubeCatalogRequest('videos', {
    part: 'snippet,contentDetails,statistics,status', id: ids.join(','),
  });
  const videos = videosFromDetailsPayload(payload);
  if (!Array.isArray(payload.items) || videos.length !== payload.items.length
    || videos.some((video) => !ids.includes(video.youtube_video_id))) {
    throw new Error('รายละเอียดวิดีโอไม่สมบูรณ์ จึงยังไม่แก้ไขคลัง');
  }
  // Remove only IDs confirmed absent/unplayable by a successful API response.
  const playable = videos.filter((video) => video.embeddable);
  const found = new Set(playable.map((video) => video.youtube_video_id));
  const removed = ids.filter((id) => !found.has(id));
  if (removed.length) await catalogRest(`karaoke_catalog?video_id=in.(${removed.join(',')})`, { method: 'DELETE' });
  const eligible = importChannel
    ? playable.filter((video) => isOfficialCatalogImportEligible(video, importChannel))
    : playable;
  await saveCatalogVideos(eligible);
  queryCache.clear();
  return eligible;
}

function searchVideoIds(payload: Record<string, unknown>): string[] {
  if (!Array.isArray(payload.items)) return [];
  return payload.items.flatMap((item): string[] => {
    const id = record(item) && record(item.id) ? item.id : undefined;
    return typeof id?.videoId === 'string' && /^[\w-]{11}$/.test(id.videoId) ? [id.videoId] : [];
  });
}

export interface RoseInstrumentalCatalogSyncResult {
  pages: number;
  videosDiscovered: number;
  videosImported: number;
  truncated: boolean;
}

export interface RoseInstrumentalUploadsScanResult {
  pages: number;
  videosScanned: number;
  videosImported: number;
  truncated: boolean;
}

// The uploads playlist import is intentionally broad. This one-off operator
// sync follows Rose Media's own channel-search source for the instrumental
// label, which is the reliable historical backfill source.
export async function syncRoseInstrumentalCatalog(
  onProgress: (message: string) => void
): Promise<RoseInstrumentalCatalogSyncResult> {
  const channel = OFFICIAL_YOUTUBE_CHANNELS.find(({ channelId }) => (
    channelId === 'UCnm6ohF4dI3h9GiIUTtKxfg'
  ));
  if (!channel) throw new Error('ไม่พบการตั้งค่าช่อง Rose Media');

  const name = `sync-search:${channel.channelId}:instrumental`;
  const token = randomUUID();
  if (!await lock(name, token)) throw new Error('มีการนำเข้าผลค้นหา Rose Media ทำงานอยู่แล้ว');

  let pageToken = '';
  let pages = 0;
  let videosDiscovered = 0;
  let videosImported = 0;
  try {
    for (let page = 0; page < 10; page++) {
      const payload = await youtubeCatalogRequest('search', {
        part: 'id', channelId: channel.channelId, type: 'video', maxResults: '50',
        q: '(คาราโอเกะซาวด์ดนตรี)', ...(pageToken ? { pageToken } : {}),
      });
      const ids = searchVideoIds(payload);
      const imported = ids.length ? await refreshIds(ids, channel) : [];
      pages++;
      videosDiscovered += ids.length;
      videosImported += imported.length;
      pageToken = typeof payload.nextPageToken === 'string' ? payload.nextPageToken : '';
      onProgress(`Rose Media: หน้าผลค้นหา ${pages}, พบ ${ids.length}, บันทึก ${imported.length}`);
      if (!pageToken) break;
    }
    return { pages, videosDiscovered, videosImported, truncated: Boolean(pageToken) };
  } finally {
    await unlock(name, token);
  }
}

// search.list has a 500-result ceiling for an unauthenticated channel search.
// Scan Rose's uploads playlist as the exhaustive follow-up and apply the same
// title rule after fetching authoritative video metadata.
export async function scanRoseInstrumentalUploads(
  onProgress: (message: string) => void
): Promise<RoseInstrumentalUploadsScanResult> {
  const channel = OFFICIAL_YOUTUBE_CHANNELS.find(({ channelId }) => (
    channelId === 'UCnm6ohF4dI3h9GiIUTtKxfg'
  ));
  if (!channel) throw new Error('ไม่พบการตั้งค่าช่อง Rose Media');

  const name = `scan-uploads:${channel.channelId}:instrumental`;
  const token = randomUUID();
  if (!await lock(name, token)) throw new Error('มีการสแกน Uploads ของ Rose Media ทำงานอยู่แล้ว');

  const stateRows = await catalogRest(
    `karaoke_catalog_sync?channel_id=eq.${channel.channelId}&select=*`
  );
  const state = Array.isArray(stateRows) && record(stateRows[0]) ? stateRows[0] : undefined;
  let pageToken = typeof state?.page_token === 'string' ? state.page_token : '';
  let pages = 0;
  let videosScanned = 0;
  let videosImported = 0;
  try {
    const playlistId = await resolveUploadsPlaylist(
      channel, typeof state?.playlist_id === 'string' ? state.playlist_id : ''
    );
    for (let page = 0; page < 100; page++) {
      if (!await lock(name, token)) throw new Error('สิทธิ์ล็อกการสแกนหมดอายุ กรุณาลองใหม่');
      const data = await youtubeCatalogRequest('playlistItems', {
        part: 'snippet,contentDetails', playlistId, maxResults: '50', ...(pageToken ? { pageToken } : {}),
      });
      const ids = (data.items as unknown[]).flatMap((item): string[] => {
        const details = record(item) && record(item.contentDetails) ? item.contentDetails : undefined;
        return typeof details?.videoId === 'string' && /^[\w-]{11}$/.test(details.videoId)
          ? [details.videoId] : [];
      });
      // playlistItems includes titles, so only matching candidates consume a
      // videos.list request. refreshIds remains the authority for embeddable
      // status and final channel/title validation before writing.
      const candidateIds = (data.items as unknown[]).flatMap((item): string[] => {
        const details = record(item) && record(item.contentDetails) ? item.contentDetails : undefined;
        const snippet = record(item) && record(item.snippet) ? item.snippet : undefined;
        return typeof details?.videoId === 'string' && /^[\w-]{11}$/.test(details.videoId)
          && typeof snippet?.title === 'string'
          && isOfficialCatalogImportEligible({ channel_id: channel.channelId, title: snippet.title }, channel)
          ? [details.videoId] : [];
      });
      const imported = candidateIds.length ? await refreshIds(candidateIds, channel) : [];
      pages++;
      videosScanned += ids.length;
      videosImported += imported.length;
      pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
      await catalogRest('karaoke_catalog_sync?on_conflict=channel_id', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ channel_id: channel.channelId, playlist_id: playlistId,
          page_token: pageToken || null, completed_at: pageToken ? null : new Date().toISOString(),
          updated_at: new Date().toISOString() }),
      });
      onProgress(`Rose Media Uploads: หน้า ${pages}, สแกน ${ids.length}, บันทึก ${imported.length}`);
      if (!pageToken) break;
    }
    return { pages, videosScanned, videosImported, truncated: Boolean(pageToken) };
  } finally {
    await unlock(name, token);
  }
}

export async function searchCatalogWithRefresh(query: string): Promise<{ videos: YouTubeVideo[]; warning?: string }> {
  const videos = await searchCatalog(query);
  const staleIds = videos.filter((video) => !(Date.now() - Date.parse(video.last_synced_at ?? '') < HOUR))
    .map((video) => video.youtube_video_id).sort();
  if (!staleIds.length) return { videos };
  const name = `details:${staleIds.join(',')}`;
  const token = randomUUID();
  if (!await lock(name, token)) return { videos };
  try {
    const refreshed = await refreshIds(staleIds);
    const stale = new Set(staleIds);
    return { videos: rankKaraokeVideos([...videos.filter((video) => !stale.has(video.youtube_video_id)), ...refreshed], query) };
  } catch {
    return { videos, warning: 'แสดงเพลงในคลังได้ แต่ยังอัปเดตยอดวิวไม่สำเร็จ จึงซ่อนยอดวิวที่หมดอายุ' };
  } finally { await unlock(name, token); }
}

// Server maintenance / operator CLI only: no public HTTP endpoint can start an import.
export async function syncOfficialCatalog(onProgress: (message: string) => void): Promise<void> {
  for (const channel of OFFICIAL_YOUTUBE_CHANNELS) {
    const name = `sync:${channel.channelId}`;
    const token = randomUUID();
    if (!await lock(name, token)) throw new Error('มีการนำเข้าคลังเพลงทำงานอยู่แล้ว');
    try {
      const stateRows = await catalogRest(`karaoke_catalog_sync?channel_id=eq.${channel.channelId}&select=*`);
      const state = Array.isArray(stateRows) && record(stateRows[0]) ? stateRows[0] : undefined;
      if (typeof state?.completed_at === 'string' && Date.now() - Date.parse(state.completed_at) < 7 * DAY) {
        onProgress(`${channel.name}: รายการช่องยังใหม่ ไม่ต้องนำเข้าซ้ำ`);
        continue;
      }
      let playlistId = typeof state?.playlist_id === 'string' ? state.playlist_id : '';
      let pageToken = typeof state?.page_token === 'string' ? state.page_token : '';
      playlistId = await resolveUploadsPlaylist(channel, playlistId);
      for (let page = 0; page < 100; page++) {
        if (!await lock(name, token)) throw new Error('สิทธิ์ล็อกการนำเข้าหมดอายุ กรุณาลองใหม่');
        const data = await youtubeCatalogRequest('playlistItems', {
          part: 'contentDetails', playlistId, maxResults: '50', ...(pageToken ? { pageToken } : {}),
        });
        const ids = (data.items as unknown[]).flatMap((item): string[] => {
          const details = record(item) && record(item.contentDetails) ? item.contentDetails : undefined;
          return typeof details?.videoId === 'string' && /^[\w-]{11}$/.test(details.videoId) ? [details.videoId] : [];
        });
        const imported = ids.length ? await refreshIds(ids, channel) : [];
        pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
        await catalogRest('karaoke_catalog_sync?on_conflict=channel_id', {
          method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ channel_id: channel.channelId, playlist_id: playlistId,
            page_token: pageToken || null, completed_at: pageToken ? null : new Date().toISOString(),
            updated_at: new Date().toISOString() }),
        });
        onProgress(`${channel.name}: หน้า ${page + 1}, บันทึก ${imported.length} วิดีโอ${pageToken ? '' : ' — ครบแล้ว'}`);
        if (!pageToken) break;
        if (page === 99) onProgress('หยุดที่เพดาน 100 หน้า เรียกคำสั่งเดิมอีกครั้งเพื่อทำต่อ');
      }
    } finally { await unlock(name, token); }
  }
  // Refresh older catalog entries (including videos discovered by explicit search).
  for (let batch = 0; batch < 10; batch++) {
    const cutoff = new Date(Date.now() - 7 * DAY).toISOString();
    const rows = await catalogRest(`karaoke_catalog?select=video_id&refreshed_at=lt.${encodeURIComponent(cutoff)}&order=refreshed_at.asc&limit=50`);
    const ids = Array.isArray(rows) ? rows.flatMap((row): string[] => record(row) && typeof row.video_id === 'string' ? [row.video_id] : []) : [];
    if (!ids.length) break;
    await refreshIds(ids);
    onProgress(`อัปเดตข้อมูลเก่า ${ids.length} วิดีโอ`);
  }
}

export interface DailyCatalogSyncResult {
  channelsProcessed: number;
  videosImported: number;
  videosRefreshed: number;
  refreshBatches: number;
  stoppedEarly: boolean;
  messages: string[];
}

// Vercel Hobby runs this once per day. Scan only the newest page from each
// official channel, then refresh bounded batches of the oldest metadata. The
// full historical import remains an explicit local operator command.
export async function syncOfficialCatalogDaily(): Promise<DailyCatalogSyncResult> {
  const startedAt = Date.now();
  const messages: string[] = [];
  let channelsProcessed = 0;
  let videosImported = 0;
  let videosRefreshed = 0;
  let refreshBatches = 0;
  let stoppedEarly = false;
  const hasTime = () => Date.now() - startedAt < DAILY_SYNC_BUDGET_MS;

  for (const channel of OFFICIAL_YOUTUBE_CHANNELS) {
    if (!hasTime()) { stoppedEarly = true; break; }
    const name = `sync:${channel.channelId}`;
    const token = randomUUID();
    if (!await lock(name, token)) {
      messages.push(`${channel.name}: ข้ามเพราะมีงานนำเข้าทำงานอยู่`);
      continue;
    }
    try {
      const stateRows = await catalogRest(
        `karaoke_catalog_sync?channel_id=eq.${channel.channelId}&select=*`
      );
      const state = Array.isArray(stateRows) && record(stateRows[0]) ? stateRows[0] : undefined;
      const playlistId = await resolveUploadsPlaylist(
        channel, typeof state?.playlist_id === 'string' ? state.playlist_id : ''
      );
      const data = await youtubeCatalogRequest('playlistItems', {
        part: 'contentDetails', playlistId, maxResults: '50',
      });
      const ids = (data.items as unknown[]).flatMap((item): string[] => {
        const details = record(item) && record(item.contentDetails) ? item.contentDetails : undefined;
        return typeof details?.videoId === 'string' && /^[\w-]{11}$/.test(details.videoId)
          ? [details.videoId] : [];
      });
      const imported = ids.length ? await refreshIds(ids, channel) : [];
      if (!state) {
        await catalogRest('karaoke_catalog_sync?on_conflict=channel_id', {
          method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ channel_id: channel.channelId, playlist_id: playlistId,
            page_token: null, completed_at: null, updated_at: new Date().toISOString() }),
        });
      }
      channelsProcessed++;
      videosImported += imported.length;
      messages.push(`${channel.name}: ตรวจวิดีโอล่าสุด ${ids.length}, บันทึก ${imported.length}`);
    } catch (error: unknown) {
      messages.push(`${channel.name}: ${error instanceof Error ? error.message : 'อัปเดตไม่สำเร็จ'}`);
    } finally { await unlock(name, token); }
  }

  for (let batch = 0; batch < DAILY_REFRESH_BATCHES; batch++) {
    if (!hasTime()) { stoppedEarly = true; break; }
    const cutoff = new Date(Date.now() - 7 * DAY).toISOString();
    const rows = await catalogRest(
      `karaoke_catalog?select=video_id&refreshed_at=lt.${encodeURIComponent(cutoff)}&order=refreshed_at.asc&limit=50`
    );
    const ids = Array.isArray(rows) ? rows.flatMap((row): string[] => (
      record(row) && typeof row.video_id === 'string' ? [row.video_id] : []
    )) : [];
    if (!ids.length) break;
    try {
      const refreshed = await refreshIds(ids);
      videosRefreshed += refreshed.length;
      refreshBatches++;
    } catch (error: unknown) {
      messages.push(`refresh: ${error instanceof Error ? error.message : 'อัปเดตไม่สำเร็จ'}`);
      stoppedEarly = true;
      break;
    }
  }

  messages.push(`สรุป: ช่อง ${channelsProcessed}, เพิ่ม/อัปเดตล่าสุด ${videosImported}, รีเฟรช ${videosRefreshed}`);
  return { channelsProcessed, videosImported, videosRefreshed, refreshBatches, stoppedEarly, messages };
}
