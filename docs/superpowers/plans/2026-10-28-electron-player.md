# Electron Player Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation and test-driven-development for behavior changes.

**Goal:** Produce an extension-free Windows Player with independent key/tempo controls and an installer.

**Architecture:** Local Electron shell, separate trusted remote Player WebContentsView, isolated local audio renderer. Reuse hosted Player bridge and DSP modules, restricted IPC and selective capture.

**Tech Stack:** Electron, JavaScript modules, Web Audio AudioWorklet, Node tests, Playwright Electron integration, electron-builder NSIS.

**Spec:** `docs/superpowers/specs/2026-10-28-electron-player-design.md`

## Global constraints

Windows 10/11, first installer x64. Preserve existing website and uncommitted Android/PWA work. No Extension installation, system audio capture, new Supabase schema, bundled credentials, or automatic website deployment. Keep Node disabled, context isolation and sandbox enabled on remote content. Only the configured production origin or an explicitly selected loopback development origin can receive the bridge.

## Review focus

Capture start/stop races and late acknowledgements must not re-enable a stopped graph. Reload/navigation must restore original sound and revoke privileges. The output renderer must never become its own capture source. Invalid IPC values and iframe callers cannot control the host. Actual tempo and pitch must not be corrected twice.

### Task 1: Controller and trust boundaries

Files: `desktop/lib/policy.cjs`, `desktop/lib/controller.cjs`, `desktop/tests/controller.test.cjs`.
Interfaces: `DesktopAudioController({sendAudio, sendShortcut, publish})`; async `command(type,payload)`, `audioEvent(payload)`, `disconnect()`; `state` reflects acknowledged engine state. `isPlayerUrl(url, configuredUrl)`, `validateCommand(type,payload)` reject untrusted hosts and invalid values.

- [x] Write tests for disallowed origins/credentials, nonfinite/out-of-range pitch/rate, failed/late start, track reset and timeout; run with `node --test desktop/tests/*.test.cjs` (Expected: FAIL for missing controller).
- [x] Implement validation, serialized command lifecycle, request timeouts and state acknowledgements; run tests (Expected: PASS).

### Task 2: Local audio engine and DSP

Files: `desktop/audio/*`, `desktop/scripts/prepare-assets.cjs`, `desktop/tests/audio.test.mjs`.
Interfaces: duration-neutral semitone processor and capture engine `start()`, `stop()`, `apply(command)`; engine reports state/diagnostics to main. Package existing DSP modules from `browser-extension` as generated assets.

- [x] Write real sine-tone tests at +/-6 and +3 semitones, unity bypass, finite stereo output and reset; run tests (Expected: FAIL before processor exists).
- [x] Implement audio engine with selective media capture, track cleanup, Vocal Cut, Auto Level and limiter. Run unit/signal tests (Expected: PASS).

### Task 3: Electron shell and installer

Files: `desktop/main.cjs`, `desktop/*preload.cjs`, `desktop/ui/*`, `desktop/package.json`, `desktop/tests/electron-smoke.cjs`.
Interfaces: toolbar sends a fixed command union; Player preload relays existing bridge messages and fixed keyboard actions only; audio preload receives fixed audio commands. Main validates sender frame and URL on every IPC and grants media only to audio renderer from the Player webContents.

- [x] Add integration fixture tests for cross-window media capture, key/tempo, stop/retry, navigation and actual hosted boot; run to observe failure before wiring.
- [x] Implement shell, lifecycle/error handling, bridge adapter, native menu/fullscreen, toolbar and packaging. Run full repo tests, desktop tests and Electron integration (Expected: PASS).
- [x] Build unpacked executable and NSIS installer, smoke-test packaged app; document setup, artifacts and actual OS test limits.

## Execution ledger

Implementation choices: first app x64; reuse current measured DSP first; hosted production Player plus local toolbar avoids requiring a web deploy or distributing backend credentials. User's instruction to develop Electron is authorization to execute the discussed design inline.

- Task 1: complete. Controller tests observed RED for missing modules and two lifecycle races, then GREEN (9/9 controller tests). Queued starts and late DSP acknowledgements cannot override Stop.
- Task 2: complete. Actual PCM tests observed missing processor RED, then GREEN at -6, 0, +3, +6 semitones. Shared extension DSP source is unchanged; generated copies are ignored.
- Task 3: implemented. `npm test` 70/70, `npm --prefix desktop test` 14/14, lint 0 errors / 45 pre-existing warnings, desktop npm audit 0 vulnerabilities. Electron integration passed on development and packaged executables. Real hosted song search/selection, non-silent YouTube capture, key change, speed increase and reset passed. Initial automation failures were wrong window selection and wrong result role, corrected in the test harness.
- Actual test host: Microsoft Windows 11 Home Single Language, build 26300. Windows 10 remains an unperformed compatibility/listening check.
- Installer: NSIS x64 generated. Publisher signing is not configured; framework icon retained. No website deploy, push, backend migration or changes to the original Android/PWA checkout.

## Final review and delivery

- Fresh read-only reviewer found one Important stale capture-completion issue and a preset mismatch graded Minor. The preset mismatch was regraded Important because the displayed setting must match the audible effect. Both were fixed in one pass.
- Final: fixed stale capture end — `an old track-ended close cannot report idle after a new capture starts` RED→GREEN. Each graph now captures its own main-process generation and suppresses superseded stop completions.
- Final: fixed preset restoration — `restarting audio reapplies the selected preset before advertising readiness` RED→GREEN. Startup also restores the tracked Player volume before enabling controls.
- Final suite: root 70/70 and desktop 16/16. Desktop lint 0 warnings/errors. Real Electron capture and hosted YouTube playback passed on the rebuilt packaged executable. Packaging source check compared 20 bundled source/assets against current files: no mismatches; no environment/credentials/test files bundled. NSIS x64 build passed.
- Hosted harness now waits for the room-ready QR code before enqueueing; the React/audio handshake alone is not room membership readiness. This resolved the intermittent `กรุณาเข้าห้อง Karaoke ก่อนเพิ่มเพลง` test failure. Its separate persistent test profile avoids creating a new anonymous account on every run.
- Review considered IPC/self-capture boundaries and found no concrete defect; existing sender/main-frame/origin enforcement and selective source remain. PCM tests and actual 1.25x fixture playback support applying musical transposition without inverse-tempo correction. Cleanup/reload remain covered by stop/restart tests; physical speaker routing was not independently measured.
- Review limits retained: actual Windows 10, full-mix listening, Bluetooth/HDMI changes, sleep/resume, long sessions, and installer installation/uninstallation UX still require manual acceptance. The existing hosted Player can report an optimistic supported rate before a YouTube rate event; no reproducible new desktop failure was established, and the website was kept outside this change.
- Deferred review minors: none; preset mismatch was fixed. Distribution polish: default framework icon and unsigned installer are explicitly documented for this trial build.
- Delivery kept on `codex/electron-player` in the managed worktree; no merge, push or website deployment requested for this phase. The installer is copied to `D:/karaoke/build/desktop/0.1.0/` so it survives separate worktree lifecycle changes.
