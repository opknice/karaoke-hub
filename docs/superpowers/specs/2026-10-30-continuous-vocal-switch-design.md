# Continuous original / Vocal Remover switching

Date: 2026-10-30. User-approved behavior: original music continues while AI prepares; switching must follow the same musical position with no rewind, gap or tempo alteration. User explicitly accepted preparing an approximately eight-second buffer before each MV. Existing Fast and HQ5 remain selectable. Technical choices below are implementation choices, not additional claims of user selection. Fresh builder check: nothing important left requiring a user answer; its six interface seams are explicitly covered below and in the plan.

## Approach and scope

Selected: use one eight-second playback timeline for original audio, separated audio and video from MV startup. Prepare the selected AI model in the background even when removal is off. A removal toggle changes only the contribution of time-aligned estimated vocals. Rejected: playing unbuffered original then switching to delayed AI repeats an already-heard passage; a crossfade alone cannot remove this time discrepancy. Reading future YouTube audio or adding a second hidden YouTube player is not part of this design.

Eight seconds is the shared delay for BOTH Fast and HQ5 in this new native path. This supersedes Fast's 4.5-second buffer for prepared MVs, while preserving its model/recipe. The initial delay is paid when a new MV timeline starts, not on each removal toggle. Model loading and network startup are separate. Default new-install model remains Fast and local choice persists. Browser-only and older native clients retain their existing behavior.

## Playback session versus AI stream

A native MV playback session owns a fixed-capacity stereo raw audio delay and compressed video queue. It stays active while removal is off, loading, switching or failed. A separately revocable AI epoch owns model processing, result weights and requested removal intent. Result timestamps are mapped into the session's absolute captured-frame counter. Changing AI epoch never clears or rewinds the raw/video session.

A new continuous worklet buffer uses a 12-second fixed capacity at 44100 Hz, an eight-second read offset and bounded one-second PCM packets. Begin AI at the current captured frame, send relative packets starting zero, and map each returned span back using that epoch's base. Preserve old Fast overlapping spans and HQ finalized disjoint spans. Continue feeding the selected ready worker while removal is off. The audible position is always capturedFrame minus eight seconds.

On toggle, use a 20ms linear ramp of estimated-vocal subtraction at the SAME source frame: output = delayedOriginal - mix * estimatedVocals. Correlated original/instrumental signals do not use an equal-power summing boost. While estimates are not ready, keep delayed original playing and show preparation. Never output silence or seek to create the transition. On successful fade completion publish removal on; on missing/late results preserve delayed original and report AI unavailable. Initial first matching result has a bounded ten-second deadline after processing starts; a failed worker cannot leave a pending toggle forever.

Model changes fade to delayed original, revoke only the AI epoch, terminate the previous worker and prepare the selected worker. Its new stream begins at the then-current captured frame. Requested reactivation requires matching session, queue, selection and uncancelled intent. Stop, reload and new track revoke it immediately. Preserve key/tempo and search focus.

## Native preparation before source playback

Add a static preload capability flag and a fixed typed PREPARE_PLAYER_TRACK message containing only video ID, queue item ID and version type. The hosted YouTube Player awaits this native preparation before initial load/play and each queue-item load. Token/ref checks prevent a stale preparation response from loading an old item. The capture host starts in buffered/held mode before source audio begins, preventing an unbuffered audible leak. Preparation is two-phase: arm capture/held audio before source load, then attach video only when matching media is ready/playing. Preparation must not wait for model warmup; slow AI cannot block normal buffered original indefinitely. Request failure is bounded and restores ordinary playback with an explicit unavailable state.

For MV, native preparation starts capture automatically unless the user explicitly stopped the audio system. Preserve Stop as a session-wide opt-out until the user presses Start again; do not re-enable it on the next song. Navigation/reload/failure cleanup must not latch the user Stop opt-out. Manual Start on an unprepared current MV establishes the initial eight-second timeline with explicit preparing status. This initialization is distinct from a removal toggle. Karaoke is prepared without an MV buffer and retains existing pitch/tempo/manual capture behavior. Strict sender/main-frame/origin checks and capture of only the trusted Player remain; no microphone, system loopback, remote model/path grants, audio uploads or database changes.

## Transport and completion

Pause retains raw audio history, AI history and encoded video packets; freeze their logical playback clock. Resume continues the retained timeline without rewinding. Extend the encoded queue with pause/resume scheduling and a frozen logical clock so no decoder frames advance while paused and retained packets do not grow. Decoder outputs already in flight are retained in a bounded four-frame holding queue, not discarded while paused. Seek/restart explicitly starts a new session generation and rebuilds the eight-second timeline at the requested media position; old audio, frames and completions are revoked.

Video uses the existing bounded compressed 720p/30 path for BOTH models (64MiB,512 packets,4 pending encode/decode operations). Removal/model switches do not recreate video. A codec failure is a playback-session failure with explicit recovery, not a silent AI success.

The hosted completion delay is eight seconds whenever a verified matching continuous MV buffer is active, even with removal off. Validate the new native capability/session state and matching queue; keep old Fast/HQ rules for older clients. UI playback time should follow the displayed frame timestamp rather than subtracting a fixed media-time amount, because tempo can change during the eight-second buffer. Delayed original and instrumental tails both finish before advancing; genuine seek/restart/new queue cancels old completion. A user pause during the delayed tail retains remaining completion time; resume continues the tail without restarting the ended YouTube source.

## UI and release

Show initial MV preparation, original playback while preparing AI, active removal, model preparation and failure distinctly. Toggle off retains buffered original; Stop releases capture. Keep native keyboard/Thai search focus and modal/lyrics exceptions. Do not expose implementation details beyond decisions the user needs.

Target desktop0.1.7 plus compatible hosted Player. Preserve0.1.6 and original checkout changes. Validate exact model resources and final installer hash; no silent install over a running user app. Actual host Windows11/GTX1650Ti only; do not infer Windows10/other hardware acceptance.

## Acceptance

- Exact timestamp-tagged signal tests: after initial eight-second buffer, dry and AI changes never duplicate, skip or zero source frames; 20ms ramps use the same frame and preserve stereo/key/tempo.
- Worker loading, failure and rapid Fast/HQ changes leave delayed original running, with finite pending intent and no stale AI result accepted.
- Pause/resume retains current musical position; seek/restart/queue changes invalidate old epochs; removal/model toggles never seek or reset raw/video.
- Native preflight before playback, late preparation responses, Stop during preparation and capture failure never leak or start an old track.
- End-of-track with removal off/on/pending and toggles during the tail completes once, with eight-second audible tail and no stranded queue.
- Real packaged production tests for both models, native keyboard/focus, original/wet transitions, pause/seek, model switches and at least five minutes bounded continuous processing. Capture transition audio and inspect for gaps; automated tests do not establish subjective quality on every mix.
