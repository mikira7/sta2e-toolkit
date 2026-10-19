/**
 * sta2e-toolkit | task-card-ent.js
 *
 * The ENT "Bridge Touchscreen" skin for the interactive Working Results task
 * card, used whenever the active theme is `ent-panel` (whatever `taskCardStyle`
 * says, as with TOS, TMP and TNG). Dispatched from buildPlayerRollCardHtml() in
 * npc-roller.js with the same prepared `view` the other skins receive, so all
 * of them render the same content. Shape lives in styles/task-card-ent.css; the
 * design source is docs/ent-card-mockups.html (Concept A).
 *
 * Look: the NX-01 bridge displays — navy glass with a faint grid, a thin
 * line-art frame with two chamfered corners, the title on a rule with a cut
 * tab, dice in bracketed wells, each readout a value over a hairline bar, and
 * tab-shaped keys with a coloured edge. The chat card frame's ENT path
 * (entChatCard in chat-card-frame.js) builds the same frame with the same
 * `tec-*` classes, so the frame exists once in CSS.
 *
 * ── DOM contract (do not break) — same as the slim, TOS, TMP and TNG skins ──
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
 * shape (including the border's width and style, never its colour). The keys
 * are NOT `data-filled`: a tab is a dark key with a coloured edge, so arming
 * takes the unfilled path — yellow outline and yellow text on dark glass, which
 * is the armed look the design shows.
 *
 * No inline border-radius anywhere, no inline font-family, and no `!important`
 * in the stylesheet. The typefaces (bundled Rajdhani, and the Share Tech Mono
 * the TMP stylesheet already declares) come from `.tec`.
 */

import { getLcCssVars, getActiveLcThemeKey } from "./lcars-theme.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]));

/**
 * The ENT display colours. Every one is an `ent-panel` token from
 * lcars-theme.js, or a lit shade of one for type and lines on dark glass.
 */
export const ENT = {
  blue: "#7aaec4", sky: "#bfe3f2", slate: "#5e7f8f", grey: "#c7c7c7",
  green: "#a7d46c", yellow: "#f0e800", amber: "#f0b400", orange: "#c47b00",
  red: "#e0533a", alarm: "#ff3b2a", bright: "#f0f0f0", glass: "#04101a",
};

/** Colour by role. */
const P = {
  working: ENT.blue, assist: ENT.grey, pass: ENT.green, fail: ENT.red,
  bSucc: ENT.blue, bDiff: "#8fb1c2", bMom: ENT.green, bThreat: ENT.red, bCpx: ENT.alarm,
  rerolls: [ENT.blue, ENT.grey, ENT.sky, ENT.amber, ENT.slate, ENT.green],
  assistKey: ENT.sky, luck: ENT.amber, dim: ENT.slate, addToRoll: ENT.blue,
  poolMomentum: ENT.green, poolThreat: ENT.red, edit: ENT.slate, cost: ENT.amber,
  confirmPass: ENT.green, confirmFail: ENT.slate,
};

/** Mix a hex colour into the glass, `amount` 0..1 of the colour. */
function tint(hex, amount = 0.22, base = ENT.glass) {
  const parse = h => {
    const s = String(h).replace("#", "");
    const full = s.length === 3 ? s.replace(/./g, c => c + c) : s.slice(0, 6);
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  };
  const a = parse(hex), b = parse(base);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return base;
  return `#${a.map((v, i) => Math.round(v * amount + b[i] * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A key's whole colour, inline (see the note above): a coloured edge on a dark
 * tint of the same colour, a faint outline, light text. The edge is a
 * gradient stop in the background, so arming (which writes `background`)
 * replaces it cleanly and restoring cssText brings it back.
 */
export const keyStyle = colour =>
  `--k:${colour};background:linear-gradient(90deg,${colour} 0 3px,${tint(colour)} 3px);`
  + `border-color:${tint(colour, 0.6)};color:${ENT.bright};`;

/** Split "Reason + Science (target: 12)" into its label and target. */
const splitTarget = heading => {
  const m = String(heading ?? "").match(/^(.*?)\s*\(target:\s*([^)]*)\)\s*$/i);
  return m ? [m[1], `T ${m[2]}`] : [String(heading ?? ""), ""];
};

/** A bracketed dice well, its label and target along the top. */
const well = (label, inner, { target = "", line = "" } = {}) => `
    <div class="tec-well">
      <div class="tec-lbl"><span>${label}</span>${target ? `<span>${target}</span>` : ""}</div>
      ${line ? `<div class="tec-line">${line}</div>` : ""}
      ${inner}
    </div>`;

/** A readout row: label, value, and a hairline bar showing value / scale. */
export const readRow = (label, value, colour, { scale = 6, mark = null, cls = "" } = {}) => {
  const n = Number(value);
  const bar = Number.isFinite(n)
    ? `<span class="tec-bar${mark != null ? " tec-bar--mark" : ""}" aria-hidden="true" style="--p:${Math.round(Math.min(1, Math.max(0, n / scale)) * 100)}%;--bc:${colour};${
        mark != null ? `--m:${Math.round(Math.min(1, Math.max(0, mark / scale)) * 100)}%;` : ""}"></span>`
    : "";
  return `
      <div class="tec-row${cls ? ` ${cls}` : ""}"><span>${label}</span><b>${value}</b>${bar}</div>`;
};

