/**
 * sta2e-toolkit | opposed-task.js
 * Social / skill / stealth opposed-task system.
 *
 * Orchestrated entirely through chat cards so we don't pile more buttons
 * onto the NPC Roller UI.  Flow:
 *
 *   1. GM runs /opposed (or clicks the toolkit widget button) → setup dialog.
 *      The dialog has drag-and-drop actor slots for Defender and Attacker,
 *      plus "Reuse last" and "Recent ▾" pickers backed by CampaignStore.
 *   2. Dialog posts a chat card.  Only Roll as Defender is active
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
import { openNpcRoller, openPlayerRoller } from "./npc-roller.js";
import { getStationOfficers, readOfficerStats } from "./crew-manifest.js";
import { CombatHUD } from "./combat-hud.js";
import { createTracker } from "./momentum-tracker.js";

const MODULE = "sta2e-toolkit";

// ── LCARS tokens — resolved at render time per active campaign theme ─────
const LC = new Proxy({}, {
  get(_, prop) { return getLcTokens()[prop]; },
});

function _getOpposedThemeKey() {
  return getActiveLcThemeKey();
}

// Attribute / Discipline option tables — drives the dropdowns in the dialog.
// Keys match sta system data paths (actor.system.attributes.<key>.value etc).
const ATTR_OPTIONS = [
  { key: "control",    label: "Control" },
  { key: "daring",     label: "Daring" },
  { key: "fitness",    label: "Fitness" },
  { key: "insight",    label: "Insight" },
  { key: "presence",   label: "Presence" },
  { key: "reason",     label: "Reason" },
];
const DISC_OPTIONS = [
  { key: "command",     label: "Command" },
  { key: "conn",        label: "Conn" },
  { key: "engineering", label: "Engineering" },
  { key: "medicine",    label: "Medicine" },
  { key: "science",     label: "Science" },
  { key: "security",    label: "Security" },
];
const COMPLICATION_RANGES = [1, 2, 3, 4, 5];

const DEFAULT_KIND = { key: "social", label: "Social", icon: "Social" };

function _clampInt(value, min, max, fallback = min) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function _normalizeTraitModifier(source = {}) {
  const mode = ["increase", "reduce"].includes(source?.traitModifierMode)
    ? source.traitModifierMode
    : "none";
  const potency = _clampInt(source?.traitModifierPotency, 1, 5, 1);
  const name = String(source?.traitModifierName ?? "").trim();
  return {
    traitModifierMode: mode,
    traitModifierPotency: potency,
    traitModifierName: name,
  };
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

function _calculateOpposedDifficulty(taskData = {}) {
  const options = taskData.options ?? {};
  const base = Number(taskData.defender?.successes ?? 0);
  const guardPenalty = Number(options.guardPenalty ?? 0);
  const pronePenalty = Number(options.pronePenalty ?? 0);
  const overridePenalty = Number(options.overridePenalty ?? 0);
  const cumbersomePenalty = Number(options.cumbersomePenalty ?? 0);
  const attackPatternPenalty = Number(options.attackPatternPenalty ?? 0);
  const traitDelta = _traitModifierDelta(options);
  const total = Math.max(0, base + guardPenalty + pronePenalty + overridePenalty + cumbersomePenalty - attackPatternPenalty + traitDelta);
  return { base, guardPenalty, pronePenalty, overridePenalty, cumbersomePenalty, attackPatternPenalty, traitDelta, total };
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
// Setup Dialog
// ─────────────────────────────────────────────────────────────────────────

/**
 * Open the Opposed Task setup dialog.  GM-only; players should trigger the
 * GM via some other affordance if they want one posted on their behalf.
 *
 * @param {object} [prefill] - optional partial snapshot to pre-populate fields
 *                             (used by "reuse last" / "recent" / /opposed args).
 */
export function openOpposedTaskSetup(prefill = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn("STA2e Toolkit: Only the GM can post an opposed task.");
    return;
  }

  const recent = game.sta2eToolkit?.campaignStore?.getRecentOpposedTasks?.() ?? [];
  const lastSnap = recent[0] ?? null;

  // Working state — mutated by the dialog's inputs before posting.
  const state = {
    taskName:              prefill.taskName ?? "",
    flavor:                prefill.flavor ?? "",
    kind:                  prefill.kind ?? DEFAULT_KIND.key,
    defenderSuggestedAttr: prefill.defenderSuggestedAttr ?? prefill.suggestedAttr ?? "presence",
    defenderSuggestedDisc: prefill.defenderSuggestedDisc ?? prefill.suggestedDisc ?? "command",
    attackerSuggestedAttr: prefill.attackerSuggestedAttr ?? prefill.suggestedAttr ?? "presence",
    attackerSuggestedDisc: prefill.attackerSuggestedDisc ?? prefill.suggestedDisc ?? "command",
    defenderActorId:       prefill.defenderActorId ?? prefill.responderActorId ?? null,
    attackerActorId:       prefill.attackerActorId ?? prefill.initiatorActorId ?? null,
    options: {
      defenderComplicationRange: prefill.options?.defenderComplicationRange ?? prefill.defenderComplicationRange ?? prefill.options?.complicationRange ?? prefill.complicationRange ?? 1,
      attackerComplicationRange: prefill.options?.attackerComplicationRange ?? prefill.attackerComplicationRange ?? prefill.options?.complicationRange ?? prefill.complicationRange ?? 1,
      ..._normalizeTraitModifier(prefill.options ?? prefill),
    },
  };

  const html = _buildDialogHtml(state, { recent, lastSnap });

  const dialog = new foundry.applications.api.DialogV2({
    window: { title: "STA 2e · Opposed Task", resizable: true },
    position: { width: 760 },
    content: html,
    buttons: [
      { action: "cancel", label: "Cancel" },
      {
        action: "post",
        label: "▶ Post Card",
        default: true,
        callback: (_ev, _btn, dlg) => {
          _readDialogState(dlg.element, state);
          if (!state.defenderActorId || !state.attackerActorId) {
            ui.notifications.warn("STA2e Toolkit: Assign both Defender and Attacker.");
            return false;
          }
          if (!state.taskName.trim()) state.taskName = "Opposed Task";
          postOpposedTaskCard(state);
        },
      },
    ],
    rejectClose: false,
  });

  dialog.render({ force: true }).then(() => _wireDialog(dialog.element, state, { recent, lastSnap }));
}

