/**
 * sta2e-toolkit | sfx-widget.js
 * Audio SFX Board widget — a grid of LCARS buttons docked in the gap between
 * the hotbar and the sidebar.
 *
 * Visibility behaviour:
 *   - Hidden by default on load; the tab toggles it and the choice persists
 *     per user in localStorage (same contract as the Alert HUD tab).
 *   - Auto-fits between #hotbar's right edge and #sidebar's left edge, and
 *     re-measures on resize, sidebar collapse, and Foundry UI re-renders.
 *   - Dragging the header pins it wherever the user drops it; "Re-dock"
 *     restores the auto-fit position.
 *
 * Arrangement is per user (client setting `sfxWidgetLayout`): button order,
 * hidden ids, and grid column count.
 */

import { getLcCssVars, getActiveLcThemeKey } from "./lcars-theme.js";
import { clampHudPos, clampHudElement } from "./hud-position.js";
import {
  MODULE_ID,
  getVisibleSfxEntries,
  playSfx,
  sfxDisplayLabel,
  SfxBoardConfig,
} from "./sfx-board.js";

const LAYOUT_SETTING = "sfxWidgetLayout";
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 4;

/** Below this, the hotbar/sidebar gap is too tight — stack above the hotbar. */
const MIN_GAP_WIDTH = 160;

/** Breathing room kept clear of the hotbar and the sidebar. */
const GAP_MARGIN = 8;

/**
 * Solid button fill per theme, sampled from the Stardate HUD (the calendar bar)
 * in styles/stardate-hud.css so the two widgets read as one console. The LC
 * tokens track the same active theme but use slightly different hues, hence the
 * explicit map — `text` is the colour that sits on top of `btn`.
 *
 *   blue            → --hud-accent            (.sta2e-theme-blue)
 *   lcars-tng       → --lcars-primary         (.sta2e-theme-lcars-tng)
 *   lcars-tng-blue  → --lcars-primary         (.sta2e-theme-lcars-tng-blue)
 *   tos-panel       → .tos__btn--amber        (mid gradient stop)
 *   tmp-console     → .tmp__btn               (dark blue fill, light text)
 *   ent-panel       → .ent__btn               (amber readout on gunmetal)
 *   klingon         → .kling__btn:active
 *   romulan         → .rom__btn:active
 */
const CALENDAR_PALETTE = {
  blue:             { btn: "#f0a43a", text: "#06111d" },
  "lcars-tng":      { btn: "#ff9900", text: "#000000" },
  "lcars-tng-blue": { btn: "#6699cc", text: "#000508" },
  "tos-panel":      { btn: "#c8a010", text: "#1a1200" },
  "tmp-console":    { btn: "#2a4a78", text: "#b8d8f8" },
  "ent-panel":      { btn: "#cc8833", text: "#161618" },
  klingon:          { btn: "#cc1111", text: "#ffffff" },
  romulan:          { btn: "#22aa44", text: "#000a00" },
};

export class SfxWidget {

  constructor() {
    this._container = null;
    this._tab       = null;
    this._widget    = null;
    this._grid      = null;
    this._observer  = null;
    this._arrange   = false;
    this._rafPending = false;
    this._onResize  = () => this._applyDockPosition();
  }

  // ── Per-user persistence ───────────────────────────────────────────────────

  get _openKey() { return `sta2e-sfx-open-${game.userId}`; }
  get _isOpen()  { return localStorage.getItem(this._openKey) === "1"; }
  _setOpen(val)  { localStorage.setItem(this._openKey, val ? "1" : "0"); }

  get _posKey()  { return `sta2e-toolkit.sfxWidgetPos-${game.userId}`; }

  _loadPos() {
    try {
      const pos = JSON.parse(localStorage.getItem(this._posKey));
      if (pos?.x != null && pos?.y != null) return pos;
    } catch {}
    return null;
  }

  _savePos(x, y) {
    localStorage.setItem(this._posKey, JSON.stringify({ x, y }));
  }

  _clearPos() {
    localStorage.removeItem(this._posKey);
  }

  get _floating() { return this._loadPos() !== null; }

  // ── Layout (client setting) ────────────────────────────────────────────────

