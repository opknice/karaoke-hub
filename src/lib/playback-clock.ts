export interface PlaybackClockSnapshot {
  currentTime: number;
  duration: number;
}

/** High-frequency playback time must not render the room and search providers. */
export function createPlaybackClock() {
  const initial: PlaybackClockSnapshot = { currentTime: 0, duration: 0 };
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const update = (key: keyof PlaybackClockSnapshot, value: number) => {
    if (!Number.isFinite(value) || snapshot[key] === value) return;
    snapshot = { ...snapshot, [key]: value };
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setCurrentTime: (time: number) => update('currentTime', time),
    setDuration: (duration: number) => update('duration', duration),
  };
}
