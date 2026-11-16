/**
 * sta2e-toolkit | forcefield-vfx.js
 *
 * Draws the forcefield on every flagged door wall of the viewed scene, ramps it
 * up and down with the door, plays its sounds, and flares it where a token runs
 * into it. The rules (flags, styles, geometry, ramp) are forcefield-data.js; the
 * GLSL is forcefield-shader.js.
 *
 * Four things it rests on:
 *
 *  - **No socket.** The field follows the door's `ds`, a document field, so
 *    `updateWall` fires on every client and each ramps, sounds and flares for
 *    itself — exactly the light-toggle-sound.js rule. Broadcasting as well
 *    would play every cue once per client.
 *  - **It lives in canvas.primary, not canvas.tokens.** The token layer is in
 *    the interface group, above the fog: a permanent effect there would show
 *    every locked door in an unexplored room. Primary is under the fog and
 *    sorts by `elevation` then `sortLayer`, which is also how "under tokens" /
 *    "over tokens" is done — one sort layer either side of TOKENS.
 *  - **The container is `eventMode: "none"`**, or a field over the tokens
 *    would take the pointer from them (the painted hull damage trap).
 *  - **A ramp starts only from a ds change.** A scene draw, a flag edit or a
 *    move of the wall rebuilds at the current power, so reopening a scene
 *    never replays every field coming up.
 */

import {
  FF_RAMP_DOWN_MS, FF_RAMP_UP_MS,
  forcefieldConfig, isFieldUp, isForcefieldWall, moveHitsWall, rampPower, riseFlicker, wallQuad,
} from "./forcefield-data.js";
import { createForcefieldMesh, FF_MAX_HITS, resetForcefieldShaderProbe } from "./forcefield-shader.js";

/** wallId → instance, for the viewed scene only. */
const _instances = new Map();
let _ticking = false;
let _last = 0;

const _gridSize = () => canvas?.dimensions?.size ?? canvas?.grid?.size ?? 100;

function _sortLayers() {
  const T = foundry?.canvas?.groups?.PrimaryCanvasGroup?.SORT_LAYERS?.TOKENS ?? 700;
  return { above: T + 1, below: T - 50 };
}

function _baseElevation() {
  const e = canvas?.level?.elevation?.base;
  return Number.isFinite(e) ? e : 0;
}

function _passThrough(o) {
  try { o.eventMode = "none"; o.interactive = false; o.interactiveChildren = false; } catch { /**/ }
  return o;
}

function _rgbNum(rgb) {
  const [r, g, b] = rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255));
  return (r << 16) | (g << 8) | b;
}

// ── Build / destroy ─────────────────────────────────────────────────────────

function _layer() {
  return canvas?.primary ?? null;
}

function _build(doc, power) {
  const layer = _layer();
  if (!layer) return null;
  const cfg = forcefieldConfig(doc);
  const quad = wallQuad(doc.c, _gridSize(), cfg.thickness);
  if (!quad) return null;

  const container = _passThrough(new PIXI.Container());
  const layers = _sortLayers();
  container.elevation = _baseElevation();
  container.sortLayer = cfg.above ? layers.above : layers.below;
  container.sort = 0;

  const inst = {
    wallId: doc.id, doc, cfg, quad, container,
    mesh: null, gfx: null,
    power, ramp: null, flicker: 1, flash: 0,
    hits: [],
    seed: (parseInt(String(doc.id).slice(-6), 36) % 1000) / 1000 || Math.random(),
  };

  const mesh = createForcefieldMesh();
  if (mesh) {
    _passThrough(mesh);
    mesh.position.set(quad.x, quad.y);
    mesh.rotation = quad.rotation;
    mesh.pivot.set(0, 0.5);            // local units: centres the quad on the wall
    mesh.scale.set(quad.length, quad.thick);
    const u = mesh.shader.uniforms;
    u.uLen = quad.length; u.uThick = quad.thick; u.uPad = quad.pad; u.uSeg = quad.seg;
    u.uGrid = _gridSize();
    u.uColor = cfg.color; u.uCore = cfg.core;
    u.uIntensity = cfg.intensity; u.uPattern = cfg.pattern; u.uSeed = inst.seed;
    container.addChild(mesh);
    inst.mesh = mesh;
  } else {
    inst.gfx = _passThrough(new PIXI.Graphics());
    container.addChild(inst.gfx);
  }

  layer.addChild(container);
  layer.sortDirty = true;
  _apply(inst, performance.now(), 0);
  return inst;
}

