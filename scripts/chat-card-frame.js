/**
 * sta2e-toolkit | chat-card-frame.js
 *
 * The TNG LCARS frame shared by every chat card the module posts, other than the
 * working task card (which has its own, with a spine) and the two families that
 * keep bespoke skins: the warp navigation cards and the star-system reports.
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

export function lcarsChatCard({ title, accent, body, legacy, rootClass = "", attrs = "" }) {
  if (!isChatCardFrame()) return legacy();
  return `
<div class="sta2e-chat-card${rootClass ? ` ${rootClass}` : ""}" ${attrs} data-theme="${getActiveLcThemeKey()}"
  style="${getLcCssVars("cc")}--ccf-c:${accent || LC.primary};">
  <div class="ccf-bar ccf-bar--top">${title ?? ""}</div>
  <div class="ccf-body">${unroundButtons(body)}</div>
  <div class="ccf-bar ccf-bar--bottom" aria-hidden="true"></div>
</div>`;
}
