export class QueueRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'QueueRequestError';
  }
}

/** Retain the caller's expected item on every attempt; never retry a newer song. */
export async function retryQueueOperation<T>(
  operation: () => Promise<T>,
  isCurrent: () => boolean,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<T | undefined> {
  const delays = [500, 1500];
  for (let attempt = 0; ; attempt++) {
    if (!isCurrent()) return undefined;
    try {
      return await operation();
    } catch (error) {
      const transient = error instanceof QueueRequestError
        && (error.status === 0 || error.status === 408 || error.status >= 500);
      if (!transient || attempt >= delays.length) throw error;
      await wait(delays[attempt]);
    }
  }
}

/** Ignore responses from an earlier request, including a room left in flight. */
export function createRoomRefreshGuard() {
  let generation = 0;
  let epoch = 0;
  return {
    invalidate() { epoch++; generation++; },
    capture() {
      const session = epoch;
      return () => session === epoch;
    },
    begin(roomId: string) {
      const request = ++generation;
      const session = epoch;
      return (currentRoomId: string | undefined) => request === generation && session === epoch && currentRoomId === roomId;
    },
  };
}
