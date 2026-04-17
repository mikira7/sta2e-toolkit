/**
 * sta2e-toolkit | zone-data.js
 * Zone data storage (scene flags), geometry utilities, adjacency graph,
 * and BFS zone-distance calculation for the STA 2e zone movement system.
 */

const FLAG_SCOPE = "sta2e-toolkit";
const FLAG_KEY   = "zones";

// ── Range band mapping ──────────────────────────────────────────────────────
// Contact  — tokens are physically adjacent (base-to-base, ≤ 1 grid unit apart)
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
    // Contact if tokens are physically adjacent (≤ 1 grid unit apart, base-to-base)
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    const gridSize  = canvas?.scene?.grid?.size ?? 100;
    const rangeBand = pixelDist <= gridSize ? "Contact" : "Close";
    return {
      zoneCount: 0, rangeBand, momentumCost: 0,
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

  const zoneMap = new Map(zones.map(z => [z.id, z]));
  let cumulative = 0;
  const steps = base.path.map((id, index) => {
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

  return { ...base, steps };
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

// ═══════════════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Emit socket event so all clients refresh their zone overlay. */
function _broadcastZonesUpdated() {
  game.socket?.emit("module.sta2e-toolkit", { action: "zonesUpdated" });
}

