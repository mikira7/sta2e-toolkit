/**
 * sta2e-toolkit | zone-data.js
 * Zone data storage (scene flags), geometry utilities, adjacency graph,
 * and BFS zone-distance calculation for the STA 2e zone movement system.
 */

const FLAG_SCOPE = "sta2e-toolkit";
const FLAG_KEY   = "zones";

// ── Range band mapping ──────────────────────────────────────────────────────
// Contact  — token footprints touch or overlap
// Close    — tokens are in the same zone (but not base-to-base)
// Medium   — 1 zone away
// Long     — 2 zones away
// Extreme  — 3 or more zones away
export const RANGE_BANDS = Object.freeze({
  0: "Close",
  1: "Medium",
  2: "Long",
});
export function rangeBandFor(zoneCount) {
  if (zoneCount === 0) return "Close";
  if (zoneCount === 1) return "Medium";
  if (zoneCount === 2) return "Long";
  return "Extreme";
}

/**
 * Returns a display color hex string for a range band.
 * Used by the drag ruler and ruler overlays.
 */
export function rangeBandColor(rangeBand) {
  switch (rangeBand) {
    case "Contact": return "#00ff88";
    case "Close":   return "#cccc00";
    case "Medium":  return "#ff8800";
    case "Long":    return "#ff3333";
    case "Extreme": return "#cc44ff";
    default:        return "#ffffff";
  }
}

