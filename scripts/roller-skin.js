/**
 * sta2e-toolkit | roller-skin.js
 *
 * Era skins for the Adv. Dice Roller dialog (buildDialogContent in
 * npc-roller.js), each the look of that era's chat card. The design source for
 * all of them is docs/roller-mockups.html. Done so far:
 *
 *   tng  lcars-tng, lcars-fc   the task card's Bracket Console   styles/roller-tng.css
 *   tos  tos-panel             the TOS Console Viewer            styles/roller-tos.css
 *   tmp     tmp-console        the TMP Console Monitor           styles/roller-tmp.css
 *   tmpmon  tmp-monitor        TMP Console plus the monitor      styles/roller-tmp.css
 *                              modifier, as everywhere else
 *   ent     ent-panel          the ENT Bridge Touchscreen        styles/roller-ent.css
 *   klingon klingon            the Klingon Targeting Scope       styles/roller-klingon.css
 *   romulan romulan            the Romulan Raptor Wing           styles/roller-romulan.css
 *
 * Any other theme gets the LCARS dialog unchanged: rollerSkin() returns null.
 *
 * ── Wrap, never replace ──────────────────────────────────────────────────────
 * The dialog content is ~1100 lines of conditional markup, and its wiring
 * (_wireSetupInputs, _wireDiePips) finds every control by id and writes
 * display / opacity / innerHTML into it at runtime. A second copy of that
 * builder would drift on the first new talent, so each skin does what the chat
 * card frame does: the content goes inside the era's own card frame and through
 * one body pass, rollerBodyHtml, that removes only what made each element
 * LCARS. Ids, classes, data-*, layout and text colour all survive, so every
 * wirer still finds what it looks for. The pass is the same for every era; the
 * `tbr-*` classes it leaves are what each era's stylesheet draws.
 *
 * Three things buildDialogContent does for the skins itself, because a pass
 * cannot regroup markup: sectionHeader emits a bare `.tbr-head`, the Ship Pool
 * header with its Manage key does the same, and the Targeting Solution system
 * keys repaint through `--tbr-a` rather than inline fills.
 *
 * ── The footer ───────────────────────────────────────────────────────────────
 * Roll / Resolve / Cancel are core's DialogV2 footer, outside the content.
 * seatRollerFooter moves it into the frame's `[data-roller-keys]` element after
 * render. It stays inside the dialog's <form>, which is all core's button
 * handling needs. Every frame keeps the keys OUTSIDE its `.tbr-screen`, the
 * one part that scrolls (roller.css), so a tall setup never pushes Roll off
 * the bottom of a short screen. Its colours are set inline per era and its shape is CSS, the
 * same split as every other key.
 *
 * ── Scroll cues ──────────────────────────────────────────────────────────────
 * Eras in SCROLL_CUES (Romulan so far) also get wireRollerScroll: a fade at
 * whichever edge of the screen has more content, a "▼ n more" chip above the
 * keys while anything is below the fold, and in the setup phase a sticky strip
 * of section keys built from the `.tbr-head` captions the content already
 * emits, which scrolls to a section and lights the one in view. All of it is
 * added after render and lives inside the frame, so the content and its
 * wiring are untouched.
 *
 * Imports lcars-theme.js, the task card skins (task-card-tng.js,
 * task-card-tos.js, task-card-tmp.js, task-card-ent.js, task-card-klingon.js,
 * task-card-romulan.js) and chat-card-frame.js, none of which
 * import this, so npc-roller.js can take it without a cycle.
 */

import { getActiveLcThemeKey, getLcCssVars, isBracketTheme, isEntTheme, isKlingonTheme, isRomulanTheme } from "./lcars-theme.js";
import { bracketTop, bracketBottom, tbcPalette } from "./task-card-tng.js";
import { tosKeyStyle } from "./task-card-tos.js";
import { tmpLensStyle, tmpMonitorKeyStyle } from "./task-card-tmp.js";
import { ENT, entHead, entFoot, keyStyle as entKeyStyle } from "./task-card-ent.js";
import { KLI, klingonHead, keyStyle as klingonKeyStyle } from "./task-card-klingon.js";
import { ROM, romulanHead, keyStyle as romulanKeyStyle } from "./task-card-romulan.js";
import { stripDecorativeEmoji } from "./chat-card-frame.js";

