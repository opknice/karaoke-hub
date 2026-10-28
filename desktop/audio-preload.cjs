const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('audioHost',{
  reply:(id,result)=>ipcRenderer.send('audio-reply',{id,result}),
  event:(patch,generation)=>ipcRenderer.send('audio-event',{patch,generation}),
});
