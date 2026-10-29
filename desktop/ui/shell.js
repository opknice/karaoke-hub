let state={},busy=false;
const $=id=>document.getElementById(id);
function render(next=state) {
  state=next;
  const active=state.captureStatus==='capturing_original';
  const ready=active&&Boolean(state.currentVideoId);
  $('pitch').textContent=state.pitchSemitones>0?`+${state.pitchSemitones}`:String(state.pitchSemitones??0);
  $('rate').textContent=`${Math.round((state.playbackRate??1)*100)}%`;
  $('audio').textContent=active?'หยุดระบบเสียง':state.captureStatus==='starting'?'กำลังเชื่อมต่อ…':'เปิดระบบเสียง';
  $('audio').disabled=busy||state.captureStatus==='starting'||!state.playerReady;
  for(const id of ['pitch-down','pitch-up','tempo-down','tempo-up','reset']) $(id).disabled=busy||!ready;
  $('pitch-down').disabled||=state.pitchSemitones<=-6;
  $('pitch-up').disabled||=state.pitchSemitones>=6;
  $('tempo-down').disabled||=state.playbackRate<=0.25;
  $('tempo-up').disabled||=state.playbackRate>=2;
  $('indicator').classList.toggle('on',active);
  $('status').textContent=state.playerError||state.lastError||(active?'ระบบเสียงพร้อม · ไม่ต้องใช้ Extension':state.playerReady?'พร้อมเล่น · เปิดระบบเสียงเพื่อปรับคีย์และความเร็ว':'กำลังเปิด Player…');
}
async function command(type,payload={}) {
  if(busy) return;
  busy=true;render();$('message').textContent='';
  try {const result=await window.desktopPlayer.command(type,payload);if(!result.ok) $('message').textContent=result.error; if(result.state) state=result.state;}
  catch {$('message').textContent='เชื่อมต่อระบบเสียงไม่สำเร็จ ลองโหลด Player ใหม่';}
  finally{busy=false;render();}
}
$('audio').onclick=()=>command(state.captureStatus==='capturing_original'?'STOP_AUDIO':'START_AUDIO');
$('pitch-down').onclick=()=>command('SET_PITCH',{semitones:state.pitchSemitones-1});
$('pitch-up').onclick=()=>command('SET_PITCH',{semitones:state.pitchSemitones+1});
$('tempo-down').onclick=()=>command('TEMPO_DOWN');$('tempo-up').onclick=()=>command('TEMPO_UP');
$('reset').onclick=()=>command('RESET_AUDIO');$('reload').onclick=()=>command('RELOAD_PLAYER');
window.desktopPlayer.subscribe(render);
void window.desktopPlayer.command('REQUEST_STATUS').then(result=>render(result.state));
