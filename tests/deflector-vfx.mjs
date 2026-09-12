// node --experimental-vm-modules tests/deflector-vfx.mjs
//
// Drives all four deflector effects against a stubbed PIXI/canvas, checking
// that each one builds, ticks, and tears down cleanly — and that the two
// sustained types hold until stopped while the two bursts end on their own.
//
// deflector-vfx.js is loaded for real; its four imports are synthetic modules,
// so the renderer is exercised in isolation from the 4300-line anchor editor.
// The normalizers in ship-vfx-anchors.js are covered by the second half, which
// loads that file for real behind stubs of its own imports.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const results = [];
function check(name, fn) {
  try { fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

// ── Stub environment ────────────────────────────────────────────────────────
function environment() {
  let now = 100000, serial = 0;
  const timers = new Map(), ticks = new Set(), packets = [], warnings = [], sounds = [];
  const destroyed = { containers: 0, filters: 0, textures: 0 };

  class Point { constructor() { this.x = 0; this.y = 0; } set(x, y) { this.x = x; this.y = y ?? x; } }
  class Container {
    constructor() {
      this.children = []; this.alpha = 1; this.visible = true; this.zIndex = 0;
      this.filters = []; this.destroyed = false; this.position = new Point(); this.scale = new Point();
    }
    addChild(c) { this.children.push(c); c.parent = this; return c; }
    removeChild(c) { this.children = this.children.filter(x => x !== c); c.parent = null; }
    destroy() { this.destroyed = true; destroyed.containers++; this.parent?.removeChild(this); }
  }
  class Graphics extends Container {
    constructor() { super(); this.ops = 0; this.polys = []; }
    clear() { this.ops = 0; this.polys = []; return this; }
    lineStyle() { return this; }
    moveTo() { return this; }
    lineTo() { this.ops++; return this; }
    beginFill() { return this; }
    drawPolygon(pts) { this.polys.push(pts); this.ops++; return this; }
    endFill() { return this; }
  }
  class Sprite extends Container {
    constructor(texture) { super(); this.texture = texture; this.anchor = new Point(); this.rotation = 0; this.tint = 0xffffff; this._tintWrites = 0; }
    set tint(v) { this._tint = v; this._tintWrites = (this._tintWrites ?? 0) + 1; }
    get tint() { return this._tint; }
  }
  class GlowFilter { constructor(o) { Object.assign(this, o); } destroy() { this.destroyed = true; destroyed.filters++; } }

  const texture = { width: 128, height: 8, destroyed: false, destroy() { this.destroyed = true; destroyed.textures++; } };
  const PIXI = {
    Container, Graphics, Sprite, BLEND_MODES: { ADD: 1, NORMAL: 0 },
    filters: { GlowFilter },
    Texture: { from: () => ({ ...texture }) },
  };

  const scene = { id: 'scene-a' };
  const layer = new Container();
  layer.sortableChildren = false;
  const tokensLayer = Object.assign(layer, { get: () => null });

  const settings = new Map([
    ['sndDeflectorCharge', 'sounds/charge.ogg'],
    ['sndDeflectorPulse', ''],
    ['sndDeflectorBeam', ''],
    ['sndDeflectorStream', ''],
  ]);

  const game = {
    user: { id: 'gm', isGM: true, targets: new Set() },
    settings: { get: (_m, k) => { if (!settings.has(k)) throw new Error('unregistered ' + k); return settings.get(k); } },
    socket: { emit: (_c, msg) => packets.push(msg) },
  };
  const canvas = {
    scene, ready: true, tokens: tokensLayer, grid: { size: 100 },
    app: { ticker: { add: t => ticks.add(t), remove: t => ticks.delete(t) } },
  };

  const context = vm.createContext({
    console: { warn: (...s) => warnings.push(s.join(' ')), error: (...s) => warnings.push(s.join(' ')), log() {} },
    Math, Date, Number, String, Array, Object, Set, Map, Promise, JSON, Boolean, Error, isNaN,
    globalThis: undefined,
    performance: { now: () => now },
    setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { at: now + Math.max(0, ms), fn }); return id; },
    clearTimeout: id => timers.delete(id),
    PIXI, game, canvas,
    foundry: { audio: { AudioHelper: { play: (o, broadcast) => sounds.push({ ...o, broadcast }) } } },
    Hooks: { on() {} },
    ui: { notifications: { warn: s => warnings.push(s), error: s => warnings.push(s) } },
  });
  vm.runInContext('globalThis = this', context);

  function advance(ms, step = 16) {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + step);
      for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
      for (const tick of [...ticks]) tick();
    }
  }

  return { context, advance, ticks, packets, warnings, sounds, destroyed, layer, scene, game, now: () => now };
}

// A token whose emitter resolves to a moving point, so "tracks the hull" is testable.
function makeToken(env, id = 'tok') {
  return {
    id,
    document: { id, parent: env.scene, rotation: 0 },
    center: { x: 500, y: 500 },
    zIndex: 2,
    actor: { id: 'actor', name: 'USS Test' },
  };
}

