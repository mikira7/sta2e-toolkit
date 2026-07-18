/**
 * Destination prompts and ship movement card runners for the STA2e combat HUD.
 */

import { getStationOfficers } from "../crew-manifest.js";
import { spawnEngineTrail } from "../engine-trail-vfx.js";
import { getSceneZones, getZonePathWithCosts } from "../zone-data.js";

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
const ACTION_TRAIL_STEP_MS = 60;
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
      { x: p.x, y: p.y, rotation: p.rotation },
      _scriptedStepOptions(STEP_MS)
    );
    await new Promise(r => setTimeout(r, STEP_MS));
  }

  const finalAngle = Math.atan2(finalDestination.y - startPos.y, finalDestination.x - startPos.x) * (180 / Math.PI) - 90;
  await tok.document.update({ x: finalDestination.x, y: finalDestination.y, rotation: finalAngle });
  await new Promise(r => setTimeout(r, _distanceTrailTailMs(startPos, finalDestination)));
  trail?.stop?.();

  // Lift suppression and post a single zone movement log for the full move.
  game.sta2eToolkit?.zoneMovementLog?._suppressIds?.delete(tok.document.id);
  game.sta2eToolkit?.zoneMovementLog?.onTokenMove(
    tok.document, startOrigin,
    { x: finalDestination.x, y: finalDestination.y }
  );

}

export async function runWarpEngageCard(payload, destination) {
  const tok = getCardShipToken(payload);
  const warpSound = game.settings.get("sta2e-toolkit", "sndWarpEngage") ?? "";
  const startPosition = { x: tok.x, y: tok.y };
  const startOrigin = tok.center ?? { x: tok.x + tok.w / 2, y: tok.y + tok.h / 2 };
  const finalDestination = normalizeShipDestination(tok, destination);
  let targetRotation = tok.document.rotation || 0;

  // Suppress per-step zone log chat cards during the stepped flight; one card
  // is posted manually after the final position update (same as impulse).
  game.sta2eToolkit?.zoneMovementLog?._suppressIds?.add(tok.document.id);

  try {
    const angle = Math.atan2(finalDestination.y - startPosition.y, finalDestination.x - startPosition.x) * (180 / Math.PI);
    targetRotation = angle - 90;
    const orig  = tok.document.rotation || 0;
    const delta = ((targetRotation - orig + 540) % 360) - 180;
    const steps = 15;
    for (let i = 1; i <= steps; i++) {
      await tok.document.update({ rotation: orig + (delta / steps * i) });
      await new Promise(r => setTimeout(r, 20));
    }
    await tok.document.update({ rotation: targetRotation });
  } catch(e) { console.warn("STA2e | warp rotate:", e); }

  try {
    if (window.Sequence) {
      new window.Sequence().effect().atLocation(tok).scale(0.7).fadeIn(200).fadeOut(300).play();
      if (warpSound) new window.Sequence().sound().file(warpSound).volume(0.8).play();
    }
  } catch(e) { console.warn("STA2e | warp flash:", e); }
  await new Promise(r => setTimeout(r, 1000));

  const trail = broadcastEngineTrail(tok, "warp", {
    emitDuration: ACTION_ENGINE_TRAIL_MAX_MS,
    drift: false,
  });
  const warpTravelMs = _distanceDurationMs(startPosition, finalDestination, {
    base: 700,
    perSquare: 120,
    min: 900,
    max: 4200,
  });
  const warpSteps = Math.round(_clampNumber(warpTravelMs / ACTION_TRAIL_STEP_MS, 8, 48));
  const warpStepMs = Math.max(16, Math.round(warpTravelMs / warpSteps));
  for (let i = 1; i <= warpSteps; i++) {
    const t = i / warpSteps;
    await tok.document.update({
      x: startPosition.x + (finalDestination.x - startPosition.x) * t,
      y: startPosition.y + (finalDestination.y - startPosition.y) * t,
      rotation: targetRotation,
    }, _scriptedStepOptions(warpStepMs));
    await new Promise(r => setTimeout(r, warpStepMs));
  }
  await tok.document.update({ x: finalDestination.x, y: finalDestination.y });
  await new Promise(r => setTimeout(r, _distanceTrailTailMs(startPosition, finalDestination)));
  trail?.stop?.();

  // Lift suppression and post a single zone movement log for the full move.
  game.sta2eToolkit?.zoneMovementLog?._suppressIds?.delete(tok.document.id);
  game.sta2eToolkit?.zoneMovementLog?.onTokenMove(
    tok.document, startOrigin,
    { x: finalDestination.x, y: finalDestination.y }
  );

  try {
    if (window.Sequence) {
      new window.Sequence().effect().atLocation(tok).scale(0.7).fadeIn(200).fadeOut(300).play();
    }
  } catch(e) { console.warn("STA2e | warp exit:", e); }
  await new Promise(r => setTimeout(r, 300));
  await tok.document.update({ alpha: 1 });

}

export async function runWarpFleeCard(payload) {
  const tok = getCardShipToken(payload);
  const warpSound = game.settings.get("sta2e-toolkit", "sndWarpEngage") ?? "";

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
  try {
    const angle = Math.atan2(destY - tok.y, destX - tok.x) * (180 / Math.PI);
    targetRotation = angle - 90;
    const orig  = tok.document.rotation || 0;
    const delta = ((targetRotation - orig + 540) % 360) - 180;
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await tok.document.update({ rotation: orig + (delta / steps * i) });
      await new Promise(r => setTimeout(r, 20));
    }
    await tok.document.update({ rotation: targetRotation });
  } catch(e) { console.warn("STA2e | warp-flee rotate:", e); }

  try {
    if (warpSound && window.Sequence) {
      new window.Sequence().sound().file(warpSound).volume(0.8).play();
    }
  } catch(e) { console.warn("STA2e | warp-flee flash:", e); }
  await new Promise(r => setTimeout(r, 600));

  const startX = tok.x;
  const startY = tok.y;
  const fleeTravelMs = _distanceDurationMs({ x: startX, y: startY }, { x: destX, y: destY }, {
    base: 650,
    perSquare: 100,
    min: 700,
    max: 3600,
  });
  const steps = Math.round(_clampNumber(fleeTravelMs / ACTION_TRAIL_STEP_MS, 6, 40));
  const MOVE_STEP_MS = Math.max(16, Math.round(fleeTravelMs / steps));
  const dxStep = (destX - startX) / steps;
  const dyStep = (destY - startY) / steps;
  const trail = broadcastEngineTrail(tok, "warp", {
    emitDuration: ACTION_ENGINE_TRAIL_MAX_MS,
    drift: false,
  });
  // No zone log for a ship leaving the map — suppress cards during the flight.
  game.sta2eToolkit?.zoneMovementLog?._suppressIds?.add(tok.document.id);
  for (let i = 1; i <= steps; i++) {
    const alpha = Math.max(0, 1 - i / steps);
    await tok.document.update(
      { x: startX + dxStep * i, y: startY + dyStep * i, alpha },
      _scriptedStepOptions(MOVE_STEP_MS)
    );
    await new Promise(r => setTimeout(r, MOVE_STEP_MS));
  }

  await new Promise(r => setTimeout(r, _distanceTrailTailMs({ x: startX, y: startY }, { x: destX, y: destY })));
  trail?.stop?.();
  game.sta2eToolkit?.zoneMovementLog?._suppressIds?.delete(tok.document.id);
  await tok.document.delete();
}

