const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPlayerUrl, resolvePlayerUrl, validateCommand } = require('../lib/policy.cjs');
const { DesktopAudioController } = require('../lib/controller.cjs');

const production = 'https://karaoke-hub-nu.vercel.app/player';
test('only the configured Player origin and path receive native privileges', () => {
  assert.equal(isPlayerUrl(production, production), true);
  for (const url of ['https://evil.test/player', production + '/other', 'https://karaoke-hub-nu.vercel.app.evil.test/player', 'https://user:pass@karaoke-hub-nu.vercel.app/player', 'file:///player']) {
    assert.equal(isPlayerUrl(url, production), false, url);
  }
  assert.equal(isPlayerUrl('http://127.0.0.1:3456/player', 'http://127.0.0.1:3456/player'), true);
  assert.throws(() => resolvePlayerUrl('http://evil.test/player'));
  assert.throws(() => resolvePlayerUrl('https://evil.test/player'));
});
test('IPC rejects nonfinite, coerced and out-of-range audio parameters', () => {
  for (const semitones of [NaN, Infinity, '3', -7, 7, 0.5]) assert.equal(validateCommand('SET_PITCH', { semitones }), false);
  assert.equal(validateCommand('SET_PITCH', { semitones: -6 }), true);
  for (const playbackRate of [0, -1, '1', Infinity, 2.1]) assert.equal(validateCommand('SET_PLAYBACK_RATE', { playbackRate }), false);
  assert.equal(validateCommand('TRACK_CHANGED', { youtubeVideoId: 'bad' }), false);
  assert.equal(validateCommand('TRACK_CHANGED', { youtubeVideoId: null }), true);
  assert.equal(validateCommand('EXECUTE_JAVASCRIPT', { code: 'anything' }), false);
});
function setup(sendAudio = async () => ({ ok: true })) {
  const audio = [];
  const controller = new DesktopAudioController({
    sendAudio: async (type, payload, generation) => { audio.push({ type, payload, generation }); return sendAudio(type, payload, generation); },
    sendShortcut: async () => false,
    publish: () => {}, timeoutMs: 40,
  });
  return { controller, audio };
}
test('pitch changes only after audio starts and is reset on a new video', async () => {
  const { controller, audio } = setup();
  assert.equal((await controller.command('SET_PITCH', { semitones: 3 })).ok, false);
  await controller.command('START_AUDIO');
  await controller.command('TRACK_CHANGED', { youtubeVideoId: 'abcdefghijk' });
  await controller.command('SET_PITCH', { semitones: 3 });
  assert.equal(controller.state.pitchSemitones, 3);
  assert.ok(audio.some(x => x.type === 'SET_PITCH' && x.payload.semitones === 3));
  await controller.command('TRACK_CHANGED', { youtubeVideoId: '12345678901' });
  assert.equal(controller.state.pitchSemitones, 0);
  assert.equal(controller.state.playbackRate, 1);
});
test('stop during a pending start ignores its late acknowledgement and audio events', async () => {
  let finish;
  const { controller } = setup(type => type === 'START_AUDIO' ? new Promise(r => { finish = r; }) : Promise.resolve({ ok: true }));
  const starting = controller.command('START_AUDIO');
  await new Promise(r => setImmediate(r));
  const oldGeneration = controller.generation;
  const stopping = controller.command('STOP_AUDIO');
  finish({ ok: true });
  await Promise.all([starting, stopping]);
  controller.audioEvent({ captureStatus: 'capturing_original' }, oldGeneration);
  assert.equal(controller.state.captureStatus, 'installed_idle');
  assert.equal(controller.state.supportsPitchPreservedTempo, false);
});
test('audio errors revoke processing and the user can retry', async () => {
  let fail = true;
  const { controller } = setup(async type => type === 'START_AUDIO' && fail ? { ok: false, error: 'No audio track' } : { ok: true });
  assert.equal((await controller.command('START_AUDIO')).ok, false);
  assert.equal(controller.state.captureStatus, 'error');
  fail = false;
  assert.equal((await controller.command('START_AUDIO')).ok, true);
  assert.equal(controller.state.captureStatus, 'capturing_original');
  controller.audioEvent({ captureStatus: 'error', lastError: 'Track ended' }, controller.generation);
  assert.equal(controller.state.supportsPitchPreservedTempo, false);
  assert.equal(controller.state.pitchSemitones, 0);
});
test('a hung host times out and a late success cannot reactivate it', async () => {
  const { controller } = setup(type => type === 'START_AUDIO' ? new Promise(() => {}) : Promise.resolve({ ok: true }));
  assert.equal((await controller.command('START_AUDIO')).ok, false);
  assert.equal(controller.state.captureStatus, 'error');
  assert.equal(controller.state.supportsPitchPreservedTempo, false);
});
test('failed DSP commands do not advertise an unapplied key', async () => {
  const { controller } = setup(async type => ({ ok: type !== 'SET_PITCH', error: 'DSP unavailable' }));
  await controller.command('START_AUDIO');
  assert.equal((await controller.command('SET_PITCH', { semitones: 4 })).ok, false);
  assert.equal(controller.state.pitchSemitones, 0);
});
test('an immediate stop cancels a start still waiting in the command queue', async () => {
  const {controller,audio}=setup();
  await Promise.all([controller.command('START_AUDIO'),controller.command('STOP_AUDIO')]);
  assert.equal(controller.state.captureStatus,'installed_idle');
  assert.equal(audio.filter(x=>x.type==='START_AUDIO').length,0);
});
test('an in-flight key acknowledgement cannot overwrite a stopped session', async () => {
  let finish;
  const {controller}=setup(type=>type==='SET_PITCH'?new Promise(r=>{finish=r;}):Promise.resolve({ok:true}));
  await controller.command('START_AUDIO');
  await controller.command('TRACK_CHANGED',{youtubeVideoId:'abcdefghijk'});
  const pitch=controller.command('SET_PITCH',{semitones:4});
  await new Promise(r=>setImmediate(r));
  const stop=controller.command('STOP_AUDIO');finish({ok:true});
  assert.equal((await pitch).ok,false);
  await stop;
  assert.equal(controller.state.pitchSemitones,0);
  assert.equal(controller.state.captureStatus,'installed_idle');
});
