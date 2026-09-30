'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useKaraoke } from '@/context/KaraokeContext';
import { useAuth } from '@/context/AuthContext';
import { SongCard } from '@/components/SongCard';
import { AddToQueueModal } from '@/components/AddToQueueModal';
import { YouTubeVideo } from '@/lib/types';
import { Heart, Plus, Play, Music, ArrowRight, Check } from 'lucide-react';

export default function FavoritesPage() {
  const { favorites, addToQueue } = useKaraoke();
  const { nickname } = useAuth();
  const [modalVideo, setModalVideo] = useState<YouTubeVideo | null>(null);
  const [addedAll, setAddedAll] = useState(false);

  const handleQueueAll = async (): Promise<void> => {
    try {
      for (const favorite of favorites) {
        await addToQueue(favorite.video, nickname, [nickname]);
      }
      setAddedAll(true);
      setTimeout(() => setAddedAll(false), 2000);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-1 flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-2.5">
            <Heart className="w-7 h-7 text-pink-500 fill-pink-500" />
            <span>My Favorite Tracks</span>
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Your personal collection of go-to karaoke anthems.
          </p>
        </div>

        {favorites.length > 0 && (
          <button
            onClick={handleQueueAll}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-violet-600 hover:from-pink-500 hover:to-violet-500 text-white font-semibold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-pink-600/30 transition self-start sm:self-auto"
          >
            {addedAll ? <Check className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{addedAll ? 'Queued All!' : 'Queue All Favorites'}</span>
          </button>
        )}
      </div>

      {favorites.length === 0 ? (
        <div className="py-24 text-center rounded-3xl bg-zinc-900/30 border border-zinc-800 p-8 max-w-md mx-auto">
          <Heart className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white mb-1">No favorite songs yet</h3>
          <p className="text-xs text-zinc-400 mb-4">
            Click the heart icon on any karaoke song card to save it to your personal favorites!
          </p>
          <Link
            href="/search"
            className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition inline-flex items-center gap-1.5"
          >
            <span>Explore Songs</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {favorites.map((fav) => (
            <SongCard
              key={fav.id}
              video={fav.video}
              onOpenQueueModal={(v) => setModalVideo(v)}
            />
          ))}
        </div>
      )}

      {modalVideo && (
        <AddToQueueModal video={modalVideo} onClose={() => setModalVideo(null)} />
      )}
    </div>
  );
}
