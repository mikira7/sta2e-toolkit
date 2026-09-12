/**
 * sta2e-toolkit | q-hud.js
 *
 * The Q section of the Token HUD toolkit menu (token-toolkit-hud.js).
 *
 * Three rows for the Q actions that operate on tokens already on the canvas —
 * Flash Move, Flash Kick and Snap Out + Hold. Bringing tokens *in* stays in the
 * spawn window's Q tab, because that needs a queue.
 *
 * Unlike the ship command section this gates on nothing: Q does not care what
 * kind of token it is, so the section is offered on ships, crew, NPCs and
 * scenery alike — including a token with no actor at all. The GM gate lives on
 * the control itself.
 *
 * All three read the *selection* when the HUD's token is part of it, so a GM who
 * has four tokens selected and right-clicks one of them moves all four. See
 * resolveQTargets in q-actions.js.
 */

import { buildHudItem } from "./token-hud-util.js";
import {
  qFlashKickTokens,
  qFlashMoveTokens,
  qSnapOutTokens,
  resolveQTargets,
} from "./q-actions.js";

/** Dismiss the HUD — all three actions need the canvas the HUD is sitting on. */
function _closeHud() {
  try { canvas.hud?.token?.clear(); } catch { /* HUD already gone */ }
}

function _buildRows(host) {
  const token  = host.token;
  const rows   = [];
  const n      = resolveQTargets(token).length;
  const suffix = n > 1 ? ` (${n})` : "";
  const plural = n === 1 ? "token" : "tokens";

  rows.push(buildHudItem({
    icon:    "fas fa-bolt",
    label:   `Q Flash Move${suffix}`,
    tooltip: `Click a destination — ${n} ${plural} vanish and reappear there, keeping formation`,
  }, () => {
    _closeHud();
    // Re-resolved rather than reusing the count above: clearing the HUD is the
    // kind of thing that can change what is selected.
    qFlashMoveTokens(resolveQTargets(token));
  }));

  rows.push(buildHudItem({
    icon:    "fas fa-meteor",
    label:   `Q Flash Kick${suffix}`,
    tooltip: `Q throws ${n} ${plural} across the scene — aim at a target, or drag to set the heading`,
  }, () => {
    _closeHud();
    qFlashKickTokens(resolveQTargets(token));
  }));

  rows.push(buildHudItem({
    icon:    "fas fa-wand-magic",
    label:   `Snap Out + Hold${suffix}`,
    tooltip: `Q removes ${n} ${plural} from the scene — held in the Q tab, restorable`,
    danger:  true,
  }, () => {
    const doomed = resolveQTargets(token);
    _closeHud();
    qSnapOutTokens(doomed);
  }));

  return rows;
}

/** @see token-toolkit-hud.js for the section descriptor contract. */
export const Q_SECTION = {
  id:        "q",
  label:     "Q",
  icon:      "fas fa-hand-sparkles",
  tooltip:   "Q — move, kick or snap tokens out of the scene",
  available: () => true,
  build:     _buildRows,
};
