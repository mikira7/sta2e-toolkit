/**
 * sta2e-toolkit | task-card-slim.js
 *
 * Alternate "slim LCARS" skin for the interactive Working Results task card.
 * Selected by the world setting `taskCardStyle` and dispatched from
 * buildPlayerRollCardHtml() in npc-roller.js, which passes a prepared `view`.
 *
 * Same content as the classic card — every section, every button — packed into
 * tighter chrome: an elbow header bar, an absolutely-positioned left spine,
 * label-and-dice on one line, wrapping note chips, and a pill stat readout.
 *
 * ── DOM contract (do not break) ──────────────────────────────────────────────
 * The chat wiring in combat/combat-hud-core.js attaches native listeners per
 * render and depends on this markup:
 *
 *  • `.sta2e-working-actions` (+ --assists/--luck/--rerolls/--assist-apply/
 *    --confirm) wrap every interactive section. Non-authorised users have these
 *    removed wholesale, so each wrapper must fully contain its own buttons.
 *    Each wrapper stays a plain BLOCK — the reroll tray is appended to
 *    `armBtn.closest(".sta2e-working-actions")`, so a flex wrapper would put
 *    the tray beside the buttons instead of below them. Flex lives on .tcs-btns.
 *  • `span.sta2e-card-die[data-pool][data-index]` with a descendant <img>, the
 *    span itself being the click target (setCardDieState paints both).
 *  • Buttons keep their classes and every data-* attribute they carry.
 *
 * ── Styling rule (do not break) ──────────────────────────────────────────────
 * _armCardSelection() saves `btn.style.cssText`, dims siblings via
 * `style.opacity`, and sets background/borderColor/color on the armed button;
 * _disarmCardSelection() restores by assigning `style.cssText` back. That
 * round-trip is only lossless if a button's whole look IS its inline style.
 * So all buttons here are fully inline-styled, and styles/task-card-slim.css
 * must never set background / border-color / color / opacity on them, and must
 * contain no `!important` at all. Hover there uses filter + box-shadow only.
 */

import { getLcTokens, getLcCssVars, getActiveLcThemeKey } from "./lcars-theme.js";

const LC = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });

const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]));

/**
 * Shared inline button styling. Accent drives border + text; see styling rule.
 * Only newlines and their indentation are collapsed — spaces inside values such
 * as `1px solid #f6a726` and `2px 9px 9px 2px` must survive.
 */
const btnStyle = (accent, { strong = false, left = false, tint = null } = {}) => `
  width:100%;padding:${strong ? "5px 9px" : "3px 8px"};
  background:${tint ?? "rgba(255,255,255,0.04)"};
  border:${strong ? 2 : 1}px solid ${accent};border-radius:2px 9px 9px 2px;
  cursor:pointer;font-family:${LC.font};font-size:${strong ? 10 : 9}px;
  font-weight:700;color:${accent};letter-spacing:0.04em;
  text-align:${left ? "left" : "center"};`.replace(/\n\s*/g, "");

/** A dice row: uppercase label on the left, the dice themselves on the right. */
const diceLine = (label, diceHtml, sub = "") => `
  <div class="tcs-row">
    <span class="tcs-row-label" title="${esc(label)}">${label}${
      sub ? `<span class="tcs-row-sub">${sub}</span>` : ""}</span>
    <span class="tcs-row-dice">${diceHtml}</span>
  </div>`;

/** An action section. Keeps the wrapper a block; flex goes on the inner list. */
const actionSection = (modifier, inner) => `
  <div class="sta2e-working-actions sta2e-working-actions--${modifier}"
    style="padding:4px 6px 4px 0;border-top:1px solid ${LC.borderDim};">
    <div class="tcs-btns">${inner}</div>
  </div>`;

/**
 * Render the slim skin.
 *
 * @param {object} view Prepared view from buildPlayerRollCardHtml.
 * @returns {string} HTML string.
 */
