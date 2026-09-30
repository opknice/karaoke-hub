'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import type { YouTubeVideo } from '@/lib/types';
import { searchYouTubeKaraoke, getLocalSearchPreview, isDirectVideoQuery } from '@/lib/youtube-search-client';
import { SearchBudgetNotice } from '@/components/SearchBudgetNotice';
import { YouTubeSearchFallback } from '@/components/YouTubeSearchFallback';
import { SongCard } from '@/components/SongCard';
import { AddToQueueModal } from '@/components/AddToQueueModal';
import { Search, X, Loader2, Music, Mic2 } from 'lucide-react';
import { useCatalogPreview } from '@/lib/use-catalog-preview';

const MIN_SEARCH_LENGTH = 2;

function SearchPageContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const requestRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<YouTubeVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [modalVideo, setModalVideo] = useState<YouTubeVideo | null>(null);
  const [previewVideo, setPreviewVideo] = useState<YouTubeVideo | null>(null);
  const [searchSource, setSearchSource] = useState<'catalog' | 'youtube'>('catalog');
  const receivePreview = useCallback((videos: YouTubeVideo[]) => setResults(videos), []);
  const catalogError = useCatalogPreview(query, !loading && !hasSubmitted, receivePreview);

  const tags = [
    { id: 'all', label: 'All Songs' },
    { id: 'thai', label: 'Thai Karaoke' },
    { id: 'pop', label: 'Pop Classics' },
    { id: 'rock', label: 'Rock & 90s' },
    { id: 'duet', label: 'Duet & Collab' },
    { id: 'ballad', label: 'Slow & Ballad' },
  ];

  const performSearch = useCallback(async (q: string, tag: string, source: 'catalog' | 'youtube' = 'catalog') => {
    if (requestRef.current && !requestRef.current.signal.aborted) return;
    const normalizedQuery = q.trim();
    if (normalizedQuery.length < MIN_SEARCH_LENGTH) {
      setResults([]);
      setLoading(false);
      setErrorMessage('');
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setHasSubmitted(true);
    setSearchSource(source);
    setLoading(true);
    setErrorMessage('');
    try {
      let finalQuery = normalizedQuery;
      if (source === 'youtube' && !isDirectVideoQuery(finalQuery)) {
        if (tag === 'thai' && !finalQuery.toLowerCase().includes('thai')) finalQuery += ' thai';
        if (tag === 'rock' && !finalQuery.toLowerCase().includes('rock')) finalQuery += ' rock';
        if (tag === 'duet' && !finalQuery.toLowerCase().includes('duet')) finalQuery += ' duet';
      }

      const nextResults = await searchYouTubeKaraoke(finalQuery, controller.signal, source);
      if (!controller.signal.aborted) setResults(nextResults);
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      console.error('Search request failed', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'ค้นหาเพลงไม่สำเร็จ กรุณาลองใหม่'
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => requestRef.current?.abort();
  }, []);

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void performSearch(query, selectedTag);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-1 flex flex-col">
      {/* Header */}
      <div className="mb-6 space-y-2">
        <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-2">
          <Mic2 className="w-7 h-7 text-pink-500" />
          <span>Karaoke Search</span>
        </h1>
        <p className="text-xs sm:text-sm text-zinc-400">
          ค้นหาคาราโอเกะด้วยชื่อเพลง ศิลปิน หรือท่อนเนื้อร้อง ผลค้นจากเนื้อร้องอาจไม่ครบ
        </p>
      </div>

      {/* Search Input Box */}
      <form onSubmit={handleManualSearch} className="relative mb-4">
        <div className="relative flex items-center">
          <Search className="w-5 h-5 text-zinc-400 absolute left-4" />
          <input
            ref={inputRef}
            aria-label="ชื่อเพลง ศิลปิน เนื้อร้อง หรือลิงก์ YouTube"
            type="text"
            value={query}
            onChange={(e) => {
              requestRef.current?.abort();
              setQuery(e.target.value);
              setHasSubmitted(false);
              setSearchSource('catalog');
              setResults(getLocalSearchPreview(e.target.value));
              setLoading(false);
              setErrorMessage('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.repeat)) e.preventDefault();
            }}
            placeholder="ชื่อเพลง ศิลปิน ท่อนเนื้อร้อง หรือลิงก์ YouTube แล้วกด Enter"
            autoComplete="off"
            spellCheck={false}
            className="w-full pl-12 pr-28 py-3.5 rounded-2xl bg-zinc-900 border border-zinc-700/80 focus:border-violet-500 text-white placeholder-zinc-500 text-sm focus:outline-none transition shadow-xl"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                requestRef.current?.abort();
                setQuery(''); setResults([]); setLoading(false); setErrorMessage('');
              }}
              className="absolute right-24 p-1 text-zinc-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="submit"
            disabled={loading}
            className="absolute right-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition flex items-center gap-1.5 shadow-md shadow-violet-600/30"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>ค้นในคลัง</span>
          </button>
        </div>
      </form>

      {/* Filter Category Tabs */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={loading || query.trim().length < 2 || isDirectVideoQuery(query)} onClick={() => void performSearch(query, selectedTag, 'youtube')}
          className="rounded-lg border border-violet-400/40 px-3 py-2 text-sm text-violet-200 hover:bg-violet-500/20 disabled:opacity-40">ค้นเพิ่มบน YouTube</button>
        <p className="text-xs text-zinc-400">{searchSource === 'youtube' ? 'ผลจาก YouTube / แคชคำค้น' : 'ค้นในคลัง Supabase ขณะพิมพ์ • ไม่ใช้ Search Queries'}</p>
      </div>
      <p className="mb-3 text-xs text-zinc-400">ไม่พบเพลงในคลัง จึงกดค้นเพิ่มบน YouTube • หมวดด้านล่างใช้กับการค้นเพิ่มเท่านั้น</p>
      {catalogError && <p role="status" className="mb-3 text-xs text-amber-200">{catalogError}</p>}
      <SearchBudgetNotice />
      <YouTubeSearchFallback query={query} onPasteLink={() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }} />
      <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-6 scrollbar-none">
        {tags.map((tag) => (
          <button
            key={tag.id}
            onClick={() => setSelectedTag(tag.id)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition border ${
              selectedTag === tag.id
                ? 'bg-violet-600 text-white border-violet-500 shadow-md shadow-violet-600/30'
                : 'bg-zinc-900/80 text-zinc-400 border-zinc-800 hover:text-white hover:bg-zinc-800'
            }`}
          >
            {tag.label}
          </button>
        ))}
      </div>

      {/* Results Section */}
      <div className="flex-1" aria-live="polite" aria-busy={loading}>
        {query.trim().length === 1 && (
          <p className="mb-4 text-center text-xs text-zinc-400">
            พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อเริ่มค้นหา
          </p>
        )}

        {errorMessage && (
          <p className="mb-4 rounded-xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200" role="alert">
            {errorMessage}
          </p>
        )}

        {loading && results.length === 0 ? (
          <div className="py-24 text-center">
            <Loader2 className="w-10 h-10 text-violet-500 animate-spin mx-auto mb-3" />
            <p className="text-zinc-400 text-sm">Searching karaoke versions...</p>
          </div>
        ) : results.length === 0 ? (
          <div className="py-20 text-center rounded-3xl bg-zinc-900/40 border border-zinc-800 p-8 max-w-lg mx-auto">
            <div className="w-14 h-14 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto mb-4">
              <Music className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">{hasSubmitted ? 'ไม่พบเพลง' : 'พร้อมค้นหาเพลง'}</h3>
            <p className="text-xs text-zinc-400 mb-4">
              {hasSubmitted ? 'ลองใช้ชื่อเพลงหรือศิลปินที่เจาะจงขึ้น แล้วกดค้นหา' : 'พิมพ์ชื่อเพลง แล้วกด Enter หรือปุ่มค้นหา'}
            </p>
            <button
              onClick={() => {
                requestRef.current?.abort();
                setLoading(false);
                setResults([]);
                setErrorMessage('');
                setQuery('');
                setSelectedTag('all');
              }}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition"
            >
              Reset Search
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-zinc-400">
                Found <span className="text-violet-400 font-bold">{results.length}</span> karaoke tracks
              </p>
              {loading && (
                <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                  Updating...
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {results.map((video) => (
                <SongCard
                  key={video.id}
                  video={video}
                  onOpenQueueModal={(v) => setModalVideo(v)}
                  onPreview={(v) => setPreviewVideo(v)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add To Queue Modal */}
      {modalVideo && (
        <AddToQueueModal video={modalVideo} onClose={() => setModalVideo(null)} />
      )}

      {/* Preview Modal */}
      {previewVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-2xl rounded-3xl bg-zinc-950 border border-zinc-800 p-4 shadow-2xl relative text-white">
            <button
              onClick={() => setPreviewVideo(null)}
              className="absolute top-4 right-4 p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <h4 className="text-sm font-bold mb-3 pr-10 truncate">{previewVideo.title}</h4>
            <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black border border-zinc-800">
              <iframe
                src={`https://www.youtube.com/embed/${previewVideo.youtube_video_id}?autoplay=1&enablejsapi=1`}
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

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-zinc-400 text-sm">Loading search...</div>}>
      <SearchPageContent />
    </Suspense>
  );
}
