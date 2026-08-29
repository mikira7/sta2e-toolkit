/**
 * sta2e-toolkit | q-vfx.js
 *
 * What it looks like when Q decides you are somewhere else now.
 *
 * Two pieces stack: the module's warp flash run through a desaturate (the
 * `qFlash` style in warp-effect-styles.js) at each token, and a white flash
 * across the whole board. The screen flash is the part that sells it — a
 * transporter is a local event, a Q snap interrupts everything.
 *
 * ── Why the screen flash is DOM and not PIXI ──
 * It began as a PIXI rect over the scene rect on the token layer, and that is
 * the wrong place twice over: lighting, weather and overhead tiles composite on
 * top of it, and it stops at the scene edge when the view is zoomed out. A DOM
 * overlay sibling to the board canvas sits above every canvas layer, fills the
 * viewport at any zoom, and still passes under Foundry's UI chrome.
 *
 * ── Broadcast ──
 * The screen flash is client-local and the spawn runners execute only on the
 * GM, so it plays locally *and* emits, the same arrangement warp-jump-vfx.js
 * and engine-trail-vfx.js use. The per-token bursts need nothing extra:
 * playWarpFlash already emits its own socket message.
 *
 * ── Timing ──
 * Every wait here comes from getWarpFlashTiming("qFlash"), never the WARP_*_MS
 * constants — those are the standard style's numbers, and the Q flash is
 * deliberately much faster.
 *
 * Public API:
 *   playQSceneFlash()                     // local draw + broadcast
 *   playNativeQSceneFlash()               // socket receiver
 *   await qSnapIn(token)                  // flash, then fade up
 *   await qSnapOut(token)                 // flash, then fade out (caller deletes)
 *   await qFlashMove(tokens, delta)       // flash out, teleport, flash in
 *   await qFlashKick(tokens, heading)     // flash behind, then hurled away spinning
 */

import { playWarpFlash } from "./warp-jump-vfx.js";
import { getWarpFlashTiming } from "./warp-effect-styles.js";

const MODULE   = "sta2e-toolkit";
export const Q_STYLE_ID = "qFlash";

/** Q's light is white. Used for the wash and for the placement indicator. */
export const Q_COLOR = 0xffffff;
const Q_COLOR_CSS = "#ffffff";

const SCREEN_FLASH_ID = "sta2e-q-screen-flash";

/** Defaults for the two GM-tunable screen-flash settings. */
const WASH_PEAK_PCT_DEFAULT = 75;
const WASH_MS_DEFAULT       = 500;

/**
 * How the wash divides its total duration: a fast rise, a beat at full white,
 * then a slower falloff. A blink, not a fade to white. Sums to 1.
 */
const WASH_UP_FRAC   = 0.24;
const WASH_HOLD_FRAC = 0.12;
const WASH_DOWN_FRAC = 0.64;

/** How long a token takes to fade out of / into existence around the flash. */
const Q_FADE_MS = 200;

// ── Kick ──────────────────────────────────────────────────────────────────────

/** Defaults for the two GM-tunable kick settings. */
const KICK_MS_DEFAULT    = 2600;
const KICK_SPINS_DEFAULT = 3;

/**
 * Waypoint interval, matching the impulse glide in ship-card-movement.js. Each
 * step is a document.update — a server round-trip that fires updateToken on
 * every client — so they stay coarse and Foundry tweens between them.
 */
const KICK_STEP_MS = 60;

/**
 * Foundry tweens rotation along the *shortest* path between two values, so a
 * step that advances more than half a turn visibly spins backwards. The spin
 * rate is clamped against the step count to keep every increment under this.
 */
const MAX_STEP_DEGREES = 150;

/** How faint it gets at the far end of the tumble before settling back. */
const KICK_MIN_ALPHA = 0.15;

/** Keep the landing point this far inside the scene edge, in grid units. */
const KICK_EDGE_MARGIN = 0.5;

