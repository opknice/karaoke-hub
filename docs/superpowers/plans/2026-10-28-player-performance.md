# Player performance and recovery implementation plan

> Execute inline using test-driven-development and executing-plans. The user explicitly requested immediate inspection and optimization instead of further design questions.

**Goal:** Keep `/player` responsive during searches and recover safely from temporary playback and room synchronization failures.

**Architecture:** Preserve the database as the queue authority. Separate the playback clock from room state, bound shared search requests, and recover failed YouTube initialization. Send search results before optional persistence using Next.js `after`.

**Tech stack:** Next.js 16.4.3 (security update from 16.3.6), React 19, TypeScript, Supabase, Node test runner. No new runtime dependencies or database migrations.

**Spec:** The six findings in this chat and the user's instruction to inspect and optimize immediately.

## Constraints and decisions

- Preserve all pre-existing modifications, including Android/PWA work.
- Work in the existing checkout on `codex/player-performance`; do not create a separate checkout that omits the user's uncommitted application changes. No automatic commits, pushes, or deployment.
- Follow the installed Next.js documentation before changing route behavior.
- Preserve official-channel ranking, quota reservation, server-authoritative queue transitions, and local-catalog validation.
- Baseline: `npm test` passed 52/52 before changes.

## Review focus

- Cancelling one shared search must not cancel a second caller; cancelling all callers must release the request.
- A delayed response for an earlier room or refresh must never overwrite newer room state.
- Retrying a song transition must retain the original expected queue item, including after a lost response.
- YouTube loading errors and timeouts must clean up callbacks and allow retry.
- Playback ticks must not notify the room/search state consumers.

## Task 1: Search responsiveness and cancellation

Files: `src/lib/youtube-search-client.ts`, `src/components/PlayerSearchOverlay.tsx`, `tests/player-resilience.test.cjs`.

- [x] Add failing tests exercising cancellation of one/all shared callers and search timeout.
- [x] Give each shared request its own abort controller and subscriber lifecycle, with a 45-second request deadline.
- [x] Keep input, Escape, and playback shortcuts usable during search; prevent only duplicate submission.
- [x] Remove the artificial 900-ms result-display delay.
- [x] Run focused tests and the project suite.

## Task 2: Recover YouTube initialization

Files: `src/lib/youtube-iframe-api.ts`, `src/components/YouTubePlayer.tsx`, `tests/player-resilience.test.cjs`.

- [x] Add failing tests for script failure followed by retry, readiness timeout, shared loading, and readiness callback cleanup.
- [x] Reset failed loading state, remove failed scripts, and use a bounded 15-second readiness timeout.
- [x] Expose an explicit Player retry action for initialization failures; do not skip valid songs for loader errors.
- [x] Run focused tests and the project suite.

## Task 3: Isolate playback clock updates

Files: `src/lib/playback-clock.ts`, `src/context/KaraokeContext.tsx`, clock consumers in Player/Queue/Join, `tests/player-resilience.test.cjs`.

- [x] Add failing tests for clock updates, snapshot identity, duplicate values, and subscriber cleanup.
- [x] Store the clock outside React room state and expose `usePlaybackClock` using `useSyncExternalStore`.
- [x] Move only the consumers that display time to that hook.
- [x] Run focused tests, type checking, and the project suite.

## Task 4: Queue recovery and synchronization

Files: `src/lib/queue-recovery.ts`, `src/context/KaraokeContext.tsx`, `src/components/YouTubePlayer.tsx`, `src/app/player/page.tsx`, `tests/player-resilience.test.cjs`.

- [x] Add failing tests for transient transition failure, permanent failure, stale results, overlapping refreshes, and exhausted retries.
- [x] Bound retry of transient transition failures while retaining the expected item; surface errors and allow manual retry.
- [x] Reject superseded refresh responses, reuse unchanged snapshots, and refresh on subscription recovery, online/focus, and a visible-page fallback timer.
- [x] Surface synchronization failures on Player without hiding the playing video.
- [x] Run focused tests and the project suite.

## Task 5: Remove optional persistence from search response latency

Files: `src/app/api/search/route.ts`, `tests/player-resilience.test.cjs`.

- [x] Add a failing route test in which history/catalog persistence remains unresolved but valid results must be returned.
- [x] Schedule history and catalog writes with documented Next.js `after`; preserve quota/cache authority and log background write failures.
- [x] Avoid reading quota for the catalog-only path; preserve quota reporting for explicit YouTube search.
- [x] Run focused tests, the full suite, ESLint, TypeScript, and a production build.

## Completion

- [x] Review the complete change using a fresh reviewer as required by requesting-code-review.
- [x] Exercise the local `/player` in a browser where available, documenting environment limitations.
- [x] Report verified improvements and remaining limits; do not claim unmeasured production speedups.

## Progress

- Planning: installed Next.js `after` documentation reviewed. User authorization covers immediate inline implementation; no additional approval gate is required.

- Review: two Important findings reproduced by three failing real React Provider tests, then fixed. The final suite passes 70/70.
- Ruling: add the exact-version React test renderer as a development-only dependency to test real Context consumers; no application runtime dependency was added.
- Ruling: upgrade Next.js and eslint-config-next to 16.4.3 after npm audit confirmed published Critical advisories; update compatible source-map-js and zod resolutions. Runtime audit is clean; remaining full-audit findings are three Moderate development-only Capacitor/iOS dependency advisories.
- Ruling: actual server logs showed automatic full-history channel scans. Keep the existing auto-sync opt-in but use bounded daily updates, and make an unset flag default to off; full imports remain the explicit catalog:sync command.
- Browser: verified input remains enabled while YouTube is busy, Escape cancels, typing replaces a search, video playback starts, End advances to the second video, and End with an empty queue restores idle. No browser errors/warnings were observed. Reloaded and smoke-tested after the Next.js update.
- Final checks: 70 tests pass; production build/type checking pass; ESLint zero errors (45 pre-existing warnings); npm audit --omit=dev reports zero vulnerabilities.
- Integration: leave reviewable changes uncommitted on codex/player-performance; no push or deployment. Local preview runs on loopback only with automatic catalog work disabled for the preview process.
