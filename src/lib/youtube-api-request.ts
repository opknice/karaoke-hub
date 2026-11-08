import 'server-only';
import { catalogRest } from './supabase/catalog-rest';
import { getYouTubeApiKeys, keyBudgetConfig } from './youtube-api-keys';

export class YouTubeQuotaError extends Error {
  readonly status = 429;
  constructor(reason = 'upstream_exhausted') {
    super(reason === 'budget_exhausted'
      ? 'ใช้ครบงบค้นหารายวันของทุก API key แล้ว ยังเลือกเพลงที่บันทึกไว้หรือวางลิงก์ YouTube ได้'
      : 'โควตา YouTube ของทุก API key เต็มแล้ว กรุณารอรอบรีเซ็ต ยังเลือกเพลงในคลังได้');
    this.name = 'YouTubeQuotaError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isYouTubeDailyQuotaError(status: number, payload: unknown): boolean {
  if (![403, 429].includes(status) || !record(payload) || !record(payload.error)) return false;
  const error = payload.error;
  const message = typeof error.message === 'string' ? error.message : '';
  const reasons = Array.isArray(error.errors)
    ? error.errors.flatMap(item => record(item) && typeof item.reason === 'string' ? [item.reason] : []) : [];
  if (reasons.some(reason => /rateLimitExceeded|userRateLimitExceeded|keyInvalid|forbidden/i.test(reason))
    || /per minute|per second|rate limit/iu.test(message)) return false;
  return reasons.some(reason => /^(?:quotaExceeded|dailyLimitExceeded|dailyLimitExceededUnreg)$/i.test(reason))
    || /per day|daily|exceeded your.*quota/iu.test(message);
}

async function send(url: URL, key: string): Promise<Response> {
  const request = new URL(url);
  request.searchParams.set('key', key);
  try {
    return await fetch(request, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch {
    // Native fetch errors can contain the complete URL, including the key.
    throw new Error('เชื่อมต่อ YouTube ไม่สำเร็จ กรุณาลองใหม่');
  }
}

export async function requestYouTubeApi(
  url: URL,
  options: { catalog?: boolean } = {},
): Promise<Response> {
  if (url.origin !== 'https://www.googleapis.com' || !/^\/youtube\/v3\/(search|videos|channels|playlistItems)$/.test(url.pathname)) {
    throw new Error('Unsupported YouTube API endpoint');
  }
  const keys = getYouTubeApiKeys();
  if (!keys.length) throw new Error('ยังไม่ได้ตั้งค่า YouTube API Key');
  // Preserve the legacy single-key budget/lease implementation and deployments
  // that have not enabled the optional backup configuration.
  if (keys.length === 1) {
    if (options.catalog) {
      const reserved = await catalogRest('rpc/karaoke_catalog_reserve', { method: 'POST', body: '{}' });
      if (reserved !== true) throw new Error('ครบงบอัปเดตคลังเพลง 2,000 คำขอต่อวันแล้ว ยังค้นในคลังได้');
    }
    return send(url, keys[0].key);
  }

  const bucket = url.pathname.endsWith('/search') ? 'search' : 'general';
  const tried = new Set<string>();
  while (tried.size < keys.length) {
    // Keep the complete priority list in every reservation so the database can
    // consistently recognize the primary when importing legacy daily usage.
    const reservation = await catalogRest('rpc/karaoke_youtube_reserve', {
      method: 'POST', body: JSON.stringify({ p_keys: keyBudgetConfig(keys), p_bucket: bucket,
        p_excluded: [...tried], p_catalog: options.catalog === true }),
    });
    if (!record(reservation) || typeof reservation.ok !== 'boolean') {
      throw new Error('รูปแบบข้อมูลโควตา YouTube ไม่ถูกต้อง');
    }
    if (!reservation.ok) {
      if (reservation.reason === 'catalog_budget_exhausted') {
        throw new Error('ครบงบอัปเดตคลังเพลง 2,000 คำขอต่อวันแล้ว ยังค้นในคลังได้');
      }
      throw new YouTubeQuotaError(typeof reservation.reason === 'string' ? reservation.reason : undefined);
    }
    const selected = keys.find(key => key.id === reservation.keyId);
    if (!selected || tried.has(selected.id) || typeof reservation.day !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(reservation.day)) {
      throw new Error('ข้อมูลการเลือก YouTube API key ไม่ถูกต้อง');
    }
    tried.add(selected.id);
    const response = await send(url, selected.key);
    if (response.ok) return response;
    const payload: unknown = await response.clone().json().catch(() => undefined);
    if (!isYouTubeDailyQuotaError(response.status, payload)) return response;
    await catalogRest('rpc/karaoke_youtube_mark_exhausted', {
      method: 'POST', body: JSON.stringify({ p_key_id: selected.id, p_bucket: bucket, p_day: reservation.day }),
    });
  }
  throw new YouTubeQuotaError();
}
