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
 * The action handlers decide whether an impulse or warp trail should fire.
 * See the foundry-vfx skill for the PIXI v8 patterns this builds on.
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

// ── Diagnostics ─────────────────────────────────────────────────────────────
// spawnEngineTrail has several guards that legitimately no-op (trail disabled,
// no emitters placed). They used to return silently, which made "no trail
// appeared" impossible to triage. Bail-outs now always warn; the verbose
// success dump is opt-in via `CONFIG.debug.sta2eVfx = true` in the console.
const LOG_PREFIX = "sta2e-toolkit | EngineTrail";

function _vfxDebug() {
  return !!CONFIG?.debug?.sta2eVfx;
}

function _abort(kind, reason, detail = null) {
  console.warn(`${LOG_PREFIX}(${kind}) aborted — ${reason}`, detail ?? "");
}

// ── Token geometry helpers ──────────────────────────────────────────────────
function _resolveToken(tokenOrDoc) {
  if (!tokenOrDoc) return null;
  if (tokenOrDoc.object) return tokenOrDoc.object;            // TokenDocument -> placeable
  if (tokenOrDoc.center || tokenOrDoc.mesh) return tokenOrDoc; // already a placeable
  return canvas?.tokens?.get?.(tokenOrDoc.id) ?? null;
}

const VFX_Z_BASE = 900_000;

// The layer custom VFX render into. canvas.tokens (TokenLayer) sits ABOVE
// canvas.primary in the display list, so a large zIndex beats every token
// sprite and a negative one drops behind them. Mirrors _effectLayer() in
// transporter-vfx.js and the layer chain in native-weapon-vfx.js.
//
// We deliberately do NOT parent into canvas.primary any more. The
// PrimaryCanvasGroup sorts and composites its children by elevation/sort, and
// a bare PIXI.Graphics carrying neither of those rendered nothing at all under
// Foundry v14 / PIXI v8 — which is why "below" emitters were invisible there
// while every other effect in the module kept working.
function _trailLayer() {
  const layer = canvas?.tokens ?? canvas?.interface ?? canvas?.primary ?? canvas?.stage ?? null;
  if (layer && !layer.sortableChildren) layer.sortableChildren = true;
  return layer;
}

