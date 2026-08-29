/**
 * Destination prompts and ship movement card runners for the STA2e combat HUD.
 */

import { getStationOfficers } from "../crew-manifest.js";
import { spawnEngineTrail } from "../engine-trail-vfx.js";
import { getSceneZones, getZonePathWithCosts } from "../zone-data.js";
import {
  playWarpFlash,
  playWarpCorridor,
  getWarpCorridorMaxWaitMs,
  broadcastWarpChargeGlow,
  WARP_DEPART_MS,
  WARP_ARRIVE_MS,
  WARP_FLASH_PEAK_MS,
} from "../warp-jump-vfx.js";
import {
  getShipWarpEffectStyle,
  getWarpEffectStyleOptions,
  getWarpFlashTiming,
  resolveRequestedWarpStyle,
  resolveShipWarpEffectStyleId,
} from "../warp-effect-styles.js";
import {
  broadcastWarpStretch,
  getWarpStretchConfig,
  getWarpStretchTipOffset,
} from "../warp-stretch-vfx.js";
import { isSceneHeadingLocked, isSceneAtWarp } from "../scene-warp.js";

/**
 * Drop `rotation` from a movement update while the scene holds a formation
 * heading.
 *
 * Scene Warp's heading lock is absolute: ships at warp translate bow-forward
 * without ever turning, so the runners below still fly their arcs and glides but
 * stop writing the facing that goes with them. Stripping the key here rather
 * than skipping the update keeps every path — the Bezier steps, the final
 * settle, the jump teleport — moving exactly as it did.
 *
 * The standalone rotate loops are guarded at their own call sites instead, since
 * there is nothing left of them once the rotation is gone.
 */
function _moveUpdate(update) {
  if (!isSceneHeadingLocked()) return update;
  const { rotation, ...rest } = update;
  return rest;
}

/**
 * Ask which warp effect a fleeing ship should leave with.
 *
 * A ship with no gated style available never sees a prompt — it resolves
 * straight to its own default, so the existing one-click flee is untouched for
 * every ordinary ship. Only a ship that genuinely has a choice is asked.
 *
 * The ship's stored Ship VFX setting becomes the pre-selected button, so that
 * setting still acts as the default without being an override.
 *
 * @param   {Actor|Token} actorOrToken
 * @param   {object} [opts]
 * @param   {string} [opts.extraContent] HTML appended to the dialog body — used
 *   by callers that would otherwise have shown their own confirmation.
 * @returns {Promise<string|null>} chosen style id, or null if cancelled
 */
export async function promptWarpFleeStyle(actorOrToken, { extraContent = "" } = {}) {
  const actor = actorOrToken?.actor ?? actorOrToken ?? null;
  const options = getWarpEffectStyleOptions(actor);
  const fallback = resolveShipWarpEffectStyleId(actor);
  if (options.length < 2) return fallback;

  const name = actor?.name ?? "This ship";
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "Warp Out" },
    content: `
      <div style="padding:4px 0;line-height:1.6;font-size:12px;">
        How should <strong>${foundry.utils.escapeHTML?.(name) ?? name}</strong> leave?
      </div>${extraContent}`,
    buttons: [
      ...options.map(option => ({
        action: option.value,
        label: option.label,
        icon: option.icon ?? "fas fa-bolt",
        default: option.value === fallback,
      })),
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
    ],
    rejectClose: false,
    modal: true,
  });

  if (!choice || choice === "cancel") return null;
  return choice;
}

