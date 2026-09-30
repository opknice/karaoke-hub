'use client';

import React from 'react';
import Link from 'next/link';
import { useKaraoke } from '@/context/KaraokeContext';
import { History, Trophy, Mic, Play, Clock, Calendar, ArrowRight } from 'lucide-react';
import { formatDuration } from '@/lib/queue-algorithm';
import type { YouTubeVideo } from '@/lib/types';

export default function HistoryPage() {
  const { history, addToQueue } = useKaraoke();

  // Calculate Most Sung Songs leaderboard (Spec Section 12)
  const songCountMap = new Map<string, { count: number; video: YouTubeVideo; singers: Set<string> }>();

  history.forEach((item) => {
    const key = item.youtube_video_id;
    if (!songCountMap.has(key)) {
      songCountMap.set(key, { count: 0, video: item.video, singers: new Set() });
    }
    const record = songCountMap.get(key)!;
    record.count += 1;
    item.singers.forEach((s) => record.singers.add(s));
  });

  const mostSungList = Array.from(songCountMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const totalMinutes = Math.round(
    history.reduce((acc, curr) => acc + (curr.duration || 210), 0) / 60
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-1 flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-2.5">
            <History className="w-7 h-7 text-cyan-400" />
            <span>Singing History & Leaderboard</span>
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Track past performances, replay legendary sessions, and see who owns the stage.
          </p>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5 text-pink-400" />
            <span>{history.length} Performances</span>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-violet-400" />
            <span>{totalMinutes} mins sung</span>
          </div>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="py-24 text-center rounded-3xl bg-zinc-900/30 border border-zinc-800 p-8 max-w-md mx-auto">
          <History className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white mb-1">No singing history yet</h3>
          <p className="text-xs text-zinc-400 mb-4">
            Songs will automatically appear here once you finish singing them!
          </p>
          <Link
            href="/search"
            className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition inline-flex items-center gap-1.5"
          >
            <span>Start Singing</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1">
          {/* Left: Performance Log List */}
          <div className="lg:col-span-2 space-y-3">
            <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider px-2 mb-2">
              Recent Performances ({history.length})
            </div>

            {history.map((record) => (
              <div
                key={record.id}
                className="p-3.5 sm:p-4 rounded-2xl bg-zinc-900/50 hover:bg-zinc-900/80 border border-zinc-800/80 flex items-center justify-between gap-4 transition"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <img
                    src={record.video?.thumbnail_url}
                    alt={record.video?.title}
                    className="w-18 h-12 rounded-xl object-cover shrink-0"
                  />

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="px-2 py-0.5 rounded-full bg-violet-950 border border-violet-500/30 text-[10px] font-bold text-violet-300">
                        {record.singers.join(' & ') || 'Singer'}
                      </span>
                      <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(record.performed_at).toLocaleDateString()}
                      </span>
                    </div>

                    <h4 className="text-sm font-semibold text-white truncate">{record.video?.title}</h4>
                    <p className="text-xs text-zinc-400">{record.video?.channel_name}</p>
                  </div>
                </div>

                <button
                  onClick={() => void addToQueue(
                    record.video,
                    record.singers[0] || 'Encore',
                    record.singers,
                    '',
                    true
                  ).catch(console.error)}
                  className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-violet-600 text-zinc-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 transition"
                  title="Sing this song again!"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span className="hidden sm:inline">Replay</span>
                </button>
              </div>
            ))}
          </div>

          {/* Right: Most Sung Songs Leaderboard (Spec Section 12) */}
          <div className="lg:col-span-1">
            <div className="rounded-3xl bg-zinc-900/60 border border-zinc-800 p-6 sticky top-24">
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Most Sung Songs</h3>
              </div>

              <div className="space-y-3">
                {mostSungList.map((item, idx) => (
                  <div
                    key={item.video?.id || idx}
                    className="p-3 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                          idx === 0
                            ? 'bg-amber-400 text-black shadow-md'
                            : idx === 1
                            ? 'bg-zinc-300 text-black'
                            : idx === 2
                            ? 'bg-amber-700 text-white'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">
                          {item.video?.title}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          Singers: {Array.from(item.singers).slice(0, 2).join(', ')}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-xs font-bold text-cyan-400">
                        {item.count} {item.count === 1 ? 'play' : 'plays'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