// ─────────────────────────────────────────────────────────────────────────
// Dialog HTML
// ─────────────────────────────────────────────────────────────────────────

function _buildDialogHtml(state, { recent, lastSnap }) {
  const theme = _getOpposedThemeKey();
  const template = getLcThemeTemplate(theme);
  const themeVars = getLcCssVars("op");
  const attrOpts = (selectedKey) => ATTR_OPTIONS.map(a =>
    `<option value="${a.key}" ${selectedKey === a.key ? "selected" : ""}>${a.label}</option>`).join("");
  const discOpts = (selectedKey) => DISC_OPTIONS.map(d =>
    `<option value="${d.key}" ${selectedKey === d.key ? "selected" : ""}>${d.label}</option>`).join("");
  const defCompRange = Number(state.options?.defenderComplicationRange ?? 1);
  const atkCompRange = Number(state.options?.attackerComplicationRange ?? 1);
  const traitMod = _normalizeTraitModifier(state.options ?? {});
  const compDesc = (n) => n <= 1 ? "Complications on: 20" : `Complications on: ${21 - n}-20`;

  const recentOpts = recent.map((s, i) => {
    const defId = s.defenderActorId ?? s.responderActorId;
    const atkId = s.attackerActorId ?? s.initiatorActorId;
    const dName = game.actors.get(defId)?.name ?? "?";
    const aName = game.actors.get(atkId)?.name ?? "?";
    const warn = (!game.actors.get(defId) || !game.actors.get(atkId)) ? " WARN" : "";
    return `<option value="${i}">${s.taskName ?? "Opposed Task"} - ${dName} vs ${aName}${warn}</option>`;
  }).join("");

  const reuseDisabled = lastSnap ? "" : "disabled";
  const recentDisabled = recent.length ? "" : "disabled";
  const clearRecentDisabled = recent.length ? "" : "disabled";

  return `
    <div class="sta2e-opposed-setup" data-theme="${theme}" data-template="${template}" style="
      ${themeVars}
      display:flex;flex-direction:column;gap:10px;font-family:${LC.font};color:${LC.text};
      background:${LC.bg};
      padding:10px;border:1px solid ${LC.border};border-left:8px solid ${LC.primary};
      border-radius:18px 4px 18px 4px;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.03), 0 8px 20px rgba(0,0,0,0.28);">

      <div class="sta2e-opposed-setup-header" style="display:grid;grid-template-columns:92px 1fr;gap:10px;align-items:stretch;">
        <div class="sta2e-opposed-setup-sidebar" style="
          background:${LC.primary};
          border-radius:18px 4px 4px 18px;min-height:86px;position:relative;overflow:hidden;">
        </div>
        <div class="sta2e-opposed-setup-titlebox" style="
          background:${LC.panel};border:1px solid ${LC.border};border-radius:4px 18px 18px 4px;
          padding:10px 12px;display:flex;flex-direction:column;justify-content:center;">
          <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${LC.primary};font-weight:700;">
            Opposed Task
          </div>
          <div style="font-size:11px;line-height:1.5;color:${LC.textDim};margin-top:4px;">
            Assign defender and attacker, suggest the core Attribute and Discipline, then post the card.
          </div>
        </div>
      </div>

      <div class="sta2e-opposed-setup-toolbar" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <button type="button" class="op-reuse-last" ${reuseDisabled}
          style="--op-button-accent:${LC.primary};background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};padding:5px 10px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;">
          Reuse Last
        </button>
        <button type="button" class="op-clear-recent" ${clearRecentDisabled}
          style="--op-button-accent:${LC.secondary};background:${LC.panel};color:${LC.textDim};border:1px solid ${LC.borderDim};padding:5px 10px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;">
          Clear Recent
        </button>
        <select class="op-recent" ${recentDisabled}
          style="background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};padding:5px 10px;border-radius:999px;font-family:inherit;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;">
          <option value="">Recent</option>
          ${recentOpts}
        </select>
      </div>

      <div class="op-task-field" style="display:block;">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${LC.textDim};">
          Task Name
          <input type="text" class="op-task-name" value="${_esc(state.taskName)}"
            style="width:100%;background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};padding:8px 10px;border-radius:12px 3px 12px 3px;font-size:13px;"/>
        </label>
      </div>

      <label class="op-flavor-field" style="display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${LC.textDim};">
        Flavor
        <input type="text" class="op-flavor" value="${_esc(state.flavor)}"
          style="width:100%;background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};padding:8px 10px;border-radius:12px 3px 12px 3px;font-size:12px;"/>
      </label>

      <div class="op-comp-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:start;">
        ${_complicationSliderHtml("defender", "Defender", defCompRange, LC.primary)}
        ${_complicationSliderHtml("attacker", "Attacker", atkCompRange, LC.secondary)}
      </div>

      <div class="op-panel op-trait-panel" style="border:1px solid ${LC.border};background:${LC.panel};padding:8px;border-radius:16px 3px 16px 3px;display:grid;grid-template-columns:minmax(0,1.3fr) 90px minmax(0,1.4fr);gap:8px;align-items:end;">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${LC.textDim};">
          Trait Effect
          <select class="op-trait-mode" style="background:${LC.bg};color:${LC.text};border:1px solid ${LC.border};padding:6px 8px;border-radius:10px 3px 10px 3px;">
            <option value="none" ${traitMod.traitModifierMode === "none" ? "selected" : ""}>No trait modifier</option>
            <option value="increase" ${traitMod.traitModifierMode === "increase" ? "selected" : ""}>Increase attacker Difficulty</option>
            <option value="reduce" ${traitMod.traitModifierMode === "reduce" ? "selected" : ""}>Reduce attacker Difficulty</option>
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${LC.textDim};">
          Potency
          <input type="number" min="1" max="5" class="op-trait-potency" value="${traitMod.traitModifierPotency}"
            style="background:${LC.bg};color:${LC.tertiary};border:1px solid ${LC.border};padding:6px 8px;border-radius:10px 3px 10px 3px;text-align:center;font-weight:700;"/>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${LC.textDim};">
          Trait Name / Reason
          <input type="text" class="op-trait-name" value="${_esc(traitMod.traitModifierName)}"
            style="background:${LC.bg};color:${LC.text};border:1px solid ${LC.border};padding:6px 8px;border-radius:10px 3px 10px 3px;"/>
        </label>
      </div>

      <div class="op-slot-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
        ${_slotHtml("defender", "Defender", state.defenderActorId)}
        ${_slotHtml("attacker", "Attacker", state.attackerActorId)}
      </div>

      <div class="op-roll-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${_sideSuggestionHtml("defender", "Defender", state.defenderSuggestedAttr, state.defenderSuggestedDisc)}
        ${_sideSuggestionHtml("attacker", "Attacker", state.attackerSuggestedAttr, state.attackerSuggestedDisc)}
      </div>
    </div>
  `;

  function _sideSuggestionHtml(sideKey, label, attrKey, discKey) {
    const accent = sideKey === "defender" ? LC.primary : LC.secondary;
    return `
      <div class="op-panel op-panel--roll-pair" style="border:1px solid ${LC.border};background:${LC.panel};padding:8px;border-radius:16px 3px 16px 3px;">
        <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};margin-bottom:6px;font-weight:700;">
          ${label} Roll Pair
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${LC.textDim};">
            Attribute
            <select class="op-${sideKey}-attr" style="background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};padding:8px 10px;border-radius:12px 3px 12px 3px;font-family:inherit;">${attrOpts(attrKey)}</select>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${LC.textDim};">
            Discipline
            <select class="op-${sideKey}-disc" style="background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};padding:8px 10px;border-radius:12px 3px 12px 3px;font-family:inherit;">${discOpts(discKey)}</select>
          </label>
        </div>
      </div>
    `;
  }

  function _complicationSliderHtml(sideKey, label, value, accent) {
    return `
      <div class="op-panel op-panel--complication" style="border:1px solid ${LC.border};background:${LC.panel};padding:8px;border-radius:16px 3px 16px 3px;">
        <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};margin-bottom:6px;font-weight:700;">
          ${label} Complication Range
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="range" min="1" max="5" value="${value}" class="op-${sideKey}-complication-range"
            style="flex:1;accent-color:${accent};cursor:pointer;" />
          <span class="op-${sideKey}-complication-range-val"
            style="min-width:16px;text-align:right;font-size:12px;font-weight:700;color:${accent};">${value}</span>
        </div>
        <div class="op-${sideKey}-complication-desc" style="margin-top:4px;font-size:10px;color:${LC.textDim};">
          ${compDesc(value)}
        </div>
      </div>
    `;
  }
}

