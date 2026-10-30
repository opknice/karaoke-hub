const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {getVocalModel}=require('./vocal-models.cjs');
class VocalModelSettings {
  constructor(file){this.file=file;}
  read(){
    try{if(fs.statSync(this.file).size>512)return 'fast';return getVocalModel(JSON.parse(fs.readFileSync(this.file,'utf8')).modelId).id;}catch{return 'fast';}
  }
  write(id){
    const modelId=getVocalModel(id).id;
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    const temporary=`${this.file}.${randomUUID()}.tmp`;
    try{fs.writeFileSync(temporary,JSON.stringify({modelId})+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,this.file);}
    finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  }
}
module.exports={VocalModelSettings};
