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
 * complication prompt ("weapon malfunctions") or the working COMPLICATIONS card (complication-card.js)
 * button; cleared ("Repair" / "Recharge") from the HUD or the sheet.
 *
 * A leaf with **no imports**, so the damage maths in combat-hud-core.js, the
 * VFX in personal-shield-vfx.js and the UI can all read it without a cycle.
 * Personal forcefields used to carry their own flag, `forcefieldBurntOut`; it
 * is still read here, and cleared alongside on a repair.
 */

const MODULE = "sta2e-toolkit";
export const DAMAGED_FLAG = "gearDamaged";
/**
 * How badly it is broken: the potency of the negative trait the active GM keeps
 * on the character while the item is out of action (gear-damage-ui.js), and the
 * base Difficulty to repair it. Starts at 1; complications and (against a
 * player character) Threat raise it.
 */
export const POTENCY_FLAG = "gearDamagePotency";

const _potency = (v) => Math.max(1, Math.min(5, Math.trunc(Number(v)) || 1));

/** The stored potency of a damaged item (1–5), or 0 for a working one. */
export function storedGearDamagePotency(item) {
  if (!isGearDamaged(item)) return 0;
  try { return _potency(item.getFlag(MODULE, POTENCY_FLAG) ?? 1); } catch { return 1; }
}
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

/**
 * How an energy weapon is out of action — purely flavour, the rules are the
 * same: "broken" (the default, repaired) or "burnt" (power cell burnt out,
 * recharged). Stored on the item while it is damaged; other items only break.
 */
export const MODE_FLAG = "gearDamageMode";
export const DAMAGE_MODES = ["broken", "burnt"];

/** Phasers, disruptors, phase pistols, plasma and the like — anything that runs on a power cell. */
const ENERGY_RE = /\b(phaser|phased?|disruptor|plasma|polaron|particle|pulse|blaster|tetryon|antiproton|energy)\b/i;

export function isEnergyWeapon(item) {
  return item?.type === "characterweapon2e" && ENERGY_RE.test(String(item.name ?? ""));
}

/** The ways this item can be put out of action. */
export function gearDamageModes(item) {
  return isEnergyWeapon(item) ? [...DAMAGE_MODES] : ["broken"];
}

/** The mode a damaged item is in ("broken" when unset or not allowed for it). */
export function gearDamageMode(item) {
  let mode = null;
  try { mode = item?.getFlag?.(MODULE, MODE_FLAG) ?? null; } catch { /* none */ }
  return gearDamageModes(item).includes(mode) ? mode : "broken";
}

const BURNT_WORDS = { state: "Burnt out", verb: "Burn out", fix: "Recharge", fixed: "recharged", icon: "fas fa-battery-empty" };

/**
 * The words for an item's out-of-action state, its action, and the fix. A
 * weapon names the mode it is in, or the one asked for (`mode`) when offering
 * a choice before it breaks.
 */
export function gearDamageWords(item, mode = null) {
  switch (gearKind(item)) {
    case "weapon":
      return (mode ?? gearDamageMode(item)) === "burnt" && isEnergyWeapon(item)
        ? BURNT_WORDS
        : { state: "Broken", verb: "Break", fix: "Repair", fixed: "repaired", icon: "fas fa-screwdriver-wrench" };
    case "forcefield": return BURNT_WORDS;
    case "armor":      return { state: "Damaged",   verb: "Damage",   fix: "Repair",   fixed: "repaired",  icon: "fas fa-shield-halved" };
    default:           return { state: "Damaged",   verb: "Damage",   fix: "Repair",   fixed: "repaired",  icon: "fas fa-screwdriver-wrench" };
  }
}

/**
 * Mark an item out of action, or put it back in service. Repair also clears
 * the legacy forcefield flag. Returns false (with a warning) when this user
 * cannot write the item — a player marking an NPC's gear goes through the GM.
 */
export async function setGearDamaged(item, damaged, { potency = 1, mode = "broken" } = {}) {
  if (!isDamageable(item)) return false;
  if (!item.isOwner) {
    ui.notifications?.warn?.(`STA2e Toolkit: you can't change ${item.name}.`);
    return false;
  }
  if (damaged) {
    await item.update({
      [`flags.${MODULE}.${DAMAGED_FLAG}`]: true,
      [`flags.${MODULE}.${POTENCY_FLAG}`]: _potency(potency),
      [`flags.${MODULE}.${MODE_FLAG}`]: gearDamageModes(item).includes(mode) ? mode : "broken",
    });
    return true;
  }
  const updates = {
    [`flags.${MODULE}.-=${DAMAGED_FLAG}`]: null,
    [`flags.${MODULE}.-=${POTENCY_FLAG}`]: null,
    // The mode is kept: it is what the repair card and the chat card read to say
    // "recharged" rather than "repaired" once the flag is gone, and every break
    // writes it afresh.
  };
  for (const f of LEGACY_FLAGS) {
    try { if (item.getFlag(MODULE, f) !== undefined) updates[`flags.${MODULE}.-=${f}`] = null; } catch { /* none */ }
  }
  await item.update(updates);
  return true;
}

/** Change a damaged item's potency (clamped 1–5). */
export async function setGearDamagePotency(item, potency) {
  if (!isGearDamaged(item) || !item.isOwner) return false;
  await item.setFlag(MODULE, POTENCY_FLAG, _potency(potency));
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

/** Did this update change a damaged item's potency (not its state)? */
export function gearDamagePotencyChanged(changes) {
  const get = foundry.utils.getProperty;
  return get(changes, `flags.${MODULE}.${POTENCY_FLAG}`) !== undefined;
}

// ── Pulse grenade count ──────────────────────────────────────────────────────
//
// A pulse grenade weapon is a supply, not a gun: 3 to start (the flag is unset
// until the first throw), one used per throw, hit or miss, and at 0 it cannot
// be used until restocked from the toolkit HUD's Gear section.

export const GRENADE_FLAG = "grenadeCount";
export const GRENADE_START = 3;
const GRENADE_RE = /\bpulse\s*grenades?\b/i;

export function isPulseGrenade(item) {
  return item?.type === "characterweapon2e" && GRENADE_RE.test(String(item.name ?? ""));
}

/** Grenades left — GRENADE_START until the item has been thrown. Null for anything else. */
export function grenadeCount(item) {
  if (!isPulseGrenade(item)) return null;
  let raw;
  try { raw = item.getFlag(MODULE, GRENADE_FLAG); } catch { raw = undefined; }
  const n = Math.trunc(Number(raw));
  return raw === undefined || raw === null || !Number.isFinite(n) ? GRENADE_START : Math.max(0, n);
}

/**
 * Refuse a broken character weapon, with a notice. True when it is usable.
 * Every path that starts an attack calls this — the Combat HUD row, the LCARS
 * ring, the Token HUD's Hit/Miss and roller.
 */
export function assertWeaponUsable(weapon) {
  if (weapon?.type !== "characterweapon2e") return true;
  if (grenadeCount(weapon) === 0) {
    ui.notifications?.warn?.(`No ${weapon.name} left — restock from the toolkit's Gear section.`);
    return false;
  }
  if (!isGearDamaged(weapon)) return true;
  const words = gearDamageWords(weapon);
  ui.notifications?.warn?.(`${weapon.name} is ${words.state.toLowerCase()} and can't be used until it is ${words.fixed}.`);
  return false;
}
