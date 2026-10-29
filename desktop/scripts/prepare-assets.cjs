const fs = require('node:fs');
const path = require('node:path');
const target = path.join(__dirname, '../audio/assets');
fs.mkdirSync(target, { recursive: true });
const files = ['pitch-corrector.mjs'];
// Remove known generated assets from older builds so packaging cannot retain
// processors that this app no longer supports. Never remove source modules.
for (const file of ['dsp-core.mjs', 'stft-center-suppressor.mjs', 'center-attenuation-processor.js', 'loudness-normalizer.mjs', 'loudness-normalizer-processor.js']) {
  const obsolete = path.join(target, file);
  if (fs.existsSync(obsolete)) fs.unlinkSync(obsolete);
}
for (const file of files) fs.copyFileSync(path.join(__dirname, '../../browser-extension', file), path.join(target, file));
console.log(`Prepared ${files.length} shared DSP modules`);
