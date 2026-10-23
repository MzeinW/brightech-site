'use strict';
// Golden test: the seed content must rebuild today's live site exactly.
// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { build } = require('../scripts/build.js');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const manifest = JSON.parse(fs.readFileSync(path.join(FIX, 'live-manifest.json'), 'utf8'));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// The only intended difference from the served page: the quote form regains the attributes Netlify
// strips from deployed HTML, so Netlify keeps detecting the form on every git-built deploy.
const FORM_OLD = "<form aria-label='Request wholesale pricing' class='quote-form reveal' id='quoteForm' method='POST' name='quote' novalidate>";
const FORM_NEW = "<form aria-label='Request wholesale pricing' class='quote-form reveal' data-netlify='true' data-netlify-honeypot='bot-field' id='quoteForm' method='POST' name='quote' novalidate>";

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-golden-'));
const result = build({ out });

test('index.html equals the live page byte-for-byte, apart from the restored form attributes', () => {
  const live = fs.readFileSync(path.join(FIX, 'live-index.html'), 'utf8');
  assert.equal(sha(Buffer.from(live, 'utf8')), manifest.files['index.html'], 'fixture is the recorded live page');
  assert.equal(live.split(FORM_OLD).length, 2, 'form tag occurs once in the live page');
  const expected = Buffer.from(live.replace(FORM_OLD, () => FORM_NEW), 'utf8');
  const built = fs.readFileSync(path.join(out, 'index.html'));
  if (Buffer.compare(built, expected) !== 0) {
    let i = 0; while (i < built.length && built[i] === expected[i]) i++;
    assert.fail('first difference at byte ' + i + ': built ' + JSON.stringify(built.subarray(Math.max(0, i - 40), i + 60).toString('utf8')) + ' vs expected ' + JSON.stringify(expected.subarray(Math.max(0, i - 40), i + 60).toString('utf8')));
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

test('the form-email function is byte-identical to the one in production', () => {
  assert.equal(sha(fs.readFileSync(path.join(ROOT, 'netlify', 'functions', 'submission-created.js'))), manifest.function_sha256);
});

test('seed content: 23 products, all published', () => {
  assert.equal(result.total, 23);
  assert.equal(result.visible, 23);
  assert.deepEqual(result.hidden, []);
});

test.after(() => fs.rmSync(out, { recursive: true, force: true }));
