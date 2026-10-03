// node --experimental-vm-modules tests/region-terrain.mjs
//
// Region Terrain: Difficult Terrain / Hazard / Sensor Shroud behaviors on
// Regions. region-terrain.js and zone-data.js are loaded for real; the region
// geometry module (spawn-regions.js) is replaced by an even-odd stub over plain
// polygon lists, and Foundry's globals are stubbed.
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
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

let nextId = 0;
function region(name, polys, behaviors) {
  const r = { id: `r${nextId++}`, name, polys, behaviors: [] };
  r.behaviors = behaviors.map(b => ({ id: `b${nextId++}`, disabled: false, ...b, parent: r }));
  return r;
}
const TERRAIN = 'sta2e-toolkit.difficultTerrain';
const HAZARD  = 'sta2e-toolkit.terrainHazard';
const SHROUD  = 'sta2e-toolkit.sensorShroud';

function tokenDoc(x, y, flags = {}, extra = {}) {
  return {
    x, y, width: 1, height: 1, hidden: false, parent: scene,
    getFlag: (_s, k) => flags[k], ...extra,
  };
}

const scene = { id: 'scene1', grid: { size: GRID }, regions: [] };
const context = vm.createContext({
  console, Math, Number, Set, Map, Array, Object, String,
  canvas: { scene, grid: { size: GRID } },
});

async function load(path) {
  return new vm.SourceTextModule(await readFile(new URL(path, import.meta.url), 'utf8'),
    { context, identifier: path });
}
const zoneData = await load('../scripts/zone-data.js');
const terrain  = await load('../scripts/region-terrain.js');
let pip;
const spawnRegions = new vm.SyntheticModule(['regionContainsPoint'], function () {
  this.setExport('regionContainsPoint', (r, { x, y }) => {
    let n = 0;
    for (const verts of r.polys) if (pip(x, y, verts)) n++;
    return n % 2 === 1;
  });
}, { context, identifier: 'spawn-regions-stub' });

const link = async spec => {
  if (spec.endsWith('zone-data.js')) return zoneData;
  if (spec.endsWith('spawn-regions.js')) return spawnRegions;
  throw new Error(`unexpected import ${spec}`);
};
await zoneData.link(link);
await zoneData.evaluate();
pip = zoneData.namespace.pointInPolygon;
await terrain.link(link);
await terrain.evaluate();
const T = terrain.namespace;

function setRegions(...rs) {
  scene.regions = rs;
  T.invalidateRegionFeatures();
}

// ── Movement cost ───────────────────────────────────────────────────────────
check('crossing a Difficult Terrain Region is charged once', () => {
  setRegions(region('Debris', [rect(300, 0, 200, 400)], [{ type: TERRAIN, system: { momentumCost: 2 } }]));
  const r = T.regionMovementCost({ x: 100, y: 200 }, { x: 900, y: 200 }, scene);
  assert.equal(r.cost, 2);
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].kind, 'difficult');
});

check('a Region containing the origin is not charged (leaving is free)', () => {
  setRegions(region('Debris', [rect(0, 0, 400, 400)], [{ type: TERRAIN, system: { momentumCost: 2 } }]));
  const r = T.regionMovementCost({ x: 100, y: 200 }, { x: 900, y: 200 }, scene);
  assert.equal(r.cost, 0);
});

check('a move that misses the Region costs nothing', () => {
  setRegions(region('Debris', [rect(300, 500, 200, 200)], [{ type: TERRAIN, system: { momentumCost: 3 } }]));
  assert.equal(T.regionMovementCost({ x: 100, y: 200 }, { x: 900, y: 200 }, scene).cost, 0);
});

check('max cost wins within one Region — two behaviors never double-charge', () => {
  setRegions(region('Minefield', [rect(300, 0, 200, 400)], [
    { type: TERRAIN, system: { momentumCost: 1 } },
    { type: HAZARD, system: { hazardType: 'minefield', category: 'terrain', momentumCost: 3, established: {} } },
  ]));
  const r = T.regionMovementCost({ x: 100, y: 200 }, { x: 900, y: 200 }, scene);
  assert.equal(r.cost, 3);
  assert.equal(r.entries[0].kind, 'hazardous');
  assert.equal(r.terrainHazards.length, 1);
  assert.equal(r.terrainHazards[0].source.kind, 'region');
});

