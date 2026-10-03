/**
 * sta2e-toolkit | region-terrain.js
 *
 * Region Terrain — the query layer over the three Region behaviors registered
 * by region-terrain-behaviors.js:
 *
 *   sta2e-toolkit.difficultTerrain  crossing costs Momentum
 *   sta2e-toolkit.terrainHazard     one hazard (immediate / lingering / terrain)
 *   sta2e-toolkit.sensorShroud      an obscured area with a potency
 *
 * Regions are independent of the zone grid, so everything here works the same
 * on a drawn-zone scene and a dynamic-zone scene. Nothing here knows about
 * chat cards, pools or PIXI: the movement log, the hazard code, the roller and
 * the visibility wrapper all read it, so it must stay a near-leaf. It imports
 * only region geometry and the hazard type table.
 */

import { regionContainsPoint } from "./spawn-regions.js";
import { HAZARD_TYPES } from "./zone-data.js";

const MODULE = "sta2e-toolkit";

export const TERRAIN_BEHAVIOR = "sta2e-toolkit.difficultTerrain";
export const HAZARD_BEHAVIOR  = "sta2e-toolkit.terrainHazard";
export const SHROUD_BEHAVIOR  = "sta2e-toolkit.sensorShroud";

const KIND_BY_TYPE = Object.freeze({
  [TERRAIN_BEHAVIOR]: "terrain",
  [HAZARD_BEHAVIOR]:  "hazard",
  [SHROUD_BEHAVIOR]:  "shroud",
});

/** Token flag set by a successful Reveal; cleared when the token moves. */
export const REVEAL_FLAG = "sensorRevealed";

/** Revealed hidden vessels are attacked at +2 Difficulty (Reveal, core rules). */
export const REVEALED_ATTACK_PENALTY = 2;

// ── Feature lookup ───────────────────────────────────────────────────────────

// Memoised per scene id. Region and behavior hooks call
// invalidateRegionFeatures(); nothing else can change the answer.
const _cache = new Map();

export function invalidateRegionFeatures() {
  _cache.clear();
}

function _collection(c) {
  if (!c) return [];
  if (Array.isArray(c)) return c;
  return c.contents ?? Array.from(c);
}

function _scanScene(scene) {
  const out = [];
  for (const region of _collection(scene?.regions)) {
    for (const behavior of _collection(region?.behaviors)) {
      const kind = KIND_BY_TYPE[behavior?.type];
      if (!kind || behavior.disabled) continue;
      out.push({ region, behavior, kind, system: behavior.system ?? {} });
    }
  }
  return out;
}

/**
 * Every enabled terrain / hazard / shroud behavior on the scene.
 * @param {Scene} [scene]
 * @param {"terrain"|"hazard"|"shroud"} [kind]
 * @returns {{region, behavior, kind, system}[]}
 */
export function getRegionFeatures(scene = canvas?.scene, kind = null) {
  if (!scene) return [];
  const key = scene.id ?? scene;
  let all = _cache.get(key);
  if (!all) { all = _scanScene(scene); _cache.set(key, all); }
  return kind ? all.filter(f => f.kind === kind) : all;
}

/** Features whose Region contains the canvas point. */
export function featuresAtPoint(pt, kind = null, scene = canvas?.scene) {
  return getRegionFeatures(scene, kind).filter(f => regionContainsPoint(f.region, pt));
}

// ── Token geometry ───────────────────────────────────────────────────────────

function _tokenDoc(t) {
  return t?.document ?? t;
}

function _gridSize(scene) {
  return scene?.grid?.size ?? canvas?.grid?.size ?? canvas?.dimensions?.size ?? 100;
}

/** A token's centre in canvas space, from its document. */
export function tokenCentre(t, scene = canvas?.scene) {
  const doc = _tokenDoc(t);
  const gs  = _gridSize(doc?.parent ?? scene);
  return {
    x: (doc?.x ?? 0) + ((doc?.width  ?? 1) * gs) / 2,
    y: (doc?.y ?? 0) + ((doc?.height ?? 1) * gs) / 2,
  };
}

/**
 * The points tested for a token. The centre, plus the four footprint corners
 * (inset a little so a hull merely touching a boundary does not count) for a
 * token flagged "Occupies Multiple Zones" — the same footprint rule the zone
 * grid applies to big hulls.
 */
export function tokenSamplePoints(t, scene = canvas?.scene) {
  const doc = _tokenDoc(t);
  const c   = tokenCentre(doc, scene);
  if (!doc?.getFlag?.(MODULE, "multiZone")) return [c];
  const gs = _gridSize(doc?.parent ?? scene);
  const w  = (doc.width  ?? 1) * gs;
  const h  = (doc.height ?? 1) * gs;
  const ix = Math.min(w * 0.1, gs * 0.25);
  const iy = Math.min(h * 0.1, gs * 0.25);
  const x0 = doc.x + ix, x1 = doc.x + w - ix;
  const y0 = doc.y + iy, y1 = doc.y + h - iy;
  return [c, { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }];
}

