'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Image from 'next/image';
import { Check, ListMusic, Loader2, Music2, Search, Volume2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useKaraoke } from '@/context/KaraokeContext';
import { formatDuration } from '@/lib/queue-algorithm';
import type { YouTubeVideo } from '@/lib/types';
import { searchPlayerKaraoke, getLocalSearchPreview, isDirectVideoQuery, previewCatalog } from '@/lib/youtube-search-client';
import { useLocalCatalog } from '@/lib/use-local-catalog';
import { isYouTubeVideo } from '@/lib/youtube-video-validation';
import { SearchBudgetNotice } from './SearchBudgetNotice';
import { OfficialChannelBadge } from './OfficialChannelBadge';
import { useCatalogPreview } from '@/lib/use-catalog-preview';
import {
  adjustPlayerVolume,
  getPlayerVolumeShortcut,
  isPlayerAutoLevelShortcut,
  isPlayerVocalCutShortcut,
} from '@/lib/player-keyboard';
import {
  rankKaraokeVideos,
  type YouTubeSearchMode,
} from '@/lib/youtube-ranking';
import { PlayerQRGuideCard } from './PlayerQRGuideCard';
import { LyricsGoogleSearchModal } from './LyricsGoogleSearchModal';

type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

interface PlayerSearchOverlayProps {
  onQueueBrowserActiveChange: (isActive: boolean) => void;
  onRestartCurrentSong: () => void;
  onToggleVocalCut: () => void;
  onToggleAutoLevel: () => void;
}

const MAX_VISIBLE_RESULTS = 7;
const MIN_SEARCH_LENGTH = 2;
const SUCCESS_MESSAGE_MS = 1800;

