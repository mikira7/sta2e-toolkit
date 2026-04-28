/**
 * sta2e-toolkit | npc-roller.js
 * NPC Starship Dice Roller — LCARS-styled task roll dialog.
 *
 * Replicates the original NPC Ship Dice Roller macro logic inside the module.
 * Opens as a DialogV2 application with two pools:
 *   • NPC Crew pool  — Attribute + Discipline target numbers, configurable dice count
 *   • NPC Ship pool  — Systems + Department target numbers, configurable dice count
 *
 * Each rolled die is displayed as a clickable pip. Clicking any die rerolls it.
 * Targeting Solution condition grants a bonus die on the initial roll
 * (first click is free; subsequent clicks cost 1 Threat each, shown as a prompt).
 *
 * Task result is evaluated against Difficulty and posted to chat as an LCARS card.
 */

import { getLcTokens } from "./lcars-theme.js";
import { getCrewManifest, readOfficerStats } from "./crew-manifest.js";

const MODULE = "sta2e-toolkit";

// ── LCARS Design Tokens — resolved from active campaign theme at render time ──
const LC = new Proxy({}, {
  get(_, prop) { return getLcTokens()[prop]; },
});

// ── Roll logic ────────────────────────────────────────────────────────────────

/**
 * Roll N d20s, each returning { value, success, crit, complication }.
 * success   = value ≤ target
 * crit      = value ≤ critThreshold  (NPC/ship always have focus: 1 to dept score)
 *             A crit counts as 2 successes
 * complication = value ≥ complicationThreshold
 */
export function rollPool(n, target, complicationThreshold = 20, critThreshold = 1) {
  return Array.from({ length: n }, () => {
    const value = Math.ceil(Math.random() * 20);
    const success = value <= target;
    const crit = success && value <= critThreshold;
    const complication = value >= complicationThreshold;
    return { value, success, crit, complication, critThreshold };
  });
}

export function countSuccesses(dice) {
  return dice.reduce((sum, d) => sum + (d.success ? (d.crit ? 2 : 1) : 0), 0);
}

function countComplications(dice) {
  return dice.filter(d => d.complication).length;
}

// When Reserve Power is active, each ship die complication counts as 2.
function countComplicationsTotal(crewDice, crewAssistDice, shipDice, reservePower) {
  const crewCompls = countComplications([...crewDice, ...crewAssistDice]);
  const shipCompls = shipDice.filter(d => d.complication).length;
  return crewCompls + (reservePower ? shipCompls * 2 : shipCompls);
}

// ── Player-roll session callbacks ─────────────────────────────────────────────
// Stores taskCallback closures for player-ship rolls that confirm via chat card.
// Key: callbackId (random string), Value: { taskCallback, actor, token }
export const PlayerRollCallbacks = new Map();

/**
 * Remove a station's assistPending flag entry from a token document.
 * Called from the confirm button handler in the chat card.
 */
export async function clearStationAssistFlag(tokenDoc, stationId) {
  if (!tokenDoc || !stationId) return;
  const existing = tokenDoc.getFlag("sta2e-toolkit", "assistPending") ?? {};
  if (!(stationId in existing)) return;
  await tokenDoc.update({ [`flags.sta2e-toolkit.assistPending.-=${stationId}`]: null });
}

// ── Reroll Talent Detection ───────────────────────────────────────────────────
// STA2e stores talents as actor.items — detected by name (case-insensitive).

const _REROLL_DISC_LABELS = {
  command: "Command", conn: "Conn", engineering: "Engineering",
  medicine: "Medicine", science: "Science", security: "Security",
};

/**
 * Detect discipline-based reroll talents on the rolling officer matching the selected discipline.
 * Covers: Bold (Disc) and Cautious (Disc). Add further patterns here as new talents are confirmed.
 * Returns { hasReroll:bool, source:string|null } — first match wins.
 */
function detectTalentReroll(actor, discKey) {
  if (!actor?.items) return { hasReroll: false, source: null };
  const disc = (_REROLL_DISC_LABELS[discKey] ?? discKey).toLowerCase();
  const patterns = [
    `bold (${disc})`, `bold [${disc}]`,
    `cautious (${disc})`, `cautious [${disc}]`,
  ];
  const found = actor.items.find(i => patterns.includes(i.name.toLowerCase()));
  return found ? { hasReroll: true, source: found.name } : { hasReroll: false, source: null };
}

/**
 * Detect "Advisor" talent on any assisting officer who is assisting using Command.
 * "Whenever you Assist another character using Command, the assisted character may re-roll one d20."
 * assistOfficerStates: array of { actorId, name, discKey } from _assistOfficerStates.
 * Returns { hasReroll:bool, source:string|null }.
 */
function detectAdvisorReroll(assistOfficerStates) {
  for (const ao of (assistOfficerStates ?? [])) {
    if (!ao.actorId || ao.discKey !== "command") continue;
    const aoActor = game.actors.get(ao.actorId);
    if (!aoActor) continue;
    if (aoActor.items.some(i => i.name.toLowerCase() === "advisor")) {
      return { hasReroll: true, source: `Advisor (${ao.name})` };
    }
  }
  return { hasReroll: false, source: null };
}

/**
 * Detect system-specific reroll talent matched against the selected ship system key.
 * SYSTEM_REROLL_MAP is currently empty — populate when specific talent names are confirmed.
 * Returns { hasReroll:bool, source:string|null }.
 */
function detectSystemRerollTalent(actor, systemKey) {
  if (!actor?.items) return { hasReroll: false, source: null };
  const SYSTEM_REROLL_MAP = {
    // Example: "sensors": ["expert sensor suites"],
    // Add entries as system-specific reroll talents are confirmed.
  };
  const patterns = SYSTEM_REROLL_MAP[systemKey] ?? [];
  const found = actor.items.find(i => patterns.some(p => i.name.toLowerCase().includes(p)));
  return found ? { hasReroll: true, source: found.name } : { hasReroll: false, source: null };
}

// ── Batch-2 Talent Detection ─────────────────────────────────────────────────

/**
 * Technical Expertise: reroll one crew OR ship die when the ship rolls with Computers/Sensors.
 * Detection only checks if the actor has the talent; the system-key eligibility check
 * (shipSystemKey === "computers" | "sensors") is done at render time using the live
 * state.shipSystemKey so the GM's system dropdown is respected.
 */
function detectTechExpertise(actor) {
  if (!actor?.items) return { hasReroll: false, source: null };
  const found = actor.items.find(i => i.name.toLowerCase().includes("technical expertise"));
  return found ? { hasReroll: true, source: found.name } : { hasReroll: false, source: null };
}

/**
 * Procedural Compliance: Engineering task — remove 1 die from pool, gain 1 auto-success.
 * Active when stationId === "operations" OR selected discipline is Engineering.
 */
function detectProceduralCompliance(actor, stationId, discKey) {
  if (!actor?.items) return false;
  if (stationId !== "operations" && discKey !== "engineering") return false;
  return actor.items.some(i => i.name.toLowerCase().includes("procedural compliance"));
}

/**
 * Piercing Salvo: torpedo attack — spend 2 Momentum for Piercing quality (note only).
 */
function detectPiercingSalvo(actor, weaponContext) {
  if (!actor?.items || !weaponContext?.isTorpedo) return false;
  return actor.items.some(i => i.name.toLowerCase().includes("piercing salvo"));
}

/**
 * Chief of Staff: when assisting a Medicine task (stationId === "medical"),
 * each assisting character may re-roll their assistance die.
 * Detected on any assisting officer — returns first match.
 */
function detectChiefOfStaff(assistOfficerStates, stationId) {
  if (stationId !== "medical") return { hasReroll: false, source: null };
  for (const ao of (assistOfficerStates ?? [])) {
    if (!ao.actorId) continue;
    const aoActor = game.actors.get(ao.actorId);
    if (!aoActor) continue;
    const found = aoActor.items.find(i => i.name.toLowerCase().includes("chief of staff"));
    if (found) return { hasReroll: true, source: `Chief of Staff (${ao.name})` };
  }
  return { hasReroll: false, source: null };
}

/**
 * Fast Targeting Systems (ship talent): when Targeting Solution is used,
 * also choose the system hit. Note-only enhancement — detected on ship actor.
 */
function detectFastTargetingSystems(shipActor) {
  if (!shipActor?.items) return false;
  return shipActor.items.some(i => i.name.toLowerCase().includes("fast targeting systems"));
}

/**
 * Ship talent crew die reroll — covers Improved Damage Control and Rugged Design.
 * Both grant a single free crew die reroll; combined into one manual checkbox.
 * Only applies to Damage Control tasks (stationId === "damage-control").
 */
function detectShipTalentCrewReroll(shipActor, stationId) {
  if (!shipActor?.items) return { hasReroll: false, source: null };
  if (stationId !== "damage-control") return { hasReroll: false, source: null };
  const matches = shipActor.items.filter(i => {
    const n = i.name.toLowerCase();
    return n.includes("improved damage control") || n.includes("rugged design");
  });
  if (!matches.length) return { hasReroll: false, source: null };
  return { hasReroll: true, source: matches.map(i => i.name).join(" / ") };
}

/**
 * Multi-Tasking: when performing an Override task at a bridge station that includes
 * both helm or navigator positions, the officer may use Conn instead of the task's
 * usual discipline/department. Requires Conn 3+ (enforced by talent prerequisites,
 * not checked here — if the talent is present, it's valid).
 */
function detectMultiTasking(actor) {
  if (!actor?.items) return false;
  return actor.items.some(i => i.name.toLowerCase().includes("multi-tasking"));
}

// ── Dice So Nice integration ──────────────────────────────────────────────────

/**
 * Show a pool of pre-rolled d20s via Dice So Nice.
 * Builds a synthetic Roll with the already-computed values so DSN can animate
 * them without re-rolling. Silently no-ops if DSN is unavailable or disabled.
 *
 * @param {Array<{value:number}>} dice  - Pre-rolled die objects
 * @param {object|null}           speaker - ChatMessage speaker (for DSN sync)
 */
export async function dsnShowPool(dice, speaker = null) {
  if (!game.dice3d) return;                                          // DSN not installed
  if (!game.settings.get("sta2e-toolkit", "useDiceSoNice")) return; // user disabled

  // Build a Roll whose terms contain the pre-rolled values
  const roll = new Roll(`${dice.length}d20`);
  await roll.evaluate({ minimize: true });   // evaluate to initialise term structure

  // Overwrite minimized values with our actual results
  const term = roll.terms[0];               // DiceTerm
  term.results.forEach((r, i) => {
    r.result = dice[i]?.value ?? r.result;
    r.active = true;
  });
  roll._total = dice.reduce((s, d) => s + d.value, 0);

  await game.dice3d.showForRoll(roll, game.user, true, null, false, null, speaker);
}

// ── Die pip rendering — uses Foundry's icons/svg/d20-grey.svg + CSS filters ──
//
// Foundry's DialogV2 sanitises inline SVG, so we use <img> pointing at the
// engine-supplied d20-grey.svg at low opacity so it reads as a subtle backdrop.
// outcome is communicated entirely through the overlaid number text color.
// The label (die value + optional ★★ for crits) is overlaid as absolute text
// inside a position:relative wrapper so it sits centred on the die image.


export function diePipHtml(die, index, poolKey, rerollHint = null) {
  // Procedural Compliance auto-success die — special label and tooltip
  if (die.proceduralForced) {
    const txtColor = LC.green;
    const wrapStyle = `position:relative;display:inline-flex;align-items:center;justify-content:center;
      width:38px;height:38px;`;
    const imgStyle = `position:absolute;top:0;left:0;width:38px;height:38px;
      opacity:0.2;pointer-events:none;filter:drop-shadow(0 0 3px ${LC.green});`;
    const textStyle = `position:relative;z-index:1;color:${txtColor};font-size:13px;font-weight:700;
      font-family:${LC.font};text-shadow:0 1px 2px rgba(0,0,0,0.9);pointer-events:none;`;
    return `<div title="Auto-success (Procedural Compliance)" style="${wrapStyle}">
      <img src="icons/svg/d20-grey.svg" style="${imgStyle}" alt="" />
      <span style="${textStyle}">✓</span>
    </div>`;
  }

  // Auto-Success Trade die — 1 guaranteed success, traded for 1 die
  if (die.autoSuccessTradeForced) {
    const txtColor = LC.green;
    const wrapStyle = `position:relative;display:inline-flex;align-items:center;justify-content:center;
      width:38px;height:38px;`;
    const imgStyle = `position:absolute;top:0;left:0;width:38px;height:38px;
      opacity:0.2;pointer-events:none;filter:drop-shadow(0 0 3px ${LC.green});`;
    const textStyle = `position:relative;z-index:1;color:${txtColor};font-size:13px;font-weight:700;
      font-family:${LC.font};text-shadow:0 1px 2px rgba(0,0,0,0.9);pointer-events:none;`;
    return `<div title="Auto-success (traded 1 die for 1 guaranteed success)" style="${wrapStyle}">
      <img src="icons/svg/d20-grey.svg" style="${imgStyle}" alt="" />
      <span style="${textStyle}">✓</span>
    </div>`;
  }

  let tooltip = `Die ${index + 1}: ${die.value}`;
  if (die.crit) {
    if (die.determinationForced) {
      tooltip += " (CRITICAL — Determination, auto-1, 2 successes)";
    } else if (die.reservePowerForced) {
      tooltip += " (CRITICAL — Reserve Power, auto-1, 2 successes)";
    } else {
      tooltip += ` (CRITICAL — 2 successes, focus 1–${die.critThreshold})`;
    }
  }
  else if (die.success) tooltip += " (success)";
  if (die.complication) tooltip += " (COMPLICATION)";
  if (rerollHint !== null) tooltip += `\n${rerollHint}`;

  const SIZE = 38;
  const txtColor = die.crit ? LC.primary
    : die.success ? LC.green
      : die.complication ? LC.red
        : "#aaaaaa";
  const fontSize = die.value >= 10 ? "9px" : "11px";

  const labelHtml = die.crit
    ? `<span style="display:flex;flex-direction:column;align-items:center;line-height:1;gap:0px;">
        <span style="font-size:7px;letter-spacing:-1px;color:${txtColor};">★★</span>
        <span style="font-size:${fontSize};">${die.value}</span>
       </span>`
    : `<span style="font-size:${fontSize};">${die.value}</span>`;

  const glowFilter = rerollHint !== null
    ? `drop-shadow(0 0 4px ${LC.secondary}) drop-shadow(0 0 2px ${LC.secondary})`
    : "none";

  const imgStyle = `
    position:absolute;top:0;left:0;
    width:${SIZE}px;height:${SIZE}px;
    opacity:0.2;
    filter:${glowFilter};
    pointer-events:none;
    transition:filter 0.12s;
  `;

  const wrapStyle = `
    position:relative;
    display:inline-flex;align-items:center;justify-content:center;
    width:${SIZE}px;height:${SIZE}px;
    cursor:${rerollHint !== null ? "pointer" : "default"};
  `;

  const textStyle = `
    position:relative;z-index:1;
    color:${txtColor};
    font-weight:700;font-family:${LC.font};
    text-shadow:0 1px 2px rgba(0,0,0,0.9);
    pointer-events:none;
  `;

  const inner = `
    <img src="icons/svg/d20-grey.svg" style="${imgStyle}" alt="" />
    <span style="${textStyle}">${labelHtml}</span>
  `;

  if (rerollHint !== null) {
    return `
      <button class="sta2e-die-pip" data-pool="${poolKey}" data-index="${index}"
        title="${tooltip}"
        style="background:none;border:none;padding:0;margin:0;${wrapStyle}"
        onmouseenter="this.querySelector('img').style.filter='drop-shadow(0 0 7px ${LC.secondary})'"
        onmouseleave="this.querySelector('img').style.filter='${glowFilter}'"
      >${inner}</button>`;
  }

  return `<div title="${tooltip}" style="${wrapStyle}">${inner}</div>`;
}

// ── Result summary row ─────────────────────────────────────────────────────────

function resultSummaryHtml(crewDice, shipDice, difficulty, crewTarget, shipTarget, reservePower = false) {
  const crewSucc = countSuccesses(crewDice);
  const shipSucc = countSuccesses(shipDice);
  const total = crewSucc + shipSucc;
  // Reserve Power: ship complications count as 2 each
  const compls = countComplicationsTotal(crewDice, [], shipDice, reservePower);
  const passed = total >= difficulty;
  const momentum = Math.max(0, total - difficulty);

  const passColor = passed ? LC.green : LC.red;
  const passText = passed ? "SUCCESS" : "FAILURE";

  const shipRawCompls = countComplications(shipDice);
  const reserveNote = reservePower && shipRawCompls > 0
    ? `<div style="font-size:9px;color:${LC.red};font-family:${LC.font};margin-top:2px;">
        ⚡ Reserve Power — ${shipRawCompls} ship complication${shipRawCompls > 1 ? "s" : ""} × 2 = ${shipRawCompls * 2}
      </div>`
    : "";

  return `
    <div style="
      display:grid;grid-template-columns:repeat(4,1fr);gap:6px;
      padding:8px 10px;background:rgba(0,0,0,0.4);
      border-top:1px solid ${LC.borderDim};
    ">
      <div style="text-align:center;">
        <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
          text-transform:uppercase;letter-spacing:0.1em;">Successes</div>
        <div style="font-size:20px;font-weight:700;color:${LC.tertiary};
          font-family:${LC.font};">${total}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
          text-transform:uppercase;letter-spacing:0.1em;">Difficulty</div>
        <div style="font-size:20px;font-weight:700;color:${LC.text};
          font-family:${LC.font};">${difficulty}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
          text-transform:uppercase;letter-spacing:0.1em;">Threat</div>
        <div style="font-size:20px;font-weight:700;color:${momentum > 0 ? LC.secondary : LC.textDim};
          font-family:${LC.font};">${momentum}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
          text-transform:uppercase;letter-spacing:0.1em;">Complic.</div>
        <div style="font-size:20px;font-weight:700;color:${compls > 0 ? LC.red : LC.textDim};
          font-family:${LC.font};">${compls}</div>
      </div>
    </div>
    ${reserveNote}
    <div style="
      text-align:center;padding:6px 10px 8px;
      font-size:14px;font-weight:700;letter-spacing:0.15em;
      color:${passColor};font-family:${LC.font};
      text-transform:uppercase;
      border-top:1px solid ${LC.borderDim};
    ">
      ${passText}
      ${momentum > 0 ? `<span style="font-size:10px;color:${LC.secondary};font-weight:400;margin-left:8px;">
        +${momentum} Threat gained</span>` : ""}
      ${compls > 0 ? `<span style="font-size:10px;color:${LC.red};font-weight:400;margin-left:8px;">
        ${compls} Complication${compls > 1 ? "s" : ""}!</span>` : ""}
    </div>`;
}

// ── NPC Crew quality presets ─────────────────────────────────────────────────
export const CREW_QUALITIES = [
  { key: "basic", label: "Basic", attr: 8, dept: 1 },
  { key: "proficient", label: "Proficient", attr: 9, dept: 2 },
  { key: "talented", label: "Talented", attr: 10, dept: 3 },
  { key: "exceptional", label: "Exceptional", attr: 11, dept: 4 },
];

// Complication threshold: range N means complications on (21 - N) to 20
// e.g. range 1 → complications on 20; range 3 → complications on 18-20
const COMPLICATION_RANGES = [1, 2, 3, 4, 5];

// ── Officer attribute + discipline label maps (used in setup and rolled phases) ─
const ATTR_LABELS = {
  control: "Control", daring: "Daring", fitness: "Fitness",
  insight: "Insight", presence: "Presence", reason: "Reason",
};
const DISC_LABELS = {
  command: "Command", conn: "Conn", engineering: "Engineering",
  medicine: "Medicine", science: "Science", security: "Security",
};

// Station display labels used in the chat card to identify which station rolled.
const STATION_LABELS = {
  tactical: "Tactical",
  helm: "Helm",
  comms: "Communications",
  sensors: "Sensors",
  operations: "Operations",
  command: "Command",
  navigator: "Navigator",
  medical: "Medical",
};

// ── Full dialog HTML ──────────────────────────────────────────────────────────

// Meta-action keys that are not rollable tasks (skip in combat panel)
const _COMBAT_PANEL_SKIP = new Set([
  "assist", "assist-command", "task-roll", "override", "pass", "ready",
]);

// Tasks that only appear in the character's own station section — never in the Override list.
// "direct" is a Command-exclusive ability; defense-mode and attack-pattern tasks are ship-self actions.
const _OVERRIDE_SKIP = new Set(["direct", "evasive-action", "defensive-fire", "attack-pattern", "reroute-power", "modulate-shields"]);

// Tasks rendered as instant-apply buttons (close roller → confirm → apply effect to ship).
// These bypass the normal task-roll flow entirely.
const _INSTANT_APPLY_TASKS = new Set(["evasive-action", "defensive-fire", "attack-pattern", "reroute-power", "modulate-shields", "direct"]);

/**
 * Build the right-side combat task panel HTML shown when the roller is opened
 * during starship combat and the character is assigned to a ship combatant.
 * Returns an empty string when state.combatTaskContext is not set.
 */
function _buildCombatTaskPanelHtml(state) {
  if (!state.combatTaskContext) return "";
  const { bridgeStations, taskParams, myStations, combatShip, shipWeapons, targetShips, preTargetId } = state.combatTaskContext;

  // Station display label(s) for header
  const myStationLabels = myStations.length > 0
    ? myStations.map(id => bridgeStations.find(s => s.id === id)?.label ?? id).join(" · ")
    : "No Station Assigned";

  // Collect rollable task keys per station, deduped across stations.
  // Two-pass approach ensures tasks shared across multiple stations (e.g. create-trait)
  // always appear in "Your Station" for whichever officer has that post.
  const myTaskItems = [];  // { key, label, action } for character's stations
  const otherTaskItems = [];  // same for other stations (Override)
  const seen = new Set();

  // Pass 1 — character's own stations → always "Your Station"
  for (const station of bridgeStations) {
    if (!myStations.includes(station.id)) continue;
    for (const action of (station.major ?? [])) {
      if (!action.key) continue;
      if (_COMBAT_PANEL_SKIP.has(action.key)) continue;
      if (action.isInfo) continue;
      if (!taskParams[action.key]) continue;
      if (seen.has(action.key)) continue;
      seen.add(action.key);
      myTaskItems.push({ key: action.key, label: action.label ?? action.key, action });
    }
  }

  // Always include Create Trait — it is a universal action available at every post
  if (taskParams["create-trait"] && !seen.has("create-trait")) {
    seen.add("create-trait");
    myTaskItems.push({ key: "create-trait", label: "Create Trait", action: { key: "create-trait" } });
  }

  // Pass 2 — other stations → Override section (skip station-exclusive tasks)
  for (const station of bridgeStations) {
    if (myStations.includes(station.id)) continue;
    for (const action of (station.major ?? [])) {
      if (!action.key) continue;
      if (_COMBAT_PANEL_SKIP.has(action.key)) continue;
      if (_OVERRIDE_SKIP.has(action.key)) continue;  // defense modes + direct never in Override
      if (action.isInfo) continue;
      if (!taskParams[action.key]) continue;
      if (seen.has(action.key)) continue;
      seen.add(action.key);
      otherTaskItems.push({ key: action.key, label: action.label ?? action.key, action });
    }
  }

  // Build a single task button
  const taskBtn = ({ key, label }, diffMod = 0) => {
    const tp = taskParams[key];
    const attrLbl = tp.charAttr ? (ATTR_LABELS[tp.charAttr] ?? tp.charAttr) : null;
    const discLbl = tp.charDisc ? (DISC_LABELS[tp.charDisc] ?? tp.charDisc) : null;
    const diffDisplay = tp.difficulty !== undefined ? tp.difficulty + diffMod : null;
    const action = bridgeStations.flatMap(s => s.major).find(a => a.key === key);
    const needsTarget = action?.needsTarget ? "1" : "0";
    const isSelected = state.selectedTaskKey === key;
    return `
      <button type="button" class="sta2e-task-btn"
        data-task-key="${key}"
        data-attr="${tp.charAttr ?? ""}"
        data-disc="${tp.charDisc ?? ""}"
        data-diff="${tp.difficulty ?? 1}"
        data-diff-mod="${diffMod}"
        data-needs-target="${needsTarget}"
        style="display:flex;align-items:center;justify-content:space-between;
          width:100%;padding:5px 7px;margin-bottom:3px;cursor:pointer;text-align:left;
          background:${isSelected ? `rgba(255,153,0,0.12)` : 'transparent'};
          border:1px solid ${isSelected ? LC.primary : LC.borderDim};border-radius:2px;
          font-family:${LC.font};color:${LC.text};transition:border-color 0.15s,background 0.15s;">
        <span style="font-size:10px;font-weight:700;">${label}</span>
        <span style="font-size:8px;color:${LC.textDim};text-align:right;line-height:1.3;">
          ${attrLbl ? `${attrLbl}` : ""}${attrLbl && discLbl ? "<br>" : ""}${discLbl ?? ""}
          ${diffDisplay !== null ? `<br><span style="color:${LC.tertiary};">Diff ${diffDisplay}</span>` : ""}
        </span>
      </button>`;
  };

  // Instant-apply button for no-roll tasks (Evasive Action, Defensive Fire, Reroute Power, etc.).
  // These bypass the dice roll — clicking closes the roller and applies the effect directly.
  const _instantBtnSubLabel = key =>
    key === "reroute-power" ? "Select System → Apply"
      : key === "direct" ? "Pick Station → Declare"
        : key === "modulate-shields" ? "Toggle Modulation"
          : "Instant Apply";
  const instantBtn = ({ key, label }) => `
    <button type="button" class="sta2e-defense-btn"
      data-condition-key="${key}"
      style="display:flex;align-items:center;justify-content:space-between;
        width:100%;padding:5px 7px;margin-bottom:3px;cursor:pointer;text-align:left;
        background:transparent;border:1px solid ${LC.borderDim};border-radius:2px;
        font-family:${LC.font};color:${LC.primary};
        transition:border-color 0.15s,background 0.15s;">
      <span style="font-size:10px;font-weight:700;">${label}</span>
      <span style="font-size:8px;color:${LC.textDim};">${_instantBtnSubLabel(key)}</span>
    </button>`;

  const myTasksHtml = myTaskItems.map(t =>
    _INSTANT_APPLY_TASKS.has(t.key) ? instantBtn(t) : taskBtn(t, 0)
  ).join("") || `<div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};padding:2px 0;">
          No specific tasks for this station.
        </div>`;

  const otherTasksHtml = otherTaskItems.map(t => taskBtn(t, 1)).join("");

  // Weapon buttons for Tactical (shown when character is at Tactical station)
  const hasTactical = myStations.includes("tactical");
  const weaponsList = shipWeapons ?? [];
  const _weaponBtn = (w, isOverride) => `
    <button type="button" class="sta2e-weapon-fire-btn" data-weapon-id="${w.id}"
      data-is-torpedo="${w.isTorpedo ? "1" : "0"}"
      data-is-override="${isOverride ? "1" : "0"}"
      style="display:flex;align-items:center;justify-content:space-between;
        width:100%;padding:5px 7px;margin-bottom:3px;cursor:pointer;text-align:left;
        background:transparent;border:1px solid ${LC.borderDim};
        border-radius:2px;font-family:${LC.font};color:${LC.text};
        transition:border-color 0.15s,background 0.15s;">
      <span style="display:flex;align-items:center;gap:5px;font-size:10px;font-weight:700;">
        ${w.img ? `<img src="${w.img}" style="width:20px;height:20px;object-fit:contain;flex-shrink:0;" />` : ""}
        ${w.name}
      </span>
      <span style="font-size:8px;color:${LC.textDim};">Dmg ${w.damage}</span>
    </button>`;
  const weaponBtnsHtml = hasTactical && weaponsList.length > 0
    ? `<div style="margin-top:6px;border-top:1px solid ${LC.borderDim};padding-top:6px;">
        <div style="font-size:8px;color:${LC.textDim};font-family:${LC.font};
          letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px;">Fire Weapon</div>
        ${weaponsList.map(w => _weaponBtn(w, false)).join("")}
      </div>`
    : "";
  const overrideWeaponBtnsHtml = !hasTactical && weaponsList.length > 0
    ? `<div style="margin-top:4px;border-top:1px solid ${LC.borderDim};padding-top:6px;">
        <div style="font-size:8px;color:${LC.textDim};font-family:${LC.font};
          letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px;">Fire Weapon</div>
        ${weaponsList.map(w => _weaponBtn(w, true)).join("")}
      </div>`
    : "";

  // Minor actions section — shown for Tactical, Helm, and Sensor station officers
  const minorStates = state.combatTaskContext.tacticalMinorStates ?? null;
  const helmStates = state.combatTaskContext.helmMinorStates ?? null;
  const sensorStates = state.combatTaskContext.sensorMinorStates ?? null;
  const minorActionsHtml = (minorStates || helmStates || sensorStates) ? (() => {
    const stateLabel = (on) =>
      `<span class="sta2e-minor-status"
        style="font-size:8px;font-weight:700;
          color:${on ? LC.green : LC.textDim};">${on ? "● ON" : "○ OFF"}</span>`;
    const infoLabel = () =>
      `<span style="font-size:9px;color:${LC.textDim};">→</span>`;
    const minorBtn = (key, label, statusHtml) => `
      <button type="button" class="sta2e-minor-btn" data-minor-key="${key}"
        style="display:flex;align-items:center;justify-content:space-between;
          width:100%;padding:5px 7px;margin-bottom:3px;cursor:pointer;text-align:left;
          background:transparent;border:1px solid ${LC.borderDim};border-radius:2px;
          font-family:${LC.font};color:${LC.text};
          transition:border-color 0.15s,background 0.15s;">
        <span style="font-size:10px;font-weight:700;">${label}</span>
        ${statusHtml}
      </button>`;
    const stationSubLabel = (label) =>
      `<div style="font-size:8px;color:${LC.textDim};letter-spacing:0.06em;
        text-transform:uppercase;margin:4px 0 3px;opacity:0.7;">— ${label}</div>`;
    return `
      <div style="border-top:1px solid ${LC.borderDim};padding:6px 8px 5px;">
        <div style="font-size:8px;color:${LC.textDim};letter-spacing:0.08em;
          text-transform:uppercase;margin-bottom:4px;">Minor Actions</div>
        ${minorStates ? `
          ${(minorStates && (helmStates || sensorStates)) ? stationSubLabel("Tactical") : ""}
          ${minorBtn("calibrate-weapons", "Calibrate Weapons",
      stateLabel(minorStates.calibrateWeapons))}
          ${minorBtn("targeting-solution", "Targeting Solution",
        stateLabel(minorStates.targetingSolution))}
          ${minorStates.targetingSolution ? `
          <div id="sta2e-ts-benefit-row" style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:-1px;margin-bottom:3px;">
            <button type="button" class="sta2e-minor-btn" data-minor-key="ts-reroll"
              style="padding:3px 5px;background:rgba(255,153,0,0.04);
                border:1px solid ${LC.borderDim};border-radius:2px;
                color:${LC.secondary};font-size:8px;font-weight:700;
                font-family:${LC.font};letter-spacing:0.05em;
                text-transform:uppercase;cursor:pointer;">
              ↺ Reroll d20
            </button>
            <button type="button" class="sta2e-minor-btn" data-minor-key="ts-pick-system"
              style="padding:3px 5px;background:rgba(255,153,0,0.04);
                border:1px solid ${LC.borderDim};border-radius:2px;
                color:${LC.secondary};font-size:8px;font-weight:700;
                font-family:${LC.font};letter-spacing:0.05em;
                text-transform:uppercase;cursor:pointer;">
              🎯 Target System
            </button>
          </div>
          <div id="sta2e-ts-sys-picker" style="display:none;grid-template-columns:1fr 1fr 1fr;gap:3px;margin-top:2px;margin-bottom:3px;">
            ${["communications", "computers", "engines", "sensors", "structure", "weapons"].map(s =>
          `<button type="button" class="sta2e-minor-btn" data-minor-key="ts-system-${s}"
                style="padding:3px 5px;background:rgba(255,153,0,0.04);
                  border:1px solid ${LC.borderDim};border-radius:2px;
                  color:${LC.secondary};font-size:8px;font-weight:700;
                  font-family:${LC.font};letter-spacing:0.05em;
                  text-transform:uppercase;cursor:pointer;">
                ${_systemLabel(s)}
              </button>`
        ).join("")}
            <button type="button" class="sta2e-minor-btn" data-minor-key="ts-system-random"
              style="padding:3px 5px;background:rgba(255,153,0,0.04);
                border:1px solid ${LC.borderDim};border-radius:2px;
                color:${LC.secondary};font-size:8px;font-weight:700;
                font-family:${LC.font};letter-spacing:0.05em;
                text-transform:uppercase;cursor:pointer;grid-column:1/-1;">
              Roll Randomly
            </button>
          </div>` : ""}
          ${minorBtn("prepare", "Prepare",
          `<span style="font-size:8px;color:${LC.textDim};">
                ${minorStates.weaponsArmed ? "Armed" : "Unarmed"} ·
                ${minorStates.shieldsLowered ? "Shields ↓" : "Shields ↑"}
              </span>`)}
          ${state.combatTaskContext.shipHasCloakingDevice ? (() => {
          const _isCloaked = state.combatTaskContext.cloakingDeviceActive ?? false;
          const _tp = state.combatTaskContext.taskParams?.["cloak-toggle"];
          if (_isCloaked) {
            // ── Cloaked: instant deactivation (minor action) ──────────────
            return `<button type="button" class="sta2e-minor-btn" data-minor-key="cloak-deactivate"
                style="display:flex;align-items:center;justify-content:space-between;
                  width:100%;padding:5px 7px;margin-bottom:3px;cursor:pointer;text-align:left;
                  background:rgba(100,0,200,0.10);
                  border:1px solid #aa44ff;border-radius:2px;
                  font-family:${LC.font};color:#cc88ff;
                  transition:border-color 0.15s,background 0.15s;">
                <span style="font-size:10px;font-weight:700;">👻 Cloaking Device</span>
                <span class="sta2e-cloak-status" style="font-size:8px;font-weight:700;color:#aa44ff;">
                  ACTIVE · Minor
                </span>
              </button>`;
          } else {
            // ── Uncloaked: activation task — routes through the sheet roller ──
            return `<button type="button" class="sta2e-task-btn"
                data-task-key="cloak-toggle"
                data-attr="${_tp?.charAttr ?? "control"}"
                data-disc="${_tp?.charDisc ?? "engineering"}"
                data-diff="${_tp?.difficulty ?? 2}"
                data-diff-mod="0"
                data-needs-target="0"
                style="display:flex;align-items:center;justify-content:space-between;
                  width:100%;padding:5px 7px;margin-bottom:3px;cursor:pointer;text-align:left;
                  background:rgba(100,0,200,0.06);
                  border:1px solid rgba(170,68,255,0.4);border-radius:2px;
                  font-family:${LC.font};color:#cc88ff;
                  transition:border-color 0.15s,background 0.15s;">
                <span style="font-size:10px;font-weight:700;">👁 Cloaking Device</span>
                <span style="font-size:8px;color:${LC.textDim};text-align:right;line-height:1.3;">
                  Control<br>Engineering<br>
                  <span style="color:#aa44ff;">Diff 2 · Major</span>
                </span>
              </button>`;
          }
        })() : ""}
        ` : ""}
        ${helmStates !== null ? `
          ${(minorStates || sensorStates) ? stationSubLabel("Helm") : ""}
          ${minorBtn("impulse", "Impulse", infoLabel())}
          ${minorBtn("thrusters", "Thrusters", infoLabel())}
        ` : ""}
        ${sensorStates !== null ? `
          ${(minorStates || helmStates) ? stationSubLabel("Sensors") : ""}
          ${minorBtn("calibrate-sensors", "Calibrate Sensors",
          stateLabel(sensorStates.calibrateSensors))}
          ${sensorStates.calibrateSensors ? `
          <div id="sta2e-cs-benefit-row" style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:-1px;margin-bottom:3px;">
            <button type="button" class="sta2e-minor-btn" data-minor-key="cs-reroll"
              style="padding:3px 5px;background:rgba(255,153,0,0.04);
                border:1px solid ${LC.borderDim};border-radius:2px;
                color:${LC.secondary};font-size:8px;font-weight:700;
                font-family:${LC.font};letter-spacing:0.05em;
                text-transform:uppercase;cursor:pointer;">
              ↺ Reroll d20
            </button>
            <button type="button" class="sta2e-minor-btn" data-minor-key="cs-ignore-trait"
              style="padding:3px 5px;background:rgba(255,153,0,0.04);
                border:1px solid ${LC.borderDim};border-radius:2px;
                color:${LC.secondary};font-size:8px;font-weight:700;
                font-family:${LC.font};letter-spacing:0.05em;
                text-transform:uppercase;cursor:pointer;">
              ⊘ Ignore Trait
            </button>
          </div>` : ""}
          ${minorBtn("launch-probe", "Launch Probe", infoLabel())}
        ` : ""}
      </div>`;
  })() : "";

  // Target ship dropdown (always visible when targets are available)
  const preSelected = preTargetId ?? "";
  const targetDropdownHtml = (targetShips ?? []).length > 0
    ? `<div id="sta2e-ctp-target" style="margin-top:8px;padding:0 8px 8px;">
        <div style="font-size:8px;color:${LC.textDim};font-family:${LC.font};
          letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px;">Target Ship</div>
        <select id="sta2e-ctp-target-select"
          style="width:100%;padding:4px 6px;background:${LC.bg};
            border:1px solid ${LC.border};border-radius:2px;
            color:${LC.text};font-size:10px;font-family:${LC.font};">
          <option value="">— Select target —</option>
          ${(targetShips).map(t => `
            <option value="${t.actorId}" data-token-id="${t.tokenId ?? ""}" ${t.actorId === preSelected ? "selected" : ""}>
              ${t.label}
            </option>`).join("")}
        </select>
      </div>`
    : "";

  return `
    <div id="sta2e-combat-task-panel"
      style="width:240px;background:${LC.bg};border:1px solid ${LC.border};
        border-radius:3px;font-family:${LC.font};flex-shrink:0;align-self:flex-start;">
      <div style="background:${LC.primary};color:${LC.bg};font-size:9px;font-weight:700;
        letter-spacing:0.14em;text-transform:uppercase;padding:3px 8px;">⚔ Combat Task</div>
      <div style="padding:4px 8px 5px;border-bottom:1px solid ${LC.borderDim};">
        <div style="font-size:9px;font-weight:700;color:${LC.text};font-family:${LC.font};">
          ${combatShip.label}
        </div>
        <div style="font-size:8px;color:${LC.textDim};">${myStationLabels}</div>
      </div>
      ${minorActionsHtml}
      <div style="padding:6px 8px;${minorActionsHtml ? `border-top:1px solid ${LC.borderDim};` : ""}">
        <div style="font-size:8px;color:${LC.textDim};letter-spacing:0.08em;
          text-transform:uppercase;margin-bottom:4px;">Major Actions</div>
        ${myTasksHtml}
        ${weaponBtnsHtml}
      </div>
      ${(otherTasksHtml || overrideWeaponBtnsHtml) ? `
      <div style="border-top:1px solid ${LC.borderDim};">
        <details>
          <summary style="padding:5px 8px;cursor:pointer;font-size:9px;font-weight:700;
            color:${LC.textDim};font-family:${LC.font};letter-spacing:0.06em;
            text-transform:uppercase;list-style:none;user-select:none;">
            ▶ Override (+1 Difficulty)
          </summary>
          <div style="padding:0 8px 8px;">${otherTasksHtml}${overrideWeaponBtnsHtml}</div>
        </details>
      </div>` : ""}
      ${targetDropdownHtml}
    </div>`;
}

