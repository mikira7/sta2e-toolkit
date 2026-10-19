/**
 * sta2e-toolkit | chat-card-frame.js
 *
 * The TNG LCARS frame shared by every chat card the module posts, other than the
 * working task card (which has its own, with a spine) and the two families that
 * keep bespoke skins: the warp navigation cards and the star-system reports.
 *
 * Under the TOS theme (tos-panel) the same call gives the TOS Console Viewer
 * frame instead (tosChatCard below), the sibling of task-card-tos.js, and under
 * TMP (tmp-console) the Console Monitor frame (tmpChatCard), the sibling of
 * task-card-tmp.js.
 *
 * Shape: a bar across the top carrying the card's title, a bar across the bottom,
 * all four corners rounded, no spine. Geometry lives in styles/chat-card.css; this
 * module only decides whether the frame applies and stamps the colour on the root.
 *
 * ── The legacy thunk ─────────────────────────────────────────────────────────
 * The frame is TNG-only, and every other era must render exactly as it did before
 * a card was converted. Rather than teach this module ~19 different legacy looks,
 * each builder hands its existing template in as `legacy` — a thunk, so the old
 * string is only built when it is the one being used. A conversion is therefore:
 * lift the body into a local, wrap the old return value in an arrow function, and
 * call lcarsChatCard. Nothing outside TNG moves, and the frame exists once.
 *
 * ── Wrap, never replace ──────────────────────────────────────────────────────
 * The body is passed through untouched, because a lot of behaviour is anchored
 * inside it: the five renderChatMessageHTML hooks query classes in card bodies,
 * and momentum-spend.js injects its panel with insertAdjacentHTML("beforebegin")
 * against a controls element in there. Anything that rebuilt the body would have
 * to re-establish all of it.
 *
 * A leaf module — it imports lcars-theme.js and nothing else, so any builder can
 * use it without risking an import cycle.
 */

import { getLcTokens, getLcCssVars, getActiveLcThemeKey } from "./lcars-theme.js";

const LC = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });

/** The theme gate, matching `lcarsFrame` in npc-roller.js. */
export function isChatCardFrame() {
  try { return getActiveLcThemeKey() === "lcars-tng"; }
  catch { return false; }
}

/**
 * Wrap a card body in the TNG frame, or hand back the builder's own markup.
 *
 * @param {object}   o
 * @param {string}   o.title     Top bar label. Uppercased by CSS.
 * @param {string}  [o.accent]   Bar colour; defaults to the theme's primary. Pass
 *                               the accent the card already codes with (hit/miss,
 *                               injury severity, hazard colour) so the frame
 *                               changes shape without flattening that meaning.
 * @param {string}   o.body      The card's content — no root, no header bar.
 * @param {Function} o.legacy    Returns the builder's pre-frame markup, used
 *                               whenever the frame is off.
 * @param {string}  [o.rootClass] The class the builder's own root carried. Pass it
 *                               whenever anything selects the card by it — the
 *                               momentum tracker's wiring does exactly that
 *                               (`html.querySelector(".sta2e-momentum-tracker")`
 *                               in momentum-tracker.js), and its buttons go dead
 *                               without this.
 * @param {string}  [o.attrs]     Extra attributes for the root, e.g. `data-pool="…"`,
 *                               for the same reason.
 * @returns {string} HTML.
 */
/**
 * Drop inline border-radius from the body's buttons.
 *
 * Card bodies write their buttons' geometry inline — mostly border-radius:2px —
 * and an inline declaration beats any stylesheet rule, so the frame could not
 * round them from CSS however specific the selector. Only the opening <button>
 * tag is touched, and only that one property, so every other inline style the
 * body relies on survives. Non-TNG never reaches here: legacy returns first.
 */
