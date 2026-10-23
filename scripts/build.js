#!/usr/bin/env node
'use strict';
/**
 * Builds the static site into dist/ from:
 *   src/index.template.html   the page, with a marker where the catalog cards go
 *   content/products/*.json   one file per product (edited through /admin)
 *   images/                   product images (copied as-is)
 *   src/static/               404/privacy/terms/robots/sitemap/icons/_redirects/_headers (copied as-is)
 *   admin/                    the backoffice page (copied as-is, if present)
 *
 * Any invalid product fails the build (exit 1) and nothing is published: Netlify keeps serving the
 * previous production deploy, and a failed build costs no credits. Zero dependencies (Node built-ins).
 */
const fs = require('fs');
const path = require('path');

if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Node 18 or newer is required (running ' + process.version + ')');

const CATEGORIES = { audio: 'Audio', computing: 'Computing', gaming: 'Gaming', streaming: 'Streaming', smarthome: 'Smart home' };
const SKU_RE = /^BT-[A-Z]{3}-[0-9]{3}$/;
const IMAGE_RE = /^\/images\/([A-Za-z0-9][A-Za-z0-9._-]*\.(?:webp|jpe?g|png))$/;
const MARKER = '<!--@CATALOG_CARDS@-->';
const MIN_VISIBLE = 5; // guard against publishing an accidentally emptied catalog
const DEFAULT_ORDER = 1000; // products without an order go after the numbered ones
const NAME_MAX = 80;
const IMAGE_WARN_BYTES = 200 * 1024; // the 23 live images average 8 KB; a bigger one slows every mobile visitor
const IMAGE_MAX_BYTES = 1024 * 1024;
// first bytes of a real file of each type (an upload that is not what its extension claims must not ship)
const IMAGE_MAGIC = [
  { ext: /\.webp$/i, label: 'WebP', test: (b) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  { ext: /\.jpe?g$/i, label: 'JPEG', test: (b) => b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { ext: /\.png$/i, label: 'PNG', test: (b) => b.length >= 4 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' },
];
const KNOWN_FIELDS = new Set(['sku', 'name', 'category', 'image', 'visible', 'order']);
// A build that "succeeds" with a structurally wrong site still publishes (and costs 15 credits), so the output is checked too.
const REQUIRED_OUTPUT = ['index.html', '404.html', 'privacy.html', 'terms.html', 'robots.txt', 'sitemap.xml', '_redirects', 'favicon.svg', 'og-image.png'];
const FUNCTION_FILE = 'submission-created.js'; // emails every quote-form inquiry; must ship with every deploy

class BuildError extends Error {
  constructor(errors) {
    super(errors.length + ' build error(s):\n - ' + errors.join('\n - '));
    this.errors = errors;
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Exactly the markup of the original hand-written cards (see tests/golden.test.js). */
function renderCard(p) {
  const name = esc(p.name);
  return '<a class="prod reveal" href="#contact" data-cat="' + p.category + '" aria-label="' + name + ' \u2014 contact for pricing">'
    + '<div class="thumb photo"><img class="pphoto" decoding="async" src="' + esc(p.image) + '" alt="' + name + '" loading="lazy"></div>'
    + '<div class="pbody"><span class="pcat">' + CATEGORIES[p.category] + '</span><span class="pname">' + name + '</span>'
    + '<span class="psku">SKU \u00B7 ' + p.sku + '</span>'
    + '<span class="pcta">Contact for pricing <span class="arw">\u2192</span></span></div></a>';
}

/** null when the image file is acceptable, otherwise the reason it is not */
function imageProblem(imagesDir, file) {
  const full = path.join(imagesDir, file);
  const size = fs.statSync(full).size;
  if (size > IMAGE_MAX_BYTES) return file + ' is ' + Math.round(size / 1024) + ' KB (limit ' + Math.round(IMAGE_MAX_BYTES / 1024) + ' KB); upload a smaller image';
  const kind = IMAGE_MAGIC.find((m) => m.ext.test(file));
  if (!kind) return null;
  const fd = fs.openSync(full, 'r');
  try {
    const head = Buffer.alloc(16);
    const n = fs.readSync(fd, head, 0, 16, 0);
    if (!kind.test(head.subarray(0, n))) return file + ' is not a real ' + kind.label + ' file (its contents do not match its extension)';
  } finally { fs.closeSync(fd); }
  return null;
}

/** SKUs used by more than one product, compared case-insensitively (Linux, unlike Windows, can hold bt-x.json beside BT-X.json) */
function duplicateSkus(products) {
  const seen = new Map(), dup = new Set();
  for (const p of products) { const k = p.sku.toLowerCase(); if (seen.has(k)) dup.add(p.sku); else seen.set(k, p.sku); }
  return [...dup];
}

function loadProducts(contentDir, imagesDir) {
  const errors = [];
  const warnings = [];
  const products = [];
  const imageFiles = fs.existsSync(imagesDir) ? new Set(fs.readdirSync(imagesDir)) : new Set(); // exact-case names (Netlify is case-sensitive)
  const imageChecked = new Map();
  if (!fs.existsSync(contentDir)) throw new BuildError(['content folder not found: ' + contentDir]);

  for (const file of fs.readdirSync(contentDir).sort()) {
    if (!file.endsWith('.json')) { warnings.push('ignored non-JSON file in content/products: ' + file); continue; }
    const where = file + ': ';
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(contentDir, file), 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) { errors.push(where + 'invalid JSON (' + e.message + ')'); continue; }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(where + 'must be a JSON object'); continue; }

    const before = errors.length;
    const sku = raw.sku;
    if (typeof sku !== 'string' || !SKU_RE.test(sku)) errors.push(where + 'sku must look like BT-ABC-123 (got ' + JSON.stringify(sku) + ')');
    else if (file.toLowerCase() !== sku.toLowerCase() + '.json') errors.push(where + 'file name must be ' + sku + '.json (the SKU; letter case does not matter)');

    let name = raw.name;
    if (typeof name !== 'string') errors.push(where + 'name is required');
    else {
      if (name !== name.trim()) { warnings.push(where + 'name had leading/trailing spaces (trimmed)'); name = name.trim(); }
      if (!name) errors.push(where + 'name must not be empty');
      else if (name.length > NAME_MAX) errors.push(where + 'name is longer than ' + NAME_MAX + ' characters');
      else if (/[\u0000-\u001F\u007F]/.test(name)) errors.push(where + 'name contains control characters');
    }

    if (!Object.prototype.hasOwnProperty.call(CATEGORIES, raw.category)) errors.push(where + 'category must be one of ' + Object.keys(CATEGORIES).join(', ') + ' (got ' + JSON.stringify(raw.category) + ')');

    const im = typeof raw.image === 'string' ? IMAGE_RE.exec(raw.image) : null;
    if (!im) errors.push(where + 'image must look like /images/<file>.webp|jpg|png (got ' + JSON.stringify(raw.image) + ')');
    else if (!imageFiles.has(im[1])) errors.push(where + 'image file not found in images/ (exact case): ' + im[1]);
    else {
      if (!imageChecked.has(im[1])) imageChecked.set(im[1], imageProblem(imagesDir, im[1]));
      if (imageChecked.get(im[1])) errors.push(where + imageChecked.get(im[1]));
    }

    let visible = raw.visible;
    if (visible === undefined || visible === null) visible = true;
    else if (typeof visible !== 'boolean') errors.push(where + 'visible must be true or false (got ' + JSON.stringify(raw.visible) + ')');

    let order = raw.order;
    if (order === undefined || order === null || order === '') order = DEFAULT_ORDER;
    else if (!Number.isInteger(order) || order < 0 || order > 100000) errors.push(where + 'order must be a whole number between 0 and 100000 (got ' + JSON.stringify(raw.order) + ')');

    for (const k of Object.keys(raw)) if (!KNOWN_FIELDS.has(k)) warnings.push(where + 'unknown field ignored: ' + k);

    if (errors.length === before) products.push({ sku, name, category: raw.category, image: raw.image, visible, order, file });
  }
  for (const s of duplicateSkus(products)) errors.push('SKU used by more than one product file: ' + s);
  return { products, errors, warnings };
}

function copyDir(src, dst, files) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, files);
    else { fs.copyFileSync(s, d); files.push(path.relative(path.dirname(dst), d).split(path.sep).join('/')); }
  }
}

