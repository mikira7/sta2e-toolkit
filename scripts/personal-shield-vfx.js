/**
 * sta2e-toolkit | personal-shield-vfx.js
 *
 * A character's personal forcefield, drawn only when something happens to it.
 * There is no standing bubble — a person walking around inside a glowing egg
 * all scene reads as a status icon, not as a forcefield. Four moments:
 *
 *   raise    — put on (Wear toggled on): the field blooms out of the centre of
 *              the token to its envelope, flares, and fades out, "on".
 *   impact   — a ground weapon hits the wearer: exactly the ship shield impact
 *              (playShieldImpactVFX) — the bubble's cap lit on the side the fire
 *              came from, and the tinted JB2A flash over it, sized to the token.
 *   collapse — taken off (Wear toggled off, or the item deleted while worn):
 *              the envelope flickers and shrinks back into the centre.
 *   break    — the wearer goes down (Stunned, Dying, Dead, Unconscious) with it
 *              on, or the field is sacrificed: a particle explosion — the field
 *              flashes white, a shockwave ring races out, and sparks and embers
 *              are thrown off the boundary (`_burst`).
 *
 * The geometry is the ship bubble's (`getShieldEnvelopeGeometry` /
 * `seatShieldEnvelope` / `drawShieldRim`), sized off the token's opaque art, so
 * a hit landing during a raise agrees with it to the pixel.
 *
 * Multi-client
 * ------------
 * Raise, collapse and break are reactions to DOCUMENT changes (the item's worn
 * flag, the token's conditions, an actor status), which Foundry delivers to
 * every client, so each client plays its own copy from its own hook and nothing
 * is broadcast — the same arrangement as shield-idle-vfx.js. The impact comes
 * from the firing path, which runs on one client, so it goes through the ship
 * impact, whose bubble broadcasts itself and whose flash Sequencer routes.
 *
 * Which items count is the world setting `personalShieldItems` (comma-separated
 * names, trimmed and case-insensitive, like the Appearances item rules).
 *
 * Public API:
 *   isPersonalShieldItem(item) / wearsPersonalShield(actor)
 *   playPersonalShieldRaise(token) / playPersonalShieldCollapse(token) / playPersonalShieldBreak(token)
 *   playPersonalShieldHits(sourceToken, targets)
 *   registerPersonalShieldVfxHooks()
 */

import {
  RIM_WIDTH,
  getShieldEnvelopeGeometry,
  seatShieldEnvelope,
  drawShieldRim,
  drawShieldEnvelopeFill,
  getShieldCapPoint,
} from "./shield-bubble-vfx.js";
import { resolveShieldImpactColorHex, resolveShieldStandoffFactor } from "./ship-vfx-anchors.js";
import { playShieldImpactVFX } from "./shield-impact-vfx.js";
import { WEARABLE_TYPES, WORN_FLAG, nameKey } from "./appearance-data.js";

const MODULE = "sta2e-toolkit";

/** Same baseline as the ship bubble, so a hit during a raise sits on top. */
const VFX_Z_BASE = 900_000;

const RAISE_MS    = 950;
const COLLAPSE_MS = 650;

/** Toolkit conditions and core statuses that mean the wearer is down. */
const DOWN_CONDITIONS = new Set(["stun", "dying", "dead"]);
const DOWN_STATUSES   = new Set(["dead", "unconscious", "stun", "dying", "defeated"]);

// ── Which items, who wears one ───────────────────────────────────────────────

function _shieldNames() {
  let raw = "Personal Forcefield, Personal Shield";
  try { raw = String(game.settings.get(MODULE, "personalShieldItems") ?? raw); } catch { /* default */ }
  return new Set(raw.split(/[,;]/).map(nameKey).filter(Boolean));
}

function _enabled() {
  try { return game.settings.get(MODULE, "personalShieldVFX") !== false; } catch { return true; }
}

export function isPersonalShieldItem(item) {
  if (!item || !WEARABLE_TYPES.has(item.type)) return false;
  return _shieldNames().has(nameKey(item.name));
}

function _isWorn(item) {
  return item?.getFlag?.(MODULE, WORN_FLAG) === true;
}

