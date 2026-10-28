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
window.addEventListener('keydown',event=>{if(!['PageUp','PageDown'].includes(event.key))return;event.preventDefault();const i=rates.indexOf(song.playbackRate),next=rates[i+(event.key==='PageUp'?1:-1)];if(next){song.playbackRate=next;post('SET_PLAYBACK_RATE',{playbackRate:next});}});
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
    await until(state,s=>s.playbackRate===1.25&&Math.abs(s.peakHz-440)<9,'Native tempo preserves original key');
    await page.locator('#pitch-up').click();
    await until(state,s=>s.pitchSemitones===1&&Math.abs(s.peakHz-466.164)<9,'Independent tempo and pitch');
    await page.locator('#reset').click();
    await until(state,s=>s.pitchSemitones===0&&s.playbackRate===1&&Math.abs(s.peakHz-440)<9,'Reset without restarting song');
    await page.locator('#vocal').click();await until(state,s=>s.enabled,'Vocal Cut');
    await page.locator('#normalize').click();await until(state,s=>s.normalizeEnabled,'Auto Level');
    await page.locator('#audio').click();
    await until(state,s=>s.captureStatus==='installed_idle'&&!s.supportsPitchPreservedTempo,'Stop releases processing');
    await page.locator('#audio').click();await until(state,s=>s.captureStatus==='capturing_original'&&s.outputRms>0.05,'Restart audio');
    const denied=await page.evaluate(()=>window.desktopPlayer.command('SET_PITCH',{semitones:Infinity}));assert.equal(denied.ok,false);
    await page.locator('#reload').click();
    await until(state,s=>s.playerReady&&s.captureStatus==='installed_idle','Reload revokes audio');
    console.log('PASS Electron: real cross-webContents capture, -6/+3/+6 key, native 1.25x tempo, independent key, reset, Vocal Cut, Auto Level, stop/restart, validation, reload');
  } finally {await app?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
