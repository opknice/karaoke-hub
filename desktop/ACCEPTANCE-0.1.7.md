# Desktop 0.1.7 acceptance — 2026-10-30

Host: Windows 11 build 26300, NVIDIA GTX 1650 Ti 4GB. Tests launch isolated profiles without replacing the user's installed application. Windows 10/11 x64 remain target platforms; this session certifies only the observed host. Installer is unsigned.

## Behavior and review

Prepared native MVs use one eight-second original/audio/video timeline for both models. The selected AI runs in the background even while original music is audible. Once ready, removal uses a 20ms subtraction ramp at the same sample position; toggles and model changes do not seek or recreate the playback session. Original music continues during model preparation or AI failure. Explicit seek/restart rebuilds the buffer. Stop opts out until Start in the current app session.

Both model weights and separation recipes are unchanged from 0.1.6, including HQ5 sign-denoise and overlap. MV-only eligibility, independent search mode, key controls, one-percent Tempo steps and Thai typing focus are retained. Native capability negotiation preserves browser and older native playback. Tempo changes propagate through the eight-second playback buffer.

One independent final whole-branch review reported an Important cancellation race: explicit Stop during awaited preparation could allow hosted source playback. It was reproduced with failing integrated tests, fixed, and verified in the actual native UI by holding capture preparation, cancelling, confirming source time stayed zero, then manually starting the selected MV. No unresolved Critical, Important or Minor findings remain.

Actual MV acceptance also exposed Chromium throttling behind a fully opaque startup cover. A controlled translucent-cover probe restored frame delivery; the product cover now uses 95% opacity. Latency/health bounds were retained. End-tail pause/resume and early AI-ready versus command acknowledgement races have regression coverage.

## Verification and source observations

- Root 99/99, Desktop 93/93, Python 11/11; focused ESLint, Next production build and NSIS build passed.
- Real AudioWorklet fixture checked 478,671 stable stereo frames with zero errors and maximum absolute error 7.45e-9; 838,528 active frames covered original/AI transitions, new AI and retained pause. This is the sample-clock continuity evidence.
- Real 720p encoded-video fixture presented its first delayed frame at 8032ms, retained pause/resume without a new eight-second wait, drained its tail, and observed approximately 3.27MB / 192 packets with zero dropped frames.
- Actual source Fast/HQ switching preserved session and epoch with zero seek events. Pause, paused seek, delayed original tail pause/resume and completion passed. Source prepared toggles measured 12–29ms; HQ measured 20ms.
- A 31.8396-second original/instrumental diagnostic contains no silent 10ms windows in the checked on/off/model-preparation sections (minimum RMS 0.0170 / 0.0626 / 0.0307). ScriptProcessor recording scheduling is not sample-clock proof and is not used to claim exact alignment or subjective quality.

## Packaged production observations

The packaged ASAR is version 0.1.7 and contains the continuous implementation and identical canonical model profiles. Developer environment/configuration, tests, scripts and the generated continuity fixture are excluded. Both bundled model sizes/hashes match their canonical profiles, and both isolated portable GPU workers produced four finite, timestamped spans. Runtime manifest paths are relative.

Final packaged Fast against production: prepared removal activation 14ms; delayed video 8047.7ms. Explicit preflight cancellation and subsequent manual Start passed. Changing to HQ5 kept original music advancing on the same session with zero seeks. Independent Karaoke search, native typing focus and key/one-percent Tempo preservation through model changes passed.

Final packaged production HQ5: prepared activation 21ms and delayed video 8031.3ms. The 300-second original/background-AI run passed 593 status samples, with AI toggled throughout, unchanged session/epoch, zero seek events, no AI error and maximum encoded storage 7,722,328 bytes / 201 packets. A subsequent independent transport run measured 14ms activation and 8050.3ms delayed video, and verified model changes while paused retain the exact displayed position, resume original without a new eight-second wait, then activate AI automatically without a seek.

The first long-run harness subsequently failed a pause assertion because it paused the raw YouTube element while room playback remained enabled; shared room state restored playback. The harness now uses the actual shared Pause/Resume controls for all transport checks. The five-minute processing result is independent of that later harness failure; no product code or latency bound changed for this correction.

The final packaged transport run passed retained Pause/Resume, seek while paused, and pausing/resuming the delayed original tail without restarting the ended YouTube source. Completion cleared the current queue item once. Packaged native keyboard/focus checks passed Down-to-HQ selection, Thai text/caret preservation, typing during slow capture, reload, modal and lyrics exceptions. Its older slow-capture label assertion was updated to accept the new cancel-preparation button caption; the focus and typing assertions remain unchanged.

## Artifact and limits

KaraokeHub-Setup-0.1.7-x64.exe: 312,955,869 bytes.

SHA256: `631A611DF51E905B90650AE4C951E92B8BF24C5118ACC2D9C69B3D1F1ABE0486`.

Release delivery directory: `D:/karaoke/build/desktop/0.1.7`. Previous 0.1.6 and 0.1.5 installers are retained. No silent installation is performed.

The agent does not claim subjective separation improvement from this timing change. Residual vocals, watery/reverb artifacts and affected instruments remain mix-dependent. The prior user-selected HQ5 recipe is preserved. Windows 10, other GPUs, laptop sleep/resume and Bluetooth/HDMI device changes require testing on those systems. Initial model loading is separate from the eight-second startup buffer; throughput failures fall back to original music with a visible error.
