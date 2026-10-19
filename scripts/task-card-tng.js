/**
 * sta2e-toolkit | task-card-tng.js
 *
 * The TNG "Bracket Console" skin for the interactive Working Results task card,
 * used whenever the active theme is `lcars-tng` (whatever `taskCardStyle` says,
 * as with TOS and TMP). Dispatched from buildPlayerRollCardHtml() in
 * npc-roller.js with the same prepared `view` the slim, TOS and TMP skins
 * receive, so all of them render the same content. Shape lives in
 * styles/task-card-tng.css; the design source is docs/tng-card-mockups.html
 * (Concept B).
 *
 * Look: open LCARS brackets at the four corners with the title centred in the
 * top bar's gap, segmented side arms, dice in stadium-outlined strips, every
 * readout a horizontal segmented gauge, and a two-column keypad whose keys are
 * rounded on their outer ends only. The chat card frame's TNG path
 * (tngChatCard in chat-card-frame.js) builds the same brackets with the same
 * `tbc-*` classes, so the frame exists once in CSS.
 *
 * ── DOM contract (do not break) — same as the slim, TOS and TMP skins ──────
 *  • `.sta2e-working-actions` (+ --assists/--luck/--rerolls/--assist-apply/
 *    --confirm) wraps every interactive section and stays a plain BLOCK: the
 *    reroll tray is appended to `armBtn.closest(".sta2e-working-actions")`, and
 *    non-authorised users have these wrappers removed wholesale.
 *  • Dice come from the shared `diceRow` — `span.sta2e-card-die[data-pool]
 *    [data-index]` with a real d20 <img> inside, because setCardDieState paints
 *    selection by writing that image's opacity and filter.
 *  • Buttons keep their classes and every data-* attribute they carry.
 *
 * ── Keys ────────────────────────────────────────────────────────────────────
 * _armCardSelection() round-trips a button through `style.cssText` and writes
 * its background / border-color / color / opacity while a reroll is armed, so a
 * key's colour is entirely inline (`keyStyle`) and the stylesheet sets only its
 * shape. Every arming key carries `data-filled="1"`, so arming lights it yellow
 * rather than darkening one key in a row of lit ones.
 *
 * No inline border-radius anywhere, and no `!important` in the stylesheet. No
 * inline font-family on the root either: the typeface (bundled Antonio) comes
 * from `.tbc` in the stylesheet, and an inline one would beat it.
 */

import { getLcCssVars, getActiveLcThemeKey } from "./lcars-theme.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]));

/** The classic TNG pastels the brackets, gauges and keys are drawn in. */
export const TNG = {
  orange: "#f6a726", gold: "#ffcc66", tan: "#ffcc99", peach: "#ff9966",
  lilac: "#cc99cc", blue: "#9999ff", sky: "#99ccff", rose: "#cc6666",
  red: "#d92222", green: "#48c76b", dim: "#5a5650",
};

/**
 * Colour by role, per theme. The Bracket Console is worn by every theme in
 * BRACKET_THEME_KEYS (lcars-theme.js); each needs an entry here and a
 * `.tbc[data-theme]` block in task-card-tng.css for the colours CSS owns (side
 * arms, outlines, text). An unknown theme falls back to TNG.
 */
const PALETTES = {
  "lcars-tng": {
    working: TNG.orange, assist: TNG.blue, pass: TNG.green, fail: TNG.rose,
    gSucc: TNG.orange, gDiff: TNG.lilac, gMom: TNG.blue, gThreat: TNG.rose, gCpx: TNG.red,
    rerolls: [TNG.blue, TNG.lilac, TNG.tan, TNG.sky, TNG.peach, TNG.gold],
    assistKey: TNG.sky, luck: TNG.gold, dim: TNG.dim, addToRoll: TNG.blue,
    poolMomentum: TNG.green, poolThreat: TNG.rose, edit: TNG.tan, cost: TNG.gold,
    confirmPass: TNG.peach, confirmFail: TNG.rose,
  },
  // First Contact: periwinkle and slate frames, tan accents, orange for the
  // one thing that should pop (successes, and the key that resolves the task).
  "lcars-fc": {
    working: "#6a86cc", assist: "#c9a27a", pass: "#5fbf8f", fail: "#cf5a4e",
    gSucc: "#ff9c33", gDiff: "#c9a27a", gMom: "#9fb2e0", gThreat: "#cf5a4e", gCpx: "#d9443a",
    rerolls: ["#9fb2e0", "#c9a27a", "#7b93d1", "#b5c3e8", "#d8b48a", "#8a93a8"],
    assistKey: "#b5c3e8", luck: "#d8b48a", dim: "#4a5060", addToRoll: "#9fb2e0",
    poolMomentum: "#5fbf8f", poolThreat: "#cf5a4e", edit: "#b5c3e8", cost: "#d8b48a",
    confirmPass: "#ff9c33", confirmFail: "#cf5a4e",
  },
};

