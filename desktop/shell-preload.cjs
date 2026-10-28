const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktopPlayer',{
  command:(type,payload={})=>ipcRenderer.invoke('shell-command',{type,payload}),
  subscribe:callback=>{const handler=(_event,state)=>callback(state);ipcRenderer.on('audio-state',handler);return()=>ipcRenderer.removeListener('audio-state',handler);},
});
