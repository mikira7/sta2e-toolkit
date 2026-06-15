/**
 * sta2e-toolkit | zone-token-config.js
 * Injects an "Occupies Multiple Zones" checkbox into the Token Config sheet.
 *
 * Tokens with this flag set test their full footprint rectangle against zone
 * polygons instead of just their center point, so a Borg cube or station that
 * is physically larger than a single zone is detected in every zone it
 * overlaps. Consumed by getZonesForToken() / getZoneDistanceBetweenTokens()
 * in zone-data.js.
 *
 * The checkbox uses the native form path `flags.sta2e-toolkit.multiZone`, so
 * Foundry persists it on submit with no extra save handler.
 */

const FLAG_SCOPE = "sta2e-toolkit";
const FLAG_NAME  = "multiZone";
const FORM_PATH  = `flags.${FLAG_SCOPE}.${FLAG_NAME}`;

/**
 * Build the injected form group element.
 * @param {boolean} checked
 * @returns {HTMLDivElement}
 */
function _buildFormGroup(checked) {
  const group = document.createElement("div");
  group.classList.add("form-group");
  group.innerHTML = `
    <label>Occupies Multiple Zones <span style="opacity:0.65;">(STA Toolkit)</span></label>
    <div class="form-fields">
      <input type="checkbox" name="${FORM_PATH}" ${checked ? "checked" : ""}>
    </div>
    <p class="hint">Detect this token in every zone its full footprint overlaps,
      instead of only the zone under its center. Enable for very large ships
      and stations (Borg cubes, starbases) that span multiple zones.</p>`;
  return group;
}

/**
 * Shared injector for TokenConfig and PrototypeTokenConfig renders.
 * @param {Application|ApplicationV2} app
 * @param {HTMLElement|jQuery} html
 */
function _injectMultiZoneCheckbox(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  // Already injected (re-renders)
  if (root.querySelector(`input[name="${FORM_PATH}"]`)) return;

  // Resolve the token-ish document (TokenDocument or PrototypeToken)
  const doc = app.token ?? app.document ?? app.object ?? null;
  const checked = !!foundry.utils.getProperty(doc ?? {}, FORM_PATH);

  const group = _buildFormGroup(checked);

  // Prefer the Appearance tab; fall back to any tab body, then the form itself.
  const target =
    root.querySelector('.tab[data-tab="appearance"]')
    ?? root.querySelector(".tab[data-tab]")
    ?? root.querySelector("form")
    ?? root;
  target.appendChild(group);
}

/**
 * Register render hooks. Call once from main.js init.
 */
export function registerZoneTokenConfig() {
  Hooks.on("renderTokenConfig", _injectMultiZoneCheckbox);
  Hooks.on("renderPrototypeTokenConfig", _injectMultiZoneCheckbox);
}