const MODE = {
  chargeGlow: { colorMode: 'auto', customColor: '', alpha: 0.85, blendMode: 'add', width: 3, durationMs: 600, radiusPx: 420, coneDeg: 44, coneAlpha: 0.14, rate: 200, glowSize: 22 },
  pulse: { colorMode: 'auto', customColor: '', alpha: 0.9, blendMode: 'add', width: 18, durationMs: 400, radiusPx: 90, arcDeg: 120, ringCount: 1, expandTo: 3.2, tailLength: 4, tailAlpha: 0.5, glowSize: 20 },
  beam: { colorMode: 'auto', customColor: '', alpha: 0.95, blendMode: 'add', width: 10, durationMs: 500, beamCount: 3, spreadDeg: 7, rampMs: 100, fadeMs: 100, glowSize: 26 },
  stream: { colorMode: 'auto', customColor: '', alpha: 0.75, blendMode: 'add', width: 78, durationMs: 400, bodyAlpha: 0.22, moteSize: 12, rate: 200, speedPxPerSec: 900, glowSize: 18 },
};
const SETTINGS = { enabled: true, type: 'chargeGlow', ...MODE };
const EMITTERS = [{ x: 0.5, y: 0.2, label: 'Deflector emitter 1', facingDeg: 0, layer: 'above' }];

