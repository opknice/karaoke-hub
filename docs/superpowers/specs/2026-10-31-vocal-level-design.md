# Vocal level 0–100% — approved short design

Approved by the user on2026-10-31: พัฒนาได้.

## Intent and agreed scope

The user wants to reduce/restore only the singer in Vocal Remover, with a confirmed range of 0–100%. Zero means maximum available removal; 100 means original vocal level, without boosting. Both existing Fast and HQ5 models remain. Processing stays local and MV-only.

## Approach

Use the existing time-aligned vocal estimate and retain the original timeline: `output = delayedOriginal - (1 - vocalLevel / 100) * estimatedVocals` while removal is enabled. This is the proposed implementation choice. It reuses the existing inference; changing the level must not reload a model, restart capture, seek, clear the buffer or add a new playback delay. Changing model strength/reprocessing or applying master gain would respectively change separation quality/cost or the whole mix, so those approaches do not fit the requested control.

## Proposed controls and defaults

- Add a compact native **เสียงร้อง** slider, percentage readout, and minus/plus buttons stepping one percentage point, near the existing model controls without increasing the fixed toolbar height.
- Initial selected level is **0%**, preserving today's Vocal Remover behavior. Keep that selection during on/off, track and model changes in the current app session; a new app session starts at 0%. These are proposed defaults, not additional user requirements.
- Turning removal off restores original music (effective 100%) without losing the selected level. Turning it back on applies the selected level. The level control is enabled for active/pending removal on an eligible prepared MV; while AI prepares or fails, original music continues.
- Smooth coefficient changes over approximately 20ms at the same stereo sample position. The level is a linear mixing percentage, not a promise of perceptually equal loudness steps or perfect stem isolation.
- Return keyboard focus to song search after a click or completed slider adjustment. Do not interrupt dragging/keyboard adjustment or steal focus from a modal/lyrics field. Coalesce rapid input to the latest value with bounded pending work and reject stale replies.

## Boundaries and verification

Keep both model weights/recipes, eight-second MV startup buffer, pitch/Tempo, natural song-end tails and the explicit skip/source-stop fix. Preserve full dry playback and existing buffered transport through pause/resume, seek, model preparation and failure. Validate integer levels 0–100 at native/engine boundaries; no remote filesystem/model capabilities.

Test 0/25/50/75/100% against separate tagged instrumental/vocal signals, unchanged instrumental contribution and correct stereo/frame alignment; smooth transitions, no raw/session reset, bounds/nonfinite input, stale commands, off/on, model changes, paused updates and failure fallback. Verify native controls/focus and actual Fast/HQ MV use, including skip silence. This native feature requires a new installer (proposed 0.1.8), retaining 0.1.7. Do not claim improved subjective AI separation quality from this gain control.
