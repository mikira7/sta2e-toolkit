/**
 * sta2e-toolkit | deflector-vfx.js
 *
 * The navigational deflector dish. Four looks, all driven from one placed
 * emitter and one per-ship settings block authored in the Ship VFX Anchor
 * editor (Deflector tab):
 *
 *   chargeGlow  tiny motes are drawn in from open space ahead of the ship,
 *               straight down a cone into the dish, which brightens as it fills
 *   pulse       a crescent wave — a smooth luminous front with a turbulent fog
 *               tail shed behind it — swelling and slowing as it crosses
 *   beam        several lances fanned across the target area, held then released
 *   stream      a translucent column to a target with motes running inside it
 *
 * Only chargeGlow is aimless; the other three take a target point (a targeted
 * token, or a canvas click) from whichever surface fired them.
 *
 * Purely cosmetic: no roll, no Power cost, no chat card, no rules hook. The
 * engine trail is the contract this matches.
 *
 * Modelled on engine-trail-vfx.js — same layer rule (canvas.tokens, never
 * canvas.primary), same dt clamp, same setTimeout backstop, same never-silent
 * bail-outs. See the foundry-vfx skill for the PIXI patterns underneath. This
 * install runs PIXI 7.4.3 on Foundry v14, so every shim here is written v7-first
 * with a v8 fallback and branches on capability, never on a version number.
 */

import {
  getShipDeflectorEmitters,
  getShipDeflectorSettings,
  normalizeShipDeflectorSettings,
  resolveDeflectorColorHex,
  shipDeflectorEmitterToCanvasPoint,
  shipEngineFacingToCanvasDeg,
} from "./ship-vfx-anchors.js";
import {
  VFX_Z_BASE,
  addBlend,
  buildRadialTexture,
  effectLayer,
  lighten,
  parseHexColor,
} from "./starfield-common.js";
import { createBeamRibbon } from "./beam-shader.js";
import { createDeflectorField } from "./deflector-shader.js";

const MODULE = "sta2e-toolkit";
const LOG_PREFIX = "sta2e-toolkit | Deflector";

export const DEFLECTOR_VFX_ACTION = "deflectorVfx";
export const STOP_DEFLECTOR_VFX_ACTION = "stopDeflectorVfx";

/** Types that hold until stopped, rather than running a fixed burst. */
const SUSTAINED_TYPES = Object.freeze(["chargeGlow", "beam"]);
/** Types that need a point to aim at. */
const TARGETED_TYPES = Object.freeze(["pulse", "beam", "stream"]);

// Anti-stuck cap on the two sustained types. A client that never receives the
// stop must not hold a charge glow for the rest of the session. Same reasoning
// as playWarpChargeGlow's peakHoldMs, and set long enough that a GM using it
// deliberately never trips it.
const SUSTAIN_HOLD_MS = 90_000;
// How long a PREVIEW of a sustained effect holds before releasing itself.
const PREVIEW_HOLD_MS = 2600;
const CHARGE_FADE_MS = 420;
const MAX_PARTICLES = 400;

// World-setting sound keys, one per type. Played LOCALLY on every client (see
// _playTypeSound) rather than broadcast.
const SOUND_KEYS = Object.freeze({
  chargeGlow: "sndDeflectorCharge",
  pulse: "sndDeflectorPulse",
  beam: "sndDeflectorBeam",
  stream: "sndDeflectorStream",
});

// ── PIXI compatibility shims ────────────────────────────────────────────────
function _blendMode(mode) {
  if (mode === "normal") {
    return typeof PIXI?.BLEND_MODES?.NORMAL === "number" ? PIXI.BLEND_MODES.NORMAL : "normal";
  }
  return addBlend();
}

/** A single line segment with round caps, under either Graphics API. */
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

/** A filled polygon from a flat [x, y, ...] array, under either Graphics API. */
function _fillPoly(g, pts, color, alpha) {
  if (alpha <= 0 || pts.length < 6) return;
  if (typeof g.beginFill === "function") {
    g.beginFill(color, alpha);
    g.drawPolygon(pts);
    g.endFill();
  } else {
    g.poly(pts);
    g.fill({ color, alpha });
  }
}

/**
 * A crescent centred on (cx, cy), bowed toward `heading`: a filled lens built
 * from an outer arc of radius `r` and an inner arc pulled back by a thickness
 * that TAPERS TO ZERO at the tips.
 *
 * The taper is the whole point. A constant-width stroked arc has blunt ends and
 * reads as a piece of a circle; a shockwave front is thickest at the centre and
 * comes to points, which is what the (1 - u^2) profile gives. Nothing in the
 * Graphics API draws that, so it is built as a polygon — `strokePolyline` in
 * starfield-common.js could not help here for the same reason.
 *
 * Deliberately no bright spine: the pulse draws its light as a band of soft
 * additive blobs over this, and a crisp arc laid through fog reads as a drawn
 * line rather than as energy. This lens is only the faint body underneath.
 */
function _drawCrescent(g, cx, cy, r, heading, sweep, thickness, color, alpha) {
  if (!(r > 0) || !(thickness > 0)) return;
  // Enough segments to stay smooth at any size, capped so a huge late-flight
  // crescent cannot run the vertex count away.
  const steps = Math.max(24, Math.min(192, Math.ceil(sweep * Math.sqrt(r / 0.8))));
  const half = sweep / 2;
  const outer = [];
  const inner = [];
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * 2 - 1;                     // -1 .. 1 across the arc
    const a = heading + u * half;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Taper to points at both tips.
    const w = thickness * (sweep >= Math.PI * 1.995 ? 1 : Math.pow(Math.max(0, 1 - u * u), 0.6));
    outer.push(cx + ca * r, cy + sa * r);
    inner.push(cx + ca * (r - w), cy + sa * (r - w));
  }
  // Outer arc forward, inner arc back — one closed lens.
  const poly = outer.slice();
  for (let i = inner.length - 2; i >= 0; i -= 2) poly.push(inner[i], inner[i + 1]);
  if (alpha > 0) _fillPoly(g, poly, color, alpha);
}

// ── Textures ────────────────────────────────────────────────────────────────
// Module-level lazy singletons, NEVER destroyed with a container: they are
// shared by every live effect, and destroying one would blank all the others.
let _radialTex = null;

function _radial() {
  if (!_radialTex || _radialTex.destroyed) _radialTex = buildRadialTexture();
  return _radialTex;
}

