/// <reference lib="webworker" />

import { getKaraokeTier, normalizeYouTubeSearchText, rankKaraokeVideos } from './youtube-ranking';
import type { YouTubeSearchMode } from './youtube-ranking';
import type { LocalCatalogSong } from './local-catalog-types';

type IndexedSong = { song: LocalCatalogSong; searchText: string; expiresMs: number };
let indexedSongs: IndexedSong[] = [];

self.onmessage = (event: MessageEvent<
  { type: 'init'; songs: LocalCatalogSong[] } | { type: 'search'; query: string; mode?: YouTubeSearchMode; requestId: number }
>) => {
  const message = event.data;
  if (message.type === 'init') {
    const now = Date.now();
    indexedSongs = message.songs
      .filter((song) => Date.parse(song.expires_at) > now && getKaraokeTier(song.video) > 0)
      .map((song) => ({
        song,
        expiresMs: Date.parse(song.expires_at),
        searchText: normalizeYouTubeSearchText(
          `${song.video.title} ${song.video.artist ?? ''} ${song.video.channel_name}`,
        ),
      }));
    self.postMessage({ type: 'ready', count: indexedSongs.length });
    return;
  }
  const query = normalizeYouTubeSearchText(message.query);
  const tokens = query.split(' ').filter(Boolean);
  const now = Date.now();
  const candidates = tokens.length === 0 ? [] : indexedSongs
    .filter(({ expiresMs, searchText }) => expiresMs > now
      && tokens.every((token) => searchText.includes(token)))
    .map(({ song }) => song.video);
  const results = rankKaraokeVideos(candidates, message.query, message.mode ?? 'song').slice(0, 25);
  self.postMessage({ type: 'results', query: message.query, requestId: message.requestId, results });
};
