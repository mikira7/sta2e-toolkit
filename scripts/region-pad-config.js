/**
 * sta2e-toolkit | region-pad-config.js
 * Injects the STA Toolkit spawn-marker fields into the Region config sheet.
 *
 * A Region flagged as a transporter pad is a *marker for one spawn spot*, not an
 * area to fill: draw one small Region on each pad of a transporter room, tick
 * the box, and the spawn window drops one token dead-centre on each. The Pad
 * Group field lets a single scene hold more than one set — a main transporter
 * room and a cargo transporter — without them being treated as one pool.
 *
 * Consumed by listPadGroups() / getPadRegions() / padCentresForSlots() in
 * spawn-regions.js.
 *
 * The fields use the native form paths `flags.sta2e-toolkit.transporterPad` and
 * `flags.sta2e-toolkit.padGroup`, so Foundry persists them on submit with no
 * extra save handler — the same trick zone-token-config.js uses.
 */

const FLAG_SCOPE = "sta2e-toolkit";
export const PAD_FLAG   = "transporterPad";
export const GROUP_FLAG = "padGroup";

const PAD_FORM_PATH   = `flags.${FLAG_SCOPE}.${PAD_FLAG}`;
const GROUP_FORM_PATH = `flags.${FLAG_SCOPE}.${GROUP_FLAG}`;

/** The group name is user text going back into an attribute. */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

/**
 * Build one injected form group.
 * @param {object} options
 * @returns {HTMLDivElement}
 */
function _buildFormGroup({ label, hint, field }) {
  const group = document.createElement("div");
  group.classList.add("form-group");
  group.innerHTML = `
    <label>${label} <span style="opacity:0.65;">(STA Toolkit)</span></label>
    <div class="form-fields">${field}</div>
    <p class="hint">${hint}</p>`;
  return group;
}

/**
 * @param {ApplicationV2} app
 * @param {HTMLElement|jQuery} html
 */
function _injectPadFields(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  const doc = app.document ?? app.object ?? null;

  // Prefer the identity tab, where the Region's name lives — the pad flag reads
  // as part of what this Region *is*. Fall back the same way the token config
  // injector does, so an unfamiliar sheet layout still gets the fields.
  const target =
    root.querySelector('.tab[data-tab="identity"]')
    ?? root.querySelector(".tab[data-tab]")
    ?? root.querySelector("form")
    ?? root;

  if (!root.querySelector(`input[name="${PAD_FORM_PATH}"]`)) {
    const checked = !!foundry.utils.getProperty(doc ?? {}, PAD_FORM_PATH);
    target.appendChild(_buildFormGroup({
      label: "Transporter Pad / Spawn Marker",
      field: `<input type="checkbox" name="${PAD_FORM_PATH}" ${checked ? "checked" : ""}>`,
      hint: `Mark this Region as one spawn spot. The spawn window (Shift+B) can
        beam or warp one token onto each marked Region instead of picking a point
        on the canvas — draw one per transporter pad. Tokens are placed on the
        marker exactly, without grid snapping.`,
    }));
  }

  if (!root.querySelector(`input[name="${GROUP_FORM_PATH}"]`)) {
    const value = foundry.utils.getProperty(doc ?? {}, GROUP_FORM_PATH) ?? "";
    target.appendChild(_buildFormGroup({
      label: "Pad Group",
      field: `<input type="text" name="${GROUP_FORM_PATH}" value="${esc(value)}" placeholder="Transporter Pads">`,
      hint: `Only read when the box above is ticked. Markers sharing a group name
        form one set, so a scene can hold a main transporter room and a cargo
        transporter at once. Leave blank to join the scene's default set.
        Pads are used in order of the Region's name — name them "Pad 1", "Pad 2", …`,
    }));
  }
}

/**
 * Register the render hook. Call once from main.js init.
 */
export function registerRegionPadConfig() {
  Hooks.on("renderRegionConfig", _injectPadFields);
}