export async function promptShipCardDestination({ overlayId, title, color, tokenId = null, actorId = null, maxZones = null }) {
  return await new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.style.cssText = `position:fixed;top:10px;left:50%;transform:translateX(-50%);
      background:rgba(0,0,0,0.75);color:${color};border:1px solid ${color};
      padding:6px 18px;border-radius:4px;z-index:999999;
      font-family:'Arial Narrow',sans-serif;text-align:center;pointer-events:none;`;
    overlay.innerHTML = `<div style="font-size:13px;font-weight:700;letter-spacing:0.1em;">
      ${title}</div>
      <div style="font-size:10px;margin-top:2px;">Click to set destination · ESC to cancel</div>`;
    document.body.appendChild(overlay);
    const prevBodyCursor = document.body.style.cursor;
    const prevViewCursor = canvas.app.view.style.cursor;
    const prevParentCursor = canvas.app.view.parentElement?.style.cursor ?? "";
    document.body.style.cursor = "crosshair";
    canvas.app.view.style.cursor = "crosshair";
    if (canvas.app.view.parentElement) canvas.app.view.parentElement.style.cursor = "crosshair";
    ui.notifications.info("Click a destination on the scene, or press Escape to cancel.");

    // ── Tether: PIXI line from ship token to cursor ──────────────────────────
    let _tetherGfx = null;
    let _tetherLabel = null;
    const _shipToken = tokenId
      ? (canvas.tokens?.get(tokenId) ?? canvas.tokens?.placeables.find(t => t.document?.id === tokenId) ?? null)
      : actorId
        ? (canvas.tokens?.placeables.find(t => t.document?.actorId === actorId || t.actor?.id === actorId) ?? null)
        : null;


    if (_shipToken) {
      _tetherGfx = new PIXI.Graphics();
      const _tetherParent = canvas?.interface ?? canvas?.stage;
      _tetherParent?.addChild(_tetherGfx);
    }

    const _tetherMove = (event) => {
      if (!_tetherGfx || !_shipToken) return;
      const cursorPt = canvas?.canvasCoordinatesFromClient?.({ x: event.clientX, y: event.clientY });
      if (!cursorPt) return;

      const origin = _shipToken.center ?? { x: _shipToken.x, y: _shipToken.y };
      _tetherGfx.clear();

      let lineColor = 0xffffff;
      let labelText = "";
      const zones = getSceneZones();
      if (zones.length && maxZones != null) {
        const info = getZonePathWithCosts(origin, cursorPt, zones);
        const zn = info?.zoneCount ?? -1;
        if (zn >= 0) {
          const withinRange = zn <= maxZones;
          lineColor = withinRange ? 0x00cc44 : 0xff3333;
          labelText = `${zn} zone${zn !== 1 ? "s" : ""} · ${info.rangeBand}${withinRange ? "" : " (out of range)"}`;
        } else {
          lineColor = 0xffffff;
          labelText = "out of zones";
        }
      } else {
        lineColor = parseInt(color.replace("#", ""), 16);
      }

      // Dashed tether line
      _tetherGfx.lineStyle(2, lineColor, 0.8);
      const dx = cursorPt.x - origin.x;
      const dy = cursorPt.y - origin.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const nx = dx / len, ny = dy / len;
        const dash = 18, gap = 10;
        let pos = 0;
        let drawing = true;
        while (pos < len) {
          const seg = Math.min(drawing ? dash : gap, len - pos);
          if (drawing) {
            _tetherGfx.moveTo(origin.x + nx * pos, origin.y + ny * pos);
            _tetherGfx.lineTo(origin.x + nx * (pos + seg), origin.y + ny * (pos + seg));
          }
          pos += seg;
          drawing = !drawing;
        }
      }

      // Endpoint circle at cursor
      _tetherGfx.lineStyle(0);
      _tetherGfx.beginFill(lineColor, 0.5);
      _tetherGfx.drawCircle(cursorPt.x, cursorPt.y, 6);
      _tetherGfx.endFill();

      if (_tetherLabel && labelText) {
        const px = Math.min(event.clientX + 18, window.innerWidth - 200);
        const py = Math.min(event.clientY + 18, window.innerHeight - 40);
        _tetherLabel.style.left = `${px}px`;
        _tetherLabel.style.top  = `${py}px`;
        _tetherLabel.textContent = labelText;
        _tetherLabel.style.color = `#${lineColor.toString(16).padStart(6, "0")}`;
      }
    };

    if (_shipToken) {
      _tetherLabel = document.createElement("div");
      _tetherLabel.style.cssText = `position:fixed;z-index:1000000;pointer-events:none;
        font-family:'Arial Narrow',sans-serif;font-size:11px;font-weight:700;
        letter-spacing:0.08em;text-shadow:0 0 4px #000;`;
      document.body.appendChild(_tetherLabel);
      window.addEventListener("mousemove", _tetherMove);
    }

    const extractPoint = (event) => {
      if (event?.clientX != null && event?.clientY != null && canvas?.canvasCoordinatesFromClient) {
        const pt = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
        if (pt?.x != null && pt?.y != null) return { x: pt.x, y: pt.y };
      }
      const origin =
        event?.interactionData?.origin
        ?? event?.data?.origin
        ?? event?.data?.getLocalPosition?.(canvas.stage)
        ?? event?.getLocalPosition?.(canvas.stage)
        ?? null;
      if (origin?.x != null && origin?.y != null) return { x: origin.x, y: origin.y };
      return null;
    };

    const cleanup = () => {
      document.getElementById(overlayId)?.remove();
      canvas.stage.off("mousedown", clickHandler);
      canvas.stage.off("pointerdown", clickHandler);
      canvas.app.view?.removeEventListener("pointerdown", domClickHandler, true);
      document.removeEventListener("keydown", escHandler);
      document.body.style.cursor = prevBodyCursor;
      canvas.app.view.style.cursor = prevViewCursor || "default";
      if (canvas.app.view.parentElement) canvas.app.view.parentElement.style.cursor = prevParentCursor;
      // Tether cleanup
      window.removeEventListener("mousemove", _tetherMove);
      _tetherLabel?.remove();
      if (_tetherGfx) {
        _tetherGfx.clear();
        _tetherGfx.parent?.removeChild(_tetherGfx);
        _tetherGfx.destroy();
        _tetherGfx = null;
      }
    };
    const clickHandler = (event) => {
      const point = extractPoint(event);
      if (!point) return;
      cleanup();
      resolve(point);
    };
    const domClickHandler = (event) => {
      const point = extractPoint(event);
      if (!point) return;
      cleanup();
      resolve(point);
    };
    const escHandler = (event) => {
      if (event.key !== "Escape") return;
      cleanup();
      resolve(null);
    };

    canvas.stage.on("mousedown", clickHandler);
    canvas.stage.on("pointerdown", clickHandler);
    canvas.app.view?.addEventListener("pointerdown", domClickHandler, true);
    document.addEventListener("keydown", escHandler);
  });
}

function getCardShipToken(payload = {}) {
  const tok = canvas.tokens?.get(payload.tokenId);
  if (!tok) throw new Error("Token not found on current scene.");
  return tok;
}

export function getActorPlayerUserIds(actor) {
  if (!actor) return [];
  return game.users
    .filter(user => !user.isGM && actor.testUserPermission?.(user, "OWNER"))
    .map(user => user.id);
}

export function getActorRollUserId(actor, fallbackUserId = game.userId) {
  if (!actor) return fallbackUserId;
  if (!game.user?.isGM && actor.testUserPermission?.(game.user, "OWNER")) {
    return game.userId;
  }

  const activeOwner = game.users.find(user =>
    user.active && !user.isGM && actor.testUserPermission?.(user, "OWNER")
  );
  return activeOwner?.id ?? fallbackUserId;
}

export function getStationAllowedUserIds(shipActor, stationId) {
  const ids = new Set();
  const officers = getStationOfficers(shipActor, stationId) ?? [];
  for (const officer of officers) {
    for (const userId of getActorPlayerUserIds(officer)) ids.add(userId);
  }
  return Array.from(ids);
}

