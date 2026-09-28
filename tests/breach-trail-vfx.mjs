// node --experimental-vm-modules tests/breach-trail-vfx.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

let now = 0, mode = 'smoke', enabled = true, lastPuffs = [], destroyed = 0, breachEmitters = [];
let trailSettings = { length: 1 };
let lastJets = [];
let lastFlowPhase = 0;
const ticks = new Set(), hooks = new Map(), sampledRotations = [];
class Container {
  constructor() { this.children = []; }
  addChild(child) { this.children.push(child); return child; }
  destroy() { this.destroyed = true; }
}
const flags = { warpBreachImminent: true };
const token = { id: 'ship', w: 100, h: 100, center: { x: 0, y: 0 }, mesh: { rotation: 0 },
  visible: true, document: { id: 'ship', rotation: 180, getFlag: (_, k) => flags[k] } };
const canvas = { scene: { id: 'scene' }, tokens: Object.assign(new Container(), { placeables: [token] }),
  app: { ticker: { add: f => ticks.add(f), remove: f => ticks.delete(f) } } };
const stableMath = Object.create(Math);
stableMath.random = () => 0.5;
const context = vm.createContext({ console, Math: stableMath, Float32Array, performance: { now: () => now },
  PIXI: { Container }, canvas,
  game: { settings: { get: (_, key) => key === 'breachTrailRenderer' ? mode : enabled } },
  Hooks: { on: (name, fn) => hooks.set(name, fn) } });
const source = await readFile(new URL('../scripts/breach-trail-vfx.js', import.meta.url), 'utf8');
const module = new vm.SourceTextModule(source, { context });
await module.link(name => {
  const values = name.includes('ship-vfx-anchors') ? {
    getShipBreachEmitters: () => breachEmitters,
    getShipBreachTrailSettings: () => trailSettings,
    normalizeBreachTrailSettings: s => ({ length: Math.max(0.5, Math.min(5, Number(s?.length) || 1)) }),
    // Reproduce a ship with forward-facing warp curve tangents.
    getShipEngineEmitters: () => [{ x: 0.2, y: 0.8, facingDeg: 180 }, { x: 0.8, y: 0.8, facingDeg: 180 }],
    shipEngineEmitterToCanvasPoint: (t, a) => {
      sampledRotations.push(t.document.rotation);
      const r = t.document.rotation * Math.PI / 180;
      const x = (a.x-.5) * t.w * (t.document.texture?.scaleX ?? 1);
      const y = (a.y-.5) * t.h * (t.document.texture?.scaleY ?? 1);
      return { x: t.center.x+x*Math.cos(r)-y*Math.sin(r), y: t.center.y+x*Math.sin(r)+y*Math.cos(r) };
    },
  } : {
    MAX_BREACH_PUFFS: 160,
    createBreachSmokeRenderer: () => ({ display: {}, update: (p, jets, phase) => {
      lastPuffs = p.map(x => ({ ...x })); lastJets = jets.map(x => ({ ...x }));
      lastFlowPhase = phase;
    }, destroy: () => destroyed++ }),
  };
  return new vm.SyntheticModule(Object.keys(values), function() {
    for (const [k,v] of Object.entries(values)) this.setExport(k,v);
  }, { context });
});
await module.evaluate();
const api = module.namespace;
function advance(ms) { now += ms; for (const f of [...ticks]) f(); }
const first = api.startNativeBreachTrail(token);
assert.equal(api.startNativeBreachTrail(token), first, 'duplicate starts reuse one ticker');
advance(85);
assert.equal(lastPuffs.length, 2, 'both warp anchors emit');
assert.equal(lastJets.length, 2, 'each vent has a continuous core');
assert.ok(lastJets.every(j => j.length > j.width * 3), 'vent core forms a directional plume');
assert.ok(lastPuffs.every(p => p.vy < 0), 'default smoke flows up/aft for down-facing ships even when warp curves face forward');
assert.equal(sampledRotations[0], 0, 'uses visible mesh rotation instead of document destination');
const old = { ...lastPuffs[0] };
token.center.x = 1000; token.mesh.rotation = Math.PI/2;
advance(85);
assert.ok(Math.abs(lastPuffs[0].x-old.x) < 10, 'old smoke does not translate or rotate with ship');
assert.ok(lastPuffs.at(-1).x > 900, 'teleport emits at destination without a connecting streak');
assert.ok(lastJets.every(j => j.x > 900), 'only the nozzle cores move with the hull');
assert.equal(lastPuffs[0].angle, old.angle, 'released gas keeps its original shape direction when the ship turns');
assert.ok(sampledRotations.includes(90), 'new emitters follow the visible turn');
for (let i=0; i<800; i++) advance(16);
assert.ok(lastPuffs.length <= 160, 'particle count remains bounded');
advance(60000);
assert.ok(lastPuffs.length <= 4, 'suspended tab discards old gas without catch-up bursts');
token.visible = false; advance(16);
assert.equal(canvas.tokens.children.at(-1).visible, false, 'hidden token does not reveal exhaust');
mode = 'plasma'; api.startNativeBreachTrail(token); advance(85);
assert.equal(destroyed, 1, 'mode change releases old renderer');
assert.equal(lastPuffs.length, 1, 'underside plasma uses one vent');
api.stopNativeBreachTrail(token); api.stopNativeBreachTrail(token);
assert.equal(ticks.size, 0, 'stop is idempotent and releases ticker');

