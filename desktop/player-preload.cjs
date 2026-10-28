const {ipcRenderer}=require('electron');
const PAGE='karaoke-hub-page',EXTENSION='karaoke-hub-vocal-cut-extension';
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
ipcRenderer.on('player-shortcut',(_event,{id,key})=>{
  if(!['PageUp','PageDown'].includes(key)) return;
  const event=new KeyboardEvent('keydown',{key,code:key,bubbles:true,cancelable:true});
  window.dispatchEvent(event);
  ipcRenderer.send('shortcut-reply',{id,handled:event.defaultPrevented});
});
window.addEventListener('DOMContentLoaded',()=>post('EXTENSION_READY',{installed:true}));
