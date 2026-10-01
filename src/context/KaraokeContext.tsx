'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useId } from 'react';
import {
  QueueItem,
  QueueMode,
  QueueSinger,
  QueueStatus,
  YouTubeVideo,
  Playlist,
  Favorite,
  SongHistoryItem,
  Room,
  RoomMember,
} from '@/lib/types';
import { reorderQueueByMode } from '@/lib/queue-algorithm';
import { QueueAdvanceReason } from '@/lib/queue-transition';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { ensureSupabaseIdentity } from '@/lib/supabase/anonymous-auth';
import { restoreStoredPlaybackState } from '@/lib/player-state';

interface KaraokeContextType {
  // Playback
  nowPlaying: QueueItem | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isTVModeActive: boolean;
  setIsPlaying: (playing: boolean) => void;
  setRoomPlayback: (playing: boolean) => Promise<void>;
  setCurrentTime: (time: number) => void;
  setDuration: (dur: number) => void;
  setVolume: (vol: number) => void;
  setIsMuted: (muted: boolean) => void;
  skipSong: () => Promise<void>;
  previousSong: () => void;
  onSongEnd: (expectedItemId: string) => void;
  handlePlaybackError: (expectedItemId: string) => void;

  // Queue
  queue: QueueItem[];
  queueMode: QueueMode;
  isQueueLocked: boolean;
  setQueueMode: (mode: QueueMode) => void;
  setIsQueueLocked: (locked: boolean) => void;
  addToQueue: (video: YouTubeVideo, requestedBy: string, singers: string[], notes?: string, playImmediately?: boolean) => Promise<QueueItem>;
  removeFromQueue: (itemId: string) => Promise<void>;
  reorderQueue: (newQueue: QueueItem[]) => Promise<void>;
  moveQueueItem: (itemId: string, direction: 'up' | 'down') => Promise<void>;
  playQueueItem: (itemId: string) => Promise<void>;
  playNow: (itemId: string) => Promise<void>;
  playNext: (itemId: string) => Promise<void>;
  clearQueue: () => Promise<void>;

  // Playlists
  playlists: Playlist[];
  createPlaylist: (name: string, description?: string) => Playlist;
  addSongToPlaylist: (playlistId: string, video: YouTubeVideo) => void;
  removeSongFromPlaylist: (playlistId: string, youtubeVideoId: string) => void;
  deletePlaylist: (playlistId: string) => void;
  addPlaylistToQueue: (playlistId: string, requestedBy: string) => Promise<void>;

  // Favorites
  favorites: Favorite[];
  toggleFavorite: (video: YouTubeVideo) => void;
  isFavorite: (youtubeVideoId: string) => boolean;

  // History
  history: SongHistoryItem[];
  logHistory: (video: YouTubeVideo, singers: string[], duration: number, rating?: number) => void;

  // Party Room
  activeRoom: Room | null;
  roomMembers: RoomMember[];
  currentMember: RoomMember | null;
  pendingRequests: QueueItem[];
  createRoom: (name: string, customCode?: string) => Promise<Room>;
  ensureActiveRoom: (name?: string, forceNew?: boolean) => Promise<Room>;
  resetDailyRoom: () => Promise<Room>;
  joinRoom: (code: string, nickname: string) => Promise<boolean>;
  leaveRoom: () => void;
  approveRequest: (itemId: string) => void;
  rejectRequest: (itemId: string) => void;

  // Rating Modal
  ratingModalItem: YouTubeVideo | null;
  setRatingModalItem: (item: YouTubeVideo | null) => void;
  submitRating: (videoId: string, rating: number, tags: string[]) => void;
}

const KaraokeContext = createContext<KaraokeContextType | null>(null);

const STORAGE_KEYS = {
  QUEUE: 'karaoke_queue',
  NOW_PLAYING: 'karaoke_now_playing',
  IS_PLAYING: 'karaoke_is_playing',
  PLAYLISTS: 'karaoke_playlists',
  FAVORITES: 'karaoke_favorites',
  HISTORY: 'karaoke_history',
  ROOM: 'karaoke_room',
  MEMBER: 'karaoke_current_member',
  MEMBERS: 'karaoke_room_members',
  REQUESTS: 'karaoke_pending_requests',
  QUEUE_MODE: 'karaoke_queue_mode',
  DAILY_ROOM_LOCK: 'karaoke_daily_room_lock',
};

interface DailyRoomLock {
  version: 2;
  date: string;
  room: Room;
  createdAt: string;
}

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const SYNC_CHANNEL_NAME = 'karaoke_hub_cross_tab_sync';

interface PlaybackSyncPayload {
  nowPlaying?: QueueItem | null;
  isPlaying?: boolean;
  queue?: QueueItem[];
  queueMode?: QueueMode;
  activeRoom?: Room | null;
  currentTime?: number;
  duration?: number;
}

type SyncMessage =
  | { type: 'STATE_SYNC'; payload: PlaybackSyncPayload; senderId: string }
  | { type: 'REQUEST_SYNC'; senderId: string }
  | { type: 'PLAY_SONG'; payload: QueueItem; senderId: string }
  | { type: 'SET_IS_PLAYING'; payload: boolean; senderId: string }
  | { type: 'QUEUE_UPDATED'; payload: QueueItem[]; senderId: string }
  | { type: 'TIME_UPDATE'; payload: { currentTime: number; duration: number }; senderId: string }
  | { type: 'ROOM_UPDATED'; payload: Room | null; senderId: string }
  | { type: 'TV_PLAYER_ANNOUNCE'; senderId: string };

type SyncMessageInput = {
  [Type in SyncMessage['type']]: Omit<Extract<SyncMessage, { type: Type }>, 'senderId'>;
}[SyncMessage['type']];

interface SupabaseQueueRow {
  id: string;
  room_id: string | null;
  youtube_video_id: string;
  status: QueueStatus;
  position: number;
  requested_by: string;
  requested_by_member_id: string | null;
  client_request_id: string | null;
  notes: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface QueueItemMetadata {
  video?: YouTubeVideo;
  singers?: QueueSinger[];
  client_queue_item_id?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isYouTubeVideo(value: unknown): value is YouTubeVideo {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.youtube_video_id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.channel_name === 'string' &&
    typeof value.thumbnail_url === 'string' &&
    typeof value.duration === 'number' &&
    typeof value.embeddable === 'boolean' &&
    typeof value.karaoke_score === 'number'
  );
}

function isQueueSinger(value: unknown): value is QueueSinger {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function isRoom(value: unknown): value is Room {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string' &&
    (typeof value.host_user_id === 'string' || value.host_user_id === null) &&
    typeof value.room_code === 'string' &&
    typeof value.name === 'string' &&
    (value.status === 'active' || value.status === 'paused' || value.status === 'closed') &&
    (value.queue_mode === 'fifo' || value.queue_mode === 'round_robin' || value.queue_mode === 'smart') &&
    (value.request_mode === 'auto_accept' || value.request_mode === 'host_approval') &&
    typeof value.is_queue_locked === 'boolean' &&
    typeof value.created_at === 'string'
  );
}

function isPersistedRoom(value: unknown): value is Room {
  return isRoom(value) && UUID_PATTERN.test(value.id);
}

function isRoomMember(value: unknown): value is RoomMember {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string' &&
    typeof value.room_id === 'string' &&
    (typeof value.user_id === 'string' || value.user_id === null || value.user_id === undefined) &&
    typeof value.nickname === 'string' &&
    (value.role === 'host' || value.role === 'guest') &&
    typeof value.joined_at === 'string'
  );
}

