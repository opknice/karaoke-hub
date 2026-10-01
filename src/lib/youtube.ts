import 'server-only';

import type { YouTubeVideo } from './types';
import { searchSeedVideos, SEED_KARAOKE_VIDEOS } from './karaoke-seed';
import { rankKaraokeVideos } from './youtube-ranking';
import { readStoredSearch, writeStoredSearch, reserveSearch, releaseSearch, markUpstreamQuotaExhausted, SearchBudgetError } from './youtube-search-store';

const VIDEO_DETAILS_CACHE_TTL_MS = 60 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000;
const EMPTY_SEARCH_CACHE_TTL_MS = 30 * 1000;
const MAX_SEARCH_CACHE_ENTRIES = 250;
const MAX_VIDEO_IDS_PER_REQUEST = 50;
// YouTube charges one Search Queries unit per request, not per returned item.
// Keep enough candidates for relevance, karaoke quality, and view-count ranking.
const MAX_SEARCH_RESULTS = 25;
const SEARCH_QUOTA_EXHAUSTED_MESSAGE =
  'โควตาการค้นหา YouTube รายวันเต็มแล้ว ระบบจะค้นหาได้อีกครั้งหลังโควตารีเซ็ต หรือเมื่อเพิ่มโควตาใน Google Cloud';

interface SearchCacheEntry {
  expiresAt: number;
  results: YouTubeVideo[];
}

interface YouTubeSearchItem {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string;
  publishedAt?: string;
}

interface YouTubeVideoDetails {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string;
  duration: number;
  embeddable: boolean;
  views?: number;
  publishedAt?: string;
}

interface VideoDetailsCacheEntry {
  timestamp: number;
  details: YouTubeVideoDetails | null;
}

const searchCache = new Map<string, SearchCacheEntry>();
const searchRequests = new Map<string, Promise<YouTubeVideo[]>>();
const videoDetailsCache = new Map<string, VideoDetailsCacheEntry>();

export class YouTubeSearchError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'YouTubeSearchError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function getRecord(
  record: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function getYouTubeApiErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const error = getRecord(payload, 'error');
  return error ? getString(error, 'message') : undefined;
}

function cacheSearchResults(
  query: string,
  results: YouTubeVideo[],
  ttl: number
): void {
  searchCache.delete(query);
  while (searchCache.size >= MAX_SEARCH_CACHE_ENTRIES) {
    const oldestQuery = searchCache.keys().next().value;
    if (typeof oldestQuery !== 'string') break;
    searchCache.delete(oldestQuery);
  }
  const detailExpirations = results.flatMap((video) => {
    const refreshedAt = Date.parse(video.last_synced_at ?? '');
    return video.views_count !== undefined && Number.isFinite(refreshedAt) ? [refreshedAt + VIDEO_DETAILS_CACHE_TTL_MS] : [];
  });
  searchCache.set(query, { expiresAt: Math.min(Date.now() + ttl, ...detailExpirations), results });
}

function parseISO8601Duration(duration: string | undefined): number {
  if (!duration) return 210;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 210;

  const hours = Number.parseInt(match[1] ?? '0', 10);
  const minutes = Number.parseInt(match[2] ?? '0', 10);
  const seconds = Number.parseInt(match[3] ?? '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

function parseViewCount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match: string, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    );
}

