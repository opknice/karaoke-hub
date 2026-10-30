const {isPlayerUrl}=require('./policy.cjs');
const {isYouTubeFrame}=require('./media-tempo.cjs');
const {createEncodedVideoQueue}=require('./vocal-video-codec.cjs');

// Serialized into the trusted media frame. It has no Node or filesystem access.
async function installVideoDelay(configuration,encodedFactory) {
  const validEpoch=value=>Number.isSafeInteger(value)&&value>0&&value<2**31;
  const useEncoded=configuration.videoBufferMode==='encoded';
  const continuous=configuration.continuous===true;
  if(continuous&&(!useEncoded||configuration.delayMs!==8000))throw new Error('Invalid continuous video profile');
  if(!validEpoch(configuration.epoch)||typeof configuration.token!=='string'||configuration.token.length<8||configuration.token.length>128
    ||!Number.isFinite(configuration.startWallMs)||!Number.isFinite(configuration.delayMs)||configuration.delayMs<1000||configuration.delayMs>(useEncoded?8500:4800)
    ||new URL(configuration.parentOrigin).origin!==configuration.parentOrigin)throw new Error('Invalid video delay configuration');
  window.__karaokeVocalVideo?.stop({restorePosition:false}).catch(()=>{});
  const source=document.querySelector('video.html5-main-video')||document.querySelector('video');
  if(!source||source.readyState<2||source.paused||source.ended||!Number.isFinite(source.duration))throw new Error('กรุณารอให้เพลง MV เริ่มเล่นก่อนเปิด Vocal Remover');
  if(typeof VideoFrame!=='function'||typeof source.requestVideoFrameCallback!=='function')throw new Error('เครื่องนี้ไม่รองรับการซิงก์ภาพสำหรับ Vocal Remover');
  const canvas=document.createElement('canvas');canvas.dataset.karaokeVocalVideo='true';canvas.hidden=true;
  canvas.style.cssText='position:absolute;pointer-events:none;z-index:1;object-fit:contain;background:black';
  source.parentElement.appendChild(canvas);
  const context=canvas.getContext('2d',{alpha:false,desynchronized:true});
  const resized=new OffscreenCanvas(1,1),resizeContext=resized.getContext('2d',{alpha:false});
  const wallClock=()=>performance.timeOrigin+performance.now();
  let pauseWall=null,pauseOffset=0;
  const clock=()=>((pauseWall??wallClock())-pauseOffset);
  const state={active:true,paused:false,epoch:configuration.epoch,startWallMs:configuration.startWallMs,queue:[],timer:null,callback:null,
    displayTime:source.currentTime,lastLatencyMs:0,lastDisplayedCapture:0,lastCapture:0,frozen:false,bytes:0,ignoreSeek:false,failed:false};
  let encoded=null,encodedWidth=0,encodedHeight=0;
  const holdClock=()=>{if(continuous&&pauseWall===null){pauseWall=wallClock();encoded?.pause();}};
  const resumeClock=()=>{if(continuous&&pauseWall!==null){pauseOffset+=wallClock()-pauseWall;pauseWall=null;encoded?.resume();}};
  const emit=(kind,extra={})=>window.top.postMessage({source:'karaoke-hub-live-video',token:configuration.token,epoch:state.epoch,kind,time:source.currentTime,paused:source.paused,...extra},configuration.parentOrigin);
  const clearFrames=()=>{clearTimeout(state.timer);state.timer=null;for(const item of state.queue)item.frame.close();state.queue.length=0;state.bytes=0;encoded?.clear();};
  const alignCanvas=()=>{
    canvas.style.left=`${source.offsetLeft}px`;canvas.style.top=`${source.offsetTop}px`;
    canvas.style.width=`${source.clientWidth}px`;canvas.style.height=`${source.clientHeight}px`;
  };
  const draw=item=>{
    if(canvas.width!==item.frame.displayWidth||canvas.height!==item.frame.displayHeight){canvas.width=item.frame.displayWidth;canvas.height=item.frame.displayHeight;}
    alignCanvas();context.drawImage(item.frame,0,0);canvas.hidden=false;state.displayTime=item.time;
  };
  const schedule=()=>{if(state.active&&!state.paused&&!state.timer&&state.queue.length)state.timer=setTimeout(drain,Math.max(1,state.queue[0].release-clock()));};
  function drain(){
    state.timer=null;if(!state.active||state.paused)return;
    let selected;
    while(state.queue.length&&state.queue[0].release<=clock()){
      if(selected)selected.frame.close();selected=state.queue.shift();state.bytes-=selected.bytes;
    }
    if(selected){
      try{draw(selected);state.lastDisplayedCapture=selected.captured;state.lastLatencyMs=clock()-selected.captured;}finally{selected.frame.close();}
    }
    schedule();
  }
  function capture(_now,metadata){
    if(!state.active)return;
    const now=clock();
    try{
      if(!state.paused&&!state.failed&&now>=state.startWallMs&&now-state.lastCapture>=1000/30-.5){
        let image=source;
        if(encoded){
          if(resized.width!==encodedWidth||resized.height!==encodedHeight){resized.width=encodedWidth;resized.height=encodedHeight;}
          resizeContext.drawImage(source,0,0,encodedWidth,encodedHeight);image=resized;
        }else if(source.videoWidth>1280||source.videoHeight>720){
          const scale=Math.min(1280/source.videoWidth,720/source.videoHeight);
          const width=Math.max(2,Math.round(source.videoWidth*scale)),height=Math.max(2,Math.round(source.videoHeight*scale));
          if(resized.width!==width||resized.height!==height){resized.width=width;resized.height=height;}
          resizeContext.drawImage(source,0,0,width,height);image=resized;
        }
        const frame=new VideoFrame(image,{timestamp:Math.round(now*1000)});
        if(encoded){
          if(!state.frozen){draw({frame,time:metadata.mediaTime});state.frozen=true;}
          encoded.push(frame,{captured:now,time:metadata.mediaTime});state.lastCapture=now;
          state.callback=source.requestVideoFrameCallback(capture);return;
        }
        const bytes=frame.displayWidth*frame.displayHeight*4;
        if(state.queue.length>=139||state.bytes+bytes>512*1024*1024){frame.close();throw new Error('บัฟเฟอร์ภาพเต็ม จึงหยุด Vocal Remover');}
        const item={frame,captured:now,release:now+configuration.delayMs,time:metadata.mediaTime,bytes};
        if(!state.frozen){draw(item);state.frozen=true;}
        state.queue.push(item);state.bytes+=bytes;state.lastCapture=now;schedule();
      }
    }catch(error){state.failed=true;clearFrames();emit('error',{error:String(error.message).slice(0,300)});}
    state.callback=source.requestVideoFrameCallback(capture);
  }
  const onPause=()=>{
    if(source.ended){encoded?.finish?.();emit('ended');return;}
    state.paused=true;if(continuous)holdClock();else clearFrames();emit('pause');
  };
  const onPlay=()=>{if(continuous){state.paused=false;resumeClock();}emit('play');};
  const onSeeking=()=>{if(!state.ignoreSeek){state.paused=true;clearFrames();holdClock();emit('seeking');}};
  const onSeeked=()=>{if(state.ignoreSeek){state.ignoreSeek=false;return;}emit('seeked');};
  function snapshot(){return{active:state.active,epoch:state.epoch,paused:state.paused,bufferedFrames:encoded?.snapshot().bufferedFrames??state.queue.length,
    displayTime:state.displayTime,sourceTime:source.currentTime,sourceEnded:source.ended,sourcePaused:source.paused,failed:state.failed,
    lastLatencyMs:state.lastDisplayedCapture?clock()-state.lastDisplayedCapture:state.lastLatencyMs,videoWidth:canvas.width,videoHeight:canvas.height,
    videoBufferMode:useEncoded?'encoded':'raw',codecBuffer:encoded?.snapshot()??null};}
  async function rewind(){
    if(!Number.isFinite(state.displayTime)||Math.abs(source.currentTime-state.displayTime)<.02)return;
    state.ignoreSeek=true;
    await new Promise(resolve=>{
      let timer;const done=()=>{clearTimeout(timer);source.removeEventListener('seeked',done);state.ignoreSeek=false;resolve();};
      source.addEventListener('seeked',done);timer=setTimeout(done,700);
      try{source.currentTime=Math.max(0,Math.min(source.duration,state.displayTime));}catch{done();}
    });
  }
  const api={snapshot,
    reset(next){
      if(!validEpoch(next.epoch)||!Number.isFinite(next.startWallMs))throw new Error('Invalid video reset');
      pauseWall=null;pauseOffset=0;
      clearFrames();state.epoch=next.epoch;state.startWallMs=next.startWallMs;state.paused=Boolean(next.paused);state.frozen=false;state.failed=false;state.lastLatencyMs=0;state.lastDisplayedCapture=0;state.lastCapture=0;
      if(state.paused)holdClock();
      return snapshot();
    },
    pause(){state.paused=true;holdClock();return snapshot();},
    resume(){if(!source.paused||source.ended){state.paused=false;resumeClock();}return snapshot();},
    async pauseAndRewind(){state.paused=true;if(continuous)holdClock();else{clearFrames();await rewind();}return snapshot();},
    async prepareResume({atTime}={}){
      state.paused=true;clearFrames();
      if(Number.isFinite(atTime))state.displayTime=Math.max(0,Math.min(source.duration,atTime));
      await rewind();return snapshot();
    },
    async stop({restorePosition=false}={}){
      const wasEnded=source.ended;
      state.active=false;clearFrames();encoded?.close();if(state.callback!==null)source.cancelVideoFrameCallback(state.callback);
      source.removeEventListener('pause',onPause);source.removeEventListener('play',onPlay);
      source.removeEventListener('seeking',onSeeking);source.removeEventListener('seeked',onSeeked);
      if(restorePosition){await rewind();if(wasEnded)await source.play().catch(()=>{});}canvas.remove();
      if(window.__karaokeVocalVideo===api)delete window.__karaokeVocalVideo;
      return snapshot();
    },
  };
  // Install cancellation before asynchronous codec capability checks can yield.
  window.__karaokeVocalVideo=api;
  if(useEncoded){
    try{
      if(typeof encodedFactory!=='function')throw new Error('ไม่พบระบบบัฟเฟอร์ภาพโหมดคุณภาพสูง');
      const scale=Math.min(1,1280/source.videoWidth,720/source.videoHeight);
      encodedWidth=Math.max(2,Math.floor(source.videoWidth*scale/2)*2);encodedHeight=Math.max(2,Math.floor(source.videoHeight*scale/2)*2);
      encoded=await encodedFactory({width:encodedWidth,height:encodedHeight,delayMs:configuration.delayMs,clock,
        onFrame:item=>{if(!state.active||state.paused||state.failed)return;draw(item);state.lastDisplayedCapture=item.captured;state.lastLatencyMs=clock()-item.captured;},
        onFailure:message=>{if(!state.active)return;state.failed=true;clearFrames();emit('error',{error:message});},
      });
      if(!state.active){encoded.close();return snapshot();}
      if(source.paused||source.ended)throw new Error('เพลง MV หยุดระหว่างเตรียมภาพ กรุณาเปิด Vocal Remover อีกครั้ง');
    }catch(error){await api.stop({restorePosition:false});throw error;}
  }
  source.addEventListener('pause',onPause);source.addEventListener('play',onPlay);
  source.addEventListener('seeking',onSeeking);source.addEventListener('seeked',onSeeked);
  state.callback=source.requestVideoFrameCallback(capture);
  return snapshot();
}

