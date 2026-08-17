/**
 * sta2e-toolkit | ship-spawner.js
 *
 * GM-only fleet spawner. Drag ship actors into the queue, pick a formation, then
 * place it on the canvas — the ships warp in using the module's own warp arrival
 * (flash, fade, decelerating glide), the same one a Warp Jump lands with.
 *
 * Two things drive facing:
 *   • a targeted token — the fleet forms up facing it, and a circle rings it;
 *   • otherwise a drag-to-aim arrow, so the GM sets the heading by hand.
 *
 * Placement runs entirely on the GM client, like the transporter. The arrival
 * VFX broadcasts itself (playWarpFlash / broadcastEngineTrail), so no socket
 * action is needed here.
 */

import { getLcCssVars, getLcTokens } from "./lcars-theme.js";
import { SPAWN_PATTERNS, GEOMETRIC_PATTERNS, calcSpawnOffsets, scatterMaxRadius } from "./spawn-patterns.js";
import { buildSpawnTokenData, protoHalfSize } from "./token-spawn-utils.js";
import { runShipWarpArrival } from "./combat/ship-card-movement.js";
import { getShipWarpEffectStyle } from "./warp-effect-styles.js";

const MODULE   = "sta2e-toolkit";
const DIALOG_ID = "sta2e-ship-spawner";
const OVERLAY_ID = "sta2e-spawner-overlay";

/** Starfleet can only keep track of so many contacts at once. */
const MAX_SHIPS       = 24;
const MAX_PER_ACTOR   = 20;
const INDICATOR_COLOR = 0x66bbff;

const DEG = 180 / Math.PI;

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                 "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/**
 * The queue survives a cancelled placement — aborting on the canvas should not
 * cost the GM the fleet they just assembled. Cleared only on a successful spawn.
 */
let _queue = [];

// ── Preferences ───────────────────────────────────────────────────────────────

const PREF_DEFAULTS = { pattern: "circle", spacing: 350, snap: true, delay: 300 };

function getPrefs() {
  try {
    return { ...PREF_DEFAULTS, ...(game.settings.get(MODULE, "shipSpawnerPrefs") ?? {}) };
  } catch { return { ...PREF_DEFAULTS }; }
}

function setPrefs(prefs) {
  try { game.settings.set(MODULE, "shipSpawnerPrefs", { ...getPrefs(), ...prefs }); }
  catch { /* setting not registered — prefs simply do not persist */ }
}

// ── PIXI drawing shims ────────────────────────────────────────────────────────
// Foundry v14 ships PIXI v8, where fill/stroke come AFTER the shape call and
// drawCircle/drawPolygon are gone. Same approach as warp-jump-vfx.js.

const _hasLegacy = g => typeof g.lineStyle === "function";

/** Run `draw` as a stroked path under either API. */
function _stroked(g, { width, color, alpha }, draw) {
  if (_hasLegacy(g)) { g.lineStyle(width, color, alpha); draw(g); g.lineStyle(0); }
  else { draw(g); g.stroke({ width, color, alpha }); }
}

/** Run `draw` as a filled shape under either API. */
function _filled(g, { color, alpha }, draw) {
  if (_hasLegacy(g)) { g.beginFill(color, alpha); draw(g); g.endFill(); }
  else { draw(g); g.fill({ color, alpha }); }
}

const _circle = (g, x, y, r) => (typeof g.drawCircle === "function" ? g.drawCircle(x, y, r) : g.circle(x, y, r));
const _poly   = (g, pts)     => (typeof g.drawPolygon === "function" ? g.drawPolygon(pts) : g.poly(pts));

/** Ten dashes at a 4:1 dash-to-gap ratio, scaled correctly at any radius. */
function _dashedCircle(g, cx, cy, radius) {
  if (radius <= 0) return;
  const DASHES  = 10;
  const period  = (2 * Math.PI) / DASHES;
  const dashArc = period * 0.8;
  for (let i = 0; i < DASHES; i++) {
    const start = i * period;
    g.moveTo(cx + radius * Math.cos(start), cy + radius * Math.sin(start));
    g.arc(cx, cy, radius, start, start + dashArc);
  }
}