function normalizeShipDestination(tok, point) {
  const gridSize = canvas.grid?.size ?? 100;
  const tokW = (tok.document.width ?? 1) * gridSize;
  const tokH = (tok.document.height ?? 1) * gridSize;

  // Treat the click as the desired ship center, then convert to top-left token coords.
  const desired = {
    x: point.x - tokW / 2,
    y: point.y - tokH / 2,
  };

  const snapped = canvas.grid?.getSnappedPoint
    ? canvas.grid.getSnappedPoint(desired, {})
    : desired;

  return {
    x: snapped?.x ?? desired.x,
    y: snapped?.y ?? desired.y,
  };
}

const ACTION_ENGINE_TRAIL_MAX_MS = 8000;
// Waypoint interval for scripted moves. Each waypoint is a document.update
// (a server round-trip that fires every updateToken hook on every client),
// so keep these coarse and let Foundry tween between waypoints. Intermediate
// waypoints carry `sta2eScriptedMove: true` so main.js skips per-step zone
// BFS / cover / movement-log work; zone logic runs once on the final update.
const IMPULSE_BEZIER_STEP_MS = 60;
const SCRIPTED_STEP_OPTIONS = Object.freeze({
  animate: true,
  sta2eScriptedMove: true,
});

function _scriptedStepOptions(durationMs) {
  return {
    ...SCRIPTED_STEP_OPTIONS,
    animation: { duration: durationMs, easing: "linear" },
  };
}

// Same thing with a chosen easing — used by the warp run-up / run-out, which
// are single eased glides rather than a stream of linear waypoints.
function _scriptedGlideOptions(durationMs, easing) {
  return {
    ...SCRIPTED_STEP_OPTIONS,
    animation: { duration: durationMs, easing },
  };
}

// ── Warp jump geometry ───────────────────────────────────────────────────────
// A warp jump is a teleport, not a flight. The ship turns to face its
// destination, takes a short accelerating run-up along that heading, flashes
// out, reappears just SHORT of the destination, and glides the last stretch to
// a stop — so it decelerates out of warp onto the exact snapped square.
//
// Both run distances are capped as a fraction of the total trip: a two-square
// hop must not overshoot itself and snap backwards.
const WARP_RUN_IN_SQUARES   = 0.75;
const WARP_RUN_OUT_SQUARES  = 1.0;
const WARP_RUN_MAX_FRACTION = 0.25;
const WARP_RUN_IN_MS   = 320;
const WARP_RUN_OUT_MS  = 380;
const WARP_FADE_OUT_MS = 200;
const WARP_FADE_IN_MS  = 160;

/**
 * Unit heading plus clamped run-in / run-out distances for a warp jump.
 *
 * The square counts default to the standard warp's, and a style that wants the
 * ship to travel further through its effect passes its own. The trip-fraction
 * cap still applies either way, so a longer transit cannot overshoot a short
 * hop or carry the effect off the map.
 *
 * @returns {{ux:number, uy:number, dist:number, heading:number, runIn:number, runOut:number}}
 */
function _warpVector(from, to, {
  inSquares  = WARP_RUN_IN_SQUARES,
  outSquares = WARP_RUN_OUT_SQUARES,
} = {}) {
  const gridSize = canvas?.grid?.size ?? 100;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const heading = Math.atan2(dy, dx);
  if (dist < 1) {
    return { ux: Math.cos(heading), uy: Math.sin(heading), dist, heading, runIn: 0, runOut: 0 };
  }
  const cap = dist * WARP_RUN_MAX_FRACTION;
  return {
    ux: dx / dist,
    uy: dy / dist,
    dist,
    heading,
    runIn:  Math.min(inSquares  * gridSize, cap),
    runOut: Math.min(outSquares * gridSize, cap),
  };
}

/** Half the token's rendered footprint — converts top-left coords to a centre. */
function _tokenHalfSize(tok) {
  const gridSize = canvas?.grid?.size ?? 100;
  return {
    halfW: ((tok.document.width  ?? 1) * gridSize) / 2,
    halfH: ((tok.document.height ?? 1) * gridSize) / 2,
  };
}

// spawnEngineTrail is a client-local PIXI effect. These runners execute only on
// the responsible GM client (socket-routed), so without a broadcast the trail
// renders on that one canvas and nobody else — including the player who
// clicked — ever sees it. Spawn locally AND tell every other client to spawn
// the same trail; stop() broadcasts the stop the same way. Remote trails also
// self-clean on their built-in safety timeout if the stop message is lost.
function broadcastEngineTrail(tok, kind, opts = {}) {
  const tokenId = tok?.document?.id ?? tok?.id ?? null;
  const local = spawnEngineTrail(tok, kind, opts);
  if (tokenId) {
    try {
      game.socket.emit("module.sta2e-toolkit", {
        action: "spawnEngineTrailVfx",
        tokenId,
        kind,
        opts: { emitDuration: opts.emitDuration, drift: opts.drift },
      });
    } catch { /* cosmetic — never block the move */ }
  }
  return {
    stop() {
      local?.stop?.();
      if (!tokenId) return;
      try {
        game.socket.emit("module.sta2e-toolkit", {
          action: "stopEngineTrailVfx",
          tokenId,
        });
      } catch { /* cosmetic */ }
    },
  };
}

function _clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function _clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function _canvasDistanceSquares(from, to) {
  const gridSize = canvas?.grid?.size ?? 100;
  const dx = (to?.x ?? 0) - (from?.x ?? 0);
  const dy = (to?.y ?? 0) - (from?.y ?? 0);
  return Math.hypot(dx, dy) / Math.max(1, gridSize);
}

function _distanceDurationMs(from, to, { base, perSquare, min, max }) {
  const squares = _canvasDistanceSquares(from, to);
  return Math.round(_clampNumber(base + squares * perSquare, min, max));
}

function _distanceTrailTailMs(from, to) {
  const squares = _canvasDistanceSquares(from, to);
  return Math.round(_clampNumber(squares * 45, 80, 450));
}

