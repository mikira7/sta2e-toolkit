/**
 * sta2e-toolkit | opposed-panel.js
 *
 * The Opposed Task setup UI, as an embeddable panel inside the Task Maker
 * dialog (its "Opposed Task" tab).  Previously this lived in opposed-task.js
 * as a standalone DialogV2.
 *
 * IMPORTANT — this module must only ever import ./lcars-theme.js and
 * ./ship-pool.js.  opposed-task.js pulls in combat-hud.js, which reaches
 * combat-hud-core.js, which imports task-maker.js.  Importing opposed-task.js
 * from here (or from task-maker.js) would close that loop into a real cycle,
 * and main.js evaluates opposed-task.js first, so task-maker.js would see a
 * half-initialised namespace.  Keeping this module's imports to leaves breaks
 * it: ship-pool.js reaches only crew-manifest.js, which imports nothing but
 * lcars-theme.js.
 *
 * The panel keeps the original `.op-*` class names so the resolution side of
 * opposed-task.js (and anything reading the posted card) is unaffected.  It also
 * carries the Task Maker's `.tmk-*` classes, so its shape comes from
 * styles/task-maker.css — NOT from the `.sta2e-opposed-setup` rules in
 * styles/opposed-task.css, which are written for a full dialog root (min-height
 * 700px, huge padding, absolute LCARS elbows) and would draw a second frame
 * inside the Task Maker's own.
 */

import { getActiveLcThemeKey, getLcCssVars, getLcTokens } from "./lcars-theme.js";
import { isShipActor, orderedShipsForActor, shipDeptOptions, shipSystemOptions } from "./ship-pool.js";

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

// ── Markup helpers ──────────────────────────────────────────────────────────
// Deliberately duplicated from task-maker.js rather than imported: this module
// must stay a leaf (see the header note), and it already keeps its own esc() and
// clampInt() for the same reason.  Shape lives in styles/task-maker.css, so
// nothing here may emit an inline border-radius — inline beats any selector.

// Takes no accent: every bar is the one solid colour the stylesheet sets, and the
// sections are told apart by their labels.
function panelBar(label, trailing = "", extraClass = "") {
  return `<div class="tmk-panel-bar${extraClass ? ` ${extraClass}` : ""}">
    <span>${label}</span>${trailing}
  </div>`;
}

function field(label, control, extraClass = "") {
  return `<label class="tmk-field${extraClass ? ` ${extraClass}` : ""}"><span>${label}</span>${control}</label>`;
}

function textInput(cls, value) {
  return `<input class="tmk-input ${cls}" type="text" value="${esc(value ?? "")}"/>`;
}

function numInput(cls, value, { min = 0, max = null, accent = LC.tertiary } = {}) {
  const maxAttr = max == null ? "" : ` max="${max}"`;
  return `<input class="tmk-input tmk-input--num ${cls}" type="number" min="${min}"${maxAttr} value="${value}" style="--tmk-a:${accent};"/>`;
}

function selectField(label, cls, optionsHtml, extraClass = "") {
  return field(label, `<select class="tmk-select ${cls}">${optionsHtml}</select>`, extraClass);
}

function pillButton(cls, label, accent = LC.primary, attrs = "") {
  return `<button type="button" class="tmk-btn ${cls}" style="--tmk-a:${accent};"${attrs}>${label}</button>`;
}

function clearKey(cls, title = "Clear") {
  return `<button type="button" class="tmk-key ${cls}" title="${esc(title)}">&times;</button>`;
}

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
 * Ship-assist defaults for one side.  Mirrors the Normal Task tab's ship
 * defaults (task-maker.js defaultState): first assigned ship, Computers +
 * Command when the ship has them, else whatever it does have.
 */
