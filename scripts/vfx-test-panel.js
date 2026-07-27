/**
 * sta2e-toolkit | vfx-test-panel.js
 *
 * Session-only native VFX playground.
 */

import {
  NativeTractorBeamVFX,
  getTractorBeamVfxDefaults,
  getMergedTractorBeamVfxSettings,
  getTractorBeamVfxPresets,
  resetTractorBeamVfxClientSettings,
  saveTractorBeamVfxClientSettings,
  saveTractorBeamVfxWorldSettings,
} from "./tractor-beam-vfx.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function _firstTarget() {
  return Array.from(game.user?.targets ?? [])[0] ?? null;
}

function _numberFrom(root, name, fallback) {
  const value = Number(root.querySelector(`[name="${name}"]`)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function _readForm(root, defaults) {
  const preset = root.querySelector('[name="preset"]')?.value ?? defaults.preset;
  return {
    preset,
    color: root.querySelector('[name="color"]')?.value?.trim() || defaults.color,
    placement: root.querySelector('[name="placement"]')?.value === "below" ? "below" : "above",
    duration: _numberFrom(root, "duration", defaults.duration),
    opacity: _numberFrom(root, "opacity", defaults.opacity),
    pulseSpeed: _numberFrom(root, "pulseSpeed", defaults.pulseSpeed),
  };
}

export class VFXTestPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sta2e-vfx-test-panel",
    tag: "div",
    window: { title: "STA2e - VFX Test Panel", resizable: false },
    position: { width: 420, height: 430 },
    actions: {
      play: VFXTestPanel._onPlay,
      stop: VFXTestPanel._onStop,
      saveClient: VFXTestPanel._onSaveClient,
      saveWorld: VFXTestPanel._onSaveWorld,
      reset: VFXTestPanel._onReset,
      close: VFXTestPanel._onClose,
    },
  };

  static PARTS = {
    panel: { template: "modules/sta2e-toolkit/templates/vfx-test-panel.hbs" },
  };

  constructor(options = {}) {
    super(options);
    this._values = getMergedTractorBeamVfxSettings();
  }

  async _prepareContext(_options) {
    const source = canvas.tokens?.controlled?.[0] ?? null;
    const target = _firstTarget();
    const presets = getTractorBeamVfxPresets().map(preset => ({
      ...preset,
      selected: preset.id === this._values.preset,
    }));

    return {
      values: foundry.utils.deepClone(this._values),
      presets,
      placementAbove: this._values.placement !== "below",
      placementBelow: this._values.placement === "below",
      sourceName: source?.name ?? "No source selected",
      targetName: target?.name ?? "No target targeted",
      hasActive: NativeTractorBeamVFX.hasActive(),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    if (!el) return;

    el.querySelector('[name="preset"]')?.addEventListener("change", event => {
      const selected = getTractorBeamVfxPresets().find(preset => preset.id === event.currentTarget.value);
      const colorInput = el.querySelector('[name="color"]');
      const colorPicker = el.querySelector("[data-color-picker]");
      if (selected?.color && colorInput) colorInput.value = selected.color;
      if (selected?.color && colorPicker) colorPicker.value = selected.color;
    });

    const colorInput = el.querySelector('[name="color"]');
    const colorPicker = el.querySelector("[data-color-picker]");
    colorInput?.addEventListener("input", event => {
      if (/^#[0-9a-f]{6}$/i.test(event.currentTarget.value) && colorPicker) {
        colorPicker.value = event.currentTarget.value;
      }
    });
    colorPicker?.addEventListener("input", event => {
      if (colorInput) colorInput.value = event.currentTarget.value;
    });

    el.querySelectorAll("[data-sync-range]").forEach(range => {
      const number = el.querySelector(`[data-sync-number="${range.dataset.syncRange}"]`);
      const output = el.querySelector(`[data-sync-output="${range.dataset.syncRange}"]`);
      const sync = source => {
        if (number && source === range) number.value = range.value;
        if (range && source === number) range.value = number.value;
        if (output) output.textContent = source.value;
      };
      range.addEventListener("input", event => sync(event.currentTarget));
      number?.addEventListener("input", event => sync(event.currentTarget));
    });
  }

  static _onPlay(_event, _target) {
    const defaults = getTractorBeamVfxDefaults();
    this._values = _readForm(this.element, defaults);
    NativeTractorBeamVFX.testSelectedToTargeted(this._values);
    this.render({ force: true });
  }

  static _onStop(_event, _target) {
    const defaults = getTractorBeamVfxDefaults();
    this._values = _readForm(this.element, defaults);
    NativeTractorBeamVFX.stopActive();
    this.render({ force: true });
  }

  static async _onSaveClient(_event, _target) {
    const defaults = getTractorBeamVfxDefaults();
    this._values = _readForm(this.element, defaults);
    await saveTractorBeamVfxClientSettings(this._values);
    ui.notifications.info("STA2e Toolkit: Tractor beam VFX client settings saved.");
    this.render({ force: true });
  }

  static async _onSaveWorld(_event, _target) {
    const defaults = getTractorBeamVfxDefaults();
    this._values = _readForm(this.element, defaults);
    await saveTractorBeamVfxWorldSettings(this._values);
    ui.notifications.info("STA2e Toolkit: Tractor beam VFX world defaults saved.");
    this.render({ force: true });
  }

  static async _onReset(_event, _target) {
    await resetTractorBeamVfxClientSettings();
    this._values = getMergedTractorBeamVfxSettings();
    ui.notifications.info("STA2e Toolkit: Tractor beam VFX client override reset.");
    this.render({ force: true });
  }

  static _onClose(_event, _target) {
    this.close();
  }
}
