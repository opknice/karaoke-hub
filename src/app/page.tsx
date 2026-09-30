'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useKaraoke } from '@/context/KaraokeContext';
import { useAuth } from '@/context/AuthContext';
import { SongCard } from '@/components/SongCard';
import { AddToQueueModal } from '@/components/AddToQueueModal';
import { InstantSearchBox } from '@/components/InstantSearchBox';
import { YouTubeVideo } from '@/lib/types';
import { SEED_KARAOKE_VIDEOS } from '@/lib/karaoke-seed';
import {
  Mic,
  Search,
  Sparkles,
  Play,
  Users,
  Tv,
  ListMusic,
  Flame,
  ArrowRight,
  Music2,
  CheckCircle2,
  X,
} from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const { nowPlaying, queue, playlists, addPlaylistToQueue } = useKaraoke();
  const { nickname } = useAuth();
  const [modalVideo, setModalVideo] = useState<YouTubeVideo | null>(null);
  const [previewVideo, setPreviewVideo] = useState<YouTubeVideo | null>(null);

  const featuredTracks = SEED_KARAOKE_VIDEOS.slice(0, 8);
  const duetTracks = SEED_KARAOKE_VIDEOS.filter(
    (v) =>
      v.title.toLowerCase().includes('duet') ||
      v.title.toLowerCase().includes('ft.') ||
      v.artist?.toLowerCase().includes('ft')
  ).slice(0, 4);

  return (
    <div className="flex-1 flex flex-col">
      {/* Hero Section */}
      <section className="relative px-4 sm:px-6 lg:px-8 pt-10 pb-16 max-w-7xl mx-auto w-full">
        <div className="text-center max-w-3xl mx-auto space-y-6">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-violet-950/80 border border-violet-500/30 text-violet-300 text-xs font-semibold shadow-lg shadow-violet-900/20 backdrop-blur-md">
            <Sparkles className="w-3.5 h-3.5 text-pink-400" />
            <span>Next-Gen YouTube Karaoke Session Manager</span>
          </div>

          {/* Main Title */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
            Sing Together, <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
              Queue Like A Pro.
            </span>
          </h1>

          <p className="text-sm sm:text-base text-zinc-400 max-w-xl mx-auto">
            Manage your karaoke night with smart singer rotation, YouTube video preview, party rooms with QR code requests, and community rating.
          </p>

          {/* YouTube-Style Instant Search Bar with Live Preview */}
          <div className="max-w-xl mx-auto pt-2">
            <InstantSearchBox size="large" placeholder="ค้นหาเพลง, ศิลปิน, หรือ YouTube Karaoke..." />
          </div>

          {/* Action Pills */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/search"
              className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white text-xs font-semibold flex items-center gap-2 transition"
            >
              <Mic className="w-3.5 h-3.5 text-pink-400" />
              <span>Browse Catalog</span>
            </Link>
            <Link
              href="/party"
              className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white text-xs font-semibold flex items-center gap-2 transition"
            >
              <Users className="w-3.5 h-3.5 text-cyan-400" />
              <span>Host Party Room</span>
            </Link>
            <Link
              href="/player"
              className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white text-xs font-semibold flex items-center gap-2 transition"
            >
              <Tv className="w-3.5 h-3.5 text-amber-400" />
              <span>TV Display Mode</span>
            </Link>
          </div>
        </div>

        {/* Live Session Quick Banner (If song is active) */}
        {nowPlaying && (
          <div className="mt-12 rounded-3xl bg-gradient-to-r from-violet-950/60 via-zinc-900/90 to-pink-950/60 border border-violet-500/30 p-4 sm:p-6 shadow-2xl backdrop-blur-xl flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-14 sm:w-28 sm:h-18 rounded-2xl overflow-hidden bg-zinc-950 shrink-0 border border-violet-500/30">
                <img
                  src={nowPlaying.video.thumbnail_url}
                  alt={nowPlaying.video.title}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-violet-600/20 mix-blend-overlay" />
              </div>
              <div>
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 text-xs font-bold border border-pink-500/30 mb-1">
                  <span className="w-2 h-2 rounded-full bg-pink-400 animate-ping" />
                  <span>Session Live</span>
                </div>
                <h3 className="text-base sm:text-lg font-bold text-white line-clamp-1">
                  {nowPlaying.video.title}
                </h3>
                <p className="text-xs text-zinc-400">
                  Singer:{' '}
                  <span className="text-cyan-400 font-semibold">
                    {nowPlaying.singers.map((s) => s.name).join(' & ') || nowPlaying.requested_by}
                  </span>{' '}
                  • {queue.length} songs in queue
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto justify-end">
              <Link
                href="/queue"
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-2 transition"
              >
                <ListMusic className="w-4 h-4" />
                <span>View Queue</span>
              </Link>
              <Link
                href="/player"
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-violet-600/30 transition"
              >
                <Tv className="w-4 h-4" />
                <span>Open Player</span>
              </Link>
            </div>
          </div>
        )}
      </section>

      {/* Featured Songs Grid */}
      <section className="px-4 sm:px-6 lg:px-8 py-10 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-pink-500 to-violet-600 flex items-center justify-center">
              <Flame className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white">Popular Karaoke Tracks</h2>
              <p className="text-xs text-zinc-400">Community verified with high karaoke scores</p>
            </div>
          </div>

          <Link
            href="/search"
            className="text-xs font-semibold text-violet-400 hover:text-violet-300 flex items-center gap-1 transition"
          >
            <span>See all songs</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {featuredTracks.map((video) => (
            <SongCard
              key={video.id}
              video={video}
              onOpenQueueModal={(v) => setModalVideo(v)}
              onPreview={(v) => setPreviewVideo(v)}
            />
          ))}
        </div>
      </section>

      {/* Quick Party Feature Highlights */}
      <section className="px-4 sm:px-6 lg:px-8 py-12 max-w-7xl mx-auto w-full">
        <div className="rounded-3xl bg-zinc-900/40 border border-zinc-800 p-8 sm:p-10">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-2xl sm:text-3xl font-black text-white">
              Why Karaoke Session Manager?
            </h2>
            <p className="text-sm text-zinc-400 mt-2">
              Designed specifically for house parties, karaoke lounges, and sing-along nights with friends.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-violet-600/20 text-violet-400 flex items-center justify-center font-bold">
                1
              </div>
              <h3 className="text-lg font-bold text-white">Smart Singer Rotation</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                No single person monopolizes the microphone! Smart rotation prioritizes fair waiting times and alternates between all singers automatically.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-pink-600/20 text-pink-400 flex items-center justify-center font-bold">
                2
              </div>
              <h3 className="text-lg font-bold text-white">Guest Mobile QR Join</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Guests just point their phone camera at the TV QR code. No app download needed — they can immediately search and queue their favorite tracks!
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-600/20 text-cyan-400 flex items-center justify-center font-bold">
                3
              </div>
              <h3 className="text-lg font-bold text-white">Community Score Database</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Tired of bad karaoke tracks with heavy vocals? Our rating system identifies the cleanest instrumental and lyric videos so you sing the best version.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Add To Queue Modal */}
      {modalVideo && (
        <AddToQueueModal video={modalVideo} onClose={() => setModalVideo(null)} />
      )}

      {/* YouTube Preview Modal */}
      {previewVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-2xl rounded-3xl bg-zinc-950 border border-zinc-800 p-4 sm:p-5 shadow-2xl relative text-white">
            <button
              onClick={() => setPreviewVideo(null)}
              className="absolute top-4 right-4 p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <h4 className="text-sm font-bold mb-3 pr-10 truncate text-zinc-200">
              {previewVideo.title}
            </h4>
            <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black border border-zinc-800">
              <iframe
                src={`https://www.youtube.com/embed/${previewVideo.youtube_video_id}?autoplay=1&enablejsapi=1&rel=0`}
                title="Preview"
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  setModalVideo(previewVideo);
                  setPreviewVideo(null);
                }}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-md transition"
              >
                Add to Queue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
