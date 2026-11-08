# YouTube key failover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Automatically use the backup YouTube project when primary quota is exhausted, and prefer the primary after Pacific midnight.

**Architecture:** Add a shared server-only request helper with fingerprinted per-key quota state in Supabase. Preserve existing single-key RPC behavior; use additive pool RPCs when two distinct keys are configured. Pool search leases apply to the logical query, while each outbound attempt has its own atomic budget reservation.

**Tech Stack:** Next.js 16.4.3, TypeScript, PostgreSQL/Supabase REST RPC, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-08-youtube-key-failover-design.md`

## Global Constraints

- Keep keys server-only; never include them in database rows, browser payloads, logs, or tracked files.
- Preserve unrelated existing uncommitted work in this checkout.
- Primary and backup default to 100 search attempts each per Pacific day.
- Cached lookups share results across projects. Search and general quota buckets stay separate.
- Keep existing catalog maintenance limits and the three-second logical-search cooldown.

## Review Focus

- A failure arriving after midnight must mark its reservation day, not the new day.
- An old global outage must block only primary search when entering pool mode.
- Duplicate configured keys must retain single-key behavior.
- Rate limits, invalid keys and network failures must not rotate or leak request URLs.
- Concurrent callers must never reserve beyond a key's app budget.

### Task 1: Shared request selection and persistent quota state

**Files:** Create `src/lib/youtube-api-keys.ts`, `src/lib/youtube-api-request.ts`, `tests/youtube-key-failover.test.cjs`, and an additive CLI-generated Supabase migration.

**Interfaces:** `getYouTubeApiKeys()` returns server-only `{ id, key, searchLimit }[]` in priority order. `requestYouTubeApi(url: URL): Promise<Response>` preserves caller params, selects key, and throws `YouTubeQuotaError` on all-key exhaustion. RPCs: `karaoke_youtube_reserve`, `karaoke_youtube_mark_exhausted`, `karaoke_youtube_get_budget`, `karaoke_search_pool_begin`.

- [x] Write request tests for primary success, quota retry, persisted state, quota buckets, reset, late responses, nonquota errors, app limits and duplicate keys.
- [x] Run `node --test tests/youtube-key-failover.test.cjs`; observe missing implementation failure.
- [x] Implement key configuration, quota classification and request helper; use fingerprints only in RPC bodies, no real keys in test fixtures.
- [x] Generate migration with `supabase migration new youtube_key_failover`; implement service-role-only invoker RPCs and atomic per-key state, preserving legacy today's counts.
- [x] Verify tests and execute migration/RPC integration tests in a local disposable PostgreSQL-compatible database.

### Task 2: Integrate search and catalog

**Files:** Modify `src/lib/youtube.ts`, `src/lib/youtube-catalog.ts`, `src/lib/youtube-search-store.ts`; extend behavioral tests.

**Interfaces:** Consume `requestYouTubeApi`, `getYouTubeApiKeys`, `YouTubeQuotaError`. Keep existing search API response budget shape. `reserveSearch` chooses lease-only pool RPC only when two distinct keys are configured; `getSearchBudget` aggregates pool attempt counts.

- [x] Add integration tests proving search backup succeeds without another logical lease/cooldown, video/catalog request failover, and cached requests consume no attempt.
- [x] Run those tests to observe the old integration fail.
- [x] Route all YouTube fetches through the helper, map quota errors to existing search errors, aggregate pool budgets, and preserve single-key behavior.
- [x] Run `node --test tests/youtube-search.test.cjs tests/youtube-key-failover.test.cjs tests/player-resilience.test.cjs`.

### Task 3: Configure and verify

**Files:** Modify `.env.example`, `README.md`, `docs/search-quota.md`; edit ignored `.env.local` with the supplied backup key.

- [x] Add backup configuration docs and key; verify `.env.local` stays ignored and tracked changes contain no real key.
- [x] Run `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- [x] Review the complete change and perform a fresh independent code review, fixing material findings with regression tests.
- [x] Apply the additive migration to the configured Supabase project if accessible; otherwise give the exact migration and report that activation is pending that step.

## Execution record

- User approved execution by supplying the backup key and asking to proceed.
- Work in the existing feature checkout: target files already contain user changes required by this feature. No stashing, resets, worktree copying, or commits of mixed user changes.
- Supabase connector currently lists another project; verify access to the `.env.local` project before attempting any remote DDL.

## Verified outcome

- Baseline: 70 tests passed before changes.
- Final suite: 93 tests passed, including 13 request/integration tests and 10 PostgreSQL migration/RPC tests.
- TypeScript and configured production build passed. Full ESLint: zero errors, 45 pre-existing warnings; changed implementation/test files have zero warnings.
- Independent reviewer reproduced two P2 issues. Both were fixed with failing-then-passing regressions: optional cached metadata enrichment remains available when general quota is exhausted, and catalog/search budgets are coordinated atomically so denied maintenance attempts do not consume search allowance.
- Supplied backup key saved in ignored `.env.local`; fingerprint-only database configuration and a source/static-asset secret scan verified.
- The user chose to run the SQL manually after connector access to the actual Supabase project was unavailable. Deliver the migration and `docs/youtube-key-failover-setup.md`; remote installation and activation are pending that user step.
- Existing feature checkout and unrelated user changes are preserved. No commit, push, deployment, or unrelated Supabase project mutation was performed.
## Deployment integration (2026-11-08)

- User confirmed SQL installation and authorized push, production deployment, and live verification.
- Configured Supabase quota RPC returned HTTP 200 with two-key budget (limit 200).
- Prepared an isolated deployment worktree from latest `origin/main` (`20ec896`) and preserved its MV/versioned-cache behavior; excluded unrelated Android/PWA and 50-result changes from the original checkout.
- Added MV backup search and strict direct-video quota regression coverage. Integrated suite: 127 tests passed; production build passed.
- Production Vercel environment now contains the server-only backup secret and backup daily limit. Live checks follow the production deployment.
