const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const url=process.env.KARAOKE_PLAYER_URL||'http://127.0.0.1:3001/player';
async function wait(read,check,label,timeout=45000){const until=Date.now()+timeout;let last;while(Date.now()<until){last=await read();if(check(last))return last;await new Promise(r=>setTimeout(r,100));}throw new Error(`${label}: ${JSON.stringify(last)}`);}
(async()=>{
 const env={...process.env,KARAOKE_PLAYER_URL:url,KARAOKE_USER_DATA:fs.mkdtempSync(path.join(os.tmpdir(),'karaoke-focus-'))};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:process.env.KARAOKE_EXECUTABLE||require('electron'),args:process.env.KARAOKE_EXECUTABLE?[]:[path.resolve(__dirname,'..')],env,timeout:60000});
 try{
  const shell=await wait(async()=>app.context().pages().find(p=>p.url()==='karaoke-app://app/ui/index.html'),Boolean,'Shell');
  const remote=await wait(async()=>app.context().pages().find(p=>p.url().startsWith(url)),Boolean,'Player');
  // Search results are irrelevant here; avoid spending live YouTube quota.
  await remote.route('**/api/search',route=>route.fulfill({json:{success:true,data:[]}}));
  const input=remote.getByRole('combobox');await input.waitFor();
  const focused=()=>app.evaluate(({webContents})=>webContents.getFocusedWebContents()?.getURL());
  const typeIntoFocusedView=text=>app.evaluate(({webContents},text)=>{const target=webContents.getFocusedWebContents();for(const keyCode of text)target.sendInputEvent({type:'char',keyCode});},text);
  const checkReady=async(label)=>{
   await wait(focused,value=>value?.startsWith(url),`${label}: native keyboard focus returns to Player`,5000);
   await wait(()=>input.evaluate(el=>document.hasFocus()&&document.activeElement===el),Boolean,`${label}: search input focused`,5000);
  };
  await app.evaluate(({webContents})=>webContents.getAllWebContents().find(w=>w.getURL()==='karaoke-app://app/ui/index.html').focus());
  await shell.locator('#version-mv').focus();
  await shell.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS'));
  assert.equal(await focused(),'karaoke-app://app/ui/index.html','Status polling must not move keyboard focus');
  await shell.locator('#version-mv').click();
  await remote.getByRole('button',{name:'ค้นหา MV',exact:true}).waitFor();
  await checkReady('MV selector');
  await app.evaluate(({webContents})=>webContents.getAllWebContents().find(w=>w.getURL()==='karaoke-app://app/ui/index.html').focus());
  await shell.locator('#vocal-model').focus();
  await app.evaluate(({webContents})=>{const target=webContents.getFocusedWebContents();target.sendInputEvent({type:'keyDown',keyCode:'Down'});target.sendInputEvent({type:'keyUp',keyCode:'Down'});});
  await wait(()=>shell.locator('#vocal-model').inputValue(),value=>value==='hq5','Native keyboard selects HQ');await checkReady('HQ keyboard model selector');
  await shell.locator('#vocal-model').selectOption('fast');await checkReady('Fast model selector');
  await typeIntoFocusedView('เพลงใหม่');
  await wait(()=>input.inputValue(),value=>value==='เพลงใหม่','Thai text reaches search without clicking input');
  await input.evaluate(el=>el.setSelectionRange(4,4));
  await shell.locator('#version-karaoke').click();await checkReady('Karaoke selector');
  await typeIntoFocusedView('ต่อ');
  await wait(()=>input.inputValue(),value=>value==='เพลงต่อใหม่','Existing text and caret are preserved');
  await input.press('Escape');
  const qrButton=remote.getByRole('button',{name:/^แสดง QR Code ห้อง/});
  await qrButton.click();
  await remote.getByRole('dialog').waitFor();
  await shell.locator('#version-mv').click();
  await wait(()=>shell.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS')).then(r=>r.state.searchVersion),v=>v==='mv','Mode command settled with modal open');
  assert.equal(await input.evaluate(el=>document.activeElement===el),false,'An open modal keeps its keyboard focus');
  await remote.getByRole('button',{name:'ปิดหน้าต่าง QR Code',exact:true}).click();
  await checkReady('Closing QR modal');
  await typeIntoFocusedView('ทดสอบ');
  await remote.getByRole('button',{name:'รู้เนื้อ ไม่รู้เพลง คลิ๊กเลย',exact:true}).click();
  const lyrics=remote.getByPlaceholder('พิมพ์ท่อนเนื้อเพลงที่จำได้');
  await lyrics.waitFor();
  await shell.locator('#version-karaoke').click();
  await wait(()=>shell.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS')).then(r=>r.state.searchVersion),v=>v==='karaoke','Mode command settled while editing lyrics');
  await typeIntoFocusedView('เนื้อเพลง');
  await wait(()=>lyrics.inputValue(),v=>v==='เนื้อเพลง','Lyrics editing is preserved');
  await lyrics.press('Escape');await checkReady('Closing lyrics input');
  await input.press('Escape');
  await app.evaluate(async({webContents})=>{
   const audio=webContents.getAllWebContents().find(w=>w.getURL()==='karaoke-app://app/audio/index.html');
   await audio.executeJavaScript(`{const original=navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getDisplayMedia=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,1800));return original(...args);};} undefined;`);
  });
  // Browsing controls may retain DOM focus until the native view is restored.
  await remote.evaluate(()=>{document.querySelector('[role="combobox"]').blur();document.body.tabIndex=-1;document.body.focus();});
  await shell.locator('#audio').click();
  await wait(()=>input.evaluate(el=>document.hasFocus()&&document.activeElement===el),Boolean,'Search focus while audio is still connecting',500);
  assert.match(await shell.locator('#audio').innerText(),/กำลังเชื่อมต่อ/);
  await typeIntoFocusedView('ระหว่างรอ');
  await wait(()=>input.inputValue(),v=>v==='ระหว่างรอ','Typing works before slow audio action completes',500);
  await wait(()=>shell.evaluate(()=>window.desktopPlayer.command('REQUEST_STATUS')).then(r=>r.state.captureStatus),v=>v!=='starting','Audio command settled');
  await checkReady('Audio button');
  await remote.getByRole('combobox').press('Escape');
  await Promise.all([remote.waitForEvent('domcontentloaded'),shell.locator('#reload').click()]);
  await input.waitFor();await checkReady('Reload button');
  await typeIntoFocusedView('หลังโหลด');
  await wait(()=>input.inputValue(),value=>value==='หลังโหลด','Typing works after reload');
  console.log('PASS toolbar restores search focus, Thai typing and existing text, audio/reload; modal and lyrics editing preserved, closing restores search');
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
