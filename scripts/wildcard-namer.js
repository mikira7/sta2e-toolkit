/**
 * sta2e-toolkit | wildcard-namer.js
 * Assigns random names to wildcard (unlinked) tokens based on actor traits
 * and configured RollTable mappings.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE = "sta2e-toolkit";

// ── Core naming function ─────────────────────────────────────────────────────

/**
 * If the given token is unlinked and its actor has a trait matching a
 * configured rule, roll on the associated RollTable and rename the token.
 *
 * @param {TokenDocument} tokenDoc
 */
export async function applyWildcardName(tokenDoc) {
  if (!game.user.isGM) return;

  const actor = tokenDoc.actor;
  if (!actor) return;

  // Only act on unlinked (wildcard) tokens
  if (tokenDoc.isLinked) return;

  const rules = game.settings.get(MODULE, "wildcardNamerRules")?.rules ?? [];
  if (!rules.length) return;

  // Collect actor traits from items of type "trait"
  const traitNames = new Set();
  for (const item of actor.items) {
    if (item.type === "trait") traitNames.add(item.name.toLowerCase());
  }
  // Also support a system.traits text field (comma/newline separated)
  const traitText = actor.system?.traits ?? "";
  if (typeof traitText === "string") {
    for (const t of traitText.split(/[,\n]/)) {
      const trimmed = t.trim();
      if (trimmed) traitNames.add(trimmed.toLowerCase());
    }
  }

  if (!traitNames.size) return;

  // Evaluate rules in order — first match wins
  for (const rule of rules) {
    if (!rule.trait || !rule.tableName) continue;
    if (!traitNames.has(rule.trait.toLowerCase())) continue;

    const table = await _resolveTable(rule);
    if (!table) {
      console.warn(`STA2e Toolkit | Wildcard Namer: could not find table "${rule.tableName}"`);
      continue;
    }

    const draw = await table.draw({ displayChat: false });
    const result = draw.results[0];
    const newName = result?.text ?? result?.getChatText?.() ?? null;
    if (!newName) continue;

    await tokenDoc.update({ name: newName });
    console.log(`STA2e Toolkit | Wildcard Namer: "${actor.name}" → "${newName}"`);
    return;
  }
}

/**
 * Resolve a RollTable document from either the world or a compendium pack.
 *
 * @param {{ tableSource: string, packId: string, tableName: string }} rule
 * @returns {Promise<RollTable|null>}
 */
async function _resolveTable(rule) {
  if (rule.tableSource === "compendium") {
    if (!rule.packId) return null;
    const pack = game.packs.get(rule.packId);
    if (!pack) return null;
    const index = await pack.getIndex();
    const entry = index.find(e => e.name === rule.tableName);
    if (!entry) return null;
    return await pack.getDocument(entry._id);
  }
  // Default: world RollTable
  return game.tables.find(t => t.name === rule.tableName) ?? null;
}

// ── WildcardNamerConfig ──────────────────────────────────────────────────────

export class WildcardNamerConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id:       "sta2e-wildcard-namer-config",
    tag:      "div",
    window:   { title: "STA2E.WildcardNamer.WindowTitle", resizable: true },
    position: { width: 720, height: 520 },
    actions: {
      save:       WildcardNamerConfig._onSave,
      cancel:     WildcardNamerConfig._onCancel,
      addRule:    WildcardNamerConfig._onAddRule,
      deleteRule: WildcardNamerConfig._onDeleteRule,
    },
  };

  static PARTS = {
    config: { template: "modules/sta2e-toolkit/templates/wildcard-namer.hbs" },
  };

  // ── Context ────────────────────────────────────────────────────────────────

  async _prepareContext(_options) {
    const rules = game.settings.get(MODULE, "wildcardNamerRules")?.rules ?? [];
    const worldTables = game.tables.contents.map(t => t.name).sort((a, b) => a.localeCompare(b));
    const packs = game.packs
      .filter(p => p.documentName === "RollTable")
      .map(p => ({ id: p.collection, label: p.metadata.label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { rules, worldTables, packs };
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    // Toggle pack-ID field visibility based on the source dropdown
    el.querySelectorAll("[data-field='tableSource']").forEach(sel => {
      const _sync = () => {
        const packField = sel.closest(".wn-rule-row")?.querySelector(".wn-pack-field");
        if (packField) packField.style.display = sel.value === "compendium" ? "" : "none";
      };
      sel.addEventListener("change", _sync);
      _sync();
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  static async _onSave(_event, _target) {
    const el = this.element;
    const rules = [];
    for (const row of el.querySelectorAll(".wn-rule-row")) {
      rules.push({
        trait:       row.querySelector("[data-field='trait']")?.value.trim()      ?? "",
        tableSource: row.querySelector("[data-field='tableSource']")?.value        ?? "world",
        packId:      row.querySelector("[data-field='packId']")?.value.trim()     ?? "",
        tableName:   row.querySelector("[data-field='tableName']")?.value.trim()  ?? "",
      });
    }
    await game.settings.set(MODULE, "wildcardNamerRules", { rules });
    this.close();
  }

  static _onCancel(_event, _target) {
    this.close();
  }

  static async _onAddRule(_event, _target) {
    const data = game.settings.get(MODULE, "wildcardNamerRules") ?? { rules: [] };
    data.rules.push({ trait: "", tableSource: "world", packId: "", tableName: "" });
    await game.settings.set(MODULE, "wildcardNamerRules", data);
    this.render();
  }

  static async _onDeleteRule(_event, target) {
    const idx = parseInt(target.dataset.index);
    if (isNaN(idx)) return;
    const data = game.settings.get(MODULE, "wildcardNamerRules") ?? { rules: [] };
    data.rules.splice(idx, 1);
    await game.settings.set(MODULE, "wildcardNamerRules", data);
    this.render();
  }
}
