import {LiveVocalBuffer} from './vocal-buffer.mjs';
class DesktopVocalProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.live=new LiveVocalBuffer({sampleRate,
      onPcm:packet=>this.port.postMessage({type:'pcm',...packet},[packet.pcm.buffer]),
      onState:state=>this.port.postMessage({type:'vocal-state',...state}),
    });
    this.port.onmessage=({data})=>{
      try {
        if(data?.type==='ENABLE')this.live.enable(data);
        if(data?.type==='DISABLE')this.live.disable();
        if(data?.type==='PAUSE')this.live.pause();
        if(data?.type==='RESULT')this.live.receive(data);
      }catch(error){this.port.postMessage({type:'vocal-state',epoch:data?.epoch,status:'error',error:error.message});}
    };
  }
  process(inputs,outputs) {
    const input=inputs[0],output=outputs[0];
    if(!output?.[0])return true;
    if(!input?.[0]){for(const channel of output)channel.fill(0);return true;}
    this.live.process(input[0],input[1]??input[0],output[0],output[1]??output[0],currentFrame);
    return true;
  }
}
registerProcessor('desktop-vocal',DesktopVocalProcessor);
