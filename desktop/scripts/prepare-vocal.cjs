const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const parent=path.resolve(__dirname,'../vocal');
const target=path.join(parent,'runtime');
const configPath=path.resolve(__dirname,'../.vocal-build.json');
if(!fs.existsSync(configPath))throw new Error('Create desktop/.vocal-build.json with pythonBase, packages, directml and model paths before packaging Vocal Remover');
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if(hash(config.model)!=='8289784cda38543ff431add4070662813311a8cccfc0112ca82f76d9dba2b4ca')throw new Error('Vocal model integrity check failed');
for(const source of [path.join(config.pythonBase,'python.exe'),path.join(config.packages,'numpy'),path.join(config.packages,'scipy'),path.join(config.directml,'onnxruntime')])if(!fs.existsSync(source))throw new Error(`Missing vocal build input: ${source}`);
// This is the dedicated generated runtime only. Refuse symlinks or a changed parent.
if(fs.realpathSync(parent)!==path.resolve(parent)||path.basename(target)!=='runtime')throw new Error('Unsafe vocal runtime output');
if(fs.existsSync(target)){
 if(fs.lstatSync(target).isSymbolicLink()||fs.realpathSync(target)!==target||path.dirname(fs.realpathSync(target))!==fs.realpathSync(parent))throw new Error('Unsafe existing vocal runtime output');
 fs.rmSync(target,{recursive:true});
}
fs.mkdirSync(path.join(target,'python/Lib/site-packages'),{recursive:true});
const python=path.join(target,'python');
const skip=new Set(['site-packages','test','tests','__pycache__','idlelib','tkinter','turtledemo','ensurepip']);
fs.cpSync(path.join(config.pythonBase,'Lib'),path.join(python,'Lib'),{recursive:true,filter:source=>source===path.join(config.pythonBase,'Lib')||!skip.has(path.basename(source))});
fs.cpSync(path.join(config.pythonBase,'DLLs'),path.join(python,'DLLs'),{recursive:true});
for(const file of ['python.exe','python3.dll','python312.dll','vcruntime140.dll','vcruntime140_1.dll','LICENSE.txt'])fs.copyFileSync(path.join(config.pythonBase,file),path.join(python,file));
fs.writeFileSync(path.join(python,'python312._pth'),'.\nLib\nLib/site-packages\nDLLs\nimport site\n');
const packages=path.join(python,'Lib/site-packages');
const packageNames=['numpy','scipy','numpy.libs','scipy.libs','flatbuffers','packaging','coloredlogs','humanfriendly','sympy','mpmath','google'];
for(const name of fs.readdirSync(config.packages)){
 if(!packageNames.includes(name)&&!packageNames.some(prefix=>name.startsWith(prefix+'-')&&name.endsWith('.dist-info'))&&!name.startsWith('protobuf-'))continue;
 fs.cpSync(path.join(config.packages,name),path.join(packages,name),{recursive:true,filter:source=>path.basename(source)!=='__pycache__'});
}
for(const name of ['onnxruntime','onnxruntime_directml-1.24.4.dist-info'])fs.cpSync(path.join(config.directml,name),path.join(packages,name),{recursive:true,filter:source=>path.basename(source)!=='__pycache__'});
fs.copyFileSync(config.model,path.join(target,'UVR_MDXNET_Main.onnx'));
const info=JSON.parse(execFileSync(path.join(python,'python.exe'),['-c','import json,sys,numpy,scipy,onnxruntime as ort; from scipy.fft import rfft,irfft; print(json.dumps({"python":sys.version.split()[0],"prefix":sys.prefix,"numpy":numpy.__version__,"scipy":scipy.__version__,"ort":ort.__version__,"providers":ort.get_available_providers()}))'],{windowsHide:true,encoding:'utf8',env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:process.env.TEMP,TMP:process.env.TMP}}));
if(info.prefix!==python||!info.python.startsWith('3.12.')||info.numpy!=='2.2.6'||info.scipy!=='1.15.3'||info.ort!=='1.24.4'||!info.providers.includes('DmlExecutionProvider'))throw new Error('Portable runtime validation failed');
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({...info,modelSha256:hash(path.join(target,'UVR_MDXNET_Main.onnx'))},null,2));
console.log('Prepared isolated Python 3.12 / DirectML runtime and verified UVR model');
