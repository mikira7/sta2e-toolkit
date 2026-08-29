/**
 * sta2e-toolkit | opposed-task.js
 * Social / skill / stealth opposed-task system.
 *
 * Orchestrated entirely through chat cards so we don't pile more buttons
 * onto the NPC Roller UI.  Flow:
 *
 *   1. GM runs /opposed (or presses Shift+O, or clicks the toolkit widget
 *      button) → the Task Maker opens on its "Opposed Task" tab.  That panel
 *      lives in opposed-panel.js; this module owns everything from the posted
 *      card onwards.
 *   2. The tab posts a chat card.  Only Roll as Defender is active
 *      (defender rolls first, matching the combat opposed-task pattern).
 *   3. Defender clicks their button → openPlayerRoller / openNpcRoller opens
 *      with sheet-based stats and a taskCallback that captures their successes
 *      and routes them back to the GM via socket.  The GM stamps successes
 *      onto the card flags and unlocks Roll as Attacker.
 *   4. Attacker clicks → roller opens with difficulty locked to the defender's
 *      successes.  Their taskCallback posts the resolution card (margin of
 *      success, complications on both sides, LCARS-styled).
 *
 * Assists are NOT managed by this module.  Assisters open their sheet roller
 * as an assist roll the same way they do for any other task; the existing
 * assist pipeline feeds the primary pool per STA2e rules.
 */

import { getActiveLcThemeKey, getLcCssVars, getLcThemeTemplate, getLcTokens } from "./lcars-theme.js";
import { lcarsChatCard } from "./chat-card-frame.js";
import { allRolledDice, callOutTargetsBonusMomentum, chiefMedicalOfficerBonusMomentum, flightControllerBonusMomentum, openNpcRoller, openPlayerRoller, packTacticsBonusMomentum } from "./npc-roller.js";
import { readOfficerStats } from "./crew-manifest.js";
import { labelFromKey as _labelFromKey, orderedShipsForActor, serializeShipsForRoller } from "./ship-pool.js";
import { CombatHUD } from "./combat-hud.js";
import { createTracker } from "./momentum-tracker.js";
import { speciesExtraDieBonusMomentum } from "./momentum-spend.js";
import { planOfActionBonusMomentum } from "./trait-service.js";
import { getExtraActionDifficulty } from "./combat/initiative-order.js";
import { resolveActingOfficer } from "./combat/acting-officer.js";
import { smallCraftDifficultyPenalty } from "./combat/combat-definitions.js";
// The setup UI now lives in the Task Maker's "Opposed Task" tab.  opposed-panel.js
// imports nothing but lcars-theme.js, so pulling from it here stays cycle-free —
// importing task-maker.js directly would not (see the note atop opposed-panel.js).
import { ATTR_OPTIONS, DEFAULT_KIND, DISC_OPTIONS, normalizeTraitModifier as _normalizeTraitModifier } from "./opposed-panel.js";

const MODULE = "sta2e-toolkit";

// ── LCARS tokens — resolved at render time per active campaign theme ─────
const LC = new Proxy({}, {
  get(_, prop) { return getLcTokens()[prop]; },
});

function _getOpposedThemeKey() {
  return getActiveLcThemeKey();
}

function _traitModifierDelta(options = {}) {
  const mod = _normalizeTraitModifier(options);
  if (mod.traitModifierMode === "increase") return mod.traitModifierPotency;
  if (mod.traitModifierMode === "reduce") return -mod.traitModifierPotency;
  return 0;
}

function _traitModifierLabel(options = {}) {
  const mod = _normalizeTraitModifier(options);
  const delta = _traitModifierDelta(mod);
  if (!delta) return "";
  const sign = delta > 0 ? "+" : "-";
  const name = mod.traitModifierName ? ` (${_esc(mod.traitModifierName)})` : "";
  return `Trait ${sign}${Math.abs(delta)}${name}`;
}

function _opposedRollTraitDelta(sideData = {}) {
  return Number(sideData?.traitDifficultyDelta ?? 0) || 0;
}

function _opposedRollTraitLabels(sideData = {}, multiplier = 1) {
  const effects = Array.isArray(sideData?.appliedTraitEffects) ? sideData.appliedTraitEffects : [];
  const labels = effects
    .filter(e => e?.effectType === "difficulty" && Number(e?.value ?? 0))
    .map(e => {
      const value = (Number(e.value ?? 0) || 0) * multiplier;
      const sign = value > 0 ? "+" : "-";
      return `${e.traitName ?? "Trait"} ${sign}${Math.abs(value)}`;
    });
  if (labels.length) return labels.join(", ");
  const delta = _opposedRollTraitDelta(sideData) * multiplier;
  if (!delta) return "";
  const sign = delta > 0 ? "+" : "-";
  return `Trait ${sign}${Math.abs(delta)}`;
}

function _cloneAppliedTraitEffects(effects = []) {
  if (!Array.isArray(effects)) return [];
  return effects
    .filter(e => e && typeof e === "object")
    .map(e => ({
      ...e,
      sourceTags: Array.isArray(e?.sourceTags) ? [...e.sourceTags] : [],
    }));
}

function _opposedSideRollingActor(sideData = {}) {
  const rollData = sideData?.rollData ?? {};
  const actorId = rollData.officerActorId ?? rollData.actorId ?? sideData.actorId ?? null;
  return actorId ? game.actors.get(actorId) : null;
}

function _opposedSideBonusMomentum(sideData = {}, passed = false) {
  if (!passed) return 0;
  const rollData = sideData?.rollData ?? {};
  const rollingActor = _opposedSideRollingActor(sideData);
  const callOutTargetsBonus = callOutTargetsBonusMomentum(rollData, true);
  const planOfActionBonus = planOfActionBonusMomentum(
    sideData.appliedTraitEffects ?? rollData.appliedTraitEffects ?? [],
    rollingActor
  );
  // Andorian Intense / Trill Patient. The roll card payload carries the payment
  // slots, so an opposed roll can award these the same as any other task.
  const speciesBonus = speciesExtraDieBonusMomentum({
    slots: rollData.paymentSlots,
    hasFreeExtraDie: rollData.hasFreeExtraDie,
    passed: true,
    actor: rollingActor,
  });
  // Pack Tactics — an assistant's talent paying out on the assisted roll.
  const packTacticsBonus = packTacticsBonusMomentum(rollData, true);
  // Role abilities that pay bonus Momentum on a success. Omitting these here is
  // why an opposed Evasive Action never paid the Flight Controller's +1 no matter
  // how the roller was set — every other path summed them, this one did not.
  const flightControllerBonus = flightControllerBonusMomentum(rollData, true);
  const chiefMedicalBonus = chiefMedicalOfficerBonusMomentum(rollData, true);
  return Math.max(0, callOutTargetsBonus + planOfActionBonus + speciesBonus + packTacticsBonus
    + flightControllerBonus + chiefMedicalBonus);
}

function _calculateOpposedDifficulty(taskData = {}) {
  const options = taskData.options ?? {};
  const base = Number(taskData.defender?.successes ?? 0);
  const guardPenalty = Number(options.guardPenalty ?? 0);
  const chiefSecurityPenalty = Number(options.chiefSecurityPenalty ?? 0);
  // Defender's Defensive Training talent, and a Close Protection spent on them.
  const defensiveTrainingPenalty = Number(options.defensiveTrainingPenalty ?? 0);
  const closeProtectionPenalty = Number(options.closeProtectionPenalty ?? 0);
  const pronePenalty = Number(options.pronePenalty ?? 0);
  const overridePenalty = Number(options.overridePenalty ?? 0);
  const cumbersomePenalty = Number(options.cumbersomePenalty ?? 0);
  const pointDefensePenalty = Number(options.pointDefensePenalty ?? 0);
  // +1 for a larger vessel shooting at small craft (set only for starship combat).
  const smallCraftPenalty = Number(options.smallCraftPenalty ?? 0);
  const attackPatternPenalty = Number(options.attackPatternPenalty ?? 0);
  // +1 owed by a Major Action the attacker bought with Momentum this turn.
  const extraActionPenalty = Number(options.extraActionPenalty ?? 0);
  const traitDelta = _traitModifierDelta(options);
  const defenderTraitDelta = -_opposedRollTraitDelta(taskData.defender);
  const attackerTraitDelta = taskData.attacker?.rolled
    ? _opposedRollTraitDelta(taskData.attacker)
    : 0;
  const total = Math.max(0, base + guardPenalty + chiefSecurityPenalty + defensiveTrainingPenalty + closeProtectionPenalty + pronePenalty + overridePenalty + cumbersomePenalty + pointDefensePenalty + smallCraftPenalty + extraActionPenalty - attackPatternPenalty + traitDelta + defenderTraitDelta + attackerTraitDelta);
  return { base, guardPenalty, chiefSecurityPenalty, defensiveTrainingPenalty, closeProtectionPenalty, pronePenalty, overridePenalty, cumbersomePenalty, pointDefensePenalty, smallCraftPenalty, attackPatternPenalty, extraActionPenalty, traitDelta, defenderTraitDelta, attackerTraitDelta, total };
}

async function _promptTraitModifier({ title = "Trait in Play", defaultValue = {} } = {}) {
  if (!game.user.isGM) return _normalizeTraitModifier(defaultValue);

  const initial = _normalizeTraitModifier(defaultValue);
  let captured = initial;
  const selectMode = (mode) => `
    <option value="${mode}" ${initial.traitModifierMode === mode ? "selected" : ""}>${
      mode === "increase" ? "Increase attacker Difficulty"
      : mode === "reduce" ? "Reduce attacker Difficulty"
      : "No trait modifier"
    }</option>`;

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title },
    content: `
      <div style="font-family:${LC.font};display:flex;flex-direction:column;gap:8px;color:${LC.text};">
        <div style="font-size:11px;color:${LC.textDim};line-height:1.4;">
          Apply a manual trait modifier to the attacker's final opposed difficulty.
        </div>
        <label style="display:flex;flex-direction:column;gap:3px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:${LC.textDim};">
          Trait Effect
          <select class="sta2e-op-trait-mode" style="background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};border-radius:2px;padding:5px;">
            ${selectMode("none")}
            ${selectMode("increase")}
            ${selectMode("reduce")}
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:${LC.textDim};">
          Potency
          <input class="sta2e-op-trait-potency" type="number" min="1" max="5" value="${initial.traitModifierPotency}"
            style="width:64px;background:${LC.panel};color:${LC.tertiary};border:1px solid ${LC.border};border-radius:2px;padding:5px;text-align:center;font-weight:700;">
        </label>
        <label style="display:flex;flex-direction:column;gap:3px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:${LC.textDim};">
          Trait Name / Reason
          <input class="sta2e-op-trait-name" type="text" value="${_esc(initial.traitModifierName)}"
            placeholder="e.g. Nebula Interference"
            style="background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};border-radius:2px;padding:5px;">
        </label>
      </div>`,
    buttons: [
      {
        action: "apply",
        label: "Apply",
        default: true,
        callback: (_event, _button, dlg) => {
          captured = _normalizeTraitModifier({
            traitModifierMode: dlg.element.querySelector(".sta2e-op-trait-mode")?.value ?? "none",
            traitModifierPotency: dlg.element.querySelector(".sta2e-op-trait-potency")?.value ?? 1,
            traitModifierName: dlg.element.querySelector(".sta2e-op-trait-name")?.value ?? "",
          });
        },
      },
      { action: "none", label: "No Modifier", callback: () => { captured = _normalizeTraitModifier({ traitModifierMode: "none" }); } },
    ],
  });

  return result ? captured : initial;
}


