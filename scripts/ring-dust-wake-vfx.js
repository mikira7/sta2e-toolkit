/**
 * sta2e-toolkit | ring-dust-wake-vfx.js
 *
 * A ship moving through a planetary ring kicks up a wake of ring material.
 * The rings are the Regions the star-system scene builder flags `planetRing`
 * (see ringRegionData in star-system-scene.js). Those Regions also carry the
 * Difficult Terrain and Sensor Shroud behaviors, so this file is only the look.
 *
 * There is **no socket action**. A move is a document update and Foundry
 * replicates it to every client, so each client's own `updateToken` hook
 * starts its own wake. This is the same reasoning as Q Flash Kick. The hook
 * is deliberately **not** gated by `sta2eScriptedMove`: an Impulse glide
 * writes a stream of flagged waypoints, and each one should keep the wake going.
 *
 * The wake follows the token's *animated* position (`mesh.position`, which
 * core rewrites every frame of a glide from the interpolated document), and
 * it emits only while that point is inside a ring Region. A ship flying over
 * the ring's gap, or out past its edge, therefore leaves nothing behind it.
 * A token this client cannot see emits nothing, because a wake must never give
 * away a cloaked ship.
 */

import { effectLayer, VFX_Z_BASE, parseHexColor, buildCloudTexture, buildMoteTexture, addBlend } from "./starfield-common.js";
import { regionContainsPoint } from "./spawn-regions.js";

const MODULE_ID = "sta2e-toolkit";
const RING_REGION_FLAG = "planetRing";

const PUFF_SPACING_PX = 16;     // one puff per this much travel
const PUFF_LIFE_MS = 1700;
const MAX_STEP_PX = 400;        // a larger jump in one frame is a teleport, not a flight
const IDLE_STOP_MS = 600;       // stop following once the token has settled this long
const MAX_FOLLOW_MS = 12000;
const MAX_PUFFS = 220;

// ── Scene queries ───────────────────────────────────────────────────────────

function ringRegions(scene) {
  const regions = [];
  for (const region of scene?.regions ?? []) {
    const ring = region.getFlag?.(MODULE_ID, RING_REGION_FLAG);
    if (ring) regions.push({ region, ring });
  }
  return regions;
}

function ringAt(regions, point) {
  for (const entry of regions) if (regionContainsPoint(entry.region, point)) return entry;
  return null;
}

function wakeEnabled() {
  try { return game.settings.get(MODULE_ID, "ringDustWake") !== false; } catch { return true; }
}

// ── Textures ────────────────────────────────────────────────────────────────
// Built on first need, never at module load (they touch document and PIXI), and
// shared by every wake. canvasTearDown does not destroy them: they belong to no
// scene.

let _textures = null;
function textures() {
  if (_textures) return _textures;
  _textures = {
    dust: [0, 1, 2].map(() => buildCloudTexture({ contrast: 1.6, lobes: 6, spread: 0.45 })),
    mote: buildMoteTexture(),
  };
  return _textures;
}

// ── The wake ────────────────────────────────────────────────────────────────

const _wakes = new Map(); // token id -> wake

function _tokenPoint(token) {
  const p = token?.mesh?.position;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
  const c = token?.center;
  return c ? { x: c.x, y: c.y } : null;
}

function _canSee(token) {
  if (!token || token.destroyed) return false;
  if (token.document?.hidden && !game.user.isGM) return false;
  return token.visible !== false && token.isVisible !== false;
}

class RingDustWake {
  constructor(token) {
    this.token = token;
    this.tokenId = token.id;
    this.sceneId = token.document?.parent?.id ?? canvas.scene?.id;
    this.puffs = [];
    this.last = _tokenPoint(token);
    this.carry = 0;
    this.started = performance.now();
    this.lastMoved = this.started;
    this.following = true;
    this.regions = ringRegions(canvas.scene);
    const layer = effectLayer();
    this.container = new PIXI.Container();
    this.container.eventMode = "none";
    // Behind the ships, in the token layer, the way engine-trail-vfx.js draws its "below" exhaust.
    this.container.zIndex = -VFX_Z_BASE + (typeof token.zIndex === "number" ? token.zIndex : 0);
    layer?.addChild(this.container);
    this.tick = this.tick.bind(this);
    canvas.app.ticker.add(this.tick);
  }

  /** A new move on the same token keeps the wake following. */
  extend() {
    this.following = true;
    this.lastMoved = performance.now();
    if (!this.started || performance.now() - this.started > MAX_FOLLOW_MS) this.started = performance.now();
    this.regions = ringRegions(canvas.scene);
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (canvas.app.ticker.deltaMS ?? 16.7) / 1000);
    if (this.token.destroyed || canvas.scene?.id !== this.sceneId) return this.destroy();

    if (this.following) {
      const point = _tokenPoint(this.token);
      if (point && this.last) {
        const dx = point.x - this.last.x, dy = point.y - this.last.y;
        const step = Math.hypot(dx, dy);
        if (step > 0.5) this.lastMoved = now;
        if (step > 0 && step < MAX_STEP_PX) this._emitAlong(this.last, point, step);
      }
      this.last = point;
      if (now - this.lastMoved > IDLE_STOP_MS || now - this.started > MAX_FOLLOW_MS) this.following = false;
    }

