'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { YouTubeVideo } from './types';
import type { YouTubeSearchMode } from './youtube-ranking';
import type { LocalCatalogMeta } from './local-catalog-types';
import {
  deleteLocalCatalog,
  downloadLocalCatalog,
  getLocalCatalogMeta,
  readLocalCatalogSongs,
  syncLocalCatalog,
} from './local-catalog-storage';

export type CatalogMode = 'supabase' | 'local';
const PREFERENCE_KEY = 'karaoke-catalog-mode-v1';
const AUTO_SYNC_INTERVAL_MS = 60_000;

export function useLocalCatalog(
  onResults: (query: string, results: YouTubeVideo[]) => void,
  onReady: () => void,
) {
  const [mode, setMode] = useState<CatalogMode>('supabase');
  const [initialized, setInitialized] = useState(false);
  const [meta, setMeta] = useState<LocalCatalogMeta | null>(null);
  const [stale, setStale] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<'loading' | 'downloading' | 'syncing' | 'deleting' | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const workerReadyRef = useRef(false);
  const downloadRef = useRef<AbortController | null>(null);
  const syncRef = useRef<AbortController | null>(null);
  const metaRef = useRef<LocalCatalogMeta | null>(null);
  const skipNextAutoSyncRef = useRef(false);
  const requestIdRef = useRef(0);
  const workerVersionRef = useRef(0);
  const modeRef = useRef<CatalogMode>('supabase');
  const callbacksRef = useRef({ onResults, onReady });
  useEffect(() => { callbacksRef.current = { onResults, onReady }; }, [onResults, onReady]);
  useEffect(() => { metaRef.current = meta; }, [meta]);

  const disposeWorker = useCallback(() => {
    workerVersionRef.current++;
    requestIdRef.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    workerReadyRef.current = false;
  }, []);

  const stopWorker = useCallback(() => {
    disposeWorker();
    setReady(false);
  }, [disposeWorker]);

  const loadWorker = useCallback(async (snapshot: LocalCatalogMeta) => {
    stopWorker();
    const version = workerVersionRef.current;
    setBusy('loading');
    setError('');
    try {
      const songs = await readLocalCatalogSongs(snapshot);
      if (version !== workerVersionRef.current) return;
      const worker = new Worker(new URL('./local-catalog-worker.ts', import.meta.url));
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<
        { type: 'ready'; count: number } | { type: 'results'; query: string; requestId: number; results: YouTubeVideo[] }
      >) => {
        if (version !== workerVersionRef.current) return;
        if (event.data.type === 'ready') {
          if (event.data.count === 0) {
            stopWorker();
            setError('เพลงในคลังเครื่องหมดอายุแล้ว กรุณาอัปเดตคลัง');
            setPanelOpen(true);
            setBusy(null);
            modeRef.current = 'supabase';
            setMode('supabase');
            localStorage.removeItem(PREFERENCE_KEY);
            return;
          }
          workerReadyRef.current = true;
          setReady(true);
          setBusy(null);
          callbacksRef.current.onReady();
        } else if (event.data.requestId === requestIdRef.current && modeRef.current === 'local') {
          callbacksRef.current.onResults(event.data.query, event.data.results);
        }
      };
      worker.onerror = () => {
        if (version !== workerVersionRef.current) return;
        stopWorker();
        setError('เตรียมการค้นในเครื่องไม่สำเร็จ');
        setPanelOpen(true);
        setBusy(null);
        modeRef.current = 'supabase';
        setMode('supabase');
        localStorage.removeItem(PREFERENCE_KEY);
      };
      worker.postMessage({ type: 'init', songs });
    } catch (cause) {
      if (version !== workerVersionRef.current) return;
      setError(cause instanceof Error ? cause.message : 'เปิดคลังในเครื่องไม่สำเร็จ');
      setPanelOpen(true);
      setBusy(null);
      modeRef.current = 'supabase';
      setMode('supabase');
      localStorage.removeItem(PREFERENCE_KEY);
    }
  }, [stopWorker]);

  useEffect(() => {
    let active = true;
    getLocalCatalogMeta().then((stored) => {
      if (!active) return;
      metaRef.current = stored;
      setMeta(stored);
      setStale(Boolean(stored && Date.now() - Date.parse(stored.updatedAt) > 7 * 86400_000));
      if (stored && localStorage.getItem(PREFERENCE_KEY) === 'local') {
        modeRef.current = 'local';
        setMode('local');
        void loadWorker(stored);
      }
      setInitialized(true);
    }).catch((cause: unknown) => {
      if (active) {
        setError(cause instanceof Error ? cause.message : 'อ่านคลังในเครื่องไม่สำเร็จ');
        setPanelOpen(true);
        setInitialized(true);
      }
    });
    return () => {
      active = false;
      downloadRef.current?.abort();
      syncRef.current?.abort();
      disposeWorker();
    };
  }, [loadWorker, disposeWorker]);

  const search = useCallback((query: string, mode: YouTubeSearchMode = 'song') => {
    const worker = workerRef.current;
    if (modeRef.current !== 'local' || !worker || !workerReadyRef.current) return false;
    requestIdRef.current++;
    worker.postMessage({ type: 'search', query, mode, requestId: requestIdRef.current });
    return true;
  }, []);

  const cancelSearch = useCallback(() => { requestIdRef.current++; }, []);

  const chooseSupabase = useCallback(() => {
    syncRef.current?.abort();
    modeRef.current = 'supabase';
    requestIdRef.current++;
    setMode('supabase');
    localStorage.removeItem(PREFERENCE_KEY);
  }, []);

  const chooseLocal = useCallback(() => {
    if (!meta) {
      setPanelOpen(true);
      return;
    }
    modeRef.current = 'local';
    setMode('local');
    localStorage.setItem(PREFERENCE_KEY, 'local');
    if (!workerRef.current && busy !== 'loading') void loadWorker(meta);
  }, [meta, busy, loadWorker]);

  const download = useCallback(async () => {
    if (downloadRef.current || syncRef.current) return;
    const controller = new AbortController();
    downloadRef.current = controller;
    setBusy('downloading');
    setProgress(0);
    setError('');
    try {
      const snapshot = await downloadLocalCatalog(controller.signal, setProgress);
      metaRef.current = snapshot;
      setMeta(snapshot);
      setStale(false);
      modeRef.current = 'local';
      setMode('local');
      localStorage.setItem(PREFERENCE_KEY, 'local');
      setPanelOpen(false);
      skipNextAutoSyncRef.current = true;
      await loadWorker(snapshot);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'ดาวน์โหลดคลังไม่สำเร็จ');
    } finally {
      downloadRef.current = null;
      setBusy((current) => current === 'downloading' ? null : current);
    }
  }, [loadWorker]);

  const cancelDownload = useCallback(() => downloadRef.current?.abort(), []);

  const sync = useCallback(async () => {
    const snapshot = metaRef.current;
    if (modeRef.current !== 'local' || !snapshot || downloadRef.current || syncRef.current) return;
    const controller = new AbortController();
    syncRef.current = controller;
    setBusy('syncing');
    setProgress(0);
    setError('');
    try {
      const result = await syncLocalCatalog(snapshot, controller.signal, setProgress);
      if (controller.signal.aborted) return;
      metaRef.current = result.meta;
      setMeta(result.meta);
      setStale(false);
      if (result.changed && modeRef.current === 'local') {
        skipNextAutoSyncRef.current = true;
        await loadWorker(result.meta);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'ซิงก์เพลงใหม่ไม่สำเร็จ');
    } finally {
      if (syncRef.current === controller) syncRef.current = null;
      setBusy((current) => current === 'syncing' ? null : current);
    }
  }, [loadWorker]);

  const metaGeneration = meta?.generation;
  useEffect(() => {
    if (!initialized || mode !== 'local' || !metaRef.current || !ready) return;
    if (skipNextAutoSyncRef.current) {
      skipNextAutoSyncRef.current = false;
      return;
    }
    const run = () => { void sync(); };
    run();
    const interval = window.setInterval(run, AUTO_SYNC_INTERVAL_MS);
    const onFocus = () => run();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') run();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [initialized, metaGeneration, mode, ready, sync]);

  const remove = useCallback(async () => {
    downloadRef.current?.abort();
    syncRef.current?.abort();
    stopWorker();
    setBusy('deleting');
    setError('');
    try {
      await deleteLocalCatalog();
      setMeta(null);
      setStale(false);
      modeRef.current = 'supabase';
      setMode('supabase');
      localStorage.removeItem(PREFERENCE_KEY);
      setPanelOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ลบคลังในเครื่องไม่สำเร็จ');
    } finally { setBusy(null); }
  }, [stopWorker]);

  return {
    mode, initialized, meta, stale, ready, busy, progress, error, panelOpen, setPanelOpen,
    search, cancelSearch, chooseSupabase, chooseLocal, download, cancelDownload, sync, remove,
  };
}
