# Vocal Level Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add native MV singer level 0–100% without changing instrumental gain or the retained playback timeline.
**Architecture:** Reuse aligned estimated vocals, scaling subtraction by `1-level/100`. Controller retains session-only preference; coordinator applies it to the current worklet and each AI/session restart. A bounded native UI sender coalesces adjustments and returns search focus only when interaction completes.
**Tech Stack:** Existing Electron, JavaScript ES modules/CommonJS, AudioWorklet, Node tests, Playwright and existing local MDX/DirectML runtime.
**Spec:** docs/superpowers/specs/2026-10-31-vocal-level-design.md (user approved: พัฒนาได้).

## Global Constraints

- Integer 0–100; default0 per app launch, retained through removal on/off, track and model changes; removal off bypasses to original without erasing selection.
- Same sample/timeline, approximately20ms smoothing, unchanged eight-second startup buffer, both exact models/recipes, local MV-only eligibility.
- Original continues during AI loading/failure; pause retains selection; no model/capture restart, seek or buffer clear for level changes.
- Preserve pitch/one-percent Tempo, keyboard/Thai focus, modal/lyrics exceptions, natural tail and explicit skip silence.
- New installer0.1.8, preserve0.1.7; no new dependencies, no silent install. Existing native inline execution and push/deploy authorization retained.

## Review Focus

- 100% and rapid endpoint changes must reach a ready state and return to partial removal, without false timeout or stuck preparation (Task1).
- Model/seek/Stop racing a level adjustment must not revive old AI or overwrite the new selected level (Task2).
- Slider drag or held keyboard input must not lose focus mid-adjustment; completion returns Thai search focus, preserving modal/lyrics editing (Task2/3).
- Slow/error IPC and rapid dragging must retain at most one in-flight and one latest pending value and never apply an old reply over a newer UI intent (Task2).
- Minimum960px window, both models, paused updates and skip/end-tail must remain usable and bounded (Task3/4).

### Task 1: Continuous vocal percentage DSP

**Files:** desktop/audio/continuous-vocal-buffer.mjs, vocal-processor.js, engine.mjs; desktop/tests/vocal-level.test.mjs, continuous-processor.test.mjs, audio-lifecycle.test.mjs.
**Interfaces:** `ContinuousVocalBuffer.setLevel(level:number)` validates integer0–100 and retains selection across begin/AI reset; worklet `SET_LEVEL {level}`; audio engine `SET_VOCAL_LEVEL {level}` validates and forwards. Existing boolean removal remains the active intent. Target subtraction when enabled/available is `1-level/100`; otherwise0. Readiness compares against that target, including100%.
- [x] Write tagged separate-instrumental/vocal tests for0/25/50/75/100, stereo/frame identity, twenty-millisecond transitions, endpoints/invalids, off/on, pause and AI restart/failure.
- [x] Run new focused test and observe RED; implement the minimal DSP/worklet/engine path without new allocations per sample.
- [x] Run full desktop suite and focused lint; commit DSP. Expected: GREEN, no session/capture reset or frame discontinuity.

### Task 2: Native preference, bounded UI and focus

**Files:** desktop/lib/controller.cjs, policy.cjs, continuous-vocal-coordinator.cjs, main.cjs; desktop/ui/index.html,shell.js,style.css; create desktop/ui/vocal-level.mjs; desktop/tests/vocal-level-control.test.mjs and native controller/coordinator tests.
**Interfaces:** controller state `vocalLevel:number=0`, native-only `SET_VOCAL_LEVEL {level}` and injected `setVocalLevel(level)`; coordinator `getLevel():number`, `setLevel(level)` sends only to active session, restores level on preparation/AI begin. Strict local-shell-only `FOCUS_PLAYER_SEARCH {}` in main; streaming level command defers automatic focus. UI module exports `createVocalLevelControl({root,send,focus,onError})` with update(state), bounds/one-percent buttons/slider, one in-flight + latest pending slot. Shell imports module via type=module; level adjustments don't block Stop.
- [x] Add failing tests for validation, default/retention, paused/model/track restart level, no reset on setter and cancelled/stale updates.
- [x] Add failing control tests for coalescing, stale/error replies, final focus, pointer and keyboard completion, boundary buttons and disabled state.
- [x] Implement native setter/restore and compact native controls in the existing36px status row; no increased112px chrome height. Apply slider input while dragging but focus search only after release/commit. Preserve modal/lyrics through existing focus events.
- [x] Run full desktop/root suites and focused lint; commit integration. Expected: bounded input, current state wins, active/pending MV only, other controls unchanged.

### Task 3: Actual acceptance and final review

**Files:** desktop/tests/continuous-vocal-smoke.cjs, continuous-audio-smoke.cjs and relevant fixture; desktop docs and acceptance evidence.
- [x] Extend real AudioWorklet tagged fixture to partial levels with independent stereo stems and exact source-frame assertions; run separately from builds.
- [x] Extend real native MV acceptance for0/25/50/75/100, rapid drag, focus after release, minimum960px layout, retained level through model/pause/seek, and final skip silence. Run both Fast/HQ sequentially. Expected: no level-triggered seek/session reset, original fallback intact.
- [x] Run root/desktop suites, appropriate Python checks if worker touched, lint and Next build only if hosted sources change. Obtain one fresh most-capable whole-branch review with this Review Focus verbatim. Fix Important/Critical RED→GREEN plus full suite in one pass; no re-review loop.
- [x] Commit acceptance fixes/docs. Expected: no unresolved material findings; record actual host and subjective-quality limits.

### Task 4: Release0.1.8

**Files:** desktop/package.json, package-lock.json, README.md, CHANGELOG.md, ACCEPTANCE-0.1.8.md and this plan.
- [x] Bump0.1.8 and build NSIS after runtime tests close. Verify ASAR/new assets/version/excluded developer files and exact bundled model hashes; run packaged portable workers and actual packaged level/focus/skip acceptance.
- [x] Save a new D:/karaoke/build/desktop/0.1.8 directory with installer, SHA256, instructions and evidence; refuse overwriting old releases. Commit and authorized nonforce push; verify READY production alias, default packaged boot and matching clean remote Git.
- [x] Record final metrics and limits, preserve useful evidence before scratch cleanup and retain managed worktree. Expected: concrete installer delivery, no silent installation.

## Self-review

One integrated gain-control change, not a model or separation rewrite. Task1 protocol names match Task2 native setter and Task3 fixtures; Task4 packages those same verified assets. Each Review Focus case is assigned. No hosted behavior/schema change planned; prior hosted skip fix remains deployed.

## Final acceptance

Root102/102, Desktop107/107 and focused lint GREEN after both final-review Important fixes RED→GREEN. One fresh strongest-model review, no deferred findings. Real worklet532129 checked frames/zero errors/max3.2643e-8; exact tagged independent stems at0/25/50/75/100, retained model/pause timeline. Final packaged production Fast20ms/video8044.5ms, HQ26ms/video8028.5ms; all levels/one-percent/real drag/native focus/delayed-toolbar busy/min960/model selection/pause50%/seek/tail/skip checks passed. Native Thai focus/modal/lyrics passed. ASAR exact changed sources, profiles, both model hashes, relative runtime and both packaged GPU workers passed. New installer312957446 bytes SHA2560357327B03B95A3A551098F0CEB54CF4DF01C5D8BBED45094918E09E16454730 saved separately to D:/karaoke/build/desktop/0.1.8; old0.1.7 hash unchanged. See desktop/ACCEPTANCE-0.1.8.md for full evidence and actual-host/quality limits. No silent installation.