/**
 * Item flag set when a forcefield is sacrificed to turn an injury into a Stun
 * injury (STA 2e): it burns out and gives no further Protection until cleared
 * from the sheet. Damage maths and every effect here skip a burnt-out field.
 */
export const BURNT_OUT_FLAG = "forcefieldBurntOut";

export function isBurntOut(item) {
  return item?.getFlag?.(MODULE, BURNT_OUT_FLAG) === true;
}

/** The worn, still-working personal forcefield an actor has on, or null. */
export function activePersonalShield(actor) {
  if (!actor?.items) return null;
  const names = _shieldNames();
  return actor.items.find(i => WEARABLE_TYPES.has(i.type) && _isWorn(i) && !isBurntOut(i)
    && names.has(nameKey(i.name))) ?? null;
}

export function wearsPersonalShield(actor) {
  return !!activePersonalShield(actor);
}

/** Burn a forcefield out (sacrificed). Every client then plays the break. */
export async function burnOutPersonalShield(item) {
  if (!item) return;
  await item.setFlag(MODULE, BURNT_OUT_FLAG, true);
}

/** Put a burnt-out forcefield back in service (recharged or replaced). */
export async function rechargePersonalShield(item) {
  if (!item) return;
  await item.unsetFlag(MODULE, BURNT_OUT_FLAG);
}

/**
 * The placed tokens of an actor on THIS client's canvas. A synthetic (unlinked)
 * actor returns its own token; a world actor only its LINKED tokens, since an
 * unlinked token of it carries its own copy of the items.
 */
function _tokensOf(actor) {
  if (!canvas?.ready || !actor) return [];
  try { return actor.getActiveTokens(true, false); }
  catch { return []; }
}

// ── PIXI helpers ─────────────────────────────────────────────────────────────

function _addBlend() {
  return typeof PIXI?.BLEND_MODES?.ADD === "number" ? PIXI.BLEND_MODES.ADD : "add";
}

function _passThrough(obj) {
  try { obj.eventMode = "none"; obj.interactive = false; obj.interactiveChildren = false; } catch { /* old pixi */ }
  return obj;
}

function _effectLayer() {
  const layer = canvas?.tokens ?? canvas?.interface ?? canvas?.primary ?? canvas?.stage ?? null;
  if (layer && !layer.sortableChildren) layer.sortableChildren = true;
  return layer;
}

function _hexToNum(hex, fallback = 0x9fd8ff) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  return m ? Number.parseInt(m[1], 16) : fallback;
}

function _fillEllipse(g, rx, ry, color, alpha) {
  g.clear();
  if (typeof g.drawEllipse === "function") {
    g.beginFill(color, alpha);
    g.drawEllipse(0, 0, rx, ry);
    g.endFill();
    return;
  }
  g.ellipse(0, 0, rx, ry).fill({ color, alpha });
}

