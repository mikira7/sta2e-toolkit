/**
 * sta2e-toolkit | alert-hud.js
 * Condition Alert Widget
 *
 * Visibility behaviour:
 *   - Hidden by default on load.
 *   - When condition changes, auto-shows for 10 seconds then auto-hides.
 *   - Tab click toggles "pinned open" state (per user, localStorage).
 *   - When pinned, auto-hide timer never fires — widget stays open.
 *   - Either GM or players can pin/unpin independently.
 *   - Tab shows ▲ when visible, ▼ when hidden, with a • dot when pinned.
 *
 * Conditions: "green" | "blue" | "yellow" | "red"
 * Only GM can change condition. All clients see it via socket.
 */

const CONDITIONS = ["green", "blue", "yellow", "red"];

// Condition display names resolved at render time via i18n
function conditionName(c) {
  return game.i18n.localize(`STA2E.Alert.Condition.${c.charAt(0).toUpperCase() + c.slice(1)}`);
}

// Sound setting keys — { red, blue } per era
const ERA_SOUND_SETTINGS = {
  tng:    { red: "alertSoundRedTNG", blue: "alertSoundBlueTNG" },
  tos:    { red: "alertSoundRedTOS", blue: "alertSoundBlueTOS" },
  tmp:    { red: "alertSoundRedTOS", blue: "alertSoundBlueTOS" },
  ent:    { red: "alertSoundRedENT", blue: "alertSoundBlueENT" },
  custom: { red: "alertSoundRedTNG", blue: "alertSoundBlueTNG" },
};

const AUTO_HIDE_MS = 10_000;   // 10 seconds

// Resolve the current HUD theme string from active campaign or global setting
function resolveTheme() {
  try {
    const campaign = game.sta2eToolkit?.getActiveCampaign?.();
    const global   = game.settings.get("sta2e-toolkit", "hudTheme") ?? "blue";
    return campaign?.theme ?? global;
  } catch { return "blue"; }
}

export class AlertHUD {

  constructor() {
    this._container  = null;
    this._tab        = null;
    this._widget     = null;
    this._audio      = null;
    this._autoHideTimer = null;
  }

  // ── Persistence (per-user localStorage) ────────────────────────────────────

  get _pinnedKey()   { return `sta2e-alert-pinned-${game.userId}`; }
  get _isPinned()    { return localStorage.getItem(this._pinnedKey) === "1"; }
  _setPinned(val)    { localStorage.setItem(this._pinnedKey, val ? "1" : "0"); }

  // ── Visibility helpers ──────────────────────────────────────────────────────

  _isVisible() {
    return this._container && !this._container.classList.contains("sta2e-alert--collapsed");
  }

  _show() {
    if (!this._container) return;
    this._container.classList.remove("sta2e-alert--collapsed");
    if (this._tab) this._tab.innerHTML = this._isPinned ? "▲ •" : "▲";
  }

  _hide() {
    if (!this._container) return;
    this._container.classList.add("sta2e-alert--collapsed");
    if (this._tab) this._tab.innerHTML = this._isPinned ? "▼ •" : "▼";
  }

  /** Show for 10 s then auto-hide, unless pinned. */
  _showTemporary() {
    this._cancelAutoHide();
    this._show();
    if (this._isPinned) return;   // pinned — no timer
    this._autoHideTimer = setTimeout(() => {
      this._autoHideTimer = null;
      if (!this._isPinned) this._hide();
    }, AUTO_HIDE_MS);
  }

  _cancelAutoHide() {
    if (this._autoHideTimer) {
      clearTimeout(this._autoHideTimer);
      this._autoHideTimer = null;
    }
  }

  // ── State ──────────────────────────────────────────────────────────────────

  get condition() {
    return game.settings.get("sta2e-toolkit", "alertCondition") ?? "green";
  }