function getRoomApiError(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.error === 'string' && payload.error.trim()
    ? payload.error
    : fallback;
}

function parseQueueItemMetadata(notes: string | null): QueueItemMetadata {
  if (!notes) return {};

  try {
    const parsed: unknown = JSON.parse(notes);
    if (!isRecord(parsed)) return {};

    return {
      video: isYouTubeVideo(parsed.video) ? parsed.video : undefined,
      singers: Array.isArray(parsed.singers) ? parsed.singers.filter(isQueueSinger) : undefined,
      client_queue_item_id:
        typeof parsed.client_queue_item_id === 'string' ? parsed.client_queue_item_id : undefined,
    };
  } catch {
    return {};
  }
}

function mapSupabaseQueueRow(row: SupabaseQueueRow): QueueItem {
  const metadata = parseQueueItemMetadata(row.notes);
  const fallbackVideo: YouTubeVideo = {
    id: `yt-${row.youtube_video_id}`,
    youtube_video_id: row.youtube_video_id,
    title: row.status === 'playing' ? 'Now Playing' : 'Requested Song',
    channel_name: 'YouTube',
    thumbnail_url: `https://img.youtube.com/vi/${row.youtube_video_id}/hqdefault.jpg`,
    duration: 210,
    embeddable: true,
    karaoke_score: 90,
  };

  return {
    id: metadata.client_queue_item_id ?? row.id,
    database_id: row.id,
    room_id: row.room_id ?? undefined,
    requested_by_member_id: row.requested_by_member_id ?? undefined,
    client_request_id: row.client_request_id ?? undefined,
    youtube_video_id: row.youtube_video_id,
    video: metadata.video ?? fallbackVideo,
    status: row.status,
    position: row.position,
    requested_by: row.requested_by,
    singers:
      metadata.singers && metadata.singers.length > 0
        ? metadata.singers
        : [{ id: `s-${row.id}`, name: row.requested_by }],
    created_at: row.created_at,
    started_at: row.started_at ?? undefined,
    completed_at: row.completed_at ?? undefined,
    notes: row.notes ?? undefined,
  };
}

function isDatabaseQueueItem(item: QueueItem): item is QueueItem & { database_id: string } {
  return typeof item.database_id === 'string' && item.database_id.length > 0;
}

