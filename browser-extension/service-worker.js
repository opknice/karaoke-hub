import {
  DEFAULT_AUDIO_STATE,
  normalizeLoudnessStatus,
  normalizePlayerVolume,
  normalizeResult,
  normalizePreset,
  normalizeVideoId,
  isSupportedPlayerUrl,
} from './messages.mjs';

const OFFSCREEN_URL = 'offscreen.html';
const SESSION_STATE_KEY = 'vocalCutSessionState';
const VIDEO_PREFERENCE_PREFIX = 'videoPreference:';
const LOUDNESS_ENABLED_KEY = 'loudnessNormalizeEnabled';

async function getSessionState() {
  const stored = await chrome.storage.session.get(SESSION_STATE_KEY);
  return { ...DEFAULT_AUDIO_STATE, ...(stored[SESSION_STATE_KEY] ?? {}) };
}

async function setSessionState(patch) {
  const nextState = { ...(await getSessionState()), ...patch };
  await chrome.storage.session.set({ [SESSION_STATE_KEY]: nextState });
  return nextState;
}

async function getLoudnessEnabledPreference() {
  const stored = await chrome.storage.local.get(LOUDNESS_ENABLED_KEY);
  return stored[LOUDNESS_ENABLED_KEY] === true;
}

async function setLoudnessEnabledPreference(enabled) {
  await chrome.storage.local.set({ [LOUDNESS_ENABLED_KEY]: Boolean(enabled) });
}

function isCaptureActive(state, tabId) {
  return state.tabId === tabId
    && ['capturing_original', 'capturing_vocal_cut', 'unsupported_mono'].includes(state.captureStatus);
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });
  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Process and play the captured KARAOKE.HUB player tab audio locally.',
  });
}

function preferenceKey(videoId) {
  return `${VIDEO_PREFERENCE_PREFIX}${videoId}`;
}

async function getPreference(videoId) {
  if (!videoId) return null;
  const key = preferenceKey(videoId);
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

async function savePreference(videoId, result, preset = 'balanced') {
  const normalizedResult = normalizeResult(result);
  if (!videoId || !normalizedResult) return null;
  const key = preferenceKey(videoId);
  const existing = await getPreference(videoId);
  const preference = {
    schemaVersion: 1,
    youtubeVideoId: videoId,
    vocalPresence: 'reported_present',
    lastResult: normalizedResult,
    lastPreset: normalizePreset(preset) ?? 'balanced',
    usageCount: (existing?.usageCount ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [key]: preference });
  return preference;
}

async function sendToAudioHost(message) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ target: 'offscreen', ...message });
}

async function broadcastState(tabId, state) {
  if (!Number.isInteger(tabId)) return;
  await chrome.tabs.sendMessage(tabId, {
    target: 'content-script',
    type: 'STATE_CHANGED',
    payload: { state },
  }).catch(() => {});
}

async function updateActionBadge(state) {
  const text = state.captureStatus === 'capturing_vocal_cut'
    ? 'CUT'
    : state.captureStatus === 'capturing_original'
      ? 'ON'
      : state.captureStatus === 'error'
        ? 'ERR'
        : '';
  const color = state.captureStatus === 'capturing_vocal_cut'
    ? '#9333ea'
    : state.captureStatus === 'error'
      ? '#e11d48'
      : '#0891b2';
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
}

async function stopCurrentCapture() {
  const state = await getSessionState();
  await sendToAudioHost({ type: 'STOP_CAPTURE' }).catch(() => {});
  const nextState = await setSessionState({
    captureStatus: 'installed_idle',
    enabled: false,
    monoLike: false,
    inputChannelCount: null,
    correlation: null,
    sideRatio: null,
    adaptiveCenterConfidence: null,
    adaptiveCenterGain: null,
    normalizeStatus: 'off',
    measuredLoudnessDb: null,
    normalizationGainDb: null,
    limiterReductionDb: null,
    lastError: null,
    tabId: null,
  });
  await updateActionBadge(nextState);
  await broadcastState(state.tabId, nextState);
}

