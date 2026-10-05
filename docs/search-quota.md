# Explicit YouTube search

## Free search fallback and lyric queries

`/search` provides an optional external YouTube search link. The Player overlay does not show this box. The link opens only on user activation, in a new tab with `noopener noreferrer`; no scraping or paid search provider is introduced. Copy a video link back into the existing input, submit, then select the result to queue it. Direct lookup requires a configured YouTube key and available video-details quota, but not Search Queries. Invalid HTTP links are rejected before reserving search quota.

Remote results with karaoke signals are no longer discarded solely because a lyric fragment is absent from title/artist/channel. Exact text matches rank first; unmatched remote candidates retain upstream order instead of allowing views to imply lyrical relevance. Local typing previews remain strict text matches. This is not a lyric database or guaranteed song identification, and karaoke detection remains metadata-based. Existing cached results remain until their normal expiry; no forced refresh consumes extra quota.

Player Tab moves focus to controls; the song/artist sorting toggle is a button. Enter/arrow selection and Escape dismissal remain available.

All search surfaces send `POST /api/search` only after Enter or a search-button click. The default source is `catalog`. Typing in `/search` and Player previews the shared Supabase catalog through read-only `GET /api/catalog` after a 300 ms debounce. Typing never calls YouTube Search. In Player, an explicit Enter/“ค้นในคลัง” submission calls YouTube Search once if and only if the catalog submission returns zero results. `/search` still requires its explicit “ค้นเพิ่มบน YouTube” button for remote search. Direct video links never use Search Queries. Opening a page, changing a tag, or sorting does not contact YouTube Search. GET on `/api/search` remains unsupported. See [catalog operations](supabase-catalog.md).

In Player, editing resets the highlighted search result. Enter searches; after results arrive, arrows select and Enter queues. An explicitly selected local suggestion can also be queued without a remote search. Holding Enter and IME confirmation do not submit repeatedly.

## Permanent search history

The expiring `karaoke_search_cache` remains an optimization. Every explicit
YouTube search is additionally appended to `karaoke_search_history`, including
queries served from the cache and searches with zero results. Each row keeps the
submitted query, whether it was a YouTube search or direct video lookup, the
result payload, result count, and timestamp. This history is global to the
application rather than tied to a signed-in user.

Apply `supabase/migrations/20261005090000_persistent_search_history.sql` before
deploying the application code. The migration also copies existing cache rows
into the permanent history table once.

## Persistent storage

Search results, the daily request ledger, leases, client cooldowns and upstream
outages are stored in Supabase Postgres. Apply
`supabase/migrations/20260930145503_vercel_search_state_and_catalog_cron.sql`
before deploying this application revision. The tables use RLS with no browser
policies and their RPC functions are executable only by `service_role`.

This shared state supports Vercel cold starts and concurrent Function instances;
the application no longer requires a writable local filesystem or
`YOUTUBE_SEARCH_DB_PATH`.

Successful remote query results live in the disposable cache for seven days;
empty results for 15 minutes. Permanent history is not expired automatically.
Details/statistics refresh on demand after one hour through `videos.list`. Remote
browser cache lasts at most one hour and is bounded to 100 queries; catalog
submit cache lasts 15 seconds and uses separate keys. Supabase metadata is
refreshed or removed on its separate retention schedule.

## Budget and concurrency

`YOUTUBE_SEARCH_DAILY_LIMIT` defaults to 100. The ledger uses the calendar day in `America/Los_Angeles`, including daylight-saving changes. An atomic Postgres RPC locks the daily budget row and reserves each new request **before** sending it; unsuccessful attempts also count. Identical requests share an in-flight promise in a worker. Across Vercel instances, a 120-second query lease prevents simultaneous duplicate searches; the second instance receives a retry message without consuming another unit. Cached results and video URL lookups bypass Search Queries reservations. New remote searches have a three-second per-client cooldown.

The UI shows requests recorded **by this app**, not the Google Cloud account's actual remaining quota. Previous requests, other apps using the same project, and requests sent before installation are not known to the ledger. Setting a budget does not increase Google's quota. At the limit, the app stops sending new searches but cached queries and direct video URLs remain available. A confirmed upstream daily-quota exhaustion is stored until the next Pacific calendar day. Storage failure prevents new searches rather than bypassing the budget.

The client cookie is a convenience throttle, not strong abuse protection. A public production deployment also needs authenticated or gateway rate limits. The global transactional budget still caps app requests if a client clears its cookies.

YouTube URLs and explicit video IDs such as `id:DmftZuj-8vI` preserve case and use `videos.list`, whose quota is separate. Bare 11-letter song names remain ordinary queries. Cache matching preserves the search text except trimming, whitespace normalization, and case-folding for ordinary queries. Similar-title suggestions do not suppress an explicitly submitted remote search for a different query.

## Verification

`node --test tests/youtube-search.test.cjs` runs with mocked Supabase and Google responses; it spends no real YouTube quota. TypeScript, ESLint, and `npm run build` validate the application integration.
