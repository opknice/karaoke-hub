const {app,BrowserWindow,WebContentsView,Menu,protocol,net,session,ipcMain,shell}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {DesktopAudioController}=require('./lib/controller.cjs');
const {resolvePlayerUrl,isPlayerUrl}=require('./lib/policy.cjs');
const {setMediaPlaybackRate}=require('./lib/media-tempo.cjs');

protocol.registerSchemesAsPrivileged([{scheme:'karaoke-app',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
if(process.env.KARAOKE_USER_DATA) app.setPath('userData',path.resolve(process.env.KARAOKE_USER_DATA));
let window,player,audioWindow,controller,hostReady;
let nextId=0;
const audioRequests=new Map();
const playerUrl=resolvePlayerUrl(process.env.KARAOKE_PLAYER_URL);
const localOrigin='karaoke-app://app';
const isLocal=(url,entry)=>url===`${localOrigin}/${entry}`;

function validSender(event,contents,check) {
  return contents&&!contents.isDestroyed()&&event.sender===contents&&event.senderFrame===contents.mainFrame&&check(event.senderFrame.url);
}
function localProtocol(ses) {
  ses.protocol.handle('karaoke-app',request=>{
    const url=new URL(request.url);
    const relative=decodeURIComponent(url.pathname).slice(1);
    const absolute=path.resolve(__dirname,relative);
    if(url.host!=='app'||!['ui/','audio/'].some(prefix=>relative.startsWith(prefix))||!absolute.startsWith(__dirname+path.sep)) return new Response('Forbidden',{status:403});
    return net.fetch(pathToFileURL(absolute).href);
  });
}
function publish(state) {
  if(window&&!window.isDestroyed()) window.webContents.send('audio-state',state);
  if(player&&!player.webContents.isDestroyed()&&isPlayerUrl(player.webContents.getURL(),playerUrl)) player.webContents.send('audio-state',state);
}
function rejectPending(map,message) {
  for(const {reject,timer} of map.values()) {clearTimeout(timer);reject(new Error(message));}
  map.clear();
}
function request(map,dispatch,timeout=10000) {
  const id=++nextId;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{map.delete(id);reject(new Error('ไม่ได้รับคำตอบจาก Player'));},timeout);
    map.set(id,{resolve,reject,timer});
    Promise.resolve().then(()=>dispatch(id)).catch(error=>{
      if(!map.has(id)) return;
      clearTimeout(timer);map.delete(id);reject(error);
    });
  });
}
function settle(map,id,result) {
  const pending=map.get(id);if(!pending) return;
  map.delete(id);clearTimeout(pending.timer);pending.resolve(result);
}
async function sendAudio(type,payload,generation) {
  await hostReady;
  return request(audioRequests,id=>audioWindow.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('audio-command',{detail:${JSON.stringify({id,type,payload,generation})}}))`,true));
}
function resizePlayer() {
  if(!window||window.isDestroyed()) return;
  const [width,height]=window.getContentSize();
  player.setBounds({x:0,y:112,width,height:Math.max(0,height-112)});
}
function restorePlayerSearchFocus() {
  if(!window||window.isDestroyed()||!window.isFocused()||!player||player.webContents.isDestroyed()) return;
  if(!isPlayerUrl(player.webContents.getURL(),playerUrl)) return;
  player.webContents.focus();
  player.webContents.send('player-focus-search');
}
function restrictNavigation(contents,allowed) {
  contents.setWindowOpenHandler(({url})=>{
    if(/^https?:\/\//.test(url)) void shell.openExternal(url);
    return {action:'deny'};
  });
  contents.on('will-navigate',(event,url)=>{if(!allowed(url)) event.preventDefault();});
  contents.on('will-redirect',(event,url)=>{if(!allowed(url)) event.preventDefault();});
}

app.whenReady().then(async()=>{
  app.setAppUserModelId('app.karaokehub.player');
  localProtocol(session.defaultSession);
  const audioSession=session.fromPartition('karaoke-audio');localProtocol(audioSession);
  const playerSession=session.fromPartition('persist:karaoke-player');
  playerSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  audioSession.setPermissionRequestHandler((contents,permission,callback)=>callback(
    contents===audioWindow?.webContents&&['media','display-capture'].includes(permission)&&isLocal(contents.getURL(),'audio/index.html')));
  audioSession.setDisplayMediaRequestHandler((request,callback)=>{
    if(request.frame!==audioWindow?.webContents.mainFrame||!isLocal(request.frame?.url,'audio/index.html')||!player||player.webContents.isDestroyed()||!isPlayerUrl(player.webContents.getURL(),playerUrl)) {callback({});return;}
    // Capture one Player, not system audio. Output lives in another webContents,
    // and Chromium suppresses the original source's local echo while captured.
    callback({video:player.webContents.mainFrame,audio:player.webContents.mainFrame,enableLocalEcho:false});
  });
  const secure={nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true};
  window=new BrowserWindow({width:1440,height:900,minWidth:960,minHeight:640,backgroundColor:'#09090b',title:'KARAOKE.HUB',webPreferences:{...secure,preload:path.join(__dirname,'shell-preload.cjs')}});
  player=new WebContentsView({webPreferences:{...secure,partition:'persist:karaoke-player',preload:path.join(__dirname,'player-preload.cjs')}});
  window.contentView.addChildView(player);resizePlayer();window.on('resize',resizePlayer);
  audioWindow=new BrowserWindow({show:false,width:320,height:200,webPreferences:{...secure,partition:'karaoke-audio',backgroundThrottling:false,preload:path.join(__dirname,'audio-preload.cjs')}});
  restrictNavigation(window.webContents,url=>isLocal(url,'ui/index.html'));
  restrictNavigation(audioWindow.webContents,url=>isLocal(url,'audio/index.html'));
  restrictNavigation(player.webContents,url=>isPlayerUrl(url,playerUrl));
  controller=new DesktopAudioController({sendAudio,setPlaybackRate:rate=>setMediaPlaybackRate(player.webContents,playerUrl,rate),publish});
  ipcMain.handle('player-command',(event,message)=>{
    if(!validSender(event,player.webContents,url=>isPlayerUrl(url,playerUrl))) return {ok:false,error:'Untrusted Player'};
    // Only the existing web bridge commands are accepted from remote content.
    if(!['PLAYER_HELLO','REQUEST_STATUS','TRACK_CHANGED','SET_PLAYBACK_RATE','SET_PLAYER_VOLUME','TEMPO_UP','TEMPO_DOWN','SET_SEARCH_VERSION'].includes(message?.type)) return {ok:false,error:'Unsupported Player command'};
    if(message.type==='PLAYER_HELLO') controller.update({playerReady:true,playerError:null});
    return controller.command(message.type,message.payload);
  });
  ipcMain.handle('shell-command',async(event,message)=>{
    if(!validSender(event,window.webContents,url=>isLocal(url,'ui/index.html'))) return {ok:false,error:'Untrusted shell'};
    if(message?.type!=='REQUEST_STATUS') restorePlayerSearchFocus();
    try {
      if(message?.type==='RELOAD_PLAYER') {await controller.disconnect();await player.webContents.loadURL(playerUrl).catch(()=>{});return {ok:true,state:controller.state};}
      return await controller.command(message?.type,message?.payload);
    } finally {
      if(message?.type!=='REQUEST_STATUS') restorePlayerSearchFocus();
    }
  });
  ipcMain.on('audio-reply',(event,{id,result}={})=>{
    if(validSender(event,audioWindow.webContents,url=>isLocal(url,'audio/index.html'))) settle(audioRequests,id,result);
  });
  ipcMain.on('audio-event',(event,{patch,generation}={})=>{
    if(validSender(event,audioWindow.webContents,url=>isLocal(url,'audio/index.html'))&&patch&&typeof patch==='object') controller.audioEvent(patch,generation);
  });
  player.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame){void controller.disconnect();controller.update({currentVideoId:null,playerReady:false});}});
  player.webContents.on('did-finish-load',()=>controller.update({playerReady:true,playerError:null}));
  player.webContents.on('did-fail-load',(_event,code,description,_url,isMainFrame)=>{
    if(isMainFrame&&code!==-3) controller.update({playerReady:false,playerError:`โหลด Player ไม่สำเร็จ (${description})`});
  });
  player.webContents.on('render-process-gone',()=>{void controller.disconnect();controller.update({playerReady:false,playerError:'Player หยุดทำงาน กดโหลดใหม่'});});
  audioWindow.webContents.on('render-process-gone',()=>{
    rejectPending(audioRequests,'ระบบเสียงหยุดทำงาน');controller.generation++;controller.deactivate('error','ระบบเสียงหยุดทำงาน กรุณาเปิดใหม่');
    hostReady=audioWindow.loadURL(`${localOrigin}/audio/index.html`);
  });
  hostReady=audioWindow.loadURL(`${localOrigin}/audio/index.html`);
  await window.loadURL(`${localOrigin}/ui/index.html`);
  await hostReady;
  void player.webContents.loadURL(playerUrl).catch(()=>{});
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'KARAOKE.HUB',submenu:[{label:'โหลด Player ใหม่',click:()=>{void controller.disconnect().then(()=>player.webContents.reload());}},{role:'quit',label:'ออก'}]},
    {label:'มุมมอง',submenu:[{role:'togglefullscreen',accelerator:'F11'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]},
  ]));
  window.on('closed',()=>{player.webContents.close();audioWindow.destroy();app.quit();});
}).catch(error=>{console.error(error);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{rejectPending(audioRequests,'App closed');});
