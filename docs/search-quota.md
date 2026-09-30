# Explicit YouTube search

## Free search fallback and lyric queries

`/search` provides an optional external YouTube search link. The Player overlay does not show this box. The link opens only on user activation, in a new tab with `noopener noreferrer`; no scraping or paid search provider is introduced. Copy a video link back into the existing input, submit, then select the result to queue it. Direct lookup requires a configured YouTube key and available video-details quota, but not Search Queries. Invalid HTTP links are rejected before reserving search quota.

Remote results with karaoke signals are no longer discarded solely because a lyric fragment is absent from title/artist/channel. Exact text matches rank first; unmatched remote candidates retain upstream order instead of allowing views to imply lyrical relevance. Local typing previews remain strict text matches. This is not a lyric database or guaranteed song identification, and karaoke detection remains metadata-based. Existing cached results remain until their normal expiry; no forced refresh consumes extra quota.

Player Tab moves focus to controls; the song/artist sorting toggle is a button. Enter/arrow selection and Escape dismissal remain available.

All search surfaces send `POST /api/search` only after Enter or a search-button click. The default source is `catalog`. Typing in `/search` and Player previews the shared Supabase catalog through read-only `GET /api/catalog` after a 300 ms debounce. Typing never calls YouTube Search. In Player, an explicit Enter/“ค้นในคลัง” submission calls YouTube Search once if and only if the catalog submission returns zero results. `/search` still requires its explicit “ค้นเพิ่มบน YouTube” button for remote search. Direct video links never use Search Queries. Opening a page, changing a tag, or sorting does not contact YouTube Search. GET on `/api/search` remains unsupported. See [catalog operations](supabase-catalog.md).

In Player, editing resets the highlighted search result. Enter searches; after results arrive, arrows select and Enter queues. An explicitly selected local suggestion can also be queued without a remote search. Holding Enter and IME confirmation do not submit repeatedly.

## Persistent storage

Requires Node **24.15+** (the development host uses 24.19). The built-in SQLite module stores search results and the daily request ledger at `.data/youtube-search.sqlite`. This directory is Git-ignored. Configure an absolute `YOUTUBE_SEARCH_DB_PATH` for production on a persistent, writable local disk. All workers for this app must use the same path. Back up the database using SQLite-aware backup tooling.

The SQLite remote-query cache and Search Queries ledger support one host with multiple workers/users, **not** separate servers, ephemeral/serverless deployments, or network filesystems. The song catalog is separate and shared in Supabase, using a server-only secret. Moving the catalog does not move the SQLite search ledger; centralize that ledger before a multi-host deployment.

Successful remote query results live for seven days; empty results for 15 minutes. Details/statistics refresh on demand after one hour through `videos.list`. Remote browser cache lasts at most one hour and is bounded to 100 queries; catalog submit cache lasts 15 seconds and uses separate keys. Expired SQLite search rows are removed on successful cache writes. Supabase metadata is refreshed or removed on its separate retention schedule.

## Budget and concurrency

`YOUTUBE_SEARCH_DAILY_LIMIT` defaults to 100. The ledger uses the calendar day in `America/Los_Angeles`, including daylight-saving changes. An atomic SQLite transaction reserves each new request **before** sending it; unsuccessful attempts also count. Identical requests share an in-flight promise in a worker. Across workers, a 120-second query lease prevents simultaneous duplicate searches; the second worker receives a retry message without consuming another unit. Cached results and video URL lookups bypass Search Queries reservations. New remote searches have a three-second per-client cooldown.

The UI shows requests recorded **by this app**, not the Google Cloud account's actual remaining quota. Previous requests, other apps using the same project, and requests sent before installation are not known to the ledger. Setting a budget does not increase Google's quota. At the limit, the app stops sending new searches but cached queries and direct video URLs remain available. A confirmed upstream daily-quota exhaustion is stored until the next Pacific calendar day. Storage failure prevents new searches rather than bypassing the budget.

The client cookie is a convenience throttle, not strong abuse protection. A public production deployment also needs authenticated or gateway rate limits. The global transactional budget still caps app requests if a client clears its cookies.

YouTube URLs and explicit video IDs such as `id:DmftZuj-8vI` preserve case and use `videos.list`, whose quota is separate. Bare 11-letter song names remain ordinary queries. Cache matching preserves the search text except trimming, whitespace normalization, and case-folding for ordinary queries. Similar-title suggestions do not suppress an explicitly submitted remote search for a different query.

## Verification

`node --test tests/youtube-search.test.cjs` runs with a temporary database and mocked Google responses; it spends no real YouTube quota. TypeScript, ESLint, and `npm run build` validate the application integration.
