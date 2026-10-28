import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudioEngine} from '../audio/engine.mjs';

test('an old track-ended close cannot report idle after a new capture starts', async () => {
  const navigatorDescriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const originalContext=globalThis.AudioContext, originalWorklet=globalThis.AudioWorkletNode;
  let closeOld,contexts=0;
  const events=[];
  class Node {
    constructor(){this.port={postMessage(){}};this.parameters=new Map([['mix',{value:0,setTargetAtTime(){}}]]);}
    connect(node){return node;}disconnect(){}
  }
  class Context {
    constructor(){this.number=++contexts;this.audioWorklet={addModule:async()=>{}};this.destination=new Node();this.currentTime=0;this.sampleRate=48000;}
    createMediaStreamSource(){return new Node();}
    createDynamicsCompressor(){const node=new Node();for(const p of ['threshold','knee','ratio','attack','release'])node[p]={value:0};return node;}
    createAnalyser(){return new Node();}
    async resume(){}
    close(){return this.number===1?new Promise(resolve=>{closeOld=resolve;}):Promise.resolve();}
  }
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getDisplayMedia:async()=>{
    const tracks=[{onended:null,stop(){}}];return{getTracks:()=>tracks,getAudioTracks:()=>tracks};
  }}}});
  globalThis.AudioContext=Context;globalThis.AudioWorkletNode=Node;
  const engine=new AudioEngine((patch,generation)=>events.push({patch,generation}));
  try {
    await engine.apply('START_AUDIO',{},1);
    engine.graph.stream.getTracks()[0].onended();
    await engine.apply('STOP_AUDIO',{},2);
    await engine.apply('START_AUDIO',{},3);
    const current=engine.graph;
    closeOld();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(engine.graph,current);
    assert.equal(events.filter(e=>e.patch.captureStatus==='installed_idle').length,0);
  } finally {
    closeOld?.();await engine.stop();
    if(navigatorDescriptor)Object.defineProperty(globalThis,'navigator',navigatorDescriptor);else delete globalThis.navigator;
    globalThis.AudioContext=originalContext;globalThis.AudioWorkletNode=originalWorklet;
  }
});
