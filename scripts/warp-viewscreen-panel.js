/**
 * Warp Viewscreen — the GM control panel.
 *
 * A floating LCARS panel that drives the live sequence: pick a viewscreen on the
 * scene, jump to warp, ride it, drop out. Built the same way as toolkit-widget.js
 * — a plain element with inline cssText from `getLcTokens()` resolved at *render*
 * time, dragged by its header, clamped by hud-position.js, position persisted in
 * localStorage.
 *
 * Every control writes through `_apply()` to the behavior document. Nothing here
 * touches PIXI and nothing here emits a socket message: the document update is
 * what reaches the other clients.
 */

import { getLcTokens } from "./lcars-theme.js";
import { clampHudPos, clampHudElement, onViewportResize } from "./hud-position.js";
import {
  VIEWSCREEN_TYPE,
  listViewscreenBehaviors,
  viewscreenLabel,
  enterWarp,
  exitWarp,
  effectivePhase,
  isAtWarp,
  pickVanishingPoint,
  IMAGE_FIT_CHOICES,
  IMAGE_ENTRY_FIELDS,
  IMAGE_FRAMING_FIELDS,
  IMAGE_ENTRY_DEFAULTS,
  imageEntryLabel,
} from "./warp-viewscreen-behavior.js";
import { numOrNull } from "./warp-viewscreen-vfx.js";
import {
  getEnvironment,
  environmentsForSurface,
  environmentFieldLabel,
  environmentDefaults,
  isEnvironmentId,
  DEFAULT_ENVIRONMENT,
} from "./viewscreen-environments.js";
import {
  presetsForEnvironment,
  defaultPresetFor,
  getViewscreenPreset,
  presetLabel,
  pickPresetLook,
  resolveEnvironmentLook,
  saveViewscreenPreset,
  updateViewscreenPreset,
  deleteViewscreenPreset,
  setDefaultViewscreenPreset,
  VIEWSCREEN_PRESET_SETTING,
} from "./viewscreen-presets.js";

const PANEL_ID = "sta2e-warp-viewscreen-panel";

/**
 * Two columns of the panel's original width, plus the gap, the rule between
 * them and the body's own padding. Fixed rather than fitted to content, so the
 * panel never resizes under the pointer when a control appears or goes away.
 */
const COL_W     = 240;
const COL_GAP   = 8;
const PANEL_W   = COL_W * 2 + COL_GAP * 3 + 1 + 8;
/** Caps the panel so a long column scrolls rather than running off the screen. */
const COL_MAX_H = "76vh";
const POS_KEY  = "sta2e-toolkit.warpViewscreenPanelPos";

