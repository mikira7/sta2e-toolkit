/**
 * sta2e-toolkit | task-card-klingon.js
 *
 * The Klingon "Targeting Scope" skin for the interactive Working Results task
 * card, used whenever the active theme is `klingon` (whatever `taskCardStyle`
 * says, as with TOS, TMP, TNG and ENT). Dispatched from buildPlayerRollCardHtml()
 * in npc-roller.js with the same prepared `view` the other skins receive, so all
 * of them render the same content. Shape lives in styles/task-card-klingon.css;
 * the design source is docs/klingon-card-mockups.html (Concept C).
 *
 * Look: the film-era Klingon bridge — a dim red housing round a green-black
 * phosphor scope with a faint reticle and scanlines, and the triangle
 * everywhere: the viewer's inverted triangle as the header lamp, dice in
 * hexagonal cells, Successes against Difficulty as a run of interlocking
 * triangles, keys cut wider at the top. The card's state is the scope's
 * phosphor colour (`--tkc-c`), not the housing. The chat card frame's Klingon
 * path (klingonChatCard in chat-card-frame.js) builds the same frame with the
 * same `tkc-*` classes, so the frame exists once in CSS.
 *
 * ── DOM contract (do not break) — same as the slim, TOS, TMP, TNG and ENT skins ──
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
 * shape. The keys are backlit plates, so every one carries `data-filled="1"`:
 * arming lights it yellow rather than darkening it.
 *
 * No inline border-radius anywhere, no inline font-family, and no `!important`
 * in the stylesheet. The typefaces (bundled Chakra Petch, and the Share Tech
 * Mono the TMP stylesheet already declares) come from `.tkc`.
 */

import { getLcCssVars, getActiveLcThemeKey } from "./lcars-theme.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]));

/**
 * The scope's colours: the `klingon` tokens from lcars-theme.js for the
 * housing and keys, plus the phosphors the scope needs to read on its
 * green-black glass (the tokens' own green, #886600, is an olive made for
 * the red HUD).
 */
export const KLI = {
  phosphor: "#6fd24a", gold: "#ffd84a", alarm: "#ff5a40", amber: "#ffaa3a",
  red: "#d23a1c", bronze: "#c08a30", rust: "#7a5040", housing: "#3a0807",
};

