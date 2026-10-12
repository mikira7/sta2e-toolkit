// node --experimental-vm-modules tests/console-effects.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

let now = 0, nextId = 0, version = 7;
const ticks = new Set(), timers = new Map(), hooks = new Map(), emitted = [], warnings = [], animations = [];
const calls = [];
const sounds=[];
class Container {
  constructor() { this.children = []; this.position = { set: (x, y) => { this.x = x; this.y = y; } }; }
  addChild(...children) { for (const child of children) { this.children.push(child); child.parent = this; } return children[0]; }
  removeChild(child) { this.children = this.children.filter(c => c !== child); child.parent = null; }
  destroy(options) { this.destroyed = true; if (options?.children) for (const child of this.children) child.destroy(options); }
}
class Graphics extends Container {
  // PIXI 8 still exposes deprecated legacy methods; version detection must
  // choose explicit stroke/fill rather than drawing accidentally filled arcs.
  constructor() { super(); }
  clear() { return this; }
  lineStyle(...args) { calls.push(["stroke7", ...args]); return this; }
  beginFill(...args) { calls.push(["fill7", ...args]); return this; }
  endFill() { return this; }
  drawCircle(...args) { calls.push(["circle7", ...args]); return this; }
  circle(...args) { calls.push(["circle8", ...args]); return this; }
  fill(...args) { calls.push(["fill8", ...args]); return this; }
  stroke(...args) { calls.push(["stroke8", ...args]); return this; }
  moveTo(...args) { calls.push(["move", ...args]); return this; }
  lineTo(...args) { calls.push(["line", ...args]); return this; }
}
const listeners = new Map();
const document = {
  addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
  removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
};
const dispatch = (name, event) => { for (const fn of [...listeners.get(name) ?? []]) fn(event); };
const Hooks = {
  on(name, fn) { const id = ++nextId; hooks.set(id, { name, fn }); return id; },
  off(name, id) { assert.equal(hooks.get(id)?.name, name); hooks.delete(id); },
};
const hook = name => { for (const h of [...hooks.values()]) if (h.name === name) h.fn(); };
let saved = [];
const scene = { id: "bridge", name: "Bridge", getFlag: () => saved,
  setFlag: async (_module, key, value) => { assert.equal(key, "consoleEffectLocations"); saved = structuredClone(value); } };
const surface = {
  style: { cursor: "grab" }, getBoundingClientRect: () => ({ left: 50, top: 20, width: 800, height: 600 }),
  animate: () => { const a = { cancel() { this.cancelled = true; } }; animations.push(a); return a; },
};
const layer = new Container();
const canvas = { ready: true, scene, interface: layer, grid: { size: 100 },
  stage: { worldTransform: { applyInverse: p => ({ x: (p.x - 100) / 2, y: (p.y - 60) / 2 }) } },
  dimensions: { sceneRect: { contains: (x, y) => x >= 0 && x <= 1000 && y >= 0 && y <= 1000 } },
  app: { canvas: surface, renderer: { screen: { width: 800, height: 600 } },
    ticker: { add: fn => ticks.add(fn), remove: fn => ticks.delete(fn) } } };
const game = { user: { id: "gm", isGM: true }, users: new Map([["gm", { isGM: true }], ["player", { isGM: false }]]),
  socket: { emit: (channel, msg) => emitted.push({ channel, msg }) },
  settings:{get:(_module,key)=>key==="sceneEffectSoundVolume"?80:`${key}.ogg`} };
const context = vm.createContext({ console, game, canvas, document, Hooks, Math,
  AudioHelper:{play(options,broadcast){const sound={options,broadcast,stops:0,stop(){this.stops++;}};sounds.push(sound);return sound;}},
  PIXI: { Container, Graphics, VERSION: "7", Text: class extends Container {} },
  ui: { notifications: { warn: msg => warnings.push(msg), info() {} } }, performance: { now: () => now },
  crypto: { randomUUID: () => `id-${++nextId}` },
  setTimeout: fn => { const id = ++nextId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) });
const modules = new Map();
async function load(name) {
  const key = name.split("/").at(-1);
  if (modules.has(key)) return modules.get(key);
  const mod = new vm.SourceTextModule(await readFile(new URL(`../scripts/${key}`, import.meta.url), "utf8"), { context });
  modules.set(key, mod);
  await mod.link(load); return mod;
}
const mod = await load("console-effects.js"); await mod.evaluate(); const api = mod.namespace;
const picker = await load("console-effects-picker.js"); await picker.evaluate(); const pick = picker.namespace;
const tick = ms => { now += ms; for (const fn of [...ticks]) fn(); };