function getThumbnailUrl(
  snippet: Record<string, unknown>,
  videoId: string
): string {
  const thumbnails = getRecord(snippet, 'thumbnails');
  if (thumbnails) {
    for (const quality of ['maxres', 'standard', 'high', 'medium', 'default']) {
      const thumbnail = getRecord(thumbnails, quality);
      if (!thumbnail) continue;
      const url = getString(thumbnail, 'url');
      if (url) return url;
    }
  }

  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

function calculateKaraokeScore(title: string, channel: string): number {
  let score = 80;
  const normalizedTitle = title.toLocaleLowerCase('en-US');
  const normalizedChannel = channel.toLocaleLowerCase('en-US');

  if (
    normalizedChannel.includes('sing king') ||
    normalizedChannel.includes('genierock') ||
    normalizedChannel.includes('karaoke')
  ) {
    score += 12;
  }
  if (
    normalizedTitle.includes('official karaoke') ||
    normalizedTitle.includes('karaoke version')
  ) {
    score += 8;
  }
  if (
    normalizedTitle.includes('with lyrics') ||
    normalizedTitle.includes('instrumental')
  ) {
    score += 5;
  }
  if (
    normalizedTitle.includes('no vocal') ||
    normalizedTitle.includes('minus one')
  ) {
    score += 4;
  }
  return Math.min(score, 99);
}

function parseSearchItems(payload: unknown): YouTubeSearchItem[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return [];

  return payload.items.flatMap((rawItem): YouTubeSearchItem[] => {
    if (!isRecord(rawItem)) return [];
    const id = getRecord(rawItem, 'id');
    const snippet = getRecord(rawItem, 'snippet');
    if (!id || !snippet) return [];

    const videoId = getString(id, 'videoId');
    const title = getString(snippet, 'title');
    const channelId = getString(snippet, 'channelId');
    const channelTitle = getString(snippet, 'channelTitle');
    if (!videoId || !title || !channelId || !channelTitle) return [];

    return [
      {
        videoId,
        title: decodeHtmlEntities(title),
        channelId,
        channelTitle: decodeHtmlEntities(channelTitle),
        thumbnailUrl: getThumbnailUrl(snippet, videoId),
        publishedAt: getString(snippet, 'publishedAt'),
      },
    ];
  });
}

function parseVideoDetails(payload: unknown): YouTubeVideoDetails[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return [];

  return payload.items.flatMap((rawItem): YouTubeVideoDetails[] => {
    if (!isRecord(rawItem)) return [];
    const id = getString(rawItem, 'id');
    const snippet = getRecord(rawItem, 'snippet');
    const contentDetails = getRecord(rawItem, 'contentDetails');
    const statistics = getRecord(rawItem, 'statistics');
    const status = getRecord(rawItem, 'status');
    if (!id || !snippet || !contentDetails || !status) return [];

    const title = getString(snippet, 'title');
    const channelId = getString(snippet, 'channelId');
    const channelTitle = getString(snippet, 'channelTitle');
    const embeddable = status.embeddable;
    if (
      !title ||
      !channelId ||
      !channelTitle ||
      typeof embeddable !== 'boolean'
    ) {
      return [];
    }

    return [
      {
        id,
        title: decodeHtmlEntities(title),
        channelId,
        channelTitle: decodeHtmlEntities(channelTitle),
        thumbnailUrl: getThumbnailUrl(snippet, id),
        duration: parseISO8601Duration(getString(contentDetails, 'duration')),
        embeddable,
        views: statistics
          ? parseViewCount(getString(statistics, 'viewCount'))
          : undefined,
        publishedAt: getString(snippet, 'publishedAt'),
      },
    ];
  });
}

// Used by the catalog importer/refresh path, never by browser code.
export function videosFromDetailsPayload(payload: unknown): YouTubeVideo[] {
  return parseVideoDetails(payload).map((details) => ({
    id: `yt-${details.id}`, youtube_video_id: details.id, title: details.title,
    channel_id: details.channelId, channel_name: details.channelTitle,
    thumbnail_url: details.thumbnailUrl, duration: details.duration,
    embeddable: details.embeddable, karaoke_score: calculateKaraokeScore(details.title, details.channelTitle),
    views_count: details.views, last_synced_at: new Date().toISOString(), created_at: details.publishedAt,
  }));
}

function chunkVideoIds(videoIds: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < videoIds.length; index += MAX_VIDEO_IDS_PER_REQUEST) {
    chunks.push(videoIds.slice(index, index + MAX_VIDEO_IDS_PER_REQUEST));
  }
  return chunks;
}

