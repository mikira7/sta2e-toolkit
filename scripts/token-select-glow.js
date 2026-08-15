/**
 * sta2e-toolkit | token-select-glow.js
 *
 * Replaces Foundry's default rectangular selection border with a soft glow that
 * follows the token artwork's own silhouette.
 *
 * How it works
 * ------------
 *  1. `Token#_refreshBorder` is patched once (same pattern as
 *     token-elevation-display.js). When the glow is enabled we clear the border
 *     Graphics and return, so core draws nothing. We do NOT touch
 *     `token.border.visible` — `_refreshState()` reassigns that on every state
 *     refresh and would clobber it.
 *  2. `PIXI.filters.GlowFilter` instances (pixi-filters, bundled with Foundry —
 *     see transporter-vfx.js for the same shim) are pushed onto
 *     `token.mesh.filters`. The filter samples the sprite's alpha, so a saucer
 *     glows along its hull rather than around a square frame.
 *  3. Colours resolve from `getLcTokens()` at apply time, never cached at module
 *     load, so switching campaign/era retints live tokens.
 *
 * Filter etiquette: we append to `mesh.filters` and remove by identity on
 * teardown. Other effects (transporter shimmer) add their own filters to the
 * same mesh and must survive our add/remove cycle.
 *
 * State priority: controlled > targeted > hovered.
 *
 * The hover tint is not an era colour — it is the token's disposition, using
 * Foundry's own palette (red hostile / cyan friendly / yellow neutral / purple
 * secret), so brushing the cursor over a contact tells you whose side it is on.
 *
 * The acting combatant is deliberately NOT glowed here: the initiative turn
 * marker (combat/initiative-turn-marker.js) already rings that token, and two
 * indicators for one fact just fight each other.
 */

import { getLcTokens } from "./lcars-theme.js";

const MODULE = "sta2e-toolkit";

/** tokenId → { mesh, key, sig, entries: [{ filter }] } */
const _active = new Map();

// ---------------------------------------------------------------------------
// Settings access (never throws — called from PIXI render paths)
// ---------------------------------------------------------------------------

