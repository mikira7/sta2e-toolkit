/**
 * sta2e-toolkit | sfx-board.js
 * Audio SFX Board — data model, playback, and the GM configuration app.
 *
 * Entries live in one world setting so every client can read them:
 *   { entries: [ { id, label, path, volume, players } ] }
 *
 * `players` gates which buttons a non-GM sees in the widget. World settings are
 * readable by everyone, so this is a UI filter rather than a security boundary —
 * same contract as `playersCanSetAlert` in alert-hud.js.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const MODULE_ID  = "sta2e-toolkit";
export const SFX_SETTING = "sfxBoardEntries";

const DEFAULT_VOLUME = 0.8;

// ── Data ─────────────────────────────────────────────────────────────────────

function clampVolume(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, num));
}

/** Coerce whatever is stored into a clean array of entries. */
export function normalizeSfxEntries(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : [];
  return list
    .filter(entry => entry && typeof entry === "object")
    .map(entry => ({
      id:      String(entry.id || foundry.utils.randomID()),
      label:   String(entry.label ?? "").trim(),
      path:    String(entry.path ?? "").trim(),
      volume:  clampVolume(entry.volume),
      players: entry.players === true,
    }))
    .filter(entry => entry.path);
}

/** All configured entries, normalized. */
export function getSfxEntries() {
  try {
    return normalizeSfxEntries(game.settings.get(MODULE_ID, SFX_SETTING));
  } catch {
    return [];
  }
}

/** Entries the current user is allowed to see in the widget. */
export function getVisibleSfxEntries() {
  const entries = getSfxEntries();
  if (game.user?.isGM) return entries;
  return entries.filter(entry => entry.players);
}

/** Display label with a sane fallback when the GM left the name blank. */
export function sfxDisplayLabel(entry) {
  if (entry?.label) return entry.label;
  const file = String(entry?.path ?? "").split("/").pop() ?? "";
  return decodeURIComponent(file.replace(/\.[^.]+$/, "")) || "Sound";
}

// ── Playback ─────────────────────────────────────────────────────────────────

/**
 * Play an entry for every connected client.
 * The `true` second argument is Foundry's own socket broadcast — the same idiom
 * used by transporter.js and warp-jump-vfx.js. Volume stacks on top of each
 * listener's Foundry interface-volume slider.
 */
export function playSfx(entry) {
  if (!entry?.path) return;
  const AudioHelper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
  if (!AudioHelper?.play) return;
  try {
    AudioHelper.play({
      src:      entry.path,
      volume:   clampVolume(entry.volume),
      autoplay: true,
      loop:     false,
    }, true);
  } catch (err) {
    console.error("STA2e Toolkit | SFX playback failed:", entry.path, err);
  }
}

/** Play locally only — used by the config dialog's audition button. */
export function previewSfxLocal(path, volume = DEFAULT_VOLUME) {
  if (!path) return;
  try {
    const audio = new Audio(path);
    audio.volume = clampVolume(volume);
    audio.play().catch(err => console.warn("STA2e Toolkit | SFX preview blocked:", err));
  } catch (err) {
    console.error("STA2e Toolkit | SFX preview failed:", path, err);
  }
}

// ── Configuration app ────────────────────────────────────────────────────────

