/**
 * sta2e-toolkit | warp-effect-styles.js
 *
 * The registry of warp flash styles — which clip plays, how big it draws, when
 * its peak lands, and whether it draws a corridor. Split out of warp-jump-vfx.js
 * so the anchors editor and the Sounds & Animations menu can read the label list
 * without pulling in PIXI and Sequencer.
 *
 * Deliberately does NOT import ship-vfx-anchors.js — that would close an import
 * cycle (ship-vfx-anchors.js imports this file for the editor dropdown). The
 * shipVfxAnchors flag is read directly instead; it is a plain object.
 */

import { actorHasTrait } from "./trait-service.js";

const MODULE = "sta2e-toolkit";
const SHIP_VFX_ANCHORS_FLAG = "shipVfxAnchors";

/**
 * Every style is one webm played as an additive PIXI video sprite.
 *
 * - `peakMs`        when the clip's decisive frame lands — the moment the ship
 *                   vanishes (depart) or materialises (arrive). Not the clip
 *                   length; the tail plays on over empty space.
 * - `peakSettingKey` world setting that overrides `peakMs`, or null to pin it.
 * - `scaleMul`      multiplier on the token radius, before the GM's percent.
 * - `scaleSettingKey` world setting holding that percent. Each style owns its
 *                   own, so sizing one never resizes the other.
 * - `tailMs`        how long the depart/arrive beat runs past the peak.
 * - `corridor`      whether the jump also draws the streak between endpoints.
 * - `orientToHeading` whether the clip rotates to face the ship's direction of
 *                   travel. A radial burst leaves this false and draws upright.
 * - `rotationOffsetDeg` correction between the clip's own "forward" and the
 *                   canvas bearing, applied only when orientToHeading is set.
 * - `transit`       how the ship approaches and leaves the effect. See below.
 * - `requiresTrait` actor trait gating this style, or null for always-available.
 * - `soundKeys`     per-phase setting keys; a blank setting falls back to the
 *                   caller's own soundKey, so an unconfigured style is silent
 *                   in exactly the way the standard warp already is.
 *
 * `transit` controls the ship's own movement around the effect:
 * - `inSquares` / `outSquares` how far it runs up to / away from the effect, in
 *   grid squares. Still capped as a fraction of the trip by _warpVector.
 * - `inMs`      approach duration; null means "stretch it to span the aperture",
 *               resolved by the runner against the style's peak.
 * - `outMs`     departure-from-the-effect duration.
 * - `flyThrough` true when the ship should visibly travel *through* the effect
 *   rather than flash in place. The runners then open the effect first and fly
 *   the ship into it, and let it keep moving as it emerges, instead of the
 *   standard short lurch → flash → hold.
 */
export const WARP_EFFECT_STYLES = Object.freeze({
  standard: Object.freeze({
    id: "standard",
    label: "Standard Warp Flash",
    src: "modules/sta2e-toolkit/assets/vfx/Warp-Flash.webm",
    peakMs: 750,
    peakSettingKey: null,
    scaleMul: 6,
    scaleSettingKey: "warpFlashScale",
    tailMs: 250,
    corridor: true,
    // A radial burst — rotating it would change nothing, so it stays pinned
    // upright and this path provably cannot shift.
    orientToHeading: false,
    rotationOffsetDeg: 0,
    // Matches WARP_RUN_IN/OUT_SQUARES and WARP_RUN_IN/OUT_MS in
    // ship-card-movement.js — the standard warp's long-standing behaviour.
    transit: Object.freeze({
      inSquares: 0.75, outSquares: 1.0,
      inMs: 320, outMs: 380,
      flyThrough: false,
    }),
    requiresTrait: null,
    soundKeys: null,
  }),
  // A rift is a portal rather than a streak, so it skips the corridor and runs
  // several times longer than the standard flash — hence per-style timing.
  temporalRift: Object.freeze({
    id: "temporalRift",
    label: "Temporal Rift",
    src: "modules/sta2e-toolkit/assets/vfx/Temporal-Rift.webm",
    peakMs: 2500,
    peakSettingKey: "warpRiftPeakMs",
    scaleMul: 7,
    scaleSettingKey: "warpRiftScale",
    tailMs: 250,
    corridor: false,
    // The rift is directional, so it turns to face the way the ship is going.
    // The clip's art points 90 deg off the canvas bearing — the same correction
    // the movement runners apply when they set token rotation to `angle - 90`.
    orientToHeading: true,
    rotationOffsetDeg: -90,
    // The ship flies through the aperture rather than vanishing at it. inMs is
    // null so the approach stretches across however long the rift takes to
    // open — otherwise the ship would lurch 320ms and then sit motionless for
    // two seconds waiting on the peak.
    transit: Object.freeze({
      inSquares: 2.5, outSquares: 2.5,
      inMs: null, outMs: 900,
      flyThrough: true,
    }),
    requiresTrait: "Timeship",
    soundKeys: Object.freeze({ depart: "sndTemporalRift", arrive: "sndTemporalRift" }),
  }),
});

export const DEFAULT_WARP_EFFECT_STYLE_ID = "standard";

// Sentinel for "no explicit choice — use whatever this ship defaults to".
// Distinct from a style id so a control can offer it as a real third option.
export const WARP_STYLE_AUTO = "auto";

// Bounds on a GM-set peak. Cannot be validated against the real clip length —
// that is only known asynchronously, on each client, once the video decodes.
const PEAK_MIN_MS = 100;
const PEAK_MAX_MS = 10000;

