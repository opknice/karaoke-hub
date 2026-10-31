const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {instrumentRecording,recordComparison}=require('./vocal-recording.cjs');
const profile=process.env.KARAOKE_VOCAL_MODEL||'fast',url=process.env.KARAOKE_PLAYER_URL||'http://127.0.0.1:3002/player';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(read,check,label,timeout=30000){const end=Date.now()+timeout;let last;while(Date.now()<end){last=await read();if(check(last))return last;await sleep(100);}throw new Error(`${label}: ${JSON.stringify(last)}`);}
(async()=>{
 const env={...process.env,KARAOKE_PLAYER_URL:url,KARAOKE_USER_DATA:fs.mkdtempSync(path.join(os.tmpdir(),'karaoke-continuous-'))};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:process.env.KARAOKE_EXECUTABLE||require('electron'),args:process.env.KARAOKE_EXECUTABLE?[]:[path.resolve(__dirname,'..')],env,timeout:60000});
 app.on('console',message=>console.log('Native:',message.text()));
 let shell,remote,recording;
 try{
  shell=await wait(async()=>app.context().pages().find(p=>p.url()==='karaoke-app://app/ui/index.html'),Boolean,'Shell');
  remote=await wait(async()=>app.context().pages().find(p=>p.url().startsWith(url)),Boolean,'Player');
  if(process.argv.includes('--levels-debug'))await app.evaluate(({ipcMain,webContents})=>{const original=ipcMain._invokeHandlers?.get('shell-command');if(original)ipcMain._invokeHandlers.set('shell-command',(event,message)=>{if(message?.type!=='REQUEST_STATUS')console.log('Diagnostic shell command',message?.type,JSON.stringify(message?.payload));return original(event,message);});for(const contents of webContents.getAllWebContents())if(contents.getURL().includes('/player'))contents.on('did-start-navigation',(_event,url,_inPlace,main)=>console.log('Diagnostic navigation',url,main));});
  const state=async()=>(await shell.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS'))).state;
  const media=expression=>app.evaluate(async({webContents},{url,expression})=>{const contents=webContents.getAllWebContents().find(w=>w.getURL().startsWith(url));return contents.mainFrame.frames.find(f=>/^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\//.test(f.url))?.executeJavaScript(expression);},{url,expression});
  await wait(()=>remote.locator('body').innerText(),text=>/ROOM:\s*[A-Z0-9]{6}/.test(text),'Room');
  if(process.env.KARAOKE_BUFFER_COVER_TRANSPARENT)await remote.addStyleTag({content:'[data-native-buffering]{background:rgba(0,0,0,.95)!important}'});
  if(process.argv.includes('--record'))await instrumentRecording(app);
  if(process.argv.includes('--cancel-preflight'))await app.evaluate(async({webContents})=>{const host=webContents.getAllWebContents().find(w=>w.getURL()==='karaoke-app://app/audio/index.html');await host.executeJavaScript(`(()=>{const original=navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);let first=true;navigator.mediaDevices.getDisplayMedia=async options=>{if(first){first=false;await new Promise(resolve=>setTimeout(resolve,2000));}return original(options);};})()`);});
  await shell.locator('#vocal-model').selectOption(profile);await shell.locator('#version-mv').click();
  await remote.getByRole('combobox').fill(process.env.KARAOKE_VOCAL_QUERY||'ขอใจเธอแลกเบอร์โทร');await remote.getByRole('button',{name:'ค้นหา MV',exact:true}).click();await remote.getByRole('option').first().click();
  if(process.argv.includes('--cancel-preflight')){
   await wait(()=>shell.locator('#audio').innerText(),text=>text==='ยกเลิกเตรียมเสียง','Held preflight capture');await wait(()=>shell.locator('#audio').isEnabled(),Boolean,'Cancel preparation button');await shell.locator('#audio').click();await wait(state,s=>s.captureStatus==='installed_idle'&&!s.vocalBufferActive,'Preflight cancelled');await sleep(2200);
   assert.equal(await media(`(document.querySelector('video.html5-main-video')||document.querySelector('video'))?.currentTime??0`),0,'Cancelled preflight must not start the selected MV');assert.equal((await state()).vocalBufferActive,false);
   await shell.locator('#audio').click();console.log('PASS explicit cancellation prevents source start; manual Start retries the selected MV');
  }
  await wait(state,s=>s.vocalBufferActive&&s.captureStatus==='capturing_original','Automatic held MV capture',15000);
  const primed=await wait(state,s=>s.vocalRemoverStatus==='error'||(s.vocalVideoReady&&s.vocalSignalReady&&s.outputRms>.001),'Initial delayed original and background AI',20000);assert.notEqual(primed.vocalRemoverStatus,'error',JSON.stringify(primed));
  const startSeconds=Number(process.env.KARAOKE_VOCAL_START_SECONDS||45);assert.ok(Number.isFinite(startSeconds)&&startSeconds>=0&&startSeconds<600);
  await media(`(document.querySelector('video.html5-main-video')||document.querySelector('video')).currentTime=${startSeconds}`);
  await wait(state,s=>s.vocalVideoReady&&s.vocalSignalReady&&s.vocalDisplayTime>=startSeconds,'Seeked timeline primed',20000);
  const initial=await state(),sessionId=initial.continuousSessionId,sessionEpoch=initial.vocalSessionEpoch;
  await media(`(()=>{window.__continuousSeeks=0;const v=document.querySelector('video.html5-main-video')||document.querySelector('video');v.addEventListener('seeking',()=>window.__continuousSeeks++);})()`);
  const snapshot=await media('window.__karaokeVocalVideo.snapshot()');assert.equal(snapshot.videoBufferMode,'encoded');assert.ok(Math.abs(snapshot.sourceTime-snapshot.displayTime-8)<.4,JSON.stringify(snapshot));
  const checkTimeline=async()=>{const current=await state();assert.equal(current.continuousSessionId,sessionId);assert.equal(current.vocalSessionEpoch,sessionEpoch);assert.equal(current.vocalBufferActive,true);assert.equal(await media('window.__continuousSeeks'),0,'Removal/model toggles must never seek');return current;};
  const toggleOn=async()=>{const before=(await state()).vocalDisplayTime;await shell.locator('#vocal-remover').click();const on=await wait(state,s=>s.vocalRemoverStatus==='on'||s.vocalRemoverStatus==='error','Audible AI on',25000);assert.equal(on.vocalRemoverStatus,'on',JSON.stringify(on));assert.ok(on.vocalDisplayTime>=before-.05,'Displayed musical position cannot rewind');await checkTimeline();return on;};
  const toggleOff=async()=>{await shell.locator('#vocal-remover').click();await wait(state,s=>!s.vocalRemoverEnabled,'Delayed original restored');await checkTimeline();};
  if(process.argv.includes('--record')){
   recording=recordComparison(app,path.resolve(__dirname,`../../build/verification/continuous-${profile}`),{delaySeconds:8,durationMs:40000});
   await sleep(10000);const on=await toggleOn();console.log('Recorded toggle on',{modelId:profile,toggleDelayMs:on.vocalRemoverStartDelayMs});await sleep(8000);await toggleOff();
  }else{const on=await toggleOn();console.log('Continuous removal activation',{modelId:profile,toggleDelayMs:on.vocalRemoverStartDelayMs,videoDelayMs:snapshot.lastLatencyMs});await sleep(1500);await toggleOff();}
  if(process.argv.includes('--levels')){
   await toggleOn();const slider=shell.locator('#vocal-level');await slider.waitFor();
   await slider.evaluate(el=>{window.__levelEvents=[];for(const type of ['pointerdown','pointerup','pointercancel','input','change','blur','keydown','keyup'])el.addEventListener(type,e=>{window.__levelEvents.push({type,value:el.value,trusted:e.isTrusted,buttons:e.buttons,key:e.key,pointer:e.pointerId,x:e.clientX});if(window.__levelEvents.length>100)window.__levelEvents.shift();});});
   const adjust=async level=>{await slider.evaluate((el,level)=>{el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));el.value=String(level);el.dispatchEvent(new Event('input',{bubbles:true}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));},level);await wait(state,s=>s.vocalLevel===level,'Selected singer level');await checkTimeline();await wait(()=>remote.getByRole('combobox').evaluate(el=>document.hasFocus()&&document.activeElement===el),Boolean,'Search focus after singer level');};
   for(const level of [0,25,50,75,100])await adjust(level);
   await shell.getByRole('button',{name:'ลดเสียงร้อง 1%',exact:true}).click();await wait(state,s=>s.vocalLevel===99,'One-percent down');await shell.getByRole('button',{name:'เพิ่มเสียงร้อง 1%',exact:true}).click();await wait(state,s=>s.vocalLevel===100,'One-percent up');
   await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('shell-command');ipcMain._invokeHandlers.set('shell-command',async(event,message)=>{if(message?.type==='SET_PITCH'&&message.payload?.semitones===1)await new Promise(resolve=>setTimeout(resolve,600));return original(event,message);});});
   await shell.locator('#pitch-up').click();assert.equal(await slider.isDisabled(),true,'A pending toolbar command must prevent overlapping slider adjustment');await wait(state,s=>s.pitchSemitones===1,'Delayed pitch command');await wait(()=>slider.isEnabled(),Boolean,'Slider restored after toolbar completion');await wait(()=>remote.getByRole('combobox').evaluate(el=>document.hasFocus()&&document.activeElement===el),Boolean,'Other command completion returns focus');await shell.locator('#pitch-down').click();await wait(state,s=>s.pitchSemitones===0,'Pitch restored');await wait(()=>slider.isEnabled(),Boolean,'Level control ready');
   await app.evaluate(({webContents})=>webContents.getAllWebContents().find(w=>w.getURL()==='karaoke-app://app/ui/index.html').focus());
   const box=await slider.boundingBox();await shell.mouse.move(box.x+5,box.y+box.height/2);await shell.mouse.down();await shell.mouse.move(box.x+box.width-5,box.y+box.height/2,{steps:15});assert.equal(await app.evaluate(({webContents})=>webContents.getFocusedWebContents()?.getURL()),'karaoke-app://app/ui/index.html','Dragging must retain native focus');await shell.mouse.up();await wait(()=>remote.getByRole('combobox').evaluate(el=>document.hasFocus()&&document.activeElement===el),Boolean,'Drag release returns search focus');
   await adjust(75);await toggleOff();assert.equal((await state()).vocalLevel,75);assert.equal(await slider.isDisabled(),true);await toggleOn();assert.equal((await state()).vocalLevel,75);
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='karaoke-app://app/ui/index.html').setContentSize(960,800));
   const layout=await shell.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,controls:['vocal-level-control','vocal-model','audio','vocal-remover'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return{id,x:r.x,right:r.right,top:r.top,bottom:r.bottom};})}));assert.equal(layout.overflow,false,JSON.stringify(layout));assert.ok(layout.controls.every(r=>r.x>=0&&r.right<=layout.width&&r.top>=0&&r.bottom<=112),JSON.stringify(layout));
   const screenshot=path.resolve(__dirname,`../../build/verification/vocal-level-${profile}-960.png`);fs.mkdirSync(path.dirname(screenshot),{recursive:true});await shell.screenshot({path:screenshot});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='karaoke-app://app/ui/index.html').setContentSize(1440,900));console.log('PASS singer levels/endpoints/one-percent/drag-focus/off-on/no seek/min960 layout',{profile,screenshot});
   await toggleOff();
  }
  if(process.argv.includes('--switch')){
   if(recording)await sleep(5000);
   const other=profile==='fast'?'hq5':'fast',before=(await state()).vocalDisplayTime;
   await shell.locator('#vocal-model').selectOption(other);await wait(()=>shell.locator('#vocal-remover').isEnabled(),Boolean,'AI request available while model loads');await toggleOn();
   const current=await checkTimeline();assert.equal(current.vocalModelId,other);if(process.argv.includes('--levels'))assert.equal(current.vocalLevel,75);assert.ok(current.vocalDisplayTime>=before+7,'Original music advances throughout new model preparation');
   await sleep(1000);await toggleOff();console.log('PASS original kept playing while a different model prepared; same session, no seek');
  }
  let control;
  if(process.argv.includes('--paused-switch')||process.argv.includes('--extended')){
   const controlUrl=new URL('/queue',url).href;
   await app.evaluate(async({BrowserWindow},controlUrl)=>{const control=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,partition:'persist:karaoke-player'}});await control.loadURL(controlUrl);},controlUrl);
   control=await wait(async()=>app.context().pages().find(p=>p.url()===controlUrl),Boolean,'Shared playback controls');await control.getByRole('button',{name:'Pause',exact:true}).waitFor();
  }
  if(process.argv.includes('--paused-switch')){
   await control.getByRole('button',{name:'Pause',exact:true}).click();await wait(state,s=>s.vocalBufferStatus==='paused','Pause before model change');
   const paused=await media('window.__karaokeVocalVideo.snapshot().displayTime'),other=profile==='fast'?'hq5':'fast';
   await shell.locator('#vocal-model').selectOption(other);await wait(state,s=>s.vocalModelId===other&&s.vocalRemoverReady,'New model prepared while paused',45000);
   await checkTimeline();assert.equal(await media('window.__karaokeVocalVideo.snapshot().displayTime'),paused,'Model preparation must retain paused position');
   await shell.locator('#vocal-remover').click();await sleep(300);
   if(process.argv.includes('--levels')){await shell.locator('#vocal-level').evaluate(el=>{el.value='50';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});await wait(state,s=>s.vocalLevel===50,'Paused level adjustment');}
   assert.equal(await media('window.__karaokeVocalVideo.snapshot().displayTime'),paused,'Pending removal/level change must not resume playback');
   await control.getByRole('button',{name:'Resume',exact:true}).click();await wait(state,s=>s.vocalDisplayTime>paused+.1,'Retained resume after model change',2500);
   const on=await wait(state,s=>s.vocalRemoverStatus==='on'||s.vocalRemoverStatus==='error','Paused model choice becomes audible',20000);assert.equal(on.vocalRemoverStatus,'on',JSON.stringify(on));await checkTimeline();await toggleOff();
   console.log('PASS model change while paused retains position; immediate original resume then automatic AI without seek');
  }
  if(recording){console.log('Transition recording',await recording);recording=null;}
  await shell.locator('#version-karaoke').click();await checkTimeline();assert.equal(await remote.getByRole('combobox').evaluate(el=>document.activeElement===el&&document.hasFocus()),true,'Search mode returns native typing focus without changing MV');
  if(process.argv.includes('--switch')){
   await shell.locator('#pitch-up').click();await shell.locator('#tempo-up').click();const before=await state();
   await shell.locator('#vocal-model').selectOption(profile);await wait(state,s=>s.vocalModelId===profile&&s.vocalRemoverReady,'Return selected profile');const after=await checkTimeline();assert.equal(after.pitchSemitones,before.pitchSemitones);assert.equal(after.playbackRate,before.playbackRate);await shell.locator('#reset').click();
   console.log('PASS independent search, native focus and key/one-percent tempo through model changes');
  }
  if(process.argv.includes('--long')){
   const seconds=Number(process.env.KARAOKE_VOCAL_LONG_SECONDS||300);assert.ok(seconds>=1&&seconds<=600);
   const source=await media(`(()=>{const v=document.querySelector('video.html5-main-video')||document.querySelector('video');return{time:v.currentTime,duration:v.duration};})()`);assert.ok(source.duration-source.time>seconds+5,JSON.stringify(source));
   const end=Date.now()+seconds*1000;let samples=0,maxBytes=0,maxPackets=0;
   while(Date.now()<end){const s=await checkTimeline();assert.equal(s.vocalRemoverError,null,JSON.stringify(s));const video=await media('window.__karaokeVocalVideo.snapshot()');assert.equal(video.failed,false);assert.ok(video.codecBuffer.encodedBytes<=64*1024*1024&&video.codecBuffer.bufferedFrames<=512);maxBytes=Math.max(maxBytes,video.codecBuffer.encodedBytes);maxPackets=Math.max(maxPackets,video.codecBuffer.bufferedFrames);await sleep(500);samples++;if(samples%120===0){if(s.vocalRemoverEnabled)await toggleOff();else await toggleOn();console.log('Continuous progress',{samples,maxBytes,maxPackets});}}
   console.log('PASS continuous original/background AI',{seconds,samples,maxBytes,maxPackets});
  }
  if(process.argv.includes('--extended')){
   await control.getByRole('button',{name:'Pause',exact:true}).click();await wait(state,s=>s.vocalBufferStatus==='paused','Retained pause');const paused=await media('window.__karaokeVocalVideo.snapshot().displayTime');await sleep(500);assert.equal(await media('window.__karaokeVocalVideo.snapshot().displayTime'),paused);
   await control.getByRole('button',{name:'Resume',exact:true}).click();await wait(state,s=>s.vocalDisplayTime>paused+.1,'Immediate retained resume',2500);
   await control.getByRole('button',{name:'Pause',exact:true}).click();await wait(state,s=>s.vocalBufferStatus==='paused','Pause before seek');await media(`(document.querySelector('video.html5-main-video')||document.querySelector('video')).currentTime=60`);await wait(state,s=>s.vocalSessionEpoch>sessionEpoch,'Paused seek new generation');await control.getByRole('button',{name:'Resume',exact:true}).click();await wait(state,s=>s.vocalVideoReady&&s.vocalDisplayTime>=60,'Seek resume primed',20000);
   await media(`(()=>{const v=document.querySelector('video.html5-main-video')||document.querySelector('video');v.currentTime=v.duration-2;})()`);await wait(()=>media(`(document.querySelector('video.html5-main-video')||document.querySelector('video')).ended`),Boolean,'Source ended',6000);
   await sleep(1000);assert.equal((await state()).currentQueueItemId,initial.currentQueueItemId,'Delayed original tail must not be cut');
   await control.getByRole('button',{name:'Pause',exact:true}).click();
   await wait(state,s=>s.vocalBufferStatus==='paused','Pause delayed tail');await sleep(1000);assert.equal((await state()).currentQueueItemId,initial.currentQueueItemId);
   await control.getByRole('button',{name:'Resume',exact:true}).click();
   await wait(state,s=>s.vocalBufferStatus!=='paused','Resume delayed tail');assert.equal(await media(`(document.querySelector('video.html5-main-video')||document.querySelector('video')).ended`),true,'Resuming the delayed tail must not restart YouTube');
   await wait(state,s=>!s.currentVideoId&&!s.vocalBufferActive,'Final tail completed once',12000);console.log('PASS retained pause/resume, paused seek and paused original end-tail');
  }else{
   if(process.argv.includes('--skip-ai'))await toggleOn();
   if(process.argv.includes('--skip-next-check')){
    await shell.locator('#version-mv').click();await remote.getByRole('combobox').evaluate(el=>el.focus());await remote.keyboard.insertText('เชือกวิเศษ LABANOON Official MV');await remote.getByRole('button',{name:'ค้นหา MV',exact:true}).click();await remote.getByRole('option').filter({hasText:'เชือกวิเศษ'}).first().click();await wait(()=>remote.getByRole('combobox').inputValue(),text=>text==='','Next MV queued');console.log('Queued next MV for skip regression');
    await remote.evaluate(()=>{const post=window.postMessage.bind(window);window.postMessage=(packet,...args)=>{if(packet?.source==='karaoke-hub-page'&&packet.type==='PREPARE_PLAYER_TRACK'){window.__skipHeld=true;setTimeout(()=>post(packet,...args),1500);return;}return post(packet,...args);};});
    await remote.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'End',code:'End',bubbles:true,cancelable:true})));
    await wait(()=>remote.evaluate(()=>window.__skipHeld===true),Boolean,'Next native preflight held');assert.equal(await media(`(document.querySelector('video.html5-main-video')||document.querySelector('video')).paused`),true,'Old source must stop during next MV preparation');
    await wait(state,s=>s.currentQueueItemId&&s.currentQueueItemId!==initial.currentQueueItemId&&s.vocalVideoReady&&s.vocalDisplayTime>0&&s.outputRms>.001,'Next MV automatically plays after held preparation',25000);
    console.log('PASS skip stops old source during held next-MV preparation; next MV starts automatically');
   }
   await remote.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'End',code:'End',bubbles:true,cancelable:true})));
   if(process.argv.includes('--skip-check')){
    await wait(state,s=>!s.currentQueueItemId&&!s.vocalBufferActive,'Skipped final queue item clears native buffer');
    const source=await media(`(()=>{const v=document.querySelector('video.html5-main-video')||document.querySelector('video');return v?{paused:v.paused,ended:v.ended,time:v.currentTime}:null;})()`);
    assert.ok(!source||source.paused||source.ended,`The old source must stop behind an empty screen: ${JSON.stringify(source)}`);
    await wait(state,s=>s.outputRms<.00001,'Skipped audio becomes silent',1500);await sleep(1000);assert.ok((await state()).outputRms<.00001,'Old audio must not return after teardown');
    console.log('PASS skip of final MV stops original source, flushes delayed audio and stays silent');
   }
  }
  console.log('PASS continuous vocal switching',{profile,url});
 }catch(error){if(shell){console.error('State',(await shell.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS'))).state);console.error('Level events',JSON.stringify(await shell.evaluate(()=>window.__levelEvents)));}if(remote)console.error((await remote.locator('body').innerText()).slice(-800));throw error;}
 finally{recording?.catch(()=>{});await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
