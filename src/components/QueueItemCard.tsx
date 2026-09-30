'use client';

import React from 'react';
import { QueueItem } from '@/lib/types';
import { useKaraoke } from '@/context/KaraokeContext';
import { formatDuration, formatMinutes } from '@/lib/queue-algorithm';
import {
  Play,
  ArrowUp,
  ArrowDown,
  Trash2,
  Clock,
  Mic,
  Users,
  CornerDownRight,
  GripVertical,
} from 'lucide-react';

interface QueueItemCardProps {
  item: QueueItem;
  index: number;
  totalItems: number;
  estimatedWaitSeconds: number;
  isFirst?: boolean;
}

export const QueueItemCard: React.FC<QueueItemCardProps> = ({
  item,
  index,
  totalItems,
  estimatedWaitSeconds,
  isFirst = false,
}) => {
  const { playNow, playNext, moveQueueItem, removeFromQueue } = useKaraoke();

  const isDuet = item.singers.length > 1;
  const singerDisplay = item.singers.map((s) => s.name).join(' & ') || item.requested_by || 'Singer';

  return (
    <div
      className={`group relative rounded-2xl border transition-all duration-200 p-3.5 sm:p-4 flex items-center justify-between gap-3 ${
        isFirst
          ? 'bg-zinc-900/90 border-cyan-500/40 shadow-lg shadow-cyan-950/20 ring-1 ring-cyan-500/30'
          : 'bg-zinc-900/50 hover:bg-zinc-900/80 border-zinc-800/80 hover:border-zinc-700/80'
      }`}
    >
      {/* Left: Drag grip & Position */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <div className="text-zinc-600 group-hover:text-zinc-400 cursor-grab">
          <GripVertical className="w-4 h-4" />
        </div>

        <div
          className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center font-bold text-xs sm:text-sm font-mono ${
            isFirst
              ? 'bg-gradient-to-tr from-cyan-500 to-blue-500 text-black shadow-md'
              : 'bg-zinc-800 text-zinc-300'
          }`}
        >
          {isFirst ? 'Next' : `#${item.position || index + 1}`}
        </div>
      </div>

      {/* Thumbnail */}
      <div className="relative w-16 h-12 sm:w-20 sm:h-14 rounded-xl overflow-hidden bg-zinc-950 shrink-0">
        <img
          src={item.video?.thumbnail_url || `https://img.youtube.com/vi/${item.youtube_video_id}/hqdefault.jpg`}
          alt={item.video?.title || 'Song'}
          className="w-full h-full object-cover"
        />
        <div className="absolute bottom-1 right-1 px-1 py-0.2 rounded bg-black/80 text-[9px] font-mono text-zinc-300">
          {formatDuration(item.video?.duration || 210)}
        </div>
      </div>

      {/* Middle: Title, Singer, Wait Time */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Singer Badge */}
          <div
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
              isDuet
                ? 'bg-pink-950/60 border-pink-500/30 text-pink-300'
                : 'bg-violet-950/60 border-violet-500/30 text-violet-300'
            }`}
          >
            {isDuet ? <Users className="w-3 h-3 text-pink-400" /> : <Mic className="w-3 h-3 text-violet-400" />}
            <span className="truncate max-w-[120px]">{singerDisplay}</span>
          </div>

          {/* Estimated Wait Time (Spec Section 9) */}
          <div className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
            <Clock className="w-3 h-3 text-zinc-500" />
            <span>Wait: {formatMinutes(estimatedWaitSeconds)}</span>
          </div>
        </div>

        {/* Title */}
        <h4 className="text-sm font-semibold text-white truncate mt-1 group-hover:text-violet-300 transition">
          {item.video?.title}
        </h4>

        {item.notes && (
          <p className="text-[11px] text-amber-300/80 truncate italic">Note: {item.notes}</p>
        )}
      </div>

      {/* Right Action Buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Play Now Button */}
        <button
          onClick={() => playNow(item.id)}
          className="p-2 rounded-xl bg-violet-600/80 hover:bg-violet-600 text-white transition shadow-sm"
          title="Play Now"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
        </button>

        {/* Play Next (Move to top) */}
        {!isFirst && (
          <button
            onClick={() => playNext(item.id)}
            className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition hidden sm:inline-flex"
            title="Play Next (Move to top of queue)"
          >
            <CornerDownRight className="w-3.5 h-3.5 text-cyan-400" />
          </button>
        )}

        {/* Move Up */}
        {index > 0 && (
          <button
            onClick={() => moveQueueItem(item.id, 'up')}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition hidden md:inline-flex"
            title="Move Up"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Move Down */}
        {index < totalItems - 1 && (
          <button
            onClick={() => moveQueueItem(item.id, 'down')}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition hidden md:inline-flex"
            title="Move Down"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Remove */}
        <button
          onClick={() => removeFromQueue(item.id)}
          className="p-1.5 sm:p-2 rounded-xl text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition"
          title="Remove from Queue"
        >
          <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
      </div>
    </div>
  );
};