// ── Hazard type registry ─────────────────────────────────────────────────────
//
// Hazard object schema (stored in zone.hazards[]):
//   id:                    string   — unique ID, assigned at creation
//   type:                  string   — key from HAZARD_TYPES
//   label:                 string   — display name
//   category:              string   — "immediate" | "lingering" | "terrain"
//   description:           string   — optional flavor text
//   established:           boolean  — Threat already spent; waives future cost
//   establishedDamage:     number   — stored damage value (set at first resolution)
//   establishedDamageType: string   — "stress" | "shields" | "breaches"
//   establishedEffects:    object   — { piercing, persistent, persistentRounds,
//                                       area, multiZone, notAdversaries }
//
export const HAZARD_TYPES = Object.freeze({
  "radiation":     { label: "Radiation",                 context: ["space", "ground"] },
  "plasma-storm":  { label: "Plasma Storm",              context: ["space"] },
  "asteroid-field":{ label: "Asteroid Field",            context: ["space"] },
  "nebula-gas":    { label: "Nebula Gas",                context: ["space"] },
  "fire":          { label: "Fire / Plasma Fire",        context: ["space", "ground"] },
  "falling-rocks": { label: "Falling Rocks / Debris",   context: ["ground"] },
  "cave-in":       { label: "Cave-in / Structural Collapse", context: ["ground"] },
  "toxic-gas":     { label: "Toxic Gas / Atmosphere",   context: ["ground"] },
  "quicksand":     { label: "Quicksand / Unstable Ground", context: ["ground"] },
  "electrical":    { label: "Electrical Discharge",     context: ["ground"] },
  "extreme-temp":  { label: "Extreme Temperature",      context: ["ground"] },
  "minefield":     { label: "Mines / Explosives",       context: ["space", "ground"] },
  "generic":       { label: "Generic Hazard",           context: ["space", "ground"] },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Flag CRUD helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get all zones for a scene.
 * @param {Scene} [scene=canvas?.scene]
 * @returns {object[]}
 */
export function getSceneZones(scene = canvas?.scene) {
  if (!scene) return [];
  return scene.getFlag(FLAG_SCOPE, FLAG_KEY) ?? [];
}

/**
 * Overwrite the entire zones array for a scene.
 * @param {object[]} zones
 * @param {Scene} [scene=canvas?.scene]
 */
export async function setSceneZones(zones, scene = canvas?.scene) {
  if (!scene) return;
  await scene.setFlag(FLAG_SCOPE, FLAG_KEY, zones);
  _broadcastZonesUpdated();
}

/**
 * Add a single zone.  Assigns an id if missing.
 * @param {object} zoneData
 * @param {Scene} [scene]
 * @returns {object} the created zone (with id)
 */
export async function addZone(zoneData, scene = canvas?.scene) {
  if (!scene) return null;
  const zones = getSceneZones(scene);
  const zone = {
    id:           zoneData.id ?? foundry.utils.randomID(),
    name:         zoneData.name ?? "",
    vertices:     zoneData.vertices ?? [],
    color:        zoneData.color ?? null,
    momentumCost: zoneData.momentumCost ?? 0,
    tags:         zoneData.tags ?? [],
    sort:         zoneData.sort ?? zones.length,
    // v2 schema additions
    borderStyle:  zoneData.borderStyle ?? "solid",
    isDifficult:  zoneData.isDifficult ?? false,
    opacity:      zoneData.opacity ?? 0.25,
    hazards:      zoneData.hazards ?? [],
  };
  zones.push(zone);
  await scene.setFlag(FLAG_SCOPE, FLAG_KEY, zones);
  _broadcastZonesUpdated();
  return zone;
}

/**
 * Partial update of a zone by id.
 * @param {string} id
 * @param {object} updates
 * @param {Scene} [scene]
 * @returns {object|null} updated zone or null if not found
 */
export async function updateZone(id, updates, scene = canvas?.scene) {
  if (!scene) return null;
  const zones = getSceneZones(scene);
  const idx = zones.findIndex(z => z.id === id);
  if (idx === -1) return null;
  Object.assign(zones[idx], updates);
  await scene.setFlag(FLAG_SCOPE, FLAG_KEY, zones);
  _broadcastZonesUpdated();
  return zones[idx];
}

/**
 * Delete a zone by id.
 * @param {string} id
 * @param {Scene} [scene]
 * @returns {boolean} true if deleted
 */
export async function deleteZone(id, scene = canvas?.scene) {
  if (!scene) return false;
  const zones = getSceneZones(scene);
  const idx = zones.findIndex(z => z.id === id);
  if (idx === -1) return false;
  zones.splice(idx, 1);
  await scene.setFlag(FLAG_SCOPE, FLAG_KEY, zones);
  _broadcastZonesUpdated();
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Geometry utilities
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ray-casting point-in-polygon test.
 * @param {number} x
 * @param {number} y
 * @param {{x:number, y:number}[]} vertices
 * @returns {boolean}
 */
export function pointInPolygon(x, y, vertices) {
  const n = vertices.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Compute the area of a polygon (signed — positive if CCW, negative if CW).
 * Uses the shoelace formula.
 */
export function polygonArea(vertices) {
  const n = vertices.length;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (vertices[j].x + vertices[i].x) * (vertices[j].y - vertices[i].y);
  }
  return area / 2;
}

/**
 * Compute the centroid of a polygon.
 * @param {{x:number, y:number}[]} vertices
 * @returns {{x:number, y:number}}
 */
export function polygonCentroid(vertices) {
  const n = vertices.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n <= 2) {
    const sx = vertices.reduce((s, v) => s + v.x, 0);
    const sy = vertices.reduce((s, v) => s + v.y, 0);
    return { x: sx / n, y: sy / n };
  }
  let cx = 0, cy = 0, areaSum = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const cross = vertices[j].x * vertices[i].y - vertices[i].x * vertices[j].y;
    cx += (vertices[j].x + vertices[i].x) * cross;
    cy += (vertices[j].y + vertices[i].y) * cross;
    areaSum += cross;
  }
  const a6 = areaSum * 3; // 6 * signed area / 2
  if (Math.abs(a6) < 1e-8) {
    // Degenerate polygon — fall back to simple average
    const sx = vertices.reduce((s, v) => s + v.x, 0);
    const sy = vertices.reduce((s, v) => s + v.y, 0);
    return { x: sx / n, y: sy / n };
  }
  return { x: cx / a6, y: cy / a6 };
}

/**
 * Return the zone at a canvas point.  If multiple zones overlap, return the
 * one with the smallest absolute area (most specific).
 * @param {number} x
 * @param {number} y
 * @param {object[]} zones
 * @returns {object|null}
 */
export function getZoneAtPoint(x, y, zones) {
  let best = null;
  let bestArea = Infinity;
  for (const zone of zones) {
    if (!pointInPolygon(x, y, zone.vertices)) continue;
    const area = Math.abs(polygonArea(zone.vertices));
    if (area < bestArea) {
      bestArea = area;
      best = zone;
    }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Polygon clipping
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Clip a polygon to an axis-aligned rectangle using Sutherland-Hodgman.
 * Interior hexes pass through unchanged; edge hexes are trimmed exactly to
 * the scene boundary with no gaps and no overflow.
 *
 * @param {{x:number, y:number}[]} vertices
 * @param {number} rx   sceneX
 * @param {number} ry   sceneY
 * @param {number} rw   sceneWidth
 * @param {number} rh   sceneHeight
 * @returns {{x:number, y:number}[]}  clipped polygon, or [] if fully outside
 */
export function clipPolygonToRect(vertices, rx, ry, rw, rh) {
  const edges = [
    {
      inside:    (p) => p.x >= rx,
      intersect: (a, b) => { const t = (rx - a.x) / (b.x - a.x); return { x: rx, y: a.y + t * (b.y - a.y) }; },
    },
    {
      inside:    (p) => p.x <= rx + rw,
      intersect: (a, b) => { const t = (rx + rw - a.x) / (b.x - a.x); return { x: rx + rw, y: a.y + t * (b.y - a.y) }; },
    },
    {
      inside:    (p) => p.y >= ry,
      intersect: (a, b) => { const t = (ry - a.y) / (b.y - a.y); return { x: a.x + t * (b.x - a.x), y: ry }; },
    },
    {
      inside:    (p) => p.y <= ry + rh,
      intersect: (a, b) => { const t = (ry + rh - a.y) / (b.y - a.y); return { x: a.x + t * (b.x - a.x), y: ry + rh }; },
    },
  ];

  let poly = vertices;
  for (const edge of edges) {
    if (poly.length === 0) return [];
    const output = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const cur  = poly[i];
      const prev = poly[(i + n - 1) % n];
      const curIn  = edge.inside(cur);
      const prevIn = edge.inside(prev);
      if (prevIn && curIn)   { output.push(cur); }
      else if (prevIn)       { output.push(edge.intersect(prev, cur)); }
      else if (curIn)        { output.push(edge.intersect(prev, cur)); output.push(cur); }
    }
    poly = output;
  }
  return poly;
}

/**
 * Clip a polygon to a convex polygon using Sutherland-Hodgman.
 * The clip polygon may be clockwise or counter-clockwise.
 *
 * @param {{x:number, y:number}[]} subject
 * @param {{x:number, y:number}[]} clip
 * @returns {{x:number, y:number}[]}
 */
export function clipPolygonToConvexPolygon(subject, clip) {
  if (!subject?.length || !clip?.length) return [];

  const clipCenter = clip.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  clipCenter.x /= clip.length;
  clipCenter.y /= clip.length;
  const inside = (p, a, b) => {
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const centerCross = (b.x - a.x) * (clipCenter.y - a.y) - (b.y - a.y) * (clipCenter.x - a.x);
    return cross * centerCross >= -1e-8;
  };
  const intersect = (s, e, a, b) => {
    const sx = e.x - s.x;
    const sy = e.y - s.y;
    const cx = b.x - a.x;
    const cy = b.y - a.y;
    const denom = sx * cy - sy * cx;
    if (Math.abs(denom) < 1e-8) return e;
    const t = ((a.x - s.x) * cy - (a.y - s.y) * cx) / denom;
    return { x: s.x + t * sx, y: s.y + t * sy };
  };

  let output = subject;
  for (let i = 0, j = clip.length - 1; i < clip.length; j = i++) {
    const a = clip[j];
    const b = clip[i];
    const input = output;
    output = [];
    if (input.length === 0) return [];
    let s = input[input.length - 1];
    for (const e of input) {
      const eIn = inside(e, a, b);
      const sIn = inside(s, a, b);
      if (eIn) {
        if (!sIn) output.push(intersect(s, e, a, b));
        output.push(e);
      } else if (sIn) {
        output.push(intersect(s, e, a, b));
      }
      s = e;
    }
  }
  return output;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Token footprint zone detection (multi-zone tokens)
// ═══════════════════════════════════════════════════════════════════════════════

const MULTI_ZONE_FLAG = "multiZone";

/**
 * Whether a token has the "occupies multiple zones" flag set.
 * Accepts a Token placeable or a TokenDocument.
 * @param {Token|TokenDocument} token
 * @returns {boolean}
 */
export function isMultiZoneToken(token) {
  const doc = token?.document ?? token;
  return !!doc?.getFlag?.(FLAG_SCOPE, MULTI_ZONE_FLAG);
}

/**
 * Pixel-space bounding rect of a token.
 * Accepts a Token placeable or a TokenDocument.
 * @param {Token|TokenDocument} token
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function tokenFootprint(token) {
  const obj = token?.object ?? token;
  const doc = obj?.document ?? token;
  const gridSize = canvas?.scene?.grid?.size ?? 100;
  const x = obj?.x ?? doc?.x ?? 0;
  const y = obj?.y ?? doc?.y ?? 0;
  const w = obj?.w ?? ((doc?.width  ?? 1) * gridSize);
  const h = obj?.h ?? ((doc?.height ?? 1) * gridSize);
  return { x, y, w, h };
}

/**
 * Polygon for the displayed token image footprint, including texture anchor,
 * texture scale, and token rotation. Falls back to the token document footprint
 * when only a TokenDocument is available.
 * @param {Token|TokenDocument} token
 * @returns {{x:number, y:number}[]}
 */
export function tokenImageFootprint(token) {
  const obj = token?.object ?? token;
  const doc = obj?.document ?? token;
  const fp = tokenFootprint(token);
  const center = obj?.center ?? { x: fp.x + fp.w / 2, y: fp.y + fp.h / 2 };
  const texture = doc?.texture ?? {};
  const anchorX = Number(texture.anchorX ?? 0.5);
  const anchorY = Number(texture.anchorY ?? 0.5);
  const scaleX = Number(texture.scaleX ?? 1) || 1;
  const scaleY = Number(texture.scaleY ?? 1) || 1;
  const rotation = Number(doc?.rotation ?? obj?.rotation ?? 0) * (Math.PI / 180);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return [
    { u: 0, v: 0 },
    { u: 1, v: 0 },
    { u: 1, v: 1 },
    { u: 0, v: 1 },
  ].map(({ u, v }) => {
    const localX = (u - anchorX) * fp.w * scaleX;
    const localY = (v - anchorY) * fp.h * scaleY;
    return {
      x: center.x + localX * cos - localY * sin,
      y: center.y + localX * sin + localY * cos,
    };
  });
}

/**
 * True when two axis-aligned token footprints touch or overlap.
 * Edge and corner contact count as touching; any positive gap is not Contact.
 * @param {{x:number, y:number, w:number, h:number}} a
 * @param {{x:number, y:number, w:number, h:number}} b
 * @returns {boolean}
 */
function _rectsTouchOrOverlap(a, b) {
  return a.x <= b.x + b.w &&
         a.x + a.w >= b.x &&
         a.y <= b.y + b.h &&
         a.y + a.h >= b.y;
}

/**
 * Return all zones whose polygon overlaps an axis-aligned rect.
 * Uses Sutherland-Hodgman clipping; a zone counts as overlapping when the
 * clipped intersection has any positive area, so even a small visible sliver
 * of a multi-zone token inside a zone counts as occupying that zone. A polygon
 * that merely shares an edge with the rect is excluded.
 * @param {number} x  rect left
 * @param {number} y  rect top
 * @param {number} w  rect width
 * @param {number} h  rect height
 * @param {object[]} zones
 * @returns {object[]}
 */
export function getZonesForRect(x, y, w, h, zones) {
  const rectArea = w * h;
  if (rectArea <= 0) {
    const z = getZoneAtPoint(x, y, zones);
    return z ? [z] : [];
  }
  const results = [];
  for (const zone of zones) {
    if (!zone.vertices || zone.vertices.length < 3) continue;
    const clipped = clipPolygonToRect(zone.vertices, x, y, w, h);
    if (clipped.length < 3) continue;
    const overlap = Math.abs(polygonArea(clipped));
    if (overlap > 0) results.push(zone);
  }
  return results;
}

/**
 * Return all zones whose polygon overlaps a token/image polygon.
 * @param {{x:number, y:number}[]} polygon
 * @param {object[]} zones
 * @returns {object[]}
 */
export function getZonesForPolygon(polygon, zones) {
  if (!polygon?.length || Math.abs(polygonArea(polygon)) <= 0) return [];
  const results = [];
  for (const zone of zones) {
    if (!zone.vertices || zone.vertices.length < 3) continue;
    const clipped = clipPolygonToConvexPolygon(zone.vertices, polygon);
    if (clipped.length < 3) continue;
    const overlap = Math.abs(polygonArea(clipped));
    if (overlap > 0) results.push(zone);
  }
  return results;
}

/**
 * Return every zone a token occupies.
 * Tokens flagged with `flags.sta2e-toolkit.multiZone` test their displayed
 * image footprint against zone polygons and may occupy several zones.
 * All other tokens use their center point and occupy at most one zone.
 * @param {Token|TokenDocument} token
 * @param {object[]} [zones=getSceneZones()]
 * @returns {object[]}
 */
export function getZonesForToken(token, zones = getSceneZones()) {
  if (!token || !zones?.length) return [];
  const fp = tokenFootprint(token);
  if (isMultiZoneToken(token)) {
    const overlapped = getZonesForPolygon(tokenImageFootprint(token), zones);
    if (overlapped.length > 0) return overlapped;
  }
  const z = getZoneAtPoint(fp.x + fp.w / 2, fp.y + fp.h / 2, zones);
  return z ? [z] : [];
}

/**
 * Find a multi-zone-flagged token whose image footprint contains a canvas point.
 * Used by measurement tools so pointing anywhere on a Borg cube measures to
 * the cube's nearest occupied zone instead of the zone under the cursor.
 * @param {number} x
 * @param {number} y
 * @param {{exclude?: Token|TokenDocument|null}} [opts]  token to ignore
 *        (e.g. the token being dragged, whose movement stays center-based)
 * @returns {Token|null}
 */
export function getMultiZoneTokenAtPoint(x, y, { exclude = null } = {}) {
  const excludeId = exclude?.id ?? exclude?.document?.id ?? null;
  for (const t of canvas?.tokens?.placeables ?? []) {
    if (excludeId && (t.id === excludeId || t.document?.id === excludeId)) continue;
    if (!isMultiZoneToken(t)) continue;
    if (pointInPolygon(x, y, tokenImageFootprint(t))) return t;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Adjacency detection
// ═══════════════════════════════════════════════════════════════════════════════

/** Squared distance between two points. */
function _distSq(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/**
 * Check if two line segments share an endpoint or overlap.
 * Tolerance-based: considers vertices "shared" if within `threshold` pixels.
 */
const SNAP_THRESHOLD_SQ = 20 * 20; // 20px snap threshold squared

/**
 * Check whether two zones are adjacent.
 * Two zones are adjacent if they share at least two vertices within the snap
 * threshold (i.e., a shared edge), OR if any vertex of one is inside the other
 * (overlapping zones).
 * @param {object} zoneA
 * @param {object} zoneB
 * @returns {boolean}
 */
export function areZonesAdjacent(zoneA, zoneB) {
  const vA = zoneA.vertices;
  const vB = zoneB.vertices;

  // Count shared vertices (within threshold)
  let shared = 0;
  for (const a of vA) {
    for (const b of vB) {
      if (_distSq(a, b) <= SNAP_THRESHOLD_SQ) {
        shared++;
        if (shared >= 2) return true; // Shared edge
        break; // Don't double-count the same vertex of A
      }
    }
  }

  // Check if any vertex of A is inside B or vice versa (overlap)
  for (const a of vA) {
    if (pointInPolygon(a.x, a.y, vB)) return true;
  }
  for (const b of vB) {
    if (pointInPolygon(b.x, b.y, vA)) return true;
  }

  return false;
}

/**
 * Check whether all zones in the array form a single connected group —
 * every zone reachable from every other via pairwise adjacency.
 * @param {object[]} zones
 * @returns {boolean}
 */
export function areZonesAllConnected(zones) {
  if (zones.length <= 1) return true;
  const visited = new Set([zones[0].id]);
  const queue   = [zones[0]];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const other of zones) {
      if (visited.has(other.id)) continue;
      if (areZonesAdjacent(current, other)) {
        visited.add(other.id);
        queue.push(other);
      }
    }
  }
  return visited.size === zones.length;
}

/**
 * Compute the merged outline polygon for a set of adjacent zones using the
 * shared-edge cancellation algorithm:
 *   1. Collect every directed edge from every zone.
 *   2. Interior edges appear in both directions (A→B in one polygon, B→A in
 *      another) — cancel them.
 *   3. Chain the remaining boundary edges into a single polygon.
 *
 * Works correctly for hex grids, square grids, and hand-drawn polygons
 * provided the zones share snapped vertices (within SNAP pixels).
 *
 * @param {object[]} zones
 * @returns {{x:number,y:number}[]|null}  merged vertex array, or null on failure
 */
export function mergeZonePolygons(zones) {
  const SNAP  = 5; // snap vertices to a 5 px grid for key comparison
  const vKey  = (v) => `${Math.round(v.x / SNAP) * SNAP}|${Math.round(v.y / SNAP) * SNAP}`;

  // edgeSet contains "fromKey::toKey" for each boundary edge.
  // Interior edges (present in both directions across adjacent zones) cancel.
  const edgeSet = new Set();
  const vertMap = new Map(); // key → actual {x, y} for output

  for (const zone of zones) {
    const verts = zone.vertices;
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const a  = verts[i];
      const b  = verts[(i + 1) % n];
      const ka = vKey(a);
      const kb = vKey(b);
      if (!vertMap.has(ka)) vertMap.set(ka, { x: Math.round(a.x), y: Math.round(a.y) });
      if (!vertMap.has(kb)) vertMap.set(kb, { x: Math.round(b.x), y: Math.round(b.y) });

      const fwd = `${ka}::${kb}`;
      const rev = `${kb}::${ka}`;
      if (edgeSet.has(rev)) {
        edgeSet.delete(rev); // Interior edge — cancel it
      } else {
        edgeSet.add(fwd);
      }
    }
  }

  if (edgeSet.size === 0) return null;

  // Build directed adjacency from remaining boundary edges
  const adj = new Map(); // fromKey → toKey
  for (const edge of edgeSet) {
    const sep  = edge.indexOf("::");
    const from = edge.slice(0, sep);
    const to   = edge.slice(sep + 2);
    adj.set(from, to);
  }

  // Walk the boundary chain back to the start
  const startKey = [...adj.keys()][0];
  const polygon  = [];
  let current    = startKey;

  for (let guard = 0; guard <= adj.size; guard++) {
    polygon.push(vertMap.get(current));
    const next = adj.get(current);
    if (!next || next === startKey) break;
    current = next;
  }

  return polygon.length >= 3 ? polygon : null;
}

/**
 * Build an adjacency graph for all zones.
 * @param {object[]} zones
 * @returns {Map<string, Set<string>>}  zone.id → Set of adjacent zone ids
 */
export function buildAdjacencyGraph(zones) {
  const graph = new Map();
  for (const z of zones) graph.set(z.id, new Set());

  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      if (areZonesAdjacent(zones[i], zones[j])) {
        graph.get(zones[i].id).add(zones[j].id);
        graph.get(zones[j].id).add(zones[i].id);
      }
    }
  }
  return graph;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BFS zone distance
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute the zone-based distance between two canvas points.
 * Returns zone count, range band, total momentum cost along the shortest path,
 * and the origin/destination zone names.
 *
 * @param {{x:number, y:number}} pointA
 * @param {{x:number, y:number}} pointB
 * @param {object[]} zones  — array of zone objects (from getSceneZones)
 * @returns {{
 *   zoneCount: number,
 *   rangeBand: string,
 *   momentumCost: number,
 *   fromZone: object|null,
 *   toZone: object|null,
 *   path: string[]
 * }}
 */
export function getZoneDistance(pointA, pointB, zones) {
  const fromZone = getZoneAtPoint(pointA.x, pointA.y, zones);
  const toZone   = getZoneAtPoint(pointB.x, pointB.y, zones);

  const empty = {
    zoneCount: -1, rangeBand: "", momentumCost: 0,
    fromZone: null, toZone: null, path: [],
  };

  if (!fromZone || !toZone) return empty;
  if (fromZone.id === toZone.id) {
    return {
      zoneCount: 0, rangeBand: "Close", momentumCost: 0,
      fromZone, toZone, path: [fromZone.id],
    };
  }

  // BFS shortest path
  const graph = buildAdjacencyGraph(zones);
  const zoneMap = new Map(zones.map(z => [z.id, z]));

  const queue = [{ id: fromZone.id, dist: 0, path: [fromZone.id] }];
  const visited = new Set([fromZone.id]);

  while (queue.length > 0) {
    const { id, dist, path } = queue.shift();
    for (const neighborId of graph.get(id) ?? []) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      const newPath = [...path, neighborId];
      if (neighborId === toZone.id) {
        // Calculate momentum cost along the path (exclude starting zone)
        let momentum = 0;
        for (let i = 1; i < newPath.length; i++) {
          momentum += zoneMap.get(newPath[i])?.momentumCost ?? 0;
        }
        return {
          zoneCount: dist + 1,
          rangeBand: rangeBandFor(dist + 1),
          momentumCost: momentum,
          fromZone,
          toZone,
          path: newPath,
        };
      }
      queue.push({ id: neighborId, dist: dist + 1, path: newPath });
    }
  }

  // No path found — zones are disconnected
  return { ...empty, fromZone, toZone };
}

/**
 * Zone distance between two sets of occupied zones (multi-source BFS).
 * Used for multi-zone tokens: range is measured to whichever occupied zone
 * pair is closest. Sharing any zone counts as zoneCount 0.
 *
 * @param {object[]} fromZones  zones occupied by the origin token
 * @param {object[]} toZones    zones occupied by the destination token
 * @param {object[]} zones      all scene zones
 * @param {{contact?: boolean}} [opts]  contact=true upgrades a shared-zone
 *                                      result from "Close" to "Contact"
 * @returns same shape as getZoneDistance
 */
export function getZoneDistanceForZoneSets(fromZones, toZones, zones, opts = {}) {
  const empty = {
    zoneCount: -1, rangeBand: "", momentumCost: 0,
    fromZone: fromZones?.[0] ?? null, toZone: toZones?.[0] ?? null, path: [],
  };
  if (!fromZones?.length || !toZones?.length) return empty;

  const toIds = new Set(toZones.map(z => z.id));

  // Any shared zone → same-zone result
  const shared = fromZones.find(z => toIds.has(z.id));
  if (shared) {
    return {
      zoneCount: 0,
      rangeBand: opts.contact ? "Contact" : "Close",
      momentumCost: 0,
      fromZone: shared, toZone: shared, path: [shared.id],
    };
  }

  // Multi-source BFS from all origin zones at once
  const graph   = buildAdjacencyGraph(zones);
  const zoneMap = new Map(zones.map(z => [z.id, z]));
  const visited = new Set(fromZones.map(z => z.id));
  const queue   = fromZones.map(z => ({ id: z.id, dist: 0, path: [z.id] }));

  while (queue.length > 0) {
    const { id, dist, path } = queue.shift();
    for (const neighborId of graph.get(id) ?? []) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      const newPath = [...path, neighborId];
      if (toIds.has(neighborId)) {
        let momentum = 0;
        for (let i = 1; i < newPath.length; i++) {
          momentum += zoneMap.get(newPath[i])?.momentumCost ?? 0;
        }
        return {
          zoneCount: dist + 1,
          rangeBand: rangeBandFor(dist + 1),
          momentumCost: momentum,
          fromZone: zoneMap.get(newPath[0]) ?? null,
          toZone: zoneMap.get(neighborId) ?? null,
          path: newPath,
        };
      }
      queue.push({ id: neighborId, dist: dist + 1, path: newPath });
    }
  }

  return empty; // disconnected
}

