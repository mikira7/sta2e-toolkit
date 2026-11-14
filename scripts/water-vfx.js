/**
 * sta2e-toolkit | water-vfx.js
 *
 * Draws one Water Surface behavior on this client. The lifecycle is the Warp
 * Viewscreen's (attach on `behaviorViewed`, rebuild on `regionBoundary`, refresh
 * on a behavior update, sweep on `canvasReady`), with one instance per behavior
 * uuid and one ticker callback each.
 *
 * Three things it rests on:
 *
 *  - **No mask.** The bake's alpha channel is the coverage, holes included; the
 *    mesh only spans the bake's grid. A PIXI mask built polygon by polygon cannot
 *    cut an island out of the sea.
 *  - **The shore texture is the instance's own**, rebuilt only when something it
 *    encodes changes (`_bakeKey`): the shape, the reach, open edges, or the bank
 *    flow. Every other field is a uniform and costs nothing to change. The noise
 *    texture is shared and never destroyed.
 *  - **No socket.** Region and behavior documents replicate themselves; wakes are
 *    raised by each client's own `updateToken` hook (water-wake-vfx.js).
 */

import { effectLayer, passThrough, VFX_Z_BASE, parseHexColor } from "./starfield-common.js";
import { regionPolygons, regionBounds, regionContainsPoint } from "./spawn-regions.js";
import { bakeShoreField, bearingVector } from "./water-shore-field.js";
import { createWaterMesh, MAX_RIPPLES, resetWaterShaderProbe } from "./water-shader.js";
import { waterPresetDefaults } from "./water-presets.js";

const MODULE = "sta2e-toolkit";
const RIPPLE_LIFE_S = 2.6;

const _instances = new Map();

// ── Config ──────────────────────────────────────────────────────────────────

