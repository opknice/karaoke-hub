/** One retained playback timeline; AI epochs only provide time-aligned subtraction. */
export class ContinuousVocalBuffer {
  constructor({sampleRate,onPcm=()=>{},onState=()=>{}}){
    if(!Number.isSafeInteger(sampleRate)||sampleRate<8||sampleRate>96000)throw new Error('Invalid continuous audio rate');
    this.rate=sampleRate;this.capacity=sampleRate*12;this.delay=sampleRate*8;this.fadeStep=1/Math.max(1,Math.round(sampleRate*.02));
    this.onPcm=onPcm;this.onState=onState;
    this.rawL=new Float32Array(this.capacity);this.rawR=new Float32Array(this.capacity);
    this.vocalL=new Float32Array(this.capacity);this.vocalR=new Float32Array(this.capacity);this.weights=new Float32Array(this.capacity);
    this.chunk=new Float32Array(sampleRate*2);this.enabled=false;this.epoch=0;this.vocalLevel=0;
  }
  sessionState(status){this.onState({kind:'session',status,sessionEpoch:this.sessionEpoch,delayFrames:this.delay});}
  aiState(status,error){if(status===this.lastAiStatus&&!error)return;this.lastAiStatus=status;this.onState({kind:'ai',status,error,epoch:this.epoch,sessionEpoch:this.sessionEpoch});}
  begin({sessionEpoch}){
    if(!Number.isSafeInteger(sessionEpoch)||sessionEpoch<1||sessionEpoch>=2**31)throw new Error('Invalid audio session');
    this.sessionEpoch=sessionEpoch;this.enabled=true;this.paused=false;this.primed=false;this.captured=0;this.played=0;
    this.epoch=0;this.mixing=0;this.mixTarget=0;this.mixStep=0;this.desired=false;this.feeding=false;this.acceptResults=false;this.pendingAi=null;this.lastAiStatus=null;
    this.lastVocalL=0;this.lastVocalR=0;this.rawL.fill(0);this.rawR.fill(0);this.clearEstimates();this.sessionState('priming');
  }
  clearEstimates(){this.vocalL.fill(0);this.vocalR.fill(0);this.weights.fill(0);}
  beginAi(settings){
    const {epoch,spanMode,maxResultFrames}=settings;
    if(!this.enabled||!Number.isSafeInteger(epoch)||epoch<1||epoch>=2**31||!['overlap','final'].includes(spanMode)
      ||!Number.isSafeInteger(maxResultFrames)||maxResultFrames<1||maxResultFrames>this.rate*2)throw new Error('Invalid continuous AI stream');
    if(this.mixing>0){this.endAi();this.pendingAi={...settings};return;}
    this.clearEstimates();this.epoch=epoch;this.spanMode=spanMode;this.maxResultFrames=maxResultFrames;this.aiBase=this.captured;
    this.finalReceivedEnd=0;this.chunkOffset=0;this.sequence=0;this.feeding=true;this.acceptResults=true;this.aiFailed=false;
    this.lastAiStatus=null;this.aiState('preparing');
  }
  remove(enabled){if(typeof enabled!=='boolean')throw new Error('Invalid vocal mix');this.desired=enabled;if(enabled&&this.lastAiStatus!=='on')this.aiState('preparing');}
  setLevel(level){if(!Number.isInteger(level)||level<0||level>100)throw new RangeError('Invalid vocal level');this.vocalLevel=level;}
  endAi(){this.feeding=false;this.acceptResults=false;this.desired=false;this.pendingAi=null;if(!this.mixing){this.clearEstimates();this.aiState('off');}}
  pause(){if(this.enabled&&!this.paused){this.paused=true;this.sessionState('paused');}}
  resume(){if(this.enabled&&this.paused){this.paused=false;this.sessionState(this.primed?'playing':'priming');}}
  disable(){if(!this.enabled)return;this.enabled=false;this.feeding=false;this.acceptResults=false;this.pendingAi=null;this.sessionState('off');}
  receive({epoch,startFrame,pcm}){
    if(!this.enabled||!this.acceptResults||epoch!==this.epoch||!(pcm instanceof Float32Array)||pcm.length%2||!Number.isSafeInteger(startFrame)||startFrame<0)return false;
    const frames=pcm.length/2,start=this.aiBase+startFrame;
    if(frames<1||frames>this.maxResultFrames||start+frames>this.captured||start+frames<=this.played)return false;
    if(this.spanMode==='final'&&(startFrame!==this.finalReceivedEnd||start<this.played))return false;
    for(const sample of pcm)if(!Number.isFinite(sample))return false;
    const overlap=Math.floor(this.rate/8)*2;
    for(let i=0;i<frames;i++){
      if(start+i<this.played)continue;const slot=(start+i)%this.capacity;
      let weight=1;
      if(this.spanMode==='overlap'){
        if(startFrame>0&&i<overlap)weight=i/overlap;
        if(i>=frames-overlap)weight=Math.min(weight,(frames-1-i)/overlap);
      }
      this.vocalL[slot]+=pcm[i*2]*weight;this.vocalR[slot]+=pcm[i*2+1]*weight;this.weights[slot]+=weight;
    }
    if(this.spanMode==='final')this.finalReceivedEnd=startFrame+frames;
    return true;
  }
  process(left,right,outL,outR){
    if(!this.enabled){outL.set(left);outR.set(right);return;}
    for(let i=0;i<outL.length;i++){
      if(this.paused){outL[i]=0;outR[i]=0;continue;}
      if(!this.mixing&&this.pendingAi){const settings=this.pendingAi;this.pendingAi=null;this.beginAi(settings);}
      const current=this.captured,slot=current%this.capacity;
      this.rawL[slot]=left[i];this.rawR[slot]=right[i];
      if(this.feeding){this.chunk[this.chunkOffset*2]=left[i];this.chunk[this.chunkOffset*2+1]=right[i];this.chunkOffset++;}
      if(current<this.delay){outL[i]=0;outR[i]=0;}
      else{
        if(!this.primed){this.primed=true;this.sessionState('playing');}
        const source=current-this.delay,index=source%this.capacity,weight=this.weights[index],available=weight>1e-6;
        if(available){this.lastVocalL=this.vocalL[index]/weight;this.lastVocalR=this.vocalR[index]/weight;}
        const target=this.desired&&available&&!this.aiFailed?1-this.vocalLevel/100:0;
        if(target!==this.mixTarget){this.mixTarget=target;this.mixStep=Math.abs(target-this.mixing)*this.fadeStep;}
        this.mixing=target>this.mixing?Math.min(target,this.mixing+this.mixStep):Math.max(target,this.mixing-this.mixStep);
        if(Math.abs(this.mixing-target)<1e-9)this.mixing=target;
        outL[i]=this.rawL[index]-this.mixing*this.lastVocalL;outR[i]=this.rawR[index]-this.mixing*this.lastVocalR;
        if(this.acceptResults&&available)this.aiState(this.desired?(this.mixing===target?'on':'preparing'):'ready');
        else if(this.acceptResults&&!this.aiFailed&&(this.lastAiStatus==='on'||current-this.aiBase>=this.rate*10)){
          this.aiFailed=true;this.feeding=false;this.acceptResults=false;this.desired=false;this.aiState('error','AI ส่งเสียงไม่ทัน จึงเล่นเสียงต้นฉบับต่อ');
        }
        if(!this.acceptResults&&!this.mixing&&this.lastAiStatus!=='error')this.aiState('off');
        this.vocalL[index]=0;this.vocalR[index]=0;this.weights[index]=0;this.played=source+1;
      }
      this.captured++;
      if(this.feeding&&this.chunkOffset===this.rate){const pcm=this.chunk;this.chunk=new Float32Array(this.rate*2);this.chunkOffset=0;this.onPcm({sessionEpoch:this.sessionEpoch,epoch:this.epoch,sequence:this.sequence++,pcm});}
    }
  }
}