function _crosshair(g, cx, cy, size = 8) {
  g.moveTo(cx - size, cy); g.lineTo(cx + size, cy);
  g.moveTo(cx, cy - size); g.lineTo(cx, cy + size);
}

function _createIndicator() {
  const g = new PIXI.Graphics();
  (canvas?.interface ?? canvas?.stage)?.addChild(g);
  return g;
}

function _destroyIndicator(g) {
  if (!g) return;
  try {
    g.clear();
    g.parent?.removeChild(g);
    g.destroy();
  } catch { /* canvas may have been torn down mid-pick */ }
}

function _cursor() {
  return canvas?.mousePosition ?? { x: 0, y: 0 };
}

// ── Heading helpers ───────────────────────────────────────────────────────────

/**
 * Foundry token rotation for a canvas bearing.
 *
 * Matches ship-card-movement.js: rotation 0 points the bow DOWN, so a ship
 * spawned facing a heading also flies bow-first on its next warp or impulse.
 */
export function bearingToTokenRotation(bearingRad) {
  return bearingRad * DEG - 90;
}

/** "045° · NE" for the aiming readout. Compass north is up on screen. */
function compassLabel(bearingRad) {
  const compassDeg = ((bearingRad * DEG + 90) % 360 + 360) % 360;
  const point = COMPASS[Math.round(compassDeg / 22.5) % 16];
  return `${String(Math.round(compassDeg)).padStart(3, "0")}° · ${point}`;
}

// ── Queue ─────────────────────────────────────────────────────────────────────

/** Flatten the queue to one entry per token that will actually be created. */
function expandQueue() {
  const out = [];
  // The queue holds live Actor references across dialog opens, so an actor
  // deleted in between would otherwise blow up mid-placement.
  const stale = _queue.filter(e => !game.actors.get(e.actor?.id));
  if (stale.length) {
    _queue = _queue.filter(e => !stale.includes(e));
    ui.notifications.warn(`Removed ${stale.length} deleted actor(s) from the queue.`);
  }

  for (const entry of _queue) {
    const count = entry.isLinked ? 1 : entry.quantity;
    for (let i = 0; i < count; i++) {
      const { halfW, halfH } = protoHalfSize(entry.actor);
      out.push({
        actor: entry.actor,
        displayName: count > 1 ? `${entry.name} ${i + 1}` : entry.name,
        halfW,
        halfH,
        // A ring slightly inside the footprint reads better than one exactly on
        // it, and a hard floor keeps 0.5-size shuttles visible.
        radius: Math.max(Math.max(halfW, halfH) * 0.9, 20),
      });
    }
  }
  return out;
}

function queueTotal() {
  return _queue.reduce((sum, e) => sum + (e.isLinked ? 1 : e.quantity), 0);
}

// ── Canvas picker ─────────────────────────────────────────────────────────────

/**
 * Draw the formation as it will actually be placed.
 * Scatter is drawn as its containing ring instead — its positions are re-rolled
 * at spawn time, so per-ship rings there would be a lie.
 */
function drawFormation(g, cx, cy, slots, pattern, spacing, headingRad) {
  if (pattern === "scatter") {
    _stroked(g, { width: 1, color: INDICATOR_COLOR, alpha: 0.35 },
      gg => _dashedCircle(gg, cx, cy, scatterMaxRadius(slots.length)));
  } else {
    const offsets = calcSpawnOffsets(pattern, slots.length, spacing, { headingRad });
    _stroked(g, { width: 2, color: INDICATOR_COLOR, alpha: 0.85 }, gg => {
      offsets.forEach((o, i) => _dashedCircle(gg, cx + o.x, cy + o.y, slots[i]?.radius ?? 25));
    });
  }
  _stroked(g, { width: 1, color: INDICATOR_COLOR, alpha: 0.4 }, gg => _crosshair(gg, cx, cy));
}

