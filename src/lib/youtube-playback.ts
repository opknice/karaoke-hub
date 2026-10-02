import { GMM_KARAOKE_CHANNEL_ID } from './official-youtube-channels';

export const GMM_KARAOKE_START_SECONDS = 16;

export function getYouTubePlaybackStartSeconds(channelId: string | undefined): number {
  return channelId === GMM_KARAOKE_CHANNEL_ID ? GMM_KARAOKE_START_SECONDS : 0;
}