export function renderSlimTaskCard(view) {
  const {
    rollData, diceRow, renderResourceTokens,
    headerAccent, passColor, passed, finalResultLabel,
    contextLeftLabel, contextRightLabel,
    crewDiceHeading, shipDiceHeading, namedAssistBlocks,
    noteStrips, traitNotes, statCells,
    interactiveActive, spentVisible, spentGroups, gained, poolButton,
    showMakeYourOwnLuck, rerollButtons, canGmEditCard, confirmLabel, p,
    succeedAtCostButton,
  } = view;

  const {
    taskLabel, crewDice, shipDice, apAssistDice,
    pendingAssists, isAssistRoll, assistOfficerName, assistApplied,
    confirmed, groundMode, makeYourOwnLuckSource, crewTarget,
  } = rollData;
  // The "Make Your Own Luck used" note is not read here — it arrives as one of
  // the chips in view.noteStrips, built alongside the other talent notes.

  const dieOpts = { size: 24, fontSize: 10 };

  // Classic (npc-roller.js:3303) falls back to its `officerName` local, which is
  // an HTML <span> blob rather than a name — it injects a whole flex row into
  // the header. Slim deliberately uses the plain name instead; do not "fix".
  const headerTitle = isAssistRoll
    ? `🤝 Assist — ${assistOfficerName ?? rollData.officerName ?? "Officer"}`
    : confirmed
      ? `📋 ${taskLabel || "Task Roll"} — ${finalResultLabel}`
      : `📋 ${taskLabel || "Task Roll"} — Working`;

  // ── Notes: talent strips, ship badges and applied traits, all as chips ──────
  const noteChips = [
    ...noteStrips.map(n => ({ tone: n.tone ?? "note", text: n.text })),
    ...traitNotes.map(t => ({
      tone: "trait",
      text: `${esc(t.name)}: ${esc(t.label)}${t.value ? ` (${t.value > 0 ? "+" : ""}${t.value})` : ""}`,
    })),
  ];

  const resourceLine = (label, tokensHtml, trailing = "") => `
    <div class="tcs-row tcs-row--res">
      <span class="tcs-row-label">${label}</span>
      <span class="tcs-res">${tokensHtml}${trailing}</span>
    </div>`;

  return `
<div class="sta2e-slim-task-card" data-theme="${getActiveLcThemeKey()}"
  style="${getLcCssVars("tc")}">
  <span class="tcs-spine" aria-hidden="true"></span>

  <div class="tcs-head" style="--tcs-a:${headerAccent};">
    <span class="tcs-head-cap" aria-hidden="true"></span>
    <span class="tcs-head-title">${headerTitle}</span>
    ${contextLeftLabel ? `<span class="tcs-head-sub">${contextLeftLabel}</span>` : ""}
    ${contextRightLabel ? `<span class="tcs-head-meta">${contextRightLabel}</span>` : ""}
  </div>

  ${diceLine(groundMode ? "Crew" : crewDiceHeading, diceRow(crewDice ?? [], "crew", dieOpts))}

  ${namedAssistBlocks.map(b => diceLine(
    b.heading,
    // One diceRow call per assist die, exactly as classic — every named-assist
    // die therefore keeps data-index="0". Merging them would renumber indices.
    diceRow([b.die], "named-assist", dieOpts),
    b.subHeading,
  )).join("")}

  ${(apAssistDice ?? []).length > 0
    ? diceLine("⚡ Helm — Attack Pattern", diceRow(apAssistDice, "ap-assist", dieOpts))
    : ""}

  ${(shipDice ?? []).length > 0
    ? diceLine(shipDiceHeading, diceRow(shipDice, "ship", dieOpts))
    : ""}

  ${noteChips.length ? `
  <div class="tcs-notes">
    ${noteChips.map(n => `<span class="tcs-note tcs-note--${n.tone}">${n.text}</span>`).join("")}
  </div>` : ""}

  ${!isAssistRoll ? `
  <div class="tcs-rule" aria-hidden="true"></div>
  <div class="tcs-stats">
    ${statCells.map(([label, value, color]) => `
    <span class="tcs-pill${label === "Result" ? " tcs-pill--result" : ""}" style="--tcs-v:${color};">
      ${label === "Result" ? "" : `<em>${label}</em>`}<b>${value}</b>
    </span>`).join("")}
  </div>` : ""}

  ${interactiveActive && spentVisible
    ? resourceLine("Spent", spentGroups
        .map(([label, count, type, color]) => renderResourceTokens(label, count, type, color, 14))
        .join(""))
    : ""}

  ${gained.visible
    ? resourceLine(
        "Gained",
        renderResourceTokens(gained.label, gained.amount, gained.type, gained.color, 14),
        gained.autoBanked
          ? `<span class="tcs-note tcs-note--note">${gained.banked} banked${
              gained.floating > 0 ? ` · ${gained.floating} floating` : ""}</span>`
          : "",
      )
    : ""}

  ${!confirmed && (pendingAssists ?? []).length > 0
    ? actionSection("assists", (pendingAssists).map((ao, i) => `
      <button class="sta2e-player-assist-roll"
        data-payload="${p}"
        data-assist-index="${i}"
        style="${btnStyle(LC.primary, { left: true, tint: "rgba(255,153,0,0.10)" })}">
        🎲 Assist — ${ao.type === "direct" ? "🎖️ " : ao.type === "methodical-planning" ? "📋 "
          : ao.type === "attack-pattern" ? "⚡ " : "🤝 "}${ao.name}${
          ao.type === "methodical-planning" ? " (Methodical Planning)"
          : ao.type === "attack-pattern" ? " (Attack Pattern)" : ""}
      </button>`).join(""))
    : ""}

  ${showMakeYourOwnLuck ? actionSection("luck", `
    <button class="sta2e-make-own-luck"
      data-payload="${p}"
      style="${btnStyle(LC.primary, { left: true, tint: "rgba(255,153,0,0.10)" })}">
      ${makeYourOwnLuckSource ?? "Make Your Own Luck"} — suffer 1 Stress, change a failed die to ${crewTarget}
    </button>`) : ""}

  ${!confirmed && !isAssistRoll && rerollButtons.length > 0
    ? actionSection("rerolls", rerollButtons.map(rb => `
      <button class="sta2e-player-reroll"
        data-payload="${p}"
        data-ability="${rb.ability}"
        data-ability-label="${rb.label}"
        style="${btnStyle(LC.secondary, { left: true, tint: "rgba(150,100,255,0.08)" })}">
        🔄 ${rb.label} — ${rb.labelShort}
      </button>`).join(""))
    : ""}

  ${isAssistRoll
    ? actionSection("assist-apply", assistApplied
        ? `<div style="${btnStyle(LC.secondary, { tint: "rgba(0,150,255,0.08)" })}cursor:default;">
             ✓ Applied to: ${assistApplied}
           </div>`
        : `<button class="sta2e-assist-to-roll"
             data-payload="${p}"
             style="${btnStyle(LC.secondary, { strong: true, tint: "rgba(0,150,255,0.10)" })}">
             ➕ Add to Task Roll →
           </button>`)
    : confirmed
      ? actionSection("confirm", poolButton.visible
          ? `<button class="sta2e-add-to-pool"
               data-pool="${poolButton.pool}"
               data-amount="${poolButton.amount}"
               data-token-id="${poolButton.tokenId}"
               style="${btnStyle(LC.secondary, { strong: true, tint: "rgba(0,0,0,0.25)" })}">
               ${poolButton.label}
             </button>`
          : `<div style="${btnStyle(passColor, {
                strong: true,
                tint: passed ? "rgba(0,200,100,0.12)" : "rgba(255,80,80,0.08)",
              })}cursor:default;">
               Completed
             </div>`)
      : actionSection("confirm", `
        ${canGmEditCard ? `
        <button class="sta2e-edit-roll-card"
          data-payload="${p}"
          style="${btnStyle(LC.primary, { tint: "rgba(255,153,0,0.08)" })}">
          Edit Results
        </button>` : ""}
        ${succeedAtCostButton?.visible ? `
        <button class="sta2e-succeed-at-cost"
          data-payload="${p}"
          title="Resolve this task as a success. It gains 1 extra complication; the GM narrates the cost."
          style="${btnStyle(LC.primary, { tint: "rgba(255,153,0,0.10)" })}">
          ${succeedAtCostButton.label}
        </button>` : ""}
        <button class="sta2e-player-confirm"
          data-payload="${p}"
          style="${btnStyle(passColor, {
            strong: true,
            tint: passed ? "rgba(0,200,100,0.12)" : "rgba(255,80,80,0.08)",
          })}">
          ${confirmLabel}
        </button>`)}
</div>`;
}
