import {test} from 'node:test';
import assert from 'node:assert/strict';
test('a continuous session drains its delayed original tail even if upstream has no input channels',async()=>{
 const previous=Object.fromEntries(['AudioWorkletProcessor','registerProcessor','sampleRate','currentFrame'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));let Processor;
 globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(){}};}};globalThis.registerProcessor=(_name,ctor)=>{Processor=ctor;};globalThis.sampleRate=1000;globalThis.currentFrame=0;
 try{await import('../audio/vocal-processor.js');const processor=new Processor({processorOptions:{continuousSessionEpoch:1}});
  processor.port.onmessage({data:{type:'SET_LEVEL',level:25}});assert.equal(processor.continuous.vocalLevel,25);
  for(let block=0;block<10;block++)processor.process([[new Float32Array(100).fill(.25),new Float32Array(100).fill(.5)]],[[new Float32Array(100),new Float32Array(100)]]);
  let tail=0;for(let block=0;block<80;block++){const out=[new Float32Array(100),new Float32Array(100)];processor.process([], [out]);tail+=out[0].reduce((sum,v)=>sum+v,0);}
  assert.equal(tail,250,'All first-second original samples must drain after their eight-second delay');
 }finally{for(const [key,descriptor]of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
