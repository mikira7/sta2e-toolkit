/**
 * sta2e-toolkit | gm-authority.js
 *
 * Which GM is *the* GM. Some tables seat players on GM-role accounts; Foundry
 * treats every one of them as a full GM, so the toolkit needs its own answer
 * for three things: who executes privileged socket work (exactly one client),
 * who receives GM-only whispers, and who may see what the toolkit hides.
 *
 * The designated user lives in the world setting `activeGmUserId`, chosen from
 * the Stardate HUD badge. When that user is offline or no longer a GM, the
 * fallback is the rule `_isResponsibleGM` has always used — the lowest-id
 * connected GM — so the table never stalls waiting for someone who left.
 *
 * Every other GM-role user is an **assistant GM**: they keep the GM tools, but
 * are treated as a player for authority, GM-only cards and hidden information.
 *
 * A leaf with no imports: it is consulted from the socket handler, the
 * visibility wrapper and chat card builders, and must not close a cycle.
 */

const MODULE = "sta2e-toolkit";
export const ACTIVE_GM_SETTING = "activeGmUserId";

function _users() {
  const users = game.users;
  if (!users) return [];
  return users.contents ?? (typeof users.filter === "function" ? users.filter(() => true) : []);
}

function _designatedId() {
  try { return game.settings.get(MODULE, ACTIVE_GM_SETTING) || ""; }
  catch { return ""; }
}

/** The GM-role users currently connected, in the stable fallback order. */
export function connectedGMs() {
  return _users()
    .filter(u => u?.active && u.isGM)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** The designated user id, even when that user is offline. "" when unset. */
export function designatedGmId() {
  return _designatedId();
}

/**
 * The GM who holds authority right now: the designated user if connected and
 * still a GM, otherwise the lowest-id connected GM. Null with no GM online.
 */
export function getActiveGM() {
  const id = _designatedId();
  if (id) {
    const u = game.users?.get?.(id);
    if (u?.active && u.isGM) return u;
  }
  return connectedGMs()[0] ?? null;
}

/**
 * Is `user` the active GM? With no GM connected at all, a GM asking about
 * themselves is answered true — the same fallback `_isResponsibleGM` had,
 * which keeps a lone GM working before `game.users` has settled.
 */
export function isActiveGM(user = game.user) {
  if (!user?.isGM) return false;
  const gm = getActiveGM();
  return (gm?.id ?? user.id) === user.id;
}

/** A GM-role user who is not the active GM. */
export function isAssistantGM(user = game.user) {
  return !!user?.isGM && !isActiveGM(user);
}

/**
 * Whisper targets for a GM-only card: the active GM, plus any extra user ids
 * (the mover, the roller). De-duplicated; never empty while a GM is online.
 */
export function activeGmWhisperIds(...extraIds) {
  const ids = new Set();
  const gm = getActiveGM();
  if (gm) ids.add(gm.id);
  for (const id of extraIds.flat()) if (id) ids.add(id);
  return [...ids];
}

/**
 * Fired on every client whenever the designation changes. Listen for this, not
 * `updateSetting`: the very first write in a world CREATES the Setting
 * document, which fires `createSetting` instead, so an `updateSetting`
 * listener misses it and the change only appeared once someone reconnected.
 * Called from the setting's `onChange`, which core runs for both.
 */
export const ACTIVE_GM_CHANGED_HOOK = "sta2eActiveGmChanged";

export const SET_ACTIVE_GM_ACTION = "setActiveGm";

/**
 * Write the designation. Any GM may claim or hand off. An assistant GM may
 * lack the core SETTINGS_MODIFY permission (it is configurable per world), so
 * in that case the write is relayed to a connected user who has it.
 */
export async function setActiveGM(userId) {
  if (!game.user?.isGM) return;
  const value = userId ?? "";
  if (!game.user.can("SETTINGS_MODIFY")) {
    const relay = game.users?.getDesignatedUser?.(u => u.active && u.can("SETTINGS_MODIFY"));
    if (!relay) {
      ui.notifications?.warn("STA2e Toolkit: No connected user is allowed to change world settings, so the Active GM cannot be changed.");
      return;
    }
    game.socket?.emit(`module.${MODULE}`, { action: SET_ACTIVE_GM_ACTION, userId: value, requesterUserId: game.user.id });
    return;
  }
  try {
    await game.settings.set(MODULE, ACTIVE_GM_SETTING, value);
  } catch (err) {
    console.error("STA2e Toolkit | Active GM write failed:", err);
    ui.notifications?.error("STA2e Toolkit: Could not change the Active GM. See the console for details.");
  }
}

/** Socket side of the relay above: exactly one permitted client performs it. */
export async function handleSetActiveGmRequest(msg) {
  const relay = game.users?.getDesignatedUser?.(u => u.active && u.can("SETTINGS_MODIFY"));
  if (!relay?.isSelf) return;
  if (!game.users.get(msg?.requesterUserId)?.isGM) return;
  const target = msg.userId ?? "";
  if (target && !game.users.get(target)?.isGM) return;
  try { await game.settings.set(MODULE, ACTIVE_GM_SETTING, target); }
  catch (err) { console.error("STA2e Toolkit | relayed Active GM write failed:", err); }
}
