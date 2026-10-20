/**
 * sta2e-toolkit | task-card-romulan.js
 *
 * The Romulan "Raptor Wing" skin for the interactive Working Results task card,
 * used whenever the active theme is `romulan` (whatever `taskCardStyle` says,
 * as with TOS, TMP, TNG, ENT and Klingon). Dispatched from
 * buildPlayerRollCardHtml() in npc-roller.js with the same prepared `view` the
 * other skins receive, so all of them render the same content. Shape lives in
 * styles/task-card-romulan.css; the design source is
 * docs/romulan-card-mockups.html (Concept A).
 *
 * Look: the Romulan Stardate HUD opened out into a card — cold green on a fine
 * grid, diamond separators, nothing round. The header is the warbird seen
 * head-on: two swept wings rising out of a central title, with a diamond-led
 * code under it. Dice sit in hexagonal wells, readouts are chamfered cells,
 * Successes against Difficulty is a row of diamonds (the Difficulty red), and
 * the result is a full-width hex plate. The frame colour (`--trw-c`) gives the
 * state. The chat card frame's Romulan path (romulanChatCard in
 * chat-card-frame.js) builds the same frame with the same `trw-*` classes, so
 * the frame exists once in CSS.
 *
 * ── DOM contract (do not break) — same as the slim, TOS, TMP, TNG, ENT and Klingon skins ──
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
 * shape. The keys are dark hex keys EDGED in their colour, not filled, so they
 * carry no `data-filled`: arming takes the unfilled path (yellow text on dark
 * glass), and restoring cssText brings the coloured ends back.
 *
 * No inline border-radius anywhere, no inline font-family, and no `!important`
 * in the stylesheet. The typefaces (bundled Oxanium, and the Share Tech Mono
 * the TMP stylesheet already declares) come from `.trw`.
 */

import { getLcCssVars, getActiveLcThemeKey } from "./lcars-theme.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]));

/**
 * The frame's colours: the `romulan` tokens from lcars-theme.js, plus the
 * brighter shades the card needs for type on black (the token green #22aa44
 * is also the success colour, so a crit needs the gold).
 */
export const ROM = {
  green: "#22aa44", jade: "#44dd88", lit: "#5cf09a", sage: "#669966",
  gold: "#d8c050", lime: "#aacc33", teal: "#40c8b0", amber: "#e08a2a",
  alarm: "#ff4a5a", moss: "#3e5c48",
};

/** Colour by role. */
const P = {
  working: ROM.green, assist: ROM.sage, pass: ROM.gold, fail: ROM.alarm,
  rerolls: [ROM.lime, ROM.jade, ROM.teal, ROM.gold, ROM.sage, ROM.amber],
  assistKey: ROM.sage, luck: ROM.gold, dim: ROM.moss, addToRoll: ROM.jade,
  poolMomentum: ROM.gold, poolThreat: ROM.alarm, edit: ROM.sage, cost: ROM.amber,
  confirmPass: ROM.lit, confirmFail: ROM.alarm,
};

const parseHex = h => {
  const s = String(h).replace("#", "");
  const full = s.length === 3 ? s.replace(/./g, c => c + c) : s.slice(0, 6);
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
};

