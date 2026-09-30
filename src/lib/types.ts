export type QueueStatus = 'pending' | 'queued' | 'playing' | 'completed' | 'skipped' | 'cancelled';
export type QueueMode = 'fifo' | 'round_robin' | 'smart';
export type RequestMode = 'auto_accept' | 'host_approval';
export type MemberRole = 'host' | 'guest';

export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  created_at: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  language: string;
  genre: string;
  created_at?: string;
}

export interface YouTubeVideo {
  id: string;
  youtube_video_id: string;
  song_id?: string;
  title: string;
  artist?: string;
  channel_id?: string;
  channel_name: string;
  thumbnail_url: string;
  duration: number; // in seconds
  embeddable: boolean;
  karaoke_score: number; // 0 - 100
  views_count?: number;
  last_synced_at?: string;
  created_at?: string;
}

export interface QueueSinger {
  id: string;
  name: string;
  avatar?: string;
}

export interface QueueItem {
  id: string;
  database_id?: string;
  room_id?: string;
  requested_by_member_id?: string;
  client_request_id?: string;
  youtube_video_id: string;
  video: YouTubeVideo;
  status: QueueStatus;
  position: number;
  requested_by: string; // User or Guest Nickname
  singers: QueueSinger[]; // Solo, Duet, Group
  created_at: string;
  started_at?: string;
  completed_at?: string;
  notes?: string;
}

export interface Playlist {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  is_public: boolean;
  item_count?: number;
  created_at: string;
  items?: PlaylistItem[];
}

export interface PlaylistItem {
  id: string;
  playlist_id: string;
  youtube_video_id: string;
  video: YouTubeVideo;
  position: number;
  created_at: string;
}

export interface Favorite {
  id: string;
  user_id: string;
  youtube_video_id: string;
  video: YouTubeVideo;
  created_at: string;
}

export interface Room {
  id: string;
  host_user_id: string | null;
  room_code: string;
  name: string;
  status: 'active' | 'paused' | 'closed';
  queue_mode: QueueMode;
  request_mode: RequestMode;
  is_queue_locked: boolean;
  created_at: string;
  closed_at?: string;
}

export interface RoomMember {
  id: string;
  room_id: string;
  user_id?: string | null;
  nickname: string;
  role: MemberRole;
  joined_at: string;
}

export interface KaraokeRating {
  id: string;
  user_id: string;
  youtube_video_id: string;
  rating: number; // 1 to 5
  lyrics_correct: boolean;
  instrumental_quality: number; // 1 to 5
  audio_quality: number; // 1 to 5
  video_quality: number; // 1 to 5
  has_vocal: boolean;
  is_karaoke: boolean;
  feedback_tags?: string[];
  created_at: string;
}

export interface SongHistoryItem {
  id: string;
  user_id?: string;
  room_id?: string;
  youtube_video_id: string;
  video: YouTubeVideo;
  singers: string[];
  performed_at: string;
  duration: number;
  rating?: number;
}
