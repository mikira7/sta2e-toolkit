/**
 * sta2e-toolkit | zone-dynamic.js
 * Dynamic zones — range bands without a drawn zone grid.
 *
 * On a scene with no zones drawn, a GM can switch on Dynamic Zones in Scene
 * Config. Every token then carries an implicit zone: a band of `radius` pixels
 * around its footprint. Anything inside that band is Close; each further zone
 * out is one zone-width (2 × radius) wider:
 *
 *   gap = 0                → Contact   (footprints touch or overlap)
 *   gap ≤ R                → Close     (0 zones)
 *   gap ≤ R + 2R  = 3R     → Medium    (1 zone)
 *   gap ≤ R + 4R  = 5R     → Long      (2 zones)
 *   beyond                 → Extreme
 *
 * `gap` is measured edge to edge between token footprints, not centre to
 * centre, so a station or a Borg cube carries a proportionally larger zone
 * around its hull — the fluid equivalent of the multiZone token flag.
 *
 * Drawn zones always win: dynamic zones only apply when the scene has none.
 * That keeps every existing zone-grid scene behaving exactly as before.
 *
 * Callers should use `getRangeContext()` + `measureTokenRange()` /
 * `tokensSharingZone()` rather than branching on drawn-vs-dynamic themselves.
 */

import {
  getSceneZones, getZonesForToken, getZoneDistanceBetweenTokens,
  getZonePathWithCosts, tokenFootprint, rangeBandFor, rangeBandColor,
} from "./zone-data.js";

const MODULE = "sta2e-toolkit";
export const DYNAMIC_ZONE_DEFAULT_RADIUS = 300;

/** The world-level default radius in pixels. */
export function getDefaultDynamicZoneRadius() {
  try {
    const v = Number(game.settings.get(MODULE, "dynamicZoneRadiusDefault"));
    if (Number.isFinite(v) && v > 0) return v;
  } catch { /* setting not registered yet */ }
  return DYNAMIC_ZONE_DEFAULT_RADIUS;
}

