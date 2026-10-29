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
4. Delay raw video frames inside the trusted YouTube embed using captureStream + VideoFrame processing, then display a video-only overlay inside the embed. Its underlying media remains the source; existing Player UI remains above it. Audio stays in the separate local renderer. Use a common start clock and measure A/V correspondence. Freeze during priming rather than replaying already-heard original audio.
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
