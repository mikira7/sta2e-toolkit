/**
 * sta2e-toolkit | toolkit-widget.js
 * Floating toolbar widget — toggled by a single token-controls button.
 * Contains quick-launch buttons for:
 *   • Combat HUD
 *   • NPC Ship Dice Roller
 *   • Transporter Control
 *
 * Draggable, position persisted in localStorage, LCARS-themed.
 */

import { getLcTokens } from "./lcars-theme.js";

const WIDGET_ID  = "sta2e-toolkit-widget";
const POS_KEY    = "sta2e-toolkit.widgetPos";

export class ToolkitWidget {

  constructor() {
    this._el      = null;
    this._visible = false;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  toggle() {
    if (this._visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  show() {
    if (!this._el) this._build();
    this._el.style.display = "flex";
    this._visible = true;
  }

  hide() {
    if (this._el) this._el.style.display = "none";
    this._visible = false;
  }

  // ── Build ───────────────────────────────────────────────────────────────────

  _build() {
    document.getElementById(WIDGET_ID)?.remove();

    const LC = getLcTokens();

    const el = document.createElement("div");
    el.id = WIDGET_ID;
    el.style.cssText = `
      position: fixed;
      z-index: 9998;
      display: flex;
      flex-direction: column;
      width: 180px;
      background: ${LC.bg};
      border: 1px solid ${LC.border};
      border-left: 4px solid ${LC.primary};
      border-radius: 2px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.85), 0 0 10px rgba(255,153,0,0.1);
      font-family: ${LC.font};
      color: ${LC.text};
      user-select: none;
      overflow: hidden;
    `;

    const pos = this._loadPos();
    el.style.left = `${pos.x}px`;
    el.style.top  = `${pos.y}px`;

    // ── Header (drag handle) ─────────────────────────────────────────────────
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: ${LC.primary};
      padding: 4px 8px;
      cursor: grab;
    `;

    const title = document.createElement("span");
    title.style.cssText = `
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: ${LC.bg};
    `;
    title.textContent = game.i18n.localize("STA2E.Widget.Title");

    const closeBtn = document.createElement("button");
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: ${LC.bg};
      font-size: 13px;
      cursor: pointer;
      padding: 0 2px;
      line-height: 1;
      opacity: 0.7;
    `;
    closeBtn.textContent = "×";
    closeBtn.title = game.i18n.localize("STA2E.Widget.CloseButton.Title");
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hide();
      // Deactivate the toggle button in the toolbar visually
      document
        .querySelector(`.scene-control-tool[data-tool="sta2eWidget"]`)
        ?.classList.remove("active");
    });

    header.appendChild(title);
    header.appendChild(closeBtn);
    el.appendChild(header);

    // ── Buttons ──────────────────────────────────────────────────────────────
    const btnContainer = document.createElement("div");
    btnContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding: 4px 0;
      background: ${LC.panel};
    `;

    const mkBtn = (icon, label, hint, color, onClick) => {
      const btn = document.createElement("button");
      btn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 7px 12px;
        background: transparent;
        border: none;
        border-left: 2px solid transparent;
        color: ${LC.textDim};
        font-size: 11px;
        font-family: ${LC.font};
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
        text-align: left;
        transition: background 0.1s, color 0.1s, border-color 0.1s;
      `;
      btn.title = hint;

      const iconEl = document.createElement("i");
      iconEl.className = icon;
      iconEl.style.cssText = `width: 14px; text-align: center; font-size: 12px; flex-shrink: 0;`;

      const labelEl = document.createElement("span");
      labelEl.textContent = label;

      btn.appendChild(iconEl);
      btn.appendChild(labelEl);

      btn.addEventListener("mouseenter", () => {
        btn.style.background   = `${color}18`;
        btn.style.borderColor  = color;
        btn.style.color        = color;
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.background   = "transparent";
        btn.style.borderColor  = "transparent";
        btn.style.color        = LC.textDim;
      });
      btn.addEventListener("click", onClick);

      return btn;
    };

    // Combat HUD button
    btnContainer.appendChild(mkBtn(
      "fas fa-crosshairs",
      game.i18n.localize("STA2E.Widget.Button.CombatHud.Label"),
      game.i18n.localize("STA2E.Widget.Button.CombatHud.Hint"),
      LC.primary,
      () => {
        const token = canvas.tokens?.controlled[0];
        if (!token?.actor) {
          ui.notifications.warn(game.i18n.localize("STA2E.Widget.Button.SelectTokenFirst"));
          return;
        }
        game.sta2eToolkit?.combatHud?.open(token);
      }
    ));

    // Separator
    const sep = document.createElement("div");
    sep.style.cssText = `height: 1px; background: ${LC.borderDim}; margin: 2px 8px;`;
    btnContainer.appendChild(sep);

    // Adv. Dice Roller button — only for GM or if ship is selected
    const npcBtn = mkBtn(
      "fas fa-dice-d20",
      game.i18n.localize("STA2E.Widget.Button.NpcRoller.Label"),
      game.i18n.localize("STA2E.Widget.Button.NpcRoller.Hint"),
      LC.secondary,
      () => {
        // Reuse the same launcher from main.js exposed on the API
        game.sta2eToolkit?.launchNpcRoller?.();
      }
    );
    btnContainer.appendChild(npcBtn);

    // Separator
    const sep2 = document.createElement("div");
    sep2.style.cssText = `height: 1px; background: ${LC.borderDim}; margin: 2px 8px;`;
    btnContainer.appendChild(sep2);

    // Social Opposed Task button — GM only (dialog is GM-gated anyway)
    if (game.user.isGM) {
      btnContainer.appendChild(mkBtn(
        "fas fa-people-arrows",
        "Social Opposed Task",
        "Open the Social Opposed Task setup dialog",
        LC.tertiary ?? LC.secondary,
        () => game.sta2eToolkit?.openOpposedTaskSetup?.(),
      ));

      const sepOp = document.createElement("div");
      sepOp.style.cssText = `height: 1px; background: ${LC.borderDim}; margin: 2px 8px;`;
      btnContainer.appendChild(sepOp);
    }

    // Transporter button — GM only
    if (game.user.isGM) {
      btnContainer.appendChild(mkBtn(
        "fas fa-person-booth",
        game.i18n.localize("STA2E.Widget.Button.Transporter.Label"),
        game.i18n.localize("STA2E.Widget.Button.Transporter.Hint"),
        LC.tertiary,
        () => game.sta2eToolkit?.openTransporter(),
      ));

      // Zone Editor button — GM only
      btnContainer.appendChild(mkBtn(
        "fas fa-vector-square",
        game.i18n.localize("STA2E.Widget.Button.ZoneEditor.Label"),
        game.i18n.localize("STA2E.Widget.Button.ZoneEditor.Hint"),
        LC.green ?? "#66cc66",
        () => {
          console.log("STA2e | Widget Zone Editor btn clicked — sta2eToolkit:", game.sta2eToolkit, "zoneToolbar:", game.sta2eToolkit?.zoneToolbar);
          game.sta2eToolkit?.zoneToolbar?.toggle();
        },
      ));

      // Zone Monitor button — GM only
      btnContainer.appendChild(mkBtn(
        "fas fa-binoculars",
        game.i18n.localize("STA2E.Widget.Button.ZoneMonitor.Label"),
        game.i18n.localize("STA2E.Widget.Button.ZoneMonitor.Hint"),
        LC.green ?? "#66cc66",
        () => game.sta2eToolkit?.zoneMonitor?.toggle(),
      ));
    }

    // Separator
    const sep3 = document.createElement("div");
    sep3.style.cssText = `height: 1px; background: ${LC.borderDim}; margin: 2px 8px;`;
    btnContainer.appendChild(sep3);


    // Hover Distance toggle button
    const mkToggleBtn = (icon, label, hint, color, settingKey) => {
      let active = game.settings.get("sta2e-toolkit", settingKey);

      const btn = document.createElement("button");
      btn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 7px 12px;
        background: transparent;
        border: none;
        border-left: 2px solid transparent;
        font-size: 11px;
        font-family: ${LC.font};
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
        text-align: left;
        transition: background 0.1s, color 0.1s, border-color 0.1s;
      `;
      btn.title = hint;

      const iconEl = document.createElement("i");
      iconEl.className = icon;
      iconEl.style.cssText = `width: 14px; text-align: center; font-size: 12px; flex-shrink: 0;`;

      const labelEl = document.createElement("span");
      labelEl.style.flex = "1";
      labelEl.textContent = label;

      const stateEl = document.createElement("span");
      stateEl.style.cssText = `font-size: 9px; opacity: 0.85; letter-spacing: 0.05em;`;

      btn.appendChild(iconEl);
      btn.appendChild(labelEl);
      btn.appendChild(stateEl);

      const applyState = () => {
        if (active) {
          btn.style.borderColor = color;
          btn.style.color       = color;
          stateEl.textContent   = "ON";
        } else {
          btn.style.borderColor = "transparent";
          btn.style.color       = LC.textDim;
          stateEl.textContent   = "OFF";
        }
      };

      btn.addEventListener("mouseenter", () => {
        btn.style.background = `${color}18`;
        btn.style.color      = color;
        btn.style.borderColor = color;
      });
      btn.addEventListener("mouseleave", applyState);
      btn.addEventListener("click", async () => {
        active = !active;
        await game.settings.set("sta2e-toolkit", settingKey, active);
        applyState();
      });

      applyState();
      return btn;
    };

    btnContainer.appendChild(mkToggleBtn(
      "fas fa-ruler-combined",
      game.i18n.localize("STA2E.Widget.Button.HoverDistance.Label"),
      game.i18n.localize("STA2E.Widget.Button.HoverDistance.Hint"),
      LC.secondary,
      "elevationRuler",
    ));

    el.appendChild(btnContainer);

    // ── Footer bar ────────────────────────────────────────────────────────────
    const footer = document.createElement("div");
    footer.style.cssText = `
      height: 3px;
      background: linear-gradient(to right, ${LC.primary}, ${LC.secondary}, ${LC.primary});
    `;
    el.appendChild(footer);

    document.body.appendChild(el);
    this._el = el;

    this._makeDraggable(header, el);
  }

  // ── Drag ────────────────────────────────────────────────────────────────────

  _makeDraggable(handle, el) {
    let startX, startY, startLeft, startTop;

    const onMove = (e) => {
      el.style.left = `${startLeft + e.clientX - startX}px`;
      el.style.top  = `${startTop  + e.clientY - startY}px`;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      handle.style.cursor = "grab";
      this._savePos(parseInt(el.style.left), parseInt(el.style.top));
    };

    handle.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      e.preventDefault();
      startX    = e.clientX;
      startY    = e.clientY;
      startLeft = parseInt(el.style.left) || 80;
      startTop  = parseInt(el.style.top)  || 120;
      handle.style.cursor = "grabbing";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ── Position persistence ─────────────────────────────────────────────────

  _savePos(x, y) {
    localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
  }

  _loadPos() {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY));
      if (p?.x != null) return p;
    } catch {}
    // Default: just to the right of the token controls sidebar (~60px wide)
    return { x: 80, y: 120 };
  }
}
