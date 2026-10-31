import {LiveVocalBuffer} from './vocal-buffer.mjs';
import {ContinuousVocalBuffer} from './continuous-vocal-buffer.mjs';
class DesktopVocalProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.live=new LiveVocalBuffer({sampleRate,
      onPcm:packet=>this.port.postMessage({type:'pcm',...packet},[packet.pcm.buffer]),
      onState:state=>this.port.postMessage({type:'vocal-state',...state}),
    });
    this.continuous=new ContinuousVocalBuffer({sampleRate,
      onPcm:packet=>this.port.postMessage({type:'pcm',...packet},[packet.pcm.buffer]),
      onState:state=>this.port.postMessage({type:'continuous-state',...state}),
    });
    if(options?.processorOptions?.continuousSessionEpoch)this.continuous.begin({sessionEpoch:options.processorOptions.continuousSessionEpoch});
    this.port.onmessage=({data})=>{
      try {
        if(data?.type==='BEGIN_SESSION'){this.live.disable();this.continuous.begin(data);}
        if(data?.type==='BEGIN_AI')this.continuous.beginAi(data);
        if(data?.type==='END_AI')this.continuous.endAi();
        if(data?.type==='SET_MIX')this.continuous.remove(data.enabled);
        if(data?.type==='SET_LEVEL')this.continuous.setLevel(data.level);
        if(data?.type==='PAUSE_SESSION')this.continuous.pause();
        if(data?.type==='RESUME_SESSION')this.continuous.resume();
        if(data?.type==='END_SESSION')this.continuous.disable();
        if(data?.type==='ENABLE')this.live.enable(data);
        if(data?.type==='DISABLE'){this.continuous.disable();this.live.disable();}
        if(data?.type==='PAUSE')this.live.pause();
        if(data?.type==='RESULT')(this.continuous.enabled?this.continuous:this.live).receive(data);
      }catch(error){this.port.postMessage({type:this.continuous.enabled?'continuous-state':'vocal-state',kind:'ai',sessionEpoch:this.continuous.sessionEpoch,epoch:data?.epoch,status:'error',error:error.message});}
    };
  }
  process(inputs,outputs) {
    const input=inputs[0],output=outputs[0];
    if(!output?.[0])return true;
    if(!input?.[0]){
      if(this.continuous.enabled){
        if(this.silence?.length!==output[0].length)this.silence=new Float32Array(output[0].length);
        this.continuous.process(this.silence,this.silence,output[0],output[1]??output[0],currentFrame);
      }else for(const channel of output)channel.fill(0);
      return true;
    }
    (this.continuous.enabled?this.continuous:this.live).process(input[0],input[1]??input[0],output[0],output[1]??output[0],currentFrame);
    return true;
  }
}
registerProcessor('desktop-vocal',DesktopVocalProcessor);
