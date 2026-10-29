# Desktop releases

## 0.1.1 — 2026-10-29

Removed Vocal Cut and Auto Level at the user's request. Their toolbar buttons, effect commands, presets/feedback, AudioWorklet stages, compressor and packaged processor assets are removed. The hosted Player's legacy effect keyboard shortcuts are suppressed inside Electron. Pitch/key adjustment, YouTube-supported speed changes, reset, volume/mute and capture lifecycle remain.

Compatibility flags in the existing hosted bridge remain false; the website and standalone browser extension source are outside this desktop change. Packaging cleans known obsolete generated modules before building.

Verification: 16 desktop unit/signal/lifecycle tests and 70 existing repository tests passed. Desktop lint passed. Real Electron capture tests passed on the development and packaged Windows 11 executables, including absent buttons, rejected commands, suppressed shortcuts, pitch/tempo, reset and stop/restart. Packaged assets contain none of the removed processors. Focused independent review reported no findings.

Installer remains unsigned. Windows 10 compatibility and full-mix listening/device acceptance still require testing on the intended hardware.
