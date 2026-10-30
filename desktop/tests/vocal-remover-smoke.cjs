const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {instrumentRecording,recordComparison}=require('./vocal-recording.cjs');
const {getVocalModel}=require('../lib/vocal-models.cjs');
const profile=getVocalModel(process.env.KARAOKE_VOCAL_MODEL||'fast');
const url=process.env.KARAOKE_PLAYER_URL||'http://127.0.0.1:3001/player';
async function wait(read,check,label,timeout=30000){const until=Date.now()+timeout;let last;while(Date.now()<until){last=await read();if(check(last))return last;await new Promise(r=>setTimeout(r,100));}throw new Error(`${label}: ${JSON.stringify(last)}`);}
(async()=>{
 const env={...process.env,KARAOKE_PLAYER_URL:url,KARAOKE_USER_DATA:fs.mkdtempSync(path.join(os.tmpdir(),'karaoke-live-ai-'))};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:process.env.KARAOKE_EXECUTABLE||require('electron'),args:process.env.KARAOKE_EXECUTABLE?[]:[path.resolve(__dirname,'..')],env,timeout:60000});
 let shell,remote;
 try{
  shell=await wait(async()=>app.context().pages().find(p=>p.url()==='karaoke-app://app/ui/index.html'),Boolean,'Shell');
  remote=await wait(async()=>app.context().pages().find(p=>p.url().startsWith(url)),Boolean,'Player');
  const state=async()=>(await shell.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS'))).state;
  const media=expression=>app.evaluate(async({webContents},{url,expression})=>{
   const contents=webContents.getAllWebContents().find(w=>w.getURL().startsWith(url));
   const frame=contents.mainFrame.frames.find(f=>/^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\//.test(f.url));
   return frame?.executeJavaScript(expression);
  },{url,expression});
  await wait(()=>remote.locator('body').innerText(),text=>/ROOM:\s*[A-Z0-9]{6}/.test(text),'Room');
  const originalModel=(await state()).vocalModelId;
  await remote.evaluate(()=>window.postMessage({source:'karaoke-hub-page',version:1,type:'SET_VOCAL_MODEL',payload:{modelId:'hq5'}},location.origin));
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal((await state()).vocalModelId,originalModel,'Remote Player cannot select a native model');
  await shell.locator('#vocal-model').selectOption(profile.id);
  await shell.locator('#version-mv').click();await remote.getByRole('combobox').fill(process.env.KARAOKE_VOCAL_QUERY||'ขอใจเธอแลกเบอร์โทร');
  await remote.getByRole('button',{name:'ค้นหา MV',exact:true}).click();await remote.getByRole('option').first().click();
  const track=await wait(state,s=>s.currentVersionType==='mv'&&s.currentQueueItemId,'MV selected');
  await wait(state,s=>s.vocalModelId===profile.id&&s.vocalRemoverReady===true,'Real GPU runtime prepared',20000);
  if(process.argv.includes('--record'))await instrumentRecording(app);
  await shell.locator('#audio').click();await wait(state,s=>s.captureStatus==='capturing_original'&&s.inputRms>.001,'Captured MV audio');
  const startSeconds=Number(process.env.KARAOKE_VOCAL_START_SECONDS||45);assert.ok(Number.isFinite(startSeconds)&&startSeconds>=0&&startSeconds<=600);
  await media(`(()=>{const video=document.querySelector("video.html5-main-video")||document.querySelector("video");video.currentTime=${startSeconds};return true;})()`);
  await wait(()=>media('(()=>{const v=document.querySelector("video.html5-main-video")||document.querySelector("video");return{ready:v.readyState,time:v.currentTime,seeking:v.seeking,paused:v.paused};})()'),s=>s?.ready>=2&&!s.seeking&&!s.paused&&s.time>=startSeconds,'Vocal section ready');
  const started=Date.now();await shell.locator('#vocal-remover').click();
  const running=await wait(state,s=>s.vocalRemoverStatus==='on'||s.vocalRemoverStatus==='error','Live AI output',profile.startupDeadlineMs+2000);
  assert.equal(running.vocalRemoverStatus,'on',JSON.stringify(running));
  assert.ok(running.vocalRemoverStartDelayMs<=profile.startupDeadlineMs,JSON.stringify(running));assert.ok(Date.now()-started<profile.startupDeadlineMs+200,'Actual first processed output meets its selected profile deadline');
  const visible=await wait(()=>media('window.__karaokeVocalVideo?.snapshot()'),s=>s?.lastLatencyMs>=profile.delayMs-100,'Delayed video output',2000);
  assert.ok(visible.lastLatencyMs<profile.delayMs+500,JSON.stringify(visible));
  assert.ok(Math.abs(visible.sourceTime-visible.displayTime-profile.delayMs/1000)<.3,JSON.stringify(visible));
  assert.equal(visible.videoBufferMode,profile.videoBufferMode);
  await wait(state,s=>s.outputRms>.001,'Instrumental audio is non-silent');
  console.log('Measured timing',{firstOutputMs:running.vocalRemoverStartDelayMs,videoDelayMs:Math.round(visible.lastLatencyMs)});
  if(process.argv.includes('--screenshots')){
   const directory=path.resolve(__dirname,'../../build/verification');fs.mkdirSync(directory,{recursive:true});
   for(const width of [1440,960]){
    await app.evaluate(({BrowserWindow},width)=>{const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()==='karaoke-app://app/ui/index.html');if(window.isMinimized())window.restore();if(window.isMaximized())window.unmaximize();window.show();window.setContentSize(width,900);},width);
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.deepEqual(await shell.evaluate(()=>[...document.querySelectorAll('header button')].filter(button=>{const rect=button.getBoundingClientRect();return rect.right>innerWidth||rect.left<0;}).map(button=>button.id)),[],'Live AI toolbar fits window');
    const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()==='karaoke-app://app/ui/index.html').capturePage()).toPNG().toString('base64'));
    fs.writeFileSync(path.join(directory,`vocal-packaged-${width}.png`),Buffer.from(png,'base64'));
    await remote.screenshot({path:path.join(directory,`vocal-player-${width}.png`)});
   }
  }
  if(process.argv.includes('--long')){
   if(process.argv.includes('--extended')){
    await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).pause()');
    await wait(state,s=>s.vocalRemoverStatus==='paused','Pre-long-run pause');
    await media(`(document.querySelector("video.html5-main-video")||document.querySelector("video")).currentTime=${startSeconds}`);
    await wait(()=>media('!(document.querySelector("video.html5-main-video")||document.querySelector("video")).seeking'),Boolean,'Pre-long-run seek');
    await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).play()');
    await wait(state,s=>s.vocalRemoverStatus==='on','Pre-long-run resumed AI',profile.startupDeadlineMs+2000);
   }
   const seconds=Number(process.env.KARAOKE_VOCAL_LONG_SECONDS||90);assert.ok(seconds>=1&&seconds<=600);const until=Date.now()+seconds*1000;let samples=0;
   const source=await media('(()=>{const v=document.querySelector("video.html5-main-video")||document.querySelector("video");return {time:v.currentTime,duration:v.duration};})()');
   assert.ok(source.duration-source.time>seconds+5,`MV must cover the full continuous test: ${JSON.stringify(source)}`);
   let maxEncodedBytes=0,maxPackets=0,maxEncodeQueue=0,maxDecodeQueue=0,maxMemoryKiB=0;
   while(Date.now()<until){const current=await state();assert.equal(current.vocalRemoverStatus,'on',JSON.stringify(current));assert.equal(current.vocalRemoverEnabled,true);
    const video=await media('window.__karaokeVocalVideo?.snapshot()');assert.ok(video,'Delayed video stays active');
    if(profile.videoBufferMode==='encoded'){const codec=video.codecBuffer;assert.ok(codec,JSON.stringify(video));assert.ok(codec.encodedBytes<=64*1024*1024&&codec.bufferedFrames<=512&&codec.pendingEncodes<=4&&codec.pendingDecodes<=4,JSON.stringify(codec));maxEncodedBytes=Math.max(maxEncodedBytes,codec.encodedBytes);maxPackets=Math.max(maxPackets,codec.bufferedFrames);maxEncodeQueue=Math.max(maxEncodeQueue,codec.encoderQueue);maxDecodeQueue=Math.max(maxDecodeQueue,codec.decoderQueue);}
    if(samples%10===0){const memory=await app.evaluate(({app})=>app.getAppMetrics().reduce((sum,metric)=>sum+(metric.memory?.workingSetSize||0),0));maxMemoryKiB=Math.max(maxMemoryKiB,memory);}
    await new Promise(resolve=>setTimeout(resolve,500));samples++;}
   console.log('PASS continuous live AI processing',{seconds,samples,maxEncodedBytes,maxPackets,maxEncodeQueue,maxDecodeQueue,maxMemoryKiB});
  }
  if(process.argv.includes('--record'))console.log('Recorded comparison',await recordComparison(app,path.resolve(__dirname,`../../build/verification/vocal-comparison-${profile.id}`),{delaySeconds:profile.delayMs/1000,durationMs:profile.id==='hq5'?30000:10000}));
  await shell.locator('#version-karaoke').click();
  assert.equal((await state()).vocalRemoverEnabled,true);assert.equal((await state()).currentQueueItemId,track.currentQueueItemId);
  assert.equal(await remote.getByRole('combobox').evaluate(el=>document.activeElement===el&&document.hasFocus()),true);
  for(const id of ['pitch-up','pitch-down','tempo-up','tempo-down','reset']){
   await shell.locator(`#${id}`).click();await wait(()=>shell.locator('#reset').isEnabled(),Boolean,`${id} complete`);
   assert.equal((await state()).vocalRemoverEnabled,true);
  }
  if(process.argv.includes('--switch')){
   if(process.env.KARAOKE_VOCAL_TRACE){await media('(()=>{window.__vocalTrace=[];const v=document.querySelector("video.html5-main-video")||document.querySelector("video");for(const kind of ["pause","play","playing","seeking","seeked","ended"])v.addEventListener(kind,()=>window.__vocalTrace.push({kind,paused:v.paused,ended:v.ended,time:v.currentTime,at:Date.now()}));})()');await remote.evaluate(()=>{window.__vocalMessages=[];window.addEventListener('message',event=>{if(event.data?.type==='VOCAL_PLAYBACK_STATE')window.__vocalMessages.push({at:Date.now(),...event.data.payload});});});}
   const other=getVocalModel(profile.id==='hq5'?'fast':'hq5');
   await shell.locator('#pitch-up').click();await shell.locator('#tempo-up').click();
   const beforeSwitch=await state();
   await shell.locator('#vocal-model').selectOption(other.id);
   await wait(state,s=>s.vocalModelId===other.id&&s.vocalRemoverStatus==='on','Other model automatically resumes',25000);
   const switched=await state();assert.equal(switched.currentQueueItemId,track.currentQueueItemId);assert.equal(switched.pitchSemitones,beforeSwitch.pitchSemitones);assert.equal(switched.playbackRate,beforeSwitch.playbackRate);
   assert.ok(switched.vocalRemoverStartDelayMs<=other.startupDeadlineMs);
   await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).pause()');
   await wait(state,s=>s.vocalRemoverStatus==='paused','Other mode paused before switching');
   if(process.env.KARAOKE_VOCAL_TRACE)console.log('Paused before selection',await state(),await media('window.__vocalTrace'));
   await shell.locator('#vocal-model').selectOption(profile.id);
   await wait(state,s=>s.vocalModelId===profile.id&&s.vocalRemoverReady&&s.vocalResumePending,'Paused model is ready without starting playback',20000);
   assert.equal((await state()).vocalRemoverEnabled,false);assert.equal(await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).paused'),true);
   await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).play()');
   await wait(state,s=>s.vocalRemoverStatus==='on','Selected mode resumes after the user plays',profile.startupDeadlineMs+2000);
   await shell.locator('#vocal-model').selectOption(other.id);
   await wait(()=>shell.locator('#audio').isEnabled(),Boolean,'Stop available while model prepares');
   await shell.locator('#audio').click();await wait(state,s=>s.captureStatus==='installed_idle','Stop cancels pending model resume');
   await wait(state,s=>s.vocalModelId===other.id&&s.vocalRemoverReady,'Selected model finishes preparing',20000);
   assert.equal((await state()).vocalRemoverEnabled,false);
   await shell.locator('#audio').click();await wait(state,s=>s.captureStatus==='capturing_original','Original capture restarted');
   assert.equal((await state()).vocalRemoverEnabled,false,'Starting capture does not revive cancelled AI intent');
   await shell.locator('#vocal-model').selectOption(profile.id);await wait(state,s=>s.vocalModelId===profile.id&&s.vocalRemoverReady,'Original selected profile ready',20000);
   await shell.locator('#reset').click();
   await shell.locator('#vocal-remover').click();await wait(state,s=>s.vocalRemoverStatus==='on','Chosen model explicitly enabled again',profile.startupDeadlineMs+2000);
   assert.equal(JSON.parse(fs.readFileSync(path.join(env.KARAOKE_USER_DATA,'vocal-settings.json'),'utf8')).modelId,profile.id);
   console.log('PASS real model switching, key/tempo preservation, saved choice and Stop during preparation');
  }
  if(process.argv.includes('--extended')){
   await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).pause()');
   await wait(state,s=>s.vocalRemoverStatus==='paused','AI paused');
   await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).currentTime=60');
   await wait(()=>media('!(document.querySelector("video.html5-main-video")||document.querySelector("video")).seeking'),Boolean,'Paused seek decoded');
   await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).play()');
   const resumed=await wait(state,s=>s.vocalRemoverStatus==='on'||s.vocalRemoverStatus==='error','AI resumed',profile.startupDeadlineMs+2000);
   assert.equal(resumed.vocalRemoverStatus,'on',JSON.stringify(resumed));
  }
  const beforeOff=await media('window.__karaokeVocalVideo.snapshot()');
  const offAt=Date.now(),offRate=(await state()).playbackRate;
  await shell.locator('#vocal-remover').click();
  await wait(state,s=>!s.vocalRemoverEnabled,'Original restored');
  assert.equal(await media('Boolean(window.__karaokeVocalVideo)'),false);
  const restoredTime=await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).currentTime');
  const forward=restoredTime-beforeOff.displayTime,elapsed=(Date.now()-offAt)/1000;
  assert.ok(forward>=-.5&&forward<=elapsed*offRate+.5,`Original playback position preserved including ${elapsed}s of normal playback: ${restoredTime} vs ${beforeOff.displayTime}`);
  if(process.argv.includes('--extended')){
   await shell.locator('#vocal-remover').click();await wait(state,s=>s.vocalRemoverStatus==='on','AI enabled again',profile.startupDeadlineMs+2000);
   await media('(()=>{const video=document.querySelector("video.html5-main-video")||document.querySelector("video");video.currentTime=video.duration-1.5;})()');
   await wait(()=>media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).ended'),Boolean,'Source ended',6000);
   await new Promise(resolve=>setTimeout(resolve,600));
   assert.equal((await state()).currentQueueItemId,track.currentQueueItemId,'The delayed musical tail is not cut off');
   await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).currentTime=45');
   await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).play()');
   await wait(state,s=>s.vocalRemoverStatus==='on'||!s.currentVideoId,'AI resumes after seeking back during the delayed tail',profile.startupDeadlineMs+2000);
   await new Promise(resolve=>setTimeout(resolve,1000));
   assert.equal((await state()).currentQueueItemId,track.currentQueueItemId,'An old delayed end cannot skip the same MV after playback restarts');
   await media('(()=>{const video=document.querySelector("video.html5-main-video")||document.querySelector("video");video.currentTime=video.duration-1.5;})()');
   await wait(()=>media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).ended'),Boolean,'Source ended again',6000);
   await wait(state,s=>!s.currentVideoId&&!s.vocalRemoverEnabled,'Visible delayed song ended',profile.delayMs+5500);
  }
  console.log('PASS actual GPU vocal removal on MV, selected profile deadline, delayed video, independent search selection, keyboard focus and original restoration',{modelId:profile.id});
  await remote.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'End',code:'End',bubbles:true,cancelable:true})));
 }catch(error){if(shell)console.error('State',await shell.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS')));if(remote){console.error((await remote.locator('body').innerText()).slice(-1000));if(process.env.KARAOKE_VOCAL_TRACE){console.error('Player transport trace',await remote.evaluate(()=>window.__vocalMessages));console.error('Media trace',await app.evaluate(async({webContents},url)=>{const w=webContents.getAllWebContents().find(w=>w.getURL().startsWith(url));return w.mainFrame.frames.find(f=>/^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\//.test(f.url))?.executeJavaScript('window.__vocalTrace');},url));}}throw error;}
 finally{await app.close();}
 if(process.argv.includes('--persistence')){
  const reopened=await electron.launch({executablePath:process.env.KARAOKE_EXECUTABLE||require('electron'),args:process.env.KARAOKE_EXECUTABLE?[]:[path.resolve(__dirname,'..')],env,timeout:60000});
  try{const shell=await wait(async()=>reopened.context().pages().find(p=>p.url()==='karaoke-app://app/ui/index.html'),Boolean,'Relaunched shell');
   const saved=await shell.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS'));assert.equal(saved.state.vocalModelId,profile.id);assert.equal(saved.state.vocalRemoverEnabled,false);assert.equal(saved.state.captureStatus,'installed_idle');console.log('PASS selected model persists across a real relaunch; capture and AI remain off');
  }finally{await reopened.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
