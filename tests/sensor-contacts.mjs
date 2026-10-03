// node --experimental-vm-modules tests/sensor-contacts.mjs
//
// Reveal card geometry: the map bearing (0–359, clockwise from the top of the
// map) and the "mark" — a distance scaled so each range band spans ten units
// (Close 1–10, Medium 11–20, Long 21–30, Extreme 31+). zone-data.js and
// zone-dynamic.js load for real; the card/theme/terrain modules are stubbed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const results = [];
function check(name, fn) {
  try { fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

const GRID = 100;
const settings = { dynamicZoneRadiusDefault: 300 };
const flags = { dynamicZones: true, dynamicZoneRadius: 100 };
const scene = { id: 's', grid: { size: GRID }, getFlag: (_m, k) => flags[k] };
const context = vm.createContext({
  console, Math, Number, Set, Map, Array, Object, String, Proxy,
  game: { settings: { get: (_m, k) => settings[k] } },
  canvas: { scene, tokens: { placeables: [] } },
});

async function load(path) {
  return new vm.SourceTextModule(await readFile(new URL(path, import.meta.url), 'utf8'),
    { context, identifier: path });
}
function stub(names, id) {
  return new vm.SyntheticModule(names, function () {
    for (const n of names) this.setExport(n, () => {});
  }, { context, identifier: id });
}

const zoneData = await load('../scripts/zone-data.js');
const dynamic  = await load('../scripts/zone-dynamic.js');
const sensors  = await load('../scripts/sensor-contacts.js');
const stubs = {
  'lcars-theme.js':     stub(['getLcTokens'], 'lcars'),
  'chat-card-frame.js': stub(['lcarsChatCard'], 'frame'),
  'gm-authority.js':    stub(['activeGmWhisperIds'], 'gm'),
  'region-terrain.js':  stub(['REVEAL_FLAG', 'REVEALED_ATTACK_PENALTY', 'isHiddenVessel', 'isCloaked',
    'rawShroudPotency', 'shroudAtPoint', 'tokenCentre', 'featuresAtPoint', 'isConcealed'], 'terrain'),
};
const link = async spec => {
  if (spec.endsWith('zone-data.js')) return zoneData;
  if (spec.endsWith('zone-dynamic.js')) return dynamic;
  const key = Object.keys(stubs).find(k => spec.endsWith(k));
  if (key) return stubs[key];
  throw new Error(`unexpected import ${spec}`);
};
for (const m of [zoneData, dynamic, sensors]) await m.link(link);
await sensors.evaluate();
const S = sensors.namespace;

// 1×1 tokens; x/y top-left. Gap is edge to edge.
const tok = (x, y) => ({ x, y, w: GRID, h: GRID, document: { width: 1, height: 1 } });
const R = 100;
const ctx = { mode: 'dynamic', zones: [], radius: R };
const at = gap => S.contactMark(tok(0, 0), tok(GRID + gap, 0), ctx);

check('bearing: 0 up, 90 right, 180 down, 270 left', () => {
  const o = { x: 0, y: 0 };
  assert.equal(S.mapBearing(o, { x: 0, y: -10 }), 0);
  assert.equal(S.mapBearing(o, { x: 10, y: 0 }), 90);
  assert.equal(S.mapBearing(o, { x: 0, y: 10 }), 180);
  assert.equal(S.mapBearing(o, { x: -10, y: 0 }), 270);
  assert.equal(S.mapBearing(o, { x: -0.01, y: -10 }), 0);   // 359.9 rounds to 0, never 360
});

check('relative bearing: ship art is nose-south at rotation 0', () => {
  const o = { x: 0, y: 0 };
  const ship = rotation => ({ document: { rotation } });
  // Rotation 0: nose points down the map.
  assert.equal(S.relativeBearing(ship(0), o, { x: 0, y: 10 }), 0);     // dead ahead
  assert.equal(S.relativeBearing(ship(0), o, { x: 0, y: -10 }), 180);  // astern
  assert.equal(S.relativeBearing(ship(0), o, { x: -10, y: 0 }), 90);   // starboard (ship's right)
  assert.equal(S.relativeBearing(ship(0), o, { x: 10, y: 0 }), 270);   // port
  // Rotation 180: nose points up the map.
  assert.equal(S.relativeBearing(ship(180), o, { x: 0, y: -10 }), 0);
  assert.equal(S.relativeBearing(ship(180), o, { x: 10, y: 0 }), 90);
  // Rotation 90: nose points left (west).
  assert.equal(S.relativeBearing(ship(90), o, { x: -10, y: 0 }), 0);
  assert.equal(S.relativeBearing(ship(90), o, { x: 0, y: -10 }), 90);
  // Negative / wrapped rotations still land in 0–359.
  assert.equal(S.relativeBearing(ship(-180), o, { x: 0, y: -10 }), 0);
  assert.equal(S.relativeBearing(ship(540), o, { x: 0, y: -10 }), 0);
});

check('mark 0 at Contact', () => {
  assert.deepEqual({ ...at(0) }, { mark: 0, band: 'Contact' });
});

check('Close spans 1–10', () => {
  assert.equal(at(1).mark, 1);
  assert.equal(at(R).mark, 10);
  assert.equal(at(R).band, 'Close');
});

check('Medium spans 11–20, Long 21–30', () => {
  assert.equal(at(R + 1).mark, 11);
  assert.equal(at(3 * R).mark, 20);
  assert.equal(at(3 * R).band, 'Medium');
  assert.equal(at(3 * R + 1).mark, 21);
  assert.equal(at(5 * R).mark, 30);
  assert.equal(at(5 * R).band, 'Long');
});

check('Extreme continues 31–40, 41–50…', () => {
  assert.equal(at(5 * R + 1).mark, 31);
  assert.equal(at(7 * R).mark, 40);
  assert.equal(at(7 * R + 1).mark, 41);
  assert.equal(at(7 * R).band, 'Extreme');
});

check('mark never leaves its band', () => {
  for (let g = 1; g <= 12 * R; g += 7) {
    const { mark, band } = at(g);
    const tens = Math.floor((mark - 1) / 10);
    const expect = ['Close', 'Medium', 'Long'][tens] ?? 'Extreme';
    assert.equal(band, expect, `gap ${g} → mark ${mark} ${band}`);
  }
});

for (const [status, name, msg] of results) console.log(`${status}  ${name}${msg ? `\n      ${msg}` : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
