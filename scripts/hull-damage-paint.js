/**
 * sta2e-toolkit | hull-damage-paint.js
 *
 * The "Painted damage" style of hull damage (setting `hullDamageStyle` =
 * "painted"). It reads the SAME `hullDecals` flag the scorch decals use and
 * draws it a different way: every hit is painted into one damage field over the
 * token art (hull-damage-field.js), which is composited into two textures —
 * scorch, torn plating, exposed decks and open breaches drawn normally, and the
 * heat (glowing tear edges, embers in the decks) drawn additively — plus a few
 * drifting ember sprites. The exposed interior follows the ship's shape — a
 * saucer's rings, a nacelle's frames — from the hull analysis
 * (hull-sections.js) made once per art image alongside its alpha.
 *
 * hull-decals.js owns the container, its placement on canvas.tokens, the flag
 * and every hook; this file only fills the container's paint layer and keeps
 * it sized. Rules it rests on:
 *
 *  - The textures are rebuilt only when the hits, the art or a hit's heat
 *    changes (`sig`). Heat is quantised to tenths, so cooling costs one rebuild
 *    per step, not one per frame. Building is ~15–35 ms at 384 px.
 *  - The textures belong to the instance and are destroyed with it; the art's
 *    alpha is cached per src and shared.
 *  - The layer works in FIELD pixels: its scale maps one field px onto the
 *    displayed art, so sprites, embers and the field share one coordinate frame
 *    and the whole thing rides the container's rotation like the decals do.
 *  - The ticker runs only while something is hot, and is removed on destroy.
 */

import {
  FIELD_MAX, buildDamageField, composeDamage, silhouettePx, hitHeat,
} from "./hull-damage-field.js";
import { analyzeHull } from "./hull-sections.js";
import { getTokenAlphaMask } from "./ship-vfx-anchors.js";
import { addBlend } from "./starfield-common.js";

const MODULE = "sta2e-toolkit";

// src -> Promise<{W, H, natW, natH, alpha, shipPx, hull} | null>. The hull
// analysis (distance field + sections, ~80 ms) is made here, once per image.
const _artCache = new Map();

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

function _scaleMult() {
  try {
    const v = Number(game.settings.get(MODULE, "hullDecalScale"));
    return Number.isFinite(v) && v > 0 ? v : 1;
  } catch { return 1; }
}

function _isVideo(src) {
  return /\.(webm|mp4|m4v|ogv)(\?|$)/i.test(String(src ?? ""));
}

/**
 * The token art's alpha at field resolution. Read from the image itself so the
 * wound's edge follows the hull's real outline; a video, or an image a remote
 * host will not let us read (a tainted canvas), falls back to the coarse
 * alpha grid the weapon anchors already sample.
 */
async function _artFor(src) {
  if (_artCache.has(src)) return _artCache.get(src);
  const job = (async () => {
    if (!_isVideo(src)) {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = src; });
        const natW = img.naturalWidth, natH = img.naturalHeight;
        if (natW && natH) {
          const s = Math.min(1, FIELD_MAX / Math.max(natW, natH));
          const W = Math.max(1, Math.round(natW * s)), H = Math.max(1, Math.round(natH * s));
          const c = document.createElement("canvas");
          c.width = W; c.height = H;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, W, H);
          const px = ctx.getImageData(0, 0, W, H).data;   // throws when tainted
          const alpha = new Uint8Array(W * H);
          for (let i = 0; i < W * H; i++) alpha[i] = px[i * 4 + 3];
          return _withHull({ W, H, natW, natH, alpha, shipPx: silhouettePx(alpha, W, H) });
        }
      } catch { /* fall through to the alpha grid */ }
    }
    const grid = await getTokenAlphaMask(src);
    if (!grid?.opaqueSet?.size) return null;
    // Upscale the coarse grid (≤96 px) by nearest neighbour to a usable field.
    const k = Math.max(1, Math.floor(FIELD_MAX / Math.max(grid.width, grid.height)));
    const W = grid.width * k, H = grid.height * k;
    const alpha = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (grid.opaqueSet.has(Math.floor(y / k) * grid.width + Math.floor(x / k))) alpha[y * W + x] = 255;
      }
    }
    return _withHull({ W, H, natW: grid.width, natH: grid.height, alpha, shipPx: silhouettePx(alpha, W, H) });
  })();
  _artCache.set(src, job);
  const art = await job;
  if (!art) _artCache.delete(src);   // let a later load retry
  return art;
}

