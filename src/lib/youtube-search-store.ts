import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { YouTubeVideo } from './types';
import { isYouTubeVideo } from './youtube-video-validation';

const DAY_MS = 86_400_000;
let database: DatabaseSync | undefined;

export class SearchBudgetError extends Error {}

function db(): DatabaseSync {
  if (database) return database;
  // Runtime database, not an asset to include in Next.js output tracing.
  const path = resolve(/* turbopackIgnore: true */ process.env.YOUTUBE_SEARCH_DB_PATH || '.data/youtube-search.sqlite');
  mkdirSync(dirname(path), { recursive: true });
  const connection = new DatabaseSync(path, { timeout: 1000 });
  connection.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS search_cache (
      query TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS search_budget (
      day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE TABLE IF NOT EXISTS search_leases (
      query TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS search_clients (
      client TEXT PRIMARY KEY, last_request INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS search_outages (
      day TEXT PRIMARY KEY
    ) STRICT;
  `);
  database = connection;
  return connection;
}

function budgetDay(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function dailyLimit(): number {
  const value = Number(process.env.YOUTUBE_SEARCH_DAILY_LIMIT ?? 100);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid YOUTUBE_SEARCH_DAILY_LIMIT');
  return value;
}

export function getSearchBudget() {
  const row = db().prepare('SELECT used FROM search_budget WHERE day = ?').get(budgetDay());
  const used = typeof row?.used === 'number' ? row.used : 0;
  const limit = dailyLimit();
  const upstreamExhausted = Boolean(db().prepare('SELECT day FROM search_outages WHERE day=?').get(budgetDay()));
  return { used, limit, remaining: Math.max(0, limit - used), warning: used >= Math.floor(limit * 0.8), upstreamExhausted };
}

export function markUpstreamQuotaExhausted(): void {
  db().prepare('INSERT OR IGNORE INTO search_outages(day) VALUES (?)').run(budgetDay());
}

export function readStoredSearch(query: string): { results: YouTubeVideo[]; updatedAt: number } | undefined {
  const row = db().prepare('SELECT payload, updated_at FROM search_cache WHERE query = ? AND expires_at > ?')
    .get(query, Date.now());
  if (typeof row?.payload !== 'string' || typeof row.updated_at !== 'number') return undefined;
  try {
    const value: unknown = JSON.parse(row.payload);
    if (Array.isArray(value) && value.every(isYouTubeVideo)) return { results: value, updatedAt: row.updated_at };
  } catch { /* Corrupt cache is ignored; budget records are never reset. */ }
  return undefined;
}

export function writeStoredSearch(query: string, results: YouTubeVideo[]): void {
  const now = Date.now();
  const connection = db();
  connection.prepare('DELETE FROM search_cache WHERE expires_at <= ?').run(now);
  connection.prepare(`INSERT INTO search_cache VALUES (?, ?, ?, ?)
    ON CONFLICT(query) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at, expires_at=excluded.expires_at`)
    .run(query, JSON.stringify(results), now, now + (results.length ? 7 * DAY_MS : 15 * 60_000));
}

// Reserve before sending the request, including failed attempts. The transaction
// protects the daily cap and duplicate queries across Node workers on this host.
export function reserveSearch(query: string, client: string): string {
  const connection = db();
  connection.exec('BEGIN IMMEDIATE');
  try {
    const now = Date.now();
    if (connection.prepare('SELECT day FROM search_outages WHERE day=?').get(budgetDay())) {
      throw new SearchBudgetError('โควตาค้นหา YouTube รายวันเต็มแล้ว กรุณารอรอบรีเซ็ต ยังเลือกเพลงที่บันทึกไว้หรือวางลิงก์ได้');
    }
    connection.prepare('DELETE FROM search_leases WHERE expires_at <= ?').run(now);
    connection.prepare('DELETE FROM search_clients WHERE last_request < ?').run(now - DAY_MS);
    if (connection.prepare('SELECT query FROM search_leases WHERE query = ?').get(query)) {
      throw new SearchBudgetError('คำค้นนี้กำลังดำเนินการ กรุณารอสักครู่แล้วกดค้นหาอีกครั้ง');
    }
    const previous = connection.prepare('SELECT last_request FROM search_clients WHERE client = ?').get(client);
    if (typeof previous?.last_request === 'number' && now - previous.last_request < 3000) {
      throw new SearchBudgetError('กรุณาเว้นระยะ 3 วินาทีก่อนค้นหาคำใหม่');
    }
    const day = budgetDay();
    connection.prepare('INSERT OR IGNORE INTO search_budget(day, used) VALUES (?, 0)').run(day);
    const result = connection.prepare('UPDATE search_budget SET used=used+1 WHERE day=? AND used < ?').run(day, dailyLimit());
    if (Number(result.changes) !== 1) throw new SearchBudgetError('ใช้ครบงบค้นหารายวันของแอปแล้ว ยังเลือกเพลงที่บันทึกไว้หรือวางลิงก์ YouTube ได้');
    const token = randomUUID();
    connection.prepare('INSERT INTO search_leases VALUES (?, ?, ?)').run(query, token, now + 120_000);
    connection.prepare('INSERT INTO search_clients VALUES (?, ?) ON CONFLICT(client) DO UPDATE SET last_request=excluded.last_request').run(client, now);
    connection.exec('COMMIT');
    return token;
  } catch (error: unknown) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

export function releaseSearch(query: string, token: string): void {
  db().prepare('DELETE FROM search_leases WHERE query=? AND token=?').run(query, token);
}