// ─────────────────────────────────────────────────────────────────────────
// Public entry — bypass dialog when opts are fully specified
// ─────────────────────────────────────────────────────────────────────────

/**
 * Post an opposed-task card directly without opening the setup dialog.
 * Macros and external callers can use this.  All fields fall back sensibly.
 */
/** Pass the Opposed tab's per-side ship-assist selections through untouched. */
function _sideShipAssistOpts(side, opts = {}) {
  return {
    [`${side}ShipAssist`]:    !!opts[`${side}ShipAssist`],
    [`${side}ShipActorId`]:   opts[`${side}ShipActorId`] ?? null,
    [`${side}ShipSystemKey`]: opts[`${side}ShipSystemKey`] ?? null,
    [`${side}ShipDeptKey`]:   opts[`${side}ShipDeptKey`] ?? null,
  };
}

/**
 * Collapse a side's ship-assist selection into the compact block stored on the
 * card, or null when the side isn't being assisted.
 */
function _sideShipAssistBlock(side, snapshot = {}) {
  if (!snapshot[`${side}ShipAssist`] || !snapshot[`${side}ShipActorId`]) return null;
  return {
    shipActorId:   snapshot[`${side}ShipActorId`],
    shipSystemKey: snapshot[`${side}ShipSystemKey`] ?? null,
    shipDeptKey:   snapshot[`${side}ShipDeptKey`] ?? null,
  };
}

export async function startOpposedTask(opts = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn("STA2e Toolkit: Only the GM can post an opposed task.");
    return;
  }
  const defId = opts.defenderActorId ?? opts.responderActorId;
  const atkId = opts.attackerActorId ?? opts.initiatorActorId;
  if (!defId || !atkId) {
    // Routed through the public API rather than a direct import: the setup UI
    // lives in task-maker.js now, and importing it here would form a cycle.
    game.sta2eToolkit?.openOpposedTaskSetup?.(opts);
    return;
  }
  return postOpposedTaskCard({
    taskName:              opts.taskName ?? "Opposed Task",
    flavor:                opts.flavor ?? "",
    kind:                  opts.kind ?? DEFAULT_KIND.key,
    defenderSuggestedAttr: opts.defenderSuggestedAttr ?? opts.suggestedAttr ?? "presence",
    defenderSuggestedDisc: opts.defenderSuggestedDisc ?? opts.suggestedDisc ?? "command",
    attackerSuggestedAttr: opts.attackerSuggestedAttr ?? opts.suggestedAttr ?? "presence",
    attackerSuggestedDisc: opts.attackerSuggestedDisc ?? opts.suggestedDisc ?? "command",
    defenderActorId:       defId,
    attackerActorId:       atkId,
    defenderTokenId:       opts.defenderTokenId ?? null,
    attackerTokenId:       opts.attackerTokenId ?? null,
    ..._sideShipAssistOpts("defender", opts),
    ..._sideShipAssistOpts("attacker", opts),
    options:               {
      defenderComplicationRange: opts.options?.defenderComplicationRange ?? opts.defenderComplicationRange ?? opts.options?.complicationRange ?? opts.complicationRange ?? 1,
      attackerComplicationRange: opts.options?.attackerComplicationRange ?? opts.attackerComplicationRange ?? opts.options?.complicationRange ?? opts.complicationRange ?? 1,
      ..._normalizeTraitModifier(opts.options ?? opts),
      ...(opts.options ?? {}),
    },
  });
}

export async function startGroundCombatOpposedTask(opts = {}) {
  if (!game.user.isGM) {
    game.socket.emit("module.sta2e-toolkit", {
      action: "startGroundCombatOpposedTask",
      requesterUserId: game.user.id,
      opts,
    });
    return null;
  }

  const attackerToken = opts.attackerTokenId ? canvas.tokens?.get(opts.attackerTokenId) : null;
  const defenderToken = opts.defenderTokenId ? canvas.tokens?.get(opts.defenderTokenId) : null;
  const attackerActor = attackerToken?.actor ?? game.actors.get(opts.attackerActorId);
  const defenderActor = defenderToken?.actor ?? game.actors.get(opts.defenderActorId);
  if (!attackerActor || !defenderActor) {
    ui.notifications.error("STA2e Toolkit: Ground opposed task actor missing.");
    return null;
  }

  const taskId = foundry.utils.randomID();
  const defenseType = opts.defenseType ?? "melee";
  const guardPenalty = Number(opts.guardPenalty ?? 0);
  const chiefSecurityPenalty = Number(opts.chiefSecurityPenalty ?? 0);
  const pronePenalty = Number(opts.pronePenalty ?? 0);
  const targetIsProne = !!opts.targetIsProne;
  // Trait modifier is no longer prompted via a blocking dialog at start (which
  // only the initiating GM would see). Default to whatever was passed in; any GM
  // can adjust it afterward via the 🎚 Trait button on the opposed-task card.
  const traitModifier = _normalizeTraitModifier(opts.options ?? opts);
  const taskData = {
    taskId,
    mode: "groundCombat",
    status: "awaiting-defender",
    taskName: opts.taskName ?? "Melee Attack",
    flavor: opts.flavor ?? "",
    kind: "groundCombat",
    kindLabel: defenseType === "melee" ? "Melee" : "Cover",
    kindIcon: defenseType === "melee" ? "⚔️" : "🪨",
    options: {
      defenseType,
      guardPenalty,
      chiefSecurityPenalty,
      defensiveTrainingPenalty: Number(opts.defensiveTrainingPenalty ?? 0),
      closeProtectionPenalty: Number(opts.closeProtectionPenalty ?? 0),
      closeProtectionSource: opts.closeProtectionSource ?? null,
      pronePenalty,
      // Derived from the attacker rather than passed in by each caller, so every
      // ground attack path picks up a bought extra Major Action's +1 automatically.
      extraActionPenalty: getExtraActionDifficulty(attackerActor),
      targetIsProne,
      targetIsProneInCover: !!opts.targetIsProneInCover,
      defenderComplicationRange: opts.defenderComplicationRange ?? 1,
      attackerComplicationRange: opts.attackerComplicationRange ?? 1,
      ...traitModifier,
    },
    combat: {
      attackerTokenId: opts.attackerTokenId ?? null,
      defenderTokenId: opts.defenderTokenId ?? null,
      weaponContext: opts.weaponContext ?? null,
      aimRerolls: Number(opts.aimRerolls ?? 0),
    },
    defender: {
      actorId: defenderActor.id,
      actorName: defenderActor.name,
      actorImg: defenderActor.img ?? "icons/svg/mystery-man.svg",
      suggestedAttr: opts.defenderSuggestedAttr ?? "daring",
      suggestedDisc: opts.defenderSuggestedDisc ?? "security",
      rolled: false,
      successes: null,
      complications: null,
    },
    attacker: {
      actorId: attackerActor.id,
      actorName: attackerActor.name,
      actorImg: attackerActor.img ?? "icons/svg/mystery-man.svg",
      suggestedAttr: opts.attackerSuggestedAttr ?? "daring",
      suggestedDisc: opts.attackerSuggestedDisc ?? "security",
      rolled: false,
      successes: null,
      complications: null,
    },
  };

  return ChatMessage.create({
    content: _renderCardHtml(taskData),
    speaker: ChatMessage.getSpeaker({ token: attackerToken ?? null }),
    flags: { [MODULE]: { type: "opposedTask", taskData } },
  });
}

