export const DEFAULT_LOUDNESS_CONFIG = Object.freeze({
  targetLoudnessDb: -16,
  maximumBoostDb: 8,
  maximumAttenuationDb: -12,
  silenceGateDb: -50,
  measurementWindowSeconds: 0.4,
  warmupSeconds: 2.8,
  attenuationSeconds: 0.7,
  boostSeconds: 4.5,
  bypassSeconds: 0.08,
});

const MINIMUM_ENERGY = 1e-12;

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function decibelsToGain(decibels) {
  return 10 ** (decibels / 20);
}

export function gainToDecibels(gain) {
  return 20 * Math.log10(Math.max(1e-6, gain));
}

function highPassCoefficients(sampleRate, frequency = 38, q = 0.5) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cosine) / 2) / a0,
    b1: (-(1 + cosine)) / a0,
    b2: ((1 + cosine) / 2) / a0,
    a1: (-2 * cosine) / a0,
    a2: (1 - alpha) / a0,
  };
}

function highShelfCoefficients(sampleRate, frequency = 1682, gainDb = 4, q = 0.7071) {
  const amplitude = 10 ** (gainDb / 40);
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const twoRootAmplitudeAlpha = 2 * Math.sqrt(amplitude) * alpha;
  const a0 = (amplitude + 1) - ((amplitude - 1) * cosine) + twoRootAmplitudeAlpha;
  return {
    b0: (amplitude * ((amplitude + 1) + ((amplitude - 1) * cosine) + twoRootAmplitudeAlpha)) / a0,
    b1: (-2 * amplitude * ((amplitude - 1) + ((amplitude + 1) * cosine))) / a0,
    b2: (amplitude * ((amplitude + 1) + ((amplitude - 1) * cosine) - twoRootAmplitudeAlpha)) / a0,
    a1: (2 * ((amplitude - 1) - ((amplitude + 1) * cosine))) / a0,
    a2: ((amplitude + 1) - ((amplitude - 1) * cosine) - twoRootAmplitudeAlpha) / a0,
  };
}

class BiquadFilter {
  constructor(coefficients) {
    this.coefficients = coefficients;
    this.z1 = 0;
    this.z2 = 0;
  }

  reset() {
    this.z1 = 0;
    this.z2 = 0;
  }

  process(sample) {
    const { b0, b1, b2, a1, a2 } = this.coefficients;
    const output = (b0 * sample) + this.z1;
    this.z1 = (b1 * sample) - (a1 * output) + this.z2;
    this.z2 = (b2 * sample) - (a2 * output);
    return output;
  }
}

function createKWeightingFilters(sampleRate) {
  return {
    shelf: new BiquadFilter(highShelfCoefficients(sampleRate)),
    highPass: new BiquadFilter(highPassCoefficients(sampleRate)),
  };
}

function processKWeightedSample(filters, sample) {
  return filters.highPass.process(filters.shelf.process(sample));
}

function resetKWeightingFilters(filters) {
  filters.shelf.reset();
  filters.highPass.reset();
}

function smoothTowards(current, target, elapsedSeconds, timeConstantSeconds) {
  const safeTimeConstant = Math.max(0.001, timeConstantSeconds);
  const ratio = 1 - Math.exp(-elapsedSeconds / safeTimeConstant);
  return current + ((target - current) * ratio);
}

export class StreamingLoudnessNormalizer {
  constructor(sampleRate, config = {}) {
    this.sampleRate = Math.max(1, sampleRate);
    this.config = Object.freeze({ ...DEFAULT_LOUDNESS_CONFIG, ...config });
    this.windowSamples = Math.max(128, Math.round(
      this.sampleRate * this.config.measurementWindowSeconds,
    ));
    this.leftFilters = createKWeightingFilters(this.sampleRate);
    this.rightFilters = createKWeightingFilters(this.sampleRate);
    this.enabled = false;
    this.playerVolume = 85;
    this.playerMuted = false;
    this.currentGainDb = 0;
    this.targetGainDb = 0;
    this.resettingGain = false;
    this.measuredLoudnessDb = null;
    this.activeSeconds = 0;
    this.status = 'off';
    this.isLimited = false;
    this.energy = 0;
    this.energySamples = 0;
  }

  setEnabled(enabled) {
    const nextEnabled = Boolean(enabled);
    if (nextEnabled === this.enabled) return;
    this.enabled = nextEnabled;
    if (nextEnabled) this.reset({ preserveGain: false });
    else {
      this.targetGainDb = 0;
      this.resettingGain = false;
      this.status = 'off';
      this.isLimited = false;
    }
  }

