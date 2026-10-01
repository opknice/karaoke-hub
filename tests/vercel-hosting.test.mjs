import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Vercel runtime uses Supabase instead of a writable SQLite filesystem', () => {
  const store = read('src/lib/youtube-search-store.ts');
  assert.doesNotMatch(store, /node:(?:sqlite|fs|path)/);
  assert.match(store, /rpc\/karaoke_search_reserve/);
  assert.match(store, /rpc\/karaoke_search_get_budget/);
  assert.match(store, /rpc\/karaoke_search_cleanup/);
});

test('search-state migration is server-only and keeps reservation atomic', () => {
  const migration = read('supabase/migrations/20260930145503_vercel_search_state_and_catalog_cron.sql');
  for (const table of ['cache', 'budget', 'leases', 'clients', 'outages']) {
    assert.match(migration, new RegExp(`create table public\\.karaoke_search_${table}`));
    assert.match(migration, new RegExp(`alter table public\\.karaoke_search_${table} enable row level security`));
  }
  assert.match(migration, /for update;/);
  assert.match(migration, /security invoker/g);
  assert.match(migration, /from public, anon, authenticated;/);
  assert.match(migration, /to service_role;/);
});

test('Vercel Cron is daily, protected and replaces the server timer', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.deepEqual(config.crons, [{ path: '/api/internal/catalog-sync', schedule: '23 3 * * *' }]);
  const route = read('src/app/api/internal/catalog-sync/route.ts');
  assert.match(route, /Bearer \$\{secret\}/);
  assert.match(route, /maxDuration = 300/);
  assert.match(route, /syncOfficialCatalogDaily/);
  const instrumentation = read('src/instrumentation.ts');
  assert.match(instrumentation, /process\.env\.VERCEL !== '1'/);
});