await Promise.all([api.saveConsoleLocation({ x: 100, y: 200 }), api.saveConsoleLocation({ x: 300, y: 400 }), api.saveConsoleLocation({ x: 500, y: 600 })]);
assert.equal(saved.length, 3, "rapid scene writes preserve every placement");
const ids = saved.map(p => p.id);
assert.equal(new Set(ids).size, 3);
await api.updateConsoleLocation(ids[0], { label: "Helm", size: 90, x: 110 });
assert.equal(api.getConsoleLocations()[0].label, "Helm");
assert.equal(api.getConsoleLocations()[0].size, 90);
assert.equal(api.getConsoleLocations()[0].y, 200);
await assert.rejects(api.saveConsoleLocation({ x: NaN, y: 2 }), /valid/);
assert.equal(saved.length, 3);
game.user.isGM = false;
await assert.rejects(api.removeConsoleLocation(ids[0]), /Only the GM/);
assert.equal(api.triggerConsoleEffects(), false);
game.user.isGM = true;
assert.equal(api.chooseConsoleLocations(api.getConsoleLocations(), 99).length, 3);
assert.equal(new Set(api.chooseConsoleLocations(api.getConsoleLocations(), 3).map(p => p.id)).size, 3);

assert.equal(api.triggerConsoleEffects({ count: 3, kind: "mixed", shake: true }), true);
assert.equal(emitted.length, 1); assert.equal(ticks.size, 3); assert.equal(animations.length, 1, "one shake per multi-console burst");
const message = emitted[0].msg;
assert.equal(message.locations.length, 3);
assert.equal(sounds.length,new Set(message.locations.map(p=>p.kind)).size+1,"one sound per type plus one shake sound");
assert.ok(sounds.every(sound=>sound.broadcast===false));
assert.equal(new Set(message.locations.map(p => p.id)).size, 3);
assert.ok(message.locations.every(p => ["electric", "explosion"].includes(p.kind)));
assert.equal(api.handleConsoleEffectSocket(message), false, "deduplicates repeated delivery");
assert.equal(api.handleConsoleEffectSocket({ ...message, id: "other-scene", sceneId: "space" }), false);
assert.equal(api.handleConsoleEffectSocket({ ...message, id: "player", userId: "player" }), false);
assert.equal(api.handleConsoleEffectSocket({ ...message, id: "invalid", locations: [{ x: 1, y: NaN, size: 50, kind: "electric" }] }), false);
assert.equal(ticks.size, 3);
tick(100); assert.ok(calls.length > 0, "native renderer draws arcs/fire/sparks");
assert.ok(calls.filter(c => ["circle7", "move", "line"].includes(c[0])).every(c => c.slice(1).every(Number.isFinite)));
tick(2500); assert.equal(ticks.size, 0); assert.equal(timers.size, 0); assert.equal(layer.children.length, 0);
await new Promise(resolve=>setImmediate(resolve));
assert.ok(sounds.filter(sound=>sound.options.src!=="sndSceneImpact.ogg").every(sound=>sound.stops===1),"natural burst completion stops console audio");

assert.equal(api.triggerConsoleEffects({ ids: [ids[0]], kind: "electric", preview: true }), true);
assert.equal(emitted.length, 1, "preview stays local");
assert.equal(layer.children[0].x, 110); assert.equal(layer.children[0].y, 200);
tick(50); assert.ok(calls.some(c => c[0] === "stroke7"));
api.stopConsoleEffects(); assert.equal(ticks.size, 0); assert.equal(animations[0].cancelled, true);
assert.equal(emitted.at(-1).msg.action, api.CONSOLE_EFFECT_STOP_ACTION);
await new Promise(resolve=>setImmediate(resolve));assert.equal(sounds.at(-1).stops,1,"Stop cancels local preview audio");

game.user.isGM = false;
assert.equal(api.handleConsoleEffectSocket({ ...message, id: "remote" }), true, "player receives all sender-selected locations");
assert.equal(api.stopConsoleEffects(), false);
assert.equal(api.handleConsoleEffectSocket({ action: api.CONSOLE_EFFECT_STOP_ACTION, userId: "gm", sceneId: "space" }), false);
assert.equal(ticks.size, 3);
assert.equal(api.handleConsoleEffectSocket({ action: api.CONSOLE_EFFECT_STOP_ACTION, userId: "gm", sceneId: "bridge" }), true);
assert.equal(ticks.size, 0);
game.user.isGM = true;