token.mesh.rotation = 0;
breachEmitters = [{ x: 0.3, y: 0.4, facingDeg: 270 }];
mode = 'smoke';
const custom = api.startNativeBreachTrail(token); advance(85);
assert.equal(lastPuffs.length, 1, 'authored vent overrides nacelle positions');
assert.equal(lastPuffs[0].x, token.center.x - 20, 'authored normalized location is used');
assert.ok(lastPuffs[0].vx < 0, 'authored port direction controls exhaust velocity');
breachEmitters = [{ x: 0.7, y: 0.3, facingDeg: 90 }];
assert.notEqual(api.startNativeBreachTrail(token), custom, 'saved anchor changes rebuild an active trail');
advance(85); assert.ok(lastPuffs[0].vx > 0, 'changed starboard direction takes effect');
api.startNativeBreachTrail(token, { preview: true, mode: 'plasma', emitters: [], duration: 200 });
assert.equal(ticks.size, 2, 'preview coexists with real breach without replacing it');
advance(85); assert.ok(lastPuffs[0].vy < 0, 'empty unsaved preview uses 0-degree aft fallback, ignoring saved vents');
advance(200); assert.equal(ticks.size, 1, 'preview timeout leaves real breach running');
api.stopNativeBreachTrail(token);
mode = 'plasma'; api.startNativeBreachTrail(token); advance(85);
assert.ok(lastPuffs[0].vx > 0, 'plasma shares custom exhaust directions');
api.stopNativeBreachTrail(token); breachEmitters = [];

mode = 'smoke';
const originalLength = api.startNativeBreachTrail(token);
trailSettings = { length: 4 };
assert.notEqual(api.startNativeBreachTrail(token), originalLength, 'changing saved length rebuilds active exhaust');
for (let i = 0; i < 60; i++) advance(85);
assert.ok(lastPuffs[0].age > 3500, 'long trail survives past original maximum lifetime');
assert.ok(lastPuffs[0].life >= 10400, '4x length scales particle persistence');
assert.ok(30 - lastPuffs[0].y > 45, 'long cone travels beyond original maximum drift distance');
api.stopNativeBreachTrail(token);
trailSettings = { length: 5 };
breachEmitters = Array.from({ length: 4 }, (_, i) => ({ x: 0.2 + i * 0.2, y: 0.5, facingDeg: 0 }));
api.startNativeBreachTrail(token);
for (let i = 0; i < 1500; i++) advance(16);
assert.ok(lastPuffs.length <= 160, 'maximum length with four vents preserves particle budget');
api.startNativeBreachTrail(token, { preview: true, settings: { length: 0.5 }, duration: 1000 });
advance(85);
assert.ok(lastPuffs.every(p => p.life <= 1750), 'preview uses unsaved length instead of saved length');
advance(1000); assert.equal(ticks.size, 1, 'short preview expires without stopping real long trail');
api.stopNativeBreachTrail(token); breachEmitters = []; trailSettings = { length: 1 };

