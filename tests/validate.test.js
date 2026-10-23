'use strict';
// Bad data must fail the build (so nothing is published); odd-but-legal data must render safely.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, loadProducts, renderCard, duplicateSkus, BuildError } = require('../scripts/build.js');

const ROOT = path.resolve(__dirname, '..');
const IMAGES = path.join(ROOT, 'images');

/** copy the seed content to a temp folder, let the test change it, return the paths */
function sandbox(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-val-'));
  const content = path.join(dir, 'products');
  fs.mkdirSync(content);
  for (const f of fs.readdirSync(path.join(ROOT, 'content', 'products'))) fs.copyFileSync(path.join(ROOT, 'content', 'products', f), path.join(content, f));
  const api = {
    dir, content,
    read: (sku) => JSON.parse(fs.readFileSync(path.join(content, sku + '.json'), 'utf8')),
    write: (sku, obj) => fs.writeFileSync(path.join(content, sku + '.json'), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)),
    remove: (sku) => fs.rmSync(path.join(content, sku + '.json')),
    edit: (sku, fn) => { const o = api.read(sku); fn(o); api.write(sku, o); },
    build: () => build({ contentDir: content, imagesDir: IMAGES, out: path.join(dir, 'dist') }),
    errors: () => loadProducts(content, IMAGES).errors,
  };
  if (mutate) mutate(api);
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return api;
}
const hasError = (errors, text) => assert.ok(errors.some((e) => e.includes(text)), 'expected an error containing "' + text + '", got: ' + JSON.stringify(errors));

test('rejects a malformed SKU', () => { const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { o.sku = 'bt-aud-204'; })); hasError(s.errors(), 'sku must look like'); });
test('rejects a file name that differs from the SKU', () => { const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { o.sku = 'BT-AUD-999'; })); hasError(s.errors(), 'file name must be BT-AUD-999.json'); });
test('rejects an unknown category', () => { const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { o.category = 'phones'; })); hasError(s.errors(), 'category must be one of'); });
test('rejects a missing image file', () => { const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { o.image = '/images/does-not-exist.webp'; })); hasError(s.errors(), 'image file not found'); });
test('rejects an image whose letter case differs (Netlify is case-sensitive)', () => { const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { o.image = '/images/bt-aud-204.webp'; })); hasError(s.errors(), 'image file not found'); });
test('rejects an image path that is not under /images/', () => { const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { o.image = 'https://evil.example/x.webp'; })); hasError(s.errors(), 'image must look like'); });
test('rejects an empty or whitespace-only name', () => { const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { o.name = '   '; })); hasError(s.errors(), 'name must not be empty'); });
test('rejects a missing name', () => { const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { delete o.name; })); hasError(s.errors(), 'name is required'); });
test('rejects an over-long name', () => { const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { o.name = 'x'.repeat(81); })); hasError(s.errors(), 'longer than 80'); });
test('rejects control characters in the name', () => { const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { o.name = 'JBL\nTune'; })); hasError(s.errors(), 'control characters'); });
test('rejects visible given as a string', () => { const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { o.visible = 'false'; })); hasError(s.errors(), 'visible must be true or false'); });
test('rejects a fractional order', () => { const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { o.order = 1.5; })); hasError(s.errors(), 'order must be a whole number'); });
test('rejects malformed JSON', () => { const s = sandbox((s) => s.write('BT-AUD-204', '{ "sku": ')); hasError(s.errors(), 'invalid JSON'); });
test('rejects a JSON array', () => { const s = sandbox((s) => s.write('BT-AUD-204', '[]')); hasError(s.errors(), 'must be a JSON object'); });

test('a single bad product fails the whole build and writes no dist', () => {
  const s = sandbox((s) => s.edit('BT-GAM-510', (o) => { o.category = 'nope'; }));
  assert.throws(() => s.build(), BuildError);
  assert.ok(!fs.existsSync(path.join(s.dir, 'dist')), 'dist must not be created on failure');
});

test('refuses to publish when (almost) everything is hidden', () => {
  const s = sandbox((s) => { for (const f of fs.readdirSync(s.content)) { const sku = f.replace('.json', ''); s.edit(sku, (o) => { o.visible = false; }); } });
  assert.throws(() => s.build(), (e) => e instanceof BuildError && e.errors.some((m) => m.includes('at least 5 required')));
});