function _get(key, fallback) {
  try {
    const value = game.settings.get(MODULE, key);
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

const _isEnabled      = () => _get("tokenSelectGlow", false) === true;
const _hidesBorder    = () => _get("tokenSelectGlowHideBorder", true) === true;
const _glowsOnHover   = () => _get("tokenSelectGlowHover", true) === true;
const _glowsOnTarget  = () => _get("tokenSelectGlowTarget", true) === true;
const _distance       = () => Number(_get("tokenSelectGlowDistance", 14)) || 14;
const _strength       = () => Number(_get("tokenSelectGlowStrength", 2.6)) || 2.6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "#f6a726" → 0xf6a726 */
function _hexToNum(hex, fallback = 0xffffff) {
  if (typeof hex === "number" && Number.isFinite(hex)) return hex;
  if (typeof hex !== "string") return fallback;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return match ? parseInt(match[1], 16) : fallback;
}

function _isTargeted(token) {
  if (typeof token?.isTargeted === "boolean") return token.isTargeted;
  return (token?.targeted?.size ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Disposition colours
// ---------------------------------------------------------------------------

/**
 * Foundry's own disposition palette, hard-coded as a floor. `CONFIG.Canvas.
 * dispositionColors` is preferred at call time so a GM (or another module)
 * retinting dispositions carries through, but a CONFIG shape change must not be
 * able to blank the hover glow.
 */
const DISPOSITION_FALLBACK = {
  [-2]: 0xa612d4,  // SECRET   — purple
  [-1]: 0xe72124,  // HOSTILE  — red
  [0]:  0xf1d836,  // NEUTRAL  — yellow
  [1]:  0x43dfdf,  // FRIENDLY — cyan
};

/** CONFIG key for each disposition constant. */
const DISPOSITION_KEYS = {
  [-2]: "SECRET",
  [-1]: "HOSTILE",
  [0]:  "NEUTRAL",
  [1]:  "FRIENDLY",
};

/** Colour values may be a plain number or a `Color` instance. */
function _colorToNum(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return _hexToNum(value, NaN);
  const asNumber = Number(value?.valueOf?.());
  return Number.isFinite(asNumber) ? asNumber : NaN;
}

/**
 * Glow colour for a token's disposition, or null for a disposition we do not
 * recognise (callers fall back to the era theme).
 */
function _dispositionColor(token) {
  const disposition = token?.document?.disposition;
  const key = DISPOSITION_KEYS[disposition];
  if (!key) return null;

  const configured = _colorToNum(CONFIG?.Canvas?.dispositionColors?.[key]);
  if (Number.isFinite(configured)) return configured;

  return DISPOSITION_FALLBACK[disposition] ?? null;
}

// ---------------------------------------------------------------------------
// Glow state
// ---------------------------------------------------------------------------

/**
 * The selection/target/hover state this token should be showing.
 * @returns {{name: string, color: number, distance: number, strength: number}|null}
 */
function _secondaryState(token, lc, distance, strength) {
  if (token.controlled) {
    return { name: "controlled", color: _hexToNum(lc.primary, 0xf6a726), distance, strength };
  }
  if (_glowsOnTarget() && _isTargeted(token)) {
    return { name: "targeted", color: _hexToNum(lc.red, 0xd92222), distance, strength };
  }
  if (_glowsOnHover() && token.hover === true) {
    return {
      name:     "hover",
      color:    _dispositionColor(token) ?? _hexToNum(lc.tertiary, 0xf2c77a),
      distance: Math.round(distance * 0.75),
      strength: strength * 0.55,
    };
  }
  return null;
}

/**
 * The filter stack this token should be wearing right now.
 * @returns {{key: string, sig: string, layers: Array}|null}
 */
function _desiredLayers(token) {
  if (!token || token.destroyed) return null;

  const state = _secondaryState(token, getLcTokens(), _distance(), _strength());
  if (!state) return null;

  const layers = [{
    color:         state.color,
    distance:      state.distance,
    outerStrength: state.strength,
    innerStrength: 0,
  }];

  const sig = layers
    .map((l) => `${l.color}:${l.distance}:${l.outerStrength.toFixed(2)}:${l.innerStrength.toFixed(2)}`)
    .join("|");

  return { key: state.name, sig, layers };
}

/** Remove our filters from a token's mesh, leaving any foreign filters intact. */
function _clearGlow(tokenId) {
  const record = _active.get(tokenId);
  if (!record) return;
  _active.delete(tokenId);

  const ours = record.entries.map((e) => e.filter);

  try {
    const mesh = record.mesh;
    if (mesh && !mesh.destroyed && Array.isArray(mesh.filters)) {
      const remaining = mesh.filters.filter((f) => !ours.includes(f));
      mesh.filters = remaining.length ? remaining : null;
    }
  } catch { /* mesh already torn down */ }

  for (const filter of ours) {
    try { filter?.destroy?.(); } catch { /* older pixi-filters lack destroy */ }
  }
}

/** Build + attach the glow stack, or rebuild it if the desired look changed. */
function _applyGlow(token) {
  const id = token?.id;
  if (!id) return;

  const previous = _active.get(id);

  // Cheap bail-out for the overwhelmingly common case: an untouched token being
  // refreshed during movement animation. refreshToken fires per frame.
  if (!previous
      && !token.controlled
      && token.hover !== true
      && !_isTargeted(token)) return;

  if (!_isEnabled()) { _clearGlow(id); return; }

  const mesh = token.mesh;
  if (!mesh || mesh.destroyed) { _clearGlow(id); return; }

  const want = _desiredLayers(token);
  if (!want) { _clearGlow(id); return; }

  // Already wearing exactly this stack on this mesh — nothing to do.
  if (previous
      && previous.mesh === mesh
      && previous.sig === want.sig
      && Array.isArray(mesh.filters)
      && previous.entries.every((e) => mesh.filters.includes(e.filter))) return;

  _clearGlow(id);

  const GlowFilter = PIXI.filters?.GlowFilter ?? globalThis.PIXI?.filters?.GlowFilter;
  if (!GlowFilter) {
    console.debug(`${MODULE} | token select glow: PIXI.filters.GlowFilter unavailable`);
    return;
  }

  const entries = [];
  for (const layer of want.layers) {
    try {
      const filter = new GlowFilter({
        distance:      layer.distance,
        outerStrength: layer.outerStrength,
        innerStrength: layer.innerStrength,
        color:         layer.color,
        quality:       0.35,
        knockout:      false,
      });
      entries.push({ filter });
    } catch (err) {
      console.debug(`${MODULE} | token select glow: filter construction failed:`, err?.message);
    }
  }
  if (!entries.length) return;

  try {
    const existing = Array.isArray(mesh.filters) ? [...mesh.filters] : [];
    mesh.filters = existing.concat(entries.map((e) => e.filter));
  } catch (err) {
    console.debug(`${MODULE} | token select glow: filter attach failed:`, err?.message);
    return;
  }

  _active.set(id, { mesh, key: want.key, sig: want.sig, entries });
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Re-evaluate every token on the canvas. Used as the settings onChange handler
 * and after a campaign/theme switch so the glow colour follows the new era.
 */
export function refreshAllTokenSelectGlow() {
  for (const id of [..._active.keys()]) _clearGlow(id);
  for (const token of canvas?.tokens?.placeables ?? []) {
    try { token.renderFlags?.set({ refreshBorder: true }); } catch { /* ignore */ }
    try { _applyGlow(token); } catch { /* ignore */ }
  }
}

/** Drop every glow — used on canvas teardown. */
export function clearAllTokenSelectGlow() {
  for (const id of [..._active.keys()]) _clearGlow(id);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Patch Token#_refreshBorder once and wire the state hooks.
 * Call from main.js "setup".
 */
export function registerTokenSelectGlow() {
  const TokenClass = foundry.canvas?.placeables?.Token ?? Token;

  if (TokenClass?.prototype && !TokenClass.prototype._sta2eSelectGlowPatch) {
    const origRefreshBorder = TokenClass.prototype._refreshBorder;
    TokenClass.prototype._refreshBorder = function () {
      if (_isEnabled() && _hidesBorder()) {
        // A cleared Graphics draws nothing regardless of what _refreshState()
        // later does to border.visible.
        try { this.border?.clear(); } catch { /* ignore */ }
        return;
      }
      return origRefreshBorder?.call(this);
    };
    TokenClass.prototype._sta2eSelectGlowPatch = true;
  }

  // Position/animation refreshes and state changes both land here.
  Hooks.on("refreshToken", (token) => { try { _applyGlow(token); } catch { /* ignore */ } });
  Hooks.on("controlToken", (token) => { try { _applyGlow(token); } catch { /* ignore */ } });
  Hooks.on("hoverToken",   (token) => { try { _applyGlow(token); } catch { /* ignore */ } });
  Hooks.on("targetToken",  (_user, token) => { try { _applyGlow(token); } catch { /* ignore */ } });

  // The mesh is rebuilt on redraw, so any stored reference is stale.
  Hooks.on("drawToken", (token) => {
    _clearGlow(token?.id);
    try { _applyGlow(token); } catch { /* ignore */ }
  });

  Hooks.on("destroyToken", (token) => _clearGlow(token?.id));
  Hooks.on("deleteToken",  (doc)   => _clearGlow(doc?.id));

  // A disposition change retints the hover glow mid-hover.
  Hooks.on("updateToken", (doc, changes) => {
    if (!("disposition" in (changes ?? {}))) return;
    const token = doc?.object;
    if (token) { _clearGlow(token.id); try { _applyGlow(token); } catch { /* ignore */ } }
  });

  Hooks.on("canvasTearDown", () => clearAllTokenSelectGlow());
  Hooks.on("canvasReady",    () => refreshAllTokenSelectGlow());
}
