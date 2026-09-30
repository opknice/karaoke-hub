'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useKaraoke } from '@/context/KaraokeContext';
import { useAuth } from '@/context/AuthContext';
import { SongCard } from '@/components/SongCard';
import { Playlist, YouTubeVideo } from '@/lib/types';
import {
  ListMusic,
  Plus,
  Play,
  Trash2,
  Share2,
  FolderPlus,
  Music,
  ArrowRight,
  Check,
  X,
} from 'lucide-react';
import { formatDuration } from '@/lib/queue-algorithm';

export default function PlaylistsPage() {
  const { playlists, createPlaylist, deletePlaylist, removeSongFromPlaylist, addPlaylistToQueue } =
    useKaraoke();
  const { nickname } = useAuth();

  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(
    playlists[0]?.id || null
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [queueAddedNotification, setQueueAddedNotification] = useState(false);

  const activePlaylist = playlists.find((p) => p.id === activePlaylistId) || playlists[0];

  const handleCreatePlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const created = createPlaylist(newTitle, newDesc);
    setActivePlaylistId(created.id);
    setNewTitle('');
    setNewDesc('');
    setShowCreateModal(false);
  };

  const handleAddAllToQueue = async (): Promise<void> => {
    if (!activePlaylist) return;
    try {
      await addPlaylistToQueue(activePlaylist.id, nickname);
      setQueueAddedNotification(true);
      setTimeout(() => setQueueAddedNotification(false), 2000);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-1 flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-2.5">
            <ListMusic className="w-7 h-7 text-pink-500" />
            <span>Karaoke Playlists</span>
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Build custom setlists for your singing rehearsals and party events.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white font-semibold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-violet-600/30 transition self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Playlist</span>
        </button>
      </div>

      {playlists.length === 0 ? (
        <div className="py-24 text-center rounded-3xl bg-zinc-900/30 border border-zinc-800 p-8 max-w-md mx-auto">
          <FolderPlus className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white mb-1">No playlists yet</h3>
          <p className="text-xs text-zinc-400 mb-4">
            Create your first playlist to group your favorite karaoke songs together!
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition"
          >
            Create Playlist
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1">
          {/* Left: Playlists List */}
          <div className="lg:col-span-1 space-y-2">
            <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider px-2 mb-2">
              Your Collections ({playlists.length})
            </div>

            {playlists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => setActivePlaylistId(pl.id)}
                className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-center justify-between group ${
                  activePlaylist?.id === pl.id
                    ? 'bg-zinc-900 border-violet-500/60 shadow-lg shadow-violet-950/20'
                    : 'bg-zinc-900/40 border-zinc-800/80 hover:bg-zinc-900/80 hover:border-zinc-700'
                }`}
              >
                <div className="min-w-0 pr-2">
                  <h4 className="text-sm font-semibold text-white truncate group-hover:text-violet-300">
                    {pl.name}
                  </h4>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {pl.items?.length || 0} {pl.items?.length === 1 ? 'song' : 'songs'}
                  </p>
                </div>
                <ArrowRight
                  className={`w-4 h-4 shrink-0 transition ${
                    activePlaylist?.id === pl.id ? 'text-violet-400 translate-x-1' : 'text-zinc-600'
                  }`}
                />
              </button>
            ))}
          </div>

          {/* Right: Active Playlist Content */}
          {activePlaylist && (
            <div className="lg:col-span-3 rounded-3xl bg-zinc-900/40 border border-zinc-800/80 p-6 flex flex-col">
              {/* Playlist Details Top Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
                <div>
                  <h2 className="text-2xl font-black text-white">{activePlaylist.name}</h2>
                  {activePlaylist.description && (
                    <p className="text-xs text-zinc-400 mt-1">{activePlaylist.description}</p>
                  )}
                  <p className="text-xs text-zinc-500 mt-1">
                    {activePlaylist.items?.length || 0} songs • Curated by {nickname}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAddAllToQueue}
                    disabled={!activePlaylist.items || activePlaylist.items.length === 0}
                    className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-violet-600/30 transition"
                  >
                    {queueAddedNotification ? <Check className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                    <span>{queueAddedNotification ? 'Added to Queue!' : 'Add All to Queue'}</span>
                  </button>

                  <button
                    onClick={() => {
                      if (confirm(`Delete playlist "${activePlaylist.name}"?`)) {
                        deletePlaylist(activePlaylist.id);
                      }
                    }}
                    className="p-2 rounded-xl text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition"
                    title="Delete playlist"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Song Items */}
              <div className="pt-6 flex-1 space-y-3">
                {!activePlaylist.items || activePlaylist.items.length === 0 ? (
                  <div className="py-16 text-center">
                    <Music className="w-10 h-10 text-zinc-600 mx-auto mb-2" />
                    <p className="text-zinc-400 text-sm mb-3">This playlist has no songs yet.</p>
                    <Link
                      href="/search"
                      className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold inline-flex items-center gap-1.5 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add songs from search</span>
                    </Link>
                  </div>
                ) : (
                  activePlaylist.items.map((item, index) => (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-2xl bg-zinc-900/70 border border-zinc-800 flex items-center justify-between gap-4 group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-6 text-center text-xs font-mono font-bold text-zinc-500">
                          {index + 1}
                        </span>

                        <img
                          src={item.video?.thumbnail_url}
                          alt={item.video?.title}
                          className="w-16 h-11 rounded-xl object-cover shrink-0"
                        />

                        <div className="min-w-0">
                          <h4 className="text-xs sm:text-sm font-semibold text-white truncate">
                            {item.video?.title}
                          </h4>
                          <p className="text-[11px] text-zinc-400 truncate">
                            {item.video?.channel_name} • {formatDuration(item.video?.duration || 210)}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => removeSongFromPlaylist(activePlaylist.id, item.youtube_video_id)}
                        className="p-2 text-zinc-500 hover:text-red-400 rounded-xl hover:bg-zinc-800 transition"
                        title="Remove from playlist"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-3xl bg-zinc-950 border border-zinc-800 p-6 shadow-2xl relative text-white">
            <button
              onClick={() => setShowCreateModal(false)}
              className="absolute top-5 right-5 p-2 rounded-full text-zinc-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold mb-4">Create New Playlist</h3>

            <form onSubmit={handleCreatePlaylist} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">Playlist Name</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. 90s Rock Night, Duets with Bae"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-white text-sm focus:outline-none focus:border-violet-500"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">Description (Optional)</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Short note about this setlist..."
                  rows={3}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-white text-xs focus:outline-none focus:border-violet-500"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-900 text-zinc-400 font-semibold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 text-white font-semibold text-xs shadow-lg"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