/**
 * Token-aware zone distance. Resolves each token's occupied zone set
 * (footprint for multi-zone tokens, center point otherwise) and measures to
 * the nearest occupied zone pair. Contact requires token footprints to touch
 * or overlap; same-zone tokens with any visible gap remain Close.
 *
 * @param {Token|TokenDocument} tokenA
 * @param {Token|TokenDocument} tokenB
 * @param {object[]} [zones=getSceneZones()]
 * @returns same shape as getZoneDistance
 */
export function getZoneDistanceBetweenTokens(tokenA, tokenB, zones = getSceneZones()) {
  const fromZones = getZonesForToken(tokenA, zones);
  const toZones   = getZonesForToken(tokenB, zones);

  const fa = tokenFootprint(tokenA);
  const fb = tokenFootprint(tokenB);
  const contact = _rectsTouchOrOverlap(fa, fb);

  return getZoneDistanceForZoneSets(fromZones, toZones, zones, { contact });
}

/**
 * Like getZoneDistance but returns the full BFS path with per-step details:
 * zone names, per-step momentum costs, and cumulative totals.
 * Used by the drag ruler to show a breakdown as the user drags.
 *
 * @param {{x:number,y:number}} pointA
 * @param {{x:number,y:number}} pointB
 * @param {object[]} zones
 * @returns {{
 *   zoneCount: number,
 *   rangeBand: string,
 *   momentumCost: number,
 *   fromZone: object|null,
 *   toZone: object|null,
 *   path: string[],
 *   steps: Array<{ zoneId: string, zoneName: string, momentumCost: number, cumulativeMomentum: number, color: string }>
 * }}
 */
