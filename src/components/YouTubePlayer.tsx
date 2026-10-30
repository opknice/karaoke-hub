'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useKaraoke, usePlaybackClock } from '@/context/KaraokeContext';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Maximize2, Mic, Music } from 'lucide-react';
import { formatDuration } from '@/lib/queue-algorithm';
import { loadYouTubeIframeApi } from '@/lib/youtube-iframe-api';
import { shouldMutePlayer } from '@/lib/player-keyboard';
import { getYouTubePlaybackStartSeconds } from '@/lib/youtube-playback';
import { DelayedPlaybackEnd } from '@/lib/vocal-playback';
import { VOCAL_CUT_PAGE_SOURCE } from '@/lib/vocal-cut-bridge';
import {prepareNativePlayerTrack,notifyNativePlayerReady} from '@/lib/native-player-preparation';
import {getVideoVersion} from '@/lib/video-version';

interface YouTubePlayerProps {
  isDisplayMode?: boolean; // TV / Projector Display Screen
  disableVideoInteraction?: boolean;
  tempoExtensionReady: boolean;
  onTempoRateChange: (playbackRate: number) => void;
  nativeVocalDelayMs?: number;
  nativeVocalTransport?: boolean;
  nativeContinuous?: boolean;
  nativePlaybackTime?: number | null;
  nativePlaybackSessionEpoch?: number;
  nativeVideoReady?: boolean;
}

export type TempoDirection = 'increase' | 'decrease';

export interface TempoAdjustmentResult {
  status: 'changed' | 'unavailable' | 'boundary' | 'error';
  playbackRate: number;
  message: string;
}

export interface YouTubePlayerHandle {
  restartCurrentSong: () => void;
  adjustTempo: (direction: TempoDirection) => TempoAdjustmentResult;
}

interface YouTubeCaptionController extends YT.Player {
  setOption?: (module: 'captions', option: 'track', value: Record<string, never>) => void;
}

const disableYouTubeCaptions = (player: YT.Player): void => {
  const captionController = player as YouTubeCaptionController;
  if (typeof captionController.setOption !== 'function') return;

  try {
    // An empty caption track turns off both uploaded and auto-generated captions.
    captionController.setOption('captions', 'track', {});
  } catch {
    // The captions module is not available for every video or at every load stage.
  }
};

