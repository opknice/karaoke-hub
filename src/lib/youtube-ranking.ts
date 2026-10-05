import type { YouTubeVideo } from './types';
import {
  getOfficialYouTubeChannel,
  isOfficialChannelTitleExcluded,
} from './official-youtube-channels';

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
const THAI_WORD_SEGMENTER = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter('th', { granularity: 'word' })
  : null;

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

export function tokenizeYouTubeSearchText(value: string): string[] {
  const normalized = normalizeForRelevance(value);
  if (!normalized) return [];
  if (!THAI_WORD_SEGMENTER) return normalized.split(' ').filter(Boolean);
  return [...THAI_WORD_SEGMENTER.segment(normalized)]
    .filter(({ isWordLike }) => isWordLike !== false)
    .map(({ segment }) => segment)
    .filter(Boolean);
}

function hasExactTokenSequence(candidate: string, query: string): boolean {
  const candidateTokens = tokenizeYouTubeSearchText(candidate);
  const queryTokens = tokenizeYouTubeSearchText(query);
  return candidateTokens.length === queryTokens.length
    && candidateTokens.every((token, index) => token === queryTokens[index]);
}

function startsWithTokenSequence(candidate: string, query: string): boolean {
  const candidateTokens = tokenizeYouTubeSearchText(candidate);
  const queryTokens = tokenizeYouTubeSearchText(query);
  return queryTokens.length > 0
    && candidateTokens.length >= queryTokens.length
    && queryTokens.every((token, index) => token === candidateTokens[index]);
}

function containsTokenSequence(candidate: string, query: string): boolean {
  const candidateTokens = tokenizeYouTubeSearchText(candidate);
  const queryTokens = tokenizeYouTubeSearchText(query);
  if (queryTokens.length === 0 || candidateTokens.length < queryTokens.length) return false;
  return candidateTokens.some((_, start) => (
    start + queryTokens.length <= candidateTokens.length
    && queryTokens.every((token, offset) => token === candidateTokens[start + offset])
  ));
}

function editDistance(left: string, right: string): number {
  const leftCharacters = [...left];
  const rightCharacters = [...right];
  let previous = Array.from({ length: rightCharacters.length + 1 }, (_, index) => index);

  for (let leftIndex = 0; leftIndex < leftCharacters.length; leftIndex++) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < rightCharacters.length; rightIndex++) {
      current.push(leftCharacters[leftIndex] === rightCharacters[rightIndex]
        ? previous[rightIndex]
        : 1 + Math.min(previous[rightIndex], current[rightIndex], previous[rightIndex + 1]));
    }
    previous = current;
  }
  return previous[rightCharacters.length];
}

function isFuzzyTokenSequence(candidate: string, query: string): boolean {
  const candidateTokens = tokenizeYouTubeSearchText(candidate);
  const queryTokens = tokenizeYouTubeSearchText(query);
  if (
    queryTokens.length === 0
    || candidateTokens.length !== queryTokens.length
    || normalizeYouTubeSearchText(query).length < 4
  ) return false;

  let changedTokens = 0;
  for (let index = 0; index < queryTokens.length; index++) {
    const queryToken = queryTokens[index];
    const candidateToken = candidateTokens[index];
    if (queryToken === candidateToken) continue;
    if (queryToken.length < 3 || candidateToken.length < 3) return false;
    if (editDistance(queryToken, candidateToken) > 1) return false;
    changedTokens++;
  }
  return changedTokens > 0;
}

function getSongTitleCandidates(value: string): string[] {
  const withoutBracketedMetadata = value.replace(BRACKETED_TITLE_METADATA, ' ');
  const separatorParts = withoutBracketedMetadata.split(TITLE_ARTIST_SEPARATOR);
  const bracketedMetadata = value.match(BRACKETED_TITLE_METADATA) ?? [];

  return [
    ...separatorParts.map(normalizeForRelevance),
    ...bracketedMetadata.map(normalizeForRelevance),
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

  if (primaryCandidates.some((primary) => (
    primary === normalizedQuery || hasExactTokenSequence(primary, normalizedQuery)
  ))) return 5;
  if (primaryCandidates.some((primary) => (
    primary.startsWith(normalizedQuery) || startsWithTokenSequence(primary, normalizedQuery)
  ))) return 4;
  if (primaryCandidates.some((primary) => (
    primary.includes(normalizedQuery) || containsTokenSequence(primary, normalizedQuery)
  ))) return 3;
  if (primaryCandidates.some((primary) => isFuzzyTokenSequence(primary, normalizedQuery))) return 2;
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
  if (isOfficialChannelTitleExcluded(video.channel_id, video.title)) return 0;

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
  const ranked: {
    video: YouTubeVideo;
    originalIndex: number;
    relevance: number;
    official: number;
    karaokeTier: number;
  }[] = [];

  for (const video of videos) {
    // Upstream relevance can match lyrics/description absent from the title.
    // Local suggestions must still match text; they have no upstream evidence.
    const relevance = getSearchRelevanceTier(video, query, mode);
    if (!preserveSearchMatches && relevance <= 0) continue;
    const karaokeTier = getKaraokeTier(video);
    if (karaokeTier <= 0) continue;
    ranked.push({
      video,
      originalIndex: ranked.length,
      relevance,
      official: Number(Boolean(getOfficialYouTubeChannel(video.channel_id))),
      karaokeTier,
    });
  }

  return ranked
    .sort((left, right) => {
      const officialDifference = right.official - left.official;
      if (officialDifference !== 0) return officialDifference;

      const relevanceDifference = right.relevance - left.relevance;
      if (relevanceDifference !== 0) return relevanceDifference;

      const karaokeDifference = right.karaokeTier - left.karaokeTier;
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
