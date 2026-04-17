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

import { getLcTokens } from "./lcars-theme.js";
import { openNpcRoller, openPlayerRoller } from "./npc-roller.js";
import { readOfficerStats } from "./crew-manifest.js";
import { CombatHUD } from "./combat-hud.js";

const MODULE = "sta2e-toolkit";

// ── LCARS tokens — resolved at render time per active campaign theme ─────
const LC = new Proxy({}, {
  get(_, prop) { return getLcTokens()[prop]; },
});

function _getOpposedThemeKey() {
  try {
    const store = game?.sta2eToolkit?.campaignStore;
    const campaign = store?.getActiveCampaign?.();
    if (campaign?.theme) return campaign.theme;
    return game.settings.get(MODULE, "hudTheme") ?? "lcars-tng";
  } catch {
    return "lcars-tng";
  }
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
    },
  };

  const html = _buildDialogHtml(state, { recent, lastSnap });

  const dialog = new foundry.applications.api.DialogV2({
    window: { title: "STA 2e · Opposed Task", resizable: true },
    position: { width: 520 },
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
  const attrOpts = (selectedKey) => ATTR_OPTIONS.map(a =>
    `<option value="${a.key}" ${selectedKey === a.key ? "selected" : ""}>${a.label}</option>`).join("");
  const discOpts = (selectedKey) => DISC_OPTIONS.map(d =>
    `<option value="${d.key}" ${selectedKey === d.key ? "selected" : ""}>${d.label}</option>`).join("");
  const defCompRange = Number(state.options?.defenderComplicationRange ?? 1);
  const atkCompRange = Number(state.options?.attackerComplicationRange ?? 1);
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
    <div class="sta2e-opposed-setup" data-theme="${theme}" style="
      --op-bg:${LC.bg};--op-panel:${LC.panel};--op-primary:${LC.primary};--op-secondary:${LC.secondary};
      --op-tertiary:${LC.tertiary};--op-text:${LC.text};--op-text-dim:${LC.textDim};--op-border:${LC.border};
      --op-border-dim:${LC.borderDim};--op-font:${LC.font};
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
            Opposed Task Setup
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

      <div style="display:block;">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${LC.textDim};">
          Task Name
          <input type="text" class="op-task-name" value="${_esc(state.taskName)}"
            style="width:100%;background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};padding:8px 10px;border-radius:12px 3px 12px 3px;font-size:13px;"/>
        </label>
      </div>

      <label style="display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${LC.textDim};">
        Flavor
        <input type="text" class="op-flavor" value="${_esc(state.flavor)}"
          style="width:100%;background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};padding:8px 10px;border-radius:12px 3px 12px 3px;font-size:12px;"/>
      </label>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:start;">
        ${_complicationSliderHtml("defender", "Defender", defCompRange, LC.primary)}
        ${_complicationSliderHtml("attacker", "Attacker", atkCompRange, LC.secondary)}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
        ${_slotHtml("defender", "Defender", state.defenderActorId)}
        ${_slotHtml("attacker", "Attacker", state.attackerActorId)}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${_sideSuggestionHtml("defender", "Defender", state.defenderSuggestedAttr, state.defenderSuggestedDisc)}
        ${_sideSuggestionHtml("attacker", "Attacker", state.attackerSuggestedAttr, state.attackerSuggestedDisc)}
      </div>
    </div>
  `;

  function _sideSuggestionHtml(sideKey, label, attrKey, discKey) {
    const accent = sideKey === "defender" ? LC.primary : LC.secondary;
    return `
      <div style="border:1px solid ${LC.border};background:${LC.panel};padding:8px;border-radius:16px 3px 16px 3px;">
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
      <div style="border:1px solid ${LC.border};background:${LC.panel};padding:8px;border-radius:16px 3px 16px 3px;">
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
      ...(opts.options ?? {}),
    },
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

  const defSuccessesText = defRolled
    ? `<span style="color:${primary};font-weight:600;">${d.defender.successes} success${d.defender.successes === 1 ? "" : "es"}</span>`
    : `<span style="color:${textDim};">awaiting roll…</span>`;
  const defComplicationsText = defRolled && (d.defender.complications ?? 0) > 0
    ? `<div style="margin-top:2px;font-size:10px;color:${LC.red};">${d.defender.complications} complication${d.defender.complications === 1 ? "" : "s"}</div>`
    : "";

  const atkSuccessesText = atkRolled
    ? `<span style="color:${secondary};font-weight:600;">${d.attacker.successes} success${d.attacker.successes === 1 ? "" : "es"}</span>`
    : canRollAtk
      ? `<span style="color:${textDim};">ready to roll</span>`
      : `<span style="color:${textDim};">locked — waiting on defender</span>`;
  const atkComplicationsText = atkRolled && (d.attacker.complications ?? 0) > 0
    ? `<div style="margin-top:2px;font-size:10px;color:${LC.red};">${d.attacker.complications} complication${d.attacker.complications === 1 ? "" : "s"}</div>`
    : "";

  // Resolution: attacker must meet or beat defender successes
  let resolutionBlock = "";
  if (resolved) {
    const target = d.defender.successes;
    const diff = d.attacker.successes - target;
    const passed = d.attacker.successes >= target;
    const rewardSide = passed ? "attacker" : "defender";
    const rewardAmount = Math.abs(diff);
    const verdict = passed
      ? `<span style="color:#44cc66;font-weight:700;">✓ ATTACKER WINS</span> · margin +${diff}`
      : `<span style="color:#cc4444;font-weight:700;">✗ DEFENDER HOLDS</span> · shortfall ${diff}`;
    const comps = (d.defender.complications ?? 0) + (d.attacker.complications ?? 0);
    const compNote = comps > 0
      ? `<div style="color:#cc8844;font-size:10px;margin-top:2px;">⚠ ${comps} complication${comps === 1 ? "" : "s"} in play</div>`
      : "";
    resolutionBlock = `
      <div class="sta2e-opposed-resolution" style="margin-top:6px;padding:6px 10px;background:${panel};">
        <div style="font-size:10px;letter-spacing:0.12em;color:${textDim};text-transform:uppercase;">Resolution</div>
        <div style="margin-top:2px;">${verdict}</div>
        <div style="color:${textDim};font-size:11px;">
          Target: ${target} · Attacker: ${d.attacker.successes}
        </div>
        ${compNote}
        ${_renderOpposedPoolReward(d, rewardSide, rewardAmount)}
      </div>`;
  }

  const blindNote = d.options?.blindDefender && defRolled && !atkRolled
    ? `<div style="font-size:10px;color:${textDim};margin-top:2px;">🔒 Blind: defender successes shown to GM only.</div>`
    : "";

  // Hide defender's successes publicly if blind is on and attacker hasn't rolled yet
  const showDefToAll = !(d.options?.blindDefender && defRolled && !atkRolled);
  const defLineText = showDefToAll ? defSuccessesText : `<span style="color:${textDim};">hidden</span>`;
  const defCompLineText = showDefToAll ? defComplicationsText : "";
  const atkLineText = atkSuccessesText;
  const atkCompLineText = atkComplicationsText;

  const defBtn = !defRolled
    ? `<button type="button" class="sta2e-op-roll" data-side="defender" data-task-id="${d.taskId}"
        style="--op-button-accent:${primary};flex:1;padding:6px;background:${panel};border:1px solid ${primary};color:${primary};font-family:${font};letter-spacing:0.08em;cursor:pointer;">
        Roll Defender
      </button>`
    : `<div style="flex:1;padding:6px;background:${panel};border:1px solid ${border};color:${textDim};text-align:center;">Defender rolled</div>`;

  const atkBtn = canRollAtk
    ? `<button type="button" class="sta2e-op-roll" data-side="attacker" data-task-id="${d.taskId}"
        style="--op-button-accent:${secondary};flex:1;padding:6px;background:${panel};border:1px solid ${secondary};color:${secondary};font-family:${font};letter-spacing:0.08em;cursor:pointer;">
        Roll Attacker
      </button>`
    : atkRolled
      ? `<div style="flex:1;padding:6px;background:${panel};border:1px solid ${border};color:${textDim};text-align:center;">Attacker rolled</div>`
      : `<button type="button" disabled
          style="flex:1;padding:6px;background:${panel};border:1px solid ${border};color:${textDim};font-family:${font};letter-spacing:0.08em;cursor:not-allowed;opacity:0.5;">
          Waiting on Defender...
        </button>`;

  const gmCancel = !resolved
    ? `<button type="button" class="sta2e-op-cancel" data-task-id="${d.taskId}"
        style="--op-button-accent:${LC.red};margin-left:6px;padding:6px 10px;background:${panel};border:1px solid ${border};color:${textDim};font-family:${font};cursor:pointer;font-size:11px;"
        title="GM only — cancel this opposed task">
        ✕
      </button>`
    : "";

  const flavorBlock = d.flavor
    ? `<div style="padding:6px 10px;color:${textDim};font-style:italic;font-size:11px;">${_esc(d.flavor)}</div>`
    : "";

  return `
<div class="sta2e-opposed-task" data-task-id="${d.taskId}" data-theme="${theme}"
  style="--op-bg:${LC.bg};--op-panel:${LC.panel};--op-primary:${LC.primary};--op-secondary:${LC.secondary};--op-tertiary:${LC.tertiary};--op-text:${LC.text};--op-text-dim:${LC.textDim};--op-border:${LC.border};--op-border-dim:${LC.borderDim};--op-font:${LC.font};background:${LC.bg};
    border:1px solid ${border};border-left:6px solid ${primary};border-radius:0 0 18px 4px;font-family:${font};color:${LC.text};max-width:480px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.03), 0 10px 24px rgba(0,0,0,0.3);">
  <div class="sta2e-opposed-card-header" style="background:${primary};color:${LC.bg};padding:6px 10px;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:11px;letter-spacing:0.14em;font-weight:700;text-transform:uppercase;">
      ${d.kindIcon} Opposed Task
    </div>
    <div style="font-size:10px;letter-spacing:0.1em;opacity:0.85;">
      Social Contest
    </div>
  </div>

  <div class="sta2e-opposed-card-summary" style="padding:8px 10px;">
    <div style="font-size:13px;font-weight:600;">${_esc(d.taskName)}</div>
    ${flavorBlock ? flavorBlock : ""}
  </div>

  <div class="sta2e-opposed-card-sides" style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid ${border};border-bottom:1px solid ${border};">
    <div class="sta2e-opposed-card-side sta2e-opposed-card-side-defender" style="padding:8px 10px;border-right:1px solid ${border};">
      <div style="display:flex;gap:6px;align-items:center;">
        <img src="${d.defender.actorImg}" style="width:28px;height:28px;border:1px solid ${border};"/>
        <div style="flex:1;">
          <div style="font-size:10px;color:${textDim};letter-spacing:0.1em;text-transform:uppercase;">Defender</div>
          <div style="font-weight:600;">${_esc(d.defender.actorName)}</div>
          <div style="margin-top:2px;font-size:10px;color:${primary};letter-spacing:0.08em;text-transform:uppercase;">${defAttrLabel} + ${defDiscLabel}</div>
          <div style="margin-top:2px;font-size:9px;color:${textDim};letter-spacing:0.06em;text-transform:uppercase;">${defCompRangeText}</div>
        </div>
      </div>
      <div style="margin-top:4px;font-size:11px;">${defLineText}</div>
      ${defCompLineText}
    </div>
    <div class="sta2e-opposed-card-side sta2e-opposed-card-side-attacker" style="padding:8px 10px;">
      <div style="display:flex;gap:6px;align-items:center;">
        <img src="${d.attacker.actorImg}" style="width:28px;height:28px;border:1px solid ${border};"/>
        <div style="flex:1;">
          <div style="font-size:10px;color:${textDim};letter-spacing:0.1em;text-transform:uppercase;">Attacker</div>
          <div style="font-weight:600;">${_esc(d.attacker.actorName)}</div>
          <div style="margin-top:2px;font-size:10px;color:${secondary};letter-spacing:0.08em;text-transform:uppercase;">${atkAttrLabel} + ${atkDiscLabel}</div>
          <div style="margin-top:2px;font-size:9px;color:${textDim};letter-spacing:0.06em;text-transform:uppercase;">${atkCompRangeText}</div>
        </div>
      </div>
      <div style="margin-top:4px;font-size:11px;">${atkLineText}</div>
      ${atkCompLineText}
    </div>
  </div>

  ${resolutionBlock}

  ${!resolved ? `
    <div class="sta2e-opposed-card-actions" style="padding:8px 10px;display:flex;gap:6px;align-items:center;">
      ${defBtn}
      ${atkBtn}
      ${gmCancel}
    </div>
    ${blindNote}
  ` : ""}

  <div class="sta2e-opposed-card-footerbar" style="height:3px;background:${primary};"></div>
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

  // Hide the GM cancel button for non-GM users
  if (!game.user.isGM) {
    html.querySelectorAll(".sta2e-op-cancel").forEach(b => b.remove());
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
  const token = actor.getActiveTokens(true)[0]?.document
    ?? canvas.tokens?.placeables.find(t => t.actor?.id === actor.id)?.document
    ?? null;

  const profile = _getOpposedActorProfile(actor, token);
  // Defender rolls at difficulty 0 (free roll to set the bar);
  // attacker must meet or beat defender's successes.
  const difficulty = side === "defender"
    ? 0
    : (taskData.defender.successes ?? 0);

  const stats = readOfficerStats(actor);
  const sideData = side === "defender" ? taskData.defender : taskData.attacker;
  const suggestedAttr = sideData?.suggestedAttr ?? taskData.suggestedAttr ?? null;
  const suggestedDisc = sideData?.suggestedDisc ?? taskData.suggestedDisc ?? null;
  const complicationRange = side === "defender"
    ? (taskData.options?.defenderComplicationRange ?? taskData.options?.complicationRange ?? 1)
    : (taskData.options?.attackerComplicationRange ?? taskData.options?.complicationRange ?? 1);
  const hasAttr = stats && Object.keys(stats.attributes ?? {}).includes(suggestedAttr);
  const hasDisc = stats && Object.keys(stats.disciplines ?? {}).includes(suggestedDisc);

  const rollerOpts = {
    difficulty,
    complicationRange,
    noPoolButton: true,
    taskLabel:   `${taskData.kindIcon} ${taskData.taskName}`,
    taskContext: side === "defender"
      ? `Opposed — Defender (${taskData.kindLabel})`
      : `Opposed — Attacker vs ${taskData.defender.successes} success${taskData.defender.successes === 1 ? "" : "es"}`,
    defaultAttr: hasAttr ? suggestedAttr : null,
    defaultDisc: hasDisc ? suggestedDisc : null,
    taskCallback: async ({ successes, complications: reportedComplications = null, state }) => {
      // Count complications across the primary pools (crew + assists + ship)
      const allDice = [
        ...(state?.crewDice ?? []),
        ...(state?.crewAssistDice ?? []),
        ...(state?.namedAssistDice ?? []),
        ...(state?.apAssistDice ?? []),
        ...(state?.shipDice ?? []),
      ];
      const complications = reportedComplications ?? allDice.filter(d => d?.complication).length;

      if (game.user.isGM) {
        await applyOpposedRollResult({
          messageId: message.id,
          taskId:    taskData.taskId,
          side,
          successes,
          complications,
        });
      } else {
        game.socket.emit("module.sta2e-toolkit", {
          action:    "opposedTaskRollComplete",
          messageId: message.id,
          taskId:    taskData.taskId,
          side,
          successes,
          complications,
        });
      }
    },
  };

  if (profile.isShip) {
    const launcher = profile.isPlayerOwned ? openPlayerRoller : openNpcRoller;
    launcher(actor, token, rollerOpts);
    return;
  }

  openNpcRoller(actor, token, {
    ...rollerOpts,
    playerMode: profile.isPlayerOwned,
    groundMode: true,
    groundIsNpc: !profile.isPlayerOwned,
    officer: stats ?? undefined,
  });
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
export async function applyOpposedRollResult({ messageId, taskId, side, successes, complications }) {
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

  // Status transitions
  if (side === "defender") taskData.status = "awaiting-attacker";
  if (side === "attacker") taskData.status = "resolved";

  const newContent = _renderCardHtml(taskData);
  const updatedFlags = {
    ...(message.flags?.[MODULE] ?? {}),
    taskData,
  };

  if (side === "attacker") {
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