/** One soft white radial dot, shared by every raise/collapse. */
let _glowTexture = null;
function _glow() {
  if (_glowTexture) return _glowTexture;
  const oc = document.createElement("canvas");
  oc.width = oc.height = 128;
  const ctx = oc.getContext("2d");
  const rg = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  // Hollow in the middle, brightest just inside the edge: a shell, not a lamp.
  rg.addColorStop(0,    "rgba(255,255,255,0.10)");
  rg.addColorStop(0.62, "rgba(255,255,255,0.22)");
  rg.addColorStop(0.9,  "rgba(255,255,255,0.75)");
  rg.addColorStop(1,    "rgba(255,255,255,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, 128, 128);
  _glowTexture = PIXI.Texture.from(oc);
  return _glowTexture;
}

const _easeOut = (t) => 1 - Math.pow(1 - t, 3);
const _easeIn  = (t) => t * t * t;

/**
 * One envelope animation, driven by `frame(p, parts)` for p in 0..1.
 * The rim is drawn once at full size and scaled, so the per-frame cost is a
 * handful of transform and alpha writes.
 */
function _animate(token, durationMs, frame) {
  if (typeof PIXI === "undefined" || !token || token.destroyed) return;
  const layer = _effectLayer();
  if (!layer) return;

  const color = _hexToNum(resolveShieldImpactColorHex(token) ?? "#9fd8ff");
  const geo   = getShieldEnvelopeGeometry(token, resolveShieldStandoffFactor(token));

  const container = _passThrough(new PIXI.Container());
  const tokenZ = typeof token.zIndex === "number" ? token.zIndex : 0;
  container.zIndex = Math.max(VFX_Z_BASE, tokenZ + 10_000);
  seatShieldEnvelope(container, token, geo);

  // The scaled group: shell glow, faint fill, crisp rim.
  const body = new PIXI.Container();
  container.addChild(body);

  const shell = new PIXI.Sprite(_glow());
  shell.anchor.set(0.5);
  shell.blendMode = _addBlend();
  shell.tint = color;
  shell.width  = geo.rx * 2.1;
  shell.height = geo.ry * 2.1;
  body.addChild(shell);

  const fill = new PIXI.Graphics();
  fill.blendMode = _addBlend();
  _fillEllipse(fill, geo.rx, geo.ry, color, 1);
  body.addChild(fill);

  const rim = new PIXI.Graphics();
  rim.blendMode = _addBlend();
  drawShieldRim(rim, geo, color, RIM_WIDTH * 1.5);
  body.addChild(rim);

  try {
    const GlowFilter = PIXI.filters?.GlowFilter;
    if (GlowFilter) container.filters = [new GlowFilter({ distance: 12, outerStrength: 1.4, innerStrength: 0, color, quality: 0.3 })];
  } catch { /* glow is a bonus */ }

  layer.addChild(container);
  const parts = { body, shell, fill, rim, geo };
  const start = performance.now();
  let done = false;

  const stop = () => {
    if (done) return;
    done = true;
    try { canvas.app.ticker.remove(tick); } catch { /* gone */ }
    try { for (const f of container.filters ?? []) f?.destroy?.(); container.filters = null; } catch { /* gone */ }
    try { container.parent?.removeChild(container); } catch { /* gone */ }
    // The glow texture is shared.
    try { container.destroy({ children: true, texture: false }); } catch { /* gone */ }
  };

  function tick() {
    if (done) return;
    if (token.destroyed || !canvas?.tokens?.get(token.id)) return stop();
    const p = Math.min(1, (performance.now() - start) / durationMs);
    seatShieldEnvelope(container, token, geo);
    frame(p, parts);
    if (p >= 1) stop();
  }

  tick();
  if (!done) canvas.app.ticker.add(tick);
}

// ── The four moments ─────────────────────────────────────────────────────────

/** Put on: bloom out of the centre, overshoot a touch, flare, fade. */
export function playPersonalShieldRaise(token) {
  if (!_enabled()) return;
  _animate(token, RAISE_MS, (p, { body, shell, fill, rim }) => {
    // 0–0.55 grow, with a slight overshoot that settles; then hold and fade.
    const grow = p < 0.55 ? _easeOut(p / 0.55) * 1.06 : 1.06 - 0.06 * Math.min(1, (p - 0.55) / 0.15);
    body.scale.set(Math.max(0.02, grow));
    const fade = p < 0.55 ? 1 : 1 - _easeIn((p - 0.55) / 0.45);
    // The flare peaks as it reaches the envelope.
    const flare = Math.exp(-Math.pow((p - 0.55) / 0.12, 2));
    rim.alpha   = (0.55 + 0.45 * flare) * fade;
    shell.alpha = (0.45 + 0.55 * flare) * fade;
    fill.alpha  = (0.05 + 0.10 * flare) * fade;
  });
}

/** Taken off: a short flicker at full size, then shrink back into the centre. */
export function playPersonalShieldCollapse(token) {
  if (!_enabled()) return;
  _animate(token, COLLAPSE_MS, (p, { body, shell, fill, rim }) => {
    const flicker = p < 0.3 ? (Math.sin(p * 90) > 0 ? 1 : 0.35) : 1;
    const shrink  = p < 0.3 ? 1 : 1 - _easeIn((p - 0.3) / 0.7);
    body.scale.set(Math.max(0.02, shrink));
    const a = (p < 0.3 ? 0.8 : 0.8 * (1 - (p - 0.3) / 0.7) + 0.2) * flicker;
    rim.alpha   = a;
    shell.alpha = a * 0.8;
    fill.alpha  = 0.08 * flicker * shrink;
  });
}

// ── The break: a particle explosion ──────────────────────────────────────────
//
// Four layers, all additive, in the envelope's own (seated, rotated) frame:
//   flash   — the whole field lights white-hot and swells for a quarter second
//   ring    — a shockwave ellipse racing outward from the envelope
//   streaks — fast sparks thrown off the boundary, stretched along their flight
//   embers  — slower, larger motes that drift, flicker and die last
// One ticker, pooled-at-build sprites, nothing allocated per frame.

const BURST_MS     = 1300;
const BURST_STREAK = 72;
const BURST_EMBER  = 22;

/** A small hot dot — white core, soft falloff — tinted per particle. */
let _sparkTexture = null;
function _spark() {
  if (_sparkTexture) return _sparkTexture;
  const oc = document.createElement("canvas");
  oc.width = oc.height = 64;
  const ctx = oc.getContext("2d");
  const rg = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0,    "rgba(255,255,255,1)");
  rg.addColorStop(0.18, "rgba(255,255,255,0.9)");
  rg.addColorStop(0.45, "rgba(255,255,255,0.28)");
  rg.addColorStop(1,    "rgba(255,255,255,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, 64, 64);
  _sparkTexture = PIXI.Texture.from(oc);
  return _sparkTexture;
}

/**
 * The shock front, baked once as a few variants. A plain ring reads as a line
 * growing; what reads as a pressure wave is a hard bright leading edge with a
 * soft wake trailing in behind it, and a front that is not uniform — the edge
 * wanders in and out and its density knots and thins around the circumference.
 * White, tinted per burst. Edge sits at ~0.9 of the radius.
 */
const SHOCK_EDGE = 0.9;
let _shockTextures = null;
function _shockFrames() {
  if (_shockTextures) return _shockTextures;
  const N = 256, half = N / 2;
  _shockTextures = [];
  for (let v = 0; v < 3; v++) {
    // Angular noise: a few harmonics with random phases, one for where the edge
    // sits (low frequency) and one for how dense it is (higher frequency).
    const ph = Array.from({ length: 10 }, () => Math.random() * Math.PI * 2);
    const wander = (a) => (Math.sin(3 * a + ph[0]) + 0.6 * Math.sin(5 * a + ph[1]) + 0.35 * Math.sin(9 * a + ph[2])) / 1.95;
    const knots  = (a) => (Math.sin(7 * a + ph[3]) + 0.7 * Math.sin(13 * a + ph[4]) + 0.5 * Math.sin(23 * a + ph[5]) + 0.3 * Math.sin(41 * a + ph[6])) / 2.5;
    const oc = document.createElement("canvas");
    oc.width = oc.height = N;
    const ctx = oc.getContext("2d");
    const img = ctx.createImageData(N, N);
    const d = img.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x - half) / half, dy = (y - half) / half;
        const r = Math.hypot(dx, dy);
        if (r > 1) continue;
        const a = Math.atan2(dy, dx);
        const edge = SHOCK_EDGE + 0.035 * wander(a);
        const dist = r - edge;
        // Leading edge: tight and bright. Outside it the air is untouched, so
        // it falls off almost at once; inside, a long soft wake.
        let alpha = dist >= 0
          ? Math.exp(-dist / 0.012)
          : Math.exp(-(dist * dist) / (2 * 0.016 * 0.016)) + 0.42 * Math.exp(dist / 0.13);
        alpha *= 0.5 + 0.5 * (0.5 + 0.5 * knots(a));        // density knots
        alpha *= 0.82 + 0.18 * Math.random();               // grain
        const i = (y * N + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = Math.max(0, Math.min(255, Math.round(255 * alpha)));
      }
    }
    ctx.putImageData(img, 0, 0);
    _shockTextures.push(PIXI.Texture.from(oc));
  }
  return _shockTextures;
}