/** Features whose Region covers the token (any sample point inside). */
export function featuresForToken(t, kind = null, scene = null) {
  const doc = _tokenDoc(t);
  const sc  = scene ?? doc?.parent ?? canvas?.scene;
  const pts = tokenSamplePoints(doc, sc);
  return getRegionFeatures(sc, kind).filter(f => pts.some(p => regionContainsPoint(f.region, p)));
}

export function regionContainsToken(region, t, scene = null) {
  const doc = _tokenDoc(t);
  const pts = tokenSamplePoints(doc, scene ?? doc?.parent ?? canvas?.scene);
  return pts.some(p => regionContainsPoint(region, p));
}

// ── Movement ─────────────────────────────────────────────────────────────────

const MAX_SAMPLES = 400;

/**
 * Regions crossed by the straight move origin → dest, grouped by Region.
 * A Region that already contains `origin` is excluded: leaving costs nothing,
 * entering or passing through does. Sampling through regionContainsPoint is
 * what keeps holes and multi-shape Regions correct without polygon clipping.
 * @returns {Map<string, {region, features: object[]}>}
 */
export function regionsCrossed(origin, dest, scene = canvas?.scene, kinds = ["terrain", "hazard"]) {
  const byRegion = new Map();
  for (const f of getRegionFeatures(scene)) {
    if (!kinds.includes(f.kind)) continue;
    const id = f.region.id ?? f.region;
    if (!byRegion.has(id)) byRegion.set(id, { region: f.region, features: [] });
    byRegion.get(id).features.push(f);
  }
  if (!byRegion.size) return byRegion;

  const dx = dest.x - origin.x, dy = dest.y - origin.y;
  const len = Math.hypot(dx, dy);
  const step = Math.max(1, _gridSize(scene) / 4);
  const n = Math.min(MAX_SAMPLES, Math.max(1, Math.ceil(len / step)));

  const crossed = new Map();
  for (const [id, entry] of byRegion) {
    if (regionContainsPoint(entry.region, origin)) continue;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (regionContainsPoint(entry.region, { x: origin.x + dx * t, y: origin.y + dy * t })) {
        crossed.set(id, entry);
        break;
      }
    }
  }
  return crossed;
}

function _cost(v, floor = 1) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(floor, Math.min(10, n)) : floor;
}

/**
 * A Region hazard in the shape zone-hazard.js already reads from a zone's
 * `hazards[]` entry, plus the `source` ref that says where to store its state.
 */
export function regionHazardView(feature) {
  const s   = feature.system ?? {};
  const est = s.established ?? {};
  const type = s.hazardType || "generic";
  return {
    id:                    feature.behavior.id,
    type,
    label:                 s.label || HAZARD_TYPES[type]?.label || "Hazard",
    category:              s.category || "terrain",
    description:           s.description ?? "",
    momentumCost:          _cost(s.momentumCost),
    established:           !!est.established,
    establishedDamage:     est.damage ?? null,
    establishedDamageType: est.damageType ?? null,
    establishedEffects:    est.effects ?? {},
    establishedThreatCost: est.threatCost ?? 0,
    establishedMode:       est.mode ?? "damage",
    establishedTrait:      est.trait ?? null,
    source: {
      kind:       "region",
      sceneId:    feature.region?.parent?.id ?? canvas?.scene?.id ?? null,
      regionId:   feature.region?.id ?? null,
      behaviorId: feature.behavior?.id ?? null,
    },
    sourceName: feature.region?.name || "Region",
  };
}

/**
 * What the move origin → dest costs in Region terrain, and which Region
 * hazards it runs into.
 *
 * A crossed Region is charged **once**, at the max of its Difficult Terrain and
 * terrain-hazard costs, so two behaviors on one Region never double-charge.
 * Immediate hazards are GM-triggered and never fire on entry.
 */