/** Line with a filled arrowhead, from the formation centre out to the cursor. */
function drawHeadingArrow(g, cx, cy, tx, ty) {
  const dx = tx - cx;
  const dy = ty - cy;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(28, Math.max(14, len * 0.18));
  const baseX = tx - ux * head;
  const baseY = ty - uy * head;

  _stroked(g, { width: 3, color: INDICATOR_COLOR, alpha: 0.9 }, gg => {
    gg.moveTo(cx, cy);
    gg.lineTo(baseX, baseY);
  });
  _filled(g, { color: INDICATOR_COLOR, alpha: 0.9 }, gg => {
    const wx = -uy * head * 0.42;
    const wy =  ux * head * 0.42;
    _poly(gg, [tx, ty, baseX + wx, baseY + wy, baseX - wx, baseY - wy]);
  });
}

/**
 * A fixed banner over the canvas. Same shape as promptShipCardDestination's, so
 * the two pickers read as one tool.
 */
function showOverlay(title, subtitle) {
  document.getElementById(OVERLAY_ID)?.remove();
  const LC = getLcTokens();
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = `position:fixed;top:10px;left:50%;transform:translateX(-50%);
    background:rgba(0,0,0,0.75);color:${LC.primary};border:1px solid ${LC.primary};
    padding:6px 18px;border-radius:4px;z-index:999999;
    font-family:${LC.font};text-align:center;pointer-events:none;`;
  overlay.innerHTML = `
    <div data-role="title" style="font-size:13px;font-weight:700;letter-spacing:0.1em;">${title}</div>
    <div data-role="sub" style="font-size:10px;margin-top:2px;">${subtitle}</div>`;
  document.body.appendChild(overlay);
  return {
    setTitle: text => { const el = overlay.querySelector('[data-role="title"]'); if (el) el.textContent = text; },
    remove:   () => overlay.remove(),
  };
}

function setCrosshairCursor(on) {
  const view = canvas?.app?.view;
  const value = on ? "crosshair" : "";
  document.body.style.cursor = value;
  if (view) view.style.cursor = value;
  if (view?.parentElement) view.parentElement.style.cursor = value;
}

/**
 * One canvas click. `onMove(g)` redraws the indicator each frame; the promise
 * resolves with the clicked canvas point, or null on right-click / Escape.
 *
 * `onKey` gets any other keypress, for the [Q] pattern cycle.
 */
function awaitCanvasClick({ onMove, onKey } = {}) {
  return new Promise(resolve => {
    const g = _createIndicator();
    let done = false;

    const redraw = () => {
      if (done) return;
      g.clear();
      try { onMove?.(g); } catch (err) { console.warn("STA2e Toolkit | spawner preview:", err); }
    };
    const cleanup = () => {
      if (done) return;
      done = true;
      canvas.stage.off("mousemove", redraw);
      canvas.stage.off("mousedown", onClick);
      canvas.stage.off("rightdown", onAbort);
      document.removeEventListener("keydown", onKeyDown, true);
      _destroyIndicator(g);
    };
    function onAbort() { cleanup(); resolve(null); }
    function onKeyDown(ev) {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); onAbort(); return; }
      if (onKey?.(ev)) redraw();
    }
    function onClick(ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      cleanup();
      resolve({ ..._cursor() });
    }

    canvas.stage.on("mousemove", redraw);
    canvas.stage.on("mousedown", onClick);
    canvas.stage.on("rightdown", onAbort);
    // Capture phase, so Escape reaches us before Foundry's own handlers close
    // the sheet stack or deselect tokens.
    document.addEventListener("keydown", onKeyDown, true);
    redraw();
  });
}

/**
 * Stage 1 — where the fleet goes.
 * Returns { centre, pattern } (pattern may have been cycled with [Q]), or null.
 *
 * `targetPoint` rotates the preview live toward the target as the cursor moves.
 * Without it the preview would be unrotated while the ships land facing the
 * target, since stage 2 is skipped whenever something is targeted.
 */
