import { DesktopPitchShifter } from './pitch-shifter.mjs';
class DesktopPitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new DesktopPitchShifter(sampleRate);
    this.port.onmessage = ({data}) => {
      if (data?.type === 'SET_PITCH') this.engine.setSemitones(data.semitones);
      if (data?.type === 'RESET') this.engine.reset();
    };
  }
  process(inputs, outputs) {
    const input=inputs[0], output=outputs[0];
    if (!output?.[0]) return true;
    if (!input?.[0]) { for(const channel of output) channel.fill(0); return true; }
    this.engine.processBlock(input[0], input[1] ?? input[0], output[0], output[1] ?? output[0]);
    return true;
  }
}
registerProcessor('desktop-pitch', DesktopPitchProcessor);
