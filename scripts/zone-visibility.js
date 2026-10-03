import { getSceneZones, getZoneAtPoint } from "./zone-data.js";
import { isActiveGM } from "./gm-authority.js";
import { isSensorRevealed, rawShroudPotency, sharesShroud, hiddenWithinShroud } from "./region-terrain.js";

/**
 * Register the libWrapper intercepts that hide tokens. Must be called once at
 * setup time (before the canvas is created).
 *
 * Two wraps, for two different gaps:
 *
 *   CanvasVisibility#testVisibility — tokens inside an obscured *zone* are
 *     invisible to players whose controlled tokens are in a different zone.
 *
 *   Token#isVisible — Sensor Shroud Regions, and cloaked ships for assistant
 *     GMs. This has to sit on isVisible rather than testVisibility: core
 *     returns early for GMs and for scenes without token vision and never
 *     reaches testVisibility at all, and an assistant GM is exactly a GM.
 *
 * Only the active GM (gm-authority.js) is exempt. Assistant GMs are treated as
 * players for hidden information — a table-etiquette screen, not security.
 */
export function registerZoneVisibilityWrap() {
  if (typeof libWrapper === "undefined") {
    console.warn("STA2e Toolkit | libWrapper not available — obscured zone and Sensor Shroud token hiding disabled");
    return;
  }

  libWrapper.register(
    "sta2e-toolkit",
    "CanvasVisibility.prototype.testVisibility",
    function(wrapped, point, options = {}) {
      const result = wrapped(point, options);
      if (!result || isActiveGM()) return result;

      const scene = canvas?.scene;
      if (scene?.getFlag("sta2e-toolkit", "zonesEnabled") === false) return result;

      const object = options?.object;
      if (!(object instanceof Token)) return result;

      const zones = getSceneZones(scene);
      const c = object.center;
      const tokenZone = getZoneAtPoint(c.x, c.y, zones);
      if (!tokenZone?.tags?.includes("obscured")) return result;

      // Token is in an obscured zone. The owner always sees their own token.
      if (object.isOwner && !game.user.isGM) return result;

      // Visible only if the local player has a controlled token in the same zone.
      for (const ct of canvas.tokens.controlled) {
        const vc = ct.center;
        const vz = getZoneAtPoint(vc.x, vc.y, zones);
        if (vz?.id === tokenZone.id) return result;
      }

      return false;
    },
    "WRAPPER"
  );

  const tokenTarget = foundry.canvas?.placeables?.Token
    ? "foundry.canvas.placeables.Token.prototype.isVisible"
    : "Token.prototype.isVisible";
  try {
    libWrapper.register("sta2e-toolkit", tokenTarget, function(wrapped, ...args) {
      const visible = wrapped(...args);
      if (!visible || isActiveGM()) return visible;
      return !_screenedFromViewer(this);
    }, "WRAPPER");
  } catch (err) {
    console.warn("STA2e Toolkit | Could not wrap Token#isVisible — Sensor Shroud hiding disabled:", err);
  }
}

/** The tokens this viewer "looks from" — controlled, plus a player's own. */
function _viewerTokens() {
  const set = new Set(canvas.tokens?.controlled ?? []);
  if (!game.user.isGM) {
    for (const t of canvas.tokens?.placeables ?? []) if (t.isOwner) set.add(t);
  }
  return [...set];
}

/**
 * Should `token` be hidden from this (non-active-GM) viewer?
 *   - a cloaked ship, for an assistant GM (players never see hidden tokens anyway)
 *   - anything inside a hiding Sensor Shroud, unless revealed or the viewer
 *     has a token inside the same shroud — and not even then when the shroud
 *     is set to Hide From Tokens Inside
 * A player's own token, and any token the viewer has selected, always shows.
 */
function _screenedFromViewer(token) {
  const doc = token?.document;
  if (!doc) return false;
  if (token.controlled) return false;
  if (!game.user.isGM && token.isOwner) return false;
  if (canvas?.scene?.getFlag("sta2e-toolkit", "zonesEnabled") === false) return false;

  const revealed = isSensorRevealed(doc);
  if (game.user.isGM && doc.hidden && !revealed) return true;

  if (revealed || rawShroudPotency(doc, "hide") <= 0) return false;
  if (hiddenWithinShroud(doc)) return true;
  return !_viewerTokens().some(v => v !== token && sharesShroud(v.document, doc));
}

/**
 * Per-scene lifecycle handle.
 * The libWrapper wrap reads scene state dynamically, so this class only needs
 * to trigger perception refreshes when zone data changes outside of normal
 * token movement (which Foundry already re-evaluates automatically).
 */
export class ZoneVisibility {
  refresh() {
    if (!canvas?.ready) return;
    canvas.perception?.update({ refreshVision: true }, true);
    // isVisible is read on token refresh, not on a vision refresh.
    for (const t of canvas.tokens?.placeables ?? []) t.renderFlags?.set?.({ refreshVisibility: true });
  }

  destroy() {
    // libWrapper wrap persists for the module lifetime; nothing to clean up.
  }
}
