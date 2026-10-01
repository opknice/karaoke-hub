export const ADAPTIVE_FFT_SIZE = 1024;
export const ADAPTIVE_HOP_SIZE = ADAPTIVE_FFT_SIZE / 2;

export const ADAPTIVE_CENTER_PRESETS = Object.freeze({
  balanced: Object.freeze({
    minimumCenterGain: 0.18,
    transientProtection: 0.72,
    centerFloor: 0.72,
  }),
  strong: Object.freeze({
    minimumCenterGain: 0.06,
    transientProtection: 0.5,
    centerFloor: 0.64,
  }),
  maximum: Object.freeze({
    minimumCenterGain: 0.015,
    transientProtection: 0.25,
    centerFloor: 0.56,
  }),
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const normalized = clamp((value - edge0) / (edge1 - edge0));
  return normalized * normalized * (3 - (2 * normalized));
}

function vocalBandWeight(frequency) {
  if (frequency <= 120 || frequency >= 9000) return 0;
  if (frequency < 250) return smoothstep(120, 250, frequency);
  if (frequency <= 6000) return 1;
  return 1 - smoothstep(6000, 9000, frequency);
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
      const angle = (2 * Math.PI * index) / size;
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

export class AdaptiveCenterSuppressor {
  constructor(targetSampleRate, presetName = 'balanced') {
    this.sampleRate = Math.max(8000, targetSampleRate || 48000);
    this.size = ADAPTIVE_FFT_SIZE;
    this.hopSize = ADAPTIVE_HOP_SIZE;
    this.ringSize = this.size * 4;
    this.sampleIndex = 0;
    this.presetName = Object.hasOwn(ADAPTIVE_CENTER_PRESETS, presetName)
      ? presetName
      : 'balanced';
    this.fft = new Radix2Fft(this.size);
    this.window = new Float32Array(this.size);
    this.inputLeft = new Float32Array(this.size);
    this.inputRight = new Float32Array(this.size);
    this.outputLeft = new Float32Array(this.ringSize);
    this.outputRight = new Float32Array(this.ringSize);
    this.outputWeight = new Float32Array(this.ringSize);
    this.frameLeftReal = new Float32Array(this.size);
    this.frameLeftImaginary = new Float32Array(this.size);
    this.frameRightReal = new Float32Array(this.size);
    this.frameRightImaginary = new Float32Array(this.size);
    this.previousMidMagnitude = new Float32Array((this.size / 2) + 1);
    this.smoothedGain = new Float32Array((this.size / 2) + 1);
    this.smoothedGain.fill(1);
    this.averageCenterConfidence = 0;
    this.averageCenterGain = 1;

    for (let index = 0; index < this.size; index += 1) {
      const hann = 0.5 - (0.5 * Math.cos((2 * Math.PI * index) / this.size));
      this.window[index] = Math.sqrt(Math.max(0, hann));
    }
  }

  setPreset(presetName) {
    if (!Object.hasOwn(ADAPTIVE_CENTER_PRESETS, presetName)) return false;
    this.presetName = presetName;
    return true;
  }

  processBlock(inputLeft, inputRight, outputLeft, outputRight, mixValues = 1) {
    const blockLength = Math.min(
      inputLeft.length,
      inputRight.length,
      outputLeft.length,
      outputRight.length,
    );

    for (let blockIndex = 0; blockIndex < blockLength; blockIndex += 1) {
      const absoluteIndex = this.sampleIndex;
      const inputSlot = absoluteIndex % this.size;
      const dryLeft = absoluteIndex >= this.size ? this.inputLeft[inputSlot] : 0;
      const dryRight = absoluteIndex >= this.size ? this.inputRight[inputSlot] : 0;
      this.inputLeft[inputSlot] = inputLeft[blockIndex] ?? 0;
      this.inputRight[inputSlot] = inputRight[blockIndex] ?? 0;
      this.sampleIndex += 1;

      if (
        this.sampleIndex >= this.size
        && (this.sampleIndex - this.size) % this.hopSize === 0
      ) {
        this.processFrame(this.sampleIndex - this.size, this.sampleIndex);
      }

      const outputSlot = absoluteIndex % this.ringSize;
      const weight = this.outputWeight[outputSlot];
      const wetLeft = weight > 1e-7 ? this.outputLeft[outputSlot] / weight : dryLeft;
      const wetRight = weight > 1e-7 ? this.outputRight[outputSlot] / weight : dryRight;
      const rawMix = typeof mixValues === 'number'
        ? mixValues
        : mixValues.length === 1
          ? mixValues[0]
          : mixValues[blockIndex];
      const mix = clamp(Number.isFinite(rawMix) ? rawMix : 0);
      outputLeft[blockIndex] = dryLeft + ((wetLeft - dryLeft) * mix);
      outputRight[blockIndex] = dryRight + ((wetRight - dryRight) * mix);
      this.outputLeft[outputSlot] = 0;
      this.outputRight[outputSlot] = 0;
      this.outputWeight[outputSlot] = 0;
    }
  }

  processFrame(frameStart, synthesisStart) {
    const size = this.size;
    for (let index = 0; index < size; index += 1) {
      const inputSlot = (frameStart + index) % size;
      const window = this.window[index];
      this.frameLeftReal[index] = this.inputLeft[inputSlot] * window;
      this.frameRightReal[index] = this.inputRight[inputSlot] * window;
      this.frameLeftImaginary[index] = 0;
      this.frameRightImaginary[index] = 0;
    }

    this.fft.transform(this.frameLeftReal, this.frameLeftImaginary);
    this.fft.transform(this.frameRightReal, this.frameRightImaginary);

    const preset = ADAPTIVE_CENTER_PRESETS[this.presetName];
    const nyquistBin = size / 2;
    let confidenceTotal = 0;
    let gainTotal = 0;
    let weightedBins = 0;

    for (let bin = 0; bin <= nyquistBin; bin += 1) {
      const leftReal = this.frameLeftReal[bin];
      const leftImaginary = this.frameLeftImaginary[bin];
      const rightReal = this.frameRightReal[bin];
      const rightImaginary = this.frameRightImaginary[bin];
      const midReal = (leftReal + rightReal) * 0.5;
      const midImaginary = (leftImaginary + rightImaginary) * 0.5;
      const sideReal = (leftReal - rightReal) * 0.5;
      const sideImaginary = (leftImaginary - rightImaginary) * 0.5;
      const midPower = (midReal * midReal) + (midImaginary * midImaginary);
      const sidePower = (sideReal * sideReal) + (sideImaginary * sideImaginary);
      const leftPower = (leftReal * leftReal) + (leftImaginary * leftImaginary);
      const rightPower = (rightReal * rightReal) + (rightImaginary * rightImaginary);
      const totalPower = midPower + sidePower;
      const frequency = (bin * this.sampleRate) / size;
      const bandWeight = vocalBandWeight(frequency);

      let centerConfidence = 0;
      if (bandWeight > 0 && totalPower > 1e-10) {
        const centerRatio = midPower / (totalPower + 1e-12);
        const phaseCoherence = (
          (leftReal * rightReal) + (leftImaginary * rightImaginary)
        ) / (Math.sqrt(leftPower * rightPower) + 1e-12);
        const levelDifferenceDb = Math.abs(
          10 * Math.log10((leftPower + 1e-12) / (rightPower + 1e-12)),
        );
        const spatialScore = smoothstep(preset.centerFloor, 0.995, centerRatio);
        const phaseScore = smoothstep(0.55, 0.995, phaseCoherence);
        const balanceScore = 1 - smoothstep(1.5, 8, levelDifferenceDb);
        centerConfidence = spatialScore * phaseScore * balanceScore;
      }

      const midMagnitude = Math.sqrt(midPower);
      const previousMagnitude = this.previousMidMagnitude[bin];
      const positiveFlux = Math.max(0, midMagnitude - previousMagnitude)
        / (previousMagnitude + 1e-6);
      const transientScore = smoothstep(0.35, 2.5, positiveFlux);
      const transientFactor = 1 - (transientScore * preset.transientProtection);
      const targetGain = 1 - (
        (1 - preset.minimumCenterGain)
        * centerConfidence
        * bandWeight
        * transientFactor
      );
      const previousGain = this.smoothedGain[bin];
      const smoothing = targetGain < previousGain ? 0.58 : 0.14;
      const centerGain = previousGain + ((targetGain - previousGain) * smoothing);
      this.smoothedGain[bin] = centerGain;
      this.previousMidMagnitude[bin] = midMagnitude;

      const outputMidReal = midReal * centerGain;
      const outputMidImaginary = midImaginary * centerGain;
      const outputLeftReal = outputMidReal + sideReal;
      const outputLeftImaginary = outputMidImaginary + sideImaginary;
      const outputRightReal = outputMidReal - sideReal;
      const outputRightImaginary = outputMidImaginary - sideImaginary;
      this.frameLeftReal[bin] = outputLeftReal;
      this.frameLeftImaginary[bin] = outputLeftImaginary;
      this.frameRightReal[bin] = outputRightReal;
      this.frameRightImaginary[bin] = outputRightImaginary;

      if (bin > 0 && bin < nyquistBin) {
        const mirrorBin = size - bin;
        this.frameLeftReal[mirrorBin] = outputLeftReal;
        this.frameLeftImaginary[mirrorBin] = -outputLeftImaginary;
        this.frameRightReal[mirrorBin] = outputRightReal;
        this.frameRightImaginary[mirrorBin] = -outputRightImaginary;
      }

      if (bandWeight > 0.5 && totalPower > 1e-10) {
        confidenceTotal += centerConfidence;
        gainTotal += centerGain;
        weightedBins += 1;
      }
    }

    this.averageCenterConfidence = weightedBins > 0 ? confidenceTotal / weightedBins : 0;
    this.averageCenterGain = weightedBins > 0 ? gainTotal / weightedBins : 1;
    this.fft.transform(this.frameLeftReal, this.frameLeftImaginary, true);
    this.fft.transform(this.frameRightReal, this.frameRightImaginary, true);

    for (let index = 0; index < size; index += 1) {
      const outputSlot = (synthesisStart + index) % this.ringSize;
      const window = this.window[index];
      this.outputLeft[outputSlot] += this.frameLeftReal[index] * window;
      this.outputRight[outputSlot] += this.frameRightReal[index] * window;
      this.outputWeight[outputSlot] += window * window;
    }
  }
}