check('two Regions crossed are charged separately', () => {
  setRegions(
    region('A', [rect(200, 0, 100, 400)], [{ type: TERRAIN, system: { momentumCost: 1 } }]),
    region('B', [rect(600, 0, 100, 400)], [{ type: TERRAIN, system: { momentumCost: 2 } }]),
  );
  assert.equal(T.regionMovementCost({ x: 100, y: 200 }, { x: 900, y: 200 }, scene).cost, 3);
});

check('a hole in the Region is excluded', () => {
  // A doughnut: moving about inside the hole crosses no terrain; coming in from
  // outside has to cross the ring.
  setRegions(region('Ring', [rect(200, 0, 600, 400), rect(300, 100, 400, 200)],
    [{ type: TERRAIN, system: { momentumCost: 2 } }]));
  assert.equal(T.regionMovementCost({ x: 400, y: 200 }, { x: 600, y: 200 }, scene).cost, 0);
  assert.equal(T.regionMovementCost({ x: 100, y: 200 }, { x: 500, y: 200 }, scene).cost, 2);
});

check('a disabled behavior is ignored', () => {
  setRegions(region('Debris', [rect(300, 0, 200, 400)], [{ type: TERRAIN, disabled: true, system: { momentumCost: 2 } }]));
  assert.equal(T.regionMovementCost({ x: 100, y: 200 }, { x: 900, y: 200 }, scene).cost, 0);
});

check('lingering hazards entered are reported; immediate ones are not', () => {
  setRegions(region('Radiation', [rect(300, 0, 200, 400)], [
    { type: HAZARD, system: { hazardType: 'radiation', category: 'lingering', established: {} } },
    { type: HAZARD, system: { hazardType: 'fire', category: 'immediate', established: {} } },
  ]));
  const r = T.regionMovementCost({ x: 100, y: 200 }, { x: 900, y: 200 }, scene);
  assert.equal(r.lingeringHazards.length, 1);
  assert.equal(r.lingeringHazards[0].type, 'radiation');
  assert.equal(r.cost, 0);
});

check('regionHazardView flattens established state', () => {
  setRegions(region('Storm', [rect(0, 0, 10, 10)], [
    { type: HAZARD, system: { hazardType: 'plasma-storm', category: 'terrain', label: '',
      established: { established: true, damage: 4, damageType: 'shields', threatCost: 3, mode: 'damage' } } },
  ]));
  const [f] = T.getRegionFeatures(scene, 'hazard');
  const v = T.regionHazardView(f);
  assert.equal(v.label, 'Plasma Storm');
  assert.equal(v.established, true);
  assert.equal(v.establishedDamage, 4);
  assert.equal(v.establishedThreatCost, 3);
});

// ── Sensor Shroud ───────────────────────────────────────────────────────────
check('shroud potency applies to a token inside, per purpose', () => {
  setRegions(region('Nebula', [rect(0, 0, 500, 500)], [
    { type: SHROUD, system: { potency: 3, hideTokens: true, affectSensors: true, affectAttacks: false } },
  ]));
  const inside = tokenDoc(100, 100);
  assert.equal(T.shroudPotencyForToken(inside, { purpose: 'hide' }), 3);
  assert.equal(T.shroudPotencyForToken(inside, { purpose: 'sensor' }), 3);
  assert.equal(T.shroudPotencyForToken(inside, { purpose: 'attack' }), 0);
  assert.equal(T.shroudPotencyForToken(tokenDoc(800, 800), { purpose: 'hide' }), 0);
});

