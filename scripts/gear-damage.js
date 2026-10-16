/**
 * sta2e-toolkit | gear-damage.js
 *
 * One "out of action" state for a character's gear — armour, wearables,
 * character weapons and personal forcefields alike — stored as the item flag
 * `gearDamaged`. What it MEANS depends on the item, and only the wording
 * differs:
 *
 *   weapon      (characterweapon2e) "Broken"    — cannot be used in combat
 *   forcefield  (a personal shield)  "Burnt out" — no Protection, no effects
 *   armour/gear (armor / item)       "Damaged"   — no Protection
 *
 * Set from the Token HUD (GM toolkit menu → Gear), the sheet row, a weapon attack's
 * complication prompt ("weapon malfunctions") or a task card's Break Gear
 * button; cleared ("Repair" / "Recharge") from the HUD or the sheet.
 *
 * A leaf with **no imports**, so the damage maths in combat-hud-core.js, the
 * VFX in personal-shield-vfx.js and the UI can all read it without a cycle.
 * Personal forcefields used to carry their own flag, `forcefieldBurntOut`; it
 * is still read here, and cleared alongside on a repair.
 */

const MODULE = "sta2e-toolkit";
export const DAMAGED_FLAG = "gearDamaged";
const LEGACY_FLAGS = ["forcefieldBurntOut"];

/** Item types this state applies to. Ship weapons keep their own breach system. */
const DAMAGEABLE_TYPES = new Set(["characterweapon2e", "armor", "item"]);

const _nameKey = (name) => String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function isDamageable(item) {
  return !!item && DAMAGEABLE_TYPES.has(item.type);
}

export function isGearDamaged(item) {
  if (!item?.getFlag) return false;
  try {
    if (item.getFlag(MODULE, DAMAGED_FLAG) === true) return true;
    return LEGACY_FLAGS.some(f => item.getFlag(MODULE, f) === true);
  } catch { return false; }
}

/** A worn-item personal forcefield, by the world setting's name list. */
export function isForcefieldItem(item) {
  if (!item || (item.type !== "armor" && item.type !== "item")) return false;
  let raw = "Personal Forcefield, Personal Shield";
  try { raw = String(game.settings.get(MODULE, "personalShieldItems") ?? raw); } catch { /* default */ }
  return raw.split(/[,;]/).map(_nameKey).filter(Boolean).includes(_nameKey(item.name));
}

/** "weapon" | "forcefield" | "armor" | "gear" | null */
export function gearKind(item) {
  if (!isDamageable(item)) return null;
  if (item.type === "characterweapon2e") return "weapon";
  if (isForcefieldItem(item)) return "forcefield";
  return item.type === "armor" ? "armor" : "gear";
}

/** The words for an item's out-of-action state, its action, and the fix. */
export function gearDamageWords(item) {
  switch (gearKind(item)) {
    case "weapon":     return { state: "Broken",    verb: "Break",    fix: "Repair",   fixed: "repaired",  icon: "fas fa-screwdriver-wrench" };
    case "forcefield": return { state: "Burnt out", verb: "Burn out", fix: "Recharge", fixed: "recharged", icon: "fas fa-battery-empty" };
    case "armor":      return { state: "Damaged",   verb: "Damage",   fix: "Repair",   fixed: "repaired",  icon: "fas fa-shield-halved" };
    default:           return { state: "Damaged",   verb: "Damage",   fix: "Repair",   fixed: "repaired",  icon: "fas fa-screwdriver-wrench" };
  }
}

/**
 * Mark an item out of action, or put it back in service. Repair also clears
 * the legacy forcefield flag. Returns false (with a warning) when this user
 * cannot write the item — a player marking an NPC's gear goes through the GM.
 */
export async function setGearDamaged(item, damaged) {
  if (!isDamageable(item)) return false;
  if (!item.isOwner) {
    ui.notifications?.warn?.(`STA2e Toolkit: you can't change ${item.name}.`);
    return false;
  }
  if (damaged) {
    await item.setFlag(MODULE, DAMAGED_FLAG, true);
    return true;
  }
  const updates = { [`flags.${MODULE}.-=${DAMAGED_FLAG}`]: null };
  for (const f of LEGACY_FLAGS) {
    try { if (item.getFlag(MODULE, f) !== undefined) updates[`flags.${MODULE}.-=${f}`] = null; } catch { /* none */ }
  }
  await item.update(updates);
  return true;
}

/**
 * Did this item update change the damaged state? Both spellings, as for any
 * flag: `setFlag` puts the key in the diff, an unset sends `-=key`.
 */
export function gearDamageChanged(changes) {
  const get = foundry.utils.getProperty;
  for (const f of [DAMAGED_FLAG, ...LEGACY_FLAGS]) {
    if (get(changes, `flags.${MODULE}.${f}`) !== undefined) return true;
    if (get(changes, `flags.${MODULE}.-=${f}`) !== undefined) return true;
  }
  return false;
}

/**
 * Refuse a broken character weapon, with a notice. True when it is usable.
 * Every path that starts an attack calls this — the Combat HUD row, the LCARS
 * ring, the Token HUD's Hit/Miss and roller.
 */
export function assertWeaponUsable(weapon) {
  if (weapon?.type !== "characterweapon2e" || !isGearDamaged(weapon)) return true;
  ui.notifications?.warn?.(`${weapon.name} is broken and can't be used until it is repaired.`);
  return false;
}
