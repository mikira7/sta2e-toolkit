/**
 * sta2e-toolkit | chat-card-frame.js
 *
 * The TNG LCARS frame shared by every chat card the module posts, other than the
 * working task card and the two families that keep bespoke skins: the warp
 * navigation cards and the star-system reports.
 *
 * Under the TOS theme (tos-panel) the same call gives the TOS Console Viewer
 * frame instead (tosChatCard below), the sibling of task-card-tos.js, and under
 * TMP (tmp-console) the Console Monitor frame (tmpChatCard), the sibling of
 * task-card-tmp.js.
 *
 * Shape: the TNG "Bracket Console" (tngChatCard below) — open brackets at the
 * four corners, the title centred in the top bar's gap, segmented side arms. It
 * is the same frame the working task card wears (task-card-tng.js), built from
 * the same bracketTop / bracketBottom markup, and its geometry lives in
 * styles/task-card-tng.css under `.tbc`. This module only decides whether the
 * frame applies and stamps the colour on the root.
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
 * Nearly a leaf: it imports lcars-theme.js and task-card-tng.js, which itself
 * imports only lcars-theme.js, so any builder can use it without risking an
 * import cycle.
 */

import { getLcTokens, getLcCssVars, getActiveLcThemeKey, isBracketTheme } from "./lcars-theme.js";
import { bracketTop, bracketBottom } from "./task-card-tng.js";

const LC = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });

/** The theme gate, matching `lcarsFrame` in npc-roller.js. */
export function isChatCardFrame() {
  try { return isBracketTheme(getActiveLcThemeKey()); }
  catch { return false; }
}

/**
 * Wrap a card body in the TNG frame, or hand back the builder's own markup.
 *
 * @param {object}   o
 * @param {string}   o.title     Title, in the top bar's gap. Uppercased by CSS.
 * @param {string}  [o.accent]   Frame colour; defaults to the theme's primary. Pass
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
  // A filled LCARS key writes its colour as the background and its text in the
  // card's near-black bg colour, so the fill is the accent there.
  const fill = tag.match(/(?<![-\w])background(?:-color)?\s*:\s*([^;"']+)/i)?.[1]?.trim();
  const usable = c => _luma(c) !== null && !/rgba\([^)]*,\s*0?(\.\d+)?\s*\)/i.test(c) && _luma(c) >= 0.12;
  // A near-black accent would draw a black key; fall back to the theme's primary.
  const accent = [colour, border, fill].find(usable) ?? LC.primary;
  const ink = (_luma(accent) ?? 1) > 0.42 ? "#140e00" : "#fff4ee";

  const stripped = tag
    .replace(/(?<![-\w])background(?:-color|-image)?\s*:[^;"']*;?/gi, "")
    .replace(/(?<![-\w])border(?:-[a-z]+)*\s*:[^;"']*;?/gi, "")
    .replace(/(?<![-\w])color\s*:[^;"']*;?/gi, "")
    // The console key's own typeface; an inline LCARS font would beat it.
    .replace(/(?<![-\w])font-family\s*:[^;"]*;?/gi, "");
  const vars = `--tck-a:${accent};--tck-ink:${ink};`;
  return /\sstyle\s*=\s*(["'])/i.test(stripped)
    ? stripped.replace(/(\sstyle\s*=\s*)(["'])/i, `$1$2${vars}`)
    : stripped.replace(/^<button\b/i, `<button style="${vars}"`);
}

const keyifyButtons = html => String(html ?? "").replace(/<button\b[^>]*>/gi, _keyify);

// ── TOS body pass ───────────────────────────────────────────────────────────
// Card bodies — the damage cards above all — are written in LCARS shapes with
// inline styles: bordered stat tiles, left-border banners, outlined chips,
// tinted plates, rounded inputs. Inline beats any rule, so the TOS frame cannot
// restyle them from CSS alone. This pass reads each tag's inline style,
// classifies the LCARS shape it draws, removes only the declarations that make
// it LCARS (background, border, radius, shadow, font family) and stamps a
// `ccf-tos-*` class plus the shape's own colour (--tn-c) for chat-card.css to
// redraw it as a console part.
//
// Kept as written: text colour (it carries meaning — hit, miss, injury),
// layout (display, grid, gap, padding, width, alignment), size and weight,
// every class and data-* attribute, and `display:none` that wiring toggles.
// Buttons are left to _keyify. Code that writes inline styles at runtime
// still wins, as it does for the keys.

/** The tags the pass reads; buttons, images, links and icons are left alone. */
const _TOS_TAGS = /<(div|span|label|input|select|textarea|p|section|ul|ol|li|table|thead|tbody|tr|td|th|strong|b|em|small|details|summary)\b[^>]*>/gi;
const _TOS_CONTROL = /^(input|select|textarea)$/i;
const _DECL = prop => new RegExp(`(?<![-\\w])${prop}\\s*:[^;"]*;?`, "gi");
const _BOX_DECLS = ["background(?:-color|-image)?", "border(?:-[a-z]+)*", "box-shadow"];

