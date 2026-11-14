// node --experimental-vm-modules tests/hull-damage.mjs
//
// Painted hull damage. The first part drives the field maths
// (scripts/hull-damage-field.js) and the hull shape analysis
// (scripts/hull-sections.js, on a synthetic ship) directly — both leaves; the
// last loads the renderer (scripts/hull-damage-paint.js) for real against
// stubbed PIXI, canvas and DOM, with its two heavier imports replaced by
// synthetic modules.
// The visual check is tests/hull-damage-browser.html.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  buildDamageField, composeDamage, normalizeHit, hitHeat, silhouettePx, T, SEVERITY,
} from '../scripts/hull-damage-field.js';
import { analyzeHull, distanceField, localThickness, segmentHull, sectionAt } from '../scripts/hull-sections.js';

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

// ── Field fixtures ──────────────────────────────────────────────────────────
// A 160×120 field whose hull is an ellipse: anything outside it is space.
const W = 160, H = 120;
function ellipseAlpha(w = W, h = H) {
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x - w / 2) / (w * 0.45), v = (y - h / 2) / (h * 0.42);
    if (u * u + v * v <= 1) a[y * w + x] = 255;
  }
  return a;
}
const alpha = ellipseAlpha();
const geo = { W, H, alpha, shipPx: silhouettePx(alpha, W, H), boxX: W, boxY: H, aniso: 1, scale: 1 };
const peak = (f) => f.d.reduce((m, v) => Math.max(m, v), 0);
const area = (f, t) => f.d.reduce((n, v) => n + (v >= t ? 1 : 0), 0);

await check('the field is deterministic from the seed', () => {
  const hits = [{ kind: 'torpedo', sev: 'medium', nx: 0.05, ny: -0.1, seed: 42, heat: 1 }];
  const a = buildDamageField(hits, geo), b = buildDamageField(hits, geo);
  assert.deepEqual(Array.from(a.d), Array.from(b.d));
  const c = buildDamageField([{ ...hits[0], seed: 43 }], geo);
  assert.notDeepEqual(Array.from(a.d), Array.from(c.d));
});

await check('heavier hits reach deeper and wider than lighter ones', () => {
  const at = (sev) => buildDamageField([{ kind: 'torpedo', sev, nx: 0, ny: 0, seed: 7 }], geo);
  const [l, m, h] = ['light', 'medium', 'heavy'].map(at);
  assert.ok(peak(l) < peak(m) && peak(m) < peak(h), `${peak(l)} ${peak(m)} ${peak(h)}`);
  assert.ok(area(l, T.peel) < area(h, T.peel));
  assert.ok(area(l, T.breach) === 0, 'a light hit should not hole the hull');
  assert.ok(area(h, T.breach) > 0, 'a heavy hit should hole the hull');
});

await check('hits on the same spot add up', () => {
  const one = buildDamageField([{ kind: 'torpedo', sev: 'light', nx: 0, ny: 0, seed: 9 }], geo);
  const two = buildDamageField([
    { kind: 'torpedo', sev: 'light', nx: 0, ny: 0, seed: 9 },
    { kind: 'torpedo', sev: 'light', nx: 0, ny: 0, seed: 10 },
  ], geo);
  assert.ok(peak(two) > peak(one) * 1.5);
  assert.ok(area(two, T.peel) > area(one, T.peel));
});

await check('nothing is painted into space', () => {
  // Torpedo cracks reach past the bowl; a hit at the hull's edge must stop at it.
  const f = buildDamageField([{ kind: 'torpedo', sev: 'heavy', nx: 0.42, ny: 0, seed: 3, heat: 1 }], geo);
  for (let i = 0; i < W * H; i++) if (!alpha[i]) assert.equal(f.d[i], 0, `space painted at ${i}`);
  const c = composeDamage(f, geo);
  for (let i = 0; i < W * H; i++) if (!alpha[i]) {
    assert.equal(c.base[i * 4 + 3], 0); assert.equal(c.glow[i * 4 + 3], 0);
  }
});

await check('a phaser gouge lies along the beam', () => {
  const extent = (dir) => {
    const f = buildDamageField([{ kind: 'beam', sev: 'medium', nx: 0, ny: 0, dir, seed: 5 }], geo);
    let sx = 0, sy = 0, n = 0;
    const cx = W / 2, cy = H / 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (f.d[y * W + x] >= T.peel) {
      sx += Math.abs(x - cx); sy += Math.abs(y - cy); n++;
    }
    return { sx: sx / n, sy: sy / n };
  };
  const across = extent(0), down = extent(Math.PI / 2);
  assert.ok(across.sx > across.sy * 1.8, `→ gouge ${JSON.stringify(across)}`);
  assert.ok(down.sy > down.sx * 1.8, `↓ gouge ${JSON.stringify(down)}`);
});

