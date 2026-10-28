const {_electron:electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict');
async function wait(read,check,label,timeout=30000) {
  const until=Date.now()+timeout;let last;
  while(Date.now()<until){last=await read();if(check(last))return last;await new Promise(r=>setTimeout(r,200));}
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}
(async()=>{
  const env={...process.env,KARAOKE_USER_DATA:fs.mkdtempSync(path.join(os.tmpdir(),'karaoke-hosted-'))};
  delete env.ELECTRON_RUN_AS_NODE;delete env.KARAOKE_PLAYER_URL;
  const app=await electron.launch({executablePath:process.env.KARAOKE_EXECUTABLE||require('electron'),args:process.env.KARAOKE_EXECUTABLE?[]:[path.resolve(__dirname,'..')],env});
  try {
    const shell=await wait(async()=>app.context().pages().find(p=>p.url()==='karaoke-app://app/ui/index.html'),Boolean,'Shell');
    const remote=await wait(async()=>app.context().pages().find(p=>p.url().startsWith('https://karaoke-hub-nu.vercel.app/player')),Boolean,'Hosted Player');
    remote.on('pageerror',error=>console.error('Player error:',error.message));
    const state=async()=>(await shell.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS'))).state;
    await wait(state,s=>s?.playerReady,'Player handshake');
    await remote.getByRole('combobox').waitFor();
    if(process.argv.includes('--play')) {
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
      const actual=await wait(state,s=>s.playbackRate>1,'Real song tempo');
      assert.ok(actual.outputRms>0.001);
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
  } finally {await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