  setPlayerVolume(volume, muted = false) {
    this.playerVolume = clamp(Number.isFinite(volume) ? volume : 0, 0, 100);
    this.playerMuted = Boolean(muted);
  }

  reset({ preserveGain = false } = {}) {
    resetKWeightingFilters(this.leftFilters);
    resetKWeightingFilters(this.rightFilters);
    this.energy = 0;
    this.energySamples = 0;
    this.activeSeconds = 0;
    this.measuredLoudnessDb = null;
    this.targetGainDb = preserveGain ? this.currentGainDb : 0;
    this.resettingGain = !preserveGain && Math.abs(this.currentGainDb) > 0.01;
    this.status = this.enabled ? 'warming' : 'off';
    this.isLimited = false;
  }

  updateMeasurement() {
    const meanSquare = this.energy / Math.max(1, this.energySamples);
    const measuredLoudnessDb = -0.691 + (10 * Math.log10(Math.max(MINIMUM_ENERGY, meanSquare)));
    this.energy = 0;
    this.energySamples = 0;

    if (this.playerMuted || this.playerVolume <= 1) {
      this.status = 'silence_hold';
      return;
    }

    const playerGain = Math.max(0.01, this.playerVolume / 100);
    const sourceLoudnessDb = measuredLoudnessDb - gainToDecibels(playerGain);
    this.measuredLoudnessDb = sourceLoudnessDb;

    if (sourceLoudnessDb < this.config.silenceGateDb) {
      this.status = 'silence_hold';
      return;
    }

    this.activeSeconds += this.config.measurementWindowSeconds;
    if (this.resettingGain) {
      this.status = 'warming';
      return;
    }
    const rawTargetGainDb = this.config.targetLoudnessDb - sourceLoudnessDb;
    const clampedTargetGainDb = clamp(
      rawTargetGainDb,
      this.config.maximumAttenuationDb,
      this.config.maximumBoostDb,
    );
    this.isLimited = Math.abs(rawTargetGainDb - clampedTargetGainDb) > 0.05;

    if (this.activeSeconds < this.config.warmupSeconds) {
      // Attenuate obviously loud tracks early, but never boost a quiet intro.
      this.targetGainDb = Math.min(0, clampedTargetGainDb);
      this.status = 'warming';
      return;
    }

    this.targetGainDb = clampedTargetGainDb;
    this.status = this.isLimited ? 'limited' : 'active';
  }

  processBlock(inputLeft, inputRight, outputLeft, outputRight) {
    const length = Math.min(
      inputLeft.length,
      inputRight.length,
      outputLeft.length,
      outputRight.length,
    );
    const elapsedSeconds = length / this.sampleRate;
    const desiredGainDb = this.enabled ? this.targetGainDb : 0;
    const timeConstantSeconds = this.resettingGain || !this.enabled
      ? this.config.bypassSeconds
      : desiredGainDb < this.currentGainDb
        ? this.config.attenuationSeconds
        : this.config.boostSeconds;
    const startingGainDb = this.currentGainDb;
    const endingGainDb = smoothTowards(
      startingGainDb,
      desiredGainDb,
      elapsedSeconds,
      timeConstantSeconds,
    );
    const startingGain = decibelsToGain(startingGainDb);
    const endingGain = decibelsToGain(endingGainDb);

    for (let index = 0; index < length; index += 1) {
      const left = Number.isFinite(inputLeft[index]) ? inputLeft[index] : 0;
      const right = Number.isFinite(inputRight[index]) ? inputRight[index] : left;
      const progress = length > 1 ? index / (length - 1) : 1;
      const gain = startingGain + ((endingGain - startingGain) * progress);
      outputLeft[index] = left * gain;
      outputRight[index] = right * gain;

      if (this.enabled) {
        const weightedLeft = processKWeightedSample(this.leftFilters, left);
        const weightedRight = processKWeightedSample(this.rightFilters, right);
        this.energy += (weightedLeft * weightedLeft) + (weightedRight * weightedRight);
        this.energySamples += 1;
        if (this.energySamples >= this.windowSamples) this.updateMeasurement();
      }
    }

    this.currentGainDb = endingGainDb;
    if (this.resettingGain && Math.abs(this.currentGainDb) < 0.01) {
      this.currentGainDb = 0;
      this.resettingGain = false;
    }
  }

  getMetrics() {
    return {
      normalizeStatus: this.enabled ? this.status : 'off',
      measuredLoudnessDb: this.measuredLoudnessDb,
      normalizationGainDb: this.currentGainDb,
      targetNormalizationGainDb: this.targetGainDb,
      normalizeLimited: this.isLimited,
    };
  }
}