function _slotHtml(slotKey, title, actorId) {
  const actor = actorId ? game.actors.get(actorId) : null;
  const filled = !!actor;
  return `
    <div class="op-slot" data-slot="${slotKey}" data-actor-id="${actorId ?? ""}"
      style="border:1px solid ${LC.border};background:${LC.panel};padding:8px;border-radius:16px 3px 16px 3px;min-height:104px;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.02);">
      <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${LC.primary};margin-bottom:6px;font-weight:700;">
        ${title}
      </div>
      <div class="op-slot-body">
        ${filled ? `
          <div style="display:flex;gap:8px;align-items:center;">
            <img src="${actor.img ?? "icons/svg/mystery-man.svg"}" style="width:34px;height:34px;border:1px solid ${LC.border};border-radius:8px 2px 8px 2px;"/>
            <div style="flex:1;">
              <div style="font-weight:700;font-size:13px;">${_esc(actor.name)}</div>
              <div style="font-size:10px;color:${LC.textDim};">${_actorKindLabel(actor)}</div>
            </div>
            <button type="button" class="op-slot-clear" title="Clear"
              style="background:transparent;border:none;color:${LC.textDim};cursor:pointer;font-size:14px;">X</button>
          </div>
        ` : `
          <div class="op-drop-hint" style="color:${LC.textDim};font-size:11px;line-height:1.5;padding:8px 2px 4px;">
            Drag an actor or token here
          </div>
        `}
      </div>
      <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap;">
        <button type="button" class="op-slot-pick" data-source="selected"
          style="--op-button-accent:${LC.primary};flex:1;background:${LC.bg};color:${LC.text};border:1px solid ${LC.border};padding:4px 6px;border-radius:999px;font-size:9px;cursor:pointer;letter-spacing:0.06em;text-transform:uppercase;">
          Selected
        </button>
        <button type="button" class="op-slot-pick" data-source="targeted"
          style="--op-button-accent:${LC.secondary};flex:1;background:${LC.bg};color:${LC.text};border:1px solid ${LC.border};padding:4px 6px;border-radius:999px;font-size:9px;cursor:pointer;letter-spacing:0.06em;text-transform:uppercase;">
          Targeted
        </button>
        <button type="button" class="op-slot-pick" data-source="list"
          style="--op-button-accent:${LC.tertiary};flex:1;background:${LC.bg};color:${LC.text};border:1px solid ${LC.border};padding:4px 6px;border-radius:999px;font-size:9px;cursor:pointer;letter-spacing:0.06em;text-transform:uppercase;">
          List...
        </button>
      </div>
    </div>
  `;
}

