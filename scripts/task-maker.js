/**
 * sta2e-toolkit | task-maker.js
 * GM-authored task request cards that open the existing advanced dice roller.
 */

import { getAssignedShips, normalizeAssignedShips, readOfficerStats } from "./crew-manifest.js";
import { getActiveLcThemeKey, getLcCssVars, getLcThemeTemplate, getLcTokens } from "./lcars-theme.js";
import { decrementTracker } from "./momentum-tracker.js";
import { readTrackerState } from "./momentum-spend.js";
import { openNpcRoller } from "./npc-roller.js";
import { adjustPool, readPool } from "./pool-service.js";
import { getActorTraitRecords, getSceneTraitRecords, traitDescriptionText } from "./trait-service.js";

const MODULE = "sta2e-toolkit";
const EXTENDED_TASK_FOLDER = "Extended Tasks";
const EXTENDED_TASK_FLAG = "extendedTask";
const LAST_SETTINGS_KEY = "taskMakerLastSettings";
const RECENT_EXTENDED_KEY = "taskMakerRecentExtended";
const RECENT_EXTENDED_MAX = 5;

function readLastSettings() {
  try {
    const data = game.settings.get(MODULE, LAST_SETTINGS_KEY);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function readRecentExtended() {
  try {
    const data = game.settings.get(MODULE, RECENT_EXTENDED_KEY);
    return Array.isArray(data) ? data.filter(e => e && typeof e === "object") : [];
  } catch {
    return [];
  }
}

// Keep up to five recent extended-task setups, newest first, deduped by the
// extended task's actor so several concurrent tasks can each be reused.
async function saveRecentExtended(payload) {
  if (payload?.mode !== "extended") return;
  const actorId = payload?.extendedTask?.actorId;
  if (!actorId) return;
  const list = readRecentExtended().filter(e => e?.extendedTask?.actorId !== actorId);
  list.unshift(payload);
  try {
    await game.settings.set(MODULE, RECENT_EXTENDED_KEY, list.slice(0, RECENT_EXTENDED_MAX));
  } catch (err) {
    console.warn("STA2e Toolkit | could not save recent extended tasks:", err);
  }
}

// Human label for a stored setup, used in the reuse picker.
function reuseEntryLabel(entry = {}) {
  const taskName = String(entry.taskName ?? "").trim();
  if (entry.mode === "extended") {
    const extName = entry.extendedTask?.actorId
      ? (game.actors.get(entry.extendedTask.actorId)?.name ?? null)
      : null;
    return [taskName || "Extended Task", extName].filter(Boolean).join(" - ");
  }
  const actorName = entry.actorId ? (game.actors.get(entry.actorId)?.name ?? null) : null;
  return [taskName || "Task", actorName].filter(Boolean).join(" - ");
}

async function saveLastSettings(state) {
  const ext = state.extendedTask ?? {};
  const payload = {
    mode: state.mode === "extended" ? "extended" : "task",
    taskName: state.taskName ?? "",
    actorId: state.actorId ?? null,
    tokenId: state.tokenId ?? null,
    traits: Array.isArray(state.traits) ? state.traits : [],
    attrKey: state.attrKey,
    discKey: state.discKey,
    difficulty: state.difficulty,
    complicationRange: state.complicationRange,
    shipAssist: !!state.shipAssist,
    shipActorId: state.shipActorId ?? null,
    shipSystemKey: state.shipSystemKey ?? null,
    shipDeptKey: state.shipDeptKey ?? null,
    extendedTask: {
      actorId: ext.actorId ?? null,
      workMax: ext.workMax,
      breakthroughMax: ext.breakthroughMax,
      difficulty: ext.difficulty,
      resistance: ext.resistance,
      magnitude: ext.magnitude,
      intervals: ext.intervals ?? {},
    },
  };
  try {
    await game.settings.set(MODULE, LAST_SETTINGS_KEY, payload);
  } catch (err) {
    console.warn("STA2e Toolkit | could not save Task Maker settings:", err);
  }
  await saveRecentExtended(payload);
}

// Full reuse, including the last actor, ship, and extended-task actor. Used by the Reuse button.
function lastSettingsAsPrefill(last = {}) {
  const ext = last.extendedTask ?? {};
  return {
    mode: last.mode,
    taskName: last.taskName ?? "",
    actorId: last.actorId ?? null,
    tokenId: last.tokenId ?? null,
    traits: Array.isArray(last.traits) ? last.traits : [],
    attrKey: last.attrKey,
    discKey: last.discKey,
    difficulty: last.difficulty,
    complicationRange: last.complicationRange,
    shipAssist: last.shipAssist,
    shipActorId: last.shipActorId ?? null,
    shipSystemKey: last.shipSystemKey ?? null,
    shipDeptKey: last.shipDeptKey ?? null,
    extendedTask: {
      extendedTaskActorId: ext.actorId ?? null,
      workMax: ext.workMax,
      breakthroughMax: ext.breakthroughMax,
      difficulty: ext.difficulty,
      resistance: ext.resistance,
      magnitude: ext.magnitude,
      intervals: ext.intervals ?? {},
    },
  };
}


const LC = new Proxy({}, {
  get(_, prop) { return getLcTokens()[prop]; },
});

const ATTR_OPTIONS = [
  { key: "control", label: "Control" },
  { key: "daring", label: "Daring" },
  { key: "fitness", label: "Fitness" },
  { key: "insight", label: "Insight" },
  { key: "presence", label: "Presence" },
  { key: "reason", label: "Reason" },
];

const DISC_OPTIONS = [
  { key: "command", label: "Command" },
  { key: "conn", label: "Conn" },
  { key: "engineering", label: "Engineering" },
  { key: "medicine", label: "Medicine" },
  { key: "science", label: "Science" },
  { key: "security", label: "Security" },
];

const EXTENDED_SITUATIONAL_TALENTS = [
  {
    key: "bargain",
    name: "Bargain",
    text: "Social conflict offer applies: +1 Impact.",
  },
  {
    key: "labRat",
    name: "Lab Rat",
    text: "Using a laboratory: +1 Impact.",
  },
  {
    key: "surgerySavant",
    name: "Surgery Savant",
    text: "Surgery-related Medicine task: +1 Impact.",
  },
];

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clampInt(value, min, max, fallback = min) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampLargeInt(value, min = 0, fallback = min) {
  return clampInt(value, min, 999999, fallback);
}

function attrLabel(key) {
  return ATTR_OPTIONS.find(o => o.key === key)?.label ?? key ?? "";
}

function discLabel(key) {
  return DISC_OPTIONS.find(o => o.key === key)?.label ?? key ?? "";
}

function normalizeTalentName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

function actorHasTalent(actor, talentName) {
  const target = normalizeTalentName(talentName);
  return actor?.items?.some(item => normalizeTalentName(item.name) === target) ?? false;
}

function ownedExtendedSituationalTalents(actor) {
  return EXTENDED_SITUATIONAL_TALENTS.filter(t => actorHasTalent(actor, t.name));
}

function isTaskActor(actor) {
  return !!(actor?.system?.attributes || actor?.system?.disciplines);
}

function isShipActor(actor) {
  return actor?.type === "starship" || actor?.type === "smallcraft" || actor?.type === "spacecraft2e" || actor?.system?.systems !== undefined;
}

function isExtendedTaskActor(actor) {
  return actor?.type === "extendedtask"
    || !!(actor?.system?.workprogress && actor?.system?.breakthroughs);
}

function worldShips() {
  return game.actors
    .filter(isShipActor)
    .map(actor => ({ label: actor.name, actorId: actor.id, shipActor: actor }));
}

function worldExtendedTasks() {
  return game.actors
    .filter(isExtendedTaskActor)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function orderedShipsForActor(actor, preferredShipId = null) {
  const all = worldShips();
  const byId = new Map(all.map(s => [s.actorId, s]));
  const assigned = normalizeAssignedShips(getAssignedShips(actor));
  // Only offer ships assigned to this character. If none are assigned, fall back to all ships.
  if (!assigned.length) return all;
  const assignedSet = new Set(assigned);
  const order = [preferredShipId, ...assigned].filter(id => id && assignedSet.has(id));
  const seen = new Set();
  const ordered = [];
  for (const id of order) {
    const ship = byId.get(id);
    if (ship && !seen.has(ship.actorId)) {
      seen.add(ship.actorId);
      ordered.push(ship);
    }
  }
  return ordered;
}

function serializeShipsForRoller(shipRefs) {
  return shipRefs.map(s => ({
    label: s.label,
    actorId: s.actorId,
    systems: s.shipActor.system?.systems ?? {},
    depts: s.shipActor.system?.departments ?? {},
    hasAdvancedSensors: s.shipActor.items?.some(i =>
      i.name.toLowerCase().includes("advanced sensor suites") ||
      i.name.toLowerCase().includes("advanced sensors")
    ) ?? false,
    sensorsBreaches: s.shipActor.system?.systems?.sensors?.breaches ?? 0,
  }));
}

function effectText(effect, quantity = 1) {
  const label = effect?.label || effect?.type || "note";
  if (effect?.type === "difficulty") return `${label}: Difficulty ${effect.difficultyDirection === "reduce" ? "-" : "+"}${quantity}`;
  if (effect?.type === "complicationRange") return `${label}: Complication Range ${effect.complicationDirection === "reduce" ? "-" : "+"}${quantity}`;
  if (["bonusMomentum", "bonusThreat"].includes(effect?.type)) return `${label}: +${quantity}`;
  if (effect?.type === "reroll") return `${label}: reroll`;
  return label;
}

function traitToTaskRecord(trait) {
  if (!trait) return null;
  const effects = (trait.automation?.effects ?? []).map(effect => ({
    id: effect.id,
    type: effect.type,
    label: effect.label,
    value: effect.value,
    difficultyDirection: effect.difficultyDirection === "reduce" ? "reduce" : "increase",
    complicationDirection: effect.complicationDirection === "reduce" ? "reduce" : "increase",
  }));
  return {
    scope: trait.scope,
    id: trait.itemId ?? trait.id,
    actorId: trait.actorId ?? null,
    actorUuid: trait.actorUuid ?? null,
    sceneId: trait.sceneId ?? null,
    name: trait.name ?? "Trait",
    img: trait.img ?? "systems/sta/assets/icons/VoyagerCombadgeIcon.png",
    description: traitDescriptionText(trait),
    quantity: Math.max(1, Number(trait.quantity ?? 1) || 1),
    configured: !!trait.configured,
    effects,
  };
}

function resolveTaskTrait(ref) {
  if (!ref) return null;
  const scope = ref.scope ?? "";
  const traitId = ref.traitId ?? ref.id ?? ref.itemId ?? "";
  if (scope === "scene") {
    return getSceneTraitRecords(canvas?.scene).find(t => String(t.id) === String(traitId)) ?? null;
  }
  const actor = ref.actorId ? game.actors.get(ref.actorId) : null;
  return getActorTraitRecords(actor).find(t => String(t.itemId ?? t.id) === String(traitId)) ?? null;
}

function selectedTraitIdsForRoller(traits = []) {
  const ids = [];
  for (const trait of traits) {
    const traitId = trait.id ?? trait.itemId ?? trait.traitId;
    for (const effect of trait.effects ?? []) {
      if (!["difficulty", "complicationRange"].includes(effect.type)) continue;
      ids.push(`${trait.scope}:${traitId}:${effect.id}`);
    }
  }
  return ids;
}

function traitDifficultyDirectionsForRoller(traits = []) {
  const directions = {};
  for (const trait of traits) {
    const traitId = trait.id ?? trait.itemId ?? trait.traitId;
    for (const effect of trait.effects ?? []) {
      if (effect.type !== "difficulty") continue;
      directions[`${trait.scope}:${traitId}:${effect.id}`] = effect.difficultyDirection === "reduce" ? "reduce" : "increase";
    }
  }
  return directions;
}

function defaultState(prefill = {}) {
  const selected = canvas.tokens?.controlled?.[0] ?? null;
  const actor = prefill.actorId ? game.actors.get(prefill.actorId) : selected?.actor;
  const tokenId = prefill.tokenId ?? (selected && actor && selected.actor?.id === actor.id ? selected.id : null);
  const ships = actor ? orderedShipsForActor(actor, prefill.shipActorId) : worldShips();
  const firstShip = ships[0]?.shipActor ?? null;
  const defaultSystem = prefill.shipSystemKey
    ?? (firstShip?.system?.systems?.computers ? "computers" : Object.keys(firstShip?.system?.systems ?? {})[0] ?? "");
  const defaultDept = prefill.shipDeptKey
    ?? (firstShip?.system?.departments?.command ? "command" : Object.keys(firstShip?.system?.departments ?? {})[0] ?? "");
  return {
    taskName: prefill.taskName ?? "",
    flavor: prefill.flavor ?? "",
    actorId: actor?.id ?? null,
    tokenId,
    attrKey: prefill.attrKey ?? "presence",
    discKey: prefill.discKey ?? "command",
    difficulty: clampInt(prefill.difficulty, 0, 99, 1),
    complicationRange: clampInt(prefill.complicationRange, 1, 5, 1),
    shipAssist: !!prefill.shipAssist,
    shipActorId: prefill.shipActorId ?? ships[0]?.actorId ?? null,
    shipSystemKey: defaultSystem,
    shipDeptKey: defaultDept,
    traits: Array.isArray(prefill.traits) ? prefill.traits : [],
    mode: prefill.mode === "extended" ? "extended" : "task",
    extendedTask: defaultExtendedConfig(prefill.extendedTask ?? prefill),
  };
}

export function openTaskMakerSetup(prefill = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn("STA2e Toolkit: Only the GM can open Task Maker.");
    return;
  }
  const state = defaultState(prefill);
  const dialog = new foundry.applications.api.DialogV2({
    window: { title: "STA 2e - Task Maker", resizable: true },
    position: { width: 760 },
    content: buildDialogHtml(state),
    buttons: [
      { action: "cancel", label: "Cancel" },
      {
        action: "post",
        label: "Post Card",
        icon: "fas fa-paper-plane",
        default: true,
        callback: async (_event, _button, dlg) => {
          readDialogState(dlg.element, state);
          if (!state.actorId) {
            ui.notifications.warn("STA2e Toolkit: Assign a character for this task.");
            return false;
          }
          if (!state.taskName.trim()) state.taskName = "Task";
          await postTaskRequestCard(state);
          await saveLastSettings(state);
        },
      },
    ],
    rejectClose: false,
  });
  dialog.render({ force: true }).then(() => wireDialog(dialog.element, state));
}

function buildDialogHtml(state) {
  const theme = getActiveLcThemeKey();
  const template = getLcThemeTemplate(theme);
  const themeVars = getLcCssVars("tmk");
  const actor = state.actorId ? game.actors.get(state.actorId) : null;
  if (state.extendedTask?.actorId) {
    const extendedActor = game.actors.get(state.extendedTask.actorId);
    if (extendedActor) state.extendedTask = extendedConfigFromActor(extendedActor, state.extendedTask);
  }
  const ships = actor ? orderedShipsForActor(actor, state.shipActorId) : worldShips();
  const selectedShip = ships.find(s => s.actorId === state.shipActorId)?.shipActor ?? ships[0]?.shipActor ?? null;
  const attrOpts = ATTR_OPTIONS.map(a => `<option value="${a.key}" ${a.key === state.attrKey ? "selected" : ""}>${a.label}</option>`).join("");
  const discOpts = DISC_OPTIONS.map(d => `<option value="${d.key}" ${d.key === state.discKey ? "selected" : ""}>${d.label}</option>`).join("");
  const shipOpts = ships.map(s => `<option value="${s.actorId}" ${s.actorId === state.shipActorId ? "selected" : ""}>${esc(s.label)}</option>`).join("");
  const reuseChoices = reuseOptions();
  const reuseLabel = reuseChoices.length > 1 ? "Reuse Task..." : `Reuse ${esc(reuseEntryLabel(reuseChoices[0] ?? {}))}`;
  const reuseButton = reuseChoices.length
    ? `<button type="button" class="tmk-reuse-last" title="Restore a recent posted task setup, including the character"
        style="margin-top:8px;align-self:flex-start;background:${LC.bg};color:${LC.text};border:1px solid ${LC.tertiary};
        padding:5px 10px;border-radius:999px;font-family:${LC.font};font-size:9px;font-weight:700;letter-spacing:0.08em;
        text-transform:uppercase;cursor:pointer;">${reuseLabel}</button>`
    : "";

  return `
    <div class="sta2e-task-maker" data-theme="${theme}" data-template="${template}" style="
      ${themeVars}
      display:flex;flex-direction:column;gap:10px;font-family:${LC.font};color:${LC.text};
      background:${LC.bg};padding:10px;border:1px solid ${LC.border};border-left:8px solid ${LC.primary};
      border-radius:18px 4px 18px 4px;max-height:72vh;overflow-y:auto;">
      <div style="display:grid;grid-template-columns:92px 1fr;gap:10px;align-items:stretch;">
        <div style="background:${LC.primary};border-radius:18px 4px 4px 18px;min-height:76px;"></div>
        <div style="background:${LC.panel};border:1px solid ${LC.border};border-radius:4px 18px 18px 4px;padding:10px 12px;display:flex;flex-direction:column;">
          <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${LC.primary};font-weight:700;">Task Maker</div>
          <div style="font-size:11px;line-height:1.5;color:${LC.textDim};margin-top:4px;">Build a player-facing task card that opens the advanced roller with these defaults.</div>
          ${reuseButton}
        </div>
      </div>

      <label style="display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${LC.textDim};">
        Task Name
        <input class="tmk-task-name" type="text" value="${esc(state.taskName)}" style="${inputStyle()}"/>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${LC.textDim};">
        Notes
        <input class="tmk-flavor" type="text" value="${esc(state.flavor)}" style="${inputStyle()}"/>
      </label>

      ${taskModeToggleHtml(state)}

      ${actorSlotHtml(actor, state)}

      <div class="tmk-params-grid" style="display:grid;grid-template-columns:${state.mode === "extended" ? "1fr 1fr 1fr" : "1fr 1fr 100px 1fr"};gap:8px;">
        <label style="${labelStyle()}">Attribute<select class="tmk-attr" style="${selectStyle()}">${attrOpts}</select></label>
        <label style="${labelStyle()}">Department<select class="tmk-disc" style="${selectStyle()}">${discOpts}</select></label>
        <label class="tmk-difficulty-cell" style="${labelStyle()}${state.mode === "extended" ? "display:none;" : ""}">Difficulty<input class="tmk-difficulty" type="number" min="0" max="99" value="${state.difficulty}" style="${inputStyle("text-align:center;font-weight:700;color:" + LC.tertiary + ";")}"/></label>
        <label style="${labelStyle()}">Complication Range
          <div style="display:flex;gap:8px;align-items:center;background:${LC.panel};border:1px solid ${LC.border};border-radius:12px 3px 12px 3px;padding:6px 8px;">
            <input class="tmk-complication" type="range" min="1" max="5" value="${state.complicationRange}" style="flex:1;accent-color:${LC.primary};"/>
            <span class="tmk-complication-val" style="min-width:14px;text-align:right;color:${LC.primary};font-weight:700;">${state.complicationRange}</span>
          </div>
        </label>
      </div>

      <div class="tmk-ship-panel" style="border:1px solid ${LC.border};background:${LC.panel};padding:8px;border-radius:16px 3px 16px 3px;">
        <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:${LC.text};">
          <input type="checkbox" class="tmk-ship-assist" ${state.shipAssist ? "checked" : ""} style="accent-color:${LC.primary};"/>
          Ship assists this task
        </label>
        <div class="tmk-ship-fields" style="display:${state.shipAssist ? "grid" : "none"};grid-template-columns:1.4fr 1fr 1fr;gap:8px;margin-top:8px;">
          <label style="${labelStyle()}">Ship<select class="tmk-ship" style="${selectStyle()}">${shipOpts || `<option value="">No ships found</option>`}</select></label>
          <label style="${labelStyle()}">System<select class="tmk-ship-system" style="${selectStyle()}">${shipSystemOptions(selectedShip, state.shipSystemKey)}</select></label>
          <label style="${labelStyle()}">Department<select class="tmk-ship-dept" style="${selectStyle()}">${shipDeptOptions(selectedShip, state.shipDeptKey)}</select></label>
        </div>
      </div>

      ${traitPanelHtml(state)}
      ${extendedTaskPanelHtml(state)}
    </div>
  `;
}

function taskModeToggleHtml(state) {
  const normalActive = state.mode !== "extended";
  const extendedActive = state.mode === "extended";
  const option = (mode, label, active, color) => `
    <button type="button" class="tmk-mode-toggle" data-mode="${mode}"
      style="flex:1;padding:7px 10px;background:${active ? color : LC.bg};color:${active ? LC.bg : LC.text};
      border:1px solid ${color};border-radius:10px 3px 10px 3px;font-family:${LC.font};font-size:10px;
      font-weight:700;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;">
      ${label}
    </button>`;
  return `
    <div class="tmk-mode-panel" style="display:flex;gap:6px;border:1px solid ${LC.border};background:${LC.panel};padding:6px;border-radius:16px 3px 16px 3px;">
      ${option("task", "Normal Task", normalActive, LC.primary)}
      ${option("extended", "Extended Task", extendedActive, LC.secondary)}
    </div>`;
}

function inputStyle(extra = "") {
  return `width:100%;background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};padding:8px 10px;border-radius:12px 3px 12px 3px;font-family:${LC.font};font-size:12px;${extra}`;
}

function selectStyle() {
  return `background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};padding:8px 10px;border-radius:12px 3px 12px 3px;font-family:${LC.font};`;
}

function labelStyle() {
  return `display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${LC.textDim};`;
}

function actorSlotHtml(actor, state) {
  return `
    <div class="tmk-actor-slot" data-actor-id="${state.actorId ?? ""}" data-token-id="${state.tokenId ?? ""}"
      style="border:1px solid ${LC.border};background:${LC.panel};padding:8px;border-radius:16px 3px 16px 3px;min-height:96px;">
      <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${LC.primary};margin-bottom:6px;font-weight:700;">Character</div>
      <div class="tmk-actor-body">
        ${actor ? `
          <div style="display:flex;gap:8px;align-items:center;">
            <img src="${esc(actor.img ?? "icons/svg/mystery-man.svg")}" style="width:34px;height:34px;border:1px solid ${LC.border};border-radius:8px 2px 8px 2px;object-fit:cover;"/>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(actor.name)}</div>
              <div style="font-size:10px;color:${LC.textDim};">Drop a token or actor to replace</div>
            </div>
            <button type="button" class="tmk-actor-clear" title="Clear" style="background:transparent;border:none;color:${LC.textDim};cursor:pointer;font-size:14px;">X</button>
          </div>` : `
          <div style="color:${LC.textDim};font-size:11px;line-height:1.5;padding:8px 2px 4px;">Drag an actor or token here</div>`}
      </div>
      <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap;">
        <button type="button" class="tmk-actor-pick" data-source="controlled" style="${pillStyle(LC.primary)}">Controlled</button>
        <button type="button" class="tmk-actor-pick" data-source="targeted" style="${pillStyle(LC.secondary)}">Targeted</button>
        <button type="button" class="tmk-actor-pick" data-source="list" style="${pillStyle(LC.tertiary)}">List...</button>
      </div>
    </div>`;
}

function pillStyle(color) {
  return `flex:1;background:${LC.bg};color:${LC.text};border:1px solid ${LC.border};padding:4px 6px;border-radius:999px;font-size:9px;cursor:pointer;letter-spacing:0.06em;text-transform:uppercase;--tmk-button-accent:${color};`;
}

function shipSystemOptions(ship, selectedKey) {
  const entries = Object.entries(ship?.system?.systems ?? {});
  return entries.map(([key, value]) => `<option value="${esc(key)}" ${key === selectedKey ? "selected" : ""}>${esc(labelFromKey(key))} (${Number(value?.value ?? value ?? 0)})</option>`).join("");
}

function shipDeptOptions(ship, selectedKey) {
  const entries = Object.entries(ship?.system?.departments ?? {});
  return entries.map(([key, value]) => `<option value="${esc(key)}" ${key === selectedKey ? "selected" : ""}>${esc(labelFromKey(key))} (${Number(value?.value ?? value ?? 0)})</option>`).join("");
}

function labelFromKey(key) {
  return String(key ?? "").replace(/[-_]+/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
}

function defaultBreakpoints(workMax = 12, count = 3) {
  const max = Math.max(1, clampInt(workMax, 1, 999, 12));
  const total = Math.max(0, clampInt(count, 0, 9, 3));
  if (total <= 0) return [];
  if (total === 1) return [max];
  if (total === 2) return [Math.ceil(max * 0.5), max];
  const points = [Math.ceil(max * 0.5), Math.ceil(max * 0.75)];
  for (let i = 2; i < total - 1; i++) {
    const span = (i - 1) / Math.max(1, total - 2);
    points.push(Math.ceil(max * (0.75 + (0.25 * span))));
  }
  points.push(max);
  return points.map(v => Math.max(1, Math.min(max, v)));
}

function defaultBreakthroughEffects(workMax = 12, count = 3, existing = []) {
  const points = defaultBreakpoints(workMax, count);
  return points.map((threshold, i) => {
    const old = existing[i] ?? {};
    return {
      threshold: clampInt(old.threshold, 1, Math.max(1, workMax), threshold),
      difficultyDelta: clampInt(old.difficultyDelta, -1, 1, 0),
      resistanceDelta: clampInt(old.resistanceDelta, -1, 1, 0),
      nextImpactBonus: clampInt(old.nextImpactBonus, 0, 9, 0),
      note: String(old.note ?? ""),
    };
  });
}

function normalizeIntervalsConfig(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const mode = raw.mode === "variable" ? "variable" : "timed";
  const startFallback = raw.start ?? raw.remaining ?? 0;
  let start = clampLargeInt(startFallback, 0, 0);
  let ending = clampLargeInt(raw.ending, 0, mode === "variable" ? start : 0);
  let remaining = clampLargeInt(raw.remaining, start, start);

  // Legacy timed intervals counted down from start to 0. New timed intervals
  // count up from 0/current toward Ending, but keep the stored field name.
  if (mode === "timed" && start > 0 && ending === 0 && raw.remaining != null) {
    const oldTotal = start;
    const oldRemaining = clampLargeInt(raw.remaining, 0, oldTotal);
    start = 0;
    remaining = Math.max(0, oldTotal - oldRemaining);
    ending = oldTotal;
  }

  return {
    enabled: !!raw.enabled,
    mode,
    remaining,
    start,
    ending,
    timedCost: clampInt(raw.timedCost, 1, 999, 2),
  };
}

function intervalModeLabel(mode) {
  return mode === "variable" ? "Variable/Delay" : "Timed Challenge";
}

function extendedTaskFlagPayload(actor, updates = {}) {
  const current = actor?.getFlag?.(MODULE, EXTENDED_TASK_FLAG) ?? {};
  return {
    breakpoints: updates.breakpoints ?? current.breakpoints ?? [],
    nextImpactBonus: clampInt(updates.nextImpactBonus ?? current.nextImpactBonus, 0, 99, 0),
    intervals: normalizeIntervalsConfig(updates.intervals ?? current.intervals ?? {}),
  };
}

function extendedConfigFromActor(actor, fallback = {}) {
  const system = actor?.system ?? {};
  const workMax = clampInt(system.workprogress?.max, 1, 999, fallback.workMax ?? 12);
  const breakthroughMax = clampInt(system.breakthroughs?.max, 0, 9, fallback.breakthroughMax ?? 3);
  const flag = actor?.getFlag?.(MODULE, EXTENDED_TASK_FLAG) ?? {};
  return {
    actorId: actor?.id ?? fallback.actorId ?? null,
    name: actor?.name ?? fallback.name ?? "Extended Task",
    workMax,
    difficulty: clampInt(system.difficulty, 0, 99, fallback.difficulty ?? 1),
    resistance: clampInt(system.resistance, 0, 99, fallback.resistance ?? 0),
    magnitude: clampInt(system.magnitude, 0, 99, fallback.magnitude ?? 1),
    breakthroughMax,
    breakpoints: defaultBreakthroughEffects(workMax, breakthroughMax, flag.breakpoints ?? fallback.breakpoints ?? []),
    nextImpactBonus: clampInt(flag.nextImpactBonus, 0, 99, fallback.nextImpactBonus ?? 0),
    intervals: normalizeIntervalsConfig(flag.intervals ?? fallback.intervals ?? {}),
    talentOptions: {
      bargain: !!fallback.talentOptions?.bargain,
      labRat: !!fallback.talentOptions?.labRat,
      surgerySavant: !!fallback.talentOptions?.surgerySavant,
    },
  };
}

function defaultExtendedConfig(prefill = {}) {
  const workMax = clampInt(prefill.extendedWorkMax, 1, 999, prefill.workMax ?? 12);
  const breakthroughMax = clampInt(prefill.extendedBreakthroughMax, 0, 9, prefill.breakthroughMax ?? 3);
  return {
    actorId: prefill.extendedTaskActorId ?? null,
    name: prefill.extendedTaskName ?? prefill.name ?? "Extended Task",
    workMax,
    difficulty: clampInt(prefill.extendedDifficulty ?? prefill.difficulty, 0, 99, 1),
    resistance: clampInt(prefill.extendedResistance ?? prefill.resistance, 0, 99, 0),
    magnitude: clampInt(prefill.extendedMagnitude ?? prefill.magnitude, 0, 99, 1),
    breakthroughMax,
    breakpoints: defaultBreakthroughEffects(workMax, breakthroughMax, prefill.breakpoints ?? []),
    nextImpactBonus: clampInt(prefill.nextImpactBonus, 0, 99, 0),
    intervals: normalizeIntervalsConfig(prefill.intervals ?? {}),
    talentOptions: {
      bargain: !!prefill.talentOptions?.bargain,
      labRat: !!prefill.talentOptions?.labRat,
      surgerySavant: !!prefill.talentOptions?.surgerySavant,
    },
  };
}

function extendedProgressSnapshot(actor, config = null) {
  if (!actor) return null;
  const cfg = config ?? extendedConfigFromActor(actor);
  const workValue = clampInt(actor.system?.workprogress?.value, 0, 999, 0);
  const workMax = clampInt(actor.system?.workprogress?.max, 1, 999, cfg.workMax);
  const breakthroughsValue = clampInt(actor.system?.breakthroughs?.value, 0, 99, 0);
  const breakthroughsMax = clampInt(actor.system?.breakthroughs?.max, 0, 99, cfg.breakthroughMax);
  return {
    actorId: actor.id,
    actorName: actor.name,
    actorImg: actor.img ?? "icons/svg/mystery-man.svg",
    workValue,
    workMax,
    difficulty: clampInt(actor.system?.difficulty, 0, 99, cfg.difficulty),
    resistance: clampInt(actor.system?.resistance, 0, 99, cfg.resistance),
    magnitude: clampInt(actor.system?.magnitude, 0, 99, cfg.magnitude),
    breakthroughsValue,
    breakthroughsMax,
    breakpoints: defaultBreakthroughEffects(workMax, breakthroughsMax, cfg.breakpoints),
    nextImpactBonus: clampInt(cfg.nextImpactBonus, 0, 99, 0),
    intervals: normalizeIntervalsConfig(cfg.intervals ?? {}),
  };
}

async function getOrCreateExtendedTaskFolder() {
  let folder = game.folders.find(f => f.type === "Actor" && f.name === EXTENDED_TASK_FOLDER) ?? null;
  if (!folder) folder = await Folder.create({ name: EXTENDED_TASK_FOLDER, type: "Actor" });
  return folder;
}

async function ensureExtendedTaskActor(config) {
  const existing = config.actorId ? game.actors.get(config.actorId) : null;
  const folder = existing ? null : await getOrCreateExtendedTaskFolder();
  const systemUpdate = {
    "system.magnitude": clampInt(config.magnitude, 0, 99, 1),
    "system.difficulty": clampInt(config.difficulty, 0, 99, 1),
    "system.resistance": clampInt(config.resistance, 0, 99, 0),
    "system.workprogress.max": clampInt(config.workMax, 1, 999, 12),
    "system.breakthroughs.max": clampInt(config.breakthroughMax, 0, 9, 3),
  };

  if (existing) {
    const update = {
      name: String(config.name ?? existing.name ?? "Extended Task").trim() || existing.name,
      ...systemUpdate,
    };
    await existing.update(update);
    await existing.setFlag(MODULE, EXTENDED_TASK_FLAG, {
      breakpoints: defaultBreakthroughEffects(config.workMax, config.breakthroughMax, config.breakpoints),
      nextImpactBonus: clampInt(config.nextImpactBonus, 0, 99, 0),
      intervals: normalizeIntervalsConfig(config.intervals ?? {}),
    });
    return existing;
  }

  const actor = await Actor.create({
    name: String(config.name ?? "Extended Task").trim() || "Extended Task",
    type: "extendedtask",
    img: "icons/svg/mystery-man.svg",
    folder: folder?.id ?? null,
    ownership: { default: 0 },
    system: {
      magnitude: clampInt(config.magnitude, 0, 99, 1),
      difficulty: clampInt(config.difficulty, 0, 99, 1),
      resistance: clampInt(config.resistance, 0, 99, 0),
      description: "",
      breakthroughs: {
        value: 0,
        max: clampInt(config.breakthroughMax, 0, 9, 3),
      },
      workprogress: {
        value: 0,
        max: clampInt(config.workMax, 1, 999, 12),
      },
    },
  });
  await actor.setFlag(MODULE, EXTENDED_TASK_FLAG, {
    breakpoints: defaultBreakthroughEffects(config.workMax, config.breakthroughMax, config.breakpoints),
    nextImpactBonus: clampInt(config.nextImpactBonus, 0, 99, 0),
    intervals: normalizeIntervalsConfig(config.intervals ?? {}),
  });
  return actor;
}

function traitPanelHtml(state) {
  return `
    <div class="tmk-trait-panel" style="border:1px solid ${LC.border};background:${LC.panel};padding:8px;border-radius:16px 3px 16px 3px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${LC.primary};font-weight:700;">Traits</div>
        <button type="button" class="tmk-add-scene-trait" style="${pillStyle(LC.secondary)};flex:0 0 auto;">Scene Trait...</button>
      </div>
      <div class="tmk-trait-drop" style="border:1px dashed ${LC.borderDim};padding:8px;border-radius:10px 3px 10px 3px;color:${LC.textDim};font-size:11px;">Drop traits here from Trait Manager</div>
      <div class="tmk-trait-list" style="display:flex;flex-direction:column;gap:4px;margin-top:8px;">${state.traits.map(traitRowHtml).join("")}</div>
    </div>`;
}

function traitRowHtml(trait) {
  const details = (trait.effects ?? [])
    .filter(e => ["difficulty", "complicationRange"].includes(e.type))
    .map(e => effectText(e, trait.quantity))
    .join(" / ") || "Context only";
  return `
    <div class="tmk-trait-row" data-scope="${esc(trait.scope)}" data-trait-id="${esc(trait.id)}" data-actor-id="${esc(trait.actorId ?? "")}"
      style="display:flex;gap:6px;align-items:center;padding:5px 6px;border:1px solid ${LC.borderDim};background:${LC.bg};border-radius:8px 2px 8px 2px;">
      <img src="${esc(trait.img)}" style="width:24px;height:24px;object-fit:cover;border:1px solid ${LC.border};"/>
      <div style="flex:1;min-width:0;">
        <div style="font-size:11px;font-weight:700;color:${LC.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(trait.name)}</div>
        <div style="font-size:9px;color:${LC.textDim};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(details)}</div>
      </div>
      <button type="button" class="tmk-trait-remove" title="Remove trait" style="background:transparent;border:none;color:${LC.red ?? "#cc4444"};cursor:pointer;">X</button>
    </div>`;
}

function extendedTaskPanelHtml(state) {
  const cfg = state.extendedTask ?? defaultExtendedConfig();
  const actor = cfg.actorId ? game.actors.get(cfg.actorId) : null;
  const taskActor = state.actorId ? game.actors.get(state.actorId) : null;
  const progress = actor ? extendedProgressSnapshot(actor, cfg) : null;
  const visible = state.mode === "extended";
  const breakRows = defaultBreakthroughEffects(cfg.workMax, cfg.breakthroughMax, cfg.breakpoints)
    .map((bp, i) => breakthroughConfigRowHtml(bp, i, cfg.workMax))
    .join("");
  return `
    <div class="tmk-extended-panel" style="display:${visible ? "flex" : "none"};flex-direction:column;gap:8px;border:1px solid ${LC.secondary};background:${LC.panel};padding:8px;border-radius:16px 3px 16px 3px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${LC.secondary};font-weight:700;">Extended Task</div>
        <button type="button" class="tmk-extended-pick" style="${pillStyle(LC.secondary)};flex:0 0 auto;">Pick Existing...</button>
      </div>
      <div class="tmk-extended-slot" data-actor-id="${esc(cfg.actorId ?? "")}"
        style="border:1px dashed ${LC.borderDim};background:${LC.bg};padding:8px;border-radius:10px 3px 10px 3px;min-height:54px;">
        ${actor ? `
          <div style="display:flex;gap:8px;align-items:center;">
            <img src="${esc(actor.img ?? "icons/svg/mystery-man.svg")}" style="width:34px;height:34px;border:1px solid ${LC.secondary};object-fit:cover;"/>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:12px;color:${LC.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(actor.name)}</div>
              <div style="font-size:10px;color:${LC.textDim};">Progress ${progress?.workValue ?? 0}/${progress?.workMax ?? cfg.workMax} - Difficulty ${progress?.difficulty ?? cfg.difficulty} - Resistance ${progress?.resistance ?? cfg.resistance}</div>
            </div>
            <button type="button" class="tmk-extended-clear" title="Create new instead" style="background:transparent;border:none;color:${LC.textDim};cursor:pointer;font-size:14px;">X</button>
          </div>` : `
          <div style="font-size:11px;color:${LC.textDim};line-height:1.4;">Drop an extended task actor here to continue it, or fill in the fields below to create one in the ${EXTENDED_TASK_FOLDER} folder.</div>`}
      </div>
      <div style="display:grid;grid-template-columns:1.4fr 86px 86px 86px 86px;gap:8px;">
        <label style="${labelStyle()}">Name<input class="tmk-ext-name" type="text" value="${esc(cfg.name)}" style="${inputStyle()}"/></label>
        <label style="${labelStyle()}">Work Max<input class="tmk-ext-work-max" type="number" min="1" max="999" value="${cfg.workMax}" style="${inputStyle("text-align:center;font-weight:700;color:" + LC.tertiary + ";")}"/></label>
        <label style="${labelStyle()}">Difficulty<input class="tmk-ext-difficulty" type="number" min="0" max="99" value="${cfg.difficulty}" style="${inputStyle("text-align:center;font-weight:700;color:" + LC.tertiary + ";")}"/></label>
        <label style="${labelStyle()}">Resistance<input class="tmk-ext-resistance" type="number" min="0" max="99" value="${cfg.resistance}" style="${inputStyle("text-align:center;font-weight:700;color:" + LC.tertiary + ";")}"/></label>
        <label style="${labelStyle()}">Magnitude<input class="tmk-ext-magnitude" type="number" min="0" max="99" value="${cfg.magnitude}" style="${inputStyle("text-align:center;font-weight:700;color:" + LC.tertiary + ";")}"/></label>
      </div>
      <label style="${labelStyle()}">Breakthroughs
        <input class="tmk-ext-breakthrough-max" type="number" min="0" max="9" value="${cfg.breakthroughMax}" style="${inputStyle("width:96px;text-align:center;font-weight:700;color:" + LC.secondary + ";")}"/>
      </label>
      <div class="tmk-ext-breakthrough-list" style="display:flex;flex-direction:column;gap:5px;">
        ${breakRows}
      </div>
      ${extendedIntervalsHtml(cfg)}
      ${extendedTalentOptionsHtml(taskActor, cfg)}
    </div>`;
}

function extendedIntervalsHtml(cfg) {
  const intervals = normalizeIntervalsConfig(cfg.intervals ?? {});
  return `
    <div class="tmk-ext-interval-panel" style="border:1px solid ${LC.borderDim};background:${LC.bg};padding:7px;border-radius:10px 3px 10px 3px;">
      <label style="display:flex;align-items:center;gap:8px;font-size:10px;color:${LC.text};letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">
        <input class="tmk-ext-interval-enabled" type="checkbox" ${intervals.enabled ? "checked" : ""} style="accent-color:${LC.secondary};"/>
        Intervals
      </label>
      <div class="tmk-ext-interval-fields" style="display:${intervals.enabled ? "grid" : "none"};grid-template-columns:1fr 70px 70px 70px 84px;gap:8px;margin-top:7px;">
        <label style="${labelStyle()}">Mode
          <select class="tmk-ext-interval-mode" style="${selectStyle()}">
            <option value="timed" ${intervals.mode === "timed" ? "selected" : ""}>Timed Challenge</option>
            <option value="variable" ${intervals.mode === "variable" ? "selected" : ""}>Variable/Delay</option>
          </select>
        </label>
        <label style="${labelStyle()}">Starting
          <input class="tmk-ext-interval-start" type="number" min="0" value="${intervals.start}" style="${inputStyle("text-align:center;font-weight:700;color:" + LC.tertiary + ";")}"/>
        </label>
        <label style="${labelStyle()}">Current Intervals
          <input class="tmk-ext-interval-remaining" type="number" min="0" value="${intervals.remaining}" style="${inputStyle("text-align:center;font-weight:700;color:" + LC.tertiary + ";")}"/>
        </label>
        <label style="${labelStyle()}">Ending
          <input class="tmk-ext-interval-ending" type="number" min="0" value="${intervals.ending}" style="${inputStyle("text-align:center;font-weight:700;color:" + LC.secondary + ";")}"/>
        </label>
        <label style="${labelStyle()}">Attempt Cost
          <input class="tmk-ext-interval-cost" type="number" min="1" value="${intervals.timedCost}" style="${inputStyle("text-align:center;font-weight:700;color:" + LC.secondary + ";")}"/>
        </label>
      </div>
    </div>`;
}

function extendedTalentOptionsHtml(actor, cfg) {
  const owned = ownedExtendedSituationalTalents(actor);
  if (!owned.length) return "";
  const selected = cfg.talentOptions ?? {};
  return `
    <div class="tmk-ext-talent-panel" style="border:1px solid ${LC.borderDim};background:${LC.bg};padding:7px;border-radius:10px 3px 10px 3px;">
      <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${LC.secondary};font-weight:700;margin-bottom:5px;">Situational Talents</div>
      <div style="display:flex;flex-direction:column;gap:5px;">
        ${owned.map(t => `
          <label style="display:flex;gap:8px;align-items:flex-start;font-size:10px;color:${LC.text};line-height:1.35;">
            <input class="tmk-ext-talent" type="checkbox" data-talent="${t.key}" ${selected[t.key] ? "checked" : ""} style="margin-top:2px;accent-color:${LC.secondary};"/>
            <span><strong style="color:${LC.tertiary};">${esc(t.name)}</strong> - ${esc(t.text)}</span>
          </label>
        `).join("")}
      </div>
    </div>`;
}

function breakthroughConfigRowHtml(bp, index, workMax) {
  const diffOptions = [
    ["0", "No difficulty change"],
    ["-1", "Difficulty -1"],
    ["1", "Difficulty +1"],
  ].map(([value, label]) => `<option value="${value}" ${String(bp.difficultyDelta ?? 0) === value ? "selected" : ""}>${label}</option>`).join("");
  const resistOptions = [
    ["0", "No resistance change"],
    ["-1", "Resistance -1"],
    ["1", "Resistance +1"],
  ].map(([value, label]) => `<option value="${value}" ${String(bp.resistanceDelta ?? 0) === value ? "selected" : ""}>${label}</option>`).join("");
  return `
    <div class="tmk-ext-breakthrough-row" data-index="${index}"
      style="display:grid;grid-template-columns:72px 1fr 1fr 104px minmax(120px,1.4fr);gap:6px;align-items:end;padding:6px;border:1px solid ${LC.borderDim};background:${LC.bg};border-radius:10px 3px 10px 3px;">
      <label style="${labelStyle()}">At Work
        <input class="tmk-ext-bp-threshold" type="number" min="1" max="${Math.max(1, workMax)}" value="${bp.threshold}" style="${inputStyle("text-align:center;font-weight:700;color:" + LC.tertiary + ";")}"/>
      </label>
      <label style="${labelStyle()}">Difficulty
        <select class="tmk-ext-bp-difficulty" style="${selectStyle()}">${diffOptions}</select>
      </label>
      <label style="${labelStyle()}">Resistance
        <select class="tmk-ext-bp-resistance" style="${selectStyle()}">${resistOptions}</select>
      </label>
      <label style="display:flex;align-items:center;gap:7px;font-size:10px;color:${LC.text};padding-bottom:7px;">
        <input class="tmk-ext-bp-next-impact" type="checkbox" ${clampInt(bp.nextImpactBonus, 0, 99, 0) > 0 ? "checked" : ""} style="accent-color:${LC.secondary};"/>
        +2 Next
      </label>
      <label style="${labelStyle()}">Notes / Event
        <input class="tmk-ext-bp-note" type="text" value="${esc(bp.note)}" style="${inputStyle()}"/>
      </label>
    </div>`;
}

function readDialogState(root, state) {
  state.taskName = root.querySelector(".tmk-task-name")?.value ?? "";
  state.flavor = root.querySelector(".tmk-flavor")?.value ?? "";
  state.mode = root.querySelector(".tmk-extended-panel")?.style?.display === "none" ? "task" : "extended";
  state.attrKey = root.querySelector(".tmk-attr")?.value ?? "presence";
  state.discKey = root.querySelector(".tmk-disc")?.value ?? "command";
  state.difficulty = clampInt(root.querySelector(".tmk-difficulty")?.value, 0, 99, 1);
  state.complicationRange = clampInt(root.querySelector(".tmk-complication")?.value, 1, 5, 1);
  state.shipAssist = !!root.querySelector(".tmk-ship-assist")?.checked;
  state.shipActorId = root.querySelector(".tmk-ship")?.value || state.shipActorId || null;
  state.shipSystemKey = root.querySelector(".tmk-ship-system")?.value || state.shipSystemKey || null;
  state.shipDeptKey = root.querySelector(".tmk-ship-dept")?.value || state.shipDeptKey || null;
  readExtendedTaskState(root, state);
}

function readExtendedTaskState(root, state) {
  const cfg = state.extendedTask ?? defaultExtendedConfig();
  const workMax = clampInt(root.querySelector(".tmk-ext-work-max")?.value, 1, 999, cfg.workMax);
  const breakthroughMax = clampInt(root.querySelector(".tmk-ext-breakthrough-max")?.value, 0, 9, cfg.breakthroughMax);
  const rows = [...root.querySelectorAll(".tmk-ext-breakthrough-row")];
  state.extendedTask = {
    actorId: cfg.actorId ?? null,
    name: root.querySelector(".tmk-ext-name")?.value ?? cfg.name ?? "Extended Task",
    workMax,
    difficulty: clampInt(root.querySelector(".tmk-ext-difficulty")?.value, 0, 99, cfg.difficulty),
    resistance: clampInt(root.querySelector(".tmk-ext-resistance")?.value, 0, 99, cfg.resistance),
    magnitude: clampInt(root.querySelector(".tmk-ext-magnitude")?.value, 0, 99, cfg.magnitude),
    breakthroughMax,
    breakpoints: defaultBreakthroughEffects(workMax, breakthroughMax, rows.map(row => ({
      threshold: row.querySelector(".tmk-ext-bp-threshold")?.value,
      difficultyDelta: row.querySelector(".tmk-ext-bp-difficulty")?.value,
      resistanceDelta: row.querySelector(".tmk-ext-bp-resistance")?.value,
      nextImpactBonus: row.querySelector(".tmk-ext-bp-next-impact")?.checked ? 2 : 0,
      note: row.querySelector(".tmk-ext-bp-note")?.value ?? "",
    }))),
    nextImpactBonus: clampInt(cfg.nextImpactBonus, 0, 99, 0),
    intervals: normalizeIntervalsConfig({
      enabled: !!root.querySelector(".tmk-ext-interval-enabled")?.checked,
      mode: root.querySelector(".tmk-ext-interval-mode")?.value ?? cfg.intervals?.mode ?? "timed",
      start: root.querySelector(".tmk-ext-interval-start")?.value ?? cfg.intervals?.start ?? 0,
      remaining: root.querySelector(".tmk-ext-interval-remaining")?.value ?? cfg.intervals?.remaining ?? 0,
      ending: root.querySelector(".tmk-ext-interval-ending")?.value ?? cfg.intervals?.ending ?? 0,
      timedCost: root.querySelector(".tmk-ext-interval-cost")?.value ?? cfg.intervals?.timedCost ?? 2,
    }),
    talentOptions: {
      bargain: !!root.querySelector('.tmk-ext-talent[data-talent="bargain"]')?.checked,
      labRat: !!root.querySelector('.tmk-ext-talent[data-talent="labRat"]')?.checked,
      surgerySavant: !!root.querySelector('.tmk-ext-talent[data-talent="surgerySavant"]')?.checked,
    },
  };
}

function wireDialog(root, state) {
  if (!root) return;
  const comp = root.querySelector(".tmk-complication");
  comp?.addEventListener("input", () => {
    const val = root.querySelector(".tmk-complication-val");
    if (val) val.textContent = comp.value;
  });
  wireTaskMode(root, state);
  wireActorSlot(root, state);
  wireShipFields(root, state);
  wireTraitPanel(root, state);
  wireExtendedTaskPanel(root, state);
  wireReuseButton(root, state);
  applyModeVisibility(root, state);
}

// Replace the whole dialog body and re-wire it, keeping the same state reference
// so the dialog's Post callback closure stays valid.
function rerenderDialog(root, state) {
  const container = root.querySelector(".sta2e-task-maker");
  if (!container) return;
  container.outerHTML = buildDialogHtml(state);
  wireDialog(root, state);
}

// Combined reuse list: the last normal task (if any) plus recent extended tasks.
// An extended "last" is already represented in the recent list, so it's not duplicated.
function reuseOptions() {
  const last = readLastSettings();
  const options = [];
  if (Object.keys(last).length && last.mode !== "extended") options.push(last);
  options.push(...readRecentExtended());
  return options;
}

function wireReuseButton(root, state) {
  root.querySelector(".tmk-reuse-last")?.addEventListener("click", async () => {
    const choices = reuseOptions();
    if (!choices.length) {
      ui.notifications.info("STA2e Toolkit: No saved task setup to reuse yet.");
      return;
    }
    let chosen = choices[0];
    if (choices.length > 1) {
      chosen = await openReuseHistoryPicker(choices);
      if (!chosen) return;
    }
    const restored = defaultState(lastSettingsAsPrefill(chosen));
    Object.assign(state, restored);
    rerenderDialog(root, state);
  });
}

function openReuseHistoryPicker(choices = []) {
  return new Promise(resolve => {
    const rows = choices.map((entry, i) => {
      const modeTag = entry.mode === "extended" ? "Extended" : "Normal";
      let progress = "";
      if (entry.mode === "extended" && entry.extendedTask?.actorId) {
        const a = game.actors.get(entry.extendedTask.actorId);
        if (a) {
          const snap = extendedProgressSnapshot(a);
          progress = ` ${snap.workValue}/${snap.workMax}`;
        }
      }
      return `<div class="tmk-reuse-row" data-index="${i}" style="display:flex;gap:8px;align-items:center;padding:6px;cursor:pointer;border-bottom:1px solid ${LC.borderDim};">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${LC.text};">${esc(reuseEntryLabel(entry))}</span>
        <span style="font-size:9px;color:${LC.textDim};white-space:nowrap;">${modeTag}${progress}</span>
      </div>`;
    }).join("");
    const html = `<div style="display:flex;flex-direction:column;gap:6px;max-height:420px;">
      <div class="tmk-pick-list" style="overflow-y:auto;max-height:380px;border:1px solid ${LC.border};">${rows}</div>
    </div>`;
    const dlg = new foundry.applications.api.DialogV2({
      window: { title: "Reuse Task Setup" },
      position: { width: 440 },
      content: html,
      buttons: [{ action: "cancel", label: "Cancel", callback: () => resolve(null) }],
      rejectClose: false,
    });
    dlg.render({ force: true }).then(() => {
      dlg.element.querySelectorAll(".tmk-reuse-row").forEach(row => {
        row.addEventListener("click", () => {
          const idx = Number(row.dataset.index);
          dlg.close();
          resolve(choices[idx] ?? null);
        });
      });
    });
  });
}

function applyModeVisibility(root, state) {
  const extended = state.mode === "extended";
  const panel = root.querySelector(".tmk-extended-panel");
  if (panel) panel.style.display = extended ? "flex" : "none";
  const grid = root.querySelector(".tmk-params-grid");
  if (grid) grid.style.gridTemplateColumns = extended ? "1fr 1fr 1fr" : "1fr 1fr 100px 1fr";
  const diffCell = root.querySelector(".tmk-difficulty-cell");
  if (diffCell) diffCell.style.display = extended ? "none" : "flex";
}

function wireTaskMode(root, state) {
  root.querySelectorAll(".tmk-mode-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      readDialogState(root, state);
      state.mode = btn.dataset.mode === "extended" ? "extended" : "task";
      applyModeVisibility(root, state);
      root.querySelectorAll(".tmk-mode-toggle").forEach(other => {
        const active = other.dataset.mode === state.mode;
        const color = other.dataset.mode === "extended" ? LC.secondary : LC.primary;
        other.style.background = active ? color : LC.bg;
        other.style.color = active ? LC.bg : LC.text;
      });
    });
  });
}

