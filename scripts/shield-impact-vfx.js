/**
 * sta2e-toolkit | shield-impact-vfx.js
 *
 * What a starship weapon hit looks like at the target end. Two layers play
 * together on a hit that the shields absorb:
 *
 *   1. The JB2A impact flash below — localized to the strike point, and tinted
 *      to the target's shield colour so a Romulan hull does not flash Starfleet
 *      blue. Sequencer routes it to every client itself.
 *   2. The native PIXI shield bubble in shield-bubble-vfx.js, which wraps the
 *      hull and lights a crescent at the same point. That one is client-local
 *      and broadcasts itself.
 *
 * Colour resolves once, here, and is handed to both — per-ship override first,
 * then the faction guessed from the actor's name and traits.
 *
 * With shields already down there is no bubble, and the flash becomes a hull
 * explosion instead (playHullImpactVFX).
 */

import { resolveShieldImpactColorHex } from "./ship-vfx-anchors.js";
import { getShieldCapPoint, playShieldBubble } from "./shield-bubble-vfx.js";

const MODULE = "sta2e-toolkit";

// Sequencer's tint MULTIPLIES, so it can only take channels away from what the
// source already has — tinting the blue impact green lands on muddy near-black.
// The patron pack ships a white variant of impact 005, which multiplies to
// exactly the requested colour; the free pack ships no white impact at all, so
// there it stays the blue it has always been rather than being ruined.
// (Same constraint warp-jump-vfx.js hit with its corridor asset.)
const SHIELD_IMPACT_EFFECT_TINTABLE = "jb2a.impact.005.white";
const SHIELD_IMPACT_EFFECT_FIXED = "jb2a.impact.004.blue";
const HULL_IMPACT_EFFECT = "jb2a.explosion_side.01.orange.2";

// Impact 004 is the one JB2A impact that ships a spread of saturated colours
// rather than a single hue, which makes it the burst a torpedo leaves on a
// shield it could not get through — see shieldTorpedoImpactAsset below.
// Hues are eyeballed from the source clips, so nudge them here rather than
// adding special cases at the call site.
const IMPACT_004_BASE = "jb2a.impact.004";
const IMPACT_004_FALLBACK = "blue";
const IMPACT_004_VARIANT_HUES = Object.freeze({
  dark_red: 2,
  orange: 30,
  yellow: 50,
  green: 122,
  blue: 208,
  dark_purple: 266,
  pinkpurple: 295,
});

// Below this saturation a colour has no hue worth matching, so hue distance
// would pick a variant essentially at random. Near-greys take the fallback.
const IMPACT_004_MIN_SATURATION = 0.15;
// Inside this many degrees the variant already IS the requested colour, and
// tinting it would only cost brightness for no visible shift.
const IMPACT_004_EXACT_HUE_DEG = 12;
// How far to drag the shield colour toward white before using it as a tint.
// Sequencer multiplies, so an undiluted mid-tone tint darkens more than it
// recolours; whitening trades saturation for keeping the burst bright.
const IMPACT_004_TINT_WHITEN = 0.55;

const PRESET_FACTORS = Object.freeze({
  subtle: 0.72,
  cinematic: 1,
  intense: 1.24,
});

function _number(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function _clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function _settingEnabled() {
  try { return game.settings.get(MODULE, "shieldImpactFX") !== false; }
  catch { return true; }
}

function _bubbleEnabled() {
  try { return game.settings.get(MODULE, "shieldBubbleVFX") !== false; }
  catch { return true; }
}

/**
 * The flash asset and whether it can carry the shield colour.
 *
 * The tier setting says which pack the GM *has*; the database says what is
 * actually installed. Trusting the setting alone would drop the flash entirely
 * on a world where the patron pack is configured but absent, so the white asset
 * has to be really there before we commit to tinting it.
 */
function _impactFlash(color) {
  let patron = false;
  try { patron = game.settings.get(MODULE, "jb2aTier") === "patron"; }
  catch { /* setting not registered yet */ }

  if (patron) {
    let exists = true;
    try { exists = globalThis.Sequencer?.Database?.entryExists?.(SHIELD_IMPACT_EFFECT_TINTABLE) !== false; }
    catch { exists = false; }
    if (exists) return { file: SHIELD_IMPACT_EFFECT_TINTABLE, tint: color };
  }

  return { file: SHIELD_IMPACT_EFFECT_FIXED, tint: null };
}

/** Apply the tint only when there is one — `.tint(null)` is not a no-op. */
function _tinted(effect, tint) {
  return tint ? effect.tint(tint) : effect;
}

/** "#9fd8ff" → {r,g,b} on 0–1, or null when it is not a six-digit hex. */
function _rgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return { r: ((value >> 16) & 0xff) / 255, g: ((value >> 8) & 0xff) / 255, b: (value & 0xff) / 255 };
}