/** An action section. The wrapper stays a block; the key grid is the inner list. */
const actionSection = (modifier, inner, { label = "", listClass = "" } = {}) => `
  <div class="sta2e-working-actions sta2e-working-actions--${modifier} tec-actions">
    ${label ? `<div class="tec-sect-lbl">${label}</div>` : ""}
    <div class="tec-pad${listClass ? ` ${listClass}` : ""}">${inner}</div>
  </div>`;

/**
 * The frame's header and footer, shared with the chat card frame. The outline
 * and the chamfers are the root's own (a clipped box inside a clipped box), so
 * they need no markup.
 */
export const entHead = (title, code = "") => `
  <div class="tec-head">
    <div class="tec-title">${title ?? ""}</div>
    <span class="tec-ticks" aria-hidden="true"><i></i><i></i><i></i></span>
    ${code ? `<span class="tec-tab">${code}</span>` : ""}
  </div>`;

/** A short run of hex the footer streams, stable for a given title. */
export function dataStream(seed = "") {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const out = [];
  for (let i = 0; i < 6; i++) {
    h = Math.imul(h ^ (h >>> 13), 2246822507) >>> 0;
    out.push((h & 0xff).toString(16).toUpperCase().padStart(2, "0"));
  }
  return out.join(" ");
}

export const entFoot = (left = "", seed = "") => `
  <div class="tec-foot"><span>${left}</span><span class="tec-stream" aria-hidden="true">${dataStream(seed)}</span></div>`;

/**
 * Render the ENT skin.
 *
 * @param {object} view Prepared view from buildPlayerRollCardHtml.
 * @returns {string} HTML string.
 */
