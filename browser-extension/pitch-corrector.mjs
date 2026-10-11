export const PITCH_FFT_SIZE = 1024;
export const PITCH_HOP_SIZE = 256;

const TWO_PI = 2 * Math.PI;
const MIN_PLAYBACK_RATE = 0.25;
const MAX_PLAYBACK_RATE = 2;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrapPhase(value) {
  let phase = value;
  while (phase > Math.PI) phase -= TWO_PI;
  while (phase < -Math.PI) phase += TWO_PI;
  return phase;
}

class Radix2Fft {
  constructor(size) {
    this.size = size;
    this.bitReversed = new Uint32Array(size);
    this.cosine = new Float32Array(size / 2);
    this.sine = new Float32Array(size / 2);

    const bitCount = Math.round(Math.log2(size));
    for (let index = 0; index < size; index += 1) {
      let source = index;
      let reversed = 0;
      for (let bit = 0; bit < bitCount; bit += 1) {
        reversed = (reversed << 1) | (source & 1);
        source >>= 1;
      }
      this.bitReversed[index] = reversed;
    }

    for (let index = 0; index < size / 2; index += 1) {
      const angle = (TWO_PI * index) / size;
      this.cosine[index] = Math.cos(angle);
      this.sine[index] = Math.sin(angle);
    }
  }

  transform(real, imaginary, inverse = false) {
    const size = this.size;
    for (let index = 0; index < size; index += 1) {
      const reversed = this.bitReversed[index];
      if (reversed <= index) continue;
      const realValue = real[index];
      const imaginaryValue = imaginary[index];
      real[index] = real[reversed];
      imaginary[index] = imaginary[reversed];
      real[reversed] = realValue;
      imaginary[reversed] = imaginaryValue;
    }

    for (let width = 2; width <= size; width *= 2) {
      const halfWidth = width / 2;
      const tableStep = size / width;
      for (let offset = 0; offset < size; offset += width) {
        for (let index = 0; index < halfWidth; index += 1) {
          const tableIndex = index * tableStep;
          const cosine = this.cosine[tableIndex];
          const sine = inverse ? this.sine[tableIndex] : -this.sine[tableIndex];
          const oddIndex = offset + index + halfWidth;
          const evenIndex = offset + index;
          const oddReal = (real[oddIndex] * cosine) - (imaginary[oddIndex] * sine);
          const oddImaginary = (real[oddIndex] * sine) + (imaginary[oddIndex] * cosine);
          const evenReal = real[evenIndex];
          const evenImaginary = imaginary[evenIndex];
          real[evenIndex] = evenReal + oddReal;
          imaginary[evenIndex] = evenImaginary + oddImaginary;
          real[oddIndex] = evenReal - oddReal;
          imaginary[oddIndex] = evenImaginary - oddImaginary;
        }
      }
    }

    if (!inverse) return;
    for (let index = 0; index < size; index += 1) {
      real[index] /= size;
      imaginary[index] /= size;
    }
  }
}

function createChannelState(size) {
  return {
    inputReal: new Float32Array(size),
    inputImaginary: new Float32Array(size),
    outputReal: new Float32Array(size),
    outputImaginary: new Float32Array(size),
    previousPhase: new Float32Array((size / 2) + 1),
    synthesisPhase: new Float32Array((size / 2) + 1),
    magnitude: new Float32Array((size / 2) + 1),
    phase: new Float32Array((size / 2) + 1),
    instantaneousBin: new Float32Array((size / 2) + 1),
    syntheticMagnitude: new Float32Array((size / 2) + 1),
    syntheticFrequency: new Float32Array((size / 2) + 1),
    syntheticPhase: new Float32Array((size / 2) + 1),
    synthesisReady: new Uint8Array((size / 2) + 1),
  };
}

/**
 * Real-time frequency-domain pitch correction used after YouTube changes its
 * playback rate. The audio clock remains at the current rate, while spectral
 * phase progression is adjusted by 1 / playbackRate so the musical key stays
 * close to the original.
 */
export class PitchCorrector {
  constructor(targetSampleRate) {
    this.sampleRate = Math.max(8000, targetSampleRate || 48000);
    this.size = PITCH_FFT_SIZE;
    this.hopSize = PITCH_HOP_SIZE;
    this.ringSize = this.size * 4;
    this.sampleIndex = 0;
    this.playbackRate = 1;
    this.pitchRatio = 1;
    this.active = false;
    this.phaseReady = false;
    this.wetMix = 0;
    this.outputGain = 1;
    this.mixStep = 1 / Math.max(1, this.sampleRate * 0.08);
    this.fft = new Radix2Fft(this.size);
    this.window = new Float32Array(this.size);
    this.inputLeft = new Float32Array(this.size);
    this.inputRight = new Float32Array(this.size);
    this.outputLeft = new Float32Array(this.ringSize);
    this.outputRight = new Float32Array(this.ringSize);
    this.outputWeight = new Float32Array(this.ringSize);
    this.left = createChannelState(this.size);
    this.right = createChannelState(this.size);

    for (let index = 0; index < this.size; index += 1) {
      const hann = 0.5 - (0.5 * Math.cos((TWO_PI * index) / this.size));
      this.window[index] = Math.sqrt(Math.max(0, hann));
    }
  }

