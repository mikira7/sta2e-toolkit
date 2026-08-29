/**
 * sta2e-toolkit | spawn-regions.js
 *
 * Foundry Regions as spawn destinations for the spawn window.
 *
 * The use case this exists for is a transporter room: draw a Region over the six
 * pads, pick it in the Transporter tab, and the landing party materialises one
 * body per pad instead of wherever the GM happened to click. Ships use the same
 * machinery for hangar decks and arrival volumes.
 *
 * The module has never touched the Region API before, so every access here is
 * guarded and falls back a level rather than throwing — a scene with no regions,
 * a region whose placeable has not been drawn yet, and a gridless scene all have
 * to degrade quietly, because the dialog calls into this on every render.
 *
 * Geometry reuses zone-data.js rather than reimplementing it: the zone system
 * has been doing point-in-polygon and centroids on scene-flag polygons for a
 * long time and those are the tested versions.
 */

import { pointInPolygon, polygonArea, polygonCentroid } from "./zone-data.js";
import { PAD_FLAG, GROUP_FLAG } from "./region-pad-config.js";

const FLAG_SCOPE = "sta2e-toolkit";

/** What a blank Pad Group is called in the picker. */
const DEFAULT_PAD_GROUP_LABEL = "Transporter Pads";

/**
 * Natural sort, so "Pad 2" comes before "Pad 10" — the naming a GM actually
 * uses on a six-pad transporter room.
 */
const byNaturalName = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/**
 * How far inside its own footprint a token's corners are tested. A token that
 * exactly fills its pad would otherwise be rejected by boundary rounding, while
 * a straight centre-only test would let a 2x2 ship hang half off the deck.
 */
const FIT_INSET = 0.75;

/** Sample budget for scattering the overflow — plenty for any real region. */
const JITTER_TRIES = 200;

// ── Enumeration ───────────────────────────────────────────────────────────────

/**
 * Regions on the active scene, as `{ id, name }`, sorted by name.
 * Empty whenever the scene has none — the dialog disables its picker on that.
 */
export function listSceneRegions() {
  try {
    const regions = canvas?.scene?.regions;
    if (!regions?.size) return [];
    return [...regions]
      .map(r => ({ id: r.id, name: r.name || "Unnamed Region" }))
      .sort((a, b) => byNaturalName(a.name, b.name));
  } catch (err) {
    console.warn("STA2e Toolkit | spawn-regions: could not list regions:", err);
    return [];
  }
}

/** RegionDocument by id on the active scene, or null. */
export function getSceneRegion(regionId) {
  try { return canvas?.scene?.regions?.get(regionId) ?? null; }
  catch { return null; }
}

// ── Pad markers ───────────────────────────────────────────────────────────────
//
// A pad marker is a Region flagged in its own config (see region-pad-config.js)
// as one spawn spot rather than an area to fill. Six of them on a transporter
// room's six pads means a landing party materialises where the map art says it
// should, instead of on whichever grid squares happen to be nearby.

function _padFlag(region, key) {
  try { return region?.getFlag?.(FLAG_SCOPE, key); }
  catch { return undefined; }
}

/** Every pad-flagged Region on the scene, unordered. */
function _allPadRegions() {
  try {
    const regions = canvas?.scene?.regions;
    if (!regions?.size) return [];
    return [...regions].filter(r => !!_padFlag(r, PAD_FLAG));
  } catch (err) {
    console.warn("STA2e Toolkit | spawn-regions: could not read pad markers:", err);
    return [];
  }
}

/** A marker's group key — trimmed, blank meaning the scene's default set. */
function _groupKey(region) {
  return String(_padFlag(region, GROUP_FLAG) ?? "").trim();
}

export function padGroupLabel(groupKey) {
  return groupKey || DEFAULT_PAD_GROUP_LABEL;
}

/**
 * Pad sets on this scene, as `{ key, label, count }`.
 * The default (blank-group) set sorts first; the rest by name.
 */
export function listPadGroups() {
  const counts = new Map();
  for (const region of _allPadRegions()) {
    const key = _groupKey(region);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: padGroupLabel(key), count }))
    .sort((a, b) => (a.key === "" ? -1 : b.key === "" ? 1 : byNaturalName(a.label, b.label)));
}

