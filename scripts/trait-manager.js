/**
 * sta2e-toolkit | trait-manager.js
 * Floating trait manager for actor and scene traits.
 */

import { getLcTokens } from "./lcars-theme.js";
import {
  canEditActorTraits,
  createActorTrait,
  createSceneTraitActor,
  createSceneTrait,
  defaultAutomation,
  getActorTraitRecords,
  getSceneTraitActor,
  getSceneTraitRecords,
  linkSceneTraitActor,
  promptSpendCreateTrait,
  promptTraitCreateData,
  createTraitFromData,
  removeSceneTrait,
  setSceneTraits,
  traitQuantity,
  unlinkSceneTraitActor,
  updateActorTraitItem,
  updateSceneTraitItem,
  visibleTraitActors,
} from "./trait-service.js";

const POS_KEY = "sta2e-toolkit.traitManagerPos";
const COLLAPSE_KEY = "sta2e-toolkit.traitManagerCollapsed";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function traitEffectText(trait) {
  const effects = trait.automation?.effects ?? [];
  if (!effects.length) return "Notes only";
  return effects.map(effect => {
    const potency = traitQuantity(trait);
    if (effect.type === "difficulty") {
      return `${effect.label || "Difficulty"} changes Difficulty by ${potency}; choose direction on roll`;
    }
    const suffix = ["complicationRange", "bonusMomentum", "bonusThreat"].includes(effect.type) ? ` +${potency}` : "";
    return `${effect.label || effect.type}${suffix}`;
  }).join(", ");
}

function lc() {
  return getLcTokens();
}

export class TraitManager {
  constructor() {
    this._app = null;
  }

  toggle() {
    if (this._app?.rendered) this._app.close();
    else this.open();
  }

  open() {
    if (this._app?.rendered) {
      this._app.bringToFront?.();
      return;
    }
    this._app = new TraitManagerApp();
    this._app.render(true);
  }
}

class TraitManagerApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "sta2e-trait-manager",
    classes: ["sta2e-trait-manager"],
    tag: "section",
    window: {
      title: "Trait Manager",
      resizable: true,
    },
    position: {
      width: 520,
      height: 620,
    },
  };

  constructor(options = {}) {
    super(options);
    this._collapsed = this._loadCollapsed();
    this._boundHandleClick = event => this._handleClick(event);
    this._boundHandleDragStart = event => this._handleDragStart(event);
    this._boundHandleDragOver = event => this._handleDragOver(event);
    this._boundHandleDragLeave = event => this._handleDragLeave(event);
    this._boundHandleDrop = event => this._handleDrop(event);
  }

  async _renderHTML() {
    const LC = lc();
    const actors = visibleTraitActors();
    const sceneActor = getSceneTraitActor();
    const sceneTraits = getSceneTraitRecords();
    const actorBlocks = actors.map(actor => {
      const traits = getActorTraitRecords(actor);
      const blockId = `actor:${actor.id}`;
      return `
        <section class="sta2e-tm-block ${this._collapsed.has(blockId) ? "is-collapsed" : ""}" data-block-id="${blockId}" data-actor-id="${actor.id}">
          <header>
            <div class="sta2e-tm-heading">
              <button type="button" class="sta2e-tm-toggle" data-action="toggle-block" data-block-id="${blockId}" title="${this._collapsed.has(blockId) ? "Show traits" : "Hide traits"}">
                <i class="fas fa-chevron-${this._collapsed.has(blockId) ? "right" : "down"}"></i>
              </button>
              <h3>${escapeHtml(actor.name)}</h3>
            </div>
            ${canEditActorTraits(actor) ? `
            <button type="button" data-action="add-actor-trait" data-actor-id="${actor.id}" title="Add actor trait">
              <i class="fas fa-plus"></i>
            </button>` : ""}
          </header>
          <div class="sta2e-tm-list">
            ${traits.length ? traits.map(t => this._traitRow(t)).join("") : `<div class="sta2e-tm-empty">No traits.</div>`}
          </div>
        </section>`;
    }).join("");

    return `
      <div class="sta2e-tm-root" style="--tm-primary:${LC.primary};--tm-secondary:${LC.secondary};--tm-bg:${LC.bg};--tm-panel:${LC.panel};--tm-border:${LC.border};--tm-border-dim:${LC.borderDim};--tm-text:${LC.text};--tm-text-dim:${LC.textDim};--tm-red:${LC.red};font-family:${LC.font};">
        <div class="sta2e-tm-toolbar">
          <button type="button" data-action="create-trait"><i class="fas fa-plus"></i><span>Create</span></button>
          <button type="button" data-action="spend-create"><i class="fas fa-coins"></i><span>Spend 2</span></button>
          ${game.user.isGM ? `<button type="button" data-action="bulk-remove-temp"><i class="fas fa-broom"></i><span>Clear Temp</span></button>` : ""}
          <button type="button" data-action="refresh"><i class="fas fa-sync"></i></button>
        </div>

        <div class="sta2e-tm-scroll">
          <section class="sta2e-tm-block sta2e-tm-scene ${this._collapsed.has("scene") ? "is-collapsed" : ""}" data-block-id="scene">
            <header>
              <div class="sta2e-tm-heading">
                <button type="button" class="sta2e-tm-toggle" data-action="toggle-block" data-block-id="scene" title="${this._collapsed.has("scene") ? "Show traits" : "Hide traits"}">
                  <i class="fas fa-chevron-${this._collapsed.has("scene") ? "right" : "down"}"></i>
                </button>
                <h3>${escapeHtml(canvas?.scene?.name ?? "Scene")} Traits</h3>
              </div>
              ${game.user.isGM ? `
              <button type="button" data-action="create-scene-actor" title="${sceneActor ? "Scene trait actor already linked" : "Create scene trait actor"}">
                <i class="fas fa-user-plus"></i>
              </button>
              ${sceneActor ? `
              <button type="button" data-action="unlink-scene-actor" title="Unlink scene trait actor">
                <i class="fas fa-unlink"></i>
              </button>` : ""}
              <button type="button" data-action="add-scene-trait" title="Add scene trait">
                <i class="fas fa-plus"></i>
              </button>` : ""}
            </header>
            <div class="sta2e-tm-list">
              ${this._sceneActorRow(sceneActor, sceneTraits)}
              ${sceneTraits.length ? sceneTraits.map(t => this._traitRow(t)).join("") : `<div class="sta2e-tm-empty">No scene traits.</div>`}
            </div>
          </section>

          <div class="sta2e-tm-actors">
            ${actorBlocks || `<div class="sta2e-tm-empty">No visible owned actors in this scene.</div>`}
          </div>
        </div>
      </div>`;
  }

  _sceneActorRow(sceneActor, sceneTraits) {
    const count = sceneActor
      ? Array.from(sceneActor.items ?? []).filter(item => item.type === "trait").length
      : sceneTraits.length;
    const linked = !!sceneActor;
    return `
      <div class="sta2e-tm-scene-actor-drop ${linked ? "is-linked" : ""}" data-scene-actor-drop>
        <img src="${escapeHtml(sceneActor?.img ?? "icons/svg/mystery-man.svg")}" alt="" />
        <div class="sta2e-tm-scene-actor-main">
          <strong>${linked ? escapeHtml(sceneActor.name) : "No scene trait actor linked"}</strong>
          <span>${linked
            ? `${count} trait item${count === 1 ? "" : "s"} on the scene trait actor`
            : "Drop a scenetraits Actor here, or use the create button."}</span>
        </div>
        <div class="sta2e-tm-scene-actor-actions">
          ${linked ? `<button type="button" data-action="open-scene-actor" title="Open scene trait actor"><i class="fas fa-external-link-alt"></i></button>` : ""}
        </div>
      </div>`;
  }

  _traitRow(trait) {
    const duration = trait.automation?.duration ?? "persistent";
    const canRemove = trait.scope === "scene" ? game.user.isGM : canEditActorTraits(trait.actor);
    return `
      <article class="sta2e-tm-row" draggable="true" data-scope="${trait.scope}" data-trait-id="${trait.itemId ?? trait.id}" data-actor-id="${trait.actorId ?? ""}" data-actor-uuid="${escapeHtml(trait.actorUuid ?? "")}">
        <img src="${escapeHtml(trait.img)}" alt="" />
        <div class="sta2e-tm-row-main">
          <div class="sta2e-tm-row-title">
            <strong>${escapeHtml(trait.name)}</strong>
            <span>Potency ${trait.quantity}</span>
            <span>${duration}</span>
            ${trait.automation?.createdBy?.name ? `<span>Created by ${escapeHtml(trait.automation.createdBy.name)}</span>` : ""}
          </div>
          <div class="sta2e-tm-row-effect">${escapeHtml(traitEffectText(trait))}</div>
        </div>
        <div class="sta2e-tm-row-actions">
          ${canRemove ? `<button type="button" data-action="edit-trait" title="Edit automation"><i class="fas fa-sliders-h"></i></button>` : ""}
          ${canRemove ? `<button type="button" data-action="remove-trait" title="Remove trait"><i class="fas fa-trash"></i></button>` : ""}
        </div>
      </article>`;
  }

  _replaceHTML(result, element) {
    (element.querySelector(".window-content") ?? element).innerHTML = result;
  }

  _onRender(_context, _options) {
    const saved = this._loadPos();
    if (saved && this.element) {
      this.setPosition(saved);
    }
    this.element?.removeEventListener("click", this._boundHandleClick);
    this.element?.addEventListener("click", this._boundHandleClick);
    this.element?.removeEventListener("dragstart", this._boundHandleDragStart);
    this.element?.addEventListener("dragstart", this._boundHandleDragStart);
    this.element?.removeEventListener("dragover", this._boundHandleDragOver);
    this.element?.addEventListener("dragover", this._boundHandleDragOver);
    this.element?.removeEventListener("dragleave", this._boundHandleDragLeave);
    this.element?.addEventListener("dragleave", this._boundHandleDragLeave);
    this.element?.removeEventListener("drop", this._boundHandleDrop);
    this.element?.addEventListener("drop", this._boundHandleDrop);
    this.element?.addEventListener("close", () => this._savePos());
  }

  async close(options) {
    this._savePos();
    return super.close(options);
  }

  _savePos() {
    try {
      const pos = this.position;
      localStorage.setItem(POS_KEY, JSON.stringify({
        left: pos.left,
        top: pos.top,
        width: pos.width,
        height: pos.height,
      }));
    } catch {}
  }

  _loadPos() {
    try {
      return JSON.parse(localStorage.getItem(POS_KEY) || "null");
    } catch {
      return null;
    }
  }

  async _handleClick(event) {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    event.preventDefault();
    const action = btn.dataset.action;
    try {
      if (action === "refresh") {
        this.render();
      } else if (action === "toggle-block") {
        this._toggleBlock(btn.dataset.blockId);
        this.render();
      } else if (action === "create-trait") {
        const actor = this._defaultTraitActor();
        const data = await promptTraitCreateData({ actor, allowScene: true, defaultScope: actor ? "actor" : "scene" });
        if (!data) return;
        await createTraitFromData(data);
        this.render();
      } else if (action === "create-scene-actor") {
        const existing = getSceneTraitActor();
        if (existing) {
          existing.sheet?.render?.(true);
          return;
        }
        await createSceneTraitActor();
        ui.notifications.info("STA2e Toolkit: Scene trait actor created and linked.");
        this.render();
      } else if (action === "unlink-scene-actor") {
        const actor = getSceneTraitActor();
        if (!actor) return;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Unlink Scene Trait Actor" },
          content: `<p>Unlink <strong>${escapeHtml(actor.name)}</strong> from this scene? The Actor will not be deleted.</p>`,
        });
        if (!confirmed) return;
        await unlinkSceneTraitActor();
        this.render();
      } else if (action === "open-scene-actor") {
        getSceneTraitActor()?.sheet?.render?.(true);
      } else if (action === "spend-create") {
        const token = canvas.tokens?.controlled?.[0] ?? null;
        const actor = token?.actor ?? this._defaultTraitActor();
        await promptSpendCreateTrait({ actor, token, allowScene: true });
        this.render();
      } else if (action === "add-scene-trait") {
        const creatorActor = this._defaultTraitActor();
        const data = await promptTraitCreateData({ actor: creatorActor, allowScene: true, title: "Create Scene Trait", defaultScope: "scene" });
        if (!data) return;
        await createSceneTrait({
          ...data,
          creatorActor,
          automation: defaultAutomation({ duration: data.duration, sourceTags: data.sourceTags ?? [] }),
        });
        this.render();
      } else if (action === "add-actor-trait") {
        const actor = game.actors.get(btn.dataset.actorId);
        const data = await promptTraitCreateData({ actor, allowScene: false, title: `Create Trait - ${actor?.name ?? "Actor"}` });
        if (!data || !actor) return;
        await createActorTrait(actor, {
          ...data,
          automation: defaultAutomation({ duration: data.duration, sourceTags: data.sourceTags ?? [] }),
        });
        this.render();
      } else if (action === "remove-trait") {
        await this._removeTrait(btn.closest(".sta2e-tm-row"));
        this.render();
      } else if (action === "edit-trait") {
        await this._editTrait(btn.closest(".sta2e-tm-row"));
        this.render();
      } else if (action === "bulk-remove-temp") {
        await this._bulkRemoveTemporary();
        this.render();
      }
    } catch (err) {
      console.error("STA2e Toolkit | Trait manager action failed:", err);
      ui.notifications.error("STA2e Toolkit: Trait manager action failed. See console.");
    }
  }

  _handleDragStart(event) {
    const row = event.target.closest(".sta2e-tm-row");
    if (!row) return;
    const payload = {
      type: "STA2eTrait",
      scope: row.dataset.scope,
      traitId: row.dataset.traitId,
      actorId: row.dataset.actorId || null,
      actorUuid: row.dataset.actorUuid || null,
    };
    const encoded = JSON.stringify(payload);
    event.dataTransfer?.setData("text/plain", encoded);
    event.dataTransfer?.setData("application/json", encoded);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
  }

  _handleDragOver(event) {
    const zone = event.target.closest("[data-scene-actor-drop]");
    if (!zone || !game.user.isGM) return;
    event.preventDefault();
    zone.classList.add("is-dragover");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  _handleDragLeave(event) {
    const zone = event.target.closest("[data-scene-actor-drop]");
    if (!zone) return;
    const related = event.relatedTarget;
    if (related && zone.contains(related)) return;
    zone.classList.remove("is-dragover");
  }

  async _handleDrop(event) {
    const zone = event.target.closest("[data-scene-actor-drop]");
    if (!zone || !game.user.isGM) return;
    event.preventDefault();
    zone.classList.remove("is-dragover");
    const data = this._dropData(event);
    if (!data) {
      ui.notifications.warn("STA2e Toolkit: Could not read actor drop data.");
      return;
    }
    if (data.type === "Token" || String(data.uuid ?? "").includes(".Token.")) {
      ui.notifications.warn("STA2e Toolkit: Drop a scenetraits Actor from the Actors directory, not a Token.");
      return;
    }
    const actor = await this._actorFromDropData(data);
    if (!actor) {
      ui.notifications.warn("STA2e Toolkit: Drop a scenetraits Actor from the Actors directory.");
      return;
    }
    if (actor.type !== "scenetraits") {
      ui.notifications.warn("STA2e Toolkit: Scene Traits needs an Actor of type scenetraits.");
      return;
    }
    await linkSceneTraitActor(actor);
    ui.notifications.info(`STA2e Toolkit: Linked ${actor.name} as this scene's trait actor.`);
    this.render();
  }

  _dropData(event) {
    try {
      const text = event.dataTransfer?.getData("text/plain")
        || event.dataTransfer?.getData("application/json")
        || "";
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  async _actorFromDropData(data) {
    if (!data) return null;
    if (data.uuid) {
      try {
        const doc = typeof fromUuid === "function" ? await fromUuid(data.uuid) : null;
        if (doc?.documentName === "Actor") return doc;
      } catch {
        return null;
      }
    }
    if (data.type === "Actor" && data.id) return game.actors.get(data.id) ?? null;
    return null;
  }

  _defaultTraitActor() {
    return canvas.tokens?.controlled?.[0]?.actor
      ?? game.user.character
      ?? visibleTraitActors().find(actor => canEditActorTraits(actor))
      ?? null;
  }

  _toggleBlock(blockId) {
    if (!blockId) return;
    if (this._collapsed.has(blockId)) this._collapsed.delete(blockId);
    else this._collapsed.add(blockId);
    this._saveCollapsed();
  }

  _loadCollapsed() {
    try {
      const value = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]");
      return new Set(Array.isArray(value) ? value : []);
    } catch {
      return new Set();
    }
  }

  _saveCollapsed() {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(this._collapsed)));
    } catch {}
  }

  async _removeTrait(row) {
    if (!row) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remove Trait" },
      content: `<p>Remove this trait?</p>`,
    });
    if (!confirmed) return;
    if (row.dataset.scope === "scene") {
      await removeSceneTrait(row.dataset.traitId);
    } else {
      const actor = this._actorFromRow(row);
      if (actor && canEditActorTraits(actor)) await actor.deleteEmbeddedDocuments("Item", [row.dataset.traitId]);
    }
  }

  async _editTrait(row) {
    if (!row) return;
    const trait = this._resolveTrait(row);
    if (!trait) return;
    const automation = trait.automation ?? defaultAutomation();
    const first = automation.effects?.[0] ?? {};
    const creatorName = automation.createdBy?.name ?? "Unknown";
    const content = `
      <form class="sta2e-tm-edit">
        <div class="sta2e-trait-form-grid">
          <label>Created By</label>
          <div class="sta2e-tm-readonly">${escapeHtml(creatorName)}</div>
          <label>Duration</label>
          <select name="duration">
            ${["persistent", "scene", "single-task"].map(v => `<option value="${v}" ${automation.duration === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>
          <label>Source Tags</label>
          <input name="sourceTags" value="${escapeHtml((automation.sourceTags ?? []).join(", "))}" placeholder="equipment, scene" />
          <label>Effect Type</label>
          <select name="effectType">
            ${["note", "difficulty", "reroll", "bonusMomentum", "bonusThreat", "complicationRange", "possible", "impossible"].map(v => `<option value="${v}" ${first.type === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>
          <label>Effect Label</label>
          <input name="effectLabel" value="${escapeHtml(first.label ?? "")}" />
          <label>Amount</label>
          <div class="sta2e-tm-readonly">Uses trait Potency ${traitQuantity(trait)}</div>
          <label>Task Keys</label>
          <input name="taskKeys" value="${escapeHtml((first.match?.taskKeys ?? []).join(", "))}" placeholder="attack-pattern, create-trait" />
          <label>Station IDs</label>
          <input name="stationIds" value="${escapeHtml((first.match?.stationIds ?? []).join(", "))}" placeholder="tactical, sensors" />
          <label>Tags</label>
          <input name="weaponTags" value="${escapeHtml((first.match?.weaponTags ?? []).join(", "))}" placeholder="attack, torpedo, ground" />
        </div>
      </form>`;
    let formResult = null;
    const action = await foundry.applications.api.DialogV2.wait({
      window: { title: `Trait Automation - ${trait.name}` },
      content,
      rejectClose: false,
      buttons: [
        {
          action: "save",
          label: "Save",
          icon: "fas fa-save",
          default: true,
          callback: (_event, _button, dialog) => {
            const form = dialog.element.querySelector(".sta2e-tm-edit");
            const fd = form ? new FormData(form) : null;
            if (!fd) return;
            const split = name => String(fd.get(name) ?? "")
              .split(",")
              .map(s => s.trim())
              .filter(Boolean);
            const effectType = String(fd.get("effectType") ?? "note");
            formResult = defaultAutomation({
              duration: String(fd.get("duration") ?? "persistent"),
              createdBy: automation.createdBy ?? null,
              sourceTags: split("sourceTags"),
              effects: [{
                id: "primary",
                type: effectType,
                label: String(fd.get("effectLabel") ?? "") || effectType,
                value: 0,
                scalesWithQuantity: false,
                match: {
                  taskKeys: split("taskKeys"),
                  stationIds: split("stationIds"),
                  weaponTags: split("weaponTags"),
                },
              }],
            });
            return formResult;
          },
        },
        { action: "clear", label: "Clear Automation", icon: "fas fa-eraser" },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
      render: (_event, dialog) => {
        const form = dialog.element.querySelector(".sta2e-tm-edit");
        form?.addEventListener("submit", event => event.preventDefault());
      },
    });
    if (!action || action === "cancel") return;
    if (action === "clear") {
      await this._saveTraitAutomation(row, defaultAutomation({
        duration: "persistent",
        createdBy: automation.createdBy ?? null,
      }));
      return;
    }
    const automationResult = action && typeof action === "object" ? action : formResult;
    if (automationResult) await this._saveTraitAutomation(row, automationResult);
  }

  _resolveTrait(row) {
    if (row.dataset.scope === "scene") {
      return getSceneTraitRecords().find(t => (t.itemId ?? t.id) === row.dataset.traitId);
    }
    const actor = this._actorFromRow(row);
    return getActorTraitRecords(actor).find(t => t.itemId === row.dataset.traitId);
  }

  _actorFromRow(row) {
    const uuid = row?.dataset?.actorUuid;
    let actor = null;
    if (uuid && typeof fromUuidSync === "function") actor = fromUuidSync(uuid);
    return actor ?? game.actors.get(row?.dataset?.actorId) ?? null;
  }

  async _saveTraitAutomation(row, automation) {
    if (row.dataset.scope === "scene") {
      await updateSceneTraitItem(row.dataset.traitId, { automation });
      return;
    }
    const actor = this._actorFromRow(row);
    if (!actor || !actor.items?.get(row.dataset.traitId) || !canEditActorTraits(actor)) {
      ui.notifications.warn("STA2e Toolkit: Could not find an editable trait item to save metadata.");
      return;
    }
    await updateActorTraitItem(actor, row.dataset.traitId, { automation });
  }

  async _bulkRemoveTemporary() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Clear Temporary Traits" },
      content: `<p>Remove scene and actor traits marked scene or single-task duration from visible actors?</p>`,
    });
    if (!confirmed) return;

    const sceneKeep = getSceneTraitRecords()
      .filter(t => !["scene", "single-task"].includes(t.automation?.duration))
      .map(t => ({
        id: t.id,
        itemId: t.itemId,
        name: t.name,
        img: t.img,
        description: t.description,
        quantity: t.quantity,
        automation: t.automation,
      }));
    await setSceneTraits(sceneKeep);

    for (const actor of visibleTraitActors()) {
      const toDelete = getActorTraitRecords(actor)
        .filter(t => ["scene", "single-task"].includes(t.automation?.duration))
        .map(t => t.itemId);
      if (toDelete.length && canEditActorTraits(actor)) {
        await actor.deleteEmbeddedDocuments("Item", toDelete);
      }
    }
  }
}
