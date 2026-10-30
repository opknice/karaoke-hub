# Desktop releases

## 0.1.7 — 2026-10-30

Prepared MVs now share an eight-second original/audio/video timeline for both Fast and HQ5. The selected model runs in the background while original music plays. Vocal Remover switches by a 20ms time-aligned subtraction ramp, with no seek, rewind or fresh playback delay on a toggle. Original music continues during model loading, model changes and AI failure.

Native preflight arms capture before source playback; bounded request cancellation prevents late preparation from reviving old capture. Pause/resume retains audio and compressed video history. Explicit seek/restart rebuilds the timeline. Original and AI tails both finish before advancing, and a paused tail resumes its remaining duration without restarting YouTube. Progress follows displayed-frame timestamps, including Tempo changes. Stop remains opted out until Start in the current app session.

Both exact model weights/recipes, MV-only eligibility, local processing, key/one-percent Tempo and Thai keyboard focus are retained. Browser-only and older native clients retain their existing playback path. Initial model loading is separate from the eight-second startup buffer.

## 0.1.6 — 2026-10-30

Added an optional **คุณภาพสูง · HQ5** model alongside **เร็ว (เดิม)**, which remains the default for new installations. The selected model is saved locally. HQ5 uses Instrumental HQ5 with sign-denoise and normalized overlap-add, an eight-second audio buffer and bounded compressed 720p/30 video. Fast retains the original model and 4.5-second buffer.

Switching restores original playback while the selected model prepares and resumes only for the same playing MV and active intent. Paused switching waits for Play; Stop cancels pending resumption while keeping the chosen model. Stale worker/video callbacks are revoked, and profile-aware delayed completion preserves the final musical tail. Both verified models and the isolated runtime are included in the installer.

Final packaged production acceptance on Windows 11 / GTX 1650 Ti measured Fast first output at 4.714 seconds and HQ5 at 8.220 seconds. HQ5 completed five minutes of continuous processing, plus pause/seek/resume, delayed MV completion and relaunch persistence. Automated tests cover model identity, bounded streaming/video, switching, pause/seek, cancellation, focus and delayed completion. The user selected HQ5 in the listening trial; separation quality still depends on the mix. Detailed measurements and limits are recorded in ACCEPTANCE-0.1.6.md.

## 0.1.5 — 2026-10-29

Replaced the disabled Vocal Remover placeholder with local UVR MDX source separation on a validated DirectML GPU. It works only for the playing MV, continues when search switches to Karaoke, and stops when that MV ends. Audio and video share a 4.5-second buffer; delayed video is capped at 720p/30 fps. Pause and seek invalidate old results, resume re-primes the buffer, and disabling restores the displayed position. Missed deadlines restore original playback and report an error.

The installer includes an isolated Python/ONNX runtime and verified model, with no audio uploads or separate Python installation. Initial model warmup and measured hardware readiness gate the button. Existing key, one-percent tempo and keyboard-focus controls remain.

Development acceptance on Windows 11 / GTX 1650 Ti measured first processed output at approximately 4.7 seconds and passed 90 seconds of continuous live processing, plus pause/seek/resume and delayed track end. Automated finite/non-silent output and timing checks do not establish subjective separation quality on every mix or compatibility with all Windows 10/11 hardware.


## 0.1.4 — 2026-10-29

Fixed keyboard focus after toolbar buttons. The trusted native shell restores the Player view and song-search input immediately when a command is accepted, and again after completion/reload. Slow audio initialization therefore does not discard typing. Existing query text and caret are retained. Open QR dialogs and lyrics entry keep their focus; closing them restores search. Status polling never requests focus, and background windows are not activated.

The real Electron focus regression was reproduced before the fix and passed after it, including native Thai character delivery, delayed audio initialization, selector/audio/reload, modal closing and lyrics input. The review's delayed-command finding was separately reproduced and fixed with a failing-then-passing test. Pitch and one-percent tempo behavior are unchanged.

## 0.1.3 — 2026-10-29

Added the top-left Karaoke / MV selector in Electron and the browser Player. Karaoke retains catalog-first search. MV uses a separate music-video search and cache, excludes known karaoke/backing-track titles, and never saves results into the Karaoke catalog. Cache keys preserve video-ID case and fit the existing database limits.

Queue metadata retains the selected video's version. Changing the search mode back to Karaoke leaves the playing MV and captured audio running. Vocal Remover eligibility follows the playing queue item until it ends; it does not follow the search selector. Actual AI source separation is not implemented: the Vocal Remover button remains disabled and readiness remains false pending the quality and <=5 second latency gate. Key and one-percent tempo controls remain.

## 0.1.2 — 2026-10-29

Tempo +/- and Page Up/Down now change by one percentage point per operation. The toolbar displays percentages (normal = 100%); 125% increases to 126% or decreases to 124%. Existing 25%–200% limits remain, and reset returns directly to 100% without restarting the song.

The native transport controls only the trusted Player's YouTube embed (including the initially empty `/embed/` document populated by the IFrame API), or explicit loopback test media. It verifies the actual HTML media playback rate and enables native pitch preservation. Commands are serialized to accumulate rapid requests and ignore late acknowledgements after Stop. No Extension, system capture, remote Node access or removed effects are added.

Verification: 23 desktop tests and 70 repository tests passed, desktop lint passed, and the real Electron fixture measured preserved pitch at fractional speeds and checked exact 125% → 126%/124% media rates. The packaged app's hosted test read back those rates from an actual YouTube song and verified the stable percentage display. Independent review reported no Important/Critical findings; its Shift+Page Up/Down navigation note was reproduced in the real Electron test and fixed (RED→GREEN). Modified Page keys and active search editing retain their normal behavior.

## 0.1.1 — 2026-10-29

Removed Vocal Cut and Auto Level at the user's request. Their toolbar buttons, effect commands, presets/feedback, AudioWorklet stages, compressor and packaged processor assets are removed. The hosted Player's legacy effect keyboard shortcuts are suppressed inside Electron. Pitch/key adjustment, YouTube-supported speed changes, reset, volume/mute and capture lifecycle remain.

Compatibility flags in the existing hosted bridge remain false; the website and standalone browser extension source are outside this desktop change. Packaging cleans known obsolete generated modules before building.

Verification: 16 desktop unit/signal/lifecycle tests and 70 existing repository tests passed. Desktop lint passed. Real Electron capture tests passed on the development and packaged Windows 11 executables, including absent buttons, rejected commands, suppressed shortcuts, pitch/tempo, reset and stop/restart. Packaged assets contain none of the removed processors. Focused independent review reported no findings.

Installer remains unsigned. Windows 10 compatibility and full-mix listening/device acceptance still require testing on the intended hardware.