const viewCountFormatter = new Intl.NumberFormat('th-TH', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatViewCount(viewCount: number | undefined): string {
  return viewCount === undefined
    ? 'ไม่ทราบยอดวิว'
    : `${viewCountFormatter.format(viewCount)} views`;
}

function getVideoThumbnailUrl(video: YouTubeVideo): string {
  const fallbackUrl = `https://img.youtube.com/vi/${video.youtube_video_id}/hqdefault.jpg`;
  if (!video.thumbnail_url) return fallbackUrl;

  try {
    const thumbnailUrl = new URL(video.thumbnail_url);
    const isAllowedHost = thumbnailUrl.hostname === 'i.ytimg.com'
      || thumbnailUrl.hostname === 'img.youtube.com';
    const isAllowedPath = thumbnailUrl.pathname.startsWith('/vi/')
      || thumbnailUrl.pathname.startsWith('/vi_webp/');
    return thumbnailUrl.protocol === 'https:' && isAllowedHost && isAllowedPath
      ? thumbnailUrl.toString()
      : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

export function PlayerSearchOverlay({
  onQueueBrowserActiveChange,
  onRestartCurrentSong,
  onToggleVocalCut,
  onToggleAutoLevel,
}: PlayerSearchOverlayProps) {
  const {
    activeRoom,
    addToQueue,
    nowPlaying,
    playQueueItem,
    queue,
    setIsMuted,
    setVolume,
    skipSong,
    volume,
  } = useKaraoke();
  const { nickname } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const lyricsInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef('');
  const catalogModeRef = useRef<'supabase' | 'local'>('supabase');
  const searchModeRef = useRef<YouTubeSearchMode>('song');
  const lyricsUiActiveRef = useRef(false);

  const [query, setQuery] = useState('');
  const [isQueueBrowserOpen, setIsQueueBrowserOpen] = useState(false);
  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null);
  const [mode, setMode] = useState<YouTubeSearchMode>('song');
  const [rawResults, setRawResults] = useState<YouTubeVideo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [volumeFeedback, setVolumeFeedback] = useState<number | null>(null);
  const [searchSource, setSearchSource] = useState<'catalog' | 'youtube'>('catalog');
  const [localResultsActive, setLocalResultsActive] = useState(false);
  const [showLyricsInput, setShowLyricsInput] = useState(false);
  const [lyricsInput, setLyricsInput] = useState('');
  const [submittedLyricsQuery, setSubmittedLyricsQuery] = useState('');
  const [isLyricsModalOpen, setIsLyricsModalOpen] = useState(false);
  const localCatalog = useLocalCatalog((resultQuery, videos) => {
    if (catalogModeRef.current !== 'local' || queryRef.current.trim() !== resultQuery) return;
    setRawResults(videos);
    setSelectedIndex(-1);
    setStatus('idle');
    setLocalResultsActive(true);
    setSearchSource('catalog');
  }, () => {});
  const searchLocalCatalog = localCatalog.search;
  const cancelLocalSearch = localCatalog.cancelSearch;
  const setLocalPanelOpen = localCatalog.setPanelOpen;
  const receivePreview = useCallback((videos: YouTubeVideo[]) => {
    if (catalogModeRef.current !== 'supabase') return;
    setRawResults(videos);
    setSelectedIndex(-1);
  }, []);
  const catalogError = useCatalogPreview(query, localCatalog.initialized && status === 'idle' && localCatalog.mode === 'supabase', receivePreview);

  const trimmedQuery = query.trim();
  const isOpen = query.length > 0 || localCatalog.panelOpen || localCatalog.busy === 'downloading';
  const isQueueBrowserActive = isQueueBrowserOpen && !isOpen;
  const selectedQueueItem =
    queue.find((item) => item.id === selectedQueueItemId) ?? queue[0] ?? null;
  const results = useMemo(
    () => (isDirectVideoQuery(trimmedQuery) ? rawResults : rankKaraokeVideos(rawResults, trimmedQuery, mode, status === 'success')).slice(0, MAX_VISIBLE_RESULTS),
    [mode, rawResults, trimmedQuery, status]
  );
  const selectedSearchResult = results[selectedIndex];
  const activeDescendantId = isQueueBrowserActive
    ? selectedQueueItem ? `player-queue-item-${selectedQueueItem.id}` : undefined
    : selectedSearchResult ? `player-result-${selectedSearchResult.id}` : undefined;

  useEffect(() => {
    onQueueBrowserActiveChange(isQueueBrowserActive);
  }, [isQueueBrowserActive, onQueueBrowserActiveChange]);

  const focusSearchInput = useCallback(() => {
    if (lyricsUiActiveRef.current) return;
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const closeSearch = useCallback(() => {
    requestRef.current?.abort();
    queryRef.current = '';
    setQuery('');
    setLocalPanelOpen(false);
    setIsQueueBrowserOpen(false);
    setSelectedQueueItemId(null);
    setRawResults([]);
    setSelectedIndex(0);
    setStatus('idle');
    setErrorMessage('');
    setLocalResultsActive(false);
    lyricsUiActiveRef.current = false;
    setShowLyricsInput(false);
    setIsLyricsModalOpen(false);
    window.requestAnimationFrame(focusSearchInput);
  }, [focusSearchInput, setLocalPanelOpen]);

  const toggleLyricsInput = useCallback(() => {
    const nextVisible = !showLyricsInput;
    lyricsUiActiveRef.current = nextVisible;
    setShowLyricsInput(nextVisible);
    if (!nextVisible) window.requestAnimationFrame(focusSearchInput);
  }, [focusSearchInput, showLyricsInput]);

  const handleLyricsSearch = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = lyricsInput.trim();
    if (nextQuery.length < MIN_SEARCH_LENGTH) return;
    lyricsUiActiveRef.current = true;
    setSubmittedLyricsQuery(nextQuery);
    setShowLyricsInput(false);
    setIsLyricsModalOpen(true);
  }, [lyricsInput]);

  const closeLyricsModal = useCallback(() => {
    lyricsUiActiveRef.current = false;
    setIsLyricsModalOpen(false);
    window.requestAnimationFrame(focusSearchInput);
  }, [focusSearchInput]);

  const updateQuery = useCallback((value: string) => {
    requestRef.current?.abort();
    queryRef.current = value;
    setQuery(value);
    setIsQueueBrowserOpen(false);
    setSelectedQueueItemId(null);
    setSelectedIndex(-1);
    setErrorMessage('');
    setLocalResultsActive(false);
    if (catalogModeRef.current === 'local') {
      setRawResults([]);
      if (value.trim().length >= MIN_SEARCH_LENGTH && !isDirectVideoQuery(value)) {
        searchLocalCatalog(value.trim(), searchModeRef.current);
      }
    } else {
      setRawResults(getLocalSearchPreview(value));
    }
    setStatus('idle');
    setSearchSource('catalog');
  }, [searchLocalCatalog]);

  useEffect(() => {
    const previous = catalogModeRef.current;
    catalogModeRef.current = localCatalog.mode;
    if (previous === localCatalog.mode && !(localCatalog.mode === 'local' && localCatalog.ready)) return;
    const timer = window.setTimeout(() => {
      requestRef.current?.abort();
      setStatus('idle');
      setSelectedIndex(-1);
      setLocalResultsActive(false);
      setSearchSource('catalog');
      const currentQuery = queryRef.current.trim();
      if (currentQuery.length < MIN_SEARCH_LENGTH) {
        setRawResults([]);
      } else if (localCatalog.mode === 'local') {
        setRawResults([]);
        if (localCatalog.ready && !isDirectVideoQuery(currentQuery)) {
          searchLocalCatalog(currentQuery, searchModeRef.current);
        }
      } else {
        setRawResults(getLocalSearchPreview(currentQuery));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [localCatalog.mode, localCatalog.ready, searchLocalCatalog]);

  const openQueueBrowser = useCallback((direction: 'up' | 'down') => {
    const initialItem = direction === 'down' ? queue[0] : queue[queue.length - 1];
    setSelectedQueueItemId(initialItem?.id ?? null);
    setIsQueueBrowserOpen(true);
  }, [queue]);

  const moveQueueSelection = useCallback((direction: 'up' | 'down') => {
    if (!isQueueBrowserOpen) {
      openQueueBrowser(direction);
      return;
    }

    if (queue.length === 0) {
      setSelectedQueueItemId(null);
      return;
    }

    const selectedIndex = queue.findIndex((item) => item.id === selectedQueueItem?.id);
    const currentIndex = selectedIndex < 0
      ? direction === 'down' ? -1 : queue.length
      : selectedIndex;
    const nextIndex = direction === 'down'
      ? Math.min(queue.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);

    setSelectedQueueItemId(queue[nextIndex]?.id ?? null);
  }, [isQueueBrowserOpen, openQueueBrowser, queue, selectedQueueItem?.id]);

  const closeQueueBrowser = useCallback(() => {
    setIsQueueBrowserOpen(false);
    setSelectedQueueItemId(null);
    window.requestAnimationFrame(focusSearchInput);
  }, [focusSearchInput]);

  useEffect(() => {
    if (!isQueueBrowserOpen || !selectedQueueItem) return;
    document
      .getElementById(`player-queue-item-${selectedQueueItem.id}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [isQueueBrowserOpen, selectedQueueItem]);

  const addSelectedVideo = useCallback(
    async (video: YouTubeVideo): Promise<void> => {
      try {
        let verifiedVideo = video;
        if (localResultsActive && localCatalog.mode === 'local') {
          const response = await fetch(`/api/catalog/verify?id=${encodeURIComponent(video.youtube_video_id)}`, { cache: 'no-store' });
          const payload: unknown = await response.json();
          if (!response.ok || !payload || typeof payload !== 'object' || !('video' in payload) || !isYouTubeVideo(payload.video)) {
            throw new Error('เพลงนี้ไม่อยู่ในคลังออนไลน์แล้ว กรุณาค้นหาใหม่');
          }
          verifiedVideo = payload.video;
        }
        await addToQueue(verifiedVideo, nickname, [nickname]);
        setSuccessMessage(`เพิ่ม “${video.title}” เข้าคิวแล้ว`);
        closeSearch();

        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        successTimerRef.current = setTimeout(() => {
          setSuccessMessage('');
          successTimerRef.current = null;
        }, SUCCESS_MESSAGE_MS);
      } catch (error) {
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'ไม่สามารถเพิ่มเพลงได้');
      }
    },
    [addToQueue, closeSearch, nickname, localResultsActive, localCatalog.mode]
  );

  const activateQueueItem = useCallback(
    async (itemId: string): Promise<void> => {
      try {
        await playQueueItem(itemId);
        closeQueueBrowser();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'ไม่สามารถเล่นเพลงที่เลือกได้');
      }
    },
    [closeQueueBrowser, playQueueItem]
  );

  useEffect(() => {
    focusSearchInput();

    const recaptureFocusFromPlayer = () => {
      window.setTimeout(() => {
        if (document.hasFocus()) focusSearchInput();
      }, 0);
    };

    const recaptureFocusAfterPointer = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement
        && target !== inputRef.current
        && (
          target.isContentEditable
          || target.closest('input, textarea, select, [role="textbox"], [role="dialog"], [data-player-lyrics-ui]')
        )
      ) {
        return;
      }

      window.setTimeout(focusSearchInput, 0);
    };

    window.addEventListener('blur', recaptureFocusFromPlayer);
    document.addEventListener('click', recaptureFocusAfterPointer, true);
    return () => {
      window.removeEventListener('blur', recaptureFocusFromPlayer);
      document.removeEventListener('click', recaptureFocusAfterPointer, true);
    };
  }, [focusSearchInput]);

  const submitSearch = useCallback(async (source: 'catalog' | 'youtube' = 'catalog') => {
    if (requestRef.current && !requestRef.current.signal.aborted) return;
    const normalizedQuery = query.trim();

    if (normalizedQuery.length < MIN_SEARCH_LENGTH) return;

    if (source === 'catalog' && localCatalog.mode === 'local' && !isDirectVideoQuery(normalizedQuery)) {
      if (localResultsActive && rawResults.length > 0) {
        setSelectedIndex(0);
        setStatus('success');
        return;
      }
      if (!localCatalog.ready) {
        setStatus('error');
        setErrorMessage('คลังในเครื่องยังไม่พร้อม กรุณารอสักครู่หรือเลือก Supabase');
        return;
      }
    }

    const controller = new AbortController();
    requestRef.current = controller;
    cancelLocalSearch();
    setStatus('loading');
    setSearchSource(source);
    setErrorMessage('');
    try {
      let onlineSource = source;
      if (source === 'catalog' && localCatalog.mode === 'local' && !isDirectVideoQuery(normalizedQuery)) {
        const catalogVideos = await previewCatalog(normalizedQuery, controller.signal);
        if (controller.signal.aborted) return;
        if (catalogVideos.length > 0) {
          setRawResults(catalogVideos);
          setLocalResultsActive(false);
          setSelectedIndex(0);
          setSearchSource('catalog');
          setStatus('success');
          return;
        }
        onlineSource = 'youtube';
        setSearchSource('youtube');
        setRawResults([]);
      }
      const { videos, source: resultSource } = await searchPlayerKaraoke(
        normalizedQuery, controller.signal, onlineSource, () => {
          setSearchSource('youtube');
          setRawResults([]);
        }
      );
      if (controller.signal.aborted) return;

      setRawResults(videos);
      setLocalResultsActive(false);
      setSelectedIndex(0);
      setSearchSource(resultSource);
      setStatus('success');
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'เกิดข้อผิดพลาดระหว่างค้นหา');
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [query, localCatalog.mode, localCatalog.ready, cancelLocalSearch, localResultsActive, rawResults.length]);

  useEffect(() => {
    return () => {
      requestRef.current?.abort();
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      if (volumeFeedbackTimerRef.current) clearTimeout(volumeFeedbackTimerRef.current);
    };
  }, []);

  const handlePlayerKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.isComposing || event.defaultPrevented) return;
    if (isLyricsModalOpen) return;

    const target = event.target;
    const isEditableTarget = target instanceof HTMLElement && Boolean(
      target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]')
    );
    const isOtherEditableTarget = (
      target instanceof HTMLElement
      && target !== inputRef.current
      && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))
    );
    if (isOtherEditableTarget) return;

    const hasCommandModifier = event.altKey || event.ctrlKey || event.metaKey;
    const isActivelyEditingSearch = target === inputRef.current && query.length > 0;
    if (
      isPlayerAutoLevelShortcut(event)
      && (!isEditableTarget || (target === inputRef.current && !isActivelyEditingSearch))
      && !event.repeat
    ) {
      event.preventDefault();
      event.stopPropagation();
      onToggleAutoLevel();
      return;
    }
    if (
      isPlayerVocalCutShortcut(event)
      && (!isEditableTarget || (target === inputRef.current && !isActivelyEditingSearch))
      && !event.repeat
    ) {
      event.preventDefault();
      event.stopPropagation();
      onToggleVocalCut();
      return;
    }

    const volumeShortcut = getPlayerVolumeShortcut(event);
    if (volumeShortcut && query.length === 0) {
      event.preventDefault();
      event.stopPropagation();
      const nextVolume = adjustPlayerVolume(volume, volumeShortcut);
      setVolume(nextVolume);
      setIsMuted(nextVolume === 0);
      setVolumeFeedback(nextVolume);
      if (volumeFeedbackTimerRef.current) clearTimeout(volumeFeedbackTimerRef.current);
      volumeFeedbackTimerRef.current = setTimeout(() => {
        setVolumeFeedback(null);
        volumeFeedbackTimerRef.current = null;
      }, 900);
      return;
    }

    if (
      target !== inputRef.current
      && event.key.length === 1
      && !hasCommandModifier
    ) {
      // Focus synchronously so the browser delivers the key's text input to the
      // real field. This preserves Thai IME behavior without copying characters.
      focusSearchInput();
      return;
    }

    if (event.key === 'Escape') {
      if (event.repeat || (!isQueueBrowserOpen && !isOpen)) return;
      event.preventDefault();
      event.stopPropagation();
      if (isQueueBrowserOpen && !isOpen) closeQueueBrowser();
      else closeSearch();
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      if (
        event.repeat
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || !nowPlaying
        || query.length > 0
      ) {
        return;
      }

      event.preventDefault();
      if (event.key === 'Home') onRestartCurrentSong();
      else void skipSong().catch(console.warn);
      return;
    }

    if (
      event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)
    ) {
      return;
    }

    if (
      event.key === 'Enter'
      && target instanceof HTMLElement
      && target !== inputRef.current
      && target.closest('button, a, [role="button"]')
    ) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        moveQueueSelection('down');
      } else if (results.length > 0) {
        setSelectedIndex((current) => (current + 1) % results.length);
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        moveQueueSelection('up');
      } else if (results.length > 0) {
        setSelectedIndex((current) => current < 0 ? results.length - 1 : (current - 1 + results.length) % results.length);
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.repeat) return;
      if (!isOpen && isQueueBrowserOpen) {
        if (selectedQueueItem) {
          void activateQueueItem(selectedQueueItem.id);
        }
        return;
      }

      if (status === 'loading') return;
      if (status !== 'success' && !results[selectedIndex]) {
        void submitSearch();
        return;
      }
      const selectedVideo = results[selectedIndex];
      if (selectedVideo) void addSelectedVideo(selectedVideo);
      return;
    }
  }, [
    addSelectedVideo,
    activateQueueItem,
    closeQueueBrowser,
    closeSearch,
    focusSearchInput,
    isOpen,
    isLyricsModalOpen,
    isQueueBrowserOpen,
    moveQueueSelection,
    nowPlaying,
    onRestartCurrentSong,
    onToggleAutoLevel,
    onToggleVocalCut,
    query.length,
    results,
    selectedIndex,
    selectedQueueItem,
    setIsMuted,
    setVolume,
    skipSong,
    status,
    submitSearch,
    volume,
  ]);

  useEffect(() => {
    window.addEventListener('keydown', handlePlayerKeyDown, true);
    return () => window.removeEventListener('keydown', handlePlayerKeyDown, true);
  }, [handlePlayerKeyDown]);

  return (
    <>
      <section
        className={
          isOpen
            ? 'pointer-events-none fixed inset-0 z-50 bg-gradient-to-b from-black/85 via-black/45 to-transparent px-4 pt-[6vh] sm:px-8'
            : 'pointer-events-none fixed left-0 top-0 z-50 h-px w-px overflow-hidden opacity-0'
        }
        role="search"
        aria-label="ค้นหาเพลงจากหน้า Player"
      >
        <div className={isOpen ? 'pointer-events-auto mx-auto w-full max-w-5xl xl:max-w-6xl' : ''}>
          <div className="rounded-2xl border border-white/15 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur-xl sm:p-4">
            <div className="flex items-center gap-3">
              <Search className="h-5 w-5 shrink-0 text-violet-300" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                value={query}
                onChange={(event) => updateQuery(event.target.value)}
                onCompositionEnd={(event) => updateQuery(event.currentTarget.value)}
                className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-white outline-none placeholder:text-zinc-500 sm:text-3xl"
                placeholder="ชื่อเพลง ศิลปิน เนื้อร้อง หรือลิงก์ YouTube..."
                autoComplete="off"
                spellCheck={false}
                aria-label="ชื่อเพลง ศิลปิน เนื้อร้อง หรือลิงก์ YouTube"
                aria-autocomplete="list"
                aria-expanded={isOpen || isQueueBrowserActive}
                aria-haspopup="listbox"
                aria-controls={isQueueBrowserActive ? 'player-queue-results' : 'player-search-results'}
                aria-activedescendant={activeDescendantId}
              />
              <button type="button" aria-label="สลับการเรียงตามชื่อเพลงหรือศิลปิน" onClick={() => {
                const nextMode = mode === 'song' ? 'artist' : 'song';
                searchModeRef.current = nextMode;
                setMode(nextMode);
                setSelectedIndex(-1);
                if (localCatalog.mode === 'local' && trimmedQuery.length >= MIN_SEARCH_LENGTH && !isDirectVideoQuery(trimmedQuery)) {
                  setRawResults([]);
                  setLocalResultsActive(false);
                  setStatus('idle');
                  localCatalog.search(trimmedQuery, nextMode);
                }
              }} className="shrink-0 rounded-lg border border-violet-400/30 bg-violet-500/15 px-2.5 py-1 text-xs font-bold text-violet-200">
                {mode === 'song' ? 'ชื่อเพลง' : 'ศิลปิน'}
              </button>
              <button type="button" disabled={status === 'loading'} onClick={() => void submitSearch()} className="rounded-lg bg-violet-600 px-3 py-2 text-sm text-white disabled:opacity-50">{localCatalog.mode === 'local' ? 'ค้นในเครื่อง' : 'ค้นในคลัง'}</button>
            </div>

            {isOpen && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs">
                <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-900 p-0.5" role="group" aria-label="แหล่งค้นเพลง">
                  <button type="button" aria-pressed={localCatalog.mode === 'supabase'} onClick={localCatalog.chooseSupabase}
                    className={`rounded-md px-2.5 py-1.5 ${localCatalog.mode === 'supabase' ? 'bg-violet-700 text-white' : 'text-zinc-400 hover:text-white'}`}>
                    Supabase
                  </button>
                  <button type="button" aria-pressed={localCatalog.mode === 'local'} onClick={localCatalog.chooseLocal}
                    className={`rounded-md px-2.5 py-1.5 ${localCatalog.mode === 'local' ? 'bg-violet-700 text-white' : 'text-zinc-400 hover:text-white'}`}>
                    ในเครื่อง
                  </button>
                </div>
                <button type="button" onClick={() => localCatalog.setPanelOpen(!localCatalog.panelOpen)}
                  className="text-violet-300 hover:text-violet-200">จัดการคลังในเครื่อง</button>
              </div>
            )}

            {localCatalog.panelOpen && (
              <section className="mt-3 space-y-2 rounded-xl border border-violet-500/30 bg-zinc-900/90 p-3 text-xs text-zinc-300" aria-label="จัดการคลังในเครื่อง">
                <p className="font-semibold text-white">คลังเพลงในเครื่อง</p>
                <p>เก็บเฉพาะข้อมูลชื่อเพลงและข้อมูลค้นหาในเบราว์เซอร์เครื่องนี้ ไม่ดาวน์โหลดเสียง วิดีโอ หรือรูปปก เพลงยังต้องใช้อินเทอร์เน็ตเพื่อเข้าคิวและเล่น</p>
                <p className="text-zinc-400">จำนวนเพลงและขนาดดาวน์โหลดขึ้นอยู่กับคลังปัจจุบันและการคัดกรอง อาจใช้พื้นที่หลาย MB</p>
                {localCatalog.meta && (
                  <p className="text-violet-300">มี {localCatalog.meta.count.toLocaleString('th-TH')} เพลง · อัปเดต {new Date(localCatalog.meta.updatedAt).toLocaleString('th-TH')}{localCatalog.stale ? ' · ควรอัปเดต' : ''}</p>
                )}
                {localCatalog.busy === 'loading' && <p>กำลังเตรียมดัชนีค้นหา...</p>}
                {localCatalog.busy === 'downloading' && <p>ดาวน์โหลดแล้ว {localCatalog.progress.toLocaleString('th-TH')} เพลง...</p>}
                {localCatalog.error && <p role="alert" className="text-rose-400">{localCatalog.error}</p>}
                <div className="flex flex-wrap gap-2">
                  {localCatalog.busy === 'downloading' ? (
                    <button type="button" onClick={localCatalog.cancelDownload} className="rounded-lg border border-zinc-700 px-3 py-1.5 hover:bg-zinc-800">ยกเลิก</button>
                  ) : (
                    <button type="button" disabled={localCatalog.busy !== null} onClick={() => void localCatalog.download()}
                      className="rounded-lg bg-violet-700 px-3 py-1.5 font-semibold text-white hover:bg-violet-600 disabled:opacity-50">
                      {localCatalog.meta ? 'อัปเดตคลัง' : 'ดาวน์โหลดคลัง'}
                    </button>
                  )}
                  {localCatalog.meta && (
                    <button type="button" disabled={localCatalog.busy !== null}
                      onClick={() => { if (window.confirm('ลบข้อมูลเพลงในเครื่องนี้ทั้งหมด?')) void localCatalog.remove(); }}
                      className="rounded-lg border border-rose-800 px-3 py-1.5 text-rose-300 hover:bg-rose-950 disabled:opacity-50">
                      ลบข้อมูลในเครื่อง
                    </button>
                  )}
                </div>
              </section>
            )}

            {isOpen && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-3 text-[11px] text-zinc-400 sm:text-xs">
                <span>↑↓ เลือกเพลง</span>
                <span>{selectedIndex >= 0 && results.length ? 'Enter เพิ่มเพลงที่เลือกเข้าคิว' : 'Enter ค้นหาเพลง'}</span>
                <span>Tab เลื่อนไปปุ่มต่าง ๆ</span>
                <span>Esc ปิดค้นหา • Home เริ่มเพลงใหม่ • End ข้ามเพลงปัจจุบัน</span>
                <div className="flex w-full flex-wrap items-center gap-2 pt-1 text-sm font-semibold text-zinc-100">
                  <span>ยังไม่เจอเพลงที่ต้องการ?</span>
                  <button type="button" disabled={status === 'loading' || trimmedQuery.length < 2 || isDirectVideoQuery(query)}
                    onClick={() => void submitSearch('youtube')}
                    className="rounded-lg border border-violet-300/60 bg-violet-500/20 px-3 py-1.5 font-semibold text-violet-50 shadow-sm hover:bg-violet-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40">
                    ค้นเพิ่มบน YouTube
                  </button>
                  <button
                    type="button"
                    data-player-lyrics-ui
                    aria-expanded={showLyricsInput}
                    aria-controls="player-lyrics-search-form"
                    onClick={toggleLyricsInput}
                    className="rounded-lg border border-cyan-300/50 bg-cyan-500/15 px-3 py-1.5 font-semibold text-cyan-50 shadow-sm hover:bg-cyan-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  >
                    รู้เนื้อ ไม่รู้ชื่อเพลง
                  </button>
                </div>
                {showLyricsInput && (
                  <form
                    id="player-lyrics-search-form"
                    data-player-lyrics-ui
                    onSubmit={handleLyricsSearch}
                    className="flex w-full flex-wrap items-center gap-2 pt-1"
                  >
                    <label htmlFor="player-remembered-lyrics" className="sr-only">
                      พิมพ์ท่อนเนื้อเพลงที่จำได้
                    </label>
                    <input
                      ref={lyricsInputRef}
                      id="player-remembered-lyrics"
                      type="search"
                      value={lyricsInput}
                      onChange={(event) => setLyricsInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Escape') return;
                        event.preventDefault();
                        event.stopPropagation();
                        lyricsUiActiveRef.current = false;
                        setShowLyricsInput(false);
                        window.requestAnimationFrame(focusSearchInput);
                      }}
                      minLength={MIN_SEARCH_LENGTH}
                      maxLength={160}
                      placeholder="พิมพ์ท่อนเนื้อเพลงที่จำได้"
                      autoFocus
                      className="min-w-[14rem] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-normal text-white placeholder:text-zinc-500 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
                    />
                    <button
                      type="submit"
                      disabled={lyricsInput.trim().length < MIN_SEARCH_LENGTH}
                      className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ค้นจากเนื้อเพลง
                    </button>
                    <span className="w-full text-[11px] font-normal text-zinc-500">
                      ค้นผ่าน Google เฉพาะเว็บไซต์เนื้อเพลง • ไม่เพิ่มเพลงลงคิวอัตโนมัติ
                    </span>
                  </form>
                )}
                <span>{searchSource === 'youtube' ? 'ผลจาก YouTube / แคชคำค้น' : localCatalog.mode === 'local' && localResultsActive ? 'คลังในเครื่อง • ไม่ใช้เครือข่ายขณะพิมพ์' : 'คลังเพลง Supabase • ไม่ใช้ Search Queries'}</span>
              </div>
            )}
          </div>
          <SearchBudgetNotice />
          {localCatalog.mode === 'supabase' && catalogError && <p role="status" className="mt-2 text-xs text-amber-200">{catalogError}</p>}

          {isOpen && (
            <div className="mt-3 grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
              <div
                id="player-search-results"
                className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl backdrop-blur-xl lg:col-span-8"
                role="listbox"
                aria-label="ผลการค้นหาเพลง"
              >
              {status === 'idle' && trimmedQuery.length >= MIN_SEARCH_LENGTH && (
                <p className="px-5 py-3 text-center text-sm text-zinc-400">{localCatalog.mode === 'local' ? 'ค้นในเครื่องขณะพิมพ์' : 'ค้นในคลังขณะพิมพ์'} • ↑↓ หรือคลิกเลือกเพลง • กด Enter เพื่อค้นต่อบน YouTube เมื่อไม่พบในคลัง</p>
              )}
              {trimmedQuery.length < MIN_SEARCH_LENGTH && (
                <div className="px-5 py-6 text-center text-sm text-zinc-400" role="status">
                  พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อเริ่มค้นหา
                </div>
              )}

              {status === 'loading' && results.length === 0 && (
                <div className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-zinc-300" role="status">
                  <Loader2 className="h-5 w-5 animate-spin text-violet-300" aria-hidden="true" />
                  กำลังค้นหาเพลง...
                </div>
              )}

              {status === 'loading' && results.length > 0 && (
                <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2 text-xs text-zinc-400" role="status">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-300" aria-hidden="true" />
                  กำลังอัปเดตผลค้นหา...
                </div>
              )}

              {status === 'error' && (
                <p className="px-5 py-8 text-center text-sm text-rose-300" role="alert">
                  {errorMessage}
                </p>
              )}

              {status === 'success' && results.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-zinc-400">
                  <Music2 className="mx-auto mb-2 h-6 w-6 text-zinc-500" aria-hidden="true" />
                  <p className="font-semibold text-zinc-200">ไม่พบเพลงในคลังหรือ YouTube</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    ลองใช้คำค้นอื่น หรือให้เพื่อนๆ สแกน QR ด้านข้างเพื่อช่วยกันค้นหาได้เลย!
                  </p>
                </div>
              )}

              {results.map((video, index) => {
                const isSelected = index === selectedIndex;
                return (
                  <button
                    key={video.youtube_video_id}
                    id={`player-result-${video.id}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => void addSelectedVideo(video)}
                    className={`flex w-full items-center gap-4 border-b border-white/5 px-4 py-3 text-left transition last:border-b-0 sm:px-5 ${
                      isSelected
                        ? 'bg-violet-600 text-white'
                        : 'bg-transparent text-zinc-200 hover:bg-white/5'
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-bold ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span
                      className={`relative h-[45px] w-20 shrink-0 overflow-hidden rounded-md border bg-zinc-900 ${
                        isSelected ? 'border-violet-200/80' : 'border-zinc-700/80'
                      }`}
                    >
                      <Music2
                        className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 text-zinc-600"
                        aria-hidden="true"
                      />
                      <Image
                        src={getVideoThumbnailUrl(video)}
                        alt=""
                        width={80}
                        height={45}
                        sizes="80px"
                        loading="lazy"
                        onError={(event) => {
                          const fallbackUrl = `https://img.youtube.com/vi/${video.youtube_video_id}/hqdefault.jpg`;
                          if (event.currentTarget.src === fallbackUrl) {
                            event.currentTarget.style.display = 'none';
                            return;
                          }
                          event.currentTarget.src = fallbackUrl;
                        }}
                        className="relative h-full w-full object-cover"
                      />
                      <span className="absolute bottom-0 right-0 bg-black/85 px-0.5 font-mono text-[8px] leading-3 text-white">
                        {formatDuration(video.duration)}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold sm:text-base">{video.title}</span>
                      <OfficialChannelBadge channelId={video.channel_id} />
                      <span className={`block truncate text-xs ${isSelected ? 'text-violet-100' : 'text-zinc-500'}`}>
                        {video.artist ?? video.channel_name} · {formatViewCount(video.views_count)}
                      </span>
                    </span>
                    {isSelected && (
                      <span className="hidden shrink-0 text-xs font-semibold text-violet-100 sm:inline">
                        Enter เพื่อเพิ่มเข้าคิว
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {activeRoom && (
              <div className="hidden shrink-0 lg:block lg:col-span-4">
                <PlayerQRGuideCard roomCode={activeRoom.room_code} />
              </div>
            )}
          </div>
          )}

          {isOpen && activeRoom && (
            <div className="mt-3 block lg:hidden">
              <PlayerQRGuideCard roomCode={activeRoom.room_code} variant="compact" />
            </div>
          )}
        </div>
      </section>

      {isQueueBrowserActive && (
        <section
          className="relative z-40 flex min-h-0 min-w-0 flex-[0_0_44%] flex-col overflow-hidden border-t border-violet-400/20 bg-zinc-950 xl:flex-[0_0_30%] xl:border-l xl:border-t-0"
          role="region"
          aria-label="เลือกเพลงจากคิว"
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-6 xl:py-4">
              <div className="flex min-w-0 items-center gap-3">
                <ListMusic className="h-6 w-6 shrink-0 text-violet-300" aria-hidden="true" />
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold text-white sm:text-xl">เพลงในคิว</h2>
                  <p className="text-xs text-zinc-400 sm:text-sm">
                    ↑/↓ เลื่อนเลือก · Enter เล่นทันที · Esc ปิด
                  </p>
                </div>
              </div>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-300">
                {queue.length} เพลง
              </span>
            </header>

            <div
              id="player-queue-results"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              role="listbox"
              aria-label="รายการเพลงที่รอเล่น"
            >
              {queue.length === 0 ? (
                <div
                  className="px-5 py-10 text-center text-sm text-zinc-400"
                  role="option"
                  aria-selected="false"
                  aria-disabled="true"
                >
                  คิวยังว่างอยู่ — พิมพ์ชื่อเพลงเพื่อค้นหาจาก YouTube
                </div>
              ) : (
                queue.map((item, index) => {
                  const isSelected = item.id === selectedQueueItem?.id;
                  const singerNames = item.singers.map((singer) => singer.name).join(' & ');

                  return (
                    <button
                      key={item.id}
                      id={`player-queue-item-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setSelectedQueueItemId(item.id)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        void activateQueueItem(item.id);
                      }}
                      className={`flex w-full items-center gap-4 border-b border-white/5 px-4 py-3 text-left transition last:border-b-0 sm:px-5 ${
                        isSelected
                          ? 'bg-violet-600 text-white'
                          : 'bg-transparent text-zinc-200 hover:bg-white/5'
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-bold ${
                          isSelected ? 'bg-white/20 text-white' : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold sm:text-base">{item.video.title}</span>
                        <span className={`block truncate text-xs ${isSelected ? 'text-violet-100' : 'text-zinc-500'}`}>
                          {singerNames || item.requested_by} · {formatDuration(item.video.duration)}
                        </span>
                      </span>
                      {isSelected && (
                        <span className="hidden shrink-0 text-xs font-semibold text-violet-100 sm:inline">
                          Enter เล่นทันที
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </section>
      )}

      {successMessage && (
        <div
          className="pointer-events-none fixed bottom-8 left-1/2 z-[60] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-950/95 px-4 py-2.5 text-sm font-semibold text-emerald-100 shadow-2xl backdrop-blur-xl"
          role="status"
          aria-live="polite"
        >
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{successMessage}</span>
        </div>
      )}

      {volumeFeedback !== null && (
        <div
          className="pointer-events-none fixed right-5 top-5 z-[60] flex items-center gap-2 rounded-xl border border-white/15 bg-zinc-950/90 px-3 py-2 text-sm font-semibold text-white shadow-xl backdrop-blur-xl sm:right-8 sm:top-8"
          role="status"
          aria-live="polite"
          aria-label={`ระดับเสียง ${volumeFeedback} เปอร์เซ็นต์`}
        >
          <Volume2 className="h-4 w-4 text-violet-300" aria-hidden="true" />
          <span>{volumeFeedback}%</span>
        </div>
      )}

      {submittedLyricsQuery && (
        <LyricsGoogleSearchModal
          open={isLyricsModalOpen}
          query={submittedLyricsQuery}
          onClose={closeLyricsModal}
        />
      )}
    </>
  );
}
