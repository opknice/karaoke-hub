'use client';

import { useEffect, useState } from 'react';

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const DEBOUNCE_MS = 250;

interface YouTubeSuggestionsResponse {
  suggestions?: unknown;
}

export function useYouTubeSuggestions(query: string, enabled: boolean) {
  const [response, setResponse] = useState<{ query: string; suggestions: string[]; isLoading: boolean }>({
    query: '',
    suggestions: [],
    isLoading: false,
  });
  const normalizedQuery = query.trim().replace(/\s+/g, ' ');
  const isQueryValid = enabled
    && normalizedQuery.length >= MIN_QUERY_LENGTH
    && normalizedQuery.length <= MAX_QUERY_LENGTH;

  useEffect(() => {
    if (!isQueryValid) return;

    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      setResponse({ query: normalizedQuery, suggestions: [], isLoading: true });
      void fetch(`/api/youtube-suggestions?q=${encodeURIComponent(normalizedQuery)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return [];
          const payload: unknown = await response.json();
          if (!payload || typeof payload !== 'object' || !('suggestions' in payload)) return [];
          const values = (payload as YouTubeSuggestionsResponse).suggestions;
          return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
        })
        .then((nextSuggestions) => {
          if (!controller.signal.aborted) setResponse({ query: normalizedQuery, suggestions: nextSuggestions, isLoading: true });
        })
        .catch(() => {
          if (!controller.signal.aborted) setResponse({ query: normalizedQuery, suggestions: [], isLoading: true });
        })
        .finally(() => {
          if (!controller.signal.aborted) setResponse((current) => (
            current.query === normalizedQuery ? { ...current, isLoading: false } : current
          ));
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery, isQueryValid]);

  const responseMatchesQuery = response.query === normalizedQuery;
  return {
    suggestions: isQueryValid && responseMatchesQuery ? response.suggestions : [],
    isLoading: isQueryValid && (!responseMatchesQuery || response.isLoading),
  };
}
