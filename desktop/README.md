# KARAOKE.HUB Windows Player

Electron app targeting Windows 10 and Windows 11 **x64**. The local toolbar adds key and tempo controls to the existing hosted `/player`. No browser extension is installed. YouTube, room and search services still require internet.

## Install and use

Build output: `dist/KaraokeHub-Setup-0.1.0-x64.exe`. Run the installer, open KARAOKE.HUB, select a song in the normal Player, then click **เปิดระบบเสียง**. The unpacked executable is `dist/win-unpacked/KARAOKE.HUB.exe`; keep its adjacent files together.

- Key: -6 to +6 semitones, one semitone per click.
- Speed: previous/next YouTube-supported rate; the toolbar shows the rate acknowledged by the Player. Page Up/Down also work in the Player when not editing search.
- **คืนค่าเดิม** resets key and tempo without restarting the song.
- **หยุดระบบเสียง** releases capture and returns audio playback to the original Player.
- Vocal Cut and Auto Level use local AudioWorklets. Key resets when the video changes. Effects/preferences are local and not written to the room database.
- F11 toggles fullscreen; **โหลดใหม่** recovers from a page/network failure.

This first installer is **unsigned**, because no publisher signing certificate is configured. Do not describe it as a signed release. The application retains the framework's default icon in this version.

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

`test:electron` launches the real app against a local, stereo 440 Hz WAV fixture. It checks selective capture, measured output frequencies, native pitch-preserving speed changes, reset, Vocal Cut/Auto Level, stop/restart, invalid parameters and reload. `test:hosted` checks production Player boot/search input; `node tests/hosted-smoke.cjs --play` additionally creates an isolated room, selects a real catalog song and tests non-silent YouTube playback with key/tempo changes.

For local web development only:

```powershell
$env:KARAOKE_PLAYER_URL = 'http://127.0.0.1:3000/player'
npm start
```

Only the production origin `https://karaoke-hub-nu.vercel.app/player` and explicitly configured HTTP loopback origins are accepted. A configured loopback site receives the same restricted audio bridge; use a server you control. The packaged default always points to production. No `.env.local`, service-role keys, server source or user profile is packaged.

`prepare:assets` copies the existing shared DSP modules from `../browser-extension` into ignored `audio/assets`. Both test and packaging scripts regenerate them. The desktop pitch adapter applies only the requested semitone ratio to captured PCM; it does not apply inverse-tempo compensation on top of Chromium's native pitch-preserving media playback. The existing measured phase vocoder is reused; SoundTouchJS is not a runtime dependency in this version.

## Audio and security boundaries

The trusted Player is a sandboxed, context-isolated WebContentsView with Node disabled. A different local renderer captures its webContents via Electron's display-media handler with local echo disabled. Processed audio is emitted by that local renderer, never the capture source. System loopback and microphones are never requested. Capture and IPC grants require the expected sender's main frame and exact URL. Privileged content remains in local packaged files. The remote bridge accepts only the existing fixed Player audio messages.

The hosted website is not deployed by building this desktop app, and its existing APIs/queue schema remain in place. Shipping a new installer is separate from deploying the website.

## Acceptance limits

Windows 10 and 11 are target platforms, not two inferred test results. Record the actual test host and installer smoke-test results in the implementation plan. Automated sine measurements and non-silent playback do not substitute for listening to full music mixes. Before broad distribution, test sound quality, long sessions, laptop sleep/resume and output-device changes on both Windows versions, including the intended Bluetooth/HDMI hardware.
