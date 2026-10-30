const {_electron:electron}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),http=require('node:http');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const moduleSource=`import {ContinuousVocalBuffer} from 'karaoke-app://app/audio/continuous-vocal-buffer.mjs';
class ContinuityFixture extends AudioWorkletProcessor{
 constructor(){super();this.sourceFrame=0;this.checked=0;this.errors=0;this.maxError=0;this.wanted=false;this.onAt=Infinity;this.changedAt=0;this.aiBase=0;this.aiEpoch=1;this.status='preparing';
  this.buffer=new ContinuousVocalBuffer({sampleRate,onPcm:p=>this.buffer.receive({epoch:p.epoch,startFrame:p.sequence*sampleRate,pcm:Float32Array.from(p.pcm,v=>v*.25)}),onState:s=>{if(s.kind==='ai'){this.status=s.status;if(s.status==='on')this.onAt=this.buffer.captured;}}});
  this.buffer.begin({sessionEpoch:1});this.buffer.beginAi({epoch:1,spanMode:'final',maxResultFrames:sampleRate});
  this.port.onmessage=({data})=>{if(data.type==='mix'){this.wanted=data.enabled;this.changedAt=this.sourceFrame;this.onAt=Infinity;this.buffer.remove(data.enabled);}if(data.type==='model'){this.buffer.endAi();this.aiBase=this.sourceFrame;this.onAt=Infinity;this.buffer.beginAi({epoch:++this.aiEpoch,spanMode:'final',maxResultFrames:sampleRate});this.buffer.remove(this.wanted);}if(data.type==='pause')this.buffer.pause();if(data.type==='resume')this.buffer.resume();};
 }
 process(_input,outputs){const out=outputs[0],n=out[0].length;const left=new Float32Array(n),right=new Float32Array(n);const start=this.sourceFrame,paused=this.buffer.paused;
  for(let i=0;i<n;i++){left[i]=.2+(start+i)/10000000;right[i]=left[i]*.5;}
  this.buffer.process(left,right,out[0],out[1]);
  for(let i=0;i<n;i++){const frame=start+i;if(paused||frame<sampleRate*8){if(out[0][i]!==0||out[1][i]!==0)this.errors++;continue;}
   const original=Math.fround(.2+(frame-sampleRate*8)/10000000);let ratio=null;
   if(!this.wanted&&frame-this.changedAt>sampleRate*.04)ratio=1;
   if(this.wanted&&frame>this.onAt+sampleRate*.04)ratio=.75;
   if(this.wanted&&frame<this.aiBase+sampleRate*8)ratio=1;
   if(out[0][i]<original*.74||out[0][i]>original*1.01)this.errors++;
   if(ratio!==null){const error=Math.max(Math.abs(out[0][i]-original*ratio),Math.abs(out[1][i]-original*ratio*.5));this.maxError=Math.max(this.maxError,error);if(error>1e-6)this.errors++;this.checked++;}
  }
  if(!paused)this.sourceFrame+=n;if(this.sourceFrame!==this.buffer.captured)this.errors++;
  if(!this.lastReport||currentTime-this.lastReport>.1){this.lastReport=currentTime;this.port.postMessage({frames:this.sourceFrame,checked:this.checked,errors:this.errors,maxError:this.maxError,status:this.status,paused:this.buffer.paused});}return true;
 }
}registerProcessor('continuity-fixture',ContinuityFixture);`;
(async()=>{
 const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>Continuous timestamp fixture</h1>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const env={...process.env,KARAOKE_PLAYER_URL:`http://127.0.0.1:${server.address().port}/player`,KARAOKE_USER_DATA:fs.mkdtempSync(path.join(os.tmpdir(),'karaoke-clock-fixture-'))};delete env.ELECTRON_RUN_AS_NODE;
 const fixture=path.resolve(__dirname,'../audio/assets/continuity-fixture.mjs');fs.writeFileSync(fixture,moduleSource,{flag:'wx'});
 let app;
 try{app=await electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env});
  app.on('console',message=>console.log('Fixture native:',message.text()));
  for(const page of app.context().pages())page.on('console',message=>{if(message.type()==='error')console.error('Fixture renderer:',message.text());});
  await app.evaluate(async({webContents})=>{const host=webContents.getAllWebContents().find(w=>w.getURL()==='karaoke-app://app/audio/index.html');await host.executeJavaScript(`(async()=>{const context=new AudioContext({sampleRate:44100});await context.audioWorklet.addModule('karaoke-app://app/audio/assets/continuity-fixture.mjs');const node=new AudioWorkletNode(context,'continuity-fixture',{outputChannelCount:[2]});const mute=context.createGain();mute.gain.value=0;node.connect(mute).connect(context.destination);window.__continuityFixture={context,node,state:null};node.port.onmessage=event=>window.__continuityFixture.state=event.data;await context.resume();})()`);});
  const read=()=>app.evaluate(async({webContents})=>webContents.getAllWebContents().find(w=>w.getURL()==='karaoke-app://app/audio/index.html').executeJavaScript('window.__continuityFixture.state'));
  const command=data=>app.evaluate(async({webContents},data)=>webContents.getAllWebContents().find(w=>w.getURL()==='karaoke-app://app/audio/index.html').executeJavaScript(`window.__continuityFixture.node.port.postMessage(${JSON.stringify(data)})`),data);
  const wait=async(check,label,timeout=15000)=>{const end=Date.now()+timeout;let last;while(Date.now()<end){last=await read();if(last?.errors)throw new Error(JSON.stringify(last));if(check(last))return last;await sleep(100);}throw new Error(`${label}: ${JSON.stringify(last)}`);};
  await wait(s=>s?.frames>44100*9,'Initial eight-second timestamped dry signal');await command({type:'mix',enabled:true});await wait(s=>s?.status==='on','Same-position AI mix');await sleep(800);
  await command({type:'mix',enabled:false});await sleep(100);await command({type:'model'});await command({type:'mix',enabled:true});await wait(s=>s?.status==='on','Original through fresh AI epoch',12000);
  await command({type:'pause'});const paused=await wait(s=>s?.paused,'Pause');await sleep(500);assert.equal((await read()).frames,paused.frames);await command({type:'resume'});await sleep(800);
  const final=await read();assert.equal(final.errors,0);assert.ok(final.checked>44100*10,JSON.stringify(final));assert.ok(final.maxError<1e-6);
  console.log('PASS actual AudioWorklet timestamp/stereo continuity through dry/wet/model/pause transitions',final);
 }finally{try{if(app)await app.close();await new Promise(r=>server.close(r));}finally{assert.equal(path.dirname(fixture),path.resolve(__dirname,'../audio/assets'));fs.unlinkSync(fixture);}}
})().catch(error=>{console.error(error);process.exitCode=1;});
