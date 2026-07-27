/**
 * sta2e-toolkit | token-spawn-utils.js
 *
 * Shared helpers for creating tokens from an actor's prototype — used by the
 * transporter beam-in and the ship spawner, which had independent copies of the
 * same wildcard resolution and the same prototype merge.
 */

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
      const regex = new RegExp("^" + pattern.replace("*", ".*") + "$");
      return response.files.filter(f => regex.test(f.split("/").pop()));
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
 * @returns {Promise<object>} Token creation data
 */
export async function buildSpawnTokenData(actor, { name, x, y, rotation, alpha } = {}) {
  const proto      = actor.prototypeToken;
  const protoImg   = proto?.texture?.src ?? proto?.img;
  const isWildcard = proto?.randomImg ?? false;

  const overrides = { x, y, actorId: actor.id };
  if (name != null)     overrides.name     = name;
  if (rotation != null) overrides.rotation = rotation;
  if (alpha != null)    overrides.alpha    = alpha;

  const data = foundry.utils.mergeObject(proto.toObject(), overrides);

  if (isWildcard) {
    const img = await getWildcardImage(protoImg);
    if (img !== protoImg) {
      data.texture = foundry.utils.mergeObject(data.texture ?? {}, { src: img });
    }
  }
  return data;
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
