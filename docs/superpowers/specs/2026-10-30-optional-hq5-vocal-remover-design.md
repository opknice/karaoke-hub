# Optional Instrumental HQ5 mode for the Electron Player

Date: 2026-10-30. Status: approved by user on 2026-10-30 (พัฒนาตามแบบนี้). Fresh builder check: nothing important left.

## Intent and accepted choices

The user hears watery/echo-like separation artifacts, wants to retain the existing model, and selected listening sample B (Instrumental HQ5) for an additional quality option after asking to measure quality and latency first. The existing fast mode remains available. This change targets the Windows 10/11 x64 Electron Player, not a browser extension or a cloud separation service.

Measured on Windows 11 / GTX 1650 Ti 4GB: the released fast model began output at about 4.7 seconds; an isolated HQ5 prototype began processed output at 8207 ms and delayed video at about 8001 ms. The HQ prototype retained on status for 72 samples during a 35-second recording. This is feasibility evidence, not completed release acceptance or a guarantee on other machines.

## Approaches considered and selected

1. Keep only the existing model and tune its streaming recipe. Lower integration cost, but does not provide the new model choice the user requested.
2. Retain fast Main and add optional Instrumental HQ5. Selected by the user as B. The experiment supports live throughput on the current GPU with more lookahead/overlap and about eight seconds of buffering.
3. Mel-Band RoFormer. Listening sample C was not selected. Its experimental FP16 DirectML run required roughly 11 seconds of inference per four seconds of new audio on this host, so extra initial buffering alone cannot make it sustain live playback. Excluded from this release.

## User-visible behavior

- Add a compact selector beside Vocal Remover: `เร็ว (เดิม)` and `คุณภาพสูง · HQ5`. The selector is native Electron UI; browser-only Player behavior is unchanged.
- A new installation defaults to Fast. Persist the user's selected mode locally; retain it across songs/restarts. Whether removal is on still follows the playing MV and resets off when that queue item ends.
- Display expected delay with the selected mode: Fast approximately 4.5 seconds of A/V buffering (existing five-second startup limit); HQ approximately eight seconds of buffering. The measured trial started audible output around 8.2 seconds after activation with its model ready. Model loading is a separate preparing state.
- A model change while removal is off prepares the selected model and leaves removal off. A change while removal is on restores original playback at the displayed position, prepares the requested model, then re-enables removal only if the same MV/queue item and audio session remain active and the user has not stopped it. Loading and re-priming are explicit; switching cannot be gapless.
- Failures keep original playback available with a clear reason and a retry/selection path. Do not silently call the old model HQ or silently downgrade HQ quality. The selector remains usable after a failed warmup.
- Stop/reload/track change must cancel a pending automatic restart immediately. Preparing a model must not hold the controller command queue or disable Stop for the duration of worker loading.
- Toolbar actions restore keyboard focus to song search on acceptance and completion, preserving modal/lyrics focus exceptions. Native keyboard operation of the selector must also work.
- Preserve the current key range, one-percent tempo steps, and Reset's existing key/tempo semantics. Selecting a model does not reset key/tempo or room state. Vocal removal remains MV-only; switching the search selector to Karaoke does not stop a playing MV.

## Model profiles and local execution

Use one canonical, allowlisted profile table shipped with both native controller and Python resources. Node and Python consume the same tracked JSON, even if packaging includes a copy in ASAR and a copy alongside worker.py. IDs are fixed (`fast`, `hq5`); IPC never accepts a filesystem path, URL, compensation value or arbitrary model config from remote content.

Fast preserves the current verified model and recipe: UVR_MDXNET_Main.onnx; SHA256 8289784cda38543ff431add4070662813311a8cccfc0112ca82f76d9dba2b4ca; Vocals; FFT7680, bins3072,256 frames, compensation1.043. Keep its 4.5-second delay, five-second startup gate, existing denoise calibration behavior and central-output overlap recipe.

HQ5: UVR-MDX-NET-Inst_HQ_5.onnx; 59,074,342 bytes; SHA256 811cb24095d865763752310848b7ec86aeede0626cb05749ab35350e46897000. Verified UVR tail MD5 cb790d0c913647ced70fc6b38f5bea1a maps to primary Instrumental, FFT5120, bins2560,256 frames, hop1024, compensation1.01. Resolve the symbolic batch dimension to one and validate actual input/output metadata and inference shapes. Native window261120 samples (about5.921 seconds),75% window overlap, sign-denoise enabled. Readiness requires throughput with denoise enabled and margin for transforms/transport, not only a quick single pass. Do not silently disable denoise in this quality profile.

Only one model worker/session is resident at a time. Switching revokes the current stream epoch, terminates/invalidates the old child, and warms the selected model. Late stdout, ready callbacks and model-load failures are associated with the requested model generation and cannot update a newer selection. Existing isolated Python/DirectML resources are reused; end users do not install Python or download weights during playback. No audio/stems are uploaded.

## Bounded streaming audio

Retain the current fast path as a regression reference. Implement HQ5 as a separate bounded streaming separator using the selected recipe, replacing the experiment's70-second arrays with a ring/history buffer whose size is independent of song length. Accumulate full model-window Instrumental predictions with normalized overlap-add and emit finalized, non-overlapping timestamped spans. Retain stereo/sample alignment and exact compensation; do not treat an Instrumental prediction as Vocals or subtract it twice.

