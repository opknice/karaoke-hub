import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ContinuousVocalBuffer} from '../audio/continuous-vocal-buffer.mjs';

const rate=1000;
const instrumental=(i,right=false)=>(right?-.16:.22)+(i%43)*.001;
const vocal=(i,right=false)=>(right?.07:.11)+(i%19)*.0015;
function setup(){
 let cursor=0,aiBase=0,delivery=true;const states=[];
 const buffer=new ContinuousVocalBuffer({sampleRate:rate,onState:s=>states.push(s),onPcm:p=>{
  if(!delivery)return;
  const pcm=Float32Array.from({length:rate*2},(_,i)=>vocal(aiBase+p.sequence*rate+Math.floor(i/2),i%2===1));
  buffer.receive({epoch:p.epoch,startFrame:p.sequence*rate,pcm});
 }});buffer.begin({sessionEpoch:1});
 const startAI=epoch=>{aiBase=cursor;buffer.beginAi({epoch,spanMode:'final',maxResultFrames:rate});};
 const run=count=>{const start=cursor,out=[new Float32Array(count),new Float32Array(count)];
  for(let offset=0;offset<count;offset+=100){const n=Math.min(100,count-offset),input=[false,true].map(r=>Float32Array.from({length:n},(_,j)=>instrumental(cursor+j,r)+vocal(cursor+j,r)));
   buffer.process(input[0],input[1],out[0].subarray(offset,offset+n),out[1].subarray(offset,offset+n));if(!buffer.paused)cursor+=n;
  }return{start,out};};
 return{buffer,states,startAI,run,dropResults:()=>{delivery=false;}};
}
function check({start,out},level,from=30){for(let i=from;i<out[0].length;i++)for(let c=0;c<2;c++){
 const frame=start+i-8000,expected=instrumental(frame,c===1)+vocal(frame,c===1)*level/100;
 assert.ok(Math.abs(out[c][i]-expected)<1e-6,`level${level} frame${frame} channel${c}: ${out[c][i]} vs ${expected}`);
}}

test('0/25/50/75/100 percent scales only independent vocal stems at the same stereo source frames',()=>{
 const s=setup();s.startAI(1);s.run(9000);s.buffer.remove(true);const epoch=s.buffer.sessionEpoch;
 for(const level of [0,25,50,75,100,50,0]){s.buffer.setLevel(level);check(s.run(100),level);assert.equal(s.buffer.lastAiStatus,'on');assert.equal(s.buffer.sessionEpoch,epoch);}
 assert.equal(s.buffer.captured,9700);
});
test('percentage transition smoothly changes subtraction and reaches both endpoints without gain boost or frame reset',()=>{
 const s=setup();s.startAI(1);s.run(9000);s.buffer.remove(true);s.run(100);s.buffer.setLevel(100);const sample=s.run(100);
 for(let i=0;i<100;i++){const frame=sample.start+i-8000,mix=Math.max(0,1-(i+1)/20);const expected=instrumental(frame)+vocal(frame)*(1-mix);assert.ok(Math.abs(sample.out[0][i]-expected)<1e-6);}
 assert.equal(s.buffer.lastAiStatus,'on');s.buffer.setLevel(25);check(s.run(100),25);
});
test('selection survives off/on, pause, AI replacement and a new track; missing AI restores original',()=>{
 const s=setup();s.buffer.setLevel(25);s.startAI(1);s.run(9000);s.buffer.remove(true);check(s.run(100),25);
 s.buffer.remove(false);check(s.run(100),100);assert.equal(s.buffer.vocalLevel,25);s.buffer.remove(true);check(s.run(100),25);
 s.buffer.pause();s.buffer.setLevel(75);const before=s.buffer.captured;assert.ok(s.run(100).out[0].every(v=>v===0));assert.equal(s.buffer.captured,before);s.buffer.resume();check(s.run(100),75);
 s.buffer.endAi();check(s.run(100),100);s.startAI(2);s.run(9000);s.buffer.remove(true);check(s.run(100),75);
 s.buffer.begin({sessionEpoch:2});assert.equal(s.buffer.vocalLevel,75);assert.equal(s.buffer.desired,false);
});
test('integer percent validation rejects nonfinite, coerced and out-of-range values without changing selection',()=>{
 const s=setup();assert.equal(s.buffer.vocalLevel,0);s.buffer.setLevel(50);
 for(const value of [-1,101,.5,NaN,Infinity,'50',null,undefined]){assert.throws(()=>s.buffer.setLevel(value),RangeError);assert.equal(s.buffer.vocalLevel,50);}
});
test('late estimates at a partial level fall back to original without erasing the selection or timeline',()=>{
 const s=setup();s.buffer.setLevel(50);s.startAI(1);s.run(9000);s.buffer.remove(true);check(s.run(100),50);const epoch=s.buffer.sessionEpoch;
 s.dropResults();s.run(10000);check(s.run(100),100);assert.equal(s.buffer.vocalLevel,50);assert.equal(s.buffer.sessionEpoch,epoch);assert.ok(s.states.some(p=>p.status==='error'));
});
