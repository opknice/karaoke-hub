# Continuous Vocal Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, then one fresh whole-branch reviewer. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Switch between original and removed vocals at the same musical position, keeping original music playing while AI prepares.
**Architecture:** A persistent eight-second MV audio/video session is independent from revocable selected-model AI epochs. Native preflight prepares capture before source playback; time-aligned subtraction ramps only the vocal component. Existing browser/legacy-native clients retain their path.
**Tech Stack:** Electron45.1, AudioWorklet/WebCodecs, existing verified UVR Fast/HQ5 + isolated Python/DirectML, Next16.4.3/React19.
**Spec:** docs/superpowers/specs/2026-10-30-continuous-vocal-switch-design.md. User approved the no-rewind goal and eight-second initial buffering in conversation. Existing native execution and push/deploy authorization persist.

## Global Constraints

- Preserve both exact model weights/recipes, default Fast and saved selection. Shared continuous delay is8000ms for BOTH models, replacing profile-specific delay only in the new prepared-MV path.
- One selected model session; fixed12-second audio ring,20ms linear vocal-subtraction ramp, ten-second first-result deadline; no silence/seek/raw reset during removal/model changes.
- Encoded video720p30,64MiB/512packets/4 pending jobs; no silent resolution/quality downgrade.
- Stop opts out until manual Start, queue/reload cancels stale intent. Initial/manual buffering and explicit seek/restart are separate from removal toggles.
- Trusted Player capture only; no uploads, microphone/system capture, remote model paths, hidden YouTube player or database changes. Preserve key/one-percent tempo and native Thai/search focus.
- Maintain compatibility with older native and browser-only Player. Read installed Next docs before frontend edits. Release0.1.7; retain0.1.6. Actual host acceptance only Windows11/GTX1650Ti.

## Review Focus

- Queue change or Stop during awaited native preflight must never play an old MV or revive capture; pin Task4.
- Worker loading/failure and rapid model toggles must leave delayed original continuous, with no invalid AI on claim; pin Task1/3.
- Pause during in-flight encode/decode must retain bounded packets and freeze presentation, with no late draw; pin Task2.
- Short MV ends or toggles/models change during its delayed tail: one valid completion, no cut or stranded queue; pin Task4/5.
- Tempo changes within the buffer and seek while paused: frame timestamps, displayed position and raw output must stay aligned; pin Task1/2/5.

### Task 1: Continuous audio buffer and host commands

**Files:** Create desktop/audio/continuous-vocal-buffer.mjs and desktop/tests/continuous-vocal-buffer.test.mjs. Modify desktop/audio/vocal-processor.js,engine.mjs and audio-lifecycle.test.mjs.
**Interfaces:** ContinuousVocalBuffer({sampleRate,onPcm,onState}) exposes begin({sessionEpoch}), beginAi({epoch,spanMode,maxResultFrames}), remove(enabled), pause(),resume(),endAi(),disable(),receive({epoch,startFrame,pcm}),process(left,right,outL,outR,frameStart). Session raw counters survive AI epochs; returned spans map to aiBaseFrame. Engine commands PREPARE_VOCAL_SESSION,BEGIN_VOCAL_AI,SET_VOCAL_MIX,END_VOCAL_AI,PAUSE_VOCAL_SESSION,RESUME_VOCAL_SESSION; legacy commands remain.
- [x] Write timestamp-tagged stereo tests for exact8000ms dry delay, dry→wet→dry20ms ramps on identical frames, AI re-prime/model change while dry stays continuous, no output holes/duplicates/skips, pause/resume retained counters, fixed capacity after90s, stale epoch/gaps/nonfinite results, missing-result timeout with original fallback. Host lifecycle tests pin held-mode construction before context resume and session/AI event validation.
- [x] Run `node --test desktop/tests/continuous-vocal-buffer.test.mjs desktop/tests/audio-lifecycle.test.mjs`; Expected: new interface failures before code.
- [x] Implement the independent raw/session clock and AI frame map; do not reset legacy LiveVocalBuffer behavior. Use processorOptions for buffered startup so no unbuffered quantum leaks before host commands.
- [x] Run focused and full desktop suites; Expected: all pass. Commit Task1.

