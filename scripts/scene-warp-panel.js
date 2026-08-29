/**
 * Scene Warp — the GM control panel.
 *
 * A floating LCARS panel that puts the whole scene at warp: engage, ride it,
 * drop out, and swing the course while it runs. Built exactly the way
 * [warp-viewscreen-panel.js](warp-viewscreen-panel.js) is — a plain element with
 * inline cssText from `getLcTokens()` resolved at *render* time, dragged by its
 * header, clamped by hud-position.js, position persisted in localStorage.
 *
 * Every control writes through `_apply()` to the scene flag. Nothing here
 * touches PIXI and nothing here emits a socket message: the Scene update is what
 * reaches the other clients.
 */

import { getLcTokens } from "./lcars-theme.js";
import { clampHudPos, clampHudElement, onViewportResize } from "./hud-position.js";
import { pickHeading, compassLabel } from "./spawn-picker.js";
import {
  SCENE_PHASE_TEXT,
  getSceneWarp,
  hasSceneWarp,
  effectiveScenePhase,
  isSceneAtWarp,
  enterSceneWarp,
  exitSceneWarp,
  setSceneWarpConfig,
  setSceneCourse,
  alignFleetToCourse,
  clearSceneWarp,
  sceneShipTokens,
} from "./scene-warp.js";
import { syncSceneWarp } from "./scene-warp-vfx.js";

const PANEL_ID = "sta2e-scene-warp-panel";
const POS_KEY  = "sta2e-toolkit.sceneWarpPanelPos";

const DEG = 180 / Math.PI;

export class SceneWarpPanel {