/** Attach the hull analysis; without it the interior falls back to a plain grid. */
function _withHull(art) {
  try { art.hull = analyzeHull(art.alpha, art.W, art.H); }
  catch (err) { console.warn("STA2e Toolkit | Hull section analysis failed:", err); art.hull = null; }
  return art;
}

/** Displayed size of the art inside the token box, in canvas px. */
function _artDisplaySize(token, art) {
  const w = token.w || 1, h = token.h || 1;
  const fit = token.document?.texture?.fit ?? "contain";
  const [fx, fy] = _fitScale(fit, w, h, art.natW, art.natH);
  return {
    artW: art.natW * fx * Math.abs(token.document?.texture?.scaleX ?? 1),
    artH: art.natH * fy * Math.abs(token.document?.texture?.scaleY ?? 1),
  };
}

function _canvasTexture(rgba, W, H) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  c.getContext("2d").putImageData(new ImageData(rgba, W, H), 0, 0);
  return PIXI.Texture.from(c);
}

let _emberTex = null;
function _emberTexture() {
  const base = _emberTex?.baseTexture ?? _emberTex?.source;
  if (_emberTex && !_emberTex.destroyed && base && !base.destroyed) return _emberTex;
  const S = 16, c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,240,200,1)");
  g.addColorStop(0.35, "rgba(255,150,60,0.8)");
  g.addColorStop(1, "rgba(255,60,10,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  _emberTex = PIXI.Texture.from(c);
  return _emberTex;
}

function _heatContext() {
  const combat = game.combat;
  return {
    now: Date.now(),
    combatId: combat?.started ? combat.id : null,
    round: combat?.started ? combat.round : null,
  };
}

/** Destroy a container's paint instance (sprites, owned textures, ticker). */
export function destroyHullDamagePaint(cont) {
  const p = cont?._paint;
  if (!p) return;
  cont._paint = null;
  if (p.tick) { try { canvas.app?.ticker?.remove(p.tick); } catch { /* */ } }
  try { p.layer.destroy({ children: true }); } catch { /* */ }
  for (const t of [p.texBase, p.texGlow]) { try { t?.destroy(true); } catch { /* */ } }
}

/**
 * Fill (or refresh) `cont`'s paint layer from the hit list. Returns false when
 * the art cannot be read at all, so the caller falls back to scorch decals.
 */