  async _setCondition(level) {
    const canChange = game.user.isGM
      || (game.settings.get("sta2e-toolkit", "playersCanSetAlert") ?? false);
    if (!canChange) return;

    const prev = this.condition;

    if (game.user.isGM) {
      // GM writes the world setting directly then broadcasts
      await game.settings.set("sta2e-toolkit", "alertCondition", level);
      game.socket.emit("module.sta2e-toolkit", { action: "setAlert", condition: level });
      this._onConditionChanged(prev, level);
    } else {
      // Players can't write world-scoped settings — request the GM to do it.
      // socket.emit goes to all OTHER clients only, so it never comes back to us.
      // We update our own UI directly here; the GM broadcast will update everyone else.
      game.socket.emit("module.sta2e-toolkit", { action: "requestSetAlert", condition: level });
      this._onConditionChanged(prev, level);
    }
  }

  /** Called on both GM and player clients after a condition change. */
  _onConditionChanged(prev, next) {
    // Update widget content and alert bar
    if (this._widget) this._widget.innerHTML = this._buildWidgetHTML();
    if (this._container) {
      this._container.className = `sta2e-alert--${next}${this._container.classList.contains("sta2e-alert--collapsed") ? " sta2e-alert--collapsed" : ""}`;;
      this._container.dataset.theme = resolveTheme();
    }
    this._activateListeners();
    this._updateAlertBar();

    // Auto-show for 10 s on any condition change
    this._showTemporary();

    // Sound
    const soundLevels = ["red", "blue"];
    if (soundLevels.includes(next)) {
      this._playAlert(next);
    } else if (soundLevels.includes(prev)) {
      this._stopAlert();
    }
  }

  // ── Sound ──────────────────────────────────────────────────────────────────

  _getSoundPath(level) {
    const campaign   = game.sta2eToolkit?.getActiveCampaign?.();
    const era        = campaign?.era ?? "tng";
    const keys       = ERA_SOUND_SETTINGS[era] ?? ERA_SOUND_SETTINGS.tng;
    const settingKey = keys[level];
    if (!settingKey) return "";
    return game.settings.get("sta2e-toolkit", settingKey) ?? "";
  }

  _playAlert(level) {
    this._stopAlert();
    const path = this._getSoundPath(level);
    if (!path) return;
    try {
      const audio  = new Audio(path);
      audio.loop   = game.settings.get("sta2e-toolkit", "alertSoundLoop") ?? true;
      audio.volume = game.settings.get("sta2e-toolkit", "alertVolume") ?? 0.7;
      audio.play().catch(err => console.warn("STA 2e Toolkit | Alert sound failed:", err));
      this._audio = audio;
    } catch (e) {
      console.warn("STA 2e Toolkit | Could not load alert sound:", e);
    }
  }

  _stopAlert() {
    if (this._audio) {
      this._audio.pause();
      this._audio.currentTime = 0;
      this._audio = null;
    }
  }

  // ── HTML ───────────────────────────────────────────────────────────────────

