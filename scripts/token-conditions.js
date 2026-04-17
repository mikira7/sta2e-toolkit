/**
 * sta2e-toolkit | token-conditions.js
 * Combat condition definitions, token flag helpers, and auto-clear hooks.
 *
 * Conditions are stored as token flags under:
 *   token.flags["sta2e-toolkit"]["conditions"]
 *
 * Defense mode (evasive-action / defensive-fire) is mutually exclusive
 * and stored separately under:
 *   token.flags["sta2e-toolkit"]["defenseMode"]  → "evasive-action" | "defensive-fire" | null
 *
 * All conditions that have a combatTurn auto-clear are tracked with the
 * combatant ID of the token that set them, so we know when "their next turn"
 * arrives.
 */

const MODULE = "sta2e-toolkit";

// ---------------------------------------------------------------------------
// v13 compatibility helper
// The controlToken hook passes a Token canvas object; flag methods live on
// the TokenDocument. This helper accepts either and returns the document.
// ---------------------------------------------------------------------------
export function doc(token) {
  return token?.document ?? token;
}

// ---------------------------------------------------------------------------
// Condition definitions
// ---------------------------------------------------------------------------

export const COMBAT_CONDITIONS = {

  // ── Defense mode (mutually exclusive) ─────────────────────────────────────
  "evasive-action": {
    label:       "Evasive Action",
    scope:       "ship",
    flagType:    "defenseMode",   // stored in defenseMode flag, not conditions array
    autoClears:  "nextTurn",      // clears at start of this token's next turn
    description: "Incoming attacks are Opposed Tasks"
  },
  "defensive-fire": {
    label:       "Defensive Fire",
    scope:       "ship",
    flagType:    "defenseMode",
    autoClears:  "nextTurn",
    description: "Incoming attacks are Opposed Tasks"
  },

  // ── Attack modifiers ───────────────────────────────────────────────────────
  "scan-for-weakness": {
    label:       "Scan for Weakness",
    scope:       "ship",
    flagType:    "conditions",    // stored in conditions array
    autoClears:  "onNextHit",     // clears when next attack hits this token
    description: "+2 damage or Piercing on next hit"
  },
  "attack-pattern": {
    label:       "Attack Pattern",
    scope:       "ship",
    flagType:    "conditions",
    autoClears:  "onNextAttack",  // clears after next attack roll by this token
    description: "Conn officer can assist next attack"
  },

  // ── Persistent states (GM manual set/clear) ────────────────────────────────
  "disabled": {
    label:       "Disabled",
    scope:       "ship",
    flagType:    "conditions",
    autoClears:  null,
    description: "Ship is disabled — no weapons or movement"
  },
  "destroyed": {
    label:       "Destroyed",
    scope:       "ship",
    flagType:    "conditions",
    autoClears:  null,
    description: "Ship is destroyed"
  },

  // ── Ground combat character states ─────────────────────────────────────────
  "stun": {
    label:       "Stunned",
    scope:       "ground",
    flagType:    "conditions",
    autoClears:  null,   // cleared by First Aid task
    description: "Character is Incapacitated — requires First Aid to recover"
  },
  "dying": {
    label:       "Dying",
    scope:       "ground",
    flagType:    "conditions",
    autoClears:  null,   // cleared by First Aid (or advances to dead)
    description: "Character is Dying — requires immediate First Aid or dies"
  },
  "dead": {
    label:       "Dead",
    scope:       "ground",
    flagType:    "conditions",
    autoClears:  null,   // permanent
    description: "Character is Dead"
  },
};

// ---------------------------------------------------------------------------
// Flag helpers
// ---------------------------------------------------------------------------

/** Get the active defense mode for a token ("evasive-action" | "defensive-fire" | null) */
export function getDefenseMode(token) {
  return doc(token).getFlag(MODULE, "defenseMode") ?? null;
}

/** Set defense mode on a token — automatically clears the other. */
export async function setDefenseMode(token, mode) {
  const d = doc(token);
  await d.setFlag(MODULE, "defenseMode", mode);
  const combatantId = game.combat?.getCombatantByToken(d.id)?.id ?? null;
  await d.setFlag(MODULE, "defenseModeSetBy", combatantId);
}

/** Clear defense mode on a token. */
export async function clearDefenseMode(token) {
  const d = doc(token);
  await d.unsetFlag(MODULE, "defenseMode");
  await d.unsetFlag(MODULE, "defenseModeSetBy");
}

/** Get conditions array on a token. */
export function getConditions(token) {
  return doc(token).getFlag(MODULE, "conditions") ?? [];
}

/** Check if a specific condition is active. */
export function hasCondition(token, conditionKey) {
  if (conditionKey === "evasive-action" || conditionKey === "defensive-fire") {
    return getDefenseMode(token) === conditionKey;
  }
  return getConditions(token).includes(conditionKey);
}

// ---------------------------------------------------------------------------
// Foundry built-in status effect sync
//
// Maps our ground-combat conditions onto Foundry's core status effect IDs so
// tokens get the standard overlay icons and any system integrations that listen
// for those effects.
//
//   stun  → unconscious + prone
//   dying → unconscious + prone
//   dead  → combatant.defeated = true  (NOT toggleStatusEffect — applying the
//            "defeated" ActiveEffect triggers Foundry core to clear all other
//            effects and mark the token inactive, which we do not want)
//
// Uses token.actor.toggleStatusEffect (v13 API) for unconscious/prone.
// For defeated we update the Combatant document directly if one exists.
// ---------------------------------------------------------------------------