function _rgbToHex({ r, g, b }) {
  const channel = (v) => Math.round(_clamp(v, 0, 1) * 255).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Hue in degrees plus HSL saturation. Grey returns hue 0, saturation 0. */
function _hueSaturation({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  const lightness = (max + min) / 2;
  if (span === 0) return { hue: 0, saturation: 0 };

  let hue;
  if (max === r) hue = ((g - b) / span) % 6;
  else if (max === g) hue = ((b - r) / span) + 2;
  else hue = ((r - g) / span) + 4;
  hue *= 60;
  if (hue < 0) hue += 360;

  const saturation = span / (1 - Math.abs(2 * lightness - 1) || 1);
  return { hue, saturation: _clamp(saturation, 0, 1) };
}

/** Shortest way round the colour wheel, so 355° and 2° are 7° apart. */
function _hueDistance(a, b) {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function _entryExists(file) {
  try { return globalThis.Sequencer?.Database?.entryExists?.(file) !== false; }
  catch { return false; }
}

/**
 * The burst a torpedo leaves on a shield that stopped it, in the shield's own
 * colour.
 *
 * Sequencer's tint multiplies, so recolouring one stock clip the whole way from
 * blue to green lands on mud (the same wall `_impactFlash` hit). Impact 004
 * dodges it by shipping seven hues: snap to the nearest one FIRST, so the tint
 * only has to cover the gap between "close" and "exact" — a shift small enough
 * that a whitened tint carries it without draining the burst.
 *
 * Only the patron pack ships all seven; the free pack has blue alone. Asking
 * the database rather than the `jb2aTier` setting covers both, and also covers
 * a world where the patron pack is configured but not actually installed.
 *
 * @param {string} colorHex  The target's resolved shield colour
 * @returns {{file: string, tint: string|null}}
 */
export function shieldTorpedoImpactAsset(colorHex) {
  const fallback = `${IMPACT_004_BASE}.${IMPACT_004_FALLBACK}`;
  const rgb = _rgb(colorHex);
  if (!rgb) return { file: fallback, tint: null };

  const { hue, saturation } = _hueSaturation(rgb);
  if (saturation < IMPACT_004_MIN_SATURATION) return { file: fallback, tint: null };

  let best = IMPACT_004_FALLBACK;
  let bestDelta = Infinity;
  for (const [variant, variantHue] of Object.entries(IMPACT_004_VARIANT_HUES)) {
    const delta = _hueDistance(hue, variantHue);
    if (delta < bestDelta) { bestDelta = delta; best = variant; }
  }

  let file = `${IMPACT_004_BASE}.${best}`;
  let matched = true;
  if (!_entryExists(file)) {
    file = fallback;
    matched = false;
  }

  // A variant that already sits on this hue needs no help, and tinting it would
  // only cost brightness. Anything further off — including every colour the
  // free pack has to squeeze onto blue — gets the whitened nudge.
  if (matched && bestDelta < IMPACT_004_EXACT_HUE_DEG) return { file, tint: null };

  const whiten = IMPACT_004_TINT_WHITEN;
  return {
    file,
    tint: _rgbToHex({
      r: rgb.r + (1 - rgb.r) * whiten,
      g: rgb.g + (1 - rgb.g) * whiten,
      b: rgb.b + (1 - rgb.b) * whiten,
    }),
  };
}

function _presetFactor() {
  try { return PRESET_FACTORS[game.settings.get(MODULE, "shieldImpactPreset")] ?? PRESET_FACTORS.cinematic; }
  catch { return PRESET_FACTORS.cinematic; }
}

function _tokenDimensions(token) {
  const doc = token?.document ?? token;
  const gridSize = canvas?.grid?.size ?? canvas?.scene?.grid?.size ?? 100;
  return {
    width: token?.w ?? ((doc?.width ?? 1) * gridSize),
    height: token?.h ?? ((doc?.height ?? 1) * gridSize),
  };
}

function _shieldImpactScale(targetToken, options = {}) {
  const damage = Math.max(0, _number(options.finalDamage, 0));
  const maxShields = Math.max(1, _number(options.maxShields, 8));
  const damageFactor = _clamp(damage / maxShields, 0.12, 1.15);
  const preset = _presetFactor();
  const { width, height } = _tokenDimensions(targetToken);
  const tokenLimit = Math.max(1, Math.min(width, height));
  const tokenFactor = _clamp(tokenLimit / 240, 0.55, 1.45);
  const base = 0.26 + damageFactor * 0.24;
  return _clamp(base * preset * tokenFactor * (options.shieldBroke ? 1.18 : 1), 0.18, 0.78);
}

function _impactLocation(targetToken, impactPoint) {
  if (impactPoint?.x != null && impactPoint?.y != null) return impactPoint;
  if (targetToken?.center) return { x: targetToken.center.x, y: targetToken.center.y };
  return targetToken;
}

/**
 * Where a shot should stop, or null to let it carry on to the hull.
 *
 * Shields that hold turn the weapon away — not at the boundary, but wherever
 * the shield lights up for this shot, which `capT` slides between the envelope
 * edge and the hull hit point. Beam and glow therefore always end together; a
 * beam that stopped at the boundary while the glow sat over the ship read as
 * two unrelated events.
 *
 * A hit that breaches gets through — and a breach can land while the shields
 * are still up, via the 50%/25% punch-through thresholds, which is why this
 * reads `breached` rather than `shieldBroke`. Shields already down is not this
 * function's business: those hits carry a `hullImpact` instead.
 *
 * Null is also the answer when the attacker is inside the envelope, since there
 * is no boundary between them to stop at.
 *
 * @param {object} shieldImpact  The shot's slice of the shield payload
 * @param {number} capT          0–1 depth, rolled once per shot by the caller
 * @returns {{x:number,y:number}|null}
 */
export function shieldStopPoint(targetToken, sourcePoint, hullPoint, shieldImpact, capT) {
  if (!shieldImpact || !(shieldImpact.preShields > 0)) return null;
  if (shieldImpact.breached) return null;
  return getShieldCapPoint(targetToken, sourcePoint, hullPoint, capT);
}

export function scheduleShieldImpactVFX(sourceToken, targetToken, impactPoint, options = {}) {
  const delayMs = Math.max(0, Math.round(_number(options.delayMs, 0)));
  if (delayMs <= 0) {
    playShieldImpactVFX(sourceToken, targetToken, impactPoint, options);
    return;
  }
  window.setTimeout(() => playShieldImpactVFX(sourceToken, targetToken, impactPoint, options), delayMs);
}

export function scheduleHullImpactVFX(targetToken, impactPoint, options = {}) {
  const delayMs = Math.max(0, Math.round(_number(options.delayMs, 0)));
  if (delayMs <= 0) {
    playHullImpactVFX(targetToken, impactPoint, options);
    return;
  }
  window.setTimeout(() => playHullImpactVFX(targetToken, impactPoint, options), delayMs);
}

export async function playShieldImpactVFX(sourceToken, targetToken, impactPoint, options = {}) {
  if (!_settingEnabled()) return;
  if (!targetToken || !(options.preShields > 0)) return;

  const location = _impactLocation(targetToken, impactPoint);
  const color = resolveShieldImpactColorHex(targetToken);

  // The bubble places its glow along the ray from the emitter to where the shot
  // was AIMED, which is not `location` once the shields turn it away at the
  // envelope — that would collapse the ray to a point and pin the glow to the
  // crossing every time. Callers that retarget pass the original hull point.
  const hullPoint = options.hullPoint ?? location;

  // The bubble is native PIXI and stands on its own — worlds without Sequencer
  // installed still get a shield hit, they just do not get the flash over it.
  if (_bubbleEnabled()) {
    playShieldBubble(targetToken, hullPoint, {
      color,
      // The same depth the fire path used to decide where the shot stops.
      capT: options.capT,
      // Which side of the hull lights up. The firing emitter when the caller
      // knows it, otherwise the attacker's centre — NOT `location`, which is a
      // random opaque pixel somewhere inside the target's art.
      sourcePoint: options.sourcePoint ?? sourceToken?.center ?? null,
      finalDamage: options.finalDamage,
      maxShields: options.maxShields,
      shieldBroke: options.shieldBroke,
    });
  }

  if (!globalThis.Sequence) return;

  try {
    const scale = _shieldImpactScale(targetToken, options);
    const flash = _impactFlash(color);
    const s = new Sequence();
    _tinted(s.effect().file(flash.file).atLocation(location), flash.tint)
      .scale(scale)
      .fadeIn(60)
      .fadeOut(options.shieldBroke ? 520 : 360);

    if (options.shieldBroke) {
      _tinted(s.wait(90).effect().file(flash.file).atLocation(location), flash.tint)
        .scale(Math.min(0.9, scale * 1.22))
        .opacity(0.72)
        .fadeIn(40)
        .fadeOut(620);
    }

    await s.play();
  } catch (err) {
    console.warn("STA2e Toolkit | Shield impact JB2A effect failed:", err);
  }
}

export async function playHullImpactVFX(targetToken, impactPoint, options = {}) {
  if (!targetToken || !options.shieldsDown) return;
  if (!globalThis.Sequence) return;

  try {
    const location = _impactLocation(targetToken, impactPoint);
    const scale = _clamp(_shieldImpactScale(targetToken, {
      ...options,
      preShields: 1,
      maxShields: options.maxShields ?? 8,
    }) * 1.35, 0.35, 1.05);
    const s = new Sequence();
    s.effect()
      .file(HULL_IMPACT_EFFECT)
      .atLocation(location)
      .scale(scale)
      .fadeIn(40)
      .fadeOut(560);
    await s.play();
  } catch (err) {
    console.warn("STA2e Toolkit | Hull impact JB2A effect failed:", err);
  }
}
