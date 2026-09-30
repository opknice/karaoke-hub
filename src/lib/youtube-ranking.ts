import type { YouTubeVideo } from './types';
import { getOfficialYouTubeChannel } from './official-youtube-channels';

export type YouTubeSearchMode = 'song' | 'artist';

const TITLE_KARAOKE_SIGNALS = [
  'karaoke',
  'คาราโอเกะ',
  'instrumental',
  'backing track',
  'minus one',
  'no vocal',
  'no vocals',
] as const;

const CHANNEL_KARAOKE_SIGNALS = [
  'karaoke',
  'คาราโอเกะ',
  'sing king',
  'backing track',
] as const;

const HARD_NON_KARAOKE_TITLE_SIGNALS = [
  'carpool karaoke',
  'karaoke challenge',
  'reaction',
  'reacts to',
] as const;

const OFFICIAL_NON_KARAOKE_TITLE_SIGNALS = [
  'official music video',
  'official mv',
  'official audio',
] as const;

const SEARCH_NOISE_PHRASES = [
  'official karaoke version',
  'original karaoke',
  'karaoke version',
  'คาราโอเกะ',
  'karaoke',
] as const;

const BRACKETED_TITLE_METADATA = /\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/gu;
const TITLE_ARTIST_SEPARATOR =
  /\s+[-–—|/:：•·]\s*|(?<=[\u0E00-\u0E7F])[-–—](?=[A-Za-z])/u;

export function normalizeYouTubeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('th-TH')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForRelevance(value: string): string {
  let normalized = normalizeYouTubeSearchText(value);
  for (const phrase of SEARCH_NOISE_PHRASES) {
    normalized = normalized.replaceAll(phrase, ' ');
  }
  return normalized.replace(/\s+/g, ' ').trim();
}

function getSongTitleCandidates(value: string): string[] {
  const withoutBracketedMetadata = value.replace(BRACKETED_TITLE_METADATA, ' ');
  const [titleBeforeArtist = ''] = withoutBracketedMetadata.split(TITLE_ARTIST_SEPARATOR, 1);

  return [
    normalizeForRelevance(titleBeforeArtist),
    normalizeForRelevance(withoutBracketedMetadata),
    normalizeForRelevance(value),
  ].filter((candidate, index, candidates) => (
    candidate.length > 0 && candidates.indexOf(candidate) === index
  ));
}

function containsEveryToken(value: string, query: string): boolean {
  const tokens = query.split(' ').filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => value.includes(token));
}

export function getSearchRelevanceTier(
  video: YouTubeVideo,
  query: string,
  mode: YouTubeSearchMode = 'song'
): number {
  const normalizedQuery = normalizeForRelevance(query);
  if (!normalizedQuery) return 1;

  const title = normalizeForRelevance(video.title);
  const artist = normalizeForRelevance(video.artist ?? '');
  const channel = normalizeForRelevance(video.channel_name);
  const artistAndChannel = `${artist} ${channel}`.trim();
  const primaryCandidates = mode === 'artist'
    ? [artistAndChannel]
    : getSongTitleCandidates(video.title);
  const secondary = mode === 'artist' ? title : artistAndChannel;

  if (primaryCandidates.some((primary) => primary === normalizedQuery)) return 5;
  if (primaryCandidates.some((primary) => primary.startsWith(normalizedQuery))) return 4;
  if (primaryCandidates.some((primary) => primary.includes(normalizedQuery))) return 3;
  if (primaryCandidates.some((primary) => containsEveryToken(primary, normalizedQuery))) return 2;
  if (
    secondary.includes(normalizedQuery) ||
    containsEveryToken(secondary, normalizedQuery)
  ) {
    return 1;
  }
  return 0;
}

export function getKaraokeTier(video: YouTubeVideo): number {
  if (!video.embeddable) return 0;

  const title = normalizeYouTubeSearchText(video.title);
  const channel = normalizeYouTubeSearchText(video.channel_name);
  const hasTitleKaraokeSignal = TITLE_KARAOKE_SIGNALS.some((signal) =>
    title.includes(signal)
  );

  if (HARD_NON_KARAOKE_TITLE_SIGNALS.some((signal) => title.includes(signal))) return 0;
  if (
    !hasTitleKaraokeSignal &&
    OFFICIAL_NON_KARAOKE_TITLE_SIGNALS.some((signal) => title.includes(signal))
  ) {
    return 0;
  }
  if (hasTitleKaraokeSignal) return 2;
  if (CHANNEL_KARAOKE_SIGNALS.some((signal) => channel.includes(signal))) return 1;
  return 0;
}

export function rankKaraokeVideos(
  videos: readonly YouTubeVideo[],
  query: string,
  mode: YouTubeSearchMode = 'song',
  preserveSearchMatches = false
): YouTubeVideo[] {
  return videos
    // Upstream relevance can match lyrics/description absent from the title.
    // Local suggestions must still match text; they have no upstream evidence.
    .filter((video) => preserveSearchMatches || getSearchRelevanceTier(video, query, mode) > 0)
    .filter((video) => getKaraokeTier(video) > 0)
    .map((video, originalIndex) => ({ video, originalIndex }))
    .sort((left, right) => {
      const relevanceDifference =
        getSearchRelevanceTier(right.video, query, mode) -
        getSearchRelevanceTier(left.video, query, mode);
      if (relevanceDifference !== 0) return relevanceDifference;

      const officialDifference = Number(Boolean(getOfficialYouTubeChannel(right.video.channel_id)))
        - Number(Boolean(getOfficialYouTubeChannel(left.video.channel_id)));
      if (officialDifference !== 0) return officialDifference;

      const karaokeDifference = getKaraokeTier(right.video) - getKaraokeTier(left.video);
      if (karaokeDifference !== 0) return karaokeDifference;

      const leftHasViews = left.video.views_count !== undefined;
      const rightHasViews = right.video.views_count !== undefined;
      if (leftHasViews !== rightHasViews) return rightHasViews ? 1 : -1;

      const viewsDifference =
        (right.video.views_count ?? 0) - (left.video.views_count ?? 0);
      if (viewsDifference !== 0) return viewsDifference;

      const karaokeScoreDifference = right.video.karaoke_score - left.video.karaoke_score;
      if (karaokeScoreDifference !== 0) return karaokeScoreDifference;

      return left.originalIndex - right.originalIndex;
    })
    .map(({ video }) => video);
}
