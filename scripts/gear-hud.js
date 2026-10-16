/**
 * sta2e-toolkit | gear-hud.js
 *
 * The Gear section of the Token HUD toolkit menu (token-toolkit-hud.js) — the
 * GM's arrowhead. One row per armour / wearable and per character weapon:
 *
 *   - wearables: the row itself toggles Worn (appearance.js `setWorn`, the same
 *     flag the sheet's shirt key writes);
 *   - every row: a key that marks the item damaged / broken / burnt out, or
 *     repairs it (gear-damage-ui.js) — an energy weapon gets two, Broken and
 *     Burnt out, which differ only in wording;
 *   - a damaged row: a + key that raises its broken trait's potency by one —
 *     2 Threat against a player character, free on an NPC.
 *
 * It used to be a view of the Appearance button; it moved here because breaking
 * and repairing gear is a GM call. Players still put their own gear on and take
 * it off from the sheet.
 */

import { buildHudItem } from "./token-hud-util.js";
import { WEARABLE_TYPES } from "./appearance-data.js";
import { isWorn, setWorn } from "./appearance.js";
import { isGearDamaged, gearDamageWords, gearDamageModes } from "./gear-damage.js";
import { buildGearDamageKey, gearDamagePotency, raiseGearDamagePotency, POTENCY_THREAT_COST } from "./gear-damage-ui.js";

function _wearables(token) {
  return (token?.actor?.items?.contents ?? []).filter(i => WEARABLE_TYPES.has(i.type));
}

function _weapons(token) {
  return (token?.actor?.items?.contents ?? []).filter(i => i.type === "characterweapon2e");
}

/** The + key on a damaged row: one more potency on its broken trait. */
function _raiseKey(item, onDone) {
  const pc = !!item.parent?.hasPlayerOwner;
  const key = document.createElement("button");
  key.type = "button";
  key.className = "sta2e-gear-dmg-key";
  key.dataset.tooltip = `Potency ${gearDamagePotency(item)} — raise by 1${pc ? ` (${POTENCY_THREAT_COST} Threat)` : ""}`;
  key.innerHTML = `<i class="fas fa-plus"></i>`;
  key.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await raiseGearDamagePotency(item);
    onDone?.();
  });
  return key;
}

function _buildRows(host) {
  const rebuild = () => host.rebuild(null);
  const row = (main, item) => {
    const wrap = document.createElement("div");
    wrap.className = "sta2e-gear-row";
    if (isGearDamaged(item)) wrap.classList.add("is-damaged");
    if (isGearDamaged(item)) wrap.append(main, _raiseKey(item, rebuild), buildGearDamageKey(item, rebuild));
    // An energy weapon can break or burn out — one key each.
    else wrap.append(main, ...gearDamageModes(item).map(mode => buildGearDamageKey(item, rebuild, { mode })));
    return wrap;
  };
  const stateNote = (item) => isGearDamaged(item)
    ? ` (${gearDamageWords(item).state} ${gearDamagePotency(item)})` : "";

  const rows = [];
  for (const item of _wearables(host.token)) {
    const worn = isWorn(item);
    rows.push(row(buildHudItem({
      icon:       worn ? "fas fa-toggle-on" : "fas fa-toggle-off",
      label:      item.name + stateNote(item),
      tooltip:    worn ? "Worn — click to take off" : "Carried — click to wear",
      extraClass: worn ? "active" : "",
    }, async () => {
      await setWorn(item, !worn);
      rebuild();
    }), item));
  }
  for (const item of _weapons(host.token)) {
    rows.push(row(buildHudItem({
      icon:    "fas fa-gun",
      label:   item.name + stateNote(item),
      tooltip: isGearDamaged(item) ? `${gearDamageWords(item).state} — can't be used in combat` : "Weapon",
    }, () => {}), item));
  }
  return rows;
}

/** @see token-toolkit-hud.js for the section descriptor contract. */
export const GEAR_SECTION = {
  id:        "gear",
  label:     "Gear",
  icon:      "fas fa-shirt",
  tooltip:   "Wear armour and suits; mark gear and weapons damaged, or repair them",
  available: (token) => _wearables(token).length > 0 || _weapons(token).length > 0,
  build:     _buildRows,
};