/** Foundry core status IDs mirrored for stun/dying. */
const FOUNDRY_STATUS_MAP = {
  stun:  ["unconscious", "prone"],
  dying: ["unconscious", "prone"],
};

/**
 * Apply Foundry built-in status effects for stun/dying.
 * Safe to call even if the actor is absent or the status is already active.
 */
async function _applyFoundryStatuses(token, conditionKey) {
  const ids = FOUNDRY_STATUS_MAP[conditionKey];
  if (!ids) return;
  const actor = doc(token).actor;
  if (!actor) return;
  for (const id of ids) {
    const already = actor.statuses?.has(id) ?? false;
    if (!already) await actor.toggleStatusEffect(id, { active: true });
  }
}

/**
 * Remove Foundry built-in status effects for stun/dying, but only if no other
 * active module condition still requires that status.
 */
async function _removeFoundryStatuses(token, conditionKey) {
  const ids = FOUNDRY_STATUS_MAP[conditionKey];
  if (!ids) return;
  const actor = doc(token).actor;
  if (!actor) return;

  // After this removal, which module conditions will still be active?
  const remaining = getConditions(token).filter(c => c !== conditionKey);

  for (const id of ids) {
    const stillNeeded = remaining.some(c => FOUNDRY_STATUS_MAP[c]?.includes(id));
    if (!stillNeeded) {
      const active = actor.statuses?.has(id) ?? false;
      if (active) await actor.toggleStatusEffect(id, { active: false });
    }
  }
}

/**
 * Mark the combatant as defeated in the combat tracker without touching
 * ActiveEffects — avoids Foundry's chain reaction that clears all conditions.
 */
async function _setCombatantDefeated(token, defeated) {
  const tokenDoc = doc(token);
  const combatant = game.combat?.getCombatantByToken(tokenDoc.id);
  if (combatant) await combatant.update({ defeated });
}

/** Add a condition to a token. */
export async function addCondition(token, conditionKey) {
  const def = COMBAT_CONDITIONS[conditionKey];
  if (!def) return;

  if (def.flagType === "defenseMode") {
    await setDefenseMode(token, conditionKey);
    return;
  }

  const current = getConditions(token);
  if (!current.includes(conditionKey)) {
    await doc(token).setFlag(MODULE, "conditions", [...current, conditionKey]);
  }

  if (conditionKey === "dead") {
    // Mark combatant defeated directly — do NOT use toggleStatusEffect("defeated")
    // as that triggers Foundry core to clear all other conditions and reset state.
    await _setCombatantDefeated(token, true);
  } else {
    await _applyFoundryStatuses(token, conditionKey);
  }
}

/** Remove a condition from a token. */
export async function removeCondition(token, conditionKey) {
  const def = COMBAT_CONDITIONS[conditionKey];
  if (!def) return;

  if (def.flagType === "defenseMode") {
    await clearDefenseMode(token);
    return;
  }

  const current = getConditions(token);
  await doc(token).setFlag(MODULE, "conditions", current.filter(c => c !== conditionKey));

  if (conditionKey === "dead") {
    await _setCombatantDefeated(token, false);
  } else {
    await _removeFoundryStatuses(token, conditionKey);
  }
}

/** Toggle a condition on a token. Returns new state (true = active). */
export async function toggleCondition(token, conditionKey) {
  if (hasCondition(token, conditionKey)) {
    await removeCondition(token, conditionKey);
    return false;
  } else {
    await addCondition(token, conditionKey);
    return true;
  }
}

/** Clear all conditions on a token (used on destruction / session reset). */
export async function clearAllConditions(token) {
  const d = doc(token);
  await d.unsetFlag(MODULE, "conditions");
  await d.unsetFlag(MODULE, "defenseMode");
  await d.unsetFlag(MODULE, "defenseModeSetBy");
}

// ---------------------------------------------------------------------------
// Combat turn auto-clear hook
// Fires when the combat tracker advances to a new turn.
// Checks if the new active combatant had a defense mode set on their previous
// turn and clears it.
// ---------------------------------------------------------------------------

export function registerConditionHooks() {

  Hooks.on("combatTurn", async (combat, _updateData, _options) => {
    const combatant = combat.combatant;
    if (!combatant) return;
    // combatant.token is a TokenDocument — use it directly for flags
    const tokenDoc = combatant.token;
    if (!tokenDoc) return;
    const defenseModeSetBy = tokenDoc.getFlag(MODULE, "defenseModeSetBy");
    if (defenseModeSetBy && defenseModeSetBy === combatant.id) {
      await clearDefenseMode(tokenDoc);
      const tokenName = tokenDoc.name ?? "Token";
      ui.notifications.info(`${tokenName}: Defense mode expired.`);
    }
  });

  Hooks.on("combatRound", async (combat, _updateData, _options) => {
    const combatant = combat.combatant;
    if (!combatant) return;
    const tokenDoc = combatant.token;
    if (!tokenDoc) return;
    const defenseModeSetBy = tokenDoc.getFlag(MODULE, "defenseModeSetBy");
    if (defenseModeSetBy && defenseModeSetBy === combatant.id) {
      await clearDefenseMode(tokenDoc);
    }
  });
}

// ---------------------------------------------------------------------------
// Collision damage calculator (for Ram)
// ---------------------------------------------------------------------------

export function getCollisionDamage(token, zonesMoved = 0) {
  const scale = token.actor?.system?.scale ?? 1;
  // Collision damage = Scale + half zones moved before the collision (round down)
  return scale + Math.floor(zonesMoved / 2);
}
