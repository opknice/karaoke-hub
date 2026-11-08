# Karaoke Hub

Next.js karaoke room application using Supabase for Auth, Realtime, room state,
the song catalog, persistent YouTube search quota/cache state, and search history.

## Local development

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Apply every file in `supabase/migrations/` to the Supabase project before using
the matching application revision. This includes the permanent search-history
migration `20261005090000_persistent_search_history.sql`.

## Vercel Hobby deployment

Import the GitHub repository into Vercel as a Next.js project and configure:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`
- `YOUTUBE_API_KEY`
- `YOUTUBE_API_KEY_BACKUP` (optional, server only; a different Google Cloud project)
- `YOUTUBE_SEARCH_DAILY_LIMIT` (defaults to `100`)
- `YOUTUBE_SEARCH_BACKUP_DAILY_LIMIT` (defaults to `100` when backup is configured)
- `CRON_SECRET` (a random value of at least 16 characters)

`vercel.json` runs the protected catalog maintenance endpoint once per day,
which is compatible with Vercel Hobby. Add the production and preview callback
URLs to Supabase Auth Redirect URLs before testing OAuth.

To enable automatic YouTube key failover, apply migration
`20261108042641_youtube_key_failover.sql`, then set `YOUTUBE_API_KEY_BACKUP`
in `.env.local` and in your deployment's server environment. Restart the local
server or redeploy after changing environment variables. The primary is tried
first; a confirmed daily quota error retries the same request using the backup.
The first real API request after midnight in `America/Los_Angeles` prefers the
primary again automatically, including daylight-saving changes. No Cron probe
is needed. Missing or duplicate backup keys preserve single-key behavior.

Each distinct key has its own search-attempt budget (100 by default). A retry
also consumes an attempt on its selected key. Supabase stores only fingerprints,
counts, and per-day exhaustion state, so all server instances share the decision.
Search quota and general endpoint quota are tracked separately. Temporary rate
limits, invalid keys, and network errors do not trigger key rotation. Keep both
keys server-only; never use a `NEXT_PUBLIC_` prefix. See [search quota details](docs/search-quota.md).

Use `npm run catalog:sync` locally for the initial full catalog import. The
daily Vercel job only scans recent official uploads and refreshes bounded
batches so it can finish within a serverless invocation.

## Verification

```powershell
npm run test
npm run lint
npm run build
```
