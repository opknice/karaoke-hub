const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DesktopAudioController}=require('../lib/controller.cjs');
const {validateCommand}=require('../lib/policy.cjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function setup(options={}){
 const calls=[],selections=[];const controller=new DesktopAudioController({sendAudio:async()=>({ok:true}),setPlaybackRate:async rate=>rate,publish(){},setVocal:async enabled=>calls.push(enabled),selectVocalModel:id=>selections.push(id),...options});
 controller.update({currentVideoId:'abcdefghijk',currentQueueItemId:'queue-1',currentVersionType:'mv',vocalRemoverEligible:true,vocalRemoverReady:true,vocalRuntimeStatus:'ready',captureStatus:'capturing_original'});
 return{controller,calls,selections};
}
test('model settings default safely and persist only allowlisted choices',()=>{
 const {VocalModelSettings}=require('../lib/vocal-model-settings.cjs');const folder=fs.mkdtempSync(path.join(os.tmpdir(),'karaoke-model-settings-'));const file=path.join(folder,'settings.json'),settings=new VocalModelSettings(file);
 try{assert.equal(settings.read(),'fast');settings.write('hq5');assert.equal(new VocalModelSettings(file).read(),'hq5');assert.throws(()=>settings.write('../model'),/model|profile/i);assert.equal(settings.read(),'hq5');fs.writeFileSync(file,'{"modelId":"unknown"}');assert.equal(settings.read(),'fast');fs.writeFileSync(file,'invalid json');assert.equal(settings.read(),'fast');}finally{assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));fs.rmSync(folder,{recursive:true});}
});
test('model selection validates fixed IDs and restores original before preparing the new model',async()=>{
 assert.equal(validateCommand('SET_VOCAL_MODEL',{modelId:'hq5'}),true);for(const value of ['other','../model',{},null])assert.equal(validateCommand('SET_VOCAL_MODEL',{modelId:value}),false);
 const {controller:c,calls,selections}=setup();assert.equal(c.state.vocalModelId,'fast');await c.command('SET_VOCAL_REMOVER',{enabled:true});c.update({pitchSemitones:2,playbackRate:1.26});
 const result=await c.command('SET_VOCAL_MODEL',{modelId:'hq5'});assert.equal(result.ok,true);assert.deepEqual(selections,['hq5']);assert.equal(calls.at(-1),false);
 assert.equal(c.state.vocalRemoverEnabled,false);assert.equal(c.state.vocalRemoverReady,false);assert.equal(c.state.vocalModelId,'hq5');assert.equal(c.state.vocalRemoverDelayMs,8000);assert.equal(c.state.pitchSemitones,2);assert.equal(c.state.playbackRate,1.26);
 await c.vocalModelReady({modelId:'hq5',name:'GPU',denoise:true});await c.queue;assert.equal(c.state.vocalRemoverEnabled,true);assert.equal(calls.at(-1),true);
});
test('Stop or a new queue item while a model warms prevents automatic restart',async()=>{
 for(const cancel of ['stop','track','off']){
  const {controller:c,calls}=setup();await c.command('SET_VOCAL_REMOVER',{enabled:true});await c.command('SET_VOCAL_MODEL',{modelId:'hq5'});
  if(cancel==='stop')await c.command('STOP_AUDIO');if(cancel==='track')await c.command('TRACK_CHANGED',{youtubeVideoId:'lmnopqrstuv',queueItemId:'queue-2',versionType:'mv'});if(cancel==='off')await c.command('SET_VOCAL_REMOVER',{enabled:false});
  const before=calls.filter(Boolean).length;await c.vocalModelReady({modelId:'hq5',name:'GPU',denoise:true});await c.queue;
  assert.equal(c.state.vocalRemoverEnabled,false,cancel);assert.equal(calls.filter(Boolean).length,before,cancel);assert.equal(c.state.vocalModelId,'hq5');
 }
});
test('rapid choices revoke old ready callbacks and only the final model may resume',async()=>{
 const {controller:c,calls}=setup();await c.command('SET_VOCAL_REMOVER',{enabled:true});await c.command('SET_VOCAL_MODEL',{modelId:'hq5'});await c.command('SET_VOCAL_MODEL',{modelId:'fast'});
 await c.vocalModelReady({modelId:'hq5',name:'old GPU',denoise:true});assert.equal(c.state.vocalRemoverReady,false);assert.equal(c.state.vocalRemoverEnabled,false);
 await c.vocalModelReady({modelId:'fast',name:'GPU',denoise:true});await c.queue;assert.equal(c.state.vocalModelId,'fast');assert.equal(c.state.vocalRemoverEnabled,true);assert.equal(calls.filter(Boolean).length,2);
});
test('a failed HQ preparation leaves Fast selectable and switching while off does not enable removal',async()=>{
 const {controller:c,selections}=setup();await c.command('SET_VOCAL_MODEL',{modelId:'hq5'});c.vocalModelFailed('HQ unavailable','hq5');
 assert.equal(c.state.vocalRemoverReady,false);assert.equal(c.state.vocalRuntimeStatus,'error');assert.equal(c.state.vocalRemoverEnabled,false);
 const switching=c.command('SET_VOCAL_MODEL',{modelId:'fast'});await switching;assert.equal(selections.at(-1),'fast');await c.vocalModelReady({modelId:'fast',name:'GPU',denoise:true});await turn();assert.equal(c.state.vocalRemoverEnabled,false);assert.equal(c.state.vocalRemoverReady,true);
});

