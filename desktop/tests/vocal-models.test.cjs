const {test}=require('node:test');const assert=require('node:assert/strict');
test('model registry retains Fast timing and rejects unknown or path-like selections',()=>{
 const {getVocalModel}=require('../lib/vocal-models.cjs');
 const fast=getVocalModel('fast');assert.equal(fast.delayMs,4500);assert.equal(fast.startupDeadlineMs,5000);assert.equal(fast.stem,'Vocals');
 assert.equal(fast.sha256,'8289784cda38543ff431add4070662813311a8cccfc0112ca82f76d9dba2b4ca');assert.ok(Object.isFrozen(fast));
 for(const id of ['other','../hq5','https://example.com/model.onnx',null,{},1])assert.throws(()=>getVocalModel(id),/model|profile/i);
});
test('HQ registry binds finalized Instrumental output to the verified model and longer delay',()=>{
 const {getVocalModel}=require('../lib/vocal-models.cjs');const hq=getVocalModel('hq5');
 assert.equal(hq.delayMs,8000);assert.equal(hq.startupDeadlineMs,10000);assert.equal(hq.stem,'Instrumental');assert.equal(hq.spanMode,'final');
 assert.equal(hq.fft,5120);assert.equal(hq.bins,2560);assert.equal(hq.compensation,1.01);assert.equal(hq.requiresDenoise,true);assert.equal(hq.maxResultFrames,65280);
});