export function getZonePathWithCosts(pointA, pointB, zones) {
  const base = getZoneDistance(pointA, pointB, zones);
  if (!base.fromZone || !base.toZone || base.zoneCount < 0) return base;
  return { ...base, steps: _buildPathSteps(base.path, zones) };
}

/** Build per-step breakdown rows from a zone-id path. */
function _buildPathSteps(path, zones) {
  const zoneMap = new Map(zones.map(z => [z.id, z]));
  let cumulative = 0;
  return (path ?? []).map((id, index) => {
    const zone = zoneMap.get(id);
    const stepCost = index === 0 ? 0 : (zone?.momentumCost ?? 0);
    cumulative += stepCost;
    return {
      zoneId: id,
      zoneName: zone?.name ?? "(unnamed)",
      momentumCost: stepCost,
      cumulativeMomentum: cumulative,
      color: zone?.color ?? "#ffffff",
    };
  });
}

/**
 * Measurement-aware zone distance between two canvas points.
 * If either point sits on a token flagged `multiZone`, that endpoint uses the
 * token's full occupied zone set (nearest-zone semantics), so ruler
 * measurements match weapon range checks against huge ships. Points not on a
 * multi-zone token behave exactly like getZonePathWithCosts.
 *
 * @param {{x:number,y:number}} pointA
 * @param {{x:number,y:number}} pointB
 * @param {object[]} zones
 * @param {{exclude?: Token|TokenDocument|null}} [opts]  token to ignore when
 *        detecting multi-zone tokens under the endpoints (e.g. a dragged
 *        token, whose own movement stays center-based)
 * @returns same shape as getZonePathWithCosts (includes steps)
 */
