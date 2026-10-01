# KARAOKE.HUB Audio Extension

Internal technical prototype for local, real-time center attenuation and automatic loudness levelling on the `/player` tab.

## Load unpacked

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this `browser-extension` directory.
5. Open `http://localhost:3000/player`.
6. Click the extension action once to start tab audio capture.
7. Press `*` or Numpad `*` to toggle the Balanced Vocal Cut preset.
8. Click the action again to stop capture and return audio ownership to the tab.

After capture starts, press `/` (or Numpad Divide) on `/player` to toggle **AUTO LEVEL**.
Its status appears for 3 seconds, then fades away. The preference is remembered
on this browser. Auto Level measures the post-Vocal-Cut
signal, applies slow gain correction, and uses a safety limiter. The existing
Player Volume and Mute remain the final user controls.

After updating these source files, click **Reload** on the extension card before testing again.

If the player reports a one-channel or low-Stereo-side warning, Vocal Cut remains available. The warning means center attenuation may also reduce centered instruments; it no longer disables the effect automatically.

## Adaptive DSP v0.2

Version 0.2 processes the captured stereo signal with a 1,024-sample STFT center mask instead of one fixed three-band filter. It scores center dominance per frequency bin, preserves Stereo side information, protects transients, and keeps sub-bass outside the vocal suppression band. The audio path has approximately 21 ms of algorithmic latency at 48 kHz.

While Vocal Cut is on, choose one of these levels on `/player`:

- **Balanced** — gentler center suppression and strongest transient protection.
- **Strong** — deeper vocal reduction with a larger effect on centered instruments.
- **Maximum** — most aggressive; intended for difficult tracks and near-mono experiments.

The selected level is stored with submitted per-video feedback. No level can reliably separate a truly mono vocal from mono instruments without a source-separation model.

## Auto Loudness v0.3

Version 0.3 adds a separate streaming loudness processor after Vocal Cut:

- Targets approximately `-16 LUFS-like` after a short warm-up.
- Limits automatic gain to `-12 dB` / `+8 dB`.
- Holds gain during silence so quiet intros do not raise the noise floor.
- Attenuates loud tracks faster than it boosts quiet tracks to avoid pumping.
- Corrects measurements for the Player Volume setting, so Auto Level does not
  fight intentional volume changes.
- Uses a final peak limiter as protection against clipping.

`LUFS-like` is a real-time listening aid, not a certified broadcast loudness measurement.

The extension is intentionally limited to:

- `http://localhost:3000/player`
- `https://karaoke-hub.vercel.app/player`

Add an exact production/custom origin to `host_permissions` and `content_scripts.matches` before testing another domain. Do not replace these with `<all_urls>`.

## Privacy

- Audio stays in the browser audio graph.
- Audio is not recorded, uploaded, or persisted.
- Per-video feedback is stored in `chrome.storage.local`.

## Prototype policy gate

This prototype modifies captured playback audio. Do not publish it or enable it in production until the intended use has passed a YouTube API policy/compliance review.