test('hidden products are excluded; new products without an order go last; order then SKU sorts', () => {
  const s = sandbox((s) => {
    s.edit('BT-AUD-204', (o) => { o.visible = false; });
    s.write('BT-AUD-999', { sku: 'BT-AUD-999', name: 'New Item', category: 'audio', image: '/images/BT-AUD-206.webp', visible: true });
    s.edit('BT-GAM-510', (o) => { o.order = 1; });
  });
  const r = s.build();
  assert.equal(r.visible, 23); // 23 - 1 hidden + 1 new
  assert.deepEqual(r.hidden, ['BT-AUD-204']);
  const html = fs.readFileSync(path.join(s.dir, 'dist', 'index.html'), 'utf8');
  const skus = [...html.matchAll(/<span class="psku">SKU \u00B7 (BT-[A-Z]{3}-\d{3})<\/span>/g)].map((m) => m[1]);
  assert.equal(skus[0], 'BT-GAM-510', 'lowest order first');
  assert.equal(skus[skus.length - 1], 'BT-AUD-999', 'no order => last');
  assert.ok(!skus.includes('BT-AUD-204'), 'hidden product must not be rendered');
  assert.ok(r.warnings.some((w) => w.includes('BT-AUD-999') && w.includes('same image')), 'shared image is flagged');
});

test('special characters are escaped and "$" sequences are not interpreted', () => {
  const nasty = 'Tom & "Jerry" <b>x</b> $& $1 $$';
  const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { o.name = nasty; }));
  s.build();
  const html = fs.readFileSync(path.join(s.dir, 'dist', 'index.html'), 'utf8');
  // "$&" would be replaced by the matched marker if the build used a plain replacement string; its "&" is HTML-escaped, the "$" is not
  assert.ok(html.includes('Tom &amp; &quot;Jerry&quot; &lt;b&gt;x&lt;/b&gt; $&amp; $1 $$'), 'name appears escaped, "$" untouched');
  assert.ok(!html.includes('CATALOG_CARDS'), 'a "$&" in product text must not re-insert the marker');
  assert.ok(!html.includes('<b>x</b>'), 'no raw markup from product data');
  assert.ok(!html.includes('<!--@CATALOG_CARDS@-->'));
  assert.equal(renderCard({ name: 'A"B', category: 'audio', image: '/images/a.webp', sku: 'BT-AUD-001' }).includes('alt="A&quot;B"'), true);
});

test('unknown extra fields are warnings, not errors', () => {
  const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { o.price = 5; }));
  const r = loadProducts(s.content, IMAGES);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.includes('unknown field ignored: price')));
});

test('a template without the marker fails the build', () => {
  const s = sandbox();
  const tpl = path.join(s.dir, 'template.html');
  fs.writeFileSync(tpl, fs.readFileSync(path.join(ROOT, 'src', 'index.template.html'), 'utf8').replace('<!--@CATALOG_CARDS@-->', ''));
  assert.throws(() => build({ contentDir: s.content, imagesDir: IMAGES, templatePath: tpl, out: path.join(s.dir, 'dist') }), (e) => e.errors.some((m) => m.includes('marker')));
});

test('a template whose form lost data-netlify fails the build', () => {
  const s = sandbox();
  const tpl = path.join(s.dir, 'template.html');
  fs.writeFileSync(tpl, fs.readFileSync(path.join(ROOT, 'src', 'index.template.html'), 'utf8').replace(" data-netlify='true' data-netlify-honeypot='bot-field'", ''));
  assert.throws(() => build({ contentDir: s.content, imagesDir: IMAGES, templatePath: tpl, out: path.join(s.dir, 'dist') }), (e) => e.errors.some((m) => m.includes('data-netlify')));
});

/** copy a folder tree (test helper) */
function cp(src, dst) { fs.cpSync(src, dst, { recursive: true }); return dst; }

test('output check: a missing static file (e.g. robots.txt) fails the build and leaves no dist', () => {
  const s = sandbox();
  const staticDir = cp(path.join(ROOT, 'src', 'static'), path.join(s.dir, 'static'));
  fs.rmSync(path.join(staticDir, 'robots.txt'));
  assert.throws(() => build({ contentDir: s.content, imagesDir: IMAGES, staticDir, out: path.join(s.dir, 'dist') }), (e) => e.errors.some((m) => m.includes('missing from output: robots.txt')));
  assert.ok(!fs.existsSync(path.join(s.dir, 'dist')));
});

test('output check: an empty _redirects file fails the build', () => {
  const s = sandbox();
  const staticDir = cp(path.join(ROOT, 'src', 'static'), path.join(s.dir, 'static'));
  fs.writeFileSync(path.join(staticDir, '_redirects'), '# nothing\n');
  assert.throws(() => build({ contentDir: s.content, imagesDir: IMAGES, staticDir, out: path.join(s.dir, 'dist') }), (e) => e.errors.some((m) => m.includes('_redirects has no rules')));
});

test('output check: a functions folder without submission-created.js fails the build', () => {
  const s = sandbox();
  const functionsDir = path.join(s.dir, 'fn'); fs.mkdirSync(functionsDir);
  assert.throws(() => build({ contentDir: s.content, imagesDir: IMAGES, functionsDir, out: path.join(s.dir, 'dist') }), (e) => e.errors.some((m) => m.includes('submission-created.js')));
});

