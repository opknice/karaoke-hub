const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const audio=Buffer.alloc(44+48000*2*2*2);
audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(2,22);audio.writeUInt32LE(48000,24);audio.writeUInt32LE(48000*4,28);audio.writeUInt16LE(4,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
for(let i=0;i<96000;i++) {const n=Math.round(0.25*32767*Math.sin(2*Math.PI*440*i/48000));audio.writeInt16LE(n,44+i*4);audio.writeInt16LE(n,46+i*4);}
const fixture=`<!doctype html><html><body><h1>Player audio fixture</h1><audio id="song" src="/tone.wav" autoplay loop></audio><script>
const song=document.getElementById('song'),rates=[0.5,0.75,1,1.25,1.5,2];
function post(type,payload={}){window.postMessage({source:'karaoke-hub-page',version:1,type,payload},location.origin);}
window.addEventListener('message',e=>{if(e.source!==window||e.data?.source!=='karaoke-hub-vocal-cut-extension')return;if(e.data.type==='EXTENSION_READY')post('PLAYER_HELLO');});
setInterval(()=>{post('PLAYER_HELLO');post('TRACK_CHANGED',{youtubeVideoId:'tone440aaaa'});},500);
window.addEventListener('keydown',event=>{if(event.shiftKey||event.altKey||event.ctrlKey||event.metaKey||!['PageUp','PageDown'].includes(event.key))return;event.preventDefault();const i=rates.indexOf(song.playbackRate),next=rates[i+(event.key==='PageUp'?1:-1)];if(next){song.playbackRate=next;post('SET_PLAYBACK_RATE',{playbackRate:next});}});
song.play().catch(()=>{});
</script></body></html>`;
const server=http.createServer((req,res)=>{
  if(req.url==='/tone.wav'){res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':audio.length});res.end(audio);}
  else {res.setHeader('Content-Type','text/html');res.end(fixture);}
});
async function until(read,check,label,timeout=15000) {
  const deadline=Date.now()+timeout;let last;
  while(Date.now()<deadline){last=await read();if(check(last))return last;await new Promise(r=>setTimeout(r,100));}
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'karaoke-electron-test-'));
  const env={...process.env,KARAOKE_PLAYER_URL:`http://127.0.0.1:${port}/player`,KARAOKE_USER_DATA:profile};
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app=await electron.launch({executablePath:process.env.KARAOKE_EXECUTABLE||require('electron'),args:process.env.KARAOKE_EXECUTABLE?[]:[path.resolve(__dirname,'..')],env,timeout:45000});
    app.process().stderr.on('data',data=>process.stderr.write(data));
    const page=await until(async()=>app.context().pages().find(p=>p.url()==='karaoke-app://app/ui/index.html'),Boolean,'Shell window');
    const state=()=>page.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS')).then(x=>x.state);
    await until(state,s=>s?.playerReady&&s.currentVideoId==='tone440aaaa','Player ready');
    await page.locator('#version-mv').click();
    await until(state,s=>s.searchVersion==='mv','MV search selection');
    assert.equal((await state()).currentVersionType,'karaoke');
    assert.equal(await page.locator('#vocal-remover').isDisabled(),true);
    await page.locator('#version-karaoke').click();
    await until(state,s=>s.searchVersion==='karaoke','Karaoke search selection');
    assert.equal(await page.getByRole('button',{name:'Vocal Cut',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Auto Level',exact:true}).count(),0);
    const remote=await until(async()=>app.context().pages().find(p=>p.url().startsWith(`http://127.0.0.1:${port}/player`)),Boolean,'Player view');
    const removedShortcuts=await remote.evaluate(()=>{
      let seen=0;
      const handler=event=>{if(event.key==='*'||event.key==='/')seen++;};
      window.addEventListener('keydown',handler);
      for(const [key,code] of [['*','NumpadMultiply'],['/','NumpadDivide']])window.dispatchEvent(new KeyboardEvent('keydown',{key,code,bubbles:true,cancelable:true}));
      window.removeEventListener('keydown',handler);
      return seen;
    });
    assert.equal(removedShortcuts,0,'Removed shortcuts must not reach legacy Player handlers');
    const security=await app.evaluate(({webContents})=>webContents.getAllWebContents().filter(w=>w.getURL().startsWith('http://127.0.0.1')).map(w=>w.getLastWebPreferences()));
    assert.ok(security.length>0&&security.every(p=>p.sandbox&&p.contextIsolation&&!p.nodeIntegration));
    await page.locator('#audio').click();
    await until(state,s=>s.captureStatus==='capturing_original'&&s.outputRms>0.05,'Selective audio capture');
    for(let n=0;n<3;n++) {await page.locator('#pitch-up').click();await until(state,s=>s.pitchSemitones===n+1,'Key acknowledgement');}
    await until(state,s=>Math.abs(s.peakHz-523.251)<9,'+3 semitone captured output');
    for(const [key,hz] of [[-6,311.127],[6,622.254],[0,440]]) {
      const result=await page.evaluate(key=>window.desktopPlayer.command('SET_PITCH',{semitones:key}),key);assert.equal(result.ok,true);
      await until(state,s=>Math.abs(s.peakHz-hz)<9,`${key} semitone captured output`);
    }
    await page.locator('#tempo-up').click();
    await until(state,s=>s.playbackRate===1.01&&Math.abs(s.peakHz-440)<9,'101 percent preserves original key');
    assert.equal(await page.locator('#rate').innerText(),'101%');
    await remote.evaluate(()=>{
      document.querySelector('audio').playbackRate=1.25;
      window.postMessage({source:'karaoke-hub-page',version:1,type:'SET_PLAYBACK_RATE',payload:{playbackRate:1.25}},location.origin);
    });
    await until(state,s=>s.playbackRate===1.25,'125 percent starting rate');
    await page.locator('#tempo-up').click();
    await until(state,s=>s.playbackRate===1.26&&Math.abs(s.peakHz-440)<9,'125 to 126 percent');
    assert.equal(await remote.evaluate(()=>document.querySelector('audio').playbackRate),1.26);
    assert.equal(await page.locator('#rate').innerText(),'126%');
    await page.locator('#tempo-down').click();await until(state,s=>s.playbackRate===1.25,'126 to 125');
    await page.locator('#tempo-down').click();await until(state,s=>s.playbackRate===1.24,'125 to 124');
    assert.equal(await remote.evaluate(()=>document.querySelector('audio').playbackRate),1.24);
    await remote.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'PageUp',code:'PageUp',bubbles:true,cancelable:true})));
    await until(state,s=>s.playbackRate===1.25,'Page Up uses one percent');
    await remote.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'PageUp',code:'PageUp',shiftKey:true,bubbles:true,cancelable:true})));
    await remote.waitForTimeout(300);
    assert.equal((await state()).playbackRate,1.25,'Shift+Page Up must not alter tempo');
    await page.locator('#pitch-up').click();
    await until(state,s=>s.pitchSemitones===1&&Math.abs(s.peakHz-466.164)<9,'Independent tempo and pitch');
    await page.locator('#reset').click();
    await until(state,s=>s.pitchSemitones===0&&s.playbackRate===1&&Math.abs(s.peakHz-440)<9,'Reset without restarting song');
    for(const type of ['TOGGLE_VOCAL_CUT','TOGGLE_LOUDNESS_NORMALIZE']) {
      assert.equal((await page.evaluate(type=>window.desktopPlayer.command(type),type)).ok,false);
    }
    await page.locator('#audio').click();
    await until(state,s=>s.captureStatus==='installed_idle'&&!s.supportsPitchPreservedTempo,'Stop releases processing');
    await page.locator('#audio').click();await until(state,s=>s.captureStatus==='capturing_original'&&s.outputRms>0.05,'Restart audio');
    const denied=await page.evaluate(()=>window.desktopPlayer.command('SET_PITCH',{semitones:Infinity}));assert.equal(denied.ok,false);
    await page.locator('#reload').click();
    await until(state,s=>s.playerReady&&s.captureStatus==='installed_idle','Reload revokes audio');
    console.log('PASS Electron: exact 125→126/124 percent media rates, 1% keyboard, pitch preservation, key/reset, removed effects, stop/restart, validation, reload');
  } finally {await app?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
