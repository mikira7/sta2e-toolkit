/**
 * sta2e-toolkit | opposed-panel.js
 *
 * The Opposed Task setup UI, as an embeddable panel inside the Task Maker
 * dialog (its "Opposed Task" tab).  Previously this lived in opposed-task.js
 * as a standalone DialogV2.
 *
 * IMPORTANT — this module must only ever import ./lcars-theme.js.
 * opposed-task.js pulls in combat-hud.js, which reaches combat-hud-core.js,
 * which imports task-maker.js.  Importing opposed-task.js from here (or from
 * task-maker.js) would close that loop into a real cycle, and main.js
 * evaluates opposed-task.js first, so task-maker.js would see a
 * half-initialised namespace.  Keeping this module dependency-free breaks it.
 *
 * The panel keeps the original `.op-*` class names so the resolution side of
 * opposed-task.js (and anything reading the posted card) is unaffected, but it
 * is styled with the Task Maker's shared inline builders rather than the
 * `.sta2e-opposed-setup` rules in styles/opposed-task.css — those are written
 * for a full dialog root (min-height 700px, huge padding, absolute LCARS
 * elbows) and would draw a second frame inside the Task Maker's own.
 */

import { getLcTokens, inputStyle, labelStyle, pillStyle, selectStyle } from "./lcars-theme.js";

// Resolved at render time — the active campaign's theme can change between renders.
const LC = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });

// Attribute / Discipline option tables — keys match sta system data paths
// (actor.system.attributes.<key>.value etc).
export const ATTR_OPTIONS = [
  { key: "control",    label: "Control" },
  { key: "daring",     label: "Daring" },
  { key: "fitness",    label: "Fitness" },
  { key: "insight",    label: "Insight" },
  { key: "presence",   label: "Presence" },
  { key: "reason",     label: "Reason" },
];
export const DISC_OPTIONS = [
  { key: "command",     label: "Command" },
  { key: "conn",        label: "Conn" },
  { key: "engineering", label: "Engineering" },
  { key: "medicine",    label: "Medicine" },
  { key: "science",     label: "Science" },
  { key: "security",    label: "Security" },
];

export const DEFAULT_KIND = { key: "social", label: "Social", icon: "Social" };

// Single source for slot headings — the old code built them as "Defender" but
// rebuilt them as "🛡 Defender" on assignment, so the heading silently changed.
const SLOT_TITLES = { defender: "Defender", attacker: "Attacker" };

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

export function normalizeTraitModifier(source = {}) {
  const mode = ["increase", "reduce"].includes(source?.traitModifierMode)
    ? source.traitModifierMode
    : "none";
  return {
    traitModifierMode: mode,
    traitModifierPotency: clampInt(source?.traitModifierPotency, 1, 5, 1),
    traitModifierName: String(source?.traitModifierName ?? "").trim(),
  };
}

function complicationDesc(n) {
  return n <= 1 ? "Complications on: 20" : `Complications on: ${21 - n}-20`;
}

function recentOpposedTasks() {
  return game.sta2eToolkit?.campaignStore?.getRecentOpposedTasks?.() ?? [];
}

// ─────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the opposed sub-state.  taskName/flavor deliberately live on the
 * outer Task Maker state — they are shared across all three tabs.
 */
export function defaultOpposedState(prefill = {}) {
  return {
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
      ...normalizeTraitModifier(prefill.options ?? prefill),
    },
  };
}

