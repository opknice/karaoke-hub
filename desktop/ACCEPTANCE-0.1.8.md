# Desktop0.1.8 acceptance — 2026-10-31

Actual host: Windows11 build26300 / NVIDIA GTX1650Ti4GB. Windows10/11x64 remain targets; this session does not certify other hosts. The installer is unsigned. Tests use isolated application profiles without replacing the user's installed app.

## Behavior and verification

Vocal level uses the existing aligned estimate: delayedOriginal − (1 − level/100) × estimatedVocals while enabled. The fixed-size eight-second timeline and both exact models/recipes are unchanged. Level0 means maximum available removal,100 original vocal level; the mixer does not apply a master-volume change. A20ms target ramp smooths changes. App-session selection starts at0 and survives on/off, model/track changes, pause and seek. Original continues during preparation/failure.

Root102/102, Desktop107/107 and focused ESLint passed after final review fixes. No hosted/worker source changes required a new local Next/Python build. Existing hosted skip fix remains compatible.

Real AudioWorklet fixture with independent stereo vocal/instrumental signals checked532,129 stable frames,905,216 active frames, zero errors, maximum absolute error3.2643e-8. It covers0/25/50/75/100, exact source-frame continuity, original/AI changes, new AI epoch and retained pause. This verifies mixing/timing, not subjective separation quality.

Actual source Fast passed endpoints, one-percent buttons, real mouse drag retaining native focus, focus on release, off/on retention, minimum960px layout, model switches without seek/session reset, key/Tempo and final skip silence. HQ passed the same level/layout checks and paused model/level changes with immediate retained original resume followed by AI. Final transport/release evidence follows below.

One fresh whole-branch review found two Important UI races, each reproduced with a failing test and fixed: temporary model/off states discarded the latest pending selection; completion of another toolbar command could steal slider focus. The control now distinguishes live-session retention from temporary enabled state and honors toolbar busy state through native replies. Full suites passed afterward; no review findings were deferred.

Earlier pre-fix QA observed an unexpected9% after a drag/resize/model transition and one stopped capture when entering transport checks; those isolated runs did not establish a precise cause. Final release acceptance must pass the corresponding drag/model/transport cases after the reviewed fixes. Playwright's source mouse fixture explicitly focuses the native shell before dragging, as native keyboard tests do. The960px screenshot covers native chrome; embedded MV state is checked through its real source/video bridge.

## Release evidence

Packaged observations and final installer hash are recorded after the build and actual packaged acceptance. Previous0.1.7 is retained; no silent installation.

## Limits

This is a vocal-gain control, not a new source-separation model. Residual vocals, watery/reverb artifacts and instrumental leakage remain mix-dependent. The agent does not claim subjective full-mix listening certification. Other Windows versions, GPUs, sleep/resume and Bluetooth/HDMI devices need validation on those systems. A100% selection can still keep background inference ready for later reduction; it does not stop the native audio system.
