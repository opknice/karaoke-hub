import { PitchCorrector } from './assets/pitch-corrector.mjs';

// The source owns tempo. Apply only the requested musical transposition to its
// captured PCM: never apply an additional inverse-tempo correction here.
export class DesktopPitchShifter extends PitchCorrector {
  setSemitones(semitones) {
    if (!Number.isInteger(semitones) || semitones < -6 || semitones > 6) throw new RangeError('Key must be -6 through +6 semitones');
    super.setPlaybackRate(2 ** (-semitones / 12));
  }
}
