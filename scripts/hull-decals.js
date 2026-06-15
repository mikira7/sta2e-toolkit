/**
 * sta2e-toolkit | hull-decals.js
 *
 * Persistent hull-damage scorch decals for starship tokens.
 *
 * A weapons hit that penetrates shields stamps a scorch mark onto the target
 * hull at the point of impact. The mark is stored as a token flag in the
 * token's LOCAL frame, so it stays welded to the same spot on the ship through
 * rotation, movement, and resize — unlike a screen-space Token Magic filter.
 *
 * Design notes:
 *  - Stamps are written once by the active GM; the flag sync re-renders the
 *    decal on every client (see registerHullDecals / updateToken hook).
 *  - Decals render as PIXI sprites in a per-token container on canvas.tokens,
 *    re-synced on refreshToken (see foundry-vfx skill: canvas.tokens is the
 *    correct layer, sync world position rather than parenting to token.mesh,
 *    which Foundry rebuilds).
 *  - Art is human-made and lives in assets/decals. Severity tiers map to
 *    separate PNG files; a missing tier falls back to the medium scorch.
 */

import { getTokenAlphaMask } from "./ship-vfx-anchors.js";

const MODULE = "sta2e-toolkit";
const FLAG = "hullDecals";

// Cap so a long battle can't bloat a token flag without bound.
const MAX_DECALS = 14;

// Decal art directory (Foundry-relative path, served from the module folder).
const DECAL_DIR = `modules/${MODULE}/assets/decals`;

/**
 * Severity tiers. `file` is the human-drawn PNG; `size` is the decal's target
 * diameter as a fraction of the token's smaller dimension, so the same art
 * reads correctly on a shuttle and on a capital ship.
 *
 * NOTE: light/heavy filenames are placeholders for hand-drawn art. Until those
 * exist, _loadDecalTexture falls back to the medium scorch.
 */
// `size` is the decal diameter as a fraction of the ship's drawn extent (its
// silhouette bounding box), so marks scale with the visible ship image.
const TIERS = Object.freeze({
  light:  { file: `${DECAL_DIR}/scorch-mark-light.png`,  size: 0.16 },
  medium: { file: `${DECAL_DIR}/scorch-mark-medium.png`, size: 0.22 },
  heavy:  { file: `${DECAL_DIR}/scorch-mark-heavy.png`,  size: 0.32 },
});

// Damage thresholds for tier selection. Hull impacts only happen once shields
// are down, so these are penetrating hits. Tune to taste.
const SEVERITY_THRESHOLDS = Object.freeze({ heavy: 10, medium: 5 });

// tokenId -> PIXI.Container holding that token's decal sprites.
const _containers = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _enabled() {
  try { return game.settings.get(MODULE, "hullDamageStyle") === "decal"; }
  catch { return true; }
}

// Global size multiplier (world setting) so decals can be tuned without code.
function _scaleMult() {
  try {
    const v = Number(game.settings.get(MODULE, "hullDecalScale"));
    return Number.isFinite(v) && v > 0 ? v : 1;
  } catch { return 1; }
}

// Growth exponent: how strongly decals scale up with ship size. 1 = linear
// (same fraction on every ship); higher grows big ships' marks proportionally.
function _growthExp() {
  try {
    const v = Number(game.settings.get(MODULE, "hullDecalGrowth"));
    return Number.isFinite(v) && v > 0 ? v : 1.35;
  } catch { return 1.35; }
}

// Size metric used to grow decals: the token IMAGE size, measured as the
// token's smaller side in grid squares. Decals are sized off how big the token
// is on the canvas, so a larger token gets a larger scorch. Bigger ships get
// bigger marks simply by giving them bigger tokens.
function _sizeMetric(token) {
  const gridSize = canvas?.grid?.size || canvas?.dimensions?.size || 100;
  const minDim = Math.min(token?.w || 1, token?.h || 1);
  return Math.max(0.5, minDim / gridSize);
}

/** Only the active GM performs the single authoritative flag write. */
function _isWriter() {
  if (!game.user?.isGM) return false;
  const activeGM = game.users?.activeGM;
  return !activeGM || activeGM === game.user;
}

