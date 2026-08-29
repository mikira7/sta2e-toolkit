/**
 * sta2e-toolkit | combat/acting-officer.js
 * Which assigned officer is actually taking a station's action.
 *
 * Command is the only two-seat station (Captain + First Officer), and its
 * manifest array keeps those seats at fixed indexes — so `getStationOfficers()[0]`
 * is unconditionally the Captain. Every handler used to pick slot 0, which meant
 * a First Officer's Direct, Rally or Command Assist was rolled and credited to
 * the Captain.
 *
 * This resolves the acting officer from whoever is actually driving: the LCARS
 * action ring's active character, or the character selected on the initiative
 * tracker. A hint only wins if that character genuinely mans the station, so the
 * fallback is always the old slot-0 behaviour.
 *
 * Leaf module by necessity — `initiative-order.js` already imports
 * `crew-manifest.js`, so this cannot live in either of them.
 */

import { getStationOfficers } from "../crew-manifest.js";
import { getActingCombatant } from "./initiative-order.js";

const MODULE = "sta2e-toolkit";

function _actorId(actor) {
  if (!actor) return null;
  return actor.isToken ? (actor.id ?? actor._id ?? null) : (actor.id ?? null);
}

/** Actor ids that might identify who is really acting, best first. */
function* _actingHints(actingActorId) {
  // Explicit — the action ring knows exactly which character was clicked.
  if (actingActorId) yield actingActorId;

  // The module's own initiative selection (state.pending), which is the
  // reliable "acting now" pointer — see initiative-tracker-ui.js.
  const pending = _actorId(getActingCombatant(game.combat)?.actor);
  if (pending) yield pending;

  // Core's turn pointer, for worlds not using the module's initiative order.
  const core = _actorId(game.combat?.combatant?.actor);
  if (core) yield core;

  // The clicking player's own character.
  const own = _actorId(game.user?.character);
  if (own) yield own;

  // The ring's last active character, even when the click came from the HUD.
  try {
    const ringId = game.settings.get(MODULE, "lcarsRingActiveActorId");
    if (ringId) yield ringId;
  } catch { /* setting not registered yet */ }
}

/**
 * The officer taking this station's action.
 * Falls back to slot 0 — identical to the previous behaviour — when nothing matches.
 */
export function resolveActingOfficer(shipActor, stationId, { actingActorId = null } = {}) {
  if (!shipActor || !stationId) return null;
  const officers = getStationOfficers(shipActor, stationId);
  // Single-seat stations: no ambiguity, and no hint lookup worth doing.
  if (officers.length <= 1) return officers[0] ?? null;
  for (const id of _actingHints(actingActorId)) {
    const match = officers.find(o => o.id === id);
    if (match) return match;
  }
  return officers[0] ?? null;
}

/**
 * Index of the resolved officer within `getStationOfficers(shipActor, stationId)`,
 * for pre-checking the radio in an Acting Officer picker. Always a usable index.
 */
export function resolveActingOfficerIndex(shipActor, stationId, options = {}) {
  const officers = getStationOfficers(shipActor, stationId);
  const chosen   = resolveActingOfficer(shipActor, stationId, options);
  const idx      = chosen ? officers.indexOf(chosen) : -1;
  return idx < 0 ? 0 : idx;
}