function defaultSideShipState(side, prefill = {}) {
  const actorId = prefill[`${side}ActorId`]
    ?? (side === "defender" ? prefill.responderActorId : prefill.initiatorActorId)
    ?? null;
  const actor = actorId ? game.actors.get(actorId) : null;
  const preferred = prefill[`${side}ShipActorId`] ?? null;
  // A ship side rolls its own System + Dept via the roller's NPC Ship Pool —
  // it never needs a separate assisting ship.
  const ships = actor && !isShipActor(actor) ? orderedShipsForActor(actor, preferred) : [];
  const shipActorId = preferred ?? ships[0]?.actorId ?? null;
  const ship = ships.find(s => s.actorId === shipActorId)?.shipActor ?? ships[0]?.shipActor ?? null;
  return {
    [`${side}ShipAssist`]: !!prefill[`${side}ShipAssist`],
    [`${side}ShipActorId`]: shipActorId,
    [`${side}ShipSystemKey`]: prefill[`${side}ShipSystemKey`]
      ?? (ship?.system?.systems?.computers ? "computers" : Object.keys(ship?.system?.systems ?? {})[0] ?? ""),
    [`${side}ShipDeptKey`]: prefill[`${side}ShipDeptKey`]
      ?? (ship?.system?.departments?.command ? "command" : Object.keys(ship?.system?.departments ?? {})[0] ?? ""),
  };
}

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
    // Token ids are captured whenever the slot is filled from the canvas, so an
    // unlinked ship token's own crew quality is reachable at roll time.
    defenderTokenId:       prefill.defenderTokenId ?? null,
    attackerTokenId:       prefill.attackerTokenId ?? null,
    ...defaultSideShipState("defender", prefill),
    ...defaultSideShipState("attacker", prefill),
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
  for (const side of ["defender", "attacker"]) {
    // The row is absent for a ship side — keep whatever the state already holds.
    const assist = root.querySelector(`.op-${side}-ship-assist`);
    if (!assist) continue;
    opposed[`${side}ShipAssist`] = !!assist.checked;
    opposed[`${side}ShipActorId`] = root.querySelector(`.op-${side}-ship`)?.value || opposed[`${side}ShipActorId`] || null;
    opposed[`${side}ShipSystemKey`] = root.querySelector(`.op-${side}-ship-system`)?.value || opposed[`${side}ShipSystemKey`] || null;
    opposed[`${side}ShipDeptKey`] = root.querySelector(`.op-${side}-ship-dept`)?.value || opposed[`${side}ShipDeptKey`] || null;
  }
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
    <div class="tmk-panel tmk-opposed-panel">
      ${panelBar("Opposed Task")}
      <div class="tmk-panel-body">

        <div class="tmk-toolbar">
          ${pillButton("op-reuse-last", "Reuse Last", LC.primary, lastSnap ? "" : " disabled")}
          <select class="tmk-select op-recent" ${recent.length ? "" : "disabled"}>
            <option value="">Recent</option>
            ${recentOpts}
          </select>
          ${pillButton("op-clear-recent", "Clear Recent", LC.secondary, recent.length ? "" : " disabled")}
        </div>

        <div class="tmk-grid tmk-grid--2" style="align-items:start;">
          ${complicationSliderHtml("defender", "Defender", defComp, LC.primary)}
          ${complicationSliderHtml("attacker", "Attacker", atkComp, LC.secondary)}
        </div>

        <div class="tmk-well tmk-grid op-trait-panel op-trait-panel-grid">
          ${selectField("Trait Effect", "op-trait-mode", `
            <option value="none" ${traitMod.traitModifierMode === "none" ? "selected" : ""}>No trait modifier</option>
            <option value="increase" ${traitMod.traitModifierMode === "increase" ? "selected" : ""}>Increase attacker Difficulty</option>
            <option value="reduce" ${traitMod.traitModifierMode === "reduce" ? "selected" : ""}>Reduce attacker Difficulty</option>`)}
          ${field("Potency", numInput("op-trait-potency", traitMod.traitModifierPotency, { min: 1, max: 5 }))}
          ${field("Trait Name / Reason", textInput("op-trait-name", traitMod.traitModifierName))}
        </div>

        <div class="tmk-grid tmk-grid--2" style="align-items:start;">
          ${buildOpposedSlotHtml("defender", opposed.defenderActorId, opposed.defenderTokenId)}
          ${buildOpposedSlotHtml("attacker", opposed.attackerActorId, opposed.attackerTokenId)}
        </div>

        <div class="tmk-grid tmk-grid--2" style="align-items:start;">
          ${sideSuggestionHtml("defender", opposed.defenderSuggestedAttr, opposed.defenderSuggestedDisc)}
          ${sideSuggestionHtml("attacker", opposed.attackerSuggestedAttr, opposed.attackerSuggestedDisc)}
        </div>

        <div class="tmk-grid tmk-grid--2" style="align-items:start;">
          ${buildOpposedShipRowHtml("defender", opposed)}
          ${buildOpposedShipRowHtml("attacker", opposed)}
        </div>
      </div>
    </div>
  `;
}

/**
 * Ship-assist box for one side — the Opposed tab's equivalent of the Normal
 * tab's `.tmk-ship-panel`.  A ship side gets a note instead: it already rolls
 * its own System + Department through the roller's NPC Ship Pool.
 */
export function buildOpposedShipRowHtml(sideKey, opposed) {
  const accent = sideKey === "defender" ? LC.primary : LC.secondary;
  const wrap = body => `
    <div class="tmk-well op-ship-row" data-slot="${sideKey}" style="--tmk-a:${accent};">
      <div class="tmk-well-title">${SLOT_TITLES[sideKey]} Ship Assist</div>
      ${body}
    </div>`;

  const actorId = opposed[`${sideKey}ActorId`];
  const actor = actorId ? game.actors.get(actorId) : null;
  if (!actor) {
    return wrap(`<div class="tmk-drop-hint">Assign an actor first.</div>`);
  }
  if (isShipActor(actor)) {
    return wrap(`<div class="tmk-drop-hint">${esc(actor.name)} rolls its own System + Department in the roller's ship pool.</div>`);
  }

  const assist = !!opposed[`${sideKey}ShipAssist`];
  const shipActorId = opposed[`${sideKey}ShipActorId`];
  const ships = orderedShipsForActor(actor, shipActorId);
  const selectedShip = ships.find(s => s.actorId === shipActorId)?.shipActor ?? ships[0]?.shipActor ?? null;
  const shipOpts = ships.map(s => `<option value="${esc(s.actorId)}" ${s.actorId === shipActorId ? "selected" : ""}>${esc(s.label)}</option>`).join("");

  return wrap(`
    <label class="tmk-check">
      <input type="checkbox" class="op-${sideKey}-ship-assist" ${assist ? "checked" : ""}/>
      Ship assists this side
    </label>
    <div class="tmk-stack op-${sideKey}-ship-fields" ${assist ? "" : "hidden"} style="margin-top:8px;gap:8px;">
      ${selectField("Ship", `op-${sideKey}-ship`, shipOpts || `<option value="">No ships found</option>`)}
      <div class="tmk-grid tmk-grid--2">
        ${selectField("System", `op-${sideKey}-ship-system`, shipSystemOptions(selectedShip, opposed[`${sideKey}ShipSystemKey`]))}
        ${selectField("Department", `op-${sideKey}-ship-dept`, shipDeptOptions(selectedShip, opposed[`${sideKey}ShipDeptKey`]))}
      </div>
    </div>
  `);
}

