const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('audioHost',{
  reply:(id,result)=>ipcRenderer.send('audio-reply',{id,result}),
  event:(patch,generation)=>ipcRenderer.send('audio-event',{patch,generation}),
  vocalPcm:packet=>ipcRenderer.send('vocal-pcm',packet),
});
ipcRenderer.on('vocal-result',(_event,packet)=>window.postMessage({source:'karaoke-hub-vocal-worker',packet},location.origin));
