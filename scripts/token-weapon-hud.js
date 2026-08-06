/**
 * sta2e-toolkit | token-weapon-hud.js
 *
 * GM-only weapon attacks on the Token HUD, for starship and ground tokens alike.
 *
 * A crosshair control opens a flyout of weapon icons. Clicking one expands a
 * strip beneath the grid: ✓ HIT and ✗ MISS resolve the attack outright, 🎲 opens
 * the normal dice roller. This is where Hit / Miss lives now — weapon clicks in
 * the Combat HUD and the LCARS action ring used to open an "Attack Method"
 * prompt first, and they no longer do: they go straight to the roller.
 *
 * Nothing is reimplemented here. HIT/MISS routes through
 * `CombatHUD#triggerHudHitMiss` and 🎲 through `CombatHUD#triggerRingWeapon`, so
 * damage cards, opposed-task intercepts, and animations stay identical to the
 * Combat HUD's own. The two mode toggles mirror the Combat HUD's inline strip —
 * Area/Spread for beam arrays and torpedo salvos, Stun/Deadly for ground weapons
 * that can inflict either.
 */

import { CombatHUD } from "./combat/combat-hud-core.js";
import { buildWeaponContext, getGroundWeaponSeverity } from "./weapon-configs.js";
import {
  buildHudControl,
  buildHudFlyout,
  resolveHudToken,
  toggleHudFlyout,
} from "./token-hud-util.js";

const FLYOUT_CLASS = "sta2e-token-weapon-palette";
const WEAPON_TYPES = ["characterweapon2e", "starshipweapon2e"];

/** Nothing picked yet — the flyout opens here and returns here on deselect. */
const NO_SELECTION = Object.freeze({ weaponId: null, salvoMode: null, useStun: true });

/** Both weapon kinds in one list, the same filter the Combat HUD's weapon row uses. */
function _weapons(actor) {
  return actor?.items?.filter(item => WEAPON_TYPES.includes(item.type)) ?? [];
}

/** A ground weapon offers a choice of injury only when it has both qualities. */
function _isDualInjury(weapon) {
  return weapon.type === "characterweapon2e"
    && !!(weapon.system?.qualities?.stun && weapon.system?.qualities?.deadly);
}

/** Fresh selection state for a weapon, matching the Combat HUD's defaults. */
function _selectionFor(weapon) {
  const modeInfo = CombatHUD._shipAreaSpreadModeInfo(weapon);
  return {
    weaponId:  weapon.id,
    salvoMode: modeInfo.needsMode ? "area" : null,
    useStun:   true,
  };
}

function _tooltip(weapon, actor) {
  const isGround = weapon.type === "characterweapon2e";
  const range    = weapon.system?.range ?? "?";
  const qualities = buildWeaponContext(weapon).qualities;

  let stat;
  if (isGround) {
    stat = `Severity: ${getGroundWeaponSeverity(weapon)}`;
  } else {
    // Ship damage is scale + type + weapons-rating, not the raw item value; the
    // Combat HUD already knows how to compute it.
    const hud = game.sta2eToolkit?.combatHud ?? null;
    const dmg = hud?._weaponDamageBreakdown(weapon, actor);
    stat = dmg
      ? `Damage: ${dmg.breakdown ? `${dmg.total} (${dmg.breakdown})` : dmg.total}`
      : `Damage: ${weapon.system?.damage ?? 0}`;
  }

  // Token HUD tooltips are rendered as HTML, so the Combat HUD's `\n` separators
  // would collapse into spaces here.
  return `<strong>${weapon.name}</strong><br>${stat}<br>Range: ${range}<br>Qualities: ${qualities}`;
}

/** One toggle chip in a mode pair. */
function _buildChip(label, active, { danger = false, tooltip = "" }, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sta2e-token-weapon-chip";
  if (active) btn.classList.add("active");
  if (danger) btn.classList.add("danger");
  btn.dataset.tooltip = tooltip;
  btn.textContent = label;
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return btn;
}

