/**
 * sta2e-toolkit | warp-stretch-vfx.js
 *
 * The ship's own hull stretching as it enters and leaves warp — the beat that
 * sells the acceleration, as opposed to the flash and corridor in
 * warp-jump-vfx.js, which are effects drawn *around* the ship.
 *
 * The stretch is **anchored, not symmetric**: a departing ship digs in at its
 * trailing end and throws its leading end forward into the flash, and an
 * arriving one leads with its nose and lets the hull compact onto the
 * destination behind it. A symmetric smear was tried first and reads wrong — as
 * much hull grows backwards as forwards, which cancels the short run-up lunge
 * the movement runners perform and makes the ship look like it never moved.
 *
 * This is the one place in the module that deforms a token's sprite, and it
 * works because of three facts that are easy to break:
 *
 * 1. **The stretch axis is the mesh's local Y**, not a canvas direction. PIXI
 *    scale is applied before rotation, and every warp runner turns the ship to
 *    face its destination before the flash (ship-card-movement.js's rotate
 *    loops, and bearingToTokenRotation() in ship-spawner.js), so the hull's long
 *    axis lies along the line of travel. A plain scale.y multiplier therefore
 *    smears along that line with no matrix work. A caller that stretches a token
 *    which is not facing its heading gets a stretch along the hull instead,
 *    which still reads — but nothing here corrects for it.
 *
 * 2. **The anchor offset is in canvas space, taken from the caller's direction
 *    of travel — never derived from the mesh's own rotation.** Foundry treats
 *    `document.rotation === 0` as facing *south* (see Token##_refreshRotation
 *    and core's own auto-rotate, both of which use `bearing - 90`), so which end
 *    of a given token's *artwork* is the bow is not knowable from here. The
 *    caller knows where the ship is going, which is the only end-identification
 *    this effect actually needs: `anchor: "stern"` pins the trailing end of the
 *    motion, `"bow"` the leading end. With no `dir` it degrades to symmetric.
 *
 * 3. **Core rewrites both mesh.scale and mesh.position from scratch,** so
 *    neither can simply be written once. In v14 every scale write funnels
 *    through Token##_refreshMeshSizeAndScale (called by both #_refreshSize and
 *    #_refreshMesh) and every position write through #_refreshPosition — and
 *    `refreshSize` propagates `refreshPosition`, so a size refresh moves the
 *    mesh too. The patch below chains those two, re-captures the base core just
 *    wrote, and re-applies — recomputing rather than adjusting in place, which
 *    is what keeps repeated refreshes from compounding. Same reasoning as
 *    _applyMarkerLayout in combat/initiative-turn-marker.js. The `refreshToken`
 *    hook is belt-and-braces for any refresh path that is not one of those; it
 *    re-applies from the stored base but never re-captures, because by the time
 *    it runs the stretch is already on the mesh.
 *
 * Only the art smears. Border, bars, nameplate and the token's hit area are
 * separate display objects, so selection stays rectangular and targeting is
 * unaffected.
 *
 * Public API:
 *   const s = broadcastWarpStretch(token, { from, to, holdMs, durationMs, ... });
 *   s.stop();                                  // always restores
 *   getWarpStretchConfig(style | styleId)      // null when off or not applicable
 */

import { getWarpEffectStyle } from "./warp-effect-styles.js";

const MODULE = "sta2e-toolkit";

// How far the hull may narrow across its beam at full stretch. A volume-
// preserving squeeze at 7x would take the ship to 38% of its width, which reads
// as a sliver rather than a ship, so the narrowing is floored well short of it.
const SQUEEZE_FLOOR = 0.45;

// Ceiling on a GM-set stretch. A percent is a percent, but a hull scaled a
// hundred times its length is a full-screen band, not an effect.
const STRETCH_MAX = 40;

