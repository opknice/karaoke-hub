const adjustmentKeys=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown']);
const valid=level=>Number.isInteger(level)&&level>=0&&level<=100;

/** One outstanding native command and one replaceable latest value. */
export function createVocalLevelControl({root,send,focus,onError=()=>{}}){
  const slider=root.querySelector('input'),output=root.querySelector('output');
  const down=root.querySelector('[data-level-down]'),up=root.querySelector('[data-level-up]');
  let selected=0,acknowledged=0,serverRevision=-1,enabled=false,live=false,controlsBusy=false;
  let inFlight=false,pending=null,serial=0,generation=0,pointer=false,keyboard=false,finishing=false;
  const draw=()=>{
    slider.value=String(selected);slider.disabled=!enabled;
    slider.setAttribute('aria-valuetext',`${selected}%`);output.textContent=`${selected}%`;
    down.disabled=!enabled||selected===0;up.disabled=!enabled||selected===100;
  };
  const settle=()=>{
    if(!finishing||pointer||keyboard||inFlight||pending||!enabled)return;finishing=false;
    try{const result=focus();result?.catch?.(error=>onError(error.message));}catch(error){onError(error.message);}
  };
  const update=state=>{
    if(typeof state.controlsBusy==='boolean')controlsBusy=state.controlsBusy;
    const revision=state.vocalLevelRevision;
    if(valid(state.vocalLevel)&&Number.isSafeInteger(revision)&&revision>=serverRevision){acknowledged=state.vocalLevel;serverRevision=revision;}
    const nextLive=Boolean(state.supportsContinuousVocal&&state.vocalBufferActive&&state.captureStatus==='capturing_original'&&state.vocalRemoverEligible);
    if(live!==nextLive){generation++;live=nextLive;if(!live){pending=null;pointer=false;keyboard=false;finishing=false;}}
    enabled=Boolean(live&&!controlsBusy&&(state.vocalRemoverEnabled||state.vocalResumePending)&&state.vocalRuntimeStatus!=='error'&&state.vocalRemoverStatus!=='error');
    if(!live||(!inFlight&&!pending&&!pointer&&!keyboard))selected=acknowledged;
    draw();settle();
  };
  const pump=async()=>{
    if(inFlight||!pending||!live)return;
    const request=pending,epoch=generation;pending=null;inFlight=true;let failed=false;
    try{
      const result=await send(request.level);
      if(epoch!==generation)return;
      if(result?.state)update(result.state);
      if(epoch!==generation)return;
      if(!result?.ok){failed=true;if(request.serial===serial)onError(result?.error||'ปรับระดับเสียงร้องไม่สำเร็จ');}
    }catch(error){failed=true;if(epoch===generation&&request.serial===serial)onError(error.message||'ปรับระดับเสียงร้องไม่สำเร็จ');}
    finally{
      inFlight=false;
      if(epoch===generation&&failed&&request.serial===serial&&!pending)selected=acknowledged;
      draw();void pump();settle();
    }
  };
  const request=level=>{
    if(!enabled||!valid(level)||level===selected)return;
    selected=level;pending={level,serial:++serial};draw();void pump();
  };
  const finish=()=>{if(!enabled)return;pointer=false;keyboard=false;finishing=true;settle();};
  slider.addEventListener('pointerdown',()=>{if(enabled)pointer=true;});
  root.ownerDocument.addEventListener('pointerup',()=>{if(pointer)finish();});
  root.ownerDocument.addEventListener('pointercancel',()=>{if(pointer)finish();});
  slider.addEventListener('keydown',event=>{if(enabled&&adjustmentKeys.has(event.key))keyboard=true;});
  slider.addEventListener('keyup',event=>{if(keyboard&&adjustmentKeys.has(event.key))finish();});
  slider.addEventListener('input',()=>request(Number(slider.value)));
  slider.addEventListener('change',()=>{if(!pointer&&!keyboard)finish();});
  slider.addEventListener('blur',()=>{if(pointer||keyboard)finish();});
  down.addEventListener('click',()=>{if(!down.disabled){request(selected-1);finish();}});
  up.addEventListener('click',()=>{if(!up.disabled){request(selected+1);finish();}});
  draw();return{update};
}