async function loadRenderer(env) {
  const url = new URL('../scripts/deflector-vfx.js', import.meta.url);
  const src = await readFile(url, 'utf8');
  const mod = new vm.SourceTextModule(src, { context: env.context, identifier: url.href });

  let emitterPointCalls = 0;
  const saved = { emitters: EMITTERS };
  const synth = (identifier, exports) => new vm.SyntheticModule(
    Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); },
    { context: env.context, identifier },
  );

  const boltGlows = [];
  const ribbons = [];
  const stubs = {
    './deflector-shader.js': { createDeflectorField: () => null },
    './ship-vfx-anchors.js': {
      getShipDeflectorEmitters: () => saved.emitters,
      getShipDeflectorSettings: () => SETTINGS,
      normalizeShipDeflectorSettings: (s) => s,
      resolveDeflectorColorHex: (_a, type) => (type === 'beam' ? '#57ff9a' : '#6fb6ff'),
      shipDeflectorEmitterToCanvasPoint: (tok, a) => {
        emitterPointCalls++;
        return { x: tok.center.x + a.x, y: tok.center.y + a.y, layer: a.layer };
      },
      shipEngineFacingToCanvasDeg: (_t, deg) => deg - 90,
    },
    './starfield-common.js': {
      VFX_Z_BASE: 900000,
      addBlend: () => 1,
      buildRadialTexture: () => ({ width: 128, height: 128 }),
      buildStreakTexture: () => ({ width: 64, height: 8 }),
      effectLayer: () => env.layer,
      lighten: (c) => c,
      parseHexColor: (h, f) => { const n = Number.parseInt(String(h).replace(/^#/, ''), 16); return Number.isFinite(n) ? n : f; },
    },
    './bolt-glow-vfx.js': {
      createBoltGlow: (parent) => {
        const g = { updates: 0, destroyed: false, update() { this.updates++; }, destroy() { this.destroyed = true; } };
        boltGlows.push(g); parent.addChild(new env.context.PIXI.Container()); return g;
      },
    },
    './beam-shader.js': {
      createBeamRibbon: (parent, spec) => {
        const r = {
          segments: 0, stopped: false, lastFrom: spec?.from, lastEnd: spec?.to,
          setSegment(a, b) { this.segments++; this.lastFrom = { ...a }; this.lastEnd = { ...b }; },
          setBolts() {}, stop() { this.stopped = true; },
        };
        ribbons.push(r); parent.addChild(new env.context.PIXI.Container()); return r;
      },
    },
  };

  await mod.link((spec) => {
    if (!stubs[spec]) throw new Error('unexpected import: ' + spec);
    return synth(spec, stubs[spec]);
  });
  await mod.evaluate();
  return { ns: mod.namespace, boltGlows, ribbons, saved, stats: () => ({ emitterPointCalls }) };
}

// ── Renderer tests ──────────────────────────────────────────────────────────
{
  const env = environment();
  const { ns, ribbons, saved } = await loadRenderer(env);
  const token = makeToken(env);

  // --- chargeGlow: sustained, holds, and only ends when stopped -------------
  const glow = ns.playDeflectorEffect(token, 'chargeGlow', { settings: SETTINGS, emitters: EMITTERS });
  check('chargeGlow returns a handle', () => assert.ok(glow));
  check('chargeGlow parents one container into the effect layer', () =>
    assert.equal(env.layer.children.length, 1));
  check('chargeGlow builds a cone wedge, a mote pool and a core sprite', () => {
    const c = env.layer.children[0];
    // 280 motes, a fallback wedge, and three layers of dish light.
    assert.equal(c.children.length, 284);
    assert.ok(typeof c.children[0].drawPolygon === 'function', 'wedge is not the first child');
  });
  check('chargeGlow draws its cone as a filled wedge off the dish', () => {
    env.advance(80);
    const wedge = env.layer.children[0].children[0];
    assert.equal(wedge.polys.length, 1, 'no cone polygon drawn');
    const p = wedge.polys[0];
    assert.ok(p.length >= 6, 'wedge has too few vertices');
    // Apex sits on the dish; the walls run out along the cone from there.
    assert.equal(Math.round(p[0]), 501);
  });
  check('the motes come in from well ahead of the ship', () => {
    const motes = env.layer.children[0].children.filter(c => c.visible && c.texture);
    const d = motes.map(m => Math.hypot(m.position.x - 500.5, m.position.y - 500.2));
    // The intake must actually reach out into open space, not hug the hull.
    assert.ok(Math.max(...d) > MODE.chargeGlow.radiusPx * 0.6,
      'furthest mote is only ' + Math.round(Math.max(...d)) + 'px out');
    assert.ok(Math.min(...d) < 40, 'no mote near the dish');
  });
  // The fix for "the particles go round in a half circle": every mote must run
  // a STRAIGHT ray to the dish, so its bearing from the dish is constant for its
  // whole life. The earlier angle-and-shrinking-radius version failed this.
  check('each charge mote rides a straight ray to the dish', () => {
    const motes = env.layer.children[0].children.filter(c => c.visible && c.texture);
    const bearing = (m) => Math.atan2(m.position.y - 500.2, m.position.x - 500.5);
    const before = motes.map(bearing);
    const posBefore = motes.map(m => ({ x: m.position.x, y: m.position.y }));
    env.advance(64);
    let moved = 0;
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      if (!m.visible) continue;
      // Skip a mote that recycled during the step — its ray legitimately changed.
      const d0 = Math.hypot(posBefore[i].x - 500.5, posBefore[i].y - 500.2);
      const d1 = Math.hypot(m.position.x - 500.5, m.position.y - 500.2);
      if (d1 > d0) continue;
      let dA = Math.abs(bearing(m) - before[i]);
      if (dA > Math.PI) dA = Math.PI * 2 - dA;
      assert.ok(dA < 0.02, 'mote swung ' + (dA * 180 / Math.PI).toFixed(1) + ' deg off its ray');
      moved++;
    }
    assert.ok(moved > 20, 'only ' + moved + ' motes were checked');
  });
  check('charge motes stay inside the cone, ahead of the ship', () => {
    const motes = env.layer.children[0].children.filter(c => c.visible && c.texture);
    // Axis is facing 0 -> canvas -90deg -> straight "up" from the dish.
    const halfDeg = MODE.chargeGlow.coneDeg / 2;
    for (const m of motes) {
      const dx = m.position.x - 500.5;
      const dy = m.position.y - 500.2;
      if (Math.hypot(dx, dy) < 1) continue;
      const off = Math.abs(Math.atan2(dx, -dy));   // angle from the -y axis
      assert.ok(off <= halfDeg * Math.PI / 180 + 0.02,
        'mote ' + (off * 180 / Math.PI).toFixed(1) + ' deg off axis, outside the '
        + halfDeg + ' deg wall');
      // And never behind the dish: an intake that wraps the hull is the bug.
      assert.ok(dy <= 0.01, 'mote sits behind the dish at dy ' + dy);
    }
  });
  check('chargeGlow applies a GlowFilter', () =>
    assert.equal(env.layer.children[0].filters.length, 1));
  check('chargeGlow uses a positive zIndex for an "above" emitter', () =>
    assert.ok(env.layer.children[0].zIndex >= 900000));

  env.advance(300);
  check('chargeGlow ramps its container alpha', () => {
    const a = env.layer.children[0].alpha;
    assert.ok(a > 0 && a < 0.85, `alpha was ${a}`);
  });
  check('chargeGlow registers as a live sustained effect', () =>
    assert.equal(ns.hasLiveDeflectorEffect('tok'), true));

  env.advance(3000);
  check('chargeGlow still running well past its ramp (it holds)', () =>
    assert.equal(ns.hasLiveDeflectorEffect('tok'), true));
  check('chargeGlow holds at peak alpha', () =>
    assert.equal(Math.round(env.layer.children[0].alpha * 100) / 100, 0.85));

  const aMote = () => env.layer.children[0].children.find(c => c.texture && c._tintWrites !== undefined);
  const moteTintWrites = aMote()._tintWrites;
  env.advance(1000);
  check('tint is written at seed/recycle, never per frame', () => {
    const after = aMote()._tintWrites;
    assert.ok(Number.isFinite(after), 'no mote sprite found to probe');
    assert.ok(after - moteTintWrites <= 1,
      'tint written ' + (after - moteTintWrites) + ' times over 1s');
  });

  ns.stopDeflectorEffect('tok');
  env.advance(600);
  check('chargeGlow tears down after stop', () => assert.equal(env.layer.children.length, 0));
  check('chargeGlow deregisters after stop', () =>
    assert.equal(ns.hasLiveDeflectorEffect('tok'), false));
  check('chargeGlow destroys its filter explicitly', () =>
    assert.ok(env.destroyed.filters >= 1));
  check('chargeGlow removes its ticker', () => assert.equal(env.ticks.size, 0));

  // --- the enabled gate and the sound ---------------------------------------
  check('charge sound plays locally, never broadcast', () => {
    const s = env.sounds.filter(x => x.src === 'sounds/charge.ogg');
    assert.equal(s.length, 1);
    assert.equal(s[0].broadcast, false);
  });

  const off = ns.playDeflectorEffect(token, 'chargeGlow', { settings: { ...SETTINGS, enabled: false }, emitters: EMITTERS });
  check('a disabled deflector refuses to fire, with a warning', () => {
    assert.equal(off, null);
    assert.ok(env.warnings.some(w => /disabled/.test(w)));
  });
  const preview = ns.playDeflectorEffect(token, 'chargeGlow', { settings: { ...SETTINGS, enabled: false }, emitters: EMITTERS, isPreview: true });
  check('preview bypasses the enabled gate', () => assert.ok(preview));
  preview.cleanup();

  // An editor preview fires on every slider change, so a sustained type must
  // release itself rather than holding for the full anti-stuck window.
  ns.previewDeflectorEffect(token, 'chargeGlow', SETTINGS, EMITTERS);
  env.advance(1500);
  check('a sustained preview is still running at 1.5s', () =>
    assert.equal(env.layer.children.length, 1));
  env.advance(3000);
  check('a sustained preview releases itself instead of holding', () =>
    assert.equal(env.layer.children.length, 0));
  check('a preview plays no sound', () => {
    assert.equal(env.sounds.filter(s => s.src === 'sounds/charge.ogg').length, 1);
  });

  // --- targeted types demand a target --------------------------------------
  check('pulse without a target aborts', () =>
    assert.equal(ns.playDeflectorEffect(token, 'pulse', { settings: SETTINGS, emitters: EMITTERS }), null));
  check('beam without a target aborts', () =>
    assert.equal(ns.playDeflectorEffect(token, 'beam', { settings: SETTINGS, emitters: EMITTERS }), null));
  check('an empty emitters option falls back to the saved ones', () => {
    // Same contract as spawnEngineTrail: [] means "use what is saved", not "none".
    const h = ns.playDeflectorEffect(token, 'chargeGlow', { settings: SETTINGS, emitters: [] });
    assert.ok(h);
    h.cleanup();
  });
  check('a ship with no dish placed aborts', () => {
    saved.emitters = [];
    try {
      assert.equal(ns.playDeflectorEffect(token, 'chargeGlow', { settings: SETTINGS }), null);
      assert.equal(ns.playDeflectorEffect(token, 'chargeGlow', { settings: SETTINGS, emitters: [] }), null);
    } finally { saved.emitters = EMITTERS; }
  });

  // --- pulse: a burst that ends on its own ----------------------------------
  const target = { x: 900, y: 500 };
  const pulse = ns.playDeflectorEffect(token, 'pulse', { settings: SETTINGS, emitters: EMITTERS, target });
  check('pulse builds', () => assert.ok(pulse));
  check('pulse is NOT a sustained effect', () =>
    assert.equal(ns.hasLiveDeflectorEffect('tok'), false));
  env.advance(100);
  const pulseG = () => env.layer.children[0].children.find(c => typeof c.drawPolygon === 'function');
  // The blobs live in their own sub-container, added BEFORE the Graphics so the
  // fog always draws under the front edge.
  const tailBlobs = () => (env.layer.children[0].children[0].children ?? [])
    .filter(c => c.visible && c.texture);
  const noseX = () => {
    const p = pulseG().polys[2];
    let max = -Infinity;
    for (let i = 0; i < p.length; i += 2) max = Math.max(max, p[i]);
    return max;
  };
  const spanY = () => {
    const p = pulseG().polys[2];
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i < p.length; i += 2) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); }
    return hi - lo;
  };
  check('pulse draws filled crescents, not rings', () => {
    const g = pulseG();
    assert.ok(g && g.polys.length > 0, 'no crescent polygons drawn');
  });
  check('the front is a stack of nested lenses, not one flat fill', () => {
    // Seven layers per crescent: two bloom lenses outside the arc and five
    // shrinking inward, so additive stacking peaks at the leading edge.
    assert.equal(pulseG().polys.length, 7);
  });
  check('the fog draws UNDER the front, in its own sub-container', () => {
    const kids = env.layer.children[0].children;
    assert.ok(Array.isArray(kids[0].children), 'first child is not the tail container');
    assert.ok(typeof kids[1].drawPolygon === 'function', 'the front Graphics is not on top');
    assert.ok(tailBlobs().length > 10, 'only ' + tailBlobs().length + ' fog blobs are live');
  });
  // This is the shape of the reference: one clean bright edge, turbulence only
  // behind it. Blobs sitting on or ahead of the front is the bug it replaced.
  check('every fog blob trails BEHIND the leading edge', () => {
    const p = pulseG().polys[2];       // the first lens that shares the true arc
    let nose = -Infinity;
    for (let i = 0; i < p.length; i += 2) nose = Math.max(nose, p[i]);
    for (const b of tailBlobs()) {
      assert.ok(b.position.x < nose + 1,
        'fog blob at x ' + b.position.x.toFixed(1) + ' is ahead of the front at ' + nose.toFixed(1));
    }
  });
  check('the fog thins backwards', () => {
    // Sample only near the crescent's nose. Across the whole band, x conflates
    // tail depth with arc position — a blob at a TIP also has a low x, and the
    // (1 - u^2) taper makes it small and faint for an unrelated reason.
    const near = tailBlobs().filter(b => Math.abs(b.position.y - 500.2) < 45);
    assert.ok(near.length >= 6, 'only ' + near.length + ' blobs near the nose to sample');
    const byX = [...near].sort((a, z) => a.position.x - z.position.x);
    const half = Math.floor(byX.length / 2);
    const mean = (list, f) => list.reduce((n, b) => n + f(b), 0) / list.length;
    // Alpha carries no random per-blob factor beyond churn, so the depth fade
    // shows cleanly; scale is deliberately not asserted here, since the per-blob
    // size spread that makes the fog read as filaments is 5x and swamps it.
    assert.ok(mean(byX.slice(0, half), b => b.alpha) < mean(byX.slice(half), b => b.alpha),
      'the deep tail is not fainter than the near tail');
  });
  check('the fog actually trails a distance behind the front', () => {
    const near = tailBlobs().filter(b => Math.abs(b.position.y - 500.2) < 45);
    const xs = near.map(b => b.position.x);
    // tailLength 4 x a front 18px thick, so the band must be tens of px deep —
    // a tail hugging the edge would read as a fuzzy front, not as a wake.
    assert.ok(Math.max(...xs) - Math.min(...xs) > 25,
      'the tail is only ' + Math.round(Math.max(...xs) - Math.min(...xs)) + 'px deep');
  });
  check('the fog thins to nothing at the crescent tips', () => {
    const scales = tailBlobs().map(b => b.scale.x).sort((a, z) => a - z);
    // The (1 - u^2) taper means the end blobs are a fraction of the nose ones.
    assert.ok(scales[0] < scales[scales.length - 1] * 0.5,
      'no taper across the band: ' + scales[0] + ' vs ' + scales[scales.length - 1]);
  });
  check('the crescent closes into points at both tips', () => {
    // The lens runs outer arc forward then inner arc back, and the taper drives
    // thickness to zero at u = +/-1, so the inner arc must end exactly on the
    // outer arc's first vertex.
    const p = pulseG().polys[2];
    const firstX = p[0], firstY = p[1];
    const lastX = p[p.length - 2], lastY = p[p.length - 1];
    assert.ok(Math.hypot(lastX - firstX, lastY - firstY) < 0.01,
      'inner arc does not close onto the outer tip');
  });
  check('the crescent bows toward the target, not back at the ship', () =>
    assert.ok(noseX() > 500, 'crescent nose is not downrange of the dish'));
  check('the wave slows as it crosses (ease-out, not linear)', () => {
    const a = noseX();
    env.advance(80);
    const b = noseX();
    env.advance(80);
    const c = noseX();
    assert.ok((b - a) > (c - b),
      'early leg ' + (b - a) + ' was not longer than late leg ' + (c - b));
  });
  check('the crescent swells as it goes', () => {
    const before = spanY();
    env.advance(100);
    assert.ok(spanY() > before, 'crescent did not grow');
  });
  env.advance(1200);
  check('pulse self-terminates', () => assert.equal(env.layer.children.length, 0));

  // --- beam: sustained, tracks the hull, honours the shader path ------------
  const beam = ns.playDeflectorEffect(token, 'beam', { settings: SETTINGS, emitters: EMITTERS, target });
  check('beam builds', () => assert.ok(beam));
  check('the lance is a bundle — one sub-container per beam', () =>
    assert.equal(env.layer.children[0].children.filter(c => !c.texture).length, 3));
  check('the lances fan across the target but converge at the dish', () => {
    const trio = ribbons.slice(-3);
    const ys = trio.map(r => r.lastEnd.y);
    assert.ok(Math.max(...ys) - Math.min(...ys) > 5,
      'lances landed only ' + (Math.max(...ys) - Math.min(...ys)) + 'px apart');
    const fy = trio.map(r => r.lastFrom.y);
    assert.ok(Math.max(...fy) - Math.min(...fy) < 0.01, 'lances do not share one origin');
  });
  check('beam is a sustained effect', () =>
    assert.equal(ns.hasLiveDeflectorEffect('tok'), true));
  env.advance(200);
  check('beam re-places every ribbon each frame, so it tracks a moving hull', () =>
    assert.ok(ribbons.slice(-3).every(r => r.segments > 5),
      'placements: ' + ribbons.slice(-3).map(r => r.segments).join()));
  check('beam drives its envelope through container alpha', () => {
    const a = env.layer.children[0].alpha;
    assert.ok(a > 0 && a <= 0.95, `alpha ${a}`);
  });
  env.advance(1500);
  check('beam ends after ramp+duration+fade', () => assert.equal(env.layer.children.length, 0));
  check('beam stops every ribbon handle', () =>
    assert.ok(ribbons.slice(-3).every(r => r.stopped)));

  // --- stream: emits then runs dry ------------------------------------------
  check('stream needs a target now too', () =>
    assert.equal(ns.playDeflectorEffect(token, 'stream', { settings: SETTINGS, emitters: EMITTERS }), null));
  const stream = ns.playDeflectorEffect(token, 'stream', { settings: SETTINGS, emitters: EMITTERS, target });
  check('stream builds a column body plus a mote pool', () => {
    assert.ok(stream);
    const c = env.layer.children[0];
    assert.ok(typeof c.children[0].lineTo === 'function', 'column body is not the first child');
    assert.ok(c.children.length > 10, 'no mote pool');
  });
  check('the column is wide enough for motes to spread across it', () => {
    env.advance(200);
    const motes = env.layer.children[0].children.filter(c => c.visible && c.texture);
    const ys = motes.map(m => m.position.y);
    // A 78px column should scatter its motes over a good part of its width, not
    // hold them on the axis.
    assert.ok(Math.max(...ys) - Math.min(...ys) > 26,
      'motes span only ' + (Math.max(...ys) - Math.min(...ys)) + 'px of a 78px column');
  });
  env.advance(200);
  check('stream strokes the translucent column', () =>
    assert.ok(env.layer.children[0].children[0].ops > 0, 'column body not stroked'));
  check('stream motes run INSIDE the column, toward the target', () => {
    const motes = env.layer.children[0].children.filter(c => c.visible && c.texture);
    assert.ok(motes.length > 5, 'too few live motes');
    // The column runs +x from the dish at y ~= 500. Every mote must lie along it
    // and stay within half the column width of its axis.
    for (const m of motes) {
      assert.ok(m.position.x >= 499 && m.position.x <= 901,
        'mote off the column at x ' + m.position.x);
      assert.ok(Math.abs(m.position.y - 500.2) <= 78 * 0.5 + 1,
        'mote at y ' + m.position.y + ' is outside the column wall');
    }
    assert.ok(motes.some(m => m.position.x > 560), 'no mote has travelled downrange');
  });
  env.advance(2000);
  check('stream runs dry and tears down', () => assert.equal(env.layer.children.length, 0));

  // Stop during the ramp: release from the current brightness, even when the
  // configured end is still seconds away. No brightening or lingering ticker.
  const longStream = { ...SETTINGS, stream: { ...MODE.stream, durationMs: 8000 } };
  const early = ns.playDeflectorEffect(token, 'stream', { settings: longStream, emitters: EMITTERS, target });
  env.advance(80);
  early.stop();
  env.advance(100);
  check('an early stream stop fades from its current level', () => {
    const live = env.layer.children[0].children.filter(c => c.visible && c.texture);
    assert.ok(live.length > 0);
    assert.ok(live.every(s => s.alpha <= MODE.stream.alpha * (80 / 220)));
  });
  env.advance(400);
  check('an early stream stop cleans up within its release time', () => {
    assert.equal(env.layer.children.length, 0);
    assert.equal(env.ticks.size, 0);
  });

  // Moving the source after launch must not translate or rotate the wave.
  const freeWave = ns.playDeflectorEffect(token, 'pulse', { settings: SETTINGS, emitters: EMITTERS, target });
  env.advance(100);
  const front = env.layer.children[0].children.find(c => c.polys?.length);
  const prior = JSON.stringify(front.polys);
  token.center.y += 300;
  for (const tick of env.ticks) tick(); // same timestamp, new ship position
  check('a launched pulse keeps its trajectory when the ship moves', () => assert.equal(JSON.stringify(front.polys), prior));
  token.center.y -= 300;
  freeWave.cleanup();

  const multi = ns.playDeflectorEffect(token, 'chargeGlow', { settings: SETTINGS,
    emitters: Array.from({length:4}, () => ({...EMITTERS[0]})) });
  check('multiple dishes share the particle budget', () => {
    const sprites = env.layer.children.flatMap(c=>c.children).filter(c=>c.texture);
    assert.ok(sprites.length <= 400 + 4 * 3);
  });
  multi.cleanup();

  // --- refiring replaces rather than stacking --------------------------------
  ns.playDeflectorEffect(token, 'chargeGlow', { settings: SETTINGS, emitters: EMITTERS });
  ns.playDeflectorEffect(token, 'chargeGlow', { settings: SETTINGS, emitters: EMITTERS });
  check('refiring replaces the running effect instead of stacking', () =>
    assert.equal(env.layer.children.length, 1));
  ns.stopDeflectorEffect('tok');
  env.advance(800);

  // --- broadcast payload -----------------------------------------------------
  env.packets.length = 0;
  const other = makeToken(env, 'tok2');
  other.document.parent = { id: 'scene-source' };   // token lives on ANOTHER scene
  const handle = ns.broadcastDeflectorEffect(other, 'pulse', { target });
  check('broadcast emits exactly one packet', () => assert.equal(env.packets.length, 1));
  check('broadcast stamps the SOURCE TOKEN\'S scene, not the viewed scene', () =>
    assert.equal(env.packets[0].sceneId, 'scene-source'));
  check('broadcast sends the target as coordinates, not a token id', () => {
    assert.equal(env.packets[0].targetX, 900);
    assert.equal(env.packets[0].targetY, 500);
    assert.equal(env.packets[0].tokenId, 'tok2');
    assert.equal(env.packets[0].type, 'pulse');
  });
  check('broadcast carries no look settings — clients read the flag', () => {
    assert.ok(!('settings' in env.packets[0]));
    assert.ok(!('color' in env.packets[0]));
  });
  handle.stop();
  check('the handle stop also emits a stop packet', () => {
    assert.equal(env.packets.length, 2);
    assert.equal(env.packets[1].action, 'stopDeflectorVfx');
  });
  env.advance(2000);

  env.packets.length = 0;
  ns.broadcastStopDeflectorEffect('nobody');
  check('broadcastStopDeflectorEffect emits even with nothing running', () =>
    assert.equal(env.packets.length, 1));

  check('no unexpected console errors during the whole run', () => {
    const unexpected = env.warnings.filter(w => !/aborted|disabled/.test(String(w)));
    assert.deepEqual(unexpected, []);
  });
}

