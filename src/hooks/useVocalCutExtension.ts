'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  INITIAL_VOCAL_CUT_STATE,
  VOCAL_CUT_BRIDGE_VERSION,
  VOCAL_CUT_PAGE_SOURCE,
  isVocalCutExtensionMessage,
  isVocalCutExtensionState,
  type VocalCutExtensionState,
  type VocalCutPreset,
  type VocalCutResult,
} from '@/lib/vocal-cut-bridge';

const EXTENSION_DETECTION_MS = 1200;

interface ExtensionResponse {
  ok?: boolean;
  error?: string;
  state?: VocalCutExtensionState;
}

function createRequestId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useVocalCutExtension(
  youtubeVideoId: string | null,
  playerVolume: number,
  playerMuted: boolean
) {
  const [state, setState] = useState<VocalCutExtensionState>(INITIAL_VOCAL_CUT_STATE);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasRequestedFeedback, setHasRequestedFeedback] = useState(false);
  const [feedbackVideoId, setFeedbackVideoId] = useState<string | null>(null);
  const extensionSeenRef = useRef(false);

  const postToExtension = useCallback((type: string, payload?: Record<string, unknown>) => {
    window.postMessage({
      source: VOCAL_CUT_PAGE_SOURCE,
      version: VOCAL_CUT_BRIDGE_VERSION,
      type,
      payload,
      requestId: createRequestId(),
    }, window.location.origin);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (!isVocalCutExtensionMessage(event.data)) return;

      extensionSeenRef.current = true;
      const message = event.data;
      if (message.type === 'EXTENSION_READY') {
        setState((current) => ({
          ...current,
          captureStatus: current.captureStatus === 'checking' || current.captureStatus === 'not_installed'
            ? 'installed_idle'
            : current.captureStatus,
        }));
        postToExtension('REQUEST_STATUS');
        return;
      }

      const response = message.payload as ExtensionResponse | undefined;
      if (response?.state && isVocalCutExtensionState(response.state)) {
        setState((current) => ({ ...current, ...response.state }));
      }
      if (message.type === 'EXTENSION_RESPONSE' && response?.ok === false && response.error) {
        setNotice(response.error);
      } else if (message.type === 'STATE_CHANGED' || response?.ok === true) {
        setNotice(null);
      }
    };

    window.addEventListener('message', handleMessage);
    postToExtension('PLAYER_HELLO');
    const timer = window.setTimeout(() => {
      if (extensionSeenRef.current) return;
      setState((current) => ({ ...current, captureStatus: 'not_installed' }));
    }, EXTENSION_DETECTION_MS);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', handleMessage);
    };
  }, [postToExtension]);

  useEffect(() => {
    postToExtension('TRACK_CHANGED', { youtubeVideoId });
  }, [postToExtension, youtubeVideoId]);

  useEffect(() => {
    if (!state.supportsLoudnessNormalize) return;
    postToExtension('SET_PLAYER_VOLUME', { volume: playerVolume, muted: playerMuted });
  }, [playerMuted, playerVolume, postToExtension, state.supportsLoudnessNormalize]);

  const toggle = useCallback(() => {
    setFeedbackVideoId(youtubeVideoId);
    setHasRequestedFeedback(true);
    setNotice(null);
    if (state.captureStatus === 'checking') {
      setNotice('กำลังตรวจหา Vocal Cut Extension…');
      return;
    }
    if (state.captureStatus === 'not_installed') {
      setNotice('ยังไม่ได้ติดตั้ง Vocal Cut Extension');
      return;
    }
    if (state.captureStatus === 'installed_idle' || state.captureStatus === 'error') {
      setNotice('คลิกไอคอน Extension เพื่อเปิดระบบเสียงก่อน');
      return;
    }
    if (!youtubeVideoId) {
      setNotice('ยังไม่มีเพลงกำลังเล่น');
      return;
    }
    postToExtension('TOGGLE_VOCAL_CUT');
  }, [postToExtension, state.captureStatus, youtubeVideoId]);

  const submitResult = useCallback((result: VocalCutResult) => {
    if (!youtubeVideoId) return;
    postToExtension('SUBMIT_VOCAL_CUT_RESULT', { youtubeVideoId, result });
  }, [postToExtension, youtubeVideoId]);

  const setPreset = useCallback((preset: VocalCutPreset) => {
    postToExtension('SET_VOCAL_CUT_PRESET', { preset });
  }, [postToExtension]);

  const toggleNormalize = useCallback(() => {
    setNotice(null);
    if (state.captureStatus === 'checking') {
      setNotice('กำลังตรวจหา Audio Extension…');
      return;
    }
    if (state.captureStatus === 'not_installed') {
      setNotice('ยังไม่ได้ติดตั้ง Audio Extension');
      return;
    }
    if (state.captureStatus === 'installed_idle' || state.captureStatus === 'error') {
      setNotice('คลิกไอคอน Extension เพื่อเปิดระบบเสียงก่อน');
      return;
    }
    postToExtension('TOGGLE_LOUDNESS_NORMALIZE');
  }, [postToExtension, state.captureStatus]);

  return {
    state,
    notice,
    hasRequestedFeedback: hasRequestedFeedback && feedbackVideoId === youtubeVideoId,
    toggle,
    submitResult,
    setPreset,
    toggleNormalize,
  };
}
