import type { QueueItem, QueueStatus } from './types';
import { isYouTubeVideo } from './youtube-video-validation';

const QUEUE_STATUSES: ReadonlySet<QueueStatus> = new Set([
  'pending',
  'queued',
  'playing',
  'completed',
  'skipped',
  'cancelled',
]);

const LEGACY_DEMO_ITEM_IDS = new Set([
  'initial-playing-1',
  'sample-q-1',
  'sample-q-2',
]);

export interface RestoredPlaybackState {
  nowPlaying: QueueItem | null;
  queue: QueueItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStoredQueueItem(value: unknown): value is QueueItem {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string'
    && typeof value.youtube_video_id === 'string'
    && isYouTubeVideo(value.video)
    && typeof value.status === 'string'
    && QUEUE_STATUSES.has(value.status as QueueStatus)
    && typeof value.position === 'number'
    && Number.isFinite(value.position)
    && typeof value.requested_by === 'string'
    && Array.isArray(value.singers)
    && value.singers.every((singer) => (
      isRecord(singer)
      && typeof singer.id === 'string'
      && typeof singer.name === 'string'
    ))
    && typeof value.created_at === 'string'
  );
}

function parseStoredValue(value: string | null): unknown {
  if (!value) return null;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isLegacyDemoItem(item: QueueItem): boolean {
  return LEGACY_DEMO_ITEM_IDS.has(item.id);
}

export function restoreStoredPlaybackState(
  savedNowPlaying: string | null,
  savedQueue: string | null
): RestoredPlaybackState {
  const parsedNowPlaying = parseStoredValue(savedNowPlaying);
  const nowPlaying = isStoredQueueItem(parsedNowPlaying) && !isLegacyDemoItem(parsedNowPlaying)
    ? parsedNowPlaying
    : null;

  const parsedQueue = parseStoredValue(savedQueue);
  const queue = Array.isArray(parsedQueue)
    ? parsedQueue.filter(isStoredQueueItem).filter((item) => !isLegacyDemoItem(item))
    : [];

  return { nowPlaying, queue };
}
