import { StreamingLoudnessNormalizer } from './loudness-normalizer.mjs';

class LoudnessNormalizerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.normalizer = new StreamingLoudnessNormalizer(sampleRate);
    this.telemetryFrames = 0;
    this.telemetryIntervalFrames = Math.max(128, Math.round(sampleRate / 2));

    this.port.onmessage = (event) => {
      switch (event.data?.type) {
        case 'SET_ENABLED':
          this.normalizer.setEnabled(event.data.enabled === true);
          break;
        case 'SET_PLAYER_VOLUME':
          this.normalizer.setPlayerVolume(event.data.volume, event.data.muted);
          break;
        case 'RESET':
          this.normalizer.reset({ preserveGain: event.data.preserveGain === true });
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

    this.normalizer.processBlock(inputLeft, inputRight, outputLeft, outputRight);
    this.telemetryFrames += inputLeft.length;
    if (this.telemetryFrames >= this.telemetryIntervalFrames) {
      this.port.postMessage({ type: 'LOUDNESS_ANALYSIS', metrics: this.normalizer.getMetrics() });
      this.telemetryFrames = 0;
    }
    return true;
  }
}

registerProcessor('loudness-normalizer-processor', LoudnessNormalizerProcessor);
