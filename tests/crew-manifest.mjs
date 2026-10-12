// node --experimental-vm-modules tests/crew-manifest.mjs
//
// Crew manifest rules: one station per officer (assignOfficer / unassignOfficer)
// and the ship's company (getShipCrew, applyShipCrewRequest). crew-manifest.js
// is loaded for real; lcars-theme.js is stubbed and Foundry's globals faked.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

// ── Stubs ───────────────────────────────────────────────────────────────────
function makeActor(id, name, { type = 'character', assignment = '', ships = null, manifest = null } = {}) {
  const flags = {};
  if (ships) flags.assignedShips = ships;
  if (manifest) flags.crewManifest = manifest;
  const actor = {
    id, name, type, isToken: false,
    system: { assignment, attributes: { control: { value: 9 } }, disciplines: { conn: { value: 3 } } },
    getFlag: (_scope, key) => flags[key],
    setFlag: async (_scope, key, value) => { flags[key] = value; },
    canUserModify: () => true,
    update: async (data) => {
      for (const [path, value] of Object.entries(data)) {
        if (path === 'system.assignment') actor.system.assignment = value;
        else if (path === 'flags.sta2e-toolkit.assignedShips') flags.assignedShips = value;
        else throw new Error(`unexpected update path ${path}`);
      }
    },
    _flags: flags,
  };
  return actor;
}

const actors = new Map();
const collection = {
  get: id => actors.get(id),
  [Symbol.iterator]: () => actors.values(),
};
const context = vm.createContext({
  console, Math, Number, Set, Map, Array, Object, String, JSON, Symbol, Promise,
  game: { actors: collection, user: { id: 'u1' }, socket: { emit() {} } },
});

const lcars = new vm.SyntheticModule(['getLcTokens'], function () {
  this.setExport('getLcTokens', () => ({}));
}, { context, identifier: 'lcars-theme-stub' });
const mod = new vm.SourceTextModule(
  await readFile(new URL('../scripts/crew-manifest.js', import.meta.url), 'utf8'),
  { context, identifier: 'crew-manifest.js' });
await mod.link(async spec => {
  if (spec.endsWith('lcars-theme.js')) return lcars;
  throw new Error(`unexpected import ${spec}`);
});
await mod.evaluate();
const M = mod.namespace;

const empty = () => M.assignOfficer(null, null, null);

// ── assignOfficer ───────────────────────────────────────────────────────────
await check('assigning to a station places the officer there', () => {
  const m = M.assignOfficer(empty(), 'a', 'helm');
  assert.deepEqual([...m.helm], ['a']);
});

await check('one station per officer: moving leaves the old station', () => {
  let m = M.assignOfficer(empty(), 'a', 'helm');
  m = M.assignOfficer(m, 'a', 'tactical');
  assert.deepEqual([...m.helm], []);
  assert.deepEqual([...m.tactical], ['a']);
});

await check('a single-seat station is replaced, not refused', () => {
  let m = M.assignOfficer(empty(), 'a', 'helm');
  m = M.assignOfficer(m, 'b', 'helm');
  assert.deepEqual([...m.helm], ['b']);
});

await check('Command seats are placed by index and kept separate', () => {
  let m = M.assignOfficer(empty(), 'xo', 'command', 1);
  assert.deepEqual([...m.command], [null, 'xo']);
  m = M.assignOfficer(m, 'cap', 'command', 0);
  assert.deepEqual([...m.command], ['cap', 'xo']);
});

await check('Command with no seat index takes the first vacant seat', () => {
  let m = M.assignOfficer(empty(), 'cap', 'command', 0);
  m = M.assignOfficer(m, 'xo', 'command');
  assert.deepEqual([...m.command], ['cap', 'xo']);
});

await check('moving the Captain to Helm vacates the Captain seat', () => {
  let m = M.assignOfficer(empty(), 'cap', 'command', 0);
  m = M.assignOfficer(m, 'cap', 'helm');
  assert.deepEqual([...m.command], [null, null]);
  assert.deepEqual([...m.helm], ['cap']);
});

await check('a null station unassigns everywhere', () => {
  let m = M.assignOfficer(empty(), 'a', 'sensors');
  m = M.assignOfficer(m, 'a', null);
  assert.equal(M.findOfficerStation(m, 'a'), null);
});