/** Harvest the panel's DOM into `state.opposed`. */
export function readOpposedPanelState(root, state) {
  const opposed = state.opposed ?? (state.opposed = defaultOpposedState());
  if (!root?.querySelector(".tmk-opposed-panel")) return;
  // `kind` has no control in the panel; preserve whatever the prefill supplied
  // (/opposed skill|stealth|custom) rather than resetting it to the default.
  opposed.defenderSuggestedAttr = root.querySelector(".op-defender-attr")?.value ?? opposed.defenderSuggestedAttr;
  opposed.defenderSuggestedDisc = root.querySelector(".op-defender-disc")?.value ?? opposed.defenderSuggestedDisc;
  opposed.attackerSuggestedAttr = root.querySelector(".op-attacker-attr")?.value ?? opposed.attackerSuggestedAttr;
  opposed.attackerSuggestedDisc = root.querySelector(".op-attacker-disc")?.value ?? opposed.attackerSuggestedDisc;
  opposed.options = {
    defenderComplicationRange: clampInt(root.querySelector(".op-defender-complication-range")?.value, 1, 5, 1),
    attackerComplicationRange: clampInt(root.querySelector(".op-attacker-complication-range")?.value, 1, 5, 1),
    ...normalizeTraitModifier({
      traitModifierMode: root.querySelector(".op-trait-mode")?.value ?? "none",
      traitModifierPotency: root.querySelector(".op-trait-potency")?.value ?? 1,
      traitModifierName: root.querySelector(".op-trait-name")?.value ?? "",
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Panel HTML
// ─────────────────────────────────────────────────────────────────────────

export function buildOpposedPanelHtml(state) {
  const opposed = state.opposed ?? defaultOpposedState();
  const recent = recentOpposedTasks();
  const lastSnap = recent[0] ?? null;
  const defComp = clampInt(opposed.options?.defenderComplicationRange, 1, 5, 1);
  const atkComp = clampInt(opposed.options?.attackerComplicationRange, 1, 5, 1);
  const traitMod = normalizeTraitModifier(opposed.options ?? {});

  const recentOpts = recent.map((snap, i) => {
    const defName = game.actors.get(snap.defenderActorId ?? snap.responderActorId)?.name ?? "?";
    const atkName = game.actors.get(snap.attackerActorId ?? snap.initiatorActorId)?.name ?? "?";
    return `<option value="${i}">${esc(snap.taskName ?? "Opposed Task")} - ${esc(defName)} vs ${esc(atkName)}</option>`;
  }).join("");

  return `
    <div class="tmk-opposed-panel" style="display:${state.mode === "opposed" ? "flex" : "none"};flex-direction:column;gap:10px;">

      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <button type="button" class="op-reuse-last" ${lastSnap ? "" : "disabled"}
          style="${pillStyle(LC.primary)}flex:0 0 auto;padding:5px 10px;">Reuse Last</button>
        <select class="op-recent" ${recent.length ? "" : "disabled"} style="${selectStyle("padding:5px 10px;border-radius:999px;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;")}">
          <option value="">Recent</option>
          ${recentOpts}
        </select>
        <button type="button" class="op-clear-recent" ${recent.length ? "" : "disabled"}
          style="${pillStyle(LC.secondary)}flex:0 0 auto;padding:5px 10px;">Clear Recent</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:start;">
        ${complicationSliderHtml("defender", "Defender", defComp, LC.primary)}
        ${complicationSliderHtml("attacker", "Attacker", atkComp, LC.secondary)}
      </div>

      <div class="op-trait-panel" style="border:1px solid ${LC.border};background:${LC.panel};padding:8px;border-radius:16px 3px 16px 3px;display:grid;grid-template-columns:minmax(0,1.3fr) 90px minmax(0,1.4fr);gap:8px;align-items:end;">
        <label style="${labelStyle()}">Trait Effect
          <select class="op-trait-mode" style="${selectStyle()}">
            <option value="none" ${traitMod.traitModifierMode === "none" ? "selected" : ""}>No trait modifier</option>
            <option value="increase" ${traitMod.traitModifierMode === "increase" ? "selected" : ""}>Increase attacker Difficulty</option>
            <option value="reduce" ${traitMod.traitModifierMode === "reduce" ? "selected" : ""}>Reduce attacker Difficulty</option>
          </select>
        </label>
        <label style="${labelStyle()}">Potency
          <input type="number" min="1" max="5" class="op-trait-potency" value="${traitMod.traitModifierPotency}"
            style="${inputStyle(`text-align:center;font-weight:700;color:${LC.tertiary};`)}"/>
        </label>
        <label style="${labelStyle()}">Trait Name / Reason
          <input type="text" class="op-trait-name" value="${esc(traitMod.traitModifierName)}" style="${inputStyle()}"/>
        </label>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${buildOpposedSlotHtml("defender", opposed.defenderActorId)}
        ${buildOpposedSlotHtml("attacker", opposed.attackerActorId)}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${sideSuggestionHtml("defender", opposed.defenderSuggestedAttr, opposed.defenderSuggestedDisc)}
        ${sideSuggestionHtml("attacker", opposed.attackerSuggestedAttr, opposed.attackerSuggestedDisc)}
      </div>
    </div>
  `;
}

function complicationSliderHtml(sideKey, label, value, accent) {
  return `
    <div style="border:1px solid ${LC.border};background:${LC.panel};padding:8px;border-radius:16px 3px 16px 3px;">
      <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};margin-bottom:6px;font-weight:700;">
        ${label} Complication Range
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <input type="range" min="1" max="5" value="${value}" class="op-${sideKey}-complication-range"
          style="flex:1;accent-color:${accent};cursor:pointer;"/>
        <span class="op-${sideKey}-complication-range-val" style="min-width:16px;text-align:right;font-size:12px;font-weight:700;color:${accent};">${value}</span>
      </div>
      <div class="op-${sideKey}-complication-desc" style="margin-top:4px;font-size:10px;color:${LC.textDim};">
        ${complicationDesc(value)}
      </div>
    </div>
  `;
}

function sideSuggestionHtml(sideKey, attrKey, discKey) {
  const accent = sideKey === "defender" ? LC.primary : LC.secondary;
  const attrOpts = ATTR_OPTIONS.map(a => `<option value="${a.key}" ${a.key === attrKey ? "selected" : ""}>${a.label}</option>`).join("");
  const discOpts = DISC_OPTIONS.map(d => `<option value="${d.key}" ${d.key === discKey ? "selected" : ""}>${d.label}</option>`).join("");
  return `
    <div style="border:1px solid ${LC.border};background:${LC.panel};padding:8px;border-radius:16px 3px 16px 3px;">
      <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};margin-bottom:6px;font-weight:700;">
        ${SLOT_TITLES[sideKey]} Roll Pair
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <label style="${labelStyle()}">Attribute<select class="op-${sideKey}-attr" style="${selectStyle()}">${attrOpts}</select></label>
        <label style="${labelStyle()}">Discipline<select class="op-${sideKey}-disc" style="${selectStyle()}">${discOpts}</select></label>
      </div>
    </div>
  `;
}

export function buildOpposedSlotHtml(slotKey, actorId) {
  const actor = actorId ? game.actors.get(actorId) : null;
  const accent = slotKey === "defender" ? LC.primary : LC.secondary;
  return `
    <div class="op-slot" data-slot="${slotKey}" data-actor-id="${actorId ?? ""}"
      style="border:1px solid ${LC.border};background:${LC.panel};padding:8px;border-radius:16px 3px 16px 3px;min-height:104px;">
      <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};margin-bottom:6px;font-weight:700;">
        ${SLOT_TITLES[slotKey]}
      </div>
      <div class="op-slot-body">
        ${actor ? `
          <div style="display:flex;gap:8px;align-items:center;">
            <img src="${esc(actor.img ?? "icons/svg/mystery-man.svg")}" style="width:34px;height:34px;border:1px solid ${LC.border};border-radius:8px 2px 8px 2px;object-fit:cover;"/>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(actor.name)}</div>
              <div style="font-size:10px;color:${LC.textDim};">${esc(opposedActorKindLabel(actor))}</div>
            </div>
            <button type="button" class="op-slot-clear" title="Clear" style="background:transparent;border:none;color:${LC.textDim};cursor:pointer;font-size:14px;">X</button>
          </div>` : `
          <div style="color:${LC.textDim};font-size:11px;line-height:1.5;padding:8px 2px 4px;">Drag an actor or token here</div>`}
      </div>
      <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap;">
        <button type="button" class="op-slot-pick" data-source="selected" style="${pillStyle(LC.primary)}">Selected</button>
        <button type="button" class="op-slot-pick" data-source="targeted" style="${pillStyle(LC.secondary)}">Targeted</button>
        <button type="button" class="op-slot-pick" data-source="list" style="${pillStyle(LC.tertiary)}">List...</button>
      </div>
    </div>
  `;
}

/**
 * Decorative slot label.  This is deliberately the dependency-free version of
 * opposed-task.js's _getOpposedActorProfile — routing through CombatHUD is the
 * only thing that would drag combat-hud.js into this module.
 */
function opposedActorKindLabel(actor) {
  if (!actor) return "";
  const isShip = actor.type === "starship" || actor.type === "spacecraft2e"
    || actor.items?.some(i => i.type === "starshipweapon2e");
  if (isShip) return "Ship";

  if (actor.hasPlayerOwner) {
    const owners = game.users.filter(u => !u.isGM && actor.testUserPermission?.(u, "OWNER")).map(u => u.name);
    return owners.length ? `Player: ${owners.join(", ")}` : "Player / Support";
  }

  const npcTier = `${actor.system?.npcType ?? "minor"}`;
  return `${npcTier[0].toUpperCase()}${npcTier.slice(1)} NPC`;
}

// ─────────────────────────────────────────────────────────────────────────
// Wiring
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire the panel's controls.
 *
 * @param {HTMLElement} root  The *dialog* element, not the panel.  Task Maker's
 *   rerenderDialog() replaces `.sta2e-task-maker` wholesale via outerHTML, so
 *   anything holding a reference to a child of it goes stale silently.
 * @param {object} state      The full Task Maker state (opposed sub-state at .opposed).
 * @param {object} hooks      { readState, rerender } supplied by task-maker.js so
 *   restoring a snapshot can round-trip through a full re-render instead of
 *   poking two dozen inputs by hand.
 */
export function wireOpposedPanel(root, state, hooks = {}) {
  if (!root?.querySelector(".tmk-opposed-panel")) return;

  for (const side of ["defender", "attacker"]) {
    root.querySelector(`.op-${side}-complication-range`)?.addEventListener("input", event => {
      const n = clampInt(event.target.value, 1, 5, 1);
      const key = `${side}ComplicationRange`;
      state.opposed.options = { ...(state.opposed.options ?? {}), [key]: n };
      const val = root.querySelector(`.op-${side}-complication-range-val`);
      const desc = root.querySelector(`.op-${side}-complication-desc`);
      if (val) val.textContent = String(n);
      if (desc) desc.textContent = complicationDesc(n);
    });
  }

  root.querySelector(".op-reuse-last")?.addEventListener("click", () => {
    const snap = recentOpposedTasks()[0];
    if (snap) applyOpposedSnapshot(root, state, snap, hooks);
  });

  root.querySelector(".op-recent")?.addEventListener("change", event => {
    const idx = Number.parseInt(event.target.value, 10);
    event.target.value = "";
    if (!Number.isFinite(idx)) return;
    // Re-read at click time rather than closing over a list captured at build time.
    const snap = recentOpposedTasks()[idx];
    if (snap) applyOpposedSnapshot(root, state, snap, hooks);
  });

  root.querySelector(".op-clear-recent")?.addEventListener("click", async event => {
    const clearBtn = event.currentTarget;
    clearBtn.disabled = true;
    try {
      await game.sta2eToolkit?.campaignStore?.clearRecentOpposedTasks?.();
      const recentSel = root.querySelector(".op-recent");
      if (recentSel) {
        recentSel.innerHTML = `<option value="">Recent</option>`;
        recentSel.value = "";
        recentSel.disabled = true;
      }
      const reuseBtn = root.querySelector(".op-reuse-last");
      if (reuseBtn) reuseBtn.disabled = true;
      clearBtn.textContent = "Recent Cleared";
    } catch (err) {
      console.error("STA2e Toolkit | clear recent opposed tasks failed:", err);
      clearBtn.disabled = false;
    }
  });

  root.querySelectorAll(".op-slot").forEach(slotEl => wireOpposedSlot(root, state, slotEl));
}

function applyOpposedSnapshot(root, state, snap, hooks = {}) {
  // Harvest first so the Normal/Extended tabs' in-progress edits survive the rerender.
  hooks.readState?.(root, state);
  state.opposed = defaultOpposedState(snap);
  if (snap.taskName) state.taskName = snap.taskName;
  if (snap.flavor) state.flavor = snap.flavor;
  hooks.rerender?.(root, state);
}

function wireOpposedSlot(root, state, slotEl) {
  if (!slotEl) return;
  slotEl.addEventListener("dragover", event => {
    event.preventDefault();
    slotEl.style.borderColor = LC.primary;
  });
  slotEl.addEventListener("dragleave", () => { slotEl.style.borderColor = LC.border; });
  slotEl.addEventListener("drop", async event => {
    event.preventDefault();
    slotEl.style.borderColor = LC.border;
    const actor = await resolveDroppedActor(event);
    if (!actor) {
      ui.notifications.warn("STA2e Toolkit: Drop an Actor or a Token.");
      return;
    }
    assignOpposedSlot(root, state, slotEl.dataset.slot, actor.id);
  });
  slotEl.querySelector(".op-slot-clear")?.addEventListener("click", () => {
    assignOpposedSlot(root, state, slotEl.dataset.slot, null);
  });
  slotEl.querySelectorAll(".op-slot-pick").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = await pickOpposedActor(btn.dataset.source);
      if (id) assignOpposedSlot(root, state, slotEl.dataset.slot, id);
    });
  });
}

