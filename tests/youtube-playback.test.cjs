const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTypeScriptModule(file) {
  const modules = new Map();

  function load(target) {
    const absolute = path.resolve(__dirname, '..', target);
    if (modules.has(absolute)) return modules.get(absolute).exports;

    const module = { exports: {} };
    modules.set(absolute, module);
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const localRequire = (name) => name.startsWith('.')
      ? load(path.resolve(path.dirname(absolute), `${name}.ts`))
      : require(name);
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: absolute })(localRequire, module, module.exports);
    return module.exports;
  }

  return load(file);
}

test('GMM Karaoke starts at 16 seconds only for its exact channel ID', () => {
  const {
    GMM_KARAOKE_START_SECONDS,
    getYouTubePlaybackStartSeconds,
  } = loadTypeScriptModule('src/lib/youtube-playback.ts');
  const {
    GMM_KARAOKE_CHANNEL_ID,
    OFFICIAL_YOUTUBE_CHANNELS,
  } = loadTypeScriptModule('src/lib/official-youtube-channels.ts');
  const otherOfficialChannel = OFFICIAL_YOUTUBE_CHANNELS.find(
    ({ channelId }) => channelId !== GMM_KARAOKE_CHANNEL_ID
  );

  assert.equal(GMM_KARAOKE_START_SECONDS, 16);
  assert.equal(getYouTubePlaybackStartSeconds(GMM_KARAOKE_CHANNEL_ID), 16);
  assert.equal(getYouTubePlaybackStartSeconds('impersonator'), 0);
  assert.equal(getYouTubePlaybackStartSeconds(otherOfficialChannel.channelId), 0);
  assert.equal(getYouTubePlaybackStartSeconds(undefined), 0);
  assert.equal(getYouTubePlaybackStartSeconds(GMM_KARAOKE_CHANNEL_ID.toLowerCase()), 0);
});