/** Colour by role. */
const P = {
  working: KLI.phosphor, assist: KLI.amber, pass: KLI.gold, fail: KLI.alarm,
  rerolls: [KLI.red, KLI.bronze, KLI.amber, KLI.phosphor, KLI.rust, KLI.alarm],
  assistKey: KLI.amber, luck: KLI.gold, dim: KLI.rust, addToRoll: KLI.phosphor,
  poolMomentum: KLI.gold, poolThreat: KLI.alarm, edit: KLI.rust, cost: KLI.amber,
  confirmPass: KLI.gold, confirmFail: KLI.rust,
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

const luma = hex => {
  const [r, g, b] = parseHex(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/**
 * A key's whole colour, inline (see the note above): a backlit plate lit from
 * the top, with dark ink on a bright plate and light ink on a dark one. The
 * gradient is the `background`, which arming replaces and restoring cssText
 * brings back.
 */
export const keyStyle = colour =>
  `--k:${colour};background:linear-gradient(180deg,${mix(colour, "#ffffff", 0.3)},${colour} 55%,${mix(colour, "#000000", 0.3)});`
  + `color:${luma(colour) > 0.42 ? "#1a0200" : "#ffe6dc"};`;

/** Split "Reason + Science (target: 12)" into its label and target. */
const splitTarget = heading => {
  const m = String(heading ?? "").match(/^(.*?)\s*\(target:\s*([^)]*)\)\s*$/i);
  return m ? [m[1], `T ${m[2]}`] : [String(heading ?? ""), ""];
};

/** A dice group on the scope, its label and target along the top. */
const well = (label, inner, { target = "", line = "" } = {}) => `
    <div class="tkc-well">
      <div class="tkc-lbl"><span>${label}</span>${target ? `<span>${target}</span>` : ""}</div>
      ${line ? `<div class="tkc-line">${line}</div>` : ""}
      ${inner}
    </div>`;

/**
 * A run of interlocking triangles, `total` long: the first `difficulty` are
 * the Difficulty (red), and the first `lit` are lit.
 */
export const triangleMeter = (lit, total, difficulty = 0) => {
  const out = [];
  for (let i = 0; i < total; i++) {
    const cls = [i < difficulty ? "d" : "", i < lit ? "on" : ""].filter(Boolean).join(" ");
    out.push(cls ? `<i class="${cls}"></i>` : "<i></i>");
  }
  return `<span class="tkc-tris" aria-hidden="true">${out.join("")}</span>`;
};

/** A readout row: label and value, with an optional meter under both. */
const readRow = (label, value, { meter = "", cls = "" } = {}) => `
      <div class="tkc-row${cls ? ` ${cls}` : ""}"><span>${label}</span><b>${value}</b>${meter}</div>`;

/** An action section. The wrapper stays a block; the key grid is the inner list. */
const actionSection = (modifier, inner, { label = "", listClass = "" } = {}) => `
  <div class="sta2e-working-actions sta2e-working-actions--${modifier} tkc-actions">
    ${label ? `<div class="tkc-sect-lbl">${label}</div>` : ""}
    <div class="tkc-pad${listClass ? ` ${listClass}` : ""}">${inner}</div>
  </div>`;

/**
 * The frame's header, shared with the chat card frame: the title, an optional
 * code, and the viewer's inverted triangle as a lamp, which may carry a short
 * readout.
 */
export const klingonHead = (title, code = "", lamp = "") => `
  <div class="tkc-head">
    <div class="tkc-title">${title ?? ""}</div>
    ${code ? `<span class="tkc-code">${code}</span>` : ""}
    <span class="tkc-tri" aria-hidden="true">${lamp}</span>
  </div>`;

/** The flavour word set beside a result: the rules term always comes first. */
const RESULT_WORD = { pass: "Qapla'", fail: "bIlujpu'", cost: "" };

/**
 * Render the Klingon skin.
 *
 * @param {object} view Prepared view from buildPlayerRollCardHtml.
 * @returns {string} HTML string.
 */
export function renderKlingonTaskCard(view) {
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
  // The lamp carries the Difficulty, the number the whole roll is aimed at.
  const lamp = Number.isFinite(difficulty) && !isAssistRoll ? `D${difficulty}` : "";

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
    <div class="tkc-notes">
      ${notes.map(n => `<div class="tkc-note tkc-note--${n.tone}">${n.text}</div>`).join("")}
    </div>` : "";

  // ── Readout ──────────────────────────────────────────────────────────────
  // The meter rides the Successes row: as long as the larger of the two (at
  // least six, at most twenty), the Difficulty in red at its head.
  const resultCell = statCells.find(([label]) => label === "Result");
  const resultValue = resultCell?.[1] ?? "";
  const resultClass = succeedAtCost ? "cost" : passed ? "pass" : "fail";
  const rows = statCells
    .filter(([label]) => label !== "Result")
    .map(([label, value]) => {
      if (label === "Successes" && Number.isFinite(successes)) {
        const diff = Number.isFinite(difficulty) ? difficulty : 0;
        const total = Math.min(20, Math.max(6, successes, diff));
        return readRow(label, value, { meter: triangleMeter(Math.min(successes, total), total, Math.min(diff, total)) });
      }
      if (label === "Complic.") return readRow(label, value, { cls: "tkc-row--cpx" });
      if (/threat/i.test(label)) return readRow(label, value, { cls: "tkc-row--threat" });
      return readRow(label, value);
    }).join("");

  const resRow = (label, inner, trailing = "") => `
      <div class="tkc-res"><span class="tkc-res-lbl">${label}</span>${inner}${trailing}</div>`;
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
          ? `<span class="tkc-res-sub">${gained.banked} banked${gained.floating > 0 ? ` · ${gained.floating} floating` : ""}</span>`
          : "",
      )
    : "";

  const word = confirmed ? RESULT_WORD[resultClass] : "";
  const readout = !isAssistRoll ? `
    <div class="tkc-read">${rows}${spentHtml}${gainedHtml}</div>
    <div class="tkc-result tkc-result--${resultClass}"><strong>${resultValue}</strong>${word ? `<small>${word}</small>` : ""}</div>`
    : (gainedHtml || spentHtml ? `
    <div class="tkc-read">${spentHtml}${gainedHtml}</div>` : "");

  // ── Keys ─────────────────────────────────────────────────────────────────
  const assistKind = ao => ao.type === "direct" ? " (Direct)"
    : ao.type === "methodical-planning" ? " (Methodical Planning)"
    : ao.type === "attack-pattern" ? " (Attack Pattern)" : "";

  const actions = [];
  if (!confirmed && (pendingAssists ?? []).length > 0) {
    actions.push(actionSection("assists", pendingAssists.map((ao, i) => `
      <button class="sta2e-player-assist-roll tkc-key tkc-key--wide" data-filled="1"
        data-payload="${p}" data-assist-index="${i}"
        style="${keyStyle(P.assistKey)}">Roll Assist Die — ${ao.name}${assistKind(ao)}</button>`).join(""),
      { label: "Pending Assists" }));
  }
  if (showMakeYourOwnLuck) {
    actions.push(actionSection("luck", `
      <button class="sta2e-make-own-luck tkc-key tkc-key--wide" data-filled="1"
        data-payload="${p}"
        style="${keyStyle(P.luck)}">${makeYourOwnLuckSource ?? "Make Your Own Luck"} — suffer 1 Stress, change a failed die to ${crewTarget}</button>`));
  }
  if (!confirmed && !isAssistRoll && rerollButtons.length > 0) {
    actions.push(actionSection("rerolls", rerollButtons.map((rb, i) => `
      <button class="sta2e-player-reroll tkc-key" data-filled="1"
        data-payload="${p}"
        data-ability="${rb.ability}"
        data-ability-label="${rb.label}"
        title="${rb.label} — ${rb.labelShort}"
        style="${keyStyle(P.rerolls[i % P.rerolls.length])}">${rerollButtonBody(rb)}</button>`).join(""),
      { label: "Rerolls Available", listClass: "sta2e-task-rerolls" }));
  }

  if (isAssistRoll) {
    actions.push(actionSection("assist-apply", assistApplied
      ? `<div class="sta2e-task-btn tkc-key tkc-key--wide" data-filled="1" style="${keyStyle(P.dim)}">Applied to: ${assistApplied}</div>`
      : `<button class="sta2e-assist-to-roll tkc-key tkc-key--wide" data-filled="1" data-payload="${p}"
           style="${keyStyle(P.addToRoll)}">Add to Task Roll →</button>`));
  } else if (confirmed) {
    actions.push(actionSection("confirm", poolButton.visible
      ? `<button class="sta2e-add-to-pool tkc-key tkc-key--wide" data-filled="1"
           data-pool="${poolButton.pool}"
           data-amount="${poolButton.amount}"
           data-token-id="${poolButton.tokenId}"
           style="${keyStyle(poolButton.pool === "threat" ? P.poolThreat : P.poolMomentum)}">${poolButton.label}</button>`
      : `<div class="sta2e-task-btn tkc-key tkc-key--wide" data-filled="1" style="${keyStyle(P.dim)}">Completed</div>`));
  } else {
    const keys = [
      canGmEditCard ? `
        <button class="sta2e-edit-roll-card tkc-key" data-filled="1" data-payload="${p}"
          style="${keyStyle(P.edit)}">Edit Results</button>` : "",
      succeedAtCostButton?.visible ? `
        <button class="sta2e-succeed-at-cost tkc-key" data-filled="1" data-payload="${p}"
          title="Resolve this task as a success. It gains 1 extra complication; the GM narrates the cost."
          style="${keyStyle(P.cost)}">${succeedAtCostButton.label}</button>` : "",
      `
        <button class="sta2e-player-confirm tkc-key tkc-key--wide" data-filled="1" data-payload="${p}"
          style="${keyStyle(passed ? P.confirmPass : P.confirmFail)}">${confirmLabel}</button>`,
    ].filter(Boolean);
    actions.push(actionSection("confirm", keys.join("")));
  }

  return `
<div class="sta2e-task-card sta2e-task-card--klingon tkc" data-theme="${getActiveLcThemeKey()}"
  style="${getLcCssVars("tc")}--tkc-c:${P[state]};">
  ${klingonHead(title, status, lamp)}
  <div class="tkc-scope">
    ${sub ? `<div class="tkc-sub">${sub}</div>` : ""}
    ${wells.join("")}
    ${notesHtml}
    ${readout}
  </div>
  ${actions.join("")}
</div>`;
}