function wireActorSlot(root, state) {
  const slot = root.querySelector(".tmk-actor-slot");
  if (!slot) return;
  slot.addEventListener("dragover", event => {
    event.preventDefault();
    slot.style.borderColor = LC.primary;
  });
  slot.addEventListener("dragleave", () => { slot.style.borderColor = LC.border; });
  slot.addEventListener("drop", async event => {
    event.preventDefault();
    slot.style.borderColor = LC.border;
    const actor = await resolveDragActor(event);
    if (!isTaskActor(actor)) {
      ui.notifications.warn("STA2e Toolkit: Drop a character token or actor.");
      return;
    }
    assignActor(root, state, actor, actor?.token?.id ?? null);
  });
  slot.querySelector(".tmk-actor-clear")?.addEventListener("click", () => assignActor(root, state, null, null));
  slot.querySelectorAll(".tmk-actor-pick").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.source === "controlled" || btn.dataset.source === "targeted") {
        const token = pickCanvasToken(btn.dataset.source);
        if (!isTaskActor(token?.actor)) {
          ui.notifications.warn("STA2e Toolkit: Select, control, or target a character token first.");
          return;
        }
        assignActor(root, state, token.actor, token.id);
      } else {
        const actorId = await openActorPicker();
        const actor = actorId ? game.actors.get(actorId) : null;
        if (actor) assignActor(root, state, actor, null);
      }
    });
  });
}