    for (let i = this.puffs.length - 1; i >= 0; i -= 1) {
      const puff = this.puffs[i];
      puff.age += dt * 1000;
      const t = puff.age / puff.life;
      if (t >= 1) {
        puff.sprite.destroy();
        this.puffs.splice(i, 1);
        continue;
      }
      // Drag bleeds the kick off, so the dust hangs where the ship left it.
      const drag = Math.exp(-2.2 * dt);
      puff.vx *= drag; puff.vy *= drag;
      puff.sprite.x += puff.vx * dt;
      puff.sprite.y += puff.vy * dt;
      puff.sprite.rotation += puff.spin * dt;
      const grow = puff.scale0 + (puff.scale1 - puff.scale0) * (1 - (1 - t) ** 2);
      puff.sprite.scale.set(grow * puff.aspect, grow / puff.aspect);
      // Quick rise, long settle.
      puff.sprite.alpha = puff.alpha * Math.min(1, t * 8) * (1 - t) ** 1.4;
    }

    if (!this.following && !this.puffs.length) this.destroy();
  }

  _emitAlong(from, to, step) {
    if (!_canSee(this.token)) { this.carry = 0; return; }
    const dirX = (to.x - from.x) / step, dirY = (to.y - from.y) / step;
    const size = Math.max(this.token.w ?? 100, this.token.h ?? 100);
    this.carry += step;
    while (this.carry >= PUFF_SPACING_PX) {
      this.carry -= PUFF_SPACING_PX;
      const back = this.carry; // distance behind `to` of this puff
      const at = { x: to.x - dirX * back, y: to.y - dirY * back };
      const hit = ringAt(this.regions, at);
      if (!hit) continue;
      this._spawnPuff(at, dirX, dirY, size, hit.ring);
    }
  }

  _spawnPuff(at, dirX, dirY, size, ring) {
    if (this.puffs.length >= MAX_PUFFS) return;
    const tex = textures();
    const color = parseHexColor(ring.color, 0xcbbfa6);
    const icy = ring.style !== "dusty";
    const side = Math.random() < 0.5 ? -1 : 1;
    // Kicked out sideways from the ship's path and a little behind it.
    const kick = size * (0.6 + Math.random() * 0.9);
    const perpX = -dirY * side, perpY = dirX * side;
    const glint = icy && Math.random() < 0.28;
    const sprite = new PIXI.Sprite(glint ? tex.mote : tex.dust[Math.floor(Math.random() * tex.dust.length)]);
    sprite.anchor.set(0.5);
    sprite.tint = color;
    sprite.blendMode = glint ? addBlend() : (typeof PIXI?.BLEND_MODES?.NORMAL === "number" ? PIXI.BLEND_MODES.NORMAL : "normal");
    const spread = size * 0.25;
    sprite.position.set(at.x + (Math.random() - 0.5) * spread, at.y + (Math.random() - 0.5) * spread);
    sprite.rotation = Math.random() * Math.PI * 2;
    const texW = sprite.texture?.width || 128;
    const base = (glint ? size * 0.12 : size * 0.45) / texW;
    const puff = {
      sprite,
      age: 0,
      life: PUFF_LIFE_MS * (glint ? 0.55 : 0.8 + Math.random() * 0.5),
      vx: perpX * kick - dirX * size * 0.3,
      vy: perpY * kick - dirY * size * 0.3,
      spin: (Math.random() - 0.5) * (glint ? 3 : 0.5),
      scale0: base * (0.6 + Math.random() * 0.3),
      scale1: base * (glint ? 0.4 : 1.8 + Math.random() * 0.9),
      aspect: 0.75 + Math.random() * 0.5,
      alpha: glint ? 0.9 : icy ? 0.42 : 0.55,
    };
    sprite.alpha = 0;
    this.container.addChild(sprite);
    this.puffs.push(puff);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    canvas?.app?.ticker?.remove(this.tick);
    // Sprites only: the textures are shared.
    try { this.container.destroy({ children: true }); } catch { /* already torn down */ }
    this.puffs.length = 0;
    if (_wakes.get(this.tokenId) === this) _wakes.delete(this.tokenId);
  }
}

/** Start (or extend) the wake on a token. Safe to call on any client. */
export function startRingDustWake(token) {
  if (!token || token.destroyed || !canvas?.ready) return null;
  const existing = _wakes.get(token.id);
  if (existing && !existing.destroyed) { existing.extend(); return existing; }
  const wake = new RingDustWake(token);
  _wakes.set(token.id, wake);
  return wake;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function registerRingDustWake() {
  Hooks.on("updateToken", (tokenDoc, changes) => {
    if (!("x" in changes) && !("y" in changes)) return;
    if (tokenDoc.parent !== canvas?.scene || !canvas.ready || !wakeEnabled()) return;
    const regions = ringRegions(tokenDoc.parent);
    if (!regions.length) return;
    // No straight-line pre-test: a ruler move can bend through the ring along
    // its waypoints, and the follower only emits inside the ring anyway. The
    // cost of following a move that never enters one is a point test per 16 px.
    const token = tokenDoc.object;
    if (token) startRingDustWake(token);
  });

  Hooks.on("canvasTearDown", () => {
    for (const wake of [..._wakes.values()]) wake.destroy();
  });
}
