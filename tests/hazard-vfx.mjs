// node --experimental-vm-modules tests/hazard-vfx.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const gm = { id: 'gm', isGM: true }, player = { id: 'player', isGM: false };
const ticks = new Set(), events = new Map(), volumes = [], audio = [], emitted = [];
let zones = [], features = [], destroyedMasks = 0;
class Container {
  constructor() { this.children = []; this.position = { set() {} }; }
  addChild(child) { this.children.push(child); child.parent = this; return child; }
  removeChild(child) { this.children = this.children.filter(c => c !== child); child.parent = null; }
  destroy() { this.destroyed = true; }
}
const stage = new Container();
const scene = { id: 's', getFlag: () => undefined };
const token = { id: 't', document: {}, visible: true, center: { x: 100, y: 100 }, w: 100, h: 100 };
const context = vm.createContext({ console, setTimeout, clearTimeout, crypto: { randomUUID: () => 'generated' },
  canvas: { ready: true, scene, interface: stage, grid: { size: 100 }, tokens: { get: () => token },
    app: { ticker: { deltaMS: 100, add: cb => ticks.add(cb), remove: cb => ticks.delete(cb) } } },
  game: { user: gm, users: { get: id => id === 'gm' ? gm : player },
    settings: { get: () => 'hazard.ogg' }, socket: { emit: (channel, msg) => emitted.push(msg) } },
  AudioHelper: { play: (args, broadcast) => audio.push({ args, broadcast }) },
  PIXI: { Container, Sprite: Container, Texture: { from: () => ({ destroy: () => destroyedMasks++ }) } },
  document: { createElement: () => ({ getContext: () => ({ scale() {}, translate() {}, beginPath() {},
    moveTo() {}, lineTo() {}, closePath() {}, fill(rule) { assert.equal(rule, 'evenodd'); } }) }) },
  Hooks: { on: (name, cb) => events.set(name, cb) },
});
const stub = exports => new vm.SyntheticModule(Object.keys(exports), function () {
  for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
}, { context });
const config = new vm.SourceTextModule(await readFile(new URL('../scripts/hazard-vfx-config.js', import.meta.url), 'utf8'), { context });
await config.link(() => {}); await config.evaluate();
const deps = {
  './hazard-vfx-config.js': config,
  './zone-data.js': stub({ getSceneZones: () => zones }),
  './region-terrain.js': stub({ getRegionFeatures: () => features, regionHazardView: f => f.hazard }),
  './spawn-regions.js': stub({ regionPolygons: r => r.polys }),
  './gm-authority.js': stub({ isActiveGM: () => context.game.user.id === 'gm', ACTIVE_GM_CHANGED_HOOK: 'activeGmChanged' }),
  './console-cinematic-vfx.js': stub({ createLocalVolume: options => {
    const v = { options, display: new Container(), update(values) { this.values = values; }, destroy() { this.destroyed = true; } };
    volumes.push(v); return v;
  } }),
};
const module = new vm.SourceTextModule(await readFile(new URL('../scripts/hazard-vfx.js', import.meta.url), 'utf8'), { context });
await module.link(spec => deps[spec]); await module.evaluate();
const V = module.namespace, C = config.namespace;
assert.equal(C.normalizeHazardVfx({}, 'radiation').color, '#6aef83');
assert.equal(C.normalizeHazardVfx({ intensity: Infinity, mode: 'bogus', color: '<html>' }).intensity, 1);
assert.equal(C.normalizeHazardVfx({ intensity: 50 }).intensity, 2);
assert.equal(C.normalizeHazardVfx({ intensity: 0 }).intensity, .25);
const poly = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }];
const hole = [{ x: 140, y: 140 }, { x: 260, y: 140 }, { x: 260, y: 260 }, { x: 140, y: 260 }];
assert.equal(V.hazardInteriorDistance({ x: 200, y: 200 }, [poly, hole]), -60);
assert.equal(V.hazardInteriorDistance({ x: 80, y: 200 }, [poly, hole]), 60);
const concave = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 80 },
  { x: 80, y: 80 }, { x: 80, y: 400 }, { x: 0, y: 400 }];
