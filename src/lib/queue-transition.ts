import type { QueueItem } from './types';

export type QueueAdvanceReason = 'ended' | 'skipped' | 'error';

export interface QueueTransition {
  completedItem: QueueItem | null;
  nextItem: QueueItem | null;
  remainingQueue: QueueItem[];
}

/**
 * Calculates the next playback state without mutating React state.
 * Keeping this transition pure makes end/skip/error behavior deterministic.
 */
export function createQueueTransition(
  currentItem: QueueItem | null,
  queue: readonly QueueItem[],
  reason: QueueAdvanceReason,
  transitionedAt = new Date().toISOString()
): QueueTransition {
  const completedItem = currentItem
    ? {
        ...currentItem,
        status: reason === 'ended' ? ('completed' as const) : ('skipped' as const),
        completed_at: transitionedAt,
      }
    : null;

  const [nextQueueItem, ...rest] = queue;
  const nextItem = nextQueueItem
    ? {
        ...nextQueueItem,
        status: 'playing' as const,
        position: 1,
        started_at: transitionedAt,
      }
    : null;

  const remainingQueue = rest.map((item, index) => ({
    ...item,
    status: 'queued' as const,
    position: index + 1,
  }));

  return { completedItem, nextItem, remainingQueue };
}

/**
 * Starts a selected queued item immediately while preserving the order of all
 * other queued items and marking the previously playing item as skipped.
 */
export function createSelectedQueueTransition(
  currentItem: QueueItem | null,
  queue: readonly QueueItem[],
  selectedItemId: string,
  transitionedAt = new Date().toISOString()
): QueueTransition | null {
  const selectedItem = queue.find((item) => item.id === selectedItemId);
  if (!selectedItem) return null;

  const completedItem = currentItem
    ? {
        ...currentItem,
        status: 'skipped' as const,
        completed_at: transitionedAt,
      }
    : null;

  const nextItem: QueueItem = {
    ...selectedItem,
    status: 'playing',
    position: 1,
    started_at: transitionedAt,
  };

  const remainingQueue = queue
    .filter((item) => item.id !== selectedItemId)
    .map((item, index) => ({
      ...item,
      status: 'queued' as const,
      position: index + 1,
    }));

  return { completedItem, nextItem, remainingQueue };
}
