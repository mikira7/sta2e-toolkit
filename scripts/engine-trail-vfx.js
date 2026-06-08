/**
 * sta2e-toolkit | engine-trail-vfx.js
 *
 * Native PIXI v8 movement trails for starship impulse engines and warp
 * nacelles. Emitter points, their facing and above/below layer, and the
 * per-ship colour / length / width / rate / alpha / fade / blend settings are
 * authored in the Ship VFX Anchor editor and stored on the actor flag.
 *
 * Each placed emitter draws its OWN tapered line (so twin nacelles each leave a
 * streak). The trail is a redrawn ribbon — a polyline through the recent path
 * of the emitter point — not loose particles, so it reads as a continuous line.
 *
 * A short move fires the impulse trail; a long move (>= the per-ship warp
 * threshold, in grid squares) fires the warp streak. See the foundry-vfx skill
 * for the PIXI v8 patterns this builds on.
 */

import {
  getShipEngineEmitters,
  getShipEngineTrailSettings,
  normalizeShipEngineTrailSettings,
  shipEngineEmitterToCanvasPoint,
  shipEngineFacingToCanvasDeg,
  resolveEngineTrailColorHex,
} from "./ship-vfx-anchors.js";

// ── PIXI v8 compatibility shims (see foundry-vfx skill) ─────────────────────
function _addBlend() {
  if (typeof PIXI?.BLEND_MODES?.ADD === "number") return PIXI.BLEND_MODES.ADD;
  return "add";
}

function _blendMode(mode) {
  if (mode === "normal") {
    return typeof PIXI?.BLEND_MODES?.NORMAL === "number" ? PIXI.BLEND_MODES.NORMAL : "normal";
  }
  return _addBlend();
}

