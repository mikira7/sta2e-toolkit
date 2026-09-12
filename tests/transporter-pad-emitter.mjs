// node tests/transporter-pad-emitter.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the production placement and arrival functions with Foundry services
// stubbed at their boundaries. No renderer or live world is needed.
async function source(file) {
  return (await readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8'))
    .replace(/^import\s+[\s\S]*?\sfrom\s+"[^"]+";\r?\n/gm, '')
    .replace(/^export /gm, '');
}
const calls = [], sounds = [], tokens = new Map(), timers = [];
let engine = 'shader';
const actor = { prototypeToken: { texture: { src: 'crew.webp' } } };
const effects = Object.fromEntries(['klingon', 'tngFed', 'romulan'].map(type =>
  [type, { sound: `${type}.ogg`, freeEffects: [{ file: type }] }]));
const context = vm.createContext({
  console, setTimeout: fn => timers.push(fn),
  registerSpawnTab() {}, protoHalfSize: () => ({ halfW: 50, halfH: 50 }),
  buildSpawnTokenData: async (_actor, data) => data,
  centreToTopLeft: (centre, halfW, halfH) => ({ x: centre.x - halfW, y: centre.y - halfH }),
  runTransporterShader: async (_token, type, phase) => { calls.push([type, phase]); return true; },
  TransporterVFX: { beamIn: (_token, type) => calls.push([type, 'in']) },
  Sequence: class {
    effect() { return this; }
    file(type) { calls.push([type, 'in']); return this; }
    atLocation() { return this; }
    play() {}
  },
  game: {
    actors: { get: () => actor },
    settings: { get: (_scope, key) => key === 'vfxEngine' ? engine : undefined },
    modules: { get: name => ({ active: name === 'sequencer' }) },
  },
  foundry: { audio: { AudioHelper: { play: ({ src }) => sounds.push(src) } } },
  ui: { notifications: { error: message => { throw new Error(message); }, warn() {} } },
  canvas: {
    animatePan() {}, tokens,
    scene: { regions: new Set(), async createEmbeddedDocuments(_type, [data]) {
      const token = { ...data, id: String(tokens.size), async update() {} };
      tokens.set(token.id, token);
      return [token];
    } },
  },
});
// Separate scopes retain each module's private constants.
vm.runInContext(`(() => { ${await source('zone-data.js')}
  Object.assign(globalThis, { pointInPolygon, polygonArea, polygonCentroid }); })()`, context);
vm.runInContext(`(() => { ${await source('region-pad-config.js')}
  Object.assign(globalThis, { PAD_FLAG, GROUP_FLAG, EMITTER_FLAG }); })()`, context);
vm.runInContext(`(() => { ${await source('spawn-regions.js')}
  Object.assign(globalThis, { padCentresForSlots, parseLocation }); })()`, context);
vm.runInContext(`(() => { ${await source('spawn-picker.js')}
  Object.assign(globalThis, { pickSpawnCentres }); })()`, context);
vm.runInContext(`(() => { ${await source('transporter.js')}
  Object.assign(globalThis, { _spawnGroupEntries, _beamInQueue, _materializeItems }); })()`, context);

const pad = (name, emitter, group = '') => ({
  name, bounds: { x: Number(name.match(/\d+/)?.[0] ?? 0) * 100, y: 0, width: 100, height: 100 },
  getFlag: (_scope, key) => ({ transporterPad: true, padGroup: group, transporterEmitterType: emitter })[key],
});
const group = { label: 'Away Team', transporterType: 'klingon', entries: [{ actorId: 'crew', name: 'Crew' }] };
const reset = () => { calls.length = 0; sounds.length = 0; timers.length = 0; tokens.clear(); };
async function flushTimers() { while (timers.length) await timers.shift()(); }

for (engine of ['shader', 'native', 'sequencer']) {
  reset();
  context.canvas.scene.regions = new Set([pad('Pad 1', 'tngFed')]);
  assert.equal(await context._spawnGroupEntries(group, 'romulan', 100, effects, 'circle', 'pads:'), true);
  await flushTimers();
  assert.deepEqual(calls, [['tngFed', 'in']], `${engine}: destination overrides Klingon buffer and Romulan selection`);
  assert.deepEqual(sounds, ['tngFed.ogg']);
  assert.equal(group.transporterType, 'klingon', 'departure emitter remains saved');
}
engine = 'shader';
for (const override of [undefined, '', 'unknown', '__proto__']) {
  reset();
  context.canvas.scene.regions = new Set([pad('Pad 1', override)]);
  await context._spawnGroupEntries(group, 'romulan', 100, effects, 'circle', 'pads:');
  assert.deepEqual(calls, [['klingon', 'in']], 'missing or invalid override preserves buffer emitter');
}
reset();
context.canvas.scene.regions = new Set([
  pad('Pad 10', 'romulan'), pad('Pad 2', 'tngFed'), pad('Pad 1', 'tngFed'), pad('Pad 0', 'klingon', 'Cargo'),
]);
await context._beamInQueue([{ actor, name: 'Crew', quantity: 3 }], 'klingon', 100, effects, 'circle', 'pads:');
assert.deepEqual(calls, [['tngFed', 'in'], ['tngFed', 'in'], ['romulan', 'in']], 'queue respects individual pads in natural order and selected group');
assert.deepEqual(sounds, ['tngFed.ogg', 'romulan.ogg'], 'one sound per arrival emitter');
assert.equal(tokens.get('0').x, 100);
assert.equal(tokens.get('1').x, 200);
assert.equal(tokens.get('2').x, 1000);
assert.equal(context.padCentresForSlots('', [1, 2, 3, 4]).centres, null, 'insufficient pads still abort');
reset();
await context._materializeItems([{ actor, displayName: 'Crew', halfW: 50, halfH: 50 }], [{ x: 50, y: 50 }], 'klingon', effects);
assert.deepEqual(calls, [['klingon', 'in']], 'ordinary placement keeps its emitter');
reset();
context.canvas.scene.regions = new Set([pad('Pad 1', '')]);
await context._spawnGroupEntries({ ...group, transporterType: undefined }, 'romulan', 100, effects, 'circle', 'pads:');
assert.deepEqual(calls, [['romulan', 'in']], 'legacy buffers fall back to the selected emitter');
console.log('PASS transporter destination emitter: all engines, buffer precedence, queue, pad order, sounds, and fallbacks');