/**
 * Decorative emoji go, but the crit stars stay: the shared helper's range
 * (U+2600-26FF) also covers ★, which the dice write as their crit mark.
 */
const stripEmoji = text => String(text ?? "").split(/([★☆])/)
  .map(part => /^[★☆]$/.test(part) ? part : stripDecorativeEmoji(part)).join("");

/**
 * Which skin the roller wears for the active theme ("tng", "tos", "tmp",
 * "tmpmon", "ent", "klingon", "romulan"), or null for the plain LCARS dialog. Read at
 * render time, never cached.
 */
export function rollerSkin() {
  try {
    const key = getActiveLcThemeKey();
    if (isBracketTheme(key)) return "tng";
    if (key === "tos-panel") return "tos";
    if (key === "tmp-console") return "tmp";
    if (key === "tmp-monitor") return "tmpmon";
    if (isEntTheme(key)) return "ent";
    if (isKlingonTheme(key)) return "klingon";
    if (isRomulanTheme(key)) return "romulan";
  } catch { /* no theme yet */ }
  return null;
}

/** True when the roller wears any era skin. */
export const isSkinnedRoller = () => rollerSkin() !== null;

// ── Body pass ────────────────────────────────────────────────────────────────

const TAGS = /<(div|span|label|input|select|textarea|p|strong|b|em|small|button)\b[^>]*>/gi;
const decl = prop => new RegExp(`(?<![-\\w])${prop}\\s*:[^;"]*;?`, "gi");
const BOX = ["background(?:-color|-image)?", "border(?:-[a-z]+)*", "box-shadow"];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i;
const RGB = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i;
const COLOUR_IN = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/i;

/** Relative luminance 0..1 of a hex or rgb() colour, or null. */
function luma(colour) {
  const c = String(colour ?? "").trim();
  let rgb;
  const hex = c.match(HEX);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, ch => ch + ch) : hex[1];
    rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  } else {
    const m = c.match(RGB);
    if (!m) return null;
    rgb = m.slice(1, 4).map(Number);
  }
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

const faint = c => /rgba\([^)]*,\s*0?(\.\d+)?\s*\)/i.test(c);
const usable = c => !!c && luma(c) !== null && !faint(c) && luma(c) >= 0.12;

