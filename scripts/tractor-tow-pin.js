/**
 * Tractor tow pin — draws a towed ship at its tow offset from the host's
 * ANIMATED pose, on every client, every frame.
 *
 * The document follow in main.js moves the target too, but only after the
 * host's update has reached the active GM and the GM's own update has gone back
 * out: a round trip behind, and on a chained scripted move the lag carries
 * through every step. Pinning the render removes that: core merges each
 * animation frame into `token.document` (Token#animateFrame), so the host's
 * document holds where it is drawn right now, and the target is placed off that.
 * Once the GM's follow lands, the target's document agrees with the pin, so
 * releasing the beam shows no jump.
 *
 * Same chained-patch shape as warp-stretch-vfx.js: core's `_refreshPosition`
 * and `_refreshRotation` write position and angle from the document; we
 * re-apply the pin after them. Preview clones (a drag ghost) are never pinned,
 * so the towed ship can still be dragged to re-anchor it.
 *
 * Anything that aims AT a towed ship (the tractor beam itself) must use
 * `towDrawnPose`, since the target's own document can lag the drawing.
 */
import { towBox, towPose, resolveTowOffset } from "./tractor-tow.js";

const MODULE = "sta2e-toolkit";

function _tractorState(doc) {
  return doc?.flags?.[MODULE]?.tractorBeam ?? null;
}

/** The pin pose for a towed token, or null when it should draw as it is. */
function _pinPose(token) {
  if (!token || token.isPreview || token.destroyed) return null;
  const state = _tractorState(token.document);
  if (!state?.sourceTokenId || state.behavior === "beamOnly") return null;
  const host = canvas?.tokens?.get(state.sourceTokenId);
  if (!host || host.destroyed || host.isPreview) return null;
  const hostState = _tractorState(host.document);
  if (hostState?.targetTokenId !== token.document.id || hostState.behavior === "beamOnly") return null;
  const gridSize = canvas.grid?.size ?? 100;
  // Drawn (animated) poses: where the host is on screen right now.
  const hostBox = towBox(host.document, { final: false, gridSize });
  const tgtBox  = towBox(token.document, { final: false, gridSize });
  return towPose(hostBox, resolveTowOffset(hostState, hostBox, tgtBox, gridSize), tgtBox);
}

/**
 * Where a towed token is drawn — `{x, y}` its centre, `rotation` in degrees —
 * or null when it is not pinned (draw from its document as usual).
 */
export function towDrawnPose(token) {
  const pose = _pinPose(token);
  return pose ? { x: pose.cx, y: pose.cy, rotation: pose.rotation } : null;
}

function _applyPosition(token) {
  const pose = _pinPose(token);
  if (!pose) return;
  const { x, y } = token.document;
  const dx = pose.x - x, dy = pose.y - y;
  if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) return;
  try {
    token.position.set(pose.x, pose.y);
    const c = token.center;   // from the document
    token.mesh?.position?.set(c.x + dx, c.y + dy);
  } catch { /* torn down */ }
}

function _applyRotation(token) {
  if (token.document.lockRotation) return;
  const pose = _pinPose(token);
  if (!pose || !token.mesh) return;
  try { token.mesh.angle = pose.rotation; } catch { /* torn down */ }
}

/** Patch the Token refresh methods and wire the host → target refresh. Call from "setup". */
export function registerTractorTowPin() {
  const TokenClass = foundry.canvas?.placeables?.Token ?? Token;
  if (TokenClass?.prototype && !TokenClass.prototype._sta2eTowPinPatch) {
    const wrap = (method, apply) => {
      const original = TokenClass.prototype[method];
      if (typeof original !== "function") return;
      TokenClass.prototype[method] = function (...args) {
        const result = original.apply(this, args);
        if (this?.document?.flags?.[MODULE]?.tractorBeam) apply(this);
        return result;
      };
    };
    wrap("_refreshPosition", _applyPosition);
    wrap("_refreshRotation", _applyRotation);
    TokenClass.prototype._sta2eTowPinPatch = true;
  }

  // The host moving (or turning) must redraw its target, which core does not know about.
  Hooks.on("refreshToken", (token, flags) => {
    if (!(flags?.refreshPosition || flags?.refreshRotation)) return;
    if (token?.isPreview) return;
    const state = _tractorState(token?.document);
    if (!state?.targetTokenId || state.behavior === "beamOnly") return;
    const target = canvas?.tokens?.get(state.targetTokenId);
    target?.renderFlags?.set({ refreshPosition: true, refreshRotation: true });
  });

  // Engage / release / a new offset changes where the target belongs.
  Hooks.on("updateToken", (doc, changes) => {
    if (changes?.flags?.[MODULE] === undefined) return;
    const state = _tractorState(doc);
    const ids = [doc.id, state?.targetTokenId, state?.sourceTokenId];
    for (const id of ids) {
      canvas?.tokens?.get(id)?.renderFlags?.set({ refreshPosition: true, refreshRotation: true });
    }
  });
}