function _addClass(tag, cls) {
  return /\sclass\s*=\s*"/i.test(tag)
    ? tag.replace(/(\sclass\s*=\s*")/i, `$1${cls} `)
    : tag.replace(/^<([a-z0-9-]+)/i, `<$1 class="${cls}"`);
}

function _tosifyTag(tag, name) {
  const styleMatch = tag.match(/\sstyle\s*=\s*"([^"]*)"/i);
  const isControl = _TOS_CONTROL.test(name);
  if (!styleMatch) return isControl ? _addClass(tag, "ccf-tos-ctl") : tag;
  const style = styleMatch[1];

  // Classify the LCARS shape before its declarations go.
  const leftBorder = style.match(/(?<![-\w])border-left\s*:\s*[2-9]px\s+solid\s+([^;"]+)/i);
  const boxed = /(?<![-\w])border\s*:\s*1px\s+solid/i.test(style);
  let kind = null;
  let accent = null;
  if (isControl) kind = "ctl";
  else if (/^span$/i.test(name) && boxed && /display\s*:\s*inline-block/i.test(style)) {
    kind = "chip";
    accent = style.match(/(?<![-\w])color\s*:\s*([^;"]+)/i)?.[1]?.trim()
      ?? style.match(/(?<![-\w])border\s*:[^;"]*/i)?.[0]?.match(_COLOUR_IN)?.[1];
  }
  else if (/^div$/i.test(name) && boxed && /(?<![-\w])padding\s*:\s*3px\b/i.test(style)) kind = "tile";
  // A bordered box is a plate even with an accent edge (a target's block);
  // the edge colour rides along. A left border alone is a banner.
  else if (/^div$/i.test(name) && boxed) { kind = "plate"; accent = leftBorder?.[1]?.trim() ?? null; }
  else if (leftBorder) { kind = "note"; accent = leftBorder[1].trim(); }

  let next = style
    .replace(_DECL("font-family"), "")
    .replace(_DECL("accent-color"), "")
    // A radius goes everywhere except a deliberate circle.
    .replace(/(?<![-\w])border-radius\s*:\s*(?!50%)[^;"]*;?/gi, "")
    // A faint wash reads as an LCARS tint on a CRT; an opaque fill (a meter,
    // a lit strip) is kept, since it is drawing something.
    .replace(/(?<![-\w])background(?:-color)?\s*:\s*rgba\([^)]*,\s*0?\.\d+\s*\)\s*;?/gi, "");
  if (kind) for (const prop of _BOX_DECLS) next = next.replace(_DECL(prop), "");
  if (accent) next = `--tn-c:${accent};${next}`;

  const rewritten = tag.replace(styleMatch[0], ` style="${next.trim()}"`);
  return kind ? _addClass(rewritten, `ccf-tos-${kind}`) : rewritten;
}

/** Decorative emoji the LCARS bodies prefix their lines with (💥 ⚠️ ⚔ …).
 *  Arrows, geometric shapes and dingbats (▶ ✓ ✗ ★ →) are functional and stay. */
const _EMOJI = /(?:[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{26FF}])\u{FE0F}?\s?|\u{FE0F}/gu;
export const stripDecorativeEmoji = text => String(text ?? "").replace(_EMOJI, "");

/** The TOS body pass — exported for the spend panel, injected after render. */
export function tosifyBodyHtml(html) {
  return keyifyButtons(String(html ?? "")
    .replace(_TOS_TAGS, (tag, name) => _tosifyTag(tag, name))
    .replace(/>([^<]+)</g, (m, text) => `>${stripDecorativeEmoji(text)}<`));
}

/**
 * The TOS "Console Viewer" frame: a gunmetal housing, a header with the title
 * and three indicator lamps (the first lit in the card's accent), and the body
 * set into a curved amber CRT. The body goes through the TOS body pass
 * (tosifyBodyHtml) — its LCARS shapes become console parts and its buttons
 * keys — and keeps `.ccf-body`, which several wirers use as their host.
 */
function tosChatCard({ title, accent, body, rootClass, attrs }) {
  return `
<div class="sta2e-chat-card sta2e-chat-card--tos${rootClass ? ` ${rootClass}` : ""}" ${attrs} data-theme="${getActiveLcThemeKey()}"
  style="${getLcCssVars("cc")}--ccf-c:${accent || LC.primary};">
  <div class="ccf-tos-head">
    <div class="ccf-tos-title">${stripDecorativeEmoji(title)}</div>
    <div class="ccf-tos-lamps" aria-hidden="true"><i class="ccf-tos-lamp--accent"></i><i></i><i></i></div>
  </div>
  <div class="ccf-tos-screen"><div class="ccf-body">${tosifyBodyHtml(body)}</div></div>
</div>`;
}

/** The TMP frame's theme gate (Console or Monitor), matching `tmpSkin` in npc-roller.js. */
export function isTmpChatCardFrame() {
  try { return ["tmp-console", "tmp-monitor"].includes(getActiveLcThemeKey()); }
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
 *
 * Under `tmp-monitor` the same markup gains `.sta2e-chat-card--tmpmon` and tick
 * marks, and styles/tmp-monitor.css redraws it as one black screen with the
 * plate as its code tab and outlined keys.
 */
function tmpChatCard({ title, accent, body, rootClass, attrs }) {
  const monitor = getActiveLcThemeKey() === "tmp-monitor";
  return `
<div class="sta2e-chat-card sta2e-chat-card--tmp${monitor ? " sta2e-chat-card--tmpmon" : ""}${rootClass ? ` ${rootClass}` : ""}" ${attrs} data-theme="${getActiveLcThemeKey()}"
  style="${getLcCssVars("cc")}--ccf-c:${accent || LC.primary};">
  <div class="ccf-tmp-head">
    <span class="ccf-tmp-plate" aria-hidden="true"></span>
    <div class="ccf-tmp-title">${title ?? ""}</div>${monitor ? `
    <span class="ccf-tmp-ticks" aria-hidden="true"><i></i><i></i><i></i></span>` : ""}
  </div>
  <div class="ccf-tmp-screen"><div class="ccf-body">${keyifyButtons(body)}</div></div>
</div>`;
}

/**
 * The TNG body pass: the buttons lose their inline radius (unroundButtons), and
 * every inline LCARS font declaration goes, so the frame's own typeface
 * (Antonio, bundled in fonts/tng and set on `.tbc` in task-card-tng.css)
 * reaches the text. Bodies write `font-family:${LC.font}` on nearly every
 * element, and inline beats any rule. Only a declaration naming the theme's
 * Arial Narrow stack is removed; any other font a body chose is kept. Exported
 * for the spend panel, which is injected after render.
 */
export function tngBodyHtml(html) {
  return unroundButtons(html).replace(
    /(?<![-\w])font-family\s*:\s*([^;"]*);?/gi,
    (decl, value) => /Arial Narrow/i.test(value) ? "" : decl,
  );
}

/**
 * The TNG "Bracket Console" frame — the sibling of task-card-tng.js. The
 * accent colours the corner brackets and the title (--tbc-c); the side arms and
 * bottom rule stay tan. The body goes through tngBodyHtml and keeps
 * `.ccf-body`, which several wirers use as their host.
 */
function tngChatCard({ title, accent, body, rootClass, attrs }) {
  const colour = accent || LC.primary;
  return `
<div class="sta2e-chat-card sta2e-chat-card--tng tbc${rootClass ? ` ${rootClass}` : ""}" ${attrs} data-theme="${getActiveLcThemeKey()}"
  style="${getLcCssVars("cc")}--ccf-c:${colour};--tbc-c:${colour};">
  ${bracketTop(title)}
  <div class="tbc-body ccf-body">${tngBodyHtml(body)}</div>
  ${bracketBottom()}
</div>`;
}

export function lcarsChatCard({ title, accent, body, legacy, rootClass = "", attrs = "" }) {
  if (isTosChatCardFrame()) return tosChatCard({ title, accent, body, rootClass, attrs });
  if (isTmpChatCardFrame()) return tmpChatCard({ title, accent, body, rootClass, attrs });
  if (!isChatCardFrame()) return legacy();
  return tngChatCard({ title, accent, body, rootClass, attrs });
}
