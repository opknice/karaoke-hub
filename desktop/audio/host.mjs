import { AudioEngine } from './engine.mjs';
const engine=new AudioEngine((patch,generation)=>window.audioHost.event(patch,generation));
window.addEventListener('audio-command',async event=>{
  const {id,type,payload,generation:nextGeneration}=event.detail;
  try {
    await engine.apply(type,payload,nextGeneration);
    document.getElementById('status').textContent=engine.graph?'Audio running':'Audio idle';
    window.audioHost.reply(id,{ok:true});
  } catch(error) {
    window.audioHost.reply(id,{ok:false,error:error.message});
  }
});