/** Entry labels are GM-typed text going into an attribute in the name prompt. */
function _escAttr(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;")
                        .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** How the current phase reads in the status strip. */
const PHASE_TEXT = {
  idle:     "SUBLIGHT",
  entering: "ENGAGING…",
  cruise:   "AT WARP",
  exiting:  "DROPPING OUT…",
};

export class WarpViewscreenPanel {

  constructor() {
    this._el            = null;
    this._visible       = false;
    this._selectedUuid  = null;
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
      ui.notifications.warn("The Warp Viewscreen panel is GM-only.");
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

  /** The behavior the panel is pointed at, re-resolved every time. */
  get behavior() {
    const all = listViewscreenBehaviors();
    if (!all.length) return null;
    return all.find(b => b.uuid === this._selectedUuid) ?? all[0];
  }

  // ── Build ────────────────────────────────────────────────────────────────────

  _build() {
    const LC = getLcTokens();

    const el = document.createElement("div");
    el.id = PANEL_ID;
    el.style.cssText = `
      position: fixed; z-index: 9998; display: flex; flex-direction: column; width: ${PANEL_W}px;
      background: ${LC.bg}; border: 1px solid ${LC.border}; border-left: 4px solid ${LC.primary};
      border-radius: 2px; box-shadow: 0 4px 20px rgba(0,0,0,0.85), 0 0 10px rgba(102,187,255,0.12);
      font-family: ${LC.font}; color: ${LC.text}; user-select: none; overflow: hidden;
    `;

    const pos = this._loadPos();
    el.style.left = `${pos.x}px`;
    el.style.top  = `${pos.y}px`;

    // ── Header (drag handle) ──────────────────────────────────────────────────
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
    title.textContent = "Warp Viewscreen";

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

    // ── Body — two columns, both rebuilt wholesale by render() ────────────────
    //
    // The panel used to be one 240px column, and adding the backdrop-image block
    // made it tall enough to run off the bottom of the screen with no way to
    // reach the controls down there. The columns scroll *independently* rather
    // than the body scrolling as a whole: they differ enormously in height, and
    // one shared scrollbar would drag the short one out of view along with the
    // long one. The header and footer sit outside, so neither can scroll away.
    const body = document.createElement("div");
    body.dataset.role = "body";
    body.style.cssText = `
      display: flex; align-items: flex-start; gap: ${COL_GAP}px;
      padding: 6px 8px 8px; background: ${LC.panel};
    `;

    const colStyle = `
      box-sizing: border-box; min-width: 0;
      display: flex; flex-direction: column; gap: 4px;
      max-height: ${COL_MAX_H}; overflow-y: auto; overscroll-behavior: contain;
      scrollbar-width: thin;
    `;

    const main = document.createElement("div");
    main.dataset.role = "main";
    main.style.cssText = colStyle + `flex: 0 0 ${COL_W}px; width: ${COL_W}px;`;

    const side = document.createElement("div");
    side.dataset.role = "side";
    // The rule down the middle is what makes the two read as columns rather than
    // as one long wrapped list.
    side.style.cssText = colStyle
      + `flex: 0 0 ${COL_W + COL_GAP + 1}px; width: ${COL_W + COL_GAP + 1}px;`
      + `border-left: 1px solid ${LC.borderDim}; padding-left: ${COL_GAP}px;`;

    body.append(main, side);
    el.appendChild(body);
    this._body = main;
    this._side = side;

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
      pos2 => this._savePos(pos2.x, pos2.y),
    );
  }

  /**
   * Show or collapse the second column.
   *
   * Sets `display` rather than `hidden`: every style in this panel is inline, and
   * an inline `display: flex` outranks the UA stylesheet's `[hidden]` rule. The
   * shell keeps its width either way, so the panel does not jump.
   */
  _showSide(on) {
    if (!this._side) return;
    this._side.style.display = on ? "flex" : "none";
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

  /**
   * A dropdown.
   *
   * Generalised out of the viewscreen-target picker, which was the only select
   * in the panel and was built inline. The environment picker needs the same
   * thing, and a third caller would have been the point at which the duplication
   * became a bug waiting to happen.
   *
   * Option text is set with `textContent`, never `innerHTML` — region names and
   * behavior names are user data.
   */
  _mkSelect(entries, value, onChange) {
    const LC  = getLcTokens();
    const sel = document.createElement("select");
    sel.style.cssText = `
      width: 100%; background: ${LC.bg}; color: ${LC.text}; font-family: ${LC.font};
      font-size: 10px; border: 1px solid ${LC.borderDim}; border-radius: 2px; padding: 3px 4px;
    `;
    for (const entry of entries) {
      const opt = document.createElement("option");
      opt.value = entry.value;
      opt.textContent = entry.label;
      if (entry.title) opt.title = entry.title;
      if (entry.value === value) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }

  /** A row of labelled colour wells, one per schema colour field. */
  _mkSwatches(entries) {
    const LC  = getLcTokens();
    const row = document.createElement("div");
    row.style.cssText = "display: flex; gap: 6px; padding: 2px 0;";

    for (const { label, key, value, fallback } of entries) {
      const cell = document.createElement("label");
      cell.style.cssText = `
        flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px;
        font-size: 8px; letter-spacing: 0.12em; text-transform: uppercase;
        color: ${LC.textDim}; cursor: pointer;
      `;
      const name = document.createElement("span");
      name.textContent = label;

      const input = document.createElement("input");
      input.type = "color";
      // A ColorField hands back a Color instance; its toString is #rrggbb, which
      // is the only form input[type=color] accepts.
      input.value = String(value ?? fallback);
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

  /**
   * A file path with a browse button.
   *
   * The module-wide FilePicker idiom (star-system-images.js, effect-config.js,
   * character-creator.js all spell it this way). Typing a path by hand commits on
   * `change`, so a pasted URL works as well as a browsed one.
   */
  _mkFilePick(labelText, value, onPick) {
    const LC   = getLcTokens();
    const wrap = document.createElement("div");
    wrap.style.cssText = "display: flex; flex-direction: column; gap: 2px;";
    wrap.appendChild(this._mkLabel(labelText));

    const row = document.createElement("div");
    row.style.cssText = "display: flex; gap: 4px; align-items: center;";

    const input = document.createElement("input");
    input.type        = "text";
    input.value       = value ?? "";
    input.placeholder = "path/to/image.webp";
    input.style.cssText = `
      flex: 1; min-width: 0; background: ${LC.bg}; color: ${LC.text};
      font-family: ${LC.font}; font-size: 10px; border: 1px solid ${LC.borderDim};
      border-radius: 2px; padding: 3px 4px;
    `;
    input.addEventListener("change", () => onPick(input.value.trim() || null));

    const browse = document.createElement("button");
    browse.type  = "button";
    browse.title = "Browse for an image or video";
    browse.style.cssText = `
      flex: 0 0 auto; padding: 3px 7px; background: transparent;
      border: 1px solid ${LC.borderDim}; border-radius: 2px;
      color: ${LC.textDim}; font-size: 10px; cursor: pointer;
    `;
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-folder-open";
    browse.appendChild(icon);
    browse.addEventListener("click", () => {
      const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
      if (typeof FP !== "function") return;
      new FP({
        type: "imagevideo",
        current: input.value || "",
        callback: path => {
          input.value = path ?? "";
          onPick(String(path ?? "").trim() || null);
        },
      }).render(true);
    });

    row.append(input, browse);
    wrap.appendChild(row);
    return wrap;
  }

  /** A one-field name prompt, for the backdrop library. Null if dismissed. */
  async _promptName(title, initial = "") {
    const data = await foundry.applications.api.DialogV2.prompt({
      window: { title },
      position: { width: 320 },
      rejectClose: false,
      content: `
        <form style="padding:8px 4px;">
          <div class="form-group">
            <label>Name</label>
            <input type="text" name="label" value="${_escAttr(initial)}"
              placeholder="e.g. Earth from orbit" autofocus />
          </div>
        </form>`,
      ok: {
        label: "Save",
        callback: (_event, _button, dialog) => {
          const form = dialog.element.querySelector("form");
          return form ? new foundry.applications.ux.FormDataExtended(form).object : null;
        },
      },
    });
    const name = String(data?.label ?? "").trim();
    return name || null;
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  render() {
    if (!this._el || !this._body) return;
    const LC   = getLcTokens();
    const body = this._body;
    body.replaceChildren();
    this._side?.replaceChildren();

    const all = listViewscreenBehaviors();

    if (!all.length) {
      const empty = document.createElement("div");
      empty.style.cssText = `
        font-size: 10px; line-height: 1.5; color: ${LC.textDim}; padding: 6px 2px;
      `;
      empty.textContent =
        "No warp viewscreen on this scene. Draw a Region over the viewscreen, "
        + "open its config, and add the Warp Viewscreen behavior.";
      body.appendChild(empty);
      this._showSide(false);
      return;
    }

    this._showSide(true);

    const behavior = this.behavior;
    this._selectedUuid = behavior.uuid;
    const sys   = behavior.system ?? {};
    const phase = effectivePhase(behavior);
    const warp  = isAtWarp(behavior);

    // ── Target ────────────────────────────────────────────────────────────────
    if (all.length > 1) {
      body.appendChild(this._mkLabel("Viewscreen"));
      body.appendChild(this._mkSelect(
        all.map(b => ({
          value: b.uuid,
          label: viewscreenLabel(b) + (b.disabled ? " (disabled)" : ""),
        })),
        behavior.uuid,
        uuid => { this._selectedUuid = uuid; this.render(); },
      ));
    }

    // ── Status strip ──────────────────────────────────────────────────────────
    const status = document.createElement("div");
    const statusColor = warp ? (LC.secondary ?? "#66ccff") : LC.textDim;
    status.style.cssText = `
      display: flex; justify-content: space-between; align-items: baseline;
      padding: 4px 6px; margin-top: 2px; border-left: 3px solid ${statusColor};
      background: ${statusColor}14; font-size: 10px; letter-spacing: 0.12em;
      text-transform: uppercase; color: ${statusColor};
    `;
    const statusText = document.createElement("span");
    statusText.textContent = PHASE_TEXT[phase] ?? "SUBLIGHT";
    const statusWarp = document.createElement("span");
    statusWarp.style.cssText = "font-weight: 700;";
    statusWarp.textContent = warp ? `WF ${Number(sys.warpFactor ?? 6).toFixed(1)}` : "";
    status.append(statusText, statusWarp);
    body.appendChild(status);

    if (behavior.disabled) {
      const warn = document.createElement("div");
      warn.style.cssText = `font-size: 9px; color: ${LC.yellow ?? "#ffcc66"}; padding: 2px 2px 0;`;
      warn.textContent = "This behavior is disabled — nothing will render until you enable it.";
      body.appendChild(warn);
    }

    // ── Environment ───────────────────────────────────────────────────────────
    // Which controls make sense depends on what is being drawn. Static has no
    // flight, no aim and no starfield; warp has no intensity or star mix,
    // because it *is* the unmodified field — which is what keeps warp's panel
    // exactly as it was before environments existed, one picker row aside.
    const envId    = getEnvironment(sys.environment).id;
    const env      = getEnvironment(envId);
    const isWarp   = envId === DEFAULT_ENVIRONMENT;
    const flies    = !env.grain;                  // static is a screen state, not a place
    const hasStars = flies;
    const label    = (field, fallback) => environmentFieldLabel(env, field, fallback);

    body.appendChild(this._mkLabel("Environment"));
    body.appendChild(this._mkSelect(
      environmentsForSurface("viewscreen").map(e => ({
        value: e.id, label: e.label, title: e.hint,
      })),
      envId,
      // The defaults ride along in the same update, so picking an environment
      // gives a tuned look rather than the previous one's numbers wearing new
      // labels. The behavior sheet's own dropdown deliberately does not do this.
      // `resolveEnvironmentLook` is the built-in tuning with the GM's default
      // preset for that environment laid over it — which is the whole point of
      // saving one: pick slipstream and it comes up the way you like it.
      id => this._apply({
        environment: id,
        lookPreset: defaultPresetFor(id)?.id ?? "",
        ...resolveEnvironmentLook(id),
      }),
    ));

    // ── The primary beat ──────────────────────────────────────────────────────
    body.appendChild(warp
      ? this._mkBtn("fas fa-arrow-down-short-wide", "Exit Warp", "Drop the viewscreen back to sublight",
          LC.yellow ?? "#ffcc66", () => this._run(() => exitWarp(behavior)), { big: true })
      : this._mkBtn("fas fa-rocket", "Enter Warp", "Jump the viewscreen to warp",
          LC.secondary ?? "#66ccff", () => this._run(() => enterWarp(behavior)), { big: true }));

    // ── Flight ────────────────────────────────────────────────────────────────
    if (flies) {
      body.appendChild(this._mkSlider("Warp Factor", {
        min: 1, max: 9.9, step: 0.1, value: Number(sys.warpFactor ?? 6),
        format: v => `WF ${v.toFixed(1)}`,
        // Live while at warp: the renderer reads warpFactor every tick, so this
        // re-eases the speed in place without restarting the phase.
        onCommit: v => this._apply({ warpFactor: v }),
      }));

      body.appendChild(this._mkSlider(label("spread", "Spread"), {
        min: 0, max: 100, step: 5, value: Number(sys.spread ?? 30),
        format: v => (v === 0 ? "point" : `${v}%`),
        onCommit: v => this._apply({ spread: v }),
      }));

      body.appendChild(this._mkBtn(
        sys.inbound ? "fas fa-arrows-to-dot" : "fas fa-arrows-to-circle",
        sys.inbound ? "Flow: Inward (rear)" : "Flow: Outward (forward)",
        "Outward: flying toward the vanishing point. Inward: a rear view, or backing away.",
        LC.tertiary ?? LC.secondary ?? "#66ccff",
        () => this._apply({ inbound: !sys.inbound }),
      ));
    }

    // ── Aim ───────────────────────────────────────────────────────────────────
    // numOrNull, not Number.isFinite(Number(v)) — Number(null) is a finite 0,
    // which would report an unset point as a real one at the canvas origin.
    const vx = numOrNull(sys.vanishX);
    const vy = numOrNull(sys.vanishY);
    const aimed = vx !== null && vy !== null;

    if (flies) {
      body.appendChild(this._mkLabel("Vanishing Point"));
      body.appendChild(this._mkBtn(
        "fas fa-crosshairs",
        aimed ? `Set (${Math.round(vx)}, ${Math.round(vy)})` : "Set (centred)",
        "Click a point on the canvas for the stars to stream out of",
        LC.green ?? "#66cc66",
        () => this._pickPoint(behavior),
      ));
      if (aimed) {
        body.appendChild(this._mkBtn(
          "fas fa-xmark", "Re-centre on Region",
          "Drop the picked point and centre the stars on the region",
          LC.textDim,
          () => this._apply({ vanishX: null, vanishY: null }),
        ));
      }
    }

    // ── Look ──────────────────────────────────────────────────────────────────
    if (!isWarp) {
      body.appendChild(this._mkSlider(label("intensity", "Intensity"), {
        min: 0, max: 100, step: 5, value: Number(sys.intensity ?? 100),
        format: v => `${v}%`,
        onCommit: v => this._apply({ intensity: v }),
      }));
      if (hasStars) {
        body.appendChild(this._mkSlider("Starfield Mix", {
          min: 0, max: 100, step: 5, value: Number(sys.starMix ?? 100),
          format: v => (v === 0 ? "no stars" : `${v}%`),
          onCommit: v => this._apply({ starMix: v }),
        }));
      }
    }

    // An Ion Storm already carries its own discharge, so the field would be a
    // control with nothing to act on — the resolver ignores it there anyway.
    if (!env.strobe) {
      body.appendChild(this._mkSlider("Lightning", {
        min: 0, max: 100, step: 5, value: Number(sys.lightning ?? 0),
        format: v => (v === 0 ? "off" : `${v}%`),
        onCommit: v => this._apply({ lightning: v }),
      }));
    }

    // Signal Loss *is* interference, so laying more over it would be a control
    // with nothing to act on — the resolver ignores the field there anyway.
    if (!env.grain) {
      body.appendChild(this._mkSlider("Interference", {
        min: 0, max: 100, step: 5, value: Number(sys.interference ?? 0),
        format: v => (v === 0 ? "clear" : `${v}%`),
        onCommit: v => this._apply({ interference: v }),
      }));
    }

    if (hasStars) {
      body.appendChild(this._mkSlider(label("density", "Star Count"), {
        min: 20, max: 1500, step: 10, value: Number(sys.density ?? 600),
        format: v => `${v}`,
        onCommit: v => this._apply({ density: v }),
      }));
      body.appendChild(this._mkSlider(label("streakMul", "Streak Length"), {
        min: 10, max: 400, step: 5, value: Number(sys.streakMul ?? 100),
        format: v => `${v}%`,
        onCommit: v => this._apply({ streakMul: v }),
      }));
      body.appendChild(this._mkSlider(label("thickness", "Streak Thickness"), {
        min: 50, max: 400, step: 5, value: Number(sys.thickness ?? 100),
        format: v => `${v}%`,
        onCommit: v => this._apply({ thickness: v }),
      }));
      body.appendChild(this._mkSlider(label("variety", "Colour Variety"), {
        min: 0, max: 100, step: 5, value: Number(sys.variety ?? 45),
        format: v => `${v}%`,
        onCommit: v => this._apply({ variety: v }),
      }));
    }

    body.appendChild(this._mkSwatches([
      { label: "Star",   key: "starTint",   value: sys.starTint,   fallback: "#cfe6ff" },
      { label: label("accentTint", "Accent"), key: "accentTint", value: sys.accentTint, fallback: "#a855f7" },
      { label: "Space",  key: "backdrop",   value: sys.backdrop,   fallback: "#05030c" },
    ]));

    body.appendChild(this._mkSlider("Backdrop Opacity", {
      min: 0, max: 100, step: 5, value: Number(sys.backdropAlpha ?? 85),
      format: v => (v === 0 ? "off" : `${v}%`),
      onCommit: v => this._apply({ backdropAlpha: v }),
    }));

    if (env.haze) {
      body.appendChild(this._mkBtn(
        sys.nebula === false ? "fas fa-circle" : "fas fa-cloud",
        sys.nebula === false ? "Ambient Haze: Off" : "Ambient Haze: On",
        "A soft wash of the accent colour off to one side",
        LC.textDim,
        () => this._apply({ nebula: sys.nebula === false }),
      ));
    }

    body.appendChild(this._mkBtn(
      sys.flash === true ? "fas fa-sun" : "fas fa-circle",
      sys.flash === true ? "Starburst: On" : "Starburst: Off",
      "A short white burst at the centre of the viewscreen when entering or dropping out of warp",
      LC.textDim,
      () => this._apply({ flash: sys.flash !== true }),
    ));

    body.appendChild(this._mkBtn(
      sys.aboveTokens ? "fas fa-layer-group" : "fas fa-layer-group",
      sys.aboveTokens ? "Above Tokens" : "Below Tokens",
      "Below keeps crew standing in front of the viewscreen. Above suits a window a token passes behind.",
      LC.textDim,
      () => this._apply({ aboveTokens: !sys.aboveTokens }),
    ));
    // A persistent environment ignores this — it keeps running at rest by
    // definition, so offering the switch would be offering a no-op.
    if (!env.restAmbient) {
      body.appendChild(this._mkBtn(
        sys.sublightDrift ? "fas fa-eye" : "fas fa-eye-slash",
        sys.sublightDrift ? "Drift When Idle: On" : "Drift When Idle: Off",
        "Whether a slow starfield keeps running while not at warp",
        LC.textDim,
        () => this._apply({ sublightDrift: !sys.sublightDrift }),
      ));
    }

    const myDefault = defaultPresetFor(envId);
    // Warp hid this button because resetting to the built-in warp tuning was a
    // no-op. A saved default for warp makes it meaningful again.
    if (!isWarp || myDefault) {
      body.appendChild(this._mkBtn(
        "fas fa-rotate-left",
        myDefault ? `Reset to “${presetLabel(myDefault)}”` : "Reset to Environment Defaults",
        myDefault
          ? `Put every look setting back to your saved default for ${env.label}`
          : `Put every look setting back to the tuned starting point for ${env.label}`,
        LC.textDim,
        () => this._apply({
          lookPreset: myDefault?.id ?? "",
          ...resolveEnvironmentLook(envId),
        }),
      ));
    }

    // The two library features share the second column, presets first: a look is
    // chosen before the picture that sits in it.
    if (this._side) this._renderPresetSection(this._side, sys, LC, env, envId);

    // The backdrop image takes the rest of the second column. It is the one block here
    // that is about *what the screen shows* rather than about flying, and on its
    // own it is nearly as tall as everything above — which is what pushed the
    // single-column panel off the bottom of the screen.
    if (this._side) this._renderImageSection(this._side, sys, LC);
  }


  /**
   * The saved-look preset block.
   *
   * Unlike the backdrop-image library there is **no write-through here**: moving
   * a slider must not quietly rewrite the saved preset, or a GM could never try
   * something without losing the look they were starting from. Presets are
   * applied and updated explicitly, which is why this block has an Update button
   * and the image block deliberately does not.
   */
  _renderPresetSection(body, sys, LC, env, envId) {
    const list      = presetsForEnvironment(envId);
    const fallback  = defaultPresetFor(envId);
    const appliedId = String(sys.lookPreset ?? "");
    // A preset filed under a *different* environment is not this screen's, and
    // one the GM deleted from another client is simply gone.
    const applied   = list.find(p => p.id === appliedId) ?? null;

    body.appendChild(this._mkLabel(`Look Presets — ${env.label}`));

    body.appendChild(this._mkSelect(
      [
        {
          value: "",
          label: "— Built-in defaults —",
          title: `Put every look setting back to the tuned starting point for ${env.label}`,
        },
        ...list.map(p => ({
          value: p.id,
          label: (p.isDefault ? "★ " : "") + presetLabel(p),
          title: p.isDefault
            ? "Applied automatically whenever you pick this environment"
            : presetLabel(p),
        })),
      ],
      applied ? applied.id : "",
      id => this._applyPreset(id),
    ));

    body.appendChild(this._mkBtn(
      "fas fa-bookmark", "Save Current Look…",
      `Keep every look setting on this screen as a reusable ${env.label} preset`,
      LC.textDim,
      () => this._savePreset(),
    ));

    if (!applied) {
      if (fallback) {
        const note = document.createElement("div");
        note.style.cssText = `font-size: 9px; line-height: 1.4; color: ${LC.textDim}; padding: 1px 2px 2px;`;
        note.textContent = `“${presetLabel(fallback)}” is applied automatically when you pick ${env.label}.`;
        body.appendChild(note);
      }
      return;
    }

    body.appendChild(this._mkBtn(
      "fas fa-arrows-rotate", "Update From Current Look",
      `Overwrite “${presetLabel(applied)}” with what is on screen now`,
      LC.textDim,
      () => this._updatePreset(),
    ));

    body.appendChild(this._mkBtn(
      applied.isDefault ? "fas fa-star" : "far fa-star",
      applied.isDefault ? `Default for ${env.label}` : `Make Default for ${env.label}`,
      applied.isDefault
        ? "Applied automatically when you pick this environment. Click to stop."
        : "Apply this automatically whenever you pick this environment, on any region or scene",
      LC.textDim,
      () => this._toggleDefaultPreset(),
    ));

    body.appendChild(this._mkBtn(
      "fas fa-pen", "Rename Preset",
      `Rename “${presetLabel(applied)}”`,
      LC.textDim,
      () => this._renamePreset(),
    ));

    body.appendChild(this._mkBtn(
      "fas fa-trash", "Delete Preset",
      `Remove “${presetLabel(applied)}” from the library on every scene`,
      LC.textDim,
      () => this._deletePreset(),
    ));
  }

  /**
   * The backdrop image block.
   *
   * There is deliberately no "Update Entry" button: `_apply` mirrors every live
   * image field back into the active library entry as it is changed, so a saved
   * backdrop cannot silently drift from what is on screen and there is no dirty
   * state to explain.
   */
  _renderImageSection(body, sys, LC) {
    const entries = Array.isArray(sys.images) ? sys.images : [];
    const active  = String(sys.activeImage ?? "");
    const entry   = entries.find(e => String(e?.id ?? "") === active) ?? null;
    const src     = sys.imageSrc ? String(sys.imageSrc) : "";

    body.appendChild(this._mkLabel("Backdrop Image"));

    if (entries.length) {
      body.appendChild(this._mkSelect(
        [
          { value: "", label: "— Not from the library —" },
          ...entries.map(e => ({
            value: String(e?.id ?? ""),
            label: imageEntryLabel(e),
            title: String(e?.src ?? ""),
          })),
        ],
        entry ? active : "",
        id => this._selectImageEntry(id),
      ));
    }

    body.appendChild(this._mkFilePick(
      "File", src,
      // Detaches from the library: a new file is a different backdrop, not a
      // retuning of the saved one, and the select drops to "Not from the
      // library" until it is saved under its own name.
      path => this._apply({ imageSrc: path, activeImage: "" }),
    ));

    if (!src) return;

    body.appendChild(this._mkLabel("Fit"));
    body.appendChild(this._mkSelect(
      Object.entries(IMAGE_FIT_CHOICES).map(([value, label]) => ({ value, label })),
      String(sys.imageFit ?? "cover"),
      fit => this._apply({ imageFit: fit }),
    ));

    body.appendChild(this._mkSlider("Image Scale", {
      min: 10, max: 400, step: 5, value: Number(sys.imageScale ?? 100),
      format: v => `${v}%`,
      onCommit: v => this._apply({ imageScale: v }),
    }));
    body.appendChild(this._mkSlider("Image Offset X", {
      min: -100, max: 100, step: 1, value: Number(sys.imageOffsetX ?? 0),
      format: v => `${v}%`,
      onCommit: v => this._apply({ imageOffsetX: v }),
    }));
    body.appendChild(this._mkSlider("Image Offset Y", {
      min: -100, max: 100, step: 1, value: Number(sys.imageOffsetY ?? 0),
      format: v => `${v}%`,
      onCommit: v => this._apply({ imageOffsetY: v }),
    }));
    body.appendChild(this._mkSlider("Image Opacity", {
      min: 0, max: 100, step: 5, value: Number(sys.imageAlpha ?? 100),
      format: v => (v === 0 ? "off" : `${v}%`),
      onCommit: v => this._apply({ imageAlpha: v }),
    }));

    body.appendChild(this._mkBtn(
      sys.imageAbove ? "fas fa-image" : "fas fa-images",
      sys.imageAbove ? "Image Above Stars" : "Image Behind Stars",
      "Behind suits a planet you are flying past. Above suits a star chart, "
      + "tactical display or hail that should cover the field.",
      LC.textDim,
      () => this._apply({ imageAbove: !sys.imageAbove }),
    ));

    body.appendChild(this._mkBtn(
      "fas fa-floppy-disk",
      entry ? "Save as a New Backdrop" : "Save to Library",
      "Keep this picture and its framing under a name you can flip back to",
      LC.textDim,
      () => this._saveImageEntry(),
    ));

    if (entry) {
      body.appendChild(this._mkBtn(
        "fas fa-pen", "Rename Backdrop",
        "Rename the saved backdrop showing now",
        LC.textDim,
        () => this._renameImageEntry(),
      ));
      body.appendChild(this._mkBtn(
        "fas fa-trash", "Remove From Library",
        "Delete the saved backdrop showing now. The picture itself is untouched.",
        LC.textDim,
        () => this._removeImageEntry(),
      ));
    }

    body.appendChild(this._mkBtn(
      "fas fa-xmark", "Clear Image",
      "Stop showing a picture — the starfield alone",
      LC.textDim,
      () => this._apply({ imageSrc: null, activeImage: "" }),
    ));
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  /** Every write goes through here — this is what reaches the other clients. */
  async _apply(patch) {
    const behavior = this.behavior;
    if (!behavior) return;
    try {
      await behavior.update({ system: this._withImageWriteThrough(behavior, patch) });
    } catch (err) {
      console.error("STA2e Toolkit | warp viewscreen: update failed:", err);
      ui.notifications.error("Could not update the viewscreen — see the console.");
    }
    this.render();
  }

  // ── Saved look presets ───────────────────────────────────────────────────────

  /** The current environment id, defended the way the renderer defends it. */
  _envId(sys) {
    const id = String(sys?.environment ?? "");
    return isEnvironmentId(id) ? id : DEFAULT_ENVIRONMENT;
  }

  /**
   * Apply a saved preset, or the built-in tuning when the id is blank.
   *
   * Writes the look *and* the pointer in one update, so a reload still knows
   * which preset is showing and can offer Update and Rename against it.
   */
  _applyPreset(id) {
    const sys   = this.behavior?.system ?? {};
    const envId = this._envId(sys);
    const preset = id ? getViewscreenPreset(id) : null;
    if (id && !preset) return this._apply({ lookPreset: "" });
    return this._apply(preset
      ? { lookPreset: preset.id, ...preset.look }
      : { lookPreset: "", ...environmentDefaults(envId) });
  }

  async _savePreset() {
    const behavior = this.behavior;
    if (!behavior) return;
    const sys   = behavior.system ?? {};
    const envId = this._envId(sys);
    const name  = await this._promptName("Save Look Preset");
    if (!name) return;

    let id;
    try {
      id = await saveViewscreenPreset({
        label: name, environment: envId, look: pickPresetLook(sys),
      });
    } catch (err) {
      console.error("STA2e Toolkit | viewscreen presets: save failed:", err);
      ui.notifications.error("Could not save the preset — see the console.");
      return;
    }
    // Point this viewscreen at what was just saved, so Update and Rename work
    // straight away rather than after a round trip through the dropdown.
    await this._apply({ lookPreset: id });
  }

  async _updatePreset() {
    const sys = this.behavior?.system ?? {};
    const id  = String(sys.lookPreset ?? "");
    if (!id) return;
    await this._runPresetWrite(
      () => updateViewscreenPreset(id, { look: pickPresetLook(sys) }),
      "Could not update the preset",
    );
  }

  async _renamePreset() {
    const sys     = this.behavior?.system ?? {};
    const id      = String(sys.lookPreset ?? "");
    const current = getViewscreenPreset(id);
    if (!current) return;
    const name = await this._promptName("Rename Look Preset", presetLabel(current));
    if (!name) return;
    await this._runPresetWrite(
      () => updateViewscreenPreset(id, { label: name }),
      "Could not rename the preset",
    );
  }

  async _toggleDefaultPreset() {
    const sys     = this.behavior?.system ?? {};
    const id      = String(sys.lookPreset ?? "");
    const current = getViewscreenPreset(id);
    if (!current) return;
    await this._runPresetWrite(
      () => setDefaultViewscreenPreset(id, !current.isDefault),
      "Could not change the default preset",
    );
  }

  async _deletePreset() {
    const sys     = this.behavior?.system ?? {};
    const id      = String(sys.lookPreset ?? "");
    const current = getViewscreenPreset(id);
    if (!current) return;

    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Look Preset" },
      content: `<p style="padding:4px 2px;">Delete the preset
        <strong>${_escAttr(presetLabel(current))}</strong>? It goes from every
        scene. The look on screen now is left exactly as it is.</p>`,
      rejectClose: false,
      modal: true,
    });
    if (!ok) return;

    await this._runPresetWrite(
      () => deleteViewscreenPreset(id),
      "Could not delete the preset",
    );
    // The pointer would otherwise dangle at an id nothing answers to.
    await this._apply({ lookPreset: "" });
  }

  /**
   * Run one library write.
   *
   * Preset writes are a world *setting*, not a document update, so they do not
   * come back through `_apply` and have to re-render the panel themselves.
   */
  async _runPresetWrite(fn, failure) {
    try {
      await fn();
    } catch (err) {
      console.error(`STA2e Toolkit | viewscreen presets: ${failure}:`, err);
      ui.notifications.error(`${failure} — see the console.`);
    }
    this.render();
  }

  // ── The backdrop-image library ─────────────────────────────

  /** The seven live image fields, in the shape one library entry stores. */
  _imageSnapshot(sys) {
    return {
      src:     sys.imageSrc ?? null,
      fit:     String(sys.imageFit ?? "cover"),
      scale:   Number(sys.imageScale ?? 100),
      offsetX: Number(sys.imageOffsetX ?? 0),
      offsetY: Number(sys.imageOffsetY ?? 0),
      alpha:   Number(sys.imageAlpha ?? 100),
      above:   !!sys.imageAbove,
    };
  }

  /** The stored library as plain data, safe to mutate before writing it back. */
  _imageEntries(behavior) {
    const source = behavior?.system?.toObject?.() ?? behavior?.system ?? {};
    const list = Array.isArray(source.images) ? source.images : [];
    return foundry.utils.deepClone(list);
  }

  /**
   * Show a saved backdrop.
   *
   * Copies the entry's values into the live fields in one update, which is the
   * exact shape the Environment select uses for `environmentDefaults`.
   */
  _selectImageEntry(id) {
    const sys   = this.behavior?.system ?? {};
    const list  = Array.isArray(sys.images) ? sys.images : [];
    const entry = list.find(e => String(e?.id ?? "") === String(id));
    if (!entry) return this._apply({ activeImage: "" });

    const patch = { activeImage: String(entry.id) };
    for (const [key, name] of Object.entries(IMAGE_ENTRY_FIELDS)) {
      // `??`, not `||` — an offset of 0 and `above: false` are real values.
      patch[name] = entry[key] ?? IMAGE_ENTRY_DEFAULTS[key];
    }
    return this._apply(patch);
  }

  async _saveImageEntry() {
    const behavior = this.behavior;
    if (!behavior) return;
    const name = await this._promptName("Save Backdrop");
    if (!name) return;

    const sys = behavior.system ?? {};
    const id  = foundry.utils.randomID();
    const images = [...this._imageEntries(behavior),
                    { id, label: name, ...this._imageSnapshot(sys) }];
    await this._apply({ images, activeImage: id });
  }

  async _renameImageEntry() {
    const behavior = this.behavior;
    if (!behavior) return;
    const active = String(behavior.system?.activeImage ?? "");
    const images = this._imageEntries(behavior);
    const idx    = images.findIndex(e => String(e?.id ?? "") === active);
    if (idx < 0) return;

    const name = await this._promptName("Rename Backdrop", images[idx].label ?? "");
    if (!name) return;
    images[idx].label = name;
    await this._apply({ images });
  }

  async _removeImageEntry() {
    const behavior = this.behavior;
    if (!behavior) return;
    const active = String(behavior.system?.activeImage ?? "");
    const images = this._imageEntries(behavior).filter(e => String(e?.id ?? "") !== active);
    // The picture keeps showing — only its place in the library goes, so the GM
    // can tidy the list without the viewscreen blinking.
    await this._apply({ images, activeImage: "" });
  }

  /**
   * Mirror the live image fields back into the active library entry.
   *
   * A slider nudged while a saved backdrop is showing has to stick to that
   * backdrop rather than silently diverging from it, so the mirror rides in the
   * *same* update — which is what removes any need for a Save button or a dirty
   * state. A caller already rewriting `images` owns the list outright.
   *
   * **`src` is deliberately excluded** (`IMAGE_FRAMING_FIELDS`, not
   * `IMAGE_ENTRY_FIELDS`). It is the backdrop's identity rather than its framing,
   * and mirroring it meant browsing for a second picture rewrote the first
   * entry's file before that one had even been saved — leaving every entry
   * pointing at the most recently chosen image. Changing the file detaches from
   * the library at the call site instead.
   */
  _withImageWriteThrough(behavior, patch) {
    if ("images" in patch) return patch;

    const sys      = behavior.system ?? {};
    const activeId = String("activeImage" in patch ? patch.activeImage : (sys.activeImage ?? ""));
    if (!activeId) return patch;
    if (!Object.values(IMAGE_FRAMING_FIELDS).some(name => name in patch)) return patch;

    const images = this._imageEntries(behavior);
    const idx    = images.findIndex(e => String(e?.id ?? "") === activeId);
    if (idx < 0) return patch;

    for (const [key, name] of Object.entries(IMAGE_FRAMING_FIELDS)) {
      if (name in patch) images[idx][key] = patch[name];
    }
    return { ...patch, images };
  }

  async _run(fn) {
    try {
      await fn();
    } catch (err) {
      console.error("STA2e Toolkit | warp viewscreen:", err);
      ui.notifications.error("Warp viewscreen command failed — see the console.");
    }
    this.render();
  }

  async _pickPoint(behavior) {
    // Out of the way of the click.
    const wasVisible = this._visible;
    if (this._el) this._el.style.display = "none";
    let point = null;
    try {
      point = await pickVanishingPoint(behavior.region, { inbound: !!behavior.system?.inbound });
    } finally {
      if (wasVisible && this._el) this._el.style.display = "flex";
    }
    if (!point) return;
    await this._apply({ vanishX: Math.round(point.x), vanishY: Math.round(point.y) });
  }

  // ── Staying in sync ──────────────────────────────────────────────────────────

  _registerHooks() {
    if (this._hookIds.length) return;
    const rerender = doc => {
      if (doc?.type && doc.type !== VIEWSCREEN_TYPE) return;
      if (this._visible) this.render();
    };
    this._hookIds = [
      ["updateRegionBehavior", Hooks.on("updateRegionBehavior", rerender)],
      ["createRegionBehavior", Hooks.on("createRegionBehavior", rerender)],
      ["deleteRegionBehavior", Hooks.on("deleteRegionBehavior", rerender)],
      ["updateSetting",        Hooks.on("updateSetting", setting => {
        // The preset library is a world setting, so nothing else here notices a
        // co-GM saving one.
        if (!String(setting?.key ?? "").endsWith(VIEWSCREEN_PRESET_SETTING)) return;
        if (this._visible) this.render();
      })],
      ["canvasReady",          Hooks.on("canvasReady", () => {
        // New scene, new set of viewscreens.
        this._selectedUuid = null;
        if (this._visible) this.render();
      })],
    ];
  }

  _unregisterHooks() {
    for (const [name, id] of this._hookIds) Hooks.off(name, id);
    this._hookIds = [];
  }

  /**
   * `entering` becomes `cruise` from elapsed time alone, with no document update
   * behind it — so the button label needs its own nudge to catch up. One second
   * is plenty and costs nothing.
   */
  _startPulse() {
    this._stopPulse();
    this._pulse = setInterval(() => {
      if (!this._visible) return;
      const behavior = this.behavior;
      if (!behavior) return;
      const phase = effectivePhase(behavior);
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
      startLeft = parseInt(el.style.left) || 120;
      startTop  = parseInt(el.style.top)  || 160;
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
    return { x: 120, y: 160 };
  }
}
