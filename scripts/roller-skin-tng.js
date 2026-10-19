/**
 * sta2e-toolkit | roller-skin-tng.js
 *
 * The TNG "Bracket Console" skin for the Adv. Dice Roller dialog
 * (buildDialogContent in npc-roller.js), worn whenever the active theme is a
 * bracket theme (lcars-tng, lcars-fc). The design source is
 * docs/roller-mockups.html; shape lives in styles/roller-tng.css.
 *
 * ── Wrap, never replace ──────────────────────────────────────────────────────
 * The dialog content is ~1100 lines of conditional markup, and its wiring
 * (_wireSetupInputs, _wireDiePips) finds every control by id and writes
 * display / opacity / innerHTML into it at runtime. A second copy of that
 * builder would drift on the first new talent, so this skin does what the chat
 * card frame does: the content goes inside the same bracket frame the task card
 * wears (bracketTop / bracketBottom from task-card-tng.js, the `.tbc` rules in
 * task-card-tng.css) and through one body pass, bracketRollerBodyHtml, that
 * removes only what made each element LCARS. Ids, classes, data-*, layout and
 * text colour all survive, so every wirer still finds what it looks for.
 *
 * Three things buildDialogContent does for the skin itself, because a pass
 * cannot regroup markup: sectionHeader emits a bare `.tbr-head` (the setup
 * phase draws it and the body after it as one stadium strip, CSS only), the
 * Ship Pool header with its Manage key does the same, and the Targeting
 * Solution system keys repaint through `--tbr-a` rather than inline fills.
 *
 * ── The footer ───────────────────────────────────────────────────────────────
 * Roll / Resolve / Cancel are core's DialogV2 footer, outside the content.
 * seatBracketFooter moves it inside the frame after render, so the keys sit
 * between the content and the bottom bracket as the mockup has them. It stays
 * inside the dialog's <form>, which is all core's button handling needs. Its
 * colours are set inline from the theme's palette and its shape is CSS, the same
 * split as every other key.
 *
 * Imports lcars-theme.js, task-card-tng.js and chat-card-frame.js, none of
 * which import this, so npc-roller.js can take it without a cycle.
 */

import { getActiveLcThemeKey, getLcCssVars, isBracketTheme } from "./lcars-theme.js";
import { bracketTop, bracketBottom, tbcPalette } from "./task-card-tng.js";
import { stripDecorativeEmoji } from "./chat-card-frame.js";

/**
 * Decorative emoji go, but the crit stars stay: the shared helper's range
 * (U+2600-26FF) also covers ★, which the dice write as their crit mark.
 */
const stripEmoji = text => String(text ?? "").split(/([★☆])/)
  .map(part => /^[★☆]$/.test(part) ? part : stripDecorativeEmoji(part)).join("");

/** The theme gate, matching isChatCardFrame and the task card's bracket branch. */
export function isBracketRoller() {
  try { return isBracketTheme(getActiveLcThemeKey()); }
  catch { return false; }
}

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
 * The roller's body pass: classify each LCARS shape and strip what made it
 * LCARS, stamping `tbr-ctl` (fields), `tbr-plate` (bordered boxes), `tbr-note`
 * (left-edge banners) and `tbr-key` (buttons); hand checkbox, radio and range
 * inputs their accent as `--tbr-a`; drop the Arial Narrow font so Antonio
 * reaches the text; and drop decorative emoji. Text colour, layout, size,
 * every id, class and data-* attribute, and wiring-toggled `display` stay.
 */
export function bracketRollerBodyHtml(html) {
  return String(html ?? "")
    .replace(TAGS, (tag, name) => skinTag(tag, name))
    .replace(/>([^<]+)</g, (m, text) => `>${stripEmoji(text)}<`);
}

/**
 * Wrap the roller content in the bracket frame.
 *
 * @param {string} content  buildDialogContent's markup.
 * @param {object} o
 * @param {string} o.title  Title in the top bar's gap — the weapon or task.
 * @param {"setup"|"rolled"} o.phase
 * @param {boolean} [o.passed]  Rolled phase only: frame green or rose.
 * @returns {string} HTML.
 */
export function bracketRollerHtml(content, { title, phase = "setup", passed = true } = {}) {
  const P = tbcPalette();
  const colour = phase === "rolled" ? (passed ? P.pass : P.fail) : P.working;
  return `
<div class="sta2e-roller sta2e-roller--tng tbc" data-theme="${getActiveLcThemeKey()}" data-phase="${phase}"
  style="${getLcCssVars("tc")}--tbc-c:${colour};">
  ${bracketTop(stripEmoji(title ?? "Dice Roller"))}
  <div class="tbc-body">${bracketRollerBodyHtml(content)}</div>
  ${bracketBottom(phase === "rolled" ? "Rolled" : "Setup")}
</div>`;
}

/** Footer key colour by DialogV2 action — the role the task card gives each.
 *  The first button is always the dialog's main action and takes the confirm
 *  colour, whatever it is called. */
const FOOTER_ROLE = {
  post: "addToRoll", "reroll-all": "poolThreat", back: "edit", cancel: "dim",
};

/**
 * After render: move core's DialogV2 footer inside the frame, under the content,
 * and paint its buttons as bracket keys. Their icons and decorative emoji go.
 * A no-op when the dialog carries no bracket frame.
 *
 * @param {HTMLElement} root  The dialog's element.
 */
export function seatBracketFooter(root) {
  const frame = root?.querySelector?.(".sta2e-roller--tng");
  const footer = root?.querySelector?.(".form-footer");
  if (!frame || !footer) return;
  root.classList.add("sta2e-roller-tbc");
  const P = tbcPalette();
  const buttons = [...footer.querySelectorAll("button")];
  buttons.forEach((btn, i) => {
    btn.querySelectorAll("i").forEach(icon => icon.remove());
    for (const node of btn.childNodes) {
      if (node.nodeType === 3) node.textContent = stripEmoji(node.textContent);
    }
    const role = btn.dataset.action === "cancel" ? "dim"
      : i === 0 ? "confirmPass" : (FOOTER_ROLE[btn.dataset.action] ?? "edit");
    const colour = P[role] ?? P.edit;
    btn.style.background = colour;
    btn.style.color = (luma(colour) ?? 1) > 0.42 ? "#000000" : "#f2f2f2";
    btn.classList.add("tbr-fkey");
  });
  footer.classList.add("tbr-footer");
  frame.querySelector(".tbc-body")?.append(footer);
}