function pickCanvasToken(source) {
  const controlled = canvas.tokens?.controlled?.[0] ?? null;
  const targeted = Array.from(game.user?.targets ?? [])[0] ?? null;
  return source === "targeted"
    ? (targeted ?? controlled)
    : (controlled ?? targeted);
}

async function resolveDragActor(event) {
  let data = null;
  try {
    const raw = event.dataTransfer?.getData("text/plain") || event.dataTransfer?.getData("application/json") || "";
    data = raw ? JSON.parse(raw) : null;
  } catch { return null; }
  if (data?.uuid) {
    try {
      const doc = await fromUuid(data.uuid);
      if (doc?.actor) return doc.actor;
      if (doc?.documentName === "Actor") return doc;
    } catch {}
  }
  if (data?.type === "Actor" && data.id) return game.actors.get(data.id);
  if (data?.type === "Token") {
    const scene = game.scenes.get(data.sceneId ?? canvas.scene?.id);
    return scene?.tokens.get(data.tokenId ?? data.id)?.actor ?? null;
  }
  return null;
}

function assignActor(root, state, actor, tokenId) {
  if (root.querySelector(".tmk-extended-panel")) readExtendedTaskState(root, state);
  state.actorId = actor?.id ?? null;
  state.tokenId = tokenId ?? null;
  const oldSlot = root.querySelector(".tmk-actor-slot");
  if (oldSlot) {
    oldSlot.outerHTML = actorSlotHtml(actor, state);
    wireActorSlot(root, state);
  }
  const ships = actor ? orderedShipsForActor(actor, state.shipActorId) : worldShips();
  state.shipActorId = ships[0]?.actorId ?? null;
  refreshShipSelects(root, state);
  if (root.querySelector(".tmk-extended-panel")) refreshExtendedTaskPanel(root, state);
}

