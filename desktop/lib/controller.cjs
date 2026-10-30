const { validateCommand } = require('./policy.cjs');
const {getVocalModel}=require('./vocal-models.cjs');

function initialState(profile) {
  return {
    // These false flags retain compatibility with the hosted Player bridge.
    captureStatus: 'installed_idle', enabled: false, monoLike: false,
    supportsLoudnessNormalize: false, supportsPitchPreservedTempo: false,
    playbackRate: 1, pitchSemitones: 0,
    playerVolume: 85, playerMuted: false, lastError: null, currentVideoId: null,
    searchVersion: 'karaoke', currentVersionType: 'karaoke', currentQueueItemId: null,
    vocalRemoverEligible: false, vocalRemoverReady: false,
    vocalRemoverEnabled:false,vocalRemoverStatus:'unavailable',vocalRemoverError:null,
    vocalModelId:profile.id,vocalRemoverDelayMs:profile.delayMs,vocalResumePending:false,
    inputRms: 0, outputRms: 0, peakHz: 0,
  };
}
class DesktopAudioController {
  constructor({ sendAudio, setPlaybackRate, publish, setVocal=async enabled=>{if(enabled)throw new Error('ระบบ AI ยังไม่พร้อม');},selectVocalModel=()=>{throw new Error('Model selection unavailable');},initialModelId='fast', timeoutMs = 10000,
    supportsContinuousVocal=false,preparePlayback=null,closePlayback=async()=>{},suspendVocal=async()=>{},attachVocalVideo=async()=>{} }) {
    this.sendAudio = sendAudio; this.setPlaybackRate = setPlaybackRate; this.publish = publish;
    this.setVocal=setVocal;
    this.selectVocalModel=selectVocalModel;
    this.timeoutMs = timeoutMs; this.state = initialState(getVocalModel(initialModelId)); this.generation = 0;
    this.modelSelectionGeneration=0;this.requestedModelId=initialModelId;this.modelSwitchIntent=false;this.pendingVocalResume=null;
    this.queue = Promise.resolve();
    Object.assign(this,{preparePlayback,closePlayback,suspendVocal,attachVocalVideo});this.userStoppedAudio=false;
    if(supportsContinuousVocal)this.state.supportsContinuousVocal=true;
  }
  update(patch) { this.state = { ...this.state, ...patch }; this.publish(this.state); }
  get active() { return this.state.captureStatus === 'capturing_original'; }
  async audio(type, payload = {}, generation = this.generation) {
    let timer;
    try {
      const response = await Promise.race([
        this.sendAudio(type, payload, generation),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('ระบบเสียงไม่ตอบกลับ กรุณาเปิดระบบเสียงใหม่')), this.timeoutMs); }),
      ]);
      if (generation !== this.generation) throw Object.assign(new Error('คำสั่งเสียงถูกยกเลิกแล้ว'), { name: 'AbortError' });
      if (!response?.ok) throw new Error(response?.error || 'ระบบเสียงไม่พร้อม');
      return response;
    } finally { clearTimeout(timer); }
  }
  deactivate(status, lastError = null) {
    this.cancelVocalResume();
    this.update({ captureStatus: status, lastError, enabled: false, supportsLoudnessNormalize: false,
      supportsPitchPreservedTempo: false, pitchSemitones: 0, playbackRate: 1, inputRms: 0, outputRms: 0,
      vocalRemoverEnabled:false,vocalRemoverStatus:this.state.vocalRemoverReady?'ready':'unavailable' });
  }
  cancelVocalResume(){this.pendingVocalResume=null;this.modelSwitchIntent=false;if(this.state.vocalResumePending)this.update({vocalResumePending:false});}
  vocalModelReady(details){
    if(details.modelId!==this.state.vocalModelId)return Promise.resolve();
    this.update({vocalRemoverReady:true,vocalRuntimeStatus:'ready',vocalRuntimeError:null,vocalRemoverError:null,
      vocalRuntimeDevice:details.name,vocalRuntimeDenoise:details.denoise,vocalRemoverStatus:this.state.vocalRemoverEnabled?this.state.vocalRemoverStatus:'ready'});
    return this.resumeVocalWhenReady();
  }
  vocalPlaybackState(payload){
    if(typeof payload.playing!=='boolean'||payload.youtubeVideoId!==this.state.currentVideoId||payload.queueItemId!==this.state.currentQueueItemId)return Promise.resolve();
    this.update({vocalPlaybackPlaying:payload.playing});
    return payload.playing?this.resumeVocalWhenReady():Promise.resolve();
  }
  resumeVocalWhenReady(){
    const resume=this.pendingVocalResume;
    if(!resume||!this.state.vocalRemoverReady)return Promise.resolve();
    if(resume.selection!==this.modelSelectionGeneration||resume.generation!==this.generation||!this.modelSwitchIntent||!this.active
      ||resume.queueItemId!==this.state.currentQueueItemId||resume.videoId!==this.state.currentVideoId||this.state.currentVersionType!=='mv'){
      this.cancelVocalResume();return Promise.resolve();
    }
    if(this.state.vocalPlaybackPlaying===false){this.update({vocalResumePending:true});return Promise.resolve();}
    this.pendingVocalResume=null;
    this.modelSwitchIntent=false;
    if(this.state.vocalResumePending)this.update({vocalResumePending:false});
    return this.command('SET_VOCAL_REMOVER',{enabled:true}).then(result=>{
      if(!result.ok&&resume.generation===this.generation&&resume.queueItemId===this.state.currentQueueItemId)this.update({vocalRemoverError:result.error});
      return result;
    });
  }
  vocalModelFailed(error,modelId=this.state.vocalModelId){
    if(modelId!==this.state.vocalModelId)return;
    this.cancelVocalResume();this.update({vocalRemoverReady:false,vocalRuntimeStatus:'error',vocalRuntimeError:error});
  }
  revokeVocal(options={}) {
    try{this.vocalStopping=Promise.resolve(this.setVocal(false,options)).catch(()=>{});}catch{this.vocalStopping=Promise.resolve();}
    return this.vocalStopping;
  }
  endPlayback(options={}){try{this.playbackStopping=Promise.resolve(this.closePlayback(options)).catch(()=>{});}catch{this.playbackStopping=Promise.resolve();}return this.playbackStopping;}
  async ensureBufferedCapture(configuration){
    const videoId=this.state.currentVideoId,queueItemId=this.state.currentQueueItemId;
    const generation=this.active?this.generation:++this.generation;
    try{
      if(!this.active){this.update({captureStatus:'starting',lastError:null});await this.audio('START_AUDIO',{...configuration,buffered:true},generation);}
      else await this.audio('PREPARE_VOCAL_SESSION',configuration,generation);
      if(generation!==this.generation||videoId!==this.state.currentVideoId||queueItemId!==this.state.currentQueueItemId)throw Object.assign(new Error('ยกเลิกการเตรียมเพลงแล้ว'),{name:'AbortError'});
      this.update({captureStatus:'capturing_original',supportsPitchPreservedTempo:true,lastError:null});
    }catch(error){
      if(generation===this.generation){this.generation++;this.deactivate('error',error.message);void this.audio('STOP_AUDIO').catch(()=>{});}
      throw error;
    }
  }
  async prepareCurrentPlayback(){
    if(!this.preparePlayback||this.userStoppedAudio||this.state.currentVersionType!=='mv'||!this.state.currentQueueItemId)return;
    if(this.state.vocalBufferActive)return{buffered:true,sessionId:this.state.continuousSessionId};
    return this.preparePlayback({videoId:this.state.currentVideoId,queueItemId:this.state.currentQueueItemId,versionType:'mv',playing:this.state.vocalPlaybackPlaying});
  }
  audioEvent(patch, generation) {
    if (generation !== this.generation) return;
    if (patch.captureStatus === 'error' || patch.captureStatus === 'installed_idle') {
      this.generation++;
      this.deactivate(patch.captureStatus, patch.lastError);
      void this.revokeVocal();
      void this.endPlayback({restorePosition:false});
      void this.audio('STOP_AUDIO').catch(() => {});
      return;
    }
    if (this.active && patch.vocalEpoch===undefined) this.update(patch);
  }
  async disconnect() { return this.command('STOP_AUDIO',{}, {automatic:true}); }
  command(type, payload = {},{automatic=false}={}) {
    if (!validateCommand(type, payload)) return Promise.resolve({ ok: false, error: 'คำสั่งหรือค่าที่ส่งมาไม่ถูกต้อง', state: this.state });
    if(type==='SET_VOCAL_REMOVER')this.cancelVocalResume();
    if(type==='TRACK_CHANGED'&&(payload.youtubeVideoId!==this.state.currentVideoId||(payload.queueItemId??null)!==this.state.currentQueueItemId
      ||(payload.youtubeVideoId&&payload.versionType==='mv'?'mv':'karaoke')!==this.state.currentVersionType))this.cancelVocalResume();
    if(type==='SET_VOCAL_MODEL'&&(payload.modelId!==this.requestedModelId||this.state.vocalRuntimeStatus==='error')){
      this.modelSwitchIntent=this.state.vocalRemoverEnabled||this.modelSwitchIntent;
      this.pendingVocalResume=null;this.requestedModelId=payload.modelId;++this.modelSelectionGeneration;
    }
    const modelSelection=this.modelSelectionGeneration;
    // Revoke synchronously, before an in-flight start or IPC reply can arrive.
    if(type==='START_AUDIO')this.userStoppedAudio=false;
    if (type === 'STOP_AUDIO') {
      if(!automatic)this.userStoppedAudio=true;
      const wasStarting=this.state.captureStatus==='starting';
      this.generation++; this.deactivate('installed_idle');void this.revokeVocal();void this.endPlayback({restorePosition:true});
      if(wasStarting&&this.state.supportsContinuousVocal)void this.audio('STOP_AUDIO').catch(()=>{});
    }
    const scheduledGeneration = this.generation;
    const job = async () => {
      try {
        if (scheduledGeneration !== this.generation && type !== 'STOP_AUDIO'&&type!=='SET_VOCAL_MODEL') return { ok: false, error: 'คำสั่งเสียงถูกยกเลิกแล้ว', state: this.state };
        await this.apply(type, payload,{modelSelection,generation:scheduledGeneration});
        return { ok: true, state: this.state };
      } catch (error) {
        if (type === 'START_AUDIO' && error.name !== 'AbortError') {
          this.generation++;
          this.deactivate('error', error.message);
          void this.audio('STOP_AUDIO').catch(() => {});
        }
        return { ok: false, error: error.message, state: this.state };
      }
    };
    const result = this.queue.then(job);
    this.queue = result.then(() => {}, () => {});
    return result;
  }
  async apply(type, payload,context={}) {
    switch (type) {
      case 'PLAYER_HELLO': case 'REQUEST_STATUS': return;
      case 'PREPARE_PLAYER_TRACK':
        await this.apply('TRACK_CHANGED',payload,context);
        await this.prepareCurrentPlayback();return;
      case 'SET_SEARCH_VERSION': this.update({ searchVersion: payload.version }); return;
      case 'SET_VOCAL_MODEL': {
        if(context.modelSelection!==this.modelSelectionGeneration)return;
        const profile=getVocalModel(payload.modelId);
        if(profile.id===this.state.vocalModelId&&this.state.vocalRuntimeStatus!=='error')return;
        if(this.state.vocalRemoverStatus==='paused')this.update({vocalPlaybackPlaying:false});
        await this.revokeVocal({restorePosition:true});
        await this.suspendVocal();
        if(context.modelSelection!==this.modelSelectionGeneration)return;
        this.update({vocalModelId:profile.id,vocalRemoverDelayMs:profile.delayMs,vocalRemoverEnabled:false,vocalRemoverReady:false,
          vocalRemoverStatus:'unavailable',vocalRuntimeStatus:'loading',vocalRuntimeError:null,vocalRemoverError:null,vocalResumePending:Boolean(this.modelSwitchIntent)});
        this.pendingVocalResume=this.modelSwitchIntent?{selection:context.modelSelection,generation:this.generation,queueItemId:this.state.currentQueueItemId,videoId:this.state.currentVideoId}:null;
        this.selectVocalModel(profile.id);return;
      }
      case 'SET_VOCAL_REMOVER':
        if(payload.enabled&&this.state.vocalRemoverEnabled)return;
        if(payload.enabled){
          if(!this.state.vocalRemoverReady&&!(this.state.supportsContinuousVocal&&this.state.vocalBufferActive&&this.state.vocalRuntimeStatus!=='error'))throw new Error(this.state.vocalRuntimeError||'ระบบ AI ยังไม่พร้อมใช้งาน');
          if(!this.active)throw new Error('เปิดระบบเสียงก่อนใช้ Vocal Remover');
          if(!this.state.vocalRemoverEligible||!this.state.currentQueueItemId)throw new Error('Vocal Remover ใช้ได้เฉพาะเพลง MV ที่กำลังเล่น');
        }
        await this.setVocal(payload.enabled,{restorePosition:true});
        this.update({vocalRemoverEnabled:payload.enabled,vocalRemoverStatus:payload.enabled?'preparing':this.state.vocalRemoverReady?'ready':'unavailable',vocalRemoverError:null});return;
      case 'START_AUDIO': {
        if(this.preparePlayback&&this.state.currentVersionType==='mv'&&!this.state.vocalBufferActive){await this.prepareCurrentPlayback();if(this.state.vocalPlaybackPlaying!==false)await this.attachVocalVideo();return;}
        if (this.active) return;
        const generation = ++this.generation;
        this.update({ captureStatus: 'starting', lastError: null });
        await this.audio('START_AUDIO', {}, generation);
        if (generation !== this.generation) return;
        this.update({ captureStatus: 'capturing_original', supportsPitchPreservedTempo: true, lastError: null });
        return;
      }
      case 'STOP_AUDIO':
        await this.vocalStopping;
        await this.playbackStopping;
        await this.sourceRate(1, true).catch(() => {});
        await this.audio('STOP_AUDIO'); return;
      case 'TRACK_CHANGED': {
        const queueItemId = payload.queueItemId ?? null;
        const versionType = payload.youtubeVideoId && payload.versionType === 'mv' ? 'mv' : 'karaoke';
        if (payload.youtubeVideoId === this.state.currentVideoId && queueItemId === this.state.currentQueueItemId && versionType === this.state.currentVersionType) return;
        this.cancelVocalResume();
        await this.revokeVocal({restorePosition:false});
        await this.endPlayback({restorePosition:false});
        if (this.active) {
          await this.audio('RESET_TRACK');
          // A source may still be loading; its normal load also defaults to 1x.
          await this.sourceRate(1).catch(() => {});
        }
        this.update({ currentVideoId: payload.youtubeVideoId, currentQueueItemId: queueItemId,
          vocalPlaybackPlaying:undefined,
          currentVersionType: versionType, vocalRemoverEligible: Boolean(payload.youtubeVideoId && versionType === 'mv'),
          vocalRemoverEnabled:false,vocalRemoverStatus:this.state.vocalRemoverReady?'ready':'unavailable',vocalRemoverError:null,
          pitchSemitones: 0, playbackRate: 1,
          enabled: false, captureStatus: this.active ? 'capturing_original' : this.state.captureStatus });
        return;
      }
      case 'SET_PLAYER_VOLUME':
        this.update({ playerVolume: payload.volume, playerMuted: payload.muted }); return;
      case 'SET_PITCH':
        if (!this.active || !this.state.currentVideoId) throw new Error('เปิดระบบเสียงและเลือกเพลงก่อนปรับคีย์');
        await this.audio(type, payload); this.update({ pitchSemitones: payload.semitones }); return;
      case 'SET_PLAYBACK_RATE':
        if (!this.active) {
          if (payload.playbackRate === 1) return;
          throw new Error('เปิดระบบเสียงก่อนปรับความเร็ว');
        }
        await this.audio(type, payload); this.update({ playbackRate: payload.playbackRate }); return;
      case 'TEMPO_UP': case 'TEMPO_DOWN':
        await this.step(type === 'TEMPO_UP' ? 1 : -1); return;
      case 'RESET_AUDIO':
        if (!this.active || !this.state.currentVideoId) throw new Error('เปิดระบบเสียงและเลือกเพลงก่อน');
        await this.audio('SET_PITCH', { semitones: 0 });
        this.update({ pitchSemitones: 0 });
        await this.sourceRate(1);
        this.update({ playbackRate: 1 }); return;
    }
  }
  async sourceRate(rate, allowInactive = false) {
    const generation = this.generation;
    let timer;
    try {
      const actual = await Promise.race([
        this.setPlaybackRate(rate),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('เครื่องเล่นไม่ตอบกลับการปรับความเร็ว')), this.timeoutMs); }),
      ]);
      if (generation !== this.generation || (!allowInactive && !this.active)) throw new Error('ระบบเสียงหยุดแล้ว');
      if (!Number.isFinite(actual) || Math.abs(actual - rate) > 1e-6) throw new Error('เครื่องเล่นไม่ยอมรับความเร็วที่เลือก');
      return actual;
    } finally { clearTimeout(timer); }
  }
  async step(delta) {
    if (!this.active || !this.state.currentVideoId) throw new Error('เปิดระบบเสียงและเลือกเพลงก่อนปรับความเร็ว');
    const percent = Math.round(this.state.playbackRate * 100) + delta;
    if (percent < 25 || percent > 200) throw new Error('ความเร็วต้องอยู่ระหว่าง 25% ถึง 200%');
    const actual = await this.sourceRate(percent / 100);
    this.update({ playbackRate: actual });
  }
}
module.exports = { DesktopAudioController };
