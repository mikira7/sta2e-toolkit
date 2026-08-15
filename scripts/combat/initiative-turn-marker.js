/**
 * sta2e-toolkit | combat/initiative-turn-marker.js
 * Put Foundry's turn marker on the ship a bridge officer is crewing.
 *
 * In starship combat the module adds one combatant per assigned officer, created
 * tokenless (`tokenId: null`) because the officers have no presence on the map —
 * the ship does. Foundry's turn marker keys off the token id:
 *
 *   Token#_refreshTurnMarker():
 *     const isTurn = game.combat?.combatant?.tokenId === this.id;
 *
 * and Combat#_updateTurnMarkers() only ever flags `this.combatant?.token?._object`.
 * With a tokenless combatant both resolve to nothing, so when it is an officer's
 * turn the canvas shows no marker at all and the table cannot see who is up.
 *
 * This module resolves the acting officer to their ship's token and marks that
 * instead, reusing core's own `TokenTurnMarker` so the marker honours the GM's
 * configured texture, animation and disposition tint rather than inventing a
 * second visual language.
 *
 * Combatants that DO have a token are left entirely to core.
 */

import { getActingCombatant } from "./initiative-order.js";
import { getCrewManifest, STATION_SLOTS } from "../crew-manifest.js";
import { getTokenArtMetrics, onArtBoundsMeasured } from "../art-bounds.js";

const MODULE = "sta2e-toolkit";

function _enabled() {
  try { return game.settings.get(MODULE, "initiativeShipTurnMarker") !== false; }
  catch { return false; }
}

