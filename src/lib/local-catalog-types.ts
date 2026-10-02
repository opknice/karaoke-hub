import type { YouTubeVideo } from './types';

export const LOCAL_CATALOG_SCHEMA_VERSION = 1;

export interface LocalCatalogSong {
  video_id: string;
  expires_at: string;
  video: YouTubeVideo;
}

export interface LocalCatalogPage {
  success: true;
  schemaVersion: number;
  generatedAt: string;
  songs: LocalCatalogSong[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface LocalCatalogMeta {
  schemaVersion: number;
  generation: string;
  count: number;
  updatedAt: string;
}
