/**
 * sta2e-toolkit | toolkit-pool-tracker.js
 * Experimental Momentum / Threat tracker widget.
 */

import { adjustPool, canUserAdjustPool, poolLimit, readPool, setPool } from "./pool-service.js";
import { getLcTokens } from "./lcars-theme.js";

const MODULE = "sta2e-toolkit";
const WIDGET_ID = "sta2e-pool-tracker";
const POS_KEY = "sta2e-toolkit.poolTrackerPos";
const COLLAPSE_KEY = "sta2e-toolkit.poolTrackerCollapsed";

function logTrackerError(stage, err) {
  console.error(`STA2e Toolkit | Pool tracker ${stage} failed:`, err);
}

function trackerMode() {
  try { return game.settings.get(MODULE, "poolTrackerMode") ?? "sta"; }
  catch { return "sta"; }
}

function trackerLayout() {
  try { return game.settings.get(MODULE, "poolTrackerLayout") ?? "docked"; }
  catch { return "docked"; }
}

function assetPath(pool) {
  return `modules/${MODULE}/assets/${pool}.svg`;
}

export class ToolkitPoolTracker {
  constructor() {
    this._el = null;
    this._observer = null;
    this._hooksRegistered = false;
    this._collapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
    this._onResize = () => this._applyLayout();
  }

  init() {
    try {
      if (!this._hooksRegistered) {
        this._hooksRegistered = true;
        Hooks.on("updateSetting", (setting) => {
          if (
            setting.key === "sta.momentum"
            || setting.key === "sta.threat"
            || setting.key === `${MODULE}.poolTrackerMode`
            || setting.key === `${MODULE}.poolTrackerLayout`
          ) {
            try {
              this.applyMode();
              this.refresh();
            } catch (err) {
              logTrackerError("settings refresh", err);
            }
          }
        });
      }
      window.addEventListener("resize", this._onResize);
      this._startObserver();
      this.applyMode();
    } catch (err) {
      logTrackerError("init", err);
    }
  }

  applyMode() {
    try {
      const useToolkit = trackerMode() === "toolkit";
      if (useToolkit) this.show();
      else this.hide();
      this._syncStaTrackerVisibility();
    } catch (err) {
      logTrackerError("mode apply", err);
    }
  }

  show() {
    try {
      if (!this._el) this._build();
      this._ensureAttached();
      this._el.hidden = false;
      this._applyLayout();
      this.refresh();
    } catch (err) {
      logTrackerError("show", err);
    }
  }

  hide() {
    if (this._el) this._el.hidden = true;
  }

  refresh() {
    if (!this._el) return;
    const momentum = this._el.querySelector('[data-pool-value="momentum"]');
    const threat = this._el.querySelector('[data-pool-value="threat"]');
    if (momentum && momentum.dataset.editing !== "1") {
      momentum.value = String(readPool("momentum"));
      momentum.dataset.committedValue = momentum.value;
    }
    if (threat && threat.dataset.editing !== "1") {
      threat.value = String(readPool("threat"));
      threat.dataset.committedValue = threat.value;
    }
    this._refreshControls();
  }