chrome.action.onClicked.addListener((tab) => {
  void (async () => {
    if (!Number.isInteger(tab.id) || !isSupportedPlayerUrl(tab.url)) {
      await chrome.action.setBadgeBackgroundColor({ color: '#e11d48' });
      await chrome.action.setBadgeText({ text: 'URL' });
      return;
    }

    const state = await getSessionState();
    if (state.tabId === tab.id && state.captureStatus !== 'installed_idle' && state.captureStatus !== 'error') {
      await stopCurrentCapture();
      return;
    }
    if (Number.isInteger(state.tabId)) await stopCurrentCapture();

    const normalizeEnabled = await getLoudnessEnabledPreference();
    const startingState = await setSessionState({
      captureStatus: 'starting',
      enabled: false,
      monoLike: false,
      inputChannelCount: null,
      correlation: null,
      sideRatio: null,
      adaptiveCenterConfidence: null,
      adaptiveCenterGain: null,
      normalizeEnabled,
      normalizeStatus: 'off',
      measuredLoudnessDb: null,
      normalizationGainDb: null,
      limiterReductionDb: null,
      lastError: null,
      tabId: tab.id,
    });
    await broadcastState(tab.id, startingState);

    try {
      await ensureOffscreenDocument();
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'START_CAPTURE',
        streamId,
        tabId: tab.id,
      });
      if (!response?.ok) throw new Error(response?.error ?? 'Unable to start tab capture.');
      await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'SET_PRESET',
        preset: startingState.preset,
      });
      await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'SET_PLAYER_VOLUME',
        volume: startingState.playerVolume,
        muted: startingState.playerMuted === true,
      });
      await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'SET_LOUDNESS_NORMALIZE',
        enabled: normalizeEnabled,
      });
    } catch (error) {
      const nextState = await setSessionState({
        captureStatus: 'error',
        enabled: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
      await updateActionBadge(nextState);
      await broadcastState(tab.id, nextState);
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const state = await getSessionState();
    if (state.tabId === tabId) await stopCurrentCapture();
  })();
});