/** Structural checks on the finished dist/ (and the functions folder that ships beside it). Returns a list of problems. */
function verifyOutput(out, root, functionsDir, expectedCards, mode) {
  mode = mode || { formLive: true, adminIncluded: false };
  const problems = [];
  if (mode.adminIncluded) {
    for (const f of ['admin/index.html', 'admin/config.yml', 'admin/vendor/sveltia-cms.js', '_headers']) if (!fs.existsSync(path.join(out, f))) problems.push('backoffice build is missing ' + f);
    if (fs.existsSync(path.join(out, '_headers')) && !/^\/admin\/\*\s*$/m.test(fs.readFileSync(path.join(out, '_headers'), 'utf8'))) problems.push('_headers does not protect /admin/*');
  } else {
    // production must never serve the backoffice or its headers
    if (fs.existsSync(path.join(out, 'admin'))) problems.push('the backoffice (admin/) must not be in a production build');
    if (fs.existsSync(path.join(out, '_headers'))) problems.push('_headers must not be in a production build');
  }
  for (const f of REQUIRED_OUTPUT) if (!fs.existsSync(path.join(out, f))) problems.push('missing from output: ' + f);
  if (fs.existsSync(path.join(out, '_redirects')) && !/^\s*[^#\s]/m.test(fs.readFileSync(path.join(out, '_redirects'), 'utf8'))) problems.push('_redirects has no rules');
  if (fs.existsSync(path.join(out, 'index.html'))) {
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const cards = (html.match(/<a class="prod reveal"/g) || []).length;
    if (cards !== expectedCards) problems.push('index.html has ' + cards + ' product cards, expected ' + expectedCards);
    if (html.includes(MARKER)) problems.push('index.html still contains the catalog marker');
    const formLive = /<form [^>]*data-netlify=/.test(html);
    if (mode.formLive && !formLive) problems.push('index.html: quote form lacks data-netlify');
    if (!mode.formLive && formLive) problems.push('index.html: a preview build must not register the quote form (data-netlify still present)');
    if ((html.match(/<form /g) || []).length !== 1) problems.push('index.html must contain exactly one form');
    const fn = (html.match(/name="form-name"/g) || []).length;
    if (fn !== 1) problems.push('index.html has ' + fn + ' form-name fields, expected exactly 1');
  }
  if (!fs.existsSync(path.join(functionsDir, FUNCTION_FILE))) problems.push('functions folder lacks ' + FUNCTION_FILE + ' (inquiry emails would stop): ' + functionsDir);
  // a package.json with "type": "module" at or above the functions folder turns the CommonJS function into an ES module that fails to load
  for (let d = path.resolve(functionsDir); ; d = path.dirname(d)) {
    const pj = path.join(d, 'package.json');
    if (fs.existsSync(pj)) {
      try { if (JSON.parse(fs.readFileSync(pj, 'utf8')).type === 'module') problems.push('package.json with "type": "module" at ' + d + ' would break ' + FUNCTION_FILE); }
      catch (e) { problems.push('unreadable package.json at ' + d); }
    }
    if (d === root || d === path.dirname(d)) break;
  }
  return problems;
}

function build(opts) {
  const root = path.resolve((opts && opts.root) || path.join(__dirname, '..'));
  const o = Object.assign({
    contentDir: path.join(root, 'content', 'products'),
    imagesDir: path.join(root, 'images'),
    templatePath: path.join(root, 'src', 'index.template.html'),
    staticDir: path.join(root, 'src', 'static'),
    adminDir: path.join(root, 'admin'),
    adminHeadersPath: path.join(root, 'src', 'admin.headers'),
    functionsDir: path.join(root, 'netlify', 'functions'),
    out: path.join(root, 'dist'),
  }, opts || {});
  // Netlify sets CONTEXT to production | deploy-preview | branch-deploy. A plain local build (CONTEXT unset) behaves like
  // production, so a local "netlify deploy --prod" can never publish the backoffice; set BT_INCLUDE_ADMIN=1 to preview it locally.
  const ctx = o.context !== undefined ? o.context : process.env.CONTEXT;
  const mode = {
    context: ctx || 'local',
    formLive: ctx === undefined || ctx === '' || ctx === 'production', // previews keep the quote form inert: no registered form, no stray leads
    adminIncluded: o.includeAdmin !== undefined ? !!o.includeAdmin : (process.env.BT_INCLUDE_ADMIN === '1' || (!!ctx && ctx !== 'production')),
  };
  const out = path.resolve(o.out);
  if (out === root || root.startsWith(out + path.sep) || out === path.parse(out).root) throw new BuildError(['refusing to clean output folder: ' + out]);

  const { products, errors, warnings } = loadProducts(o.contentDir, o.imagesDir);

  let template = '';
  if (!fs.existsSync(o.templatePath)) errors.push('template not found: ' + o.templatePath);
  else {
    template = fs.readFileSync(o.templatePath, 'utf8');
    if (template.split(MARKER).length !== 2) errors.push('template must contain the marker ' + MARKER + ' exactly once');
    // a category must exist in four places or its products show only under "All" and the form cannot preselect it
    for (const [cat, label] of Object.entries(CATEGORIES)) {
      if (!template.includes('class="fchip" type="button" data-cat="' + cat + '"')) errors.push('template has no filter chip for category "' + cat + '"');
      if (!template.includes('data-shop="' + cat + '"')) errors.push('template has no footer shop link (data-shop) for category "' + cat + '"');
      if (!template.includes('<option>' + label + '</option>')) errors.push('quote form has no "' + label + '" option for category "' + cat + '"');
    }
    if (!/<form [^>]*data-netlify=/.test(template)) errors.push('quote form lost its data-netlify attribute (Netlify would stop registering submissions)');
  }

  const shown = products.filter((p) => p.visible).sort((a, b) => a.order - b.order || (a.sku < b.sku ? -1 : 1));
  const hidden = products.filter((p) => !p.visible);
  if (shown.length < MIN_VISIBLE) errors.push('only ' + shown.length + ' visible product(s); at least ' + MIN_VISIBLE + ' required (refusing to publish an emptied catalog)');
  const seenImg = new Map();
  for (const p of shown) { if (seenImg.has(p.image)) warnings.push(p.sku + ' and ' + seenImg.get(p.image) + ' use the same image ' + p.image); else seenImg.set(p.image, p.sku); }
  const seenOrder = new Map();
  for (const p of shown) { if (p.order !== DEFAULT_ORDER) { if (seenOrder.has(p.order)) warnings.push(p.sku + ' and ' + seenOrder.get(p.order) + ' share order ' + p.order + ' (sorted by SKU)'); else seenOrder.set(p.order, p.sku); } }
  const perCategory = {};
  for (const cat of Object.keys(CATEGORIES)) perCategory[cat] = shown.filter((p) => p.category === cat).length;
  for (const [cat, n] of Object.entries(perCategory)) if (n === 0) warnings.push('no visible product in category "' + cat + '" (its filter chip will show nothing)');
  // only images that a visible product uses are published: hidden and leftover files must not stay fetchable at a guessable URL
  const usedByShown = new Set(shown.map((p) => p.image.slice('/images/'.length)));
  if (fs.existsSync(o.imagesDir)) {
    const usedByAny = new Set(products.map((p) => p.image.slice('/images/'.length)));
    for (const f of fs.readdirSync(o.imagesDir).sort()) {
      const kb = Math.round(fs.statSync(path.join(o.imagesDir, f)).size / 1024);
      if (kb * 1024 > IMAGE_WARN_BYTES) warnings.push('large image (' + kb + ' KB): ' + f);
      if (!usedByAny.has(f)) warnings.push('image not used by any product (not published): ' + f);
      else if (!usedByShown.has(f)) warnings.push('image of a hidden product (not published): ' + f);
    }
  }
  if (errors.length) throw new BuildError(errors);

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const files = [];
  if (fs.existsSync(o.staticDir)) for (const e of fs.readdirSync(o.staticDir, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(o.staticDir, e.name), path.join(out, e.name), files);
    else { fs.copyFileSync(path.join(o.staticDir, e.name), path.join(out, e.name)); files.push(e.name); }
  }
  if (usedByShown.size) fs.mkdirSync(path.join(out, 'images'), { recursive: true });
  for (const f of [...usedByShown].sort()) { fs.copyFileSync(path.join(o.imagesDir, f), path.join(out, 'images', f)); files.push('images/' + f); }
  if (mode.adminIncluded) {
    if (fs.existsSync(o.adminDir)) copyDir(o.adminDir, path.join(out, 'admin'), files);
    if (fs.existsSync(o.adminHeadersPath)) {
      if (fs.existsSync(path.join(out, '_headers'))) { fs.rmSync(out, { recursive: true, force: true }); throw new BuildError(['src/static/_headers already exists; merge the /admin rules into it instead']); }
      fs.copyFileSync(o.adminHeadersPath, path.join(out, '_headers')); files.push('_headers');
    }
    const cfg = path.join(out, 'admin', 'config.yml');
    if (fs.existsSync(cfg) && fs.readFileSync(cfg, 'utf8').includes('OWNER/REPO')) warnings.push('admin/config.yml still says OWNER/REPO: set the GitHub repository before editors can sign in');
  }

  let page = template.replace(MARKER, () => shown.map(renderCard).join('\n      ')); // function form: card text may contain "$&"
  if (!mode.formLive) {
    const live = " data-netlify='true' data-netlify-honeypot='bot-field'";
    if (page.split(live).length !== 2) { fs.rmSync(out, { recursive: true, force: true }); throw new BuildError(['cannot make the quote form inert: expected attributes' + live + ' exactly once']); }
    page = page.replace(live, () => '');
  }
  fs.writeFileSync(path.join(out, 'index.html'), Buffer.from(page, 'utf8'));
  files.push('index.html');
  const problems = verifyOutput(out, root, path.resolve(o.functionsDir), shown.length, mode);
  if (problems.length) { fs.rmSync(out, { recursive: true, force: true }); throw new BuildError(problems); }
  return { total: products.length, visible: shown.length, hidden: hidden.map((p) => p.sku), perCategory, warnings, files: files.sort(), out, mode };
}

if (require.main === module) {
  try {
    const r = build();
    console.log('processed ' + r.total + ' product file(s): ' + r.visible + ' published, ' + r.hidden.length + ' hidden' + (r.hidden.length ? ' (' + r.hidden.join(', ') + ')' : ''));
    console.log('published per category: ' + Object.entries(r.perCategory).map(([c, n]) => c + ' ' + n).join(', '));
    console.log('build context: ' + r.mode.context + ' (' + (r.mode.formLive ? 'quote form live' : 'quote form inert') + ', ' + (r.mode.adminIncluded ? 'backoffice /admin included' : 'no backoffice') + ')');
    for (const w of r.warnings) console.log('warning: ' + w);
    console.log('wrote ' + r.files.length + ' files to ' + r.out);
  } catch (e) {
    if (e instanceof BuildError) { console.error('BUILD FAILED, nothing was published:\n - ' + e.errors.join('\n - ')); process.exit(1); }
    throw e;
  }
}

module.exports = { build, loadProducts, renderCard, verifyOutput, duplicateSkus, BuildError, CATEGORIES, MARKER, MIN_VISIBLE };