class VocalVideo {
  constructor(contents,configuredUrl){this.contents=contents;this.configuredUrl=configuredUrl;this.frame=null;this.epoch=0;this.operation=0;}
  async verifyContext({videoId,queueItemId}) {
    if(this.contents.isDestroyed()||!isPlayerUrl(this.contents.getURL(),this.configuredUrl))throw new Error('Player ไม่พร้อมใช้งาน');
    const actual=await this.contents.mainFrame.executeJavaScript(`(()=>{const element=document.querySelector('[data-player-video-id]');return element?{videoId:element.dataset.playerVideoId,queueItemId:element.dataset.playerQueueItemId}:null;})()`);
    const local=new URL(this.configuredUrl).protocol==='http:';
    if(!actual&&local)return;
    if(!actual||actual.videoId!==videoId||actual.queueItemId!==queueItemId)throw new Error('เพลงเปลี่ยนแล้ว กรุณาเปิด Vocal Remover อีกครั้ง');
  }
  async start(configuration,context){
    const operation=++this.operation;
    await this.verifyContext(context);
    if(operation!==this.operation)throw new Error('ยกเลิกการเริ่มภาพ Vocal Remover แล้ว');
    const main=this.contents.mainFrame;
    const candidates=[...(new URL(this.configuredUrl).protocol==='http:'?[main]:[]),...main.frames.filter(frame=>isYouTubeFrame(frame.url))];
    for(const frame of candidates){
      const available=await frame.executeJavaScript('Boolean(document.querySelector("video"))');if(!available)continue;
      if(operation!==this.operation)throw new Error('ยกเลิกการเริ่มภาพ Vocal Remover แล้ว');
      this.frame=frame;this.epoch=configuration.epoch;this.context=context;
      const result=await frame.executeJavaScript(`(${installVideoDelay.toString()})(${JSON.stringify(configuration)},${createEncodedVideoQueue.toString()})`);
      if(operation!==this.operation)throw new Error('ยกเลิกการเริ่มภาพ Vocal Remover แล้ว');
      return result;
    }
    throw new Error('ยังไม่พบวิดีโอ MV ที่กำลังเล่น');
  }
  async snapshot(){return this.frame?.executeJavaScript('window.__karaokeVocalVideo?.snapshot()??null');}
  async reset(configuration){const operation=++this.operation;await this.verifyContext(this.context);if(operation!==this.operation)throw new Error('ยกเลิกการซิงก์ภาพแล้ว');const frame=this.frame;this.epoch=configuration.epoch;return frame.executeJavaScript(`window.__karaokeVocalVideo.reset(${JSON.stringify(configuration)})`);}
  async pauseAndRewind(){await this.verifyContext(this.context);return this.frame.executeJavaScript('window.__karaokeVocalVideo.pauseAndRewind()');}
  async pause(){await this.verifyContext(this.context);return this.frame.executeJavaScript('window.__karaokeVocalVideo.pause()');}
  async resume(){await this.verifyContext(this.context);return this.frame.executeJavaScript('window.__karaokeVocalVideo.resume()');}
  async prepareResume(configuration){await this.verifyContext(this.context);return this.frame.executeJavaScript(`window.__karaokeVocalVideo.prepareResume(${JSON.stringify(configuration)})`);}
  async stop({restorePosition=false,expectedEpoch}={}){
    if(expectedEpoch!==undefined&&this.epoch!==expectedEpoch)return;
    ++this.operation;
    const frame=this.frame,epoch=this.epoch;this.frame=null;
    if(!frame)return;
    if(restorePosition){try{await this.verifyContext(this.context);}catch{restorePosition=false;}}
    return frame.executeJavaScript(`(()=>{const api=window.__karaokeVocalVideo;if(api?.snapshot().epoch!==${JSON.stringify(epoch)})return null;return api.stop(${JSON.stringify({restorePosition})});})()`).catch(()=>null);
  }
}
module.exports={installVideoDelay,VocalVideo};