// ── Small helpers ───────────────────────────────────────────────────────────
function _num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function _resolveToken(tokenOrDoc) {
  if (!tokenOrDoc) return null;
  if (tokenOrDoc.object) return tokenOrDoc.object;              // TokenDocument -> placeable
  if (tokenOrDoc.center || tokenOrDoc.mesh) return tokenOrDoc;  // already a placeable
  return canvas?.tokens?.get?.(tokenOrDoc.id) ?? null;
}

/** Bail-outs always warn — "nothing happened" must never be untriageable. */
function _abort(type, reason, detail = null) {
  console.warn(`${LOG_PREFIX}(${type}) aborted — ${reason}`, detail ?? "");
  return null;
}

/**
 * "below" is a negative zIndex within the token layer, the same expression
 * engine-trail-vfx.js uses. canvas.tokens sits above canvas.primary, so a large
 * positive zIndex beats every token sprite.
 */
function _zIndexFor(token, layerName) {
  const tokenZ = typeof token?.zIndex === "number" ? token.zIndex : 0;
  return layerName === "below"
    ? -VFX_Z_BASE + tokenZ
    : Math.max(VFX_Z_BASE, tokenZ + 10_000);
}

function _glowFilter(color, size) {
  if (!(size > 0)) return null;
  try {
    const GF = PIXI.filters?.GlowFilter ?? globalThis.PIXI?.filters?.GlowFilter;
    if (!GF) return null;
    return new GF({ distance: size, outerStrength: 1.6, innerStrength: 0.4, color, quality: 0.3 });
  } catch {
    return null;
  }
}

function _sprite(parent, texture, tint, blend, anchorX = 0.5, anchorY = 0.5) {
  const s = new PIXI.Sprite(texture);
  s.anchor.set(anchorX, anchorY);
  // Tint is written HERE and on recycle only. The setter converts a colour on
  // every write, and a per-frame tint across a few hundred sprites is exactly
  // the cost CLAUDE.md warns about for the star fields. Alpha, by contrast, IS
  // written per frame: the fade along a mote's path is the effect itself, and
  // these pools are two orders of magnitude smaller than a star field.
  s.tint = tint;
  s.blendMode = blend;
  s.visible = false;
  parent.addChild(s);
  return s;
}

/** Live canvas points for the placed emitters, dropping any that cannot resolve. */
function _emitterPoints(token, emitters) {
  const out = [];
  for (const anchor of emitters) {
    const point = shipDeflectorEmitterToCanvasPoint(token, anchor);
    if (point) out.push({ ...point, anchor });
  }
  return out;
}