await check('composite layers follow the thresholds', () => {
  const f = buildDamageField([{ kind: 'torpedo', sev: 'heavy', nx: 0, ny: 0, seed: 21, heat: 1 }], geo);
  const c = composeDamage(f, geo);
  for (let i = 0; i < W * H; i++) {
    const v = f.d[i], a = c.base[i * 4 + 3];
    if (alpha[i] && v < T.scorch) assert.equal(a, 0, 'clean hull must stay untouched');
    if (alpha[i] && v > T.peel + 0.02) assert.equal(a, 255, 'exposed decks are opaque');
    if (alpha[i] && v > T.breach + 0.06) {
      const lum = c.base[i * 4] + c.base[i * 4 + 1] + c.base[i * 4 + 2];
      assert.ok(lum < 40, 'a breach is near-black');
    }
  }
  assert.ok(c.maxHeat > 0.9);
  assert.ok(c.embers.length > 0 && c.embers.length <= 80);
});

await check('a cooled wound has no glow and no embers', () => {
  const f = buildDamageField([{ kind: 'torpedo', sev: 'heavy', nx: 0, ny: 0, seed: 21, heat: 0 }], geo);
  const c = composeDamage(f, geo);
  assert.equal(c.glow.reduce((n, v, i) => n + (i % 4 === 3 ? v : 0), 0), 0);
  assert.equal(c.embers.length, 0);
  assert.equal(c.maxHeat, 0);
});

await check('old decal entries still paint', () => {
  const h = normalizeHit({ nx: 0.1, ny: -0.2, sev: 'heavy', rot: 1.25 }, 2);
  assert.equal(h.kind, 'torpedo');
  assert.equal(h.dir, 1.25);
  assert.ok(Number.isInteger(h.seed));
  assert.equal(h.heat, 0);
  assert.equal(normalizeHit({ nx: 0.1, ny: -0.2 }, 2).seed, h.seed, 'seed comes from the position');
  assert.equal(normalizeHit({ sev: 'nonsense' }).sev, 'medium');
});

await check('heat cools by round in its combat, by clock outside it', () => {
  const hit = { cid: 'c1', round: 3, at: 1000 };
  assert.equal(hitHeat(hit, { combatId: 'c1', round: 3, now: 1000 }), 1);
  assert.equal(hitHeat(hit, { combatId: 'c1', round: 4, now: 1000 }), 0.7);
  assert.equal(hitHeat(hit, { combatId: 'c1', round: 7, now: 1000 }), 0);
  assert.equal(hitHeat(hit, { combatId: null, round: null, now: 1000 + 90000 }), 0.5);
  assert.equal(hitHeat({}, { now: 5 }), 0, 'an old decal is cold');
  assert.ok(SEVERITY.heavy.strength > SEVERITY.light.strength);
});

// ── Hull sections ───────────────────────────────────────────────────────────
// A synthetic ship at 240×240: a saucer, a neck into a tapering secondary hull,
// and two thin pylons out to two long nacelles.
const SW = 240, SH = 240;
function shipAlpha() {
  const a = new Uint8Array(SW * SH);
  const put = (x, y) => { if (x >= 0 && y >= 0 && x < SW && y < SH) a[y * SW + x] = 255; };
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    if ((x - 120) ** 2 + (y - 60) ** 2 <= 50 ** 2) put(x, y);                   // saucer
    if (Math.abs(x - 120) <= 11 && y >= 100 && y <= 130) put(x, y);             // neck
    const half = y >= 130 && y <= 200 ? 16 - (y - 130) * 0.12 : -1;              // tapering hull
    if (half > 0 && Math.abs(x - 120) <= half) put(x, y);
    if (x >= 40 && x <= 52 && y >= 120 && y <= 230) put(x, y);                  // port nacelle
    if (x >= 188 && x <= 200 && y >= 120 && y <= 230) put(x, y);                // starboard nacelle
  }
  for (let t = 0; t <= 1; t += 0.002) {                                          // pylons, 4 px wide
    for (let w = -2; w <= 2; w++) {
      put(Math.round(52 + t * (106 - 52)) , Math.round(190 - t * 30) + w);
      put(Math.round(188 - t * (188 - 134)), Math.round(190 - t * 30) + w);
    }
  }
  return a;
}
const shipA = shipAlpha();
const hull = analyzeHull(shipA, SW, SH);