function _num(v, fb) {
  if (v === null || v === undefined || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function _rgb(c) { return [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255]; }

export function waterQuality() {
  try { return game.settings.get(MODULE, "waterQuality") ?? "high"; } catch { return "high"; }
}

/** The behavior's fields, defaulted from its preset where unset. */
export function readWaterConfig(behavior) {
  const s = behavior?.system ?? {};
  const d = waterPresetDefaults(s.preset);
  return {
    deep:          parseHexColor(String(s.deepColor ?? d.deepColor), 0x0b2f4f),
    shallow:       parseHexColor(String(s.shallowColor ?? d.shallowColor), 0x2f8fa6),
    foam:          parseHexColor(String(s.foamColor ?? d.foamColor), 0xeaf6f8),
    opacity:       _num(s.opacity, d.opacity) / 100,
    waveScale:     Math.max(0.25, _num(s.waveScale, d.waveScale)),
    waveSpeed:     _num(s.waveSpeed, d.waveSpeed) / 100,
    waveHeight:    _num(s.waveHeight, d.waveHeight) / 100,
    flowMode:      s.flowMode ?? d.flowMode,
    flowAngle:     _num(s.flowAngle, d.flowAngle),
    flowSpeed:     _num(s.flowSpeed, d.flowSpeed) / 100,
    foamWidth:     Math.max(0, _num(s.foamWidth, d.foamWidth)),
    foamIntensity: _num(s.foamIntensity, d.foamIntensity) / 100,
    depthReach:    Math.max(0.5, _num(s.depthReach, d.depthReach)),
    glow:          _num(s.glow, d.glow) / 100,
    aboveTokens:   !!s.aboveTokens,
    openEdges:     s.openEdges !== false,
    wakes:         s.wakes !== false,
    sparkles:      s.sparkles !== false,
    wakeStrength:  _num(s.wakeStrength, 60) / 100,
    swellSize:     _num(s.swellSize, d.swellSize) / 100,
    swellEvery:    Math.max(10, _num(s.swellEvery, d.swellEvery)),
    caustics:      Math.min(1, Math.max(0, _num(s.caustics, d.caustics) / 100)),
    turbulence:    Math.min(1, Math.max(0, _num(s.turbulence, d.turbulence) / 100)),
    // A set the GM called, as the shader's clock (wall clock, wrapped daily);
    // 0 once it is over two minutes old.
    swellCalled:   _calledSet(behavior),
  };
}

function _calledSet(behavior) {
  const at = Number(behavior?.flags?.[MODULE]?.swellAt);
  if (!Number.isFinite(at) || at <= 0 || Date.now() - at > 120000) return 0;
  return (at / 1000) % 86400 || 0.001;
}

function _grid() { return canvas?.dimensions?.size || 100; }

/** Everything the bake encodes — a change here needs a new shore texture. */
function _bakeKey(cfg) {
  const banks = cfg.flowMode === "followBanks";
  return [cfg.depthReach, cfg.foamWidth, cfg.openEdges, banks, banks ? cfg.flowAngle : 0, waterQuality()].join("|");
}

function _bake(region, cfg) {
  const b = regionBounds(region);
  const polys = regionPolygons(region);
  if (!b || !polys.length) return null;
  const grid = _grid();
  const reach = Math.max(cfg.depthReach, cfg.foamWidth * 2, 1) * grid;
  const maxCells = waterQuality() === "low" ? 384 : 768;
  const padGuess = cfg.foamWidth * grid * 0.8;
  const longest = Math.max(b.width, b.height) + padGuess * 2;
  const cell = Math.max(3, Math.ceil(longest / maxCells));
  const pad = padGuess + cell * 2;
  const sr = canvas?.dimensions?.sceneRect;
  return bakeShoreField(polys, b, {
    cell, reach, pad,
    openEdges: cfg.openEdges,
    sceneRect: sr ? { x: sr.x, y: sr.y, width: sr.width, height: sr.height } : null,
    flowDir: bearingVector(cfg.flowAngle),
    banks: cfg.flowMode === "followBanks",
  });
}

function _shoreTexture(field) {
  return PIXI.Texture.fromBuffer(field.data, field.width, field.height, {
    alphaMode: PIXI.ALPHA_MODES?.NO_PREMULTIPLIED_ALPHA ?? 0,
    scaleMode: PIXI.SCALE_MODES?.LINEAR ?? 1,
  });
}

// ── The flat fallback ───────────────────────────────────────────────────────
// For a client the shader probe turned away: the bake drawn once into a canvas
// as still water (depth tint and a foam line), so the coverage and its holes
// are still right.

function _fallbackSprite(field, cfg) {
  const oc = document.createElement("canvas");
  oc.width = field.width; oc.height = field.height;
  const ctx = oc.getContext("2d");
  const img = ctx.createImageData(field.width, field.height);
  const reachDepth = cfg.depthReach * _grid();
  const foamW = Math.max(1, cfg.foamWidth * _grid());
  const [dr, dg, db] = _rgb(cfg.deep), [sr, sg, sb] = _rgb(cfg.shallow), [fr, fg, fb] = _rgb(cfg.foam);
  for (let k = 0; k < field.width * field.height; k++) {
    if (!field.mask[k]) continue;
    const d = field.signed[k];
    const t = Math.min(1, Math.max(0, d / reachDepth));
    const foam = Math.max(0, 1 - d / (foamW * 0.4)) * cfg.foamIntensity;
    const mix = (a, b) => a + (b - a) * t;
    const r = mix(sr, dr), g = mix(sg, dg), bl = mix(sb, db);
    img.data[k * 4]     = 255 * (r + (fr - r) * foam);
    img.data[k * 4 + 1] = 255 * (g + (fg - g) * foam);
    img.data[k * 4 + 2] = 255 * (bl + (fb - bl) * foam);
    img.data[k * 4 + 3] = 255 * Math.min(1, cfg.opacity * (0.62 + 0.38 * t) + foam * 0.5);
  }
  ctx.putImageData(img, 0, 0);
  const sprite = new PIXI.Sprite(PIXI.Texture.from(oc));
  sprite.position.set(field.originX, field.originY);
  sprite.scale.set(field.cell, field.cell);
  return sprite;
}

// ── Instances ───────────────────────────────────────────────────────────────

function _applyUniforms(inst, cfg) {
  inst.container.zIndex = cfg.aboveTokens ? VFX_Z_BASE : -VFX_Z_BASE;
  const mesh = inst.mesh;
  if (!mesh || mesh.destroyed) return;
  const grid = _grid();
  const f = inst.field;
  const u = mesh.shader.uniforms;
  u.uShore = inst.tex;
  u.uOrigin = [f.originX, f.originY];
  u.uSize = [f.width * f.cell, f.height * f.cell];
  u.uReach = f.reach;
  u.uDeep = _rgb(cfg.deep);
  u.uShallow = _rgb(cfg.shallow);
  u.uFoam = _rgb(cfg.foam);
  u.uWave = [cfg.waveScale * grid, cfg.waveSpeed, cfg.waveHeight, waterQuality() === "low" ? 0 : 1];
  const dir = bearingVector(cfg.flowAngle);
  const mode = cfg.flowMode === "followBanks" ? 2 : cfg.flowMode === "uniform" ? 1 : 0;
  u.uFlow = [dir.x, dir.y, cfg.flowSpeed * grid * 0.35, mode];
  u.uShoreCfg = [cfg.foamWidth * grid, cfg.foamIntensity, cfg.depthReach * grid, cfg.glow];
  u.uOpacity = cfg.opacity;
  u.uSwell = [cfg.swellSize, cfg.swellEvery, inst.deepest ?? f.reach, cfg.swellCalled];
  u.uRough = cfg.turbulence;
  u.uCaustics = cfg.caustics;
  u.uSparkle = cfg.sparkles ? 1 : 0;
  u.uGrid = grid;
  u.uCell = f.cell;
  const sr = canvas?.dimensions?.sceneRect;
  u.uClip = cfg.openEdges && sr
    ? [sr.x, sr.y, sr.x + sr.width, sr.y + sr.height]
    : [-1e7, -1e7, 1e7, 1e7];
}

function _destroyDrawing(inst) {
  try { inst.mesh?.destroy?.(); } catch { /**/ }
  try { inst.sprite?.destroy?.({ children: true, texture: true, baseTexture: true }); } catch { /**/ }
  try { inst.tex?.destroy?.(true); } catch { /**/ }
  inst.mesh = inst.sprite = inst.tex = null;
}

/** (Re)bake and (re)build the drawing for an instance. */
function _build(inst) {
  const cfg = readWaterConfig(inst.behavior);
  const field = _bake(inst.region, cfg);
  _destroyDrawing(inst);
  inst.field = field;
  inst.key = _bakeKey(cfg);
  if (!field) return;
  // The deepest point inside the Region, so swells rise where they can be seen.
  let deepest = 0;
  for (let k = 0; k < field.signed.length; k++) if (field.mask[k] && field.signed[k] > deepest) deepest = field.signed[k];
  inst.deepest = deepest;
  const mesh = createWaterMesh();
  if (mesh) {
    inst.tex = _shoreTexture(field);
    mesh.position.set(field.originX, field.originY);
    mesh.scale.set(field.width * field.cell, field.height * field.cell);
    passThrough(mesh);
    inst.container.addChild(mesh);
    inst.mesh = mesh;
    _applyUniforms(inst, cfg);
  } else {
    inst.sprite = passThrough(_fallbackSprite(field, cfg));
    inst.container.addChild(inst.sprite);
    inst.container.zIndex = cfg.aboveTokens ? VFX_Z_BASE : -VFX_Z_BASE;
  }
}

function _destroyInstance(inst) {
  if (inst.finished) return;
  inst.finished = true;
  try { canvas?.app?.ticker?.remove(inst.tick); } catch { /**/ }
  _destroyDrawing(inst);
  try { inst.container.destroy({ children: true }); } catch { /**/ }
}

function _tick(inst) {
  const behavior = inst.behavior;
  if (inst.finished) return;
  if (!behavior?.parent || behavior.disabled || !inst.region?.object || inst.container.destroyed) {
    detachWater(inst.uuid);
    return;
  }
  const now = performance.now();
  const dt = Math.min(0.05, (now - inst.last) / 1000);
  inst.last = now;
  // Wall clock, not a per-client counter: swell sets are hashed from the
  // time, so every client must be on the same clock to see the same waves.
  // Wrapped daily to keep float precision in the shader.
  inst.time = (Date.now() / 1000) % 86400;

  for (const r of inst.ripples) r.age += dt;
  while (inst.ripples.length && inst.ripples[0].age > RIPPLE_LIFE_S) inst.ripples.shift();

  if (inst.mesh && !inst.mesh.destroyed) {
    const u = inst.mesh.shader.uniforms;
    u.uTime = inst.time;
    const arr = u.uRipples;
    arr.fill(0);
    const list = inst.ripples.slice(-MAX_RIPPLES);
    for (let i = 0; i < list.length; i++) {
      arr[i * 4] = list[i].x; arr[i * 4 + 1] = list[i].y;
      arr[i * 4 + 2] = list[i].age; arr[i * 4 + 3] = list[i].strength;
    }
  } else if (inst.sprite) {
    inst.sprite.alpha = 0.93 + 0.07 * Math.sin(inst.time * 0.9);
  }
}

/** Start drawing a behavior. Idempotent. */
export function attachWater(model) {
  const behavior = model?.behavior ?? model ?? null;
  const region = model?.region ?? behavior?.region ?? null;
  if (!behavior?.uuid || !region) return;
  detachWater(behavior.uuid);
  if (!region.object || !canvas?.app?.ticker) return;
  if (waterQuality() === "off") return;
  const layer = effectLayer();
  if (!layer) return;

  const container = passThrough(new PIXI.Container());
  container.sortableChildren = false;
  layer.addChild(container);
  const inst = {
    uuid: behavior.uuid, behavior, region, container,
    mesh: null, sprite: null, tex: null, field: null, key: "",
    ripples: [], time: (Date.now() / 1000) % 86400, last: performance.now(), finished: false,
  };
  inst.tick = () => _tick(inst);
  try {
    _build(inst);
  } catch (err) {
    console.error("STA2e Toolkit | Water Surface: could not build", err);
    _destroyInstance(inst);
    return;
  }
  _instances.set(inst.uuid, inst);
  canvas.app.ticker.add(inst.tick);
}

export function detachWater(uuid) {
  const inst = _instances.get(uuid);
  if (!inst) return;
  _instances.delete(uuid);
  _destroyInstance(inst);
}

/** The Region was reshaped: always re-bake. */
export function rebuildWater(model) {
  const uuid = model?.behavior?.uuid ?? model?.uuid ?? model;
  const inst = _instances.get(uuid);
  if (!inst || inst.finished) return;
  try { _build(inst); } catch (err) { console.error("STA2e Toolkit | Water Surface: rebuild failed", err); }
}

/** A field changed: re-bake only if the bake encodes it, else retune. */
export function refreshWater(behavior) {
  const inst = _instances.get(behavior?.uuid);
  if (!inst || inst.finished) return;
  inst.behavior = behavior;
  const cfg = readWaterConfig(behavior);
  if (_bakeKey(cfg) !== inst.key || !inst.mesh) { rebuildWater(behavior.uuid); return; }
  _applyUniforms(inst, cfg);
}

/** Drop everything — canvasReady / canvasTearDown. */
export function sweepWater() {
  for (const inst of _instances.values()) _destroyInstance(inst);
  _instances.clear();
  resetWaterShaderProbe();
}

/** Rebuild every live instance (the quality setting changed). */
export function rebuildAllWater() {
  for (const inst of [..._instances.values()]) {
    if (waterQuality() === "off") detachWater(inst.uuid);
    else rebuildWater(inst.uuid);
  }
}

export function isWaterActive(uuid) { return _instances.has(uuid); }

/** Instances with wakes on whose Region holds this point. */
export function waterAt(point) {
  const out = [];
  for (const inst of _instances.values()) {
    if (inst.finished || !readWaterConfig(inst.behavior).wakes) continue;
    if (regionContainsPoint(inst.region, point)) out.push(inst);
  }
  return out;
}

export function hasWakeWater() {
  for (const inst of _instances.values()) if (!inst.finished && inst.behavior?.system?.wakes !== false) return true;
  return false;
}

/** Push a wake ripple into a water instance (newest kept). */
export function addWaterRipple(uuid, x, y, strength = 1) {
  const inst = _instances.get(uuid);
  if (!inst || inst.finished) return;
  inst.ripples.push({ x, y, age: 0, strength: Math.max(0, strength) });
  if (inst.ripples.length > MAX_RIPPLES) inst.ripples.splice(0, inst.ripples.length - MAX_RIPPLES);
}
