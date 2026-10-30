const path=require('node:path'),assert=require('node:assert/strict');
const {VocalWorker}=require('../lib/vocal-worker.cjs');
const {getVocalModel}=require('../lib/vocal-models.cjs');
const root=process.env.KARAOKE_VOCAL_ROOT||path.resolve(__dirname,'../vocal');
const profile=getVocalModel(process.env.KARAOKE_VOCAL_MODEL||'fast');
(async()=>{
 let timer,interval,worker;const outputs=[];let sequence=0;
 try{await new Promise((resolve,reject)=>{
  const send=()=>{
   if(sequence===(profile.id==='hq5'?11:6)){clearInterval(interval);return;}
   const pcm=new Float32Array(88200);
   for(let i=0;i<44100;i++){pcm[i*2]=.1*Math.sin(2*Math.PI*440*(i+sequence*44100)/44100);pcm[i*2+1]=.1*Math.sin(2*Math.PI*660*(i+sequence*44100)/44100);}
   if(!worker.feed({epoch:1,sequence:sequence++,pcm}))reject(new Error('Worker refused a real-time source block'));
  };
  worker=new VocalWorker({profile,paths:{python:path.join(root,'runtime/python/python.exe'),worker:path.join(root,'worker.py'),model:process.env.KARAOKE_VOCAL_MODEL_PATH||path.join(root,'runtime',profile.filename)},
   onReady:details=>{console.log('Prepared GPU',details.name,'denoise',details.denoise);worker.reset(1);send();interval=setInterval(send,1000);},
   onResult:packet=>{outputs.push(packet);if(outputs.length===4)resolve();},onFailure:failure=>reject(new Error(failure.message)),
  });
  timer=setTimeout(()=>reject(new Error('Vocal runtime smoke timed out')),30000);worker.start();
 });
 assert.deepEqual(outputs.map(result=>result.startFrame),profile.id==='hq5'?[0,65280,130560,195840]:[0,38588,82688,126788]);
 assert.ok(outputs.every(result=>result.pcm.length===result.frames*2&&result.pcm.every(Number.isFinite)));
 console.log('PASS isolated portable GPU runtime and actual paced streaming through native worker client');
 }finally{clearTimeout(timer);clearInterval(interval);worker?.stop();}
})().catch(error=>{console.error(error);process.exitCode=1;});