function _isTokenDocument(doc) {
  return doc?.documentName === "Token" || doc?.constructor?.name === "TokenDocument";
}

function _isActorDocument(doc) {
  return doc?.documentName === "Actor" || doc?.constructor?.name === "Actor";
}

function _tokenDocFor(target) {
  const obj = target?.object ?? target;
  if (obj?.document && _isTokenDocument(obj.document)) return obj.document;
  if (_isTokenDocument(obj)) return obj;
  if (target?.token && _isTokenDocument(target.token)) return target.token;
  return null;
}

function _actorFor(target, tokenDoc = null) {
  const obj = target?.object ?? target;
  if (_isActorDocument(obj)) return obj;
  return obj?.actor ?? tokenDoc?.actor ?? null;
}

function _worldActorFor(actor, tokenDoc = null) {
  const actorId = tokenDoc?.actorId ?? actor?.id ?? actor?._id;
  if (actorId) {
    const world = game.actors?.get(actorId);
    if (world) return world;
  }
  return actor?.isToken ? null : actor;
}

function _isUnlinkedTokenActor(actor) {
  return actor?.isToken && actor?.token && actor.token.isLinked === false;
}

function _isUnlinkedTokenDoc(tokenDoc, actor = null) {
  if (!tokenDoc) return false;
  if (_isUnlinkedTokenActor(actor)) return true;
  if (tokenDoc.actorLink === false || tokenDoc.isLinked === false) return true;
  return false;
}

function _storageFor(target) {
  const tokenDoc = _tokenDocFor(target);
  const actor = _actorFor(target, tokenDoc);

  if (tokenDoc && _isUnlinkedTokenDoc(tokenDoc, actor)) {
    return { doc: tokenDoc, linked: false, legacyDoc: null };
  }

  if (tokenDoc) {
    const actorDoc = _worldActorFor(actor, tokenDoc);
    if (actorDoc?.setFlag || actorDoc?.getFlag) {
      return { doc: actorDoc, linked: true, legacyDoc: tokenDoc };
    }
    return { doc: tokenDoc, linked: false, legacyDoc: null };
  }

  if (actor) {
    if (_isUnlinkedTokenActor(actor)) {
      return { doc: actor.token, linked: false, legacyDoc: null };
    }
    const actorDoc = _worldActorFor(actor);
    if (actorDoc?.setFlag || actorDoc?.getFlag) {
      return { doc: actorDoc, linked: true, legacyDoc: actor.token ?? null };
    }
  }

  return null;
}

function _normalizeDecalList(value) {
  return Array.isArray(value) ? value : [];
}

function _decalListForSync(target) {
  const store = _storageFor(target);
  if (!store?.doc?.getFlag) return [];
  const primary = _normalizeDecalList(store.doc.getFlag(MODULE, FLAG));
  if (primary.length) return primary;
  return store.linked && store.legacyDoc?.getFlag
    ? _normalizeDecalList(store.legacyDoc.getFlag(MODULE, FLAG))
    : [];
}

async function _decalListFor(target, { migrate = false } = {}) {
  const store = _storageFor(target);
  if (!store?.doc?.getFlag) return [];

  const primary = _normalizeDecalList(store.doc.getFlag(MODULE, FLAG));
  if (primary.length) return primary;

  const legacy = store.linked && store.legacyDoc?.getFlag
    ? _normalizeDecalList(store.legacyDoc.getFlag(MODULE, FLAG))
    : [];
  if (!legacy.length) return [];

  if (migrate && _isWriter() && store.doc?.setFlag) {
    try {
      await store.doc.setFlag(MODULE, FLAG, legacy);
      await store.legacyDoc?.unsetFlag?.(MODULE, FLAG);
    } catch (err) {
      console.warn("STA2e Toolkit | Hull decal migration failed:", err);
    }
  }
  return legacy;
}

function _toRadians(deg) {
  return (typeof Math.toRadians === "function")
    ? Math.toRadians(deg)
    : (Number(deg) || 0) * Math.PI / 180;
}

function _severityFor(finalDamage) {
  const d = Math.max(0, Number(finalDamage) || 0);
  if (d >= SEVERITY_THRESHOLDS.heavy) return "heavy";
  if (d >= SEVERITY_THRESHOLDS.medium) return "medium";
  return "light";
}