export function getZoneMeasurement(pointA, pointB, zones, { exclude = null } = {}) {
  const tokA = getMultiZoneTokenAtPoint(pointA.x, pointA.y, { exclude });
  const tokB = getMultiZoneTokenAtPoint(pointB.x, pointB.y, { exclude });

  // Neither endpoint on a multi-zone token → identical to the classic path
  if (!tokA && !tokB) return getZonePathWithCosts(pointA, pointB, zones);

  const pointZones = (pt) => {
    const z = getZoneAtPoint(pt.x, pt.y, zones);
    return z ? [z] : [];
  };
  const fromZones = tokA ? getZonesForToken(tokA, zones) : pointZones(pointA);
  const toZones   = tokB ? getZonesForToken(tokB, zones) : pointZones(pointB);

  // Contact check: footprints must touch or overlap (points = zero-size rects)
  const ra = tokA ? tokenFootprint(tokA) : { x: pointA.x, y: pointA.y, w: 0, h: 0 };
  const rb = tokB ? tokenFootprint(tokB) : { x: pointB.x, y: pointB.y, w: 0, h: 0 };
  const contact = _rectsTouchOrOverlap(ra, rb);

  const base = getZoneDistanceForZoneSets(fromZones, toZones, zones, { contact });
  if (!base.fromZone || !base.toZone || base.zoneCount < 0) return base;
  return { ...base, steps: _buildPathSteps(base.path, zones) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Square grid generation helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a grid of square cell positions covering a rectangular area.
 * @param {number} originX   top-left x of the area
 * @param {number} originY   top-left y of the area
 * @param {number} width     area width in pixels
 * @param {number} height    area height in pixels
 * @param {number} cellSize  size of each square cell in pixels
 * @returns {{cx:number, cy:number, col:number, row:number, vertices: {x:number,y:number}[]}[]}
 */
export function generateSquareGrid(originX, originY, width, height, cellSize) {
  const results = [];
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const x0 = originX + col * cellSize;
      const y0 = originY + row * cellSize;
      const cx = x0 + cellSize / 2;
      const cy = y0 + cellSize / 2;
      const vertices = [
        { x: x0,            y: y0 },
        { x: x0 + cellSize, y: y0 },
        { x: x0 + cellSize, y: y0 + cellSize },
        { x: x0,            y: y0 + cellSize },
      ];
      results.push({ cx, cy, col, row, vertices });
    }
  }
  return results;
}

