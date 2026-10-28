import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopPitchShifter } from '../audio/pitch-shifter.mjs';

function toneResult(semitones) {
  const engine = new DesktopPitchShifter(48000);
  engine.setSemitones(semitones);
  const output = new Float32Array(96000);
  for (let p = 0; p < output.length; p += 128) {
    const input = Float32Array.from({length:128}, (_, i) => 0.3 * Math.sin(2 * Math.PI * 440 * (p+i) / 48000));
    const left = new Float32Array(128), right = new Float32Array(128);
    engine.processBlock(input, input, left, right);
    output.set(left, p);
    assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  }
  const expected = { '-6': 311.126984, '0':440, '3':523.25113, '6':622.253967 }[semitones];
  let real=0, imaginary=0, energy=0;
  for(let i=24000;i<output.length;i++) {
    real += output[i]*Math.cos(2*Math.PI*expected*i/48000);
    imaginary += output[i]*Math.sin(2*Math.PI*expected*i/48000);
    energy += output[i]**2;
  }
  return { amplitude:2*Math.hypot(real,imaginary)/72000, rms:Math.sqrt(energy/72000), engine };
}
for (const semitones of [-6,0,3,6]) test(`duration-neutral pitch shift ${semitones} produces the target frequency`, () => {
  const result=toneResult(semitones);
  assert.ok(result.amplitude > 0.24, JSON.stringify({semitones,amplitude:result.amplitude}));
  assert.ok(result.rms < 0.3 && result.rms > 0.16);
});
test('reset clears a prior key and returns unity playback', () => {
  const { engine }=toneResult(3);
  engine.reset();
  const input=Float32Array.from({length:128},()=>0.1), left=new Float32Array(128),right=new Float32Array(128);
  engine.processBlock(input,input,left,right);
  assert.deepEqual(left,input);
});
