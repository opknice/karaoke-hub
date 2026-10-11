import { PitchCorrector } from './pitch-corrector.mjs';

class PitchCorrectionProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.corrector = new PitchCorrector(sampleRate);
    this.port.onmessage = (event) => {
      switch (event.data?.type) {
        case 'SET_PLAYBACK_RATE':
          this.corrector.setPlaybackRate(event.data.playbackRate);
          break;
        case 'RESET':
          this.corrector.reset();
          break;
        default:
          break;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.[0]) return true;

    const outputLeft = output[0];
    const outputRight = output[1] ?? output[0];
    const inputLeft = input?.[0];
    const inputRight = input?.[1] ?? input?.[0];

    if (!inputLeft || !inputRight) {
      outputLeft.fill(0);
      if (outputRight !== outputLeft) outputRight.fill(0);
      return true;
    }

    this.corrector.processBlock(inputLeft, inputRight, outputLeft, outputRight);
    return true;
  }
}

registerProcessor('pitch-correction-processor', PitchCorrectionProcessor);
