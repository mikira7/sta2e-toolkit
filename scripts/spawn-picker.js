/**
 * sta2e-toolkit | spawn-picker.js
 *
 * The canvas placement pickers shared by the Transporter and Ship tabs of the
 * spawn window.
 *
 * This started life inside ship-spawner.js. The transporter had three of its own
 * near-identical copies (two inline promise loops plus a hand-placement loop),
 * so it was lifted out wholesale rather than duplicated a fourth time when the
 * two spawners merged. The ship-spawner version won because it is the careful
 * one: a reentrancy guard so a fast double-click cannot resolve twice, Escape
 * caught in the capture phase before Foundry closes the sheet stack, an
 * error-guarded redraw so a bad preview cannot wedge the picker, and PIXI v7/v8
 * shims.
 *
 * Everything here works in **centre points**. Converting a centre to the
 * top-left a TokenDocument actually wants is centreToTopLeft(), which needs the
 * token's own footprint — see token-spawn-utils.js#protoHalfSize.
 */

import { getLcTokens } from "./lcars-theme.js";
import { SPAWN_PATTERNS, GEOMETRIC_PATTERNS, calcSpawnOffsets, scatterMaxRadius } from "./spawn-patterns.js";
import {
  getSceneRegion,
  padCentresForSlots,
  parseLocation,
  regionCentresForSlots,
} from "./spawn-regions.js";

const OVERLAY_ID = "sta2e-spawner-overlay";

/** Default indicator blue. Callers with their own palette pass `color`. */
export const INDICATOR_COLOR = 0x66bbff;

const DEG = 180 / Math.PI;

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                 "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

// ── PIXI drawing shims ────────────────────────────────────────────────────────
// Foundry v14 ships PIXI v8, where fill/stroke come AFTER the shape call and
// drawCircle/drawPolygon are gone. Same approach as warp-jump-vfx.js.

const _hasLegacy = g => typeof g.lineStyle === "function";

/** Run `draw` as a stroked path under either API. */
export function stroked(g, { width, color, alpha }, draw) {
  if (_hasLegacy(g)) { g.lineStyle(width, color, alpha); draw(g); g.lineStyle(0); }
  else { draw(g); g.stroke({ width, color, alpha }); }
}

/** Run `draw` as a filled shape under either API. */
export function filled(g, { color, alpha }, draw) {
  if (_hasLegacy(g)) { g.beginFill(color, alpha); draw(g); g.endFill(); }
  else { draw(g); g.fill({ color, alpha }); }
}

export const circlePath = (g, x, y, r) =>
  (typeof g.drawCircle === "function" ? g.drawCircle(x, y, r) : g.circle(x, y, r));

export const polyPath = (g, pts) =>
  (typeof g.drawPolygon === "function" ? g.drawPolygon(pts) : g.poly(pts));