/**
 * Options for an intermediate waypoint of a scripted move.
 *
 * Mirrors _scriptedStepOptions in combat/ship-card-movement.js rather than
 * importing it: the flag name is the contract (main.js skips zone BFS, cover
 * and movement-log work for flagged waypoints and runs them once on the final
 * unflagged update), and a generic token kick has no business reaching into
 * ship movement internals for four lines.
 */
function _kickStepOptions(durationMs) {
  return {
    animate: true,
    sta2eScriptedMove: true,
    animation: { duration: durationMs, easing: "linear" },
  };
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const _wait = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

function _num(settingKey, fallback) {
  try {
    const v = Number(game.settings.get(MODULE, settingKey));
    return Number.isFinite(v) ? v : fallback;
  } catch { return fallback; }   // setting not registered yet
}

/** Timing for the Q flash, resolved through the GM's peak setting. */
export function qFlashTiming() {
  return getWarpFlashTiming(Q_STYLE_ID);
}

function _tokenCentre(token) {
  const grid = canvas?.grid?.size ?? 100;
  const w = (token?.document?.width  ?? 1) * grid;
  const h = (token?.document?.height ?? 1) * grid;
  return {
    x: token?.center?.x ?? ((token?.x ?? 0) + w / 2),
    y: token?.center?.y ?? ((token?.y ?? 0) + h / 2),
  };
}

// ── The scene flash ───────────────────────────────────────────────────────────

/**
 * Where the overlay goes: as a sibling directly after the board canvas.
 *
 * That puts it in the canvas's own stacking context, above every canvas layer —
 * lighting, weather, overhead tiles, the lot — while still sitting below
 * Foundry's UI chrome, so the sidebar and hotbar stay readable through a flash.
 * Anything drawn *inside* the canvas cannot manage that: the token layer, where
 * this used to live, is composited under lighting and foreground tiles.
 *
 * @returns {{parent: HTMLElement, positioned: boolean}|null}
 */
function _screenFlashHost() {
  const board  = document.getElementById("board");
  const parent = board?.parentElement;
  if (!parent) return null;
  // `inset: 0` only means "the board area" if the parent establishes the
  // containing block; otherwise fall back to fixed coordinates off the board.
  let positioned = false;
  try { positioned = getComputedStyle(parent).position !== "static"; } catch { /**/ }
  return { parent, positioned };
}

/**
 * Wash the board white on this client only. The socket receiver and the local
 * call both land here.
 *
 * A DOM overlay rather than a PIXI object: it covers the whole viewport at any
 * zoom, is immune to what the canvas is doing underneath it, and cannot be
 * dimmed by scene lighting. Peak opacity and duration are GM settings, and an
 * intensity of 0 turns it off without touching the per-token bursts.
 */
export function playNativeQSceneFlash() {
  const peak = Math.max(0, Math.min(100, _num("qScreenFlashIntensity", WASH_PEAK_PCT_DEFAULT))) / 100;
  if (peak <= 0) return;   // switched off — the token flashes still play

  const totalMs = Math.max(80, Math.min(5000, _num("qScreenFlashMs", WASH_MS_DEFAULT)));
  const upMs    = Math.round(totalMs * WASH_UP_FRAC);
  const holdMs  = Math.round(totalMs * WASH_HOLD_FRAC);
  const downMs  = Math.round(totalMs * WASH_DOWN_FRAC);

  const host = _screenFlashHost();
  if (!host) return;

  try {
    // A second flash landing on the first restarts it rather than stacking two
    // overlays — two washes at 75% would read as one at 94%.
    document.getElementById(SCREEN_FLASH_ID)?.remove();

    const el = document.createElement("div");
    el.id = SCREEN_FLASH_ID;
    const board = document.getElementById("board");
    const rect  = host.positioned ? null : board?.getBoundingClientRect();
    el.style.cssText = host.positioned
      ? `position:absolute;inset:0;`
      : `position:fixed;left:${rect?.left ?? 0}px;top:${rect?.top ?? 0}px;` +
        `width:${rect?.width ?? 0}px;height:${rect?.height ?? 0}px;`;
    el.style.cssText += `background:${Q_COLOR_CSS};opacity:0;pointer-events:none;`
      + `will-change:opacity;z-index:1;`;
    host.parent.appendChild(el);

    // A CSS transition rather than animejs: the target is a DOM element, this
    // needs no library present, and the compositor drives the opacity.
    el.style.transition = `opacity ${upMs}ms ease-out`;
    void el.offsetWidth;              // commit opacity:0 before transitioning off it
    el.style.opacity = String(peak);

    setTimeout(() => {
      el.style.transition = `opacity ${downMs}ms ease-in`;
      el.style.opacity = "0";
    }, upMs + holdMs);

    setTimeout(() => { try { el.remove(); } catch { /**/ } }, totalMs + 200);
  } catch (err) {
    console.warn("STA2e Toolkit | Q screen flash failed:", err);
  }
}

/** Wash this client and every other one viewing the same scene. */
export function playQSceneFlash() {
  playNativeQSceneFlash();
  try {
    game.socket.emit(`module.${MODULE}`, {
      action:  "qSceneFlashVfx",
      sceneId: canvas?.scene?.id ?? null,
    });
  } catch { /* cosmetic — never block the snap */ }
}

// ── Composed sequences ────────────────────────────────────────────────────────

/**
 * Materialise a token on the flash's peak frame.
 * The token is expected to already exist at alpha 0.
 */
export async function qSnapIn(token) {
  if (!token) return;
  const { peakMs, arriveMs } = qFlashTiming();
  const { x, y } = _tokenCentre(token);

  playWarpFlash(token, "arrive", { styleId: Q_STYLE_ID, x, y });
  await _wait(peakMs - Q_FADE_MS);
  try {
    await token.document.update({ alpha: 1 }, { animate: true, animation: { duration: Q_FADE_MS } });
  } catch (err) {
    console.warn(`STA2e Toolkit | Q snap-in fade failed for ${token.name}:`, err);
  }
  await _wait(arriveMs - peakMs);
}

/**
 * Dematerialise a token on the flash's peak frame. Deleting it afterwards is
 * the caller's business — the buffer snapshot has to be taken first.
 */
export async function qSnapOut(token) {
  if (!token) return;
  const { peakMs, departMs } = qFlashTiming();
  const { x, y } = _tokenCentre(token);

  playWarpFlash(token, "depart", { styleId: Q_STYLE_ID, x, y });
  await _wait(peakMs - Q_FADE_MS);
  try {
    await token.document.update({ alpha: 0 }, { animate: true, animation: { duration: Q_FADE_MS } });
  } catch (err) {
    console.warn(`STA2e Toolkit | Q snap-out fade failed for ${token.name}:`, err);
  }
  await _wait(departMs - peakMs);
}

/**
 * Move a group of tokens by one offset — vanish here, appear there.
 *
 * Same ordering as the in-scene warp jump (flash → fade → teleport → flash →
 * fade), with the run-up glide and the corridor stripped out: Q does not
 * travel. Every token runs the sequence at once rather than in turn, because a
 * group moved by a snap of the fingers moves together.
 *
 * @param {Token[]} tokens
 * @param {{x:number, y:number}} delta  Canvas-pixel offset applied to each
 */
export async function qFlashMove(tokens, delta) {
  const list = (tokens ?? []).filter(Boolean);
  if (!list.length || !delta) return 0;

  const { peakMs, departMs, arriveMs } = qFlashTiming();

  playQSceneFlash();

  const moveOne = async token => {
    const from = _tokenCentre(token);

    playWarpFlash(token, "depart", { styleId: Q_STYLE_ID, x: from.x, y: from.y });
    await _wait(peakMs - Q_FADE_MS);
    await token.document.update({ alpha: 0 }, { animate: true, animation: { duration: Q_FADE_MS } });
    await _wait(departMs - peakMs);

    // teleport:true suppresses the move animation; sta2eScriptedMove marks it
    // as ours, the same flag the warp runners set.
    await token.document.update(
      { x: token.document.x + delta.x, y: token.document.y + delta.y },
      { animate: false, teleport: true, sta2eScriptedMove: true }
    );

    const to = { x: from.x + delta.x, y: from.y + delta.y };
    playWarpFlash(token, "arrive", { styleId: Q_STYLE_ID, x: to.x, y: to.y });
    await _wait(peakMs - Q_FADE_MS);
    await token.document.update({ alpha: 1 }, { animate: true, animation: { duration: Q_FADE_MS } });
    await _wait(arriveMs - peakMs);
  };

  const results = await Promise.allSettled(list.map(moveOne));
  let moved = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") { moved++; return; }
    console.error(`STA2e Toolkit | Q flash move failed for ${list[i]?.name}:`, r.reason);
  });

  // A token left invisible by a failure mid-sequence is worse than one that
  // did not move, so put every alpha back regardless of what went wrong.
  await Promise.allSettled(list.map(t =>
    t.document.alpha === 1 ? null : t.document.update({ alpha: 1 })));

  return moved;
}

