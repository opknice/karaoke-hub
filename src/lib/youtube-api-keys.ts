import 'server-only';
import { createHash } from 'node:crypto';

export interface YouTubeApiKey {
  id: string;
  key: string;
  searchLimit: number;
}

function searchLimit(name: string): number {
  const value = Number(process.env[name] ?? 100);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

export function getYouTubeApiKeys(): YouTubeApiKey[] {
  const entries = [
    ['YOUTUBE_API_KEY', 'YOUTUBE_SEARCH_DAILY_LIMIT'],
    ['YOUTUBE_API_KEY_BACKUP', 'YOUTUBE_SEARCH_BACKUP_DAILY_LIMIT'],
  ];
  const keys: YouTubeApiKey[] = [];
  for (const [keyName, limitName] of entries) {
    const key = process.env[keyName]?.trim();
    if (!key || keys.some(entry => entry.key === key)) continue;
    keys.push({ key, id: createHash('sha256').update(key).digest('hex'), searchLimit: searchLimit(limitName) });
  }
  return keys;
}

// Only this representation may cross the database boundary.
export function keyBudgetConfig(keys = getYouTubeApiKeys()): { id: string; limit: number }[] {
  return keys.map(({ id, searchLimit }) => ({ id, limit: searchLimit }));
}
