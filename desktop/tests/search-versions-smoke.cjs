const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const url=process.env.KARAOKE_PLAYER_URL||'http://127.0.0.1:3001/player';
async function wait(read,check,label,timeout=60000){const until=Date.now()+timeout;let last;while(Date.now()<until){last=await read();if(check(last))return last;await new Promise(r=>setTimeout(r,200));}throw new Error(`${label}: ${JSON.stringify(last)}`);}
(async()=>{
  const env={...process.env,KARAOKE_PLAYER_URL:url,KARAOKE_USER_DATA:fs.mkdtempSync(path.join(os.tmpdir(),'karaoke-versions-'))};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:process.env.KARAOKE_EXECUTABLE||require('electron'),args:process.env.KARAOKE_EXECUTABLE?[]:[path.resolve(__dirname,'..')],env,timeout:60000});
  let remote,shell;
  try{
    shell=await wait(async()=>app.context().pages().find(p=>p.url()==='karaoke-app://app/ui/index.html'),Boolean,'Shell');
    remote=await wait(async()=>app.context().pages().find(p=>p.url().startsWith(url)),Boolean,'Player');
    remote.on('pageerror',error=>console.error('Player:',error.message));
    const state=async()=>(await shell.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS'))).state;
    await wait(()=>remote.locator('body').innerText(),text=>/ROOM:\s*[A-Z0-9]{6}/.test(text),'Room ready',90000);
    await shell.locator('#version-mv').click();
    await remote.getByRole('button',{name:'ค้นหา MV',exact:true}).waitFor();
    await remote.getByRole('combobox').fill('ขอใจเธอแลกเบอร์โทร');
    await remote.getByRole('button',{name:'ค้นหา MV',exact:true}).click();
    await remote.getByRole('option').first().waitFor({timeout:60000});
    const title=await remote.getByRole('option').first().innerText();
    assert.ok(!/karaoke|คาราโอเกะ|instrumental/i.test(title),title);
    await remote.getByRole('option').first().click();
    const playing=await wait(state,s=>s.currentVersionType==='mv'&&s.currentQueueItemId,'MV queue metadata');
    await shell.locator('#audio').click();await wait(state,s=>s.captureStatus==='capturing_original','Audio running');
    await shell.locator('#version-karaoke').click();
    await wait(state,s=>s.searchVersion==='karaoke','Search changed back');
    const unchanged=await state();
    assert.equal(unchanged.currentVersionType,'mv');assert.equal(unchanged.currentQueueItemId,playing.currentQueueItemId);
    assert.equal(unchanged.captureStatus,'capturing_original');assert.equal(unchanged.vocalRemoverEligible,true);
    assert.equal(await shell.locator('#vocal-remover').isDisabled(),true,'AI worker is not implemented and must not be advertised as ready');
    await Promise.all([remote.waitForEvent('domcontentloaded'),shell.locator('#reload').click()]);
    await wait(state,s=>s.currentVideoId===playing.currentVideoId&&s.currentVersionType==='mv'&&s.currentQueueItemId===playing.currentQueueItemId,'MV restored from database after reload');
    assert.equal((await state()).searchVersion,'karaoke');
    await remote.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'End',code:'End',bubbles:true,cancelable:true})));
    await wait(state,s=>s.currentVideoId===null&&!s.vocalRemoverEligible,'MV ended');
    console.log('PASS real MV search, tagged queue persistence, independent Karaoke selector, uninterrupted MV audio, eligibility until track end; AI readiness stays false');
  }catch(error){if(remote)console.error((await remote.locator('body').innerText()).slice(-2400));if(shell)console.error(await shell.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS')));throw error;}
  finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