check('a revealed token reads potency 0 for hiding, not for sensors', () => {
  setRegions(region('Nebula', [rect(0, 0, 500, 500)], [
    { type: SHROUD, system: { potency: 2, hideTokens: true, affectSensors: true, affectAttacks: true } },
  ]));
  const revealed = tokenDoc(100, 100, { sensorRevealed: { x: 150, y: 150 } });
  assert.equal(T.shroudPotencyForToken(revealed, { purpose: 'hide' }), 0);
  assert.equal(T.shroudPotencyForToken(revealed, { purpose: 'sensor' }), 2);
  assert.equal(T.isHiddenVessel(revealed), false);
  assert.equal(T.isHiddenVessel(tokenDoc(100, 100)), true);
});

check('attack Difficulty: revealed hidden vessel +2, otherwise +potency, never both', () => {
  setRegions(region('Nebula', [rect(0, 0, 500, 500)], [
    { type: SHROUD, system: { potency: 3, hideTokens: true, affectSensors: true, affectAttacks: true } },
  ]));
  assert.equal(T.concealmentAttackDifficulty(tokenDoc(100, 100)).mod, 3);
  assert.equal(T.concealmentAttackDifficulty(tokenDoc(100, 100, { sensorRevealed: { x: 1, y: 1 } })).mod, 2);
  // A cloaked ship outside any shroud, revealed: +2
  setRegions();
  const cloaked = tokenDoc(900, 900, { sensorRevealed: { x: 1, y: 1 } }, { hidden: true });
  assert.equal(T.concealmentAttackDifficulty(cloaked).mod, 2);
  assert.equal(T.concealmentAttackDifficulty(tokenDoc(900, 900)).mod, 0);
});

check('sharesShroud: two tokens in the same hiding shroud', () => {
  setRegions(
    region('Nebula', [rect(0, 0, 500, 500)], [{ type: SHROUD, system: { potency: 2, hideTokens: true } }]),
    region('Storm', [rect(1000, 0, 500, 500)], [{ type: SHROUD, system: { potency: 2, hideTokens: true } }]),
  );
  assert.equal(T.sharesShroud(tokenDoc(100, 100), tokenDoc(300, 300)), true);
  assert.equal(T.sharesShroud(tokenDoc(100, 100), tokenDoc(1100, 100)), false);
});

check('hiddenWithinShroud: a thick shroud hides even from tokens inside it', () => {
  setRegions(
    region('Nebula', [rect(0, 0, 500, 500)], [{ type: SHROUD, system: { potency: 2, hideTokens: true } }]),
    region('Core', [rect(0, 0, 200, 200)], [{ type: SHROUD, system: { potency: 4, hideTokens: true, hideWithinShroud: true } }]),
    region('Veil', [rect(1000, 0, 500, 500)], [{ type: SHROUD, system: { potency: 2, hideTokens: false, hideWithinShroud: true } }]),
  );
  assert.equal(T.hiddenWithinShroud(tokenDoc(100, 100)), true);
  assert.equal(T.hiddenWithinShroud(tokenDoc(300, 300)), false, 'The ordinary shroud keeps its same-shroud exception');
  assert.equal(T.sharesShroud(tokenDoc(100, 100), tokenDoc(300, 300)), true, 'Sharing the outer shroud does not lift the inner one');
  assert.equal(T.hiddenWithinShroud(tokenDoc(1100, 100)), false, 'The switch means nothing without Hide Tokens');
});

check('multi-zone token is covered by any footprint corner', () => {
  setRegions(region('Nebula', [rect(0, 0, 500, 500)], [{ type: SHROUD, system: { potency: 2, hideTokens: true } }]));
  const big = { x: 450, y: 450, width: 4, height: 4, hidden: false, parent: scene,
    getFlag: (_s, k) => (k === 'multiZone' ? true : undefined) };
  const smallSameCentre = { ...big, getFlag: () => undefined };
  assert.equal(T.rawShroudPotency(big, 'hide'), 2);
  assert.equal(T.rawShroudPotency(smallSameCentre, 'hide'), 0);
});

// ── Report ──────────────────────────────────────────────────────────────────
for (const [status, name, msg] of results) console.log(`${status}  ${name}${msg ? `\n      ${msg}` : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