/** Any unknown or blank id collapses to the standard flash. */
export function normalizeWarpEffectStyleId(styleId) {
  const id = String(styleId ?? "");
  return Object.hasOwn(WARP_EFFECT_STYLES, id) ? id : DEFAULT_WARP_EFFECT_STYLE_ID;
}

/**
 * The style entry with its peak resolved through the GM setting. Tolerates the
 * setting not being registered yet — same guard as warp-jump-vfx's flash scale,
 * since VFX code can run before settings are wired on a slow init.
 */
export function getWarpEffectStyle(styleId) {
  const style = WARP_EFFECT_STYLES[normalizeWarpEffectStyleId(styleId)];
  if (!style.peakSettingKey) return style;
  let peakMs = style.peakMs;
  try {
    const configured = Number(game.settings.get(MODULE, style.peakSettingKey));
    if (Number.isFinite(configured) && configured > 0) {
      peakMs = Math.max(PEAK_MIN_MS, Math.min(PEAK_MAX_MS, configured));
    }
  } catch { /* setting not registered yet — keep the built-in peak */ }
  return { ...style, peakMs };
}

/**
 * Per-style replacement for the WARP_FLASH_PEAK_MS / WARP_DEPART_MS /
 * WARP_ARRIVE_MS constants. For "standard" this returns {750, 1000, 1000} —
 * byte-identical to those constants, so the standard warp cannot regress.
 */
export function getWarpFlashTiming(styleId) {
  const style = getWarpEffectStyle(styleId);
  const peakMs = style.peakMs;
  return {
    peakMs,
    departMs: peakMs + style.tailMs,
    arriveMs: peakMs + style.tailMs,
  };
}

/** Whether this actor may use the style at all (the trait gate). */
export function warpEffectStyleAvailableFor(actor, styleId) {
  const style = WARP_EFFECT_STYLES[normalizeWarpEffectStyleId(styleId)];
  if (!style.requiresTrait) return true;
  return actorHasTrait(actor, style.requiresTrait);
}

/**
 * Dropdown options for one actor. A ship with no gated styles available gets a
 * single-entry list, which is what the editor uses to hide the row entirely.
 */
export function getWarpEffectStyleOptions(actor) {
  return Object.values(WARP_EFFECT_STYLES)
    .filter(style => warpEffectStyleAvailableFor(actor, style.id))
    .map(style => ({ value: style.id, label: style.label }));
}

/**
 * Whether this ship has more than one effect to pick between — i.e. whether it
 * is worth asking. Everything that offers a choice gates on this, so a ship
 * without the trait never grows UI it cannot use.
 */
export function shipHasWarpEffectChoice(actorOrToken) {
  return getWarpEffectStyleOptions(_resolveActor(actorOrToken)).length > 1;
}

function _resolveActor(actorOrToken) {
  if (!actorOrToken) return null;
  if (actorOrToken.documentName === "Actor") return actorOrToken;
  return actorOrToken.actor ?? actorOrToken.document?.actor ?? null;
}

/**
 * The style id this ship should warp with. Re-checks the trait gate on read, so
 * stripping the Timeship trait off an actor immediately drops it back to the
 * standard flash rather than leaving a stale selection in the flag.
 */
export function resolveShipWarpEffectStyleId(actorOrToken) {
  const actor = _resolveActor(actorOrToken);
  if (!actor) return DEFAULT_WARP_EFFECT_STYLE_ID;
  let stored = "";
  try {
    stored = actor.getFlag(MODULE, SHIP_VFX_ANCHORS_FLAG)?.settings?.warpEffect?.style ?? "";
  } catch { /* no flag / unreadable actor */ }
  const styleId = normalizeWarpEffectStyleId(stored);
  return warpEffectStyleAvailableFor(actor, styleId) ? styleId : DEFAULT_WARP_EFFECT_STYLE_ID;
}

/** Resolved style entry for a ship, peak and all. */
export function getShipWarpEffectStyle(actorOrToken) {
  return getWarpEffectStyle(resolveShipWarpEffectStyleId(actorOrToken));
}

/**
 * The style to actually use for one action, given what the caller asked for.
 *
 * A blank or "auto" request falls back to the ship's own default, so the
 * per-ship setting stays meaningful. An explicit request is honoured only if
 * the actor may actually use it — the request can arrive from a player over a
 * socket or from a stale dialog, so the trait gate is re-checked here rather
 * than trusted. This is the single place that decision is made.
 */
export function resolveRequestedWarpStyle(actorOrToken, requestedId) {
  if (!requestedId || requestedId === WARP_STYLE_AUTO) {
    return getShipWarpEffectStyle(actorOrToken);
  }
  const actor = _resolveActor(actorOrToken);
  return warpEffectStyleAvailableFor(actor, requestedId)
    ? getWarpEffectStyle(requestedId)
    : getWarpEffectStyle(DEFAULT_WARP_EFFECT_STYLE_ID);
}

/**
 * The sound setting key to play for one phase of a style. A style-specific key
 * only wins when the GM has actually pointed it at a file; otherwise the
 * caller's normal warp sound plays, so adding a style changes nothing audibly
 * until it is configured.
 */
export function resolveWarpSoundKey(style, phase, fallbackKey) {
  const key = style?.soundKeys?.[phase];
  if (!key) return fallbackKey;
  try {
    const src = game.settings.get(MODULE, key);
    if (typeof src === "string" && src.trim()) return key;
  } catch { /* setting not registered yet */ }
  return fallbackKey;
}
