// Serialized into the trusted media frame; no Node dependencies in this function.
async function createEncodedVideoQueue({width,height,delayMs,onFrame,onFailure,clock=()=>performance.timeOrigin+performance.now(),maxBytes=64*1024*1024}) {
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<2||height<2||width>1280||height>720
    ||!Number.isFinite(delayMs)||delayMs<1000||delayMs>8500||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024)throw new Error('Invalid encoded video buffer');
  if(typeof VideoEncoder!=='function'||typeof VideoDecoder!=='function')throw new Error('เครื่องนี้ไม่รองรับการซิงก์ภาพโหมดคุณภาพสูง');
  let configuration;
  for(const codec of ['vp8','avc1.42001f']) {
    const candidate={codec,width,height,bitrate:4000000,framerate:30,latencyMode:'realtime',hardwareAcceleration:'no-preference',...(codec.startsWith('avc')?{avc:{format:'annexb'}}:{})};
    try {
      const encoded=await VideoEncoder.isConfigSupported(candidate);
      const decoded=await VideoDecoder.isConfigSupported({codec,codedWidth:width,codedHeight:height,hardwareAcceleration:'no-preference'});
      if(encoded.supported&&decoded.supported){configuration=candidate;break;}
    }catch{ /* Try the next explicitly supported codec. */ }
  }
  if(!configuration)throw new Error('เครื่องนี้ไม่รองรับตัวบีบอัดภาพสำหรับโหมดคุณภาพสูง');
  const queue=[],encoding=new Map(),decoding=new Map();
  let encoder,decoder,timer=null,generation=0,closed=false,failed=false,bytes=0,dropped=0,frameCount=0;
  let decoderConfigured=false,lastTimestamp=-1,lastEncodedTimestamp=-1,ended=false,flushing=false;
  function dispose(){
    ++generation;clearTimeout(timer);timer=null;queue.length=0;encoding.clear();decoding.clear();bytes=0;
    for(const codec of [encoder,decoder])if(codec&&codec.state!=='closed'){try{codec.close();}catch{}}
    encoder=null;decoder=null;decoderConfigured=false;
  }
  function fail(error){
    if(closed)return;failed=true;closed=true;dispose();onFailure(String(error?.message??error).slice(0,300));
  }
  function schedule(){
    if(closed||timer||!queue.length)return;
    const wait=decoding.size>=4?5:Math.max(1,queue[0].release-clock());
    timer=setTimeout(drain,wait);
  }
  function flushTail(){
    if(closed||!ended||flushing||queue.length||encoding.size||!decoderConfigured)return;
    flushing=true;const epoch=generation;
    void decoder.flush().catch(error=>{if(epoch===generation)fail(error);}).finally(()=>{if(epoch===generation)flushing=false;});
  }
  function drain(){
    timer=null;if(closed)return;
    try{
      while(queue.length&&queue[0].release<=clock()&&decoding.size<4){
        const item=queue.shift();bytes-=item.chunk.byteLength;
        if(!decoderConfigured){decoder.configure(item.decoderConfig??{codec:configuration.codec,codedWidth:width,codedHeight:height});decoderConfigured=true;}
        decoding.set(item.chunk.timestamp,item);decoder.decode(item.chunk);
      }
      schedule();flushTail();
    }catch(error){fail(error);}
  }
  function initialize(){
    if(closed||encoder)return;
    const epoch=++generation;
    decoder=new VideoDecoder({
      output(frame){
        try{
          if(closed||epoch!==generation)return;
          const item=decoding.get(frame.timestamp);decoding.delete(frame.timestamp);
          if(item)onFrame({frame,captured:item.captured,time:item.time});
          schedule();
        }catch(error){fail(error);}finally{frame.close();}
      },
      error(error){if(epoch===generation)fail(error);},
    });
    encoder=new VideoEncoder({
      output(chunk,metadata){
        if(closed||epoch!==generation)return;
        const item=encoding.get(chunk.timestamp);encoding.delete(chunk.timestamp);
        if(!item)return;
        if(chunk.timestamp<=lastEncodedTimestamp){fail(new Error('ลำดับภาพไม่ต่อเนื่อง'));return;}
        lastEncodedTimestamp=chunk.timestamp;
        const config=metadata?.decoderConfig;
        const decoderConfig=config?{...config,...(config.description?{description:new Uint8Array(config.description).slice()}: {})}:undefined;
        if(bytes+chunk.byteLength>maxBytes||queue.length>=512){fail(new Error('บัฟเฟอร์ภาพโหมดคุณภาพสูงเต็ม'));return;}
        queue.push({...item,chunk,decoderConfig});bytes+=chunk.byteLength;schedule();
      },
      error(error){if(epoch===generation)fail(error);},
    });
    encoder.configure(configuration);
  }
  try{initialize();}catch(error){dispose();throw error;}
  return {
    push(frame,{captured,time}){
      try{
        if(closed||ended)return false;
        if(!Number.isFinite(captured)||!Number.isFinite(time)||time<0||!Number.isSafeInteger(frame.timestamp)||frame.timestamp<0)throw new Error('Invalid captured video clock');
        if(frame.timestamp<=lastTimestamp){dropped++;return false;}
        initialize();
        if(encoding.size>=4||encoder.encodeQueueSize>=4){dropped++;return false;}
        lastTimestamp=frame.timestamp;encoding.set(frame.timestamp,{captured,time,release:captured+delayMs});
        encoder.encode(frame,{keyFrame:frameCount++%30===0});return true;
      }catch(error){fail(error);return false;}finally{frame.close();}
    },
    clear(){if(closed)return;dispose();lastTimestamp=-1;lastEncodedTimestamp=-1;frameCount=0;ended=false;flushing=false;},
    finish(){
      if(closed||ended)return;ended=true;const epoch=generation;
      if(encoder)void encoder.flush().then(()=>{if(epoch===generation){schedule();flushTail();}}).catch(error=>{if(epoch===generation)fail(error);});
    },
    close(){if(closed)return;closed=true;dispose();},
    snapshot(){return{active:!closed,failed,codec:configuration.codec,width,height,bufferedFrames:queue.length,encodedBytes:bytes,
      pendingEncodes:encoding.size,pendingDecodes:decoding.size,encoderQueue:encoder?.encodeQueueSize??0,decoderQueue:decoder?.decodeQueueSize??0,droppedFrames:dropped};},
  };
}
module.exports={createEncodedVideoQueue};
