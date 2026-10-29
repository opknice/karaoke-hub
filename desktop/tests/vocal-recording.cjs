const fs=require('node:fs'),path=require('node:path');
async function instrumentRecording(app){
 await app.evaluate(async({webContents})=>{
  const host=webContents.getAllWebContents().find(contents=>contents.getURL()==='karaoke-app://app/audio/index.html');
  await host.executeJavaScript(`(()=>{
    const recording=window.__vocalRecording={};
    const create=AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource=function(...args){const node=Reflect.apply(create,this,args);recording.context=this;recording.input=node;return node;};
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(...args){if(args[0]===this.context.destination&&!recording.output)recording.output=this;return Reflect.apply(connect,this,args);};
  })()`);
 });
}
async function recordComparison(app,outputDirectory){
 const recording=await app.evaluate(async({webContents})=>{
  const host=webContents.getAllWebContents().find(contents=>contents.getURL()==='karaoke-app://app/audio/index.html');
  return host.executeJavaScript(`(async()=>{
    const {context,input,output}=window.__vocalRecording;
    const capture=node=>{
      const processor=context.createScriptProcessor(4096,2,2),mute=context.createGain();mute.gain.value=0;
      const result={left:[],right:[],frames:0,start:null,processor,mute,node};
      processor.onaudioprocess=event=>{if(result.start===null)result.start=event.playbackTime;result.left.push(event.inputBuffer.getChannelData(0).slice());result.right.push(event.inputBuffer.getChannelData(1).slice());result.frames+=event.inputBuffer.length;};
      node.connect(processor);processor.connect(mute);mute.connect(context.destination);return result;
    };
    const original=capture(input),instrumental=capture(output);
    await new Promise(resolve=>setTimeout(resolve,10000));
    const encode=result=>{
      result.processor.onaudioprocess=null;result.node.disconnect(result.processor);result.processor.disconnect();result.mute.disconnect();
      const pcm=new Float32Array(result.frames*2);let offset=0;
      for(let chunk=0;chunk<result.left.length;chunk++)for(let frame=0;frame<result.left[chunk].length;frame++){pcm[offset++]=result.left[chunk][frame];pcm[offset++]=result.right[chunk][frame];}
      const bytes=new Uint8Array(pcm.buffer);let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
      return {pcm:btoa(binary),frames:result.frames,start:result.start};
    };
    return {sampleRate:context.sampleRate,original:encode(original),instrumental:encode(instrumental)};
  })()`);
 });
 const floats=encoded=>{const bytes=Buffer.from(encoded,'base64');return new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));};
 const raw=floats(recording.original.pcm),processed=floats(recording.instrumental.pcm);
 const offset=Math.round((recording.original.start+4.5-recording.instrumental.start)*recording.sampleRate);
 const frames=Math.min(recording.original.frames,recording.instrumental.frames-offset);
 if(offset<0||frames<recording.sampleRate*4)throw new Error('Not enough aligned diagnostic audio');
 const original=raw.subarray(0,frames*2),instrumental=processed.subarray(offset*2,(offset+frames)*2);
 let peak=0;for(const pcm of [original,instrumental])for(const sample of pcm)peak=Math.max(peak,Math.abs(sample));
 const gain=peak>.99?.99/peak:1;
 function wav(pcm){const bytes=Buffer.alloc(44+pcm.length*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(recording.sampleRate,24);bytes.writeUInt32LE(recording.sampleRate*4,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(pcm.length*2,40);for(let i=0;i<pcm.length;i++)bytes.writeInt16LE(Math.round(Math.max(-1,Math.min(1,pcm[i]*gain))*32767),44+i*2);return bytes;}
 fs.mkdirSync(outputDirectory,{recursive:true});
 fs.writeFileSync(path.join(outputDirectory,'Original.wav'),wav(original));fs.writeFileSync(path.join(outputDirectory,'Instrumental.wav'),wav(instrumental));
 const rms=pcm=>Math.sqrt(pcm.reduce((sum,sample)=>sum+sample*sample,0)/pcm.length);
 const report={sampleRate:recording.sampleRate,frames,durationSeconds:frames/recording.sampleRate,sharedGain:gain,originalRms:rms(original),instrumentalRms:rms(instrumental),alignedWithDelaySeconds:4.5,rawStart:recording.original.start,processedStart:recording.instrumental.start};
 fs.writeFileSync(path.join(outputDirectory,'comparison.json'),JSON.stringify(report,null,2));return report;
}
module.exports={instrumentRecording,recordComparison};