export async function runImpulseEngageCard(payload, destination) {
  const tok = getCardShipToken(payload);
  const impulseSound = game.settings.get("sta2e-toolkit", "sndImpulseEngage") ?? "";
  const startPos = { x: tok.x, y: tok.y };
  const startOrigin = tok.center ?? { x: tok.x + tok.w / 2, y: tok.y + tok.h / 2 };
  const finalDestination = normalizeShipDestination(tok, destination);

  // Suppress per-frame zone log chat cards during the Bezier animation; one
  // card is posted manually after the final position update.
  game.sta2eToolkit?.zoneMovementLog?._suppressIds?.add(tok.document.id);

  if (impulseSound && window.Sequence) {
    try { new window.Sequence().sound().file(impulseSound).volume(0.8).play(); } catch(e) {}
  }

  const dx   = finalDestination.x - startPos.x;
  const dy   = finalDestination.y - startPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const mx   = startPos.x + dx * 0.5;
  const my   = startPos.y + dy * 0.5;
  const arcAmount = Math.min(dist * 0.3, 200);
  const px   = mx - (dy / dist) * arcAmount;
  const py   = my + (dx / dist) * arcAmount;

  const ease        = t => t * t * (3 - 2 * t);
  const DURATION_MS = _distanceDurationMs(startPos, finalDestination, {
    base: 520,
    perSquare: 180,
    min: 700,
    max: 2800,
  });
  const STEP_MS     = IMPULSE_BEZIER_STEP_MS;
  const STEPS       = Math.round(DURATION_MS / STEP_MS);

  const sampleImpulsePath = (rawProgress) => {
    const raw = _clamp01(rawProgress);
    const t   = ease(raw);
    const mt  = 1 - t;
    const x   = mt * mt * startPos.x + 2 * mt * t * px + t * t * finalDestination.x;
    const y   = mt * mt * startPos.y + 2 * mt * t * py + t * t * finalDestination.y;
    const rt  = Math.max(0.01, Math.min(0.99, raw));
    const rmt = 1 - rt;
    const tdx = 2 * rmt * (px - startPos.x) + 2 * rt * (finalDestination.x - px);
    const tdy = 2 * rmt * (py - startPos.y) + 2 * rt * (finalDestination.y - py);
    const rotation = Math.atan2(tdy, tdx) * (180 / Math.PI) - 90;
    return { x, y, rotation };
  };

  const trail = broadcastEngineTrail(tok, "impulse", {
    emitDuration: ACTION_ENGINE_TRAIL_MAX_MS,
    drift: false,
  });

  for (let i = 1; i <= STEPS; i++) {
    const nextProgress = i / STEPS;
    const p = sampleImpulsePath(nextProgress);

    await tok.document.update(
      _moveUpdate({ x: p.x, y: p.y, rotation: p.rotation }),
      _scriptedStepOptions(STEP_MS)
    );
    await new Promise(r => setTimeout(r, STEP_MS));
  }

  const finalAngle = Math.atan2(finalDestination.y - startPos.y, finalDestination.x - startPos.x) * (180 / Math.PI) - 90;
  await tok.document.update(_moveUpdate({ x: finalDestination.x, y: finalDestination.y, rotation: finalAngle }));
  await new Promise(r => setTimeout(r, _distanceTrailTailMs(startPos, finalDestination)));
  trail?.stop?.();

  // Lift suppression and post a single zone movement log for the full move.
  game.sta2eToolkit?.zoneMovementLog?._suppressIds?.delete(tok.document.id);
  game.sta2eToolkit?.zoneMovementLog?.onTokenMove(
    tok.document, startOrigin,
    { x: finalDestination.x, y: finalDestination.y }
  );

}

/**
 * The Warp movement task on a scene that is *already* at warp.
 *
 * Repositioning within a warp formation is not another jump: the ship simply
 * changes station, so this glides it there and skips the whole jump sequence —
 * no turn, no run-up, no flash, no vanish, no hull smear. Jumping to warp while
 * at warp makes no fiction sense, and the vanish in particular reads badly
 * against a moving starfield.
 *
 * It also deliberately does **not** touch the nacelle glow. Scene Warp holds
 * that lit for the duration; firing the jump's own `broadcastWarpChargeGlow`
 * here and stopping it at the end would pop the nacelles dark mid-warp.
 */
async function _runWarpStationChange(tok, startPosition, startOrigin, finalDestination) {
  game.sta2eToolkit?.zoneMovementLog?._suppressIds?.add(tok.document.id);
  try {
    const durationMs = _distanceDurationMs(startPosition, finalDestination, {
      base: 460, perSquare: 150, min: 620, max: 2400,
    });
    // No rotation in this update at all: the heading lock owns facing here, and
    // even with the lock off a ship at warp holds its course.
    await tok.document.update(
      { x: finalDestination.x, y: finalDestination.y },
      _scriptedGlideOptions(durationMs, "easeInOutCircle"),
    );
    await new Promise(r => setTimeout(r, durationMs));

    game.sta2eToolkit?.zoneMovementLog?._suppressIds?.delete(tok.document.id);
    game.sta2eToolkit?.zoneMovementLog?.onTokenMove(
      tok.document, startOrigin,
      { x: finalDestination.x, y: finalDestination.y },
    );
  } finally {
    game.sta2eToolkit?.zoneMovementLog?._suppressIds?.delete(tok.document.id);
  }
}

