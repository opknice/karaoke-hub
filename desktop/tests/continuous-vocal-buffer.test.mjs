import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ContinuousVocalBuffer} from '../audio/continuous-vocal-buffer.mjs';

const rate=1000;
const signal=i=>.15+(i%997)/2000;
function setup(){const pcm=[],states=[];const buffer=new ContinuousVocalBuffer({sampleRate:rate,onPcm:p=>pcm.push(p),onState:s=>states.push(s)});buffer.begin({sessionEpoch:1});return{buffer,pcm,states};}
function render(buffer,start,count,{feed,quiet=false}={}){
 const l=Float32Array.from({length:count},(_,i)=>quiet?0:signal(start+i)),r=Float32Array.from(l,v=>v*.5),outL=new Float32Array(count),outR=new Float32Array(count);
 for(let offset=0;offset<count;offset+=100){const end=Math.min(count,offset+100);buffer.process(l.subarray(offset,end),r.subarray(offset,end),outL.subarray(offset,end),outR.subarray(offset,end),start+offset);feed?.();}
 return[outL,outR];
}
test('original always uses the same eight-second timeline and keeps exact stereo frame order',()=>{
 const {buffer}=setup();const [l,r]=render(buffer,0,11000);
 assert.ok(l.subarray(0,8000).every(v=>v===0));
 for(let i=8000;i<11000;i++){assert.ok(Math.abs(l[i]-signal(i-8000))<1e-7);assert.ok(Math.abs(r[i]-signal(i-8000)*.5)<1e-7);}
 assert.equal(buffer.capacity,12000);assert.equal(buffer.captured,11000);
});
test('dry to AI to dry subtracts aligned vocals with a 20ms ramp and never resets the timeline',()=>{
 const {buffer,pcm,states}=setup();buffer.beginAi({epoch:1,spanMode:'final',maxResultFrames:1000});
 const feed=()=>{while(pcm.length){const p=pcm.shift();const estimated=Float32Array.from(p.pcm,s=>s*.25);assert.equal(buffer.receive({epoch:p.epoch,startFrame:p.sequence*1000,pcm:estimated}),true);}};
 render(buffer,0,9000,{feed});const before=buffer.captured;buffer.remove(true);
 const [wet]=render(buffer,9000,100,{feed});
 for(let i=0;i<100;i++){const mix=Math.min(1,(i+1)/20);assert.ok(Math.abs(wet[i]-signal(1000+i)*(1-mix*.25))<1e-6);}
 assert.equal(buffer.captured,before+100);assert.ok(states.some(s=>s.kind==='ai'&&s.status==='on'));
 buffer.remove(false);const [dry]=render(buffer,9100,100,{feed});
 for(let i=0;i<100;i++){const mix=Math.max(0,1-(i+1)/20);assert.ok(Math.abs(dry[i]-signal(1100+i)*(1-mix*.25))<1e-6);}
});
test('loading, changing and failing AI leaves original frames uninterrupted and rejects stale spans',()=>{
 const {buffer,states}=setup();render(buffer,0,9000);buffer.remove(true);
 const [waiting]=render(buffer,9000,1000);for(let i=0;i<1000;i++)assert.ok(Math.abs(waiting[i]-signal(1000+i))<1e-7);
 buffer.beginAi({epoch:2,spanMode:'final',maxResultFrames:1000});const base=buffer.captured;
 assert.equal(buffer.receive({epoch:1,startFrame:0,pcm:new Float32Array(1000)}),false);
 const [reprime]=render(buffer,10000,11000);
 for(let i=0;i<11000;i++)assert.ok(Math.abs(reprime[i]-signal(2000+i))<1e-7);
 assert.equal(buffer.captured,base+11000);assert.ok(states.some(s=>s.kind==='ai'&&s.status==='error'));
});
test('pause and resume retain captured source frames and AI input position',()=>{
 const {buffer}=setup();render(buffer,0,9000);buffer.pause();const before=buffer.captured;
 const [paused]=render(buffer,9000,500);assert.ok(paused.every(v=>v===0));assert.equal(buffer.captured,before);
 buffer.resume();const [resumed]=render(buffer,9000,1000);
 for(let i=0;i<1000;i++)assert.ok(Math.abs(resumed[i]-signal(1000+i))<1e-7);
});
test('storage stays fixed through long ring wrap and new session invalidates old estimates',()=>{
 const {buffer}=setup();const size=()=>Object.values(buffer).filter(v=>ArrayBuffer.isView(v)).reduce((s,v)=>s+v.byteLength,0);const bytes=size();
 render(buffer,0,90000);assert.equal(size(),bytes);assert.equal(buffer.capacity,12000);
 buffer.beginAi({epoch:3,spanMode:'final',maxResultFrames:1000});render(buffer,90000,1000);
 assert.equal(buffer.receive({epoch:3,startFrame:0,pcm:new Float32Array(2000).fill(NaN)}),false);
 assert.equal(buffer.receive({epoch:3,startFrame:1000,pcm:new Float32Array(1000)}),false,'Final spans must be contiguous');
 buffer.begin({sessionEpoch:2});assert.equal(buffer.receive({epoch:3,startFrame:0,pcm:new Float32Array(1000)}),false);
 assert.ok(render(buffer,0,8000,{quiet:true})[0].every(v=>v===0));
});
test('background AI remains time-aligned across ninety seconds and ring wraps while removal is off',()=>{
 const {buffer,pcm}=setup();buffer.beginAi({epoch:4,spanMode:'final',maxResultFrames:1000});
 const feed=()=>{while(pcm.length){const p=pcm.shift();buffer.receive({epoch:p.epoch,startFrame:p.sequence*1000,pcm:Float32Array.from(p.pcm,v=>v*.25)});}};
 render(buffer,0,90000,{feed});assert.equal(buffer.lastAiStatus,'ready');buffer.remove(true);
 const [wet]=render(buffer,90000,100,{feed});for(let i=20;i<100;i++)assert.ok(Math.abs(wet[i]-signal(82000+i)*.75)<1e-6);
});