// token document id → entry. Empty in the overwhelmingly common case, which is
// what makes the per-frame refresh hook cheap.
const _stretches = new Map();

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * How much the hull narrows across its beam at a given elongation.
 *
 * `squeeze` is the fraction of the volume-preserving narrowing to apply, so 0 is
 * a pure elongation (the hull gets longer, not thinner) and 1 is the full
 * 1/sqrt(stretch), floored at SQUEEZE_FLOOR.
 */
function _squeezeFactor(stretch, squeeze) {
  if (!(stretch > 0) || !(squeeze > 0)) return 1;
  const full = 1 / Math.sqrt(stretch);
  return Math.max(SQUEEZE_FLOOR, 1 - squeeze * (1 - full));
}

/** The hull's rendered extent along its long axis at the given base scale. */
function _meshLength(mesh, base) {
  const texH = mesh?.texture?.orig?.height ?? mesh?.texture?.height ?? 0;
  const length = Math.abs(base.y) * texH;
  return Number.isFinite(length) ? length : 0;
}

/**
 * Write the current stretch onto the mesh — scale, and the position offset that
 * pins one end of the hull.
 *
 * The scale multiplies the captured base rather than setting absolute values, so
 * a token mirrored via texture.scaleX (negative scale) keeps its sign.
 *
 * The sprite is centre-anchored (core sets anchor to 0.5/0.5 from
 * `document.texture.anchorX/anchorY`), so scaling alone grows it equally in both
 * directions. Pinning one end is therefore a shift of half the *added* length
 * along the direction of travel: +1 holds the trailing edge and throws the
 * leading edge forward, -1 holds the leading edge and lets the hull trail behind
 * it. Zero is the plain symmetric smear.
 */
function _applyStretch(entry) {
  const mesh = entry?.token?.mesh;
  if (!mesh || mesh.destroyed) return;
  const stretch = entry.stretch;
  const sq = _squeezeFactor(stretch, entry.squeeze);
  const x = entry.base.x * sq;
  const y = entry.base.y * stretch;

  const shift = entry.anchorSign * entry.baseLength * (stretch - 1) / 2;
  const px = entry.basePos.x + entry.dir.x * shift;
  const py = entry.basePos.y + entry.dir.y * shift;

  // Written and recorded independently, never as one try block: if the position
  // write threw after the scale write had landed, the scale's `applied` record
  // would be missing and _captureBase would read the stretched mesh back as its
  // own base on the next refresh — compounding it. Each half records only what
  // it actually managed to write.
  try { mesh.scale.set(x, y); entry.applied = { x, y }; } catch { /* torn down */ }
  try { mesh.position.set(px, py); entry.appliedPos = { x: px, y: py }; } catch { /* torn down */ }
}

/**
 * Capture whatever core has just written as the new unstretched base.
 *
 * Scale and position are captured independently, because core writes them from
 * different methods: `_refreshMeshSizeAndScale` owns scale (and is called by
 * both `_refreshSize` and `_refreshMesh`), `_refreshPosition` owns position. The
 * two chained patches share this one function and each picks up whichever half
 * core actually touched.
 *
 * Both halves are guarded against re-capturing our *own* output. Without that,
 * a patch firing when core did *not* rewrite the value would read back the
 * stretched mesh, fold the multiplier into the base, and compound it every
 * frame. It matters most for position, which `_refreshPosition` rewrites on
 * every animation frame *and* on every size refresh (`refreshSize` propagates
 * `refreshPosition`).
 */
function _captureBase(entry) {
  const mesh = entry?.token?.mesh;
  if (!mesh || mesh.destroyed) return;

  const applied = entry.applied;
  if (!applied
      || Math.abs(mesh.scale.x - applied.x) > 1e-6
      || Math.abs(mesh.scale.y - applied.y) > 1e-6) {
    entry.base = { x: mesh.scale.x, y: mesh.scale.y };
    entry.baseLength = _meshLength(mesh, entry.base);
  }

  const pos = mesh.position;
  if (!pos) return;
  const appliedPos = entry.appliedPos;
  if (!appliedPos
      || Math.abs(pos.x - appliedPos.x) > 1e-6
      || Math.abs(pos.y - appliedPos.y) > 1e-6) {
    entry.basePos = { x: pos.x, y: pos.y };
  }
}