test('output check: a package.json with "type": "module" above the function fails the build', () => {
  const s = sandbox();
  const functionsDir = cp(path.join(ROOT, 'netlify', 'functions'), path.join(s.dir, 'fn'));
  fs.writeFileSync(path.join(functionsDir, 'package.json'), JSON.stringify({ type: 'module' }));
  assert.throws(() => build({ contentDir: s.content, imagesDir: IMAGES, functionsDir, out: path.join(s.dir, 'dist') }), (e) => e.errors.some((m) => m.includes('"type": "module"')));
});

/** a writable copy of images/ plus a way to add files with a chosen header */
function imagesSandbox(s) {
  const dir = path.join(s.dir, 'images');
  cp(IMAGES, dir);
  return { dir, put: (name, buf) => fs.writeFileSync(path.join(dir, name), buf) };
}
const WEBP_HEAD = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

test('accepts a lower-case file name for an upper-case SKU (the CMS lower-cases slugs by default)', () => {
  const s = sandbox((s) => fs.renameSync(path.join(s.content, 'BT-AUD-204.json'), path.join(s.content, 'bt-aud-204.json')));
  const r = loadProducts(s.content, IMAGES);
  assert.deepEqual(r.errors, []);
  assert.equal(r.products.length, 23);
});

test('SKUs are compared case-insensitively for duplicates', () => {
  assert.deepEqual(duplicateSkus([{ sku: 'BT-AUD-204' }, { sku: 'bt-aud-204' }, { sku: 'BT-GAM-510' }]), ['bt-aud-204']);
  assert.deepEqual(duplicateSkus([{ sku: 'BT-AUD-204' }, { sku: 'BT-GAM-510' }]), []);
});

test('rejects an image whose contents are not what its extension says', () => {
  const s = sandbox();
  const im = imagesSandbox(s);
  im.put('BT-AUD-204.webp', 'this is not an image');
  hasError(loadProducts(s.content, im.dir).errors, 'is not a real WebP file');
});

test('rejects a PNG disguised as a WebP', () => {
  const s = sandbox();
  const im = imagesSandbox(s);
  im.put('BT-AUD-204.webp', Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]));
  hasError(loadProducts(s.content, im.dir).errors, 'is not a real WebP file');
});

test('rejects an image over the size limit', () => {
  const s = sandbox();
  const im = imagesSandbox(s);
  im.put('BT-AUD-204.webp', Buffer.concat([WEBP_HEAD, Buffer.alloc(1100 * 1024)]));
  hasError(loadProducts(s.content, im.dir).errors, 'limit 1024 KB');
});

test('only images used by visible products are published', () => {
  const s = sandbox((s) => s.edit('BT-AUD-204', (o) => { o.visible = false; }));
  const im = imagesSandbox(s);
  im.put('leftover.webp', Buffer.concat([WEBP_HEAD, Buffer.alloc(64)]));
  const r = build({ contentDir: s.content, imagesDir: im.dir, out: path.join(s.dir, 'dist') });
  const shipped = fs.readdirSync(path.join(s.dir, 'dist', 'images'));
  assert.equal(shipped.length, 22);
  assert.ok(!shipped.includes('BT-AUD-204.webp'), 'image of a hidden product must not be published');
  assert.ok(!shipped.includes('leftover.webp'), 'unused image must not be published');
  assert.ok(r.warnings.some((w) => w.includes('hidden product') && w.includes('BT-AUD-204.webp')));
  assert.ok(r.warnings.some((w) => w.includes('not used by any product') && w.includes('leftover.webp')));
});

test('reports published products per category and warns about an empty category', () => {
  const s = sandbox((s) => { for (const sku of ['BT-SMH-702', 'BT-SMH-705']) s.edit(sku, (o) => { o.visible = false; }); });
  const r = s.build();
  assert.deepEqual(r.perCategory, { audio: 6, computing: 5, gaming: 6, streaming: 4, smarthome: 0 });
  assert.ok(r.warnings.some((w) => w.includes('no visible product in category "smarthome"')));
});

test('a template missing a category link or form option fails the build', () => {
  const s = sandbox();
  const orig = fs.readFileSync(path.join(ROOT, 'src', 'index.template.html'), 'utf8');
  const run = (tpl) => { const p = path.join(s.dir, 'template.html'); fs.writeFileSync(p, tpl); return () => build({ contentDir: s.content, imagesDir: IMAGES, templatePath: p, out: path.join(s.dir, 'dist') }); };
  assert.throws(run(orig.replace('data-shop="audio"', 'data-shop="x"')), (e) => e.errors.some((m) => m.includes('footer shop link') && m.includes('audio')));
  assert.throws(run(orig.replace('<option>Smart home</option>', '')), (e) => e.errors.some((m) => m.includes('"Smart home" option')));
});

test('refuses to clean a dangerous output folder', () => {
  assert.throws(() => build({ out: ROOT }), BuildError);
  assert.throws(() => build({ out: path.dirname(ROOT) }), BuildError);
});