function buildDialogContent(state, actorSystems = {}, actorDepts = {}, actor = null) {
  const {
    crewNumDice, crewQuality,
    shipNumDice, shipSystemKey, shipDeptKey,
    difficulty, complicationRange,
    hasTargetingSolution, crewAssist,
    phase, crewDice, crewAssistDice, shipDice,
    officer, officerAttrKey, officerDiscKey,
    pendingAssistName,
    hasActorAtStation,
    hasActorAtHelm, helmActorName,
    assistOfficers,
    playerMode,
    sheetMode,
    isAssistRoll,
    availableShips: _availableShips,
    selectedShipIdx,
  } = state;
  const availableShips = _availableShips ?? [];
  // True when a player ship opens the roller directly from its sheet as an assist roll
  // Ground NPCs are excluded — they use character attr/disc, not ship system/dept
  const isShipAssistMode = isAssistRoll && !playerMode && !state.groundMode;
  const apAssistDice = state.apAssistDice ?? [];

  // Officer mode: use real stats. Generic mode: use crew quality preset.
  const isOfficerMode = !!officer;
  const quality = CREW_QUALITIES.find(q => q.key === crewQuality) ?? CREW_QUALITIES[0];
  const crewAttr = isOfficerMode
    ? (officer.attributes[officerAttrKey] ?? 9)
    : quality.attr;
  const crewDept = isOfficerMode
    ? (officer.disciplines[officerDiscKey] ?? 2)
    : quality.dept;
  const shipSysVal = actorSystems[shipSystemKey]?.value ?? state.shipSystems;
  const shipDptVal = actorDepts[shipDeptKey]?.value ?? state.shipDept;

  const sectionHeader = (label) => `
    <div style="
      background:${LC.primary};color:${LC.bg};
      font-size:9px;font-weight:700;letter-spacing:0.15em;
      text-transform:uppercase;padding:3px 10px;
      font-family:${LC.font};
    ">${label}</div>`;

  // Slider row with live value display
  const sliderRow = (id, label, val, min, max) => `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
        text-transform:uppercase;letter-spacing:0.08em;min-width:100px;">${label}</span>
      <input id="${id}" type="range" min="${min}" max="${max}" value="${val}"
        style="flex:1;accent-color:${LC.primary};" />
      <span id="${id}-val" style="font-size:12px;font-weight:700;
        color:${LC.tertiary};font-family:${LC.font};min-width:16px;text-align:right;">
        ${val}
      </span>
    </div>`;

  // Select dropdown
  const selectRow = (id, label, options, selected) => `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
        text-transform:uppercase;letter-spacing:0.08em;min-width:100px;">${label}</span>
      <select id="${id}" style="flex:1;padding:2px 4px;background:${LC.panel};
        border:1px solid ${LC.border};border-radius:2px;
        color:${LC.text};font-size:11px;font-family:${LC.font};">
        ${options.map(o => `<option value="${o.value}" ${o.value === selected ? "selected" : ""}>${o.label}</option>`).join("")}
      </select>
    </div>`;

  // ── Setup phase ────────────────────────────────────────────────────────────
  if (phase === "setup") {

    // ── Crew section: officer mode or generic quality ────────────────────────
    // Officer mode: named character with Attribute + Discipline selects
    // Generic mode: crew quality radio buttons (Basic / Proficient / etc.)

    const ATTR_KEYS = Object.keys(ATTR_LABELS);
    const DISC_KEYS = Object.keys(DISC_LABELS);

    const crewSectionHeader = isOfficerMode
      ? officer.name
      : playerMode ? "No Officer Assigned" : "NPC Crew Quality";

    const crewSectionContent = isOfficerMode ? (sheetMode ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
        <div>
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px;">Attribute</div>
          <div id="officer-attr-display" style="padding:3px 6px;background:${LC.panel};border:1px solid ${LC.border};
            border-radius:2px;color:${LC.tertiary};font-size:12px;font-weight:700;
            font-family:${LC.font};">${ATTR_LABELS[officerAttrKey] ?? officerAttrKey} (${crewAttr})</div>
          <input type="hidden" id="officer-attr" value="${officerAttrKey}">
        </div>
        <div>
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px;">Discipline</div>
          <div id="officer-disc-display" style="padding:3px 6px;background:${LC.panel};border:1px solid ${LC.border};
            border-radius:2px;color:${LC.tertiary};font-size:12px;font-weight:700;
            font-family:${LC.font};">${DISC_LABELS[officerDiscKey] ?? officerDiscKey} (${crewDept})</div>
          <input type="hidden" id="officer-disc" value="${officerDiscKey}">
        </div>
      </div>
      <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};margin-bottom:6px;">
        Target: <span id="crew-target-display"
          style="color:${LC.tertiary};font-weight:700;">${crewAttr + crewDept}</span>
        &nbsp;·&nbsp;
        Focus: <span id="crew-focus-display"
          style="color:${LC.primary};">1–${crewDept}</span>
      </div>` : `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
        <div>
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px;">Attribute</div>
          <select id="officer-attr"
            style="width:100%;padding:3px 6px;background:${LC.panel};
              border:1px solid ${LC.border};border-radius:2px;
              color:${LC.tertiary};font-size:12px;font-weight:700;font-family:${LC.font};">
            ${ATTR_KEYS.filter(k => officer.attributes[k] !== null).map(k => `
              <option value="${k}" ${k === officerAttrKey ? "selected" : ""}>
                ${ATTR_LABELS[k]} (${officer.attributes[k]})
              </option>`).join("")}
          </select>
        </div>
        <div>
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px;">Discipline</div>
          <select id="officer-disc"
            style="width:100%;padding:3px 6px;background:${LC.panel};
              border:1px solid ${LC.border};border-radius:2px;
              color:${LC.tertiary};font-size:12px;font-weight:700;font-family:${LC.font};">
            ${DISC_KEYS.filter(k => officer.disciplines[k] !== null).map(k => `
              <option value="${k}" ${k === officerDiscKey ? "selected" : ""}>
                ${DISC_LABELS[k]} (${officer.disciplines[k]})
              </option>`).join("")}
          </select>
        </div>
      </div>
      <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};margin-bottom:6px;">
        Target: <span id="crew-target-display"
          style="color:${LC.tertiary};font-weight:700;">${crewAttr + crewDept}</span>
        &nbsp;·&nbsp;
        Focus: <span id="crew-focus-display"
          style="color:${LC.primary};">1–${crewDept}</span>
      </div>`) : `
      ${playerMode ? `
      <div style="padding:5px 8px;margin-bottom:6px;
        background:rgba(255,153,0,0.06);border:1px solid ${LC.borderDim};border-radius:2px;">
        <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
          text-transform:uppercase;letter-spacing:0.08em;margin-bottom:3px;">
          No PC Assigned
        </div>
        <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};line-height:1.5;">
          Assign a crew member to this station in the Crew Manifest, or set dice count manually
          to match the character's Attribute + Discipline total.
        </div>
      </div>` : (() => {
      const q = CREW_QUALITIES.find(q => q.key === crewQuality) ?? CREW_QUALITIES[1];
      return `
        <div style="padding:5px 8px;margin-bottom:6px;
          background:rgba(255,153,0,0.06);border:1px solid ${LC.borderDim};border-radius:2px;">
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;margin-bottom:3px;">
            Crew Quality
          </div>
          <div style="display:flex;align-items:baseline;gap:8px;">
            <span style="font-size:12px;font-weight:700;color:${LC.primary};
              font-family:${LC.font};">${q.label}</span>
            <span style="font-size:10px;color:${LC.textDim};font-family:${LC.font};">
              Attr ${q.attr} · Dept ${q.dept} · Target ${q.attr + q.dept}
            </span>
          </div>
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};margin-top:1px;">
            Set quality in the Combat HUD
          </div>
        </div>`;
    })()}
      ${playerMode ? "" : `<div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
        margin-bottom:6px;">
        Attribute: <span id="crew-attr-display"
          style="color:${LC.tertiary};">${crewAttr}</span>
        &nbsp;·&nbsp;
        Discipline: <span id="crew-dept-display"
          style="color:${LC.tertiary};">${crewDept}</span>
        &nbsp;·&nbsp;
        Target: <span id="crew-target-display"
          style="color:${LC.tertiary};font-weight:700;">${crewAttr + crewDept}</span>
        &nbsp;·&nbsp;
        Focus: <span id="crew-focus-display"
          style="color:${LC.primary};">1–${crewDept}</span>
      </div>`}`;

    // Ship system options from actor
    const sysOptions = Object.entries(actorSystems).map(([k, s]) => ({
      value: k,
      label: `${_systemLabel(k)} (${s.value})`,
    }));
    const deptOptions = Object.entries(actorDepts).map(([k, d]) => ({
      value: k,
      label: `${_deptLabel(k)} (${d.value})`,
    }));

    const compThreshold = 21 - complicationRange;
    const compDesc = complicationRange === 1
      ? "Complications on: 20"
      : `Complications on: ${compThreshold}–20`;

    const _rollerHtml = `
      <div id="sta2e-npc-roller" style="background:${LC.bg};color:${LC.text};width:380px;max-height:calc(100vh - 250px);overflow-y:auto;">

        ${state.weaponContext ? `
        <div style="
          background:rgba(255,153,0,0.08);
          border-bottom:2px solid ${LC.primary};
          padding:6px 10px;
          display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;font-weight:700;color:${LC.primary};
            font-family:${LC.font};letter-spacing:0.06em;text-transform:uppercase;">
            ⚔ ${state.weaponContext.name}
          </span>
          <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">
            DMG ${state.weaponContext.damage}
            ${state.weaponContext.isTorpedo ? " · TORPEDO" : ""}
            ${state.hasRapidFireTorpedo && state.weaponContext.isTorpedo
          ? ` <span style="color:${LC.green};">· 🚀 Rapid-Fire +1</span>` : ""}
          </span>
        </div>` : ""}

        <!-- NPC Crew Pool / Named Officer -->
        ${isShipAssistMode ? sectionHeader("Ship Assist Roll") : sectionHeader(crewSectionHeader)}
        <div style="padding:8px 10px;">
          ${isShipAssistMode ? `
          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:4px;">
            <div style="font-size:12px;font-weight:700;color:${LC.text};font-family:${LC.font};">
              ${_systemLabel(shipSystemKey)} + ${_deptLabel(shipDeptKey)}
              <span style="color:${LC.textDim};font-weight:400;font-size:10px;"> &mdash; Target: </span>
              <span style="color:${LC.tertiary};">${shipSysVal + shipDptVal}</span>
            </div>
            ${state.hasAdvancedSensors ? `<div id="adv-sensor-note" style="font-size:9px;color:${LC.green};font-family:${LC.font};padding:2px 0;">&#9733; Advanced Sensor Suites &#8212; 2 dice when rolling Sensors</div>` : ''}
          </div>` : crewSectionContent}
          ${!isShipAssistMode && isOfficerMode ? `
          <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:6px;
            padding:5px 7px;background:rgba(255,153,0,0.04);
            border:1px solid ${LC.borderDim};border-radius:2px;">
            <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              letter-spacing:0.08em;text-transform:uppercase;margin-bottom:2px;">
              Officer Advantages
            </div>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input id="has-focus" type="checkbox"
                ${state.hasFocus ? "checked" : ""}
                style="accent-color:${LC.primary};" />
              <span style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
                text-transform:uppercase;letter-spacing:0.06em;">
                Has Focus — crit on 1–${crewDept}
              </span>
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input id="has-dedicated-forces" type="checkbox"
                ${state.hasDedicatedFocus ? "checked" : ""}
                style="accent-color:${LC.primary};" />
              <span style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
                text-transform:uppercase;letter-spacing:0.06em;">
                ${state.groundMode ? "Dedicated Focus" : "Dedicated Focus"} — crit on 1–${Math.min(20, crewDept * 2)}
              </span>
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input id="has-determination" type="checkbox"
                ${state.hasDetermination ? "checked" : ""}
                style="accent-color:${LC.secondary};" />
              <span style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
                text-transform:uppercase;letter-spacing:0.06em;">
                Spend Determination — force one die to roll 1
              </span>
            </label>
            ${isOfficerMode ? `
            ${state.hasTalentReroll ? `
            <div style="font-size:9px;color:${LC.tertiary};font-family:${LC.font};
              padding:1px 0;letter-spacing:0.05em;">
              ✦ ${state.talentRerollSource ?? "Bold / Cautious"} — reroll available post-roll
            </div>` : ""}
            ${state.hasAdvisorReroll ? `
            <div style="font-size:9px;color:${LC.tertiary};font-family:${LC.font};
              padding:1px 0;letter-spacing:0.05em;">
              ✦ ${state.advisorRerollSource ?? "Advisor"} — reroll available post-roll
            </div>` : ""}
            ${state.hasSystemReroll ? `
            <div style="font-size:9px;color:${LC.tertiary};font-family:${LC.font};
              padding:1px 0;letter-spacing:0.05em;">
              ✦ ${state.systemRerollSource ?? "System Talent"} — reroll available post-roll
            </div>` : ""}
            ${state.hasShipTalentReroll ? `
            <div style="font-size:9px;color:${LC.tertiary};font-family:${LC.font};
              padding:1px 0;letter-spacing:0.05em;">
              ✦ ${state.shipTalentRerollSource} — reroll available post-roll
            </div>` : ""}
            ${state.hasProcedural ? `
            <div style="font-size:9px;color:${LC.primary};font-family:${LC.font};
              padding:1px 0;letter-spacing:0.05em;">
              ✦ Procedural Compliance — will auto-apply (–1 die · +1 auto-success)
            </div>` : ""}
            ${state.hasPiercingSalvo ? `
            <div style="font-size:9px;color:${LC.secondary};font-family:${LC.font};
              padding:3px 0 1px;letter-spacing:0.05em;">
              ⚔️ Piercing Salvo — spend 2 Momentum for Piercing quality
            </div>` : ""}
            ${state.hasMultiTasking ? `
            <div id="multi-tasking-section" style="display:none;margin-top:4px;">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input id="multi-tasking-conn" type="checkbox"
                  style="accent-color:${LC.secondary};" />
                <span style="font-size:10px;color:${LC.secondary};text-transform:uppercase;
                  letter-spacing:0.08em;font-family:${LC.font};">
                  Multi-Tasking — Use Conn
                </span>
              </label>
              <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
                padding-left:18px;line-height:1.4;">
                Override using Conn discipline + Conn department
              </div>
            </div>` : ""}` : ""}
          </div>` : ""}
          <div id="sta2e-crew-dice-pool-section" style="${state.isAssistRoll ? "display:none;" : ""}">
          ${(() => {
        const useInteractive = game.settings.get("sta2e-toolkit", "interactiveDicePayment");
        if (isShipAssistMode) {
          return sliderRow("crew-num-dice", "Dice Pool", state.advancedSensorsActive ? 2 : 1, 1, state.hasAdvancedSensors ? 2 : 1);
        } else if (state.isAssistRoll) {
          return "";
        } else if (!useInteractive) {
          return sliderRow("crew-num-dice", "Dice Pool", crewNumDice, 1, 5);
        } else {
          // Interactive Dice Payment UI
          const maxExtra = 3;
          const slotsCount = state.hasFreeExtraDie ? 5 : 6;
          const totalCost = slotsCount;

          // Determine which payment sources to show:
          //   Player:                     Momentum + Threat
          //   Ground notable/major NPC:   Pool Threat + Personal Threat
          //   Ship NPC / Ground minor NPC: Pool Threat only
          const _showBothThreats = state.groundIsNpc &&
            (state.groundNpcType === "notable" || state.groundNpcType === "major");
          const sourcesHtml = state.playerMode
            ? `<div style="display:flex; justify-content:center; gap:15px; margin-bottom:8px;">
                     <div style="text-align:center;">
                       <img src="modules/sta2e-toolkit/assets/momentum.svg" class="sta2e-roller-coin-source" data-type="momentum" draggable="true"
                            style="width:36px; height:36px; cursor:grab; filter:drop-shadow(0 0 4px ${LC.primary});" title="Drag Momentum" />
                     </div>
                     <div style="text-align:center;">
                       <img src="modules/sta2e-toolkit/assets/threat.svg" class="sta2e-roller-coin-source" data-type="threat" draggable="true"
                            style="width:36px; height:36px; cursor:grab; filter:drop-shadow(0 0 4px ${LC.red});" title="Drag Threat" />
                     </div>
                   </div>`
            : (_showBothThreats
              ? `<div style="display:flex; flex-direction:column; align-items:center; margin-bottom:8px;">
                     <div style="display:flex; justify-content:center; gap:15px;">
                       <div style="text-align:center;">
                         <img src="modules/sta2e-toolkit/assets/threat.svg" class="sta2e-roller-coin-source" data-type="poolThreat" draggable="true"
                              style="width:36px; height:36px; cursor:grab; filter:drop-shadow(0 0 4px ${LC.red});" title="Drag Pool Threat" />
                         <div style="font-size:8px; color:${LC.textDim};">Pool</div>
                       </div>
                       <div style="text-align:center;">
                         <img src="modules/sta2e-toolkit/assets/threat.svg" class="sta2e-roller-coin-source" data-type="personalThreat" draggable="true"
                              style="width:36px; height:36px; cursor:grab; filter:drop-shadow(0 0 4px ${LC.orange});" title="Drag Personal Threat" />
                         <div style="font-size:8px; color:${LC.textDim};">Personal</div>
                       </div>
                     </div>
                   </div>`
              : `<div style="display:flex; justify-content:center; margin-bottom:8px;">
                     <div style="text-align:center;">
                       <img src="modules/sta2e-toolkit/assets/threat.svg" class="sta2e-roller-coin-source" data-type="poolThreat" draggable="true"
                            style="width:36px; height:36px; cursor:grab; filter:drop-shadow(0 0 4px ${LC.red});" title="Drag Pool Threat" />
                     </div>
                   </div>`);

          return `
                <div style="padding:6px 0; border-top:1px solid ${LC.borderDim}; border-bottom:1px solid ${LC.borderDim}; margin:5px 0;">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <span style="font-size:10px; color:${LC.textDim}; font-family:${LC.font}; text-transform:uppercase; letter-spacing:0.08em;">Dice Pool: <strong style="color:${LC.tertiary};">${crewNumDice}</strong></span>
                    <div style="display:flex; align-items:center; gap:6px;">
                      <span style="font-size:8px; color:${LC.textDim}; font-family:${LC.font}; text-transform:uppercase; letter-spacing:0.06em; white-space:nowrap;">+<span id="sta2e-easy-fill-val" style="color:${LC.tertiary};">${state.easyFillValue ?? 0}</span>D</span>
                      <input type="range" id="sta2e-easy-fill" min="0" max="3" value="${state.easyFillValue ?? 0}"
                        style="width:55px; vertical-align:middle; accent-color:${LC.secondary}; cursor:pointer;" title="Quick Fill: auto-fill slots with momentum/threat" />
                    </div>
                    <div style="display:flex; gap:8px;">
                      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                        <input type="checkbox" id="sta2e-free-extra-die" ${state.hasFreeExtraDie ? 'checked' : ''} style="accent-color:${LC.secondary};" />
                        <span style="font-size:8px;color:${LC.textDim};text-transform:uppercase;">Free Die</span>
                      </label>
                      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                        <input type="checkbox" id="sta2e-auto-success-trade" ${state.hasAutoSuccessTrade ? 'checked' : ''} style="accent-color:${LC.secondary};" />
                        <span style="font-size:8px;color:${LC.textDim};text-transform:uppercase;">Auto-Success (-1 Die)</span>
                      </label>
                    </div>
                  </div>
                  
                  <div style="display:flex; align-items:center;">
                    <div style="flex:0 0 auto; margin-right:15px; border-right:1px solid ${LC.borderDim}; padding-right:15px;">
                      ${sourcesHtml}
                    </div>
                    <div class="sta2e-roller-slots" style="flex:1; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                      ${Array.from({ length: totalCost }).map((_, i) => {
            const s = state.paymentSlots[i];
            let content = "";
            if (s === "momentum") content = `<img src="modules/sta2e-toolkit/assets/momentum.svg" style="width:100%;height:100%; border-radius:50%; filter:drop-shadow(0 0 2px ${LC.primary}); pointer-events:none;" />`;
            else if (s === "threat" || s === "poolThreat") content = `<img src="modules/sta2e-toolkit/assets/threat.svg" style="width:100%;height:100%; border-radius:50%; filter:drop-shadow(0 0 2px ${LC.red}); pointer-events:none;" />`;
            else if (s === "personalThreat") content = `<img src="modules/sta2e-toolkit/assets/threat.svg" style="width:100%;height:100%; border-radius:50%; filter:drop-shadow(0 0 2px ${LC.orange}); pointer-events:none;" />`;

            return `<div class="sta2e-roller-slot" data-index="${i}"
                             style="width:30px; height:30px; border-radius:50%;
                                    ${!s ? "background-image: url('data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'512\\' height=\\'512\\' viewBox=\\'0 0 512 512\\'%3E%3Ccircle cx=\\'256\\' cy=\\'256\\' r=\\'240\\' fill=\\'none\\' stroke=\\'%23aaaaaa\\' stroke-width=\\'20\\' stroke-dasharray=\\'100 40\\'/%3E%3C/svg%3E');" : "background-image: none;"}
                                    background-size: cover; display:flex; align-items:center; justify-content:center;
                                    cursor:${s ? "pointer" : "default"};">
                               ${content}
                        </div>`;
          }).join("")}
                      <div style="font-size:8px; color:${LC.textDim}; margin-left:auto;">
                        <div style="text-align:right;">Cost:</div>
                        <div style="display:flex; gap:4px;">
                          <span>1D=1</span>
                          ${state.hasFreeExtraDie ? "" : "<span>| 2D=3</span>"}
                          <span>| ${state.hasFreeExtraDie ? "2" : "3"}D=${state.hasFreeExtraDie ? (maxExtra === 2 ? "2" : "5") : (maxExtra === 2 ? "3" : "6")}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              `;
        }
      })()}
          </div>
          ${!hasActorAtStation && !state.playerMode && !isShipAssistMode && !state.groundMode ? `
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:2px;">
            <input id="crew-assist" type="checkbox"
              ${state.crewAssist ? "checked" : ""}
              style="accent-color:${LC.secondary};" />
            <span style="font-size:10px;color:${LC.textDim};text-transform:uppercase;
              letter-spacing:0.08em;font-family:${LC.font};">
              Assist from crew (+1 die)
            </span>
          </label>
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};padding-left:18px;">
            Attack patterns, coordinated maneuvers, etc.
            <span style="color:${LC.orange ?? LC.red};"> · Only counts if crew scores ≥1 success</span>
          </div>` : ""}
          ${pendingAssistName ? `
          <div style="font-size:9px;font-weight:700;color:${LC.primary};font-family:${LC.font};
            padding:3px 8px;margin-top:2px;border-left:2px solid ${LC.primary};
            background:rgba(255,153,0,0.06);border-radius:2px;">
            ${state.playerMode
          ? `🤝 ${pendingAssistName} will roll their own assist ${(assistOfficers?.length ?? 0) > 1 ? "dice" : "die"} via the Working Results card`
          : `✋ Assist declared by ${pendingAssistName} — will clear after task is posted`}
          </div>` : ""}

          ${(assistOfficers?.length > 0 && !state.playerMode) ? assistOfficers.map((ao, idx) => {
            // Each assisting officer gets a mini-section showing their name, attr/disc
            // selects, and focus checkboxes for their individual assist die.
            const aoAttrKey = ao.attrKey;
            const aoDiscKey = ao.discKey;
            const aoAttrVal = ao.stats ? (ao.stats.attributes[aoAttrKey] ?? null) : null;
            const aoDiscVal = ao.stats ? (ao.stats.disciplines[aoDiscKey] ?? null) : null;
            const ATTR_KEYS = Object.keys(ATTR_LABELS);
            const DISC_KEYS = Object.keys(DISC_LABELS);
            return `
            <div style="margin-top:6px;padding:6px 8px;
              background:rgba(255,153,0,0.05);
              border:1px solid ${LC.border};border-radius:2px;">
              <div style="font-size:9px;font-weight:700;color:${LC.primary};font-family:${LC.font};
                text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">
                ${ao.type === "direct" ? "🎖️" : "🤝"} ${ao.name} (${ao.type === "direct" ? "Direct" : "Assisting"})
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px;">
                <div>
                  <div style="font-size:8px;color:${LC.textDim};font-family:${LC.font};
                    letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px;">Attribute</div>
                  <select id="assist-${idx}-attr"
                    style="width:100%;padding:2px 4px;background:${LC.panel};
                      border:1px solid ${LC.border};border-radius:2px;
                      color:${LC.tertiary};font-size:11px;font-weight:700;font-family:${LC.font};">
                    ${ao.stats
                ? ATTR_KEYS.filter(k => ao.stats.attributes[k] !== null).map(k => `
                          <option value="${k}" ${k === aoAttrKey ? "selected" : ""}>
                            ${ATTR_LABELS[k]} (${ao.stats.attributes[k]})
                          </option>`).join("")
                : ATTR_KEYS.map(k => `
                          <option value="${k}" ${k === aoAttrKey ? "selected" : ""}>
                            ${ATTR_LABELS[k]}
                          </option>`).join("")}
                  </select>
                </div>
                <div>
                  <div style="font-size:8px;color:${LC.textDim};font-family:${LC.font};
                    letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px;">Discipline</div>
                  <select id="assist-${idx}-disc"
                    style="width:100%;padding:2px 4px;background:${LC.panel};
                      border:1px solid ${LC.border};border-radius:2px;
                      color:${LC.tertiary};font-size:11px;font-weight:700;font-family:${LC.font};">
                    ${ao.stats
                ? DISC_KEYS.filter(k => ao.stats.disciplines[k] !== null).map(k => `
                          <option value="${k}" ${k === aoDiscKey ? "selected" : ""}>
                            ${DISC_LABELS[k]} (${ao.stats.disciplines[k]})
                          </option>`).join("")
                : DISC_KEYS.map(k => `
                          <option value="${k}" ${k === aoDiscKey ? "selected" : ""}>
                            ${DISC_LABELS[k]}
                          </option>`).join("")}
                  </select>
                </div>
              </div>
              ${(aoAttrVal !== null && aoDiscVal !== null) ? `
              <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};margin-bottom:4px;">
                Target: <span style="color:${LC.tertiary};font-weight:700;">${aoAttrVal + aoDiscVal}</span>
                &nbsp;·&nbsp;
                Focus: <span style="color:${LC.primary};">1–${aoDiscVal}</span>
              </div>` : ""}
              <div style="display:flex;flex-direction:column;gap:3px;">
                <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
                  <input id="assist-${idx}-focus" type="checkbox"
                    ${ao.hasFocus ? "checked" : ""}
                    style="accent-color:${LC.primary};" />
                  <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
                    text-transform:uppercase;letter-spacing:0.06em;">
                    Has Focus — assist die crits on 1–${aoDiscVal ?? "disc"}
                  </span>
                </label>
                <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
                  <input id="assist-${idx}-dedicated" type="checkbox"
                    ${ao.hasDedicatedFocus ? "checked" : ""}
                    style="accent-color:${LC.primary};" />
                  <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
                    text-transform:uppercase;letter-spacing:0.06em;">
                    Dedicated Focus — crit on 1–${aoDiscVal !== null ? Math.min(20, aoDiscVal * 2) : "disc×2"}
                  </span>
                </label>
              </div>
            </div>`;
          }).join("") : ""}
        </div>

        <!-- NPC Ship Pool — hidden for ground character rolls or assist rolls -->
        ${(!state.groundMode || state.groundIsNpc) ? `
        <div id="sta2e-ship-pool-section">
        ${state.sheetMode ? `
        <div style="display:flex;align-items:center;justify-content:space-between;
          background:${LC.primary};padding:3px 6px 3px 10px;">
          <span style="font-size:9px;font-weight:700;letter-spacing:0.15em;
            text-transform:uppercase;color:${LC.bg};font-family:${LC.font};">Ship Pool</span>
          <button id="sta2e-manage-ships"
            style="font-size:9px;padding:1px 6px;background:transparent;
              border:1px solid ${LC.bg};border-radius:2px;color:${LC.bg};
              cursor:pointer;font-family:${LC.font};letter-spacing:0.05em;">
            ⚙ Manage
          </button>
        </div>` : sectionHeader(availableShips.length > 0 ? "Ship Pool" : "NPC Ship Pool")}
        <div style="padding:8px 10px;display:flex;flex-direction:column;gap:6px;">
          ${availableShips.length > 0 ? `
          <!-- Sheet mode: checkbox reveals ship selector + pool body -->
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input id="ship-assist" type="checkbox"
              ${selectedShipIdx >= 0 ? "checked" : ""}
              style="accent-color:${LC.primary};" />
            <span style="font-size:10px;color:${LC.textDim};text-transform:uppercase;
              letter-spacing:0.08em;font-family:${LC.font};">
              Ship is assisting this roll
            </span>
          </label>
          <div id="ship-select-body" style="${selectedShipIdx >= 0 ? 'display:flex;' : 'display:none;'}flex-direction:column;gap:6px;">
            <label style="font-size:10px;color:${LC.textDim};text-transform:uppercase;
              letter-spacing:0.08em;font-family:${LC.font};">Assisting Ship</label>
            <select id="sheet-ship-select" style="width:100%;padding:3px 5px;
              background:#1a1a2e;color:${LC.text};border:1px solid ${LC.borderDim};
              border-radius:3px;font-family:${LC.font};font-size:11px;">
              <option value="-1">&mdash; No ship assist &mdash;</option>
              ${availableShips.map((s, i) => `<option value="${i}"
                ${selectedShipIdx === i ? "selected" : ""}
                data-actor-id='${s.actorId ?? ""}'
                data-systems='${JSON.stringify(s.systems).replace(/'/g, "&#39;")}'
                data-depts='${JSON.stringify(s.depts).replace(/'/g, "&#39;")}'
                data-has-advanced-sensors='${s.hasAdvancedSensors ? "1" : "0"}'
                data-sensors-breaches='${s.sensorsBreaches ?? 0}'
              >${s.label}</option>`).join("")}
            </select>
          <div id="ship-pool-body" style="display:flex;flex-direction:column;gap:6px;">
          ` : `
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input id="ship-assist" type="checkbox"
              ${state.shipAssist ? "checked" : ""}
              style="accent-color:${LC.primary};" />
            <span style="font-size:10px;color:${LC.textDim};text-transform:uppercase;
              letter-spacing:0.08em;font-family:${LC.font};">
              Ship assists this roll
            </span>
          </label>
          <div id="ship-pool-body" style="display:flex;flex-direction:column;gap:6px;${state.shipAssist ? "" : "opacity:0.4;pointer-events:none;"
        }">
          `}
            <div id="ship-adv-sensors-notice">${state.advancedSensorsActive
          ? `<div style="font-size:9px;color:${LC.green};font-family:${LC.font};
                  display:flex;align-items:center;gap:6px;">
                  <span>★ Advanced Sensor Suites — rolling 2 dice (Sensors selected)</span>
                </div>`
          : `${state.hasAdvancedSensors && state.sensorsBreaches === 0
            ? `<div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">
                      ★ Advanced Sensor Suites available — select Sensors system to activate (rolls 2 dice)
                    </div>`
            : ""}
                ${state.hasAdvancedSensors && state.sensorsBreaches > 0
            ? `<div style="font-size:9px;color:${LC.red};font-family:${LC.font};">
                      ✗ Advanced Sensor Suites unavailable — Sensors has ${state.sensorsBreaches} breach${state.sensorsBreaches > 1 ? "es" : ""}
                    </div>`
            : ""}`
        }</div>
            ${selectRow("ship-system-key", "System", sysOptions, shipSystemKey)}
            ${selectRow("ship-dept-key", "Department", deptOptions, shipDeptKey)}
            <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">
              Target: <span id="ship-target-display"
                style="color:${LC.tertiary};font-weight:700;">${shipSysVal + shipDptVal}</span>
              &nbsp;·&nbsp;
              Focus: <span id="ship-focus-display" style="color:${LC.primary};">1–${shipDptVal}</span>
            </div>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:2px;">
              <input id="reserve-power" type="checkbox"
                ${state.reservePower ? "checked" : ""}
                style="accent-color:${LC.secondary};" />
              <span style="font-size:10px;color:${LC.textDim};text-transform:uppercase;
                letter-spacing:0.08em;font-family:${LC.font};">
                Reserve Power rerouted to this system
              </span>
            </label>
            <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};padding-left:18px;">
              Assist die counts as 1 (automatic critical) · each complication counts as 2
            </div>
          </div>
          ${availableShips.length > 0 ? `</div>` : ""}
        </div>
        </div>
        ` : ""}

        <!-- Attack Pattern assist section -->
        <!-- Shows whenever hasAttackPattern is true, regardless of whether a named
             helm officer is assigned. Without a named officer the die rolls at crew
             quality target / focus range. -->
        ${state.hasAttackPattern ? `
        ${sectionHeader("⚡ Attack Pattern — Helm Assist")}
        <div style="padding:6px 10px;display:flex;flex-direction:column;gap:5px;">
          <div style="font-size:10px;color:${LC.text};font-family:${LC.font};line-height:1.4;">
            ${state.helmOfficer
          ? `<strong style="color:${LC.primary};">${state.helmOfficer.name}</strong>
                 may assist this attack using <strong>Control + Conn</strong>
                 (target ${(state.helmOfficer.attributes?.control ?? 0) + (state.helmOfficer.disciplines?.conn ?? 0)},
                 focus 1–${state.helmOfficer.disciplines?.conn ?? 0}).`
          : state.hasActorAtHelm
            ? `<strong style="color:${LC.primary};">${helmActorName ?? "Helm Officer"}</strong>
                   may assist this attack using <strong>Control + Conn</strong>
                   (crew quality target ${crewAttr + crewDept}, focus 1–${crewDept}).`
            : `Helm crew assist this attack using <strong>Control + Conn</strong>
                   (crew quality — target ${crewAttr + crewDept}, focus 1–${crewDept}).`}
          </div>
          ${!state.attackRunActive ? `
          <div style="font-size:10px;color:${LC.yellow};font-family:${LC.font};
            padding:3px 6px;border-left:2px solid ${LC.yellow};border-radius:2px;
            background:rgba(255,204,0,0.06);">
            ⚠ Attack Pattern penalty: attacks against this ship have Difficulty −1
            until your next turn.
          </div>` : `
          <div style="font-size:10px;color:${LC.green};font-family:${LC.font};
            padding:3px 6px;border-left:2px solid ${LC.green};border-radius:2px;
            background:rgba(0,200,100,0.06);">
            ★ Attack Run: Difficulty penalty suppressed — attacks against this ship
            are not reduced.
          </div>`}
          ${state.helmOfficer ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
            <div>
              <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
                letter-spacing:0.08em;text-transform:uppercase;margin-bottom:2px;">Attribute</div>
              <select id="ap-attr"
                style="width:100%;padding:3px 6px;background:${LC.panel};
                  border:1px solid ${LC.border};border-radius:2px;
                  color:${LC.tertiary};font-size:11px;font-weight:700;font-family:${LC.font};">
                ${Object.entries(state.helmOfficer.attributes ?? {})
            .filter(([, v]) => v !== null)
            .map(([k, v]) => `<option value="${k}" ${k === "control" ? "selected" : ""}>${ATTR_LABELS[k] ?? k} (${v})</option>`)
            .join("")}
              </select>
            </div>
            <div>
              <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
                letter-spacing:0.08em;text-transform:uppercase;margin-bottom:2px;">Discipline</div>
              <select id="ap-disc"
                style="width:100%;padding:3px 6px;background:${LC.panel};
                  border:1px solid ${LC.border};border-radius:2px;
                  color:${LC.tertiary};font-size:11px;font-weight:700;font-family:${LC.font};">
                ${Object.entries(state.helmOfficer.disciplines ?? {})
            .filter(([, v]) => v !== null)
            .map(([k, v]) => `<option value="${k}" ${k === "conn" ? "selected" : ""}>${DISC_LABELS[k] ?? k} (${v})</option>`)
            .join("")}
              </select>
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input id="ap-has-focus" type="checkbox"
              ${state.apHasFocus ? "checked" : ""}
              style="accent-color:${LC.primary};" />
            <span style="font-size:10px;color:${LC.textDim};text-transform:uppercase;
              letter-spacing:0.06em;font-family:${LC.font};">
              Has Focus — crit on 1–${state.helmOfficer.disciplines?.conn ?? 0}
            </span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input id="ap-dedicated-forces" type="checkbox"
              ${state.apDedicatedFocus ? "checked" : ""}
              style="accent-color:${LC.primary};" />
            <span style="font-size:10px;color:${LC.textDim};text-transform:uppercase;
              letter-spacing:0.06em;font-family:${LC.font};">
              Dedicated Focus — crit on 1–${Math.min(20, (state.helmOfficer.disciplines?.conn ?? 0) * 2)}
            </span>
          </label>` : state.hasActorAtHelm ? `
          <!-- Actor at helm but no STA2e stats — show unlabelled selects + focus flags -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
            <div>
              <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
                letter-spacing:0.08em;text-transform:uppercase;margin-bottom:2px;">Attribute</div>
              <select id="ap-attr"
                style="width:100%;padding:3px 6px;background:${LC.panel};
                  border:1px solid ${LC.border};border-radius:2px;
                  color:${LC.tertiary};font-size:11px;font-weight:700;font-family:${LC.font};">
                ${ATTR_KEYS.map(k => `<option value="${k}" ${k === "control" ? "selected" : ""}>${ATTR_LABELS[k]}</option>`).join("")}
              </select>
            </div>
            <div>
              <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
                letter-spacing:0.08em;text-transform:uppercase;margin-bottom:2px;">Discipline</div>
              <select id="ap-disc"
                style="width:100%;padding:3px 6px;background:${LC.panel};
                  border:1px solid ${LC.border};border-radius:2px;
                  color:${LC.tertiary};font-size:11px;font-weight:700;font-family:${LC.font};">
                ${DISC_KEYS.map(k => `<option value="${k}" ${k === "conn" ? "selected" : ""}>${DISC_LABELS[k]}</option>`).join("")}
              </select>
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input id="ap-has-focus" type="checkbox"
              ${state.apHasFocus ? "checked" : ""}
              style="accent-color:${LC.primary};" />
            <span style="font-size:10px;color:${LC.textDim};text-transform:uppercase;
              letter-spacing:0.06em;font-family:${LC.font};">
              Has Focus — crit on 1–${crewDept}
            </span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input id="ap-dedicated-forces" type="checkbox"
              ${state.apDedicatedFocus ? "checked" : ""}
              style="accent-color:${LC.primary};" />
            <span style="font-size:10px;color:${LC.textDim};text-transform:uppercase;
              letter-spacing:0.06em;font-family:${LC.font};">
              Dedicated Focus — crit on 1–${Math.min(20, crewDept * 2)}
            </span>
          </label>` : `
          <!-- Pure NPC helm crew — always assumes focus, no GM input required -->
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            padding:3px 6px;border-left:2px solid ${LC.borderDim};border-radius:2px;">
            NPC helm crew — always assumes focus (crit on 1–${crewDept}).
          </div>`}
        </div>` : ""}

        <!-- Breach / strain penalty warnings -->
        ${state.breachPenalty?.penaltyNote ? `
        <div style="margin:4px 10px;padding:5px 8px;border-radius:2px;
          background:${state.breachPenalty.isDestroyed ? "rgba(255,0,0,0.12)" : "rgba(255,136,0,0.10)"};
          border-left:3px solid ${state.breachPenalty.isDestroyed ? LC.red : LC.yellow};">
          <div style="font-size:10px;font-weight:700;font-family:${LC.font};
            color:${state.breachPenalty.isDestroyed ? LC.red : LC.yellow};
            letter-spacing:0.06em;">
            ${state.breachPenalty.penaltyNote}
          </div>
          ${state.breachPenalty.isDestroyed ? `
          <div style="font-size:9px;color:${LC.red};font-family:${LC.font};margin-top:2px;">
            This task cannot be attempted — the system is destroyed.
          </div>` : ""}
        </div>` : ""}
        ${(() => {
        const CombatHUD = game.sta2eToolkit?.CombatHUD;
        const deptStrain = CombatHUD ? CombatHUD.getDeptStrainRange(actor, state.officerDiscKey) : 0;
        return deptStrain > 0 ? `
        <div style="margin:4px 10px;padding:5px 8px;border-radius:2px;
          background:rgba(255,153,0,0.08);
          border-left:3px solid ${LC.orange};">
          <div style="font-size:10px;font-weight:700;font-family:${LC.font};
            color:${LC.orange};letter-spacing:0.06em;">
            💥 Crew Casualties — ${CombatHUD.deptLabel(state.officerDiscKey)} dept
            complication range +${deptStrain}
          </div>
        </div>` : "";
      })()}

        <!-- Task Options -->
        <div id="sta2e-task-options-section">
        ${sectionHeader("Task Options")}
        <div style="padding:8px 10px;display:flex;flex-direction:column;gap:6px;">
          ${state.opposedDefenseType ? `
            <div style="padding:5px 8px;background:rgba(255,153,0,0.08);
              border-left:3px solid ${LC.primary};border-radius:2px;
              font-family:${LC.font};">
              <div style="font-size:9px;font-weight:700;color:${LC.primary};
                letter-spacing:0.06em;text-transform:uppercase;margin-bottom:2px;">
                ${state.opposedDefenseType === "evasive-action" ? "↗️ Opposed — Evasive Action"
          : state.opposedDefenseType === "defensive-fire" ? "🛡️ Opposed — Defensive Fire"
            : state.opposedDefenseType === "melee" ? "⚔️ Opposed — Melee"
              : "🪨 Opposed — Cover"}
              </div>
              <div style="font-size:9px;color:${LC.text};">
                Defender rolled <strong style="color:${LC.tertiary};">${state.defenderSuccesses}</strong> success${state.defenderSuccesses !== 1 ? "es" : ""} — Difficulty locked to <strong style="color:${LC.tertiary};">${state.difficulty}</strong>
              </div>
            </div>` : ""}
          <div id="sta2e-difficulty-row" style="${(isShipAssistMode || (state.isAssistRoll && state.groundMode)) ? 'display:none;' : 'display:flex;'}align-items:center;gap:8px;">
            <span style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;min-width:100px;">Difficulty</span>
            <input id="difficulty" type="number" min="0" value="${difficulty}"
              ${state.opposedDefenseType ? "readonly" : ""}
              style="width:60px;padding:3px 6px;background:${LC.panel};
                border:1px solid ${state.opposedDefenseType ? LC.primary : LC.border};border-radius:2px;
                color:${LC.tertiary};font-size:13px;font-weight:700;
                font-family:${LC.font};text-align:center;
                ${state.opposedDefenseType ? "opacity:0.7;cursor:not-allowed;" : ""}" />
            <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">
              (0 = routine, no limit)
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;min-width:100px;">
              Complication
            </span>
            <input id="complication-range" type="range" min="1" max="5"
              value="${complicationRange}"
              style="flex:1;accent-color:${LC.red};" />
            <span id="complication-range-val" style="font-size:12px;font-weight:700;
              color:${LC.red};font-family:${LC.font};min-width:16px;text-align:right;">
              ${complicationRange}
            </span>
          </div>
          <div id="complication-desc" style="font-size:9px;color:${LC.textDim};
            font-family:${LC.font};padding-left:108px;">${compDesc}</div>
          ${!state.groundMode && !isShipAssistMode ? `
          <div id="targeting-solution-label" style="${state.sheetMode && state.selectedShipIdx < 0 ? "display:none;" : "display:flex;flex-direction:column;gap:4px;"}">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input id="targeting-solution" type="checkbox"
                ${hasTargetingSolution ? "checked" : ""}
                style="accent-color:${LC.secondary};" />
              <span style="font-size:10px;color:${LC.textDim};text-transform:uppercase;
                letter-spacing:0.08em;font-family:${LC.font};">
                Targeting Solution
              </span>
            </label>
            <div id="ts-benefit-section" style="display:${hasTargetingSolution ? "flex" : "none"};flex-direction:column;gap:3px;margin-left:20px;">
              <div style="display:flex;gap:6px;">
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                  <input type="radio" name="ts-benefit" id="ts-benefit-reroll" value="reroll"
                    ${(state.tsChoice ?? "reroll") === "reroll" ? "checked" : ""}
                    style="accent-color:${LC.secondary};" />
                  <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};text-transform:uppercase;letter-spacing:0.06em;">Reroll d20</span>
                </label>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                  <input type="radio" name="ts-benefit" id="ts-benefit-system" value="system"
                    ${state.tsChoice === "system" ? "checked" : ""}
                    style="accent-color:${LC.secondary};" />
                  <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};text-transform:uppercase;letter-spacing:0.06em;">Target System</span>
                </label>
              </div>
              <div id="ts-system-picker" style="display:${state.tsChoice === "system" ? "grid" : "none"};grid-template-columns:1fr 1fr 1fr;gap:3px;margin-top:2px;">
                ${["communications", "computers", "engines", "sensors", "structure", "weapons"].map(s => {
                const _sysHud = game.sta2eToolkit?.CombatHUD;
                const _lbl = _sysHud ? _sysHud.systemLabel(s) : s.charAt(0).toUpperCase() + s.slice(1);
                return `
                  <button type="button" class="ts-sys-btn" data-system="${s}"
                    style="padding:2px 4px;font-size:8px;font-family:${LC.font};
                    text-transform:uppercase;letter-spacing:0.05em;cursor:pointer;
                    border-radius:2px;
                    background:${state.tsSystem === s ? "rgba(255,153,0,0.15)" : "rgba(255,153,0,0.04)"};
                    border:1px solid ${state.tsSystem === s ? LC.secondary : LC.borderDim};
                    color:${state.tsSystem === s ? LC.primary : LC.secondary};">
                    ${_lbl}
                  </button>`;
              }).join("")}
                <button type="button" class="ts-sys-btn" data-system="random"
                  style="padding:2px 4px;font-size:8px;font-family:${LC.font};
                  text-transform:uppercase;letter-spacing:0.05em;cursor:pointer;
                  grid-column:1/-1;
                  border-radius:2px;
                  background:${state.tsSystem === null && state.tsChoice === "system" ? "rgba(255,153,0,0.15)" : "rgba(255,153,0,0.04)"};
                  border:1px solid ${state.tsSystem === null && state.tsChoice === "system" ? LC.secondary : LC.borderDim};
                  color:${state.tsSystem === null && state.tsChoice === "system" ? LC.primary : LC.secondary};">
                  Roll Randomly
                </button>
              </div>
            </div>
          </div>
          <label id="calibrate-sensors-label" style="display:flex;align-items:center;gap:6px;cursor:pointer;${state.sheetMode && state.selectedShipIdx < 0 ? "display:none;" : ""}">
            <input id="calibrate-sensors" type="checkbox"
              ${state.hasCalibratesensors ? "checked" : ""}
              style="accent-color:${LC.secondary};" />
            <span style="font-size:10px;color:${LC.textDim};text-transform:uppercase;
              letter-spacing:0.08em;font-family:${LC.font};">
              Calibrate Sensors (ignore 1 trait OR re-roll 1d20)
            </span>
          </label>
          ${state.weaponContext ? `
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input id="calibrate-weapons" type="checkbox"
              ${state.hasCalibrateWeapons ? "checked" : ""}
              style="accent-color:${LC.secondary};" />
            <span style="font-size:10px;color:${LC.textDim};text-transform:uppercase;
              letter-spacing:0.08em;font-family:${LC.font};">
              Calibrate Weapons (+1 damage on this attack)
            </span>
          </label>` : ""}
          ` : ""}
        ${(state.sheetMode && state.playerMode && !isShipAssistMode) || (state.groundMode && state.groundIsNpc) ? `
        <label id="assist-roll-label" style="display:flex;align-items:center;gap:6px;cursor:pointer;
          margin-top:4px;padding:5px 7px;border-radius:2px;
          background:${state.isAssistRoll ? 'rgba(0,150,255,0.10)' : 'transparent'};
          border:1px solid ${state.isAssistRoll ? LC.secondary : 'transparent'};
          transition:background 0.15s,border 0.15s;">
          <input id="is-assist-roll" type="checkbox"
            ${state.isAssistRoll ? "checked" : ""}
            style="accent-color:${LC.secondary};" />
          <span style="font-size:10px;color:${LC.secondary};text-transform:uppercase;
            letter-spacing:0.08em;font-family:${LC.font};">
            Roll as Assist — apply to another player's task
          </span>
        </label>` : ""}
        </div>
        </div><!-- /sta2e-task-options-section -->

      </div>
      `;  // end setup phase roller content
    // Wrap in flex container with combat task panel on the right if in combat
    if (state.combatTaskContext) {
      return `<div style="display:flex;gap:12px;align-items:flex-start;">${_rollerHtml}${_buildCombatTaskPanelHtml(state)}</div>`;
    }
    return _rollerHtml;
  }

  // ── Rolled phase ───────────────────────────────────────────────────────────
  const crewTarget = crewAttr + crewDept;
  const shipTarget = shipSysVal + shipDptVal;
  const crewSucc = countSuccesses(crewDice);
  const shipSucc = countSuccesses(shipDice);

  // Targeting Solution: benefit depends on pre-declared choice
  const _tsChoice = state.tsChoice ?? "reroll";   // default to reroll if not declared
  const tsAvailable = hasTargetingSolution && _tsChoice !== "system" && !state.tsRerollUsed;
  const tsNote = hasTargetingSolution
    ? (() => {
      if (_tsChoice === "system") {
        const CombatHUD = game.sta2eToolkit?.CombatHUD;
        const sysLabel = state.tsSystem && CombatHUD
          ? CombatHUD.systemLabel(state.tsSystem) : "random";
        const ftsExtra = state.hasFastTargeting
          ? ` <span style="color:${LC.primary};"> · Fast Targeting Systems: also re-rolling d20</span>`
          : "";
        return `<div style="font-size:9px;color:${LC.secondary};padding:2px 10px 4px;font-family:${LC.font};">
            Targeting Solution — targeting ${sysLabel} system on hit${ftsExtra}</div>`;
      }
      // reroll or both
      const _ftsExtra = state.hasFastTargeting
        ? ` <span style="color:${LC.primary};"> · Fast Targeting Systems: also choose system hit</span>`
        : "";
      return tsAvailable
        ? `<div style="font-size:9px;color:${LC.secondary};padding:2px 10px 4px;font-family:${LC.font};">
              Targeting Solution — click any crew die to reroll (free, one use)${_ftsExtra}</div>`
        : `<div style="font-size:9px;color:${LC.textDim};padding:2px 10px 4px;font-family:${LC.font};">
              Targeting Solution reroll used${_ftsExtra}</div>`;
    })()
    : "";

  // Rapid-Fire Torpedo Launcher: one free reroll of any ship die
  const rfAvailable = state.hasRapidFireTorpedo && !state.rfRerollUsed;
  const rfNote = state.hasRapidFireTorpedo
    ? (rfAvailable
      ? `<div style="font-size:9px;color:${LC.green};padding:2px 10px 4px;font-family:${LC.font};">
            🚀 Rapid-Fire Torpedo Launcher — click any ship die to reroll (free, one use)</div>`
      : `<div style="font-size:9px;color:${LC.textDim};padding:2px 10px 4px;font-family:${LC.font};">
            🚀 Rapid-Fire Torpedo reroll used</div>`)
    : "";

  // Calibrate Sensors: one free reroll of any crew die (consumed when used)
  const csAvailable = state.hasCalibratesensors && !state.csRerollUsed;
  const csNote = state.hasCalibratesensors
    ? (csAvailable
      ? `<div style="font-size:9px;color:${LC.secondary};padding:2px 10px 4px;font-family:${LC.font};">
            🎚️ Calibrate Sensors — click any crew die to reroll (free, one use)</div>`
      : `<div style="font-size:9px;color:${LC.textDim};padding:2px 10px 4px;font-family:${LC.font};">
            🎚️ Calibrate Sensors reroll used</div>`)
    : "";

  // Aim: reroll 1 die (2 with Accurate weapon) — granted by ground Aim minor action
  const aimRemaining = (state.aimRerolls ?? 0) - (state.aimRerollsUsed ?? 0);
  const aimNote = state.aimRerolls > 0
    ? (aimRemaining > 0
      ? `<div style="font-size:9px;color:${LC.secondary};padding:2px 10px 4px;font-family:${LC.font};">
            🎯 Aim — click any die to re-roll (${aimRemaining} remaining)</div>`
      : `<div style="font-size:9px;color:${LC.textDim};padding:2px 10px 4px;font-family:${LC.font};">
            🎯 Aim reroll${state.aimRerolls > 1 ? "s" : ""} used</div>`)
    : "";

  // Calibrate Weapons: +1 damage on this attack — show as a status note
  const cwNote = state.hasCalibrateWeapons && state.weaponContext
    ? (!state.cwBonusApplied
      ? `<div style="font-size:9px;color:${LC.primary};padding:2px 10px 4px;font-family:${LC.font};">
            🔩 Calibrate Weapons — +1 damage will be applied on resolve</div>`
      : `<div style="font-size:9px;color:${LC.textDim};padding:2px 10px 4px;font-family:${LC.font};">
            🔩 Calibrate Weapons bonus applied</div>`)
    : "";

  // Crew die pip hint: glow only when an arm button is active OR TS/CS is available.
  // Talent/Advisor/System/ShipTalent rerolls now require pressing an "arm" button first.
  const crewRerollHint = (() => {
    const armed = state.activeRerollAbility;
    if (armed && armed !== "detReroll") {
      // An arm button is active — show "click to use" hint on all crew pips
      const src = {
        talent: state.talentRerollSource,
        advisor: state.advisorRerollSource,
        system: state.systemRerollSource,
        shipTalent: state.shipTalentRerollSource
      }[armed];
      return `🎯 Click to reroll (${src ?? armed})`;
    }
    // TS / CS / Aim still work via direct pip click (no button required)
    if (tsAvailable) return "🎯 Click to use Targeting Solution — free reroll";
    if (csAvailable) return "🎚️ Click to use Calibrate Sensors — free reroll";
    if (aimRemaining > 0) return `🎯 Click to use Aim — re-roll (${aimRemaining} remaining)`;
    return null;
  })();
  const shipRerollHint = (state.hasRapidFireTorpedo && !state.rfRerollUsed)
    ? "🚀 Click to use Rapid-Fire Torpedo Launcher — free reroll"
    : null;

  const poolRow = (label, dice, poolKey) => `
    <div style="padding:6px 10px;">
      <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
        letter-spacing:0.08em;margin-bottom:4px;font-family:${LC.font};">
        ${label} — ${countSuccesses(dice)} success${countSuccesses(dice) !== 1 ? "es" : ""}
        ${countComplications(dice) > 0
      ? `<span style="color:${LC.red};"> · ${countComplications(dice)} complication${countComplications(dice) > 1 ? "s" : ""}</span>`
      : ""}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">
        ${dice.map((d, i) => {
        const hint = poolKey === "crew"
          ? (state.activeRerollAbility === "detReroll" ? null : crewRerollHint)
          : (poolKey === "ship" ? shipRerollHint : null);
        return diePipHtml(d, i, poolKey, hint);
      }).join("")}
      </div>
    </div>`;

  // Assist die row — slightly dimmed, dashed outline to distinguish from main pool
  // Attack Pattern assist die display row
  const apAssistRow = (apAssistDice.length > 0) ? `
    <div style="padding:4px 10px 6px;border-top:1px solid ${LC.borderDim};">
      <div style="font-size:9px;color:${LC.primary};text-transform:uppercase;
        letter-spacing:0.08em;margin-bottom:4px;font-family:${LC.font};font-weight:700;">
        ⚡ Attack Pattern — ${state.helmOfficer?.name ?? "Helm"} assist
        (${ATTR_LABELS[state.apAttrKey] ?? state.apAttrKey}+${DISC_LABELS[state.apDiscKey] ?? state.apDiscKey})
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">
        ${apAssistDice.map(d => {
    const txtColor = d.crit ? LC.primary : d.success ? LC.green : d.complication ? LC.red : "#aaaaaa";
    const fsize = d.value >= 10 ? "9px" : "11px";
    const tip = `AP Assist die ${d.value}${d.crit ? " (CRITICAL — 2 successes)" : d.success ? " (success)" : ""}${d.complication ? " (COMPLICATION)" : ""}`;
    const lbl = d.crit
      ? `<span style="display:flex;flex-direction:column;align-items:center;line-height:1;gap:0px;">
                <span style="font-size:7px;letter-spacing:-1px;color:${txtColor};">★★</span>
                <span style="font-size:${fsize};">${d.value}</span>
               </span>`
      : `<span style="font-size:${fsize};">${d.value}</span>`;
    return `
            <div title="${tip}" style="
              position:relative;display:inline-flex;align-items:center;justify-content:center;
              width:38px;height:38px;
              outline:2px dashed ${LC.primary};outline-offset:2px;border-radius:2px;
              background:rgba(255,153,0,0.06);">
              <img src="icons/svg/d20-grey.svg"
                style="position:absolute;top:0;left:0;width:38px;height:38px;
                  opacity:0.2;pointer-events:none;" alt="" />
              <span style="position:relative;z-index:1;color:${txtColor};
                font-weight:700;font-family:${LC.font};
                text-shadow:0 1px 2px rgba(0,0,0,0.9);pointer-events:none;">
                ${lbl}
              </span>
            </div>`;
  }).join("")}
      </div>
    </div>` : "";

  const assistRow = (crewAssistDice && crewAssistDice.length > 0) ? `
    <div style="padding:4px 10px 6px;">
      <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
        letter-spacing:0.08em;margin-bottom:4px;font-family:${LC.font};">
        Assist die
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">
        ${crewAssistDice.map(d => {
    const txtColor = d.crit ? LC.primary
      : d.success ? LC.green
        : d.complication ? LC.red
          : "#aaaaaa";
    const fsize = d.value >= 10 ? "9px" : "11px";
    const tip = `Assist die ${d.value}${d.crit ? " (CRITICAL — 2 successes)" : d.success ? " (success)" : ""}${d.complication ? " (COMPLICATION)" : ""}`;
    const lbl = d.crit
      ? `<span style="display:flex;flex-direction:column;align-items:center;line-height:1;gap:0px;">
                <span style="font-size:7px;letter-spacing:-1px;color:${txtColor};">★★</span>
                <span style="font-size:${fsize};">${d.value}</span>
               </span>`
      : `<span style="font-size:${fsize};">${d.value}</span>`;
    return `
            <div title="${tip}" style="
              position:relative;display:inline-flex;align-items:center;justify-content:center;
              width:38px;height:38px;
              outline:2px dashed ${LC.borderDim};outline-offset:2px;border-radius:2px;">
              <img src="icons/svg/d20-grey.svg"
                style="position:absolute;top:0;left:0;width:38px;height:38px;
                  opacity:0.2;pointer-events:none;" alt="" />
              <span style="position:relative;z-index:1;color:${txtColor};
                font-weight:700;font-family:${LC.font};
                text-shadow:0 1px 2px rgba(0,0,0,0.9);pointer-events:none;">
                ${lbl}
              </span>
            </div>`;
  }).join("")}
      </div>
    </div>` : "";

  return `
    <div id="sta2e-npc-roller" style="background:${LC.bg};color:${LC.text};width:360px;max-height:calc(100vh - 250px);overflow-y:auto;">

      ${sectionHeader(isOfficerMode
    ? (() => {
      const focusRange = state.hasDedicatedFocus
        ? `1–${Math.min(20, state.crewDept * 2)} (Dedicated Focus)`
        : state.hasFocus
          ? `1–${state.crewDept} (Focus)`
          : "1 only";
      return `${officer.name} · ${ATTR_LABELS[officerAttrKey] ?? officerAttrKey} + ${DISC_LABELS[officerDiscKey] ?? officerDiscKey} · Target: ${crewTarget} · Crit: ${focusRange}`;
    })()
    : `NPC Crew · ${quality.label} · Target: ${crewTarget} · Focus: 1–${state.crewDept}`)}
      ${poolRow("NPC Crew", crewDice, "crew")}
      ${isOfficerMode && crewDice.length > 0 ? (() => {
      const armed = state.activeRerollAbility;
      const btnBase = `width:100%;padding:5px 8px;border-radius:2px;font-size:9px;font-weight:700;
          letter-spacing:0.05em;font-family:${LC.font};text-transform:uppercase;cursor:pointer;
          transition:all 0.12s;text-align:left;`;
      const btnOff = `${btnBase}background:rgba(255,255,255,0.03);border:1px solid ${LC.borderDim};
          color:${LC.textDim};`;
      const btnOn = `${btnBase}background:rgba(150,100,255,0.12);border:1px solid ${LC.secondary};
          color:${LC.secondary};`;
      const mkTalent = (ability, label, hasIt, usedIt) => (hasIt && !usedIt)
        ? `<button class="reroll-arm-btn" data-ability="${ability}"
              style="${armed === ability ? btnOn : btnOff}">
              ${armed === ability ? "▶ " : ""}${label} — click a die
             </button>`
        : "";
      const mkDet = (ability, label, usedIt) => usedIt ? ""
        : `<button class="reroll-arm-btn" data-ability="${ability}"
              style="${armed === ability ? btnOn : btnOff}">
              ${armed === ability ? "▶ " : ""}${label}
             </button>`;
      const buttons = [
        mkTalent("talent", state.talentRerollSource ?? "Bold / Cautious",
          state.hasTalentReroll, state.talentRerollUsed),
        mkTalent("advisor", state.advisorRerollSource ?? "Advisor",
          state.hasAdvisorReroll, state.advisorRerollUsed),
        mkTalent("system", state.systemRerollSource ?? "System Talent",
          state.hasSystemReroll, state.systemRerollUsed),
        mkTalent("shipTalent", state.shipTalentRerollSource ?? "Ship Talent",
          state.hasShipTalentReroll, state.shipTalentRerollUsed),
        mkDet("detReroll", "Spend Determination — Reroll Dice", state.detRerollUsed),
        // Generic reroll — always available once per roll for any talent/trait not listed above
        mkTalent("genericReroll", "Talent / Trait Reroll", true, state.genericRerollUsed),
      ].filter(Boolean).join("");
      if (!buttons) return "";
      return `
        <div style="padding:4px 10px 6px;border-top:1px solid ${LC.borderDim};">
          <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
            letter-spacing:0.08em;margin-bottom:5px;font-family:${LC.font};">
            Available Rerolls
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            ${buttons}
          </div>
          ${armed === "detReroll" && !state.detRerollUsed ? `
          <div id="det-reroll-panel" style="padding:6px 0 0;">
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
              ${crewDice.map((d, i) => {
        const fsize = d.value >= 10 ? "9px" : "11px";
        const txtColor = d.crit ? LC.primary : d.success ? LC.green : d.complication ? LC.red : "#aaa";
        return `<label style="display:inline-flex;align-items:center;gap:3px;cursor:pointer;
                  padding:2px 5px;border:1px solid ${LC.borderDim};border-radius:2px;">
                  <input type="checkbox" class="det-die-cb" value="${i}"
                    style="accent-color:${LC.secondary};" />
                  <span style="font-size:${fsize};font-weight:700;color:${txtColor};">
                    ${d.value}${d.crit ? "★★" : ""}
                  </span></label>`;
      }).join("")}
            </div>
            <button id="det-reroll-btn" disabled
              style="width:100%;padding:4px 8px;
                background:rgba(150,100,255,0.06);border:1px solid ${LC.secondary};
                border-radius:2px;color:${LC.secondary};font-size:9px;font-weight:700;
                letter-spacing:0.05em;font-family:${LC.font};text-transform:uppercase;
                opacity:0.4;cursor:default;transition:all 0.12s;">
              🔄 Reroll Selected (0)
            </button>
          </div>` : ""}
        </div>`;
    })() : ""}
      ${tsNote}
      ${csNote}
      ${aimNote}
      ${assistRow}
      ${(state.namedAssistDice?.length > 0) ? `
      <div style="padding:4px 10px 6px;border-top:1px solid ${LC.borderDim};">
        <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
          letter-spacing:0.08em;margin-bottom:4px;font-family:${LC.font};">
          🤝 Named Assist Dice${state.hasChiefOfStaff && state.assistRerollsUsed.some(u => !u)
        ? ` · <span style="color:${LC.secondary};">${state.chiefOfStaffSource ?? "Chief of Staff"} — click to reroll</span>`
        : ""}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">
          ${state.namedAssistDice.map((d, i) => {
          const hint = (state.hasChiefOfStaff && !state.assistRerollsUsed[i])
            ? `🧑‍⚕️ ${state.chiefOfStaffSource ?? "Chief of Staff"} — free reroll`
            : null;
          return diePipHtml(d, i, "named-assist", hint);
        }).join("")}
        </div>
      </div>` : ""}
      ${apAssistRow}

      ${state.crewFailed
      ? `<div style="
            margin:6px 10px;padding:8px 10px;
            background:rgba(180,0,0,0.1);
            border:1px solid ${LC.red};border-left:3px solid ${LC.red};
            border-radius:2px;
            font-size:10px;color:${LC.red};
            font-family:${LC.font};letter-spacing:0.08em;text-transform:uppercase;">
            ✗ NPC Crew scored 0 successes — assist die and ship pool did not roll
          </div>
          ${sectionHeader(`NPC Ship · ${_systemLabel(state.shipSystemKey)}/${_deptLabel(state.shipDeptKey)} · Target: ${shipTarget} · Focus: 1–${state.shipDept}`)}`
      : `${sectionHeader(`NPC Ship · ${_systemLabel(state.shipSystemKey)}/${_deptLabel(state.shipDeptKey)} · Target: ${shipTarget} · Focus: 1–${state.shipDept}`)}
           ${!state.shipAssist
        ? `<div style="padding:6px 10px;font-size:9px;color:${LC.textDim};
                 font-family:${LC.font};letter-spacing:0.08em;text-transform:uppercase;">
                 Ship did not assist this roll
               </div>`
        : `${poolRow("NPC Ship", shipDice, "ship")}
                ${rfNote}
                ${cwNote}
                ${state.reservePower
          ? `<div style="font-size:9px;color:${LC.secondary};padding:2px 10px 4px;font-family:${LC.font};">
                      ⚡ Reserve Power — assist die set to 1 · ship complications count double
                    </div>`
          : ""}
                ${state.advancedSensorsActive
          ? `<div style="font-size:9px;color:${LC.green};padding:2px 10px 4px;font-family:${LC.font};">
                      ★ Advanced Sensor Suites — 2 ship dice rolled
                    </div>`
          : ""}`}`}

      ${state.hasTechExpertise && !state.techExpertiseUsed
      && (state.shipSystemKey === "computers" || state.shipSystemKey === "sensors")
      && (crewDice.length > 0 || shipDice.length > 0) ? `
      <div id="te-reroll-panel" style="padding:4px 10px 8px;border-top:1px solid ${LC.borderDim};">
        <div style="font-size:9px;color:${LC.secondary};font-family:${LC.font};
          text-transform:uppercase;letter-spacing:0.08em;margin-bottom:5px;">
          💡 ${state.techExpertiseSource ?? "Technical Expertise"} — select one die to reroll
        </div>
        <div style="font-size:8px;color:${LC.textDim};font-family:${LC.font};margin-bottom:5px;">
          Choose one die from either pool — crew or ship
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
          ${[...crewDice.map((d, i) => ({ d, i, pool: "crew" })),
    ...shipDice.map((d, i) => ({ d, i, pool: "ship" }))].map(({ d, i, pool }) => {
      const fsize = d.value >= 10 ? "9px" : "11px";
      const txtC = d.crit ? LC.primary : d.success ? LC.green : d.complication ? LC.red : "#aaa";
      return `
            <label style="display:inline-flex;align-items:center;gap:3px;cursor:pointer;
              padding:2px 5px;border:1px solid ${LC.borderDim};border-radius:2px;">
              <input type="radio" name="te-die-choice" class="te-die-rb"
                value="${pool}:${i}" style="accent-color:${LC.secondary};" />
              <span style="font-size:${fsize};font-weight:700;color:${txtC};">
                ${pool === "ship" ? "🚀" : ""}${d.value}${d.crit ? "★★" : ""}
              </span>
            </label>`;
    }).join("")}
        </div>
        <button id="te-reroll-btn" disabled
          style="width:100%;padding:4px 8px;
            background:rgba(0,200,255,0.06);border:1px solid ${LC.secondary};
            border-radius:2px;color:${LC.secondary};
            font-size:9px;font-weight:700;letter-spacing:0.05em;font-family:${LC.font};
            text-transform:uppercase;opacity:0.4;cursor:default;transition:all 0.12s;">
          🔄 Reroll Selected Die
        </button>
      </div>` : ""}

      ${resultSummaryHtml([...crewDice, ...(crewAssistDice ?? []), ...(state.namedAssistDice ?? []), ...apAssistDice], shipDice, difficulty, crewTarget, shipTarget, state.reservePower)}

    </div>`;
}

// ── Chat card ─────────────────────────────────────────────────────────────────

function buildChatCard(actorName, state) {
  const { crewDice, shipDice, difficulty, crewAttr, crewDept, shipSystems, shipDept, crewQuality,
    officer, officerAttrKey, officerDiscKey,
    stationId,
    assistOfficers, namedAssistDice, apAssistDice, crewAssistDice,
    apAttrKey, apDiscKey, helmOfficer, hasActorAtHelm, helmActorName,
    sheetMode, availableShips, selectedShipIdx,
    complicationRange, shipSystemKey, shipDeptKey, noPoolButton } = state;
  const quality = CREW_QUALITIES.find(q => q.key === crewQuality) ?? CREW_QUALITIES[0];
  const isOfficerMode = !!officer;
  const stationLabel = STATION_LABELS[stationId] ?? null;
  const crewTarget = crewAttr + crewDept;
  // Ship name from inline selector (sheetMode) or blank when using direct ship actor
  const _selectedShip = (availableShips?.length > 0 && selectedShipIdx >= 0)
    ? availableShips[selectedShipIdx] : null;
  const shipLabel = _selectedShip?.label ?? null;
  // Complication threshold display: range=1 → "20", range=2 → "19–20", etc.
  const _compRange = complicationRange ?? 1;
  const compRangeDisplay = _compRange <= 1 ? "20" : `${21 - _compRange}–20`;
  const shipTarget = shipSystems + shipDept;
  const assistDice = [...(state.crewAssistDice ?? []), ...(state.namedAssistDice ?? []), ...(state.apAssistDice ?? [])];
  const crewFailed = state.crewFailed ?? false;
  const total = countSuccesses(crewDice) + countSuccesses(assistDice) + countSuccesses(shipDice);
  const compls = countComplicationsTotal(crewDice, assistDice, shipDice, crewFailed ? false : state.reservePower);
  const passed = total >= difficulty;
  const momentum = Math.max(0, total - difficulty);
  const passColor = passed ? LC.green : LC.red;
  const passText = passed ? "✓ SUCCESS" : "✗ FAILURE";

  const diceRow = (dice, target) => `
    <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:2px;">
      ${dice.map(d => {
    const isSuccessComplication = !!d.success && !!d.complication && !d.crit;
    const txtColor = d.crit ? LC.primary
      : isSuccessComplication ? LC.red
        : d.success ? LC.green
          : d.complication ? LC.red
            : "#aaaaaa";
    const tip = `${d.value}${d.crit ? " (CRIT)" : d.success ? " (success)" : ""}${d.complication ? " (COMPLICATION)" : ""}`;
    const lbl = d.crit
      ? `<span style="display:flex;flex-direction:column;align-items:center;line-height:1;gap:0;">
              <span style="font-size:7px;letter-spacing:-1px;color:${txtColor};">★★</span>
              <span style="font-size:11px;">${d.value}</span>
             </span>`
      : isSuccessComplication
        ? `<span style="display:flex;flex-direction:column;align-items:center;line-height:1;gap:0;">
                 <span style="font-size:8px;letter-spacing:-1px;color:${LC.green};">*</span>
                 <span style="font-size:11px;">${d.value}</span>
               </span>`
        : `<span style="font-size:11px;">${d.value}</span>`;
    return `
          <span title="${tip}" style="
            position:relative;display:inline-flex;align-items:center;justify-content:center;
            width:32px;height:32px;vertical-align:middle;">
            <img src="icons/svg/d20-grey.svg"
              style="position:absolute;top:0;left:0;width:32px;height:32px;
                opacity:0.2;pointer-events:none;" alt="" />
            <span style="position:relative;z-index:1;color:${txtColor};
              font-weight:700;font-family:${LC.font};
              text-shadow:0 1px 2px rgba(0,0,0,0.9);pointer-events:none;">
              ${lbl}
            </span>
          </span>`;
  }).join("")}
    </div>`;

  return `
    <div style="background:${LC.bg};border:1px solid ${LC.border};
      border-radius:3px;overflow:hidden;font-family:${LC.font};">
      <div style="background:${LC.primary};color:${LC.bg};
        font-size:9px;font-weight:700;letter-spacing:0.15em;
        text-transform:uppercase;padding:3px 10px;">
        ${state.taskLabel ? `${state.taskLabel} — ` : sheetMode ? "Task Roll — " : "NPC Task Roll — "}${actorName}
      </div>
      ${state.taskContext ? `
      <div style="padding:2px 10px 4px;background:rgba(255,153,0,0.06);
        border-bottom:1px solid ${LC.borderDim};
        font-size:9px;color:${LC.textDim};font-family:${LC.font};
        letter-spacing:0.06em;text-transform:uppercase;">
        ${state.taskContext}
      </div>` : ""}

      <div style="padding:6px 10px;">
        ${stationLabel ? `
        <div style="font-size:8px;color:${LC.primary};font-family:${LC.font};
          letter-spacing:0.12em;text-transform:uppercase;font-weight:700;margin-bottom:2px;">
          ${stationLabel}
        </div>` : ""}
        <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
          letter-spacing:0.08em;margin-bottom:3px;">
          ${isOfficerMode
      ? `${officer.name} · ${ATTR_LABELS[officerAttrKey] ?? officerAttrKey}+${DISC_LABELS[officerDiscKey] ?? officerDiscKey} (target: ${crewTarget})`
      : `Crew · ${quality.label} (target: ${crewTarget})`}
        </div>
        <div>${diceRow(crewDice, crewTarget)}</div>
        ${(() => {
      const rerollNotes = [
        state.determinationAutoUsed ? "Determination (auto-1)" : null,
        state.detRerollUsed ? "Determination (reroll)" : null,
        state.talentRerollUsed ? (state.talentRerollSource ?? "Talent Reroll") : null,
        state.advisorRerollUsed ? (state.advisorRerollSource ?? "Advisor") : null,
        state.systemRerollUsed ? (state.systemRerollSource ?? "System Talent Reroll") : null,
        state.techExpertiseUsed ? (state.techExpertiseSource ?? "Technical Expertise") : null,
        state.proceduralUsed ? "Procedural Compliance (auto-success)" : null,
        state.hasAutoSuccessTrade ? "Auto-Success Trade (−1 die, +1 success)" : null,
        state.hasChiefOfStaff ? (state.chiefOfStaffSource ?? "Chief of Staff") : null,
        state.shipTalentRerollUsed ? (state.shipTalentRerollSource ?? "Ship Talent Reroll") : null,
        state.hasPiercingSalvo ? "Piercing Salvo (spend 2 Momentum)" : null,
        state.multiTaskingActive ? "Multi-Tasking (Conn)" : null,
      ].filter(Boolean).join(" · ");
      return rerollNotes
        ? `<div style="font-size:8px;color:${LC.secondary};font-family:${LC.font};
                letter-spacing:0.06em;margin-top:2px;padding-top:2px;
                border-top:1px solid ${LC.borderDim};">
                ✦ ${rerollNotes}
               </div>`
        : "";
    })()}
      </div>

      ${(assistOfficers ?? []).map((ao, idx) => {
      const die = (namedAssistDice ?? [])[idx];
      if (!die) return "";
      const aoAttrVal = ao.stats ? (ao.stats.attributes[ao.attrKey] ?? null) : null;
      const aoDiscVal = ao.stats ? (ao.stats.disciplines[ao.discKey] ?? null) : null;
      const aoTarget = (aoAttrVal !== null && aoDiscVal !== null) ? aoAttrVal + aoDiscVal : crewTarget;
      return `
      <div style="padding:4px 10px 6px;border-top:1px solid ${LC.borderDim};">
        <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
          letter-spacing:0.08em;margin-bottom:3px;">
          ${ao.type === "direct" ? "🎖️" : "🤝"} ${ao.name} (${ao.type === "direct" ? "Direct" : "Assisting"})${ao.stats
          ? ` · ${ATTR_LABELS[ao.attrKey] ?? ao.attrKey}+${DISC_LABELS[ao.discKey] ?? ao.discKey} (target: ${aoTarget})`
          : ""}
        </div>
        <div>${diceRow([die], aoTarget)}</div>
      </div>`;
    }).join("")}

      ${(apAssistDice ?? []).length > 0 ? (() => {
      const apAttrVal = helmOfficer ? (helmOfficer.attributes?.[apAttrKey] ?? null) : null;
      const apDiscVal = helmOfficer ? (helmOfficer.disciplines?.[apDiscKey] ?? null) : null;
      const apTarget = (apAttrVal !== null && apDiscVal !== null) ? apAttrVal + apDiscVal : crewTarget;
      const apDisplayName = helmOfficer?.name ?? (hasActorAtHelm ? helmActorName : null);
      return `
      <div style="padding:4px 10px 6px;border-top:1px solid ${LC.borderDim};">
        <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
          letter-spacing:0.08em;margin-bottom:3px;">
          ⚡ ${apDisplayName ? `${apDisplayName} — ` : ""}Helm Assist (Attack Pattern)${helmOfficer
          ? ` · ${ATTR_LABELS[apAttrKey] ?? apAttrKey}+${DISC_LABELS[apDiscKey] ?? apDiscKey} (target: ${apTarget})`
          : hasActorAtHelm
            ? ` · ${ATTR_LABELS[apAttrKey] ?? apAttrKey}+${DISC_LABELS[apDiscKey] ?? apDiscKey} (target: ${apTarget})`
            : ` (crew quality, target: ${apTarget})`}
        </div>
        <div>${diceRow(apAssistDice, apTarget)}</div>
      </div>`;
    })() : ""}

      ${(crewAssistDice ?? []).length > 0 ? `
      <div style="padding:4px 10px 6px;border-top:1px solid ${LC.borderDim};">
        <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
          letter-spacing:0.08em;margin-bottom:3px;">
          🤝 Crew Assist (target: ${crewTarget})
        </div>
        <div>${diceRow(crewAssistDice, crewTarget)}</div>
      </div>` : ""}

      <div style="padding:6px 10px;border-top:1px solid ${LC.borderDim};">
        <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
          letter-spacing:0.08em;margin-bottom:3px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <span>${shipLabel ? `${shipLabel} — ` : ""}Ship${shipSystemKey && shipDeptKey ? ` · ${_systemLabel(shipSystemKey)}+${_deptLabel(shipDeptKey)}` : ""} (target: ${shipTarget})</span>
          ${state.hasAdvancedSensors && state.advancedSensorsActive ? `<span style="color:${LC.green};font-size:8px;">★ Advanced Sensor Suites</span>` : ""}
          ${state.reservePower ? `<span style="color:${LC.secondary};font-size:8px;">⚡ Reserve Power</span>` : ""}
        </div>
        ${crewFailed
      ? `<div style="font-size:9px;color:${LC.red};letter-spacing:0.06em;padding:2px 0;">
              Crew scored 0 successes — ship did not roll
            </div>`
      : !state.shipAssist
        ? `<div style="font-size:9px;color:${LC.textDim};letter-spacing:0.06em;padding:2px 0;">
                Ship did not assist this roll
              </div>`
        : `<div>${diceRow(shipDice, shipTarget)}</div>`}
      </div>

      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;
        padding:6px 10px;border-top:1px solid ${LC.borderDim};">
        ${[
      ["Successes", total, LC.tertiary],
      ["Difficulty", difficulty, LC.text],
      [state.playerMode ? "Momentum" : "Threat", momentum, momentum > 0 ? LC.secondary : LC.textDim],
      ["Complic.", compls, compls > 0 ? LC.red : LC.textDim],
      ["Comp. Range", compRangeDisplay, _compRange > 1 ? LC.red : LC.textDim],
    ].map(([lbl, val, col]) => `
          <div style="text-align:center;">
            <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;
              letter-spacing:0.08em;">${lbl}</div>
            <div style="font-size:${typeof val === "string" ? "11" : "16"}px;font-weight:700;color:${col};">${val}</div>
          </div>`).join("")}
      </div>

      <div style="text-align:center;padding:5px 10px;
        border-top:1px solid ${LC.borderDim};
        font-size:12px;font-weight:700;letter-spacing:0.12em;
        color:${passColor};text-transform:uppercase;">
        ${passText}
        ${momentum > 0 ? `<span style="font-size:9px;color:${LC.secondary};font-weight:400;
          margin-left:6px;">+${momentum} Threat</span>` : ""}
        ${compls > 0 ? `<span style="font-size:9px;color:${LC.red};font-weight:400;
          margin-left:6px;">${compls} Complication${compls > 1 ? "s" : ""}!</span>` : ""}
      </div>
      ${momentum > 0 && !noPoolButton ? `
      <div style="padding:4px 8px 6px;border-top:1px solid ${LC.borderDim};">
        <button class="sta2e-add-to-pool"
          data-pool="threat"
          data-amount="${momentum}"
          data-token-id=""
          style="width:100%;padding:5px 8px;background:rgba(0,0,0,0.25);
            border:1px solid ${LC.primary};border-radius:2px;cursor:pointer;
            font-family:${LC.font};font-size:10px;font-weight:700;
            color:${LC.primary};letter-spacing:0.06em;text-align:center;">
          ⚡ +${momentum} Threat → Pool
        </button>
      </div>` : ""}
    </div>`;
}

/**
 * Build the interactive LCARS "Working Results" chat card for player-ship rolls.
 * All interactive buttons carry the full rollData in data-payload so each click
 * posts a new self-contained card (stateless chain-card pattern).
 *
 * @param {object} rollData - Serialisable roll state (from _postPlayerRollToChat).
 * @returns {string} HTML string.
 */
export function buildPlayerRollCardHtml(rollData) {
  const {
    taskLabel, taskContext: rawTaskContext, officerName: rawOfficerName, difficulty,
    crewDice, shipDice, crewAssistDice, apAssistDice, namedAssistDice,
    crewFailed, shipTarget,
    pendingAssists,
    hasTalentReroll, talentRerollUsed, talentRerollSource,
    hasAdvisorReroll, advisorRerollUsed, advisorRerollSource,
    hasSystemReroll, systemRerollUsed, systemRerollSource,
    hasShipTalentReroll, shipTalentRerollUsed, shipTalentRerollSource,
    detRerollUsed, genericRerollUsed,
    hasTargetingSolution, tsChoice, tsRerollUsed,
    hasCalibratesensors, csRerollUsed,
    aimRerolls, aimRerollsUsed,
    weaponContext, groundMode, groundIsNpc, noPoolButton,
    officerAttrKey, officerDiscKey, crewTarget,
    complicationRange, shipName, shipSystemKey, shipDeptKey,
    hasAdvancedSensors, advancedSensorsActive, sheetMode,
    hasTechExpertise, techExpertiseUsed, techExpertiseSource,
    isAssistRoll, assistOfficerName, assistApplied, playerMode,
    confirmed, confirmedSuccesses, confirmedMomentum, confirmedPassed,
  } = rollData;

  const compRangeDisplay = (complicationRange ?? 1) <= 1 ? "20" : `${21 - (complicationRange ?? 1)}–20`;

  const allAssistDice = [...(crewAssistDice ?? []), ...(namedAssistDice ?? []), ...(apAssistDice ?? [])];
  const totalSuccesses = (dice => dice.reduce((s, d) => s + (d.success ? (d.crit ? 2 : 1) : 0), 0))(
    [...(crewDice ?? []), ...allAssistDice, ...(shipDice ?? [])]
  );
  const contextLeftLabel = rawTaskContext || rawOfficerName || "";
  const contextRightLabel = `Comp Range ${compRangeDisplay}`;
  const taskContext = null;
  const officerName = (contextLeftLabel || contextRightLabel)
    ? `<span style="display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;">
         <span style="text-align:left;min-width:0;color:${LC.textDim};">${contextLeftLabel}</span>
         <span style="text-align:right;white-space:nowrap;flex-shrink:0;color:${LC.textDim};">${contextRightLabel}</span>
       </span>`
    : null;
  const displaySuccesses = confirmed ? (confirmedSuccesses ?? totalSuccesses) : totalSuccesses;
  const displayMomentum = confirmed ? (confirmedMomentum ?? Math.max(0, totalSuccesses - (difficulty ?? 0))) : Math.max(0, totalSuccesses - (difficulty ?? 0));
  const passed = confirmed ? !!confirmedPassed : (totalSuccesses >= (difficulty ?? 0));
  const passColor = passed ? LC.green : LC.red;
  const finalResultLabel = passed ? "Success" : "Failed";
  const poolLabel = groundIsNpc ? "Threat" : "Momentum";
  const poolColor = displayMomentum > 0 ? LC.secondary : LC.textDim;
  const totalComplications = [...(crewDice ?? []), ...allAssistDice, ...(shipDice ?? [])]
    .filter(d => d.complication).length;
  const completedPoolButton = confirmed && displayMomentum > 0 && !noPoolButton
    ? `<button class="sta2e-add-to-pool"
        data-pool="${groundIsNpc ? "threat" : "momentum"}"
        data-amount="${displayMomentum}"
        data-token-id="${rollData.tokenId ?? ""}"
        style="width:100%;padding:7px 10px;background:rgba(0,0,0,0.25);
          border:2px solid ${LC.secondary};border-radius:2px;cursor:pointer;
          font-family:${LC.font};font-size:11px;font-weight:700;
          color:${LC.secondary};letter-spacing:0.06em;text-align:center;">
        ${groundIsNpc ? "Add Threat to Pool" : "Add Momentum to Pool"} (+${displayMomentum})
      </button>`
    : "";

  // Inline dice-row renderer (matches buildChatCard style)
  const diceRow = dice => {
    if (!dice || dice.length === 0) return `<span style="font-size:9px;color:${LC.textDim};">—</span>`;
    return `<div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center;">
      ${dice.map(d => {
      const isSuccessComplication = !!d.success && !!d.complication && !d.crit;
      const txtColor = d.crit ? LC.primary : isSuccessComplication ? LC.red : d.success ? LC.green : d.complication ? LC.red : "#aaaaaa";
      const lbl = d.crit
        ? `<span style="display:flex;flex-direction:column;align-items:center;line-height:1;gap:0;">
               <span style="font-size:7px;letter-spacing:-1px;color:${txtColor};">★★</span>
               <span style="font-size:11px;">${d.value}</span>
             </span>`
        : isSuccessComplication
          ? `<span style="display:flex;flex-direction:column;align-items:center;line-height:1;gap:0;">
                 <span style="font-size:8px;letter-spacing:-1px;color:${LC.green};">*</span>
                 <span style="font-size:11px;">${d.value}</span>
               </span>`
          : `<span style="font-size:11px;">${d.value}</span>`;
      return `<span style="position:relative;display:inline-flex;align-items:center;
            justify-content:center;width:32px;height:32px;vertical-align:middle;">
          <img src="icons/svg/d20-grey.svg"
            style="position:absolute;top:0;left:0;width:32px;height:32px;opacity:0.2;pointer-events:none;" alt=""/>
          <span style="position:relative;z-index:1;color:${txtColor};font-weight:700;
            font-family:${LC.font};text-shadow:0 1px 2px rgba(0,0,0,0.9);pointer-events:none;">
            ${lbl}
          </span>
        </span>`;
    }).join("")}
    </div>`;
  };

  const p = encodeURIComponent(JSON.stringify(rollData));
  // Include the edit action in stored card HTML so the GM sees it even when a
  // player created or rerolled the card. Non-GM clients remove it at render time.
  const canGmEditCard = !confirmed && !isAssistRoll;

  // Determine if Bold/Cautious reroll is valid:
  // Bold (Disc)    — requires at least 1 Threat added to the GM pool during this roll.
  // Cautious (Disc) — requires at least 1 Momentum spent during this roll.
  // When interactive payment is off we fall back to always-valid (no way to verify resource).
  const interactiveActive = game.settings.get("sta2e-toolkit", "interactiveDicePayment");
  const _spent = rollData.paymentSpent ?? {};
  const _talentName = (talentRerollSource ?? "").toLowerCase();
  const _isBold     = _talentName.includes("bold");
  const _isCautious = _talentName.includes("cautious");
  // Bold needs threat added; Cautious needs momentum spent; unknown talent accepts either.
  const spentResources = _isBold
    ? (_spent.threat ?? 0) > 0
    : _isCautious
      ? (_spent.momentum ?? 0) > 0
      : ((_spent.momentum ?? 0) > 0 || (_spent.threat ?? 0) > 0 || (_spent.personalThreat ?? 0) > 0);
  const talentRerollValid = hasTalentReroll && (!interactiveActive || spentResources);

  // Reroll abilities that still have charges
  const rerollButtons = [
    talentRerollValid && !talentRerollUsed ? { ability: "talent", label: talentRerollSource ?? "Bold / Cautious", labelShort: "Reroll a Die" } : null,
    hasAdvisorReroll && !advisorRerollUsed ? { ability: "advisor", label: advisorRerollSource ?? "Advisor", labelShort: "Reroll a Die" } : null,
    hasSystemReroll && !systemRerollUsed ? { ability: "system", label: systemRerollSource ?? "System Talent", labelShort: "Reroll a Die" } : null,
    hasShipTalentReroll && !shipTalentRerollUsed ? { ability: "shipTalent", label: shipTalentRerollSource ?? "Ship Talent", labelShort: "Reroll a Die" } : null,
    !detRerollUsed ? { ability: "detReroll", label: "Spend Determination", labelShort: "Reroll Dice" } : null,
    hasTargetingSolution && tsChoice !== "system" && !tsRerollUsed
      ? { ability: "ts", label: "Targeting Solution", labelShort: "Reroll a Die" } : null,
    hasCalibratesensors && !csRerollUsed ? { ability: "cs", label: "Calibrate Sensors", labelShort: "Reroll a Die" } : null,
    hasTechExpertise && !techExpertiseUsed
      && (shipSystemKey === "computers" || shipSystemKey === "sensors")
      ? { ability: "techExpertise", label: techExpertiseSource ?? "Technical Expertise", labelShort: "Reroll a Die (Crew or Ship)" } : null,
    (aimRerolls ?? 0) > (aimRerollsUsed ?? 0) ? { ability: "aim", label: `Aim (${(aimRerolls ?? 0) - (aimRerollsUsed ?? 0)} remaining)`, labelShort: "Reroll a Die" } : null,
    !genericRerollUsed ? { ability: "genericReroll", label: "Talent / Trait Reroll", labelShort: "Reroll a Die" } : null,
  ].filter(Boolean);

  // Confirm / resolve button label
  const confirmLabel = weaponContext
    ? `${totalSuccesses >= (difficulty ?? 0) ? "⚡ Resolve HIT" : "✗ Resolve MISS"} (${totalSuccesses} succ.)`
    : `✓ Confirm Results (${totalSuccesses} success${totalSuccesses !== 1 ? "es" : ""})`;

  return `