function _destroy(inst) {
  if (!inst) return;
  try { inst.container.parent?.removeChild(inst.container); } catch { /**/ }
  try { inst.container.destroy({ children: true }); } catch { /**/ }
}

function _rebuild(doc) {
  const old = _instances.get(doc.id);
  const keep = old ? { power: old.power, ramp: old.ramp, hits: old.hits } : null;
  _destroy(old);
  _instances.delete(doc.id);
  if (!isForcefieldWall(doc)) { _syncTicker(); return; }
  const inst = _build(doc, keep ? keep.power : (isFieldUp(doc) ? 1 : 0));
  if (!inst) { _syncTicker(); return; }
  if (keep) { inst.ramp = keep.ramp; inst.hits = keep.hits; }
  _instances.set(doc.id, inst);
  _syncTicker();
}

function _destroyAll() {
  for (const inst of _instances.values()) _destroy(inst);
  _instances.clear();
  _syncTicker();
}

function _buildAll() {
  _destroyAll();
  const walls = canvas?.scene?.walls;
  if (!walls) return;
  for (const doc of walls) if (isForcefieldWall(doc)) _rebuild(doc);
}

// ── Frame ───────────────────────────────────────────────────────────────────

function _apply(inst, now, dt) {
  if (inst.ramp) {
    const r = rampPower(inst.ramp, now);
    inst.power = r.power;
    inst.flicker = r.rising ? riseFlicker(r.k, inst.seed, now) : 1;
    inst.flash = r.rising ? 0 : Math.sin(Math.PI * Math.min(1, r.k * 1.4)) * (r.k < 0.72 ? 1 : 0);
    if (!r.moving) { inst.ramp = null; inst.flicker = 1; inst.flash = 0; }
  }
  for (const h of inst.hits) h.age += dt;
  inst.hits = inst.hits.filter(h => h.age < 1.2);

  const shown = inst.power * inst.flicker;
  if (inst.mesh) {
    const u = inst.mesh.shader.uniforms;
    u.uTime = now / 1000;
    u.uPower = shown;
    u.uFlash = inst.flash;
    const arr = u.uHits;
    arr.fill(0);
    inst.hits.slice(-FF_MAX_HITS).forEach((h, i) => {
      arr[i * 4] = h.along; arr[i * 4 + 1] = h.across; arr[i * 4 + 2] = h.age; arr[i * 4 + 3] = h.strength;
    });
  } else if (inst.gfx) {
    _drawFallback(inst, shown, now);
  }
}

/** A client the probe turns away gets a glowing line: same colours, same ramp. */
function _drawFallback(inst, shown, now) {
  const g = inst.gfx;
  const [x0, y0, x1, y1] = inst.doc.c;
  const pulse = 0.85 + 0.15 * Math.sin(now / 180 + inst.seed * 6);
  const k = inst.cfg.intensity;
  g.clear();
  const line = (w, col, a) => {
    if (typeof g.lineStyle === "function") { g.lineStyle(w, col, a); g.moveTo(x0, y0); g.lineTo(x1, y1); }
    else { g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke({ width: w, color: col, alpha: a }); }
  };
  if (shown > 0.01) {
    line(inst.quad.thick * 0.55 * shown, _rgbNum(inst.cfg.color), 0.25 * k * pulse);
    line(inst.quad.thick * 0.2 * shown, _rgbNum(inst.cfg.color), 0.45 * k * pulse);
  }
  line(Math.max(1.5, inst.quad.thick * 0.05), _rgbNum(inst.cfg.core), (0.25 + 0.7 * shown + inst.flash) * k);
}

function _tick() {
  const now = performance.now();
  const dt = Math.min(now - _last, 50) / 1000;
  _last = now;
  for (const inst of _instances.values()) {
    try { _apply(inst, now, dt); } catch (err) { console.warn("STA2e Toolkit | Forcefield frame failed", err); }
  }
}

function _syncTicker() {
  const want = _instances.size > 0 && !!canvas?.app?.ticker;
  if (want && !_ticking) {
    _last = performance.now();
    canvas.app.ticker.add(_tick);
    _ticking = true;
  } else if (!want && _ticking) {
    try { canvas?.app?.ticker?.remove(_tick); } catch { /**/ }
    _ticking = false;
  }
}

// ── Sounds ──────────────────────────────────────────────────────────────────

function _play(doc, src, volume, radius) {
  if (!src) return;
  try {
    if (radius > 0 && canvas?.sounds?.playAtPosition) {
      const [x0, y0, x1, y1] = doc.c;
      canvas.sounds.playAtPosition(src, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, elevation: _baseElevation() }, radius, {
        volume, walls: false, easing: true,
      })?.catch?.(err => console.warn("STA2e Toolkit | Forcefield sound failed", src, err));
    } else {
      foundry.audio.AudioHelper.play({ src, volume, loop: false, channel: "environment" }, false);
    }
  } catch (err) {
    console.warn("STA2e Toolkit | Forcefield sound failed", src, err);
  }
}

