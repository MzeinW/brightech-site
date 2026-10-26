'use strict';
// The catalog the shop actually lists (content/products + images): it must build cleanly and stay consistent with the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../scripts/build.js');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = path.join(ROOT, 'content', 'products');
const products = fs.readdirSync(CONTENT).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(CONTENT, f), 'utf8')));
const visible = products.filter((p) => p.visible !== false);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-catalog-'));
const result = build({ out, context: 'production' });
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');

/** width and height of a WebP file (VP8, VP8L or VP8X) */
function webpSize(buf) {
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (kind === 'VP8L') { const v = buf.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
  return [0, 0];
}

test('the live catalog builds and shows one card per visible product', () => {
  assert.equal(result.visible, visible.length);
  assert.equal((html.match(/<a class="prod reveal"/g) || []).length, visible.length);
});

test('no leftover, shared or oversized pictures', () => {
  assert.deepEqual(result.warnings, []);
});

test('every catalog picture is 4:3, so the card box shows it whole', () => {
  for (const p of visible) {
    const [w, h] = webpSize(fs.readFileSync(path.join(ROOT, p.image)));
    assert.ok(w > 0 && Math.abs(w / h - 4 / 3) < 0.02, p.sku + ' picture is ' + w + 'x' + h + ', not 4:3');
  }
});

test('every product in the hero "Featured inventory" strip is listed in the catalog', () => {
  const featured = [...html.matchAll(/<span class="spot-name">([^<]+)<\/span>/g)].map((m) => m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  assert.ok(featured.length >= 3, 'featured strip not found');
  // the strip may shorten a name ("AirPods 5" for "Apple AirPods 5"), but it must point at a listed product
  for (const f of featured) assert.ok(visible.some((p) => p.name.includes(f)), 'featured but not listed: ' + f);
});

test.after(() => fs.rmSync(out, { recursive: true, force: true }));
