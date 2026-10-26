/**
 * sta2e-toolkit | random-teleport-pick.js
 *
 * Which destination a Random Teleport sends a token to. A leaf with no
 * imports, so tests/random-teleport.mjs can load it under node.
 *
 * Three steps, each skipped rather than allowed to leave nothing:
 *   1. drop occupied destinations   (all full → every destination again)
 *   2. drop the previous pick       (only when another one is left)
 *   3. weighted pick                (weights 1–10, default 1)
 */

export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 10;

/** A Region's stored weight as a whole number in range; blank or junk is 1. */
export function normalizeWeight(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || value === null || value === "") return WEIGHT_MIN;
  return Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, n));
}

/**
 * @template T
 * @param {T[]} candidates                    Each needs a `uuid`.
 * @param {object} [options]
 * @param {boolean} [options.avoidOccupied]
 * @param {string|null} [options.lastUuid]    The previous pick, when no-repeat is on.
 * @param {(c: T) => boolean} [options.isOccupied]
 * @param {(c: T) => *} [options.weightOf]    Raw weight; normalised here.
 * @param {() => number} [options.random]     [0, 1), Math.random by default.
 * @returns {T|null}
 */
export function pickDestination(candidates, {
  avoidOccupied = false, lastUuid = null, isOccupied = () => false,
  weightOf = () => WEIGHT_MIN, random = Math.random,
} = {}) {
  let pool = [...(candidates ?? [])].filter(Boolean);
  if (!pool.length) return null;

  if (avoidOccupied) {
    const free = pool.filter(c => !isOccupied(c));
    if (free.length) pool = free;
  }

  if (lastUuid && pool.length > 1) {
    const fresh = pool.filter(c => c.uuid !== lastUuid);
    if (fresh.length) pool = fresh;
  }

  const weights = pool.map(c => normalizeWeight(weightOf(c)));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll < 0) return pool[i];
  }
  return pool.at(-1);
}
