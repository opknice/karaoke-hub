# KARAOKE.HUB Windows Player

Electron app targeting Windows 10 and Windows 11 **x64**. The local toolbar adds key and tempo controls to the existing hosted `/player`. No browser extension is installed. YouTube, room and search services still require internet.

## Install and use

Build output: `dist/KaraokeHub-Setup-0.1.7-x64.exe`. Run the installer, open KARAOKE.HUB, select an MV in the normal Player. The app automatically prepares its eight-second playback buffer and the selected AI model. If you previously stopped the audio system, click **เปิดระบบเสียง** to prepare it again. The unpacked executable is `dist/win-unpacked/KARAOKE.HUB.exe`; keep its adjacent files together.

- Key: -6 to +6 semitones, one semitone per click.
- Tempo: one percentage point per click, for example 125% → 126% or 125% → 124%, within 25%–200%. The normal rate is 100%. Page Up/Down use the same one-percent step when not editing search. The app sets the trusted Player's HTML media rate directly and verifies the accepted rate instead of jumping through YouTube's discrete API presets.
- **คืนค่าเดิม** resets key and tempo without restarting the song.
- **หยุดระบบเสียง** releases capture and returns audio playback to the original Player.
- Key resets when the video changes. Audio settings are local and not written to the room database.
- F11 toggles fullscreen; **โหลดใหม่** recovers from a page/network failure.
- Select **Karaoke** or **MV / เพลงปกติ** at the top left to change search results. Karaoke keeps its catalog-first search; MV searches normal music videos. Search modes use separate caches. Each queued item retains its own version, including after a reload.
- Toolbar buttons return keyboard focus to song search immediately and after the action completes. You can continue typing Thai without clicking the search box, including while audio is connecting. Open dialogs and lyrics editing retain their own input; closing them returns to song search. Background status polling does not capture focus or activate another app window.
- Changing search mode does not replace or stop the playing MV. **Vocal Remover** changes between original and separated audio on the same prepared timeline. Original music continues while AI prepares or a model changes; removal toggles do not seek, rewind or rebuild the playback buffer. Pause/resume retains the buffered position. Explicit seek/restart rebuilds the initial buffer at the requested position. Both original and separated musical tails finish before the next queue item, including a pause during the tail.

This installer is **unsigned**, because no publisher signing certificate is configured. Do not describe it as a signed release. The application retains the framework's default icon in this version.

Choose **เร็ว (เดิม)** for the original Fast model or **คุณภาพสูง · HQ5** for the Instrumental HQ5 model selected in the listening trial. Fast is the default on a new installation; your choice is remembered locally. Switching while enabled returns to the time-aligned buffered original while the selected model prepares, then resumes removal for the same MV. Switching while paused waits for Play. **หยุดระบบเสียง** releases the session and keeps automatic preparation off for the remainder of that app session until you press Start. Cleanup/reload does not itself create a user Stop opt-out.

Vocal removal runs entirely on this computer with the two bundled UVR MDX models and DirectML runtime; end users do not install Python. A sufficiently fast DirectX 12 GPU is required. The app measures GPU throughput before enabling the feature and restores original playback with an error if processing misses its deadline. Initial model warmup is separate from playback preparation. In version 0.1.7, **both models share an eight-second original/audio/video buffer from MV startup**. This replaces the previous Fast 4.5-second buffer for prepared MVs. After the initial preparation, a ready model changes the vocal contribution with a 20ms ramp at the same sample position. If AI is still preparing or fails, buffered original music continues. Video uses bounded compressed storage up to720p/30fps. Manual Tempo changes propagate through the playback buffer; one-percent steps and native pitch preservation remain. Separation quality depends on the mix and can leave residual vocals or affect instruments.

## Development

Use Node 24 LTS and run from this directory:

```powershell
npm ci
npm start
npm test
npm run test:electron
npm run test:hosted
npm run dist
```

`test:electron` launches the real app against a local, stereo 440 Hz WAV fixture. It checks selective capture, measured output frequencies, exact 125% → 126%/124% native media rates, percentage display, one-percent keyboard steps, pitch preservation, reset, removed effect buttons/commands/shortcuts, stop/restart, invalid parameters and reload. `test:hosted` checks production Player boot/search input; `node tests/hosted-smoke.cjs --play` additionally uses an isolated test room, selects a real catalog song and reads back actual YouTube media rates while testing key/tempo changes. `node tests/search-versions-smoke.cjs` checks actual MV search, queued metadata across reload, uninterrupted MV audio when switching search back to Karaoke, and eligibility ending with the track (defaults to local port 3001; override `KARAOKE_PLAYER_URL` for production).

