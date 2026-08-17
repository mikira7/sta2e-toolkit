/**
 * sta2e-toolkit | shield-bubble-vfx.js
 *
 * The shield bubble — the thing you actually see on screen when a starship
 * takes a hit and the shields hold.
 *
 * An oblate bubble wraps the hull. A weapon strike lights a soft glowing cap
 * over the portion facing the attacker — brightest at the impact bearing,
 * fading inward across the hull and around the curve — over a faint suggestion
 * of the rest of the envelope. When the hit drops shields to zero that patch
 * floods the whole bubble, which then breaks apart into drifting fragments: the
 * shields visibly failing rather than merely absorbing.
 *
 * A cap rather than a bright arc on the silhouette's edge. Weapons keep
 * striking the hull wherever they like, including the far side, so a thin line
 * on the rim gave two unrelated hit locations on screen. A patch seen from
 * above reads as a dome facet lighting up over the ship, which is both the
 * on-screen look and the one that survives a beam drawn across the hull.
 *
 * This is the native PIXI half of a shield impact. The JB2A flash in
 * shield-impact-vfx.js plays over the top of it, tinted to the same colour, and
 * that module is the only intended caller.
 *
 * Geometry
 * --------
 * The bubble is sized off the *artwork*, not the token frame — a saucer in a
 * square PNG with 20% transparent margin would otherwise get a bubble floating
 * well off its hull. `getTokenArtMetrics()` (art-bounds.js) supplies the opaque
 * extents and the art's offset from the token centre, both in token-local px,
 * and the container is seated and rotated to match every frame so the bubble
 * rides a ship that is still gliding from an earlier move. How far outside the
 * art it sits is the `shieldBubbleStandoff` world setting, overridable per ship
 * in the VFX Anchors editor.
 *
 * Multi-client
 * ------------
 * Shield impacts resolve inside `CombatHUD.applyDamage`, which runs only on the
 * GM applying the damage. Sequencer routes its own effects to every client;
 * PIXI does not. So the firing client draws locally and *then* broadcasts —
 * Foundry sockets do not loop back, so that is exactly one draw per client.
 * Same problem, same fix, as warpFlashVfx and pointDefenseTracerVfx.
 *
 * The payload carries the resolved colour and a single pre-computed intensity
 * scalar rather than the raw damage numbers: the receiving client should not be
 * re-deriving combat maths, and it recomputes only the geometry, which is local
 * to its own canvas anyway.
 *
 * Public API:
 *   playShieldBubble(targetToken, impactPoint, { color, finalDamage, maxShields, shieldBroke })
 *   playShieldBubbleLocal({ tokenId, x, y, color, intensity, broke })   // socket receiver
 *   testShieldBubble({ shieldBroke, color })                            // console helper
 *   registerShieldBubbleVfxHooks()
 */

import { getTokenArtMetrics } from "./art-bounds.js";
import { resolveShieldStandoffFactor } from "./ship-vfx-anchors.js";

const MODULE = "sta2e-toolkit";

/** Baseline VFX zIndex, matching transporter-vfx.js / warp-jump-vfx.js. */
const VFX_Z_BASE = 900_000;

/** Arc segments around the rim, and in each shatter fragment. */
const RIM_SEGMENTS = 64;

/**
 * Line weight of the envelope's boundary, in canvas pixels.
 *
 * Deliberately a constant rather than a fraction of the hull: the boundary is a
 * hairline that says "the bubble reaches to here", and scaling it with ship size
 * turned it into a fat band on capital ships. The shatter fragments key off it
 * so a broken shard still reads heavier than the intact rim.
 */
export const RIM_WIDTH = 2;

/**
 * Cap radius as a fraction of the envelope's long reach. Large enough that the
 * patch spreads well across the facing half, small enough that it never floods
 * the whole bubble — at 1.0 the gradient would reach the far rim and the hit
 * would stop having a direction.
 */
const CAP_RADIUS_FACTOR = 0.85;

const NORMAL_LIFE_MS = 700;
const BROKE_LIFE_MS  = 1100;

/** How long the whole bubble stays lit before it starts to come apart. */
const BROKE_FLARE_MS = 180;

/** Arc fragments the rim breaks into when shields fail. */
const BROKE_FRAGMENTS = 8;

/** Live bubbles, so canvas teardown can kill anything still in flight. */
const _live = new Set();