/** `color` pulled `t` of the way to white — hot particles read whiter. */
function _toWhite(color, t) {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const m = (c) => Math.round(c + (255 - c) * t);
  return (m(r) << 16) | (m(g) << 8) | m(b);
}

const _rnd = (a, b) => a + Math.random() * (b - a);

function _burst(token) {
  if (typeof PIXI === "undefined" || !token || token.destroyed) return;
  const layer = _effectLayer();
  if (!layer) return;

  const color = _hexToNum(resolveShieldImpactColorHex(token) ?? "#9fd8ff");
  const geo   = getShieldEnvelopeGeometry(token, resolveShieldStandoffFactor(token));
  const size  = Math.min(geo.rx, geo.ry);
  // Speeds and sizes scale with the field, so a large figure's burst is not a
  // pinprick and a small one's does not fill the screen.
  const k = Math.max(0.6, Math.min(2.2, size / 55));

  const container = _passThrough(new PIXI.Container());
  const tokenZ = typeof token.zIndex === "number" ? token.zIndex : 0;
  container.zIndex = Math.max(VFX_Z_BASE, tokenZ + 10_000);
  seatShieldEnvelope(container, token, geo);

  // Flash: the field itself, overexposed.
  const flash = new PIXI.Container();
  const flashFill = new PIXI.Graphics();
  flashFill.blendMode = _addBlend();
  _fillEllipse(flashFill, geo.rx, geo.ry, _toWhite(color, 0.45), 1);
  const flashShell = new PIXI.Sprite(_glow());
  flashShell.anchor.set(0.5);
  flashShell.blendMode = _addBlend();
  flashShell.tint = _toWhite(color, 0.3);
  flashShell.width = geo.rx * 2.2;
  flashShell.height = geo.ry * 2.2;
  flash.addChild(flashFill, flashShell);
  container.addChild(flash);

  // Shockwave: a primary front, a second wave trailing it, and a haze of
  // displaced energy filling in behind. The holder carries the envelope's
  // aspect, so the sprites inside can turn freely and stay elliptical.
  const shock = new PIXI.Container();
  shock.scale.set(geo.rx / size, geo.ry / size);
  container.addChild(shock);
  const frames = _shockFrames();
  const pick = Math.floor(Math.random() * frames.length);
  const wave = (frame, tint) => {
    const sp = new PIXI.Sprite(frame);
    sp.anchor.set(0.5);
    sp.blendMode = _addBlend();
    sp.tint = tint;
    sp.rotation = Math.random() * Math.PI * 2;
    sp.alpha = 0;
    shock.addChild(sp);
    return sp;
  };
  const haze = new PIXI.Sprite(_glow());
  haze.anchor.set(0.5);
  haze.blendMode = _addBlend();
  haze.tint = color;
  haze.alpha = 0;
  shock.addChild(haze);
  const trail = wave(frames[(pick + 1) % frames.length], color);
  const front = wave(frames[pick], _toWhite(color, 0.35));
  // Diameter that puts the texture's edge on the envelope at scale 1.
  const shockBase = (2 * size) / SHOCK_EDGE;
  const spin = _rnd(-0.35, 0.35);

  const tex = _spark();
  const parts = [];
  const spawn = (n, ember) => {
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      // Born on (or just inside) the boundary, flying outward along the normal
      // with some scatter — the field tearing apart, not a point detonating.
      const r0 = _rnd(0.82, 1.04);
      const x = Math.cos(theta) * geo.rx * r0;
      const y = Math.sin(theta) * geo.ry * r0;
      const nx = Math.cos(theta) / geo.rx, ny = Math.sin(theta) / geo.ry;
      const nl = Math.hypot(nx, ny) || 1;
      const dir = Math.atan2(ny / nl, nx / nl) + _rnd(-0.35, 0.35);
      const speed = (ember ? _rnd(40, 140) : _rnd(170, 560)) * k;
      const sprite = new PIXI.Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.blendMode = _addBlend();
      sprite.tint = _toWhite(color, ember ? _rnd(0.05, 0.3) : _rnd(0.25, 0.75));
      sprite.position.set(x, y);
      container.addChild(sprite);
      parts.push({
        sprite, ember, x, y,
        vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed,
        life: ember ? _rnd(800, 1250) : _rnd(380, 900),
        delay: ember ? _rnd(40, 220) : _rnd(0, 90),
        base: (ember ? _rnd(7, 13) : _rnd(4, 7)) * k,
        flick: Math.random() * Math.PI * 2,
      });
      sprite.visible = false;
    }
  };
  spawn(BURST_STREAK, false);
  spawn(BURST_EMBER, true);

  try {
    const GlowFilter = PIXI.filters?.GlowFilter;
    if (GlowFilter) container.filters = [new GlowFilter({ distance: 14, outerStrength: 1.8, innerStrength: 0, color, quality: 0.3 })];
  } catch { /* glow is a bonus */ }

  layer.addChild(container);
  const start = performance.now();
  let prev = start;
  let done = false;

  const stop = () => {
    if (done) return;
    done = true;
    try { canvas.app.ticker.remove(tick); } catch { /* gone */ }
    try { for (const f of container.filters ?? []) f?.destroy?.(); container.filters = null; } catch { /* gone */ }
    try { container.parent?.removeChild(container); } catch { /* gone */ }
    // The spark and glow textures are shared.
    try { container.destroy({ children: true, texture: false }); } catch { /* gone */ }
  };

  function tick() {
    if (done) return;
    if (token.destroyed || !canvas?.tokens?.get(token.id)) return stop();
    const now = performance.now();
    const t = now - start;
    const dt = Math.min(50, now - prev) / 1000;
    prev = now;
    seatShieldEnvelope(container, token, geo);

    // Flash: snaps on, swells 15%, gone by 300ms.
    const fp = Math.min(1, t / 300);
    flash.scale.set(1 + 0.15 * fp);
    flash.alpha = fp < 0.15 ? fp / 0.15 : Math.pow(1 - (fp - 0.15) / 0.85, 2);
    flashFill.alpha = 0.35;

    // Front: punches out fast and decelerates to ~2.4x, its wake stretching as
    // it goes; turns a little so the knots are not static.
    const sp1 = Math.min(1, t / 800);
    const e1 = 1 - Math.pow(1 - sp1, 3);
    front.width = front.height = shockBase * (1 + 1.4 * e1);
    front.rotation += spin * dt;
    front.alpha = sp1 < 0.06 ? sp1 / 0.06 : Math.pow(1 - sp1, 1.5);
    // Trailing wave: a beat behind, slower, softer.
    const sp2 = Math.max(0, Math.min(1, (t - 90) / 900));
    const e2 = 1 - Math.pow(1 - sp2, 2.4);
    trail.width = trail.height = shockBase * (0.95 + 1.1 * e2);
    trail.rotation -= spin * 0.7 * dt;
    trail.alpha = sp2 <= 0 ? 0 : 0.55 * (sp2 < 0.1 ? sp2 / 0.1 : Math.pow(1 - sp2, 2));
    // Haze: the energy the wave leaves behind, swelling and thinning out.
    haze.width = haze.height = shockBase * (0.9 + 1.2 * e1);
    haze.alpha = 0.3 * Math.pow(1 - sp1, 2);

    const drag = Math.exp(-2.8 * dt);
    for (const p of parts) {
      const age = t - p.delay;
      if (age < 0) continue;
      const q = age / p.life;
      if (q >= 1) { p.sprite.visible = false; continue; }
      p.vx *= drag; p.vy *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const sp = p.sprite;
      sp.visible = true;
      sp.position.set(p.x, p.y);
      if (p.ember) {
        // Embers: round, flickering, fade slow.
        p.flick += dt * 22;
        sp.width = sp.height = p.base * (1 - 0.4 * q);
        sp.alpha = Math.pow(1 - q, 1.2) * (0.65 + 0.35 * Math.sin(p.flick));
      } else {
        // Streaks: stretched along their flight, shortening as they slow.
        const speed = Math.hypot(p.vx, p.vy);
        sp.rotation = Math.atan2(p.vy, p.vx);
        sp.width  = p.base + speed * 0.06;
        sp.height = p.base * (1 - 0.5 * q);
        sp.alpha  = Math.pow(1 - q, 1.4);
      }
    }

    if (t >= BURST_MS) stop();
  }

  tick();
  if (!done) canvas.app.ticker.add(tick);
}