// Compare identical emissions with fixed random variation to isolate scaling.
token.visible = true;
function emission() {
  api.stopNativeBreachTrail(token);
  lastPuffs = [];
  api.startNativeBreachTrail(token);
  for (let i = 0; i < 30 && !lastPuffs.length; i++) advance(85);
  assert.ok(lastPuffs.length, 'emitter begins within its scaled emission interval');
  return { ...lastPuffs[0] };
}
const basePuff = emission();
token.w = token.h = 2000;
const largePuff = emission();
assert.ok(largePuff.size > 80, 'large ships no longer hit the 80px size ceiling');
assert.ok(Math.abs(largePuff.size/basePuff.size - 20) < 1e-6, 'width grows with token dimensions');
assert.ok(Math.abs(largePuff.vy/basePuff.vy - Math.sqrt(20)) < 1e-6, 'large smoke speed grows gently instead of linearly with ship size');
assert.ok(Math.abs(largePuff.life/basePuff.life - Math.sqrt(20)) < 1e-6, 'large smoke lingers longer to preserve reach at reduced speed');
assert.ok(Math.abs((largePuff.vy/largePuff.drag)/(basePuff.vy/basePuff.drag) - 20) < 1e-6, 'slower smoke retains size-proportional total drift distance');
assert.ok(api.getBreachTrailPreviewDuration(token, 'smoke', { length: 1 }) > 6000, 'large smoke gets enough preview time to develop');
assert.equal(api.getBreachTrailPreviewDuration(token, 'smoke', { length: 5 }), 30000, 'preview remains bounded');
token.w = token.h = 100;
token.document.texture = { scaleX: 4, scaleY: 4 };
const texturePuff = emission();
assert.ok(Math.abs(texturePuff.size/basePuff.size - 4) < 1e-6, 'texture scaling grows puff width');
assert.ok(Math.abs(texturePuff.vy/basePuff.vy - 2) < 1e-6, 'texture scaling uses gentle smoke speed growth');
token.document.texture = { scaleX: -4, scaleY: -4 };
const mirroredPuff = emission();
assert.equal(mirroredPuff.size, texturePuff.size, 'mirroring preserves exhaust size');
assert.ok(mirroredPuff.vy > 0, 'mirrored artwork flips the exhaust direction');
token.document.texture = { scaleX: 1, scaleY: 1 };
token.w = 100; token.h = 1000;
const slenderPuff = emission();
assert.ok(slenderPuff.size > basePuff.size * 3, 'long narrow ships get visible exhaust width');
for (let i = 0; i < 57; i++) advance(85);
assert.ok(lastPuffs[0].y < token.center.y-token.h/2, 'interior vent clears a long hull before the plume fades');
assert.ok(lastPuffs[0].age/lastPuffs[0].life < 0.6, 'plume clears hull while still visible');
token.w = token.h = 200;
const oldDrag = lastPuffs[0].drag;
for (let i = 0; i < 3; i++) advance(85);
const oldSize = lastPuffs[0].size, newSize = lastPuffs.at(-1).size;
assert.equal(oldSize, slenderPuff.size, 'resizing preserves previously emitted smoke');
assert.equal(lastPuffs[0].drag, oldDrag, 'resizing does not change the drift of existing gas');
assert.ok(newSize < oldSize, 'live resizing adjusts new smoke without restarting the effect');
api.stopNativeBreachTrail(token);
token.w = token.h = 100; delete token.document.texture;

mode = 'plasma';
const smallPlasma = emission();
token.w = token.h = 2000;
const largePlasma = emission();
assert.ok(Math.abs(largePlasma.vy/smallPlasma.vy - Math.sqrt(20)) < 1e-6, 'plasma uses the same gentle scaling as smoke');
assert.ok(Math.abs(largePlasma.life/smallPlasma.life - Math.sqrt(20)) < 1e-6, 'plasma and smoke lifetime scale together');
const phaseBefore = lastFlowPhase; advance(85);
assert.ok(Math.abs(lastFlowPhase-phaseBefore - 0.085/Math.sqrt(20)) < 1e-6, 'core animation slows with the gas on large ships');
breachEmitters = [{ x: 0.5, y: 0.8, facingDeg: 0 }];
const matchingPlasma = emission();
mode = 'smoke'; const matchingSmoke = emission();
assert.equal(matchingPlasma.vy, matchingSmoke.vy, 'same vent has matching core/gas motion across smoke and plasma styles');
assert.equal(matchingPlasma.life, matchingSmoke.life, 'styles share gas persistence');
assert.equal(matchingPlasma.drag, matchingSmoke.drag, 'styles share deceleration');
mode = 'smoke'; trailSettings = { length: 5 };
breachEmitters = Array.from({ length: 4 }, (_, i) => ({ x: 0.2+i*0.2, y: 0.5, facingDeg: 0 }));
api.startNativeBreachTrail(token);
for (let i = 0; i < 1500; i++) advance(85);
assert.ok(lastPuffs.length <= 160, 'long-lived large smoke keeps the existing particle budget');
api.stopNativeBreachTrail(token);
token.w = token.h = 100; trailSettings = { length: 1 }; breachEmitters = [];

let starts = 0, stops = 0;
api.registerBreachTrailHooks(() => starts++, () => stops++);
hooks.get('canvasReady')(); assert.equal(starts, 1, 'restores warning on player scene load');
flags.warpBreachImminent = false; flags.breachTrailDestruction = true;
token.document.parent = canvas.scene; token.document.object = token;
const changes = { flags: { 'sta2e-toolkit': flags } };
hooks.get('updateToken')(token.document, changes); assert.equal(starts, 2, 'destruction vent survives cleared rules flag');
hooks.get('updateToken')(token.document, { x: 300 }); assert.equal(starts, 2, 'ordinary movement does not resynchronize effects');
flags.breachTrailDestruction = false;
hooks.get('updateToken')(token.document, changes); assert.equal(stops, 1, 'stabilization stops client exhaust');
enabled = false; flags.warpBreachImminent = true;
hooks.get('updateToken')(token.document, changes); assert.equal(stops, 2, 'master toggle respected');
enabled = true;
api.startNativeBreachTrail(token); hooks.get('canvasTearDown')();
assert.equal(ticks.size, 0, 'scene teardown releases all tickers');
api.startNativeBreachTrail(token); hooks.get('deleteToken')(token.document);
assert.equal(ticks.size, 0, 'token deletion releases renderer');
mode = 'jb2a'; assert.equal(api.startNativeBreachTrail(token), undefined, 'legacy choice never starts native renderer');
console.log('PASS: automatic token/texture scaling, hull clearance, live resizing, trail length, movement, bounds and lifecycle');
