// node --experimental-vm-modules tests/zone-hazard-entry.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const posted = [];
const gm = { id: 'gm', isGM: true, active: true };
const assistant = { id: 'assistant', isGM: true, active: true };
const player = { id: 'player', isGM: false, active: true };
const users = [gm, assistant, player];
const scene = { id: 'scene', getFlag: () => undefined };
const actor = { id: 'actor', system: {} };
const tokenDoc = { id: 'token', name: 'Crew', actor, parent: scene };
let zones = [];
let crossed = new Map();
let steps = [];
const context = vm.createContext({
  console,
  game: { user: gm, users: { contents: users, get: id => users.find(u => u.id === id) },
    settings: { get: () => 'gm' } },
  canvas: { scene, tokens: { get: () => ({ document: tokenDoc, actor }) } },
  ChatMessage: { create: async data => posted.push(data) },
  foundry: { utils: { deepClone: structuredClone } },
  ui: { notifications: { warn: () => {} } },
});
const stub = exports => new vm.SyntheticModule(Object.keys(exports), function () {
  for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
}, { context });
const authority = new vm.SourceTextModule(await readFile(new URL('../scripts/gm-authority.js', import.meta.url), 'utf8'), { context });
await authority.link(() => {});
await authority.evaluate();
const deps = {
  './hazard-vfx.js': stub({ broadcastHazardVfx: () => true }),
  './hazard-vfx-config.js': stub({ HAZARD_VFX_TYPES: {}, hazardVfxFields: () => '', readHazardVfxFields: () => ({}), wireHazardVfxPreview: () => {} }),
  './gm-authority.js': authority,
  './lcars-theme.js': stub({ getLcTokens: () => ({}) }),
  './chat-card-frame.js': stub({ lcarsChatCard: ({ body }) => body }),
  './combat-hud.js': stub({ CombatHUD: {} }),
  './zone-data.js': stub({ getSceneZones: () => zones, getZonePathWithCosts: () => ({ steps }),
    updateZone: async () => {}, pointInPolygon: (x, y, v) => x >= v[0] && x <= v[1] }),
  './payment-prompt.js': stub({ PaymentPrompt: {} }),
  './pool-service.js': stub({ readPool: () => 10, setPool: async () => {} }),
  './region-terrain.js': stub({ getRegionFeatures: () => [], regionsCrossed: () => crossed,
    regionHazardView: f => f.hazard, regionContainsToken: () => true, tokenCentre: () => ({ x: 0, y: 0 }) }),
  './trait-service.js': stub({ createTraitFromData: async () => {}, postTraitCreatedCard: async () => {} }),
};
const module = new vm.SourceTextModule(await readFile(new URL('../scripts/zone-hazard.js', import.meta.url), 'utf8'), { context });
await module.link(spec => deps[spec]);
await module.evaluate();
const H = module.namespace.ZoneHazard;
zones = [{ id: 'zone', name: 'Danger', vertices: [100, 200], hazards:
  ['terrain', 'immediate', 'lingering'].map(category => ({ id: category, label: category, category })) }];
await H.onTokenMove(tokenDoc, { x: 0, y: 0 }, { x: 150, y: 0 });
assert.equal(posted.length, 1, 'entry from outside all zones posts with movement logging unset');
assert.deepEqual(Array.from(posted[0].whisper), ['gm']);
assert.equal(posted[0].flags['sta2e-toolkit'].rows.length, 3);
assert.equal(posted[0].flags['sta2e-toolkit'].reason, 'setup');
await H.onTokenMove(tokenDoc, { x: 120, y: 0 }, { x: 150, y: 0 });
await H.onTokenMove(tokenDoc, { x: 150, y: 0 }, { x: 250, y: 0 });
assert.equal(posted.length, 1, 'moving inside or leaving does not prompt');
for (const user of [assistant, player]) {
  context.game.user = user;
  await H.onTokenMove(tokenDoc, { x: 0, y: 0 }, { x: 150, y: 0 });
}
assert.equal(posted.length, 1, 'only active GM authors cards');
context.game.user = gm;
zones = [];
crossed = new Map([['region', { features: [{ hazard: { label: 'Fire', category: 'immediate',
  sourceName: 'Region', source: { kind: 'region', sceneId: 'scene', regionId: 'region', behaviorId: 'behavior' } } }] }]]);
await H.onTokenMove(tokenDoc, { x: 0, y: 0 }, { x: 150, y: 0 });
assert.equal(posted.length, 2, 'Region hazards work without drawn zones');
assert.equal(posted[1].flags['sta2e-toolkit'].rows[0].category, 'immediate');
crossed.clear();
zones = [{ id: 'zone', name: 'Danger', vertices: [100, 200], hazards: [{ id: 'fire', category: 'terrain' }] }];
let setups = 0;
H.setupHazard = async () => { setups++; return null; };
const flags = { reason: 'setup', sceneId: 'scene', tokenId: 'token', rows: [{ ref: { kind: 'zone', zoneId: 'zone', hazardId: 'fire' } }] };
const message = { flags: { 'sta2e-toolkit': flags }, update: async patch => { flags.rows = patch['flags.sta2e-toolkit.rows']; } };
await H._resolveEntryRow(message, 0, false);
assert.equal(setups, 1);
assert.equal(flags.rows[0].status, undefined, 'cancel keeps setup available');
H.setupHazard = async () => ({ damage: 1 });
await H._resolveEntryRow(message, 0, false);
assert.equal(flags.rows[0].status, 'configured', 'setup completes without applying damage');
context.game.user = assistant;
await H._markEntryRow(message, 0, 'ignored');
assert.equal(flags.rows[0].status, 'configured', 'assistant cannot change card status');
console.log('PASS: hazard entry, active GM privacy, Region support, and setup lifecycle');
