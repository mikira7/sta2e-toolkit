// node --experimental-vm-modules tests/zone-dynamic.mjs
//
// Dynamic Zones: range bands measured edge to edge against a per-scene radius,
// used when a scene has no zone grid. zone-dynamic.js and zone-data.js are
// loaded for real; only Foundry's globals (canvas, game, scene flags) are stubbed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const results = [];
function check(name, fn) {
  try { fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

// ── Stubs ───────────────────────────────────────────────────────────────────
const GRID = 100;
function makeScene(flags = {}) {
  return { grid: { size: GRID }, getFlag: (_scope, key) => flags[key] };
}
function tok(id, x, y, w = 1, h = 1, name = id) {
  // Placeable-shaped: x/y top-left, w/h in pixels.
  return { id, name, x, y, w: w * GRID, h: h * GRID, document: { width: w, height: h, getFlag: () => undefined } };
}

const settings = { dynamicZoneRadiusDefault: 300 };
const context = vm.createContext({
  console, Math, Number, Set, Map, Array, Object, String,
  game: { settings: { get: (_m, k) => settings[k] } },
  canvas: { scene: makeScene(), tokens: { placeables: [] } },
});

async function load(path) {
  return new vm.SourceTextModule(await readFile(new URL(path, import.meta.url), 'utf8'),
    { context, identifier: path });
}
const zoneData = await load('../scripts/zone-data.js');
const dynamic  = await load('../scripts/zone-dynamic.js');
const link = async spec => {
  if (spec.endsWith('zone-data.js')) return zoneData;
  throw new Error(`unexpected import ${spec}`);
};
await zoneData.link(link);
await dynamic.link(link);
await dynamic.evaluate();
const D = dynamic.namespace;

// ── Band maths ──────────────────────────────────────────────────────────────
check('bands: Close ≤ R, Medium ≤ 3R, Long ≤ 5R, Extreme beyond', () => {
  const R = 100;
  assert.equal(D.dynamicZoneCount(0, R), 0);
  assert.equal(D.dynamicZoneCount(100, R), 0);
  assert.equal(D.dynamicZoneCount(101, R), 1);
  assert.equal(D.dynamicZoneCount(300, R), 1);
  assert.equal(D.dynamicZoneCount(301, R), 2);
  assert.equal(D.dynamicZoneCount(500, R), 2);
  assert.equal(D.dynamicZoneCount(501, R), 3);
  assert.equal(D.dynamicZoneCount(50, 0), -1);
});

check('rectGap is edge to edge, 0 when touching or overlapping', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(D.rectGap(a, { x: 100, y: 0, w: 100, h: 100 }), 0);
  assert.equal(D.rectGap(a, { x: 50, y: 50, w: 100, h: 100 }), 0);
  assert.equal(D.rectGap(a, { x: 250, y: 0, w: 100, h: 100 }), 150);
  assert.equal(D.rectGap(a, { x: 130, y: 140, w: 10, h: 10 }), 50);
});

// ── Radius resolution ───────────────────────────────────────────────────────
check('radius: scene override, else world default; blank/0/null are unset', () => {
  assert.equal(D.getDynamicZoneRadius(makeScene({ dynamicZoneRadius: 450 })), 450);
  assert.equal(D.getDynamicZoneRadius(makeScene({ dynamicZoneRadius: null })), 300);
  assert.equal(D.getDynamicZoneRadius(makeScene({ dynamicZoneRadius: '' })), 300);
  assert.equal(D.getDynamicZoneRadius(makeScene({ dynamicZoneRadius: 0 })), 300);
  assert.equal(D.getDynamicZoneRadius(makeScene({})), 300);
});

// ── Mode selection ──────────────────────────────────────────────────────────
check('context: off unless enabled; drawn zones win; zonesEnabled=false disables', () => {
  assert.equal(D.getRangeContext(makeScene({})).mode, null);
  assert.equal(D.getRangeContext(makeScene({ dynamicZones: true })).mode, 'dynamic');
  assert.equal(D.getRangeContext(makeScene({ dynamicZones: true, dynamicZoneRadius: 200 })).radius, 200);
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(D.getRangeContext(makeScene({ dynamicZones: true, zones: [{ id: 'z', vertices: square }] })).mode, 'drawn');
  assert.equal(D.getRangeContext(makeScene({ dynamicZones: true, zonesEnabled: false })).mode, null);
});

// ── Token range ─────────────────────────────────────────────────────────────
check('token range: Contact, Close, Medium, Long, Extreme', () => {
  const ctx = { mode: 'dynamic', zones: [], radius: 100 };
  const src = tok('a', 0, 0);
  const at = gapX => D.measureTokenRange(src, tok('b', 100 + gapX, 0), ctx);
  assert.equal(at(0).rangeBand, 'Contact');
  assert.equal(at(80).rangeBand, 'Close');
  assert.equal(at(250).rangeBand, 'Medium');
  assert.equal(at(450).rangeBand, 'Long');
  assert.equal(at(900).rangeBand, 'Extreme');
  assert.equal(at(250).zoneCount, 1);
  assert.equal(at(250).dynamic, true);
  assert.equal(at(250).distancePx, 250);
});

check('large hulls carry a larger zone (edge, not centre)', () => {
  const ctx = { mode: 'dynamic', zones: [], radius: 100 };
  const cube = tok('cube', 0, 0, 6, 6);          // 600px square
  const ship = tok('ship', 650, 250);             // 50px off its edge, 350px+ from its centre
  assert.equal(D.measureTokenRange(cube, ship, ctx).rangeBand, 'Close');
});

check('measureTokenRange returns null with no zone system', () => {
  assert.equal(D.measureTokenRange(tok('a', 0, 0), tok('b', 500, 0), { mode: null }), null);
});

check('point distance for the ruler', () => {
  const r = D.getDynamicZoneDistanceBetweenPoints({ x: 0, y: 0 }, { x: 300, y: 400 }, 100);
  assert.equal(r.distancePx, 500);
  assert.equal(r.rangeBand, 'Long');
});

// ── Area / same-zone queries ────────────────────────────────────────────────
check('tokensSharingZone: within radius, excludes origin, honours filter', () => {
  const primary = tok('p', 1000, 1000);
  const near    = tok('near', 1150, 1000);          // gap 50
  const edge    = tok('edge', 1000, 1300);          // gap 200 (radius exactly)
  const far     = tok('far', 1400, 1000);           // gap 300
  const ally    = tok('ally', 900, 1000);           // touching, filtered out
  context.canvas.tokens.placeables = [primary, near, edge, far, ally];
  const ctx = { mode: 'dynamic', zones: [], radius: 200 };
  const res = D.tokensSharingZone(primary, t => t.id !== 'ally', ctx);
  assert.equal(res.usingZones, true);
  assert.equal(res.dynamic, true);
  assert.deepEqual(res.targets.map(t => t.id).sort(), ['edge', 'near']);
});

check('tokensSharingZone: no zone system → usingZones false so callers fall back', () => {
  const res = D.tokensSharingZone(tok('p', 0, 0), () => true, { mode: null });
  assert.equal(res.usingZones, false);
  assert.equal(res.targets.length, 0);   // array is from the vm realm — no deepEqual
});

// ── Report ──────────────────────────────────────────────────────────────────
for (const [status, name, msg] of results) console.log(`${status}  ${name}${msg ? `\n      ${msg}` : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
