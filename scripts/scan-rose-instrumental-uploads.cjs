// Operator-only exhaustive scan of Rose Media's uploads playlist.
// The strict TypeScript implementation handles validation and deduplication.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const modules = new Map();
function load(file) {
  const absolute = path.resolve(__dirname, '..', file);
  if (modules.has(absolute)) return modules.get(absolute).exports;
  const module = { exports: {} };
  modules.set(absolute, module);
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => name === 'server-only' ? {} : name.startsWith('.')
    ? load(path.resolve(path.dirname(absolute), `${name}.ts`)) : require(name);
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: absolute })(localRequire, module, module.exports);
  return module.exports;
}

load('src/lib/youtube-catalog.ts').scanRoseInstrumentalUploads(console.log)
  .then((result) => console.log(`สรุป: สแกน ${result.videosScanned}, บันทึก ${result.videosImported}, หน้า ${result.pages}${result.truncated ? ' (มี Uploads เกิน 5,000 รายการ)' : ''}`))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Rose uploads scan failed');
    process.exitCode = 1;
  });