function _actorKindLabel(actor) {
  if (!actor) return "";
  const profile = _getOpposedActorProfile(actor);
  if (profile.isShip) return "Ship";

  const owners = game.users
    .filter(u => !u.isGM && actor.testUserPermission?.(u, "OWNER"))
    .map(u => u.name);
  if (profile.isPlayerOwned) {
    return owners.length ? `Player: ${owners.join(", ")}` : "Player / Support";
  }

  const npcTier = profile.npcType ?? "minor";
  return `${npcTier[0].toUpperCase()}${npcTier.slice(1)} NPC`;
}

// ─────────────────────────────────────────────────────────────────────────
// Dialog wiring — drag-and-drop + pickers
// ─────────────────────────────────────────────────────────────────────────

function _wireDialog(root, state, { recent, lastSnap }) {
  if (!root) return;

  ["defender", "attacker"].forEach(side => {
    root.querySelector(`.op-${side}-complication-range`)?.addEventListener("input", (e) => {
      const n = Math.max(1, Math.min(5, Number(e.target.value) || 1));
      const key = side === "defender" ? "defenderComplicationRange" : "attackerComplicationRange";
      state.options = { ...(state.options ?? {}), [key]: n };
      const val = root.querySelector(`.op-${side}-complication-range-val`);
      const desc = root.querySelector(`.op-${side}-complication-desc`);
      if (val) val.textContent = String(n);
      if (desc) desc.textContent = n <= 1 ? "Complications on: 20" : `Complications on: ${21 - n}-20`;
    });
  });

  // Reuse last / recent
  root.querySelector(".op-reuse-last")?.addEventListener("click", () => {
    if (!lastSnap) return;
    _applySnapshot(root, state, lastSnap);
  });
  root.querySelector(".op-recent")?.addEventListener("change", (e) => {
    const idx = parseInt(e.target.value);
    if (isNaN(idx)) return;
    const snap = recent[idx];
    if (snap) _applySnapshot(root, state, snap);
    e.target.value = "";
  });
  root.querySelector(".op-clear-recent")?.addEventListener("click", async () => {
    const clearBtn = root.querySelector(".op-clear-recent");
    const reuseBtn = root.querySelector(".op-reuse-last");
    const recentSel = root.querySelector(".op-recent");
    clearBtn.disabled = true;
    try {
      await game.sta2eToolkit?.campaignStore?.clearRecentOpposedTasks?.();
      if (recentSel) {
        recentSel.innerHTML = `<option value="">Recent</option>`;
        recentSel.value = "";
        recentSel.disabled = true;
      }
      if (reuseBtn) reuseBtn.disabled = true;
      clearBtn.textContent = "Recent Cleared";
    } catch (err) {
      console.error("STA2e Toolkit | clear recent opposed tasks failed:", err);
      clearBtn.disabled = false;
    }
  });

  // Drag-and-drop for each slot
  root.querySelectorAll(".op-slot").forEach(slotEl => {
    _wireSingleSlot(root, state, slotEl);
  });
}

/** Parse a drag event for Foundry actor/token payloads. */
function _getDragData(event) {
  try {
    const txt = event.dataTransfer?.getData("text/plain")
             ?? event.dataTransfer?.getData("application/json")
             ?? "";
    return txt ? JSON.parse(txt) : null;
  } catch { return null; }
}

async function _resolveDragToActor(data) {
  if (!data) return null;
  // Foundry's standard Actor drop payload uses { type:"Actor", uuid:"..." }
  if (data.uuid) {
    try {
      const doc = await fromUuid(data.uuid);
      if (doc?.actor) return doc.actor;        // token → actor
      if (doc?.documentName === "Actor") return doc;
      return null;
    } catch { /* fall through */ }
  }
  // Legacy { type:"Actor", id } payload
  if (data.type === "Actor" && data.id) return game.actors.get(data.id);
  return null;
}

