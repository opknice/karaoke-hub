import type { YouTubeVideo } from './types';
import { isYouTubeVideo } from './youtube-video-validation';
import { rankKaraokeVideos } from './youtube-ranking';
import { SEED_KARAOKE_VIDEOS } from './karaoke-seed';

interface SearchResponse {
  success: true;
  data: YouTubeVideo[];
}

interface ClientSearchCacheEntry {
  expiresAt: number;
  results: YouTubeVideo[];
}

const CLIENT_SEARCH_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CLIENT_SEARCH_CACHE_ENTRIES = 100;
const clientSearchCache = new Map<string, ClientSearchCacheEntry>();
const requests = new Map<string, Promise<YouTubeVideo[]>>();
let hydrated = false;
const STORAGE_KEY = 'karaoke-search-cache-v1';

export function isDirectVideoQuery(query: string): boolean {
  return /^(?:https?:\/\/|id:[\w-]{11}$)/i.test(query.trim());
}

function hydrateCache(): void {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(value)) return;
    for (const entry of value.slice(-MAX_CLIENT_SEARCH_CACHE_ENTRIES)) {
      if (!isRecord(entry) || typeof entry.query !== 'string' || typeof entry.expiresAt !== 'number'
        || entry.expiresAt <= Date.now() || !Array.isArray(entry.results) || !entry.results.every(isYouTubeVideo)) continue;
      clientSearchCache.set(entry.query, { expiresAt: entry.expiresAt, results: entry.results });
    }
  } catch { /* Storage can be unavailable; server cache still works. */ }
}

export function getLocalSearchPreview(query: string): YouTubeVideo[] {
  hydrateCache();
  if (!query.trim()) return [];
  const unique = new Map<string, YouTubeVideo>();
  for (const entry of clientSearchCache.values()) {
    if (entry.expiresAt <= Date.now()) continue;
    for (const video of entry.results) unique.set(video.youtube_video_id, video);
  }
  for (const video of SEED_KARAOKE_VIDEOS) {
    if (!unique.has(video.youtube_video_id)) unique.set(video.youtube_video_id, { ...video, views_count: undefined });
  }
  return rankKaraokeVideos([...unique.values()], query).slice(0, 25);
}

function cacheClientResults(query: string, results: YouTubeVideo[], maxAge = CLIENT_SEARCH_CACHE_TTL_MS): void {
  clientSearchCache.delete(query);
  while (clientSearchCache.size >= MAX_CLIENT_SEARCH_CACHE_ENTRIES) {
    const oldestQuery = clientSearchCache.keys().next().value;
    if (typeof oldestQuery !== 'string') break;
    clientSearchCache.delete(oldestQuery);
  }
  const detailExpirations = results.flatMap((video) => {
    const refreshedAt = Date.parse(video.last_synced_at ?? '');
    return video.views_count !== undefined && Number.isFinite(refreshedAt) ? [refreshedAt + CLIENT_SEARCH_CACHE_TTL_MS] : [];
  });
  clientSearchCache.set(query, {
    expiresAt: Math.min(Date.now() + maxAge, Date.now() + (results.length ? CLIENT_SEARCH_CACHE_TTL_MS : 15 * 60_000), ...detailExpirations),
    results,
  });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...clientSearchCache].map(([query, entry]) => ({ query, ...entry }))));
  } catch { /* Full or disabled browser storage must not break search. */ }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSearchResponse(payload: unknown): SearchResponse {
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.data)) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'ผลการค้นหามีรูปแบบไม่ถูกต้อง';
    throw new Error(message);
  }

  return {
    success: true,
    data: payload.data.filter(isYouTubeVideo),
  };
}

export async function searchYouTubeKaraoke(
  query: string,
  signal?: AbortSignal,
  source: 'catalog' | 'youtube' = 'catalog'
): Promise<YouTubeVideo[]> {
  signal?.throwIfAborted();
  hydrateCache();
  const trimmed = query.trim().replace(/\s+/g, ' ');
  // Video IDs are case-sensitive, including when embedded in a URL.
  const normalizedQuery = isDirectVideoQuery(trimmed)
    ? trimmed : trimmed.toLocaleLowerCase('th-TH');
  const cacheKey = isDirectVideoQuery(normalizedQuery) ? normalizedQuery : `${source}:${normalizedQuery}`;
  const cached = clientSearchCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return isDirectVideoQuery(normalizedQuery) ? cached.results
      : rankKaraokeVideos(cached.results, normalizedQuery, 'song', true);
  }

  let pending = requests.get(cacheKey);
  if (!pending) {
    pending = fetchSearch(normalizedQuery, source, cacheKey).finally(() => requests.delete(cacheKey));
    requests.set(cacheKey, pending);
  }
  const results = await pending;
  signal?.throwIfAborted();
  return isDirectVideoQuery(normalizedQuery) ? results
    : rankKaraokeVideos(results, normalizedQuery, 'song', true);
}

export async function searchPlayerKaraoke(
  query: string,
  signal: AbortSignal,
  source: 'catalog' | 'youtube',
  onFallback: () => void
): Promise<{ videos: YouTubeVideo[]; source: 'catalog' | 'youtube' }> {
  const videos = await searchYouTubeKaraoke(query, signal, source);
  if (source === 'youtube' || videos.length > 0 || isDirectVideoQuery(query)) {
    return { videos, source };
  }

  signal.throwIfAborted();
  onFallback();
  return { videos: await searchYouTubeKaraoke(query, signal, 'youtube'), source: 'youtube' };
}

async function fetchSearch(normalizedQuery: string, source: 'catalog' | 'youtube', cacheKey: string): Promise<YouTubeVideo[]> {
  const response = await fetch('/api/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: normalizedQuery, source }),
  });
  const payload: unknown = await response.json();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('karaoke-search-warning', {
      detail: isRecord(payload) && typeof payload.warning === 'string' ? payload.warning : '',
    }));
  }
  if (isRecord(payload) && isRecord(payload.budget) && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('karaoke-search-budget', { detail: payload.budget }));
  }

  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'ค้นหาเพลงไม่สำเร็จ กรุณาลองใหม่';
    throw new Error(message);
  }

  const results = parseSearchResponse(payload).data;
  cacheClientResults(cacheKey, results, source === 'catalog' && !isDirectVideoQuery(normalizedQuery) ? 15_000 : CLIENT_SEARCH_CACHE_TTL_MS);
  return results;
}

export async function previewCatalog(query: string, signal: AbortSignal): Promise<YouTubeVideo[]> {
  const response = await fetch(`/api/catalog?q=${encodeURIComponent(query.trim())}`, { signal, cache: 'no-store' });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error('คลังเพลงยังไม่พร้อมใช้งาน ไม่มีการค้น YouTube อัตโนมัติ');
  return parseSearchResponse(payload).data;
}