function _buildAction({ label, cssClass, tooltip, dim }, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `sta2e-token-weapon-action ${cssClass}`;
  if (dim) btn.classList.add("dim");
  btn.dataset.tooltip = tooltip;
  btn.textContent = label;
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return btn;
}

async function _resolveHitMiss(app, token, weapon, isHit, selection) {
  const hud = game.sta2eToolkit?.combatHud ?? null;
  if (!hud) {
    ui.notifications.error("STA2e Toolkit: Combat HUD is not ready.");
    return;
  }
  // The damage card is the feedback — close the HUD out of the way first.
  try { await app.clear?.(); } catch { /* HUD may already be gone */ }
  try {
    await hud.triggerHudHitMiss(token, weapon.id, isHit, {
      salvoMode: selection.salvoMode,
      useStun:   selection.useStun,
    });
  } catch (err) {
    console.error("STA2e Toolkit | Token HUD weapon resolution failed:", err);
    ui.notifications.error("Resolving the attack failed — see console.");
  }
}

async function _openRoller(app, token, weapon) {
  const hud = game.sta2eToolkit?.combatHud ?? null;
  if (!hud) {
    ui.notifications.error("STA2e Toolkit: Combat HUD is not ready.");
    return;
  }
  try { await app.clear?.(); } catch { /* HUD may already be gone */ }
  hud.triggerRingWeapon(token, weapon.id);
}

/**
 * The strip that appears once a weapon is picked: mode toggles, then the three
 * resolutions. Sits below the icon grid rather than inline with it, so the grid
 * can wrap freely.
 */
function _buildStrip(app, token, weapon, selection, rebuild) {
  const strip = document.createElement("div");
  strip.className = "sta2e-token-weapon-strip";

  const label = document.createElement("div");
  label.className = "sta2e-token-weapon-name";
  label.textContent = weapon.name;
  strip.appendChild(label);

  // Range is shown, not enforced — same stance as the ship command palette.
  if (weapon.type === "starshipweapon2e") {
    const warning = CombatHUD.rangeWarningForToken(token, weapon);
    if (warning) {
      const wrap = document.createElement("div");
      wrap.innerHTML = warning;
      if (wrap.firstElementChild) strip.appendChild(wrap.firstElementChild);
    }
  }

  const modeInfo = CombatHUD._shipAreaSpreadModeInfo(weapon);
  if (modeInfo.needsMode) {
    const isNpc = CombatHUD.isNpcShip(token.actor);
    const pool  = isNpc ? "threat" : "momentum";
    const modes = document.createElement("div");
    modes.className = "sta2e-token-weapon-modes";
    modes.appendChild(_buildChip("⚡ Area", selection.salvoMode === "area", {
      tooltip: `${modeInfo.label} — Area: attack one primary target; the same damage can be applied to additional nearby ships after the roll (1 ${pool} each)`,
    }, () => rebuild({ ...selection, salvoMode: "area" })));
    modes.appendChild(_buildChip("↔ Spread", selection.salvoMode === "spread", {
      tooltip: `${modeInfo.label} — Spread: reduces Devastating Attack cost from 2 → 1 ${pool}`,
    }, () => rebuild({ ...selection, salvoMode: "spread" })));
    strip.appendChild(modes);
  }

  if (_isDualInjury(weapon)) {
    const isPlayerOwned = CombatHUD
      .getGroundCombatProfile(token.actor, token.document ?? null).isPlayerOwned;
    const threatNote = isPlayerOwned ? " Grants the GM +1 Threat on intent." : "";
    const modes = document.createElement("div");
    modes.className = "sta2e-token-weapon-modes";
    modes.appendChild(_buildChip("⚡ Stun", selection.useStun, {
      tooltip: "Inflict a Stun injury — the target is Incapacitated if it is not avoided",
    }, () => rebuild({ ...selection, useStun: true })));
    modes.appendChild(_buildChip("☠ Deadly", !selection.useStun, { danger: true,
      tooltip: `Inflict a Deadly injury — the target is Dying or Dead if it is not avoided.${threatNote}`,
    }, () => rebuild({ ...selection, useStun: false })));
    strip.appendChild(modes);
  }

  // _resolveWeapon warns and bails without a target. Dim the buttons so that is
  // visible before the click — but leave them live, because the GM can target
  // with T while this flyout is open and the strip would not know about it.
  const hasTarget = (game.user.targets?.size ?? 0) > 0;
  const noTarget  = "Target a token first (T)";

  const actions = document.createElement("div");
  actions.className = "sta2e-token-weapon-actions";
  actions.appendChild(_buildAction({
    label: "✓ Hit", cssClass: "hit", dim: !hasTarget,
    tooltip: hasTarget ? "Resolve as a hit — no roll" : noTarget,
  }, () => _resolveHitMiss(app, token, weapon, true, selection)));
  actions.appendChild(_buildAction({
    label: "✗ Miss", cssClass: "miss", dim: !hasTarget,
    tooltip: hasTarget ? "Resolve as a miss — no roll" : noTarget,
  }, () => _resolveHitMiss(app, token, weapon, false, selection)));
  actions.appendChild(_buildAction({
    label: "🎲", cssClass: "roller",
    tooltip: "Open the dice roller for this attack",
  }, () => _openRoller(app, token, weapon)));
  strip.appendChild(actions);

  return strip;
}