/** Live, animated rotation of the token (radians). */
function _tokenRotation(token) {
  const live = token?.mesh?.rotation;
  if (typeof live === "number") return live;
  return _toRadians(token?.document?.rotation ?? 0);
}

const _textureCache = new Map();

async function _loadDecalTexture(path) {
  if (_textureCache.has(path)) return _textureCache.get(path);
  let tex = null;
  try {
    if (foundry?.canvas?.loadTexture) tex = await foundry.canvas.loadTexture(path);
    else if (typeof loadTexture === "function") tex = await loadTexture(path);
  } catch { tex = null; }
  if (!tex && globalThis.PIXI?.Assets?.load) {
    try { tex = await PIXI.Assets.load(path); } catch { tex = null; }
  }
  _textureCache.set(path, tex || null);
  return tex || null;
}

async function _tierTexture(sev) {
  const tier = TIERS[sev] ?? TIERS.medium;
  let tex = await _loadDecalTexture(tier.file);
  if (!tex && tier !== TIERS.medium) tex = await _loadDecalTexture(TIERS.medium.file);
  return tex;
}

// ---------------------------------------------------------------------------
// Stamp (GM write)
// ---------------------------------------------------------------------------

/**
 * Record a scorch decal on a token at a canvas-space impact point.
 * Converts the point into the token's local (unrotated, normalized) frame so
 * it stays pinned through later rotation/move/resize.
 *
 * @param {Token|TokenDocument} targetToken
 * @param {{x:number,y:number}} impactPoint  canvas-space hit location
 * @param {object} options  expects { finalDamage }
 */
export async function stampHullDecal(targetToken, impactPoint, options = {}) {
  if (!_enabled()) return;
  if (!_isWriter()) return;

  const token = targetToken?.object ?? targetToken;
  const store = _storageFor(targetToken);
  if (!token?.center || !store?.doc?.setFlag) return;

  const c = token.center;
  const w = token.w || 1;
  const h = token.h || 1;
  const p = (impactPoint?.x != null && impactPoint?.y != null) ? impactPoint : c;

  // Inverse-rotate the impact vector into the token's texture-local frame.
  const rot = _tokenRotation(token);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const vx = p.x - c.x;
  const vy = p.y - c.y;
  const lx =  vx * cos + vy * sin;
  const ly = -vx * sin + vy * cos;

  // Normalized local coords, clamped just past the silhouette edge. The mark
  // stays at its true impact point; the silhouette mask trims any overhang.
  const nx = Math.max(-0.6, Math.min(0.6, lx / w));
  const ny = Math.max(-0.6, Math.min(0.6, ly / h));

  const decal = {
    nx, ny,
    sev: _severityFor(options.finalDamage),
    rot: Math.random() * Math.PI * 2,   // decorative per-mark spin
  };

  const list = (await _decalListFor(targetToken, { migrate: true })).slice();
  list.push(decal);
  while (list.length > MAX_DECALS) list.shift();

  try { await store.doc.setFlag(MODULE, FLAG, list); }
  catch (err) { console.warn("STA2e Toolkit | Hull decal stamp failed:", err); }
}

export function hasHullDecals(targetToken) {
  return _decalListForSync(targetToken).length > 0;
}

function _destroyLocalContainersForTarget(target) {
  const tokenDoc = _tokenDocFor(target);
  if (tokenDoc?.id) {
    _destroyContainer(tokenDoc.id);
    return;
  }

  const actor = _actorFor(target, tokenDoc);
  if (!actor) return;
  for (const token of canvas?.tokens?.placeables ?? []) {
    if (token.actor === actor || token.document?.actorId === actor.id) {
      _destroyContainer(token.id);
    }
  }
}

/** Remove all decals from a token (e.g. after repairs). GM-only. */
export async function clearHullDecals(targetToken) {
  if (!_isWriter()) return;
  const store = _storageFor(targetToken);
  if (!store?.doc?.unsetFlag) return;
  try {
    await store.doc.unsetFlag(MODULE, FLAG);
    if (store.linked) await store.legacyDoc?.unsetFlag?.(MODULE, FLAG);
    _destroyLocalContainersForTarget(targetToken);
  }
  catch (err) { console.warn("STA2e Toolkit | Hull decal clear failed:", err); }
}

