'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowDown, ArrowUp, ListMusic, Mic, Trash2, Tv } from 'lucide-react';
import { useKaraoke } from '@/context/KaraokeContext';
import { formatDuration } from '@/lib/queue-algorithm';
import type { QueueItem } from '@/lib/types';

function singerName(item: QueueItem): string {
  return item.singers.map((singer) => singer.name).join(' & ') || item.requested_by || 'Singer';
}

export function FloatingQueueManager() {
  const pathname = usePathname();
  const { nowPlaying, queue, moveQueueItem, removeFromQueue, isTVModeActive } = useKaraoke();
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  return (
    <aside
      aria-label="จัดการคิวเพลงของห้อง"
      className="fixed bottom-3 left-3 right-3 z-40 mx-auto max-w-4xl animate-in slide-in-from-bottom-3 duration-300 sm:left-6 sm:right-6"
    >
      <div className="overflow-hidden rounded-2xl border border-violet-500/30 bg-zinc-950/95 shadow-2xl ring-1 ring-violet-500/15 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-600/20 text-violet-300">
              <ListMusic className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white">คิวเพลงของห้อง</p>
              <p className="text-[10px] text-zinc-400">ทุกคนในห้องเลื่อนลำดับหรือลบเพลงรอได้</p>
            </div>
            <span className="shrink-0 rounded-full bg-violet-600/25 px-2 py-0.5 font-mono text-[10px] font-bold text-violet-200">
              {queue.length} เพลงรอ
            </span>
          </div>
          <Link
            href="/queue"
            className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition hover:border-violet-500/50 hover:text-white"
          >
            เปิดคิว
          </Link>
        </div>

        {nowPlaying && (
          <div className="flex items-center gap-2 border-b border-zinc-800/80 bg-emerald-500/5 px-3 py-2 sm:px-4">
            <div className="relative h-9 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
              <img src={nowPlaying.video.thumbnail_url} alt="" className="h-full w-full object-cover" />
              <span className="absolute inset-0 bg-emerald-950/35" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-950 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                  <Mic className="h-2.5 w-2.5 animate-pulse" />
                  กำลังร้อง
                </span>
                <span className="truncate text-[10px] text-zinc-400">{singerName(nowPlaying)}</span>
                {isTVModeActive && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" title="TV Live" />}
              </div>
              <p className="truncate text-xs font-semibold text-white">{nowPlaying.video.title}</p>
            </div>
            <Link
              href="/player"
              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-cyan-300 transition hover:bg-cyan-500/10 hover:text-cyan-100"
            >
              <Tv className="h-3.5 w-3.5" />
              Player
            </Link>
          </div>
        )}

        <div className="max-h-[min(42dvh,22rem)] overflow-y-auto p-2 sm:p-3">
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

        {actionError && (
          <p role="alert" className="border-t border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200 sm:px-4">
            {actionError}
          </p>
        )}
      </div>
    </aside>
  );
}