/** The radius for a scene: its own override, else the world default. */
export function getDynamicZoneRadius(scene = canvas?.scene) {
  const raw = scene?.getFlag?.(MODULE, "dynamicZoneRadius");
  // Number(null) and Number("") are a finite 0 — treat blank as "unset".
  if (raw !== null && raw !== undefined && raw !== "") {
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return getDefaultDynamicZoneRadius();
}

/** True when the scene has Dynamic Zones switched on (regardless of drawn zones). */
export function isDynamicZonesEnabled(scene = canvas?.scene) {
  return scene?.getFlag?.(MODULE, "dynamicZones") === true;
}

/**
 * How range is decided on this scene.
 * @returns {{mode: "drawn"|"dynamic"|null, zones: object[], radius: number}}
 *   `mode: null` means no zone system applies — callers keep their own fallback.
 */
export function getRangeContext(scene = canvas?.scene) {
  const none = { mode: null, zones: [], radius: 0 };
  if (!scene) return none;
  if (scene.getFlag?.(MODULE, "zonesEnabled") === false) return none;
  const zones = getSceneZones(scene);
  if (zones.length) return { mode: "drawn", zones, radius: 0 };
  if (isDynamicZonesEnabled(scene)) {
    return { mode: "dynamic", zones: [], radius: getDynamicZoneRadius(scene) };
  }
  return none;
}

/** Edge-to-edge pixel gap between two rects; 0 when they touch or overlap. */
export function rectGap(a, b) {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

/** Zones crossed for a pixel gap under a given radius. */
export function dynamicZoneCount(gapPx, radius) {
  if (!(radius > 0)) return -1;
  if (gapPx <= radius) return 0;
  return Math.ceil((gapPx - radius) / (2 * radius));
}

/**
 * Dynamic range between two tokens, in the same shape getZoneDistance returns,
 * plus `dynamic: true` and `distancePx`. fromZone / toZone are null — there is
 * no named zone to report.
 */
export function getDynamicZoneDistanceBetweenTokens(tokenA, tokenB, radius = getDynamicZoneRadius()) {
  const gap = rectGap(tokenFootprint(tokenA), tokenFootprint(tokenB));
  const zoneCount = dynamicZoneCount(gap, radius);
  const rangeBand = zoneCount < 0 ? "" : (gap <= 0 ? "Contact" : rangeBandFor(zoneCount));
  return {
    zoneCount, rangeBand, momentumCost: 0,
    fromZone: null, toZone: null, path: [],
    dynamic: true, distancePx: gap,
  };
}

/** Dynamic range between two canvas points (ruler measurements). */
export function getDynamicZoneDistanceBetweenPoints(pointA, pointB, radius = getDynamicZoneRadius()) {
  const d = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
  const zoneCount = dynamicZoneCount(d, radius);
  return {
    zoneCount, rangeBand: zoneCount < 0 ? "" : rangeBandFor(zoneCount), momentumCost: 0,
    fromZone: null, toZone: null, path: [],
    dynamic: true, distancePx: d,
  };
}

// ── Movement ────────────────────────────────────────────────────────────────
//
// A move is measured centre to centre, straight line, with the same bands as
// range: staying within R of where you started is still your own zone, and
// each zone further out is another 2R. So a move of `n` zones reaches
// R × (2n + 1) — Impulse's 2 zones is 5R, a ground Move of 1 zone is 3R.
// Dynamic moves carry no Momentum cost: there is no terrain to charge for.

/** How far from its start a token can go while crossing at most `zones` zones. */
export function dynamicReachRadius(zones, radius) {
  return radius * (2 * Math.max(0, zones) + 1);
}

/**
 * Point-to-point movement under whichever system the scene uses — the drawn
 * zone path with per-step costs, or a straight-line dynamic measurement.
 * @returns {object|null} null when no zone system applies. A drawn result with
 *   an end outside every zone has null fromZone/toZone, as getZonePathWithCosts
 *   always has; a dynamic result has `dynamic: true` and null zones by design.
 */
export function measureMovement(from, to, ctx = getRangeContext()) {
  if (!from || !to || !ctx?.mode) return null;
  if (ctx.mode === "drawn") return getZonePathWithCosts(from, to, ctx.zones);
  return getDynamicZoneDistanceBetweenPoints(from, to, ctx.radius);
}

/** True when a movement result is usable — a dynamic one needs no named zones. */
export function isMovementMeasured(info) {
  if (!info || !(info.zoneCount >= 0)) return false;
  return info.dynamic === true || (!!info.fromZone && !!info.toZone);
}

const _hexInt = hex => parseInt(String(hex).replace("#", ""), 16) || 0xffffff;

/**
 * Draw zone-boundary rings round a start point onto a caller-owned legacy-API
 * PIXI.Graphics (lineStyle / drawCircle — what the drag overlays already use).
 * Ring `i` is the outer edge of "i zones moved", coloured by its range band.
 *
 * @param {PIXI.Graphics} gfx
 * @param {{x:number,y:number}} center
 * @param {number} radius
 * @param {object} [opts]
 * @param {number} [opts.count=3]        rings to draw (Close, Medium, Long)
 * @param {number} [opts.activeIndex=-1] ring drawn heavier — the cursor's band
 * @param {(i:number) => number} [opts.colorFor] ring colour override
 */
export function drawDynamicZoneRings(gfx, center, radius, { count = 3, activeIndex = -1, colorFor = null } = {}) {
  if (!gfx || !center || !(radius > 0)) return;
  for (let i = 0; i < count; i++) {
    const color = colorFor ? colorFor(i) : _hexInt(rangeBandColor(rangeBandFor(i)));
    const active = i === activeIndex;
    gfx.lineStyle(active ? 3 : 1.5, color, active ? 0.9 : 0.4);
    gfx.drawCircle(center.x, center.y, dynamicReachRadius(i, radius));
  }
  gfx.lineStyle(0);
}

/**
 * Token-to-token range under whichever system the scene uses.
 * @returns {object|null} zone-distance info, or null when no zone system applies.
 */
export function measureTokenRange(tokenA, tokenB, ctx = getRangeContext()) {
  if (!tokenA || !tokenB || !ctx?.mode) return null;
  if (ctx.mode === "drawn") return getZoneDistanceBetweenTokens(tokenA, tokenB, ctx.zones);
  return getDynamicZoneDistanceBetweenTokens(tokenA, tokenB, ctx.radius);
}

/**
 * Tokens in the same zone as `origin` — sharing a drawn zone, or within the
 * dynamic radius of its footprint.
 *
 * @param {Token} origin
 * @param {(t: Token) => boolean} [filter]  extra eligibility test; origin is always excluded
 * @param {object} [ctx=getRangeContext()]
 * @returns {{targets: Token[], usingZones: boolean, dynamic: boolean, zoneNames: string[]}}
 *   `usingZones` false means no zone system applies and nothing was searched —
 *   callers keep their own fallback.
 */
export function tokensSharingZone(origin, filter = () => true, ctx = getRangeContext()) {
  const empty = { targets: [], usingZones: false, dynamic: false, zoneNames: [] };
  if (!origin || !ctx?.mode) return empty;
  const candidates = (canvas.tokens?.placeables ?? [])
    .filter(t => t && t.id !== origin.id && filter(t));

  if (ctx.mode === "drawn") {
    const originZones = getZonesForToken(origin, ctx.zones);
    if (!originZones.length) return empty;
    const ids = new Set(originZones.map(z => z.id));
    return {
      targets: candidates.filter(t => getZonesForToken(t, ctx.zones).some(z => ids.has(z.id))),
      usingZones: true,
      dynamic: false,
      zoneNames: originZones.map(z => z.name ?? z.label ?? z.id).filter(Boolean),
    };
  }

  const fp = tokenFootprint(origin);
  return {
    targets: candidates.filter(t => rectGap(fp, tokenFootprint(t)) <= ctx.radius),
    usingZones: true,
    dynamic: true,
    zoneNames: [`${origin.name ?? "target"}'s zone`],
  };
}
