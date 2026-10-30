const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {VOCAL_MODEL_IDS,getVocalModel}=require('../lib/vocal-models.cjs');
function validateVocalModels(config){
  const files={fast:config.model,hq5:config.hqModel};
  for(const id of VOCAL_MODEL_IDS)if(typeof files[id]!=='string'||!files[id])throw new Error(`Missing ${id} model build input`);
  return VOCAL_MODEL_IDS.map(id=>{
    const profile=getVocalModel(id),file=path.resolve(files[id]);
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.statSync(file).size!==profile.bytes
      ||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==profile.sha256)throw new Error(`Vocal model integrity check failed: ${id}`);
    return{profile,file};
  });
}
function assertBuildSourcesOutsideTarget(sources,target){
  const output=fs.existsSync(target)?fs.realpathSync(target):path.resolve(target);
  for(const source of sources){
    const resolved=fs.realpathSync(source),relative=path.relative(output,resolved);
    if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new Error('Build input cannot be inside generated runtime output');
  }
}
module.exports={validateVocalModels,assertBuildSourcesOutsideTarget};