  setPlaybackRate(value) {
    const nextRate = clamp(
      Number.isFinite(value) ? value : 1,
      MIN_PLAYBACK_RATE,
      MAX_PLAYBACK_RATE,
    );
    const nextPitchRatio = 1 / nextRate;
    const changed = Math.abs(nextPitchRatio - this.pitchRatio) > 1e-4;
    this.playbackRate = nextRate;
    this.pitchRatio = nextPitchRatio;
    this.active = Math.abs(nextRate - 1) > 1e-4;

    if (!changed) return;
    this.phaseReady = false;
    this.wetMix = 0;
    this.outputGain = 1;
    this.outputLeft.fill(0);
    this.outputRight.fill(0);
    this.outputWeight.fill(0);
    this.inputLeft.fill(0);
    this.inputRight.fill(0);
    this.left.previousPhase.fill(0);
    this.left.synthesisPhase.fill(0);
    this.left.synthesisReady.fill(0);
    this.right.previousPhase.fill(0);
    this.right.synthesisPhase.fill(0);
    this.right.synthesisReady.fill(0);
  }

  reset() {
    this.sampleIndex = 0;
    this.setPlaybackRate(1);
    this.outputLeft.fill(0);
    this.outputRight.fill(0);
    this.outputWeight.fill(0);
    this.inputLeft.fill(0);
    this.inputRight.fill(0);
    this.left.previousPhase.fill(0);
    this.left.synthesisPhase.fill(0);
    this.left.synthesisReady.fill(0);
    this.right.previousPhase.fill(0);
    this.right.synthesisPhase.fill(0);
    this.right.synthesisReady.fill(0);
    this.phaseReady = false;
    this.wetMix = 0;
  }

  processBlock(inputLeft, inputRight, outputLeft, outputRight) {
    const blockLength = Math.min(
      inputLeft.length,
      inputRight.length,
      outputLeft.length,
      outputRight.length,
    );
    let inputEnergy = 0;
    let wetEnergy = 0;
    let wetSamples = 0;

    for (let index = 0; index < blockLength; index += 1) {
      const absoluteIndex = this.sampleIndex;
      const inputSlot = absoluteIndex % this.size;
      const dryLeft = inputLeft[index] ?? 0;
      const dryRight = inputRight[index] ?? 0;

      if (
        this.active
        && absoluteIndex >= this.size
        && (absoluteIndex - this.size) % this.hopSize === 0
      ) {
        this.processFrame(absoluteIndex - this.size, absoluteIndex);
      }

      this.inputLeft[inputSlot] = dryLeft;
      this.inputRight[inputSlot] = dryRight;

      const outputSlot = absoluteIndex % this.ringSize;
      const weight = this.outputWeight[outputSlot];
      const hasWetSample = this.active && weight > 1e-7;
      const wetLeft = hasWetSample ? this.outputLeft[outputSlot] / weight : dryLeft;
      const wetRight = hasWetSample ? this.outputRight[outputSlot] / weight : dryRight;

      if (hasWetSample) {
        wetEnergy += (wetLeft * wetLeft) + (wetRight * wetRight);
        wetSamples += 1;
      }
      inputEnergy += (dryLeft * dryLeft) + (dryRight * dryRight);

      if (this.active && hasWetSample) {
        this.wetMix = Math.min(1, this.wetMix + this.mixStep);
      } else if (!this.active) {
        this.wetMix = 0;
      }

      const mix = this.active ? this.wetMix : 0;
      const scaledWetLeft = wetLeft * this.outputGain;
      const scaledWetRight = wetRight * this.outputGain;
      outputLeft[index] = dryLeft + ((scaledWetLeft - dryLeft) * mix);
      outputRight[index] = dryRight + ((scaledWetRight - dryRight) * mix);
      this.outputLeft[outputSlot] = 0;
      this.outputRight[outputSlot] = 0;
      this.outputWeight[outputSlot] = 0;
      this.sampleIndex += 1;
    }

    if (this.active && wetSamples > 0 && wetEnergy > 1e-7) {
      const targetGain = clamp(
        Math.sqrt(inputEnergy / wetEnergy),
        0.5,
        2.5,
      );
      const smoothing = Math.min(1, blockLength / (this.sampleRate * 0.15));
      this.outputGain += (targetGain - this.outputGain) * smoothing;
    } else if (!this.active) {
      this.outputGain = 1;
    }
  }

  processFrame(frameStart, synthesisStart) {
    this.processChannel(
      this.inputLeft,
      this.left,
      this.outputLeft,
      frameStart,
      synthesisStart,
    );
    this.processChannel(
      this.inputRight,
      this.right,
      this.outputRight,
      frameStart,
      synthesisStart,
    );
    this.phaseReady = true;
  }