function addClass(tag, cls) {
  return /\sclass\s*=\s*"/i.test(tag)
    ? tag.replace(/(\sclass\s*=\s*")/i, `$1${cls} `)
    : tag.replace(/^<([a-z0-9-]+)/i, `<$1 class="${cls}"`);
}

function setStyle(tag, match, next) {
  return match
    ? tag.replace(match[0], ` style="${next.trim()}"`)
    : (next ? tag.replace(/^<([a-z0-9-]+)/i, `<$1 style="${next.trim()}"`) : tag);
}

/** Inline declarations every element loses: the LCARS font and square corners. */
const common = style => style
  .replace(/(?<![-\w])font-family\s*:\s*([^;"]*);?/gi, (d, v) => /Arial Narrow/i.test(v) ? "" : d)
  // A radius goes everywhere except a deliberate circle (the payment slots).
  .replace(/(?<![-\w])border-radius\s*:\s*(?!50%)[^;"]*;?/gi, "");

/**
 * A button becomes a filled bracket key: its colour is lifted out of its own
 * inline text colour, border or fill, in that order, so a selected key stays
 * the colour it was coded as, and the LCARS fill and border go. Die pips are
 * buttons too, and keep everything: their glow is the reroll hint.
 */
function skinButton(tag) {
  const m = tag.match(/\sstyle\s*=\s*"([^"]*)"/i);
  if (/\bsta2e-die-pip\b/.test(tag)) return m ? setStyle(tag, m, common(m[1])) : tag;
  const style = m?.[1] ?? "";
  const colour = style.match(/(?<![-\w])color\s*:\s*([^;"]+)/i)?.[1]?.trim();
  const border = style.match(/(?<![-\w])border(?:-[a-z]+)*\s*:[^;"]*/i)?.[0]?.match(COLOUR_IN)?.[1];
  const fill = style.match(/(?<![-\w])background(?:-color)?\s*:\s*([^;"]+)/i)?.[1]?.trim();
  const accent = [colour, border, fill].find(usable) ?? "var(--tbc-c3)";
  const ink = (luma(accent) ?? 1) > 0.42 ? "#000000" : "#f2f2f2";
  let next = common(style);
  for (const prop of [...BOX, "color"]) next = next.replace(decl(prop), "");
  return addClass(setStyle(tag, m, `--tbr-a:${accent};--tbr-ink:${ink};${next}`), "tbr-key");
}

function skinTag(tag, name) {
  name = name.toLowerCase();
  if (name === "button") return skinButton(tag);
  const type = (tag.match(/\stype\s*=\s*"([^"]*)"/i)?.[1] ?? "text").toLowerCase();
  if (name === "input" && type === "hidden") return tag;
  const isControl = name === "select" || name === "textarea"
    || (name === "input" && ["text", "number", "search"].includes(type));
  const m = tag.match(/\sstyle\s*=\s*"([^"]*)"/i);
  if (!m) return isControl ? addClass(tag, "tbr-ctl") : tag;
  // The content root paints itself LC.bg; every frame draws its own screen
  // behind it (the CRT's glow, the monitor's grid), so the fill goes. Its
  // height cap and scrolling go too: the frame's `.tbr-screen` scrolls instead
  // (roller.css), so the keys below it stay on screen however tall it gets.
  if (/\sid\s*=\s*"sta2e-npc-roller"/i.test(tag)) {
    return setStyle(tag, m, common(m[1])
      .replace(decl("background(?:-color)?"), "")
      .replace(decl("max-height"), "")
      .replace(decl("overflow(?:-y)?"), ""));
  }
  const style = m[1];

  // Classify the LCARS shape before its declarations go.
  const leftBorder = style.match(/(?<![-\w])border-left\s*:\s*[2-9]px\s+solid\s+([^;"]+)/i);
  const boxed = /(?<![-\w])border\s*:\s*1px\s+solid/i.test(style);
  const block = name === "div" || name === "label";
  let kind = null;
  let accent = null;
  if (isControl) kind = "ctl";
  else if (name === "input") accent = style.match(/(?<![-\w])accent-color\s*:\s*([^;"]+)/i)?.[1];
  else if (block && boxed) { kind = "plate"; accent = leftBorder?.[1] ?? null; }
  else if (block && leftBorder) { kind = "note"; accent = leftBorder[1]; }

  let next = common(style)
    .replace(decl("accent-color"), "")
    // A faint wash reads as an LCARS tint; an opaque fill is drawing something.
    .replace(/(?<![-\w])background(?:-color)?\s*:\s*rgba\([^)]*,\s*0?\.\d+\s*\)\s*;?/gi, "");
  if (kind) for (const prop of BOX) next = next.replace(decl(prop), "");
  if (accent) next = `--tbr-a:${accent.trim()};${next}`;
  const rewritten = setStyle(tag, m, next);
  return kind ? addClass(rewritten, `tbr-${kind}`) : rewritten;
}

/**
 * The roller's body pass, shared by every era: classify each LCARS shape and
 * strip what made it LCARS, stamping `tbr-ctl` (fields), `tbr-plate` (bordered
 * boxes), `tbr-note` (left-edge banners) and `tbr-key` (buttons); hand
 * checkbox, radio and range inputs their accent as `--tbr-a`; drop the Arial
 * Narrow font so the era's own typeface reaches the text; and drop decorative
 * emoji. Text colour, layout, size, every id, class and data-* attribute, and
 * wiring-toggled `display` stay.
 */
export function rollerBodyHtml(html) {
  return String(html ?? "")
    .replace(TAGS, (tag, name) => skinTag(tag, name))
    .replace(/>([^<]+)</g, (m, text) => `>${stripEmoji(text)}<`);
}

const phaseLabel = phase => phase === "rolled" ? "Rolled" : "Setup";

/** TNG / First Contact: the task card's bracket frame, the frame colour by state. */
function tngFrame(body, { title, phase, passed }) {
  const P = tbcPalette();
  const colour = phase === "rolled" ? (passed ? P.pass : P.fail) : P.working;
  return `
<div class="sta2e-roller sta2e-roller--tng tbc" data-theme="${getActiveLcThemeKey()}" data-phase="${phase}"
  style="${getLcCssVars("tc")}--tbc-c:${colour};">
  ${bracketTop(title)}
  <div class="tbc-body">
    <div class="tbr-screen">${body}</div>
    <div class="tbr-keys" data-roller-keys></div>
  </div>
  ${bracketBottom(phaseLabel(phase))}
</div>`;
}

/**
 * TOS: the Console Viewer housing — a header with the title and three lamps
 * (amber while setting up, green or red once rolled), the whole content on one
 * curved CRT, then a strut and the keys. One screen rather than one per
 * section: anything the content leaves between sections (the weapon line,
 * breach banners, the trait list) would otherwise sit on the grey housing, in
 * text colours made for black.
 */
function tosFrame(body, { title, phase, passed }) {
  const lamps = phase === "rolled" ? [passed ? "g" : "r", "off", "a"] : ["a", "off", "off"];
  return `
<div class="sta2e-roller sta2e-roller--tos sta2e-task-card--tos" data-theme="tos-panel" data-phase="${phase}"
  style="${getLcCssVars("tc")}--tct-ph:#9ee26a;">
  <div class="tct-head">
    <div class="tct-title">${title}<small>Adv. Dice Roller · ${phaseLabel(phase)}</small></div>
    <div class="tct-lamps" aria-hidden="true">${lamps.map(l => `<i class="tct-lamp tct-lamp--${l}"></i>`).join("")}</div>
  </div>
  <div class="tct-crt tbr-screen">${body}</div>
  <div class="tct-strut" aria-hidden="true"></div>
  <div class="tct-sect tbr-keys" data-roller-keys></div>
</div>`;
}

/**
 * TMP Console and TMP Monitor: the task card's own markup, so its rules draw
 * them — the grey duty panel with a header plate and a state tag, the content
 * on one black monitor whose border gives the state (cyan setting up, green
 * passed, magenta failed), and the keys in a dark key bed. The monitor theme
 * adds `.sta2e-task-card--tmpmon` and swaps the plate and tag for a code tab
 * and tick marks, exactly as the card does; tmp-monitor.css repaints the rest.
 *
 * The root carries `.sta2e-task-card` (TOS deliberately does not): every TMP
 * Monitor card rule hangs off `.sta2e-task-card.sta2e-task-card--tmp…`, and
 * the shared rules that come with it only round buttons, which roller-tmp.css
 * outranks.
 */
const TMP_SCREEN = { setup: "#00aef0", pass: "#00d27a", fail: "#ed2f76" };
const TMP_PLATE = { setup: "#e9c83a", pass: "#3aa060", fail: "#c8312a" };
const TMP_CODE = { setup: "SET", pass: "OK", fail: "NEG" };

function tmpFrame(body, { title, phase, passed }, monitor = false) {
  const state = phase === "rolled" ? (passed ? "pass" : "fail") : "setup";
  const screen = TMP_SCREEN[state];
  const head = monitor ? `
    <span class="tmc-code">${TMP_CODE[state]}</span>
    <div class="tmc-title">${title}<small>Adv. Dice Roller</small></div>
    <span class="tmc-ticks" aria-hidden="true"><i></i><i></i><i></i></span>` : `
    <span class="tmc-plate" aria-hidden="true"></span>
    <div class="tmc-title">${title}<small>Adv. Dice Roller</small></div>
    <span class="tmc-tag">${phaseLabel(phase)}</span>`;
  return `
<div class="sta2e-roller sta2e-roller--${monitor ? "tmpmon" : "tmp"} sta2e-task-card sta2e-task-card--tmp${monitor ? " sta2e-task-card--tmpmon" : ""}"
  data-theme="${monitor ? "tmp-monitor" : "tmp-console"}" data-phase="${phase}"
  style="${getLcCssVars("tc")}--tmc-plate:${TMP_PLATE[state]};${monitor ? `--tmm-tab:${screen};` : ""}">
  <div class="tmc-head">${head}
  </div>
  <div class="tmc-scr tbr-screen" style="--tmc-s:${screen};">${body}</div>
  <div class="tmc-bed tbr-keys" data-roller-keys></div>
</div>`;
}

/**
 * ENT: the Bridge Touchscreen — the frame the ENT task and chat cards wear
 * (`.tec`: the outline with two chamfers, navy glass, the title on a rule with
 * ticks and a cut tab, the hex footer). Its colour gives the state: blue
 * setting up, green passed, red failed. The content sits straight on the
 * glass, which is dark everywhere, so unlike TOS and TMP it needs no screen of
 * its own; in setup roller-ent.css draws each section as one of the card's
 * bracketed wells from its header and the element after it, as TNG does its
 * strips. The root carries `.sta2e-task-card` so the footer keys can take the
 * card's own `.tec-key` tab shape.
 */
const ENT_FRAME = { setup: ENT.blue, pass: ENT.green, fail: ENT.red };

function entFrame(body, { title, phase, passed }) {
  const state = phase === "rolled" ? (passed ? "pass" : "fail") : "setup";
  return `
<div class="sta2e-roller sta2e-roller--ent sta2e-task-card sta2e-task-card--ent tec" data-theme="${getActiveLcThemeKey()}" data-phase="${phase}"
  style="${getLcCssVars("tc")}--tec-c:${ENT_FRAME[state]};">
  <div class="tec-in">
  ${entHead(title, phaseLabel(phase))}
  <div class="tec-body tbr-screen">${body}</div>
  <div class="tec-actions tbr-keys" data-roller-keys></div>
  ${entFoot("Adv. Dice Roller", title)}
  </div>
</div>`;
}

/**
 * Klingon: the Targeting Scope — the frame the Klingon task and chat cards
 * wear (`.tkc`: the red housing, the title with its code and the inverted
 * triangle lamp, the green-black scope). As on the chat card, the whole
 * content goes on the one scope, and its phosphor gives the state: green
 * setting up, gold passed, red failed. The keys sit below it on the housing.
 * The root carries `.sta2e-task-card` so the footer keys can take the card's
 * own `.tkc-key` plate shape, as ENT's take `.tec-key`.
 */
const KLINGON_SCOPE = { setup: KLI.phosphor, pass: KLI.gold, fail: KLI.alarm };

function klingonFrame(body, { title, phase, passed }) {
  const state = phase === "rolled" ? (passed ? "pass" : "fail") : "setup";
  return `
<div class="sta2e-roller sta2e-roller--klingon sta2e-task-card sta2e-task-card--klingon tkc" data-theme="${getActiveLcThemeKey()}" data-phase="${phase}"
  style="${getLcCssVars("tc")}--tkc-c:${KLINGON_SCOPE[state]};">
  ${klingonHead(title, phaseLabel(phase))}
  <div class="tkc-scope tbr-screen">${body}</div>
  <div class="tkc-actions tbr-keys" data-roller-keys></div>
</div>`;
}

/**
 * Romulan: the Raptor Wing — the frame the Romulan task and chat cards wear
 * (`.trw`: the warbird's swept wings round the title, the diamond line with
 * the phase as its code, gridded black). The content goes straight on the
 * grid, which is dark everywhere, so like ENT it needs no screen of its own;
 * the screen is wrapped in `.trw-scrollwrap`, which carries the scroll cues'
 * fades (wireRollerScroll). The frame colour gives the state: green setting
 * up, gold passed, red failed. The root carries `.sta2e-task-card` so the
 * footer keys can take the card's own `.trw-key` hex shape.
 */
const ROMULAN_FRAME = { setup: ROM.green, pass: ROM.gold, fail: ROM.alarm };

function romulanFrame(body, { title, phase, passed }) {
  const state = phase === "rolled" ? (passed ? "pass" : "fail") : "setup";
  return `
<div class="sta2e-roller sta2e-roller--romulan sta2e-task-card sta2e-task-card--romulan trw" data-theme="${getActiveLcThemeKey()}" data-phase="${phase}"
  style="${getLcCssVars("tc")}--trw-c:${ROMULAN_FRAME[state]};">
  ${romulanHead(title, phaseLabel(phase))}
  <div class="trw-scrollwrap">
    <div class="trw-screen tbr-screen">${body}</div>
  </div>
  <div class="trw-actions tbr-keys" data-roller-keys></div>
</div>`;
}

const FRAMES = {
  tng: tngFrame,
  tos: tosFrame,
  tmp: (body, o) => tmpFrame(body, o, false),
  tmpmon: (body, o) => tmpFrame(body, o, true),
  ent: entFrame,
  klingon: klingonFrame,
  romulan: romulanFrame,
};

/**
 * Wrap the roller content in the active era's frame. Returns the content
 * untouched when the era has no skin.
 *
 * @param {string} content  buildDialogContent's markup.
 * @param {object} o
 * @param {string} o.title  The weapon or task.
 * @param {"setup"|"rolled"} o.phase
 * @param {boolean} [o.passed]  Rolled phase only: the frame's pass / fail state.
 * @returns {string} HTML.
 */
export function skinRollerHtml(content, { title, phase = "setup", passed = true } = {}) {
  const frame = FRAMES[rollerSkin()];
  if (!frame) return content;
  return frame(rollerBodyHtml(content), { title: stripEmoji(title ?? "Dice Roller"), phase, passed });
}

// ── Footer ───────────────────────────────────────────────────────────────────
// Each era paints a footer key from its role. The first button is always the
// dialog's main action, whatever it is called; Cancel is always the dim key.

const FOOTER_ROLE = { post: "post", "reroll-all": "danger", back: "minor", cancel: "cancel" };
const footerRole = (action, index) => action === "cancel" ? "cancel"
  : index === 0 ? "main" : (FOOTER_ROLE[action] ?? "minor");

const TMP_KEY = { main: "green", post: "amber", danger: "magenta", minor: "off", cancel: "off" };

/** Extra classes a footer key takes, so the era's own card key rules draw it. */
const FOOTER_CLASS = { tmp: "tmc-key tmc-key--big", tmpmon: "tmc-key tmc-key--big", ent: "tec-key", klingon: "tkc-key", romulan: "trw-key" };

const FOOTER_PAINT = {
  tng: role => {
    const P = tbcPalette();
    const colour = P[{ main: "confirmPass", post: "addToRoll", danger: "poolThreat", minor: "edit", cancel: "dim" }[role]];
    return `background:${colour};color:${(luma(colour) ?? 1) > 0.42 ? "#000000" : "#f2f2f2"};`;
  },
  tos: role => tosKeyStyle({ main: "green", post: "amber", danger: "red", minor: "grey", cancel: "grey" }[role]),
  tmp: role => tmpLensStyle(TMP_KEY[role]),
  tmpmon: role => tmpMonitorKeyStyle(TMP_KEY[role]),
  ent: role => entKeyStyle({ main: ENT.green, post: ENT.blue, danger: ENT.red, minor: ENT.slate, cancel: ENT.slate }[role]),
  klingon: role => klingonKeyStyle({ main: KLI.gold, post: KLI.amber, danger: KLI.alarm, minor: KLI.rust, cancel: KLI.rust }[role]),
  romulan: role => romulanKeyStyle({ main: ROM.lit, post: ROM.gold, danger: ROM.alarm, minor: ROM.sage, cancel: ROM.moss }[role]),
};

/**
 * The inline colour of a footer key: the era's paint for the role its action
 * plays. Pure, so the test preview paints with the real colours.
 *
 * @param {string} skin    "tng" | "tos" | "tmp" | "tmpmon" | "ent" | "klingon" | "romulan"
 * @param {string} action  The button's DialogV2 action.
 * @param {number} index   Its position in the footer.
 * @returns {string} CSS declarations, or "" for an era with no skin.
 */
export function footerKeyStyle(skin, action, index) {
  return FOOTER_PAINT[skin]?.(footerRole(action, index)) ?? "";
}

/** The classes a footer key takes in an era: always `tbr-fkey`, plus any of the era's own. */
export function footerKeyClasses(skin) {
  return ["tbr-fkey", ...(FOOTER_CLASS[skin]?.split(" ") ?? [])];
}

/**
 * After render: move core's DialogV2 footer into the frame's keys slot and
 * paint its buttons as that era's keys. Their icons and decorative emoji go. A
 * no-op when the dialog carries no skin.
 *
 * @param {HTMLElement} root  The dialog's element.
 */
export function seatRollerFooter(root) {
  const frame = root?.querySelector?.(".sta2e-roller");
  const slot = frame?.querySelector("[data-roller-keys]");
  const footer = root?.querySelector?.(".form-footer");
  const skin = [...(frame?.classList ?? [])].find(c => c.startsWith("sta2e-roller--"))?.slice(14);
  if (!slot || !footer || !FOOTER_PAINT[skin]) return;
  root.classList.add("sta2e-roller-win", `sta2e-roller-win--${skin}`);
  [...footer.querySelectorAll("button")].forEach((btn, i) => {
    btn.querySelectorAll("i").forEach(icon => icon.remove());
    for (const node of btn.childNodes) {
      if (node.nodeType === 3) node.textContent = stripEmoji(node.textContent);
    }
    btn.setAttribute("style", `${btn.getAttribute("style") ?? ""}${footerKeyStyle(skin, btn.dataset.action, i)}`);
    btn.classList.add(...footerKeyClasses(skin));
  });
  footer.classList.add("tbr-footer");
  slot.append(footer);
  if (SCROLL_CUES.has(skin)) wireRollerScroll(frame);
}

// ── Scroll cues ──────────────────────────────────────────────────────────────

/** Eras whose roller gets the fades, the "more" chip and the jump strip. */
const SCROLL_CUES = new Set(["romulan"]);

/** A caption's own words: the first span when it holds one (the Ship Pool
 *  header also holds its Manage key), else its text. */
const headLabel = head => (head.querySelector(":scope > span")?.textContent ?? head.textContent ?? "").trim();

/**
 * Give a frame's screen its scroll cues. The screen's parent takes
 * `data-up` / `data-down` for the fades; a "▼ n more" chip is appended to
 * it, counting the captions still below the fold, and scrolls to the next
 * one; and in the setup phase, with three or more captions, a sticky strip of
 * section keys goes at the top of the screen. Safe to call on any frame: it
 * does nothing without a `.tbr-screen`, and nothing twice.
 *
 * @param {HTMLElement} frame  The `.sta2e-roller` root.
 */
export function wireRollerScroll(frame) {
  const screen = frame?.querySelector?.(".tbr-screen");
  if (!screen || screen.dataset.scrollCues) return;
  screen.dataset.scrollCues = "1";
  const wrap = screen.parentElement;
  const doc = frame.ownerDocument;
  const heads = [...screen.querySelectorAll(".tbr-head")].filter(h => headLabel(h));

  let jump = null;
  if (frame.dataset.phase === "setup" && heads.length >= 3) {
    jump = doc.createElement("nav");
    jump.className = "tbr-jump";
    jump.setAttribute("aria-label", "Roller sections");
    heads.forEach((head, i) => {
      const key = doc.createElement("button");
      key.type = "button";
      key.textContent = headLabel(head);
      key.dataset.jump = String(i);
      jump.append(key);
    });
    screen.prepend(jump);
  }

  const more = doc.createElement("button");
  more.type = "button";
  more.className = "tbr-more";
  more.setAttribute("aria-label", "Scroll down");
  wrap.append(more);

  // Positions are measured against the screen, so they hold however the
  // content nests its sections.
  const topOf = el => el.getBoundingClientRect().top - screen.getBoundingClientRect().top + screen.scrollTop;
  const jumpH = () => jump?.offsetHeight ?? 0;
  const scrollToEl = el => screen.scrollTo({ top: Math.max(0, topOf(el) - jumpH() - 4), behavior: "smooth" });

  const update = () => {
    const below = screen.scrollHeight - screen.clientHeight - screen.scrollTop;
    wrap.toggleAttribute("data-up", screen.scrollTop > 2);
    wrap.toggleAttribute("data-down", below > 2);
    wrap.style.setProperty("--tbr-jump-h", `${jumpH()}px`);
    const fold = screen.scrollTop + screen.clientHeight - 4;
    const hidden = heads.filter(h => topOf(h) > fold).length;
    more.textContent = hidden ? `▼ ${hidden} more` : "▼ more";
    if (jump) {
      const line = screen.scrollTop + jumpH() + 8;
      let current = 0;
      heads.forEach((h, i) => { if (topOf(h) <= line) current = i; });
      if (below <= 2) current = heads.length - 1;
      jump.querySelectorAll("button").forEach(b => b.classList.toggle("is-on", Number(b.dataset.jump) === current));
    }
  };

  screen.addEventListener("scroll", update, { passive: true });
  if (typeof ResizeObserver === "function") new ResizeObserver(update).observe(screen);
  more.addEventListener("click", () => {
    const fold = screen.scrollTop + screen.clientHeight - 4;
    const next = heads.find(h => topOf(h) > fold);
    if (next) scrollToEl(next);
    else screen.scrollTo({ top: screen.scrollTop + screen.clientHeight * 0.8, behavior: "smooth" });
  });
  jump?.addEventListener("click", ev => {
    const key = ev.target.closest?.("button[data-jump]");
    if (key) scrollToEl(heads[Number(key.dataset.jump)]);
  });
  update();
}
