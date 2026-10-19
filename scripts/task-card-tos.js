/**
 * sta2e-toolkit | task-card-tos.js
 *
 * The TOS "Console Viewer" skin for the interactive Working Results task card,
 * used whenever the active theme is `tos-panel` (whatever `taskCardStyle` says —
 * classic and slim are both LCARS shapes, which TOS never had). Dispatched from
 * buildPlayerRollCardHtml() in npc-roller.js with the same prepared `view` the
 * slim skin receives, so all three skins render the same content.
 *
 * Look: a gunmetal console housing with indicator lamps, curved CRT screens set
 * into it for the dice and the readout (phosphor type, dot leaders, scanlines),
 * and raised backlit keys. Shape lives in styles/task-card-tos.css.
 *
 * ── DOM contract (do not break) — same as the slim skin ─────────────────────
 *  • `.sta2e-working-actions` (+ --assists/--luck/--rerolls/--assist-apply/
 *    --confirm) wraps every interactive section and stays a plain BLOCK: the
 *    reroll tray is appended to `armBtn.closest(".sta2e-working-actions")`, and
 *    non-authorised users have these wrappers removed wholesale.
 *  • Dice come from the shared `diceRow` — `span.sta2e-card-die[data-pool]
 *    [data-index]` with a real d20 <img> inside, because setCardDieState paints
 *    selection by writing that image's opacity and filter.
 *  • Buttons keep their classes and every data-* attribute they carry.
 *
 * ── Styling rule (do not break) ─────────────────────────────────────────────
 * _armCardSelection() round-trips a button through `style.cssText` and writes
 * background / border-color / color / opacity while a reroll is armed. So a
 * key's colour is entirely inline (`keyStyle`), and the stylesheet only gives
 * it shape — padding, type, and the raised bevel, which is a box-shadow that
 * function never touches. Every key carries `data-filled="1"`, so arming
 * inverts it to a lit yellow key instead of darkening it. No inline
 * border-radius anywhere, and no `!important` in the stylesheet.
 */

import { getLcTokens, getLcCssVars, getActiveLcThemeKey } from "./lcars-theme.js";

const LC = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });

const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]));

/** The four backlit key colours of the TOS bridge panels. */
const KEYS = {
  amber: ["#e8c030", "#c8a010", "#aa8808", "#1a1200"],
  red:   ["#e83020", "#c81808", "#a81000", "#fff0ee"],
  green: ["#40cc30", "#28aa18", "#188808", "#001a00"],
  grey:  ["#666666", "#4a4a4a", "#3a3a3a", "#eeeeee"],
};

/** A key's whole colour, inline (see the styling rule above). */
const keyStyle = kind => {
  const [top, mid, low, ink] = KEYS[kind] ?? KEYS.amber;
  return `background:linear-gradient(180deg,${top} 0%,${mid} 60%,${low} 100%);color:${ink};`;
};

/** Phosphor screen hue per card state. */
const SCREEN = {
  green: "#9ee26a",
  amber: "#f0c860",
  red:   "#ff7a5a",
};

/** Split "Reason + Science (target: 12)" into its label and target. */
const splitTarget = heading => {
  const m = String(heading ?? "").match(/^(.*?)\s*\(target:\s*([^)]*)\)\s*$/i);
  return m ? [m[1], `T${m[2]}`] : [String(heading ?? ""), ""];
};

const screenLabel = (heading, sub = "") => {
  const [label, target] = splitTarget(heading);
  return `<div class="tct-lbl"><span>${label}</span>${target ? `<span>${target}</span>` : ""}</div>${
    sub ? `<div class="tct-sub">${sub}</div>` : ""}`;
};

const lead = (label, value, cls = "") => `
    <div class="tct-lead${cls ? ` ${cls}` : ""}"><span>${label}</span><span class="tct-dots" aria-hidden="true"></span><span>${value}</span></div>`;

/** An action section. The wrapper stays a block; any grid goes on the inner list. */
const actionSection = (modifier, inner, { label = "", listClass = "" } = {}) => `
  <div class="sta2e-working-actions sta2e-working-actions--${modifier} tct-sect">
    ${label ? `<div class="tct-sect-lbl">${label}</div>` : ""}
    <div class="tct-btns${listClass ? ` ${listClass}` : ""}">${inner}</div>
  </div>`;

