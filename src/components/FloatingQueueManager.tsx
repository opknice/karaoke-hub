'use client';

import { useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ListMusic, Mic, Pause, Play, SkipForward, Trash2 } from 'lucide-react';
import { useKaraoke } from '@/context/KaraokeContext';
import { formatDuration } from '@/lib/queue-algorithm';
import type { QueueItem } from '@/lib/types';

function singerName(item: QueueItem): string {
  return item.singers.map((singer) => singer.name).join(' & ') || item.requested_by || 'Singer';
}

const DESKTOP_QUEUE_MEDIA_QUERY = '(min-width: 768px)';

function subscribeToDesktopQueueBreakpoint(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(DESKTOP_QUEUE_MEDIA_QUERY);
  mediaQuery.addEventListener('change', onStoreChange);
  return () => mediaQuery.removeEventListener('change', onStoreChange);
}

function getDesktopQueueBreakpoint() {
  return window.matchMedia(DESKTOP_QUEUE_MEDIA_QUERY).matches;
}

function getServerDesktopQueueBreakpoint() {
  return false;
}

export function FloatingQueueManager() {
  const pathname = usePathname();
  const {
    nowPlaying,
    queue,
    moveQueueItem,
    removeFromQueue,
    isTVModeActive,
    isPlaying,
    setRoomPlayback,
    skipSong,
  } = useKaraoke();
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [isPlaybackActionPending, setIsPlaybackActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isQueueExpanded, setIsQueueExpanded] = useState(false);
  const [isDesktopQueueCollapsed, setIsDesktopQueueCollapsed] = useState(false);
  const isDesktopQueue = useSyncExternalStore(
    subscribeToDesktopQueueBreakpoint,
    getDesktopQueueBreakpoint,
    getServerDesktopQueueBreakpoint
  );
  const isQueueVisible = isDesktopQueue ? !isDesktopQueueCollapsed : isQueueExpanded;

  const toggleQueueVisibility = () => {
    if (isDesktopQueue) {
      setIsDesktopQueueCollapsed((collapsed) => !collapsed);
    } else {
      setIsQueueExpanded((expanded) => !expanded);
    }
  };

  if (pathname === '/player' || (!nowPlaying && queue.length === 0)) return null;

  const runQueueAction = async (item: QueueItem, action: () => Promise<void>) => {
    setPendingItemId(item.id);
    setActionError(null);

    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'จัดการคิวไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      setPendingItemId(null);
    }
  };

  const runPlaybackAction = async (action: () => Promise<void>) => {
    setIsPlaybackActionPending(true);
    setActionError(null);

    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'ควบคุมเพลงไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      setIsPlaybackActionPending(false);
    }
  };

  return (
    <aside
      aria-label="จัดการคิวเพลงของห้อง"
      className="fixed bottom-3 left-3 right-3 z-40 mx-auto max-w-4xl animate-in slide-in-from-bottom-3 duration-300 sm:left-6 sm:right-6"
    >
      <div className="overflow-hidden rounded-2xl border border-violet-500/30 bg-zinc-950/95 shadow-2xl ring-1 ring-violet-500/15 backdrop-blur-xl">
        <div className="border-b border-zinc-800/80 px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <button
              type="button"
              onClick={toggleQueueVisibility}
              aria-controls="room-queue-list"
              aria-expanded={isQueueVisible}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left transition hover:bg-zinc-900/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-600/20 text-violet-300">
                <ListMusic className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold text-white">คิวเพลงของห้อง</p>
                  <span className="shrink-0 rounded-full bg-violet-600/25 px-2 py-0.5 font-mono text-[10px] font-bold text-violet-200">
                    {queue.length} เพลงรอ
                  </span>
                </div>
                {nowPlaying && (
                  <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-zinc-400">
                    <Mic className="h-2.5 w-2.5 shrink-0 text-emerald-400" />
                    <span className="shrink-0 font-semibold text-emerald-300">กำลังร้อง</span>
                    <span className="truncate">{nowPlaying.video.title}</span>
                    {isTVModeActive && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" title="TV Live" />}
                  </p>
                )}
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              {nowPlaying && (
                <>
                  <button
                    type="button"
                    disabled={isPlaybackActionPending}
                    onClick={() => void runPlaybackAction(() => setRoomPlayback(!isPlaying))}
                    className="rounded-lg bg-violet-600 p-2 text-white shadow-md shadow-violet-600/20 transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={isPlaying ? 'พักเพลงปัจจุบัน' : 'เล่นเพลงปัจจุบัน'}
                    title={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                  </button>
                  <button
                    type="button"
                    disabled={isPlaybackActionPending}
                    onClick={() => void runPlaybackAction(skipSong)}
                    className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-2 text-[11px] font-semibold text-zinc-200 transition hover:bg-rose-500/20 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="จบเพลงปัจจุบันและข้ามไปเพลงถัดไป"
                    title="End เพลงปัจจุบัน"
                  >
                    <SkipForward className="h-3.5 w-3.5" />
                    <span>End</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={toggleQueueVisibility}
                aria-controls="room-queue-list"
                aria-expanded={isQueueVisible}
                className="rounded-lg p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
                aria-label={isQueueVisible ? 'ยุบคิวเพลง' : 'แสดงคิวเพลง'}
                title={isQueueVisible ? 'ยุบคิว' : 'แสดงคิว'}
              >
                {isQueueVisible ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        {isQueueVisible && (
          <div
            id="room-queue-list"
            className="max-h-[25dvh] animate-in slide-in-from-bottom-2 overflow-y-auto p-2 duration-200 sm:p-3"
          >
            {queue.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">
                ยังไม่มีเพลงรอในคิว
              </p>
            ) : (
              <ol className="space-y-1.5">
                {queue.map((item, index) => {
                  const isPending = pendingItemId === item.id;
                  const title = item.video.title;

                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/80 px-2 py-2 sm:px-3"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-800 font-mono text-[10px] font-bold text-zinc-300">
                        {index + 1}
                      </span>
                      <img src={item.video.thumbnail_url} alt="" className="h-8 w-11 shrink-0 rounded-md object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-white">{title}</p>
                        <p className="truncate text-[10px] text-zinc-400">
                          {singerName(item)} · {formatDuration(item.video.duration)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          disabled={index === 0 || pendingItemId !== null}
                          onClick={() => void runQueueAction(item, () => moveQueueItem(item.id, 'up'))}
                          className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-violet-500/15 hover:text-violet-200 disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label={`เลื่อน ${title} ขึ้น`}
                          title="เลื่อนขึ้น"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={index === queue.length - 1 || pendingItemId !== null}
                          onClick={() => void runQueueAction(item, () => moveQueueItem(item.id, 'down'))}
                          className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-violet-500/15 hover:text-violet-200 disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label={`เลื่อน ${title} ลง`}
                          title="เลื่อนลง"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={pendingItemId !== null}
                          onClick={() => void runQueueAction(item, () => removeFromQueue(item.id))}
                          className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-rose-500/15 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label={`ลบ ${title} ออกจากคิว`}
                          title="ลบออกจากคิว"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {isPending && <span className="sr-only">กำลังบันทึกการเปลี่ยนแปลง</span>}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        {actionError && (
          <p role="alert" className="border-t border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200 sm:px-4">
            {actionError}
          </p>
        )}
      </div>
    </aside>
  );
}
