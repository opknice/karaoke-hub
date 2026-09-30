'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useKaraoke } from '@/context/KaraokeContext';
import { QueueItemCard } from '@/components/QueueItemCard';
import { calculateEstimatedWait, formatDuration, formatMinutes } from '@/lib/queue-algorithm';
import { QueueMode } from '@/lib/types';
import {
  ListMusic,
  Play,
  Pause,
  SkipForward,
  Trash2,
  Lock,
  Unlock,
  Tv,
  Mic,
  Users,
  Clock,
  Sparkles,
  ArrowRight,
  Shuffle,
} from 'lucide-react';

export default function QueuePage() {
  const {
    nowPlaying,
    isPlaying,
    setIsPlaying,
    skipSong,
    previousSong,
    currentTime,
    duration,
    queue,
    queueMode,
    setQueueMode,
    isQueueLocked,
    setIsQueueLocked,
    clearQueue,
  } = useKaraoke();

  const [confirmClear, setConfirmClear] = useState(false);

  // Compute total duration of entire queue
  const totalQueueSeconds =
    queue.reduce((acc, curr) => acc + (curr.video?.duration || 210), 0) +
    Math.max(0, (duration || 210) - currentTime);

  // Unique singers in queue
  const singerSet = new Set<string>();
  if (nowPlaying) nowPlaying.singers.forEach((s) => singerSet.add(s.name));
  queue.forEach((item) => item.singers.forEach((s) => singerSet.add(s.name)));

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-1 flex flex-col">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-2.5">
            <ListMusic className="w-7 h-7 text-violet-400" />
            <span>Singer Queue Manager</span>
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Organized with fair rotation algorithms to keep the party flowing smoothly.
          </p>
        </div>

        {/* Stats Pill */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-300 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>Total Queue: {formatMinutes(totalQueueSeconds)}</span>
          </div>

          <div className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-300 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-pink-400" />
            <span>{singerSet.size} Active Singers</span>
          </div>
        </div>
      </div>

      {/* Now Playing Featured Card */}
      {nowPlaying ? (
        <div className="mb-8 rounded-3xl bg-gradient-to-r from-violet-950/70 via-zinc-900/90 to-pink-950/70 border border-violet-500/30 p-5 sm:p-6 shadow-2xl backdrop-blur-xl relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="relative w-24 h-16 sm:w-32 sm:h-20 rounded-2xl overflow-hidden bg-black shrink-0 border border-violet-500/30">
                <img
                  src={nowPlaying.video.thumbnail_url}
                  alt={nowPlaying.video.title}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono text-zinc-300">
                  {formatDuration(nowPlaying.video.duration)}
                </div>
              </div>

              <div className="min-w-0">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-violet-600/30 border border-violet-400/40 text-violet-300 text-xs font-bold mb-1.5">
                  <Mic className="w-3 h-3 text-pink-400 animate-pulse" />
                  <span>
                    Singing: {nowPlaying.singers.map((s) => s.name).join(' & ') || nowPlaying.requested_by}
                  </span>
                </div>
                <h3 className="text-base sm:text-lg font-bold text-white line-clamp-1">{nowPlaying.video.title}</h3>
                <p className="text-xs text-zinc-400">{nowPlaying.video.channel_name}</p>
              </div>
            </div>

            {/* Playback Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-violet-600/30 transition"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                <span>{isPlaying ? 'Pause' : 'Resume'}</span>
              </button>

              <button
                onClick={skipSong}
                className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs flex items-center gap-1.5 transition"
              >
                <SkipForward className="w-4 h-4" />
                <span>Skip</span>
              </button>

              <Link
                href="/player"
                className="p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-cyan-400 transition"
                title="Open Big TV Display"
              >
                <Tv className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-8 p-6 rounded-3xl bg-zinc-900/40 border border-zinc-800 text-center">
          <p className="text-zinc-400 text-sm">Nothing is playing right now.</p>
          <Link
            href="/search"
            className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold text-violet-400 hover:underline"
          >
            <span>Search and pick a song</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Queue Toolbar: Rotation Mode & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-zinc-800/80">
        {/* Singer Rotation Mode Tabs (Spec Section 8) */}
        <div className="flex items-center gap-1 bg-zinc-900/90 p-1 rounded-2xl border border-zinc-800">
          <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider px-2">Rotation:</span>
          {(['smart', 'round_robin', 'fifo'] as QueueMode[]).map((mode) => {
            const labels = {
              smart: 'Smart Rotation ✨',
              round_robin: 'Round Robin 🔄',
              fifo: 'First In First Out (FIFO)',
            };
            return (
              <button
                key={mode}
                onClick={() => setQueueMode(mode)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                  queueMode === mode
                    ? 'bg-violet-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
                title={
                  mode === 'smart'
                    ? 'Prevents queue monopoly, balances waiting time'
                    : mode === 'round_robin'
                    ? 'Rotates evenly between all singers'
                    : 'Standard chronological queue'
                }
              >
                {labels[mode]}
              </button>
            );
          })}
        </div>

        {/* Lock & Clear Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsQueueLocked(!isQueueLocked)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition ${
              isQueueLocked
                ? 'bg-amber-950/60 border-amber-500/40 text-amber-300'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
            }`}
            title="Lock queue to prevent guests from adding songs"
          >
            {isQueueLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            <span>{isQueueLocked ? 'Queue Locked' : 'Queue Open'}</span>
          </button>

          {queue.length > 0 && (
            <div>
              {confirmClear ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      clearQueue();
                      setConfirmClear(false);
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
                  >
                    Confirm Clear
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="px-2 py-1.5 rounded-xl bg-zinc-800 text-zinc-400 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-rose-950/40 border border-zinc-800 hover:border-rose-500/30 text-zinc-400 hover:text-rose-300 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Queue</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Queue Items List */}
      <div className="space-y-2.5 flex-1">
        {queue.length === 0 ? (
          <div className="text-center py-20 rounded-3xl bg-zinc-900/30 border border-zinc-800/80 p-8">
            <ListMusic className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white mb-1">Queue is empty</h3>
            <p className="text-xs text-zinc-400 mb-4 max-w-sm mx-auto">
              Add more songs from search or pick from your curated playlists so the music never stops!
            </p>
            <Link
              href="/search"
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition inline-flex items-center gap-1.5 shadow-md shadow-violet-600/30"
            >
              <Mic className="w-3.5 h-3.5" />
              <span>Find Songs to Sing</span>
            </Link>
          </div>
        ) : (
          queue.map((item, index) => {
            const waitInfo = calculateEstimatedWait(queue, item.id, currentTime);
            return (
              <QueueItemCard
                key={item.id}
                item={item}
                index={index}
                totalItems={queue.length}
                estimatedWaitSeconds={waitInfo.waitSeconds}
                isFirst={index === 0}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