await check('the distance field is exact', () => {
  const { dist, nearX, nearY } = distanceField(alpha, W, H);
  const outside = [];
  for (let y = -1; y <= H; y++) for (let x = -1; x <= W; x++) {
    const inside = x >= 0 && y >= 0 && x < W && y < H && alpha[y * W + x] >= 32;
    if (!inside) outside.push([x, y]);
  }
  for (const i of [W * 60 + 80, W * 30 + 40, W * 90 + 130, W * 61 + 79]) {
    const x = i % W, y = (i - x) / W;
    let best = Infinity;
    for (const [ox, oy] of outside) best = Math.min(best, Math.hypot(ox - x, oy - y));
    assert.ok(Math.abs(dist[i] - best) < 1e-4, `dist ${dist[i]} vs ${best}`);
    assert.ok(Math.abs(Math.hypot(nearX[i] - x, nearY[i] - y) - best) < 1e-4, 'nearest edge point');
  }
});

await check('local thickness steps at the saucer rim', () => {
  const at = (x, y) => hull.thick[y * SW + x];
  assert.ok(at(120, 105) > 45, 'neck pixel inside the saucer disc is saucer-thick');
  assert.ok(at(120, 120) < 14, 'the neck is only as thick as itself');
  assert.ok(at(46, 170) < 8 && at(46, 170) > 4, 'nacelle');
});

await check('finds the saucer, the secondary hull, both nacelles and both pylons', () => {
  const kindAt = (x, y) => hull.sections[sectionAt(hull, x, y)]?.kind;
  const idAt = (x, y) => sectionAt(hull, x, y);
  assert.equal(kindAt(120, 60), 'disc');
  assert.equal(kindAt(46, 200), 'long');
  assert.equal(kindAt(194, 200), 'long');
  assert.notEqual(idAt(120, 60), idAt(120, 160), 'saucer and secondary hull are separate');
  assert.notEqual(idAt(46, 200), idAt(194, 200), 'each nacelle is its own section');
  assert.notEqual(idAt(46, 200), idAt(120, 160), 'nacelle is not part of the hull');
  const py = idAt(Math.round(52 + 0.5 * 54), Math.round(190 - 0.5 * 30));
  assert.ok(![idAt(46, 200), idAt(120, 160)].includes(py), 'the pylon is its own section');
  assert.ok(hull.sections.length >= 6 && hull.sections.length <= 9, `${hull.sections.length} sections`);
});

await check('a gradual taper stays one section', () => {
  const a = new Uint8Array(SW * SH);
  for (let y = 20; y < 220; y++) {
    const half = 30 - (y - 20) * 0.12;
    for (let x = 0; x < SW; x++) if (Math.abs(x - 120) <= half) a[y * SW + x] = 255;
  }
  const { sections } = analyzeHull(a, SW, SH);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].kind, 'long');
});

await check('torpedo cracks stop at the bulkhead', () => {
  const g = { W: SW, H: SH, alpha: shipA, shipPx: silhouettePx(shipA, SW, SH), boxX: SW, boxY: SH, aniso: 1, scale: 1.4 };
  // A hit on the saucer just above the neck: its cracks would run down it.
  const hit = [{ kind: 'torpedo', sev: 'heavy', nx: 0, ny: (100 - SH / 2) / SH, seed: 5 }];
  const free = buildDamageField(hit, g);
  const walled = buildDamageField(hit, { ...g, hull });
  const home = sectionAt(hull, 120, 100);
  let outside = 0, less = 0;
  for (let i = 0; i < SW * SH; i++) {
    if (hull.label[i] < 0 || hull.label[i] === home) { assert.equal(walled.d[i], free.d[i]); continue; }
    assert.ok(walled.d[i] <= free.d[i] + 1e-6);
    if (free.d[i] > 0) outside++;
    if (walled.d[i] < free.d[i] - 1e-6) less++;
  }
  assert.ok(outside > 0 && less > 0, `the hit reached across (${outside}) and was trimmed there (${less})`);
});

await check('each section takes its own interior, with bulkheads between', () => {
  const d = new Float32Array(SW * SH);
  for (let i = 0; i < SW * SH; i++) if (shipA[i]) d[i] = 0.6;
  const g = { W: SW, H: SH, alpha: shipA, shipPx: silhouettePx(shipA, SW, SH) };
  const plain = composeDamage({ d, heat: new Float32Array(SW * SH) }, g).base;
  const aware = composeDamage({ d, heat: new Float32Array(SW * SH) }, { ...g, hull }).base;
  let differ = 0, bulk = 0;
  for (let i = 0; i < SW * SH; i++) {
    if (!shipA[i]) continue;
    const o = i * 4;
    if (plain[o] !== aware[o] || plain[o + 2] !== aware[o + 2]) differ++;
    if (aware[o] > aware[o + 2] + 8 && aware[o] > 90 && aware[o] < 125) bulk++;   // the warm grey wall
  }
  assert.ok(differ > 1000, 'the hull analysis changes the interior');
  assert.ok(bulk > 50, 'bulkheads drawn where sections meet');
  const wrongSize = composeDamage({ d, heat: new Float32Array(SW * SH) }, { ...g, hull: { ...hull, W: 10 } }).base;
  assert.deepEqual(Array.from(wrongSize), Array.from(plain), 'an analysis of another size is ignored');
});

