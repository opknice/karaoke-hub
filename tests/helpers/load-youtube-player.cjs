const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function loadPlayer(overrides,globals){
 const modules=new Map();
 function load(file){
  const filename=path.resolve(__dirname,'../..',file);if(modules.has(filename))return modules.get(filename).exports;
  const module={exports:{}};modules.set(filename,module);
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const localRequire=name=>Object.hasOwn(overrides,name)?overrides[name]:name.startsWith('@/')?load(`src/${name.slice(2)}.ts`):name.startsWith('.')?load(path.resolve(path.dirname(filename),`${name}.ts`)):require(name);
  vm.runInNewContext(code,{module,exports:module.exports,require:localRequire,console,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,Date,...globals},{filename});return module.exports;
 }
 return load('src/components/YouTubePlayer.tsx').YouTubePlayer;
}

module.exports={loadPlayer};
