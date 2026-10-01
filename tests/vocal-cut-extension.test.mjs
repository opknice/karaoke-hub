import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VOCAL_CUT_PRESETS,
  assessStereoInput,
  createFilterState,
  getStereoMetrics,
  processStereoBlock,
} from '../browser-extension/dsp-core.mjs';
import {
  EXTENSION_SOURCE,
  isBridgeEnvelope,
  isSupportedPlayerUrl,
  normalizeLoudnessStatus,
  normalizePlayerVolume,
  normalizePreset,
  normalizeResult,
  normalizeVideoId,
} from '../browser-extension/messages.mjs';
import {
  ADAPTIVE_FFT_SIZE,
  AdaptiveCenterSuppressor,
} from '../browser-extension/stft-center-suppressor.mjs';
import {
  StreamingLoudnessNormalizer,
} from '../browser-extension/loudness-normalizer.mjs';

function rms(values, start = 0) {
  let energy = 0;
  for (let index = start; index < values.length; index += 1) energy += values[index] ** 2;
  return Math.sqrt(energy / Math.max(1, values.length - start));
}

function sine(length, frequency = 440, targetSampleRate = 48000) {
  return Float32Array.from({ length }, (_, index) => (
    Math.sin((2 * Math.PI * frequency * index) / targetSampleRate) * 0.5
  ));
}

function runAdaptiveSuppressor(left, right, preset = 'balanced', mix = 1) {
  const processor = new AdaptiveCenterSuppressor(48000, preset);
  const outputLeft = new Float32Array(left.length);
  const outputRight = new Float32Array(right.length);
  const blockSize = 128;
  for (let offset = 0; offset < left.length; offset += blockSize) {
    const end = Math.min(left.length, offset + blockSize);
    processor.processBlock(
      left.subarray(offset, end),
      right.subarray(offset, end),
      outputLeft.subarray(offset, end),
      outputRight.subarray(offset, end),
      mix,
    );
  }
  return { outputLeft, outputRight, processor };
}

function runLoudnessNormalizer({
  amplitude,
  seconds = 4,
  playerVolume = 100,
  muted = false,
}) {
  const targetSampleRate = 48000;
  const processor = new StreamingLoudnessNormalizer(targetSampleRate);
  processor.setPlayerVolume(playerVolume, muted);
  processor.setEnabled(true);
  const blockSize = 128;
  const inputLeft = new Float32Array(blockSize);
  const inputRight = new Float32Array(blockSize);
  const outputLeft = new Float32Array(blockSize);
  const outputRight = new Float32Array(blockSize);
  const capturedScale = playerVolume / 100;
  const totalSamples = Math.round(seconds * targetSampleRate);
  for (let offset = 0; offset < totalSamples; offset += blockSize) {
    for (let index = 0; index < blockSize; index += 1) {
      const sample = Math.sin((2 * Math.PI * 1000 * (offset + index)) / targetSampleRate)
        * amplitude * capturedScale;
      inputLeft[index] = sample;
      inputRight[index] = sample;
    }
    processor.processBlock(inputLeft, inputRight, outputLeft, outputRight);
  }
  return { processor, metrics: processor.getMetrics() };
}

test('balanced center attenuation reduces an identical center signal', () => {
  const input = sine(48000);
  const outputLeft = new Float32Array(input.length);
  const outputRight = new Float32Array(input.length);
  processStereoBlock(
    input,
    input,
    outputLeft,
    outputRight,
    createFilterState(),
    VOCAL_CUT_PRESETS.balanced,
    48000,
    1,
  );

  assert.ok(rms(outputLeft, 4096) < rms(input, 4096) * 0.4);
  assert.ok(rms(outputRight, 4096) < rms(input, 4096) * 0.4);
});

test('side-only content survives hard center cancellation', () => {
  const left = sine(48000);
  const right = Float32Array.from(left, (value) => -value);
  const outputLeft = new Float32Array(left.length);
  const outputRight = new Float32Array(right.length);
  processStereoBlock(
    left,
    right,
    outputLeft,
    outputRight,
    createFilterState(),
    VOCAL_CUT_PRESETS.hard,
    48000,
    1,
  );

  assert.ok(Math.abs(rms(outputLeft) - rms(left)) < 1e-6);
  assert.ok(Math.abs(rms(outputRight) - rms(right)) < 1e-6);
});

test('stereo metrics identify identical mono-like channels', () => {
  const input = sine(4096);
  const monoMetrics = getStereoMetrics(input, input);
  assert.equal(monoMetrics.hasSignal, true);
  assert.equal(monoMetrics.monoLike, true);

  const side = Float32Array.from(input, (value) => -value);
  const stereoMetrics = getStereoMetrics(input, side);
  assert.equal(stereoMetrics.monoLike, false);
  assert.ok(stereoMetrics.sideRatio > 0.4);
});

test('mono-like input is advisory and does not block vocal cut', () => {
  const input = sine(4096);
  const metrics = getStereoMetrics(input, input);
  const singleChannel = assessStereoInput(metrics, 1);
  const lowSideStereo = assessStereoInput(metrics, 2);

  assert.deepEqual(singleChannel, {
    canEnable: true,
    limited: true,
    reason: 'single_channel_capture',
  });
  assert.deepEqual(lowSideStereo, {
    canEnable: true,
    limited: true,
    reason: 'low_side_energy',
  });
});