export async function runWarpEngageCard(payload, destination) {
  const tok = getCardShipToken(payload);
  const startPosition = { x: tok.x, y: tok.y };
  const startOrigin = tok.center ?? { x: tok.x + tok.w / 2, y: tok.y + tok.h / 2 };
  const finalDestination = normalizeShipDestination(tok, destination);
  let targetRotation = tok.document.rotation || 0;

  // Already at warp — a station change, not a jump. See the note above.
  if (isSceneAtWarp()) {
    return _runWarpStationChange(tok, startPosition, startOrigin, finalDestination);
  }

  // Suppress per-step zone log chat cards during the stepped flight; one card
  // is posted manually after the final position update (same as impulse).
  game.sta2eToolkit?.zoneMovementLog?._suppressIds?.add(tok.document.id);

  // Nacelle power-up: the glow sweeps the warp splines through the rotation
  // and run-up, holds at peak, and its stop() pop lands on the depart flash.
  const chargeGlow = broadcastWarpChargeGlow(tok, { sweepMs: 500 });

  try {
    const angle = Math.atan2(finalDestination.y - startPosition.y, finalDestination.x - startPosition.x) * (180 / Math.PI);
    targetRotation = angle - 90;
    // Under a formation heading lock the ship keeps its facing and the run-up,
    // flash and jump below all still play — it simply departs sideways.
    if (isSceneHeadingLocked()) {
      targetRotation = tok.document.rotation || 0;
    } else {
      const orig  = tok.document.rotation || 0;
      const delta = ((targetRotation - orig + 540) % 360) - 180;
      const steps = 15;
      for (let i = 1; i <= steps; i++) {
        await tok.document.update({ rotation: orig + (delta / steps * i) });
        await new Promise(r => setTimeout(r, 20));
      }
      await tok.document.update({ rotation: targetRotation });
    }
  } catch(e) { console.warn("STA2e | warp rotate:", e); }

  const vec = _warpVector(startPosition, finalDestination);
  const { halfW, halfH } = _tokenHalfSize(tok);

  // The hull smear at both ends. This jump always draws the *standard* flash
  // (see the style-agnostic note at the depart beat below), so it reads the
  // standard style's stretch — a look rather than a timing, so honouring it here
  // does not weaken that contract the way honouring the ship's style would.
  const stretchCfg = getWarpStretchConfig("standard");
  let stretch = null;

  // The ship is invisible between the two flashes. If anything throws in that
  // window it must not be left that way, so everything below runs under a
  // finally that restores alpha and lifts the zone-log suppression.
  try {
    // ── 1. Run-up — a single accelerating lunge along the heading ──────────
    const launchPoint = {
      x: startPosition.x + vec.ux * vec.runIn,
      y: startPosition.y + vec.uy * vec.runIn,
    };
    // Wind-up: the hull elongates through the run-up and reaches full smear
    // exactly as alpha hits 0 at the flash peak. playWarpStretch holds a non-1
    // target once it arrives, so it stays smeared until stopped below.
    //
    // Anchored at the trailing end so the bow tears forward while the stern digs
    // in — that is what makes the run-up lunge read. A symmetric smear grows as
    // much hull backwards as forwards and cancels it.
    if (stretchCfg) {
      stretch = broadcastWarpStretch(tok, {
        from: 1, to: stretchCfg.max, squeeze: stretchCfg.squeeze,
        durationMs: WARP_RUN_IN_MS + WARP_FLASH_PEAK_MS,
        easing: "in",
        anchor: "stern", dir: { x: vec.ux, y: vec.uy },
      });
    }

    // Where each flash goes: the far tip of the smear, opposite its anchor — the
    // bow at departure, the stern on arrival — so the ship punches into the
    // burst rather than having it go off amidships. Both are measured once, here,
    // while the mesh is still at base scale and the depart stretch's captured
    // hull length is live; by corridor time that smear has already been dropped.
    // Zero when there is no stretch, so they can be added unconditionally.
    const tipArgs = { max: stretchCfg?.max, dir: { x: vec.ux, y: vec.uy } };
    const tipOut = getWarpStretchTipOffset(tok, { ...tipArgs, anchor: "stern" });
    const tipIn  = getWarpStretchTipOffset(tok, { ...tipArgs, anchor: "bow" });

    if (vec.runIn > 0) {
      await tok.document.update(
        { x: launchPoint.x, y: launchPoint.y },
        _scriptedGlideOptions(WARP_RUN_IN_MS, "easeInCircle")
      );
      await new Promise(r => setTimeout(r, WARP_RUN_IN_MS));
    }

    // ── 2. Flash out — the clip's biggest frame lands at WARP_FLASH_PEAK_MS,
    //       so the ship fades to be gone exactly at the peak, and the nacelle
    //       glow pops out with it. The clip's tail plays over empty space.
    //
    // The in-scene jump is deliberately style-agnostic: it passes no styleId,
    // so it always draws the standard flash and the WARP_* constants below stay
    // correct. Do not "fix" this to honour the ship's warp effect without also
    // switching every timing below to getWarpFlashTiming().
    playWarpFlash(tok, "depart", {
      heading: vec.heading,
      x: launchPoint.x + halfW + tipOut.x,
      y: launchPoint.y + halfH + tipOut.y,
      soundKey: "sndWarpEngage",
    });
    await new Promise(r => setTimeout(r, Math.max(0, WARP_FLASH_PEAK_MS - WARP_FADE_OUT_MS)));
    chargeGlow?.stop?.();
    await tok.document.update({ alpha: 0 }, { animate: true, animation: { duration: WARP_FADE_OUT_MS } });
    // Ship gone — drop the smear now, so an undeformed token makes the teleport
    // and nothing is left held across the corridor wait.
    stretch?.stop?.();
    stretch = null;
    await new Promise(r => setTimeout(r, Math.max(0, WARP_DEPART_MS - WARP_FLASH_PEAK_MS)));

    // ── 3. The jump — one update, no waypoints. Land short of the destination
    //       by the run-out distance so the glide below finishes exactly on it.
    const arrivalPoint = {
      x: finalDestination.x - vec.ux * vec.runOut,
      y: finalDestination.y - vec.uy * vec.runOut,
    };

    // The corridor spans the jump itself. Start it, then move the (still
    // invisible) ship to the far end while it plays.
    //
    // It runs flash-to-flash rather than centre-to-centre, so the streak links
    // the two bursts instead of stopping short of them. Both tips point *inward*
    // along the travel line — the bow reaches forward from the launch point, the
    // stern trails back from the arrival point — so on a short hop they can
    // cross, a full smear being many squares long. Fall back to the centres
    // rather than draw a reversed streak.
    const launchCentre  = { x: launchPoint.x  + halfW, y: launchPoint.y  + halfH };
    const arrivalCentre = { x: arrivalPoint.x + halfW, y: arrivalPoint.y + halfH };
    const corridorFrom  = { x: launchCentre.x  + tipOut.x, y: launchCentre.y  + tipOut.y };
    const corridorTo    = { x: arrivalCentre.x + tipIn.x,  y: arrivalCentre.y  + tipIn.y };
    const tipSpan = (corridorTo.x - corridorFrom.x) * vec.ux
                  + (corridorTo.y - corridorFrom.y) * vec.uy;
    const tipsCross = tipSpan < (canvas?.grid?.size ?? 100);

    const corridor = playWarpCorridor(
      tipsCross ? launchCentre  : corridorFrom,
      tipsCross ? arrivalCentre : corridorTo,
      { width: Math.max(halfW, halfH) }
    );

    await tok.document.update(
      _moveUpdate({ x: arrivalPoint.x, y: arrivalPoint.y, rotation: targetRotation, alpha: 0 }),
      { animate: false, teleport: true, sta2eScriptedMove: true }
    );

    // Wait on the corridor effect itself rather than a guessed delay — a JB2A
    // asset has load latency before its first frame, so a fixed hold let the
    // ship reappear before the strand had started drawing. The race caps the
    // wait: a missing or hung asset must never strand the ship invisible.
    await Promise.race([
      corridor.catch(() => {}),
      new Promise(r => setTimeout(r, getWarpCorridorMaxWaitMs())),
    ]);

    // ── 4. Flash in — the ship materialises on the clip's peak frame ───────
    // Still smeared when it does: the stretch is held through the invisible
    // window and starts settling exactly as the alpha fade begins, easing out
    // across the run-out glide so the hull comes back as the ship decelerates.
    //
    // Anchored at the leading end this time — the ship materialises nose-first
    // on the arrival point with the hull trailing behind it, and compacts onto
    // it rather than growing forward out of it.
    if (stretchCfg) {
      stretch = broadcastWarpStretch(tok, {
        from: stretchCfg.max, to: 1, squeeze: stretchCfg.squeeze,
        holdMs: Math.max(0, WARP_FLASH_PEAK_MS - WARP_FADE_IN_MS),
        durationMs: Math.max(0, WARP_ARRIVE_MS - WARP_FLASH_PEAK_MS) + WARP_RUN_OUT_MS,
        easing: "out",
        anchor: "bow", dir: { x: vec.ux, y: vec.uy },
      });
    }
    playWarpFlash(tok, "arrive", {
      heading: vec.heading,
      x: arrivalCentre.x + tipIn.x,
      y: arrivalCentre.y + tipIn.y,
      soundKey: "sndWarpArrive",
    });
    await new Promise(r => setTimeout(r, Math.max(0, WARP_FLASH_PEAK_MS - WARP_FADE_IN_MS)));
    await tok.document.update({ alpha: 1 }, { animate: true, animation: { duration: WARP_FADE_IN_MS } });
    await new Promise(r => setTimeout(r, Math.max(0, WARP_ARRIVE_MS - WARP_FLASH_PEAK_MS)));

    // ── 5. Run-out — decelerate onto the snapped destination ───────────────
    if (vec.runOut > 0) {
      await tok.document.update(
        { x: finalDestination.x, y: finalDestination.y },
        _scriptedGlideOptions(WARP_RUN_OUT_MS, "easeOutCircle")
      );
      await new Promise(r => setTimeout(r, WARP_RUN_OUT_MS));
    } else {
      await tok.document.update({ x: finalDestination.x, y: finalDestination.y });
    }

    // Suppression is lifted in the finally; post the single zone movement log
    // for the whole jump only when it actually completed.
    game.sta2eToolkit?.zoneMovementLog?._suppressIds?.delete(tok.document.id);
    game.sta2eToolkit?.zoneMovementLog?.onTokenMove(
      tok.document, startOrigin,
      { x: finalDestination.x, y: finalDestination.y }
    );
  } finally {
    game.sta2eToolkit?.zoneMovementLog?._suppressIds?.delete(tok.document.id);
    // Idempotent — a no-op when the glow already stopped at the depart flash,
    // but keeps it from lingering if anything above threw before that.
    chargeGlow?.stop?.();
    // Likewise: a throw mid-jump must never leave the hull smeared.
    stretch?.stop?.();
    try {
      if ((tok.document.alpha ?? 1) < 1) await tok.document.update({ alpha: 1 });
    } catch { /* token may have been deleted mid-jump */ }
  }
}