async function _pickActorBySource(source) {
  if (source === "selected") {
    const t = canvas.tokens?.controlled[0];
    return t?.actor?.id ?? null;
  }
  if (source === "targeted") {
    const t = Array.from(game.user.targets ?? [])[0];
    return t?.actor?.id ?? null;
  }
  if (source === "mine") {
    return game.user.character?.id ?? null;
  }
  if (source === "list") {
    return await _openActorListPicker();
  }
  return null;
}

/** Simple DialogV2 actor list picker with a search filter. */
function _openActorListPicker() {
  return new Promise(resolve => {
    const actors = game.actors.contents
      .filter(a => a.system?.attributes || a.system?.systems)
      .sort((a, b) => a.name.localeCompare(b.name));

    const html = `
      <div style="display:flex;flex-direction:column;gap:6px;max-height:420px;">
        <input type="text" class="op-pick-search" placeholder="Filter…"
          style="padding:4px;background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};font-family:${LC.font};"/>
        <div class="op-pick-list" style="overflow-y:auto;max-height:360px;border:1px solid ${LC.border};">
          ${actors.map(a => `
            <div class="op-pick-row" data-actor-id="${a.id}"
              style="display:flex;gap:6px;align-items:center;padding:4px;cursor:pointer;border-bottom:1px solid ${LC.borderDim};">
              <img src="${a.img ?? "icons/svg/mystery-man.svg"}" style="width:22px;height:22px;border:1px solid ${LC.border};"/>
              <span style="flex:1;">${_esc(a.name)}</span>
              <span style="font-size:10px;color:${LC.textDim};">${_actorKindLabel(a)}</span>
            </div>`).join("")}
        </div>
      </div>`;

    const dlg = new foundry.applications.api.DialogV2({
      window: { title: "Pick Actor" },
      position: { width: 400 },
      content: html,
      buttons: [{ action: "cancel", label: "Cancel", callback: () => resolve(null) }],
      rejectClose: false,
    });
    dlg.render({ force: true }).then(() => {
      const root = dlg.element;
      const search = root.querySelector(".op-pick-search");
      search?.addEventListener("input", () => {
        const q = search.value.toLowerCase();
        root.querySelectorAll(".op-pick-row").forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
        });
      });
      root.querySelectorAll(".op-pick-row").forEach(row => {
        row.addEventListener("click", () => {
          const id = row.dataset.actorId;
          dlg.close();
          resolve(id);
        });
      });
    });
  });
}

function _assignSlot(root, state, slot, actorId) {
  if (slot === "defender") state.defenderActorId = actorId;
  if (slot === "attacker") state.attackerActorId = actorId;
  const slotEl = root.querySelector(`.op-slot[data-slot="${slot}"]`);
  if (slotEl) {
    const title = slot === "defender" ? "🛡 Defender" : "🎯 Attacker";
    const fresh = _slotHtml(slot, title, actorId);
    slotEl.outerHTML = fresh;
    // Re-wire the freshly rebuilt slot only
    const newSlot = root.querySelector(`.op-slot[data-slot="${slot}"]`);
    _wireSingleSlot(root, state, newSlot);
  }
}

function _wireSingleSlot(root, state, slotEl) {
  if (!slotEl) return;
  slotEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    slotEl.style.borderColor = LC.primary;
  });
  slotEl.addEventListener("dragleave", () => {
    slotEl.style.borderColor = LC.border;
  });
  slotEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    slotEl.style.borderColor = LC.border;
    const data = _getDragData(e);
    const actor = await _resolveDragToActor(data);
    if (!actor) {
      ui.notifications.warn("STA2e Toolkit: Drop an Actor or a Token.");
      return;
    }
    _assignSlot(root, state, slotEl.dataset.slot, actor.id);
  });
  slotEl.querySelector(".op-slot-clear")?.addEventListener("click", () => {
    _assignSlot(root, state, slotEl.dataset.slot, null);
  });
  slotEl.querySelectorAll(".op-slot-pick").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = await _pickActorBySource(btn.dataset.source);
      if (id) _assignSlot(root, state, slotEl.dataset.slot, id);
    });
  });
}

