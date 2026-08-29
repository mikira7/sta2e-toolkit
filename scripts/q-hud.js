/**
 * sta2e-toolkit | q-hud.js
 *
 * GM-only Q controls on the Token HUD (right-click any token).
 *
 * One button opens a flyout with the Q actions that operate on tokens already on
 * the canvas — Flash Move, Flash Kick and Snap Out + Hold. Bringing tokens *in*
 * stays in the spawn window's Q tab, because that needs a queue.
 *
 * Unlike ship-command-hud.js this gates on nothing but GM: Q does not care what
 * kind of token it is, so the control appears on ships, crew, NPCs and scenery
 * alike. It shares the flyout shell and row styling with the ship command
 * palette — see styles/token-hud-flyout.css.
 *
 * Both actions read the *selection* when the HUD's token is part of it, so a GM
 * who has four tokens selected and right-clicks one of them moves all four.
 * See resolveQTargets in q-actions.js.
 */

import {
  buildHudControl,
  buildHudFlyout,
  resolveHudToken,
  toggleHudFlyout,
} from "./token-hud-util.js";
import {
  qFlashKickTokens,
  qFlashMoveTokens,
  qSnapOutTokens,
  resolveQTargets,
} from "./q-actions.js";

const PALETTE_CLASS = "sta2e-q-hud-palette";

function _buildItem({ icon, label, tooltip, danger = false }, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sta2e-hud-item";
  if (danger) btn.classList.add("danger");
  btn.dataset.tooltip = tooltip;
  const i = document.createElement("i");
  i.className = icon;
  const span = document.createElement("span");
  span.textContent = label;
  btn.append(i, span);
  btn.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    onClick(event);
  });
  return btn;
}

/** Dismiss the HUD — both actions need the canvas the HUD is sitting on. */
function _closeHud() {
  try { canvas.hud?.token?.clear(); } catch { /* HUD already gone */ }
}

function _buildPalette(token) {
  const palette = buildHudFlyout(PALETTE_CLASS);
  const targets = resolveQTargets(token);
  const n     = targets.length;
  const suffix = n > 1 ? ` (${n})` : "";
  const plural = n === 1 ? "token" : "tokens";

  palette.appendChild(_buildItem({
    icon:    "fas fa-bolt",
    label:   `Q Flash Move${suffix}`,
    tooltip: `Click a destination — ${n} ${plural} vanish and reappear there, keeping formation`,
  }, () => {
    _closeHud();
    // Re-resolved rather than reusing `targets`: clearing the HUD is the kind
    // of thing that can change what is selected.
    qFlashMoveTokens(resolveQTargets(token));
  }));

  palette.appendChild(_buildItem({
    icon:    "fas fa-meteor",
    label:   `Q Flash Kick${suffix}`,
    tooltip: `Q throws ${n} ${plural} across the scene — aim at a target, or drag to set the heading`,
  }, () => {
    _closeHud();
    qFlashKickTokens(resolveQTargets(token));
  }));

  palette.appendChild(_buildItem({
    icon:    "fas fa-wand-magic",
    label:   `Snap Out + Hold${suffix}`,
    tooltip: `Q removes ${n} ${plural} from the scene — held in the Q tab, restorable`,
    danger:  true,
  }, () => {
    const doomed = resolveQTargets(token);
    _closeHud();
    qSnapOutTokens(doomed);
  }));

  return palette;
}

function _injectQHud(app, html) {
  if (!game.user?.isGM) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  if (root.querySelector(".sta2e-q-hud")) return;

  const token = resolveHudToken(app);
  if (!token) return;

  const column = root.querySelector(".col.right") ?? root.querySelector(".col.left");
  if (!column) return;
  const sibling = column.querySelector(".control-icon");

  const control = buildHudControl(sibling, {
    cssClass: "sta2e-q-hud",
    icon:     "fas fa-hand-sparkles",
    tooltip:  "Q (GM)",
  });
  control.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    toggleHudFlyout(control, PALETTE_CLASS, () => _buildPalette(token));
  });
  column.appendChild(control);
}

/** Register the HUD hook. Call once from main.js init. */
export function registerQHud() {
  Hooks.on("renderTokenHUD", _injectQHud);
}
