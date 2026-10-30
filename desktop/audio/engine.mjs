import vocalModels from './assets/vocal-models.json' with {type:'json'};
const validSession=payload=>Number.isSafeInteger(payload.sessionEpoch)&&payload.sessionEpoch>0&&payload.sessionEpoch<2**31&&typeof payload.sessionId==='string'&&payload.sessionId.length>=8&&payload.sessionId.length<=128;
export class AudioEngine {
  constructor(report,{feedVocal=()=>{}}={}) { this.report=report;this.feedVocal=feedVocal; this.epoch=0; this.graph=null; this.key=0; }
  async stop() {
    ++this.epoch;
    const graph=this.graph; this.graph=null; this.key=0;
    if (!graph) return;
    clearInterval(graph.timer);
    for(const track of graph.stream.getTracks()) { track.onended=null; track.stop(); }
    for(const node of graph.nodes) node.disconnect();
    await graph.context.close().catch(()=>{});
  }
  async start(generation,configuration={}) {
    if(configuration.buffered&&!validSession(configuration))throw new Error('Invalid buffered playback session');
    await this.stop();
    const epoch=this.epoch;
    const report=patch=>this.report(patch,generation);
    let stream, context;
    try {
      stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      if(epoch!==this.epoch) throw new Error('ยกเลิกการเริ่มระบบเสียงแล้ว');
      if(!stream.getAudioTracks().length) throw new Error('ไม่ได้รับเสียงจาก Player');
      context=new AudioContext({latencyHint:'interactive',sampleRate:44100});
      await context.audioWorklet.addModule(new URL('./pitch-processor.js',import.meta.url));
      await context.audioWorklet.addModule(new URL('./vocal-processor.js',import.meta.url));
      if(epoch!==this.epoch) throw new Error('ยกเลิกการเริ่มระบบเสียงแล้ว');
      const options={channelCount:2,channelCountMode:'max',outputChannelCount:[2]};
      const source=context.createMediaStreamSource(stream);
      const pitch=new AudioWorkletNode(context,'desktop-pitch',options);
      if(configuration.buffered&&context.sampleRate!==44100)throw new Error('อุปกรณ์เสียงไม่รองรับบัฟเฟอร์ที่ 44100 Hz');
      const vocal=new AudioWorkletNode(context,'desktop-vocal',{...options,processorOptions:configuration.buffered?{continuousSessionEpoch:configuration.sessionEpoch}: {}});
      const inputMeter=context.createAnalyser(), outputMeter=context.createAnalyser();
      inputMeter.fftSize=2048; outputMeter.fftSize=8192;
      source.connect(inputMeter).connect(vocal).connect(pitch).connect(outputMeter).connect(context.destination);
      const graph={stream,context,pitch,vocal,vocalEpoch:0,sessionEpoch:configuration.buffered?configuration.sessionEpoch:0,sessionId:configuration.buffered?configuration.sessionId:null,vocalProfile:vocalModels.fast,inputMeter,outputMeter,nodes:[source,inputMeter,vocal,pitch,outputMeter]};
      this.graph=graph;
      vocal.port.onmessage=({data})=>{
        if(this.graph!==graph)return;
        if(data?.type==='continuous-state'){
          if(!graph.sessionEpoch||data.sessionEpoch!==graph.sessionEpoch)return;
          if(data.kind==='session')report({continuousSessionId:graph.sessionId,vocalSessionEpoch:graph.sessionEpoch,vocalBufferActive:data.status!=='off',vocalBufferStatus:data.status,vocalPlaybackDelayMs:8000});
          if(data.kind==='ai'&&graph.vocalEpoch&&data.epoch===graph.vocalEpoch)report({continuousSessionId:graph.sessionId,vocalSessionEpoch:graph.sessionEpoch,vocalEpoch:data.epoch,vocalAiStatus:data.status,vocalAiError:data.error??null});
          return;
        }
        if(!graph.vocalEpoch||data?.epoch!==graph.vocalEpoch||(graph.sessionEpoch&&data.sessionEpoch!==graph.sessionEpoch))return;
        if(data.type==='pcm')this.feedVocal({epoch:data.epoch,sequence:data.sequence,pcm:data.pcm,...(graph.sessionEpoch?{sessionEpoch:graph.sessionEpoch}:{})});
        if(data.type==='vocal-state')report({vocalRemoverStatus:data.status,vocalEpoch:data.epoch,
          vocalRemoverDelayMs:data.delayFrames?data.delayFrames/context.sampleRate*1000:graph.vocalProfile.delayMs,vocalRemoverError:data.error??null,
          vocalOutputLatencyMs:1000*((context.baseLatency||0)+(context.outputLatency||0))+(this.key?1024/context.sampleRate*1000:0)});
      };
      graph.timer=setInterval(()=>{
        if(this.graph!==graph) return;
        const input=new Float32Array(inputMeter.fftSize),output=new Float32Array(outputMeter.fftSize),spectrum=new Float32Array(outputMeter.frequencyBinCount);
        inputMeter.getFloatTimeDomainData(input);outputMeter.getFloatTimeDomainData(output);outputMeter.getFloatFrequencyData(spectrum);
        let peak=1;for(let i=2;i<spectrum.length;i++) if(spectrum[i]>spectrum[peak]) peak=i;
        const rms=buffer=>Math.sqrt(buffer.reduce((sum,n)=>sum+n*n,0)/buffer.length);
        report({inputRms:rms(input),outputRms:rms(output),peakHz:peak*context.sampleRate/outputMeter.fftSize});
      },250);
      for(const track of stream.getTracks()) track.onended=()=>{
        if(this.graph!==graph) return;
        const stopping=this.stop();
        const stoppedEpoch=this.epoch;
        void stopping.then(()=>{if(this.epoch===stoppedEpoch&&!this.graph) report({captureStatus:'installed_idle'});});
      };
      await context.resume();
      if(epoch!==this.epoch) throw new Error('ยกเลิกการเริ่มระบบเสียงแล้ว');
    } catch(error) {
      if(this.graph?.stream===stream) await this.stop();
      else { stream?.getTracks().forEach(track=>track.stop()); await context?.close().catch(()=>{}); }
      throw error;
    }
  }
  async apply(type,payload={},generation) {
    if(type==='STOP_AUDIO') { await this.stop(); return; }
    if(type==='START_AUDIO') { await this.start(generation,payload); return; }
    const g=this.graph;if(!g) throw new Error('ระบบเสียงยังไม่เริ่ม');
    switch(type) {
      case 'PREPARE_VOCAL_SESSION':
        if(!validSession(payload)||g.context.sampleRate!==44100)throw new Error('Invalid buffered playback session');
        g.sessionEpoch=payload.sessionEpoch;g.sessionId=payload.sessionId;g.vocalEpoch=0;
        g.vocal.port.postMessage({type:'BEGIN_SESSION',sessionEpoch:g.sessionEpoch});break;
      case 'BEGIN_VOCAL_AI': {
        const id=payload.modelId;
        if(!g.sessionEpoch||typeof id!=='string'||!Object.hasOwn(vocalModels,id))throw new Error('Unknown continuous model/session');
        const profile=vocalModels[id];g.vocalProfile=profile;g.vocalEpoch=payload.epoch;
        g.vocal.port.postMessage({type:'BEGIN_AI',epoch:payload.epoch,spanMode:profile.spanMode,maxResultFrames:profile.maxResultFrames});break;
      }
      case 'SET_VOCAL_MIX':g.vocal.port.postMessage({type:'SET_MIX',enabled:payload.enabled});break;
      case 'END_VOCAL_AI':g.vocalEpoch=0;g.vocal.port.postMessage({type:'END_AI'});break;
      case 'PAUSE_VOCAL_SESSION':g.vocal.port.postMessage({type:'PAUSE_SESSION'});break;
      case 'RESUME_VOCAL_SESSION':g.vocal.port.postMessage({type:'RESUME_SESSION'});break;
      case 'CLOSE_VOCAL_SESSION':g.vocalEpoch=0;g.sessionEpoch=0;g.sessionId=null;g.vocal.port.postMessage({type:'END_SESSION'});break;
      case 'START_VOCAL': {
        if(g.context.sampleRate!==44100)throw new Error('อุปกรณ์เสียงไม่รองรับการตัดเสียงร้องที่ 44100 Hz');
        const id=payload.modelId??'fast';
        if(typeof id!=='string'||!Object.hasOwn(vocalModels,id))throw new Error('Unknown vocal model profile');
        const profile=vocalModels[id];g.vocalProfile=profile;
        g.vocalEpoch=payload.epoch;
        const startFrame=Math.ceil((g.context.currentTime+Math.max(0,(payload.startWallMs-Date.now())/1000))*g.context.sampleRate);
        g.vocal.port.postMessage({type:'ENABLE',epoch:payload.epoch,startFrame,delaySeconds:profile.delayMs/1000,spanMode:profile.spanMode,maxResultFrames:profile.maxResultFrames});break;
      }
      case 'VOCAL_RESULT':
        if(payload.epoch===g.vocalEpoch)g.vocal.port.postMessage({...payload,type:'RESULT'},[payload.pcm.buffer]);break;
      case 'PAUSE_VOCAL':g.vocal.port.postMessage({type:'PAUSE'});break;
      case 'STOP_VOCAL':g.vocalEpoch=0;g.vocal.port.postMessage({type:'DISABLE'});break;
      case 'SET_PITCH': this.key=payload.semitones;g.pitch.port.postMessage({type,semitones:this.key});break;
      case 'SET_PLAYBACK_RATE': break; // Source transport already preserves pitch; do not compensate twice.
      case 'RESET_TRACK':
        g.vocalEpoch=0;g.sessionEpoch=0;g.sessionId=null;g.vocal.port.postMessage({type:'DISABLE'});
        this.key=0;g.pitch.port.postMessage({type:'RESET'});break;
      default:throw new Error('Unsupported audio command');
    }
  }
}