async function handlePageMessage(message, sender) {
  if (!sender.tab?.id || !isSupportedPlayerUrl(sender.tab.url)) {
    return { ok: false, error: 'Untrusted player tab.' };
  }

  const tabId = sender.tab.id;
  const payload = message.payload ?? {};
  switch (message.type) {
    case 'PLAYER_HELLO':
    case 'REQUEST_STATUS': {
      const state = await getSessionState();
      return { ok: true, state };
    }
    case 'TRACK_CHANGED': {
      const videoId = normalizeVideoId(payload.youtubeVideoId);
      const state = await getSessionState();
      if (state.tabId === tabId && state.enabled) {
        await sendToAudioHost({ type: 'SET_VOCAL_CUT', enabled: false });
      }
      if (isCaptureActive(state, tabId)) {
        await sendToAudioHost({ type: 'RESET_LOUDNESS', preserveGain: false });
      }
      const preference = await getPreference(videoId);
      const preferredPreset = normalizePreset(preference?.lastPreset) ?? state.preset;
      if (state.tabId === tabId && ['capturing_original', 'capturing_vocal_cut', 'unsupported_mono'].includes(state.captureStatus)) {
        await sendToAudioHost({ type: 'SET_PRESET', preset: preferredPreset });
      }
      const nextState = await setSessionState({
        currentVideoId: videoId,
        enabled: false,
        preference,
        preset: preferredPreset,
        normalizeStatus: state.normalizeEnabled ? 'warming' : 'off',
        measuredLoudnessDb: null,
        normalizationGainDb: state.normalizeEnabled ? 0 : null,
        limiterReductionDb: null,
        captureStatus: state.captureStatus === 'capturing_vocal_cut'
          ? 'capturing_original'
          : state.captureStatus,
      });
      await broadcastState(tabId, nextState);
      return { ok: true, state: nextState };
    }
    case 'TOGGLE_LOUDNESS_NORMALIZE': {
      const state = await getSessionState();
      if (!isCaptureActive(state, tabId)) {
        return { ok: false, error: 'คลิกไอคอน Extension เพื่อเปิดระบบเสียงก่อน', state };
      }
      const normalizeEnabled = !state.normalizeEnabled;
      const response = await sendToAudioHost({
        type: 'SET_LOUDNESS_NORMALIZE',
        enabled: normalizeEnabled,
      });
      if (!response?.ok) {
        return { ok: false, error: 'ไม่สามารถสลับ Auto Level ได้', state };
      }
      await setLoudnessEnabledPreference(normalizeEnabled);
      const nextState = await setSessionState({
        normalizeEnabled,
        normalizeStatus: normalizeEnabled ? 'warming' : 'off',
        measuredLoudnessDb: null,
        normalizationGainDb: normalizeEnabled ? 0 : null,
        limiterReductionDb: null,
      });
      await broadcastState(tabId, nextState);
      return { ok: true, state: nextState };
    }
    case 'SET_PLAYER_VOLUME': {
      const state = await getSessionState();
      const playerVolume = normalizePlayerVolume(payload.volume);
      if (playerVolume === null || typeof payload.muted !== 'boolean') {
        return { ok: false, error: 'ระดับเสียง Player ไม่ถูกต้อง', state };
      }
      const nextState = await setSessionState({
        playerVolume,
        playerMuted: payload.muted,
      });
      if (isCaptureActive(nextState, tabId)) {
        await sendToAudioHost({
          type: 'SET_PLAYER_VOLUME',
          volume: playerVolume,
          muted: payload.muted,
        });
      }
      return { ok: true, state: nextState };
    }
    case 'TOGGLE_VOCAL_CUT': {
      const state = await getSessionState();
      if (state.tabId !== tabId || !['capturing_original', 'capturing_vocal_cut', 'unsupported_mono'].includes(state.captureStatus)) {
        return { ok: false, error: 'คลิกไอคอน Extension เพื่อเปิดระบบเสียงก่อน', state };
      }
      const enabled = !state.enabled;
      const response = await sendToAudioHost({ type: 'SET_VOCAL_CUT', enabled });
      if (!response?.ok) {
        return { ok: false, error: 'ไม่สามารถสลับ Vocal Cut ได้', state };
      }
      const nextState = await setSessionState({
        enabled,
        captureStatus: enabled ? 'capturing_vocal_cut' : 'capturing_original',
      });
      await updateActionBadge(nextState);
      await broadcastState(tabId, nextState);
      return { ok: true, state: nextState };
    }
    case 'SET_VOCAL_CUT_PRESET': {
      const preset = normalizePreset(payload.preset);
      const state = await getSessionState();
      if (!preset) return { ok: false, error: 'ระดับ Vocal Cut ไม่ถูกต้อง', state };
      if (state.tabId !== tabId || !['capturing_original', 'capturing_vocal_cut', 'unsupported_mono'].includes(state.captureStatus)) {
        return { ok: false, error: 'คลิกไอคอน Extension เพื่อเปิดระบบเสียงก่อน', state };
      }
      const response = await sendToAudioHost({ type: 'SET_PRESET', preset });
      if (!response?.ok) return { ok: false, error: 'ไม่สามารถเปลี่ยนระดับ Vocal Cut ได้', state };
      const nextState = await setSessionState({ preset });
      await broadcastState(tabId, nextState);
      return { ok: true, state: nextState };
    }
    case 'SUBMIT_VOCAL_CUT_RESULT': {
      const state = await getSessionState();
      const videoId = normalizeVideoId(payload.youtubeVideoId) ?? state.currentVideoId;
      const preference = await savePreference(videoId, payload.result, state.preset);
      if (!preference) return { ok: false, error: 'ผลประเมินไม่ถูกต้อง', state };
      const nextState = await setSessionState({ preference });
      await broadcastState(tabId, nextState);
      return { ok: true, state: nextState };
    }
    default:
      return { ok: false, error: 'Unsupported player message.' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'service-worker') return false;

  const task = message.type === 'AUDIO_EVENT'
    ? (async () => {
        const current = await getSessionState();
        if (Number.isInteger(message.payload?.tabId) && Number.isInteger(current.tabId) && message.payload.tabId !== current.tabId) {
          return { ok: false };
        }
        const payload = message.payload ?? {};
        const metric = (name) => {
          if (!Object.hasOwn(payload, name)) return current[name];
          return Number.isFinite(payload[name]) ? payload[name] : null;
        };
        const nextCaptureStatus = message.payload?.captureStatus ?? current.captureStatus;
        const nextState = await setSessionState({
          captureStatus: nextCaptureStatus,
          enabled: message.payload?.enabled === true,
          monoLike: message.payload?.monoLike === true,
          inputChannelCount: Number.isFinite(message.payload?.inputChannelCount)
            ? message.payload.inputChannelCount
            : current.inputChannelCount,
          correlation: Number.isFinite(message.payload?.correlation)
            ? message.payload.correlation
            : current.correlation,
          sideRatio: Number.isFinite(message.payload?.sideRatio)
            ? message.payload.sideRatio
            : current.sideRatio,
          adaptiveCenterConfidence: Number.isFinite(message.payload?.adaptiveCenterConfidence)
            ? message.payload.adaptiveCenterConfidence
            : current.adaptiveCenterConfidence,
          adaptiveCenterGain: Number.isFinite(message.payload?.adaptiveCenterGain)
            ? message.payload.adaptiveCenterGain
            : current.adaptiveCenterGain,
          preset: normalizePreset(message.payload?.preset) ?? current.preset,
          normalizeEnabled: typeof payload.normalizeEnabled === 'boolean'
            ? payload.normalizeEnabled
            : current.normalizeEnabled,
          normalizeStatus: normalizeLoudnessStatus(payload.normalizeStatus)
            ?? current.normalizeStatus,
          measuredLoudnessDb: metric('measuredLoudnessDb'),
          normalizationGainDb: metric('normalizationGainDb'),
          limiterReductionDb: metric('limiterReductionDb'),
          playerVolume: normalizePlayerVolume(payload.playerVolume) ?? current.playerVolume,
          lastError: message.payload?.lastError ?? null,
          tabId: nextCaptureStatus === 'installed_idle' ? null : current.tabId,
        });
        await updateActionBadge(nextState);
        await broadcastState(current.tabId, nextState);
        return { ok: true, state: nextState };
      })()
    : handlePageMessage(message, sender);

  void task.then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});
