import type { YouTubeVideo } from './types';

export function isYouTubeVideo(value: unknown): value is YouTubeVideo {
  if (typeof value !== 'object' || value === null) return false;
  const video = value as Record<string, unknown>;
  return typeof video.id === 'string' && typeof video.youtube_video_id === 'string'
    && typeof video.title === 'string' && typeof video.channel_name === 'string'
    && typeof video.thumbnail_url === 'string' && typeof video.duration === 'number'
    && typeof video.embeddable === 'boolean' && typeof video.karaoke_score === 'number'
    && (video.views_count === undefined || (typeof video.views_count === 'number' && Number.isFinite(video.views_count)))
    && (video.artist === undefined || typeof video.artist === 'string')
    && (video.last_synced_at === undefined || typeof video.last_synced_at === 'string');
}