const narrow = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 20 }, { x: 0, y: 20 }];
for (const polygons of [[poly, hole], [concave], [narrow], [poly, poly.map(p => ({ x: p.x + 600, y: p.y }))]]) {
  const origins = V.electricalOrigins(polygons, V.polygonBounds(polygons), 100);
  assert.ok(origins.length > 0, 'interior origins available even in narrow shapes');
  for (const origin of origins) {
    const clearance = V.hazardInteriorDistance(origin, polygons);
    assert.ok(clearance > 0 && origin.radius < clearance, 'entire web stays inset from all boundaries and holes');
  }
}
assert.ok(V.electricalOrigins([poly], V.polygonBounds([poly]), 100).every(p => p.clearance >= 65));
zones = [{ id: 'z', vertices: poly, hazards: [
  { id: 'fire', type: 'fire', vfx: { mode: 'all' } },
  { id: 'radiation', type: 'radiation', vfx: { mode: 'gm' } },
  { id: 'gas', type: 'toxic-gas', vfx: { mode: 'off' } },
  { id: 'electric', type: 'electrical' },
] }];
assert.equal(V.collectHazardFields().length, 2);
V.syncHazardFields(); assert.equal(ticks.size, 2);
V.syncHazardFields(); assert.equal(volumes.length, 2, 'unchanged settings reuse the field');
zones[0].hazards[0].vfx.intensity = 2;
V.syncHazardFields(); assert.equal(volumes[0].destroyed, true, 'edited field releases previous renderer');
context.game.user = player;
V.syncHazardFields(); assert.equal(ticks.size, 1, 'GM-only field removed after authority changes');
features = [{ region: { id: 'r', polys: [poly, poly.map(p => ({ x: p.x / 4 + 50, y: p.y / 4 + 50 }))] },
  behavior: { id: 'b' }, hazard: { type: 'toxic-gas', vfx: { mode: 'all' } } }];
assert.equal(V.collectHazardFields().length, 2);
V.syncHazardFields(); assert.equal(ticks.size, 2, 'Region polygons and holes render');
let id = 0;
const message = (patch = {}) => ({ action: V.HAZARD_VFX_ACTION, id: String(++id), sceneId: 's', userId: 'gm',
  type: 'fire', tokenId: 't', config: { mode: 'trigger' }, ...patch });
assert.equal(V.handleHazardVfxSocket(message({ userId: 'player' })), false);
assert.equal(V.handleHazardVfxSocket(message({ sceneId: 'other' })), false);
assert.equal(V.handleHazardVfxSocket(message({ config: { mode: 'gm' } })), false);
assert.equal(V.handleHazardVfxSocket(message({ config: { mode: 'off' } })), false);
assert.equal(audio.length, 0, 'private/disabled effects do not leak audio');
token.document.hidden = true;
assert.equal(V.handleHazardVfxSocket(message()), false);
token.document.hidden = false;
const msg = message();
assert.equal(V.handleHazardVfxSocket(msg), true);
assert.equal(V.handleHazardVfxSocket(msg), false, 'duplicate socket delivery ignored');
assert.equal(audio.length, 1); assert.equal(audio[0].broadcast, false);
assert.equal(ticks.size, 3);
for (let n = 0; n < 21; n++) for (const tick of [...ticks]) tick();
assert.equal(ticks.size, 2, 'token burst removes ticker at completion');
context.game.user = gm;
assert.equal(V.broadcastHazardVfx(token, 'radiation', { sound: false }), true);
assert.equal(emitted.length, 1);
assert.equal(audio.length, 1, 'sound can be disabled');
assert.equal(V.broadcastHazardVfx(token, 'generic', {}), false, 'other hazard types retain existing renderer');
const soundKeys = [];
context.game.settings.get = (module, key) => { soundKeys.push(key); return 'hazard.ogg'; };
for (const [offset, [type, sound]] of [
  ['plasma-storm', 'sndHazardPlasmaStorm'], ['asteroid-field', 'sndHazardAsteroid'],
  ['nebula-gas', 'sndHazardNebula'], ['falling-rocks', 'sndHazardFallingRocks'],
].entries()) {
  const hz = { id: type, type, vfx: { mode: 'all' } };
  zones = [{ id: 'new-batch', vertices: poly, hazards: [hz] }]; features = [];
  V.syncHazardFields();
  assert.equal(volumes.at(-1).options.uniforms.uKind, offset + 4, `${type} uses its own shader`);
  assert.equal(volumes.at(-1).options.stableCoordinates, true, 'camera anchoring retained');
  assert.equal(V.handleHazardVfxSocket(message({ type })), true, `${type} token burst works`);
  assert.equal(soundKeys.at(-1), sound);
  assert.equal(V.handleHazardVfxSocket(message({ type, config: { mode: 'off' } })), false);
  context.game.user = player;
  assert.equal(V.handleHazardVfxSocket(message({ type, config: { mode: 'gm' } })), false);
  context.game.user = gm;
}
V.clearHazardVfx();
assert.equal(ticks.size, 0);
assert.equal(stage.children.length, 0);
assert.ok(destroyedMasks >= 4, 'mask textures released');
assert.ok(volumes.every(v => v.destroyed), 'all renderers released');
console.log('PASS: hazard settings, visibility, persistence refresh, socket delivery, audio privacy, and cleanup');
