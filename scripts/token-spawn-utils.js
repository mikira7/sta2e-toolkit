/**
 * sta2e-toolkit | token-spawn-utils.js
 *
 * Shared helpers for creating tokens from an actor's prototype — used by the
 * transporter beam-in and the ship spawner, which had independent copies of the
 * same wildcard resolution and the same prototype merge.
 *
 * An actor with an Appearances library (appearance-data.js) never reaches the
 * wildcard roll: its look is picked from the stored list, which cannot fail and
 * cannot land a portrait on the map.
 */

import {
  readLibrary, hasLooks, applyCreationAppearance, classifyImage, parseKeywords, stateIsDressed,
} from "./appearance-data.js";

/** Portrait keywords from settings, read defensively. */
function _portraitKeywords() {
  try { return parseKeywords(game.settings.get("sta2e-toolkit", "appearancePortraitKeywords")); }
  catch { return ["portrait"]; }
}

/**
 * Every file matching a wildcard prototype-token path (`.../ship-*.webp`).
 * @returns {Promise<string[]>} Empty on any browse failure — callers fall back
 *   to the literal path, which Foundry renders as a broken image rather than
 *   failing the spawn.
 */
export async function getWildcardImages(wildcardPath) {
  const lastSlash = wildcardPath.lastIndexOf("/");
  const directory = wildcardPath.substring(0, lastSlash);
  const pattern   = wildcardPath.substring(lastSlash + 1);
  try {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
    const response = await FP.browse("data", directory);
    if (response?.files) {
      // Escape everything but the wildcards: an unescaped "." matched any
      // character, and only the first "*" was ever expanded.
      const source = pattern.split("*").map(p => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
      const regex = new RegExp("^" + source + "$", "i");
      const matches = response.files.filter(f => regex.test(decodeURIComponent(f.split("/").pop())));
      // `Klingon*` matches `Klingon_portrait.webp` as happily as the token art —
      // which is how a beam-in used to put a portrait on the map. Drop portraits,
      // unless that would leave nothing at all.
      const portraitKeywords = _portraitKeywords();
      const tokens = matches.filter(f => classifyImage(f, { portraitKeywords, tokenKeywords: [] }) !== "portrait");
      return tokens.length ? tokens : matches;
    }
  } catch (e) {
    console.warn("STA2e Toolkit | wildcard browse failed:", e);
  }
  return [];
}

/** One random image from a wildcard path, or the path itself if none match. */
export async function getWildcardImage(wildcardPath) {
  try {
    const images = await getWildcardImages(wildcardPath);
    if (images?.length > 0) return images[Math.floor(Math.random() * images.length)];
  } catch { /* fall through */ }
  return wildcardPath;
}

/**
 * Token data for a new placeable, built from the actor's prototype token.
 *
 * The prototype carries every field the scene needs (bars, sight, disposition,
 * flags, ring config, …), so merging over `toObject()` keeps new Foundry fields
 * working without this having to know about them.
 *
 * @param {Actor}  actor
 * @param {object} opts
 * @param {string} [opts.name]      Display name; defaults to the prototype's
 * @param {number} opts.x           Top-left canvas x
 * @param {number} opts.y           Top-left canvas y
 * @param {number} [opts.rotation]  Foundry token rotation in degrees
 * @param {number} [opts.alpha]     Starting alpha — spawn effects use 0
 * @param {{state: object, portrait: string|null}|null} [opts.appearance]
 *   A captured appearance (`captureAppearance`) — a restored transporter
 *   pattern comes back with the same face and portrait instead of a new roll.
 * @returns {Promise<object>} Token creation data
 */
export async function buildSpawnTokenData(actor, { name, x, y, rotation, alpha, appearance = null } = {}) {
  const proto      = actor.prototypeToken;
  const protoImg   = proto?.texture?.src ?? proto?.img;
  const isWildcard = proto?.randomImg ?? false;

  const overrides = { x, y, actorId: actor.id };
  if (name != null)     overrides.name     = name;
  if (rotation != null) overrides.rotation = rotation;
  if (alpha != null)    overrides.alpha    = alpha;

  const data = foundry.utils.mergeObject(proto.toObject(), overrides);

  // Appearances first. On an unlinked token this always stamps the state flag,
  // which is what tells the preCreateToken roll to stand aside.
  const library = readLibrary(actor);
  const actorState = data.actorLink ? actor.getFlag("sta2e-toolkit", "appearanceState") : null;
  // A linked figure carries its look or mimic onto any scene — looks or not.
  if (appearance?.state || hasLooks(library) || stateIsDressed(actorState)) {
    if (applyCreationAppearance(data, library, { actorState, override: appearance })) return data;
  }

  if (isWildcard) {
    const img = await getWildcardImage(protoImg);
    if (img !== protoImg) {
      data.texture = foundry.utils.mergeObject(data.texture ?? {}, { src: img });
    }
  }
  return data;
}

/**
 * What a token is wearing, for a buffer entry — restored by passing it back to
 * `buildSpawnTokenData` as `appearance`. Null for a linked token (its actor
 * already carries its look) or one with no Appearances state.
 *
 * @param {TokenDocument} tokenDoc
 */
export function captureAppearance(tokenDoc) {
  if (!tokenDoc || tokenDoc.actorLink) return null;
  const state = tokenDoc.getFlag?.("sta2e-toolkit", "appearanceState");
  if (!state) return null;
  return { state: foundry.utils.deepClone(state), portrait: tokenDoc.delta?.img ?? null };
}

/** True when an actor's art comes from an Appearances library, not its wildcard. */
export function usesAppearances(actor) {
  return hasLooks(readLibrary(actor));
}

/**
 * Half a token's rendered footprint, for converting a centre point to top-left.
 * Reads the *prototype*, so it works before the token exists.
 */
export function protoHalfSize(actor) {
  const gridSize = canvas?.grid?.size ?? 100;
  const proto = actor?.prototypeToken;
  return {
    halfW: ((proto?.width  ?? 1) * gridSize) / 2,
    halfH: ((proto?.height ?? 1) * gridSize) / 2,
  };
}