### Task 2: Retained compressed video clock

**Files:** Modify desktop/lib/vocal-video-codec.cjs,vocal-video.cjs and their Node/real fixture tests.
**Interfaces:** Encoded queue adds pause()/resume(); frozen logical clock supplied by continuous video mode. VocalVideo.start accepts continuous:true with8000ms/encoded; pause()/resume() retain media/history without rewind. Legacy methods remain.
- [x] Add tests for pause during asynchronous encoder/decoder callbacks, no presentation while paused, retention/closure of up to4 in-flight decoded frames, unchanged bounded storage/generation, resumed timestamps, seek/reset revocation and legacy Fast raw regression.
- [x] Run `node --test desktop/tests/vocal-video-codec.test.cjs desktop/tests/vocal-video.test.cjs`; Expected: new methods/clock assertions fail.
- [x] Implement queue scheduling holds, logical clock freeze, retained pause/resume and continuous snapshots/displayTime. Do not recreate video on removal/model toggle.
- [x] Run focused suites and real eight-second720p fixture; Expected: bounded non-stale output and same-position resume. Commit Task2.

### Task 3: Native persistent session and model switching

**Files:** Create desktop/lib/continuous-vocal-coordinator.cjs and tests. Modify controller.cjs,main.cjs,policy.cjs,player-preload.cjs,ui/shell.js and applicable controller/focus tests.
**Interfaces:** ContinuousVocalCoordinator owns prepare(track),startVideo/transport,beginAi(),setRemoval(enabled),suspendAi(),stopSession(options), worker feed/result and audio state. State includes supportsContinuousVocal:true,vocalBufferActive,continuousSessionId,vocalPlaybackDelayMs:8000,vocalDisplayTime. AI enabled intent is separate from active session. Native fixed PREPARE_PLAYER_TRACK payload validates queue/video/version only. Static preload capability is non-privileged.
- [x] Write tests proving remove/model changes do not call raw/video reset/rewind/stop, background feed while off, finite pending toggle, original fallback on slow/failed worker, rapid choice+Stop/reload cancellation, user Stop prevents automatic restart, key/tempo preservation, strict sender/payload/capability and stale session/result rejection.
- [x] Run focused controller/coordinator/policy tests; Expected: new behavior fails.
- [x] Integrate persistent coordinator with existing worker/controller. Preflight auto-starts held capture for MV unless explicitly stopped; worker readiness starts only AI, not raw/video. New track/seek resets session; only explicit user Stop opts out until Start (navigation/reload/failure cleanup does not). Capture is armed before source load; video attaches in a second phase only after matching media is ready/playing. UI distinguishes buffer/model preparation, original and removal; do not block Stop/keyboard for model loading.
- [x] Run full desktop suites; Expected: all pass, including old controller/worker contracts. Commit Task3.

### Task 4: Hosted preflight and completion compatibility

**Files:** Create src/lib/native-player-preparation.ts plus tests. Modify useVocalCutExtension.ts,vocal-cut-bridge.ts,vocal-playback.ts,YouTubePlayer.tsx,player/page.tsx and lifecycle tests.
**Interfaces:** prepareNativePlayerTrack({youtubeVideoId,queueItemId,versionType}) is bounded, requestId-matched and native-capability gated. Player awaits before load/play, checks latest queue token after await. DelayedPlaybackEnd adds bounded pause()/resume() with retained remaining duration for continuous sessions. getVocalPlaybackDelay accepts matching verified continuous8000 buffer even when AI off; old rules unchanged. Optional displayTime is only used for matching active continuous native MV.
- [x] Read installed Next use-client guide. Add failures for preflight before initial/next load, rapid queue/Stop during await, prepare failure/timeout, browser/legacy no-wait behavior, forged continuous state and off-mode8000 tail, short MV/model toggle during tail, pause/resume retaining remaining tail time without restarting ended source, display clock across tempo changes.
- [x] Run focused root tests; Expected: new assertions fail.
- [x] Implement preload capability/request helper and preflight through stable refs without remounting YouTube on status updates. Keep typed remote union restricted. Use displayed frame timestamp for prepared native clock; preserve genuine pause/seek/restart cancellation semantics.
- [x] Run full root suite, focused ESLint and Next build; Expected: all pass. Commit Task4.

