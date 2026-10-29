# Live MV vocal removal — implementation and acceptance

The user reports that Vocal Remover is unusable. In 0.1.4 it is a disabled placeholder: there is no separation worker, command, or audio stage. The accepted requirements are live MV use, highest practical sound quality, <=5 seconds total delay, local Windows Electron operation without an extension, and continued processing of the playing MV after switching search to Karaoke. Existing pitch/tempo and keyboard focus must remain functional.

## Measured feasibility

- Existing verified UVR_MDXNET_Main.onnx, SHA256 8289784cda38543ff431add4070662813311a8cccfc0112ca82f76d9dba2b4ca. Primary stem Vocals, FFT 7680, dim_f 3072, 256 frames, compensation 1.043. No new weights downloaded.
- CPU ORT 1.22.1 / four threads: 3.70, 4.28, 4.00 seconds per forward pass. Not a live <=5 second solution after buffering.
- Isolated DirectML ORT 1.24.4 probe: adapter 0 approximately 3.9 seconds; adapter 1 approximately 0.29–0.49 seconds after warmup, 0.62 seconds first run. Profile records actual DmlExecutionProvider execution. This machine has GTX 1650 Ti 4GB and Intel UHD.
- Actual YouTube embed raw video.captureStream() succeeded with a blob source, video 854x480 at 25 fps, and an audio track. This allows delaying raw video without recursively capturing its displayed delayed overlay.
- These probes measure compute and capability, NOT music separation quality or end-to-end latency.

## Architecture

1. Warm a local isolated Python/ONNX DirectML worker in the background. Verify model identity and shape; select and report a working hardware adapter, and measure warm inference. Bundle the runtime/model for the installer rather than depending on D: or a developer virtualenv. No audio uploads or cloud compute.
2. Capture only the trusted Player using the existing dedicated local audio renderer. A new AudioWorklet batches PCM, keeps a bounded original delay line, and mixes model-estimated vocals out using timestamped overlap-add. Run the verified UVR STFT packing and compensation; use sign-denoise only when measured throughput fits its deadline. Generation-tag every job and reject late results after seek/stop/track change.
3. Target a fixed 4.5-second A/V pipeline. The model receives rolling approximately six-second contexts and emits a central one-second segment with overlap; old context can be zero-padded at start. Warm readiness, processing deadlines and bounded queues must be explicit. Never label dry fallback as successful vocal removal.
4. Delay raw video frames inside the trusted YouTube embed using VideoFrame(source) processing, then display a video-only overlay inside the embed. Its underlying media remains the source; existing Player UI remains above it. Audio stays in the separate local renderer. Use a common start clock and measure A/V correspondence. Freeze during priming rather than replaying already-heard original audio.
5. Implement transport lifecycle: pause, seek, rate, stop, reload and track end. Keep the visible/audio position when turning off. Source end must not cut off the delayed tail. Search selection never changes the playing worker generation. New Karaoke or end disables processing.
6. Replace the placeholder with an actual command and preparing/ready/on/error status. Retain the keyboard focus repair. Enable only for a playing MV and a validated runtime. Errors release resources and show an actionable reason.

## Verification and release gates

Write failing tests before each product change. Cover model metadata/shape/hash, STFT reconstruction, rolling segment indexing, overlap continuity, deadline and bounded-buffer behavior, generation revocation, controller MV eligibility and search independence, transport and button focus. Test real AI on a short musical excerpt; signal reconstruction alone is not a quality test. Inspect original/instrumental output and record practical quality limitations.

Use the actual packaged app against the compatible hosted Player. Verify total audible delay <=5 seconds, video/audio alignment, and stable throughput with YouTube and pitch/tempo active. Do not ship a ready/enabled claim until these gates pass. Keep existing 0.1.4 available during development.

## Progress

