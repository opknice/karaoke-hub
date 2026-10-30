# Optional HQ5 Vocal Remover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-selected optional Instrumental HQ5 alongside the existing fast Electron vocal remover, retaining fast behavior and safely synchronizing the longer HQ delay.

**Architecture:** A canonical allowlisted model profile controls the worker, audio span format and timing. Fast retains its current separator; HQ uses bounded finalized overlap-add spans and an eight-second delay. Native model selection restarts only the selected worker, guards all callbacks by model generation, and shares profile-aware playback state with the hosted Player; HQ video uses a separately bounded encoded queue.

**Tech Stack:** Electron45.1, Node24, Python3.12, NumPy2.2.6/SciPy1.15.3, ORT DirectML1.24.4, AudioWorklet, WebCodecs, Next16.4.3/React19.

**Spec:** `docs/superpowers/specs/2026-10-30-optional-hq5-vocal-remover-design.md` — approved by user on2026-10-30 (“พัฒนาตามแบบนี้”). Native implementation in the current managed worktree follows the existing session workflow; no implementer agents.

## Global Constraints

- Windows10/11 x64; current actual test host Windows11/GTX1650Ti4GB. Do not infer Windows10 acceptance.
- Retain fast4500ms buffer/5000ms startup gate and the existing model/hash/recipe. HQ8000ms buffer/10000ms first-output safety deadline, after model readiness.
- HQ5 exact hash/size/metadata from approved spec; sign-denoise stays enabled and measured readiness includes its throughput.
- Model processing is local, one resident model session at a time; no arbitrary model paths/URLs in IPC, no audio uploads or microphone/system capture.
- Preserve MV-only operation, search independence, key/1% tempo/reset behavior and native song-search focus with modal/lyrics exceptions.
- HQ video targets720p30 with bounded compressed storage; no silent540p workaround. Unsupported/failed codecs recover to original playback and leave Fast selectable.
- Persist model choice locally, default Fast for a new install. Removal still resets off on the next playing queue item.
- Models/UI are not release-ready until packaged production acceptance; existing0.1.5 remains available.

## Review Focus

- Rapid model changes followed by Stop/reload: no late ready callback may re-enable removal; test in Task4.
- Short/end-of-track playback while switching: no stale completion, cut tail or stranded queue; test in Task5/6.
- Decoder callback after pause/reset/model change: stale frames must close without drawing; test in Task3.
- HQ spans wrap ring boundaries or arrive late: no unbounded growth, invalid overlap, or dry output advertised as successful AI; test in Task2.
- Slow/failed HQ warmup and unsupported codec: Fast selection/retry and keyboard input remain responsive; test in Task4/6.

---

### Task 1: Canonical model profiles and worker model identity

**Files:** Create `desktop/vocal/models.json`, `desktop/lib/vocal-models.cjs`, `desktop/tests/vocal-models.test.cjs`. Modify `desktop/vocal/worker.py`, `desktop/lib/vocal-worker.cjs`, Python/Node worker tests and packaging file allowlist.

**Interfaces:** `getVocalModel(id)` returns an immutable allowlisted profile (`id`,filename,bytes,sha256,stem,fft,bins,frames,compensation,delayMs,startupDeadlineMs,spanMode,maxResultFrames). `VocalWorker` accepts `profile` plus existing paths/callbacks; ready validates selected modelId/hash and calibrated throughput. `selectModel({profile,paths})` terminates/revokes the previous child without changing callback contracts. Python CLI adds `--model-id {fast,hq5}` and reads the same JSON beside worker.py.

- [ ] Write tests `unknown profiles never resolve paths`, `default Fast retains exact timing`, `old child readiness cannot satisfy another profile`, and `HQ accepts only matching hash/profile/shape`.
- [ ] Run `node --test desktop/tests/vocal-models.test.cjs desktop/tests/vocal-worker.test.cjs`; confirm new assertions fail for missing profiles/identity.
- [ ] Implement allowlisted profiles and worker selection/identity, retaining current no-profile Fast compatibility for existing tests/callers. HQ denoise readiness uses measured two-pass time with margin below its1.480272s stride.
- [ ] Run those Node tests and `python -m unittest discover -s desktop/tests -p vocal_worker_test.py` with the known venv interpreter; all pass.
- [ ] Commit Task1 with exact model identity and worker lifecycle changes.