  constructor() {
    this._el            = null;
    this._body          = null;
    this._visible       = false;
    this._stopResizeFix = null;
    this._hookIds       = [];
    // A ticker so `entering` flips its own label to AT WARP when the ramp ends —
    // that transition is derived locally and produces no document update to
    // listen for.
    this._pulse         = null;
    this._lastPhase     = null;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  toggle() {
    if (this._visible) this.hide();
    else this.show();
  }

  show() {
    if (!game.user?.isGM) {
      ui.notifications.warn("The Scene Warp panel is GM-only.");
      return;
    }
    if (!this._el) this._build();
    this._el.style.display = "flex";
    this._visible = true;
    this._registerHooks();
    this._startPulse();
    this.render();
    this._clampIntoView();
  }

  hide() {
    if (this._el) this._el.style.display = "none";
    this._visible = false;
    this._unregisterHooks();
    this._stopPulse();
  }

  // ── Writing ──────────────────────────────────────────────────────────────────

  async _apply(patch) {
    await setSceneWarpConfig(patch);
    // The renderer picks look changes up live off the scene flag; this is only
    // for the ones that need a pool rebuild.
    syncSceneWarp();
    if (this._visible) this.render();
  }

  // ── Build ────────────────────────────────────────────────────────────────────

  _build() {
    const LC = getLcTokens();

    const el = document.createElement("div");
    el.id = PANEL_ID;
    el.style.cssText = `
      position: fixed; z-index: 9998; display: flex; flex-direction: column; width: 244px;
      background: ${LC.bg}; border: 1px solid ${LC.border}; border-left: 4px solid ${LC.primary};
      border-radius: 2px; box-shadow: 0 4px 20px rgba(0,0,0,0.85), 0 0 10px rgba(102,187,255,0.12);
      font-family: ${LC.font}; color: ${LC.text}; user-select: none; overflow: hidden;
    `;

    const pos = this._loadPos();
    el.style.left = `${pos.x}px`;
    el.style.top  = `${pos.y}px`;

    const header = document.createElement("div");
    header.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      background: ${LC.primary}; padding: 4px 8px; cursor: grab;
    `;

    const title = document.createElement("span");
    title.style.cssText = `
      font-size: 9px; font-weight: 700; letter-spacing: 0.15em;
      text-transform: uppercase; color: ${LC.bg};
    `;
    title.textContent = "Scene Warp";

    const closeBtn = document.createElement("button");
    closeBtn.style.cssText = `
      background: none; border: none; color: ${LC.bg}; font-size: 13px;
      cursor: pointer; padding: 0 2px; line-height: 1; opacity: 0.7;
    `;
    closeBtn.textContent = "×";
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", e => { e.stopPropagation(); this.hide(); });

    header.append(title, closeBtn);
    el.appendChild(header);

    const body = document.createElement("div");
    body.dataset.role = "body";
    body.style.cssText = `
      display: flex; flex-direction: column; gap: 4px;
      padding: 6px 8px 8px; background: ${LC.panel}; max-height: 72vh; overflow-y: auto;
    `;
    el.appendChild(body);
    this._body = body;

    const footer = document.createElement("div");
    footer.style.cssText =
      `height: 3px; background: linear-gradient(to right, ${LC.primary}, ${LC.secondary}, ${LC.primary});`;
    el.appendChild(footer);

    document.body.appendChild(el);
    this._el = el;

    this._clampIntoView();
    this._makeDraggable(header, el);

    this._stopResizeFix?.();
    this._stopResizeFix = onViewportResize(
      () => this._el,
      p => this._savePos(p.x, p.y),
    );
  }

  // ── Small LCARS parts ────────────────────────────────────────────────────────

  _mkLabel(text) {
    const LC = getLcTokens();
    const el = document.createElement("div");
    el.style.cssText = `
      font-size: 8px; letter-spacing: 0.16em; text-transform: uppercase;
      color: ${LC.textDim}; margin-top: 3px;
    `;
    el.textContent = text;
    return el;
  }

  _mkBtn(icon, label, hint, color, onClick, { big = false } = {}) {
    const LC = getLcTokens();
    const btn = document.createElement("button");
    btn.style.cssText = `
      display: flex; align-items: center; justify-content: ${big ? "center" : "flex-start"};
      gap: 8px; width: 100%; padding: ${big ? "9px 12px" : "6px 10px"};
      background: ${big ? `${color}1c` : "transparent"};
      border: none; border-left: ${big ? "3px" : "2px"} solid ${big ? color : "transparent"};
      color: ${big ? color : LC.textDim};
      font-size: ${big ? "12px" : "10px"}; font-family: ${LC.font};
      font-weight: ${big ? "700" : "400"};
      letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; text-align: left;
      transition: background 0.1s, color 0.1s, border-color 0.1s;
    `;
    btn.title = hint;

    const iconEl = document.createElement("i");
    iconEl.className = icon;
    iconEl.style.cssText = "width: 14px; text-align: center; font-size: 12px; flex-shrink: 0;";
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    btn.append(iconEl, labelEl);

    btn.addEventListener("mouseenter", () => {
      btn.style.background  = `${color}30`;
      btn.style.borderColor = color;
      btn.style.color       = color;
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background  = big ? `${color}1c` : "transparent";
      btn.style.borderColor = big ? color : "transparent";
      btn.style.color       = big ? color : LC.textDim;
    });
    btn.addEventListener("click", onClick);
    return btn;
  }

  /** A labelled slider that reports its value live and commits on release. */
  _mkSlider(label, { min, max, step, value, format, onCommit, onInput }) {
    const LC  = getLcTokens();
    const row = document.createElement("div");
    row.style.cssText = "display: flex; flex-direction: column; gap: 2px;";

    const head = document.createElement("div");
    head.style.cssText = `
      display: flex; justify-content: space-between; align-items: baseline;
      font-size: 8px; letter-spacing: 0.14em; text-transform: uppercase; color: ${LC.textDim};
    `;
    const nameEl = document.createElement("span");
    nameEl.textContent = label;
    const valEl = document.createElement("span");
    valEl.style.cssText = `color: ${LC.textBright ?? LC.text}; font-size: 10px; font-weight: 700;`;
    valEl.textContent = format(value);
    head.append(nameEl, valEl);

    const input = document.createElement("input");
    input.type  = "range";
    input.min   = String(min);
    input.max   = String(max);
    input.step  = String(step);
    input.value = String(value);
    input.style.cssText = `width: 100%; accent-color: ${LC.primary}; cursor: pointer;`;

    input.addEventListener("input", () => {
      valEl.textContent = format(Number(input.value));
      onInput?.(Number(input.value));
    });
    // Commit on release rather than per-pixel, so a drag is one document write
    // rather than fifty.
    input.addEventListener("change", () => onCommit(Number(input.value)));

    row.append(head, input);
    return row;
  }

  /** A checkbox row. */
  _mkToggle(label, checked, hint, onChange) {
    const LC  = getLcTokens();
    const row = document.createElement("label");
    row.title = hint;
    row.style.cssText = `
      display: flex; align-items: center; gap: 6px; padding: 3px 2px; cursor: pointer;
      font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: ${LC.textDim};
    `;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!checked;
    input.style.cssText = `accent-color: ${LC.primary}; cursor: pointer; flex-shrink: 0;`;
    input.addEventListener("change", () => onChange(input.checked));
    const name = document.createElement("span");
    name.textContent = label;
    row.append(input, name);
    return row;
  }

  /**
   * The Quality mirror. Writes the client setting, not the scene flag, so it
   * affects this browser only — hence the "(this device)" label.
   */
  _mkQuality() {
    const LC  = getLcTokens();
    const row = document.createElement("div");
    row.style.cssText = "display: flex; flex-direction: column; gap: 2px;";

    const head = document.createElement("div");
    head.style.cssText = `
      font-size: 8px; letter-spacing: 0.14em; text-transform: uppercase;
      color: ${LC.textDim};
    `;
    head.textContent = "Quality (this device)";
    head.title = "How much of the field YOUR browser draws. Players set their own in "
      + "Module Settings; this never changes what anyone else sees.";

    const sel = document.createElement("select");
    sel.style.cssText = `
      width: 100%; background: ${LC.bg}; color: ${LC.text}; font-family: ${LC.font};
      font-size: 10px; border: 1px solid ${LC.borderDim}; border-radius: 2px; padding: 3px 4px;
    `;
    let current = "high";
    try { current = String(game.settings.get("sta2e-toolkit", "sceneWarpQuality") ?? "high"); } catch { /* pre-init */ }
    for (const [value, label] of [
      ["high",   "High — full field"],
      ["medium", "Medium — half, none over tokens"],
      ["low",    "Low — sparse, two bands"],
    ]) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      if (value === current) opt.selected = true;
      sel.appendChild(opt);
    }
    // The setting's own onChange resyncs the renderer, so this only has to write.
    sel.addEventListener("change", () => {
      game.settings.set("sta2e-toolkit", "sceneWarpQuality", sel.value)
        .catch(err => console.warn("STA2e Toolkit | scene warp quality:", err));
    });

    row.append(head, sel);
    return row;
  }

  /** A row of labelled colour wells. */
  _mkSwatches(entries) {
    const LC  = getLcTokens();
    const row = document.createElement("div");
    row.style.cssText = "display: flex; gap: 6px; padding: 2px 0;";

    for (const { label, key, value } of entries) {
      const cell = document.createElement("label");
      cell.style.cssText = `
        flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px;
        font-size: 8px; letter-spacing: 0.12em; text-transform: uppercase;
        color: ${LC.textDim}; cursor: pointer;
      `;
      const name = document.createElement("span");
      name.textContent = label;

      const input = document.createElement("input");
      input.type  = "color";
      input.value = String(value);
      input.style.cssText = `
        width: 100%; height: 20px; padding: 0; cursor: pointer;
        border: 1px solid ${LC.borderDim}; background: none;
      `;
      input.addEventListener("change", () => this._apply({ [key]: input.value }));

      cell.append(name, input);
      row.appendChild(cell);
    }
    return row;
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  render() {
    if (!this._el || !this._body) return;
    const LC   = getLcTokens();
    const body = this._body;
    body.replaceChildren();

    const scene = canvas?.scene;
    if (!scene) {
      const empty = document.createElement("div");
      empty.style.cssText = `font-size: 10px; line-height: 1.5; color: ${LC.textDim}; padding: 6px 2px;`;
      empty.textContent = "No scene is being viewed.";
      body.appendChild(empty);
      return;
    }

    // An unconfigured scene gets one button rather than a wall of controls that
    // would all be writing to a flag that does not exist yet.
    if (!hasSceneWarp(scene)) {
      const intro = document.createElement("div");
      intro.style.cssText = `font-size: 10px; line-height: 1.5; color: ${LC.textDim}; padding: 4px 2px 8px;`;
      intro.textContent =
        "Put this scene at warp: stars stream past on a course you set, ships hold a "
        + "bow-forward formation heading, and weapons fire without turning to face.";
      body.appendChild(intro);
      body.appendChild(this._mkBtn(
        "fas fa-forward-fast", "Set up Scene Warp",
        "Create Scene Warp configuration on this scene",
        LC.primary, () => this._apply({ phase: "idle", phaseAt: 0 }), { big: true },
      ));
      return;
    }

    const cfg   = getSceneWarp(scene);
    const phase = effectiveScenePhase(scene);
    const warp  = isSceneAtWarp(scene);

    // ── Status strip ──────────────────────────────────────────────────────────
    const statusColor = warp ? (LC.secondary ?? "#66ccff") : LC.textDim;
    const status = document.createElement("div");
    status.style.cssText = `
      display: flex; justify-content: space-between; align-items: baseline;
      padding: 4px 6px; margin-top: 2px; border-left: 3px solid ${statusColor};
      background: ${statusColor}14; font-size: 10px; letter-spacing: 0.12em;
      text-transform: uppercase; color: ${statusColor}; font-weight: 700;
    `;
    const statusName = document.createElement("span");
    statusName.textContent = SCENE_PHASE_TEXT[phase] ?? phase;
    const statusVal = document.createElement("span");
    statusVal.textContent = warp ? `WARP ${cfg.warpFactor.toFixed(1)}` : "—";
    status.append(statusName, statusVal);
    body.appendChild(status);

    // ── Engage / drop out ─────────────────────────────────────────────────────
    body.appendChild(warp
      ? this._mkBtn("fas fa-stop", "Drop Out of Warp", "Ramp the field back down to sublight",
          LC.tertiary, () => this._run(() => exitSceneWarp()), { big: true })
      : this._mkBtn("fas fa-forward-fast", "Engage Warp", "Ramp the field up to the set warp factor",
          LC.primary, () => this._run(() => enterSceneWarp()), { big: true }));

    // ── Flight ────────────────────────────────────────────────────────────────
    body.appendChild(this._mkLabel("Flight"));

    body.appendChild(this._mkSlider("Warp Factor", {
      min: 1, max: 9.9, step: 0.1, value: cfg.warpFactor,
      format: v => v.toFixed(1),
      onCommit: v => this._apply({ warpFactor: v }),
    }));

    // Course is committed on release like any other slider, but the fleet only
    // re-aligns on commit — a per-pixel align would be one token update per
    // pixel of drag.
    body.appendChild(this._mkSlider("Course", {
      min: 0, max: 359, step: 1, value: Math.round(cfg.course),
      format: v => compassLabel(((v - 90) * Math.PI) / 180),
      onCommit: v => this._run(() => setSceneCourse(v)),
    }));

    const aimRow = document.createElement("div");
    aimRow.style.cssText = "display: flex; gap: 4px;";
    aimRow.append(
      this._mkBtn("fas fa-crosshairs", "Aim", "Click the canvas to set the course",
        LC.primary, () => this._pickCourse()),
      this._mkBtn("fas fa-arrows-to-dot", "Align Fleet",
        "Snap every ship on this scene to the course now",
        LC.primary, () => this._run(() => alignFleetToCourse())),
    );
    body.appendChild(aimRow);

    // ── Rules switches ────────────────────────────────────────────────────────
    body.appendChild(this._mkLabel("Formation"));

    body.appendChild(this._mkToggle(
      "Heading Lock", cfg.lockHeading,
      "Ships hold the course and never turn — they translate bow-forward. "
      + "The GM can still rotate one by hand, which becomes the new course.",
      v => this._run(async () => {
        await setSceneWarpConfig({ lockHeading: v });
        if (v) await alignFleetToCourse();
      }),
    ));

    body.appendChild(this._mkToggle(
      "No Weapon Turn", cfg.disableWeaponAutoRotate,
      "Ships on this scene never turn or glide to face weapon fire, and shots "
      + "leave from the nearest emitter regardless of its firing arc.",
      v => this._apply({ disableWeaponAutoRotate: v }),
    ));

    const ships = sceneShipTokens(scene).length;
    const count = document.createElement("div");
    count.style.cssText = `font-size: 8px; letter-spacing: 0.12em; color: ${LC.textDim}; padding: 0 2px 2px;`;
    count.textContent = `${ships} ship${ships === 1 ? "" : "s"} on this scene`;
    body.appendChild(count);

    // ── Look ──────────────────────────────────────────────────────────────────
    body.appendChild(this._mkLabel("Look"));

    // Quality is a CLIENT setting, not part of the scene flag — frame rate is a
    // per-machine problem and the GM must not be setting it for the table. This
    // row is a convenience mirror that changes only the GM's own view; players
    // set their own in Foundry's module settings.
    body.appendChild(this._mkQuality());

    body.appendChild(this._mkSlider("Star Count", {
      min: 50, max: 2000, step: 10, value: cfg.density,
      format: v => String(Math.round(v)),
      onCommit: v => this._apply({ density: Math.round(v) }),
    }));

    body.appendChild(this._mkSwatches([
      { label: "Stars",  key: "starTint",   value: cfg.starTint },
      { label: "Accent", key: "accentTint", value: cfg.accentTint },
    ]));

    body.appendChild(this._mkSlider("Colour Variety", {
      min: 0, max: 100, step: 5, value: Math.round(cfg.variety * 100),
      format: v => `${Math.round(v)}%`,
      onCommit: v => this._apply({ variety: v }),
    }));

    body.appendChild(this._mkSlider("Streak Length", {
      min: 10, max: 400, step: 5, value: Math.round(cfg.streakMul * 100),
      format: v => `${Math.round(v)}%`,
      onCommit: v => this._apply({ streakMul: v }),
    }));

    body.appendChild(this._mkSlider("Streak Thickness", {
      min: 50, max: 400, step: 5, value: Math.round(cfg.thickness * 100),
      format: v => `${Math.round(v)}%`,
      onCommit: v => this._apply({ thickness: v }),
    }));

    body.appendChild(this._mkToggle(
      "Parallax Depth", cfg.parallax,
      "Near stars run fast, long and bright; far ones slow, short and dim. "
      + "Most of what makes the field read as motion rather than moving dots.",
      v => this._apply({ parallax: v }),
    ));

    body.appendChild(this._mkToggle(
      "Foreground Streaks", cfg.foreground,
      "A sparse fast band drawn OVER the tokens, for depth. Keep it light — it "
      + "crosses your ships.",
      v => this._apply({ foreground: v }),
    ));

    body.appendChild(this._mkToggle(
      "Drift When Sublight", cfg.drift,
      "Keeps a slow starfield running while not at warp. Off by default — this "
      + "field has no backdrop of its own, so it would otherwise lay drifting "
      + "stars over your map art during a normal encounter.",
      v => this._apply({ drift: v }),
    ));

    // ── Teardown ──────────────────────────────────────────────────────────────
    body.appendChild(this._mkBtn(
      "fas fa-trash", "Clear Scene Warp",
      "Remove all Scene Warp state from this scene",
      // Deliberately off-palette: no LCARS theme carries a danger colour, and
      // this is the one destructive control on the panel.
      "#ff6666",
      () => this._run(async () => { await clearSceneWarp(); syncSceneWarp(); }),
    ));
  }

  /** Run a write, then resync the renderer and repaint the panel. */
  async _run(fn) {
    try {
      await fn();
    } catch (err) {
      console.error("STA2e Toolkit | scene warp panel:", err);
      ui.notifications.error("Scene Warp: that did not apply — see the console.");
    }
    syncSceneWarp();
    if (this._visible) this.render();
  }

  /** Click the canvas to set the course. */
  async _pickCourse() {
    const rect = canvas?.dimensions?.sceneRect;
    if (!rect) return;
    const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };

    // Out of the way of the click.
    const wasVisible = this._visible;
    if (this._el) this._el.style.display = "none";
    let heading = null;
    try {
      heading = await pickHeading(centre, null);
    } finally {
      if (wasVisible && this._el) this._el.style.display = "flex";
    }
    if (heading === null || heading === undefined) return;
    // pickHeading answers in the atan2 convention; the flag stores compass.
    await this._run(() => setSceneCourse(Math.round(heading * DEG + 90)));
  }

  // ── Staying in sync ──────────────────────────────────────────────────────────

  _registerHooks() {
    if (this._hookIds.length) return;
    const rerender = doc => {
      if (doc?.id && canvas?.scene?.id && doc.id !== canvas.scene.id) return;
      if (this._visible) this.render();
    };
    this._hookIds = [
      ["updateScene", Hooks.on("updateScene", rerender)],
      ["canvasReady", Hooks.on("canvasReady", () => { if (this._visible) this.render(); })],
      // The ship count in the strip, and nothing else.
      ["createToken", Hooks.on("createToken", () => { if (this._visible) this.render(); })],
      ["deleteToken", Hooks.on("deleteToken", () => { if (this._visible) this.render(); })],
    ];
  }

  _unregisterHooks() {
    for (const [name, id] of this._hookIds) Hooks.off(name, id);
    this._hookIds = [];
  }

  /**
   * `entering` becomes `cruise` from elapsed time alone, with no document update
   * behind it — so the button label needs its own nudge to catch up.
   */
  _startPulse() {
    this._stopPulse();
    this._pulse = setInterval(() => {
      if (!this._visible || !canvas?.scene) return;
      const phase = effectiveScenePhase(canvas.scene);
      if (phase !== this._lastPhase) {
        this._lastPhase = phase;
        this.render();
      }
    }, 500);
  }

  _stopPulse() {
    if (this._pulse) clearInterval(this._pulse);
    this._pulse = null;
  }

  // ── Drag + position ──────────────────────────────────────────────────────────

  _makeDraggable(handle, el) {
    let startX, startY, startLeft, startTop;

    const onMove = e => {
      const pos = clampHudPos(el, startLeft + e.clientX - startX, startTop + e.clientY - startY);
      el.style.left = `${pos.x}px`;
      el.style.top  = `${pos.y}px`;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      handle.style.cursor = "grab";
      this._savePos(parseInt(el.style.left), parseInt(el.style.top));
    };

    handle.addEventListener("mousedown", e => {
      if (e.target.closest("button")) return;
      e.preventDefault();
      startX    = e.clientX;
      startY    = e.clientY;
      startLeft = parseInt(el.style.left) || 160;
      startTop  = parseInt(el.style.top)  || 180;
      handle.style.cursor = "grabbing";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  _clampIntoView() {
    const pos = clampHudElement(this._el);
    if (pos) this._savePos(pos.x, pos.y);
  }

  _savePos(x, y) {
    localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
  }

  _loadPos() {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY));
      if (p?.x != null) return p;
    } catch { /* nothing saved yet */ }
    return { x: 160, y: 180 };
  }
}
