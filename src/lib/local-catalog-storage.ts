import { LOCAL_CATALOG_SCHEMA_VERSION, type LocalCatalogMeta, type LocalCatalogPage, type LocalCatalogSong } from './local-catalog-types';
import { isYouTubeVideo } from './youtube-video-validation';

const DB_NAME = 'karaoke-local-catalog';
const DB_VERSION = 1;
const SONGS_STORE = 'songs';
const META_STORE = 'meta';

type StoredSong = LocalCatalogSong & { generation: string };

export interface LocalCatalogSyncResult {
  meta: LocalCatalogMeta;
  changed: boolean;
  updatedCount: number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('อ่านข้อมูลในเครื่องไม่สำเร็จ'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('บันทึกข้อมูลในเครื่องไม่สำเร็จ'));
    transaction.onabort = () => reject(transaction.error ?? new Error('บันทึกข้อมูลในเครื่องไม่สำเร็จ'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('เบราว์เซอร์นี้ไม่รองรับคลังในเครื่อง'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const songs = db.createObjectStore(SONGS_STORE, { keyPath: ['generation', 'video_id'] });
      songs.createIndex('generation', 'generation');
      db.createObjectStore(META_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('เปิดคลังในเครื่องไม่สำเร็จ'));
    request.onblocked = () => reject(new Error('มีแท็บอื่นกำลังใช้คลังเพลง กรุณาปิดแท็บนั้นแล้วลองใหม่'));
  });
}

function validMeta(value: unknown): value is LocalCatalogMeta & { key: 'active' } {
  if (typeof value !== 'object' || value === null) return false;
  const meta = value as Record<string, unknown>;
  return meta.key === 'active' && meta.schemaVersion === LOCAL_CATALOG_SCHEMA_VERSION
    && typeof meta.generation === 'string' && typeof meta.count === 'number'
    && meta.count > 0 && typeof meta.updatedAt === 'string';
}

async function activeMeta(db: IDBDatabase): Promise<LocalCatalogMeta | null> {
  const transaction = db.transaction(META_STORE, 'readonly');
  const value: unknown = await requestResult(transaction.objectStore(META_STORE).get('active'));
  return validMeta(value) ? value : null;
}

async function stagedDownload(db: IDBDatabase): Promise<{ generation: string; startedAt: number } | null> {
  const transaction = db.transaction(META_STORE, 'readonly');
  const value: unknown = await requestResult(transaction.objectStore(META_STORE).get('staging'));
  if (typeof value !== 'object' || value === null) return null;
  const stage = value as Record<string, unknown>;
  return typeof stage.generation === 'string' && typeof stage.startedAt === 'number'
    ? { generation: stage.generation, startedAt: stage.startedAt } : null;
}

export async function getLocalCatalogMeta(): Promise<LocalCatalogMeta | null> {
  const db = await openDatabase();
  try {
    const meta = await activeMeta(db);
    const staged = await stagedDownload(db);
    if (staged && staged.generation !== meta?.generation && Date.now() - staged.startedAt > 3_600_000) {
      await removeGeneration(db, staged.generation);
      const transaction = db.transaction(META_STORE, 'readwrite');
      transaction.objectStore(META_STORE).delete('staging');
      await transactionDone(transaction);
    }
    return meta;
  }
  finally { db.close(); }
}

export async function readLocalCatalogSongs(meta: LocalCatalogMeta): Promise<LocalCatalogSong[]> {
  const db = await openDatabase();
  try {
    const current = await activeMeta(db);
    if (!current || current.generation !== meta.generation) throw new Error('คลังในเครื่องเปลี่ยนไป กรุณาโหลดใหม่');
    const transaction = db.transaction(SONGS_STORE, 'readonly');
    const rows = await requestResult(transaction.objectStore(SONGS_STORE)
      .index('generation').getAll(IDBKeyRange.only(meta.generation))) as StoredSong[];
    if (rows.length !== meta.count) throw new Error('ข้อมูลคลังในเครื่องไม่ครบ กรุณาอัปเดตใหม่');
    return rows.map(({ video_id, expires_at, video }) => ({ video_id, expires_at, video }));
  } finally { db.close(); }
}

async function removeGeneration(db: IDBDatabase, generation: string): Promise<void> {
  const transaction = db.transaction(SONGS_STORE, 'readwrite');
  const index = transaction.objectStore(SONGS_STORE).index('generation');
  const request = index.openCursor(IDBKeyRange.only(generation));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  await transactionDone(transaction);
}

async function countGeneration(db: IDBDatabase, generation: string): Promise<number> {
  const transaction = db.transaction(SONGS_STORE, 'readonly');
  return requestResult(transaction.objectStore(SONGS_STORE).index('generation').count(IDBKeyRange.only(generation)));
}

function parsePage(value: unknown): LocalCatalogPage {
  if (typeof value !== 'object' || value === null) throw new Error('ข้อมูลดาวน์โหลดไม่ถูกต้อง');
  const page = value as Partial<LocalCatalogPage>;
  if (page.success !== true || page.schemaVersion !== LOCAL_CATALOG_SCHEMA_VERSION
    || typeof page.generatedAt !== 'string' || !Array.isArray(page.songs) || typeof page.hasMore !== 'boolean'
    || !(page.nextCursor === null || typeof page.nextCursor === 'string')) {
    throw new Error('รูปแบบข้อมูลคลังไม่รองรับ กรุณารีเฟรชหน้า');
  }
  for (const song of page.songs) {
    if (typeof song !== 'object' || song === null || typeof song.video_id !== 'string'
      || typeof song.expires_at !== 'string' || !isYouTubeVideo(song.video)
      || song.video_id !== song.video.youtube_video_id) throw new Error('รายการเพลงที่ดาวน์โหลดไม่ถูกต้อง');
  }
  return page as LocalCatalogPage;
}

export async function downloadLocalCatalog(
  signal: AbortSignal,
  onProgress: (count: number) => void,
): Promise<LocalCatalogMeta> {
  const db = await openDatabase();
  const generation = crypto.randomUUID();
  let cursor: string | null = null;
  const ids = new Set<string>();
  let latestGeneratedAt: string | null = null;
  let previous: LocalCatalogMeta | null = null;
  try {
    previous = await activeMeta(db);
    const stagingTransaction = db.transaction(META_STORE, 'readwrite');
    stagingTransaction.objectStore(META_STORE).put({ key: 'staging', generation, startedAt: Date.now() });
    await transactionDone(stagingTransaction);
    do {
      signal.throwIfAborted();
      const url = new URL('/api/catalog/export', window.location.origin);
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await fetch(url, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('ดาวน์โหลดข้อมูลเพลงไม่สำเร็จ กรุณาลองใหม่');
      const page = parsePage(await response.json() as unknown);
      latestGeneratedAt = page.generatedAt;
      if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor)) {
        throw new Error('ลำดับหน้าข้อมูลคลังไม่ถูกต้อง');
      }
      const transaction = db.transaction(SONGS_STORE, 'readwrite');
      const store = transaction.objectStore(SONGS_STORE);
      for (const song of page.songs) {
        if (ids.has(song.video_id)) throw new Error('พบเพลงซ้ำในข้อมูลที่ดาวน์โหลด');
        ids.add(song.video_id);
        store.put({ ...song, generation } satisfies StoredSong);
      }
      await transactionDone(transaction);
      onProgress(ids.size);
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    } while (true);

    if (ids.size === 0) throw new Error('คลังเพลงที่ดาวน์โหลดว่างเปล่า');
    signal.throwIfAborted();
    const meta: LocalCatalogMeta = {
      schemaVersion: LOCAL_CATALOG_SCHEMA_VERSION,
      generation,
      count: ids.size,
      updatedAt: latestGeneratedAt ?? new Date().toISOString(),
    };
    const transaction = db.transaction(META_STORE, 'readwrite');
    transaction.objectStore(META_STORE).put({ key: 'active', ...meta });
    transaction.objectStore(META_STORE).delete('staging');
    await transactionDone(transaction);
    if (previous) void removeGeneration(db, previous.generation).catch(() => {}).finally(() => db.close());
    else db.close();
    return meta;
  } catch (error) {
    try {
      await removeGeneration(db, generation);
      const staged = await stagedDownload(db);
      if (staged?.generation === generation) {
        const transaction = db.transaction(META_STORE, 'readwrite');
        transaction.objectStore(META_STORE).delete('staging');
        await transactionDone(transaction);
      }
    } finally { db.close(); }
    throw error;
  }
}