// ── Renderer against stubs ──────────────────────────────────────────────────
function environment() {
  const ticks = new Set();
  const destroyed = { textures: 0 };
  class Point { constructor() { this.x = 0; this.y = 0; } set(x, y) { this.x = x; this.y = y ?? x; } }
  class Container {
    constructor() { this.children = []; this.position = new Point(); this.scale = new Point(); this.alpha = 1; this.visible = true; this.destroyed = false; }
    addChild(...cs) { for (const c of cs) { this.children.push(c); c.parent = this; } return cs[0]; }
    destroy() { this.destroyed = true; this.parent && (this.parent.children = this.parent.children.filter(c => c !== this)); }
  }
  class Sprite extends Container {
    constructor(tex) { super(); this.texture = tex; this.anchor = new Point(); }
    get x() { return this.position.x; } set x(v) { this.position.x = v; }
    get y() { return this.position.y; } set y(v) { this.position.y = v; }
  }
  const Texture = { from(c) { return { source: c, data: c._data, width: c.width, height: c.height, destroy() { this.destroyed = true; destroyed.textures++; } }; } };
  class ImageData { constructor(data, w, h) { this.data = data; this.width = w; this.height = h; } }
  const ART = 200;                            // stored art size, a centred ellipse
  const artAlpha = ellipseAlpha(ART, ART);
  function canvasEl() {
    const el = { width: 0, height: 0, _data: null };
    el.getContext = () => ({
      drawImage() {},
      getImageData(x, y, w, h) {
        const d = new Uint8ClampedArray(w * h * 4);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          d[(j * w + i) * 4 + 3] = artAlpha[Math.floor(j * ART / h) * ART + Math.floor(i * ART / w)];
        }
        return { data: d };
      },
      putImageData(img) { el._data = img.data; },
      createRadialGradient() { return { addColorStop() {} }; },
      fillRect() {},
    });
    return el;
  }
  class Image {
    set src(v) { this._src = v; this.naturalWidth = ART; this.naturalHeight = ART; queueMicrotask(() => this.onload?.()); }
    get src() { return this._src; }
  }
  const settings = { hullDecalScale: 1 };
  const g = {
    PIXI: { Container, Sprite, Texture, BLEND_MODES: { ADD: 1 } },
    ImageData, Image,
    document: { createElement: () => canvasEl() },
    canvas: { app: { ticker: { deltaMS: 16, add: f => ticks.add(f), remove: f => ticks.delete(f) } } },
    game: { settings: { get: (_m, k) => settings[k] }, combat: null },
    console, Math, Date, JSON, Int32Array, Float64Array, Number, Array, Object, Promise, Map, Set, Uint8Array, Uint8ClampedArray, Float32Array, queueMicrotask,
  };
  return { g, ticks, destroyed, Container };
}

async function loadPaint(env) {
  const ctx = vm.createContext(env.g);
  const fieldSrc = await readFile(new URL('../scripts/hull-damage-field.js', import.meta.url), 'utf8');
  const paintSrc = await readFile(new URL('../scripts/hull-damage-paint.js', import.meta.url), 'utf8');
  const field = new vm.SourceTextModule(fieldSrc, { context: ctx, identifier: 'hull-damage-field.js' });
  const sectionsSrc = await readFile(new URL('../scripts/hull-sections.js', import.meta.url), 'utf8');
  const sections = new vm.SourceTextModule(sectionsSrc, { context: ctx, identifier: 'hull-sections.js' });
  const anchors = new vm.SourceTextModule('export async function getTokenAlphaMask() { return null; }', { context: ctx });
  const starfield = new vm.SourceTextModule('export function addBlend() { return "add"; }', { context: ctx });
  const paint = new vm.SourceTextModule(paintSrc, { context: ctx, identifier: 'hull-damage-paint.js' });
  const map = { './hull-damage-field.js': field, './hull-sections.js': sections, './ship-vfx-anchors.js': anchors, './starfield-common.js': starfield };
  await paint.link(spec => { if (!map[spec]) throw new Error('unexpected import ' + spec); return map[spec]; });
  await paint.evaluate();
  return paint.namespace;
}