// ── Kick ──────────────────────────────────────────────────────────────────────

/**
 * The furthest this token can travel along `heading` and still sit inside the
 * scene, as a distance in pixels from its current centre.
 *
 * "A long way in that direction" is exactly the scene edge — which is why the
 * kick has no distance setting. Walks the four boundaries rather than stepping,
 * so an oblique heading lands hard against whichever edge it meets first.
 */
function _kickDistance(token, headingRad) {
  const grid = canvas?.grid?.size ?? 100;
  const rect = canvas?.dimensions?.sceneRect;
  const from = _tokenCentre(token);
  if (!rect) return grid * 20;

  const halfW = ((token.document.width  ?? 1) * grid) / 2;
  const halfH = ((token.document.height ?? 1) * grid) / 2;
  const pad   = grid * KICK_EDGE_MARGIN;

  // The box the token's *centre* may end up in, so its footprint stays inside.
  const minX = rect.x + halfW + pad;
  const maxX = rect.x + rect.width  - halfW - pad;
  const minY = rect.y + halfH + pad;
  const maxY = rect.y + rect.height - halfH - pad;
  if (minX > maxX || minY > maxY) return 0;   // scene smaller than the token

  const ux = Math.cos(headingRad);
  const uy = Math.sin(headingRad);

  // Distance to each bounding plane the heading actually points at.
  const limits = [];
  if (Math.abs(ux) > 1e-6) limits.push(((ux > 0 ? maxX : minX) - from.x) / ux);
  if (Math.abs(uy) > 1e-6) limits.push(((uy > 0 ? maxY : minY) - from.y) / uy);

  const reach = limits.length ? Math.min(...limits) : 0;
  return Math.max(0, reach);
}

