export const VOCAL_CUT_PRESETS = Object.freeze({
  balanced: Object.freeze({
    lowCutoffHz: 180,
    highCutoffHz: 7000,
    lowGain: 0.9,
    midGain: 0.22,
    highGain: 0.55,
  }),
  strong: Object.freeze({
    lowCutoffHz: 160,
    highCutoffHz: 7600,
    lowGain: 0.75,
    midGain: 0.08,
    highGain: 0.35,
  }),
  hard: Object.freeze({
    lowCutoffHz: 180,
    highCutoffHz: 7000,
    lowGain: 0,
    midGain: 0,
    highGain: 0,
  }),
});

export function createFilterState() {
  return { low: 0, underHigh: 0 };
}

function onePoleAlpha(cutoffHz, targetSampleRate) {
  const safeRate = Math.max(1, targetSampleRate);
  const safeCutoff = Math.min(Math.max(1, cutoffHz), safeRate * 0.45);
  return 1 - Math.exp((-2 * Math.PI * safeCutoff) / safeRate);
}

export function processMidSample(sample, state, preset, targetSampleRate) {
  const lowAlpha = onePoleAlpha(preset.lowCutoffHz, targetSampleRate);
  const highAlpha = onePoleAlpha(preset.highCutoffHz, targetSampleRate);

  state.low += lowAlpha * (sample - state.low);
  state.underHigh += highAlpha * (sample - state.underHigh);

  const lowBand = state.low;
  const midBand = state.underHigh - lowBand;
  const highBand = sample - state.underHigh;
  return (
    lowBand * preset.lowGain
    + midBand * preset.midGain
    + highBand * preset.highGain
  );
}

export function getStereoMetrics(left, right) {
  const length = Math.min(left.length, right.length);
  let leftEnergy = 0;
  let rightEnergy = 0;
  let sideEnergy = 0;
  let crossEnergy = 0;

  for (let index = 0; index < length; index += 1) {
    const leftSample = Number.isFinite(left[index]) ? left[index] : 0;
    const rightSample = Number.isFinite(right[index]) ? right[index] : 0;
    const side = (leftSample - rightSample) * 0.5;
    leftEnergy += leftSample * leftSample;
    rightEnergy += rightSample * rightSample;
    sideEnergy += side * side;
    crossEnergy += leftSample * rightSample;
  }

  const totalEnergy = leftEnergy + rightEnergy;
  const correlationDenominator = Math.sqrt(leftEnergy * rightEnergy);
  const correlation = correlationDenominator > 0
    ? Math.max(-1, Math.min(1, crossEnergy / correlationDenominator))
    : 0;
  const sideRatio = totalEnergy > 0 ? sideEnergy / totalEnergy : 0;
  const hasSignal = totalEnergy / Math.max(1, length) > 1e-8;

  return {
    correlation,
    hasSignal,
    monoLike: hasSignal && correlation > 0.9995 && sideRatio < 0.0001,
    sideRatio,
    totalEnergy,
  };
}

export function assessStereoInput(metrics, inputChannelCount = 2) {
  const normalizedChannelCount = Number.isFinite(inputChannelCount)
    ? Math.max(0, Math.trunc(inputChannelCount))
    : 0;
  const reason = normalizedChannelCount < 2
    ? 'single_channel_capture'
    : metrics?.monoLike === true
      ? 'low_side_energy'
      : null;

  return {
    canEnable: true,
    limited: reason !== null,
    reason,
  };
}

export function processStereoBlock(
  left,
  right,
  outputLeft,
  outputRight,
  state,
  preset,
  targetSampleRate,
  mix = 1,
) {
  const length = Math.min(left.length, right.length, outputLeft.length, outputRight.length);
  const normalizedMix = Math.min(1, Math.max(0, Number.isFinite(mix) ? mix : 0));

  for (let index = 0; index < length; index += 1) {
    const dryLeft = left[index] ?? 0;
    const dryRight = right[index] ?? 0;
    const mid = (dryLeft + dryRight) * 0.5;
    const side = (dryLeft - dryRight) * 0.5;
    const processedMid = processMidSample(mid, state, preset, targetSampleRate);
    const wetLeft = processedMid + side;
    const wetRight = processedMid - side;

    outputLeft[index] = dryLeft + ((wetLeft - dryLeft) * normalizedMix);
    outputRight[index] = dryRight + ((wetRight - dryRight) * normalizedMix);
  }
}