export async function clearTokenLocalHullDecals(tokenDoc) {
  if (!_isWriter()) return;
  if (!tokenDoc?.unsetFlag) return;
  try { await tokenDoc.unsetFlag(MODULE, FLAG); }
  catch (err) { console.warn("STA2e Toolkit | Hull decal token-local clear failed:", err); }
}

// ---------------------------------------------------------------------------
// Render (all clients)
// ---------------------------------------------------------------------------

// Scale a mask sprite the way Foundry fits a token texture into its w×h box,
// so the silhouette mask overlays the displayed ship art exactly.
function _fitScale(fit, w, h, tw, th) {
  switch (fit) {
    case "fill":   return [w / tw, h / th];
    case "cover":  { const s = Math.max(w / tw, h / th); return [s, s]; }
    case "width":  { const s = w / tw; return [s, s]; }
    case "height": { const s = h / th; return [s, s]; }
    case "contain":
    default:       { const s = Math.min(w / tw, h / th); return [s, s]; }
  }
}

function _maskEnabled() {
  try { return game.settings.get(MODULE, "hullDecalMask") === true; }
  catch { return false; }
}

function _removeMask(cont) {
  if (cont._decalLayer) cont._decalLayer.mask = null;
  if (cont._maskGfx) {
    try { cont._maskGfx.destroy(); } catch { /* */ }
    cont._maskGfx = null;
    cont._maskSrc = null;
  }
}

// Fill helpers spanning PIXI v7 (beginFill/drawRect/endFill) and v8
// (rect()/fill()). For a mask only coverage matters, so fill colour is white.
function _gMaskBegin(g) { if (typeof g.beginFill === "function") g.beginFill(0xffffff, 1); }
function _gMaskRect(g, x, y, w, h) {
  if (typeof g.drawRect === "function") g.drawRect(x, y, w, h);  // v7 draws immediately
  else g.rect(x, y, w, h);                                       // v8 accumulates path
}
function _gMaskEnd(g) {
  if (typeof g.endFill === "function") g.endFill();              // v7
  else if (typeof g.fill === "function") g.fill({ color: 0xffffff });  // v8
}

// Build a GEOMETRY mask of the ship silhouette and clip the decal layer to it.
// Unlike a sprite alpha-mask (which PIXI v8 clips to the token rectangle on some
// builds), a Graphics geometry mask reliably clips to the drawn shape, and it
// never modifies the token image. The shape comes from the token's alpha grid
// (the same data the weapon system uses), drawn as run-length rectangles per row
// in grid space; _syncContainer scales/centres it onto the displayed art.
async function _updateMaskAndExtent(token, cont) {
  const layer = cont._decalLayer;
  const src = token?.document?.texture?.src;
  if (!src) { cont._shipFracW = cont._shipFracH = null; _removeMask(cont); return; }

  const grid = await getTokenAlphaMask(src);
  if (!grid?.opaqueSet?.size) { cont._shipFracW = cont._shipFracH = null; _removeMask(cont); return; }

  // Silhouette bounding box → the fraction of the image the hull actually fills.
  // Used to size decals off the real ship art rather than the token frame, so a
  // bigger ship image gets a bigger mark even on an identical token frame.
  if (cont._extentSrc !== src) {
    let minx = grid.width, maxx = -1, miny = grid.height, maxy = -1;
    for (const pt of grid.opaque) {
      if (pt.x < minx) minx = pt.x; if (pt.x > maxx) maxx = pt.x;
      if (pt.y < miny) miny = pt.y; if (pt.y > maxy) maxy = pt.y;
    }
    cont._shipFracW = (maxx - minx + 1) / grid.width;
    cont._shipFracH = (maxy - miny + 1) / grid.height;
    cont._maskGridW = grid.width;
    cont._maskGridH = grid.height;
    cont._extentSrc = src;
  }

  if (!_maskEnabled()) { _removeMask(cont); return; }

  // Geometry mask of the silhouette (reuse when the image hasn't changed).
  if (cont._maskGfx && cont._maskSrc === src) { if (layer) layer.mask = cont._maskGfx; return; }
  let g = cont._maskGfx;
  if (g) g.clear();
  else { g = new PIXI.Graphics(); cont.addChild(g); cont._maskGfx = g; }
  const { width, height, opaqueSet } = grid;
  _gMaskBegin(g);
  for (let y = 0; y < height; y++) {
    let run = -1;
    for (let x = 0; x <= width; x++) {
      const solid = x < width && opaqueSet.has(y * width + x);
      if (solid && run < 0) run = x;
      else if (!solid && run >= 0) { _gMaskRect(g, run, y, x - run, 1); run = -1; }
    }
  }
  _gMaskEnd(g);
  cont._maskSrc = src;
  if (layer) layer.mask = g;
}

