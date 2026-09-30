'use client';

import { useEffect, useState } from 'react';
import type { YouTubeVideo } from './types';
import { isDirectVideoQuery, previewCatalog } from './youtube-search-client';

export function useCatalogPreview(query: string, enabled: boolean, onResults: (videos: YouTubeVideo[]) => void): string {
  const [failure, setFailure] = useState<{ query: string; message: string } | null>(null);
  useEffect(() => {
    if (!enabled || query.trim().length < 2 || query.length > 250 || isDirectVideoQuery(query)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void previewCatalog(query, controller.signal).then((videos) => {
        if (controller.signal.aborted) return;
        onResults(videos);
        setFailure(null);
      }).catch(() => {
        if (!controller.signal.aborted) setFailure({ query, message: 'คลังเพลงยังไม่พร้อมใช้งาน • ไม่มีการค้น YouTube อัตโนมัติ' });
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, enabled, onResults]);
  return enabled && failure?.query === query ? failure.message : '';
}