function wireExtendedTaskPanel(root, state) {
  const panel = root.querySelector(".tmk-extended-panel");
  if (!panel) return;
  const slot = panel.querySelector(".tmk-extended-slot");
  slot?.addEventListener("dragover", event => {
    event.preventDefault();
    slot.style.borderColor = LC.secondary;
  });
  slot?.addEventListener("dragleave", () => { slot.style.borderColor = LC.borderDim; });
  slot?.addEventListener("drop", async event => {
    event.preventDefault();
    slot.style.borderColor = LC.borderDim;
    const actor = await resolveDragActor(event);
    if (!isExtendedTaskActor(actor)) {
      ui.notifications.warn("STA2e Toolkit: Drop an extended task actor.");
      return;
    }
    assignExtendedTask(root, state, actor);
  });
  panel.querySelector(".tmk-extended-pick")?.addEventListener("click", async () => {
    const actorId = await openExtendedTaskPicker();
    const actor = actorId ? game.actors.get(actorId) : null;
    if (actor) assignExtendedTask(root, state, actor);
  });
  panel.querySelector(".tmk-extended-clear")?.addEventListener("click", () => {
    readDialogState(root, state);
    state.extendedTask = defaultExtendedConfig({
      ...state.extendedTask,
      extendedTaskActorId: null,
      name: state.extendedTask?.name ?? "Extended Task",
    });
    refreshExtendedTaskPanel(root, state);
  });
  panel.querySelector(".tmk-ext-work-max")?.addEventListener("change", () => refreshBreakthroughRows(root, state));
  panel.querySelector(".tmk-ext-breakthrough-max")?.addEventListener("change", () => refreshBreakthroughRows(root, state));
  panel.querySelector(".tmk-ext-interval-enabled")?.addEventListener("change", event => {
    const fields = panel.querySelector(".tmk-ext-interval-fields");
    if (fields) fields.style.display = event.currentTarget.checked ? "grid" : "none";
  });
}

function assignExtendedTask(root, state, actor) {
  readDialogState(root, state);
  state.mode = "extended";
  state.extendedTask = extendedConfigFromActor(actor, state.extendedTask);
  refreshExtendedTaskPanel(root, state);
}

function refreshExtendedTaskPanel(root, state) {
  const oldPanel = root.querySelector(".tmk-extended-panel");
  if (!oldPanel) return;
  oldPanel.outerHTML = extendedTaskPanelHtml(state);
  applyModeVisibility(root, state);
  wireExtendedTaskPanel(root, state);
  wireTaskMode(root, state);
}

function refreshBreakthroughRows(root, state) {
  readExtendedTaskState(root, state);
  state.extendedTask.breakpoints = defaultBreakthroughEffects(
    state.extendedTask.workMax,
    state.extendedTask.breakthroughMax,
    state.extendedTask.breakpoints
  );
  const list = root.querySelector(".tmk-ext-breakthrough-list");
  if (list) {
    list.innerHTML = state.extendedTask.breakpoints
      .map((bp, i) => breakthroughConfigRowHtml(bp, i, state.extendedTask.workMax))
      .join("");
  }
}

function openActorPicker() {
  return new Promise(resolve => {
    const actors = game.actors.contents.filter(isTaskActor).sort((a, b) => a.name.localeCompare(b.name));
    const html = `
      <div style="display:flex;flex-direction:column;gap:6px;max-height:420px;">
        <input type="text" class="tmk-pick-search" placeholder="Filter..." style="${inputStyle()}"/>
        <div class="tmk-pick-list" style="overflow-y:auto;max-height:360px;border:1px solid ${LC.border};">
          ${actors.map(a => `<div class="tmk-pick-row" data-actor-id="${a.id}" style="display:flex;gap:6px;align-items:center;padding:4px;cursor:pointer;border-bottom:1px solid ${LC.borderDim};">
            <img src="${esc(a.img ?? "icons/svg/mystery-man.svg")}" style="width:22px;height:22px;border:1px solid ${LC.border};object-fit:cover;"/>
            <span style="flex:1;">${esc(a.name)}</span>
          </div>`).join("")}
        </div>
      </div>`;
    const dlg = new foundry.applications.api.DialogV2({
      window: { title: "Pick Character" },
      position: { width: 420 },
      content: html,
      buttons: [{ action: "cancel", label: "Cancel", callback: () => resolve(null) }],
      rejectClose: false,
    });
    dlg.render({ force: true }).then(() => {
      const search = dlg.element.querySelector(".tmk-pick-search");
      search?.addEventListener("input", () => {
        const q = search.value.toLowerCase();
        dlg.element.querySelectorAll(".tmk-pick-row").forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
        });
      });
      dlg.element.querySelectorAll(".tmk-pick-row").forEach(row => {
        row.addEventListener("click", () => {
          const id = row.dataset.actorId;
          dlg.close();
          resolve(id);
        });
      });
    });
  });
}