export async function paintHullDamage(token, cont, list) {
  const src = token?.document?.texture?.src;
  if (!src) return false;
  const art = await _artFor(src);
  if (!art || token.destroyed || !_isLive(cont)) return false;

  const hc = _heatContext();
  // Hits are recorded where they landed on the DISPLAYED art; the field is
  // built over the art as stored, and the layer is mirrored back on display.
  // So a mirrored token's hits are mirrored into art space here.
  const fx = (token.document?.texture?.scaleX ?? 1) < 0;
  const fy = (token.document?.texture?.scaleY ?? 1) < 0;
  const hits = (list ?? []).map(h => {
    const out = { ...h, heat: hitHeat(h, hc) };
    const dir = Number.isFinite(h.dir) ? h.dir : Number(h.rot) || 0;
    if (fx) { out.nx = -(Number(h.nx) || 0); out.dir = Math.PI - dir; }
    if (fy) { out.ny = -(Number(h.ny) || 0); out.dir = -(fx ? out.dir : dir); }
    return out;
  });
  const { artW, artH } = _artDisplaySize(token, art);
  const w = token.w || 1, h = token.h || 1;
  const sx = art.W / Math.max(1, artW), sy = art.H / Math.max(1, artH);
  const scale = _scaleMult();
  const sig = JSON.stringify([src, art.W, art.H, Math.round(w), Math.round(h), Math.round(artW), Math.round(artH), scale, hits]);

  let p = cont._paint;
  if (p && p.sig === sig) { syncHullDamagePaint(token, cont); return true; }

  const geo = {
    W: art.W, H: art.H, alpha: art.alpha, shipPx: art.shipPx,
    boxX: w * sx, boxY: h * sy, aniso: sy / sx, scale, hull: art.hull,
  };
  const comp = composeDamage(buildDamageField(hits, geo), geo);
  if (token.destroyed || !_isLive(cont)) return false;

  destroyHullDamagePaint(cont);
  const layer = new PIXI.Container();
  const texBase = _canvasTexture(comp.base, art.W, art.H);
  const texGlow = _canvasTexture(comp.glow, art.W, art.H);
  const baseSp = new PIXI.Sprite(texBase);
  baseSp.anchor.set(0.5);
  const glowSp = new PIXI.Sprite(texGlow);
  glowSp.anchor.set(0.5);
  glowSp.blendMode = addBlend();
  layer.addChild(baseSp, glowSp);
  const embers = new PIXI.Container();
  layer.addChild(embers);
  cont.addChild(layer);

  // `warm` (any heat left) is what keeps this token on the cooling rebuilds.
  // It must not be read off the ticker: a wound at heat 0.2 has no ember spots
  // (they need > 0.25), and when warmth meant "has a ticker" it was never
  // rebuilt again and kept a faint glow forever instead of cooling to a scar.
  p = cont._paint = { layer, texBase, texGlow, glowSp, embers, sig, W: art.W, H: art.H, art, tick: null, warm: comp.maxHeat > 0 };

  if (comp.maxHeat > 0.05) {
    const tex = _emberTexture();
    const spots = comp.embers;
    const count = spots.length ? Math.min(spots.length, Math.round(10 + 26 * comp.maxHeat)) : 0;
    const fieldScale = art.shipPx / 240;   // ember size tracks the hull in field px
    const parts = [];
    for (let i = 0; i < count; i++) {
      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.5);
      sp.blendMode = addBlend();
      sp.alpha = 0;
      embers.addChild(sp);
      parts.push({ sp, life: 0, age: Math.random(), ttl: 1, vx: 0, vy: 0, h: 1 });
    }
    const respawn = (pt) => {
      const s = spots[Math.floor(Math.random() * spots.length)];
      pt.sp.position.set(s.x - art.W / 2, s.y - art.H / 2);
      pt.h = s.h;
      pt.age = 0;
      pt.ttl = 0.6 + Math.random() * 1.4;
      const a = Math.random() * Math.PI * 2, v = (2 + Math.random() * 5) * fieldScale;
      pt.vx = Math.cos(a) * v; pt.vy = Math.sin(a) * v;
      pt.sp.scale.set((0.18 + Math.random() * 0.22) * fieldScale);
    };
    for (const pt of parts) { respawn(pt); pt.age = Math.random() * pt.ttl; }
    let t = Math.random() * 10;
    p.tick = () => {
      if (!_isLive(cont) || !cont.visible) return;
      const dt = Math.min(0.1, (canvas.app?.ticker?.deltaMS ?? 16) / 1000);
      t += dt;
      // Uneven flicker on the rims: two sines and a slow swell.
      glowSp.alpha = 0.78 + 0.12 * Math.sin(t * 2.3) + 0.07 * Math.sin(t * 7.9 + 1.3) + 0.05 * Math.sin(t * 0.6);
      for (const pt of parts) {
        pt.age += dt;
        if (pt.age >= pt.ttl) respawn(pt);
        const u = pt.age / pt.ttl;
        pt.sp.x += pt.vx * dt;
        pt.sp.y += pt.vy * dt;
        pt.sp.alpha = pt.h * Math.sin(Math.PI * u) * (0.75 + 0.25 * Math.sin(t * 13 + pt.ttl * 7));
      }
    };
    canvas.app?.ticker?.add(p.tick);
  }

  syncHullDamagePaint(token, cont);
  return true;
}

function _isLive(cont) {
  return !!cont && !cont.destroyed;
}

/** Size the paint layer onto the displayed art (position/rotation are the container's). */
export function syncHullDamagePaint(token, cont) {
  const p = cont?._paint;
  if (!p || !token) return;
  const { artW, artH } = _artDisplaySize(token, p.art);
  const flipX = (token.document?.texture?.scaleX ?? 1) < 0 ? -1 : 1;
  const flipY = (token.document?.texture?.scaleY ?? 1) < 0 ? -1 : 1;
  p.layer.position.set(0, 0);
  p.layer.scale.set(flipX * artW / p.W, flipY * artH / p.H);
}

/** True when a rebuild could change the look: something on this token is still cooling. */
export function hullDamagePaintIsWarm(cont) {
  return !!cont?._paint?.warm;
}