/** The emitter that bears most directly on the target; the dish nearest it. */
function _nearestEmitter(points, target) {
  if (!points.length) return null;
  if (!target) return points[0];
  let best = points[0];
  let bestD = Infinity;
  for (const p of points) {
    const d = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/**
 * Local-only playback. Every client runs playDeflectorEffect for itself off the
 * broadcast, so AudioHelper's own broadcast flag must be false here — with it
 * true, one fire would multiply by the number of connected clients.
 */
function _playTypeSound(type) {
  try {
    const key = SOUND_KEYS[type];
    if (!key) return;
    const src = String(game.settings.get(MODULE, key) ?? "").trim();
    if (!src) return;
    const AudioHelper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
    AudioHelper?.play({ src, volume: 0.8, autoplay: true, loop: false }, false);
  } catch { /* cosmetic — a missing sound never blocks the effect */ }
}

// ── Live instances ──────────────────────────────────────────────────────────
// One effect per token: firing again replaces whatever was running, so a
// double-click cannot stack two charge glows. Mirrors _warpChargeInstances.
const _instances = new Map();   // tokenId -> {handle, sustained, type}

function _register(tokenId, handle, sustained, type) {
  if (!tokenId) return handle;
  _instances.get(tokenId)?.handle?.cleanup?.();
  _instances.set(tokenId, { handle, sustained, type });
  return handle;
}

function _unregister(tokenId, handle) {
  if (_instances.get(tokenId)?.handle === handle) _instances.delete(tokenId);
}

/**
 * Whether a SUSTAINED effect is running — what the HUD's Stop row reads.
 *
 * The optional type filter is what lets the HUD's Stream row be a toggle: a held
 * charge glow must not make it read "Stop Stream". Callers that only care whether
 * *something* is held pass no type, as they always did.
 */
export function hasLiveDeflectorEffect(tokenId, type = null) {
  const live = _instances.get(tokenId);
  return live?.sustained === true && (!type || live.type === type);
}

/** Stop whatever this token is running. Safe to call when nothing is. */
export function stopDeflectorEffect(tokenId) {
  const live = _instances.get(tokenId);
  if (!live) return false;
  try { live.handle?.stop?.(); } catch { /* already torn down */ }
  return true;
}

/**
 * Fire a deflector effect on this client only.
 *
 * @param {Token|TokenDocument} tokenOrDoc
 * @param {"chargeGlow"|"pulse"|"beam"|"stream"} type
 * @param {object} [opts]
 * @param {object}   [opts.settings]   Full deflector settings block; defaults to the saved one.
 * @param {object[]} [opts.emitters]   Emitter anchors; defaults to the saved ones.
 * @param {{x:number,y:number}} [opts.target]  Required for pulse and beam.
 * @param {number}   [opts.durationMs] Overrides the type's own duration.
 * @param {boolean}  [opts.hold]       STREAM ONLY: latch it on until stopped, ignoring
 *                                     durationMs. The other three renderers ignore it.
 * @param {boolean}  [opts.isPreview]  Bypasses the enabled gate and plays no sound.
 * @returns {{stop:Function, cleanup:Function}|null}
 */
export function playDeflectorEffect(tokenOrDoc, type, opts = {}) {
  const token = _resolveToken(tokenOrDoc);
  if (!token) return _abort(type, "could not resolve a canvas token", tokenOrDoc);
  if (typeof PIXI === "undefined") return _abort(type, "PIXI is not available");
  if (!canvas?.app?.ticker) return _abort(type, "canvas.app.ticker is not available");

  const settings = opts.settings
    ? normalizeShipDeflectorSettings(opts.settings)
    : getShipDeflectorSettings(token);
  if (!settings?.enabled && !opts.isPreview) {
    return _abort(type, "the deflector is disabled for this ship "
      + "(Ship VFX Anchor editor -> Deflector tab -> Enabled), actor: " + (token.actor?.name ?? "?"));
  }

  const mode = settings?.[type];
  if (!mode) return _abort(type, "unknown deflector effect type", Object.keys(settings ?? {}));

  const emitters = (opts.emitters && opts.emitters.length)
    ? opts.emitters
    : getShipDeflectorEmitters(token);
  if (!emitters.length) {
    return _abort(type, "no deflector emitter placed on this ship, actor: " + (token.actor?.name ?? "?"));
  }

  const target = opts.target ?? null;
  if (TARGETED_TYPES.includes(type)
    && !(Number.isFinite(target?.x) && Number.isFinite(target?.y))) {
    return _abort(type, "this effect needs a target point", target);
  }

  const parent = effectLayer();
  if (!parent) return _abort(type, "no canvas layer available to parent the effect");

  const color = parseHexColor(resolveDeflectorColorHex(token, type, mode), 0x6fb6ff);
  const coreColor = lighten(color, 0.55);
  const blend = _blendMode(mode.blendMode);
  const durationMs = Math.max(120, _num(opts.durationMs, mode.durationMs));
  const hold = opts.hold === true;
  const ctx = { token, parent, mode, color, coreColor, blend, durationMs, target, emitters, hold };

  let handle = null;
  try {
    if (type === "chargeGlow") handle = _runChargeGlow(ctx);
    else if (type === "pulse") handle = _runPulse(ctx);
    else if (type === "beam") handle = _runBeam(ctx);
    else if (type === "stream") handle = _runStream(ctx);
  } catch (err) {
    return _abort(type, "renderer threw", err);
  }
  if (!handle) return _abort(type, "the renderer produced nothing to draw");

  if (!opts.isPreview) _playTypeSound(type);

  const tokenId = token.document?.id ?? token.id ?? null;
  handle.onDone = () => _unregister(tokenId, handle);
  return _register(tokenId, handle, SUSTAINED_TYPES.includes(type) || hold, type);
}

/**
 * Stop here and on every other client. The counterpart of the handle returned
 * by broadcastDeflectorEffect, for callers that only have a token id — the HUD's
 * Stop row is rebuilt from scratch and no longer holds the original handle.
 */
export function broadcastStopDeflectorEffect(tokenId) {
  stopDeflectorEffect(tokenId);
  if (!tokenId) return;
  try {
    game.socket.emit(`module.${MODULE}`, { action: STOP_DEFLECTOR_VFX_ACTION, tokenId });
  } catch { /* cosmetic */ }
}

/**
 * Editor preview. Takes the (possibly unsaved) settings and emitter points as
 * ARGUMENTS, exactly as previewEngineTrail does, so the editor never has to
 * persist the flag first to see what it is dragging.
 *
 * A preview is always a BURST, even for the two sustained types: the editor
 * fires one on every slider change, and a charge glow that holds would sit lit
 * on the canvas until the GM went looking for the Stop row. Same reasoning as
 * the warp-glow preview's own stop timer.
 */
export function previewDeflectorEffect(tokenOrDoc, type, settings, emitters, target = null) {
  const handle = playDeflectorEffect(tokenOrDoc, type, {
    settings,
    emitters,
    target,
    isPreview: true,
  });
  if (handle && SUSTAINED_TYPES.includes(type)) {
    setTimeout(() => { try { handle.stop?.(); } catch { /* already gone */ } }, PREVIEW_HOLD_MS);
  }
  return handle;
}

/**
 * Play here, then mirror to every other client.
 *
 * Foundry sockets do not loop back, so the local play comes FIRST. The emit is
 * the raw socket rather than emitToolkitSocket, which re-runs the handler
 * locally on the responsible GM and would draw the effect twice there.
 */
export function broadcastDeflectorEffect(tokenOrDoc, type, opts = {}) {
  const token = _resolveToken(tokenOrDoc);
  const tokenId = token?.document?.id ?? token?.id ?? null;
  const local = playDeflectorEffect(token, type, opts);

  if (tokenId) {
    try {
      game.socket.emit(`module.${MODULE}`, {
        action: DEFLECTOR_VFX_ACTION,
        tokenId,
        // The SOURCE TOKEN'S scene, not this client's viewed scene: a GM parked
        // elsewhere would otherwise stamp the wrong id and every correctly
        // parked observer would discard the effect on its own scene guard.
        sceneId: token?.document?.parent?.id ?? canvas?.scene?.id ?? null,
        type,
        // Coordinates, not a token id — a remote client may not have the target
        // token, and these two effects only ever need a point.
        targetX: Number.isFinite(opts.target?.x) ? opts.target.x : null,
        targetY: Number.isFinite(opts.target?.y) ? opts.target.y : null,
        durationMs: Number.isFinite(opts.durationMs) ? opts.durationMs : null,
        // Not a look setting — an instruction about this firing. Without it a
        // remote client runs the burst and goes dark at durationMs while the
        // firing client's column is still held up.
        hold: opts.hold === true,
      });
    } catch { /* cosmetic — never block on the socket */ }
  }

  return {
    stop() {
      local?.stop?.();
      if (!tokenId) return;
      try {
        game.socket.emit(`module.${MODULE}`, { action: STOP_DEFLECTOR_VFX_ACTION, tokenId });
      } catch { /* cosmetic */ }
    },
  };
}

// ── Shared runner scaffolding ───────────────────────────────────────────────
/**
 * Every runner is a ticker loop over one or more containers with the same
 * teardown: drop the ticker, RELEASE THE FILTERS EXPLICITLY (a filter is not
 * destroyed by container.destroy(), which is the whole reason warp-jump-vfx.js
 * carries its own filter cleanup), destroy the containers, and leave the shared
 * textures alone.
 */
function _makeRunner({ containers, filters = [], tick, totalMs, onCleanup }) {
  let finished = false;
  let backstop = null;
  const handle = { onDone: null };

  const cleanup = () => {
    if (finished) return;
    finished = true;
    try { canvas.app.ticker.remove(step); } catch { /* no-op */ }
    if (backstop) { clearTimeout(backstop); backstop = null; }
    try { onCleanup?.(); } catch { /* no-op */ }
    // Detach before destroying: a filter is not destroyed by its container, and
    // destroying one still attached leaves the container pointing at dead GL
    // resources for however long it survives.
    for (const c of containers) {
      try { c.filters = []; } catch { /* no-op */ }
    }
    for (const f of filters) {
      try { f.destroy?.(); } catch { /* no-op */ }
    }
    for (const c of containers) {
      try { c.destroy({ children: true }); } catch { /* no-op */ }
    }
    try { handle.onDone?.(); } catch { /* no-op */ }
  };

  let prevNow = performance.now();
  function step() {
    if (finished) return;
    const now = performance.now();
    // Clamped so a tab switch cannot advance the effect by seconds in one frame.
    const dt = Math.min(now - prevNow, 50);
    prevNow = now;
    let alive = true;
    try { alive = tick(now, dt) !== false; }
    catch (err) { console.warn(`${LOG_PREFIX} tick failed:`, err); alive = false; }
    if (!alive) cleanup();
  }

  canvas.app.ticker.add(step);
  // Hard stop in case the ticker callback is starved. A HELD effect passes
  // Infinity instead: it ends on stop(), on its token being destroyed, or on
  // canvasTearDown, and never on a clock. The finite guard is load-bearing —
  // setTimeout(fn, Infinity) fires on the NEXT TICK rather than never.
  if (Number.isFinite(totalMs)) backstop = setTimeout(cleanup, Math.max(1000, totalMs) + 2000);
  handle.cleanup = cleanup;
  return handle;
}

// ── chargeGlow ──────────────────────────────────────────────────────────────
/**
 * A cone opens along the dish's facing and draws tiny motes down it into the
 * dish, which brightens as the charge builds. Sustained: it HOLDS at peak until
 * stopped. The emitter point and facing are re-read every frame, so the cone
 * stays bolted to a hull that is moving or turning.
 *
 * A mote rides a STRAIGHT RAY to the apex. It holds a fixed lateral fraction
 * `u` (-1..1 across the cone) and a distance `along` that runs down to zero;
 * its offset from the axis is `u * along * tan(coneHalf)`, which is exactly the
 * cone wall scaled by how far down it still is — so the path is a line, and it
 * cannot leave the cone.
 *
 * An earlier version instead held a fixed ANGLE and shrank the radius, which
 * seeds every mote on a circular arc and sweeps each one through a curve: the
 * field read as motes orbiting the ship rather than being drawn in from the
 * space ahead of it. There is deliberately **no swirl dial** — it was tried and
 * it is exactly the wrong read for an intake.
 */
function _runChargeGlow({ token, parent, mode, color, coreColor, blend, durationMs, emitters }) {
  const reach = Math.max(8, _num(mode.radiusPx, 420));
  const coneHalf = _degToRad(Math.max(2, _num(mode.coneDeg, 44)) / 2);
  const tanCone = Math.tan(coneHalf);
  const coneAlpha = Math.max(0, Math.min(1, _num(mode.coneAlpha, 0.14)));
  const rate = Math.max(4, _num(mode.rate, 200));
  const peakAlpha = Math.max(0, Math.min(1, _num(mode.alpha, 0.85)));
  const moteLifeMs = 1400;
  const moteSize = Math.max(1, _num(mode.width, 3));

  const tex = _radial();
  const scale = moteSize / (tex.width || 128);
  const sources = [];
  const containers = [];
  const filters = [];
  const perEmitter = Math.max(1, Math.min(Math.floor(MAX_PARTICLES / emitters.length), Math.round(rate * moteLifeMs / 1000)));

  for (const anchor of emitters) {
    const layerName = anchor.layer === "below" ? "below" : "above";
    const container = new PIXI.Container();
    container.zIndex = _zIndexFor(token, layerName);
    container.alpha = 0;
    parent.addChild(container);
    containers.push(container);

    // The faint cone body, under the motes so they read as being inside it.
    const wedge = new PIXI.Graphics();
    wedge.blendMode = blend;
    container.addChild(wedge);
    const field = createDeflectorField(container, "charge", { color, coreColor, blend });
    if (!field) {
      const glow = _glowFilter(color, _num(mode.glowSize, 22));
      if (glow) { container.filters = [glow]; filters.push(glow); }
    }

    const motes = [];
    for (let i = 0; i < perEmitter; i++) {
      const s = _sprite(container, tex, color, blend);
      s.scale.set(scale);
      motes.push({
        sprite: s,
        // Lateral place across the cone, as a fraction of the wall.
        u: Math.random() * 2 - 1,
        // How far down the cone it enters, so the intake face is not a hard line.
        depth: 0.72 + Math.random() * 0.28,
        // Spread through one lifetime so the cone is full from the first frame.
        age: (i / perEmitter) * moteLifeMs,
      });
    }
    // The dish itself, brightest at full charge, drawn over everything.
    const core = _sprite(container, tex, coreColor, blend);
    core.visible = true;
    const halo = _sprite(container, tex, color, blend);
    halo.visible = true;
    const flare = _sprite(container, tex, coreColor, blend);
    flare.visible = true;
    sources.push({ anchor, container, wedge, field, motes, core, halo, flare });
  }

  const startedAt = performance.now();
  let stoppingAt = 0;

  const runner = _makeRunner({
    containers,
    filters,
    totalMs: durationMs + SUSTAIN_HOLD_MS + CHARGE_FADE_MS,
    tick(now, dt) {
      const elapsed = now - startedAt;
      if (!stoppingAt && elapsed > durationMs + SUSTAIN_HOLD_MS) stoppingAt = now;

      let envelope = Math.min(1, elapsed / durationMs);
      if (stoppingAt) {
        const f = (now - stoppingAt) / CHARGE_FADE_MS;
        if (f >= 1) return false;
        // A short brighten as the charge releases, then away.
        envelope = f < 0.25 ? 1 + 0.3 * (f / 0.25) : (1 - (f - 0.25) / 0.75);
      }
      const env = Math.max(0, envelope);

      for (const source of sources) {
        const head = shipDeflectorEmitterToCanvasPoint(token, source.anchor);
        source.container.alpha = peakAlpha * env;
        if (!head) { source.container.visible = false; continue; }
        source.container.visible = true;
        const axis = _degToRad(shipEngineFacingToCanvasDeg(token, source.anchor.facingDeg));

        source.core.position.set(head.x, head.y);
        const charge = Math.min(1, env);
        const breath = 0.96 + 0.04 * Math.sin(elapsed * 0.004);
        const coreSize = moteSize * (3 + 5 * charge) * breath;
        source.core.scale.set(coreSize / tex.width);
        source.halo.position.set(head.x, head.y);
        source.halo.scale.set((coreSize * 3 + _num(mode.glowSize, 22)) / tex.width);
        source.halo.alpha = 0.28 * charge;
        source.flare.position.set(head.x, head.y);
        source.flare.rotation = axis + Math.PI / 2;
        source.flare.scale.set(coreSize * 5 / tex.width, coreSize * 0.2 / tex.width);
        source.flare.alpha = 0.4 * charge * charge;

        // Axis and its perpendicular, so a mote's place is (along, lateral)
        // rather than an angle — which is what makes its path a straight line.
        const ax = Math.cos(axis);
        const ay = Math.sin(axis);
        const pxv = -ay;
        const pyv = ax;

        // The wedge: apex on the dish, walls running out along the cone. Drawn
        // from the same tan(coneHalf) the motes use, so the two cannot disagree.
        // Redrawn each frame because the hull it hangs off can move under it.
        const g = source.wedge;
        g.clear();
        source.field?.update(head.x, head.y, axis, reach, 2 * reach * tanCone,
          elapsed / 1000, 1, 1, 1, 1, 1, coneAlpha);
        if (!source.field && coneAlpha > 0) {
          const pts = [head.x, head.y];
          const STEPS = 8;
          for (let i = 0; i <= STEPS; i++) {
            const u = (i / STEPS) * 2 - 1;
            // A slight forward bow across the mouth, so it does not read as a
            // flat-topped triangle.
            const along = reach * (1 + 0.06 * (1 - u * u));
            const lat = u * along * tanCone;
            pts.push(head.x + ax * along + pxv * lat, head.y + ay * along + pyv * lat);
          }
          _fillPoly(g, pts, color, coneAlpha * env);
        }

        for (const mote of source.motes) {
          mote.age += dt;
          if (mote.age >= moteLifeMs) {
            mote.age -= moteLifeMs;
            mote.u = Math.random() * 2 - 1;
            mote.depth = 0.72 + Math.random() * 0.28;
          }
          const t = mote.age / moteLifeMs;
          // Straight in: both terms fall to zero together, so the mote runs down
          // a ray from where it entered the wall to the dish itself.
          const along = reach * mote.depth * (1 - t * t);
          const lateral = mote.u * along * tanCone;
          const ox = ax * along + pxv * lateral;
          const oy = ay * along + pyv * lateral;
          const s = mote.sprite;
          s.visible = true;
          s.position.set(head.x + ox, head.y + oy);
          s.rotation = Math.atan2(oy, ox);
          s.scale.set(scale * (1 + t * t * 3.5), scale * (0.65 + 0.35 * t));
          // In at the mouth, swallowed at the dish. Per-frame alpha is
          // deliberate — see _sprite.
          s.alpha = Math.min(1, t * 4) * Math.min(1, (1 - t) * 8);
        }
      }
      return true;
    },
  });

  runner.stop = () => { if (!stoppingAt) stoppingAt = performance.now(); };
  return runner;
}

// ── pulse ───────────────────────────────────────────────────────────────────
/**
 * A crescent wave that leaves the dish, then SWELLS and SLOWS as it crosses to
 * the target. The deceleration is an ease-out on the same parameter that drives
 * the radius, so the two cannot drift apart.
 *
 * It is drawn as TWO layers, and the split is the whole look:
 *
 *   front   a smooth luminous edge — nested lens fills sharing one outer arc and
 *           shrinking inward, so additive stacking peaks at the leading edge and
 *           falls away behind it, with two wider faint lenses *outside* that arc
 *           for bloom. No noise anywhere near it: the front is the clean, solid
 *           part of the wave and any jitter on it reads as a smudge.
 *   tail    turbulent fog SHED BEHIND the front — soft blobs scattered through a
 *           band that starts inside the front and runs back, whiter than the
 *           front, wider in sweep, churning, and lagging further the faster the
 *           wave is still travelling.
 *
 * An earlier version laid the haze *on* the arc, which fuzzed the leading edge
 * and left the wave with no front at all — the thing that makes it read as a
 * shockwave rather than a cloud is that one edge is clean.
 *
 * The taper is what makes it a crescent rather than a piece of a circle: the
 * lens thickness and the tail density both fall to nothing at the tips, on the
 * same (1 - u^2) profile, so the front is thickest at its nose and comes to
 * points.
 */
function _runPulse({ token, parent, mode, color, coreColor, blend, durationMs, target, emitters }) {
  const points = _emitterPoints(token, emitters);
  const origin = _nearestEmitter(points, target);
  if (!origin) return null;

  const layerName = origin.layer === "below" ? "below" : "above";
  const container = new PIXI.Container();
  container.zIndex = _zIndexFor(token, layerName);
  parent.addChild(container);

  const filters = [];

  // The tail goes in first so every blob draws UNDER the front edge — the front
  // has to stay the clean, bright thing in the composition.
  const tailLayer = new PIXI.Container();
  container.addChild(tailLayer);
  const g = new PIXI.Graphics();
  g.blendMode = blend;
  container.addChild(g);

  const radius = Math.max(4, _num(mode.radiusPx, 90));
  const sweep = _degToRad(Math.max(10, _num(mode.arcDeg, 120)));
  const crescents = Math.max(1, Math.round(_num(mode.ringCount, 1)));
  const expandTo = Math.max(1, _num(mode.expandTo, 3.2));
  const width = Math.max(1, _num(mode.width, 18));
  const peakAlpha = Math.max(0, Math.min(1, _num(mode.alpha, 0.9)));
  const tailLen = Math.max(0, _num(mode.tailLength, 4)) * width;
  const tailAlpha = Math.max(0, Math.min(1, _num(mode.tailAlpha, 0.5)));
  const stagger = 0.12;

  // The front's profile: nested lenses sharing an outer arc. The two negative
  // entries sit OUTSIDE it and supply the bloom that stops the leading edge
  // reading as a cut polygon.
  const FRONT = Object.freeze([
    { out: 0.50, thick: 0.60, a: 0.05 },
    { out: 0.22, thick: 0.55, a: 0.09 },
    { out: 0.00, thick: 1.00, a: 0.16 },
    { out: 0.00, thick: 0.66, a: 0.20 },
    { out: 0.00, thick: 0.40, a: 0.24 },
    { out: 0.00, thick: 0.20, a: 0.28 },
    { out: 0.00, thick: 0.08, a: 0.34 },
  ]);

  const tex = _radial();
  const texW = tex.width || 128;
  // Enough blobs to merge into cloud at these sizes; the sweep drives it because
  // a wider crescent has more arc to fill.
  const perArc = Math.max(14, Math.min(56, Math.round(sweep * 18)));
  const arcs = [];
  const fields = [];
  for (let i = 0; i < crescents; i++) {
    const field = createDeflectorField(container, "pulse", { color, coreColor, blend });
    fields.push(field);
    const nodes = [];
    const budget = field ? 0 : Math.min(perArc, Math.floor(MAX_PARTICLES / crescents));
    for (let n = 0; n < budget; n++) {
      nodes.push({
        sprite: _sprite(tailLayer, tex, coreColor, blend),
        // Place along the arc, then nudge so the band is not a tidy curve.
        u: budget === 1 ? 0 : (n / (budget - 1)) * 2 - 1,
        jitterU: (Math.random() - 0.5) * 0.16,
        // How deep into the tail this blob sits, biased toward the front so the
        // fog is densest just behind the edge and thins out backwards.
        depth: Math.pow(Math.random(), 0.7),
        jitterR: (Math.random() - 0.5) * 0.9,
        // A wide size spread is what reads as filaments rather than as a row of
        // identical puffs.
        size: 0.35 + Math.pow(Math.random(), 1.6) * 1.5,
        phase: Math.random() * Math.PI * 2,
        churnRate: 180 + Math.random() * 220,
      });
    }
    arcs.push(nodes);
  }
  if (fields.some(f => !f)) {
    const glow = _glowFilter(color, _num(mode.glowSize, 20));
    if (glow) { container.filters = [glow]; filters.push(glow); }
  }

  const startedAt = performance.now();
  let forceStop = false;

  const runner = _makeRunner({
    containers: [container],
    filters,
    totalMs: durationMs * (1 + stagger * Math.max(0, crescents - 1)) + 400,
    tick(now) {
      const t = (now - startedAt) / durationMs;
      if (t >= 1 + stagger * crescents || forceStop) return false;

      // Once launched, a free wave keeps its trajectory as the source moves.
      const from = origin;
      const heading = Math.atan2(target.y - from.y, target.x - from.x);
      const half = sweep / 2;
      const hx = Math.cos(heading);
      const hy = Math.sin(heading);

      g.clear();
      for (let i = 0; i < crescents; i++) {
        const nodes = arcs[i];
        const rt = t - i * stagger;
        if (rt < 0 || rt > 1) {
          if (fields[i]) fields[i].mesh.visible = false;
          for (const node of nodes) node.sprite.visible = false;
          continue;
        }
        // Ease-out: most of the distance goes early, so the wave visibly slows
        // as it swells into the target.
        const e = 1 - Math.pow(1 - rt, 2.6);
        // What is left of the travel speed, for the tail's lag.
        const speed = Math.pow(1 - rt, 1.6);
        const cx = from.x + (target.x - from.x) * e;
        const cy = from.y + (target.y - from.y) * e;
        const r = radius * (1 + (expandTo - 1) * e);
        const fade = Math.min(1, rt * 7) * Math.pow(Math.max(0, 1 - rt), 0.65);
        const a = peakAlpha * fade * (1 - i / (crescents + 1.5));
        // The front thins as the wave spreads, the way a real one would.
        const thick = width * (1.25 - 0.45 * e);
        const field = fields[i];
        if (field) {
          field.mesh.visible = true;
          const extent = (r + thick * 4 + _num(mode.glowSize, 20)) * 2;
          field.update(cx, cy, heading, extent, extent, (now - startedAt) / 1000,
            a, r, thick, sweep, tailLen * (0.75 + 0.45 * e), tailAlpha,
            _num(mode.glowSize, 20) / Math.max(1, thick));
          continue;
        }

        // ── the front ──────────────────────────────────────────────────────
        for (const layer of FRONT) {
          _drawCrescent(g, cx, cy, r + thick * layer.out, heading, sweep,
            thick * layer.thick, layer.thick <= 0.2 ? coreColor : color, a * layer.a);
        }

        // ── the tail ───────────────────────────────────────────────────────
        // Shed behind the front, and dragged further back the faster the wave
        // is still moving — so it stretches on the way out and gathers up as it
        // slows into the target.
        const lag = tailLen * 0.22 * speed;
        const tx = cx - hx * lag;
        const ty = cy - hy * lag;
        const reach = tailLen * (0.75 + 0.45 * e);
        for (const node of nodes) {
          // The tail wraps a little wider than the front, so it looks like
          // material spilling round the edges rather than a second arc.
          const u = Math.max(-1.08, Math.min(1.08, (node.u + node.jitterU) * 1.1));
          const taper = Math.pow(Math.max(0, 1 - (u / 1.08) * (u / 1.08)), 0.55);
          if (taper <= 0.001) { node.sprite.visible = false; continue; }
          const churn = 0.7 + 0.3 * Math.sin(now / node.churnRate + node.phase);
          const ang = heading + u * half;
          // Starts just inside the front edge and runs back from there.
          const rr = r - thick * 0.35 - node.depth * reach + node.jitterR * thick;
          if (rr <= 0) { node.sprite.visible = false; continue; }
          // Disperses as it falls behind, the way shed vapour does.
          const size = thick * node.size * (0.9 + node.depth * 1.9) * taper * churn;
          const sp = node.sprite;
          sp.visible = true;
          sp.position.set(tx + Math.cos(ang) * rr, ty + Math.sin(ang) * rr);
          sp.scale.set(size / texW);
          // Thins backwards, so the tail dissolves rather than ending.
          sp.alpha = a * tailAlpha * taper * churn * (1 - node.depth * 0.75) * 0.55;
        }
      }
      return true;
    },
  });

  runner.stop = () => { forceStop = true; };
  return runner;
}

// ── beam ────────────────────────────────────────────────────────────────────
/**
 * Several lances fanned across the target area. The fan is applied by rotating
 * each endpoint about the DISH, so the lances converge at the emitter and spread
 * where they land — which is what "at the target area" means, and what a single
 * rotated bundle would not give.
 *
 * createBeamRibbon is the module's own shader beam and fits here without
 * argument, but it returns null whenever beamShaderAvailable() is false, so the
 * two-pass Graphics fallback is mandatory exactly as at every other call site.
 * Both paths are re-placed every frame from a re-read emitter point, so the
 * lances track a hull under way and the two paths cannot drift apart.
 *
 * Each lance sits in its OWN sub-container: that is what lets a per-beam flicker
 * be one alpha write, and it works for the shader too, because the beam shader's
 * _preRender copies mesh.worldAlpha into uAlpha.
 */
function _runBeam({ token, parent, mode, color, coreColor, blend, durationMs, target, emitters }) {
  const points = _emitterPoints(token, emitters);
  const origin = _nearestEmitter(points, target);
  if (!origin) return null;

  const layerName = origin.layer === "below" ? "below" : "above";
  const container = new PIXI.Container();
  container.zIndex = _zIndexFor(token, layerName);
  container.alpha = 0;
  parent.addChild(container);

  const width = Math.max(1, _num(mode.width, 10));
  const peakAlpha = Math.max(0, Math.min(1, _num(mode.alpha, 0.95)));
  const rampMs = Math.max(1, _num(mode.rampMs, 180));
  const fadeMs = Math.max(1, _num(mode.fadeMs, 320));
  const count = Math.max(1, Math.round(_num(mode.beamCount, 3)));
  const spread = _degToRad(Math.max(0, _num(mode.spreadDeg, 7)));
  const lifetimeMs = rampMs + durationMs + SUSTAIN_HOLD_MS + fadeMs;
  const filters = [];

  // Endpoint for lance `i`, rotated about the dish so the fan opens downrange.
  const endFor = (from, i) => {
    const frac = count === 1 ? 0 : (i / (count - 1)) - 0.5;
    if (!frac) return { x: target.x, y: target.y };
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const a = Math.atan2(dy, dx) + frac * spread;
    const d = Math.hypot(dx, dy);
    return { x: from.x + Math.cos(a) * d, y: from.y + Math.sin(a) * d };
  };

  const lances = [];
  for (let i = 0; i < count; i++) {
    const sub = new PIXI.Container();
    container.addChild(sub);
    const end = endFor(origin, i);
    const ribbon = createBeamRibbon(sub, {
      mode: "beam",
      from: origin, to: end,
      halfWidth: width * 1.6,
      color, coreColor,
      profile: { core: width * 0.25, rail: [0, 0] },
      shader: { noiseAmount: 0.38, noiseScale: 2.1, noiseSpeed: 2.5,
        coreSharpness: 2.8, haloSoftness: 2.2, surgeCount: 3,
        surgeSpeed: 1.1, surgeWidth: 0.18, surgeStrength: 0.32,
        flicker: 0.06, bloom: 0.85, endTaper: 0.025 },
      lifetimeMs,
      blendMode: blend,
    });
    let g = null;
    if (!ribbon) {
      g = new PIXI.Graphics();
      g.blendMode = blend;
      sub.addChild(g);
    }
    lances.push({ sub, ribbon, g, phase: Math.random() * Math.PI * 2 });
  }

  const tex = _radial();
  const muzzle = _sprite(container, tex, coreColor, blend);
  const halo = _sprite(container, tex, color, blend);
  const flare = _sprite(container, tex, coreColor, blend);
  muzzle.visible = halo.visible = flare.visible = true;

  // One filter for the whole bundle when the shader is unavailable — the
  // fallback is flat line work and needs the bloom far more than the shader does.
  if (lances.every(l => !l.ribbon)) {
    const glow = _glowFilter(color, _num(mode.glowSize, 26));
    if (glow) { container.filters = [glow]; filters.push(glow); }
  }

  const startedAt = performance.now();
  let stoppingAt = 0;

  const runner = _makeRunner({
    containers: [container],
    filters,
    totalMs: lifetimeMs,
    onCleanup: () => {
      for (const l of lances) { try { l.ribbon?.stop?.(); } catch { /* no-op */ } }
    },
    tick(now) {
      const elapsed = now - startedAt;
      // The hold ends on stop(), on the configured duration, or on the
      // anti-stuck cap — whichever comes first.
      if (!stoppingAt && elapsed >= rampMs + Math.min(durationMs, SUSTAIN_HOLD_MS)) stoppingAt = now;

      let envelope = Math.min(1, elapsed / rampMs);
      if (stoppingAt) {
        const f = (now - stoppingAt) / fadeMs;
        if (f >= 1) return false;
        envelope = 1 - f;
      }
      container.alpha = peakAlpha * Math.max(0, envelope);

      const from = shipDeflectorEmitterToCanvasPoint(token, origin.anchor) ?? origin;
      const thickness = width * (0.35 + 0.65 * Math.min(1, envelope));
      const heading = Math.atan2(target.y - from.y, target.x - from.x);
      const breath = 0.96 + 0.04 * Math.sin(elapsed * 0.009);
      muzzle.position.set(from.x, from.y);
      halo.position.set(from.x, from.y);
      flare.position.set(from.x, from.y);
      muzzle.scale.set(thickness * 3 / tex.width);
      halo.scale.set((thickness * 7 + _num(mode.glowSize, 26)) / tex.width);
      halo.alpha = 0.26 * breath;
      flare.rotation = heading + Math.PI / 2;
      flare.scale.set(thickness * 13 / tex.width, thickness * 0.45 / tex.width);
      flare.alpha = 0.42 * breath;
      for (let i = 0; i < lances.length; i++) {
        const lance = lances[i];
        const end = endFor(from, i);
        // A little independent life, so a bundle does not read as one wide beam.
        lance.sub.alpha = 0.94 + 0.06 * Math.sin(elapsed / 130 + lance.phase);
        if (lance.ribbon) {
          lance.ribbon.setSegment(from, end, thickness * 3.2);
        } else {
          lance.g.clear();
          _drawLine(lance.g, from, end, thickness * 3.2, color, 0.08);
          _drawLine(lance.g, from, end, thickness * 1.7, color, 0.22);
          _drawLine(lance.g, from, end, thickness * 0.85, color, 0.48);
          _drawLine(lance.g, from, end, Math.max(0.75, thickness * 0.4), coreColor, 1);
        }
      }
      return true;
    },
  });

  runner.stop = () => { if (!stoppingAt) stoppingAt = performance.now(); };
  return runner;
}

// ── stream ──────────────────────────────────────────────────────────────────
/**
 * A translucent column from the dish to the target with glowing motes running
 * down inside it. An advected shader volume gives the column soft walls and
 * interwoven filaments; layered strokes provide the Graphics fallback.
 *
 * A mote holds a fixed lateral place in the column (`v`, -1..1) and advances
 * along it at `speedPxPerSec`, so its lifetime falls out of the distance rather
 * than being configured separately — which also means the motes stay correct
 * when the ship drifts and the column gets longer or shorter mid-flight.
 *
 * THE ONE EFFECT THAT CAN BE LATCHED. With `hold`, `durationMs` is ignored, no
 * backstop is armed, and the column runs until stop(), until the token is
 * destroyed, or until canvasTearDown — which is the Token HUD's toggle. Three
 * pieces encode the burst and all three have to move together: the `emitting`
 * predicate, `totalMs`, and stop()'s release level.
 */
function _runStream({ token, parent, mode, color, coreColor, blend, durationMs, target, emitters, hold }) {
  const points = _emitterPoints(token, emitters);
  const origin = _nearestEmitter(points, target);
  if (!origin) return null;

  const layerName = origin.layer === "below" ? "below" : "above";
  const container = new PIXI.Container();
  container.zIndex = _zIndexFor(token, layerName);
  parent.addChild(container);

  const filters = [];
  const body = new PIXI.Graphics();
  body.blendMode = blend;
  container.addChild(body);
  const field = createDeflectorField(container, "stream", { color, coreColor, blend });

  const width = Math.max(1, _num(mode.width, 78));
  const bodyAlpha = Math.max(0, Math.min(1, _num(mode.bodyAlpha, 0.22)));
  const peakAlpha = Math.max(0, Math.min(1, _num(mode.alpha, 0.75)));
  const rate = Math.max(4, _num(mode.rate, 200));
  const speed = Math.max(20, _num(mode.speedPxPerSec, 900));
  const moteSize = Math.max(1, _num(mode.moteSize, 12));
  const glowSize = Math.max(0, _num(mode.glowSize, 18));

  const tex = _radial();
  const scale = moteSize / (tex.width || 128);
  // Sized off the longest the column can plausibly get at spawn time; the pool
  // is a create-once budget, not a per-frame decision.
  const span = Math.max(1, Math.hypot(target.x - origin.x, target.y - origin.y));
  const lifeMs = (span / speed) * 1000;
  const count = Math.max(1, Math.min(MAX_PARTICLES, Math.round(rate * lifeMs / 1000)));

  const motes = [];
  for (let i = 0; i < count; i++) {
    const s = _sprite(container, tex, coreColor, blend);
    s.scale.set(scale);
    motes.push({
      sprite: s,
      v: (Math.random() * 2 - 1),
      age: (i / count) * lifeMs,
      // Slight per-mote speed variation, or the column reads as a rigid ladder.
      rate: 0.82 + Math.random() * 0.36,
    });
  }

  const glow = field ? null : _glowFilter(color, _num(mode.glowSize, 18));
  if (glow) { container.filters = [glow]; filters.push(glow); }

  const startedAt = performance.now();
  let forceStop = false;
  let stoppedAt = null;
  let releaseAlpha = 1;

  const runner = _makeRunner({
    containers: [container],
    filters,
    totalMs: hold ? Infinity : durationMs + lifeMs + 600,
    tick(now, dt) {
      // A held column is the first deflector effect that can outlive its ship:
      // deleting the token destroys the placeable, and nothing else would end it.
      if (token.destroyed) return false;
      const elapsed = now - startedAt;
      const emitting = !forceStop && (hold || elapsed < durationMs);
      // Fade the whole column in and back out rather than snapping it off.
      const envelope = emitting
        ? Math.min(1, elapsed / 220)
        : releaseAlpha * Math.max(0, 1 - (elapsed - (stoppedAt ?? durationMs)) / 420);
      if (!emitting && envelope <= 0) return false;

      const from = shipDeflectorEmitterToCanvasPoint(token, origin.anchor) ?? origin;
      const dx = target.x - from.x;
      const dy = target.y - from.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / dist;
      const uy = dy / dist;
      // Perpendicular, for the motes' lateral place inside the column.
      const px = -uy;
      const py = ux;

      body.clear();
      if (field) {
        field.update(from.x, from.y, Math.atan2(dy, dx), dist, width + glowSize * 2,
          elapsed / 1000, peakAlpha * envelope, width, glowSize, 1, 1, bodyAlpha, speed);
      } else {
        for (const [scale, alpha] of [[1, 0.25], [0.78, 0.35], [0.56, 0.5], [0.3, 0.55]]) {
          _drawLine(body, from, target, Math.max(1, width * scale), color, bodyAlpha * alpha * peakAlpha * envelope);
        }
      }

      const liveMs = (dist / speed) * 1000;
      for (const mote of motes) {
        mote.age += dt * mote.rate;
        if (mote.age >= liveMs) {
          if (!emitting) { mote.sprite.visible = false; continue; }
          mote.age %= liveMs;
          mote.v = Math.random() * 2 - 1;
          mote.rate = 0.82 + Math.random() * 0.36;
          mote.sprite.tint = coreColor;
        }
        const t = Math.max(0, mote.age / liveMs);
        const along = dist * t;
        // Kept just inside the column wall, and pinched at the dish so the
        // motes look like they are being fed into it rather than starting wide.
        const drift = Math.sin(t * 15 - elapsed * 0.0033 + mote.rate * 8) * 0.12;
        const lateral = (mote.v * 0.84 + drift) * (width * 0.44) * Math.min(1, 0.25 + t * 2.2);
        const s = mote.sprite;
        s.visible = true;
        s.position.set(from.x + ux * along + px * lateral, from.y + uy * along + py * lateral);
        s.rotation = Math.atan2(dy, dx);
        s.scale.set(scale * (1.3 + mote.rate * 0.7), scale * 0.45);
        s.alpha = peakAlpha * envelope * Math.min(1, t * 9) * Math.min(1, (1 - t) * 5);
      }
      return true;
    },
  });

  runner.stop = () => {
    if (forceStop) return;
    const elapsed = performance.now() - startedAt;
    // A held column is at its ramp-in level however long it has been up, so
    // measuring the release against durationMs would compute a negative alpha
    // and snap it off instead of fading it.
    releaseAlpha = (hold || elapsed < durationMs)
      ? Math.min(1, elapsed / 220)
      : Math.max(0, 1 - (elapsed - durationMs) / 420);
    stoppedAt = elapsed;
    forceStop = true;
  };
  return runner;
}

// A scene change destroys the token layer and every container under it. Drop
// the handles rather than letting a ticker keep poking at dead objects.
Hooks.on("canvasTearDown", () => {
  for (const { handle } of [..._instances.values()]) {
    try { handle?.cleanup?.(); } catch { /* no-op */ }
  }
  _instances.clear();
});
