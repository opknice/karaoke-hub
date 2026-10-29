'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoVersion } from '@/lib/types';
import { isVideoVersion } from '@/lib/video-version';
import { VOCAL_CUT_PAGE_SOURCE, isVocalCutExtensionMessage } from '@/lib/vocal-cut-bridge';

export function usePlayerSearchVersion() {
  const [version, setVersionState] = useState<VideoVersion>('karaoke');
  const [desktop, setDesktop] = useState(false);
  const desktopRef = useRef(false);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || !isVocalCutExtensionMessage(event.data)) return;
      const next = event.data.payload as {state?:{searchVersion?:unknown}} | undefined;
      if (!isVideoVersion(next?.state?.searchVersion)) return;
      desktopRef.current = true;
      setDesktop(true);
      setVersionState(next.state.searchVersion);
    };
    window.addEventListener('message', receive);
    window.postMessage({source:VOCAL_CUT_PAGE_SOURCE,version:1,type:'REQUEST_STATUS',payload:{}},location.origin);
    return () => window.removeEventListener('message',receive);
  }, []);
  const setVersion = useCallback((next: VideoVersion) => {
    if (desktopRef.current) {
      window.postMessage({source:VOCAL_CUT_PAGE_SOURCE,version:1,type:'SET_SEARCH_VERSION',payload:{version:next}},location.origin);
    } else setVersionState(next);
  }, []);
  return {version,setVersion,desktop};
}
