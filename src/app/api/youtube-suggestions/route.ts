import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SUGGESTION_CACHE_SECONDS = 60;
const MAX_SUGGESTIONS = 8;

function getSuggestionQueries(payload: unknown, query: string): string[] {
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) return [];

  const normalizedQuery = query.toLocaleLowerCase('th-TH');
  const seen = new Set<string>();
  const suggestions: string[] = [];

  for (const value of payload[1]) {
    if (typeof value !== 'string') continue;
    const suggestion = value.trim();
    const normalizedSuggestion = suggestion.toLocaleLowerCase('th-TH');
    if (!suggestion || normalizedSuggestion === normalizedQuery || seen.has(normalizedSuggestion)) continue;
    seen.add(normalizedSuggestion);
    suggestions.push(suggestion);
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }

  return suggestions;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim().replace(/\s+/g, ' ') ?? '';
  if (query.length < 2 || query.length > 100) {
    return NextResponse.json({ suggestions: [] }, { status: 400 });
  }

  const url = new URL('https://suggestqueries.google.com/complete/search');
  url.searchParams.set('client', 'firefox');
  url.searchParams.set('ds', 'yt');
  url.searchParams.set('hl', 'th');
  url.searchParams.set('gl', 'TH');
  url.searchParams.set('q', query);

  try {
    const response = await fetch(url, {
      cache: 'force-cache',
      next: { revalidate: SUGGESTION_CACHE_SECONDS },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`Suggestion service returned ${response.status}`);

    const suggestions = getSuggestionQueries(await response.json(), query);
    return NextResponse.json({ suggestions }, {
      headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' },
    });
  } catch (error: unknown) {
    console.warn('Unable to load YouTube search suggestions:', error);
    return NextResponse.json({ suggestions: [] }, { status: 503 });
  }
}
