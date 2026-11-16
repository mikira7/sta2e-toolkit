/**
 * sta2e-toolkit | forcefield-config.js
 *
 * The Forcefield fieldset on the Wall Config sheet. Every control uses its
 * flag's native form path (`flags.sta2e-toolkit.<key>`), so the sheet's own
 * submit saves it — the region-pad-config.js / Sequence Group trick — and this
 * file never calls `document.update()`.
 */

import { FF_DEFAULTS, FF_FLAGS, FF_STYLE_ORDER, FF_STYLES, MODULE } from "./forcefield-data.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

const path = key => `flags.${MODULE}.${FF_FLAGS[key]}`;

function _row(label, field, hint = "") {
  return `
    <div class="form-group">
      <label>${label}</label>
      <div class="form-fields">${field}</div>
      ${hint ? `<p class="hint">${hint}</p>` : ""}
    </div>`;
}

function _inject(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  if (root.querySelector(`[name="${path("enabled")}"]`)) return;   // idempotency guard
  const doc = app?.document ?? app?.object ?? null;
  const f = doc?.flags?.[MODULE] ?? {};
  const val = key => f[FF_FLAGS[key]];
  const str = key => esc(val(key) ?? "");

  const styleOpts = FF_STYLE_ORDER.map(id =>
    `<option value="${id}" ${(val("style") ?? FF_DEFAULTS.style) === id ? "selected" : ""}>${esc(FF_STYLES[id].label)}</option>`,
  ).join("");

  const set = document.createElement("fieldset");
  set.className = "sta2e-forcefield-config";
  set.innerHTML = `
    <legend>Forcefield <span style="opacity:0.65;">(STA Toolkit)</span></legend>
    ${_row("Forcefield Door",
      `<input type="checkbox" name="${path("enabled")}" ${val("enabled") === true ? "checked" : ""}>`,
      "Door walls only. The field is up while the door is Closed or Locked and down while it is Open, "
        + "so the door control, Door &amp; Light Control and Region Logic all drive it. Set the door's own "
        + "sound to None and use the sounds below instead.")}
    ${_row("Style", `<select name="${path("style")}">${styleOpts}</select>`)}
    ${_row("Colour",
      `<input type="text" name="${path("color")}" value="${str("color")}" placeholder="Style colour" pattern="^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$">`
        + `<input type="color" data-ff-swatch value="${/^#[0-9a-f]{6}$/i.test(val("color") ?? "") ? str("color") : FF_STYLES[val("style") ?? FF_DEFAULTS.style]?.color ?? "#4d9dff"}">`,
      "Blank uses the style's colour.")}
    ${_row("Intensity",
      `<input type="range" name="${path("intensity")}" min="0" max="100" step="5" value="${Number(val("intensity") ?? FF_DEFAULTS.intensity)}">`
        + `<span class="range-value" data-ff-out>${Number(val("intensity") ?? FF_DEFAULTS.intensity)}</span>`)}
    ${_row("Thickness",
      `<input type="number" name="${path("thickness")}" min="5" max="100" step="5" value="${str("thickness")}" placeholder="${FF_DEFAULTS.thickness}">`,
      "Width of the whole glow, as a percentage of a grid square.")}
    ${_row("Draw Over Tokens",
      `<input type="checkbox" name="${path("above")}" ${val("above") === true ? "checked" : ""}>`,
      "Off: the field lies on the floor under tokens. On: a curtain drawn over them.")}
    ${_row("Sound When Raised", `<file-picker name="${path("soundUp")}" type="audio" value="${str("soundUp")}"></file-picker>`)}
    ${_row("Sound When Lowered", `<file-picker name="${path("soundDown")}" type="audio" value="${str("soundDown")}"></file-picker>`)}
    ${_row("Sound On Contact", `<file-picker name="${path("soundHit")}" type="audio" value="${str("soundHit")}"></file-picker>`,
      "Played when a token runs into the raised field.")}
    ${_row("Sound Volume",
      `<input type="number" name="${path("volume")}" min="0" max="1" step="0.05" value="${str("volume")}" placeholder="${FF_DEFAULTS.volume}">`)}
    ${_row("Sound Heard Within",
      `<input type="number" name="${path("radius")}" min="0" step="1" value="${str("radius")}" placeholder="Everywhere">`,
      "In scene distance units. Blank or 0: everyone viewing the scene hears it.")}`;

  // The swatch is a picker for the text field, never a form field of its own.
  const text = set.querySelector(`[name="${path("color")}"]`);
  const swatch = set.querySelector("[data-ff-swatch]");
  swatch?.addEventListener("input", () => { text.value = swatch.value; });
  const range = set.querySelector(`[name="${path("intensity")}"]`);
  const out = set.querySelector("[data-ff-out]");
  range?.addEventListener("input", () => { out.textContent = range.value; });

  // Inside the sheet's scrolling body (wall-config.hbs wraps it in
  // `.standard-form.scrollable`), at its end. Appended to the form instead, the
  // fieldset sat under the footer and squeezed the body, and lost the sheet's
  // row styles.
  const body = root.querySelector(".standard-form.scrollable, .scrollable")
    ?? [...root.querySelectorAll("fieldset")].filter(f => !f.closest("footer")).pop()?.parentElement
    ?? root.querySelector("form") ?? root;
  body.appendChild(set);
  try { app.setPosition?.({ height: "auto" }); } catch { /**/ }
}

export function registerForcefieldConfig() {
  Hooks.on("renderWallConfig", _inject);
}
