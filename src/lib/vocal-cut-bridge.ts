export const VOCAL_CUT_BRIDGE_VERSION = 1;
export const VOCAL_CUT_PAGE_SOURCE = 'karaoke-hub-page';
export const VOCAL_CUT_EXTENSION_SOURCE = 'karaoke-hub-vocal-cut-extension';

export type VocalCutCaptureStatus =
  | 'checking'
  | 'not_installed'
  | 'installed_idle'
  | 'starting'
  | 'capturing_original'
  | 'capturing_vocal_cut'
  | 'unsupported_mono'
  | 'recovering'
  | 'error';

export type VocalCutResult = 'good' | 'fair' | 'bad';
export type VocalCutPreset = 'balanced' | 'strong' | 'maximum';
export type LoudnessNormalizeStatus =
  | 'off'
  | 'warming'
  | 'active'
  | 'silence_hold'
  | 'limited'
  | 'error';

export interface VocalCutPreference {
  schemaVersion: 1;
  youtubeVideoId: string;
  vocalPresence: 'unknown' | 'reported_present' | 'reported_absent';
  lastResult: VocalCutResult | null;
  lastPreset: VocalCutPreset | 'hard';
  usageCount: number;
  updatedAt: string;
}

export interface VocalCutExtensionState {
  captureStatus: VocalCutCaptureStatus;
  enabled: boolean;
  monoLike: boolean;
  inputChannelCount: number | null;
  correlation: number | null;
  sideRatio: number | null;
  adaptiveCenterConfidence: number | null;
  adaptiveCenterGain: number | null;
  preset: VocalCutPreset;
  supportsLoudnessNormalize: boolean;
  normalizeEnabled: boolean;
  normalizeStatus: LoudnessNormalizeStatus;
  measuredLoudnessDb: number | null;
  normalizationGainDb: number | null;
  limiterReductionDb: number | null;
  playerVolume: number;
  lastError: string | null;
  currentVideoId: string | null;
  preference: VocalCutPreference | null;
}

export const INITIAL_VOCAL_CUT_STATE: VocalCutExtensionState = {
  captureStatus: 'checking',
  enabled: false,
  monoLike: false,
  inputChannelCount: null,
  correlation: null,
  sideRatio: null,
  adaptiveCenterConfidence: null,
  adaptiveCenterGain: null,
  preset: 'balanced',
  supportsLoudnessNormalize: false,
  normalizeEnabled: false,
  normalizeStatus: 'off',
  measuredLoudnessDb: null,
  normalizationGainDb: null,
  limiterReductionDb: null,
  playerVolume: 85,
  lastError: null,
  currentVideoId: null,
  preference: null,
};

export function isVocalCutExtensionMessage(value: unknown): value is {
  source: typeof VOCAL_CUT_EXTENSION_SOURCE;
  version: typeof VOCAL_CUT_BRIDGE_VERSION;
  type: string;
  payload?: unknown;
  requestId?: string;
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.source === VOCAL_CUT_EXTENSION_SOURCE
    && candidate.version === VOCAL_CUT_BRIDGE_VERSION
    && typeof candidate.type === 'string'
  );
}

export function isVocalCutExtensionState(value: unknown): value is VocalCutExtensionState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.captureStatus === 'string'
    && typeof candidate.enabled === 'boolean'
    && typeof candidate.monoLike === 'boolean'
  );
}
