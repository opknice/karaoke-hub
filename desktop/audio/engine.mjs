export class AudioEngine {
  constructor(report) { this.report=report; this.epoch=0; this.graph=null; this.key=0; }
  async stop() {
    ++this.epoch;
    const graph=this.graph; this.graph=null; this.key=0;
    if (!graph) return;
    clearInterval(graph.timer);
    for(const track of graph.stream.getTracks()) { track.onended=null; track.stop(); }
    for(const node of graph.nodes) node.disconnect();
    await graph.context.close().catch(()=>{});
  }
  async start() {
    await this.stop();
    const epoch=this.epoch;
    let stream, context;
    try {
      stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      if(epoch!==this.epoch) throw new Error('ยกเลิกการเริ่มระบบเสียงแล้ว');
      if(!stream.getAudioTracks().length) throw new Error('ไม่ได้รับเสียงจาก Player');
      context=new AudioContext({latencyHint:'interactive'});
      await Promise.all([
        context.audioWorklet.addModule(new URL('./pitch-processor.js',import.meta.url)),
        context.audioWorklet.addModule(new URL('./assets/center-attenuation-processor.js',import.meta.url)),
        context.audioWorklet.addModule(new URL('./assets/loudness-normalizer-processor.js',import.meta.url)),
      ]);
      if(epoch!==this.epoch) throw new Error('ยกเลิกการเริ่มระบบเสียงแล้ว');
      const options={channelCount:2,channelCountMode:'max',outputChannelCount:[2]};
      const source=context.createMediaStreamSource(stream);
      const pitch=new AudioWorkletNode(context,'desktop-pitch',options);
      const vocal=new AudioWorkletNode(context,'center-attenuation-processor',options);
      const normalize=new AudioWorkletNode(context,'loudness-normalizer-processor',options);
      const limiter=context.createDynamicsCompressor();
      limiter.threshold.value=-1; limiter.knee.value=1; limiter.ratio.value=20; limiter.attack.value=0.005;limiter.release.value=0.2;
      const inputMeter=context.createAnalyser(), outputMeter=context.createAnalyser();
      inputMeter.fftSize=2048; outputMeter.fftSize=8192;
      source.connect(inputMeter).connect(pitch).connect(vocal).connect(normalize).connect(limiter).connect(outputMeter).connect(context.destination);
      const graph={stream,context,pitch,vocal,normalize,limiter,inputMeter,outputMeter,nodes:[source,inputMeter,pitch,vocal,normalize,limiter,outputMeter]};
      this.graph=graph;
      // Default mix is dry, and gain remains unity until explicitly enabled.
      vocal.parameters.get('mix').value=0;
      normalize.port.postMessage({type:'SET_ENABLED',enabled:false});
      vocal.port.onmessage=({data})=>{ if(this.graph===graph&&data?.type==='ANALYSIS') this.report({monoLike:(data.metrics.inputChannelCount??2)===1,inputChannelCount:data.metrics.inputChannelCount??2}); };
      normalize.port.onmessage=({data})=>{ if(this.graph===graph&&data?.type==='LOUDNESS_ANALYSIS') this.report(data.metrics); };
      graph.timer=setInterval(()=>{
        if(this.graph!==graph) return;
        const input=new Float32Array(inputMeter.fftSize),output=new Float32Array(outputMeter.fftSize),spectrum=new Float32Array(outputMeter.frequencyBinCount);
        inputMeter.getFloatTimeDomainData(input);outputMeter.getFloatTimeDomainData(output);outputMeter.getFloatFrequencyData(spectrum);
        let peak=1;for(let i=2;i<spectrum.length;i++) if(spectrum[i]>spectrum[peak]) peak=i;
        const rms=buffer=>Math.sqrt(buffer.reduce((sum,n)=>sum+n*n,0)/buffer.length);
        this.report({inputRms:rms(input),outputRms:rms(output),peakHz:peak*context.sampleRate/outputMeter.fftSize,limiterReductionDb:limiter.reduction});
      },250);
      for(const track of stream.getTracks()) track.onended=()=>{
        if(this.graph!==graph) return;
        void this.stop().then(()=>this.report({captureStatus:'installed_idle'}));
      };
      await context.resume();
      if(epoch!==this.epoch) throw new Error('ยกเลิกการเริ่มระบบเสียงแล้ว');
    } catch(error) {
      if(this.graph?.stream===stream) await this.stop();
      else { stream?.getTracks().forEach(track=>track.stop()); await context?.close().catch(()=>{}); }
      throw error;
    }
  }
  async apply(type,payload={}) {
    if(type==='STOP_AUDIO') { await this.stop(); return; }
    if(type==='START_AUDIO') { await this.start(); return; }
    const g=this.graph;if(!g) throw new Error('ระบบเสียงยังไม่เริ่ม');
    switch(type) {
      case 'SET_PITCH': this.key=payload.semitones;g.pitch.port.postMessage({type,semitones:this.key});break;
      case 'SET_PLAYBACK_RATE': break; // Source transport already preserves pitch; do not compensate twice.
      case 'RESET_TRACK':
        this.key=0;g.pitch.port.postMessage({type:'RESET'});g.vocal.parameters.get('mix').setTargetAtTime(0,g.context.currentTime,0.02);g.normalize.port.postMessage({type:'RESET',preserveGain:false});break;
      case 'SET_VOCAL_CUT':g.vocal.parameters.get('mix').setTargetAtTime(payload.enabled?1:0,g.context.currentTime,0.02);break;
      case 'SET_PRESET':g.vocal.port.postMessage({type,preset:payload.preset});break;
      case 'SET_LOUDNESS_NORMALIZE':g.normalize.port.postMessage({type:'SET_ENABLED',enabled:payload.enabled});break;
      case 'SET_PLAYER_VOLUME':g.normalize.port.postMessage({type,volume:payload.volume,muted:payload.muted});break;
      default:throw new Error('Unsupported audio command');
    }
  }
}
