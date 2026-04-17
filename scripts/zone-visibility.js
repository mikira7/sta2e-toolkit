import { getSceneZones, getZoneAtPoint } from "./zone-data.js";

/**
 * Register the libWrapper intercept on CanvasVisibility#testVisibility.
 * Must be called once at setup time (before the canvas is created).
 *
 * Tokens inside an obscured zone are invisible to players whose controlled
 * tokens are in a different zone. GMs and token owners are unaffected.
 */
export function registerZoneVisibilityWrap() {
  if (typeof libWrapper === "undefined") {
    console.warn("STA2e Toolkit | libWrapper not available — obscured zone token hiding disabled");
    return;
  }

  libWrapper.register(
    "sta2e-toolkit",
    "CanvasVisibility.prototype.testVisibility",
    function(wrapped, point, options = {}) {
      const result = wrapped(point, options);
      if (!result || game.user.isGM) return result;

      const scene = canvas?.scene;
      if (scene?.getFlag("sta2e-toolkit", "zonesEnabled") === false) return result;

      const object = options?.object;
      if (!(object instanceof Token)) return result;

      const zones = getSceneZones(scene);
      const c = object.center;
      const tokenZone = getZoneAtPoint(c.x, c.y, zones);
      if (!tokenZone?.tags?.includes("obscured")) return result;

      // Token is in an obscured zone. The owner always sees their own token.
      if (object.isOwner) return result;

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
  }

  destroy() {
    // libWrapper wrap persists for the module lifetime; nothing to clean up.
  }
}
