/**
 * sta2e-toolkit | task-card-tmp.js
 *
 * The TMP "Console Monitor" skin for the interactive Working Results task card,
 * used whenever the active theme is `tmp-console` (whatever `taskCardStyle` says,
 * as with TOS). Dispatched from buildPlayerRollCardHtml() in npc-roller.js with
 * the same prepared `view` the slim and TOS skins receive, so all of them render
 * the same content. Shape lives in styles/task-card-tmp.css; the design source is
 * docs/tmp-card-mockups.html (Concept D and its coverage check).
 *
 * Look: The Motion Picture's warm grey duty panel — a header plate, recessed
 * monitor screens showing the later films' graphics (grid, scanlines, bracketed
 * blocks, segmented meters), and backlit lens keys set in a dark key bed.
 *
 * ── DOM contract (do not break) — same as the slim and TOS skins ───────────
 *  • `.sta2e-working-actions` (+ --assists/--luck/--rerolls/--assist-apply/
 *    --confirm) wraps every interactive section and stays a plain BLOCK: the
 *    reroll tray is appended to `armBtn.closest(".sta2e-working-actions")`, and
 *    non-authorised users have these wrappers removed wholesale.
 *  • Dice come from the shared `diceRow` — `span.sta2e-card-die[data-pool]
 *    [data-index]` with a real d20 <img> inside, because setCardDieState paints
 *    selection by writing that image's opacity and filter.
 *  • Buttons keep their classes and every data-* attribute they carry.
 *
 * ── Why the keys look the way they do ───────────────────────────────────────
 * _armCardSelection() round-trips a button through `style.cssText`, writes its
 * background / border-color / color / opacity while a reroll is armed, and puts
 * "▶" in front of `.sta2e-rr-name`. So the BUTTON is the lit lens, label inside
 * it: its colour is entirely inline (`lensStyle`), and the bezel ring and sheen
 * are a box-shadow and a pseudo-element, which that function never touches.
 * Every arming key carries `data-filled="1"`, so arming lights it solid yellow.
 *
 * The action sections sit in a dark recess (the key bed) rather than on the grey
 * panel, because the tray that function injects writes LC.yellow text on an
 * almost transparent background inline — unreadable on light grey, and the card
 * stylesheets may not use !important to fix it.
 *
 * No inline border-radius anywhere, and no `!important` in the stylesheet.
 *
 * ── TMP Monitor ──────────────────────────────────────────────────────────────
 * Under `tmp-monitor` the same markup renders with `.sta2e-task-card--tmpmon`
 * beside `--tmp`, and styles/tmp-monitor.css redraws it as one black screen
 * (Concept B in docs/tmp-card-mockups.html). Only three things differ here: the
 * header carries a code tab and tick marks, and keys take `monitorStyle` —
 * outlined or filled in a real border colour, still inline for the same reason.
 */

import { getLcTokens, getLcCssVars, getActiveLcThemeKey } from "./lcars-theme.js";

const LC = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });

const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]));

/** Backlit lens colours: [top, middle, bottom, ink]. */
const LENSES = {
  amber:   ["#ffe27a", "#f0c020", "#9a7a10", "#1a1200"],
  magenta: ["#ff8ab4", "#ed2f76", "#8a1040", "#fff2f6"],
  green:   ["#9af0c0", "#2fbf70", "#156a3c", "#00160a"],
  off:     ["#5a5850", "#45443e", "#33322e", "#c8c4bb"],
};

/** A key's whole colour, inline (see the note above). */
const lensStyle = kind => {
  const [top, mid, low, ink] = LENSES[kind] ?? LENSES.amber;
  return `background:linear-gradient(180deg,${top} 0%,${mid} 45%,${low} 100%);color:${ink};`;
};

/** TMP Monitor keys: outlined in phosphor colours, or filled for the main action.
 *  The border colour is inline too, because an armed key's yellow border is
 *  written by _armCardSelection. */
