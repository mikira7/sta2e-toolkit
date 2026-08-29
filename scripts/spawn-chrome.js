/**
 * sta2e-toolkit | spawn-chrome.js
 *
 * Markup helpers shared by the spawn window's three tabs — the counterpart of
 * `panelBar` / `field` / `numInput` in task-maker.js.
 *
 * A leaf: it imports nothing but lcars-theme.js, so spawn-window.js and all
 * three tabs can use it without closing an import cycle.
 *
 * Two rules everything here exists to enforce, both inherited from the card
 * stylesheets and written into styles/spawn-window.css:
 *
 *   • Emit NO inline `border-radius` and NO inline `display`. Inline beats any
 *     selector, so either one would put that element permanently out of reach
 *     of the per-theme radius blocks at the bottom of the stylesheet. This is
 *     the trap `unroundButtons()` in chat-card-frame.js exists to undo — do not
 *     recreate it here.
 *   • The one colour a caller may set inline is the accent, and it rides on a
 *     single custom property, `--sw-a` (the counterpart of `--tmk-a`, `--ccf-c`
 *     and `--tcs-a`). Everything else comes from getLcCssVars("sw") on the root.
 *
 * The string helpers build markup for `buildHTML()`; the element helpers build
 * the rail's keys, which need listeners and so cannot be markup.
 */

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

/** An accent as an inline style attribute fragment, or "" when unset. */
const accentAttr = accent => (accent ? ` style="--sw-a:${accent}"` : "");

// ── Layout ────────────────────────────────────────────────────────────────────

/**
 * The two content columns a tab's buildHTML() must return.
 *
 * The chrome injects its rail between them, which is why the order is fixed and
 * why there must be exactly these two children — see openSpawnWindow().
 */
export function swColumns(leftHtml, rightHtml = "") {
  return `
    <div class="sw-col sw-col--left">${leftHtml}</div>
    <div class="sw-col sw-col--right">${rightHtml}</div>`;
}

/**
 * A titled section: a label over a rule, then the body.
 *
 * Not a filled bar. The frame is already doing the heavy LCARS work, and a
 * second row of filled bars inside it reads as noise.
 */
export function swPanel(label, bodyHtml, { meta = "", accent = "" } = {}) {
  const metaHtml = meta ? `<span class="sw-panel-meta">${esc(meta)}</span>` : "";
  return `
    <div class="sw-panel">
      <div class="sw-panel-bar"${accentAttr(accent)}><span>${esc(label)}</span>${metaHtml}</div>
      <div class="sw-panel-body">${bodyHtml}</div>
    </div>`;
}

/** A grid of fields. `cols` is 2 or 3; anything else is a single column. */
export function swGrid(fieldsHtml, cols = 2) {
  const mod = cols === 3 ? " sw-grid--3" : cols === 2 ? " sw-grid--2" : "";
  return `<div class="sw-grid${mod}">${fieldsHtml}</div>`;
}

// ── Fields ────────────────────────────────────────────────────────────────────

/**
 * One labelled control, optionally with a note line under it.
 *
 * `noteId` gives the note an id so a tab can rewrite it later — the three tabs
 * all use one to explain what the chosen spawn location implies.
 */
export function swField(label, controlHtml, { note = null, noteId = "", wide = false } = {}) {
  // The note slot is ALWAYS emitted, even when empty, and reserves its height in
  // CSS. Every field is then the same three rows — label, control, note — so a
  // grid row lines up whatever its cells happen to carry. Emitting it only when
  // there was something to say is what made Beam Site (which always has a note)
  // sit a line above Beam-In Pattern (which never does).
  return `
    <div class="sw-field${wide ? " sw-field--wide" : ""}">
      <label class="sw-label">${esc(label)}</label>
      ${controlHtml}
      <div class="sw-note"${noteId ? ` id="${noteId}"` : ""}>${esc(note ?? "")}</div>
    </div>`;
}

/** A checkbox field — a row rather than a stack, so the label sits beside it. */
export function swCheckField(label, { id = "", checked = false } = {}) {
  return `
    <div class="sw-field sw-check">
      <input type="checkbox"${id ? ` id="${id}"` : ""}${checked ? " checked" : ""}>
      <label class="sw-label"${id ? ` for="${id}"` : ""}>${esc(label)}</label>
    </div>`;
}

export function swSelect({ id = "", options = "", attrs = "" } = {}) {
  return `<select class="sw-select"${id ? ` id="${id}"` : ""}${attrs}>${options}</select>`;
}

export function swInput({ id = "", type = "number", value = "", attrs = "" } = {}) {
  return `<input class="sw-input" type="${type}"${id ? ` id="${id}"` : ""} value="${esc(value)}"${attrs}>`;
}

/** Build `<option>` markup from entries, marking `selected` where it matches. */
export function swOptions(entries, selected) {
  return entries
    .map(([value, label]) =>
      `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`)
    .join("");
}

// ── Rail elements ─────────────────────────────────────────────────────────────

/**
 * One LCARS key. Filled, square, black label — the frame carries every curve,
 * so a rounded key here fights it.
 *
 * The accent is written as `--sw-a` rather than as `background`, so a `:hover`
 * or an `.is-active` rule can still recolour it from the stylesheet.
 */
export function swKey(label, { icon = "", accent = "", className = "", title = "" } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `sw-key${className ? ` ${className}` : ""}`;
  if (accent) btn.style.setProperty("--sw-a", accent);
  if (title) btn.title = title;
  if (icon) {
    const i = document.createElement("i");
    i.className = icon;
    btn.appendChild(i);
  }
  const span = document.createElement("span");
  span.textContent = label;
  btn.appendChild(span);
  return btn;
}

/**
 * A decorative filler block. Inert by design — it is what makes the rail read
 * as an LCARS console rather than as a column of buttons with a gap in it.
 *
 * Sizes are classes, not inline heights, so an era can retune them.
 */
export function swDeco({ size = "sm", accent = "", fill = false } = {}) {
  const el = document.createElement("div");
  el.className = `sw-deco sw-deco--${size}${fill ? " sw-deco--fill" : ""}`;
  el.setAttribute("aria-hidden", "true");
  if (accent) el.style.setProperty("--sw-a", accent);
  return el;
}