<div style="background:${LC.bg};border:1px solid ${LC.border};border-radius:3px;overflow:hidden;font-family:${LC.font};">
  <div style="background:${confirmed ? passColor : (isAssistRoll ? LC.secondary : LC.primary)};color:${LC.bg};font-size:9px;font-weight:700;
    letter-spacing:0.15em;text-transform:uppercase;padding:3px 10px;">
    ${isAssistRoll
      ? `🤝 ASSIST ROLL — ${assistOfficerName ?? officerName ?? "Officer"}`
      : confirmed
        ? `📋 ${taskLabel || "Task Roll"} — ${finalResultLabel}`
        : `📋 ${taskLabel || "Task Roll"} — Working Results`}
  </div>
  ${(contextLeftLabel || contextRightLabel) ? `
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:2px 10px 4px;background:rgba(255,153,0,0.06);
    border-bottom:1px solid ${LC.borderDim};font-size:9px;color:transparent;
    font-family:${LC.font};letter-spacing:0.06em;text-transform:uppercase;">
    ${[officerName, taskContext].filter(Boolean).join(" · ")}
  </div>` : ""}

  <div style="padding:6px 10px;">
    ${false ? `<div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
          Crew scored 0 successes — no assists, no ship die rolled
        </div>`
      : !groundMode ? `<div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
          letter-spacing:0.08em;margin-bottom:3px;text-align:center;">${(isAssistRoll && !playerMode && !groundMode && shipSystemKey && shipDeptKey)
          ? `${_systemLabel(shipSystemKey)} + ${_deptLabel(shipDeptKey)}${crewTarget != null ? ` (target: ${crewTarget})` : ""}`
          : (officerAttrKey && officerDiscKey)
            ? `${ATTR_LABELS[officerAttrKey] ?? officerAttrKey} + ${DISC_LABELS[officerDiscKey] ?? officerDiscKey}${crewTarget != null ? ` (target: ${crewTarget})` : ""}`
            : `Crew Dice${crewTarget != null ? ` (target: ${crewTarget})` : ""}`
        }</div>` : ""}
    ${diceRow(crewDice ?? [])}
  </div>

  ${!crewFailed && (namedAssistDice ?? []).length > 0 ? (namedAssistDice).map(d => `
  <div style="padding:4px 10px 6px;border-top:1px solid ${LC.borderDim};">
    <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
      letter-spacing:0.08em;margin-bottom:3px;text-align:center;">
      🤝 ${d.officerName ?? "Assist"} — Assist Die
    </div>
    ${(d.shipSystemKey && d.shipDeptKey) || (d.attrKey && d.discKey) ? `
    <div style="font-size:8px;color:${LC.textDim};letter-spacing:0.06em;margin-bottom:3px;text-align:center;">
      ${[
        d.shipName ?? null,
        (d.shipSystemKey && d.shipDeptKey)
          ? `${_systemLabel(d.shipSystemKey)} + ${_deptLabel(d.shipDeptKey)}`
          : (d.attrKey && d.discKey)
            ? `${ATTR_LABELS[d.attrKey] ?? d.attrKey} + ${DISC_LABELS[d.discKey] ?? d.discKey}`
            : null,
      ].filter(Boolean).join(" · ")}
    </div>` : ""}
    ${diceRow([d])}
  </div>`).join("") : ""}

  ${!crewFailed && (apAssistDice ?? []).length > 0 ? `
  <div style="padding:4px 10px 6px;border-top:1px solid ${LC.borderDim};">
    <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
      letter-spacing:0.08em;margin-bottom:3px;text-align:center;">⚡ Helm — Attack Pattern</div>
    ${diceRow(apAssistDice)}
  </div>` : ""}

  ${!crewFailed && (shipDice ?? []).length > 0 ? `
  <div style="padding:4px 10px 6px;border-top:1px solid ${LC.borderDim};">
    <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
      letter-spacing:0.08em;margin-bottom:3px;text-align:center;">${[
        shipName ?? null,
        (shipSystemKey && shipDeptKey)
          ? `${_systemLabel(shipSystemKey)} + ${_deptLabel(shipDeptKey)}`
          : "Ship",
        `(target: ${shipTarget ?? "—"})`,
      ].filter(Boolean).join(" · ")
      }</div>
    ${advancedSensorsActive ? `<div style="font-size:8px;color:${LC.secondary};letter-spacing:0.06em;margin-bottom:3px;text-align:center;">★ Advanced Sensor Suites</div>` : ""}
    ${diceRow(shipDice)}
  </div>` : ""}

  ${!isAssistRoll ? `<div style="display:grid;grid-template-columns:repeat(${totalComplications > 0 ? 5 : 4},1fr);gap:4px;
    padding:6px 10px;border-top:1px solid ${LC.borderDim};">
    ${[
        ["Successes", displaySuccesses, LC.tertiary],
        ["Difficulty", difficulty ?? 0, LC.text],
        [poolLabel, displayMomentum, poolColor],
        ...(totalComplications > 0 ? [["Complic.", totalComplications, LC.red]] : []),
        ["Result", confirmed ? finalResultLabel : (passed ? "PASS" : "FAIL"), passColor],
      ].map(([lbl, val, col]) => `
      <div style="text-align:center;">
        <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.08em;">${lbl}</div>
        <div style="font-size:${lbl === "Result" ? "11px" : "16px"};font-weight:700;color:${col};">${val}</div>
      </div>`).join("")}
  </div>` : ""}

  ${interactiveActive && ((_spent.momentum ?? 0) > 0 || (_spent.threat ?? 0) > 0 || (_spent.personalThreat ?? 0) > 0) ? `
  <div style="padding:4px 10px 5px;border-top:1px solid ${LC.borderDim};">
    <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;
      letter-spacing:0.08em;margin-bottom:3px;">Resources Spent</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      ${(_spent.momentum ?? 0) > 0 ? `<span style="font-size:9px;color:${LC.tertiary};font-weight:700;">${_spent.momentum} Momentum</span>` : ""}
      ${(_spent.threat ?? 0) > 0 ? `<span style="font-size:9px;color:${LC.red};font-weight:700;">${_spent.threat} Threat</span>` : ""}
      ${(_spent.personalThreat ?? 0) > 0 ? `<span style="font-size:9px;color:${LC.secondary};font-weight:700;">${_spent.personalThreat} Personal Threat</span>` : ""}
    </div>
  </div>` : ""}

  ${!confirmed && !crewFailed && (pendingAssists ?? []).length > 0 ? `
  <div class="sta2e-working-actions sta2e-working-actions--assists"
    style="padding:5px 10px;border-top:1px solid ${LC.borderDim};">
    <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;
      letter-spacing:0.08em;margin-bottom:4px;">Pending Assists</div>
    <div style="display:flex;flex-direction:column;gap:3px;">
      ${(pendingAssists).map((ao, i) => `
      <button class="sta2e-player-assist-roll"
        data-payload="${p}"
        data-assist-index="${i}"
        style="width:100%;padding:5px 8px;background:rgba(255,153,0,0.10);
          border:1px solid ${LC.primary};border-radius:2px;cursor:pointer;
          font-family:${LC.font};font-size:10px;font-weight:700;
          color:${LC.primary};letter-spacing:0.04em;text-align:left;">
        🎲 Roll Assist Die — ${ao.type === "direct" ? "🎖️ " : "🤝 "}${ao.name}
      </button>`).join("")}
    </div>
  </div>` : ""}

  ${!confirmed && !isAssistRoll && rerollButtons.length > 0 ? `
  <div class="sta2e-working-actions sta2e-working-actions--rerolls"
    style="padding:5px 10px;border-top:1px solid ${LC.borderDim};">
    <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;
      letter-spacing:0.08em;margin-bottom:4px;">Rerolls Available</div>
    <div style="display:flex;flex-direction:column;gap:3px;">
      ${rerollButtons.map(rb => `
      <button class="sta2e-player-reroll"
        data-payload="${encodeURIComponent(JSON.stringify(rollData))}"
        data-ability="${rb.ability}"
        data-ability-label="${rb.label}"
        style="width:100%;padding:5px 8px;background:rgba(150,100,255,0.08);
          border:1px solid ${LC.secondary};border-radius:2px;cursor:pointer;
          font-family:${LC.font};font-size:10px;font-weight:700;
          color:${LC.secondary};letter-spacing:0.04em;text-align:left;">
        🔄 ${rb.label} — ${rb.labelShort}
      </button>`).join("")}
    </div>
  </div>` : ""}

  ${isAssistRoll ? `
  <div class="sta2e-working-actions sta2e-working-actions--assist-apply"
    style="padding:6px 10px;border-top:1px solid ${LC.borderDim};">
    ${assistApplied ? `
    <div style="padding:6px 8px;background:rgba(0,150,255,0.08);
      border:1px solid ${LC.secondary};border-radius:2px;
      font-family:${LC.font};font-size:10px;font-weight:700;
      color:${LC.secondary};letter-spacing:0.06em;text-align:center;">
      ✓ Applied to: ${assistApplied}
    </div>` : `
    <button class="sta2e-assist-to-roll"
      data-payload="${p}"
      style="width:100%;padding:7px 10px;background:rgba(0,150,255,0.10);
        border:2px solid ${LC.secondary};border-radius:2px;cursor:pointer;
        font-family:${LC.font};font-size:11px;font-weight:700;
        color:${LC.secondary};letter-spacing:0.06em;">
      ➕ Add to Task Roll →
    </button>`}
  </div>` : confirmed ? `
  <div class="sta2e-working-actions sta2e-working-actions--confirm"
    style="padding:6px 10px;border-top:1px solid ${LC.borderDim};">
    ${completedPoolButton || `
    <div style="width:100%;padding:7px 10px;
      background:${passed ? "rgba(0,200,100,0.12)" : "rgba(255,80,80,0.08)"};
      border:2px solid ${passColor};border-radius:2px;
      font-family:${LC.font};font-size:11px;font-weight:700;
      color:${passColor};letter-spacing:0.06em;text-align:center;">
      Completed
    </div>`}
  </div>` : `
  <div class="sta2e-working-actions sta2e-working-actions--confirm"
    style="padding:6px 10px;border-top:1px solid ${LC.borderDim};">
    ${canGmEditCard ? `
    <button class="sta2e-edit-roll-card"
      data-payload="${p}"
      style="width:100%;padding:5px 10px;margin-bottom:5px;
        background:rgba(255,153,0,0.08);
        border:1px solid ${LC.primary};border-radius:2px;cursor:pointer;
        font-family:${LC.font};font-size:10px;font-weight:700;
        color:${LC.primary};letter-spacing:0.06em;">
      Edit Results
    </button>` : ""}
    <button class="sta2e-player-confirm"
      data-payload="${p}"
      style="width:100%;padding:7px 10px;
        background:${passed ? "rgba(0,200,100,0.12)" : "rgba(255,80,80,0.08)"};
        border:2px solid ${passColor};border-radius:2px;cursor:pointer;
        font-family:${LC.font};font-size:11px;font-weight:700;
        color:${passColor};letter-spacing:0.06em;">
      ${confirmLabel}
    </button>
  </div>`}