const MONITOR_KEYS = {
  amber:   ["#00aef0", false],
  magenta: ["#ed2f76", true],
  green:   ["#00d27a", true],
  off:     ["#2a6a80", false],
};
const monitorStyle = kind => {
  const [c, filled] = MONITOR_KEYS[kind] ?? MONITOR_KEYS.amber;
  return filled
    ? `background:${c};border-color:${c};color:#000000;`
    : `background:transparent;border-color:${c};color:${c};`;
};

/** Monitor and header-plate colours per card state. */
const CYAN = "#00aef0";
const GREEN = "#00d27a";
const MAGENTA = "#ed2f76";
const PLATE = { working: "#e9c83a", assist: CYAN, pass: "#3aa060", fail: "#c8312a" };

/** Split "Reason + Science (target: 12)" into its label and target. */
const splitTarget = heading => {
  const m = String(heading ?? "").match(/^(.*?)\s*\(target:\s*([^)]*)\)\s*$/i);
  return m ? [m[1], `TN ${m[2]}`] : [String(heading ?? ""), ""];
};

/** One bracketed readout block on a monitor, with its caption cut into the border. */
const block = (caption, inner, { target = "", line = "" } = {}) => `
    <div class="tmc-blk">
      <span class="tmc-cap">${caption}</span>${target ? `<span class="tmc-cap tmc-cap--r">${target}</span>` : ""}
      ${line ? `<div class="tmc-line">${line}</div>` : ""}
      ${inner}
    </div>`;

/** Segment count for a meter: at least six, so small values still read as a scale. */
const SEG_MIN = 6;
const SEG_MAX = 10;

/** A segmented bar meter: label, lit segments, the number. */
const meter = (label, value, kind = "", cls = "") => {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  const total = Math.min(SEG_MAX, Math.max(SEG_MIN, n));
  const lit = Math.min(n, total);
  const segs = Array.from({ length: total }, (_, i) =>
    `<i${i < lit ? (kind ? ` class="tmc-seg--${kind}"` : "") : ` class="tmc-seg--off"`}></i>`).join("");
  return `
      <div class="tmc-meter${cls ? ` ${cls}` : ""}"><span>${label}</span><span class="tmc-segs" aria-hidden="true">${segs}</span><b>${String(value).padStart(2, "0")}</b></div>`;
};

/** An action section. The wrapper stays a block; any grid goes on the inner list. */
const actionSection = (modifier, inner, { label = "", listClass = "" } = {}) => `
  <div class="sta2e-working-actions sta2e-working-actions--${modifier} tmc-bed">
    ${label ? `<div class="tmc-sect-lbl">${label}</div>` : ""}
    <div class="tmc-btns${listClass ? ` ${listClass}` : ""}">${inner}</div>
  </div>`;

/**
 * Render the TMP skin.
 *
 * @param {object} view Prepared view from buildPlayerRollCardHtml.
 * @returns {string} HTML string.
 */