/** The wearer went down, or the field was sacrificed: it explodes. Local to this client. */
const _lastBreak = new Map();   // token id → ms, so one knock-down plays once

export function playPersonalShieldBreak(token, { force = false } = {}) {
  if (!_enabled() || !token || token.destroyed) return;
  // A toolkit condition and a core status can land together for one knock-down.
  // A sacrifice always plays, and also blocks the Stun condition it causes from
  // playing the break a second time.
  const now = performance.now();
  if (!force && now - (_lastBreak.get(token.id) ?? -Infinity) < 1500) return;
  _lastBreak.set(token.id, now);
  _burst(token);
}

/**
 * How far into the envelope a held shot pushes before it stops, 0 = right on
 * the boundary, 1 = the token centre. Fixed rather than rolled per shot, so the
 * renderer that draws the beam and the impact that lights the shield (two
 * separate calls, with no payload between them) land on the same point.
 */
const PERSONAL_CAP_T = 0.12;

/**
 * Where a ground shot at `targetToken` stops when it is wearing a working
 * forcefield — on the field, facing the shooter — or null to let it carry on to
 * the token (no field, or the shooter is inside the envelope). Renderers use it
 * for the end of the beam/bolt; `playPersonalShieldHits` for the flash.
 */
export function personalShieldStopPoint(sourcePoint, targetToken) {
  const t = targetToken?.document ? targetToken : null;
  if (!t?.actor || !t.center || !wearsPersonalShield(t.actor)) return null;
  return getShieldCapPoint(t, sourcePoint, t.center, PERSONAL_CAP_T);
}