/**
 * Build the flyout for the current selection. Rebuilt whenever a weapon or a
 * mode toggle changes, the same way the ship command palette rebuilds itself.
 *
 * @param {object} selection {weaponId, salvoMode, useStun}
 */
function _buildPalette(app, token, control, selection) {
  const palette = buildHudFlyout(FLYOUT_CLASS);

  const rebuild = (next) => {
    // The HUD may have closed while an action was running.
    if (!control.isConnected || !palette.isConnected) return;
    const fresh = _buildPalette(app, token, control, next);
    fresh.style.top = palette.style.top;
    palette.replaceWith(fresh);
  };

  const grid = document.createElement("div");
  grid.className = "sta2e-token-weapon-grid";

  const weapons = _weapons(token.actor);
  for (const weapon of weapons) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sta2e-token-weapon";
    if (weapon.id === selection.weaponId) btn.classList.add("active");
    btn.style.backgroundImage = `url("${weapon.img}")`;
    btn.dataset.tooltip = _tooltip(weapon, token.actor);
    btn.setAttribute("aria-label", weapon.name);
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      rebuild(weapon.id === selection.weaponId ? NO_SELECTION : _selectionFor(weapon));
    });
    grid.appendChild(btn);
  }
  palette.appendChild(grid);

  const selected = weapons.find(weapon => weapon.id === selection.weaponId);
  if (selected) palette.appendChild(_buildStrip(app, token, selected, selection, rebuild));

  return palette;
}

function _injectTokenWeapons(app, html) {
  if (!game.user?.isGM) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  if (root.querySelector(".sta2e-token-weapons")) return;

  const token = resolveHudToken(app);
  if (!token?.actor || _weapons(token.actor).length === 0) return;

  const column = root.querySelector(".col.right") ?? root.querySelector(".col.left");
  if (!column) return;
  const sibling = column.querySelector(".control-icon");

  const control = buildHudControl(sibling, {
    cssClass: "sta2e-token-weapons",
    icon:     "fas fa-crosshairs",
    tooltip:  "Weapon Attack (GM)",
  });
  control.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleHudFlyout(control, FLYOUT_CLASS, () =>
      _buildPalette(app, token, control, NO_SELECTION)
    );
  });
  column.appendChild(control);
}

/** Register the HUD hook. Call once from main.js init. */
export function registerTokenWeaponHud() {
  Hooks.on("renderTokenHUD", _injectTokenWeapons);
}
