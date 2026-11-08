'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export function usePlayerFullscreen(pageRef: RefObject<HTMLDivElement | null>) {
  const [nativeSupported, setNativeSupported] = useState(false);
  const [nativeActive, setNativeActive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const ownsFullscreen = useRef(false);
  const requestPending = useRef(false);

  useEffect(() => {
    const orientation = window.matchMedia('(orientation: landscape) and (pointer: coarse)');
    const sync = () => {
      const active = Boolean(pageRef.current && document.fullscreenElement === pageRef.current);
      setNativeActive(active);
      setNativeSupported(Boolean(document.fullscreenEnabled && pageRef.current?.requestFullscreen));
      if (!active) ownsFullscreen.current = false;
    };
    const rotate = () => {
      if (!orientation.matches && ownsFullscreen.current && document.fullscreenElement === pageRef.current) {
        void document.exitFullscreen().catch(() => setError('ออกจากเต็มจอไม่สำเร็จ กรุณาลองอีกครั้ง'));
      }
    };
    sync();
    orientation.addEventListener('change', rotate);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      orientation.removeEventListener('change', rotate);
      document.removeEventListener('fullscreenchange', sync);
    };
  }, [pageRef]);

  useEffect(() => {
    if (!expanded) return;
    const closeExpanded = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented
        || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      setExpanded(false);
    };
    document.addEventListener('keydown', closeExpanded);
    return () => document.removeEventListener('keydown', closeExpanded);
  }, [expanded]);

  const toggle = useCallback(async () => {
    if (requestPending.current || !pageRef.current) return;
    setError('');
    if (expanded) { setExpanded(false); return; }
    const page = pageRef.current;
    const active = document.fullscreenElement;
    if (active && active !== page) {
      setError('กรุณาออกจากเต็มจอของหน้าต่างปัจจุบันก่อน');
      return;
    }
    if (!active && (!page.requestFullscreen || !document.fullscreenEnabled)) {
      setExpanded(true);
      return;
    }
    requestPending.current = true;
    setPending(true);
    try {
      if (active === page) {
        await document.exitFullscreen();
      } else {
        ownsFullscreen.current = true;
        // Call in the original click handler, before awaiting anything, to
        // preserve the browser's user-activation requirement.
        await page.requestFullscreen();
      }
      setNativeActive(document.fullscreenElement === page);
      if (document.fullscreenElement !== page) ownsFullscreen.current = false;
    } catch {
      ownsFullscreen.current = document.fullscreenElement === page && ownsFullscreen.current;
      setError('เปลี่ยนโหมดเต็มจอไม่สำเร็จ กรุณาแตะลองอีกครั้ง');
    } finally {
      requestPending.current = false;
      setPending(false);
    }
  }, [expanded, pageRef]);

  return {
    mode: expanded ? 'expanded' : nativeActive ? 'native' : 'windowed',
    active: expanded || nativeActive,
    label: expanded ? 'คืนขนาดเวที' : nativeActive ? 'ออกจากเต็มจอ' : nativeSupported ? 'เต็มจอ' : 'ขยายเวที',
    notice: expanded ? 'ขยายเวทีภายในหน้าเว็บ — เบราว์เซอร์นี้ยังคงแสดงแถบที่อยู่หรือแถบระบบ' : '',
    pending, error, toggle,
  };
}