async function pickFormationCentre(slots, pattern, spacing, targetPoint = null) {
  let current = pattern;
  const overlay = showOverlay(
    `WARP-IN · ${SPAWN_PATTERNS[current]}`,
    "Click to place the fleet · [Q] cycle pattern · [RMB/Esc] abort"
  );
  setCrosshairCursor(true);
  try {
    const point = await awaitCanvasClick({
      onMove: g => {
        const p = _cursor();
        if (current === "individual") {
          _stroked(g, { width: 2, color: INDICATOR_COLOR, alpha: 0.85 },
            gg => _dashedCircle(gg, p.x, p.y, slots[0]?.radius ?? 25));
          _stroked(g, { width: 1, color: INDICATOR_COLOR, alpha: 0.4 }, gg => _crosshair(gg, p.x, p.y));
        } else {
          const heading = targetPoint
            ? Math.atan2(targetPoint.y - p.y, targetPoint.x - p.x)
            : null;
          drawFormation(g, p.x, p.y, slots, current, spacing, heading);
          if (targetPoint) drawHeadingArrow(g, p.x, p.y, targetPoint.x, targetPoint.y);
        }
      },
      onKey: ev => {
        if (ev.key !== "q" && ev.key !== "Q") return false;
        const cycle = [...GEOMETRIC_PATTERNS, "individual"];
        current = cycle[(cycle.indexOf(current) + 1) % cycle.length];
        overlay.setTitle(`WARP-IN · ${SPAWN_PATTERNS[current]}`);
        return true;
      },
    });
    return point ? { centre: point, pattern: current } : null;
  } finally {
    overlay.remove();
    setCrosshairCursor(false);
  }
}

/**
 * Stage 1, individual mode — one click per ship, with dim ghosts for the ones
 * already placed. Returns an array of centre points, or null.
 */
async function pickIndividualCentres(slots, placedFirst) {
  const centres = placedFirst ? [placedFirst] : [];
  setCrosshairCursor(true);
  try {
    for (let i = centres.length; i < slots.length; i++) {
      const overlay = showOverlay(
        `PLACE · ${slots[i].displayName}`,
        `Ship ${i + 1} of ${slots.length} · [RMB/Esc] abort`
      );
      const point = await awaitCanvasClick({
        onMove: g => {
          _stroked(g, { width: 2, color: INDICATOR_COLOR, alpha: 0.55 }, gg => {
            centres.forEach((c, ci) => _dashedCircle(gg, c.x, c.y, slots[ci].radius));
          });
          _filled(g, { color: INDICATOR_COLOR, alpha: 0.4 }, gg => {
            centres.forEach(c => _circle(gg, c.x, c.y, 5));
          });
          const p = _cursor();
          _stroked(g, { width: 2, color: INDICATOR_COLOR, alpha: 0.85 },
            gg => _dashedCircle(gg, p.x, p.y, slots[i].radius));
          _stroked(g, { width: 1, color: INDICATOR_COLOR, alpha: 0.4 }, gg => _crosshair(gg, p.x, p.y));
        },
      });
      overlay.remove();
      if (!point) return null;
      centres.push(point);
    }
    return centres;
  } finally {
    setCrosshairCursor(false);
  }
}

/**
 * Stage 2 — which way the fleet faces. Skipped by the caller when a token is
 * targeted. Returns the heading in radians (canvas bearing), or null.
 *
 * `preview` redraws the formation at the live heading, so the GM watches the
 * wedge swing round as they aim.
 */
async function pickHeading(centre, preview) {
  const overlay = showOverlay("HEADING · —", "Drag to aim, click to lock facing · [RMB/Esc] abort");
  setCrosshairCursor(true);
  try {
    let heading = null;
    const point = await awaitCanvasClick({
      onMove: g => {
        const p = _cursor();
        heading = Math.atan2(p.y - centre.y, p.x - centre.x);
        preview?.(g, heading);
        drawHeadingArrow(g, centre.x, centre.y, p.x, p.y);
        overlay.setTitle(`HEADING · ${compassLabel(heading)}`);
      },
    });
    if (!point) return null;
    return Math.atan2(point.y - centre.y, point.x - centre.x);
  } finally {
    overlay.remove();
    setCrosshairCursor(false);
  }
}

// ── Spawn ─────────────────────────────────────────────────────────────────────

