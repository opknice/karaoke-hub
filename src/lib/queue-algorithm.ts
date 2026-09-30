import { QueueItem, QueueMode } from './types';

export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '3:30';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function formatMinutes(seconds: number): string {
  const mins = Math.ceil(seconds / 60);
  if (mins <= 1) return '< 1 min';
  return `~${mins} mins`;
}

/**
 * Calculates estimated waiting time (in seconds) for a song or singer in the queue
 */
export function calculateEstimatedWait(
  queue: QueueItem[],
  targetItemId: string,
  currentSongElapsedSeconds = 0
): { waitSeconds: number; songsAhead: number; singersAhead: string[] } {
  const targetIndex = queue.findIndex(item => item.id === targetItemId);
  if (targetIndex <= 0) {
    return { waitSeconds: 0, songsAhead: 0, singersAhead: [] };
  }

  const itemsAhead = queue.slice(0, targetIndex);
  let totalWaitSeconds = 0;
  const uniqueSingers = new Set<string>();

  itemsAhead.forEach((item, index) => {
    const itemDuration = item.video?.duration || 210;
    if (index === 0 && item.status === 'playing') {
      const remaining = Math.max(0, itemDuration - currentSongElapsedSeconds);
      totalWaitSeconds += remaining;
    } else {
      totalWaitSeconds += itemDuration;
    }

    item.singers.forEach(s => uniqueSingers.add(s.name));
  });

  return {
    waitSeconds: totalWaitSeconds,
    songsAhead: itemsAhead.length,
    singersAhead: Array.from(uniqueSingers),
  };
}

/**
 * Organizes queue according to Singer Rotation Mode (Spec Section 8)
 * - FIFO: First-in, first-out order preserved
 * - Round Robin: Interleaves songs so each unique singer takes turns
 * - Smart Rotation: Balances singer wait times and song counts
 */
export function reorderQueueByMode(
  pendingQueue: QueueItem[],
  mode: QueueMode,
  recentlyPlayedSingerNames: string[] = []
): QueueItem[] {
  if (pendingQueue.length <= 1 || mode === 'fifo') {
    return pendingQueue.map((item, idx) => ({ ...item, position: idx + 1 }));
  }

  if (mode === 'round_robin') {
    // Group songs by primary singer
    const singerMap = new Map<string, QueueItem[]>();
    for (const item of pendingQueue) {
      const primarySinger = item.singers[0]?.name || item.requested_by || 'Anonymous';
      if (!singerMap.has(primarySinger)) {
        singerMap.set(primarySinger, []);
      }
      singerMap.get(primarySinger)!.push(item);
    }

    const reordered: QueueItem[] = [];
    let hasMore = true;
    let round = 0;

    // Pick 1 song per singer in each round
    while (hasMore) {
      hasMore = false;
      for (const [_, songs] of singerMap.entries()) {
        if (round < songs.length) {
          reordered.push(songs[round]);
          if (round + 1 < songs.length) {
            hasMore = true;
          }
        }
      }
      round++;
    }

    return reordered.map((item, idx) => ({ ...item, position: idx + 1 }));
  }

  if (mode === 'smart') {
    // Smart Rotation:
    // Factors:
    // 1. Give priority to singers who haven't sung yet
    // 2. Penalize singers who just sang (in recentlyPlayedSingerNames)
    // 3. Penalize singers with many songs already in queue
    const singerSongCounts = new Map<string, number>();
    for (const item of pendingQueue) {
      const singer = item.singers[0]?.name || item.requested_by;
      singerSongCounts.set(singer, (singerSongCounts.get(singer) || 0) + 1);
    }

    const available = [...pendingQueue];
    const result: QueueItem[] = [];
    let lastSinger = recentlyPlayedSingerNames[0] || '';

    while (available.length > 0) {
      // Find candidate with lowest penalty
      let bestIndex = 0;
      let lowestPenalty = Infinity;

      for (let i = 0; i < available.length; i++) {
        const item = available[i];
        const singer = item.singers[0]?.name || item.requested_by;
        let penalty = 0;

        // Severe penalty for consecutive songs by same singer
        if (singer === lastSinger && available.length > 1) {
          penalty += 1000;
        }

        // Recent history penalty
        const recentIndex = recentlyPlayedSingerNames.indexOf(singer);
        if (recentIndex !== -1) {
          penalty += (5 - Math.min(recentIndex, 4)) * 50;
        }

        // Small index bias to preserve original order if tied
        penalty += i;

        if (penalty < lowestPenalty) {
          lowestPenalty = penalty;
          bestIndex = i;
        }
      }

      const [selected] = available.splice(bestIndex, 1);
      result.push(selected);
      lastSinger = selected.singers[0]?.name || selected.requested_by;
    }

    return result.map((item, idx) => ({ ...item, position: idx + 1 }));
  }

  return pendingQueue;
}