/**
 * Warp a token in where it already stands — the arrival half of a warp jump,
 * for ships that materialise into the scene rather than travelling to it.
 *
 * The token must already exist at its **final** position with `alpha: 0`. This
 * teleports it back along `heading` while it is invisible, flashes it in there,
 * fades it up, and glides it forward onto the position it started at — so the
 * ship decelerates out of warp onto the exact square the caller chose.
 *
 * @param {Token}  tok        Canvas token, already placed and invisible
 * @param {number} heading    Direction of travel in radians (canvas bearing)
 * @param {object} [opts]
 * @param {object} [opts.style] Pre-resolved warp effect style. The spawner
 *   passes this because a token created moments ago may not yet resolve its
 *   synthetic actor; otherwise it is read off the token.
 */
export async function runShipWarpArrival(tok, heading, opts = {}) {
  const gridSize    = canvas?.grid?.size ?? 100;
  const destination = { x: tok.document.x, y: tok.document.y };
  const { halfW, halfH } = _tokenHalfSize(tok);

  // A timeship's rift runs several times longer than the standard flash, so
  // every beat below is timed against the style rather than the constants.
  const style = opts.style ?? getShipWarpEffectStyle(tok?.actor ?? tok);
  const { peakMs, arriveMs } = getWarpFlashTiming(style.id);

  // Null for a rift — a ship coasting out of an aperture is not decelerating,
  // so it arrives at its normal size.
  const stretchCfg = getWarpStretchConfig(style);
  let stretch = null;

  // Computed directly rather than through _warpVector: with no trip distance,
  // its WARP_RUN_MAX_FRACTION cap collapses the run-out to zero and the ship
  // would simply pop in. Large ships get a proportionally longer run so the
  // deceleration reads at any hull size. A fly-through style stretches the run
  // so the ship visibly travels out of the effect rather than decelerating off
  // its edge.
  const runOut   = Math.max(gridSize, halfW, halfH) * style.transit.outSquares;
  const runOutMs = style.transit.outMs;
  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const arrival = {
    x: destination.x - ux * runOut,
    y: destination.y - uy * runOut,
  };

  // Everything below happens while the ship is invisible. If any of it throws
  // the token must not be left that way — same guard as runWarpEngageCard.
  try {
    await tok.document.update(
      { x: arrival.x, y: arrival.y },
      { animate: false, teleport: true, sta2eScriptedMove: true }
    );

    // Arrives fully smeared and settles across the run-out glide — the same
    // nose-first beat as the arrival half of an in-scene jump.
    if (stretchCfg) {
      stretch = broadcastWarpStretch(tok, {
        from: stretchCfg.max, to: 1, squeeze: stretchCfg.squeeze,
        holdMs: Math.max(0, peakMs - WARP_FADE_IN_MS),
        durationMs: Math.max(0, arriveMs - peakMs) + runOutMs,
        easing: "out",
        anchor: "bow", dir: { x: ux, y: uy },
      });
    }

    // The burst goes at the far tip of the smear — behind the ship, at its stern
    // — so it streams forward out of the flash rather than wearing it amidships.
    // Measured after the stretch starts, so the captured hull length is live.
    const tipIn = getWarpStretchTipOffset(tok, {
      max: stretchCfg?.max, anchor: "bow", dir: { x: ux, y: uy },
    });

    playWarpFlash(tok, "arrive", {
      heading,
      x: arrival.x + halfW + tipIn.x,
      y: arrival.y + halfH + tipIn.y,
      soundKey: "sndWarpArrive",
      styleId: style.id,
    });
    await new Promise(r => setTimeout(r, Math.max(0, peakMs - WARP_FADE_IN_MS)));
    await tok.document.update({ alpha: 1 }, { animate: true, animation: { duration: WARP_FADE_IN_MS } });
    // The clip's tail plays over the ship either way. A fly-through style skips
    // the hold and starts moving the moment it is solid, so it reads as coasting
    // out of the aperture instead of appearing and then pausing.
    if (!style.transit.flyThrough) {
      await new Promise(r => setTimeout(r, Math.max(0, arriveMs - peakMs)));
    }

    await tok.document.update(
      { x: destination.x, y: destination.y },
      _scriptedGlideOptions(runOutMs, "easeOutCircle")
    );
    await new Promise(r => setTimeout(r, runOutMs));
  } finally {
    stretch?.stop?.();
    try {
      if ((tok.document.alpha ?? 1) < 1) await tok.document.update({ alpha: 1 });
    } catch { /* token may have been deleted mid-arrival */ }
  }
}