// ── Normalizer tests (the real ship-vfx-anchors.js) ─────────────────────────
{
  const context = vm.createContext({
    console: { warn() {}, error() {}, log() {} },
    Math, Date, Number, String, Array, Object, Set, Map, Promise, JSON, Boolean, Error, isNaN,
    globalThis: undefined, setTimeout: () => 0, clearTimeout() {},
    game: { settings: { get: () => 0 }, user: { isGM: true } },
    canvas: null, ui: { notifications: {} }, Hooks: { on() {} },
    foundry: { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B } } },
    PIXI: {}, CONFIG: {},
  });
  vm.runInContext('globalThis = this', context);

  const url = new URL('../scripts/ship-vfx-anchors.js', import.meta.url);
  const mod = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href });
  const synth = (id, exports) => new vm.SyntheticModule(
    Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); },
    { context, identifier: id },
  );
  const noop = () => {};
  await mod.link((spec) => synth(spec, {
    hasPointDefenseSystem: () => false,
    normalizeWarpEffectStyleId: (v) => v ?? 'standard',
    getWarpEffectStyleOptions: () => [{ value: 'standard' }],
    resolveShipWarpEffectStyleId: () => 'standard',
    resolveActorFactionKey: () => null,
    getDestructibleConfig: noop, objectTokenDocument: noop, saveDestructibleConfig: noop,
    normalizeDestructible: () => ({}),
    objectPanelHtml: () => '', readObjectPanel: noop, wireObjectPanel: noop,
    saveObjectPanel: noop, previewObjectPanel: noop,
  }));
  await mod.evaluate();
  const A = mod.namespace;

  check('an empty flag gains the deflector block with defaults', () => {
    const out = A.normalizeShipVfxAnchors({});
    assert.equal(out.anchors.deflectorEmitters.length, 0);
    assert.equal(out.settings.deflector.enabled, true);
    assert.equal(out.settings.deflector.type, 'chargeGlow');
  });

  check('a v14 flag with no deflector key normalizes rather than throwing', () => {
    const legacy = { version: 14, anchors: { engineEmitters: [] }, settings: { engineTrail: {} } };
    const out = A.normalizeShipVfxAnchors(legacy);
    assert.equal(out.version, 15);
    assert.ok(out.settings.deflector.beam);
  });

  check('each type carries only its own dials', () => {
    const d = A.normalizeShipDeflectorSettings({});
    // The cone belongs to the charge, the crescent to the pulse, the fan to the
    // lance and the column to the stream — and none of them leaks.
    assert.ok('coneDeg' in d.chargeGlow && 'radiusPx' in d.chargeGlow);
    assert.ok(!('rampMs' in d.chargeGlow) && !('arcDeg' in d.chargeGlow));
    assert.ok('arcDeg' in d.pulse && 'ringCount' in d.pulse);
    assert.ok('tailLength' in d.pulse && 'tailAlpha' in d.pulse);
    assert.ok(!('coneDeg' in d.pulse) && !('beamCount' in d.pulse));
    assert.ok(!('tailLength' in d.beam) && !('tailAlpha' in d.stream));
    assert.ok('beamCount' in d.beam && 'spreadDeg' in d.beam && 'rampMs' in d.beam);
    assert.ok(!('arcDeg' in d.beam) && !('swirlTurns' in d.beam));
    assert.ok('bodyAlpha' in d.stream && 'moteSize' in d.stream && 'speedPxPerSec' in d.stream);
    assert.ok(!('ringCount' in d.stream) && !('coneDeg' in d.stream));
  });

  check('every type shares the six common dials', () => {
    const d = A.normalizeShipDeflectorSettings({});
    for (const t of A.DEFLECTOR_EFFECT_TYPES) {
      for (const k of ['colorMode', 'customColor', 'alpha', 'blendMode', 'width', 'durationMs']) {
        assert.ok(k in d[t], `${t} is missing ${k}`);
      }
    }
  });

  check('out-of-range dials are clamped, not passed through', () => {
    const d = A.normalizeShipDeflectorSettings({
      pulse: { alpha: 99, ringCount: -4, expandTo: 1000, arcDeg: 9999 },
      beam: { beamCount: 99, spreadDeg: -5 },
      chargeGlow: { coneDeg: 0, coneAlpha: 4 },
    });
    assert.equal(d.pulse.alpha, 1);
    assert.equal(d.pulse.ringCount, 1);
    assert.equal(d.pulse.expandTo, 20);
    assert.equal(d.pulse.arcDeg, 360);
    assert.equal(d.beam.beamCount, 12);
    assert.equal(d.beam.spreadDeg, 0);
    assert.equal(d.chargeGlow.coneDeg, 5);
    assert.equal(d.chargeGlow.coneAlpha, 1);
  });

  check('the shipped defaults carry the reshaped look', () => {
    const d = A.normalizeShipDeflectorSettings({});
    assert.equal(d.stream.width, 78, 'the stream column was not widened');
    assert.ok(d.chargeGlow.radiusPx >= 400, 'the intake does not reach into open space');
    assert.equal(d.pulse.ringCount, 1, 'the pulse still fires as a stack of ripples');
    assert.ok(d.pulse.tailLength > 0, 'the pulse has no trailing fog');
  });

  // The dial was removed rather than defaulted to 0, so that a ship SAVED while
  // it still existed stops swirling on the next read instead of carrying the old
  // value forever. _normalizeDeflectorModeSettings only emits dials the type's
  // own defaults declare, which is what makes that work.
  check('a saved swirl value is dropped, not carried forward', () => {
    const d = A.normalizeShipDeflectorSettings({ chargeGlow: { swirlTurns: 0.35 } });
    assert.ok(!('swirlTurns' in d.chargeGlow), 'swirlTurns survived normalization');
  });

  check('an unknown effect type falls back to chargeGlow', () =>
    assert.equal(A.normalizeShipDeflectorSettings({ type: 'phaser' }).type, 'chargeGlow'));

  check('a deflector emitter defaults to facing FORE (0), unlike an exhaust', () => {
    const out = A.normalizeShipVfxAnchors({ anchors: { deflectorEmitters: [{ x: 0.5, y: 0.2 }] } });
    assert.equal(out.anchors.deflectorEmitters[0].facingDeg, 0);
    assert.equal(out.anchors.deflectorEmitters[0].layer, 'above');
  });

  check('emitter coordinates are clamped into 0..1 image space', () => {
    const out = A.normalizeShipVfxAnchors({ anchors: { deflectorEmitters: [{ x: 5, y: -2 }] } });
    assert.equal(out.anchors.deflectorEmitters[0].x, 1);
    assert.equal(out.anchors.deflectorEmitters[0].y, 0);
  });

  check('the lance keeps its green regardless of faction; the rest take the tint', () => {
    assert.equal(A.resolveDeflectorColorHex(null, 'beam'), '#57ff9a');
    assert.equal(A.resolveDeflectorColorHex(null, 'chargeGlow'), '#6fb6ff');
  });

  check('a custom hex wins over both', () =>
    assert.equal(A.resolveDeflectorColorHex(null, 'beam', { colorMode: 'custom', customColor: '#ABCDEF' }), '#abcdef'));

  check('normalizing is idempotent', () => {
    const once = A.normalizeShipVfxAnchors({ anchors: { deflectorEmitters: [{ x: 0.3, y: 0.4 }] } });
    assert.equal(JSON.stringify(A.normalizeShipVfxAnchors(once)), JSON.stringify(once));
  });
}

// ── Report ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => r[0] === 'FAIL');
for (const [status, name, msg] of results) {
  console.log(`${status}  ${name}${msg ? `\n      ${msg}` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