async function getVideoDetails(
  videoIds: readonly string[],
  apiKey: string
): Promise<Map<string, YouTubeVideoDetails | null>> {
  const now = Date.now();
  const uniqueIds = [...new Set(videoIds)];
  const detailsById = new Map<string, YouTubeVideoDetails | null>();
  const missingIds: string[] = [];

  for (const videoId of uniqueIds) {
    const cached = videoDetailsCache.get(videoId);
    if (cached && now - cached.timestamp < VIDEO_DETAILS_CACHE_TTL_MS) {
      detailsById.set(videoId, cached.details);
    } else {
      missingIds.push(videoId);
    }
  }

  for (const chunk of chunkVideoIds(missingIds)) {
    const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    detailsUrl.searchParams.set('part', 'snippet,contentDetails,statistics,status');
    detailsUrl.searchParams.set('id', chunk.join(','));
    detailsUrl.searchParams.set('key', apiKey);

    try {
      const response = await fetch(detailsUrl.toString(), { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        console.warn(`YouTube video details API error ${response.status}`);
        continue;
      }

      const payload: unknown = await response.json();
      const parsedDetails = parseVideoDetails(payload);
      const returnedIds = new Set(parsedDetails.map((details) => details.id));

      for (const details of parsedDetails) {
        detailsById.set(details.id, details);
        videoDetailsCache.set(details.id, { timestamp: now, details });
      }

      for (const videoId of chunk) {
        if (returnedIds.has(videoId)) continue;
        detailsById.set(videoId, null);
        videoDetailsCache.set(videoId, { timestamp: now, details: null });
      }
    } catch (error: unknown) {
      console.warn('Unable to refresh YouTube video details:', error);
    }
  }

  return detailsById;
}

function mergeCandidates(
  localResults: readonly YouTubeVideo[],
  youtubeResults: readonly YouTubeVideo[]
): YouTubeVideo[] {
  const uniqueResults = new Map<string, YouTubeVideo>();
  for (const video of [...localResults, ...youtubeResults]) {
    if (!uniqueResults.has(video.youtube_video_id)) {
      uniqueResults.set(video.youtube_video_id, video);
    }
  }
  return [...uniqueResults.values()];
}

function applyLiveDetails(
  candidates: readonly YouTubeVideo[],
  detailsById: ReadonlyMap<string, YouTubeVideoDetails | null>
): YouTubeVideo[] {
  return candidates.flatMap((candidate): YouTubeVideo[] => {
    const details = detailsById.get(candidate.youtube_video_id);
    if (details === null) return [];

    if (!details) {
      return [{ ...candidate, views_count: undefined }];
    }

    return [
      {
        ...candidate,
        title: details.title,
        channel_id: details.channelId,
        channel_name: details.channelTitle,
        thumbnail_url: details.thumbnailUrl,
        duration: details.duration,
        embeddable: details.embeddable,
        karaoke_score: calculateKaraokeScore(details.title, details.channelTitle),
        views_count: details.views,
        last_synced_at: new Date(videoDetailsCache.get(candidate.youtube_video_id)?.timestamp ?? Date.now()).toISOString(),
        created_at: details.publishedAt ?? candidate.created_at,
      },
    ];
  });
}

function createSearchVideos(items: readonly YouTubeSearchItem[]): YouTubeVideo[] {
  return items.map((item) => ({
    id: `yt-${item.videoId}`,
    youtube_video_id: item.videoId,
    title: item.title,
    channel_id: item.channelId,
    channel_name: item.channelTitle,
    thumbnail_url: item.thumbnailUrl,
    duration: 210,
    embeddable: true,
    karaoke_score: calculateKaraokeScore(item.title, item.channelTitle),
    created_at: item.publishedAt,
  }));
}

async function enrichAndRankCandidates(
  candidates: readonly YouTubeVideo[],
  query: string,
  apiKey: string | undefined
): Promise<YouTubeVideo[]> {
  if (!apiKey) return rankKaraokeVideos(candidates, query);

  const detailsById = await getVideoDetails(
    candidates.map((video) => video.youtube_video_id),
    apiKey
  );
  return rankKaraokeVideos(applyLiveDetails(candidates, detailsById), query, 'song', true);
}

function hasKaraokeTerm(query: string): boolean {
  return /(?:karaoke|คาราโอเกะ)/iu.test(query);
}

function containsThaiCharacters(query: string): boolean {
  return /[\u0E00-\u0E7F]/u.test(query);
}

function buildYouTubeQuery(query: string): string {
  if (hasKaraokeTerm(query)) return query;
  return containsThaiCharacters(query)
    ? `${query} คาราโอเกะ`
    : `${query} karaoke`;
}

async function fetchYouTubeSearch(
  query: string,
  apiKey: string
): Promise<YouTubeVideo[]> {
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  searchUrl.searchParams.set('part', 'snippet');
  searchUrl.searchParams.set('type', 'video');
  searchUrl.searchParams.set('videoEmbeddable', 'true');
  searchUrl.searchParams.set('maxResults', String(MAX_SEARCH_RESULTS));
  searchUrl.searchParams.set('order', 'relevance');
  searchUrl.searchParams.set('regionCode', 'TH');
  searchUrl.searchParams.set('relevanceLanguage', 'th');
  searchUrl.searchParams.set('q', buildYouTubeQuery(query));
  searchUrl.searchParams.set('key', apiKey);

  let response: Response;
  try {
    response = await fetch(searchUrl.toString(), { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch (error: unknown) {
    console.warn('Unable to search YouTube:', error);
    throw new YouTubeSearchError('เชื่อมต่อ YouTube ไม่สำเร็จ กรุณาลองใหม่', 502);
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined);
    const upstreamMessage = getYouTubeApiErrorMessage(payload);
    console.warn(
      `YouTube search API error ${response.status}`,
      upstreamMessage ?? 'No error message returned'
    );

    const isDailyQuotaExhausted =
      (response.status === 429 || response.status === 403) &&
      /per day|daily|exceeded your.*quota/iu.test(upstreamMessage ?? '');

    if (isDailyQuotaExhausted) {
      await markUpstreamQuotaExhausted();
      throw new YouTubeSearchError(
        SEARCH_QUOTA_EXHAUSTED_MESSAGE,
        429
      );
    }
    if (response.status === 429) {
      throw new YouTubeSearchError(
        'YouTube จำกัดการค้นหาชั่วคราว กรุณารอสักครู่แล้วลองใหม่',
        429
      );
    }
    throw new YouTubeSearchError('ค้นหาจาก YouTube ไม่สำเร็จ กรุณาลองใหม่', 502);
  }

  const payload: unknown = await response.json();
  return createSearchVideos(parseSearchItems(payload));
}

function extractVideoId(query: string): string | undefined {
  const explicitId = query.match(/^id:([\w-]{11})$/i)?.[1];
  if (explicitId) return explicitId;
  try {
    const url = new URL(query);
    if (!['https:', 'http:'].includes(url.protocol)) return undefined;
    const host = url.hostname.toLowerCase();
    const id = host === 'youtu.be' ? url.pathname.slice(1)
      : ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)
        ? url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1]
        : undefined;
    return id && /^[\w-]{11}$/.test(id) ? id : undefined;
  } catch { return undefined; }
}

async function performKaraokeSearch(normalizedQuery: string, client: string): Promise<YouTubeVideo[]> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim() || undefined;
  const videoId = extractVideoId(normalizedQuery);
  if (!videoId && /^(?:https?:\/\/|id:)/i.test(normalizedQuery)) {
    throw new YouTubeSearchError('กรุณาวางลิงก์วิดีโอ YouTube ที่ถูกต้อง ไม่ใช่ลิงก์ช่องหรือหน้าค้นหา', 400);
  }
  if (videoId && !apiKey) {
    throw new YouTubeSearchError('ยังไม่ได้ตั้งค่า YouTube API Key สำหรับตรวจสอบลิงก์วิดีโอ', 503);
  }
  if (videoId && apiKey) {
    const details = (await getVideoDetails([videoId], apiKey)).get(videoId);
    if (details === undefined) throw new YouTubeSearchError('ดึงรายละเอียดวิดีโอไม่สำเร็จ กรุณาลองใหม่', 502);
    if (!details || !details.embeddable) throw new YouTubeSearchError('วิดีโอนี้ไม่พร้อมเล่นแบบฝัง', 422);
    return applyLiveDetails(createSearchVideos([{ videoId, title: details.title, channelId: details.channelId,
      channelTitle: details.channelTitle, thumbnailUrl: details.thumbnailUrl }]), new Map([[videoId, details]]));
  }
  const localResults = normalizedQuery
    ? searchSeedVideos(normalizedQuery)
    : SEED_KARAOKE_VIDEOS.slice(0, MAX_SEARCH_RESULTS);

  if (!apiKey) {
    const fallbackResults = rankKaraokeVideos(localResults, normalizedQuery);
    return fallbackResults;
  }

  const stored = await readStoredSearch(normalizedQuery);
  if (stored) {
    if (Date.now() - stored.updatedAt < VIDEO_DETAILS_CACHE_TTL_MS && stored.results.every((video) =>
      video.views_count === undefined || Date.now() - Date.parse(video.last_synced_at ?? '') < VIDEO_DETAILS_CACHE_TTL_MS
    )) return rankKaraokeVideos(stored.results, normalizedQuery, 'song', true);
    // Refresh statistics only. This does not consume Search Queries or extend the
    // search-result TTL, so new videos can be discovered after seven days.
    return enrichAndRankCandidates(stored.results, normalizedQuery, apiKey);
  }
  if (!normalizedQuery) return enrichAndRankCandidates(localResults, '', apiKey);
  let token: string;
  try { token = await reserveSearch(normalizedQuery, client); }
  catch (error: unknown) {
    if (error instanceof SearchBudgetError) throw new YouTubeSearchError(error.message, 429);
    throw new YouTubeSearchError('เปิดฐานข้อมูล Cache/งบค้นหาไม่ได้ กรุณาตรวจสอบเซิร์ฟเวอร์', 503);
  }
  try {
    const youtubeResults = await fetchYouTubeSearch(normalizedQuery, apiKey);
    const results = await enrichAndRankCandidates(mergeCandidates(localResults, youtubeResults), normalizedQuery, apiKey);
    await writeStoredSearch(normalizedQuery, results);
    return results;
  } finally {
    try { await releaseSearch(normalizedQuery, token); }
    catch { console.warn('Unable to release the Supabase search lease; it will expire automatically.'); }
  }
}

