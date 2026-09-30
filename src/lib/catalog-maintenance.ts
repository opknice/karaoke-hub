import 'server-only';
import { syncOfficialCatalog } from './youtube-catalog';

// For this project's persistent Windows/Node server, not a serverless scheduler.
// The global marker also avoids duplicate timers during development hot reload.
type MaintenanceGlobal = typeof globalThis & { __karaokeCatalogMaintenance?: boolean };

export function startCatalogMaintenance(): void {
  if (process.env.KARAOKE_CATALOG_AUTO_SYNC === '0'
    || !process.env.YOUTUBE_API_KEY
    || !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) return;
  const scope = globalThis as MaintenanceGlobal;
  if (scope.__karaokeCatalogMaintenance) return;
  scope.__karaokeCatalogMaintenance = true;
  const run = async () => {
    try { await syncOfficialCatalog((message) => console.info(`[catalog] ${message}`)); }
    catch (error: unknown) {
      console.warn('[catalog] อัปเดตคลังไม่สำเร็จ จะลองรอบถัดไป:', error instanceof Error ? error.message : 'Unknown error');
    } finally { setTimeout(() => void run(), 24 * 60 * 60_000).unref(); }
  };
  // Do not delay boot or initiate YouTube work in the typing/search request path.
  setTimeout(() => void run(), 60_000).unref();
}