function complicationSliderHtml(sideKey, label, value, accent) {
  return `
    <div class="tmk-well" style="--tmk-a:${accent};">
      <div class="tmk-well-title">${label} Complication Range</div>
      <div class="tmk-range">
        <input type="range" min="1" max="5" value="${value}" class="op-${sideKey}-complication-range"/>
        <span class="tmk-range-val op-${sideKey}-complication-range-val">${value}</span>
      </div>
      <div class="tmk-range-desc op-${sideKey}-complication-desc">${complicationDesc(value)}</div>
    </div>
  `;
}

function sideSuggestionHtml(sideKey, attrKey, discKey) {
  const accent = sideKey === "defender" ? LC.primary : LC.secondary;
  const attrOpts = ATTR_OPTIONS.map(a => `<option value="${a.key}" ${a.key === attrKey ? "selected" : ""}>${a.label}</option>`).join("");
  const discOpts = DISC_OPTIONS.map(d => `<option value="${d.key}" ${d.key === discKey ? "selected" : ""}>${d.label}</option>`).join("");
  return `
    <div class="tmk-well" style="--tmk-a:${accent};">
      <div class="tmk-well-title">${SLOT_TITLES[sideKey]} Roll Pair</div>
      <div class="tmk-grid tmk-grid--2">
        ${selectField("Attribute", `op-${sideKey}-attr`, attrOpts)}
        ${selectField("Discipline", `op-${sideKey}-disc`, discOpts)}
      </div>
    </div>
  `;
}