export const KaraokeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const tabId = useId();
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Playback state
  const [nowPlaying, setNowPlaying] = useState<QueueItem | null>(null);
  const [isPlaying, setIsPlayingState] = useState<boolean>(false);
  const [currentTime, setCurrentTimeState] = useState<number>(0);
  const [duration, setDurationState] = useState<number>(0);
  const [volume, setVolumeState] = useState<number>(85);
  const [isMuted, setIsMutedState] = useState<boolean>(false);
  const [isTVModeActive, setIsTVModeActive] = useState<boolean>(false);

  // Queue state
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueMode, setQueueModeState] = useState<QueueMode>('smart');
  const [isQueueLocked, setIsQueueLocked] = useState<boolean>(false);

  // Playlists, Favorites, History
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [history, setHistory] = useState<SongHistoryItem[]>([]);

  // Party Mode
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([]);
  const [currentMember, setCurrentMember] = useState<RoomMember | null>(null);
  const [pendingRequests, setPendingRequests] = useState<QueueItem[]>([]);

  // Rating popup
  const [ratingModalItem, setRatingModalItem] = useState<YouTubeVideo | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Mutable refs to prevent stale closure bugs in callbacks and listeners
  const nowPlayingRef = useRef<QueueItem | null>(nowPlaying);
  const queueRef = useRef<QueueItem[]>(queue);
  const isPlayingRef = useRef<boolean>(isPlaying);
  const currentTimeRef = useRef<number>(currentTime);
  const durationRef = useRef<number>(duration);
  const queueModeRef = useRef<QueueMode>(queueMode);
  const activeRoomRef = useRef<Room | null>(activeRoom);
  const currentMemberRef = useRef<RoomMember | null>(currentMember);
  const recentSingersRef = useRef<string[]>([]);
  const lastTimeBroadcastRef = useRef<number>(0);
  const transitioningItemIdRef = useRef<string | null>(null);
  const roomInitializationPromiseRef = useRef<Promise<Room> | null>(null);

  useEffect(() => {
    nowPlayingRef.current = nowPlaying;
  }, [nowPlaying]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    queueModeRef.current = queueMode;
  }, [queueMode]);

  useEffect(() => {
    activeRoomRef.current = activeRoom;
  }, [activeRoom]);

  useEffect(() => {
    currentMemberRef.current = currentMember;
  }, [currentMember]);

  // Broadcast helper
  const broadcast = useCallback((msg: SyncMessageInput) => {
    if (channelRef.current) {
      try {
        channelRef.current.postMessage({ ...msg, senderId: tabId });
      } catch (err) {
        console.warn('BroadcastChannel postMessage error:', err);
      }
    }
  }, [tabId]);

  // 1. Initial State Load from LocalStorage
  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      try {
      const savedQueue = localStorage.getItem(STORAGE_KEYS.QUEUE);
      const savedNowPlaying = localStorage.getItem(STORAGE_KEYS.NOW_PLAYING);
      const savedIsPlaying = localStorage.getItem(STORAGE_KEYS.IS_PLAYING);
      const savedPlaylists = localStorage.getItem(STORAGE_KEYS.PLAYLISTS);
      const savedFavs = localStorage.getItem(STORAGE_KEYS.FAVORITES);
      const savedHist = localStorage.getItem(STORAGE_KEYS.HISTORY);
      const savedRoom = localStorage.getItem(STORAGE_KEYS.ROOM);
      const savedMember = localStorage.getItem(STORAGE_KEYS.MEMBER);
      const savedMembers = localStorage.getItem(STORAGE_KEYS.MEMBERS);
      const savedRequests = localStorage.getItem(STORAGE_KEYS.REQUESTS);
      const savedQueueMode = localStorage.getItem(STORAGE_KEYS.QUEUE_MODE) as QueueMode;

      const restoredPlayback = restoreStoredPlaybackState(savedNowPlaying, savedQueue);
      setNowPlaying(restoredPlayback.nowPlaying);
      setQueue(restoredPlayback.queue);
      setIsPlayingState(
        Boolean(restoredPlayback.nowPlaying) && (savedIsPlaying === null || savedIsPlaying === 'true')
      );

      if (savedPlaylists) {
        setPlaylists(JSON.parse(savedPlaylists));
      } else {
        const defaultPlaylist: Playlist = {
          id: 'starter-party-1',
          user_id: 'default-user',
          name: 'My Playlist 🎤',
          description: 'Add your favourite songs here!',
          is_public: true,
          item_count: 0,
          created_at: new Date().toISOString(),
          items: [],
        };
        setPlaylists([defaultPlaylist]);
      }

      if (savedFavs) setFavorites(JSON.parse(savedFavs));
      if (savedHist) setHistory(JSON.parse(savedHist));
      const savedDailyLock = localStorage.getItem(STORAGE_KEYS.DAILY_ROOM_LOCK);
      let shouldRestoreRoomScopedState = true;
      if (savedDailyLock) {
        try {
          const parsed: unknown = JSON.parse(savedDailyLock);
          if (
            isRecord(parsed) &&
            parsed.version === 2 &&
            parsed.date === getTodayDateString() &&
            isPersistedRoom(parsed.room)
          ) {
            setActiveRoom(parsed.room);
          } else {
            shouldRestoreRoomScopedState = false;
            localStorage.removeItem(STORAGE_KEYS.DAILY_ROOM_LOCK);
            localStorage.removeItem(STORAGE_KEYS.ROOM);
            localStorage.removeItem(STORAGE_KEYS.MEMBER);
            localStorage.removeItem(STORAGE_KEYS.MEMBERS);
          }
        } catch {
          shouldRestoreRoomScopedState = false;
          localStorage.removeItem(STORAGE_KEYS.DAILY_ROOM_LOCK);
          localStorage.removeItem(STORAGE_KEYS.ROOM);
          localStorage.removeItem(STORAGE_KEYS.MEMBER);
          localStorage.removeItem(STORAGE_KEYS.MEMBERS);
        }
      } else if (savedRoom) {
        const parsedRoom: unknown = JSON.parse(savedRoom);
        if (isPersistedRoom(parsedRoom)) {
          setActiveRoom(parsedRoom);
        } else {
          shouldRestoreRoomScopedState = false;
          localStorage.removeItem(STORAGE_KEYS.ROOM);
          localStorage.removeItem(STORAGE_KEYS.MEMBER);
          localStorage.removeItem(STORAGE_KEYS.MEMBERS);
        }
      }
      if (shouldRestoreRoomScopedState && savedMember) {
        const parsedMember: unknown = JSON.parse(savedMember);
        if (isRoomMember(parsedMember) && typeof parsedMember.user_id === 'string') {
          setCurrentMember(parsedMember);
        } else {
          shouldRestoreRoomScopedState = false;
          setActiveRoom(null);
          localStorage.removeItem(STORAGE_KEYS.DAILY_ROOM_LOCK);
          localStorage.removeItem(STORAGE_KEYS.ROOM);
          localStorage.removeItem(STORAGE_KEYS.MEMBER);
          localStorage.removeItem(STORAGE_KEYS.MEMBERS);
        }
      }
      if (shouldRestoreRoomScopedState && savedMembers) setRoomMembers(JSON.parse(savedMembers));
      if (savedRequests) setPendingRequests(JSON.parse(savedRequests));
      if (savedQueueMode) setQueueModeState(savedQueueMode);
      } catch (error) {
        console.error('Failed to parse state from localStorage', error);
      } finally {
        if (!cancelled) setIsHydrated(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // 2. BroadcastChannel Initial Setup & Handlers
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
      channelRef.current = channel;

      channel.onmessage = (event: MessageEvent<SyncMessage>) => {
        const msg = event.data;
        if (!msg || msg.senderId === tabId) return;

        switch (msg.type) {
          case 'REQUEST_SYNC':
            // Reply with our current state to sync the new tab
            if (nowPlayingRef.current) {
              channel.postMessage({
                type: 'STATE_SYNC',
                senderId: tabId,
                payload: {
                  nowPlaying: nowPlayingRef.current,
                  isPlaying: isPlayingRef.current,
                  queue: queueRef.current,
                  queueMode: queueModeRef.current,
                  activeRoom: activeRoomRef.current,
                  currentTime: currentTimeRef.current,
                  duration: durationRef.current,
                },
              });
            }
            break;

          case 'STATE_SYNC':
            if (msg.payload) {
              if (!activeRoomRef.current && msg.payload.nowPlaying !== undefined) {
                nowPlayingRef.current = msg.payload.nowPlaying;
                setNowPlaying(msg.payload.nowPlaying);
              }
              if (msg.payload.isPlaying !== undefined) {
                isPlayingRef.current = msg.payload.isPlaying;
                setIsPlayingState(msg.payload.isPlaying);
              }
              if (!activeRoomRef.current && msg.payload.queue !== undefined) {
                queueRef.current = msg.payload.queue;
                setQueue(msg.payload.queue);
              }
              if (msg.payload.queueMode !== undefined) {
                queueModeRef.current = msg.payload.queueMode;
                setQueueModeState(msg.payload.queueMode);
              }
              if (msg.payload.currentTime !== undefined) {
                currentTimeRef.current = msg.payload.currentTime;
                setCurrentTimeState(msg.payload.currentTime);
              }
              if (msg.payload.duration !== undefined) {
                durationRef.current = msg.payload.duration;
                setDurationState(msg.payload.duration);
              }
              if (msg.payload.activeRoom !== undefined) {
                activeRoomRef.current = msg.payload.activeRoom;
                setActiveRoom(msg.payload.activeRoom);
              }
            }
            break;

          case 'PLAY_SONG':
            if (msg.payload && !activeRoomRef.current) {
              nowPlayingRef.current = msg.payload;
              isPlayingRef.current = true;
              currentTimeRef.current = 0;
              setNowPlaying(msg.payload);
              setIsPlayingState(true);
              setCurrentTimeState(0);
            }
            break;

          case 'SET_IS_PLAYING':
            isPlayingRef.current = Boolean(msg.payload);
            setIsPlayingState(Boolean(msg.payload));
            break;

          case 'QUEUE_UPDATED':
            if (Array.isArray(msg.payload) && !activeRoomRef.current) {
              queueRef.current = msg.payload;
              setQueue(msg.payload);
            }
            break;

          case 'TIME_UPDATE':
            if (msg.payload) {
              currentTimeRef.current = msg.payload.currentTime;
              setCurrentTimeState(msg.payload.currentTime);
              if (msg.payload.duration) {
                durationRef.current = msg.payload.duration;
                setDurationState(msg.payload.duration);
              }
            }
            break;

          case 'ROOM_UPDATED':
            activeRoomRef.current = msg.payload;
            setActiveRoom(msg.payload);
            break;

          case 'TV_PLAYER_ANNOUNCE':
            setIsTVModeActive(true);
            break;
        }
      };

      // Request latest state from any other tab
      channel.postMessage({ type: 'REQUEST_SYNC', senderId: tabId });
    }

    // Fallback: Listen to storage events from other windows
    const handleStorageChange = (e: StorageEvent) => {
      if (!e.newValue) return;
      try {
        if (e.key === STORAGE_KEYS.QUEUE && !activeRoomRef.current) {
          const nextQueue: QueueItem[] = JSON.parse(e.newValue);
          queueRef.current = nextQueue;
          setQueue(nextQueue);
        } else if (e.key === STORAGE_KEYS.NOW_PLAYING && !activeRoomRef.current) {
          const nextPlaying: QueueItem = JSON.parse(e.newValue);
          nowPlayingRef.current = nextPlaying;
          setNowPlaying(nextPlaying);
        } else if (e.key === STORAGE_KEYS.IS_PLAYING) {
          const nextIsPlaying = e.newValue === 'true';
          isPlayingRef.current = nextIsPlaying;
          setIsPlayingState(nextIsPlaying);
        } else if (e.key === STORAGE_KEYS.ROOM) {
          const nextRoom: Room = JSON.parse(e.newValue);
          activeRoomRef.current = nextRoom;
          setActiveRoom(nextRoom);
        }
      } catch (err) {
        console.error('Storage sync error:', err);
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      if (channelRef.current) {
        channelRef.current.close();
      }
    };
  }, [tabId]);

  // 3. Sync to LocalStorage whenever state changes
  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(STORAGE_KEYS.QUEUE, JSON.stringify(queue));
  }, [isHydrated, queue]);

  useEffect(() => {
    if (!isHydrated) return;
    if (nowPlaying) {
      localStorage.setItem(STORAGE_KEYS.NOW_PLAYING, JSON.stringify(nowPlaying));
    } else {
      localStorage.removeItem(STORAGE_KEYS.NOW_PLAYING);
    }
  }, [isHydrated, nowPlaying]);

  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(STORAGE_KEYS.IS_PLAYING, String(isPlaying));
  }, [isHydrated, isPlaying]);

  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
  }, [isHydrated, playlists]);

  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
  }, [favorites, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  }, [history, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    if (activeRoom) {
      localStorage.setItem(STORAGE_KEYS.ROOM, JSON.stringify(activeRoom));
    } else {
      localStorage.removeItem(STORAGE_KEYS.ROOM);
    }
  }, [activeRoom, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    if (currentMember) {
      localStorage.setItem(STORAGE_KEYS.MEMBER, JSON.stringify(currentMember));
    } else {
      localStorage.removeItem(STORAGE_KEYS.MEMBER);
    }
  }, [currentMember, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(roomMembers));
  }, [isHydrated, roomMembers]);

  const applyAuthoritativeQueueRows = useCallback((rows: SupabaseQueueRow[], playbackIsPlaying = true) => {
    const roomItems = rows.map(mapSupabaseQueueRow);
    const playingItem = roomItems.find((item) => item.status === 'playing') ?? null;
    const queuedItems = roomItems
      .filter((item) => item.status === 'queued')
      .sort((left, right) => left.position - right.position)
      .map((item, index) => ({ ...item, position: index + 1 }));

    queueRef.current = queuedItems;
    nowPlayingRef.current = playingItem;
    const nextIsPlaying = Boolean(playingItem) && playbackIsPlaying;
    isPlayingRef.current = nextIsPlaying;
    transitioningItemIdRef.current = null;
    setQueue(queuedItems);
    setNowPlaying(playingItem);
    setIsPlayingState(nextIsPlaying);
    if (!playingItem) {
      setCurrentTimeState(0);
    }
  }, []);

  const refreshRoomQueue = useCallback(
    async (roomId: string = activeRoomRef.current?.id ?? ''): Promise<void> => {
      if (!roomId) return;
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error('ระบบ Queue ยังไม่พร้อมใช้งาน');

      const [queueResult, playbackResult] = await Promise.all([
        supabase
          .from('queue_items')
          .select('*')
          .eq('room_id', roomId)
          .in('status', ['playing', 'queued'])
          .order('position', { ascending: true }),
        supabase
          .from('rooms')
          .select('playback_is_playing')
          .eq('id', roomId)
          .maybeSingle(),
      ]);

      if (queueResult.error) throw new Error(`ไม่สามารถโหลด Queue ได้: ${queueResult.error.message}`);

      // This fallback keeps local development usable until this checked-in
      // migration is applied. Production uses the room value as the source of
      // truth as soon as the new column is available.
      const playbackColumnUnavailable =
        playbackResult.error?.message.includes('playback_is_playing') ?? false;
      if (playbackResult.error && !playbackColumnUnavailable) {
        throw new Error(`ไม่สามารถโหลดสถานะการเล่นได้: ${playbackResult.error.message}`);
      }

      const playbackIsPlaying = playbackColumnUnavailable
        ? true
        : playbackResult.data?.playback_is_playing !== false;
      applyAuthoritativeQueueRows((queueResult.data ?? []) as unknown as SupabaseQueueRow[], playbackIsPlaying);
    },
    [applyAuthoritativeQueueRows]
  );

  // Realtime is reflection-only: Postgres RPCs are the sole queue state machine.
  useEffect(() => {
    if (!activeRoom || !isSupabaseConfigured()) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void refreshRoomQueue(activeRoom.id).catch((error: unknown) => {
          console.warn(error instanceof Error ? error.message : 'Unable to refresh room queue');
        });
      }, 25);
    };

    void ensureSupabaseIdentity()
      .then(async () => {
        if (cancelled) return;
        await refreshRoomQueue(activeRoom.id);
        if (cancelled) return;

        channel = supabase
          .channel(`room_sync_${activeRoom.room_code}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'queue_items',
              filter: `room_id=eq.${activeRoom.id}`,
            },
            scheduleRefresh
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'rooms',
              filter: `id=eq.${activeRoom.id}`,
            },
            scheduleRefresh
          )
          .subscribe((status) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.warn(`Supabase room queue subscription status: ${status}`);
            }
          });
      })
      .catch((error: unknown) => {
        console.warn(error instanceof Error ? error.message : 'Unable to initialize room queue');
      });

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [activeRoom, refreshRoomQueue]);

  const persistQueueOrder = useCallback(
    async (items: QueueItem[]): Promise<void> => {
      const roomId = activeRoomRef.current?.id;
      if (!roomId) throw new Error('ยังไม่มีห้อง Karaoke ที่ใช้งานอยู่');
      const itemIds = items.map((item) => item.database_id);
      if (itemIds.some((id) => !id)) {
        throw new Error('Queue ยังซิงก์กับฐานข้อมูลไม่สมบูรณ์ กรุณาลองใหม่');
      }

      await ensureSupabaseIdentity();
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error('ระบบ Queue ยังไม่พร้อมใช้งาน');
      const { error } = await supabase.rpc('reorder_room_queue', {
        p_room_id: roomId,
        p_item_ids: itemIds as string[],
      });
      if (error) throw new Error(`ไม่สามารถเรียง Queue ได้: ${error.message}`);
      await refreshRoomQueue(roomId);
    },
    [refreshRoomQueue]
  );

  // Queue mode only proposes an order; Postgres validates and commits it.
  const setQueueMode = useCallback(
    (mode: QueueMode) => {
      setQueueModeState(mode);
      localStorage.setItem(STORAGE_KEYS.QUEUE_MODE, mode);
      const reordered = reorderQueueByMode(queueRef.current, mode, recentSingersRef.current);
      void persistQueueOrder(reordered).catch((error: unknown) => {
        console.warn(error instanceof Error ? error.message : 'Unable to reorder queue');
      });
    },
    [persistQueueOrder]
  );

  // Log to history
  const logHistory = useCallback((video: YouTubeVideo, singers: string[], dur: number, rating?: number) => {
    const historyItem: SongHistoryItem = {
      id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      youtube_video_id: video.youtube_video_id,
      video,
      singers,
      performed_at: new Date().toISOString(),
      duration: dur,
      rating,
    };
    setHistory((prev) => [historyItem, ...prev]);

    singers.forEach((s) => {
      recentSingersRef.current = [s, ...recentSingersRef.current.filter((x) => x !== s)].slice(0, 5);
    });
  }, []);

  // Play/Pause toggle
  const setIsPlaying = useCallback(
    (playing: boolean) => {
      isPlayingRef.current = playing;
      setIsPlayingState(playing);
      broadcast({ type: 'SET_IS_PLAYING', payload: playing });
    },
    [broadcast]
  );

  const setRoomPlayback = useCallback(
    async (playing: boolean): Promise<void> => {
      const current = nowPlayingRef.current;
      const roomId = activeRoomRef.current?.id;

      if (!roomId || !current || !isDatabaseQueueItem(current)) {
        setIsPlaying(playing);
        return;
      }

      await ensureSupabaseIdentity();
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error('ระบบ Queue ยังไม่พร้อมใช้งาน');

      const { data, error } = await supabase.rpc('set_room_playback', {
        p_room_id: roomId,
        p_expected_playing_id: current.database_id,
        p_is_playing: playing,
      });
      if (error) throw new Error(`ไม่สามารถเปลี่ยนสถานะการเล่นได้: ${error.message}`);

      // Another member may have ended or replaced the song while this action
      // was in flight, so always reload the database state.
      if (isRecord(data) && data.changed === false) {
        await refreshRoomQueue(roomId);
        return;
      }

      await refreshRoomQueue(roomId);
    },
    [refreshRoomQueue, setIsPlaying]
  );

  // Time ticker sync
  const setCurrentTime = useCallback(
    (time: number) => {
      currentTimeRef.current = time;
      setCurrentTimeState(time);

      // Throttle broadcast time sync to every ~1 second to save CPU
      if (Math.abs(time - lastTimeBroadcastRef.current) >= 1) {
        lastTimeBroadcastRef.current = time;
        broadcast({
          type: 'TIME_UPDATE',
          payload: { currentTime: time, duration: durationRef.current },
        });
      }
    },
    [broadcast]
  );

  const setDuration = useCallback((dur: number) => {
    durationRef.current = dur;
    setDurationState(dur);
  }, []);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
  }, []);

  const setIsMuted = useCallback((muted: boolean) => {
    setIsMutedState(muted);
  }, []);

  const advancePlayback = useCallback(
    async (reason: QueueAdvanceReason, expectedItemId?: string): Promise<void> => {
      const current = nowPlayingRef.current;
      if (!current) return;
      if (expectedItemId && current.id !== expectedItemId) return;
      if (transitioningItemIdRef.current === current.id) return;
      const roomId = activeRoomRef.current?.id;
      if (!roomId || !isDatabaseQueueItem(current)) {
        if (roomId) await refreshRoomQueue(roomId);
        return;
      }

      transitioningItemIdRef.current = current.id;
      try {
        await ensureSupabaseIdentity();
        const supabase = getSupabaseBrowserClient();
        if (!supabase) throw new Error('ระบบ Queue ยังไม่พร้อมใช้งาน');

        const { data, error } = await supabase.rpc('advance_queue', {
          p_room_id: roomId,
          p_expected_playing_id: current.database_id,
          p_reason: reason,
        });
        if (error) throw new Error(`ไม่สามารถเปลี่ยนเพลงได้: ${error.message}`);
        if (isRecord(data) && data.changed === false) {
          await refreshRoomQueue(roomId);
          return;
        }

        if (reason !== 'error') {
          const listenedDuration =
            reason === 'ended'
              ? durationRef.current || current.video.duration || 210
              : currentTimeRef.current;
          logHistory(
            current.video,
            current.singers.map((singer) => singer.name),
            listenedDuration
          );
        }
        if (reason === 'ended') setRatingModalItem(current.video);
        currentTimeRef.current = 0;
        setCurrentTimeState(0);
        await refreshRoomQueue(roomId);
      } finally {
        transitioningItemIdRef.current = null;
      }
    },
    [logHistory, refreshRoomQueue]
  );

  const playQueueItem = useCallback(
    async (itemId: string): Promise<void> => {
      const roomId = activeRoomRef.current?.id;
      if (!roomId) throw new Error('ยังไม่มีห้อง Karaoke ที่ใช้งานอยู่');
      const selected = queueRef.current.find((item) => item.id === itemId);
      if (!selected || !isDatabaseQueueItem(selected)) {
        throw new Error('ไม่พบเพลงนี้ใน Queue ปัจจุบัน');
      }
      const current = nowPlayingRef.current;
      if (current && transitioningItemIdRef.current === current.id) return;
      transitioningItemIdRef.current = current?.id ?? selected.id;
      try {
        await ensureSupabaseIdentity();
        const supabase = getSupabaseBrowserClient();
        if (!supabase) throw new Error('ระบบ Queue ยังไม่พร้อมใช้งาน');
        const { data, error } = await supabase.rpc('play_queue_item_now', {
          p_room_id: roomId,
          p_item_id: selected.database_id,
          p_expected_playing_id: current?.database_id ?? null,
        });
        if (error) throw new Error(`ไม่สามารถเล่นเพลงที่เลือกได้: ${error.message}`);
        if (isRecord(data) && data.changed === false) {
          await refreshRoomQueue(roomId);
          return;
        }
        if (current) {
          logHistory(
            current.video,
            current.singers.map((singer) => singer.name),
            currentTimeRef.current
          );
        }
        currentTimeRef.current = 0;
        setCurrentTimeState(0);
        await refreshRoomQueue(roomId);
      } finally {
        transitioningItemIdRef.current = null;
      }
    },
    [logHistory, refreshRoomQueue]
  );

  // When current song ends: Auto-advance to next in queue.
  const onSongEnd = useCallback((expectedItemId: string) => {
    void advancePlayback('ended', expectedItemId).catch(console.warn);
  }, [advancePlayback]);

  // Skip current song from a user action.
  const skipSong = useCallback(() => advancePlayback('skipped'), [advancePlayback]);

  // Unavailable/restricted videos must not block the rest of the queue.
  const handlePlaybackError = useCallback((expectedItemId: string) => {
    void advancePlayback('error', expectedItemId).catch(console.warn);
  }, [advancePlayback]);

  // Previous song
  const previousSong = useCallback(() => {
    currentTimeRef.current = 0;
    setCurrentTimeState(0);
  }, []);

  // Add song to Queue
  const addToQueue = useCallback(
    async (
      video: YouTubeVideo,
      requestedBy: string,
      singers: string[],
      notes?: string,
      playImmediately = false
    ): Promise<QueueItem> => {
      const roomId = activeRoomRef.current?.id;
      const member = currentMemberRef.current;
      if (!roomId || !member || member.room_id !== roomId) {
        throw new Error('กรุณาเข้าห้อง Karaoke ก่อนเพิ่มเพลง');
      }

      const identity = await ensureSupabaseIdentity();
      if (member.user_id !== identity.userId) {
        throw new Error('ข้อมูลสมาชิกไม่ตรงกับเซสชัน กรุณาเข้าห้องใหม่');
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error('ระบบ Queue ยังไม่พร้อมใช้งาน');
      const clientRequestId = crypto.randomUUID();
      const singerObjects: QueueSinger[] = (
        singers.length > 0 ? singers : [requestedBy || member.nickname]
      ).map((name, index) => ({
        id: `${clientRequestId}-${index}`,
        name: name.trim() || member.nickname,
      }));

      const { data, error } = await supabase.rpc('enqueue_song', {
        p_room_id: roomId,
        p_youtube_video_id: video.youtube_video_id,
        p_video: video,
        p_singers: singerObjects,
        p_user_notes: notes ?? '',
        p_client_request_id: clientRequestId,
      });
      if (error || !isRecord(data)) {
        throw new Error(`ไม่สามารถเพิ่มเพลงเข้า Queue ได้${error ? `: ${error.message}` : ''}`);
      }

      const persistedItem = mapSupabaseQueueRow(data as unknown as SupabaseQueueRow);
      if (persistedItem.status === 'playing') {
        nowPlayingRef.current = persistedItem;
        isPlayingRef.current = true;
        setNowPlaying(persistedItem);
        setIsPlayingState(true);
      } else {
        const nextQueue = [...queueRef.current.filter((item) => item.database_id !== persistedItem.database_id), persistedItem]
          .sort((left, right) => left.position - right.position)
          .map((item, index) => ({ ...item, position: index + 1 }));
        queueRef.current = nextQueue;
        setQueue(nextQueue);
      }

      if (playImmediately && persistedItem.status === 'queued') {
        const { error: playError } = await supabase.rpc('play_queue_item_now', {
          p_room_id: roomId,
          p_item_id: persistedItem.database_id,
          p_expected_playing_id: nowPlayingRef.current?.database_id ?? null,
        });
        if (playError) throw new Error(`เพิ่มเพลงแล้ว แต่เริ่มเล่นไม่ได้: ${playError.message}`);
      }

      await refreshRoomQueue(roomId);
      return persistedItem;
    },
    [refreshRoomQueue]
  );

  // Remove song from queue
  const removeFromQueue = useCallback(
    async (itemId: string): Promise<void> => {
      const item = queueRef.current.find((candidate) => candidate.id === itemId);
      if (!item || !isDatabaseQueueItem(item)) throw new Error('ไม่พบเพลงนี้ใน Queue ปัจจุบัน');
      await ensureSupabaseIdentity();
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error('ระบบ Queue ยังไม่พร้อมใช้งาน');
      const { error } = await supabase.rpc('cancel_room_queue_item', { p_item_id: item.database_id });
      if (error) throw new Error(`ไม่สามารถลบเพลงออกจากคิวได้: ${error.message}`);
      await refreshRoomQueue(item.room_id);
    },
    [refreshRoomQueue]
  );

  // Reorder queue
  const reorderQueue = useCallback(
    async (newQueue: QueueItem[]): Promise<void> => {
      const indexed = newQueue.map((item, idx) => ({ ...item, position: idx + 1 }));
      await persistQueueOrder(indexed);
    },
    [persistQueueOrder]
  );

  // Move queue item up or down
  const moveQueueItem = useCallback(
    async (itemId: string, direction: 'up' | 'down'): Promise<void> => {
      const index = queueRef.current.findIndex((item) => item.id === itemId);
      if (index === -1) return;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= queueRef.current.length) return;
      const reordered = [...queueRef.current];
      const [item] = reordered.splice(index, 1);
      reordered.splice(targetIndex, 0, item);
      await persistQueueOrder(reordered);
    },
    [persistQueueOrder]
  );

  const playNow = playQueueItem;

  // Play Next (move to top of queue)
  const playNext = useCallback(
    async (itemId: string): Promise<void> => {
      const index = queueRef.current.findIndex((item) => item.id === itemId);
      if (index <= 0) return;
      const reordered = [...queueRef.current];
      const [item] = reordered.splice(index, 1);
      reordered.unshift(item);
      await persistQueueOrder(reordered);
    },
    [persistQueueOrder]
  );

  // Clear queue
  const clearQueue = useCallback(async (): Promise<void> => {
    const roomId = activeRoomRef.current?.id;
    if (!roomId) throw new Error('ยังไม่มีห้อง Karaoke ที่ใช้งานอยู่');
    await ensureSupabaseIdentity();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) throw new Error('ระบบ Queue ยังไม่พร้อมใช้งาน');
    const { error } = await supabase.rpc('clear_room_queue', { p_room_id: roomId });
    if (error) throw new Error(`ไม่สามารถล้าง Queue ได้: ${error.message}`);
    await refreshRoomQueue(roomId);
  }, [refreshRoomQueue]);

  // Playlists
  const createPlaylist = useCallback((name: string, description?: string): Playlist => {
    const newPlaylist: Playlist = {
      id: `pl-${Date.now()}`,
      user_id: 'current-user',
      name: name.trim() || 'Untitled Playlist',
      description,
      is_public: false,
      item_count: 0,
      created_at: new Date().toISOString(),
      items: [],
    };
    setPlaylists((prev) => [newPlaylist, ...prev]);
    return newPlaylist;
  }, []);

  const addSongToPlaylist = useCallback((playlistId: string, video: YouTubeVideo) => {
    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id !== playlistId) return pl;
        const currentItems = pl.items || [];
        if (currentItems.some((it) => it.youtube_video_id === video.youtube_video_id)) {
          return pl;
        }
        const newItem = {
          id: `pl-it-${Date.now()}`,
          playlist_id: playlistId,
          youtube_video_id: video.youtube_video_id,
          video,
          position: currentItems.length + 1,
          created_at: new Date().toISOString(),
        };
        const updatedItems = [...currentItems, newItem];
        return { ...pl, items: updatedItems, item_count: updatedItems.length };
      })
    );
  }, []);

  const removeSongFromPlaylist = useCallback((playlistId: string, youtubeVideoId: string) => {
    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id !== playlistId) return pl;
        const filtered = (pl.items || []).filter((it) => it.youtube_video_id !== youtubeVideoId);
        return {
          ...pl,
          items: filtered.map((it, idx) => ({ ...it, position: idx + 1 })),
          item_count: filtered.length,
        };
      })
    );
  }, []);

  const deletePlaylist = useCallback((playlistId: string) => {
    setPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
  }, []);

  const addPlaylistToQueue = useCallback(
    async (playlistId: string, requestedBy: string): Promise<void> => {
      const pl = playlists.find((p) => p.id === playlistId);
      if (!pl || !pl.items || pl.items.length === 0) return;

      for (const item of pl.items) {
        await addToQueue(item.video, requestedBy, [requestedBy], `From playlist: ${pl.name}`);
      }
    },
    [playlists, addToQueue]
  );

  // Favorites
  const toggleFavorite = useCallback((video: YouTubeVideo) => {
    setFavorites((prev) => {
      const exists = prev.some((f) => f.youtube_video_id === video.youtube_video_id);
      if (exists) {
        return prev.filter((f) => f.youtube_video_id !== video.youtube_video_id);
      }
      const newFav: Favorite = {
        id: `fav-${Date.now()}`,
        user_id: 'current-user',
        youtube_video_id: video.youtube_video_id,
        video,
        created_at: new Date().toISOString(),
      };
      return [newFav, ...prev];
    });
  }, []);

  const isFavorite = useCallback(
    (youtubeVideoId: string) => {
      return favorites.some((f) => f.youtube_video_id === youtubeVideoId);
    },
    [favorites]
  );

  // Party Room
  const createRoom = useCallback(
    async (name: string, customCode?: string): Promise<Room> => {
      const code = customCode || Math.random().toString(36).substring(2, 8).toUpperCase();
      const identity = await ensureSupabaseIdentity();
      let response: Response;
      try {
        response = await fetch('/api/rooms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${identity.accessToken}`,
          },
          body: JSON.stringify({ action: 'create', name, roomCode: code }),
        });
      } catch {
        throw new Error('ไม่สามารถเชื่อมต่อระบบห้องได้ กรุณาตรวจสอบเครือข่ายแล้วลองใหม่');
      }

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(payload) || payload.success !== true) {
        throw new Error(getRoomApiError(payload, 'ไม่สามารถสร้างห้องได้ กรุณาลองใหม่'));
      }
      if (!isPersistedRoom(payload.room) || !isRoomMember(payload.member)) {
        throw new Error('ข้อมูลห้องหรือสมาชิกจากเซิร์ฟเวอร์ไม่ถูกต้อง');
      }

      const roomObj = payload.room;
      const hostMember = payload.member;
      if (hostMember.user_id !== identity.userId || hostMember.role !== 'host') {
        throw new Error('ข้อมูลเจ้าของห้องไม่ตรงกับเซสชันผู้ใช้');
      }

      if (typeof window !== 'undefined') {
        const lock: DailyRoomLock = {
          version: 2,
          date: getTodayDateString(),
          room: roomObj,
          createdAt: new Date().toISOString(),
        };
        localStorage.setItem(STORAGE_KEYS.DAILY_ROOM_LOCK, JSON.stringify(lock));
      }

      activeRoomRef.current = roomObj;
      currentMemberRef.current = hostMember;
      setActiveRoom(roomObj);
      setCurrentMember(hostMember);
      setRoomMembers([hostMember]);
      broadcast({ type: 'ROOM_UPDATED', payload: roomObj });

      return roomObj;
    },
    [broadcast]
  );

  const ensureActiveRoom = useCallback(
    async (name: string = 'Karaoke Party', forceNew: boolean = false): Promise<Room> => {
      const today = getTodayDateString();

      // The dated lock is authoritative. A stale in-memory room must not leak into a new day.
      if (!forceNew && typeof window !== 'undefined') {
        try {
          const stored = localStorage.getItem(STORAGE_KEYS.DAILY_ROOM_LOCK);
          if (stored) {
            const parsed: unknown = JSON.parse(stored);
            const savedMemberValue = localStorage.getItem(STORAGE_KEYS.MEMBER);
            const parsedMember: unknown = savedMemberValue ? JSON.parse(savedMemberValue) : null;
            const identity = await ensureSupabaseIdentity();
            if (
              isRecord(parsed) &&
              parsed.version === 2 &&
              parsed.date === today &&
              isPersistedRoom(parsed.room) &&
              isRoomMember(parsedMember) &&
              parsedMember.room_id === parsed.room.id &&
              parsedMember.role === 'host' &&
              parsedMember.user_id === identity.userId
            ) {
              activeRoomRef.current = parsed.room;
              currentMemberRef.current = parsedMember;
              setActiveRoom(parsed.room);
              setCurrentMember(parsedMember);
              setRoomMembers((prev) => (prev.length > 0 ? prev : [parsedMember]));
              broadcast({ type: 'ROOM_UPDATED', payload: parsed.room });
              return parsed.room;
            }

            localStorage.removeItem(STORAGE_KEYS.DAILY_ROOM_LOCK);
            localStorage.removeItem(STORAGE_KEYS.ROOM);
            localStorage.removeItem(STORAGE_KEYS.MEMBER);
            localStorage.removeItem(STORAGE_KEYS.MEMBERS);
            activeRoomRef.current = null;
            setActiveRoom(null);
            setCurrentMember(null);
            setRoomMembers([]);
          } else {
            // A room restored without a daily host lock belongs to a guest/legacy session.
            // Do not expose its QR while the Player is preparing today's host room.
            activeRoomRef.current = null;
            setActiveRoom(null);
            setCurrentMember(null);
            setRoomMembers([]);
          }
        } catch (e) {
          console.warn('Failed to parse daily room lock:', e);
          localStorage.removeItem(STORAGE_KEYS.DAILY_ROOM_LOCK);
          localStorage.removeItem(STORAGE_KEYS.ROOM);
          localStorage.removeItem(STORAGE_KEYS.MEMBER);
          localStorage.removeItem(STORAGE_KEYS.MEMBERS);
          activeRoomRef.current = null;
          setActiveRoom(null);
          setCurrentMember(null);
          setRoomMembers([]);
        }
      }

      if (roomInitializationPromiseRef.current) {
        return roomInitializationPromiseRef.current;
      }

      const creationPromise = createRoom(name);
      roomInitializationPromiseRef.current = creationPromise;

      try {
        return await creationPromise;
      } finally {
        if (roomInitializationPromiseRef.current === creationPromise) {
          roomInitializationPromiseRef.current = null;
        }
      }
    },
    [broadcast, createRoom]
  );

  const resetDailyRoom = useCallback(
    async (): Promise<Room> => {
      return ensureActiveRoom('Karaoke Party', true);
    },
    [ensureActiveRoom]
  );

  const joinRoom = useCallback(
    async (code: string, nickname: string): Promise<boolean> => {
      const cleanCode = code.trim().toUpperCase();
      const cleanNickname = nickname.trim();
      if (!cleanCode || !cleanNickname) return false;
      const identity = await ensureSupabaseIdentity();

      let response: Response;
      try {
        response = await fetch('/api/rooms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${identity.accessToken}`,
          },
          body: JSON.stringify({ action: 'join', roomCode: cleanCode, nickname: cleanNickname }),
        });
      } catch {
        throw new Error('ไม่สามารถเชื่อมต่อระบบห้องได้ กรุณาตรวจสอบเครือข่ายแล้วลองใหม่');
      }

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(payload) || payload.success !== true) {
        throw new Error(getRoomApiError(payload, 'ไม่สามารถเข้าร่วมห้องได้ กรุณาลองใหม่'));
      }
      if (!isPersistedRoom(payload.room) || !isRoomMember(payload.member)) {
        throw new Error('ข้อมูลห้องหรือสมาชิกจากเซิร์ฟเวอร์ไม่ถูกต้อง');
      }

      const targetRoom = payload.room;
      const guestMember = payload.member;
      if (guestMember.user_id !== identity.userId) {
        throw new Error('ข้อมูลสมาชิกไม่ตรงกับเซสชันผู้ใช้');
      }

      activeRoomRef.current = targetRoom;
      currentMemberRef.current = guestMember;
      setActiveRoom(targetRoom);
      setCurrentMember(guestMember);
      setRoomMembers((prev) => [...prev.filter((m) => m.nickname !== guestMember.nickname), guestMember]);
      broadcast({ type: 'ROOM_UPDATED', payload: targetRoom });

      return true;
    },
    [broadcast]
  );

  const leaveRoom = useCallback(() => {
    activeRoomRef.current = null;
    currentMemberRef.current = null;
    setActiveRoom(null);
    setCurrentMember(null);
    setRoomMembers([]);
    broadcast({ type: 'ROOM_UPDATED', payload: null });
  }, [broadcast]);

  const approveRequest = useCallback(
    (itemId: string) => {
      const req = pendingRequests.find((r) => r.id === itemId);
      if (req) {
        setPendingRequests((prev) => prev.filter((r) => r.id !== itemId));
        setQueue((prevQueue) => {
          const updated = [...prevQueue, { ...req, status: 'queued' as const }];
          const reordered = reorderQueueByMode(updated, queueModeRef.current, recentSingersRef.current);
          broadcast({ type: 'QUEUE_UPDATED', payload: reordered });
          return reordered;
        });
      }
    },
    [pendingRequests, broadcast]
  );

  const rejectRequest = useCallback((itemId: string) => {
    setPendingRequests((prev) => prev.filter((r) => r.id !== itemId));
  }, []);

  const submitRating = useCallback((videoId: string, rating: number, tags: string[]) => {
    setRatingModalItem(null);
    console.log(`Rating recorded for video ${videoId}: rating ${rating}, tags:`, tags);
  }, []);

  return (
    <KaraokeContext.Provider
      value={{
        nowPlaying,
        isPlaying,
        currentTime,
        duration,
        volume,
        isMuted,
        isTVModeActive,
        setIsPlaying,
        setRoomPlayback,
        setCurrentTime,
        setDuration,
        setVolume,
        setIsMuted,
        skipSong,
        previousSong,
        onSongEnd,
        handlePlaybackError,

        queue,
        queueMode,
        isQueueLocked,
        setQueueMode,
        setIsQueueLocked,
        addToQueue,
        removeFromQueue,
        reorderQueue,
        moveQueueItem,
        playQueueItem,
        playNow,
        playNext,
        clearQueue,

        playlists,
        createPlaylist,
        addSongToPlaylist,
        removeSongFromPlaylist,
        deletePlaylist,
        addPlaylistToQueue,

        favorites,
        toggleFavorite,
        isFavorite,

        history,
        logHistory,

        activeRoom,
        roomMembers,
        currentMember,
        pendingRequests,
        createRoom,
        ensureActiveRoom,
        resetDailyRoom,
        joinRoom,
        leaveRoom,
        approveRequest,
        rejectRequest,

        ratingModalItem,
        setRatingModalItem,
        submitRating,
      }}
    >
      {children}
    </KaraokeContext.Provider>
  );
};

export function useKaraoke() {
  const context = useContext(KaraokeContext);
  if (!context) {
    throw new Error('useKaraoke must be used within a KaraokeProvider');
  }
  return context;
}
