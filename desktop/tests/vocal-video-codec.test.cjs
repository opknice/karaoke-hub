const {test}=require('node:test'),assert=require('node:assert/strict');
const load=()=>require('../lib/vocal-video-codec.cjs').createEncodedVideoQueue;
function frame(timestamp){return{timestamp,closed:0,close(){this.closed++;}};}
function fakeCodecs(context,{hold=false,supported=true}={}){
 const oldEncoder=globalThis.VideoEncoder,oldDecoder=globalThis.VideoDecoder,encoders=[],decoders=[];
 class Encoder{
  static async isConfigSupported(config){return{supported,config};}
  constructor(callbacks){this.callbacks=callbacks;this.state='unconfigured';this.encodeQueueSize=0;encoders.push(this);}
  configure(){this.state='configured';}close(){this.state='closed';}async flush(){}
  encode(input){this.encodeQueueSize++;if(!hold)this.deliver(input.timestamp);}
  deliver(timestamp,bytes=256){this.encodeQueueSize=Math.max(0,this.encodeQueueSize-1);this.callbacks.output({timestamp,byteLength:bytes,type:'key'},{decoderConfig:{codec:'vp8'}});}
 }
 class Decoder{
  static async isConfigSupported(config){return{supported,config};}
  constructor(callbacks){this.callbacks=callbacks;this.state='unconfigured';this.decodeQueueSize=0;decoders.push(this);}
  configure(){this.state='configured';}close(){this.state='closed';}async flush(){}
  decode(chunk){this.callbacks.output(frame(chunk.timestamp));}
 }
 globalThis.VideoEncoder=Encoder;globalThis.VideoDecoder=Decoder;
 context.after(()=>{globalThis.VideoEncoder=oldEncoder;globalThis.VideoDecoder=oldDecoder;});return{encoders,decoders};
}
test('encoded video releases on its eight-second clock and closes drawn frames',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});fakeCodecs(context);let now=0;const drawn=[],failures=[];
 const queue=await load()({width:1280,height:720,delayMs:8000,clock:()=>now,onFrame:item=>drawn.push(item),onFailure:error=>failures.push(error)});
 try{const input=frame(0);assert.equal(queue.push(input,{captured:0,time:12}),true);assert.equal(input.closed,1);assert.equal(queue.snapshot().encodedBytes,256);
 now=7999;context.mock.timers.tick(7999);assert.equal(drawn.length,0);now=8000;context.mock.timers.tick(1);
 assert.equal(drawn.length,1);assert.equal(drawn[0].time,12);assert.equal(drawn[0].captured,0);assert.equal(drawn[0].frame.closed,1);assert.equal(queue.snapshot().encodedBytes,0);assert.deepEqual(failures,[]);
 }finally{queue.close();}
});
test('encoded byte limits stop the stream rather than allowing growing queues',async context=>{
 fakeCodecs(context);const failures=[];const queue=await load()({width:1280,height:720,delayMs:8000,maxBytes:400,clock:()=>0,onFrame(){},onFailure:message=>failures.push(message)});
 try{queue.push(frame(0),{captured:0,time:0});queue.push(frame(33333),{captured:33,time:.033});assert.equal(failures.length,1);assert.equal(queue.snapshot().failed,true);assert.equal(queue.snapshot().encodedBytes,0);}finally{queue.close();}
});
test('reset and close discard late encoded/decoded frames from a prior generation',async context=>{
 const {encoders,decoders}=fakeCodecs(context,{hold:true});const drawn=[],failures=[];
 const queue=await load()({width:1280,height:720,delayMs:8000,clock:()=>0,onFrame:item=>drawn.push(item),onFailure:error=>failures.push(error)});
 queue.push(frame(0),{captured:0,time:0});const oldEncoder=encoders[0],oldDecoder=decoders[0];queue.clear();oldEncoder.deliver(0);const late=frame(0);oldDecoder.callbacks.output(late);
 assert.equal(late.closed,1);assert.equal(queue.snapshot().bufferedFrames,0);assert.equal(drawn.length,0);assert.deepEqual(failures,[]);
 queue.push(frame(1000),{captured:1,time:1});queue.close();const after=frame(1000);decoders.at(-1).callbacks.output(after);assert.equal(after.closed,1);assert.equal(queue.snapshot().active,false);assert.equal(drawn.length,0);
});
test('encoder backpressure bounds pending jobs and drops excess input without leaking frames',async context=>{
 fakeCodecs(context,{hold:true});const queue=await load()({width:1280,height:720,delayMs:8000,clock:()=>0,onFrame(){},onFailure(){}});
 try{const inputs=Array.from({length:12},(_,index)=>frame(index*33333));inputs.forEach((input,index)=>queue.push(input,{captured:index*33,time:index/30}));assert.ok(queue.snapshot().pendingEncodes<=4);assert.equal(queue.snapshot().droppedFrames,8);assert.ok(inputs.every(input=>input.closed===1));}finally{queue.close();}
});
test('unsupported codecs reject HQ setup',async context=>{
 fakeCodecs(context,{supported:false});await assert.rejects(()=>load()({width:1280,height:720,delayMs:8000,onFrame(){},onFailure(){}}),/รองรับ|codec/i);
});
test('decoder failure reports once and releases its queues',async context=>{
 const {decoders}=fakeCodecs(context);const failures=[];const queue=await load()({width:1280,height:720,delayMs:8000,onFrame(){},onFailure:error=>failures.push(error)});
 decoders[0].callbacks.error(new Error('decode failed'));decoders[0].callbacks.error(new Error('second error'));assert.equal(failures.length,1);assert.equal(queue.snapshot().failed,true);queue.close();
});
