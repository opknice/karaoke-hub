# YouTube API key failover

Status: approved for implementation when the user supplied the backup key and
asked to proceed. The credential itself is kept out of this document.

## Intent and confirmed requirements

Keep YouTube features available when the primary project's daily quota runs out.
The user confirmed two YouTube Data API v3 keys belonging to different Google
Cloud projects, automatic fallback, and automatic return to the primary after
its daily quota resets. The user will supply the backup key later.

## Current behavior

`youtube.ts` and `youtube-catalog.ts` independently use `YOUTUBE_API_KEY`.
Search budget and upstream exhaustion are currently global per Pacific day in
Supabase. Marking the primary exhausted therefore currently blocks every new
remote search. Cached searches and direct video lookups have separate paths.
The deployed architecture supports multiple Vercel workers.

## Approaches and recommendation

- Remember the active key in one worker: smaller change, but restarts and
  independent Vercel workers lose or disagree about exhaustion state.
- Persist per-key state in the existing Supabase database: requires a migration,
  but preserves consistent fallback across workers and restarts. Recommended
  implementation choice accepted when the user asked to proceed with the
  proposed design and supplied the backup credential.

## Proposed bounded change

- Preserve `YOUTUBE_API_KEY` as primary; add optional, server-only
  `YOUTUBE_API_KEY_BACKUP`. A missing backup keeps single-key operation.
  Never include keys in client responses, logs, or database rows; identify keys
  in stored state using nonreversible fingerprints and server-side roles.
- Centralize request selection for search, video details, channel lookup, and
  playlist/catalog requests. Try the primary first for the relevant quota
  bucket, then retry the same request once with the backup upon a confirmed
  daily-quota error. Do not rotate on invalid credentials, rate limits,
  permission failures, network errors, or unrelated HTTP 403 responses.
- Persist exhaustion per key, quota bucket, and calendar date in
  `America/Los_Angeles`. Search exhaustion must not disable video-details
  requests that use another quota bucket. Stop retrying exhausted keys for the
  rest of that quota day.
- On the first actual API request in a new Pacific day, prefer the primary
  again automatically. No timer, synthetic API probe, or redeployment is needed.
  Respect daylight-saving changes rather than waiting a fixed 24 hours.
- Proposal: apply `YOUTUBE_SEARCH_DAILY_LIMIT` to the primary key and add
  `YOUTUBE_SEARCH_BACKUP_DAILY_LIMIT` for the backup, each defaulting to 100.
  An exhausted per-key app budget also advances to the next eligible key.
  Reserve each outbound search attempt atomically, including a backup retry.
  Keep duplicate-query leases and the three-second client cooldown across
  the entire logical search, so its retry is not blocked by its own lease.
- Keep the existing response budget shape, aggregating configured key budgets;
  document that counts reflect this app, not Google's actual remaining quota.
  If both keys are exhausted, return a clear quota message; cached catalog
  results continue to work. Direct lookups depend on video-details quota.
- Preserve shared cache, ranking, catalog maintenance limits, and existing UI.
  Add an additive migration, configuration examples, setup instructions, and
  tests. Preserve unrelated uncommitted work already present in the repository.

## Validation and acceptance

Mock upstream and database requests: primary success; daily-quota fallback;
same-request backup retry; persisted exclusion across workers/restarts; both
keys exhausted; return to primary at Pacific midnight in standard and daylight
time; separate quota buckets; nonquota failures; one-key operation; app-budget
fallback; concurrent reservation and lease handling. Tests spend no real
YouTube quota. Run the existing relevant tests, TypeScript, lint, and production
build. Database behavior requires migration validation before reporting it as
verified. Deployment and entering real backup credentials remain separate from
writing and checking the code.

## References

- https://developers.google.com/youtube/data/determine_quota_cost
- https://docs.cloud.google.com/docs/authentication/api-keys
- Repository guides under `node_modules/next/dist/docs/`.
