'use strict';
// Golden test: the frozen seed catalog (the original 23 products) must build to a reviewed page, byte for byte.
// The first snapshot equalled the live page of 2026-10-23 except for the restored quote-form attributes (see git history).
// After an intentional template or card change: node tests/update-golden.js, then review the diff.
// Run: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { build } = require('../scripts/build.js');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const SEED = path.join(FIX, 'seed');
const manifest = JSON.parse(fs.readFileSync(path.join(FIX, 'live-manifest.json'), 'utf8'));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-golden-'));
const result = build({ out, context: 'production', contentDir: path.join(SEED, 'products'), imagesDir: path.join(SEED, 'images') });

test('index.html equals the reviewed snapshot byte-for-byte', () => {
  const expected = fs.readFileSync(path.join(FIX, 'golden-index.html'));
  const built = fs.readFileSync(path.join(out, 'index.html'));
  if (Buffer.compare(built, expected) !== 0) {
    let i = 0; while (i < built.length && built[i] === expected[i]) i++;
    assert.fail('first difference at byte ' + i + ': built ' + JSON.stringify(built.subarray(Math.max(0, i - 40), i + 60).toString('utf8')) + ' vs expected ' + JSON.stringify(expected.subarray(Math.max(0, i - 40), i + 60).toString('utf8')) + ' (intentional? run node tests/update-golden.js and review the diff)');
  }
});

test('every other live file is carried over byte-for-byte', () => {
  for (const [rel, hash] of Object.entries(manifest.files)) {
    if (rel === 'index.html') continue;
    const p = path.join(out, rel);
    assert.ok(fs.existsSync(p), 'missing from dist: ' + rel);
    assert.equal(sha(fs.readFileSync(p)), hash, 'content differs: ' + rel);
  }
});

test('dist contains nothing unexpected', () => {
  const allowed = new Set(Object.keys(manifest.files));
  const extra = result.files.filter((f) => !allowed.has(f) && f !== '_headers' && !f.startsWith('admin/'));
  assert.deepEqual(extra, [], 'unexpected files in dist');
});

test('the quote form is detectable by Netlify and has exactly one form-name field', () => {
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.equal((html.match(/<form [^>]*data-netlify='true'/g) || []).length, 1);
  assert.equal((html.match(/name="form-name"/g) || []).length, 1);
  assert.ok(!html.includes('<!--@CATALOG_CARDS@-->'), 'marker must be replaced');
});

// The repo copy equals the production function except one anonymised comment line (see function_note in the manifest).
test('the form-email function is unchanged (recorded hash; code identical to production)', () => {
  assert.equal(sha(fs.readFileSync(path.join(ROOT, 'netlify', 'functions', 'submission-created.js'))), manifest.function_sha256);
});

test('seed content: 23 products, all published', () => {
  assert.equal(result.total, 23);
  assert.equal(result.visible, 23);
  assert.deepEqual(result.hidden, []);
});

test.after(() => fs.rmSync(out, { recursive: true, force: true }));
