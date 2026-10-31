import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVocalLevelControl} from '../ui/vocal-level.mjs';

class Element extends EventTarget{value='0';disabled=false;textContent='';attributes={};setAttribute(k,v){this.attributes[k]=v;}}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 const slider=new Element(),output=new Element(),down=new Element(),up=new Element(),doc=new EventTarget();const nodes={input:slider,output,'[data-level-down]':down,'[data-level-up]':up};
 const sent=[],errors=[];let focuses=0;
 const control=createVocalLevelControl({root:{ownerDocument:doc,querySelector:key=>nodes[key]},send:level=>new Promise(resolve=>sent.push({level,resolve})),focus:()=>{focuses++;},onError:error=>errors.push(error)});
 const state={supportsContinuousVocal:true,vocalBufferActive:true,captureStatus:'capturing_original',vocalRemoverEligible:true,vocalRemoverEnabled:true,vocalRuntimeStatus:'ready',vocalLevel:0,vocalLevelRevision:0};control.update(state);
 const emit=(target,type,extra={})=>{const e=new Event(type);Object.assign(e,extra);target.dispatchEvent(e);};const input=level=>{slider.value=String(level);emit(slider,'input');};
 return{control,slider,output,down,up,doc,sent,errors,state,input,emit,get focuses(){return focuses;}};
}
test('rapid drag has one in-flight and one latest pending level; old state cannot overwrite newer intent',async()=>{
 const s=setup();s.emit(s.slider,'pointerdown');s.input(10);s.input(20);s.input(90);assert.deepEqual(s.sent.map(p=>p.level),[10]);assert.equal(s.output.textContent,'90%');assert.equal(s.focuses,0);
 s.control.update({...s.state,vocalLevel:10,vocalLevelRevision:1});assert.equal(s.output.textContent,'90%');s.sent[0].resolve({ok:true,state:{...s.state,vocalLevel:10,vocalLevelRevision:1}});await turn();assert.deepEqual(s.sent.map(p=>p.level),[10,90]);assert.equal(s.output.textContent,'90%');
 s.emit(s.doc,'pointerup');assert.equal(s.focuses,0);s.sent[1].resolve({ok:true,state:{...s.state,vocalLevel:90,vocalLevelRevision:2}});await turn();assert.equal(s.focuses,1);s.control.update({...s.state,vocalLevel:10,vocalLevelRevision:1});assert.equal(s.output.textContent,'90%');
});
test('buttons step exactly one percent with correct bounds; held keyboard changes finish focus on key release',async()=>{
 const s=setup();assert.equal(s.down.disabled,true);s.emit(s.up,'click');assert.equal(s.sent[0].level,1);s.sent[0].resolve({ok:true,state:{...s.state,vocalLevel:1,vocalLevelRevision:1}});await turn();assert.equal(s.focuses,1);
 s.emit(s.slider,'keydown',{key:'ArrowRight'});s.input(100);s.emit(s.slider,'change');s.sent[1].resolve({ok:true,state:{...s.state,vocalLevel:100,vocalLevelRevision:2}});await turn();assert.equal(s.focuses,1);assert.equal(s.up.disabled,true);s.emit(s.slider,'keyup',{key:'ArrowRight'});assert.equal(s.focuses,2);
});
test('Stop cancels pending drag work and late responses; disabled controls issue no new commands',async()=>{
 const s=setup();s.emit(s.slider,'pointerdown');s.input(20);s.input(80);s.control.update({...s.state,vocalBufferActive:false,vocalRemoverEnabled:false});assert.equal(s.slider.disabled,true);
 s.sent[0].resolve({ok:true,state:{...s.state,vocalLevel:20,vocalLevelRevision:1}});await turn();assert.equal(s.sent.length,1);assert.equal(s.focuses,0);s.emit(s.up,'click');assert.equal(s.sent.length,1);
});
test('latest failed request restores acknowledged selection and reports error without a retry storm',async()=>{
 const s=setup();s.input(75);s.emit(s.slider,'change');s.sent[0].resolve({ok:false,error:'Audio unavailable',state:s.state});await turn();assert.equal(s.output.textContent,'0%');assert.deepEqual(s.errors,['Audio unavailable']);assert.equal(s.focuses,1);assert.equal(s.sent.length,1);
});
