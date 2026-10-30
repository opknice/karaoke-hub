const {ipcRenderer,contextBridge}=require('electron');
contextBridge.exposeInMainWorld('karaokeDesktop',Object.freeze({continuousVocal:true}));
const PAGE='karaoke-hub-page',EXTENSION='karaoke-hub-vocal-cut-extension';
let vocalBridge=null;
ipcRenderer.on('vocal-bridge',(_event,configuration)=>{vocalBridge=configuration;});
window.addEventListener('message',event=>{
  const packet=event.data;
  if(!vocalBridge||packet?.source!=='karaoke-hub-live-video'||packet.token!==vocalBridge.token||packet.epoch!==vocalBridge.epoch)return;
  const originAllowed=['https://www.youtube.com','https://www.youtube-nocookie.com'].includes(event.origin);
  const frameAllowed=originAllowed&&Array.from(document.querySelectorAll('iframe')).some(frame=>{
    try{const url=new URL(frame.src);return frame.contentWindow===event.source&&url.origin===event.origin&&/^\/embed\/(?:[\w-]{11})?$/.test(url.pathname);}catch{return false;}
  });
  const local=event.source===window&&event.origin===location.origin&&location.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  if(!frameAllowed&&!local)return;
  if(!['play','pause','seeking','seeked','ended','error'].includes(packet.kind)||!Number.isFinite(packet.time)||packet.time<0||typeof packet.paused!=='boolean')return;
  ipcRenderer.send('vocal-transport',{epoch:packet.epoch,token:packet.token,kind:packet.kind,time:packet.time,paused:packet.paused,error:typeof packet.error==='string'?packet.error.slice(0,300):undefined});
});
// The hosted website still has legacy effect shortcuts. Suppress them in this
// desktop app before React receives them; keep text entry in an active query.
window.addEventListener('keydown',event=>{
  if(event.altKey||event.ctrlKey||event.metaKey||event.isComposing) return;
  const tempo=['PageUp','PageDown'].includes(event.key);
  if(tempo&&event.shiftKey) return;
  if(!tempo&&!['*','/'].includes(event.key)&&!['NumpadMultiply','NumpadDivide'].includes(event.code)) return;
  const target=event.target;
  const editing=target instanceof HTMLElement&&(target.isContentEditable||target.closest('textarea,select,[role="textbox"]')||(target instanceof HTMLInputElement&&target.value.length>0));
  if(editing) return;
  event.preventDefault();event.stopImmediatePropagation();
  if(tempo&&!event.repeat) {
    void ipcRenderer.invoke('player-command',{type:event.key==='PageUp'?'TEMPO_UP':'TEMPO_DOWN',payload:{}})
      .then(result=>post('EXTENSION_RESPONSE',result))
      .catch(()=>{});
  }
},true);
function post(type,payload,requestId) {
  window.postMessage({source:EXTENSION,version:1,type,payload,requestId},window.location.origin);
}
window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin) return;
  const m=event.data;
  if(!m||m.source!==PAGE||m.version!==1||typeof m.type!=='string') return;
  // Main validates the sender frame, current URL and command union again.
  void ipcRenderer.invoke('player-command',{type:m.type,payload:m.payload??{}})
    .then(result=>post('EXTENSION_RESPONSE',result,m.requestId))
    .catch(()=>post('EXTENSION_RESPONSE',{ok:false,error:'ระบบเสียง Desktop ไม่พร้อม'},m.requestId));
});
ipcRenderer.on('audio-state',(_event,state)=>post('STATE_CHANGED',{ok:true,state}));
ipcRenderer.on('player-focus-search',()=>window.dispatchEvent(new Event('karaoke-player-focus-search')));
window.addEventListener('DOMContentLoaded',()=>post('EXTENSION_READY',{installed:true}));
