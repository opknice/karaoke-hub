'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useKaraoke } from '@/context/KaraokeContext';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Maximize2, Mic, Music } from 'lucide-react';
import { formatDuration } from '@/lib/queue-algorithm';
import { loadYouTubeIframeApi } from '@/lib/youtube-iframe-api';
import { shouldMutePlayer } from '@/lib/player-keyboard';
import { getYouTubePlaybackStartSeconds } from '@/lib/youtube-playback';

interface YouTubePlayerProps {
  isDisplayMode?: boolean; // TV / Projector Display Screen
  disableVideoInteraction?: boolean;
}

export interface YouTubePlayerHandle {
  restartCurrentSong: () => void;
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
}, ref) {
  const {
    nowPlaying,
    isPlaying,
    currentTime,
    duration,
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
  const [playerError, setPlayerError] = useState<{ itemId: string; message: string } | null>(null);
  const [autoplayBlockedItemId, setAutoplayBlockedItemId] = useState<string | null>(null);

  const videoId = nowPlaying?.video?.youtube_video_id || '';
  const currentItemId = nowPlaying?.id || '';
  const playbackStartSeconds = getYouTubePlaybackStartSeconds(nowPlaying?.video?.channel_id);
  const hasVideo = videoId.length > 0;

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

  const clearAutoplayCheck = useCallback(() => {
    if (!autoplayCheckTimerRef.current) return;
    clearTimeout(autoplayCheckTimerRef.current);
    autoplayCheckTimerRef.current = null;
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
    videoId,
    volume,
  ]);

  // Load YouTube IFrame API script
  useEffect(() => {
    let cancelled = false;

    void loadYouTubeIframeApi()
      .then((api) => {
        if (!cancelled) setYouTubeApi(api);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unable to load the YouTube player.';
        if (!cancelled && currentItemIdRef.current) {
          setPlayerError({ itemId: currentItemIdRef.current, message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Create one player instance. Event handlers read refs so they always use the latest queue callbacks.
  useEffect(() => {
    const mountElement = playerMountRef.current;
    if (!youtubeApi || !mountElement || !hasVideo) return;

    const playerTarget = document.createElement('div');
    playerTarget.className = 'h-full w-full';
    mountElement.replaceChildren(playerTarget);
    playerReadyRef.current = false;

    try {
      const player = new youtubeApi.Player(playerTarget, {
        playerVars: {
          autoplay: isPlayingRef.current ? 1 : 0,
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
            playerReadyRef.current = true;
            disableYouTubeCaptions(event.target);
            event.target.setVolume(volumeRef.current);
            if (shouldMutePlayer(volumeRef.current, isMutedRef.current)) event.target.mute();
            else event.target.unMute();

            const readyVideoId = videoIdRef.current;
            if (readyVideoId) {
              const readyStartSeconds = playbackStartSecondsRef.current;
              if (isPlayingRef.current) {
                event.target.loadVideoById({ videoId: readyVideoId, startSeconds: readyStartSeconds });
                verifyAutoplayStarted(event.target, currentItemIdRef.current);
              } else {
                event.target.cueVideoById({ videoId: readyVideoId, startSeconds: readyStartSeconds });
              }
              setCurrentTimeRef.current(readyStartSeconds);
            }

            setDurationRef.current(event.target.getDuration() || fallbackDurationRef.current);
          },
          onStateChange: (event: YT.OnStateChangeEvent) => {
            // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
            if (event.data === youtubeApi.PlayerState.PLAYING) {
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

              lastHandledItemIdRef.current = endedItemId;
              onSongEndRef.current(endedItemId);
            }
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

            if (errorAdvanceTimerRef.current) clearTimeout(errorAdvanceTimerRef.current);
            errorAdvanceTimerRef.current = setTimeout(() => {
              handlePlaybackErrorRef.current(failedItemId);
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
    }

    return () => {
      playerReadyRef.current = false;
      clearAutoplayCheck();
      playerRef.current?.destroy();
      playerRef.current = null;
      mountElement.replaceChildren();
    };
  }, [clearAutoplayCheck, hasVideo, isDisplayMode, reportAutoplayBlocked, verifyAutoplayStarted, youtubeApi]);

  // Load the newly selected queue item into the existing player.
  // We snapshot isPlaying into a separate ref (latestIsPlayingRef) that is written on every
  // render, so this effect can read the freshest value without needing isPlaying in its deps
  // (which would re-trigger a loadVideoById on every pause/play toggle).
  const latestIsPlayingRef = useRef(isPlaying);
  latestIsPlayingRef.current = isPlaying;

  useEffect(() => {
    lastHandledItemIdRef.current = null;
    clearAutoplayCheck();
    if (errorAdvanceTimerRef.current) {
      clearTimeout(errorAdvanceTimerRef.current);
      errorAdvanceTimerRef.current = null;
    }

    const player = playerRef.current;
    if (!videoId || !player || !playerReadyRef.current) return;

    try {
      // Read from latestIsPlayingRef — written on every render, always reflects the state
      // value from the same render cycle that changed videoId/currentItemId.
      if (latestIsPlayingRef.current) {
        player.loadVideoById({ videoId, startSeconds: playbackStartSeconds });
        verifyAutoplayStarted(player, currentItemId);
      } else {
        player.cueVideoById({ videoId, startSeconds: playbackStartSeconds });
      }
      setCurrentTime(playbackStartSeconds);
      disableYouTubeCaptions(player);
    } catch (error) {
      console.error('Error loading the next video:', error);
    }
  }, [clearAutoplayCheck, currentItemId, playbackStartSeconds, setCurrentTime, verifyAutoplayStarted, videoId]);

  useEffect(() => {
    return () => {
      if (errorAdvanceTimerRef.current) clearTimeout(errorAdvanceTimerRef.current);
      clearAutoplayCheck();
    };
  }, [clearAutoplayCheck]);

  // Sync play/pause state
  useEffect(() => {
    if (!playerRef.current || !playerRef.current.playVideo) return;
    try {
      if (isPlaying) {
        playerRef.current.playVideo();
        if (currentItemId) verifyAutoplayStarted(playerRef.current, currentItemId);
      } else {
        clearAutoplayCheck();
        autoplayAttemptItemIdRef.current = null;
        playerRef.current.pauseVideo();
      }
    } catch {}
  }, [clearAutoplayCheck, currentItemId, isPlaying, verifyAutoplayStarted]);

  // Sync volume / mute state
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

  useImperativeHandle(ref, () => ({ restartCurrentSong }), [restartCurrentSong]);

  // Time tracker loop
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isPlaying) {
      interval = setInterval(() => {
        if (playerRef.current && playerRef.current.getCurrentTime) {
          const current = playerRef.current.getCurrentTime() || 0;
          setCurrentTime(current);
        }
      }, 500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, setCurrentTime]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
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
      clearAutoplayCheck();
      setAutoplayBlockedItemId(null);
      player.setVolume(volumeRef.current);
      if (shouldMutePlayer(volumeRef.current, isMutedRef.current)) player.mute();
      else player.unMute();

      // This call must stay inside the click handler. Moving it to an effect loses
      // the browser user activation required for audible autoplay.
      if (player.getPlayerState() === YT.PlayerState.ENDED) {
        const restartAtSeconds = playbackStartSecondsRef.current;
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

  if (!nowPlaying) {
    if (isDisplayMode) {
      return (
        <div
          className="h-full w-full bg-black"
          role="img"
          aria-label="ไม่มีเพลงกำลังเล่น เริ่มพิมพ์เพื่อค้นหาเพลง"
        />
      );
    }

    return (
      <div className="relative aspect-video w-full rounded-2xl bg-zinc-950/80 border border-zinc-800 flex flex-col items-center justify-center p-6 text-center shadow-2xl overflow-hidden">
        <div className="w-16 h-16 rounded-full bg-violet-600/20 text-violet-400 flex items-center justify-center mb-4 ring-1 ring-violet-500/30 animate-pulse">
          <Music className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-white mb-2">No Song Playing</h3>
        <p className="text-zinc-400 text-sm max-w-md mb-4">
          Add songs to the queue from the search page or pick from your playlists to get the karaoke session started!
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full bg-black overflow-hidden flex flex-col ${
        isDisplayMode
          ? 'h-full rounded-none border-0 shadow-none'
          : 'aspect-video rounded-2xl border border-zinc-800/80 shadow-2xl'
      }`}
    >
      {/* Top Banner (Singer & Next Info) */}
      {!isDisplayMode && <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/90 via-black/50 to-transparent p-4 flex items-center justify-between pointer-events-none">
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
          className={`h-full w-full ${disableVideoInteraction || isDisplayMode ? 'pointer-events-none' : ''}`}
        />

        {visiblePlayerError && (
          <div className="absolute inset-0 bg-zinc-950/90 flex flex-col items-center justify-center p-6 text-center z-10">
            <p className="text-amber-400 font-medium mb-3">{visiblePlayerError}</p>
            <button
              onClick={() => void skipSong().catch(console.warn)}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition"
            >
              Skip to Next Song
            </button>
          </div>
        )}

        {isAutoplayBlocked && !visiblePlayerError && (
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
      {!isDisplayMode && (
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
                onClick={() => void skipSong().catch(console.warn)}
                className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
                title="Skip to Next"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {/* Volume & Fullscreen */}
            <div className="flex items-center gap-3">
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