function openExtendedTaskPicker() {
  return new Promise(resolve => {
    const actors = worldExtendedTasks();
    if (!actors.length) {
      ui.notifications.warn("STA2e Toolkit: No extended task actors found.");
      resolve(null);
      return;
    }
    const html = `
      <div style="display:flex;flex-direction:column;gap:6px;max-height:420px;">
        <input type="text" class="tmk-pick-search" placeholder="Filter..." style="${inputStyle()}"/>
        <div class="tmk-pick-list" style="overflow-y:auto;max-height:360px;border:1px solid ${LC.border};">
          ${actors.map(a => {
            const snap = extendedProgressSnapshot(a);
            return `<div class="tmk-pick-row" data-actor-id="${a.id}" style="display:flex;gap:6px;align-items:center;padding:4px;cursor:pointer;border-bottom:1px solid ${LC.borderDim};">
              <img src="${esc(a.img ?? "icons/svg/mystery-man.svg")}" style="width:22px;height:22px;border:1px solid ${LC.border};object-fit:cover;"/>
              <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.name)}</span>
              <span style="font-size:9px;color:${LC.textDim};white-space:nowrap;">${snap.workValue}/${snap.workMax}</span>
            </div>`;
          }).join("")}
        </div>
      </div>`;
    const dlg = new foundry.applications.api.DialogV2({
      window: { title: "Pick Extended Task" },
      position: { width: 440 },
      content: html,
      buttons: [{ action: "cancel", label: "Cancel", callback: () => resolve(null) }],
      rejectClose: false,
    });
    dlg.render({ force: true }).then(() => {
      const search = dlg.element.querySelector(".tmk-pick-search");
      search?.addEventListener("input", () => {
        const q = search.value.toLowerCase();
        dlg.element.querySelectorAll(".tmk-pick-row").forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
        });
      });
      dlg.element.querySelectorAll(".tmk-pick-row").forEach(row => {
        row.addEventListener("click", () => {
          const id = row.dataset.actorId;
          dlg.close();
          resolve(id);
        });
      });
    });
  });
}

function wireShipFields(root, state) {
  const assist = root.querySelector(".tmk-ship-assist");
  assist?.addEventListener("change", () => {
    const fields = root.querySelector(".tmk-ship-fields");
    if (fields) fields.style.display = assist.checked ? "grid" : "none";
  });
  root.querySelector(".tmk-ship")?.addEventListener("change", event => {
    state.shipActorId = event.target.value;
    refreshShipSelects(root, state);
  });
}

function refreshShipSelects(root, state) {
  const actor = state.actorId ? game.actors.get(state.actorId) : null;
  const ships = actor ? orderedShipsForActor(actor, state.shipActorId) : worldShips();
  const shipSelect = root.querySelector(".tmk-ship");
  if (shipSelect) {
    shipSelect.innerHTML = ships.map(s => `<option value="${s.actorId}" ${s.actorId === state.shipActorId ? "selected" : ""}>${esc(s.label)}</option>`).join("");
  }
  const ship = ships.find(s => s.actorId === state.shipActorId)?.shipActor ?? ships[0]?.shipActor ?? null;
  state.shipSystemKey = Object.keys(ship?.system?.systems ?? {})[0] ?? state.shipSystemKey;
  state.shipDeptKey = Object.keys(ship?.system?.departments ?? {})[0] ?? state.shipDeptKey;
  const sys = root.querySelector(".tmk-ship-system");
  const dept = root.querySelector(".tmk-ship-dept");
  if (sys) sys.innerHTML = shipSystemOptions(ship, state.shipSystemKey);
  if (dept) dept.innerHTML = shipDeptOptions(ship, state.shipDeptKey);
}

function wireTraitPanel(root, state) {
  const drop = root.querySelector(".tmk-trait-drop");
  drop?.addEventListener("dragover", event => {
    event.preventDefault();
    drop.style.borderColor = LC.primary;
  });
  drop?.addEventListener("dragleave", () => { drop.style.borderColor = LC.borderDim; });
  drop?.addEventListener("drop", event => {
    event.preventDefault();
    drop.style.borderColor = LC.borderDim;
    const trait = resolveDroppedTrait(event);
    if (!trait) {
      ui.notifications.warn("STA2e Toolkit: Drop a trait from Trait Manager.");
      return;
    }
    addTrait(root, state, trait);
  });
  root.querySelector(".tmk-add-scene-trait")?.addEventListener("click", async () => {
    const id = await openSceneTraitPicker();
    const trait = id ? getSceneTraitRecords(canvas?.scene).find(t => t.id === id) : null;
    if (trait) addTrait(root, state, trait);
  });
  wireTraitRows(root, state);
}

function wireTraitRows(root, state) {
  root.querySelectorAll(".tmk-trait-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".tmk-trait-row");
      state.traits = state.traits.filter(t => !(t.scope === row?.dataset.scope && String(t.id) === String(row?.dataset.traitId) && String(t.actorId ?? "") === String(row?.dataset.actorId ?? "")));
      renderTraitList(root, state);
    });
  });
}

function resolveDroppedTrait(event) {
  let data = null;
  try {
    data = JSON.parse(event.dataTransfer?.getData("text/plain") ?? "");
  } catch { return null; }
  if (data?.type !== "STA2eTrait") return null;
  return resolveTaskTrait(data);
}

function addTrait(root, state, trait) {
  const record = traitToTaskRecord(trait);
  if (!record) return;
  const exists = state.traits.some(t => t.scope === record.scope && String(t.id) === String(record.id) && String(t.actorId ?? "") === String(record.actorId ?? ""));
  if (!exists) state.traits.push(record);
  renderTraitList(root, state);
}

function renderTraitList(root, state) {
  const list = root.querySelector(".tmk-trait-list");
  if (list) {
    list.innerHTML = state.traits.map(traitRowHtml).join("");
    wireTraitRows(root, state);
  }
}

function openSceneTraitPicker() {
  return new Promise(resolve => {
    const traits = getSceneTraitRecords(canvas?.scene);
    if (!traits.length) {
      ui.notifications.warn("STA2e Toolkit: No scene traits found.");
      resolve(null);
      return;
    }
    const html = `<div style="display:flex;flex-direction:column;gap:4px;max-height:360px;overflow-y:auto;">
      ${traits.map(t => `<button type="button" class="tmk-scene-trait-row" data-trait-id="${esc(t.id)}" style="display:flex;align-items:center;gap:6px;background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};padding:6px;cursor:pointer;text-align:left;">
        <img src="${esc(t.img)}" style="width:24px;height:24px;object-fit:cover;border:1px solid ${LC.border};"/>
        <span>${esc(t.name)}</span>
      </button>`).join("")}
    </div>`;
    const dlg = new foundry.applications.api.DialogV2({
      window: { title: "Pick Scene Trait" },
      position: { width: 380 },
      content: html,
      buttons: [{ action: "cancel", label: "Cancel", callback: () => resolve(null) }],
      rejectClose: false,
    });
    dlg.render({ force: true }).then(() => {
      dlg.element.querySelectorAll(".tmk-scene-trait-row").forEach(row => {
        row.addEventListener("click", () => {
          const id = row.dataset.traitId;
          dlg.close();
          resolve(id);
        });
      });
    });
  });
}

export async function postTaskRequestCard(snapshot) {
  if (!game.user.isGM) {
    ui.notifications.warn("STA2e Toolkit: Only the GM can post a task card.");
    return null;
  }
  const actor = game.actors.get(snapshot.actorId);
  if (!actor) {
    ui.notifications.error("STA2e Toolkit: Task actor not found.");
    return null;
  }
  let extendedSnapshot = null;
  if (snapshot.mode === "extended") {
    try {
      const extendedActor = await ensureExtendedTaskActor(snapshot.extendedTask ?? defaultExtendedConfig());
      const cfg = extendedConfigFromActor(extendedActor, snapshot.extendedTask);
      extendedSnapshot = extendedProgressSnapshot(extendedActor, cfg);
      snapshot.extendedTask = cfg;
    } catch (err) {
      console.error("STA2e Toolkit | extended task actor creation failed:", err);
      ui.notifications.error("STA2e Toolkit: Could not create or update the extended task actor.");
      return null;
    }
  }
  const taskData = {
    taskId: foundry.utils.randomID(),
    mode: snapshot.mode === "extended" ? "extended" : "task",
    actorId: actor.id,
    tokenId: snapshot.tokenId ?? null,
    actorName: actor.name,
    actorImg: actor.img ?? "icons/svg/mystery-man.svg",
    taskName: String(snapshot.taskName ?? "Task").trim() || "Task",
    flavor: String(snapshot.flavor ?? ""),
    attrKey: snapshot.attrKey ?? "presence",
    discKey: snapshot.discKey ?? "command",
    difficulty: extendedSnapshot ? extendedSnapshot.difficulty : clampInt(snapshot.difficulty, 0, 99, 1),
    complicationRange: clampInt(snapshot.complicationRange, 1, 5, 1),
    traits: Array.isArray(snapshot.traits) ? snapshot.traits : [],
    shipAssist: !!snapshot.shipAssist,
    shipActorId: snapshot.shipAssist ? snapshot.shipActorId ?? null : null,
    shipSystemKey: snapshot.shipAssist ? snapshot.shipSystemKey ?? null : null,
    shipDeptKey: snapshot.shipAssist ? snapshot.shipDeptKey ?? null : null,
    extendedTask: extendedSnapshot ? {
      actorId: extendedSnapshot.actorId,
      actorName: extendedSnapshot.actorName,
      actorImg: extendedSnapshot.actorImg,
      workValue: extendedSnapshot.workValue,
      workMax: extendedSnapshot.workMax,
      difficulty: extendedSnapshot.difficulty,
      resistance: extendedSnapshot.resistance,
      magnitude: extendedSnapshot.magnitude,
      breakthroughsValue: extendedSnapshot.breakthroughsValue,
      breakthroughsMax: extendedSnapshot.breakthroughsMax,
      breakpoints: extendedSnapshot.breakpoints,
      nextImpactBonus: extendedSnapshot.nextImpactBonus,
      intervals: extendedSnapshot.intervals,
      talentOptions: snapshot.extendedTask?.talentOptions ?? {},
    } : null,
  };
  return ChatMessage.create({
    content: renderTaskCardHtml(taskData),
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: { [MODULE]: { type: "taskRequest", taskData } },
  });
}

function renderTaskCardHtml(data) {
  const theme = getActiveLcThemeKey();
  const template = getLcThemeTemplate(theme);
  const themeVars = getLcCssVars("tmk");
  const ship = data.shipActorId ? game.actors.get(data.shipActorId) : null;
  const compText = data.complicationRange <= 1 ? "20" : `${21 - data.complicationRange}-20`;
  const traitRows = (data.traits ?? []).length
    ? `<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px;">${data.traits.map(t => `<div style="font-size:10px;color:${LC.textDim};"><span style="color:${LC.secondary};font-weight:700;">${esc(t.name)}</span> - ${esc((t.effects ?? []).filter(e => ["difficulty", "complicationRange"].includes(e.type)).map(e => effectText(e, t.quantity)).join(" / ") || "Context")}</div>`).join("")}</div>`
    : "";
  const shipLine = data.shipAssist && ship
    ? `<div style="margin-top:5px;font-size:10px;color:${LC.textDim};">Ship Assist: <span style="color:${LC.text};font-weight:700;">${esc(ship.name)}</span> - ${esc(labelFromKey(data.shipSystemKey))} + ${esc(labelFromKey(data.shipDeptKey))}</div>`
    : "";
  const extendedLine = data.mode === "extended" && data.extendedTask
    ? extendedTaskSummaryHtml(data.extendedTask)
    : "";
  return `
<div class="sta2e-task-card" data-task-id="${data.taskId}" data-theme="${theme}" data-template="${template}"
  style="${themeVars}background:${LC.bg};border:1px solid ${LC.primary};border-radius:3px;font-family:${LC.font};color:${LC.text};max-width:560px;overflow:hidden;">
  <div style="background:${LC.primary};color:${LC.bg};padding:6px 12px;display:flex;justify-content:space-between;align-items:center;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">
    <span style="font-size:11px;">${data.mode === "extended" ? "Extended Task" : "Task Request"}</span>
    <span style="font-size:10px;opacity:0.9;">Difficulty ${data.difficulty}</span>
  </div>
  <div style="padding:9px 12px;">
    <div style="display:flex;gap:8px;align-items:flex-start;">
      <img src="${esc(data.actorImg)}" style="width:36px;height:36px;object-fit:cover;border:1px solid ${LC.primary};background:#000;"/>
      <div style="flex:1;min-width:0;">
        <div style="font-size:14px;font-weight:700;color:${LC.primary};">${esc(data.taskName)}</div>
        <div style="font-size:12px;font-weight:700;color:${LC.text};margin-top:2px;">${esc(data.actorName)}</div>
        ${data.flavor ? `<div style="margin-top:2px;font-size:10px;color:${LC.textDim};font-style:italic;line-height:1.4;">${esc(data.flavor)}</div>` : ""}
      </div>
    </div>
    <div style="margin-top:8px;padding:7px 8px;border:1px solid ${LC.borderDim};background:rgba(0,0,0,0.25);">
      <div style="font-size:10px;color:${LC.text};font-weight:700;">${esc(attrLabel(data.attrKey))} + ${esc(discLabel(data.discKey))}</div>
      <div style="margin-top:2px;font-size:10px;color:${LC.textDim};">Difficulty ${data.difficulty} - Complications on ${compText}</div>
      ${shipLine}
      ${traitRows}
    </div>
    ${extendedLine}
    <div style="display:flex;gap:6px;margin-top:8px;">
      <button type="button" class="sta2e-task-request-roll" data-task-id="${data.taskId}"
        style="flex:1;padding:8px 10px;background:transparent;border:1px solid ${LC.primary};border-radius:2px;color:${LC.primary};font-family:${LC.font};font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;">
        Open Roller
      </button>
    </div>
  </div>
  <div style="height:3px;background:${LC.primary};"></div>
</div>`;
}

