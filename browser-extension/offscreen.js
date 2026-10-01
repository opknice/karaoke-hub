import { assessStereoInput } from './dsp-core.mjs';

const TARGET = 'offscreen';
const CROSSFADE_SECONDS = 0.06;

let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let workletNode = null;
let normalizerNode = null;
let limiterNode = null;
let activeTabId = null;
let vocalCutEnabled = false;
let normalizeEnabled = false;
let currentPlayerVolume = 85;
let currentPlayerMuted = false;
let lastMonoLike = false;
let lastInputChannelCount = null;
let lastAnalysisSignature = null;
let currentPreset = 'balanced';
let stereoAssessmentHistory = [];

function sendAudioEvent(payload) {
  void chrome.runtime.sendMessage({
    target: 'service-worker',
    type: 'AUDIO_EVENT',
    payload: { tabId: activeTabId, ...payload },
  }).catch(() => {});
}

async function stopCapture(notify = true) {
  const stoppedTabId = activeTabId;
  activeTabId = null;
  vocalCutEnabled = false;
  lastMonoLike = false;
  lastInputChannelCount = null;
  lastAnalysisSignature = null;
  stereoAssessmentHistory = [];

  if (workletNode) {
    workletNode.port.onmessage = null;
    workletNode.disconnect();
    workletNode = null;
  }
  if (normalizerNode) {
    normalizerNode.port.onmessage = null;
    normalizerNode.disconnect();
    normalizerNode = null;
  }
  if (limiterNode) {
    limiterNode.disconnect();
    limiterNode = null;
  }
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.onended = null;
      track.stop();
    }
    mediaStream = null;
  }
  if (audioContext) {
    await audioContext.close().catch(() => {});
    audioContext = null;
  }

  if (notify && stoppedTabId !== null) {
    sendAudioEvent({ captureStatus: 'installed_idle', enabled: false, monoLike: false });
  }
}

function setVocalCut(enabled) {
  if (!audioContext || !workletNode) return false;

  vocalCutEnabled = Boolean(enabled);
  const mix = workletNode.parameters.get('mix');
  if (!mix) return false;
  const now = audioContext.currentTime;
  mix.cancelScheduledValues(now);
  mix.setValueAtTime(mix.value, now);
  mix.linearRampToValueAtTime(vocalCutEnabled ? 1 : 0, now + CROSSFADE_SECONDS);
  normalizerNode?.port.postMessage({ type: 'RESET', preserveGain: true });
  sendAudioEvent({
    captureStatus: vocalCutEnabled ? 'capturing_vocal_cut' : 'capturing_original',
    enabled: vocalCutEnabled,
    monoLike: lastMonoLike,
    inputChannelCount: lastInputChannelCount,
    preset: currentPreset,
  });
  return true;
}

function setLoudnessNormalize(enabled) {
  if (!audioContext || !normalizerNode) return false;
  normalizeEnabled = Boolean(enabled);
  normalizerNode.port.postMessage({ type: 'SET_ENABLED', enabled: normalizeEnabled });
  if (limiterNode) {
    limiterNode.threshold.setTargetAtTime(
      normalizeEnabled ? -1 : 0,
      audioContext.currentTime,
      0.03,
    );
  }
  sendAudioEvent({
    captureStatus: vocalCutEnabled ? 'capturing_vocal_cut' : 'capturing_original',
    enabled: vocalCutEnabled,
    normalizeEnabled,
    normalizeStatus: normalizeEnabled ? 'warming' : 'off',
  });
  return true;
}

function setPlayerVolume(volume, muted) {
  currentPlayerVolume = Math.min(100, Math.max(0, Number.isFinite(volume) ? volume : 0));
  currentPlayerMuted = Boolean(muted);
  normalizerNode?.port.postMessage({
    type: 'SET_PLAYER_VOLUME',
    volume: currentPlayerVolume,
    muted: currentPlayerMuted,
  });
  return Boolean(normalizerNode);
}

