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
  constructor({ sendAudio, sendShortcut, publish, timeoutMs = 10000 }) {
    this.sendAudio = sendAudio; this.sendShortcut = sendShortcut; this.publish = publish;
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
    if (type === 'TEMPO_UP' || type === 'TEMPO_DOWN' || type === 'RESET_AUDIO') {
      return this.transport(type).catch(error => ({ ok: false, error: error.message, state: this.state }));
    }
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
      case 'STOP_AUDIO': await this.audio('STOP_AUDIO'); return;
      case 'TRACK_CHANGED': {
        if (payload.youtubeVideoId === this.state.currentVideoId) return;
        if (this.active) await this.audio('RESET_TRACK');
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
    }
  }
  async step(direction) {
    if (!this.active || !this.state.currentVideoId) throw new Error('เปิดระบบเสียงและเลือกเพลงก่อนปรับความเร็ว');
    const before = this.state.playbackRate;
    const generation = this.generation;
    if (!await this.sendShortcut(direction === 'up' ? 'PageUp' : 'PageDown')) throw new Error('Player ยังไม่พร้อมปรับความเร็ว');
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && this.state.playbackRate === before && generation === this.generation) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (generation !== this.generation || !this.active) throw new Error('ระบบเสียงหยุดแล้ว');
    if (this.state.playbackRate === before) throw new Error('เพลงนี้ไม่มีความเร็วระดับถัดไป');
  }
  async transport(type) {
    if (type === 'RESET_AUDIO') {
      const pitch = await this.command('SET_PITCH', { semitones: 0 });
      if (!pitch.ok) return pitch;
      for (let n = 0; this.state.playbackRate !== 1 && n < 16; n++) await this.step(this.state.playbackRate > 1 ? 'down' : 'up');
      if (this.state.playbackRate !== 1) throw new Error('ไม่สามารถคืนความเร็วได้');
    } else { await this.step(type === 'TEMPO_UP' ? 'up' : 'down'); }
    return { ok: true, state: this.state };
  }
}
module.exports = { DesktopAudioController };