/**
 * A ground weapon hit on each target wearing a forcefield: the ship shield
 * impact, unchanged — cap on the side facing the shooter plus the tinted flash,
 * and the same world toggles (shieldImpactFX, shieldBubbleVFX) gate it. Called
 * by the firing client only; the bubble broadcasts itself and Sequencer routes
 * the flash.
 */
/**
 * When each target last flashed on this client. The renderers call
 * `playPersonalShieldHits` at the exact moment their shot lands; the ground
 * damage path calls it again once the whole animation has finished, as the
 * catch-all for weapons whose renderer does not (melee, the pulse shockwave).
 * Inside this window the second call is the same hit and is skipped — that is
 * what keeps the flash on the strike instead of a beat after it.
 */
const _lastHit = new Map();
const HIT_DEDUPE_MS = 3000;

export function playPersonalShieldHits(sourceToken, targets) {
  if (!_enabled()) return;
  const now = performance.now();
  for (const target of targets ?? []) {
    const t = target?.document ? target : canvas?.tokens?.get(target?.id ?? target);
    if (!t?.actor || !wearsPersonalShield(t.actor)) continue;
    if (now - (_lastHit.get(t.id) ?? -Infinity) < HIT_DEDUPE_MS) continue;
    _lastHit.set(t.id, now);
    try {
      // preShields > 0 is the ship impact's "shields are up" gate; a personal
      // field has no pool, so a fixed mid-strength share sizes the flash.
      // The flash sits where the renderer stopped the shot; the bubble places
      // its cap along the same ray at the same depth.
      const from = sourceToken?.center ?? null;
      const stop = from ? personalShieldStopPoint(from, t) : null;
      playShieldImpactVFX(sourceToken, t, stop ?? t.center, {
        preShields:  1,
        hullPoint:   t.center,
        capT:        PERSONAL_CAP_T,
        sourcePoint: from,
        finalDamage: 4,
        maxShields:  8,
      }).catch(err => console.warn("STA2e Toolkit | Personal shield impact failed:", err));
    } catch (err) {
      console.warn("STA2e Toolkit | Personal shield impact failed:", err);
    }
  }
}

