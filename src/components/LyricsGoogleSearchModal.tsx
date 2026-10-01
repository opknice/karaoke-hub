'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Script from 'next/script';
import { ExternalLink, Loader2, Search, X } from 'lucide-react';

type ProgrammableSearchElement = {
  execute: (query: string) => void;
};

type ProgrammableSearchApi = {
  render: (config: { div: string; tag: 'searchresults-only'; gname: string }) => void;
  getElement: (name: string) => ProgrammableSearchElement | null;
};

type GoogleSearchWindow = Window & {
  google?: { search?: { cse?: { element?: ProgrammableSearchApi } } };
};

interface LyricsGoogleSearchModalProps {
  open: boolean;
  query: string;
  onClose: () => void;
}

const SEARCH_ELEMENT_NAME = 'karaoke-lyrics-search';
const SEARCH_CONTAINER_ID = 'karaoke-lyrics-google-results';
const SEARCH_ENGINE_ID = process.env.NEXT_PUBLIC_GOOGLE_PSE_CX?.trim() || 'd5f533aac34ab447f';

export function LyricsGoogleSearchModal({ open, query, onClose }: LyricsGoogleSearchModalProps) {
  const [mounted, setMounted] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptError, setScriptError] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!mounted || !open) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [mounted, open, onClose]);

  useEffect(() => {
    if (!mounted || !open || !scriptReady) return;

    let attempts = 0;
    let renderRequested = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const executeWhenReady = () => {
      const api = (window as GoogleSearchWindow).google?.search?.cse?.element;
      try {
        if (api) {
          let element = api.getElement(SEARCH_ELEMENT_NAME);
          if (!element && !renderRequested) {
            api.render({
              div: SEARCH_CONTAINER_ID,
              tag: 'searchresults-only',
              gname: SEARCH_ELEMENT_NAME,
            });
            renderRequested = true;
            element = api.getElement(SEARCH_ELEMENT_NAME);
          }
          if (element) {
            element.execute(query);
            setScriptError('');
            return;
          }
        }
      } catch {
        // Google may expose its API before its search element is initialized.
      }

      attempts += 1;
      if (attempts < 60) {
        retryTimer = setTimeout(executeWhenReady, 100);
      } else {
        setScriptError('Google Search ใช้เวลาตอบสนองนานเกินไป');
      }
    };

    retryTimer = setTimeout(executeWhenReady, 0);
    return () => clearTimeout(retryTimer);
  }, [mounted, open, query, scriptReady]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lyrics-search-title"
      aria-hidden={!open}
      className={`${open ? 'flex' : 'hidden'} fixed inset-0 z-[60] items-center justify-center bg-black/80 p-3 backdrop-blur-md sm:p-6`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-zinc-700 bg-zinc-950 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id="lyrics-search-title" className="flex items-center gap-2 text-sm font-bold sm:text-base">
              <Search className="h-4 w-4 shrink-0 text-violet-400" />
              ผลค้นหาจากเนื้อเพลง
            </h2>
            <p className="mt-1 truncate text-xs text-zinc-400" title={query}>
              {query}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="ปิดผลค้นหาจากเนื้อเพลง"
            className="shrink-0 rounded-full p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white focus-visible:outline-2 focus-visible:outline-violet-400"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="border-b border-zinc-800 px-4 py-2.5 text-[11px] leading-relaxed text-zinc-400 sm:px-5">
          ดูชื่อเพลงที่อาจตรงจากผลค้นหา แล้วปิดหน้าต่างเพื่อพิมพ์ชื่อเพลงในช่องค้นหาหลัก
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto bg-white p-3 text-zinc-900 sm:p-5">
          <Script
            src={`https://cse.google.com/cse.js?cx=${encodeURIComponent(SEARCH_ENGINE_ID)}`}
            strategy="afterInteractive"
            onReady={() => {
              setScriptError('');
              setScriptReady(true);
            }}
            onError={() => setScriptError('โหลดสคริปต์ Google ไม่สำเร็จ')}
          />
          {scriptError ? (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
              โหลดผลค้นหาจาก Google ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง ({scriptError})
            </div>
          ) : !scriptReady ? (
            <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              กำลังโหลดผลค้นหา…
            </div>
          ) : null}
          <div id={SEARCH_CONTAINER_ID} />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3 text-[11px] text-zinc-500 sm:px-5">
          <span>ผลค้นหามาจากเว็บไซต์เนื้อเพลงที่ตั้งค่าไว้ใน Google</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-zinc-400">
            <ExternalLink className="h-3 w-3" />
            ลิงก์เปิดเว็บต้นทาง
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
