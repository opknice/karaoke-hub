const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const MODEL_SHA='8289784cda38543ff431add4070662813311a8cccfc0112ca82f76d9dba2b4ca';
const epochValid=n=>Number.isSafeInteger(n)&&n>0&&n<2**31;
const sequenceValid=n=>Number.isSafeInteger(n)&&n>=0&&n<2**31;
const finitePcm=pcm=>{for(const sample of pcm)if(!Number.isFinite(sample))return false;return true;};

class VocalWorker {
  constructor({paths,spawn:spawnWorker=spawn,onReady=()=>{},onResult=()=>{},onFailure=()=>{}}) {
    this.paths=paths;this.spawnWorker=spawnWorker;this.onReady=onReady;this.onResult=onResult;this.onFailure=onFailure;
    this.ready=false;this.child=null;this.epoch=0;this.pending=new Map();this.closed=false;this.buffer='';
  }
  start() {
    if(this.child)return;
    this.closed=false;this.buffer='';
    if(!Object.values(this.paths).every(file=>typeof file==='string'&&fs.existsSync(file))) {
      this.fail('ไม่พบไฟล์ระบบ AI กรุณาติดตั้งโปรแกรมรุ่นที่มี Vocal Remover',true);return;
    }
    const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:process.env.TEMP,TMP:process.env.TMP,
      PATH:path.dirname(this.paths.python),PYTHONIOENCODING:'utf-8',PYTHONNOUSERSITE:'1',OMP_NUM_THREADS:'2',OPENBLAS_NUM_THREADS:'2'};
    try {this.child=this.spawnWorker(this.paths.python,[this.paths.worker,'--model',this.paths.model],{windowsHide:true,stdio:['pipe','pipe','pipe'],cwd:path.dirname(this.paths.worker),env});}
    catch(error){this.fail(error.message,true);return;}
    const child=this.child;
    this.startTimer=setTimeout(()=>this.fail('เตรียมระบบ AI ไม่สำเร็จ กรุณาลองเปิดโปรแกรมใหม่',true),30000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',data=>{
      if(this.child!==child)return;
      this.buffer+=data;
      let end;
      try {
        while((end=this.buffer.indexOf('\n'))>=0) {
          if(end>1024*1024)throw new Error('AI packet size limit exceeded');
          const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);
          this.receive(JSON.parse(line));
          if(this.child!==child)return;
        }
        if(this.buffer.length>1024*1024)throw new Error('AI packet size limit exceeded');
      }catch(error){this.fail(error.message,true);}
    });
    child.stderr.on('data',()=>{}); // Worker errors have bounded structured messages on stdout.
    child.stdin.on('error',error=>{if(this.child===child&&!this.closed)this.fail(error.message,true);});
    child.on('error',error=>{if(this.child===child)this.fail(error.message,true);});
    child.on('exit',()=>{if(this.child===child&&!this.closed)this.fail('ระบบ AI หยุดทำงาน กรุณาเปิดโปรแกรมใหม่',true);});
  }
  clearPending() {for(const timer of this.pending.values())clearTimeout(timer);this.pending.clear();}
  fail(message,fatal=false) {
    this.streamFailed=true;
    this.clearPending();
    if(fatal) {
      clearTimeout(this.startTimer);this.ready=false;
      const child=this.child;this.child=null;child?.kill();
    }
    this.onFailure({message:String(message).slice(0,500),fatal,epoch:this.epoch});
  }
  receive(packet) {
    if(!packet||typeof packet!=='object'||Array.isArray(packet))throw new Error('Invalid AI packet');
    if(packet.type==='ready') {
      if(this.ready||packet.provider!=='DirectML'||packet.modelSha256!==MODEL_SHA||typeof packet.denoise!=='boolean'
        ||typeof packet.name!=='string'||packet.name.length>120||!Number.isFinite(packet.onePassMs)||packet.onePassMs<0||packet.onePassMs>800
        ||!Number.isFinite(packet.twoPassMs)||packet.twoPassMs<0||packet.twoPassMs>10000)throw new Error('AI readiness validation failed');
      clearTimeout(this.startTimer);this.ready=true;this.onReady(packet);return;
    }
    if(packet.type==='fatal'){this.fail(packet.error||'AI initialization failed',true);return;}
    if(packet.type==='error') {
      if(packet.epoch===this.epoch)this.fail(packet.error||'AI streaming failed');
      return;
    }
    if(packet.type!=='result'||!epochValid(packet.epoch)||!sequenceValid(packet.sequence))throw new Error('Invalid AI result header');
    if(packet.epoch!==this.epoch||this.streamFailed)return;
    const key=`${packet.epoch}:${packet.sequence}`;
    if(!this.pending.has(key))throw new Error('Unexpected AI result sequence');
    clearTimeout(this.pending.get(key));this.pending.delete(key);
    if(packet.frames===0)return;
    if(!Number.isSafeInteger(packet.startFrame)||packet.startFrame<0||!Number.isSafeInteger(packet.frames)||packet.frames<1||packet.frames>55124
      ||typeof packet.pcm!=='string'||packet.pcm.length!==4*Math.ceil(packet.frames*8/3)
      ||!Number.isFinite(packet.computeMs)||packet.computeMs<0||packet.computeMs>10000)throw new Error('Invalid AI result span');
    const bytes=Buffer.from(packet.pcm,'base64');
    if(bytes.length!==packet.frames*8||bytes.toString('base64')!==packet.pcm)throw new Error('Invalid AI PCM encoding');
    const pcm=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    if(!finitePcm(pcm))throw new Error('Non-finite AI output');
    this.onResult({...packet,pcm});
  }
  reset(epoch) {
    if(!epochValid(epoch))throw new Error('Invalid AI epoch');
    this.epoch=epoch;this.streamFailed=false;this.clearPending();
    if(this.ready)this.child.stdin.write(JSON.stringify({type:'reset',epoch})+'\n');
  }
  feed({epoch,sequence,pcm}) {
    if(!this.ready||this.streamFailed||epoch!==this.epoch||!sequenceValid(sequence)||!(pcm instanceof Float32Array)||pcm.length!==88200||!finitePcm(pcm))return false;
    if(this.pending.size>=2||this.child.stdin.writableLength>1024*1024){this.fail('AI ประมวลผลไม่ทันเพลง กรุณาลองเปิดใหม่');return false;}
    const key=`${epoch}:${sequence}`;
    if(this.pending.has(key))return false;
    this.pending.set(key,setTimeout(()=>this.fail('AI ใช้เวลานานเกินไป จึงกลับไปใช้เสียงต้นฉบับ'),2500));
    const encoded=Buffer.from(pcm.buffer,pcm.byteOffset,pcm.byteLength).toString('base64');
    this.child.stdin.write(JSON.stringify({type:'pcm',epoch,sequence,sampleRate:44100,pcm:encoded})+'\n');
    return true;
  }
  stop() {
    this.closed=true;this.ready=false;clearTimeout(this.startTimer);this.clearPending();
    const child=this.child;this.child=null;child?.kill();
  }
}
module.exports={VocalWorker};
