const {test}=require('node:test'),assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test('packaging requires both model inputs before staging can remove its old runtime',()=>{
 const {validateVocalModels}=require('../scripts/vocal-build-inputs.cjs');assert.throws(()=>validateVocalModels({model:'not-used.onnx'}),/hq5|HQ5/);
});
test('packaging refuses an unverified model and sources inside its generated output',()=>{
 const {validateVocalModels,assertBuildSourcesOutsideTarget}=require('../scripts/vocal-build-inputs.cjs');const folder=fs.mkdtempSync(path.join(os.tmpdir(),'karaoke-build-validation-'));
 try{const input=path.join(folder,'invalid.onnx');fs.writeFileSync(input,'unverified');assert.throws(()=>validateVocalModels({model:input,hqModel:input}),/integrity|model/i);
 const target=path.join(folder,'runtime');fs.mkdirSync(target);const inside=path.join(target,'input');fs.writeFileSync(inside,'retain');assert.throws(()=>assertBuildSourcesOutsideTarget([inside],target),/output|runtime/i);assert.equal(fs.readFileSync(inside,'utf8'),'retain');assert.doesNotThrow(()=>assertBuildSourcesOutsideTarget([input],target));
 }finally{assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));fs.rmSync(folder,{recursive:true});}
});
test('the generated audio registry matches the native/Python canonical profiles',()=>{
 const canonical=require('../vocal/models.json'),audio=JSON.parse(fs.readFileSync(path.join(__dirname,'../audio/assets/vocal-models.json'),'utf8'));assert.deepEqual(audio,canonical);
});
