const {randomBytes}=require('node:crypto');
const {getVocalModel}=require('./vocal-models.cjs');
const cancelled=()=>Object.assign(new Error('ยกเลิกการเตรียมเพลงแล้ว'),{name:'AbortError'});
class ContinuousVocalCoordinator{
  constructor({worker,video,getTrack,ensureCapture,sendAudio,sendResult,publish,setBridge,getProfile=()=>getVocalModel('fast'),getLevel=()=>0,now=Date.now}){
    Object.assign(this,{worker,video,getTrack,ensureCapture,sendAudio,sendResult,publish,setBridge,getProfile,getLevel,now});
    this.session=null;this.epoch=0;this.nextSessionEpoch=0;
  }
  get active(){return Boolean(this.session?.prepared);}
  get enabled(){return Boolean(this.session?.wanted);}
  get sessionEpoch(){return this.session?.epoch??0;}
  get token(){return this.session?.token??null;}
  current(s=this.session){const t=this.getTrack();return Boolean(s&&s===this.session&&t.videoId===s.track.videoId&&t.queueItemId===s.track.queueItemId&&t.versionType==='mv');}
  clock(s){return(s.pauseWall??this.now())-s.pauseDuration;}
  state(patch={}){
    const s=this.session;
    this.publish({supportsContinuousVocal:true,continuousSessionId:s?.id??null,vocalSessionEpoch:s?.epoch??0,vocalBufferActive:Boolean(s?.prepared),
      vocalPlaybackDelayMs:s?.prepared?8000:0,vocalRemoverDelayMs:s?.prepared?8000:this.getProfile().delayMs,vocalRemoverEnabled:Boolean(s?.wanted),...patch});
  }
  async bounded(promise,ms=1500){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('ระบบภาพไม่ตอบกลับ')),ms);})]);}finally{clearTimeout(timer);}}
  clearAiTimers(s){clearTimeout(s?.aiTimer);clearTimeout(s?.warmTimer);}
  armAiDeadline(s){
    clearTimeout(s.aiTimer);if(!this.current(s)||s.paused||!s.aiActive||s.aiReady)return;
    s.aiTimer=setTimeout(()=>{if(this.current(s)&&!s.aiReady)void this.failure('AI เตรียมเสียงไม่ทัน จึงเล่นเสียงต้นฉบับต่อ',this.epoch);},Math.max(1,10000-(this.clock(s)-s.aiStarted)));
  }
  async prepare(track){
    if(track.versionType!=='mv'||!track.videoId||!track.queueItemId)throw new Error('เตรียมเสียงต่อเนื่องได้เฉพาะ MV');
    const old=this.session;const s={track:{...track},id:randomBytes(16).toString('hex'),token:randomBytes(24).toString('hex'),epoch:++this.nextSessionEpoch,
      prepared:false,wanted:false,aiActive:false,aiReady:false,audibleOn:false,paused:track.playing===false,pauseWall:track.playing===false?this.now():null,pauseDuration:0};
    this.session=s;++this.epoch;this.setBridge(null);this.clearAiTimers(old);clearInterval(old?.monitor);
    try{
      if(old)await this.cleanup(old,{restorePosition:false});
      if(!this.current(s))throw cancelled();
      await this.ensureCapture({sessionEpoch:s.epoch,sessionId:s.id});
      if(!this.current(s))throw cancelled();
      s.prepared=true;await this.setLevel(this.getLevel());if(!this.current(s))throw cancelled();this.setBridge({epoch:s.epoch,token:s.token});
      this.state({vocalBufferStatus:s.paused?'paused':'priming',vocalVideoReady:false,vocalSignalReady:false,vocalRemoverStatus:'ready',vocalRemoverError:null,vocalSourceEnded:false,vocalDisplayTime:null});
      if(s.paused)await this.sendAudio('PAUSE_VOCAL_SESSION',{});
      if(this.worker.ready)await this.beginAi();
      if(!this.current(s))throw cancelled();
      return{buffered:true,sessionId:s.id};
    }catch(error){if(this.session===s)await this.stopSession({restorePosition:false});throw error;}
  }
  async attachVideo(){
    const s=this.session;if(!this.current(s)||!s.prepared||s.videoStarted)return;
    if(s.videoStarting)return s.videoStarting;
    s.videoStarting=(async()=>{
      try{
        await this.bounded(this.video.start({epoch:s.epoch,token:s.token,parentOrigin:s.track.origin,startWallMs:this.now(),delayMs:8000,videoBufferMode:'encoded',continuous:true},s.track),3000);
        if(!this.current(s))return;
        s.videoStarted=true;s.videoStartedAt=this.clock(s);s.monitor=setInterval(()=>void this.health(),250);
        if(s.paused)await this.video.pause();
      }catch(error){if(this.current(s)&&!s.paused)await this.sessionFailure(error.message,s);}
      finally{s.videoStarting=null;}
    })();return s.videoStarting;
  }
  async beginAi(){
    const s=this.session;if(!this.current(s)||!s.prepared||!this.worker.ready||s.aiActive)return;
    const epoch=++this.epoch;s.aiActive=true;s.aiReady=false;s.aiStarted=this.clock(s);this.clearAiTimers(s);
    this.worker.reset(epoch);
    try{
      await this.sendAudio('BEGIN_VOCAL_AI',{epoch,modelId:this.getProfile().id});
      if(!this.current(s)||epoch!==this.epoch)return;
      await this.setLevel(s.level);if(!this.current(s)||epoch!==this.epoch)return;
      this.state({vocalSignalReady:false,vocalAiStatus:'preparing',vocalRemoverStatus:s.wanted?'preparing':'ready',vocalRemoverError:null});
      if(s.wanted)await this.sendAudio('SET_VOCAL_MIX',{enabled:true});this.armAiDeadline(s);
    }catch(error){await this.failure(error.message,epoch);}
  }
  async suspendAi(){
    const s=this.session;++this.epoch;if(this.worker.ready)this.worker.reset(this.epoch);
    if(!s)return;this.clearAiTimers(s);s.aiActive=false;s.aiReady=false;s.audibleOn=false;
    await this.sendAudio('END_VOCAL_AI',{}).catch(()=>{});
    if(this.current(s))this.state({vocalSignalReady:false,vocalAiStatus:'preparing'});
  }
  async setLevel(level){
    if(!Number.isInteger(level)||level<0||level>100)throw new RangeError('Invalid vocal level');
    const s=this.session;if(!this.current(s)||!s.prepared)return;s.level=level;
    await this.sendAudio('SET_VOCAL_LEVEL',{level});
  }
  async setRemoval(enabled){
    const s=this.session;if(!this.current(s)||!s.prepared)throw new Error('กรุณาเตรียมระบบเสียงของเพลง MV ก่อน');
    s.wanted=enabled;s.requestedAt=this.clock(s);
    if(!enabled){clearTimeout(s.warmTimer);await this.sendAudio('SET_VOCAL_MIX',{enabled:false});if(this.current(s))this.state({vocalRemoverStatus:'ready',vocalRemoverError:null});return;}
    this.state({vocalRemoverStatus:s.paused?'paused':'preparing',vocalRemoverError:null});
    if(this.worker.ready){if(!s.aiActive)await this.beginAi();else await this.sendAudio('SET_VOCAL_MIX',{enabled:true});}
    else{clearTimeout(s.warmTimer);s.warmTimer=setTimeout(()=>{if(this.current(s)&&s.wanted)void this.failure('เตรียมโมเดลไม่สำเร็จ จึงเล่นเสียงต้นฉบับต่อ',this.epoch);},32000);}
  }
  feed(packet){
    const s=this.session;if(!this.current(s)||!s.prepared||!s.aiActive||packet.epoch!==this.epoch||packet.sessionEpoch!==s.epoch)return false;
    if(this.worker.feed(packet))return true;void this.failure('AI ส่งเสียงไม่ทัน จึงเล่นเสียงต้นฉบับต่อ',packet.epoch);return false;
  }
  result(packet){const s=this.session;if(this.current(s)&&s.aiActive&&packet.epoch===this.epoch)this.sendResult(packet);}
  audioState(patch){
    const s=this.session;if(!this.current(s)||patch.continuousSessionId!==s.id||patch.vocalSessionEpoch!==s.epoch)return;
    if(patch.vocalBufferStatus){this.state({vocalBufferStatus:patch.vocalBufferStatus});return;}
    if(patch.vocalEpoch!==this.epoch||!s.aiActive)return;
    const status=patch.vocalAiStatus;
    if(status==='error'){void this.failure(patch.vocalAiError||'AI ประมวลผลไม่สำเร็จ',patch.vocalEpoch);return;}
    if(status==='ready'||status==='on'){
      s.aiReady=true;this.clearAiTimers(s);s.audibleOn=status==='on'&&s.wanted;
      this.state({vocalSignalReady:true,vocalAiStatus:'ready',vocalRemoverStatus:s.wanted?(s.paused?'paused':s.audibleOn?'on':'preparing'):'ready',vocalRemoverError:null,
        ...(s.audibleOn?{vocalRemoverStartDelayMs:this.clock(s)-(s.requestedAt??this.clock(s))}:{})});
    }
  }
  async failure(message,epoch=this.epoch){
    const s=this.session;if(!this.current(s)||epoch!==this.epoch)return;
    s.wanted=false;await this.suspendAi();
    if(this.current(s))this.state({vocalRemoverStatus:'error',vocalRemoverError:message,vocalSignalReady:false});
  }
  async health(){
    const s=this.session;if(!this.current(s)||!s.videoStarted||s.healthReading)return;s.healthReading=true;
    try{
      const snap=await this.bounded(this.video.snapshot(),700);if(!this.current(s))return;
      if(!snap?.active||snap.failed||(!s.paused&&!snap.sourceEnded&&((snap.lastLatencyMs<=0&&this.clock(s)-s.videoStartedAt>=10000)||snap.lastLatencyMs>8500))){console.warn('Continuous video health:',JSON.stringify(snap));await this.sessionFailure('ภาพและเสียงไม่ทันกำหนด กรุณาเริ่มระบบเสียงใหม่',s);return;}
      this.state({vocalDisplayTime:snap.displayTime,vocalVideoReady:snap.lastLatencyMs>0,vocalSourceEnded:snap.sourceEnded});
    }catch(error){if(this.current(s))await this.sessionFailure(error.message,s);}finally{s.healthReading=false;}
  }
  async transport(packet){
    const s=this.session;if(!this.current(s)||packet.epoch!==s.epoch||packet.token!==s.token)return;
    if(packet.kind==='error'){await this.sessionFailure(packet.error||'ระบบภาพไม่พร้อม',s);return;}
    if(packet.kind==='ended'){s.sourceEnded=true;this.state({vocalSourceEnded:true});return;}
    if(packet.kind==='seeking'){
      s.seeking=true;await this.pause(s);await this.suspendAi();return;
    }
    if(packet.kind==='seeked'){
      s.repriming=this.reprime(s,packet.paused);await s.repriming;s.repriming=null;return;
    }
    if(packet.kind==='pause'){await this.pause(s);return;}
    if(packet.kind==='play'){
      await s.repriming;if(!this.current(s)||s.seeking)return;
      const snap=s.videoStarted?await this.video.resume():{paused:false};
      if(snap?.paused)return;
      if(s.paused){s.pauseDuration+=this.now()-s.pauseWall;s.pauseWall=null;s.paused=false;await this.sendAudio('RESUME_VOCAL_SESSION',{});this.armAiDeadline(s);this.state({vocalBufferStatus:'playing',vocalRemoverStatus:s.wanted?(s.audibleOn?'on':'preparing'):'ready'});}
    }
  }
  async pause(s){
    if(!this.current(s)||s.paused)return;s.paused=true;s.pauseWall=this.now();clearTimeout(s.aiTimer);
    if(s.videoStarted)await this.video.pause();if(!this.current(s))return;
    await this.sendAudio('PAUSE_VOCAL_SESSION',{});this.state({vocalBufferStatus:'paused',vocalRemoverStatus:s.wanted?'paused':'ready'});
  }
  async reprime(s,paused){
    if(!this.current(s))return;
    const wanted=s.wanted;await this.suspendAi();if(!this.current(s))return;
    s.epoch=++this.nextSessionEpoch;s.paused=paused;s.pauseWall=paused?this.now():null;s.pauseDuration=0;s.sourceEnded=false;
    const epoch=s.epoch;this.setBridge({epoch,token:s.token});
    await this.sendAudio('PREPARE_VOCAL_SESSION',{sessionEpoch:epoch,sessionId:s.id});
    if(!this.current(s)||s.epoch!==epoch)return;
    if(paused)await this.sendAudio('PAUSE_VOCAL_SESSION',{});
    if(s.videoStarted)await this.video.reset({epoch,startWallMs:this.now(),paused});
    if(!this.current(s)||s.epoch!==epoch)return;
    s.videoStartedAt=this.clock(s);s.seeking=false;s.wanted=wanted;
    this.state({vocalBufferStatus:paused?'paused':'priming',vocalVideoReady:false,vocalSignalReady:false,vocalSourceEnded:false});await this.beginAi();
  }
  async sessionFailure(message,s){if(!this.current(s))return;await this.stopSession({restorePosition:true});if(!this.session)this.state({vocalRemoverStatus:'error',vocalRemoverError:message});}
  async cleanup(s,options){
    this.clearAiTimers(s);clearInterval(s.monitor);
    if(s.videoStarted||s.videoStarting)await this.bounded(this.video.stop({...options,expectedEpoch:s.epoch})).catch(()=>{});
    if(s.prepared)await this.sendAudio('CLOSE_VOCAL_SESSION',{}).catch(()=>{});
  }
  async stopSession({restorePosition=true}={}){
    const s=this.session;this.session=null;++this.epoch;this.setBridge(null);this.clearAiTimers(s);clearInterval(s?.monitor);
    if(this.worker.ready)this.worker.reset(this.epoch);
    this.state({vocalBufferStatus:'off',vocalVideoReady:false,vocalSignalReady:false,vocalDisplayTime:null,vocalSourceEnded:false,vocalRemoverStatus:this.worker.ready?'ready':'unavailable'});
    if(s)await this.cleanup(s,{restorePosition});
  }
  stop(options){return this.stopSession(options);}
}
module.exports={ContinuousVocalCoordinator};