function extendedTaskSummaryHtml(ext) {
  const pct = ext.workMax > 0 ? Math.max(0, Math.min(100, Math.round((ext.workValue / ext.workMax) * 100))) : 0;
  const intervals = normalizeIntervalsConfig(ext.intervals ?? {});
  const breakthroughChips = (ext.breakpoints ?? []).map((bp, i) => {
    const done = i < (ext.breakthroughsValue ?? 0) || ext.workValue >= bp.threshold;
    return `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 5px;border:1px solid ${done ? LC.secondary : LC.borderDim};color:${done ? LC.secondary : LC.textDim};font-size:9px;">
      ${done ? "Done" : "Open"} ${i + 1} @ ${bp.threshold}
    </span>`;
  }).join("");
  return `
    <div style="margin-top:8px;padding:7px 8px;border:1px solid ${LC.secondary};background:rgba(0,0,0,0.25);">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <div style="font-size:10px;color:${LC.secondary};font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">${esc(ext.actorName ?? "Extended Task")}</div>
        <div style="font-size:10px;color:${LC.textDim};">Diff ${ext.difficulty} - Resist ${ext.resistance}</div>
      </div>
      <div style="margin-top:5px;height:9px;border:1px solid ${LC.borderDim};background:${LC.bg};position:relative;">
        <div style="height:100%;width:${pct}%;background:${LC.secondary};"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:3px;font-size:9px;color:${LC.textDim};">
        <span>Progress ${ext.workValue}/${ext.workMax}</span>
        <span>Breakthroughs ${ext.breakthroughsValue}/${ext.breakthroughsMax}</span>
      </div>
      ${intervals.enabled ? (() => {
        const variable = intervals.mode === "variable";
        const expired = intervals.remaining >= intervals.ending;
        const detail = variable
          ? `${intervals.remaining}/${intervals.ending} intervals`
          : `${intervals.remaining}/${intervals.ending} intervals`;
        return `<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:9px;color:${expired ? (LC.red ?? LC.primary) : LC.tertiary};">
          <span>${esc(intervalModeLabel(intervals.mode))}</span>
          <span>${detail}${expired ? " - Expired" : ""}</span>
        </div>`;
      })() : ""}
      ${breakthroughChips ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;">${breakthroughChips}</div>` : ""}
      ${ext.nextImpactBonus ? `<div style="margin-top:4px;font-size:9px;color:${LC.tertiary};">Pending bonus: +${ext.nextImpactBonus} Impact on the next successful task.</div>` : ""}
    </div>`;
}

function departmentScoreForResult(taskData, result = {}) {
  const liveDept = Number(result.state?.crewDept ?? result.rollData?.crewDept);
  if (Number.isFinite(liveDept) && liveDept > 0) return liveDept;
  const actor = result.actor ?? game.actors.get(taskData.actorId);
  const stats = actor ? readOfficerStats(actor) : null;
  return Number(stats?.disciplines?.[taskData.discKey] ?? 0) || 0;
}

function uniqueCoordinatedEffortAssists(result = {}) {
  const dice = [
    ...(result.namedAssistDice ?? []),
    ...(result.state?.namedAssistDice ?? []),
    ...(result.rollData?.namedAssistDice ?? []),
  ];
  const ids = new Set();
  for (const die of dice) {
    const actorId = die?.assistActorId ?? die?.actorId ?? die?.officerActorId ?? null;
    if (actorId) ids.add(actorId);
  }
  return [...ids]
    .map(id => game.actors.get(id))
    .filter(actor => actorHasTalent(actor, "Coordinated Efforts"));
}

function extendedTalentImpactBenefits(actor, taskData, passed, result = {}) {
  if (!passed || !actor) return { impactBonus: 0, ignoreResistance: false, extraWorkCost: 2, notes: [] };
  const attrKey = result.officerAttrKey ?? result.rollData?.officerAttrKey ?? result.state?.officerAttrKey ?? taskData.attrKey ?? "";
  const discKey = result.officerDiscKey ?? result.rollData?.officerDiscKey ?? result.state?.officerDiscKey ?? taskData.discKey ?? "";
  const selected = taskData.extendedTask?.talentOptions ?? {};
  const notes = [];
  let impactBonus = 0;
  let ignoreResistance = false;

  if (actorHasTalent(actor, "In the Nick of Time") && ["engineering", "science"].includes(discKey)) {
    impactBonus += 1;
    notes.push({ name: "In the Nick of Time", text: "+1 Impact" });
  }
  if (actorHasTalent(actor, "Intense Scrutiny") && ["reason", "control"].includes(attrKey)) {
    ignoreResistance = true;
    notes.push({ name: "Intense Scrutiny", text: "Ignore Resistance" });
  }
  if (selected.bargain && actorHasTalent(actor, "Bargain")) {
    impactBonus += 1;
    notes.push({ name: "Bargain", text: "+1 Impact" });
  }
  if (selected.labRat && actorHasTalent(actor, "Lab Rat")) {
    impactBonus += 1;
    notes.push({ name: "Lab Rat", text: "+1 Impact" });
  }
  if (selected.surgerySavant && actorHasTalent(actor, "Surgery Savant")) {
    impactBonus += 1;
    notes.push({ name: "Surgery Savant", text: "+1 Impact" });
  }
  const coordinated = uniqueCoordinatedEffortAssists(result);
  if (coordinated.length) {
    impactBonus += coordinated.length;
    notes.push({ name: "Coordinated Efforts", text: `+${coordinated.length} Impact from assist${coordinated.length === 1 ? "" : "s"}` });
  }

  const extraWorkCost = actorHasTalent(actor, "Miracle Worker") && discKey === "engineering" ? 1 : 2;
  if (extraWorkCost === 1) notes.push({ name: "Miracle Worker", text: "Extra Work costs 1 Momentum" });

  return { impactBonus, ignoreResistance, extraWorkCost, notes };
}

function rapidAnalysisReduceTimeCost(actor, taskData, passed, result = {}) {
  if (!passed) return 2;
  const discKey = result.officerDiscKey ?? result.rollData?.officerDiscKey ?? result.state?.officerDiscKey ?? taskData.discKey ?? "";
  return actorHasTalent(actor, "Rapid Analysis") && discKey === "science" ? 1 : 2;
}

function calculateIntervalResolution(actor, taskData, result, taskActor, passed) {
  const snap = normalizeIntervalsConfig(taskData.extendedTask?.intervals ?? {});
  if (!snap.enabled) return { enabled: false };
  const live = normalizeIntervalsConfig(extendedConfigFromActor(actor, taskData.extendedTask).intervals ?? snap);
  const complications = Math.max(0, Number(result.complications) || 0);
  const meticulous = !!result.meticulousUsed;
  const percussive = !!result.percussiveMaintenanceUsed && passed;
  const beforeRemaining = live.remaining;
  const notes = [];
  if (complications) notes.push(`${complications} complication${complications === 1 ? "" : "s"}`);
  if (meticulous) notes.push("Meticulous");
  if (percussive) notes.push("Percussive Maintenance");

  if (snap.mode === "variable") {
    // Variable/Delay counts UP. Every attempt uses one interval (count climbs);
    // each complication uses one more; a success pushes the Ending deadline out by one.
    // The task expires when the count reaches the Ending value.
    const beforeEnding = live.ending;
    const usedDelta = 1 + (meticulous ? 1 : 0) - (percussive ? 1 : 0);
    const endingDelta = (passed ? 1 : 0) - complications;
    const afterRemaining = Math.max(live.start, beforeRemaining + usedDelta);
    const afterEnding = Math.max(0, beforeEnding + endingDelta);
    const varNotes = ["Interval used (+1)", ...notes];
    if (passed) varNotes.push("Success delays the deadline (+1 Ending)");
    if (complications) varNotes.push(`Complications cut the deadline (-${complications} Ending)`);
    const completeFailure = !passed && complications > 0;
    const expired = afterRemaining >= afterEnding;
    return {
      enabled: true,
      mode: "variable",
      beforeRemaining,
      afterRemaining,
      beforeEnding,
      afterEnding,
      ending: afterEnding,
      usedDelta,
      endingDelta,
      delta: usedDelta,
      notes: varNotes,
      canAddInterval: passed,
      addIntervalCost: 2,
      canExhaust: completeFailure && !expired,
      completeFailure,
      expired,
      start: live.start,
      timedCost: snap.timedCost,
    };
  }

  const consumed = Math.max(1, snap.timedCost + complications + (meticulous ? 1 : 0) - (percussive ? 1 : 0));
  const afterRemaining = Math.max(live.start, beforeRemaining + consumed);
  const reduceCost = rapidAnalysisReduceTimeCost(taskActor, taskData, passed, result);
  return {
    enabled: true,
    mode: "timed",
    beforeRemaining,
    afterRemaining,
    beforeEnding: live.ending,
    afterEnding: live.ending,
    ending: live.ending,
    delta: consumed,
    consumed,
    minConsumed: 1,
    notes,
    canReduceTime: consumed > 1,
    reduceTimeKind: passed ? "momentum" : "threat",
    reduceTimeCost: passed ? reduceCost : 2,
    rapidAnalysis: passed && reduceCost === 1,
    expired: afterRemaining >= live.ending,
    start: live.start,
    timedCost: snap.timedCost,
  };
}

async function applyExtendedTaskIntervalState(actor, intervalResult) {
  if (!intervalResult?.enabled) return null;
  const cfg = extendedConfigFromActor(actor);
  const intervals = normalizeIntervalsConfig({
    ...cfg.intervals,
    enabled: true,
    mode: intervalResult.mode,
    remaining: intervalResult.afterRemaining,
    start: intervalResult.start,
    ending: intervalResult.ending ?? cfg.intervals?.ending ?? 0,
    timedCost: intervalResult.timedCost,
  });
  await actor.setFlag(MODULE, EXTENDED_TASK_FLAG, extendedTaskFlagPayload(actor, { intervals }));
  return intervals;
}

async function handleExtendedTaskRollResult(taskData, result = {}) {
  if (!taskData?.extendedTask?.actorId) return;
  const payload = {
    taskData,
    result: {
      passed: !!result.passed,
      successes: Math.max(0, Number(result.successes) || 0),
      momentum: Math.max(0, Number(result.momentum) || 0),
      complications: Math.max(0, Number(result.complications) || 0),
      departmentScore: departmentScoreForResult(taskData, result),
      actorId: result.actor?.id ?? taskData.actorId,
      tokenId: result.token?.id ?? taskData.tokenId ?? null,
      trackerMessageId: result.trackerMessageId ?? result.state?.trackerMessageId ?? result.rollData?.trackerMessageId ?? null,
      officerAttrKey: result.state?.officerAttrKey ?? result.rollData?.officerAttrKey ?? taskData.attrKey,
      officerDiscKey: result.state?.officerDiscKey ?? result.rollData?.officerDiscKey ?? taskData.discKey,
      meticulousUsed: !!(result.state?.meticulousUsed ?? result.rollData?.meticulousUsed),
      percussiveMaintenanceUsed: !!(result.state?.percussiveMaintenanceUsed ?? result.rollData?.percussiveMaintenanceUsed),
      namedAssistDice: result.state?.namedAssistDice ?? result.rollData?.namedAssistDice ?? [],
      rollData: result.rollData ?? null,
    },
    momentumWork: 0,
    requesterUserId: game.user.id,
  };
  if (game.user.isGM) {
    await applyExtendedTaskResult(payload);
  } else {
    game.socket.emit(`module.${MODULE}`, {
      action: "applyExtendedTaskResult",
      ...payload,
    });
  }
}

export async function applyExtendedTaskResult({ taskData, result = {}, momentumWork = 0 } = {}) {
  if (!game.user.isGM) return;
  const actor = taskData?.extendedTask?.actorId ? game.actors.get(taskData.extendedTask.actorId) : null;
  if (!actor) {
    ui.notifications.warn("STA2e Toolkit: Extended task actor not found.");
    return;
  }
  const taskActor = result.actorId ? game.actors.get(result.actorId) : game.actors.get(taskData.actorId);
  const cfg = extendedConfigFromActor(actor, taskData.extendedTask);
  const before = extendedProgressSnapshot(actor, cfg);
  const passed = !!result.passed;
  const departmentScore = Math.max(0, Number(result.departmentScore) || 0);
  const talentBenefits = extendedTalentImpactBenefits(taskActor, taskData, passed, result);
  const intervalResult = calculateIntervalResolution(actor, taskData, result, taskActor, passed);
  const resistanceBefore = before.resistance;
  const resistanceApplied = talentBenefits.ignoreResistance ? 0 : resistanceBefore;
  const pendingBonus = passed ? clampInt(cfg.nextImpactBonus, 0, 99, 0) : clampInt(cfg.nextImpactBonus, 0, 99, 0);
  const extraWork = 0;
  const rawImpact = passed ? departmentScore + pendingBonus + talentBenefits.impactBonus : 0;
  const workApplied = passed ? Math.max(0, rawImpact - resistanceApplied) : 0;
  const afterWork = Math.min(before.workMax, before.workValue + workApplied);
  const applied = await applyExtendedTaskWorkUpdate(actor, before, cfg, afterWork, {
    consumePendingBonus: passed,
    triggerBreakthroughs: passed,
  });
  const appliedIntervals = await applyExtendedTaskIntervalState(actor, intervalResult);
  if (appliedIntervals) {
    intervalResult.afterRemaining = appliedIntervals.remaining;
    intervalResult.afterEnding = appliedIntervals.ending;
    intervalResult.expired = appliedIntervals.remaining >= appliedIntervals.ending;
  }
  const after = applied.after;
  const cardData = {
    taskName: taskData.taskName,
    actorName: taskData.actorName,
    passed,
    successes: result.successes,
    momentum: result.momentum,
    complications: result.complications,
    departmentScore,
    pendingBonus,
    talentImpact: talentBenefits.impactBonus,
    talentNotes: talentBenefits.notes,
    momentumWork: extraWork,
    rawImpact,
    resistance: resistanceApplied,
    resistanceBefore,
    workApplied,
    before,
    after,
    triggered: applied.triggered,
    canSpendExtraWork: passed,
    extraWorkCost: talentBenefits.extraWorkCost,
    intervals: intervalResult,
  };
  await ChatMessage.create({
    content: renderExtendedTaskResultCard(cardData),
    speaker: ChatMessage.getSpeaker({
      actor: result.actorId ? game.actors.get(result.actorId) : actor,
      token: result.tokenId ? canvas.tokens?.get(result.tokenId) : null,
    }),
    flags: {
      [MODULE]: {
        type: "extendedTaskResult",
        extendedTaskActorId: actor.id,
        progressData: {
          taskName: taskData.taskName,
          actorName: taskData.actorName,
          actorId: result.actorId ?? taskData.actorId,
          tokenId: result.tokenId ?? taskData.tokenId ?? null,
          trackerMessageId: result.trackerMessageId ?? null,
          extraWorkCost: talentBenefits.extraWorkCost,
          canSpendExtraWork: passed,
          intervals: intervalResult,
          cardData,
        },
      },
    },
  });
}

async function applyExtendedTaskWorkUpdate(actor, before, cfg, afterWork, { consumePendingBonus = false, triggerBreakthroughs = true } = {}) {
  const breakpoints = defaultBreakthroughEffects(before.workMax, before.breakthroughsMax, cfg.breakpoints);
  const completedBefore = clampInt(actor.system?.breakthroughs?.value, 0, before.breakthroughsMax, before.breakthroughsValue);
  const completedAfter = Math.min(
    before.breakthroughsMax,
    breakpoints.reduce((count, bp) => count + (afterWork >= bp.threshold ? 1 : 0), 0)
  );

  let difficultyAfter = before.difficulty;
  let resistanceAfter = before.resistance;
  let nextImpactBonus = consumePendingBonus ? 0 : clampInt(cfg.nextImpactBonus, 0, 99, 0);
  const triggered = [];
  if (triggerBreakthroughs) {
    for (let i = completedBefore; i < completedAfter; i++) {
      const bp = breakpoints[i];
      if (!bp) continue;
      const diffDelta = clampInt(bp.difficultyDelta, -1, 1, 0);
      const resistDelta = clampInt(bp.resistanceDelta, -1, 1, 0);
      if (diffDelta) difficultyAfter = Math.max(0, difficultyAfter + diffDelta);
      if (resistDelta) resistanceAfter = Math.max(0, resistanceAfter + resistDelta);
      if (bp.nextImpactBonus) nextImpactBonus += clampInt(bp.nextImpactBonus, 0, 99, 0);
      triggered.push({
        index: i + 1,
        threshold: bp.threshold,
        difficultyDelta: diffDelta,
        resistanceDelta: resistDelta,
        nextImpactBonus: clampInt(bp.nextImpactBonus, 0, 99, 0),
        note: String(bp.note ?? ""),
      });
    }
  }

  await actor.update({
    "system.workprogress.value": afterWork,
    "system.workprogress.max": before.workMax,
    "system.breakthroughs.value": completedAfter,
    "system.breakthroughs.max": before.breakthroughsMax,
    "system.difficulty": difficultyAfter,
    "system.resistance": resistanceAfter,
  });
  await actor.setFlag(MODULE, EXTENDED_TASK_FLAG, extendedTaskFlagPayload(actor, {
    breakpoints,
    nextImpactBonus,
    intervals: cfg.intervals,
  }));

  return {
    after: extendedProgressSnapshot(actor, extendedConfigFromActor(actor, { ...cfg, nextImpactBonus })),
    triggered,
  };
}

export async function applyExtendedTaskExtraWork({ messageId = null, extendedTaskActorId = null, requesterUserId = null } = {}) {
  if (!game.user.isGM) return;
  const actor = extendedTaskActorId ? game.actors.get(extendedTaskActorId) : null;
  if (!actor) {
    ui.notifications.warn("STA2e Toolkit: Extended task actor not found.");
    return;
  }
  const cfg = extendedConfigFromActor(actor);
  const before = extendedProgressSnapshot(actor, cfg);
  if (before.workValue >= before.workMax) {
    ui.notifications.info("STA2e Toolkit: Extended task is already complete.");
    return;
  }
  const message = messageId ? game.messages.get(messageId) : null;
  const progressData = message?.getFlag(MODULE, "progressData") ?? {};
  const paid = await payMomentumCost({
    trackerMessageId: progressData.trackerMessageId ?? null,
    actorId: progressData.actorId ?? null,
    actor,
    requesterUserId,
    cost: clampInt(progressData.extraWorkCost, 1, 2, 2),
    label: "extra work",
  });
  if (!paid) return;

  const afterWork = Math.min(before.workMax, before.workValue + 1);
  const applied = await applyExtendedTaskWorkUpdate(actor, before, cfg, afterWork, {
    consumePendingBonus: false,
    triggerBreakthroughs: true,
  });
  const cardData = {
    taskName: progressData.taskName ?? "Extra Work",
    actorName: progressData.actorName ?? game.users.get(requesterUserId)?.name ?? "Momentum Spend",
    passed: true,
    successes: null,
    momentum: null,
    complications: null,
    departmentScore: 0,
    pendingBonus: 0,
    momentumWork: 1,
    rawImpact: 1,
    resistance: 0,
    workApplied: 1,
    before,
    after: applied.after,
    triggered: applied.triggered,
    canSpendExtraWork: true,
    extraWorkCost: clampInt(progressData.extraWorkCost, 1, 2, 2),
    extraWorkOnly: true,
    intervals: progressData.intervals ?? null,
  };
  const content = renderExtendedTaskResultCard(cardData, messageId);

  if (message) {
    await message.update({
      content,
      "flags.sta2e-toolkit.progressData.lastExtraWorkBy": requesterUserId ?? null,
      "flags.sta2e-toolkit.progressData.cardData": cardData,
    });
  } else {
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
      flags: {
        [MODULE]: {
          type: "extendedTaskResult",
          extendedTaskActorId: actor.id,
          progressData: {
            taskName: progressData.taskName ?? "Extra Work",
            actorName: progressData.actorName ?? "Momentum Spend",
            actorId: progressData.actorId ?? null,
            trackerMessageId: progressData.trackerMessageId ?? null,
            extraWorkCost: clampInt(progressData.extraWorkCost, 1, 2, 2),
            canSpendExtraWork: true,
            cardData,
          },
        },
      },
    });
  }
}

async function payMomentumCost({ trackerMessageId = null, actorId = null, actor = null, requesterUserId = null, cost = 2, label = "spend" } = {}) {
  const tracker = readTrackerState(trackerMessageId, actorId);
  const floatAvailable = Math.max(0, Number(tracker.float) || 0);
  const bonusAvailable = Math.max(0, Number(tracker.bonus) || 0);
  const poolAvailable = Math.max(0, Number(readPool("momentum")) || 0);
  cost = clampInt(cost, 1, 999, 2);
  if (floatAvailable + bonusAvailable + poolAvailable < cost) {
    ui.notifications.warn(`STA2e Toolkit: Not enough Momentum for ${label}.`);
    return false;
  }

  let remaining = cost;
  const floatUsed = Math.min(floatAvailable, remaining);
  remaining -= floatUsed;
  const bonusUsed = Math.min(bonusAvailable, remaining);
  remaining -= bonusUsed;
  const poolUsed = remaining;

  if (tracker.messageId && (floatUsed > 0 || bonusUsed > 0)) {
    await decrementTracker(tracker.messageId, {
      float: floatUsed,
      bonus: bonusUsed,
    });
  }
  if (poolUsed > 0) {
    const paidPool = await adjustPool("momentum", -poolUsed, {
      source: "toolkit",
      userId: requesterUserId ?? null,
      actor,
    });
    if (!paidPool) return false;
  }
  return true;
}

export async function applyExtendedTaskIntervalSpend({ messageId = null, extendedTaskActorId = null, requesterUserId = null } = {}) {
  if (!game.user.isGM) return;
  const actor = extendedTaskActorId ? game.actors.get(extendedTaskActorId) : null;
  const message = messageId ? game.messages.get(messageId) : null;
  if (!actor || !message) {
    ui.notifications.warn("STA2e Toolkit: Extended task interval card not found.");
    return;
  }
  const progressData = message.getFlag(MODULE, "progressData") ?? {};
  const intervalData = progressData.intervals ?? {};
  if (!intervalData.enabled) return;

  const cfg = extendedConfigFromActor(actor);
  const live = normalizeIntervalsConfig(cfg.intervals ?? {});
  let updated = { ...intervalData };
  let nextRemaining = live.remaining;
  let nextEnding = live.ending;

  if (intervalData.mode === "timed") {
    const currentConsumed = clampInt(intervalData.consumed, 1, 999, 1);
    if (currentConsumed <= 1) {
      ui.notifications.info("STA2e Toolkit: This attempt is already at the minimum interval cost.");
      return;
    }
    if (intervalData.reduceTimeKind === "threat") {
      const ok = await adjustPool("threat", 2, {
        source: "toolkit",
        userId: requesterUserId ?? null,
        actor,
      });
      if (!ok) return;
    } else {
      const paid = await payMomentumCost({
        trackerMessageId: progressData.trackerMessageId ?? null,
        actorId: progressData.actorId ?? null,
        actor,
        requesterUserId,
        cost: clampInt(intervalData.reduceTimeCost, 1, 999, 2),
        label: "reduce time",
      });
      if (!paid) return;
    }
    const newConsumed = currentConsumed - 1;
    nextRemaining = Math.max(live.start, live.remaining - 1);
    updated = {
      ...intervalData,
      consumed: newConsumed,
      delta: newConsumed,
      afterRemaining: nextRemaining,
      canReduceTime: newConsumed > 1,
      expired: nextRemaining >= nextEnding,
      lastSpendBy: requesterUserId ?? null,
    };
  } else {
    if (!intervalData.canAddInterval) return;
    const paid = await payMomentumCost({
      trackerMessageId: progressData.trackerMessageId ?? null,
      actorId: progressData.actorId ?? null,
      actor,
      requesterUserId,
      cost: clampInt(intervalData.addIntervalCost, 1, 999, 2),
      label: "delay deadline",
    });
    if (!paid) return;
    // Variable/Delay: push the Ending deadline out by one interval.
    nextEnding = live.ending + 1;
    updated = {
      ...intervalData,
      afterEnding: nextEnding,
      ending: nextEnding,
      endingDelta: (Number(intervalData.endingDelta) || 0) + 1,
      afterRemaining: live.remaining,
      expired: live.remaining >= nextEnding,
      canExhaust: false,
      lastSpendBy: requesterUserId ?? null,
    };
  }

  const intervals = normalizeIntervalsConfig({
    ...live,
    remaining: nextRemaining,
    ending: nextEnding,
  });
  await actor.setFlag(MODULE, EXTENDED_TASK_FLAG, extendedTaskFlagPayload(actor, { intervals }));

  const after = extendedProgressSnapshot(actor, extendedConfigFromActor(actor));
  const fallbackCardData = {
    taskName: progressData.taskName ?? "Interval Spend",
    actorName: progressData.actorName ?? game.users.get(requesterUserId)?.name ?? "Interval Spend",
    passed: true,
    successes: null,
    momentum: null,
    complications: null,
    departmentScore: 0,
    pendingBonus: 0,
    talentImpact: 0,
    talentNotes: [],
    momentumWork: 0,
    rawImpact: 0,
    resistance: after.resistance,
    resistanceBefore: after.resistance,
    workApplied: 0,
    before: after,
    after,
    triggered: [],
    canSpendExtraWork: false,
    extraWorkCost: clampInt(progressData.extraWorkCost, 1, 2, 2),
  };
  const cardData = {
    ...fallbackCardData,
    ...(progressData.cardData ?? {}),
    after,
    intervals: updated,
    triggered: progressData.cardData?.triggered ?? fallbackCardData.triggered,
  };
  await message.update({
    content: renderExtendedTaskResultCard(cardData, messageId),
    "flags.sta2e-toolkit.progressData.intervals": updated,
    "flags.sta2e-toolkit.progressData.cardData": cardData,
  });
}

export async function applyExtendedTaskIntervalExhaust({ messageId = null, extendedTaskActorId = null, requesterUserId = null } = {}) {
  if (!game.user.isGM) return;
  const actor = extendedTaskActorId ? game.actors.get(extendedTaskActorId) : null;
  const message = messageId ? game.messages.get(messageId) : null;
  if (!actor || !message) {
    ui.notifications.warn("STA2e Toolkit: Extended task interval card not found.");
    return;
  }
  const progressData = message.getFlag(MODULE, "progressData") ?? {};
  const intervalData = progressData.intervals ?? {};
  if (!intervalData.enabled || intervalData.mode !== "variable") return;

  const cfg = extendedConfigFromActor(actor);
  const live = normalizeIntervalsConfig(cfg.intervals ?? {});
  if (live.remaining >= live.ending) {
    ui.notifications.info("STA2e Toolkit: No intervals remain to use up.");
    return;
  }
  // Count-up: jump the used count to the deadline so the clock runs out.
  const intervals = normalizeIntervalsConfig({ ...live, remaining: live.ending });
  await actor.setFlag(MODULE, EXTENDED_TASK_FLAG, extendedTaskFlagPayload(actor, { intervals }));

  const updated = {
    ...intervalData,
    afterRemaining: live.ending,
    afterEnding: live.ending,
    ending: live.ending,
    canAddInterval: false,
    canExhaust: false,
    expired: true,
    exhausted: true,
    notes: [...(intervalData.notes ?? []), "GM used up remaining time"],
    lastSpendBy: requesterUserId ?? null,
  };

  const after = extendedProgressSnapshot(actor, extendedConfigFromActor(actor));
  const fallbackCardData = {
    taskName: progressData.taskName ?? "Extended Task",
    actorName: progressData.actorName ?? "Extended Task",
    passed: false,
    successes: null,
    momentum: null,
    complications: null,
    departmentScore: 0,
    pendingBonus: 0,
    talentImpact: 0,
    talentNotes: [],
    momentumWork: 0,
    rawImpact: 0,
    resistance: after.resistance,
    resistanceBefore: after.resistance,
    workApplied: 0,
    before: after,
    after,
    triggered: [],
    canSpendExtraWork: false,
    extraWorkCost: clampInt(progressData.extraWorkCost, 1, 2, 2),
  };
  const cardData = {
    ...fallbackCardData,
    ...(progressData.cardData ?? {}),
    after,
    intervals: updated,
    triggered: progressData.cardData?.triggered ?? fallbackCardData.triggered,
  };
  await message.update({
    content: renderExtendedTaskResultCard(cardData, messageId),
    "flags.sta2e-toolkit.progressData.intervals": updated,
    "flags.sta2e-toolkit.progressData.cardData": cardData,
  });
}

function renderExtendedTaskResultCard(data, messageId = null) {
  const theme = getActiveLcThemeKey();
  const template = getLcThemeTemplate(theme);
  const themeVars = getLcCssVars("tmk");
  const after = data.after;
  const pct = after.workMax > 0 ? Math.max(0, Math.min(100, Math.round((after.workValue / after.workMax) * 100))) : 0;
  const breakthroughRows = (after.breakpoints ?? []).map((bp, i) => {
    const done = i < after.breakthroughsValue || after.workValue >= bp.threshold;
    return `<div style="display:flex;justify-content:space-between;gap:8px;color:${done ? LC.secondary : LC.textDim};font-size:10px;">
      <span>Breakthrough ${i + 1}</span><span>${done ? "Completed" : "Open"} @ ${bp.threshold}</span>
    </div>`;
  }).join("");
  const triggeredRows = (data.triggered ?? []).length
    ? `<div style="margin-top:7px;padding:6px;border:1px solid ${LC.secondary};background:rgba(0,0,0,0.18);">
        <div style="font-size:9px;color:${LC.secondary};font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">Breakthrough Effects</div>
        ${(data.triggered ?? []).map(t => {
          const parts = [];
          if (t.difficultyDelta) parts.push(`Difficulty ${t.difficultyDelta > 0 ? "+" : ""}${t.difficultyDelta}`);
          if (t.resistanceDelta) parts.push(`Resistance ${t.resistanceDelta > 0 ? "+" : ""}${t.resistanceDelta}`);
          if (t.nextImpactBonus) parts.push(`+${t.nextImpactBonus} Impact next task`);
          if (t.note) parts.push(t.note);
          return `<div style="font-size:10px;color:${LC.text};line-height:1.4;">#${t.index}: ${esc(parts.join(" - ") || "Completed")}</div>`;
        }).join("")}
      </div>`
    : "";
  const canSpendExtraWork = !!data.canSpendExtraWork && after.workValue < after.workMax;
  const extraWorkCost = clampInt(data.extraWorkCost, 1, 2, 2);
  const extraWorkButton = canSpendExtraWork
    ? `<div style="margin-top:8px;">
        <button type="button" class="sta2e-extended-extra-work" data-message-id="${esc(messageId ?? "")}" data-actor-id="${esc(after.actorId ?? "")}"
          style="width:100%;padding:7px 10px;background:rgba(0,150,255,0.10);border:1px solid ${LC.secondary};
          border-radius:2px;color:${LC.secondary};font-family:${LC.font};font-size:10px;font-weight:700;
          letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;">
          Spend ${extraWorkCost} Momentum - Add +1 Work
        </button>
      </div>`
    : "";
  const intervalData = data.intervals?.enabled ? data.intervals : null;
  const intervalButton = (() => {
    if (!intervalData) return "";
    if (intervalData.mode === "timed" && intervalData.canReduceTime) {
      const isThreat = intervalData.reduceTimeKind === "threat";
      const label = isThreat
        ? `Add ${clampInt(intervalData.reduceTimeCost, 1, 999, 2)} Threat - Reduce Time`
        : `Spend ${clampInt(intervalData.reduceTimeCost, 1, 999, 2)} Momentum - Reduce Time`;
      return `<button type="button" class="sta2e-extended-interval-spend" data-message-id="${esc(messageId ?? "")}" data-actor-id="${esc(after.actorId ?? "")}"
        style="width:100%;margin-top:6px;padding:7px 10px;background:rgba(255,153,0,0.10);border:1px solid ${LC.tertiary};
        border-radius:2px;color:${LC.tertiary};font-family:${LC.font};font-size:10px;font-weight:700;
        letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;">${esc(label)}</button>`;
    }
    if (intervalData.mode === "variable") {
      let buttons = "";
      if (intervalData.canAddInterval) {
        buttons += `<button type="button" class="sta2e-extended-interval-spend" data-message-id="${esc(messageId ?? "")}" data-actor-id="${esc(after.actorId ?? "")}"
          style="width:100%;margin-top:6px;padding:7px 10px;background:rgba(255,153,0,0.10);border:1px solid ${LC.tertiary};
          border-radius:2px;color:${LC.tertiary};font-family:${LC.font};font-size:10px;font-weight:700;
          letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;">Spend ${clampInt(intervalData.addIntervalCost, 1, 999, 2)} Momentum - Delay Deadline +1</button>`;
      }
      if (intervalData.canExhaust) {
        const redColor = LC.red ?? LC.primary;
        buttons += `<button type="button" class="sta2e-extended-interval-exhaust" data-message-id="${esc(messageId ?? "")}" data-actor-id="${esc(after.actorId ?? "")}"
          style="width:100%;margin-top:6px;padding:7px 10px;background:rgba(204,68,68,0.12);border:1px solid ${redColor};
          border-radius:2px;color:${redColor};font-family:${LC.font};font-size:10px;font-weight:700;
          letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;">GM: Use Up Remaining Time</button>`;
      }
      return buttons;
    }
    return "";
  })();
  const intervalRows = intervalData ? (() => {
    const modeLabel = intervalModeLabel(intervalData.mode);
    const isVariable = intervalData.mode === "variable";
    const ending = intervalData.afterEnding ?? intervalData.ending ?? 0;
    const countText = isVariable
      ? `Interval ${intervalData.beforeRemaining} -> ${intervalData.afterRemaining} of ${ending}`
      : `Intervals ${intervalData.beforeRemaining} -> ${intervalData.afterRemaining} of ${ending}`;
    const endDelta = Number(intervalData.endingDelta ?? 0) || 0;
    const deltaText = isVariable
      ? `Deadline ${ending}${endDelta !== 0 ? ` (${endDelta > 0 ? "+" : ""}${endDelta})` : ""}`
      : `Advanced ${intervalData.consumed ?? Math.abs(intervalData.delta ?? 0)}`;
    return `<div style="margin-top:7px;padding:6px 7px;border:1px solid ${intervalData.expired ? (LC.red ?? LC.primary) : LC.tertiary};background:rgba(0,0,0,0.16);">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <div style="font-size:9px;color:${LC.tertiary};font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${esc(modeLabel)}</div>
        <div style="font-size:9px;color:${intervalData.expired ? (LC.red ?? LC.primary) : LC.textDim};">${intervalData.expired ? "Expired" : "Active"}</div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:${LC.text};">
        <span>${esc(countText)}</span>
        <span>${esc(deltaText)}</span>
      </div>
      ${(intervalData.notes ?? []).length ? `<div style="margin-top:3px;font-size:9px;color:${LC.textDim};">${esc(intervalData.notes.join(" - "))}</div>` : ""}
      ${intervalData.rapidAnalysis ? `<div style="margin-top:3px;font-size:9px;color:${LC.tertiary};">Rapid Analysis: Reduce Time costs 1 Momentum.</div>` : ""}
      ${intervalButton}
    </div>`;
  })() : "";
  const cardLabel = data.extraWorkOnly ? "Extra Work" : (data.passed ? "Success" : "No Work");
  const talentRows = (data.talentNotes ?? []).length
    ? `<div style="margin-top:6px;padding:5px 7px;border:1px solid ${LC.borderDim};background:rgba(0,0,0,0.16);">
        <div style="font-size:9px;color:${LC.tertiary};font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px;">Talent Effects</div>
        ${(data.talentNotes ?? []).map(t => `<div style="font-size:10px;color:${LC.text};line-height:1.35;"><span style="color:${LC.tertiary};font-weight:700;">${esc(t.name)}</span> - ${esc(t.text)}</div>`).join("")}
      </div>`
    : "";
  return `
<div class="sta2e-extended-task-result" data-theme="${theme}" data-template="${template}"
  style="${themeVars}background:${LC.bg};border:1px solid ${LC.secondary};border-radius:3px;font-family:${LC.font};color:${LC.text};max-width:560px;overflow:hidden;">
  <div style="background:${LC.secondary};color:${LC.bg};padding:6px 12px;display:flex;justify-content:space-between;gap:8px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">
    <span style="font-size:11px;">Extended Task Progress</span>
    <span style="font-size:10px;">${cardLabel}</span>
  </div>
  <div style="padding:9px 12px;">
    <div style="font-size:14px;font-weight:700;color:${LC.secondary};">${esc(after.actorName)}</div>
    <div style="font-size:10px;color:${LC.textDim};margin-top:2px;">${esc(data.taskName ?? "Task")} - ${esc(data.actorName ?? "")}</div>
    <div style="margin-top:8px;display:grid;grid-template-columns:repeat(4,1fr);gap:4px;">
      ${statChip(data.extraWorkOnly ? "Base" : "Impact", data.departmentScore, LC.tertiary)}
      ${statChip(data.extraWorkOnly ? "Cost" : "Resist", data.extraWorkOnly ? `${extraWorkCost}M` : data.resistance, LC.orange ?? LC.primary)}
      ${statChip(data.extraWorkOnly ? "Extra" : "Talent", data.extraWorkOnly ? data.momentumWork : data.talentImpact ?? 0, LC.secondary)}
      ${statChip("Applied", data.workApplied, data.workApplied > 0 ? LC.green ?? LC.secondary : LC.textDim)}
    </div>
    ${data.passed && data.pendingBonus ? `<div style="margin-top:5px;font-size:10px;color:${LC.tertiary};">Pending breakthrough bonus consumed: +${data.pendingBonus} Impact.</div>` : ""}
    ${data.passed && data.resistanceBefore > 0 && data.resistance === 0 ? `<div style="margin-top:5px;font-size:10px;color:${LC.secondary};">Resistance ${data.resistanceBefore} ignored.</div>` : ""}
    ${talentRows}
    <div style="margin-top:8px;height:11px;border:1px solid ${LC.borderDim};background:${LC.bg};">
      <div style="height:100%;width:${pct}%;background:${LC.secondary};"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:${LC.textDim};">
      <span>Progress ${data.before.workValue} -> ${after.workValue}/${after.workMax}</span>
      <span>Diff ${after.difficulty} - Resist ${after.resistance}</span>
    </div>
    <div style="margin-top:7px;display:flex;flex-direction:column;gap:2px;">
      ${breakthroughRows}
    </div>
    ${triggeredRows}
    ${intervalRows}
    ${after.nextImpactBonus ? `<div style="margin-top:6px;font-size:10px;color:${LC.tertiary};">Next successful task gains +${after.nextImpactBonus} Impact before Resistance.</div>` : ""}
    ${extraWorkButton}
  </div>
  <div style="height:3px;background:${LC.secondary};"></div>
</div>`;
}

