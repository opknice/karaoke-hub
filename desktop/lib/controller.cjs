const { validateCommand } = require('./policy.cjs');

function initialState() {
  return {
    // These false flags retain compatibility with the hosted Player bridge.
    captureStatus: 'installed_idle', enabled: false, monoLike: false,
    supportsLoudnessNormalize: false, supportsPitchPreservedTempo: false,
    playbackRate: 1, pitchSemitones: 0,
    playerVolume: 85, playerMuted: false, lastError: null, currentVideoId: null,
    inputRms: 0, outputRms: 0, peakHz: 0,
  };
}
class DesktopAudioController {
  constructor({ sendAudio, setPlaybackRate, publish, timeoutMs = 10000 }) {
    this.sendAudio = sendAudio; this.setPlaybackRate = setPlaybackRate; this.publish = publish;
    this.timeoutMs = timeoutMs; this.state = initialState(); this.generation = 0;
    this.queue = Promise.resolve();
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
    this.update({ captureStatus: status, lastError, enabled: false, supportsLoudnessNormalize: false,
      supportsPitchPreservedTempo: false, pitchSemitones: 0, playbackRate: 1, inputRms: 0, outputRms: 0 });
  }
  audioEvent(patch, generation) {
    if (generation !== this.generation) return;
    if (patch.captureStatus === 'error' || patch.captureStatus === 'installed_idle') {
      this.generation++;
      this.deactivate(patch.captureStatus, patch.lastError);
      void this.audio('STOP_AUDIO').catch(() => {});
      return;
    }
    if (this.active) this.update(patch);
  }
  async disconnect() { return this.command('STOP_AUDIO'); }
  command(type, payload = {}) {
    if (!validateCommand(type, payload)) return Promise.resolve({ ok: false, error: 'คำสั่งหรือค่าที่ส่งมาไม่ถูกต้อง', state: this.state });
    // Revoke synchronously, before an in-flight start or IPC reply can arrive.
    if (type === 'STOP_AUDIO') { this.generation++; this.deactivate('installed_idle'); }
    const scheduledGeneration = this.generation;
    const job = async () => {
      try {
        if (scheduledGeneration !== this.generation && type !== 'STOP_AUDIO') return { ok: false, error: 'คำสั่งเสียงถูกยกเลิกแล้ว', state: this.state };
        await this.apply(type, payload);
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
  async apply(type, payload) {
    switch (type) {
      case 'PLAYER_HELLO': case 'REQUEST_STATUS': return;
      case 'START_AUDIO': {
        if (this.active) return;
        const generation = ++this.generation;
        this.update({ captureStatus: 'starting', lastError: null });
        await this.audio('START_AUDIO', {}, generation);
        if (generation !== this.generation) return;
        this.update({ captureStatus: 'capturing_original', supportsPitchPreservedTempo: true, lastError: null });
        return;
      }
      case 'STOP_AUDIO':
        await this.sourceRate(1, true).catch(() => {});
        await this.audio('STOP_AUDIO'); return;
      case 'TRACK_CHANGED': {
        if (payload.youtubeVideoId === this.state.currentVideoId) return;
        if (this.active) {
          await this.audio('RESET_TRACK');
          // A source may still be loading; its normal load also defaults to 1x.
          await this.sourceRate(1).catch(() => {});
        }
        this.update({ currentVideoId: payload.youtubeVideoId, pitchSemitones: 0, playbackRate: 1,
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
