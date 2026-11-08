const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('YouTube pool migration and RPCs execute in PostgreSQL', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const root = path.resolve(__dirname, '..');
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    set karaoke.test_now = '2026-11-08T12:00:00Z';
    -- Override only this disposable database's clock to exercise the actual
    -- migration functions at Pacific boundaries without waiting for midnight.
    create or replace function pg_catalog.now() returns timestamptz
    language sql stable as $$ select current_setting('karaoke.test_now')::timestamptz $$;
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20260930145503_vercel_search_state_and_catalog_cron.sql'), 'utf8'));
  await db.exec(`create table public.karaoke_catalog_usage(day date primary key, used integer not null default 0);
    grant select, insert, update on public.karaoke_catalog_usage to service_role;`);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20260930015046_increase_catalog_daily_limit.sql'), 'utf8'));
  await assert.rejects(db.query('select public.karaoke_youtube_get_budget($1::jsonb)', ['[]']), /does not exist/);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261108042641_youtube_key_failover.sql'), 'utf8'));
  const primary = 'a'.repeat(64), backup = 'b'.repeat(64);
  const config = (limit = 2) => JSON.stringify([{ id: primary, limit }, { id: backup, limit }]);
  async function scalar(sql, params = []) { return (await db.query(sql, params)).rows[0].result; }
  const reserve = (bucket = 'search', limit = 2, excluded = [], catalog = false) => scalar(
    'select public.karaoke_youtube_reserve($1::jsonb,$2::text,$3::text[],$4::boolean) as result',
    [config(limit), bucket, `{${excluded.join(',')}}`, catalog]);
  const mark = (id, bucket, day) => db.query(
    'select public.karaoke_youtube_mark_exhausted($1,$2,$3::date)', [id, bucket, day]);
  const budget = () => scalar('select public.karaoke_youtube_get_budget($1::jsonb) as result', [config()]);
  const clock = value => db.query("select set_config('karaoke.test_now',$1,false)", [value]);
  async function reset() {
    await db.exec(`truncate public.karaoke_youtube_key_usage, public.karaoke_search_budget,
      public.karaoke_search_outages, public.karaoke_search_leases, public.karaoke_search_clients, public.karaoke_catalog_usage;
      set karaoke.test_now = '2026-11-08T12:00:00Z';`);
  }

  await t.test('atomic reservations select primary, then backup, then stop at the configured limits', async () => {
    await reset();
    const results = await Promise.all(Array.from({ length: 20 }, () => reserve('search', 1)));
    assert.deepEqual(results.filter(r => r.ok).map(r => r.keyId), [primary, backup]);
    assert.equal(results.filter(r => !r.ok && r.reason === 'budget_exhausted').length, 18);
    assert.equal(await scalar('select sum(used)::int as result from public.karaoke_youtube_key_usage'), 2);
  });

  await t.test('enabling backup imports legacy primary usage without charging the backup', async () => {
    await reset();
    await db.exec("insert into public.karaoke_search_budget values ('2026-11-08',2)");
    assert.deepEqual(await budget(), { used: 2, limit: 4, remaining: 2, warning: false, upstreamExhausted: false });
    assert.equal((await reserve()).keyId, backup);
    const value = await budget();
    assert.equal(value.used, 3);
    assert.equal(value.remaining, 1);
  });

  await t.test('legacy primary outage and logical search lease do not disable backup retry', async () => {
    await reset();
    await db.exec("insert into public.karaoke_search_outages values ('2026-11-08')");
    const begin = (query, client) => scalar('select public.karaoke_search_pool_begin($1,$2) as result', [query, client]);
    const lease = await begin('same song', 'client-a');
    assert.equal(lease.ok, true);
    assert.equal((await begin('same song', 'client-b')).reason, 'query_in_progress');
    assert.equal((await begin('another song', 'client-a')).reason, 'client_cooldown');
    assert.equal((await reserve()).keyId, backup);
    await db.query('select public.karaoke_search_release($1,$2::uuid)', ['same song', lease.token]);
    assert.equal((await begin('same song', 'client-b')).ok, true);
    assert.equal(await scalar('select used as result from public.karaoke_search_budget'), 0,
      'pool attempts must not corrupt the legacy usage imported by the primary');
  });

  await t.test('quota buckets are independent and all-exhausted budget has zero available attempts', async () => {
    await reset();
    await mark(primary, 'search', '2026-11-08');
    assert.equal((await reserve()).keyId, backup);
    assert.equal((await reserve('general')).keyId, primary);
    await mark(backup, 'search', '2026-11-08');
    assert.equal((await reserve()).reason, 'upstream_exhausted');
    const value = await budget();
    assert.equal(value.remaining, 0);
    assert.equal(value.upstreamExhausted, true);
  });

  await t.test('Pacific midnight prefers primary in both standard and daylight-saving time', async () => {
    for (const [before, after, oldDay, newDay] of [
      ['2026-07-01T06:59:59Z', '2026-07-01T07:00:00Z', '2026-06-30', '2026-07-01'],
      ['2026-11-09T07:59:59Z', '2026-11-09T08:00:00Z', '2026-11-08', '2026-11-09'],
    ]) {
      await reset();
      await clock(before);
      const first = await reserve();
      assert.equal(first.day, oldDay);
      await mark(primary, 'search', first.day);
      assert.equal((await reserve()).keyId, backup);
      await clock(after);
      await mark(primary, 'search', first.day); // late response from yesterday
      const next = await reserve();
      assert.equal(next.day, newDay);
      assert.equal(next.keyId, primary);
      assert.equal((await budget()).used, 1);
    }
  });

  await t.test('backup retry exclusions preserve priority and cannot select a tried key', async () => {
    await reset();
    const selected = await reserve('search', 2, [primary]);
    assert.equal(selected.keyId, backup);
    assert.equal(await scalar('select used as result from public.karaoke_youtube_key_usage where key_id=$1', [primary]), 0);
  });

  await t.test('malformed configuration is rejected and browser roles cannot call privileged RPCs', async () => {
    await reset();
    for (const value of [null, '{}', '[]', JSON.stringify([{ id: primary, limit: 0 }]),
      JSON.stringify([{ id: primary, limit: 1.5 }]), JSON.stringify([{ id: 'raw-key', limit: 100 }]),
      JSON.stringify([{ id: primary, limit: 1 }, { id: primary, limit: 1 }])]) {
      await assert.rejects(scalar('select public.karaoke_youtube_get_budget($1::jsonb) as result', [value]), /invalid YouTube/);
    }
    await db.exec('set role anon');
    try {
      await assert.rejects(reserve(), /permission denied/);
      await assert.rejects(db.query('select * from public.karaoke_youtube_key_usage'), /permission denied/);
    } finally { await db.exec('reset role'); }
    await db.exec('set role service_role');
    try { assert.equal((await reserve()).keyId, primary); }
    finally { await db.exec('reset role'); }
    assert.equal(await scalar("select relrowsecurity as result from pg_class where relname='karaoke_youtube_key_usage'"), true);
  });

  await t.test('scheduled cleanup removes key state older than thirty days', async () => {
    await reset();
    await mark(primary, 'search', '2026-10-08');
    await mark(backup, 'search', '2026-10-09');
    await db.query('select public.karaoke_search_cleanup()');
    assert.equal(await scalar('select count(*)::int as result from public.karaoke_youtube_key_usage'), 1);
  });

  await t.test('catalog budget denial atomically preserves search allowance for initial and retry attempts', async () => {
    await reset();
    await db.exec("insert into public.karaoke_catalog_usage values ('2026-11-08',2000)");
    assert.equal((await reserve('search', 2, [], true)).reason, 'catalog_budget_exhausted');
    assert.equal((await budget()).used, 0);
    await db.exec('update public.karaoke_catalog_usage set used=1999');
    const first = await reserve('search', 2, [], true);
    assert.equal(first.keyId, primary);
    await mark(primary, 'search', first.day);
    assert.equal((await reserve('search', 2, [primary], true)).reason, 'catalog_budget_exhausted');
    assert.equal((await budget()).used, 1);
    assert.equal((await reserve()).keyId, backup, 'a user search can still use the uncharged backup allowance');
  });
});