function _applySnapshot(root, state, snap) {
  state.taskName              = snap.taskName ?? "";
  state.flavor                = snap.flavor ?? "";
  state.kind                  = snap.kind ?? DEFAULT_KIND.key;
  state.defenderSuggestedAttr = snap.defenderSuggestedAttr ?? snap.suggestedAttr ?? "presence";
  state.defenderSuggestedDisc = snap.defenderSuggestedDisc ?? snap.suggestedDisc ?? "command";
  state.attackerSuggestedAttr = snap.attackerSuggestedAttr ?? snap.suggestedAttr ?? "presence";
  state.attackerSuggestedDisc = snap.attackerSuggestedDisc ?? snap.suggestedDisc ?? "command";
  state.defenderActorId       = snap.defenderActorId ?? snap.responderActorId ?? null;
  state.attackerActorId       = snap.attackerActorId ?? snap.initiatorActorId ?? null;
  state.options               = {
    defenderComplicationRange: snap.options?.defenderComplicationRange ?? snap.options?.complicationRange ?? snap.defenderComplicationRange ?? snap.complicationRange ?? 1,
    attackerComplicationRange: snap.options?.attackerComplicationRange ?? snap.options?.complicationRange ?? snap.attackerComplicationRange ?? snap.complicationRange ?? 1,
    ..._normalizeTraitModifier(snap.options ?? snap),
  };
  root.querySelector(".op-task-name").value = state.taskName;
  root.querySelector(".op-flavor").value = state.flavor;
  const defComp = state.options.defenderComplicationRange ?? 1;
  const atkComp = state.options.attackerComplicationRange ?? 1;
  root.querySelector(".op-defender-complication-range").value = String(defComp);
  root.querySelector(".op-defender-complication-range-val").textContent = String(defComp);
  root.querySelector(".op-defender-complication-desc").textContent = defComp <= 1 ? "Complications on: 20" : `Complications on: ${21 - defComp}-20`;
  root.querySelector(".op-attacker-complication-range").value = String(atkComp);
  root.querySelector(".op-attacker-complication-range-val").textContent = String(atkComp);
  root.querySelector(".op-attacker-complication-desc").textContent = atkComp <= 1 ? "Complications on: 20" : `Complications on: ${21 - atkComp}-20`;
  root.querySelector(".op-defender-attr").value = state.defenderSuggestedAttr;
  root.querySelector(".op-defender-disc").value = state.defenderSuggestedDisc;
  root.querySelector(".op-attacker-attr").value = state.attackerSuggestedAttr;
  root.querySelector(".op-attacker-disc").value = state.attackerSuggestedDisc;
  const traitMod = _normalizeTraitModifier(state.options);
  root.querySelector(".op-trait-mode").value = traitMod.traitModifierMode;
  root.querySelector(".op-trait-potency").value = String(traitMod.traitModifierPotency);
  root.querySelector(".op-trait-name").value = traitMod.traitModifierName;
  _assignSlot(root, state, "defender", state.defenderActorId);
  _assignSlot(root, state, "attacker", state.attackerActorId);
}