/**
 * Concurrent bubbles allowed on one ship. A burst weapon lands several impacts
 * inside one bubble's lifetime and each is worth seeing — a hull lit in two
 * places is what a volley looks like — but a twelve-shot phaser array would
 * otherwise stack twelve glow passes on one token. The oldest retires.
 */
const MAX_PER_TOKEN = 3;

/** tokenId → records, oldest first. */
const _byToken = new Map();

// ── PIXI compatibility shims ─────────────────────────────────────────────────
// Foundry v14 ships PIXI v8: blend modes went number → string, and the Graphics
// API applies stroke/fill AFTER the path rather than before.

function _addBlend() {
  if (typeof PIXI?.BLEND_MODES?.ADD === "number") return PIXI.BLEND_MODES.ADD;
  return "add";
}

function _strokeSegment(g, x0, y0, x1, y1, width, color, alpha) {
  if (typeof g.lineStyle === "function") {
    g.lineStyle(width, color, alpha);
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    return;
  }
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke({ width, color, alpha, cap: "round" });
}

function _effectLayer() {
  const layer = canvas?.tokens ?? canvas?.interface ?? canvas?.primary ?? canvas?.stage ?? null;
  if (layer && !layer.sortableChildren) layer.sortableChildren = true;
  return layer;
}

// ── Small numeric helpers ────────────────────────────────────────────────────

