// Operator-only loader for the same strict TypeScript used by Next.js.
// No credentials are printed; .env.local is loaded by Node before this runs.
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
load('src/lib/youtube-catalog.ts').syncOfficialCatalog(console.log).catch((error) => {
  console.error(error instanceof Error ? error.message : 'Catalog sync failed');
  process.exitCode = 1;
});