export async function startStarshipCombatOpposedTask(opts = {}) {
  if (!game.user.isGM) {
    game.socket.emit("module.sta2e-toolkit", {
      action: "startStarshipCombatOpposedTask",
      requesterUserId: game.user.id,
      opts,
    });
    return null;
  }

  const attackerToken = opts.attackerTokenId ? canvas.tokens?.get(opts.attackerTokenId) : null;
  const defenderToken = opts.defenderTokenId ? canvas.tokens?.get(opts.defenderTokenId) : null;
  const attackerActor = attackerToken?.actor ?? game.actors.get(opts.attackerActorId);
  const defenderActor = defenderToken?.actor ?? game.actors.get(opts.defenderActorId);
  if (!attackerActor || !defenderActor) {
    ui.notifications.error("STA2e Toolkit: Starship opposed task actor missing.");
    return null;
  }

  const defenseType = opts.defenseType ?? opts.defMode ?? "evasive-action";
  const defLabel = defenseType === "evasive-action" ? "Evasive Action"
    : defenseType === "defensive-fire" ? "Defensive Fire"
    : defenseType === "point-defense" ? "Point Defense"
    : "Cover";
  const defIcon = defenseType === "evasive-action" ? "Evasive"
    : defenseType === "defensive-fire" ? "Defensive"
    : defenseType === "point-defense" ? "Point Defense"
    : "Cover";
  const defStationId = opts.defenderStationId ?? (["defensive-fire", "point-defense"].includes(defenseType) ? "tactical" : "helm");
  const atkStationId = opts.attackerStationId ?? "tactical";
  const defenderSuggestedAttr = opts.defenderSuggestedAttr ?? (defenseType === "point-defense" ? "weapons" : "daring");
  const defenderSuggestedDisc = opts.defenderSuggestedDisc ?? (["defensive-fire", "point-defense"].includes(defenseType) ? "security" : "conn");
  const attackerSuggestedAttr = opts.attackerSuggestedAttr ?? "control";
  const attackerSuggestedDisc = opts.attackerSuggestedDisc ?? "security";
  const traitModifier = opts.traitModifierMode || opts.options?.traitModifierMode
    ? _normalizeTraitModifier(opts.options ?? opts)
    : _normalizeTraitModifier({ traitModifierMode: "none" });

  const defenderOfficer = opts.defenderOfficer ?? readOfficerStats(resolveActingOfficer(defenderActor, defStationId));
  const attackerOfficer = opts.attackerOfficer ?? readOfficerStats(resolveActingOfficer(attackerActor, atkStationId));

  const taskId = foundry.utils.randomID();
  const taskData = {
    taskId,
    mode: "starshipCombat",
    status: "awaiting-defender",
    taskName: opts.taskName ?? `${defLabel} Defense`,
    flavor: opts.flavor ?? "",
    kind: "starshipCombat",
    kindLabel: defLabel,
    kindIcon: defIcon,
    opposedDifficulty: null,
    options: {
      defenseType,
      overridePenalty: opts.overridePenalty ? 1 : Number(opts.overridePenalty ?? 0),
      cumbersomePenalty: Number(opts.cumbersomePenalty ?? 0),
      pointDefensePenalty: Number(opts.pointDefensePenalty ?? (opts.pointDefenseActive ? 1 : 0)),
      pointDefenseActive: !!opts.pointDefenseActive,
      // Small Craft is resolved here rather than by the callers: every starship
      // opposed entry point funnels through this function, and ground opposed
      // tasks never reach it — so the rule stays ship-only for free.
      smallCraftPenalty: smallCraftDifficultyPenalty(attackerActor, defenderActor),
      // In ship combat the tracker activates the *officer*, not the ship, so the
      // bought extra Major Action's debt sits on the officer's combatant.
      extraActionPenalty: getExtraActionDifficulty(attackerOfficers[0] ?? attackerActor),
      attackPatternPenalty: opts.attackPatternPenalty ? 1 : Number(opts.attackPatternPenalty ?? 0),
      defenderComplicationRange: opts.defenderComplicationRange ?? 1,
      attackerComplicationRange: opts.attackerComplicationRange ?? 1,
      ...traitModifier,
    },
    combat: {
      attackerTokenId: opts.attackerTokenId ?? null,
      defenderTokenId: opts.defenderTokenId ?? null,
      weaponContext: opts.weaponContext ?? null,
      hasTargetingSolution: !!opts.hasTargetingSolution,
      hasRapidFireTorpedo: !!opts.hasRapidFireTorpedo,
      hasCalibrateWeapons: !!opts.hasCalibrateWeapons,
      hasAttackPattern: !!opts.hasAttackPattern,
      helmOfficer: opts.helmOfficer ?? null,
      attackRunActive: !!opts.attackRunActive,
      attackerStationId: atkStationId,
      defenderStationId: defStationId,
      attackerOfficer,
      defenderOfficer,
      pointDefenseActive: !!opts.pointDefenseActive,
      attackerCrewQuality: opts.attackerCrewQuality ?? (CombatHUD.isNpcShip(attackerActor) && !attackerOfficer ? CombatHUD.getCrewQuality(attackerActor) : null),
      defenderCrewQuality: opts.defenderCrewQuality ?? (CombatHUD.isNpcShip(defenderActor) && !defenderOfficer ? CombatHUD.getCrewQuality(defenderActor) : null),
    },
    defender: {
      actorId: defenderActor.id,
      actorName: defenderActor.name,
      actorImg: defenderActor.img ?? "icons/svg/mystery-man.svg",
      suggestedAttr: defenderSuggestedAttr,
      suggestedDisc: defenderSuggestedDisc,
      rolled: false,
      successes: null,
      complications: null,
    },
    attacker: {
      actorId: attackerActor.id,
      actorName: attackerActor.name,
      actorImg: attackerActor.img ?? "icons/svg/mystery-man.svg",
      suggestedAttr: attackerSuggestedAttr,
      suggestedDisc: attackerSuggestedDisc,
      rolled: false,
      successes: null,
      complications: null,
    },
  };

  return ChatMessage.create({
    content: _renderCardHtml(taskData),
    speaker: ChatMessage.getSpeaker({ token: attackerToken ?? null }),
    flags: { [MODULE]: { type: "opposedTask", taskData } },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Post the initial opposed-task chat card
// ─────────────────────────────────────────────────────────────────────────

async function postOpposedTaskCard(snapshot) {
  const taskId = foundry.utils.randomID();
  const kindMeta = DEFAULT_KIND;

  const defActor = game.actors.get(snapshot.defenderActorId);
  const atkActor = game.actors.get(snapshot.attackerActorId);
  if (!defActor || !atkActor) {
    ui.notifications.error("STA2e Toolkit: Defender or Attacker actor missing.");
    return;
  }

  const taskData = {
    taskId,
    status: "awaiting-defender",
    taskName:       snapshot.taskName,
    flavor:         snapshot.flavor,
    kind:           snapshot.kind,
    kindLabel:      kindMeta.label,
    kindIcon:       kindMeta.icon,
    options:        snapshot.options,
    // Token ids only — _launchRoller already reads combat.<side>TokenId, and
    // taskData.mode stays undefined so the starship-combat branch is untouched.
    combat: {
      defenderTokenId: snapshot.defenderTokenId ?? null,
      attackerTokenId: snapshot.attackerTokenId ?? null,
    },
    defender: {
      actorId: defActor.id,
      actorName: defActor.name,
      actorImg: defActor.img ?? "icons/svg/mystery-man.svg",
      suggestedAttr: snapshot.defenderSuggestedAttr ?? snapshot.suggestedAttr ?? "presence",
      suggestedDisc: snapshot.defenderSuggestedDisc ?? snapshot.suggestedDisc ?? "command",
      shipAssist: _sideShipAssistBlock("defender", snapshot),
      rolled: false,
      successes: null,
      complications: null,
    },
    attacker: {
      actorId: atkActor.id,
      actorName: atkActor.name,
      actorImg: atkActor.img ?? "icons/svg/mystery-man.svg",
      suggestedAttr: snapshot.attackerSuggestedAttr ?? snapshot.suggestedAttr ?? "presence",
      suggestedDisc: snapshot.attackerSuggestedDisc ?? snapshot.suggestedDisc ?? "command",
      shipAssist: _sideShipAssistBlock("attacker", snapshot),
      rolled: false,
      successes: null,
      complications: null,
    },
  };

  const content = _renderCardHtml(taskData);

  const msg = await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker(),
    flags: { [MODULE]: { type: "opposedTask", taskData } },
  });

  // Snapshot for "reuse last" / recent picker
  try {
    await game.sta2eToolkit?.campaignStore?.pushRecentOpposedTask?.({
      taskName:              snapshot.taskName,
      flavor:                snapshot.flavor,
      kind:                  snapshot.kind,
      defenderSuggestedAttr: snapshot.defenderSuggestedAttr ?? snapshot.suggestedAttr ?? "presence",
      defenderSuggestedDisc: snapshot.defenderSuggestedDisc ?? snapshot.suggestedDisc ?? "command",
      attackerSuggestedAttr: snapshot.attackerSuggestedAttr ?? snapshot.suggestedAttr ?? "presence",
      attackerSuggestedDisc: snapshot.attackerSuggestedDisc ?? snapshot.suggestedDisc ?? "command",
      suggestedAttr:         snapshot.defenderSuggestedAttr ?? snapshot.suggestedAttr ?? "presence",
      suggestedDisc:         snapshot.defenderSuggestedDisc ?? snapshot.suggestedDisc ?? "command",
      defenderActorId:       snapshot.defenderActorId,
      attackerActorId:       snapshot.attackerActorId,
      ..._sideShipAssistOpts("defender", snapshot),
      ..._sideShipAssistOpts("attacker", snapshot),
      options:               snapshot.options,
    });
  } catch (e) {
    console.warn("STA2e Toolkit | pushRecentOpposedTask failed:", e);
  }

  return msg;
}

// ─────────────────────────────────────────────────────────────────────────
// Chat-card HTML
// ─────────────────────────────────────────────────────────────────────────

function _renderCardHtml(d) {
  const theme = _getOpposedThemeKey();
  const template = getLcThemeTemplate(theme);
  const themeVars = getLcCssVars("op");
  const primary = LC.primary;
  const secondary = LC.secondary;
  const font = LC.font;
  const panel = LC.panel;
  const border = LC.border;
  const textDim = LC.textDim;

  const defRolled = d.defender.rolled;
  const atkRolled = d.attacker.rolled;
  const canRollAtk = defRolled && !atkRolled;
  const resolved = defRolled && atkRolled;
  const isGroundCombat = d.mode === "groundCombat";
  const isStarshipCombat = d.mode === "starshipCombat";
  const guardPenalty = Number(d.options?.guardPenalty ?? 0);
  const chiefSecurityPenalty = Number(d.options?.chiefSecurityPenalty ?? 0);
  const pronePenalty = Number(d.options?.pronePenalty ?? 0);
  const difficultyInfo = _calculateOpposedDifficulty(d);
  const adjustedTarget = difficultyInfo.total;
  const traitLabel = _traitModifierLabel(d.options ?? {});

  const defAttrKey = d.defender?.suggestedAttr ?? d.suggestedAttr;
  const defDiscKey = d.defender?.suggestedDisc ?? d.suggestedDisc;
  const atkAttrKey = d.attacker?.suggestedAttr ?? d.suggestedAttr;
  const atkDiscKey = d.attacker?.suggestedDisc ?? d.suggestedDisc;
  const defAttrLabel = ATTR_OPTIONS.find(a => a.key === defAttrKey)?.label ?? defAttrKey;
  const defDiscLabel = DISC_OPTIONS.find(a => a.key === defDiscKey)?.label ?? defDiscKey;
  const atkAttrLabel = ATTR_OPTIONS.find(a => a.key === atkAttrKey)?.label ?? atkAttrKey;
  const atkDiscLabel = DISC_OPTIONS.find(a => a.key === atkDiscKey)?.label ?? atkDiscKey;
  const defCompRange = d.options?.defenderComplicationRange ?? d.options?.complicationRange ?? 1;
  const atkCompRange = d.options?.attackerComplicationRange ?? d.options?.complicationRange ?? 1;
  const defCompRangeText = defCompRange <= 1 ? "Comp Range: 20" : `Comp Range: ${21 - defCompRange}-20`;
  const atkCompRangeText = atkCompRange <= 1 ? "Comp Range: 20" : `Comp Range: ${21 - atkCompRange}-20`;

  // Dice row renderer — match the npc-roller style (gray d20 with colored number overlay)
  const renderDiceRow = (dice) => {
    if (!Array.isArray(dice) || dice.length === 0) return "";
    const cells = dice.map(x => {
      const isSuccComp = !!x.success && !!x.complication && !x.crit;
      const txtColor = x.crit ? (LC.primary ?? "#ff9900")
        : isSuccComp ? (LC.red ?? "#cc4444")
        : x.success ? (LC.green ?? "#44cc66")
        : x.complication ? (LC.red ?? "#cc4444")
        : "#aaaaaa";
      const tip = `${x.value ?? "?"}${x.crit ? " (CRIT)" : x.success ? " (success)" : ""}${x.complication ? " (COMPLICATION)" : ""}`;
      const inner = x.crit
        ? `<span style="display:flex;flex-direction:column;align-items:center;line-height:1;gap:0;">
             <span style="font-size:6px;letter-spacing:-1px;color:${txtColor};">★★</span>
             <span style="font-size:10px;">${x.value ?? "?"}</span>
           </span>`
        : isSuccComp
          ? `<span style="display:flex;flex-direction:column;align-items:center;line-height:1;gap:0;">
               <span style="font-size:7px;letter-spacing:-1px;color:${LC.green ?? "#44cc66"};">*</span>
               <span style="font-size:10px;">${x.value ?? "?"}</span>
             </span>`
          : `<span style="font-size:10px;">${x.value ?? "?"}</span>`;
      return `<span title="${tip}" style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;">
          <img src="icons/svg/d20-grey.svg" style="position:absolute;top:0;left:0;width:26px;height:26px;opacity:0.2;pointer-events:none;" alt=""/>
          <span style="position:relative;z-index:1;color:${txtColor};font-weight:700;font-family:${LC.font};text-shadow:0 1px 2px rgba(0,0,0,0.9);pointer-events:none;">${inner}</span>
        </span>`;
    }).join("");
    return `<div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:4px;">${cells}</div>`;
  };

  // Resolved-side status text — used for "X successes" / "X successes — HIT"
  const isResolvedHit = defRolled && atkRolled && d.attacker.successes >= adjustedTarget;
  const buildSideStatus = (sideObj, isAttacker) => {
    if (!sideObj.rolled) {
      return `<span style="color:${textDim};font-style:italic;">Awaiting roll…</span>`;
    }
    const succ = sideObj.successes ?? 0;
    const comps = sideObj.complications ?? 0;
    const verdict = isAttacker && defRolled && atkRolled
      ? ` <span style="color:${isResolvedHit ? (LC.green ?? "#44cc66") : (LC.red ?? "#cc4444")};font-weight:700;">— ${isGroundCombat ? (isResolvedHit ? "HIT" : "MISS") : (isResolvedHit ? "WIN" : "LOSS")}</span>`
      : "";
    const compText = comps > 0
      ? ` <span style="color:${LC.red ?? "#cc4444"};">· ${comps} Complication${comps === 1 ? "" : "s"}</span>`
      : "";
    return `<span style="color:${LC.text ?? "#ffcc66"};font-weight:600;">${succ} success${succ === 1 ? "" : "es"}</span>${verdict}${compText}${renderDiceRow(sideObj.dice)}`;
  };
  const defStatusLine = buildSideStatus(d.defender, false);
  const atkStatusLine = buildSideStatus(d.attacker, true);

  // Resolution: attacker must meet or beat defender successes
  let resolutionBlock = "";
  if (resolved) {
    const target = adjustedTarget;
    const diff = d.attacker.successes - target;
    const passed = d.attacker.successes >= target;
    const rewardSide = passed ? "attacker" : "defender";
    const rewardAmount = Math.abs(diff);
    const passColor = passed ? (LC.green ?? "#44cc66") : (LC.red ?? "#cc4444");

    const winnerSideData = rewardSide === "attacker" ? d.attacker : d.defender;
    const winnerName = _esc(winnerSideData?.actorName ?? "");
    const winnerActor = winnerSideData?.actorId ? game.actors.get(winnerSideData.actorId) : null;
    const winnerProfile = winnerActor ? _getOpposedActorProfile(winnerActor) : null;
    const winnerPool = _opposedRewardPool(winnerActor, winnerProfile);
    const poolLabel = _opposedPoolLabel(winnerPool);
    const poolColor = winnerPool === "threat" ? (LC.primary ?? "#ff9900") : (LC.secondary ?? "#cc88ff");
    const poolSuffix = rewardAmount > 0
      ? ` — <span style="color:${poolColor};font-weight:700;">+${rewardAmount} ${poolLabel}</span>`
      : "";

    const verdictHeadline = `<span style="color:${LC.green ?? "#44cc66"};">✓</span> ${winnerName || (passed ? "Attacker" : "Defender")} wins${poolSuffix}`;

    // Breakdown details under the verdict
    const breakdownParts = [];
    if (isGroundCombat || isStarshipCombat) {
      breakdownParts.push(`${d.attacker.successes} succ vs Diff ${target}`);
      if (guardPenalty) breakdownParts.push(`Guard +${guardPenalty}`);
      if (chiefSecurityPenalty) breakdownParts.push(`Chief of Security +${chiefSecurityPenalty}`);
      if (difficultyInfo.defensiveTrainingPenalty) breakdownParts.push(`Defensive Training +${difficultyInfo.defensiveTrainingPenalty}`);
      if (difficultyInfo.closeProtectionPenalty) {
        const cpSource = d.options?.closeProtectionSource;
        breakdownParts.push(`Close Protection +${difficultyInfo.closeProtectionPenalty}`
          + (cpSource ? ` (${_esc(cpSource)})` : ""));
      }
      if (pronePenalty) breakdownParts.push(`Prone +${pronePenalty}`);
      if (difficultyInfo.overridePenalty) breakdownParts.push(`Override +${difficultyInfo.overridePenalty}`);
      if (difficultyInfo.cumbersomePenalty) breakdownParts.push(`Cumbersome +${difficultyInfo.cumbersomePenalty}`);
      if (difficultyInfo.pointDefensePenalty) breakdownParts.push(`Point Defense +${difficultyInfo.pointDefensePenalty}`);
      if (difficultyInfo.smallCraftPenalty) breakdownParts.push(`Small Craft +${difficultyInfo.smallCraftPenalty}`);
      if (difficultyInfo.attackPatternPenalty) breakdownParts.push(`Attack Pattern -${difficultyInfo.attackPatternPenalty}`);
      if (difficultyInfo.extraActionPenalty) breakdownParts.push(`Extra Major Action +${difficultyInfo.extraActionPenalty}`);
      if (difficultyInfo.traitDelta) breakdownParts.push(traitLabel);
      if (difficultyInfo.defenderTraitDelta) breakdownParts.push(`Defender Traits ${difficultyInfo.defenderTraitDelta > 0 ? "+" : "-"}${Math.abs(difficultyInfo.defenderTraitDelta)} (${_esc(_opposedRollTraitLabels(d.defender, -1))})`);
      if (difficultyInfo.attackerTraitDelta) breakdownParts.push(`Attacker Traits ${difficultyInfo.attackerTraitDelta > 0 ? "+" : "-"}${Math.abs(difficultyInfo.attackerTraitDelta)} (${_esc(_opposedRollTraitLabels(d.attacker, 1))})`);
      if (d.options?.targetIsProne && passed) breakdownParts.push(`<span style="color:${LC.secondary ?? "#cc88ff"};">+2 Mom on prone target</span>`);
    } else {
      breakdownParts.push(`${d.attacker.successes} succ vs Diff ${target}`);
      if (difficultyInfo.traitDelta) breakdownParts.push(traitLabel);
      if (difficultyInfo.defenderTraitDelta) breakdownParts.push(`Defender Traits ${difficultyInfo.defenderTraitDelta > 0 ? "+" : "-"}${Math.abs(difficultyInfo.defenderTraitDelta)} (${_esc(_opposedRollTraitLabels(d.defender, -1))})`);
      if (difficultyInfo.attackerTraitDelta) breakdownParts.push(`Attacker Traits ${difficultyInfo.attackerTraitDelta > 0 ? "+" : "-"}${Math.abs(difficultyInfo.attackerTraitDelta)} (${_esc(_opposedRollTraitLabels(d.attacker, 1))})`);
    }
    const compsTotal = (d.defender.complications ?? 0) + (d.attacker.complications ?? 0);
    if (compsTotal > 0) breakdownParts.push(`<span style="color:${LC.red ?? "#cc4444"};">${compsTotal} Complication${compsTotal === 1 ? "" : "s"}</span>`);

    const breakdownLine = breakdownParts.length
      ? `<div style="margin-top:3px;font-size:10px;color:${textDim};">${breakdownParts.join(" · ")}</div>`
      : "";

    const rewardBlock = isStarshipCombat
      ? (d.autoBank?.winnerSide === rewardSide ? _renderOpposedPoolReward(d, rewardSide, rewardAmount) : "")
      : (isGroundCombat ? "" : _renderOpposedPoolReward(d, rewardSide, rewardAmount));

    resolutionBlock = `
      <div class="sta2e-op-v2-resolution"
        style="margin:6px 10px;padding:8px 10px;background:rgba(0,0,0,0.35);
          border:1px solid ${LC.borderDim};border-left:3px solid ${LC.green ?? "#44cc66"};border-radius:2px;">
        <div style="font-size:9px;letter-spacing:0.12em;color:${textDim};text-transform:uppercase;font-weight:700;">Resolution</div>
        <div style="margin-top:3px;font-size:12px;font-weight:600;color:${LC.text ?? "#ffcc66"};">
          ${verdictHeadline}
        </div>
        ${breakdownLine}
        ${rewardBlock}
      </div>`;
  }

  const blindNote = d.options?.blindDefender && defRolled && !atkRolled
    ? `<div style="font-size:10px;color:${textDim};margin-top:2px;">🔒 Blind: defender successes shown to GM only.</div>`
    : "";

  // Hide defender's successes publicly if blind is on and attacker hasn't rolled yet
  const showDefToAll = !(d.options?.blindDefender && defRolled && !atkRolled);
  const defLineHtml = showDefToAll ? defStatusLine : `<span style="color:${textDim};font-style:italic;">Hidden (blind) — dice & successes shown after attacker rolls</span>`;
  const atkLineHtml = atkStatusLine;

  // Pill-style action buttons matching the mockup
  const btnBase = `flex:1;padding:8px 10px;background:transparent;border:1px solid ${primary};
    border-radius:2px;color:${primary};font-family:${font};font-size:10px;font-weight:700;
    letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;display:flex;
    align-items:center;justify-content:center;gap:6px;`;
  const btnDisabled = `flex:1;padding:8px 10px;background:transparent;border:1px solid ${LC.borderDim};
    border-radius:2px;color:${textDim};font-family:${font};font-size:10px;font-weight:700;
    letter-spacing:0.12em;text-transform:uppercase;cursor:not-allowed;opacity:0.5;display:flex;
    align-items:center;justify-content:center;gap:6px;`;

  const defBtn = !defRolled
    ? `<button type="button" class="sta2e-op-roll" data-side="defender" data-task-id="${d.taskId}"
        style="${btnBase}">🛡 Defender Roll</button>`
    : `<div style="${btnDisabled}">🛡 Defender Rolled</div>`;

  const atkBtn = canRollAtk
    ? `<button type="button" class="sta2e-op-roll" data-side="attacker" data-task-id="${d.taskId}"
        style="${btnBase}">⚔ Attacker Roll</button>`
    : atkRolled
      ? `<div style="${btnDisabled}">⚔ Attacker Rolled</div>`
      : `<button type="button" disabled style="${btnDisabled}">⚔ Attacker Roll</button>`;

  const gmCancel = !resolved
    ? `<button type="button" class="sta2e-op-cancel" data-task-id="${d.taskId}"
        style="padding:8px 10px;background:transparent;border:1px solid ${LC.red ?? "#cc4444"};
          border-radius:2px;color:${LC.red ?? "#cc4444"};font-family:${font};font-size:11px;
          font-weight:700;cursor:pointer;"
        title="GM only — cancel this opposed task">✕</button>`
    : "";

  // GM-only trait modifier button (ground/starship combat, before resolution).
  // Hidden for non-GM users in wireOpposedTaskCard. Lets any GM apply or adjust
  // the manual trait difficulty modifier — replaces the old blocking popup.
  const traitBtnLabel = difficultyInfo.traitDelta
    ? `🎚 ${traitLabel}`
    : "🎚 Trait";
  const gmTrait = (isGroundCombat || isStarshipCombat) && !resolved
    ? `<button type="button" class="sta2e-op-trait" data-task-id="${d.taskId}"
        style="padding:8px 10px;background:transparent;border:1px solid ${secondary};
          border-radius:2px;color:${secondary};font-family:${font};font-size:10px;
          font-weight:700;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;
          white-space:nowrap;"
        title="GM only — apply or adjust the trait difficulty modifier">${traitBtnLabel}</button>`
    : "";

  const opposedNote = (isGroundCombat || isStarshipCombat) && !resolved
    ? `<div style="padding:4px 12px 6px;color:${textDim};font-size:10px;line-height:1.4;font-style:italic;">
        Defender rolls first. Attacker difficulty is defender successes${guardPenalty ? ` + ${guardPenalty} Guard` : ""}${chiefSecurityPenalty ? ` + ${chiefSecurityPenalty} Chief of Security` : ""}${difficultyInfo.defensiveTrainingPenalty ? ` + ${difficultyInfo.defensiveTrainingPenalty} Defensive Training` : ""}${difficultyInfo.closeProtectionPenalty ? ` + ${difficultyInfo.closeProtectionPenalty} Close Protection` : ""}${pronePenalty ? ` + ${pronePenalty} Prone` : ""}${difficultyInfo.overridePenalty ? ` + ${difficultyInfo.overridePenalty} Override` : ""}${difficultyInfo.pointDefensePenalty ? ` + ${difficultyInfo.pointDefensePenalty} Point Defense` : ""}${difficultyInfo.attackPatternPenalty ? ` - ${difficultyInfo.attackPatternPenalty} Attack Pattern` : ""}${traitLabel ? ` ${difficultyInfo.traitDelta > 0 ? "+" : "-"} ${traitLabel}` : ""}${difficultyInfo.defenderTraitDelta ? ` ${difficultyInfo.defenderTraitDelta > 0 ? "+" : "-"} Defender Traits ${Math.abs(difficultyInfo.defenderTraitDelta)}` : ""}.
      </div>`
    : "";

  // Per-side: actor portrait + colored label
  // "Ship Assist: USS Foo - Sensors + Science", mirroring the Normal Task card.
  const shipAssistLine = (sideObj) => {
    const cfg = sideObj?.shipAssist;
    if (!cfg?.shipActorId) return "";
    const ship = game.actors.get(cfg.shipActorId);
    if (!ship) return "";
    const pair = cfg.shipSystemKey && cfg.shipDeptKey
      ? ` - ${_esc(_labelFromKey(cfg.shipSystemKey))} + ${_esc(_labelFromKey(cfg.shipDeptKey))}`
      : "";
    return `<div style="margin-top:1px;font-size:8px;color:${textDim};letter-spacing:0.06em;text-transform:uppercase;">Ship Assist: ${_esc(ship.name)}${pair}</div>`;
  };

  const sideBlock = (label, portraitSrc, name, attrLabel, discLabel, compRangeText, statusHtml, accentColor, shipLineHtml = "") => `
    <div class="sta2e-op-v2-side" style="flex:1;padding:8px 12px;">
      <div style="display:flex;gap:8px;align-items:flex-start;">
        <img src="${portraitSrc || "icons/svg/mystery-man.svg"}"
          style="width:32px;height:32px;object-fit:cover;border:1px solid ${accentColor};border-radius:2px;flex-shrink:0;background:#000;"
          alt="${_esc(name)}"/>
        <div style="flex:1;min-width:0;">
          <div style="font-size:9px;color:${accentColor};letter-spacing:0.14em;text-transform:uppercase;font-weight:700;">${label}</div>
          <div style="font-size:12px;font-weight:700;color:${LC.text ?? "#ffcc66"};margin-top:1px;line-height:1.2;">${_esc(name)}</div>
          <div style="margin-top:3px;font-size:9px;color:${accentColor};letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">${attrLabel} + ${discLabel}</div>
          <div style="margin-top:1px;font-size:8px;color:${textDim};letter-spacing:0.06em;text-transform:uppercase;">${compRangeText}</div>
          ${shipLineHtml}
        </div>
      </div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px dashed ${LC.borderDim};font-size:11px;">${statusHtml}</div>
    </div>`;

  const kind = isStarshipCombat ? "Starship Combat" : isGroundCombat ? "Ground Combat" : "Social Contest";
  const opBody = `

  <div style="padding:8px 12px 4px;">
    <div style="font-size:14px;font-weight:700;color:${primary};letter-spacing:0.02em;">${_esc(d.taskName)}</div>
    ${d.flavor ? `<div style="margin-top:2px;font-size:10px;color:${textDim};font-style:italic;line-height:1.4;">${_esc(d.flavor)}</div>` : ""}
  </div>
  ${opposedNote}

  <div class="sta2e-op-v2-sides"
    style="display:flex;margin:6px 10px 0;border:1px solid ${LC.borderDim};border-radius:2px;background:rgba(0,0,0,0.25);">
    ${sideBlock("Defender", d.defender.actorImg, d.defender.actorName, defAttrLabel, defDiscLabel, defCompRangeText, defLineHtml, primary, shipAssistLine(d.defender))}
    <div style="width:1px;background:${LC.borderDim};"></div>
    ${sideBlock("Attacker", d.attacker.actorImg, d.attacker.actorName, atkAttrLabel, atkDiscLabel, atkCompRangeText, atkLineHtml, primary, shipAssistLine(d.attacker))}
  </div>

  ${resolutionBlock}

  ${!resolved ? `
    <div class="sta2e-op-v2-actions" style="padding:8px 10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      ${defBtn}
      ${atkBtn}
      ${gmTrait}
      ${gmCancel}
    </div>
    ${blindNote ? `<div style="padding:0 12px 6px;">${blindNote}</div>` : ""}
  ` : `<div style="height:6px;"></div>`}

`;

  // The frame's bottom bar replaces the card's own 3px footer strip, so the body
  // ends at the content and the legacy path keeps the strip.
  return lcarsChatCard({
    title: `Opposed Task — ${kind}`,
    accent: primary,
    body: opBody,
    rootClass: "sta2e-op-card-v2",
    attrs: `data-task-id="${d.taskId}"`,
    legacy: () => `
<div class="sta2e-op-card-v2" data-task-id="${d.taskId}" data-theme="${theme}" data-template="${template}"
  style="${themeVars}background:${LC.bg};
    border:1px solid ${primary};border-radius:3px;font-family:${font};color:${LC.text};max-width:640px;overflow:hidden;padding:0;box-shadow:none;">
  <div class="sta2e-op-v2-header"
    style="background:${primary};color:${LC.bg};padding:6px 12px;
      display:flex;justify-content:space-between;align-items:center;
      font-weight:700;letter-spacing:0.16em;text-transform:uppercase;border-radius:0;">
    <span style="font-size:11px;">Opposed Task</span>
    <span style="font-size:10px;opacity:0.9;">${kind}</span>
  </div>
${opBody}
  <div class="sta2e-op-v2-footerbar" style="height:3px;background:${primary};"></div>
</div>
  `,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Card interaction — click handler wired from main.js renderChatMessageHTML
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire click handlers for opposed-task buttons on a rendered chat message.
 * Called from the existing renderChatMessageHTML hook in main.js.
 */
export function wireOpposedTaskCard(message, html) {
  const flags = message?.flags?.[MODULE] ?? {};
  if (flags.type !== "opposedTask") return;
  const taskData = flags.taskData;
  if (!taskData) return;

  // Hide GM-only buttons for non-GM users
  if (!game.user.isGM) {
    html.querySelectorAll(".sta2e-op-cancel").forEach(b => b.remove());
    html.querySelectorAll(".sta2e-op-trait").forEach(b => b.remove());
  }

  html.querySelectorAll(".sta2e-op-roll").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const side = btn.dataset.side;
      const taskId = btn.dataset.taskId;
      await _handleRollClick(message, taskId, side);
    });
  });

  html.querySelector(".sta2e-op-cancel")?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!game.user.isGM) return;
    const taskId = e.currentTarget.dataset.taskId;
    await _cancelOpposedTask(message, taskId);
  });

  html.querySelector(".sta2e-op-trait")?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!game.user.isGM) return;
    const taskId = e.currentTarget.dataset.taskId;
    await _handleTraitModifierClick(message, taskId);
  });
}

