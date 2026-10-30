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
