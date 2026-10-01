# Supabase song catalog

## Search flow

- Player and `/search` typing: 300 ms debounce → `GET /api/catalog` → Supabase only. Thai combining vowels and tone marks are preserved.
- Player Enter / “ค้นในคลัง”: Supabase search first. If the confirmed catalog result is empty, search YouTube once automatically using the existing remote cache and budget. A typing preview miss or Supabase error does not trigger this fallback. Direct video links use details lookup instead. If returned catalog views are over one hour old, refresh those IDs through `videos.list`; on refresh failure show catalog results without stale view counts and with a warning.
- “ค้นเพิ่มบน YouTube”: direct remote search with the existing SQLite cache, budget and request deduplication; successful video metadata is also saved to Supabase. On `/search`, remote search still requires this explicit button.
- Direct video URLs/IDs use video details, not Search Queries. Selecting a result queues it as before.

The catalog contains imported official-channel uploads and videos discovered through explicit search. It is not all of YouTube, a lyrics database, or proof that every video is karaoke. Existing metadata-based relevance/karaoke rules and verified channel-ID ranking still apply. Candidate retrieval is bounded to 100 matches and returns at most 25 ranked results (Player displays seven).

## Configuration and operations

Use `NEXT_PUBLIC_SUPABASE_URL`, private `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) and private `YOUTUBE_API_KEY`. Never prefix privileged keys with `NEXT_PUBLIC_`. Rotate any key that was actually exposed; renaming cannot revoke an old leaked key.

Migration: `supabase/migrations/20260929090805_karaoke_catalog.sql`.

Manual operator command:

```powershell
npm run catalog:sync
```

It reads the channel-ID registry, resolves uploads playlists, batches details at 50 IDs/request, applies any channel-specific title filter, and saves the next-page cursor. RSMUSIC-X imports only videos whose normalized title ends in `Official karaoke`; its MV and other uploads are skipped. Each invocation imports at most 100 pages per channel; invoke again to resume. Completed channels are scanned again after seven days. A run also refreshes up to 500 catalog entries older than seven days. No media files are downloaded.

On Vercel, `vercel.json` invokes `/api/internal/catalog-sync` once per day and
Vercel authenticates it with `CRON_SECRET`. The bounded job scans the newest
playlist page for every official channel and refreshes up to 16 batches of old
metadata. The initial full import still uses `npm run catalog:sync` locally.
Self-hosted Node servers can retain the legacy timer; instrumentation disables
that timer automatically when `VERCEL=1`. Database leases guard each channel
import and failed cleanup leases expire after five minutes.

Catalog-related `channels.list`, `playlistItems.list`, and `videos.list` calls share an atomic Supabase limit of 2,000 requests per Pacific calendar day. These do not use the separate Search Queries bucket, but do consume YouTube's general API quota. The application limit intentionally remains below YouTube's default 10,000-unit general-endpoint allocation so direct video details and other reads retain headroom. This limit is separate from the existing remote-search budget and is not Google's total account usage. No paid upgrade or service was enabled.

## Retention and access

Metadata expires 29 days after its actual YouTube refresh timestamp. Reads exclude expired rows. Supabase Cron deletes expired catalog rows daily at 02:17 UTC, so unrefreshed metadata does not persist indefinitely. A successful refresh also removes confirmed missing/non-embeddable videos. Queue, history and user playlists are not deleted by this cleanup.

The four catalog tables have RLS enabled, no browser policies, and explicit grants only for `service_role`. RPC execution is also server-only. The app exposes bounded search results, never credentials. The Supabase advisor's [RLS enabled with no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) informational finding is intentional default-deny here; do not resolve it with public write policies. Public app endpoints still need authenticated/gateway rate limiting before public deployment; private DB tables alone are not app-level abuse protection.

## Verified 2026-09-29

- Initial GMM Karaoke scan completed: 8,888 playable video records; 357 catalog API requests, no Search Queries for the import.
- Catalog includes `DmftZuj-8vI` (ขอบฟ้า — bodyslam) and `anltxqgP19I` (อะไรก็ยอม — LOSO).
- Anonymous direct table access and quota-reservation RPC calls denied.
- Unit tests cover preview without YouTube requests, explicit details refresh, stale-view hiding, separate catalog/remote caches, Thai normalization and no automatic remote fallback.
- Test command: `node --test tests/youtube-search.test.cjs`.