/**
 * Generate a default zone name from column/row like "A1", "B3" for square cells.
 */
export function squareCellName(col, row) {
  return hexCellName(col, row); // same "A1" format
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hex generation helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate vertices for a single flat-top hexagon centered at (cx, cy).
 * @param {number} cx  center x
 * @param {number} cy  center y
 * @param {number} size  distance from center to vertex
 * @returns {{x:number, y:number}[]}
 */
export function hexVertices(cx, cy, size) {
  const verts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    verts.push({
      x: Math.round(cx + size * Math.cos(angle)),
      y: Math.round(cy + size * Math.sin(angle)),
    });
  }
  return verts;
}

/**
 * Generate a grid of hex center positions covering a rectangular area.
 * Uses flat-top hex layout (odd-column offset).
 * @param {number} originX   top-left x of the area
 * @param {number} originY   top-left y of the area
 * @param {number} width     area width in pixels
 * @param {number} height    area height in pixels
 * @param {number} hexSize   hex radius (center to vertex)
 * @returns {{cx:number, cy:number, col:number, row:number}[]}
 */
export function generateHexGrid(originX, originY, width, height, hexSize) {
  const results = [];
  // Flat-top hex dimensions
  const hexW    = hexSize * 2;
  const hexH    = Math.sqrt(3) * hexSize;
  const colStep = hexW * 0.75;
  const rowStep = hexH;

  // +2 extra on each side so edge hexes are always generated before the
  // intersection filter removes any that fall fully outside the scene.
  const cols = Math.ceil(width  / colStep) + 2;
  const rows = Math.ceil(height / rowStep) + 2;

  // Start one column/row before the scene origin so edge-covering hexes are
  // included.  Use Math.abs(col) % 2 for the odd-column offset so negative
  // column indices (col = -1) get the correct vertical shift — plain `col % 2`
  // returns -1 for col = -1 in JS, which breaks the comparison.
  for (let col = -1; col < cols; col++) {
    const isOdd = Math.abs(col) % 2 === 1;
    for (let row = -1; row < rows; row++) {
      const cx = originX + col * colStep + hexSize;
      const cy = originY + row * rowStep + hexH / 2 + (isOdd ? hexH / 2 : 0);

      // Include if the hex body intersects the scene rectangle (strict inequality
      // so hexes that only touch an edge with a single vertex are excluded).
      if (cx + hexSize   > originX         &&
          cx - hexSize   < originX + width  &&
          cy + hexH / 2  > originY          &&
          cy - hexH / 2  < originY + height) {
        results.push({ cx, cy, col, row });
      }
    }
  }
  return results;
}

