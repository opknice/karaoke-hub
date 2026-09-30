export interface OfficialYouTubeChannel {
  readonly channelId: string;
  readonly name: string;
  readonly url: string;
  readonly evidenceUrl: string;
  readonly reviewedAt: string;
  readonly catalogTitleSuffix?: string;
  readonly catalogTitleIncludesAny?: readonly string[];
}

// Curated channel identity, not YouTube's verification badge or a claim about
// ownership of every individual recording. Add entries only with evidence.
export const OFFICIAL_YOUTUBE_CHANNELS: readonly OfficialYouTubeChannel[] = [
  {
    channelId: 'UCHmKRqvKPYVx23RJ8uF6AtA',
    name: 'GMM Karaoke',
    url: 'https://www.youtube.com/@gmmkaraoke',
    evidenceUrl: 'https://techsauce.co/news/gmm-grammy-open-gmm-karaoke-on-youtube',
    reviewedAt: '2026-09-29',
  },
  {
    channelId: 'UC8GkZ5dlOrw-yN_nkOAIzPA',
    name: 'RSMUSIC-X',
    url: 'https://www.youtube.com/@RSMUSIC-XThailand',
    evidenceUrl: 'https://www.youtube.com/watch?v=sKuamJKa0oE',
    reviewedAt: '2026-09-30',
    catalogTitleSuffix: 'Official karaoke',
  },
  {
    channelId: 'UCnm6ohF4dI3h9GiIUTtKxfg',
    name: 'Rose Media & Entertainment',
    url: 'https://www.youtube.com/@Rose_Media',
    evidenceUrl: 'https://www.youtube.com/@Rose_Media/search?query=karaoke',
    reviewedAt: '2026-09-30',
    catalogTitleIncludesAny: ['karaoke', 'คาราโอเกะ'],
  },
  {
    channelId: 'UCLcCpNY-zaL3vEERD5rh5Ew',
    name: 'RsiamMusic',
    url: 'https://www.youtube.com/@rsiammusic',
    evidenceUrl: 'https://www.youtube.com/@rsiammusic/search?query=karaoke',
    reviewedAt: '2026-09-30',
    catalogTitleIncludesAny: ['karaoke', 'คาราโอเกะ'],
  },
  {
    channelId: 'UCGCNIdJPo0ZFkVbo_IBo9eQ',
    name: 'MUSIC TRAIN OFFICIAL',
    url: 'https://www.youtube.com/@MUSICTRAINOFFICIAL',
    evidenceUrl: 'https://www.youtube.com/@MUSICTRAINOFFICIAL/search?query=karaoke',
    reviewedAt: '2026-09-30',
    catalogTitleIncludesAny: ['karaoke', 'คาราโอเกะ'],
  },
  {
    channelId: 'UCL8S9ONDLDRqz7s0wljA5Ug',
    name: 'Sure Karaoke',
    url: 'https://www.youtube.com/@SureKaraoke',
    evidenceUrl: 'https://www.youtube.com/@SureKaraoke/search?query=karaoke',
    reviewedAt: '2026-09-30',
    catalogTitleIncludesAny: ['karaoke', 'คาราโอเกะ'],
  },
  {
    channelId: 'UCn7W1BoMzSMz1cdhILDp-jg',
    name: 'Oke Online',
    url: 'https://www.youtube.com/@OkeOnline',
    evidenceUrl: 'https://www.youtube.com/@OkeOnline/videos',
    reviewedAt: '2026-09-30',
    catalogTitleSuffix: 'คาราโอเกะ',
  },
];

const channelsById = new Map(OFFICIAL_YOUTUBE_CHANNELS.map((channel) => [channel.channelId, channel]));

export function getOfficialYouTubeChannel(channelId: string | undefined): OfficialYouTubeChannel | undefined {
  return channelId ? channelsById.get(channelId) : undefined;
}