function resetLoudness(preserveGain = false) {
  if (!normalizerNode) return false;
  normalizerNode.port.postMessage({ type: 'RESET', preserveGain });
  return true;
}

async function startCapture(streamId, tabId) {
  await stopCapture(false);
  activeTabId = tabId;
  sendAudioEvent({ captureStatus: 'starting', enabled: false, monoLike: false });

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    const [audioTrack] = mediaStream.getAudioTracks();
    if (audioTrack) {
      const capabilities = audioTrack.getCapabilities?.() ?? {};
      const constraints = {};
      if (capabilities.channelCount) constraints.channelCount = { ideal: 2 };
      if (capabilities.echoCancellation) constraints.echoCancellation = false;
      if (capabilities.noiseSuppression) constraints.noiseSuppression = false;
      if (capabilities.autoGainControl) constraints.autoGainControl = false;
      if (Object.keys(constraints).length > 0) {
        await audioTrack.applyConstraints(constraints).catch(() => {});
      }
      console.info('[KARAOKE.HUB Vocal Cut] Captured tab audio track', audioTrack.getSettings());
    }

    audioContext = new AudioContext({ latencyHint: 'interactive' });
    await Promise.all([
      audioContext.audioWorklet.addModule(
        chrome.runtime.getURL('center-attenuation-processor.js'),
      ),
      audioContext.audioWorklet.addModule(
        chrome.runtime.getURL('loudness-normalizer-processor.js'),
      ),
    ]);
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, 'center-attenuation-processor', {
      channelCount: 2,
      channelCountMode: 'max',
      channelInterpretation: 'speakers',
      outputChannelCount: [2],
    });
    normalizerNode = new AudioWorkletNode(audioContext, 'loudness-normalizer-processor', {
      channelCount: 2,
      channelCountMode: 'max',
      channelInterpretation: 'speakers',
      outputChannelCount: [2],
    });
    limiterNode = audioContext.createDynamicsCompressor();
    limiterNode.threshold.value = normalizeEnabled ? -1 : 0;
    limiterNode.knee.value = 1;
    limiterNode.ratio.value = 20;
    limiterNode.attack.value = 0.005;
    limiterNode.release.value = 0.2;
    workletNode.port.onmessage = (event) => {
      if (event.data?.type !== 'ANALYSIS') return;
      const metrics = event.data.metrics ?? {};
      const inputChannelCount = Number.isFinite(metrics.inputChannelCount)
        ? metrics.inputChannelCount
        : audioTrack?.getSettings().channelCount ?? null;
      const assessment = assessStereoInput(metrics, inputChannelCount ?? 0);
      stereoAssessmentHistory.push(assessment.limited);
      if (stereoAssessmentHistory.length > 5) stereoAssessmentHistory.shift();
      const persistentLowSide = stereoAssessmentHistory.length === 5
        && stereoAssessmentHistory.filter(Boolean).length >= 4;
      lastMonoLike = inputChannelCount === 1 || persistentLowSide;
      lastInputChannelCount = inputChannelCount;

      const analysisSignature = `${inputChannelCount}:${assessment.reason ?? 'stereo'}`;
      if (analysisSignature !== lastAnalysisSignature) {
        lastAnalysisSignature = analysisSignature;
        console.info('[KARAOKE.HUB Vocal Cut] Stereo analysis', {
          inputChannelCount,
          correlation: metrics.correlation,
          sideRatio: metrics.sideRatio,
          limited: assessment.limited,
          reason: assessment.reason,
        });
      }
      sendAudioEvent({
        captureStatus: vocalCutEnabled ? 'capturing_vocal_cut' : 'capturing_original',
        enabled: vocalCutEnabled,
        monoLike: lastMonoLike,
        inputChannelCount,
        correlation: metrics.correlation,
        sideRatio: metrics.sideRatio,
        adaptiveCenterConfidence: metrics.adaptiveCenterConfidence,
        adaptiveCenterGain: metrics.adaptiveCenterGain,
        preset: currentPreset,
      });
    };

    normalizerNode.port.onmessage = (event) => {
      if (event.data?.type !== 'LOUDNESS_ANALYSIS') return;
      const metrics = event.data.metrics ?? {};
      sendAudioEvent({
        captureStatus: vocalCutEnabled ? 'capturing_vocal_cut' : 'capturing_original',
        enabled: vocalCutEnabled,
        normalizeEnabled,
        normalizeStatus: metrics.normalizeStatus,
        measuredLoudnessDb: metrics.measuredLoudnessDb,
        normalizationGainDb: metrics.normalizationGainDb,
        limiterReductionDb: Number.isFinite(limiterNode?.reduction)
          ? limiterNode.reduction
          : null,
        playerVolume: currentPlayerVolume,
      });
    };

    sourceNode.connect(workletNode).connect(normalizerNode).connect(limiterNode).connect(audioContext.destination);
    setPlayerVolume(currentPlayerVolume, currentPlayerMuted);
    normalizerNode.port.postMessage({ type: 'SET_ENABLED', enabled: normalizeEnabled });
    if (audioTrack) {
      audioTrack.onended = () => {
        void stopCapture(true);
      };
    }
    await audioContext.resume();
    sendAudioEvent({
      captureStatus: 'capturing_original',
      enabled: false,
      monoLike: false,
      normalizeEnabled,
      normalizeStatus: normalizeEnabled ? 'warming' : 'off',
      playerVolume: currentPlayerVolume,
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start tab audio capture.';
    await stopCapture(false);
    activeTabId = tabId;
    sendAudioEvent({ captureStatus: 'error', enabled: false, monoLike: false, lastError: message });
    return { ok: false, error: message };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== TARGET) return false;

  const respond = async () => {
    switch (message.type) {
      case 'START_CAPTURE':
        return startCapture(message.streamId, message.tabId);
      case 'STOP_CAPTURE':
        await stopCapture(true);
        return { ok: true };
      case 'SET_VOCAL_CUT':
        return { ok: setVocalCut(message.enabled) };
      case 'SET_PRESET':
        if (!['balanced', 'strong', 'maximum'].includes(message.preset)) {
          return { ok: false, error: 'Unsupported Vocal Cut preset.' };
        }
        currentPreset = message.preset;
        workletNode?.port.postMessage({ type: 'SET_PRESET', preset: currentPreset });
        sendAudioEvent({
          captureStatus: vocalCutEnabled ? 'capturing_vocal_cut' : 'capturing_original',
          enabled: vocalCutEnabled,
          monoLike: lastMonoLike,
          inputChannelCount: lastInputChannelCount,
          preset: currentPreset,
        });
        return { ok: Boolean(workletNode), preset: currentPreset };
      case 'SET_LOUDNESS_NORMALIZE':
        return { ok: setLoudnessNormalize(message.enabled), enabled: normalizeEnabled };
      case 'SET_PLAYER_VOLUME':
        return {
          ok: setPlayerVolume(message.volume, message.muted),
          volume: currentPlayerVolume,
          muted: currentPlayerMuted,
        };
      case 'RESET_LOUDNESS':
        return { ok: resetLoudness(message.preserveGain === true) };
      case 'GET_AUDIO_STATUS':
        return {
          ok: true,
          state: {
            tabId: activeTabId,
            captureStatus: audioContext ? (
              vocalCutEnabled ? 'capturing_vocal_cut' : 'capturing_original'
            ) : 'installed_idle',
            enabled: vocalCutEnabled,
            normalizeEnabled,
            normalizeStatus: normalizeEnabled ? 'warming' : 'off',
            playerVolume: currentPlayerVolume,
            monoLike: lastMonoLike,
            inputChannelCount: lastInputChannelCount,
            preset: currentPreset,
          },
        };
      default:
        return { ok: false, error: 'Unsupported offscreen message.' };
    }
  };

  void respond().then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});