If the existing transport continues to carry estimated vocals, derive them as source minus finalized Instrumental so the host's subtraction yields the intended result. Mark finalized spans separately from fast overlapping estimates: the worklet must not apply another crossfade/window to already-finalized HQ output. Validate span sizes, finite values, sequence/epoch and profile identity at every boundary. Account for HQ spans longer than one second in bounded IPC size limits.

Use a shared start clock and profile delay. A fixed8000 ms HQ delay is the initial implementation target; allow up to10000 ms from activation to first audible output, including bounded setup and device latency. This is an implementation safety deadline, not a promised ten-second buffer or measured result. Fast's5000 ms gate is unchanged. Missed processing deadlines restore original playback and report failure; extra waiting cannot mask a sustained backlog. Cancel queued work and invalidate all delayed audio after stop/seek/reload/model switch.

Beginning/end context can differ from offline file separation. Preserve the B recipe in steady playback and evaluate these boundaries explicitly; do not promise bit-identical output to the listening file. Pause/resume re-primes the selected profile. The existing delayed musical tail must play completely before queue advancement.

## Video synchronization and hosted compatibility

Simply doubling the existing raw VideoFrame queue at720p30 would exceed its intended memory budget. Preserve Fast's existing raw-video path. For HQ, buffer compressed video chunks locally in the trusted media frame using WebCodecs, then decode/display on the shared eight-second clock, targeting the same maximum720p30 presentation. Bound encoded bytes, encoder/decoder queue sizes and retained decoded frames; initial engineering caps are64MiB encoded data, no more than four queued encode/decode jobs, and no more than a few decoded frames. These exact limits may be tuned from measurements without expanding resolution or unbounding memory.

Probe both encoder/decoder configuration and actual encode/decode behavior. Hardware preference is not proof of availability. If a working bounded HQ video path is unavailable, HQ must report unavailable with a useful reason; Fast remains selectable. Do not silently reduce video resolution to the experiment's540p workaround. Codec choice/bitrate and internal buffer implementation are builder decisions, with720p30 synchronization, bounded memory and measured timing as requirements.

All frames/chunks/codecs/timers and callbacks belong to an epoch and must be revoked/closed on reset, stop, source replacement and renderer loss. Pause freezes the displayed position; seek/restart invalidates old frames; disabling rewinds to the visible position before original playback resumes. Encode/decode errors trigger explicit original-playback recovery.

Update the hosted Player's currently five-second native-tail cap to recognize only approved native profiles/delays, including Fast4500 and HQ8000. Keep strict queue-item/MV binding, bounded values and legacy behavior when no native HQ state exists. Pause, seek, restart, skip, disable and changed queue items must cancel or replace old completion timers. Handle pending tail changes explicitly so a model switch during the delayed tail cannot strand or prematurely advance the queue. Preserve the previously fixed same-item restart cancellation. No Supabase schema changes are needed.

## Security and packaging

Model selection is a fixed local-toolbar command, with strict native sender/main-frame/URL checks. Do not add model path/download controls to the remote Player bridge. Preserve the private media-frame token and epoch checks, trusted Player-only selective capture, context isolation/sandboxing, no Node in remote views, and no microphone/system capture.

Bundle both verified weights, the profile registry and dependency/license resources in a new installer (proposed0.1.6). Update the build configuration example and staging validation without overwriting an existing release folder. Installer remains unsigned unless an actual signing certificate is configured. Deploy the compatible hosted Player and validate the packaged executable against production before describing the release as ready. Existing0.1.5 artifacts remain available.

## Acceptance

- Registry/model integrity, symbolic batch handling, primary-stem direction, compensation, STFT reconstruction, weighted overlap continuity, finalized-span transport and bounded buffers.
- Long-run HQ state independent of track duration; no stale output or readiness after switching, cancellation, seek or reload. A failed HQ warmup must allow Fast selection/retry.
- Real encoded-video fixture and actual YouTube tests: first output/delay, frame memory/queues, sync, pause/resume, seek while paused, disable at the visible position, source-end tail, restart during tail, switching models during preparing/on/tail, skip/new track and renderer recovery.
- Existing Fast first-output<=5 seconds, key/one-percent tempo, Thai keyboard focus, modal/lyrics exceptions and MV/search independence remain passing.
- Actual packaged HQ acceptance on the current GPU: first audible output within the explicit HQ deadline, video close to its8-second target, at least a five-minute run with bounded memory/queues and no repeated deadline fallback. Report actual numbers and host; do not infer Windows10 or all-device compatibility.
- Inspect/listen to captured HQ output against the chosen B sample on the same input; signal consistency alone is not a listening quality score. Repeat evaluation on more than one mix before claiming broader quality improvement. No perfect-vocal-removal or universal-best-model claim.

## Sources and scope

Experimental evidence and same-source20-second listening files are in D:/karaoke/build/desktop/model-trial-2026-10-30/REPORT.md. The user selected B after receiving these files. The throwaway app is not promoted into production.

WebCodecs configuration and actual output require separate checks: https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder/isConfigSupported_static and https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder/encode . Model metadata source: https://raw.githubusercontent.com/TRvlvr/application_data/main/mdx_model_data/model_data.json .

Implementation details left to the builder: internal class factoring, codec/bitrate chosen from working capabilities, exact ring capacities with proof of bounds, test fixtures, local settings-file format, and responsive selector styling. None may weaken the accepted timing/security/lifecycle/quality constraints above. Product code starts after this design is approved; implementation planning follows that approval.