const unroundButtons = html => String(html ?? "").replace(
  /<button\b[^>]*>/gi,
  tag => tag.replace(/border-radius\s*:[^;"']*;?/gi, ""),
);

/** The TOS console frame's theme gate, matching `tosSkin` in npc-roller.js. */
export function isTosChatCardFrame() {
  try { return getActiveLcThemeKey() === "tos-panel"; }
  catch { return false; }
}

// ── TOS keys ────────────────────────────────────────────────────────────────
// The TOS frame draws body buttons as raised backlit console keys. Their colour
// is a gradient built in CSS from --tck-a, so the inline background, border and
// colour each body writes must go — inline beats any rule. The accent is lifted
// out of the button's own inline `color` (or, failing that, its border colour)
// first, so a red Ignore stays red and a green Apply stays green. Code that
// repaints a button at runtime still wins, since it writes inline afterwards.

const _HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i;
const _RGB = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i;

/** Relative luminance 0..1 of a hex or rgb() colour, or null if unparseable. */
function _luma(colour) {
  const c = String(colour ?? "").trim();
  let r, g, b;
  const hex = c.match(_HEX);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, ch => ch + ch) : hex[1];
    [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  } else {
    const rgb = c.match(_RGB);
    if (!rgb) return null;
    [r, g, b] = rgb.slice(1, 4).map(Number);
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const _COLOUR_IN = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/i;

function _keyify(tag) {
  const colour = tag.match(/(?<![-\w])color\s*:\s*([^;"']+)/i)?.[1]?.trim();
  const border = tag.match(/(?<![-\w])border(?:-[a-z]+)*\s*:[^;"']*/i)?.[0]?.match(_COLOUR_IN)?.[1];
  let accent = [colour, border].find(c => _luma(c) !== null && !/rgba\([^)]*,\s*0(\.0+)?\s*\)/i.test(c))
    ?? LC.primary;
  // A near-black accent (text written in the card's bg colour on a filled key)
  // would draw a black key; fall back to the theme's primary.
  if ((_luma(accent) ?? 1) < 0.12) accent = LC.primary;
  const ink = (_luma(accent) ?? 1) > 0.42 ? "#140e00" : "#fff4ee";

  const stripped = tag
    .replace(/(?<![-\w])background(?:-color|-image)?\s*:[^;"']*;?/gi, "")
    .replace(/(?<![-\w])border(?:-[a-z]+)*\s*:[^;"']*;?/gi, "")
    .replace(/(?<![-\w])color\s*:[^;"']*;?/gi, "");
  const vars = `--tck-a:${accent};--tck-ink:${ink};`;
  return /\sstyle\s*=\s*(["'])/i.test(stripped)
    ? stripped.replace(/(\sstyle\s*=\s*)(["'])/i, `$1$2${vars}`)
    : stripped.replace(/^<button\b/i, `<button style="${vars}"`);
}

const keyifyButtons = html => String(html ?? "").replace(/<button\b[^>]*>/gi, _keyify);

/**
 * The TOS "Console Viewer" frame: a gunmetal housing, a header with the title
 * and three indicator lamps (the first lit in the card's accent), and the body
 * set into a curved amber CRT. The body is wrapped untouched apart from its
 * buttons, and keeps `.ccf-body`, which several wirers use as their host.
 */
function tosChatCard({ title, accent, body, rootClass, attrs }) {
  return `
<div class="sta2e-chat-card sta2e-chat-card--tos${rootClass ? ` ${rootClass}` : ""}" ${attrs} data-theme="${getActiveLcThemeKey()}"
  style="${getLcCssVars("cc")}--ccf-c:${accent || LC.primary};">
  <div class="ccf-tos-head">
    <div class="ccf-tos-title">${title ?? ""}</div>
    <div class="ccf-tos-lamps" aria-hidden="true"><i class="ccf-tos-lamp--accent"></i><i></i><i></i></div>
  </div>
  <div class="ccf-tos-screen"><div class="ccf-body">${keyifyButtons(body)}</div></div>
</div>`;
}

/** The TMP console frame's theme gate, matching `tmpSkin` in npc-roller.js. */
export function isTmpChatCardFrame() {
  try { return getActiveLcThemeKey() === "tmp-console"; }
  catch { return false; }
}

/**
 * The TMP "Console Monitor" frame: the first film's grey duty panel with a
 * header plate in the card's accent, and the body set into a black monitor
 * whose border takes the same accent — the sibling of task-card-tmp.js. The
 * whole body goes on the monitor because every body colours its text inline
 * with the tmp-console tokens, which are made for a black background. Body
 * buttons go through the same keyify step as TOS and become backlit lenses
 * (styles/chat-card.css builds them from --tck-a / --tck-ink).
 */
function tmpChatCard({ title, accent, body, rootClass, attrs }) {
  return `
<div class="sta2e-chat-card sta2e-chat-card--tmp${rootClass ? ` ${rootClass}` : ""}" ${attrs} data-theme="${getActiveLcThemeKey()}"
  style="${getLcCssVars("cc")}--ccf-c:${accent || LC.primary};">
  <div class="ccf-tmp-head">
    <span class="ccf-tmp-plate" aria-hidden="true"></span>
    <div class="ccf-tmp-title">${title ?? ""}</div>
  </div>
  <div class="ccf-tmp-screen"><div class="ccf-body">${keyifyButtons(body)}</div></div>
</div>`;
}

export function lcarsChatCard({ title, accent, body, legacy, rootClass = "", attrs = "" }) {
  if (isTosChatCardFrame()) return tosChatCard({ title, accent, body, rootClass, attrs });
  if (isTmpChatCardFrame()) return tmpChatCard({ title, accent, body, rootClass, attrs });
  if (!isChatCardFrame()) return legacy();
  return `
<div class="sta2e-chat-card${rootClass ? ` ${rootClass}` : ""}" ${attrs} data-theme="${getActiveLcThemeKey()}"
  style="${getLcCssVars("cc")}--ccf-c:${accent || LC.primary};">
  <div class="ccf-bar ccf-bar--top">${title ?? ""}</div>
  <div class="ccf-body">${unroundButtons(body)}</div>
  <div class="ccf-bar ccf-bar--bottom" aria-hidden="true"></div>
</div>`;
}
