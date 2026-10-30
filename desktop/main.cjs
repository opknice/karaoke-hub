const {app,BrowserWindow,WebContentsView,Menu,protocol,net,session,ipcMain,shell}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {DesktopAudioController}=require('./lib/controller.cjs');
const {resolvePlayerUrl,isPlayerUrl,validateCommand}=require('./lib/policy.cjs');
const {setMediaPlaybackRate}=require('./lib/media-tempo.cjs');
const {VocalWorker}=require('./lib/vocal-worker.cjs');
const {VocalVideo}=require('./lib/vocal-video.cjs');
const {ContinuousVocalCoordinator}=require('./lib/continuous-vocal-coordinator.cjs');
const {getVocalModel}=require('./lib/vocal-models.cjs');
const {VocalModelSettings}=require('./lib/vocal-model-settings.cjs');
const {NativeTrackPreparation}=require('./lib/native-track-preparation.cjs');

protocol.registerSchemesAsPrivileged([{scheme:'karaoke-app',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
if(process.env.KARAOKE_USER_DATA) app.setPath('userData',path.resolve(process.env.KARAOKE_USER_DATA));
let window,player,audioWindow,controller,hostReady,vocalWorker,vocal;
let nextId=0;
const audioRequests=new Map();
const playerUrl=resolvePlayerUrl(process.env.KARAOKE_PLAYER_URL);
const localOrigin='karaoke-app://app';
const isLocal=(url,entry)=>url===`${localOrigin}/${entry}`;
function vocalRuntimeError(message){
  if(/too slow|five-second/i.test(message))return 'GPU เครื่องนี้ประมวลผลไม่ทันโหมดที่เลือก';
  if(/No hardware GPU/i.test(message))return 'ไม่พบ GPU ที่รองรับ Vocal Remover';
  if(/integrity|tensor shape|model interface|model identity/i.test(message))return 'ไฟล์หรือข้อมูลโมเดล AI ไม่สมบูรณ์ กรุณาติดตั้งโปรแกรมใหม่';
  if(/DirectML|No module|runtime/i.test(message))return 'เริ่มระบบ AI บน GPU ไม่สำเร็จ กรุณาลองเปิดโปรแกรมใหม่';
  return message;
}

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
  const vocalRoot=app.isPackaged?path.join(process.resourcesPath,'vocal'):path.join(__dirname,'vocal');
  const settings=new VocalModelSettings(path.join(app.getPath('userData'),'vocal-settings.json'));
  const selectedModel=settings.read();
  const modelPaths=id=>({python:path.join(vocalRoot,'runtime/python/python.exe'),worker:path.join(vocalRoot,'worker.py'),model:path.join(vocalRoot,'runtime',getVocalModel(id).filename)});
  controller=new DesktopAudioController({sendAudio,setPlaybackRate:rate=>setMediaPlaybackRate(player.webContents,playerUrl,rate),publish,initialModelId:selectedModel,supportsContinuousVocal:true,
    setVocal:enabled=>vocal.setRemoval(enabled),
    suspendVocal:()=>vocal.suspendAi(),closePlayback:options=>vocal.stopSession(options),
    preparePlayback:track=>vocal.prepare({...track,origin:new URL(playerUrl).origin}),
    selectVocalModel:id=>{
      controller.update({vocalPreferenceError:null});
      try{settings.write(id);}catch{controller.update({vocalPreferenceError:'บันทึกโหมดไว้ใช้ครั้งหน้าไม่สำเร็จ'});}
      vocalWorker.selectModel({profile:getVocalModel(id),paths:modelPaths(id)});
    },
  });
  vocalWorker=new VocalWorker({profile:getVocalModel(selectedModel),paths:modelPaths(selectedModel),
    onReady:details=>void vocal.beginAi().then(()=>controller.vocalModelReady(details)),
    onResult:packet=>vocal.result(packet),
    onFailure:failure=>{
      if(failure.fatal){console.warn('Vocal runtime:',failure.message);controller.vocalModelFailed(vocalRuntimeError(failure.message),vocalWorker.profile.id);}
      if(vocal.active)void vocal.failure(failure.message,failure.epoch);
    },
  });
  vocal=new ContinuousVocalCoordinator({worker:vocalWorker,video:new VocalVideo(player.webContents,playerUrl),
    getProfile:()=>getVocalModel(controller.state.vocalModelId),
    ensureCapture:configuration=>controller.ensureBufferedCapture(configuration),
    getTrack:()=>({videoId:controller.state.currentVideoId,queueItemId:controller.state.currentQueueItemId,versionType:controller.state.currentVersionType,active:controller.active,playing:controller.state.vocalPlaybackPlaying,origin:new URL(playerUrl).origin}),
    sendAudio:(type,payload)=>controller.audio(type,payload),
    sendResult:packet=>{if(!audioWindow.webContents.isDestroyed())audioWindow.webContents.send('vocal-result',packet);},
    publish:patch=>controller.update(patch),
    setBridge:configuration=>{if(!player.webContents.isDestroyed()&&isPlayerUrl(player.webContents.getURL(),playerUrl))player.webContents.send('vocal-bridge',configuration);},
  });
  controller.update({vocalRuntimeStatus:'loading'});
  const preparation=new NativeTrackPreparation(controller);
  ipcMain.handle('player-command',(event,message)=>{
    if(!validSender(event,player.webContents,url=>isPlayerUrl(url,playerUrl))) return {ok:false,error:'Untrusted Player'};
    // Fixed track preparation grants capture of this trusted Player only; no model/path controls.
    if(!['PLAYER_HELLO','REQUEST_STATUS','TRACK_CHANGED','PREPARE_PLAYER_TRACK','CANCEL_PLAYER_PREPARATION','SET_PLAYBACK_RATE','SET_PLAYER_VOLUME','TEMPO_UP','TEMPO_DOWN','SET_SEARCH_VERSION','VOCAL_PLAYBACK_STATE'].includes(message?.type)) return {ok:false,error:'Unsupported Player command'};
    if(message.type==='PREPARE_PLAYER_TRACK'){
      if(!validateCommand(message.type,message.payload))return{ok:false,error:'Invalid playback preparation'};
      return preparation.prepare(message.payload,message.requestId);
    }
    if(message.type==='CANCEL_PLAYER_PREPARATION'){
      if(!validateCommand(message.type,message.payload))return{ok:false,error:'Invalid playback cancellation'};
      preparation.cancel(message.payload.preparationId);return{ok:true,state:controller.state};
    }
    if(message.type==='VOCAL_PLAYBACK_STATE'){
      if(!validateCommand(message.type,message.payload))return {ok:false,error:'Invalid playback state'};
      const p=message.payload;
      if(p.mediaReady)preparation.ready(p);
      void controller.vocalPlaybackState(p);
      if(vocal.active&&p.youtubeVideoId===controller.state.currentVideoId&&p.queueItemId===controller.state.currentQueueItemId){
        const epoch=vocal.sessionEpoch,token=vocal.token;
        void(async()=>{if(p.mediaReady)await vocal.attachVideo();await vocal.transport({epoch,token,kind:p.playing?'play':'pause',paused:!p.playing});})().catch(error=>console.warn('Playback transport:',error.message));
      }
      return {ok:true,state:controller.state};
    }
    if(message.type==='PLAYER_HELLO') controller.update({playerReady:true,playerError:null});
    return controller.command(message.type,message.payload);
  });
  ipcMain.handle('shell-command',async(event,message)=>{
    if(!validSender(event,window.webContents,url=>isLocal(url,'ui/index.html'))) return {ok:false,error:'Untrusted shell'};
    if(message?.type!=='REQUEST_STATUS') restorePlayerSearchFocus();
    try {
      if(message?.type==='RELOAD_PLAYER') {await controller.disconnect();if(!vocalWorker.ready){controller.update({vocalRuntimeStatus:'loading',vocalRuntimeError:null});vocalWorker.start();}await player.webContents.loadURL(playerUrl).catch(()=>{});return {ok:true,state:controller.state};}
      return await controller.command(message?.type,message?.payload);
    } finally {
      if(message?.type!=='REQUEST_STATUS') restorePlayerSearchFocus();
    }
  });
  ipcMain.on('audio-reply',(event,{id,result}={})=>{
    if(validSender(event,audioWindow.webContents,url=>isLocal(url,'audio/index.html'))) settle(audioRequests,id,result);
  });
  ipcMain.on('audio-event',(event,{patch,generation}={})=>{
    if(validSender(event,audioWindow.webContents,url=>isLocal(url,'audio/index.html'))&&patch&&typeof patch==='object') {
      if(patch.continuousSessionId!==undefined||patch.vocalEpoch!==undefined){if(generation===controller.generation)vocal.audioState(patch);}
      else controller.audioEvent(patch,generation);
    }
  });
  ipcMain.on('vocal-pcm',(event,packet)=>{if(validSender(event,audioWindow.webContents,url=>isLocal(url,'audio/index.html'))&&packet&&typeof packet==='object')vocal.feed(packet);});
  ipcMain.on('vocal-transport',(event,packet)=>{
    if(!validSender(event,player.webContents,url=>isPlayerUrl(url,playerUrl))||!packet||typeof packet!=='object')return;
    if(!['play','pause','seeking','seeked','ended','error'].includes(packet.kind)||typeof packet.token!=='string'||packet.token.length>128
      ||!Number.isSafeInteger(packet.epoch)||typeof packet.paused!=='boolean'||!Number.isFinite(packet.time)||packet.time<0)return;
    void vocal.transport(packet);
  });
  player.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame){void controller.disconnect();controller.update({currentVideoId:null,playerReady:false});}});
  player.webContents.on('did-finish-load',()=>controller.update({playerReady:true,playerError:null}));
  player.webContents.on('did-fail-load',(_event,code,description,_url,isMainFrame)=>{
    if(isMainFrame&&code!==-3) controller.update({playerReady:false,playerError:`โหลด Player ไม่สำเร็จ (${description})`});
  });
  player.webContents.on('render-process-gone',()=>{void controller.disconnect();controller.update({playerReady:false,playerError:'Player หยุดทำงาน กดโหลดใหม่'});});
  audioWindow.webContents.on('render-process-gone',()=>{
    rejectPending(audioRequests,'ระบบเสียงหยุดทำงาน');controller.generation++;controller.deactivate('error','ระบบเสียงหยุดทำงาน กรุณาเปิดใหม่');
    void controller.revokeVocal();
    void controller.endPlayback({restorePosition:false});
    hostReady=audioWindow.loadURL(`${localOrigin}/audio/index.html`);
  });
  hostReady=audioWindow.loadURL(`${localOrigin}/audio/index.html`);
  await window.loadURL(`${localOrigin}/ui/index.html`);
  await hostReady;
  vocalWorker.start();
  void player.webContents.loadURL(playerUrl).catch(()=>{});
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'KARAOKE.HUB',submenu:[{label:'โหลด Player ใหม่',click:()=>{void controller.disconnect().then(()=>player.webContents.reload());}},{role:'quit',label:'ออก'}]},
    {label:'มุมมอง',submenu:[{role:'togglefullscreen',accelerator:'F11'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]},
  ]));
  window.on('closed',()=>{player.webContents.close();audioWindow.destroy();app.quit();});
}).catch(error=>{console.error(error);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{void vocal?.stop({restorePosition:false});vocalWorker?.stop();rejectPending(audioRequests,'App closed');});
