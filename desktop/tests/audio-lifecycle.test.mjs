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

test('live vocal audio schedules a common clock, feeds only current epoch PCM and clears on track reset',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const savedContext=globalThis.AudioContext,savedWorklet=globalThis.AudioWorkletNode;
  const worklets=[],fed=[],events=[];
  class Node {
    constructor(_context,name){this.name=name;this.messages=[];this.port={postMessage:message=>this.messages.push(message)};if(name)worklets.push(this);}
    connect(node){return node;}disconnect(){}
  }
  class Context {
    constructor(){this.audioWorklet={addModule:async()=>{}};this.destination=new Node();this.currentTime=1;this.sampleRate=44100;}
    createMediaStreamSource(){return new Node();}createAnalyser(){return new Node();}async resume(){}async close(){}
  }
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getDisplayMedia:async()=>{
    const tracks=[{stop(){}}];return{getTracks:()=>tracks,getAudioTracks:()=>tracks};
  }}}});globalThis.AudioContext=Context;globalThis.AudioWorkletNode=Node;
  const engine=new AudioEngine((patch,generation)=>events.push({patch,generation}),{feedVocal:packet=>fed.push(packet)});
  try{
    await engine.apply('START_AUDIO',{},1);
    await engine.apply('START_VOCAL',{epoch:4,startWallMs:Date.now()+200},1);
    const vocal=worklets.find(node=>node.name==='desktop-vocal');
    assert.equal(vocal.messages.at(-1).type,'ENABLE');assert.equal(vocal.messages.at(-1).epoch,4);
    assert.ok(vocal.messages.at(-1).startFrame>=44100&&vocal.messages.at(-1).startFrame<=57330);
    vocal.port.onmessage({data:{type:'pcm',epoch:3,sequence:0,pcm:new Float32Array(88200)}});
    vocal.port.onmessage({data:{type:'pcm',epoch:4,sequence:0,pcm:new Float32Array(88200)}});
    assert.equal(fed.length,1);
    await engine.apply('VOCAL_RESULT',{type:'result',epoch:4,startFrame:0,pcm:new Float32Array(2)},1);
    assert.equal(vocal.messages.at(-1).type,'RESULT','Worker packet names cannot override the audio worklet command');
    vocal.port.onmessage({data:{type:'vocal-state',epoch:4,status:'on',delayFrames:198450}});
    assert.equal(events.at(-1).patch.vocalRemoverStatus,'on');
    await engine.apply('RESET_TRACK',{},1);
    assert.equal(vocal.messages.at(-1).type,'DISABLE');
    vocal.port.onmessage({data:{type:'pcm',epoch:4,sequence:1,pcm:new Float32Array(88200)}});
    assert.equal(fed.length,1);
    await engine.apply('START_VOCAL',{epoch:5,startWallMs:Date.now()+100,modelId:'hq5'},1);
    assert.equal(vocal.messages.at(-1).delaySeconds,8);
    assert.equal(vocal.messages.at(-1).spanMode,'final');
    assert.equal(vocal.messages.at(-1).maxResultFrames,65280);
    vocal.port.onmessage({data:{type:'vocal-state',epoch:5,status:'preparing'}});
    assert.equal(events.at(-1).patch.vocalRemoverDelayMs,8000);
    await assert.rejects(()=>engine.apply('START_VOCAL',{epoch:6,modelId:'../other'},1),/model|profile/i);
    assert.equal(engine.graph.vocalEpoch,5,'A rejected profile does not revoke the active valid epoch');
  }finally{
    await engine.stop();if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;
    globalThis.AudioContext=savedContext;globalThis.AudioWorkletNode=savedWorklet;
  }
});
