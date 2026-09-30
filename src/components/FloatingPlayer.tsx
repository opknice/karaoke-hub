'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useKaraoke } from '@/context/KaraokeContext';
import { Play, Pause, SkipForward, Mic, Tv, ListMusic, Volume2, VolumeX } from 'lucide-react';
import { formatDuration } from '@/lib/queue-algorithm';

export const FloatingPlayer: React.FC = () => {
  const pathname = usePathname();
  const { nowPlaying, isPlaying, setIsPlaying, skipSong, currentTime, duration, volume, setVolume, isMuted, setIsMuted, isTVModeActive } =
    useKaraoke();

  // Hide on full TV player screen
  if (!nowPlaying || pathname === '/player') return null;

  const singerName = nowPlaying.singers.map((s) => s.name).join(' & ') || nowPlaying.requested_by || 'Singer';
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed bottom-3 left-3 right-3 sm:left-6 sm:right-6 max-w-4xl mx-auto z-40 animate-in slide-in-from-bottom-3 duration-300">
      <div className="relative rounded-2xl bg-zinc-950/90 backdrop-blur-xl border border-zinc-800 shadow-2xl p-2.5 sm:p-3 flex items-center justify-between gap-3 overflow-hidden ring-1 ring-violet-500/20">
        {/* Progress Bar at very top of player */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-zinc-800/80">
          <div
            className="h-full bg-gradient-to-r from-violet-500 via-pink-500 to-cyan-400 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Left: Thumbnail & Song Details */}
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/player" className="relative w-12 h-10 rounded-xl overflow-hidden bg-zinc-900 shrink-0 group">
            <img
              src={nowPlaying.video.thumbnail_url}
              alt={nowPlaying.video.title}
              className="w-full h-full object-cover group-hover:scale-105 transition"
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
              <Tv className="w-3.5 h-3.5 text-white" />
            </div>
          </Link>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-violet-950 border border-violet-500/40 text-[10px] font-semibold text-violet-300 shrink-0">
                <Mic className="w-2.5 h-2.5 text-pink-400 animate-pulse" />
                <span className="truncate max-w-[80px]">{singerName}</span>
              </span>
              {isTVModeActive && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-emerald-950 border border-emerald-500/40 text-[10px] font-bold text-emerald-400 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>TV Live</span>
                </span>
              )}
              <span className="text-[11px] font-mono text-zinc-500">
                {formatDuration(currentTime)} / {formatDuration(duration)}
              </span>
            </div>
            <Link
              href="/player"
              className="text-xs font-semibold text-white hover:text-violet-300 truncate block transition max-w-[200px] sm:max-w-xs"
            >
              {nowPlaying.video.title}
            </Link>
          </div>
        </div>

        {/* Center: Play Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/30 hover:scale-105 transition"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>

          <button
            onClick={skipSong}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
            title="Skip to next"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Right: Quick shortcuts */}
        <div className="hidden sm:flex items-center gap-2">
          {/* Quick Mute/Volume */}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {/* Jump to TV display */}
          <Link
            href="/player"
            className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <Tv className="w-3.5 h-3.5 text-cyan-400" />
            <span>Player</span>
          </Link>

          {/* Jump to Queue */}
          <Link
            href="/queue"
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
            title="Open Queue"
          >
            <ListMusic className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
};
