'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, QrCode, X } from 'lucide-react';
import { PlayerSearchOverlay } from '@/components/PlayerSearchOverlay';
import { PlayerQRGuideCard } from '@/components/PlayerQRGuideCard';
import { PlayerVocalCutStatus } from '@/components/PlayerVocalCutStatus';
import { YouTubePlayer, type YouTubePlayerHandle } from '@/components/YouTubePlayer';
import { useKaraoke } from '@/context/KaraokeContext';
import { useVocalCutExtension } from '@/hooks/useVocalCutExtension';

export default function PlayerPage() {
  const { activeRoom, ensureActiveRoom, nowPlaying, volume, isMuted } = useKaraoke();
  const [isQueueBrowserActive, setIsQueueBrowserActive] = useState(false);
  const [showQRQuickModal, setShowQRQuickModal] = useState(false);
  const [isMobileLandscape, setIsMobileLandscape] = useState(false);
  const [isPageFullscreen, setIsPageFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const [normalizeFeedbackPhase, setNormalizeFeedbackPhase] = useState<'hidden' | 'visible' | 'fading'>('hidden');
  const [roomSetupError, setRoomSetupError] = useState('');
  const [isRetryingRoom, setIsRetryingRoom] = useState(false);
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const ownsFullscreenRef = useRef(false);
  const normalizeFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const normalizeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vocalCut = useVocalCutExtension(
    nowPlaying?.video.youtube_video_id ?? null,
    volume,
    isMuted
  );
  const toggleNormalize = vocalCut.toggleNormalize;

  const restartCurrentSong = useCallback(() => {
    playerRef.current?.restartCurrentSong();
  }, []);

  const toggleNormalizeWithFeedback = useCallback(() => {
    toggleNormalize();
    if (normalizeFadeTimerRef.current) clearTimeout(normalizeFadeTimerRef.current);
    if (normalizeHideTimerRef.current) clearTimeout(normalizeHideTimerRef.current);
    setNormalizeFeedbackPhase('visible');
    normalizeFadeTimerRef.current = setTimeout(() => setNormalizeFeedbackPhase('fading'), 3000);
    normalizeHideTimerRef.current = setTimeout(() => setNormalizeFeedbackPhase('hidden'), 3500);
  }, [toggleNormalize]);

  useEffect(() => () => {
    if (normalizeFadeTimerRef.current) clearTimeout(normalizeFadeTimerRef.current);
    if (normalizeHideTimerRef.current) clearTimeout(normalizeHideTimerRef.current);
  }, []);

  useEffect(() => {
    const landscapeMedia = window.matchMedia('(orientation: landscape) and (pointer: coarse)');

    const syncOrientation = () => {
      const isLandscape = landscapeMedia.matches;
      setIsMobileLandscape(isLandscape);
      if (!isLandscape) {
        setFullscreenError('');
        if (ownsFullscreenRef.current && document.fullscreenElement === pageRef.current) {
          ownsFullscreenRef.current = false;
          void document.exitFullscreen().catch(() => {
            // The browser may already have left fullscreen during rotation.
          });
        }
      }
    };

    const syncFullscreen = () => {
      const isFullscreen = document.fullscreenElement === pageRef.current;
      setIsPageFullscreen(isFullscreen);
      if (!isFullscreen) ownsFullscreenRef.current = false;
      setFullscreenError('');
    };

    syncOrientation();
    syncFullscreen();
    landscapeMedia.addEventListener('change', syncOrientation);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => {
      landscapeMedia.removeEventListener('change', syncOrientation);
      document.removeEventListener('fullscreenchange', syncFullscreen);
    };
  }, []);

  const enterPageFullscreen = useCallback(async () => {
    const page = pageRef.current;
    if (!page?.requestFullscreen || !document.fullscreenEnabled) {
      setFullscreenError('เบราว์เซอร์นี้ไม่รองรับการแสดงเต็มจอ');
      return;
    }

    setFullscreenError('');
    ownsFullscreenRef.current = true;
    try {
      await page.requestFullscreen();
    } catch {
      ownsFullscreenRef.current = false;
      setFullscreenError('ไม่สามารถเปิดเต็มจอได้ กรุณาแตะลองอีกครั้ง');
    }
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
    <div ref={pageRef} className="relative flex h-dvh w-full flex-col overflow-hidden bg-black xl:flex-row">
      <PlayerVocalCutStatus
        state={vocalCut.state}
        notice={vocalCut.notice}
        hasRequestedFeedback={vocalCut.hasRequestedFeedback}
        hasSong={Boolean(nowPlaying)}
        onToggle={vocalCut.toggle}
        onSubmitResult={vocalCut.submitResult}
        onPresetChange={vocalCut.setPreset}
        showNormalizeFeedback={normalizeFeedbackPhase !== 'hidden'}
        normalizeFeedbackFading={normalizeFeedbackPhase === 'fading'}
      />
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

      {isMobileLandscape && !isPageFullscreen && !isQueueBrowserActive && !showQRQuickModal && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-40 flex justify-center">
          <div className="pointer-events-auto flex max-w-full flex-col items-center gap-1 rounded-2xl border border-white/15 bg-zinc-950/85 px-3 py-2 text-center text-white shadow-2xl backdrop-blur-md">
            <button
              type="button"
              onClick={() => void enterPageFullscreen()}
              className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-semibold transition hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
              แตะเพื่อดูเวทีเต็มจอ
            </button>
            {fullscreenError && <span role="alert" className="text-xs text-rose-200">{fullscreenError}</span>}
          </div>
        </div>
      )}

      {/* Ambient QR Badge on Idle */}
      {activeRoom && (
        <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
          {nowPlaying && !isQueueBrowserActive && !showQRQuickModal && (
            <div
              aria-label="คีย์ลัด: Home เล่นซ้ำ, End จบเพลง, ลูกศรขึ้นลงดูเพลงในคิว, F11 เต็มจอหรือลดจอ"
              className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-zinc-950/75 px-3 py-2 text-[11px] text-zinc-300 shadow-xl backdrop-blur-md sm:flex"
            >
              <kbd className="font-mono font-semibold text-zinc-100">Home</kbd>
              <span>เล่นซ้ำ</span>
              <span aria-hidden="true" className="text-zinc-600">•</span>
              <kbd className="font-mono font-semibold text-zinc-100">End</kbd>
              <span>จบเพลง</span>
              <span aria-hidden="true" className="text-zinc-600">•</span>
              <kbd className="font-mono font-semibold text-zinc-100">↑↓</kbd>
              <span>ดูเพลงในคิว</span>
              <span aria-hidden="true" className="text-zinc-600">•</span>
              <kbd className="font-mono font-semibold text-zinc-100">F11</kbd>
              <span>เต็มจอ/ลดจอ</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowQRQuickModal((prev) => !prev)}
            aria-label={`แสดง QR Code ห้อง ${activeRoom.room_code}`}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-zinc-950/80 text-zinc-200 shadow-xl backdrop-blur-md transition hover:border-violet-400/50 hover:bg-zinc-900/90 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            title="คลิกเพื่อดู QR Code สแกนขอเพลงจากมือถือ"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-600/40 text-violet-300">
              <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
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
        onToggleVocalCut={vocalCut.toggle}
        onToggleAutoLevel={toggleNormalizeWithFeedback}
      />
    </div>
  );
}
