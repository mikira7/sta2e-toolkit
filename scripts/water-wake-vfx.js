/**
 * sta2e-toolkit | water-wake-vfx.js
 *
 * Tokens moving through Water Surface Regions leave ripples. The ring dust
 * wake's follower (ring-dust-wake-vfx.js), pointed at water: each client's own
 * `updateToken` hook follows the token's ANIMATED position (`mesh.position`) and
 * drops a ripple into the water instance under it every so often. The ripples
 * themselves are drawn by the water shader (uRipples), so a wake costs a few
 * uniform writes, not sprites.
 *
 * No socket, not gated by `sta2eScriptedMove` (a glide wakes the whole way), and
 * nothing for a token this client cannot see, so a wake never gives away a
 * hidden ship.
 */

import { waterAt, hasWakeWater, addWaterRipple, readWaterConfig } from "./water-vfx.js";

const SPACING_SQUARES = 0.45;
const MAX_STEP_PX = 400;
const IDLE_STOP_MS = 600;
const MAX_FOLLOW_MS = 15000;

const _followers = new Map();

function _point(token) {
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

class WakeFollower {
  constructor(token) {
    this.token = token;
    this.id = token.id;
    this.last = _point(token);
    this.carry = 0;
    this.started = performance.now();
    this.moved = this.started;
    this.tick = this.tick.bind(this);
    canvas.app.ticker.add(this.tick);
  }

  extend() { this.started = performance.now(); this.moved = this.started; }

  tick() {
    const token = this.token;
    if (!token || token.destroyed || !canvas?.ready) { this.destroy(); return; }
    const now = performance.now();
    const p = _point(token);
    if (!p || !this.last) { this.last = p; return; }
    const step = Math.hypot(p.x - this.last.x, p.y - this.last.y);
    if (step > MAX_STEP_PX) { this.last = p; this.carry = 0; }
    else if (step > 0.5) {
      this.moved = now;
      this._emit(p, step);
      this.last = p;
    }
    if (now - this.moved > IDLE_STOP_MS || now - this.started > MAX_FOLLOW_MS) this.destroy();
  }

  _emit(p, step) {
    if (!_canSee(this.token)) { this.carry = 0; return; }
    const grid = canvas.dimensions?.size || 100;
    const spacing = grid * SPACING_SQUARES;
    this.carry += step;
    if (this.carry < spacing) return;
    this.carry %= spacing;
    const size = Math.max(this.token.w ?? grid, this.token.h ?? grid) / grid;
    for (const inst of waterAt(p)) {
      const cfg = readWaterConfig(inst.behavior);
      addWaterRipple(inst.uuid, p.x, p.y, cfg.wakeStrength * Math.min(1.6, 0.6 + 0.4 * size));
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    canvas?.app?.ticker?.remove(this.tick);
    if (_followers.get(this.id) === this) _followers.delete(this.id);
  }
}

export function registerWaterWake() {
  Hooks.on("updateToken", (tokenDoc, changes) => {
    if (!("x" in changes) && !("y" in changes)) return;
    if (tokenDoc.parent !== canvas?.scene || !canvas.ready || !hasWakeWater()) return;
    const token = tokenDoc.object;
    if (!token) return;
    const existing = _followers.get(token.id);
    if (existing && !existing.destroyed) { existing.extend(); return; }
    _followers.set(token.id, new WakeFollower(token));
  });
  Hooks.on("canvasTearDown", () => {
    for (const f of [..._followers.values()]) f.destroy();
  });
}
