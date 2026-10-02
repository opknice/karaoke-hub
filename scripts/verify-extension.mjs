import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'browser-extension');
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.minimum_chrome_version, '116');
assert.ok(manifest.permissions.includes('tabCapture'));
assert.ok(manifest.permissions.includes('offscreen'));
assert.ok(!manifest.host_permissions.includes('<all_urls>'));

const requiredFiles = [
  manifest.background.service_worker,
  'content-script.js',
  'offscreen.html',
  'offscreen.js',
  'center-attenuation-processor.js',
  'loudness-normalizer-processor.js',
  'loudness-normalizer.mjs',
  'dsp-core.mjs',
  'stft-center-suppressor.mjs',
  'messages.mjs',
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(root, file)), `Missing extension file: ${file}`);
}

console.log('Extension manifest and required files are valid.');
