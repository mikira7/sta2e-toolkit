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
  tokenFootprint, rangeBandFor,
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
