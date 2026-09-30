'use client';

import React, { useState } from 'react';
import { useKaraoke } from '@/context/KaraokeContext';
import { Star, ThumbsUp, X, Check, Sparkles } from 'lucide-react';

export const RatingModal: React.FC = () => {
  const { ratingModalItem, setRatingModalItem, submitRating } = useKaraoke();

  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [selectedTags, setSelectedTags] = useState<string[]>(['Good Karaoke', 'Lyrics Correct']);

  if (!ratingModalItem) return null;

  const availableTags = [
    'Good Karaoke',
    'Good Instrumental',
    'Lyrics Correct',
    'No Vocal',
    'Lyrics Too Fast',
    'Lyrics Too Slow',
    'Vocal Still Present',
    'Audio Quality Poor',
    'Not Karaoke',
  ];

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleClose = () => {
    setRatingModalItem(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitRating(ratingModalItem.youtube_video_id, rating, selectedTags);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-3xl bg-zinc-950 border border-zinc-800 p-6 shadow-2xl relative text-white">
        <button
          onClick={handleClose}
          className="absolute top-5 right-5 p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-pink-500 flex items-center justify-center shadow-lg">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold">Rate this Karaoke Track</h3>
            <p className="text-xs text-zinc-400">Help the community discover the best version!</p>
          </div>
        </div>

        {/* Song info */}
        <div className="p-3 rounded-2xl bg-zinc-900/60 border border-zinc-800 mb-5">
          <p className="text-sm font-semibold text-white line-clamp-1">{ratingModalItem.title}</p>
          <p className="text-xs text-zinc-400">{ratingModalItem.channel_name}</p>
        </div>

        {/* Star Rating */}
        <div className="flex flex-col items-center justify-center mb-6">
          <div className="flex items-center gap-2 mb-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                onClick={() => setRating(star)}
                className="p-1 transition-transform hover:scale-125"
              >
                <Star
                  className={`w-8 h-8 ${
                    (hoverRating || rating) >= star
                      ? 'text-amber-400 fill-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                      : 'text-zinc-700'
                  }`}
                />
              </button>
            ))}
          </div>
          <span className="text-xs font-semibold text-amber-300">
            {rating === 5
              ? 'Outstanding Version! 🌟'
              : rating === 4
              ? 'Great Karaoke Track 👍'
              : rating === 3
              ? 'Average Track 😐'
              : 'Needs Better Version 👎'}
          </span>
        </div>

        {/* Feedback Tags (Spec Section 6) */}
        <div className="mb-6">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-2">
            Feedback Tags
          </label>
          <div className="flex flex-wrap gap-1.5">
            {availableTags.map((tag) => {
              const active = selectedTags.includes(tag);
              const isNegative =
                tag.includes('Poor') ||
                tag.includes('Not Karaoke') ||
                tag.includes('Too Fast') ||
                tag.includes('Too Slow') ||
                tag.includes('Vocal Still Present');

              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
                    active
                      ? isNegative
                        ? 'bg-rose-950/60 border-rose-500/50 text-rose-300'
                        : 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {active && <Check className="w-3 h-3 inline mr-1" />}
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 font-semibold text-sm transition"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-pink-500 hover:from-amber-400 hover:to-pink-400 text-white font-semibold text-sm shadow-lg shadow-amber-500/20 transition"
          >
            Submit Feedback
          </button>
        </div>
      </div>
    </div>
  );
};
