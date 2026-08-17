/**
 * Ground-combat talent detection for STA 2e Security talents.
 *
 * Every other talent in this module is detected ad hoc — there are four
 * independent copies of `normalizeTalentName` and roughly two dozen
 * `item.name.toLowerCase().includes(...)` calls with inconsistent matching. This
 * module deliberately adds no new normalizer: it builds on the two exported
 * helpers in combat-definitions.js, which are the most tolerant of the lot
 * (`normalizeTalentName` strips all punctuation, so "Get Down!" and
 * "Get Down" collapse to the same key).
 *
 * Talents are matched by item *name* only, never by `item.type`. STA 2e stores
 * talents as items whose type varies with system version — `talent`,
 * `talent2e`, `starshiptalent` — so filtering on type would silently drop
 * talents on some sheets. See the same reasoning at combat-hud-core.js:449.
 *
 * Requirements (Security 4+, Fitness 9+, …) are NOT enforced. Possessing the
 * talent item is the gate, consistent with every other talent in the module —
 * the character sheet is authoritative.
 */

import { normalizeTalentName, findRoleAbilityTalent } from "./combat-definitions.js";
import { isUnarmedWeapon } from "../weapon-configs.js";
import { getSceneZones, getZonesForToken } from "../zone-data.js";

const MODULE = "sta2e-toolkit";

export { isUnarmedWeapon };

/**
 * The Security ground-combat talents this module automates.
 *
 * `parenthetical: true` means the talent is normally written with a choice in
 * brackets — "Defensive Training (Melee)" — so a prefix match is needed on top
 * of the exact match.
 */
export const GROUND_TALENTS = Object.freeze({
  appliedForce: {
    label: "Applied Force",
    aliases: ["applied force"],
    effect: "May use Fitness instead of Daring for Melee Attacks; +1 Severity to Unarmed Attacks.",
  },
  closeProtection: {
    label: "Close Protection",
    aliases: ["close protection"],
    effect: "On a successful Attack, spend 1 Momentum to raise the Difficulty of the next Attack against a Close-range ally by 1.",
  },
  defensiveTraining: {
    label: "Defensive Training",
    aliases: ["defensive training"],
    parenthetical: true,
    effect: "Attacks against you of the chosen type (Melee or Ranged) increase in Difficulty by 1.",
  },
  getDown: {
    label: "Get Down!",
    aliases: ["get down"],
    effect: "You and allies within Close range gain +1 Protection while in Cover.",
  },
  fireAtWill: {
    label: "Fire at Will",
    aliases: ["fire at will"],
    effect: "An extra Major Action costs 1 Momentum rather than 2, but the second Major Action must also be an Attack.",
  },
  martialArtist: {
    label: "Martial Artist",
    aliases: ["martial artist"],
    effect: "Your Unarmed Strike may inflict Deadly Injuries as well as Stun Injuries.",
  },
  meanRightHook: {
    label: "Mean Right Hook",
    aliases: ["mean right hook"],
    effect: "Your Unarmed Strike gains the Intense quality.",
  },
  packTactics: {
    label: "Pack Tactics",
    aliases: ["pack tactics"],
    effect: "A character you Assist in combat gains 1 bonus Momentum if they succeed.",
  },
  steadyHands: {
    label: "Steady Hands",
    aliases: ["steady hands"],
    effect: "Aiming before a Ranged Attack adds 1 to the Attack's Severity.",
  },
  quickToAction: {
    label: "Quick to Action",
    aliases: ["quick to action"],
    effect: "In the first round of combat, you and your allies ignore the cost to Keep the Initiative.",
  },
});

/** Master GM toggle. Defaults to on, and to on if the setting is not registered yet. */
export function groundTalentAutomationEnabled() {
  try {
    const v = game.settings.get(MODULE, "groundTalentAutomation");
    return v === undefined || v === null ? true : !!v;
  } catch {
    return true;
  }
}

/**
 * Find a ground talent item on an actor.
 *
 * Exact match first (via `findRoleAbilityTalent`, which also tolerates names
 * padded with "Talent"/"Ability"), then — for parenthetical talents — a prefix
 * match so "Defensive Training (Melee)" resolves to `defensiveTraining`.
 *
 * @param {Actor|null}  actor
 * @param {string}      key    a key of GROUND_TALENTS
 * @returns {Item|null}
 */
export function hasGroundTalent(actor, key) {
  if (!actor?.items) return null;
  if (!groundTalentAutomationEnabled()) return null;

  const def = GROUND_TALENTS[key];
  if (!def) return null;

  const exact = findRoleAbilityTalent(actor, def.aliases);
  if (exact) return exact;
  if (!def.parenthetical) return null;

  // "defensive training melee" starts with "defensive training ".
  const prefixes = def.aliases.map(a => `${normalizeTalentName(a)} `);
  return actor.items.find(item => {
    const normalized = normalizeTalentName(item?.name);
    return prefixes.some(p => normalized.startsWith(p));
  }) ?? null;
}

