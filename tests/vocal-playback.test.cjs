const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function load(){const module={exports:{}};const filename=path.resolve(__dirname,'../src/lib/vocal-playback.ts');const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInThisContext(`(function(module,exports){${code}\n})`,{filename})(module,module.exports);return module.exports;}
test('only the playing native MV queue item holds its delayed tail',()=>{
 const {getVocalPlaybackDelay}=load();const native={vocalRemoverEnabled:true,currentQueueItemId:'mv-1',currentVersionType:'mv',vocalRemoverDelayMs:4500};
 assert.equal(getVocalPlaybackDelay(native,'mv-1'),4500);
 for(const [state,id]of [[native,'mv-2'],[{...native,vocalRemoverEnabled:false},'mv-1'],[{...native,currentVersionType:'karaoke'},'mv-1'],[{...native,vocalRemoverDelayMs:Infinity},'mv-1'],[{...native,vocalRemoverDelayMs:6000},'mv-1']])assert.equal(getVocalPlaybackDelay(state,id),0);
});
test('source ended waits for the visible tail, duplicates cannot postpone it, and skip/disable cancel it',context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 const {DelayedPlaybackEnd}=load(),pending=new DelayedPlaybackEnd(),ended=[];
 pending.schedule('one',4500,()=>ended.push('one'));context.mock.timers.tick(2000);
 pending.schedule('one',4500,()=>ended.push('duplicate'));context.mock.timers.tick(2499);assert.deepEqual(ended,[]);
 context.mock.timers.tick(1);assert.deepEqual(ended,['one']);
 pending.schedule('two',4500,()=>ended.push('two'));context.mock.timers.tick(4400);pending.cancel();context.mock.timers.tick(1000);assert.deepEqual(ended,['one']);
 pending.schedule('three',0,()=>ended.push('three'));assert.deepEqual(ended,['one','three']);
});
