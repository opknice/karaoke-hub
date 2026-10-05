import 'server-only';
import type { YouTubeVideo } from './types';
import { isYouTubeVideo } from './youtube-video-validation';
import { catalogRest } from './supabase/catalog-rest';

const DAY_SECONDS = 86_400;

export class SearchBudgetError extends Error {}

interface SearchBudget {
  used: number;
  limit: number;
  remaining: number;
  warning: boolean;
  upstreamExhausted: boolean;
}

interface SearchReservation {
  ok: boolean;
  reason?: string;
  token?: string;
}

export type SearchHistorySource = 'youtube' | 'video';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function dailyLimit(): number {
  const value = Number(process.env.YOUTUBE_SEARCH_DAILY_LIMIT ?? 100);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error('Invalid YOUTUBE_SEARCH_DAILY_LIMIT');
  }
  return value;
}

export async function getSearchBudget(): Promise<SearchBudget> {
  const value = await catalogRest('rpc/karaoke_search_get_budget', {
    method: 'POST', body: JSON.stringify({ p_daily_limit: dailyLimit() }),
  });
  if (!record(value)
    || typeof value.used !== 'number'
    || typeof value.limit !== 'number'
    || typeof value.remaining !== 'number'
    || typeof value.warning !== 'boolean'
    || typeof value.upstreamExhausted !== 'boolean') {
    throw new Error('รูปแบบข้อมูลงบค้นหาจาก Supabase ไม่ถูกต้อง');
  }
  return { used: value.used, limit: value.limit, remaining: value.remaining,
    warning: value.warning, upstreamExhausted: value.upstreamExhausted };
}

export async function markUpstreamQuotaExhausted(): Promise<void> {
  await catalogRest('rpc/karaoke_search_mark_outage', { method: 'POST', body: '{}' });
}

export async function readStoredSearch(
  query: string
): Promise<{ results: YouTubeVideo[]; updatedAt: number } | undefined> {
  const value = await catalogRest('rpc/karaoke_search_get', {
    method: 'POST', body: JSON.stringify({ p_query: query }),
  });
  const row = Array.isArray(value) && record(value[0]) ? value[0] : undefined;
  if (!row || !Array.isArray(row.payload) || !row.payload.every(isYouTubeVideo)
    || typeof row.updated_at !== 'string') return undefined;
  const updatedAt = Date.parse(row.updated_at);
  return Number.isFinite(updatedAt) ? { results: row.payload, updatedAt } : undefined;
}

export async function writeStoredSearch(query: string, results: YouTubeVideo[]): Promise<void> {
  await catalogRest('rpc/karaoke_search_store', {
    method: 'POST',
    body: JSON.stringify({ p_query: query, p_payload: results,
      p_ttl_seconds: results.length ? 7 * DAY_SECONDS : 15 * 60 }),
  });
}

export async function writeSearchHistory(
  query: string,
  results: YouTubeVideo[],
  source: SearchHistorySource,
): Promise<void> {
  await catalogRest('rpc/karaoke_search_history_store', {
    method: 'POST',
    body: JSON.stringify({ p_query: query, p_payload: results, p_source: source }),
  });
}

function reservationMessage(reason: string | undefined): string {
  if (reason === 'upstream_exhausted') {
    return 'โควตาค้นหา YouTube รายวันเต็มแล้ว กรุณารอรอบรีเซ็ต ยังเลือกเพลงที่บันทึกไว้หรือวางลิงก์ได้';
  }
  if (reason === 'query_in_progress') return 'คำค้นนี้กำลังดำเนินการ กรุณารอสักครู่แล้วกดค้นหาอีกครั้ง';
  if (reason === 'client_cooldown') return 'กรุณาเว้นระยะ 3 วินาทีก่อนค้นหาคำใหม่';
  if (reason === 'budget_exhausted') {
    return 'ใช้ครบงบค้นหารายวันของแอปแล้ว ยังเลือกเพลงที่บันทึกไว้หรือวางลิงก์ YouTube ได้';
  }
  return 'ไม่สามารถจองงบค้นหา YouTube ได้ กรุณาลองใหม่';
}

export async function reserveSearch(query: string, client: string): Promise<string> {
  const value = await catalogRest('rpc/karaoke_search_reserve', {
    method: 'POST',
    body: JSON.stringify({ p_query: query, p_client: client, p_daily_limit: dailyLimit() }),
  });
  const reservation = record(value) ? value as unknown as SearchReservation : undefined;
  if (!reservation?.ok || typeof reservation.token !== 'string') {
    throw new SearchBudgetError(reservationMessage(reservation?.reason));
  }
  return reservation.token;
}

export async function releaseSearch(query: string, token: string): Promise<void> {
  await catalogRest('rpc/karaoke_search_release', {
    method: 'POST', body: JSON.stringify({ p_query: query, p_token: token }),
  });
}

export async function cleanupSearchState(): Promise<void> {
  await catalogRest('rpc/karaoke_search_cleanup', { method: 'POST', body: '{}' });
}