// Radius touches token edges; hidden/outside tokens stay untouched. Motion is local,
// shared by simultaneous bursts, and released on exit, cancellation and teardown.
const near = { x: 180, y: 180, w: 100, h: 100, isVisible: true, mesh: { x: 230, y: 230 } };
const far = { x: 500, y: 500, w: 100, h: 100, mesh: { x: 550, y: 550 } };
const hidden = { ...near, isVisible: false, mesh: { x: 230, y: 230 } };
canvas.tokens = { placeables: [near, far, hidden] };
for (let i = 0; i < 2; i++) api.triggerConsoleEffects({ ids: [ids[0]], kind: "electric", preview: true });
tick(100);
assert.notEqual(near.mesh.x, 230, "token whose edge intersects radius jitters");
assert.ok(Math.abs(near.mesh.x - 230) <= 2, "overlapping bursts do not accumulate offsets");
assert.equal(far.mesh.x, 550); assert.equal(hidden.mesh.x, 230);
api.stopConsoleEffectsLocal(); assert.equal(near.mesh.x, 230); assert.equal(near.mesh.y, 230);
api.triggerConsoleEffects({ ids: [ids[0]], kind: "electric", preview: true }); tick(100);
near.x = 400; near.mesh.x = 450; near.mesh.y = 230;
tick(30); assert.equal(near.mesh.x, 450, "leaving radius preserves newly assigned movement");
api.stopConsoleEffectsLocal();
near.x = 180; near.mesh.x = 230;
api.triggerConsoleEffects({ ids: [ids[0]], kind: "electric", preview: true }); tick(100); tick(2500);
assert.equal(near.mesh.x, 230, "natural completion restores token position");
canvas.tokens.placeables = [];

// Exercise the textured overlay as well as the renderer fallback above.
const sprites = [];
const portraitTexture = { orig: { width: 2048, height: 2048 } };
let portraitLoads = 0;
context.loadTexture = async path => {
  assert.equal(path, "modules/sta2e-toolkit/assets/vfx/electrocution-token.png");
  portraitLoads++; return portraitTexture;
};
context.PIXI.Sprite = class extends Container {
  constructor(texture) { super(); this.texture = texture; this.anchor = { copyFrom(value) { Object.assign(this, value); } }; sprites.push(this); }
};
context.PIXI.Point = class { constructor(x, y) { this.x = x; this.y = y; } };
context.PIXI.Matrix = class { constructor(...values) { this.values = values; } };
Container.prototype.toLocal = function(p) { return { x: p.x - (this.x ?? 0), y: p.y - (this.y ?? 0) }; };
Container.prototype.setFromMatrix = function(matrix) { this.matrix = matrix; };
near.mesh.texture = { orig: { width: 200, height: 100 } };
near.mesh.anchor = { x: .5, y: .5 };
near.mesh.toGlobal = p => ({ x: near.mesh.x + p.x * .5, y: near.mesh.y + p.y });
canvas.tokens.placeables = [near];
api.triggerConsoleEffects({ ids: [ids[0]], kind: "electric", preview: true }); tick(100);
assert.equal(sprites.length, 2, "charge reuses token texture for flash and artwork mask");
const chargeDisplay = sprites[0].parent;
assert.equal(chargeDisplay.children[2].mask, sprites[0], "crawling arcs clipped to artwork");
assert.equal(chargeDisplay.matrix.values[0], .5, "overlay follows token texture scaling");
assert.equal(sprites[1].visible, false, "original-art flash stays hidden behind skeleton");
assert.equal(near.mesh.renderable, false, "original token artwork hidden during shock");
assert.ok(chargeDisplay.children[1].alpha >= .85, "skeleton stays legible between flashes");
await new Promise(resolve => setImmediate(resolve));
const portrait = chargeDisplay.children[1].children[0];
assert.equal(portrait.texture, portraitTexture, "reference portrait replaces procedural fallback");
assert.ok(Math.abs(portrait.width - 100) < .001, "circular portrait fits the token footprint");
assert.equal(portrait.tint, 0x79baff, "token portrait receives the electrical blue tint");
api.triggerConsoleEffects({ ids: [ids[0]], kind: "electric", duration: .4, preview: true }); tick(450);
assert.equal(near.mesh.renderable, false, "ending an overlapping burst does not reveal artwork early");
api.stopConsoleEffectsLocal();
assert.equal(near.mesh.renderable, true, "last charge restores original artwork");
await new Promise(resolve => setImmediate(resolve));
assert.equal(portraitLoads, 1, "portrait texture shared across charges");
assert.ok(sprites.every(sprite => sprite.destroyed), "overlay resources released");
assert.equal(near.mesh.x, 230);
const portraitCount = sprites.filter(sprite => sprite.texture === portraitTexture).length;
api.triggerConsoleEffects({ ids: [ids[0]], kind: "electric", skeleton: false, preview: true }); tick(100);
assert.equal(near.mesh.renderable, true, "unchecked overlay keeps the original token visible");
assert.notEqual(near.mesh.x, 230, "electrical jitter still plays without skeleton");
assert.equal(sprites.filter(sprite => sprite.texture === portraitTexture).length, portraitCount,
  "unchecked overlay does not create a skeleton portrait");