/** Ten dashes at a 4:1 dash-to-gap ratio, scaled correctly at any radius. */
export function dashedCircle(g, cx, cy, radius) {
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

export function crosshair(g, cx, cy, size = 8) {
  g.moveTo(cx - size, cy); g.lineTo(cx + size, cy);
  g.moveTo(cx, cy - size); g.lineTo(cx, cy + size);
}

export function createIndicator() {
  const g = new PIXI.Graphics();
  (canvas?.interface ?? canvas?.stage)?.addChild(g);
  return g;
}

export function destroyIndicator(g) {
  if (!g) return;
  try {
    g.clear();
    g.parent?.removeChild(g);
    g.destroy();
  } catch { /* canvas may have been torn down mid-pick */ }
}

export function cursorPoint() {
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
export function compassLabel(bearingRad) {
  const compassDeg = ((bearingRad * DEG + 90) % 360 + 360) % 360;
  const point = COMPASS[Math.round(compassDeg / 22.5) % 16];
  return `${String(Math.round(compassDeg)).padStart(3, "0")}° · ${point}`;
}

// ── Previews ──────────────────────────────────────────────────────────────────

/**
 * Draw the formation as it will actually be placed.
 * Scatter is drawn as its containing ring instead — its positions are re-rolled
 * at spawn time, so per-ship rings there would be a lie.
 */
export function drawFormation(g, cx, cy, slots, pattern, spacing, headingRad, color = INDICATOR_COLOR) {
  if (pattern === "scatter") {
    stroked(g, { width: 1, color, alpha: 0.35 },
      gg => dashedCircle(gg, cx, cy, scatterMaxRadius(slots.length)));
  } else {
    const offsets = calcSpawnOffsets(pattern, slots.length, spacing, { headingRad });
    stroked(g, { width: 2, color, alpha: 0.85 }, gg => {
      offsets.forEach((o, i) => dashedCircle(gg, cx + o.x, cy + o.y, slots[i]?.radius ?? 25));
    });
  }
  stroked(g, { width: 1, color, alpha: 0.4 }, gg => crosshair(gg, cx, cy));
}

/** Dim rings for positions already fixed — hand placements, or region pad slots. */
export function drawFixedPoints(g, points, radii, color = INDICATOR_COLOR) {
  stroked(g, { width: 2, color, alpha: 0.6 }, gg => {
    points.forEach((p, i) => dashedCircle(gg, p.x, p.y, radii?.[i] ?? 25));
  });
}

/** Line with a filled arrowhead, from the formation centre out to the cursor. */
export function drawHeadingArrow(g, cx, cy, tx, ty, color = INDICATOR_COLOR) {
  const dx = tx - cx;
  const dy = ty - cy;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(28, Math.max(14, len * 0.18));
  const baseX = tx - ux * head;
  const baseY = ty - uy * head;

  stroked(g, { width: 3, color, alpha: 0.9 }, gg => {
    gg.moveTo(cx, cy);
    gg.lineTo(baseX, baseY);
  });
  filled(g, { color, alpha: 0.9 }, gg => {
    const wx = -uy * head * 0.42;
    const wy =  ux * head * 0.42;
    polyPath(gg, [tx, ty, baseX + wx, baseY + wy, baseX - wx, baseY - wy]);
  });
}

// ── Overlay banner ────────────────────────────────────────────────────────────

/**
 * A fixed banner over the canvas. Same shape as promptShipCardDestination's, so
 * every picker in the module reads as one tool.
 */
export function showOverlay(title, subtitle) {
  document.getElementById(OVERLAY_ID)?.remove();
  const LC = getLcTokens();
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = `position:fixed;top:10px;left:50%;transform:translateX(-50%);
    background:rgba(0,0,0,0.75);color:${LC.primary};border:1px solid ${LC.primary};
    padding:6px 18px;border-radius:4px;z-index:999999;
    font-family:${LC.font};text-align:center;pointer-events:none;`;
  overlay.innerHTML = `
    <div data-role="title" style="font-size:13px;font-weight:700;letter-spacing:0.1em;"></div>
    <div data-role="sub" style="font-size:10px;margin-top:2px;"></div>`;
  // Written as text rather than interpolated markup — a token's display name
  // reaches this banner, and names are user data.
  overlay.querySelector('[data-role="title"]').textContent = title;
  overlay.querySelector('[data-role="sub"]').textContent   = subtitle;
  document.body.appendChild(overlay);
  return {
    setTitle: text => { const el = overlay.querySelector('[data-role="title"]'); if (el) el.textContent = text; },
    remove:   () => overlay.remove(),
  };
}

export function setCrosshairCursor(on) {
  const view = canvas?.app?.view;
  const value = on ? "crosshair" : "";
  document.body.style.cursor = value;
  if (view) view.style.cursor = value;
  if (view?.parentElement) view.parentElement.style.cursor = value;
}

// ── The picker ────────────────────────────────────────────────────────────────

/**
 * One canvas click. `onMove(g)` redraws the indicator each frame; the promise
 * resolves with the clicked canvas point, or null on right-click / Escape.
 *
 * `onKey` gets any other keypress, for the [Q] pattern cycle.
 */
export function awaitCanvasClick({ onMove, onKey } = {}) {
  return new Promise(resolve => {
    const g = createIndicator();
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
      destroyIndicator(g);
    };
    function onAbort() { cleanup(); resolve(null); }
    function onKeyDown(ev) {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); onAbort(); return; }
      if (onKey?.(ev)) redraw();
    }
    function onClick(ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      cleanup();
      resolve({ ...cursorPoint() });
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
 * Stage 1 — where the group goes.
 * Returns { centre, pattern } (pattern may have been cycled with [Q]), or null.
 *
 * `targetPoint` rotates the preview live toward the target as the cursor moves.
 * Without it the preview would be unrotated while the ships land facing the
 * target, since the heading stage is skipped whenever something is targeted.
 *
 * `verb` is the overlay's leading word — "WARP-IN" for ships, "BEAM-IN" for the
 * transporter — so one picker can serve both tabs without lying about which.
 */
export async function pickFormationCentre(slots, pattern, spacing, {
  targetPoint = null,
  verb = "PLACE",
  color = INDICATOR_COLOR,
} = {}) {
  let current = pattern;
  const overlay = showOverlay(
    `${verb} · ${SPAWN_PATTERNS[current]}`,
    "Click to place · [Q] cycle pattern · [RMB/Esc] abort"
  );
  setCrosshairCursor(true);
  try {
    const point = await awaitCanvasClick({
      onMove: g => {
        const p = cursorPoint();
        if (current === "individual") {
          stroked(g, { width: 2, color, alpha: 0.85 },
            gg => dashedCircle(gg, p.x, p.y, slots[0]?.radius ?? 25));
          stroked(g, { width: 1, color, alpha: 0.4 }, gg => crosshair(gg, p.x, p.y));
        } else {
          const heading = targetPoint
            ? Math.atan2(targetPoint.y - p.y, targetPoint.x - p.x)
            : null;
          drawFormation(g, p.x, p.y, slots, current, spacing, heading, color);
          if (targetPoint) drawHeadingArrow(g, p.x, p.y, targetPoint.x, targetPoint.y, color);
        }
      },
      onKey: ev => {
        if (ev.key !== "q" && ev.key !== "Q") return false;
        const cycle = [...GEOMETRIC_PATTERNS, "individual"];
        current = cycle[(cycle.indexOf(current) + 1) % cycle.length];
        overlay.setTitle(`${verb} · ${SPAWN_PATTERNS[current]}`);
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
 * Stage 1, individual mode — one click each, with dim ghosts for the ones
 * already placed. Returns an array of centre points, or null.
 */
export async function pickIndividualCentres(slots, placedFirst, { color = INDICATOR_COLOR } = {}) {
  const centres = placedFirst ? [placedFirst] : [];
  setCrosshairCursor(true);
  try {
    for (let i = centres.length; i < slots.length; i++) {
      const overlay = showOverlay(
        `PLACE · ${slots[i].displayName}`,
        `${i + 1} of ${slots.length} · [RMB/Esc] abort`
      );
      const point = await awaitCanvasClick({
        onMove: g => {
          stroked(g, { width: 2, color, alpha: 0.55 }, gg => {
            centres.forEach((c, ci) => dashedCircle(gg, c.x, c.y, slots[ci].radius));
          });
          filled(g, { color, alpha: 0.4 }, gg => {
            centres.forEach(c => circlePath(gg, c.x, c.y, 5));
          });
          const p = cursorPoint();
          stroked(g, { width: 2, color, alpha: 0.85 },
            gg => dashedCircle(gg, p.x, p.y, slots[i].radius));
          stroked(g, { width: 1, color, alpha: 0.4 }, gg => crosshair(gg, p.x, p.y));
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
 * Stage 2 — which way the group faces. Skipped by the caller when a token is
 * targeted. Returns the heading in radians (canvas bearing), or null.
 *
 * `preview` redraws the formation at the live heading, so the GM watches the
 * wedge swing round as they aim.
 */
export async function pickHeading(centre, preview, { color = INDICATOR_COLOR } = {}) {
  const overlay = showOverlay("HEADING · —", "Drag to aim, click to lock facing · [RMB/Esc] abort");
  setCrosshairCursor(true);
  try {
    const point = await awaitCanvasClick({
      onMove: g => {
        const p = cursorPoint();
        const heading = Math.atan2(p.y - centre.y, p.x - centre.x);
        preview?.(g, heading);
        drawHeadingArrow(g, centre.x, centre.y, p.x, p.y, color);
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

// ── The whole placement question, answered ────────────────────────────────────

/**
 * Where a queue of tokens lands, as centre points in queue order.
 *
 * This is the full Spawn Location branch every tab of the spawn window needs:
 * pad markers put one token on each marked Region, a fill Region spreads them
 * over its grid spaces, and anything else is the click-and-[Q]-cycle picker.
 * Returns null when the GM aborts or the site cannot seat everyone, in which
 * case the caller's queue is left exactly as it was.
 *
 * No heading is passed to the formation geometry: people being placed have no
 * formation facing, so the aligned patterns render in their unrotated frame.
 * Ships do their own aiming afterwards.
 *
 * @param {Array} items  One entry per token; needs `radius` and `displayName`
 *   for the previews and `halfW`/`halfH` for the region fit tests.
 * @param {object} opts
 * @param {string} opts.pattern    A SPAWN_PATTERNS key
 * @param {number} opts.spacing
 * @param {string} opts.location   A Spawn Location value — see parseLocation
 * @param {number} [opts.color]    Indicator colour
 * @param {string} [opts.verb]     Overlay verb, e.g. "BEAM-IN"
 * @param {string} [opts.noun]     What one item is called in messages
 * @param {string} [opts.padNoun]  What one marker is called in messages
 * @param {string} [opts.errorPrefix]  Flavour on the over-capacity error
 * @param {string} [opts.abortMsg]
 * @returns {Promise<{x:number,y:number}[]|null>}
 */
export async function pickSpawnCentres(items, {
  pattern,
  spacing,
  location,
  color = INDICATOR_COLOR,
  verb = "PLACE",
  noun = "token",
  padNoun = "spawn marker",
  errorPrefix = "",
  abortMsg = "Placement aborted.",
} = {}) {
  const site  = parseLocation(location);
  const count = items.length;
  const s     = n => (n === 1 ? "" : "s");

  if (site.kind === "pads") {
    const { centres, padCount, label } = padCentresForSlots(site.key, items);
    if (!centres) {
      // All or nothing: a four-pad transporter cannot rematerialise six
      // patterns, and stacking the extras somewhere is worse than saying so.
      ui.notifications.error(padCount
        ? `${errorPrefix}${count} ${noun}${s(count)} queued, "${label}" has ${padCount} ${padNoun}${s(padCount)}.`
        : `"${label}" has no markers on this scene — flag some Regions as spawn markers first.`);
      return null;
    }
    return centres;
  }

  if (site.kind === "region") {
    const region = getSceneRegion(site.id);
    if (!region) {
      ui.notifications.warn("That Region is not on this scene any more — pick a spawn location again.");
      return null;
    }
    const { centres, overflow } = regionCentresForSlots(region, items);
    if (!centres.length) {
      ui.notifications.error(`No room inside "${region.name}" to place a ${noun}.`);
      return null;
    }
    if (overflow) {
      const fit = count - overflow;
      ui.notifications.warn(
        `"${region.name}" has ${fit} clear space${s(fit)} for ${count} ${noun}${s(count)} — the rest are squeezed in.`
      );
    }
    return centres;
  }

  if (pattern === "individual") {
    const placed = await pickIndividualCentres(items, null, { color });
    if (!placed) { ui.notifications.warn(abortMsg); return null; }
    return placed;
  }

  const picked = await pickFormationCentre(items, pattern, spacing, { verb, color });
  if (!picked) { ui.notifications.warn(abortMsg); return null; }

  if (picked.pattern === "individual") {
    // [Q] landed on individual — the click just placed the first one.
    const placed = await pickIndividualCentres(items, picked.centre, { color });
    if (!placed) { ui.notifications.warn(abortMsg); return null; }
    return placed;
  }

  return calcSpawnOffsets(picked.pattern, count, spacing)
    .map(o => ({ x: picked.centre.x + o.x, y: picked.centre.y + o.y }));
}

// ── Placement ─────────────────────────────────────────────────────────────────

/** Centre point → snapped top-left for a token of this footprint. */
export function centreToTopLeft(centre, halfW, halfH, snap) {
  const desired = { x: centre.x - halfW, y: centre.y - halfH };
  if (!snap) return desired;
  const snapped = canvas.grid?.getSnappedPoint ? canvas.grid.getSnappedPoint(desired, {}) : desired;
  return { x: snapped?.x ?? desired.x, y: snapped?.y ?? desired.y };
}