export async function searchKaraokeVideos(query: string, client = 'local'): Promise<YouTubeVideo[]> {
  const trimmed = query.trim().replace(/\s+/g, ' ');
  const videoId = extractVideoId(trimmed);
  const normalizedQuery = videoId ? `id:${videoId}` : trimmed.toLocaleLowerCase('th-TH');
  const cached = searchCache.get(normalizedQuery);
  if (cached && Date.now() < cached.expiresAt) return videoId ? cached.results
    : rankKaraokeVideos(cached.results, normalizedQuery, 'song', true);

  const activeRequest = searchRequests.get(normalizedQuery);
  if (activeRequest) return activeRequest;

  const request = performKaraokeSearch(normalizedQuery, client)
    .then((results) => {
      const ttl = results.length > 0
        ? SEARCH_CACHE_TTL_MS
        : EMPTY_SEARCH_CACHE_TTL_MS;
      cacheSearchResults(normalizedQuery, results, ttl);
      return results;
    })
    .catch((error: unknown) => {
      if (!(error instanceof YouTubeSearchError)) throw error;

      // An expired successful result is preferable to an outage screen while the
      // upstream daily quota is unavailable. Never fabricate uncached results.
      if (cached && cached.results.length > 0 && Date.now() - cached.expiresAt < 23 * 60 * 60_000) {
        return cached.results.map((video) => ({ ...video, views_count: undefined }));
      }

      const localResults = rankKaraokeVideos(
        searchSeedVideos(normalizedQuery),
        normalizedQuery
      );
      if (localResults.length > 0) return localResults.map((video) => ({ ...video, views_count: undefined }));
      throw error;
    })
    .finally(() => {
      searchRequests.delete(normalizedQuery);
    });

  searchRequests.set(normalizedQuery, request);
  return request;
}