function _resolveToken(tokenOrDoc) {
  if (!tokenOrDoc) return null;
  if (tokenOrDoc.object) return tokenOrDoc.object;            // TokenDocument
  if (tokenOrDoc.document) return tokenOrDoc;                 // Token
  return canvas?.tokens?.get?.(String(tokenOrDoc)) ?? null;   // id
}

// ── Easing ───────────────────────────────────────────────────────────────────
// Quart either way: a warp stretch is almost nothing for most of the wind-up
// and then all at once, and settles the same way in reverse.

const _EASE = {
  in:     t => t * t * t * t,
  out:    t => 1 - Math.pow(1 - t, 4),
  linear: t => t,
};

// Which end of the hull holds still. Named for the ship rather than the geometry
// because that is how the beats read: a departing ship digs in at the stern and
// throws its bow forward, an arriving one leads with the bow and lets the hull
// catch up. See the caveat on `dir` in playWarpStretch — "stern" means the
// trailing end of the *motion*, which is the only end this module can identify.
const _ANCHOR = { stern: 1, bow: -1, center: 0 };

// ── Config ───────────────────────────────────────────────────────────────────

/**
 * The stretch a style asks for, scaled by the GM percent.
 *
 * The percent scales the *elongation* (max - 1), not the multiplier, so 0%
 * resolves to no stretch at all rather than collapsing the hull to nothing.
 *
 * @param   {object|string|null} styleOrId  A warp effect style or its id.
 * @returns {{max:number, squeeze:number}|null} null when the style does not
 *   stretch (rifts, the Q flash) or the GM has turned it off — so every call
 *   site is a single null check.
 */
export function getWarpStretchConfig(styleOrId) {
  const style = typeof styleOrId === "string" ? getWarpEffectStyle(styleOrId) : styleOrId;
  const stretch = style?.stretch ?? null;
  if (!stretch) return null;

  let percent = 100;
  try { percent = Number(game.settings.get(MODULE, "warpTokenStretch")); } catch { /* unregistered */ }
  if (!Number.isFinite(percent) || percent <= 0) return null;

  const max = Math.min(STRETCH_MAX, 1 + (Number(stretch.max) - 1) * (percent / 100));
  if (!(max > 1.01)) return null;
  return { max, squeeze: Math.max(0, Math.min(1, Number(stretch.squeeze) || 0)) };
}

// ── The effect ───────────────────────────────────────────────────────────────

/**
 * Client-local. Stretch a token's sprite along its nose axis over time.
 *
 * The animation runs `holdMs` at `from`, then eases to `to` over `durationMs`.
 * If it lands back at 1 it restores itself and clears; if it lands anywhere else
 * it *holds* there (with the ticker removed — the refresh patch keeps it on the
 * mesh) until stop() is called. That is what lets the depart phase smear the
 * hull out and leave it that way while the ship is invisible.
 *
 * @param {Token|TokenDocument|string} tokenOrDoc
 * @param {object}  [opts]
 * @param {number}  [opts.from=1]        Starting multiplier along the nose axis
 * @param {number}  [opts.to=1]          Ending multiplier
 * @param {number}  [opts.holdMs=0]      Hold at `from` before easing
 * @param {number}  [opts.durationMs]    Ease duration
 * @param {"in"|"out"|"linear"} [opts.easing="in"]
 * @param {number}  [opts.squeeze=0]     Fraction of volume-preserving narrowing
 * @param {"stern"|"bow"|"center"} [opts.anchor="center"] Which end holds still
 * @param {{x:number,y:number}} [opts.dir] Direction of travel in **canvas**
 *   space. Deliberately not derived from the mesh's own rotation: Foundry treats
 *   `document.rotation === 0` as facing south, so which end of the *artwork* is
 *   the bow is not knowable here (see the module header). The caller knows where
 *   the ship is going, and that is what the anchor is measured against. Omitted
 *   or zero-length, the anchor degrades to a symmetric smear.
 * @param {number}  [opts.dirX]          Socket-friendly form of `dir`
 * @param {number}  [opts.dirY]
 * @returns {{stop:function}} stop() always restores the hull
 */