export class SfxBoardConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sta2e-sfx-board-config",
    tag: "div",
    classes: ["sta2e-sfx-config-window"],
    window: { title: "Audio SFX Board", resizable: true },
    position: { width: 780, height: 560 },
    actions: {
      save:      SfxBoardConfig._onSave,
      cancel:    SfxBoardConfig._onCancel,
      addSfx:    SfxBoardConfig._onAddSfx,
      deleteSfx: SfxBoardConfig._onDeleteSfx,
      previewSfx: SfxBoardConfig._onPreviewSfx,
    },
  };

  static PARTS = {
    config: { template: "modules/sta2e-toolkit/templates/sfx-board.hbs" },
  };

  async _prepareContext(_options) {
    return {
      entries: getSfxEntries().map(entry => ({
        ...entry,
        volumePct: Math.round(entry.volume * 100),
      })),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._bindRowControls(this.element);
  }

  /** Wire the browse button and the live volume readout for a row (or the whole form). */
  _bindRowControls(root) {
    root.querySelectorAll("[data-browse-sfx]").forEach(button => {
      button.addEventListener("click", () => {
        const row   = button.closest("[data-sfx-entry]");
        const input = row?.querySelector("[data-sfx-path]");
        const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        if (!input || typeof FP !== "function") return;
        new FP({
          type: "audio",
          current: input.value || "",
          callback: path => {
            input.value = path;
            input.dispatchEvent(new Event("change", { bubbles: true }));
          },
        }).render(true);
      });
    });

    root.querySelectorAll("[data-sfx-volume]").forEach(slider => {
      const sync = () => {
        const out = slider.closest("[data-sfx-entry]")?.querySelector("[data-sfx-volume-readout]");
        if (out) out.textContent = `${slider.value}%`;
      };
      sync();
      slider.addEventListener("input", sync);
      slider.addEventListener("change", sync);
    });
  }

  _appendRow() {
    const list = this.element.querySelector(".sta2e-sfx-cfg-list");
    if (!list) return;
    list.querySelector(".sta2e-sfx-cfg-empty")?.remove();

    const row = document.createElement("div");
    row.className = "sta2e-sfx-cfg-row";
    row.dataset.sfxEntry = "";
    row.dataset.sfxId = foundry.utils.randomID();
    row.innerHTML = `
      <input type="text" data-sfx-label value="" placeholder="Sound name" />
      <input type="text" data-sfx-path value="" placeholder="path/to/sound.ogg" />
      <button type="button" data-browse-sfx title="Browse audio"><i class="fas fa-folder-open"></i></button>
      <button type="button" data-action="previewSfx" title="Preview (you only)"><i class="fas fa-play"></i></button>
      <div class="sta2e-sfx-cfg-volume">
        <input type="range" data-sfx-volume min="0" max="100" step="5" value="${Math.round(DEFAULT_VOLUME * 100)}" />
        <span data-sfx-volume-readout>${Math.round(DEFAULT_VOLUME * 100)}%</span>
      </div>
      <label class="sta2e-sfx-cfg-players" title="Players can use this sound">
        <input type="checkbox" data-sfx-players />
      </label>
      <button type="button" data-action="deleteSfx" title="Remove sound"><i class="fas fa-trash"></i></button>`;

    list.appendChild(row);
    this._bindRowControls(row);
    row.querySelector("[data-sfx-label]")?.focus();
  }

  static async _onSave(_event, _target) {
    const entries = [];
    for (const row of this.element.querySelectorAll("[data-sfx-entry]")) {
      const path = row.querySelector("[data-sfx-path]")?.value?.trim() ?? "";
      if (!path) continue;
      entries.push({
        id:      row.dataset.sfxId || foundry.utils.randomID(),
        label:   row.querySelector("[data-sfx-label]")?.value?.trim() ?? "",
        path,
        volume:  clampVolume(Number(row.querySelector("[data-sfx-volume]")?.value ?? 80) / 100),
        players: row.querySelector("[data-sfx-players]")?.checked === true,
      });
    }

    await game.settings.set(MODULE_ID, SFX_SETTING, { entries });

    // Refresh every client's widget without a reload.
    game.sta2eToolkit?.sfxWidget?.refresh?.();
    game.socket.emit("module.sta2e-toolkit", { action: "sfxBoardUpdated" });

    this.close();
  }

  static _onCancel(_event, _target) {
    this.close();
  }

  static async _onAddSfx(_event, _target) {
    this._appendRow();
  }

  static async _onDeleteSfx(_event, target) {
    const row  = target.closest("[data-sfx-entry]");
    const list = row?.closest(".sta2e-sfx-cfg-list");
    row?.remove();
    if (list && !list.querySelector("[data-sfx-entry]")) {
      const empty = document.createElement("div");
      empty.className = "sta2e-sfx-cfg-empty";
      empty.textContent = "No sounds configured.";
      list.appendChild(empty);
    }
  }

  static async _onPreviewSfx(_event, target) {
    const row    = target.closest("[data-sfx-entry]");
    const path   = row?.querySelector("[data-sfx-path]")?.value?.trim();
    const volume = Number(row?.querySelector("[data-sfx-volume]")?.value ?? 80) / 100;
    previewSfxLocal(path, volume);
  }
}