export function buildOpposedSlotHtml(slotKey, actorId, tokenId = null) {
  const actor = actorId ? game.actors.get(actorId) : null;
  const accent = slotKey === "defender" ? LC.primary : LC.secondary;
  const body = actor
    ? `<div class="tmk-actor-row">
         <img src="${esc(actor.img ?? "icons/svg/mystery-man.svg")}"/>
         <div class="tmk-actor-text">
           <div class="tmk-actor-name">${esc(actor.name)}</div>
           <div class="tmk-actor-meta">${esc(opposedActorKindLabel(actor))}</div>
         </div>
         ${clearKey("op-slot-clear")}
       </div>`
    : `<div class="tmk-drop-hint">Drag an actor or token here</div>`;
  return `
    <div class="tmk-well tmk-dropzone op-slot" data-slot="${slotKey}" data-actor-id="${actorId ?? ""}" data-token-id="${tokenId ?? ""}"
      style="--tmk-a:${accent};">
      <div class="tmk-well-title">${SLOT_TITLES[slotKey]}</div>
      <div class="op-slot-body">
        ${body}
      </div>
      <div class="tmk-slot-actions">
        ${pillButton("op-slot-pick", "Selected", LC.primary, ` data-source="selected"`)}
        ${pillButton("op-slot-pick", "Targeted", LC.secondary, ` data-source="targeted"`)}
        ${pillButton("op-slot-pick", "List...", LC.tertiary, ` data-source="list"`)}
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
  for (const side of ["defender", "attacker"]) wireOpposedShipRow(root, state, side);
}

/** Mirrors task-maker.js's wireShipFields / refreshShipSelects for one side. */
function wireOpposedShipRow(root, state, side) {
  const assist = root.querySelector(`.op-${side}-ship-assist`);
  assist?.addEventListener("change", () => {
    state.opposed[`${side}ShipAssist`] = assist.checked;
    const fields = root.querySelector(`.op-${side}-ship-fields`);
    if (fields) fields.hidden = !assist.checked;
    state._app?.setPosition?.({ height: "auto" });
  });
  root.querySelector(`.op-${side}-ship`)?.addEventListener("change", event => {
    state.opposed[`${side}ShipActorId`] = event.target.value || null;
    refreshOpposedShipSelects(root, state, side);
  });
}

/** Repopulate a side's System/Department selects from the newly chosen ship. */
function refreshOpposedShipSelects(root, state, side) {
  const opposed = state.opposed;
  const actorId = opposed[`${side}ActorId`];
  const actor = actorId ? game.actors.get(actorId) : null;
  if (!actor) return;
  const ships = orderedShipsForActor(actor, opposed[`${side}ShipActorId`]);
  const ship = ships.find(s => s.actorId === opposed[`${side}ShipActorId`])?.shipActor ?? ships[0]?.shipActor ?? null;
  opposed[`${side}ShipSystemKey`] = ship?.system?.systems?.[opposed[`${side}ShipSystemKey`]]
    ? opposed[`${side}ShipSystemKey`]
    : Object.keys(ship?.system?.systems ?? {})[0] ?? opposed[`${side}ShipSystemKey`];
  opposed[`${side}ShipDeptKey`] = ship?.system?.departments?.[opposed[`${side}ShipDeptKey`]]
    ? opposed[`${side}ShipDeptKey`]
    : Object.keys(ship?.system?.departments ?? {})[0] ?? opposed[`${side}ShipDeptKey`];
  const sysSelect = root.querySelector(`.op-${side}-ship-system`);
  if (sysSelect) sysSelect.innerHTML = shipSystemOptions(ship, opposed[`${side}ShipSystemKey`]);
  const deptSelect = root.querySelector(`.op-${side}-ship-dept`);
  if (deptSelect) deptSelect.innerHTML = shipDeptOptions(ship, opposed[`${side}ShipDeptKey`]);
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
  // A class, not an inline border-color write: an inline literal would outrank the
  // stylesheet for good once dragleave restored it, freezing the colour to
  // whatever theme was active at render time.
  slotEl.addEventListener("dragover", event => {
    event.preventDefault();
    slotEl.classList.add("is-dropping");
  });
  slotEl.addEventListener("dragleave", () => slotEl.classList.remove("is-dropping"));
  slotEl.addEventListener("drop", async event => {
    event.preventDefault();
    slotEl.classList.remove("is-dropping");
    const picked = await resolveDroppedActor(event);
    if (!picked?.actorId) {
      ui.notifications.warn("STA2e Toolkit: Drop an Actor or a Token.");
      return;
    }
    assignOpposedSlot(root, state, slotEl.dataset.slot, picked.actorId, picked.tokenId);
  });
  slotEl.querySelector(".op-slot-clear")?.addEventListener("click", () => {
    assignOpposedSlot(root, state, slotEl.dataset.slot, null, null);
  });
  slotEl.querySelectorAll(".op-slot-pick").forEach(btn => {
    btn.addEventListener("click", async () => {
      const picked = await pickOpposedActor(btn.dataset.source);
      if (picked?.actorId) assignOpposedSlot(root, state, slotEl.dataset.slot, picked.actorId, picked.tokenId);
    });
  });
}

function assignOpposedSlot(root, state, slot, actorId, tokenId = null) {
  if (slot !== "defender" && slot !== "attacker") return;
  state.opposed[`${slot}ActorId`] = actorId;
  state.opposed[`${slot}TokenId`] = tokenId ?? null;
  // The ship list is derived from the slotted actor, so reset this side's
  // ship-assist defaults before repainting either box.
  Object.assign(state.opposed, defaultSideShipState(slot, {
    [`${slot}ActorId`]: actorId,
    [`${slot}ShipAssist`]: state.opposed[`${slot}ShipAssist`],
  }));
  const slotEl = root.querySelector(`.op-slot[data-slot="${slot}"]`);
  if (!slotEl) return;
  slotEl.outerHTML = buildOpposedSlotHtml(slot, actorId, tokenId);
  wireOpposedSlot(root, state, root.querySelector(`.op-slot[data-slot="${slot}"]`));
  const shipRowEl = root.querySelector(`.op-ship-row[data-slot="${slot}"]`);
  if (shipRowEl) {
    shipRowEl.outerHTML = buildOpposedShipRowHtml(slot, state.opposed);
    wireOpposedShipRow(root, state, slot);
  }
  // Slotting an actor swaps a one-line hint for a portrait row and may open the
  // ship-assist fields, so the window has to re-fit.  state._app is the Task
  // Maker dialog, stashed by openTaskMakerSetup.
  state._app?.setPosition?.({ height: "auto" });
}

/** @returns {?{actorId: string, tokenId: ?string}} */
async function resolveDroppedActor(event) {
  let data = null;
  try {
    const raw = event.dataTransfer?.getData("text/plain") || event.dataTransfer?.getData("application/json") || "";
    data = raw ? JSON.parse(raw) : null;
  } catch { return null; }
  if (data?.uuid) {
    try {
      const doc = await fromUuid(data.uuid);
      // A TokenDocument drag — keep the token so per-token flags stay reachable.
      if (doc?.actor) return { actorId: doc.actor.id, tokenId: doc.id ?? null };
      if (doc?.documentName === "Actor") return { actorId: doc.id, tokenId: null };
    } catch {}
  }
  if (data?.type === "Actor" && data.id) {
    return game.actors.get(data.id) ? { actorId: data.id, tokenId: null } : null;
  }
  if (data?.type === "Token") {
    const scene = game.scenes.get(data.sceneId ?? canvas.scene?.id);
    const tokenDoc = scene?.tokens.get(data.tokenId ?? data.id) ?? null;
    return tokenDoc?.actor ? { actorId: tokenDoc.actor.id, tokenId: tokenDoc.id } : null;
  }
  return null;
}

/** @returns {?{actorId: string, tokenId: ?string}} */
async function pickOpposedActor(source) {
  const fromToken = token => (token?.actor ? { actorId: token.actor.id, tokenId: token.id } : null);
  if (source === "selected") return fromToken(canvas.tokens?.controlled?.[0]);
  if (source === "targeted") return fromToken(Array.from(game.user?.targets ?? [])[0]);
  if (source === "mine") return game.user?.character ? { actorId: game.user.character.id, tokenId: null } : null;
  if (source === "list") {
    const id = await openOpposedActorPicker();
    return id ? { actorId: id, tokenId: null } : null;
  }
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
      <div class="sta2e-tmk-picker" data-theme="${getActiveLcThemeKey()}" style="${getLcCssVars("tmk")}">
        <input type="text" class="tmk-input op-pick-search" placeholder="Filter..."/>
        <div class="tmk-pick-list op-pick-list">
          ${actors.map(a => `
            <div class="tmk-pick-row op-pick-row" data-actor-id="${a.id}">
              <img src="${esc(a.img ?? "icons/svg/mystery-man.svg")}"/>
              <span class="tmk-pick-label">${esc(a.name)}</span>
              <span class="tmk-pick-tag">${esc(opposedActorKindLabel(a))}</span>
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
