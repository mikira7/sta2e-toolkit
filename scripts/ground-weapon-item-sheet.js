/**
 * sta2e-toolkit | ground-weapon-item-sheet.js
 * Injects the Force Era selector into the sta system's Character Weapon sheet.
 *
 * Era normally follows the campaign (see resolveGroundPhaserEra in
 * weapon-configs.js). This is the override for the case the campaign era cannot
 * express: an away team in the TNG era carrying a salvaged TOS Type-2, which
 * should still fire blue and sound like a TOS phaser.
 *
 * The select uses the native form path `flags.sta2e-toolkit.phaserEra`, and the
 * system's item sheet submits on change, so Foundry persists it with no save
 * handler of our own — the same trick zone-token-config.js uses for its
 * TokenConfig checkboxes.
 *
 * Only phasers get the field. Every other ground weapon has no era treatment,
 * so a selector there would promise something that does nothing.
 */

import { autoGroundPhaserEra, groundPhaserType } from "./weapon-configs.js";
import { GROUND_PHASER_ERA_ROWS, GROUND_PHASER_TYPE_ROWS } from "./native-weapon-vfx.js";

const FLAG_SCOPE = "sta2e-toolkit";
const PHASER_ERA_FLAG = "phaserEra";
const PHASER_ERA_FORM_PATH = `flags.${FLAG_SCOPE}.${PHASER_ERA_FLAG}`;
const GROUND_FIRE_MODE_FORM_PATH = `flags.${FLAG_SCOPE}.groundFireMode`;
// Superseded by groundFireMode, still read so already-ticked weapons carry over.
const BOLT_FIRE_FORM_PATH = `flags.${FLAG_SCOPE}.boltFire`;
const PANEL_CLASS = "sta2e-ground-phaser-era";

const ERA_LABELS = Object.freeze(Object.fromEntries(
  GROUND_PHASER_ERA_ROWS.map(row => [row.era, row.label]),
));

const TYPE_LABELS = Object.freeze(Object.fromEntries(
  GROUND_PHASER_TYPE_ROWS.map(row => [row.type, row.label]),
));

function _rootElement(html) {
  return html instanceof HTMLElement ? html : (html?.[0] ?? null);
}

/**
 * Ground phasers only — the same test resolveGroundWeaponConfig applies before
 * it hands a weapon its era-aware config.
 */
function _isGroundPhaser(item) {
  if (item?.type !== "characterweapon2e") return false;
  if (item?.system?.range !== "ranged") return false;
  const name = String(item?.name ?? "").toLowerCase();
  return name.includes("phaser") || name.includes("phase");
}

function _panelHtml(item) {
  const current = String(foundry.utils.getProperty(item, PHASER_ERA_FORM_PATH) ?? "");
  const autoEra = autoGroundPhaserEra();
  const autoLabel = ERA_LABELS[autoEra] ?? autoEra.toUpperCase();
  const detectedType = groundPhaserType(item);
  const typeLabel = TYPE_LABELS[detectedType] ?? "Phaser";

  const options = [
    `<option value="" ${current === "" ? "selected" : ""}>Auto (${autoLabel})</option>`,
    ...GROUND_PHASER_ERA_ROWS.map(row =>
      `<option value="${row.era}" ${current === row.era ? "selected" : ""}>${row.label}</option>`),
  ].join("");

  return `
    <div class="form-group ${PANEL_CLASS}">
      <label>Force Era <span style="opacity:0.65;">(STA Toolkit)</span></label>
      <div class="form-fields">
        <select name="${PHASER_ERA_FORM_PATH}">${options}</select>
      </div>
      <p class="hint">
        Which era's beam colour and sound this phaser uses. <strong>Auto</strong> follows the
        active campaign and the world's Ground Phaser Era setting; anything else forces that
        era for this weapon alone &mdash; a salvaged TOS phaser in a TNG game, say.
        Detected as <strong>${typeLabel}</strong> from the item name.
      </p>
    </div>
    ${_fireModeHtml(item, detectedType)}`;
}

const FIRE_MODE_OPTIONS = Object.freeze([
  { value: "beam", label: "Beam" },
  { value: "bolt", label: "Bolt — toolkit sprite" },
  { value: "jb2a", label: "Bolt — JB2A" },
]);

/**
 * Fire Mode — the Type-3 alternative fire modes. Offered only on a Type-3 or
 * rifle: the smaller hand phasers have no bolt setting, so a selector there
 * would promise something that does nothing.
 *
 * Rendered inside the same insertAdjacentHTML as the era select, which keeps
 * the injector's single idempotence guard covering both fields. Split them into
 * two injections and that guard stops covering this one.
 */
function _fireModeHtml(item, detectedType) {
  if (detectedType !== "type3") return "";

  // The boolean boltFire flag predates the third mode; honouring it here means
  // a weapon already ticked shows as a bolt rather than silently reading Beam.
  const stored = String(foundry.utils.getProperty(item, GROUND_FIRE_MODE_FORM_PATH) ?? "");
  const legacyBolt = foundry.utils.getProperty(item, BOLT_FIRE_FORM_PATH) === true;
  const current = FIRE_MODE_OPTIONS.some(o => o.value === stored)
    ? stored
    : (legacyBolt ? "bolt" : "beam");

  const options = FIRE_MODE_OPTIONS.map(o =>
    `<option value="${o.value}" ${current === o.value ? "selected" : ""}>${o.label}</option>`).join("");

  return `
    <div class="form-group ${PANEL_CLASS}">
      <label>Fire Mode <span style="opacity:0.65;">(STA Toolkit)</span></label>
      <div class="form-fields">
        <select name="${GROUND_FIRE_MODE_FORM_PATH}">${options}</select>
      </div>
      <p class="hint">
        <strong>Beam</strong> is the normal stretched phaser beam.
        <strong>Bolt — toolkit sprite</strong> flies this module's own bolt art;
        <strong>Bolt — JB2A</strong> fires the same animation a starship's energy cannon
        does, coloured to match the era. Either bolt mode makes an Area attack fire a bolt
        at each target rather than opening the cone. All three need Sequencer.
      </p>
    </div>`;
}

function _injectPhaserEraField(app, html) {
  const item = app?.item ?? app?.document;
  if (!item || item.documentName !== "Item" || !_isGroundPhaser(item)) return;

  const root = _rootElement(html);
  if (!root) return;
  // The wrapper the sta system emits at the top of every item template; the
  // description editor is the last thing inside it, so appending lands below.
  const sheet = root.querySelector(".item-sheet") ?? root.querySelector("form") ?? root;
  if (!sheet) return;
  if (root.querySelector(`select[name="${PHASER_ERA_FORM_PATH}"]`)) return;

  sheet.insertAdjacentHTML("beforeend", _panelHtml(item));
}

/**
 * Register render hooks. Call once from main.js init.
 *
 * ApplicationV2 fires `render<ClassName>` for the whole class chain rather than
 * a single generic hook, so the specific sheet class is listed alongside the
 * generic names — whichever fires first wins and the rest no-op on the
 * idempotence guard.
 */
export function registerGroundWeaponItemSheetFields() {
  for (const hook of [
    "renderSTACharacterWeaponSheet2e",
    "renderSTAItems",
    "renderItemSheetV2",
    "renderItemSheet",
  ]) {
    Hooks.on(hook, _injectPhaserEraField);
  }
}