### Task 5: Real continuity acceptance and independent review

**Files:** Create desktop/tests/continuous-vocal-smoke.cjs; adapt appropriate fixture/recording helpers without weakening old acceptance.
**Interfaces:** model/executable/player URL environment overrides; observations include displayed/source time, seek count, audio windows and session IDs around toggles.
- [x] Add real Electron timestamped fixture acceptance covering initial buffer, original playing through AI preparation and toggles, model switches, retained pause/resume, paused seek, late callbacks and final tail. Verify no raw reset/seek occurs for toggles and no new silent interval appears after the initial buffer.
- [x] Run source native tests sequentially, separate from builds. Expected: both Fast/HQ toggles keep monotonic displayed position/non-silent musical output; selection/focus/key/tempo/tail remain valid. Capture transition diagnostics on actual MVs.
- [x] Run full root/desktop/Python suites, lint/build. Obtain one fresh strongest-model whole-branch reviewer using approved spec/plan/ledger and Review Focus verbatim. Fix Important/Critical with RED→GREEN and full suites, no re-review loop. Expected: no unresolved material issues. Commit acceptance fixes/evidence.

### Task 6: Package, deploy and verify release0.1.7

**Files:** desktop package/lock,README/CHANGELOG,acceptance report and this plan.
**Interfaces:** unchanged verified bundled models/runtime; final packaged executable defaults to production and capability negotiation preserves0.1.6/browser clients.
- [x] Bump0.1.7, build NSIS, validate ASAR/version/resources/both exact hashes/no developer env/config. Expected: installer build and packaged portable worker pass.
- [x] Push compatible hosted Player via authorized nonforce GitHub main integration; verify READY alias. Run final packaged production both models, live/paused switches, Stop/focus/key/tempo and at least300s bounded continuous original/AI playback plus tail/queue tests. Expected: no gaps/rewinds caused by removal toggles, no stale auto-restart, no unbounded growth; report actual hardware/listening limits.
- [x] Save new D:/karaoke/build/desktop/0.1.7 installer, SHA256, instructions and evidence without overwriting0.1.6. Update/commit/push docs, verify clean Git and matching origin/main. Expected: reviewable artifact and accurate delivery; no silent installation.

## Plan self-review

One integrated playback feature; tasks1/2 produce independent audio/video clocks consumed by3, whose typed capabilities/state feed4;5/6 verify their combined behavior. All Review Focus cases have owners. No model/separation rewrite or Supabase schema work.

## Final release evidence

Product commit 9686abe was deployed through nonforce GitHub main integration and the production alias was READY. Root99/99, Desktop93/93, Python11/11, focused lint, Next build and NSIS passed. Exact packaged ASAR/profile/model/relative-runtime checks and both portable GPU worker tests passed. Packaged production Fast activation14ms; HQ21ms, shared video8.03–8.05s. HQ completed300s/593 samples with original/AI transitions, zero toggle seeks and max7,722,328 encoded bytes/201 packets. Separate shared-control transport acceptance passed paused model changes, retained resume, paused seek and paused original end-tail completion; native Thai keyboard/focus and default hosted boot passed. The original direct-element-pause harness raced shared room playback and was corrected to use actual room controls; no product or timing bound changed. See desktop/ACCEPTANCE-0.1.7.md for full evidence and limits.

Installer saved separately under D:/karaoke/build/desktop/0.1.7:312,955,869 bytes; SHA256631A611DF51E905B90650AE4C951E92B8BF24C5118ACC2D9C69B3D1F1ABE0486. Previous0.1.6 hash unchanged. Final review's single Important cancellation issue was fixed RED→GREEN and actual UI confirmed cancellation/manual recovery. No unresolved findings; Windows10/other devices and subjective full-mix listening remain outside this host's acceptance. Managed worktree and evidence retained; no silent installation.