  _buildWidgetHTML() {
    const cond      = this.condition;
    const name      = conditionName(cond);
    const isGM      = game.user.isGM;
    const canChange = isGM || (game.settings.get("sta2e-toolkit", "playersCanSetAlert") ?? false);

    const toggles = CONDITIONS.map(c => {
      const label  = conditionName(c);
      const active = c === cond;
      const title  = active
        ? game.i18n.format("STA2E.Alert.Tooltip.Current", { label })
        : (canChange
            ? game.i18n.format("STA2E.Alert.Tooltip.CanChange", { label })
            : game.i18n.format("STA2E.Alert.Tooltip.CannotChange", { label }));
      return `<button type="button"
        class="sta2e-alert__toggle sta2e-alert__toggle--${c}${active ? " sta2e-alert__toggle--active" : ""}"
        data-condition="${c}"
        title="${title}"
        ${active || !canChange ? "disabled" : ""}
      ><span class="sta2e-alert__toggle-label">${label}</span></button>`;
    }).join("");

    return `
      <div class="sta2e-alert__body sta2e-alert__body--${cond}">
        <div class="sta2e-alert__bar-block sta2e-alert__bar-block--${cond}"></div>
        <div class="sta2e-alert__text-block">
          <span class="sta2e-alert__heading sta2e-alert__heading--${cond}">${game.i18n.localize("STA2E.Alert.Heading")}</span>
          <span class="sta2e-alert__subline sta2e-alert__subline--${cond}">${game.i18n.format("STA2E.Alert.Subline", { label: name })}</span>
        </div>
        <div class="sta2e-alert__bar-block sta2e-alert__bar-block--${cond}"></div>
      </div>
      <div class="sta2e-alert__toggles">${toggles}</div>`;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  render() {
    const cond   = this.condition;
    const pinned = this._isPinned;

    if (!this._container) {
      const container = document.createElement("div");
      container.id        = "sta2e-alert-container";
      container.className = `sta2e-alert--${cond} sta2e-alert--collapsed`; // hidden by default
      container.dataset.theme = resolveTheme();

      // Tab
      const tab = document.createElement("button");
      tab.id        = "sta2e-alert-tab";
      tab.type      = "button";
      tab.title     = game.i18n.localize("STA2E.Alert.Tab.ShowHide");
      tab.innerHTML = pinned ? "▼ •" : "▼";
      tab.addEventListener("click", () => this._togglePin());

      // Widget
      const widget = document.createElement("div");
      widget.id        = "sta2e-alert-widget";
      widget.innerHTML = this._buildWidgetHTML();

      container.appendChild(tab);
      container.appendChild(widget);

      const target = document.getElementById("interface") ?? document.body;
      target.appendChild(container);

      this._container = container;
      this._tab       = tab;
      this._widget    = widget;

      // If pinned from a previous session, show it immediately
      if (pinned) this._show();

    } else {
      this._widget.innerHTML = this._buildWidgetHTML();
      this._container.className = `sta2e-alert--${cond}${this._container.classList.contains("sta2e-alert--collapsed") ? " sta2e-alert--collapsed" : ""}`;;
      this._container.dataset.theme = resolveTheme();
      if (this._tab) this._tab.innerHTML = pinned
        ? (this._isVisible() ? "▲ •" : "▼ •")
        : (this._isVisible() ? "▲"   : "▼");
    }

    this._activateListeners();
    this._updateAlertBar();
  }

  /** Tab click: toggle pinned state.
   *  If pinning → show and cancel any auto-hide timer.
   *  If unpinning → hide immediately.
   */
  _togglePin() {
    const next = !this._isPinned;
    this._setPinned(next);
    if (next) {
      // Pinning — show and lock open
      this._cancelAutoHide();
      this._show();
    } else {
      // Unpinning — hide right away
      this._cancelAutoHide();
      this._hide();
    }
  }

  _refreshTheme() {
    if (!this._container) return;
    this._container.dataset.theme = resolveTheme();
  }

  _activateListeners() {
    if (!this._widget) return;
    const canChange = game.user.isGM
      || (game.settings.get("sta2e-toolkit", "playersCanSetAlert") ?? false);
    if (!canChange) return;

    this._widget.querySelectorAll("[data-condition]:not([disabled])").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        await this._setCondition(e.currentTarget.dataset.condition);
      });
    });
  }

  _updateAlertBar() {
    const hudEl = document.getElementById("sta2e-hud-container");
    if (!hudEl) return;
    hudEl.classList.remove("sta2e-alert-bar--red", "sta2e-alert-bar--yellow", "sta2e-alert-bar--blue");
    const cond = this.condition;
    if (cond === "red" || cond === "yellow" || cond === "blue") {
      hudEl.classList.add(`sta2e-alert-bar--${cond}`);
    }
  }

  /** Called when the alertVolume client setting changes — updates live audio. */
  updateVolume() {
    if (!this._audio) return;
    const vol = game.settings.get("sta2e-toolkit", "alertVolume") ?? 0.7;
    this._audio.volume = vol;
  }

  destroy() {
    this._cancelAutoHide();
    this._stopAlert();
    this._container?.remove();
    this._container = null;
    this._tab       = null;
    this._widget    = null;
  }
}
