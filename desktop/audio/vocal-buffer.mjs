/** Timestamped local delay line and vocal overlap-add. Never runs inference. */
export class LiveVocalBuffer {
  constructor({sampleRate,delaySeconds=4.5,onPcm=()=>{},onState=()=>{}}) {
    if(!Number.isSafeInteger(sampleRate)||sampleRate<8||sampleRate>96000||!Number.isFinite(delaySeconds)||delaySeconds<1||delaySeconds>8)throw new Error('Invalid live audio clock');
    this.defaultDelaySeconds=delaySeconds;
    this.rate=sampleRate;this.delay=Math.round(sampleRate*delaySeconds);this.capacity=sampleRate*12;this.overlap=Math.floor(sampleRate/8);
    this.onPcm=onPcm;this.onState=onState;
    this.rawL=new Float32Array(this.capacity);this.rawR=new Float32Array(this.capacity);
    this.vocalL=new Float32Array(this.capacity);this.vocalR=new Float32Array(this.capacity);this.weights=new Float32Array(this.capacity);
    this.enabled=false;
  }
  enable({epoch,startFrame=0,delaySeconds=this.defaultDelaySeconds,spanMode='overlap',maxResultFrames}) {
    if(!Number.isSafeInteger(epoch)||epoch<1||epoch>=2**31||!Number.isSafeInteger(startFrame)||startFrame<0)throw new Error('Invalid live audio epoch');
    if(!Number.isFinite(delaySeconds)||delaySeconds<1||delaySeconds>8||!['overlap','final'].includes(spanMode))throw new Error('Invalid live audio profile');
    const limit=maxResultFrames??Math.ceil(this.rate*(spanMode==='final'?1.5:1.25));
    if(!Number.isSafeInteger(limit)||limit<1||limit>this.rate*2)throw new Error('Invalid live audio span limit');
    this.delay=Math.round(this.rate*delaySeconds);this.spanMode=spanMode;this.maxResultFrames=limit;this.finalReceivedEnd=0;
    this.epoch=epoch;this.startFrame=startFrame;this.enabled=true;this.paused=false;this.started=false;this.failed=false;this.playing=false;
    this.captured=0;this.played=0;this.chunkOffset=0;this.sequence=0;this.chunk=new Float32Array(this.rate*2);
    this.vocalL.fill(0);this.vocalR.fill(0);this.weights.fill(0);
  }
  disable() {const active=this.enabled;this.enabled=false;this.chunk=null;if(active)this.onState({status:'off',epoch:this.epoch});}
  pause(){if(this.enabled){this.paused=true;this.onState({status:'paused',epoch:this.epoch});}}
  receive({epoch,startFrame,pcm}) {
    if(!this.enabled||epoch!==this.epoch||!(pcm instanceof Float32Array)||pcm.length%2||!Number.isSafeInteger(startFrame)||startFrame<0)return false;
    const frames=pcm.length/2;
    if(frames<1||frames>this.maxResultFrames||startFrame+frames>this.captured||startFrame+frames<=this.played)return false;
    if(this.spanMode==='final'&&(startFrame!==this.finalReceivedEnd||startFrame<this.played))return false;
    for(const sample of pcm)if(!Number.isFinite(sample))return false;
    if(this.spanMode==='final'){
      for(let i=0;i<frames;i++){
        const slot=(startFrame+i)%this.capacity;
        this.vocalL[slot]=pcm[i*2];this.vocalR[slot]=pcm[i*2+1];this.weights[slot]=1;
      }
      this.finalReceivedEnd=startFrame+frames;return true;
    }
    const fade=2*this.overlap;
    for(let i=0;i<frames;i++) {
      const frame=startFrame+i;if(frame<this.played)continue;
      let weight=1;
      if(startFrame>0&&i<fade)weight=i/fade;
      if(i>=frames-fade)weight=Math.min(weight,(frames-1-i)/fade);
      const slot=frame%this.capacity;
      this.vocalL[slot]+=pcm[i*2]*weight;this.vocalR[slot]+=pcm[i*2+1]*weight;this.weights[slot]+=weight;
    }
    return true;
  }
  process(left,right,outL,outR,frameStart) {
    if(!this.enabled){outL.set(left);outR.set(right);return;}
    for(let i=0;i<outL.length;i++) {
      if(frameStart+i<this.startFrame){outL[i]=left[i];outR[i]=right[i];continue;}
      if(this.paused){outL[i]=0;outR[i]=0;continue;}
      if(!this.started){this.started=true;this.onState({status:'preparing',epoch:this.epoch});}
      const current=this.captured;
      const slot=current%this.capacity;
      this.rawL[slot]=left[i];this.rawR[slot]=right[i];
      this.chunk[this.chunkOffset*2]=left[i];this.chunk[this.chunkOffset*2+1]=right[i];this.chunkOffset++;
      if(current<this.delay){outL[i]=0;outR[i]=0;}
      else {
        const source=current-this.delay,index=source%this.capacity,weight=this.weights[index];
        if(weight>1e-6) {
          outL[i]=this.rawL[index]-this.vocalL[index]/weight;outR[i]=this.rawR[index]-this.vocalR[index]/weight;
          if(!this.playing&&!this.failed){this.playing=true;this.onState({status:'on',epoch:this.epoch,delayFrames:this.delay});}
        }else {
          outL[i]=this.rawL[index];outR[i]=this.rawR[index];
          if(!this.failed){this.failed=true;this.onState({status:'error',epoch:this.epoch,error:'AI ส่งเสียงไม่ทันกำหนด จึงหยุดการตัดเสียงร้อง'});}
        }
        this.vocalL[index]=0;this.vocalR[index]=0;this.weights[index]=0;this.played=source+1;
      }
      this.captured++;
      if(this.chunkOffset===this.rate) {
        const pcm=this.chunk;this.chunk=new Float32Array(this.rate*2);this.chunkOffset=0;
        this.onPcm({epoch:this.epoch,sequence:this.sequence++,pcm});
      }
    }
  }
}