  _build() {
    try {
      const existing = document.getElementById(WIDGET_ID);
      if (existing && existing !== this._el) existing.remove();
      const LC = getLcTokens();

      const el = document.createElement("div");
      el.id = WIDGET_ID;
      el.className = "sta2e-pool-tracker sta2e-pool-tracker--auto-hide";
      el.style.setProperty("--sta2e-pool-bg", LC.bg ?? "#05080d");
      el.style.setProperty("--sta2e-pool-panel", LC.panel ?? "#101010");
      el.style.setProperty("--sta2e-pool-primary", LC.primary ?? "#ff9900");
      el.style.setProperty("--sta2e-pool-secondary", LC.secondary ?? "#89cff0");
      el.style.setProperty("--sta2e-pool-threat", LC.red ?? "#ff3344");
      el.style.setProperty("--sta2e-pool-text", LC.text ?? "#ffcc88");
      el.style.setProperty("--sta2e-pool-dim", LC.textDim ?? "#9a7a4a");
      el.style.setProperty("--sta2e-pool-font", LC.font ?? "var(--font-primary)");

      const header = document.createElement("div");
      header.className = "sta2e-pool-tracker__header";

      const title = document.createElement("div");
      title.className = "sta2e-pool-tracker__title";
      title.textContent = "Momentum / Threat";

      const layoutToggle = document.createElement("button");
      layoutToggle.type = "button";
      layoutToggle.className = "sta2e-pool-tracker__layout-toggle";
      layoutToggle.addEventListener("click", async (event) => {
        event.stopPropagation();
        const next = trackerLayout() === "floating" ? "docked" : "floating";
        await game.settings.set(MODULE, "poolTrackerLayout", next);
        this._applyLayout();
      });

      const collapse = document.createElement("button");
      collapse.type = "button";
      collapse.className = "sta2e-pool-tracker__collapse";
      collapse.title = "Collapse tracker";
      collapse.innerHTML = '<i class="fas fa-minus"></i>';
      collapse.addEventListener("click", (event) => {
        event.stopPropagation();
        this._collapsed = !this._collapsed;
        localStorage.setItem(COLLAPSE_KEY, this._collapsed ? "1" : "0");
        this._applyCollapsed();
      });

      header.appendChild(title);
      header.appendChild(layoutToggle);
      header.appendChild(collapse);

      const body = document.createElement("div");
      body.className = "sta2e-pool-tracker__body";
      body.appendChild(this._buildPool("momentum", "Momentum"));
      body.appendChild(this._buildPool("threat", "Threat"));

      el.appendChild(header);
      el.appendChild(body);

      this._el = el;
      this._ensureAttached();
      this._applyLayout();
      this._makeDraggable(header, el);
      this._applyCollapsed();
      this.refresh();
    } catch (err) {
      this._el = null;
      logTrackerError("build", err);
      throw err;
    }
  }

