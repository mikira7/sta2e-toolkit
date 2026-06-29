/**
 * sta2e-toolkit | trait-item-sheet.js
 * Toolkit automation fields injected into native STA trait item sheets.
 */

import {
  MODULE,
  TRAIT_FLAG,
  defaultAutomation,
  normalizeAutomation,
  traitAutomationFromItem,
  traitQuantity,
  splitTraitDescription,
  traitDescriptionForStorage,
  updateActorTraitItem,
} from "./trait-service.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function splitTags(value) {
  return String(value ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function rootElement(html) {
  return html instanceof HTMLElement ? html : html?.[0] ?? html;
}

async function saveTraitAutomation(item, automation) {
  const cleanDescription = splitTraitDescription(item.system?.description ?? "").description;
  if (item.parent?.documentName === "Actor") {
    return updateActorTraitItem(item.parent, item.id, { automation });
  }
  await item.update({
    "system.description": traitDescriptionForStorage(cleanDescription, automation),
    flags: {
      [MODULE]: {
        [TRAIT_FLAG]: normalizeAutomation(automation),
      },
    },
  });
  return item;
}

function automationFromPanel(panel, current = defaultAutomation()) {
  const first = current.effects?.[0] ?? {};
  const effectType = panel.querySelector("[data-trait-field='effectType']")?.value ?? "note";
  return defaultAutomation({
    duration: panel.querySelector("[data-trait-field='duration']")?.value ?? "persistent",
    createdBy: current.createdBy ?? null,
    sourceTags: splitTags(panel.querySelector("[data-trait-field='sourceTags']")?.value),
    effects: [{
      id: first.id ?? "primary",
      type: effectType,
      label: panel.querySelector("[data-trait-field='effectLabel']")?.value?.trim() || effectType,
      value: 0,
      difficultyDirection: panel.querySelector("[data-trait-field='difficultyDirection']")?.value
        ?? (first.difficultyDirection === "reduce" ? "reduce" : "increase"),
      complicationDirection: panel.querySelector("[data-trait-field='complicationDirection']")?.value
        ?? (first.complicationDirection === "reduce" ? "reduce" : "increase"),
      alwaysOn: panel.querySelector("[data-trait-field='alwaysOn']")?.checked ?? !!first.alwaysOn,
      scalesWithQuantity: false,
      match: {
        taskKeys: splitTags(panel.querySelector("[data-trait-field='taskKeys']")?.value),
        stationIds: splitTags(panel.querySelector("[data-trait-field='stationIds']")?.value),
        weaponTags: splitTags(panel.querySelector("[data-trait-field='weaponTags']")?.value),
      },
    }],
  });
}

function effectSummary(effect, item) {
  if (!effect) return "Notes only";
  const potency = traitQuantity(item);
  if (effect.type === "difficulty") {
    const dir = effect.difficultyDirection === "reduce" ? "reduces" : "increases";
    return `${effect.label || "Difficulty"} ${dir} Difficulty by ${potency}${effect.alwaysOn ? " (always on)" : ""}`;
  }
  if (effect.type === "complicationRange") {
    const dir = effect.complicationDirection === "reduce" ? "reduces" : "increases";
    return `${effect.label || "Complication"} ${dir} Complication range by ${potency}${effect.alwaysOn ? " (always on)" : ""}`;
  }
  const suffix = ["bonusMomentum", "bonusThreat"].includes(effect.type) ? ` +${potency}` : "";
  const lockNote = effect.alwaysOn ? " (always on)" : "";
  return `${effect.label || effect.type || "note"}${suffix}${lockNote}`;
}

function tagsSummary(automation, first) {
  const groups = [
    ["Sources", automation.sourceTags],
    ["Tasks", first?.match?.taskKeys],
    ["Stations", first?.match?.stationIds],
    ["Tags", first?.match?.weaponTags],
  ].filter(([, values]) => Array.isArray(values) && values.length);
  if (!groups.length) return `<span class="sta2e-trait-item-empty">No match tags configured.</span>`;
  return groups.map(([label, values]) => `
    <span class="sta2e-trait-item-chip">
      <strong>${escapeHtml(label)}</strong> ${escapeHtml(values.join(", "))}
    </span>`).join("");
}

function panelHtml(item) {
  const automation = traitAutomationFromItem(item);
  const first = automation.effects?.[0] ?? {};
  const creatorName = automation.createdBy?.name ?? "Unknown";
  const option = (value, selected, label = value) =>
    `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
  return `
    <section class="sta2e-trait-item-panel">
      <header>
        <h3>Toolkit Automation</h3>
        <button type="button" data-action="sta2e-save-trait-automation">
          <i class="fas fa-save"></i><span>Save</span>
        </button>
      </header>
      <div class="sta2e-trait-item-summary">
        <div>
          <span>Duration</span>
          <strong>${escapeHtml(automation.duration ?? "persistent")}</strong>
        </div>
        <div>
          <span>Effect</span>
          <strong>${escapeHtml(effectSummary(first, item))}</strong>
        </div>
        <div>
          <span>Amount</span>
          <strong>Uses Potency ${traitQuantity(item)}</strong>
        </div>
        <div>
          <span>Created By</span>
          <strong>${escapeHtml(creatorName)}</strong>
        </div>
        <div class="sta2e-trait-item-tags">
          ${tagsSummary(automation, first)}
        </div>
      </div>
      <div class="sta2e-trait-form-grid">
        <label>Duration</label>
        <select data-trait-field="duration">
          ${["persistent", "scene", "single-task"].map(v => option(v, automation.duration)).join("")}
        </select>
        <label>Source Tags</label>
        <input data-trait-field="sourceTags" value="${escapeHtml((automation.sourceTags ?? []).join(", "))}" placeholder="equipment, scene" />
        <label>Effect Type</label>
        <select data-trait-field="effectType">
          ${["note", "difficulty", "reroll", "bonusMomentum", "bonusThreat", "complicationRange", "possible", "impossible"].map(v => option(v, first.type ?? "note")).join("")}
        </select>
        ${game.user?.isGM ? `
        <label>Difficulty Direction</label>
        <select data-trait-field="difficultyDirection">
          ${[["increase", "Increase Difficulty"], ["reduce", "Reduce Difficulty"]].map(([v, l]) => option(v, first.difficultyDirection === "reduce" ? "reduce" : "increase", l)).join("")}
        </select>
        <label>Complication Direction</label>
        <select data-trait-field="complicationDirection">
          ${[["increase", "Increase Complication"], ["reduce", "Reduce Complication"]].map(([v, l]) => option(v, first.complicationDirection === "reduce" ? "reduce" : "increase", l)).join("")}
        </select>
        <label>Always On</label>
        <label style="display:flex;align-items:center;gap:6px;font-weight:normal;">
          <input type="checkbox" data-trait-field="alwaysOn" ${first.alwaysOn ? "checked" : ""} />
          <span style="font-size:10px;">Auto-checked in the roller and locked for players</span>
        </label>` : ""}
        <label>Effect Label</label>
        <input data-trait-field="effectLabel" value="${escapeHtml(first.label ?? "")}" placeholder="Helpful trait note" />
        <label>Task Keys</label>
        <input data-trait-field="taskKeys" value="${escapeHtml((first.match?.taskKeys ?? []).join(", "))}" placeholder="attack-pattern, create-trait" />
        <label>Station IDs</label>
        <input data-trait-field="stationIds" value="${escapeHtml((first.match?.stationIds ?? []).join(", "))}" placeholder="tactical, sensors" />
        <label>Weapon Tags</label>
        <input data-trait-field="weaponTags" value="${escapeHtml((first.match?.weaponTags ?? []).join(", "))}" placeholder="attack, torpedo, ground" />
      </div>
    </section>`;
}

function injectTraitItemPanel(app, html) {
  const item = app?.item ?? app?.document;
  if (!item || item.documentName !== "Item" || item.type !== "trait") return;
  const root = rootElement(html);
  const sheet = root?.querySelector?.(".item-sheet") ?? root;
  if (!sheet || sheet.querySelector(".sta2e-trait-item-panel")) return;

  sheet.insertAdjacentHTML("beforeend", panelHtml(item));
  const panel = sheet.querySelector(".sta2e-trait-item-panel");
  panel?.querySelector("[data-action='sta2e-save-trait-automation']")?.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const automation = automationFromPanel(panel, traitAutomationFromItem(item));
      await saveTraitAutomation(item, automation);
      ui.notifications.info(`STA2e Toolkit: Saved trait automation for ${item.name}.`);
      app.render?.({ force: true });
    } catch (err) {
      console.error("STA2e Toolkit | Trait item automation save failed:", err);
      ui.notifications.error("STA2e Toolkit: Trait automation save failed. See console.");
    }
  });
}

function hasMeaningfulAutomation(automation) {
  return !!(
    automation?.effects?.length
    || automation?.sourceTags?.length
    || (automation?.duration && automation.duration !== "persistent")
  );
}

function preserveTraitAutomationOnDescriptionSave(item, change) {
  if (!item || item.documentName !== "Item" || item.type !== "trait") return;
  const nextDescription = foundry.utils.getProperty(change, "system.description");
  if (typeof nextDescription !== "string") return;
  if (splitTraitDescription(nextDescription).automation) return;
  const automation = traitAutomationFromItem(item);
  if (!hasMeaningfulAutomation(automation)) return;
  foundry.utils.setProperty(change, "system.description", traitDescriptionForStorage(nextDescription, automation));
}

export function registerTraitItemSheetFields() {
  Hooks.on("renderApplicationV2", injectTraitItemPanel);
  Hooks.on("renderItemSheet", injectTraitItemPanel);
  Hooks.on("renderItemSheetV2", injectTraitItemPanel);
  Hooks.on("renderSTAItems", injectTraitItemPanel);
  Hooks.on("preUpdateItem", preserveTraitAutomationOnDescriptionSave);
}