test('same-item MV eligibility revocation cancels a warming model before queued callbacks run',async()=>{
 const {controller:c}=setup();await c.command('SET_VOCAL_REMOVER',{enabled:true});await c.command('SET_VOCAL_MODEL',{modelId:'hq5'});
 const changed=c.command('TRACK_CHANGED',{youtubeVideoId:'abcdefghijk',queueItemId:'queue-1',versionType:'karaoke'});
 await c.vocalModelReady({modelId:'hq5',name:'GPU',denoise:true});await changed;await c.queue;
 assert.equal(c.state.vocalRemoverEnabled,false);assert.equal(c.state.vocalRemoverError,null,'A cancelled resume is not an attempted MV-only start');
});

test('switching a paused MV warms the model but waits for matching playback before resuming AI',async()=>{
 const {controller:c,calls}=setup();await c.command('SET_VOCAL_REMOVER',{enabled:true});c.update({vocalRemoverStatus:'paused'});await c.command('SET_VOCAL_MODEL',{modelId:'hq5'});
 await c.vocalModelReady({modelId:'hq5',name:'GPU',denoise:true});assert.equal(c.state.vocalRemoverEnabled,false,'Warming a paused MV must not attempt a playing-only start');assert.equal(c.state.vocalResumePending,true,'A paused automatic restart remains visible and cancellable');
 await c.vocalPlaybackState({youtubeVideoId:'abcdefghijk',queueItemId:'other',playing:true});assert.equal(c.state.vocalRemoverEnabled,false);
 await c.vocalPlaybackState({youtubeVideoId:'abcdefghijk',queueItemId:'queue-1',playing:true});await c.queue;assert.equal(c.state.vocalRemoverEnabled,true);assert.equal(calls.filter(Boolean).length,2);
});

test('Stop cancels automatic restart without discarding the latest selected model',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});let stopping=false;const selected=[];
 const {controller:c}=setup({setVocal:async enabled=>{if(!enabled&&stopping)await gate;},selectVocalModel:id=>selected.push(id)});
 await c.command('SET_VOCAL_REMOVER',{enabled:true});stopping=true;const choosing=c.command('SET_VOCAL_MODEL',{modelId:'hq5'});await turn();
 const stop=c.command('STOP_AUDIO');release();await choosing;await stop;
 assert.equal(c.state.vocalModelId,'hq5');assert.deepEqual(selected,['hq5']);await c.vocalModelReady({modelId:'hq5',name:'GPU',denoise:true});assert.equal(c.state.vocalRemoverEnabled,false);
});