const getYouTubePlayerErrorMessage = (errorCode: YT.PlayerError): string => {
  switch (errorCode) {
    case 2:
      return 'รหัสวิดีโอ YouTube ไม่ถูกต้อง กำลังข้ามไปเพลงถัดไป…';
    case 5:
      return 'เบราว์เซอร์ไม่สามารถเล่นวิดีโอนี้ได้ กำลังข้ามไปเพลงถัดไป…';
    case 100:
      return 'วิดีโอนี้ถูกลบ เป็นส่วนตัว หรือไม่มีให้ใช้งานแล้ว กำลังข้ามไปเพลงถัดไป…';
    case 101:
    case 150:
      return 'เจ้าของวิดีโอไม่อนุญาตให้เล่นนอก YouTube กำลังข้ามไปเพลงถัดไป…';
    default:
      return 'YouTube ไม่สามารถเล่นวิดีโอนี้ได้ กำลังข้ามไปเพลงถัดไป…';
  }
};

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(function YouTubePlayer({
  isDisplayMode = false,
  disableVideoInteraction = false,
  tempoExtensionReady,
  onTempoRateChange,
  nativeVocalDelayMs=0,
  nativeVocalTransport=false,
  nativeContinuous=false,
  nativePlaybackTime=null,
  nativePlaybackSessionEpoch=0,
  nativeVideoReady=false,
}, ref) {
  const {
    nowPlaying,
    isPlaying,
    volume,
    isMuted,
    setIsPlaying,
    setRoomPlayback,
    setCurrentTime,
    setDuration,
    setVolume,
    setIsMuted,
    skipSong,
    onSongEnd,
    handlePlaybackError,
    queue,
  } = useKaraoke();
  const { currentTime, duration } = usePlaybackClock();

  const playerRef = useRef<YT.Player | null>(null);
  const playerMountRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerReadyRef = useRef(false);
  const lastHandledItemIdRef = useRef<string | null>(null);
  const playingItemIdRef = useRef<string | null>(null);
  const autoplayAttemptItemIdRef = useRef<string | null>(null);
  const errorAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoplayCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [youtubeApi, setYouTubeApi] = useState<typeof YT | null>(null);
  const [apiAttempt, setApiAttempt] = useState(0);
  const [initializationError, setInitializationError] = useState('');
  const [playerError, setPlayerError] = useState<{ itemId: string; message: string; advanceReason?: 'ended' | 'error' } | null>(null);
  const [autoplayBlockedItemId, setAutoplayBlockedItemId] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const playbackRateRef = useRef(1);
  const availablePlaybackRatesRef = useRef<number[]>([]);
  const tempoExtensionReadyRef = useRef(tempoExtensionReady);
  const nativeVocalDelayRef=useRef(nativeVocalDelayMs);
  const delayedEndRef=useRef(new DelayedPlaybackEnd());
  const preparationAbortRef=useRef<AbortController|null>(null);
  const preparationSerialRef=useRef(0);
  const preparedTrackRef=useRef<{videoId:string;itemId:string}|null>(null);
  const prepareAndLoadRef=useRef<(player:YT.Player,videoId:string,itemId:string,startSeconds:number)=>Promise<void>>(async()=>{});
  const nativeContinuousRef=useRef(nativeContinuous);
  nativeContinuousRef.current=nativeContinuous;
  const nativePositionRef=useRef(nativePlaybackTime);
  nativePositionRef.current=nativeContinuous?nativePlaybackTime:null;
  const previousNativeEpochRef=useRef(nativePlaybackSessionEpoch);

  const videoId = nowPlaying?.video?.youtube_video_id || '';
  const currentItemId = nowPlaying?.id || '';
  const latestTrackRef=useRef({videoId,itemId:currentItemId,versionType:getVideoVersion(nowPlaying?.video),playing:isPlaying});
  latestTrackRef.current={videoId,itemId:currentItemId,versionType:getVideoVersion(nowPlaying?.video),playing:isPlaying};
  const playbackStartSeconds = getYouTubePlaybackStartSeconds(nowPlaying?.video?.channel_id);
  useEffect(()=>{
    nativeVocalDelayRef.current=nativeVocalDelayMs;
  },[nativeVocalDelayMs]);
  useEffect(()=>{
    delayedEndRef.current.cancel();
    const pending=delayedEndRef.current;
    return ()=>pending.cancel();
  },[currentItemId]);
  useEffect(()=>{
    if(nativeContinuousRef.current){if(isPlaying)delayedEndRef.current.resume();else delayedEndRef.current.pause();}
    else delayedEndRef.current.cancel();
  },[isPlaying]);
  useEffect(()=>{
    if(nativePlaybackSessionEpoch>0&&previousNativeEpochRef.current>0&&nativePlaybackSessionEpoch!==previousNativeEpochRef.current)delayedEndRef.current.cancel();
    previousNativeEpochRef.current=nativePlaybackSessionEpoch;
  },[nativePlaybackSessionEpoch]);

  const videoIdRef = useRef(videoId);
  const currentItemIdRef = useRef(currentItemId);
  const playbackStartSecondsRef = useRef(playbackStartSeconds);
  const fallbackDurationRef = useRef(nowPlaying?.video.duration || 210);
  const isPlayingRef = useRef(isPlaying);
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);
  const setIsPlayingRef = useRef(setIsPlaying);
  const setCurrentTimeRef = useRef(setCurrentTime);
  const setDurationRef = useRef(setDuration);
  const onSongEndRef = useRef(onSongEnd);
  const handlePlaybackErrorRef = useRef(handlePlaybackError);

  const setLocalPlaybackRate = useCallback((rate: number) => {
    const normalizedRate = Number.isFinite(rate) ? Math.max(0.25, Math.min(2, rate)) : 1;
    playbackRateRef.current = normalizedRate;
    setPlaybackRate(normalizedRate);
    onTempoRateChange(normalizedRate);
  }, [onTempoRateChange]);

  const resetTempo = useCallback((player: YT.Player | null = playerRef.current) => {
    availablePlaybackRatesRef.current = [];
    setLocalPlaybackRate(1);
    if (!player || !playerReadyRef.current) return;
    try {
      player.setPlaybackRate(1);
    } catch {
      // The YouTube player may not accept rate changes until its video is ready.
    }
  }, [setLocalPlaybackRate]);

  const readAvailablePlaybackRates = useCallback((player: YT.Player): number[] => {
    try {
      const rates = player.getAvailablePlaybackRates()
        .filter((rate) => Number.isFinite(rate) && rate > 0)
        .map((rate) => Math.round(rate * 100) / 100);
      const uniqueRates = Array.from(new Set(rates)).sort((left, right) => left - right);
      availablePlaybackRatesRef.current = uniqueRates;
      return uniqueRates;
    } catch {
      return availablePlaybackRatesRef.current;
    }
  }, []);

  const adjustTempo = useCallback((direction: TempoDirection): TempoAdjustmentResult => {
    const currentRate = playbackRateRef.current;
    if (!tempoExtensionReadyRef.current) {
      return {
        status: 'unavailable',
        playbackRate: currentRate,
        message: 'ต้องเปิด Extension เพื่อปรับ Tempo โดยรักษาคีย์เสียง',
      };
    }

    const player = playerRef.current;
    if (!player || !playerReadyRef.current || !currentItemIdRef.current) {
      return {
        status: 'unavailable',
        playbackRate: currentRate,
        message: 'ยังไม่มีเพลงที่พร้อมปรับ Tempo',
      };
    }

    const rates = readAvailablePlaybackRates(player);
    if (rates.length < 2) {
      return {
        status: 'unavailable',
        playbackRate: currentRate,
        message: 'เพลงนี้ไม่รองรับการปรับ Tempo',
      };
    }

    const playerRate = Number.isFinite(player.getPlaybackRate())
      ? Math.round(player.getPlaybackRate() * 100) / 100
      : currentRate;
    const currentIndex = rates.reduce((closestIndex, rate, index) => (
      Math.abs(rate - playerRate) < Math.abs(rates[closestIndex] - playerRate)
        ? index
        : closestIndex
    ), 0);
    const nextIndex = currentIndex + (direction === 'increase' ? 1 : -1);
    if (nextIndex < 0 || nextIndex >= rates.length) {
      return {
        status: 'boundary',
        playbackRate: rates[currentIndex],
        message: direction === 'increase' ? 'Tempo เร็วสุดแล้ว' : 'Tempo ช้าสุดแล้ว',
      };
    }

    const nextRate = rates[nextIndex];
    try {
      player.setPlaybackRate(nextRate);
      setLocalPlaybackRate(nextRate);
      return {
        status: 'changed',
        playbackRate: nextRate,
        message: `Tempo ${nextRate.toFixed(2)}x`,
      };
    } catch {
      return {
        status: 'error',
        playbackRate: currentRate,
        message: 'ไม่สามารถเปลี่ยน Tempo ของเพลงนี้ได้',
      };
    }
  }, [readAvailablePlaybackRates, setLocalPlaybackRate]);

  const clearAutoplayCheck = useCallback(() => {
    if (!autoplayCheckTimerRef.current) return;
    clearTimeout(autoplayCheckTimerRef.current);
    autoplayCheckTimerRef.current = null;
  }, []);

  const advanceAfterPlayback = useCallback((itemId: string, reason: 'ended' | 'error') => {
    if (!itemId || currentItemIdRef.current !== itemId || lastHandledItemIdRef.current === itemId) return;
    lastHandledItemIdRef.current = itemId;
    const advance = reason === 'ended' ? onSongEndRef.current : handlePlaybackErrorRef.current;
    void advance(itemId).catch((error: unknown) => {
      if (currentItemIdRef.current !== itemId) return;
      lastHandledItemIdRef.current = null;
      setPlayerError({
        itemId,
        advanceReason: reason,
        message: error instanceof Error ? error.message : 'เปลี่ยนเพลงไม่สำเร็จ กรุณาลองใหม่',
      });
    });
  }, []);

  const reportAutoplayBlocked = useCallback((itemId: string) => {
    if (!itemId || currentItemIdRef.current !== itemId) return;
    clearAutoplayCheck();
    autoplayAttemptItemIdRef.current = null;
    setAutoplayBlockedItemId(itemId);
    isPlayingRef.current = false;
    setIsPlayingRef.current(false);
  }, [clearAutoplayCheck]);

  const verifyAutoplayStarted = useCallback((player: YT.Player, itemId: string) => {
    clearAutoplayCheck();
    autoplayAttemptItemIdRef.current = itemId;
    autoplayCheckTimerRef.current = setTimeout(() => {
      autoplayCheckTimerRef.current = null;
      if (
        currentItemIdRef.current !== itemId ||
        autoplayAttemptItemIdRef.current !== itemId
      ) return;

      const playerState = player.getPlayerState();
      const playbackStarted =
        playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.BUFFERING;

      if (!playbackStarted) reportAutoplayBlocked(itemId);
    }, 1500);
  }, [clearAutoplayCheck, reportAutoplayBlocked]);

  prepareAndLoadRef.current=async(player,targetVideoId,itemId,startSeconds)=>{
    const serial=++preparationSerialRef.current;
    preparationAbortRef.current?.abort();const abort=new AbortController();preparationAbortRef.current=abort;preparedTrackRef.current=null;
    const track={youtubeVideoId:targetVideoId,queueItemId:itemId,versionType:latestTrackRef.current.versionType};
    const result=await prepareNativePlayerTrack(track,{signal:abort.signal});
    if(result.cancelled||abort.signal.aborted||serial!==preparationSerialRef.current||latestTrackRef.current.itemId!==itemId||latestTrackRef.current.videoId!==targetVideoId||playerRef.current!==player)return;
    preparedTrackRef.current={videoId:targetVideoId,itemId};
    try{
      if(latestTrackRef.current.playing){player.loadVideoById({videoId:targetVideoId,startSeconds});verifyAutoplayStarted(player,itemId);}
      else player.cueVideoById({videoId:targetVideoId,startSeconds});
      setCurrentTimeRef.current(startSeconds);disableYouTubeCaptions(player);
    }catch(error){console.error('Error loading prepared video:',error);}
  };

  useEffect(() => {
    videoIdRef.current = videoId;
    currentItemIdRef.current = currentItemId;
    playbackStartSecondsRef.current = playbackStartSeconds;
    fallbackDurationRef.current = nowPlaying?.video.duration || 210;
    isPlayingRef.current = isPlaying;
    volumeRef.current = volume;
    isMutedRef.current = isMuted;
    setIsPlayingRef.current = setIsPlaying;
    setCurrentTimeRef.current = setCurrentTime;
    setDurationRef.current = setDuration;
    onSongEndRef.current = onSongEnd;
    handlePlaybackErrorRef.current = handlePlaybackError;
    tempoExtensionReadyRef.current = tempoExtensionReady;
  }, [
    currentItemId,
    handlePlaybackError,
    isMuted,
    isPlaying,
    nowPlaying?.video.duration,
    onSongEnd,
    playbackStartSeconds,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    tempoExtensionReady,
    videoId,
    volume,
  ]);

  // Load YouTube IFrame API script
  useEffect(() => {
    let cancelled = false;

    void loadYouTubeIframeApi()
      .then((api) => {
        if (!cancelled) {
          setInitializationError('');
          setYouTubeApi(api);
        }
      })
      .catch((error: unknown) => {
        console.warn('Unable to initialize YouTube:', error);
        if (!cancelled) {
          setInitializationError('โหลดเครื่องเล่น YouTube ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiAttempt]);

  // Create one player instance. Event handlers read refs so they always use the latest queue callbacks.
  useEffect(() => {
    const mountElement = playerMountRef.current;
    // Warm the iframe as soon as the API is ready, even while the room is idle.
    // This removes the first-song cost of creating the iframe after the queue RPC.
    if (!youtubeApi || !mountElement) return;

    const playerTarget = document.createElement('div');
    playerTarget.className = 'h-full w-full';
    mountElement.replaceChildren(playerTarget);
    playerReadyRef.current = false;
    const readyTimer = setTimeout(() => {
      setInitializationError('เครื่องเล่น YouTube ไม่ตอบสนอง กรุณาลองโหลดใหม่');
    }, 15_000);

    try {
      const player = new youtubeApi.Player(playerTarget, {
        playerVars: {
          autoplay: isPlayingRef.current && Boolean(videoIdRef.current) ? 1 : 0,
          cc_load_policy: 0,
          controls: isDisplayMode ? 0 : 1,
          modestbranding: 1,
          rel: 0,
          fs: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event: YT.PlayerEvent) => {
            clearTimeout(readyTimer);
            setInitializationError('');
            playerReadyRef.current = true;
            resetTempo(event.target);
            disableYouTubeCaptions(event.target);
            event.target.setVolume(volumeRef.current);
            if (shouldMutePlayer(volumeRef.current, isMutedRef.current)) event.target.mute();
            else event.target.unMute();

            const readyVideoId = videoIdRef.current;
            if (readyVideoId) {
              const readyStartSeconds = playbackStartSecondsRef.current;
              void prepareAndLoadRef.current(event.target,readyVideoId,currentItemIdRef.current,readyStartSeconds);
            }

            readAvailablePlaybackRates(event.target);
            setDurationRef.current(event.target.getDuration() || fallbackDurationRef.current);
          },
          onStateChange: (event: YT.OnStateChangeEvent) => {
            // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
            if (event.data === youtubeApi.PlayerState.PLAYING) {
              const prepared=preparedTrackRef.current;
              if(!prepared||prepared.itemId!==currentItemIdRef.current)return;
              const actual=event.target.getVideoUrl?.();
              if(actual&&/[?&]v=([\w-]{11})(?:&|$)/.exec(actual)?.[1]!==prepared.videoId)return;
              notifyNativePlayerReady({youtubeVideoId:prepared.videoId,queueItemId:prepared.itemId,versionType:latestTrackRef.current.versionType});
              delayedEndRef.current.cancel();
              disableYouTubeCaptions(event.target);
              clearAutoplayCheck();
              autoplayAttemptItemIdRef.current = null;
              setAutoplayBlockedItemId(null);
              setPlayerError((currentError) =>
                currentError?.itemId === currentItemIdRef.current ? null : currentError
              );
              playingItemIdRef.current = currentItemIdRef.current;
              isPlayingRef.current = true;
              setIsPlayingRef.current(true);
              readAvailablePlaybackRates(event.target);
              setDurationRef.current(event.target.getDuration() || fallbackDurationRef.current);
            } else if (event.data === youtubeApi.PlayerState.PAUSED) {
              if (autoplayAttemptItemIdRef.current === currentItemIdRef.current) return;
              isPlayingRef.current = false;
              setIsPlayingRef.current(false);
            } else if (event.data === youtubeApi.PlayerState.ENDED) {
              clearAutoplayCheck();
              autoplayAttemptItemIdRef.current = null;
              const endedItemId = playingItemIdRef.current;
              if (endedItemId !== currentItemIdRef.current) return;
              if (!endedItemId || lastHandledItemIdRef.current === endedItemId) return;

              delayedEndRef.current.schedule(endedItemId,nativeVocalDelayRef.current,()=>{
                if(endedItemId!==currentItemIdRef.current)return;
                resetTempo(event.target);
                advanceAfterPlayback(endedItemId,'ended');
              });
              if(nativeContinuousRef.current&&!latestTrackRef.current.playing)delayedEndRef.current.pause();
            }
          },
          onPlaybackRateChange: (event: YT.OnPlaybackRateChangeEvent) => {
            const actualRate = Number.isFinite(event.data)
              ? Math.round(event.data * 100) / 100
              : 1;
            if (!tempoExtensionReadyRef.current && actualRate !== 1) {
              try {
                event.target.setPlaybackRate(1);
              } catch {}
              return;
            }
            playbackRateRef.current = actualRate;
            setPlaybackRate(actualRate);
            onTempoRateChange(actualRate);
          },
          onApiChange: (event: YT.PlayerEvent) => {
            // YouTube exposes caption controls only after its captions module loads.
            disableYouTubeCaptions(event.target);
          },
          onError: (event: YT.OnErrorEvent) => {
            const failedItemId = currentItemIdRef.current;
            console.warn('YouTube Player error code:', event.data);
            if (!failedItemId) return;

            setPlayerError({
              itemId: failedItemId,
              message: getYouTubePlayerErrorMessage(event.data),
            });
            resetTempo(event.target);

            if (errorAdvanceTimerRef.current) clearTimeout(errorAdvanceTimerRef.current);
            errorAdvanceTimerRef.current = setTimeout(() => {
              advanceAfterPlayback(failedItemId, 'error');
            }, 1500);
          },
          onAutoplayBlocked: () => {
            reportAutoplayBlocked(currentItemIdRef.current);
          },
        },
      });
      playerRef.current = player;
    } catch (err) {
      console.error('Failed to instantiate YouTube Player', err);
      clearTimeout(readyTimer);
      queueMicrotask(() => setInitializationError('เปิดเครื่องเล่น YouTube ไม่สำเร็จ กรุณาลองใหม่'));
    }

    return () => {
      preparationAbortRef.current?.abort();preparedTrackRef.current=null;
      clearTimeout(readyTimer);
      playerReadyRef.current = false;
      clearAutoplayCheck();
      playerRef.current?.destroy();
      playerRef.current = null;
      mountElement.replaceChildren();
    };
  }, [
    advanceAfterPlayback,
    clearAutoplayCheck,
    isDisplayMode,
    onTempoRateChange,
    readAvailablePlaybackRates,
    reportAutoplayBlocked,
    resetTempo,
    verifyAutoplayStarted,
    youtubeApi,
  ]);

  // Load the newly selected queue item into the existing player.
  useEffect(() => {
    resetTempo(playerRef.current);
    lastHandledItemIdRef.current = null;
    clearAutoplayCheck();
    if (errorAdvanceTimerRef.current) {
      clearTimeout(errorAdvanceTimerRef.current);
      errorAdvanceTimerRef.current = null;
    }

    const player = playerRef.current;
    if(!videoId){++preparationSerialRef.current;preparationAbortRef.current?.abort();preparedTrackRef.current=null;return;}
    if (!player || !playerReadyRef.current) return;

    void prepareAndLoadRef.current(player,videoId,currentItemId,playbackStartSeconds);
  }, [clearAutoplayCheck, currentItemId, playbackStartSeconds, resetTempo, setCurrentTime, verifyAutoplayStarted, videoId]);

  useEffect(() => {
    return () => {
      if (errorAdvanceTimerRef.current) clearTimeout(errorAdvanceTimerRef.current);
      clearAutoplayCheck();
    };
  }, [clearAutoplayCheck]);

  // Sync play/pause state
  useEffect(() => {
    if (!playerRef.current || !playerRef.current.playVideo) return;
    if(preparedTrackRef.current?.itemId!==currentItemId)return;
    try {
      if (isPlaying) {
        if(nativeContinuousRef.current&&delayedEndRef.current.pending&&playerRef.current.getPlayerState()===0)return;
        playerRef.current.playVideo();
        if (currentItemId) verifyAutoplayStarted(playerRef.current, currentItemId);
      } else {
        clearAutoplayCheck();
        autoplayAttemptItemIdRef.current = null;
        playerRef.current.pauseVideo();
      }
    } catch {}
  }, [clearAutoplayCheck, currentItemId, isPlaying, verifyAutoplayStarted]);

  useEffect(() => {
    if (!tempoExtensionReady && playbackRateRef.current !== 1) resetTempo(playerRef.current);
  }, [resetTempo, tempoExtensionReady]);

  // Sync volume / mute state
  const nativeVocalTransportActive=nativeVocalTransport||nativeVocalDelayMs>0;
  useEffect(()=>{
    if(!nativeVocalTransportActive||!videoId||!currentItemId)return;
    window.postMessage({source:VOCAL_CUT_PAGE_SOURCE,version:1,type:'VOCAL_PLAYBACK_STATE',payload:{youtubeVideoId:videoId,queueItemId:currentItemId,playing:isPlaying}},location.origin);
  },[nativeVocalTransportActive,currentItemId,videoId,isPlaying]);

  useEffect(() => {
    if (!playerRef.current) return;
    try {
      if (playerRef.current.setVolume) playerRef.current.setVolume(volume);
      if (playerRef.current.mute && playerRef.current.unMute) {
        if (shouldMutePlayer(volume, isMuted)) playerRef.current.mute();
        else playerRef.current.unMute();
      }
    } catch {}
  }, [volume, isMuted]);

  const restartCurrentSong = useCallback(() => {
    const player = playerRef.current;
    const itemId = currentItemIdRef.current;
    if (!player || !playerReadyRef.current || !itemId) return;

    try {
      delayedEndRef.current.cancel();
      clearAutoplayCheck();
      setAutoplayBlockedItemId(null);
      setPlayerError((currentError) => currentError?.itemId === itemId ? null : currentError);
      lastHandledItemIdRef.current = null;
      playingItemIdRef.current = itemId;
      const restartAtSeconds = playbackStartSecondsRef.current;
      player.seekTo(restartAtSeconds, true);
      disableYouTubeCaptions(player);
      player.playVideo();
      setCurrentTime(restartAtSeconds);
      isPlayingRef.current = true;
      setIsPlayingRef.current(true);
      verifyAutoplayStarted(player, itemId);
    } catch (error) {
      console.error('Unable to restart the current YouTube video:', error);
    }
  }, [clearAutoplayCheck, setCurrentTime, verifyAutoplayStarted]);

  useImperativeHandle(ref, () => ({ restartCurrentSong, adjustTempo }), [adjustTempo, restartCurrentSong]);

  // Time tracker loop
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isPlaying) {
      interval = setInterval(() => {
        if (playerRef.current && playerRef.current.getCurrentTime) {
          const displayed=nativePositionRef.current;
          const current = typeof displayed==='number'&&Number.isFinite(displayed)&&displayed>=0?displayed:playerRef.current.getCurrentTime() || 0;
          setCurrentTime(current);
        }
      }, 500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, setCurrentTime]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    delayedEndRef.current.cancel();
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (playerRef.current && playerRef.current.seekTo) {
      playerRef.current.seekTo(newTime, true);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => console.error(err));
    } else {
      document.exitFullscreen().catch((err) => console.error(err));
    }
  };

  const enablePlayback = () => {
    const player = playerRef.current;
    if (!player || !playerReadyRef.current || !currentItemId) return;

    try {
      delayedEndRef.current.cancel();
      clearAutoplayCheck();
      setAutoplayBlockedItemId(null);
      player.setVolume(volumeRef.current);
      if (shouldMutePlayer(volumeRef.current, isMutedRef.current)) player.mute();
      else player.unMute();

      // This call must stay inside the click handler. Moving it to an effect loses
      // the browser user activation required for audible autoplay.
      if (player.getPlayerState() === YT.PlayerState.ENDED) {
        const restartAtSeconds = playbackStartSecondsRef.current;
        resetTempo(player);
        player.loadVideoById({ videoId: videoIdRef.current, startSeconds: restartAtSeconds });
        setCurrentTimeRef.current(restartAtSeconds);
      } else {
        player.playVideo();
      }
      isPlayingRef.current = true;
      setIsPlayingRef.current(true);
      verifyAutoplayStarted(player, currentItemId);
    } catch (error) {
      console.error('Unable to enable YouTube playback:', error);
      reportAutoplayBlocked(currentItemId);
    }
  };

  const toggleSharedPlayback = () => {
    const nextIsPlaying = !isPlaying;

    // Starting the local player inside the click handler preserves browser
    // autoplay permission, while the RPC below makes the decision shared.
    if (nextIsPlaying) enablePlayback();
    else setIsPlaying(false);

    void setRoomPlayback(nextIsPlaying).catch(console.warn);
  };

  const nextSong = queue[0];
  const primarySinger = nowPlaying?.singers.map((s) => s.name).join(' & ') || nowPlaying?.requested_by || 'Singer';
  const visiblePlayerError = playerError?.itemId === currentItemId ? playerError.message : null;
  const isAutoplayBlocked = autoplayBlockedItemId === currentItemId;

  return (
    <div
      ref={containerRef}
      data-player-video-id={videoId}
      data-player-queue-item-id={currentItemId}
      className={`relative w-full bg-black overflow-hidden flex flex-col ${
        isDisplayMode
          ? 'h-full rounded-none border-0 shadow-none'
          : 'aspect-video rounded-2xl border border-zinc-800/80 shadow-2xl'
      }`}
    >
      {/* Top Banner (Singer & Next Info) */}
      {!isDisplayMode && nowPlaying && <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/90 via-black/50 to-transparent p-4 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-full bg-violet-600/80 backdrop-blur-md text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg border border-violet-400/30">
            <Mic className="w-3.5 h-3.5 animate-bounce text-pink-300" />
            <span>Now Singing: {primarySinger}</span>
          </div>
          <span className="text-zinc-300 text-sm font-medium truncate max-w-sm hidden sm:inline">
            {nowPlaying.video.title}
          </span>
        </div>

        {nextSong && (
          <div className="px-3 py-1.5 rounded-full bg-zinc-900/80 backdrop-blur-md text-zinc-300 text-xs font-medium border border-zinc-700/60 shadow flex items-center gap-2">
            <span className="text-zinc-400">Up Next:</span>
            <span className="text-cyan-400 font-semibold truncate max-w-[150px]">
              {nextSong.singers[0]?.name || nextSong.requested_by}
            </span>
          </div>
        )}
      </div>}

      {/* Video Canvas Container */}
      <div className="relative flex-1 w-full h-full bg-black">
        <div
          ref={playerMountRef}
          aria-hidden={!nowPlaying}
          className={`absolute inset-0 h-full w-full ${disableVideoInteraction || isDisplayMode || !nowPlaying ? 'pointer-events-none' : ''}`}
        />

        {nowPlaying&&nativeContinuous&&!nativeVideoReady&&(
          <div role="status" data-native-buffering="true" className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black text-sm text-zinc-300">
            กำลังเตรียมเพลง · ประมาณ 8 วินาที
          </div>
        )}

        {initializationError && (
          <div role="alert" className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-zinc-950/95 p-6 text-center">
            <p className="text-amber-300">{initializationError}</p>
            <button type="button" onClick={() => {
              setInitializationError('');
              setYouTubeApi(null);
              setApiAttempt((attempt) => attempt + 1);
            }} className="rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white hover:bg-violet-500">
              ลองโหลดเครื่องเล่นใหม่
            </button>
          </div>
        )}

        {!nowPlaying && (
          isDisplayMode ? (
            <div
              className="absolute inset-0 z-10 bg-black"
              role="img"
              aria-label="ไม่มีเพลงกำลังเล่น เริ่มพิมพ์เพื่อค้นหาเพลง"
            />
          ) : (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center overflow-hidden rounded-2xl bg-zinc-950/80 p-6 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-violet-600/20 text-violet-400 ring-1 ring-violet-500/30 animate-pulse">
                <Music className="h-8 w-8" />
              </div>
              <h3 className="mb-2 text-xl font-bold text-white">No Song Playing</h3>
              <p className="max-w-md text-sm text-zinc-400">
                Add songs to the queue from the search page or pick from your playlists to get the karaoke session started!
              </p>
            </div>
          )
        )}

        {nowPlaying && visiblePlayerError && (
          <div className="absolute inset-0 bg-zinc-950/90 flex flex-col items-center justify-center p-6 text-center z-10">
            <p className="text-amber-400 font-medium mb-3">{visiblePlayerError}</p>
            <button
              onClick={() => {
                if (playerError?.advanceReason) {
                  advanceAfterPlayback(currentItemId, playerError.advanceReason);
                } else {
                  void skipSong().catch((error: unknown) => setPlayerError({
                    itemId: currentItemId,
                    message: error instanceof Error ? error.message : 'เปลี่ยนเพลงไม่สำเร็จ กรุณาลองใหม่',
                  }));
                }
              }}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition"
            >
              {playerError?.advanceReason ? 'ลองเปลี่ยนเพลงใหม่' : 'Skip to Next Song'}
            </button>
          </div>
        )}

        {nowPlaying && isAutoplayBlocked && !visiblePlayerError && (
          <div
            className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-zinc-950/90 p-6 text-center backdrop-blur-sm"
            role="status"
            aria-live="polite"
          >
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-violet-600/20 text-violet-300 ring-1 ring-violet-500/40">
              <Play className="h-8 w-8 fill-current" aria-hidden="true" />
            </div>
            <h3 className="mb-2 text-xl font-bold text-white">Enable playback on this screen</h3>
            <p className="mb-5 max-w-md text-sm text-zinc-300">
              Your browser requires one click on the Player before it can autoplay songs with sound.
            </p>
            <button
              type="button"
              onClick={enablePlayback}
              className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/50 transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              Enable Playback
            </button>
          </div>
        )}
      </div>

      {/* Control Bar (Only in Normal Embed Mode) */}
      {!isDisplayMode && nowPlaying && (
        <div className="bg-zinc-950/90 border-t border-zinc-800/80 p-3 flex flex-col gap-2">
          {/* Progress Slider */}
          <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
            <span>{formatDuration(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-violet-500 hover:accent-violet-400 transition"
            />
            <span>{formatDuration(duration)}</span>
          </div>

          {/* Buttons row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={restartCurrentSong}
                className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
                title="Previous / Restart"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  toggleSharedPlayback();
                }}
                className="p-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl shadow-lg transition"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
              </button>

              <button
                onClick={() => {
                  resetTempo(playerRef.current);
                  void skipSong().catch(console.warn);
                }}
                className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
                title="Skip to Next"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {/* Volume & Fullscreen */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-medium text-zinc-400" aria-label={`Tempo ${playbackRate.toFixed(2)} เท่า`}>
                Tempo {playbackRate.toFixed(2)}x
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const nextVolume = parseInt(e.target.value, 10);
                    setVolume(nextVolume);
                    setIsMuted(nextVolume === 0);
                  }}
                  className="w-16 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                />
              </div>

              <button
                onClick={toggleFullscreen}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
                title="Fullscreen TV mode"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