/** The active theme's palette. Read at render time, never cached. */
export const tbcPalette = (key = getActiveLcThemeKey()) => PALETTES[key] ?? PALETTES["lcars-tng"];

/** A key's whole colour, inline (see the note above). Text is always near-black. */
const keyStyle = colour => `background:${colour};color:#000000;`;

/** Split "Reason + Science (target: 12)" into its label and target. */
const splitTarget = heading => {
  const m = String(heading ?? "").match(/^(.*?)\s*\(target:\s*([^)]*)\)\s*$/i);
  return m ? [m[1], `T ${m[2]}`] : [String(heading ?? ""), ""];
};

/** A stadium-outlined dice strip, its label and target along the top. */
const strip = (label, inner, { target = "", line = "" } = {}) => `
    <div class="tbc-strip">
      <div class="tbc-strip-lbl"><span>${label}</span>${target ? `<span>${target}</span>` : ""}</div>
      ${line ? `<div class="tbc-strip-line">${line}</div>` : ""}
      ${inner}
    </div>`;

/** Segment count for a gauge: at least six, so small values still read as a scale. */
const SEG_MIN = 6;
const SEG_MAX = 10;

/** A segmented gauge: label, lit segments, the number. */
export const gauge = (label, value, colour, cls = "") => {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  const total = Math.min(SEG_MAX, Math.max(SEG_MIN, n));
  const lit = Math.min(n, total);
  const segs = Array.from({ length: total }, (_, i) => `<i${i < lit ? "" : ` class="tbc-seg--off"`}></i>`).join("");
  return `
      <div class="tbc-gauge${cls ? ` ${cls}` : ""}" style="--tbc-g:${colour};"><span>${label}</span><span class="tbc-segs" aria-hidden="true">${segs}</span><b>${value}</b></div>`;
};

/** An action section. The wrapper stays a block; the keypad grid is the inner list. */
const actionSection = (modifier, inner, { label = "", listClass = "" } = {}) => `
  <div class="sta2e-working-actions sta2e-working-actions--${modifier} tbc-actions">
    ${label ? `<div class="tbc-sect-lbl">${label}</div>` : ""}
    <div class="tbc-pad${listClass ? ` ${listClass}` : ""}">${inner}</div>
  </div>`;

/**
 * The bracket frame's top and bottom rows, shared with the chat card frame.
 * The side arms are the root's own pseudo-elements, so they need no markup.
 */
export const bracketTop = title => `
  <div class="tbc-top">
    <span class="tbc-brk" aria-hidden="true"></span><span class="tbc-rule" aria-hidden="true"></span>
    <div class="tbc-title">${title ?? ""}</div>
    <span class="tbc-rule" aria-hidden="true"></span><span class="tbc-rule tbc-rule--s" aria-hidden="true"></span>
    <span class="tbc-brk tbc-brk--r" aria-hidden="true"></span>
  </div>`;

export const bracketBottom = (code = "") => `
  <div class="tbc-bot">
    <span class="tbc-brk" aria-hidden="true"></span><span class="tbc-rule" aria-hidden="true"></span>
    ${code ? `<span class="tbc-code">${code}</span><span class="tbc-rule tbc-rule--s" aria-hidden="true"></span>` : ""}
    <span class="tbc-brk tbc-brk--r" aria-hidden="true"></span>
  </div>`;

/**
 * Render the TNG skin.
 *
 * @param {object} view Prepared view from buildPlayerRollCardHtml.
 * @returns {string} HTML string.
 */
