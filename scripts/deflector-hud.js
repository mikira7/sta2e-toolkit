/**
 * sta2e-toolkit | deflector-hud.js
 *
 * The Deflector Dish section of the Token HUD toolkit menu
 * (token-toolkit-hud.js). Four rows, one per effect, plus a Stop row that
 * appears only while one of the two sustained effects is running.
 *
 * Purely cosmetic: no roll, no Power cost, no chat card. The rows deliberately
 * leave the panel open and rebuild() instead, the same argument the shield rows
 * make in ship-command-hud.js — a GM here is usually trying one look, watching
 * it, and trying the next.
 *
 * Available only on a ship that has a dish placed. Without that gate the section
 * would show on every starship and every row would warn.
 *
 * The GM gate lives on the control itself (token-toolkit-hud.js), so like every
 * other section this is GM-only as a consequence rather than by its own test.
 *
 * This is the one file in the feature that may import spawn-picker.js — it
 * drags lcars-theme and the spawn pattern/region modules with it, far too much
 * for the renderer's per-frame graph.
 */

import { buildHudItem } from "./token-hud-util.js";
import { isShipActor } from "./ship-command-hud.js";
import { getShipDeflectorEmitters, shipDeflectorEmitterToCanvasPoint } from "./ship-vfx-anchors.js";
import {
  broadcastDeflectorEffect,
  broadcastStopDeflectorEffect,
  hasLiveDeflectorEffect,
} from "./deflector-vfx.js";
import {
  INDICATOR_COLOR,
  awaitCanvasClick,
  drawHeadingArrow,
  setCrosshairCursor,
  showOverlay,
} from "./spawn-picker.js";

/** Effect rows, in the order they read as a sequence: charge, throw, hold, pour. */
const ROWS = Object.freeze([
  {
    type: "chargeGlow",
    icon: "fas fa-atom",
    label: "Charge Deflector",
    tooltip: "A cone draws energy into the dish and holds it there until stopped",
  },
  {
    type: "pulse",
    icon: "fas fa-circle-notch",
    label: "Deflector Pulse",
    tooltip: "A crescent wave that swells and slows into the target — target with T, or click a point",
  },
  {
    type: "beam",
    icon: "fas fa-bolt",
    label: "Deflector Lance",
    tooltip: "Several beams held across the target area — target with T, or click a point",
  },
  {
    type: "stream",
    icon: "fas fa-wind",
    label: "Deflector Stream",
    tooltip: "A translucent column of streaming energy to the target — target with T, or click a point",
  },
]);

/** Everything except the charge cone aims at something. */
const TARGETED = Object.freeze(["pulse", "beam", "stream"]);

/** The dish's own canvas point, for the picker's aiming line. */
function _dishPoint(token) {
  const anchor = getShipDeflectorEmitters(token.actor)[0];
  const point = anchor ? shipDeflectorEmitterToCanvasPoint(token, anchor) : null;
  return point ?? token.center ?? null;
}

/**
 * Click a point to aim at, with the line from the dish drawn live. Resolves null
 * on right-click or Escape, which awaitCanvasClick already handles.
 */
async function _pickDeflectorPoint(token, label) {
  const from = _dishPoint(token);
  const overlay = showOverlay(`DEFLECTOR - ${label}`, "Click a point to aim at - [RMB/Esc] abort");
  setCrosshairCursor(true);
  try {
    return await awaitCanvasClick({
      onMove: (g) => {
        const p = canvas?.mousePosition;
        if (!from || !p) return;
        drawHeadingArrow(g, from.x, from.y, p.x, p.y, INDICATOR_COLOR);
      },
    });
  } finally {
    setCrosshairCursor(false);
    overlay.remove();
  }
}

/**
 * Targets first, a canvas click second. The self-target guard is the one from
 * _onTractorLock — a ship cannot aim its own dish at itself.
 */
async function _resolveTarget(host, token, row) {
  const targeted = Array.from(game.user.targets ?? [])[0] ?? null;
  if (targeted?.center) {
    if (targeted.id === token.id) {
      ui.notifications.warn("STA2e Toolkit: A ship cannot aim its deflector at itself.");
      return null;
    }
    return { x: targeted.center.x, y: targeted.center.y };
  }
  // Nothing targeted, so fall back to a click — which needs the canvas the HUD
  // is currently sitting on.
  try { await host.app.clear?.(); } catch { /* HUD already gone */ }
  return await _pickDeflectorPoint(token, row.label);
}

async function _fire(host, token, row) {
  let target = null;
  if (TARGETED.includes(row.type)) {
    target = await _resolveTarget(host, token, row);
    if (!target) return;   // aborted, or self-targeted
  }
  try {
    broadcastDeflectorEffect(token, row.type, { target });
  } catch (err) {
    console.error("STA2e Toolkit | Deflector fire failed:", err);
    ui.notifications.error("Deflector effect failed — see console.");
  }
}

function _buildRows(host) {
  const { token } = host;
  const rows = [];

  for (const row of ROWS) {
    rows.push(buildHudItem({
      icon: row.icon,
      label: row.label,
      tooltip: row.tooltip,
    }, async () => {
      await _fire(host, token, row);
      // The Stop row appears and disappears with the sustained effects, so the
      // panel is rebuilt rather than closed. A targeted row has already
      // dismissed the HUD if it went to the picker; rebuild() is a no-op then,
      // since the host guards on the palette still being connected.
      host.rebuild();
    }));
  }

  if (hasLiveDeflectorEffect(token.document?.id ?? token.id)) {
    rows.push(buildHudItem({
      icon: "fas fa-ban",
      label: "Stop Deflector",
      tooltip: "Release the charge or the lance on this ship",
      danger: true,
    }, () => {
      // Stopping only here would leave every other client still lit, so the
      // stop goes out the same way the start did.
      broadcastStopDeflectorEffect(token.document?.id ?? token.id);
      host.rebuild();
    }));
  }

  return rows;
}

/** @see token-toolkit-hud.js for the section descriptor contract. */
export const DEFLECTOR_SECTION = {
  id: "deflector",
  label: "Deflector Dish",
  icon: "fas fa-satellite-dish",
  tooltip: "Deflector dish effects — cosmetic only, no roll and no Power cost",
  available: (token) => isShipActor(token.actor)
    && getShipDeflectorEmitters(token.actor).length > 0,
  build: _buildRows,
};
