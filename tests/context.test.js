'use strict';
// Build modes: production (and a plain local build) ship no backoffice and a live quote form;
// Netlify previews (branch-deploy / deploy-preview) ship the backoffice and an inert quote form.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, verifyOutput, BuildError } = require('../scripts/build.js');

const ROOT = path.resolve(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bt-ctx-'));
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const exists = (dir, f) => fs.existsSync(path.join(dir, f));
const cards = (html) => (html.match(/<a class="prod reveal"/g) || []).length;
const done = (dir) => test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('production: no backoffice, no _headers, quote form live', () => {
  const out = tmp(); done(out);
  const r = build({ out, context: 'production' });
  assert.equal(r.mode.adminIncluded, false);
  assert.equal(r.mode.formLive, true);
  assert.ok(!exists(out, 'admin'), 'admin/ must not ship to production');
  assert.ok(!exists(out, '_headers'));
  assert.match(read(out, 'index.html'), /<form [^>]*data-netlify='true'/);
});

test('a plain local build (no CONTEXT) behaves like production, so a local --prod deploy cannot publish the backoffice', () => {
  const out = tmp(); done(out);
  const saved = { CONTEXT: process.env.CONTEXT, BT: process.env.BT_INCLUDE_ADMIN };
  delete process.env.CONTEXT; delete process.env.BT_INCLUDE_ADMIN;
  try {
    const r = build({ out });
    assert.equal(r.mode.adminIncluded, false);
    assert.equal(r.mode.formLive, true);
    assert.ok(!exists(out, 'admin'));
  } finally { if (saved.CONTEXT !== undefined) process.env.CONTEXT = saved.CONTEXT; if (saved.BT !== undefined) process.env.BT_INCLUDE_ADMIN = saved.BT; }
});

test('branch-deploy (staging): backoffice + headers included, quote form inert, same cards', () => {
  const out = tmp(); done(out);
  const r = build({ out, context: 'branch-deploy' });
  assert.equal(r.mode.adminIncluded, true);
  assert.equal(r.mode.formLive, false);
  for (const f of ['admin/index.html', 'admin/config.yml', 'admin/vendor/sveltia-cms.js', 'admin/vendor/chunks/git.js', '_headers']) assert.ok(exists(out, f), 'missing ' + f);
  const html = read(out, 'index.html');
  assert.doesNotMatch(html, /data-netlify/, 'a preview must not register the quote form');
  assert.equal((html.match(/name="form-name"/g) || []).length, 1);
  assert.equal(cards(html), 23);
  assert.match(read(out, '_headers'), /^\/admin\/\*\s*$/m);
  assert.ok(r.warnings.some((w) => w.includes('OWNER/REPO')), 'unconfigured repository is flagged');
});

test('deploy-preview behaves like branch-deploy', () => {
  const out = tmp(); done(out);
  const r = build({ out, context: 'deploy-preview' });
  assert.equal(r.mode.adminIncluded, true);
  assert.equal(r.mode.formLive, false);
});

test('BT_INCLUDE_ADMIN=1 previews the backoffice locally without touching the form', () => {
  const out = tmp(); done(out);
  const saved = { CONTEXT: process.env.CONTEXT, BT: process.env.BT_INCLUDE_ADMIN };
  delete process.env.CONTEXT; process.env.BT_INCLUDE_ADMIN = '1';
  try {
    const r = build({ out });
    assert.equal(r.mode.adminIncluded, true);
    assert.equal(r.mode.formLive, true);
    assert.ok(exists(out, 'admin/index.html'));
  } finally { if (saved.CONTEXT !== undefined) process.env.CONTEXT = saved.CONTEXT; if (saved.BT === undefined) delete process.env.BT_INCLUDE_ADMIN; else process.env.BT_INCLUDE_ADMIN = saved.BT; }
});

test('the production and preview pages differ only by the two form attributes', () => {
  const a = tmp(), b = tmp(); done(a); done(b);
  build({ out: a, context: 'production' });
  build({ out: b, context: 'branch-deploy' });
  assert.equal(read(a, 'index.html').replace(" data-netlify='true' data-netlify-honeypot='bot-field'", ''), read(b, 'index.html'));
});

test('a static _headers file conflicts with the generated backoffice headers', () => {
  const out = tmp(); done(out);
  const staticDir = path.join(out, '..', path.basename(out) + '-static'); done(staticDir);
  fs.cpSync(path.join(ROOT, 'src', 'static'), staticDir, { recursive: true });
  fs.writeFileSync(path.join(staticDir, '_headers'), '/*\n  X-Test: 1\n');
  assert.throws(() => build({ out, staticDir, context: 'branch-deploy' }), (e) => e instanceof BuildError && e.errors.some((m) => m.includes('_headers already exists')));
});

test('output check: admin files in a production output are rejected', () => {
  const dir = tmp(); done(dir);
  build({ out: dir, context: 'production' });
  fs.mkdirSync(path.join(dir, 'admin'));
  fs.writeFileSync(path.join(dir, '_headers'), '/admin/*\n');
  const problems = verifyOutput(dir, ROOT, path.join(ROOT, 'netlify', 'functions'), 23, { formLive: true, adminIncluded: false });
  assert.ok(problems.some((m) => m.includes('admin/') && m.includes('production')));
  assert.ok(problems.some((m) => m.includes('_headers')));
});

test('output check: a preview output that still registers the form is rejected', () => {
  const dir = tmp(); done(dir);
  build({ out: dir, context: 'production' });
  const problems = verifyOutput(dir, ROOT, path.join(ROOT, 'netlify', 'functions'), 23, { formLive: false, adminIncluded: false });
  assert.ok(problems.some((m) => m.includes('must not register the quote form')));
});
