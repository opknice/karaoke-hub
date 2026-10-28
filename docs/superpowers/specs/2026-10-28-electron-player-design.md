# Windows Electron Player

The user approved Electron development after choosing Windows 10 and Windows 11 and discussing an extension-free Player with independent key and speed controls.

## Goals and approach

Ship a Windows x64 installer and an unpacked app. Reuse the hosted `/player`, room, search, mobile queue and backend. Internet remains required for YouTube and room services. Keep the existing website working unchanged.

Use a local, sandboxed Electron shell with a toolbar and a separate WebContentsView for the trusted Player origin. A separate local audio renderer captures **only the Player webContents**, with local echo disabled, and plays the processed signal. Never capture system loopback. Expose narrowly validated IPC through context-isolated preload scripts; remote content has no Node access. Restrict navigation and capture grants to the intended contents and origin. No server credentials are bundled.

The alternatives considered were Electron (chosen by user: reuse JavaScript and existing Player) and C#/WebView2 (more Windows-specific integration and a second language).

## Controls and audio

- Key: -6 through +6 semitones, whole steps, reset to zero on video change.
- Tempo: existing Player Page Up/Page Down actions, using actual YouTube-supported rates; show acknowledged rate, provide reset without restarting the song.
- Key uses duration-neutral DSP on the captured PCM. Do not apply the extension's inverse-speed correction blindly: Chromium media playback can already preserve pitch. Verify captured media speed and pitch together with a controlled audio fixture.
- Reuse existing Vocal Cut and loudness DSP assets without duplicating source; package generated copies. Evaluate the existing phase vocoder on actual PCM before adding another DSP dependency. SoundTouchJS remains an alternative if measurements/listening show the current engine is inadequate.
- Explicit Start/Stop audio controls, useful failure state and retry. Stop releases tracks and restores original Player audio. Capture failure or Player navigation stops processing, resets key/speed capability, and never leaves two outputs running.
- The app remembers window geometry only if implemented safely; no new persistent song/key or room schema in this version. Vocal Cut and Auto Level remain local to this app.

## Delivery and verification

Unit tests cover trust boundaries, parameter validation, audio lifecycle races, timeout/late replies, track reset and key signal measurements. Electron integration tests exercise actual cross-webContents audio capture with a synthetic media fixture, positive and negative key changes, rate changes, stop/restart, and navigation rejection. Test the real hosted Player boot. Build an unpacked app and installer, smoke-test the packaged app. Report Windows versions actually tested; do not infer a Windows 10 test from a Windows 11 host.

Actual YouTube playback, arbitrary songs, Bluetooth/output changes, full-mix sound quality and performance on both target OS versions remain manual acceptance checks unless performed during this run. Signing requires a publisher certificate and is not implied by building a local installer. Do not publish or deploy the website as part of this task.
