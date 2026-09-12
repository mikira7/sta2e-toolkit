import Base from '/foundry/canvas/rendering/shaders/base-shader.mjs';
import QuadMesh from '/foundry/canvas/containers/elements/quad-mesh.mjs';
const out = document.querySelector('#results');
window.addEventListener('error', e => { out.textContent += '\nERROR: ' + e.message; });
window.addEventListener('unhandledrejection', e => { out.textContent += '\nERROR: ' + e.reason; });
const hooks = new Map(), ticks = new Set(), timers = new Map(), packets = [];
let now = 100000, serial = 0, modes = {}, playing = false, age = 0;
globalThis.Hooks = { on(k, f) { if (!hooks.has(k)) hooks.set(k, []); hooks.get(k).push(f); } };
const emit = k => { for (const f of hooks.get(k) ?? []) f(); };
globalThis.foundry = { canvas: { rendering: { shaders: { AbstractBaseShader: Base } }, containers: { QuadMesh } },
  utils: { deepClone: v => structuredClone(v), mergeObject: (a, b) => ({ ...structuredClone(a), ...b }) } };
globalThis.game = { settings: { get: (_m, key) => key === 'weaponAnimationModes' ? modes : {} },
  socket: { emit: (_key, msg) => packets.push(msg) } };
Object.defineProperty(performance, 'now', { value: () => now });
globalThis.setTimeout = (f, ms) => { const id = ++serial; timers.set(id, { f, at: now + ms }); return id; };
globalThis.clearTimeout = id => timers.delete(id);
const app = new PIXI.Application({ width: 1080, height: 650, backgroundColor: 0x080d16, antialias: true, preserveDrawingBuffer: true });
app.stop(); document.querySelector('#gallery').appendChild(app.view);
const layer = new PIXI.Container();
globalThis.canvas = { ready: true, scene: { id: 'fixture' }, grid: { size: 100 }, tokens: layer,
  app: { renderer: app.renderer, ticker: { add: f => ticks.add(f), remove: f => ticks.delete(f) } } };
const energy = await import('../scripts/ground-energy-vfx.js');
const native = await import('../scripts/native-weapon-vfx.js');
const shader = await import('../scripts/weapon-energy-shader.js');
const labels = ['Disruptor pistol · bolt', 'Disruptor rifle · beam', 'Andorian plasma rifle · bolt',
  'Particle rifle · beam', 'Phase pistol · beam', 'Pulse grenade · shockwave'];