/**
 * One pad set, in the order its markers should be used.
 *
 * Named markers sort naturally, so "Pad 1".."Pad 10" come out the way a GM
 * numbered them; anything left unnamed goes on the end in scene order rather
 * than sorting under a blank name.
 */
export function getPadRegions(groupKey) {
  const key  = String(groupKey ?? "").trim();
  const pads = _allPadRegions().filter(r => _groupKey(r) === key);
  const named   = pads.filter(r => String(r.name ?? "").trim());
  const unnamed = pads.filter(r => !String(r.name ?? "").trim());
  named.sort((a, b) => byNaturalName(a.name, b.name));
  return [...named, ...unnamed];
}

/**
 * Centre points for a queue, one token per pad marker, in queue order.
 *
 * Deliberately all-or-nothing: a transporter with four pads cannot rematerialise
 * six patterns, and quietly stacking the extras somewhere is worse than telling
 * the GM to fix the queue. `centres` is null whenever the set cannot seat
 * everyone, with the counts alongside so the caller can say so precisely.
 *
 * @param {string} groupKey
 * @param {Array} slots  One entry per token to place — only the length is read
 * @returns {{centres: {x,y}[]|null, padCount: number, label: string}}
 */
export function padCentresForSlots(groupKey, slots) {
  const pads  = getPadRegions(groupKey);
  const label = padGroupLabel(groupKey);
  const need  = slots?.length ?? 0;

  if (!pads.length || pads.length < need) {
    return { centres: null, padCount: pads.length, label };
  }
  return { centres: pads.slice(0, need).map(regionCentre), padCount: pads.length, label };
}

// ── Spawn Location picker ─────────────────────────────────────────────────────

const _escAttr = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

/**
 * `<option>` markup for the Spawn Location control, shared by both tabs of the
 * spawn window so the two pickers cannot drift apart.
 *
 * Three kinds of value: `canvas`, `pads:<groupKey>` (one token per marker) and
 * `region:<id>` (fill a region's grid spaces). Pad markers are left out of the
 * fill list — they are one cell each, so filling one is never what was meant.
 */
export function buildLocationOptions(selected) {
  const opt = (value, text) =>
    `<option value="${_escAttr(value)}" ${selected === value ? "selected" : ""}>${_escAttr(text)}</option>`;

  const groups  = listPadGroups();
  const padIds  = new Set(_allPadRegions().map(r => r.id));
  const regions = listSceneRegions().filter(r => !padIds.has(r.id));

  const opts = [`<option value="canvas">Canvas Click</option>`];
  for (const g of groups) {
    opts.push(opt(`pads:${g.key}`, `${g.label} — ${g.count} marker${g.count === 1 ? "" : "s"}`));
  }
  for (const r of regions) {
    opts.push(opt(`region:${r.id}`, `Fill Region — ${r.name}`));
  }
  if (!groups.length && !regions.length) {
    opts.push(`<option value="" disabled>— no Regions on this scene —</option>`);
  }
  return opts.join("");
}

/** Split a Spawn Location value into something worth branching on. */
export function parseLocation(location) {
  const value = String(location ?? "canvas");
  if (value.startsWith("pads:"))   return { kind: "pads",   key: value.slice(5) };
  if (value.startsWith("region:")) return { kind: "region", id:  value.slice(7) };
  return { kind: "canvas" };
}

// ── Geometry ──────────────────────────────────────────────────────────────────

/**
 * The region's outline as arrays of `{x, y}` vertices.
 *
 * `region.object.polygons` is the drawn, already-clipped shape set, so a region
 * built from several overlapping shapes comes back as the union Foundry actually
 * renders. Returns an empty array when the placeable is not on the canvas.
 */
export function regionPolygons(region) {
  try {
    const polys = region?.object?.polygons;
    if (!Array.isArray(polys)) return [];
    return polys.map(poly => {
      // PIXI.Polygon carries a flat [x, y, x, y, …] points array.
      const pts = poly?.points ?? poly;
      if (!Array.isArray(pts)) return [];
      const verts = [];
      for (let i = 0; i + 1 < pts.length; i += 2) verts.push({ x: pts[i], y: pts[i + 1] });
      return verts;
    // A shape whose coordinates are not plain numbers means this Foundry build
    // stores its outlines some other way — drop it so the caller falls through
    // to testPoint rather than testing against nonsense.
    }).filter(v => v.length >= 3 && Number.isFinite(v[0].x) && Number.isFinite(v[0].y));
  } catch (err) {
    console.warn("STA2e Toolkit | spawn-regions: could not read region polygons:", err);
    return [];
  }
}

