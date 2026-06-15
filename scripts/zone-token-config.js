/**
 * sta2e-toolkit | zone-token-config.js
 * Injects STA Toolkit checkboxes into the Token Config sheet.
 *
 * Tokens with this flag set test their displayed image footprint against zone
 * polygons instead of just their center point, so a Borg cube or station that
 * is physically larger than a single zone is detected in every zone its art
 * overlaps. Consumed by getZonesForToken() / getZoneDistanceBetweenTokens()
 * in zone-data.js.
 *
 * The checkbox uses the native form path `flags.sta2e-toolkit.multiZone`, so
 * Foundry persists it on submit with no extra save handler.
 */

const FLAG_SCOPE = "sta2e-toolkit";
const MULTI_ZONE_FLAG = "multiZone";
const DISABLE_WEAPON_AUTO_ROTATE_FLAG = "disableWeaponAutoRotate";
const MULTI_ZONE_FORM_PATH = `flags.${FLAG_SCOPE}.${MULTI_ZONE_FLAG}`;
const DISABLE_WEAPON_AUTO_ROTATE_FORM_PATH = `flags.${FLAG_SCOPE}.${DISABLE_WEAPON_AUTO_ROTATE_FLAG}`;

/**
 * Build the injected form group element.
 * @param {object} options
 * @returns {HTMLDivElement}
 */
function _buildFormGroup({ label, formPath, checked, hint }) {
  const group = document.createElement("div");
  group.classList.add("form-group");
  group.innerHTML = `
    <label>${label} <span style="opacity:0.65;">(STA Toolkit)</span></label>
    <div class="form-fields">
      <input type="checkbox" name="${formPath}" ${checked ? "checked" : ""}>
    </div>
    <p class="hint">${hint}</p>`;
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

  // Resolve the token-ish document (TokenDocument or PrototypeToken)
  const doc = app.token ?? app.document ?? app.object ?? null;

  // Prefer the Appearance tab; fall back to any tab body, then the form itself.
  const target =
    root.querySelector('.tab[data-tab="appearance"]')
    ?? root.querySelector(".tab[data-tab]")
    ?? root.querySelector("form")
    ?? root;

  if (!root.querySelector(`input[name="${MULTI_ZONE_FORM_PATH}"]`)) {
    target.appendChild(_buildFormGroup({
      label: "Occupies Multiple Zones",
      formPath: MULTI_ZONE_FORM_PATH,
      checked: !!foundry.utils.getProperty(doc ?? {}, MULTI_ZONE_FORM_PATH),
      hint: `Detect this token in every zone its displayed image overlaps,
        instead of only the zone under its center. Enable for very large ships
        and stations (Borg cubes, starbases) that span multiple zones.`,
    }));
  }

  if (!root.querySelector(`input[name="${DISABLE_WEAPON_AUTO_ROTATE_FORM_PATH}"]`)) {
    target.appendChild(_buildFormGroup({
      label: "Disable Weapon Auto-Rotate",
      formPath: DISABLE_WEAPON_AUTO_ROTATE_FORM_PATH,
      checked: !!foundry.utils.getProperty(doc ?? {}, DISABLE_WEAPON_AUTO_ROTATE_FORM_PATH),
      hint: `Prevent this token from rotating or gliding to face weapon fire.
        Non-array ship weapons use the nearest matching emitter even when the
        target is outside that emitter's facing arc.`,
    }));
  }
}

/**
 * Register render hooks. Call once from main.js init.
 */
export function registerZoneTokenConfig() {
  Hooks.on("renderTokenConfig", _injectMultiZoneCheckbox);
  Hooks.on("renderPrototypeTokenConfig", _injectMultiZoneCheckbox);
}