/**
 * Every ground talent this actor has, for the HUD's "talents in play" banner.
 * @returns {Array<{key: string, label: string, effect: string, detail: string|null}>}
 */
export function groundTalentsFor(actor) {
  if (!actor?.items || !groundTalentAutomationEnabled()) return [];
  const found = [];
  for (const [key, def] of Object.entries(GROUND_TALENTS)) {
    if (!hasGroundTalent(actor, key)) continue;
    let detail = null;
    if (key === "defensiveTraining") {
      const type = defensiveTrainingType(actor);
      detail = type ? (type === "melee" ? "Melee" : "Ranged") : "unset";
    }
    found.push({ key, label: def.label, effect: def.effect, detail });
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defensive Training — Melee or Ranged
// ─────────────────────────────────────────────────────────────────────────────

const DEFENSIVE_TRAINING_FLAG = "defensiveTrainingType";

/**
 * Which attack type this character's Defensive Training was taken against.
 *
 * Read order: the parenthetical in the talent's own name, then an actor flag
 * set by `resolveDefensiveTrainingType`. Returns null when the actor lacks the
 * talent, or has it under a bare name and has never been asked.
 *
 * @returns {"melee"|"ranged"|null}
 */
export function defensiveTrainingType(actor) {
  const talent = hasGroundTalent(actor, "defensiveTraining");
  if (!talent) return null;

  // Parse the same way npc-roller.js's Adapt and Excel detector does.
  const parenthetical = /\(([^)]+)\)/.exec(talent.name ?? "")?.[1] ?? "";
  const normalized = normalizeTalentName(parenthetical);
  if (normalized.includes("melee")) return "melee";
  if (normalized.includes("ranged") || normalized.includes("range")) return "ranged";

  const stored = actor?.getFlag?.(MODULE, DEFENSIVE_TRAINING_FLAG) ?? null;
  return stored === "melee" || stored === "ranged" ? stored : null;
}

const _defTrainWarned = new Set();

/**
 * Same as `defensiveTrainingType`, but asks once and remembers the answer when
 * the talent is present under a bare name.
 *
 * Only the actor's owner can be asked — the flag write would fail otherwise —
 * so a player attacking a GM-owned NPC whose talent is named without a
 * parenthetical gets no penalty and one console warning. Renaming the item to
 * "Defensive Training (Melee)" is the fix, and is what the banner nudges toward.
 *
 * @returns {Promise<"melee"|"ranged"|null>}
 */
export async function resolveDefensiveTrainingType(actor) {
  const known = defensiveTrainingType(actor);
  if (known) return known;
  if (!hasGroundTalent(actor, "defensiveTraining")) return null;

  if (!actor?.isOwner) {
    if (!_defTrainWarned.has(actor?.id)) {
      _defTrainWarned.add(actor?.id);
      console.warn(`STA2e Toolkit | ${actor?.name} has Defensive Training with no Melee/Ranged `
        + `choice, and this client cannot set one. Rename the talent to "Defensive Training (Melee)" `
        + `or "(Ranged)".`);
    }
    return null;
  }

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: `Defensive Training — ${actor.name}` },
    content: `
      <div style="padding:4px 0;line-height:1.6;font-size:11px;">
        <strong>${actor.name}</strong> selected either Melee Attacks or Ranged Attacks
        when they acquired <strong>Defensive Training</strong>.<br>
        Attacks of that type against them increase in Difficulty by 1.<br>
        <em>This choice is remembered on the actor.</em>
      </div>`,
    buttons: [
      { action: "melee",  label: "Melee",  icon: "fas fa-hand-fist", default: true },
      { action: "ranged", label: "Ranged", icon: "fas fa-crosshairs" },
      { action: "cancel", label: "Skip",   icon: "fas fa-times" },
    ],
  });
  if (choice !== "melee" && choice !== "ranged") return null;

  try {
    await actor.setFlag(MODULE, DEFENSIVE_TRAINING_FLAG, choice);
  } catch (e) {
    console.warn("STA2e Toolkit | Could not store Defensive Training choice:", e);
  }
  return choice;
}

/**
 * Difficulty added by every target's Defensive Training against this attack.
 *
 * Capped at 1 — the talent raises Difficulty by 1, and two trained targets in
 * one area attack do not stack into +2 on the single attack roll.
 *
 * @param {Token[]} targets
 * @param {boolean} isMelee
 * @returns {Promise<number>} 0 or 1
 */
