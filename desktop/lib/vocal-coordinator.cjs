const {randomBytes}=require('node:crypto');
class LiveVocalCoordinator {
  constructor({worker,video,getTrack,sendAudio,sendResult,publish,setBridge,startupDeadlineMs=5000,now=Date.now}) {
    Object.assign(this,{worker,video,getTrack,sendAudio,sendResult,publish,setBridge,startupDeadlineMs,now});
    this.epoch=0;this.enabled=false;this.status='ready';this.stopping=null;
  }
  current(epoch=this.epoch) {
    const track=this.getTrack();
    return this.enabled&&epoch===this.epoch&&track.active&&track.versionType==='mv'&&track.videoId===this.bound?.videoId&&track.queueItemId===this.bound?.queueItemId;
  }
  state(status,error=null,extra={}) {
    this.status=status;this.publish({vocalRemoverEnabled:this.enabled,vocalRemoverStatus:status,vocalEpoch:this.epoch,vocalRemoverDelayMs:4500,vocalRemoverError:error,...extra});
  }
  async bounded(promise,ms=1000) {
    let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('ภาพ MV ไม่ตอบสนอง กรุณาลองโหลด Player ใหม่')),ms);})]);}finally{clearTimeout(timer);}
  }
  clearTimers(){clearTimeout(this.deadline);clearInterval(this.monitor);}
  armDeadline(epoch) {
    clearTimeout(this.deadline);
    this.deadline=setTimeout(()=>void this.failure('AI เริ่มไม่ทันภายใน 5 วินาที จึงกลับไปใช้เสียงต้นฉบับ',epoch),Math.max(1,this.startupDeadlineMs-(this.now()-this.requestedAt)));
  }
  async prime(epoch,{resume=false}={}) {
    if(!this.current(epoch))throw new Error('ยกเลิก Vocal Remover แล้ว');
    this.worker.reset(epoch);this.setBridge({token:this.token,epoch});
    const startWallMs=this.now()+(resume?10:150);
    await this.bounded(this.video.reset({epoch,startWallMs}));
    if(!this.current(epoch))throw new Error('ยกเลิก Vocal Remover แล้ว');
    await this.sendAudio('START_VOCAL',{epoch,startWallMs});
    if(!this.current(epoch))throw new Error('ยกเลิก Vocal Remover แล้ว');
    this.state('preparing');this.armDeadline(epoch);
  }
  async start() {
    const track=this.getTrack();
    if(track.versionType!=='mv'||!track.videoId||!track.queueItemId)throw new Error('Vocal Remover ใช้ได้เฉพาะเพลง MV ที่กำลังเล่น');
    if(!this.worker.ready)throw new Error('ระบบ AI ยังไม่พร้อมใช้งาน');
    if(!track.active)throw new Error('เปิดระบบเสียงก่อนใช้ Vocal Remover');
    if(this.current())return;
    if(this.stopping)await this.stopping;
    this.bound={videoId:track.videoId,queueItemId:track.queueItemId};this.enabled=true;const epoch=++this.epoch;
    this.awaitingSeek=false;this.seekTarget=undefined;
    this.token=randomBytes(24).toString('hex');this.requestedAt=this.now();this.state('preparing');
    this.setBridge({token:this.token,epoch});
    try {
      await this.bounded(this.video.start({epoch,token:this.token,parentOrigin:track.origin,startWallMs:this.now()+60000,delayMs:4500},this.bound));
      await this.prime(epoch);
      this.monitor=setInterval(()=>void this.health(),500);
    }catch(error){
      if(this.current(epoch))await this.failure(error.message,epoch);
      else await this.bounded(this.video.stop({restorePosition:false,expectedEpoch:epoch})).catch(()=>{});
      throw error;
    }
  }
  stop({restorePosition=true}={}) {
    if(this.stopping)return this.stopping;
    const active=this.enabled;this.enabled=false;++this.epoch;this.clearTimers();this.setBridge(null);
    if(this.worker.ready)this.worker.reset(this.epoch);
    this.state(this.worker.ready?'ready':'unavailable');
    if(!active)return Promise.resolve();
    const cleanup=(async()=>{
      await this.sendAudio('PAUSE_VOCAL',{}).catch(()=>{});
      await this.bounded(this.video.stop({restorePosition})).catch(()=>{});
      await this.sendAudio('STOP_VOCAL',{}).catch(()=>{});
    })();
    this.stopping=cleanup;
    void cleanup.then(()=>{if(this.stopping===cleanup)this.stopping=null;});
    return cleanup;
  }
  feed(packet) {
    if(!this.current(packet.epoch)||!['preparing','on'].includes(this.status))return false;
    if(this.worker.feed(packet))return true;
    if(this.current(packet.epoch))void this.failure('ไม่สามารถส่งเสียงไปยัง AI ได้',packet.epoch);
    return false;
  }
  result(packet) {
    if(this.current(packet.epoch)&&['preparing','on'].includes(this.status))this.sendResult(packet);
  }
  audioState(patch) {
    if(!this.current(patch.vocalEpoch))return;
    if(patch.vocalRemoverStatus==='error'){void this.failure(patch.vocalRemoverError||'AI ประมวลผลไม่ทันเพลง',patch.vocalEpoch);return;}
    if(patch.vocalRemoverStatus==='on') {
      const elapsed=this.now()-this.requestedAt+(patch.vocalOutputLatencyMs||0);
      if(elapsed>this.startupDeadlineMs){void this.failure('อุปกรณ์เสียงเริ่มช้าเกินกำหนด 5 วินาที',patch.vocalEpoch);return;}
      clearTimeout(this.deadline);this.state('on',null,{vocalRemoverStartDelayMs:elapsed});
    }
  }
  async failure(message,epoch=this.epoch) {
    if(!this.current(epoch))return;
    const cleanup=this.stop({restorePosition:true}),stoppedEpoch=this.epoch;
    await cleanup;if(!this.enabled&&this.epoch===stoppedEpoch)this.state('error',message);
  }
  async health() {
    if(!this.current()||this.status!=='on'||this.readingHealth)return;
    const epoch=this.epoch;this.readingHealth=true;
    try{
      const snapshot=await this.bounded(this.video.snapshot(),500);
      if(this.current(epoch)&&(!snapshot?.active||snapshot.failed||(!snapshot.sourceEnded&&(snapshot.lastLatencyMs<=0||snapshot.lastLatencyMs>4900))))await this.failure('ภาพและเสียงไม่ทันกำหนด จึงกลับไปใช้เสียงต้นฉบับ',epoch);
    }catch(error){await this.failure(error.message,epoch);}finally{this.readingHealth=false;}
  }
  async transport(packet) {
    if(!this.current(packet.epoch)||packet.token!==this.token)return;
    const epoch=this.epoch;
    if(packet.kind==='error'){await this.failure(packet.error||'ไม่สามารถประมวลผลภาพ MV ได้',epoch);return;}
    if(packet.kind==='ended')return; // The Player holds its ended event for the visible delayed tail.
    if(packet.kind==='pause'||packet.kind==='seeking') {
      if(packet.kind==='pause'&&this.status==='paused')return;
      this.awaitingSeek=packet.kind==='seeking';
      clearTimeout(this.deadline);this.state('paused');await this.sendAudio('PAUSE_VOCAL',{}).catch(()=>{});
      if(packet.kind==='pause'&&this.current(epoch)){
        this.pauseOperation=this.bounded(this.video.pauseAndRewind()).catch(error=>this.failure(error.message,epoch));
        await this.pauseOperation;
      }
      return;
    }
    if(packet.kind==='seeked'){
      this.awaitingSeek=false;this.seekTarget=Number.isFinite(packet.time)?packet.time:undefined;
    }
    if((packet.kind==='play'||packet.kind==='seeked')&&!packet.paused&&this.status==='paused') {
      if((packet.kind==='play'&&this.awaitingSeek)||this.resumingEpoch===epoch)return;
      this.resumingEpoch=epoch;this.requestedAt=this.now();
      try{
        await this.pauseOperation;
        if(!this.current(epoch))return;
        await this.bounded(this.video.prepareResume(this.seekTarget===undefined?{}:{atTime:this.seekTarget}));
        if(!this.current(epoch))return;
        const next=++this.epoch;this.awaitingSeek=false;this.seekTarget=undefined;
        try{await this.prime(next,{resume:true});}catch(error){await this.failure(error.message,next);}
      }catch(error){await this.failure(error.message,epoch);}
      finally{if(this.resumingEpoch===epoch)this.resumingEpoch=0;}
    }
  }
}
module.exports={LiveVocalCoordinator};
