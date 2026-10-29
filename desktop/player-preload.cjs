const {ipcRenderer}=require('electron');
const PAGE='karaoke-hub-page',EXTENSION='karaoke-hub-vocal-cut-extension';
// The hosted website still has legacy effect shortcuts. Suppress them in this
// desktop app before React receives them; keep text entry in an active query.
window.addEventListener('keydown',event=>{
  if(event.altKey||event.ctrlKey||event.metaKey||event.isComposing) return;
  if(!['*','/'].includes(event.key)&&!['NumpadMultiply','NumpadDivide'].includes(event.code)) return;
  const target=event.target;
  const editing=target instanceof HTMLElement&&(target.isContentEditable||target.closest('textarea,select,[role="textbox"]')||(target instanceof HTMLInputElement&&target.value.length>0));
  if(editing) return;
  event.preventDefault();event.stopImmediatePropagation();
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
ipcRenderer.on('player-shortcut',(_event,{id,key})=>{
  if(!['PageUp','PageDown'].includes(key)) return;
  const event=new KeyboardEvent('keydown',{key,code:key,bubbles:true,cancelable:true});
  window.dispatchEvent(event);
  ipcRenderer.send('shortcut-reply',{id,handled:event.defaultPrevented});
});
window.addEventListener('DOMContentLoaded',()=>post('EXTENSION_READY',{installed:true}));
