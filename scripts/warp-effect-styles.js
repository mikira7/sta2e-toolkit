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
 * shipVfxAnchors flag is read directly instead; it is a plain object, and
 * faction detection comes from actor-faction.js, the leaf module that half was
 * split into for exactly this reason.
 */

import { actorHasTrait } from "./trait-service.js";
import { resolveActorFactionKey } from "./actor-faction.js";

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
 * - `stretch`       how far the ship's own hull elongates along its heading as
 *                   it enters and leaves the effect, as `{max, squeeze}`, or
 *                   null for a style whose ship does not deform. `max` is the
 *                   multiplier along the nose axis at full smear (scaled by the
 *                   GM percent) and `squeeze` is how much of the volume-
 *                   preserving narrowing to apply across the beam, 0..1. Only a
 *                   style that reads as *acceleration* wants this: a rift is a
 *                   portal the ship flies through at its normal size, so both
 *                   rifts leave it null. See warp-stretch-vfx.js.
 * - `requiresTrait` actor trait gating this style, or null for always-available.
 * - `family`        styles sharing a family are faction variants of one effect.
 *                   null for a style that stands alone.
 * - `faction`       the resolveActorFactionKey() key this variant dresses for,
 *                   or null for the family's generic variant. A faction variant
 *                   *replaces* the generic one for ships of that faction rather
 *                   than sitting beside it — a Cardassian timeship is never
 *                   offered the Federation rift.
 * - `icon`          Font Awesome class for the per-use Warp Out dialog button.
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
    // 7x reads as a hard smear without turning the hull into a featureless band;
    // the squeeze is partial because a fully volume-preserving narrowing at that
    // elongation leaves a sliver rather than a ship.
    stretch: Object.freeze({ max: 7, squeeze: 0.45 }),
    requiresTrait: null,
    family: null,
    faction: null,
    icon: "fas fa-bolt",
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
    // No hull stretch: the ship coasts through an aperture at its normal size
    // rather than accelerating away, which is the whole point of flyThrough.
    stretch: null,
    requiresTrait: "Timeship",
    family: "rift",
    faction: null,
    icon: "fas fa-clock-rotate-left",
    soundKeys: Object.freeze({ depart: "sndTemporalRift", arrive: "sndTemporalRift" }),
  }),
  // The same portal dressed for the Cardassian Union. Identical staging to the
  // generic rift — only the clip and its tuning keys differ — but it owns its
  // own scale/peak/sound settings because it is a differently authored asset
  // with its own margins and its own decisive frame.
  cardassianTemporalRift: Object.freeze({
    id: "cardassianTemporalRift",
    label: "Cardassian Temporal Rift",
    src: "modules/sta2e-toolkit/assets/vfx/Cardassian-Temporal-Rift.webm",
    peakMs: 2500,
    peakSettingKey: "warpCardassianRiftPeakMs",
    scaleMul: 7,
    scaleSettingKey: "warpCardassianRiftScale",
    tailMs: 250,
    corridor: false,
    orientToHeading: true,
    rotationOffsetDeg: 0,
    transit: Object.freeze({
      inSquares: 2.5, outSquares: 2.5,
      inMs: null, outMs: 900,
      flyThrough: true,
    }),
    // No hull stretch: the ship coasts through an aperture at its normal size
    // rather than accelerating away, which is the whole point of flyThrough.
    stretch: null,
    requiresTrait: "Timeship",
    family: "rift",
    faction: "cardassian",
    icon: "fas fa-clock-rotate-left",
    soundKeys: Object.freeze({ depart: "sndCardassianTemporalRift", arrive: "sndCardassianTemporalRift" }),
  }),
  // Q's snap. The standard warp clip run through a desaturate, because sprite
  // tint multiplies and so cannot turn a blue asset white — see `whiten` and
  // its handling in warp-jump-vfx.js#_webmFlash.
  //
  // `hidden` keeps it out of every style picker: it is not a way for a ship to
  // warp, it is what happens when Q decides you are somewhere else now. The Q
  // spawner passes the id explicitly.
  qFlash: Object.freeze({
    id: "qFlash",
    label: "Q Flash",
    src: "modules/sta2e-toolkit/assets/vfx/Warp-Flash.webm",
    // Faster than a warp jump — a snap of the fingers has no wind-up.
    peakMs: 450,
    peakSettingKey: "qFlashPeakMs",
    scaleMul: 6,
    scaleSettingKey: "qFlashScale",
    tailMs: 250,
    corridor: false,
    // A radial burst, and Q has no direction of travel to orient to.
    orientToHeading: false,
    rotationOffsetDeg: 0,
    // Never read — nothing flies into a Q flash — but present so anything
    // walking the registry finds the shape it expects.
    transit: Object.freeze({
      inSquares: 0, outSquares: 0,
      inMs: 0, outMs: 0,
      flyThrough: false,
    }),
    // Nothing accelerates into a snap of the fingers.
    stretch: null,
    requiresTrait: null,
    family: null,
    faction: null,
    hidden: true,
    whiten: true,
    icon: "fas fa-hand-sparkles",
    soundKeys: Object.freeze({ depart: "sndQFlashOut", arrive: "sndQFlashIn" }),
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

/**
 * Whether this actor may use the style at all. Three gates, in order:
 *
 * 1. the trait gate — the ship must carry `requiresTrait`;
 * 2. a faction variant is offered only to ships of that faction;
 * 3. a family's *generic* variant is withdrawn once a faction variant of the
 *    same family is available, so a Cardassian timeship is offered the
 *    Cardassian rift instead of the Federation one, not as well as it.
 *
 * An ungated style still short-circuits to true on the first line, so the
 * standard flash provably cannot regress.
 */
export function warpEffectStyleAvailableFor(actor, styleId) {
  const style = WARP_EFFECT_STYLES[normalizeWarpEffectStyleId(styleId)];
  if (!style.requiresTrait && !style.faction && !style.family) return true;
  if (style.requiresTrait && !actorHasTrait(actor, style.requiresTrait)) return false;
  if (style.faction) return resolveActorFactionKey(actor) === style.faction;
  return !_factionVariantFor(actor, style.family);
}

/**
 * The faction-specific member of `family` this actor qualifies for, or null.
 * Its own trait gate still has to pass — a Cardassian ship without the Timeship
 * trait has no rift of any kind, so nothing should be withdrawn from it.
 */
function _factionVariantFor(actor, family) {
  if (!family) return null;
  const factionKey = resolveActorFactionKey(actor);
  if (!factionKey) return null;
  return Object.values(WARP_EFFECT_STYLES).find(style =>
    style.family === family
    && style.faction === factionKey
    && (!style.requiresTrait || actorHasTrait(actor, style.requiresTrait))
  ) ?? null;
}

/**
 * Upgrade a style id to the variant this actor should actually fly — the plain
 * Temporal Rift becomes the Cardassian one for a Cardassian timeship.
 *
 * This substitution has to happen on the client that *initiates* the effect,
 * because playWarpFlash sends only a style id over the socket and the receiving
 * clients resolve it with no actor in hand. It doubles as the migration path:
 * ships that saved "temporalRift" before this existed upgrade on read.
 */
export function resolveFactionVariantId(actorOrToken, styleId) {
  const id = normalizeWarpEffectStyleId(styleId);
  const style = WARP_EFFECT_STYLES[id];
  if (!style.family || style.faction) return id;
  return _factionVariantFor(_resolveActor(actorOrToken), style.family)?.id ?? id;
}

/** The generic (faction-less) member of a family, used as a degrade target. */
function _familyGenericId(family) {
  if (!family) return null;
  return Object.values(WARP_EFFECT_STYLES)
    .find(style => style.family === family && !style.faction)?.id ?? null;
}

/**
 * Substitute, then validate, then degrade — the single decision point behind
 * both public resolvers.
 *
 * The degrade chain is: the id asked for -> this actor's faction variant of it
 * -> the family's generic variant -> the standard flash. Stepping through the
 * family before falling all the way back matters twice over: it keeps the Ship
 * Spawner's one dialog-wide "Temporal Rift" meaningful across a mixed fleet,
 * and it means renaming a Cardassian timeship drops it to the plain rift rather
 * than silently costing it the rift altogether.
 */
function _resolveForActor(actorOrToken, styleId) {
  const actor = _resolveActor(actorOrToken);
  const wanted = resolveFactionVariantId(actor, styleId);
  if (warpEffectStyleAvailableFor(actor, wanted)) return wanted;
  const generic = _familyGenericId(WARP_EFFECT_STYLES[wanted].family);
  if (generic && warpEffectStyleAvailableFor(actor, generic)) return generic;
  return DEFAULT_WARP_EFFECT_STYLE_ID;
}

/**
 * Dropdown options for one actor. A ship with no gated styles available gets a
 * single-entry list, which is what the editor uses to hide the row entirely.
 */
export function getWarpEffectStyleOptions(actor) {
  return Object.values(WARP_EFFECT_STYLES)
    // `hidden` styles are not ways for a ship to warp — the Q flash is asked
    // for by id, never chosen from a list.
    .filter(style => !style.hidden && warpEffectStyleAvailableFor(actor, style.id))
    .map(style => ({ value: style.id, label: style.label, icon: style.icon }));
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
 * The style id this ship should warp with. Re-resolved on every read rather
 * than trusted from the flag: stripping the Timeship trait off an actor
 * immediately drops it back to the standard flash, and a Cardassian ship
 * holding the generic rift is upgraded to the Cardassian one — which is how
 * ships saved before that variant existed migrate without a data pass.
 */
export function resolveShipWarpEffectStyleId(actorOrToken) {
  const actor = _resolveActor(actorOrToken);
  if (!actor) return DEFAULT_WARP_EFFECT_STYLE_ID;
  let stored = "";
  try {
    stored = actor.getFlag(MODULE, SHIP_VFX_ANCHORS_FLAG)?.settings?.warpEffect?.style ?? "";
  } catch { /* no flag / unreadable actor */ }
  return _resolveForActor(actor, stored);
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
  return getWarpEffectStyle(_resolveForActor(actorOrToken, requestedId));
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