async function _handleTraitModifierClick(message, taskId) {
  if (!game.user.isGM) return;
  const flags = message?.flags?.[MODULE] ?? {};
  if (flags.type !== "opposedTask") return;
  const taskData = flags.taskData;
  if (!taskData || taskData.taskId !== taskId) return;
  if (taskData.defender?.rolled && taskData.attacker?.rolled) {
    ui.notifications.info("STA2e Toolkit: This opposed task is already resolved.");
    return;
  }

  const mod = await _promptTraitModifier({
    title: "Opposed Task — Trait in Play",
    defaultValue: taskData.options ?? {},
  });
  taskData.options = { ...taskData.options, ...mod };
  taskData.opposedDifficulty = _calculateOpposedDifficulty(taskData).total;

  await message.update({
    content: _renderCardHtml(taskData),
    [`flags.${MODULE}.taskData`]: taskData,
  }).catch(e => console.error("STA2e Toolkit | apply trait modifier failed:", e));
}

async function _cancelOpposedTask(message, taskId) {
  const flags = message?.flags?.[MODULE] ?? {};
  if (flags.type !== "opposedTask" || flags.taskData?.taskId !== taskId) return;
  const updated = { ...flags.taskData, status: "cancelled" };
  const cancelledHtml = `
<div style="background:${LC.bg};border:1px solid ${LC.border};border-left:4px solid ${LC.border};padding:8px 10px;font-family:${LC.font};color:${LC.textDim};max-width:480px;">
  <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;">Opposed Task Cancelled</div>
  <div style="font-size:12px;color:${LC.text};margin-top:2px;">${_esc(updated.taskName)}</div>
</div>`;
  await message.update({
    content: cancelledHtml,
    [`flags.${MODULE}.taskData`]: updated,
  }).catch(e => console.error("STA2e Toolkit | cancel opposed task failed:", e));
}