/** Mix `hex` toward `toward`, `amount` 0..1 of `toward`. */
function mix(hex, toward, amount) {
  const a = parseHex(hex), b = parseHex(toward);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return hex;
  return `#${a.map((v, i) => Math.round(v * (1 - amount) + b[i] * amount).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A key's whole colour, inline (see the note above): dark glass with a 3px end
 * in the key's colour at each side — the hex clip turns the ends into
 * chevrons — and the label in a lightened shade of it. The gradient is the
 * `background`, which arming replaces and restoring cssText brings back.
 */
export const keyStyle = colour =>
  `--k:${colour};background:linear-gradient(90deg,${colour} 0 3px,#021a0c 3px calc(100% - 3px),${colour} calc(100% - 3px));`
  + `border-color:${colour};color:${mix(colour, "#ffffff", 0.3)};`;

/** Split "Reason + Science (target: 12)" into its label and target. */
const splitTarget = heading => {
  const m = String(heading ?? "").match(/^(.*?)\s*\(target:\s*([^)]*)\)\s*$/i);
  return m ? [m[1], `T ${m[2]}`] : [String(heading ?? ""), ""];
};

/** A dice group in a hexagonal well, its label and target along the top. */
const well = (label, inner, { target = "", line = "" } = {}) => `
    <div class="trw-well">
      <div class="trw-lbl"><span>${label}</span>${target ? `<span>${target}</span>` : ""}</div>
      ${line ? `<div class="trw-line">${line}</div>` : ""}
      ${inner}
    </div>`;

/**
 * A row of diamonds, `total` long: the first `difficulty` are the Difficulty
 * (red), and the first `lit` are lit.
 */
export const diamondMeter = (lit, total, difficulty = 0) => {
  const out = [];
  for (let i = 0; i < total; i++) {
    const cls = [i < difficulty ? "d" : "", i < lit ? "on" : ""].filter(Boolean).join(" ");
    out.push(cls ? `<i class="${cls}"></i>` : "<i></i>");
  }
  return `<div class="trw-dia" aria-hidden="true">${out.join("")}</div>`;
};

/** A readout cell: label over value. */
const cell = (label, value, cls = "") =>
  `<div class="trw-cell${cls ? ` ${cls}` : ""}"><span>${label}</span><b>${value}</b></div>`;

/** An action section. The wrapper stays a block; the key grid is the inner list. */
const actionSection = (modifier, inner, { label = "", listClass = "" } = {}) => `
  <div class="sta2e-working-actions sta2e-working-actions--${modifier} trw-actions">
    ${label ? `<div class="trw-sect-lbl">${label}</div>` : ""}
    <div class="trw-pad${listClass ? ` ${listClass}` : ""}">${inner}</div>
  </div>`;

/**
 * The frame's header, shared with the chat card frame and the dice roller: the
 * title between two swept wings, and an optional code on the diamond line
 * under it.
 */
export const romulanHead = (title, code = "") => `
  <div class="trw-head">
    <i class="trw-wing trw-wing--l" aria-hidden="true"></i>
    <div class="trw-title">${title ?? ""}</div>
    <i class="trw-wing trw-wing--r" aria-hidden="true"></i>
  </div>
  <div class="trw-code">${code}</div>`;

/** The flavour word set beside a pass: the rules term always comes first. */
const RESULT_WORD = { pass: "mnhei'sahe", fail: "", cost: "" };

/**
 * Render the Romulan skin.
 *
 * @param {object} view Prepared view from buildPlayerRollCardHtml.
 * @returns {string} HTML string.
 */
export function renderRomulanTaskCard(view) {
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

  const state = isAssistRoll ? "assist" : !confirmed ? "working" : passed ? "pass" : "fail";
  const status = isAssistRoll ? (assistApplied ? "Applied" : "Assist")
    : confirmed ? finalResultLabel : "Working";
  const dice = (list, pool) => diceRow(list, pool, { size: 30, fontSize: 12 });

  const difficulty = Number(statCells.find(([l]) => l === "Difficulty")?.[1]);
  const successes = Number(statCells.find(([l]) => l === "Successes")?.[1]);

  // ── Dice ─────────────────────────────────────────────────────────────────
  const wells = [];
  {
    const [label, target] = splitTarget(groundMode ? "Crew" : crewDiceHeading);
    wells.push(well(label, dice(crewDice ?? [], "crew"), { target }));
  }
  // One diceRow call per named assist die, exactly as classic — every one keeps
  // data-index="0". Merging them would renumber the indices the reroll reads.
  for (const b of namedAssistBlocks) {
    const [label, target] = splitTarget(b.heading);
    wells.push(well(label, dice([b.die], "named-assist"), { target, line: b.subHeading }));
  }
  if ((apAssistDice ?? []).length > 0) {
    wells.push(well("Helm — Attack Pattern", dice(apAssistDice, "ap-assist")));
  }
  if ((shipDice ?? []).length > 0) {
    // The ship heading arrives as "Ship · Sys + Dept · (target: 10)".
    const [label, target] = splitTarget(String(shipDiceHeading).replace(/\s*·\s*\(target:/i, " (target:"));
    wells.push(well(label, dice(shipDice, "ship"), { target }));
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
    <div class="trw-notes">
      ${notes.map(n => `<div class="trw-note trw-note--${n.tone}">${n.text}</div>`).join("")}
    </div>` : "";

  // ── Readout ──────────────────────────────────────────────────────────────
  // Chamfered cells, then the diamond meter: as long as the larger of
  // Successes and Difficulty (at least six, at most sixteen), the Difficulty
  // red at its head.
  const resultCell = statCells.find(([label]) => label === "Result");
  const resultValue = resultCell?.[1] ?? "";
  const resultClass = succeedAtCost ? "cost" : passed ? "pass" : "fail";
  const cells = statCells
    .filter(([label]) => label !== "Result")
    .map(([label, value]) => {
      if (label === "Complic." || /threat/i.test(label)) return cell(label, value, "trw-cell--red");
      if (label === "Momentum") return cell(label, value, "trw-cell--gold");
      return cell(label, value);
    }).join("");
  let meter = "";
  if (Number.isFinite(successes)) {
    const diff = Number.isFinite(difficulty) ? difficulty : 0;
    const total = Math.min(16, Math.max(6, successes, diff));
    meter = diamondMeter(Math.min(successes, total), total, Math.min(diff, total));
  }

  const resRow = (label, inner, trailing = "") => `
      <div class="trw-res"><span class="trw-res-lbl">${label}</span>${inner}${trailing}</div>`;
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
          ? `<span class="trw-res-sub">${gained.banked} banked${gained.floating > 0 ? ` · ${gained.floating} floating` : ""}</span>`
          : "",
      )
    : "";

  const word = confirmed ? RESULT_WORD[resultClass] : "";
  const readout = !isAssistRoll ? `
    <div class="trw-read">${cells}</div>
    ${meter}
    ${spentHtml}${gainedHtml}
    <div class="trw-result trw-result--${resultClass}"><strong>${resultValue}</strong>${word ? `<small>${word}</small>` : ""}</div>`
    : `${spentHtml}${gainedHtml}`;

  // ── Keys ─────────────────────────────────────────────────────────────────
  const assistKind = ao => ao.type === "direct" ? " (Direct)"
    : ao.type === "methodical-planning" ? " (Methodical Planning)"
    : ao.type === "attack-pattern" ? " (Attack Pattern)" : "";

  const actions = [];
  if (!confirmed && (pendingAssists ?? []).length > 0) {
    actions.push(actionSection("assists", pendingAssists.map((ao, i) => `
      <button class="sta2e-player-assist-roll trw-key trw-key--wide"
        data-payload="${p}" data-assist-index="${i}"
        style="${keyStyle(P.assistKey)}">Roll Assist Die — ${ao.name}${assistKind(ao)}</button>`).join(""),
      { label: "Pending Assists" }));
  }
  if (showMakeYourOwnLuck) {
    actions.push(actionSection("luck", `
      <button class="sta2e-make-own-luck trw-key trw-key--wide"
        data-payload="${p}"
        style="${keyStyle(P.luck)}">${makeYourOwnLuckSource ?? "Make Your Own Luck"} — suffer 1 Stress, change a failed die to ${crewTarget}</button>`));
  }
  if (!confirmed && !isAssistRoll && rerollButtons.length > 0) {
    actions.push(actionSection("rerolls", rerollButtons.map((rb, i) => `
      <button class="sta2e-player-reroll trw-key"
        data-payload="${p}"
        data-ability="${rb.ability}"
        data-ability-label="${rb.label}"
        title="${rb.label} — ${rb.labelShort}"
        style="${keyStyle(P.rerolls[i % P.rerolls.length])}">${rerollButtonBody(rb)}</button>`).join(""),
      { label: "Rerolls Available", listClass: "sta2e-task-rerolls" }));
  }

  if (isAssistRoll) {
    actions.push(actionSection("assist-apply", assistApplied
      ? `<div class="sta2e-task-btn trw-key trw-key--wide" style="${keyStyle(P.dim)}">Applied to: ${assistApplied}</div>`
      : `<button class="sta2e-assist-to-roll trw-key trw-key--wide" data-payload="${p}"
           style="${keyStyle(P.addToRoll)}">Add to Task Roll →</button>`));
  } else if (confirmed) {
    actions.push(actionSection("confirm", poolButton.visible
      ? `<button class="sta2e-add-to-pool trw-key trw-key--wide"
           data-pool="${poolButton.pool}"
           data-amount="${poolButton.amount}"
           data-token-id="${poolButton.tokenId}"
           style="${keyStyle(poolButton.pool === "threat" ? P.poolThreat : P.poolMomentum)}">${poolButton.label}</button>`
      : `<div class="sta2e-task-btn trw-key trw-key--wide" style="${keyStyle(P.dim)}">Completed</div>`));
  } else {
    const keys = [
      canGmEditCard ? `
        <button class="sta2e-edit-roll-card trw-key" data-payload="${p}"
          style="${keyStyle(P.edit)}">Edit Results</button>` : "",
      succeedAtCostButton?.visible ? `
        <button class="sta2e-succeed-at-cost trw-key" data-payload="${p}"
          title="Resolve this task as a success. It gains 1 extra complication; the GM narrates the cost."
          style="${keyStyle(P.cost)}">${succeedAtCostButton.label}</button>` : "",
      `
        <button class="sta2e-player-confirm trw-key trw-key--wide" data-payload="${p}"
          style="${keyStyle(passed ? P.confirmPass : P.confirmFail)}">${confirmLabel}</button>`,
    ].filter(Boolean);
    actions.push(actionSection("confirm", keys.join("")));
  }

  return `
<div class="sta2e-task-card sta2e-task-card--romulan trw" data-theme="${getActiveLcThemeKey()}"
  style="${getLcCssVars("tc")}--trw-c:${P[state]};">
  ${romulanHead(title, status)}
  <div class="trw-body">
    ${sub ? `<div class="trw-sub">${sub}</div>` : ""}
    ${wells.join("")}
    ${notesHtml}
    ${readout}
    ${actions.join("")}
  </div>
</div>`;
}