api.stopConsoleEffectsLocal(); assert.equal(near.mesh.x, 230);
assert.equal(api.triggerConsoleEffects({ ids: [ids[0]], skeleton: false }), true);
assert.equal(emitted.at(-1).msg.skeleton, false, "checkbox choice is sent to other clients");
api.stopConsoleEffectsLocal();
canvas.tokens.placeables = [];

version = 8; context.PIXI.VERSION = "8";
for (const kind of ["electric", "explosion"]) {
  api.triggerConsoleEffects({ ids: [ids[0]], kind, preview: true }); tick(100);
}
assert.ok(calls.some(c => c[0] === "stroke8")); assert.ok(calls.some(c => c[0] === "fill8"));
api.registerConsoleEffectHooks(); hook("canvasTearDown");
assert.equal(ticks.size, 0); assert.equal(timers.size, 0); assert.equal(layer.children.length, 0);
for (let i = 0; i < 40; i++) api.triggerConsoleEffects({ ids: [ids[0]], preview: true });
assert.equal(ticks.size, 32, "active effect count bounded");
hook("canvasTearDown");
await new Promise(resolve=>setImmediate(resolve));
assert.ok(sounds.every(sound=>sound.stops===1),"teardown and effect limits release all sound handles");

// The placement picker converts screen positions through the zoomed/panned canvas.
let result = pick.pickConsolePosition();
const event = { target: surface, button: 0, clientX: 350, clientY: 280,
  preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
dispatch("pointerdown", event);
const point = await result;
assert.equal(point.x, 100); assert.equal(point.y, 100); assert.ok(event.prevented && event.stopped);
assert.equal(surface.style.cursor, "grab"); assert.equal(layer.children.length, 0);
assert.ok([...listeners.values()].every(set => set.size === 0));
result = pick.pickConsolePosition();
dispatch("keydown", { key: "Escape", preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(await result, null);
result = pick.pickConsolePosition(); hook("canvasTearDown"); assert.equal(await result, null);
result = pick.pickConsolePosition(); pick.cancelConsolePick(); assert.equal(await result, null);
result = pick.pickConsolePosition();
dispatch("pointerdown", { target: surface, button: 2, preventDefault() {}, stopImmediatePropagation() {} });
dispatch("contextmenu", { target: surface, preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(await result, null);
result = pick.pickConsolePosition();
dispatch("pointerdown", { ...event, clientX: 50, clientY: 20 });
assert.ok([...listeners.values()].some(set => set.size > 0), "out-of-scene click leaves picker active");
pick.cancelConsolePick(); assert.equal(await result, null);
pick.showConsoleMarkers(true); assert.equal(layer.children.length, 1);
assert.equal(layer.children[0].children.length, 4);
pick.clearConsoleMarkers(); assert.equal(layer.children.length, 0);
game.user.isGM = false; pick.showConsoleMarkers(true); assert.equal(layer.children.length, 0);
assert.equal(await pick.pickConsolePosition(), null);
game.user.isGM = true;

await api.removeConsoleLocation(ids[1]); assert.equal(saved.length, 2);
assert.ok(!api.getConsoleLocations().some(p => p.id === ids[1]));
canvas.scene = { id: "new", getFlag: () => [] };
assert.equal(api.getConsoleLocations().length, 0, "anchors belong to their saved scene");
assert.equal(api.triggerConsoleEffects(), false); assert.ok(warnings.length);
console.log("Console effects checks passed: persistence, edit permissions, distinct random selection, scene broadcasts, native PIXI 7/8 playback, previews, combined shake, limits, stop, teardown, zoomed placement, cancellation and GM markers.");