function _destroyContainer(tokenId) {
  const cont = _containers.get(tokenId);
  if (cont) {
    try { cont.destroy({ children: true }); } catch { /* */ }
    _containers.delete(tokenId);
  }
}

/** Reposition / rotate / scale an existing container to match the token. */
function _syncContainer(token) {
  const cont = _containers.get(token?.id);
  if (!cont || !token?.center) return;
  const w = token.w || 1;
  const h = token.h || 1;
  const minDim = Math.min(w, h);
  const mult = _scaleMult();

  cont.position.set(token.center.x, token.center.y);
  cont.rotation = _tokenRotation(token);
  cont.visible = token.visible !== false;   // hide with a hidden/unseen token

  // Align the geometry silhouette mask onto the displayed ship art, matching
  // Foundry's texture fit so the mask overlaps the hull exactly.
  const mg = cont._maskGfx;
  if (mg && cont._maskGridW) {
    const gw = cont._maskGridW, gh = cont._maskGridH;
    const fit = token.document?.texture?.fit ?? "contain";
    const [fx, fy] = _fitScale(fit, w, h, gw, gh);
    const ssx = fx * (token.document?.texture?.scaleX ?? 1);
    const ssy = fy * (token.document?.texture?.scaleY ?? 1);
    mg.scale.set(ssx, ssy);
    mg.position.set(-(gw * ssx) / 2, -(gh * ssy) / 2);
    mg.rotation = 0;
  }

  const layer = cont._decalLayer;
  if (layer) {
    layer.position.set(0, 0);
    layer.rotation = 0;
    // Decal size = a fraction of the token, grown with the ship's Scale stat so
    // big ships get proportionally larger marks than small ones. Growth exponent
    // 1 = constant fraction; higher = bigger ships scale up more. Both `mult` and
    // the growth exponent are live settings.
    const growthMult = Math.pow(_sizeMetric(token), _growthExp() - 1);
    const maskOn = !!cont._maskGfx;

    // Size off the ship's actual drawn extent (silhouette bbox) when known, so
    // the mark scales with the visible ship image, not the token frame. Falls
    // back to the token's smaller side when no silhouette is available.
    let baseDim = minDim;
    if (cont._shipFracW && cont._shipFracH && cont._maskGridW) {
      const fit = token.document?.texture?.fit ?? "contain";
      const [fx, fy] = _fitScale(fit, w, h, cont._maskGridW, cont._maskGridH);
      const shipW = cont._maskGridW * fx * cont._shipFracW;
      const shipH = cont._maskGridH * fy * cont._shipFracH;
      const geo = Math.sqrt(Math.max(1, shipW) * Math.max(1, shipH));
      if (geo > 1) baseDim = geo;
    }

    for (const sp of layer.children) {
      const tier = TIERS[sp._tier] ?? TIERS.medium;
      let target = baseDim * tier.size * growthMult * mult;
      target = Math.min(target, minDim * 0.6);   // never swamp the hull
      const texW = sp.texture?.width || target;
      sp.scale.set(target / texW);

      let lx = (sp._nx ?? 0) * w;
      let ly = (sp._ny ?? 0) * h;
      if (!maskOn) {
        // No mask: keep the footprint inside the token box so an edge hit
        // doesn't leave half the decal hanging in empty space.
        const half = target * 0.5;
        const maxX = Math.max(0, w / 2 - half);
        const maxY = Math.max(0, h / 2 - half);
        lx = Math.max(-maxX, Math.min(maxX, lx));
        ly = Math.max(-maxY, Math.min(maxY, ly));
      }
      sp.position.set(lx, ly);
    }
  }
}

