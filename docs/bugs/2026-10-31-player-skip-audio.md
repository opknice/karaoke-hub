# Old music after finishing an MV — 2026-10-31

The user reported that finishing the song changed the screen while old music remained audible. The shipped 0.1.7 executable reproduced the issue against production: the native queue was empty and the buffer inactive, but the retained YouTube source was still unpaused/unended at 56 seconds. Earlier smoke checks dispatched End and immediately closed the test app, so they never asserted silence after that action.

The empty-video effect cancelled preparation and returned without stopping the existing iframe. Native teardown then exposed its continuing source. The same source could also play during the next queue item's asynchronous preparation.

The hosted Player now stops the old source explicitly on an empty or replaced selection, clears its active-playing/autoplay identity and cancels empty-queue preparation/tail state. Pause callbacks require a prepared matching queue item and video. This also handles the [documented possible PAUSED result of stopVideo](https://developers.google.com/youtube/iframe_api_reference#stopVideo), without letting the previous source pause the next song.

Regression evidence in `build/verification/skip-stop-2026-10-31`:

- Empty-queue and cancelled-preparation component tests failed before the fix and passed afterward.
- A held-next-preparation regression proved the previous source was not stopped. Review identified its possible stale pause callback; an additional event assertion failed before the guard and passed afterward. Review's minor teardown-coverage gap was also corrected.
- Root 102/102, Desktop 93/93, focused ESLint and Next production build passed.
- Actual packaged 0.1.7 with the corrected local Player passed final-item skipping in original Fast mode and with HQ5 removal enabled: source stopped, native buffer closed, output became silent and stayed silent.
- Final local production run held the next MV's native preparation for 1.5 seconds. The old source was paused during that interval, the next MV started automatically afterward, and skipping that final item stopped the source and left output silent. The harness types into the existing focused search field and waits for the named new result, rather than clicking a potentially stale popular result.

The correction is hosted code; native resources, model weights, installer and keyboard bindings are unchanged. Existing 0.1.7 users load the update using **โหลดใหม่** or reopening the program. No new installer or silent installation is required. The user's confirmed screen transition was the diagnostic trigger; tests exercise the existing End action rather than changing modifier-key semantics.