</div>`;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Open the Adv. Dice Roller dialog for the given actor/token.
 *
 * @param {Actor}    actor             - The ship actor (or character actor when sheetMode)
 * @param {Token}    token             - The token (used for speaker)
 * @param {object}   opts
 * @param {boolean}  opts.hasTargetingSolution - Whether Targeting Solution is active
 * @param {object[]} opts.availableShips       - Serialized ship list for sheet-mode selector
 */
export async function openNpcRoller(actor, token, { hasTargetingSolution = false, hasRapidFireTorpedo = false, weaponContext = null, stationId = null, officer = null, opposedDifficulty = null, opposedDefenseType = null, defenderSuccesses = null, hasAttackPattern = false, helmOfficer = null, attackRunActive = false, rallyContext = false, taskLabel = null, taskContext = null, taskCallback = null, difficulty: startDifficulty = null, complicationRange: startComplicationRange = null, ignoreBreachPenalty = false, noShipAssist = false, shipSystemKey: overrideShipSysKey = null, shipDeptKey: overrideShipDeptKey = null, crewQuality: overrideCrewQuality = null, playerMode = false, groundMode = false, groundIsNpc = false, aimRerolls = 0, defaultAttr = null, defaultDisc = null, noPoolButton = false, sheetMode = false, availableShips = [], isAssistRoll = false, onAssignShips = null, combatTaskContext = null, shipAssist: initialShipAssist = null, selectedShipIdx: initialShipIdx = -1 } = {}) {

  // Read calibrate flags live from the token document
  const tokenDoc = token?.document ?? token;
  // For character-sheet rolls the token is the PC token, but the CS flag lives on the ship token.
  // combatTaskContext.sensorMinorStates.calibrateSensors is already read from the ship token in main.js,
  // so prefer that value; fall back to the token flag for non-context (ship-direct) rolls.
  const hasCalibratesensors = combatTaskContext?.sensorMinorStates?.calibrateSensors
    ?? tokenDoc?.getFlag(MODULE, "calibrateSensors")
    ?? false;
  const hasCalibrateWeapons = tokenDoc?.getFlag(MODULE, "calibrateWeapons") ?? false;

  // Read pre-declared Targeting Solution benefit from the token flag (set via HUD sub-buttons).
  // For the HUD path, tokenDoc is the ship token — pre-declared choice is already stored there.
  // For the character-sheet path, tokenDoc is the PC token which never carries the TS flag,
  // so this falls back to null and the benefit defaults to "reroll" as before.
  const _tsFlagRaw = hasTargetingSolution
    ? (tokenDoc?.getFlag(MODULE, "targetingSolution") ?? null) : null;
  const _tsFlagObj = _tsFlagRaw && typeof _tsFlagRaw === "object" && _tsFlagRaw.active
    ? _tsFlagRaw : null;
  const _tsInitChoice = _tsFlagObj?.benefit ?? (hasTargetingSolution ? "reroll" : null);
  const _tsInitSystem = _tsFlagObj?.system ?? null;

  // Read any pending crew assist declarations for this station.
  // New format: { [stationId]: [{ name, actorId }, ...] }
  // Legacy formats: { [stationId]: "name" } (string) or { [stationId]: { name, actorId } } (single object).
  // Multiple assisters can stack — e.g. Helm declares Attack Pattern assist for Tactical.
  const _assistPending = tokenDoc?.getFlag(MODULE, "assistPending") ?? {};
  const _rawAssist = stationId ? (_assistPending[stationId] ?? null) : null;
  // Normalise to array regardless of storage format
  const _assistArray = !_rawAssist ? []
    : Array.isArray(_rawAssist) ? _rawAssist
      : typeof _rawAssist === "string" ? [{ name: _rawAssist, actorId: null }]
        : [_rawAssist]; // legacy single-object

  // Resolve each assist entry.
  // An assist from the ship itself (actorId === actor.id) or with no actorId is NPC crew
  // assisting at crew quality — it should NOT be treated as a named officer (that would
  // run readOfficerStats on the ship actor and show ship stats in the attr/disc selects).
  const _resolvedAssists = _assistArray.map(a => {
    const isNpcCrew = !a.actorId || a.actorId === actor.id;
    const resolvedActor = isNpcCrew ? null : game.actors.get(a.actorId);
    const stats = resolvedActor ? readOfficerStats(resolvedActor) : null;
    return { name: a.name ?? "Unknown", actorId: a.actorId ?? null, stats, isNpcCrew, type: a.type ?? null };
  });

  // Named character assists — separate actors with their own dice + attr/disc display
  const _namedCharAssists = _resolvedAssists.filter(a => !a.isNpcCrew);
  // NPC crew assists — ship's own crew declaring assist; handled via crewAssist die
  const _npcCrewAssistCount = _resolvedAssists.filter(a => a.isNpcCrew).length;

  // Ground mode: read assistPending["ground"] from the rolling character's own token.
  // These are declared by other characters via the HUD Assist / Direct actions.
  const _groundAssistRaw = groundMode
    ? (tokenDoc?.getFlag(MODULE, "assistPending")?.["ground"] ?? null)
    : null;
  const _groundAssistArray = !_groundAssistRaw ? []
    : Array.isArray(_groundAssistRaw) ? _groundAssistRaw
      : [_groundAssistRaw];
  const _groundAssists = _groundAssistArray.map(a => {
    const resolvedActor = a.actorId ? game.actors.get(a.actorId) : null;
    const stats = resolvedActor ? readOfficerStats(resolvedActor) : null;
    return { name: a.name ?? "Unknown", actorId: a.actorId ?? null, stats, isNpcCrew: false, type: a.type ?? "assist" };
  });

  // Effective named assists: ground mode uses ground-declared assists; ship mode uses station assists
  const _effectiveNamedAssists = groundMode ? _groundAssists : _namedCharAssists;

  // Display name for the "✋ Assist declared by..." notification in the dialog
  const _allAssists = groundMode ? _groundAssists : _resolvedAssists;
  const pendingAssistName = _allAssists.length > 0
    ? _allAssists.map(a => a.name).join(", ")
    : null;

  // Helper: clear this station's assist flag once the task result is posted.
  // Guards on stationId only — pendingAssistName may be null for legacy string flags
  // but the key still needs to be removed.
  const _clearAssistFlag = async () => {
    if (!tokenDoc) return;
    try {
      if (groundMode) {
        // Clear the "ground" key from the rolling character's token
        const pending = tokenDoc.getFlag(MODULE, "assistPending") ?? {};
        if (!("ground" in pending)) return;
        await tokenDoc.update({ [`flags.${MODULE}.assistPending.-=ground`]: null });
        return;
      }
      if (!stationId) return;
      // Use Foundry's deletion-key syntax (`-=key`) in a raw update() call.
      // setFlag/unsetFlag route through mergeObject which *merges* nested objects
      // rather than replacing them — so a spread-delete-then-setFlag approach
      // silently leaves the deleted key intact, particularly on unlinked (wildcard)
      // tokens.  The -=key notation instructs mergeObject to actually remove the entry.
      const pending = tokenDoc.getFlag(MODULE, "assistPending") ?? {};
      if (!(stationId in pending)) return;   // nothing to clear
      await tokenDoc.update({ [`flags.${MODULE}.assistPending.-=${stationId}`]: null });
    } catch (e) {
      console.warn("STA2e Toolkit | Could not clear assist flag:", e);
    }
  };

  // Station's own officer — passed in from the caller (crew manifest lookup).
  // Assisting officers (from combat HUD assist command) are kept SEPARATE in
  // state.assistOfficers and shown in the assist section, never replacing the
  // crew quality block or the officer mode of the station's own officer.
  const officerStats = officer ?? null;

  // Detect whether an actor is assigned to this station even if readOfficerStats returned null
  // (e.g. actor lacks STA2e system.attributes/disciplines data). When true the actor provides
  // an ASSIST die (replacing the generic NPC crew assist) rather than overriding the main roll.
  // IMPORTANT: use getCrewManifest() — not actor.getFlag() directly — because for unlinked
  // tokens the manifest lives on the token document, not the world actor.
  const _crewManifest = getCrewManifest(actor);
  const _stationActorIds = stationId ? (_crewManifest[stationId] ?? []) : [];
  const _hasActorAtStation = officerStats === null && _stationActorIds.length > 0;

  // Similarly detect an actor assigned to the Helm station who lacks full STA2e stats.
  // Used exclusively for the Attack Pattern section — determines whether to show
  // attr/disc selects + focus checkboxes (actor present) or just roll NPC crew always-focus.
  const _helmActorIds = _crewManifest["helm"] ?? [];
  const _hasActorAtHelm = helmOfficer === null && _helmActorIds.length > 0;
  const _helmActorName = _hasActorAtHelm
    ? (game.actors.get(_helmActorIds[0])?.name ?? null)
    : null;

  // Station-aware default Attribute + Discipline for officer mode.
  // Each station has a canonical pair used for the most common tasks.
  const STATION_OFFICER_DEFAULTS = {
    command: { attr: "presence", disc: "command" },
    comms: { attr: "presence", disc: "command" },
    helm: { attr: "control", disc: "conn" },
    navigator: { attr: "reason", disc: "conn" },
    operations: { attr: "control", disc: "engineering" },
    sensors: { attr: "control", disc: "science" },
    tactical: { attr: "control", disc: "security" },
    medical: { attr: "control", disc: "medicine" },
  };
  const stationDefaults = STATION_OFFICER_DEFAULTS[stationId] ?? { attr: "presence", disc: "command" };
  // Station-officer defaults (attr/disc key pre-selection)
  const defaultOfficerAttr = defaultAttr ?? (officerStats
    ? (officerStats.attributes[stationDefaults.attr] !== null ? stationDefaults.attr
      : Object.keys(officerStats.attributes).find(k => officerStats.attributes[k] !== null) ?? "presence")
    : stationDefaults.attr);
  const defaultOfficerDisc = defaultDisc ?? (officerStats
    ? (officerStats.disciplines[stationDefaults.disc] !== null ? stationDefaults.disc
      : Object.keys(officerStats.disciplines).find(k => officerStats.disciplines[k] !== null) ?? "command")
    : stationDefaults.disc);

  // Build per-assisting-officer state objects.
  // Each named assisting officer adds their own d20 to the pool with a per-officer
  // crit threshold based on their discipline + focus flags.
  // All actors in the station's crew manifest slot (when officerStats is null) are
  // injected as assist entries — one die per actor — replacing the generic crew assist
  // checkbox. This handles multi-slot stations like Command (Captain + Executive Officer).
  const _stationAssistEntries = _hasActorAtStation
    ? _stationActorIds.map(actorId => ({
      name: game.actors.get(actorId)?.name ?? "Station Crew",
      actorId,
      stats: null,  // no STA2e data — rolls at crew quality target
      attrKey: stationDefaults.attr,
      discKey: stationDefaults.disc,
      hasFocus: false,
      hasDedicatedFocus: false,
    }))
    : [];

  const _assistOfficerStates = [
    ..._stationAssistEntries,
    ..._effectiveNamedAssists.map(a => {
      // Direct task always uses Control + Command regardless of station.
      // Standard assists pick the best matching attr/disc for this station.
      const isDirect = a.type === "direct";
      const aoDefaultAttr = isDirect ? "control"
        : a.stats
          ? (a.stats.attributes[stationDefaults.attr] !== null ? stationDefaults.attr
            : Object.keys(a.stats.attributes).find(k => a.stats.attributes[k] !== null) ?? stationDefaults.attr)
          : stationDefaults.attr;
      const aoDefaultDisc = isDirect ? "command"
        : a.stats
          ? (a.stats.disciplines[stationDefaults.disc] !== null ? stationDefaults.disc
            : Object.keys(a.stats.disciplines).find(k => a.stats.disciplines[k] !== null) ?? stationDefaults.disc)
          : stationDefaults.disc;
      return {
        name: a.name,
        actorId: a.actorId,
        stats: a.stats,   // null if actor not found / lacks STA2e data
        attrKey: aoDefaultAttr,
        discKey: aoDefaultDisc,
        type: a.type ?? null,   // "direct" | null — preserved for label display
        hasFocus: false,
        hasDedicatedFocus: false,
      };
    }),
  ];

  // Pull live system/dept maps from the actor
  const actorSystems = actor.system?.systems ?? {};
  const actorDepts = actor.system?.departments ?? {};
  // Mutable reference — swapped by the in-roller ship selector when sheetMode + availableShips
  const _shipDataRef = { systems: actorSystems, depts: actorDepts };

  // Default selections: weapons system, first dept key available
  const defaultSysKey = Object.keys(actorSystems)[0] in actorSystems
    ? (actorSystems.weapons ? "weapons" : Object.keys(actorSystems)[0])
    : "weapons";
  const defaultDeptKey = actorDepts.security ? "security"
    : (Object.keys(actorDepts)[0] ?? "security");

  // Detect Advanced Sensors talent — grants a bonus ship die but ONLY when
  // the Sensors system is selected. Also check Sensors breaches.
  const hasAdvancedSensors = actor.items.some(i =>
    i.name.toLowerCase().includes("advanced sensor suites") ||
    i.name.toLowerCase().includes("advanced sensors")
  );

  // Check if Sensors system has any breaches — Advanced Sensors can't be used if so
  const sensorsBreaches = actor.system?.systems?.sensors?.breaches ?? 0;

  // If opened from a weapon button, default to Weapons system + Security dept
  const weaponContextSysKey = weaponContext ? "weapons" : defaultSysKey;
  const weaponContextDeptKey = weaponContext ? (actorDepts.security ? "security" : defaultDeptKey) : defaultDeptKey;

  // Re-evaluate Advanced Sensors for the starting system
  const startIsSensors = weaponContextSysKey === "sensors";
  const advancedSensorsActive = hasAdvancedSensors && startIsSensors && sensorsBreaches === 0;

  // Breach penalty for the relevant system
  // Weapon attacks always use "weapons"; station tasks use STATION_TO_SYSTEM.
  const breachSystemKey = weaponContext
    ? "weapons"
    : (STATION_TO_SYSTEM[stationId] ?? null);
  const CombatHUDClass = game.sta2eToolkit?.CombatHUD;
  const breachPenalty = (!ignoreBreachPenalty && CombatHUDClass)
    ? CombatHUDClass.getSystemBreachPenalty(actor, breachSystemKey)
    : { breaches: 0, destroyThreshold: 0, difficultyPenalty: 0, isDestroyed: false, penaltyNote: null };

  // Reroll talent detection — only relevant in officer mode (officerStats != null)
  const _officerActorFull = officerStats ? game.actors.get(officerStats.id) : null;
  const _talentReroll = _officerActorFull
    ? detectTalentReroll(_officerActorFull, defaultOfficerDisc)
    : { hasReroll: false, source: null };
  const _advisorReroll = detectAdvisorReroll(_assistOfficerStates);
  const _sysReroll = _officerActorFull
    ? detectSystemRerollTalent(_officerActorFull, weaponContextSysKey)
    : { hasReroll: false, source: null };

  // Precision Targeting: weapon attack reroll — merges into _talentReroll (weapon context only)
  if (!_talentReroll.hasReroll && weaponContext && _officerActorFull) {
    const pt = _officerActorFull.items
      .find(i => i.name.toLowerCase().includes("precision targeting"));
    if (pt) { _talentReroll.hasReroll = true; _talentReroll.source = pt.name; }
  }

  // Batch-2 talent detections
  // Detect talent presence only — system eligibility (sensors/computers) is checked at
  // render time using the live state.shipSystemKey so the GM's dropdown is respected.
  const _techExpertise = _officerActorFull
    ? detectTechExpertise(_officerActorFull)
    : { hasReroll: false, source: null };
  const _hasProcedural = _officerActorFull
    ? detectProceduralCompliance(_officerActorFull, stationId, defaultOfficerDisc)
    : false;
  const _hasPiercingSalvo = _officerActorFull
    ? detectPiercingSalvo(_officerActorFull, weaponContext)
    : false;
  const _cosReroll = detectChiefOfStaff(_assistOfficerStates, stationId);
  const _hasFastTargeting = detectFastTargetingSystems(actor);   // ship actor
  const _shipTalentReroll = detectShipTalentCrewReroll(actor, stationId);   // DC-only ship talent
  const _hasMultiTasking = _officerActorFull
    ? detectMultiTasking(_officerActorFull)
    : false;

  // Mutable roller state — lives outside the dialog so button callbacks can mutate it
  const state = {
    actorName: actor.name,
    actorId: actor.id,
    // Interactive Extra Dice Payment
    paymentSlots: [null, null, null, null, null, null],
    hasFreeExtraDie: false,
    hasAutoSuccessTrade: false,
    easyFillValue: 0,
    npcThreatSource: "pool",
    groundNpcType: groundIsNpc ? (actor.system?.npcType ?? "minor") : null,

    // Crew
    crewNumDice: isAssistRoll && !playerMode && !groundMode ? 1 : 2,   // ship-sheet assist → 1 die
    crewQuality: overrideCrewQuality ?? "proficient",
    playerMode,           // true = player-ship task roll (no NPC crew concepts)
    groundMode,           // true = ground character roll — hides ship pool entirely
    groundIsNpc,          // true = ground NPC → generates Threat (not Momentum)
    noPoolButton,         // true = suppress pool button on this roll (defender defense rolls)
    // Crew assist die: pre-checked when NPC crew (ship itself) declared a pending assist.
    // Named character-actor assists are handled separately via assistOfficers/namedAssistDice
    // and must NOT also trigger crewAssist (that would double-count their dice).
    crewAssist: !_hasActorAtStation && _npcCrewAssistCount > 0,
    pendingAssistName: pendingAssistName,
    hasActorAtStation: _hasActorAtStation,  // used to hide generic crew-assist checkbox
    // Ship — always 1 die; Advanced Sensor Suites forces 2 when Sensors is selected
    shipNumDice: advancedSensorsActive ? 2 : 1,
    shipAssist: initialShipAssist !== null ? initialShipAssist : (!isAssistRoll && !groundMode && !rallyContext && !noShipAssist),
    hasAdvancedSensors,
    sensorsBreaches,
    advancedSensorsActive,
    reservePower: false,   // Reserve Power rerouted — assist die set to 1, complications count double
    // Officer focus / determination — only relevant in officer mode
    hasFocus: false,  // officer has a relevant focus → crit range = 1 to disc
    hasDedicatedFocus: false,  // dedicated focus talent → crit range = 1 to (disc × 2)
    hasDetermination: false,  // officer may spend Determination to force one die to 1 (pre-roll)
    determinationAutoUsed: false,  // set true in _doRoll after force-to-1 fires
    shipSystemKey: defaultSysKey,
    shipDeptKey: defaultDeptKey,
    // Task
    complicationRange: startComplicationRange ?? (() => {
      // Auto-expand if power strain injury exists on this system
      const sysStrain = breachPenalty?.complicationRangeIncrease ?? 0;
      // Also expand if dept strain injury exists for this discipline
      const CombatHUD = game.sta2eToolkit?.CombatHUD;
      const deptStrain = CombatHUD ? CombatHUD.getDeptStrainRange(actor, defaultOfficerDisc) : 0;
      return 1 + sysStrain + deptStrain;
    })(),
    opposedDifficulty,
    opposedDefenseType,
    defenderSuccesses,
    hasTargetingSolution,
    tsChoice: _tsInitChoice,   // "reroll" | "system" | null; read from pre-declared flag if set
    tsSystem: _tsInitSystem,   // chosen system key, or null = random
    tsRerollUsed: false,
    hasRapidFireTorpedo,
    rfRerollUsed: false,
    aimRerolls,             // 0 = none, 1 = Aim, 2 = Aim+Accurate
    aimRerollsUsed: 0,
    hasCalibratesensors,
    csRerollUsed: false,   // Calibrate Sensors reroll consumed
    hasCalibrateWeapons,
    cwBonusApplied: false,   // Calibrate Weapons +1 dmg consumed
    crewAttr: 9,
    crewDept: 2,
    shipSystemKey: overrideShipSysKey ?? weaponContextSysKey,
    shipDeptKey: overrideShipDeptKey ?? weaponContextDeptKey,
    shipSystems: actorSystems[overrideShipSysKey ?? weaponContextSysKey]?.value ?? 8,
    shipDept: actorDepts[overrideShipDeptKey ?? weaponContextDeptKey]?.value ?? 2,
    // Roll state
    phase: "setup",
    crewFailed: false,
    weaponContext,
    stationId,
    // Station's own named officer (from crew manifest). Never an assisting officer —
    // assisting officers are tracked separately in assistOfficers below.
    officer: officerStats,
    // Named assisting officers — one per pending assist declaration for this station.
    // Each adds their own d20 with a per-officer crit threshold.
    assistOfficers: _assistOfficerStates,
    namedAssistDice: [],    // populated by _doRoll
    // Attack Pattern — Helm officer (or crew) assists the attack roll using Control+Conn.
    // Three modes:
    //   helmOfficer != null            → named officer with full STA2e stats (selects + focus flags)
    //   hasActorAtHelm && !helmOfficer → actor at helm but no STA2e stats (selects + focus flags, crew target)
    //   !hasActorAtHelm                → pure NPC crew — always rolls with focus, no GM input needed
    hasAttackPattern,
    helmOfficer,          // readOfficerStats() result — null if no stats
    hasActorAtHelm: _hasActorAtHelm,  // actor at helm but no full STA2e stats
    helmActorName: _helmActorName,   // their name for display when hasActorAtHelm
    attackRunActive,      // true = Attack Run talent, Difficulty reduction suppressed
    apAttrKey: "control",
    apDiscKey: "conn",
    apHasFocus: false,
    apDedicatedFocus: false,
    apAssistDice: [],     // rolled AP assist dice
    rallyContext,         // true = Rally task — ship does not assist, post Threat card on result
    taskLabel,            // short label shown in dialog title + chat card header, e.g. "Rally"
    taskContext,          // optional longer description shown in chat card subheader
    taskCallback,         // optional fn({ successes, passed, state, actor, token }) called after post
    breachPenalty,        // { breaches, destroyThreshold, difficultyPenalty, isDestroyed, penaltyNote }
    // Apply breach difficulty penalty to starting difficulty
    // Priority: startDifficulty > opposedDifficulty > weapon type default (torpedo=3, energy=2)
    difficulty: (() => {
      const base = startDifficulty !== null ? startDifficulty
        : opposedDifficulty !== null ? opposedDifficulty
          : (weaponContext?.isTorpedo ? 3 : 2);
      if (!breachPenalty.isDestroyed && breachPenalty.difficultyPenalty > 0) {
        return base + breachPenalty.difficultyPenalty;
      }
      return base;
    })(),
    _isNpc: (() => {
      const CombatHUD = game.sta2eToolkit?.CombatHUD;
      return CombatHUD ? CombatHUD.isNpcShip(actor) : true;
    })(),
    officerAttrKey: defaultOfficerAttr,
    officerDiscKey: defaultOfficerDisc,
    sheetMode,        // true = opened from character sheet — attr/disc fixed, no selectors shown
    isAssistRoll: isAssistRoll,  // true = this roll assists another player's task
    availableShips,   // serialized ship list for sheet-mode ship selector
    onAssignShips,    // callback: opens assign dialog, returns updated ship list
    selectedShipIdx: initialShipIdx,   // restored from pending task or starts unselected
    combatTaskContext,     // { bridgeStations, taskParams, myStations, combatShip, shipWeapons, targetShips, preTargetId } | null
    selectedTaskKey: null,      // currently chosen task key from TASK_PARAMS
    selectedTargetId: combatTaskContext?.preTargetId ?? null,  // pre-populated from Foundry targeting
    _baseDifficulty: startDifficulty,  // snapshot for Override +1 calc
    crewDice: [],
    crewAssistDice: [],
    shipDice: [],
    // Token doc reference so flag cleanup works inside _wireDiePips
    _tokenDoc: token?.document ?? token,
    // Talent rerolls (officer mode only — populated by detection above)
    hasTalentReroll: _talentReroll.hasReroll,    // Bold / Cautious (Disc) — one free crew die reroll
    talentRerollSource: _talentReroll.source,       // e.g. "Bold (Command)"
    talentRerollUsed: false,
    hasAdvisorReroll: _advisorReroll.hasReroll,   // Advisor talent on command-assisting officer
    advisorRerollSource: _advisorReroll.source,      // e.g. "Advisor (Spock)"
    advisorRerollUsed: false,
    hasSystemReroll: _sysReroll.hasReroll,       // system-specific talent (framework, manual for now)
    systemRerollSource: _sysReroll.source,
    systemRerollUsed: false,
    // Determination — arm-button state (set post-roll by GM pressing a button)
    detRerollUsed: false,  // Determination multi-dice reroll consumed
    // Central arm state — which reroll ability button is currently "armed"
    // Values: null | "talent" | "advisor" | "system" | "shipTalent" | "detReroll"
    activeRerollAbility: null,
    // ── Batch-2 talent state ──────────────────────────────────────────────────
    // Technical Expertise — post-roll radio panel: choose one die (crew or ship)
    hasTechExpertise: _techExpertise.hasReroll,
    techExpertiseSource: _techExpertise.source,
    techExpertiseUsed: false,
    // Procedural Compliance — pre-roll: reduce pool by 1, inject auto-success die
    hasProcedural: _hasProcedural,
    proceduralUsed: false,
    // Piercing Salvo — note only (torpedo weapon context)
    hasPiercingSalvo: _hasPiercingSalvo,
    // Chief of Staff — assisting officer talent at Medical station
    hasChiefOfStaff: _cosReroll.hasReroll,
    chiefOfStaffSource: _cosReroll.source,
    assistRerollsUsed: [],   // populated in _doRoll: bool[] per namedAssistDice
    // Fast Targeting Systems — ship talent, enhances tsNote (no separate reroll)
    hasFastTargeting: _hasFastTargeting,
    // Ship talent crew die reroll — Improved Damage Control / Rugged Design (manual checkbox)
    hasShipTalentReroll: _shipTalentReroll.hasReroll,
    shipTalentRerollSource: _shipTalentReroll.source,
    shipTalentRerollUsed: false,
    // Multi-Tasking — Override task: use Conn disc + Conn dept instead of task default
    hasMultiTasking: _hasMultiTasking,
    multiTaskingActive: false,
    _taskDefaultDisc: null,   // stored when a task button is clicked, for revert on uncheck
    _taskDefaultShipDept: null,
    // Generic one-die reroll — always available for any talent/trait effect not covered above
    genericRerollUsed: false,
    // NPC ship mode: after rolling, post the interactive chat card (same as playerMode)
    // instead of keeping the DialogV2 open for rerolls. This lets the sta2e-player-confirm
    // handler fire correctly — which is required for the opposed task chain to work.
    // True for any NPC ship roll that is not already player/ground/assist mode.
    npcShipMode: !playerMode && !groundMode && !isAssistRoll,
  };

  // ── Player mode: post-roll chat card ──────────────────────────────────────────
  // Defined here (inside openNpcRoller) to capture the state/actor/token closure.
  const _postPlayerRollToChat = () => {
    const callbackId = foundry.utils.randomID();
    const rollOwnerUserId = game.user.id;
    const allowedUserIds = rollOwnerUserId ? [rollOwnerUserId] : [];
    if (state.taskCallback) {
      PlayerRollCallbacks.set(callbackId, {
        taskCallback: state.taskCallback,
        actor,
        token,
      });
    }

    const rollData = {
      callbackId,
      actorId: actor.id,
      tokenId: token?.id ?? null,
      actorName: actor.name,
      stationId: state.stationId,
      paymentSpent: state.paymentSpent ?? null,

      taskLabel: state.taskLabel ?? "",
      taskContext: state.taskContext ?? null,
      weaponContext: state.weaponContext
        ? {
          name: state.weaponContext.name,
          isTorpedo: !!state.weaponContext.isTorpedo,
          weaponId: state.weaponContext.weaponId ?? null,
          shipActorId: state.weaponContext.shipActorId ?? null,
          useStun: state.weaponContext.useStun ?? null,
          deadlyCostsThreat: state.weaponContext.deadlyCostsThreat ?? false,
        }
        : null,
      rallyContext: state.rallyContext ?? false,

      difficulty: state.difficulty,
      crewDice: state.crewDice,
      shipDice: state.shipDice ?? [],
      crewAssistDice: state.crewAssistDice ?? [],
      apAssistDice: state.apAssistDice ?? [],
      namedAssistDice: [],   // empty until officers roll via chat card buttons

      crewTarget: state.crewTarget,
      shipTarget: state.shipTarget,
      crewCritThresh: state.crewCritThresh,
      shipCritThresh: state.shipCritThresh,
      crewAttr: state.crewAttr,
      crewDept: state.crewDept,
      shipSystems: state.shipSystems,
      shipDept: state.shipDept,
      compThresh: state.compThresh ?? 20,
      // Assist rolls always show the die regardless of success — "crew failed" concept
      // doesn't apply when the whole point is to display the single rolled die.
      crewFailed: state.isAssistRoll ? false : (state.crewFailed ?? false),

      hasTalentReroll: state.hasTalentReroll ?? false,
      talentRerollUsed: state.talentRerollUsed ?? false,
      talentRerollSource: state.talentRerollSource ?? null,
      hasAdvisorReroll: state.hasAdvisorReroll ?? false,
      advisorRerollUsed: state.advisorRerollUsed ?? false,
      advisorRerollSource: state.advisorRerollSource ?? null,
      hasSystemReroll: state.hasSystemReroll ?? false,
      systemRerollUsed: state.systemRerollUsed ?? false,
      systemRerollSource: state.systemRerollSource ?? null,
      hasShipTalentReroll: state.hasShipTalentReroll ?? false,
      shipTalentRerollUsed: state.shipTalentRerollUsed ?? false,
      shipTalentRerollSource: state.shipTalentRerollSource ?? null,
      detRerollUsed: state.detRerollUsed ?? false,
      genericRerollUsed: state.genericRerollUsed ?? false,
      hasTargetingSolution: state.hasTargetingSolution ?? false,
      tsChoice: state.tsChoice ?? null,
      tsSystem: state.tsSystem ?? null,
      tsRerollUsed: state.tsRerollUsed ?? false,
      hasCalibratesensors: state.hasCalibratesensors ?? false,
      csRerollUsed: state.csRerollUsed ?? false,
      hasTechExpertise: state.hasTechExpertise ?? false,
      techExpertiseUsed: state.techExpertiseUsed ?? false,
      techExpertiseSource: state.techExpertiseSource ?? null,
      aimRerolls: state.aimRerolls ?? 0,
      aimRerollsUsed: state.aimRerollsUsed ?? 0,

      officerName: state.officer?.name ?? null,
      officerAttrKey: state.officerAttrKey ?? null,
      officerDiscKey: state.officerDiscKey ?? null,
      hasFocus: state.hasFocus ?? false,
      hasDedicatedFocus: state.hasDedicatedFocus ?? false,
      crewTarget: state.crewTarget,
      complicationRange: state.complicationRange ?? 1,
      shipName: (state.availableShips?.length > 0 && state.selectedShipIdx >= 0)
        ? (state.availableShips[state.selectedShipIdx]?.label ?? null)
        : null,
      shipAssist: state.shipAssist ?? false,
      shipSystemKey: state.shipSystemKey ?? null,
      shipDeptKey: state.shipDeptKey ?? null,
      hasAdvancedSensors: state.hasAdvancedSensors ?? false,
      advancedSensorsActive: state.advancedSensorsActive ?? false,
      reservePower: state.reservePower ?? false,
      sheetMode: state.sheetMode ?? false,
      availableShips: state.availableShips ?? [],
      selectedShipIdx: state.selectedShipIdx ?? -1,
      playerMode: state.playerMode ?? false,
      isAssistRoll: state.isAssistRoll ?? false,
      assistOfficerName: state.isAssistRoll ? (state.officer?.name ?? actor.name) : null,
      assistApplied: null,

      // Pending assist officers (not yet rolled)
      pendingAssists: (state.assistOfficers ?? []).map(ao => ({
        name: ao.name,
        actorId: ao.actorId ?? null,
        attrKey: ao.attrKey,
        discKey: ao.discKey,
        type: ao.type ?? null,
        hasFocus: ao.hasFocus,
        hasDedicatedFocus: ao.hasDedicatedFocus,
        // Pre-compute target values so handler doesn't need live actor lookups
        attrVal: ao.stats ? (ao.stats.attributes[ao.attrKey] ?? 9) : 9,
        discVal: ao.stats ? (ao.stats.disciplines[ao.discKey] ?? 2) : 2,
      })),

      hasRapidFireTorpedo: state.hasRapidFireTorpedo ?? false,
      hasCalibrateWeapons: state.hasCalibrateWeapons ?? false,
      defenderSuccesses: state.defenderSuccesses ?? null,
      opposedDefenseType: state.opposedDefenseType ?? null,
      groundMode: state.groundMode ?? false,
      groundIsNpc: state.groundIsNpc ?? false,
      noPoolButton: state.noPoolButton ?? false,
    };

    ChatMessage.create({
      content: buildPlayerRollCardHtml(rollData),
      speaker: ChatMessage.getSpeaker({ token }),
      flags: {
        "sta2e-toolkit": {
          playerRollCard: !rollData.isAssistRoll,  // only main task cards are picker targets
          assistCard: rollData.isAssistRoll,
          rollOwnerUserId,
          allowedUserIds,
          rollData,        // stored for clean retrieval without HTML parsing
        },
      },
    });
  };

  // ── Render setup dialog ──────────────────────────────────────────────────────
  let dialog;

  const openDialog = async () => {
    // Player mode, NPC ship mode, ground character, OR ship-sheet assist:
    // post an interactive chat card immediately after rolling and close the dialog.
    // npcShipMode is included so the sta2e-player-confirm handler fires on the chat
    // card — required for the opposed task chain (defender roll → attacker roller)
    // to work correctly for all attacker/defender combinations.
    if ((state.playerMode || state.npcShipMode || state.groundMode || state.isAssistRoll) && state.phase === "rolled") {
      _postPlayerRollToChat();
      if (dialog) { try { dialog.close({ force: true }); } catch { } }
      return;
    }

    if (dialog) {
      try { dialog.close(); } catch { }
    }

    const isRolled = state.phase === "rolled";

    dialog = new foundry.applications.api.DialogV2({
      window: {
        title: state.weaponContext
          ? `${actor.name} — ${state.weaponContext.name}`
          : state.taskLabel
            ? `${actor.name} — ${state.taskLabel}`
            : `Adv. Dice Roller — ${actor.name}`, resizable: false
      },
      content: buildDialogContent(state, actorSystems, actorDepts, actor),
      buttons: isRolled
        ? [
          ...(state.weaponContext ? [{
            action: "resolve",
            label: `${countSuccesses([...state.crewDice, ...(state.crewAssistDice ?? []), ...(state.namedAssistDice ?? []), ...(state.apAssistDice ?? []), ...state.shipDice]) >= state.difficulty ? "⚡ Resolve HIT" : "✗ Resolve MISS"}`,
            icon: "fas fa-crosshairs",
            default: true,
            callback: async () => {
              const totalSuccesses = countSuccesses([
                ...state.crewDice,
                ...(state.crewAssistDice ?? []),
                ...state.shipDice,
              ]);
              const isHit = totalSuccesses >= state.difficulty;

              // Find the weapon item.
              // Sheet-roller path: weaponId + shipActorId are stored on weaponContext.
              // HUD roller path: weapon is on actor (which IS the ship actor).
              const _weaponSrcActor = state.weaponContext.shipActorId
                ? game.actors.get(state.weaponContext.shipActorId)
                : actor;
              const weapon = state.weaponContext.weaponId
                ? _weaponSrcActor?.items.get(state.weaponContext.weaponId)
                : _weaponSrcActor?.items.find(i =>
                  i.name === state.weaponContext.name && i.type === "starshipweapon2e"
                );
              if (!weapon) {
                ui.notifications.warn(`Could not find weapon "${state.weaponContext.name}".`);
                return;
              }

              // Post the roller summary to chat first
              ChatMessage.create({
                content: buildChatCard(actor.name, state),
                speaker: ChatMessage.getSpeaker({ token }),
              });

              // Clear any pending assist flag for this station (same as the non-weapon path)
              (async () => { await _clearAssistFlag(); })();

              // Then run the full ship attack resolution flow
              const CombatHUD = game.sta2eToolkit?.CombatHUD;
              if (!CombatHUD) { ui.notifications.warn("CombatHUD not available."); return; }

              // Calibrate Weapons: +1 damage on this attack, then consume the flag
              const calibrateWeaponsBonus = state.hasCalibrateWeapons && !state.cwBonusApplied ? 1 : 0;
              if (calibrateWeaponsBonus) {
                state.cwBonusApplied = true;
                const tokenDoc = state._tokenDoc;
                if (tokenDoc) tokenDoc.unsetFlag("sta2e-toolkit", "calibrateWeapons").catch(() => { });
              }

              // Compute attacker's total successes for opposed task delta
              const attackerTotalSuccesses = countSuccesses([
                ...state.crewDice,
                ...(state.crewAssistDice ?? []),
                ...(state.namedAssistDice ?? []),
                ...(state.apAssistDice ?? []),
                ...state.shipDice,
              ]);

              // Sheet-roller path: use the ship token, not the character token
              const resolveToken = state.weaponContext.shipActorId
                ? canvas.tokens?.placeables.find(t => t.actor?.id === state.weaponContext.shipActorId) ?? token
                : token;

              if (!resolveToken) {
                ui.notifications.warn("Could not find ship token — attack resolution cancelled.");
                return;
              }

              // Sync Targeting Solution benefit choice to token flag so resolveShipAttack
              // can read the pre-declared choice without a post-roll dialog.
              if (state.hasTargetingSolution && state.tsChoice) {
                const _tsBenefit = state.hasFastTargeting ? "both" : state.tsChoice;
                await CombatHUD.setTargetingSolution(resolveToken, {
                  active: true,
                  benefit: _tsBenefit,
                  system: state.tsSystem ?? null,
                });
              }

              await CombatHUD.resolveShipAttack(resolveToken, weapon, isHit, {
                rapidFireBonus: state.hasRapidFireTorpedo && state.weaponContext.isTorpedo ? 1 : 0,
                calibrateWeaponsBonus,
                defenderSuccesses: state.defenderSuccesses,
                opposedDefenseType: state.opposedDefenseType,
                attackerSuccesses: state.opposedDefenseType !== null ? attackerTotalSuccesses : null,
              });

              // Attack Pattern stays active after the attack — it persists until the
              // helm officer's next turn per STA2e rules, allowing multiple attacks to
              // use it in the same round. The GM clears it via the Combat HUD status row.
            },
          }] : [{
            action: state.taskCallback ? "post-resolve" : "post",
            label: state.rallyContext ? "💫 Post Rally Result" : state.taskCallback ? `✓ Post & Resolve` : "Post to Chat",
            icon: state.taskCallback ? "fas fa-check-circle" : "fas fa-comments",
            default: true,
            callback: () => {
              // Always post the roller summary card
              ChatMessage.create({
                content: buildChatCard(actor.name, state),
                speaker: ChatMessage.getSpeaker({ token }),
              });

              // Clear any pending assist flag for this station now that the task is posted
              (async () => { await _clearAssistFlag(); })();

              // Fire taskCallback if provided — passes full context so the
              // caller can resolve success/failure without a second dialog
              if (state.taskCallback) {
                const allDice = [...state.crewDice, ...(state.crewAssistDice ?? []), ...(state.namedAssistDice ?? []), ...(state.apAssistDice ?? []), ...state.shipDice];
                const successes = countSuccesses(allDice);
                const passed = successes >= state.difficulty;
                const momentum = Math.max(0, successes - state.difficulty);
                // Use async IIFE so async callbacks are awaited and errors caught
                (async () => {
                  try {
                    await state.taskCallback({ successes, passed, momentum, state, actor, token });
                  } catch (err) {
                    console.error("STA2e Toolkit | taskCallback error:", err);
                    ui.notifications?.error("STA2e Toolkit: Task result error — see console.");
                  }
                })();
              }

              // Rally: immediately follow with a Threat/Momentum result card
              if (state.rallyContext) {
                const allDice = [...state.crewDice, ...(state.crewAssistDice ?? [])];
                const successes = countSuccesses(allDice);
                const isNpc = state._isNpc ?? true;
                const currency = isNpc ? "Threat" : "Momentum";
                const icon = isNpc ? "⚡" : "💫";
                const { LC } = game.sta2eToolkit ?? {};
                const font = LC?.font ?? "var(--font-primary)";
                const primary = LC?.primary ?? "#ff9900";
                const tertiary = LC?.tertiary ?? "#ffcc66";
                const textDim = LC?.textDim ?? "#888";

                ChatMessage.create({
                  content: `
                      <div style="border:2px solid ${primary};border-radius:3px;
                        background:rgba(255,153,0,0.06);padding:8px 10px;
                        font-family:${font};">
                        <div style="font-size:9px;font-weight:700;color:${primary};
                          letter-spacing:0.1em;text-transform:uppercase;margin-bottom:5px;">
                          ${icon} RALLY — ${currency.toUpperCase()} GENERATED
                        </div>
                        <div style="font-size:12px;font-weight:700;color:${tertiary};
                          margin-bottom:6px;">${actor.name}</div>
                        <div style="font-size:32px;font-weight:700;color:${primary};
                          text-align:center;padding:4px 0;font-family:${font};">
                          +${successes}
                        </div>
                        <div style="font-size:11px;color:${textDim};text-align:center;">
                          ${currency}${successes !== 1 ? "" : ""} · Presence + Command · Difficulty 0
                        </div>
                      </div>`,
                  speaker: ChatMessage.getSpeaker({ token }),
                });
              }
            },
          }]),
          {
            action: "post",
            label: state.taskCallback ? "📋 Post Dice Only" : "Post Results",
            icon: "fas fa-comments",
            default: false,
            callback: () => {
              ChatMessage.create({
                content: buildChatCard(actor.name, state),
                speaker: ChatMessage.getSpeaker({ token }),
              });
              // Clear any pending assist flag for this station now that the task is posted
              (async () => { await _clearAssistFlag(); })();
            },
          },
          {
            action: "reroll-all",
            label: "Re-roll All 🚨",
            icon: "fas fa-dice",
            callback: () => {
              // Re-roll all main + ship dice (assist dice are never rerolled)
              // Post a public shaming message to chat first
              const quip = "Your GM has committed an act of skullduggery and invoked the dice gods to force them to do the GM's bidding!";
              ChatMessage.create({
                content: `
                    <div style="background:#1a0000;border:2px solid #ff3333;border-radius:4px;
                      padding:8px 12px;font-family:'Arial Narrow',sans-serif;">
                      <div style="color:#ff3333;font-size:11px;font-weight:700;
                        letter-spacing:0.15em;text-transform:uppercase;margin-bottom:4px;">
                        🚨 GM CHEATING DETECTED 🚨
                      </div>
                      <div style="color:#ffcc88;font-size:12px;">
                        ${quip}
                      </div>
                    </div>`,
                speaker: ChatMessage.getSpeaker({ token }),
              });
              const speaker = ChatMessage.getSpeaker({ token });
              (async () => { await _doRoll(state, speaker); openDialog(); })();
            },
          },
          {
            action: "back",
            label: "← Setup",
            icon: "fas fa-arrow-left",
            callback: () => {
              state.phase = "setup";
              openDialog();
            },
          },
        ]
        : [
          {
            action: "roll",
            label: state.breachPenalty?.isDestroyed ? "⛔ System Destroyed" : "🎲 Roll",
            icon: "fas fa-dice-d20",
            default: !state.breachPenalty?.isDestroyed,
            callback: (event, btn, dlg) => {
              if (state.breachPenalty?.isDestroyed) {
                ui.notifications.warn(`STA2e Toolkit: ${state.breachPenalty.label} is destroyed — this task cannot be attempted.`);
                return;
              }
              const speaker = ChatMessage.getSpeaker({ token });
              _readSetupInputs(state, dlg.element ?? dlg, _shipDataRef.systems, _shipDataRef.depts);
              (async () => { await _doRoll(state, speaker); openDialog(); })();
            },
          },
          {
            action: "cancel",
            label: "Cancel",
            icon: "fas fa-times",
          },
        ],
    });

    await dialog.render(true);

    if (isRolled) {
      // Wire die reroll clicks — TS/CS for crew dice, Rapid-Fire for ship dice, talent/det for officer
      // TS reroll die-click only applies when benefit is "reroll" or "both" (not "system")
      const _tsIsReroll = state.tsChoice !== "system";
      const anyPipReroll = (state.hasTargetingSolution && _tsIsReroll && !state.tsRerollUsed)
        || (state.hasRapidFireTorpedo && !state.rfRerollUsed)
        || (state.hasCalibratesensors && !state.csRerollUsed)
        || (state.hasTechExpertise && !state.techExpertiseUsed)
        || (state.hasChiefOfStaff && state.assistRerollsUsed.some(u => !u));
      const isOfficerMode = !!state.officer;
      if (anyPipReroll || isOfficerMode || state.activeRerollAbility !== null) {
        _wireDiePips(state, dialog, openDialog);
      }
    } else {
      _wireSetupInputs(dialog, actorSystems, actorDepts, state, _shipDataRef, openDialog, token, actor);
    }
  };

  // Return a Promise that resolves when the roller dialog is fully closed.
  // Uses a persistent closeDialogV2 hook that tracks whichever dialog
  // instance is current (re-rolls create new instances).
  return new Promise(resolve => {
    let hookId = null;
    hookId = Hooks.on("closeDialogV2", (closedApp) => {
      // Only resolve when the current roller dialog closes, not some other dialog
      if (closedApp === dialog) {
        Hooks.off("closeDialogV2", hookId);
        resolve();
      }
    });
    openDialog();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Display label helpers ─────────────────────────────────────────────────────

const SYSTEM_LABELS = {
  communications: "Communications",
  computers: "Computers",
  engines: "Engines",
  sensors: "Sensors",
  structure: "Structure",
  weapons: "Weapons",
};

const DEPT_LABELS = {
  command: "Command",
  conn: "Conn",
  security: "Security",
  engineering: "Engineering",
  science: "Science",
  medicine: "Medicine",
};

function _systemLabel(key) {
  return SYSTEM_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

// Maps station IDs to their primary ship system for breach penalty lookup.
// A task at a station that uses a breached system gets +1 Difficulty per breach,
// and an auto-fail if the system is destroyed.
const STATION_TO_SYSTEM = {
  command: "computers",    // Command uses Computers for most bridge tasks
  comms: "communications",
  helm: "engines",
  navigator: "engines",
  operations: "computers",
  sensors: "sensors",
  tactical: "weapons",
  medical: null,           // Medical has no primary ship system dependency
};

function _deptLabel(key) {
  return DEPT_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

// ---------------------------------------------------------------------------
// Post the defense chat card and store pendingOpposedTask in world settings
// for a side-panel weapon attack where an opposing defense is already known.
// Called from the Roll button callback when state._opposedTaskPending is set.
// The chat card is posted via checkOpposedTaskForTokens (same as the HUD path)
// so that the defender sees the "Roll Defense" button in chat.
// ---------------------------------------------------------------------------
async function checkOpposedTaskForTokens_postCard(defMode, state, token, actor) {
  // Resolve target token for the chat card
  let targetToken = null;
  if (state.selectedTargetId) {
    targetToken = canvas.tokens?.placeables
      .find(t => t.actor?.id === state.selectedTargetId) ?? null;
  }
  if (!targetToken) {
    targetToken = Array.from(game.user.targets ?? [])[0] ?? null;
  }
  if (!targetToken) return; // nowhere to send the card

  // Re-use the standalone function exposed on the toolkit API to post the card.
  // It returns { proceed: "pending", defMode } when the card is posted.
  // token may be a TokenDocument or null; checkOpposedTaskForTokens only uses
  // it for the pending-task write (handled below), so pass null safely here.
  const checkFn = game.sta2eToolkit?.checkOpposedTaskForTokens;
  if (checkFn) {
    await checkFn(state.weaponContext?.name ?? "", token ?? null, [targetToken]);
  }

  const defLabel = defMode === "evasive-action" ? "Evasive Action"
    : defMode === "defensive-fire" ? "Defensive Fire" : "Cover";

  // token may be a TokenDocument, a canvas Token, or null (actor not on scene).
  // Normalise to an id string for the pending task; fall back to actor id.
  const _tokenId  = token?.id ?? token?.document?.id ?? actor?.id ?? "unknown";
  const _actorId  = actor?.id ?? state.actorId ?? "unknown";

  await game.settings.set("sta2e-toolkit", "pendingOpposedTask", {
    taskId:          `${_tokenId}-${Date.now()}`,
    attackerUserId:  game.userId,
    attackerTokenId: _tokenId,
    attackerActorId: _actorId,
    isNpcAttacker:   state._isNpc ?? false,
    defMode,
    weaponName:      state.weaponContext?.name ?? "",
    rollerOpts: {
      // Weapon & combat flags
      weaponContext:        state.weaponContext,
      hasTargetingSolution: state.hasTargetingSolution ?? false,
      hasRapidFireTorpedo:  state.hasRapidFireTorpedo  ?? false,
      hasAttackPattern:     state.hasAttackPattern      ?? false,
      helmOfficer:          state.helmOfficer            ?? null,
      attackRunActive:      state.attackRunActive        ?? false,
      taskLabel:            state.taskLabel ?? `Attack — ${state.weaponContext?.name ?? "Weapon"}`,
      taskContext:          `Opposed — ${defLabel}`,
      // Character-sheet roller identity — required so the reopened roller
      // knows it is a player-character sheet roll with the correct officer,
      // attribute/discipline, ship list, and side-panel context.
      playerMode:           state.playerMode    ?? false,
      sheetMode:            state.sheetMode      ?? false,
      groundMode:           state.groundMode     ?? false,
      officer:              state.officer        ?? null,
      defaultAttr:          state.officerAttrKey  ?? null,
      defaultDisc:          state.officerDiscKey  ?? null,
      availableShips:       state.availableShips  ?? [],
      // Ship-assist selections — preserve which ship, system, and dept the
      // player had chosen so the reopened roller restores them exactly.
      shipAssist:           state.shipAssist      ?? false,
      selectedShipIdx:      state.selectedShipIdx ?? -1,
      shipSystemKey:        state.shipSystemKey   ?? null,
      shipDeptKey:          state.shipDeptKey     ?? null,
      // taskCallback and onAssignShips are functions and cannot survive JSON
      // serialisation into world settings — omit them.  The reopened roller
      // is always a weapon-attack roll, so taskCallback is not needed, and
      // the player can reassign ships after the opposed task resolves.
      combatTaskContext:    state.combatTaskContext,
    },
  });
}

function _readSetupInputs(state, el, actorSystems, actorDepts) {
  const vi = (id, fallback) => {
    const v = parseInt(el.querySelector(`#${id}`)?.value ?? fallback);
    return isNaN(v) ? fallback : v;
  };
  const vs = (id, fallback) => el.querySelector(`#${id}`)?.value ?? fallback;

  // Crew
  state.crewNumDice = vi("crew-num-dice", state.crewNumDice);
  // Quality is set via HUD and passed in as crewQuality param — not editable in roller

  // Ship
  state.shipAssist = el.querySelector("#ship-assist")?.checked ?? state.shipAssist;
  state.shipSystemKey = vs("ship-system-key", state.shipSystemKey);
  state.shipDeptKey = vs("ship-dept-key", state.shipDeptKey);
  state.shipSystems = actorSystems[state.shipSystemKey]?.value ?? state.shipSystems;
  state.shipDept = actorDepts[state.shipDeptKey]?.value ?? state.shipDept;

  // Re-evaluate Advanced Sensors activation based on current system selection
  const isSensors = state.shipSystemKey === "sensors";
  state.advancedSensorsActive = state.hasAdvancedSensors && isSensors && state.sensorsBreaches === 0;

  // Ship dice count is not user-controlled — always 1, or 2 if Advanced Sensor Suites active
  state.shipNumDice = state.advancedSensorsActive ? 2 : 1;

  // Ship-sheet assist roll: crew die uses ship system + dept as target, not quality preset
  // Excludes ground NPCs — they use character attr/disc as the assist target
  if (state.isAssistRoll && !state.playerMode && !state.groundMode) {
    state.crewAttr = state.shipSystems;
    state.crewDept = state.shipDept;
    state.crewNumDice = state.advancedSensorsActive ? 2 : 1;
    state.shipAssist = false;   // ship IS the roller — no separate ship dice pool
  }

  // Reserve Power to Sensors (Advanced Sensors rule)
  state.reservePower = el.querySelector("#reserve-power")?.checked ?? false;

  // Task options — difficulty is locked when in opposed task mode (defender set it)
  if (!state.opposedDefenseType) {
    state.difficulty = Math.max(0, vi("difficulty", state.difficulty));
  }
  // When opposed, always restore from state.opposedDifficulty to prevent any drift
  if (state.opposedDefenseType && state.opposedDifficulty !== null) {
    state.difficulty = state.opposedDifficulty;
  }
  state.complicationRange = vi("complication-range", state.complicationRange);
  state.hasTargetingSolution = el.querySelector("#targeting-solution")?.checked
    ?? state.hasTargetingSolution;
  if (state.hasTargetingSolution) {
    const benefitRadio = el.querySelector("input[name='ts-benefit']:checked");
    if (benefitRadio) state.tsChoice = benefitRadio.value;
    if (state.tsChoice !== "system") state.tsSystem = null;
  } else {
    state.tsChoice = null;
    state.tsSystem = null;
  }
  state.hasCalibratesensors = el.querySelector("#calibrate-sensors")?.checked
    ?? state.hasCalibratesensors;
  state.hasCalibrateWeapons = el.querySelector("#calibrate-weapons")?.checked
    ?? state.hasCalibrateWeapons;
  state.crewAssist = el.querySelector("#crew-assist")?.checked
    ?? state.crewAssist;
  if ((state.sheetMode && state.playerMode) || (state.groundMode && state.groundIsNpc)) {
    state.isAssistRoll = el.querySelector("#is-assist-roll")?.checked ?? false;
    if (state.isAssistRoll) state.crewNumDice = 1;
  }

  // Attack Pattern: read Helm attr/disc and focus selections.
  // Attr/disc selects only exist when a named helm officer is assigned;
  // in crew-quality fallback mode only the focus/dedicated-forces checkboxes render.
  if (state.hasAttackPattern) {
    const apAttrSel = el.querySelector("#ap-attr");
    const apDiscSel = el.querySelector("#ap-disc");
    const apFocusCb = el.querySelector("#ap-has-focus");
    const apDedCb = el.querySelector("#ap-dedicated-forces");
    if (apAttrSel?.value) state.apAttrKey = apAttrSel.value;
    if (apDiscSel?.value) state.apDiscKey = apDiscSel.value;
    if (apFocusCb !== null) state.apHasFocus = apFocusCb.checked;
    if (apDedCb !== null) state.apDedicatedFocus = apDedCb.checked;
    if (state.apDedicatedFocus) state.apHasFocus = false;
  }

  // Read attr/disc key selections and focus flags — officer mode only
  if (state.officer) {
    const attrSel = el.querySelector("#officer-attr");
    const discSel = el.querySelector("#officer-disc");
    const focusCb = el.querySelector("#has-focus");
    const dedForceCb = el.querySelector("#has-dedicated-forces");
    const determCb = el.querySelector("#has-determination");
    if (attrSel?.value) state.officerAttrKey = attrSel.value;
    if (discSel?.value) state.officerDiscKey = discSel.value;
    if (focusCb !== null) state.hasFocus = focusCb.checked;
    if (dedForceCb !== null) state.hasDedicatedFocus = dedForceCb.checked;
    // Dedicated Focus overrides plain focus — can't have both
    if (state.hasDedicatedFocus) state.hasFocus = false;
    if (determCb !== null) state.hasDetermination = determCb.checked;
    state.crewAttr = state.officer.attributes[state.officerAttrKey] ?? state.crewAttr;
    state.crewDept = state.officer.disciplines[state.officerDiscKey] ?? state.crewDept;
  }

  // Per-assisting-officer attr/disc selection and focus flags
  (state.assistOfficers ?? []).forEach((ao, idx) => {
    const attrSel = el.querySelector(`#assist-${idx}-attr`);
    const discSel = el.querySelector(`#assist-${idx}-disc`);
    const focusCb = el.querySelector(`#assist-${idx}-focus`);
    const dedCb = el.querySelector(`#assist-${idx}-dedicated`);
    if (attrSel?.value) ao.attrKey = attrSel.value;
    if (discSel?.value) ao.discKey = discSel.value;
    if (dedCb !== null) ao.hasDedicatedFocus = dedCb.checked;
    if (focusCb !== null) ao.hasFocus = focusCb.checked;
    if (ao.hasDedicatedFocus) ao.hasFocus = false; // Dedicated Focus overrides focus
  });
}

