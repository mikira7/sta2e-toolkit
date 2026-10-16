/**
 * sta2e-toolkit | appearance-sheet.js
 *
 * Appearances on the STA actor sheets: a header control that opens the
 * Appearance Manager (GM), and a Wear toggle on every armour and gear row.
 *
 * - The header control goes through core's `getHeaderControlsActorSheetV2`
 *   hook. Every STA sheet extends `ActorSheetV2` (sta-actors.mjs), so this one
 *   hook covers characters, NPCs, supporting characters, ships and small craft.
 * - The Wear toggle is injected into the system's own rows
 *   (`li.row.entry[data-item-type]`, the `.control` cell beside edit/delete).
 *   It deliberately carries no `data-action`: the sheet's ApplicationV2 click
 *   dispatcher would claim it and warn about an unknown action. The sheet
 *   re-renders on every change, so injection is idempotent per row.
 *
 * Shape lives in styles/appearance.css (`.sta2e-wear`).
 */

import { WEARABLE_TYPES } from "./appearance-data.js";
import { isWorn, setWorn } from "./appearance.js";
import { openAppearanceManager } from "./appearance-manager.js";
import { isDamageable, isGearDamaged, gearDamageWords } from "./gear-damage.js";
import { requestGearRepair } from "./gear-damage-ui.js";

const SHEET_HOOKS = [
  "renderSTACharacterSheet2e",
  "renderSTANPCSheet2e",
  "renderSTASupportingSheet2e",
  "renderSTACharacterSheet",
];

function _injectWear(app, html) {
  const actor = app.document ?? app.actor;
  const root = html instanceof HTMLElement ? html : (html?.[0] ?? app.element);
  if (!actor || !root) return;
  const editable = actor.isOwner;

  for (const row of root.querySelectorAll("li.row.entry[data-item-id]")) {
    if (!WEARABLE_TYPES.has(row.dataset.itemType)) continue;
    if (row.querySelector(".sta2e-wear")) continue;
    const item = actor.items.get(row.dataset.itemId);
    if (!item) continue;
    const worn = isWorn(item);

    const btn = document.createElement("a");
    btn.className = `sta2e-wear${worn ? " is-worn" : ""}`;
    btn.dataset.tooltip = worn ? "Worn — click to take off" : "Carried — click to wear";
    btn.setAttribute("aria-pressed", String(worn));
    btn.innerHTML = `<i class="fas fa-shirt"></i>`;
    if (!editable) btn.classList.add("is-locked");
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!editable) return;
      await setWorn(item, !isWorn(item));
    });

    const control = row.querySelector(".control");
    if (control) control.prepend(btn);
    else row.appendChild(btn);

  }
  _injectDamaged(actor, root);
}

/**
 * A red key on every damaged / broken / burnt-out row — armour, gear and
 * character weapons. Clicking it does not repair outright: it sends the GM a
 * repair request card (repair free, require a roll, or charge Momentum /
 * Threat — gear-damage-ui.js). Undamaged rows get nothing; breaking
 * something is done from the GM toolkit menu's Gear section or a complication.
 */
function _injectDamaged(actor, root) {
  const editable = actor.isOwner;
  for (const row of root.querySelectorAll("li.row.entry[data-item-id]")) {
    if (row.querySelector(".sta2e-gear-dmg")) continue;
    const item = actor.items.get(row.dataset.itemId);
    if (!isDamageable(item) || !isGearDamaged(item)) continue;
    const words = gearDamageWords(item);
    const key = document.createElement("a");
    key.className = `sta2e-gear-dmg${editable ? "" : " is-locked"}`;
    key.dataset.tooltip = editable
      ? `${words.state} — click to ask the GM to ${words.fix.toLowerCase()} it`
      : words.state;
    key.innerHTML = `<i class="${words.icon}"></i>`;
    key.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (editable) await requestGearRepair(item);
    });
    row.classList.add("sta2e-gear-row-damaged");
    const control = row.querySelector(".control");
    if (control) control.prepend(key);
    else row.appendChild(key);
  }
}

function _headerControl(app, controls) {
  if (!game.user.isGM) return;
  const actor = app.document;
  if (!actor || actor.documentName !== "Actor") return;
  if (controls.some(c => c.action === "sta2eAppearances")) return;
  controls.push({
    action:  "sta2eAppearances",
    icon:    "fas fa-masks-theater",
    label:   "Appearances",
    onClick: () => openAppearanceManager(actor),
  });
}

export function registerAppearanceSheet() {
  for (const hook of SHEET_HOOKS) Hooks.on(hook, _injectWear);
  Hooks.on("getHeaderControlsActorSheetV2", _headerControl);
}
