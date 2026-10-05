// Operator-only exhaustive YouTube channel importer.
// Run with: node --env-file=.env.local scripts/sync-youtube-channel.cjs <channel-url-or-handle> [--title-contains "Official Karaoke"]
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

const channel = process.argv[2] || 'https://www.youtube.com/@smallroommusic.karaoke';
const titleFlagIndex = process.argv.indexOf('--title-contains');
const titleIncludes = titleFlagIndex >= 0
  ? process.argv[titleFlagIndex + 1]
  : (() => {
    try { return new URL(channel).searchParams.get('query') || undefined; }
    catch { return undefined; }
  })();
const force = process.argv.includes('--rescan');
load('src/lib/youtube-catalog.ts').syncYouTubeChannelUploads(channel, console.log, { titleIncludes, force })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'YouTube channel import failed');
    process.exitCode = 1;
  });