export function renderTngTaskCard(view) {
  const {
    rollData, diceRow, renderResourceTokens,
    passed, finalResultLabel,
    contextLeftLabel, contextRightLabel,
    crewDiceHeading, shipDiceHeading, namedAssistBlocks,
    noteStrips, traitNotes, statCells,
    interactiveActive, spentVisible, spentGroups, gained, poolButton,
    showMakeYourOwnLuck, rerollButtons, rerollButtonBody, canGmEditCard, confirmLabel, p,
    succeedAtCostButton,
  } = view;

  const {
    taskLabel, crewDice, shipDice, apAssistDice,
    pendingAssists, isAssistRoll, assistOfficerName, assistApplied,
    confirmed, groundMode, makeYourOwnLuckSource, crewTarget, succeedAtCost,
  } = rollData;

  const title = isAssistRoll
    ? `Assist — ${assistOfficerName ?? rollData.officerName ?? "Officer"}`
    : (taskLabel || "Task Roll");
  const sub = [contextLeftLabel, contextRightLabel].filter(Boolean).join(" · ");

  const P = tbcPalette();
  const state = isAssistRoll ? "assist" : !confirmed ? "working" : passed ? "pass" : "fail";
  const status = isAssistRoll ? (assistApplied ? "Applied" : "Assist")
    : confirmed ? finalResultLabel : "Working";
  const dice = (list, pool) => diceRow(list, pool, { size: 30, fontSize: 12 });

  // ── Dice strips ──────────────────────────────────────────────────────────
  const strips = [];
  {
    const [label, target] = splitTarget(groundMode ? "Crew" : crewDiceHeading);
    strips.push(strip(label, dice(crewDice ?? [], "crew"), { target }));
  }
  // One diceRow call per named assist die, exactly as classic — every one keeps
  // data-index="0". Merging them would renumber the indices the reroll reads.
  for (const b of namedAssistBlocks) {
    const [label, target] = splitTarget(b.heading);
    strips.push(strip(label, dice([b.die], "named-assist"), { target, line: b.subHeading }));
  }
  if ((apAssistDice ?? []).length > 0) {
    strips.push(strip("Helm — Attack Pattern", dice(apAssistDice, "ap-assist")));
  }
  if ((shipDice ?? []).length > 0) {
    // The ship heading arrives as "Ship · Sys + Dept · (target: 10)".
    const [label, target] = splitTarget(String(shipDiceHeading).replace(/\s*·\s*\(target:/i, " (target:"));
    strips.push(strip(label, dice(shipDice, "ship"), { target }));
  }

  // ── Notes ────────────────────────────────────────────────────────────────
  const notes = [
    ...noteStrips.map(n => ({ tone: n.tone ?? "note", text: n.text })),
    ...traitNotes.map(t => ({
      tone: "trait",
      text: `${esc(t.name)}: ${esc(t.label)}${t.value ? ` (${t.value > 0 ? "+" : ""}${t.value})` : ""}`,
    })),
  ];
  const notesHtml = notes.length ? `
  <div class="tbc-notes">
    ${notes.map(n => `<div class="tbc-note tbc-note--${n.tone}">${n.text}</div>`).join("")}
  </div>` : "";

  // ── Readout ──────────────────────────────────────────────────────────────
  const resultCell = statCells.find(([label]) => label === "Result");
  const resultValue = resultCell?.[1] ?? "";
  const resultClass = succeedAtCost ? "cost" : passed ? "pass" : "fail";
  const gauges = statCells
    .filter(([label]) => label !== "Result")
    .map(([label, value]) => {
      if (label === "Successes")  return gauge(label, value, P.gSucc);
      if (label === "Difficulty") return gauge(label, value, P.gDiff);
      if (label === "Complic.")   return gauge(label, value, P.gCpx, "tbc-gauge--cpx");
      return gauge(label, value, /threat/i.test(label) ? P.gThreat : P.gMom);
    }).join("");

  const resRow = (label, inner, trailing = "") => `
      <div class="tbc-res"><span class="tbc-res-lbl">${label}</span>${inner}${trailing}</div>`;
  const spentHtml = interactiveActive && spentVisible
    ? resRow("Spent", spentGroups
        .map(([label, count, type, color]) => renderResourceTokens(label, count, type, color, 18))
        .join(""))
    : "";
  const gainedHtml = gained.visible
    ? resRow(
        "Gained",
        renderResourceTokens(gained.label, gained.amount, gained.type, gained.color, 18),
        gained.autoBanked
          ? `<span class="tbc-res-sub">${gained.banked} banked${gained.floating > 0 ? ` · ${gained.floating} floating` : ""}</span>`
          : "",
      )
    : "";

  const readout = !isAssistRoll ? `
  <div class="tbc-readout">${gauges}${spentHtml}${gainedHtml}
    <div class="tbc-result tbc-result--${resultClass}"><strong>${resultValue}</strong></div>
  </div>` : (gainedHtml || spentHtml ? `
  <div class="tbc-readout">${spentHtml}${gainedHtml}</div>` : "");

  // ── Keys ─────────────────────────────────────────────────────────────────
  const assistKind = ao => ao.type === "direct" ? " (Direct)"
    : ao.type === "methodical-planning" ? " (Methodical Planning)"
    : ao.type === "attack-pattern" ? " (Attack Pattern)" : "";
  const rerollColours = P.rerolls;

  const actions = [];
  if (!confirmed && (pendingAssists ?? []).length > 0) {
    actions.push(actionSection("assists", pendingAssists.map((ao, i) => `
      <button class="sta2e-player-assist-roll tbc-key tbc-key--wide"
        data-payload="${p}" data-assist-index="${i}" data-filled="1"
        style="${keyStyle(P.assistKey)}">Roll Assist Die — ${ao.name}${assistKind(ao)}</button>`).join(""),
      { label: "Pending Assists" }));
  }
  if (showMakeYourOwnLuck) {
    actions.push(actionSection("luck", `
      <button class="sta2e-make-own-luck tbc-key tbc-key--wide"
        data-payload="${p}" data-filled="1"
        style="${keyStyle(P.luck)}">${makeYourOwnLuckSource ?? "Make Your Own Luck"} — suffer 1 Stress, change a failed die to ${crewTarget}</button>`));
  }
  if (!confirmed && !isAssistRoll && rerollButtons.length > 0) {
    actions.push(actionSection("rerolls", rerollButtons.map((rb, i) => `
      <button class="sta2e-player-reroll tbc-key"
        data-payload="${p}"
        data-ability="${rb.ability}"
        data-ability-label="${rb.label}"
        title="${rb.label} — ${rb.labelShort}"
        data-filled="1"
        style="${keyStyle(rerollColours[i % rerollColours.length])}">${rerollButtonBody(rb)}</button>`).join(""),
      { label: "Rerolls Available", listClass: "sta2e-task-rerolls" }));
  }

  if (isAssistRoll) {
    actions.push(actionSection("assist-apply", assistApplied
      ? `<div class="sta2e-task-btn tbc-key tbc-key--wide" style="${keyStyle(P.dim)}">Applied to: ${assistApplied}</div>`
      : `<button class="sta2e-assist-to-roll tbc-key tbc-key--wide" data-payload="${p}"
           style="${keyStyle(P.addToRoll)}">Add to Task Roll →</button>`));
  } else if (confirmed) {
    actions.push(actionSection("confirm", poolButton.visible
      ? `<button class="sta2e-add-to-pool tbc-key tbc-key--wide"
           data-pool="${poolButton.pool}"
           data-amount="${poolButton.amount}"
           data-token-id="${poolButton.tokenId}"
           style="${keyStyle(poolButton.pool === "threat" ? P.poolThreat : P.poolMomentum)}">${poolButton.label}</button>`
      : `<div class="sta2e-task-btn tbc-key tbc-key--wide" style="${keyStyle(P.dim)}">Completed</div>`));
  } else {
    const keys = [
      canGmEditCard ? `
        <button class="sta2e-edit-roll-card tbc-key" data-payload="${p}"
          style="${keyStyle(P.edit)}">Edit Results</button>` : "",
      succeedAtCostButton?.visible ? `
        <button class="sta2e-succeed-at-cost tbc-key" data-payload="${p}"
          title="Resolve this task as a success. It gains 1 extra complication; the GM narrates the cost."
          style="${keyStyle(P.cost)}">${succeedAtCostButton.label}</button>` : "",
      `
        <button class="sta2e-player-confirm tbc-key tbc-key--wide" data-payload="${p}"
          style="${keyStyle(passed ? P.confirmPass : P.confirmFail)}">${confirmLabel}</button>`,
    ].filter(Boolean);
    actions.push(actionSection("confirm", keys.join("")));
  }

  return `
<div class="sta2e-task-card sta2e-task-card--tng tbc" data-theme="${getActiveLcThemeKey()}"
  style="${getLcCssVars("tc")}--tbc-c:${P[state]};">
  ${bracketTop(title)}
  <div class="tbc-body">
    ${sub ? `<div class="tbc-sub">${sub}</div>` : ""}
    ${strips.join("")}
    ${notesHtml}
    ${readout}
    ${actions.join("")}
  </div>
  ${bracketBottom(status)}
</div>`;
}
