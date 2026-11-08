export type PlayerVolumeShortcut = 'increase' | 'decrease';
export type PlayerTempoShortcut = 'increase' | 'decrease';

export function isVirtualKeyboardDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const deviceNavigator = window.navigator;
  const touchPoints = deviceNavigator?.maxTouchPoints ?? 0;
  const hasTouch = touchPoints > 0 || 'ontouchstart' in window;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const cannotHover = window.matchMedia?.('(hover: none)').matches ?? false;
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(deviceNavigator?.userAgent ?? '');
  const desktopModeIPad = deviceNavigator?.platform === 'MacIntel' && touchPoints > 1;
  return coarsePointer || (cannotHover && hasTouch) || mobileUserAgent || desktopModeIPad;
}

type PlayerShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'
>;

export function getPlayerVolumeShortcut(
  event: PlayerShortcutEvent
): PlayerVolumeShortcut | null {
  if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return null;

  if (event.key === '+' || event.code === 'Equal' || event.code === 'NumpadAdd') {
    return 'increase';
  }
  if (event.key === '_' || event.code === 'Minus' || event.code === 'NumpadSubtract') {
    return 'decrease';
  }
  return null;
}

export function isPlayerVocalCutShortcut(event: PlayerShortcutEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  return event.key === '*' || event.code === 'NumpadMultiply';
}

export function isPlayerAutoLevelShortcut(event: PlayerShortcutEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  return event.key === '/' || event.code === 'NumpadDivide';
}

export function getPlayerTempoShortcut(
  event: PlayerShortcutEvent
): PlayerTempoShortcut | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === 'PageUp' || event.code === 'PageUp') return 'increase';
  if (event.key === 'PageDown' || event.code === 'PageDown') return 'decrease';
  return null;
}

export function adjustPlayerVolume(
  volume: number,
  shortcut: PlayerVolumeShortcut
): number {
  const normalizedVolume = Number.isFinite(volume) ? Math.round(volume) : 0;
  const nextVolume = normalizedVolume + (shortcut === 'increase' ? 1 : -1);
  return Math.min(100, Math.max(0, nextVolume));
}

export function shouldMutePlayer(volume: number, isMuted: boolean): boolean {
  return isMuted || volume <= 0;
}