### Task 2: Bounded HQ separator and profile-aware audio buffer

**Files:** Create `desktop/vocal/hq_separator.py`; modify `desktop/vocal/separator.py`, `desktop/vocal/worker.py`, `desktop/audio/vocal-buffer.mjs`, `desktop/audio/vocal-processor.js`, `desktop/audio/engine.mjs`. Extend `desktop/tests/vocal_worker_test.py`, `vocal-buffer.test.mjs`, `audio-lifecycle.test.mjs`.

**Interfaces:** `HQSeparator(predict,denoise=True).push(pcm)` consumes existing stereo44100-frame packets and emits `{start_frame,vocals}` finalized contiguous spans up to65280 frames, or None. Use source-minus-final-Instrumental for the existing subtraction graph. `LiveVocalBuffer.enable({epoch,startFrame,delaySeconds,spanMode})` distinguishes fast overlapping estimates from HQ finalized spans; `AudioEngine START_VOCAL` supplies only native allowlisted profile settings.

- [ ] Add failing tests for HQ STFT/model direction/compensation, normalized overlap continuity, streaming spans versus an offline same-recipe reference away from boundaries, long-run fixed-capacity storage, reset and nonfinite data. Add worklet-buffer tests for8s delay, finalized spans crossing ring wrap, stale epochs/gaps and preserved4.5s Fast output.
- [ ] Run focused Python and Node audio tests, verify expected new failures.
- [ ] Implement generic STFT parameters with current defaults, then a separate bounded HQ ring/history separator (261120-frame window,65280-frame stride, Hann normalized OLA, two-pass denoise). Keep Fast output algorithm unchanged. Finalized spans receive no second blend in the worklet. Reject invalid sizes/types rather than expanding buffers indefinitely.
- [ ] Run the focused suites and real portable HQ paced-worker smoke, checking finite stereo spans, exact timestamps, throughput and no old-model regression.
- [ ] Commit Task2.

### Task 3: Compressed HQ video buffering

**Files:** Create `desktop/lib/vocal-video-codec.cjs` and `desktop/tests/vocal-video-codec.test.cjs`; modify `desktop/lib/vocal-video.cjs`, `desktop/tests/vocal-video-smoke.cjs` and add/extend a real codec Electron smoke fixture.

**Interfaces:** Serializable `createEncodedVideoQueue({source,width,height,delayMs,onFrame,onFailure,clock})` exposes `push(frame,{captured,time})`, `clear()`, `close()`, `snapshot()`. Callbacks carry capture/media timestamps. `installVideoDelay(config,encodedFactory)` selects Fast raw frames or HQ encoded queue from the native profile. Both retain the same transport/snapshot/rewind API.

- [ ] Add failures for encoded byte/queue bounds, epoch cleanup and discarded stale output, decoder errors, and Fast operation without VideoEncoder support.
- [ ] Run Node codec/video tests; confirm missing implementation fails.
- [ ] Probe supported encoder+decoder configs and actual720p encode/decode. H264 `prefer-hardware` was unsupported in the first capability probe; try supported H264/VP8 alternatives rather than assuming a codec. Implement bounded queues (initial64MiB encoded, max4 encode/decode jobs, max512 encoded packets and few retained decoded frames), using encoded timestamps on the shared clock. Close/reset resources and ignore late callbacks by generation. Keep Fast raw behavior/resolution unchanged.
- [ ] Run real Electron fixture at8s, checking rendered content, timing,720p target, bounded memory/queues, pause/seek/reset/stop/ended draining. Failure restores original; no silent resolution downgrade.
- [ ] Commit Task3.

### Task 4: Native selector, responsive runtime switching and coordinator profiles

**Files:** Modify `desktop/main.cjs`, `desktop/lib/controller.cjs`, `desktop/lib/policy.cjs`, `desktop/lib/vocal-coordinator.cjs`, `desktop/ui/index.html`, `shell.js`, `style.css`; create small settings/runtime helper modules only if they keep lifecycle responsibilities clear. Extend controller/coordinator/policy/focus tests.

**Interfaces:** Local `SET_VOCAL_MODEL {modelId:'fast'|'hq5'}` only; state includes `vocalModelId`, profile delay, selected model loading/ready/error and optional transition state. Runtime model generation guards late ready/failure/results. Coordinator receives `getProfile()` and passes profile settings to audio/video. Local settings read/write only the allowlisted model ID.