async function _handleRollClick(message, taskId, side) {
  const flags = message?.flags?.[MODULE] ?? {};
  if (flags.type !== "opposedTask") return;
  const taskData = flags.taskData;
  if (!taskData || taskData.taskId !== taskId) return;

  const sideData = side === "defender" ? taskData.defender : taskData.attacker;
  if (sideData.rolled) {
    ui.notifications.info(`STA2e Toolkit: ${side} has already rolled for this task.`);
    return;
  }
  if (side === "attacker" && !taskData.defender.rolled) {
    ui.notifications.warn("STA2e Toolkit: Defender must roll first.");
    return;
  }

  const actor = game.actors.get(sideData.actorId);
  if (!actor) {
    ui.notifications.error("STA2e Toolkit: Actor not found for this roll.");
    return;
  }

  // Permission gate.
  //   • "GM rolls both" → GM-only.
  //   • Otherwise       → GM, or an OWNER of the side's actor.
  if (taskData.options?.gmRollsBoth) {
    if (!game.user.isGM) {
      ui.notifications.warn("STA2e Toolkit: The GM is rolling both sides of this task.");
      return;
    }
  } else {
    const isOwner = actor.testUserPermission?.(game.user, "OWNER") ?? false;
    if (!game.user.isGM && !isOwner) {
      ui.notifications.warn(`STA2e Toolkit: Only ${actor.name}'s owner or the GM can roll this side.`);
      return;
    }
  }

  _launchRoller(message, taskData, side, actor);
}