function statChip(label, value, color) {
  return `
    <div style="text-align:center;border:1px solid ${LC.borderDim};background:rgba(0,0,0,0.25);padding:5px 4px;">
      <div style="font-size:8px;color:${LC.textDim};letter-spacing:0.08em;text-transform:uppercase;">${label}</div>
      <div style="font-size:16px;font-weight:700;color:${color};">${value}</div>
    </div>`;
}

export function wireTaskRequestCard(message, html) {
  const flags = message?.flags?.[MODULE] ?? {};
  if (flags.type === "extendedTaskResult") {
    wireExtendedTaskResultCard(message, html, flags);
    return;
  }
  if (flags.type !== "taskRequest") return;
  const taskData = flags.taskData;
  if (!taskData) return;
  html.querySelector(".sta2e-task-request-roll")?.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    launchTaskRoller(taskData);
  });
}

function wireExtendedTaskResultCard(message, html, flags) {
  html.querySelector(".sta2e-extended-interval-spend")?.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.style.opacity = "0.55";
    try {
      const progressData = flags.progressData ?? {};
      const intervalData = progressData.intervals ?? {};
      if (intervalData.reduceTimeKind !== "threat") {
        const cost = intervalData.mode === "variable"
          ? clampInt(intervalData.addIntervalCost, 1, 999, 2)
          : clampInt(intervalData.reduceTimeCost, 1, 999, 2);
        const tracker = readTrackerState(progressData.trackerMessageId ?? null, progressData.actorId ?? null);
        const available = (Number(tracker.float) || 0) + (Number(tracker.bonus) || 0) + (Number(readPool("momentum")) || 0);
        if (available < cost) {
          ui.notifications.warn("STA2e Toolkit: Not enough Momentum for interval spend.");
          btn.disabled = false;
          btn.style.opacity = "";
          return;
        }
      }
      const payload = {
        messageId: message.id,
        extendedTaskActorId: flags.extendedTaskActorId ?? btn.dataset.actorId ?? null,
        requesterUserId: game.user.id,
      };
      if (game.user.isGM) {
        await applyExtendedTaskIntervalSpend(payload);
      } else {
        game.socket.emit(`module.${MODULE}`, {
          action: "applyExtendedTaskIntervalSpend",
          ...payload,
        });
      }
    } catch (err) {
      console.error("STA2e Toolkit | interval spend failed:", err);
      ui.notifications.error("STA2e Toolkit: Interval spend failed - see console.");
      btn.disabled = false;
      btn.style.opacity = "";
    }
  });

  const exhaustBtn = html.querySelector(".sta2e-extended-interval-exhaust");
  if (exhaustBtn && !game.user.isGM) exhaustBtn.remove();
  exhaustBtn?.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    if (!game.user.isGM) {
      ui.notifications.warn("STA2e Toolkit: Only the GM can use up remaining time.");
      return;
    }
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.style.opacity = "0.55";
    try {
      await applyExtendedTaskIntervalExhaust({
        messageId: message.id,
        extendedTaskActorId: flags.extendedTaskActorId ?? btn.dataset.actorId ?? null,
        requesterUserId: game.user.id,
      });
    } catch (err) {
      console.error("STA2e Toolkit | interval exhaust failed:", err);
      ui.notifications.error("STA2e Toolkit: Could not use up remaining time - see console.");
      btn.disabled = false;
      btn.style.opacity = "";
    }
  });

  html.querySelector(".sta2e-extended-extra-work")?.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.style.opacity = "0.55";
    try {
      const progressData = flags.progressData ?? {};
      const tracker = readTrackerState(progressData.trackerMessageId ?? null, progressData.actorId ?? null);
      const available = (Number(tracker.float) || 0) + (Number(tracker.bonus) || 0) + (Number(readPool("momentum")) || 0);
      const cost = clampInt(progressData.extraWorkCost, 1, 2, 2);
      if (available < cost) {
        ui.notifications.warn("STA2e Toolkit: Not enough Momentum for extra work.");
        btn.disabled = false;
        btn.style.opacity = "";
        return;
      }
      const payload = {
        messageId: message.id,
        extendedTaskActorId: flags.extendedTaskActorId ?? btn.dataset.actorId ?? null,
        requesterUserId: game.user.id,
      };
      if (game.user.isGM) {
        await applyExtendedTaskExtraWork(payload);
      } else {
        game.socket.emit(`module.${MODULE}`, {
          action: "applyExtendedTaskExtraWork",
          ...payload,
        });
      }
    } catch (err) {
      console.error("STA2e Toolkit | extra work spend failed:", err);
      ui.notifications.error("STA2e Toolkit: Extra work failed - see console.");
      btn.disabled = false;
      btn.style.opacity = "";
    }
  });
}

