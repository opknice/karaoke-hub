'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useKaraoke } from '@/context/KaraokeContext';
import { useAuth } from '@/context/AuthContext';
import { YouTubeVideo } from '@/lib/types';
import { SEED_KARAOKE_VIDEOS } from '@/lib/karaoke-seed';
import { calculateEstimatedWait, formatDuration, formatMinutes } from '@/lib/queue-algorithm';
import { searchYouTubeKaraoke, getLocalSearchPreview } from '@/lib/youtube-search-client';
import {
  Mic,
  Search,
  Clock,
  Trash2,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  Loader2,
  Edit2,
  Flame,
} from 'lucide-react';

export default function GuestJoinPage() {
  const params = useParams();
  const roomCode = ((params?.code as string) || '').toUpperCase();

  const {
    activeRoom,
    joinRoom,
    queue,
    addToQueue,
    removeFromQueue,
    currentMember,
    currentTime,
    history,
  } = useKaraoke();

  const { nickname, setNickname } = useAuth();

  const [hasJoined, setHasJoined] = useState(false);
  const [guestName, setGuestName] = useState(nickname || '');
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<YouTubeVideo[]>([]);
  const [searchSource, setSearchSource] = useState<'catalog' | 'youtube'>('catalog');
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [justAddedIds, setJustAddedIds] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isQueueDrawerOpen, setIsQueueDrawerOpen] = useState(false);

  const searchRequestRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Automatically mark as joined if already connected to this room
  useEffect(() => {
    if (activeRoom && activeRoom.room_code === roomCode && currentMember) {
      const timer = setTimeout(() => {
        if (currentMember.nickname && !guestName) {
          setGuestName(currentMember.nickname);
        }
        setHasJoined(true);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [activeRoom, roomCode, currentMember, guestName]);

  // Clean up abort controller and timers on unmount
  useEffect(() => {
    return () => {
      searchRequestRef.current?.abort();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  // Filter songs requested by this user in the party queue
  const myQueueItems = useMemo(() => {
    if (!currentMember) return [];
    return queue.filter((item) => item.requested_by_member_id === currentMember.id);
  }, [currentMember, queue]);

  // Estimated wait for this user's first song in queue
  const firstMySong = myQueueItems[0];
  const waitInfo = useMemo(() => {
    if (!firstMySong) return null;
    return calculateEstimatedWait(queue, firstMySong.id, currentTime);
  }, [queue, firstMySong, currentTime]);

  // Handle joining room
  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = guestName.trim();
    if (!cleanName) return;

    setIsJoining(true);
    setJoinError('');
    try {
      const joined = await joinRoom(roomCode, cleanName);
      if (!joined) {
        throw new Error('ไม่สามารถเข้าร่วมห้องได้');
      }
      setNickname(cleanName);
      setHasJoined(true);
    } catch (error: unknown) {
      setJoinError(error instanceof Error ? error.message : 'ไม่สามารถเข้าร่วมห้องได้ กรุณาลองใหม่');
    } finally {
      setIsJoining(false);
    }
  };

  // Auto-search in catalog while user types
  const triggerAutoCatalogSearch = (query: string) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    searchRequestRef.current?.abort();

    const cleanQuery = query.trim();
    setSearchError('');
    if (cleanQuery.length < 2) {
      setSearchResults([]);
      setLoadingSearch(false);
      setSearchSource('catalog');
      return;
    }

    // 1. Immediate local preview (fast, 0ms)
    const localMatches = getLocalSearchPreview(cleanQuery);
    setSearchResults(localMatches);
    setSearchSource('catalog');

    // 2. Debounced API search in catalog (280ms)
    debounceTimerRef.current = setTimeout(() => {
      const controller = new AbortController();
      searchRequestRef.current = controller;
      setLoadingSearch(true);

      searchYouTubeKaraoke(cleanQuery, controller.signal, 'catalog')
        .then((results) => {
          if (!controller.signal.aborted) {
            setSearchResults(results);
            setSearchSource('catalog');
          }
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) {
            if (localMatches.length === 0) {
              setSearchError(err instanceof Error ? err.message : 'ค้นหาไม่สำเร็จ');
            }
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoadingSearch(false);
            if (searchRequestRef.current === controller) {
              searchRequestRef.current = null;
            }
          }
        });
    }, 280);
  };

  // Fallback to YouTube on Enter when no songs in catalog
  const handleEnterSearch = async () => {
    const query = searchQuery.trim();
    if (query.length < 2) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    searchRequestRef.current?.abort();

    const controller = new AbortController();
    searchRequestRef.current = controller;

    setLoadingSearch(true);
    setSearchError('');

    // Confirm an empty catalog result before spending a YouTube Search Query.
    try {
      const catResults = await searchYouTubeKaraoke(query, controller.signal, 'catalog');
      if (controller.signal.aborted) return;

      if (catResults.length > 0) {
        setSearchResults(catResults);
        setSearchSource('catalog');
        setLoadingSearch(false);
      } else {
        // 0 results in catalog -> AUTO SEARCH YOUTUBE!
        setSearchSource('youtube');
        const ytResults = await searchYouTubeKaraoke(query, controller.signal, 'youtube');
        if (!controller.signal.aborted) {
          setSearchResults(ytResults);
          setLoadingSearch(false);
        }
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        setSearchSource('catalog');
        setSearchError(
          error instanceof Error
            ? error.message
            : 'ไม่สามารถตรวจสอบคลังเพลงได้ จึงยังไม่ค้นเพิ่มบน YouTube เพื่อประหยัดโควตา'
        );
        setLoadingSearch(false);
      }
    }
  };

  // Explicit YouTube search when button is clicked
  const handleExplicitYouTubeSearch = () => {
    const query = searchQuery.trim();
    if (query.length < 2) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    searchRequestRef.current?.abort();

    const controller = new AbortController();
    searchRequestRef.current = controller;

    setLoadingSearch(true);
    setSearchError('');
    setSearchSource('youtube');

    searchYouTubeKaraoke(query, controller.signal, 'youtube')
      .then((results) => {
        if (!controller.signal.aborted) {
          setSearchResults(results);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setSearchError(err instanceof Error ? err.message : 'ค้นหาบน YouTube ไม่สำเร็จ');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingSearch(false);
          if (searchRequestRef.current === controller) {
            searchRequestRef.current = null;
          }
        }
      });
  };

  // Add song to queue instantly with visual feedback
  const handleAddSong = async (video: YouTubeVideo): Promise<void> => {
    const singerName = guestName.trim() || 'Guest Singer';
    try {
      await addToQueue(video, singerName, [singerName], '', false);
    } catch (error) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToastMessage(error instanceof Error ? error.message : 'ไม่สามารถเพิ่มเพลงได้');
      toastTimerRef.current = setTimeout(() => setToastMessage(null), 3500);
      return;
    }

    // Track added state
    setJustAddedIds((prev) => new Set([...prev, video.youtube_video_id]));

    // Trigger toast notification
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(`เพิ่มเพลง "${video.title}" เข้าคิวแล้ว! 🎤`);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3500);

    // Light mobile haptic vibration
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(50);
      } catch {}
    }
  };

  // Remove song from queue
  const handleCancelSong = async (itemId: string): Promise<void> => {
    try {
      await removeFromQueue(itemId);
    } catch (error) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToastMessage(error instanceof Error ? error.message : 'ไม่สามารถยกเลิกเพลงได้');
      toastTimerRef.current = setTimeout(() => setToastMessage(null), 3500);
      return;
    }
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage('ยกเลิกเพลงเรียบร้อยแล้ว');
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 2500);
  };

  // Calculate most frequently played songs from history
  const { topHistorySongs, hasHistory } = useMemo(() => {
    if (!history || history.length === 0) {
      return { topHistorySongs: SEED_KARAOKE_VIDEOS.slice(0, 10), hasHistory: false };
    }

    const userTarget = guestName.trim().toLowerCase();
    // 1. Try songs sung by this user first
    const userHistory = userTarget
      ? history.filter((item) =>
          item.singers.some((s) => s.toLowerCase() === userTarget)
        )
      : [];

    const itemsToCount = userHistory.length > 0 ? userHistory : history;

    // Count frequency
    const countMap = new Map<string, { count: number; video: YouTubeVideo }>();
    itemsToCount.forEach((item) => {
      if (!item.video || !item.youtube_video_id) return;
      const key = item.youtube_video_id;
      const existing = countMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        countMap.set(key, { count: 1, video: item.video });
      }
    });

    const sorted = Array.from(countMap.values())
      .sort((a, b) => b.count - a.count)
      .map((entry) => ({
        ...entry.video,
        playCount: entry.count,
      }));

    if (sorted.length > 0) {
      return { topHistorySongs: sorted.slice(0, 10), hasHistory: true };
    }

    return { topHistorySongs: SEED_KARAOKE_VIDEOS.slice(0, 10), hasHistory: false };
  }, [history, guestName]);

  // List to display: either search results or top history songs
  const isSearchActive = searchQuery.trim().length >= 2;
  const displaySongs: (YouTubeVideo & { playCount?: number })[] = isSearchActive
    ? searchResults
    : topHistorySongs;

  // ==========================================
  // SCREEN 1: JOIN ROOM (NICKNAME ENTRY)
  // ==========================================
  if (!hasJoined) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 bg-zinc-950 text-white relative overflow-hidden">
        {/* Ambient glow backgrounds */}
        <div className="absolute -top-32 -left-32 w-80 h-80 rounded-full bg-violet-600/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full bg-pink-600/15 blur-3xl pointer-events-none" />

        <div className="w-full max-w-sm rounded-3xl bg-zinc-900/90 border border-zinc-800/80 p-6 sm:p-8 shadow-2xl backdrop-blur-xl text-center space-y-6 relative z-10">
          {/* Room Badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-950/80 border border-violet-500/30 text-violet-300 text-xs font-bold font-mono">
            <span>Room: {roomCode}</span>
          </div>

          {/* Icon */}
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-violet-600 to-pink-500 mx-auto flex items-center justify-center shadow-xl shadow-pink-500/25">
            <Mic className="w-8 h-8 text-white" />
          </div>

          {/* Heading */}
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">
              เข้าร่วมปาร์ตี้คาราโอเกะ
            </h1>
            <p className="text-xs text-zinc-400 mt-1.5">
              ใส่ชื่อเล่นของคุณเพื่อขอเพลงลงคิว
            </p>
          </div>

          {/* Nickname Form */}
          <form onSubmit={handleJoinSubmit} className="space-y-4 text-left">
            <div>
              <label
                htmlFor="nickname-input"
                className="text-xs font-medium text-zinc-300 block mb-1.5"
              >
                ใส่ชื่อเล่นของคุณ
              </label>
              <input
                id="nickname-input"
                type="text"
                value={guestName}
                onChange={(e) => {
                  setGuestName(e.target.value);
                  if (joinError) setJoinError('');
                }}
                placeholder="ชื่อเล่น เช่น DJ Ann, Mike"
                className="w-full px-4 py-3 rounded-2xl bg-zinc-950 border border-zinc-700/80 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition"
                required
                maxLength={40}
                autoFocus
              />
            </div>

            {joinError && (
              <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {joinError}
              </p>
            )}

            <button
              type="submit"
              disabled={isJoining || !guestName.trim()}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:from-violet-500 hover:to-pink-400 disabled:opacity-50 text-white font-bold text-sm shadow-xl shadow-pink-500/20 active:scale-[0.98] transition flex items-center justify-center gap-2"
            >
              {isJoining ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>กำลังเข้าห้อง...</span>
                </>
              ) : (
                <span>เข้าร่วมและขอเพลง 🎤</span>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ==========================================
  // SCREEN 2: QUEUE-ONLY SONG SEARCH & ADD
  // ==========================================
  return (
    <div className="min-h-dvh flex flex-col bg-zinc-950 text-white pb-28">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[90%] animate-in slide-in-from-top-4 fade-in duration-200">
          <div className="rounded-2xl bg-zinc-900/95 border border-emerald-500/40 p-3.5 shadow-2xl backdrop-blur-md flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5 stroke-[3]" />
            </div>
            <p className="text-xs font-semibold text-white truncate flex-1">
              {toastMessage}
            </p>
            <button
              onClick={() => setToastMessage(null)}
              className="text-zinc-400 hover:text-white p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Top Header Bar */}
      <header className="sticky top-0 z-30 bg-zinc-950/85 backdrop-blur-md border-b border-zinc-900 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-600/30 text-violet-400">
              <Mic className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs font-mono font-bold text-violet-400">
              Room {roomCode}
            </span>
            <span className="text-zinc-600">•</span>
            <span className="text-xs text-zinc-300 font-medium truncate max-w-[140px] sm:max-w-[200px]">
              {guestName}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setHasJoined(false)}
            className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white px-2 py-1 rounded-lg hover:bg-zinc-900 transition"
            title="เปลี่ยนชื่อเล่น"
          >
            <Edit2 className="w-3.5 h-3.5 text-zinc-400" />
            <span>เปลี่ยนชื่อ</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-2xl mx-auto w-full px-4 pt-4 flex-1">
        {/* Prominent Search Bar */}
        <div className="space-y-2.5 mb-6">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                const val = e.target.value;
                setSearchQuery(val);
                setSearchError('');
                triggerAutoCatalogSearch(val);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleEnterSearch();
                }
              }}
              placeholder="ค้นหาชื่อเพลงหรือศิลปิน..."
              className="w-full pl-10 pr-16 py-3 rounded-2xl bg-zinc-900/90 border border-zinc-800 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition shadow-lg"
              autoFocus
            />

            {/* Spinner or Clear Icon */}
            <div className="absolute right-3 top-3 flex items-center gap-1.5">
              {loadingSearch && (
                <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
              )}
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                    searchRequestRef.current?.abort();
                    setSearchQuery('');
                    setSearchResults([]);
                    setSearchError('');
                    setLoadingSearch(false);
                    setSearchSource('catalog');
                  }}
                  className="p-1 rounded-full text-zinc-400 hover:text-white"
                  title="ล้างข้อความ"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Sub-bar: Hint and YouTube button */}
          <div className="flex items-center justify-between text-xs px-1 text-zinc-400 min-h-[26px]">
            <span className="text-[11px] text-zinc-500">
              {searchSource === 'youtube'
                ? 'กำลังแสดงผลการค้นหาจาก YouTube'
                : 'ค้นในคลังอัตโนมัติ • กด Enter ค้นหา YouTube เมื่อไม่พบ'}
            </span>

            {isSearchActive && (
              <button
                type="button"
                disabled={loadingSearch}
                onClick={handleExplicitYouTubeSearch}
                className={`text-[11px] font-medium py-1 px-2.5 rounded-lg border transition flex items-center gap-1 shrink-0 ${
                  searchSource === 'youtube'
                    ? 'bg-red-950/40 border-red-500/40 text-red-300'
                    : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white'
                }`}
                title="ค้นหาเพลงเวอร์ชันอื่นๆ บน YouTube"
              >
                <span>ค้นใน YouTube</span>
              </button>
            )}
          </div>

          {searchError && (
            <p className="text-xs text-rose-400 px-1">{searchError}</p>
          )}
        </div>

        {/* List Title */}
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
            {isSearchActive ? (
              <>
                <Search className="w-3.5 h-3.5 text-violet-400" />
                <span>
                  ผลการค้นหา ({displaySongs.length} เพลง)
                </span>
                {searchSource === 'youtube' ? (
                  <span className="ml-1 px-1.5 py-0.2 rounded-md bg-red-950/60 border border-red-500/30 text-red-300 text-[10px] font-bold">
                    YouTube
                  </span>
                ) : (
                  <span className="ml-1 px-1.5 py-0.2 rounded-md bg-violet-950/60 border border-violet-500/30 text-violet-300 text-[10px] font-bold">
                    ในคลัง
                  </span>
                )}
              </>
            ) : hasHistory ? (
              <>
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                <span>เพลงที่คุณร้องบ่อยที่สุด</span>
              </>
            ) : (
              <>
                <Flame className="w-3.5 h-3.5 text-pink-500" />
                <span>เพลงแนะนำในคลัง</span>
              </>
            )}
          </div>

          {!isSearchActive && (
            <span className="text-[11px] text-zinc-500">
              กด + เพิ่ม ได้ทันที
            </span>
          )}
        </div>

        {/* Songs List */}
        <div className="space-y-2.5">
          {displaySongs.length === 0 ? (
            <div className="py-12 text-center rounded-2xl bg-zinc-900/40 border border-zinc-850 p-6 space-y-3">
              <Search className="w-8 h-8 text-zinc-600 mx-auto" />
              <p className="text-sm font-semibold text-zinc-300">
                ไม่พบเพลงในคลัง
              </p>
              <p className="text-xs text-zinc-400 max-w-xs mx-auto">
                กดปุ่ม &quot;Enter&quot; บนคีย์บอร์ด หรือคลิกปุ่มด้านล่างเพื่อค้นหาบน YouTube อัตโนมัติ
              </p>
              <button
                type="button"
                disabled={loadingSearch}
                onClick={handleExplicitYouTubeSearch}
                className="mt-2 py-2 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 disabled:opacity-50 text-white font-bold text-xs shadow-md shadow-pink-600/20 active:scale-[0.98] transition inline-flex items-center gap-1.5"
              >
                {loadingSearch ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>ค้นหาบน YouTube ทันที</span>
              </button>
            </div>
          ) : (
            displaySongs.map((video) => {
              const isJustAdded = justAddedIds.has(video.youtube_video_id);
              const isAlreadyInQueue = queue.some(
                (item) => item.youtube_video_id === video.youtube_video_id
              );

              return (
                <div
                  key={video.id || video.youtube_video_id}
                  className={`group p-2.5 sm:p-3 rounded-2xl border transition-all duration-200 flex items-center gap-3 ${
                    isJustAdded
                      ? 'bg-emerald-950/20 border-emerald-500/40 shadow-lg shadow-emerald-950/20'
                      : 'bg-zinc-900/70 hover:bg-zinc-900 border-zinc-800/80 hover:border-zinc-700/80 shadow-md'
                  }`}
                >
                  {/* Thumbnail */}
                  <div className="relative w-20 h-14 sm:w-24 sm:h-16 rounded-xl overflow-hidden bg-zinc-950 shrink-0">
                    <img
                      src={video.thumbnail_url}
                      alt={video.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <span className="absolute bottom-1 right-1 rounded-md bg-black/80 px-1 py-0.2 font-mono text-[9px] font-medium text-zinc-300 backdrop-blur-sm">
                      {formatDuration(video.duration)}
                    </span>
                  </div>

                  {/* Song Details */}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs sm:text-sm font-bold text-white line-clamp-1 group-hover:text-violet-200 transition">
                      {video.title}
                    </h3>
                    <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                      {video.channel_name || video.artist || 'Karaoke'}
                    </p>
                    {!isSearchActive && video.playCount !== undefined && video.playCount > 0 ? (
                      <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-amber-300 bg-amber-950/40 border border-amber-500/30 px-1.5 py-0.5 rounded-md">
                        <Flame className="w-2.5 h-2.5 fill-current text-amber-400" />
                        <span>ร้องบ่อย {video.playCount} ครั้ง</span>
                      </span>
                    ) : isAlreadyInQueue && !isJustAdded ? (
                      <span className="inline-block mt-1 text-[10px] text-violet-400 font-medium">
                        อยู่ในคิวแล้ว
                      </span>
                    ) : null}
                  </div>

                  {/* Action Button: Direct Add */}
                  <div className="shrink-0">
                    {isJustAdded ? (
                      <div className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-bold text-xs animate-in zoom-in-95 duration-150">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                        <span>เพิ่มแล้ว!</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAddSong(video)}
                        className="flex items-center justify-center gap-1 px-3.5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white font-bold text-xs shadow-md shadow-pink-600/20 active:scale-[0.96] transition"
                        title="เพิ่มเพลงนี้ลงคิว"
                      >
                        <span>+ เพิ่ม</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      {/* ==========================================
          BOTTOM STRIP: MY SONGS & QUEUE STATUS
          ========================================== */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-xl border-t border-zinc-800/80 p-3 sm:p-4 shadow-2xl">
        <div className="max-w-2xl mx-auto">
          {/* Main Footer Button / Bar */}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setIsQueueDrawerOpen((prev) => !prev)}
              className="flex items-center gap-2.5 text-left min-w-0 flex-1 hover:opacity-90 transition"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600/20 text-violet-400 border border-violet-500/30 shrink-0">
                <Mic className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">คิวของฉัน</span>
                  <span className="rounded-full bg-violet-600/30 px-1.5 py-0.2 font-mono text-[10px] font-bold text-violet-300">
                    {myQueueItems.length} เพลง
                  </span>
                </div>
                {myQueueItems.length > 0 && waitInfo ? (
                  <p className="text-[11px] text-zinc-400 truncate flex items-center gap-1.5 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>
                      {waitInfo.songsAhead === 0
                        ? 'กำลังร้องหรือเพลงถัดไป!'
                        : `รออีก ${waitInfo.songsAhead} เพลง (${formatMinutes(waitInfo.waitSeconds)})`}
                    </span>
                  </p>
                ) : (
                  <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                    ยังไม่มีเพลงในคิว • กด + เพิ่ม ได้เลย
                  </p>
                )}
              </div>
            </button>

            {myQueueItems.length > 0 && (
              <button
                type="button"
                onClick={() => setIsQueueDrawerOpen((prev) => !prev)}
                className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition"
              >
                {isQueueDrawerOpen ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronUp className="w-4 h-4" />
                )}
              </button>
            )}
          </div>

          {/* Expandable Drawer: User's Song List */}
          {isQueueDrawerOpen && myQueueItems.length > 0 && (
            <div className="mt-3 pt-3 border-t border-zinc-800/80 max-h-60 overflow-y-auto space-y-2 animate-in slide-in-from-bottom-2 duration-150 pr-1">
              {myQueueItems.map((item, idx) => {
                const itemWait = calculateEstimatedWait(queue, item.id, currentTime);
                return (
                  <div
                    key={item.id}
                    className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-md bg-zinc-800 flex items-center justify-center font-bold text-[10px] text-zinc-400 shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate max-w-[200px] sm:max-w-xs">
                          {item.video?.title}
                        </p>
                        <p className="text-[10px] text-zinc-400 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5 text-zinc-500" />
                          <span>
                            {itemWait.songsAhead === 0
                              ? 'ถึงคิวของคุณแล้ว!'
                              : `รออีก ~${formatMinutes(itemWait.waitSeconds)}`}
                          </span>
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCancelSong(item.id)}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                      title="ยกเลิกเพลงนี้"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
