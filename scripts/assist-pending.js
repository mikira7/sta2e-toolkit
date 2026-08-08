/**
 * sta2e-toolkit | assist-pending.js
 * Single owner of the `flags.sta2e-toolkit.assistPending` token flag.
 *
 * The flag is how a declared Assist / Assist Command / Direct reaches the roller:
 * the declaring HUD writes an entry keyed by the *target's* station id (or "ground"
 * for personal combat), and the roller reads that key when the directed officer
 * next takes a task, turning each entry into a "Roll Assist Die" button on the
 * Working Task card.
 *
 * Shape: { [stationId|"ground"]: [{ name, actorId, type }, ...] }
 *   • `type` is "direct" for Direct (always rolls Control + Command),
 *     "methodical-planning" for that talent, otherwise absent/"assist".
 *   • Legacy worlds may hold a bare string or a single object under the key;
 *     both are normalised to an array on the next write.
 *
 * Writes route themselves. The declaring user is very often a player who has no
 * update permission on the target token (another PC's token, or a ship token they
 * only observe), so every mutation falls back to a socket request that the
 * responsible GM executes. Previously these writes were wrapped in
 * `if (game.user.isGM)` with no fallback, which silently dropped every
 * player-declared assist.
 */

const MODULE   = "sta2e-toolkit";
const FLAG_KEY = "assistPending";

/** Normalise whatever is stored under a key into an array of entry objects. */
function _toArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") return [{ name: raw, actorId: null }];
  return [raw];   // legacy single-object
}

/** Ask the responsible GM to perform a mutation this user cannot make itself. */
function _requestFromGm(tokenDoc, op, key, entry) {
  game.socket.emit(`module.${MODULE}`, {
    action:  "assistPendingUpdate",
    op,
    sceneId: tokenDoc.parent?.id ?? tokenDoc.scene?.id ?? null,
    tokenId: tokenDoc.id,
    key,
    entry:   entry ?? null,
  });
}

/**
 * Declare a pending assist on a token.
 *
 * Entries stack — a station can carry a Direct from the captain and an Assist from
 * another officer at the same time — but the same actor cannot declare the same
 * kind of assist for the same key twice.
 *
 * @param {TokenDocument} tokenDoc  Token the assist is being declared *for*.
 * @param {string}        key       Station id, or "ground" for personal combat.
 * @param {object}        entry     { name, actorId, type? }
 */
export async function addAssistPending(tokenDoc, key, entry) {
  if (!tokenDoc || !key || !entry) return;

  if (!tokenDoc.canUserModify(game.user, "update")) {
    _requestFromGm(tokenDoc, "add", key, entry);
    return;
  }

  try {
    const arr  = _toArray((tokenDoc.getFlag(MODULE, FLAG_KEY) ?? {})[key]);
    // Guard: the same actor cannot declare the same kind of assist twice for one key.
    // Name is part of the identity so two unnamed NPC-crew assists still stack.
    const dupe = arr.some(a =>
      (a.actorId ?? null) === (entry.actorId ?? null) &&
      (a.type    ?? null) === (entry.type    ?? null) &&
      (a.name    ?? null) === (entry.name    ?? null));
    if (dupe) return;
    arr.push(entry);
    // Write the single key path: mergeObject treats arrays as atomic, so this
    // replaces the entry list (and any legacy string/object value) cleanly.
    await tokenDoc.update({ [`flags.${MODULE}.${FLAG_KEY}.${key}`]: arr });
  } catch (e) {
    console.warn("STA2e Toolkit | Could not set assistPending flag:", e);
  }
}

/**
 * Remove a key's pending assists once the task is resolved (or abandoned).
 *
 * Uses Foundry's `-=key` deletion syntax in a raw update(): setFlag/unsetFlag route
 * through mergeObject, which *merges* nested objects rather than replacing them, so
 * a spread-delete-then-setFlag silently leaves the key intact — particularly on
 * unlinked (wildcard) tokens.
 *
 * @param {TokenDocument} tokenDoc
 * @param {string}        key  Station id, or "ground".
 */
export async function clearAssistPending(tokenDoc, key) {
  if (!tokenDoc || !key) return;

  const existing = tokenDoc.getFlag(MODULE, FLAG_KEY) ?? {};
  if (!(key in existing)) return;   // nothing to clear

  if (!tokenDoc.canUserModify(game.user, "update")) {
    _requestFromGm(tokenDoc, "clear", key, null);
    return;
  }

  try {
    await tokenDoc.update({ [`flags.${MODULE}.${FLAG_KEY}.-=${key}`]: null });
  } catch (e) {
    console.warn("STA2e Toolkit | Could not clear assistPending flag:", e);
  }
}

/**
 * GM-side executor for a socketed request. Called only from the socket listener
 * in main.js, which has already resolved the token document and checked that this
 * client is the responsible GM.
 */
export async function applyAssistPendingRequest(tokenDoc, op, key, entry) {
  if (op === "add")   return addAssistPending(tokenDoc, key, entry);
  if (op === "clear") return clearAssistPending(tokenDoc, key);
  console.warn(`STA2e Toolkit | assistPendingUpdate: unknown op "${op}"`);
}
