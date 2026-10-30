# Desktop 0.1.6 acceptance — 2026-10-30

Host: Windows 11 build 26300, NVIDIA GTX 1650 Ti 4GB. Targets remain Windows 10/11 x64. Installer is unsigned. Tests launch an isolated profile and do not replace an installed/running user application.

## Implementation and release

Fast retains UVR_MDXNET_Main, 4.5-second buffering and the five-second startup gate. Optional Instrumental HQ5 uses sign-denoise, normalized overlap-add, eight-second buffering and bounded compressed 720p/30 video. Both exact model hashes and runtime resources are checked before packaging. Model selection is native-only and locally persisted; new installs default to Fast.

Final product commits include 42e0b7b (no stale playing echo on delay-only changes), 397ffa9 (first delayed video frame may arrive within the existing startup deadline), and c580147 (resume preflight in long acceptance). The two timing regressions were reproduced by failing tests before fixes. No model quality settings or steady-state latency bounds were relaxed.

Root tests: 88/88. Desktop tests: 67/67. Python: 11/11. Focused ESLint, Next production build and NSIS build passed. Fresh independent whole-branch review found no Critical, Important or Minor issues; acceptance subsequently found the two timing cases above, each covered by RED→GREEN regression evidence.

## Packaged observations

- Real portable GPU streaming passed for both exact bundled models, including denoise.
- Final packaged production Fast: first output 4714 ms; delayed video 4508 ms. Live Fast/HQ switching, paused switching/wait-for-Play, Stop during preparation, key/one-percent tempo preservation, original-position restoration and real relaunch persistence passed.
- Final packaged native keyboard/focus: Down selects HQ, focus returns to search, Thai typing/caret preserved; slow audio/reload and modal/lyrics exceptions passed.
- Final packaged production HQ: first output 8220 ms; delayed video 8024 ms. Continuous 300 seconds passed (595 status samples), including a successful pause/seek/resume before the run; max encoded 7,709,286 bytes / 201 packets, sampled encode/decode queues 1/0, max Electron working sets 1,807,312 KiB. Subsequent paused seek/resume, original restoration, same-item restart during the tail, final delayed MV completion and real relaunch persistence passed.
- Earlier five-minute HQ run completed 595 status samples, max encoded 7,619,461 bytes / 201 packets, sampled encode/decode queues 1/0 and max Electron working sets 1,758,872 KiB. Its subsequent resume check exposed the first-frame race fixed in 397ffa9; that candidate is archived and is not the final installer.
- Earlier HQ worker memory sampling: 27 samples, working set 394,502,144–443,895,808 bytes; private allocation 1,714,286,592–1,762,869,248 bytes. These include runtime/GPU allocations and are observations, not a universal RAM guarantee.

## Quality and scope decisions

The actual packaged HQ pipeline was compared against the exact HQ5 float reference used for user-selected listening sample B: 19.165 seconds, RMS error 1.85e-9, SNR 153.41 dB. This verifies recipe preservation. A 21.90-second aligned original/instrumental recording was also captured. The agent does not claim subjective listening quality; other mixes may still have residual vocals, watery/reverb artifacts or affected instruments.

Windows 10, other GPUs and Bluetooth/HDMI device changes were not certified by this Windows 11 session. Device-specific performance/compatibility requires validation on that hardware before broader rollout. Model loading is separate from the measured activation latency.

Final installer: KaraokeHub-Setup-0.1.6-x64.exe, 312,950,336 bytes.
SHA256: EAEBE07B9C33B4B442430DEC2BFDF424E104280442EFE8364C5D33F33B1E2D6E.
Previous 0.1.5 remains unchanged. The final installer is copied to D:/karaoke/build/desktop/0.1.6 with matching hash and use instructions.