/** Build (or rebuild) the sprite set for a token from its flag, then sync. */
async function _rebuildContainer(token) {
  const doc = token?.document;
  if (!doc || !canvas?.tokens) return;

  const list = _enabled() ? await _decalListFor(token, { migrate: true }) : [];
  if (!list.length) { _destroyContainer(token.id); return; }

  let cont = _containers.get(token.id);
  if (!cont) {
    cont = new PIXI.Container();
    const tokenZ = typeof token.zIndex === "number" ? token.zIndex : 0;
    cont.zIndex = Math.max(900_000, tokenZ + 10_000);
    // Inner layer holds the decals and is what gets masked (sibling of mask).
    const layer = new PIXI.Container();
    cont.addChild(layer);
    cont._decalLayer = layer;
    if (!canvas.tokens.sortableChildren) canvas.tokens.sortableChildren = true;
    canvas.tokens.addChild(cont);
    _containers.set(token.id, cont);
  }

  // Measure the ship silhouette (for sizing) and clip the decal layer to it.
  await _updateMaskAndExtent(token, cont);

  // Skip rebuilding sprites when the decal data is unchanged.
  const layer = cont._decalLayer;
  const sig = JSON.stringify(list);
  if (cont._sig !== sig) {
    cont._sig = sig;
    for (const ch of layer.removeChildren()) { try { ch.destroy(); } catch { /* */ } }
    for (const d of list) {
      const tex = await _tierTexture(d.sev);
      if (!tex) continue;
      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.5);
      sp.rotation = d.rot ?? 0;
      sp._tier = d.sev;
      sp._nx = d.nx;
      sp._ny = d.ny;
      layer.addChild(sp);
    }
  }

  _syncContainer(token);
}

// ---------------------------------------------------------------------------
// Hook registration
// ---------------------------------------------------------------------------

// Re-apply size/position to all live decals — called when a size setting
// changes so the sliders update the canvas immediately.
export function resyncAllHullDecals() {
  for (const token of canvas?.tokens?.placeables ?? []) {
    if (_containers.has(token.id)) {
      try { _syncContainer(token); } catch { /* */ }
    }
  }
}

// Full rebuild of all decal containers — used when toggling the mask setting,
// which needs to add/remove the mask sprite, not just re-sync transforms.
export function refreshAllHullDecals() {
  for (const token of canvas?.tokens?.placeables ?? []) {
    _rebuildContainer(token).catch(() => {});
  }
}

export function registerHullDecals() {
  // Smoothly follow position/rotation/scale during animation.
  Hooks.on("refreshToken", (token) => {
    if (_containers.has(token?.id)) {
      try { _syncContainer(token); } catch { /* */ }
    }
  });

  // A new token drawn on the canvas — build its decals if it has any.
  Hooks.on("drawToken", (token) => { _rebuildContainer(token).catch(() => {}); });

  // Flag write propagated from the GM — rebuild on every client.
  Hooks.on("updateToken", (doc, changes) => {
    if (!Object.prototype.hasOwnProperty.call(changes?.flags?.[MODULE] ?? {}, FLAG)) return;
    const token = canvas?.tokens?.get(doc.id);
    if (token) _rebuildContainer(token).catch(() => {});
  });

  Hooks.on("updateActor", (actor, changes) => {
    if (!Object.prototype.hasOwnProperty.call(changes?.flags?.[MODULE] ?? {}, FLAG)) return;
    for (const token of canvas?.tokens?.placeables ?? []) {
      if (token.actor === actor || token.document?.actorId === actor.id) {
        _rebuildContainer(token).catch(() => {});
      }
    }
  });

  Hooks.on("deleteToken", (doc) => _destroyContainer(doc.id));

  // Scene change / reload — tear down and rebuild for the new canvas.
  Hooks.on("canvasReady", () => {
    for (const id of [..._containers.keys()]) _destroyContainer(id);
    for (const token of canvas?.tokens?.placeables ?? []) {
      _rebuildContainer(token).catch(() => {});
    }
  });
}