export function renderTmpTaskCard(view) {
  const monitor = getActiveLcThemeKey() === "tmp-monitor";
  const keyStyle = monitor ? monitorStyle : lensStyle;
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

  const headerTitle = isAssistRoll
    ? `Assist Roll — ${assistOfficerName ?? rollData.officerName ?? "Officer"}`
    : `${taskLabel || "Task Roll"} — ${confirmed ? finalResultLabel : "Working"}`;
  const headerSub = [contextLeftLabel, contextRightLabel].filter(Boolean).join(" · ");

  const state = isAssistRoll ? "assist" : !confirmed ? "working" : passed ? "pass" : "fail";
  const tag = isAssistRoll ? (assistApplied ? "Done" : "Assist") : confirmed ? "Done" : "Working";
  const screen = state === "pass" ? GREEN : state === "fail" ? MAGENTA : CYAN;
  const dice = (list, pool) => diceRow(list, pool, { size: 30, fontSize: 12 });

  // ── Dice monitor ─────────────────────────────────────────────────────────
  const blocks = [];
  {
    const [label, target] = splitTarget(groundMode ? "Crew" : crewDiceHeading);
    blocks.push(block(label, dice(crewDice ?? [], "crew"), { target }));
  }
  // One diceRow call per named assist die, exactly as classic — every one keeps
  // data-index="0". Merging them would renumber the indices the reroll reads.
  for (const b of namedAssistBlocks) {
    const [label, target] = splitTarget(b.heading);
    blocks.push(block(label, dice([b.die], "named-assist"), { target, line: b.subHeading }));
  }
  if ((apAssistDice ?? []).length > 0) {
    blocks.push(block("Helm — Attack Pattern", dice(apAssistDice, "ap-assist")));
  }
  if ((shipDice ?? []).length > 0) {
    // The ship heading arrives as "Ship · Sys + Dept · (target: 10)".
    const [label, target] = splitTarget(String(shipDiceHeading).replace(/\s*·\s*\(target:/i, " (target:"));
    blocks.push(block(label, dice(shipDice, "ship"), { target }));
  }
  const diceScreen = `
  <div class="tmc-scr" style="--tmc-s:${screen};">${blocks.join("")}
  </div>`;

  // ── Notes, on the panel ──────────────────────────────────────────────────
  const notes = [
    ...noteStrips.map(n => ({ tone: n.tone ?? "note", text: n.text })),
    ...traitNotes.map(t => ({
      tone: "trait",
      text: `${esc(t.name)}: ${esc(t.label)}${t.value ? ` (${t.value > 0 ? "+" : ""}${t.value})` : ""}`,
    })),
  ];
  const notesHtml = notes.length ? `
  <div class="tmc-notes">
    ${notes.map(n => `<div class="tmc-note tmc-note--${n.tone}">${n.text}</div>`).join("")}
  </div>` : "";

  // ── Readout monitor ──────────────────────────────────────────────────────
  const resultCell = statCells.find(([label]) => label === "Result");
  const resultValue = resultCell?.[1] ?? "";
  const resultClass = succeedAtCost ? "cost" : passed ? "pass" : "fail";
  const meters = statCells
    .filter(([label]) => label !== "Result")
    .map(([label, value]) => {
      if (label === "Successes")  return meter(label, value);
      if (label === "Difficulty") return meter(label, value, "cyan");
      if (label === "Complic.")   return meter("Complic.", value, "magenta", "tmc-meter--cpx");
      return meter(label, value, /threat/i.test(label) ? "magenta" : "yellow");
    }).join("");

  const resRow = (label, inner, trailing = "") => `
      <div class="tmc-res"><span class="tmc-res-lbl">${label}</span>${inner}${trailing}</div>`;
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
          ? `<span class="tmc-res-sub">${gained.banked} banked${gained.floating > 0 ? ` · ${gained.floating} floating` : ""}</span>`
          : "",
      )
    : "";

  const readoutScreen = !isAssistRoll ? `
  <div class="tmc-scr" style="--tmc-s:${screen};">
    ${block("Task Analysis", `${meters}${spentHtml}${gainedHtml}`)}
    <div class="tmc-result tmc-result--${resultClass}"><strong>${resultValue}</strong><span class="tmc-rule" aria-hidden="true"></span></div>
  </div>` : (gainedHtml || spentHtml ? `
  <div class="tmc-scr" style="--tmc-s:${screen};">${block("Resources", `${spentHtml}${gainedHtml}`)}
  </div>` : "");

  // ── Keys ─────────────────────────────────────────────────────────────────
  const assistKind = ao => ao.type === "direct" ? " (Direct)"
    : ao.type === "methodical-planning" ? " (Methodical Planning)"
    : ao.type === "attack-pattern" ? " (Attack Pattern)" : "";

  const actions = [];
  if (!confirmed && (pendingAssists ?? []).length > 0) {
    actions.push(actionSection("assists", pendingAssists.map((ao, i) => `
      <button class="sta2e-player-assist-roll tmc-key tmc-key--left"
        data-payload="${p}" data-assist-index="${i}" data-filled="1"
        style="${keyStyle("amber")}">Roll Assist Die — ${ao.name}${assistKind(ao)}</button>`).join(""),
      { label: "Pending Assists" }));
  }
  if (showMakeYourOwnLuck) {
    actions.push(actionSection("luck", `
      <button class="sta2e-make-own-luck tmc-key tmc-key--left"
        data-payload="${p}" data-filled="1"
        style="${keyStyle("amber")}">${makeYourOwnLuckSource ?? "Make Your Own Luck"} — suffer 1 Stress, change a failed die to ${crewTarget}</button>`));
  }
  if (!confirmed && !isAssistRoll && rerollButtons.length > 0) {
    actions.push(actionSection("rerolls", rerollButtons.map(rb => `
      <button class="sta2e-player-reroll tmc-key"
        data-payload="${p}"
        data-ability="${rb.ability}"
        data-ability-label="${rb.label}"
        title="${rb.label} — ${rb.labelShort}"
        data-filled="1"
        style="${keyStyle("amber")}">${rerollButtonBody(rb)}</button>`).join(""),
      { label: "Rerolls Available", listClass: "sta2e-task-rerolls" }));
  }

  if (isAssistRoll) {
    actions.push(actionSection("assist-apply", assistApplied
      ? `<div class="sta2e-task-btn tmc-key" style="${keyStyle("off")}">Applied to: ${assistApplied}</div>`
      : `<button class="sta2e-assist-to-roll tmc-key tmc-key--big" data-payload="${p}"
           style="${keyStyle("amber")}">Add to Task Roll →</button>`));
  } else if (confirmed) {
    actions.push(actionSection("confirm", poolButton.visible
      ? `<button class="sta2e-add-to-pool tmc-key tmc-key--big"
           data-pool="${poolButton.pool}"
           data-amount="${poolButton.amount}"
           data-token-id="${poolButton.tokenId}"
           style="${keyStyle(poolButton.pool === "threat" ? "magenta" : "green")}">${poolButton.label}</button>`
      : `<div class="sta2e-task-btn tmc-key tmc-key--big" style="${keyStyle("off")}">Completed</div>`));
  } else {
    const minor = [
      canGmEditCard ? `
        <button class="sta2e-edit-roll-card tmc-key" data-payload="${p}"
          style="${keyStyle("off")}">Edit Results</button>` : "",
      succeedAtCostButton?.visible ? `
        <button class="sta2e-succeed-at-cost tmc-key" data-payload="${p}"
          title="Resolve this task as a success. It gains 1 extra complication; the GM narrates the cost."
          style="${keyStyle("amber")}">${succeedAtCostButton.label}</button>` : "",
    ].filter(Boolean);
    actions.push(actionSection("confirm", `
      ${minor.length ? `<div class="tmc-grid${minor.length === 1 ? " tmc-grid--one" : ""}">${minor.join("")}</div>` : ""}
      <button class="sta2e-player-confirm tmc-key tmc-key--big" data-payload="${p}"
        style="${keyStyle(passed ? "green" : "magenta")}">${confirmLabel}</button>`));
  }

  // TMP Monitor: a code tab (the target number while working) and tick marks
  // in place of the plate and the tag.
  const code = isAssistRoll ? "AST"
    : state === "pass" ? "OK"
    : state === "fail" ? "NEG"
    : crewTarget != null ? `T-${crewTarget}` : "TSK";
  const head = monitor ? `
  <div class="tmc-head">
    <span class="tmc-code">${code}</span>
    <div class="tmc-title">${headerTitle}${headerSub ? `<small>${headerSub}</small>` : ""}</div>
    <span class="tmc-ticks" aria-hidden="true"><i></i><i></i><i></i></span>
  </div>` : `
  <div class="tmc-head">
    <span class="tmc-plate" aria-hidden="true"></span>
    <div class="tmc-title">${headerTitle}${headerSub ? `<small>${headerSub}</small>` : ""}</div>
    <span class="tmc-tag">${tag}</span>
  </div>`;

  return `
<div class="sta2e-task-card sta2e-task-card--tmp${monitor ? " sta2e-task-card--tmpmon" : ""}" data-theme="${getActiveLcThemeKey()}"
  style="${getLcCssVars("tc")}--tmc-plate:${PLATE[state]};${monitor ? `--tmm-tab:${screen};` : ""}font-family:${LC.font};">${head}
  ${diceScreen}
  ${notesHtml}
  ${readoutScreen}
  ${actions.join("")}
</div>`;
}
