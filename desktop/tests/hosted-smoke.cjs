const {_electron:electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict');
async function wait(read,check,label,timeout=30000) {
  const until=Date.now()+timeout;let last;
  while(Date.now()<until){last=await read();if(check(last))return last;await new Promise(r=>setTimeout(r,200));}
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}
(async()=>{
  const profile=path.join(os.tmpdir(),'karaoke-hub-hosted-test');fs.mkdirSync(profile,{recursive:true});
  const env={...process.env,KARAOKE_USER_DATA:profile};
  delete env.ELECTRON_RUN_AS_NODE;delete env.KARAOKE_PLAYER_URL;
  const app=await electron.launch({executablePath:process.env.KARAOKE_EXECUTABLE||require('electron'),args:process.env.KARAOKE_EXECUTABLE?[]:[path.resolve(__dirname,'..')],env});
  let shell,remote;
  try {
    shell=await wait(async()=>app.context().pages().find(p=>p.url()==='karaoke-app://app/ui/index.html'),Boolean,'Shell');
    remote=await wait(async()=>app.context().pages().find(p=>p.url().startsWith('https://karaoke-hub-nu.vercel.app/player')),Boolean,'Hosted Player');
    remote.on('pageerror',error=>console.error('Player error:',error.message));
    const state=async()=>(await shell.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS'))).state;
    await wait(state,s=>s?.playerReady,'Player handshake');
    // This is an isolated persistent test profile; recover its own test songs
    // after an interrupted previous run before locating the idle search input.
    if(process.argv.includes('--play')) {
      for(let n=0;n<10&&(await state()).currentVideoId;n++) {
        await remote.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'End',code:'End',bubbles:true,cancelable:true})));
        await remote.waitForTimeout(700);
      }
    }
    await remote.getByRole('combobox').waitFor();
    if(process.argv.includes('--play')) {
      // Hydration/bridge readiness precedes asynchronous room creation.
      // Wait for the existing Player's room-ready QR code before enqueueing.
      await wait(()=>remote.locator('body').innerText(),text=>/ROOM:\s*[A-Z0-9]{6}/.test(text),'Room ready');
      await remote.evaluate(()=>{window.__smokeMessages=[];window.addEventListener('message',e=>{if(e.source===window&&e.data?.source?.startsWith('karaoke-hub-'))window.__smokeMessages.push({type:e.data.type,ok:e.data.payload?.ok,error:e.data.payload?.error,video:e.data.payload?.youtubeVideoId,status:e.data.payload?.state?.captureStatus});});});
      await remote.getByRole('combobox').fill('ขอใจเธอแลกเบอร์โทร');
      await remote.waitForTimeout(2000);
      await remote.getByRole('option').filter({hasText:'[ Original Karaoke ]'}).first().click();
      await remote.waitForTimeout(2000);
      await wait(state,s=>Boolean(s.currentVideoId),'Queued song');
      await shell.locator('#audio').click();
      await wait(state,s=>s.captureStatus==='capturing_original'&&s.inputRms>0.005&&s.outputRms>0.005,'Real YouTube audio',45000);
      await shell.locator('#pitch-up').click();
      await wait(state,s=>s.pitchSemitones===1,'Real song key');
      await shell.locator('#tempo-up').click();
      const actual=await wait(state,s=>s.playbackRate===1.01,'Real song 101 percent tempo');
      assert.ok(actual.outputRms>0.001);
      const mediaRate=()=>app.evaluate(async({webContents})=>{
        const player=webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://karaoke-hub-nu.vercel.app/player'));
        const frame=player.mainFrame.frames.find(f=>f.url.startsWith('https://www.youtube.com/embed/'));
        return frame.executeJavaScript('document.querySelector("video").playbackRate');
      });
      assert.equal(await mediaRate(),1.01);
      // Reach the requested example using real one-percent native operations.
      for(let n=0;n<24;n++) {
        const result=await shell.evaluate(()=>window.desktopPlayer.command('TEMPO_UP'));
        assert.equal(result.ok,true,result.error);
      }
      await wait(state,s=>s.playbackRate===1.25,'Real song 125 percent');
      await shell.locator('#tempo-up').click();
      await wait(state,s=>s.playbackRate===1.26,'Real song 126 percent');
      await remote.waitForTimeout(500);
      assert.equal(await mediaRate(),1.26);
      assert.equal((await state()).playbackRate,1.26);
      assert.equal(await shell.locator('#rate').innerText(),'126%');
      await shell.locator('#tempo-down').click();await wait(state,s=>s.playbackRate===1.25,'Real song 125 percent again');
      await shell.locator('#tempo-down').click();await wait(state,s=>s.playbackRate===1.24,'Real song 124 percent');
      assert.equal(await mediaRate(),1.24);
      await shell.locator('#reset').click();
      await wait(state,s=>s.playbackRate===1&&s.pitchSemitones===0,'Real song reset');
      // End only the song in this isolated test room using the normal Player shortcut.
      await remote.getByRole('combobox').press('Escape');
      await remote.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'End',code:'End',bubbles:true,cancelable:true})));
    }
    fs.mkdirSync(path.resolve(__dirname,'../test-results'),{recursive:true});
    await remote.screenshot({path:path.resolve(__dirname,'../test-results/hosted-player.png')});
    await shell.screenshot({path:path.resolve(__dirname,'../test-results/desktop-toolbar.png')});
    console.log('PASS hosted Player',process.argv.includes('--play')?'real song audio, key, tempo and reset':'boot and search input');
  } catch(error) {
    if(shell)console.error('Toolbar diagnostic:',await shell.locator('header').innerText(),await shell.locator('#message').innerText());
    if(remote)console.error('Hosted diagnostics:',(await remote.locator('body').innerText()).slice(-1200),await remote.evaluate(()=>window.__smokeMessages?.slice(-8)));
    console.error('Frame diagnostics:',await app.evaluate(async({webContents})=>{
      const player=webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://karaoke-hub-nu.vercel.app/player'));
      return Promise.all(player.mainFrame.frames.map(async f=>({url:f.url,media:await f.executeJavaScript('Array.from(document.querySelectorAll("video,audio")).map(m=>({rate:m.playbackRate,ready:m.readyState}))').catch(()=>null)})));
    }));
    throw error;
  } finally {await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