  _layout() {
    let raw;
    try { raw = game.settings.get(MODULE_ID, LAYOUT_SETTING); } catch { raw = null; }
    return {
      order:   Array.isArray(raw?.order)  ? raw.order.map(String)  : [],
      hidden:  Array.isArray(raw?.hidden) ? raw.hidden.map(String) : [],
      columns: Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Number(raw?.columns) || 2)),
    };
  }

  async _saveLayout(patch) {
    const layout = { ...this._layout(), ...patch };
    try {
      await game.settings.set(MODULE_ID, LAYOUT_SETTING, layout);
    } catch (err) {
      console.error("STA2e Toolkit | SFX layout save failed:", err);
    }
  }

  get _enabled() {
    try { return game.settings.get(MODULE_ID, "sfxWidgetEnabled") !== false; }
    catch { return true; }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init() {
    this.render();
    window.addEventListener("resize", this._onResize);
    Hooks.on("collapseSidebar", () => this._scheduleDock());
    Hooks.on("renderHotbar",    () => this._scheduleDock());
    Hooks.on("renderSidebar",   () => this._scheduleDock());
    this._startObserver();
  }

  /** Rebuild the buttons and re-apply the active LCARS theme. */
  refresh() {
    if (!this._enabled) { this.destroy(); return; }
    if (!this._container) { this.render(); return; }
    this._container.setAttribute("style", this._containerStyle());
    this._applyDockPosition();
    this._renderGrid();
  }

  destroy() {
    this._container?.remove();
    this._container = this._tab = this._widget = this._grid = null;
  }

  render() {
    if (!this._enabled) return;
    this.destroy();

    const container = document.createElement("div");
    container.id = "sta2e-sfx-container";
    container.setAttribute("style", this._containerStyle());
    if (!this._isOpen) container.classList.add("sta2e-sfx--collapsed");

    const tab = document.createElement("button");
    tab.id = "sta2e-sfx-tab";
    tab.type = "button";
    tab.title = "Audio SFX Board";
    tab.innerHTML = this._isOpen ? "▼ SFX" : "▲ SFX";
    tab.addEventListener("click", () => this.toggle());

    const widget = document.createElement("div");
    widget.id = "sta2e-sfx-widget";

    const header = document.createElement("div");
    header.className = "sta2e-sfx-header";
    header.innerHTML = `<span class="sta2e-sfx-title">SFX</span>`;

    const controls = document.createElement("div");
    controls.className = "sta2e-sfx-controls";

    const mkCtl = (icon, title, onClick, name) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sta2e-sfx-ctl";
      btn.title = title;
      btn.innerHTML = `<i class="fas ${icon}"></i>`;
      if (name) btn.dataset.ctl = name;
      btn.addEventListener("click", ev => { ev.stopPropagation(); onClick(); });
      return btn;
    };

    controls.appendChild(mkCtl("fa-minus", "Fewer columns", () => this._nudgeColumns(-1)));
    controls.appendChild(mkCtl("fa-plus",  "More columns",  () => this._nudgeColumns(+1)));
    controls.appendChild(mkCtl("fa-arrows-up-down-left-right", "Arrange buttons", () => this._toggleArrange(), "arrange"));
    controls.appendChild(mkCtl("fa-thumbtack", "Re-dock beside the hotbar", () => this._redock(), "redock"));
    if (game.user?.isGM) {
      controls.appendChild(mkCtl("fa-gear", "Configure sounds", () => new SfxBoardConfig().render(true)));
    }

    header.appendChild(controls);

    const grid = document.createElement("div");
    grid.className = "sta2e-sfx-grid";

    widget.appendChild(header);
    widget.appendChild(grid);
    container.appendChild(tab);
    container.appendChild(widget);

    const target = document.getElementById("interface") ?? document.body;
    target.appendChild(container);

    this._container = container;
    this._tab       = tab;
    this._widget    = widget;
    this._grid      = grid;

    this._makeDraggable(header, container);
    this._activateDragSort(grid);
    this._renderGrid();
    this._applyDockPosition();
  }

  /** LCARS tokens plus the calendar-matched solid button colours. */
  _containerStyle() {
    const pal = CALENDAR_PALETTE[getActiveLcThemeKey()] ?? CALENDAR_PALETTE["lcars-tng"];
    return `${getLcCssVars("sfx")}--sfx-btn:${pal.btn};--sfx-btn-text:${pal.text};`;
  }

  // ── Visibility ─────────────────────────────────────────────────────────────

  toggle() {
    this._setOpen(!this._isOpen);
    if (!this._isOpen && this._arrange) this._toggleArrange();   // leave arrange mode on close
    this._syncOpenState();
  }

  show() { this._setOpen(true);  this._syncOpenState(); }
  hide() { this._setOpen(false); this._syncOpenState(); }

  _syncOpenState() {
    if (!this._container) { this.render(); return; }
    this._container.classList.toggle("sta2e-sfx--collapsed", !this._isOpen);
    if (this._tab) this._tab.innerHTML = this._isOpen ? "▼ SFX" : "▲ SFX";
    if (this._isOpen) this._applyDockPosition();
  }

  // ── Button grid ────────────────────────────────────────────────────────────

  /** Configured entries the user may see, in their personal order. */
  _orderedEntries() {
    const entries = getVisibleSfxEntries();
    const { order } = this._layout();
    const rank = new Map(order.map((id, index) => [id, index]));
    return entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => {
        const ra = rank.has(a.entry.id) ? rank.get(a.entry.id) : Number.MAX_SAFE_INTEGER;
        const rb = rank.has(b.entry.id) ? rank.get(b.entry.id) : Number.MAX_SAFE_INTEGER;
        return ra - rb || a.index - b.index;
      })
      .map(item => item.entry);
  }

  _renderGrid() {
    if (!this._grid) return;
    const layout  = this._layout();
    const hidden  = new Set(layout.hidden);
    const entries = this._orderedEntries();

    this._container.style.setProperty("--sfx-columns", String(layout.columns));
    this._container.classList.toggle("sta2e-sfx--arrange", this._arrange);
    this._container.querySelector('[data-ctl="arrange"]')?.classList.toggle("is-active", this._arrange);
    this._container.querySelector('[data-ctl="redock"]')?.toggleAttribute("hidden", !this._floating);

    const shown = this._arrange ? entries : entries.filter(entry => !hidden.has(entry.id));

    this._grid.replaceChildren();

    if (!shown.length) {
      const empty = document.createElement("div");
      empty.className = "sta2e-sfx-empty";
      empty.textContent = game.user?.isGM
        ? "No sounds configured — open the gear to add some."
        : "No sounds available.";
      this._grid.appendChild(empty);
      return;
    }

    for (const entry of shown) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sta2e-sfx-btn";
      btn.dataset.sfxId = entry.id;
      btn.textContent = sfxDisplayLabel(entry);
      btn.title = this._arrange
        ? `${sfxDisplayLabel(entry)} — click to ${hidden.has(entry.id) ? "show" : "hide"}, drag to reorder`
        : `${sfxDisplayLabel(entry)}\n${entry.path}`;
      if (hidden.has(entry.id)) btn.classList.add("is-hidden-entry");
      if (this._arrange) btn.draggable = true;

      btn.addEventListener("click", () => {
        if (this._arrange) this._toggleHidden(entry.id);
        else playSfx(entry);
      });

      this._grid.appendChild(btn);
    }
  }

  // ── Arrangement ────────────────────────────────────────────────────────────

  _toggleArrange() {
    this._arrange = !this._arrange;
    if (this._arrange && !this._isOpen) this.show();
    this._renderGrid();
  }

  async _toggleHidden(id) {
    const layout = this._layout();
    const hidden = new Set(layout.hidden);
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    await this._saveLayout({ hidden: [...hidden] });
    this._renderGrid();
  }

  async _nudgeColumns(delta) {
    const layout = this._layout();
    const columns = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, layout.columns + delta));
    if (columns === layout.columns) return;
    await this._saveLayout({ columns });
    this._container?.style.setProperty("--sfx-columns", String(columns));
    this._applyDockPosition();
  }

  /** Delegated HTML5 drag sort — mirrors CampaignManager._activateDragSort. */
  _activateDragSort(grid) {
    let dragged = null;

    grid.addEventListener("dragstart", ev => {
      const btn = ev.target.closest("[data-sfx-id]");
      if (!btn || !this._arrange) return;
      dragged = btn;
      btn.classList.add("is-dragging");
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", btn.dataset.sfxId);
    });

    grid.addEventListener("dragover", ev => {
      if (!dragged) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      const target = ev.target.closest("[data-sfx-id]");
      if (!target || target === dragged) return;
      const rect  = target.getBoundingClientRect();
      const after = (ev.clientX - rect.left) > rect.width / 2;
      grid.insertBefore(dragged, after ? target.nextSibling : target);
    });

    grid.addEventListener("drop", ev => { if (dragged) ev.preventDefault(); });

    grid.addEventListener("dragend", async () => {
      if (!dragged) return;
      dragged.classList.remove("is-dragging");
      dragged = null;
      const order = [...grid.querySelectorAll("[data-sfx-id]")].map(el => el.dataset.sfxId);
      await this._saveLayout({ order });
    });
  }

  // ── Docking & dragging ─────────────────────────────────────────────────────

  _scheduleDock() {
    if (this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      try {
        this._ensureAttached();
        this._applyDockPosition();
      } catch (err) {
        console.error("STA2e Toolkit | SFX dock refresh failed:", err);
      }
    });
  }

  _startObserver() {
    if (this._observer) return;
    this._observer = new MutationObserver(() => this._scheduleDock());
    this._observer.observe(document.body, { childList: true, subtree: true });
  }

  _ensureAttached() {
    if (!this._container) return;
    const target = document.getElementById("interface") ?? document.body;
    if (this._container.parentElement !== target) target.appendChild(this._container);
  }

  /**
   * Auto-fit into the gap between the hotbar's right edge and the sidebar's
   * left edge. Skipped entirely once the user has dragged the widget.
   */
  _applyDockPosition() {
    const el = this._container;
    if (!el) return;

    const pos = this._loadPos();
    if (pos) {
      // "auto", not "" — clearing the inline value would fall back to the
      // stylesheet's right/bottom and over-constrain the box.
      el.style.left   = `${pos.x}px`;
      el.style.top    = `${pos.y}px`;
      el.style.right  = "auto";
      el.style.bottom = "auto";
      el.style.setProperty("--sfx-max-width", "320px");
      // This runs on resize too, so a position saved on a wider viewport gets
      // pulled back into reach rather than clipping off-screen.
      const clamped = clampHudElement(el);
      if (clamped && (clamped.x !== pos.x || clamped.y !== pos.y)) {
        this._savePos(clamped.x, clamped.y);
      }
      return;
    }

    el.style.left = "auto";
    el.style.top  = "auto";

    const sidebar     = document.querySelector("#sidebar");
    const sidebarRect = sidebar?.getBoundingClientRect?.();
    const sidebarVisible = !!sidebar
      && sidebarRect?.width > 0
      && sidebarRect?.height > 0
      && sidebarRect.right > (window.innerWidth - 48)
      && getComputedStyle(sidebar).display !== "none"
      && getComputedStyle(sidebar).visibility !== "hidden";

    const hotbarRect = document.getElementById("hotbar")?.getBoundingClientRect?.();
    const hasHotbar  = hotbarRect?.height > 0 && hotbarRect?.width > 0;

    // The free strip between the hotbar's right edge and the sidebar's left edge.
    const gapLeft  = hasHotbar ? hotbarRect.right + GAP_MARGIN : GAP_MARGIN;
    const gapRight = sidebarVisible
      ? sidebarRect.left - GAP_MARGIN
      : window.innerWidth - GAP_MARGIN;
    const gap = Math.floor(gapRight - gapLeft);

    let bottom;
    let maxWidth;
    let centerOn;
    if (gap >= MIN_GAP_WIDTH || !hasHotbar) {
      // Normal case — sit in the gap, bottom-aligned with the hotbar and
      // horizontally centred so it does not crowd either neighbour.
      bottom   = hasHotbar ? Math.max(6, Math.round(window.innerHeight - hotbarRect.bottom)) : 10;
      maxWidth = Math.min(420, gap);
      centerOn = gapLeft + gap / 2;
    } else {
      // Gap too narrow (small window, wide hotbar) — stack above the hotbar
      // instead of overlapping it, centred over the hotbar's right half.
      bottom   = Math.max(6, Math.round(window.innerHeight - hotbarRect.top) + 6);
      maxWidth = Math.max(150, Math.min(420, Math.floor(gapRight - GAP_MARGIN)));
      centerOn = gapRight - maxWidth / 2;
    }

    // Apply the width cap first, then measure — the box is shrink-to-fit, so
    // its width is only known once the cap is in effect.
    el.style.setProperty("--sfx-max-width", `${maxWidth}px`);
    const width = Math.round(
      this._widget?.getBoundingClientRect?.().width || el.getBoundingClientRect().width || maxWidth
    );

    // Convert the desired centre into a right offset, then keep the box inside
    // the strip: never under the sidebar, never over the hotbar.
    const minRight = Math.max(6, Math.round(window.innerWidth - gapRight));
    const maxRight = Math.max(minRight, Math.round(window.innerWidth - gapLeft - width));
    const right = Math.min(Math.max(Math.round(window.innerWidth - (centerOn + width / 2)), minRight), maxRight);

    el.style.right  = `${right}px`;
    el.style.bottom = `${bottom}px`;
  }

  _redock() {
    this._clearPos();
    this._applyDockPosition();
    this._renderGrid();
  }

  _makeDraggable(handle, el) {
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    const onMove = ev => {
      const pos = clampHudPos(el, startLeft + ev.clientX - startX, startTop + ev.clientY - startY);
      el.style.left   = `${pos.x}px`;
      el.style.top    = `${pos.y}px`;
      el.style.right  = "auto";
      el.style.bottom = "auto";
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      handle.style.cursor = "grab";
      const { x, y } = clampHudPos(el, parseInt(el.style.left, 10), parseInt(el.style.top, 10));
      this._savePos(x, y);
      this._renderGrid();   // reveals the Re-dock control
    };

    handle.style.cursor = "grab";
    handle.addEventListener("mousedown", ev => {
      if (ev.target.closest("button")) return;
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      startX = ev.clientX;
      startY = ev.clientY;
      startLeft = rect.left;
      startTop  = rect.top;
      el.style.left   = `${rect.left}px`;
      el.style.top    = `${rect.top}px`;
      el.style.right  = "auto";
      el.style.bottom = "auto";
      handle.style.cursor = "grabbing";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }
}