/**
 * Generate a column label (A, B, … Z, AA, AB, …).
 */
function _colLabel(col) {
  let label = "";
  let c = col;
  do {
    label = String.fromCharCode(65 + (c % 26)) + label;
    c = Math.floor(c / 26) - 1;
  } while (c >= 0);
  return label;
}

/**
 * Generate a default zone name from column/row like "A1", "B3".
 */
export function hexCellName(col, row) {
  return `${_colLabel(col)}${row + 1}`;
}

// Neighbor offsets for flat-top odd-q offset (odd columns shifted +y/down).
// Matches the layout produced by generateHexGrid().
const _HEX_NEIGHBORS_EVEN_COL = [[+1, -1], [+1, 0], [0, +1], [-1, 0], [-1, -1], [0, -1]];
const _HEX_NEIGHBORS_ODD_COL  = [[+1,  0], [+1, +1], [0, +1], [-1, +1], [-1,  0], [0, -1]];

/**
 * Return all hex cells within `radius` rings of (centerCol, centerRow), inclusive.
 * radius 0 → 1 cell, radius 1 → 7, radius 2 → 19, radius 3 → 37, etc.
 * Coordinates use the same flat-top odd-q offset scheme as generateHexGrid().
 * @returns {{col:number, row:number}[]}
 */
