'use client';

import React, { useState } from 'react';
import { YouTubeVideo } from '@/lib/types';
import { useKaraoke } from '@/context/KaraokeContext';
import { useAuth } from '@/context/AuthContext';
import { formatDuration } from '@/lib/queue-algorithm';
import {
  Play,
  Plus,
  Heart,
  ListPlus,
  Eye,
  Sparkles,
  Check,
  Music,
} from 'lucide-react';
import Image from 'next/image';
import { OfficialChannelBadge } from './OfficialChannelBadge';

interface SongCardProps {
  video: YouTubeVideo;
  onOpenQueueModal?: (video: YouTubeVideo) => void;
  onPreview?: (video: YouTubeVideo) => void;
}

export const SongCard: React.FC<SongCardProps> = ({ video, onOpenQueueModal, onPreview }) => {
  const { addToQueue, isFavorite, toggleFavorite, playlists, addSongToPlaylist } = useKaraoke();
  const { nickname } = useAuth();
  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);
  const [addedAnimation, setAddedAnimation] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [showHoverPreview, setShowHoverPreview] = useState(false);
  const hoverTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  const favorited = isFavorite(video.youtube_video_id);

  const handleMouseEnter = () => {
    setIsHovered(true);
    hoverTimerRef.current = setTimeout(() => {
      setShowHoverPreview(true);
    }, 600);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }
    setShowHoverPreview(false);
  };

  const handleQuickAdd = () => {
    void addToQueue(video, nickname, [nickname])
      .then(() => {
        setAddedAnimation(true);
        setTimeout(() => setAddedAnimation(false), 1200);
      })
      .catch(console.error);
  };

  const handlePlayNow = () => {
    void addToQueue(video, nickname, [nickname], '', true).catch(console.error);
  };

  // Color gradient for score
  const scoreColor =
    video.karaoke_score >= 95
      ? 'from-emerald-500 to-teal-400 text-emerald-300 border-emerald-500/30'
      : video.karaoke_score >= 85
      ? 'from-cyan-500 to-blue-400 text-cyan-300 border-cyan-500/30'
      : 'from-amber-500 to-orange-400 text-amber-300 border-amber-500/30';

  return (
    <div className="group relative rounded-2xl bg-zinc-900/60 hover:bg-zinc-900/90 border border-zinc-800/80 hover:border-zinc-700/80 transition-all duration-300 flex flex-col overflow-hidden shadow-lg hover:shadow-2xl hover:shadow-violet-950/20">
      {/* Thumbnail / Video Preview Container */}
      <div
        className="relative aspect-video w-full overflow-hidden bg-zinc-950 cursor-pointer"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={() => onPreview?.(video)}
      >
        {showHoverPreview ? (
          <div className="absolute inset-0 z-10 bg-black pointer-events-none">
            <iframe
              src={`https://www.youtube.com/embed/${video.youtube_video_id}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1`}
              className="w-full h-full object-cover scale-110 pointer-events-none"
              title="YouTube Preview"
              allow="autoplay"
            />
            <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/80 backdrop-blur-md text-[10px] text-pink-400 font-bold flex items-center gap-1 border border-pink-500/30 z-20">
              <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-ping" />
              <span>Previewing</span>
            </div>
          </div>
        ) : (
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        )}

        {/* Duration Badge */}
        <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md text-[11px] font-mono text-zinc-300 font-medium z-20">
          {formatDuration(video.duration)}
        </div>

        {/* Karaoke Score Badge */}
        <div
          className={`absolute top-2 left-2 px-2 py-0.5 rounded-full bg-zinc-950/80 backdrop-blur-md border text-[10px] font-bold flex items-center gap-1 shadow-md z-20 ${scoreColor}`}
        >
          <Sparkles className="w-3 h-3 text-pink-400" />
          <span>{video.karaoke_score}% Score</span>
        </div>

        {/* Favorite Heart Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(video);
          }}
          className={`absolute top-2 right-2 p-1.5 rounded-full backdrop-blur-md transition z-20 ${
            favorited
              ? 'bg-pink-600/90 text-white shadow-lg shadow-pink-600/30'
              : 'bg-black/60 text-zinc-300 hover:text-pink-400 hover:bg-black/80'
          }`}
          title={favorited ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart className={`w-3.5 h-3.5 ${favorited ? 'fill-current' : ''}`} />
        </button>

        {/* Hover Quick Action Overlay */}
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity flex items-center justify-center gap-3 z-10 ${
            showHoverPreview ? 'opacity-0 hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handlePlayNow}
            className="w-11 h-11 rounded-full bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center shadow-xl shadow-violet-600/50 hover:scale-110 transition"
            title="Play Now"
          >
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </button>
          {onPreview && (
            <button
              onClick={() => onPreview(video)}
              className="w-10 h-10 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 flex items-center justify-center shadow-lg hover:scale-105 transition"
              title="Preview Video with Audio"
            >
              <Eye className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Meta Content */}
      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
        <div>
          <h4
            className="text-sm font-semibold text-white group-hover:text-violet-300 transition line-clamp-2 leading-snug"
            title={video.title}
          >
            {video.title}
          </h4>
          <p className="text-xs text-zinc-400 mt-1 truncate">{video.channel_name}</p>
          <OfficialChannelBadge channelId={video.channel_id} />
        </div>

        {/* Action Buttons */}
        <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between gap-2">
          {/* Add to Queue Button */}
          <div className="flex items-center gap-1.5 flex-1">
            <button
              onClick={handleQuickAdd}
              className={`flex-1 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                addedAnimation
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-800 hover:bg-violet-600/80 text-zinc-200 hover:text-white'
              }`}
            >
              {addedAnimation ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Added!</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Queue</span>
                </>
              )}
            </button>

            {onOpenQueueModal && (
              <button
                onClick={() => onOpenQueueModal(video)}
                className="px-2 py-1.5 rounded-xl bg-zinc-800/60 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-medium"
                title="Add with custom singer name or duet"
              >
                🎤+
              </button>
            )}
          </div>

          {/* Add to Playlist button */}
          <div className="relative">
            <button
              onClick={() => setShowPlaylistMenu(!showPlaylistMenu)}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              title="Add to Playlist"
            >
              <ListPlus className="w-4 h-4" />
            </button>

            {/* Playlist Popup Menu */}
            {showPlaylistMenu && (
              <div
                className="absolute bottom-full right-0 mb-2 w-48 rounded-xl bg-zinc-900 border border-zinc-800 p-2 shadow-2xl z-30 space-y-1"
                onMouseLeave={() => setShowPlaylistMenu(false)}
              >
                <div className="text-[11px] font-semibold text-zinc-400 px-2 py-1">Add to Playlist</div>
                {playlists.length === 0 ? (
                  <div className="text-xs text-zinc-500 px-2 py-1">No playlists yet</div>
                ) : (
                  playlists.map((pl) => (
                    <button
                      key={pl.id}
                      onClick={() => {
                        addSongToPlaylist(pl.id, video);
                        setShowPlaylistMenu(false);
                      }}
                      className="w-full text-left px-2 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg truncate transition"
                    >
                      {pl.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