/** The region's bounding box, from the placeable or from the polygons. */
export function regionBounds(region) {
  const b = region?.object?.bounds;
  if (b && Number.isFinite(b.x) && Number.isFinite(b.width) && b.width > 0) {
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  const polys = regionPolygons(region);
  if (!polys.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const verts of polys) for (const v of verts) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Is this canvas point inside the region?
 *
 * Even-odd across the polygon set, so a doughnut-shaped region (a shape with a
 * subtracted hole) correctly excludes its hole.
 */
export function regionContainsPoint(region, { x, y }) {
  const polys = regionPolygons(region);
  if (polys.length) {
    let crossings = 0;
    for (const verts of polys) if (pointInPolygon(x, y, verts)) crossings++;
    return crossings % 2 === 1;
  }

  // Placeable not drawn — fall back to the document's own test, then bounds.
  try {
    const elevation = region?.elevation?.bottom ?? 0;
    if (typeof region?.object?.testPoint === "function") {
      return !!region.object.testPoint({ x, y, elevation });
    }
  } catch { /* signature differs across Foundry builds — fall through */ }

  const b = regionBounds(region);
  if (!b) return false;
  return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
}

/** The point to anchor a formation or an aim arrow on. */
export function regionCentre(region) {
  const polys = regionPolygons(region);
  if (polys.length) {
    // Largest polygon by area — a region with a small satellite shape should
    // still anchor on its main body.
    const biggest = polys.reduce((best, verts) =>
      Math.abs(polygonArea(verts)) > Math.abs(polygonArea(best)) ? verts : best);
    const c = polygonCentroid(biggest);
    // A concave region's centroid can fall in the notch; nudge to the nearest
    // interior sample rather than anchoring outside the region.
    if (regionContainsPoint(region, c)) return c;
  }
  const b = regionBounds(region);
  if (!b) return { x: 0, y: 0 };
  const mid = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  if (regionContainsPoint(region, mid)) return mid;
  return jitterPointsInRegion(region, 1, { minSeparation: 0 })[0] ?? mid;
}

// ── Pad slots ─────────────────────────────────────────────────────────────────

/** Does a token of this footprint, centred here, sit wholly inside the region? */
function footprintFits(region, centre, halfW, halfH) {
  if (!regionContainsPoint(region, centre)) return false;
  const dx = halfW * FIT_INSET;
  const dy = halfH * FIT_INSET;
  if (dx < 1 && dy < 1) return true;
  return [[-dx, -dy], [dx, -dy], [-dx, dy], [dx, dy]]
    .every(([ox, oy]) => regionContainsPoint(region, { x: centre.x + ox, y: centre.y + oy }));
}

/** Every grid-cell centre whose cell overlaps the region's bounding box. */
function candidateCentres(bounds) {
  const grid = canvas?.grid;
  const size = grid?.size ?? 100;
  const out  = [];

  // Gridless scenes have no cells to land on, so lay a lattice of one grid unit
  // and let the fit test carve the region out of it.
  const gridless = !grid || grid.type === 0 || grid.isGridless;
  if (gridless || typeof grid.getOffset !== "function" || typeof grid.getCenterPoint !== "function") {
    for (let y = bounds.y + size / 2; y <= bounds.y + bounds.height; y += size) {
      for (let x = bounds.x + size / 2; x <= bounds.x + bounds.width; x += size) {
        out.push({ x, y });
      }
    }
    return out;
  }

  // Same enumeration the zone editor uses to stamp hexes: corner offsets, then
  // one pass over the i/j range with a margin so edge cells are not missed.
  const tl = grid.getOffset({ x: bounds.x,                 y: bounds.y });
  const br = grid.getOffset({ x: bounds.x + bounds.width,  y: bounds.y + bounds.height });
  const iMin = Math.min(tl.i, br.i) - 1, iMax = Math.max(tl.i, br.i) + 1;
  const jMin = Math.min(tl.j, br.j) - 1, jMax = Math.max(tl.j, br.j) + 1;
  for (let i = iMin; i <= iMax; i++) {
    for (let j = jMin; j <= jMax; j++) {
      out.push(grid.getCenterPoint({ i, j }));
    }
  }
  return out;
}

/**
 * Pad slots inside a region — one per grid space, filled from the middle out.
 *
 * Ordering matters more than it looks: a six-pad transporter room fills from the
 * centre pads outward, which is what reads as "the party materialised on the
 * pads" rather than "the party materialised in the corner".
 *
 * @param {RegionDocument} region
 * @param {object} opts
 * @param {number} opts.count           How many slots are wanted
 * @param {number} [opts.halfW]         Half token width in pixels
 * @param {number} [opts.halfH]         Half token height in pixels
 * @param {{x,y}[]} [opts.exclude]      Already-claimed centres to keep clear of
 * @returns {{x:number, y:number}[]}    May be SHORTER than `count` — the caller
 *   decides whether that is a warning, an abort, or a scatter of the remainder.
 */
export function regionPadSlots(region, { count, halfW = 0, halfH = 0, exclude = [] } = {}) {
  if (!region || !(count > 0)) return [];
  const bounds = regionBounds(region);
  if (!bounds) return [];

  const centre = regionCentre(region);
  const minSep = Math.max(Math.max(halfW, halfH) * 1.5, (canvas?.grid?.size ?? 100) * 0.5);

  const slots = candidateCentres(bounds)
    .filter(p => footprintFits(region, p, halfW, halfH))
    .filter(p => !exclude.some(e => Math.hypot(e.x - p.x, e.y - p.y) < minSep))
    .sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y));

  return slots.slice(0, count);
}

