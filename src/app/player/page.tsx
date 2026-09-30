'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { QrCode, X } from 'lucide-react';
import { PlayerSearchOverlay } from '@/components/PlayerSearchOverlay';
import { PlayerQRGuideCard } from '@/components/PlayerQRGuideCard';
import { YouTubePlayer, type YouTubePlayerHandle } from '@/components/YouTubePlayer';
import { useKaraoke } from '@/context/KaraokeContext';

export default function PlayerPage() {
  const { activeRoom, ensureActiveRoom } = useKaraoke();
  const [isQueueBrowserActive, setIsQueueBrowserActive] = useState(false);
  const [showQRQuickModal, setShowQRQuickModal] = useState(false);
  const [roomSetupError, setRoomSetupError] = useState('');
  const [isRetryingRoom, setIsRetryingRoom] = useState(false);
  const playerRef = useRef<YouTubePlayerHandle>(null);

  const restartCurrentSong = useCallback(() => {
    playerRef.current?.restartCurrentSong();
  }, []);

  const initializeRoom = useCallback(async () => {
    setIsRetryingRoom(true);
    setRoomSetupError('');
    try {
      await ensureActiveRoom();
    } catch (error: unknown) {
      setRoomSetupError(
        error instanceof Error ? error.message : 'ไม่สามารถเตรียมห้องสำหรับรับคำขอเพลงได้'
      );
    } finally {
      setIsRetryingRoom(false);
    }
  }, [ensureActiveRoom]);

  useEffect(() => {
    queueMicrotask(() => void initializeRoom());
  }, [initializeRoom]);

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;

    const channel = new BroadcastChannel('karaoke_hub_cross_tab_sync');
    channel.postMessage({ type: 'TV_PLAYER_ANNOUNCE', senderId: 'tv-player' });
    return () => channel.close();
  }, []);

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-black xl:flex-row">
      {roomSetupError && (
        <div
          role="alert"
          className="fixed left-1/2 top-4 z-[60] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-rose-500/40 bg-rose-950/95 px-4 py-3 text-sm text-rose-100 shadow-2xl backdrop-blur-md"
        >
          <span>{roomSetupError}</span>
          <button
            type="button"
            onClick={() => void initializeRoom()}
            disabled={isRetryingRoom}
            className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 font-semibold hover:bg-white/20 disabled:cursor-wait disabled:opacity-60"
          >
            {isRetryingRoom ? 'กำลังลองใหม่…' : 'ลองใหม่'}
          </button>
        </div>
      )}

      {/* Ambient QR Badge on Idle */}
      {activeRoom && (
        <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowQRQuickModal((prev) => !prev)}
            className="flex items-center gap-2 rounded-full border border-white/15 bg-zinc-950/80 px-3.5 py-1.5 text-xs font-semibold text-zinc-200 shadow-xl backdrop-blur-md transition hover:border-violet-400/50 hover:bg-zinc-900/90 hover:text-white"
            title="คลิกเพื่อดู QR Code สแกนขอเพลงจากมือถือ"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-600/40 text-violet-300">
              <QrCode className="h-3 w-3" />
            </span>
            <span className="hidden sm:inline">สแกนขอเพลง</span>
            <span className="rounded bg-violet-600/20 px-1.5 py-0.5 font-mono text-[11px] font-bold text-violet-300">
              {activeRoom.room_code}
            </span>
          </button>
        </div>
      )}

      {/* Quick QR Modal when clicking the ambient badge */}
      {showQRQuickModal && activeRoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="QR Code สำหรับขอเพลงจากมือถือ"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setShowQRQuickModal(false)}
        >
          <div
            className="relative w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowQRQuickModal(false)}
              aria-label="ปิดหน้าต่าง QR Code"
              className="absolute -top-3 -right-3 z-10 rounded-full border border-white/15 bg-zinc-900 p-2 text-zinc-300 shadow-xl hover:bg-zinc-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
            <PlayerQRGuideCard roomCode={activeRoom.room_code} />
          </div>
        </div>
      )}

      <div
        className={`relative flex min-h-0 min-w-0 items-center justify-center bg-black transition-[flex-basis] duration-200 ease-out ${
          isQueueBrowserActive ? 'flex-[0_0_56%] xl:flex-[0_0_70%]' : 'flex-1'
        }`}
      >
        <div
          className={
            isQueueBrowserActive
              ? 'aspect-video h-auto w-full max-w-[min(100%,calc(56dvh*16/9))] xl:max-w-[min(100%,calc(100dvh*16/9))]'
              : 'h-full w-full'
          }
        >
          <YouTubePlayer
            ref={playerRef}
            isDisplayMode
            disableVideoInteraction={isQueueBrowserActive}
          />
        </div>
      </div>
      <PlayerSearchOverlay
        onQueueBrowserActiveChange={setIsQueueBrowserActive}
        onRestartCurrentSong={restartCurrentSong}
      />
    </div>
  );
}