/**
 * @param {object} payload  Ship card payload; only tokenId is read here.
 * @param {object} [opts]
 * @param {string} [opts.styleId] Warp effect chosen at the point of use. Passed
 *   as a sibling of the payload rather than inside it, because the payload is
 *   also fed to the chat-card access checks. Re-validated against the actor's
 *   traits below — it can arrive from a player over a socket.
 */
export async function runWarpFleeCard(payload, opts = {}) {
  const tok = getCardShipToken(payload);

  // Timeships leave through a rift rather than a warp flash — a much longer
  // clip, so every beat below is timed against the style.
  const style = resolveRequestedWarpStyle(tok?.actor ?? tok, opts.styleId);
  const { peakMs, departMs } = getWarpFlashTiming(style.id);

  const gridSize  = canvas.grid?.size ?? 100;
  const tokW      = (tok.document.width  ?? 1) * gridSize;
  const tokH      = (tok.document.height ?? 1) * gridSize;
  const cx        = tok.x + tokW / 2;
  const cy        = tok.y + tokH / 2;
  const sceneX    = canvas.dimensions?.sceneX      ?? 0;
  const sceneY    = canvas.dimensions?.sceneY      ?? 0;
  const sceneW    = canvas.dimensions?.sceneWidth  ?? canvas.scene.width;
  const sceneH    = canvas.dimensions?.sceneHeight ?? canvas.scene.height;

  const distLeft   = cx - sceneX;
  const distRight  = (sceneX + sceneW) - cx;
  const distTop    = cy - sceneY;
  const distBottom = (sceneY + sceneH) - cy;
  const minDist    = Math.min(distLeft, distRight, distTop, distBottom);

  let destX = tok.x;
  let destY = tok.y;
  if (minDist === distLeft)       destX = sceneX - tokW - gridSize;
  else if (minDist === distRight) destX = sceneX + sceneW + gridSize;
  else if (minDist === distTop)   destY = sceneY - tokH - gridSize;
  else                            destY = sceneY + sceneH + gridSize;

  let targetRotation = tok.document.rotation || 0;
  // Same nacelle power-up as an engage jump; its stop() lands on the flash.
  // The glow self-expires at sweepMs + peakHoldMs, so the hold has to track the
  // style's peak — on its 4000ms default a long rift peak would blink the
  // nacelles out before the ship itself vanished.
  const chargeGlow = broadcastWarpChargeGlow(tok, { sweepMs: 500, peakHoldMs: peakMs + 1500 });
  try {
    const angle = Math.atan2(destY - tok.y, destX - tok.x) * (180 / Math.PI);
    targetRotation = angle - 90;
    // Same rule as an engage jump: a formation heading lock keeps the facing,
    // and the ship leaves the map on its existing course.
    if (isSceneHeadingLocked()) {
      targetRotation = tok.document.rotation || 0;
    } else {
      const orig  = tok.document.rotation || 0;
      const delta = ((targetRotation - orig + 540) % 360) - 180;
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        await tok.document.update({ rotation: orig + (delta / steps * i) });
        await new Promise(r => setTimeout(r, 20));
      }
      await tok.document.update({ rotation: targetRotation });
    }
  } catch(e) { console.warn("STA2e | warp-flee rotate:", e); }

  // Same departure beat as an engage jump — run-up, flash, gone. The ship
  // never crosses the map; it warps out from where it stands.
  const startX = tok.x;
  const startY = tok.y;
  const vec = _warpVector({ x: startX, y: startY }, { x: destX, y: destY }, style.transit);
  const { halfW, halfH } = _tokenHalfSize(tok);

  // No zone log for a ship leaving the map — suppress cards for the whole exit.
  game.sta2eToolkit?.zoneMovementLog?._suppressIds?.add(tok.document.id);

  const launchPoint = {
    x: startX + vec.ux * vec.runIn,
    y: startY + vec.uy * vec.runIn,
  };

  // Resolved before openEffect rather than beside the stretch below, because a
  // fly-through style calls openEffect *first* and the closure would otherwise
  // hit the temporal dead zone on it.
  const stretchCfg = getWarpStretchConfig(style);

  const openEffect = () => {
    // Flash at the far tip of the smear — the bow, opposite its stern anchor —
    // so the ship punches into the burst. Read at call time, when the stretch
    // that owns the hull length is already running. Zero for a rift, which does
    // not smear, and for a style whose flash opens before the stretch starts.
    const tipOut = getWarpStretchTipOffset(tok, {
      max: stretchCfg?.max, anchor: "stern", dir: { x: vec.ux, y: vec.uy },
    });
    const launchCentre = { x: launchPoint.x + halfW, y: launchPoint.y + halfH };
    const flashPoint = { x: launchCentre.x + tipOut.x, y: launchCentre.y + tipOut.y };

    playWarpFlash(tok, "depart", {
      heading: vec.heading,
      x: flashPoint.x,
      y: flashPoint.y,
      soundKey: "sndWarpEngage",
      styleId: style.id,
    });
    // Corridor runs off the edge of the map — the ship is leaving, not arriving.
    // A rift skips it: the ship flies through a portal rather than streaking out.
    // It starts at the flash so the two read as one event, unless the bow tip has
    // already overshot the exit point, in which case fall back to the centre.
    if (style.corridor) {
      const exit = { x: destX + halfW, y: destY + halfH };
      const span = (exit.x - flashPoint.x) * vec.ux + (exit.y - flashPoint.y) * vec.uy;
      playWarpCorridor(
        span > (canvas?.grid?.size ?? 100) ? flashPoint : launchCentre,
        exit,
        { width: Math.max(halfW, halfH) }
      );
    }
  };

  // A fly-through style opens its aperture ahead of the ship first, then flies
  // the ship into it over the whole opening window, so the ship crosses the
  // threshold exactly as the effect peaks. The standard warp keeps its original
  // order: short lurch, then flash where it stopped.
  const approachMs = style.transit.inMs ?? Math.max(200, peakMs - WARP_FADE_OUT_MS);
  // Hoisted above the approach because the hull smear has to span the same
  // window the departure hold does — see the clamp it feeds below.
  const sinceEffectOpened = style.transit.flyThrough && vec.runIn > 0 ? approachMs : 0;

  if (style.transit.flyThrough) openEffect();

  // Same wind-up as an engage jump: full smear exactly as alpha reaches 0 at the
  // peak, spanning the approach and the hold that follows it, anchored at the
  // trailing end so the bow tears off the map. stretchCfg is resolved up by
  // openEffect; it is null for a rift, so a timeship leaves undeformed.
  const stretch = stretchCfg
    ? broadcastWarpStretch(tok, {
        from: 1, to: stretchCfg.max, squeeze: stretchCfg.squeeze,
        durationMs: (vec.runIn > 0 ? approachMs : 0)
          + Math.max(0, peakMs - WARP_FADE_OUT_MS - sinceEffectOpened)
          + WARP_FADE_OUT_MS,
        easing: "in",
        anchor: "stern", dir: { x: vec.ux, y: vec.uy },
      })
    : null;

  // Everything up to the ship being gone runs under a finally, so a throw in the
  // approach or the fade can never leave the hull smeared on the map.
  try {
    if (vec.runIn > 0) {
      await tok.document.update(
        { x: launchPoint.x, y: launchPoint.y },
        _scriptedGlideOptions(approachMs, "easeInCircle")
      );
      await new Promise(r => setTimeout(r, approachMs));
    }

    if (!style.transit.flyThrough) openEffect();

    // Ship gone exactly at the clip's peak frame, glow popping out with it. When
    // the approach already ran under the effect it has consumed this hold, so the
    // clamp lands on zero rather than double-counting it.
    await new Promise(r => setTimeout(r, Math.max(0, peakMs - WARP_FADE_OUT_MS - sinceEffectOpened)));
    chargeGlow?.stop?.();
    await tok.document.update({ alpha: 0 }, { animate: true, animation: { duration: WARP_FADE_OUT_MS } });
    await new Promise(r => setTimeout(r, Math.max(0, departMs - peakMs)));
  } finally {
    stretch?.stop?.();
  }

  game.sta2eToolkit?.zoneMovementLog?._suppressIds?.delete(tok.document.id);
  try {
    await tok.document.delete();
  } catch (err) {
    // Deletion failed — don't strand an invisible ship on the map.
    console.error("STA2e | warp flee delete failed:", err);
    try { await tok.document.update({ alpha: 1 }); } catch { /**/ }
    throw err;
  }
}

