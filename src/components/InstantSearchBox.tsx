'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { YouTubeVideo } from '@/lib/types';
import { searchYouTubeKaraoke, getLocalSearchPreview } from '@/lib/youtube-search-client';
import { useKaraoke } from '@/context/KaraokeContext';
import { useAuth } from '@/context/AuthContext';
import { formatDuration } from '@/lib/queue-algorithm';
import {
  Search,
  X,
  Loader2,
  Play,
  Plus,
  Eye,
  Sparkles,
  Music,
  Check,
  Flame,
} from 'lucide-react';

interface InstantSearchBoxProps {
  size?: 'large' | 'compact';
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export const InstantSearchBox: React.FC<InstantSearchBoxProps> = ({
  size = 'large',
  placeholder = 'ค้นหาเพลง, ศิลปิน หรือ YouTube Karaoke (เช่น Bodyslam, ซ่อนกลิ่น, Zombie)...',
  className = '',
  autoFocus = false,
}) => {
  const router = useRouter();
  const { addToQueue } = useKaraoke();
  const { nickname } = useAuth();

  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<YouTubeVideo[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [previewVideo, setPreviewVideo] = useState<YouTubeVideo | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchError, setSearchError] = useState('');
  const requestRef = useRef<AbortController | null>(null);

  // Only explicit submission may call the search endpoint.
  const fetchResults = useCallback(async (q: string, source: 'catalog' | 'youtube' = 'catalog') => {
    if (requestRef.current && !requestRef.current.signal.aborted) return;
    const normalizedQuery = q.trim();
    if (normalizedQuery.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setSearchError('');
    try {
      const nextResults = await searchYouTubeKaraoke(normalizedQuery, controller.signal, source);
      if (!controller.signal.aborted) setResults(nextResults.slice(0, 7));
    } catch (error: unknown) {
      if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : 'ค้นหาไม่สำเร็จ');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, []);

  useEffect(() => () => requestRef.current?.abort(), []);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.nativeEvent.isComposing || e.repeat) return;
      handleSubmit();
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;
    setIsOpen(true);
    void fetchResults(query);
  };

  const handleQuickAdd = async (e: React.MouseEvent, video: YouTubeVideo): Promise<void> => {
    e.stopPropagation();
    try {
      await addToQueue(video, nickname, [nickname]);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'ไม่สามารถเพิ่มเพลงได้');
      return;
    }
    setAddedIds((prev) => new Set(prev).add(video.youtube_video_id));
    setTimeout(() => {
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.delete(video.youtube_video_id);
        return next;
      });
    }, 1500);
  };

  const handlePlayNow = async (e: React.MouseEvent, video: YouTubeVideo): Promise<void> => {
    e.stopPropagation();
    try {
      await addToQueue(video, nickname, [nickname], '', true);
      setIsOpen(false);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'ไม่สามารถเล่นเพลงนี้ได้');
    }
  };

  const isLarge = size === 'large';

  return (
    <>
      <div ref={containerRef} className={`relative w-full ${className}`}>
        {/* Search Input Bar */}
        <form onSubmit={handleSubmit} className="relative flex items-center">
          <div className={`absolute pointer-events-none text-zinc-400 ${isLarge ? 'left-4' : 'left-3'}`}>
            <Search className={isLarge ? 'w-5 h-5 text-violet-400' : 'w-4 h-4 text-violet-400'} />
          </div>

          <input
            ref={inputRef}
            type="text"
            value={query}
            autoFocus={autoFocus}
            onFocus={() => {
              if (query.trim().length > 0) setIsOpen(true);
            }}
            onChange={(e) => {
              requestRef.current?.abort();
              setLoading(false);
              setResults(getLocalSearchPreview(e.target.value).slice(0, 7));
              setSearchError('');
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={`w-full rounded-2xl bg-zinc-900/90 border border-zinc-700/80 focus:border-violet-500 text-white placeholder-zinc-500 focus:outline-none transition shadow-2xl ring-1 ring-white/5 ${
              isLarge
                ? 'pl-12 pr-32 py-3.5 sm:py-4 text-sm sm:text-base'
                : 'pl-9 pr-24 py-2 text-xs sm:text-sm rounded-xl'
            }`}
          />

          {/* Right Controls */}
          <div className={`absolute right-2 flex items-center gap-1.5 ${isLarge ? 'right-2.5' : 'right-1.5'}`}>
            {loading && <Loader2 className="w-4 h-4 text-violet-400 animate-spin mr-1" />}

            {query && (
              <button
                type="button"
                onClick={() => {
                  requestRef.current?.abort();
                  setQuery('');
                  setLoading(false);
                  setSearchError('');
                  setResults([]);
                  setIsOpen(false);
                  inputRef.current?.focus();
                }}
                className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
                title="Clear"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white font-semibold shadow-lg shadow-violet-600/30 transition flex items-center gap-1 ${
                isLarge ? 'px-4 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm' : 'px-3 py-1.5 text-xs'
              }`}
            >
              <Search className="w-3.5 h-3.5 hidden sm:inline" />
              <span>ค้นในคลัง</span>
            </button>
          </div>
        </form>

        {/* Live Preview Dropdown (YouTube Style) */}
        {isOpen && query.trim().length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-2xl bg-zinc-950/95 border border-zinc-800 shadow-2xl backdrop-blur-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
            {/* Header info */}
            <div className="px-4 py-2.5 border-b border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400 bg-zinc-900/40">
              <span className="flex items-center gap-1.5 font-medium">
                <Sparkles className="w-3.5 h-3.5 text-pink-400" />
                <span>กด Enter ค้นในคลัง • ไม่ใช้ Search Queries</span>
              </span>
              {results.length > 0 && (
                <span className="text-[11px] text-zinc-500">พบ {results.length} เพลง</span>
              )}
            </div>

            {/* Result Items */}
            <button type="button" disabled={loading || query.trim().length < 2} onClick={() => void fetchResults(query, 'youtube')}
              className="m-3 rounded-lg border border-violet-400/40 px-3 py-2 text-xs text-violet-200 disabled:opacity-40">ค้นเพิ่มบน YouTube</button>
            {searchError && <p role="alert" className="px-4 py-3 text-sm text-rose-300">{searchError}</p>}
            {loading && results.length === 0 ? (
              <div className="py-10 text-center text-zinc-400 text-xs flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
                <span>กำลังค้นหาเพลงคาราโอเกะ...</span>
              </div>
            ) : results.length === 0 ? (
              <div className="py-8 text-center text-zinc-400 text-xs px-4">
                <Music className="w-6 h-6 mx-auto mb-1 text-zinc-600" />
                <p>พิมพ์ชื่อเพลง แล้วกด Enter หรือปุ่มค้นหา</p>
              </div>
            ) : (
              <div className="max-h-[380px] overflow-y-auto divide-y divide-zinc-900/80">
                {results.map((video) => {
                  const isAdded = addedIds.has(video.youtube_video_id);

                  return (
                    <div
                      key={video.id}
                      className="group/item px-3 sm:px-4 py-2.5 hover:bg-zinc-900/80 transition flex items-center justify-between gap-3 cursor-pointer"
                      onClick={() => setPreviewVideo(video)}
                    >
                      {/* Left: Thumbnail & Duration */}
                      <div className="relative w-16 h-11 sm:w-20 sm:h-12 rounded-lg overflow-hidden bg-zinc-900 shrink-0 border border-zinc-800 group-hover/item:border-violet-500/50 transition">
                        <img
                          src={video.thumbnail_url}
                          alt={video.title}
                          className="w-full h-full object-cover group-hover/item:scale-105 transition"
                          loading="lazy"
                        />
                        <div className="absolute bottom-0.5 right-1 px-1 rounded bg-black/85 text-[10px] font-mono text-zinc-300">
                          {formatDuration(video.duration)}
                        </div>
                        {/* Play overlay on hover */}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/item:opacity-100 transition flex items-center justify-center">
                          <Play className="w-4 h-4 text-white fill-current ml-0.5" />
                        </div>
                      </div>

                      {/* Middle: Details */}
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs sm:text-sm font-semibold text-zinc-200 group-hover/item:text-violet-300 transition truncate">
                          {video.title}
                        </h4>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-zinc-400">
                          <span className="truncate max-w-[140px] sm:max-w-[200px]">
                            {video.channel_name}
                          </span>
                          <span className="text-zinc-600">•</span>
                          <span className="px-1.5 py-0.2 rounded bg-pink-500/10 text-pink-300 border border-pink-500/20 text-[10px] font-bold">
                            {video.karaoke_score}% Score
                          </span>
                        </div>
                      </div>

                      {/* Right: Action Buttons */}
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {/* Preview Eye Button */}
                        <button
                          type="button"
                          onClick={() => setPreviewVideo(video)}
                          className="p-1.5 sm:px-2 sm:py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs flex items-center gap-1 transition"
                          title="ฟังตัวอย่างเพลง (Preview)"
                        >
                          <Eye className="w-3.5 h-3.5 text-violet-400" />
                          <span className="hidden sm:inline text-[11px]">ตัวอย่าง</span>
                        </button>

                        {/* Quick Add to Queue */}
                        <button
                          type="button"
                          onClick={(e) => handleQuickAdd(e, video)}
                          className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                            isAdded
                              ? 'bg-emerald-600 text-white'
                              : 'bg-violet-600 hover:bg-violet-500 text-white shadow-md shadow-violet-600/30'
                          }`}
                          title="เพิ่มเข้าคิวร้องเพลง"
                        >
                          {isAdded ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline text-[11px]">เพิ่มแล้ว!</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline text-[11px]">เข้าคิว</span>
                            </>
                          )}
                        </button>

                        {/* Play Now Button */}
                        <button
                          type="button"
                          onClick={(e) => handlePlayNow(e, video)}
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-pink-600 text-zinc-300 hover:text-white transition"
                          title="เล่นเพลงนี้ทันที"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bottom Footer: See full search */}
            <div
              onClick={() => router.push(`/search?q=${encodeURIComponent(query.trim())}`)}
              className="px-4 py-2.5 bg-zinc-900/90 hover:bg-zinc-800/90 text-center text-xs font-semibold text-violet-400 hover:text-violet-300 transition cursor-pointer border-t border-zinc-800 flex items-center justify-center gap-1.5"
            >
              <span>ดูผลการค้นหาทั้งหมดสำหรับ &ldquo;{query}&rdquo;</span>
              <span>→</span>
            </div>
          </div>
        )}
      </div>

      {/* Floating Preview Modal (YouTube Video Preview) */}
      {previewVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-2xl rounded-3xl bg-zinc-950 border border-zinc-800 p-4 sm:p-5 shadow-2xl relative text-white animate-in zoom-in-95">
            <button
              onClick={() => setPreviewVideo(null)}
              className="absolute top-4 right-4 p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition z-10"
              title="Close Preview"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-3 pr-10">
              <span className="px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/30 text-xs font-bold flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                <span>YouTube Preview</span>
              </span>
              <h4 className="text-sm font-bold truncate text-zinc-200">
                {previewVideo.title}
              </h4>
            </div>

            {/* IFrame Player Preview */}
            <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black border border-zinc-800 shadow-xl">
              <iframe
                src={`https://www.youtube.com/embed/${previewVideo.youtube_video_id}?autoplay=1&enablejsapi=1&rel=0`}
                title="Song Preview"
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>

            {/* Bottom Actions */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-zinc-400">
                <span>ช่อง: {previewVideo.channel_name}</span>
                <span className="mx-2">•</span>
                <span>ความยาว: {formatDuration(previewVideo.duration)}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => void addToQueue(previewVideo, nickname, [nickname], '', true)
                    .then(() => setPreviewVideo(null))
                    .catch((error: unknown) => setSearchError(error instanceof Error ? error.message : 'ไม่สามารถเล่นเพลงนี้ได้'))}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold transition flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>ร้องเพลงนี้ทันที</span>
                </button>

                <button
                  onClick={() => void addToQueue(previewVideo, nickname, [nickname])
                    .then(() => setPreviewVideo(null))
                    .catch((error: unknown) => setSearchError(error instanceof Error ? error.message : 'ไม่สามารถเพิ่มเพลงได้'))}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/30 transition flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>เพิ่มเข้าคิว</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
