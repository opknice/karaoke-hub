const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {VocalWorker}=require('../lib/vocal-worker.cjs');
const sha='8289784cda38543ff431add4070662813311a8cccfc0112ca82f76d9dba2b4ca';
function setup(){
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;};
 const output=[],failures=[],started=[];
 const worker=new VocalWorker({paths:{python:__filename,worker:__filename,model:__filename},spawn:(...args)=>{started.push(args);return child;},onResult:packet=>output.push(packet),onFailure:error=>failures.push(error)});
 const packet=value=>child.stdout.write(JSON.stringify(value)+'\n');
 worker.start();packet({type:'ready',provider:'DirectML',name:'GPU',modelSha256:sha,onePassMs:300,twoPassMs:600,denoise:true});
 return {worker,child,output,failures,started,packet};
}
test('worker forwards validated stereo PCM and discards results after an epoch reset',()=>{
 const {worker,child,output,failures,started,packet}=setup();
 try{
  assert.equal(worker.ready,true);assert.equal(started[0][2].windowsHide,true);
  worker.reset(1);
  assert.equal(worker.feed({epoch:1,sequence:0,pcm:new Float32Array(88200)}),true);
  const pcm=Buffer.from(new Float32Array(49612*2).fill(.1).buffer).toString('base64');
  packet({type:'result',epoch:1,sequence:0,frames:49612,startFrame:0,computeMs:700,pcm});
  assert.equal(output.length,1);assert.equal(output[0].pcm.length,99224);
  assert.ok(Math.abs(output[0].pcm[0]-.1)<1e-6);
  assert.equal(worker.feed({epoch:1,sequence:1,pcm:new Float32Array(88200)}),true);
  worker.reset(2);
  packet({type:'result',epoch:1,sequence:1,frames:49612,startFrame:44100,computeMs:700,pcm});
  assert.equal(output.length,1);assert.deepEqual(failures,[]);
  assert.equal(worker.feed({epoch:1,sequence:2,pcm:new Float32Array(88200)}),false);
  assert.ok(child.stdin.readableLength>0);
 }finally{worker.stop();}
});
test('malformed model output revokes readiness instead of sending invalid samples to speakers',()=>{
 const {worker,child,output,failures,packet}=setup();
 try{
  worker.reset(1);worker.feed({epoch:1,sequence:0,pcm:new Float32Array(88200)});
  packet({type:'result',epoch:1,sequence:0,frames:49612,startFrame:0,computeMs:700,pcm:'AA=='});
  assert.equal(worker.ready,false);assert.equal(child.killed,true);assert.equal(output.length,0);assert.equal(failures.length,1);
 }finally{worker.stop();}
});
test('worker input queue is bounded and nonfinite source PCM is rejected',()=>{
 const {worker,failures}=setup();
 try{
  worker.reset(1);
  assert.equal(worker.feed({epoch:1,sequence:0,pcm:new Float32Array(88200).fill(NaN)}),false);
  assert.equal(worker.feed({epoch:1,sequence:0,pcm:new Float32Array(88200)}),true);
  assert.equal(worker.feed({epoch:1,sequence:1,pcm:new Float32Array(88200)}),true);
  assert.equal(worker.feed({epoch:1,sequence:2,pcm:new Float32Array(88200)}),false);
  assert.equal(failures.length,1);
  assert.equal(worker.feed({epoch:1,sequence:3,pcm:new Float32Array(88200)}),false,'Failed stream stays stopped until reset');
 }finally{worker.stop();}
});

test('a requested HQ model cannot become ready using the old model identity or reduced-quality calibration',()=>{
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
 const failures=[];const worker=new VocalWorker({profile:{id:'hq5'},paths:{python:__filename,worker:__filename,model:__filename},spawn:()=>child,onFailure:value=>failures.push(value)});
 try{worker.start();child.stdout.write(JSON.stringify({type:'ready',modelId:'fast',provider:'DirectML',name:'GPU',modelSha256:sha,onePassMs:300,twoPassMs:600,denoise:true})+'\n');assert.equal(worker.ready,false);assert.equal(failures.length,1);}finally{worker.stop();}
});
test('switching the worker model revokes old readiness and accepts only its new child output',()=>{
 const children=[];const makeChild=()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;};children.push(child);return child;};
 const worker=new VocalWorker({paths:{python:__filename,worker:__filename,model:__filename},spawn:makeChild});
 const send=(child,profile,modelSha256)=>child.stdout.write(JSON.stringify({type:'ready',modelId:profile,provider:'DirectML',name:'GPU',modelSha256,onePassMs:300,twoPassMs:600,denoise:true})+'\n');
 try{worker.start();send(children[0],'fast',sha);assert.equal(worker.ready,true);
 assert.equal(typeof worker.selectModel,'function');worker.selectModel({profile:{id:'hq5'},paths:{python:__filename,worker:__filename,model:__filename}});
 assert.equal(children[0].killed,true);assert.equal(worker.ready,false);assert.equal(children.length,2);
 send(children[0],'fast',sha);assert.equal(worker.ready,false);send(children[1],'hq5','811cb24095d865763752310848b7ec86aeede0626cb05749ab35350e46897000');assert.equal(worker.ready,true);assert.equal(worker.profile.id,'hq5');
 }finally{worker.stop();}
});

test('incomplete model selection cannot terminate the currently ready worker',()=>{
 const {worker,child}=setup();
 try{assert.throws(()=>worker.selectModel({profile:{},paths:{python:__filename,worker:__filename,model:__filename}}),/model|profile/i);assert.equal(worker.ready,true);assert.notEqual(child.killed,true);}finally{worker.stop();}
});