// ─────────────────────────────────────────────────────────────────────────
// Sheet-roller launcher
// ─────────────────────────────────────────────────────────────────────────
// Dispatches to the existing character-sheet roller:
//   • PC / player-owned → openPlayerRoller (playerMode)
//   • Ship NPC          → openNpcRoller
//   • Ground NPC        → openPlayerRoller with groundIsNpc: true
// Sheet stats drive the pool; we only supply difficulty + suggested attr/disc.

function _launchRoller(message, taskData, side, actor) {
  const combatTokenId = side === "defender"
    ? taskData.combat?.defenderTokenId
    : taskData.combat?.attackerTokenId;
  const token = (combatTokenId ? canvas.tokens?.get(combatTokenId)?.document : null)
    ?? actor.getActiveTokens(true)[0]?.document
    ?? canvas.tokens?.placeables.find(t => t.actor?.id === actor.id)?.document
    ?? null;

  const profile = _getOpposedActorProfile(actor, token);
  const forcedGroundNpc = taskData.mode === "groundCombat" && _isOpposedGroundNpcActor(actor, token);
  const isGroundCombat = taskData.mode === "groundCombat";
  const isStarshipCombat = taskData.mode === "starshipCombat";
  const difficultyInfo = _calculateOpposedDifficulty(taskData);
  // Defender rolls at difficulty 0 (free roll to set the bar);
  // attacker must meet or beat defender's successes.
  const difficulty = side === "defender"
    ? 0
    : difficultyInfo.total;

  const starshipOfficer = isStarshipCombat
    ? (side === "defender" ? taskData.combat?.defenderOfficer : taskData.combat?.attackerOfficer)
    : null;
  const starshipUsesPlayerPayment = isStarshipCombat && !!profile.isPlayerOwned;
  const stats = starshipOfficer ?? readOfficerStats(actor);
  const sideData = side === "defender" ? taskData.defender : taskData.attacker;
  const oppositeSideData = side === "defender" ? taskData.attacker : taskData.defender;
  const oppositeTokenId = side === "defender"
    ? taskData.combat?.attackerTokenId
    : taskData.combat?.defenderTokenId;
  const opposedTraitTarget = oppositeSideData?.actorId
    ? {
        actorId: oppositeSideData.actorId,
        tokenId: oppositeTokenId ?? null,
        name: oppositeSideData.actorName ?? "Opponent",
      }
    : null;
  const suggestedAttr = sideData?.suggestedAttr ?? taskData.suggestedAttr ?? null;
  const suggestedDisc = sideData?.suggestedDisc ?? taskData.suggestedDisc ?? null;
  const complicationRange = side === "defender"
    ? (taskData.options?.defenderComplicationRange ?? taskData.options?.complicationRange ?? 1)
    : (taskData.options?.attackerComplicationRange ?? taskData.options?.complicationRange ?? 1);
  const hasAttr = stats && Object.keys(stats.attributes ?? {}).includes(suggestedAttr);
  const hasDisc = stats && Object.keys(stats.disciplines ?? {}).includes(suggestedDisc);
  // Ship assist for a character side.  A ship side is excluded — it rolls its
  // own System + Department through the roller's NPC Ship Pool.  The full
  // assigned-ship list is offered so the roller's dropdown stays usable, with
  // the GM's choice preselected.
  const sideShip = sideData?.shipAssist ?? null;
  const assistShips = (profile.isShip || !sideShip?.shipActorId)
    ? []
    : serializeShipsForRoller(orderedShipsForActor(actor, sideShip.shipActorId));
  const assistShipIdx = sideShip?.shipActorId
    ? assistShips.findIndex(s => s.actorId === sideShip.shipActorId)
    : -1;
  const starshipWeaponAssist = isStarshipCombat && (
    (side === "attacker" && !!taskData.combat?.weaponContext)
    || (side === "defender" && ["defensive-fire", "point-defense"].includes(taskData.options?.defenseType))
  );
  const starshipRollerOpts = isStarshipCombat
    ? {
        stationId: side === "defender" ? taskData.combat?.defenderStationId : taskData.combat?.attackerStationId,
        officer: starshipOfficer ?? undefined,
        crewQuality: side === "defender" ? taskData.combat?.defenderCrewQuality : taskData.combat?.attackerCrewQuality,
        weaponContext: side === "attacker" ? (taskData.combat?.weaponContext ?? null) : null,
        hasTargetingSolution: side === "attacker" && !!taskData.combat?.hasTargetingSolution,
        hasRapidFireTorpedo: side === "attacker" && !!taskData.combat?.hasRapidFireTorpedo,
        hasCalibrateWeapons: side === "attacker" && !!taskData.combat?.hasCalibrateWeapons,
        hasAttackPattern: side === "attacker" && !!taskData.combat?.hasAttackPattern,
        helmOfficer: side === "attacker" ? (taskData.combat?.helmOfficer ?? null) : null,
        attackRunActive: side === "attacker" && !!taskData.combat?.attackRunActive,
        opposedDifficulty: side === "attacker" ? difficulty : null,
        opposedDefenseType: side === "attacker" ? (taskData.options?.defenseType ?? null) : null,
        pointDefenseActive: side === "attacker" && !!taskData.options?.pointDefenseActive,
        pointDefensePenalty: side === "attacker" ? Number(taskData.options?.pointDefensePenalty ?? 0) : 0,
        defenderSuccesses: side === "attacker" ? (taskData.defender.successes ?? 0) : null,
        playerMode: starshipUsesPlayerPayment,
        usesPlayerPayment: starshipUsesPlayerPayment,
        callOutTargetsEligible: starshipWeaponAssist,
        shipAssist: starshipWeaponAssist ? true : undefined,
        shipSystemKey: starshipWeaponAssist ? "weapons" : undefined,
        shipDeptKey: starshipWeaponAssist ? "security" : undefined,
        noShipAssist: starshipWeaponAssist ? false : undefined,
        suppressWeaponResolution: side === "attacker",
      }
    : {};

  const rollerOpts = {
    difficulty,
    complicationRange,
    noPoolButton: (!isGroundCombat && !isStarshipCombat) || side === "defender",
    opposedTaskRef: {
      messageId: message.id,
      taskId: taskData.taskId,
      side,
    },
    opposedTraitTarget,
    ...starshipRollerOpts,
    taskLabel: isGroundCombat
      ? (side === "defender" ? "Melee Defender" : taskData.taskName)
      : `${taskData.kindIcon} ${taskData.taskName}`,
    taskContext: side === "defender"
      ? `Opposed — Defender (${taskData.kindLabel})`
      : `Opposed — Attacker vs ${taskData.defender.successes} success${taskData.defender.successes === 1 ? "" : "es"}`,
    ...(isGroundCombat && side === "attacker" ? {
      stationId: "tactical",
      weaponContext: taskData.combat?.weaponContext ?? null,
      aimRerolls: Number(taskData.combat?.aimRerolls ?? 0),
      opposedDifficulty: difficulty,
      opposedDefenseType: taskData.options?.defenseType ?? "melee",
      defenderSuccesses: taskData.defender.successes ?? 0,
    } : {}),
    defaultAttr: hasAttr ? suggestedAttr : null,
    defaultDisc: hasDisc ? suggestedDisc : null,
    taskCallback: async ({ successes, complications: reportedComplications = null, state, rollData = null, trackerMessageId = null, trackerFloat = 0, trackerBanked = 0 }) => {
      // Count complications across every pool that rolled (crew + assists + ship).
      // Assist complications count even when the main pool scored 0 successes.
      const allDice = allRolledDice(state ?? rollData ?? {});
      const complications = reportedComplications ?? allDice.filter(d => d?.complication).length;
      // Serialize a compact dice array for chat-card display
      const dice = allDice.map(x => ({
        value: x?.value ?? null,
        success: !!x?.success,
        crit: !!x?.crit,
        complication: !!x?.complication,
      }));
      const sideRollData = rollData ?? {
        actorId: state?.actorId ?? actor?.id ?? null,
        officerActorId: state?.officer?.id ?? null,
        weaponContext: state?.weaponContext ?? null,
        callOutTargetsEligible: state?.callOutTargetsEligible ?? false,
        callOutTargetsSources: Array.isArray(state?.callOutTargetsSources)
          ? state.callOutTargetsSources.map(s => ({ ...s }))
          : [],
        appliedTraitEffects: _cloneAppliedTraitEffects(state?.appliedTraitEffects ?? []),
        traitDifficultyDelta: Number(state?.traitDifficultyDelta ?? 0) || 0,
      };
      const traitDifficultyDelta = Number(state?.traitDifficultyDelta ?? sideRollData?.traitDifficultyDelta ?? 0) || 0;
      const appliedTraitEffects = _cloneAppliedTraitEffects(state?.appliedTraitEffects ?? sideRollData?.appliedTraitEffects ?? []);

      if (game.user.isGM) {
        await applyOpposedRollResult({
          messageId: message.id,
          taskId:    taskData.taskId,
          side,
          successes,
          complications,
          dice,
          rollData: sideRollData,
          traitDifficultyDelta,
          appliedTraitEffects,
          trackerMessageId,
          trackerFloat,
          trackerBanked,
        });
      } else {
        game.socket.emit("module.sta2e-toolkit", {
          action:    "opposedTaskRollComplete",
          messageId: message.id,
          taskId:    taskData.taskId,
          side,
          successes,
          complications,
          dice,
          rollData: sideRollData,
          traitDifficultyDelta,
          appliedTraitEffects,
          trackerMessageId,
          trackerFloat,
          trackerBanked,
        });
      }
    },
  };

  if (profile.isShip) {
    const launcher = profile.isPlayerOwned ? openPlayerRoller : openNpcRoller;
    // Without this the roller falls back to its hardcoded "proficient" default
    // and a Basic or Exceptional crew rolls at the wrong target.  Read through
    // the token's actor so an unlinked ship token's own crew quality wins.
    // `stats` is readOfficerStats(actor), which is null for ships — so it doubles
    // as the "no named officer is rolling this" guard the HUD tasks use.
    const rollActor = token?.actor ?? actor;
    launcher(actor, token, {
      ...rollerOpts,
      // Starship combat already resolved this in startStarshipCombatOpposedTask
      // (and deliberately sends null when a named officer is at the station).
      crewQuality: isStarshipCombat
        ? rollerOpts.crewQuality
        : (CombatHUD.isNpcShip(rollActor) && !stats ? CombatHUD.getCrewQuality(rollActor) : null),
    });
    return;
  }

  openNpcRoller(actor, token, {
    ...rollerOpts,
    playerMode: forcedGroundNpc ? false : profile.isPlayerOwned,
    // groundMode stays true — it also drives the Momentum/Threat resource
    // profile.  The roller shows the ship pool off the back of availableShips.
    groundMode: true,
    groundIsNpc: forcedGroundNpc || !profile.isPlayerOwned,
    usesPlayerPayment: forcedGroundNpc ? false : undefined,
    officer: stats ?? undefined,
    availableShips: assistShips,
    shipAssist: assistShipIdx >= 0,
    selectedShipIdx: assistShipIdx,
    shipSystemKey: sideShip?.shipSystemKey ?? undefined,
    shipDeptKey: sideShip?.shipDeptKey ?? undefined,
  });
}

