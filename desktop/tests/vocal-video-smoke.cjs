const {_electron:electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {installVideoDelay}=require('../lib/vocal-video.cjs');
async function wait(read,check,label,timeout=10000){let last;const until=Date.now()+timeout;while(Date.now()<until){last=await read();if(check(last))return last;await new Promise(r=>setTimeout(r,50));}throw new Error(`${label}: ${JSON.stringify(last)}`);}
const bytes=fs.readFileSync(path.resolve(__dirname,'../../build/verification/vocal-video-fixture.mp4'));
const server=http.createServer((request,response)=>{
 if(request.url==='/clip.mp4'){
  const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range??'');
  if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;response.writeHead(206,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1});response.end(bytes.subarray(start,end+1));}
  else{response.writeHead(200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':bytes.length});response.end(bytes);}
 }
 else {response.setHeader('Content-Type','text/html');response.end('<video src="/clip.mp4" autoplay muted controls width="320" height="180"></video>');}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/player`;
 const env={...process.env,KARAOKE_PLAYER_URL:url,KARAOKE_USER_DATA:fs.mkdtempSync(path.join(os.tmpdir(),'karaoke-video-delay-'))};delete env.ELECTRON_RUN_AS_NODE;
 let app;
 try{
  app=await electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env});
  const remote=await wait(async()=>app.context().pages().find(p=>p.url().startsWith(url)),Boolean,'Player');
  await wait(()=>remote.evaluate(()=>document.querySelector('video')?.readyState),value=>value>=2,'Fixture decoded');
  await remote.evaluate(({source,config})=>(0,eval)(`(${source})`)(config),{source:installVideoDelay.toString(),config:{epoch:1,token:'test-video-token',parentOrigin:new URL(url).origin,startWallMs:Date.now()+100,delayMs:4500}});
  const state=()=>remote.evaluate(()=>window.__karaokeVocalVideo.snapshot());
  await wait(state,s=>s.bufferedFrames>0,'Video buffered');
  const delayed=await wait(state,s=>s.lastLatencyMs>=4400,'Delayed frame rendered',7000);
  assert.ok(delayed.lastLatencyMs<4900,JSON.stringify(delayed));assert.ok(delayed.bufferedFrames<=139);
  assert.ok(Math.abs(delayed.sourceTime-delayed.displayTime-4.5)<.35,JSON.stringify(delayed));
  await remote.evaluate(()=>document.querySelector('video').pause());
  await wait(state,s=>s.paused,'Pause recognized');
  const paused=await remote.evaluate(()=>window.__karaokeVocalVideo.pauseAndRewind());
  assert.ok(Math.abs(paused.sourceTime-paused.displayTime)<.15,`Pause keeps the visible playback position: ${JSON.stringify(paused)}`);
  await remote.evaluate(async()=>{await document.querySelector('video').play();await window.__karaokeVocalVideo.prepareResume({});window.__karaokeVocalVideo.reset({epoch:2,startWallMs:Date.now()+100,resume:true});});
  const resumed=await wait(state,s=>s.epoch===2&&s.lastLatencyMs>=4400,'Resumed video synced',7000);
  assert.ok(Math.abs(resumed.displayTime-paused.displayTime)<.25,JSON.stringify(resumed));
  const result=await remote.evaluate(()=>window.__karaokeVocalVideo.stop({restorePosition:true}));
  assert.equal(result.bufferedFrames,0);assert.equal(await remote.locator('[data-karaoke-vocal-video]').count(),0);
  console.log('PASS raw video delay below 5 seconds, bounded frames, pause position and cleanup');
 }finally{if(app)await app.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