export function playWarpStretch(tokenOrDoc, opts = {}) {
  const inert = { stop() { /* nothing was applied */ } };

  const token = _resolveToken(tokenOrDoc);
  const tokenId = token?.document?.id ?? null;
  const mesh = token?.mesh;
  if (!token || !tokenId || !mesh || mesh.destroyed) return inert;
  if (!canvas?.app?.ticker) return inert;

  const from       = Math.max(0.01, Number(opts.from) || 1);
  const to         = Math.max(0.01, Number(opts.to)   || 1);
  const holdMs     = Math.max(0, Number(opts.holdMs) || 0);
  const durationMs = Math.max(0, Number(opts.durationMs) || 0);
  const squeeze    = Math.max(0, Math.min(1, Number(opts.squeeze) || 0));
  const easeFn     = _EASE[opts.easing] ?? _EASE.in;

  // Normalised here rather than trusted from the caller, so a socket payload
  // cannot scale the offset by handing over a non-unit vector.
  const dirX   = Number(opts.dirX ?? opts.dir?.x) || 0;
  const dirY   = Number(opts.dirY ?? opts.dir?.y) || 0;
  const dirLen = Math.hypot(dirX, dirY);
  const hasDir = Number.isFinite(dirLen) && dirLen > 1e-9;
  const dir    = hasDir ? { x: dirX / dirLen, y: dirY / dirLen } : { x: 0, y: 0 };
  const anchorSign = hasDir ? (_ANCHOR[opts.anchor] ?? 0) : 0;

  // A stretch already running on this token is replaced, not stacked — the
  // previous one restores first so this one's base is the honest scale.
  _stretches.get(tokenId)?.instance?.stop?.();

  const entry = {
    token,
    base:    { x: mesh.scale.x, y: mesh.scale.y },
    basePos: { x: mesh.position?.x ?? 0, y: mesh.position?.y ?? 0 },
    baseLength: 0,          // filled in below, from the captured base
    applied: null,          // the exact values we last wrote — see _captureBase
    appliedPos: null,
    dir,
    anchorSign,
    stretch: from,
    squeeze,
    instance: null,
  };
  entry.baseLength = _meshLength(mesh, entry.base);

  const startedAt = performance.now();
  let finished = false;
  let ticking = false;
  let backstop = null;

  const untick = () => {
    if (!ticking) return;
    ticking = false;
    try { canvas.app.ticker.remove(tick); } catch { /**/ }
  };

  /** Put the hull back and let core reassert the truth. */
  const restore = () => {
    if (finished) return;
    finished = true;
    untick();
    if (backstop) { clearTimeout(backstop); backstop = null; }
    if (_stretches.get(tokenId) === entry) _stretches.delete(tokenId);
    try {
      const liveMesh = entry.token?.mesh;
      if (liveMesh && !liveMesh.destroyed) {
        liveMesh.scale.set(entry.base.x, entry.base.y);
        liveMesh.position?.set(entry.basePos.x, entry.basePos.y);
      }
    } catch { /* mesh gone — core rebuilds it at true size anyway */ }
    // refreshSize propagates refreshPosition, but ask for both explicitly: a
    // stuck position offset is worse than a stuck scale, since it leaves the
    // ship off its own square.
    try { entry.token?.renderFlags?.set({ refreshSize: true, refreshPosition: true }); } catch { /**/ }
  };

  function tick() {
    if (finished) return;
    const elapsed = performance.now() - startedAt;

    if (elapsed < holdMs) {
      entry.stretch = from;
      _applyStretch(entry);
      return;
    }

    const t = durationMs > 0 ? Math.min(1, (elapsed - holdMs) / durationMs) : 1;
    entry.stretch = from + (to - from) * easeFn(t);
    _applyStretch(entry);

    if (t < 1) return;
    // Landed on 1 — the effect is over. Landed anywhere else — hold there and
    // stop burning a ticker slot; the refresh patch keeps it applied.
    if (Math.abs(to - 1) < 0.001) restore();
    else untick();
  }

  entry.instance = { stop() { restore(); } };
  _stretches.set(tokenId, entry);
  _applyStretch(entry);
  canvas.app.ticker.add(tick);
  ticking = true;

  // Backstop in case the ticker dies mid-effect or a stop message is lost — a
  // held stretch has no natural end, so this is the only thing that guarantees
  // no ship is left smeared. Generous, because a caller's stop() is the norm.
  backstop = setTimeout(restore, holdMs + durationMs + 8000);

  return entry.instance;
}

