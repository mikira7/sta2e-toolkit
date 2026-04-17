/**
 * sta2e-toolkit | scene-flags.js
 * Helpers for reading and writing scene-level campaign overrides.
 */

const FLAG_SCOPE = "sta2e-toolkit";
const FLAG_KEY = "campaignOverride";

/**
 * Get the campaign override id for a scene.
 * @param {Scene} scene  defaults to canvas.scene
 * @returns {string|null}  campaign id or null if no override
 */
export function getSceneOverride(scene = canvas?.scene) {
  if (!scene) return null;
  return scene.getFlag(FLAG_SCOPE, FLAG_KEY) ?? null;
}

/**
 * Set a campaign override on a scene.
 * @param {string} campaignId
 * @param {Scene} scene  defaults to canvas.scene
 */
export async function setSceneOverride(campaignId, scene = canvas?.scene) {
  if (!scene) return;
  await scene.setFlag(FLAG_SCOPE, FLAG_KEY, campaignId);
  game.sta2eToolkit?.broadcastHUDRender();
}

/**
 * Clear the campaign override on a scene (reverts to world active campaign).
 * @param {Scene} scene  defaults to canvas.scene
 */
export async function clearSceneOverride(scene = canvas?.scene) {
  if (!scene) return;
  await scene.unsetFlag(FLAG_SCOPE, FLAG_KEY);
  game.sta2eToolkit?.broadcastHUDRender();
}

/**
 * Returns true if the current scene has an active override.
 * @returns {boolean}
 */
export function sceneHasOverride() {
  return !!getSceneOverride();
}