function _setting(key, fallback) {
  try {
    const v = game.settings.get(MODULE, key);
    return v === undefined || v === null ? fallback : v;
  } catch { return fallback; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Marker layout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core lays the marker out across two methods (v14):
 *
 *   _refreshSize():      mesh.width = mesh.height = this.externalRadius * 3;
 *                        // externalRadius === Math.min(gridW, gridH) / 2
 *   _refreshPosition():  turnMarker.position.set(center.x - x, center.y - y);
 *
 * so the ring is 150% of the token's smaller GRID dimension, centred on the
 * token's grid square. Both are wrong for starship art. The footprint is not the
 * artwork: a 4x2 ship is sized off the 2 and sits inside the hull, art with
 * transparent margin (or scaled down in Token Config) gets a ring floating well
 * off the hull, and art drawn off-centre in its frame is ringed off-centre.
 *
 * With `initiativeTurnMarkerFit` on we measure the art instead:
 *
 *   drawn size    the sprite as actually drawn — the texture `fit` mode and the
 *                 token's texture scale, neither of which `getSize()` knows about
 *   × art bounds  the opaque fraction of that sprite (art-bounds.js), so
 *                 transparent margin stops inflating and skewing the marker
 *
 * The longer side wins, as one uniform value, so a round marker texture stays
 * round; `initiativeTurnMarkerScale` is a plain multiplier on top for taste.
 * With the setting off, core's behaviour is reproduced exactly.
 *
 * Note the offset goes on the marker CONTAINER, never on its mesh: `animate()`
 * spins the container about its own origin, so an offset mesh would orbit the
 * token instead of sitting on it.
 */

/**
 * Marker size, and the offset from core's centred position, in token-local px.
 * @returns {{size: number, offsetX: number, offsetY: number}}
 */
function _markerLayout(token) {
  const scale = Number(_setting("initiativeTurnMarkerScale", 1)) || 1;

  if (_setting("initiativeTurnMarkerFit", true) === false) {
    const { width, height } = token.document.getSize();
    return { size: Math.min(width, height) * 1.5 * scale, offsetX: 0, offsetY: 0 };
  }

  const art  = getTokenArtMetrics(token);
  const size = Math.max(art.width, art.height) * 1.5 * scale;

  // The offset is measured on the unrotated artwork, and core turns the sprite
  // with `mesh.angle` (skipped when the token locks rotation), so turn with it.
  const degrees = token.document.lockRotation ? 0 : (Number(token.document.rotation) || 0);
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    size,
    offsetX: art.offsetX * cos - art.offsetY * sin,
    offsetY: art.offsetX * sin + art.offsetY * cos,
  };
}

export function markerSizeFor(token) {
  return _markerLayout(token).size;
}

/**
 * Re-apply our size and centring after core has set its own.
 *
 * Both halves are recomputed from scratch — the container position is rebuilt
 * from core's own `center - position` expression rather than nudged — so this
 * stays correct no matter how many times core refreshes in between.
 */
function _applyMarkerLayout(token) {
  const marker = token?.turnMarker;
  if (!marker?.mesh) return;

  try {
    const { size, offsetX, offsetY } = _markerLayout(token);
    if (!(size > 0)) return;   // nothing measurable — leave core's marker alone
    marker.mesh.width = marker.mesh.height = size;

    const { x, y } = token.document;
    const center = token.center;
    marker.position.set(center.x - x + offsetX, center.y - y + offsetY);
  } catch (err) {
    console.warn("STA2e Toolkit | Could not lay out the turn marker:", err);
  }
}

/** Ask every currently-marked token to re-lay-out. Used when a setting changes. */
export function refreshTurnMarkerSizes() {
  if (!canvas?.ready) return;
  for (const token of canvas.tokens.turnMarkers) {
    token.renderFlags.set({ refreshSize: true, refreshPosition: true });
  }
}

// An art measurement that lands after the marker is already on screen needs the
// marker to resize; measuring is one-shot per texture, so this is not a loop.
onArtBoundsMeasured(() => refreshTurnMarkerSizes());

function _isShipActor(actor) {
  return !!actor && (actor.type === "starship" || actor.type === "spacecraft2e");
}

/**
 * The ship combatant whose crew manifest lists this officer.
 *
 * Prefers a ship whose token is actually on the current canvas — a fleet action
 * can have several ships in the tracker with only some of them on this scene.
 *
 * @returns {Combatant|null}
 */
export function findShipForOfficer(combat, combatant) {
  const actorId = combatant?.actorId;
  if (!actorId || !combat) return null;

  let fallback = null;

  for (const c of combat.combatants) {
    if (c.id === combatant.id) continue;
    if (!c.tokenId) continue;                 // no token means nothing to mark
    if (!_isShipActor(c.actor)) continue;

    let manifest;
    try { manifest = getCrewManifest(c.actor); } catch { continue; }
    if (!manifest) continue;

    const crews = STATION_SLOTS.some(slot => (manifest[slot.id] ?? []).includes(actorId));
    if (!crews) continue;

    if (canvas?.tokens?.get(c.tokenId)) return c;   // on this scene — take it
    fallback ??= c;
  }
  return fallback;
}

/**
 * Id of the token that should carry the marker on this client's behalf, or null
 * when core's own handling is correct.
 */
export function shipMarkerTokenId(combat = game.combat) {
  if (!_enabled() || !combat?.started) return null;

  // `pending` is the combatant selected and mid-turn; fall back to the turn
  // pointer so the marker stays put between committing a turn and picking the next.
  const acting = getActingCombatant(combat) ?? combat.combatant ?? null;
  if (!acting) return null;
  if (acting.tokenId) return null;            // has its own token — core has it covered

  return findShipForOfficer(combat, acting)?.tokenId ?? null;
}

/**
 * Ask the affected tokens to re-evaluate their marker.
 *
 * Core's `_updateTurnMarkers` cannot do this for us: it only flags the token of
 * the current combatant, which for a tokenless officer is nothing at all, so the
 * ship's token would never be told to draw one.
 */
export function refreshShipTurnMarkers() {
  if (!canvas?.ready) return;
  const flags = { refreshTurnMarker: true };
  // Clear whatever is currently marked …
  for (const token of canvas.tokens.turnMarkers) token.renderFlags.set(flags);
  // … and prompt the ship that should be.
  const wanted = shipMarkerTokenId();
  if (wanted) canvas.tokens.get(wanted)?.renderFlags.set(flags);
}

/**
 * Replace `Token#_refreshTurnMarker` with a version that accepts a stand-in token.
 *
 * The body mirrors core's (v14) exactly apart from how `isTurn` is derived; the
 * activate/remove halves are reproduced rather than delegated because the only
 * thing we need to change is that one comparison. When no officer is acting we
 * call straight through to the original, so normal combat is untouched.
 */
function _installMarkerProxyPatch(proto) {
  if (!proto?._refreshTurnMarker) {
    console.warn("STA2e Toolkit | Token#_refreshTurnMarker not found — ship turn markers disabled.");
    return;
  }
  if (proto._sta2eShipMarkerPatched) return;

  const TokenTurnMarker = foundry.canvas?.placeables?.tokens?.TokenTurnMarker;
  if (!TokenTurnMarker) {
    console.warn("STA2e Toolkit | TokenTurnMarker class not found — ship turn markers disabled.");
    return;
  }

  const original = proto._refreshTurnMarker;

  proto._refreshTurnMarker = function () {
    let proxyId = null;
    try { proxyId = shipMarkerTokenId(); }
    catch (err) { console.warn("STA2e Toolkit | ship turn marker lookup failed:", err); }

    if (!proxyId) return original.call(this);

    const { turnMarker } = this.document;
    const markersEnabled = CONFIG.Combat.settings.turnMarker.enabled
      && (turnMarker.mode !== CONST.TOKEN_TURN_MARKER_MODES.DISABLED);
    const markerActive = markersEnabled && (proxyId === this.id);

    if (markerActive) {
      if (!this.turnMarker) this.turnMarker = this.addChildAt(new TokenTurnMarker(this), 0);
      canvas.tokens.turnMarkers.add(this);
      this.turnMarker.draw();
    } else if (this.turnMarker) {
      canvas.tokens.turnMarkers.delete(this);
      this.turnMarker.destroy();
      this.turnMarker = null;
    }
  };

  proto._sta2eShipMarkerPatched = true;
}

/**
 * Re-apply our marker layout after core's.
 *
 * Core writes the marker's size in `_refreshSize` and its position in
 * `_refreshPosition`, and either can fire without the other — a token that only
 * moves never re-runs sizing — so both are chained.
 *
 * Installed independently of the ship-marker proxy above: marker layout is a
 * presentation preference that applies to every token, whether or not the
 * officer→ship redirection is in play or even available on this Foundry version.
 */
function _installMarkerSizePatch(proto) {
  if (!proto?._refreshSize || !proto?._refreshPosition) {
    console.warn("STA2e Toolkit | Token#_refreshSize/_refreshPosition not found — turn marker fitting disabled.");
    return;
  }
  if (proto._sta2eMarkerSizePatched) return;

  const originalRefreshSize = proto._refreshSize;
  proto._refreshSize = function () {
    originalRefreshSize.call(this);
    _applyMarkerLayout(this);
  };

  const originalRefreshPosition = proto._refreshPosition;
  proto._refreshPosition = function () {
    originalRefreshPosition.call(this);
    _applyMarkerLayout(this);
  };

  proto._sta2eMarkerSizePatched = true;
}

export function registerShipTurnMarker() {
  // CONFIG.Token.objectClass is only final once the system and other modules
  // have had their init/setup pass.
  Hooks.once("ready", () => {
    const proto = CONFIG.Token?.objectClass?.prototype;
    _installMarkerProxyPatch(proto);
    _installMarkerSizePatch(proto);
    refreshShipTurnMarkers();
  });

  // The acting combatant lives in a Combat flag, so every client sees the change
  // as an updateCombat and can move its own marker.
  Hooks.on("updateCombat", () => refreshShipTurnMarkers());
  Hooks.on("deleteCombat", () => refreshShipTurnMarkers());
  Hooks.on("canvasReady", () => refreshShipTurnMarkers());
}