/**
 * Canvas-space offset from the token's centre to the **far tip of a full smear**
 * — the end opposite the anchor. What a caller wants when it is placing
 * something at the point the hull reaches rather than at the ship itself: the
 * warp flash goes there, so a departing ship punches into the burst with its
 * bow and an arriving one streams forward out of one behind its stern.
 *
 * Derivation, with `C` the centre, `d` the unit travel direction, `L` the base
 * hull length, `m` the stretch and `s` the anchor sign: the anchored hull sits at
 * `C + s·d·L·(m-1)/2` and is `L·m` long, so its two ends are `C - s·d·L/2` (the
 * anchor, fixed by construction) and **`C + s·d·L·(m - 0.5)`** — this offset.
 *
 * @param {Token|TokenDocument|string} tokenOrDoc
 * @param {object} opts  `max`, `anchor` and `dir` exactly as passed to
 *   playWarpStretch, so a caller cannot drift the two apart.
 * @returns {{x:number, y:number}} zero whenever there is no anchored stretch to
 *   measure — no anchor, no direction, no elongation, or no readable texture —
 *   so a caller can add it unconditionally.
 */
export function getWarpStretchTipOffset(tokenOrDoc, { max, anchor, dir, dirX, dirY } = {}) {
  const zero = { x: 0, y: 0 };
  const token = _resolveToken(tokenOrDoc);
  const mesh = token?.mesh;
  if (!mesh || mesh.destroyed) return zero;

  const sign = _ANCHOR[anchor] ?? 0;
  const m = Number(max);
  if (!sign || !Number.isFinite(m) || m <= 1) return zero;

  const ux = Number(dirX ?? dir?.x) || 0;
  const uy = Number(dirY ?? dir?.y) || 0;
  const len = Math.hypot(ux, uy);
  if (!Number.isFinite(len) || len <= 1e-9) return zero;

  // Must be the *unstretched* length. A stretch on this token is usually already
  // running by the time a runner asks — the depart flash fires mid-ramp — so the
  // registry's captured base wins over the live mesh, which is mid-smear.
  const entry = _stretches.get(token.document?.id ?? null);
  const baseLength = entry?.baseLength ?? _meshLength(mesh, { y: mesh.scale.y });
  if (!(baseLength > 0)) return zero;

  const dist = sign * baseLength * (m - 0.5);
  return { x: (ux / len) * dist, y: (uy / len) * dist };
}

/** Socket receiver: restore whatever stretch a token is wearing. */
export function stopWarpStretch(tokenId) {
  try { _stretches.get(tokenId)?.instance?.stop?.(); } catch { /**/ }
}