function assignOpposedSlot(root, state, slot, actorId) {
  if (slot !== "defender" && slot !== "attacker") return;
  state.opposed[`${slot}ActorId`] = actorId;
  const slotEl = root.querySelector(`.op-slot[data-slot="${slot}"]`);
  if (!slotEl) return;
  slotEl.outerHTML = buildOpposedSlotHtml(slot, actorId);
  wireOpposedSlot(root, state, root.querySelector(`.op-slot[data-slot="${slot}"]`));
}

async function resolveDroppedActor(event) {
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

async function pickOpposedActor(source) {
  if (source === "selected") return canvas.tokens?.controlled?.[0]?.actor?.id ?? null;
  if (source === "targeted") return Array.from(game.user?.targets ?? [])[0]?.actor?.id ?? null;
  if (source === "mine") return game.user?.character?.id ?? null;
  if (source === "list") return await openOpposedActorPicker();
  return null;
}

/**
 * Actor picker for the opposed slots.  Deliberately *not* Task Maker's
 * openActorPicker — that one filters on isTaskActor, which excludes ships, and
 * opposed tasks legitimately take ship actors (starship combat flows).
 */
function openOpposedActorPicker() {
  return new Promise(resolve => {
    const actors = game.actors.contents
      .filter(a => a.system?.attributes || a.system?.systems)
      .sort((a, b) => a.name.localeCompare(b.name));

    const html = `
      <div style="display:flex;flex-direction:column;gap:6px;max-height:420px;">
        <input type="text" class="op-pick-search" placeholder="Filter..." style="${inputStyle()}"/>
        <div class="op-pick-list" style="overflow-y:auto;max-height:360px;border:1px solid ${LC.border};">
          ${actors.map(a => `
            <div class="op-pick-row" data-actor-id="${a.id}"
              style="display:flex;gap:6px;align-items:center;padding:4px;cursor:pointer;border-bottom:1px solid ${LC.borderDim};color:${LC.text};">
              <img src="${esc(a.img ?? "icons/svg/mystery-man.svg")}" style="width:22px;height:22px;border:1px solid ${LC.border};"/>
              <span style="flex:1;">${esc(a.name)}</span>
              <span style="font-size:10px;color:${LC.textDim};">${esc(opposedActorKindLabel(a))}</span>
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
      const pickerRoot = dlg.element;
      const search = pickerRoot.querySelector(".op-pick-search");
      search?.addEventListener("input", () => {
        const q = search.value.toLowerCase();
        pickerRoot.querySelectorAll(".op-pick-row").forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
        });
      });
      pickerRoot.querySelectorAll(".op-pick-row").forEach(row => {
        row.addEventListener("click", () => {
          const id = row.dataset.actorId;
          dlg.close();
          resolve(id);
        });
      });
    });
  });
}