test('adaptive STFT suppresses a centered vocal-band tone while preserving side content', () => {
  const length = 48000;
  const center = sine(length, 1000);
  const side = sine(length, 440);
  const left = Float32Array.from(center, (value, index) => value + (side[index] * 0.5));
  const right = Float32Array.from(center, (value, index) => value - (side[index] * 0.5));
  const { outputLeft, outputRight } = runAdaptiveSuppressor(left, right, 'balanced');
  const start = ADAPTIVE_FFT_SIZE * 4;
  const outputCenter = Float32Array.from(outputLeft, (value, index) => (
    (value + outputRight[index]) * 0.5
  ));
  const outputSide = Float32Array.from(outputLeft, (value, index) => (
    (value - outputRight[index]) * 0.5
  ));

  assert.ok(rms(outputCenter, start) < rms(center, start) * 0.35);
  assert.ok(rms(outputSide, start) > rms(side, start) * 0.45);
});

test('maximum adaptive preset suppresses the center more than balanced', () => {
  const input = sine(48000, 1200);
  const balanced = runAdaptiveSuppressor(input, input, 'balanced');
  const maximum = runAdaptiveSuppressor(input, input, 'maximum');
  const start = ADAPTIVE_FFT_SIZE * 4;

  assert.ok(rms(maximum.outputLeft, start) < rms(balanced.outputLeft, start) * 0.55);
});

test('adaptive STFT preserves centered sub-bass outside the vocal band', () => {
  const input = sine(48000, 80);
  const { outputLeft } = runAdaptiveSuppressor(input, input, 'maximum');
  const start = ADAPTIVE_FFT_SIZE * 4;

  assert.ok(rms(outputLeft, start) > rms(input, start) * 0.82);
});

test('loudness normalizer attenuates loud tracks and caps quiet-track boost', () => {
  const loud = runLoudnessNormalizer({ amplitude: 0.5 });
  assert.equal(loud.metrics.normalizeStatus, 'active');
  assert.ok(loud.metrics.targetNormalizationGainDb < -5);

  const quiet = runLoudnessNormalizer({ amplitude: 0.01 });
  assert.equal(quiet.metrics.normalizeStatus, 'limited');
  assert.equal(quiet.metrics.targetNormalizationGainDb, 8);
});

test('loudness measurement compensates for the player master volume', () => {
  const fullVolume = runLoudnessNormalizer({ amplitude: 0.2, playerVolume: 100 });
  const halfVolume = runLoudnessNormalizer({ amplitude: 0.2, playerVolume: 50 });
  assert.ok(Math.abs(
    fullVolume.metrics.measuredLoudnessDb - halfVolume.metrics.measuredLoudnessDb
  ) < 0.1);
  assert.ok(Math.abs(
    fullVolume.metrics.targetNormalizationGainDb - halfVolume.metrics.targetNormalizationGainDb
  ) < 0.1);
});

test('loudness normalizer holds gain during silence and resets between tracks', () => {
  const { processor, metrics } = runLoudnessNormalizer({ amplitude: 0 });
  assert.equal(metrics.normalizeStatus, 'silence_hold');
  assert.equal(metrics.targetNormalizationGainDb, 0);
  processor.reset();
  assert.equal(processor.getMetrics().normalizeStatus, 'warming');
  assert.equal(processor.getMetrics().measuredLoudnessDb, null);
});

test('track reset ramps normalization gain toward zero instead of stepping', () => {
  const { processor } = runLoudnessNormalizer({ amplitude: 0.5, seconds: 6 });
  const gainBeforeReset = processor.getMetrics().normalizationGainDb;
  assert.ok(gainBeforeReset < -1);
  processor.reset();
  assert.equal(processor.getMetrics().normalizationGainDb, gainBeforeReset);
  assert.equal(processor.getMetrics().targetNormalizationGainDb, 0);

  const input = sine(128, 1000);
  const outputLeft = new Float32Array(128);
  const outputRight = new Float32Array(128);
  processor.processBlock(input, input, outputLeft, outputRight);
  const gainAfterOneBlock = processor.getMetrics().normalizationGainDb;
  assert.ok(gainAfterOneBlock > gainBeforeReset);
  assert.ok(gainAfterOneBlock < 0);
});

test('extension bridge validates URLs, IDs, and envelopes', () => {
  assert.equal(isSupportedPlayerUrl('http://localhost:3000/player'), true);
  assert.equal(isSupportedPlayerUrl('http://localhost:3000/player/'), true);
  assert.equal(isSupportedPlayerUrl('https://karaoke-hub.vercel.app/player'), true);
  assert.equal(isSupportedPlayerUrl('https://example.com/player'), false);
  assert.equal(isSupportedPlayerUrl('https://karaoke-hub.vercel.app/join/ABC123'), false);
  assert.equal(normalizeVideoId('DmftZuj-8vI'), 'DmftZuj-8vI');
  assert.equal(normalizeVideoId('bad'), null);
  assert.equal(normalizeResult('good'), 'good');
  assert.equal(normalizeResult('unknown'), null);
  assert.equal(normalizePreset('maximum'), 'maximum');
  assert.equal(normalizePreset('hard'), null);
  assert.equal(normalizeLoudnessStatus('silence_hold'), 'silence_hold');
  assert.equal(normalizeLoudnessStatus('unknown'), null);
  assert.equal(normalizePlayerVolume(84.6), 85);
  assert.equal(normalizePlayerVolume(101), 100);
  assert.equal(normalizePlayerVolume('85'), null);
  assert.equal(isBridgeEnvelope({
    source: EXTENSION_SOURCE,
    version: 1,
    type: 'STATE_CHANGED',
  }, EXTENSION_SOURCE), true);
});