export function renderEntTaskCard(view) {
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

  // ── Dice wells ───────────────────────────────────────────────────────────
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
  <div class="tec-notes">
    ${notes.map(n => `<div class="tec-note tec-note--${n.tone}">${n.text}</div>`).join("")}
  </div>` : "";

  // ── Readout ──────────────────────────────────────────────────────────────
  // Every bar shares one scale, so the Successes bar and the Difficulty tick
  // on it can be compared at a glance.
  const resultCell = statCells.find(([label]) => label === "Result");
  const resultValue = resultCell?.[1] ?? "";
  const resultClass = succeedAtCost ? "cost" : passed ? "pass" : "fail";
  const numbers = statCells.filter(([l]) => l !== "Result").map(([, v]) => Number(v)).filter(Number.isFinite);
  const scale = Math.max(6, ...numbers);
  const difficulty = Number(statCells.find(([l]) => l === "Difficulty")?.[1]);
  const rows = statCells
    .filter(([label]) => label !== "Result")
    .map(([label, value]) => {
      if (label === "Successes") {
        return readRow(label, value, P.bSucc, { scale, mark: Number.isFinite(difficulty) ? difficulty : null });
      }
      if (label === "Difficulty") return readRow(label, value, P.bDiff, { scale });
      if (label === "Complic.")   return readRow(label, value, P.bCpx, { scale, cls: "tec-row--cpx" });
      return readRow(label, value, /threat/i.test(label) ? P.bThreat : P.bMom, { scale });
    }).join("");

  const resRow = (label, inner, trailing = "") => `
      <div class="tec-res"><span class="tec-res-lbl">${label}</span>${inner}${trailing}</div>`;
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
          ? `<span class="tec-res-sub">${gained.banked} banked${gained.floating > 0 ? ` · ${gained.floating} floating` : ""}</span>`
          : "",
      )
    : "";

  const readout = !isAssistRoll ? `
  <div class="tec-read">${rows}${spentHtml}${gainedHtml}
    <div class="tec-result tec-result--${resultClass}"><strong>${resultValue}</strong></div>
  </div>` : (gainedHtml || spentHtml ? `
  <div class="tec-read">${spentHtml}${gainedHtml}</div>` : "");

  // ── Keys ─────────────────────────────────────────────────────────────────
  const assistKind = ao => ao.type === "direct" ? " (Direct)"
    : ao.type === "methodical-planning" ? " (Methodical Planning)"
    : ao.type === "attack-pattern" ? " (Attack Pattern)" : "";

  const actions = [];
  if (!confirmed && (pendingAssists ?? []).length > 0) {
    actions.push(actionSection("assists", pendingAssists.map((ao, i) => `
      <button class="sta2e-player-assist-roll tec-key tec-key--wide"
        data-payload="${p}" data-assist-index="${i}"
        style="${keyStyle(P.assistKey)}">Roll Assist Die — ${ao.name}${assistKind(ao)}</button>`).join(""),
      { label: "Pending Assists" }));
  }
  if (showMakeYourOwnLuck) {
    actions.push(actionSection("luck", `
      <button class="sta2e-make-own-luck tec-key tec-key--wide"
        data-payload="${p}"
        style="${keyStyle(P.luck)}">${makeYourOwnLuckSource ?? "Make Your Own Luck"} — suffer 1 Stress, change a failed die to ${crewTarget}</button>`));
  }
  if (!confirmed && !isAssistRoll && rerollButtons.length > 0) {
    actions.push(actionSection("rerolls", rerollButtons.map((rb, i) => `
      <button class="sta2e-player-reroll tec-key"
        data-payload="${p}"
        data-ability="${rb.ability}"
        data-ability-label="${rb.label}"
        title="${rb.label} — ${rb.labelShort}"
        style="${keyStyle(P.rerolls[i % P.rerolls.length])}">${rerollButtonBody(rb)}</button>`).join(""),
      { label: "Rerolls Available", listClass: "sta2e-task-rerolls" }));
  }

  if (isAssistRoll) {
    actions.push(actionSection("assist-apply", assistApplied
      ? `<div class="sta2e-task-btn tec-key tec-key--wide" style="${keyStyle(P.dim)}">Applied to: ${assistApplied}</div>`
      : `<button class="sta2e-assist-to-roll tec-key tec-key--wide" data-payload="${p}"
           style="${keyStyle(P.addToRoll)}">Add to Task Roll →</button>`));
  } else if (confirmed) {
    actions.push(actionSection("confirm", poolButton.visible
      ? `<button class="sta2e-add-to-pool tec-key tec-key--wide"
           data-pool="${poolButton.pool}"
           data-amount="${poolButton.amount}"
           data-token-id="${poolButton.tokenId}"
           style="${keyStyle(poolButton.pool === "threat" ? P.poolThreat : P.poolMomentum)}">${poolButton.label}</button>`
      : `<div class="sta2e-task-btn tec-key tec-key--wide" style="${keyStyle(P.dim)}">Completed</div>`));
  } else {
    const keys = [
      canGmEditCard ? `
        <button class="sta2e-edit-roll-card tec-key" data-payload="${p}"
          style="${keyStyle(P.edit)}">Edit Results</button>` : "",
      succeedAtCostButton?.visible ? `
        <button class="sta2e-succeed-at-cost tec-key" data-payload="${p}"
          title="Resolve this task as a success. It gains 1 extra complication; the GM narrates the cost."
          style="${keyStyle(P.cost)}">${succeedAtCostButton.label}</button>` : "",
      `
        <button class="sta2e-player-confirm tec-key tec-key--wide" data-payload="${p}"
          style="${keyStyle(passed ? P.confirmPass : P.confirmFail)}">${confirmLabel}</button>`,
    ].filter(Boolean);
    actions.push(actionSection("confirm", keys.join("")));
  }

  return `
<div class="sta2e-task-card sta2e-task-card--ent tec" data-theme="${getActiveLcThemeKey()}"
  style="${getLcCssVars("tc")}--tec-c:${P[state]};">
  <div class="tec-in">
  ${entHead(title, status)}
  <div class="tec-body">
    ${sub ? `<div class="tec-sub">${sub}</div>` : ""}
    ${wells.join("")}
    ${notesHtml}
    ${readout}
    ${actions.join("")}
  </div>
  ${entFoot("", title)}
  </div>
</div>`;
}