`node tests/focus-smoke.cjs` checks native keyboard delivery after selector/audio/reload actions, including a deliberately delayed audio connection, QR dialog closing and lyrics input. It sends Thai characters to the currently focused webContents without using a locator to focus the search box.

For local web development only:

```powershell
$env:KARAOKE_PLAYER_URL = 'http://127.0.0.1:3000/player'
npm start
```

Only the production origin `https://karaoke-hub-nu.vercel.app/player` and explicitly configured HTTP loopback origins are accepted. A configured loopback site receives the same restricted audio bridge; use a server you control. The packaged default always points to production. No `.env.local`, service-role keys, server source or user profile is packaged.

Before packaging, copy `.vocal-build.example.json` to ignored `.vocal-build.json` and supply local build input paths. `prepare:vocal` stages isolated CPython 3.12, NumPy 2.2.6, SciPy 1.15.3, onnxruntime-directml 1.24.4 and both exact SHA256-verified models listed in `vocal/models.json` (supply `model` and `hqModel` paths) into ignored `vocal/runtime`. Packages retain their license notices. The installer bundles these files as resources; developer paths/config are excluded.

`KARAOKE_VOCAL_MODEL=fast` or `hq5` selects the profile in native smoke tests. `node tests/vocal-runtime-smoke.cjs` validates the real portable GPU worker. Set `KARAOKE_VOCAL_ROOT` to packaged `resources/vocal` to test shipped resources. `node tests/vocal-remover-smoke.cjs --extended` checks a real MV, the selected profile startup deadline, search independence, pause/seek, original restoration and delayed track end. `--switch --persistence` checks live/paused model changes, cancellation and a real relaunch. `--long` adds 90 seconds of continuous processing; `KARAOKE_VOCAL_LONG_SECONDS=300`, a sufficiently long `KARAOKE_VOCAL_QUERY` and optional `KARAOKE_VOCAL_START_SECONDS` enable a five-minute run with encoded queue/memory metrics. `--record` saves aligned original/instrumental diagnostics using the selected profile delay. `KARAOKE_EXECUTABLE` selects the packaged executable; `KARAOKE_PLAYER_URL` selects the trusted local/production Player. `node tests/continuous-vocal-smoke.cjs --switch --extended --record` verifies the new prepared MV path and captures transition diagnostics. `--long` with `KARAOKE_VOCAL_LONG_SECONDS=300` and a sufficiently long `KARAOKE_VOCAL_QUERY` exercises original/AI transitions in a bounded five-minute run. `node tests/continuous-audio-smoke.cjs` runs a real AudioWorklet timestamp/stereo fixture; its generated module is removed afterwards and excluded from packaging. Run hardware timing tests separately from builds.

`prepare:assets` copies only the shared pitch processor core from `../browser-extension` into ignored `audio/assets` and deletes known generated assets from older effect-enabled builds. Both test and packaging scripts regenerate it. The desktop pitch adapter applies only the requested semitone ratio to captured PCM; it does not apply inverse-tempo compensation on top of Chromium's native pitch-preserving media playback. The existing measured phase vocoder is reused; SoundTouchJS is not a runtime dependency in this version.

Version 0.1.1 removes Vocal Cut and Auto Level from the desktop toolbar, command handlers, audio graph and packaged assets. The legacy hosted Player's effect shortcuts are suppressed in this app. The bridge retains false compatibility flags so hosted pitch/tempo controls still work. Existing website and browser extension sources are separate and are not changed by this desktop release.

## Audio and security boundaries

The trusted Player is a sandboxed, context-isolated WebContentsView with Node disabled. A different local renderer captures its webContents via Electron's display-media handler with local echo disabled. Processed audio is emitted by that local renderer, never the capture source. System loopback and microphones are never requested. Capture and IPC grants require the expected sender's main frame and exact URL. Privileged content remains in local packaged files. The remote bridge accepts only the existing fixed Player audio messages.

The hosted website is not deployed by building this desktop app, and its existing APIs/queue schema remain in place. Shipping a new installer is separate from deploying the website.

Prior release measurements: [0.1.6 acceptance](ACCEPTANCE-0.1.6.md). Version0.1.7 measurements will be recorded in its acceptance report.

## Acceptance limits

Windows 10 and 11 are target platforms, not two inferred test results. Record the actual test host and installer smoke-test results in the implementation plan. Automated sine measurements and non-silent playback do not substitute for listening to full music mixes. Before broad distribution, test sound quality, long sessions, laptop sleep/resume and output-device changes on both Windows versions, including the intended Bluetooth/HDMI hardware.