/**
 * Q boots a token across the scene.
 *
 * The flash fires on the far side of the token from its direction of travel —
 * the point Q kicked from — and the token lurches away from it, tumbling and
 * fading as it recedes, before settling a long way off. It stays on the scene:
 * you pan to find it.
 *
 * The flight is a hard snap then a long drift, a quartic ease-out, so most of
 * the distance is gone in the first quarter of the time.
 *
 * No socket action: the slide, the spin and the fade are all document updates,
 * which Foundry replicates to every client on its own. Only the flash and the
 * screen wash need broadcasting, and both do that themselves.
 *
 * @param {Token[]} tokens
 * @param {number}  headingRad  Canvas bearing to kick along
 * @returns {Promise<number>}   How many actually flew
 */
export async function qFlashKick(tokens, headingRad) {
  const list = (tokens ?? []).filter(Boolean);
  if (!list.length || !Number.isFinite(headingRad)) return 0;

  const totalMs = Math.max(400, Math.min(10000, _num("qKickMs", KICK_MS_DEFAULT)));
  const steps   = Math.max(4, Math.round(totalMs / KICK_STEP_MS));

  // Clamp the spin so no single step turns more than half a circle — past that
  // Foundry's shortest-path tween runs the rotation backwards. Floored to whole
  // turns as well, so the tumble ends on the facing it started from and the
  // last step has nothing to correct.
  const wanted = Math.max(0, Math.min(20, _num("qKickSpins", KICK_SPINS_DEFAULT)));
  const spins  = Math.max(0, Math.floor(Math.min(wanted, (steps * MAX_STEP_DEGREES) / 360)));
  const degPerStep = (spins * 360) / steps;

  const { peakMs } = qFlashTiming();
  const ux = Math.cos(headingRad);
  const uy = Math.sin(headingRad);

  playQSceneFlash();

  const kickOne = async token => {
    const start    = { x: token.document.x, y: token.document.y };
    const rotation = token.document.rotation ?? 0;
    const alpha0   = token.document.alpha ?? 1;
    const grid     = canvas?.grid?.size ?? 100;
    const halfW    = ((token.document.width  ?? 1) * grid) / 2;
    const halfH    = ((token.document.height ?? 1) * grid) / 2;
    const distance = _kickDistance(token, headingRad);

    // The flash sits behind the token — where the kick landed, not on top of it.
    const centre = _tokenCentre(token);
    const behind = Math.max(halfW, halfH) + grid * 0.35;
    playWarpFlash(token, "depart", {
      styleId: Q_STYLE_ID,
      x: centre.x - ux * behind,
      y: centre.y - uy * behind,
    });

    // Let the burst reach its decisive frame before anything moves, so the
    // token is struck by the light rather than leaving ahead of it.
    await _wait(peakMs * 0.6);

    for (let i = 1; i <= steps; i++) {
      const t    = i / steps;
      const eased = 1 - Math.pow(1 - t, 4);          // hard snap, long drift
      const spin  = (rotation + degPerStep * i) % 360;
      // Fades out as it recedes, then comes back up over the last few steps —
      // it is still on the scene, so leaving it invisible would be a bug.
      const alpha = t < 0.8
        ? alpha0 - (alpha0 - KICK_MIN_ALPHA) * (t / 0.8)
        : KICK_MIN_ALPHA + (alpha0 - KICK_MIN_ALPHA) * ((t - 0.8) / 0.2);

      const last = i === steps;
      const update = {
        x: start.x + ux * distance * eased,
        y: start.y + uy * distance * eased,
        // The spin is theatre, not a change of facing: a crew token must not
        // end up lying on its side, so the last step lands on where it started.
        rotation: last ? rotation : spin,
        alpha:    last ? alpha0 : alpha,
      };

      // The final update deliberately drops sta2eScriptedMove so the zone BFS,
      // cover and movement-log work all run exactly once, at the landing point.
      //
      // The update and the beat run together rather than in sequence: the write
      // resolves on the server's acknowledgement, not on the animation, so
      // awaiting them one after the other would make every step cost a round
      // trip *plus* the interval and stretch the flight well past its setting.
      // Both are still awaited before the next step, so ordering holds.
      await Promise.all([
        token.document.update(
          update,
          last
            ? { animate: true, animation: { duration: KICK_STEP_MS, easing: "linear" } }
            : _kickStepOptions(KICK_STEP_MS)
        ),
        _wait(KICK_STEP_MS),
      ]);
    }
  };

  const results = await Promise.allSettled(list.map(kickOne));
  let kicked = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") { kicked++; return; }
    console.error(`STA2e Toolkit | Q kick failed for ${list[i]?.name}:`, r.reason);
  });

  // A token left part-way through the tumble is worse than one that did not
  // move, so settle every alpha regardless of what went wrong.
  await Promise.allSettled(list.map(t =>
    (t.document.alpha ?? 1) === 1 ? null : t.document.update({ alpha: 1 })));

  return kicked;
}