function _parseHexColor(value, fallback = 0xffffff) {
  const text = String(value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return Number.parseInt(text.slice(1), 16);
  return fallback;
}

// Mix a colour toward white by amt (0..1) for the bright inner core.
function _lighten(color, amt) {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const lr = Math.round(r + (255 - r) * amt);
  const lg = Math.round(g + (255 - g) * amt);
  const lb = Math.round(b + (255 - b) * amt);
  return (lr << 16) | (lg << 8) | lb;
}

// PIXI v7/v8 safe single line segment with round caps/joins for smooth ribbons.
function _drawLine(g, from, to, width, color, alpha) {
  if (alpha <= 0 || width <= 0) return;
  if (typeof g.lineStyle === "function") {
    g.lineStyle(width, color, alpha);
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
  } else {
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    g.stroke({ width, color, alpha, cap: "round", join: "round" });
  }
}

// ── Token geometry helpers ──────────────────────────────────────────────────
function _resolveToken(tokenOrDoc) {
  if (!tokenOrDoc) return null;
  if (tokenOrDoc.object) return tokenOrDoc.object;            // TokenDocument -> placeable
  if (tokenOrDoc.center || tokenOrDoc.mesh) return tokenOrDoc; // already a placeable
  return canvas?.tokens?.get?.(tokenOrDoc.id) ?? null;
}

// Where to parent the trail, and at what zIndex, for a given layer choice.
// "above" rides the TokenLayer (above token sprites). "below" rides the
// PrimaryCanvasGroup beneath the token mesh so exhaust sits behind the hull.
function _trailParent(token, layer) {
  if (layer === "below") {
    const primary = canvas?.primary ?? null;
    if (primary) {
      if (!primary.sortableChildren) primary.sortableChildren = true;
      const meshZ = typeof token?.mesh?.zIndex === "number" ? token.mesh.zIndex : 0;
      return { parent: primary, zIndex: meshZ - 50 };
    }
  }
  const tokens = canvas?.tokens ?? canvas?.interface ?? canvas?.stage ?? null;
  if (tokens && !tokens.sortableChildren) tokens.sortableChildren = true;
  const tokenZ = typeof token?.zIndex === "number" ? token.zIndex : 0;
  return { parent: tokens, zIndex: Math.max(900_000, tokenZ + 10_000) };
}

function _degToRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Spawn an engine trail for one mode (impulse|warp).
 *
 * @param {Token|TokenDocument} tokenOrDoc
 * @param {"impulse"|"warp"} kind
 * @param {object} opts
 * @param {object} [opts.settings]    Full engineTrail settings object (normalized or raw).
 * @param {object[]} [opts.emitters]  Emitter anchors; defaults to the saved ones for this kind.
 * @param {number} [opts.emitDuration] How long to keep emitting, ms.
 */
export function spawnEngineTrail(tokenOrDoc, kind, opts = {}) {
  const token = _resolveToken(tokenOrDoc);
  if (!token || !canvas?.app?.ticker) return;
  if (typeof PIXI === "undefined") return;

  const settings = opts.settings
    ? normalizeShipEngineTrailSettings(opts.settings)
    : getShipEngineTrailSettings(token);
  if (!settings?.enabled && !opts.isPreview) return;

  const mode = settings?.[kind];
  if (!mode) return;

  const emitters = (opts.emitters && opts.emitters.length)
    ? opts.emitters.filter(a => !a.kind || a.kind === kind)
    : getShipEngineEmitters(token, kind);
  if (!emitters.length) return;

  const colorNum = _parseHexColor(resolveEngineTrailColorHex(token, kind, mode), 0xffffff);
  const coreColorNum = _lighten(colorNum, 0.55);
  const blend = _blendMode(mode.blendMode);
  const life = Math.max(60, mode.fade);                        // ms a node persists
  const speed = Math.max(20, mode.lengthPx / (life / 1000));   // px/sec so the tail reaches ~lengthPx
  const width = Math.max(1, mode.width);
  const peakAlpha = Math.max(0, Math.min(1, mode.alpha));
  const emitDuration = Math.max(120, opts.emitDuration ?? 700);
  const maxNodes = 64;
  const nodeInterval = Math.max(8, life / maxNodes);           // even node spacing along the line

  // One ribbon per placed emitter point — every nacelle streams its own line.
  const sources = [];
  for (const anchor of emitters) {
    const { parent, zIndex } = _trailParent(token, anchor.layer === "below" ? "below" : "above");
    if (!parent) continue;
    const g = new PIXI.Graphics();
    g.zIndex = zIndex;
    g.blendMode = blend;
    parent.addChild(g);
    sources.push({ anchor, g, nodes: [], spawnAccum: 0 });
  }
  if (!sources.length) return;

  const startedAt = performance.now();
  let prevNow = startedAt;

  const cleanup = () => {
    try { canvas.app.ticker.remove(tick); } catch { /* no-op */ }
    for (const source of sources) {
      try { source.g.destroy(); } catch { /* no-op */ }
    }
  };

  function tick() {
    const now = performance.now();
    const dt = Math.min(now - prevNow, 50);
    prevNow = now;
    const dtSec = dt / 1000;
    const elapsed = now - startedAt;
    const emitting = elapsed < emitDuration;

    let liveNodes = 0;
    for (const source of sources) {
      const head = shipEngineEmitterToCanvasPoint(token, source.anchor);
      const angle = _degToRad(shipEngineFacingToCanvasDeg(token, source.anchor.facingDeg));
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;

      // Drop evenly spaced nodes at the live emitter point while emitting.
      if (emitting && head) {
        source.spawnAccum += dt;
        let budget = 8;
        while (source.spawnAccum >= nodeInterval && budget-- > 0) {
          source.spawnAccum -= nodeInterval;
          source.nodes.unshift({ x: head.x, y: head.y, age: 0 });
        }
        if (source.nodes.length > maxNodes) source.nodes.length = maxNodes;
      }

      // Advance + age nodes; the exhaust drifts aft and old nodes fall off the tail.
      const kept = [];
      for (const n of source.nodes) {
        n.age += dt;
        if (n.age >= life) continue;
        n.x += vx * dtSec;
        n.y += vy * dtSec;
        kept.push(n);
      }
      source.nodes = kept;
      liveNodes += kept.length;

      // Redraw the tapered line: a soft wide glow pass + a thin bright core.
      const g = source.g;
      g.clear();
      const pts = (emitting && head) ? [head, ...kept] : kept;
      const count = pts.length;
      if (count >= 2) {
        for (let i = 0; i < count - 1; i++) {
          const f = i / (count - 1);                 // 0 at head .. ~1 at tail
          const fade = Math.pow(1 - f, 1.3);
          _drawLine(g, pts[i], pts[i + 1], width * 2.1 * (0.5 + 0.5 * fade), colorNum, peakAlpha * 0.22 * fade);
        }
        for (let i = 0; i < count - 1; i++) {
          const f = i / (count - 1);
          const fade = Math.pow(1 - f, 1.2);
          _drawLine(g, pts[i], pts[i + 1], Math.max(0.75, width * (0.35 + 0.65 * fade)), coreColorNum, peakAlpha * fade);
        }
      }
    }

    if (!emitting && liveNodes === 0) cleanup();
  }

  canvas.app.ticker.add(tick);
  // Hard safety stop in case the ticker callback is starved.
  setTimeout(cleanup, emitDuration + life + 800);
}

/**
 * Decide impulse vs warp from move distance and fire the trail. Runs on every
 * client (token animation plays everywhere), so no socket broadcast is needed.
 */
export function triggerEngineTrailForMovement(tokenOrDoc, fromCenter, toCenter) {
  const token = _resolveToken(tokenOrDoc);
  if (!token) return;
  const settings = getShipEngineTrailSettings(token);
  if (!settings?.enabled) return;

  const gridSize = canvas?.grid?.size ?? 100;
  const dx = (toCenter?.x ?? 0) - (fromCenter?.x ?? 0);
  const dy = (toCenter?.y ?? 0) - (fromCenter?.y ?? 0);
  const distPx = Math.hypot(dx, dy);
  if (distPx < gridSize * 0.15) return; // ignore tiny nudges

  const distSquares = distPx / gridSize;
  const kind = distSquares >= settings.warpThreshold ? "warp" : "impulse";

  // No emitters for this kind? Fall back to the other so a move still reads.
  let useKind = kind;
  if (!getShipEngineEmitters(token, kind).length) {
    const other = kind === "warp" ? "impulse" : "warp";
    if (getShipEngineEmitters(token, other).length) useKind = other;
    else return;
  }

  // Emission time scales with the distance travelled, clamped to a sane range.
  const emitDuration = Math.max(300, Math.min(2600, distSquares * 130));
  spawnEngineTrail(token, useKind, { settings, emitDuration });
}

/**
 * Editor preview: fire a self-contained burst using the (possibly unsaved)
 * settings and emitter points currently on screen, without moving the token.
 */
export function previewEngineTrail(tokenOrDoc, kind, settings, emitters) {
  spawnEngineTrail(tokenOrDoc, kind, {
    settings,
    emitters,
    emitDuration: 1100,
    isPreview: true,
  });
}