  _buildPool(pool, label) {
    const section = document.createElement("section");
    section.className = `sta2e-pool-tracker__pool sta2e-pool-tracker__pool--${pool}`;
    section.dataset.pool = pool;

    const token = document.createElement("div");
    token.className = "sta2e-pool-tracker__token";

    const img = document.createElement("img");
    img.src = assetPath(pool);
    img.alt = label;
    img.draggable = false;

    const value = document.createElement("input");
    value.type = "number";
    value.min = "0";
    value.step = "1";
    value.className = "sta2e-pool-tracker__value";
    value.dataset.poolValue = pool;
    value.title = `Set ${label}`;
    value.value = "0";
    value.dataset.committedValue = "0";
    value.addEventListener("mousedown", event => event.stopPropagation());
    value.addEventListener("click", event => {
      event.stopPropagation();
      value.select();
    });
    value.addEventListener("focus", () => {
      value.dataset.editing = "1";
      value.select();
    });
    value.addEventListener("blur", async () => {
      if (value.dataset.skipNextBlurApply === "1") {
        delete value.dataset.skipNextBlurApply;
        return;
      }
      await this._applyInlinePoolValue(pool, value);
    });
    value.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        await this._applyInlinePoolValue(pool, value);
        value.dataset.skipNextBlurApply = "1";
        value.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        value.value = String(readPool(pool));
        value.dataset.committedValue = value.value;
        delete value.dataset.editing;
        value.dataset.skipNextBlurApply = "1";
        value.blur();
      }
    });

    token.appendChild(img);
    token.appendChild(value);

    const controls = document.createElement("div");
    controls.className = "sta2e-pool-tracker__controls";

    controls.appendChild(this._buildButton(pool, -1));
    const name = document.createElement("div");
    name.className = "sta2e-pool-tracker__label";
    name.textContent = label;
    controls.appendChild(name);
    controls.appendChild(this._buildButton(pool, 1));

    section.appendChild(token);
    section.appendChild(controls);
    return section;
  }

  _buildButton(pool, delta) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sta2e-pool-tracker__btn";
    btn.dataset.pool = pool;
    btn.dataset.delta = String(delta);
    btn.title = `${delta > 0 ? "Add" : "Remove"} ${pool === "threat" ? "Threat" : "Momentum"}`;
    btn.innerHTML = delta > 0 ? '<i class="fas fa-plus"></i>' : '<i class="fas fa-minus"></i>';
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!canUserAdjustPool(pool, "widget", delta)) {
        ui.notifications?.warn("STA2e Toolkit: only the GM can adjust Threat from the tracker widget.");
        this._refreshControls();
        return;
      }
      btn.disabled = true;
      try {
        const ok = await adjustPool(pool, delta, { source: "widget" });
        if (!ok) this._refreshControls();
      } finally {
        btn.disabled = false;
        this.refresh();
      }
    });
    return btn;
  }

  async _applyInlinePoolValue(pool, valueInput) {
    if (valueInput.dataset.applying === "1") return;
    const label = pool === "threat" ? "Threat" : "Momentum";
    const current = readPool(pool);
    const limit = poolLimit(pool);
    const next = Math.max(0, Math.min(Number(valueInput.value) || 0, limit));
    const delta = next - current;

    delete valueInput.dataset.editing;
    valueInput.value = String(next);

    if (delta === 0) {
      valueInput.dataset.committedValue = String(next);
      this._refreshControls();
      return;
    }

    if (!canUserAdjustPool(pool, "widget", delta)) {
      ui.notifications?.warn(`STA2e Toolkit: you do not have permission to set ${label}.`);
      valueInput.value = String(current);
      this._refreshControls();
      return;
    }

    valueInput.dataset.applying = "1";
    valueInput.disabled = true;
    const ok = await setPool(pool, next, { source: "widget" });
    valueInput.disabled = false;
    delete valueInput.dataset.applying;
    if (ok) valueInput.dataset.committedValue = String(next);
    if (!ok) {
      valueInput.value = String(current);
      valueInput.dataset.committedValue = String(current);
    }
    if (!ok) this._refreshControls();
    this.refresh();
  }

  _refreshControls() {
    if (!this._el) return;
    this._el.querySelectorAll(".sta2e-pool-tracker__btn").forEach(btn => {
      const pool = btn.dataset.pool;
      const delta = Number(btn.dataset.delta) || 0;
      const allowed = canUserAdjustPool(pool, "widget", delta);
      btn.hidden = pool === "threat" && !game.user.isGM;
      btn.disabled = !allowed;
      btn.classList.toggle("sta2e-pool-tracker__btn--disabled", !allowed);
    });
    this._el.querySelectorAll(".sta2e-pool-tracker__value").forEach(value => {
      const pool = value.dataset.poolValue;
      const allowed = canUserAdjustPool(pool, "widget", 0);
      value.max = String(poolLimit(pool));
      value.disabled = !allowed;
      value.classList.toggle("sta2e-pool-tracker__value--disabled", !allowed);
      value.title = allowed
        ? `Set ${pool === "threat" ? "Threat" : "Momentum"}`
        : "Only the GM can set Threat";
    });
  }

  _applyCollapsed() {
    if (!this._el) return;
    this._el.classList.toggle("sta2e-pool-tracker--collapsed", this._collapsed);
    const icon = this._el.querySelector(".sta2e-pool-tracker__collapse i");
    if (icon) icon.className = this._collapsed ? "fas fa-plus" : "fas fa-minus";
  }

  _applyLayout() {
    if (!this._el) return;
    const layout = trackerLayout() === "floating" ? "floating" : "docked";
    this._ensureAttached();

    this._el.classList.toggle("sta2e-pool-tracker--docked", layout === "docked");
    this._el.classList.toggle("sta2e-pool-tracker--floating", layout === "floating");

    if (layout === "floating") {
      const pos = this._loadPos();
      this._el.style.left = `${pos.x}px`;
      this._el.style.top = `${pos.y}px`;
      this._el.style.right = "";
      this._el.style.bottom = "";
    } else {
      this._el.style.left = "";
      this._el.style.top = "";
      this._el.style.right = "";
      this._el.style.bottom = "";
      this._applyDockPosition();
    }

    const toggle = this._el.querySelector(".sta2e-pool-tracker__layout-toggle");
    if (toggle) {
      toggle.title = layout === "floating" ? "Dock tracker" : "Float tracker";
      toggle.innerHTML = layout === "floating"
        ? '<i class="fas fa-thumbtack"></i>'
        : '<i class="fas fa-window-restore"></i>';
    }
  }

  _startObserver() {
    if (this._observer) return;
    this._observer = new MutationObserver(() => {
      try {
        if (trackerMode() === "toolkit" && this._el) this._ensureAttached();
        this._syncStaTrackerVisibility();
        if (trackerLayout() !== "floating") this._applyDockPosition();
      } catch (err) {
        logTrackerError("DOM observer refresh", err);
      }
    });
    this._observer.observe(document.body, { childList: true, subtree: true });
  }

  _ensureAttached() {
    if (!this._el) return;
    const layout = trackerLayout() === "floating" ? "floating" : "docked";
    const target = layout === "docked"
      ? (document.getElementById("interface") ?? document.body)
      : document.body;
    if (this._el.parentElement !== target) target.appendChild(this._el);
  }

  _applyDockPosition() {
    if (!this._el) return;
    const sidebar = document.querySelector("#sidebar");
    const rect = sidebar?.getBoundingClientRect?.();
    let right = 12;

    if (
      rect
      && rect.width > 0
      && rect.height > 0
      && rect.right > (window.innerWidth - 48)
      && getComputedStyle(sidebar).display !== "none"
      && getComputedStyle(sidebar).visibility !== "hidden"
    ) {
      right = Math.max(12, Math.ceil(window.innerWidth - rect.left + 72));
    }

    const trackerWidth = this._el.offsetWidth || 188;
    right = Math.min(right, Math.max(12, window.innerWidth - trackerWidth - 8));
    this._el.style.setProperty("--sta2e-pool-dock-right", `${right}px`);
  }

  _syncStaTrackerVisibility() {
    const hide = trackerMode() === "toolkit";
    document.querySelectorAll(".tracker-container").forEach(el => {
      if (!el.querySelector("#sta-track-momentum") || !el.querySelector("#sta-track-threat")) return;
      if (hide) {
        if (!el.dataset.sta2ePoolHidden) {
          el.dataset.sta2ePoolHidden = "1";
          el.dataset.sta2ePoolPrevDisplay = el.style.display ?? "";
        }
        el.style.display = "none";
      } else if (el.dataset.sta2ePoolHidden === "1") {
        el.style.display = el.dataset.sta2ePoolPrevDisplay ?? "";
        delete el.dataset.sta2ePoolHidden;
        delete el.dataset.sta2ePoolPrevDisplay;
      }
    });
  }

  _makeDraggable(handle, el) {
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onMove = (event) => {
      el.style.left = `${startLeft + event.clientX - startX}px`;
      el.style.top = `${startTop + event.clientY - startY}px`;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      this._savePos(parseInt(el.style.left, 10), parseInt(el.style.top, 10));
    };

    handle.addEventListener("mousedown", (event) => {
      if (trackerLayout() !== "floating") return;
      if (event.target.closest("button")) return;
      event.preventDefault();
      startX = event.clientX;
      startY = event.clientY;
      startLeft = parseInt(el.style.left, 10) || 110;
      startTop = parseInt(el.style.top, 10) || 180;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  _loadPos() {
    try {
      const pos = JSON.parse(localStorage.getItem(POS_KEY));
      if (pos?.x != null && pos?.y != null) return pos;
    } catch {}
    return { x: 110, y: 180 };
  }

  _savePos(x, y) {
    localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
  }
}