function launchTaskRoller(taskData) {
  const actor = game.actors.get(taskData.actorId);
  if (!actor) {
    ui.notifications.error("STA2e Toolkit: Task actor not found.");
    return;
  }
  const canUse = game.user.isGM || actor.testUserPermission?.(game.user, "OWNER") || actor.isOwner;
  if (!canUse) {
    ui.notifications.warn(`STA2e Toolkit: Only ${actor.name}'s owner or the GM can open this task.`);
    return;
  }
  const token = taskData.tokenId
    ? canvas.tokens?.get(taskData.tokenId) ?? null
    : actor.getActiveTokens?.(true)?.[0] ?? canvas.tokens?.placeables.find(t => t.actor?.id === actor.id) ?? null;
  const stats = readOfficerStats(actor);
  const ships = orderedShipsForActor(actor, taskData.shipActorId);
  const serializedShips = serializeShipsForRoller(ships);
  const selectedShipIdx = taskData.shipAssist && taskData.shipActorId
    ? serializedShips.findIndex(s => s.actorId === taskData.shipActorId)
    : -1;
  const isPlayerOwned = actor.hasPlayerOwner || actor.testUserPermission?.(game.user, "OWNER") || actor.isOwner;
  const extendedActor = taskData.mode === "extended" && taskData.extendedTask?.actorId
    ? game.actors.get(taskData.extendedTask.actorId)
    : null;
  const liveExtended = extendedActor ? extendedProgressSnapshot(extendedActor) : null;
  if (liveExtended) {
    taskData = {
      ...taskData,
      difficulty: liveExtended.difficulty,
      extendedTask: {
        ...taskData.extendedTask,
        ...liveExtended,
      },
    };
  }
  openNpcRoller(actor, token, {
    playerMode: isPlayerOwned,
    groundMode: serializedShips.length === 0,
    groundIsNpc: !isPlayerOwned,
    usesPlayerPayment: isPlayerOwned ? true : undefined,
    crewQuality: null,
    officer: stats ?? undefined,
    defaultAttr: taskData.attrKey,
    defaultDisc: taskData.discKey,
    sheetMode: true,
    availableShips: serializedShips,
    shipAssist: !!taskData.shipAssist,
    selectedShipIdx: selectedShipIdx >= 0 ? selectedShipIdx : -1,
    shipSystemKey: taskData.shipSystemKey ?? undefined,
    shipDeptKey: taskData.shipDeptKey ?? undefined,
    difficulty: taskData.difficulty,
    complicationRange: taskData.complicationRange,
    taskLabel: taskData.taskName,
    taskContext: taskData.mode === "extended" && taskData.extendedTask
      ? `${taskData.flavor || "Extended Task"} - ${taskData.extendedTask.actorName} (${taskData.extendedTask.workValue}/${taskData.extendedTask.workMax} Work, Resistance ${taskData.extendedTask.resistance})`
      : taskData.flavor || "Task Maker",
    taskCallback: taskData.mode === "extended"
      ? result => handleExtendedTaskRollResult(taskData, result)
      : null,
    extendedTaskContext: taskData.mode === "extended"
      ? {
        actorId: taskData.extendedTask?.actorId ?? null,
        mode: taskData.extendedTask?.intervals?.mode ?? null,
        intervals: taskData.extendedTask?.intervals ?? null,
      }
      : null,
    initialTraitSelectedIds: selectedTraitIdsForRoller(taskData.traits),
    initialTraitDifficultyDirections: traitDifficultyDirectionsForRoller(taskData.traits),
  });
}
