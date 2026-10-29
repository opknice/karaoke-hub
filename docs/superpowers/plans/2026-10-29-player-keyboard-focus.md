# Player keyboard focus repair

User requirement: after pressing a button, return to normal song typing without clicking the search box. Preserve ongoing playback and existing query text.

Root cause: the Electron toolbar and Player are separate webContents, and the Player had no explicit focus handoff from native commands. Its dialog click exclusion also prevented focus recovery after closing a modal.

Fix: after validating a trusted shell sender, restore the active Player view and send a fixed unprivileged focus event before and after toolbar commands. Exclude REQUEST_STATUS polling. Check that the window is active and the Player URL remains trusted; do not activate a background window. The Player applies focus after UI updates, unless a modal or lyrics editor remains open. Closing a modal can then restore search.

Validation: real Electron keyboard routing, Thai typing, existing query, delayed audio start, selector/audio/reload, open and closed QR modal, lyrics editing; existing repository/desktop suites and measured audio fixture. A focused review found one timing gap (restoring only after command completion), reproduced RED and fixed GREEN by restoring on acceptance too. No unresolved source-review findings remain after that fix.

Release: 0.1.4 installer and compatible hosted Player, using existing push/deploy authorization. AI Vocal Remover availability is unchanged.