function _isOpposedGroundNpcActor(actor, tokenDoc = null) {
  if (!actor) return false;
  const baseActor = tokenDoc?.actorId ? game.actors.get(tokenDoc.actorId) : null;
  const sheetClass = actor.sheet?.constructor?.name
    ?? baseActor?.sheet?.constructor?.name
    ?? "";
  const npcType = `${actor.system?.npcType ?? baseActor?.system?.npcType ?? ""}`.trim().toLowerCase();
  const isNpcType = npcType === "minor" || npcType === "notable" || npcType === "major";
  return /npc/i.test(sheetClass) && isNpcType;
}

function _getOpposedActorProfile(actor, tokenDoc = null) {
  const fallbackShip = actor?.type === "starship" || actor?.type === "spacecraft2e"
    || actor?.items?.some(i => i.type === "starshipweapon2e");
  if (!actor) {
    return { isShip: false, isPlayerOwned: false, npcType: "minor" };
  }

  try {
    if (fallbackShip) {
      return {
        isShip: true,
        isPlayerOwned: !CombatHUD.isNpcShip(actor),
        npcType: null,
      };
    }
    return CombatHUD.getGroundCombatProfile(actor, tokenDoc);
  } catch (err) {
    console.warn("STA2e Toolkit | opposed-task actor profiling fallback:", err);
    return {
      isShip: fallbackShip,
      isPlayerOwned: actor.hasPlayerOwner ?? false,
      npcType: actor.system?.npcType ?? "minor",
    };
  }
}

function _opposedRewardPool(actor, profile = null) {
  const resolvedProfile = profile ?? (actor ? _getOpposedActorProfile(actor) : null);
  if (resolvedProfile?.isShip) return CombatHUD.opposedShipRewardPool(actor);
  return resolvedProfile?.isPlayerOwned ? "momentum" : "threat";
}

function _opposedPoolLabel(pool) {
  return pool === "threat" ? "Threat" : pool === "alliedNpcMomentum" ? "Allied Momentum" : "Momentum";
}

function _renderOpposedPoolReward(taskData, side, amount) {
  if (!amount || amount <= 0) return "";

  const sideData = side === "defender" ? taskData.defender : taskData.attacker;
  const actor = sideData?.actorId ? game.actors.get(sideData.actorId) : null;
  const profile = actor ? _getOpposedActorProfile(actor) : null;
  if (!profile) return "";

  const pool = _opposedRewardPool(actor, profile);
  const label = _opposedPoolLabel(pool);
  const color = pool === "threat" ? LC.primary : LC.secondary;

  // Auto-banked path — show a confirmation chip instead of a clickable button.
  const auto = taskData.autoBank;
  if (auto && auto.winnerSide === side && auto.pool === pool && auto.amount === amount) {
    const banked = auto.banked ?? amount;
    const floatLeft = auto.float ?? 0;
    return `
        <div style="margin-top:6px;padding-top:6px;border-top:1px solid ${LC.borderDim};text-align:center;">
          <span style="font-size:10px;font-weight:700;color:${color};letter-spacing:0.08em;text-transform:uppercase;">
            ✓ +${banked} ${label} banked to pool${floatLeft > 0 ? ` · ${floatLeft} float` : ""}
          </span>
        </div>`;
  }

  // Fallback (legacy cards / auto-bank failed) — keep the clickable button.
  const buttonLabel = `+${amount} ${label} to Pool`;

  return `
        <div style="margin-top:6px;padding-top:6px;border-top:1px solid ${LC.borderDim};">
          <div style="font-size:10px;letter-spacing:0.1em;color:${LC.textDim};text-transform:uppercase;">Reward</div>
          <div style="font-size:11px;color:${LC.textDim};margin-top:2px;">
            ${_esc(sideData?.actorName ?? "Winner")} gains +${amount} ${label}.
          </div>
          <button type="button" class="sta2e-add-to-pool"
            data-pool="${pool}"
            data-amount="${amount}"
            data-token-id=""
            style="width:100%;margin-top:6px;padding:5px 8px;background:rgba(0,0,0,0.25);
              border:1px solid ${color};border-radius:2px;cursor:pointer;
              font-family:${LC.font};font-size:10px;font-weight:700;
              color:${color};letter-spacing:0.06em;text-align:center;">
            ${buttonLabel}
          </button>
        </div>`;
}

// ─────────────────────────────────────────────────────────────────────────
// GM-side resolver (called directly on the GM client or via socket)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Record an opposed-task roll result on the chat card's flags and re-render.
 * Must run on the GM's client (only the GM can update arbitrary ChatMessages
 * and flip state across all users).
 */