- Feasibility probes above completed.
- Streaming DSP and GPU worker implemented under desktop/vocal, not yet connected to the released UI. Seven Python tests passed: stereo/time mapping, overlap continuity, reset, finite-data validation, denoise bias removal, adapter preference, packet validation and model integrity (some test methods cover multiple checks).
- Actual worker smoke passed with the verified model, selected NVIDIA GPU, denoise enabled: two-pass warm 722 ms; full rolling transforms + inference approximately 805–830 ms per emitted second. No end-to-end or sound-quality claim yet.
- Raw VideoFrame creation and canvas drawing succeeded inside the actual YouTube embed. Use a bounded VideoFrame/canvas delay overlay; no WebRTC or new media service is required.

## Integrated acceptance

- Actual Electron/YouTube MV processing passed: first processed output 4708–4713 ms, video delay 4510–4543 ms on Windows 11 build 26300 / GTX 1650 Ti. A 90-second run retained on status across 179 samples.
- Expanded tests passed pause, seek while paused, resume, search back to Karaoke, key/tempo/reset, original-position restoration and the delayed end tail. Private transport packets and estimates use generation/epoch guards.
- Video buffering uses raw VideoFrame/canvas, capped at 720p/30 fps and 512 MiB; no WebRTC is required. Portable runtime smoke passed without developer Python paths.
- A paired music excerpt was exported locally for diagnostics. Output is finite and non-silent, with no clipping in the measured excerpt; timing correlation is not a separation quality score. Human full-mix listening and Windows 10/device acceptance remain unverified.
- Release gates were subsequently completed; see final acceptance below.

## Review and packaged local validation

- Fresh independent read-only review found one Important issue: an ENDED tail timer could advance after same-item restart/seek/PLAYING. Three real component regressions failed before cancellation was added to each transport entry point, then all three passed. An actual packaged MV integration additionally seeks back during the delayed tail and verifies the old timer does not advance.
- Installer 0.1.5 built successfully (unsigned). Packaged Python/DirectML/model runtime smoke passed from resources/vocal, with denoise active. Packaged Electron against local Player passed expanded live AI/pause/paused-seek/tail-restart/end tests, initial output 4713 ms and video 4524 ms. Toolbar fits both 1440px and 960px while AI is on.

- Final repository suites: 79 root tests, 40 desktop tests and 7 Python tests passed; focused lint and production Next build passed. Packaged baseline key/tempo and native Thai keyboard-focus regressions passed. Packaged search/queue-persistence smoke also passed.
- GitHub main 15957f1 automatically deployed compatible Player to https://karaoke-hub-nu.vercel.app/player; Vercel dpl_4UgTGCtfq1E8MeX9g7TfDVNDvFHR READY. Production initial AI measurements were 4701–4704 ms; screenshot automation was corrected to identify the shell by its exact URL and restore a minimized test window. Original-position assertion now accounts for normal source progression while awaiting the off command, rather than treating legitimate elapsed playback as a seek jump.
- Portable runtime manifest stores a relative Python location, excluding the developer installation prefix. Installer is being rebuilt with that metadata cleanup before final production acceptance.

## Release acceptance complete

- Rebuilt 0.1.5 installer passed standalone packaged GPU runtime smoke with the relative manifest, then actual packaged production MV acceptance: first processed output 4704 ms, video 4502 ms. Extended coverage passed pause/seek/resume, search independence, key/tempo controls, keyboard focus, original restoration with elapsed-time accounting, seeking back during the tail, and final delayed MV completion.
- Production AI screenshots inspected: live video is visible and toolbar controls fit at 960px and 1440px. Earlier 90-second continuous dev acceptance remains the long-run evidence; no human listening, Windows 10, sleep/resume or Bluetooth/HDMI claim is made.
- Installer SHA256: E9E7B7FD90ABFC7B1985C67DABD7D14B9F639B8CCE90D08BB1B653035D69AFB1. Stable release path: D:/karaoke/build/desktop/0.1.5/KaraokeHub-Setup-0.1.5-x64.exe.
