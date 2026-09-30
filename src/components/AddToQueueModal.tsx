'use client';

import React, { useState } from 'react';
import { YouTubeVideo } from '@/lib/types';
import { useKaraoke } from '@/context/KaraokeContext';
import { useAuth } from '@/context/AuthContext';
import { X, Mic, Users, Play, Plus, Music } from 'lucide-react';
import { formatDuration } from '@/lib/queue-algorithm';

interface AddToQueueModalProps {
  video: YouTubeVideo | null;
  onClose: () => void;
}

export const AddToQueueModal: React.FC<AddToQueueModalProps> = ({ video, onClose }) => {
  const { addToQueue, roomMembers } = useKaraoke();
  const { nickname } = useAuth();

  const [singerMode, setSingerMode] = useState<'solo' | 'duet' | 'group'>('solo');
  const [singer1, setSinger1] = useState(nickname);
  const [singer2, setSinger2] = useState('');
  const [notes, setNotes] = useState('');
  const [playImmediately, setPlayImmediately] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  if (!video) return null;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (isSubmitting) return;

    const singers: string[] = [];
    if (singer1.trim()) singers.push(singer1.trim());
    if (singerMode !== 'solo' && singer2.trim()) {
      singers.push(singer2.trim());
    }

    if (singers.length === 0) {
      singers.push(nickname || 'Singer');
    }

    setIsSubmitting(true);
    setSubmitError('');
    try {
      await addToQueue(video, singer1 || nickname, singers, notes, playImmediately);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'ไม่สามารถเพิ่มเพลงได้');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-3xl bg-zinc-950 border border-zinc-800 p-6 shadow-2xl relative text-white">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-violet-600 to-pink-500 flex items-center justify-center shadow-lg">
            <Mic className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold">Add Song to Queue</h3>
            <p className="text-xs text-zinc-400">Select singer and karaoke options</p>
          </div>
        </div>

        {/* Video Preview Card */}
        <div className="flex gap-3 p-3 rounded-2xl bg-zinc-900/80 border border-zinc-800 mb-5">
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="w-20 h-14 object-cover rounded-xl shrink-0"
          />
          <div className="min-w-0">
            <h4 className="text-xs font-semibold text-white line-clamp-1">{video.title}</h4>
            <p className="text-[11px] text-zinc-400 mt-0.5 truncate">{video.channel_name}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                {formatDuration(video.duration)}
              </span>
              <span className="text-[10px] text-emerald-400 font-semibold">{video.karaoke_score}% Match</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Singer Mode Selection (Solo vs Duet) */}
          <div>
            <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block mb-2">
              Performance Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSingerMode('solo')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border transition ${
                  singerMode === 'solo'
                    ? 'bg-violet-600/20 border-violet-500 text-violet-300 shadow'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                <Mic className="w-3.5 h-3.5" />
                <span>Solo Singer</span>
              </button>

              <button
                type="button"
                onClick={() => setSingerMode('duet')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border transition ${
                  singerMode === 'duet'
                    ? 'bg-pink-600/20 border-pink-500 text-pink-300 shadow'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Duet / Group</span>
              </button>
            </div>
          </div>

          {/* Singer Name 1 */}
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">
              {singerMode === 'solo' ? 'Singer Name' : 'Singer 1'}
            </label>
            <input
              type="text"
              value={singer1}
              onChange={(e) => setSinger1(e.target.value)}
              placeholder="e.g. John"
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-violet-500 transition"
              required
            />
          </div>

          {/* Singer Name 2 (For Duet) */}
          {singerMode === 'duet' && (
            <div className="animate-in slide-in-from-top-1">
              <label className="text-xs font-medium text-pink-300 block mb-1">Singer 2 (Duet Partner)</label>
              <input
                type="text"
                value={singer2}
                onChange={(e) => setSinger2(e.target.value)}
                placeholder="e.g. Sarah"
                className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-pink-500 transition"
                required
              />
            </div>
          )}

          {/* Room quick singers suggestion */}
          {roomMembers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-zinc-500">Party members:</span>
              {roomMembers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    if (singerMode === 'duet' && singer1) setSinger2(m.nickname);
                    else setSinger1(m.nickname);
                  }}
                  className="px-2 py-0.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] transition"
                >
                  +{m.nickname}
                </button>
              ))}
            </div>
          )}

          {/* Optional Note */}
          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">Note (Optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Birthday request, Key +1"
              className="w-full px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-white placeholder-zinc-500 text-xs focus:outline-none focus:border-zinc-700"
            />
          </div>

          {/* Play Immediately Checkbox */}
          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={playImmediately}
              onChange={(e) => setPlayImmediately(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-violet-600 focus:ring-violet-500"
            />
            <span className="text-xs text-zinc-300">Play immediately (interrupt current song)</span>
          </label>

          {/* Submit Actions */}
          {submitError && (
            <p role="alert" className="text-xs text-rose-300">
              {submitError}
            </p>
          )}
          <div className="pt-3 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 font-semibold text-sm transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white font-semibold text-sm shadow-lg shadow-violet-600/30 transition flex items-center justify-center gap-2"
            >
              {playImmediately ? <Play className="w-4 h-4 fill-current" /> : <Plus className="w-4 h-4" />}
              <span>{isSubmitting ? 'Saving…' : playImmediately ? 'Play Now' : 'Add to Queue'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