function _validateInteractivePaymentThreshold(state) {
  if (!game.settings.get("sta2e-toolkit", "interactiveDicePayment") || state.isAssistRoll) {
    return { valid: true };
  }

  const filled = state.paymentSlots.filter(s => s !== null).length;
  const validThresholds = state.hasFreeExtraDie ? [0, 2, 5] : [0, 1, 3, 6];
  if (validThresholds.includes(filled)) return { valid: true };

  const previous = [...validThresholds].reverse().find(v => v < filled) ?? 0;
  const next = validThresholds.find(v => v > filled) ?? null;
  return {
    valid: false,
    filled,
    previous,
    next,
    validThresholds,
  };
}

async function _doRoll(state, speaker) {
  const paymentValidation = _validateInteractivePaymentThreshold(state);
  if (!paymentValidation.valid) {
    const thresholdsLabel = paymentValidation.validThresholds.join(", ");
    const nextHint = paymentValidation.next === null
      ? `Remove ${paymentValidation.filled - paymentValidation.previous} to reach the last valid cost.`
      : `Add ${paymentValidation.next - paymentValidation.filled} more or remove ${paymentValidation.filled - paymentValidation.previous}.`;
    ui.notifications.warn(
      `Extra dice payment must match an exact threshold (${thresholdsLabel}). `
      + `You currently have ${paymentValidation.filled} assigned. ${nextHint}`
    );
    return false;
  }

  // ── Deduct interactive payment resources ───────────────────────────────────
  if (!state.paymentCostDeducted && game.settings.get("sta2e-toolkit", "interactiveDicePayment") && !state.isAssistRoll) {
    let momentumUsed = 0, threatUsed = 0, personalThreatUsed = 0;
    for (let s of state.paymentSlots) {
      if (s === "momentum") momentumUsed++;
      else if (s === "poolThreat" || s === "threat") threatUsed++;
      else if (s === "personalThreat") personalThreatUsed++;
    }

    state.paymentSpent = { momentum: momentumUsed, threat: threatUsed, personalThreat: personalThreatUsed };

    const _ST = game.STATracker?.constructor ?? null;
    const _readPool  = (key) => { if (_ST) return _ST.ValueOf(key) ?? 0; try { return game.settings.get("sta", key) ?? 0; } catch { return 0; } };
    const _writePool = async (key, v) => { if (_ST) { await _ST.DoUpdateResource(key, Math.max(0, v)); return; } try { await game.settings.set("sta", key, Math.max(0, v)); } catch { /* ignore */ } };

    if (state.playerMode) {
      if (momentumUsed > 0) {
        await _writePool("momentum", _readPool("momentum") - momentumUsed);
      }
      if (threatUsed > 0) {
        if (game.user.isGM) {
          await _writePool("threat", _readPool("threat") + threatUsed);
        } else {
          game.socket.emit("module.sta2e-toolkit", {
            action: "adjustThreatFromRoll",
            delta: threatUsed,
          });
        }
      }
    } else {
      if (threatUsed > 0) {
        await _writePool("threat", _readPool("threat") - threatUsed);
      }
      if (personalThreatUsed > 0) {
        const _ptActor = canvas.tokens?.placeables.find(t => t.actor?.id === state.actorId)?.actor
          ?? game.actors.get(state.actorId);
        const _ptTokenDoc = canvas.tokens?.placeables.find(t => t.actor?.id === state.actorId)?.document ?? null;
        if (_ptActor) {
          const _CombatHUD = game.sta2eToolkit?.CombatHUD;
          if (_CombatHUD) {
            const current = _CombatHUD.getNpcPersonalThreat(_ptActor, _ptTokenDoc);
            await _CombatHUD.setNpcPersonalThreat(_ptActor, _ptTokenDoc, current - personalThreatUsed);
          }
        }
      }
    }
    state.paymentCostDeducted = true;
  }

  const shipTarget = state.shipSystems + state.shipDept;
  // For a ship-sheet assist roll there is no NPC crew — dice roll against the ship's own target.
  // Ground NPCs in assist mode roll against their own attr + disc, not ship target.
  const crewTarget = (state.isAssistRoll && !state.playerMode && !state.groundMode)
    ? shipTarget
    : (state.crewAttr + state.crewDept);
  const compThresh = 21 - (state.complicationRange ?? 1);

  // ── Crew crit threshold ────────────────────────────────────────────────────
  // Generic crew: always full focus (1 to dept) per STA NPC rules.
  // Named officer:
  //   • No focus flag    → crit only on natural 1
  //   • hasFocus         → crit on 1 to disc (standard focus range)
  //   • hasDedicatedFocus → crit on 1 to (disc × 2), max 20
  //   • 1 is ALWAYS a crit regardless of any flag
  let crewCritThresh;
  if (state.isAssistRoll && !state.playerMode && !state.groundMode) {
    // Ship-sheet assist — crit threshold matches ship dept (same as ship dice)
    crewCritThresh = Math.max(1, state.shipDept);
  } else if (state.officer) {
    // Named officer: respect the Focus / Dedicated Focus flags the GM set
    if (state.hasDedicatedFocus) {
      crewCritThresh = Math.min(20, Math.max(1, state.crewDept * 2));
    } else if (state.hasFocus) {
      crewCritThresh = Math.max(1, state.crewDept);
    } else {
      crewCritThresh = 1; // only natural 1 crits without a focus
    }
  } else {
    // Generic quality crew — always assumed to have focus on relevant task
    crewCritThresh = Math.max(1, state.crewDept);
  }
  const shipCritThresh = Math.max(1, state.shipDept);

  // ── Step 1: Roll crew dice ────────────────────────────────────────────────
  if (state.officer && state.hasDetermination && state.crewNumDice >= 1) {
    // Determination: force one die to a natural 1 (critical success worth 2 successes).
    // Roll the remaining dice normally, then prepend the forced die.
    const forcedDie = {
      value: 1, success: true, crit: true, complication: false,
      critThreshold: crewCritThresh, determinationForced: true,
    };
    const rest = rollPool(Math.max(0, state.crewNumDice - 1), crewTarget, compThresh, crewCritThresh);
    state.crewDice = [forcedDie, ...rest];
    state.determinationAutoUsed = true;
    state.hasDetermination = false;
  } else {
    state.crewDice = rollPool(state.crewNumDice, crewTarget, compThresh, crewCritThresh);
  }

  // Procedural Compliance: remove 1 die from pool, inject one auto-success die.
  // Runs after Determination block so both state flags are respected independently.
  if (state.officer && state.hasProcedural && !state.proceduralUsed) {
    state.proceduralUsed = true;
    const proceduralDie = {
      value: crewTarget,  // equals target — a plain success, not a crit
      success: true, crit: false, complication: false,
      critThreshold: crewCritThresh, proceduralForced: true,
    };
    const reducedN = Math.max(0, state.crewNumDice - 1);
    state.crewDice = [proceduralDie, ...rollPool(reducedN, crewTarget, compThresh, crewCritThresh)];
  }

  // Auto-Success Trade: crewNumDice already has -1 applied from _calcDiceFromSlots,
  // so roll crewNumDice remaining dice alongside the one guaranteed success die.
  if (state.hasAutoSuccessTrade) {
    // crewNumDice is the full pool size. Trade 1 die for the guaranteed success die,
    // so roll crewNumDice-1 real dice alongside it — total displayed = crewNumDice.
    const autoSuccessDie = {
      value: 1,  // lowest value — always a success, never a complication, but forced non-crit
      success: true, crit: false, complication: false,
      critThreshold: crewCritThresh, autoSuccessTradeForced: true,
    };
    state.crewDice = [autoSuccessDie, ...rollPool(Math.max(0, state.crewNumDice - 1), crewTarget, compThresh, crewCritThresh)];
  }

  const crewSuccesses = countSuccesses(state.crewDice);

  // ── Step 2: Crew must get ≥1 success for assist/ship to roll ─────────────
  state.crewFailed = crewSuccesses === 0;

  if (state.crewFailed) {
    state.crewAssistDice = [];
    state.namedAssistDice = [];
    state.apAssistDice = [];  // AP assist also doesn't roll if crew failed
    state.shipDice = [];
  } else {
    // Generic crew assist die (ASSIST FROM CREW checkbox)
    state.crewAssistDice = state.crewAssist
      ? rollPool(1, crewTarget, compThresh, crewCritThresh)
      : [];

    // Named assisting officer dice — one per officer, each with its own crit threshold
    // derived from the officer's selected discipline + focus flags.
    // Player mode: skip auto-rolling; each officer rolls their own die from the chat card.
    if (state.playerMode) {
      state.namedAssistDice = [];
      state.assistRerollsUsed = [];
    } else {
      state.namedAssistDice = (state.assistOfficers ?? []).flatMap(ao => {
        const aoAttrVal = ao.stats ? (ao.stats.attributes[ao.attrKey] ?? 9) : 9;
        const aoDiscVal = ao.stats ? (ao.stats.disciplines[ao.discKey] ?? 2) : 2;
        const aoTarget = ao.stats ? aoAttrVal + aoDiscVal : crewTarget;
        let aoCrit;
        if (ao.hasDedicatedFocus) {
          aoCrit = Math.min(20, Math.max(1, aoDiscVal * 2));
        } else if (ao.hasFocus) {
          aoCrit = Math.max(1, aoDiscVal);
        } else {
          aoCrit = 1; // only natural 1 crits without focus
        }
        return rollPool(1, aoTarget, compThresh, aoCrit);
      });
      // Chief of Staff: initialise per-assist-die reroll flags (one bool per named die)
      state.assistRerollsUsed = state.namedAssistDice.map(() => false);
    }

    // Ship assist dice — only if ship is assisting this roll
    if (!state.shipAssist) {
      state.shipDice = [];
    } else if (state.reservePower) {
      // Reserve Power rerouted: first die is automatically a 1 (critical success).
      // Any complications rolled on ship dice count as 2 complications each — flag
      // them with reservePowerComp so the summary can double-count them correctly.
      const forced = { value: 1, success: true, crit: true, complication: false, critThreshold: shipCritThresh, reservePowerForced: true };
      // Advanced Sensors adds a second normally-rolled die on top
      const rest = state.advancedSensorsActive
        ? rollPool(1, shipTarget, compThresh, shipCritThresh).map(d => ({ ...d, reservePowerComp: d.complication }))
        : [];
      state.shipDice = [forced, ...rest];
    } else {
      state.shipDice = rollPool(state.shipNumDice, shipTarget, compThresh, shipCritThresh);
    }
  }

  state.crewTarget = crewTarget;
  state.shipTarget = shipTarget;
  state.crewCritThresh = crewCritThresh;
  state.shipCritThresh = shipCritThresh;
  state.compThresh = compThresh;
  state.phase = "rolled";

  // ── Attack Pattern assist die ─────────────────────────────────────────────
  // Helm officer (or crew quality fallback) rolls 1 die using Control + Conn.
  // Only rolls if crew succeeded (same rule as all assist dice).
  if (state.hasAttackPattern && !state.crewFailed) {
    let apAttr, apDisc;
    if (state.helmOfficer) {
      // Named helm officer: use their actual attribute + discipline values
      apAttr = state.helmOfficer.attributes?.[state.apAttrKey] ?? 9;
      apDisc = state.helmOfficer.disciplines?.[state.apDiscKey] ?? 2;
    } else {
      // No named helm officer — fall back to crew quality (same target as main pool)
      apAttr = state.crewAttr;
      apDisc = state.crewDept;
    }
    const apTarget = apAttr + apDisc;
    // Crit threshold: named actor (officer or hasActorAtHelm) → use GM focus flags.
    // Pure NPC helm crew → always assumes focus per STA2e NPC rules.
    let apCrit;
    if (state.helmOfficer || state.hasActorAtHelm) {
      apCrit = state.apDedicatedFocus
        ? Math.min(20, apDisc * 2)
        : state.apHasFocus
          ? Math.max(1, apDisc)
          : 1;
    } else {
      // Pure NPC helm crew — always rolls with focus
      apCrit = Math.max(1, apDisc);
    }
    state.apAssistDice = rollPool(1, apTarget, compThresh, apCrit)
      .map(d => ({ ...d, isApAssist: true }));
  } else {
    state.apAssistDice = [];
  }

  const allDice = [...state.crewDice, ...(state.crewAssistDice ?? []), ...(state.namedAssistDice ?? []), ...(state.apAssistDice ?? []), ...state.shipDice];
  await dsnShowPool(allDice, speaker);
}

