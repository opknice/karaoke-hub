const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LiveVocalCoordinator}=require('../lib/vocal-coordinator.cjs');
function setup(options={}){
 const track={videoId:'abcdefghijk',queueItemId:'queue-1',versionType:'mv',active:true,searchVersion:'mv'};
 const audio=[],results=[],states=[],resets=[],videoCalls=[],bridge=[];
 const worker={ready:true,reset:epoch=>resets.push(epoch),feed:()=>true};
 const video={start:async(config)=>videoCalls.push({type:'start',config}),reset:async config=>videoCalls.push({type:'reset',config}),
  stop:async config=>videoCalls.push({type:'stop',config}),pauseAndRewind:async()=>videoCalls.push({type:'rewind'}),
  prepareResume:async config=>videoCalls.push({type:'resume',config}),
  snapshot:async()=>({active:true,paused:false,lastLatencyMs:4500,sourceEnded:false})};
 const coordinator=new LiveVocalCoordinator({worker,video,getTrack:()=>track,sendAudio:async(type,payload)=>audio.push({type,payload}),sendResult:packet=>results.push(packet),publish:state=>states.push(state),setBridge:configuration=>bridge.push(configuration),...options});
 return{coordinator,track,worker,video,audio,results,states,resets,videoCalls,bridge};
}
test('live processing binds to the playing MV, not its search selector, and revokes late output',async()=>{
 const s=setup();try{
  await s.coordinator.start();const epoch=s.resets.at(-1);
  assert.equal(s.audio.at(-1).type,'START_VOCAL');assert.equal(s.videoCalls.find(call=>call.type==='start').config.delayMs,4500);
  s.track.searchVersion='karaoke';
  s.coordinator.result({epoch,pcm:new Float32Array(2)});assert.equal(s.results.length,1);
  s.coordinator.audioState({vocalEpoch:epoch,vocalRemoverStatus:'on',vocalOutputLatencyMs:20});
  assert.equal(s.states.at(-1).vocalRemoverStatus,'on');
  await s.coordinator.stop({restorePosition:false});
  s.coordinator.result({epoch,pcm:new Float32Array(2)});assert.equal(s.results.length,1);
  assert.equal(s.states.at(-1).vocalRemoverEnabled,false);
 }finally{await s.coordinator.stop();}
});
test('unprepared workers, Karaoke tracks and inactive audio cannot start AI',async()=>{
 const s=setup();try{
  s.track.versionType='karaoke';await assert.rejects(s.coordinator.start(),/MV/);
  s.track.versionType='mv';s.worker.ready=false;await assert.rejects(s.coordinator.start(),/AI/);
  s.worker.ready=true;s.track.active=false;await assert.rejects(s.coordinator.start(),/เสียง/);
  assert.equal(s.audio.length,0);
 }finally{await s.coordinator.stop();}
});
test('pause and resume keep the visible position and start a fresh worker epoch',async()=>{
 const s=setup();try{
  await s.coordinator.start();const first=s.coordinator.epoch,token=s.bridge.at(-1).token;
  await s.coordinator.transport({epoch:first,token,kind:'pause',paused:true});
  assert.ok(s.videoCalls.some(call=>call.type==='rewind'));assert.equal(s.states.at(-1).vocalRemoverStatus,'paused');
  const pausedCalls=s.videoCalls.length;await s.coordinator.transport({epoch:first,token,kind:'pause',paused:true});
  assert.equal(s.videoCalls.length,pausedCalls,'Duplicate media/room pause notifications are idempotent');
  await s.coordinator.transport({epoch:first,token,kind:'play',paused:false});
  assert.ok(s.coordinator.epoch>first);assert.ok(s.videoCalls.some(call=>call.type==='reset'));
  assert.ok(s.videoCalls.some(call=>call.type==='resume'));
  s.coordinator.result({epoch:first,pcm:new Float32Array(2)});assert.equal(s.results.length,0);
 }finally{await s.coordinator.stop();}
});
test('seeking while paused resumes at the requested position instead of waiting forever for another seek event',async()=>{
 const s=setup();try{
  await s.coordinator.start();const epoch=s.coordinator.epoch,token=s.bridge.at(-1).token;
  await s.coordinator.transport({epoch,token,kind:'seeking',paused:true,time:90});
  await s.coordinator.transport({epoch,token,kind:'seeked',paused:true,time:90});
  await s.coordinator.transport({epoch,token,kind:'play',paused:false,time:90});
  assert.ok(s.coordinator.epoch>epoch);assert.equal(s.videoCalls.find(call=>call.type==='resume').config.atTime,90);
 }finally{await s.coordinator.stop();}
});
test('priming that misses its deadline returns to original audio with an explicit error',async()=>{
 const s=setup({startupDeadlineMs:25});try{
  await s.coordinator.start();await new Promise(resolve=>setTimeout(resolve,65));
  assert.equal(s.coordinator.enabled,false);assert.equal(s.states.at(-1).vocalRemoverStatus,'error');
  assert.ok(s.audio.some(call=>call.type==='STOP_VOCAL'));
 }finally{await s.coordinator.stop();}
});
