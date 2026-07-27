/**
 * sta2e-toolkit | token-elevation-display.js
 * Hides Foundry's built-in token elevation text badge.
 *
 * Foundry draws a PreciseText child (Token#tooltip) beneath every token whose
 * elevation differs from the scene base. Its content comes from the protected
 * Token#_getTooltipText(), so we patch that to return "" when hiding — rather
 * than touching Token#tooltip.visible, which _refreshState() reassigns on every
 * state refresh and would clobber.
 *
 * Hidden when the world setting `hideTokenElevation` is on OR the scene carries
 * the `flags.sta2e-toolkit.hideTokenElevation` flag.
 */

const FLAG_SCOPE = "sta2e-toolkit";
const HIDE_ELEVATION_FLAG = "hideTokenElevation";

/**
 * Should the elevation badge be hidden for this scene?
 * Global world setting OR per-scene flag. Mirrors isZonesEnabled() in main.js.
 * @param {Scene} [scene]  Defaults to the viewed scene.
 * @returns {boolean}
 */
export function isTokenElevationHidden(scene = canvas?.scene) {
  try {
    if (game.settings.get(FLAG_SCOPE, HIDE_ELEVATION_FLAG)) return true;
    return scene?.getFlag(FLAG_SCOPE, HIDE_ELEVATION_FLAG) === true;
  } catch {
    // Called from a PIXI render path — never throw.
    return false;
  }
}

/**
 * Re-render the elevation badge on every token of the viewed scene.
 * Used as the settings onChange handler and after a scene flag update.
 */
export function refreshAllTokenElevationTooltips() {
  for (const token of canvas?.tokens?.placeables ?? []) {
    try { token.renderFlags?.set({ refreshTooltip: true }); } catch { /* ignore */ }
  }
}

/**
 * Patch Token#_getTooltipText once. Call from main.js "setup".
 */
export function registerTokenElevationDisplay() {
  const TokenClass = foundry.canvas?.placeables?.Token ?? Token;
  if (!TokenClass?.prototype || TokenClass.prototype._sta2eElevTextPatch) return;

  const origGetTooltipText = TokenClass.prototype._getTooltipText;
  TokenClass.prototype._getTooltipText = function () {
    if (isTokenElevationHidden(this.scene ?? canvas?.scene)) return "";
    return origGetTooltipText?.call(this) ?? "";
  };
  TokenClass.prototype._sta2eElevTextPatch = true;

  // Saving the Scene Config checkbox must refresh live tokens.
  Hooks.on("updateScene", (scene, changed) => {
    if (scene?.id !== canvas?.scene?.id) return;
    const flagChanged = foundry.utils.getProperty(changed, `flags.${FLAG_SCOPE}.${HIDE_ELEVATION_FLAG}`) !== undefined
      || foundry.utils.getProperty(changed, `flags.${FLAG_SCOPE}.-=${HIDE_ELEVATION_FLAG}`) !== undefined;
    if (flagChanged) refreshAllTokenElevationTooltips();
  });
}