export function regionMovementCost(origin, dest, scene = canvas?.scene) {
  const out = { cost: 0, entries: [], terrainHazards: [], lingeringHazards: [] };
  if (!origin || !dest) return out;
  for (const { region, features } of regionsCrossed(origin, dest, scene).values()) {
    let regionCost = 0;
    let hazardous  = false;
    const labels   = [];
    for (const f of features) {
      if (f.kind === "terrain") {
        regionCost = Math.max(regionCost, _cost(f.system.momentumCost));
        if (f.system.label) labels.push(f.system.label);
        continue;
      }
      const hz = regionHazardView(f);
      if (hz.category === "terrain") {
        regionCost = Math.max(regionCost, hz.momentumCost);
        hazardous = true;
        labels.push(hz.label);
        out.terrainHazards.push(hz);
      } else if (hz.category === "lingering") {
        out.lingeringHazards.push(hz);
      }
    }
    if (regionCost > 0) {
      out.cost += regionCost;
      out.entries.push({
        regionId:   region.id,
        regionName: region.name || "Region",
        label:      labels.join(", "),
        cost:       regionCost,
        kind:       hazardous ? "hazardous" : "difficult",
      });
    }
  }
  return out;
}

// ── Sensor Shrouds & hidden vessels ──────────────────────────────────────────

const PURPOSE_KEY = Object.freeze({ hide: "hideTokens", sensor: "affectSensors", attack: "affectAttacks" });

function _potency(s) {
  const n = Math.round(Number(s?.potency));
  return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
}

/** Shroud features covering the token that apply to `purpose`. */
export function shroudsForToken(t, purpose = "hide") {
  const key = PURPOSE_KEY[purpose] ?? "hideTokens";
  return featuresForToken(t, "shroud").filter(f => f.system?.[key] !== false);
}

export function isSensorRevealed(t) {
  return !!_tokenDoc(t)?.getFlag?.(MODULE, REVEAL_FLAG);
}

/** Highest shroud potency on the token for `purpose`, ignoring any reveal. */
export function rawShroudPotency(t, purpose = "hide") {
  return shroudsForToken(t, purpose).reduce((m, f) => Math.max(m, _potency(f.system)), 0);
}

/**
 * Highest shroud potency on the token for `purpose`. A revealed token reads 0
 * for hiding and attacking; the Reveal +2 takes over from potency there.
 */
export function shroudPotencyForToken(t, { purpose = "hide" } = {}) {
  if (purpose !== "sensor" && isSensorRevealed(t)) return 0;
  return rawShroudPotency(t, purpose);
}

/** Highest shroud potency at a canvas point for `purpose`, plus the names. */
export function shroudAtPoint(pt, purpose = "sensor", scene = canvas?.scene) {
  const key = PURPOSE_KEY[purpose] ?? "affectSensors";
  const hits = featuresAtPoint(pt, "shroud", scene).filter(f => f.system?.[key] !== false);
  return {
    potency: hits.reduce((m, f) => Math.max(m, _potency(f.system)), 0),
    names:   hits.map(f => f.system?.label || f.region?.name || "Sensor Shroud"),
    regions: hits.map(f => f.region),
  };
}

/** Do the two tokens sit inside at least one common hiding shroud? */
export function sharesShroud(a, b) {
  const ids = new Set(shroudsForToken(a, "hide").map(f => f.region.id));
  return shroudsForToken(b, "hide").some(f => ids.has(f.region.id));
}

/**
 * Is the token inside a hiding shroud set to Hide From Tokens Inside? Such a
 * shroud hides it even from a viewer sharing the shroud, so it overrides the
 * sharesShroud exception rather than feeding it: one thick shroud is enough,
 * whatever thinner shroud the two tokens also share.
 */
export function hiddenWithinShroud(t) {
  return shroudsForToken(t, "hide").some(f => f.system?.hideWithinShroud === true);
}

/** Cloaked: the same test as the Ship Command HUD. */
export function isCloaked(t) {
  const doc = _tokenDoc(t);
  return !!(doc?.actor?.statuses?.has?.("invisible") || doc?.hidden);
}

/** Concealed from sensors right now — cloaked or inside a hiding shroud. */
export function isConcealed(t) {
  return isCloaked(t) || rawShroudPotency(t, "hide") > 0;
}

/** A vessel a Reveal can still find: concealed and not already revealed. */
export function isHiddenVessel(t) {
  return isConcealed(t) && !isSensorRevealed(t);
}

/**
 * Extra attack Difficulty for firing on this token.
 *   - a revealed hidden vessel:          +2 (Reveal), until it moves
 *   - otherwise, inside an attack shroud: +potency
 * The two never stack.
 */
export function concealmentAttackDifficulty(t) {
  if (!t) return { mod: 0, label: "" };
  if (isSensorRevealed(t) && isConcealed(t)) {
    return { mod: REVEALED_ATTACK_PENALTY, label: "Revealed contact" };
  }
  const hits = shroudsForToken(t, "attack");
  const mod  = hits.reduce((m, f) => Math.max(m, _potency(f.system)), 0);
  if (!mod) return { mod: 0, label: "" };
  const name = hits.find(f => _potency(f.system) === mod);
  return { mod, label: name?.system?.label || name?.region?.name || "Sensor Shroud" };
}