await check('assignOfficer does not mutate its input', () => {
  const before = M.assignOfficer(empty(), 'a', 'helm');
  M.assignOfficer(before, 'a', 'tactical');
  assert.deepEqual([...before.helm], ['a']);
});

await check('stationLabel names the Command seats', () => {
  assert.equal(M.stationLabel('command', 0), 'Captain');
  assert.equal(M.stationLabel('command', 1), 'First Officer');
  assert.equal(M.stationLabel('operations'), 'Ops/Eng');
});

// ── getShipCrew ─────────────────────────────────────────────────────────────
actors.clear();
const ship = makeActor('ship', 'USS Valiant', { type: 'starship',
  manifest: { command: ['cap', null], helm: ['pilot'] } });
const cap     = makeActor('cap', 'Zed', { ships: ['ship'] });
const pilot   = makeActor('pilot', 'Avery');
const roster  = makeActor('roster', 'Bex', { assignment: '  uss valiant ' });
const both    = makeActor('both', 'Cato', { ships: ['ship'], assignment: 'USS Valiant' });
const other   = makeActor('other', 'Dax', { ships: ['elsewhere'], assignment: 'USS Other' });
const shipTwo = makeActor('ship2', 'USS Valiant', { type: 'starship' });  // never counted as crew
for (const a of [ship, cap, pilot, roster, both, other, shipTwo]) actors.set(a.id, a);

await check('crew is the union of flag, Assignment and manifest', () => {
  const ids = [...M.getShipCrew(ship).map(e => e.actor.id)].sort();
  assert.deepEqual(ids, ['both', 'cap', 'pilot', 'roster']);
});

await check('each crew member lists every source once', () => {
  const crew = M.getShipCrew(ship);
  const of = id => [...crew.find(e => e.actor.id === id).sources].sort();
  assert.deepEqual(of('both'), ['assignment', 'toolkit']);
  assert.deepEqual(of('cap'), ['manifest', 'toolkit']);
  assert.deepEqual(of('pilot'), ['manifest']);
  assert.deepEqual(of('roster'), ['assignment']);
});

await check('Assignment matching is trimmed and case-insensitive', () => {
  assert.ok(M.isShipCrew(ship, roster));
  assert.ok(!M.isShipCrew(ship, other));
});

await check('crew sorts Command, then stations, then unassigned by name', () => {
  const order = [...M.getShipCrew(ship).map(e => e.actor.id)];
  assert.deepEqual(order, ['cap', 'pilot', 'roster', 'both']);
});

// ── applyShipCrewRequest ────────────────────────────────────────────────────
await check('adding writes the flag and the Assignment, reporting replaced text', async () => {
  const recruit = makeActor('rec', 'Eli', { assignment: 'Chief Engineer' });
  actors.set(recruit.id, recruit);
  const replaced = await M.applyShipCrewRequest('add', ship, recruit);
  assert.equal(replaced, 'Chief Engineer');
  assert.deepEqual([...recruit._flags.assignedShips], ['ship']);
  assert.equal(recruit.system.assignment, 'USS Valiant');
});

await check('adding keeps an existing default ship first', async () => {
  const vet = makeActor('vet', 'Fen', { ships: ['elsewhere'] });
  await M.applyShipCrewRequest('add', ship, vet);
  assert.deepEqual([...vet._flags.assignedShips], ['elsewhere', 'ship']);
});

await check('removing clears this ship only, and Assignment only if it names this ship', async () => {
  const leaving = makeActor('lv', 'Gil', { ships: ['elsewhere', 'ship'], assignment: 'USS Valiant' });
  await M.applyShipCrewRequest('remove', ship, leaving);
  assert.deepEqual([...leaving._flags.assignedShips], ['elsewhere']);
  assert.equal(leaving.system.assignment, '');
  const kept = makeActor('kp', 'Hal', { ships: ['ship'], assignment: 'Science Officer' });
  await M.applyShipCrewRequest('remove', ship, kept);
  assert.equal(kept.system.assignment, 'Science Officer');
});

await check('removeShipCrew also takes them off this ship\'s stations', async () => {
  await M.removeShipCrew(ship, pilot);
  assert.equal(M.findOfficerStation(M.getCrewManifest(ship), 'pilot'), null);
});

// ── Report ──────────────────────────────────────────────────────────────────
for (const [status, name, msg] of results) console.log(`${status}  ${name}${msg ? `\n      ${msg}` : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
