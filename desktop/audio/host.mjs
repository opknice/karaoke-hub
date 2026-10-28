import { AudioEngine } from './engine.mjs';
let generation=0;
const engine=new AudioEngine(patch=>window.audioHost.event(patch,generation));
window.addEventListener('audio-command',async event=>{
  const {id,type,payload,generation:nextGeneration}=event.detail;
  generation=nextGeneration;
  try {
    await engine.apply(type,payload);
    document.getElementById('status').textContent=engine.graph?'Audio running':'Audio idle';
    window.audioHost.reply(id,{ok:true});
  } catch(error) {
    window.audioHost.reply(id,{ok:false,error:error.message});
  }
});