export async function defensiveTrainingPenalty(targets = [], isMelee = false) {
  const wanted = isMelee ? "melee" : "ranged";
  for (const target of targets) {
    const type = await resolveDefensiveTrainingType(target?.actor);
    if (type === wanted) return 1;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Severity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Severity added to a ground attack by the attacker's talents.
 *
 * Applied Force adds 1 to Unarmed Attacks. Steady Hands adds 1 when the Aim
 * minor action preceded a Ranged Attack — `aimUsed` must be captured at
 * declaration time, because the HUD clears its aim toggle when the weapon fires
 * and the flag is long gone by the time damage resolves.
 *
 * @param {Actor}   actor
 * @param {Item}    weapon
 * @param {object}  opts
 * @param {boolean} opts.isMelee
 * @param {boolean} opts.aimUsed
 * @returns {{ total: number, reasons: string[] }}
 */
export function groundTalentSeverityBonus(actor, weapon, { isMelee = false, aimUsed = false } = {}) {
  const reasons = [];
  let total = 0;

  if (isUnarmedWeapon(weapon) && hasGroundTalent(actor, "appliedForce")) {
    total += 1;
    reasons.push("Applied Force +1");
  }
  if (!isMelee && aimUsed && hasGroundTalent(actor, "steadyHands")) {
    total += 1;
    reasons.push("Steady Hands +1");
  }

  return { total, reasons };
}

/** Mean Right Hook: an Unarmed Strike gains Intense. */
export function grantsUnarmedIntense(actor, weapon) {
  return !!(isUnarmedWeapon(weapon) && hasGroundTalent(actor, "meanRightHook"));
}

/** Martial Artist: an Unarmed Strike may inflict Deadly Injuries. */
export function grantsUnarmedDeadly(actor, weapon) {
  return !!(isUnarmedWeapon(weapon) && hasGroundTalent(actor, "martialArtist"));
}

/** Applied Force: Melee Attacks may use Fitness in place of Daring. */
export function meleeAttackAttribute(actor) {
  return hasGroundTalent(actor, "appliedForce") ? "fitness" : "daring";
}

// ─────────────────────────────────────────────────────────────────────────────
// Close range
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ground tokens within Close range of `originToken`, excluding it.
 *
 * Close range is "the same zone" (zone-data.js:22 — zoneCount 0). When the
 * scene has no zones drawn, fall back to roughly the same room: two grid
 * squares out. This mirrors `CombatHUD._getGroundAreaSecondaryTargets`
 * (combat-hud-core.js:4080) — the rule is duplicated rather than imported to
 * keep this module free of a cycle back into the 23k-line HUD.
 *
 * @param {Token} originToken
 * @returns {Token[]}
 */
export function tokensWithinClose(originToken) {
  if (!originToken) return [];

  const zonesEnabled = canvas?.scene?.getFlag(MODULE, "zonesEnabled") !== false;
  const zones = zonesEnabled ? getSceneZones() : [];
  const originZones = zones.length ? getZonesForToken(originToken, zones) : [];
  const originZoneIds = new Set(originZones.map(z => z.id));
  const usingZones = originZones.length > 0;

  const RADIUS_PX = (canvas?.grid?.size ?? 100) * 2;
  const origin = _center(originToken);

  return (canvas.tokens?.placeables ?? []).filter(t => {
    if (t.id === originToken.id) return false;
    if (!t.actor || _isShipToken(t)) return false;
    if (usingZones) return getZonesForToken(t, zones).some(z => originZoneIds.has(z.id));
    const c = _center(t);
    return Math.hypot(c.x - origin.x, c.y - origin.y) <= RADIUS_PX;
  });
}

/** Tokens within Close range that share `originToken`'s disposition. */
export function alliesWithinClose(originToken) {
  const disposition = originToken?.document?.disposition;
  if (disposition === undefined || disposition === null) return [];
  return tokensWithinClose(originToken)
    .filter(t => t.document?.disposition === disposition);
}

/**
 * Get Down!: +1 Protection while in Cover, granted by the token's own talent or
 * by any ally within Close range.
 *
 * @param {Token|TokenDocument|null} token
 * @returns {number} 0 or 1
 */
export function getDownProtectionBonus(token) {
  const placeable = token?.object ?? token ?? null;   // accept a TokenDocument too
  const doc = placeable?.document ?? token ?? null;
  if (!doc?.getFlag?.(MODULE, "coverActive")) return 0;

  if (hasGroundTalent(placeable?.actor ?? doc?.actor, "getDown")) return 1;
  if (!placeable?.document) return 0;   // no canvas placeable — cannot test range
  return alliesWithinClose(placeable).some(t => hasGroundTalent(t.actor, "getDown")) ? 1 : 0;
}

function _center(token) {
  const gs = canvas?.grid?.size ?? 100;
  return {
    x: (token.x ?? token.document?.x ?? 0)
      + ((token.w ?? ((token.document?.width ?? 1) * gs)) / 2),
    y: (token.y ?? token.document?.y ?? 0)
      + ((token.h ?? ((token.document?.height ?? 1) * gs)) / 2),
  };
}

function _isShipToken(token) {
  const actor = token?.actor;
  return actor?.type === "starship" || actor?.type === "spacecraft2e"
    || actor?.items?.some(i => i.type === "starshipweapon2e");
}