const background = new PIXI.Graphics(); app.stage.addChild(background, layer);
for (let i = 0; i < 6; i++) {
  const x = i % 2 * 540, y = Math.floor(i / 2) * 215;
  background.lineStyle(1, 0x22374e, .5).drawRect(x + 5, y + 5, 530, 205);
  const label = new PIXI.Text(labels[i], { fontFamily: 'Arial', fontSize: 15, fill: 0xafc6df });
  label.position.set(x + 20, y + 18); app.stage.addChild(label);
  if (i !== 5) for (const px of [x + 50, x + 460]) background.lineStyle(1, 0x426079, .7).drawCircle(px, y + 115, 18);
}
function advance(ms) {
  for (let n = 0; n < ms; n += 16) {
    now += Math.min(16, ms - n);
    for (const f of [...ticks]) f();
    for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.f(); }
  }
}
function clear() { emit('canvasTearDown'); for (const c of [...layer.children]) c.destroy({ children: true }); }
function message(i, shaded = true) {
  const x = i % 2 * 540, y = Math.floor(i / 2) * 215;
  return { sceneId: 'fixture', sourcePoint: { x: x + 50, y: y + 115 },
    targetPoints: [{ x: i === 5 ? x + 270 : x + 460, y: y + 115 }],
    profile: ['disruptor', 'disruptor', 'andorian', 'particle', 'phase', 'pulse'][i],
    mode: ['bolt', 'beam', 'bolt', 'beam', 'beam', 'shockwave'][i],
    scale: [1, 1.35, 1.35, 1.35, 1, 1][i], duration: 1100, radius: 95,
    grid: 100, hit: true, shaded };
}
function start(hold = false, at = 180, fallback = false) {
  clear(); emit('canvasReady'); age = 0; playing = !hold;
  const original = foundry.canvas.containers.QuadMesh;
  if (fallback) foundry.canvas.containers.QuadMesh = null;
  for (let i = 0; i < 6; i++) energy.playGroundEnergyVfxFromSocket(message(i));
  foundry.canvas.containers.QuadMesh = original;
  advance(hold ? at : 16); app.renderer.render(app.stage);
  out.textContent = fallback ? 'Graphics fallback' : hold ? 'Shader preview paused' : 'Playing shader effects';
}
document.querySelector('#play').onclick = () => start();
document.querySelector('#hold').onclick = () => start(true);
document.querySelector('#impact').onclick = () => start(true, 420);
document.querySelector('#fallback').onclick = () => start(true, 180, true);
document.querySelector('#checks').onclick = async () => {
  playing = false; clear(); let count = 0;
  const assert = (v, m) => { if (!v) throw Error(m); count++; };
  const pixels = () => { app.renderer.render(layer); return app.renderer.extract.pixels(layer); };
  const sum = a => a.reduce((s, v, i) => s + (i % 4 === 3 ? v : 0), 0);
  try {
    emit('canvasReady');
    assert(native.getWeaponAnimationMode('weapon-ground-energy') === 'shader', 'new energy default');
    assert(native.getWeaponAnimationMode('weapon-ground-phaser') === 'current', 'existing phaser default');
    for (let i = 0; i < 6; i++) for (const shaded of [true, false]) {
      const done = energy.playGroundEnergyVfxFromSocket(message(i, shaded));
      advance(150); const a = pixels(); assert(sum(a) > 300, labels[i] + ' invisible');
      advance(70); const b = pixels(); assert(a.length !== b.length || a.some((v, k) => Math.abs(v - b[k]) > 2), labels[i] + ' static');
      assert(app.renderer.gl.getError() === 0, labels[i] + ' GL error');
      advance(2500); await done;
      assert(layer.children.length === 0 && ticks.size === 0 && timers.size === 0, labels[i] + ' leaked resources');
    }
    // Shockwave compiles as a real QuadMesh and honours world alpha.
    const c = new PIXI.Container(); layer.addChild(c);
    const wave = shader.createWeaponEnergyShockwave(c, { radius: 100 });
    assert(wave, 'shockwave shader did not compile'); wave.update(.3, .3);
    const bright = sum(pixels()); c.alpha = .25;
    assert(sum(pixels()) < bright * .4, 'shockwave alpha ignored'); c.alpha = 0;
    assert(sum(pixels()) === 0, 'zero alpha is visible'); clear();
    const token = (x, y) => ({ center: { x, y }, w: 100, h: 100, document: { parent: { id: 'fixture' } } });
    const config = { family: 'ground-pulse', groundEnergyProfile: 'pulse' };
    const blast = energy.fireGroundEnergyVFX(config, true, token(10, 10), [token(200, 200), token(400, 200)]);
    assert(packets.at(-1).targetPoints.length === 1 && packets.at(-1).radius === 250, 'AOE geometry');
    assert(layer.children.length === 1, 'AOE drew more than one blast');
    advance(2500); assert(await blast, 'AOE not claimed');
    const shots = energy.fireGroundEnergyVFX({ family: 'ground-energy', groundEnergyProfile: 'disruptor', groundFireMode: 'bolt' }, false,
      token(0, 0), [token(400, 0), token(500, 0)]);
    assert(packets.at(-1).targetPoints.every(p => p.y !== 0), 'misses landed on target');
    advance(20); clear(); await shots;
    assert(ticks.size === 0 && timers.size === 0 && layer.children.length === 0, 'teardown leaked staggered effects');
    assert(energy.playGroundEnergyVfxFromSocket({ ...message(0), sceneId: 'other' }) === false, 'wrong scene');
    assert(energy.playGroundEnergyVfxFromSocket({ ...message(0), sourcePoint: { x: NaN, y: 0 } }) === false, 'invalid geometry');
    modes = { 'weapon-ground-energy': 'current' };
    assert(await energy.fireGroundEnergyVFX({ family: 'ground-energy' }, true, token(0, 0), [token(100, 0)]) === false, 'current mode claimed'); modes = {};
    const gl = canvas.app.renderer.gl; canvas.app.renderer.gl = null;
    const fallback = energy.playGroundEnergyVfxFromSocket(message(5));
    canvas.app.renderer.gl = gl; advance(200); assert(sum(pixels()) > 300, 'no-WebGL fallback invisible');
    advance(2500); await fallback;
    out.textContent = `PASS · ${count} rendering, lifecycle, routing and Area checks`;
  } catch (err) { out.textContent = 'FAIL: ' + err.stack; modes = {}; clear(); }
};
function frame() { if (playing) { advance(16); age += 16; if (age > 1900) start(); app.renderer.render(app.stage); } requestAnimationFrame(frame); }
start(true); frame();
