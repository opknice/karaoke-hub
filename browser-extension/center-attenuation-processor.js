import {
  getStereoMetrics,
} from './dsp-core.mjs';
import {
  ADAPTIVE_CENTER_PRESETS,
  AdaptiveCenterSuppressor,
} from './stft-center-suppressor.mjs';

class CenterAttenuationProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{
      name: 'mix',
      defaultValue: 0,
      minValue: 0,
      maxValue: 1,
      automationRate: 'a-rate',
    }];
  }

  constructor() {
    super();
    this.presetName = 'balanced';
    this.suppressor = new AdaptiveCenterSuppressor(sampleRate, this.presetName);
    this.analysisCapacity = Math.ceil(sampleRate / 4) + 128;
    this.analysisLeft = new Float32Array(this.analysisCapacity);
    this.analysisRight = new Float32Array(this.analysisCapacity);
    this.analysisWriteIndex = 0;
    this.analysisFrames = 0;
    this.inputChannelCount = 0;
    this.analysisIntervalFrames = Math.max(128, Math.round(sampleRate));

    this.port.onmessage = (event) => {
      if (event.data?.type !== 'SET_PRESET') return;
      if (!Object.hasOwn(ADAPTIVE_CENTER_PRESETS, event.data.preset)) return;
      this.presetName = event.data.preset;
      this.suppressor.setPreset(this.presetName);
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.[0]) return true;

    const outputLeft = output[0];
    const outputRight = output[1] ?? output[0];
    const inputLeft = input?.[0];
    const inputRight = input?.[1] ?? input?.[0];
    this.inputChannelCount = input?.length ?? 0;

    if (!inputLeft || !inputRight) {
      outputLeft.fill(0);
      if (outputRight !== outputLeft) outputRight.fill(0);
      return true;
    }

    const mixValues = parameters.mix;
    this.suppressor.processBlock(
      inputLeft,
      inputRight,
      outputLeft,
      outputRight,
      mixValues,
    );

    for (let index = 0; index < inputLeft.length; index += 4) {
      if (this.analysisWriteIndex >= this.analysisCapacity) break;
      this.analysisLeft[this.analysisWriteIndex] = inputLeft[index];
      this.analysisRight[this.analysisWriteIndex] = inputRight[index];
      this.analysisWriteIndex += 1;
    }
    this.analysisFrames += inputLeft.length;

    if (this.analysisFrames >= this.analysisIntervalFrames) {
      const metrics = {
        ...getStereoMetrics(
          this.analysisLeft.subarray(0, this.analysisWriteIndex),
          this.analysisRight.subarray(0, this.analysisWriteIndex),
        ),
        adaptiveCenterConfidence: this.suppressor.averageCenterConfidence,
        adaptiveCenterGain: this.suppressor.averageCenterGain,
        inputChannelCount: this.inputChannelCount,
      };
      this.port.postMessage({ type: 'ANALYSIS', metrics });
      this.analysisWriteIndex = 0;
      this.analysisFrames = 0;
    }

    return true;
  }
}

registerProcessor('center-attenuation-processor', CenterAttenuationProcessor);