/** Centre point → snapped top-left for a token of this footprint. */
function centreToTopLeft(centre, halfW, halfH, snap) {
  const desired = { x: centre.x - halfW, y: centre.y - halfH };
  if (!snap) return desired;
  const snapped = canvas.grid?.getSnappedPoint ? canvas.grid.getSnappedPoint(desired, {}) : desired;
  return { x: snapped?.x ?? desired.x, y: snapped?.y ?? desired.y };
}

async function spawnFleet(slots, centres, heading, { snap, delay }) {
  canvas.animatePan({ x: centres[0].x, y: centres[0].y, duration: 1000 });

  let spawned = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot   = slots[i];
    const centre = centres[i] ?? centres[0];
    try {
      const { x, y } = centreToTopLeft(centre, slot.halfW, slot.halfH, snap);
      const data = await buildSpawnTokenData(slot.actor, {
        name: slot.displayName,
        x, y,
        rotation: slot.rotation ?? bearingToTokenRotation(heading),
        alpha: 0,
      });

      const [created] = await canvas.scene.createEmbeddedDocuments("Token", [data]);
      if (!created) throw new Error("Token creation returned nothing.");

      // Let the canvas register the placeable before animating it — the same
      // yield the transporter's beam-in needs.
      await new Promise(r => setTimeout(r, 50));
      const tok = canvas.tokens.get(created.id);
      // Style resolved from the source actor rather than the token: the token
      // was created moments ago and its synthetic actor may not resolve yet.
      if (tok) await runShipWarpArrival(tok, heading, { style: getShipWarpEffectStyle(slot.actor) });
      spawned++;
    } catch (err) {
      console.error(`STA2e Toolkit | ship spawner: failed to spawn ${slot.displayName}:`, err);
      ui.notifications.error(`Failed to spawn ${slot.displayName}.`);
    }

    if (i < slots.length - 1 && delay > 0) {
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return spawned;
}

/** Run the full placement flow. Returns true when ships were actually spawned. */
async function runSpawn({ pattern, spacing, snap, delay }) {
  const slots = expandQueue();
  if (!slots.length) {
    ui.notifications.warn("No ships in the spawn queue.");
    return false;
  }
  if (slots.length > MAX_SHIPS) {
    ui.notifications.error(`${slots.length} contacts queued — sensors can only resolve ${MAX_SHIPS} at once.`);
    return false;
  }

  const target = Array.from(game.user.targets)[0] ?? null;
  const targetPoint = target ? (target.center ?? { x: target.x, y: target.y }) : null;

  // ── Stage 1: position ──────────────────────────────────────────────────────
  let centres = null;
  let chosenPattern = pattern;

  if (pattern === "individual") {
    centres = await pickIndividualCentres(slots, null);
    if (!centres) { ui.notifications.warn("Warp-in aborted."); return false; }
  } else {
    const picked = await pickFormationCentre(slots, pattern, spacing, targetPoint);
    if (!picked) { ui.notifications.warn("Warp-in aborted."); return false; }
    chosenPattern = picked.pattern;
    if (chosenPattern === "individual") {
      // [Q] landed on individual — the click just placed ship one.
      centres = await pickIndividualCentres(slots, picked.centre);
      if (!centres) { ui.notifications.warn("Warp-in aborted."); return false; }
    } else {
      centres = [picked.centre];   // resolved into offsets once the heading is known
    }
  }

  // The anchor for aiming: the click point, or the centroid of hand-placed ships.
  const anchor = chosenPattern === "individual"
    ? {
        x: centres.reduce((s, c) => s + c.x, 0) / centres.length,
        y: centres.reduce((s, c) => s + c.y, 0) / centres.length,
      }
    : centres[0];

  // ── Stage 2: heading ───────────────────────────────────────────────────────
  let heading;
  if (targetPoint) {
    heading = Math.atan2(targetPoint.y - anchor.y, targetPoint.x - anchor.x);
  } else {
    heading = await pickHeading(
      anchor,
      chosenPattern === "individual"
        // Hand-placed positions are already fixed, so show them as they stand
        // rather than a formation that would swing with the aim.
        ? g => _stroked(g, { width: 2, color: INDICATOR_COLOR, alpha: 0.6 }, gg => {
            centres.forEach((c, i) => _dashedCircle(gg, c.x, c.y, slots[i].radius));
          })
        : (g, h) => drawFormation(g, anchor.x, anchor.y, slots, chosenPattern, spacing, h)
    );
    if (heading === null) { ui.notifications.warn("Warp-in aborted."); return false; }
  }

  // ── Resolve final positions ────────────────────────────────────────────────
  if (chosenPattern !== "individual") {
    const offsets = calcSpawnOffsets(chosenPattern, slots.length, spacing, { headingRad: heading });
    centres = offsets.map(o => ({ x: anchor.x + o.x, y: anchor.y + o.y }));
    // Circle faces every ship inward at the target rather than along the heading.
    offsets.forEach((o, i) => { slots[i].rotation = o.rotation; });
  }

  ui.notifications.info(`Warping in ${slots.length} ship(s)…`);
  const spawned = await spawnFleet(slots, centres, heading, { snap, delay });

  if (spawned > 0) ui.notifications.info(`${spawned} ship(s) warped in.`);
  else ui.notifications.error("No ships were spawned — see console.");
  return spawned > 0;
}

// ── Dialog ────────────────────────────────────────────────────────────────────

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Dialog CSS. Injected as a real <style> element in _onRender rather than
 * embedded in the content string — DialogV2 templates the content into a form
 * of its own, and this way the styles cannot be lost to that.
 */
function buildStyles(hasTarget) {
  return `
  #${DIALOG_ID}-root { ${getLcCssVars("sp", getLcTokens())}
    font-family: var(--sp-font); color: var(--sp-text); display: flex;
    flex-direction: column; gap: 10px; }
  #${DIALOG_ID}-root label { font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.12em; color: var(--sp-text-dim); }
  #${DIALOG_ID}-root select,
  #${DIALOG_ID}-root input[type="number"] { width: 100%; padding: 4px;
    background: var(--sp-panel); color: var(--sp-text);
    border: 1px solid var(--sp-border); font-family: var(--sp-font); }
  #${DIALOG_ID}-root .sp-drop-zone { border: 2px dashed var(--sp-border-dim);
    border-radius: 18px 4px 18px 4px; padding: 12px; min-height: 92px;
    background: rgba(0,0,0,0.25); text-align: center; }
  #${DIALOG_ID}-root .sp-drop-zone.drag-over { border-color: var(--sp-primary);
    background: rgba(255,255,255,0.06); }
  #${DIALOG_ID}-root .sp-hint { color: var(--sp-text-dim); font-size: 11px; margin: 6px 0; }
  #${DIALOG_ID}-root .sp-list { display: flex; flex-direction: column; gap: 4px;
    margin-top: 8px; text-align: left; }
  #${DIALOG_ID}-root .sp-item { display: flex; align-items: center; gap: 8px; padding: 4px 6px;
    background: var(--sp-panel); border-left: 4px solid var(--sp-primary); }
  #${DIALOG_ID}-root .sp-item img { width: 30px; height: 30px; border: 1px solid var(--sp-border);
    object-fit: cover; flex-shrink: 0; }
  #${DIALOG_ID}-root .sp-item-name { flex: 1; font-size: 12px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  #${DIALOG_ID}-root .sp-badge { font-size: 9px; padding: 1px 5px; letter-spacing: 0.08em;
    background: rgba(255,255,255,0.08); color: var(--sp-text-dim); }
  #${DIALOG_ID}-root .sp-badge.linked { color: var(--sp-green); }
  #${DIALOG_ID}-root .sp-badge.wild { color: var(--sp-yellow); }
  #${DIALOG_ID}-root .sp-qty { display: flex; align-items: center; gap: 4px; }
  #${DIALOG_ID}-root .sp-qty-btn { cursor: pointer; user-select: none; width: 18px; height: 18px;
    display: flex; align-items: center; justify-content: center;
    border: 1px solid var(--sp-border); color: var(--sp-text); }
  #${DIALOG_ID}-root .sp-qty-btn:hover { background: var(--sp-primary); color: var(--sp-bg); }
  #${DIALOG_ID}-root .sp-qty-val { min-width: 20px; text-align: center; font-weight: 700;
    color: var(--sp-primary); }
  #${DIALOG_ID}-root .sp-remove { cursor: pointer; color: var(--sp-red); font-weight: 700;
    padding: 0 4px; }
  #${DIALOG_ID}-root .sp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  #${DIALOG_ID}-root .sp-row { display: flex; align-items: center; gap: 6px; }
  #${DIALOG_ID}-root .sp-status { font-size: 11px; padding: 6px 8px; background: var(--sp-panel);
    border-left: 4px solid ${hasTarget ? "var(--sp-green)" : "var(--sp-orange)"}; }`;
}

function buildContent(prefs) {
  const target = Array.from(game.user.targets)[0] ?? null;
  const status = target
    ? `<strong>Target:</strong> ${esc(target.name)} — the fleet will form up facing it.`
    : `<strong>No target</strong> — you'll set the fleet's heading with the aiming arrow.`;

  return `
<div id="${DIALOG_ID}-root">
  <div>
    <label>Ship Queue</label>
    <div class="sp-drop-zone" id="sp-drop-zone">
      <div class="sp-hint">
        <i class="fas fa-hand-pointer"></i><br>
        Drag ship actors from the sidebar (or tokens from the canvas) here
      </div>
      <div class="sp-list" id="sp-list"></div>
    </div>
  </div>

  <div class="sp-grid">
    <div>
      <label for="sp-pattern">Formation</label>
      <select id="sp-pattern">
        ${Object.entries(SPAWN_PATTERNS).map(([k, v]) =>
          `<option value="${k}" ${prefs.pattern === k ? "selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>
    <div>
      <label for="sp-spacing">Spread (px)</label>
      <input type="number" id="sp-spacing" min="50" max="2000" step="25" value="${prefs.spacing}">
    </div>
    <div>
      <label for="sp-delay">Spawn Delay (ms)</label>
      <input type="number" id="sp-delay" min="0" max="5000" step="50" value="${prefs.delay}">
    </div>
    <div class="sp-row" style="align-items:flex-end;padding-bottom:4px;">
      <input type="checkbox" id="sp-snap" ${prefs.snap ? "checked" : ""} style="width:auto;">
      <label for="sp-snap" style="margin:0;">Snap to Grid</label>
    </div>
  </div>

  <div class="sp-status">${status}</div>
</div>`;
}

function renderQueue(root) {
  const list = root.querySelector("#sp-list");
  if (!list) return;
  list.replaceChildren();

  for (const entry of _queue) {
    const item = document.createElement("div");
    item.className = "sp-item";

    const img = document.createElement("img");
    img.src = entry.img;
    item.append(img);

    const name = document.createElement("span");
    name.className = "sp-item-name";
    name.textContent = entry.name;
    item.append(name);

    const badge = document.createElement("span");
    badge.className = `sp-badge ${entry.isLinked ? "linked" : entry.isWildcard ? "wild" : ""}`;
    badge.textContent = entry.isLinked ? "LINKED" : entry.isWildcard ? "WILD" : "UNLINK";
    item.append(badge);

    if (!entry.isLinked) {
      const qty = document.createElement("div");
      qty.className = "sp-qty";
      const minus = document.createElement("span");
      minus.className = "sp-qty-btn";
      minus.textContent = "−";
      const val = document.createElement("span");
      val.className = "sp-qty-val";
      val.textContent = entry.quantity;
      const plus = document.createElement("span");
      plus.className = "sp-qty-btn";
      plus.textContent = "+";
      minus.addEventListener("click", () => {
        if (entry.quantity > 1) { entry.quantity--; val.textContent = entry.quantity; }
      });
      plus.addEventListener("click", () => {
        if (entry.quantity < MAX_PER_ACTOR) { entry.quantity++; val.textContent = entry.quantity; }
        else ui.notifications.warn(`Maximum ${MAX_PER_ACTOR} copies per actor.`);
      });
      qty.append(minus, val, plus);
      item.append(qty);
    }

    const remove = document.createElement("span");
    remove.className = "sp-remove";
    remove.textContent = "✕";
    remove.addEventListener("click", () => {
      _queue = _queue.filter(e => e !== entry);
      renderQueue(root);
    });
    item.append(remove);

    list.append(item);
  }
}

function wireDialog(root) {
  const zone = root.querySelector("#sp-drop-zone");
  if (!zone) return;

  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", async e => {
    e.preventDefault();
    zone.classList.remove("drag-over");

    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }

    let actor = null;
    if (data?.type === "Token") {
      actor = (canvas.tokens.get(data.tokenId) ?? canvas.tokens.get(data.id))?.actor ?? null;
    } else if (data?.type === "Actor") {
      actor = (await fromUuid(data.uuid)) ?? game.actors.get(data.id) ?? null;
    }
    if (!actor) { ui.notifications.warn("Could not resolve an actor from that drop."); return; }
    if (_queue.some(entry => entry.actor.id === actor.id)) {
      ui.notifications.warn(`${actor.name} is already queued.`);
      return;
    }

    const proto = actor.prototypeToken;
    _queue.push({
      actor,
      name:       actor.name,
      img:        proto?.texture?.src ?? proto?.img ?? actor.img ?? "icons/svg/mystery-man.svg",
      isLinked:   proto?.actorLink ?? false,
      isWildcard: proto?.randomImg ?? false,
      quantity:   1,
    });
    renderQueue(root);
  });

  renderQueue(root);
}

/**
 * Read the form back out.
 *
 * DialogV2 passes its button callbacks an element in some Foundry versions and
 * the Application in others, so resolve a queryable root from either.
 */
function readForm(dialogOrElement) {
  const root = dialogOrElement?.element ?? dialogOrElement ?? document.getElementById(DIALOG_ID);
  const q = sel => root?.querySelector(sel);
  const num = (sel, fallback) => {
    const v = Number(q(sel)?.value);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    // `confirmed` distinguishes a real submit from DialogV2.wait resolving with
    // the bare button action string when a callback returns nothing.
    confirmed: true,
    pattern: q("#sp-pattern")?.value ?? PREF_DEFAULTS.pattern,
    spacing: num("#sp-spacing", PREF_DEFAULTS.spacing),
    delay:   num("#sp-delay", PREF_DEFAULTS.delay),
    snap:    q("#sp-snap")?.checked ?? PREF_DEFAULTS.snap,
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Open the ship spawner. GM only — it creates tokens on the scene.
 * Exposed as `game.sta2eToolkit.openShipSpawner()`.
 */
export async function openShipSpawner() {
  if (!game.user.isGM) {
    ui.notifications.warn("Only the GM can spawn ships.");
    return;
  }

  const prefs = getPrefs();
  const hasTarget = game.user.targets.size > 0;

  const SpawnerDialog = class extends foundry.applications.api.DialogV2 {
    _onRender(context, options) {
      super._onRender(context, options);
      // Injected as an element rather than embedded in the content string:
      // DialogV2 templates the content into a form of its own, and this way the
      // styles cannot be lost to that. Guarded so a re-render cannot stack them.
      if (!this.element.querySelector("style[data-sp-styles]")) {
        const style = document.createElement("style");
        style.dataset.spStyles = "";
        style.textContent = buildStyles(hasTarget);
        this.element.prepend(style);
      }
      wireDialog(this.element);
    }
  };

  // wait() resolves with the pressed button's callback value, or null when the
  // window is dismissed (rejectClose: false). Running the canvas picker only
  // after it resolves keeps the dialog out of the way of the placement.
  const result = await SpawnerDialog.wait({
    id: DIALOG_ID,
    window: { title: "Ship Spawner — Warp In", icon: "fas fa-rocket" },
    position: { width: 520 },
    classes: ["dialog"],
    content: buildContent(prefs),
    rejectClose: false,
    buttons: [
      {
        action: "spawn",
        label: "Warp Ships In",
        icon: "fas fa-rocket",
        default: true,
        callback: (_event, _button, dlg) => readForm(dlg),
      },
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
    ],
  });

  if (!result?.confirmed) return;

  setPrefs(result);
  if (!queueTotal()) {
    ui.notifications.warn("No ships in the spawn queue — drag ship actors in first.");
    return;
  }

  const spawned = await runSpawn(result);
  if (spawned) _queue = [];
}