/**
 * Play locally and tell every other client to play the same stretch.
 *
 * The warp runners execute only on the responsible GM, so without this nobody
 * else — including the player who clicked — would see the ship deform. Same
 * problem and same fix as broadcastEngineTrail / broadcastWarpChargeGlow.
 */
export function broadcastWarpStretch(tokenOrDoc, opts = {}) {
  const token = _resolveToken(tokenOrDoc);
  const tokenId = token?.document?.id ?? null;
  const local = playWarpStretch(token, opts);

  if (tokenId) {
    try {
      game.socket.emit(`module.${MODULE}`, {
        action: "warpStretchVfx",
        tokenId,
        sceneId: canvas?.scene?.id ?? null,
        from: opts.from, to: opts.to,
        holdMs: opts.holdMs, durationMs: opts.durationMs,
        easing: opts.easing, squeeze: opts.squeeze,
        anchor: opts.anchor,
        dirX: Number(opts.dirX ?? opts.dir?.x) || 0,
        dirY: Number(opts.dirY ?? opts.dir?.y) || 0,
      });
    } catch { /* cosmetic — never block the jump */ }
  }

  return {
    stop() {
      local?.stop?.();
      if (!tokenId) return;
      try {
        game.socket.emit(`module.${MODULE}`, { action: "stopWarpStretchVfx", tokenId });
      } catch { /* cosmetic */ }
    },
  };
}

/** Drop every stretch — canvas teardown, and a console escape hatch. */
export function clearAllWarpStretch() {
  for (const entry of [..._stretches.values()]) {
    try { entry.instance?.stop?.(); } catch { /**/ }
  }
  _stretches.clear();
}

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * Chain the Token refresh methods that rewrite mesh.scale, and wire the
 * lifecycle hooks. Call from main.js "setup".
 */
export function registerWarpStretch() {
  const TokenClass = foundry.canvas?.placeables?.Token ?? Token;

  if (TokenClass?.prototype && !TokenClass.prototype._sta2eWarpStretchPatch) {
    // v14 funnels every scale write through _refreshMeshSizeAndScale (called by
    // both _refreshSize and _refreshMesh) and every position write through
    // _refreshPosition, so those two are the whole surface. The three-method
    // form is the fallback for a build without the shared helper — chaining the
    // two callers instead costs only a redundant re-apply.
    const methods = typeof TokenClass.prototype._refreshMeshSizeAndScale === "function"
      ? ["_refreshMeshSizeAndScale", "_refreshPosition"]
      : ["_refreshSize", "_refreshMesh", "_refreshPosition"];

    for (const method of methods) {
      const original = TokenClass.prototype[method];
      if (typeof original !== "function") continue;
      TokenClass.prototype[method] = function (...args) {
        const result = original.apply(this, args);
        if (_stretches.size) {
          const entry = _stretches.get(this?.document?.id);
          if (entry) {
            entry.token = this;
            _captureBase(entry);
            _applyStretch(entry);
          }
        }
        return result;
      };
    }
    TokenClass.prototype._sta2eWarpStretchPatch = true;
  }

  // Belt-and-braces for refresh paths that are not one of the two above. Never
  // re-captures — the stretch is already on the mesh by the time this runs.
  Hooks.on("refreshToken", (token) => {
    if (!_stretches.size) return;
    const entry = _stretches.get(token?.document?.id);
    if (!entry) return;
    entry.token = token;
    _applyStretch(entry);
  });

  // The mesh is rebuilt on redraw, so a stored base is meaningless — and a warp
  // that survives a redraw is not worth keeping. Deletion covers runWarpFleeCard
  // removing its token mid-effect.
  Hooks.on("drawToken",    (token) => stopWarpStretch(token?.document?.id));
  Hooks.on("destroyToken", (token) => stopWarpStretch(token?.document?.id));
  Hooks.on("deleteToken",  (doc)   => stopWarpStretch(doc?.id));
  Hooks.on("canvasTearDown", () => clearAllWarpStretch());
}
