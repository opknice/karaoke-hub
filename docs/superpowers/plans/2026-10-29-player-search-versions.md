# Player Karaoke / MV search versions

User requirement: top-left Karaoke/MV selector changes search results. Vocal Remover is eligible only for an MV playing item. Switching search back to Karaoke must leave the playing MV and its future AI processing running until that MV ends. Existing pitch and one-percent tempo remain.

## Implementation

1. Add `VideoVersion = 'karaoke' | 'mv'` and optional `version_type` on video metadata; legacy entries default to Karaoke. Reuse existing queue `notes.video` JSON rather than introducing a schema migration. Test persistence through the real Provider mapping.
2. Add mode-aware search: Karaoke preserves the current catalog-first behavior, MV searches embeddable music videos without adding karaoke terms. Separate client/server/in-flight/persistent cache keys. Never save MV results in `karaoke_catalog`, and never use Karaoke seeds as an MV fallback. Validate API mode and cancelled/stale requests. Test real search functions using controlled upstream fixtures.
3. Add browser Player selector and Electron toolbar selector, bridged with restricted messages. Mode changes abort search and clear old results without touching playing audio or queue. Tag results and playing metadata. Test MV/Karaoke isolation and live native bridge.
4. Track playing item ID and version in the desktop controller independently of the selected search version. AI availability remains false until an actual worker passes its latency/quality gate; do not fake processing. Test changing search mode while an MV remains playing and resetting eligibility at track end.

## Constraints and validation

No automatic AI model installation, paid SDK or Supabase schema change. Source separation is still a separately planned feature with a <=5 second end-to-end gate. Auto Level and the removed stereo Vocal Cut stay removed.

Validate with unit/Provider/search tests, full repository suite, Next production build, desktop lint, real Electron fixture and a local Next server configured from the existing project environment. Ship a Windows trial installer targeting the verified compatible website version; do not claim the production search API changed before deployment.

Release ruling: deploy the compatible hosted Player/API before shipping the installer because the native app loads production by default. The user's earlier push/deploy authorization applies. No database migration is required.

Cache ruling: namespace both Karaoke and MV server keys, replacing the old unprefixed Karaoke cache lookup. This prevents a literal Karaoke query starting with `mv:` from reading an MV entry. The one-time cost is a cold search cache; the shared daily budget remains enforced.

AI boundary: switching search leaves capture and playing metadata intact; actual AI continuity is not claimed or tested because no AI worker exists yet.

Search ruling: use the original query for MV and exclude backing-track titles after YouTube returns results. A real UI check showed appending `official music video` suppressed the original artist video and over-selected live/medley uploads. The revised query returned the original GMM official video first for the tested Thai song; search relevance still depends on YouTube.

## Verification record

- Search behavior tests were observed failing before implementation, then passing. Review regressions for cache namespace, video ID case, 250-character limits and No Vocals/Minus One exclusions were each reproduced and fixed.
- Fresh independent source review: no unresolved Critical, Important or actionable Minor findings. AI quality/latency and release environment were explicitly outside source review.
- Repository suite: 74 passed. Desktop suite: 24 passed. Real Electron fixture passed (capture, key, one-percent tempo, selector, removed effects, stop/restart).
- Real local Electron + Next + Supabase test passed: MV search, queue JSON persistence after reload, switch back to Karaoke with unchanged playing MV/capture, eligibility reset at end. No schema changes.
- Browser selector/search passed; native toolbar fits the minimum 960px window. Screenshots inspected. Next production build passed; full source/desktop ESLint has 0 errors and 44 existing warnings.
- Release checks, deployment and packaged app evidence are recorded below when run.