/**
 * Render the TOS skin.
 *
 * @param {object} view Prepared view from buildPlayerRollCardHtml.
 * @returns {string} HTML string.
 */
export function renderTosTaskCard(view) {
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

  // Lamps: amber while working, green on a pass, red on a fail.
  const lamps = isAssistRoll ? ["a", "off", "off"]
    : !confirmed ? ["a", "off", passed ? "g" : "r"]
      : passed ? ["g", "g", "off"] : ["r", "off", "off"];

  // ── Dice screen ───────────────────────────────────────────────────────────
  const blocks = [];
  blocks.push(`${groundMode ? screenLabel("Crew") : screenLabel(crewDiceHeading)}${diceRow(crewDice ?? [], "crew")}`);
  // One diceRow call per named assist die, exactly as classic — every one keeps
  // data-index="0". Merging them would renumber the indices the reroll reads.
  for (const b of namedAssistBlocks) {
    blocks.push(`${screenLabel(b.heading, b.subHeading)}${diceRow([b.die], "named-assist")}`);
  }
  if ((apAssistDice ?? []).length > 0) {
    blocks.push(`${screenLabel("Helm — Attack Pattern")}${diceRow(apAssistDice, "ap-assist")}`);
  }
  if ((shipDice ?? []).length > 0) {
    // The ship heading arrives as "Ship · Sys + Dept · (target: 10)".
    const shipHeading = String(shipDiceHeading).replace(/\s*·\s*\(target:/i, " (target:");
    blocks.push(`${screenLabel(shipHeading)}${diceRow(shipDice, "ship")}`);
  }
  const diceScreen = `
  <div class="tct-crt" style="--tct-ph:${SCREEN.green};">
    ${blocks.map((b, i) => `<div class="tct-blk${i ? " tct-blk--more" : ""}">${b}</div>`).join("")}
  </div>`;

  // ── Notes: talent strips, ship badges and applied traits ─────────────────
  const notes = [
    ...noteStrips.map(n => ({ tone: n.tone ?? "note", text: n.text })),
    ...traitNotes.map(t => ({
      tone: "trait",
      text: `${esc(t.name)}: ${esc(t.label)}${t.value ? ` (${t.value > 0 ? "+" : ""}${t.value})` : ""}`,
    })),
  ];
  const notesHtml = notes.length ? `
  <div class="tct-notes">
    ${notes.map(n => `<div class="tct-note tct-note--${n.tone}">${n.text}</div>`).join("")}
  </div>` : "";

  // ── Readout screen ────────────────────────────────────────────────────────
  const resultCell = statCells.find(([label]) => label === "Result");
  const resultValue = resultCell?.[1] ?? "";
  const resultClass = succeedAtCost ? "cost" : passed ? "pass" : "fail";
  const readoutRows = statCells
    .filter(([label]) => label !== "Result")
    .map(([label, value]) => lead(
      label === "Complic." ? "Complications" : label,
      String(value).padStart(2, "0"),
      label === "Complic." ? "tct-lead--cpx" : "",
    )).join("");

  const resRow = (label, inner, trailing = "") => `
    <div class="tct-res"><span class="tct-res-lbl">${label}</span>${inner}${trailing}</div>`;
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
          ? `<span class="tct-res-sub">${gained.banked} banked${gained.floating > 0 ? ` · ${gained.floating} floating` : ""}</span>`
          : "",
      )
    : "";

  const readoutScreen = !isAssistRoll ? `
  <div class="tct-crt" style="--tct-ph:${SCREEN.green};">
    ${readoutRows}
    ${spentHtml}
    ${gainedHtml}
    <div class="tct-result"><span>Result</span><strong class="tct-result--${resultClass}">${resultValue}</strong></div>
  </div>` : (gainedHtml || spentHtml ? `
  <div class="tct-crt" style="--tct-ph:${SCREEN.green};">${spentHtml}${gainedHtml}</div>` : "");

  // ── Keys ──────────────────────────────────────────────────────────────────
  const assistKind = ao => ao.type === "direct" ? " (Direct)"
    : ao.type === "methodical-planning" ? " (Methodical Planning)"
    : ao.type === "attack-pattern" ? " (Attack Pattern)" : "";

  const actions = [];
  if (!confirmed && (pendingAssists ?? []).length > 0) {
    actions.push(actionSection("assists", pendingAssists.map((ao, i) => `
      <button class="sta2e-player-assist-roll tct-key tct-key--wide tct-key--left"
        data-payload="${p}" data-assist-index="${i}" data-filled="1"
        style="${keyStyle("amber")}">Roll Assist Die — ${ao.name}${assistKind(ao)}</button>`).join(""),
      { label: "Pending Assists" }));
  }
  if (showMakeYourOwnLuck) {
    actions.push(actionSection("luck", `
      <button class="sta2e-make-own-luck tct-key tct-key--wide tct-key--left"
        data-payload="${p}" data-filled="1"
        style="${keyStyle("amber")}">${makeYourOwnLuckSource ?? "Make Your Own Luck"} — suffer 1 Stress, change a failed die to ${crewTarget}</button>`));
  }
  if (!confirmed && !isAssistRoll && rerollButtons.length > 0) {
    actions.push(actionSection("rerolls", rerollButtons.map(rb => `
      <button class="sta2e-player-reroll tct-key tct-key--left"
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
      ? `<div class="sta2e-task-btn tct-key tct-key--wide" style="${keyStyle("grey")}">Applied to: ${assistApplied}</div>`
      : `<button class="sta2e-assist-to-roll tct-key tct-key--wide tct-key--big" data-payload="${p}"
           style="${keyStyle("amber")}">Add to Task Roll →</button>`));
  } else if (confirmed) {
    actions.push(actionSection("confirm", poolButton.visible
      ? `<button class="sta2e-add-to-pool tct-key tct-key--wide tct-key--big"
           data-pool="${poolButton.pool}"
           data-amount="${poolButton.amount}"
           data-token-id="${poolButton.tokenId}"
           style="${keyStyle(poolButton.pool === "threat" ? "red" : "amber")}">${poolButton.label}</button>`
      : `<div class="sta2e-task-btn tct-key tct-key--wide tct-key--big" style="${keyStyle("grey")}">Completed</div>`));
  } else {
    const minor = [
      canGmEditCard ? `
        <button class="sta2e-edit-roll-card tct-key" data-payload="${p}"
          style="${keyStyle("grey")}">Edit Results</button>` : "",
      succeedAtCostButton?.visible ? `
        <button class="sta2e-succeed-at-cost tct-key" data-payload="${p}"
          title="Resolve this task as a success. It gains 1 extra complication; the GM narrates the cost."
          style="${keyStyle("amber")}">${succeedAtCostButton.label}</button>` : "",
    ].filter(Boolean);
    actions.push(actionSection("confirm", `
      ${minor.length ? `<div class="tct-grid${minor.length === 1 ? " tct-grid--one" : ""}">${minor.join("")}</div>` : ""}
      <button class="sta2e-player-confirm tct-key tct-key--wide tct-key--big" data-payload="${p}"
        style="${keyStyle(passed ? "green" : "red")}">${confirmLabel}</button>`));
  }

  return `
<div class="sta2e-task-card sta2e-task-card--tos" data-theme="${getActiveLcThemeKey()}"
  style="${getLcCssVars("tc")}font-family:${LC.font};">
  <div class="tct-head">
    <div class="tct-title">${headerTitle}${headerSub ? `<small>${headerSub}</small>` : ""}</div>
    <div class="tct-lamps" aria-hidden="true">${lamps.map(l => `<i class="tct-lamp tct-lamp--${l}"></i>`).join("")}</div>
  </div>
  ${diceScreen}
  ${notesHtml}
  ${readoutScreen}
  ${actions.length ? `<div class="tct-strut" aria-hidden="true"></div>${actions.join("")}` : ""}
</div>`;
}
