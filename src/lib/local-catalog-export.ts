import 'server-only';
import { catalogRest } from './supabase/catalog-rest';
import { getKaraokeTier } from './youtube-ranking';
import { isYouTubeVideo } from './youtube-video-validation';
import { LOCAL_CATALOG_SCHEMA_VERSION, type LocalCatalogPage, type LocalCatalogSong } from './local-catalog-types';
import type { YouTubeVideo } from './types';

const PAGE_SIZE = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function publicVideo(video: YouTubeVideo): YouTubeVideo {
  return {
    id: video.id,
    youtube_video_id: video.youtube_video_id,
    title: video.title,
    ...(video.artist ? { artist: video.artist } : {}),
    ...(video.channel_id ? { channel_id: video.channel_id } : {}),
    channel_name: video.channel_name,
    thumbnail_url: video.thumbnail_url,
    duration: video.duration,
    embeddable: video.embeddable,
    karaoke_score: video.karaoke_score,
    ...(video.views_count !== undefined ? { views_count: video.views_count } : {}),
    ...(video.last_synced_at ? { last_synced_at: video.last_synced_at } : {}),
  };
}

export async function getLocalCatalogPage(cursor: string | null): Promise<LocalCatalogPage> {
  if (cursor !== null && !/^[A-Za-z0-9_-]{11}$/.test(cursor)) {
    throw new RangeError('cursor ไม่ถูกต้อง');
  }
  const params = new URLSearchParams({
    select: 'video_id,expires_at,payload',
    expires_at: `gt.${new Date().toISOString()}`,
    'payload->>embeddable': 'eq.true',
    order: 'video_id.asc',
    limit: String(PAGE_SIZE),
  });
  if (cursor) params.set('video_id', `gt.${cursor}`);
  const value = await catalogRest(`karaoke_catalog?${params.toString()}`);
  if (!Array.isArray(value)) throw new Error('รูปแบบข้อมูลคลังเพลงไม่ถูกต้อง');

  const songs: LocalCatalogSong[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.video_id !== 'string'
      || typeof row.expires_at !== 'string' || !isYouTubeVideo(row.payload)) continue;
    if (row.video_id !== row.payload.youtube_video_id || getKaraokeTier(row.payload) === 0) continue;
    songs.push({ video_id: row.video_id, expires_at: row.expires_at, video: publicVideo(row.payload) });
  }
  const last = value.at(-1);
  const nextCursor = isRecord(last) && typeof last.video_id === 'string' ? last.video_id : null;
  if (value.length > 0 && (!nextCursor || nextCursor === cursor)) throw new Error('cursor คลังเพลงไม่ถูกต้อง');
  return {
    success: true,
    schemaVersion: LOCAL_CATALOG_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    songs,
    nextCursor,
    hasMore: value.length === PAGE_SIZE,
  };
}

export async function getCurrentCatalogVideo(videoId: string): Promise<YouTubeVideo | null> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new RangeError('video ID ไม่ถูกต้อง');
  const params = new URLSearchParams({
    select: 'video_id,expires_at,payload',
    video_id: `eq.${videoId}`,
    expires_at: `gt.${new Date().toISOString()}`,
    'payload->>embeddable': 'eq.true',
    limit: '1',
  });
  const value = await catalogRest(`karaoke_catalog?${params.toString()}`);
  if (!Array.isArray(value)) throw new Error('รูปแบบข้อมูลคลังเพลงไม่ถูกต้อง');
  const row = value[0];
  if (!isRecord(row) || row.video_id !== videoId || !isYouTubeVideo(row.payload)
    || getKaraokeTier(row.payload) === 0) return null;
  return publicVideo(row.payload);
}