export async function syncLocalCatalog(
  snapshot: LocalCatalogMeta,
  signal: AbortSignal,
  onProgress: (count: number) => void,
): Promise<LocalCatalogSyncResult> {
  const db = await openDatabase();
  let cursor: string | null = null;
  let until: string | null = null;
  let updatedCount = 0;
  let changed = false;
  try {
    const current = await activeMeta(db);
    if (!current || current.generation !== snapshot.generation) {
      throw new Error('คลังในเครื่องเปลี่ยนไประหว่างซิงก์ กรุณาลองใหม่');
    }
    if (current.count !== snapshot.count || current.updatedAt !== snapshot.updatedAt) {
      if (Date.parse(current.updatedAt) >= Date.parse(snapshot.updatedAt)) {
        db.close();
        return { meta: current, changed: true, updatedCount: 0 };
      }
      throw new Error('คลังในเครื่องเปลี่ยนไประหว่างซิงก์ กรุณาลองใหม่');
    }

    do {
      signal.throwIfAborted();
      const url = new URL('/api/catalog/export', window.location.origin);
      url.searchParams.set('since', snapshot.updatedAt);
      if (until) url.searchParams.set('until', until);
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await fetch(url, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('ซิงก์เพลงใหม่ไม่สำเร็จ กรุณาลองใหม่');
      const page = parsePage(await response.json() as unknown);
      if (!until) until = page.generatedAt;
      if (page.generatedAt !== until) throw new Error('ช่วงเวลาซิงก์เพลงไม่คงที่');
      if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor)) {
        throw new Error('ลำดับหน้าข้อมูลคลังไม่ถูกต้อง');
      }

      if (page.songs.length > 0) {
        const transaction = db.transaction(SONGS_STORE, 'readwrite');
        const store = transaction.objectStore(SONGS_STORE);
        for (const song of page.songs) {
          store.put({ ...song, generation: snapshot.generation } satisfies StoredSong);
        }
        await transactionDone(transaction);
        changed = true;
        updatedCount += page.songs.length;
      }
      onProgress(updatedCount);
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    } while (true);

    signal.throwIfAborted();
    const count = await countGeneration(db, snapshot.generation);
    if (count === 0) throw new Error('คลังเพลงในเครื่องว่างเปล่า กรุณาดาวน์โหลดใหม่');
    const meta: LocalCatalogMeta = {
      schemaVersion: LOCAL_CATALOG_SCHEMA_VERSION,
      generation: snapshot.generation,
      count,
      updatedAt: until ?? new Date().toISOString(),
    };
    const transaction = db.transaction(META_STORE, 'readwrite');
    transaction.objectStore(META_STORE).put({ key: 'active', ...meta });
    await transactionDone(transaction);
    db.close();
    return { meta, changed, updatedCount };
  } catch (error) {
    db.close();
    throw error;
  }
}

export async function deleteLocalCatalog(): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction([SONGS_STORE, META_STORE], 'readwrite');
    transaction.objectStore(SONGS_STORE).clear();
    transaction.objectStore(META_STORE).clear();
    await transactionDone(transaction);
  } finally { db.close(); }
}
