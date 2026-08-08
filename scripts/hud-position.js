/**
 * sta2e-toolkit | hud-position.js
 * Shared viewport clamping for the module's floating HUD panels.
 *
 * Every draggable panel (toolkit widget, Combat HUD, Zone Monitor, Pool Tracker,
 * SFX widget) persists its position in localStorage. Without clamping, a header
 * dragged past an edge — or a position saved on a wider monitor — leaves the
 * only drag handle somewhere the mouse can never reach it again.
 *
 * These helpers guarantee that the panel's header strip always stays grabbable.
 */

const MIN_VISIBLE = 80;   // px of panel width that must remain on screen
const HANDLE_H    = 28;   // px of the header strip that must remain on screen

/** Measure an element, preferring the layout rect so CSS transforms are honoured. */
function _measure(el) {
  const rect = el?.getBoundingClientRect?.();
  return {
    w: rect?.width  || el?.offsetWidth  || 0,
    h: rect?.height || el?.offsetHeight || 0,
  };
}

/**
 * Clamp a candidate position so the panel stays reachable.
 * Non-finite input (a stored position missing a coordinate) falls back to 0.
 *
 * @param {HTMLElement} el              Panel element — measured, not mutated.
 * @param {number}      x               Candidate left, in px.
 * @param {number}      y               Candidate top, in px.
 * @param {object}      [opts]
 * @param {number}      [opts.minVisible]    Panel width that must stay on screen.
 * @param {number}      [opts.handleHeight]  Header height that must stay on screen.
 * @returns {{x: number, y: number}}
 */
export function clampHudPos(el, x, y, { minVisible = MIN_VISIBLE, handleHeight = HANDLE_H } = {}) {
  const { w } = _measure(el);
  const maxX = Math.max(0, window.innerWidth  - Math.min(w || minVisible, minVisible));
  const maxY = Math.max(0, window.innerHeight - handleHeight);

  const nx = Number(x);
  const ny = Number(y);
  return {
    x: Math.round(Math.min(Math.max(Number.isFinite(nx) ? nx : 0, 0), maxX)),
    y: Math.round(Math.min(Math.max(Number.isFinite(ny) ? ny : 0, 0), maxY)),
  };
}

/**
 * Clamp an element that is already positioned, writing the corrected values back.
 * Must be called while the element is visible — a `display: none` element measures
 * as zero and would clamp against a bogus width.
 *
 * @returns {{x: number, y: number}|null} The corrected position, or null if unusable.
 */
export function clampHudElement(el, opts) {
  if (!el) return null;
  const pos = clampHudPos(el, parseInt(el.style.left, 10), parseInt(el.style.top, 10), opts);
  el.style.left = `${pos.x}px`;
  el.style.top  = `${pos.y}px`;
  return pos;
}

/**
 * Keep a panel in view as the window resizes.
 *
 * @param {() => HTMLElement|null} getEl       Resolves the panel element on each resize.
 * @param {(pos: {x:number,y:number}) => void} [onClamped] Persist the corrected position.
 * @param {object} [opts] Forwarded to clampHudPos.
 * @returns {() => void} Cleanup — removes the listener.
 */
export function onViewportResize(getEl, onClamped, opts) {
  let timer = null;

  const handler = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const el = getEl?.();
      if (!el || el.style.display === "none" || !el.isConnected) return;
      const pos = clampHudElement(el, opts);
      if (pos) onClamped?.(pos);
    }, 120);
  };

  window.addEventListener("resize", handler);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("resize", handler);
  };
}