export function hexRingCells(centerCol, centerRow, radius) {
  const results = [{ col: centerCol, row: centerRow }];
  if (radius <= 0) return results;

  const seen = new Set([`${centerCol},${centerRow}`]);
  let frontier = [{ col: centerCol, row: centerRow }];

  for (let r = 0; r < radius; r++) {
    const next = [];
    for (const cell of frontier) {
      const isOdd = Math.abs(cell.col) % 2 === 1;
      const offsets = isOdd ? _HEX_NEIGHBORS_ODD_COL : _HEX_NEIGHBORS_EVEN_COL;
      for (const [dc, dr] of offsets) {
        const nc = cell.col + dc;
        const nr = cell.row + dr;
        const key = `${nc},${nr}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ col: nc, row: nr });
        results.push({ col: nc, row: nr });
      }
    }
    frontier = next;
  }
  return results;
}

function _edgeKey(a, b) {
  const ak = `${a.x},${a.y}`;
  const bk = `${b.x},${b.y}`;
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

/**
 * Generic edge-union outline: given an array of per-cell vertex lists (each a
 * closed polygon in order), drop edges shared by two cells and walk the
 * remaining edges into a single closed loop. Vertices are rounded to integers
 * so floating-point shared endpoints (e.g. from canvas.grid.getVertices) still
 * match up.
 * @param {{x:number, y:number}[][]} cellVerts
 * @returns {{x:number, y:number}[]}
 */
export function polygonUnionOutline(cellVerts) {
  const round = (p) => ({ x: Math.round(p.x), y: Math.round(p.y) });
  const edgeMap = new Map();
  for (const rawVerts of cellVerts) {
    const verts = rawVerts.map(round);
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % n];
      const k = _edgeKey(a, b);
      const existing = edgeMap.get(k);
      if (existing) existing.count++;
      else edgeMap.set(k, { count: 1, a, b });
    }
  }

  const outerEdges = [];
  for (const e of edgeMap.values()) if (e.count === 1) outerEdges.push({ a: e.a, b: e.b });
  if (outerEdges.length === 0) return [];

  const vKey = (p) => `${p.x},${p.y}`;
  const adj = new Map();
  for (const e of outerEdges) {
    const ka = vKey(e.a), kb = vKey(e.b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push(e.b);
    adj.get(kb).push(e.a);
  }

  const polygon = [];
  const used = new Set();
  let current = outerEdges[0].a;
  const startKey = vKey(current);
  while (true) {
    polygon.push({ x: current.x, y: current.y });
    const candidates = adj.get(vKey(current)) || [];
    let next = null;
    for (const c of candidates) {
      const eId = _edgeKey(current, c);
      if (used.has(eId)) continue;
      used.add(eId);
      next = c;
      break;
    }
    if (!next) break;
    current = next;
    if (vKey(current) === startKey) break;
    if (polygon.length > outerEdges.length + 1) break;
  }
  return polygon;
}

/**
 * Compute the outer boundary polygon of a cluster of hexes by edge-union.
 * Hexes are positioned relative to a known center cell so callers don't need
 * scene origin: pass the (centerCol, centerRow) cell and its absolute (cx, cy).
 *
 * @param {{col:number, row:number}[]} cells   cluster cells
 * @param {number} centerCol  reference cell column
 * @param {number} centerRow  reference cell row
 * @param {number} centerCx   reference cell absolute center x
 * @param {number} centerCy   reference cell absolute center y
 * @param {number} hexSize    hex radius (center to vertex)
 * @returns {{x:number, y:number}[]}
 */
export function clusterOutline(cells, centerCol, centerRow, centerCx, centerCy, hexSize) {
  const hexW    = hexSize * 2;
  const hexH    = Math.sqrt(3) * hexSize;
  const colStep = hexW * 0.75;
  const rowStep = hexH;
  const centerIsOdd = Math.abs(centerCol) % 2 === 1;

  // 1) per-cell vertices, positioned relative to the known center cell.
  const cellVerts = cells.map(({ col, row }) => {
    const isOdd = Math.abs(col) % 2 === 1;
    const dx = (col - centerCol) * colStep;
    const dy = (row - centerRow) * rowStep + (isOdd ? hexH / 2 : 0) - (centerIsOdd ? hexH / 2 : 0);
    return hexVertices(centerCx + dx, centerCy + dy, hexSize);
  });

  // 2) tally edges; shared edges (count 2) are internal to the cluster.
  const edgeMap = new Map();
  for (const verts of cellVerts) {
    for (let i = 0; i < 6; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % 6];
      const k = _edgeKey(a, b);
      const existing = edgeMap.get(k);
      if (existing) existing.count++;
      else edgeMap.set(k, { count: 1, a, b });
    }
  }

  // 3) collect outer edges and build a vertex → edges adjacency map.
  const outerEdges = [];
  for (const e of edgeMap.values()) if (e.count === 1) outerEdges.push({ a: e.a, b: e.b });
  if (outerEdges.length === 0) return [];

  const vKey = (p) => `${p.x},${p.y}`;
  const adj = new Map();
  for (const e of outerEdges) {
    const ka = vKey(e.a), kb = vKey(e.b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push(e.b);
    adj.get(kb).push(e.a);
  }

  // 4) walk the loop starting from any outer-edge endpoint.
  const polygon = [];
  const usedEdges = new Set();
  let current = outerEdges[0].a;
  const startKey = vKey(current);

  while (true) {
    polygon.push({ x: current.x, y: current.y });
    const curKey = vKey(current);
    const candidates = adj.get(curKey) || [];
    let next = null;
    for (const c of candidates) {
      const eId = _edgeKey(current, c);
      if (usedEdges.has(eId)) continue;
      usedEdges.add(eId);
      next = c;
      break;
    }
    if (!next) break;
    current = next;
    if (vKey(current) === startKey) break;
    if (polygon.length > outerEdges.length + 1) break; // safety
  }
  return polygon;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Emit socket event so all clients refresh their zone overlay. */
function _broadcastZonesUpdated() {
  game.socket?.emit("module.sta2e-toolkit", { action: "zonesUpdated" });
}

