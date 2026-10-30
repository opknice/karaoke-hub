const {test}=require('node:test'),assert=require('node:assert/strict');
const {DesktopAudioController}=require('../lib/controller.cjs');const {validateCommand}=require('../lib/policy.cjs');
const mv=(queue='q-1')=>({youtubeVideoId:'abcdefghijk',queueItemId:queue,versionType:'mv'}),turn=()=>new Promise(r=>setImmediate(r));
function setup(options={}){const audio=[],prepared=[],closed=[],mix=[],suspended=[];let n=0,c;
 c=new DesktopAudioController({supportsContinuousVocal:true,sendAudio:async(type,payload)=>{audio.push({type,payload});return options.sendAudio?options.sendAudio(type,payload):{ok:true};},setPlaybackRate:async r=>r,publish(){},
 setVocal:async enabled=>mix.push(enabled),suspendVocal:async()=>suspended.push(true),closePlayback:async config=>{closed.push(config);c.update({vocalBufferActive:false});},
 preparePlayback:async track=>{prepared.push(track);await c.ensureBufferedCapture({sessionEpoch:++n,sessionId:`session-${n}`});c.update({vocalBufferActive:true});},...options.constructorOptions});
 return{c,audio,prepared,closed,mix,suspended};}
test('native prepare accepts only fixed current-track fields and starts buffered capture before returning',async()=>{
 assert.equal(validateCommand('PREPARE_PLAYER_TRACK',mv()),true);assert.equal(validateCommand('PREPARE_PLAYER_TRACK',{...mv(),modelPath:'evil'}),false);
 const s=setup();const result=await s.c.command('PREPARE_PLAYER_TRACK',mv());assert.equal(result.ok,true,result.error);assert.equal(s.audio.find(a=>a.type==='START_AUDIO').payload.buffered,true);assert.equal(s.c.active,true);assert.equal(s.prepared.length,1);
 await s.c.command('PREPARE_PLAYER_TRACK',mv());assert.equal(s.prepared.length,1,'Repeated preflight for the same active track must not rebuild its timeline');
});
test('explicit Stop remains opted out across songs; cleanup/reload never creates an opt-out',async()=>{
 const s=setup();await s.c.command('PREPARE_PLAYER_TRACK',mv());await s.c.command('STOP_AUDIO');const count=s.prepared.length;
 await s.c.command('PREPARE_PLAYER_TRACK',mv('q-2'));assert.equal(s.prepared.length,count);assert.equal(s.c.active,false);
 await s.c.command('START_AUDIO');assert.equal(s.prepared.length,count+1);assert.equal(s.c.active,true);
 await s.c.disconnect();await s.c.command('PREPARE_PLAYER_TRACK',mv('q-3'));assert.equal(s.c.active,true);assert.equal(s.prepared.length,count+2);
});
test('pending model preparation accepts removal intent while keeping raw capture active',async()=>{
 const s=setup();await s.c.command('PREPARE_PLAYER_TRACK',mv());s.c.update({vocalRemoverReady:false,vocalRuntimeStatus:'loading'});
 const result=await s.c.command('SET_VOCAL_REMOVER',{enabled:true});assert.equal(result.ok,true,result.error);assert.equal(s.mix.at(-1),true);assert.equal(s.c.active,true);
});
test('Stop invalidates an in-flight buffered capture immediately rather than waiting for its acknowledgement',async()=>{
 let finish;const s=setup({sendAudio:type=>type==='START_AUDIO'?new Promise(r=>{finish=r;}):{ok:true}});
 const preparing=s.c.command('PREPARE_PLAYER_TRACK',mv());await turn();const stop=s.c.command('STOP_AUDIO');await turn();
 assert.ok(s.audio.some(a=>a.type==='STOP_AUDIO'),'Capture must be revoked before pending preflight resolves');finish({ok:true});await preparing;await stop;assert.equal(s.c.active,false);
});