function _number(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** "#9fd8ff" → 0x9fd8ff. Also passes through a number that is already one. */
function _hexToNum(hex, fallback = 0x9fd8ff) {
  if (typeof hex === "number" && Number.isFinite(hex)) return hex;
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  return match ? Number.parseInt(match[1], 16) : fallback;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * The envelope's radii and its offset from the token centre, in token-local px.
 *
 * Exported because the idle shield envelope (shield-idle-vfx.js) has to agree
 * with the impact bubble to the pixel — two effects on the same hull deriving
 * their own radii would visibly disagree the moment both are on screen.
 *
 * @param {number} standoff  How far outside the artwork the envelope sits,
 *   resolved by the caller (per-ship override, else the world setting) and sent
 *   over the socket so every client draws the same size bubble.
 */
export function getShieldEnvelopeGeometry(token, standoff = 1.35) {
  const art = getTokenArtMetrics(token);
  const factor = _clamp(_number(standoff, 1.35), 1, 2);
  return {
    rx: Math.max(14, (art.width  / 2) * factor),
    ry: Math.max(14, (art.height / 2) * factor),
    offsetX: art.offsetX,
    offsetY: art.offsetY,
  };
}

/**
 * Seat the container on the token: centre + rotated art offset, turned to match
 * the hull. Called every frame so a moving or turning ship keeps its bubble.
 *
 * Mirrors the rotation handling in combat/initiative-turn-marker.js — the offset
 * is measured on the unrotated artwork and core turns the sprite with
 * `mesh.angle`, which a token locking rotation opts out of.
 */
export function seatShieldEnvelope(container, token, geo) {
  const frame = _envelopeFrame(token, geo);

  container.x = frame.x;
  container.y = frame.y;
  container.rotation = frame.radians;

  return frame;
}

/**
 * Where the envelope sits on the canvas and how it is turned — the same numbers
 * `seatShieldEnvelope` puts on the container, but available without one, so the
 * geometry can be queried before any effect is built.
 */
function _envelopeFrame(token, geo) {
  const degrees = token.document.lockRotation ? 0 : _number(token.document.rotation, 0);
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const centre = token.center;

  return {
    x: centre.x + geo.offsetX * cos - geo.offsetY * sin,
    y: centre.y + geo.offsetX * sin + geo.offsetY * cos,
    radians, cos, sin,
  };
}

/** Canvas point → the envelope's own unrotated frame. */
function _toLocal(frame, p) {
  const dx = p.x - frame.x;
  const dy = p.y - frame.y;
  return { x: dx * frame.cos + dy * frame.sin, y: -dx * frame.sin + dy * frame.cos };
}

/** …and back. */
function _toCanvas(frame, p) {
  return {
    x: frame.x + p.x * frame.cos - p.y * frame.sin,
    y: frame.y + p.x * frame.sin + p.y * frame.cos,
  };
}

function _point(value) {
  const x = _number(value?.x, NaN);
  const y = _number(value?.y, NaN);
  return (Number.isFinite(x) && Number.isFinite(y)) ? { x, y } : null;
}

/**
 * Where on the rim the shields light up, as the ellipse's parametric angle.
 *
 * Taken from where the fire came FROM, not from where the shot would have
 * struck the hull. The weapon's hull hit point is a random opaque pixel
 * anywhere in the target's art (`_randomOpaqueTokenPoint`), so using it
 * scatters the crest around the ship and routinely lands it on the far side
 * from the attacker. Shields flare on the facing side.
 *
 * The bearing arrives in canvas space; unrotating it into the container's frame
 * and dividing each axis by its radius maps the ellipse onto a unit circle,
 * where the angle is just an atan2. The hull hit point is only a fallback, for
 * callers that have no attacker to point at.
 */
/**
 * Where a shot travelling `from` → `to` first meets the envelope, in the
 * envelope's local frame, or null if it never does.
 *
 * Dividing each axis by its radius maps the ellipse onto a unit circle, which
 * turns this into an ordinary circle intersection: solve |P0 + t·d| = 1 and take
 * the smaller root, the point where the segment goes IN.
 *
 * Null when the attacker is already inside the envelope — point-blank, or
 * overlapping tokens — because there is no boundary between them to stop at.
 * The hull hit point is always inside (the envelope is never smaller than the
 * art), so an attacker outside always produces exactly one entry root.
 */
function _crossingLocal(geo, from, to) {
  const p0 = { x: from.x / geo.rx, y: from.y / geo.ry };
  const p1 = { x: to.x / geo.rx, y: to.y / geo.ry };

  if (Math.hypot(p0.x, p0.y) <= 1) return null;

  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const a  = dx * dx + dy * dy;
  if (a < 1e-12) return null;

  const b = 2 * (p0.x * dx + p0.y * dy);
  const c = p0.x * p0.x + p0.y * p0.y - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (!(t >= 0 && t <= 1)) return null;

  return { x: (p0.x + dx * t) * geo.rx, y: (p0.y + dy * t) * geo.ry };
}

/**
 * Canvas point where the shield lights up for a shot fired from `sourcePoint`
 * at `hullPoint` — and, when the shields hold, where that shot stops.
 *
 * `capT` slides it along the ray from the envelope boundary to the hull hit
 * point, so a shot pushes into the shield to a different depth each time.
 * Weapon and glow read the same value, so the beam always ends exactly where
 * the shield lights up rather than halting at the boundary while the glow sits
 * somewhere over the ship.
 *
 * Null when there is nothing to meet — see `_crossingLocal`.
 */
export function getShieldCapPoint(targetToken, sourcePoint, hullPoint, capT) {
  const from = _point(sourcePoint);
  const to   = _point(hullPoint);
  if (!targetToken || targetToken.destroyed || !from || !to) return null;

  try {
    const geo = getShieldEnvelopeGeometry(targetToken, resolveShieldStandoffFactor(targetToken));
    const frame = _envelopeFrame(targetToken, geo);
    const hullLocal = _toLocal(frame, to);
    const crossing = _crossingLocal(geo, _toLocal(frame, from), hullLocal);
    if (!crossing) return null;
    return _toCanvas(frame, _capAnchor(geo, crossing, hullLocal, capT, 0));
  } catch (err) {
    console.warn("STA2e Toolkit | Shield cap point failed:", err);
    return null;
  }
}

function _crestAngle(container, geo, trig, sourcePoint, impactPoint) {
  const from = _point(sourcePoint) ?? _point(impactPoint);
  if (!from) return 0;

  const dx = from.x - container.x;
  const dy = from.y - container.y;
  const lx =  dx * trig.cos + dy * trig.sin;
  const ly = -dx * trig.sin + dy * trig.cos;

  if (Math.abs(lx) < 1e-6 && Math.abs(ly) < 1e-6) return 0;
  return Math.atan2(ly / geo.ry, lx / geo.rx);
}

// ── The envelope ─────────────────────────────────────────────────────────────

/**
 * The bubble's boundary: one faint ellipse outline, drawn once at full alpha.
 *
 * Only `rim.alpha` is animated afterwards. This used to be redrawn every frame
 * as 64 separately-shaded segments so the crest could have angular falloff; the
 * cap sprite gets that falloff from a gradient instead, which is both cheaper
 * and smoother.
 */
export function drawShieldRim(g, geo, color, width) {
  g.clear();

  const step = (Math.PI * 2) / RIM_SEGMENTS;
  for (let i = 0; i < RIM_SEGMENTS; i++) {
    const t0 = i * step;
    const t1 = t0 + step;
    _strokeSegment(
      g,
      Math.cos(t0) * geo.rx, Math.sin(t0) * geo.ry,
      Math.cos(t1) * geo.rx, Math.sin(t1) * geo.ry,
      width, color, 1,
    );
  }
}

/** A filled ellipse, used only as a mask — for the cap here, for the grain in
 * shield-idle-vfx.js. */
export function drawShieldEnvelopeFill(g, geo) {
  g.clear();
  if (typeof g.drawEllipse === "function") {
    g.beginFill(0xffffff, 1);
    g.drawEllipse(0, 0, geo.rx, geo.ry);
    g.endFill();
    return;
  }
  g.ellipse(0, 0, geo.rx, geo.ry).fill({ color: 0xffffff, alpha: 1 });
}

/**
 * The lit shield: a soft patch over the portion of the envelope facing the
 * attacker, brightest at the impact bearing and fading inward and around.
 *
 * A radial gradient centred on the rim point does all the shading work; masking
 * it to the envelope is what turns a round glow into a patch that belongs *on*
 * the bubble. Seen from above this reads as a dome facet lighting up over the
 * hull, which sits far better with a top-down beam drawn across the ship than a
 * thin bright line on the silhouette's edge did.
 */
function _buildCap(geo, at, hex) {
  const oc  = document.createElement("canvas");
  oc.width  = 256;
  oc.height = 256;
  const ctx = oc.getContext("2d");
  const rg  = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  rg.addColorStop(0,    `${hex}ff`);
  rg.addColorStop(0.28, `${hex}b0`);
  rg.addColorStop(0.58, `${hex}4d`);
  rg.addColorStop(0.82, `${hex}16`);
  rg.addColorStop(1,    "rgba(0,0,0,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, 256, 256);

  const glow = new PIXI.Sprite(PIXI.Texture.from(oc));
  glow.anchor.set(0.5);
  glow.blendMode = _addBlend();

  const radius = Math.max(geo.rx, geo.ry) * CAP_RADIUS_FACTOR;
  glow.width  = radius * 2;
  glow.height = radius * 2;

  glow.x = at.x;
  glow.y = at.y;

  return glow;
}

/**
 * One arc of the rim, drawn in container-local coordinates but pivoted about its
 * own midpoint so it can drift and tumble independently once shields fail.
 */
function _buildFragment(geo, from, to, color, width) {
  const g = new PIXI.Graphics();
  g.blendMode = _addBlend();

  const steps = Math.max(2, Math.round((to - from) / ((Math.PI * 2) / RIM_SEGMENTS)));
  const step  = (to - from) / steps;

  for (let i = 0; i < steps; i++) {
    const t0 = from + i * step;
    const t1 = t0 + step;
    _strokeSegment(
      g,
      Math.cos(t0) * geo.rx, Math.sin(t0) * geo.ry,
      Math.cos(t1) * geo.rx, Math.sin(t1) * geo.ry,
      width, color, 1,
    );
  }

  const mid  = (from + to) / 2;
  const homeX = Math.cos(mid) * geo.rx;
  const homeY = Math.sin(mid) * geo.ry;

  // Pivot on the arc's own midpoint so it tumbles about itself rather than
  // orbiting the ship, then park position there to cancel the pivot's shift.
  g.pivot.set(homeX, homeY);
  g.position.set(homeX, homeY);

  // Outward normal of the ellipse at that midpoint, as a unit vector.
  let nx = Math.cos(mid) / geo.rx;
  let ny = Math.sin(mid) / geo.ry;
  const length = Math.hypot(nx, ny) || 1;
  nx /= length;
  ny /= length;

  return { g, nx, ny, spin: (Math.random() - 0.5) * 1.6, home: { x: homeX, y: homeY } };
}

// ── The flare at the point of impact ─────────────────────────────────────────

function _buildFlare(at, hex, radius) {
  const oc  = document.createElement("canvas");
  oc.width  = 128;
  oc.height = 128;
  const ctx = oc.getContext("2d");
  const rg  = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0,    "rgba(255,255,255,0.95)");
  rg.addColorStop(0.22, `${hex}dd`);
  rg.addColorStop(0.55, `${hex}55`);
  rg.addColorStop(1,    "rgba(0,0,0,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, 128, 128);

  const sprite = new PIXI.Sprite(PIXI.Texture.from(oc));
  sprite.anchor.set(0.5);
  sprite.blendMode = _addBlend();
  sprite.width  = radius * 2;
  sprite.height = radius * 2;
  sprite.x = at.x;
  sprite.y = at.y;

  return sprite;
}

/**
 * Where the lit patch sits, in the envelope's local frame.
 *
 * Somewhere on the ray between the point the shot met the envelope and the hull
 * pixel it was aimed at, picked by `capT`. At 0 the glow sits on the beam's
 * stopping point; at 1 it sits over the token on the hit location; in between it
 * bridges the two. Varying it per shot keeps a sustained exchange from looking
 * stamped out of the same frame.
 *
 * `capT` is drawn once by the firing client and carried in the socket payload —
 * a local `Math.random()` would put the cap somewhere different on every screen.
 *
 * Falls back to the rim point at the attacker's bearing when the shot has no
 * crossing to work from (attacker inside the envelope, or no source at all).
 */
function _capAnchor(geo, crossing, hullLocal, capT, theta) {
  if (!crossing || !hullLocal) {
    return { x: Math.cos(theta) * geo.rx, y: Math.sin(theta) * geo.ry };
  }

  const t = _clamp(_number(capT, 0.5), 0, 1);
  const x = crossing.x + (hullLocal.x - crossing.x) * t;
  const y = crossing.y + (hullLocal.y - crossing.y) * t;

  // Pull an anchor that landed outside back onto the boundary. The hull hit
  // point is not guaranteed to be inside the envelope: at a standoff near 1 the
  // ellipse is inscribed in the art's bounding BOX, so a pixel out toward a
  // corner of the art falls outside it. Left alone, the mask would clip most of
  // the cap away and the shield would barely register.
  const k = Math.hypot(x / geo.rx, y / geo.ry);
  return k > 1 ? { x: x / k, y: y / k } : { x, y };
}

// ── The effect ───────────────────────────────────────────────────────────────

/**
 * Draw a shield bubble on this client only.
 *
 * @param {object}  payload
 * @param {string}  payload.tokenId    Target token on the current scene
 * @param {number}  payload.x          Canvas x of the hull impact point
 * @param {number}  payload.y          Canvas y of the hull impact point
 * @param {number}  [payload.sx]       Canvas x the fire came from
 * @param {number}  [payload.sy]       Canvas y the fire came from
 * @param {string}  payload.color      Resolved hex, e.g. "#9fd8ff"
 * @param {number}  payload.intensity  Pre-computed 0.2–1.6 strength scalar
 * @param {number}  [payload.standoff] Envelope size factor, resolved by the sender
 * @param {number}  [payload.capT]     0–1 along the crossing→hull ray, rolled by the sender
 * @param {boolean} payload.broke      This hit dropped shields to zero
 */
export function playShieldBubbleLocal({ tokenId, x, y, sx, sy, color, intensity = 1, standoff, capT, broke = false } = {}) {
  if (typeof PIXI === "undefined") return;

  const token = canvas?.tokens?.get(tokenId);
  if (!token || token.destroyed) return;

  const layer = _effectLayer();
  if (!layer) return;

  try {
    _renderBubble(layer, token, { x, y }, { x: sx, y: sy }, {
      color: String(color ?? "#9fd8ff"),
      intensity: _clamp(_number(intensity, 1), 0.2, 1.6),
      standoff: _clamp(_number(standoff, 1.35), 1, 2),
      capT: _clamp(_number(capT, 0.5), 0, 1),
      broke: !!broke,
    });
  } catch (err) {
    console.warn("STA2e Toolkit | Shield bubble render failed:", err);
  }
}

function _renderBubble(layer, token, impactPoint, sourcePoint, opts) {
  const hex   = /^#[0-9a-f]{6}$/i.test(opts.color) ? opts.color.toLowerCase() : "#9fd8ff";
  const color = _hexToNum(hex);
  const geo   = getShieldEnvelopeGeometry(token, opts.standoff);
  const life  = opts.broke ? BROKE_LIFE_MS : NORMAL_LIFE_MS;

  const container = new PIXI.Container();
  const tokenZ = typeof token.zIndex === "number" ? token.zIndex : 0;
  container.zIndex = Math.max(VFX_Z_BASE, tokenZ + 10_000);

  const frame = seatShieldEnvelope(container, token, geo);
  const theta = _crestAngle(container, geo, frame, sourcePoint, impactPoint);

  // Where the shot met the envelope, and where on the hull it was aimed — the
  // two ends of the ray the cap is placed along.
  const from = _point(sourcePoint);
  const hullLocal = _point(impactPoint) ? _toLocal(frame, _point(impactPoint)) : null;
  const crossing = (from && hullLocal)
    ? _crossingLocal(geo, _toLocal(frame, from), hullLocal)
    : null;
  const capAt = _capAnchor(geo, crossing, hullLocal, opts.capT, theta);

  const minRadius = Math.min(geo.rx, geo.ry);

  // The boundary. Drawn once; only its alpha moves after this.
  const rim = new PIXI.Graphics();
  rim.blendMode = _addBlend();
  drawShieldRim(rim, geo, color, RIM_WIDTH);
  container.addChild(rim);

  // The lit patch, clipped to the envelope so it reads as light ON the bubble
  // rather than a glow floating over the ship.
  const cap = new PIXI.Container();
  const capGlow = _buildCap(geo, capAt, hex);
  const capBase = capGlow.width;
  cap.addChild(capGlow);

  const capMask = new PIXI.Graphics();
  drawShieldEnvelopeFill(capMask, geo);
  container.addChild(capMask);
  // An unmasked cap spills a little past the envelope, which is a far better
  // failure than no shield at all — so this never throws the effect away.
  try { cap.mask = capMask; }
  catch { capMask.visible = false; }
  container.addChild(cap);

  // A brief hot core at the impact bearing. The cap alone blooms too softly to
  // land as a strike; this supplies the snap. Inside the mask with the cap.
  const flare = _buildFlare(capAt, hex, minRadius * (0.22 + 0.16 * opts.intensity));
  const flareBase = flare.width;
  cap.addChild(flare);

  // One glow pass for the whole container beats one per child.
  try {
    const GlowFilter = PIXI.filters?.GlowFilter ?? globalThis.PIXI?.filters?.GlowFilter;
    if (GlowFilter) {
      container.filters = [new GlowFilter({
        distance:      Math.round(8 + 14 * opts.intensity),
        outerStrength: 2.2 * opts.intensity,
        innerStrength: 0,
        color,
        quality:       0.3,
      })];
    }
  } catch { /* glow is a bonus, never a requirement */ }

  layer.addChild(container);

  const crestWidth = Math.max(2.0, minRadius * 0.075) * opts.intensity;
  const glow       = container.filters?.[0] ?? null;
  const glowPeak   = 2.2 * opts.intensity;

  /** Populated at the moment the envelope gives way. */
  let fragments = null;

  const record = { container, stop: null };
  _live.add(record);

  const onToken = _byToken.get(token.id) ?? [];
  onToken.push(record);
  _byToken.set(token.id, onToken);
  while (onToken.length > MAX_PER_TOKEN) {
    const oldest = onToken.shift();
    try { oldest.stop?.(); } catch { /* already torn down */ }
  }

  let elapsed = 0;
  let prevNow = performance.now();

  function finish() {
    _live.delete(record);

    const siblings = _byToken.get(token.id);
    if (siblings) {
      const index = siblings.indexOf(record);
      if (index >= 0) siblings.splice(index, 1);
      if (!siblings.length) _byToken.delete(token.id);
    }

    try { canvas.app.ticker.remove(tick); } catch { /* already gone */ }
    // destroy() does not take the filters with it, and a GlowFilter holds a
    // shader program.
    try { for (const f of container.filters ?? []) f?.destroy?.(); } catch { /* older pixi-filters */ }
    try { container.filters = null; } catch { /* already gone */ }
    try { container.destroy({ children: true }); } catch { /* already gone */ }
  }
  record.stop = finish;

  function tick() {
    const now = performance.now();
    // Clamp so a backgrounded tab does not fast-forward the whole effect.
    elapsed += Math.min(now - prevNow, 50);
    prevNow = now;

    if (elapsed >= life || token.destroyed) { finish(); return; }
    paint();
  }

  function paint() {
    // Re-seat first: a ship still gliding from an earlier move must not leave
    // its bubble behind, and everything below is drawn in the container's frame.
    seatShieldEnvelope(container, token, geo);

    const p = elapsed / life;

    if (!opts.broke) {
      // The patch dims as it spreads — the hit washing inward over the hull.
      const spread = 1 - (1 - p) * (1 - p);
      cap.alpha = _clamp(0.95 * opts.intensity * Math.pow(1 - p, 1.5), 0, 1);
      capGlow.width  = capBase * (0.72 + 0.42 * spread);
      capGlow.height = capBase * (0.72 + 0.42 * spread);
      rim.alpha = 0.16 * Math.pow(1 - p, 2.2);

      const fp = Math.min(1, elapsed / 260);
      flare.alpha  = 1 - fp;
      flare.width  = flareBase * (0.4 + 0.9 * fp);
      flare.height = flareBase * (0.4 + 0.9 * fp);
      if (glow) glow.outerStrength = glowPeak * (1 - p);
      return;
    }

    // ── Shields failing ──────────────────────────────────────────────────────
    if (elapsed < BROKE_FLARE_MS) {
      // The patch floods the whole envelope and the boundary goes bright: for
      // one moment the entire bubble is real, just before it is not.
      const fp = elapsed / BROKE_FLARE_MS;
      cap.alpha = 1;
      capGlow.width  = capBase * (0.72 + 2.2 * fp);
      capGlow.height = capBase * (0.72 + 2.2 * fp);
      rim.alpha = 0.9 * fp;

      const fq = Math.min(1, elapsed / 220);
      flare.alpha  = 1 - fq;
      flare.width  = flareBase * (0.4 + 1.1 * fq);
      flare.height = flareBase * (0.4 + 1.1 * fq);
      return;
    }

    if (!fragments) {
      // The envelope gives way: the lit shell is replaced by loose pieces.
      cap.visible = false;
      rim.clear();
      rim.visible = false;

      fragments = [];
      const arc = (Math.PI * 2) / BROKE_FRAGMENTS;
      for (let i = 0; i < BROKE_FRAGMENTS; i++) {
        // Break at the impact bearing, so the crack starts where it was hit.
        const from = theta + i * arc + arc * 0.04;
        const fragment = _buildFragment(geo, from, from + arc * 0.92, color, RIM_WIDTH + crestWidth * 0.4);
        container.addChild(fragment.g);
        fragments.push(fragment);
      }
    }

    const q = (elapsed - BROKE_FLARE_MS) / (life - BROKE_FLARE_MS);

    // Outward displacement in pixels: a brief inward collapse, then the pieces
    // let go and drift off along their own normals.
    const collapse = minRadius * 0.08;
    const release  = q < 0.14 ? 0 : (q - 0.14) / 0.86;
    const push = q < 0.14
      ? -collapse * (q / 0.14)
      : -collapse * (1 - release) + minRadius * 0.42 * Math.pow(release, 0.7);

    const alpha = Math.pow(1 - q, 1.5);

    for (const fragment of fragments) {
      fragment.g.position.set(
        fragment.home.x + fragment.nx * push,
        fragment.home.y + fragment.ny * push,
      );
      fragment.g.rotation = fragment.spin * q * 0.35;
      fragment.g.alpha    = alpha;
    }

    if (glow) glow.outerStrength = glowPeak * alpha;
  }

  // Paint frame zero now instead of waiting for the ticker's next pass. The
  // crest is at full brightness at elapsed=0, so this is the frame that has to
  // coincide with the weapon landing — a container added empty would show
  // nothing until the following frame.
  paint();

  canvas.app.ticker.add(tick);
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Strength scalar shared by both layers of the effect. A hit that eats most of
 * the shield pool flares harder than a graze, scaled by the world
 * Subtle/Cinematic/Intense preset so one setting governs the whole impact.
 */
function _intensity({ finalDamage, maxShields, shieldBroke }) {
  const damage = Math.max(0, _number(finalDamage, 0));
  const pool   = Math.max(1, _number(maxShields, 8));
  const share  = _clamp(damage / pool, 0.12, 1.15);

  let preset = 1;
  try {
    preset = { subtle: 0.72, cinematic: 1, intense: 1.24 }[game.settings.get(MODULE, "shieldImpactPreset")] ?? 1;
  } catch { /* setting not registered yet */ }

  return _clamp((0.55 + share * 0.65) * preset * (shieldBroke ? 1.15 : 1), 0.2, 1.6);
}

/**
 * Play a shield bubble on every client.
 *
 * @param {Token}  targetToken            The ship that was hit
 * @param {{x:number,y:number}} impactPoint  Canvas point the shot landed on
 * @param {object} opts
 * @param {string} opts.color             Resolved hex from resolveShieldImpactColorHex()
 * @param {{x:number,y:number}} [opts.sourcePoint]  Where the fire came from — the
 *   firing emitter if the caller knows it, otherwise the attacking token's
 *   centre. This is what decides which side of the hull lights up, so a caller
 *   that omits it falls back to the (scattered) hull hit point.
 * @param {number} opts.finalDamage
 * @param {number} opts.maxShields
 * @param {boolean} opts.shieldBroke      This hit dropped shields to zero
 */
export function playShieldBubble(targetToken, impactPoint, opts = {}) {
  const tokenId = targetToken?.id;
  if (!tokenId) return;

  const point = _point(impactPoint) ?? _point(targetToken.center) ?? { x: 0, y: 0 };
  const from  = _point(opts.sourcePoint);

  const payload = {
    tokenId,
    x: point.x,
    y: point.y,
    sx: from?.x ?? null,
    sy: from?.y ?? null,
    color: String(opts.color ?? "#9fd8ff"),
    intensity: _intensity(opts),
    // Resolved here and carried, not re-read per client: the world setting
    // would agree everywhere, but a per-ship override lives on an actor flag a
    // remote client may not have loaded, and a bubble that is a different size
    // on each screen is worse than one that is the wrong size on all of them.
    standoff: resolveShieldStandoffFactor(targetToken),
    // Comes from the fire path, which used the same value to decide where the
    // shot stops — that is what keeps the beam's end and the glow together.
    // Rolled here only for callers with no weapon behind them (the test helper).
    capT: Number.isFinite(Number(opts.capT)) ? Number(opts.capT) : Math.random(),
    broke: !!opts.shieldBroke,
  };

  playShieldBubbleLocal(payload);

  // Native PIXI is client-local and sockets do not loop back, so this is
  // exactly one draw per client rather than a double on the sender.
  try {
    game.socket.emit(`module.${MODULE}`, {
      action: "shieldBubbleVfx",
      sceneId: canvas?.scene?.id ?? null,
      ...payload,
    });
  } catch { /* cosmetic — never block damage application */ }
}

/**
 * Console helper: fire a bubble at the first targeted token, struck from the
 * controlled token's bearing (or a random one when nothing is selected).
 */
export function testShieldBubble({ shieldBroke = false, color = null, finalDamage = 6, maxShields = 8 } = {}) {
  const target = Array.from(game.user?.targets ?? [])[0] ?? canvas?.tokens?.controlled?.[0] ?? null;
  if (!target) {
    ui.notifications.warn("STA2e Toolkit: target or select a token first.");
    return;
  }

  // Fire from the controlled token when there is one, so the crest can be
  // checked against a real bearing; otherwise pick a random side.
  const source = canvas?.tokens?.controlled?.find(t => t !== target) ?? null;
  const geo = getShieldEnvelopeGeometry(target, resolveShieldStandoffFactor(target));
  const bearing = Math.random() * Math.PI * 2;
  const sourcePoint = source?.center ?? {
    x: target.center.x + Math.cos(bearing) * geo.rx * 3,
    y: target.center.y + Math.sin(bearing) * geo.ry * 3,
  };

  playShieldBubble(target, target.center, {
    color: color ?? undefined,
    sourcePoint,
    finalDamage,
    maxShields,
    shieldBroke,
  });
}

/** Call from main.js "ready", beside registerTractorBeamVfxHooks(). */
export function registerShieldBubbleVfxHooks() {
  Hooks.on("canvasTearDown", () => {
    for (const record of [..._live]) {
      try { record.stop(); } catch { /* already torn down */ }
    }
    _live.clear();
    _byToken.clear();
  });
}