export async function applyOpposedRollResult({ messageId, taskId, side, successes, complications, dice, rollData = null, traitDifficultyDelta = null, appliedTraitEffects = null, trackerMessageId = null, trackerFloat = 0, trackerBanked = 0 }) {
  if (!game.user.isGM) return;
  const message = game.messages.get(messageId);
  if (!message) {
    console.warn(`STA2e Toolkit | applyOpposedRollResult: message ${messageId} not found`);
    return;
  }
  const flags = message.flags?.[MODULE] ?? {};
  if (flags.type !== "opposedTask") return;
  const taskData = flags.taskData;
  if (!taskData || taskData.taskId !== taskId) return;

  const sideData = side === "defender" ? taskData.defender : taskData.attacker;
  if (!sideData) return;
  if (sideData.rolled) return;  // idempotent

  sideData.rolled = true;
  sideData.successes = Math.max(0, successes ?? 0);
  sideData.complications = Math.max(0, complications ?? 0);
  sideData.dice = Array.isArray(dice) ? dice : [];
  sideData.rollData = rollData ?? null;
  sideData.traitDifficultyDelta = Number(traitDifficultyDelta ?? rollData?.traitDifficultyDelta ?? 0) || 0;
  sideData.appliedTraitEffects = _cloneAppliedTraitEffects(appliedTraitEffects ?? rollData?.appliedTraitEffects ?? []);
  if (trackerMessageId || trackerFloat || trackerBanked) {
    sideData.tracker = {
      messageId: trackerMessageId ?? null,
      float: Number(trackerFloat ?? 0),
      banked: Number(trackerBanked ?? 0),
    };
  }
  if (side === "defender") {
    taskData.opposedDifficulty = _calculateOpposedDifficulty(taskData).total;
  }
  if (side === "attacker") {
    taskData.opposedDifficulty = _calculateOpposedDifficulty(taskData).total;
  }

  // Status transitions
  if (side === "defender") taskData.status = "awaiting-attacker";
  if (side === "attacker") taskData.status = "resolved";

  // Auto-bank the margin to the winner's pool for social opposed tasks.
  // Ground combat keeps its existing weapon/damage pipeline — skip here.
  if (side === "attacker" && taskData.mode !== "groundCombat" && taskData.mode !== "starshipCombat") {
    const target = _calculateOpposedDifficulty(taskData).total;
    const atkSuc = taskData.attacker.successes ?? 0;
    const passed = atkSuc >= target;
    const rewardAmount = Math.abs(atkSuc - target);
    const winnerSideKey = passed ? "attacker" : "defender";
    const winnerSideData = passed ? taskData.attacker : taskData.defender;
    if (rewardAmount > 0 && winnerSideData?.actorId) {
      const winnerActor = game.actors.get(winnerSideData.actorId);
      if (winnerActor) {
        const profile = _getOpposedActorProfile(winnerActor);
        const pool = _opposedRewardPool(winnerActor, profile);
        try {
          const trackerRes = await createTracker(winnerActor, {
            totalGenerated: rewardAmount,
            pool,
            taskRollId: taskData.taskId,
            speakerToken: null,
          });
          taskData.autoBank = {
            pool,
            amount: rewardAmount,
            banked: trackerRes?.banked ?? rewardAmount,
            float: trackerRes?.float ?? 0,
            winnerSide: winnerSideKey,
            winnerName: winnerSideData.actorName ?? "Winner",
          };
        } catch (err) {
          console.error("STA2e Toolkit | opposed task auto-bank error:", err);
        }
      }
    }
  }

  // Ground combat: the attacker's WIN excess is already banked by the roller
  // (createTracker runs there since noPoolButton is false for the ground
  // attacker). The defender-win case (attacker fails) is never banked, so do it
  // here — the defender's excess successes become Momentum (PC) / Threat (NPC).
  if (side === "attacker" && taskData.mode === "groundCombat") {
    const target = _calculateOpposedDifficulty(taskData).total;
    const atkSuc = taskData.attacker.successes ?? 0;
    const passed = atkSuc >= target;
    const reward = passed ? (atkSuc - target) : (target - atkSuc);
    const winnerSide = passed ? "attacker" : "defender";
    const winnerData = passed ? taskData.attacker : taskData.defender;
    const reportedTracker = taskData.attacker?.tracker ?? {};
    const attackerAlreadyReported = !!reportedTracker.messageId
      || Number(reportedTracker.float ?? 0) > 0
      || Number(reportedTracker.banked ?? 0) > 0
      || Number(trackerFloat ?? 0) > 0
      || Number(trackerBanked ?? 0) > 0
      || !!trackerMessageId;

    if (reward > 0 && (!passed || !attackerAlreadyReported)) {
      const winnerActor = winnerData?.actorId ? game.actors.get(winnerData.actorId) : null;
      if (reward > 0 && winnerActor) {
        const pool = _opposedRewardPool(winnerActor);
        const speakerToken = winnerSide === "attacker" && taskData.combat?.attackerTokenId
          ? (canvas.tokens?.get(taskData.combat.attackerTokenId) ?? null)
          : winnerSide === "defender" && taskData.combat?.defenderTokenId
            ? (canvas.tokens?.get(taskData.combat.defenderTokenId) ?? null)
            : null;
        try {
          const trackerRes = await createTracker(winnerActor, {
            totalGenerated: reward,
            pool,
            taskRollId: taskData.taskId,
            speakerToken,
          });
          taskData.autoBank = {
            pool,
            amount: reward,
            banked: trackerRes?.banked ?? reward,
            float: trackerRes?.float ?? 0,
            winnerSide,
            winnerName: winnerData.actorName ?? (passed ? "Attacker" : "Defender"),
          };
        } catch (err) {
          console.error("STA2e Toolkit | ground opposed auto-bank error:", err);
        }
      }
    }
  }

  // Starship attackers normally report their own generated Momentum/Threat
  // through the attack roller. A defender victory has no defender-side roller
  // after the attacker fails, so bank that margin here at the moment the
  // opposed task resolves. This also guarantees the reward is paid even if a
  // later weapon lookup or damage-card step cannot complete.
  if (side === "attacker" && taskData.mode === "starshipCombat") {
    const target = _calculateOpposedDifficulty(taskData).total;
    const attackerSuccesses = Number(taskData.attacker?.successes ?? 0);
    const defenderWon = attackerSuccesses < target;
    const reward = defenderWon ? target - attackerSuccesses : 0;
    const defenderData = taskData.defender ?? {};
    const speakerToken = taskData.combat?.defenderTokenId
      ? (canvas.tokens?.get(taskData.combat.defenderTokenId) ?? null)
      : null;
    const defenderActor = speakerToken?.actor
      ?? (defenderData.actorId ? game.actors.get(defenderData.actorId) : null);
    if (reward > 0 && defenderActor) {
      const pool = _opposedRewardPool(defenderActor);
      const bonus = _opposedSideBonusMomentum(defenderData, true);
      try {
        const trackerRes = await createTracker(defenderActor, {
          totalGenerated: reward,
          bonus,
          pool,
          taskRollId: taskData.taskId,
          speakerToken,
        });
        taskData.autoBank = {
          pool,
          amount: reward,
          bonus,
          banked: trackerRes?.banked ?? reward,
          float: trackerRes?.float ?? 0,
          winnerSide: "defender",
          winnerName: defenderData.actorName ?? "Defender",
        };
        taskData.combat = {
          ...(taskData.combat ?? {}),
          defenderRewardAwarded: true,
        };
      } catch (err) {
        console.error("STA2e Toolkit | starship defender reward auto-bank error:", err);
      }
    }
  }

  const newContent = _renderCardHtml(taskData);
  const updatedFlags = {
    ...(message.flags?.[MODULE] ?? {}),
    taskData,
  };

  if (side === "attacker") {
    if (taskData.mode === "starshipCombat") {
      await _resolveStarshipOpposedAttack(taskData, {
        rollData,
        trackerMessageId,
        trackerFloat,
        trackerBanked,
      });
    }
    try {
      await ChatMessage.create({
        content: newContent,
        speaker: message.speaker,
        flags: {
          [MODULE]: updatedFlags,
        },
      });
      await message.delete();
    } catch (e) {
      console.error("STA2e Toolkit | repost resolved opposed task failed:", e);
      await message.update({
        content: newContent,
        [`flags.${MODULE}.taskData`]: taskData,
      }).catch(err => console.error("STA2e Toolkit | apply opposed result fallback update failed:", err));
    }
    return;
  }

  await message.update({
    content: newContent,
    [`flags.${MODULE}.taskData`]: taskData,
  }).catch(e => console.error("STA2e Toolkit | apply opposed result failed:", e));
}

async function _resolveStarshipOpposedAttack(taskData, { rollData = null, trackerMessageId = null, trackerFloat = 0, trackerBanked = 0 } = {}) {
  const combat = taskData.combat ?? {};
  const weaponContext = combat.weaponContext ?? {};
  const attackerToken = combat.attackerTokenId ? canvas.tokens?.get(combat.attackerTokenId) : null;
  const defenderToken = combat.defenderTokenId ? canvas.tokens?.get(combat.defenderTokenId) : null;
  const attackerActor = attackerToken?.actor ?? game.actors.get(taskData.attacker?.actorId);
  const weaponActor = weaponContext.shipActorId
    ? game.actors.get(weaponContext.shipActorId)
    : attackerActor;
  const weapon = weaponContext.weaponId
    ? weaponActor?.items.get(weaponContext.weaponId)
    : weaponActor?.items.find(i => i.type === "starshipweapon2e" && i.name === weaponContext.name);

  if (!attackerToken || !defenderToken || !weapon) {
    ui.notifications.warn("STA2e Toolkit: Starship opposed attack could not resolve; attacker, defender, or weapon missing.");
    return;
  }

  const finalDifficulty = _calculateOpposedDifficulty(taskData).total;
  const isHit = (taskData.attacker?.successes ?? 0) >= finalDifficulty;

  if (rollData?.hasTargetingSolution && rollData?.tsChoice) {
    const benefit = rollData.hasFastTargeting ? "both" : rollData.tsChoice;
    await CombatHUD.setTargetingSolution(attackerToken, {
      active: true,
      benefit,
      system: rollData.tsSystem ?? null,
    });
  }

  const calibrateWeaponsBonus = combat.hasCalibrateWeapons ? 1 : 0;
  const attackerTracker = taskData.attacker?.tracker ?? {};
  const attackerBonusMomentum = _opposedSideBonusMomentum(taskData.attacker, isHit);
  const defenderBonusMomentum = _opposedSideBonusMomentum(taskData.defender, !isHit);
  await CombatHUD.resolveShipAttack(attackerToken, weapon, isHit, {
    salvoMode: weaponContext.salvoMode ?? "area",
    rapidFireBonus: combat.hasRapidFireTorpedo && weaponContext.isTorpedo ? 1 : 0,
    calibrateWeaponsBonus,
    defenderSuccesses: taskData.defender?.successes ?? null,
    opposedDifficulty: finalDifficulty,
    opposedDefenseType: taskData.options?.defenseType ?? null,
    pointDefenseActive: !!taskData.options?.pointDefenseActive,
    pointDefensePenalty: Number(taskData.options?.pointDefensePenalty ?? 0),
    attackerSuccesses: taskData.attacker?.successes ?? null,
    overrideTargets: [defenderToken],
    floatingMomentum: Number(trackerFloat ?? attackerTracker.float ?? 0),
    intenseTalentBonus: attackerBonusMomentum,
    opposedDefenderBonus: defenderBonusMomentum,
    trackerMessageId: trackerMessageId ?? attackerTracker.messageId ?? null,
    complications: taskData.attacker?.complications ?? 0,
    opposedMomentumAwarded: !!(trackerMessageId ?? attackerTracker.messageId)
      || Number(trackerFloat ?? attackerTracker.float ?? 0) > 0
      || Number(trackerBanked ?? attackerTracker.banked ?? 0) > 0,
    defenderOpposedRewardAwarded: !!combat.defenderRewardAwarded,
    opposedPoolAward: taskData.autoBank ?? null,
  });

  if (calibrateWeaponsBonus) {
    attackerToken.document?.unsetFlag?.(MODULE, "calibrateWeapons")?.catch?.(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────

function _esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
