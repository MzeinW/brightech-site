'use strict';
// Regenerates tests/fixtures/golden-index.html: the page the seed catalog must build to.
// Run it ONLY after an intentional change to the page template or the card markup, then review the diff before committing:
//   node tests/update-golden.js && git diff --stat tests/fixtures/golden-index.html
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../scripts/build.js');

const ROOT = path.resolve(__dirname, '..');
const SEED = path.join(ROOT, 'tests', 'fixtures', 'seed');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-golden-update-'));
try {
  build({ out, context: 'production', contentDir: path.join(SEED, 'products'), imagesDir: path.join(SEED, 'images') });
  fs.copyFileSync(path.join(out, 'index.html'), path.join(ROOT, 'tests', 'fixtures', 'golden-index.html'));
  console.log('updated tests/fixtures/golden-index.html');
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