function _readDialogState(root, state) {
  state.taskName = root.querySelector(".op-task-name")?.value ?? "";
  state.flavor = root.querySelector(".op-flavor")?.value ?? "";
  state.kind = DEFAULT_KIND.key;
  state.defenderSuggestedAttr = root.querySelector(".op-defender-attr")?.value ?? "presence";
  state.defenderSuggestedDisc = root.querySelector(".op-defender-disc")?.value ?? "command";
  state.attackerSuggestedAttr = root.querySelector(".op-attacker-attr")?.value ?? "presence";
  state.attackerSuggestedDisc = root.querySelector(".op-attacker-disc")?.value ?? "command";
  state.options = {
    defenderComplicationRange: Math.max(1, Math.min(5, Number(root.querySelector(".op-defender-complication-range")?.value) || 1)),
    attackerComplicationRange: Math.max(1, Math.min(5, Number(root.querySelector(".op-attacker-complication-range")?.value) || 1)),
    ..._normalizeTraitModifier({
      traitModifierMode: root.querySelector(".op-trait-mode")?.value ?? "none",
      traitModifierPotency: root.querySelector(".op-trait-potency")?.value ?? 1,
      traitModifierName: root.querySelector(".op-trait-name")?.value ?? "",
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry — bypass dialog when opts are fully specified
// ─────────────────────────────────────────────────────────────────────────

/**
 * Post an opposed-task card directly without opening the setup dialog.
 * Macros and external callers can use this.  All fields fall back sensibly.
 */
export async function startOpposedTask(opts = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn("STA2e Toolkit: Only the GM can post an opposed task.");
    return;
  }
  const defId = opts.defenderActorId ?? opts.responderActorId;
  const atkId = opts.attackerActorId ?? opts.initiatorActorId;
  if (!defId || !atkId) {
    openOpposedTaskSetup(opts);
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
      pronePenalty,
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
    : "Cover";
  const defIcon = defenseType === "evasive-action" ? "Evasive"
    : defenseType === "defensive-fire" ? "Defensive"
    : "Cover";
  const defStationId = opts.defenderStationId ?? (defenseType === "defensive-fire" ? "tactical" : "helm");
  const atkStationId = opts.attackerStationId ?? "tactical";
  const defenderSuggestedAttr = opts.defenderSuggestedAttr ?? "daring";
  const defenderSuggestedDisc = opts.defenderSuggestedDisc ?? (defenseType === "defensive-fire" ? "security" : "conn");
  const attackerSuggestedAttr = opts.attackerSuggestedAttr ?? "control";
  const attackerSuggestedDisc = opts.attackerSuggestedDisc ?? "security";
  const traitModifier = opts.traitModifierMode || opts.options?.traitModifierMode
    ? _normalizeTraitModifier(opts.options ?? opts)
    : await _promptTraitModifier({ title: "Starship Opposed Task - Trait in Play", defaultValue: opts.options ?? opts });

  const defenderOfficers = getStationOfficers(defenderActor, defStationId);
  const attackerOfficers = getStationOfficers(attackerActor, atkStationId);
  const defenderOfficer = opts.defenderOfficer ?? (defenderOfficers[0] ? readOfficerStats(defenderOfficers[0]) : null);
  const attackerOfficer = opts.attackerOfficer ?? (attackerOfficers[0] ? readOfficerStats(attackerOfficers[0]) : null);

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
    defender: {
      actorId: defActor.id,
      actorName: defActor.name,
      actorImg: defActor.img ?? "icons/svg/mystery-man.svg",
      suggestedAttr: snapshot.defenderSuggestedAttr ?? snapshot.suggestedAttr ?? "presence",
      suggestedDisc: snapshot.defenderSuggestedDisc ?? snapshot.suggestedDisc ?? "command",
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
    const poolLabel = winnerProfile?.isPlayerOwned ? "Momentum" : "Threat";
    const poolColor = winnerProfile?.isPlayerOwned ? (LC.secondary ?? "#cc88ff") : (LC.primary ?? "#ff9900");
    const poolSuffix = rewardAmount > 0
      ? ` — <span style="color:${poolColor};font-weight:700;">+${rewardAmount} ${poolLabel}</span>`
      : "";

    const verdictHeadline = `<span style="color:${LC.green ?? "#44cc66"};">✓</span> ${winnerName || (passed ? "Attacker" : "Defender")} wins${poolSuffix}`;

    // Breakdown details under the verdict
    const breakdownParts = [];
    if (isGroundCombat || isStarshipCombat) {
      breakdownParts.push(`${d.attacker.successes} succ vs Diff ${target}`);
      if (guardPenalty) breakdownParts.push(`Guard +${guardPenalty}`);
      if (pronePenalty) breakdownParts.push(`Prone +${pronePenalty}`);
      if (difficultyInfo.overridePenalty) breakdownParts.push(`Override +${difficultyInfo.overridePenalty}`);
      if (difficultyInfo.attackPatternPenalty) breakdownParts.push(`Attack Pattern -${difficultyInfo.attackPatternPenalty}`);
      if (difficultyInfo.traitDelta) breakdownParts.push(traitLabel);
      if (d.options?.targetIsProne && passed) breakdownParts.push(`<span style="color:${LC.secondary ?? "#cc88ff"};">+2 Mom on prone target</span>`);
    } else {
      breakdownParts.push(`${d.attacker.successes} succ vs Diff ${target}`);
      if (difficultyInfo.traitDelta) breakdownParts.push(traitLabel);
    }
    const compsTotal = (d.defender.complications ?? 0) + (d.attacker.complications ?? 0);
    if (compsTotal > 0) breakdownParts.push(`<span style="color:${LC.red ?? "#cc4444"};">${compsTotal} Complication${compsTotal === 1 ? "" : "s"}</span>`);

    const breakdownLine = breakdownParts.length
      ? `<div style="margin-top:3px;font-size:10px;color:${textDim};">${breakdownParts.join(" · ")}</div>`
      : "";

    const rewardBlock = (isGroundCombat || isStarshipCombat) ? "" : _renderOpposedPoolReward(d, rewardSide, rewardAmount);

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
        Defender rolls first. Attacker difficulty is defender successes${guardPenalty ? ` + ${guardPenalty} Guard` : ""}${pronePenalty ? ` + ${pronePenalty} Prone` : ""}${difficultyInfo.overridePenalty ? ` + ${difficultyInfo.overridePenalty} Override` : ""}${difficultyInfo.attackPatternPenalty ? ` - ${difficultyInfo.attackPatternPenalty} Attack Pattern` : ""}${traitLabel ? ` ${difficultyInfo.traitDelta > 0 ? "+" : "-"} ${traitLabel}` : ""}.
      </div>`
    : "";

  // Per-side: actor portrait + colored label
  const sideBlock = (label, portraitSrc, name, attrLabel, discLabel, compRangeText, statusHtml, accentColor) => `
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
        </div>
      </div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px dashed ${LC.borderDim};font-size:11px;">${statusHtml}</div>
    </div>`;

  return `
<div class="sta2e-op-card-v2" data-task-id="${d.taskId}" data-theme="${theme}" data-template="${template}"
  style="${themeVars}background:${LC.bg};
    border:1px solid ${primary};border-radius:3px;font-family:${font};color:${LC.text};max-width:640px;overflow:hidden;padding:0;box-shadow:none;">
  <div class="sta2e-op-v2-header"
    style="background:${primary};color:${LC.bg};padding:6px 12px;
      display:flex;justify-content:space-between;align-items:center;
      font-weight:700;letter-spacing:0.16em;text-transform:uppercase;border-radius:0;">
    <span style="font-size:11px;">Opposed Task</span>
    <span style="font-size:10px;opacity:0.9;">${isStarshipCombat ? "Starship Combat" : isGroundCombat ? "Ground Combat" : "Social Contest"}</span>
  </div>

  <div style="padding:8px 12px 4px;">
    <div style="font-size:14px;font-weight:700;color:${primary};letter-spacing:0.02em;">${_esc(d.taskName)}</div>
    ${d.flavor ? `<div style="margin-top:2px;font-size:10px;color:${textDim};font-style:italic;line-height:1.4;">${_esc(d.flavor)}</div>` : ""}
  </div>
  ${opposedNote}

  <div class="sta2e-op-v2-sides"
    style="display:flex;margin:6px 10px 0;border:1px solid ${LC.borderDim};border-radius:2px;background:rgba(0,0,0,0.25);">
    ${sideBlock("Defender", d.defender.actorImg, d.defender.actorName, defAttrLabel, defDiscLabel, defCompRangeText, defLineHtml, primary)}
    <div style="width:1px;background:${LC.borderDim};"></div>
    ${sideBlock("Attacker", d.attacker.actorImg, d.attacker.actorName, atkAttrLabel, atkDiscLabel, atkCompRangeText, atkLineHtml, primary)}
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

  <div class="sta2e-op-v2-footerbar" style="height:3px;background:${primary};"></div>
</div>
  `;
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
  const starshipOfficerActor = starshipOfficer?.id ? game.actors.get(starshipOfficer.id) : null;
  const starshipUsesPlayerPayment = isStarshipCombat && !!(starshipOfficerActor?.hasPlayerOwner || profile.isPlayerOwned);
  const stats = starshipOfficer ?? readOfficerStats(actor);
  const sideData = side === "defender" ? taskData.defender : taskData.attacker;
  const suggestedAttr = sideData?.suggestedAttr ?? taskData.suggestedAttr ?? null;
  const suggestedDisc = sideData?.suggestedDisc ?? taskData.suggestedDisc ?? null;
  const complicationRange = side === "defender"
    ? (taskData.options?.defenderComplicationRange ?? taskData.options?.complicationRange ?? 1)
    : (taskData.options?.attackerComplicationRange ?? taskData.options?.complicationRange ?? 1);
  const hasAttr = stats && Object.keys(stats.attributes ?? {}).includes(suggestedAttr);
  const hasDisc = stats && Object.keys(stats.disciplines ?? {}).includes(suggestedDisc);
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
        defenderSuccesses: side === "attacker" ? (taskData.defender.successes ?? 0) : null,
        playerMode: starshipUsesPlayerPayment,
        usesPlayerPayment: starshipUsesPlayerPayment,
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
      // Count complications across the primary pools (crew + assists + ship)
      const allDice = [
        ...(state?.crewDice ?? rollData?.crewDice ?? []),
        ...(state?.crewAssistDice ?? rollData?.crewAssistDice ?? []),
        ...(state?.namedAssistDice ?? rollData?.namedAssistDice ?? []),
        ...(state?.apAssistDice ?? rollData?.apAssistDice ?? []),
        ...(state?.shipDice ?? rollData?.shipDice ?? []),
      ];
      const complications = reportedComplications ?? allDice.filter(d => d?.complication).length;
      // Serialize a compact dice array for chat-card display
      const dice = allDice.map(x => ({
        value: x?.value ?? null,
        success: !!x?.success,
        crit: !!x?.crit,
        complication: !!x?.complication,
      }));

      if (game.user.isGM) {
        await applyOpposedRollResult({
          messageId: message.id,
          taskId:    taskData.taskId,
          side,
          successes,
          complications,
          dice,
          rollData,
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
          rollData,
          trackerMessageId,
          trackerFloat,
          trackerBanked,
        });
      }
    },
  };

  if (profile.isShip) {
    const launcher = (isStarshipCombat ? starshipUsesPlayerPayment : profile.isPlayerOwned) ? openPlayerRoller : openNpcRoller;
    launcher(actor, token, rollerOpts);
    return;
  }

  openNpcRoller(actor, token, {
    ...rollerOpts,
    playerMode: forcedGroundNpc ? false : profile.isPlayerOwned,
    groundMode: true,
    groundIsNpc: forcedGroundNpc || !profile.isPlayerOwned,
    usesPlayerPayment: forcedGroundNpc ? false : undefined,
    officer: stats ?? undefined,
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
  const fallbackShip = actor?.type === "starship" || actor?.type === "spacecraft2e";
  if (!actor) {
    return { isShip: false, isPlayerOwned: false, npcType: "minor" };
  }

  try {
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

function _renderOpposedPoolReward(taskData, side, amount) {
  if (!amount || amount <= 0) return "";

  const sideData = side === "defender" ? taskData.defender : taskData.attacker;
  const actor = sideData?.actorId ? game.actors.get(sideData.actorId) : null;
  const profile = actor ? _getOpposedActorProfile(actor) : null;
  if (!profile) return "";

  const pool = profile.isPlayerOwned ? "momentum" : "threat";
  const label = pool === "momentum" ? "Momentum" : "Threat";
  const color = pool === "momentum" ? LC.secondary : LC.primary;

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
  const buttonLabel = pool === "momentum"
    ? `+${amount} Momentum to Pool`
    : `+${amount} Threat to Pool`;

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
export async function applyOpposedRollResult({ messageId, taskId, side, successes, complications, dice, rollData = null, trackerMessageId = null, trackerFloat = 0, trackerBanked = 0 }) {
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
        const pool = profile?.isPlayerOwned ? "momentum" : "threat";
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
        const pool = _getOpposedActorProfile(winnerActor)?.isPlayerOwned ? "momentum" : "threat";
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
  await CombatHUD.resolveShipAttack(attackerToken, weapon, isHit, {
    salvoMode: weaponContext.salvoMode ?? "area",
    rapidFireBonus: combat.hasRapidFireTorpedo && weaponContext.isTorpedo ? 1 : 0,
    calibrateWeaponsBonus,
    defenderSuccesses: taskData.defender?.successes ?? null,
    opposedDifficulty: finalDifficulty,
    opposedDefenseType: taskData.options?.defenseType ?? null,
    attackerSuccesses: taskData.attacker?.successes ?? null,
    overrideTargets: [defenderToken],
    floatingMomentum: Number(trackerFloat ?? attackerTracker.float ?? 0),
    trackerMessageId: trackerMessageId ?? attackerTracker.messageId ?? null,
    complications: taskData.attacker?.complications ?? 0,
    opposedMomentumAwarded: !!(trackerMessageId ?? attackerTracker.messageId)
      || Number(trackerFloat ?? attackerTracker.float ?? 0) > 0
      || Number(trackerBanked ?? attackerTracker.banked ?? 0) > 0,
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