// ── Hooks ────────────────────────────────────────────────────────────────────

function _wornChanged(changes) {
  const get = foundry.utils.getProperty;
  return get(changes, `flags.${MODULE}.${WORN_FLAG}`) !== undefined
      || get(changes, `flags.${MODULE}.-=${WORN_FLAG}`) !== undefined;
}

let _registered = false;

/** Call once from main.js init. */
export function registerPersonalShieldVfxHooks() {
  if (_registered) return;
  _registered = true;

  // Wear toggled: every client sees the item update and plays its own copy.
  Hooks.on("updateItem", (item, changes) => {
    const get = foundry.utils.getProperty;
    const burnt = get(changes, `flags.${MODULE}.${BURNT_OUT_FLAG}`);
    if (burnt !== undefined || get(changes, `flags.${MODULE}.-=${BURNT_OUT_FLAG}`) !== undefined) {
      if (!isPersonalShieldItem(item) || !_isWorn(item)) return;
      // Sacrificed: it shatters. Recharged while worn: it comes back on.
      for (const token of _tokensOf(item.parent)) {
        if (burnt === true) playPersonalShieldBreak(token, { force: true });
        else playPersonalShieldRaise(token);
      }
      return;
    }
    if (!_wornChanged(changes) && changes.name === undefined) return;
    if (!isPersonalShieldItem(item) || isBurntOut(item)) return;
    const on = _isWorn(item);
    // A rename onto a shield name while worn counts as raising it; a rename
    // away from one is not tracked (the old name is already gone).
    if (changes.name !== undefined && !_wornChanged(changes) && !on) return;
    for (const token of _tokensOf(item.parent)) {
      if (on) playPersonalShieldRaise(token);
      else playPersonalShieldCollapse(token);
    }
  });

  Hooks.on("deleteItem", (item) => {
    if (!isPersonalShieldItem(item) || !_isWorn(item) || isBurntOut(item)) return;
    for (const token of _tokensOf(item.parent)) playPersonalShieldCollapse(token);
  });

  // The wearer goes down — toolkit conditions on the token. `updateToken` only
  // carries the new array, and `preUpdateToken` runs on the updating client
  // alone, so each client keeps its own last-seen copy for the canvas's tokens
  // and diffs against that: only a condition newly ADDED breaks the field, not
  // every later rewrite of an array that already holds Dead.
  const seen = new Map();   // token id → conditions last seen on this client
  const conditionsOf = (doc) => {
    try { return [...(doc.getFlag(MODULE, "conditions") ?? [])]; } catch { return []; }
  };
  const seed = () => {
    seen.clear();
    for (const t of canvas?.tokens?.placeables ?? []) seen.set(t.id, conditionsOf(t.document));
  };
  Hooks.on("canvasReady", seed);
  Hooks.on("createToken", (doc) => seen.set(doc.id, conditionsOf(doc)));
  Hooks.on("deleteToken", (doc) => seen.delete(doc.id));
  Hooks.on("updateToken", (tokenDoc, changes) => {
    const next = foundry.utils.getProperty(changes, `flags.${MODULE}.conditions`);
    if (!Array.isArray(next)) return;
    if (tokenDoc.parent?.id !== canvas?.scene?.id) return;
    const prev = seen.get(tokenDoc.id) ?? [];
    seen.set(tokenDoc.id, [...next]);
    if (!next.some(k => DOWN_CONDITIONS.has(k) && !prev.includes(k))) return;
    if (!wearsPersonalShield(tokenDoc.actor)) return;
    if (tokenDoc.object) playPersonalShieldBreak(tokenDoc.object);
  });

  // …or a core status effect on the actor.
  Hooks.on("createActiveEffect", (effect) => {
    const actor = effect.parent;
    if (!(actor instanceof Actor)) return;
    const statuses = [...(effect.statuses ?? [])];
    if (!statuses.some(s => DOWN_STATUSES.has(s))) return;
    if (!wearsPersonalShield(actor)) return;
    for (const token of _tokensOf(actor)) playPersonalShieldBreak(token);
  });

  Hooks.on("canvasTearDown", () => {
    try { _glowTexture?.destroy(true); } catch { /* gone */ }
    _glowTexture = null;
    try { _sparkTexture?.destroy(true); } catch { /* gone */ }
    _sparkTexture = null;
    for (const t of _shockTextures ?? []) { try { t.destroy(true); } catch { /* gone */ } }
    _shockTextures = null;
  });
}