/**
 * Random points inside the region, separated where it can manage it.
 *
 * Used for the overflow when more tokens are queued than the region has pads —
 * better to crowd the last few in than to abort a half-assembled beam-in.
 */
export function jitterPointsInRegion(region, count, { minSeparation = 0, exclude = [] } = {}) {
  const bounds = regionBounds(region);
  if (!bounds || !(count > 0)) return [];
  const placed = [];
  for (let n = 0; n < count; n++) {
    let best = null;
    for (let attempt = 0; attempt < JITTER_TRIES; attempt++) {
      const p = {
        x: bounds.x + Math.random() * bounds.width,
        y: bounds.y + Math.random() * bounds.height,
      };
      if (!regionContainsPoint(region, p)) continue;
      best ??= p;   // keep the first interior hit in case separation never clears
      const clear = [...exclude, ...placed]
        .every(e => Math.hypot(e.x - p.x, e.y - p.y) >= minSeparation);
      if (clear) { best = p; break; }
    }
    placed.push(best ?? regionCentre(region));
  }
  return placed;
}

/**
 * Slots for a whole queue at once: pads first, jittered remainder after.
 *
 * @param {RegionDocument} region
 * @param {{halfW:number, halfH:number}[]} slots  One entry per token to place
 * @returns {{centres: {x,y}[], overflow: number}}
 */
export function regionCentresForSlots(region, slots) {
  const centres = [];
  let overflow = 0;
  const grid = canvas?.grid?.size ?? 100;

  // Fitting a footprint against the region is the expensive part, so the pad
  // list is resolved once per distinct footprint rather than once per token —
  // a fleet of eight identical shuttles walks the region geometry once.
  const padsByFootprint = new Map();
  const padsFor = (halfW, halfH) => {
    const key = `${halfW}x${halfH}`;
    if (!padsByFootprint.has(key)) {
      padsByFootprint.set(key, regionPadSlots(region, { count: slots.length, halfW, halfH }));
    }
    return padsByFootprint.get(key);
  };

  for (const slot of slots) {
    const halfW = slot.halfW ?? grid / 2;
    const halfH = slot.halfH ?? grid / 2;
    const minSep = Math.max(Math.max(halfW, halfH) * 1.5, grid * 0.5);

    const pad = padsFor(halfW, halfH)
      .find(p => !centres.some(c => Math.hypot(c.x - p.x, c.y - p.y) < minSep));
    if (pad) { centres.push(pad); continue; }

    overflow++;
    const [spare] = jitterPointsInRegion(region, 1, {
      minSeparation: Math.max(halfW, halfH) * 1.2,
      exclude: centres,
    });
    centres.push(spare ?? regionCentre(region));
  }
  return { centres, overflow };
}
