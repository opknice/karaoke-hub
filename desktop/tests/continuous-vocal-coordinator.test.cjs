const {test}=require('node:test'),assert=require('node:assert/strict');
const {ContinuousVocalCoordinator}=require('../lib/continuous-vocal-coordinator.cjs');
const turn=()=>new Promise(r=>setImmediate(r));
function setup(options={}){
 const track={videoId:'abcdefghijk',queueItemId:'queue-1',versionType:'mv',active:true,playing:true,origin:'https://karaoke-hub-nu.vercel.app'};
 const audio=[],frames=[],states=[],captures=[],videoCalls=[],workerResets=[],bridges=[];let now=1000;
 const worker={ready:true,reset:e=>workerResets.push(e),feed:()=>true};
 const video={start:async config=>videoCalls.push({type:'start',config}),stop:async config=>videoCalls.push({type:'stop',config}),reset:async config=>videoCalls.push({type:'reset',config}),pause:async()=>{videoCalls.push({type:'pause'});return{paused:true};},resume:async()=>{videoCalls.push({type:'resume'});return{paused:false};},snapshot:async()=>({active:true,paused:false,sourceEnded:false,lastLatencyMs:8000,displayTime:12})};
 const coordinator=new ContinuousVocalCoordinator({worker,video,getTrack:()=>track,ensureCapture:async config=>captures.push(config),sendAudio:async(type,payload)=>audio.push({type,payload}),sendResult:p=>frames.push(p),publish:p=>states.push(p),setBridge:b=>bridges.push(b),now:()=>now,...options});
 const packet=(kind,paused=false)=>({kind,paused,time:20,epoch:coordinator.sessionEpoch,token:coordinator.token});
 return{coordinator,track,worker,video,audio,frames,states,captures,videoCalls,workerResets,bridges,packet,setNow:value=>{now=value;}};
}
test('preparation arms held capture before source playback; toggles and AI epochs retain raw/video timeline',async()=>{
 const s=setup();try{
  await s.coordinator.prepare(s.track);assert.equal(s.captures.length,1);assert.equal(s.videoCalls.length,0,'Source is not ready during preflight');
  await s.coordinator.attachVideo();assert.equal(s.videoCalls[0].config.continuous,true);assert.equal(s.videoCalls[0].config.delayMs,8000);
  const epoch=s.coordinator.epoch,session=s.coordinator.sessionEpoch;
  await s.coordinator.setRemoval(true);await s.coordinator.setRemoval(false);await s.coordinator.suspendAi();
  assert.equal(s.captures.length,1);assert.deepEqual(s.videoCalls.map(c=>c.type),['start']);assert.equal(s.coordinator.sessionEpoch,session);
  s.coordinator.result({epoch,startFrame:0,pcm:new Float32Array(2)});assert.equal(s.frames.length,0);
  await s.coordinator.beginAi();s.coordinator.result({epoch:s.coordinator.epoch,startFrame:0,pcm:new Float32Array(2)});assert.equal(s.frames.length,1);
  assert.equal(s.coordinator.feed({epoch:s.coordinator.epoch,sessionEpoch:session,sequence:0,pcm:new Float32Array(88200)}),true,'Background AI feeds while removal is off');
 }finally{await s.coordinator.stopSession({restorePosition:false});}
});
test('late/failed AI stops only subtraction and continues delayed original session',async()=>{
 const s=setup();try{await s.coordinator.prepare(s.track);await s.coordinator.attachVideo();await s.coordinator.setRemoval(true);
  await s.coordinator.failure('slow AI',s.coordinator.epoch);assert.equal(s.coordinator.active,true);assert.equal(s.coordinator.enabled,false);
  assert.equal(s.videoCalls.filter(c=>c.type==='stop'||c.type==='reset').length,0);assert.equal(s.captures.length,1);assert.equal(s.states.at(-1).vocalRemoverError,'slow AI');
 }finally{await s.coordinator.stopSession({restorePosition:false});}
});
test('pause/resume freezes retained clocks without resetting AI, raw or video',async()=>{
 const s=setup();try{await s.coordinator.prepare(s.track);await s.coordinator.attachVideo();const epoch=s.coordinator.epoch,session=s.coordinator.sessionEpoch;
  await s.coordinator.transport(s.packet('pause',true));await s.coordinator.transport(s.packet('pause',true));await s.coordinator.transport(s.packet('play',false));
  assert.equal(s.videoCalls.filter(c=>c.type==='pause').length,1);assert.equal(s.videoCalls.filter(c=>c.type==='resume').length,1);
  assert.equal(s.coordinator.epoch,epoch);assert.equal(s.coordinator.sessionEpoch,session);assert.equal(s.captures.length,1);assert.equal(s.videoCalls.filter(c=>c.type==='reset').length,0);
 }finally{await s.coordinator.stopSession({restorePosition:false});}
});
test('seek while paused starts a new generation and ignores stale frames/results',async()=>{
 const s=setup();try{await s.coordinator.prepare(s.track);await s.coordinator.attachVideo();const old=s.packet('seeking',true),epoch=s.coordinator.epoch;
  await s.coordinator.transport(old);await s.coordinator.transport({...old,kind:'seeked',time:60});
  assert.ok(s.coordinator.sessionEpoch>old.epoch);assert.ok(s.coordinator.epoch>epoch);assert.equal(s.videoCalls.filter(c=>c.type==='reset').length,1);
  assert.ok(s.audio.some(c=>c.type==='PREPARE_VOCAL_SESSION'));s.coordinator.result({epoch,pcm:new Float32Array(2)});assert.equal(s.frames.length,0);
  await s.coordinator.transport({...old,kind:'play',paused:false});assert.equal(s.videoCalls.filter(c=>c.type==='resume').length,0);
  await s.coordinator.transport(s.packet('play',false));assert.equal(s.videoCalls.filter(c=>c.type==='resume').length,1);
 }finally{await s.coordinator.stopSession({restorePosition:false});}
});
test('Stop during preflight revokes pending capture and later worker readiness cannot revive the session',async()=>{
 let release;const gate=new Promise(r=>{release=r;});const s=setup({ensureCapture:()=>gate});
 const pending=s.coordinator.prepare(s.track);await turn();await s.coordinator.stopSession({restorePosition:false});release();await assert.rejects(pending,error=>error.name==='AbortError');
 await s.coordinator.beginAi();assert.equal(s.coordinator.active,false);assert.equal(s.audio.filter(c=>c.type==='BEGIN_VOCAL_AI').length,0);assert.equal(s.videoCalls.filter(c=>c.type==='start').length,0);
});
test('unready worker intent expires without stopping original playback',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});const s=setup();s.worker.ready=false;
 try{await s.coordinator.prepare(s.track);await s.coordinator.setRemoval(true);assert.equal(s.coordinator.enabled,true);context.mock.timers.tick(32001);await turn();assert.equal(s.coordinator.enabled,false);assert.equal(s.coordinator.active,true);assert.ok(s.states.at(-1).vocalRemoverError);}
 finally{await s.coordinator.stopSession({restorePosition:false});}
});
test('continuous session state is queue-bound and background ready is distinct from audible removal',async()=>{
 const s=setup();try{await s.coordinator.prepare(s.track);const id=s.coordinator.session.id,epoch=s.coordinator.epoch;
  s.coordinator.audioState({continuousSessionId:'old',vocalSessionEpoch:s.coordinator.sessionEpoch,vocalBufferStatus:'playing'});assert.notEqual(s.states.at(-1).vocalBufferStatus,'playing');
  s.coordinator.audioState({continuousSessionId:id,vocalSessionEpoch:s.coordinator.sessionEpoch,vocalEpoch:epoch,vocalAiStatus:'ready'});assert.equal(s.states.at(-1).vocalSignalReady,true);assert.equal(s.states.at(-1).vocalRemoverEnabled,false);
  await s.coordinator.setRemoval(true);s.coordinator.audioState({continuousSessionId:id,vocalSessionEpoch:s.coordinator.sessionEpoch,vocalEpoch:epoch,vocalAiStatus:'on'});assert.equal(s.states.at(-1).vocalRemoverStatus,'on');
  s.track.queueItemId='other';assert.equal(s.coordinator.feed({epoch,sessionEpoch:s.coordinator.sessionEpoch,sequence:0,pcm:new Float32Array(88200)}),false);
 }finally{await s.coordinator.stopSession({restorePosition:false});}
});
