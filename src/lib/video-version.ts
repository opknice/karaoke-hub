import type { VideoVersion, YouTubeVideo } from './types';

export function isVideoVersion(value: unknown): value is VideoVersion {
  return value === 'karaoke' || value === 'mv';
}
export function getVideoVersion(video?: Pick<YouTubeVideo, 'version_type'> | null): VideoVersion {
  return video?.version_type === 'mv' ? 'mv' : 'karaoke';
}
export function isKaraokeTitle(title: string): boolean {
  return /karaoke|คาราโอเกะ|instrumental|off[\s-]*vocal|backing[\s-]*track|\bno[\s-]+vocals?\b|\bminus[\s-]+one\b|伴奏/iu.test(title);
}
