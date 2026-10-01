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
import { searchPlayerKaraoke, getLocalSearchPreview, isDirectVideoQuery } from '@/lib/youtube-search-client';
import { SearchBudgetNotice } from './SearchBudgetNotice';
import { OfficialChannelBadge } from './OfficialChannelBadge';
import { useCatalogPreview } from '@/lib/use-catalog-preview';
import { adjustPlayerVolume, getPlayerVolumeShortcut } from '@/lib/player-keyboard';
import {
  rankKaraokeVideos,
  type YouTubeSearchMode,
} from '@/lib/youtube-ranking';
import { PlayerQRGuideCard } from './PlayerQRGuideCard';

type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

interface PlayerSearchOverlayProps {
  onQueueBrowserActiveChange: (isActive: boolean) => void;
  onRestartCurrentSong: () => void;
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
  const requestRef = useRef<AbortController | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const receivePreview = useCallback((videos: YouTubeVideo[]) => {
    setRawResults(videos);
    setSelectedIndex(-1);
  }, []);
  const catalogError = useCatalogPreview(query, status === 'idle', receivePreview);

  const trimmedQuery = query.trim();
  const isOpen = query.length > 0;
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
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const closeSearch = useCallback(() => {
    requestRef.current?.abort();
    setQuery('');
    setIsQueueBrowserOpen(false);
    setSelectedQueueItemId(null);
    setRawResults([]);
    setSelectedIndex(0);
    setStatus('idle');
    setErrorMessage('');
    window.requestAnimationFrame(focusSearchInput);
  }, [focusSearchInput]);

  const updateQuery = useCallback((value: string) => {
    requestRef.current?.abort();
    setQuery(value);
    setIsQueueBrowserOpen(false);
    setSelectedQueueItemId(null);
    setSelectedIndex(-1);
    setErrorMessage('');
    setRawResults(getLocalSearchPreview(value));
    setStatus('idle');
    setSearchSource('catalog');
  }, []);

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
        await addToQueue(video, nickname, [nickname]);
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
    [addToQueue, closeSearch, nickname]
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
        && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))
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

    const controller = new AbortController();
    requestRef.current = controller;
    setStatus('loading');
    setSearchSource(source);
    setErrorMessage('');
    try {
      const { videos, source: resultSource } = await searchPlayerKaraoke(
        normalizedQuery, controller.signal, source, () => {
          setSearchSource('youtube');
          setRawResults([]);
        }
      );
      if (controller.signal.aborted) return;

      setRawResults(videos);
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
  }, [query]);

  useEffect(() => {
    return () => {
      requestRef.current?.abort();
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      if (volumeFeedbackTimerRef.current) clearTimeout(volumeFeedbackTimerRef.current);
    };
  }, []);

  const handlePlayerKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.isComposing || event.defaultPrevented) return;

    const target = event.target;
    const isOtherEditableTarget = (
      target instanceof HTMLElement
      && target !== inputRef.current
      && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))
    );
    if (isOtherEditableTarget) return;

    const hasCommandModifier = event.altKey || event.ctrlKey || event.metaKey;
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
    isQueueBrowserOpen,
    moveQueueSelection,
    nowPlaying,
    onRestartCurrentSong,
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
                setMode((current) => current === 'song' ? 'artist' : 'song');
                setSelectedIndex(-1);
              }} className="shrink-0 rounded-lg border border-violet-400/30 bg-violet-500/15 px-2.5 py-1 text-xs font-bold text-violet-200">
                {mode === 'song' ? 'ชื่อเพลง' : 'ศิลปิน'}
              </button>
              <button type="button" disabled={status === 'loading'} onClick={() => void submitSearch()} className="rounded-lg bg-violet-600 px-3 py-2 text-sm text-white disabled:opacity-50">ค้นในคลัง</button>
            </div>

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
                </div>
                <span>{searchSource === 'youtube' ? 'ผลจาก YouTube / แคชคำค้น' : 'คลังเพลง Supabase • ไม่ใช้ Search Queries'}</span>
              </div>
            )}
          </div>
          <SearchBudgetNotice />
          {catalogError && <p role="status" className="mt-2 text-xs text-amber-200">{catalogError}</p>}

          {isOpen && (
            <div className="mt-3 grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
              <div
                id="player-search-results"
                className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl backdrop-blur-xl lg:col-span-8"
                role="listbox"
                aria-label="ผลการค้นหาเพลง"
              >
              {status === 'idle' && trimmedQuery.length >= MIN_SEARCH_LENGTH && (
                <p className="px-5 py-3 text-center text-sm text-zinc-400">ค้นในคลังขณะพิมพ์ • ↑↓ หรือคลิกเลือกเพลง • กด Enter เพื่อค้นต่อบน YouTube เมื่อไม่พบในคลัง</p>
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
    </>
  );
}
