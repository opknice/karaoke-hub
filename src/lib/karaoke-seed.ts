import { YouTubeVideo } from './types';

export const SEED_KARAOKE_VIDEOS: YouTubeVideo[] = [];

export function searchSeedVideos(query: string): YouTubeVideo[] {
  if (!query || !query.trim()) return [];
  const q = query.toLowerCase().trim();
  const tokens = q.split(/\s+/).filter(Boolean);

  return SEED_KARAOKE_VIDEOS.filter((item) => {
    const haystack = `${item.title} ${item.artist || ''} ${item.channel_name}`.toLowerCase();
    return tokens.every(token => haystack.includes(token));
  });
}