// ── Contact flare ───────────────────────────────────────────────────────────

/**
 * Flare a field at a canvas point. Local only — callers run on every client
 * (the updateToken hook does), so nothing is broadcast.
 */
export function flareForcefield(wallId, point, strength = 1, { sound = true } = {}) {
  const inst = _instances.get(wallId);
  if (!inst || inst.power < 0.3) return false;
  const [x0, y0, x1, y1] = inst.doc.c;
  const wx = x1 - x0, wy = y1 - y0;
  const len = Math.hypot(wx, wy) || 1;
  const along = ((point.x - x0) * wx + (point.y - y0) * wy) / len;
  const across = Math.max(-inst.quad.thick * 0.3, Math.min(inst.quad.thick * 0.3,
    ((point.x - x0) * -wy + (point.y - y0) * wx) / len));
  inst.hits.push({ along, across, age: 0, strength: Math.max(0, Math.min(1.5, strength)) });
  if (inst.hits.length > FF_MAX_HITS) inst.hits.shift();
  if (sound) _play(inst.doc, inst.cfg.soundHit, inst.cfg.volume, inst.cfg.radius);
  return true;
}

function _tokenCentre(doc, x, y) {
  const size = doc.getSize?.() ?? { width: (doc.width ?? 1) * _gridSize(), height: (doc.height ?? 1) * _gridSize() };
  return { x: x + size.width / 2, y: y + size.height / 2 };
}

function _onUpdateToken(doc, changes, options) {
  if (!_instances.size || !doc.parent?.isView) return;
  if (!("x" in (changes ?? {})) && !("y" in (changes ?? {}))) return;
  if (options?.sta2eScriptedMove || options?.teleport) return;
  // Core runs the first animation frame inside _onUpdate, before this hook, so
  // the placeable still stands at the start of the move. The end is the source.
  const obj = doc.object;
  const from = obj?.center ? { x: obj.center.x, y: obj.center.y } : null;
  if (!from) return;
  const to = _tokenCentre(doc, doc._source.x, doc._source.y);
  const reach = _gridSize() * 0.75;
  for (const inst of _instances.values()) {
    if (inst.power < 0.5) continue;
    const hit = moveHitsWall(inst.doc.c, from, to, reach);
    if (hit) { flareForcefield(inst.wallId, hit, 1); break; }
  }
}

// ── Wall hooks ──────────────────────────────────────────────────────────────

function _onCreateWall(doc) {
  if (doc.parent?.isView && isForcefieldWall(doc)) _rebuild(doc);
}

function _onDeleteWall(doc) {
  const inst = _instances.get(doc.id);
  if (!inst) return;
  _destroy(inst);
  _instances.delete(doc.id);
  _syncTicker();
}

function _onUpdateWall(doc, changes) {
  if (!doc.parent?.isView) return;
  const had = _instances.get(doc.id);
  const structural = "c" in changes || "door" in changes || "flags" in changes;
  if (structural || (!had && isForcefieldWall(doc))) _rebuild(doc);
  if (!("ds" in changes)) return;
  const inst = _instances.get(doc.id);
  if (!inst) return;
  const up = isFieldUp(doc);
  const now = performance.now();
  inst.ramp = { from: inst.power, to: up ? 1 : 0, start: now, ms: up ? FF_RAMP_UP_MS : FF_RAMP_DOWN_MS };
  // Closed ↔ Locked keeps the field up: no ramp to run, no sound to play.
  if (Math.abs(inst.ramp.to - inst.ramp.from) < 0.01) { inst.ramp = null; return; }
  _play(doc, up ? inst.cfg.soundUp : inst.cfg.soundDown, inst.cfg.volume, inst.cfg.radius);
  _syncTicker();
}

export function registerForcefieldVfx() {
  Hooks.on("canvasReady", () => { try { _buildAll(); } catch (err) { console.error("STA2e Toolkit | Forcefields failed to draw", err); } });
  Hooks.on("canvasTearDown", () => { _destroyAll(); resetForcefieldShaderProbe(); });
  Hooks.on("createWall", _onCreateWall);
  Hooks.on("updateWall", _onUpdateWall);
  Hooks.on("deleteWall", _onDeleteWall);
  Hooks.on("updateToken", _onUpdateToken);
}