- [ ] Add failing tests for new-install Fast default, saved valid choice/invalid settings, selected model changes while off/on/preparing, two rapid changes then Stop/reload/new queue, failed HQ warmup followed by Fast retry, key/tempo preservation and no remote model-selection grant.
- [ ] Run controller/coordinator tests; confirm expected failures.
- [ ] Implement immediate revocation and original-position restoration before worker switching. Return command acceptance before long warmup; late auto-start requires the same queue, audio generation and still-active user intent. Keep the selector near Vocal Remover, using the status row if needed to preserve960px toolbar fit and112px Player offset. UI text describes `เร็ว (เดิม)` / `คุณภาพสูง · HQ5`, expected delay and preparation. Preserve focus restoration on acceptance/completion.
- [ ] Run Node suites, actual native keyboard selector/Thai typing tests, and model switching on a real MV. Verify no controls remain blocked by worker loading and Fast still begins within5s.
- [ ] Commit Task4.

### Task 5: Hosted profile-aware delayed completion

**Files:** Modify `src/lib/vocal-cut-bridge.ts`, `src/lib/vocal-playback.ts`, `src/components/YouTubePlayer.tsx` and relevant Player integration. Extend `tests/vocal-playback.test.cjs`, `tests/vocal-player-lifecycle.test.cjs`.

**Interfaces:** `getVocalPlaybackDelay(state,queueItemId)` accepts HQ8000 only with approved native HQ profile and matching playing MV; keep older native Fast state compatible. `DelayedPlaybackEnd` supports only bounded approved delays and explicit cancellation/transition semantics. Native playback metadata stays fixed/typed and cannot select a model.

- [ ] Add failing tests for valid HQ8000, forged/unknown profile/delay, wrong queue, disabled/Karaoke state, legacy Fast, and model changes during the source-ended tail. Pin same-item restart/seek/PLAYING cancellation and no stranded completion on disable/switch.
- [ ] Read relevant installed Next docs, run focused root tests and confirm expected failures.
- [ ] Implement profile-aware validation and lifecycle; preserve browser/extension behavior without native HQ state. Do not just raise the numeric limit and accept arbitrary delays.
- [ ] Run focused and full root tests, TypeScript/lint and production Next build; all pass.
- [ ] Commit Task5.

### Task 6: Packaging, independent review and release acceptance

**Files:** Update `desktop/scripts/prepare-vocal.cjs`, `.vocal-build.example.json`, package/lock version0.1.6, README/CHANGELOG and native smoke scripts; record measurements in this plan.

**Interfaces:** Staging validates/copies both exact models and canonical profiles into isolated resources. `KARAOKE_EXECUTABLE` and `KARAOKE_PLAYER_URL` keep native tests selectable; tests take a modelId and report actual profile latency.

- [ ] Add packaging validation assertions for missing/wrong HQ model, registry/resource consistency and no developer config/env in the installer; verify failures with controlled fixtures where appropriate.
- [ ] Run all root/desktop/Python suites and focused lint/build. Obtain one fresh independent whole-branch review; fix Important/Critical findings with regression evidence, without a repeated review loop.
- [ ] Build installer, validate packaged portable worker for both profiles and inspect packaged model hashes/resources. Run native tests sequentially, separate from heavy builds: Fast baseline/focus, HQ first-output and A/V sync, safe switches/cancellations, pause/paused-seek/resume, same-item restart/tail/queue, and >=5-minute HQ bounded-memory run on a real MV. Inspect captured sound against chosen B and additional mixes; report actual evidence and listening limits.
- [ ] Push/deploy compatible Player via authorized GitHub integration, verify READY production alias, and repeat packaged production profile acceptance. Save0.1.6 installer under a new stable release folder with matching SHA256; do not overwrite0.1.5 or install over a running user app.
- [ ] Update acceptance evidence/docs, commit/push remaining task files and verify clean branch/remote state. Deliver installer plus concise two-mode use instructions and measured limitations.

## Progress and plan self-review

- [x] Approved design saved and fresh builder check returned “nothing important left”.
- [x] Self-review: each spec section maps to a task; shared IDs/state/signatures are consistent; all five Review Focus conditions have owning tests. This is one integrated feature: worker/audio/video/UI/hosted timing must cooperate before release.
- [ ] Product implementation and release acceptance remain.
