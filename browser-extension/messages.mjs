export const BRIDGE_VERSION = 1;
export const PAGE_SOURCE = 'karaoke-hub-page';
export const EXTENSION_SOURCE = 'karaoke-hub-vocal-cut-extension';

export const DEFAULT_AUDIO_STATE = Object.freeze({
  captureStatus: 'installed_idle',
  enabled: false,
  monoLike: false,
  inputChannelCount: null,
  correlation: null,
  sideRatio: null,
  adaptiveCenterConfidence: null,
  adaptiveCenterGain: null,
  preset: 'balanced',
  supportsLoudnessNormalize: true,
  normalizeEnabled: false,
  normalizeStatus: 'off',
  measuredLoudnessDb: null,
  normalizationGainDb: null,
  limiterReductionDb: null,
  playerVolume: 85,
  playerMuted: false,
  lastError: null,
  currentVideoId: null,
  preference: null,
});

export function isSupportedPlayerUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  try {
    const url = new URL(rawUrl);
    const isLocal = url.origin === 'http://localhost:3000';
    const isProduction = url.origin === 'https://karaoke-hub.vercel.app';
    return (isLocal || isProduction) && (url.pathname === '/player' || url.pathname === '/player/');
  } catch {
    return false;
  }
}

export function isBridgeEnvelope(value, source) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.source === source
    && value.version === BRIDGE_VERSION
    && typeof value.type === 'string'
  );
}

export function normalizeVideoId(value) {
  return typeof value === 'string' && /^[\w-]{11}$/.test(value) ? value : null;
}

export function normalizeResult(value) {
  return value === 'good' || value === 'fair' || value === 'bad' ? value : null;
}

export function normalizePreset(value) {
  return value === 'balanced' || value === 'strong' || value === 'maximum'
    ? value
    : null;
}

export function normalizeLoudnessStatus(value) {
  return ['off', 'warming', 'active', 'silence_hold', 'limited', 'error'].includes(value)
    ? value
    : null;
}

export function normalizePlayerVolume(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}