const token = (over = {}) => ({ w: 200, h: 200, destroyed: false, document: { texture: { src: 'ship.webp', fit: 'contain', scaleX: 1, scaleY: 1, ...over } } });
const hotHit = { kind: 'torpedo', sev: 'heavy', nx: 0.25, ny: 0, seed: 11, at: Date.now() };
const coldHit = { kind: 'torpedo', sev: 'heavy', nx: 0.25, ny: 0, seed: 11 };

await check('paints a hot wound with glow, embers and a ticker; destroy cleans up', async () => {
  const env = environment();
  const P = await loadPaint(env);
  const cont = new env.Container();
  assert.equal(await P.paintHullDamage(token(), cont, [hotHit]), true);
  const p = cont._paint;
  assert.ok(p && p.layer.parent === cont);
  assert.equal(p.layer.children.length, 3, 'base, glow, embers');
  assert.equal(p.glowSp.blendMode, 'add');
  assert.ok(p.embers.children.length > 0);
  assert.equal(env.ticks.size, 1);
  assert.ok(p.art.hull?.sections?.length >= 1, 'the art carries its hull analysis');
  for (const f of env.ticks) f();                 // one frame runs without throwing
  assert.ok(P.hullDamagePaintIsWarm(cont));
  assert.ok(Math.abs(p.layer.scale.x - 200 / p.W) < 1e-9, 'one field px maps onto the displayed art');
  P.destroyHullDamagePaint(cont);
  assert.equal(cont._paint, null);
  assert.equal(env.ticks.size, 0, 'ticker removed');
  assert.equal(env.destroyed.textures, 2, 'both owned textures destroyed');
});

await check('a cold wound runs no ticker; an unchanged repaint is skipped', async () => {
  const env = environment();
  const P = await loadPaint(env);
  const cont = new env.Container();
  await P.paintHullDamage(token(), cont, [coldHit]);
  assert.equal(env.ticks.size, 0);
  assert.equal(P.hullDamagePaintIsWarm(cont), false);
  const layer = cont._paint.layer;
  await P.paintHullDamage(token(), cont, [coldHit]);
  assert.equal(cont._paint.layer, layer, 'same hits, same art → no rebuild');
  await P.paintHullDamage(token(), cont, [coldHit, { ...coldHit, nx: -0.25, seed: 12 }]);
  assert.notEqual(cont._paint.layer, layer, 'a new hit rebuilds');
});

await check('a faintly warm wound with no embers keeps cooling', async () => {
  // Found in Foundry: at heat 0.2 there are no ember spots (> 0.25 needed), so
  // when "warm" meant "has a ticker" the wound was never rebuilt again.
  const env = environment();
  const P = await loadPaint(env);
  const cont = new env.Container();
  await P.paintHullDamage(token(), cont, [{ ...coldHit, at: Date.now() - 144000 }]);   // heat 0.2
  assert.equal(cont._paint.embers.children.length, 0, 'no embers at 0.2');
  assert.ok(P.hullDamagePaintIsWarm(cont), 'but still warm, so the cooling rebuild keeps visiting it');
  await P.paintHullDamage(token(), cont, [{ ...coldHit, at: Date.now() - 400000 }]);   // heat 0
  assert.equal(P.hullDamagePaintIsWarm(cont), false, 'fully cooled: off the rebuild list');
  assert.equal(env.ticks.size, 0);
});

await check('a mirrored token paints the hit where it landed on screen', async () => {
  const env = environment();
  const P = await loadPaint(env);
  const centroidX = (tex) => {
    let s = 0, n = 0;
    for (let i = 0; i < tex.width * tex.height; i++) if (tex.data[i * 4 + 3] > 0) { s += i % tex.width; n++; }
    return s / n;
  };
  const plain = new env.Container(), mirrored = new env.Container();
  await P.paintHullDamage(token(), plain, [coldHit]);
  await P.paintHullDamage(token({ scaleX: -1 }), mirrored, [coldHit]);
  const w = plain._paint.W;
  assert.ok(centroidX(plain._paint.texBase) > w / 2, 'plain: right of centre in art space');
  assert.ok(centroidX(mirrored._paint.texBase) < w / 2, 'mirrored: left of centre in art space');
  assert.ok(mirrored._paint.layer.scale.x < 0, 'and the layer flips it back on screen');
});

for (const [s, n, e] of results) console.log(`${s}  ${n}${e ? '\n      ' + e : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