function _wireSetupInputs(dialog, actorSystems, actorDepts, state, _shipDataRef = { systems: actorSystems, depts: actorDepts }, openDialog = null, token = null, actor = null) {
  setTimeout(() => {
    const el = dialog.element ?? document.querySelector(".app.dialog-v2");
    if (!el) return;

    // Auto-check "Has Focus" when "Dedicated Focus" is checked (dedicated focus requires a focus)
    const _dedForceCbWire = el.querySelector("#has-dedicated-forces");
    const _focusCbWire    = el.querySelector("#has-focus");
    if (_dedForceCbWire && _focusCbWire) {
      _dedForceCbWire.addEventListener("change", () => {
        if (_dedForceCbWire.checked) _focusCbWire.checked = true;
      });
    }

    // Sliders → live value readout (difficulty is a number input; ship dice has no slider)
    ["crew-num-dice"].forEach(id => {
      const slider = el.querySelector(`#${id}`);
      const output = el.querySelector(`#${id}-val`);
      if (slider && output) {
        slider.addEventListener("input", () => { output.textContent = slider.value; });
      }
    });

    // ── Interactive Dice Payment UI ──────────────────────────────────────────
    const freeExtraDieCb = el.querySelector("#sta2e-free-extra-die");
    const autoSuccessCb = el.querySelector("#sta2e-auto-success-trade");
    const paymentSlots = el.querySelectorAll(".sta2e-roller-slot");
    const paymentSources = el.querySelectorAll(".sta2e-roller-coin-source");

    // Compute dice count from current slot state — called before every re-render
    // so the display is always in sync with the slots.
    const _calcDiceFromSlots = () => {
      const isFree = state.hasFreeExtraDie;
      const filled = state.paymentSlots.filter(s => s !== null).length;
      let baseDice = 2;
      let purchasedDice = 0;
      if (isFree) {
        if (filled === 0) purchasedDice = 1;
        else if (filled >= 5) purchasedDice = 3;
        else if (filled >= 2) purchasedDice = 2;
        else purchasedDice = 1;
      } else {
        if (filled >= 6) purchasedDice = 3;
        else if (filled >= 3) purchasedDice = 2;
        else if (filled >= 1) purchasedDice = 1;
      }
      return Math.min(5, baseDice + purchasedDice);
    };

    const _updateSlotVisuals = () => {
      // Snapshot the current setup form before full rebuild so manual values like
      // difficulty survive payment-slot re-renders.
      const _snapEl = dialog?.element ?? document.querySelector(".app.dialog-v2");
      if (_snapEl) {
        _readSetupInputs(state, _snapEl, _shipDataRef.systems, _shipDataRef.depts);
      }
      // Update crewNumDice NOW so buildDialogContent sees the correct value on re-render
      state.crewNumDice = _calcDiceFromSlots();
      openDialog();
    };

    if (freeExtraDieCb) {
      freeExtraDieCb.addEventListener("change", (e) => {
        state.hasFreeExtraDie = e.target.checked;
        if (state.hasFreeExtraDie) {
          // Free die mode only has 5 slots — clear the 6th if filled
          state.paymentSlots[5] = null;
        }
        state.paymentSlotsChanged = true;
        _updateSlotVisuals();
      });
    }

    if (autoSuccessCb) {
      autoSuccessCb.addEventListener("change", (e) => {
        state.hasAutoSuccessTrade = e.target.checked;
        state.paymentSlotsChanged = true;
        _updateSlotVisuals();
      });
    }

    // ── Quick-fill slider ───────────────────────────────────────────────────
    const easyFillSlider = el.querySelector("#sta2e-easy-fill");
    const easyFillValEl  = el.querySelector("#sta2e-easy-fill-val");
    if (easyFillSlider) {
      easyFillSlider.addEventListener("input", () => {
        const targetExtra = parseInt(easyFillSlider.value, 10);
        if (easyFillValEl) easyFillValEl.textContent = targetExtra;
        state.easyFillValue = targetExtra;

        // Coins needed to achieve N purchased extra dice above the base 2.
        // (These thresholds mirror _calcDiceFromSlots in reverse.)
        const isFree   = state.hasFreeExtraDie;
        const coinsFor = isFree ? [0, 0, 2, 5] : [0, 1, 3, 6];
        const need     = coinsFor[targetExtra] ?? 0;

        // Reset all slots first
        state.paymentSlots = Array(state.paymentSlots.length).fill(null);

        if (need > 0) {
          // Helper: fill `count` slots starting at `startIdx` with `type`, capped by pool.
          // Returns how many were actually filled.
          const _fill = (type, count, startIdx) => {
            const avail = Math.min(count, _getAvailablePool(type));
            for (let i = 0; i < avail; i++) state.paymentSlots[startIdx + i] = type;
            return avail;
          };

          let cursor = 0;
          if (state.playerMode) {
            // Player: momentum first, then threat to cover any remainder
            const mFilled = _fill("momentum", need, cursor);
            cursor += mFilled;
            if (cursor < need) _fill("threat", need - cursor, cursor);
          } else {
            // NPC: pool threat first; notable/major ground NPCs can also use personal threat
            const ptFilled = _fill("poolThreat", need, cursor);
            cursor += ptFilled;
            if (cursor < need && state.groundIsNpc &&
                (state.groundNpcType === "notable" || state.groundNpcType === "major")) {
              _fill("personalThreat", need - cursor, cursor);
            }
          }
        }

        state.paymentSlotsChanged = true;
        _updateSlotVisuals();
      });
    }

    // Determine currently available pools to validate drops
    const _getAvailablePool = (type) => {
      const T = game.STATracker?.constructor ?? null;
      if (type === "momentum") {
        if (T) return T.ValueOf("momentum") ?? 0;
        try { return game.settings.get("sta", "momentum") ?? 0; } catch { return 0; }
      } else if (type === "threat" || type === "poolThreat") {
        if (state.playerMode && type === "threat") return 99; // players generate threat, no pool cap
        if (T) return T.ValueOf("threat") ?? 0;
        try { return game.settings.get("sta", "threat") ?? 0; } catch { return 0; }
      } else if (type === "personalThreat") {
        const a = canvas.tokens?.placeables.find(t => t.actor?.id === state.actorId)?.actor
          ?? game.actors.get(state.actorId);
        const _CombatHUD = game.sta2eToolkit?.CombatHUD;
        if (_CombatHUD) return _CombatHUD.getNpcPersonalThreat(a, state._tokenDoc) ?? 0;
        return a?.system?.stress?.value ?? 0;
      }
      return 0;
    };

    paymentSources.forEach(src => {
      src.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", e.target.dataset.type);
        e.target.style.opacity = "0.5";
      });
      src.addEventListener("dragend", (e) => {
        e.target.style.opacity = "1";
      });
      src.addEventListener("dblclick", () => {
        const type = src.dataset.type;
        const firstEmpty = state.paymentSlots.findIndex(s => s === null);
        if (firstEmpty === -1) return;
        const currentAssigned = state.paymentSlots.filter(s => s === type).length;
        const available = _getAvailablePool(type);
        if ((currentAssigned + 1) > available) {
          ui.notifications.warn(`Not enough ${type} available!`);
          return;
        }
        state.paymentSlots[firstEmpty] = type;
        state.paymentSlotsChanged = true;
        _updateSlotVisuals();
      });
    });

    paymentSlots.forEach(slot => {
      slot.addEventListener("dragover", (e) => {
        e.preventDefault();
        slot.style.filter = "brightness(1.5)";
      });
      slot.addEventListener("dragleave", (e) => {
        slot.style.filter = "none";
      });
      slot.addEventListener("drop", (e) => {
        e.preventDefault();
        slot.style.filter = "none";
        const type = e.dataTransfer.getData("text/plain");
        if (!type) return;

        const idx = parseInt(slot.dataset.index, 10);

        // Count how many we ALREADY have of this type in the state, plus the new one
        let currentAssigned = 0;
        for (let i = 0; i < state.paymentSlots.length; i++) {
          if (i !== idx && state.paymentSlots[i] === type) {
            currentAssigned++;
          }
        }

        const available = _getAvailablePool(type);
        if ((currentAssigned + 1) > available) {
          ui.notifications.warn(`Not enough ${type} available!`);
          return;
        }

        state.paymentSlots[idx] = type;
        state.paymentSlotsChanged = true;
        _updateSlotVisuals();
      });

      slot.addEventListener("click", () => {
        const idx = parseInt(slot.dataset.index, 10);
        if (state.paymentSlots[idx] !== null) {
          state.paymentSlots[idx] = null;
          state.paymentSlotsChanged = true;
          _updateSlotVisuals();
        }
      });
    });

    // Ship assist checkbox
    const shipAssistCb = el.querySelector("#ship-assist");
    const shipPoolBody = el.querySelector("#ship-pool-body");
    const shipSelectBody = el.querySelector("#ship-select-body"); // sheet mode wrapper
    if (shipAssistCb) {
      shipAssistCb.addEventListener("change", () => {
        if (shipSelectBody) {
          // Sheet mode: show/hide the entire selector + pool body
          shipSelectBody.style.display = shipAssistCb.checked ? "flex" : "none";
          const sel = el.querySelector("#sheet-ship-select");
          if (shipAssistCb.checked) {
            // Auto-select first ship if none chosen yet
            if (sel && parseInt(sel.value, 10) < 0 && sel.options.length > 1) {
              sel.value = sel.options[1].value;
              sel.dispatchEvent(new Event("change"));
            }
          } else {
            // Deselect ship
            if (sel) { sel.value = "-1"; sel.dispatchEvent(new Event("change")); }
          }
        } else if (shipPoolBody) {
          // NPC mode: enable/disable pool body
          shipPoolBody.style.opacity = shipAssistCb.checked ? "1" : "0.4";
          shipPoolBody.style.pointerEvents = shipAssistCb.checked ? "auto" : "none";
        }
      });
    }

    // Complication range slider
    const compSlider = el.querySelector("#complication-range");
    const compValEl = el.querySelector("#complication-range-val");
    const compDescEl = el.querySelector("#complication-desc");
    if (compSlider) {
      compSlider.addEventListener("input", () => {
        const n = parseInt(compSlider.value);
        if (compValEl) compValEl.textContent = n;
        if (compDescEl) compDescEl.textContent = n === 1
          ? "Complications on: 20"
          : `Complications on: ${21 - n}\u201320`;
      });
    }

    // Quality is read-only in roller — set via HUD crew quality selector

    // Targeting Solution benefit sub-options
    const tsCb = el.querySelector("#targeting-solution");
    const tsBenefitSect = el.querySelector("#ts-benefit-section");
    const tsSystemPicker = el.querySelector("#ts-system-picker");
    if (tsCb && tsBenefitSect) {
      tsCb.addEventListener("change", () => {
        tsBenefitSect.style.display = tsCb.checked ? "flex" : "none";
        if (!tsCb.checked) {
          state.tsChoice = null;
          state.tsSystem = null;
        } else if (!state.tsChoice) {
          state.tsChoice = "reroll";
          el.querySelector("#ts-benefit-reroll").checked = true;
        }
      });

      el.querySelectorAll("input[name='ts-benefit']").forEach(radio => {
        radio.addEventListener("change", () => {
          state.tsChoice = radio.value;
          if (tsSystemPicker) {
            tsSystemPicker.style.display = state.tsChoice === "system" ? "grid" : "none";
          }
          if (state.tsChoice !== "system") state.tsSystem = null;
        });
      });

      el.querySelectorAll(".ts-sys-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const sys = btn.dataset.system;
          state.tsSystem = sys === "random" ? null : sys;
          state.tsChoice = "system";
          // Visually mark chosen button
          el.querySelectorAll(".ts-sys-btn").forEach(b => {
            const chosen = b.dataset.system === sys;
            b.style.background = chosen ? "rgba(255,153,0,0.15)" : "rgba(255,153,0,0.04)";
            b.style.borderColor = chosen ? "var(--sta2e-secondary, #ffaa00)" : "";
            b.style.color = chosen ? "var(--sta2e-primary, #ffcc00)" : "";
          });
        });
      });
    }

    // Officer selects → live target + focus display update
    const officerAttrSel = el.querySelector("#officer-attr");
    const officerDiscSel = el.querySelector("#officer-disc");
    if (officerAttrSel || officerDiscSel) {
      const updateOfficerTarget = () => {
        // Only live-update the numerical target in full officer mode.
        // In actor-at-station mode the options have no "(value)" suffix, so parsing
        // would yield 0 and incorrectly zero out the target display.
        if (!state.officer) return;
        const attrVal = parseInt(officerAttrSel?.selectedOptions[0]?.text?.match(/\d+/)?.[0]) || 0;
        const discVal = parseInt(officerDiscSel?.selectedOptions[0]?.text?.match(/\d+/)?.[0]) || 0;
        const targetEl = el.querySelector("#crew-target-display");
        const focusEl = el.querySelector("#crew-focus-display");
        if (targetEl) targetEl.textContent = attrVal + discVal;
        if (focusEl) focusEl.textContent = `1–${discVal}`;
      };
      officerAttrSel?.addEventListener("change", updateOfficerTarget);
      officerDiscSel?.addEventListener("change", updateOfficerTarget);
    }

    // Ship system select → live ship target + focus + Advanced Sensors activation
    const sysSelect = el.querySelector("#ship-system-key");
    const deptSelect = el.querySelector("#ship-dept-key");
    const shipDisp = el.querySelector("#ship-target-display");
    const shipFocus = el.querySelector("#ship-focus-display");
    const shipDiceRow = el.querySelector("#ship-dice-row");

    const sensorsNoticeEl = el.querySelector("#ship-adv-sensors-notice");

    // Rebuild the Advanced Sensor Suites notice based on current state + selected system
    const updateSensorsNotice = () => {
      if (!sensorsNoticeEl) return;
      const active = state.hasAdvancedSensors && sysSelect?.value === "sensors" && state.sensorsBreaches === 0;
      const available = state.hasAdvancedSensors && !active && state.sensorsBreaches === 0;
      const unavailable = state.hasAdvancedSensors && state.sensorsBreaches > 0;
      state.advancedSensorsActive = active;
      state.shipNumDice = active ? 2 : 1;
      if (active) {
        sensorsNoticeEl.innerHTML = `<div style="font-size:9px;color:${LC.green};font-family:${LC.font};
            display:flex;align-items:center;gap:6px;">
            <span>★ Advanced Sensor Suites — rolling 2 dice (Sensors selected)</span>
          </div>`;
      } else if (available) {
        sensorsNoticeEl.innerHTML = `<div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">
            ★ Advanced Sensor Suites available — select Sensors system to activate (rolls 2 dice)
          </div>`;
      } else if (unavailable) {
        sensorsNoticeEl.innerHTML = `<div style="font-size:9px;color:${LC.red};font-family:${LC.font};">
            ✗ Advanced Sensor Suites unavailable — Sensors has ${state.sensorsBreaches} breach${state.sensorsBreaches > 1 ? "es" : ""}
          </div>`;
      } else {
        sensorsNoticeEl.innerHTML = "";
      }
    };

    const updateShipTarget = () => {
      const sv = _shipDataRef.systems[sysSelect?.value]?.value ?? 0;
      const dv = _shipDataRef.depts[deptSelect?.value]?.value ?? 0;
      if (shipDisp) shipDisp.textContent = sv + dv;
      if (shipFocus) shipFocus.textContent = `1\u2013${dv}`;
    };

    sysSelect?.addEventListener("change", () => {
      updateShipTarget();
      updateSensorsNotice();
    });
    deptSelect?.addEventListener("change", updateShipTarget);

    // Sheet-mode ship selector — swap _shipDataRef and repopulate system/dept selects
    const shipSelector = el.querySelector("#sheet-ship-select");
    if (shipSelector) {
      const applyShipSelection = () => {
        const idx = parseInt(shipSelector.value, 10);
        const opt = idx >= 0 ? shipSelector.options[shipSelector.selectedIndex] : null;
        const cb = el.querySelector("#ship-assist");
        const selBody = el.querySelector("#ship-select-body");
        const tsLabel = el.querySelector("#targeting-solution-label");
        const csLabel = el.querySelector("#calibrate-sensors-label");
        if (opt && idx >= 0) {
          const shipData = (state.availableShips ?? [])[idx] ?? null;
          _shipDataRef.systems = shipData?.systems ?? {};
          _shipDataRef.depts   = shipData?.depts   ?? {};
          // Update Advanced Sensors state from the ship data
          state.hasAdvancedSensors = shipData?.hasAdvancedSensors ?? false;
          state.sensorsBreaches    = shipData?.sensorsBreaches    ?? 0;
          // Read Targeting Solution state from the selected ship's canvas token
          const _tsCHUD = game.sta2eToolkit?.CombatHUD;
          const _tsTokEl = (shipData?.actorId)
            ? (canvas.tokens?.placeables.find(t => t.actor?.id === shipData.actorId) ?? null)
            : null;
          const _shipHasTS = (_tsCHUD && _tsTokEl) ? _tsCHUD.hasTargetingSolution(_tsTokEl) : false;
          const _shipTsObj = (_shipHasTS && _tsCHUD) ? _tsCHUD.getTargetingSolution(_tsTokEl) : null;
          state.hasTargetingSolution = _shipHasTS;
          state.tsChoice = _shipHasTS ? (_shipTsObj?.benefit ?? "reroll") : null;
          state.tsSystem = _shipHasTS ? (_shipTsObj?.system ?? null) : null;
          // Sync form elements to match the selected ship's TS state
          const _tsCb = el.querySelector("#targeting-solution");
          const _tsBenefitSect = el.querySelector("#ts-benefit-section");
          const _rerollRb = el.querySelector("#ts-benefit-reroll");
          const _sysRb = el.querySelector("#ts-benefit-system");
          const _formSysPicker = el.querySelector("#ts-system-picker");
          if (_tsCb) _tsCb.checked = _shipHasTS;
          if (_tsBenefitSect) _tsBenefitSect.style.display = _shipHasTS ? "flex" : "none";
          if (_shipHasTS) {
            if (_rerollRb) _rerollRb.checked = state.tsChoice !== "system";
            if (_sysRb) _sysRb.checked = state.tsChoice === "system";
          }
          if (_formSysPicker) _formSysPicker.style.display = (state.tsChoice === "system") ? "grid" : "none";
          if (cb) cb.checked = true;
          if (selBody) selBody.style.display = "flex";
          // Repopulate system and dept selects from the newly chosen ship
          if (sysSelect) {
            sysSelect.innerHTML = Object.entries(_shipDataRef.systems)
              .map(([k, s], i) => `<option value="${k}" ${i === 0 ? "selected" : ""}>${_systemLabel(k)} (${s.value})</option>`)
              .join("");
          }
          if (deptSelect) {
            deptSelect.innerHTML = Object.entries(_shipDataRef.depts)
              .map(([k, d], i) => `<option value="${k}" ${i === 0 ? "selected" : ""}>${_deptLabel(k)} (${d.value})</option>`)
              .join("");
          }
          // Show ship-specific options now that a ship is selected
          if (tsLabel) tsLabel.style.display = "flex";
          if (csLabel) csLabel.style.display = "flex";
          updateShipTarget();
          updateSensorsNotice();
        } else {
          _shipDataRef.systems = {};
          _shipDataRef.depts = {};
          state.hasAdvancedSensors = false;
          state.sensorsBreaches = 0;
          if (cb) cb.checked = false;
          if (selBody) selBody.style.display = "none";
          if (shipPoolBody) { shipPoolBody.style.opacity = "0.4"; shipPoolBody.style.pointerEvents = "none"; }
          // Hide ship-specific options when no ship is selected
          state.hasTargetingSolution = false;
          state.tsChoice = null;
          state.tsSystem = null;
          if (tsLabel) { tsLabel.style.display = "none"; el.querySelector("#targeting-solution").checked = false; }
          if (csLabel) { csLabel.style.display = "none"; el.querySelector("#calibrate-sensors").checked = false; }
          updateSensorsNotice();
        }
        state.selectedShipIdx = idx;
      };
      shipSelector.addEventListener("change", applyShipSelection);
      // If a ship was already selected on re-render, apply it immediately
      if (state.selectedShipIdx >= 0) applyShipSelection();
    }

    // Assist-roll checkbox — lock dice pool to 1, hide ship pool + difficulty
    const assistRollCb = el.querySelector("#is-assist-roll");
    const assistRollLabel = el.querySelector("#assist-roll-label");
    const diceSlider = el.querySelector("#crew-num-dice");
    const diceVal = el.querySelector("#crew-num-dice-val");
    const crewDicePoolSec = el.querySelector("#sta2e-crew-dice-pool-section");
    const shipPoolSec = el.querySelector("#sta2e-ship-pool-section");
    const difficultyRow = el.querySelector("#sta2e-difficulty-row");
    if (assistRollCb) {
      const _applyAssistMode = (on) => {
        // Label highlight
        if (assistRollLabel) {
          assistRollLabel.style.background = on ? "rgba(0,150,255,0.10)" : "transparent";
          assistRollLabel.style.border = on ? `1px solid ${LC.secondary}` : "1px solid transparent";
        }
        // Lock/unlock dice pool slider
        if (diceSlider) {
          if (on) {
            diceSlider.dataset.prevMax = diceSlider.max;
            diceSlider.dataset.prevVal = diceSlider.value;
            diceSlider.value = "1";
            diceSlider.max = "1";
            diceSlider.disabled = true;
            diceSlider.style.opacity = "0.5";
          } else {
            diceSlider.max = diceSlider.dataset.prevMax ?? "5";
            diceSlider.value = diceSlider.dataset.prevVal ?? "2";
            diceSlider.disabled = false;
            diceSlider.style.opacity = "";
          }
          if (diceVal) diceVal.textContent = diceSlider.value;
        }
        if (crewDicePoolSec) crewDicePoolSec.style.display = on ? "none" : "";
        // Hide ship pool and difficulty when assisting
        if (shipPoolSec) shipPoolSec.style.display = on ? "none" : "";
        if (difficultyRow) difficultyRow.style.display = on ? "none" : "";
      };
      assistRollCb.addEventListener("change", () => {
        state.isAssistRoll = assistRollCb.checked;
        _applyAssistMode(assistRollCb.checked);
      });
      // Apply immediately on open if already checked (e.g. re-render)
      if (assistRollCb.checked) _applyAssistMode(true);
    }

    // ── Ship-sheet assist rolls (isAssistRoll set at open time, no checkbox) ──
    // When a player ship sheet opens the roller with isAssistRoll:true but
    // playerMode is false, _applyAssistMode is never triggered by a checkbox.
    // Call it directly so the dice slider is locked to 1 and difficulty is hidden.
    // Ground NPCs are excluded — they toggle assist via a checkbox and re-render.
    if (state.isAssistRoll && !state.playerMode && !state.groundMode) {
      const _lockForShipAssist = () => {
        const sl = el.querySelector("#crew-num-dice");
        const vl = el.querySelector("#crew-num-dice-val");
        const dr = el.querySelector("#sta2e-difficulty-row");
        const sp = el.querySelector("#sta2e-ship-pool-section");
        const note = el.querySelector("#adv-sensor-note");
        const maxD = state.advancedSensorsActive ? 2 : 1;
        if (sl) { sl.value = String(maxD); sl.max = String(maxD); sl.disabled = true; sl.style.opacity = "0.5"; }
        if (vl) vl.textContent = String(maxD);
        if (dr) dr.style.display = "none";
        if (sp) sp.style.display = "none";
        if (note) note.style.color = state.advancedSensorsActive ? LC.green : LC.textDim;
      };
      _lockForShipAssist();
      // Re-evaluate Advanced Sensors dice count when system selector changes
      const sysSelectShip = el.querySelector("#ship-system-key");
      if (sysSelectShip && state.hasAdvancedSensors) {
        sysSelectShip.addEventListener("change", () => {
          const isSensors = sysSelectShip.value === "sensors";
          state.advancedSensorsActive = isSensors && (state.sensorsBreaches ?? 0) === 0;
          _lockForShipAssist();
        });
      }
    }

    // ── Manage assigned ships button ──────────────────────────────────────────
    const manageShipsBtn = el.querySelector("#sta2e-manage-ships");
    if (manageShipsBtn && state.onAssignShips) {
      manageShipsBtn.addEventListener("click", async () => {
        manageShipsBtn.disabled = true;
        try {
          const newShips = await state.onAssignShips();
          state.availableShips = newShips;
          state.selectedShipIdx = -1;
          state.shipAssist = false;
          if (openDialog) openDialog();
        } finally {
          manageShipsBtn.disabled = false;
        }
      });
    }

    // ── Combat task panel wiring ───────────────────────────────────────────────
    if (state.combatTaskContext) {
      // Task buttons — update attr/disc, difficulty, ship pool on selection
      el.querySelectorAll(".sta2e-task-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          // Highlight selected button; clear weapon fire button highlights
          el.querySelectorAll(".sta2e-task-btn, .sta2e-weapon-fire-btn").forEach(b => {
            b.style.background = "transparent";
            b.style.borderColor = LC.borderDim;
          });
          btn.style.background = "rgba(255,153,0,0.12)";
          btn.style.borderColor = LC.primary;

          // Selecting a non-weapon task — clear pending opposed state, remove
          // the request-defense button, and re-enable the Roll button.
          state._opposedTaskPending = null;
          el.querySelector("#sta2e-request-defense-btn")?.remove();
          const _rollBtn = el.closest(".app, [data-appid]")
            ?.querySelector?.('[data-action="roll"]')
            ?? el.querySelector('[data-action="roll"]');
          if (_rollBtn) {
            _rollBtn.disabled      = false;
            _rollBtn.style.opacity = "";
            _rollBtn.style.cursor  = "";
          }

          const taskKey = btn.dataset.taskKey;
          const attr = btn.dataset.attr || null;
          const disc = btn.dataset.disc || null;
          const diff = parseInt(btn.dataset.diff ?? "1");
          const diffMod = parseInt(btn.dataset.diffMod ?? "0");

          state.selectedTaskKey = taskKey;

          // Store task defaults so Multi-Tasking checkbox can revert on uncheck
          state._taskDefaultDisc = disc;
          state._taskDefaultShipDept = state.combatTaskContext?.taskParams?.[taskKey]?.shipDeptKey ?? null;
          // Show/hide Multi-Tasking toggle — only for Override tasks (diffMod === 1)
          const _mtSection = el.querySelector("#multi-tasking-section");
          const _mtCheckbox = el.querySelector("#multi-tasking-conn");
          if (_mtSection) {
            const _isOverrideTask = diffMod === 1;
            _mtSection.style.display = (_isOverrideTask && state.hasMultiTasking) ? "block" : "none";
            if (!_isOverrideTask && _mtCheckbox?.checked) {
              _mtCheckbox.checked = false;
              state.multiTaskingActive = false;
            }
          }

          // Mirror selection onto combatTaskContext so taskCallback closures can
          // read it even in the chat-card confirm path where state is passed as null
          if (state.combatTaskContext) {
            state.combatTaskContext._selected ??= {};
            state.combatTaskContext._selected.taskKey = taskKey;
            state.combatTaskContext._selected.targetId = state.selectedTargetId ?? null;
            // Clear any stale per-task config from a previous selection
            state.combatTaskContext._selected.transportConfig = null;
          }

          // Transport: show config dialog before rolling to determine the correct difficulty
          if (taskKey === "transport" && state.combatTaskContext?.transportConfigDialog) {
            const shipActorId = state.combatTaskContext.combatShip?.actorId;
            const shipActor = game.actors?.get(shipActorId);
            const config = await state.combatTaskContext.transportConfigDialog(shipActor);
            if (!config) {
              // Dialog cancelled — deselect the task
              state.selectedTaskKey = null;
              if (state.combatTaskContext._selected) state.combatTaskContext._selected.taskKey = null;
              btn.style.background = "transparent";
              btn.style.borderColor = LC.borderDim;
              return;
            }
            state.combatTaskContext._selected.transportConfig = config;
          }

          // 1. Update officer attr/disc hidden inputs and display divs (sheetMode)
          const attrHidden = el.querySelector("#officer-attr");
          const discHidden = el.querySelector("#officer-disc");
          const attrDisp = el.querySelector("#officer-attr-display");
          const discDisp = el.querySelector("#officer-disc-display");
          const targetDisp = el.querySelector("#crew-target-display");
          const focusDisp = el.querySelector("#crew-focus-display");

          if (attr && attrHidden) attrHidden.value = attr;
          if (disc && discHidden) discHidden.value = disc;

          if (attr && attrDisp && state.officer) {
            const attrVal = state.officer.attributes[attr] ?? 0;
            attrDisp.textContent = `${ATTR_LABELS[attr] ?? attr} (${attrVal})`;
          }
          if (disc && discDisp && state.officer) {
            const discVal = state.officer.disciplines[disc] ?? 0;
            discDisp.textContent = `${DISC_LABELS[disc] ?? disc} (${discVal})`;
          }

          // Update crew target + focus display
          if (targetDisp && state.officer && attr && disc) {
            const av = state.officer.attributes[attr] ?? 0;
            const dv = state.officer.disciplines[disc] ?? 0;
            targetDisp.textContent = av + dv;
            if (focusDisp) focusDisp.textContent = `1\u2013${dv}`;
          }

          // Also update non-sheetMode selects (for other roller modes)
          const attrSel = el.querySelector("select#officer-attr");
          const discSel = el.querySelector("select#officer-disc");
          if (attr && attrSel) { attrSel.value = attr; attrSel.dispatchEvent(new Event("change")); }
          if (disc && discSel) { discSel.value = disc; discSel.dispatchEvent(new Event("change")); }

          // 2. Update difficulty input
          // For transport, use the value computed by the config dialog (type + site modifiers).
          // When an opposed task is active the difficulty is locked — never override it.
          const diffInput = el.querySelector("#difficulty");
          const transportCfg = taskKey === "transport"
            ? state.combatTaskContext?._selected?.transportConfig : null;
          if (diffInput) {
            if (state.opposedDefenseType && state.opposedDifficulty !== null) {
              diffInput.value = state.opposedDifficulty;
            } else {
              diffInput.value = transportCfg
                ? transportCfg.totalDiff
                : Math.max(0, diff + diffMod);
            }
          }

          // 3. Auto-enable ship assist and select the combat ship, then set system/dept.
          //    Ship selection must happen FIRST because applyShipSelection repopulates
          //    the sys/dept <select> elements — any value set before it fires is overwritten.
          const tp = state.combatTaskContext.taskParams?.[taskKey];
          const hasShipPool = tp && !tp.noShipAssist && (tp.shipSystemKey || tp.shipDeptKey);
          const shipSelector = el.querySelector("#sheet-ship-select");
          const shipAssistCb = el.querySelector("#ship-assist");
          const combatActorId = state.combatTaskContext.combatShip?.actorId ?? null;

          if (hasShipPool && combatActorId) {
            if (shipSelector) {
              // Sheet mode: find the option whose data-actor-id matches the combat ship
              const matchOpt = Array.from(shipSelector.options)
                .find(o => o.dataset.actorId === combatActorId);
              if (matchOpt && shipSelector.value !== matchOpt.value) {
                shipSelector.value = matchOpt.value;
                shipSelector.dispatchEvent(new Event("change")); // repopulates sys/dept selects
              }
            } else if (shipAssistCb && !shipAssistCb.checked) {
              // NPC roller mode: just tick the assist checkbox
              shipAssistCb.checked = true;
              shipAssistCb.dispatchEvent(new Event("change"));
            }
          }

          // Now set the system and dept (after ship selection has repopulated the selects)
          if (tp?.shipSystemKey && sysSelect) {
            sysSelect.value = tp.shipSystemKey;
            sysSelect.dispatchEvent(new Event("change"));
          }
          if (tp?.shipDeptKey && deptSelect) {
            deptSelect.value = tp.shipDeptKey;
            deptSelect.dispatchEvent(new Event("change"));
          }

          // 4. Show/hide target ship picker
          const needsTarget = btn.dataset.needsTarget === "1";
          const targetBox = el.querySelector("#sta2e-ctp-target");
          // target box stays visible at all times

          // 5. Make Calibrate Sensors reroll available in the roller session when active
          if (state.combatTaskContext.sensorMinorStates?.calibrateSensors) {
            const shipActorId2 = state.combatTaskContext.combatShip?.actorId;
            const shipTokenEl = canvas.tokens?.placeables
              .find(t => t.actor?.id === shipActorId2) ?? null;
            state._tokenDoc ??= shipTokenEl?.document ?? shipTokenEl ?? null;
            state.hasCalibratesensors = true;
            state.csRerollUsed = false;
          }
        });
      });

      // Multi-Tasking checkbox — when checked, override disc → conn and shipDept → conn
      const _mtCb = el.querySelector("#multi-tasking-conn");
      if (_mtCb) {
        _mtCb.addEventListener("change", () => {
          state.multiTaskingActive = _mtCb.checked;
          const useConn = _mtCb.checked;
          const targetDisc = useConn ? "conn" : (state._taskDefaultDisc ?? state.officerDiscKey);
          const targetDept = useConn ? "conn" : (state._taskDefaultShipDept ?? state.shipDeptKey);

          // Update disc — hidden input (sheetMode) and/or select (non-sheetMode)
          const discHidden = el.querySelector("#officer-disc");
          const discSel = el.querySelector("select#officer-disc");
          const discDisp = el.querySelector("#officer-disc-display");
          const attrHidden = el.querySelector("#officer-attr");
          const targetDisp = el.querySelector("#crew-target-display");
          const focusDisp = el.querySelector("#crew-focus-display");

          if (discHidden) discHidden.value = targetDisc;
          if (discSel) { discSel.value = targetDisc; discSel.dispatchEvent(new Event("change")); }
          if (discDisp && state.officer) {
            const dv = state.officer.disciplines[targetDisc] ?? 0;
            discDisp.textContent = `${DISC_LABELS[targetDisc] ?? targetDisc} (${dv})`;
          }
          // Update crew target + focus displays
          if (targetDisp && state.officer) {
            const attrKey = attrHidden?.value ?? state.officerAttrKey;
            const av = state.officer.attributes[attrKey] ?? 0;
            const dv = state.officer.disciplines[targetDisc] ?? 0;
            targetDisp.textContent = av + dv;
            if (focusDisp) focusDisp.textContent = `1\u2013${dv}`;
          }
          // Update ship dept select
          const deptSel = el.querySelector("select#ship-dept-key");
          if (deptSel) { deptSel.value = targetDept; deptSel.dispatchEvent(new Event("change")); }
        });
      }

      // Target ship select — store selection in state and set Foundry targeting
      const targetSel = el.querySelector("#sta2e-ctp-target-select");
      const _applyTargetFromSelect = () => {
        state.selectedTargetId = targetSel.value || null;
        if (state.combatTaskContext?._selected) {
          state.combatTaskContext._selected.targetId = state.selectedTargetId;
        }
        // Target the selected token so Sequencer animations fire correctly
        const selectedOpt = targetSel.options[targetSel.selectedIndex];
        const tokenId = selectedOpt?.dataset?.tokenId || null;
        // v13 API: use Token#setTarget instead of the removed updateTokenTargets
        canvas.tokens?.placeables.forEach(t => t.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: true }));
        if (tokenId) {
          canvas.tokens?.get(tokenId)?.setTarget(true, { user: game.user, releaseOthers: false });
        }
      };
      if (targetSel) {
        targetSel.addEventListener("change", _applyTargetFromSelect);
        // Apply pre-selected target immediately
        if (state.selectedTargetId) {
          targetSel.value = state.selectedTargetId;
          _applyTargetFromSelect();
        }
      }

      // Instant-apply buttons (Evasive Action / Defensive Fire / Attack Pattern / Reroute Power):
      // close this roller, then apply the effect — no dice roll involved.
      // Callbacks injected via combatTaskContext to avoid circular import.
      el.querySelectorAll(".sta2e-defense-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const conditionKey = btn.dataset.conditionKey;
          const shipActorId = state.combatTaskContext.combatShip?.actorId;
          const shipActor = game.actors?.get(shipActorId);
          const shipToken = canvas.tokens?.placeables
            .find(t => t.actor?.id === shipActorId) ?? null;

          if (conditionKey === "reroute-power") {
            // Reroute Power: show system dialog, close roller, apply effect — no roll
            if (!state.combatTaskContext.applyReroutePower) return;
            try { dialog?.close?.(); } catch { }
            await state.combatTaskContext.applyReroutePower(shipActor, shipToken);
          } else if (conditionKey === "modulate-shields") {
            // Modulate Shields: toggle +2 Resistance flag — no roll
            if (!state.combatTaskContext.applyModulateShields) return;
            try { dialog?.close?.(); } catch { }
            await state.combatTaskContext.applyModulateShields(shipActor, shipToken);
          } else if (conditionKey === "direct") {
            // Direct: show station + task picker, set assistPending, post card — no roll
            if (!state.combatTaskContext.applyDirect) return;
            try { dialog?.close?.(); } catch { }
            await state.combatTaskContext.applyDirect(shipActor, shipToken);
          } else {
            // Defence-mode conditions (evasive-action, defensive-fire, attack-pattern)
            if (!state.combatTaskContext.applyDefenseMode) return;
            try { dialog?.close?.(); } catch { }
            await state.combatTaskContext.applyDefenseMode(shipActor, shipToken, conditionKey);
          }
        });
      });

      // Minor action buttons (Calibrate Weapons, Targeting Solution, Prepare)
      // These do NOT close the roller — minor actions are separate from major actions.
      el.querySelectorAll(".sta2e-minor-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const minorKey = btn.dataset.minorKey;
          const shipActorId = state.combatTaskContext.combatShip?.actorId;
          const shipActor = game.actors?.get(shipActorId);
          const shipToken = canvas.tokens?.placeables
            .find(t => t.actor?.id === shipActorId) ?? null;

          if (minorKey === "calibrate-weapons" && state.combatTaskContext.applyCalibrateWeapons) {
            const newState = await state.combatTaskContext.applyCalibrateWeapons(shipActor, shipToken);
            // Update button status indicator in-place
            const statusEl = btn.querySelector(".sta2e-minor-status");
            if (statusEl) {
              statusEl.textContent = newState ? "● ON" : "○ OFF";
              statusEl.style.color = newState ? LC.green : LC.textDim;
            }

          } else if (minorKey === "targeting-solution" && state.combatTaskContext.applyTargetingSolution) {
            const newState = await state.combatTaskContext.applyTargetingSolution(shipActor, shipToken);
            const statusEl = btn.querySelector(".sta2e-minor-status");
            if (statusEl) {
              statusEl.textContent = newState ? "● ON" : "○ OFF";
              statusEl.style.color = newState ? LC.green : LC.textDim;
            }
            // Keep in-memory cache in sync so weapon-fire handler reads correct value
            if (state.combatTaskContext.tacticalMinorStates) {
              state.combatTaskContext.tacticalMinorStates.targetingSolution = newState;
            }
            if (!newState) {
              state.hasTargetingSolution = false;
              state.tsChoice = null;
              state.tsSystem = null;
            }
            // Dynamically show or hide the TS benefit row (and system picker)
            const existingTsRow = el.querySelector("#sta2e-ts-benefit-row");
            const existingTsSys = el.querySelector("#sta2e-ts-sys-picker");
            if (newState && !existingTsRow) {
              const _subBtnCss = `padding:3px 5px;background:rgba(255,153,0,0.04);
                border:1px solid ${LC.borderDim};border-radius:2px;
                color:${LC.secondary};font-size:8px;font-weight:700;
                font-family:${LC.font};letter-spacing:0.05em;
                text-transform:uppercase;cursor:pointer;`;
              const tsRow = document.createElement("div");
              tsRow.id = "sta2e-ts-benefit-row";
              tsRow.style.cssText = `display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:-1px;margin-bottom:3px;`;
              for (const [subKey, subLabel] of [["ts-reroll", "↺ Reroll d20"], ["ts-pick-system", "🎯 Target System"]]) {
                const subBtn = document.createElement("button");
                subBtn.type = "button";
                subBtn.className = "sta2e-minor-btn";
                subBtn.dataset.minorKey = subKey;
                subBtn.style.cssText = _subBtnCss;
                subBtn.textContent = subLabel;
                tsRow.appendChild(subBtn);
              }
              const sysPicker = document.createElement("div");
              sysPicker.id = "sta2e-ts-sys-picker";
              sysPicker.style.cssText = `display:none;grid-template-columns:1fr 1fr 1fr;gap:3px;margin-top:2px;margin-bottom:3px;`;
              for (const s of ["communications", "computers", "engines", "sensors", "structure", "weapons"]) {
                const sysBtn = document.createElement("button");
                sysBtn.type = "button";
                sysBtn.className = "sta2e-minor-btn";
                sysBtn.dataset.minorKey = `ts-system-${s}`;
                sysBtn.style.cssText = _subBtnCss;
                sysBtn.textContent = _systemLabel(s);
                sysPicker.appendChild(sysBtn);
              }
              const rndBtn = document.createElement("button");
              rndBtn.type = "button";
              rndBtn.className = "sta2e-minor-btn";
              rndBtn.dataset.minorKey = "ts-system-random";
              rndBtn.style.cssText = _subBtnCss + "grid-column:1/-1;";
              rndBtn.textContent = "Roll Randomly";
              sysPicker.appendChild(rndBtn);
              btn.insertAdjacentElement("afterend", sysPicker);
              btn.insertAdjacentElement("afterend", tsRow);
            } else if (!newState) {
              existingTsRow?.remove();
              existingTsSys?.remove();
            }

          } else if (minorKey === "prepare" && state.combatTaskContext.applyPrepare) {
            await state.combatTaskContext.applyPrepare(shipActor, shipToken);
            // Refresh the sub-label via the getMinorStates callback if provided
            const refreshed = state.combatTaskContext.getMinorActionStates?.();
            if (refreshed) {
              const subLabel = btn.querySelector("span:last-child");
              if (subLabel) subLabel.textContent =
                `${refreshed.weaponsArmed ? "Armed" : "Unarmed"} · ${refreshed.shieldsLowered ? "Shields ↓" : "Shields ↑"}`;
            }

          } else if (minorKey === "impulse" && state.combatTaskContext.applyImpulse) {
            await state.combatTaskContext.applyImpulse(shipActor, shipToken);

          } else if (minorKey === "thrusters" && state.combatTaskContext.applyThrusters) {
            await state.combatTaskContext.applyThrusters(shipActor, shipToken);

          } else if (minorKey === "calibrate-sensors" && state.combatTaskContext.applyCalibrateSensors) {
            const newState = await state.combatTaskContext.applyCalibrateSensors(shipActor, shipToken);
            const statusEl = btn.querySelector(".sta2e-minor-status");
            if (statusEl) {
              statusEl.textContent = newState ? "● ON" : "○ OFF";
              statusEl.style.color = newState ? LC.green : LC.textDim;
            }
            // Keep in-memory cache in sync so task button handler reads correct value
            if (state.combatTaskContext.sensorMinorStates) {
              state.combatTaskContext.sensorMinorStates.calibrateSensors = newState;
            }
            // Dynamically show or hide the benefit sub-button row
            const existingRow = el.querySelector("#sta2e-cs-benefit-row");
            if (newState && !existingRow) {
              const csRow = document.createElement("div");
              csRow.id = "sta2e-cs-benefit-row";
              csRow.style.cssText = `display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:-1px;margin-bottom:3px;`;
              for (const [subKey, subLabel] of [["cs-reroll", "↺ Reroll d20"], ["cs-ignore-trait", "⊘ Ignore Trait"]]) {
                const subBtn = document.createElement("button");
                subBtn.type = "button";
                subBtn.style.cssText = `padding:3px 5px;background:rgba(255,153,0,0.04);
                  border:1px solid ${LC.borderDim};border-radius:2px;
                  color:${LC.secondary};font-size:8px;font-weight:700;
                  font-family:${LC.font};letter-spacing:0.05em;
                  text-transform:uppercase;cursor:pointer;`;
                subBtn.textContent = subLabel;
                subBtn.addEventListener("click", async () => {
                  if (!state.combatTaskContext.consumeCalibrateSensors) return;
                  const _sid = state.combatTaskContext.combatShip?.actorId;
                  const _actor = game.actors?.get(_sid);
                  const _token = canvas.tokens?.placeables.find(t => t.actor?.id === _sid) ?? null;
                  const _ben = subKey === "cs-reroll" ? "reroll" : "ignore-trait";
                  await state.combatTaskContext.consumeCalibrateSensors(_actor, _token, _ben);
                  if (_ben === "reroll") {
                    state.hasCalibratesensors = true;
                    state.csRerollUsed = false;
                  } else {
                    if (state.combatTaskContext.sensorMinorStates) {
                      state.combatTaskContext.sensorMinorStates.calibrateSensors = false;
                    }
                    const _csBtn = el.querySelector(`[data-minor-key="calibrate-sensors"]`);
                    const _csSt = _csBtn?.querySelector(".sta2e-minor-status");
                    if (_csSt) { _csSt.textContent = "○ OFF"; _csSt.style.color = LC.textDim; }
                    csRow.remove();
                  }
                  csRow.querySelectorAll("button")
                    .forEach(b => { b.disabled = true; b.style.opacity = "0.35"; b.style.cursor = "default"; });
                });
                csRow.appendChild(subBtn);
              }
              btn.insertAdjacentElement("afterend", csRow);
            } else if (!newState && existingRow) {
              existingRow.remove();
            }

          } else if (minorKey === "launch-probe" && state.combatTaskContext.applyLaunchProbe) {
            await state.combatTaskContext.applyLaunchProbe(shipActor, shipToken);

          } else if (minorKey === "cloak-deactivate" && state.combatTaskContext.applyCloakDeactivate) {
            // Minor action — instant deactivation, no roll needed
            await state.combatTaskContext.applyCloakDeactivate(shipActor, shipToken);
            // Update the button in-place to show the inactive activation task button
            state.combatTaskContext.cloakingDeviceActive = false;
            const statusEl = btn.querySelector(".sta2e-cloak-status");
            if (statusEl) { statusEl.textContent = "👁 INACTIVE"; statusEl.style.color = LC.textDim; }
            btn.dataset.minorKey = "";       // prevent re-firing
            btn.style.borderColor = LC.borderDim;
            btn.style.background = "transparent";
            btn.style.color = LC.text;
            btn.querySelector("span:first-child").textContent = "👁 Cloaking Device";

          } else if ((minorKey === "cs-reroll" || minorKey === "cs-ignore-trait")
            && state.combatTaskContext.consumeCalibrateSensors) {
            const benefit = minorKey === "cs-reroll" ? "reroll" : "ignore-trait";
            await state.combatTaskContext.consumeCalibrateSensors(shipActor, shipToken, benefit);
            if (benefit === "reroll") {
              // CS flag stays ON — roller reads it when a task button is clicked.
              // Pre-arm the reroll in case a task was already selected.
              state.hasCalibratesensors = true;
              state.csRerollUsed = false;
            } else {
              // Ignore-trait: flag was cleared — update cache and CS button indicator.
              if (state.combatTaskContext.sensorMinorStates) {
                state.combatTaskContext.sensorMinorStates.calibrateSensors = false;
              }
              const csBtn = el.querySelector(`[data-minor-key="calibrate-sensors"]`);
              const csStatusEl = csBtn?.querySelector(".sta2e-minor-status");
              if (csStatusEl) {
                csStatusEl.textContent = "○ OFF";
                csStatusEl.style.color = LC.textDim;
              }
              el.querySelector("#sta2e-cs-benefit-row")?.remove();
            }
            // Disable both sub-buttons — benefit choice has been declared
            el.querySelectorAll(`[data-minor-key="cs-reroll"],[data-minor-key="cs-ignore-trait"]`)
              .forEach(b => { b.disabled = true; b.style.opacity = "0.35"; b.style.cursor = "default"; });

          } else if (minorKey === "ts-pick-system") {
            // Toggle the system picker grid visibility
            const _sysPicker = el.querySelector("#sta2e-ts-sys-picker");
            if (_sysPicker) _sysPicker.style.display = _sysPicker.style.display === "none" ? "grid" : "none";

          } else if ((minorKey === "ts-reroll" || minorKey.startsWith("ts-system-"))
            && state.combatTaskContext.consumeTargetingSolution) {
            const _sysk = minorKey.startsWith("ts-system-")
              ? (minorKey === "ts-system-random" ? null : minorKey.slice("ts-system-".length))
              : null;
            const _ben = minorKey === "ts-reroll" ? "reroll" : "system";
            await state.combatTaskContext.consumeTargetingSolution(shipActor, shipToken, _ben, _sysk);
            state.hasTargetingSolution = true;
            state.tsChoice = _ben;
            state.tsSystem = _sysk;
            // Sync form elements so _readSetupInputs picks up the right values
            const _tsCb = el.querySelector("#targeting-solution");
            const _tsBenefitSect = el.querySelector("#ts-benefit-section");
            const _rerollRb = el.querySelector("#ts-benefit-reroll");
            const _sysRb = el.querySelector("#ts-benefit-system");
            const _formSysPicker = el.querySelector("#ts-system-picker");
            if (_tsCb) _tsCb.checked = true;
            if (_tsBenefitSect) _tsBenefitSect.style.display = "flex";
            if (_rerollRb) _rerollRb.checked = _ben !== "system";
            if (_sysRb) _sysRb.checked = _ben === "system";
            if (_formSysPicker) _formSysPicker.style.display = _ben === "system" ? "grid" : "none";
            // Disable benefit choice buttons — declared for this attack
            el.querySelectorAll(`[data-minor-key="ts-reroll"],[data-minor-key="ts-pick-system"]`)
              .forEach(b => { b.disabled = true; b.style.opacity = "0.35"; b.style.cursor = "default"; });
            el.querySelectorAll("#sta2e-ts-sys-picker button")
              .forEach(b => { b.disabled = true; b.style.opacity = "0.35"; b.style.cursor = "default"; });
          }
        });
      });

      // Weapon fire buttons — update roller fields in-place (do not close/reopen)
      el.querySelectorAll(".sta2e-weapon-fire-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const weaponId = btn.dataset.weaponId;
          const shipActorId = state.combatTaskContext.combatShip.actorId;
          const shipActor = game.actors.get(shipActorId);
          const weapon = shipActor?.items.get(weaponId);
          if (!weapon) {
            ui.notifications.warn("STA2e Toolkit: Weapon not found.");
            return;
          }

          // Highlight this weapon button; clear other task/weapon selections
          el.querySelectorAll(".sta2e-task-btn, .sta2e-weapon-fire-btn").forEach(b => {
            b.style.background = "transparent";
            b.style.borderColor = LC.borderDim;
          });
          btn.style.background = "rgba(255,153,0,0.12)";
          btn.style.borderColor = LC.primary;

          // Build and store weapon context (includes weaponId + shipActorId for resolve path)
          const buildCtx = state.combatTaskContext.buildWeaponContext;
          if (buildCtx) {
            state.weaponContext = {
              ...buildCtx(weapon),
              weaponId: weapon.id,
              shipActorId: shipActorId,
            };
          }

          // Set tactical flags from the ship (not the character token)
          state.hasRapidFireTorpedo = state.combatTaskContext.shipHasRapidFireTorpedo ?? false;
          state.hasCalibrateWeapons = state.combatTaskContext.tacticalMinorStates?.calibrateWeapons ?? false;
          const shipTokenEl = canvas.tokens?.placeables.find(t => t.actor?.id === shipActorId) ?? null;
          state._tokenDoc = shipTokenEl?.document ?? shipTokenEl ?? null;

          // Re-detect talent rerolls for security discipline (Cautious/Bold security, Precision Targeting)
          const _weaponOfficerActor = state.officer?.id ? game.actors.get(state.officer.id) : null;
          if (_weaponOfficerActor) {
            const tr = detectTalentReroll(_weaponOfficerActor, "security");
            if (!tr.hasReroll) {
              const pt = _weaponOfficerActor.items
                .find(i => i.name.toLowerCase().includes("precision targeting"));
              if (pt) { tr.hasReroll = true; tr.source = pt.name; }
            }
            state.hasTalentReroll = tr.hasReroll;
            state.talentRerollSource = tr.source;
            state.talentRerollUsed = false;
          }

          // Update attr/disc hidden inputs, display divs, and target/focus totals
          const attr = "control";
          const disc = "security";
          const attrHidden = el.querySelector("#officer-attr");
          const discHidden = el.querySelector("#officer-disc");
          const attrDisp = el.querySelector("#officer-attr-display");
          const discDisp = el.querySelector("#officer-disc-display");
          const targetDisp = el.querySelector("#crew-target-display");
          const focusDisp = el.querySelector("#crew-focus-display");

          if (attrHidden) attrHidden.value = attr;
          if (discHidden) discHidden.value = disc;
          if (attrDisp && state.officer) {
            const av = state.officer.attributes[attr] ?? 0;
            attrDisp.textContent = `${ATTR_LABELS[attr] ?? attr} (${av})`;
          }
          if (discDisp && state.officer) {
            const dv = state.officer.disciplines[disc] ?? 0;
            discDisp.textContent = `${DISC_LABELS[disc] ?? disc} (${dv})`;
          }
          if (targetDisp && state.officer) {
            const av = state.officer.attributes[attr] ?? 0;
            const dv = state.officer.disciplines[disc] ?? 0;
            targetDisp.textContent = av + dv;
            if (focusDisp) focusDisp.textContent = `1\u2013${dv}`;
          }
          // Non-sheetMode selects
          const attrSel = el.querySelector("select#officer-attr");
          const discSel = el.querySelector("select#officer-disc");
          if (attrSel) { attrSel.value = attr; attrSel.dispatchEvent(new Event("change")); }
          if (discSel) { discSel.value = disc; discSel.dispatchEvent(new Event("change")); }

          // Difficulty: energy weapons = 2, torpedoes = 3; +1 for override (non-tactical station)
          // When an opposed task is active the difficulty is locked — never override it.
          const _isTorpedo = state.weaponContext?.isTorpedo ?? (btn.dataset.isTorpedo === "1");
          const _isOverride = btn.dataset.isOverride === "1";
          const diffInput = el.querySelector("#difficulty");
          if (diffInput) {
            if (state.opposedDefenseType && state.opposedDifficulty !== null) {
              diffInput.value = state.opposedDifficulty;
            } else {
              diffInput.value = (_isTorpedo ? 3 : 2) + (_isOverride ? 1 : 0);
            }
          }

          // Enable ship assist and select the combat ship (repopulates sys/dept selects)
          const shipSelector = el.querySelector("#sheet-ship-select");
          const shipAssistCb = el.querySelector("#ship-assist");
          if (shipSelector) {
            const matchOpt = Array.from(shipSelector.options)
              .find(o => o.dataset.actorId === shipActorId);
            if (matchOpt && shipSelector.value !== matchOpt.value) {
              shipSelector.value = matchOpt.value;
              shipSelector.dispatchEvent(new Event("change"));
            }
          } else if (shipAssistCb && !shipAssistCb.checked) {
            shipAssistCb.checked = true;
            shipAssistCb.dispatchEvent(new Event("change"));
          }

          // Set ship system = weapons, dept = security (after ship repopulates selects)
          if (sysSelect) { sysSelect.value = "weapons"; sysSelect.dispatchEvent(new Event("change")); }
          if (deptSelect) { deptSelect.value = "security"; deptSelect.dispatchEvent(new Event("change")); }

          // Always show the target dropdown for weapon attacks
          const targetBox = el.querySelector("#sta2e-ctp-target");
          if (targetBox) targetBox.style.display = "block";

          // Apply any already-selected target to canvas
          const targetDropdownEl = el.querySelector("#sta2e-ctp-target-select");
          const dropdownTargetId = state.selectedTargetId ?? null;
          let targetTokenId = null;
          if (dropdownTargetId && targetDropdownEl) {
            const opt = Array.from(targetDropdownEl.options)
              .find(o => o.value === dropdownTargetId);
            targetTokenId = opt?.dataset?.tokenId || null;
          }
          if (!targetTokenId) {
            targetTokenId = Array.from(game.user.targets ?? [])[0]?.id ?? null;
          }
          if (targetTokenId) {
            canvas.tokens?.get(targetTokenId)?.setTarget(true, { user: game.user, releaseOthers: true });
          }

          // ── Salvo mode toggle (Area / Spread) for beam arrays and torpedo salvos ──
          const _needsSalvoMode = state.weaponContext?.isArray || state.weaponContext?.isSalvo;
          let salvoRow = el.querySelector("#sta2e-salvo-mode-row");
          if (_needsSalvoMode) {
            // Default to "area" if not yet set
            if (!state.weaponContext.salvoMode) state.weaponContext.salvoMode = "area";

            // Create the row if not present yet; otherwise reuse it
            if (!salvoRow) {
              salvoRow = document.createElement("div");
              salvoRow.id = "sta2e-salvo-mode-row";
              salvoRow.style.cssText =
                "display:flex;gap:4px;padding:4px 0 0;margin:0;";

              // Insert after the target box (or just append to a sensible container)
              const targetBox2 = el.querySelector("#sta2e-ctp-target");
              if (targetBox2?.parentNode) {
                targetBox2.parentNode.insertBefore(salvoRow, targetBox2.nextSibling);
              } else {
                el.appendChild(salvoRow);
              }
            }

            // Render (or re-render) the two toggle buttons
            const font = typeof LC !== "undefined" ? LC.font : "var(--font-primary)";
            const primary = typeof LC !== "undefined" ? LC.primary : "#ff9900";
            const secondary = typeof LC !== "undefined" ? LC.secondary : "#cc88ff";
            const textDim = typeof LC !== "undefined" ? LC.textDim : "#888";
            const borderDim = typeof LC !== "undefined" ? LC.borderDim : "#333";

            const renderSalvoButtons = () => {
              salvoRow.innerHTML = "";
              const modeLabel = state.weaponContext.isArray ? "Arrays" : "Torpedo Salvo";
              [
                { mode: "area", label: "AREA", color: primary, bg: "rgba(255,153,0,0.18)" },
                { mode: "spread", label: "SPREAD", color: secondary, bg: "rgba(180,100,255,0.2)" },
              ].forEach(({ mode, label, color, bg }) => {
                const active = state.weaponContext.salvoMode === mode;
                const b = document.createElement("button");
                b.type = "button";
                b.style.cssText = [
                  "flex:1;padding:3px 4px;border-radius:2px;font-size:9px;font-weight:700;",
                  `font-family:${font};letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;`,
                  `border:1px solid ${active ? color : borderDim};`,
                  `background:${active ? bg : "rgba(0,0,0,0.2)"};`,
                  `color:${active ? color : textDim};`,
                ].join("");
                b.textContent = (active ? "◈ " : "◇ ") + label;
                b.title = mode === "area"
                  ? `${modeLabel} — Area: primary target hit; same damage can be applied to additional nearby ships after the roll (1 momentum / 1 threat each)`
                  : `${modeLabel} — Spread: reduces Devastating Attack cost from 2 → 1 momentum`;
                b.addEventListener("click", () => {
                  state.weaponContext.salvoMode = mode;
                  renderSalvoButtons();
                });
                salvoRow.appendChild(b);
              });
            };
            renderSalvoButtons();
          } else {
            // Not a salvo/array weapon — hide the row if it exists
            if (salvoRow) salvoRow.style.display = "none";
          }

          // ── Opposed-task detection + "Request Defense Roll" button ──────
          // Synchronously check whether the selected/targeted ship has an
          // active defense (Evasive Action, Defensive Fire, or Cover).
          // If so, inject a dedicated "Request Defense Roll" button into the
          // side panel and disable the dialog's Roll button.  The request
          // button is a plain DOM button — fully under our control — so there
          // is no race with DialogV2's button handling.
          (() => {
            // Resolve target canvas token — prefer dropdown selection,
            // fall back to Foundry's current user targets.
            let defTargetToken = null;
            const _tgtActorId = state.selectedTargetId ?? null;
            if (_tgtActorId) {
              defTargetToken = canvas.tokens?.placeables
                .find(t => t.actor?.id === _tgtActorId) ?? null;
            }
            if (!defTargetToken) {
              defTargetToken = Array.from(game.user.targets ?? [])[0] ?? null;
            }

            // Read defence flags directly — synchronous, no async needed.
            let defMode = null;
            if (defTargetToken) {
              defMode = defTargetToken.document?.getFlag(MODULE, "defenseMode") ?? null;
              if (!defMode && defTargetToken.document?.getFlag(MODULE, "coverActive")) {
                defMode = "cover";
              }
            }

            // Store on state so other handlers can check it cheaply.
            state._opposedTaskPending = defMode ?? null;

            const defLabel = defMode === "evasive-action" ? "Evasive Action"
              : defMode === "defensive-fire" ? "Defensive Fire"
              : defMode === "cover" ? "Cover"
              : null;
            const defIcon = defMode === "evasive-action" ? "↗️"
              : defMode === "defensive-fire" ? "🛡️"
              : defMode === "cover" ? "🪨"
              : null;

            // Locate the side panel and the dialog Roll button
            const panelEl = el.querySelector("#sta2e-combat-task-panel");
            const rollBtn = el.closest(".app, [data-appid]")
              ?.querySelector?.('[data-action="roll"]')
              ?? el.querySelector('[data-action="roll"]');

            // Remove any previously-injected request button
            el.querySelector("#sta2e-request-defense-btn")?.remove();

            if (defLabel && panelEl) {
              // Disable the Roll button — attacker must not roll yet
              if (rollBtn) {
                rollBtn.disabled = true;
                rollBtn.style.opacity = "0.4";
                rollBtn.style.cursor  = "not-allowed";
              }

              // Build and inject the "Request Defense Roll" button into the panel
              const reqBtn = document.createElement("button");
              reqBtn.id   = "sta2e-request-defense-btn";
              reqBtn.type = "button";
              reqBtn.style.cssText = [
                "width:100%;margin-top:6px;padding:6px 8px;",
                `background:rgba(255,153,0,0.12);`,
                `border:1px solid ${LC.primary};border-radius:2px;`,
                `color:${LC.primary};font-family:${LC.font};`,
                "font-size:10px;font-weight:700;letter-spacing:0.06em;",
                "text-transform:uppercase;cursor:pointer;",
              ].join("");
              reqBtn.innerHTML =
                `${defIcon} Request Defense Roll — ${defLabel}`;

              // Click: sync DOM → state so ship/system/dept selections are
              // captured, then post the defense chat card + store pending task.
              reqBtn.addEventListener("click", async () => {
                reqBtn.disabled      = true;
                reqBtn.textContent   = "⏳ Waiting for defender…";
                reqBtn.style.opacity = "0.6";
                // Pull current form values into state before snapshotting —
                // this captures the ship assist checkbox, system, and dept
                // dropdowns the player has selected.
                _readSetupInputs(state, el, _shipDataRef.systems, _shipDataRef.depts);
                await checkOpposedTaskForTokens_postCard(defMode, state, token, actor);
                // Close the dialog — roller reopens when the defender confirms
                try { dialog?.close({ force: true }); } catch { }
              });

              panelEl.appendChild(reqBtn);

            } else {
              // No active defense — re-enable the Roll button
              if (rollBtn) {
                rollBtn.disabled = false;
                rollBtn.style.opacity = "";
                rollBtn.style.cursor  = "";
              }
            }
          })();
        });
      });
    }
  }, 50);
}