  processChannel(input, channel, output, frameStart, synthesisStart) {
    for (let index = 0; index < this.size; index += 1) {
      const inputSlot = (frameStart + index) % this.size;
      channel.inputReal[index] = input[inputSlot] * this.window[index];
      channel.inputImaginary[index] = 0;
    }

    this.fft.transform(channel.inputReal, channel.inputImaginary);
    channel.outputReal.fill(0);
    channel.outputImaginary.fill(0);

    const nyquistBin = this.size / 2;
    channel.syntheticMagnitude.fill(0);
    channel.syntheticFrequency.fill(0);
    channel.syntheticPhase.fill(0);
    let analysisEnergy = 0;
    for (let bin = 0; bin <= nyquistBin; bin += 1) {
      const real = channel.inputReal[bin];
      const imaginary = channel.inputImaginary[bin];
      const magnitude = Math.sqrt((real * real) + (imaginary * imaginary));
      const phase = Math.atan2(imaginary, real);
      const expectedAdvance = (TWO_PI * this.hopSize * bin) / this.size;
      const phaseDelta = this.phaseReady
        ? wrapPhase(phase - channel.previousPhase[bin] - expectedAdvance)
        : 0;
      const instantaneousBin = Math.max(
        0,
        bin + ((phaseDelta * this.size) / (TWO_PI * this.hopSize)),
      );
      channel.previousPhase[bin] = phase;
      channel.magnitude[bin] = magnitude;
      channel.phase[bin] = phase;
      channel.instantaneousBin[bin] = instantaneousBin;
      analysisEnergy += magnitude * magnitude;
      if (magnitude < 1e-7) continue;

      // Move each local spectral shape around its measured partial frequency.
      // This keeps the FFT window's width intact even at the extreme YouTube
      // rates (0.25x and 2x), where simply multiplying the bin index would
      // leave large gaps or discard most of the partial's energy.
      const targetBin = bin + ((instantaneousBin * (this.pitchRatio - 1)));
      const lowerBin = Math.floor(targetBin);
      const upperBin = Math.min(nyquistBin, lowerBin + 1);
      const upperWeight = targetBin - lowerBin;
      const lowerWeight = 1 - upperWeight;
      const targetFrequency = instantaneousBin * this.pitchRatio;
      if (lowerBin >= 0 && lowerBin <= nyquistBin && lowerWeight > 0) {
        const contribution = magnitude * lowerWeight;
        if (contribution > channel.syntheticMagnitude[lowerBin]) {
          channel.syntheticFrequency[lowerBin] = targetFrequency;
          channel.syntheticPhase[lowerBin] = phase;
        }
        channel.syntheticMagnitude[lowerBin] += contribution;
      }
      if (upperBin !== lowerBin && upperWeight > 0) {
        const contribution = magnitude * upperWeight;
        if (contribution > channel.syntheticMagnitude[upperBin]) {
          channel.syntheticFrequency[upperBin] = targetFrequency;
          channel.syntheticPhase[upperBin] = phase;
        }
        channel.syntheticMagnitude[upperBin] += contribution;
      }
    }

    let syntheticEnergy = 0;
    for (let bin = 0; bin <= nyquistBin; bin += 1) {
      syntheticEnergy += channel.syntheticMagnitude[bin]
        * channel.syntheticMagnitude[bin];
    }
    const energyGain = syntheticEnergy > 1e-7
      ? clamp(Math.sqrt(analysisEnergy / syntheticEnergy), 0.5, 2)
      : 1;

    for (let bin = 0; bin <= nyquistBin; bin += 1) {
      const magnitude = channel.syntheticMagnitude[bin] * energyGain;
      if (magnitude < 1e-7) continue;

      const targetFrequency = channel.syntheticFrequency[bin];
      const phaseAdvance = (TWO_PI * this.hopSize * targetFrequency) / this.size;
      if (!channel.synthesisReady[bin] || !this.phaseReady) {
        channel.synthesisPhase[bin] = channel.syntheticPhase[bin];
        channel.synthesisReady[bin] = 1;
      } else {
        channel.synthesisPhase[bin] += phaseAdvance;
      }
      const targetPhase = channel.synthesisPhase[bin];
      channel.outputReal[bin] = magnitude * Math.cos(targetPhase);
      channel.outputImaginary[bin] = magnitude * Math.sin(targetPhase);
    }

    for (let bin = 1; bin < nyquistBin; bin += 1) {
      const mirrorBin = this.size - bin;
      channel.outputReal[mirrorBin] = channel.outputReal[bin];
      channel.outputImaginary[mirrorBin] = -channel.outputImaginary[bin];
    }
    this.fft.transform(channel.outputReal, channel.outputImaginary, true);

    for (let index = 0; index < this.size; index += 1) {
      const outputSlot = (synthesisStart + index) % this.ringSize;
      const window = this.window[index];
      output[outputSlot] += channel.outputReal[index] * window;
      if (channel === this.left) this.outputWeight[outputSlot] += window * window;
    }
  }
}

export function getPitchCorrectionRatio(playbackRate) {
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) return 1;
  return 1 / playbackRate;
}
