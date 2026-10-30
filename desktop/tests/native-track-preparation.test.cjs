const {test}=require('node:test'),assert=require('node:assert/strict');
test('preflight cancellation is scoped to its request and cleanup cannot latch user Stop',async()=>{
 const {NativeTrackPreparation}=require('../lib/native-track-preparation.cjs');const completions=[],cleanups=[];
 const controller={command:()=>new Promise(resolve=>completions.push(resolve)),disconnect:async()=>cleanups.push(true)};
 const preparation=new NativeTrackPreparation(controller),track={youtubeVideoId:'abcdefghijk',queueItemId:'q-1',versionType:'mv'};
 const old=preparation.prepare(track,'old'),latest=preparation.prepare(track,'new');assert.equal(preparation.cancel('old'),false);assert.equal(cleanups.length,0);
 completions[0]({ok:true,state:{old:true}});const stale=await old;assert.equal(stale.cancelled,true);assert.equal(stale.ok,true);assert.equal(stale.state,undefined,'An old response must not overwrite the new session state');
 assert.equal(preparation.cancel('new'),true);assert.equal(cleanups.length,1);completions[1]({ok:true,state:{}});assert.equal((await latest).cancelled,true);
});
test('playing media seals preparation so a late timeout cannot stop an active song',async()=>{
 const {NativeTrackPreparation}=require('../lib/native-track-preparation.cjs');let stopped=0;const manager=new NativeTrackPreparation({command:async()=>({ok:true}),disconnect:async()=>stopped++});const track={youtubeVideoId:'abcdefghijk',queueItemId:'q-1',versionType:'mv'};
 await manager.prepare(track,'prep');manager.ready({youtubeVideoId:track.youtubeVideoId,queueItemId:'other'});assert.equal(manager.current.id,'prep');manager.ready(track);assert.equal(manager.cancel('prep'),false);assert.equal(stopped,0);
});
test('explicit Stop during real controller preflight returns cancellation rather than ordinary-playback fallback',async()=>{
 const {NativeTrackPreparation}=require('../lib/native-track-preparation.cjs'),{DesktopAudioController}=require('../lib/controller.cjs');let finish,controller;
 controller=new DesktopAudioController({supportsContinuousVocal:true,sendAudio:async type=>type==='START_AUDIO'?new Promise(r=>{finish=r;}):{ok:true},setPlaybackRate:async r=>r,publish(){},setVocal:async()=>{},closePlayback:async()=>{},
  preparePlayback:async()=>{await controller.ensureBufferedCapture({sessionEpoch:1,sessionId:'session-test'});controller.update({vocalBufferActive:true});}});
 const manager=new NativeTrackPreparation(controller),track={youtubeVideoId:'abcdefghijk',queueItemId:'q-1',versionType:'mv'};
 const preparing=manager.prepare(track,'pending');await new Promise(r=>setImmediate(r));const stop=controller.command('STOP_AUDIO');finish({ok:true});const result=await preparing;await stop;
 assert.equal(result.cancelled,true,'Stop must not look like recoverable capture failure to hosted loading');assert.equal(result.state,undefined);assert.equal(controller.active,false);
 const next=await manager.prepare({...track,queueItemId:'q-2'},'after-stop');assert.equal(next.cancelled,undefined,'An earlier opt-out still permits a newly selected MV to play ordinary original');
});