// "below" is expressed purely as a negative zIndex within that layer, the same
// way _sceneContainer() places the torpedo trail in native-weapon-vfx.js.
// Trade-off: this puts the exhaust behind *all* tokens rather than just its own
// hull. That matches existing behaviour elsewhere in the module and is
// version-agnostic, unlike the PrimaryCanvasGroup approach it replaces.
function _trailZIndex(token, layer) {
  const tokenZ = typeof token?.zIndex === "number" ? token.zIndex : 0;
  return layer === "below"
    ? -VFX_Z_BASE + tokenZ
    : Math.max(VFX_Z_BASE, tokenZ + 10_000);
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
 * @param {Function} [opts.sampleToken] Optional virtual token sampler for scripted action paths.
 * @param {boolean} [opts.drift] Whether old nodes drift along emitter facing; defaults true.
 */
export function spawnEngineTrail(tokenOrDoc, kind, opts = {}) {
  const token = _resolveToken(tokenOrDoc);
  if (!token) return _abort(kind, "could not resolve a canvas token", tokenOrDoc);
  if (typeof PIXI === "undefined") return _abort(kind, "PIXI is not available");
  if (!canvas?.app?.ticker) return _abort(kind, "canvas.app.ticker is not available");

  const settings = opts.settings
    ? normalizeShipEngineTrailSettings(opts.settings)
    : getShipEngineTrailSettings(token);
  if (!settings?.enabled && !opts.isPreview) {
    return _abort(kind, "engine trails are disabled for this ship "
      + "(Ship VFX Anchor editor → Engine tab → enable), actor: " + (token.actor?.name ?? "?"));
  }

  const mode = settings?.[kind];
  if (!mode) return _abort(kind, `no "${kind}" settings block on this ship`, settings);

  const emitters = (opts.emitters && opts.emitters.length)
    ? opts.emitters.filter(a => !a.kind || a.kind === kind)
    : getShipEngineEmitters(token, kind);
  if (!emitters.length) {
    return _abort(kind, `no ${kind} emitter points placed on this ship, actor: `
      + (token.actor?.name ?? "?"));
  }

  const colorNum = _parseHexColor(resolveEngineTrailColorHex(token, kind, mode), 0xffffff);
  const coreColorNum = _lighten(colorNum, 0.55);
  const blend = _blendMode(mode.blendMode);
  const life = Math.max(60, mode.fade);                        // ms a node persists
  const speed = Math.max(20, mode.lengthPx / (life / 1000));   // px/sec so the tail reaches ~lengthPx
  const width = Math.max(1, mode.width);
  const peakAlpha = Math.max(0, Math.min(1, mode.alpha));
  const emitDuration = Math.max(120, opts.emitDuration ?? 700);
  const drift = opts.drift !== false;
  const maxNodes = 64;
  const nodeInterval = Math.max(8, life / maxNodes);           // even node spacing along the line

  // One ribbon per placed emitter point — every nacelle streams its own line.
  // The Graphics rides inside a Container that carries the zIndex, matching how
  // transporter / weapon VFX are structured so the layer sort sees a stable object.
  const parent = _trailLayer();
  if (!parent) return _abort(kind, "no canvas layer available to parent the trail");

  const sources = [];
  for (const anchor of emitters) {
    const layerName = anchor.layer === "below" ? "below" : "above";
    const container = new PIXI.Container();
    container.zIndex = _trailZIndex(token, layerName);
    const g = new PIXI.Graphics();
    g.blendMode = blend;
    container.addChild(g);
    parent.addChild(container);
    sources.push({ anchor, g, container, nodes: [], spawnAccum: 0 });
  }
  if (!sources.length) return _abort(kind, "no emitter ribbons could be created");

  if (_vfxDebug()) {
    console.log(
      `${LOG_PREFIX}(${kind})`,
      `\n  PIXI / Foundry : ${PIXI.VERSION ?? "?"} / ${game?.version ?? "?"}`,
      `\n  actor          : ${token.actor?.name ?? "?"}`,
      `\n  enabled        : ${settings?.enabled}${opts.isPreview ? " (preview — gate bypassed)" : ""}`,
      `\n  emitters       : ${emitters.length} [${emitters.map(a => a.layer ?? "above").join(", ")}]`,
      `\n  layer          : ${parent?.constructor?.name ?? "none"}  sortable: ${parent?.sortableChildren}`,
      `\n  zIndex         : ${sources.map(s => s.container.zIndex).join(", ")}`,
      `\n  blendMode      : ${String(blend)}`,
      `\n  first head     : ${JSON.stringify(shipEngineEmitterToCanvasPoint(token, emitters[0]))}`,
    );
  }

  const startedAt = performance.now();
  let prevNow = startedAt;
  let forceStop = false;

  const cleanup = () => {
    try { canvas.app.ticker.remove(tick); } catch { /* no-op */ }
    for (const source of sources) {
      // Destroy the container (removes it from the layer) along with its Graphics.
      try { source.container.destroy({ children: true }); } catch { /* no-op */ }
    }
  };

  function tick() {
    const now = performance.now();
    const dt = Math.min(now - prevNow, 50);
    prevNow = now;
    const dtSec = dt / 1000;
    const elapsed = now - startedAt;
    const emitting = !forceStop && elapsed < emitDuration;

    let liveNodes = 0;
    for (const source of sources) {
      const sampleToken = typeof opts.sampleToken === "function"
        ? (opts.sampleToken(source.anchor, elapsed, token) ?? token)
        : token;
      const head = shipEngineEmitterToCanvasPoint(sampleToken, source.anchor);
      const angle = _degToRad(shipEngineFacingToCanvasDeg(sampleToken, source.anchor.facingDeg));
      const vx = drift ? Math.cos(angle) * speed : 0;
      const vy = drift ? Math.sin(angle) * speed : 0;

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
  return {
    stop() { forceStop = true; },
    cleanup,
  };
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
