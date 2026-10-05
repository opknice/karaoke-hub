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
- `YOUTUBE_SEARCH_DAILY_LIMIT` (defaults to `100`)
- `CRON_SECRET` (a random value of at least 16 characters)

`vercel.json` runs the protected catalog maintenance endpoint once per day,
which is compatible with Vercel Hobby. Add the production and preview callback
URLs to Supabase Auth Redirect URLs before testing OAuth.

Use `npm run catalog:sync` locally for the initial full catalog import. The
daily Vercel job only scans recent official uploads and refreshes bounded
batches so it can finish within a serverless invocation.

## Verification

```powershell
npm run test
npm run lint
npm run build
```