// ── Targeting Solution die reroll wiring ──────────────────────────────────────
// Only active when hasTargetingSolution is true and the one free reroll hasn't
// been used yet. Per STA 2e rules, Targeting Solution grants ONE free reroll
// of any single die — this is the only legitimate per-die reroll in the system.

function _wireDiePips(state, dialog, openDialog) {
  setTimeout(() => {
    const el = dialog.element ?? document.querySelector(".app.dialog-v2");
    if (!el) return;

    // ── Arm button toggle — each button sets/clears state.activeRerollAbility ──
    el.querySelectorAll(".reroll-arm-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const ability = btn.dataset.ability;
        // Toggle: clicking the active button again disarms it
        state.activeRerollAbility = state.activeRerollAbility === ability ? null : ability;
        openDialog();
      });
    });

    el.querySelectorAll(".sta2e-die-pip").forEach(pip => {
      pip.addEventListener("click", async () => {
        const poolKey = pip.dataset.pool;
        const idx = parseInt(pip.dataset.index);

        // Crew die — TS / CS (direct click), or armed talent/ability button
        if (poolKey === "crew") {
          // Panel-based ability (detReroll) blocks pip clicks while armed
          if (state.activeRerollAbility === "detReroll") return;

          const tsReady = state.hasTargetingSolution && state.tsChoice !== "system" && !state.tsRerollUsed;
          const csReady = state.hasCalibratesensors && !state.csRerollUsed;
          const aimReady = (state.aimRerolls ?? 0) > (state.aimRerollsUsed ?? 0);
          const armed = state.activeRerollAbility; // "talent"|"advisor"|"system"|"shipTalent" or null
          if (!tsReady && !csReady && !aimReady && !armed) return;

          const [newDie] = rollPool(1, state.crewTarget, state.compThresh ?? 20, state.crewCritThresh);
          state.crewDice[idx] = newDie;

          if (tsReady) {
            state.tsRerollUsed = true;
          } else if (csReady) {
            state.csRerollUsed = true;
          } else if (aimReady) {
            state.aimRerollsUsed = (state.aimRerollsUsed ?? 0) + 1;
          } else {
            // Consume the armed talent reroll
            const usedKey = {
              talent: "talentRerollUsed",
              advisor: "advisorRerollUsed",
              system: "systemRerollUsed",
              shipTalent: "shipTalentRerollUsed",
              genericReroll: "genericRerollUsed"
            }[armed];
            if (usedKey) state[usedKey] = true;
            state.activeRerollAbility = null;
          }

          await dsnShowPool([newDie]);
          openDialog();
          return;
        }

        // Ship die — Rapid-Fire Torpedo Launcher reroll (one use)
        if (poolKey === "ship") {
          if (!state.hasRapidFireTorpedo || state.rfRerollUsed) return;
          const [newDie] = rollPool(1, state.shipTarget, state.compThresh ?? 20, state.shipCritThresh);
          state.shipDice[idx] = newDie;
          state.rfRerollUsed = true;
          await dsnShowPool([newDie]);
          openDialog();
          return;
        }
      });
    });

    // ── Chief of Staff — named assist die pip rerolls ─────────────────────────
    // Active when hasChiefOfStaff is true (Medicine station) and at least one assist
    // die has not yet been rerolled. Each named assist die pip is independently clickable.
    el.querySelectorAll(".sta2e-die-pip[data-pool='named-assist']").forEach(pip => {
      pip.addEventListener("click", async () => {
        const idx = parseInt(pip.dataset.index);
        if (!state.hasChiefOfStaff || state.assistRerollsUsed[idx]) return;

        const ao = state.assistOfficers?.[idx];
        const aoAttr = ao?.stats ? (ao.stats.attributes[ao.attrKey] ?? 9) : 9;
        const aoDisc = ao?.stats ? (ao.stats.disciplines[ao.discKey] ?? 2) : 2;
        const aoTgt = ao?.stats ? aoAttr + aoDisc : state.crewTarget;
        let aoCrit = 1;
        if (ao?.hasDedicatedFocus) aoCrit = Math.min(20, Math.max(1, aoDisc * 2));
        else if (ao?.hasFocus) aoCrit = Math.max(1, aoDisc);

        const [newDie] = rollPool(1, aoTgt, state.compThresh ?? 20, aoCrit);
        state.namedAssistDice[idx] = newDie;
        state.assistRerollsUsed[idx] = true;

        await dsnShowPool([newDie]);
        openDialog();
      });
    });

    // ── Technical Expertise — one die from either crew or ship pool ───────────
    // Post-roll radio-button panel. GM selects one die then clicks "Reroll Selected Die".
    if (state.hasTechExpertise && !state.techExpertiseUsed) {
      const teBtn = el.querySelector("#te-reroll-btn");
      const teRbs = el.querySelectorAll(".te-die-rb");
      if (teBtn && teRbs.length) {
        teRbs.forEach(rb => rb.addEventListener("change", () => {
          teBtn.disabled = false;
          teBtn.style.opacity = "1";
          teBtn.style.cursor = "pointer";
        }));
        teBtn.addEventListener("click", async () => {
          const selected = el.querySelector(".te-die-rb:checked");
          if (!selected) return;
          const [pool, idxStr] = selected.value.split(":");
          const idx = parseInt(idxStr);

          if (pool === "crew") {
            const [nd] = rollPool(1, state.crewTarget, state.compThresh ?? 20, state.crewCritThresh);
            state.crewDice[idx] = nd;
            await dsnShowPool([nd]);
          } else {
            const [nd] = rollPool(1, state.shipTarget, state.compThresh ?? 20, state.shipCritThresh);
            state.shipDice[idx] = nd;
            await dsnShowPool([nd]);
          }
          state.techExpertiseUsed = true;
          openDialog();
        });
      }
    }

    // ── Determination Reroll panel ────────────────────────────────────────────
    // Shows when detReroll is armed — GM selects dice via checkboxes, then confirms.
    if (state.activeRerollAbility === "detReroll" && !state.detRerollUsed) {
      const detBtn = el.querySelector("#det-reroll-btn");
      const detCheckboxes = el.querySelectorAll(".det-die-cb");

      if (detBtn && detCheckboxes.length) {
        const updateBtn = () => {
          const n = Array.from(detCheckboxes).filter(c => c.checked).length;
          detBtn.textContent = `🔄 Reroll Selected (${n})`;
          detBtn.disabled = n === 0;
          detBtn.style.opacity = n > 0 ? "1" : "0.4";
          detBtn.style.cursor = n > 0 ? "pointer" : "default";
        };
        detCheckboxes.forEach(cb => cb.addEventListener("change", updateBtn));

        detBtn.addEventListener("click", async () => {
          const selected = Array.from(detCheckboxes)
            .filter(c => c.checked)
            .map(c => parseInt(c.value));
          if (!selected.length) return;

          const newDice = selected.map(() =>
            rollPool(1, state.crewTarget, state.compThresh ?? 20, state.crewCritThresh)[0]
          );
          selected.forEach((dieIdx, i) => { state.crewDice[dieIdx] = newDice[i]; });
          state.detRerollUsed = true;
          state.activeRerollAbility = null;

          await dsnShowPool(newDice);
          openDialog();
        });
      }
    }
  }, 80);
}

// ─────────────────────────────────────────────────────────────────────────────
// Player Roller — thin wrapper around openNpcRoller for player-ship task rolls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open the dice roller for a player-ship task roll.
 * Identical to openNpcRoller but suppresses NPC-crew concepts:
 *   • No generic crew-assist checkbox (PC assists come through Named Assist Officers)
 *   • crewQuality forced to null (officer is always set — the PC at the station)
 * All other features — talent detection, Available Rerolls panel, ship assist die,
 * Attack Pattern, TE panel, etc. — work exactly the same as for NPC ships.
 * @param {Actor}  actor   The ship actor (systems, breach data, etc.).
 * @param {Token}  token   Canvas token.
 * @param {object} options Same options as openNpcRoller; officer = PC at the station.
 */
export async function openPlayerRoller(actor, token, options = {}) {
  // Ground NPCs route through openPlayerRoller but must not use playerMode
  // (playerMode gives momentum access; ground NPCs spend Threat, not Momentum).
  const isGroundNpc = options.groundIsNpc ?? false;
  return openNpcRoller(actor, token, {
    ...options,
    playerMode: !isGroundNpc,
    crewQuality: null,   // no NPC crew quality on a player ship
  });
}


