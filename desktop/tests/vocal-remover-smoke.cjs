const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {instrumentRecording,recordComparison}=require('./vocal-recording.cjs');
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
  await shell.locator('#version-mv').click();await remote.getByRole('combobox').fill('ขอใจเธอแลกเบอร์โทร');
  await remote.getByRole('button',{name:'ค้นหา MV',exact:true}).click();await remote.getByRole('option').first().click();
  const track=await wait(state,s=>s.currentVersionType==='mv'&&s.currentQueueItemId,'MV selected');
  await wait(state,s=>s.vocalRemoverReady===true,'Real GPU runtime prepared',15000);
  if(process.argv.includes('--record'))await instrumentRecording(app);
  await shell.locator('#audio').click();await wait(state,s=>s.captureStatus==='capturing_original'&&s.inputRms>.001,'Captured MV audio');
  await media('(()=>{const video=document.querySelector("video.html5-main-video")||document.querySelector("video");video.currentTime=45;return true;})()');
  await wait(()=>media('(()=>{const v=document.querySelector("video.html5-main-video")||document.querySelector("video");return{ready:v.readyState,time:v.currentTime,seeking:v.seeking,paused:v.paused};})()'),s=>s?.ready>=2&&!s.seeking&&!s.paused&&s.time>=45,'Vocal section ready');
  const started=Date.now();await shell.locator('#vocal-remover').click();
  const running=await wait(state,s=>s.vocalRemoverStatus==='on'||s.vocalRemoverStatus==='error','Live AI output',7000);
  assert.equal(running.vocalRemoverStatus,'on',JSON.stringify(running));
  assert.ok(running.vocalRemoverStartDelayMs<=5000,JSON.stringify(running));assert.ok(Date.now()-started<5200,'Actual first processed output is within five seconds plus test polling');
  const visible=await wait(()=>media('window.__karaokeVocalVideo?.snapshot()'),s=>s?.lastLatencyMs>=4400,'Delayed video output',2000);
  assert.ok(visible.lastLatencyMs<4900,JSON.stringify(visible));
  assert.ok(Math.abs(visible.sourceTime-visible.displayTime-4.5)<.3,JSON.stringify(visible));
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
   const until=Date.now()+90000;let samples=0;
   while(Date.now()<until){const current=await state();assert.equal(current.vocalRemoverStatus,'on',JSON.stringify(current));assert.equal(current.vocalRemoverEnabled,true);await new Promise(resolve=>setTimeout(resolve,500));samples++;}
   console.log('PASS continuous live AI processing for 90 seconds',{samples});
  }
  if(process.argv.includes('--record'))console.log('Recorded comparison',await recordComparison(app,path.resolve(__dirname,'../../build/verification/vocal-comparison')));
  await shell.locator('#version-karaoke').click();
  assert.equal((await state()).vocalRemoverEnabled,true);assert.equal((await state()).currentQueueItemId,track.currentQueueItemId);
  assert.equal(await remote.getByRole('combobox').evaluate(el=>document.activeElement===el&&document.hasFocus()),true);
  for(const id of ['pitch-up','pitch-down','tempo-up','tempo-down','reset']){
   await shell.locator(`#${id}`).click();await wait(()=>shell.locator('#reset').isEnabled(),Boolean,`${id} complete`);
   assert.equal((await state()).vocalRemoverEnabled,true);
  }
  if(process.argv.includes('--extended')){
   await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).pause()');
   await wait(state,s=>s.vocalRemoverStatus==='paused','AI paused');
   await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).currentTime=60');
   await wait(()=>media('!(document.querySelector("video.html5-main-video")||document.querySelector("video")).seeking'),Boolean,'Paused seek decoded');
   await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).play()');
   const resumed=await wait(state,s=>s.vocalRemoverStatus==='on'||s.vocalRemoverStatus==='error','AI resumed',7000);
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
   await shell.locator('#vocal-remover').click();await wait(state,s=>s.vocalRemoverStatus==='on','AI enabled again',7000);
   await media('(()=>{const video=document.querySelector("video.html5-main-video")||document.querySelector("video");video.currentTime=video.duration-1.5;})()');
   await wait(()=>media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).ended'),Boolean,'Source ended',6000);
   await new Promise(resolve=>setTimeout(resolve,600));
   assert.equal((await state()).currentQueueItemId,track.currentQueueItemId,'The delayed musical tail is not cut off');
   await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).currentTime=45');
   await media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).play()');
   await wait(state,s=>s.vocalRemoverStatus==='on'||!s.currentVideoId,'AI resumes after seeking back during the delayed tail',7000);
   await new Promise(resolve=>setTimeout(resolve,1000));
   assert.equal((await state()).currentQueueItemId,track.currentQueueItemId,'An old delayed end cannot skip the same MV after playback restarts');
   await media('(()=>{const video=document.querySelector("video.html5-main-video")||document.querySelector("video");video.currentTime=video.duration-1.5;})()');
   await wait(()=>media('(document.querySelector("video.html5-main-video")||document.querySelector("video")).ended'),Boolean,'Source ended again',6000);
   await wait(state,s=>!s.currentVideoId&&!s.vocalRemoverEnabled,'Visible delayed song ended',10000);
  }
  console.log('PASS actual GPU vocal removal on MV, processed output <=5 seconds, delayed video, independent search selection, keyboard focus and original restoration');
  await remote.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'End',code:'End',bubbles:true,cancelable:true})));
 }catch(error){if(shell)console.error('State',await shell.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS')));if(remote)console.error((await remote.locator('body').innerText()).slice(-1000));throw error;}
 finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
