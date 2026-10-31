import {createVocalLevelControl} from './vocal-level.mjs';
let state={},busy=false,busyType=null,commandId=0;
const $=id=>document.getElementById(id);
const vocalLevel=createVocalLevelControl({root:$('vocal-level-control'),
  send:level=>{$('message').textContent='';return window.desktopPlayer.command('SET_VOCAL_LEVEL',{level});},
  focus:()=>window.desktopPlayer.command('FOCUS_PLAYER_SEARCH'),
  onError:error=>{$('message').textContent=error;},
});
function render(next=state) {
  state=next;
  vocalLevel.update(state);
  $('version-karaoke').setAttribute('aria-pressed',String(state.searchVersion!=='mv'));
  $('version-mv').setAttribute('aria-pressed',String(state.searchVersion==='mv'));
  const active=state.captureStatus==='capturing_original';
  const vocalOn=Boolean(state.vocalRemoverEnabled);
  const vocalIntent=vocalOn||Boolean(state.vocalResumePending);
  const continuous=Boolean(state.supportsContinuousVocal),delay=continuous?'8':state.vocalModelId==='hq5'?'8':'4.5';
  $('vocal-model').value=state.vocalModelId||'fast';$('vocal-model').disabled=busy;
  if(state.vocalPreferenceError)$('message').textContent=state.vocalPreferenceError;
  const canPrepare=continuous&&state.vocalBufferActive&&state.vocalRuntimeStatus!=='error';
  $('vocal-remover').disabled=busy||(!vocalIntent&&(!state.vocalRemoverEligible||(!state.vocalRemoverReady&&!canPrepare)||!active));
  $('vocal-remover').textContent=state.vocalResumePending?'ยกเลิก AI':state.vocalRuntimeStatus==='loading'?'เตรียม AI…':vocalOn?(state.vocalRemoverStatus==='preparing'?'ยกเลิก AI':'คืนเสียงร้อง'):'Vocal Remover';
  $('vocal-remover').setAttribute('aria-pressed',String(vocalOn));
  $('vocal-remover').title=state.vocalRuntimeError||state.vocalRemoverError||(!state.vocalRemoverEligible?'ใช้ได้เฉพาะเพลง MV ที่กำลังเล่น':!active?'เปิดระบบเสียงก่อนใช้ Vocal Remover':!state.vocalRemoverReady?'กำลังเตรียมระบบ AI':vocalOn?'กลับไปใช้เสียงต้นฉบับ':`แยกเสียงร้องด้วย AI · ภาพและเสียงหน่วงประมาณ ${delay} วินาที`);
  const ready=active&&Boolean(state.currentVideoId);
  $('pitch').textContent=state.pitchSemitones>0?`+${state.pitchSemitones}`:String(state.pitchSemitones??0);
  $('rate').textContent=`${Math.round((state.playbackRate??1)*100)}%`;
  const starting=state.captureStatus==='starting',canCancel=continuous&&starting&&(!busy||busyType==='START_AUDIO');
  $('audio').textContent=active?'หยุดระบบเสียง':starting?(canCancel?'ยกเลิกเตรียมเสียง':'กำลังเชื่อมต่อ…'):'เปิดระบบเสียง';
  $('audio').disabled=(busy&&!canCancel)||(starting&&!canCancel)||!state.playerReady;
  for(const id of ['pitch-down','pitch-up','tempo-down','tempo-up','reset']) $(id).disabled=busy||!ready;
  $('pitch-down').disabled||=state.pitchSemitones<=-6;
  $('pitch-up').disabled||=state.pitchSemitones>=6;
  $('tempo-down').disabled||=state.playbackRate<=0.25;
  $('tempo-up').disabled||=state.playbackRate>=2;
  $('indicator').classList.toggle('on',active);
  $('status').textContent=state.playerError||state.lastError||state.vocalRemoverError||state.vocalRuntimeError||(state.vocalRuntimeStatus==='loading'?'กำลังเตรียมโมเดล AI…':state.vocalResumePending?'AI พร้อม · รอเล่นเพลงเพื่อเริ่มตัดเสียงร้อง':vocalOn?(state.vocalRemoverStatus==='preparing'?`กำลังแยกเสียงร้องและซิงก์ภาพประมาณ ${delay} วินาที…`:state.vocalRemoverStatus==='paused'?'Vocal Remover หยุดชั่วคราว':`AI ตัดเสียงร้องทำงาน · หน่วงประมาณ ${delay} วินาที`):active?`ระบบเสียงพร้อม · โหมด${state.vocalModelId==='hq5'?'คุณภาพสูง':'เร็ว'} หน่วงประมาณ ${delay} วินาที`:state.playerReady?'พร้อมเล่น · เปิดระบบเสียงเพื่อปรับคีย์และความเร็ว':'กำลังเปิด Player…');
  if(continuous&&active&&!state.vocalRemoverError&&!state.vocalRuntimeError&&!state.playerError&&!state.lastError){
    $('status').textContent=state.vocalBufferStatus==='priming'?'กำลังเตรียมเพลงประมาณ 8 วินาที…':state.vocalBufferStatus==='paused'?'พักเพลง':vocalOn?(state.vocalRemoverStatus==='on'?'AI ตัดเสียงร้องทำงาน': 'เสียงต้นฉบับเล่นต่อ · กำลังเตรียม AI…'):state.vocalRuntimeStatus==='loading'?'เสียงต้นฉบับ · กำลังเตรียมโมเดล AI…':state.vocalSignalReady?'เสียงต้นฉบับ · Vocal Remover พร้อมสลับต่อเนื่อง':'เสียงต้นฉบับ · กำลังเตรียม AI…';
  }
}
async function command(type,payload={}) {
  if(busy&&type!=='STOP_AUDIO') return;
  const id=++commandId;busy=true;busyType=type;render();$('message').textContent='';
  try {const result=await window.desktopPlayer.command(type,payload);if(id!==commandId)return;if(!result.ok) $('message').textContent=result.error; if(result.state) state=result.state;}
  catch {if(id===commandId)$('message').textContent='เชื่อมต่อระบบเสียงไม่สำเร็จ ลองโหลด Player ใหม่';}
  finally{if(id===commandId){busy=false;busyType=null;render();}}
}
$('audio').onclick=()=>command(['capturing_original','starting'].includes(state.captureStatus)?'STOP_AUDIO':'START_AUDIO');
$('vocal-remover').onclick=()=>command('SET_VOCAL_REMOVER',{enabled:!(state.vocalRemoverEnabled||state.vocalResumePending)});
$('vocal-model').onchange=event=>command('SET_VOCAL_MODEL',{modelId:event.target.value});
$('version-karaoke').onclick=()=>command('SET_SEARCH_VERSION',{version:'karaoke'});
$('version-mv').onclick=()=>command('SET_SEARCH_VERSION',{version:'mv'});
$('pitch-down').onclick=()=>command('SET_PITCH',{semitones:state.pitchSemitones-1});
$('pitch-up').onclick=()=>command('SET_PITCH',{semitones:state.pitchSemitones+1});
$('tempo-down').onclick=()=>command('TEMPO_DOWN');$('tempo-up').onclick=()=>command('TEMPO_UP');
$('reset').onclick=()=>command('RESET_AUDIO');$('reload').onclick=()=>command('RELOAD_PLAYER');
window.desktopPlayer.subscribe(render);
void window.desktopPlayer.command('REQUEST_STATUS').then(result=>render(result.state));
