import 'server-only';
import { randomUUID } from 'node:crypto';
import { catalogRest } from './supabase/catalog-rest';
import {
  OFFICIAL_YOUTUBE_CHANNELS,
  type OfficialYouTubeChannel,
} from './official-youtube-channels';
import { normalizeYouTubeSearchText, rankKaraokeVideos } from './youtube-ranking';
import { isYouTubeVideo } from './youtube-video-validation';
import { videosFromDetailsPayload } from './youtube';
import type { YouTubeVideo } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RANKED_CATALOG_RETRY_DELAY = 60_000;
const queryCache = new Map<string, { expires: number; promise: Promise<YouTubeVideo[]> }>();
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
  return value.filter(isYouTubeVideo);
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
  return true;
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

export async function saveCatalogVideos(videos: readonly YouTubeVideo[]): Promise<void> {
  const rows = videos.flatMap((video) => {
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
}

async function youtubeCatalogRequest(endpoint: 'channels' | 'playlistItems' | 'videos', params: Record<string, string>): Promise<Record<string, unknown>> {
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
      if (!playlistId) {
        const data = await youtubeCatalogRequest('channels', { part: 'contentDetails', id: channel.channelId });
        const item = Array.isArray(data.items) ? data.items[0] as unknown : undefined;
        const details = record(item) && record(item.contentDetails) ? item.contentDetails : undefined;
        const playlists = details && record(details.relatedPlaylists) ? details.relatedPlaylists : undefined;
        if (typeof playlists?.uploads !== 'string') throw new Error('ไม่พบ uploads playlist ของช่อง');
        playlistId = playlists.uploads;
      }
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
