import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiveVocalBuffer} from '../audio/vocal-buffer.mjs';

function setup(){const pcm=[],states=[];const buffer=new LiveVocalBuffer({sampleRate:16,delaySeconds:4,onPcm:packet=>pcm.push(packet),onState:state=>states.push(state)});return {buffer,pcm,states};}
function process(buffer,length,offset=0){const left=Float32Array.from({length},(_,i)=>(i+offset+1)/100),right=Float32Array.from(left,n=>n*.5),outL=new Float32Array(length),outR=new Float32Array(length);buffer.process(left,right,outL,outR,offset);return {left,right,outL,outR};}
test('live removal plays timestamped instrumental at a fixed delay, keeping both channels',()=>{
 const {buffer,pcm,states}=setup();buffer.enable({epoch:1,startFrame:0});
 const initial=process(buffer,48);
 assert.ok(initial.outL.every(n=>n===0));assert.equal(pcm.length,3);assert.equal(pcm[0].sequence,0);assert.equal(pcm[0].pcm.length,32);
 const vocals=new Float32Array(40);for(let i=0;i<20;i++){vocals[i*2]=.002;vocals[i*2+1]=.001;}
 buffer.receive({epoch:1,sequence:2,startFrame:0,pcm:vocals});
 const rest=process(buffer,32,48);
 assert.ok(rest.outL.subarray(0,16).every(n=>n===0));
 for(let i=0;i<16;i++){assert.ok(Math.abs(rest.outL[16+i]-((i+1)/100-.002))<1e-6);assert.ok(Math.abs(rest.outR[16+i]-((i+1)/200-.001))<1e-6);}
 assert.equal(states.some(s=>s.status==='on'),true);
});
test('stream epochs revoke stale estimates and disable returns the untouched original',()=>{
 const {buffer,states}=setup();buffer.enable({epoch:1,startFrame:0});process(buffer,48);
 buffer.enable({epoch:2,startFrame:48});
 assert.equal(buffer.receive({epoch:1,sequence:2,startFrame:0,pcm:new Float32Array(40)}),false);
 buffer.disable();const result=process(buffer,32,48);
 assert.deepEqual(result.outL,result.left);assert.deepEqual(result.outR,result.right);
 assert.equal(states.some(s=>s.status==='on'),false);
});
test('missing estimates report a deadline failure and can never advertise successful removal',()=>{
 const {buffer,states}=setup();buffer.enable({epoch:1,startFrame:0});process(buffer,96);
 assert.equal(states.some(s=>s.status==='error'),true);
 assert.equal(states.some(s=>s.status==='on'),false);
});
test('common activation time preserves original audio until buffering begins',()=>{
 const {buffer}=setup();buffer.enable({epoch:1,startFrame:32});const result=process(buffer,48);
 assert.deepEqual(result.outL.subarray(0,32),result.left.subarray(0,32));
 assert.ok(result.outL.subarray(32).every(n=>n===0));
});
