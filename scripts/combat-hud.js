/**
 * sta2e-toolkit | combat-hud.js
 * Quick Action Combat HUD — draggable floating widget.
 *
 * Opens automatically when a token is controlled during active combat.
 * Also available via right-click token context menu at any time.
 *
 * Layout:
 *   ┌─────────────────────────────────────┐
 *   │ [Token Name]  [Shields: x/y]  [📌][×]│  drag handle
 *   ├─────────────────────────────────────┤
 *   │ WEAPONS                             │
 *   │ [img] [img] [img] ...               │  from actor items
 *   ├─────────────────────────────────────┤
 *   │ [HIT]  [MISS]  (after weapon click) │
 *   ├─────────────────────────────────────┤
 *   │ QUICK ACTIONS                       │
 *   │ [Scan] [Atk Pattern]                │
 *   │ [Evasive] [Def Fire]                │
 *   │ [🔴 RAM]                            │
 *   ├─────────────────────────────────────┤
 *   │ STATUS                              │
 *   │ 🔍 ↗️ ⚡ ❌ 💀                       │
 *   └─────────────────────────────────────┘
 */

import {
  getWeaponConfig,
  buildWeaponContext,
  fireWeapon,
  fireRam,
  fireScanForWeakness,
  fireAttackPattern,
  fireDefenseMode,
  fireTargetingSolution,
  STARSHIP_WEAPON_CONFIGS,
} from "./weapon-configs.js";

import {
  openNpcRoller, openPlayerRoller,
  PlayerRollCallbacks, rollPool, clearStationAssistFlag, buildPlayerRollCardHtml,
  diePipHtml, dsnShowPool,
} from "./npc-roller.js";
import {
  STATION_SLOTS,
  getCrewManifest,
  getStationOfficers,
  readOfficerStats,
  openCrewManifest,
  OFFICER_ATTRIBUTES,
  OFFICER_DISCIPLINES,
} from "./crew-manifest.js";
import { getLcTokens }  from "./lcars-theme.js";

import {
  COMBAT_CONDITIONS,
  doc,
  hasCondition,
  addCondition,
  removeCondition,
  toggleCondition,
  getDefenseMode,
  getConditions,
  getCollisionDamage,
} from "./token-conditions.js";
import { getSceneZones, getZonePathWithCosts } from "./zone-data.js";

const MODULE      = "sta2e-toolkit";
const HUD_ID      = "sta2e-combat-hud";
const POS_KEY     = `${MODULE}-combat-hud-pos`;
const PINNED_KEY  = `${MODULE}-combat-hud-pinned`;

// ── LCARS Design Tokens — resolved from active campaign theme at render time ──
// Call LC() anywhere a token is needed; always reflects the current theme.
const LC = new Proxy({}, {
  get(_, prop) { return getLcTokens()[prop]; },
});

// Helper: extract R/G/B channel from a 6-digit hex color string (e.g. "#ff3333")
function _hexR(hex) { return parseInt(hex.slice(1,3),16); }
function _hexG(hex) { return parseInt(hex.slice(3,5),16); }
function _hexB(hex) { return parseInt(hex.slice(5,7),16); }

// Helper: LCARS section header bar
function lcarsSection(title) {
  const el = document.createElement("div");
  el.style.cssText = `
    background: ${LC.primary};
    color: ${LC.bg};
    font-family: ${LC.font};
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 2px 10px;
    border-radius: 0;
  `;
  el.textContent = title;
  return el;
}

// Helper: LCARS-styled chat card wrapper HTML
function lcarsCard(headerLabel, headerColor, bodyHtml) {
  return `
    <div style="
      background: ${LC.bg};
      border: 1px solid ${headerColor ?? LC.primary};
      border-left: 4px solid ${headerColor ?? LC.primary};
      border-radius: 3px;
      font-family: ${LC.font};
      color: ${LC.text};
      overflow: hidden;
    ">
      <div style="
        background: ${headerColor ?? LC.primary};
        color: ${LC.bg};
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        padding: 2px 8px;
      ">${headerLabel}</div>
      <div style="padding: 8px 10px;">
        ${bodyHtml}
      </div>
    </div>`;
}

/**
 * Generate the LCARS-styled "Add to Pool" button HTML for a result card.
 * @param {"momentum"|"threat"} pool
 * @param {number} amount   - Must be > 0 or returns "".
 * @param {string} tokenId  - Canvas token id for the overflow speaker.
 */
function poolButtonHtml(pool, amount, tokenId = "") {
  if (!amount || amount <= 0) return "";
  const isMomentum = pool === "momentum";
  const color  = isMomentum ? LC.secondary : LC.primary;
  const label  = isMomentum ? `+${amount} Momentum → Pool` : `+${amount} Threat → Pool`;
  const icon   = isMomentum ? "💫" : "⚡";
  // Negative margins break out of lcarsCard's 8px 10px body padding so the button
  // sits flush against the card edges with its own border-top separator.
  return `
    <div style="margin:6px -10px -8px;padding:4px 8px 6px;border-top:1px solid ${LC.borderDim};">
      <button class="sta2e-add-to-pool"
        data-pool="${pool}"
        data-amount="${amount}"
        data-token-id="${tokenId}"
        style="width:100%;padding:5px 8px;background:rgba(0,0,0,0.25);
          border:1px solid ${color};border-radius:2px;cursor:pointer;
          font-family:${LC.font};font-size:10px;font-weight:700;
          color:${color};letter-spacing:0.06em;text-align:center;">
        ${icon} ${label}
      </button>
    </div>`;
}

// Quick action definitions — what each button does
// ── Cloaking Device talent detection ─────────────────────────────────────────
// Checks for any item whose name contains "cloaking device" (case-insensitive).
// STA 2e stores talents as items — type may be "talent", "starshiptalent", or
// "talent2e" depending on system version, so we match by name only.
export function hasCloakingDevice(actor) {
  return actor.items.some(i =>
    i.name.toLowerCase().includes("cloaking device")
  );
}

function hasFastTargetingSystems(actor) {
  if (!actor) return false;
  return actor.items.some(i =>
    i.name.toLowerCase().includes("fast targeting systems")
  );
}

export function hasRapidFireTorpedoLauncher(actor) {
  if (!actor) return false;
  return actor.items.some(i =>
    i.name.toLowerCase().includes("rapid-fire torpedo launcher") ||
    i.name.toLowerCase().includes("rapid fire torpedo launcher")
  );
}

// Attack Run: character talent — when the ship takes Attack Pattern, attacks
// against the ship do NOT reduce Difficulty. Checked on the Helm officer actor.
function hasAttackRun(actor) {
  if (!actor) return false;
  return actor.items.some(i =>
    i.name.toLowerCase().includes("attack run")
  );
}

// Glancing Impact: character talent — when the ship succeeds at Evasive Action,
// the ship gains +2 Resistance until the start of the helm officer's next turn.
function hasGlancingImpact(actor) {
  if (!actor) return false;
  return actor.items.some(i =>
    i.name.toLowerCase().includes("glancing impact")
  );
}

// ── Bridge Station Action Definitions ────────────────────────────────────────
// Each station has minor and major actions drawn from STA 2e Core.
// Actions with a handler key are interactive (toggle conditions, fire FX, etc.).
// Info-only actions (no key) display in the tab for reference.
export const BRIDGE_STATIONS = [
  // ── Command ──────────────────────────────────────────────────────────────
  {
    id:    "command",
    label: "Command",
    icon:  "⭐",
    minor: [],   // No station-specific minor actions listed in Core
    major: [
      {
        key:     "assist-command",
        label:   "Assist",
        tooltip: "Declare which station(s) you are assisting. Command officers may assist TWO stations per major action. You will assist in their next major task.",
      },
      {
        key:     "create-trait",
        label:   "Create Trait",
        tooltip: "Standard Create Trait action (p.289). From Command, typically uses Control, Insight, or Reason + Command — representing battle plans, strategies, and similar.",
      },
      {
        key:     "direct",
        label:   "Direct",
        tooltip: "Commit your major action to direct another crew member. Control + Command — the target station gains an assist die on their next task.",
      },
      {
        key:     "rally",
        label:   "Rally",
        tooltip: "Presence + Command task with Difficulty 0 — specifically to generate Momentum, either to use immediately or to save for the group.",
      },
      {
        key:       "task-roll",
        label:     "Task Roll",
        tooltip:   "Open the Task Roller for this station. If an actor is assigned here, their stats drive the roll — otherwise NPC crew quality is used.",
      },
    ],
  },

  // ── Helm ─────────────────────────────────────────────────────────────────
  {
    id:    "helm",
    label: "Helm",
    icon:  "🎮",
    minor: [
      {
        key:     "impulse",
        label:   "Impulse",
        tooltip: "Using the ship's impulse engines, fly the ship. Move up to 2 zones to anywhere within Long range. If you only move 1 zone, you may reduce the Momentum cost of movement through difficult or hazardous terrain by 1.",
      },
      {
        key:     "thrusters",
        label:   "Thrusters",
        tooltip: "Using maneuvering thrusters, make fine adjustments to the ship's position. Move to anywhere within your current zone, and move safely into Contact with another ship, station, or other object (including docking or landing).",
      },
      {
        key:     "prepare-warp",
        label:   "Prepare (Warp)",
        tooltip: "Conn officer prepares the ship for Warp — a prerequisite before the Warp major action can be taken.",
      },
    ],
    major: [
      {
        key:     "attack-pattern",
        label:   "Attack Pattern",
        tooltip: "Fly steadily to assist targeting. Each time the ship makes an attack before your next turn, you may Assist on that attack using Control + Conn. Until your next turn, all attacks against the ship reduce their Difficulty by 1.",
      },
      {
        key:     "create-trait",
        label:   "Create Trait",
        tooltip: "Standard Create Trait action (p.289). From Helm, often useful for traits that reflect careful positioning or skilled maneuvering.",
      },
      {
        key:     "evasive-action",
        label:   "Evasive Action",
        tooltip: "Maneuver unpredictably. Until your next turn, all attacks against the ship become opposed tasks, opposed by Daring + Conn assisted by Structure + Conn. Win the opposed task: may move 1 zone. Until your next turn, all attacks made by the ship suffer +1 Difficulty. Cannot use if currently benefitting from Defensive Fire (p.305).",
        defenseMode: true,
      },
      {
        key:     "maneuver",
        label:   "Maneuver",
        tooltip: "Control + Conn task, Difficulty 0, assisted by the ship's Engines + Conn. Normally used to generate Momentum for crossing difficult terrain.",
      },
      {
        key:     "ram",
        label:   "Ram",
        tooltip: "Move into Contact with a target at Close range. Attack requiring Daring + Conn, Difficulty 2, assisted by Engines + Conn. Success: inflicts collision damage (see sidebar) on the target with Intense quality — but the ship suffers the target's collision damage in return.",
        needsTarget: true,
        isRam:   true,
      },
      {
        key:     "warp",
        label:   "Warp",
        tooltip: "Requires Reserve Power. Must take a Prepare minor action first. Control + Conn, Difficulty 1, assisted by Engines + Conn. Success: move the ship a number of zones equal to the ship's Engines score, or leave the battlefield entirely. See Going to Warp (p.295).",
      },
      {
        key:     "assist",
        label:   "Assist",
        tooltip: "Declare which station you are assisting. You will assist in their next major task.",
      },
      {
        key:       "task-roll",
        label:     "Task Roll",
        tooltip:   "Open the Task Roller for this station. If an actor is assigned here, their stats drive the roll — otherwise NPC crew quality is used.",
      },
    ],
  },

  // ── Navigator ─────────────────────────────────────────────────────────────
  {
    id:    "navigator",
    label: "Navigator",
    icon:  "🗺️",
    minor: [],   // No station-specific minor actions listed in Core
    major: [
      {
        key:     "assist",
        label:   "Assist",
        tooltip: "Declare which station you are assisting. You will assist in their next major task.",
      },
      {
        key:     "create-trait",
        label:   "Create Trait",
        tooltip: "Standard Create Trait action (p.289). From Navigator, often useful for traits that reflect plotting a careful course or studying the terrain.",
      },
      {
        key:       "task-roll",
        label:     "Task Roll",
        tooltip:   "Open the Task Roller for this station. If an actor is assigned here, their stats drive the roll — otherwise NPC crew quality is used.",
      },
    ],
  },

  // ── Communications ────────────────────────────────────────────────────────
  {
    id:    "comms",
    label: "Comms",
    icon:  "📡",
    minor: [],   // No station-specific minor actions listed in Core
    major: [
      {
        key:     "create-trait",
        label:   "Create Trait",
        tooltip: "Standard Create Trait action (p.289). From Comms, useful for traits that boost/recalibrate communications to pierce interference, encrypt/decrypt messages, or coordinate personnel aboard ship or with other ships.",
      },
      {
        key:     "damage-control",
        label:   "Damage Control",
        tooltip: "Direct a damage control team. Choose a single breach (p.310) and attempt a Presence + Engineering task, Difficulty 2 (+1 per additional degree of Potency). Success: the breach is patched and no longer imposes penalties. The breach itself is NOT fully removed — proper repairs required outside of combat.",
      },
      {
        key:     "transport",
        label:   "Transport",
        tooltip: "Send instructions to a transporter room to beam people or objects to/from the ship or between locations (p.190). Operating from the bridge increases the Difficulty by 1.",
      },
      {
        key:     "assist",
        label:   "Assist",
        tooltip: "Declare which station you are assisting. You will assist in their next major task.",
      },
      {
        key:       "task-roll",
        label:     "Task Roll",
        tooltip:   "Open the Task Roller for this station. If an actor is assigned here, their stats drive the roll — otherwise NPC crew quality is used.",
      },
    ],
  },

  // ── Operations / Engineering ──────────────────────────────────────────────
  {
    id:    "operations",
    label: "Ops/Eng",
    icon:  "⚙️",
    minor: [],   // No station-specific minor actions listed in Core
    major: [
      {
        key:     "create-trait",
        label:   "Create Trait",
        tooltip: "Standard Create Trait action (p.289). From Operations, often useful for traits that reflect modifications to ship systems.",
      },
      {
        key:     "damage-control",
        label:   "Damage Control",
        tooltip: "Choose a single breach and attempt a Presence + Engineering task, Difficulty 2 (+1 per additional degree of Potency). Success: the breach is patched and no longer imposes penalties. The breach will require proper repairs outside of combat.",
      },
      {
        key:     "regain-power",
        label:   "Regain Power",
        tooltip: "Draw energy from another system to replenish Reserve Power. Control + Engineering, Difficulty 1. May Succeed at Cost. Success: restore the ship's Reserve Power for use later this scene. Complications reflect subsystems shutting down. Difficulty increases by 1 each time attempted during a scene.",
      },
      {
        key:     "regen-shields",
        label:   "Regen Shields",
        tooltip: "Requires Reserve Power. Reroute Reserve Power to shield emitters. Control + Engineering, Difficulty 2, assisted by Structure + Engineering. Difficulty +1 if shields are at 0. Success: ship regains shields equal to your Engineering department, +2 more by spending 1 Momentum (Repeatable).",
      },
      {
        key:     "reroute-power",
        label:   "Reroute Power",
        tooltip: "Requires Reserve Power. Reroute Reserve Power to a specific system. The chosen system gains power which will apply to the next action using that system (p.185).",
      },
      {
        key:     "transport",
        label:   "Transport",
        tooltip: "Remotely operate the ship's transporters. Follows the rules for transporters (p.190). Operating from the bridge increases the Difficulty by 1.",
      },
      {
        key:     "assist",
        label:   "Assist",
        tooltip: "Declare which station you are assisting. You will assist in their next major task.",
      },
      {
        key:       "task-roll",
        label:     "Task Roll",
        tooltip:   "Open the Task Roller for this station. If an actor is assigned here, their stats drive the roll — otherwise NPC crew quality is used.",
      },
    ],
  },

  // ── Tactical ──────────────────────────────────────────────────────────────
  {
    id:    "tactical",
    label: "Tactical",
    icon:  "🎯",
    minor: [
      {
        key:                 "calibrate-weapons",
        label:               "Calibrate Weapons",
        tooltip:             "Fine-tune energy weapon frequencies and torpedo yields. On your next attack with the ship's weapons, increase the weapon's damage by 1.",
        isCalibrateWeapons:  true,
      },
      {
        key:     "prepare",
        label:   "Prepare",
        tooltip: "Prepare for a task that requires it, or raise/lower shields, or arm/disarm weapons. Shields: Lowered = max shields 0; Raised = restored to normal max (or previous total if damaged this scene). Weapons: Ship may only make Weapons Attacks if armed. Enemy ships can detect whether weapons are armed.",
      },
      {
        key:     "targeting-solution",
        label:   "Targeting Solution",
        tooltip: "Lock targeting sensors onto a single enemy vessel within Long range. On the next attack against that vessel: either re-roll a d20 on the task, or choose which of the target's systems are hit rather than rolling.",
        isTargetingSolution: true,
      },
    ],
    major: [
      {
        key:     "create-trait",
        label:   "Create Trait",
        tooltip: "Standard Create Trait action (p.289). From Tactical, often useful for traits that reflect modifications to weapon systems or useful targeting data.",
      },
      {
        key:     "defensive-fire",
        label:   "Defensive Fire",
        tooltip: "Choose a single energy weapon. Until your next turn, any enemy attack against the ship becomes an opposed task, opposed by Daring + Security assisted by Weapons + Security. Win: may spend 2 Momentum to counterattack, inflicting weapon's damage against the attacker. Cannot use if currently benefitting from Evasive Action (p.302).",
        defenseMode: true,
      },
      {
        key:     null,
        label:   "Fire",
        tooltip: "Select a single energy weapon or torpedo weapon, choose a target, and make an Attack (p.306). Use the weapon buttons above to fire. If attempting a torpedo attack, add 1 Threat.",
        isInfo:  true,
      },
      {
        key:     "modulate-shields",
        label:   "Modulate Shields",
        tooltip: "Cannot be attempted if shields are at 0. Tune shields to resist enemy attacks. Until your next turn, increase the Resistance of the ship by 2.",
      },
      {
        key:     "tractor-beam",
        label:   "Tractor Beam",
        tooltip: "Engage a tractor beam on a nearby object or vessel. Control + Security, Difficulty 2, assisted by Structure + Security. Target must be within Close range. Success: target vessel is immobilized and cannot move unless it breaks free. Difficulty to break free equals the tractor beam strength of your vessel.",
        needsTarget: true,
      },
      {
        key:     "assist",
        label:   "Assist",
        tooltip: "Declare which station you are assisting. You will assist in their next major task.",
      },
      {
        key:       "task-roll",
        label:     "Task Roll",
        tooltip:   "Open the Task Roller for this station. If an actor is assigned here, their stats drive the roll — otherwise NPC crew quality is used.",
      },
    ],
  },

  // ── Sensor Operations ─────────────────────────────────────────────────────
  {
    id:    "sensors",
    label: "Sensors",
    icon:  "🔬",
    minor: [
      {
        key:                "calibrate-sensors",
        label:              "Calibrate Sensors",
        tooltip:            "Fine-tune the sensors for clearest readings. On your next Sensor Operations action: ignore a single trait affecting the task, OR re-roll 1d20.",
        isCalibratesensors: true,
      },
      {
        key:     "launch-probe",
        label:   "Launch Probe",
        tooltip: "Launch a sensor probe to study a situation or phenomenon from a safe distance. Select a single zone within Long range — the probe flies there. Sensor Operations major actions may determine range from the probe's location rather than the ship. The probe can be targeted as a Small Craft and is destroyed if it takes any damage.",
      },
    ],
    major: [
      {
        key:     "create-trait",
        label:   "Create Trait",
        tooltip: "Standard Create Trait action (p.289). From Sensor Operations, often useful for traits that reflect important information that has been detected or discovered.",
      },
      {
        key:     "reveal",
        label:   "Reveal",
        tooltip: "Scan for trace signals revealing cloaked or concealed vessels. Reason + Science, Difficulty 3, assisted by Sensors + Science. Success: if a hidden vessel is within Long range, reveal which zone it is in. Until it moves, your ship may attack it (Difficulty +2). Only reveals one vessel if multiple are hidden.",
      },
      {
        key:     "scan-for-weakness",
        label:   "Scan for Weakness",
        tooltip: "Scan a single enemy vessel for vulnerabilities. Control + Science, Difficulty 2, assisted by Sensors + Security. Success: the next attack made against that ship increases its damage by 2, or gains the Piercing quality.",
        needsTarget: true,
        flagsTarget: true,
      },
      {
        key:     "sensor-sweep",
        label:   "Sensor Sweep",
        tooltip: "Select a single zone and attempt a Reason + Science task, Difficulty 1, assisted by Sensors + Science. Success: the GM provides basic information on any ships, objects, or phenomena in that zone. Spend Momentum to get extra information as normal.",
      },
      {
        key:     "assist",
        label:   "Assist",
        tooltip: "Declare which station you are assisting. You will assist in their next major task.",
      },
      {
        key:       "task-roll",
        label:     "Task Roll",
        tooltip:   "Open the Task Roller for this station. If an actor is assigned here, their stats drive the roll — otherwise NPC crew quality is used.",
      },
    ],
  },

  // ── Medical ───────────────────────────────────────────────────────────────
  {
    id:    "medical",
    label: "Medical",
    icon:  "⚕️",
    minor: [],   // No station-specific minor actions listed in Core
    major: [
      {
        key:     "create-trait",
        label:   "Create Trait",
        tooltip: "Standard Create Trait action (p.289). From Medical, useful for traits that reflect crew readiness, medical preparedness, or health-related conditions affecting the ship's crew.",
      },
      {
        key:       "task-roll",
        label:     "Task Roll",
        tooltip:   "Open the Task Roller for this station. If an actor is assigned here, their stats drive the roll — otherwise NPC crew quality is used.",
      },
      {
        key:     "assist",
        label:   "Assist",
        tooltip: "Declare which station you are assisting. You will assist in their next major task.",
      },
    ],
  },
];

// Pass, Ready, and Override are available at every station in starship combat.
const COMMON_MAJOR_ACTIONS = [
  {
    key:     "override",
    label:   "Override",
    tooltip: "Operate the controls of another position. Attempt any major action from another station (not Commanding Officer) at +1 Difficulty due to sub-optimal controls.",
  },
  {
    key:     "pass",
    label:   "Pass",
    tooltip: "Do nothing this turn — forfeit your Major Action.",
  },
  {
    key:     "ready",
    label:   "Ready",
    tooltip: "Hold your Major Action to react later in the round. Declare a trigger condition; if it occurs before your next turn you may act immediately.",
  },
];
for (const station of BRIDGE_STATIONS) {
  station.major.push(...COMMON_MAJOR_ACTIONS);
}

// ── Ground Combat Actions ──────────────────────────────────────────────────────
// Minor/major actions for non-starship (character) ground combat.
const GROUND_ACTIONS = {
  minor: [
    {
      key:      "ground-aim",
      label:    "Aim",
      tooltip:  "Spend a Minor Action to Aim. You may re-roll one die on your next attack. If your weapon has the Accurate quality, you may re-roll up to two dice instead.",
      isToggle: true,
    },
    {
      key:      "ground-prepare",
      label:    "Prepare",
      tooltip:  "Spend a Minor Action to Prepare, gaining the benefit for the next task that requires it.",
      isToggle: true,
    },
    {
      key:      "ground-prone",
      label:    "Stand/Drop Prone",
      tooltip:  "Drop Prone or Stand up. While Prone: Ranged Attacks from Medium range+ have +1 Difficulty against you; if in Cover, gain +1 Protection; Melee Attacks at Close range gain 2 bonus Momentum against you; no movement major actions. Cannot Stand and Drop Prone in the same turn.",
      isToggle: true,
    },
    {
      key:     "ground-interact",
      label:   "Interact",
      tooltip: "Interact briefly with a nearby object or the environment.",
    },
  ],
  major: [
    {
      key:     "ground-attack",
      label:   "Attack",
      tooltip: "Make an attack — click a weapon in the list above.",
      isInfo:  true,
    },
    {
      key:     "ground-assist",
      label:   "Assist",
      tooltip: "Assist another character with their next task.",
    },
    {
      key:     "ground-first-aid",
      label:   "First Aid",
      tooltip: "Revive a Defeated character (Diff 2) or treat an Injury (Diff = potency). Daring + Medicine. Treating suppresses the injury penalty in combat; full removal requires out-of-combat rest.",
    },
    {
      key:     "ground-create-advantage",
      label:   "Create Advantage",
      tooltip: "Create a trait describing an advantage in the scene.",
    },
    {
      key:          "ground-direct",
      label:        "Direct",
      tooltip:      "Spend 1 Momentum to Direct — give an ally a bonus die on their next task.",
      momentumCost: 1,
    },
    {
      key:     "ground-guard",
      label:   "Guard",
      tooltip: "Insight + Security, Difficulty 0 (self) or 1 (ally). Success increases attack Difficulty against the guarded character by 1 until the start of the next applicable turn.",
    },
    {
      key:     "ground-sprint",
      label:   "Sprint",
      tooltip: "Move two zones at full speed. Fitness + Conn, Difficulty 0. Each Momentum spent beyond the task result lets you move one additional zone.",
    },
    {
      key:     "ground-task",
      label:   "Task Roll",
      tooltip: "Perform any other Major Action as a task roll.",
    },
    {
      key:     "pass",
      label:   "Pass",
      tooltip: "Do nothing this turn — forfeit your Major Action.",
    },
    {
      key:     "ready",
      label:   "Ready",
      tooltip: "Hold your Major Action to react later in the round. Declare a trigger condition; if it occurs before your next turn you may act immediately.",
    },
  ],
};

// Returns true when the Token Attacher module is active and its API is loaded.
// Used to choose between the TA-native follow and the hook-based fallback.
function _taAvailable() {
  // Token Attacher exposes its public API as window.tokenAttacher (lowercase),
  // not window.TokenAttacher.  The class itself is module-scoped and not global.
  return !!(game.modules.get("token-attacher")?.active && window.tokenAttacher?.attachElementToToken);
}

// ── Task-specific roller pre-configuration (module scope for export) ──────────
// Keyed by the action key used in BRIDGE_STATIONS.
// charAttr / charDisc: the character's Attribute + Discipline for this task.
// shipSystemKey / shipDeptKey: the ship pool system + department for this task.
export const TASK_PARAMS = {
  "warp":              { difficulty: 1,  charAttr: "control",  charDisc: "conn",        shipSystemKey: "engines",   shipDeptKey: "conn",        ctx: "Control + Conn · Difficulty 1 · Engines + Conn" },
  "maneuver":          { difficulty: 0,  charAttr: "control",  charDisc: "conn",        shipSystemKey: "engines",   shipDeptKey: "conn",        ctx: "Control + Conn · Difficulty 0 · Engines + Conn" },
  "attack-pattern":    { difficulty: 0,  charAttr: "control",  charDisc: "conn",        shipSystemKey: "engines",   shipDeptKey: "conn",        ctx: "Control + Conn · Difficulty 0" },
  "ram":               { difficulty: 2,  charAttr: "daring",   charDisc: "conn",        shipSystemKey: "engines",   shipDeptKey: "conn",        ctx: "Daring + Conn · Difficulty 2 · Engines + Conn" },
  "evasive-action":    { difficulty: 0,  charAttr: "daring",   charDisc: "conn",        shipSystemKey: "structure", shipDeptKey: "conn",        ctx: "Daring + Conn · Structure + Conn" },
  "damage-control":    { difficulty: 2,  charAttr: "presence", charDisc: "engineering", shipSystemKey: "structure", shipDeptKey: "engineering", ctx: "Presence + Engineering · Difficulty 2 · Structure + Engineering", noShipAssist: true, ignoreBreachPenalty: true },
  "regain-power":      { difficulty: 1,  charAttr: "control",  charDisc: "engineering", shipSystemKey: null,        shipDeptKey: "engineering", ctx: "Control + Engineering · Difficulty 1", noShipAssist: true, ignoreBreachPenalty: true },
  "regen-shields":     { difficulty: 2,  charAttr: "control",  charDisc: "engineering", shipSystemKey: "structure", shipDeptKey: "engineering", ctx: "Control + Engineering · Difficulty 2 · Structure + Engineering", ignoreBreachPenalty: true },
  "reroute-power":     { difficulty: 1,  charAttr: "control",  charDisc: "engineering", shipSystemKey: null,        shipDeptKey: "engineering", ctx: "Control + Engineering · Difficulty 1" },
  "transport":         { difficulty: 3,  charAttr: "control",  charDisc: "engineering", shipSystemKey: "sensors",   shipDeptKey: "science",     ctx: "Control + Engineering · Difficulty 3 (from bridge) · Sensors + Science" },
  "reveal":            { difficulty: 3,  charAttr: "reason",   charDisc: "science",     shipSystemKey: "sensors",   shipDeptKey: "science",     ctx: "Reason + Science · Difficulty 3 · Sensors + Science" },
  "scan-for-weakness": { difficulty: 2,  charAttr: "control",  charDisc: "science",     shipSystemKey: "sensors",   shipDeptKey: "security",    ctx: "Control + Science · Difficulty 2 · Sensors + Security", ignoreBreachPenalty: true },
  "sensor-sweep":      { difficulty: 1,  charAttr: "reason",   charDisc: "science",     shipSystemKey: "sensors",   shipDeptKey: "science",     ctx: "Reason + Science · Difficulty 1 · Sensors + Science" },
  "defensive-fire":    { difficulty: 0,  charAttr: "daring",   charDisc: "security",    shipSystemKey: "weapons",   shipDeptKey: "security",    ctx: "Daring + Security · Weapons + Security" },
  "modulate-shields":  { difficulty: 1,  charAttr: "daring",   charDisc: "security",    shipSystemKey: "structure", shipDeptKey: "security",    ctx: "Daring + Security · Difficulty 1 · Structure + Security" },
  "tractor-beam":      { difficulty: 2,  charAttr: "control",  charDisc: "security",    shipSystemKey: "structure", shipDeptKey: "security",    ctx: "Control + Security · Difficulty 2 · Structure + Security" },
  "rally":             { difficulty: 0,  charAttr: "presence", charDisc: "command",     shipSystemKey: null,        shipDeptKey: "command",     ctx: "Presence + Command · Difficulty 0", rallyContext: true, ignoreBreachPenalty: true },
  "direct":            { difficulty: 1,  charAttr: "control",  charDisc: "command",     shipSystemKey: null,        shipDeptKey: "command",     ctx: "Control + Command · Difficulty 1" },
  "create-trait":      { difficulty: 1,  charAttr: null,       charDisc: null,          shipSystemKey: null,        shipDeptKey: null,          ctx: "Task Roll · Difficulty 1 (GM may adjust)" },
  "cloak-toggle":      { difficulty: 2,  charAttr: "control",  charDisc: "engineering", shipSystemKey: "engines",   shipDeptKey: "security",    ctx: "Control + Engineering · Difficulty 2 · Engines + Security" },
};

// ---------------------------------------------------------------------------
// Standalone opposed-task check — callable outside a CombatHUD instance.
// Used by the NPC roller's Roll button when firing from the character-sheet
// side panel, where no live HUD instance exists.
//
// Parameters:
//   weaponName   — name of the weapon being fired (for display in chat cards)
//   attackerToken — the attacker's canvas token (used to identify the task)
//   targetTokens  — array of targeted canvas tokens to check for active defences
//
// Returns the same sentinel shapes as CombatHUD._checkOpposedTask:
//   { proceed: true }
//   { proceed: "pending", defMode, defenderTokenId }
// ---------------------------------------------------------------------------
export async function checkOpposedTaskForTokens(weaponName, attackerToken, targetTokens) {
  if (!targetTokens?.length) return { proceed: true, difficulty: null, defenseType: null, defenderSuccesses: null };

  // Check all targets — if any has a defense mode active, intercept
  for (const target of targetTokens) {
    const defMode = getDefenseMode(target);
    if (!defMode) continue;

    const defLabel   = defMode === "evasive-action" ? "Evasive Action" : defMode === "defensive-fire" ? "Defensive Fire" : "Cover";
    const defIcon    = defMode === "evasive-action" ? "↗️" : defMode === "defensive-fire" ? "🛡️" : "🪨";
    const defStation = defMode === "evasive-action" ? "Helm" : "Tactical";
    const defAttr    = defMode === "evasive-action" ? "daring" : "control";
    const defDisc    = defMode === "evasive-action" ? "conn"   : "security";

    ChatMessage.create({
      content: lcarsCard(`${defIcon} SHIP DEFENSE — ${defLabel.toUpperCase()}`, LC.secondary, `
        <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${target.name}</div>
        <div style="font-size:10px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
          ${defIcon} <strong>${defLabel}</strong> active — roll <strong>${defStation}</strong> station defense.<br>
          <span style="color:${LC.textDim};">Successes set the attacker's Difficulty.</span>
        </div>
        <div style="margin:6px -10px -8px;padding:4px 8px 6px;border-top:1px solid ${LC.borderDim};">
          <button class="sta2e-ship-defense-roll"
            data-token-id="${target.id}"
            data-station-id="${defMode === 'evasive-action' ? 'helm' : 'tactical'}"
            data-task-label="${defLabel} Defense"
            data-default-attr="${defAttr}"
            data-default-disc="${defDisc}"
            style="width:100%;padding:4px 8px;font-family:${LC.font};font-size:10px;
              font-weight:700;letter-spacing:0.06em;text-transform:uppercase;
              cursor:pointer;background:rgba(0,200,100,0.10);
              border:1px solid ${LC.secondary};border-radius:2px;color:${LC.secondary};">
            🎲 Roll ${defStation} Defense
          </button>
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });

    return { proceed: "pending", defMode, defenderTokenId: target.id };
  }

  // Check for cover on any ship target (only when no defense mode was found above)
  for (const target of targetTokens) {
    if (!target.document?.getFlag(MODULE, "coverActive")) continue;

    ChatMessage.create({
      content: lcarsCard("🪨 SHIP DEFENSE — COVER", LC.secondary, `
        <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${target.name}</div>
        <div style="font-size:10px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
          🪨 <strong>Cover</strong> active — roll <strong>Helm</strong> station defense.<br>
          <span style="color:${LC.textDim};">Successes set the attacker's Difficulty.</span>
        </div>
        <div style="margin:6px -10px -8px;padding:4px 8px 6px;border-top:1px solid ${LC.borderDim};">
          <button class="sta2e-ship-defense-roll"
            data-token-id="${target.id}"
            data-station-id="helm"
            data-task-label="Cover Defense"
            data-default-attr="daring"
            data-default-disc="conn"
            style="width:100%;padding:4px 8px;font-family:${LC.font};font-size:10px;
              font-weight:700;letter-spacing:0.06em;text-transform:uppercase;
              cursor:pointer;background:rgba(0,200,100,0.10);
              border:1px solid ${LC.secondary};border-radius:2px;color:${LC.secondary};">
            🎲 Roll Helm Defense
          </button>
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });

    return { proceed: "pending", defMode: "cover", defenderTokenId: target.id };
  }

  // No defense active on any target
  return { proceed: true, difficulty: null, defenseType: null, defenderSuccesses: null };
}

export class CombatHUD {

  constructor() {
    this._el                  = null;
    this._token               = null;
    this._pinned              = localStorage.getItem(PINNED_KEY) === "1";
    this._pendingWeapon       = null;
    this._pendingSalvoMode    = null;
    this._pendingStunMode     = true;   // for dual Stun/Deadly weapons — true = using stun (default)
    this._opposedDifficulty   = null;   // set when attacker weapon is fired against a defending ship
    this._opposedDefenseType  = null;   // "evasive-action" | "defensive-fire" | null
    this._defenderSuccesses   = null;   // raw defender roll count for the chat card delta
    this._shieldPortraitMode  = localStorage.getItem("sta2e-toolkit-shieldPortraitMode") === "1";  // toggle between bubbles and portrait view
    this._portraitUrl         = null;   // cached portrait URL for current token
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  open(token) {
    const canvasToken = token?.object ?? token;
    if (!canvasToken?.actor) return;
    this._token               = canvasToken;
    this._pendingWeapon       = null;
    this._pendingSalvoMode    = null;
    this._pendingStunMode     = true;   // default to Stun — Deadly costs Threat
    this._opposedDifficulty   = null;
    this._opposedDefenseType  = null;
    this._defenderSuccesses   = null;
    this._shieldPortraitMode  = false;  // reset to bubble mode on new token
    this._portraitUrl         = null;   // clear cached portrait

    try {
      if (!this._el) {
        this._build();
      } else {
        this._refresh();
      }
    } catch(err) {
      console.error("STA2e Toolkit | CombatHUD render error:", err);
    }

    if (this._el) this._el.style.display = "flex";
  }

  close() {
    if (this._pinned) return;
    if (game.combat?.active) {
      // During combat: stay visible, switch to roster view
      this._token               = null;
      this._pendingWeapon       = null;
      this._pendingSalvoMode    = null;
      this._pendingStunMode     = true;
      this._opposedDifficulty   = null;
      this._opposedDefenseType  = null;
      this._defenderSuccesses   = null;
      this._clearGroundState();
      try { this._refresh(); } catch(err) {
        console.error("STA2e Toolkit | CombatHUD roster render error:", err);
      }
      return;
    }
    // Normal (out-of-combat) close
    if (this._el) this._el.style.display = "none";
    this._token               = null;
    this._pendingWeapon       = null;
    this._pendingSalvoMode    = null;
    this._pendingStunMode     = true;
    this._opposedDifficulty   = null;
    this._opposedDefenseType  = null;
    this._defenderSuccesses   = null;
    this._clearGroundState();
  }

  forceClose() {
    if (this._el) this._el.style.display = "none";
    this._token               = null;
    this._pendingWeapon       = null;
    this._pendingSalvoMode    = null;
    this._pendingStunMode     = true;
    this._opposedDifficulty   = null;
    this._opposedDefenseType  = null;
    this._defenderSuccesses   = null;
    this._clearGroundState();
  }

  _clearGroundState() {
    this[`_groundToggle_ground-aim`]     = false;
    this[`_groundToggle_ground-prepare`] = false;
    this[`_groundToggle_ground-prone`]   = false;
    this._groundAimRerolls               = 0;
  }

  /** Open the HUD in roster mode (no token selected) during active combat. */
  openRoster() {
    this._token = null;
    try {
      if (!this._el) {
        this._build();
      } else {
        this._refresh();
      }
    } catch(err) {
      console.error("STA2e Toolkit | CombatHUD roster render error:", err);
    }
    if (this._el) this._el.style.display = "flex";
  }

  /** Re-render HUD contents for the current token (e.g. after flag update). */
  refresh() {
    if (this._el && this._token) this._refresh();
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  _build() {
    document.getElementById(HUD_ID)?.remove();

    const el = document.createElement("div");
    el.id = HUD_ID;
    el.style.cssText = `
      position: fixed;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      width: 290px;
      background: ${LC.bg};
      border: 1px solid ${LC.border};
      border-left: 4px solid ${LC.primary};
      border-radius: 2px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.85), 0 0 12px rgba(255,153,0,0.12);
      font-family: ${LC.font};
      color: ${LC.text};
      user-select: none;
      overflow: hidden;
    `;

    const saved = this._loadPos();
    el.style.left = `${saved.x}px`;
    el.style.top  = `${saved.y}px`;

    document.body.appendChild(el);
    this._el = el;

    this._refresh();
    this._makeDraggable();
  }

  _refresh() {
    if (!this._el) return;
    if (!this._token) {
      if (game.combat?.active) this._buildRoster();
      return;
    }
    this._el.innerHTML = "";

    const actor  = this._token.actor;
    const isShip = actor.type === "starship" || actor.type === "spacecraft2e"
                   || actor.items.some(i => i.type === "starshipweapon2e");

    this._el.appendChild(this._buildHeader(actor, isShip));
    this._el.appendChild(this._buildWeapons(actor));
    if (isShip && actor.system?.shields) {
      this._el.appendChild(this._buildShields(actor));
    }
    this._el.appendChild(this._buildHitMiss());

    if (isShip) {
      this._el.appendChild(this._buildQuickActions());
      this._el.appendChild(this._buildSystemsStatus(actor));
      if (CombatHUD.isNpcShip(actor) && game.user.isGM) {
        this._el.appendChild(this._buildCrewQualityRow(actor));
      }
      if (CombatHUD.getWarpBreachState(actor)) {
        this._el.appendChild(this._buildBreachPanel(actor));
      }
    }

    if (!isShip) {
      this._el.appendChild(this._buildGroundActions());
    }

    this._el.appendChild(this._buildStatus(isShip));

    if (!isShip && game.user.isGM) {
      this._el.appendChild(this._buildTransporterSection());
    }

    // Re-attach draggable after re-render
    this._makeDraggable();
  }

  // ── Roster view (no token selected during active combat) ───────────────────

  _buildRoster() {
    this._el.innerHTML = "";

    // Header bar
    const header = document.createElement("div");
    header.className = "sta2e-chud-header";
    header.style.cssText = `
      display:flex;align-items:center;padding:5px 8px;
      background:${LC.primary};cursor:grab;gap:6px;
    `;
    const title = document.createElement("div");
    title.style.cssText = `flex:1;font-weight:700;font-size:12px;color:${LC.bg};
      letter-spacing:0.08em;text-transform:uppercase;font-family:${LC.font};`;
    title.textContent = "COMBAT ROSTER";
    const closeBtn = document.createElement("button");
    closeBtn.style.cssText = `background:none;border:none;color:${LC.bg};
      font-size:14px;cursor:pointer;padding:0 2px;line-height:1;`;
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.forceClose());
    header.appendChild(title);
    header.appendChild(closeBtn);
    this._el.appendChild(header);

    // Combatant list section
    const section = this._buildSection("COMBATANTS — click to open");
    const list = document.createElement("div");
    list.style.cssText = "padding:6px 8px;display:flex;flex-direction:column;gap:4px;";

    const combatants = game.combat?.combatants ?? [];
    if (!combatants.size) {
      const empty = document.createElement("div");
      empty.style.cssText = `font-size:10px;color:${LC.textDim};font-family:${LC.font};padding:4px;`;
      empty.textContent = "No combatants.";
      list.appendChild(empty);
    } else {
      for (const combatant of combatants) {
        const actor = combatant.actor;
        if (!actor) continue;
        // Players only see tokens they can control; GM sees all
        if (!game.user.isGM && !actor.isOwner) continue;

        const cIsShip   = actor.type === "starship" || actor.type === "spacecraft2e"
                          || actor.items?.some(i => i.type === "starshipweapon2e");
        const shields   = cIsShip ? actor.system?.shields : null;
        const stress    = !cIsShip && actor.system?.stress != null ? actor.system.stress : null;
        const npcThreat = !cIsShip && CombatHUD.isGroundNpcActor(actor) && game.user.isGM
          ? CombatHUD.getNpcPersonalThreat(actor, combatant.token)
          : null;

        const isShaken  = CombatHUD.getShipStatus(actor)?.shaken ?? false;
        const isBreach  = !!CombatHUD.getWarpBreachState(actor);
        const isArmed   = CombatHUD.getWeaponsArmed(actor) ?? false;
        const isLowered = CombatHUD.getShieldsLowered(actor) ?? false;

        const badges = [
          isShaken  && `<span style="color:${LC.yellow};font-size:8px;"> SHAKEN</span>`,
          isBreach  && `<span style="color:${LC.red};font-size:8px;"> BREACH</span>`,
          isArmed   && `<span style="color:${LC.orange};font-size:8px;"> ARMED</span>`,
          isLowered && `<span style="color:${LC.textDim};font-size:8px;"> SHIELDS▼</span>`,
        ].filter(Boolean).join("");

        // Status line: shields for ships, stress for characters, threat for NPCs
        let statusLine = "";
        if (shields) {
          const pct   = shields.max > 0 ? shields.value / shields.max : 0;
          const color = pct > 0.5 ? LC.green : pct > 0.25 ? LC.yellow : LC.red;
          statusLine  = `🛡 <span style="color:${color}">${shields.value}/${shields.max}</span>`;
        } else if (stress) {
          const pct        = stress.max > 0 ? stress.value / stress.max : 0;
          const stressMode = game.settings.get("sta2e-toolkit", "stressMode") ?? "countdown";
          const color      = stressMode === "countup"
            ? (pct <= 0.25 ? LC.green : pct <= 0.60 ? LC.yellow : LC.red)
            : (pct <= 0.25 ? LC.red   : pct <= 0.60 ? LC.yellow : LC.green);
          statusLine  = `⚡ <span style="color:${color}">${stress.value}/${stress.max}</span>`;
        } else if (npcThreat !== null) {
          statusLine  = `⚠ <span style="color:${npcThreat > 0 ? LC.yellow : LC.textDim}">${npcThreat} Threat</span>`;
        }

        const row = document.createElement("div");
        row.style.cssText = `
          display:flex;align-items:center;gap:6px;padding:4px 6px;
          background:${LC.panel};border:1px solid ${LC.borderDim};border-radius:2px;
          cursor:pointer;transition:border-color 0.12s;
        `;
        row.innerHTML = `
          <div style="flex:1;min-width:0;">
            <div style="font-size:10px;font-weight:700;color:${LC.text};
              font-family:${LC.font};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${combatant.name}${badges}
            </div>
            <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">
              ${statusLine}
            </div>
          </div>
          <div style="font-size:9px;color:${LC.primary};font-family:${LC.font};
            letter-spacing:0.05em;flex-shrink:0;">▶ OPEN</div>
        `;
        row.addEventListener("mouseenter", () => row.style.borderColor = LC.border);
        row.addEventListener("mouseleave", () => row.style.borderColor = LC.borderDim);
        row.addEventListener("click", () => {
          const canvasToken = canvas.tokens?.get(combatant.tokenId);
          if (canvasToken) this.open(canvasToken);
        });
        list.appendChild(row);
      }
    }

    section.appendChild(list);
    this._el.appendChild(section);
    this._makeDraggable();
  }

  // ── Header ─────────────────────────────────────────────────────────────────

  _buildHeader(actor, isShip) {
    const header = document.createElement("div");
    header.className = "sta2e-chud-header";
    header.style.cssText = `
      display: flex;
      align-items: center;
      padding: 5px 8px;
      background: ${LC.primary};
      cursor: grab;
      gap: 6px;
    `;

    // Token name — dark on orange
    const name = document.createElement("div");
    name.style.cssText = `flex:1;font-weight:700;font-size:12px;color:${LC.bg};
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      letter-spacing:0.08em;text-transform:uppercase;font-family:${LC.font};`;
    name.textContent = this._token.name;


    // Stress display for PCs / supporting characters (non-ship actors with a stress pool)
    let stressEl = null;
    if (!isShip && actor.system?.stress != null) {
      const sv    = actor.system.stress.value ?? 0;
      const sm    = actor.system.stress.max   ?? 0;
      const pct        = sm > 0 ? sv / sm : 0;
      const stressMode = game.settings.get("sta2e-toolkit", "stressMode") ?? "countdown";
      const color      = stressMode === "countup"
        ? (pct <= 0.25 ? LC.green : pct <= 0.60 ? LC.yellow : LC.red)
        : (pct <= 0.25 ? LC.red   : pct <= 0.60 ? LC.yellow : LC.green);
      stressEl = document.createElement("div");
      stressEl.style.cssText = `font-size:11px;color:${LC.bg};white-space:nowrap;font-family:${LC.font};`;
      stressEl.title = `Stress: ${sv} of ${sm}`;
      stressEl.innerHTML = `⚡ <span style="color:${color};font-weight:bold;">${sv}/${sm}</span>`;
    }

    // NPC personal threat counter — GM-only, read from NPC stress track when available
    let threatEl = null;
    if (!isShip && CombatHUD.isGroundNpcActor(actor) && game.user.isGM) {
      const td     = this._token?.document;
      const threat = CombatHUD.getNpcPersonalThreat(actor, td);

      threatEl = document.createElement("div");
      threatEl.style.cssText = `display:flex;align-items:center;gap:1px;white-space:nowrap;`;

      const minusBtn = document.createElement("button");
      minusBtn.textContent = "−";
      minusBtn.title = "Spend 1 Threat";
      minusBtn.style.cssText = `background:none;border:none;color:${LC.bg};
        font-size:13px;cursor:pointer;padding:0 2px;line-height:1;font-family:${LC.font};`;

      const label = document.createElement("span");
      label.textContent = `⚠ ${threat}`;
      label.title = `Personal Threat: ${threat}`;
      label.style.cssText = `font-size:11px;font-weight:bold;font-family:${LC.font};
        color:${threat > 0 ? LC.yellow : LC.bg};`;

      const plusBtn = document.createElement("button");
      plusBtn.textContent = "+";
      plusBtn.title = "Add 1 Threat";
      plusBtn.style.cssText = `background:none;border:none;color:${LC.bg};
        font-size:13px;cursor:pointer;padding:0 2px;line-height:1;font-family:${LC.font};`;

      const _updateThreat = async (delta) => {
        const cur    = CombatHUD.getNpcPersonalThreat(actor, td);
        const newVal = Math.max(0, cur + delta);
        await CombatHUD.setNpcPersonalThreat(actor, td, newVal);
        this._refresh();
      };
      minusBtn.addEventListener("click", async (e) => { e.stopPropagation(); await _updateThreat(-1); });
      plusBtn.addEventListener( "click", async (e) => { e.stopPropagation(); await _updateThreat(+1); });

      threatEl.appendChild(minusBtn);
      threatEl.appendChild(label);
      threatEl.appendChild(plusBtn);
    }

    // Warp breach badge — pulsing red, GM can click to clear (successful containment)
    let breachEl = null;
    if (isShip && CombatHUD.getWarpBreachState(actor)) {
      breachEl = document.createElement("button");
      breachEl.style.cssText = `
        padding: 1px 5px;
        background: rgba(255,0,0,0.15);
        border: 1px solid ${LC.red};
        border-radius: 2px;
        color: ${LC.red};
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.08em;
        cursor: ${game.user.isGM ? "pointer" : "default"};
        white-space: nowrap;
        font-family: ${LC.font};
        animation: sta2e-breach-pulse 1s ease-in-out infinite alternate;
      `;
      breachEl.textContent = "☢ BREACH";
      breachEl.title = game.user.isGM
        ? "Warp Core Breach Imminent — click to clear (reactor stabilized/ejected)"
        : "Warp Core Breach Imminent";
      if (game.user.isGM) {
        breachEl.addEventListener("click", async (e) => {
          e.stopPropagation();
          const confirm = await foundry.applications.api.DialogV2.wait({
            window:  { title: "Clear Breach Warning?" },
            content: `<p>Mark the reactor as <strong>stabilized or ejected</strong>? This will clear the breach warning.</p>`,
            buttons: [
              { action: "clear",  label: "✓ Reactor Contained", icon: "fas fa-check", default: true },
              { action: "cancel", label: "Cancel",              icon: "fas fa-times" },
            ],
          });
          if (confirm === "clear") {
            await CombatHUD.setWarpBreachState(actor, false);
            this._refresh();
          }
        });
      }
    }

    // Pin button
    const pin = document.createElement("button");
    pin.style.cssText = this._iconBtnStyle();
    pin.title  = "Pin HUD open";
    pin.textContent = this._pinned ? "📌" : "🔗";
    pin.addEventListener("click", (e) => {
      e.stopPropagation();
      this._pinned = !this._pinned;
      localStorage.setItem(PINNED_KEY, this._pinned ? "1" : "0");
      pin.textContent = this._pinned ? "📌" : "🔗";
    });

    // Close button
    const close = document.createElement("button");
    close.style.cssText = this._iconBtnStyle();
    close.title = "Close";
    close.textContent = "×";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.forceClose();
    });

    header.appendChild(name);
    if (stressEl)  header.appendChild(stressEl);
    if (threatEl)  header.appendChild(threatEl);
    if (breachEl)  header.appendChild(breachEl);
    if (isShip && game.user.isGM) {
      header.appendChild(this._buildNpcToggle(actor));
      header.appendChild(this._buildCrewManifestBtn(actor));
    }
    header.appendChild(pin);
    header.appendChild(close);

    return header;
  }

  // ── Weapons ────────────────────────────────────────────────────────────────

  /**
   * Returns active weapon qualities as a formatted string.
   * e.g. "High Yield, Spread, Versatile 2"
   */
  _weaponQualityString(weapon) {
    const LABELS = {
      accurate:    "Accurate",
      area:        "Area",
      calibration: "Calibration",
      cumbersome:  "Cumbersome",
      dampening:   "Dampening",
      depleting:   "Depleting",
      devastating: "Devastating",
      highyield:   "High Yield",
      intense:     "Intense",
      jamming:     "Jamming",
      persistent:  "Persistent",
      piercing:    "Piercing",
      slowing:     "Slowing",
      spread:      "Spread",
    };
    const q = weapon.system?.qualities ?? {};
    const parts = [];
    for (const [key, label] of Object.entries(LABELS)) {
      if (q[key] === true) parts.push(label);
    }
    if (q.hiddenx  > 0) parts.push(`Hidden ${q.hiddenx}`);
    if (q.versatilex > 0) parts.push(`Versatile ${q.versatilex}`);
    return parts.join(", ") || "None";
  }

  /** Weapons Rating → bonus damage (STA 2e table) */
  _weaponRatingBonus(wr) {
    if (wr <= 6)  return 0;
    if (wr <= 8)  return 1;
    if (wr <= 10) return 2;
    if (wr <= 12) return 3;
    return 4;
  }

  /**
   * Energy weapons:  scale + typeBonus + weaponRatingBonus
   *   Cannon       = Scale + 2
   *   Banks        = Scale + 1
   *   Arrays       = Scale + 0
   *   Spinal Lance = Scale + 3
   * Torpedo weapons: item.damage + weaponRatingBonus  (no scale)
   * Character weapons: item.damage only
   */
  _weaponTypeBonus(weapon) {
    if (weapon.type !== "starshipweapon2e") return 0;
    const isTorpedo = weapon.system?.includescale === "torpedo";
    if (isTorpedo) return 0;
    const slug = weapon.img?.split("/").pop().replace(/\.(svg|webp|png|jpg)$/, "") ?? "";
    if (slug.endsWith("-array-spread")) return 3; // Spinal Lance
    if (slug.endsWith("-cannon"))       return 2;
    if (slug.endsWith("-bank"))         return 1;
    return 0; // standard arrays
  }

  _weaponTotalDamage(weapon, actor) {
    if (weapon.type !== "starshipweapon2e") return weapon.system?.damage ?? 0;
    const scale       = actor.system?.scale ?? 0;
    const wr          = actor.system?.systems?.weapons?.value ?? 0;
    const ratingBonus = this._weaponRatingBonus(wr);
    const isTorpedo   = weapon.system?.includescale === "torpedo";
    const typeBonus   = this._weaponTypeBonus(weapon);
    return isTorpedo
      ? (weapon.system?.damage ?? 0) + ratingBonus
      : scale + typeBonus + ratingBonus;
  }

  /** Returns { total, breakdown } for the chat card. */
  _weaponDamageBreakdown(weapon, actor) {
    if (weapon.type !== "starshipweapon2e") {
      return { total: weapon.system?.damage ?? 0, breakdown: null };
    }
    const scale       = actor.system?.scale ?? 0;
    const wr          = actor.system?.systems?.weapons?.value ?? 0;
    const ratingBonus = this._weaponRatingBonus(wr);
    const isTorpedo   = weapon.system?.includescale === "torpedo";
    const typeBonus   = this._weaponTypeBonus(weapon);
    const baseDmg     = weapon.system?.damage ?? 0;

    if (isTorpedo) {
      const total = baseDmg + ratingBonus;
      const parts = [`${baseDmg} base`];
      if (ratingBonus) parts.push(`+${ratingBonus} weapons (${wr})`);
      return { total, breakdown: parts.join(" ") };
    }

    const total = scale + typeBonus + ratingBonus;
    const parts = [`${scale} scale`];
    if (typeBonus)   parts.push(`+${typeBonus} type`);
    if (ratingBonus) parts.push(`+${ratingBonus} weapons (${wr})`);
    return { total, breakdown: parts.join(" ") };
  }

  _buildWeapons(actor) {
    const section = this._buildSection("WEAPONS");
    const row     = document.createElement("div");
    row.style.cssText = "display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px;";

    const weapons = actor.items.filter(i =>
      ["characterweapon2e", "starshipweapon2e"].includes(i.type)
    );

    if (weapons.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = `font-size:10px;color:${LC.textDim};padding:4px;
        font-family:${LC.font};letter-spacing:0.06em;text-transform:uppercase;`;
      empty.textContent = "No weapons found";
      row.appendChild(empty);
    } else {
      weapons.forEach(weapon => {
        const btn = document.createElement("button");
        btn.style.cssText = `
          width: 44px; height: 44px;
          background: ${LC.panel} url("${weapon.img}") center/contain no-repeat;
          border: 1px solid ${LC.border};
          border-radius: 2px;
          cursor: pointer;
          position: relative;
          transition: border-color 0.15s, box-shadow 0.15s;
        `;

        if (this._pendingWeapon?.id === weapon.id) {
          btn.style.borderColor = LC.primary;
          btn.style.boxShadow   = `0 0 6px ${LC.primary}`;
        }

        const config    = getWeaponConfig(weapon);
        const isShip    = weapon.type === "starshipweapon2e";
        const { total, breakdown } = this._weaponDamageBreakdown(weapon, actor);
        const dmgLabel  = breakdown ? `${total} (${breakdown})` : total;
        const range     = weapon.system?.range ?? "?";
        const qualities = this._weaponQualityString(weapon);
        const isNpcShip = weapon.type === "starshipweapon2e" && CombatHUD.isNpcShip(actor);
        const noAnim    = config ? "" : "\n⚠ No animation config";
        btn.title = isNpcShip
          ? `${weapon.name}\nDamage: ${dmgLabel}\nRange: ${range}\nQualities: ${qualities}\n🎲 Opens NPC Dice Roller`
          : `${weapon.name}\nDamage: ${dmgLabel}\nRange: ${range}\nQualities: ${qualities}${noAnim}`;

        btn.addEventListener("mouseenter", () => {
          if (this._pendingWeapon?.id !== weapon.id)
            btn.style.borderColor = LC.tertiary;
        });
        btn.addEventListener("mouseleave", () => {
          if (this._pendingWeapon?.id !== weapon.id)
            btn.style.borderColor = LC.border;
        });

        btn.addEventListener("click", async () => {
          const isNpcShip = weapon.type === "starshipweapon2e" && CombatHUD.isNpcShip(actor);

          // ── Ground weapon path (characterweapon2e) — completely separate from ship flow ──
          if (weapon.type === "characterweapon2e") {
            const isMelee      = weapon.system?.range === "melee";
            const isCumbersome = weapon.system?.qualities?.cumbersome ?? false;
            const hasStun   = weapon.system?.qualities?.stun   ?? false;
            const hasDeadly = weapon.system?.qualities?.deadly ?? false;
            const isDual    = hasStun && hasDeadly;
            const weaponCtx = {
              name:      weapon.name,
              damage:    total,
              qualities: this._weaponQualityString(weapon),
            };

            // ── Cumbersome gate ──────────────────────────────────────────────
            // A cumbersome weapon requires the Prepare minor action before it
            // can be used. If Prepare has not been taken this turn, block the
            // attack and remind the player.
            if (isCumbersome) {
              const prepFlag = `_groundToggle_ground-prepare`;
              if (!this[prepFlag]) {
                await foundry.applications.api.DialogV2.wait({
                  window:  { title: "⚙️ Cumbersome Weapon" },
                  content: `
                    <div style="font-family:${LC.font};padding:4px 0;line-height:1.6;">
                      <div style="font-size:11px;color:${LC.text};margin-bottom:6px;">
                        <strong style="color:${LC.primary};">${weapon.name}</strong>
                        has the <strong>Cumbersome</strong> quality.
                      </div>
                      <div style="font-size:10px;padding:6px 8px;
                        background:rgba(255,153,0,0.06);
                        border-left:3px solid ${LC.primary};border-radius:0 2px 2px 0;
                        color:${LC.text};">
                        You must use the <strong>Prepare</strong> minor action on the
                        same turn before attacking with this weapon.<br>
                        <span style="color:${LC.textDim};">Take <em>Prepare</em> first,
                        then attack on the same turn.</span>
                      </div>
                    </div>`,
                  buttons: [{ action: "ok", label: "Understood", icon: "fas fa-check", default: true }],
                });
                return;
              }
              // Prepare was taken — consume it (it's a one-use gate per attack)
              this[prepFlag] = false;
              this._refresh();
            }

            // Detect target defensive states BEFORE showing the choice dialog
            // so the dialog can reflect cover / guard info accurately.
            const targets = Array.from(game.user.targets ?? []);
            const targetIsGuarded = targets.some(t =>
              t.document?.getFlag(MODULE, "guardActive")
            );
            const guardPenalty = targetIsGuarded ? 1 : 0;
            const targetHasCover = !isMelee && targets.some(t =>
              t.document?.getFlag(MODULE, "coverActive")
            );
            const targetIsProne = targets.some(t => t.actor?.statuses?.has("prone") ?? false);
            // Prone + In Cover (ranged only) → +1 Protection AND +1 Difficulty at Medium+
            const targetIsProneInCover = !isMelee && targetHasCover && targetIsProne;

            const choice = await foundry.applications.api.DialogV2.wait({
              window:  { title: `${weapon.name} — Attack Method` },
              content: `
                <div style="font-family:${LC.font};padding:4px 0;">
                  <div style="font-size:11px;color:${LC.text};margin-bottom:8px;">
                    <strong style="color:${LC.primary};">${actor.name}</strong>
                    ${isMelee ? "strikes with" : "fires"}
                    <strong>${weapon.name}</strong>
                    — Dmg <strong style="color:${LC.tertiary};">${total}</strong>
                  </div>
                  <div style="font-size:10px;color:${LC.textDim};">
                    ${isMelee
                      ? "Melee attacks are always <strong>Opposed Tasks</strong> (Daring + Security)."
                      : targetHasCover
                        ? `Target is in <strong style="color:${LC.secondary};">Cover</strong> — this becomes an <strong>Opposed Task</strong> (defender rolls Control + Security).${guardPenalty ? " <span style='color:" + LC.yellow + ";'>+1 Guard penalty also applies.</span>" : ""}${targetIsProneInCover ? " <span style='color:" + LC.secondary + ";'>Prone in Cover: defender gains <strong>+1 Protection</strong>.</span>" : ""}`
                        : `Ranged attack: <strong>Control + Security</strong>, Difficulty ${2 + guardPenalty}${guardPenalty ? " <span style='color:" + LC.yellow + ";'>(+1 Guard)</span>" : ""}.`}
                  </div>
                  ${targetIsProne ? `
                  <div style="margin-top:6px;padding:4px 8px;border-left:3px solid ${LC.secondary};
                    background:rgba(0,200,100,0.06);border-radius:0 2px 2px 0;font-size:10px;
                    color:${LC.text};line-height:1.5;">
                    🧎 Target is <strong style="color:${LC.secondary};">Prone</strong> —
                    ${isMelee
                      ? `melee at Close range grants you <strong>2 bonus Momentum</strong> on a hit.`
                      : `you'll be asked about range to determine Difficulty modifier.`}
                  </div>` : ""}
                </div>`,
              buttons: [
                { action: "roller",  label: "🎲 Dice Roller", icon: "fas fa-dice-d20", default: true },
                { action: "hitmiss", label: "⚡ Hit / Miss",  icon: "fas fa-crosshairs" },
                { action: "cancel",  label: "Cancel",          icon: "fas fa-times" },
              ],
            });

            if (!choice || choice === "cancel") return;

            // ── Stun / Deadly declaration — BEFORE the roll ──────────────────
            // Must happen here so Threat is granted on intent, not on outcome.
            const attackerProfile = CombatHUD.getGroundCombatProfile(actor, this._token?.document ?? null);
            const attackerIsNpc   = !attackerProfile.isPlayerOwned;
            let useStun;

            if (isDual) {
              // Ask which injury type the attacker intends
              const modeChoice = await foundry.applications.api.DialogV2.wait({
                window: { title: `${weapon.name} — Injury Type` },
                content: `
                  <div style="font-family:${LC.font};padding:4px 0;">
                    <div style="font-size:11px;color:${LC.text};margin-bottom:8px;">
                      <strong style="color:${LC.primary};">${weapon.name}</strong>
                      can inflict either a
                      <strong style="color:${LC.secondary};">Stun</strong> or a
                      <strong style="color:${LC.red};">Deadly</strong> injury.<br>
                      Choose the injury type for this attack.
                    </div>
                    <div style="font-size:10px;color:${LC.textDim};padding:4px 8px;
                      border-left:3px solid ${LC.borderDim};border-radius:0 2px 2px 0;line-height:1.6;">
                      ⚡ <strong>Stun</strong> — target becomes Incapacitated<br>
                      ☠ <strong>Deadly</strong> — target suffers a Deadly injury
                      ${!attackerIsNpc
                        ? `<br><span style="color:${LC.yellow};">Choosing Deadly gives the GM <strong>+1 Threat</strong> (based on intent, regardless of hit or miss).</span>`
                        : ""}
                    </div>
                  </div>`,
                buttons: [
                  { action: "stun",   label: "⚡ Stun",   icon: "fas fa-bolt",  default: true },
                  { action: "deadly", label: "☠ Deadly",  icon: "fas fa-skull" },
                  { action: "cancel", label: "Cancel",     icon: "fas fa-times" },
                ],
              });
              if (!modeChoice || modeChoice === "cancel") return;
              useStun = modeChoice === "stun";
            } else {
              useStun = hasStun && !hasDeadly;
            }

            // Deadly confirmation + immediate Threat grant for PC / Supporting characters
            if (!useStun && hasDeadly && !attackerIsNpc) {
              const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: "☠ Lethal Attack — Confirm" },
                content: `
                  <div style="font-family:${LC.font};padding:4px 0;line-height:1.6;">
                    <div style="font-size:11px;color:${LC.text};margin-bottom:8px;">
                      <strong style="color:${LC.red};">${weapon.name}</strong> will be used
                      as a <strong>Deadly</strong> weapon.
                    </div>
                    <div style="font-size:10px;padding:6px 8px;
                      background:rgba(255,50,50,0.06);border-left:3px solid ${LC.red};
                      border-radius:0 2px 2px 0;color:${LC.text};">
                      This attack is considered <strong>lethal intent</strong>.<br>
                      The GM receives <strong style="color:${LC.yellow};">+1 Threat</strong>
                      immediately — regardless of whether the attack hits or misses.
                    </div>
                  </div>`,
                yes: { label: "☠ Confirm Deadly (+1 Threat to GM)", icon: "fas fa-skull" },
                no:  { label: "Cancel",                              icon: "fas fa-times" },
              });
              if (!confirmed) return;
              await CombatHUD._applyToPool("threat", 1, this._token);
            }

            // Store declaration in weaponCtx so both roller and confirm handler use it
            weaponCtx.useStun          = useStun;
            weaponCtx.deadlyCostsThreat = !useStun && hasDeadly && !attackerIsNpc;

            if (choice === "roller") {
              let opposedDifficulty = null;
              let defenderSuccesses = null;

              // ── Prone target: range check (ranged) or bonus Momentum note (melee) ──
              let pronePenalty = 0;
              if (targetIsProne) {
                if (!isMelee) {
                  const isDistant = await foundry.applications.api.DialogV2.confirm({
                    window: { title: "🧎 Prone Target — Range Check" },
                    content: `
                      <div style="font-family:${LC.font};padding:4px 0;font-size:10px;
                        color:${LC.text};line-height:1.6;">
                        <strong style="color:${LC.secondary};">${targets[0]?.name ?? "Target"}</strong>
                        is <strong>Prone</strong>.<br>
                        Are they at <strong>Medium range or further</strong>?
                        <div style="margin-top:6px;padding:4px 8px;
                          background:rgba(255,153,0,0.06);border-left:3px solid ${LC.primary};
                          border-radius:0 2px 2px 0;color:${LC.textDim};">
                          Yes → <strong style="color:${LC.text};">+1 Difficulty</strong> on this attack<br>
                          No (Close range) → no ranged Difficulty modifier
                        </div>
                      </div>`,
                    yes: { label: "Yes — Medium or further (+1 Difficulty)", icon: "fas fa-arrows-alt-h" },
                    no:  { label: "No — Close range (no modifier)",          icon: "fas fa-map-marker-alt" },
                  });
                  if (isDistant) pronePenalty = 1;
                }
                // Melee vs prone: 2 bonus Momentum note is shown in the melee dialog below
              }

              if (isMelee) {
                // Melee is always an opposed task — post the defender roll card then store
                // the full attacker context in the pending opposed task world flag and bail.
                // The attacker's roller will open automatically once the defender confirms.
                const meleeTarget = targets[0] ?? null;
                ChatMessage.create({
                  content: lcarsCard("⚔️ MELEE DEFENSE", LC.secondary, `
                    <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
                      margin-bottom:4px;font-family:${LC.font};">${meleeTarget?.name ?? "Defender"}</div>
                    <div style="font-size:10px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
                      <strong>${actor.name}</strong> is making a melee attack — roll your defense.<br>
                      <span style="color:${LC.textDim};">Daring + Security · your successes set the attacker's Difficulty.</span>
                    </div>
                    <div style="margin:6px -10px -8px;padding:4px 8px 6px;border-top:1px solid ${LC.borderDim};">
                      <button class="sta2e-melee-defense-roll"
                        data-token-id="${meleeTarget?.id ?? ""}"
                        style="width:100%;padding:4px 8px;font-family:${LC.font};font-size:10px;
                          font-weight:700;letter-spacing:0.06em;text-transform:uppercase;
                          cursor:pointer;background:rgba(0,200,100,0.10);
                          border:1px solid ${LC.secondary};border-radius:2px;color:${LC.secondary};">
                        🎲 Roll Melee Defense
                      </button>
                    </div>`),
                  speaker: ChatMessage.getSpeaker({ token: this._token }),
                });

                const _hasAccurate = weapon.system?.qualities?.accurate === true;
                const _aimRerolls  = this._groundAimRerolls > 0 ? (_hasAccurate ? 2 : 1) : 0;
                this[`_groundToggle_ground-aim`] = false;
                this._groundAimRerolls = 0;

                await game.settings.set("sta2e-toolkit", "pendingOpposedTask", {
                  taskId:          `${this._token.id}-${Date.now()}`,
                  attackerUserId:  game.userId,
                  attackerTokenId: this._token.id,
                  attackerActorId: actor.id,
                  isNpcAttacker:   false,  // ground NPCs also use openPlayerRoller
                  defenseType:     "melee",
                  guardPenalty,
                  pronePenalty:    0,      // melee prone = +2 Momentum bonus, not a difficulty penalty
                  targetIsProne,
                  targetIsProneInCover: false,
                  rollerOpts: {
                    groundMode:    true,
                    groundIsNpc:   CombatHUD.isGroundNpcActor(actor),
                    stationId:     "tactical",
                    officer:       readOfficerStats(actor),
                    weaponContext: weaponCtx,
                    defaultAttr:   "daring",
                    defaultDisc:   "security",
                    taskLabel:     `Attack — ${weapon.name}`,
                    aimRerolls:    _aimRerolls,
                    // opposedDifficulty / defenderSuccesses / opposedDefenseType / taskContext
                    // are injected by resolveDefenderRoll when the defender confirms
                  },
                });
                return; // bail — attacker roller opens automatically when defender confirms
              }

              // Ranged cover: opposed task — post the defender roll card, store attacker context,
              // and bail. The attacker's roller opens automatically when the defender confirms.
              if (!isMelee && targetHasCover) {
                const coveredTarget = targets.find(t => t.document?.getFlag(MODULE, "coverActive"));
                if (coveredTarget) {
                  ChatMessage.create({
                    content: lcarsCard("🪨 COVER DEFENSE", LC.secondary, `
                      <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
                        margin-bottom:4px;font-family:${LC.font};">${coveredTarget.name}</div>
                      <div style="font-size:10px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
                        <strong>${actor.name}</strong> is making a ranged attack — roll your cover defense.<br>
                        <span style="color:${LC.textDim};">Control + Security · your successes set the attacker's Difficulty.</span>
                      </div>
                      <div style="margin:6px -10px -8px;padding:4px 8px 6px;border-top:1px solid ${LC.borderDim};">
                        <button class="sta2e-cover-defense-roll"
                          data-token-id="${coveredTarget.id}"
                          style="width:100%;padding:4px 8px;font-family:${LC.font};font-size:10px;
                            font-weight:700;letter-spacing:0.06em;text-transform:uppercase;
                            cursor:pointer;background:rgba(0,200,100,0.10);
                            border:1px solid ${LC.secondary};border-radius:2px;color:${LC.secondary};">
                          🎲 Roll Cover Defense
                        </button>
                      </div>`),
                    speaker: ChatMessage.getSpeaker({ token: this._token }),
                  });
                }

                const _hasAccurate = weapon.system?.qualities?.accurate === true;
                const _aimRerolls  = this._groundAimRerolls > 0 ? (_hasAccurate ? 2 : 1) : 0;
                this[`_groundToggle_ground-aim`] = false;
                this._groundAimRerolls = 0;

                await game.settings.set("sta2e-toolkit", "pendingOpposedTask", {
                  taskId:          `${this._token.id}-${Date.now()}`,
                  attackerUserId:  game.userId,
                  attackerTokenId: this._token.id,
                  attackerActorId: actor.id,
                  isNpcAttacker:   false,  // ground NPCs also use openPlayerRoller
                  defenseType:     "cover",
                  guardPenalty,
                  pronePenalty,
                  targetIsProne,
                  targetIsProneInCover,
                  rollerOpts: {
                    groundMode:    true,
                    groundIsNpc:   CombatHUD.isGroundNpcActor(actor),
                    stationId:     "tactical",
                    officer:       readOfficerStats(actor),
                    weaponContext: weaponCtx,
                    defaultAttr:   "control",
                    defaultDisc:   "security",
                    taskLabel:     `Attack — ${weapon.name}`,
                    aimRerolls:    _aimRerolls,
                    // opposedDifficulty / defenderSuccesses / opposedDefenseType / taskContext
                    // are injected by resolveDefenderRoll when the defender confirms
                  },
                });
                return; // bail — attacker roller opens automatically when defender confirms
              }

              // Non-opposed ranged attack (no cover, no melee) — open roller directly
              const hasAccurate = weapon.system?.qualities?.accurate === true;
              const aimRerolls  = this._groundAimRerolls > 0
                ? (hasAccurate ? 2 : 1)
                : 0;
              this[`_groundToggle_ground-aim`] = false;
              this._groundAimRerolls = 0;

              openPlayerRoller(actor, this._token, {
                officer:           readOfficerStats(actor),
                stationId:         "tactical",
                weaponContext:     weaponCtx,
                groundMode:        true,
                groundIsNpc:       CombatHUD.isGroundNpcActor(actor),
                difficulty:        2 + guardPenalty + pronePenalty,
                defaultAttr:       "control",
                defaultDisc:       "security",
                taskLabel:         `Attack — ${weapon.name}`,
                taskContext:       `Control + Security · Difficulty ${2 + guardPenalty + pronePenalty}${guardPenalty ? " (+1 Guard)" : ""}${pronePenalty ? " (+1 Prone)" : ""}`,
                aimRerolls,
              });
            } else if (choice === "hitmiss") {
              // Pre-set the stun toggle to match the declared intent
              this._pendingStunMode = useStun;
              this._selectWeapon(weapon);
            }
            return; // skip ship weapon logic below
          }

          // ── Opposed task intercept — check BEFORE opening any roller or hit/miss ──
          // If the target has Evasive Action or Defensive Fire active, post the
          // defender card and store a pending task in world settings so the
          // attacker's roller opens automatically once the defender confirms.
          const opposed = await this._checkOpposedTask(weapon.name);
          if (opposed.proceed === "pending") {
            // Build base roller opts now — opposedDifficulty will be injected
            // by the GM socket handler when the defender's successes arrive.
            const _hasTS      = CombatHUD.hasTargetingSolution(this._token);
            const _hasRFT     = hasRapidFireTorpedoLauncher(actor);
            const _isTorpedo  = config?.type === "torpedo";

            // ── Area / Spread mode picker for arrays & salvos ─────────────
            const _hasAreaQ_op   = weapon.system?.qualities?.area   ?? false;
            const _hasSpreadQ_op = weapon.system?.qualities?.spread ?? false;
            const _needsMode_op  = (config?.type === "beam" && config?.isArray)
                                || (config?.type === "torpedo" && config?.salvo)
                                || _hasAreaQ_op || _hasSpreadQ_op;
            let _salvoMode_op = this._pendingSalvoMode ?? "area";
            if (_needsMode_op && !this._pendingSalvoMode) {
              // Mode was not pre-selected in the HUD (e.g. came through roller path)
              // — ask now before storing the pending task.
              const _poolWord_op = isNpcShip ? "threat" : "momentum";
              const _modeChoice_op = await foundry.applications.api.DialogV2.wait({
                window:  { title: `${weapon.name} — Attack Mode` },
                content: `
                  <div style="font-family:${LC.font};padding:4px 0;">
                    <div style="font-size:11px;color:${LC.text};margin-bottom:8px;">
                      Choose how <strong style="color:${LC.primary};">${weapon.name}</strong> fires:
                    </div>
                    <div style="font-size:10px;color:${LC.textDim};line-height:1.6;padding:4px 8px;
                      border-left:3px solid ${LC.borderDim};border-radius:0 2px 2px 0;">
                      ⚡ <strong>Area</strong> — attack one primary target; same damage can be applied
                      to additional nearby ships after the roll (1 ${_poolWord_op} each)<br>
                      ↔ <strong>Spread</strong> — reduces Devastating Attack cost from 2 → 1 ${_poolWord_op}
                    </div>
                  </div>`,
                buttons: [
                  { action: "area",   label: "⚡ Area",   icon: "fas fa-bolt",         default: true },
                  { action: "spread", label: "↔ Spread",  icon: "fas fa-arrows-alt-h"               },
                  { action: "cancel", label: "Cancel",     icon: "fas fa-times"                      },
                ],
              });
              if (!_modeChoice_op || _modeChoice_op === "cancel") return;
              _salvoMode_op = _modeChoice_op;
            }

            const _weaponCtx  = {
              name:      weapon.name,
              isTorpedo: _isTorpedo,
              damage:    total,
              qualities: this._weaponQualityString(weapon),
              salvoMode: _salvoMode_op,
            };
            const _tacticalActors   = getStationOfficers(actor, "tactical");
            const _tacticalOfficer  = _tacticalActors[0] ? readOfficerStats(_tacticalActors[0]) : null;
            const _hasAttackPattern = hasCondition(this._token, "attack-pattern");
            const _helmActors       = getStationOfficers(actor, "helm");
            const _helmActor        = _helmActors[0] ?? null;
            const _helmStats        = _helmActor ? readOfficerStats(_helmActor) : null;
            const _attackRunActive  = _hasAttackPattern && hasAttackRun(_helmActor);
            const _defLabel         = opposed.defMode === "evasive-action" ? "Evasive Action"
                                    : opposed.defMode === "defensive-fire"  ? "Defensive Fire" : "Cover";

            await game.settings.set("sta2e-toolkit", "pendingOpposedTask", {
              taskId:          `${this._token.id}-${Date.now()}`,
              attackerUserId:  game.userId,
              attackerTokenId: this._token.id,
              attackerActorId: actor.id,
              isNpcAttacker:   isNpcShip,
              defMode:         opposed.defMode,
              weaponName:      weapon.name,
              rollerOpts: {
                hasTargetingSolution: _hasTS,
                hasRapidFireTorpedo:  _hasRFT && _isTorpedo,
                weaponContext:        _weaponCtx,
                stationId:            "tactical",
                officer:              _tacticalOfficer,
                crewQuality:          isNpcShip && !_tacticalOfficer ? CombatHUD.getCrewQuality(actor) : null,
                hasAttackPattern:     _hasAttackPattern,
                helmOfficer:          _helmStats,
                attackRunActive:      _attackRunActive,
                taskLabel:            `Attack — ${weapon.name}`,
                taskContext:          `Opposed — ${_defLabel}`,
                // opposedDifficulty / opposedDefenseType / defenderSuccesses
                // are injected by the GM socket handler
              },
            });
            return; // Bail — roller opens automatically when defender confirms
          }
          if (!opposed.proceed) return; // unexpected cancel path

          // Store opposed context for the roller and hit/miss flow
          this._opposedDifficulty  = opposed.difficulty;
          this._opposedDefenseType = opposed.defenseType;
          this._defenderSuccesses  = opposed.defenderSuccesses;

          if (isNpcShip) {
            // NPC ships: ask GM whether to roll dice or resolve as direct hit/miss
            const hasTS     = CombatHUD.hasTargetingSolution(this._token);
            const hasRFT    = hasRapidFireTorpedoLauncher(actor);
            const isTorpedo = config?.type === "torpedo";
            const weaponCtx = {
              name:      weapon.name,
              isTorpedo,
              damage:    total,
              qualities: this._weaponQualityString(weapon),
            };

            const choice = await foundry.applications.api.DialogV2.wait({
              window:  { title: `${weapon.name} — Attack Method` },
              content: `
                <div style="font-family:${LC.font};padding:4px 0;">
                  <div style="font-size:11px;color:${LC.text};margin-bottom:8px;">
                    <strong style="color:${LC.primary};">${actor.name}</strong>
                    fires <strong>${weapon.name}</strong>
                    ${isTorpedo ? `<span style="color:${LC.green};"> (Torpedo)</span>` : ""}
                    — Dmg <strong style="color:${LC.tertiary};">${total}</strong>
                  </div>
                  <div style="font-size:10px;color:${LC.textDim};">How do you want to resolve this attack?</div>
                </div>`,
              buttons: [
                {
                  action:  "roller",
                  label:   "🎲 Dice Roller",
                  icon:    "fas fa-dice-d20",
                  default: true,
                },
                {
                  action:  "hitmiss",
                  label:   "⚡ Hit / Miss",
                  icon:    "fas fa-crosshairs",
                },
                {
                  action:  "cancel",
                  label:   "Cancel",
                  icon:    "fas fa-times",
                },
              ],
            });

            if (choice === "roller") {
              // Determine area/spread mode for weapons that need it
              const _hasAreaQ   = weapon.system?.qualities?.area   ?? false;
              const _hasSpreadQ = weapon.system?.qualities?.spread ?? false;
              const _needsMode  = (config?.type === "beam" && config?.isArray)
                               || (config?.type === "torpedo" && config?.salvo)
                               || _hasAreaQ || _hasSpreadQ;
              let salvoMode = "area";
              if (_needsMode) {
                const modeChoice = await foundry.applications.api.DialogV2.wait({
                  window:  { title: `${weapon.name} — Attack Mode` },
                  content: `
                    <div style="font-family:${LC.font};padding:4px 0;">
                      <div style="font-size:11px;color:${LC.text};margin-bottom:8px;">
                        Choose how <strong style="color:${LC.primary};">${weapon.name}</strong> fires:
                      </div>
                      <div style="font-size:10px;color:${LC.textDim};line-height:1.6;padding:4px 8px;
                        border-left:3px solid ${LC.borderDim};border-radius:0 2px 2px 0;">
                        ⚡ <strong>Area</strong> — attack one primary target; same damage can be applied
                        to additional nearby ships after the roll (1 threat each)<br>
                        ↔ <strong>Spread</strong> — reduces Devastating Attack cost from 2 → 1 threat
                      </div>
                    </div>`,
                  buttons: [
                    { action: "area",   label: "⚡ Area",   icon: "fas fa-bolt",         default: true },
                    { action: "spread", label: "↔ Spread",  icon: "fas fa-arrows-alt-h"               },
                    { action: "cancel", label: "Cancel",     icon: "fas fa-times"                      },
                  ],
                });
                if (!modeChoice || modeChoice === "cancel") return;
                salvoMode = modeChoice;
              }
              weaponCtx.salvoMode = salvoMode;

              const tacticalOfficers = getStationOfficers(actor, "tactical");
              const tacticalOfficer  = tacticalOfficers.length > 0
                ? readOfficerStats(tacticalOfficers[0]) : null;

              // Attack Pattern: if active, Helm officer assists the attack roll
              // using Control + Conn. Also check for Attack Run talent which
              // suppresses the Difficulty-1 penalty on the attacker's own ship.
              const hasAttackPattern  = hasCondition(this._token, "attack-pattern");
              const helmOfficerActors = getStationOfficers(actor, "helm");
              const helmOfficerActor  = helmOfficerActors[0] ?? null;
              const helmOfficerStats  = helmOfficerActor ? readOfficerStats(helmOfficerActor) : null;
              const attackRunActive   = hasAttackPattern && hasAttackRun(helmOfficerActor);

              openNpcRoller(actor, this._token, {
                hasTargetingSolution: hasTS,
                hasRapidFireTorpedo:  hasRFT && isTorpedo,
                weaponContext:        weaponCtx,
                stationId:            "tactical",
                officer:              tacticalOfficer,
                crewQuality:          !tacticalOfficer ? CombatHUD.getCrewQuality(actor) : null,
                opposedDifficulty:    this._opposedDifficulty,
                opposedDefenseType:   this._opposedDefenseType,
                defenderSuccesses:    this._defenderSuccesses,
                hasAttackPattern,
                helmOfficer:          helmOfficerStats,
                attackRunActive,
                taskLabel:            `Attack — ${weaponCtx?.name ?? "Weapon"}`,
                taskContext:          this._opposedDefenseType
                  ? `Opposed — ${this._opposedDefenseType === "evasive-action" ? "Evasive Action" : this._opposedDefenseType === "defensive-fire" ? "Defensive Fire" : "Cover"}`
                  : null,
              });
            } else if (choice === "hitmiss") {
              this._selectWeapon(weapon);
            }
            // "cancel" — do nothing
          } else {
            // Player ships: same Dice Roller / Hit/Miss choice as NPC ships
            const choice = await foundry.applications.api.DialogV2.wait({
              window:  { title: `${weapon.name} — Attack Method` },
              content: `
                <div style="font-family:${LC.font};padding:4px 0;">
                  <div style="font-size:11px;color:${LC.text};margin-bottom:8px;">
                    <strong style="color:${LC.primary};">${actor.name}</strong>
                    fires <strong>${weapon.name}</strong>
                    ${config?.type === "torpedo" ? `<span style="color:${LC.green};"> (Torpedo)</span>` : ""}
                    — Dmg <strong style="color:${LC.tertiary};">${total}</strong>
                  </div>
                  <div style="font-size:10px;color:${LC.textDim};">How do you want to resolve this attack?</div>
                </div>`,
              buttons: [
                { action: "roller",  label: "🎲 Dice Roller", icon: "fas fa-dice-d20", default: true },
                { action: "hitmiss", label: "⚡ Hit / Miss",  icon: "fas fa-crosshairs" },
                { action: "cancel",  label: "Cancel",          icon: "fas fa-times" },
              ],
            });

            if (choice === "roller") {
              const hasTS     = CombatHUD.hasTargetingSolution(this._token);
              const hasRFT    = hasRapidFireTorpedoLauncher(actor);
              const isTorpedo = config?.type === "torpedo";

              // Determine area/spread mode for weapons that need it
              const _hasAreaQ   = weapon.system?.qualities?.area   ?? false;
              const _hasSpreadQ = weapon.system?.qualities?.spread ?? false;
              const _needsMode  = (config?.type === "beam" && config?.isArray)
                               || (config?.type === "torpedo" && config?.salvo)
                               || _hasAreaQ || _hasSpreadQ;
              let salvoMode = "area";
              if (_needsMode) {
                const modeChoice = await foundry.applications.api.DialogV2.wait({
                  window:  { title: `${weapon.name} — Attack Mode` },
                  content: `
                    <div style="font-family:${LC.font};padding:4px 0;">
                      <div style="font-size:11px;color:${LC.text};margin-bottom:8px;">
                        Choose how <strong style="color:${LC.primary};">${weapon.name}</strong> fires:
                      </div>
                      <div style="font-size:10px;color:${LC.textDim};line-height:1.6;padding:4px 8px;
                        border-left:3px solid ${LC.borderDim};border-radius:0 2px 2px 0;">
                        ⚡ <strong>Area</strong> — attack one primary target; same damage can be applied
                        to additional nearby ships after the roll (1 momentum / 1 threat each)<br>
                        ↔ <strong>Spread</strong> — reduces Devastating Attack cost from 2 → 1 momentum
                      </div>
                    </div>`,
                  buttons: [
                    { action: "area",   label: "⚡ Area",   icon: "fas fa-bolt",         default: true },
                    { action: "spread", label: "↔ Spread",  icon: "fas fa-arrows-alt-h"               },
                    { action: "cancel", label: "Cancel",     icon: "fas fa-times"                      },
                  ],
                });
                if (!modeChoice || modeChoice === "cancel") return;
                salvoMode = modeChoice;
              }

              const weaponCtx = {
                name:      weapon.name,
                isTorpedo,
                damage:    total,
                qualities: this._weaponQualityString(weapon),
                salvoMode,
              };
              const tacticalActors    = getStationOfficers(actor, "tactical");
              const tacticalStats     = tacticalActors[0] ? readOfficerStats(tacticalActors[0]) : null;
              const hasAttackPattern  = hasCondition(this._token, "attack-pattern");
              const helmOfficerActors = getStationOfficers(actor, "helm");
              const helmOfficerActor  = helmOfficerActors[0] ?? null;
              const helmOfficerStats  = helmOfficerActor ? readOfficerStats(helmOfficerActor) : null;
              const attackRunActive   = hasAttackPattern && hasAttackRun(helmOfficerActor);

              openPlayerRoller(actor, this._token, {
                hasTargetingSolution: hasTS,
                hasRapidFireTorpedo:  hasRFT && isTorpedo,
                weaponContext:        weaponCtx,
                stationId:            "tactical",
                officer:              tacticalStats,
                opposedDifficulty:    this._opposedDifficulty,
                opposedDefenseType:   this._opposedDefenseType,
                defenderSuccesses:    this._defenderSuccesses,
                hasAttackPattern,
                helmOfficer:          helmOfficerStats,
                attackRunActive,
                taskLabel:            `Attack — ${weaponCtx.name}`,
                taskContext:          this._opposedDefenseType
                  ? `Opposed — ${this._opposedDefenseType === "evasive-action" ? "Evasive Action" : this._opposedDefenseType === "defensive-fire" ? "Defensive Fire" : "Cover"}`
                  : null,
              });
            } else if (choice === "hitmiss") {
              this._selectWeapon(weapon);
            }
            // "cancel" — do nothing
          }
        });
        row.appendChild(btn);
      });
    }

    section.appendChild(row);
    return section;
  }

  _selectWeapon(weapon) {
    this._pendingWeapon = weapon;
    const _cfg = getWeaponConfig(weapon);
    const _hasAreaQuality   = weapon.system?.qualities?.area   ?? false;
    const _hasSpreadQuality = weapon.system?.qualities?.spread ?? false;
    const _needsMode = (_cfg?.type === "beam"    && _cfg?.isArray)
                    || (_cfg?.type === "torpedo" && _cfg?.salvo)
                    || _hasAreaQuality || _hasSpreadQuality;
    this._pendingSalvoMode = _needsMode ? "area" : null;
    this._refresh();
    // Scroll hit/miss into view
    setTimeout(() => {
      this._el?.querySelector(".sta2e-chud-hitmiss")?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }

  /**
   * Check if any targeted token has an active defense (Evasive Action,
   * Defensive Fire, or Cover). Posts the defender's roll card and returns a
   * pending sentinel so the caller can store the attack context and bail.
   *
   * Delegates to the standalone checkOpposedTaskForTokens() so the same logic
   * can be invoked from the NPC roller's Roll button (character-sheet path)
   * without requiring a live CombatHUD instance.
   */
  async _checkOpposedTask(weaponName) {
    return checkOpposedTaskForTokens(weaponName, this._token, Array.from(game.user.targets));
  }

  // ── Shields ────────────────────────────────────────────────────────────────

  _buildShields(actor) {
    const section = this._buildSection("SHIELDS");
    const sv      = actor.system.shields.value ?? 0;
    const sm      = actor.system.shields.max   ?? 0;
    const pct     = sm > 0 ? sv / sm : 0;
    const color   = pct > 0.5 ? LC.green : pct > 0.25 ? LC.yellow : LC.red;

    // ── Info row: current / max and percentage ──────────────────────────────
    const infoRow = document.createElement("div");
    infoRow.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 6px 10px 4px;
    `;

    const valueSpan = document.createElement("span");
    valueSpan.style.cssText = `
      font-size: 13px;
      font-weight: 700;
      color: ${color};
      font-family: ${LC.font};
      letter-spacing: 0.04em;
    `;
    valueSpan.textContent = `${sv} / ${sm}`;

    const pctSpan = document.createElement("span");
    pctSpan.style.cssText = `
      font-size: 10px;
      color: ${LC.textDim};
      font-family: ${LC.font};
      letter-spacing: 0.04em;
      flex: 1;
    `;
    pctSpan.textContent = `${Math.round(pct * 100)}%`;

    infoRow.appendChild(valueSpan);
    infoRow.appendChild(pctSpan);

    // ── Toggle button (portrait/bubble mode) ────────────────────────────────
    if (sm > 0) {
      const toggleBtn = document.createElement("button");
      toggleBtn.title = this._shieldPortraitMode ? "Switch to bubble view" : "Switch to portrait view";
      toggleBtn.style.cssText = `
        width: 20px;
        height: 20px;
        min-width: 20px;
        min-height: 20px;
        padding: 2px;
        border: 1px solid ${LC.tertiary};
        border-radius: 2px;
        background: transparent;
        color: ${LC.tertiary};
        cursor: pointer;
        font-size: 11px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s, border-color 0.15s;
      `;
      toggleBtn.textContent = this._shieldPortraitMode ? "◯" : "⬚";
      toggleBtn.addEventListener("mouseenter", () => {
        toggleBtn.style.background = `rgba(153,153,153,0.2)`;
      });
      toggleBtn.addEventListener("mouseleave", () => {
        toggleBtn.style.background = "transparent";
      });
      toggleBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        this._toggleShieldPortraitMode();
      });
      infoRow.appendChild(toggleBtn);
    }

    section.appendChild(infoRow);

    // ── Bubble row: one circle per max shield point ─────────────────────────
    if (sm > 0 && !this._shieldPortraitMode) {
      const bubbleRow = document.createElement("div");
      bubbleRow.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        padding: 2px 10px 8px;
      `;

      for (let i = 0; i < sm; i++) {
        const filled = i < sv;
        const bubble = document.createElement("button");
        bubble.title = filled
          ? `Shield ${i + 1} active — click to reduce to ${i}`
          : `Shield ${i + 1} depleted — click to restore to ${i + 1}`;
        bubble.style.cssText = `
          width: 12px;
          height: 12px;
          min-width: 12px;
          min-height: 12px;
          border-radius: 50%;
          border: 1px solid ${color};
          background: ${filled ? color : "transparent"};
          cursor: pointer;
          padding: 0;
          box-sizing: border-box;
          transition: background 0.1s, border-color 0.1s, opacity 0.1s;
          opacity: ${filled ? "1" : "0.35"};
        `;
        bubble.addEventListener("mouseenter", () => {
          bubble.style.opacity = "0.75";
        });
        bubble.addEventListener("mouseleave", () => {
          bubble.style.opacity = filled ? "1" : "0.35";
        });
        bubble.addEventListener("click", async () => {
          const newValue = filled ? i : i + 1;
          await actor.update({ "system.shields.value": newValue });
          this._refresh();
        });
        bubbleRow.appendChild(bubble);
      }
      section.appendChild(bubbleRow);
    }

    // ── Portrait row: ship portrait with dynamic glow ───────────────────────
    if (sm > 0 && this._shieldPortraitMode) {
      const portraitUrl = this._getPortraitUrl(actor);
      if (portraitUrl) {
        const { color: glowColor, filterCSS } = this._calculateShieldGlow(pct);

        const portraitRow = document.createElement("div");
        portraitRow.style.cssText = `
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 6px 10px 8px;
        `;

        // Add pulsing animation for the glow effect
        const animationId = `sta2e-shield-pulse-${Math.random().toString(36).substr(2, 9)}`;
        const styleTag = document.createElement("style");
        styleTag.textContent = `
          @keyframes ${animationId} {
            0%, 100% { filter: drop-shadow(0 0 8px ${glowColor}); }
            50% { filter: drop-shadow(0 0 16px ${glowColor}); }
          }
          .${animationId} {
            animation: ${animationId} 2s ease-in-out infinite;
          }
        `;
        document.head.appendChild(styleTag);

        const portrait = document.createElement("div");
        portrait.className = animationId;
        portrait.style.cssText = `
          width: 225px;
          height: 225px;
          min-width: 225px;
          min-height: 225px;
          background-image: url('${portraitUrl}');
          background-size: cover;
          background-position: center;
          border-radius: 2px;
          opacity: 1;
          transform: rotate(-90deg);
        `;
        portrait.title = `${sv}/${sm} shields — click to adjust`;

        // No click handler - users can toggle to bubble view to adjust shields

        portraitRow.appendChild(portrait);
        section.appendChild(portraitRow);

      }
    }

    // ── Shaken button ───────────────────────────────────────────────────────
    if (actor.system?.shaken) {
      const shakenRow = document.createElement("div");
      shakenRow.style.cssText = `padding: 2px 10px 8px;`;
      const shakenBtn = document.createElement("button");
      shakenBtn.style.cssText = `
        width: 100%;
        padding: 3px 8px;
        background: rgba(204,0,0,0.15);
        border: 1px solid ${LC.red};
        border-radius: 2px;
        color: ${LC.red};
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        cursor: ${game.user.isGM ? "pointer" : "default"};
        font-family: ${LC.font};
      `;
      shakenBtn.textContent = "SHAKEN";
      shakenBtn.title = game.user.isGM ? "Click to clear Shaken status" : "Ship is Shaken";
      if (game.user.isGM) {
        shakenBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await actor.update({ "system.shaken": false });
          this._refresh();
        });
      }
      shakenRow.appendChild(shakenBtn);
      section.appendChild(shakenRow);
    }

    return section;
  }

  // ── Hit / Miss ─────────────────────────────────────────────────────────────

  _buildHitMiss() {
    const wrap = document.createElement("div");
    wrap.className = "sta2e-chud-hitmiss";

    if (!this._pendingWeapon) {
      wrap.style.display = "none";
      return wrap;
    }

    wrap.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 5px 8px;
      background: rgba(255,153,0,0.05);
      border-top: 1px solid ${LC.borderDim};
    `;

    // ── Weapon label row ──
    const labelRow = document.createElement("div");
    labelRow.style.cssText = "display:flex;align-items:center;gap:6px;";

    const label = document.createElement("div");
    label.style.cssText = `font-size:10px;color:${LC.tertiary};flex:1;
      font-family:${LC.font};letter-spacing:0.06em;text-transform:uppercase;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    label.textContent = this._pendingWeapon.name;

    const hitBtn    = this._actionButton("✓ HIT",  `rgba(0,100,0,0.3)`,  LC.green);
    const missBtn   = this._actionButton("✗ MISS", `rgba(120,0,0,0.3)`,  LC.red);
    const cancelBtn = this._actionButton("✕",      `rgba(0,0,0,0.3)`,    LC.textDim);

    hitBtn.addEventListener("click",    () => this._resolveWeapon(true));
    missBtn.addEventListener("click",   () => this._resolveWeapon(false));
    cancelBtn.addEventListener("click", () => {
      this._pendingWeapon      = null;
      this._pendingSalvoMode   = null;
      this._pendingStunMode    = true;   // reset to stun default
      this._opposedDifficulty  = null;
      this._opposedDefenseType = null;
      this._defenderSuccesses  = null;
      this._refresh();
    });

    labelRow.appendChild(label);
    labelRow.appendChild(hitBtn);
    labelRow.appendChild(missBtn);
    labelRow.appendChild(cancelBtn);
    wrap.appendChild(labelRow);

    // ── Opposed task banner ────────────────────────────────────────────────────
    if (this._opposedDifficulty !== null && this._opposedDefenseType) {
      const defLabel  = this._opposedDefenseType === "evasive-action" ? "Evasive Action" : this._opposedDefenseType === "defensive-fire" ? "Defensive Fire" : "Cover";
      const defIcon   = this._opposedDefenseType === "evasive-action" ? "↗️" : this._opposedDefenseType === "defensive-fire" ? "🛡️" : "🪨";
      const banner    = document.createElement("div");
      banner.style.cssText = `
        display:flex;align-items:center;gap:6px;
        padding:4px 8px;margin-top:3px;
        background:rgba(255,153,0,0.08);
        border-left:3px solid ${LC.primary};border-radius:2px;
        font-family:${LC.font};
      `;
      banner.innerHTML = `
        <span style="font-size:10px;">${defIcon}</span>
        <span style="font-size:9px;color:${LC.primary};font-weight:700;
          letter-spacing:0.06em;text-transform:uppercase;">
          Opposed — ${defLabel}
        </span>
        <span style="font-size:9px;color:${LC.tertiary};font-weight:700;margin-left:auto;">
          Difficulty ${this._opposedDifficulty}
        </span>
        <span style="font-size:9px;color:${LC.textDim};">
          (defender: ${this._defenderSuccesses} success${this._defenderSuccesses !== 1 ? "es" : ""})
        </span>
      `;
      wrap.appendChild(banner);
    }

    // ── Area / Spread toggle (beam arrays and torpedo salvos — no mode in ground combat) ──
    const config         = getWeaponConfig(this._pendingWeapon);
    const isGroundWeapon = this._pendingWeapon.type === "characterweapon2e";
    const hasStun        = this._pendingWeapon.system?.qualities?.stun    ?? false;
    const hasDeadly      = this._pendingWeapon.system?.qualities?.deadly  ?? false;
    const isDual         = hasStun && hasDeadly; // weapon can inflict either injury type

    const _isArray          = config?.type === "beam"    && config?.isArray;
    const _isSalvo          = config?.type === "torpedo" && config?.salvo;
    const _hasAreaQuality   = this._pendingWeapon.system?.qualities?.area   ?? false;
    const _hasSpreadQuality = this._pendingWeapon.system?.qualities?.spread ?? false;
    const _needsMode = (_isArray || _isSalvo || _hasAreaQuality || _hasSpreadQuality) && !isGroundWeapon;

    if (_needsMode) {
      const modeLabel     = _isArray ? "Arrays" : _isSalvo ? "Torpedo Salvo" : "Ship Weapon";
      const currentMode   = this._pendingSalvoMode ?? "area";
      const modeRow       = document.createElement("div");
      modeRow.style.cssText = "display:flex;align-items:center;gap:4px;padding-top:2px;";

      const makeBtn = (mode, icon, label) => {
        const active = currentMode === mode;
        const btn    = document.createElement("button");
        btn.style.cssText = [
          "flex:1;padding:3px 6px;border-radius:2px;font-size:9px;font-weight:700;",
          "font-family:" + LC.font + ";letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;",
          "border:1px solid " + (active ? (mode === "area" ? LC.primary : LC.secondary) : LC.borderDim) + ";",
          "background:" + (active ? (mode === "area" ? "rgba(255,153,0,0.18)" : "rgba(180,100,255,0.2)") : "rgba(0,0,0,0.2)") + ";",
          "color:" + (active ? (mode === "area" ? LC.primary : LC.secondary) : LC.textDim) + ";",
        ].join("");
        btn.textContent = (active ? "◈ " : "◇ ") + label;
        const _poolWord = CombatHUD.isNpcShip(this._token?.actor) ? "threat" : "momentum";
        btn.title = mode === "area"
          ? `${modeLabel} — Area: attack one primary target; same damage can be applied to additional nearby ships after the roll (1 momentum / 1 threat each)`
          : `${modeLabel} — Spread: reduces Devastating Attack cost from 2 → 1 ${_poolWord}`;
        btn.addEventListener("click", () => {
          this._pendingSalvoMode = mode;
          this._refresh();
          setTimeout(() => {
            this._el?.querySelector(".sta2e-chud-hitmiss")?.scrollIntoView({ behavior: "smooth" });
          }, 50);
        });
        return btn;
      };

      modeRow.appendChild(makeBtn("area",   "⚡", "AREA"));
      modeRow.appendChild(makeBtn("spread", "↔", "SPREAD"));
      wrap.appendChild(modeRow);
    }

    // ── Stun / Deadly toggle (ground weapons with BOTH injury types only) ──
    // Stun-only or Deadly-only weapons have no choice; the toggle is irrelevant.
    if (isGroundWeapon && isDual) {
      const modeRow = document.createElement("div");
      modeRow.style.cssText = "display:flex;align-items:center;gap:4px;padding-top:2px;";

      const stunMode = this._pendingStunMode; // true = using Stun, false = Deadly

      const makeInjuryBtn = (label, active, color, title, onClick) => {
        const b = document.createElement("button");
        const rgb = color === LC.secondary ? "180,100,255" : "255,50,50";
        b.style.cssText = [
          "flex:1;padding:3px 6px;border-radius:2px;font-size:9px;font-weight:700;",
          "font-family:" + LC.font + ";letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;",
          "border:1px solid " + (active ? color : LC.borderDim) + ";",
          "background:" + (active ? "rgba(" + rgb + ",0.15)" : "rgba(0,0,0,0.2)") + ";",
          "color:" + (active ? color : LC.textDim) + ";",
        ].join("");
        b.textContent = label;
        b.title = title;
        b.addEventListener("click", onClick);
        return b;
      };

      const scroll = () => setTimeout(() => {
        this._el?.querySelector(".sta2e-chud-hitmiss")?.scrollIntoView({ behavior: "smooth" });
      }, 50);

      modeRow.appendChild(makeInjuryBtn(
        stunMode ? "⚡ STUN" : "○ STUN", stunMode, LC.secondary,
        "Inflict Stun injury — target is Incapacitated if not avoided",
        () => { this._pendingStunMode = true;  this._refresh(); scroll(); }
      ));
      modeRow.appendChild(makeInjuryBtn(
        !stunMode ? "☠ DEADLY" : "○ DEADLY", !stunMode, LC.red,
        "Inflict Deadly injury — target is Dying or Dead if not avoided",
        () => { this._pendingStunMode = false; this._refresh(); scroll(); }
      ));

      wrap.appendChild(modeRow);
    }

    return wrap;
  }

  /**
   * Sum the Protection value of all equipped armor on a character actor.
   * STA 2e armor items use type "armor" with system.protection (number).
   * Also checks type "equipment" in case the system uses that type for armor.
   * Also checks for the Brak'lul Klingon species ability (grants +1 Protection,
   * stacks with armor). Matched by name containing "brak'lul" or "braklul".
   * Returns 0 if no armor or ability is found.
   */
  static _getTargetProtection(actor) {
    if (!actor) return 0;
    let total = 0;
    let hasBraklul = false;

    for (const item of actor.items ?? []) {
      // Armor / equipment
      if (item.type === "armor" || item.type === "equipment") {
        const equipped = item.system?.equipped ?? true;
        if (!equipped) continue;
        const prot = Number(item.system?.protection ?? item.system?.Protection ?? 0);
        if (!isNaN(prot)) total += prot;
      }

      // Brak'lul species ability — +1 Protection, stacks with armor
      const nameLower = item.name?.toLowerCase() ?? "";
      if (nameLower.includes("brak'lul") || nameLower.includes("braklul")) {
        hasBraklul = true;
      }
    }

    if (hasBraklul) total += 1;

    return total;
  }

  /**
   * Play the First Aid success animation + sound on the target token.
   * Safe to call from any client — Sequencer handles routing.
   */
  static _playFirstAidEffect(tokenDoc) {
    try {
      if (!window.Sequence) return;
      const canvasToken = tokenDoc?.id
        ? canvas.tokens?.get(tokenDoc.id)
        : null;
      if (!canvasToken) return;

      let soundPath = null;
      try { soundPath = game.settings.get("sta2e-toolkit", "sndGroundFirstAid") || null; }
      catch { /* setting not registered yet */ }

      const s = new window.Sequence();
      const firstAidAnimPath = (() => {
        try { return game.settings.get("sta2e-toolkit", "animationOverrides")
          ?.groundTasks?.firstAid?.anim || "jb2a.condition.boon.01.016.green"; }
        catch { return "jb2a.condition.boon.01.016.green"; }
      })();
      if (soundPath) s.sound().file(soundPath).volume(1);
      s.effect()
        .file(firstAidAnimPath)
        .atLocation(canvasToken)
        .scaleToObject(1.5)
        .fadeIn(200).fadeOut(400);
      s.play();
    } catch(e) {
      console.warn("STA2e Toolkit | First Aid animation failed:", e);
    }
  }

  /** Returns true if the actor has the Brak'lul species ability. */
  static _hasBraklul(actor) {
    if (!actor) return false;
    return actor.items?.some(i => {
      const n = i.name?.toLowerCase() ?? "";
      return n.includes("brak'lul") || n.includes("braklul");
    }) ?? false;
  }

  async _resolveWeapon(isHit) {
    const weapon  = this._pendingWeapon;
    const token   = this._token;
    const actor   = token.actor;
    const targets = Array.from(game.user.targets);

    if (targets.length === 0) {
      ui.notifications.warn("No targets selected. Select a target token first.");
      return;
    }

    const config        = getWeaponConfig(weapon);
    const isGroundWeapon = weapon.type === "characterweapon2e";

    // ── Ground combat path ─────────────────────────────────────────────────
    if (isGroundWeapon) {
      const hasStun    = weapon.system?.qualities?.stun   ?? false;
      const hasDeadly  = weapon.system?.qualities?.deadly ?? false;
      const isDual     = hasStun && hasDeadly;
      const useStun    = hasStun && (!hasDeadly || this._pendingStunMode);
      const severity   = weapon.system?.severity ?? 0;
      // Threat for Deadly was already applied at weapon declaration (before the roll)
      const attackerProfile    = CombatHUD.getGroundCombatProfile(token?.actor, token?.document ?? null);
      const deadlyCostsThreat  = !useStun && hasDeadly && !!attackerProfile?.isPlayerOwned;

      const targetData = targets.map(t => {
        const tActor     = t.actor;
        const protection = CombatHUD._getTargetProtection(tActor);
        const hasBraklul = CombatHUD._hasBraklul(tActor);
        const rawPotency = severity - protection;
        const potency    = severity > 0 ? Math.max(1, rawPotency) : 0;
        const profile = CombatHUD.getGroundCombatProfile(tActor, t.document);
        return {
          tokenId:       t.id,
          actorId:       tActor?.id,
          name:          t.name,
          npcType:       profile.npcType,
          isPlayerOwned: profile.isPlayerOwned,
          currentStress: tActor?.system?.stress?.value ?? 0,
          maxStress:     tActor?.system?.stress?.max   ?? 0,
          useStun,
          isDual,
          severity,
          protection,
          hasBraklul,
          potency,
          weaponName:    weapon.name,
          weaponImg:     weapon.img,
          weaponColor:   config?.color ?? "blue",
          weaponType:    config?.type  ?? "ground-beam",
          damage:        weapon.system?.damage ?? 0,
          qualities:     weapon.system?.qualities ?? {},
        };
      });

      ChatMessage.create({
        flags: { "sta2e-toolkit": { groundDamageCard: true } },
        content: CombatHUD._groundChatCard(token.name, weapon, targetData, isHit, useStun, deadlyCostsThreat),
        speaker: ChatMessage.getSpeaker({ token }),
      });

      setTimeout(async () => {
        try { await fireWeapon(config, isHit, token, targets); }
        catch(e) { console.warn("STA2e Toolkit | Ground weapon animation failed:", e); }
      }, 300);

      this._pendingWeapon   = null;
      this._pendingStunMode = true;
      this._refresh();
      return;
    }

    // ── Ship combat path — delegate to static method ───────────────────────
    await CombatHUD.resolveShipAttack(token, weapon, isHit, {
      salvoMode:          this._pendingSalvoMode ?? "area",
      defenderSuccesses:  this._defenderSuccesses,
      opposedDefenseType: this._opposedDefenseType,
    });
    this._pendingWeapon      = null;
    this._pendingSalvoMode   = null;
    this._pendingStunMode    = true;
    this._opposedDifficulty  = null;
    this._opposedDefenseType = null;
    this._defenderSuccesses  = null;
    this._refresh();
  }

  /**
   * Resolve a ship weapon attack — static so it can be called from the NPC roller
   * after determining hit/miss from the dice roll result.
   *
   * @param {Token}   token          - The attacking token
   * @param {Item}    weapon         - The weapon item
   * @param {boolean} isHit          - Whether the attack succeeded
   * @param {object}  opts
   * @param {string}  opts.salvoMode            - "area" | "spread" — pre-declared in HUD before roll
   * @param {boolean} opts.spreadDeclared        - Legacy compat: true forces salvoMode to "spread"
   * @param {number}  opts.rapidFireBonus         - Extra damage from Rapid-Fire Torpedo Launcher
   * @param {number}  opts.calibrateWeaponsBonus  - +1 damage from Calibrate Weapons minor action
   * @param {number|null} opts.defenderSuccesses   - Successes from defender's opposed roll (if any)
   * @param {string|null} opts.opposedDefenseType  - "evasive-action" | "defensive-fire" | null
   */
  static async resolveShipAttack(token, weapon, isHit, { salvoMode: _salvoMode = "area", spreadDeclared = false, rapidFireBonus = 0, calibrateWeaponsBonus = 0, defenderSuccesses = null, opposedDefenseType = null, attackerSuccesses = null, overrideTargets = null } = {}) {
    const actor   = token.actor;
    const targets = overrideTargets ?? Array.from(game.user.targets);

    if (targets.length === 0) {
      ui.notifications.warn("No targets selected. Select a target token first.");
      return;
    }

    const config = getWeaponConfig(weapon);

    // ── Area / Spread mode — pre-declared in HUD before the roll ─────────
    // spreadDeclared is kept for backward-compat (counterattack path).
    let salvoMode = _salvoMode ?? "area";
    if (spreadDeclared) salvoMode = "spread";

    // ── Scan for Weakness ──────────────────────────────────────────────────
    let scanBonus    = 0;
    let scanPiercing = false;
    const attackerTokenId = (token?.document ?? token)?.id ?? null;
    const scanTarget = targets.find(t => {
      if (!hasCondition(t, "scan-for-weakness")) return false;
      const srcId = doc(t).getFlag(MODULE, "scanForWeaknessSourceId") ?? null;
      return srcId === null || srcId === attackerTokenId;
    });
    if (isHit && scanTarget) {
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: "Scan for Weakness" },
        content: `<p style="margin:8px 0">Choose the Scan for Weakness effect against <strong>${scanTarget.name}</strong>:</p>`,
        buttons: [
          { action: "damage",   icon: "fas fa-bolt",       label: "+2 Damage",                default: true },
          { action: "piercing", icon: "fas fa-shield-alt", label: "Piercing (ignore Resistance)" },
        ],
      });
      if (choice === "damage")   scanBonus    = 2;
      if (choice === "piercing") scanPiercing = true;
      removeCondition(doc(scanTarget), "scan-for-weakness");
      doc(scanTarget).unsetFlag(MODULE, "scanForWeaknessSource").catch(() => {});
      doc(scanTarget).unsetFlag(MODULE, "scanForWeaknessSourceId").catch(() => {});
    }

    // ── Targeting Solution ─────────────────────────────────────────────────
    // Benefit is pre-declared via HUD sub-buttons before the roll; no post-roll dialog.
    let targetingSystem = null;
    let tsRerollGranted = false;
    if (isHit && CombatHUD.hasTargetingSolution(token)) {
      const tsData  = CombatHUD.getTargetingSolution(token);
      const benefit = tsData?.benefit ?? null;
      if (benefit === "reroll") {
        tsRerollGranted = true;
      } else if (benefit === "system") {
        targetingSystem = tsData.system ?? null;   // null → random roll at damage time
      } else if (benefit === "both") {             // Fast Targeting Systems
        tsRerollGranted = true;
        targetingSystem = tsData.system ?? null;
      }
      // If benefit was not pre-declared, the TS is consumed without effect
      await CombatHUD.setTargetingSolution(token, false);
    }

    // ── Build damage context ───────────────────────────────────────────────
    const hud = game.sta2eToolkit?.combatHud;
    const weaponPiercing = weapon.system?.qualities?.piercing ?? false;
    const isTorpedoWeapon = config?.type === "torpedo";
    const rfBonus = rapidFireBonus || ((isTorpedoWeapon && hasRapidFireTorpedoLauncher(actor)) ? 1 : 0);

    const cwBonus = calibrateWeaponsBonus;

    const targetData = targets.map(t => {
      const tActor      = t.actor;
      const { total }   = hud ? hud._weaponDamageBreakdown(weapon, actor)
                              : { total: weapon.system?.damage ?? 0 };
      const isPiercing  = scanPiercing || weaponPiercing;
      // Glancing Impact: if the target has Evasive Action active and their
      // Helm officer has the Glancing Impact talent, +2 Resistance
      const targetToken     = canvas.tokens?.get(t.id);
      const targetDefMode   = targetToken ? getDefenseMode(targetToken) : null;
      const glancingBonus   = (() => {
        if (isPiercing || targetDefMode !== "evasive-action") return 0;
        const helmOfficers = getStationOfficers(tActor, "helm");
        return helmOfficers.some(o => hasGlancingImpact(o)) ? 2 : 0;
      })();
      const baseResistance  = isPiercing ? 0 : (tActor?.system?.resistance ?? 0);
      const modulationBonus = (!isPiercing && CombatHUD.getModulatedShields(tActor)) ? 2 : 0;
      const resistance      = baseResistance + glancingBonus + modulationBonus;
      const rawDamage   = total + scanBonus + rfBonus + cwBonus;
      const finalDamage = Math.max(0, rawDamage - resistance);
      return {
        tokenId:              t.id,
        actorId:              tActor?.id,
        name:                 t.name,
        rawDamage,
        resistance,
        modulationBonus,
        finalDamage,
        scanBonus,
        rapidFireBonus:       rfBonus,
        calibrateWeaponsBonus: cwBonus,
        glancingBonus,
        scanPiercing:    isPiercing,
        currentShields:  tActor?.system?.shields?.value ?? 0,
        maxShields:      tActor?.system?.shields?.max   ?? 0,
        shaken:          tActor?.system?.shaken         ?? false,
        targetingSystem:    targetingSystem ?? null,
        tsRerollGranted,
        opposedDefenseType,
        defenderSuccesses,
        attackerSuccesses,
        attackerTokenId:    token?.id ?? null,
        salvoMode,
        area:           salvoMode === "area",
        spread:         salvoMode === "spread",
        attackerIsNpc:  CombatHUD.isNpcShip(actor),
        weaponImg:      weapon.img ?? null,
        weaponName:     weapon.name,
      };
    });

    const targetNames = targets.map(t => t.name).join(", ");
    ChatMessage.create({
      flags: { "sta2e-toolkit": { damageCard: true, targetData, weaponName: weapon.name } },
      content: hud
        ? hud._weaponChatCard(token.name, weapon, actor, targetNames, isHit, targetData, scanBonus, scanPiercing || weaponPiercing)
        : `<p>${token.name} attacked ${targetNames} — ${isHit ? "HIT" : "MISS"}</p>`,
      speaker: ChatMessage.getSpeaker({ token }),
    });

    setTimeout(async () => {
      await fireWeapon(config, isHit, token, targets, { spreadDeclared, salvoMode });
    }, 500);
  }

  // ── Quick Actions ──────────────────────────────────────────────────────────

  // ── Bridge Stations (tabbed Quick Actions) ───────────────────────────────

  _buildQuickActions() {
    const section = this._buildSection("BRIDGE STATIONS");

    // Overwrite the header bar to show the active station name on the right
    const _headerBar = section.firstChild;
    if (_headerBar) {
      const PREF_KEY_PEEK = "sta2e-toolkit-station-tab";
      const _savedPeek    = sessionStorage.getItem(PREF_KEY_PEEK) ?? BRIDGE_STATIONS[0].id;
      const _activePeek   = BRIDGE_STATIONS.find(s => s.id === _savedPeek) ?? BRIDGE_STATIONS[0];
      _headerBar.style.display         = "flex";
      _headerBar.style.justifyContent  = "space-between";
      _headerBar.style.alignItems      = "center";
      _headerBar.textContent           = "";
      const _left  = document.createElement("span");
      _left.textContent = "BRIDGE STATIONS";
      const _right = document.createElement("span");
      _right.textContent = _activePeek.label.toUpperCase();
      _right.style.cssText = `font-size:9px;letter-spacing:0.1em;opacity:0.75;`;
      _headerBar.appendChild(_left);
      _headerBar.appendChild(_right);
    }

    const token   = this._token;
    const actor   = token?.actor;
    const isShip  = actor?.type === "starship" || actor?.type === "spacecraft2e"
                    || actor?.items?.some(i => i.type === "starshipweapon2e");
    const targets = Array.from(game.user.targets);
    const hasTarget = targets.length > 0;

    // ── Station tab bar ───────────────────────────────────────────────────────
    const PREF_KEY = "sta2e-toolkit-station-tab";
    const savedTab = sessionStorage.getItem(PREF_KEY) ?? BRIDGE_STATIONS[0].id;
    const activeStation = BRIDGE_STATIONS.find(s => s.id === savedTab) ?? BRIDGE_STATIONS[0];

    const tabBar = document.createElement("div");
    tabBar.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 2px;
      padding: 6px 8px 0;
      border-bottom: 1px solid ${LC.borderDim};
    `;

    const panelWrap = document.createElement("div");
    panelWrap.style.cssText = "padding: 6px 8px 8px;";

    const buildPanel = (station) => {
      panelWrap.innerHTML = "";

      // Minor Actions — only render section if this station has minor actions
      const minorGrid = document.createElement("div");
      if (station.minor.length > 0) {
        const minorLabel = document.createElement("div");
        minorLabel.style.cssText = `
          font-size: 9px;
          color: ${LC.textDim};
          font-family: ${LC.font};
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 3px;
          margin-top: 2px;
        `;
        minorLabel.textContent = "⬡ Minor Actions";
        panelWrap.appendChild(minorLabel);

        minorGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:6px;";
        panelWrap.appendChild(minorGrid);
      }

      // Major Actions label — suppress divider if no minor actions above it
      const majorLabel = document.createElement("div");
      const hasSeparator = station.minor.length > 0;
      majorLabel.style.cssText = `
        font-size: 9px;
        color: ${LC.textDim};
        font-family: ${LC.font};
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 3px;
        margin-top: ${hasSeparator ? "0" : "2px"};
        ${hasSeparator ? `border-top: 1px solid ${LC.borderDim}; padding-top: 5px;` : ""}
      `;
      majorLabel.textContent = "◈ Major Actions";
      panelWrap.appendChild(majorLabel);

      const majorGrid = document.createElement("div");
      majorGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:4px;";
      panelWrap.appendChild(majorGrid);

      const makeActionBtn = (action, grid) => {
        // NPC-only actions are hidden entirely on player/PC ships
        if ((action.isNpcOnly ?? false) && !CombatHUD.isNpcShip(actor)) return;

        const isActive = action.isTargetingSolution
          ? CombatHUD.hasTargetingSolution(token)
          : action.isCalibrateWeapons
            ? CombatHUD.hasCalibrateWeapons(token)
            : action.isCalibratesensors
              ? CombatHUD.hasCalibratesensors(token)
              : action.defenseMode
                ? getDefenseMode(token) === action.key
                : action.key ? hasCondition(token, action.key) : false;

        const needsTarget = action.needsTarget ?? false;
        const isDisabled  = needsTarget && !hasTarget;
        const isInfo      = action.isInfo ?? false;

        const btn = document.createElement("button");
        btn.style.cssText = `
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
          padding: 4px 5px;
          background: ${isActive ? "rgba(255,153,0,0.15)" : isInfo ? "rgba(255,255,255,0.02)" : action.isRam ? "rgba(200,0,0,0.1)" : "rgba(255,153,0,0.04)"};
          border: 1px solid ${isActive ? LC.primary : isInfo ? LC.borderDim : action.isRam ? LC.red : LC.borderDim};
          border-radius: 2px;
          color: ${isActive ? LC.primary : isInfo ? LC.textDim : action.isRam ? LC.red : LC.text};
          font-size: 9px;
          font-weight: ${isActive || action.isRam ? "700" : "400"};
          font-family: ${LC.font};
          letter-spacing: 0.05em;
          text-transform: uppercase;
          cursor: ${isDisabled || isInfo ? "default" : "pointer"};
          opacity: ${isDisabled ? "0.4" : "1"};
          transition: all 0.12s;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        `;
        btn.title       = action.tooltip + (needsTarget && !hasTarget ? "\n⚠ Requires a targeted token" : "");
        btn.textContent = action.label;

        if (!isDisabled && !isInfo && action.key) {
          btn.addEventListener("mouseenter", () => {
            btn.style.borderColor = LC.tertiary;
            btn.style.background  = "rgba(255,204,102,0.08)";
          });
          btn.addEventListener("mouseleave", () => {
            btn.style.borderColor = isActive ? LC.primary : action.isRam ? LC.red : LC.borderDim;
            btn.style.background  = isActive ? "rgba(255,153,0,0.15)" : action.isRam ? "rgba(200,0,0,0.1)" : "rgba(255,153,0,0.04)";
          });
          btn.addEventListener("click", () => this._handleQuickAction(action, station));
        }

        grid.appendChild(btn);
      };

      station.minor.forEach(a => makeActionBtn(a, minorGrid));

      // Targeting Solution benefit chooser — tactical tab only, shown when TS is active
      if (station.id === "tactical" && CombatHUD.hasTargetingSolution(token)) {
        const tsData   = CombatHUD.getTargetingSolution(token);
        const _hasFTS  = actor ? hasFastTargetingSystems(actor) : false;
        const tsBenefit = tsData?.benefit ?? null;

        const _subBtnStyle = (active) => `
          padding:3px 5px;
          background:${active ? "rgba(255,153,0,0.15)" : "rgba(255,153,0,0.04)"};
          border:1px solid ${active ? LC.secondary : LC.borderDim};
          border-radius:2px;
          color:${active ? LC.primary : LC.secondary};
          font-size:8px;
          font-weight:700;
          font-family:${LC.font};
          letter-spacing:0.05em;
          text-transform:uppercase;
          cursor:pointer;
          transition:all 0.12s;
        `;

        // System picker row — 3-column grid, created once and toggled
        const sysPickerRow = document.createElement("div");
        sysPickerRow.style.cssText = `
          display:${tsBenefit === "system" || tsBenefit === "both" ? "grid" : "none"};
          grid-template-columns:1fr 1fr 1fr;
          gap:3px;
          margin-top:2px;
          margin-bottom:4px;
        `;
        const SYSTEMS = ["communications","computers","engines","sensors","structure","weapons"];
        for (const s of SYSTEMS) {
          const isChosenSys = (tsBenefit === "system" || tsBenefit === "both") && tsData.system === s;
          const sysBtn = document.createElement("button");
          sysBtn.style.cssText = _subBtnStyle(isChosenSys);
          sysBtn.textContent = CombatHUD.systemLabel(s);
          sysBtn.addEventListener("mouseenter", () => {
            sysBtn.style.borderColor = LC.secondary;
            sysBtn.style.background  = "rgba(255,153,0,0.08)";
          });
          sysBtn.addEventListener("mouseleave", () => {
            sysBtn.style.borderColor = isChosenSys ? LC.secondary : LC.borderDim;
            sysBtn.style.background  = isChosenSys ? "rgba(255,153,0,0.15)" : "rgba(255,153,0,0.04)";
          });
          sysBtn.addEventListener("click", () => this._handleQuickAction({ key: `ts-system-${s}` }, station));
          sysPickerRow.appendChild(sysBtn);
        }
        // Random option
        const rndBtn = document.createElement("button");
        rndBtn.style.cssText = _subBtnStyle(
          (tsBenefit === "system" || tsBenefit === "both") && tsData.system === null
        );
        rndBtn.textContent = "Roll Randomly";
        rndBtn.addEventListener("mouseenter", () => {
          rndBtn.style.borderColor = LC.secondary;
          rndBtn.style.background  = "rgba(255,153,0,0.08)";
        });
        rndBtn.addEventListener("mouseleave", () => {
          const wasChosen = (tsBenefit === "system" || tsBenefit === "both") && tsData.system === null;
          rndBtn.style.borderColor = wasChosen ? LC.secondary : LC.borderDim;
          rndBtn.style.background  = wasChosen ? "rgba(255,153,0,0.15)" : "rgba(255,153,0,0.04)";
        });
        rndBtn.addEventListener("click", () => this._handleQuickAction({ key: "ts-system-random" }, station));
        sysPickerRow.appendChild(rndBtn);

        const tsRow = document.createElement("div");
        tsRow.style.cssText = `display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:-2px;margin-bottom:2px;`;

        if (_hasFTS) {
          // Fast Targeting Systems: single "Choose System" button that expands picker;
          // reroll is automatic when a system is picked.
          const chooseSysBtn = document.createElement("button");
          chooseSysBtn.style.cssText = _subBtnStyle(tsBenefit === "both" || tsBenefit === "system");
          chooseSysBtn.style.gridColumn = "1 / -1";
          chooseSysBtn.textContent = "Choose System (+ auto reroll)";
          chooseSysBtn.addEventListener("mouseenter", () => {
            chooseSysBtn.style.borderColor = LC.secondary;
            chooseSysBtn.style.background  = "rgba(255,153,0,0.08)";
          });
          chooseSysBtn.addEventListener("mouseleave", () => {
            const active = tsBenefit === "both" || tsBenefit === "system";
            chooseSysBtn.style.borderColor = active ? LC.secondary : LC.borderDim;
            chooseSysBtn.style.background  = active ? "rgba(255,153,0,0.15)" : "rgba(255,153,0,0.04)";
          });
          chooseSysBtn.addEventListener("click", () => {
            sysPickerRow.style.display = sysPickerRow.style.display === "none" ? "grid" : "none";
          });
          tsRow.appendChild(chooseSysBtn);
        } else {
          // Standard TS: Reroll d20 | Target System (expands picker)
          const rerollBtn = document.createElement("button");
          rerollBtn.style.cssText = _subBtnStyle(tsBenefit === "reroll");
          rerollBtn.textContent = "Reroll d20";
          rerollBtn.addEventListener("mouseenter", () => {
            rerollBtn.style.borderColor = LC.secondary;
            rerollBtn.style.background  = "rgba(255,153,0,0.08)";
          });
          rerollBtn.addEventListener("mouseleave", () => {
            rerollBtn.style.borderColor = tsBenefit === "reroll" ? LC.secondary : LC.borderDim;
            rerollBtn.style.background  = tsBenefit === "reroll" ? "rgba(255,153,0,0.15)" : "rgba(255,153,0,0.04)";
          });
          rerollBtn.addEventListener("click", () => this._handleQuickAction({ key: "ts-reroll" }, station));
          tsRow.appendChild(rerollBtn);

          const targetSysBtn = document.createElement("button");
          targetSysBtn.style.cssText = _subBtnStyle(tsBenefit === "system");
          targetSysBtn.textContent = "Target System";
          targetSysBtn.addEventListener("mouseenter", () => {
            targetSysBtn.style.borderColor = LC.secondary;
            targetSysBtn.style.background  = "rgba(255,153,0,0.08)";
          });
          targetSysBtn.addEventListener("mouseleave", () => {
            targetSysBtn.style.borderColor = tsBenefit === "system" ? LC.secondary : LC.borderDim;
            targetSysBtn.style.background  = tsBenefit === "system" ? "rgba(255,153,0,0.15)" : "rgba(255,153,0,0.04)";
          });
          targetSysBtn.addEventListener("click", () => {
            const isExpanded = sysPickerRow.style.display !== "none";
            sysPickerRow.style.display = isExpanded ? "none" : "grid";
          });
          tsRow.appendChild(targetSysBtn);
        }

        panelWrap.insertBefore(sysPickerRow, majorLabel);
        panelWrap.insertBefore(tsRow, sysPickerRow);
      }

      // Calibrate Sensors benefit chooser — sensors tab only, shown when CS is active
      if (station.id === "sensors" && CombatHUD.hasCalibratesensors(token)) {
        const csRow = document.createElement("div");
        csRow.style.cssText = `display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:-2px;margin-bottom:6px;`;
        for (const [key, label] of [["cs-reroll", "↺ Reroll d20"], ["cs-ignore-trait", "⊘ Ignore Trait"]]) {
          const subBtn = document.createElement("button");
          subBtn.style.cssText = `
            padding:3px 5px;
            background:rgba(255,153,0,0.04);
            border:1px solid ${LC.borderDim};
            border-radius:2px;
            color:${LC.secondary};
            font-size:8px;
            font-weight:700;
            font-family:${LC.font};
            letter-spacing:0.05em;
            text-transform:uppercase;
            cursor:pointer;
            transition:all 0.12s;
          `;
          subBtn.textContent = label;
          subBtn.addEventListener("mouseenter", () => {
            subBtn.style.borderColor = LC.secondary;
            subBtn.style.background  = "rgba(255,153,0,0.08)";
          });
          subBtn.addEventListener("mouseleave", () => {
            subBtn.style.borderColor = LC.borderDim;
            subBtn.style.background  = "rgba(255,153,0,0.04)";
          });
          subBtn.addEventListener("click", () => this._handleQuickAction({ key }, station));
          csRow.appendChild(subBtn);
        }
        panelWrap.insertBefore(csRow, majorLabel);
      }

      station.major.forEach(a => makeActionBtn(a, majorGrid));

      // ── Cloaking Device — only on Tactical tab if actor has the talent ────────
      if (station.id === "tactical" && actor && hasCloakingDevice(actor)) {
        const isCloaked = actor.statuses?.has("invisible") ?? false;
        const cloakBtn  = document.createElement("button");
        cloakBtn.style.cssText = `
          display:flex;align-items:center;justify-content:center;gap:4px;
          padding:4px 5px;margin-top:4px;width:100%;
          background:${isCloaked ? "rgba(100,0,200,0.25)" : "rgba(80,0,160,0.08)"};
          border:1px solid ${isCloaked ? "#aa44ff" : LC.borderDim};
          border-radius:2px;
          color:${isCloaked ? "#cc88ff" : LC.text};
          font-size:9px;font-weight:${isCloaked ? "700" : "400"};
          font-family:${LC.font};letter-spacing:0.05em;text-transform:uppercase;
          cursor:pointer;transition:all 0.12s;
        `;
        cloakBtn.title       = isCloaked
          ? "Cloaking Device ACTIVE — click to decloak (minor action, costs Reserve Power)"
          : "Activate Cloaking Device (major action, Control+Engineering Diff 2, costs Reserve Power)";
        cloakBtn.textContent = isCloaked ? "👻 CLOAK: ACTIVE" : "👁 CLOAKING DEVICE";
        cloakBtn.addEventListener("mouseenter", () => {
          cloakBtn.style.borderColor = "#aa44ff";
          cloakBtn.style.background  = "rgba(100,0,200,0.15)";
        });
        cloakBtn.addEventListener("mouseleave", () => {
          cloakBtn.style.borderColor = isCloaked ? "#aa44ff" : LC.borderDim;
          cloakBtn.style.background  = isCloaked ? "rgba(100,0,200,0.25)" : "rgba(80,0,160,0.08)";
        });
        cloakBtn.addEventListener("click", () => this._handleCloakToggle(token));
        panelWrap.appendChild(cloakBtn);
      }

      // ── NPC Controls — Auto-Hit only (Tactical tab, NPC ship, weapon pending) ─
      if (station.id === "tactical" && isShip && CombatHUD.isNpcShip(actor)
          && this._pendingWeapon?.type === "starshipweapon2e") {
        const npcDivider = document.createElement("div");
        npcDivider.style.cssText = `
          font-size:9px;color:${LC.secondary};font-family:${LC.font};
          letter-spacing:0.08em;text-transform:uppercase;
          margin-top:6px;margin-bottom:3px;
          border-top:1px solid ${LC.borderDim};padding-top:5px;
        `;
        npcDivider.textContent = "◈ NPC Controls";
        panelWrap.appendChild(npcDivider);

        const forceBtn = document.createElement("button");
        forceBtn.style.cssText = `
          display:flex;align-items:center;justify-content:center;gap:4px;
          padding:4px 5px;width:100%;
          background:rgba(255,153,0,0.08);border:1px solid ${LC.primary};
          border-radius:2px;color:${LC.primary};
          font-size:9px;font-weight:700;letter-spacing:0.05em;
          font-family:${LC.font};text-transform:uppercase;cursor:pointer;transition:all 0.12s;
        `;
        forceBtn.textContent = `⚡ AUTO-HIT — ${this._pendingWeapon.name}`;
        forceBtn.title = "Resolve this weapon attack as an automatic hit (no task roll)";
        forceBtn.addEventListener("mouseenter", () => {
          forceBtn.style.background = "rgba(255,153,0,0.18)";
        });
        forceBtn.addEventListener("mouseleave", () => {
          forceBtn.style.background = "rgba(255,153,0,0.08)";
        });
        forceBtn.addEventListener("click", async () => {
          const weapon    = this._pendingWeapon;
          const salvoMode = this._pendingSalvoMode ?? "area";
          this._pendingWeapon    = null;
          this._pendingSalvoMode = null;
          this._refresh();
          await CombatHUD.resolveShipAttack(this._token, weapon, true, {
            salvoMode,
            rapidFireBonus: hasRapidFireTorpedoLauncher(actor) && getWeaponConfig(weapon)?.type === "torpedo" ? 1 : 0,
          });
        });
        panelWrap.appendChild(forceBtn);
      }

      // ── Pending Assist Banners ────────────────────────────────────────────
      // Show one row per assisting officer declared for this station (GM only).
      // Each row has an individual ✕ button to remove that specific assister.
      if (game.user.isGM) {
        const tokenDoc  = this._token?.document ?? this._token;
        const allAssists = tokenDoc?.getFlag(MODULE, "assistPending") ?? {};
        const rawAssist  = allAssists[station.id] ?? null;
        // Normalize legacy string / single-object / new array formats
        const assistsArr = !rawAssist ? []
          : Array.isArray(rawAssist) ? rawAssist
          : typeof rawAssist === "string" ? [{ name: rawAssist, actorId: null }]
          : [rawAssist];

        assistsArr.forEach((assist, aiIdx) => {
          const assistName = assist.name ?? "Unknown";
          const banner = document.createElement("div");
          banner.style.cssText = `
            display:flex;align-items:center;justify-content:space-between;
            padding:4px 8px;margin-top:4px;
            background:rgba(255,153,0,0.08);
            border:1px solid ${LC.primary};border-radius:2px;
          `;

          const lbl = document.createElement("span");
          lbl.style.cssText = `
            font-size:9px;color:${LC.primary};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;
          `;
          lbl.textContent = `🤝 ${assistName} assisting`;

          const cancelBtn = document.createElement("button");
          cancelBtn.style.cssText = `
            background:none;border:none;padding:0 2px;
            color:${LC.textDim};font-size:11px;line-height:1;
            cursor:pointer;font-family:${LC.font};
          `;
          cancelBtn.textContent = "✕";
          cancelBtn.title = `Cancel assist from ${assistName}`;
          cancelBtn.addEventListener("mouseenter", () => { cancelBtn.style.color = LC.red ?? "#ff3333"; });
          cancelBtn.addEventListener("mouseleave", () => { cancelBtn.style.color = LC.textDim; });
          cancelBtn.addEventListener("click", async () => {
            try {
              // Re-access the token document at click-time (avoids stale closure issues).
              // Use Foundry's deletion-key or direct-key update to avoid mergeObject
              // silently keeping entries on wildcard (unlinked) tokens.
              const td = this._token?.document;
              if (!td) return;
              const allA   = td.getFlag(MODULE, "assistPending") ?? {};
              const curArr = Array.isArray(allA[station.id]) ? allA[station.id] : [];
              const newArr = curArr.filter((_, i) => i !== aiIdx);
              if (newArr.length === 0) {
                // Remove the whole station key using deletion syntax
                await td.update({ [`flags.${MODULE}.assistPending.-=${station.id}`]: null });
              } else {
                // Update just this station's array — direct key path avoids merge issues
                await td.update({ [`flags.${MODULE}.assistPending.${station.id}`]: newArr });
              }
              this._refresh();
            } catch(e) {
              console.warn("STA2e Toolkit | Could not cancel assist flag:", e);
            }
          });

          banner.appendChild(lbl);
          banner.appendChild(cancelBtn);
          panelWrap.appendChild(banner);
        });
      }
    };

    // Station id → custom SVG icon path
    const STATION_SVG = {
      command:    "modules/sta2e-toolkit/assets/station-command.svg",
      comms:      "modules/sta2e-toolkit/assets/station-comms.svg",
      helm:       "modules/sta2e-toolkit/assets/station-helm.svg",
      navigator:  "modules/sta2e-toolkit/assets/station-navigation.svg",
      operations: "modules/sta2e-toolkit/assets/station-operations.svg",
      sensors:    "modules/sta2e-toolkit/assets/station-science.svg",
      tactical:   "modules/sta2e-toolkit/assets/station-tactical.svg",
      medical:    "modules/sta2e-toolkit/assets/station-medical.svg",
    };

    // Determine active theme era for department colors
    let _themeKey = "lcars-tng";
    try {
      const _store    = game?.sta2eToolkit?.campaignStore;
      const _campaign = _store?.getActiveCampaign?.();
      if (_campaign?.theme) _themeKey = _campaign.theme;
      else { const _g = game?.settings?.get("sta2e-toolkit", "hudTheme"); if (_g) _themeKey = _g; }
    } catch(e) {}
    // TNG / DS9 / VOY era: Command=Red, Ops=Gold. Everything else flips.
    const _isTng = ["lcars-tng", "lcars-tng-blue"].includes(_themeKey);
    const _cmdColor = _isTng ? LC.red    : LC.yellow;   // Command, Helm, Nav
    const _opsColor = _isTng ? LC.yellow : LC.red;      // Ops/Eng, Tactical, Comms
    const _sciColor = "#33bbcc";                        // Sensors, Medical — teal all eras
    const STATION_DEPT_COLOR = {
      command:    _cmdColor,
      helm:       _cmdColor,
      navigator:  _cmdColor,
      comms:      _opsColor,
      operations: _opsColor,
      tactical:   _opsColor,
      sensors:    _sciColor,
      medical:    _sciColor,
    };

    // Build tab buttons and wire panel switching
    BRIDGE_STATIONS.forEach(station => {
      const isActive  = station.id === activeStation.id;
      const deptColor = STATION_DEPT_COLOR[station.id] ?? LC.primary;
      const iconColor = isActive ? deptColor  : "#707080";
      const bgColor   = isActive ? `rgba(${_hexR(deptColor)},${_hexG(deptColor)},${_hexB(deptColor)},0.2)` : "transparent";
      const bdColor   = isActive ? deptColor  : "#555565";

      const tab = document.createElement("button");
      tab.style.cssText = `
        width: 28px;
        height: 28px;
        padding: 0;
        background: ${bgColor};
        border: 1px solid ${bdColor};
        border-bottom: none;
        border-radius: 3px 3px 0 0;
        cursor: pointer;
        transition: background 0.12s, border-color 0.12s;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      `;
      tab.title = station.label;

      const svgSrc = STATION_SVG[station.id];
      if (svgSrc) {
        const mask = document.createElement("div");
        mask.style.cssText = `
          width: 16px;
          height: 16px;
          background-color: ${iconColor};
          -webkit-mask-image: url(${svgSrc});
          mask-image: url(${svgSrc});
          -webkit-mask-size: contain;
          mask-size: contain;
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
          -webkit-mask-position: center;
          mask-position: center;
          flex-shrink: 0;
          transition: background-color 0.12s;
        `;
        tab.appendChild(mask);
      } else {
        tab.textContent = station.label.charAt(0);
      }

      tab.addEventListener("mouseenter", () => {
        if (!isActive) {
          tab.style.borderColor   = deptColor;
          tab.style.background    = `rgba(${_hexR(deptColor)},${_hexG(deptColor)},${_hexB(deptColor)},0.15)`;
          const mask = tab.querySelector("div");
          if (mask) mask.style.backgroundColor = deptColor;
        }
      });
      tab.addEventListener("mouseleave", () => {
        if (!isActive) {
          tab.style.borderColor = bdColor;
          tab.style.background  = bgColor;
          const mask = tab.querySelector("div");
          if (mask) mask.style.backgroundColor = iconColor;
        }
      });
      tab.addEventListener("click", () => {
        sessionStorage.setItem(PREF_KEY, station.id);
        this._refresh();
      });
      tabBar.appendChild(tab);
    });

    // Render the active station's panel
    buildPanel(activeStation);

    section.appendChild(tabBar);
    section.appendChild(panelWrap);
    return section;
  }
  // ── Ground Combat Actions panel ──────────────────────────────────────────

  _buildGroundActions() {
    const outer = document.createElement("div");
    outer.style.cssText = `display:flex;flex-direction:column;`;

    const hdr = this._buildSection("ACTIONS");
    outer.appendChild(hdr);

    const container = document.createElement("div");
    container.style.cssText = `padding:6px 8px;display:flex;flex-direction:column;gap:8px;`;

    const makeGrid = (label, actions) => {
      const wrap = document.createElement("div");
      const sublabel = document.createElement("div");
      sublabel.style.cssText = `font-size:8px;font-weight:700;letter-spacing:0.1em;
        color:${LC.textDim};font-family:${LC.font};text-transform:uppercase;margin-bottom:3px;`;
      sublabel.textContent = label;
      wrap.appendChild(sublabel);

      const grid = document.createElement("div");
      grid.style.cssText = `display:grid;grid-template-columns:1fr 1fr;gap:3px;`;

      for (const action of actions) {
        const isActive = action.isToggle && !!this[`_groundToggle_${action.key}`];
        const btn = document.createElement("button");
        btn.title = action.tooltip ?? "";
        btn.style.cssText = `
          font-family:${LC.font};font-size:9px;font-weight:700;letter-spacing:0.04em;
          padding:4px 3px;text-align:center;
          cursor:${action.isInfo ? "default" : "pointer"};
          background:${isActive ? LC.primary : LC.panel};
          color:${isActive ? LC.bg : LC.text};
          border:1px solid ${isActive ? LC.primary : LC.borderDim};
          border-radius:2px;opacity:${action.isInfo ? "0.5" : "1"};
          transition:background 0.12s,border-color 0.12s;
        `;
        btn.textContent = action.label;
        if (!action.isInfo) {
          btn.addEventListener("mouseenter", () => {
            if (!isActive) btn.style.borderColor = LC.border;
          });
          btn.addEventListener("mouseleave", () => {
            if (!isActive) btn.style.borderColor = LC.borderDim;
          });
          btn.addEventListener("click", () => this._handleQuickAction(action));
        }
        grid.appendChild(btn);
      }
      wrap.appendChild(grid);
      return wrap;
    };

    // ── Pending Ground Assist / Direct banners (GM only) ─────────────────
    if (game.user.isGM) {
      const tokenDoc   = this._token?.document ?? this._token;
      const allAssists = tokenDoc?.getFlag(MODULE, "assistPending") ?? {};
      const groundArr  = Array.isArray(allAssists["ground"]) ? allAssists["ground"]
        : allAssists["ground"] ? [allAssists["ground"]] : [];

      for (let aiIdx = 0; aiIdx < groundArr.length; aiIdx++) {
        const entry = groundArr[aiIdx];
        const isDir = entry.type === "direct";
        const icon  = isDir ? "📣" : "🤝";
        const label = isDir ? "DIRECTING" : "ASSISTING";

        const banner = document.createElement("div");
        banner.style.cssText = `
          display:flex;align-items:center;gap:5px;padding:4px 8px;
          background:rgba(255,153,0,0.08);border-left:2px solid ${LC.primary};
          border-radius:2px;margin-bottom:3px;
        `;

        const text = document.createElement("div");
        text.style.cssText = `flex:1;font-size:9px;font-weight:700;
          color:${LC.primary};font-family:${LC.font};letter-spacing:0.04em;`;
        text.textContent = `${icon} ${label}: ${entry.name ?? "Unknown"}`;

        const clearBtn = document.createElement("button");
        clearBtn.title = "Cancel this assist/direct";
        clearBtn.style.cssText = `
          background:none;border:1px solid ${LC.borderDim};border-radius:2px;
          color:${LC.textDim};font-size:10px;line-height:1;cursor:pointer;
          padding:1px 4px;flex-shrink:0;font-family:${LC.font};
        `;
        clearBtn.textContent = "✕";
        clearBtn.addEventListener("click", async () => {
          try {
            const td = this._token?.document;
            if (!td) return;
            const cur    = td.getFlag(MODULE, "assistPending") ?? {};
            const curArr = Array.isArray(cur["ground"]) ? cur["ground"] : [];
            const newArr = curArr.filter((_, i) => i !== aiIdx);
            if (newArr.length === 0) {
              await td.update({ [`flags.${MODULE}.assistPending.-=ground`]: null });
            } else {
              await td.update({ [`flags.${MODULE}.assistPending.ground`]: newArr });
            }
            this._refresh();
          } catch(e) {
            console.warn("STA2e Toolkit | Could not cancel ground assist flag:", e);
          }
        });

        banner.appendChild(text);
        banner.appendChild(clearBtn);
        container.appendChild(banner);
      }
    }

    // ── Guard banner ─────────────────────────────────────────────────────────
    if (game.user.isGM) {
      const tokenDoc  = this._token?.document ?? this._token;
      const guardData = tokenDoc?.getFlag(MODULE, "guardActive");
      if (guardData) {
        const guardBanner = document.createElement("div");
        guardBanner.style.cssText = `
          display:flex;align-items:center;gap:5px;padding:4px 8px;
          background:rgba(0,180,255,0.08);border-left:2px solid ${LC.green};
          border-radius:2px;margin-bottom:3px;
        `;
        const guardText = document.createElement("div");
        guardText.style.cssText = `flex:1;font-size:9px;font-weight:700;
          color:${LC.green};font-family:${LC.font};letter-spacing:0.04em;`;
        guardText.textContent = `🛡️ GUARDED by ${guardData.guarderName ?? "Unknown"}`;

        const clearGuardBtn = document.createElement("button");
        clearGuardBtn.title = "Remove guard";
        clearGuardBtn.style.cssText = `
          background:none;border:1px solid ${LC.borderDim};border-radius:2px;
          color:${LC.textDim};font-size:10px;line-height:1;cursor:pointer;
          padding:1px 4px;flex-shrink:0;font-family:${LC.font};
        `;
        clearGuardBtn.textContent = "✕";
        clearGuardBtn.addEventListener("click", async () => {
          try {
            await tokenDoc.unsetFlag(MODULE, "guardActive");
            this._refresh();
          } catch(e) {
            console.warn("STA2e Toolkit | Could not clear guardActive flag:", e);
          }
        });

        guardBanner.appendChild(guardText);
        guardBanner.appendChild(clearGuardBtn);
        container.appendChild(guardBanner);
      }
    }

    // ── Cover banner ─────────────────────────────────────────────────────────
    {
      const tokenDoc  = this._token?.document;
      const hasCover  = tokenDoc?.getFlag(MODULE, "coverActive");
      if (hasCover) {
        const coverBanner = document.createElement("div");
        coverBanner.style.cssText = `
          display:flex;align-items:center;gap:5px;padding:4px 8px;
          background:rgba(0,200,100,0.08);border-left:2px solid ${LC.secondary};
          border-radius:2px;margin-bottom:3px;
        `;
        const coverText = document.createElement("div");
        coverText.style.cssText = `flex:1;font-size:9px;font-weight:700;
          color:${LC.secondary};font-family:${LC.font};letter-spacing:0.04em;`;
        coverText.textContent = `IN COVER — ranged attacks are Opposed Tasks (Control + Security)`;

        const clearCoverBtn = document.createElement("button");
        clearCoverBtn.title = "Leave cover";
        clearCoverBtn.style.cssText = `
          background:none;border:1px solid ${LC.borderDim};border-radius:2px;
          color:${LC.textDim};font-size:10px;line-height:1;cursor:pointer;
          padding:1px 4px;flex-shrink:0;font-family:${LC.font};
        `;
        clearCoverBtn.textContent = "✕";
        clearCoverBtn.addEventListener("click", async () => {
          try {
            await tokenDoc.unsetFlag(MODULE, "coverActive");
            this._refresh();
          } catch(e) {
            console.warn("STA2e Toolkit | Could not clear coverActive flag:", e);
          }
        });

        coverBanner.appendChild(coverText);
        coverBanner.appendChild(clearCoverBtn);
        container.appendChild(coverBanner);
      }
    }

    container.appendChild(makeGrid("MINOR ACTIONS", GROUND_ACTIONS.minor));
    container.appendChild(makeGrid("MAJOR ACTIONS", GROUND_ACTIONS.major));
    outer.appendChild(container);
    return outer;
  }

  // ── Ground character picker ───────────────────────────────────────────────
  // Returns { tokenDoc, actorId, name, img } for a user-selected ground character
  // (excludes the acting character and ship actors). Returns null if cancelled.
  async _pickGroundCharacter(excludeTokenId) {
    const candidates = [];
    const source = game.combat?.combatants?.size
      ? [...game.combat.combatants]
      : (canvas.tokens?.placeables ?? []).map(t => ({
          tokenId: t.id,
          actor:   t.actor,
          name:    t.name,
          tokenDoc: t.document,
        }));

    for (const c of source) {
      const tId    = c.tokenId ?? c.id;
      const tActor = c.actor;
      if (!tActor || tId === excludeTokenId) continue;
      const sheetName = tActor.sheet?.constructor?.name ?? "";
      const isShip = sheetName.toLowerCase().includes("starship") || sheetName.includes("STAStarship");
      if (isShip) continue;
      const tokenDoc = c.tokenDoc ?? canvas.tokens?.get(tId)?.document ?? null;
      candidates.push({ tokenDoc, actorId: tActor.id, name: c.name ?? tActor.name, img: tActor.img });
    }

    if (!candidates.length) {
      ui.notifications.warn("No other ground characters found on the scene.");
      return null;
    }

    let picked = null;
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Select Character" },
      content: `
        <div style="font-family:${LC.font};display:flex;flex-direction:column;gap:5px;padding:4px 0;">
          ${candidates.map((c, i) => `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
              padding:5px 8px;border-radius:2px;
              border:1px solid ${LC.borderDim};background:${LC.panel};">
              <input type="radio" name="ground-target" value="${i}"
                style="accent-color:${LC.primary};" />
              ${c.img ? `<img src="${c.img}" style="width:24px;height:24px;border-radius:2px;object-fit:cover;border:none;" />` : ""}
              <span style="font-size:11px;font-weight:700;color:${LC.text};font-family:${LC.font};">
                ${c.name}
              </span>
            </label>`).join("")}
        </div>`,
      buttons: [
        {
          action: "confirm", label: "Select", icon: "fas fa-check", default: true,
          callback: (event, btn, dlg) => {
            const el  = dlg.element ?? btn.closest(".app.dialog-v2");
            const val = el?.querySelector("input[name='ground-target']:checked")?.value;
            if (val !== undefined && val !== null) picked = candidates[parseInt(val)] ?? null;
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });
    return result === "confirm" ? picked : null;
  }

  /**
   * Post a Pass action chat card for the given token.
   * @param {Token} token
   */
  async postPassCard(token) {
    const actor = token?.actor;
    if (!actor) return;
    await ChatMessage.create({
      content: lcarsCard(
        "⏭️ PASS",
        LC.textDim,
        `<div style="font-size:11px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
        <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
          Forfeits their Major Action this turn.
        </div>`
      ),
      speaker: ChatMessage.getSpeaker({ token }),
    });
  }

  /**
   * Post a Ready action chat card for the given token.
   * @param {Token} token
   */
  async postReadyCard(token) {
    const actor = token?.actor;
    if (!actor) return;
    await ChatMessage.create({
      content: lcarsCard(
        "⚡ READY",
        LC.secondary,
        `<div style="font-size:11px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
        <div style="font-size:10px;color:${LC.text};font-family:${LC.font};line-height:1.6;">
          Holds their Major Action.<br>
          <span style="color:${LC.textDim};">Declare a trigger — if it occurs before their next turn,
          they may act immediately.</span>
        </div>`
      ),
      speaker: ChatMessage.getSpeaker({ token }),
    });
  }

  async _handleQuickAction(action, station = null) {
    const token   = this._token;
    const actor   = token?.actor;
    const targets = Array.from(game.user.targets);
    const target  = targets[0] ?? null;

    // v13 helper — DialogV2 returns the button action string
    const confirm = async (title, content) => {
      const result = await foundry.applications.api.DialogV2.wait({
        window: { title },
        content,
        buttons: [
          { action: "yes", label: "Yes", icon: "fas fa-check", default: true },
          { action: "no",  label: "No",  icon: "fas fa-times" },
        ],
      });
      return result === "yes";
    };

    // Targeting Solution system-picker sub-actions — intercept before switch
    if (action.key?.startsWith("ts-system-")) {
      if (CombatHUD.hasTargetingSolution(token)) {
        const systemKey = action.key.slice("ts-system-".length);
        const system    = systemKey === "random" ? null : systemKey;
        const hasFTS    = hasFastTargetingSystems(actor);
        const benefit   = hasFTS ? "both" : "system";
        await CombatHUD.setTargetingSolution(token, { active: true, benefit, system });
        const sysLabel  = system ? CombatHUD.systemLabel(system) : "random roll";
        ChatMessage.create({
          content: this._conditionChatCard(token.name, null, "Targeting Solution", "🎯",
            hasFTS
              ? `Fast Targeting Systems: targeting ${sysLabel} on next hit + free d20 reroll.`
              : `Next hit will target the ${sysLabel} system.`)
        });
        this._refresh();
      }
      return;
    }

    switch (action.key) {

      case "create-trait": {
        await this._handleCreateTrait(actor, token, station);
        break;
      }

      case "rally": {
        await this._handleRally(actor, token);
        break;
      }

      case "damage-control": {
        await this._handleDamageControl(actor, token, station);
        break;
      }

      case "regen-shields": {
        await this._handleRegenShields(actor, token);
        break;
      }

      case "regain-power": {
        await this._handleRegainPower(actor, token);
        break;
      }

      case "reroute-power": {
        await this._handleReroutePower(actor, token);
        break;
      }

      case "modulate-shields": {
        await this._handleModulateShields(actor, token);
        break;
      }

      case "maneuver": {
        await this._handleManeuver(actor, token);
        break;
      }

      case "prepare": {
        await this._handlePrepare(actor, token);
        break;
      }

      case "tractor-beam": {
        if (!target) { ui.notifications.warn("Select a target first."); return; }
        await this._handleTractorBeam(actor, token, target);
        break;
      }

      case "prepare-warp": {
        ChatMessage.create({
          content: lcarsCard("⏸️ WARP PREPARATION", LC.primary, `
            <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
              margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
            <div style="font-size:16px;font-weight:700;color:${LC.primary};
              text-align:center;padding:5px 0;font-family:${LC.font};">
              ⏸️ Prepared for Warp
            </div>
            <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
              text-align:center;line-height:1.5;">
              ${actor.name} is prepared — Conn officer may now attempt the Warp major action.
            </div>`),
          speaker: { alias: "STA2e Toolkit" },
        });
        break;
      }

      case "warp": {
        await this._handleWarp(actor, token);
        break;
      }

      case "impulse":
      case "thrusters":
      case "launch-probe": {
        await this._handleInfoAction(actor, token, action);
        break;
      }

      case "sensor-sweep": {
        await this._handleSensorTask(actor, token, "sensor-sweep");
        break;
      }

      case "reveal": {
        await this._handleSensorTask(actor, token, "reveal");
        break;
      }

      case "transport": {
        await this._handleTransport(actor, token, station);
        break;
      }

      case "scan-for-weakness": {
        if (!target) { ui.notifications.warn("Select a target first."); return; }
        await this._handleScanForWeakness(actor, token, target);
        break;
      }

      case "calibrate-sensors": {
        const isActive = CombatHUD.hasCalibratesensors(token);
        if (isActive) {
          await CombatHUD.setCalibratesensors(token, false);
          ChatMessage.create({
            content: this._conditionChatCard(token.name, null, "Calibrate Sensors", "🎚️",
              "Calibrate Sensors cleared.", true)
          });
        } else {
          await CombatHUD.setCalibratesensors(token, true);
          ChatMessage.create({
            content: this._conditionChatCard(token.name, null, "Calibrate Sensors", "🎚️",
              "Sensors calibrated. On the next Sensor Operations action: ignore one trait affecting the task, OR re-roll 1d20.")
          });
        }
        this._refresh();
        break;
      }

      case "cs-reroll": {
        if (!CombatHUD.hasCalibratesensors(token)) break;
        // Do NOT clear the flag — the roller consumes it when the die is clicked
        ChatMessage.create({
          content: this._conditionChatCard(token.name, null, "Calibrate Sensors — Reroll", "🎚️",
            "Re-rolling 1d20 on this sensor task — click any crew die to reroll when rolling.")
        });
        break;
      }

      case "cs-ignore-trait": {
        if (!CombatHUD.hasCalibratesensors(token)) break;
        await CombatHUD.setCalibratesensors(token, false);
        ChatMessage.create({
          content: this._conditionChatCard(token.name, null, "Calibrate Sensors — Ignore Trait", "🎚️",
            "Ignoring one trait affecting this sensor task.")
        });
        this._refresh();
        break;
      }

      case "calibrate-weapons": {
        const isActive = CombatHUD.hasCalibrateWeapons(token);
        if (isActive) {
          await CombatHUD.setCalibrateWeapons(token, false);
          ChatMessage.create({
            content: this._conditionChatCard(token.name, null, "Calibrate Weapons", "🔩",
              "Calibrate Weapons cleared.", true)
          });
        } else {
          await CombatHUD.setCalibrateWeapons(token, true);
          ChatMessage.create({
            content: this._conditionChatCard(token.name, null, "Calibrate Weapons", "🔩",
              "Weapons calibrated. Next attack with ship's weapons increases damage by 1.")
          });
        }
        this._refresh();
        break;
      }

      case "ts-reroll": {
        if (!CombatHUD.hasTargetingSolution(token)) break;
        await CombatHUD.setTargetingSolution(token, { active: true, benefit: "reroll", system: null });
        ChatMessage.create({
          content: this._conditionChatCard(token.name, null, "Targeting Solution — Reroll", "🎯",
            "Re-rolling 1d20 on this attack — benefit locked in for the next hit.")
        });
        this._refresh();
        break;
      }

      case "targeting-solution": {
        const isActive = CombatHUD.hasTargetingSolution(token);
        if (isActive) {
          await CombatHUD.setTargetingSolution(token, false);
          ChatMessage.create({
            content: this._conditionChatCard(token.name, null, "Targeting Solution", "🎯",
              "Targeting Solution cleared.", true)
          });
        } else {
          await CombatHUD.setTargetingSolution(token, { active: true, benefit: null, system: null });
          const hasFTS = hasFastTargetingSystems(actor);
          // Play lock-on indicator on the targeted ship
          if (target) fireTargetingSolution(token, target);
          ChatMessage.create({
            content: this._conditionChatCard(token.name, null, "Targeting Solution", "🎯",
              hasFTS
                ? "Fast Targeting Systems active — choose a system to target (reroll d20 is automatic)."
                : "Targeting Solution active — choose to re-roll d20 or select a system to target.")
          });
        }
        this._refresh();
        break;
      }

      case "attack-pattern": {
        if (!await confirm("Attack Pattern",
          `<p>Did the Attack Pattern task succeed for <strong>${token.name}</strong>?</p>`
        )) return;
        await addCondition(token, "attack-pattern");
        await fireAttackPattern(token);
        ChatMessage.create({
          content: this._conditionChatCard(token.name, null, "Attack Pattern", "⚡",
            "Conn officer may assist the next attack roll.")
        });
        this._refresh();
        break;
      }

      case "evasive-action":
      case "defensive-fire": {
        const isActive = getDefenseMode(token) === action.key;
        if (isActive) {
          await removeCondition(token, action.key);
          ChatMessage.create({
            content: this._conditionChatCard(token.name, null, action.label, action.icon,
              `${action.label} has ended.`, true)
          });
        } else {
          if (!await confirm(action.label,
            `<p>Did the ${action.label} task succeed for <strong>${token.name}</strong>?</p>`
          )) return;
          await addCondition(token, action.key);
          await fireDefenseMode(token, action.key);
          ChatMessage.create({
            content: this._conditionChatCard(token.name, null, action.label, action.icon,
              "Incoming attacks against this vessel are now Opposed Tasks. Expires next turn.")
          });
        }
        this._refresh();
        break;
      }

      case "ram": {
        if (!target) { ui.notifications.warn("Select a target first."); return; }
        await this._handleRam(actor, token, target);
        break;
      }

      case "assist": {
        await this._handleAssist(actor, token, station);
        break;
      }

      case "assist-command": {
        await this._handleAssistCommand(actor, token, station);
        break;
      }

      case "direct": {
        await this._handleDirect(actor, token, station);
        break;
      }

      case "task-roll": {
        await this._handleTaskRoll(actor, token, station);
        break;
      }

      case "override": {
        await this._handleOverride(actor, token, station);
        break;
      }

      case "pass": {
        await ChatMessage.create({
          content: lcarsCard(
            "⏭️ PASS",
            LC.textDim,
            `<div style="font-size:11px;font-weight:700;color:${LC.tertiary};
              margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
            <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
              Forfeits their Major Action this turn.
            </div>`
          ),
          speaker: ChatMessage.getSpeaker({ token }),
        });
        break;
      }

      case "ready": {
        await ChatMessage.create({
          content: lcarsCard(
            "⚡ READY",
            LC.secondary,
            `<div style="font-size:11px;font-weight:700;color:${LC.tertiary};
              margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
            <div style="font-size:10px;color:${LC.text};font-family:${LC.font};line-height:1.6;">
              Holds their Major Action.<br>
              <span style="color:${LC.textDim};">Declare a trigger — if it occurs before their next turn,
              they may act immediately.</span>
            </div>`
          ),
          speaker: ChatMessage.getSpeaker({ token }),
        });
        break;
      }

      // ── Ground Combat Actions ─────────────────────────────────────────────

      case "ground-aim": {
        const flag = `_groundToggle_ground-aim`;
        this[flag] = !this[flag];
        if (this[flag]) {
          // Grant 1 reroll now; Accurate check happens at fire time when the exact weapon is known
          this._groundAimRerolls = 1;
          ChatMessage.create({
            content: `<b>${actor?.name}</b> takes Aim — may re-roll <b>1 die</b> on next attack (2 if weapon has <b>Accurate</b>).`,
            speaker: ChatMessage.getSpeaker({ token }),
          });
        } else {
          this._groundAimRerolls = 0;
        }
        this._refresh();
        break;
      }

      case "ground-prepare": {
        const prepFlag = `_groundToggle_ground-prepare`;
        this[prepFlag] = !this[prepFlag];
        if (this[prepFlag]) {
          ChatMessage.create({
            content: `<b>${actor?.name}</b> takes a moment to Prepare.`,
            speaker: ChatMessage.getSpeaker({ token }),
          });
        }
        this._refresh();
        break;
      }

      case "ground-prone": {
        const proneFlag = `_groundToggle_ground-prone`;
        this[proneFlag] = !this[proneFlag];
        const nowProne = this[proneFlag];
        // Toggle the built-in Foundry prone status icon on the token
        if (actor) {
          await actor.toggleStatusEffect("prone", { active: nowProne });
        }
        ChatMessage.create({
          content: nowProne
            ? `<b>${actor?.name}</b> drops <b>Prone</b>. Ranged Attacks from Medium range or further have +1 Difficulty; if in Cover, gain +1 Protection; Melee Attacks at Close range gain 2 bonus Momentum against them. No movement major actions this turn.`
            : `<b>${actor?.name}</b> stands up from Prone.`,
          speaker: ChatMessage.getSpeaker({ token }),
        });
        this._refresh();
        break;
      }

      case "ground-interact": {
        ChatMessage.create({
          content: `<b>${actor?.name}</b> Interacts with the environment.`,
          speaker: ChatMessage.getSpeaker({ token }),
        });
        break;
      }

      case "ground-first-aid": {
        // ── Step 1: pick the target ──────────────────────────────────────────
        const aidTarget = await this._pickGroundCharacter(token?.id);
        if (!aidTarget) return;

        const aidTokenDoc = aidTarget.tokenDoc;
        const aidActor    = aidTokenDoc?.actor ?? game.actors.get(aidTarget.actorId);
        if (!aidActor) { ui.notifications.warn("Could not load target character."); return; }

        // ── Step 2: gather what can be treated ──────────────────────────────
        const isDefeated = hasCondition(aidTokenDoc, "dead") || hasCondition(aidTokenDoc, "dying");

        // Personal injuries only — filter out ship-type injury items
        const SHIP_PREFIXES = ["Breach:", "Power Strain:", "Dept Strain:"];
        const personalInjuries = aidActor.items.filter(i =>
          i.type === "injury" && !SHIP_PREFIXES.some(p => i.name.startsWith(p))
        );

        if (!isDefeated && personalInjuries.length === 0) {
          ui.notifications.warn(`${aidActor.name} has no injuries and is not Defeated.`);
          return;
        }

        // ── Step 3: build choice dialog ──────────────────────────────────────
        // Options: revive (if defeated) + one entry per injury
        const aidOptions = [];
        if (isDefeated) {
          aidOptions.push({
            type: "revive",
            id:   "revive",
            label: "Revive Defeated",
            sub:   "Daring + Medicine · Difficulty 2",
            difficulty: 2,
          });
        }
        for (const inj of personalInjuries) {
          const potency = Math.max(1, inj.system?.quantity ?? 1);
          aidOptions.push({
            type:       "treat",
            id:         inj.id,
            label:      `Treat: ${inj.name}`,
            sub:        `Daring + Medicine · Difficulty ${potency}`,
            difficulty: potency,
            injuryName: inj.name,
          });
        }

        let aidChoice = null;
        const aidResult = await foundry.applications.api.DialogV2.wait({
          window: { title: `First Aid — ${aidActor.name}` },
          content: `
            <div style="font-family:${LC.font};display:flex;flex-direction:column;gap:5px;padding:4px 0;">
              <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
                letter-spacing:0.08em;margin-bottom:2px;">Select treatment:</div>
              ${aidOptions.map((opt, i) => `
                <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;
                  padding:6px 8px;border-radius:2px;
                  border:1px solid ${LC.borderDim};background:${LC.panel};">
                  <input type="radio" name="aid-choice" value="${i}"
                    ${i === 0 ? "checked" : ""}
                    style="accent-color:${LC.primary};margin-top:2px;flex-shrink:0;" />
                  <div>
                    <div style="font-size:10px;font-weight:700;color:${LC.text};
                      font-family:${LC.font};">${opt.label}</div>
                    <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">
                      ${opt.sub}
                    </div>
                  </div>
                </label>`).join("")}
            </div>`,
          buttons: [
            {
              action:   "confirm",
              label:    "Begin First Aid",
              icon:     "fas fa-kit-medical",
              default:  true,
              callback: (_ev, _btn, dlg) => {
                const val = dlg.element?.querySelector("input[name='aid-choice']:checked")?.value;
                if (val !== undefined) aidChoice = aidOptions[parseInt(val)] ?? null;
              },
            },
            { action: "cancel", label: "Cancel", icon: "fas fa-times" },
          ],
        });

        if (aidResult !== "confirm" || !aidChoice) return;

        // ── Step 4: open dice roller ─────────────────────────────────────────
        const isRevive = aidChoice.type === "revive";
        openPlayerRoller(actor, token, {
          officer:     readOfficerStats(actor),
          groundMode:  true,
          groundIsNpc: CombatHUD.isGroundNpcActor(actor),
          difficulty:  aidChoice.difficulty,
          defaultAttr: "daring",
          defaultDisc: "medicine",
          taskLabel:   "First Aid",
          taskContext: `${actor.name} → ${aidActor.name} · Daring + Medicine · Difficulty ${aidChoice.difficulty}`,
          taskCallback: async ({ passed, momentum }) => {
            const isNpcHealer  = CombatHUD.isGroundNpcActor(actor);
            const pool         = isNpcHealer ? "threat" : "momentum";
            const currencyWord = isNpcHealer ? "Threat" : "Momentum";
            const tokenId      = token?.id ?? "";
            const momentumLine = (passed && momentum > 0)
              ? `<div style="font-size:10px;color:${LC.secondary};font-family:${LC.font};
                  margin-top:4px;font-weight:700;">+${momentum} ${currencyWord} gained</div>`
              : "";
            if (isRevive) {
              // ── Revive Defeated ──────────────────────────────────────────
              await ChatMessage.create({
                content: lcarsCard(
                  passed ? "✚ FIRST AID — REVIVED" : "✚ FIRST AID — FAILED",
                  passed ? LC.green : LC.red,
                  `<div style="font-size:11px;font-weight:700;color:${LC.tertiary};
                    margin-bottom:4px;font-family:${LC.font};">${aidActor.name}</div>
                  <div style="font-size:10px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
                    ${passed
                      ? "First Aid successful — character is no longer Defeated.<br>"
                        + "<span style='color:" + LC.textDim + ";'>They may still have an Injury.</span>"
                      : "First Aid failed — character remains Defeated."}
                  </div>${momentumLine}`
                ),
                speaker: ChatMessage.getSpeaker({ token }),
              });
              if (passed) {
                CombatHUD._playFirstAidEffect(aidTokenDoc);
                if (game.user.isGM) {
                  // Remove whichever defeated condition is present
                  if (hasCondition(aidTokenDoc, "dying")) await removeCondition(aidTokenDoc, "dying");
                  if (hasCondition(aidTokenDoc, "dead"))  await removeCondition(aidTokenDoc, "dead");
                }
              }
            } else {
              // ── Treat Injury ─────────────────────────────────────────────
              await ChatMessage.create({
                content: lcarsCard(
                  passed ? "✚ FIRST AID — TREATED" : "✚ FIRST AID — FAILED",
                  passed ? LC.green : LC.red,
                  `<div style="font-size:11px;font-weight:700;color:${LC.tertiary};
                    margin-bottom:4px;font-family:${LC.font};">${aidActor.name}</div>
                  <div style="font-size:10px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
                    ${passed
                      ? `Injury <strong>${aidChoice.injuryName}</strong> treated in combat.<br>`
                        + "<span style='color:" + LC.textDim + ";'>The injury no longer imposes penalties this combat. "
                        + "It cannot be fully removed until out of combat.</span>"
                      : `Failed to treat <strong>${aidChoice.injuryName}</strong> — injury persists.`}
                  </div>${momentumLine}`
                ),
                speaker: ChatMessage.getSpeaker({ token }),
              });
              if (passed) CombatHUD._playFirstAidEffect(aidTokenDoc);
              if (passed && game.user.isGM && aidTokenDoc) {
                // Store treated flag on the TARGET's token so the HUD can show it
                try {
                  const current = aidTokenDoc.getFlag(MODULE, "treatedInjuries") ?? [];
                  const updated = [...new Set([...current, aidChoice.id])];
                  await aidTokenDoc.setFlag(MODULE, "treatedInjuries", updated);
                } catch(e) {
                  console.warn("STA2e Toolkit | Could not set treatedInjuries flag:", e);
                }
              }
            }
          },
        });
        break;
      }

      case "ground-assist": {
        const target = await this._pickGroundCharacter(token?.id);
        if (!target) return;

        if (game.user.isGM && target.tokenDoc) {
          try {
            const existing      = target.tokenDoc.getFlag("sta2e-toolkit", "assistPending") ?? {};
            await target.tokenDoc.setFlag("sta2e-toolkit", "assistPending", {
              ...existing,
              ground: [{ name: actor.name, actorId: actor.id, type: "assist" }],
            });
          } catch(e) { console.warn("STA2e Toolkit | Could not set ground assist flag:", e); }
        }

        ChatMessage.create({
          content: lcarsCard("🙌 ASSIST", LC.primary, `
            <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
              margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
            <div style="font-size:10px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
              Assisting <strong>${target.name}</strong> on their next task.<br>
              <span style="color:${LC.textDim};">Bonus die rolled at ${actor.name}'s stats.</span>
            </div>`),
          speaker: ChatMessage.getSpeaker({ token }),
        });
        break;
      }

      case "ground-create-advantage": {
        await this._handleCreateTrait(actor, token, null);
        break;
      }

      case "ground-direct": {
        const directTarget = await this._pickGroundCharacter(token?.id);
        if (!directTarget) return;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window:  { title: `Direct — ${actor?.name}` },
          content: `
            <div style="font-family:${LC.font};padding:4px 0;font-size:10px;
              color:${LC.textDim};line-height:1.5;">
              <strong style="color:${LC.text};">Spend 1 Momentum</strong> to Direct
              <strong style="color:${LC.tertiary ?? LC.text};">${directTarget.name}</strong>.<br>
              They gain a bonus die (rolled at your stats) on their next task.
            </div>`,
          yes: { label: "Spend 1 Momentum", icon: "fas fa-check" },
          no:  { label: "Cancel",           icon: "fas fa-times" },
        });
        if (!confirmed) return;

        if (game.user.isGM && directTarget.tokenDoc) {
          try {
            const existing      = directTarget.tokenDoc.getFlag("sta2e-toolkit", "assistPending") ?? {};
            await directTarget.tokenDoc.setFlag("sta2e-toolkit", "assistPending", {
              ...existing,
              ground: [{ name: actor.name, actorId: actor.id, type: "direct" }],
            });
          } catch(e) { console.warn("STA2e Toolkit | Could not set ground direct flag:", e); }
        }

        ChatMessage.create({
          content: lcarsCard("📣 DIRECT", LC.primary, `
            <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
              margin-bottom:4px;font-family:${LC.font};">${actor?.name}</div>
            <div style="font-size:10px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
              Spent <strong>1 Momentum</strong> — Directing
              <strong>${directTarget.name}</strong>.<br>
              <span style="color:${LC.textDim};">Bonus die rolled at ${actor?.name}'s stats on their next task.</span>
            </div>`),
          speaker: ChatMessage.getSpeaker({ token }),
        });
        break;
      }

      case "ground-guard": {
        // Ask whether the character is guarding themselves or an ally
        const guardChoice = await foundry.applications.api.DialogV2.wait({
          window: { title: `Guard — ${actor.name}` },
          content: `
            <div style="font-family:${LC.font};padding:4px 0;font-size:10px;color:${LC.text};line-height:1.6;">
              <strong style="color:${LC.tertiary};">Insight + Security</strong> task.<br>
              Self guard: <strong>Difficulty 0</strong><br>
              Ally guard: <strong>Difficulty 1</strong> — benefit lasts until the start of the ally's next turn.
            </div>`,
          buttons: [
            { action: "self",   label: "🛡️ Guard Self",  icon: "fas fa-user-shield", default: true },
            { action: "ally",   label: "🤝 Guard Ally",  icon: "fas fa-users" },
            { action: "cancel", label: "Cancel",          icon: "fas fa-times" },
          ],
        });
        if (!guardChoice || guardChoice === "cancel") return;

        const guardingSelf = guardChoice === "self";
        let guardedTokenDoc = token?.document ?? null;
        let guardedName     = actor.name;
        let expiresForTokenId = token?.id ?? null;

        if (!guardingSelf) {
          const ally = await this._pickGroundCharacter(token?.id);
          if (!ally) return;
          guardedTokenDoc   = ally.tokenDoc;
          guardedName       = ally.name;
          expiresForTokenId = ally.tokenDoc?.id ?? null;  // expires on ally's next turn
        }

        openPlayerRoller(actor, token, {
          officer:     readOfficerStats(actor),
          groundMode:  true,
          groundIsNpc: CombatHUD.isGroundNpcActor(actor),
          difficulty:  guardingSelf ? 0 : 1,
          defaultAttr: "insight",
          defaultDisc: "security",
          taskLabel:   "Guard",
          taskContext: `${actor.name} · Insight + Security · Difficulty ${guardingSelf ? 0 : 1}${guardingSelf ? "" : ` — guarding ${guardedName}`}`,
          taskCallback: async ({ passed, momentum }) => {
            const isNpcActor = CombatHUD.isGroundNpcActor(actor);
            const pool       = isNpcActor ? "threat" : "momentum";
            const currency   = isNpcActor ? "Threat" : "Momentum";

            if (passed) {
              // Store guard flag on the guarded token
              if (game.user.isGM && guardedTokenDoc) {
                try {
                  await guardedTokenDoc.setFlag("sta2e-toolkit", "guardActive", {
                    guarderName:      actor.name,
                    guarderTokenId:   token?.id ?? null,
                    expiresForTokenId,
                  });
                } catch(e) {
                  console.warn("STA2e Toolkit | Could not set guardActive flag:", e);
                }
              }
              await ChatMessage.create({
                content: lcarsCard(
                  "🛡️ GUARD — SUCCESS",
                  LC.green,
                  `<div style="font-size:11px;font-weight:700;color:${LC.tertiary};
                    margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                  <div style="font-size:10px;color:${LC.text};font-family:${LC.font};line-height:1.6;">
                    <strong style="color:${LC.green};">${guardedName}</strong> is now guarded.<br>
                    Attacks against them are <strong>+1 Difficulty</strong>
                    until the start of ${guardingSelf ? "their" : `${guardedName}'s`} next turn.
                    ${momentum > 0
                      ? `<br><span style="color:${LC.secondary};">+${momentum} ${currency} gained.</span>`
                      : ""}
                  </div>`
                ),
                speaker: ChatMessage.getSpeaker({ token }),
              });
            } else {
              await ChatMessage.create({
                content: lcarsCard(
                  "🛡️ GUARD — FAILED",
                  LC.red,
                  `<div style="font-size:11px;font-weight:700;color:${LC.tertiary};
                    margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                  <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
                    Guard failed — no defensive bonus applied.
                  </div>`
                ),
                speaker: ChatMessage.getSpeaker({ token }),
              });
            }
          },
        });
        break;
      }

      case "ground-sprint": {
        const isNpcSprinter = CombatHUD.isGroundNpcActor(actor);
        openPlayerRoller(actor, token, {
          officer:     readOfficerStats(actor),
          groundMode:  true,
          groundIsNpc: isNpcSprinter,
          difficulty:  0,
          defaultAttr: "fitness",
          defaultDisc: "conn",
          taskLabel:   "Sprint",
          taskContext: `${actor.name} · Fitness + Conn · Difficulty 0 — each Momentum spent moves one additional zone`,
          taskCallback: async ({ passed, momentum }) => {
            const pool     = isNpcSprinter ? "threat" : "momentum";
            const currency = isNpcSprinter ? "Threat" : "Momentum";
            await ChatMessage.create({
              content: lcarsCard(
                "💨 SPRINT",
                LC.primary,
                `<div style="font-size:11px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:10px;color:${LC.text};font-family:${LC.font};line-height:1.6;">
                  Moves two zones (Long range).
                  ${momentum > 0
                    ? `<br><strong style="color:${LC.secondary};">+${momentum} ${currency}</strong>
                       — spend to move ${momentum} additional zone${momentum !== 1 ? "s" : ""}.`
                    : passed
                      ? ""
                      : `<br><span style="color:${LC.textDim};">No additional zones gained.</span>`}
                </div>`
              ),
              speaker: ChatMessage.getSpeaker({ token }),
            });
          },
        });
        break;
      }

      case "ground-task": {
        openPlayerRoller(actor, token, {
          officer:    readOfficerStats(actor),
          groundMode: true,
          groundIsNpc: CombatHUD.isGroundNpcActor(actor),
          taskLabel:  "Task Roll",
        });
        break;
      }
    }
  }

  // ── Cloaking Device toggle ────────────────────────────────────────────────

  // ── Regen Shields ────────────────────────────────────────────────────────

  async _handleRegenShields(actor, token) {
    if (!CombatHUD._requiresPlayerOfficer(actor, "operations", "Operations")) return;

    const isNpc = CombatHUD.isNpcShip(actor);
    const isGM  = game.user.isGM;

    // ── Reserve Power check — required to use this action ────────────────
    if (!CombatHUD.hasReservePower(actor)) {
      ui.notifications.warn(`${actor.name}: No Reserve Power available — use Regain Power first.`);
      ChatMessage.create({
        content: lcarsCard("🔋 NO RESERVE POWER", LC.red, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
          <div style="font-size:11px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
            Regen Shields requires Reserve Power. The ship does not currently
            have Reserve Power available — use <strong>Regain Power</strong>
            from the Ops/Engineering station first.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
      return;
    }

    const curShield = actor.system?.shields?.value ?? 0;
    const maxShield = actor.system?.shields?.max   ?? 0;
    const diff      = curShield === 0 ? 3 : 2;  // +1 Difficulty if shields at 0

    // Resolve Ops station officer
    const opsOfficers = getStationOfficers(actor, "operations");
    const opsOfficer  = opsOfficers.length > 0 ? readOfficerStats(opsOfficers[0]) : null;

    // Base shields restored = roller's Engineering discipline:
    //   Named officer → their Engineering discipline value
    //   Generic NPC crew → stored crew quality dept (Basic=1, Proficient=2, Talented=3, Exceptional=4)
    const QUALITY_DEPT = { basic: 1, proficient: 2, talented: 3, exceptional: 4 };
    const storedQuality = CombatHUD.getCrewQuality(actor);
    const engDept = opsOfficer
      ? (opsOfficer.disciplines?.engineering ?? 2)
      : (QUALITY_DEPT[storedQuality] ?? 2);

    if (isNpc && isGM) {
      openNpcRoller(actor, token, {
        stationId:           "operations",
        officer:             opsOfficer,
        difficulty:          diff,
        ignoreBreachPenalty: true,
        shipSystemKey:       "structure",
        shipDeptKey:         "engineering",
        crewQuality:         !opsOfficer ? CombatHUD.getCrewQuality(actor) : null,
        taskLabel:           "Regen Shields",
        taskContext:         `Control + Engineering · Difficulty ${diff}${curShield === 0 ? " (+1 — shields at 0)" : ""} · Base ${engDept} shields (${opsOfficer ? opsOfficer.name : CombatHUD.getCrewQuality(actor) + " crew"})`,
        taskCallback: async ({ passed, successes, momentum }) => {
          if (!passed) {
            ChatMessage.create({
              content: lcarsCard("🛡️ REGEN SHIELDS FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Failed to reroute Reserve Power to shield emitters.
                </div>`),
              speaker: { alias: "STA2e Toolkit" },
            });
            return;
          }
          // Post a chat card with Threat input + Apply button
          const shieldPayload = encodeURIComponent(JSON.stringify({
            actorId: actor.id, tokenId: token?.id ?? null,
            baseRestore: engDept, maxShield, actorName: actor.name,
          }));
          ChatMessage.create({
            flags: { "sta2e-toolkit": { regenShieldCard: true } },
            content: lcarsCard("🛡️ REGEN SHIELDS — SUCCESS", LC.green, `
              <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
              <div style="font-size:11px;color:${LC.text};font-family:${LC.font};margin-bottom:8px;">
                Restores <strong style="color:${LC.green};">${engDept}</strong> shields
                (Engineering dept). Spend 1 Threat for +2 more (Repeatable).
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <label style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
                  text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;">
                  Threat Spent
                </label>
                <input class="sta2e-shield-threat" type="number" min="0" value="0"
                  style="width:60px;padding:3px 6px;background:${LC.bg};
                    border:1px solid ${LC.border};border-radius:2px;
                    color:${LC.tertiary};font-size:14px;font-weight:700;
                    font-family:${LC.font};text-align:center;" />
                <span class="sta2e-shield-total"
                  style="font-size:11px;color:${LC.textDim};font-family:${LC.font};">
                  = ${engDept} shields
                </span>
              </div>
              <button class="sta2e-apply-shields"
                data-payload="${shieldPayload}"
                style="width:100%;padding:5px;background:rgba(0,200,100,0.12);
                  border:1px solid ${LC.green};border-radius:2px;
                  color:${LC.green};font-size:10px;font-weight:700;
                  letter-spacing:0.08em;text-transform:uppercase;
                  cursor:pointer;font-family:${LC.font};">
                🛡️ APPLY SHIELDS → ${actor.name}
              </button>`),
            speaker: { alias: "STA2e Toolkit" },
          });
        },
      });

    } else {
      openPlayerRoller(actor, token, {
        stationId:           "operations",
        officer:             opsOfficer,
        difficulty:          diff,
        ignoreBreachPenalty: true,
        shipSystemKey:       "structure",
        shipDeptKey:         "engineering",
        taskLabel:           "Regen Shields",
        taskContext:         `Control + Engineering · Difficulty ${diff}${curShield === 0 ? " (+1 — shields at 0)" : ""} · Base ${engDept} shields`,
        taskCallback: async ({ passed, successes, momentum }) => {
          if (!passed) {
            ChatMessage.create({
              content: lcarsCard("🛡️ REGEN SHIELDS FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Failed to reroute Reserve Power to shield emitters.
                </div>`),
              speaker: { alias: "STA2e Toolkit" },
            });
            return;
          }
          const shieldPayload = encodeURIComponent(JSON.stringify({
            actorId: actor.id, tokenId: token?.id ?? null,
            baseRestore: engDept, maxShield, actorName: actor.name,
          }));
          ChatMessage.create({
            flags: { "sta2e-toolkit": { regenShieldCard: true } },
            content: lcarsCard("🛡️ REGEN SHIELDS — SUCCESS", LC.green, `
              <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
              <div style="font-size:11px;color:${LC.text};font-family:${LC.font};margin-bottom:8px;">
                Restores <strong style="color:${LC.green};">${engDept}</strong> shields
                (Engineering dept). Spend 1 Momentum for +2 more (Repeatable).
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <label style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
                  text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;">
                  Momentum Spent
                </label>
                <input class="sta2e-shield-threat" type="number" min="0" value="0"
                  style="width:60px;padding:3px 6px;background:${LC.bg};
                    border:1px solid ${LC.border};border-radius:2px;
                    color:${LC.tertiary};font-size:14px;font-weight:700;
                    font-family:${LC.font};text-align:center;" />
                <span class="sta2e-shield-total"
                  style="font-size:11px;color:${LC.textDim};font-family:${LC.font};">
                  = ${engDept} shields
                </span>
              </div>
              <button class="sta2e-apply-shields"
                data-payload="${shieldPayload}"
                style="width:100%;padding:5px;background:rgba(0,200,100,0.12);
                  border:1px solid ${LC.green};border-radius:2px;
                  color:${LC.green};font-size:10px;font-weight:700;
                  letter-spacing:0.08em;text-transform:uppercase;
                  cursor:pointer;font-family:${LC.font};">
                🛡️ APPLY SHIELDS → ${actor.name}
              </button>`),
            speaker: { alias: "STA2e Toolkit" },
          });
        },
      });
    }
  }

  // ── Regain Power ──────────────────────────────────────────────────────────

  async _handleRegainPower(actor, token) {
    if (!CombatHUD._requiresPlayerOfficer(actor, "operations", "Operations")) return;

    const isNpc = CombatHUD.isNpcShip(actor);
    const isGM  = game.user.isGM;

    // ── Check if ship already has Reserve Power on the actor sheet ────────
    const alreadyHasPower = CombatHUD.hasReservePower(actor);
    if (alreadyHasPower) {
      const proceed = await foundry.applications.api.DialogV2.confirm({
        window:  { title: `Regain Power — ${actor.name}` },
        content: `<div style="font-family:${LC.font};font-size:11px;color:${LC.text};padding:4px 0;">
          <strong style="color:${LC.green};">⚡ ${actor.name} already has Reserve Power.</strong><br><br>
          The ship's Reserve Power is currently available — there is no need to roll
          Regain Power. Do you want to proceed anyway?
        </div>`,
        yes: { label: "Proceed Anyway", icon: "fas fa-check" },
        no:  { label: "Cancel",         icon: "fas fa-times", default: true },
      });
      if (!proceed) return;
    }

    // ── Difficulty: base 1, +1 per use this combat ────────────────────────
    const uses     = CombatHUD.getRegainPowerUses(actor);
    const diff     = 1 + uses;
    const inCombat = !!game.combat?.active;

    const opsOfficers = getStationOfficers(actor, "operations");
    const opsOfficer  = opsOfficers.length > 0 ? readOfficerStats(opsOfficers[0]) : null;

    if (isNpc && isGM) {
      openNpcRoller(actor, token, {
        stationId:           "operations",
        officer:             opsOfficer,
        difficulty:          diff,
        ignoreBreachPenalty: true,
        noShipAssist:        true,
        crewQuality:         !opsOfficer ? CombatHUD.getCrewQuality(actor) : null,
        taskLabel:           "Regain Power",
        taskContext:         `Control + Engineering · Difficulty ${diff}${uses > 0 ? ` (+${uses} prior use${uses !== 1 ? "s" : ""} this combat)` : ""} · No ship assist`,
        taskCallback: async ({ passed, successes }) => {
          // Track this attempt during combat
          if (inCombat) await CombatHUD.incrementRegainPowerUses(actor);

          if (!passed) {
            ChatMessage.create({
              content: lcarsCard("🔋 REGAIN POWER FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Failed to restore Reserve Power (Difficulty ${diff}).
                  ${uses > 0 ? `This was attempt ${uses + 1} this combat.` : ""}
                </div>`),
              speaker: { alias: "STA2e Toolkit" },
            });
            return;
          }

          // Success — post result card with complication trait option
          const compPayload = encodeURIComponent(JSON.stringify({
            actorId: actor.id, tokenId: token?.id ?? null, actorName: actor.name,
          }));

          ChatMessage.create({
            flags: { "sta2e-toolkit": { regainPowerCard: true } },
            content: lcarsCard("🔋 RESERVE POWER RESTORED", LC.primary, `
              <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
              <div style="font-size:11px;color:${LC.green};font-weight:700;
                font-family:${LC.font};margin-bottom:4px;">
                ⚡ Reserve Power available
              </div>
              <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
                line-height:1.5;margin-bottom:8px;">
                ${successes} success${successes !== 1 ? "es" : ""}. Reserve Power restored —
                can be used for Regen Shields or Reroute Power.
                ${inCombat ? `Difficulty will be ${diff + 1} if attempted again this combat.` : ""}
              </div>
              <div style="display:flex;gap:4px;">
                <button class="sta2e-apply-reserve-power"
                  data-payload="${compPayload}"
                  style="flex:1;padding:5px;background:rgba(0,180,255,0.1);
                    border:1px solid ${LC.primary};border-radius:2px;
                    color:${LC.primary};font-size:10px;font-weight:700;
                    letter-spacing:0.06em;text-transform:uppercase;
                    cursor:pointer;font-family:${LC.font};">
                  ⚡ GRANT RESERVE POWER
                </button>
                <button class="sta2e-apply-power-complication"
                  data-payload="${compPayload}"
                  style="padding:5px 8px;background:rgba(255,100,0,0.08);
                    border:1px solid ${LC.orange};border-radius:2px;
                    color:${LC.orange};font-size:10px;font-weight:700;
                    cursor:pointer;font-family:${LC.font};"
                  title="Succeeded at Cost — grant power but apply a negative trait complication">
                  ⚠ + COMPLICATION
                </button>
              </div>`),
            speaker: { alias: "STA2e Toolkit" },
          });
        },
      });
    } else {
      openPlayerRoller(actor, token, {
        stationId:           "operations",
        officer:             opsOfficer,
        difficulty:          diff,
        ignoreBreachPenalty: true,
        noShipAssist:        true,
        taskLabel:           "Regain Power",
        taskContext:         `Control + Engineering · Difficulty ${diff}${uses > 0 ? ` (+${uses} prior use${uses !== 1 ? "s" : ""} this combat)` : ""} · No ship assist`,
        taskCallback: async ({ passed, successes }) => {
          if (inCombat) await CombatHUD.incrementRegainPowerUses(actor);

          if (!passed) {
            ChatMessage.create({
              content: lcarsCard("🔋 REGAIN POWER FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Failed to restore Reserve Power (Difficulty ${diff}).
                  ${uses > 0 ? `This was attempt ${uses + 1} this combat.` : ""}
                </div>`),
              speaker: { alias: "STA2e Toolkit" },
            });
            return;
          }

          const compPayload = encodeURIComponent(JSON.stringify({
            actorId: actor.id, tokenId: token?.id ?? null, actorName: actor.name,
          }));

          ChatMessage.create({
            flags: { "sta2e-toolkit": { regainPowerCard: true } },
            content: lcarsCard("🔋 RESERVE POWER RESTORED", LC.primary, `
              <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
              <div style="font-size:11px;color:${LC.green};font-weight:700;
                font-family:${LC.font};margin-bottom:4px;">
                ⚡ Reserve Power available
              </div>
              <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
                line-height:1.5;margin-bottom:8px;">
                ${successes} success${successes !== 1 ? "es" : ""}. Reserve Power restored —
                can be used for Regen Shields or Reroute Power.
                ${inCombat ? `Difficulty will be ${diff + 1} if attempted again this combat.` : ""}
              </div>
              <div style="display:flex;gap:4px;">
                <button class="sta2e-apply-reserve-power"
                  data-payload="${compPayload}"
                  style="flex:1;padding:5px;background:rgba(0,180,255,0.1);
                    border:1px solid ${LC.primary};border-radius:2px;
                    color:${LC.primary};font-size:10px;font-weight:700;
                    letter-spacing:0.06em;text-transform:uppercase;
                    cursor:pointer;font-family:${LC.font};">
                  ⚡ GRANT RESERVE POWER
                </button>
                <button class="sta2e-apply-power-complication"
                  data-payload="${compPayload}"
                  style="padding:5px 8px;background:rgba(255,100,0,0.08);
                    border:1px solid ${LC.orange};border-radius:2px;
                    color:${LC.orange};font-size:10px;font-weight:700;
                    cursor:pointer;font-family:${LC.font};"
                  title="Succeeded at Cost — grant power but apply a negative trait complication">
                  ⚠ + COMPLICATION
                </button>
              </div>`),
            speaker: { alias: "STA2e Toolkit" },
          });
        },
      });
    }
  }

  // ── Ram ───────────────────────────────────────────────────────────────────

  async _handleRam(actor, token, target) {
    if (!CombatHUD._requiresPlayerOfficer(actor, "helm", "Helm")) return;

    const isNpc  = CombatHUD.isNpcShip(actor);
    const isGM   = game.user.isGM;

    // Ask how many zones the attacker moved before the ram
    // Collision damage = Scale + floor(zonesMoved / 2)
    let zonesMoved = 0;
    let capturedZones = 0;
    const zonesResult = await foundry.applications.api.DialogV2.wait({
      window:  { title: `Ram — ${token.name}` },
      content: `
        <div style="font-family:${LC.font};padding:4px 0;display:flex;flex-direction:column;gap:8px;">
          <div style="font-size:10px;color:${LC.textDim};line-height:1.5;">
            Collision damage = <strong>Scale + ½ zones moved</strong> before the collision.
            How many zones did <strong>${token.name}</strong> move before ramming?
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <label style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;">
              Zones Moved
            </label>
            <input id="ram-zones" type="number" min="0" max="10" value="0"
              style="width:60px;padding:4px 8px;background:${LC.panel};
                border:1px solid ${LC.border};border-radius:2px;
                color:${LC.tertiary};font-size:16px;font-weight:700;
                font-family:${LC.font};text-align:center;" />
            <span id="ram-dmg-preview"
              style="font-size:11px;color:${LC.textDim};font-family:${LC.font};">
              = ${actor.system?.scale ?? 1} damage
            </span>
          </div>
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            padding:4px 7px;background:rgba(255,51,51,0.06);border-left:2px solid ${LC.red};border-radius:2px;">
            Attacker gains: <strong style="color:${LC.red};">Devastating · Intense · Piercing</strong><br>
            Defender return hit: Scale only (no zones moved)
          </div>
        </div>`,
      buttons: [
        {
          action:   "confirm",
          label:    "Confirm",
          icon:     "fas fa-check",
          default:  true,
          callback: (event, btn, dlg) => {
            const el = dlg.element ?? btn.closest(".app.dialog-v2");
            capturedZones = Math.max(0, parseInt(el?.querySelector("#ram-zones")?.value ?? "0") || 0);
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
      render: (event, dlg) => {
        const el    = dlg.element;
        const input = el?.querySelector("#ram-zones");
        const prev  = el?.querySelector("#ram-dmg-preview");
        if (input && prev) {
          const scale = actor.system?.scale ?? 1;
          input.addEventListener("input", () => {
            const z = Math.max(0, parseInt(input.value) || 0);
            prev.textContent = `= ${scale + Math.floor(z / 2)} damage`;
            prev.style.color = z > 0 ? "var(--sta2e-tertiary,#ffcc66)" : "var(--sta2e-text-dim,#888)";
          });
          input.addEventListener("mousedown", e => e.stopPropagation());
        }
      },
    });

    if (zonesResult !== "confirm") return;
    zonesMoved = capturedZones;

    const atkDmg = getCollisionDamage(token, zonesMoved);   // Scale + floor(zones/2)
    const defDmg = getCollisionDamage(target, 0);            // defender didn't move

    const helmOfficers = getStationOfficers(actor, "helm");
    const helmOfficer  = helmOfficers.length > 0 ? readOfficerStats(helmOfficers[0]) : null;

    const applyRam = async (momentumBonus = 0) => {
      await fireRam(token, target);

      const ramPayload = encodeURIComponent(JSON.stringify({
        attackerTokenId: token.id,
        targetTokenId:   target.id,
      }));

      // Build targetData for BOTH ships so Apply Damage buttons work for each
      // Collision damage is Piercing — ignores resistance entirely
      // Ram attacker hit is also Devastating (second hit for 2 dmg to random system)
      const buildTargetData = (victimToken, rawDmg, extra = 0, isPiercing = false, noDevastating = false) => {
        const tActor      = victimToken.actor;
        const resistance  = isPiercing ? 0 : (tActor?.system?.resistance ?? 0);
        const finalDamage = Math.max(0, rawDmg + extra - resistance);
        const encodedData = encodeURIComponent(JSON.stringify({
          tokenId:       victimToken.id,
          actorId:       tActor?.id,
          finalDamage,
          highYield:     true,   // Devastating — triggers second breach roll
          _isDevastating: false,
          targetingSystem: null,
          noDevastating,
        }));
        return {
          tokenId:        victimToken.id,
          actorId:        tActor?.id,
          name:           victimToken.name,
          rawDamage:      rawDmg + extra,
          resistance,
          modulationBonus: 0,
          glancingBonus:  0,
          finalDamage,
          scanBonus:      0,
          scanPiercing:   isPiercing,
          currentShields: tActor?.system?.shields?.value ?? 0,
          maxShields:     tActor?.system?.shields?.max   ?? 0,
          shaken:         tActor?.system?.shaken         ?? false,
          targetingSystem: null,
          _encodedData:   encodedData,
        };
      };

      // Both hits are Piercing (ignores resistance); attacker's hit is also Devastating
      const tgtData = buildTargetData(target, atkDmg, momentumBonus, true);
      const atkData = buildTargetData(token,  defDmg, 0,             true, true);

      // Helper to render a single target damage row (mirrors weapon card style)
      const damageRow = (t, label, color, { hideApply = false } = {}) => {
        const shieldAfter = Math.max(0, t.currentShields - t.finalDamage);
        const shieldColor = shieldAfter / t.maxShields > 0.5 ? LC.green
                          : shieldAfter / t.maxShields > 0.25 ? LC.yellow : LC.red;
        const warnings = [];
        if (t.currentShields === 0) warnings.push("💥 BREACH — shields already down");
        else if (shieldAfter === 0)  warnings.push("💥 BREACH — shields reduced to 0");
        else if (shieldAfter / t.maxShields < 0.25 && t.shaken) warnings.push("💥 BREACH — punched through (already shaken)");
        else if (shieldAfter / t.maxShields < 0.25) warnings.push("⚠️ SHAKEN — shields below 25%");
        else if (shieldAfter / t.maxShields < 0.5)  warnings.push("⚠️ SHAKEN — shields below 50%");

        return `
        <div style="margin-bottom:8px;padding:6px;
          background:rgba(255,51,51,0.05);border:1px solid ${LC.borderDim};border-radius:2px;">
          <div style="font-size:9px;color:${color};font-weight:700;text-transform:uppercase;
            letter-spacing:0.1em;font-family:${LC.font};margin-bottom:5px;">${label}</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-bottom:5px;text-align:center;">
            <div style="background:${LC.panel};border:1px solid ${LC.borderDim};border-radius:2px;padding:3px;">
              <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">Raw</div>
              <div style="font-size:15px;font-weight:700;color:${LC.text};">${t.rawDamage}</div>
            </div>
            <div style="background:${LC.panel};border:1px solid ${LC.borderDim};border-radius:2px;padding:3px;">
              <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">−Resist</div>
              <div style="font-size:15px;font-weight:700;color:${LC.orange};">${t.resistance}</div>
            </div>
            <div style="background:rgba(204,136,255,0.1);border:1px solid ${LC.secondary};border-radius:2px;padding:3px;">
              <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">Final</div>
              <div style="font-size:18px;font-weight:700;color:${LC.textBright};">${t.finalDamage}</div>
            </div>
          </div>
          <div style="font-size:10px;color:${LC.textDim};margin-bottom:4px;text-align:center;font-family:${LC.font};">
            SHIELDS ${t.currentShields} → <span style="color:${shieldColor};font-weight:700;">${shieldAfter}</span> / ${t.maxShields}
          </div>
          ${warnings.map(w => `<div style="padding:2px 6px;background:rgba(255,51,51,0.1);
            border-left:2px solid ${LC.red};border-radius:2px;margin-bottom:3px;
            font-size:10px;color:${LC.red};font-family:${LC.font};">${w}</div>`).join("")}
          ${hideApply ? "" : `<div class="sta2e-damage-controls" style="margin-top:5px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
              <label style="font-size:9px;color:${LC.textDim};white-space:nowrap;
                text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">Adj:</label>
              <input class="sta2e-extra-damage" type="number" value="0"
                data-base-payload="${t._encodedData}"
                style="width:44px;padding:2px 4px;background:${LC.bg};border:1px solid ${LC.border};
                  border-radius:2px;color:${LC.text};font-size:12px;text-align:center;font-family:${LC.font};"/>
              <span class="sta2e-final-display" style="font-size:11px;color:${LC.textBright};font-family:${LC.font};">
                = <strong>${t.finalDamage}</strong>
              </span>
            </div>
            <button class="sta2e-apply-damage"
              data-payload="${t._encodedData}"
              style="width:100%;padding:4px;background:rgba(255,51,51,0.1);
                border:1px solid ${LC.red};border-radius:2px;
                color:${LC.red};font-size:10px;font-weight:700;
                letter-spacing:0.08em;text-transform:uppercase;
                cursor:pointer;font-family:${LC.font};">
              ⚔ APPLY ${t.finalDamage} DAMAGE → ${t.name}
            </button>
          </div>`}
        </div>`;
      };

      ChatMessage.create({
        flags: { "sta2e-toolkit": { damageCard: true, ramResultCard: true,
          targetData: [tgtData], weaponName: "Ramming Speed" } },
        content: lcarsCard("💥 RAMMING SPEED", LC.red, `
          <div style="font-size:10px;color:${LC.textDim};margin-bottom:6px;
            font-family:${LC.font};letter-spacing:0.06em;text-align:center;">
            ${token.name.toUpperCase()} RAMS ${target.name.toUpperCase()}
            <span style="color:${LC.red};"> · INTENSE</span>
          </div>
          ${damageRow(tgtData, `${target.name} takes · DEV · INTENSE · PIERCING`, LC.red, { hideApply: true })}
          ${damageRow(atkData, `${token.name} takes · DEV · INTENSE · PIERCING`, LC.orange, { hideApply: true })}
          <div class="sta2e-ram-combined-controls" style="margin-top:4px;margin-bottom:6px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
              <label style="font-size:9px;color:${LC.textDim};white-space:nowrap;
                text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">Adj (both):</label>
              <input class="sta2e-ram-adj" type="number" value="0"
                style="width:44px;padding:2px 4px;background:${LC.bg};border:1px solid ${LC.border};
                  border-radius:2px;color:${LC.text};font-size:12px;text-align:center;font-family:${LC.font};"/>
              <span style="font-size:10px;color:${LC.textDim};font-family:${LC.font};">added to each ship</span>
            </div>
            <button class="sta2e-apply-ram-both"
              data-tgt-payload="${tgtData._encodedData}"
              data-atk-payload="${atkData._encodedData}"
              style="width:100%;padding:4px;background:rgba(255,51,51,0.1);
                border:1px solid ${LC.red};border-radius:2px;
                color:${LC.red};font-size:10px;font-weight:700;
                letter-spacing:0.08em;text-transform:uppercase;
                cursor:pointer;font-family:${LC.font};">
              ⚔ APPLY DAMAGE TO BOTH SHIPS
            </button>
          </div>
          <button class="sta2e-ram-engage"
            data-payload="${ramPayload}"
            style="margin-top:4px;width:100%;padding:5px;background:rgba(255,51,51,0.08);
              border:1px solid ${LC.borderDim};border-radius:2px;
              color:${LC.textDim};font-size:10px;font-weight:700;
              letter-spacing:0.1em;text-transform:uppercase;
              cursor:pointer;font-family:${LC.font};">
            💥 ANIMATE RAM
          </button>`),
        speaker: ChatMessage.getSpeaker({ token }),
      });
    };

    if (isNpc && isGM) {
      openNpcRoller(actor, token, {
        stationId:    "helm",
        officer:      helmOfficer,
        difficulty:   2,
        shipSystemKey: "engines",
        shipDeptKey:   "conn",
        crewQuality:  !helmOfficer ? CombatHUD.getCrewQuality(actor) : null,
        taskLabel:    `Ram — ${target.name}`,
        taskContext:  `Daring + Conn · Difficulty 2 · Engines + Conn · Deals ${atkDmg} (Dev+Intense+Piercing), takes ${defDmg} (Dev+Intense+Piercing)`,
        taskCallback: async ({ passed, momentum }) => {
          if (!passed) {
            ChatMessage.create({
              content: lcarsCard("💥 RAM FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Failed to ram ${target.name} — task did not succeed.
                </div>`),
              speaker: { alias: "STA2e Toolkit" },
            });
            return;
          }
          // Each point of Momentum beyond difficulty can be spent to add +1 damage
          // (standard Momentum spend: Penetrating Strike or bonus damage)
          await applyRam(momentum);
        },
      });
    } else {
      openPlayerRoller(actor, token, {
        stationId:    "helm",
        officer:      helmOfficer,
        difficulty:   2,
        shipSystemKey: "engines",
        shipDeptKey:   "conn",
        taskLabel:    `Ram — ${target.name}`,
        taskContext:  `Daring + Conn · Difficulty 2 · Engines + Conn · Deals ${atkDmg} (Dev+Intense+Piercing), takes ${defDmg} (Dev+Intense+Piercing)`,
        taskCallback: async ({ passed, momentum }) => {
          if (!passed) {
            ChatMessage.create({
              content: lcarsCard("💥 RAM FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Failed to ram ${target.name} — task did not succeed.
                </div>`),
              speaker: { alias: "STA2e Toolkit" },
            });
            return;
          }
          await applyRam(momentum);
        },
      });
    }
  }

  // ── Tractor Beam ─────────────────────────────────────────────────────────

  async _handleTractorBeam(actor, token, target) {
    if (!CombatHUD._requiresPlayerOfficer(actor, "tactical", "Tactical")) return;

    const isNpc = CombatHUD.isNpcShip(actor);
    const isGM  = game.user.isGM;

    // Check if already tractoring something
    const existing = CombatHUD.getTractorBeamState(token);
    if (existing?.targetTokenId) {
      const existingTarget = canvas.tokens?.get(existing.targetTokenId);
      const release = await foundry.applications.api.DialogV2.confirm({
        window:  { title: `Tractor Beam — ${actor.name}` },
        content: `<div style="font-family:${LC.font};font-size:11px;color:${LC.text};padding:4px 0;">
          Already tractoring <strong>${existing.targetName}</strong>.
          Release the current tractor beam?
        </div>`,
        yes: { label: "Release Beam", icon: "fas fa-unlink", default: true },
        no:  { label: "Cancel",       icon: "fas fa-times" },
      });
      if (!release) return;
      await CombatHUD.releaseTractorBeam(token, existingTarget);
      ChatMessage.create({
        content: lcarsCard("🔗 TRACTOR BEAM RELEASED", LC.textDim, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
          <div style="font-size:13px;color:${LC.text};font-family:${LC.font};">
            Tractor beam disengaged from ${existing.targetName}.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
      game.sta2eToolkit?.combatHud?._refresh?.();
      return;
    }

    // Tractor strength = ship's Structure system rating (used as break-free Difficulty)
    const tractorStr = actor.system?.systems?.structure?.value ?? 0;

    const tacticalOfficers = getStationOfficers(actor, "tactical");
    const tacticalOfficer  = tacticalOfficers.length > 0 ? readOfficerStats(tacticalOfficers[0]) : null;

    const engagePayload = encodeURIComponent(JSON.stringify({
      sourceTokenId: token.id,
      targetTokenId: target.id,
      sourceName:    token.name,
      targetName:    target.name,
      tractorStr,
    }));

    const onSuccess = () => {
      ChatMessage.create({
        flags: { "sta2e-toolkit": { tractorBeamCard: true } },
        content: lcarsCard("🔗 TRACTOR BEAM LOCKED", LC.primary, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
          <div style="font-size:14px;font-weight:700;color:${LC.primary};
            text-align:center;padding:5px 0;font-family:${LC.font};">
            🔗 ${target.name} in tractor lock
          </div>
          <div style="display:flex;justify-content:center;gap:16px;margin-bottom:8px;
            font-size:10px;font-family:${LC.font};">
            <div style="text-align:center;">
              <div style="color:${LC.textDim};text-transform:uppercase;letter-spacing:0.08em;">Break-Free Diff</div>
              <div style="font-size:18px;font-weight:700;color:${LC.tertiary};">${tractorStr}</div>
            </div>
            <div style="text-align:center;">
              <div style="color:${LC.textDim};text-transform:uppercase;letter-spacing:0.08em;">Task</div>
              <div style="font-size:11px;color:${LC.text};">Engines + Conn<br>vs Difficulty ${tractorStr}</div>
            </div>
          </div>
          <div style="display:flex;gap:4px;">
            <button class="sta2e-tractor-engage"
              data-payload="${engagePayload}"
              style="flex:1;padding:5px;background:rgba(0,166,251,0.12);
                border:1px solid ${LC.primary};border-radius:2px;
                color:${LC.primary};font-size:10px;font-weight:700;
                letter-spacing:0.08em;text-transform:uppercase;
                cursor:pointer;font-family:${LC.font};">
              🔗 ENGAGE TRACTOR
            </button>
            <button class="sta2e-tractor-release"
              data-payload="${engagePayload}"
              style="padding:5px 8px;background:rgba(255,51,51,0.08);
                border:1px solid ${LC.borderDim};border-radius:2px;
                color:${LC.textDim};font-size:10px;font-weight:700;
                cursor:pointer;font-family:${LC.font};"
              title="Release tractor beam">
              ✕
            </button>
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
    };

    if (isNpc && isGM) {
      openNpcRoller(actor, token, {
        stationId:           "tactical",
        officer:             tacticalOfficer,
        difficulty:          2,
        shipSystemKey:       "structure",
        shipDeptKey:         "security",
        crewQuality:         !tacticalOfficer ? CombatHUD.getCrewQuality(actor) : null,
        taskLabel:           `Tractor Beam — ${target.name}`,
        taskContext:         `Control + Security · Difficulty 2 · Structure + Security · Break-free Diff ${tractorStr}`,
        taskCallback: async ({ passed }) => {
          if (!passed) {
            ChatMessage.create({
              content: lcarsCard("🔗 TRACTOR BEAM FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Failed to lock tractor beam on ${target.name}.
                </div>`),
              speaker: { alias: "STA2e Toolkit" },
            });
            return;
          }
          onSuccess();
        },
      });
    } else {
      openPlayerRoller(actor, token, {
        stationId:           "tactical",
        officer:             tacticalOfficer,
        difficulty:          2,
        shipSystemKey:       "structure",
        shipDeptKey:         "security",
        taskLabel:           `Tractor Beam — ${target.name}`,
        taskContext:         `Control + Security · Difficulty 2 · Structure + Security · Break-free Diff ${tractorStr}`,
        taskCallback: async ({ passed }) => {
          if (!passed) {
            ChatMessage.create({
              content: lcarsCard("🔗 TRACTOR BEAM FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Failed to lock tractor beam on ${target.name}.
                </div>`),
              speaker: { alias: "STA2e Toolkit" },
            });
            return;
          }
          onSuccess();
        },
      });
    }
  }

  // ── Prepare ───────────────────────────────────────────────────────────────

  async _handlePrepare(actor, token) {
    const isGM         = game.user.isGM;
    const weaponsArmed = CombatHUD.getWeaponsArmed(actor);
    const shieldsDown  = CombatHUD.getShieldsLowered(actor);
    const curShields   = actor.system?.shields?.value ?? 0;
    const maxShields   = actor.system?.shields?.max   ?? 0;

    // Ask what to prepare
    let choice = null;
    const result = await foundry.applications.api.DialogV2.wait({
      window:  { title: `Prepare — ${actor.name}` },
      content: `
        <div style="font-family:${LC.font};padding:4px 0;display:flex;flex-direction:column;gap:6px;">
          <div style="font-size:10px;color:${LC.textDim};line-height:1.5;margin-bottom:4px;">
            Choose what to prepare this minor action.
          </div>
          ${[
            { key: "arm",   icon: "⚡", label: "Arm Weapons",    desc: "Ready weapons for attack. Enemy ships can detect armed weapons.",
              active: weaponsArmed, activeLabel: "Currently ARMED" },
            { key: "disarm",icon: "⚡", label: "Disarm Weapons", desc: "Stand down weapons systems.",
              active: !weaponsArmed, activeLabel: "Currently UNARMED" },
            { key: "lower", icon: "🛡️", label: "Lower Shields",  desc: `Set shields to 0. Current: ${curShields}/${maxShields}.`,
              active: shieldsDown, activeLabel: "Shields LOWERED" },
            { key: "raise", icon: "🛡️", label: "Raise Shields",  desc: `Restore shields to max. Saved max: ${CombatHUD.getShieldsSavedMax(actor) ?? maxShields}.`,
              active: !shieldsDown, activeLabel: "Shields RAISED" },

          ].map(o => `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
              padding:5px 8px;border-radius:2px;
              border:1px solid ${o.active ? LC.primary : LC.borderDim};
              background:${o.active ? "rgba(255,153,0,0.07)" : LC.panel};">
              <input type="radio" name="prepare-choice" value="${o.key}"
                style="accent-color:${LC.primary};" />
              <div style="flex:1;">
                <span style="font-size:11px;font-weight:700;color:${LC.text};
                  font-family:${LC.font};">${o.icon ? o.icon + " " : ""}${o.label}</span>
                <span style="font-size:10px;color:${LC.textDim};
                  font-family:${LC.font};"> — ${o.desc}</span>
              </div>
              ${o.active ? `<span style="font-size:9px;color:${LC.primary};font-weight:700;
                font-family:${LC.font};">${o.activeLabel}</span>` : ""}
            </label>`).join("")}
        </div>`,
      buttons: [
        {
          action:   "confirm",
          label:    "Confirm",
          icon:     "fas fa-check",
          default:  true,
          callback: (event, btn, dlg) => {
            const el = dlg.element ?? btn.closest(".app.dialog-v2");
            choice = el?.querySelector("input[name='prepare-choice']:checked")?.value ?? null;
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });

    if (result !== "confirm" || !choice) return;

    if (choice === "arm") {
      await CombatHUD.setWeaponsArmed(actor, true);
      ChatMessage.create({
        content: lcarsCard("⚡ WEAPONS ARMED", LC.red, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
          <div style="font-size:16px;font-weight:700;color:${LC.red};
            text-align:center;padding:6px 0;font-family:${LC.font};">
            ⚡ WEAPONS ARMED
          </div>
          <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
            text-align:center;line-height:1.5;">
            Weapons systems are armed and ready to fire.
            Enemy ships with sensors may detect active weapon locks.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });

    } else if (choice === "disarm") {
      await CombatHUD.setWeaponsArmed(actor, false);
      ChatMessage.create({
        content: lcarsCard("⚡ WEAPONS STANDING DOWN", LC.textDim, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
          <div style="font-size:14px;font-weight:700;color:${LC.textDim};
            text-align:center;padding:5px 0;font-family:${LC.font};">
            Weapons Disarmed
          </div>
          <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
            text-align:center;">
            Weapon systems standing down. Cannot make Weapons Attacks while unarmed.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });

    } else if (choice === "lower") {
      // Save BOTH the current value and max so we can restore exactly
      await CombatHUD.setShieldsLowered(actor, true, curShields);
      // Store max separately so we know the shield ceiling too
      const doc = actor.isToken && actor.token && !actor.token.isLinked
        ? actor.token : actor.isToken ? (game.actors.get(actor.id ?? actor._id) ?? actor) : actor;
      await doc?.setFlag("sta2e-toolkit", "shieldsSavedMax2", maxShields).catch(() => {});
      await actor.update({ "system.shields.value": 0, "system.shields.max": 0 });
      ChatMessage.create({
        content: lcarsCard("🛡️ SHIELDS LOWERED", LC.primary, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
          <div style="font-size:20px;font-weight:700;color:${LC.primary};
            text-align:center;padding:6px 0;font-family:${LC.font};">
            🛡️ → 0
          </div>
          <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
            text-align:center;line-height:1.5;">
            Shields offline. Will restore to ${curShields}/${maxShields} when raised.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });

    } else if (choice === "raise") {
      // Restore to saved value and max
      const doc          = actor.isToken && actor.token && !actor.token.isLinked
        ? actor.token : actor.isToken ? (game.actors.get(actor.id ?? actor._id) ?? actor) : actor;
      const savedValue   = CombatHUD.getShieldsSavedMax(actor) ?? curShields;   // stored as value
      const savedMax2    = doc?.getFlag("sta2e-toolkit", "shieldsSavedMax2") ?? maxShields;
      await CombatHUD.setShieldsLowered(actor, false);
      await doc?.unsetFlag("sta2e-toolkit", "shieldsSavedMax2").catch(() => {});
      await actor.update({
        "system.shields.max":   savedMax2,
        "system.shields.value": Math.min(savedValue, savedMax2),
      });
      ChatMessage.create({
        content: lcarsCard("🛡️ SHIELDS RAISED", LC.green, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
          <div style="font-size:20px;font-weight:700;color:${LC.green};
            text-align:center;padding:6px 0;font-family:${LC.font};">
            🛡️ ${Math.min(savedValue, savedMax2)}/${savedMax2}
          </div>
          <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
            text-align:center;line-height:1.5;">
            Shields restored to previous level.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });

    }

    game.sta2eToolkit?.combatHud?._refresh?.();
  }

  // ── Warp ──────────────────────────────────────────────────────────────────

  async _handleWarp(actor, token) {
    if (!CombatHUD._requiresPlayerOfficer(actor, "helm", "Helm")) return;

    const isNpc = CombatHUD.isNpcShip(actor);
    const isGM  = game.user.isGM;

    // Reserve Power check
    if (!CombatHUD.hasReservePower(actor)) {
      ui.notifications.warn(`${actor.name}: No Reserve Power — use Regain Power first.`);
      ChatMessage.create({
        content: lcarsCard("🔋 NO RESERVE POWER", LC.red, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
          <div style="font-size:11px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
            Warp requires Reserve Power. The ship does not currently have
            Reserve Power available — use <strong>Regain Power</strong> first.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
      return;
    }

    const enginesRating = actor.system?.systems?.engines?.value ?? "?";
    const helmOfficers  = getStationOfficers(actor, "helm");
    const helmOfficer   = helmOfficers.length > 0 ? readOfficerStats(helmOfficers[0]) : null;
    const allowedUserIds = getStationAllowedUserIds(actor, "helm");

    // Encode token payload for the Engage button
    const engagePayload = encodeURIComponent(JSON.stringify({
      actorId: actor.id,
      tokenId: token?.id ?? null,
      actorName: actor.name,
    }));

    const onSuccess = async () => {
      // Consume Reserve Power
      await CombatHUD.clearReservePower(actor);

      ChatMessage.create({
        flags: { "sta2e-toolkit": { warpEngageCard: true, allowedUserIds } },
        content: lcarsCard("🌀 WARP ENGAGED", LC.primary, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
          <div style="font-size:20px;font-weight:700;color:${LC.primary};
            text-align:center;padding:6px 0;font-family:${LC.font};">
            ${enginesRating !== "?" ? `Move up to ${enginesRating} zones` : "Warp Speed"}
          </div>
          <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
            text-align:center;margin-bottom:8px;line-height:1.5;">
            Or leave the battlefield entirely (GM discretion).
            Reserve Power consumed.
          </div>
          <div style="display:flex;gap:6px;">
            <button class="sta2e-warp-engage"
              data-payload="${engagePayload}"
              style="flex:1;padding:7px;background:rgba(0,166,251,0.15);
                border:1px solid ${LC.primary};border-radius:2px;
                color:${LC.primary};font-size:12px;font-weight:700;
                letter-spacing:0.12em;text-transform:uppercase;
                cursor:pointer;font-family:${LC.font};">
              ⚡ ENGAGE
            </button>
            <button class="sta2e-warp-flee"
              data-payload="${engagePayload}"
              title="Ship warps to the nearest canvas edge and is removed from the scene"
              style="padding:7px 12px;background:rgba(220,120,0,0.15);
                border:1px solid #dc7800;border-radius:2px;
                color:#dc7800;font-size:12px;font-weight:700;
                letter-spacing:0.08em;text-transform:uppercase;
                cursor:pointer;font-family:${LC.font};">
              🚀 FLEE
            </button>
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
    };

    if (isNpc && isGM) {
      openNpcRoller(actor, token, {
        stationId:   "helm",
        officer:     helmOfficer,
        difficulty:  1,
        // Engines breach penalty applies naturally via stationId: "helm"
        shipSystemKey: "engines",
        shipDeptKey:   "conn",
        crewQuality:   !helmOfficer ? CombatHUD.getCrewQuality(actor) : null,
        taskLabel:     "Warp",
        taskContext:   `Control + Conn · Difficulty 1 · Engines + Conn · Move ${enginesRating} zones or leave battle`,
        taskCallback:  async ({ passed }) => {
          if (!passed) {
            ChatMessage.create({
              content: lcarsCard("🌀 WARP FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Failed to engage warp drive. Reserve Power not consumed.
                </div>`),
              speaker: { alias: "STA2e Toolkit" },
            });
            return;
          }
          await onSuccess();
        },
      });
    } else {
      openPlayerRoller(actor, token, {
        stationId:   "helm",
        officer:     helmOfficer,
        difficulty:  1,
        shipSystemKey: "engines",
        shipDeptKey:   "conn",
        taskLabel:     "Warp",
        taskContext:   `Control + Conn · Difficulty 1 · Engines + Conn · Move ${enginesRating} zones or leave battle`,
        taskCallback:  async ({ passed }) => {
          if (!passed) {
            ChatMessage.create({
              content: lcarsCard("🌀 WARP FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Failed to engage warp drive. Reserve Power not consumed.
                </div>`),
              speaker: { alias: "STA2e Toolkit" },
            });
            return;
          }
          await onSuccess();
        },
      });
    }
  }

  // ── Maneuver ──────────────────────────────────────────────────────────────

  async _handleManeuver(actor, token) {
    if (!CombatHUD._requiresPlayerOfficer(actor, "helm", "Helm")) return;

    const isNpc = CombatHUD.isNpcShip(actor);
    const isGM  = game.user.isGM;

    const helmOfficers = getStationOfficers(actor, "helm");
    const helmOfficer  = helmOfficers.length > 0 ? readOfficerStats(helmOfficers[0]) : null;

    if (isNpc && isGM) {
      openNpcRoller(actor, token, {
        stationId:   "helm",
        officer:     helmOfficer,
        difficulty:  0,
        // No ignoreBreachPenalty — Engines breach penalty applies naturally
        // No noShipAssist — Engines + Conn assists
        shipSystemKey:  "engines",
        shipDeptKey:    "conn",
        crewQuality:    !helmOfficer ? CombatHUD.getCrewQuality(actor) : null,
        taskLabel:   "Maneuver",
        taskContext: "Control + Conn · Difficulty 0 (adjust for environmental traits) · Engines + Conn",
        taskCallback: ({ passed, successes, momentum }) => {
          ChatMessage.create({
            content: lcarsCard(
              passed ? "🔄 MANEUVER — SUCCESS" : "🔄 MANEUVER FAILED",
              passed ? LC.primary : LC.red,
              `<div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
              ${passed ? `
              <div style="font-size:11px;color:${LC.text};font-family:${LC.font};margin-bottom:4px;">
                ${successes} success${successes !== 1 ? "es" : ""}
                ${momentum > 0 ? `· <span style="color:${LC.green};">+${momentum} Momentum</span>` : ""}
              </div>
              <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};line-height:1.5;">
                Momentum may be spent to move through difficult or hazardous terrain.
              </div>` : `
              <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                Maneuver failed — movement costs are not reduced.
              </div>`}`),
            speaker: { alias: "STA2e Toolkit" },
          });
        },
      });
    } else {
      openPlayerRoller(actor, token, {
        stationId:   "helm",
        officer:     helmOfficer,
        difficulty:  0,
        shipSystemKey:  "engines",
        shipDeptKey:    "conn",
        taskLabel:   "Maneuver",
        taskContext: "Control + Conn · Difficulty 0 (adjust for environmental traits) · Engines + Conn",
        taskCallback: ({ passed, successes, momentum }) => {
          ChatMessage.create({
            content: lcarsCard(
              passed ? "🔄 MANEUVER — SUCCESS" : "🔄 MANEUVER FAILED",
              passed ? LC.primary : LC.red,
              `<div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
              ${passed ? `
              <div style="font-size:11px;color:${LC.text};font-family:${LC.font};margin-bottom:4px;">
                ${successes} success${successes !== 1 ? "es" : ""}
                ${momentum > 0 ? `· <span style="color:${LC.green};">+${momentum} Momentum</span>` : ""}
              </div>
              <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};line-height:1.5;">
                Momentum may be spent to move through difficult or hazardous terrain.
              </div>` : `
              <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                Maneuver failed — movement costs are not reduced.
              </div>`}`),
            speaker: { alias: "STA2e Toolkit" },
          });
        },
      });
    }
  }

  // ── Info-only actions (Impulse, Thrusters, Launch Probe) ────────────────

  async _handleInfoAction(actor, token, action) {
    const INFO = {
      "impulse": {
        label: "IMPULSE",
        color: LC.red,
        stationId: "helm",
        rows: [
          { key: "Movement",  val: "Up to 2 zones (anywhere within Long range)" },
          { key: "Bonus",     val: "Moving only 1 zone reduces Momentum cost of difficult/hazardous terrain by 1" },
        ],
        note: "Minor action. Uses impulse engines.",
        engageButton: true,
      },
      "thrusters": {
            label: "THRUSTERS",
        color: LC.primary,
        rows: [
          { key: "Movement", val: "Anywhere within your current zone" },
          { key: "Special",  val: "May move safely into Contact with another ship, station, or object (including docking/landing)" },
        ],
        note: "Minor action. Uses maneuvering thrusters — fine positional adjustment only.",
      },
      "launch-probe": {
            label: "LAUNCH PROBE",
        color: LC.secondary,
        rows: [
          { key: "Range",    val: "Select a single zone within Long range — probe flies there" },
          { key: "Benefit",  val: "Sensor Operations major actions may use the probe's location as origin instead of the ship" },
          { key: "Risk",     val: "Probe can be targeted as a Small Craft — destroyed on any damage" },
        ],
        note: "Major action (Sensor Operations station).",
      },
    };

    const cfg = INFO[action.key ?? action];
    if (!cfg) return;

    const engagePayload = cfg.engageButton
      ? encodeURIComponent(JSON.stringify({ actorId: actor.id, tokenId: token?.id ?? null }))
      : null;
    const allowedUserIds = cfg.engageButton && cfg.stationId
      ? getStationAllowedUserIds(actor, cfg.stationId)
      : [];

    ChatMessage.create({
      flags: cfg.engageButton ? {
        "sta2e-toolkit": {
          impulseEngageCard: true,
          allowedUserIds,
        }
      } : {},
      content: lcarsCard(`${cfg.icon ? cfg.icon + " " : ""}${cfg.label}`, cfg.color, `
        <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
          margin-bottom:6px;font-family:${LC.font};">${actor.name}</div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          ${cfg.rows.map(r => `
          <div style="display:flex;gap:8px;align-items:baseline;">
            <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;min-width:72px;flex-shrink:0;">
              ${r.key}
            </span>
            <span style="font-size:11px;color:${LC.text};font-family:${LC.font};">
              ${r.val}
            </span>
          </div>`).join("")}
          <div style="margin-top:3px;padding:4px 7px;
            background:rgba(255,153,0,0.06);border-left:2px solid ${cfg.color};
            border-radius:2px;font-size:10px;color:${LC.textDim};font-family:${LC.font};">
            ${cfg.note}
          </div>
          ${cfg.engageButton ? `
          <button class="sta2e-impulse-engage"
            data-payload="${engagePayload}"
            style="margin-top:4px;width:100%;padding:6px;
              background:rgba(255,50,50,0.12);border:1px solid ${LC.red};border-radius:2px;
              color:${LC.red};font-size:11px;font-weight:700;
              letter-spacing:0.1em;text-transform:uppercase;
              cursor:pointer;font-family:${LC.font};">
            🔴 ENGAGE IMPULSE
          </button>` : ""}
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
  }

  // ── Modulate Shields ─────────────────────────────────────────────────────

  async _handleModulateShields(actor, token) {
    const curShield = actor.system?.shields?.value ?? 0;

    // Cannot modulate if shields are at 0
    if (curShield <= 0) {
      ui.notifications.warn(`${actor.name}: Shields are at 0 — cannot modulate.`);
      ChatMessage.create({
        content: lcarsCard("🔰 MODULATE SHIELDS FAILED", LC.red, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
          <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            Shields are at 0 — cannot modulate shield frequencies.
            Restore shields before attempting this action.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
      return;
    }

    // Toggle — if already modulated, turn it off; otherwise activate
    const isActive = CombatHUD.getModulatedShields(actor);
    await CombatHUD.setModulatedShields(actor, !isActive);

    if (!isActive) {
      ChatMessage.create({
        content: lcarsCard("🔰 SHIELDS MODULATED", LC.primary, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
          <div style="font-size:20px;font-weight:700;color:${LC.primary};
            text-align:center;padding:6px 0;font-family:${LC.font};">
            +2 Resistance
          </div>
          <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
            text-align:center;line-height:1.5;">
            Shield frequencies modulated. Ship Resistance increased by 2
            until the end of the round or the next attack.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
    } else {
      ChatMessage.create({
        content: lcarsCard("🔰 SHIELD MODULATION CLEARED", LC.textDim, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
          <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            Shield modulation cleared — Resistance bonus removed.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
    }

    game.sta2eToolkit?.combatHud?._refresh?.();
  }

  // ── Reroute Power ────────────────────────────────────────────────────────

  async _handleReroutePower(actor, token) {
    const isGM = game.user.isGM;

    // ── Reserve Power check ───────────────────────────────────────────────
    if (!CombatHUD.hasReservePower(actor)) {
      ui.notifications.warn(`${actor.name}: No Reserve Power available — use Regain Power first.`);
      ChatMessage.create({
        content: lcarsCard("🔋 NO RESERVE POWER", LC.red, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
          <div style="font-size:11px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
            Reroute Power requires Reserve Power. The ship does not currently
            have Reserve Power available — use <strong>Regain Power</strong>
            from the Ops station first.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
      return;
    }

    // ── Pick target system ────────────────────────────────────────────────
    const SYSTEMS = ["communications","computers","engines","sensors","structure","weapons"];

    // Show any systems already rerouted
    const alreadyRerouted = SYSTEMS.filter(k => CombatHUD.getReroutedPower(actor, k));

    let capturedSystem = null;
    const result = await foundry.applications.api.DialogV2.wait({
      window:  { title: `Reroute Power — ${actor.name}` },
      content: `
        <div style="font-family:${LC.font};padding:4px 0;display:flex;flex-direction:column;gap:8px;">
          <div style="font-size:10px;color:${LC.textDim};line-height:1.5;">
            Spend Reserve Power to reroute energy to a chosen system.
            The system benefits from the power on the <strong>next action</strong>
            that uses it, then the power is spent.
          </div>
          ${alreadyRerouted.length > 0 ? `
          <div style="padding:4px 7px;background:rgba(255,153,0,0.07);
            border-left:2px solid ${LC.primary};border-radius:2px;
            font-size:10px;color:${LC.textDim};font-family:${LC.font};">
            Already rerouted: ${alreadyRerouted.map(k => CombatHUD.systemLabel(k)).join(", ")}
          </div>` : ""}
          <div style="display:flex;flex-direction:column;gap:3px;">
            ${SYSTEMS.map(k => {
              const label    = CombatHUD.systemLabel(k);
              const rating   = actor.system?.systems?.[k]?.value ?? "?";
              const rerouted = CombatHUD.getReroutedPower(actor, k);
              return `
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                padding:4px 7px;border-radius:2px;
                border:1px solid ${rerouted ? LC.primary : LC.borderDim};
                background:${rerouted ? "rgba(255,153,0,0.08)" : LC.panel};">
                <input type="radio" name="reroute-system" value="${k}"
                  style="accent-color:${LC.primary};" />
                <span style="flex:1;font-size:11px;font-weight:700;
                  color:${LC.text};font-family:${LC.font};">${label}</span>
                <span style="font-size:10px;color:${LC.textDim};
                  font-family:${LC.font};">Rating ${rating}</span>
                ${rerouted ? `<span style="font-size:9px;color:${LC.primary};
                  font-family:${LC.font};font-weight:700;">⚡ REROUTED</span>` : ""}
              </label>`;
            }).join("")}
          </div>
        </div>`,
      buttons: [
        {
          action:   "confirm",
          label:    "⚡ Reroute Power",
          icon:     "fas fa-bolt",
          default:  true,
          callback: (event, btn, dlg) => {
            const el = dlg.element ?? btn.closest(".app.dialog-v2");
            capturedSystem = el?.querySelector("input[name='reroute-system']:checked")?.value ?? null;
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });

    if (result !== "confirm" || !capturedSystem) return;

    const sysLabel = CombatHUD.systemLabel(capturedSystem);

    // Consume reserve power and flag the system as having rerouted power
    await CombatHUD.clearReservePower(actor);
    await CombatHUD.setReroutedPower(actor, capturedSystem, true);

    ChatMessage.create({
      content: lcarsCard("⚡ POWER REROUTED", LC.primary, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
        <div style="font-size:20px;font-weight:700;color:${LC.primary};
          text-align:center;padding:6px 0;font-family:${LC.font};">
          ⚡ ${sysLabel}
        </div>
        <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
          line-height:1.5;text-align:center;">
          Reserve Power rerouted. The next task using ${sysLabel}
          benefits from the additional power, then the reroute is spent.
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });

    game.sta2eToolkit?.combatHud?._refresh?.();
  }

  // ── Transporter ──────────────────────────────────────────────────────────

  async _handleTransport(actor, token, station) {
    if (!CombatHUD._requiresPlayerOfficer(actor, station?.id ?? "operations", station?.label ?? "Operations")) return;

    const isNpc = CombatHUD.isNpcShip(actor);
    const isGM  = game.user.isGM;

    // ── Step 1: Transport configuration dialog ────────────────────────────
    let transportType   = "pad-to-pad";   // pad-to-pad | one-pad | site-to-site
    let operationSite   = "transporter";  // transporter | bridge | engineering
    let capturedConfig  = null;

    const ownShields    = actor.system?.shields?.value ?? 0;
    const targetToken   = Array.from(game.user.targets)[0] ?? null;
    const targetShields = targetToken?.actor?.system?.shields?.value ?? 0;

    const shieldWarning = ownShields > 0
      ? `⚠ Your shields are active — transport is blocked.`
      : targetShields > 0
        ? `⚠ Target's shields are active — transport is blocked.`
        : null;

    const result = await foundry.applications.api.DialogV2.wait({
      window:  { title: `Transporter — ${actor.name}` },
      content: `
        <div style="font-family:${LC.font};padding:4px 0;display:flex;flex-direction:column;gap:10px;">
          ${shieldWarning ? `
          <div style="padding:5px 8px;background:rgba(255,51,51,0.1);
            border-left:3px solid ${LC.red};border-radius:2px;
            font-size:10px;font-weight:700;color:${LC.red};font-family:${LC.font};">
            ${shieldWarning}
          </div>` : ""}

          <div>
            <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;margin-bottom:5px;">
              Transport Type
            </div>
            <div style="display:flex;flex-direction:column;gap:3px;">
              ${[
                { key: "pad-to-pad",    label: "Pad-to-Pad",    diff: "+0", desc: "Both locations have transporter pads" },
                { key: "one-pad",       label: "One Pad",        diff: "+1", desc: "One location has a pad, one does not" },
                { key: "site-to-site",  label: "Site-to-Site",   diff: "+2", desc: "Neither location has a transporter pad" },
              ].map(t => `
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                  padding:4px 7px;border-radius:2px;
                  border:1px solid ${LC.borderDim};background:${LC.panel};">
                  <input type="radio" name="transport-type" value="${t.key}"
                    ${t.key === "pad-to-pad" ? "checked" : ""}
                    style="accent-color:${LC.primary};" />
                  <div style="flex:1;">
                    <span style="font-size:11px;font-weight:700;color:${LC.text};
                      font-family:${LC.font};">${t.label}</span>
                    <span style="font-size:10px;color:${LC.textDim};
                      font-family:${LC.font};"> — ${t.desc}</span>
                  </div>
                  <span style="font-size:10px;color:${LC.primary};font-weight:700;
                    font-family:${LC.font};">Diff ${t.diff}</span>
                </label>`).join("")}
            </div>
          </div>

          <div>
            <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;margin-bottom:5px;">
              Operating From
            </div>
            <div style="display:flex;flex-direction:column;gap:3px;">
              ${[
                { key: "transporter", label: "Transporter Room",  diff: "+0", desc: "Direct operation from transporter room" },
                { key: "bridge",      label: "Bridge",            diff: "+1", desc: "Remote from this station" },
                { key: "engineering", label: "Main Engineering",  diff: "+1", desc: "Remote operation from Main Engineering" },
              ].map(s => `
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                  padding:4px 7px;border-radius:2px;
                  border:1px solid ${LC.borderDim};background:${LC.panel};">
                  <input type="radio" name="operation-site" value="${s.key}"
                    ${s.key === "bridge" ? "checked" : ""}
                    style="accent-color:${LC.primary};" />
                  <div style="flex:1;">
                    <span style="font-size:11px;font-weight:700;color:${LC.text};
                      font-family:${LC.font};">${s.label}</span>
                    <span style="font-size:10px;color:${LC.textDim};
                      font-family:${LC.font};"> — ${s.desc}</span>
                  </div>
                  <span style="font-size:10px;color:${LC.primary};font-weight:700;
                    font-family:${LC.font};">Diff ${s.diff}</span>
                </label>`).join("")}
            </div>
          </div>

          <div style="padding:5px 8px;background:rgba(255,153,0,0.06);
            border-left:2px solid ${LC.primary};border-radius:2px;">
            <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px;">
              Total Difficulty
            </div>
            <div id="transport-diff-preview"
              style="font-size:16px;font-weight:700;color:${LC.tertiary};font-family:${LC.font};">
              1
            </div>
          </div>
        </div>`,
      buttons: [
        {
          action:   "confirm",
          label:    "✨ Proceed to Roll",
          icon:     "fas fa-check",
          default:  true,
          callback: (event, btn, dlg) => {
            const el = dlg.element ?? btn.closest(".app.dialog-v2");
            transportType  = el?.querySelector("input[name='transport-type']:checked")?.value ?? "pad-to-pad";
            operationSite  = el?.querySelector("input[name='operation-site']:checked")?.value ?? "bridge";
            capturedConfig = { transportType, operationSite };
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
      render: (event, dlg) => {
        const el      = dlg.element;
        const preview = el?.querySelector("#transport-diff-preview");
        const update  = () => {
          const type = el?.querySelector("input[name='transport-type']:checked")?.value ?? "pad-to-pad";
          const site = el?.querySelector("input[name='operation-site']:checked")?.value ?? "bridge";
          const typeDiff = type === "pad-to-pad" ? 0 : type === "one-pad" ? 1 : 2;
          const siteDiff = site === "transporter" ? 0 : 1;
          if (preview) {
            preview.textContent = typeDiff + siteDiff;
            preview.style.color = (typeDiff + siteDiff) > 1
              ? "var(--sta2e-tertiary,#ffcc66)"
              : "var(--sta2e-text-dim,#888)";
          }
        };
        el?.querySelectorAll("input[name='transport-type']").forEach(r => r.addEventListener("change", update));
        el?.querySelectorAll("input[name='operation-site']").forEach(r => r.addEventListener("change", update));
        update();
      },
    });

    if (result !== "confirm" || !capturedConfig) return;

    // Calculate final difficulty
    const typeDiff = transportType === "pad-to-pad" ? 0 : transportType === "one-pad" ? 1 : 2;
    const siteDiff = operationSite === "transporter" ? 0 : 1;
    const totalDiff = typeDiff + siteDiff;

    const typeLabels  = { "pad-to-pad": "Pad-to-Pad", "one-pad": "One Pad", "site-to-site": "Site-to-Site" };
    const siteLabels  = { "transporter": "Transporter Room", "bridge": "Bridge", "engineering": "Main Engineering" };
    const typeLabel   = typeLabels[transportType];
    const siteLabel   = siteLabels[operationSite];

    // Resolve officer for NPC ships
    const stationOfficers = station ? getStationOfficers(actor, station.id) : [];
    const officer = stationOfficers.length > 0 ? readOfficerStats(stationOfficers[0]) : null;

    if (isNpc && isGM) {
      openNpcRoller(actor, token, {
        stationId:           station?.id ?? "operations",
        officer,
        difficulty:          totalDiff,
        ignoreBreachPenalty: true,
        noShipAssist:        false,  // Sensors + Science assists
        shipSystemKey:       "sensors",
        shipDeptKey:         "science",
        crewQuality:         !officer ? CombatHUD.getCrewQuality(actor) : null,
        taskLabel:           "Transporter",
        taskContext:         `Control + Engineering · Diff ${totalDiff} · ${typeLabel} · From ${siteLabel}`,
        taskCallback: ({ passed, successes, momentum }) => {
          const resultCard = passed
            ? lcarsCard("✨ TRANSPORT SUCCESS", LC.primary, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;
                  margin-bottom:5px;font-size:10px;font-family:${LC.font};">
                  <div><span style="color:${LC.textDim};">Type: </span>
                    <strong style="color:${LC.text};">${typeLabel}</strong></div>
                  <div><span style="color:${LC.textDim};">From: </span>
                    <strong style="color:${LC.text};">${siteLabel}</strong></div>
                  <div><span style="color:${LC.textDim};">Difficulty: </span>
                    <strong style="color:${LC.tertiary};">${totalDiff}</strong></div>
                  <div><span style="color:${LC.textDim};">Successes: </span>
                    <strong style="color:${LC.green};">${successes}</strong></div>
                </div>
                ${momentum > 0 ? `<div style="font-size:10px;color:${LC.green};font-family:${LC.font};">
                  +${momentum} Momentum generated</div>` : ""}
                <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
                  margin-top:4px;line-height:1.5;">
                  Transport complete. Spend Momentum for additional effects (extra personnel,
                  speed, precision targeting, etc.).
                </div>`)
            : lcarsCard("✨ TRANSPORT FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Transport failed — ${typeLabel} from ${siteLabel} (Difficulty ${totalDiff}).
                  Subjects remain at origin location.
                </div>`);
          ChatMessage.create({ content: resultCard, speaker: { alias: "STA2e Toolkit" } });
        },
      });
    } else {
      openPlayerRoller(actor, token, {
        stationId:           station?.id ?? "operations",
        officer,
        difficulty:          totalDiff,
        ignoreBreachPenalty: true,
        shipSystemKey:       "sensors",
        shipDeptKey:         "science",
        taskLabel:           "Transporter",
        taskContext:         `Control + Engineering · Diff ${totalDiff} · ${typeLabel} · From ${siteLabel}`,
        taskCallback: ({ passed, successes, momentum }) => {
          const resultCard = passed
            ? lcarsCard("✨ TRANSPORT SUCCESS", LC.primary, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;
                  margin-bottom:5px;font-size:10px;font-family:${LC.font};">
                  <div><span style="color:${LC.textDim};">Type: </span>
                    <strong style="color:${LC.text};">${typeLabel}</strong></div>
                  <div><span style="color:${LC.textDim};">From: </span>
                    <strong style="color:${LC.text};">${siteLabel}</strong></div>
                  <div><span style="color:${LC.textDim};">Difficulty: </span>
                    <strong style="color:${LC.tertiary};">${totalDiff}</strong></div>
                  <div><span style="color:${LC.textDim};">Successes: </span>
                    <strong style="color:${LC.green};">${successes}</strong></div>
                </div>
                ${momentum > 0 ? `<div style="font-size:10px;color:${LC.green};font-family:${LC.font};">
                  +${momentum} Momentum generated</div>` : ""}
                <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
                  margin-top:4px;line-height:1.5;">
                  Transport complete. Spend Momentum for additional effects (extra personnel,
                  speed, precision targeting, etc.).
                </div>`)
            : lcarsCard("✨ TRANSPORT FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Transport failed — ${typeLabel} from ${siteLabel} (Difficulty ${totalDiff}).
                  Subjects remain at origin location.
                </div>`);
          ChatMessage.create({ content: resultCard, speaker: { alias: "STA2e Toolkit" } });
        },
      });
    }
  }

  // ── Scan for Weakness ────────────────────────────────────────────────────

  async _handleScanForWeakness(actor, token, target) {
    if (!CombatHUD._requiresPlayerOfficer(actor, "sensors", "Sensors")) return;

    const isNpc = CombatHUD.isNpcShip(actor);
    const isGM  = game.user.isGM;

    const sensorsOfficers = getStationOfficers(actor, "sensors");
    const sensorsOfficer  = sensorsOfficers.length > 0 ? readOfficerStats(sensorsOfficers[0]) : null;

    const applyResult = async () => {
      const cardHtml = await applyScanForWeakness(token, target, token.name ?? actor.name);
      ChatMessage.create({ content: cardHtml });
      this._refresh();
    };

    if (isNpc && isGM) {
      openNpcRoller(actor, token, {
        stationId:           "sensors",
        officer:             sensorsOfficer,
        difficulty:          2,
        ignoreBreachPenalty: true,
        shipSystemKey:       "sensors",
        shipDeptKey:         "security",
        crewQuality:         !sensorsOfficer ? CombatHUD.getCrewQuality(actor) : null,
        taskLabel:           `Scan for Weakness — ${target.name}`,
        taskContext:         `Control + Science · Difficulty 2 · Sensors + Security assist · Target: ${target.name}`,
        taskCallback: async ({ passed }) => {
          if (!passed) {
            ChatMessage.create({
              content: lcarsCard("🔍 SCAN FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Could not identify vulnerabilities on ${target.name}.
                </div>`),
              speaker: { alias: "STA2e Toolkit" },
            });
            return;
          }
          await applyResult();
        },
      });
    } else {
      openPlayerRoller(actor, token, {
        stationId:           "sensors",
        officer:             sensorsOfficer,
        difficulty:          2,
        ignoreBreachPenalty: true,
        shipSystemKey:       "sensors",
        shipDeptKey:         "security",
        taskLabel:           `Scan for Weakness — ${target.name}`,
        taskContext:         `Control + Science · Difficulty 2 · Sensors + Security assist · Target: ${target.name}`,
        taskCallback: async ({ passed }) => {
          if (!passed) {
            ChatMessage.create({
              content: lcarsCard("🔍 SCAN FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Could not identify vulnerabilities on ${target.name}.
                </div>`),
              speaker: { alias: "STA2e Toolkit" },
            });
            return;
          }
          await applyResult();
        },
      });
    }
  }

  // ── Sensor Tasks (Sweep + Reveal) ─────────────────────────────────────────

  async _handleSensorTask(actor, token, taskKey) {
    if (!CombatHUD._requiresPlayerOfficer(actor, "sensors", "Sensors")) return;

    const isNpc = CombatHUD.isNpcShip(actor);
    const isGM  = game.user.isGM;
    const isSweep = taskKey === "sensor-sweep";

    const cfg = isSweep
      ? { label: "Sensor Sweep", icon: "📡", diff: 1, task: "Reason + Science (assisted by Sensors + Science)",
          effect: "GM provides basic information on ships, objects, or phenomena in selected zone. Spend Momentum for extra detail." }
      : { label: "Reveal",       icon: "👁️", diff: 3, task: "Reason + Science (assisted by Sensors + Science)",
          effect: "If a hidden vessel is within Long range, reveals which zone it occupies. Attackers may fire at it (Difficulty +2) until it moves." };

    const sensorsOfficers = getStationOfficers(actor, "sensors");
    const sensorsOfficer  = sensorsOfficers.length > 0 ? readOfficerStats(sensorsOfficers[0]) : null;

    if (isNpc && isGM) {
      openNpcRoller(actor, token, {
        stationId:           "sensors",
        officer:             sensorsOfficer,
        difficulty:          cfg.diff,
        ignoreBreachPenalty: true,
        crewQuality:         !sensorsOfficer ? CombatHUD.getCrewQuality(actor) : null,
        taskLabel:           cfg.label,
        taskContext:         `${cfg.task} · Difficulty ${cfg.diff}`,
        shipSystemKey:       "sensors",
        shipDeptKey:         "science",
        taskCallback: ({ passed, successes, momentum }) => {
          ChatMessage.create({
            content: lcarsCard(
              passed ? `${cfg.icon ? cfg.icon + " " : ""}${cfg.label.toUpperCase()} — SUCCESS` : `${cfg.icon ? cfg.icon + " " : ""}${cfg.label.toUpperCase()} FAILED`,
              passed ? LC.primary : LC.red,
              `<div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
              ${passed ? `
              <div style="font-size:11px;color:${LC.text};font-family:${LC.font};margin-bottom:4px;">
                ${successes} success${successes !== 1 ? "es" : ""}
                ${momentum > 0 ? `· <span style="color:${LC.green};">+${momentum} Momentum</span>` : ""}
              </div>
              <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};line-height:1.5;">
                ${cfg.effect}
              </div>` : `
              <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                Sensor task failed — no information gathered.
              </div>`}`),
            speaker: { alias: "STA2e Toolkit" },
          });
        },
      });
    } else {
      openPlayerRoller(actor, token, {
        stationId:           "sensors",
        officer:             sensorsOfficer,
        difficulty:          cfg.diff,
        ignoreBreachPenalty: true,
        taskLabel:           cfg.label,
        taskContext:         `${cfg.task} · Difficulty ${cfg.diff}`,
        shipSystemKey:       "sensors",
        shipDeptKey:         "science",
        taskCallback: ({ passed, successes, momentum }) => {
          ChatMessage.create({
            content: lcarsCard(
              passed ? `${cfg.icon ? cfg.icon + " " : ""}${cfg.label.toUpperCase()} — SUCCESS` : `${cfg.icon ? cfg.icon + " " : ""}${cfg.label.toUpperCase()} FAILED`,
              passed ? LC.primary : LC.red,
              `<div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
              ${passed ? `
              <div style="font-size:11px;color:${LC.text};font-family:${LC.font};margin-bottom:4px;">
                ${successes} success${successes !== 1 ? "es" : ""}
                ${momentum > 0 ? `· <span style="color:${LC.green};">+${momentum} Momentum</span>` : ""}
              </div>
              <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};line-height:1.5;">
                ${cfg.effect}
              </div>` : `
              <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                Sensor task failed — no information gathered.
              </div>`}`),
            speaker: { alias: "STA2e Toolkit" },
          });
        },
      });
    }
  }

  // ── Damage Control ───────────────────────────────────────────────────────

  async _handleDamageControl(actor, token, station = null) {
    if (!CombatHUD._requiresPlayerOfficer(actor, station?.id ?? "operations", station?.label ?? "Operations")) return;

    const isNpc   = CombatHUD.isNpcShip(actor);
    const isGM    = game.user.isGM;
    const scale   = actor.system?.scale ?? 1;
    const destThr = Math.ceil(scale / 2);

    // Collect all breached systems — only systems that have at least 1 breach
    const SYSTEMS = ["communications","computers","engines","sensors","structure","weapons"];
    const breached = SYSTEMS
      .map(key => {
        const total   = actor.system?.systems?.[key]?.breaches ?? 0;
        const patched = CombatHUD.getPatchedBreaches(actor)[key] ?? 0;
        const effective = Math.max(0, total - patched);
        return { key, total, patched, effective, label: CombatHUD.systemLabel(key) };
      })
      .filter(s => s.total > 0);

    if (!breached.length) {
      ui.notifications.info(`${actor.name} has no breached systems to patch.`);
      return;
    }

    // ── Step 1: Pick which system to patch ───────────────────────────────────
    let targetSystem = null;

    if (breached.length === 1) {
      targetSystem = breached[0];
    } else {
      let captured = null;
      const result = await foundry.applications.api.DialogV2.wait({
        window: { title: `Damage Control — ${actor.name}` },
        content: `
          <div style="font-family:${LC.font};padding:4px 0;">
            <div style="font-size:11px;color:${LC.text};margin-bottom:8px;">
              Select the breached system to patch:
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              ${breached.map(s => `
                <label style="display:flex;align-items:center;gap:8px;
                  padding:5px 8px;border:1px solid ${LC.borderDim};border-radius:2px;
                  cursor:pointer;background:${LC.panel};">
                  <input type="radio" name="patch-system" value="${s.key}"
                    style="accent-color:${LC.primary};"
                    ${breached.indexOf(s) === 0 ? "checked" : ""} />
                  <span style="font-size:11px;font-family:${LC.font};flex:1;">
                    <strong style="color:${s.total >= destThr ? LC.red : s.effective > 0 ? LC.yellow : LC.green};">
                      ${s.label}
                    </strong>
                    <span style="color:${LC.textDim};font-size:10px;">
                      — ${s.total} breach${s.total !== 1 ? "es" : ""}
                      ${s.patched > 0 ? `(${s.patched} patched)` : ""}
                      ${s.total >= destThr ? " ⛔ DESTROYED" : s.effective > 0 ? ` · +${s.effective} Difficulty` : " · patched"}
                    </span>
                  </span>
                </label>`).join("")}
            </div>
          </div>`,
        buttons: [
          {
            action:   "confirm",
            label:    "🔧 Select System",
            icon:     "fas fa-check",
            default:  true,
            callback: (event, btn, dlg) => {
              const el  = dlg.element ?? btn.closest(".app.dialog-v2");
              const sel = el?.querySelector("input[name='patch-system']:checked");
              captured  = sel?.value ?? breached[0].key;
            },
          },
          { action: "cancel", label: "Cancel", icon: "fas fa-times" },
        ],
      });

      if (result !== "confirm") return;
      targetSystem = breached.find(s => s.key === captured) ?? breached[0];
    }

    if (!targetSystem) return;

    // Ask how many breaches to attempt to patch — each beyond the first adds +1 Difficulty
    // (only prompt if more than 1 breach on the system)
    let patchCount = 1;
    if (targetSystem.total > 1) {
      let capturedCount = 1;
      const countResult = await foundry.applications.api.DialogV2.wait({
        window:  { title: `Damage Control — ${targetSystem.label}` },
        content: `
          <div style="font-family:${LC.font};padding:4px 0;">
            <div style="font-size:11px;color:${LC.text};margin-bottom:8px;">
              ${targetSystem.label} has <strong style="color:${LC.orange};">
              ${targetSystem.total}</strong> breach${targetSystem.total !== 1 ? "es" : ""}.
              How many to attempt to patch?
            </div>
            <div style="display:flex;align-items:center;gap:10px;">
              <label style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
                text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;">
                Breaches
              </label>
              <input id="patch-count" type="number" min="1"
                max="${targetSystem.total}" value="1"
                style="width:60px;padding:4px 8px;background:${LC.panel};
                  border:1px solid ${LC.border};border-radius:2px;
                  color:${LC.tertiary};font-size:16px;font-weight:700;
                  font-family:${LC.font};text-align:center;" />
              <span id="patch-diff-preview"
                style="font-size:11px;color:${LC.textDim};font-family:${LC.font};">
                = Difficulty 2
              </span>
            </div>
          </div>`,
        buttons: [
          {
            action:   "confirm",
            label:    "Confirm",
            icon:     "fas fa-check",
            default:  true,
            callback: (event, btn, dlg) => {
              const el = dlg.element ?? btn.closest(".app.dialog-v2");
              capturedCount = Math.max(1, Math.min(
                targetSystem.total,
                parseInt(el?.querySelector("#patch-count")?.value ?? "1") || 1
              ));
            },
          },
          { action: "cancel", label: "Cancel", icon: "fas fa-times" },
        ],
        render: (event, dlg) => {
          const el      = dlg.element;
          const input   = el?.querySelector("#patch-count");
          const preview = el?.querySelector("#patch-diff-preview");
          if (input && preview) {
            const update = () => {
              const n = Math.max(1, parseInt(input.value) || 1);
              preview.textContent = `= Difficulty ${1 + n}`;
              preview.style.color = n > 1 ? "var(--sta2e-tertiary,#ffcc66)" : "var(--sta2e-text-dim,#888)";
            };
            input.addEventListener("input", update);
            input.addEventListener("mousedown", e => e.stopPropagation());
          }
        },
      });
      if (countResult !== "confirm") return;
      patchCount = capturedCount;
    }

    // Difficulty = 2 base + 1 per additional breach being patched
    const baseDiff = 1 + patchCount;

    // Resolve officer for the station that triggered this task (defaults to "operations").
    // Using the actual station id ensures the assist-pending flag is matched correctly.
    const dcStationId  = station?.id ?? "operations";
    const dcOfficers   = getStationOfficers(actor, dcStationId);
    const opsOfficer   = dcOfficers.length > 0 ? readOfficerStats(dcOfficers[0]) : null;

    if (isNpc && isGM) {
      // ── NPC: open roller, then ask success/fail (same as PC path) ────────
      openNpcRoller(actor, token, {
        stationId:           dcStationId,
        officer:             opsOfficer,
        difficulty:          baseDiff,
        ignoreBreachPenalty: true,
        noShipAssist:        true,
        crewQuality:         !opsOfficer ? CombatHUD.getCrewQuality(actor) : null,
        taskLabel:           `Damage Control — ${targetSystem.label}`,
        taskContext:         `Presence + Engineering · Difficulty ${baseDiff} · Patch ${patchCount} breach${patchCount !== 1 ? "es" : ""} on ${targetSystem.label}`,
        taskCallback: ({ passed }) => {
          const patchPayload = encodeURIComponent(JSON.stringify({
            actorId: actor.id, tokenId: token?.id ?? null,
            systemKey: targetSystem.key, systemLabel: targetSystem.label,
            actorName: actor.name, patchCount,
          }));
          if (passed) {
            ChatMessage.create({
              flags: { "sta2e-toolkit": { dcResultCard: true } },
              content: lcarsCard("🔧 DAMAGE CONTROL — SUCCESS", LC.green, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:13px;font-weight:700;color:${LC.green};
                  margin-bottom:6px;font-family:${LC.font};">
                  ${targetSystem.label} — breach can be patched
                </div>
                <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
                  line-height:1.5;margin-bottom:8px;">
                  Patching removes Difficulty penalties but does NOT remove the breach.
                  A new breach on this system will undo the patch.
                </div>
                <button class="sta2e-apply-patch"
                  data-payload="${patchPayload}"
                  style="width:100%;padding:5px;background:rgba(0,200,100,0.12);
                    border:1px solid ${LC.green};border-radius:2px;
                    color:${LC.green};font-size:10px;font-weight:700;
                    letter-spacing:0.08em;text-transform:uppercase;
                    cursor:pointer;font-family:${LC.font};">
                  🔧 APPLY PATCH → ${targetSystem.label}
                </button>`),
              speaker: { alias: "STA2e Toolkit" },
            });
          } else {
            ChatMessage.create({
              content: lcarsCard("🔧 DAMAGE CONTROL FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  ${targetSystem.label} breach could not be patched.
                </div>`),
              speaker: { alias: "STA2e Toolkit" },
            });
          }
        },
      });

    } else {
      openPlayerRoller(actor, token, {
        stationId:           dcStationId,
        officer:             opsOfficer,
        difficulty:          baseDiff,
        ignoreBreachPenalty: true,
        noShipAssist:        true,
        taskLabel:           `Damage Control — ${targetSystem.label}`,
        taskContext:         `Presence + Engineering · Difficulty ${baseDiff} · Patch ${patchCount} breach${patchCount !== 1 ? "es" : ""} on ${targetSystem.label}`,
        taskCallback: ({ passed }) => {
          const patchPayload = encodeURIComponent(JSON.stringify({
            actorId: actor.id, tokenId: token?.id ?? null,
            systemKey: targetSystem.key, systemLabel: targetSystem.label,
            actorName: actor.name, patchCount,
          }));
          if (passed) {
            ChatMessage.create({
              flags: { "sta2e-toolkit": { dcResultCard: true } },
              content: lcarsCard("🔧 DAMAGE CONTROL — SUCCESS", LC.green, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:13px;font-weight:700;color:${LC.green};
                  margin-bottom:6px;font-family:${LC.font};">
                  ${targetSystem.label} — breach can be patched
                </div>
                <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
                  line-height:1.5;margin-bottom:8px;">
                  Patching removes Difficulty penalties but does NOT remove the breach.
                  A new breach on this system will undo the patch.
                </div>
                <button class="sta2e-apply-patch"
                  data-payload="${patchPayload}"
                  style="width:100%;padding:5px;background:rgba(0,200,100,0.12);
                    border:1px solid ${LC.green};border-radius:2px;
                    color:${LC.green};font-size:10px;font-weight:700;
                    letter-spacing:0.08em;text-transform:uppercase;
                    cursor:pointer;font-family:${LC.font};">
                  🔧 APPLY PATCH → ${targetSystem.label}
                </button>`),
              speaker: { alias: "STA2e Toolkit" },
            });
          } else {
            ChatMessage.create({
              content: lcarsCard("🔧 DAMAGE CONTROL FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  ${targetSystem.label} breach could not be patched.
                </div>`),
              speaker: { alias: "STA2e Toolkit" },
            });
          }
        },
      });
    }
  }

  // ── Rally ────────────────────────────────────────────────────────────────

  async _handleRally(actor, token) {
    if (!CombatHUD._requiresPlayerOfficer(actor, "command", "Command")) return;

    const isNpc = CombatHUD.isNpcShip(actor);
    const isGM  = game.user.isGM;

    // Resolve Command station officer for NPC ships
    const commandOfficers = getStationOfficers(actor, "command");
    const commandOfficer  = commandOfficers.length > 0
      ? readOfficerStats(commandOfficers[0]) : null;

    if (isNpc && isGM) {
      // ── NPC: open roller pre-set to Difficulty 0, Presence+Command ───────
      // rallyContext=true disables ship assist and auto-posts the Threat
      // result card when the GM clicks "Post Rally Result"
      openNpcRoller(actor, token, {
        stationId:          "command",
        officer:            commandOfficer,
        opposedDifficulty:  0,
        opposedDefenseType: null,
        defenderSuccesses:  null,
        rallyContext:        true,
        ignoreBreachPenalty: true,
        crewQuality:         !commandOfficer ? CombatHUD.getCrewQuality(actor) : null,
        taskLabel:           "Rally",
        taskContext:        "Presence + Command · Difficulty 0 · Each success = 1 Threat",
      });

    } else {
      openPlayerRoller(actor, token, {
        stationId:           "command",
        officer:             commandOfficer,
        opposedDifficulty:   0,
        opposedDefenseType:  null,
        defenderSuccesses:   null,
        rallyContext:        true,
        ignoreBreachPenalty: true,
        taskLabel:           "Rally",
        taskContext:         "Presence + Command · Difficulty 0 · Each success = 1 Momentum",
      });
    }
  }

  // ── Assist (standard — 1 target station) ────────────────────────────────

  async _handleAssist(actor, token, station) {
    // Resolve who is at the acting station
    const officers     = getStationOfficers(actor, station?.id ?? "");
    const actorName    = officers[0]?.name ?? actor.name;
    const stationLabel = station?.label ?? "Bridge";

    // Build target list — excluding the acting station itself.
    // For NPC ships, all stations are valid (crew quality is used when no officer is assigned).
    // For PC ships, only stations with an assigned officer are shown.
    const isNpc = CombatHUD.isNpcShip(actor);
    const allOtherSlots = STATION_SLOTS.filter(s => s.id !== station?.id);
    const options = allOtherSlots.map(s => {
      const slotOfficers = getStationOfficers(actor, s.id);
      const assignedName = slotOfficers[0]?.name ?? (isNpc ? "NPC Crew" : null);
      return { ...s, assignedName };
    }).filter(s => s.assignedName !== null);

    if (options.length === 0) {
      ui.notifications.warn("No other stations have assigned characters to assist.");
      return;
    }

    let targetId = null;
    const result = await foundry.applications.api.DialogV2.wait({
      window:  { title: `Assist — ${actorName}` },
      content: `
        <div style="font-family:${LC.font};padding:4px 0;display:flex;flex-direction:column;gap:6px;">
          <div style="font-size:10px;color:${LC.textDim};line-height:1.5;margin-bottom:4px;">
            ${actorName} is committing their major action to assist another station's next major task.
            Choose which station to assist.
          </div>
          ${options.map(s => `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
              padding:5px 8px;border-radius:2px;
              border:1px solid ${LC.borderDim};background:${LC.panel};">
              <input type="radio" name="assist-target" value="${s.id}"
                style="accent-color:${LC.primary};" />
              <span style="font-size:12px;">${s.icon}</span>
              <div style="display:flex;flex-direction:column;">
                <span style="font-size:11px;font-weight:700;color:${LC.text};
                  font-family:${LC.font};">${s.label}</span>
                <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">
                  ${s.assignedName}
                </span>
              </div>
            </label>`).join("")}
        </div>`,
      buttons: [
        {
          action: "confirm", label: "📢 Declare Assist", icon: "fas fa-check", default: true,
          callback: (event, btn, dlg) => {
            const el = dlg.element ?? btn.closest(".app.dialog-v2");
            targetId = el?.querySelector("input[name='assist-target']:checked")?.value ?? null;
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });
    if (result !== "confirm" || !targetId) return;

    // Store an assist-pending flag on the ship token so the NPC roller auto-checks
    // the crew-assist die when the target station's next task is rolled.
    // Also store the actor ID so the roller can load the assister's attr/disc stats.
    if (game.user.isGM) {
      try {
        const existing = token.document.getFlag("sta2e-toolkit", "assistPending") ?? {};
        await token.document.setFlag("sta2e-toolkit", "assistPending",
          { ...existing, [targetId]: { name: actorName, actorId: officers[0]?.id ?? null } });
      } catch(e) { console.warn("STA2e Toolkit | Could not set assist flag:", e); }
    }

    const targetStation = STATION_SLOTS.find(s => s.id === targetId);

    ChatMessage.create({
      content: lcarsCard("🤝 ASSIST", LC.primary, `
        <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
          margin-bottom:6px;font-family:${LC.font};">
          ${actorName} — ${stationLabel}
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;gap:8px;align-items:baseline;">
            <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;min-width:80px;">Assisting</span>
            <span style="font-size:13px;font-weight:700;color:${LC.tertiary};
              font-family:${LC.font};">${targetStation?.icon ?? "⭐"} ${targetStation?.label ?? targetId}</span>
          </div>
          <div style="margin-top:3px;padding:5px 7px;
            background:rgba(255,153,0,0.06);border-left:2px solid ${LC.primary};
            border-radius:2px;font-size:10px;color:${LC.textDim};font-family:${LC.font};
            line-height:1.5;">
            ${actorName} will assist in the ${targetStation?.label ?? targetId} station's next major task.
            This uses ${actorName}'s major action for this round.
          </div>
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
  }

  // ── Assist (Command — up to 2 target stations + officer pick) ────────────

  async _handleAssistCommand(actor, token, station) {
    const commandOfficers = getStationOfficers(actor, "command");
    const hasTwo = commandOfficers.length >= 2;

    // Build target list — all stations except command itself.
    // For NPC ships, stations without an assigned officer show "NPC Crew" as the fallback.
    // For PC ships, only stations with an assigned officer are shown.
    const isNpc = CombatHUD.isNpcShip(actor);
    const options = STATION_SLOTS
      .filter(s => s.id !== "command")
      .map(s => {
        const slotOfficers = getStationOfficers(actor, s.id);
        const assignedName = slotOfficers[0]?.name ?? (isNpc ? "NPC Crew" : null);
        return { ...s, assignedName };
      })
      .filter(s => s.assignedName !== null);

    if (options.length === 0) {
      ui.notifications.warn("No other stations have assigned characters to assist.");
      return;
    }

    let chosenOfficerIdx = 0;
    let targetId1 = null;
    let targetId2 = null;

    const officerSection = hasTwo ? `
      <div style="margin-bottom:8px;">
        <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
          text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">
          Acting Officer
        </div>
        ${commandOfficers.map((o, i) => `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
            padding:5px 8px;border-radius:2px;margin-bottom:2px;
            border:1px solid ${LC.borderDim};background:${LC.panel};">
            <input type="radio" name="cmd-officer" value="${i}"
              ${i === 0 ? "checked" : ""}
              style="accent-color:${LC.primary};" />
            <span style="font-size:11px;font-weight:700;color:${LC.text};
              font-family:${LC.font};">⭐ ${o.name}</span>
          </label>`).join("")}
      </div>` : "";

    const stationRadios = (name, includeNone = false) => `
      ${includeNone ? `
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
          padding:5px 8px;border-radius:2px;margin-bottom:2px;
          border:1px solid ${LC.borderDim};background:${LC.panel};">
          <input type="radio" name="${name}" value="none" checked
            style="accent-color:${LC.primary};" />
          <span style="font-size:11px;color:${LC.textDim};font-family:${LC.font};">— None —</span>
        </label>` : ""}
      ${options.map(s => `
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
          padding:5px 8px;border-radius:2px;margin-bottom:2px;
          border:1px solid ${LC.borderDim};background:${LC.panel};">
          <input type="radio" name="${name}" value="${s.id}"
            ${(!includeNone && s.id === options[0]?.id) ? "checked" : ""}
            style="accent-color:${LC.primary};" />
          <span style="font-size:12px;">${s.icon}</span>
          <div style="display:flex;flex-direction:column;">
            <span style="font-size:11px;font-weight:700;color:${LC.text};
              font-family:${LC.font};">${s.label}</span>
            <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">
              ${s.assignedName}
            </span>
          </div>
        </label>`).join("")}`;

    const result = await foundry.applications.api.DialogV2.wait({
      window:  { title: `Command Assist — ${actor.name}` },
      content: `
        <div style="font-family:${LC.font};padding:4px 0;display:flex;flex-direction:column;gap:4px;">
          <div style="font-size:10px;color:${LC.textDim};line-height:1.5;margin-bottom:4px;">
            Command officers may commit their major action to assist in the next major task
            of <strong style="color:${LC.text};">two</strong> stations at once.
            Choose the primary and (optionally) secondary target.
          </div>
          ${officerSection}
          <div>
            <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">
              Primary Target
            </div>
            ${stationRadios("assist-target-1", false)}
          </div>
          <div style="margin-top:6px;">
            <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">
              Secondary Target (optional)
            </div>
            ${stationRadios("assist-target-2", true)}
          </div>
        </div>`,
      buttons: [
        {
          action: "confirm", label: "📢 Declare Assist", icon: "fas fa-check", default: true,
          callback: (event, btn, dlg) => {
            const el = dlg.element ?? btn.closest(".app.dialog-v2");
            if (hasTwo) {
              chosenOfficerIdx = parseInt(el?.querySelector("input[name='cmd-officer']:checked")?.value ?? "0") || 0;
            }
            targetId1 = el?.querySelector("input[name='assist-target-1']:checked")?.value ?? null;
            const raw2 = el?.querySelector("input[name='assist-target-2']:checked")?.value ?? "none";
            targetId2 = raw2 === "none" ? null : raw2;
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });
    if (result !== "confirm" || !targetId1) return;

    const chosenOfficer = commandOfficers[chosenOfficerIdx] ?? commandOfficers[0];
    const officerName   = chosenOfficer?.name ?? actor.name;
    const tgt1 = STATION_SLOTS.find(s => s.id === targetId1);
    const tgt2 = targetId2 ? STATION_SLOTS.find(s => s.id === targetId2) : null;

    // Store assist-pending flags for each target station so the NPC roller
    // auto-checks the crew-assist die when those stations next roll a task.
    // Also store the actor ID so the roller can load the assister's attr/disc stats.
    if (game.user.isGM) {
      try {
        const existing       = token.document.getFlag("sta2e-toolkit", "assistPending") ?? {};
        const officerActorId = chosenOfficer?.id ?? null;
        const newAssist      = { name: officerName, actorId: officerActorId };
        // Push onto a per-station array so multiple assists can stack
        // (e.g. Helm declaring Attack Pattern assist for Tactical).
        for (const targetId of [targetId1, targetId2].filter(Boolean)) {
          const raw = existing[targetId];
          const arr = !raw ? []
            : Array.isArray(raw) ? raw
            : typeof raw === "string" ? [{ name: raw, actorId: null }]
            : [raw]; // legacy single-object
          // Guard: same actor can only assist a station once
          if (!arr.some(a => a.actorId === officerActorId && a.name === officerName)) {
            arr.push(newAssist);
          }
          existing[targetId] = arr;
        }
        await token.document.setFlag("sta2e-toolkit", "assistPending", existing);
      } catch(e) { console.warn("STA2e Toolkit | Could not set assist flags:", e); }
    }

    const assistingLine = tgt2
      ? `${tgt1?.icon ?? "⭐"} ${tgt1?.label ?? targetId1}  &nbsp;&amp;&nbsp;  ${tgt2?.icon ?? "⭐"} ${tgt2?.label ?? targetId2}`
      : `${tgt1?.icon ?? "⭐"} ${tgt1?.label ?? targetId1}`;

    const flavorLine = tgt2
      ? `${officerName} will assist in the next major task at both the ${tgt1?.label} and ${tgt2?.label} stations.`
      : `${officerName} will assist in the ${tgt1?.label} station's next major task.`;

    ChatMessage.create({
      content: lcarsCard("🤝 COMMAND ASSIST", LC.primary, `
        <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
          margin-bottom:6px;font-family:${LC.font};">
          ${officerName} — Command
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;gap:8px;align-items:baseline;">
            <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;min-width:80px;">Assisting</span>
            <span style="font-size:13px;font-weight:700;color:${LC.tertiary};
              font-family:${LC.font};">${assistingLine}</span>
          </div>
          <div style="margin-top:3px;padding:5px 7px;
            background:rgba(255,153,0,0.06);border-left:2px solid ${LC.primary};
            border-radius:2px;font-size:10px;color:${LC.textDim};font-family:${LC.font};
            line-height:1.5;">
            ${flavorLine}
            This uses ${officerName}'s major action for this round.
          </div>
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
  }

  // ── Direct (Command — single target, Control + Command assist die) ──────────

  async _handleDirect(actor, token, station) {
    const commandOfficers = getStationOfficers(actor, "command");
    const hasTwo = commandOfficers.length >= 2;

    const isNpc = CombatHUD.isNpcShip(actor);
    const options = STATION_SLOTS
      .filter(s => s.id !== "command")
      .map(s => {
        const slotOfficers = getStationOfficers(actor, s.id);
        const assignedName = slotOfficers[0]?.name ?? (isNpc ? "NPC Crew" : null);
        return { ...s, assignedName };
      })
      .filter(s => s.assignedName !== null);

    if (options.length === 0) {
      ui.notifications.warn("No other stations have assigned characters to direct.");
      return;
    }

    let chosenOfficerIdx = 0;
    let targetId = null;

    const officerSection = hasTwo ? `
      <div style="margin-bottom:8px;">
        <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
          text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">
          Acting Officer
        </div>
        ${commandOfficers.map((o, i) => `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
            padding:5px 8px;border-radius:2px;margin-bottom:2px;
            border:1px solid ${LC.borderDim};background:${LC.panel};">
            <input type="radio" name="cmd-officer" value="${i}"
              ${i === 0 ? "checked" : ""}
              style="accent-color:${LC.primary};" />
            <span style="font-size:11px;font-weight:700;color:${LC.text};
              font-family:${LC.font};">⭐ ${o.name}</span>
          </label>`).join("")}
      </div>` : "";

    const result = await foundry.applications.api.DialogV2.wait({
      window:  { title: `Direct — ${actor.name}` },
      content: `
        <div style="font-family:${LC.font};padding:4px 0;display:flex;flex-direction:column;gap:4px;">
          <div style="font-size:10px;color:${LC.textDim};line-height:1.5;margin-bottom:4px;">
            The commanding officer commits their major action to
            <strong style="color:${LC.text};">Direct</strong> another crew member.
            They roll <strong style="color:${LC.tertiary};">Control + Command</strong> as an
            assist die when the target station next takes a major task.
          </div>
          ${officerSection}
          <div>
            <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">
              Target Station
            </div>
            ${options.map(s => `
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                padding:5px 8px;border-radius:2px;margin-bottom:2px;
                border:1px solid ${LC.borderDim};background:${LC.panel};">
                <input type="radio" name="direct-target" value="${s.id}"
                  ${s.id === options[0]?.id ? "checked" : ""}
                  style="accent-color:${LC.primary};" />
                <span style="font-size:12px;">${s.icon}</span>
                <div style="display:flex;flex-direction:column;">
                  <span style="font-size:11px;font-weight:700;color:${LC.text};
                    font-family:${LC.font};">${s.label}</span>
                  <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">
                    ${s.assignedName}
                  </span>
                </div>
              </label>`).join("")}
          </div>
        </div>`,
      buttons: [
        {
          action:   "confirm",
          label:    "🎖️ Declare Direct",
          icon:     "fas fa-check",
          default:  true,
          callback: (event, btn, dlg) => {
            const el = dlg.element ?? btn.closest(".app.dialog-v2");
            if (hasTwo) {
              chosenOfficerIdx = parseInt(el?.querySelector("input[name='cmd-officer']:checked")?.value ?? "0") || 0;
            }
            targetId = el?.querySelector("input[name='direct-target']:checked")?.value ?? null;
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });
    if (result !== "confirm" || !targetId) return;

    const chosenOfficer = commandOfficers[chosenOfficerIdx] ?? commandOfficers[0];
    const officerName   = chosenOfficer?.name ?? actor.name;
    const tgt           = STATION_SLOTS.find(s => s.id === targetId);

    // ── Step 2: Task picker — which task should the directed officer perform? ──
    const stationDef    = BRIDGE_STATIONS.find(s => s.id === targetId);
    const actionEntries = (stationDef?.major ?? []).filter(a =>
      a.key !== null && !a.isInfo &&
      !["assist", "assist-command", "direct", "task-roll"].includes(a.key)
    );
    // Prepend per-weapon entries when targeting Tactical
    const weaponEntries = targetId === "tactical"
      ? actor.items
          .filter(i => i.type === "starshipweapon2e")
          .map(weapon => {
            const isTorpedo = getWeaponConfig(weapon)?.type === "torpedo";
            return {
              key:      "fire-weapon",
              weaponId: weapon.id,
              label:    `Fire — ${weapon.name}`,
              tooltip:  `Fire ${weapon.name}${isTorpedo ? " (Torpedo)" : ""}. Control + Security, Weapons + Security.`,
              isTorpedo,
            };
          })
      : [];
    const directable = [...weaponEntries, ...actionEntries];

    let directTaskKey   = directable[0]?.key      ?? null;
    let directTaskLabel = directable[0]?.label    ?? null;
    let directTaskIcon  = directable[0]?.icon     ?? "🎲";
    let directWeaponId  = directable[0]?.weaponId ?? null;

    if (directable.length > 1) {
      const taskResultIdx = await foundry.applications.api.DialogV2.wait({
        window: { title: `${tgt?.icon ?? ""} ${tgt?.label ?? targetId} — Choose Task` },
        content: `
          <div style="font-family:${LC.font};padding:4px 0;">
            <div style="font-size:10px;color:${LC.textDim};line-height:1.5;margin-bottom:8px;">
              <strong style="color:${LC.text};">${officerName}</strong> is directing
              <strong style="color:${LC.text};">${tgt?.icon ?? ""} ${tgt?.label ?? targetId}</strong>.
              What task should they perform?
            </div>
            ${directable.map((a, i) => `
              <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;
                padding:6px 8px;border-radius:2px;margin-bottom:3px;
                border:1px solid ${LC.borderDim};background:${LC.panel};">
                <input type="radio" name="direct-task" value="${i}"
                  ${i === 0 ? "checked" : ""}
                  style="accent-color:${LC.primary};margin-top:3px;" />
                <div>
                  <div style="font-size:11px;font-weight:700;color:${LC.text};font-family:${LC.font};">
                    ${a.icon ? a.icon + " " : ""}${a.label}
                  </div>
                  <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
                    line-height:1.4;margin-top:2px;">
                    ${a.tooltip.length > 90 ? a.tooltip.substring(0, 90) + "…" : a.tooltip}
                  </div>
                </div>
              </label>`).join("")}
          </div>`,
        buttons: [
          {
            action:   "confirm",
            label:    "🎖️ Confirm Task",
            icon:     "fas fa-check",
            default:  true,
            callback: (_event, _btn2, dlg) => {
              const val = dlg.element?.querySelector("input[name='direct-task']:checked")?.value;
              return val !== undefined ? parseInt(val) : 0;
            },
          },
          { action: "cancel", label: "Cancel", icon: "fas fa-times" },
        ],
      });
      if (taskResultIdx === "cancel" || taskResultIdx == null) return;
      const chosen    = directable[taskResultIdx] ?? directable[0];
      directTaskKey   = chosen?.key      ?? directTaskKey;
      directTaskLabel = chosen?.label    ?? directTaskLabel;
      directTaskIcon  = chosen?.icon     ?? directTaskIcon;
      directWeaponId  = chosen?.weaponId ?? null;
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (game.user.isGM) {
      try {
        const existing       = token.document.getFlag("sta2e-toolkit", "assistPending") ?? {};
        const officerActorId = chosenOfficer?.id ?? null;
        const newAssist      = { name: officerName, actorId: officerActorId, type: "direct" };
        const raw            = existing[targetId];
        const arr            = !raw ? []
          : Array.isArray(raw) ? raw
          : typeof raw === "string" ? [{ name: raw, actorId: null }]
          : [raw];
        // Guard: same actor can only declare Direct for a station once
        if (!arr.some(a => a.actorId === officerActorId && a.type === "direct")) {
          arr.push(newAssist);
        }
        existing[targetId] = arr;
        await token.document.setFlag("sta2e-toolkit", "assistPending", existing);
      } catch(e) { console.warn("STA2e Toolkit | Could not set direct flag:", e); }
    }

    // Player ship: "Open Task Roller" button — the directed officer clicks to open their roller.
    // The commander's Direct entry is already stored in assistPending so it shows as a named
    // assist (Control + Command die) when the roller opens.
    const _directBtnHtml = !isNpc ? (() => {
      const _p = encodeURIComponent(JSON.stringify({
        shipActorId:   actor.id,
        shipTokenId:   token?.id ?? null,
        shipSceneId:   token?.scene?.id ?? null,
        stationId:     targetId,
        stationLabel:  tgt?.label ?? targetId,
        commanderName: officerName,
        taskKey:       directTaskKey   ?? null,
        taskLabel:     directTaskLabel ?? null,
        weaponId:      directWeaponId  ?? null,
      }));
      return `<div style="margin-top:8px;">
        <button class="sta2e-open-task-roller" data-payload="${_p}"
          style="width:100%;padding:6px 10px;
            background:rgba(255,153,0,0.12);border:1px solid ${LC.primary};
            border-radius:2px;cursor:pointer;font-family:${LC.font};
            font-size:11px;font-weight:700;color:${LC.primary};letter-spacing:0.04em;">
          🎲 Open Task Roller — ${directTaskIcon} ${directTaskLabel ?? (tgt?.label ?? targetId)}
        </button>
      </div>`;
    })() : "";

    ChatMessage.create({
      content: lcarsCard("🎖️ DIRECT", LC.primary, `
        <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
          margin-bottom:6px;font-family:${LC.font};">
          ${officerName} — Command
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;gap:8px;align-items:baseline;">
            <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;min-width:80px;">Directing</span>
            <span style="font-size:13px;font-weight:700;color:${LC.tertiary};
              font-family:${LC.font};">${tgt?.icon ?? ""} ${tgt?.label ?? targetId}</span>
          </div>
          ${directTaskLabel ? `
          <div style="display:flex;gap:8px;align-items:baseline;">
            <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;min-width:80px;">Task</span>
            <span style="font-size:13px;font-weight:700;color:${LC.primary};
              font-family:${LC.font};">${directTaskIcon} ${directTaskLabel}</span>
          </div>` : ""}
          <div style="margin-top:3px;padding:5px 7px;
            background:rgba(255,153,0,0.06);border-left:2px solid ${LC.primary};
            border-radius:2px;font-size:10px;color:${LC.textDim};font-family:${LC.font};
            line-height:1.5;">
            ${officerName} will roll <strong>Control + Command</strong> as an assist die when
            ${tgt?.label ?? targetId} performs
            <strong>${directTaskLabel ?? "their next major task"}</strong>.
            This uses ${officerName}'s major action for this round.
          </div>
          ${_directBtnHtml}
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
  }

  // ── Task Roll (all stations — NPC ships only) ─────────────────────────────
  //
  // Opens the NPC Task Roller for the current station.
  // If one or more actors are assigned to the station via the Crew Manifest:
  //   • Single actor  → resolved directly as the rolling officer.
  //   • Multiple actors (e.g. Command with Captain + XO) → picker dialog first.
  // If no actor is assigned the roller opens in generic NPC crew quality mode.

  async _handleTaskRoll(actor, token, station) {
    if (!CombatHUD._requiresPlayerOfficer(actor, station.id, station.label)) return;

    const hasTS  = CombatHUD.hasTargetingSolution(token);
    const hasRFT = hasRapidFireTorpedoLauncher(actor);
    const isNpc  = CombatHUD.isNpcShip(actor);

    const stationOfficers = getStationOfficers(actor, station.id);
    let resolvedOfficer = null;

    if (stationOfficers.length === 1) {
      resolvedOfficer = readOfficerStats(stationOfficers[0]);
    } else if (stationOfficers.length > 1) {
      // Multiple actors at this station — ask which is acting this turn
      const choice = await foundry.applications.api.DialogV2.wait({
        window:  { title: `${station.label} — Who is acting?` },
        content: `<div style="font-family:${LC.font};padding:4px 0;font-size:11px;color:${LC.text};">
          Select the officer acting at ${station.label} this turn:</div>`,
        buttons: stationOfficers.map((o, i) => ({
          action:  String(i),
          label:   o.name,
          default: i === 0,
        })),
      });
      const idx = parseInt(choice);
      if (!isNaN(idx) && stationOfficers[idx]) {
        resolvedOfficer = readOfficerStats(stationOfficers[idx]);
      }
    }

    const commonOptions = {
      hasTargetingSolution: hasTS,
      hasRapidFireTorpedo:  hasRFT,
      stationId:            station.id,
      officer:              resolvedOfficer,
      taskLabel:            `${station.label} Task`,
      taskContext:          resolvedOfficer ? `Officer: ${resolvedOfficer.name}` : null,
    };

    if (isNpc) {
      openNpcRoller(actor, token, {
        ...commonOptions,
        crewQuality: !resolvedOfficer ? CombatHUD.getCrewQuality(actor) : null,
      });
    } else {
      openPlayerRoller(actor, token, commonOptions);
    }
  }

  // ── Override ──────────────────────────────────────────────────────────────

  async _handleOverride(actor, token, station) {
    if (!CombatHUD._requiresPlayerOfficer(actor, station.id, station.label)) return;
    const isNpc = CombatHUD.isNpcShip(actor);

    // Base difficulties per overridable task key (+1 will be added for override penalty)
    const TASK_BASE_DIFF = {
      "attack-pattern":    0,
      "maneuver":          0,
      "ram":               2,
      "warp":              1,
      "evasive-action":    null,   // opposed task — no fixed difficulty
      "damage-control":    2,
      "regain-power":      1,
      "regen-shields":     2,
      "reroute-power":     null,   // no task roll (resource reroute)
      "transport":         2,
      "reveal":            3,
      "scan-for-weakness": 2,
      "sensor-sweep":      1,
      "fire-weapons":      2,
      "defensive-fire":    null,   // opposed setup action
      "modulate-shields":  null,   // no task roll
      "tractor-beam":      2,
    };

    // ── Step 1: Pick the target station ──────────────────────────────────────
    const candidateStations = BRIDGE_STATIONS.filter(s =>
      s.id !== "command" && s.id !== station.id
    );

    const stationPick = await foundry.applications.api.DialogV2.wait({
      window:  { title: "⚙️ Override — Select Station" },
      content: `
        <div style="font-family:${LC.font};padding:4px 0;">
          <div style="font-size:11px;color:${LC.text};margin-bottom:6px;">
            <strong style="color:${LC.primary};">${actor.name}</strong>
            overrides the controls of another station.<br>
            <span style="color:${LC.yellow};font-size:10px;">All tasks from the chosen station
            gain <strong>+1 Difficulty</strong>.</span>
          </div>
          <div style="font-size:10px;color:${LC.textDim};">Select the station to override
          (Commanding Officer position is excluded):</div>
        </div>`,
      buttons: [
        ...candidateStations.map(s => ({
          action:  s.id,
          label:   `${s.icon} ${s.label}`,
          default: false,
        })),
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });
    if (!stationPick || stationPick === "cancel") return;

    const targetStation = candidateStations.find(s => s.id === stationPick);
    if (!targetStation) return;

    // ── Step 2: Pick the task ──────────────────────────────────────────────
    // Filter to major actions that are real tasks (not meta-actions or info entries)
    const META = new Set(["assist", "assist-command", "task-roll", "pass", "ready", "override"]);
    const overridableTasks = targetStation.major
      .filter(a => a.key && !a.isInfo && !META.has(a.key))
      .map(a => ({ ...a }));

    // Tactical: add a concrete "Fire Weapons" entry (the Fire action is info-only in the tab)
    if (targetStation.id === "tactical") {
      overridableTasks.unshift({ key: "fire-weapons", label: "Fire Weapons", icon: "🔫" });
    }

    if (overridableTasks.length === 0) {
      ui.notifications.warn(`No overridable tasks at ${targetStation.label}.`);
      return;
    }

    const makeLabel = t => {
      const base = TASK_BASE_DIFF[t.key];
      const suffix = base !== null && base !== undefined
        ? ` (Diff ${base}+1=${base + 1})`
        : "";
      return `${t.icon ?? "🎲"} ${t.label}${suffix}`;
    };

    const taskPick = await foundry.applications.api.DialogV2.wait({
      window:  { title: `⚙️ Override — ${targetStation.icon} ${targetStation.label}` },
      content: `
        <div style="font-family:${LC.font};padding:4px 0;">
          <div style="font-size:11px;color:${LC.text};margin-bottom:4px;">
            Override controls at <strong style="color:${LC.primary};">${targetStation.label}</strong>
            — choose the task to attempt.
          </div>
          <div style="font-size:10px;color:${LC.yellow};">+1 Difficulty applies to all overrides.</div>
        </div>`,
      buttons: [
        ...overridableTasks.map(t => ({
          action:  t.key,
          label:   makeLabel(t),
          default: false,
        })),
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });
    if (!taskPick || taskPick === "cancel") return;

    const chosenTask = overridableTasks.find(t => t.key === taskPick);
    if (!chosenTask) return;

    // Resolve the overriding officer (uses the CURRENT station's assigned officer)
    const stationOfficers = getStationOfficers(actor, station.id);
    const resolvedOfficer = stationOfficers.length > 0
      ? readOfficerStats(stationOfficers[0]) : null;

    const overrideContext = `Override from ${station.label} · +1 Difficulty penalty`;

    // ── Step 3: Fire Weapons override ─────────────────────────────────────
    if (taskPick === "fire-weapons") {
      const weapons = actor.items.filter(i => i.type === "starshipweapon2e");
      if (weapons.length === 0) {
        ui.notifications.warn("No ship weapons found.");
        return;
      }

      // Weapon picker
      const weaponPick = await foundry.applications.api.DialogV2.wait({
        window:  { title: "⚙️ Override — Select Weapon" },
        content: `<div style="font-family:${LC.font};padding:4px 0;font-size:11px;color:${LC.text};">
          Select the weapon to fire (Difficulty ${2 + 1} — base 2 +1 Override):</div>`,
        buttons: [
          ...weapons.map(w => ({
            action:  w.id,
            label:   w.name,
            default: false,
          })),
          { action: "cancel", label: "Cancel", icon: "fas fa-times" },
        ],
      });
      if (!weaponPick || weaponPick === "cancel") return;

      const weapon    = weapons.find(w => w.id === weaponPick);
      if (!weapon) return;
      const isTorpedo = weapon.system?.type === "torpedo"
        || weapon.name?.toLowerCase().includes("torpedo")
        || !!(weapon.system?.qualities?.spread);
      const dmgParts = [];
      if (weapon.system?.damage)   dmgParts.push(`${weapon.system.damage}⚡`);
      if (weapon.system?.severity) dmgParts.push(`Sev ${weapon.system.severity}`);
      const weaponCtx = {
        name:      weapon.name,
        isTorpedo,
        damage:    dmgParts.join(" "),
        qualities: this._weaponQualityString(weapon),
      };

      // Check for opposed defense (evasive action / defensive fire)
      const opposed = await this._checkOpposedTask(weapon.name);
      if (opposed.proceed === "pending") {
        // Store pending task — GM socket handler injects opposedDifficulty (defender's
        // successes +1 for the override penalty) when the defender confirms their roll.
        const _hasTS  = CombatHUD.hasTargetingSolution(token);
        const _hasRFT = hasRapidFireTorpedoLauncher(actor);
        const _defLabel = opposed.defMode === "evasive-action" ? "Evasive Action"
                        : opposed.defMode === "defensive-fire"  ? "Defensive Fire" : "Cover";

        await game.settings.set("sta2e-toolkit", "pendingOpposedTask", {
          taskId:          `${token.id}-${Date.now()}`,
          attackerUserId:  game.userId,
          attackerTokenId: token.id,
          attackerActorId: actor.id,
          isNpcAttacker:   isNpc,
          defMode:         opposed.defMode,
          weaponName:      weapon.name,
          overridePenalty: true,   // flag so GM handler adds +1 to defender's successes
          rollerOpts: {
            hasTargetingSolution: _hasTS,
            hasRapidFireTorpedo:  _hasRFT && isTorpedo,
            weaponContext:        weaponCtx,
            stationId:            station.id,
            officer:              resolvedOfficer,
            crewQuality:          isNpc && !resolvedOfficer ? CombatHUD.getCrewQuality(actor) : null,
            difficulty:           null,  // will be set to opposedDifficulty by socket handler
            taskLabel:            `Override — Fire ${weapon.name}`,
            taskContext:          `${overrideContext} · Opposed — ${_defLabel}`,
            // opposedDifficulty / opposedDefenseType / defenderSuccesses injected by GM handler
          },
        });
        return; // Bail — roller opens automatically when defender confirms
      }
      if (!opposed.proceed) return;

      const hasTS  = CombatHUD.hasTargetingSolution(token);
      const hasRFT = hasRapidFireTorpedoLauncher(actor);
      const baseOppDiff = (opposed.difficulty ?? 0) + 1;  // +1 override on opposed difficulty too

      const rollerOpts = {
        hasTargetingSolution: hasTS,
        hasRapidFireTorpedo:  hasRFT && isTorpedo,
        weaponContext:        weaponCtx,
        stationId:            station.id,
        officer:              resolvedOfficer,
        crewQuality:          isNpc && !resolvedOfficer ? CombatHUD.getCrewQuality(actor) : null,
        opposedDifficulty:    opposed.difficulty !== null ? baseOppDiff : null,
        opposedDefenseType:   opposed.defenseType ?? null,
        defenderSuccesses:    opposed.defenderSuccesses ?? null,
        difficulty:           opposed.difficulty !== null ? null : 3,   // base 2 +1 override
        taskLabel:            `Override — Fire ${weapon.name}`,
        taskContext:          overrideContext,
      };

      if (isNpc) openNpcRoller(actor, token, rollerOpts);
      else       openPlayerRoller(actor, token, rollerOpts);
      return;
    }

    // ── Step 3 (generic): open roller with base difficulty + 1 ────────────
    const baseDiff    = TASK_BASE_DIFF[taskPick];
    const difficulty  = baseDiff !== null && baseDiff !== undefined ? baseDiff + 1 : null;

    const rollerOpts = {
      stationId:   station.id,
      officer:     resolvedOfficer,
      crewQuality: isNpc && !resolvedOfficer ? CombatHUD.getCrewQuality(actor) : null,
      difficulty,
      taskLabel:   `Override — ${chosenTask.label}`,
      taskContext: overrideContext + (difficulty !== null ? ` (Difficulty ${difficulty})` : ""),
    };

    if (isNpc) openNpcRoller(actor, token, rollerOpts);
    else       openPlayerRoller(actor, token, rollerOpts);
  }

  // ── Create Trait ─────────────────────────────────────────────────────────

  async _handleCreateTrait(actor, token, station) {
    if (!CombatHUD._requiresPlayerOfficer(actor, station?.id ?? "command", station?.label ?? "Bridge")) return;

    const isNpc    = CombatHUD.isNpcShip(actor);
    const isGM     = game.user.isGM;

    // Station label for display
    const stationLabel = station?.label ?? "Bridge";
    const defaultAttr  = station?.defaultAttr ?? "reason";
    const defaultDisc  = station?.defaultDisc ?? "command";

    // ── Step 1: Roll ─────────────────────────────────────────────────────────
    // NPC ships: open the NPC roller; PC ships: open the player roller.
    // Both resolve via taskCallback into _resolveTraitCreation.
    let succeeded = false;
    let successes = 0;

    if (isNpc && isGM) {
      // Resolve assigned officer for this station
      const stationOfficers = station ? getStationOfficers(actor, station.id) : [];
      const officer = stationOfficers.length > 0 ? readOfficerStats(stationOfficers[0]) : null;

      // Roller posts result card directly via taskCallback — no second dialog
      openNpcRoller(actor, token, {
        stationId:           station?.id ?? null,
        officer,
        difficulty:          2,
        ignoreBreachPenalty: true,
        crewQuality:         !officer ? CombatHUD.getCrewQuality(actor) : null,
        taskLabel:           `Create Trait — ${stationLabel}`,
        taskContext:         "Difficulty 2 · Success creates a Trait with Potency 1",
        taskCallback:        ({ passed, successes }) => {
          this._resolveTraitCreation(actor, stationLabel, station, passed, successes, token);
        },
      });
      return; // continues in taskCallback

    } else {
      // Player ship — open the player roller pre-set to Difficulty 2
      const stationOfficers = station ? getStationOfficers(actor, station.id) : [];
      const officer = stationOfficers.length > 0 ? readOfficerStats(stationOfficers[0]) : null;

      openPlayerRoller(actor, token, {
        stationId:           station?.id ?? null,
        officer,
        difficulty:          2,
        ignoreBreachPenalty: true,
        taskLabel:           `Create Trait — ${stationLabel}`,
        taskContext:         "Difficulty 2 · Success creates a Trait with Potency 1",
        taskCallback:        ({ passed, successes }) => {
          this._resolveTraitCreation(actor, stationLabel, station, passed, successes, token);
        },
      });
      return; // continues in taskCallback
    }

    await this._resolveTraitCreation(actor, stationLabel, station, succeeded, null, token);
  }

  // ── Create Trait — resolution (shared between NPC callback and PC path) ──

  async _resolveTraitCreation(actor, stationLabel, station, succeeded, successes = null, token = null) {
    const isNpc = CombatHUD.isNpcShip(actor);

    if (!succeeded) {
      ChatMessage.create({
        content: lcarsCard("✗ CREATE TRAIT FAILED", LC.red,
          `<div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            ${actor.name} — ${stationLabel} task failed. No trait created.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
      return;
    }

    // ── Post a chat card with name/potency inputs and Apply button ─────────────
    // Encoding actor/token identity so the button handler can resolve them
    // even if the dialog is long gone by the time the GM clicks Apply.
    const traitPayload = encodeURIComponent(JSON.stringify({
      actorId:      actor.id,
      tokenId:      token?.id ?? null,
      stationLabel,
      isNpc,
      successes:    successes ?? 0,
    }));

    const currency = isNpc ? "Threat" : "Momentum";

    ChatMessage.create({
      flags: { "sta2e-toolkit": { traitResultCard: true } },
      content: lcarsCard("✍️ CREATE TRAIT — SUCCESS", LC.primary, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:6px;font-family:${LC.font};">${actor.name} — ${stationLabel}</div>
        ${successes !== null ? `
        <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};margin-bottom:8px;">
          ${successes} success${successes !== 1 ? "es" : ""} — task passed.
          Each additional Potency above 1 costs 2 ${currency}.
        </div>` : ""}
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;">
          <div>
            <label style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;display:block;margin-bottom:3px;">
              Trait Name
            </label>
            <input class="sta2e-trait-name" type="text"
              placeholder="e.g. Battle-Hardened Crew"
              style="width:100%;padding:5px 8px;background:${LC.bg};
                border:1px solid ${LC.border};border-radius:2px;
                color:${LC.text};font-size:12px;font-family:${LC.font};
                box-sizing:border-box;" />
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <label style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;">
              Potency
            </label>
            <input class="sta2e-trait-potency" type="number" min="1" max="5" value="1"
              style="width:60px;padding:4px 8px;background:${LC.bg};
                border:1px solid ${LC.border};border-radius:2px;
                color:${LC.tertiary};font-size:16px;font-weight:700;
                font-family:${LC.font};text-align:center;" />
            <span class="sta2e-trait-cost"
              style="font-size:10px;color:${LC.textDim};font-family:${LC.font};">
              (base — no extra cost)
            </span>
          </div>
        </div>
        <button class="sta2e-apply-trait"
          data-payload="${traitPayload}"
          style="width:100%;padding:5px;background:rgba(255,153,0,0.12);
            border:1px solid ${LC.primary};border-radius:2px;
            color:${LC.primary};font-size:10px;font-weight:700;
            letter-spacing:0.08em;text-transform:uppercase;
            cursor:pointer;font-family:${LC.font};">
          ✍️ APPLY TRAIT TO ${actor.name.toUpperCase()}
        </button>`),
      speaker: { alias: "STA2e Toolkit" },
    });
  }

  // ── Cloaking Device toggle ────────────────────────────────────────────────

  async _handleCloakToggle(token) {
    const actor = token.actor;
    // Consider cloaked if either the invisible condition or the hidden flag is set —
    // toggling will sync both to the opposite state
    const isCloaked = (actor?.statuses?.has("invisible") ?? false)
                   || (token.document.hidden ?? false);

    // ── Helper: play sound via settings ──────────────────────────────────────
    const playSound = (key) => {
      try {
        const path = game.settings.get("sta2e-toolkit", key);
        if (path) AudioHelper.play({ src: path, volume: 0.8, autoplay: true, loop: false }, true);
      } catch {}
    };

    // ── Helper: TMFX shimmer distortion ──────────────────────────────────────
    const applyShimmer = async (tok) => {
      if (!window.TokenMagic) return;
      const params = [{
        filterType:    "distortion",
        filterId:      "sta2e-cloak-shimmer",
        maskPath:      "modules/tokenmagic/fx/assets/distortion-1.png",
        maskSpriteScaleX: 5,
        maskSpriteScaleY: 5,
        padding:       20,
        animated: {
          maskSpriteX: { active: true, speed: 0.05, animType: "move" },
          maskSpriteY: { active: true, speed: 0.07, animType: "move" },
        }
      }];
      await TokenMagic.addUpdateFilters(tok, params);
    };

    const removeShimmer = async (tok) => {
      if (!window.TokenMagic) return;
      try { await TokenMagic.deleteFilters(tok, "sta2e-cloak-shimmer"); } catch {}
    };

    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    if (!isCloaked) {
      // ── ACTIVATING CLOAK — major action, requires Reserve Power & a task roll ──

      // Require a tactical officer (player ships only; NPC ships pass automatically)
      if (!CombatHUD._requiresPlayerOfficer(actor, "tactical", "Tactical")) return;

      // Reserve Power check — required to bring the cloaking device online
      if (!CombatHUD.hasReservePower(actor)) {
        ui.notifications.warn(`${actor.name}: No Reserve Power available — cannot activate Cloaking Device.`);
        ChatMessage.create({
          content: lcarsCard("🔋 NO RESERVE POWER", LC.red, `
            <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
              margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
            <div style="font-size:11px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
              Activating the Cloaking Device requires Reserve Power. The ship does not
              currently have Reserve Power available — use <strong>Regain Power</strong>
              from the Ops/Engineering station first.
            </div>`),
          speaker: { alias: "STA2e Toolkit" },
        });
        return;
      }

      const isNpc = CombatHUD.isNpcShip(actor);
      const isGM  = game.user.isGM;

      // Resolve the tactical station officer
      const tacOfficers = getStationOfficers(actor, "tactical");
      const tacOfficer  = tacOfficers.length > 0 ? readOfficerStats(tacOfficers[0]) : null;

      // Shared roll options — Control + Engineering, Diff 2, ship assisted by Engines + Security
      const rollOpts = {
        stationId:     "tactical",
        officer:       tacOfficer,
        difficulty:    2,
        defaultAttr:   "control",
        defaultDisc:   "engineering",
        shipSystemKey: "engines",
        shipDeptKey:   "security",
        taskLabel:     "Cloaking Device",
        taskContext:   "Control + Engineering · Difficulty 2 · Engines + Security",
        taskCallback:  async ({ passed }) => {
          if (!passed) {
            ChatMessage.create({
              content: lcarsCard("👁 CLOAKING DEVICE FAILED", LC.red, `
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
                <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                  Failed to bring the Cloaking Device online.<br>
                  <span style="color:${LC.textDim};font-size:9px;">
                    Reserve Power has not been consumed.
                  </span>
                </div>`),
              speaker: ChatMessage.getSpeaker({ token: token.document }),
            });
            return;
          }

          // On success: consume Reserve Power then apply cloak effects
          await CombatHUD.clearReservePower(actor);

          playSound("sndCloak");
          await applyShimmer(token);
          await wait(800);

          // Apply invisible condition AND hide the token document simultaneously
          await Promise.all([
            token.actor.toggleStatusEffect("invisible", { active: true, overlay: false }),
            token.document.update({ hidden: true }),
          ]);

          await wait(200);
          await removeShimmer(token);

          ChatMessage.create({
            content: lcarsCard("🔇 CLOAKING DEVICE ENGAGED", "#aa44ff", `
              <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
                <strong>${token.name}</strong> has engaged its cloaking device.<br>
                <span style="color:${LC.textDim};font-size:9px;">
                  Shields are down. Cannot attack or be targeted while cloaked.<br>
                  Deactivating requires a minor action.
                </span>
              </div>`),
            speaker: ChatMessage.getSpeaker({ token: token.document }),
          });

          this._refresh();
        },
      };

      if (isNpc && isGM) {
        openNpcRoller(actor, token, {
          ...rollOpts,
          crewQuality: !tacOfficer ? CombatHUD.getCrewQuality(actor) : null,
        });
      } else {
        openPlayerRoller(actor, token, rollOpts);
      }

    } else {
      // ── DECLOAKING — minor action, no roll required ───────────────────────
      playSound("sndDecloak");

      await applyShimmer(token);
      await wait(400);

      // Remove invisible condition AND unhide the token simultaneously
      await Promise.all([
        token.actor.toggleStatusEffect("invisible", { active: false, overlay: false }),
        token.document.update({ hidden: false }),
      ]);

      await wait(800);
      await removeShimmer(token);

      ChatMessage.create({
        content: lcarsCard("👁 CLOAKING DEVICE DISENGAGED", "#aa44ff", `
          <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            <strong>${token.name}</strong> has decloaked.<br>
            <span style="color:${LC.textDim};font-size:9px;">
              Shields may now be raised.
            </span>
          </div>`),
        speaker: ChatMessage.getSpeaker({ token: token.document }),
      });

      this._refresh();
    }
  }

  // ── Systems Status ──────────────────────────────────────────────────────────


  _buildSystemsStatus(actor) {
    const section    = this._buildSection("SYSTEMS");
    const grid       = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:8px 10px;";

    const SYSTEMS    = ["communications","computers","engines","sensors","structure","weapons"];
    const shipStatus = CombatHUD.getShipStatus(actor);
    const scale      = actor.system?.scale ?? 1;
    const destroyThreshold = Math.ceil(scale / 2);

    // Total breaches for critical damage indicator
    const totalBreaches = Object.values(actor.system?.systems ?? {})
      .reduce((sum, s) => sum + (s.breaches ?? 0), 0);
    const isCritical  = totalBreaches > scale;

    const patchedMap = CombatHUD.getPatchedBreaches(actor);

    SYSTEMS.forEach(key => {
      const sys           = actor.system?.systems?.[key] ?? {};
      const breaches      = sys.breaches ?? 0;
      const patched       = patchedMap[key] ?? 0;
      const effectiveBr   = Math.max(0, breaches - patched);
      const rating        = sys.value ?? 0;
      const label         = CombatHUD.systemLabel(key);
      const isDestroyed   = breaches >= destroyThreshold;
      const isPatched     = patched > 0 && !isDestroyed;
      const strainRange   = CombatHUD.getPowerStrainRange(actor, key);
      const isRerouted    = CombatHUD.getReroutedPower(actor, key);

      const color = isDestroyed    ? LC.red
                  : effectiveBr >= 2 ? LC.orange
                  : effectiveBr === 1 ? LC.yellow
                  : isPatched      ? LC.green
                  : breaches === 0 ? LC.green
                  : LC.green;

      const borderColor = isDestroyed  ? LC.red
                        : effectiveBr > 0 ? color
                        : isPatched    ? LC.green
                        : isRerouted   ? LC.primary
                        : LC.borderDim;

      const cell = document.createElement("div");
      cell.style.cssText = `
        background: ${isDestroyed ? "rgba(80,0,0,0.3)" : isPatched && effectiveBr === 0 ? "rgba(0,180,80,0.06)" : LC.panel};
        border: 1px solid ${borderColor};
        border-radius: 2px;
        padding: 4px 6px;
        font-size: 10px;
      `;

      const nameRow = document.createElement("div");
      nameRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;";
      nameRow.innerHTML = `
        <span style="color:${isDestroyed ? LC.red : LC.tertiary};font-weight:700;
          font-family:${LC.font};letter-spacing:0.06em;text-transform:uppercase;
          ${isDestroyed ? "text-decoration:line-through;" : ""}">
          ${isDestroyed ? "💀 " : ""}${label}
        </span>
        <span style="color:${LC.textDim};font-family:${LC.font};">${rating}</span>
      `;

      const breachRow = document.createElement("div");
      breachRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;";

      const breachLabel = document.createElement("span");
      breachLabel.style.cssText = `color:${color};font-size:10px;font-family:${LC.font};letter-spacing:0.04em;`;

      if (breaches === 0) {
        breachLabel.title       = "No breaches";
        breachLabel.textContent = "○ OK";
      } else if (isDestroyed) {
        breachLabel.title       = `${breaches}/${destroyThreshold} breaches — DESTROYED`;
        breachLabel.textContent = `● DESTROYED (${breaches})`;
      } else if (isPatched && effectiveBr === 0) {
        // All breaches patched — green with patch indicator
        breachLabel.style.cssText = `color:${LC.green};font-size:10px;font-family:${LC.font};letter-spacing:0.04em;`;
        breachLabel.title         = `${breaches} breach${breaches !== 1 ? "es" : ""} — all patched (🔧 penalties removed)`;
        breachLabel.textContent   = `🔧 PATCHED (${breaches})`;
      } else if (isPatched && effectiveBr > 0) {
        // Some patched, some still active
        breachLabel.title         = `${breaches} total, ${patched} patched, ${effectiveBr} active — Difficulty +${effectiveBr}`;
        breachLabel.textContent   = `🔧 ${patched}✓ ${"●".repeat(effectiveBr)}${"○".repeat(Math.max(0, destroyThreshold - breaches))} ${breaches}/${destroyThreshold}`;
      } else {
        breachLabel.title         = `${breaches}/${destroyThreshold} breaches — Difficulty +${breaches}`;
        breachLabel.textContent   = `${"●".repeat(breaches)}${"○".repeat(Math.max(0, destroyThreshold - breaches))} ${breaches}/${destroyThreshold}`;
      }

      if (game.user.isGM) {
        const btnStyle = `background:none;border:none;color:${LC.textDim};font-size:11px;cursor:pointer;padding:0 2px;line-height:1;`;

        const addBtn = document.createElement("button");
        addBtn.style.cssText = btnStyle;
        addBtn.textContent   = "+";
        addBtn.title         = `Add breach to ${label}`;
        addBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const { totalBreaches } = await CombatHUD.applyBreach(actor, key, this._token);
          await CombatHUD._resolveAttackOutcome(actor, this._token, totalBreaches);
          this._refresh();
        });

        const rmBtn = document.createElement("button");
        rmBtn.style.cssText = btnStyle;
        rmBtn.textContent   = "−";
        rmBtn.title         = `Remove breach from ${label}`;
        rmBtn.disabled      = breaches === 0;
        rmBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const cur = actor.system?.systems?.[key]?.breaches ?? 0;
          if (cur > 0) {
            await actor.update({ [`system.systems.${key}.breaches`]: cur - 1 });
            // Rebuild FX from scratch to match new total breach count
            const totalAfter = Object.entries(actor.system?.systems ?? {})
              .reduce((sum, [k, s]) => sum + (k === key ? cur - 1 : (s.breaches ?? 0)), 0);
            CombatHUD._clearBreachTokenFX(actor);
            for (let i = 1; i <= totalAfter; i++) CombatHUD._applyBreachTokenFX(actor, i);
            // Delete injury item if this was the last breach on this system
            const repairedKeys = (cur - 1 === 0) ? [key] : [];
            // Clear patch flag when breach count reaches 0 — fully repaired
            if (cur - 1 === 0) {
              await CombatHUD.unpatchSystem(actor, key);
            }
            await CombatHUD._afterRepair(actor, repairedKeys);
            this._refresh();
          }
        });

        const btnWrap = document.createElement("span");
        btnWrap.style.cssText = "display:flex;gap:2px;";
        btnWrap.appendChild(rmBtn);
        btnWrap.appendChild(addBtn);
        breachRow.appendChild(breachLabel);
        breachRow.appendChild(btnWrap);
      } else {
        breachRow.appendChild(breachLabel);
      }

      cell.appendChild(nameRow);
      cell.appendChild(breachRow);

      // Rerouted power indicator — shown when Reserve Power has been rerouted here
      if (isRerouted && game.user.isGM) {
        const rerouteRow = document.createElement("div");
        rerouteRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-top:2px;";

        const rerouteLabel = document.createElement("span");
        rerouteLabel.style.cssText = `color:${LC.primary};font-size:9px;font-family:${LC.font};letter-spacing:0.04em;font-weight:700;`;
        rerouteLabel.title = `Reserve Power rerouted to ${label} — will be spent on next task using this system. Click × to clear.`;
        rerouteLabel.textContent = `⚡ POWER REROUTED`;

        const clearRerouteBtn = document.createElement("button");
        clearRerouteBtn.style.cssText = `background:none;border:none;color:${LC.primary};font-size:10px;cursor:pointer;padding:0 2px;line-height:1;`;
        clearRerouteBtn.textContent = "×";
        clearRerouteBtn.title = `Clear rerouted power on ${label}`;
        clearRerouteBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await CombatHUD.setReroutedPower(actor, key, false);
          this._refresh();
        });

        rerouteRow.appendChild(rerouteLabel);
        rerouteRow.appendChild(clearRerouteBtn);
        cell.appendChild(rerouteRow);
      }

      // Power strain indicator — shown when a Power Strain injury exists on this system
      if (strainRange > 0 && game.user.isGM) {
        const strainRow = document.createElement("div");
        strainRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-top:2px;";

        const strainLabel = document.createElement("span");
        strainLabel.style.cssText = `color:${LC.orange};font-size:9px;font-family:${LC.font};letter-spacing:0.04em;`;
        strainLabel.title = `Power Strain — complication range +${strainRange} on all tasks using ${label}. Click × to clear.`;
        strainLabel.textContent = `⚡ Strain +${strainRange} compl.`;

        const clearBtn = document.createElement("button");
        clearBtn.style.cssText = `background:none;border:none;color:${LC.orange};font-size:10px;cursor:pointer;padding:0 2px;line-height:1;`;
        clearBtn.textContent = "×";
        clearBtn.title = `Clear Power Strain on ${label}`;
        clearBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await CombatHUD.clearPowerStrain(actor, key);
          this._refresh();
        });

        strainRow.appendChild(strainLabel);
        strainRow.appendChild(clearBtn);
        cell.appendChild(strainRow);
      }

      grid.appendChild(cell);
    });

    section.appendChild(grid);

    // Critical / total breach indicator
    if (totalBreaches > 0) {
      const totalRow = document.createElement("div");
      totalRow.style.cssText = `
        padding: 3px 10px 4px;
        font-size: 9px;
        color: ${isCritical ? LC.red : LC.textDim};
        text-align: center;
        font-family: ${LC.font};
        letter-spacing: 0.1em;
        text-transform: uppercase;
      `;
      totalRow.textContent = isCritical
        ? `⚠ CRITICAL — BREACHES ${totalBreaches} / SCALE ${scale}`
        : `BREACHES ${totalBreaches} / SCALE ${scale}`;
      section.appendChild(totalRow);
    }

    // ── Ship status row (Active / Disabled / Destroyed) — GM only ──────────
    if (game.user.isGM) {
      const statusRow = document.createElement("div");
      statusRow.style.cssText = `display:flex;gap:4px;padding:0 8px 8px;`;

      const STATUSES = [
        { key: "active",    label: "ACTIVE",    color: LC.green   },
        { key: "disabled",  label: "DISABLED",  color: LC.yellow  },
        { key: "destroyed", label: "DESTROYED", color: LC.red     },
      ];

      STATUSES.forEach(s => {
        const btn      = document.createElement("button");
        const isActive = shipStatus === s.key;
        btn.style.cssText = `
          flex:1;padding:3px 4px;font-size:9px;font-weight:700;cursor:pointer;
          font-family:${LC.font};letter-spacing:0.08em;text-transform:uppercase;
          background:${isActive ? `rgba(0,0,0,0.4)` : `rgba(0,0,0,0.2)`};
          border:1px solid ${isActive ? s.color : LC.borderDim};
          border-radius:2px;
          color:${isActive ? s.color : LC.textDim};
        `;
        btn.textContent = s.label;
        btn.title       = `Set ship status to ${s.label}`;
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await CombatHUD.setShipStatus(actor, s.key);
          if (s.key === "destroyed" && CombatHUD.isNpcShip(actor)) {
            await CombatHUD.fireDestructionEffect(this._token);
          }
          this._refresh();
        });
        statusRow.appendChild(btn);
      });
      section.appendChild(statusRow);

      // ── Repair Hull button — opens per-system repair dialog ──────────────
      if (totalBreaches > 0) {
        const repairBtn = document.createElement("button");
        repairBtn.style.cssText = `
          width:calc(100% - 16px);margin:0 8px 8px;padding:4px 6px;
          font-size:9px;font-weight:700;cursor:pointer;
          font-family:${LC.font};letter-spacing:0.1em;text-transform:uppercase;
          background:rgba(0,80,0,0.25);
          border:1px solid ${LC.green};border-radius:2px;
          color:${LC.green};
        `;
        repairBtn.textContent = "🔧 REPAIR HULL BREACHES";
        repairBtn.title       = "Open the hull repair menu";
        repairBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await CombatHUD._openRepairDialog(actor);
          this._refresh();
        });
        section.appendChild(repairBtn);
      }
    }

    return section;
  }

  static async fireDestructionEffect(token) {
    if (!window.Sequence) return;
    const patron = (() => {
      try { return game.settings.get("sta2e-toolkit", "jb2aTier") === "patron"; }
      catch { return false; }
    })();

    const w = token.document.width ?? 1;

    // ── File paths ─────────────────────────────────────────────────────────
    const impactFile   = patron
      ? "jb2a.impact.011.orange"
      : "modules/JB2A_DnD5e/Library/Generic/Impact/Impact013/Impact013_001_OrangeYellow_400x400.webm";
    const explodeFile  = patron
      ? "jb2a.explosion.01.orange"
      : "modules/JB2A_DnD5e/Library/Generic/Explosion/Explosion_01_Orange_400x400.webm";
    const explode2File = patron
      ? "jb2a.explosion.08.orange"
      : "modules/JB2A_DnD5e/Library/Generic/Explosion/Explosion_01_Orange_400x400.webm";
    const smokeRingFile = patron
      ? "jb2a.smoke.puff.ring.01.white"
      : "modules/JB2A_DnD5e/Library/Generic/Smoke/SmokePuffRing01_03_Regular_White_400x400.webm";
    const flamesFile   = patron ? "jb2a.flames.01.orange" : null;

    const deleteAfter = (() => {
      try { return game.settings.get("sta2e-toolkit", "deleteTokenOnDestruction"); }
      catch { return true; }
    })();

    // ── Timing constants ───────────────────────────────────────────────────
    // Fade starts immediately, explosion fires at peak of fade.
    // Total animation duration before token is deleted.
    const FADE_MS      = deleteAfter ? 600 : 0;
    const FLAMES_MS    = flamesFile ? 1800 : 0; // flames linger (patron)
    const SMOKE_MS     = 1200;  // smoke ring dissipates
    const TOTAL_MS     = FADE_MS + Math.max(FLAMES_MS, SMOKE_MS) + 500;

    try {
      // ── Step 1: Fade the token out smoothly ───────────────────────────────
      if (deleteAfter) {
        const originalAlpha = token.document.alpha ?? 1;
        const steps = 12;
        const stepDelay = FADE_MS / steps;
        for (let i = 1; i <= steps; i++) {
          await new Promise(r => setTimeout(r, stepDelay));
          const newAlpha = originalAlpha * (1 - i / steps);
          await token.document.update({ alpha: Math.max(0, newAlpha) });
        }
      }

      // ── Step 2: Play explosion sequence at token location ─────────────────
      const s = new window.Sequence();

      s.effect()
        .file(impactFile)
        .atLocation(token)
        .scaleToObject(w * 1.2)
        .zIndex(3);

      s.wait(150);

      s.effect()
        .file(explodeFile)
        .atLocation(token)
        .scaleToObject(w * 1.8)
        .zIndex(4);

      s.wait(100);

      s.effect()
        .file(explode2File)
        .atLocation(token, { randomOffset: 0.15 })
        .scaleToObject(w * 2.4)
        .zIndex(3);

      s.effect()
        .file(smokeRingFile)
        .atLocation(token)
        .scaleToObject(w * 3.0)
        .zIndex(2);

      if (flamesFile) {
        s.wait(300);
        s.effect()
          .file(flamesFile)
          .atLocation(token)
          .scaleToObject(w * 1.0)
          .zIndex(1);
      }

      s.play();

      // ── Step 3: Wait for animation to finish then delete the token ────────
      await new Promise(r => setTimeout(r, TOTAL_MS));

      if (deleteAfter && game.user.isGM && canvas.tokens.get(token.id)) {
        await token.document.delete();
      }

    } catch(e) {
      console.warn("STA2e Toolkit | Destruction effect failed:", e);
      try {
        if (deleteAfter && game.user.isGM && canvas.tokens.get(token.id)) {
          await token.document.delete();
        }
      } catch {}
    }
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  // ── Warp Core Breach Panel ─────────────────────────────────────────────────

  _buildCrewQualityRow(actor) {
    const QUALITIES = [
      { key: "basic",       label: "Basic",       dept: 1 },
      { key: "proficient",  label: "Proficient",  dept: 2 },
      { key: "talented",    label: "Talented",    dept: 3 },
      { key: "exceptional", label: "Exceptional", dept: 4 },
    ];

    const current = CombatHUD.getCrewQuality(actor);
    const section = document.createElement("div");
    section.style.cssText = `
      padding:5px 10px 6px;
      border-top:1px solid ${LC.borderDim};
      background:rgba(255,153,0,0.02);
    `;

    const label = document.createElement("div");
    label.style.cssText = `font-size:9px;color:${LC.textDim};font-family:${LC.font};
      text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;`;
    label.textContent = "NPC Crew Quality";
    section.appendChild(label);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:3px;";

    QUALITIES.forEach(q => {
      const btn = document.createElement("button");
      const isActive = q.key === current;
      btn.style.cssText = `
        flex:1;padding:3px 2px;
        background:${isActive ? "rgba(255,153,0,0.18)" : "rgba(255,153,0,0.04)"};
        border:1px solid ${isActive ? LC.primary : LC.borderDim};
        border-radius:2px;cursor:pointer;
        color:${isActive ? LC.primary : LC.textDim};
        font-size:9px;font-weight:${isActive ? "700" : "400"};
        font-family:${LC.font};letter-spacing:0.04em;
        text-transform:uppercase;transition:all 0.12s;
      `;
      btn.title = `${q.label} crew (dept ${q.dept}) — attr ${q.dept + 7}, dept ${q.dept}`;
      btn.textContent = q.label;
      btn.addEventListener("mouseenter", () => {
        if (q.key !== CombatHUD.getCrewQuality(actor)) {
          btn.style.borderColor = LC.tertiary;
          btn.style.color       = LC.tertiary;
        }
      });
      btn.addEventListener("mouseleave", () => {
        const still = q.key === CombatHUD.getCrewQuality(actor);
        btn.style.borderColor = still ? LC.primary : LC.borderDim;
        btn.style.color       = still ? LC.primary : LC.textDim;
      });
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await CombatHUD.setCrewQuality(actor, q.key);
        this._refresh();
      });
      btnRow.appendChild(btn);
    });

    section.appendChild(btnRow);
    return section;
  }

  _buildBreachPanel(actor) {
    const section   = this._buildSection("☢ WARP CORE BREACH IMMINENT");
    const engRating = actor.system?.systems?.engines?.value ?? 0;
    const scale     = actor.system?.scale ?? 0;

    const body = document.createElement("div");
    body.style.cssText = `padding:8px 10px;`;

    // Explode threshold info
    const info = document.createElement("div");
    info.style.cssText = `font-size:10px;color:${LC.text};font-family:${LC.font};margin-bottom:6px;line-height:1.5;`;
    info.innerHTML = `
      Roll <strong>d20</strong> at the start of each round.<br>
      If result <strong>&gt; Engineering ${engRating}</strong> → reactor explodes.<br>
      Explosion: <strong style="color:${LC.red};">Scale+1 (${scale+1}) damage, Piercing</strong> to all ships at Close range.
    `;
    body.appendChild(info);

    // Roll Breach Check button (GM only)
    if (game.user.isGM) {
      const rollBtn = document.createElement("button");
      rollBtn.style.cssText = `
        width:100%;padding:5px;margin-bottom:4px;
        background:rgba(255,0,0,0.12);border:1px solid ${LC.red};border-radius:2px;
        color:${LC.red};font-size:11px;font-weight:700;letter-spacing:0.08em;
        text-transform:uppercase;cursor:pointer;font-family:${LC.font};
      `;
      rollBtn.textContent = "🎲 Roll Breach Check";
      rollBtn.title = "Roll d20 vs Engineering — explodes if over";
      rollBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const token = this._token;
        await CombatHUD.rollBreachCheck(actor, token);
        this._refresh();
      });
      body.appendChild(rollBtn);

      // Containment options info row
      const opts = document.createElement("div");
      opts.style.cssText = `font-size:9px;color:${LC.textDim};font-family:${LC.font};
        margin-top:4px;line-height:1.6;letter-spacing:0.03em;`;
      opts.innerHTML = `
        <span style="color:${LC.yellow};">▶ Stabilize:</span> Extended Task — Progress: Engines (${engRating}), Diff 3, Daring/Control+Engineering<br>
        <span style="color:${LC.yellow};">▶ Eject:</span> Task — Diff 2, Daring+Engineering (still rolls but won't destroy ship)
      `;
      body.appendChild(opts);
    }

    section.appendChild(body);
    return section;
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  _buildStatus(isShip) {
    const section = this._buildSection("STATUS");
    const row     = document.createElement("div");
    row.style.cssText = `display:flex;flex-wrap:wrap;gap:4px;padding:6px 10px 8px;`;

    const token      = this._token;
    const defMode    = getDefenseMode(token);
    const conditions = getConditions(token);

    let hasAny = false;

    // Tractor Beam badge — shows on both source and target
    const tractorState = token ? CombatHUD.getTractorBeamState(token) : null;
    if (isShip && tractorState) {
      const isSource = !!tractorState.targetTokenId;
      const beamLabel = isSource
        ? `🔗 Tractoring ${tractorState.targetName}`
        : `🔗 Tractored by ${tractorState.sourceName}`;
      const beamDesc  = isSource
        ? `Tractor beam active — ${tractorState.targetName} is locked. Click to release.`
        : `This ship is held in a tractor beam by ${tractorState.sourceName}.`;
      row.appendChild(this._statusBadge("🔗", isSource ? `Tractoring` : `Tractored`, beamDesc, isSource, async () => {
        if (!isSource) return; // Only source can release
        const targetTok  = canvas.tokens?.get(tractorState.targetTokenId);
        const sourceName = token?.name ?? tractorState.sourceName ?? "Ship";
        await CombatHUD.releaseTractorBeam(token, targetTok);
        ChatMessage.create({
          content: lcarsCard("🔗 TRACTOR BEAM RELEASED", LC.textDim, `
            <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
              margin-bottom:4px;font-family:${LC.font};">${sourceName}</div>
            <div style="font-size:13px;color:${LC.text};font-family:${LC.font};">
              Tractor beam disengaged from ${tractorState.targetName}.
            </div>`),
          speaker: { alias: "STA2e Toolkit" },
        });
        this._refresh();
      }));
      hasAny = true;
    }

    // Weapons Armed badge
    if (isShip && CombatHUD.getWeaponsArmed(token?.actor ?? actor)) {
      row.appendChild(this._statusBadge("⚡", "Armed", "Weapons armed — ready to fire", true, async () => {
        await CombatHUD.setWeaponsArmed(token?.actor ?? actor, false);
        this._refresh();
      }));
      hasAny = true;
    }

    // Shields Lowered badge
    if (isShip && CombatHUD.getShieldsLowered(token?.actor ?? actor)) {
      row.appendChild(this._statusBadge("🛡️", "Shields Down", "Shields lowered — click to restore", true, async () => {
        const a   = token?.actor ?? actor;
        const doc = a.isToken && a.token && !a.token.isLinked
          ? a.token : a.isToken ? (game.actors.get(a.id ?? a._id) ?? a) : a;
        const savedValue = CombatHUD.getShieldsSavedMax(a) ?? 0;
        const savedMax2  = doc?.getFlag("sta2e-toolkit", "shieldsSavedMax2") ?? savedValue;
        await CombatHUD.setShieldsLowered(a, false);
        await doc?.unsetFlag("sta2e-toolkit", "shieldsSavedMax2").catch(() => {});
        await a.update({ "system.shields.max": savedMax2, "system.shields.value": Math.min(savedValue, savedMax2) });
        this._refresh();
      }));
      hasAny = true;
    }

    // Modulated Shields badge — ship only, shown in status section
    if (isShip && CombatHUD.getModulatedShields(token?.actor ?? actor)) {
      row.appendChild(this._statusBadge("🔰", "Modulated", "+2 Resistance until next hit", true, async () => {
        await CombatHUD.setModulatedShields(token?.actor ?? actor, false);
        this._refresh();
      }));
      hasAny = true;
    }

    // Dept strain badges — one per strained department
    const DEPTS = ["command","conn","engineering","security","medicine","science"];
    for (const dkey of DEPTS) {
      const strain = isShip ? CombatHUD.getDeptStrainRange(token?.actor ?? actor, dkey) : 0;
      if (strain > 0) {
        const dLabel = CombatHUD.deptLabel(dkey);
        row.appendChild(this._statusBadge("💥", `${dLabel} +${strain}`, `Crew Casualties — ${dLabel} dept complication range +${strain}`, true, async () => {
          await CombatHUD.clearDeptStrain(token?.actor ?? actor, dkey);
          this._refresh();
        }));
        hasAny = true;
      }
    }

    // Defense mode badge
    if (defMode) {
      const def = COMBAT_CONDITIONS[defMode];
      row.appendChild(this._statusBadge(null, def.label, def.description, true, async () => {
        await removeCondition(token, defMode);
        this._refresh();
      }));
      hasAny = true;
    }

    // Condition badges — skip ship-only states in systems section
    for (const key of conditions) {
      if (key === "disabled" || key === "destroyed") continue;
      const def = COMBAT_CONDITIONS[key];
      if (!def) continue;

      // Ground character states get special treatment
      if (key === "stun" || key === "dying" || key === "dead") {
        row.appendChild(this._groundConditionBadge(key, def, token));
        hasAny = true;
        continue;
      }

      let badgeLabel = def.label;
      if (key === "scan-for-weakness") {
        const tokenDoc = token?.document ?? token;
        const srcName = tokenDoc?.getFlag(MODULE, "scanForWeaknessSource") ?? null;
        if (srcName) badgeLabel = `${def.label} (from ${srcName})`;
      }
      row.appendChild(this._statusBadge(null, badgeLabel, def.description, false, async () => {
        await removeCondition(token, key);
        if (key === "scan-for-weakness") {
          const tokenDoc = token?.document ?? token;
          await tokenDoc.unsetFlag(MODULE, "scanForWeaknessSource").catch(() => {});
          await tokenDoc.unsetFlag(MODULE, "scanForWeaknessSourceId").catch(() => {});
        }
        this._refresh();
      }));
      hasAny = true;
    }

    // Personal injury badges for ground characters
    if (!isShip && token) {
      const actor = token.actor;
      const SHIP_PREFIXES = ["Breach:", "Power Strain:", "Dept Strain:"];
      const personalInjuries = (actor?.items ?? []).filter(i =>
        i.type === "injury" && !SHIP_PREFIXES.some(p => i.name.startsWith(p))
      );
      if (personalInjuries.length > 0) {
        const tokenDoc       = token.document ?? token;
        const treatedIds     = tokenDoc?.getFlag(MODULE, "treatedInjuries") ?? [];

        for (const inj of personalInjuries) {
          const isTreated = treatedIds.includes(inj.id);
          const potency   = Math.max(1, inj.system?.quantity ?? 1);

          const badge = document.createElement("div");
          badge.style.cssText = `
            display:flex;align-items:center;justify-content:space-between;gap:6px;
            padding:4px 8px;width:100%;border-radius:2px;
            background:${isTreated ? "rgba(0,200,100,0.07)" : "rgba(200,60,60,0.10)"};
            border:1px solid ${isTreated ? LC.green : LC.red};
            font-family:${LC.font};
          `;

          const nameSpan = document.createElement("span");
          nameSpan.style.cssText = `font-size:10px;font-weight:700;
            color:${isTreated ? LC.green : LC.red};letter-spacing:0.04em;flex:1;min-width:0;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
          nameSpan.textContent = `🩹 ${inj.name}`;

          const metaSpan = document.createElement("span");
          metaSpan.style.cssText = `font-size:9px;color:${LC.textDim};flex-shrink:0;`;
          metaSpan.textContent = isTreated ? `✚ Treated` : `Potency ${potency}`;

          badge.appendChild(nameSpan);
          badge.appendChild(metaSpan);

          // GM: clear treated flag button
          if (isTreated && game.user.isGM) {
            const clearBtn = document.createElement("button");
            clearBtn.title = "Clear treated status";
            clearBtn.style.cssText = `background:none;border:1px solid ${LC.borderDim};border-radius:2px;
              color:${LC.textDim};font-size:9px;cursor:pointer;padding:1px 4px;flex-shrink:0;`;
            clearBtn.textContent = "✕";
            clearBtn.addEventListener("click", async (e) => {
              e.stopPropagation();
              try {
                const td = token.document ?? token;
                const cur = td.getFlag(MODULE, "treatedInjuries") ?? [];
                const upd = cur.filter(id => id !== inj.id);
                if (upd.length === 0) await td.unsetFlag(MODULE, "treatedInjuries");
                else await td.setFlag(MODULE, "treatedInjuries", upd);
                this._refresh();
              } catch(e2) { console.warn("STA2e Toolkit | treatedInjuries clear error:", e2); }
            });
            badge.appendChild(clearBtn);
          }

          row.appendChild(badge);
          hasAny = true;
        }
      }
    }

    if (!hasAny) {
      const none = document.createElement("div");
      none.style.cssText = `font-size:10px;color:${LC.textDim};padding:2px 4px;
        font-family:${LC.font};letter-spacing:0.06em;text-transform:uppercase;`;
      none.textContent   = "No active conditions";
      row.appendChild(none);
    }

    section.appendChild(row);

    // ── Cover toggle — GM-only, always visible, applies/removes Cover condition ──
    if (token?.document && game.user.isGM) {
      const coverTokenDoc  = token.document;
      const isCoverActive  = !!(coverTokenDoc.getFlag(MODULE, "coverActive"));
      const coverWrap      = document.createElement("div");
      coverWrap.style.cssText = `padding:4px 8px 6px;`;

      const coverBtn = document.createElement("button");
      coverBtn.title = isCoverActive
        ? `In Cover — ranged attacks are Opposed Tasks (${isShip ? "Daring + Conn / Engines + Conn" : "Control + Security"}). Click to remove.`
        : `Apply Cover — marks this ${isShip ? "ship" : "character"} as behind terrain. Ranged attacks become Opposed Tasks.`;
      coverBtn.style.cssText = `
        width:100%;display:flex;align-items:center;justify-content:space-between;
        padding:4px 8px;font-family:${LC.font};font-size:9px;font-weight:700;
        letter-spacing:0.06em;text-transform:uppercase;cursor:pointer;
        background:${isCoverActive ? "rgba(0,200,100,0.12)" : "rgba(255,255,255,0.02)"};
        border:1px solid ${isCoverActive ? LC.secondary : LC.borderDim};
        border-radius:2px;
        color:${isCoverActive ? LC.secondary : LC.textDim};
        transition:border-color 0.12s,background 0.12s;
      `;
      coverBtn.innerHTML = `
        <span>Cover</span>
        <span style="font-size:8px;letter-spacing:0.04em;">
          ${isCoverActive ? "ACTIVE — click to remove" : "click to apply"}
        </span>
      `;
      coverBtn.addEventListener("mouseenter", () => {
        coverBtn.style.borderColor = isCoverActive ? LC.secondary : LC.border;
        coverBtn.style.background  = isCoverActive ? "rgba(0,200,100,0.18)" : "rgba(255,255,255,0.05)";
      });
      coverBtn.addEventListener("mouseleave", () => {
        coverBtn.style.borderColor = isCoverActive ? LC.secondary : LC.borderDim;
        coverBtn.style.background  = isCoverActive ? "rgba(0,200,100,0.12)" : "rgba(255,255,255,0.02)";
      });
      coverBtn.addEventListener("click", async () => {
        try {
          if (isCoverActive) {
            await coverTokenDoc.unsetFlag(MODULE, "coverActive");
            ChatMessage.create({
              content: `<b>${token.name}</b> leaves cover.`,
              speaker: ChatMessage.getSpeaker({ token }),
            });
          } else {
            await coverTokenDoc.setFlag(MODULE, "coverActive", true);
            ChatMessage.create({
              content: lcarsCard("🪨 COVER", LC.secondary, `
                <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
                  margin-bottom:4px;font-family:${LC.font};">${token.name}</div>
                <div style="font-size:10px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
                  ${isShip
                    ? "All ranged attacks against this vessel are now <strong>Opposed Tasks</strong> (defender rolls Daring + Conn, assisted by Engines + Conn)."
                    : "All ranged attacks against this character are now <strong>Opposed Tasks</strong> (defender rolls Control + Security)."}
                </div>`),
              speaker: ChatMessage.getSpeaker({ token }),
            });
          }
          this._refresh();
        } catch(e) {
          console.warn("STA2e Toolkit | Could not toggle coverActive flag:", e);
        }
      });

      coverWrap.appendChild(coverBtn);
      section.appendChild(coverWrap);
    }

    return section;
  }

  _groundConditionBadge(key, def, token) {
    const color = key === "stun"  ? LC.secondary
                : key === "dying" ? LC.orange
                :                   LC.red;      // dead

    const wrap = document.createElement("div");
    wrap.style.cssText = `
      display:flex;flex-direction:column;gap:3px;
      padding:4px 8px;
      background:${key === "dead" ? "rgba(180,0,0,0.12)" : key === "dying" ? "rgba(255,120,0,0.1)" : "rgba(100,0,200,0.1)"};
      border:1px solid ${color};border-radius:2px;
      font-family:${LC.font};width:100%;
    `;

    // Condition label row
    const labelRow = document.createElement("div");
    labelRow.style.cssText = `display:flex;align-items:center;justify-content:space-between;`;
    labelRow.innerHTML = `
      <span style="font-size:11px;font-weight:700;color:${color};letter-spacing:0.06em;text-transform:uppercase;">
        ${def.icon ? def.icon + " " : ""}${def.label}
      </span>
      <span style="font-size:9px;color:${LC.textDim};">${def.description}</span>`;
    wrap.appendChild(labelRow);

    // Action buttons — only GM sees these
    if (game.user.isGM) {
      const btnRow = document.createElement("div");
      btnRow.style.cssText = `display:flex;gap:4px;margin-top:2px;`;

      const btnStyle = (c) => `
        flex:1;padding:2px 4px;font-size:9px;font-weight:700;cursor:pointer;
        font-family:${LC.font};letter-spacing:0.07em;text-transform:uppercase;
        background:rgba(0,0,0,0.3);border:1px solid ${c};border-radius:2px;color:${c};`;

      if (key === "stun") {
        // First Aid clears stun
        const aidBtn = document.createElement("button");
        aidBtn.style.cssText = btnStyle(LC.green);
        aidBtn.textContent = "✚ First Aid — Clear Stun";
        aidBtn.title = "First Aid task succeeded — remove Stunned condition";
        aidBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await removeCondition(token, "stun");
          this._refresh();
        });
        btnRow.appendChild(aidBtn);
      }

      if (key === "dying") {
        // First Aid clears dying
        const aidBtn = document.createElement("button");
        aidBtn.style.cssText = btnStyle(LC.green);
        aidBtn.textContent = "✚ First Aid — Stabilize";
        aidBtn.title = "First Aid task succeeded — character stabilized, remove Dying condition";
        aidBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await removeCondition(token, "dying");
          CombatHUD._removeDyingSplashFX(token);
          this._refresh();
        });
        btnRow.appendChild(aidBtn);

        // Failed First Aid / no treatment → advance to dead
        const dieBtn = document.createElement("button");
        dieBtn.style.cssText = btnStyle(LC.red);
        dieBtn.textContent = "💀 Dies";
        dieBtn.title = "No treatment received — character dies";
        dieBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await removeCondition(token, "dying");
          CombatHUD._removeDyingSplashFX(token);
          await addCondition(token, "dead");
          CombatHUD._applyDeathSplashFX(token);
          this._refresh();
        });
        btnRow.appendChild(dieBtn);
      }

      if (key === "dead") {
        // Manual clear (resurrection, retcon, etc.)
        const clearBtn = document.createElement("button");
        clearBtn.style.cssText = btnStyle(LC.textDim);
        clearBtn.textContent = "✕ Clear";
        clearBtn.title = "Remove Dead condition (resurrection / GM correction)";
        clearBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await removeCondition(token, "dead");
          CombatHUD._removeDeathSplashFX(token);
          this._refresh();
        });
        btnRow.appendChild(clearBtn);
      }

      wrap.appendChild(btnRow);
    }

    return wrap;
  }

  _statusBadge(icon, label, tooltip, isPersistent, onRemove) {
    const badge = document.createElement("div");
    badge.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      background: rgba(255,153,0,0.08);
      border: 1px solid ${LC.border};
      border-radius: 2px;
      font-size: 10px;
      color: ${LC.tertiary};
      cursor: default;
      font-family: ${LC.font};
      letter-spacing: 0.06em;
      text-transform: uppercase;
    `;
    badge.title = tooltip;

    const text = document.createElement("span");
    text.textContent = icon ? `${icon} ${label}` : label;
    badge.appendChild(text);

    if (game.user.isGM) {
      const rm = document.createElement("span");
      rm.style.cssText = `cursor:pointer;color:${LC.textDim};margin-left:2px;font-size:10px;`;
      rm.textContent   = "×";
      rm.title         = `Remove ${label}`;
      rm.addEventListener("click", (e) => { e.stopPropagation(); onRemove(); });
      badge.appendChild(rm);
    }

    return badge;
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  // ── Transporter ────────────────────────────────────────────────────────────
  // GM-only section on ground (non-ship) actor HUDs.
  // • Fire button — calls game.sta2eToolkit.openTransporter() directly.
  //   No separate macro required.
  // • Hotbar drag — creates/updates a one-liner macro so players can
  //   also trigger the transporter from their hotbar if the GM grants access.

  _buildTransporterSection() {
    const section = this._buildSection("TRANSPORTER");
    const token   = this._token;

    const row = document.createElement("div");
    row.style.cssText = `
      display:flex;align-items:center;gap:6px;
      padding:6px 10px 8px;
    `;

    // ── Fire button ───────────────────────────────────────────────────────
    const fireBtn = document.createElement("button");
    fireBtn.style.cssText = `
      flex:1;
      display:flex;align-items:center;justify-content:center;gap:6px;
      padding:5px 8px;
      background:rgba(255,153,0,0.06);
      border:1px solid ${LC.borderDim};
      border-radius:2px;
      color:${LC.text};
      font-size:10px;font-weight:400;
      font-family:${LC.font};letter-spacing:0.06em;
      text-transform:uppercase;
      cursor:pointer;
      transition:all 0.15s;
    `;

    const iconEl = document.createElement("i");
    iconEl.className = "fas fa-person-booth";
    iconEl.style.cssText = `font-size:12px;opacity:0.75;pointer-events:none;`;

    const label = document.createElement("span");
    label.textContent = "Beam";

    fireBtn.appendChild(iconEl);
    fireBtn.appendChild(label);
    fireBtn.title = "Open Transporter Control";

    fireBtn.addEventListener("mouseenter", () => {
      fireBtn.style.borderColor  = LC.primary;
      fireBtn.style.color        = LC.primary;
      fireBtn.style.background   = `rgba(255,153,0,0.12)`;
      iconEl.style.opacity       = "1";
    });
    fireBtn.addEventListener("mouseleave", () => {
      fireBtn.style.borderColor  = LC.borderDim;
      fireBtn.style.color        = LC.text;
      fireBtn.style.background   = `rgba(255,153,0,0.06)`;
      iconEl.style.opacity       = "0.75";
    });

    fireBtn.addEventListener("click", async () => {
      if (token) token.control({ releaseOthers: true });
      await game.sta2eToolkit?.openTransporter();
    });

    row.appendChild(fireBtn);
    section.appendChild(row);
    return section;
  }

  _buildSection(title) {
    const section = document.createElement("div");
    section.style.borderTop = `1px solid ${LC.borderDim}`;
    section.appendChild(lcarsSection(title));
    return section;
  }

  _actionButton(label, bgColor, borderColor) {
    const btn = document.createElement("button");
    btn.style.cssText = `
      padding: 4px 10px;
      background: ${bgColor};
      border: 1px solid ${borderColor};
      border-radius: 2px;
      color: ${borderColor};
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-family: ${LC.font};
      cursor: pointer;
      transition: opacity 0.15s;
    `;
    btn.textContent = label;
    btn.addEventListener("mouseenter", () => btn.style.opacity = "0.8");
    btn.addEventListener("mouseleave", () => btn.style.opacity = "1");
    return btn;
  }

  _iconBtnStyle() {
    return `
      background: none;
      border: none;
      color: ${LC.bg};
      font-size: 13px;
      cursor: pointer;
      padding: 0 2px;
      line-height: 1;
    `;
  }

  // ── Chat cards ─────────────────────────────────────────────────────────────

  _weaponChatCard(attacker, weapon, actor, targets, isHit, targetData = [], scanBonus = 0, scanPiercing = false) {
    const { total, breakdown } = this._weaponDamageBreakdown(weapon, actor);
    const range     = weapon.system?.range ?? "—";
    const qualities = this._weaponQualityString(weapon);
    const color     = isHit ? LC.green : LC.red;
    const result    = isHit ? "✓ HIT" : "✗ MISS";

    // Per-target damage rows
    const targetRows = isHit ? targetData.map(t => {
      const shieldAfter = Math.max(0, t.currentShields - t.finalDamage);
      const pctAfter    = t.maxShields > 0 ? shieldAfter / t.maxShields : 0;
      const shieldColor = pctAfter > 0.5 ? LC.green : pctAfter > 0.25 ? LC.yellow : LC.red;

      // Threshold warnings
      const warnings = [];
      if (t.currentShields === 0) {
        warnings.push("💥 BREACH — shields already down");
      } else if (shieldAfter === 0) {
        warnings.push("💥 BREACH — shields reduced to 0");
      } else if (pctAfter < 0.25 && t.shaken) {
        warnings.push("💥 BREACH — punched through (already shaken at 25%)");
      } else if (pctAfter < 0.25) {
        warnings.push("⚠️ SHAKEN — shields below 25%");
      } else if (pctAfter < 0.50) {
        warnings.push("⚠️ SHAKEN — shields below 50%");
      }

      const warningHtml = warnings.map(w => `
        <div style="margin-top:4px;padding:3px 6px;background:rgba(255,50,0,0.1);
          border-left:3px solid ${LC.red};font-size:10px;color:${LC.red};
          letter-spacing:0.06em;text-transform:uppercase;font-family:${LC.font};">
          ${w}
        </div>`).join("");

      // Encode target data for the Apply Damage button
      const highYield      = weapon?.system?.qualities?.highyield ?? false;
      const spread         = weapon?.system?.qualities?.spread     ?? false;
      const encodedData    = encodeURIComponent(JSON.stringify({
        tokenId:            t.tokenId,
        actorId:            t.actorId,
        finalDamage:        t.finalDamage,
        highYield,
        spread,
        area:               t.area ?? false,
        attackerTokenId:    t.attackerTokenId ?? null,
        attackerIsNpc:      t.attackerIsNpc ?? false,
        weaponImg:          weapon?.img ?? null,
        weaponName:         weapon?.name ?? null,
        targetingSystem:    t.targetingSystem ?? null,
        defenderSuccesses:  t.defenderSuccesses ?? null,
        opposedDefenseType: t.opposedDefenseType ?? null,
        attackerSuccesses:  t.attackerSuccesses ?? null,
      }));

      return `
        <div style="border:1px solid ${LC.border};border-left:3px solid ${LC.secondary};
          background:${LC.panel};border-radius:2px;padding:6px 8px;margin-bottom:5px;">
          <div style="font-size:11px;font-weight:700;color:${LC.secondary};margin-bottom:5px;
            letter-spacing:0.08em;text-transform:uppercase;font-family:${LC.font};">▶ ${t.name}</div>

          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-bottom:5px;text-align:center;">
            <div style="background:rgba(255,153,0,0.07);border:1px solid ${LC.borderDim};border-radius:2px;padding:3px;">
              <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">Weapon</div>
              <div style="font-size:15px;font-weight:700;color:${LC.tertiary};">${t.rawDamage - (scanBonus ?? 0) - (t.rapidFireBonus ?? 0) - (t.calibrateWeaponsBonus ?? 0)}${scanBonus ? `<span style="color:${LC.primary};font-size:10px;">+${scanBonus}</span>` : ""}${t.rapidFireBonus ? `<span style="color:${LC.green};font-size:10px;" title="Rapid-Fire Torpedo Launcher">+${t.rapidFireBonus}</span>` : ""}${t.calibrateWeaponsBonus ? `<span style="color:${LC.primary};font-size:10px;" title="Calibrate Weapons">+${t.calibrateWeaponsBonus}</span>` : ""}</div>
            </div>
            <div style="background:rgba(255,153,0,0.07);border:1px solid ${LC.borderDim};border-radius:2px;padding:3px;">
              <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">${scanPiercing ? "Resist" : "−Resist"}</div>
              <div style="font-size:15px;font-weight:700;color:${scanPiercing ? LC.textDim : LC.orange};">
                ${scanPiercing
                  ? `<span style="text-decoration:line-through">${t.resistance}</span>`
                  : (() => {
                      const base = t.resistance - (t.glancingBonus ?? 0) - (t.modulationBonus ?? 0);
                      const parts = [];
                      if (t.glancingBonus > 0)  parts.push(`<span style="color:${LC.green};font-size:10px;" title="Glancing Impact">+${t.glancingBonus}</span>`);
                      if (t.modulationBonus > 0) parts.push(`<span style="color:${LC.primary};font-size:10px;" title="Modulated Shields">+${t.modulationBonus}</span>`);
                      return base + (parts.length ? parts.join("") : "");
                    })()}
              </div>
            </div>
            <div style="background:rgba(204,136,255,0.1);border:1px solid ${LC.secondary};border-radius:2px;padding:3px;">
              <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">Final</div>
              <div style="font-size:18px;font-weight:700;color:${LC.textBright};">${t.finalDamage}</div>
            </div>
          </div>

          <div style="font-size:10px;color:${LC.textDim};margin-bottom:5px;text-align:center;font-family:${LC.font};">
            SHIELDS ${t.currentShields} → <span style="color:${shieldColor};font-weight:700;">${shieldAfter}</span> / ${t.maxShields}
          </div>

          ${warningHtml}

          <div class="sta2e-damage-controls" style="margin-top:5px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
              <label style="font-size:9px;color:${LC.textDim};white-space:nowrap;
                text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">Adj:</label>
              <input class="sta2e-extra-damage"
                type="number" value="0"
                data-base-payload="${encodedData}"
                style="width:44px;padding:2px 4px;background:${LC.bg};border:1px solid ${LC.border};
                       border-radius:2px;color:${LC.text};font-size:12px;text-align:center;font-family:${LC.font};"/>
              <span class="sta2e-final-display" style="font-size:10px;color:${LC.textDim};font-family:${LC.font};">
                = <strong style="color:${LC.tertiary};">${t.finalDamage}</strong>
              </span>
            </div>
            <button class="sta2e-apply-damage"
              data-payload="${encodedData}"
              style="width:100%;padding:4px;background:${LC.secondary};border:none;
                     border-radius:2px;color:${LC.bg};font-size:10px;font-weight:700;
                     letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;font-family:${LC.font};">
              APPLY DAMAGE → ${t.name}
            </button>
          </div>
        </div>
      `;
    }).join("") : "";

    return lcarsCard(
      `${isHit ? "✓ HIT" : "✗ MISS"} — ${attacker} / ${weapon.name}`,
      isHit ? LC.primary : LC.red,
      `
        <div style="font-size:11px;color:${LC.textDim};margin-bottom:6px;font-family:${LC.font};letter-spacing:0.06em;">
          TARGET: ${targets} &nbsp;|&nbsp; RANGE: ${range.toUpperCase()}
        </div>

        ${isHit ? `
          ${breakdown ? `<div style="font-size:9px;color:${LC.textDim};margin-bottom:6px;font-family:${LC.font};">${breakdown}</div>` : ""}
          ${qualities !== "None" ? `<div style="font-size:10px;color:${LC.tertiary};margin-bottom:6px;font-family:${LC.font};">QUALITIES: ${qualities}</div>` : ""}
          ${scanPiercing ? `<div style="margin-bottom:6px;padding:3px 6px;border-left:3px solid ${LC.secondary};font-size:10px;color:${LC.secondary};font-family:${LC.font};">SCAN FOR WEAKNESS — PIERCING (RESISTANCE IGNORED)</div>` : ""}
          ${scanBonus > 0 ? `<div style="margin-bottom:6px;padding:3px 6px;border-left:3px solid ${LC.secondary};font-size:10px;color:${LC.secondary};font-family:${LC.font};">SCAN FOR WEAKNESS — +2 DAMAGE</div>` : ""}
          ${targetData.some(t => t.rapidFireBonus) ? `<div style="margin-bottom:6px;padding:3px 6px;border-left:3px solid ${LC.green};font-size:10px;color:${LC.green};font-family:${LC.font};">🚀 RAPID-FIRE TORPEDO LAUNCHER — +1 DAMAGE · Ship assist die may be re-rolled</div>` : ""}
          ${targetData.some(t => t.calibrateWeaponsBonus) ? `<div style="margin-bottom:6px;padding:3px 6px;border-left:3px solid ${LC.primary};font-size:10px;color:${LC.primary};font-family:${LC.font};">🔩 CALIBRATE WEAPONS — +1 DAMAGE</div>` : ""}
          ${targetData.some(t => t.glancingBonus) ? `<div style="margin-bottom:6px;padding:3px 6px;border-left:3px solid ${LC.green};font-size:10px;color:${LC.green};font-family:${LC.font};">↗️ GLANCING IMPACT — +2 RESISTANCE (Evasive Action)</div>` : ""}
          ${targetData.some(t => t.tsRerollGranted) ? `<div style="margin-bottom:6px;padding:3px 6px;border-left:3px solid ${LC.primary};font-size:10px;color:${LC.primary};font-family:${LC.font};">🎯 TARGETING SOLUTION — Re-roll used on this attack${hasFastTargetingSystems(actor) ? " (Fast Targeting Systems: both benefits applied)" : ""}</div>` : ""}
          ${targetRows}
        ` : `
          <div style="font-size:11px;color:${LC.red};font-family:${LC.font};font-weight:700;letter-spacing:0.12em;margin-bottom:6px;">ATTACK MISSED — NO DAMAGE</div>
          ${(() => {
            // Show opposed result on miss — defender always wins on a miss
            const oppDef = targetData[0]?.opposedDefenseType ?? null;
            const defSucc = targetData[0]?.defenderSuccesses ?? null;
            const atkSucc = targetData[0]?.attackerSuccesses ?? null;
            if (!oppDef || defSucc === null) return "";
            const defLabel = oppDef === "evasive-action" ? "Evasive Action" : oppDef === "defensive-fire" ? "Defensive Fire" : "Cover";
            const defIcon  = oppDef === "evasive-action" ? "↗️" : oppDef === "defensive-fire" ? "🛡️" : "🪨";
            const defWinMargin = atkSucc !== null ? defSucc - atkSucc : null;
            // Pool button for defender (win margin = extra threat/momentum)
            const defenderActor = canvas.tokens?.get(targetData[0]?.tokenId)?.actor
              ?? game.actors?.get(targetData[0]?.actorId);
            const defenderIsNpcShip = CombatHUD.isNpcShip(defenderActor);
            const defPoolBtn = (defWinMargin !== null && defWinMargin > 0)
              ? poolButtonHtml(defenderIsNpcShip ? "threat" : "momentum", defWinMargin, targetData[0]?.tokenId ?? "")
              : "";
            const deltaLine = defWinMargin !== null
              ? `<div style="font-size:11px;font-weight:700;color:${LC.red};font-family:${LC.font};margin-top:4px;">
                  ✗ Defender wins — +${defWinMargin} ${defenderIsNpcShip ? "Threat" : "Momentum"}
                 </div>
                 ${defPoolBtn}`
              : `<div style="font-size:11px;font-weight:700;color:${LC.red};font-family:${LC.font};margin-top:4px;">
                  ✗ Defender wins (attack missed)
                 </div>`;
            const counterBtn = oppDef !== null && oppDef !== "evasive-action" && (defWinMargin === null || defWinMargin > 0)
              ? `<div style="margin-top:5px;">
                  <button class="sta2e-defensive-counterattack"
                    data-payload="${encodeURIComponent(JSON.stringify({
                      attackerTokenId: targetData[0]?.attackerTokenId ?? null,
                      defenderTokenId: targetData[0]?.tokenId ?? null,
                      defenderActorId: targetData[0]?.actorId ?? null,
                      opposedDefenseType: oppDef,
                    }))}"
                    style="width:100%;padding:4px;background:rgba(255,80,80,0.12);
                      border:1px solid ${LC.red};border-radius:2px;
                      color:${LC.red};font-size:10px;font-weight:700;
                      letter-spacing:0.08em;text-transform:uppercase;
                      cursor:pointer;font-family:${LC.font};">
                    ⚡ COUNTERATTACK (2 Momentum)
                  </button>
                 </div>`
              : "";
            return `<div style="padding:6px 8px;border:1px solid ${LC.border};
              border-left:3px solid ${LC.primary};border-radius:2px;
              background:rgba(255,153,0,0.04);">
              <div style="font-size:11px;font-weight:700;color:${LC.primary};
                font-family:${LC.font};letter-spacing:0.06em;text-transform:uppercase;margin-bottom:5px;">
                ${defIcon} Opposed — ${defLabel}
              </div>
              <div style="font-size:11px;font-family:${LC.font};margin-bottom:3px;">
                <span style="color:${LC.textDim};">Defender: </span>
                <strong style="color:${LC.tertiary};">${defSucc} success${defSucc !== 1 ? "es" : ""}</strong>
                ${atkSucc !== null ? `&nbsp;·&nbsp;<span style="color:${LC.textDim};">Attacker: </span><strong style="color:${LC.tertiary};">${atkSucc} success${atkSucc !== 1 ? "es" : ""}</strong>` : ""}
              </div>
              ${deltaLine}
              ${counterBtn}
            </div>`;
          })()}
        `}
      `
    );
  }

  _conditionChatCard(actor, target, conditionName, icon, description, removed = false) {
    const color  = removed ? LC.red : LC.primary;
    const verb   = removed ? "CLEARED" : "ACTIVE";
    return lcarsCard(
      `${conditionName} — ${verb}`,
      color,
      `
        <div style="font-size:11px;font-weight:700;color:${LC.tertiary};margin-bottom:4px;font-family:${LC.font};">
          ${actor}${target ? ` → ${target}` : ""}
        </div>
        <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">${description}</div>
      `
    );
  }

  _ramChatCard(attacker, target, atkDmg, defDmg) {
    return lcarsCard("💥 RAMMING SPEED", LC.red, `
      <div style="font-size:11px;color:${LC.textDim};margin-bottom:6px;font-family:${LC.font};letter-spacing:0.06em;">
        ${attacker.toUpperCase()} RAMS ${target.toUpperCase()}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        <div style="background:rgba(255,51,51,0.08);border:1px solid ${LC.red};border-radius:2px;padding:6px;text-align:center;">
          <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">DEALS TO ${target.toUpperCase()}</div>
          <div style="font-size:18px;font-weight:700;color:${LC.red};">${atkDmg}</div>
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">+ INTENSE</div>
        </div>
        <div style="background:rgba(255,102,0,0.08);border:1px solid ${LC.orange};border-radius:2px;padding:6px;text-align:center;">
          <div style="font-size:9px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">TAKES FROM ${target.toUpperCase()}</div>
          <div style="font-size:18px;font-weight:700;color:${LC.orange};">${defDmg}</div>
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">+ INTENSE</div>
        </div>
      </div>
    `);
  }

  // ── Drag ───────────────────────────────────────────────────────────────────

  _makeDraggable() {
    const handle = this._el?.querySelector(".sta2e-chud-header");
    if (!handle || !this._el) return;

    let startX, startY, startLeft, startTop;

    const onMouseMove = (e) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      this._el.style.left = `${startLeft + dx}px`;
      this._el.style.top  = `${startTop  + dy}px`;
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup",   onMouseUp);
      handle.style.cursor = "grab";
      this._savePos(
        parseInt(this._el.style.left),
        parseInt(this._el.style.top)
      );
    };

    handle.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      e.preventDefault();
      startX    = e.clientX;
      startY    = e.clientY;
      startLeft = parseInt(this._el.style.left) || 100;
      startTop  = parseInt(this._el.style.top)  || 100;
      handle.style.cursor = "grabbing";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup",   onMouseUp);
    });
  }

  // ── Position persistence ───────────────────────────────────────────────────

  _savePos(x, y) {
    localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
  }

  _loadPos() {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY));
      if (saved?.x != null) return saved;
    } catch {}
    return { x: window.innerWidth - 320, y: 80 };
  }

  // ── NPC Ship flag ──────────────────────────────────────────────────────────

  // ── Ship state helpers — stored on TOKEN document, not actor ─────────────
  // Each wildcard token instance is independent; the actor sheet is shared.

  static _tokenDocFor(actor) {
    // Synthetic actor (wildcard token) — parent is the TokenDocument
    if (actor.isToken && actor.token) return actor.token;
    // World actor — find first matching token on canvas
    const t = canvas.tokens?.placeables.find(
      pt => pt.actor === actor || pt.document?.actorId === actor.id
    );
    return t?.document ?? null;
  }

  /**
   * Get all canvas token placeables that belong to this specific actor instance.
   * For synthetic (unlinked/wildcard) actors, returns ONLY the one token that
   * owns this actor — prevents FX from bleeding to sibling wildcard tokens that
   * share the same base actor ID.
   * For world (linked) actors, returns all tokens on canvas for that actor.
   */
  static _tokensForActor(actor) {
    if (!canvas.tokens?.placeables) return [];
    if (actor.isToken && actor.token) {
      // Synthetic: match by token document ID — exact token only
      const tokenId = actor.token.id;
      return canvas.tokens.placeables.filter(t => t.document?.id === tokenId);
    }
    // Linked world actor: match all canvas tokens whose actorId matches
    return canvas.tokens.placeables.filter(
      t => t.actor === actor || t.document?.actorId === actor.id
    );
  }

  /**
   * Guard helper for player-ship station actions that require an assigned PC.
   * Returns true if it's safe to proceed (NPC ship, or player ship with officer present).
   * Returns false and fires a UI warning if it's a player ship with no officer at the station.
   */
  static _requiresPlayerOfficer(actor, stationId, stationLabel) {
    if (CombatHUD.isNpcShip(actor)) return true;
    const officers = getStationOfficers(actor, stationId);
    if (officers.length > 0) return true;
    ui.notifications.warn(
      `${actor.name}: No officer assigned to ${stationLabel} — assign a crew member in the Crew Manifest to use this action.`
    );
    return false;
  }

  static isNpcShip(actor) {
    // Check the actor itself first (covers world actors and already-flagged synthetics)
    if (actor.getFlag("sta2e-toolkit", "isNpcShip")) return true;
    // For unlinked/wildcard tokens, also check the base world actor so the flag
    // set on one token instance is visible to all other tokens from the same prototype
    if (actor.isToken) {
      const baseActor = game.actors.get(actor.id ?? actor._id);
      if (baseActor?.getFlag("sta2e-toolkit", "isNpcShip")) return true;
    }
    return false;
  }

  /**
   * Returns true when the actor is a ground-combat NPC (not a PC or supporting character).
   * PCs (STACharacterSheet2e) and supporting characters (STASupportingSheet2e) generate
   * Momentum on successful tasks; everything else (NPCs) generates Threat.
   */
  static isGroundNpcActor(actor) {
    return !CombatHUD.getGroundCombatProfile(actor).isPlayerOwned;
  }

  static _getBaseActor(actor, tokenDoc = null) {
    if (!actor) return null;
    const protoId = tokenDoc?.actorId ?? null;
    if (protoId) {
      const protoActor = game.actors.get(protoId);
      if (protoActor) return protoActor;
    }
    if (actor.isToken) {
      return game.actors.get(actor.id ?? actor._id) ?? null;
    }
    return null;
  }

  static getGroundCombatProfile(actor, tokenDoc = null) {
    if (!actor) {
      return { isPlayerOwned: false, npcType: "minor", isShip: false };
    }

    const isShip = actor.type === "starship" || actor.type === "spacecraft2e"
      || actor.items?.some(i => i.type === "starshipweapon2e");
    if (isShip) {
      return { isPlayerOwned: false, npcType: null, isShip: true };
    }

    const baseActor = CombatHUD._getBaseActor(actor, tokenDoc);
    const normalizeNpcType = (value) => {
      const v = `${value ?? ""}`.trim().toLowerCase();
      return v === "minor" || v === "notable" || v === "major" ? v : null;
    };

    const actorNpcType = normalizeNpcType(actor.system?.npcType);
    const baseNpcType  = normalizeNpcType(baseActor?.system?.npcType);
    const npcType      = actorNpcType ?? baseNpcType;

    const sheetClass = actor.sheet?.constructor?.name
      ?? baseActor?.sheet?.constructor?.name
      ?? "";
    const hasStressTrack = actor.system?.stress != null || baseActor?.system?.stress != null;
    const isPlayerSheet = sheetClass === "STACharacterSheet2e"
      || sheetClass === "STASupportingSheet2e"
      || sheetClass === "STACharacterSheet";
    const isNpcSheet = /npc/i.test(sheetClass);
    const isCharacterActor = actor.type === "character" || baseActor?.type === "character";

    // Only trust explicit upper-tier NPC labels immediately. A default "minor" value
    // appears to be too broad in this system, so let player/supporting signals win first.
    if (npcType === "major" || npcType === "notable") {
      return { isPlayerOwned: false, npcType, isShip: false };
    }

    if (isNpcSheet) {
      return { isPlayerOwned: false, npcType: npcType ?? "minor", isShip: false };
    }

    if (isPlayerSheet || hasStressTrack) {
      return { isPlayerOwned: true, npcType: null, isShip: false };
    }

    if (npcType === "minor") {
      return { isPlayerOwned: false, npcType: "minor", isShip: false };
    }

    if (isNpcSheet || !isCharacterActor) {
      return { isPlayerOwned: false, npcType: "minor", isShip: false };
    }

    return { isPlayerOwned: false, npcType: "minor", isShip: false };
  }

  static getNpcPersonalThreat(actor, tokenDoc = null) {
    const mode = game.settings.get("sta2e-toolkit", "npcPersonalThreatSource") ?? "actor";
    const actorThreat = Number.isFinite(actor?.system?.stress?.value) ? actor.system.stress.value : 0;
    const tokenThreat = tokenDoc?.getFlag("sta2e-toolkit", "personalThreat") ?? 0;

    if (mode === "token") return tokenThreat;
    if (mode === "actor-then-token" || mode === "token-then-actor") return actorThreat + tokenThreat;
    return Number.isFinite(actor?.system?.stress?.value) ? actor.system.stress.value : tokenThreat;
  }

  static getNpcPersonalThreatMax(actor, tokenDoc = null) {
    const mode = game.settings.get("sta2e-toolkit", "npcPersonalThreatSource") ?? "actor";
    const actorThreatMax = Number.isFinite(actor?.system?.stress?.max) ? actor.system.stress.max : 0;
    const tokenThreat    = tokenDoc?.getFlag("sta2e-toolkit", "personalThreat") ?? 0;

    if (mode === "token") return tokenThreat;
    if (mode === "actor-then-token" || mode === "token-then-actor") return actorThreatMax + tokenThreat;
    return Number.isFinite(actor?.system?.stress?.max) ? actor.system.stress.max : tokenThreat;
  }

  static async setNpcPersonalThreat(actor, tokenDoc, value) {
    const next = Math.max(0, parseInt(value ?? 0) || 0);
    const mode = game.settings.get("sta2e-toolkit", "npcPersonalThreatSource") ?? "actor";
    const actorHasStore = actor?.system?.stress != null;
    const tokenHasStore = !!tokenDoc;
    let actorThreat = actorHasStore ? (actor.system?.stress?.value ?? 0) : 0;
    let tokenThreat = tokenHasStore ? (tokenDoc.getFlag("sta2e-toolkit", "personalThreat") ?? 0) : 0;
    const currentTotal = CombatHUD.getNpcPersonalThreat(actor, tokenDoc);
    let delta = next - currentTotal;

    const addToActor = () => { actorThreat = Math.max(0, actorThreat + delta); delta = 0; };
    const addToToken = () => { tokenThreat = Math.max(0, tokenThreat + delta); delta = 0; };
    const spendFromActor = () => {
      const spend = Math.min(actorThreat, Math.abs(delta));
      actorThreat -= spend;
      delta += spend;
    };
    const spendFromToken = () => {
      const spend = Math.min(tokenThreat, Math.abs(delta));
      tokenThreat -= spend;
      delta += spend;
    };

    const primaryIsActor = mode === "actor" || mode === "actor-then-token";
    const allowCombined  = mode === "actor-then-token" || mode === "token-then-actor";
    const addOrder = [];
    const spendOrder = [];

    if (primaryIsActor) {
      if (actorHasStore) { addOrder.push("actor"); spendOrder.push("actor"); }
      if (allowCombined && tokenHasStore) { addOrder.push("token"); spendOrder.push("token"); }
      else if (!allowCombined && !actorHasStore && tokenHasStore) { addOrder.push("token"); spendOrder.push("token"); }
    } else {
      if (tokenHasStore) { addOrder.push("token"); spendOrder.push("token"); }
      if (allowCombined && actorHasStore) { addOrder.push("actor"); spendOrder.push("actor"); }
      else if (!allowCombined && !tokenHasStore && actorHasStore) { addOrder.push("actor"); spendOrder.push("actor"); }
    }

    if (delta >= 0) {
      for (const target of addOrder) {
        if (delta <= 0) break;
        if (target === "actor") addToActor();
        else addToToken();
      }
    } else {
      for (const target of spendOrder) {
        if (delta >= 0) break;
        if (target === "actor") spendFromActor();
        else spendFromToken();
      }
    }

    if (actorHasStore) await actor.update({ "system.stress.value": actorThreat });
    if (tokenHasStore) await tokenDoc.setFlag("sta2e-toolkit", "personalThreat", tokenThreat);
    return next;
  }

  static async promptNpcThreatSplit(actor, tokenDoc, potency, tierLabel = "NPC") {
    const Tracker        = game.STATracker?.constructor;
    const currentThreat  = Tracker ? Tracker.ValueOf("threat") : 0;
    const personalThreat = CombatHUD.getNpcPersonalThreat(actor, tokenDoc);
    if ((personalThreat + currentThreat) < potency) return null;

    const initialPersonal = Math.min(personalThreat, potency);
    const initialPool     = potency - initialPersonal;
    let chosenPersonal    = initialPersonal;
    let chosenPool        = initialPool;

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: `${actor?.name ?? tierLabel} — Avoid Injury` },
      content: `
        <div style="font-family:${LC.font};padding:4px 0;display:flex;flex-direction:column;gap:10px;">
          <div style="font-size:11px;color:${LC.text};line-height:1.5;">
            Choose how this <strong style="color:${LC.tertiary};">Potency ${potency}</strong> injury is avoided.
            Split the cost between <strong style="color:${LC.orange};">Personal Threat</strong> and the
            <strong style="color:${LC.yellow};">Threat Pool</strong>.
          </div>
          <div style="font-size:10px;color:${LC.textDim};">
            Available: <span style="color:${LC.orange};">Personal ${personalThreat}</span>
            &nbsp;|&nbsp;
            <span style="color:${LC.yellow};">Pool ${currentThreat}</span>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:10px;color:${LC.textDim};margin-bottom:4px;">
              <span>Personal Threat</span><span id="sta2e-npc-personal-out">${initialPersonal}</span>
            </div>
            <input id="sta2e-npc-personal-range" type="range" min="0" max="${Math.min(personalThreat, potency)}" value="${initialPersonal}"
              style="width:100%;accent-color:${LC.orange};" />
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:10px;color:${LC.textDim};margin-bottom:4px;">
              <span>Threat Pool</span><span id="sta2e-npc-pool-out">${initialPool}</span>
            </div>
            <input id="sta2e-npc-pool-range" type="range" min="0" max="${Math.min(currentThreat, potency)}" value="${initialPool}"
              style="width:100%;accent-color:${LC.yellow};" />
          </div>
          <div style="font-size:10px;color:${LC.textDim};">
            Selected total: <strong id="sta2e-npc-split-total" style="color:${LC.text};">${potency}</strong> / ${potency}
          </div>
        </div>`,
      buttons: [
        {
          action: "apply",
          label: "Apply Split",
          icon: "fas fa-sliders",
          default: true,
          callback: (event, button, dlg) => {
            const el = dlg.element ?? button.closest(".app.dialog-v2");
            chosenPersonal = Math.max(0, parseInt(el?.querySelector("#sta2e-npc-personal-range")?.value ?? "0") || 0);
            chosenPool     = Math.max(0, parseInt(el?.querySelector("#sta2e-npc-pool-range")?.value ?? "0") || 0);
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
      render: (event, dlg) => {
        const el = dlg.element;
        const personalRange = el?.querySelector("#sta2e-npc-personal-range");
        const poolRange     = el?.querySelector("#sta2e-npc-pool-range");
        const personalOut   = el?.querySelector("#sta2e-npc-personal-out");
        const poolOut       = el?.querySelector("#sta2e-npc-pool-out");
        const totalOut      = el?.querySelector("#sta2e-npc-split-total");
        if (!(personalRange && poolRange && personalOut && poolOut && totalOut)) return;

        const clampPair = (source) => {
          let personal = Math.max(0, Math.min(personalThreat, parseInt(personalRange.value ?? "0") || 0));
          let pool     = Math.max(0, Math.min(currentThreat, parseInt(poolRange.value ?? "0") || 0));

          if (source === "personal") {
            pool = Math.max(0, Math.min(currentThreat, potency - personal));
            personal = potency - pool;
          } else if (source === "pool") {
            personal = Math.max(0, Math.min(personalThreat, potency - pool));
            pool = potency - personal;
          }

          if ((personal + pool) !== potency) {
            const missing = potency - (personal + pool);
            if (source === "personal" && pool + missing <= currentThreat) pool += missing;
            else if (source === "pool" && personal + missing <= personalThreat) personal += missing;
          }

          personalRange.value = String(personal);
          poolRange.value     = String(pool);
          personalOut.textContent = String(personal);
          poolOut.textContent     = String(pool);
          totalOut.textContent    = String(personal + pool);
        };

        personalRange.addEventListener("input", () => clampPair("personal"));
        poolRange.addEventListener("input", () => clampPair("pool"));
        clampPair("personal");
      },
    });

    if (result !== "apply") return null;
    if ((chosenPersonal + chosenPool) !== potency) return null;
    if (chosenPersonal > personalThreat || chosenPool > currentThreat) return null;
    return {
      personalThreat,
      currentThreat,
      spendPersonal: chosenPersonal,
      spendPool: chosenPool,
    };
  }

  /**
   * Add momentum or threat to the STA tracker pool.
   * For momentum: enforces the cap (default 6) and posts an overflow chat card
   * for any excess that must be spent immediately or lost.
   * For threat: no cap — just adds.
   * @param {"momentum"|"threat"} pool
   * @param {number} amount
   * @param {Token|null} speakerToken  Used as the chat speaker for overflow cards.
   */
  /**
   * Add momentum or threat via the STA system's own STATracker API.
   * STATracker.DoUpdateResource handles GM/player permission routing,
   * updates the tracker DOM, and syncs all clients via the 'system.sta' socket.
   * We calculate the cap here so we can post an overflow card for excess momentum.
   */
  static async _applyToPool(pool, amount, speakerToken = null) {
    if (amount <= 0) return;
    try {
      // Access the static methods via the instance Foundry creates at renderSidebar
      const Tracker = game.STATracker?.constructor;
      if (!Tracker) {
        ui.notifications?.warn("STA Tracker not available — cannot update pool.");
        return;
      }

      if (pool === "momentum") {
        const current  = Tracker.ValueOf("momentum");
        const max      = Tracker.LimitOf("momentum");
        const canAdd   = Math.max(0, Math.min(amount, max - current));
        const overflow = amount - canAdd;

        if (canAdd > 0) {
          await Tracker.DoUpdateResource("momentum", current + canAdd);
        }

        if (overflow > 0) {
          const { LC } = game.sta2eToolkit ?? {};
          const secondary = LC?.secondary ?? "#cc88ff";
          const tertiary  = LC?.tertiary  ?? "#ffcc66";
          const textDim   = LC?.textDim   ?? "#888";
          const bg        = LC?.bg        ?? "#1a1a1a";
          const font      = LC?.font      ?? "var(--font-primary)";
          await ChatMessage.create({
            content: `
              <div style="background:${bg};border:2px solid ${secondary};border-radius:3px;
                overflow:hidden;font-family:${font};">
                <div style="background:${secondary};color:${bg};font-size:9px;font-weight:700;
                  letter-spacing:0.15em;text-transform:uppercase;padding:3px 10px;">
                  ⚡ MOMENTUM OVERFLOW
                </div>
                <div style="padding:8px 10px;">
                  <div style="font-size:11px;font-weight:700;color:${tertiary};
                    margin-bottom:4px;">Pool at maximum (${max})</div>
                  <div style="font-size:10px;color:white;line-height:1.6;">
                    <strong style="color:${secondary};font-size:14px;">${overflow}</strong>
                    excess Momentum cannot be banked.<br>
                    <span style="color:${textDim};">Must be spent immediately or it is lost.</span>
                  </div>
                </div>
              </div>`,
            speaker: ChatMessage.getSpeaker({ token: speakerToken }),
          });
        }
      } else {
        // Threat — no cap enforced here; LimitOf returns 99
        const current = Tracker.ValueOf("threat");
        await Tracker.DoUpdateResource("threat", current + amount);
      }
    } catch(e) {
      console.error("STA2e Toolkit | _applyToPool error:", e);
      ui.notifications?.error("Could not update tracker pool — see console.");
    }
  }

  // ── Warp Core Breach flag — token-scoped ─────────────────────────────────

  static getWarpBreachState(actor) {
    const td = CombatHUD._tokenDocFor(actor);
    if (td) return td.getFlag("sta2e-toolkit", "warpBreachImminent") ?? false;
    return actor.getFlag("sta2e-toolkit", "warpBreachImminent") ?? false;
  }

  static async setWarpBreachState(actor, state) {
    const td = CombatHUD._tokenDocFor(actor);
    if (td) await td.setFlag("sta2e-toolkit", "warpBreachImminent", state);
    else     await actor.setFlag("sta2e-toolkit", "warpBreachImminent", state);
    // Start or stop the persistent FX — scope to exact token for wildcards
    const tokens = CombatHUD._tokensForActor(actor);
    for (const token of tokens) {
      if (state) CombatHUD._startBreachTrailFX(token);
      else        CombatHUD._stopBreachTrailFX(token);
    }
  }

  // ── Persistent warp core breach smoke trail ────────────────────────────────
  // Uses Sequencer .persist() + .attachTo() so the effect follows the token
  // as it moves. Named with the token id so it can be stopped precisely.

  static _breachEffectName(token) {
    return `sta2e-breach-trail-${token.id}`;
  }

  /**
   * Play a persistent JB2A steam effect on the token to indicate warp core
   * breach imminent. Uses Sequencer .persist() + .attachTo() so the effect
   * follows the token as it moves. Stays until _stopBreachTrailFX is called.
   */
  static async _startBreachTrailFX(token) {
    if (!window.Sequencer) return;
    try {
      if (!game.settings.get("sta2e-toolkit", "breachTrailFX")) return;
    } catch { return; }

    const effectName = CombatHUD._breachEffectName(token);

    // Don't double-stack if already playing
    if (Sequencer.EffectManager.getEffects({ name: effectName }).length > 0) return;

    try {
      // Corner-alignment offset: the JB2A steam animation's visual source (where steam
      // originates) is at the bottom-left corner of the animation frame, not the center.
      // scaleToObject(2) scales the frame to ~2× the token size, so the half-frame is
      // ~1 token-height in each axis.  Shifting the effect center by (+tokenH, -tokenH)
      // in grid units moves the bottom-left corner to the token's center position —
      // making the steam appear to vent outward from the ship's body.
      const tokenH = token.document?.height ?? 1;  // height in grid squares

      const _breachAnimPath = (() => {
        try { return game.settings.get("sta2e-toolkit", "animationOverrides")
          ?.shipTasks?.warpCoreBreach?.anim || "jb2a.fumes.steam.white"; }
        catch { return "jb2a.fumes.steam.white"; }
      })();
      await new Sequence()
        .effect()
          .file(_breachAnimPath)
          .attachTo(token, { offset: { x: tokenH, y: -tokenH }, gridUnits: true })
          .belowTokens()
          .persist()
          .name(effectName)
          .scaleToObject(2)
          .fadeIn(500)
          .fadeOut(500)
        .play();
    } catch(e) {
      console.warn("STA2e Toolkit | Breach trail FX failed:", e);
    }
  }

  /**
   * Stop the persistent warp core breach steam effect on this token.
   */
  static async _stopBreachTrailFX(token) {
    if (!window.Sequencer) return;
    try {
      await Sequencer.EffectManager.endEffects({ name: CombatHUD._breachEffectName(token) });
    } catch(e) {
      console.warn("STA2e Toolkit | Could not stop breach trail FX:", e);
    }
  }

  /**
   * Check if warp breach conditions are met:
   *   1. Ship is at critical damage (totalBreaches > scale)
   *   2. Engines system is destroyed (engines.breaches >= ceil(scale/2))
   * If both true and not already flagged, set the flag and post the warning card.
   */
  /**
   * Roll the d20 breach check for a ship.
   * Fires automatically at round start for all breach-flagged ships,
   * or manually via the HUD breach panel.
   * @returns {"exploded"|"safe"} result
   */
  static async rollBreachCheck(actor, token) {
    if (!CombatHUD.getWarpBreachState(actor)) return "safe";

    const engRating = actor.system?.systems?.engines?.value ?? 0;
    const scale     = actor.system?.scale ?? 0;
    const roll      = Math.ceil(Math.random() * 20);
    const explodes  = roll > engRating;

    if (explodes) {
      // ── BREACH — ship explodes ──────────────────────────────────────────
      await CombatHUD.setWarpBreachState(actor, false);
      await CombatHUD.setShipStatus(actor, "destroyed");

      ChatMessage.create({
        content: lcarsCard("💥 WARP CORE BREACH", LC.red, `
          <div style="font-size:16px;font-weight:700;color:${LC.red};
            font-family:${LC.font};margin-bottom:6px;letter-spacing:0.08em;">
            ${actor.name.toUpperCase()}
          </div>
          <div style="font-size:11px;color:${LC.textBright};font-family:${LC.font};margin-bottom:6px;">
            Breach roll: <strong style="font-size:16px;color:${LC.red};">${roll}</strong>
            vs Engineering ${engRating} — <strong style="color:${LC.red};">BREACH</strong>
          </div>
          <div style="font-size:10px;color:${LC.text};font-family:${LC.font};margin-bottom:4px;">
            The reactor explodes. <strong>All crew aboard are killed.</strong>
          </div>
          <div style="font-size:10px;color:${LC.orange};font-family:${LC.font};">
            All ships within Close range suffer
            <strong>${scale + 1} damage with Piercing</strong>.
          </div>
        `),
        speaker: { alias: "STA2e Toolkit" },
      });

      if (token) {
        CombatHUD._stopBreachTrailFX(token);
        await CombatHUD.fireDestructionEffect(token);
      }

    } else {
      // ── SAFE this round ─────────────────────────────────────────────────
      ChatMessage.create({
        content: lcarsCard("☢ BREACH CHECK — CONTAINED", LC.yellow, `
          <div style="font-size:12px;font-weight:700;color:${LC.textBright};
            font-family:${LC.font};margin-bottom:4px;">${actor.name}</div>
          <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            Breach roll: <strong style="font-size:16px;color:${LC.green};">${roll}</strong>
            vs Engineering ${engRating} — <strong style="color:${LC.green};">CONTAINED</strong>
          </div>
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};margin-top:3px;">
            Reactor holding — for now. Roll again next round.
          </div>
        `),
        speaker: { alias: "STA2e Toolkit" },
      });
    }

    return explodes ? "exploded" : "safe";
  }

  // ── Hull Repair Dialog ────────────────────────────────────────────────────

  /**
   * Opens a repair dialog listing each breached system with options to:
   *   - Repair one breach on a specific system (−1 breach)
   *   - Fully repair a specific system (→ 0 breaches)
   *   - Repair all systems at once (all → 0)
   * Also clears breach TokenMagic FX and warp core breach trail if applicable.
   */
  static async _openRepairDialog(actor) {
    const SYSTEMS        = ["communications","computers","engines","sensors","structure","weapons"];
    const scale          = actor.system?.scale ?? 1;
    const destroyThresh  = Math.ceil(scale / 2);

    // Build per-system rows — only show systems with at least 1 breach
    const damaged = SYSTEMS
      .map(key => ({ key, breaches: actor.system?.systems?.[key]?.breaches ?? 0, label: CombatHUD.systemLabel(key) }))
      .filter(s => s.breaches > 0);

    if (!damaged.length) {
      ui.notifications.info("STA2e Toolkit: No hull breaches to repair.");
      return;
    }

    const totalBreaches = damaged.reduce((sum, s) => sum + s.breaches, 0);

    // Build dialog content — one row per damaged system
    const rows = damaged.map(s => {
      const isDestroyed = s.breaches >= destroyThresh;
      const color       = isDestroyed ? "#ff3333" : s.breaches >= 2 ? "#ff8800" : "#ffcc00";
      const pip         = `${"●".repeat(s.breaches)}${"○".repeat(Math.max(0, destroyThresh - s.breaches))}`;
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;
          padding:5px 8px;margin-bottom:3px;background:rgba(0,0,0,0.3);
          border:1px solid ${color};border-radius:2px;">
          <span style="font-size:11px;font-weight:700;color:${color};
            font-family:'Arial Narrow',sans-serif;letter-spacing:0.06em;
            text-transform:uppercase;min-width:110px;">
            ${isDestroyed ? "💀 " : ""}${s.label}
          </span>
          <span style="font-size:10px;color:${color};font-family:'Arial Narrow',sans-serif;
            min-width:70px;text-align:center;" title="${s.breaches}/${destroyThresh} breaches">
            ${pip} ${s.breaches}/${destroyThresh}
          </span>
          <span style="display:flex;gap:4px;">
            <button type="button"
              data-repair-one="${s.key}"
              style="padding:2px 7px;font-size:9px;font-weight:700;cursor:pointer;
                font-family:'Arial Narrow',sans-serif;letter-spacing:0.08em;
                background:rgba(0,60,0,0.4);border:1px solid #44aa44;
                border-radius:2px;color:#44aa44;"
              title="Remove 1 breach from ${s.label}">−1</button>
            <button type="button"
              data-repair-full="${s.key}"
              style="padding:2px 7px;font-size:9px;font-weight:700;cursor:pointer;
                font-family:'Arial Narrow',sans-serif;letter-spacing:0.08em;
                background:rgba(0,80,0,0.4);border:1px solid #66cc66;
                border-radius:2px;color:#66cc66;"
              title="Fully repair ${s.label} (remove all ${s.breaches} breaches)">REPAIR</button>
          </span>
        </div>`;
    }).join("");

    const content = `
      <div style="padding:6px 0;font-family:'Arial Narrow',sans-serif;">
        <div style="font-size:9px;color:#668866;letter-spacing:0.12em;
          text-transform:uppercase;margin-bottom:8px;">
          ${actor.name} · ${totalBreaches} total breach${totalBreaches !== 1 ? "es" : ""}
        </div>
        ${rows}
      </div>`;

    // Show dialog — buttons are wired via setTimeout after render
    let repairAction = null;

    const dialog = new foundry.applications.api.DialogV2({
      window: { title: `🔧 Hull Repair — ${actor.name}` },
      content,
      buttons: [
        {
          action:   "repairAll",
          label:    "🔧 Repair All Systems",
          icon:     "fas fa-wrench",
          default:  false,
          callback: () => { repairAction = "all"; },
        },
        {
          action:   "clearStrain",
          label:    "💥 Clear All Strain",
          icon:     "fas fa-bolt",
          default:  false,
          callback: () => { repairAction = "clearStrain"; },
        },
        {
          action:   "close",
          label:    "Close",
          icon:     "fas fa-times",
          default:  true,
        },
      ],
    });

    // Wire per-system buttons via setTimeout after render
    let dialogResult = null;
    const renderPromise = new Promise(resolve => {
      Hooks.once("renderDialogV2", (app) => {
        if (app !== dialog) return;
        resolve();
      });
    });
    dialog.render(true);
    await renderPromise;
    setTimeout(() => {
      const el = dialog.element ?? document.querySelector(".app.dialog-v2");
      if (!el) return;

      el.querySelectorAll("[data-repair-one]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const key      = btn.dataset.repairOne;
          const cur      = actor.system?.systems?.[key]?.breaches ?? 0;
          const newCount = cur - 1;
          if (cur > 0) await actor.update({ [`system.systems.${key}.breaches`]: newCount });

          // If breaches remain, downgrade the injury icon to the new severity tier
          if (newCount > 0) {
            const scale      = actor.system?.scale ?? 1;
            const label      = CombatHUD.systemLabel(key);
            const injuryName = `Breach: ${label}`;
            const item       = actor.items.find(i => i.type === "injury" && i.name === injuryName);
            if (item) {
              const newIcon = CombatHUD.systemDamageIcon(key, newCount, scale);
              await item.update({ img: newIcon, "system.quantity": newCount });
            }
          }

          // Clear patch if this system is now fully repaired or had its only breach removed
          // A patch on a system with 0 breaches is meaningless
          if (newCount === 0) {
            await CombatHUD.unpatchSystem(actor, key);
            game.sta2eToolkit?.combatHud?._refresh?.();
          }
          // Only delete the injury item if this was the last breach on this system
          const repairedSystems = (newCount === 0) ? [key] : [];
          await CombatHUD._afterRepair(actor, repairedSystems);
          try { dialog.close(); } catch {}
        });
      });

      el.querySelectorAll("[data-repair-full]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const key = btn.dataset.repairFull;
          await actor.update({ [`system.systems.${key}.breaches`]: 0 });
          await CombatHUD.unpatchSystem(actor, key);
          game.sta2eToolkit?.combatHud?._refresh?.();
          await CombatHUD._afterRepair(actor, [key]);
          try { dialog.close(); } catch {}
        });
      });
    }, 50);

    // Wait for the dialog to close (footer button click or X)
    await new Promise(resolve => {
      Hooks.on("closeDialogV2", function onClose(app) {
        if (app !== dialog) return;
        Hooks.off("closeDialogV2", onClose);
        resolve();
      });
    });
    const result = null; // unused, repairAction is set by button callbacks

    // Handle Clear All Power Strain
    if (repairAction === "clearStrain") {
      const SYSTEMS = ["communications","computers","engines","sensors","structure","weapons"];
      const DEPTS   = ["command","conn","engineering","security","medicine","science"];
      let cleared = 0;

      // Clear power strain on systems
      for (const key of SYSTEMS) {
        const label = CombatHUD.systemLabel(key);
        const item  = actor.items.find(i => i.type === "injury" && i.name === `Power Strain: ${label}`);
        if (item) { await actor.deleteEmbeddedDocuments("Item", [item.id]); cleared++; }
      }
      // Clear dept strain on departments
      for (const key of DEPTS) {
        const label = CombatHUD.deptLabel(key);
        const item  = actor.items.find(i => i.type === "injury" && i.name === `Dept Strain: ${label}`);
        if (item) { await actor.deleteEmbeddedDocuments("Item", [item.id]); cleared++; }
      }

      if (cleared > 0) {
        ChatMessage.create({
          content: lcarsCard("💥 ALL STRAIN CLEARED", LC.primary, `
            <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
              margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
            <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
              All strain complications cleared (${cleared} total).
              System and department complication ranges restored to normal.
            </div>`),
          speaker: { alias: "STA2e Toolkit" },
        });
      } else {
        ui.notifications.info("STA2e Toolkit: No strain complications found.");
      }
      game.sta2eToolkit?.combatHud?._refresh?.();
    }

    // Handle Repair All button
    if (repairAction === "all") {
      const updates = {};
      SYSTEMS.forEach(key => { updates[`system.systems.${key}.breaches`] = 0; });
      await actor.update(updates);
      // Clear all patches — full repair makes them irrelevant
      await CombatHUD.setPatchedBreaches(actor, {});
      await CombatHUD._afterRepair(actor, SYSTEMS);
    }
  }

  /**
   * After any repair action: rebuild breach splash FX, clear warp breach trail
   * if no breaches remain, delete matching breach injury items, post repair card.
   *
   * @param {Actor}    actor               - The ship actor
   * @param {string[]} repairedSystemKeys  - System keys whose injuries should be removed
   */
  static async _afterRepair(actor, repairedSystemKeys = []) {
    // Recount total breaches from the updated actor
    const updatedActor   = actor;
    const totalRemaining = Object.values(updatedActor.system?.systems ?? {})
      .reduce((sum, s) => sum + (s.breaches ?? 0), 0);

    // Rebuild splash FX to match new breach count
    CombatHUD._clearBreachTokenFX(updatedActor);
    for (let i = 1; i <= totalRemaining; i++) {
      CombatHUD._applyBreachTokenFX(updatedActor, i);
    }

    // Clear patches for repaired systems — a fully repaired system has no
    // breaches left so its patch flag is meaningless and should be removed
    if (repairedSystemKeys.length) {
      for (const key of repairedSystemKeys) {
        await CombatHUD.unpatchSystem(updatedActor, key);
      }
      game.sta2eToolkit?.combatHud?._refresh?.();
    }

    // Delete breach injury items for each fully-repaired system
    if (repairedSystemKeys.length) {
      const injuriesToDelete = updatedActor.items.filter(item => {
        if (item.type !== "injury") return false;
        return repairedSystemKeys.some(key => {
          const label = CombatHUD.systemLabel(key);
          return item.name === `Breach: ${label}`;
        });
      }).map(i => i.id);

      if (injuriesToDelete.length) {
        await updatedActor.deleteEmbeddedDocuments("Item", injuriesToDelete);
      }
    }

    // If all breaches cleared, also clear the warp core breach trail + flag
    if (totalRemaining === 0) {
      if (CombatHUD.getWarpBreachState(updatedActor)) {
        await CombatHUD.setWarpBreachState(updatedActor, false);
      }
      // Clear breach trail FX directly on all tokens too (belt-and-suspenders)
      const tokens = CombatHUD._tokensForActor(updatedActor);
      for (const token of tokens) CombatHUD._stopBreachTrailFX(token);

      // Reset ship status to active if it was disabled (not destroyed)
      const status = CombatHUD.getShipStatus(updatedActor);
      if (status === "disabled") await CombatHUD.setShipStatus(updatedActor, "active");
    }

    // Post repair chat card
    ChatMessage.create({
      content: lcarsCard("🔧 HULL REPAIRS", LC.green, `
        <div style="font-size:12px;font-weight:700;color:${LC.green};
          margin-bottom:4px;font-family:${LC.font};">${updatedActor.name}</div>
        <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
          ${totalRemaining === 0
            ? "All hull breaches repaired. Ship systems nominal."
            : `Partial repairs complete. ${totalRemaining} breach${totalRemaining !== 1 ? "es" : ""} remaining.`}
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
  }

  // ── Regain Power combat-use tracking ─────────────────────────────────────
  // Difficulty increases by 1 per use during combat. Cleared by deleteCombat hook.

  static _regainPowerDoc(actor) {
    // Per-token for unlinked wildcards, world actor for linked
    if (actor.isToken && actor.token && !actor.token.isLinked) return actor.token;
    return actor.isToken ? (game.actors.get(actor.id ?? actor._id) ?? actor) : actor;
  }

  static getRegainPowerUses(actor) {
    return CombatHUD._regainPowerDoc(actor)?.getFlag("sta2e-toolkit", "regainPowerUses") ?? 0;
  }

  static async incrementRegainPowerUses(actor) {
    const doc = CombatHUD._regainPowerDoc(actor);
    const cur = CombatHUD.getRegainPowerUses(actor);
    await doc?.setFlag("sta2e-toolkit", "regainPowerUses", cur + 1);
  }

  // ── Reserve power on actor sheet ──────────────────────────────────────────
  // STA 2e stores power as actor.system.power (a number, > 0 = has reserve power)

  // Reserve Power in STA 2e is a checkbox on the ship sheet.
  // The exact field path varies — we check known locations in priority order,
  // then fall back to our own toolkit flag set when Regain Power succeeds.
  // ── Modulated Shields tracking ───────────────────────────────────────────
  // Boolean flag — set when Modulate Shields is used, cleared when consumed
  // by the next incoming attack or manually by the GM.

  static getModulatedShields(actor) {
    const doc = actor.isToken && actor.token && !actor.token.isLinked
      ? actor.token
      : actor.isToken ? (game.actors.get(actor.id ?? actor._id) ?? actor) : actor;
    return !!doc?.getFlag("sta2e-toolkit", "modulatedShields");
  }

  static async setModulatedShields(actor, value) {
    const doc = actor.isToken && actor.token && !actor.token.isLinked
      ? actor.token
      : actor.isToken ? (game.actors.get(actor.id ?? actor._id) ?? actor) : actor;
    if (value) {
      await doc?.setFlag("sta2e-toolkit", "modulatedShields", true);
    } else {
      await doc?.unsetFlag("sta2e-toolkit", "modulatedShields").catch(() => {});
    }
  }

  // ── Rerouted Power tracking ───────────────────────────────────────────────
  // Per-system flag — set when Reserve Power is rerouted to a system,
  // cleared automatically when the next task using that system is resolved.
  // Stored as individual flags: "reroutedPower_weapons", etc.

  static _rerouteDoc(actor) {
    if (actor.isToken && actor.token && !actor.token.isLinked) return actor.token;
    return actor.isToken ? (game.actors.get(actor.id ?? actor._id) ?? actor) : actor;
  }

  static getReroutedPower(actor, systemKey) {
    return !!CombatHUD._rerouteDoc(actor)?.getFlag("sta2e-toolkit", `reroutedPower_${systemKey}`);
  }

  static async setReroutedPower(actor, systemKey, value) {
    const doc = CombatHUD._rerouteDoc(actor);
    if (value) {
      await doc?.setFlag("sta2e-toolkit", `reroutedPower_${systemKey}`, true);
    } else {
      await doc?.unsetFlag("sta2e-toolkit", `reroutedPower_${systemKey}`).catch(() => {});
    }
  }

  static async clearAllReroutedPower(actor) {
    const SYSTEMS = ["communications","computers","engines","sensors","structure","weapons"];
    const doc = CombatHUD._rerouteDoc(actor);
    for (const key of SYSTEMS) {
      await doc?.unsetFlag("sta2e-toolkit", `reroutedPower_${key}`).catch(() => {});
    }
  }

  // ── Tractor Beam tracking ────────────────────────────────────────────────
  // Stored on the tractoring token: { targetTokenId, targetName }
  // Stored on the target token: { sourceTokenId, sourceName } (so both know the state)

  static getTractorBeamState(token) {
    return token.document?.getFlag("sta2e-toolkit", "tractorBeam") ?? null;
  }

  static async engageTractorBeam(sourceToken, targetToken) {
    // Store the tow distance — target will sit behind the source at this distance,
    // dynamically recomputed as the source rotates.
    // "Behind" = opposite of the source's facing direction.
    // Distance = one source token width + half target width for a natural gap.
    const gridSize   = canvas.grid?.size ?? 100;
    const srcSize    = (sourceToken.document.width ?? 1) * gridSize;
    const tgtSize    = (targetToken.document.width ?? 1) * gridSize;
    const towDist    = srcSize * 0.5 + tgtSize * 0.5 + gridSize * 0.2;

    await sourceToken.document.setFlag("sta2e-toolkit", "tractorBeam", {
      targetTokenId: targetToken.id,
      targetName:    targetToken.name,
      towDist,
    });
    await targetToken.document.setFlag("sta2e-toolkit", "tractorBeam", {
      sourceTokenId: sourceToken.id,
      sourceName:    sourceToken.name,
    });
  }

  static _tractorEffectName(sourceToken) {
    return `sta2e-tractor-beam-${sourceToken.id}`;
  }

  static async playTractorBeamEffect(sourceToken, targetToken) {
    const effectName = CombatHUD._tractorEffectName(sourceToken);
    const tractorAnimPath = (() => {
      try { return game.settings.get("sta2e-toolkit", "animationOverrides")
        ?.shipTasks?.tractorBeam?.anim || "jb2a.energy_conduit.bluepurple.circle.01"; }
      catch { return "jb2a.energy_conduit.bluepurple.circle.01"; }
    })();
    const tractorSound = (() => {
      try { return game.settings.get("sta2e-toolkit", "sndTractorBeam") || ""; }
      catch { return ""; }
    })();
    try {
      const seq = new Sequence();
      if (tractorSound) {
        seq.sound().file(tractorSound).volume(0.8);
      }
      await seq
        .effect()
          .file(tractorAnimPath)
          .name(effectName)
          .attachTo(sourceToken)
          .stretchTo(targetToken, { attachTo: true })
          .persist()
          .fadeIn(500)
          .fadeOut(500)
          .playbackRate(0.8)
          .opacity(0.85)
        .play();
    } catch(e) {
      console.warn("STA2e | Tractor beam Sequencer effect failed:", e);
    }
  }

  static async stopTractorBeamEffect(sourceToken) {
    const effectName = CombatHUD._tractorEffectName(sourceToken);
    try {
      await Sequencer.EffectManager.endEffects({ name: effectName });
    } catch(e) {
      console.warn("STA2e | Tractor beam effect stop failed:", e);
    }
  }

  static async releaseTractorBeam(sourceToken, targetToken) {
    // If Token Attacher was managing movement, detach before clearing flags.
    const tractorState = CombatHUD.getTractorBeamState(sourceToken);
    if (tractorState?.usesTA && targetToken && _taAvailable()) {
      try { await window.tokenAttacher.detachElementFromToken(targetToken, sourceToken, true); } catch(e) {}
    }
    await sourceToken.document.unsetFlag("sta2e-toolkit", "tractorBeam").catch(() => {});
    if (targetToken) {
      await targetToken.document.unsetFlag("sta2e-toolkit", "tractorBeam").catch(() => {});
    }
    // Stop the persistent Sequencer beam effect
    if (sourceToken) await CombatHUD.stopTractorBeamEffect(sourceToken);
    // Clear TMFX glow on source
    if (sourceToken) {
      try { await TokenMagic.deleteFilters(sourceToken, "tractorBeam"); } catch {}
    }
  }

  // ── Armed Weapons / Shields state tracking ───────────────────────────────

  static getWeaponsArmed(actor) {
    const doc = actor.isToken && actor.token && !actor.token.isLinked
      ? actor.token : actor.isToken ? (game.actors.get(actor.id ?? actor._id) ?? actor) : actor;
    return !!doc?.getFlag("sta2e-toolkit", "weaponsArmed");
  }

  static async setWeaponsArmed(actor, value) {
    const doc = actor.isToken && actor.token && !actor.token.isLinked
      ? actor.token : actor.isToken ? (game.actors.get(actor.id ?? actor._id) ?? actor) : actor;
    if (value) await doc?.setFlag("sta2e-toolkit", "weaponsArmed", true);
    else        await doc?.unsetFlag("sta2e-toolkit", "weaponsArmed").catch(() => {});
  }

  static getShieldsLowered(actor) {
    const doc = actor.isToken && actor.token && !actor.token.isLinked
      ? actor.token : actor.isToken ? (game.actors.get(actor.id ?? actor._id) ?? actor) : actor;
    return !!doc?.getFlag("sta2e-toolkit", "shieldsLowered");
  }

  static async setShieldsLowered(actor, value, savedMax = null) {
    const doc = actor.isToken && actor.token && !actor.token.isLinked
      ? actor.token : actor.isToken ? (game.actors.get(actor.id ?? actor._id) ?? actor) : actor;
    if (value) {
      await doc?.setFlag("sta2e-toolkit", "shieldsLowered", true);
      if (savedMax !== null)
        await doc?.setFlag("sta2e-toolkit", "shieldsSavedMax", savedMax);
    } else {
      await doc?.unsetFlag("sta2e-toolkit", "shieldsLowered").catch(() => {});
      await doc?.unsetFlag("sta2e-toolkit", "shieldsSavedMax").catch(() => {});
    }
  }

  static getShieldsSavedMax(actor) {
    const doc = actor.isToken && actor.token && !actor.token.isLinked
      ? actor.token : actor.isToken ? (game.actors.get(actor.id ?? actor._id) ?? actor) : actor;
    return doc?.getFlag("sta2e-toolkit", "shieldsSavedMax") ?? null;
  }

  // STA 2e stores reserve power as actor.system.reservepower (boolean)
  static hasReservePower(actor) {
    return !!actor.system?.reservepower;
  }

  static async grantReservePower(actor) {
    await actor.update({ "system.reservepower": true });
  }

  static async clearReservePower(actor) {
    await actor.update({ "system.reservepower": false });
  }

  // ── Crew quality flag ─────────────────────────────────────────────────────
  // Stored on the world actor so it persists across scenes and all token instances.

  static getCrewQuality(actor) {
    const base = actor.isToken
      ? (game.actors.get(actor.id ?? actor._id) ?? actor)
      : actor;
    return base.getFlag("sta2e-toolkit", "crewQuality") ?? "proficient";
  }

  static async setCrewQuality(actor, quality) {
    const base = actor.isToken
      ? (game.actors.get(actor.id ?? actor._id) ?? actor)
      : actor;
    await base.setFlag("sta2e-toolkit", "crewQuality", quality);
  }

  static async toggleNpcShip(actor) {
    const current = CombatHUD.isNpcShip(actor);
    const newVal  = !current;

    // Always write to the base world actor so the flag persists on the prototype
    // and is inherited by every future wildcard token dropped from it
    const baseActor = actor.isToken
      ? (game.actors.get(actor.id ?? actor._id) ?? actor)
      : actor;
    await baseActor.setFlag("sta2e-toolkit", "isNpcShip", newVal);

    // If this is a synthetic (unlinked) token, also update the token's own
    // actor delta so the change is immediately visible without a reload
    if (actor.isToken && actor !== baseActor) {
      await actor.setFlag("sta2e-toolkit", "isNpcShip", newVal);
    }

    return newVal;
  }

  // Ship status: "active" | "disabled" | "destroyed"
  static getShipStatus(actor) {
    const td = CombatHUD._tokenDocFor(actor);
    if (td) return td.getFlag("sta2e-toolkit", "shipStatus") ?? "active";
    return actor.getFlag("sta2e-toolkit", "shipStatus") ?? "active";
  }

  static async setShipStatus(actor, status) {
    const td = CombatHUD._tokenDocFor(actor);
    if (td) await td.setFlag("sta2e-toolkit", "shipStatus", status);
    else     await actor.setFlag("sta2e-toolkit", "shipStatus", status);
  }

  // Targeting Solution: attacker has locked on, may choose system hit
  // Flag stores either false (inactive) or { active: true, benefit: "reroll"|"system"|"both"|null, system: string|null }
  static hasTargetingSolution(token) {
    const v = doc(token).getFlag("sta2e-toolkit", "targetingSolution") ?? false;
    if (!v) return false;
    // Support legacy boolean true stored by older versions
    if (v === true) return true;
    return v.active === true;
  }

  static getTargetingSolution(token) {
    const v = doc(token).getFlag("sta2e-toolkit", "targetingSolution") ?? null;
    if (!v) return null;
    // Normalise legacy boolean true → object with no benefit declared
    if (v === true) return { active: true, benefit: null, system: null };
    return v;
  }

  static async setTargetingSolution(token, value) {
    await doc(token).setFlag("sta2e-toolkit", "targetingSolution", value);
  }

  // Calibrate Sensors: on next Sensor Operations action, ignore a trait or re-roll 1d20
  static hasCalibratesensors(token) {
    return doc(token).getFlag("sta2e-toolkit", "calibrateSensors") ?? false;
  }

  static async setCalibratesensors(token, value) {
    await doc(token).setFlag("sta2e-toolkit", "calibrateSensors", value);
  }

  // Calibrate Weapons: on next attack, +1 damage
  static hasCalibrateWeapons(token) {
    return doc(token).getFlag("sta2e-toolkit", "calibrateWeapons") ?? false;
  }

  static async setCalibrateWeapons(token, value) {
    await doc(token).setFlag("sta2e-toolkit", "calibrateWeapons", value);
  }

  // ── Random System Hit ──────────────────────────────────────────────────────

  static rollSystemHit() {
    const roll = Math.ceil(Math.random() * 20);
    if (roll === 1)       return "communications";
    if (roll === 2)       return "computers";
    if (roll <= 6)        return "engines";
    if (roll <= 9)        return "sensors";
    if (roll <= 17)       return "structure";
    return "weapons";
  }

  static systemLabel(key) {
    return { communications: "Communications", computers: "Computers",
             engines: "Engines", sensors: "Sensors",
             structure: "Structure", weapons: "Weapons" }[key] ?? key;
  }

  // ── Patched breach tracking ──────────────────────────────────────────────
  // Patched breaches still exist on the sheet but impose no Difficulty penalty
  // until a new breach hits the same system (which unpatches all patches).
  // Stored as a flag: { communications: 1, weapons: 2, ... }

  static _patchStore(actor) {
    // Same scoping logic as crew manifest — token doc for unlinked, world actor for linked
    if (actor.isToken && actor.token && !actor.token.isLinked) return actor.token;
    return actor.isToken ? (game.actors.get(actor.id) ?? actor) : actor;
  }

  // Resolve the single authoritative document for patch storage.
  // Unlinked wildcard tokens → token document (per-instance).
  // Linked world actors → world actor (shared across all tokens).
  static _patchDoc(actor) {
    if (actor.isToken && actor.token && !actor.token.isLinked) return actor.token;
    const world = actor.isToken ? (game.actors.get(actor.id ?? actor._id) ?? actor) : actor;
    return world;
  }

  static getPatchedBreaches(actor) {
    return CombatHUD._patchDoc(actor)?.getFlag("sta2e-toolkit", "patchedBreaches") ?? {};
  }

  static async setPatchedBreaches(actor, map) {
    const doc = CombatHUD._patchDoc(actor);
    if (!doc) return;
    if (Object.keys(map).length === 0) {
      await doc.unsetFlag("sta2e-toolkit", "patchedBreaches").catch(() => {});
    } else {
      // Use update() directly — setFlag does a deep merge and cannot
      // overwrite an existing nested object with a replacement value.
      // Unset first to clear stale keys, then set the new map.
      await doc.unsetFlag("sta2e-toolkit", "patchedBreaches").catch(() => {});
      await doc.setFlag("sta2e-toolkit", "patchedBreaches", map).catch(() => {});
    }
  }

  static async patchSystemBreach(actor, systemKey, count = 1) {
    const current = CombatHUD.getPatchedBreaches(actor);
    const existing = current[systemKey] ?? 0;
    await CombatHUD.setPatchedBreaches(actor, {
      ...current,
      [systemKey]: existing + count,
    });
  }

  static async unpatchSystem(actor, systemKey) {
    const doc     = CombatHUD._patchDoc(actor);
    const current = doc?.getFlag("sta2e-toolkit", "patchedBreaches") ?? {};
    if (!current[systemKey]) return;

    // Foundry's setFlag does a deep merge — it cannot remove individual keys.
    // Use actor.update() with the "-=" deletion operator to explicitly remove
    // just the target key from the nested patchedBreaches object.
    await doc.update({
      [`flags.sta2e-toolkit.patchedBreaches.-=${systemKey}`]: null,
    }).catch(() => {});

    // If no patches remain, unset the whole flag cleanly
    const remaining = doc?.getFlag("sta2e-toolkit", "patchedBreaches") ?? {};
    if (Object.keys(remaining).length === 0) {
      await doc.unsetFlag("sta2e-toolkit", "patchedBreaches").catch(() => {});
    }
  }

  /**
   * Returns the breach penalty for a given system on an actor.
   *
   * Per STA 2e rules (p.303):
   *   - Each breach on a system adds +1 Difficulty to tasks using that system.
   *   - A destroyed system (breaches >= ceil(scale/2)) makes tasks auto-fail —
   *     represented here as difficultyPenalty = Infinity and isDestroyed = true.
   *   - If systemKey is null/undefined, returns a zero-penalty result.
   *
   * @param {Actor}  actor      - The ship actor.
   * @param {string} systemKey  - One of: communications, computers, engines,
   *                              sensors, structure, weapons. Null = no penalty.
   * @returns {{ breaches: number, destroyThreshold: number,
   *             difficultyPenalty: number, isDestroyed: boolean,
   *             label: string, penaltyNote: string|null }}
   */
  static getSystemBreachPenalty(actor, systemKey) {
    const zero = {
      breaches: 0, destroyThreshold: 0,
      difficultyPenalty: 0, isDestroyed: false,
      label: systemKey ? CombatHUD.systemLabel(systemKey) : "",
      penaltyNote: null,
    };

    if (!systemKey || !actor) return zero;

    const scale            = actor.system?.scale ?? 1;
    const destroyThreshold = Math.ceil(scale / 2);
    const totalBreaches    = actor.system?.systems?.[systemKey]?.breaches ?? 0;

    if (totalBreaches === 0) return { ...zero, destroyThreshold };

    // Patched breaches don't impose Difficulty penalties — subtract them
    const patched          = CombatHUD.getPatchedBreaches(actor)[systemKey] ?? 0;
    const effectiveBreaches = Math.max(0, totalBreaches - patched);
    const label            = CombatHUD.systemLabel(systemKey);

    // Destroyed = total (not effective) breaches >= threshold — patching doesn't
    // save a destroyed system, only reduces Difficulty on a damaged-but-not-destroyed one
    const isDestroyed       = totalBreaches >= destroyThreshold;
    const difficultyPenalty = isDestroyed ? Infinity : effectiveBreaches;

    let penaltyNote;
    if (isDestroyed) {
      penaltyNote = `⛔ ${label} DESTROYED — task auto-fails (${totalBreaches}/${destroyThreshold} breaches)`;
    } else if (effectiveBreaches === 0 && patched > 0) {
      penaltyNote = `✓ ${label} breached but patched — no Difficulty penalty (${patched} breach${patched !== 1 ? "es" : ""} patched)`;
    } else if (effectiveBreaches > 0) {
      const patchNote = patched > 0 ? `, ${patched} patched` : "";
      penaltyNote = `⚠ ${label} breached — Difficulty +${effectiveBreaches} (${totalBreaches}/${destroyThreshold} total${patchNote})`;
    } else {
      penaltyNote = null;
    }

    // Power strain on this system increases complication range for tasks using it
    const complicationRangeIncrease = CombatHUD.getPowerStrainRange(actor, systemKey);
    // Rerouted power grants a bonus die on the next task using this system
    const reroutedPower = CombatHUD.getReroutedPower(actor, systemKey);

    const notes = [];
    if (penaltyNote) notes.push(penaltyNote);
    if (complicationRangeIncrease > 0) notes.push(`⚡ Power Strain — complication range +${complicationRangeIncrease}`);
    if (reroutedPower) notes.push(`⚡ Reserve Power rerouted — bonus die available`);
    penaltyNote = notes.join(" · ") || null;

    return {
      breaches: totalBreaches, effectiveBreaches, patched,
      destroyThreshold, difficultyPenalty, isDestroyed, label, penaltyNote,
      complicationRangeIncrease, reroutedPower,
    };
  }

  // ── Department Strain injury helpers ─────────────────────────────────────
  // Dept strain is stored as injury "Dept Strain: [Department]" with
  // system.quantity = complication range increase for tasks using that dept.

  static deptLabel(key) {
    return { command: "Command", conn: "Conn", engineering: "Engineering",
             security: "Security", medicine: "Medicine", science: "Science" }[key] ?? key;
  }

  static getDeptStrainRange(actor, deptKey) {
    const label = CombatHUD.deptLabel(deptKey);
    const item  = actor.items.find(i =>
      i.type === "injury" && i.name === `Dept Strain: ${label}`
    );
    return item?.system?.quantity ?? 0;
  }

  static async applyDeptStrain(actor, deptKey, rangeIncrease = 1) {
    const label    = CombatHUD.deptLabel(deptKey);
    const name     = `Dept Strain: ${label}`;
    const existing = actor.items.find(i => i.type === "injury" && i.name === name);
    const icon     = "systems/sta/assets/compendia/icons/damage-core/damage-hit-engines.svg";
    if (existing) {
      await existing.update({
        "system.quantity": (existing.system.quantity ?? 1) + rangeIncrease,
        "system.description": `Crew casualties — ${label} dept complication range +${(existing.system.quantity ?? 1) + rangeIncrease}.`,
      });
    } else {
      await actor.createEmbeddedDocuments("Item", [{
        name, type: "injury", img: icon,
        system: {
          description: `Crew casualties — ${label} dept tasks have complication range +${rangeIncrease}.`,
          quantity:    rangeIncrease,
        },
      }]);
    }
  }

  static async clearDeptStrain(actor, deptKey) {
    const label = CombatHUD.deptLabel(deptKey);
    const item  = actor.items.find(i => i.type === "injury" && i.name === `Dept Strain: ${label}`);
    if (item) await actor.deleteEmbeddedDocuments("Item", [item.id]);
  }

  // ── Power Strain injury helpers ──────────────────────────────────────────
  // Power strain is stored as an injury item "Power Strain: [System]" with
  // system.quantity = complication range increase for tasks using that system.

  static getPowerStrainRange(actor, systemKey) {
    const label = CombatHUD.systemLabel(systemKey);
    const item  = actor.items.find(i =>
      i.type === "injury" && i.name === `Power Strain: ${label}`
    );
    return item?.system?.quantity ?? 0;
  }

  static async applyPowerStrain(actor, systemKey, rangeIncrease = 1) {
    const label    = CombatHUD.systemLabel(systemKey);
    const name     = `Power Strain: ${label}`;
    const existing = actor.items.find(i => i.type === "injury" && i.name === name);
    const icon     = "systems/sta/assets/compendia/icons/damage-core/damage-hit-engines.svg";

    if (existing) {
      await existing.update({
        "system.quantity":    (existing.system.quantity ?? 1) + rangeIncrease,
        "system.description": `Power Strain — ${label} complication range increased by ${(existing.system.quantity ?? 1) + rangeIncrease}.`,
      });
    } else {
      await actor.createEmbeddedDocuments("Item", [{
        name,
        type:   "injury",
        img:    icon,
        system: {
          description: `Power Strain — ${label} complication range increased by ${rangeIncrease}. Created by Regain Power complication.`,
          quantity:    rangeIncrease,
        },
      }]);
    }
  }

  static async clearPowerStrain(actor, systemKey) {
    const label = CombatHUD.systemLabel(systemKey);
    const name  = `Power Strain: ${label}`;
    const item  = actor.items.find(i => i.type === "injury" && i.name === name);
    if (item) await actor.deleteEmbeddedDocuments("Item", [item.id]);
  }

  /**
   * Returns the appropriate damage-core SVG icon path for a system at a given
   * breach count. Four severity tiers map to the native STA icon set:
   *
   *   0 breaches  → (caller should not be showing an icon)
   *   1 breach    → damage-hit-*        (first impact, yellow)
   *   2 breaches  → damage-damaged-*    (significant damage, orange)
   *   3+ but < destroyThreshold → damage-disabled-* (critical, near-destroyed)
   *   >= destroyThreshold       → damage-destroyed-* (system gone)
   *
   * The icon folder uses "comms" as the abbreviation for communications.
   */
  static systemDamageIcon(systemKey, breaches, scale) {
    const ICON_BASE = "systems/sta/assets/compendia/icons/damage-core";
    // Map full system key → icon suffix used by the damage-core folder
    const suffixMap = {
      communications: "comms",
      computers:      "computers",
      engines:        "engines",
      sensors:        "sensors",
      structure:      "structure",
      weapons:        "weapons",
    };
    const suffix    = suffixMap[systemKey] ?? systemKey;
    const threshold = Math.ceil((scale ?? 1) / 2);

    // Simple two-state logic: destroyed at threshold, damaged below it.
    // Avoids any scale assumptions — works for shuttles (scale 1) through
    // starbases (scale 16) and Borg cubes (scale 13) alike.
    const tier = (breaches >= threshold) ? "destroyed" : "damaged";

    return `${ICON_BASE}/damage-${tier}-${suffix}.svg`;
  }

  /**
   * Apply one breach to an actor.
   * Finds an existing Injury for that system and increments quantity,
   * or creates a new Injury item if none exists.
   * Returns the system key that was breached.
   */
  // ── Token Magic breach damage visuals ────────────────────────────────────────

  /**
   * Add a damage-splash Token Magic filter to all tokens for this actor.
   * Each breach adds one more splash mark at a random position on the token.
   * Silently no-ops if Token Magic FX is not installed or the setting is off.
   *
   * @param {Actor}  actor        - The ship actor
   * @param {number} breachCount  - Total breaches on this system after the update
   */
  static _applyBreachTokenFX(actor, breachCount) {
    if (!window.TokenMagic) return;
    try {
      if (!game.settings.get("sta2e-toolkit", "breachTokenFX")) return;
    } catch { return; }

    const tokens = CombatHUD._tokensForActor(actor);
    if (!tokens.length) return;

    // Each breach gets a unique filterId so they stack independently
    const filterId = `sta2e-breach-${breachCount}`;

    // Colour and intensity scale with breach severity
    // 1 breach: dark smoke grey — 3+: deep orange/red glow
    const color = breachCount >= 3 ? 0x331100
                : breachCount >= 2 ? 0x2a1800
                : 0x1a1a1a;

    const params = [{
      filterType:        "splash",
      filterId,
      rank:              5,
      color,
      padding:           80,
      time:              Math.random() * 1000,
      seed:              Math.random(),
      splashFactor:      0.8 + (breachCount * 0.1),   // grows with damage
      spread:            0.35 + (Math.random() * 0.15),
      blend:             1,
      dimX:              0.30 + (Math.random() * 0.12),
      dimY:              0.30 + (Math.random() * 0.12),
      cut:               false,
      textureAlphaBlend: true,
      anchorX:           0.28 + (Math.random() * 0.44),
      anchorY:           0.28 + (Math.random() * 0.44),
    }];

    for (const token of tokens) {
      TokenMagic.addFilters(token, params);
    }
  }

  /**
   * Remove all breach splash filters from this actor's tokens.
   * Called when a ship is repaired or destroyed/reset.
   * @param {Actor} actor
   */
  static _clearBreachTokenFX(actor) {
    if (!window.TokenMagic) return;
    const tokens = CombatHUD._tokensForActor(actor);
    for (const token of tokens) {
      // Delete each possible breach splash filter by its known predictable ID
      // (breach IDs are sta2e-breach-1 through sta2e-breach-N, max 18 for scale 6 ship)
      for (let i = 1; i <= 18; i++) {
        const filterId = `sta2e-breach-${i}`;
        if (TokenMagic.hasFilterId(token, filterId)) {
          TokenMagic.deleteFilters(token, filterId);
        }
      }
    }
  }

  // ── Attack-level outcome resolution ──────────────────────────────────────────
  // Called ONCE per attack after all its breaches are applied.
  // High Yield's two breaches are one attack; Devastating Attack is a separate one.

  static async _resolveAttackOutcome(actor, token, totalBreaches) {
    const scale         = actor.system?.scale ?? 1;
    const currentStatus = CombatHUD.getShipStatus(actor);
    const isNpc         = CombatHUD.isNpcShip(actor);

    // Compute what the total was before this attack by reading the live actor
    // and subtracting this attack's breach count isn't reliable — instead use
    // the token-doc status as the source of truth for pre-attack state:
    //   "active"   → ship was fine before, check if now critical
    //   "disabled" → ship was already critical, this attack destroys it
    //   "destroyed" → nothing to do

    if (currentStatus === "destroyed") return;

    const isNowCritical = totalBreaches > scale;

    if (!isNowCritical) return; // still within scale — no critical outcome

    if (currentStatus === "active") {
      // Ship just crossed into critical damage this attack
      await CombatHUD.setShipStatus(actor, "disabled");
      ChatMessage.create({
        content: lcarsCard("⚠️ CRITICAL DAMAGE", LC.orange, `
          <div style="font-size:12px;font-weight:700;color:${LC.orange};
            margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
          <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
            Total breaches (${totalBreaches}) exceed Scale ${scale}.<br>
            Ship can no longer function — no further actions may be taken.
            ${isNpc ? `<br><span style="color:${LC.textDim};">At GM discretion, this NPC vessel may be destroyed.</span>` : ""}
          </div>`),
        speaker: { alias: "STA2e Toolkit" }
      });

    } else if (currentStatus === "disabled") {
      // Ship was already critical — this attack destroys it
      await CombatHUD._destroyShip(actor, token,
        `Additional breach suffered while at critical damage. ${actor.name} is destroyed.`);
    }
  }

  static async _destroyShip(actor, token, reason) {
    await CombatHUD.setShipStatus(actor, "destroyed");
    CombatHUD._clearBreachTokenFX(actor);
    ChatMessage.create({
      content: lcarsCard("💀 SHIP DESTROYED", LC.red, `
        <div style="font-size:12px;font-weight:700;color:${LC.red};
          margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
        <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
          ${reason}
        </div>`),
      speaker: { alias: "STA2e Toolkit" }
    });
    const destroyToken = token
      ?? canvas.tokens?.placeables.find(t => t.actor === actor || t.document?.actorId === actor.id);
    if (destroyToken) await CombatHUD.fireDestructionEffect(destroyToken);
  }

  static async applyBreach(actor, systemKey, token = null) {
    const label      = CombatHUD.systemLabel(systemKey);
    const injuryName = `Breach: ${label}`;
    const scale      = actor.system?.scale ?? 1;

    // Increment the system's breach counter on the actor sheet
    const currentBreaches = actor.system?.systems?.[systemKey]?.breaches ?? 0;
    const newBreaches     = currentBreaches + 1;
    await actor.update({ [`system.systems.${systemKey}.breaches`]: newBreaches });

    // Per STA 2e rules: if a patched system suffers a new breach,
    // all patches on that system are removed and penalties return.
    const patchedMap = CombatHUD.getPatchedBreaches(actor);
    if (patchedMap[systemKey]) {
      await CombatHUD.unpatchSystem(actor, systemKey);
      ui.notifications.warn(
        `STA2e Toolkit: New breach on ${label} — patched repairs undone. Difficulty penalties restored.`
      );
      game.sta2eToolkit?.combatHud?._refresh?.();
    }

    // Apply damage splash FX to the token — one new splash per breach
    CombatHUD._applyBreachTokenFX(actor, newBreaches);

    // Also create/increment an Injury item for the Damage Report section
    const icon     = CombatHUD.systemDamageIcon(systemKey, newBreaches, scale);
    // Build description based on whether this breach destroys the system.
    // The destroy check uses newBreaches since we already incremented above.
    const destroyThresholdEarly = Math.ceil(scale / 2);
    const isDestroyedNow        = newBreaches >= destroyThresholdEarly;
    const breachDescription     = isDestroyedNow
      ? `<strong>${label} system has been DESTROYED (${newBreaches}/${destroyThresholdEarly} breaches).</strong>`
        + `<br><br>Any task which would be assisted by ${label} <strong>automatically fails</strong>.`
        + `<br><br>Damage Control (Core p.303) removes the penalties imposed by a breach but cannot`
        + ` remove the breaches themselves — repairs patch the breach rather than perform a full repair.`
        + ` If a patched system suffers an additional breach, any existing patched breaches also return.`
        + ` Breaches cannot be fully repaired in combat or during an adventure; intensive repairs`
        + ` require extensive work and may take days or more to complete.`
      : `${label} system has suffered ${newBreaches} breach${newBreaches !== 1 ? "es" : ""}.`
        + ` Each breach increases the Difficulty of tasks assisted by ${label} by 1.`
        + `<br><br>Damage Control (Core p.303) removes the penalties imposed by a breach but cannot`
        + ` remove the breaches themselves — repairs patch the breach rather than perform a full repair.`
        + ` If a patched system suffers an additional breach, any existing patched breaches also return.`
        + ` Breaches cannot be fully repaired in combat or during an adventure; intensive repairs`
        + ` require extensive work and may take days or more to complete.`;

    const existing = actor.items.find(i => i.type === "injury" && i.name === injuryName);
    if (existing) {
      // Quantity goes up, icon may escalate, and description reflects current state
      await existing.update({
        img:                        icon,
        "system.quantity":          (existing.system.quantity ?? 1) + 1,
        "system.description":       breachDescription,
      });
    } else {
      await actor.createEmbeddedDocuments("Item", [{
        name:   injuryName,
        type:   "injury",
        img:    icon,
        system: {
          description: breachDescription,
          quantity:    1,
        }
      }]);
    }

    // ── Check system destroyed threshold ─────────────────────────────────────
    // destroyThresholdEarly was already computed above for the description
    const destroyThreshold    = destroyThresholdEarly;
    const systemJustDestroyed = newBreaches >= destroyThreshold
      && currentBreaches < destroyThreshold;

    if (systemJustDestroyed) {
      ChatMessage.create({
        content: lcarsCard("💥 SYSTEM DESTROYED", LC.red, `
          <div style="font-size:12px;font-weight:700;color:${LC.red};margin-bottom:4px;font-family:${LC.font};">
            ${actor.name} — ${label.toUpperCase()}
          </div>
          <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
            ${label} has suffered ${newBreaches} breaches (threshold: ${destroyThreshold} for Scale ${scale}).<br>
            Any task assisted by ${label} <strong>automatically fails</strong>.
          </div>`),
        speaker: { alias: "STA2e Toolkit" }
      });
    }

    // ── Check critical damage threshold ──────────────────────────────────────
    // Compute totalBreaches arithmetically from pre-update snapshot + this breach.
    // Return value used by applyDamage to resolve attack-level outcome once,
    // after ALL breaches for this attack have been applied (avoids mid-attack
    // destruction from High Yield's second breach).
    const totalBreaches = Object.entries(actor.system?.systems ?? {})
      .reduce((sum, [key, s]) => {
        const val = key === systemKey ? newBreaches : (s.breaches ?? 0);
        return sum + val;
      }, 0);

    // ── Warp Core Breach check ────────────────────────────────────────────────
    // Runs per-breach so it fires as soon as the condition is first met,
    // regardless of which breach in an attack triggered it.
    {
      const alreadyFlagged   = CombatHUD.getWarpBreachState(actor);
      const shipIsCritical   = totalBreaches > scale;
      const currentStatus    = CombatHUD.getShipStatus(actor);
      const shipNotDestroyed = currentStatus !== "destroyed";

      const engBreachesNow = systemKey === "engines"
        ? newBreaches
        : (actor.system?.systems?.engines?.breaches ?? 0);
      const engDestroyed = engBreachesNow >= destroyThreshold;

      if (shipIsCritical && engDestroyed && !alreadyFlagged && shipNotDestroyed) {
        await CombatHUD.setWarpBreachState(actor, true);
        const engRating = actor.system?.systems?.engines?.value ?? "?";
        ChatMessage.create({
          content: lcarsCard("☢ WARP CORE BREACH IMMINENT", LC.red, `
            <div style="font-size:13px;font-weight:700;color:${LC.red};
              font-family:${LC.font};margin-bottom:6px;letter-spacing:0.05em;">
              ${actor.name}
            </div>
            <div style="font-size:10px;color:${LC.text};font-family:${LC.font};margin-bottom:6px;">
              Engines destroyed at critical damage — the reactor has lost containment.<br>
              At the start of each new round, roll a d20. If the result exceeds the ship's
              Engineering rating <strong>(${engRating})</strong>, the reactor explodes.
            </div>
            <div style="font-size:10px;color:${LC.text};font-family:${LC.font};margin-bottom:4px;">
              <strong>Explosion:</strong> Destroys the ship, kills all aboard, inflicts
              <strong>Scale+1 (${scale + 1}) damage with Piercing</strong>
              to all ships within Close range.
            </div>
            <div style="font-size:9px;color:${LC.yellow};font-family:${LC.font};margin-top:4px;">
              ▶ Stabilize the Reactor — Extended Task (Progress: Engines ${engRating}, Difficulty 3, Daring/Control + Engineering)<br>
              ▶ Eject the Reactor — Task (Difficulty 2, Daring + Engineering)
            </div>
          `),
          speaker: { alias: "STA2e Toolkit" },
        });
      }
    }

    return { totalBreaches };
  }

  // ── Shaken damage result table (PC ships) ─────────────────────────────────

  // D20 Minor Damage table (STA 2e Core, p.xx — Shaken results for PC ships)
  static SHAKEN_RESULTS = [
    { range: [1,  6],  id: "brace",      label: "Brace for Impact!",        desc: "On the next turn this ship (or a character aboard) takes, they may not take a major action." },
    { range: [7,  12], id: "lose_power", label: "Losing Power!",            desc: "If you have Reserve Power, lose it. The next time you attempt to Regain Power, the Difficulty is increased by 1." },
    { range: [13, 18], id: "casualties", label: "Casualties and Minor Damage", desc: "The ship suffers a complication." },
    { range: [19, 20], id: "roll_again", label: "Roll Again",               desc: "Roll on this table again." },
  ];

  // ── Damage Application (called from renderChatMessageHTML hook) ────────────

  static async applyDamage(payload) {
    const { tokenId, actorId, finalDamage, highYield, _isDevastating, targetingSystem, noDevastating } = payload;

    const token = canvas.tokens.get(tokenId);
    const actor = token?.actor ?? game.actors.get(actorId);
    if (!actor) {
      ui.notifications.error("STA2e Toolkit: Could not find target actor to apply damage.");
      return;
    }

    const isNpc         = CombatHUD.isNpcShip(actor);
    const currentShields = actor.system?.shields?.value ?? 0;
    const maxShields     = actor.system?.shields?.max   ?? 0;
    const wasShaken      = actor.system?.shaken         ?? false;
    const newShields     = Math.max(0, currentShields - finalDamage);
    const pctAfter       = maxShields > 0 ? newShields / maxShields : 0;

    // ── Determine shaken / breach outcome ────────────────────────────────────
    // All three shield thresholds (50%, 25%, 0) are checked independently —
    // a single hit that crosses multiple thresholds generates all applicable
    // breaches/shaken outcomes simultaneously ("apply all of which are true").
    //
    // wasShaken = pre-existing shaken before this hit (NEVER cleared by damage —
    // GMs clear it via the HUD or shaken-roll result).
    // shakenThisAttack = shaken applied by the 50% trigger in THIS hit only
    // (transient: never written to actor, just used to cascade into 25% breach).

    const pctBefore      = maxShields > 0 ? currentShields / maxShields : 1;
    let breachCount      = 0;
    let triggerShaken    = false;
    let shakenThisAttack = false;
    const shakenNotes    = [];

    if (currentShields === 0) {
      // Shields were already at 0 — additional breach, nothing else
      breachCount++;
      shakenNotes.push("💥 BREACH — shields were already down");
    } else {
      // ── 50% threshold ─────────────────────────────────────────────────────
      if (pctBefore >= 0.50 && pctAfter < 0.50) {
        if (wasShaken) {
          // Already shaken before this hit — punch through at 50%
          breachCount++;
          shakenNotes.push("💥 BREACH — punched through at 50% (already Shaken)");
        } else {
          shakenThisAttack = true;
          triggerShaken    = true;
          shakenNotes.push("⚠️ SHAKEN — shields crossed 50%");
        }
      }

      // ── 25% threshold (checked independently of 50%) ──────────────────────
      if (pctBefore >= 0.25 && pctAfter < 0.25) {
        const alreadyShaken = wasShaken || shakenThisAttack;
        if (alreadyShaken) {
          breachCount++;
          if (shakenThisAttack) {
            triggerShaken = false; // breach supersedes the shaken-this-attack
            shakenNotes.push("💥 BREACH — shields crossed 50% then 25% in one hit");
          } else {
            shakenNotes.push("💥 BREACH — punched through at 25% (already Shaken)");
          }
        } else {
          triggerShaken = true;
          shakenNotes.push("⚠️ SHAKEN — shields crossed 25%");
        }
      }

      // ── Shields to 0 (independent check — may stack with 25% above) ───────
      if (newShields === 0) {
        breachCount++;
        shakenNotes.push("💥 BREACH — shields reduced to 0");
      }
    }

    const triggerBreach = breachCount > 0;
    const shakenNote    = shakenNotes.join(" · ");

    // ── Write shield value ────────────────────────────────────────────────────
    const updates = { "system.shields.value": newShields };

    if (triggerShaken && !wasShaken) updates["system.shaken"] = true;
    // wasShaken is NEVER cleared by damage — the ship remains shaken until the
    // GM resolves it (via the HUD toggle or Minor Damage roll result).
    await actor.update(updates);

    // ── Apply breaches ────────────────────────────────────────────────────────
    // Each threshold that triggered a breach gets its own system roll.
    // High Yield adds one extra breach to the SAME system as the first breach only.
    const breachSystems    = [];
    let finalTotalBreaches = 0;
    if (breachCount > 0) {
      for (let bIdx = 0; bIdx < breachCount; bIdx++) {
        const sys = (bIdx === 0 && targetingSystem) ? targetingSystem : CombatHUD.rollSystemHit();
        const r   = await CombatHUD.applyBreach(actor, sys, token);
        breachSystems.push(sys);
        finalTotalBreaches = r.totalBreaches;

        if (bIdx === 0 && highYield) {
          // High Yield: one additional breach to the same system as the first breach
          const r2 = await CombatHUD.applyBreach(actor, sys, token);
          breachSystems.push(sys);
          finalTotalBreaches = r2.totalBreaches;
        }
      }

      // ── Resolve attack-level outcome ONCE after all breaches ────────────────
      // Critical damage and ship destruction are per-attack, not per-breach.
      await CombatHUD._resolveAttackOutcome(actor, token, finalTotalBreaches);
    }

    // ── Build result chat card ─────────────────────────────────────────────────
    const shieldColor  = pctAfter > 0.5 ? LC.green : pctAfter > 0.25 ? LC.yellow : LC.red;
    const breachHtml   = breachSystems.length ? `
      <div style="margin-top:5px;">
        ${breachSystems.map((s, i) => `
          <div style="padding:3px 6px;border-left:3px solid ${LC.red};
            font-size:10px;color:${LC.red};margin-bottom:3px;
            letter-spacing:0.06em;text-transform:uppercase;font-family:${LC.font};">
            BREACH${breachSystems.length > 1 ? ` #${i+1}` : ""} → ${CombatHUD.systemLabel(s).toUpperCase()}
            ${highYield && i === 1 ? `<span style="color:${LC.orange};"> (HIGH YIELD +1)</span>` : ""}
          </div>
        `).join("")}
      </div>` : "";

    // PC Shaken: roll D20 button to determine result from Minor Damage table
    const shakenTableHtml = (triggerShaken && !isNpc) ? `
      <div style="margin-top:6px;border:1px solid ${LC.tertiary};border-radius:2px;overflow:hidden;">
        <div style="background:${LC.tertiary};color:${LC.bg};font-size:9px;font-weight:700;
          letter-spacing:0.12em;text-transform:uppercase;padding:2px 8px;font-family:${LC.font};">
          SHAKEN — MINOR DAMAGE (D20)
        </div>
        <div style="padding:6px;">
          <table style="width:100%;border-collapse:collapse;font-family:${LC.font};font-size:9px;
            color:${LC.textDim};margin-bottom:6px;">
            <thead>
              <tr style="background:rgba(255,204,102,0.08);">
                <th style="padding:2px 5px;text-align:left;color:${LC.tertiary};border-bottom:1px solid ${LC.borderDim};">D20</th>
                <th style="padding:2px 5px;text-align:left;color:${LC.tertiary};border-bottom:1px solid ${LC.borderDim};">Result</th>
              </tr>
            </thead>
            <tbody>
              ${CombatHUD.SHAKEN_RESULTS.map(r => `
                <tr>
                  <td style="padding:2px 5px;color:${LC.textDim};border-bottom:1px solid ${LC.borderDim};white-space:nowrap;">
                    ${r.range[0]}–${r.range[1]}
                  </td>
                  <td style="padding:2px 5px;border-bottom:1px solid ${LC.borderDim};">
                    <strong style="color:${LC.tertiary};">${r.label}</strong>
                    <span style="color:${LC.textDim};"> — ${r.desc}</span>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
          <div style="display:flex;gap:4px;">
            <button class="sta2e-shaken-roll"
              data-actorid="${actor.id}"
              data-tokenid="${token?.id ?? ""}"
              style="flex:1;padding:5px;background:rgba(255,204,102,0.1);
                border:1px solid ${LC.tertiary};border-radius:2px;
                color:${LC.tertiary};font-size:10px;font-weight:700;
                letter-spacing:0.08em;text-transform:uppercase;
                cursor:pointer;font-family:${LC.font};">
              🎲 ROLL D20
            </button>
            ${CombatHUD.SHAKEN_RESULTS.filter(r => r.id !== "roll_again").map(r => `
            <button class="sta2e-shaken-choose"
              data-actorid="${actor.id}"
              data-tokenid="${token?.id ?? ""}"
              data-resultid="${r.id}"
              style="padding:5px 7px;background:rgba(255,204,102,0.06);
                border:1px solid ${LC.borderDim};border-radius:2px;
                color:${LC.textDim};font-size:9px;font-weight:700;
                letter-spacing:0.06em;text-transform:uppercase;
                cursor:pointer;font-family:${LC.font};"
              title="${r.label} — ${r.desc}">
              ${r.id === "brace" ? "BRACE" : r.id === "lose_power" ? "POWER" : "CASUAL."}
            </button>`).join("")}
          </div>
        </div>
      </div>` : "";

    // NPC Shaken: auto note
    const npcShakenHtml = (triggerShaken && isNpc) ? `
      <div style="margin-top:5px;padding:3px 6px;border-left:3px solid ${LC.yellow};
        font-size:10px;color:${LC.yellow};letter-spacing:0.06em;text-transform:uppercase;font-family:${LC.font};">
        NPC — LOSES NEXT TURN AUTOMATICALLY
      </div>` : "";

    // ── Opposed task result panel ────────────────────────────────────────────
    // Shows attacker vs defender successes, momentum/threat delta,
    // and the Defensive Fire counterattack button when the defender won.
    let opposedResultHtml = "";
    const oppDefType    = payload.opposedDefenseType ?? null;
    const defSuccesses  = payload.defenderSuccesses  ?? null;
    if (oppDefType !== null && defSuccesses !== null && !_isDevastating) {
      const attackerSuccesses = payload.attackerSuccesses ?? null;
      const defLabel   = oppDefType === "evasive-action" ? "Evasive Action" : oppDefType === "defensive-fire" ? "Defensive Fire" : "Cover";
      const defIcon    = oppDefType === "evasive-action" ? "↗️" : oppDefType === "defensive-fire" ? "🛡️" : "🪨";

      let deltaHtml = "";
      if (attackerSuccesses !== null) {
        const delta = attackerSuccesses - defSuccesses;
        if (delta > 0) {
          // Attacker won — momentum for attacker
          deltaHtml = `
            <div style="font-size:11px;font-weight:700;color:${LC.green};font-family:${LC.font};margin-top:4px;">
              ✓ Attacker wins — +${delta} Momentum
            </div>`;
        } else if (delta < 0) {
          // Defender won — momentum/threat for defender
          const absDelta = Math.abs(delta);
          const defPoolBtn = poolButtonHtml(isNpc ? "threat" : "momentum", absDelta, tokenId);
          deltaHtml = `
            <div style="font-size:11px;font-weight:700;color:${LC.red};font-family:${LC.font};margin-top:4px;">
              ✗ Defender wins — +${absDelta} ${isNpc ? "Threat" : "Momentum"}
            </div>
            ${defPoolBtn}`;
          // Counterattack button — available for Defensive Fire and Cover (not Evasive Action)
          if (oppDefType !== "evasive-action") {
            const cfPayload = encodeURIComponent(JSON.stringify({
              attackerTokenId: payload.attackerTokenId ?? null,
              defenderTokenId: tokenId,
              defenderActorId: actorId,
              opposedDefenseType: oppDefType,
            }));
            deltaHtml += `
              <div style="margin-top:5px;">
                <button class="sta2e-defensive-counterattack"
                  data-payload="${cfPayload}"
                  style="width:100%;padding:4px;background:rgba(255,80,80,0.12);
                    border:1px solid ${LC.red};border-radius:2px;
                    color:${LC.red};font-size:10px;font-weight:700;
                    letter-spacing:0.08em;text-transform:uppercase;
                    cursor:pointer;font-family:${LC.font};">
                  ⚡ COUNTERATTACK (2 Momentum)
                </button>
              </div>`;
          }
        } else {
          deltaHtml = `
            <div style="font-size:11px;color:${LC.textDim};font-family:${LC.font};margin-top:4px;">
              Tie — no Momentum or Threat generated
            </div>`;
        }
      }

      opposedResultHtml = `
        <div style="margin-top:6px;padding:6px 8px;
          border:1px solid ${LC.border};border-left:3px solid ${LC.primary};
          border-radius:2px;background:rgba(255,153,0,0.04);">
          <div style="font-size:11px;font-weight:700;color:${LC.primary};
            font-family:${LC.font};letter-spacing:0.06em;text-transform:uppercase;
            margin-bottom:5px;">
            ${defIcon} Opposed — ${defLabel}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;
            font-size:11px;font-family:${LC.font};margin-bottom:3px;">
            <div>
              <span style="color:${LC.textDim};">Defender: </span>
              <span style="color:${LC.tertiary};font-weight:700;">${defSuccesses} success${defSuccesses !== 1 ? "es" : ""}</span>
            </div>
            ${attackerSuccesses !== null ? `
            <div>
              <span style="color:${LC.textDim};">Attacker: </span>
              <span style="color:${LC.tertiary};font-weight:700;">${attackerSuccesses} success${attackerSuccesses !== 1 ? "es" : ""}</span>
            </div>` : ""}
          </div>
          ${deltaHtml}
        </div>`;
    }

    // Devastating Attack button — only on primary hits that aren't the collision return hit
    let devastatingBtn = "";
    if (!_isDevastating && !noDevastating) {
      const halfDmg       = Math.ceil(finalDamage / 2);
      const spread        = payload.spread ?? false;
      const atkIsNpc      = payload.attackerIsNpc ?? false;
      const poolLabel     = atkIsNpc ? "THREAT" : "MOMENTUM";
      const devCost       = spread ? `1 ${poolLabel} — SPREAD` : `2 ${poolLabel}`;
      const devPayload = encodeURIComponent(JSON.stringify({
        tokenId, actorId, halfDamage: halfDmg, spread,
        attackerTokenId: payload.attackerTokenId ?? null,
        attackerIsNpc:   atkIsNpc,
        weaponImg:       payload.weaponImg ?? null,
        weaponName:      payload.weaponName ?? null,
      }));
      devastatingBtn = `
        <div style="margin-top:6px;border-top:1px solid ${LC.borderDim};padding-top:6px;">
          <button class="sta2e-devastating-attack"
            data-payload="${devPayload}"
            style="width:100%;padding:4px;background:rgba(204,136,255,0.1);
              border:1px solid ${LC.secondary};border-radius:2px;
              color:${LC.secondary};font-size:10px;font-weight:700;
              letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;font-family:${LC.font};">
            DEVASTATING ATTACK (${devCost}) — ${halfDmg} DMG
          </button>
        </div>`;
    }

    // Area Attack button — shown after primary hit so attacker can apply same damage to nearby ships
    let areaBtn = "";
    if (!_isDevastating && payload.area && !payload.spread && finalDamage > 0) {
      const atkIsNpc  = payload.attackerIsNpc ?? false;
      const costLabel = atkIsNpc ? "1 THREAT" : "1 MOMENTUM";
      const areaPayload = encodeURIComponent(JSON.stringify({
        primaryTokenId:  tokenId,
        finalDamage,
        attackerTokenId: payload.attackerTokenId ?? null,
        attackerIsNpc:   atkIsNpc,
        weaponImg:       payload.weaponImg ?? null,
        weaponName:      payload.weaponName ?? null,
      }));
      areaBtn = `
        <div style="margin-top:6px;border-top:1px solid ${LC.borderDim};padding-top:6px;">
          <button class="sta2e-area-attack"
            data-payload="${areaPayload}"
            style="width:100%;padding:4px;background:rgba(0,180,255,0.08);
              border:1px solid ${LC.primary};border-radius:2px;
              color:${LC.primary};font-size:10px;font-weight:700;
              letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;font-family:${LC.font};">
            AREA — APPLY TO ADDITIONAL TARGETS (${costLabel} EACH)
          </button>
        </div>`;
    }

    const headerLabel = _isDevastating ? "DEVASTATING ATTACK" : `DAMAGE APPLIED${isNpc ? " — NPC" : ""}`;
    const headerColor = _isDevastating ? LC.secondary : LC.primary;

    ChatMessage.create({
      flags: { "sta2e-toolkit": { damageResult: true, actorId: actor.id } },
      content: lcarsCard(headerLabel, headerColor, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};margin-bottom:5px;font-family:${LC.font};">${actor.name}</div>
        <div style="font-size:11px;color:${LC.text};margin-bottom:4px;font-family:${LC.font};">
          SHIELDS: ${currentShields} → <span style="color:${shieldColor};font-weight:700;">${newShields}</span> / ${maxShields}
          <span style="color:${LC.textDim};"> (−${finalDamage})</span>
        </div>
        ${shakenNote ? `
          <div style="padding:3px 6px;border-left:3px solid ${LC.yellow};font-size:10px;
            color:${LC.yellow};margin-top:4px;letter-spacing:0.06em;text-transform:uppercase;font-family:${LC.font};">
            ${shakenNote}
          </div>` : ""}
        ${breachHtml}
        ${shakenTableHtml}
        ${npcShakenHtml}
        ${opposedResultHtml}
        ${devastatingBtn}
        ${areaBtn}
      `),
      speaker: { alias: "STA2e Toolkit" }
    });
  }

  // ── Devastating Attack (2 Momentum, or 1 with Spread) ─────────────────────

  static async applyDevastatingAttack(payload) {
    const { tokenId, actorId, halfDamage, attackerTokenId, weaponImg, weaponName } = payload;
    const spread      = payload.spread      ?? false;
    const atkIsNpc    = payload.attackerIsNpc ?? false;

    const targetToken   = canvas.tokens.get(tokenId);
    const actor         = targetToken?.actor ?? game.actors.get(actorId);
    const attackerToken = canvas.tokens.get(attackerTokenId);

    if (!actor) {
      ui.notifications.error("STA2e Toolkit: Could not find target actor for Devastating Attack.");
      return;
    }

    // Spend the Momentum (players) or Threat (NPCs) cost for Devastating Attack.
    // Spread quality reduces the cost from 2 → 1.
    const devCost = spread ? 1 : 2;
    const pool    = atkIsNpc ? "threat" : "momentum";
    const Tracker = game.STATracker?.constructor;
    if (Tracker) {
      const current = Tracker.ValueOf(pool);
      if (current < devCost) {
        ui.notifications.warn(
          `STA2e Toolkit: Not enough ${atkIsNpc ? "Threat" : "Momentum"} for Devastating Attack` +
          ` (need ${devCost}, have ${current}).`
        );
        return;
      }
      await Tracker.DoUpdateResource(pool, current - devCost);
    }

    // Resolve weapon config from the stored img slug so we can fire the animation
    if (attackerToken && targetToken && weaponImg) {
      const slug   = weaponImg.split("/").pop().replace(/\.(svg|webp|png|jpg)$/, "");
      const config = STARSHIP_WEAPON_CONFIGS[slug] ?? null;
      setTimeout(async () => {
        try {
          if (config) await fireWeapon(config, true, attackerToken, [targetToken]);
          else        ui.notifications.warn("STA2e Toolkit: No animation config for this weapon.");
        } catch(e) { console.warn("STA2e Toolkit | Devastating Attack animation failed:", e); }
      }, 300);
    }

    // Post a new damage card for the secondary hit — reuses full applyDamage flow
    // halfDamage is the base, GM can add extra via the input as usual
    await CombatHUD.applyDamage({
      tokenId,
      actorId,
      finalDamage: halfDamage,
      highYield:   false,  // Devastating Attack doesn't chain
      spread:      false,
      attackerTokenId,
      weaponImg,
      weaponName,
      _isDevastating: true,
    });
  }

  // ── Area Attack — secondary target picker (250 px radius around primary target) ──

  static async openAreaTargetPicker(payload) {
    const { primaryTokenId, finalDamage, attackerTokenId, attackerIsNpc, weaponImg, weaponName } = payload;

    const primaryToken = canvas.tokens.get(primaryTokenId);
    if (!primaryToken) {
      ui.notifications.error("STA2e Toolkit: Primary target token not found for Area attack.");
      return;
    }

    const RADIUS_PX = 250;
    const cx = primaryToken.x + (primaryToken.w ?? primaryToken.width  ?? 0) / 2;
    const cy = primaryToken.y + (primaryToken.h ?? primaryToken.height ?? 0) / 2;

    const nearby = (canvas.tokens?.placeables ?? []).filter(t => {
      if (t.id === primaryTokenId) return false;
      const isShip = t.actor?.type === "starship" || t.actor?.type === "spacecraft2e";
      if (!isShip) return false;
      const tx = t.x + (t.w ?? t.width  ?? 0) / 2;
      const ty = t.y + (t.h ?? t.height ?? 0) / 2;
      return Math.hypot(tx - cx, ty - cy) <= RADIUS_PX;
    });

    if (nearby.length === 0) {
      ui.notifications.info("No nearby starship targets within 250 px of the primary target.");
      return;
    }

    const costLabel = attackerIsNpc ? "1 Threat" : "1 Momentum";
    const checkboxes = nearby.map(t =>
      `<label style="display:flex;align-items:center;gap:8px;margin:4px 0;cursor:pointer;">
        <input type="checkbox" name="area-target" value="${t.id}" style="cursor:pointer;">
        <span style="font-size:11px;color:${LC.text};font-family:${LC.font};">${t.name}</span>
      </label>`
    ).join("");

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Area — Select Additional Targets" },
      content: `
        <div style="padding:6px 10px;font-family:${LC.font};">
          <p style="font-size:10px;color:${LC.textDim};margin-bottom:8px;">
            Select targets within 250 px to receive <strong style="color:${LC.tertiary};">${finalDamage} damage</strong>.
            Each costs <strong style="color:${LC.primary};">${costLabel}</strong>.
          </p>
          ${checkboxes}
        </div>`,
      buttons: [
        {
          action:  "confirm",
          label:   "Apply",
          icon:    "fas fa-check",
          default: true,
          callback: (_e, _b, dlg) => {
            const checked = dlg.element.querySelectorAll("input[name='area-target']:checked");
            return Array.from(checked).map(inp => inp.value);
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });

    if (!result || result === "cancel" || (Array.isArray(result) && result.length === 0)) return;

    const selectedIds    = Array.isArray(result) ? result : [result];
    const attackerToken  = canvas.tokens.get(attackerTokenId);

    for (const tId of selectedIds) {
      const tToken = canvas.tokens.get(tId);
      if (!tToken) continue;

      // Spend the resource cost per additional target
      if (attackerIsNpc) {
        await CombatHUD._applyToPool("threat",   -1, attackerToken);
      } else {
        await CombatHUD._applyToPool("momentum", -1, attackerToken);
      }

      // Apply the same damage — no chained devastating or area from secondary hits
      await CombatHUD.applyDamage({
        tokenId:        tId,
        actorId:        tToken.actor?.id,
        finalDamage,
        highYield:      false,
        noDevastating:  true,
        area:           false,
        attackerTokenId,
        attackerIsNpc,
        weaponImg,
        weaponName,
      });

      // Fire animation to the additional target
      if (attackerToken && weaponImg) {
        const slug   = weaponImg.split("/").pop().replace(/\.(svg|webp|png|jpg)$/, "");
        const config = STARSHIP_WEAPON_CONFIGS[slug] ?? null;
        setTimeout(async () => {
          try {
            if (config) await fireWeapon(config, true, attackerToken, [tToken]);
          } catch(e) { console.warn("STA2e Toolkit | Area attack animation failed:", e); }
        }, 300);
      }
    }
  }

  // ── NPC flag toggle button (used in HUD header) ────────────────────────────

  _buildNpcToggle(actor) {
    const isNpc = CombatHUD.isNpcShip(actor);
    const btn   = document.createElement("button");
    btn.style.cssText = this._iconBtnStyle();
    btn.title     = isNpc ? "NPC Ship (click to toggle)" : "PC Ship (click to mark as NPC)";
    btn.textContent = isNpc ? "🤖" : "🖖";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await CombatHUD.toggleNpcShip(actor);
      this._refresh();
    });
    return btn;
  }

  _buildCrewManifestBtn(actor) {
    const manifest  = getCrewManifest(actor);
    const hasAny    = Object.values(manifest).some(ids => ids.length > 0);
    const btn       = document.createElement("button");
    btn.style.cssText = this._iconBtnStyle();
    btn.title     = "Crew Manifest — assign named officers to bridge stations";
    btn.textContent = hasAny ? "👥" : "👤";
    btn.style.color = hasAny ? LC.primary : LC.textDim;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCrewManifest(actor, this._token, () => this._refresh());
    });
    return btn;
  }

  // ── Ground Combat ───────────────────────────────────────────────────────────

  /**
   * Derive a flavourful injury name from weapon name + whether it's a Stun injury.
   * Severity is pulled from the weapon stat (2-5), not a lethal declaration.
   * e.g. "Phaser Type-2" + stun=false → "Phaser Burn (Deadly, Sev 4)"
   */
  /**
   * @param {string}  weaponName
   * @param {boolean} useStun
   * @param {number}  potency   - Severity minus Protection (what the injury item quantity is set to)
   * @param {number}  severity  - Raw weapon severity (shown for reference)
   */
  static _groundInjuryName(weaponName, useStun, potency, severity) {
    const n = (weaponName ?? "").toLowerCase();
    let flavor;
    if      (n.includes("phaser"))                                flavor = "Phaser Burn";
    else if (n.includes("disruptor"))                             flavor = "Disruptor Burn";
    else if (n.includes("polaron"))                               flavor = "Polaron Burn";
    else if (n.includes("plasma"))                                flavor = "Plasma Burn";
    else if (n.includes("bat'leth") || n.includes("batleth"))     flavor = "Bat'leth Wound";
    else if (n.includes("mek'leth") || n.includes("mekleth"))     flavor = "Mek'leth Wound";
    else if (n.includes("ushaan"))                                flavor = "Ushaan-tor Wound";
    else if (n.includes("anesthetic") || n.includes("hypospray")) flavor = "Sedative Effect";
    else if (n.includes("bludgeon") || n.includes("club"))        flavor = "Blunt Trauma";
    else if (n.includes("knife") || n.includes("dagger"))         flavor = "Blade Wound";
    else if (n.includes("blade") || n.includes("sword"))          flavor = "Blade Wound";
    else if (n.includes("grenade") || n.includes("explosive"))    flavor = "Blast Wound";
    else if (n.includes("rifle"))                                 flavor = useStun ? "Rifle Stun" : "Rifle Wound";
    else if (n.includes("pistol"))                                flavor = useStun ? "Pistol Stun" : "Pistol Wound";
    else                                                          flavor = weaponName ?? "Wound";

    const injType = useStun ? "Stun" : "Deadly";
    // Potency is the effective severity after armor reduction — used as the injury quantity
    return `${flavor} (${injType}, Sev ${potency})`;
  }

  /**
   * Build the ground combat hit/miss chat card.
   *
   * Key differences from ship combat:
   *  - No resistance track — ground combat uses Stress + avoidance
   *  - Severity (weapon stat 2-5) drives avoidance cost, not a lethal toggle
   *  - Dual weapons (Stun + Deadly) show which injury type was chosen
   *  - Avoidance rules shown per npcType
   *  - Apply Injury button creates an Injury item on the target actor
   *
   * @param {string} attackerName
   * @param {Item}   weapon         - characterweapon2e item
   * @param {Array}  targetData     - built in _resolveWeapon
   * @param {boolean} isHit
   * @param {boolean} useStun       - true if attacker chose Stun on a dual weapon
   */
  static _groundChatCard(attackerName, weapon, targetData, isHit, useStun, deadlyCostsThreat = false, opposedInfo = null) {
    const severity   = weapon.system?.severity ?? 0;
    const damage     = weapon.system?.damage   ?? 0;
    const hasStun    = weapon.system?.qualities?.stun   ?? false;
    const hasDeadly  = weapon.system?.qualities?.deadly ?? false;
    const isDual     = hasStun && hasDeadly;

    // Quality tags — skip stun/deadly, shown as injury type badge
    const qualityTags = Object.entries(weapon.system?.qualities ?? {})
      .filter(([k, v]) => k !== "stun" && k !== "deadly" && v === true)
      .map(([k]) => k.replace("piercingx", "piercing").replace("hiddenx", "hidden"))
      .join(", ");

    if (!isHit) {
      const missOpposedHtml = (() => {
        if (!opposedInfo) return "";
        const { opposedDefenseType: oDT, defenderSuccesses: dSucc, attackerSuccesses: aSucc,
                defenderTokenId, defenderActorId, defenderIsNpc, attackerTokenId } = opposedInfo;
        const defLabel = oDT === "melee" ? "Melee" : oDT === "cover" ? "Cover" : "Opposed";
        const defIcon  = oDT === "melee" ? "⚔️" : "🪨";
        const costLabel = defenderIsNpc ? "2 Threat" : "2 Momentum";
        const winMargin = (aSucc !== null) ? dSucc - aSucc : null;
        const defPoolBtn = (winMargin !== null && winMargin > 0)
          ? poolButtonHtml(defenderIsNpc ? "threat" : "momentum", winMargin, defenderTokenId ?? "")
          : "";
        const cfPayload = encodeURIComponent(JSON.stringify({
          attackerTokenId, defenderTokenId, defenderActorId, defenderIsNpc,
        }));
        return `
          <div style="margin-top:6px;padding:6px 8px;
            border:1px solid ${LC.border};border-left:3px solid ${LC.primary};
            border-radius:2px;background:rgba(255,153,0,0.04);">
            <div style="font-size:11px;font-weight:700;color:${LC.primary};
              font-family:${LC.font};letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px;">
              ${defIcon} Opposed — ${defLabel}
            </div>
            <div style="font-size:11px;font-family:${LC.font};margin-bottom:3px;">
              <span style="color:${LC.textDim};">Defender: </span>
              <strong style="color:${LC.tertiary};">${dSucc} success${dSucc !== 1 ? "es" : ""}</strong>
              ${aSucc !== null ? `&nbsp;·&nbsp;<span style="color:${LC.textDim};">Attacker: </span><strong style="color:${LC.tertiary};">${aSucc} success${aSucc !== 1 ? "es" : ""}</strong>` : ""}
            </div>
            <div style="font-size:11px;font-weight:700;color:${LC.red};font-family:${LC.font};margin-top:3px;">
              ✗ Defender wins — +${winMargin ?? dSucc} ${defenderIsNpc ? "Threat" : "Momentum"}
            </div>
            ${defPoolBtn}
            <div style="margin-top:5px;">
              <button class="sta2e-ground-counterattack"
                data-payload="${cfPayload}"
                style="width:100%;padding:4px;background:rgba(255,80,80,0.12);
                  border:1px solid ${LC.red};border-radius:2px;
                  color:${LC.red};font-size:10px;font-weight:700;
                  letter-spacing:0.08em;text-transform:uppercase;
                  cursor:pointer;font-family:${LC.font};">
                ⚡ COUNTERATTACK (${costLabel})
              </button>
            </div>
          </div>`;
      })();
      return lcarsCard("GROUND ATTACK — MISS", LC.textDim, `
        <div style="font-size:11px;color:${LC.textDim};font-family:${LC.font};padding:4px 0;">
          ${attackerName} missed — no effect.
        </div>
        ${missOpposedHtml}
      `);
    }

    const injTypeLabel = useStun ? "STUN" : "DEADLY";
    const injColor     = useStun ? LC.secondary : LC.red;
    const header       = `GROUND ATTACK — ${injTypeLabel} HIT`;

    // Deadly declaration: GM automatically gains 1 Threat (also show pool button as fallback)
    const threatNote = deadlyCostsThreat
      ? `<div style="display:flex;align-items:center;gap:8px;font-size:10px;color:${LC.yellow};
           font-family:${LC.font};font-weight:700;margin-top:3px;letter-spacing:0.06em;">
           <span>☠ DEADLY — +1 Threat (auto-applied)</span>
         </div>`
      : "";

    const targetsHtml = targetData.map(t => {
      const npcType   = t.npcType;
      // isPlayerOwned is true for STACharacterSheet2e and STASupportingSheet2e.
      // For NPCs (STANPCSheet2e), npcType is reliable: minor/notable/major.
      const isPC      = t.isPlayerOwned ?? false;
      const isMajor   = npcType === "major";
      const isNotable = npcType === "notable";
      const isMinor   = !isPC && !isMajor && !isNotable;

      const accentColor = isMinor ? LC.red : isNotable ? LC.yellow : isMajor ? LC.orange : LC.green;

      // Potency = Severity − Protection (minimum 1 per rules)
      const pot  = t.potency    ?? t.severity ?? 0;
      const prot = t.protection ?? 0;

      const stress      = t.currentStress ?? 0;
      const maxStress   = t.maxStress     ?? 0;
      const stressMode  = game.settings.get("sta2e-toolkit", "stressMode") ?? "countdown";

      // Avoidance rule per character type
      let avoidRule;
      if (isMinor) {
        avoidRule = `<span style="color:${LC.red};font-weight:700;">Minor NPC — cannot avoid (Potency ${pot})</span>`;
      } else if (isNotable) {
        avoidRule = `<span style="color:${LC.yellow};">Notable NPC: avoid by spending Threat (Potency ${pot})</span>`;
      } else if (isMajor) {
        avoidRule = `<span style="color:${LC.orange};">Major NPC: avoid freely while Threat available (Potency ${pot})</span>`;
      } else {
        avoidRule = `<span style="color:${LC.green};">${stressMode === "countup" ? "Absorb" : "Spend"} ${pot} Stress to avoid — take Minor injury if insufficient</span>`;
      }
      const stressAvail = stressMode === "countup" ? (maxStress - stress) : stress;
      const canFullyAvoid = isPC && stressAvail >= pot;
      const avoidVerb     = stressMode === "countup" ? "absorb" : "spend";

      // Stress bar — yellow pips show the avoidance cost, green shows available/remaining
      const stressBar = maxStress > 0
        ? `<div style="display:flex;gap:2px;flex-wrap:wrap;margin:3px 0;">
            ${Array.from({length: maxStress}, (_, i) => {
              let bg;
              if (stressMode === "countup") {
                if (i < stress)            bg = LC.borderDim;  // already accumulated
                else if (i < stress + pot) bg = LC.yellow;      // avoidance cost
                else                       bg = LC.green;        // remaining capacity
              } else {
                if (i >= stress)           bg = LC.borderDim;  // spent/empty
                else if (i < pot)          bg = LC.yellow;      // avoidance cost
                else                       bg = LC.green;        // remaining after avoidance
              }
              return `<div style="width:10px;height:10px;border-radius:1px;background:${bg};
                border:1px solid ${LC.border};"></div>`;
            }).join("")}
           </div>
           <div style="font-size:9px;font-family:${LC.font};">
             <span style="color:${LC.textDim};">STRESS ${stress}/${maxStress}</span>
             ${prot > 0 ? `<span style="color:${LC.tertiary};margin-left:8px;">ARMOR ${prot}${t.isProneCovered ? " 🧎🪨+1" : ""}</span>` : ""}
             ${isPC && pot > 0
               ? (canFullyAvoid
                   ? `<span style="color:${LC.green};margin-left:8px;">▶ Can avoid (${avoidVerb} ${pot})</span>`
                   : `<span style="color:${LC.yellow};margin-left:8px;">⚠ Minor injury if avoids (insufficient Stress)</span>`)
               : ""}
           </div>`
        : `<div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">
             No stress track${prot > 0 ? ` &nbsp;|&nbsp; <span style="color:${LC.tertiary};">ARMOR ${prot}${t.isProneCovered ? " 🧎🪨+1" : ""}</span>` : ""}
           </div>`;

      const injuryName  = CombatHUD._groundInjuryName(t.weaponName, t.useStun, pot, t.severity);
      const injuryColor = t.useStun ? LC.secondary : LC.red;

      // Base payload — adjustment is always relative to this
      const basePayloadObj = {
        tokenId:       t.tokenId,
        actorId:       t.actorId,
        injuryName,
        useStun:       t.useStun,
          severity:      t.severity,
          potency:       pot,
          basePotency:   pot,
          npcType:       t.npcType,
          isPlayerOwned: t.isPlayerOwned ?? false,
          currentStress: t.currentStress ?? 0,
          maxStress:     t.maxStress ?? 0,
          weaponColor:   t.weaponColor ?? "blue",
          weaponType:    t.weaponType  ?? "ground-beam",
        };
      const encodedPayload = encodeURIComponent(JSON.stringify(basePayloadObj));
      const encodedBase    = encodedPayload;

      return `
        <div style="margin-bottom:8px;padding:6px 8px;background:rgba(0,0,0,0.3);
          border-left:3px solid ${accentColor};border-radius:1px;">
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:3px;flex-wrap:wrap;">
            <div style="font-size:12px;font-weight:700;color:${LC.textBright};
              font-family:${LC.font};">${t.name}</div>
            <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              text-transform:uppercase;letter-spacing:0.08em;">
              ${isPC ? "Player / Supporting" : (isMinor ? "MINOR" : isNotable ? "NOTABLE" : "MAJOR") + " NPC"}
            </div>
          </div>
          <div style="font-size:9px;font-family:${LC.font};margin-bottom:4px;">
            ${avoidRule}
          </div>
          ${stressBar}
          <div style="font-size:10px;color:${LC.tertiary};font-family:${LC.font};
            margin-top:5px;margin-bottom:4px;">
            Injury if taken: <strong class="sta2e-injury-label" style="color:${injuryColor};">${injuryName}</strong>
          </div>
          <div class="sta2e-ground-controls">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap;">
              <label style="font-size:9px;color:${LC.textDim};white-space:nowrap;
                text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">
                ${isPC ? "Momentum:" : "Threat:"}
              </label>
              <input class="sta2e-ground-adj"
                type="number" value="0" min="-${pot}" max="2"
                data-base-payload="${encodedBase}"
                data-use-stun="${t.useStun}"
                data-weapon-name="${t.weaponName.replace(/"/g,"&quot;")}"
                data-severity="${t.severity}"
                data-protection="${prot}"
                data-base-potency="${pot}"
                style="width:44px;padding:2px 4px;background:${LC.bg};
                       border:1px solid ${LC.border};border-radius:2px;
                       color:${LC.text};font-size:12px;text-align:center;
                       font-family:${LC.font};"/>
              <span class="sta2e-potency-display"
                style="font-size:10px;color:${LC.textDim};font-family:${LC.font};">
                = Potency <strong style="color:${LC.tertiary};">${pot}</strong>
              </span>
            </div>
            ${prot > 0 ? `
            <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              margin-bottom:4px;padding-left:2px;">
              Protection ${prot}
              ${t.hasBraklul ? `<span style="color:${LC.primary};">(incl. +1 Brak'lul)</span>` : ""}
              ${t.isProneCovered ? `<span style="color:${LC.secondary};">(incl. +1 Prone in Cover)</span>` : ""}
              → SEV ${t.severity} − ${prot} = Potency ${pot}
            </div>` : ""}
            ${t.hasBraklul && prot <= 0 ? `
            <div style="font-size:9px;color:${LC.primary};font-family:${LC.font};
              margin-bottom:4px;padding-left:2px;">
              ★ Brak'lul: +1 Protection → Potency ${pot}
            </div>` : ""}
            <button class="sta2e-apply-injury"
              data-payload="${encodedPayload}"
              style="width:100%;padding:4px;
                background:${t.useStun ? "rgba(180,100,255,0.1)" : "rgba(255,50,50,0.1)"};
                border:1px solid ${injuryColor};border-radius:2px;color:${injuryColor};
                font-size:10px;font-weight:700;letter-spacing:0.1em;
                text-transform:uppercase;cursor:pointer;font-family:${LC.font};">
              APPLY INJURY → ${t.name}
            </button>
          </div>
        </div>`;
    }).join("");

    return lcarsCard(header, injColor, `
      <div style="margin-bottom:6px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
        <div style="font-size:11px;color:${LC.tertiary};font-family:${LC.font};">
          <strong style="color:${LC.textBright};">${weapon.name}</strong>
          — SEV ${severity} / DMG ${damage}
          <span style="color:${injColor};font-weight:700;font-size:9px;
            text-transform:uppercase;letter-spacing:0.1em;margin-left:6px;">
            ${useStun ? "⚡ STUN" : "☠ DEADLY"}
          </span>
        </div>
        ${qualityTags ? `<div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">${qualityTags}</div>` : ""}
      </div>
      ${threatNote}
      ${targetsHtml}
    `);
  }

  // ── Ground injury — interactive chat card avoidance ─────────────────────────

  static async _postInjuryDecisionCard(payload) {
    const { tokenId, actorId, injuryName, useStun, severity, potency,
            npcType, isPlayerOwned, currentStress: payloadStress = 0, maxStress: payloadStressMax = 0 } = payload;
    const actor    = canvas.tokens.get(tokenId)?.actor ?? game.actors.get(actorId);
    const tokenDoc = canvas.tokens.get(tokenId)?.document ?? null;
    if (!actor) return;

    const profile = CombatHUD.getGroundCombatProfile(actor, tokenDoc);
    const resolvedNpcType = npcType ?? profile.npcType ?? null;
    const resolvedIsPlayerOwned = typeof isPlayerOwned === "boolean"
      ? isPlayerOwned
      : profile.isPlayerOwned;
    const isNotable = resolvedNpcType === "notable";
    const isMajor   = resolvedNpcType === "major";
    const injColor  = useStun ? LC.secondary : LC.red;
    const tierColor = isMajor ? LC.orange : isNotable ? LC.yellow : LC.primary;
    const tierLabel = isMajor ? "Major NPC" : isNotable ? "Notable NPC" : null;

    const btnStyle = (color) =>
      `padding:4px 8px;background:rgba(0,0,0,0.3);border:1px solid ${color};` +
      `border-radius:2px;color:${color};font-size:10px;font-weight:700;` +
      `letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;font-family:${LC.font};`;

    let buttons   = "";
    let statusHtml = "";

    if (resolvedIsPlayerOwned) {
      const stressMode    = game.settings.get("sta2e-toolkit", "stressMode") ?? "countdown";
      const currentStress = payloadStressMax > 0
        ? payloadStress
        : (actor.system?.stress?.value ?? 0);
      const stressMax     = payloadStressMax > 0
        ? payloadStressMax
        : (actor.system?.stress?.max ?? 0);
      const stressAvail   = stressMode === "countup" ? (stressMax - currentStress) : currentStress;
      const canFullAvoid  = stressAvail >= potency;
      const canPartAvoid  = !canFullAvoid && stressAvail > 0;
      const avoidVerb     = stressMode === "countup" ? "Absorb" : "Spend";

      statusHtml = `<div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};margin-bottom:6px;">
        Stress: <strong style="color:${LC.text};">${currentStress}/${stressMax}</strong>
        &nbsp;—&nbsp; can ${avoidVerb.toLowerCase()} up to <strong>${stressAvail}</strong>
      </div>`;

      if (canFullAvoid) {
        buttons += `<button class="sta2e-injury-btn" data-choice="avoid"
          data-payload="${encodeURIComponent(JSON.stringify(payload))}"
          style="${btnStyle(LC.green)}">
          Avoid — ${avoidVerb} ${potency} Stress
        </button> `;
      }
      if (canPartAvoid) {
        buttons += `<button class="sta2e-injury-btn" data-choice="minor"
          data-payload="${encodeURIComponent(JSON.stringify(payload))}"
          style="${btnStyle(LC.yellow)}">
          Avoid — ${avoidVerb} ${stressAvail} Stress, take Minor Injury
        </button> `;
      }
      buttons += `<button class="sta2e-injury-btn" data-choice="take"
        data-payload="${encodeURIComponent(JSON.stringify(payload))}"
        style="${btnStyle(LC.red)}">
        Take Injury
      </button>`;

    } else if (isNotable) {
      const notableAvoided = tokenDoc?.getFlag("sta2e-toolkit", "notableAvoided") ?? false;
      const Tracker        = game.STATracker?.constructor;
      const currentThreat  = Tracker ? Tracker.ValueOf("threat") : 0;
      const personalThreat = CombatHUD.getNpcPersonalThreat(actor, tokenDoc);
      const canAvoidTotal    = !notableAvoided && (personalThreat + currentThreat) >= potency;

      statusHtml = `<div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};margin-bottom:6px;">
        Personal Threat: <strong style="color:${LC.orange};">${personalThreat}</strong>
        &nbsp;|&nbsp; Threat Pool: <strong style="color:${LC.yellow};">${currentThreat}</strong>
        ${notableAvoided
          ? `<span style="color:${LC.red};"> — already avoided once this encounter</span>`
          : !canAvoidTotal
            ? `<span style="color:${LC.red};"> — insufficient Threat (need ${potency})</span>`
            : ""}
      </div>`;

      if (canAvoidTotal) {
        buttons += `<button class="sta2e-injury-btn" data-choice="avoid-npc"
          data-payload="${encodeURIComponent(JSON.stringify(payload))}"
          style="${btnStyle(LC.orange)}">
          Avoid — Choose Spend (${potency})
        </button> `;
      }
      buttons += `<button class="sta2e-injury-btn" data-choice="take"
        data-payload="${encodeURIComponent(JSON.stringify(payload))}"
        style="${btnStyle(LC.red)}">
        Take Injury
      </button>`;

    } else if (isMajor) {
      const Tracker          = game.STATracker?.constructor;
      const currentThreat    = Tracker ? Tracker.ValueOf("threat") : 0;
      const personalThreat   = CombatHUD.getNpcPersonalThreat(actor, tokenDoc);
      const canAvoidTotal    = (personalThreat + currentThreat) >= potency;

      statusHtml = `<div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};margin-bottom:6px;">
        Personal Threat: <strong style="color:${LC.orange};">${personalThreat}</strong>
        &nbsp;|&nbsp; Threat Pool: <strong style="color:${LC.yellow};">${currentThreat}</strong>
      </div>`;

      if (canAvoidTotal) {
        buttons += `<button class="sta2e-injury-btn" data-choice="avoid-npc"
          data-payload="${encodeURIComponent(JSON.stringify(payload))}"
          style="${btnStyle(LC.orange)}">
          Avoid — Choose Spend (${potency})
        </button> `;
      }
      buttons += `<button class="sta2e-injury-btn" data-choice="take"
        data-payload="${encodeURIComponent(JSON.stringify(payload))}"
        style="${btnStyle(LC.red)}">
        Take Injury
      </button>`;

    } else {
      // Any unhandled case — offer Take Injury only
      buttons = `<button class="sta2e-injury-btn" data-choice="take"
        data-payload="${encodeURIComponent(JSON.stringify(payload))}"
        style="${btnStyle(LC.red)}">
        Take Injury
      </button>`;
    }

    const tierBadge = tierLabel
      ? ` <span style="color:${tierColor};font-size:10px;">(${tierLabel})</span>`
      : "";

    const bodyHtml = `
      <div style="font-size:12px;font-weight:700;color:${LC.textBright};
        font-family:${LC.font};margin-bottom:3px;">${actor.name}${tierBadge}</div>
      <div style="font-size:11px;font-family:${LC.font};margin-bottom:3px;">
        <strong style="color:${injColor};">${useStun ? "Stun" : "Deadly"} Injury</strong>
        — Potency <strong>${potency}</strong>
        <span style="font-size:9px;color:${LC.textDim};">&nbsp;(Sev ${severity})</span>
      </div>
      <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
        margin-bottom:6px;">${injuryName}</div>
      ${statusHtml}
      <div style="display:flex;flex-wrap:wrap;gap:4px;">${buttons}</div>
    `;

    const gmIds   = game.users.filter(u => u.isGM).map(u => u.id);
    const whisper = resolvedIsPlayerOwned
      ? [...new Set([...gmIds, ...game.users.filter(u => actor.testUserPermission(u, "OWNER")).map(u => u.id)])]
      : gmIds;

    await ChatMessage.create({
      content: lcarsCard("INJURY DECISION", injColor, bodyHtml),
      speaker: { alias: "STA2e Toolkit" },
      whisper,
      flags: {
        "sta2e-toolkit": {
          injuryDecisionCard: true,
          injuryPayload:      encodeURIComponent(JSON.stringify(payload)),
        },
      },
    });
  }

  static async _executeInjuryResolution(choice, payload, messageId) {
    const { tokenId, actorId, injuryName, useStun, severity, potency,
            npcType, isPlayerOwned, weaponColor, weaponType,
            currentStress: payloadStress = 0, maxStress: payloadStressMax = 0 } = payload;

    const actor    = canvas.tokens.get(tokenId)?.actor ?? game.actors.get(actorId);
    const tokenDoc = canvas.tokens.get(tokenId)?.document ?? null;
    if (!actor) return;

    const profile = CombatHUD.getGroundCombatProfile(actor, tokenDoc);
    const resolvedNpcType = npcType ?? profile.npcType ?? "minor";
    const resolvedIsPlayerOwned = typeof isPlayerOwned === "boolean"
      ? isPlayerOwned
      : profile.isPlayerOwned;
    const isMinorNpc  = !resolvedIsPlayerOwned && resolvedNpcType !== "major" && resolvedNpcType !== "notable";
    const isNotable   = resolvedNpcType === "notable";
    const isMajor     = resolvedNpcType === "major";
    const weaponName  = (payload.weaponName ?? injuryName ?? "").toLowerCase();
    const canVaporize = !useStun && (
      (weaponType === "ground-beam" && (weaponColor === "orange" || weaponColor === "green")) ||
      weaponType === "grenade" ||
      weaponName.includes("jem") || weaponName.includes("kar'takin") || weaponName.includes("kar takin")
    );

    const stressMode    = game.settings.get("sta2e-toolkit", "stressMode") ?? "countdown";
    const currentStress = payloadStressMax > 0
      ? payloadStress
      : (actor.system?.stress?.value ?? 0);
    const stressMax     = payloadStressMax > 0
      ? payloadStressMax
      : (actor.system?.stress?.max ?? 0);
    const stressAvail   = stressMode === "countup" ? (stressMax - currentStress) : currentStress;
    const avoidVerb     = stressMode === "countup" ? "Absorb" : "Spend";

    const doActorChanges = async ({ stressUpdate, createInjury, injName, qty }) => {
      if (stressUpdate !== undefined) await actor.update({ "system.stress.value": stressUpdate });
      if (createInjury) await actor.createEmbeddedDocuments("Item", [{
        name:   injName,
        type:   "injury",
        system: { description: "", quantity: qty ?? 1 },
      }]);
    };

    // ── Resolve choice ────────────────────────────────────────────────────────
    if (choice === "avoid" && resolvedIsPlayerOwned) {
      const newStress = stressMode === "countup"
        ? currentStress + potency
        : currentStress - potency;
      await doActorChanges({ stressUpdate: newStress });
      ChatMessage.create({
        content: lcarsCard("INJURY AVOIDED", LC.green, `
          <div style="font-size:12px;font-weight:700;color:${LC.textBright};
            font-family:${LC.font};margin-bottom:3px;">${actor.name}</div>
          <div style="font-size:11px;font-weight:700;font-family:${LC.font};
            color:${LC.green};margin-bottom:4px;">✓ AVOIDED — ${avoidVerb} ${potency} Stress</div>
          <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
            No injury taken. Stress: ${currentStress} → ${newStress}</div>
        `),
        speaker: { alias: "STA2e Toolkit" },
      });

    } else if (choice === "minor" && resolvedIsPlayerOwned) {
      const baseName     = injuryName.replace(/\s*\(.*\)$/, "");
      const minorInjName = `${baseName} (Minor)`;
      const finalStress  = stressMode === "countup" ? stressMax : 0;
      await doActorChanges({ stressUpdate: finalStress, createInjury: true, injName: minorInjName, qty: 1 });
      ChatMessage.create({
        content: lcarsCard("MINOR INJURY — PARTIAL AVOID", LC.yellow, `
          <div style="font-size:12px;font-weight:700;color:${LC.textBright};
            font-family:${LC.font};margin-bottom:3px;">${actor.name}</div>
          <div style="font-size:11px;font-weight:700;font-family:${LC.font};
            color:${LC.yellow};margin-bottom:4px;">MINOR INJURY — ${minorInjName}</div>
          <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
            ${avoidVerb} all available Stress (${stressAvail}) — takes a Minor Injury instead.
            Stress: ${currentStress} → ${finalStress}
          </div>
        `),
        speaker: { alias: "STA2e Toolkit" },
      });

    } else if (choice === "avoid-npc" && (isMajor || isNotable)) {
      const Tracker = game.STATracker?.constructor;
      const split = await CombatHUD.promptNpcThreatSplit(actor, tokenDoc, potency, isMajor ? "Major NPC" : "Notable NPC");
      if (!split) return;
      const { personalThreat, currentThreat, spendPersonal, spendPool } = split;
      const newPersonal = personalThreat - spendPersonal;
      const newThreat   = currentThreat - spendPool;
      if (Tracker) await Tracker.DoUpdateResource("threat", newThreat);
      await CombatHUD.setNpcPersonalThreat(actor, tokenDoc, newPersonal);
      if (isNotable && tokenDoc) await tokenDoc.setFlag("sta2e-toolkit", "notableAvoided", true);
      ChatMessage.create({
        content: lcarsCard("INJURY AVOIDED", isMajor ? LC.orange : LC.yellow, `
          <div style="font-size:12px;font-weight:700;color:${LC.textBright};
            font-family:${LC.font};margin-bottom:3px;">${actor.name}</div>
          <div style="font-size:11px;font-weight:700;font-family:${LC.font};
            color:${isMajor ? LC.orange : LC.yellow};margin-bottom:4px;">
            ✓ AVOIDED — ${isMajor ? "Major" : "Notable"} NPC split the cost</div>
          <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
            Personal Threat: ${personalThreat} → ${newPersonal} (${spendPersonal} spent)<br>
            Threat Pool: ${currentThreat} → ${newThreat} (${spendPool} spent)
          </div>
        `),
        speaker: { alias: "STA2e Toolkit" },
      });

    } else if (choice === "avoid-pool") {
      const Tracker       = game.STATracker?.constructor;
      const currentThreat = Tracker ? Tracker.ValueOf("threat") : 0;
      const tierLabel     = isMajor ? "Major" : "Notable";
      const tierColor     = isMajor ? LC.orange : LC.yellow;
      if (Tracker) await Tracker.DoUpdateResource("threat", currentThreat - potency);
      if (isNotable && tokenDoc) await tokenDoc.setFlag("sta2e-toolkit", "notableAvoided", true);
      ChatMessage.create({
        content: lcarsCard("INJURY AVOIDED", tierColor, `
          <div style="font-size:12px;font-weight:700;color:${LC.textBright};
            font-family:${LC.font};margin-bottom:3px;">${actor.name}</div>
          <div style="font-size:11px;font-weight:700;font-family:${LC.font};
            color:${tierColor};margin-bottom:4px;">
            ✓ AVOIDED — ${tierLabel} NPC spent ${potency} from Threat Pool</div>
          <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
            Threat: ${currentThreat} → ${currentThreat - potency}</div>
        `),
        speaker: { alias: "STA2e Toolkit" },
      });

    } else if (choice === "avoid-personal" && (isMajor || isNotable)) {
      const personalThreat = CombatHUD.getNpcPersonalThreat(actor, tokenDoc);
      const newPersonal    = Math.max(0, personalThreat - potency);
      await CombatHUD.setNpcPersonalThreat(actor, tokenDoc, newPersonal);
      if (isNotable && tokenDoc) await tokenDoc.setFlag("sta2e-toolkit", "notableAvoided", true);
      ChatMessage.create({
        content: lcarsCard("INJURY AVOIDED", isMajor ? LC.orange : LC.yellow, `
          <div style="font-size:12px;font-weight:700;color:${LC.textBright};
            font-family:${LC.font};margin-bottom:3px;">${actor.name}</div>
          <div style="font-size:11px;font-weight:700;font-family:${LC.font};
            color:${isMajor ? LC.orange : LC.yellow};margin-bottom:4px;">
            ✓ AVOIDED — ${isMajor ? "Major" : "Notable"} NPC spent ${potency} Personal Threat</div>
          <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
            Personal Threat: ${personalThreat} → ${newPersonal}</div>
        `),
        speaker: { alias: "STA2e Toolkit" },
      });

    } else {
      // "take" — apply the injury
      await doActorChanges({ createInjury: true, injName: injuryName, qty: potency });

      const injColor   = useStun ? LC.secondary : LC.red;
      const injTypeStr = useStun ? "STUN" : "DEADLY";
      let consequence;
      if (useStun) {
        consequence = `Character is <strong style="color:${LC.secondary};">INCAPACITATED</strong> — Stun injury`;
      } else if (isMinorNpc) {
        consequence = `Minor NPC — <strong style="color:${LC.red};">DEAD</strong>`;
      } else {
        consequence = `Character is <strong style="color:${LC.red};">DYING or DEAD</strong> — requires immediate treatment`;
      }

      ChatMessage.create({
        content: lcarsCard("INJURY APPLIED", injColor, `
          <div style="font-size:12px;font-weight:700;color:${LC.textBright};
            font-family:${LC.font};margin-bottom:3px;">${actor.name}</div>
          <div style="font-size:11px;font-weight:700;font-family:${LC.font};
            color:${injColor};margin-bottom:4px;">${injTypeStr} INJURY — ${injuryName}</div>
          <div style="font-size:10px;color:${LC.text};font-family:${LC.font};
            margin-bottom:3px;">${consequence}</div>
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">
            Potency ${potency} / Severity ${severity}</div>
        `),
        speaker: { alias: "STA2e Toolkit" },
      });

      // Apply conditions to token
      const targetToken = canvas.tokens.get(tokenId);
      if (targetToken && game.user.isGM) {
        if (useStun) {
          await removeCondition(targetToken, "dying");
          CombatHUD._removeDyingSplashFX(targetToken);
          await removeCondition(targetToken, "dead");
          await addCondition(targetToken, "stun");
        } else if (isMinorNpc) {
          await removeCondition(targetToken, "stun");
          await removeCondition(targetToken, "dying");
          CombatHUD._removeDyingSplashFX(targetToken);
          await addCondition(targetToken, "dead");
          CombatHUD._applyDeathSplashFX(targetToken);
        } else {
          await removeCondition(targetToken, "stun");
          await addCondition(targetToken, "dying");
          CombatHUD._applyDyingSplashFX(targetToken, weaponType);
        }
      }

      // Vaporize / death outcome dialogs (GM only, deadly only)
      if (!useStun && game.user.isGM) {
        const token = canvas.tokens.get(tokenId);

        if (isMinorNpc && token) {
          const autoVaporize = (() => {
            try { return game.settings.get("sta2e-toolkit", "autoVaporizeMinorNpc"); }
            catch { return true; }
          })();

          if (autoVaporize) {
            CombatHUD._removeDeathSplashFX(token);
            if (canVaporize) await CombatHUD._vaporizeToken(token, weaponColor);
          } else {
            const minorButtons = [
              { action: "dead", label: "Dead (token stays)", icon: "fas fa-skull", default: !canVaporize },
            ];
            if (canVaporize) {
              minorButtons.unshift({ action: "vaporized", label: "💀 Vaporized (FX + Remove)", icon: "fas fa-fire", default: true });
            }
            minorButtons.push({ action: "keep", label: "Keep Token on Canvas", icon: "fas fa-eye" });

            const minorChoice = await foundry.applications.api.DialogV2.wait({
              window:  { title: `${actor.name} — Minor NPC Death` },
              content: `<p style="margin:8px 0;font-size:12px;">
                <strong>${actor.name}</strong> is a minor NPC and is instantly killed.<br>
                Choose what happens to the token:</p>`,
              buttons: minorButtons,
            });

            if (minorChoice === "vaporized" && canVaporize) {
              CombatHUD._removeDeathSplashFX(token);
              await CombatHUD._vaporizeToken(token, weaponColor);
            }
          }
          await CombatHUD._markInjuryCardResolved(messageId, actor.name);
          return;
        }

        // PC / notable / major NPC — offer dying/dead/vaporize choice
        const deathButtons = [
          { action: "dying",  label: "Dying (survives with treatment)", icon: "fas fa-heart-pulse", default: true },
          { action: "dead",   label: "Instantly Dead (token stays)",    icon: "fas fa-skull" },
        ];
        if (canVaporize) {
          deathButtons.push({ action: "vaporized", label: "💀 Vaporized (instant death + FX)", icon: "fas fa-fire" });
        }

        if (token) {
          const deathChoice = await foundry.applications.api.DialogV2.wait({
            window:  { title: `${actor.name} — Deadly Injury Outcome` },
            content: `<p style="margin:8px 0;font-size:12px;">
              <strong>${actor.name}</strong> took a deadly injury and failed to avoid it.<br>
              Choose the outcome:</p>`,
            buttons: deathButtons,
          });

          if (deathChoice === "vaporized" && canVaporize) {
            await removeCondition(token, "dying");
            CombatHUD._removeDyingSplashFX(token);
            await removeCondition(token, "dead");
            CombatHUD._removeDeathSplashFX(token);
            await CombatHUD._vaporizeToken(token, weaponColor);
          } else if (deathChoice === "dead") {
            await removeCondition(token, "dying");
            CombatHUD._removeDyingSplashFX(token);
            await addCondition(token, "dead");
            CombatHUD._applyDeathSplashFX(token);
          }
          // "dying" — condition already set above
        }
      }
    }

    // Mark decision card resolved
    await CombatHUD._markInjuryCardResolved(messageId, actor.name);
  }

  static async _markInjuryCardResolved(messageId, actorName) {
    if (!messageId) return;
    const msg = game.messages.get(messageId);
    if (!msg) return;
    await msg.update({
      "flags.sta2e-toolkit.injuryResolved": true,
      content: lcarsCard("INJURY DECISION", LC.textDim, `
        <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};opacity:0.6;">
          Resolved — ${actorName ?? ""}
        </div>
      `),
    });
  }

  static async applyGroundInjury(payload) {
    const { tokenId, actorId, injuryName, useStun, potency,
            npcType, isPlayerOwned } = payload;

    if (potency < 1) {
      ChatMessage.create({
        content: lcarsCard("ATTACK NEGATED", LC.textDim, `
          <div style="font-size:12px;font-weight:700;color:${LC.textBright};
            font-family:${LC.font};margin-bottom:3px;">No Effect</div>
          <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
            Complication reduced potency to 0 — the attack deals no injury.
          </div>
        `),
        speaker: { alias: "STA2e Toolkit" },
      });
      return;
    }

    const actor = canvas.tokens.get(tokenId)?.actor ?? game.actors.get(actorId);
    if (!actor) {
      ui.notifications.error("STA2e Toolkit: Could not find target actor for injury.");
      return;
    }

    const tokenDoc = canvas.tokens.get(tokenId)?.document ?? null;
    const profile  = CombatHUD.getGroundCombatProfile(actor, tokenDoc);
    const resolvedNpcType = npcType ?? profile.npcType ?? "minor";
    const resolvedIsPlayerOwned = typeof isPlayerOwned === "boolean"
      ? isPlayerOwned
      : profile.isPlayerOwned;
    const isMinorNpc = !resolvedIsPlayerOwned && resolvedNpcType !== "major" && resolvedNpcType !== "notable";

    // Minor NPCs: apply directly, no avoidance choice
    if (isMinorNpc) {
      await CombatHUD._executeInjuryResolution("take", payload, null);
      return;
    }

    // PC / Supporting / Notable / Major: post interactive decision card
    try {
      await CombatHUD._postInjuryDecisionCard(payload);
    } catch(err) {
      console.error("STA2e Toolkit | _postInjuryDecisionCard failed:", err);
      ui.notifications.error("Failed to post injury decision card — see console for details.");
    }
  }

  // ── Dying wound splash TMFX — applied while character is in dying state ──────
  // Melee weapons: red blood. Energy weapons: black char marks.

  static _applyDyingSplashFX(token, weaponType = "melee") {
    if (!window.TokenMagic) return;
    try {
      if (TokenMagic.hasFilterId(token, "sta2e-dying-splash")) return;
      const isEnergy = weaponType === "ground-beam" || weaponType === "grenade";
      const params = [{
        filterType:        "splash",
        filterId:          "sta2e-dying-splash",
        rank:              5,
        color:             isEnergy ? 0x111111 : 0x990505,
        padding:           80,
        time:              Math.random() * 1000,
        seed:              Math.random(),
        splashFactor:      7,
        spread:            3,
        blend:             1,
        dimX:              1,
        dimY:              1,
        cut:               false,
        textureAlphaBlend: true,
        anchorX:           0.32 + (Math.random() * 0.36),
        anchorY:           0.32 + (Math.random() * 0.36),
      }];
      TokenMagic.addFilters(token, params);
    } catch(e) {
      console.warn("STA2e Toolkit | Dying splash FX failed:", e);
    }
  }

  static _removeDyingSplashFX(token) {
    if (!window.TokenMagic) return;
    try {
      if (TokenMagic.hasFilterId(token, "sta2e-dying-splash")) {
        TokenMagic.deleteFilters(token, "sta2e-dying-splash");
      }
    } catch {}
  }

  // ── Death splash TMFX — blood pool for non-vaporized deaths ─────────────────

  static _applyDeathSplashFX(token) {
    if (!window.TokenMagic) return;
    try {
      if (TokenMagic.hasFilterId(token, "sta2e-death-splash")) return;
      const params = [{
        filterType:        "splash",
        filterId:          "sta2e-death-splash",
        color:             0x900505,
        padding:           30,
        time:              Math.random() * 1000,
        seed:              Math.random() / 100,
        splashFactor:      2,
        spread:            7,
        blend:             1,
        dimX:              1,
        dimY:              1,
        cut:               true,
        textureAlphaBlend: false,
      }];
      TokenMagic.addFilters(token, params);
    } catch(e) {
      console.warn("STA2e Toolkit | Death splash FX failed:", e);
    }
  }

  static _removeDeathSplashFX(token) {
    if (!window.TokenMagic) return;
    try {
      if (TokenMagic.hasFilterId(token, "sta2e-death-splash")) {
        TokenMagic.deleteFilters(token, "sta2e-death-splash");
      }
    } catch {}
  }

  // ── Vaporize effect — Devouring Fire TMFX + fade out + token delete ──────────

  static async _vaporizeToken(token, weaponColor = "orange") {
    if (!window.TokenMagic) {
      // Fallback: just fade and delete without FX
      await CombatHUD._fadeAndDeleteToken(token);
      return;
    }

    // Color the glow to match the weapon:
    //  phaser = orange, disruptor = green, grenade/Jem'Hadar = orange
    const glowColor = weaponColor === "green" ? 0x00AA44 : 0xAA6500;

    const params = [
      {
        filterType:   "fire",
        filterId:     "sta2e-vaporize-fire",
        intensity:    3,
        color:        0xFFFFFF,
        amplitude:    2,
        time:         0,
        blend:        10,
        fireBlend:    1,
        alphaDiscard: true,
        zOrder:       50,
        animated: {
          time: { active: true, speed: -0.0024, animType: "move" }
        }
      },
      {
        filterType:    "glow",
        filterId:      "sta2e-vaporize-glow",
        outerStrength: 4,
        innerStrength: 2,
        color:         glowColor,
        quality:       0.5,
        padding:       10,
        zOrder:        100,
      }
    ];

    try {
      // Apply devouring fire effect
      await TokenMagic.addUpdateFilters(token, params);

      // Hold for dramatic effect, then fade and delete
      await new Promise(r => setTimeout(r, 1200));
      await CombatHUD._fadeAndDeleteToken(token, 800);

    } catch(e) {
      console.warn("STA2e Toolkit | Vaporize effect failed:", e);
      await CombatHUD._fadeAndDeleteToken(token);
    }
  }

  static async _fadeAndDeleteToken(token, fadeMs = 600) {
    if (!token) return;
    try {
      const steps = 10;
      const stepDelay = fadeMs / steps;
      const startAlpha = token.document.alpha ?? 1;
      for (let i = 1; i <= steps; i++) {
        await new Promise(r => setTimeout(r, stepDelay));
        await token.document.update({ alpha: Math.max(0, startAlpha * (1 - i / steps)) });
      }
      if (game.user.isGM && canvas.tokens.get(token.id)) {
        await token.document.delete();
      }
    } catch(e) {
      console.warn("STA2e Toolkit | Token fade/delete failed:", e);
    }
  }

  // ── Shield Portrait Mode ────────────────────────────────────────────────────

  /** Get the portrait URL for a ship, with fallback to actor.img */
  _getPortraitUrl(actor) {
    if (this._portraitUrl !== null) return this._portraitUrl;
    // Priority: shield diagram > custom shield portrait > actor image
    const shieldDiagram = actor.flags?.["sta2e-toolkit"]?.shieldDiagram;
    const customUrl = actor.flags?.["sta2e-toolkit"]?.shieldPortrait;
    const portraitUrl = shieldDiagram || customUrl || actor.img || null;
    this._portraitUrl = portraitUrl;
    return portraitUrl;
  }

  /** Calculate shield glow properties based on shield percentage */
  _calculateShieldGlow(percentage) {
    let color, glowRadius;
    const blueColor = "#3399ff";  // Bright blue for healthy shields
    if (percentage === 0) {
      color = LC.red;  // Red for no shields
      glowRadius = 2;
    } else if (percentage > 0.5) {
      color = blueColor;
      glowRadius = 2 + (percentage * 6);
    } else {
      color = LC.yellow;  // Yellow from 1% to 50%
      glowRadius = 2 + (percentage * 6);
    }

    // Create filter for glow effect that follows the ship's contour
    // drop-shadow respects image transparency, unlike box-shadow
    const filterCSS = `drop-shadow(0 0 ${Math.round(glowRadius)}px ${color})`;
    return { color, glowRadius, filterCSS };
  }

  /** Adjust shields from portrait click (same as bubble click) */
  async _adjustShieldsFromPortrait(actor, shieldAmount) {
    await actor.update({ "system.shields.value": shieldAmount });
    this._refresh();
  }

  /** Toggle between bubble and portrait shield display modes */
  _toggleShieldPortraitMode() {
    this._shieldPortraitMode = !this._shieldPortraitMode;
    localStorage.setItem("sta2e-toolkit-shieldPortraitMode", this._shieldPortraitMode ? "1" : "0");
    this._refresh();
  }
}

// ── openWeaponAttackForOfficer ────────────────────────────────────────────────
// Open the weapon-attack dice roller on behalf of a specific bridge officer.
// Called from the character-sheet combat task panel when the player selects a
// weapon at the Tactical station.  Mirrors the logic in the Combat HUD's own
// weapon-button handler so results are identical to those produced via the HUD.
//
// @param {Actor}  shipActor  - The ship actor that owns the weapon
// @param {Token}  shipToken  - The ship's canvas token (placeables entry)
// @param {Item}   weapon     - The starshipweapon2e item to fire
// @param {object} officer    - readOfficerStats() result for the firing officer

export function openWeaponAttackForOfficer(shipActor, shipToken, weapon, officer) {
  const weaponCtx       = buildWeaponContext(weapon);
  const tokenDoc        = shipToken?.document ?? null;
  const hasTS           = CombatHUD.hasTargetingSolution(shipToken);
  const hasRFT          = hasRapidFireTorpedoLauncher(shipActor) && weaponCtx.isTorpedo;
  const hasAP           = shipToken ? hasCondition(shipToken, "attack-pattern") : false;
  const helmActors      = getStationOfficers(shipActor, "helm");
  const helmActor       = helmActors[0] ?? null;
  const helmOfficer     = helmActor ? readOfficerStats(helmActor) : null;
  const attackRunActive = hasAP && hasAttackRun(helmActor);

  openPlayerRoller(shipActor, shipToken, {
    stationId:            "tactical",
    officer,
    weaponContext:        weaponCtx,
    hasTargetingSolution: hasTS,
    hasRapidFireTorpedo:  hasRFT,
    hasAttackPattern:     hasAP,
    helmOfficer,
    attackRunActive,
    taskLabel: `Attack — ${weapon.name}`,
  });
}

/**
 * Apply the Scan for Weakness condition to a target token.
 * Shared between the Combat HUD path and the character-sheet combat task panel path
 * so both produce an identical chat card and animation.
 *
 * @param {Token}  sourceToken  - The attacking ship canvas token
 * @param {Token}  targetToken  - The enemy ship canvas token to flag
 * @param {string} sourceName   - Override display name (defaults to sourceToken's actor name)
 * @returns {string} LCARS chat card HTML to post
 */
export async function applyScanForWeakness(sourceToken, targetToken, sourceName) {
  const targetName    = targetToken?.actor?.name ?? "target";
  const displayName   = sourceName ?? sourceToken?.actor?.name ?? "Unknown";
  const sourceTokenId = doc(sourceToken)?.id ?? null;

  if (game.user.isGM) {
    await addCondition(targetToken, "scan-for-weakness");
    await doc(targetToken).setFlag(MODULE, "scanForWeaknessSource",   displayName);
    await doc(targetToken).setFlag(MODULE, "scanForWeaknessSourceId", sourceTokenId);
    try { await fireScanForWeakness(sourceToken, targetToken); } catch {}
  } else {
    game.socket.emit("module.sta2e-toolkit", {
      action:        "applyScanForWeakness",
      sourceTokenId,
      targetTokenId: doc(targetToken)?.id ?? null,
      sourceName:    displayName,
    });
  }

  return lcarsCard(
    "Scan for Weakness — Active",
    LC.primary,
    `<div style="font-size:11px;font-weight:700;color:${LC.tertiary};
        margin-bottom:4px;font-family:${LC.font};">
      ${displayName} → ${targetName}
    </div>
    <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
      +2 damage or Piercing on next attack against ${targetName}.
    </div>`
  );
}

/**
 * Apply an Evasive Action or Defensive Fire condition to a ship on behalf of a
 * player rolling from the character-sheet combat task panel. Shows a confirm
 * dialog, then applies the condition and posts the LCARS chat card.
 *
 * Injected into combatTaskContext.applyDefenseMode in main.js to avoid a
 * circular import (npc-roller.js → combat-hud.js already exists).
 *
 * @param {Actor}  shipActor    - The ship actor to apply the condition to
 * @param {Token}  shipToken    - The ship's canvas token
 * @param {string} conditionKey - "evasive-action" | "defensive-fire"
 */
export async function applyDefenseModeForOfficer(shipActor, shipToken, conditionKey) {
  const isAttackPattern = conditionKey === "attack-pattern";
  const label = conditionKey === "evasive-action" ? "Evasive Action"
              : conditionKey === "defensive-fire"  ? "Defensive Fire"
              : "Attack Pattern";
  const description = isAttackPattern
    ? "Conn officer may assist the next attack roll."
    : "Incoming attacks against this vessel are now Opposed Tasks. Expires next turn.";

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window:  { title: label },
    content: `<p style="font-family:${LC.font};font-size:11px;
      color:${LC.text};padding:4px 0;">
      Did the <strong>${label}</strong> task succeed for
      <strong>${shipActor?.name ?? "the ship"}</strong>?
    </p>`,
    yes: { label: "Yes — Apply", icon: "fas fa-check", default: true },
    no:  { label: "No",          icon: "fas fa-times" },
  });
  if (!confirmed) return;

  await addCondition(shipToken, conditionKey);
  try {
    if (isAttackPattern) await fireAttackPattern(shipToken);
    else                 await fireDefenseMode(shipToken, conditionKey);
  } catch {}
  ChatMessage.create({
    content: lcarsCard(
      `${label} — ACTIVE`,
      LC.primary,
      `<div style="font-size:11px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">
        ${shipActor?.name ?? "Ship"}
      </div>
      <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
        ${description}
      </div>`
    ),
    speaker: { alias: "STA2e Toolkit" },
  });
}

/**
 * Apply the Modulate Shields instant action on behalf of a character-sheet officer.
 * Mirrors CombatHUD._handleModulateShields — no dice roll; toggles the modulated-shields
 * flag and posts the result card.
 *
 * @param {Actor} shipActor  - The ship actor
 * @param {Token} shipToken  - The ship's canvas token (unused but kept for consistency)
 */
export async function applyModulateShieldsForOfficer(shipActor, shipToken) {
  const curShield = shipActor?.system?.shields?.value ?? 0;

  if (curShield <= 0) {
    ui.notifications.warn(`${shipActor?.name ?? "Ship"}: Shields are at 0 — cannot modulate.`);
    ChatMessage.create({
      content: lcarsCard("🔰 MODULATE SHIELDS FAILED", LC.red, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
        <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
          Shields are at 0 — cannot modulate shield frequencies.
          Restore shields before attempting this action.
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
    return;
  }

  const isActive = CombatHUD.getModulatedShields(shipActor);
  await CombatHUD.setModulatedShields(shipActor, !isActive);

  if (!isActive) {
    ChatMessage.create({
      content: lcarsCard("🔰 SHIELDS MODULATED", LC.primary, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
        <div style="font-size:20px;font-weight:700;color:${LC.primary};
          text-align:center;padding:6px 0;font-family:${LC.font};">
          +2 Resistance
        </div>
        <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
          text-align:center;line-height:1.5;">
          Shield frequencies modulated. Ship Resistance increased by 2
          until the end of the round or the next attack.
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
  } else {
    ChatMessage.create({
      content: lcarsCard("🔰 SHIELD MODULATION CLEARED", LC.textDim, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
        <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
          Shield modulation cleared — Resistance bonus removed.
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
  }

  game.sta2eToolkit?.combatHud?._refresh?.();
}

/**
 * Toggle Calibrate Weapons on behalf of a character-sheet tactical officer.
 * Returns the new active state (true = calibrated, false = cleared).
 */
export async function applyCalibrateWeaponsForOfficer(shipActor, shipToken) {
  const isActive = CombatHUD.hasCalibrateWeapons(shipToken);
  await CombatHUD.setCalibrateWeapons(shipToken, !isActive);
  ChatMessage.create({
    content: lcarsCard(
      `🔩 Calibrate Weapons — ${isActive ? "CLEARED" : "ACTIVE"}`,
      isActive ? LC.red : LC.primary,
      `<div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
       <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
         ${isActive
           ? "Calibrate Weapons cleared."
           : "Weapons calibrated. Next attack with ship's weapons increases damage by 1."}
       </div>`
    ),
    speaker: { alias: "STA2e Toolkit" },
  });
  game.sta2eToolkit?.combatHud?._refresh?.();
  return !isActive;
}

/**
 * Toggle Targeting Solution on behalf of a character-sheet tactical officer.
 * On activation stores pending benefit state; benefit must be declared separately.
 * Returns the new active state.
 */
export async function applyTargetingSolutionForOfficer(shipActor, shipToken) {
  const isActive = CombatHUD.hasTargetingSolution(shipToken);

  if (isActive) {
    await CombatHUD.setTargetingSolution(shipToken, false);
    ChatMessage.create({
      content: lcarsCard("🎯 Targeting Solution — CLEARED", LC.red,
        `<div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
         <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
           Targeting Solution cleared.
         </div>`
      ),
      speaker: { alias: "STA2e Toolkit" },
    });
    game.sta2eToolkit?.combatHud?._refresh?.();
    return false;
  }

  await CombatHUD.setTargetingSolution(shipToken, { active: true, benefit: null, system: null });
  const target = Array.from(game.user.targets ?? [])[0] ?? null;
  if (target) try { fireTargetingSolution(shipToken, target); } catch {}
  const hasFTS = hasFastTargetingSystems(shipActor);
  ChatMessage.create({
    content: lcarsCard("🎯 Targeting Solution — ACTIVE", LC.primary,
      `<div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
       <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
         ${hasFTS
           ? "Fast Targeting Systems active — choose a system to target from the combat HUD (reroll d20 is automatic)."
           : "Targeting Solution active — select your benefit from the combat HUD."}
       </div>`
    ),
    speaker: { alias: "STA2e Toolkit" },
  });
  game.sta2eToolkit?.combatHud?._refresh?.();
  return true;
}

/**
 * Consume the Targeting Solution benefit on behalf of a character-sheet tactical
 * officer. Stores the chosen benefit on the token flag and posts a chat card.
 * benefit: "reroll" | "system" | "both"
 * system:  system key string, or null for random
 */
export async function consumeTargetingSolutionForOfficer(shipActor, shipToken, benefit, system = null) {
  if (!CombatHUD.hasTargetingSolution(shipToken)) return;
  const hasFTS = hasFastTargetingSystems(shipActor);
  const effectiveBenefit = hasFTS ? "both" : benefit;
  await CombatHUD.setTargetingSolution(shipToken, { active: true, benefit: effectiveBenefit, system: system ?? null });
  const sysLabel = system ? CombatHUD.systemLabel(system) : "random roll";
  let description;
  if (effectiveBenefit === "reroll") {
    description = "Re-rolling 1d20 on this attack.";
  } else if (effectiveBenefit === "system") {
    description = `Targeting the ${sysLabel} system on next hit.`;
  } else {
    description = `Fast Targeting Systems: targeting the ${sysLabel} system on next hit + free d20 reroll.`;
  }
  ChatMessage.create({
    content: lcarsCard(
      `🎯 Targeting Solution — ${effectiveBenefit === "reroll" ? "REROLL" : "TARGET SYSTEM"}`,
      LC.primary,
      `<div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
       <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">${description}</div>`
    ),
    speaker: { alias: "STA2e Toolkit" },
  });
  game.sta2eToolkit?.combatHud?._refresh?.();
}

/**
 * Show the Prepare dialog and apply the chosen action (arm/disarm/lower/raise)
 * on behalf of a character-sheet tactical officer. Mirrors _handlePrepare.
 */
export async function applyPrepareForOfficer(shipActor, shipToken) {
  const weaponsArmed = CombatHUD.getWeaponsArmed(shipActor);
  const shieldsDown  = CombatHUD.getShieldsLowered(shipActor);
  const curShields   = shipActor?.system?.shields?.value ?? 0;
  const maxShields   = shipActor?.system?.shields?.max   ?? 0;

  let choice = null;
  const result = await foundry.applications.api.DialogV2.wait({
    window:  { title: `Prepare — ${shipActor?.name ?? "Ship"}` },
    content: `
      <div style="font-family:${LC.font};padding:4px 0;display:flex;flex-direction:column;gap:6px;">
        <div style="font-size:10px;color:${LC.textDim};line-height:1.5;margin-bottom:4px;">
          Choose what to prepare this minor action.
        </div>
        ${[
          { key: "arm",    icon: "⚡", label: "Arm Weapons",   desc: "Ready weapons for attack. Enemy ships can detect armed weapons.",
            active: weaponsArmed,  activeLabel: "Currently ARMED"    },
          { key: "disarm", icon: "⚡", label: "Disarm Weapons", desc: "Stand down weapons systems.",
            active: !weaponsArmed, activeLabel: "Currently UNARMED"  },
          { key: "lower",  icon: "🛡️", label: "Lower Shields",  desc: `Set shields to 0. Current: ${curShields}/${maxShields}.`,
            active: shieldsDown,   activeLabel: "Shields LOWERED"    },
          { key: "raise",  icon: "🛡️", label: "Raise Shields",  desc: `Restore shields to max. Saved max: ${CombatHUD.getShieldsSavedMax(shipActor) ?? maxShields}.`,
            active: !shieldsDown,  activeLabel: "Shields RAISED"     },
        ].map(o => `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
            padding:5px 8px;border-radius:2px;
            border:1px solid ${o.active ? LC.primary : LC.borderDim};
            background:${o.active ? "rgba(255,153,0,0.07)" : LC.panel};">
            <input type="radio" name="prepare-choice" value="${o.key}"
              style="accent-color:${LC.primary};" />
            <div style="flex:1;">
              <span style="font-size:11px;font-weight:700;color:${LC.text};
                font-family:${LC.font};">${o.icon} ${o.label}</span>
              <span style="font-size:10px;color:${LC.textDim};font-family:${LC.font};"> — ${o.desc}</span>
            </div>
            ${o.active ? `<span style="font-size:9px;color:${LC.primary};font-weight:700;
              font-family:${LC.font};">${o.activeLabel}</span>` : ""}
          </label>`).join("")}
      </div>`,
    buttons: [
      {
        action:   "confirm",
        label:    "Confirm",
        icon:     "fas fa-check",
        default:  true,
        callback: (event, btn, dlg) => {
          const el = dlg.element ?? btn.closest(".app.dialog-v2");
          choice = el?.querySelector("input[name='prepare-choice']:checked")?.value ?? null;
        },
      },
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
    ],
  });
  if (result !== "confirm" || !choice) return;

  if (choice === "arm") {
    await CombatHUD.setWeaponsArmed(shipActor, true);
    ChatMessage.create({
      content: lcarsCard("⚡ WEAPONS ARMED", LC.red, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
        <div style="font-size:16px;font-weight:700;color:${LC.red};
          text-align:center;padding:6px 0;font-family:${LC.font};">⚡ WEAPONS ARMED</div>
        <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
          text-align:center;line-height:1.5;">
          Weapons systems are armed and ready to fire.
          Enemy ships with sensors may detect active weapon locks.
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
  } else if (choice === "disarm") {
    await CombatHUD.setWeaponsArmed(shipActor, false);
    ChatMessage.create({
      content: lcarsCard("⚡ WEAPONS STANDING DOWN", LC.textDim, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
        <div style="font-size:14px;font-weight:700;color:${LC.textDim};
          text-align:center;padding:5px 0;font-family:${LC.font};">Weapons Disarmed</div>
        <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};text-align:center;">
          Weapon systems standing down. Cannot make Weapons Attacks while unarmed.
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
  } else if (choice === "lower") {
    await CombatHUD.setShieldsLowered(shipActor, true, curShields);
    const doc = shipActor.isToken && shipActor.token && !shipActor.token.isLinked
      ? shipActor.token
      : shipActor.isToken ? (game.actors.get(shipActor.id ?? shipActor._id) ?? shipActor) : shipActor;
    await doc?.setFlag("sta2e-toolkit", "shieldsSavedMax2", maxShields).catch(() => {});
    await shipActor.update({ "system.shields.value": 0, "system.shields.max": 0 });
    ChatMessage.create({
      content: lcarsCard("🛡️ SHIELDS LOWERED", LC.primary, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
        <div style="font-size:20px;font-weight:700;color:${LC.primary};
          text-align:center;padding:6px 0;font-family:${LC.font};">🛡️ → 0</div>
        <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
          text-align:center;line-height:1.5;">
          Shields offline. Will restore to ${curShields}/${maxShields} when raised.
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
  } else if (choice === "raise") {
    const doc = shipActor.isToken && shipActor.token && !shipActor.token.isLinked
      ? shipActor.token
      : shipActor.isToken ? (game.actors.get(shipActor.id ?? shipActor._id) ?? shipActor) : shipActor;
    const savedValue = CombatHUD.getShieldsSavedMax(shipActor) ?? curShields;
    const savedMax2  = doc?.getFlag("sta2e-toolkit", "shieldsSavedMax2") ?? maxShields;
    await CombatHUD.setShieldsLowered(shipActor, false);
    await doc?.unsetFlag("sta2e-toolkit", "shieldsSavedMax2").catch(() => {});
    await shipActor.update({
      "system.shields.max":   savedMax2,
      "system.shields.value": Math.min(savedValue, savedMax2),
    });
    ChatMessage.create({
      content: lcarsCard("🛡️ SHIELDS RAISED", LC.green, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
        <div style="font-size:20px;font-weight:700;color:${LC.green};
          text-align:center;padding:6px 0;font-family:${LC.font};">
          🛡️ ${Math.min(savedValue, savedMax2)}/${savedMax2}
        </div>
        <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
          text-align:center;line-height:1.5;">Shields restored to previous level.</div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
  }

  game.sta2eToolkit?.combatHud?._refresh?.();
}

/**
 * Post the IMPULSE info card on behalf of a helm officer in the character-sheet
 * combat task panel. Mirrors _handleInfoAction("impulse") with the engage button.
 */
export async function applyImpulseForOfficer(shipActor, shipToken) {
  const allowedUserIds = getStationAllowedUserIds(shipActor, "helm");
  const engagePayload = encodeURIComponent(
    JSON.stringify({ actorId: shipActor.id, tokenId: shipToken?.id ?? null })
  );
  ChatMessage.create({
    flags: { "sta2e-toolkit": { impulseEngageCard: true, allowedUserIds } },
    content: lcarsCard("IMPULSE", LC.red, `
      <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
        margin-bottom:6px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;gap:8px;align-items:baseline;">
          <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;min-width:72px;flex-shrink:0;">
            Movement
          </span>
          <span style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            Up to 2 zones (anywhere within Long range)
          </span>
        </div>
        <div style="display:flex;gap:8px;align-items:baseline;">
          <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;min-width:72px;flex-shrink:0;">
            Bonus
          </span>
          <span style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            Moving only 1 zone reduces Momentum cost of difficult/hazardous terrain by 1
          </span>
        </div>
        <div style="margin-top:3px;padding:4px 7px;
          background:rgba(255,153,0,0.06);border-left:2px solid ${LC.red};
          border-radius:2px;font-size:10px;color:${LC.textDim};font-family:${LC.font};">
          Minor action. Uses impulse engines.
        </div>
        <button class="sta2e-impulse-engage"
          data-payload="${engagePayload}"
          style="margin-top:4px;width:100%;padding:6px;
            background:rgba(255,50,50,0.12);border:1px solid ${LC.red};border-radius:2px;
            color:${LC.red};font-size:11px;font-weight:700;
            letter-spacing:0.1em;text-transform:uppercase;
            cursor:pointer;font-family:${LC.font};">
          🔴 ENGAGE IMPULSE
        </button>
      </div>`),
    speaker: { alias: "STA2e Toolkit" },
  });
}

/**
 * Post the THRUSTERS info card on behalf of a helm officer in the character-sheet
 * combat task panel. Mirrors _handleInfoAction("thrusters").
 */
export async function applyThrustersForOfficer(shipActor, _shipToken) {
  ChatMessage.create({
    content: lcarsCard("THRUSTERS", LC.primary, `
      <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
        margin-bottom:6px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;gap:8px;align-items:baseline;">
          <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;min-width:72px;flex-shrink:0;">
            Movement
          </span>
          <span style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            Anywhere within your current zone
          </span>
        </div>
        <div style="display:flex;gap:8px;align-items:baseline;">
          <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;min-width:72px;flex-shrink:0;">
            Special
          </span>
          <span style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            May move safely into Contact with another ship, station, or object (including docking/landing)
          </span>
        </div>
        <div style="margin-top:3px;padding:4px 7px;
          background:rgba(255,153,0,0.06);border-left:2px solid ${LC.primary};
          border-radius:2px;font-size:10px;color:${LC.textDim};font-family:${LC.font};">
          Minor action. Uses maneuvering thrusters — fine positional adjustment only.
        </div>
      </div>`),
    speaker: { alias: "STA2e Toolkit" },
  });
}

/**
 * Toggle Calibrate Sensors on behalf of a character-sheet sensor officer.
 * Mirrors the calibrate-sensors case in _handleQuickAction. Returns the new state.
 */
export async function applyCalibrateSensorsForOfficer(shipActor, shipToken) {
  const isActive = CombatHUD.hasCalibratesensors(shipToken);
  await CombatHUD.setCalibratesensors(shipToken, !isActive);
  ChatMessage.create({
    content: lcarsCard(
      `🎚️ Calibrate Sensors — ${isActive ? "CLEARED" : "ACTIVE"}`,
      isActive ? LC.red : LC.primary,
      `<div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
       <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
         ${isActive
           ? "Calibrate Sensors cleared."
           : "Sensors calibrated. On the next Sensor Operations action: ignore one trait affecting the task, OR re-roll 1d20."}
       </div>`
    ),
    speaker: { alias: "STA2e Toolkit" },
  });
  game.sta2eToolkit?.combatHud?._refresh?.();
  return !isActive;
}

/**
 * Consume the Calibrate Sensors benefit on behalf of a character-sheet sensor
 * officer. Clears the flag and posts a benefit-specific chat card.
 * benefit: "reroll" | "ignore-trait"
 */
export async function consumeCalibrateSensorsForOfficer(shipActor, shipToken, benefit) {
  if (!CombatHUD.hasCalibratesensors(shipToken)) return;
  const isReroll = benefit === "reroll";
  // Reroll keeps the flag ON so the dice roller can detect and consume it via die-click.
  // Ignore-trait is an immediate declaration — clear the flag right away.
  if (!isReroll) {
    await CombatHUD.setCalibratesensors(shipToken, false);
  }
  ChatMessage.create({
    content: lcarsCard(
      `🎚️ Calibrate Sensors — ${isReroll ? "REROLL" : "IGNORE TRAIT"}`,
      LC.primary,
      `<div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
       <div style="font-size:10px;color:${LC.text};font-family:${LC.font};">
         ${isReroll
           ? "Re-rolling 1d20 on this sensor task — click any crew die to reroll."
           : "Ignoring one trait affecting this sensor task."}
       </div>`
    ),
    speaker: { alias: "STA2e Toolkit" },
  });
  game.sta2eToolkit?.combatHud?._refresh?.();
}

/**
 * Post the LAUNCH PROBE info card on behalf of a sensor officer in the
 * character-sheet combat task panel. Mirrors _handleInfoAction("launch-probe").
 */
export async function applyLaunchProbeForOfficer(shipActor, _shipToken) {
  ChatMessage.create({
    content: lcarsCard("LAUNCH PROBE", LC.secondary, `
      <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
        margin-bottom:6px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;gap:8px;align-items:baseline;">
          <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;min-width:72px;flex-shrink:0;">
            Range
          </span>
          <span style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            Select a single zone within Long range — probe flies there
          </span>
        </div>
        <div style="display:flex;gap:8px;align-items:baseline;">
          <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;min-width:72px;flex-shrink:0;">
            Benefit
          </span>
          <span style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            Sensor Operations major actions may use the probe's location as origin instead of the ship
          </span>
        </div>
        <div style="display:flex;gap:8px;align-items:baseline;">
          <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;min-width:72px;flex-shrink:0;">
            Risk
          </span>
          <span style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            Probe can be targeted as a Small Craft — destroyed on any damage
          </span>
        </div>
        <div style="margin-top:3px;padding:4px 7px;
          background:rgba(255,153,0,0.06);border-left:2px solid ${LC.secondary};
          border-radius:2px;font-size:10px;color:${LC.textDim};font-family:${LC.font};">
          Minor action (Sensor station).
        </div>
      </div>`),
    speaker: { alias: "STA2e Toolkit" },
  });
}

/**
 * Post the TRACTOR BEAM LOCKED chat card on behalf of an officer rolling from
 * the character-sheet combat task panel. Mirrors the onSuccess() closure inside
 * CombatHUD._handleTractorBeam but accessible outside the class.
 *
 * @param {Token} sourceToken - The ship locking the tractor beam
 * @param {Token} targetToken - The ship being targeted
 */
export async function lockTractorBeam(sourceToken, targetToken) {
  const actor      = sourceToken?.actor;
  const tractorStr = actor?.system?.systems?.structure?.value ?? 0;
  const engagePayload = encodeURIComponent(JSON.stringify({
    sourceTokenId: sourceToken.id,
    targetTokenId: targetToken.id,
    sourceName:    sourceToken.name,
    targetName:    targetToken.name,
    tractorStr,
  }));

  ChatMessage.create({
    flags: { "sta2e-toolkit": { tractorBeamCard: true } },
    content: lcarsCard("🔗 TRACTOR BEAM LOCKED", LC.primary, `
      <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
        margin-bottom:4px;font-family:${LC.font};">${actor?.name ?? sourceToken.name}</div>
      <div style="font-size:14px;font-weight:700;color:${LC.primary};
        text-align:center;padding:5px 0;font-family:${LC.font};">
        🔗 ${targetToken.name} in tractor lock
      </div>
      <div style="display:flex;justify-content:center;gap:16px;margin-bottom:8px;
        font-size:10px;font-family:${LC.font};">
        <div style="text-align:center;">
          <div style="color:${LC.textDim};text-transform:uppercase;letter-spacing:0.08em;">Break-Free Diff</div>
          <div style="font-size:18px;font-weight:700;color:${LC.tertiary};">${tractorStr}</div>
        </div>
        <div style="text-align:center;">
          <div style="color:${LC.textDim};text-transform:uppercase;letter-spacing:0.08em;">Task</div>
          <div style="font-size:11px;color:${LC.text};">Engines + Conn<br>vs Difficulty ${tractorStr}</div>
        </div>
      </div>
      <div style="display:flex;gap:4px;">
        <button class="sta2e-tractor-engage"
          data-payload="${engagePayload}"
          style="flex:1;padding:5px;background:rgba(0,166,251,0.12);
            border:1px solid ${LC.primary};border-radius:2px;
            color:${LC.primary};font-size:10px;font-weight:700;
            letter-spacing:0.08em;text-transform:uppercase;
            cursor:pointer;font-family:${LC.font};">
          🔗 ENGAGE TRACTOR
        </button>
        <button class="sta2e-tractor-release"
          data-payload="${engagePayload}"
          style="padding:5px 8px;background:rgba(255,51,51,0.08);
            border:1px solid ${LC.borderDim};border-radius:2px;
            color:${LC.textDim};font-size:10px;font-weight:700;
            cursor:pointer;font-family:${LC.font};"
          title="Release tractor beam">
          ✕
        </button>
      </div>`),
    speaker: { alias: "STA2e Toolkit" },
  });
}

/**
 * Apply the outcome of a Warp roll made from the character-sheet combat task
 * panel. Posts WARP FAILED on failure. On success, clears Reserve Power and
 * posts the WARP ENGAGED card (also posts a failure card if Reserve Power is
 * absent at confirmation time).
 *
 * @param {Actor}   shipActor  - The ship actor
 * @param {Token}   shipToken  - The ship's canvas token
 * @param {boolean} passed     - Whether the task roll succeeded
 */
export async function applyWarpForOfficer(shipActor, shipToken, passed) {
  if (!passed) {
    ChatMessage.create({
      content: lcarsCard("🌀 WARP FAILED", LC.red, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor?.name ?? "Ship"}</div>
        <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
          Failed to engage warp drive. Reserve Power not consumed.
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
    return;
  }
  if (!CombatHUD.hasReservePower(shipActor)) {
    ChatMessage.create({
      content: lcarsCard("🔋 NO RESERVE POWER", LC.red, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
        <div style="font-size:11px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
          Warp requires Reserve Power. The ship does not currently have
          Reserve Power available — use <strong>Regain Power</strong> first.
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
    return;
  }

  const enginesRating = shipActor.system?.systems?.engines?.value ?? "?";
  const allowedUserIds = getStationAllowedUserIds(shipActor, "helm");
  const engagePayload = encodeURIComponent(JSON.stringify({
    actorId:   shipActor.id,
    tokenId:   shipToken?.id ?? null,
    actorName: shipActor.name,
  }));

  await CombatHUD.clearReservePower(shipActor);
  ChatMessage.create({
    flags: { "sta2e-toolkit": { warpEngageCard: true, allowedUserIds } },
    content: lcarsCard("🌀 WARP ENGAGED", LC.primary, `
      <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
        margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
      <div style="font-size:20px;font-weight:700;color:${LC.primary};
        text-align:center;padding:6px 0;font-family:${LC.font};">
        ${enginesRating !== "?" ? `Move up to ${enginesRating} zones` : "Warp Speed"}
      </div>
      <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
        text-align:center;margin-bottom:8px;line-height:1.5;">
        Or leave the battlefield entirely (GM discretion).
        Reserve Power consumed.
      </div>
      <div style="display:flex;gap:6px;">
        <button class="sta2e-warp-engage"
          data-payload="${engagePayload}"
          style="flex:1;padding:7px;background:rgba(0,166,251,0.15);
            border:1px solid ${LC.primary};border-radius:2px;
            color:${LC.primary};font-size:12px;font-weight:700;
            letter-spacing:0.12em;text-transform:uppercase;
            cursor:pointer;font-family:${LC.font};">
          ⚡ ENGAGE
        </button>
        <button class="sta2e-warp-flee"
          data-payload="${engagePayload}"
          title="Ship warps to the nearest canvas edge and is removed from the scene"
          style="padding:7px 12px;background:rgba(220,120,0,0.15);
            border:1px solid #dc7800;border-radius:2px;
            color:#dc7800;font-size:12px;font-weight:700;
            letter-spacing:0.08em;text-transform:uppercase;
            cursor:pointer;font-family:${LC.font};">
          🚀 FLEE
        </button>
      </div>`),
    speaker: { alias: "STA2e Toolkit" },
  });
}

/**
 * Apply the outcome of a Ram roll made from the character-sheet combat task
 * panel. Posts RAM FAILED on failure. On success, shows the "zones moved"
 * dialog and posts the full collision damage card.
 *
 * @param {Token}   shipToken   - The ramming ship's token
 * @param {Token}   targetToken - The target ship's token
 * @param {boolean} passed      - Whether the task roll succeeded
 * @param {number}  momentum    - Excess successes (may be spent for +1 damage each)
 */
export async function applyRamForOfficer(shipToken, targetToken, passed, momentum = 0) {
  const actor = shipToken?.actor;
  if (!actor) return;

  if (!passed) {
    ChatMessage.create({
      content: lcarsCard("💥 RAM FAILED", LC.red, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
        <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
          Failed to ram ${targetToken?.name ?? "target"} — task did not succeed.
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
    return;
  }

  let capturedZones = 0;
  const zonesResult = await foundry.applications.api.DialogV2.wait({
    window:  { title: `Ram — ${shipToken.name}` },
    content: `
      <div style="font-family:${LC.font};padding:4px 0;display:flex;flex-direction:column;gap:8px;">
        <div style="font-size:10px;color:${LC.textDim};line-height:1.5;">
          Collision damage = <strong>Scale + ½ zones moved</strong> before the collision.
          How many zones did <strong>${shipToken.name}</strong> move before ramming?
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <label style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;">
            Zones Moved
          </label>
          <input id="ram-zones" type="number" min="0" max="10" value="0"
            style="width:60px;padding:4px 8px;background:${LC.panel};
              border:1px solid ${LC.border};border-radius:2px;
              color:${LC.tertiary};font-size:16px;font-weight:700;
              font-family:${LC.font};text-align:center;" />
          <span id="ram-dmg-preview"
            style="font-size:11px;color:${LC.textDim};font-family:${LC.font};">
            = ${actor.system?.scale ?? 1} damage
          </span>
        </div>
        <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
          padding:4px 7px;background:rgba(255,51,51,0.06);border-left:2px solid ${LC.red};border-radius:2px;">
          Attacker gains: <strong style="color:${LC.red};">Devastating · Intense · Piercing</strong><br>
          Defender return hit: Scale only (no zones moved)
        </div>
      </div>`,
    buttons: [
      {
        action:   "confirm",
        label:    "Confirm",
        icon:     "fas fa-check",
        default:  true,
        callback: (event, btn, dlg) => {
          const el = dlg.element ?? btn.closest(".app.dialog-v2");
          capturedZones = Math.max(0, parseInt(el?.querySelector("#ram-zones")?.value ?? "0") || 0);
        },
      },
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
    ],
    render: (event, dlg) => {
      const el    = dlg.element;
      const input = el?.querySelector("#ram-zones");
      const prev  = el?.querySelector("#ram-dmg-preview");
      if (input && prev) {
        const scale = actor.system?.scale ?? 1;
        input.addEventListener("input", () => {
          const z = Math.max(0, parseInt(input.value) || 0);
          prev.textContent = `= ${scale + Math.floor(z / 2)} damage`;
          prev.style.color = z > 0 ? "var(--sta2e-tertiary,#ffcc66)" : "var(--sta2e-text-dim,#888)";
        });
        input.addEventListener("mousedown", e => e.stopPropagation());
      }
    },
  });

  if (zonesResult !== "confirm") return;
  const zonesMoved = capturedZones;

  const atkDmg = getCollisionDamage(shipToken,   zonesMoved);
  const defDmg = getCollisionDamage(targetToken, 0);

  await fireRam(shipToken, targetToken);

  const ramPayload = encodeURIComponent(JSON.stringify({
    attackerTokenId: shipToken.id,
    targetTokenId:   targetToken.id,
  }));

  const buildTargetData = (victimToken, rawDmg, extra = 0, isPiercing = false, noDevastating = false) => {
    const tActor      = victimToken.actor;
    const resistance  = isPiercing ? 0 : (tActor?.system?.resistance ?? 0);
    const finalDamage = Math.max(0, rawDmg + extra - resistance);
    const encodedData = encodeURIComponent(JSON.stringify({
      tokenId:        victimToken.id,
      actorId:        tActor?.id,
      finalDamage,
      highYield:      true,
      _isDevastating: false,
      targetingSystem: null,
      noDevastating,
    }));
    return {
      tokenId:         victimToken.id,
      actorId:         tActor?.id,
      name:            victimToken.name,
      rawDamage:       rawDmg + extra,
      resistance,
      finalDamage,
      currentShields:  tActor?.system?.shields?.value ?? 0,
      maxShields:      tActor?.system?.shields?.max   ?? 0,
      shaken:          tActor?.system?.shaken         ?? false,
      scanPiercing:    isPiercing,
      _encodedData:    encodedData,
    };
  };

  const damageRow = (t, label, color, { hideApply = false } = {}) => {
    const shieldAfter = Math.max(0, t.currentShields - t.finalDamage);
    const shieldColor = shieldAfter / t.maxShields > 0.5  ? LC.green
                      : shieldAfter / t.maxShields > 0.25 ? LC.yellow : LC.red;
    const warnings = [];
    if (t.currentShields === 0)                                         warnings.push("💥 BREACH — shields already down");
    else if (shieldAfter === 0)                                         warnings.push("💥 BREACH — shields reduced to 0");
    else if (shieldAfter / t.maxShields < 0.25 && t.shaken)            warnings.push("💥 BREACH — punched through (already shaken)");
    else if (shieldAfter / t.maxShields < 0.25)                        warnings.push("⚠️ SHAKEN — shields below 25%");
    else if (shieldAfter / t.maxShields < 0.5)                         warnings.push("⚠️ SHAKEN — shields below 50%");
    return `
      <div style="margin-bottom:8px;padding:6px;
        background:rgba(255,51,51,0.05);border:1px solid ${LC.borderDim};border-radius:2px;">
        <div style="font-size:9px;color:${color};font-weight:700;text-transform:uppercase;
          letter-spacing:0.1em;font-family:${LC.font};margin-bottom:5px;">${label}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-bottom:5px;text-align:center;">
          <div style="background:${LC.panel};border:1px solid ${LC.borderDim};border-radius:2px;padding:3px;">
            <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">Raw</div>
            <div style="font-size:15px;font-weight:700;color:${LC.text};">${t.rawDamage}</div>
          </div>
          <div style="background:${LC.panel};border:1px solid ${LC.borderDim};border-radius:2px;padding:3px;">
            <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">−Resist</div>
            <div style="font-size:15px;font-weight:700;color:${LC.orange};">${t.resistance}</div>
          </div>
          <div style="background:rgba(204,136,255,0.1);border:1px solid ${LC.secondary};border-radius:2px;padding:3px;">
            <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">Final</div>
            <div style="font-size:18px;font-weight:700;color:${LC.textBright};">${t.finalDamage}</div>
          </div>
        </div>
        <div style="font-size:10px;color:${LC.textDim};margin-bottom:4px;text-align:center;font-family:${LC.font};">
          SHIELDS ${t.currentShields} → <span style="color:${shieldColor};font-weight:700;">${shieldAfter}</span> / ${t.maxShields}
        </div>
        ${warnings.map(w => `<div style="padding:2px 6px;background:rgba(255,51,51,0.1);
          border-left:2px solid ${LC.red};border-radius:2px;margin-bottom:3px;
          font-size:10px;color:${LC.red};font-family:${LC.font};">${w}</div>`).join("")}
        ${hideApply ? "" : `<div class="sta2e-damage-controls" style="margin-top:5px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <label style="font-size:9px;color:${LC.textDim};white-space:nowrap;
              text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">Adj:</label>
            <input class="sta2e-extra-damage" type="number" value="0"
              data-base-payload="${t._encodedData}"
              style="width:44px;padding:2px 4px;background:${LC.bg};border:1px solid ${LC.border};
                border-radius:2px;color:${LC.text};font-size:12px;text-align:center;font-family:${LC.font};"/>
            <span class="sta2e-final-display" style="font-size:11px;color:${LC.textBright};font-family:${LC.font};">
              = <strong>${t.finalDamage}</strong>
            </span>
          </div>
          <button class="sta2e-apply-damage"
            data-payload="${t._encodedData}"
            style="width:100%;padding:4px;background:rgba(255,51,51,0.1);
              border:1px solid ${LC.red};border-radius:2px;
              color:${LC.red};font-size:10px;font-weight:700;
              letter-spacing:0.08em;text-transform:uppercase;
              cursor:pointer;font-family:${LC.font};">
            ⚔ APPLY ${t.finalDamage} DAMAGE → ${t.name}
          </button>
        </div>`}
      </div>`;
  };

  const tgtData = buildTargetData(targetToken, atkDmg, momentum, true);
  const atkData = buildTargetData(shipToken,   defDmg, 0,        true, true);

  ChatMessage.create({
    flags: { "sta2e-toolkit": { damageCard: true, ramResultCard: true,
      targetData: [tgtData], weaponName: "Ramming Speed" } },
    content: lcarsCard("💥 RAMMING SPEED", LC.red, `
      <div style="font-size:10px;color:${LC.textDim};margin-bottom:6px;
        font-family:${LC.font};letter-spacing:0.06em;text-align:center;">
        ${shipToken.name.toUpperCase()} RAMS ${targetToken.name.toUpperCase()}
        <span style="color:${LC.red};"> · INTENSE</span>
      </div>
      ${damageRow(tgtData, `${targetToken.name} takes · DEV · INTENSE · PIERCING`, LC.red,    { hideApply: true })}
      ${damageRow(atkData, `${shipToken.name} takes · DEV · INTENSE · PIERCING`,   LC.orange, { hideApply: true })}
      <div class="sta2e-ram-combined-controls" style="margin-top:4px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <label style="font-size:9px;color:${LC.textDim};white-space:nowrap;
            text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">Adj (both):</label>
          <input class="sta2e-ram-adj" type="number" value="0"
            style="width:44px;padding:2px 4px;background:${LC.bg};border:1px solid ${LC.border};
              border-radius:2px;color:${LC.text};font-size:12px;text-align:center;font-family:${LC.font};"/>
          <span style="font-size:10px;color:${LC.textDim};font-family:${LC.font};">added to each ship</span>
        </div>
        <button class="sta2e-apply-ram-both"
          data-tgt-payload="${tgtData._encodedData}"
          data-atk-payload="${atkData._encodedData}"
          style="width:100%;padding:4px;background:rgba(255,51,51,0.1);
            border:1px solid ${LC.red};border-radius:2px;
            color:${LC.red};font-size:10px;font-weight:700;
            letter-spacing:0.08em;text-transform:uppercase;
            cursor:pointer;font-family:${LC.font};">
          ⚔ APPLY DAMAGE TO BOTH SHIPS
        </button>
      </div>
      <button class="sta2e-ram-engage"
        data-payload="${ramPayload}"
        style="margin-top:4px;width:100%;padding:5px;background:rgba(255,51,51,0.08);
          border:1px solid ${LC.borderDim};border-radius:2px;
          color:${LC.textDim};font-size:10px;font-weight:700;
          letter-spacing:0.1em;text-transform:uppercase;
          cursor:pointer;font-family:${LC.font};">
        💥 ANIMATE RAM
      </button>`),
    speaker: ChatMessage.getSpeaker({ token: shipToken }),
  });
}

/**
 * Handle the outcome of an Ops/Engineering task rolled from the character-sheet
 * combat task panel. Called from main.js taskCallback after the player confirms
 * their roll. Handles regen-shields, regain-power, reroute-power, damage-control,
 * and transport — showing any necessary dialogs and posting the result card.
 *
 * @param {string} taskKey      - The TASK_PARAMS key
 * @param {Actor}  shipActor    - The ship actor
 * @param {Token}  shipToken    - The ship's canvas token
 * @param {Actor}  officerActor - The character sheet actor (the rolling officer)
 * @param {object} rollResult   - { passed, successes, momentum }
 */
/**
 * Carry out the Direct action on behalf of a character-sheet officer.
 * Shows the target-station picker + task picker, sets assistPending on the ship
 * token, and posts the DIRECT chat card — no dice roll for the commander here;
 * the directed officer rolls when they click "Open Task Roller" in the card.
 *
 * @param {Actor}  shipActor   - The ship actor
 * @param {Token}  shipToken   - The ship's canvas token
 * @param {Actor}  officerActor - The commanding officer (from the character sheet)
 * @returns {Promise<void>}
 */
export async function applyDirectForOfficer(shipActor, shipToken, officerActor) {
  const officerName = officerActor?.name ?? shipActor?.name ?? "Commander";
  const officerActorId = officerActor?.id ?? null;
  const isNpc = CombatHUD.isNpcShip(shipActor);

  // Build list of other stations that have an assigned officer (or NPC crew)
  const options = STATION_SLOTS
    .filter(s => s.id !== "command")
    .map(s => {
      const slotOfficers = getStationOfficers(shipActor, s.id);
      const assignedName = slotOfficers[0]?.name ?? (isNpc ? "NPC Crew" : null);
      return { ...s, assignedName };
    })
    .filter(s => s.assignedName !== null);

  if (options.length === 0) {
    ui.notifications.warn("No other stations have assigned characters to direct.");
    return;
  }

  // ── Step 1: Pick target station ────────────────────────────────────────────
  let targetId = null;
  const result1 = await foundry.applications.api.DialogV2.wait({
    window:  { title: `Direct — ${shipActor?.name ?? "Ship"}` },
    content: `
      <div style="font-family:${LC.font};padding:4px 0;display:flex;flex-direction:column;gap:4px;">
        <div style="font-size:10px;color:${LC.textDim};line-height:1.5;margin-bottom:4px;">
          <strong style="color:${LC.text};">${officerName}</strong> commits their major action to
          <strong style="color:${LC.tertiary};">Direct</strong> another station.
          They will roll <strong style="color:${LC.tertiary};">Control + Command</strong> as an
          assist die when the target performs their next major task.
        </div>
        <div>
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Target Station</div>
          ${options.map(s => `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
              padding:5px 8px;border-radius:2px;margin-bottom:2px;
              border:1px solid ${LC.borderDim};background:${LC.panel};">
              <input type="radio" name="direct-target" value="${s.id}"
                ${s.id === options[0]?.id ? "checked" : ""}
                style="accent-color:${LC.primary};" />
              <span style="font-size:12px;">${s.icon}</span>
              <div style="display:flex;flex-direction:column;">
                <span style="font-size:11px;font-weight:700;color:${LC.text};
                  font-family:${LC.font};">${s.label}</span>
                <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};">
                  ${s.assignedName}
                </span>
              </div>
            </label>`).join("")}
        </div>
      </div>`,
    buttons: [
      {
        action:   "confirm",
        label:    "🎖️ Declare Direct",
        icon:     "fas fa-check",
        default:  true,
        callback: (event, btn, dlg) => {
          const el = dlg.element ?? btn.closest(".app.dialog-v2");
          targetId = el?.querySelector("input[name='direct-target']:checked")?.value ?? null;
        },
      },
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
    ],
  });
  if (result1 !== "confirm" || !targetId) return;

  const tgt = STATION_SLOTS.find(s => s.id === targetId);

  // ── Step 2: Pick the task the directed officer will perform ────────────────
  const stationDef    = BRIDGE_STATIONS.find(s => s.id === targetId);
  const actionEntries = (stationDef?.major ?? []).filter(a =>
    a.key !== null && !a.isInfo &&
    !["assist", "assist-command", "direct", "task-roll"].includes(a.key)
  );
  const weaponEntries = targetId === "tactical"
    ? shipActor.items
        .filter(i => i.type === "starshipweapon2e")
        .map(weapon => {
          const isTorpedo = getWeaponConfig(weapon)?.type === "torpedo";
          return {
            key:      "fire-weapon",
            weaponId: weapon.id,
            label:    `Fire — ${weapon.name}`,
            tooltip:  `Fire ${weapon.name}${isTorpedo ? " (Torpedo)" : ""}. Control + Security, Weapons + Security.`,
            isTorpedo,
          };
        })
    : [];
  const directable = [...weaponEntries, ...actionEntries];

  let directTaskKey   = directable[0]?.key      ?? null;
  let directTaskLabel = directable[0]?.label    ?? null;
  let directTaskIcon  = directable[0]?.icon     ?? "🎲";
  let directWeaponId  = directable[0]?.weaponId ?? null;

  if (directable.length > 1) {
    const taskResultIdx = await foundry.applications.api.DialogV2.wait({
      window: { title: `${tgt?.icon ?? ""} ${tgt?.label ?? targetId} — Choose Task` },
      content: `
        <div style="font-family:${LC.font};padding:4px 0;">
          <div style="font-size:10px;color:${LC.textDim};line-height:1.5;margin-bottom:8px;">
            <strong style="color:${LC.text};">${officerName}</strong> is directing
            <strong style="color:${LC.text};">${tgt?.icon ?? ""} ${tgt?.label ?? targetId}</strong>.
            What task should they perform?
          </div>
          ${directable.map((a, i) => `
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;
              padding:6px 8px;border-radius:2px;margin-bottom:3px;
              border:1px solid ${LC.borderDim};background:${LC.panel};">
              <input type="radio" name="direct-task" value="${i}"
                ${i === 0 ? "checked" : ""}
                style="accent-color:${LC.primary};margin-top:3px;" />
              <div>
                <div style="font-size:11px;font-weight:700;color:${LC.text};font-family:${LC.font};">
                  ${a.icon ? a.icon + " " : ""}${a.label}
                </div>
                <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
                  line-height:1.4;margin-top:2px;">
                  ${(a.tooltip ?? "").length > 90 ? (a.tooltip ?? "").substring(0, 90) + "…" : (a.tooltip ?? "")}
                </div>
              </div>
            </label>`).join("")}
        </div>`,
      buttons: [
        {
          action:   "confirm",
          label:    "🎖️ Confirm Task",
          icon:     "fas fa-check",
          default:  true,
          callback: (_event, _btn, dlg) => {
            const val = dlg.element?.querySelector("input[name='direct-task']:checked")?.value;
            return val !== undefined ? parseInt(val) : 0;
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });
    if (taskResultIdx === "cancel" || taskResultIdx == null) return;
    const chosen    = directable[taskResultIdx] ?? directable[0];
    directTaskKey   = chosen?.key      ?? directTaskKey;
    directTaskLabel = chosen?.label    ?? directTaskLabel;
    directTaskIcon  = chosen?.icon     ?? directTaskIcon;
    directWeaponId  = chosen?.weaponId ?? null;
  }

  // ── Set assistPending flag on the ship token (GM writes; players request via socket) ──
  if (game.user.isGM) {
    try {
      const existing  = shipToken?.document?.getFlag("sta2e-toolkit", "assistPending") ?? {};
      const newAssist = { name: officerName, actorId: officerActorId, type: "direct" };
      const raw       = existing[targetId];
      const arr       = !raw ? []
        : Array.isArray(raw) ? raw
        : typeof raw === "string" ? [{ name: raw, actorId: null }]
        : [raw];
      if (!arr.some(a => a.actorId === officerActorId && a.type === "direct")) {
        arr.push(newAssist);
      }
      existing[targetId] = arr;
      await shipToken?.document?.setFlag("sta2e-toolkit", "assistPending", existing);
    } catch(e) { console.warn("STA2e Toolkit | Could not set direct flag:", e); }
  }

  // ── Build "Open Task Roller" button payload ────────────────────────────────
  const _directBtnHtml = !isNpc ? (() => {
    const _p = encodeURIComponent(JSON.stringify({
      shipActorId:   shipActor.id,
      shipTokenId:   shipToken?.id ?? null,
      shipSceneId:   shipToken?.scene?.id ?? null,
      stationId:     targetId,
      stationLabel:  tgt?.label ?? targetId,
      commanderName: officerName,
      taskKey:       directTaskKey   ?? null,
      taskLabel:     directTaskLabel ?? null,
      weaponId:      directWeaponId  ?? null,
    }));
    return `<div style="margin-top:8px;">
      <button class="sta2e-open-task-roller" data-payload="${_p}"
        style="width:100%;padding:6px 10px;
          background:rgba(255,153,0,0.12);border:1px solid ${LC.primary};
          border-radius:2px;cursor:pointer;font-family:${LC.font};
          font-size:11px;font-weight:700;color:${LC.primary};letter-spacing:0.04em;">
        🎲 Open Task Roller — ${directTaskIcon} ${directTaskLabel ?? (tgt?.label ?? targetId)}
      </button>
    </div>`;
  })() : "";

  // ── Post the DIRECT chat card ──────────────────────────────────────────────
  ChatMessage.create({
    content: lcarsCard("🎖️ DIRECT", LC.primary, `
      <div style="font-size:11px;font-weight:700;color:${LC.tertiary};
        margin-bottom:6px;font-family:${LC.font};">
        ${officerName} — Command
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;gap:8px;align-items:baseline;">
          <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;min-width:80px;">Directing</span>
          <span style="font-size:13px;font-weight:700;color:${LC.tertiary};
            font-family:${LC.font};">${tgt?.icon ?? ""} ${tgt?.label ?? targetId}</span>
        </div>
        ${directTaskLabel ? `
        <div style="display:flex;gap:8px;align-items:baseline;">
          <span style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;min-width:80px;">Task</span>
          <span style="font-size:13px;font-weight:700;color:${LC.primary};
            font-family:${LC.font};">${directTaskIcon} ${directTaskLabel}</span>
        </div>` : ""}
        <div style="margin-top:3px;padding:5px 7px;
          background:rgba(255,153,0,0.06);border-left:2px solid ${LC.primary};
          border-radius:2px;font-size:10px;color:${LC.textDim};font-family:${LC.font};
          line-height:1.5;">
          ${officerName} will roll <strong>Control + Command</strong> as an assist die when
          ${tgt?.label ?? targetId} performs
          <strong>${directTaskLabel ?? "their next major task"}</strong>.
          This uses ${officerName}'s major action for this round.
        </div>
        ${_directBtnHtml}
      </div>`),
    speaker: { alias: "STA2e Toolkit" },
  });
}

/**
 * Apply cloaking-device activation effects after a successful sheet-panel roll.
 * Checks Reserve Power, consumes it, then runs the shimmer → invisible → hidden sequence.
 * Called from the main.js taskCallback for the "cloak-toggle" task key.
 *
 * @param {Actor}   shipActor - The ship actor
 * @param {Token}   shipToken - The ship's canvas Token placeable
 * @param {boolean} passed    - Whether the task roll succeeded
 */
export async function handleCloakActivateResult(shipActor, shipToken, passed) {
  const LC   = getLcTokens();
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  if (!passed) {
    ChatMessage.create({
      content: lcarsCard("👁 CLOAKING DEVICE FAILED", LC.red, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
        <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
          Failed to bring the Cloaking Device online.<br>
          <span style="color:${LC.textDim};font-size:9px;">
            Reserve Power has not been consumed.
          </span>
        </div>`),
      speaker: ChatMessage.getSpeaker({ token: shipToken?.document }),
    });
    return;
  }

  // Reserve Power is required — verify and consume on success
  if (!CombatHUD.hasReservePower(shipActor)) {
    ui.notifications.warn(`${shipActor.name}: No Reserve Power — Cloaking Device could not be engaged.`);
    ChatMessage.create({
      content: lcarsCard("🔋 NO RESERVE POWER", LC.red, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
        <div style="font-size:11px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
          Activating the Cloaking Device requires Reserve Power. Use
          <strong>Regain Power</strong> from the Ops/Engineering station first.
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
    return;
  }

  await CombatHUD.clearReservePower(shipActor);

  // ── Shimmer → cloak ──────────────────────────────────────────────────────
  const _shimmerParams = [{
    filterType: "distortion", filterId: "sta2e-cloak-shimmer",
    maskPath: "modules/tokenmagic/fx/assets/distortion-1.png",
    maskSpriteScaleX: 5, maskSpriteScaleY: 5, padding: 20,
    animated: {
      maskSpriteX: { active: true, speed: 0.05, animType: "move" },
      maskSpriteY: { active: true, speed: 0.07, animType: "move" },
    },
  }];
  if (window.TokenMagic) await TokenMagic.addUpdateFilters(shipToken, _shimmerParams);

  try {
    const path = game.settings.get("sta2e-toolkit", "sndCloak");
    if (path) AudioHelper.play({ src: path, volume: 0.8, autoplay: true, loop: false }, true);
  } catch {}

  await wait(800);
  await Promise.all([
    shipActor.toggleStatusEffect("invisible", { active: true, overlay: false }),
    shipToken.document.update({ hidden: true }),
  ]);
  await wait(200);
  if (window.TokenMagic) try { await TokenMagic.deleteFilters(shipToken, "sta2e-cloak-shimmer"); } catch {}

  ChatMessage.create({
    content: lcarsCard("🔇 CLOAKING DEVICE ENGAGED", "#aa44ff", `
      <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
        <strong>${shipToken.name}</strong> has engaged its cloaking device.<br>
        <span style="color:${LC.textDim};font-size:9px;">
          Shields are down. Cannot attack or be targeted while cloaked.<br>
          Deactivating requires a minor action.
        </span>
      </div>`),
    speaker: ChatMessage.getSpeaker({ token: shipToken.document }),
  });

  game.sta2eToolkit?.combatHud?._refresh();
}

/**
 * Instantly deactivate the cloaking device (minor action — no roll required).
 * Called from the character sheet's Minor Actions panel when the ship is already cloaked.
 *
 * @param {Actor}  shipActor - The ship actor
 * @param {Token}  shipToken - The ship's canvas Token placeable
 */
export async function applyCloakDeactivateForOfficer(shipActor, shipToken) {
  const LC   = getLcTokens();
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    const path = game.settings.get("sta2e-toolkit", "sndDecloak");
    if (path) AudioHelper.play({ src: path, volume: 0.8, autoplay: true, loop: false }, true);
  } catch {}

  const _shimmerParams = [{
    filterType: "distortion", filterId: "sta2e-cloak-shimmer",
    maskPath: "modules/tokenmagic/fx/assets/distortion-1.png",
    maskSpriteScaleX: 5, maskSpriteScaleY: 5, padding: 20,
    animated: {
      maskSpriteX: { active: true, speed: 0.05, animType: "move" },
      maskSpriteY: { active: true, speed: 0.07, animType: "move" },
    },
  }];
  if (window.TokenMagic) try { await TokenMagic.addUpdateFilters(shipToken, _shimmerParams); } catch {}

  await wait(400);
  await Promise.all([
    shipActor.toggleStatusEffect("invisible", { active: false, overlay: false }),
    shipToken.document.update({ hidden: false }),
  ]);
  await wait(800);
  if (window.TokenMagic) try { await TokenMagic.deleteFilters(shipToken, "sta2e-cloak-shimmer"); } catch {}

  ChatMessage.create({
    content: lcarsCard("👁 CLOAKING DEVICE DISENGAGED", "#aa44ff", `
      <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
        <strong>${shipToken.name}</strong> has decloaked.<br>
        <span style="color:${LC.textDim};font-size:9px;">Shields may now be raised.</span>
      </div>`),
    speaker: ChatMessage.getSpeaker({ token: shipToken.document }),
  });

  game.sta2eToolkit?.combatHud?._refresh();
}

/**
 * Show the Reroute Power system-selection dialog immediately when the player
 * selects the task from the side panel (before rolling). Returns the chosen
 * system key, or null if the dialog was cancelled.
 *
 * @param {Actor} shipActor - The ship actor (used to read ratings + rerouted flags)
 * @returns {Promise<string|null>}
 */
export async function showRerouteSystemDialog(shipActor) {
  const SYSTEMS = ["communications","computers","engines","sensors","structure","weapons"];
  const alreadyRerouted = SYSTEMS.filter(k => CombatHUD.getReroutedPower(shipActor, k));

  let capturedSystem = null;
  const result = await foundry.applications.api.DialogV2.wait({
    window:  { title: `Reroute Power — ${shipActor?.name ?? "Ship"}` },
    content: `
      <div style="font-family:${LC.font};padding:4px 0;display:flex;flex-direction:column;gap:8px;">
        <div style="font-size:10px;color:${LC.textDim};line-height:1.5;">
          Select the system to receive the rerouted power on a successful roll.
          Reserve Power will be consumed when the roll is confirmed.
        </div>
        ${alreadyRerouted.length > 0 ? `
        <div style="padding:4px 7px;background:rgba(255,153,0,0.07);
          border-left:2px solid ${LC.primary};border-radius:2px;
          font-size:10px;color:${LC.textDim};font-family:${LC.font};">
          Already rerouted: ${alreadyRerouted.map(k => CombatHUD.systemLabel(k)).join(", ")}
        </div>` : ""}
        <div style="display:flex;flex-direction:column;gap:3px;">
          ${SYSTEMS.map(k => {
            const label    = CombatHUD.systemLabel(k);
            const rating   = shipActor?.system?.systems?.[k]?.value ?? "?";
            const rerouted = CombatHUD.getReroutedPower(shipActor, k);
            return `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
              padding:4px 7px;border-radius:2px;
              border:1px solid ${rerouted ? LC.primary : LC.borderDim};
              background:${rerouted ? "rgba(255,153,0,0.08)" : LC.panel};">
              <input type="radio" name="reroute-system" value="${k}"
                style="accent-color:${LC.primary};" />
              <span style="flex:1;font-size:11px;font-weight:700;
                color:${LC.text};font-family:${LC.font};">${label}</span>
              <span style="font-size:10px;color:${LC.textDim};
                font-family:${LC.font};">Rating ${rating}</span>
              ${rerouted ? `<span style="font-size:9px;color:${LC.primary};
                font-family:${LC.font};font-weight:700;">⚡ REROUTED</span>` : ""}
            </label>`;
          }).join("")}
        </div>
      </div>`,
    buttons: [
      {
        action:   "confirm",
        label:    "⚡ Select System",
        icon:     "fas fa-bolt",
        default:  true,
        callback: (event, btn, dlg) => {
          const el = dlg.element ?? btn.closest(".app.dialog-v2");
          capturedSystem = el?.querySelector("input[name='reroute-system']:checked")?.value ?? null;
        },
      },
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
    ],
  });
  return (result === "confirm" && capturedSystem) ? capturedSystem : null;
}

/**
 * Show the transporter configuration dialog (transport type + operating site).
 * Returns { transportType, operationSite, totalDiff } on confirm, or null on cancel.
 * Called from the sheet side panel BEFORE rolling so difficulty reflects the config.
 */
export async function showTransportConfigDialog(shipActor) {
  const TYPE_LABELS = { "pad-to-pad": "Pad-to-Pad", "one-pad": "One Pad", "site-to-site": "Site-to-Site" };
  const SITE_LABELS = { "transporter": "Transporter Room", "bridge": "Bridge", "engineering": "Main Engineering" };

  const ownShields    = shipActor?.system?.shields?.value ?? 0;
  const targetToken   = Array.from(game.user.targets ?? [])[0] ?? null;
  const targetShields = targetToken?.actor?.system?.shields?.value ?? 0;
  const shieldWarning = ownShields > 0
    ? `⚠ Your shields are active — transport is blocked.`
    : targetShields > 0
      ? `⚠ Target's shields are active — transport is blocked.`
      : null;

  let capturedConfig = null;
  const result = await foundry.applications.api.DialogV2.wait({
    window:  { title: `Transporter — ${shipActor?.name ?? "Ship"}` },
    content: `
      <div style="font-family:${LC.font};padding:4px 0;display:flex;flex-direction:column;gap:10px;">
        ${shieldWarning ? `
        <div style="padding:5px 8px;background:rgba(255,51,51,0.1);
          border-left:3px solid ${LC.red};border-radius:2px;
          font-size:10px;font-weight:700;color:${LC.red};font-family:${LC.font};">
          ${shieldWarning}
        </div>` : ""}
        <div>
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;margin-bottom:5px;">Transport Type</div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            ${[
              { key: "pad-to-pad",   label: "Pad-to-Pad",  diff: "+0", desc: "Both locations have transporter pads" },
              { key: "one-pad",      label: "One Pad",      diff: "+1", desc: "One location has a pad, one does not" },
              { key: "site-to-site", label: "Site-to-Site", diff: "+2", desc: "Neither location has a transporter pad" },
            ].map(t => `
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                padding:4px 7px;border-radius:2px;
                border:1px solid ${LC.borderDim};background:${LC.panel};">
                <input type="radio" name="transport-type" value="${t.key}"
                  ${t.key === "pad-to-pad" ? "checked" : ""}
                  style="accent-color:${LC.primary};" />
                <div style="flex:1;">
                  <span style="font-size:11px;font-weight:700;color:${LC.text};font-family:${LC.font};">${t.label}</span>
                  <span style="font-size:10px;color:${LC.textDim};font-family:${LC.font};"> — ${t.desc}</span>
                </div>
                <span style="font-size:10px;color:${LC.primary};font-weight:700;font-family:${LC.font};">Diff ${t.diff}</span>
              </label>`).join("")}
          </div>
        </div>
        <div>
          <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;margin-bottom:5px;">Operating From</div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            ${[
              { key: "transporter", label: "Transporter Room",  diff: "+0", desc: "Direct operation from transporter room" },
              { key: "bridge",      label: "Bridge",            diff: "+1", desc: "Remote from this station" },
              { key: "engineering", label: "Main Engineering",  diff: "+1", desc: "Remote operation from Main Engineering" },
            ].map(s => `
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                padding:4px 7px;border-radius:2px;
                border:1px solid ${LC.borderDim};background:${LC.panel};">
                <input type="radio" name="operation-site" value="${s.key}"
                  ${s.key === "bridge" ? "checked" : ""}
                  style="accent-color:${LC.primary};" />
                <div style="flex:1;">
                  <span style="font-size:11px;font-weight:700;color:${LC.text};font-family:${LC.font};">${s.label}</span>
                  <span style="font-size:10px;color:${LC.textDim};font-family:${LC.font};"> — ${s.desc}</span>
                </div>
                <span style="font-size:10px;color:${LC.primary};font-weight:700;font-family:${LC.font};">Diff ${s.diff}</span>
              </label>`).join("")}
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;
          padding:5px 7px;background:${LC.panel};border-radius:2px;border:1px solid ${LC.border};">
          <span style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
            letter-spacing:0.08em;font-family:${LC.font};">Total Difficulty</span>
          <span id="transport-diff-preview"
            style="font-size:16px;font-weight:700;color:${LC.primary};font-family:${LC.font};">1</span>
        </div>
      </div>`,
    buttons: [
      {
        action:   "confirm",
        label:    "✨ Set Up Transport",
        icon:     "fas fa-check",
        default:  true,
        callback: (event, btn, dlg) => {
          const el = dlg.element ?? btn.closest(".app.dialog-v2");
          const transportType = el?.querySelector("input[name='transport-type']:checked")?.value ?? "pad-to-pad";
          const operationSite = el?.querySelector("input[name='operation-site']:checked")?.value ?? "bridge";
          const typeDiff = transportType === "pad-to-pad" ? 0 : transportType === "one-pad" ? 1 : 2;
          const siteDiff = operationSite === "transporter" ? 0 : 1;
          capturedConfig = { transportType, operationSite, totalDiff: typeDiff + siteDiff,
            typeLabel: TYPE_LABELS[transportType], siteLabel: SITE_LABELS[operationSite] };
        },
      },
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
    ],
    render: (event, dlg) => {
      const el      = dlg.element;
      const preview = el?.querySelector("#transport-diff-preview");
      const update  = () => {
        const type = el?.querySelector("input[name='transport-type']:checked")?.value ?? "pad-to-pad";
        const site = el?.querySelector("input[name='operation-site']:checked")?.value ?? "bridge";
        const typeDiff = type === "pad-to-pad" ? 0 : type === "one-pad" ? 1 : 2;
        const siteDiff = site === "transporter" ? 0 : 1;
        if (preview) preview.textContent = typeDiff + siteDiff;
      };
      el?.querySelectorAll("input[name='transport-type']").forEach(r => r.addEventListener("change", update));
      el?.querySelectorAll("input[name='operation-site']").forEach(r => r.addEventListener("change", update));
      update();
    },
  });
  return (result === "confirm" && capturedConfig) ? capturedConfig : null;
}

export async function handleOfficerTaskResult(taskKey, shipActor, shipToken, officerActor, { passed, successes = 0, momentum = 0, rerouteSystem = null, transportConfig = null } = {}) {

  // ── Regen Shields ───────────────────────────────────────────────────────────
  if (taskKey === "regen-shields") {
    if (!CombatHUD.hasReservePower(shipActor)) {
      ChatMessage.create({
        content: lcarsCard("🔋 NO RESERVE POWER", LC.red, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
          <div style="font-size:11px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
            Regen Shields requires Reserve Power. Use
            <strong>Regain Power</strong> first.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
      return;
    }
    const maxShield  = shipActor.system?.shields?.max ?? 0;
    const rawEngDisc = officerActor?.system?.disciplines?.engineering;
    const engDept    = rawEngDisc?.value ?? rawEngDisc ?? 2;
    if (!passed) {
      ChatMessage.create({
        content: lcarsCard("🛡️ REGEN SHIELDS FAILED", LC.red, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
          <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            Failed to reroute Reserve Power to shield emitters.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
      return;
    }
    const shieldPayload = encodeURIComponent(JSON.stringify({
      actorId: shipActor.id, tokenId: shipToken?.id ?? null,
      baseRestore: engDept, maxShield, actorName: shipActor.name,
    }));
    ChatMessage.create({
      flags: { "sta2e-toolkit": { regenShieldCard: true } },
      content: lcarsCard("🛡️ REGEN SHIELDS — SUCCESS", LC.green, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
        <div style="font-size:11px;color:${LC.text};font-family:${LC.font};margin-bottom:8px;">
          Restores <strong style="color:${LC.green};">${engDept}</strong> shields
          (Engineering dept). Spend 1 Momentum for +2 more (Repeatable).
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <label style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
            text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;">
            Momentum Spent
          </label>
          <input class="sta2e-shield-threat" type="number" min="0" value="0"
            style="width:60px;padding:3px 6px;background:${LC.bg};
              border:1px solid ${LC.border};border-radius:2px;
              color:${LC.tertiary};font-size:14px;font-weight:700;
              font-family:${LC.font};text-align:center;" />
          <span class="sta2e-shield-total"
            style="font-size:11px;color:${LC.textDim};font-family:${LC.font};">
            = ${engDept} shields
          </span>
        </div>
        <button class="sta2e-apply-shields"
          data-payload="${shieldPayload}"
          style="width:100%;padding:5px;background:rgba(0,200,100,0.12);
            border:1px solid ${LC.green};border-radius:2px;
            color:${LC.green};font-size:10px;font-weight:700;
            letter-spacing:0.08em;text-transform:uppercase;
            cursor:pointer;font-family:${LC.font};">
          🛡️ APPLY SHIELDS → ${shipActor.name}
        </button>`),
      speaker: { alias: "STA2e Toolkit" },
    });
    return;
  }

  // ── Regain Power ────────────────────────────────────────────────────────────
  if (taskKey === "regain-power") {
    const uses     = CombatHUD.getRegainPowerUses(shipActor);
    const inCombat = !!game.combat?.active;
    if (inCombat) await CombatHUD.incrementRegainPowerUses(shipActor);

    if (!passed) {
      ChatMessage.create({
        content: lcarsCard("🔋 REGAIN POWER FAILED", LC.red, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
          <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            Failed to restore Reserve Power (Difficulty ${1 + uses}).
            ${uses > 0 ? `This was attempt ${uses + 1} this combat.` : ""}
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
      return;
    }
    const compPayload = encodeURIComponent(JSON.stringify({
      actorId: shipActor.id, tokenId: shipToken?.id ?? null, actorName: shipActor.name,
    }));
    ChatMessage.create({
      flags: { "sta2e-toolkit": { regainPowerCard: true } },
      content: lcarsCard("🔋 RESERVE POWER RESTORED", LC.primary, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
        <div style="font-size:11px;color:${LC.green};font-weight:700;
          font-family:${LC.font};margin-bottom:4px;">
          ⚡ Reserve Power available
        </div>
        <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
          line-height:1.5;margin-bottom:8px;">
          ${successes} success${successes !== 1 ? "es" : ""}. Reserve Power restored —
          can be used for Regen Shields or Reroute Power.
          ${inCombat ? `Difficulty will be ${2 + uses} if attempted again this combat.` : ""}
        </div>
        <div style="display:flex;gap:4px;">
          <button class="sta2e-apply-reserve-power"
            data-payload="${compPayload}"
            style="flex:1;padding:5px;background:rgba(0,180,255,0.1);
              border:1px solid ${LC.primary};border-radius:2px;
              color:${LC.primary};font-size:10px;font-weight:700;
              letter-spacing:0.06em;text-transform:uppercase;
              cursor:pointer;font-family:${LC.font};">
            ⚡ GRANT RESERVE POWER
          </button>
          <button class="sta2e-apply-power-complication"
            data-payload="${compPayload}"
            style="padding:5px 8px;background:rgba(255,100,0,0.08);
              border:1px solid ${LC.orange};border-radius:2px;
              color:${LC.orange};font-size:10px;font-weight:700;
              cursor:pointer;font-family:${LC.font};"
            title="Succeeded at Cost — grant power but apply a negative trait complication">
            ⚠ + COMPLICATION
          </button>
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
    return;
  }

  // ── Reroute Power ───────────────────────────────────────────────────────────
  if (taskKey === "reroute-power") {
    if (!passed) return;  // no failure card — the dice result card is sufficient
    if (!CombatHUD.hasReservePower(shipActor)) {
      ChatMessage.create({
        content: lcarsCard("🔋 NO RESERVE POWER", LC.red, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
          <div style="font-size:11px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
            Reroute Power requires Reserve Power. Use
            <strong>Regain Power</strong> from Ops first.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
      return;
    }
    // System was already chosen before rolling via showRerouteSystemDialog;
    // fall back to the dialog if somehow not set (e.g. chat-card confirm path).
    const capturedSystem = rerouteSystem ?? await showRerouteSystemDialog(shipActor);
    if (!capturedSystem) return;
    await CombatHUD.clearReservePower(shipActor);
    await CombatHUD.setReroutedPower(shipActor, capturedSystem, true);
    ChatMessage.create({
      content: lcarsCard("⚡ POWER REROUTED", LC.primary, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
        <div style="font-size:20px;font-weight:700;color:${LC.primary};
          text-align:center;padding:6px 0;font-family:${LC.font};">
          ⚡ ${CombatHUD.systemLabel(capturedSystem)}
        </div>
        <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
          line-height:1.5;text-align:center;">
          Reserve Power rerouted. The next task using ${CombatHUD.systemLabel(capturedSystem)}
          benefits from the additional power, then the reroute is spent.
        </div>`),
      speaker: { alias: "STA2e Toolkit" },
    });
    game.sta2eToolkit?.combatHud?._refresh?.();
    return;
  }

  // ── Damage Control ──────────────────────────────────────────────────────────
  if (taskKey === "damage-control") {
    const scale   = shipActor.system?.scale ?? 1;
    const destThr = Math.ceil(scale / 2);
    const SYSTEMS = ["communications","computers","engines","sensors","structure","weapons"];
    const breached = SYSTEMS
      .map(key => {
        const total   = shipActor.system?.systems?.[key]?.breaches ?? 0;
        const patched = CombatHUD.getPatchedBreaches(shipActor)[key] ?? 0;
        const effective = Math.max(0, total - patched);
        return { key, total, patched, effective, label: CombatHUD.systemLabel(key) };
      })
      .filter(s => s.total > 0);

    if (!breached.length) {
      if (passed) ui.notifications.info(`${shipActor.name} has no breached systems to patch.`);
      else ChatMessage.create({
        content: lcarsCard("🔧 DAMAGE CONTROL FAILED", LC.red, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
          <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            No breached systems to repair.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
      return;
    }

    if (!passed) {
      ChatMessage.create({
        content: lcarsCard("🔧 DAMAGE CONTROL FAILED", LC.red, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
          <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            Damage control failed — breach could not be patched.
          </div>`),
        speaker: { alias: "STA2e Toolkit" },
      });
      return;
    }

    // Pick system to patch
    let targetSystem = breached.length === 1 ? breached[0] : null;
    if (!targetSystem) {
      let captured = null;
      const sysResult = await foundry.applications.api.DialogV2.wait({
        window: { title: `Damage Control — ${shipActor.name}` },
        content: `
          <div style="font-family:${LC.font};padding:4px 0;">
            <div style="font-size:11px;color:${LC.text};margin-bottom:8px;">
              Roll succeeded — select the breached system to patch:
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              ${breached.map((s, i) => `
                <label style="display:flex;align-items:center;gap:8px;
                  padding:5px 8px;border:1px solid ${LC.borderDim};border-radius:2px;
                  cursor:pointer;background:${LC.panel};">
                  <input type="radio" name="patch-system" value="${s.key}"
                    style="accent-color:${LC.primary};"
                    ${i === 0 ? "checked" : ""} />
                  <span style="font-size:11px;font-family:${LC.font};flex:1;">
                    <strong style="color:${s.total >= destThr ? LC.red : s.effective > 0 ? LC.yellow : LC.green};">
                      ${s.label}
                    </strong>
                    <span style="color:${LC.textDim};font-size:10px;">
                      — ${s.total} breach${s.total !== 1 ? "es" : ""}
                      ${s.patched > 0 ? `(${s.patched} patched)` : ""}
                      ${s.total >= destThr ? " ⛔ DESTROYED" : s.effective > 0 ? ` · +${s.effective} Difficulty` : " · patched"}
                    </span>
                  </span>
                </label>`).join("")}
            </div>
          </div>`,
        buttons: [
          {
            action:   "confirm",
            label:    "🔧 Select System",
            icon:     "fas fa-check",
            default:  true,
            callback: (event, btn, dlg) => {
              const el  = dlg.element ?? btn.closest(".app.dialog-v2");
              captured  = el?.querySelector("input[name='patch-system']:checked")?.value ?? breached[0].key;
            },
          },
          { action: "cancel", label: "Cancel", icon: "fas fa-times" },
        ],
      });
      if (sysResult !== "confirm") return;
      targetSystem = breached.find(s => s.key === captured) ?? breached[0];
    }

    const patchPayload = encodeURIComponent(JSON.stringify({
      actorId: shipActor.id, tokenId: shipToken?.id ?? null,
      systemKey: targetSystem.key, systemLabel: targetSystem.label,
      actorName: shipActor.name, patchCount: 1,
    }));
    ChatMessage.create({
      flags: { "sta2e-toolkit": { dcResultCard: true } },
      content: lcarsCard("🔧 DAMAGE CONTROL — SUCCESS", LC.green, `
        <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
          margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
        <div style="font-size:13px;font-weight:700;color:${LC.green};
          margin-bottom:6px;font-family:${LC.font};">
          ${targetSystem.label} — breach can be patched
        </div>
        <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
          line-height:1.5;margin-bottom:8px;">
          Patching removes Difficulty penalties but does NOT remove the breach.
          A new breach on this system will undo the patch.
        </div>
        <button class="sta2e-apply-patch"
          data-payload="${patchPayload}"
          style="width:100%;padding:5px;background:rgba(0,200,100,0.12);
            border:1px solid ${LC.green};border-radius:2px;
            color:${LC.green};font-size:10px;font-weight:700;
            letter-spacing:0.08em;text-transform:uppercase;
            cursor:pointer;font-family:${LC.font};">
          🔧 APPLY PATCH → ${targetSystem.label}
        </button>`),
      speaker: { alias: "STA2e Toolkit" },
    });
    return;
  }

  // ── Transport ───────────────────────────────────────────────────────────────
  if (taskKey === "transport") {
    // If config was captured before rolling (sheet side panel path), use it directly.
    // Otherwise show the config dialog now (HUD post-roll path or confirm-results path).
    const config = transportConfig ?? await showTransportConfigDialog(shipActor);
    if (!config) return;
    const { transportType, operationSite, totalDiff,
            typeLabel = config.typeLabel, siteLabel = config.siteLabel } = config;
    const resultCard = passed
      ? lcarsCard("✨ TRANSPORT SUCCESS", LC.primary, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;
            margin-bottom:5px;font-size:10px;font-family:${LC.font};">
            <div><span style="color:${LC.textDim};">Type: </span>
              <strong style="color:${LC.text};">${typeLabel}</strong></div>
            <div><span style="color:${LC.textDim};">From: </span>
              <strong style="color:${LC.text};">${siteLabel}</strong></div>
            <div><span style="color:${LC.textDim};">Difficulty: </span>
              <strong style="color:${LC.tertiary};">${totalDiff}</strong></div>
            <div><span style="color:${LC.textDim};">Successes: </span>
              <strong style="color:${LC.green};">${successes}</strong></div>
          </div>
          ${momentum > 0 ? `<div style="font-size:10px;color:${LC.green};font-family:${LC.font};">
            +${momentum} Momentum generated</div>` : ""}
          <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};
            margin-top:4px;line-height:1.5;">
            Transport complete. Spend Momentum for additional effects.
          </div>`)
      : lcarsCard("✨ TRANSPORT FAILED", LC.red, `
          <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
            margin-bottom:4px;font-family:${LC.font};">${shipActor.name}</div>
          <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
            Transport failed — ${typeLabel} from ${siteLabel} (Difficulty ${totalDiff}).
            Subjects remain at origin location.
          </div>`);
    ChatMessage.create({ content: resultCard, speaker: { alias: "STA2e Toolkit" } });
    return;
  }
}

export async function promptShipCardDestination({ overlayId, title, color, tokenId = null, actorId = null, maxZones = null }) {
  return await new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.style.cssText = `position:fixed;top:10px;left:50%;transform:translateX(-50%);
      background:rgba(0,0,0,0.75);color:${color};border:1px solid ${color};
      padding:6px 18px;border-radius:4px;z-index:999999;
      font-family:'Arial Narrow',sans-serif;text-align:center;pointer-events:none;`;
    overlay.innerHTML = `<div style="font-size:13px;font-weight:700;letter-spacing:0.1em;">
      ${title}</div>
      <div style="font-size:10px;margin-top:2px;">Click to set destination · ESC to cancel</div>`;
    document.body.appendChild(overlay);
    const prevBodyCursor = document.body.style.cursor;
    const prevViewCursor = canvas.app.view.style.cursor;
    const prevParentCursor = canvas.app.view.parentElement?.style.cursor ?? "";
    document.body.style.cursor = "crosshair";
    canvas.app.view.style.cursor = "crosshair";
    if (canvas.app.view.parentElement) canvas.app.view.parentElement.style.cursor = "crosshair";
    ui.notifications.info("Click a destination on the scene, or press Escape to cancel.");

    // ── Tether: PIXI line from ship token to cursor ──────────────────────────
    let _tetherGfx = null;
    let _tetherLabel = null;
    const _shipToken = tokenId
      ? (canvas.tokens?.get(tokenId) ?? canvas.tokens?.placeables.find(t => t.document?.id === tokenId) ?? null)
      : actorId
        ? (canvas.tokens?.placeables.find(t => t.document?.actorId === actorId || t.actor?.id === actorId) ?? null)
        : null;


    if (_shipToken) {
      _tetherGfx = new PIXI.Graphics();
      const _tetherParent = canvas?.interface ?? canvas?.stage;
      _tetherParent?.addChild(_tetherGfx);
    }

    const _tetherMove = (event) => {
      if (!_tetherGfx || !_shipToken) return;
      const cursorPt = canvas?.canvasCoordinatesFromClient?.({ x: event.clientX, y: event.clientY });
      if (!cursorPt) return;

      const origin = _shipToken.center ?? { x: _shipToken.x, y: _shipToken.y };
      _tetherGfx.clear();

      let lineColor = 0xffffff;
      let labelText = "";
      const zones = getSceneZones();
      if (zones.length && maxZones != null) {
        const info = getZonePathWithCosts(origin, cursorPt, zones);
        const zn = info?.zoneCount ?? -1;
        if (zn >= 0) {
          const withinRange = zn <= maxZones;
          lineColor = withinRange ? 0x00cc44 : 0xff3333;
          labelText = `${zn} zone${zn !== 1 ? "s" : ""} · ${info.rangeBand}${withinRange ? "" : " (out of range)"}`;
        } else {
          lineColor = 0xffffff;
          labelText = "out of zones";
        }
      } else {
        lineColor = parseInt(color.replace("#", ""), 16);
      }

      // Dashed tether line
      _tetherGfx.lineStyle(2, lineColor, 0.8);
      const dx = cursorPt.x - origin.x;
      const dy = cursorPt.y - origin.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const nx = dx / len, ny = dy / len;
        const dash = 18, gap = 10;
        let pos = 0;
        let drawing = true;
        while (pos < len) {
          const seg = Math.min(drawing ? dash : gap, len - pos);
          if (drawing) {
            _tetherGfx.moveTo(origin.x + nx * pos, origin.y + ny * pos);
            _tetherGfx.lineTo(origin.x + nx * (pos + seg), origin.y + ny * (pos + seg));
          }
          pos += seg;
          drawing = !drawing;
        }
      }

      // Endpoint circle at cursor
      _tetherGfx.lineStyle(0);
      _tetherGfx.beginFill(lineColor, 0.5);
      _tetherGfx.drawCircle(cursorPt.x, cursorPt.y, 6);
      _tetherGfx.endFill();

      if (_tetherLabel && labelText) {
        const px = Math.min(event.clientX + 18, window.innerWidth - 200);
        const py = Math.min(event.clientY + 18, window.innerHeight - 40);
        _tetherLabel.style.left = `${px}px`;
        _tetherLabel.style.top  = `${py}px`;
        _tetherLabel.textContent = labelText;
        _tetherLabel.style.color = `#${lineColor.toString(16).padStart(6, "0")}`;
      }
    };

    if (_shipToken) {
      _tetherLabel = document.createElement("div");
      _tetherLabel.style.cssText = `position:fixed;z-index:1000000;pointer-events:none;
        font-family:'Arial Narrow',sans-serif;font-size:11px;font-weight:700;
        letter-spacing:0.08em;text-shadow:0 0 4px #000;`;
      document.body.appendChild(_tetherLabel);
      window.addEventListener("mousemove", _tetherMove);
    }

    const extractPoint = (event) => {
      if (event?.clientX != null && event?.clientY != null && canvas?.canvasCoordinatesFromClient) {
        const pt = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
        if (pt?.x != null && pt?.y != null) return { x: pt.x, y: pt.y };
      }
      const origin =
        event?.interactionData?.origin
        ?? event?.data?.origin
        ?? event?.data?.getLocalPosition?.(canvas.stage)
        ?? event?.getLocalPosition?.(canvas.stage)
        ?? null;
      if (origin?.x != null && origin?.y != null) return { x: origin.x, y: origin.y };
      return null;
    };

    const cleanup = () => {
      document.getElementById(overlayId)?.remove();
      canvas.stage.off("mousedown", clickHandler);
      canvas.stage.off("pointerdown", clickHandler);
      canvas.app.view?.removeEventListener("pointerdown", domClickHandler, true);
      document.removeEventListener("keydown", escHandler);
      document.body.style.cursor = prevBodyCursor;
      canvas.app.view.style.cursor = prevViewCursor || "default";
      if (canvas.app.view.parentElement) canvas.app.view.parentElement.style.cursor = prevParentCursor;
      // Tether cleanup
      window.removeEventListener("mousemove", _tetherMove);
      _tetherLabel?.remove();
      if (_tetherGfx) {
        _tetherGfx.clear();
        _tetherGfx.parent?.removeChild(_tetherGfx);
        _tetherGfx.destroy();
        _tetherGfx = null;
      }
    };
    const clickHandler = (event) => {
      const point = extractPoint(event);
      if (!point) return;
      cleanup();
      resolve(point);
    };
    const domClickHandler = (event) => {
      const point = extractPoint(event);
      if (!point) return;
      cleanup();
      resolve(point);
    };
    const escHandler = (event) => {
      if (event.key !== "Escape") return;
      cleanup();
      resolve(null);
    };

    canvas.stage.on("mousedown", clickHandler);
    canvas.stage.on("pointerdown", clickHandler);
    canvas.app.view?.addEventListener("pointerdown", domClickHandler, true);
    document.addEventListener("keydown", escHandler);
  });
}

function getCardShipToken(payload = {}) {
  const tok = canvas.tokens?.get(payload.tokenId);
  if (!tok) throw new Error("Token not found on current scene.");
  return tok;
}

function getActorPlayerUserIds(actor) {
  if (!actor) return [];
  return game.users
    .filter(user => !user.isGM && actor.testUserPermission?.(user, "OWNER"))
    .map(user => user.id);
}

function getStationAllowedUserIds(shipActor, stationId) {
  const ids = new Set();
  const officers = getStationOfficers(shipActor, stationId) ?? [];
  for (const officer of officers) {
    for (const userId of getActorPlayerUserIds(officer)) ids.add(userId);
  }
  return Array.from(ids);
}

function normalizeShipDestination(tok, point) {
  const gridSize = canvas.grid?.size ?? 100;
  const tokW = (tok.document.width ?? 1) * gridSize;
  const tokH = (tok.document.height ?? 1) * gridSize;

  // Treat the click as the desired ship center, then convert to top-left token coords.
  const desired = {
    x: point.x - tokW / 2,
    y: point.y - tokH / 2,
  };

  const snapped = canvas.grid?.getSnappedPoint
    ? canvas.grid.getSnappedPoint(desired, {})
    : desired;

  return {
    x: snapped?.x ?? desired.x,
    y: snapped?.y ?? desired.y,
  };
}

export async function runImpulseEngageCard(payload, destination) {
  const tok = getCardShipToken(payload);
  const impulseSound = game.settings.get("sta2e-toolkit", "sndImpulseEngage") ?? "";
  const startPos = { x: tok.x, y: tok.y };
  const startOrigin = tok.center ?? { x: tok.x + tok.w / 2, y: tok.y + tok.h / 2 };
  const finalDestination = normalizeShipDestination(tok, destination);

  // Suppress per-frame zone log chat cards during the Bezier animation; one
  // card is posted manually after the final position update.
  game.sta2eToolkit?.zoneMovementLog?._suppressIds?.add(tok.document.id);

  try {
    await TokenMagic.addUpdateFilters(tok, [{
      filterType: "glow", filterId: "impulseGlow",
      outerStrength: 12, innerStrength: 4, color: 0xff3300,
      quality: 0.5, padding: 10,
      animated: { time: { active: true, speed: 0.02, animType: "move" } }
    }, {
      filterType: "bulgepinch", filterId: "impulseCharge",
      padding: 20, strength: 0.1, radius: 150,
      animated: { strength: { active: true, val1: 0.03, val2: 0.1, speed: 0.06, animType: "cosOscillation" } }
    }]);
  } catch(e) { console.warn("STA2e | impulse pre-glow:", e); }
  await new Promise(r => setTimeout(r, 800));

  if (impulseSound) {
    try { new Sequence().sound().file(impulseSound).volume(0.8).play(); } catch(e) {}
  }

  const dx   = finalDestination.x - startPos.x;
  const dy   = finalDestination.y - startPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const mx   = startPos.x + dx * 0.5;
  const my   = startPos.y + dy * 0.5;
  const arcAmount = Math.min(dist * 0.3, 200);
  const px   = mx - (dy / dist) * arcAmount;
  const py   = my + (dx / dist) * arcAmount;

  const ease        = t => t * t * (3 - 2 * t);
  const DURATION_MS = 700;
  const STEP_MS     = 16;
  const STEPS       = Math.round(DURATION_MS / STEP_MS);

  for (let i = 1; i <= STEPS; i++) {
    const raw = i / STEPS;
    const t   = ease(raw);
    const mt  = 1 - t;
    const bx  = mt * mt * startPos.x + 2 * mt * t * px + t * t * finalDestination.x;
    const by  = mt * mt * startPos.y + 2 * mt * t * py + t * t * finalDestination.y;

    const rt  = Math.max(0.01, Math.min(0.99, raw));
    const rmt = 1 - rt;
    const tdx = 2 * rmt * (px - startPos.x) + 2 * rt * (finalDestination.x - px);
    const tdy = 2 * rmt * (py - startPos.y) + 2 * rt * (finalDestination.y - py);
    const tangentAngle = Math.atan2(tdy, tdx) * (180 / Math.PI) - 90;

    await tok.document.update({ x: bx, y: by, rotation: tangentAngle });
    await new Promise(r => setTimeout(r, STEP_MS));
  }

  const finalAngle = Math.atan2(finalDestination.y - startPos.y, finalDestination.x - startPos.x) * (180 / Math.PI) - 90;
  await tok.document.update({ x: finalDestination.x, y: finalDestination.y, rotation: finalAngle });

  // Lift suppression and post a single zone movement log for the full move.
  game.sta2eToolkit?.zoneMovementLog?._suppressIds?.delete(tok.document.id);
  game.sta2eToolkit?.zoneMovementLog?.onTokenMove(
    tok.document, startOrigin,
    { x: finalDestination.x, y: finalDestination.y }
  );

  try {
    await TokenMagic.deleteFilters(tok, "impulseGlow");
    await TokenMagic.deleteFilters(tok, "impulseCharge");
    await TokenMagic.addUpdateFilters(tok, [{
      filterType: "glow", filterId: "impulseResidual",
      outerStrength: 6, innerStrength: 2, color: 0xff3300,
      quality: 0.5, padding: 10,
      animated: { outerStrength: { active: true, val1: 6, val2: 0, loops: 1, loopDuration: 800 } }
    }]);
    setTimeout(() => { try { TokenMagic.deleteFilters(tok, "impulseResidual"); } catch {} }, 1000);
  } catch(e) { console.warn("STA2e | impulse cleanup:", e); }
}

export async function runWarpEngageCard(payload, destination) {
  const tok = getCardShipToken(payload);
  const warpSound = game.settings.get("sta2e-toolkit", "sndWarpEngage") ?? "";
  const startPosition = { x: tok.x, y: tok.y };
  const finalDestination = normalizeShipDestination(tok, destination);

  try {
    await TokenMagic.addUpdateFilters(tok, [{
      filterType: "glow", filterId: "warpGlow",
      outerStrength: 15, innerStrength: 5, color: 0x00a6fb,
      quality: 0.5, padding: 10,
      animated: { time: { active: true, speed: 0.01, animType: "move" } }
    }, {
      filterType: "bulgepinch", filterId: "warpCharge",
      padding: 30, strength: 0.15, radius: 200,
      animated: { strength: { active: true, val1: 0.05, val2: 0.15, speed: 0.05, animType: "cosOscillation" } }
    }]);
  } catch(e) { console.warn("STA2e | warp pre-glow:", e); }
  await new Promise(r => setTimeout(r, 1500));

  try {
    const angle = Math.atan2(finalDestination.y - startPosition.y, finalDestination.x - startPosition.x) * (180 / Math.PI);
    const targetRotation = angle - 90;
    const orig  = tok.document.rotation || 0;
    const delta = ((targetRotation - orig + 540) % 360) - 180;
    const steps = 15;
    for (let i = 1; i <= steps; i++) {
      await tok.document.update({ rotation: orig + (delta / steps * i) });
      await new Promise(r => setTimeout(r, 20));
    }
    await tok.document.update({ rotation: targetRotation });
  } catch(e) { console.warn("STA2e | warp rotate:", e); }

  try {
    await TokenMagic.addUpdateFilters(tok, [{
      filterType: "blur", filterId: "warpBlur", padding: 10, quality: 4, blur: 10,
      animated: { blur: { active: true, val1: 0, val2: 20, speed: 0.1, animType: "ramp" } },
    }]);
    new Sequence().effect().atLocation(tok).scale(0.7).fadeIn(200).fadeOut(300).play();
    if (warpSound) new Sequence().sound().file(warpSound).volume(0.8).play();
  } catch(e) { console.warn("STA2e | warp flash:", e); }
  await new Promise(r => setTimeout(r, 1000));

  await tok.document.update({ alpha: 0 });
  await tok.document.update({ x: finalDestination.x, y: finalDestination.y });

  try {
    new Sequence().effect().atLocation(tok).scale(0.7).fadeIn(200).fadeOut(300).play();
  } catch(e) { console.warn("STA2e | warp exit:", e); }
  await new Promise(r => setTimeout(r, 300));
  await tok.document.update({ alpha: 1 });

  try {
    await TokenMagic.deleteFilters(tok, "warpGlow");
    await TokenMagic.deleteFilters(tok, "warpCharge");
    await TokenMagic.deleteFilters(tok, "warpBlur");
    await TokenMagic.addUpdateFilters(tok, [{
      filterType: "glow", filterId: "warpResidualGlow",
      outerStrength: 5, innerStrength: 2, color: 0x00a6fb,
      quality: 0.5, padding: 10,
      animated: { outerStrength: { active: true, val1: 5, val2: 0, loops: 1, loopDuration: 1000 } }
    }]);
    setTimeout(() => { try { TokenMagic.deleteFilters(tok); } catch {} }, 1500);
  } catch(e) { console.warn("STA2e | warp cleanup:", e); }
}

export async function runWarpFleeCard(payload) {
  const tok = getCardShipToken(payload);
  const warpSound = game.settings.get("sta2e-toolkit", "sndWarpEngage") ?? "";

  const gridSize  = canvas.grid?.size ?? 100;
  const tokW      = (tok.document.width  ?? 1) * gridSize;
  const tokH      = (tok.document.height ?? 1) * gridSize;
  const cx        = tok.x + tokW / 2;
  const cy        = tok.y + tokH / 2;
  const sceneX    = canvas.dimensions?.sceneX      ?? 0;
  const sceneY    = canvas.dimensions?.sceneY      ?? 0;
  const sceneW    = canvas.dimensions?.sceneWidth  ?? canvas.scene.width;
  const sceneH    = canvas.dimensions?.sceneHeight ?? canvas.scene.height;

  const distLeft   = cx - sceneX;
  const distRight  = (sceneX + sceneW) - cx;
  const distTop    = cy - sceneY;
  const distBottom = (sceneY + sceneH) - cy;
  const minDist    = Math.min(distLeft, distRight, distTop, distBottom);

  let destX = tok.x;
  let destY = tok.y;
  if (minDist === distLeft)       destX = sceneX - tokW - gridSize;
  else if (minDist === distRight) destX = sceneX + sceneW + gridSize;
  else if (minDist === distTop)   destY = sceneY - tokH - gridSize;
  else                            destY = sceneY + sceneH + gridSize;

  try {
    await TokenMagic.addUpdateFilters(tok, [{
      filterType: "glow", filterId: "warpGlow",
      outerStrength: 15, innerStrength: 5, color: 0x00a6fb,
      quality: 0.5, padding: 10,
      animated: { time: { active: true, speed: 0.01, animType: "move" } }
    }, {
      filterType: "bulgepinch", filterId: "warpCharge",
      padding: 30, strength: 0.15, radius: 200,
      animated: { strength: { active: true, val1: 0.05, val2: 0.15, speed: 0.05, animType: "cosOscillation" } }
    }]);
  } catch(e) { console.warn("STA2e | warp-flee pre-glow:", e); }
  await new Promise(r => setTimeout(r, 1200));

  try {
    const angle = Math.atan2(destY - tok.y, destX - tok.x) * (180 / Math.PI);
    const targetRotation = angle - 90;
    const orig  = tok.document.rotation || 0;
    const delta = ((targetRotation - orig + 540) % 360) - 180;
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await tok.document.update({ rotation: orig + (delta / steps * i) });
      await new Promise(r => setTimeout(r, 20));
    }
    await tok.document.update({ rotation: targetRotation });
  } catch(e) { console.warn("STA2e | warp-flee rotate:", e); }

  try {
    await TokenMagic.addUpdateFilters(tok, [{
      filterType: "blur", filterId: "warpBlur", padding: 10, quality: 4, blur: 10,
      animated: { blur: { active: true, val1: 0, val2: 20, speed: 0.1, animType: "ramp" } }
    }]);
    if (warpSound) new Sequence().sound().file(warpSound).volume(0.8).play();
  } catch(e) { console.warn("STA2e | warp-flee flash:", e); }
  await new Promise(r => setTimeout(r, 600));

  const startX = tok.x;
  const startY = tok.y;
  const steps = 10;
  const dxStep = (destX - startX) / steps;
  const dyStep = (destY - startY) / steps;
  for (let i = 1; i <= steps; i++) {
    const alpha = Math.max(0, 1 - i / steps);
    await tok.document.update({ x: startX + dxStep * i, y: startY + dyStep * i, alpha });
    await new Promise(r => setTimeout(r, 30));
  }

  await tok.document.delete();
}

// ── renderChatMessageHTML hook ───────────────────────────────────────────────
// v13: passes (message, htmlElement) — no jQuery wrapper
// Ground injury buttons are visible to ALL users (players choose to avoid/take).
// Ship damage buttons are GM-only.

Hooks.on("renderChatMessageHTML", (message, html) => {
  const toolkitFlags = message.flags?.["sta2e-toolkit"] ?? {};

  if (toolkitFlags.playerRollCard || toolkitFlags.assistCard) {
    const rollOwnerUserId = toolkitFlags.rollOwnerUserId ?? message.author?.id ?? null;
    const allowedUserIds = Array.isArray(toolkitFlags.allowedUserIds)
      ? toolkitFlags.allowedUserIds
      : [];
    const canUseWorkingRoll = game.user.isGM
      || (rollOwnerUserId ? game.user.id === rollOwnerUserId : false)
      || allowedUserIds.includes(game.user.id);
    if (!canUseWorkingRoll) {
      html.querySelectorAll(".sta2e-working-actions").forEach(section => section.remove());
    }
  }

  // ── Ground combat — Apply Injury buttons (GM only) ───────────────────────
  if (toolkitFlags.groundDamageCard) {
    if (!game.user.isGM) {
      // Hide the controls entirely for non-GM players — injury is GM-applied
      html.querySelectorAll(".sta2e-ground-controls").forEach(el => {
        el.style.display = "none";
      });
    } else {
      html.querySelectorAll(".sta2e-ground-controls").forEach(controls => {
        const adjInput     = controls.querySelector(".sta2e-ground-adj");
        const applyBtn     = controls.querySelector(".sta2e-apply-injury");
        const potencyDisp  = controls.querySelector(".sta2e-potency-display");
        const injLabel     = controls.closest("div")?.querySelector(".sta2e-injury-label");

        // Wire momentum/threat adjustment spinner
        if (adjInput && applyBtn) {
          adjInput.addEventListener("input", () => {
            const base       = JSON.parse(decodeURIComponent(adjInput.dataset.basePayload));
            const basePot    = parseInt(base.basePotency) || 0;
            const useStun    = adjInput.dataset.useStun === "true";
            const weaponName = adjInput.dataset.weaponName;
            const severity   = parseInt(adjInput.dataset.severity) || 0;

            // Clamp: max +2 (Momentum limit); complications can reduce potency to 0
            const adjFloor = -basePot;
            const raw      = parseInt(adjInput.value) || 0;
            const clamped  = Math.min(2, Math.max(adjFloor, raw));
            if (clamped !== raw) adjInput.value = clamped;

            const newPotency = basePot + clamped;
            const newInjName = CombatHUD._groundInjuryName(weaponName, useStun, newPotency, severity);

            if (potencyDisp) {
              const adjColor = clamped > 0 ? "#66cc66" : clamped < 0 ? "#ff6666" : "var(--sta2e-tertiary, #ffcc66)";
              potencyDisp.innerHTML = `= Potency <strong style="color:${adjColor};">${newPotency}</strong>`
                + (clamped !== 0 ? ` <span style="font-size:9px;color:${adjColor};">(${clamped > 0 ? "+" : ""}${clamped})</span>` : "");
            }
            if (injLabel) injLabel.textContent = newInjName;

            const updated = { ...base, potency: newPotency, injuryName: newInjName };
            applyBtn.dataset.payload = encodeURIComponent(JSON.stringify(updated));
          });
        }

        // Wire apply button
        if (applyBtn) {
          applyBtn.addEventListener("click", async () => {
            try {
              const payload = JSON.parse(decodeURIComponent(applyBtn.dataset.payload));
              await CombatHUD.applyGroundInjury(payload);
              applyBtn.disabled      = true;
              applyBtn.textContent   = "✓ Decision Sent";
              applyBtn.style.opacity = "0.5";
              if (adjInput) adjInput.disabled = true;
            } catch(err) {
              console.error("STA2e Toolkit | applyGroundInjury error:", err);
              ui.notifications.error("Failed to resolve injury — see console for details.");
            }
          });
        }
      });
    }
  }

  // ── Ground combat — Injury Decision card (avoid / take buttons) ──────────
  if (toolkitFlags.injuryDecisionCard) {
    // Already resolved — buttons have been replaced by resolved text on message update
    if (toolkitFlags?.injuryResolved) return;

    let payload;
    try {
      payload = JSON.parse(decodeURIComponent(
        toolkitFlags.injuryPayload ?? "{}"
      ));
    } catch { return; }

    const actor   = canvas?.tokens?.get(payload.tokenId)?.actor ?? game.actors.get(payload.actorId);
    const isOwner = actor?.isOwner ?? false;

    if (!game.user.isGM && !isOwner) {
      // Non-owner, non-GM: hide buttons (message is whispered but just in case)
      html.querySelectorAll(".sta2e-injury-btn").forEach(b => b.style.display = "none");
      return;
    }

    html.querySelectorAll(".sta2e-injury-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const choice = btn.dataset.choice;
        // Optimistic: disable all buttons immediately
        html.querySelectorAll(".sta2e-injury-btn").forEach(b => {
          b.disabled      = true;
          b.style.opacity = "0.4";
        });

        if (game.user.isGM) {
          await CombatHUD._executeInjuryResolution(choice, payload, message.id);
        } else {
          game.socket.emit("module.sta2e-toolkit", {
            action:    "resolveInjuryDecision",
            choice,
            payload,
            messageId: message.id,
          });
        }
      });
    });
  }

  const getCardActorAccess = (payload = {}) => {
    const actor = canvas?.tokens?.get(payload.tokenId)?.actor
      ?? game.actors.get(payload.actorId)
      ?? null;
    if (!actor) return { actor: null, canUse: game.user.isGM };

    const isShip = actor.system?.systems !== undefined;
    const isNpc  = isShip
      ? CombatHUD.isNpcShip(actor)
      : CombatHUD.isGroundNpcActor(actor);

    return {
      actor,
      canUse: game.user.isGM || (actor.isOwner && !isNpc),
    };
  };

  const syncShipCardLock = async (updates = {}) => {
    if (game.user.isGM) {
      const payload = {};
      for (const [key, value] of Object.entries(updates)) {
        payload[`flags.sta2e-toolkit.${key}`] = value;
      }
      await message.update(payload).catch(err =>
        console.error("STA2e Toolkit | ship card lock update failed:", err));
      return;
    }

    game.socket.emit("module.sta2e-toolkit", {
      action: "updateShipCardLock",
      messageId: message.id,
      requesterUserId: game.user.id,
      updates,
    });
  };

  const impulseLocked = !!toolkitFlags.impulseEngageConsumed;
  const warpLockState = toolkitFlags.warpEngageConsumedAction ?? null;
  const hasExplicitAllowedUsers = Object.prototype.hasOwnProperty.call(
    toolkitFlags,
    "allowedUserIds"
  );
  const allowedUserIds = toolkitFlags.allowedUserIds ?? [];

  // ── Player ship — Open Task Roller (from Direct declaration) ─────────────
  // Available to ALL users so the directed officer can open their own roller.
  html.querySelectorAll(".sta2e-open-task-roller").forEach(btn => {
    btn.addEventListener("click", async () => {
      const payload = JSON.parse(decodeURIComponent(btn.dataset.payload ?? "{}"));
      const { shipActorId, shipTokenId, stationId, stationLabel, commanderName, taskKey, taskLabel, weaponId } = payload;

      const shipActor = game.actors.get(shipActorId);
      if (!shipActor) { ui.notifications.warn("Ship actor not found."); return; }

      const tokenObj = canvas.tokens?.get(shipTokenId) ?? null;

      const stationOfficers = getStationOfficers(shipActor, stationId);
      if (stationOfficers.length === 0) {
        ui.notifications.warn(
          `${stationLabel}: No officer assigned — assign a crew member in the Crew Manifest.`
        );
        return;
      }
      const officer = readOfficerStats(stationOfficers[0]);
      const officerActorObj = stationOfficers[0] ?? null;

      // ── Instant-apply branch — tasks with no dice roll ────────────────────
      // These apply an effect directly; opening the roller would be wrong.
      const _DIRECT_INSTANT = new Set(["evasive-action", "defensive-fire", "attack-pattern", "reroute-power", "modulate-shields"]);
      if (taskKey && _DIRECT_INSTANT.has(taskKey)) {
        if (taskKey === "reroute-power") {
          const system = await showRerouteSystemDialog(shipActor);
          if (!system) return;
          await handleOfficerTaskResult("reroute-power", shipActor, tokenObj, officerActorObj,
            { passed: true, successes: 0, momentum: 0, rerouteSystem: system });
        } else if (taskKey === "modulate-shields") {
          await applyModulateShieldsForOfficer(shipActor, tokenObj);
        } else {
          // evasive-action, defensive-fire, attack-pattern
          await applyDefenseModeForOfficer(shipActor, tokenObj, taskKey);
        }
        return;
      }

      // ── Weapon-attack branch — Directed fire on a specific ship weapon ───
      if (taskKey === "fire-weapon" && weaponId) {
        const weapon = shipActor.items.get(weaponId);
        if (!weapon) { ui.notifications.warn(`Weapon not found on ${shipActor.name}.`); return; }

        const config    = getWeaponConfig(weapon);
        const isTorpedo = config?.type === "torpedo";
        const hasTS     = CombatHUD.hasTargetingSolution(tokenObj);
        const hasRFT    = hasRapidFireTorpedoLauncher(shipActor) && isTorpedo;
        const hasAP     = tokenObj ? hasCondition(tokenObj, "attack-pattern") : false;

        const helmActors  = getStationOfficers(shipActor, "helm");
        const helmActor   = helmActors[0] ?? null;
        const helmOfficer = helmActor ? readOfficerStats(helmActor) : null;
        const attackRunActive = hasAP && hasAttackRun(helmActor);

        // Inline quality string (mirrors _weaponQualityString — not available outside class)
        const _quals = (() => {
          const LABELS = {
            area:        "Area",         calibration: "Calibration", cumbersome:  "Cumbersome",
            dampening:   "Dampening",    depleting:   "Depleting",   devastating: "Devastating",
            highyield:   "High Yield",   intense:     "Intense",     jamming:     "Jamming",
            persistent:  "Persistent",   piercing:    "Piercing",    slowing:     "Slowing",
            spread:      "Spread",
          };
          const q = weapon.system?.qualities ?? {};
          const parts = [];
          for (const [k, lbl] of Object.entries(LABELS)) if (q[k]) parts.push(lbl);
          if (q.hiddenx   > 0) parts.push(`Hidden ${q.hiddenx}`);
          if (q.versatilex > 0) parts.push(`Versatile ${q.versatilex}`);
          return parts.join(", ") || "None";
        })();

        const weaponCtx = {
          name:      weapon.name,
          isTorpedo,
          damage:    weapon.system?.damage ?? 0,
          qualities: _quals,
        };

        openPlayerRoller(shipActor, tokenObj, {
          stationId:            "tactical",
          officer,
          weaponContext:        weaponCtx,
          hasTargetingSolution: hasTS,
          hasRapidFireTorpedo:  hasRFT,
          hasAttackPattern:     hasAP,
          helmOfficer,
          attackRunActive,
          taskLabel:   `Attack — ${weapon.name}`,
          taskContext: commanderName ? `Directed by ${commanderName} (Control + Command)` : null,
        });
        return;
      }
      // ─────────────────────────────────────────────────────────────────────

      // Task-specific roller pre-configuration — defined at module scope as TASK_PARAMS

      const tp             = taskKey ? (TASK_PARAMS[taskKey] ?? null) : null;
      const resolvedLabel  = taskLabel ?? `${stationLabel} Task`;
      const resolvedContext = [
        tp?.ctx ?? null,
        commanderName ? `Directed by ${commanderName} (Control + Command)` : null,
      ].filter(Boolean).join(" · ");

      // Build a taskCallback so task-specific post-roll effects (warp, ram, etc.) fire
      // even when the roller is opened via a Direct declaration card.
      const directTaskCallback = taskKey ? async ({ passed, successes = 0, momentum = 0 }) => {
        const targetToken = Array.from(game.user.targets ?? [])[0] ?? null;

        if (taskKey === "warp") {
          await applyWarpForOfficer(shipActor, tokenObj, passed);

        } else if (taskKey === "ram") {
          await applyRamForOfficer(tokenObj, targetToken, passed, momentum);

        } else if (taskKey === "tractor-beam") {
          if (!passed) return;
          if (!targetToken) { ui.notifications.warn("Select a target token for Tractor Beam."); return; }
          await lockTractorBeam(tokenObj, targetToken);

        } else if (taskKey === "scan-for-weakness") {
          if (!passed) return;
          if (!targetToken) { ui.notifications.warn("Select a target token for Scan for Weakness."); return; }
          const cardHtml = await applyScanForWeakness(tokenObj, targetToken, tokenObj?.name ?? shipActor.name);
          ChatMessage.create({ content: cardHtml, speaker: ChatMessage.getSpeaker({ token: tokenObj }) });

        } else if (["regen-shields","regain-power","reroute-power","damage-control","transport"].includes(taskKey)) {
          await handleOfficerTaskResult(taskKey, shipActor, tokenObj, officerActorObj,
            { passed, successes, momentum });
        }
      } : null;

      openPlayerRoller(shipActor, tokenObj, {
        stationId,
        officer,
        ...(tp?.difficulty    !== undefined ? { difficulty:          tp.difficulty    } : {}),
        ...(tp?.shipSystemKey               ? { shipSystemKey:       tp.shipSystemKey } : {}),
        ...(tp?.shipDeptKey                 ? { shipDeptKey:         tp.shipDeptKey   } : {}),
        ...(tp?.ignoreBreachPenalty         ? { ignoreBreachPenalty: true             } : {}),
        ...(tp?.noShipAssist                ? { noShipAssist:        true             } : {}),
        ...(tp?.rallyContext                ? { rallyContext:        true             } : {}),
        taskLabel:   resolvedLabel,
        taskContext: resolvedContext || null,
        taskCallback: directTaskCallback,
      });
    });
  });

  // ── Player ship — Roll Assist Die (Working Results card) ─────────────────
  // Available to ALL users — the assisting officer clicks this button on the
  // Working Results card, selects their attr/disc/focus via a dialog, rolls
  // their d20, and an updated Working Results card is posted with the die
  // factored into the running total.
  html.querySelectorAll(".sta2e-player-assist-roll").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        const assistIndex    = parseInt(btn.dataset.assistIndex ?? "0");
        const payload        = JSON.parse(decodeURIComponent(btn.dataset.payload ?? "{}"));
        const pendingAssists = payload.pendingAssists ?? [];
        const ao             = pendingAssists[assistIndex];
        if (!ao) { ui.notifications.warn("Assist officer data not found."); return; }

        // Look up assisting actor's stats for the attr/disc selectors
        const assistActor = ao.actorId ? game.actors.get(ao.actorId) : null;
        const aoStats     = assistActor ? readOfficerStats(assistActor) : null;

        const attrOptions = OFFICER_ATTRIBUTES.map(({ key, label }) => {
          const val  = aoStats ? (aoStats.attributes[key]  ?? null) : null;
          const vStr = (typeof val === "number") ? ` (${val})` : "";
          const sel  = key === (ao.attrKey ?? "control") ? " selected" : "";
          return `<option value="${key}"${sel}>${label}${vStr}</option>`;
        }).join("");

        const discOptions = OFFICER_DISCIPLINES.map(({ key, label }) => {
          const val  = aoStats ? (aoStats.disciplines[key] ?? null) : null;
          const vStr = (typeof val === "number") ? ` (${val})` : "";
          const sel  = key === (ao.discKey ?? "conn") ? " selected" : "";
          return `<option value="${key}"${sel}>${label}${vStr}</option>`;
        }).join("");

        const selected = await foundry.applications.api.DialogV2.wait({
          window: { title: `${ao.name} — Assist Roll` },
          content: `
            <div style="padding:8px 10px;display:flex;flex-direction:column;gap:8px;">
              <div style="font-size:10px;color:#aaa;margin-bottom:2px;">
                Select <strong>${ao.name}</strong>'s attribute and discipline for this assist roll.
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div>
                  <label style="font-size:9px;color:#888;text-transform:uppercase;
                    letter-spacing:0.08em;display:block;margin-bottom:3px;">Attribute</label>
                  <select id="ao-attr" style="width:100%;padding:3px 5px;">${attrOptions}</select>
                </div>
                <div>
                  <label style="font-size:9px;color:#888;text-transform:uppercase;
                    letter-spacing:0.08em;display:block;margin-bottom:3px;">Discipline</label>
                  <select id="ao-disc" style="width:100%;padding:3px 5px;">${discOptions}</select>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:4px;margin-top:2px;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                  <input type="checkbox" id="ao-focus" ${ao.hasFocus ? "checked" : ""}/>
                  <span style="font-size:9px;color:#aaa;text-transform:uppercase;
                    letter-spacing:0.06em;">Has Focus on this task</span>
                </label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                  <input type="checkbox" id="ao-dedicated" ${ao.hasDedicatedFocus ? "checked" : ""}/>
                  <span style="font-size:9px;color:#aaa;text-transform:uppercase;
                    letter-spacing:0.06em;">Dedicated Focus</span>
                </label>
              </div>
            </div>`,
          buttons: [
            {
              action:  "roll",
              label:   "🎲 Roll",
              icon:    "fas fa-dice",
              default: true,
              callback: (_event, _btn2, dlg) => {
                const el = dlg.element;
                return {
                  attrKey:            el.querySelector("#ao-attr")?.value        ?? "control",
                  discKey:            el.querySelector("#ao-disc")?.value        ?? "conn",
                  hasFocus:           el.querySelector("#ao-focus")?.checked     ?? false,
                  hasDedicatedFocus: el.querySelector("#ao-dedicated")?.checked ?? false,
                };
              },
            },
            { action: "cancel", label: "Cancel", icon: "fas fa-times" },
          ],
        });

        if (!selected || selected === "cancel") return;

        // Resolve stat values for the chosen keys
        const attrVal    = aoStats ? (aoStats.attributes[selected.attrKey]  ?? ao.attrVal ?? 9) : (ao.attrVal ?? 9);
        const discVal    = aoStats ? (aoStats.disciplines[selected.discKey] ?? ao.discVal ?? 2) : (ao.discVal ?? 2);
        const target     = attrVal + discVal;
        const compThresh = payload.compThresh ?? 20;

        // Crit threshold: Dedicated Focus > Focus > none
        let critThresh;
        if (selected.hasDedicatedFocus) {
          critThresh = Math.min(20, Math.max(1, discVal * 2));
        } else if (selected.hasFocus) {
          critThresh = Math.max(1, discVal);
        } else {
          critThresh = 1;
        }

        const [die] = rollPool(1, target, compThresh, critThresh);

        // Disable button immediately so it can't be double-clicked
        btn.disabled      = true;
        btn.style.opacity = "0.5";
        btn.style.cursor  = "default";
        btn.textContent   = "✓ Rolled";

        // Build updated rollData: append die to namedAssistDice, remove officer from pendingAssists
        const newRollData = {
          ...payload,
          namedAssistDice: [
            ...(payload.namedAssistDice ?? []),
            {
              ...die,
              officerName: ao.name,
              attrKey: selected.attrKey,
              discKey: selected.discKey,
            },
          ],
          pendingAssists: pendingAssists.filter((_, i) => i !== assistIndex),
        };

        await message.update({
          content: buildPlayerRollCardHtml(newRollData),
          "flags.sta2e-toolkit.rollData": newRollData,
        });
      } catch(err) {
        console.error("STA2e Toolkit | player assist roll error:", err);
        ui.notifications.error("Assist die roll failed — see console.");
        btn.disabled      = false;
        btn.style.opacity = "";
        btn.style.cursor  = "";
        btn.textContent   = "🎲 Roll Assist Die";
      }
    });
  });

  // ── Player ship — Reroll (Working Results card) ───────────────────────────
  // Available to ALL users so each officer can use their own reroll abilities.
  html.querySelectorAll(".sta2e-player-reroll").forEach(btn => {
    // Disable immediately if this card was already confirmed — the roll is final.
    if (message.getFlag("sta2e-toolkit", "confirmed")) {
      btn.disabled      = true;
      btn.style.opacity = "0.4";
      btn.style.cursor  = "default";
      btn.title         = "Results already confirmed";
      return;
    }
    btn.addEventListener("click", async () => {
      try {
        const payload      = JSON.parse(decodeURIComponent(btn.dataset.payload ?? "{}"));
        const ability      = btn.dataset.ability ?? "";
        const abilityLabel = btn.dataset.abilityLabel ?? ability;
        const crewDice     = payload.crewDice ?? [];
        const crewTarget   = payload.crewTarget ?? 11;
        const critThresh   = payload.crewCritThresh ?? 1;
        const compThresh   = payload.compThresh ?? 20;
        const isDet          = ability === "detReroll";
        const isAim          = ability === "aim";
        const isTechExpertise = ability === "techExpertise";
        // Aim may allow up to N rerolls (1 normally, 2 with Accurate); use checkboxes when N>1
        const aimRemaining = isAim ? Math.max(0, (payload.aimRerolls ?? 0) - (payload.aimRerollsUsed ?? 0)) : 0;
        const useCheckbox  = isDet || (isAim && aimRemaining > 1);
        const countCrewSuccesses = (dice = []) => dice.reduce((sum, die) => {
          if (!die?.success) return sum;
          return sum + (die.crit ? 2 : 1);
        }, 0);
        const syncAssistStateAfterCrewReroll = (rollData) => {
          const nextRollData = {
            ...rollData,
            shipDice: [...(rollData.shipDice ?? [])],
          };
          const crewFailedNow = countCrewSuccesses(nextRollData.crewDice ?? []) === 0;
          nextRollData.crewFailed = crewFailedNow;

          if (crewFailedNow) {
            nextRollData.shipDice = [];
            return { rollData: nextRollData, newShipDice: [] };
          }

          const shouldRollShipAssist = !!nextRollData.shipAssist && (nextRollData.shipDice?.length ?? 0) === 0;
          if (!shouldRollShipAssist) {
            return { rollData: nextRollData, newShipDice: [] };
          }

          const shipTarget = nextRollData.shipTarget ?? 11;
          const shipCritThresh = nextRollData.shipCritThresh ?? 1;
          const shipDiceCount = nextRollData.advancedSensorsActive ? 2 : 1;

          if (nextRollData.reservePower) {
            const forced = {
              value: 1,
              success: true,
              crit: true,
              complication: false,
              critThreshold: shipCritThresh,
              reservePowerForced: true,
            };
            const rest = shipDiceCount > 1
              ? rollPool(shipDiceCount - 1, shipTarget, compThresh, shipCritThresh)
                .map(d => ({ ...d, reservePowerComp: d.complication }))
              : [];
            nextRollData.shipDice = [forced, ...rest];
          } else {
            nextRollData.shipDice = rollPool(shipDiceCount, shipTarget, compThresh, shipCritThresh);
          }

          return { rollData: nextRollData, newShipDice: [...nextRollData.shipDice] };
        };

        // Technical Expertise: pick ONE die from crew OR ship pool
        if (isTechExpertise) {
          if (crewDice.length === 0 && (payload.shipDice ?? []).length === 0) {
            ui.notifications.warn("No dice to reroll.");
            return;
          }
          const makeDieLabel = (d, pool, i) => {
            const pip = diePipHtml(d, i, "picker");
            return `<label style="display:inline-flex;align-items:center;gap:4px;padding:3px 5px;
              cursor:pointer;border:1px solid ${LC.borderDim};border-radius:2px;background:${LC.panel};">
              <input type="radio" name="reroll-die" value="${pool}:${i}"
                style="cursor:pointer;accent-color:${LC.secondary};flex-shrink:0;"/>
              ${pip}
            </label>`;
          };
          const crewSection = crewDice.length > 0 ? `
            <div style="margin-bottom:8px;">
              <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;
                letter-spacing:0.1em;border-bottom:1px solid ${LC.borderDim};
                padding-bottom:3px;margin-bottom:5px;">
                👤 Crew Dice
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:5px;">
                ${crewDice.map((d, i) => makeDieLabel(d, "crew", i)).join("")}
              </div>
            </div>` : "";
          const shipSection = (payload.shipDice ?? []).length > 0 ? `
            <div>
              <div style="font-size:8px;color:${LC.secondary};text-transform:uppercase;
                letter-spacing:0.1em;border-bottom:1px solid ${LC.borderDim};
                padding-bottom:3px;margin-bottom:5px;">
                🚀 Ship Dice
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:5px;">
                ${(payload.shipDice ?? []).map((d, i) => makeDieLabel(d, "ship", i)).join("")}
              </div>
            </div>` : "";
          const teResult = await foundry.applications.api.DialogV2.wait({
            window: { title: `${abilityLabel} — Select Die to Reroll` },
            content: `<div style="padding:6px 10px;font-family:${LC.font};">
              <p style="font-size:11px;color:${LC.textDim};margin-bottom:10px;">
                Select one die to reroll (Computers / Sensors only):
              </p>
              ${crewSection}${shipSection}
            </div>`,
            buttons: [
              {
                action: "confirm", label: "Reroll", icon: "fas fa-dice", default: true,
                callback: (_e, _b, dlg) => {
                  const inp = dlg.element.querySelector("input[name='reroll-die']:checked");
                  return inp ? inp.value : null;
                },
              },
              { action: "cancel", label: "Cancel", icon: "fas fa-times" },
            ],
          });
          if (!teResult || teResult === "cancel") return;
          const [tePool, teIdxStr] = teResult.split(":");
          const teIdx = parseInt(teIdxStr, 10);
          const teTarget = tePool === "ship" ? (payload.shipTarget ?? 11) : crewTarget;
          const [newDie] = rollPool(1, teTarget, payload.compThresh ?? 20, critThresh);
          const newCrewDice = [...crewDice];
          const newShipDice = [...(payload.shipDice ?? [])];
          if (tePool === "ship") { newShipDice[teIdx] = newDie; }
          else                  { newCrewDice[teIdx]  = newDie; }
          let newRollData = { ...payload, crewDice: newCrewDice, shipDice: newShipDice, techExpertiseUsed: true };
          let bonusShipDice = [];
          if (tePool !== "ship") {
            const synced = syncAssistStateAfterCrewReroll(newRollData);
            newRollData = synced.rollData;
            bonusShipDice = synced.newShipDice;
          }
          await dsnShowPool(
            [newDie, ...bonusShipDice],
            canvas.tokens?.get(payload.tokenId) ? ChatMessage.getSpeaker({ token: canvas.tokens.get(payload.tokenId) }) : null
          );
          btn.disabled = true; btn.style.opacity = "0.5"; btn.style.cursor = "default"; btn.textContent = "✓ Rerolled";
          await message.update({ content: buildPlayerRollCardHtml(newRollData) });
          return;
        }

        if (crewDice.length === 0) {
          ui.notifications.warn("No crew dice to reroll.");
          return;
        }

        // Build die picker — checkboxes for Determination or multi-reroll Aim; radio for single-die
        const dieOptions = crewDice.map((d, i) => {
          const pip = diePipHtml(d, i, "picker");  // renders d20 visual, no reroll hint (not a button)
          return `<label style="display:flex;gap:8px;align-items:center;padding:4px 6px;cursor:pointer;
            border:1px solid ${LC.borderDim};border-radius:2px;background:${LC.panel};">
            <input type="${useCheckbox ? "checkbox" : "radio"}" name="reroll-die" value="${i}"
              style="cursor:pointer;accent-color:${LC.secondary};flex-shrink:0;"/>
            ${pip}
          </label>`;
        }).join("");

        const selectHint = isDet
          ? "Select one or more dice to reroll:"
          : isAim && aimRemaining > 1
            ? `Select up to ${aimRemaining} dice to reroll:`
            : "Select one die to reroll:";

        const result = await foundry.applications.api.DialogV2.wait({
          window: { title: `${abilityLabel} — Select Die to Reroll` },
          content: `<div style="padding:6px 10px;font-family:${LC.font};">
            <p style="font-size:11px;color:${LC.textDim};margin-bottom:8px;">${selectHint}</p>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">${dieOptions}</div>
          </div>`,
          buttons: [
            {
              action: "confirm",
              label:  "Reroll",
              icon:   "fas fa-dice",
              default: true,
              callback: (_event, _btn, dlg) => {
                const inputs = dlg.element.querySelectorAll("input[name='reroll-die']:checked");
                return Array.from(inputs).map(inp => parseInt(inp.value));
              },
            },
            { action: "cancel", label: "Cancel", icon: "fas fa-times" },
          ],
          render: (_event, dlg) => {
            if (!(isAim && aimRemaining > 1)) return;
            const inputs = Array.from(dlg.element.querySelectorAll("input[name='reroll-die']"));
            const syncLimit = () => {
              const checkedCount = inputs.filter(inp => inp.checked).length;
              for (const inp of inputs) {
                inp.disabled = !inp.checked && checkedCount >= aimRemaining;
              }
            };
            inputs.forEach(inp => inp.addEventListener("change", syncLimit));
            syncLimit();
          },
        });

        if (!result || result === "cancel" || (Array.isArray(result) && result.length === 0)) return;

        const selectedIndices = Array.isArray(result) ? result : [result];
        const cappedIndices = isAim
          ? selectedIndices.slice(0, Math.max(1, aimRemaining))
          : selectedIndices;
        if (isAim && selectedIndices.length > cappedIndices.length) {
          ui.notifications.warn(`Aim allows rerolling up to ${aimRemaining} die${aimRemaining !== 1 ? "s" : ""}.`);
        }

        // Reroll each selected die index
        const newCrewDice  = [...crewDice];
        const rerolledDice = [];
        for (const idx of cappedIndices) {
          const [newDie] = rollPool(1, crewTarget, compThresh, critThresh);
          newCrewDice[idx] = newDie;
          rerolledDice.push(newDie);
        }

        // Show Dice So Nice animation for the rerolled dice
        if (rerolledDice.length > 0) {
          const tokenObj = canvas.tokens?.get(payload.tokenId) ?? null;
          const speaker  = tokenObj ? ChatMessage.getSpeaker({ token: tokenObj }) : null;
          await dsnShowPool(rerolledDice, speaker);
        }

        // Mark ability as used
        const usedFlagMap = {
          talent:        "talentRerollUsed",
          advisor:       "advisorRerollUsed",
          system:        "systemRerollUsed",
          shipTalent:    "shipTalentRerollUsed",
          detReroll:     "detRerollUsed",
          ts:            "tsRerollUsed",
          cs:            "csRerollUsed",
          genericReroll: "genericRerollUsed",
        };
        const usedFlag = usedFlagMap[ability] ?? null;

        // Aim increments a counter by however many dice were actually rerolled
        const selectedCount = cappedIndices.length;
        const aimOverride = ability === "aim"
          ? { aimRerollsUsed: (payload.aimRerollsUsed ?? 0) + selectedCount }
          : {};

        let newRollData = {
          ...payload,
          crewDice: newCrewDice,
          ...(usedFlag ? { [usedFlag]: true } : {}),
          ...aimOverride,
        };
        const synced = syncAssistStateAfterCrewReroll(newRollData);
        newRollData = synced.rollData;

        btn.disabled      = true;
        btn.style.opacity = "0.5";
        btn.style.cursor  = "default";
        btn.textContent   = "✓ Rerolled";

        if (synced.newShipDice.length > 0) {
          const tokenObj = canvas.tokens?.get(payload.tokenId) ?? null;
          const speaker  = tokenObj ? ChatMessage.getSpeaker({ token: tokenObj }) : null;
          await dsnShowPool(synced.newShipDice, speaker);
        }

        await message.update({ content: buildPlayerRollCardHtml(newRollData) });
      } catch(err) {
        console.error("STA2e Toolkit | player reroll error:", err);
        ui.notifications.error("Reroll failed — see console.");
      }
    });
  });

  // ── Player ship — Confirm Results (Working Results card) ──────────────────
  // Available to ALL users — any player can confirm (typically the acting officer).
  html.querySelectorAll(".sta2e-player-confirm").forEach(btn => {
    // Already confirmed on a previous render — lock the button immediately.
    if (message.getFlag("sta2e-toolkit", "confirmed")) {
      btn.disabled      = true;
      btn.style.opacity = "0.4";
      btn.style.cursor  = "default";
      btn.textContent   = "✓ Results Confirmed";
      btn.title         = "Results already confirmed";
      return;
    }
    btn.addEventListener("click", async () => {
      btn.disabled      = true;
      btn.style.opacity = "0.5";
      btn.style.cursor  = "default";
      // Persist the confirmed state on the message so that reroll buttons are
      // disabled if the card is re-rendered (e.g. after a page reload or scroll).
      try { await message.update({ "flags.sta2e-toolkit.confirmed": true }); } catch {}
      try {
        const payload = JSON.parse(decodeURIComponent(btn.dataset.payload ?? "{}"));
        const {
          callbackId, actorId, tokenId, stationId,
          taskLabel, crewDice, shipDice, crewAssistDice, apAssistDice, namedAssistDice,
          difficulty, weaponContext, rallyContext,
          hasRapidFireTorpedo, hasCalibrateWeapons,
          defenderSuccesses, opposedDefenseType,
          groundMode, groundIsNpc, noPoolButton,
        } = payload;

        const countSuc = dice => dice.reduce((s, d) => s + (d.success ? (d.crit ? 2 : 1) : 0), 0);
        const allDice  = [
          ...(crewDice       ?? []),
          ...(crewAssistDice ?? []),
          ...(namedAssistDice ?? []),
          ...(apAssistDice   ?? []),
          ...(shipDice       ?? []),
        ];
        const totalSuccesses = countSuc(allDice);
        const passed   = totalSuccesses >= (difficulty ?? 0);
        const momentum = Math.max(0, totalSuccesses - (difficulty ?? 0));

        // When this is a defense roll, trigger the opposed task resolution so the
        // attacker's roller opens automatically with the defender's success count
        // as the locked difficulty (minimum 0).
        // - GM as defender: game.socket.emit won't loop back to the GM's own
        //   handler, so we call game.sta2eToolkit.resolveDefenderRoll() directly.
        // - Player as defender: emit to the GM socket handler which calls the
        //   same resolution logic on their end.
        if (noPoolButton && taskLabel?.includes("Defense")) {
          const _successes = Math.max(0, totalSuccesses);
          if (game.user.isGM) {
            game.sta2eToolkit?.resolveDefenderRoll?.(_successes);
          } else {
            game.socket.emit("module.sta2e-toolkit", {
              action:    "defenderRollComplete",
              successes: _successes,
            });
          }
        }

        const shipActor = game.actors.get(actorId);
        const tokenObj  = canvas.tokens?.get(tokenId) ?? null;
        const tokenDoc  = tokenObj?.document ?? null;

        // Post final resolved summary card
        const passColor  = passed ? (LC.green ?? "#00cc66") : (LC.red ?? "#ff4444");
        // Determine whether this roll generates Momentum (PC) or Threat (NPC)
        const isNpcRoll  = groundMode ? groundIsNpc : CombatHUD.isNpcShip(shipActor);
        const poolLabel  = isNpcRoll ? "Threat" : "Momentum";
        const poolColor  = momentum > 0 ? (LC.secondary ?? "#cc88ff") : (LC.textDim ?? "#888");
        const totalComplications = allDice.filter(d => d.complication).length;
        const poolBtn = (momentum > 0 && !noPoolButton)
          ? poolButtonHtml(isNpcRoll ? "threat" : "momentum", momentum, tokenId ?? "")
          : "";
        const statCell = (lbl, val, col, fontSize = "16px") => `
          <div style="text-align:center;">
            <div style="font-size:8px;color:${LC.textDim ?? "#888"};text-transform:uppercase;letter-spacing:0.08em;">${lbl}</div>
            <div style="font-size:${fontSize};font-weight:700;color:${col};">${val}</div>
          </div>`;
        const mainCols = totalComplications > 0 ? "1fr 1fr 1fr 1fr" : "1fr 1fr 1fr";
        const isDefenseRoll = !!(noPoolButton && taskLabel?.includes("Defense"));
        const confirmBody = `
          <div style="display:flex;flex-direction:column;gap:6px;">
            <div style="display:grid;grid-template-columns:${mainCols};gap:4px;">
              ${statCell("Successes", totalSuccesses, LC.tertiary ?? "#ffcc66")}
              ${totalComplications > 0 ? statCell("Complications", totalComplications, LC.red ?? "#ff4444") : ""}
              ${statCell("Difficulty", difficulty ?? 0, LC.text ?? "#ffffff")}
              ${statCell("Result", passed ? "PASS" : "FAIL", passColor, "11px")}
            </div>
            ${isDefenseRoll ? `
            <div style="padding:5px 8px;background:rgba(255,153,0,0.08);
              border-left:3px solid ${LC.primary ?? "#ff9900"};border-radius:2px;
              display:flex;align-items:center;gap:8px;">
              <span style="font-size:9px;color:${LC.textDim ?? "#888"};font-family:${LC.font};
                text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;">Attack Difficulty</span>
              <span style="font-size:20px;font-weight:700;color:${LC.primary ?? "#ff9900"};
                font-family:${LC.font};">${totalSuccesses}</span>
              <span style="font-size:9px;color:${LC.textDim ?? "#888"};font-family:${LC.font};
                line-height:1.4;">Attacker needs<br>≥${totalSuccesses} successes to hit</span>
            </div>` : ""}
            ${momentum > 0 && !noPoolButton ? `
            <div style="text-align:center;padding:2px 0;">
              <span style="font-size:14px;font-weight:700;color:${LC.textDim ?? "#888"};text-transform:uppercase;letter-spacing:0.08em;">${poolLabel} Gained </span>
              <span style="font-size:14px;font-weight:700;color:${poolColor};">${momentum}</span>
            </div>` : ""}
          </div>${poolBtn}`;
        const resolvedContent = lcarsCard(
          weaponContext
            ? `${passed ? "âš¡ HIT" : "âœ— MISS"} â€” ${(taskLabel || "Attack").toUpperCase()}`
            : `âœ“ RESOLVED â€” ${(taskLabel || "Task").toUpperCase()}`,
          passColor,
          confirmBody
        );
        const confirmedRollData = {
          ...payload,
          confirmed: true,
          confirmedSuccesses: totalSuccesses,
          confirmedMomentum: momentum,
          confirmedPassed: passed,
        };
        await message.update({
          content: buildPlayerRollCardHtml(confirmedRollData),
          "flags.sta2e-toolkit.confirmed": true,
          "flags.sta2e-toolkit.rollData": confirmedRollData,
        });
        if (false) await ChatMessage.create({
          content: lcarsCard(
            weaponContext
              ? `${passed ? "⚡ HIT" : "✗ MISS"} — ${(taskLabel || "Attack").toUpperCase()}`
              : `✓ RESOLVED — ${(taskLabel || "Task").toUpperCase()}`,
            passColor,
            confirmBody
          ),
          speaker: ChatMessage.getSpeaker({ token: tokenObj }),
        });

        // Clear assist flag on token (GM only — avoids permission errors for players)
        if (game.user.isGM && tokenDoc) {
          if (groundMode) {
            // Ground assist is stored under the "ground" key, not stationId
            const pending = tokenDoc.getFlag("sta2e-toolkit", "assistPending") ?? {};
            if ("ground" in pending) {
              tokenDoc.update({ [`flags.sta2e-toolkit.assistPending.-=ground`]: null }).catch(err =>
                console.warn("STA2e Toolkit | clearGroundAssistFlag error:", err)
              );
            }
          } else if (stationId) {
            clearStationAssistFlag(tokenDoc, stationId).catch(err =>
              console.warn("STA2e Toolkit | clearStationAssistFlag error:", err)
            );
          }
        }

        // Weapon attack resolution
        if (weaponContext && groundMode) {
          // ── Ground character weapon ────────────────────────────────────────
          const charActor = tokenObj?.actor ?? game.actors.get(actorId);
          const weapon    = charActor?.items.find(i => i.type === "characterweapon2e" && i.name === weaponContext.name);
          if (weapon && charActor) {
            const targets = Array.from(game.user.targets);
            if (targets.length === 0) {
              ui.notifications.warn("No targets selected — select a target token to resolve damage.");
            } else {
              const config    = getWeaponConfig(weapon);
              const hasStun   = weapon.system?.qualities?.stun   ?? false;
              const hasDeadly = weapon.system?.qualities?.deadly ?? false;
              const severity  = weapon.system?.severity ?? 0;

              // Stun/Deadly was declared before the roll — read from weaponContext
              const isDual            = hasStun && hasDeadly;
              const useStun           = weaponContext.useStun ?? (hasStun && !hasDeadly);
              const deadlyCostsThreat = weaponContext.deadlyCostsThreat ?? false;

              const targetData = targets.map(t => {
                const tActor     = t.actor;
                // Prone + In Cover during a ranged cover attack → +1 Protection (STA 2e prone rules)
                const isProneCovered = opposedDefenseType === "cover"
                  && (tActor?.statuses?.has("prone") ?? false)
                  && !!(t.document?.getFlag(MODULE, "coverActive"));
                const baseProtection = CombatHUD._getTargetProtection(tActor);
                const protection     = baseProtection + (isProneCovered ? 1 : 0);
                const hasBraklul = CombatHUD._hasBraklul(tActor);
                const rawPotency = severity - protection;
                const potency    = severity > 0 ? Math.max(1, rawPotency) : 0;
                const profile = CombatHUD.getGroundCombatProfile(tActor, t.document);
                return {
                  tokenId:       t.id,
                  actorId:       tActor?.id,
                  name:          t.name,
                  npcType:       profile.npcType,
                  isPlayerOwned: profile.isPlayerOwned,
                  currentStress: tActor?.system?.stress?.value ?? 0,
                  maxStress:     tActor?.system?.stress?.max   ?? 0,
                  isProneCovered,
                  useStun, isDual, severity, protection, hasBraklul, potency,
                  weaponName: weapon.name,
                  weaponImg:  weapon.img,
                  weaponColor: config?.color ?? "blue",
                  weaponType:  config?.type  ?? "ground-beam",
                  damage:      weapon.system?.damage ?? 0,
                  qualities:   weapon.system?.qualities ?? {},
                };
              });

              const groundOpposedInfo = (opposedDefenseType && !passed) ? {
                attackerSuccesses: totalSuccesses,
                defenderSuccesses,
                opposedDefenseType,
                attackerTokenId:  tokenId,
                defenderTokenId:  targets[0]?.id ?? null,
                defenderActorId:  targets[0]?.actor?.id ?? null,
                defenderIsNpc:    CombatHUD.isGroundNpcActor(targets[0]?.actor),
              } : null;

              await ChatMessage.create({
                flags: { "sta2e-toolkit": { groundDamageCard: true } },
                content: CombatHUD._groundChatCard(charActor.name, weapon, targetData, passed, useStun, deadlyCostsThreat, groundOpposedInfo),
                speaker: ChatMessage.getSpeaker({ token: tokenObj }),
              });

              setTimeout(async () => {
                try { await fireWeapon(config, passed, tokenObj, targets); }
                catch(e) { console.warn("STA2e Toolkit | Ground weapon animation failed:", e); }
              }, 300);
            }
          } else {
            ui.notifications.warn(`Weapon "${weaponContext.name}" not found on character.`);
          }
        } else if (weaponContext && (shipActor || weaponContext.shipActorId)) {
          // ── Starship weapon ────────────────────────────────────────────────
          // Sheet-roller path: weaponContext carries shipActorId + weaponId; actorId is the character.
          // HUD-roller path: actorId IS the ship actor; no weaponContext.shipActorId.
          const _weaponActorId = weaponContext.shipActorId ?? actorId;
          const _weaponActor   = game.actors.get(_weaponActorId);
          const weapon = weaponContext.weaponId
            ? _weaponActor?.items.get(weaponContext.weaponId)
            : _weaponActor?.items.find(i => i.type === "starshipweapon2e" && i.name === weaponContext.name);
          if (weapon) {
            const calibrateWeaponsBonus = hasCalibrateWeapons ? 1 : 0;
            // Use ship token — sheet path resolves by shipActorId; HUD path tokenObj is already ship token
            const _weaponTokenObj = weaponContext.shipActorId
              ? canvas.tokens?.placeables.find(t => t.actor?.id === weaponContext.shipActorId) ?? tokenObj
              : tokenObj;
            await CombatHUD.resolveShipAttack(_weaponTokenObj, weapon, passed, {
              salvoMode:            weaponContext.salvoMode ?? "area",
              rapidFireBonus:       hasRapidFireTorpedo && weaponContext.isTorpedo ? 1 : 0,
              calibrateWeaponsBonus,
              defenderSuccesses:    defenderSuccesses ?? null,
              opposedDefenseType:   opposedDefenseType ?? null,
              attackerSuccesses:    opposedDefenseType !== null ? totalSuccesses : null,
            });
            // Clear calibrate weapons flag (GM only)
            if (calibrateWeaponsBonus && game.user.isGM) {
              const _flagDoc = weaponContext.shipActorId
                ? canvas.tokens?.placeables.find(t => t.actor?.id === weaponContext.shipActorId)?.document
                : tokenDoc;
              _flagDoc?.unsetFlag("sta2e-toolkit", "calibrateWeapons").catch(err =>
                console.warn("STA2e Toolkit | clearCalibrateWeapons error:", err)
              );
            }
          } else {
            ui.notifications.warn(`Weapon "${weaponContext.name}" not found on ship.`);
          }
        }

        // Rally context: post Momentum result card (player ships always use Momentum)
        if (rallyContext) {
          await ChatMessage.create({
            content: `
              <div style="border:2px solid ${LC.primary ?? "#ff9900"};border-radius:3px;
                background:rgba(255,153,0,0.06);padding:8px 10px;
                font-family:${LC.font ?? "var(--font-primary)"};">
                <div style="font-size:9px;font-weight:700;color:${LC.primary ?? "#ff9900"};
                  letter-spacing:0.1em;text-transform:uppercase;margin-bottom:5px;">
                  💫 RALLY — MOMENTUM GENERATED
                </div>
                <div style="font-size:12px;font-weight:700;color:${LC.tertiary ?? "#ffcc66"};
                  margin-bottom:6px;">${shipActor?.name ?? ""}</div>
                <div style="font-size:32px;font-weight:700;color:${LC.primary ?? "#ff9900"};
                  text-align:center;padding:4px 0;font-family:${LC.font ?? "var(--font-primary)"};">
                  +${totalSuccesses}
                </div>
                <div style="font-size:11px;color:${LC.textDim ?? "#888"};text-align:center;">
                  Momentum · Presence + Command · Difficulty 0
                </div>
              </div>`,
            speaker: ChatMessage.getSpeaker({ token: tokenObj }),
          });
        }

        // Fire taskCallback (if this roll had one registered)
        const cbEntry = PlayerRollCallbacks.get(callbackId);
        if (cbEntry) {
          PlayerRollCallbacks.delete(callbackId);
          (async () => {
            try {
              await cbEntry.taskCallback({
                successes: totalSuccesses,
                passed,
                momentum,
                complications: totalComplications,
                state:  null,   // no live state object in the chat-card path
                actor:  cbEntry.actor,
                token:  cbEntry.token,
              });
            } catch(err) {
              console.error("STA2e Toolkit | playerConfirm taskCallback error:", err);
              ui.notifications.error("STA2e Toolkit: Task result error — see console.");
            }
          })();
        }
      } catch(err) {
        console.error("STA2e Toolkit | player confirm error:", err);
        ui.notifications.error("Confirm failed — see console.");
        btn.disabled      = false;
        btn.style.opacity = "";
        btn.style.cursor  = "";
      }
    });
  });

  // ── Assist Roll — Add to Task Roll ───────────────────────────────────────
  // Player B posted an assist card and clicks "Add to Task Roll →" to inject
  // their best crew die into another player's active Working Results card.
  html.querySelectorAll(".sta2e-assist-to-roll").forEach(btn => {
    // Already applied on a previous render — lock immediately
    const alreadyApplied = message.getFlag("sta2e-toolkit", "assistApplied");
    if (alreadyApplied) {
      btn.disabled      = true;
      btn.style.opacity = "0.5";
      btn.style.cursor  = "default";
      return;
    }

    btn.addEventListener("click", async () => {
      btn.disabled      = true;
      btn.style.opacity = "0.5";
      btn.style.cursor  = "default";
      try {
        const assistPayload = JSON.parse(decodeURIComponent(btn.dataset.payload ?? "{}"));

        // ── 1. Collect candidate task cards (last 30 messages) ────────────
        const candidates = [...game.messages.values()].slice(-30).filter(m =>
          m.id !== message.id &&
          m.getFlag("sta2e-toolkit", "playerRollCard") &&
          !m.getFlag("sta2e-toolkit", "confirmed")
        );
        if (candidates.length === 0) {
          ui.notifications.warn("No active (unconfirmed) task roll cards found in recent chat.");
          btn.disabled = false; btn.style.opacity = ""; btn.style.cursor = "";
          return;
        }

        // ── 2. Pick the target task card ──────────────────────────────────
        let targetMessage;
        if (candidates.length === 1) {
          targetMessage = candidates[0];
        } else {
          const optionsHtml = candidates.map(m => {
            const rd  = m.getFlag("sta2e-toolkit", "rollData") ?? {};
            const lbl = rd.taskLabel || m.speaker?.alias || "Task Roll";
            const who = rd.officerName ? ` — ${rd.officerName}` : "";
            const s   = (rd.crewDice ?? []).reduce((n, d) => n + (d.crit ? 2 : d.success ? 1 : 0), 0);
            return `<option value="${m.id}">${lbl}${who} (${s} succ.)</option>`;
          }).join("");
          const picked = await foundry.applications.api.DialogV2.wait({
            window: { title: "Add Assist — Choose Task Roll" },
            content: `<div style="padding:8px 10px;display:flex;flex-direction:column;gap:8px;">
              <div style="font-size:10px;color:#aaa;">Select which task roll to add
                <strong>${assistPayload.assistOfficerName ?? "this assist"}</strong> to.</div>
              <select id="target-msg-id" style="width:100%;padding:4px 6px;">${optionsHtml}</select>
            </div>`,
            buttons: [
              { action: "pick", label: "Add Assist", icon: "fas fa-plus", default: true,
                callback: (_e, _b, dlg) => dlg.element.querySelector("#target-msg-id")?.value ?? null },
              { action: "cancel", label: "Cancel", icon: "fas fa-times" },
            ],
          });
          if (!picked || picked === "cancel") {
            btn.disabled = false; btn.style.opacity = ""; btn.style.cursor = "";
            return;
          }
          targetMessage = game.messages.get(picked);
          if (!targetMessage) {
            ui.notifications.error("Selected task card no longer exists.");
            btn.disabled = false; btn.style.opacity = ""; btn.style.cursor = "";
            return;
          }
        }

        // ── 3. Build namedAssistDice entry — best crew die ────────────────
        const assistDice = assistPayload.crewDice ?? [];
        if (!assistDice.length) {
          ui.notifications.warn("Assist card has no dice to inject.");
          btn.disabled = false; btn.style.opacity = ""; btn.style.cursor = "";
          return;
        }
        const bestDie = assistDice.reduce((b, d) => {
          if (!b) return d;
          const ds = d.crit ? 2 : d.success ? 1 : 0;
          const bs = b.crit ? 2 : b.success ? 1 : 0;
          return ds > bs || (ds === bs && d.value < b.value) ? d : b;
        }, null);
        // ── 4. Decode target rollData and update the task card ─────────────
        const targetRd = targetMessage.getFlag("sta2e-toolkit", "rollData") ?? (() => {
          try {
            return JSON.parse(decodeURIComponent(
              targetMessage.content?.match(/data-payload="([^"]+)"/)?.[1] ?? "{}"));
          } catch { return null; }
        })();
        if (!targetRd) {
          ui.notifications.error("Could not read target task card data.");
          btn.disabled = false; btn.style.opacity = ""; btn.style.cursor = "";
          return;
        }

        // Re-evaluate complication against the TARGET task's complication range, not the
        // assist roll's range — the two rolls may have different breach/strain states.
        const targetCompThresh = 21 - (targetRd.complicationRange ?? 1);
        const newEntry = { ...bestDie,
          complication: bestDie.value >= targetCompThresh,
          officerName: assistPayload.assistOfficerName ?? assistPayload.officerName ?? "Assist",
          actorId: assistPayload.actorId ?? null,
          attrKey: assistPayload.officerAttrKey ?? null,
          discKey: assistPayload.officerDiscKey ?? null,
          shipSystemKey: assistPayload.shipSystemKey ?? null,
          shipDeptKey: assistPayload.shipDeptKey ?? null,
          shipName: assistPayload.shipName ?? null,
        };
        // Check if the assisting actor has the Advisor talent and was rolling Command.
        // "Whenever you Assist using Command, the assisted character may re-roll one d20."
        // Only grant the reroll if the task card doesn't already have one from this source.
        let advisorGrant = {};
        if (!targetRd.hasAdvisorReroll) {
          const assistActorId = assistPayload.actorId ?? null;
          const assistDiscKey = assistPayload.officerDiscKey ?? null;
          if (assistActorId && assistDiscKey === "command") {
            const assistActor = game.actors.get(assistActorId);
            if (assistActor?.items.some(i => i.name.toLowerCase() === "advisor")) {
              const assistName = assistPayload.assistOfficerName ?? assistPayload.officerName ?? "Assist";
              advisorGrant = {
                hasAdvisorReroll:    true,
                advisorRerollSource: `Advisor (${assistName})`,
                advisorRerollUsed:   false,
              };
            }
          }
        }

        const newTargetRd = { ...targetRd, ...advisorGrant,
          namedAssistDice: [...(targetRd.namedAssistDice ?? []), newEntry] };
        const newTargetContent = buildPlayerRollCardHtml(newTargetRd);

        const canDirect = game.user.isGM || targetMessage.author?.id === game.user.id;
        if (canDirect) {
          await targetMessage.update({ content: newTargetContent,
            "flags.sta2e-toolkit.rollData": newTargetRd });
        } else {
          game.socket.emit("module.sta2e-toolkit", {
            action: "applyAssistToTaskCard",
            messageId: targetMessage.id,
            newContent: newTargetContent,
            newRollData: newTargetRd,
          });
        }

        // ── 5. Mark assist card as applied ────────────────────────────────
        const appliedLabel  = targetRd.taskLabel || "Task Roll";
        const newAssistRd   = { ...assistPayload, assistApplied: appliedLabel };
        const newAssistContent = buildPlayerRollCardHtml(newAssistRd);
        const canAssist = game.user.isGM || message.author?.id === game.user.id;
        if (canAssist) {
          await message.update({ content: newAssistContent,
            "flags.sta2e-toolkit.assistApplied": appliedLabel,
            "flags.sta2e-toolkit.rollData": newAssistRd });
        } else {
          game.socket.emit("module.sta2e-toolkit", {
            action: "applyAssistToTaskCard",
            messageId: message.id,
            newContent: newAssistContent,
            newRollData: newAssistRd,
            newFlag: { key: "assistApplied", value: appliedLabel },
          });
        }
      } catch(err) {
        console.error("STA2e Toolkit | assist-to-roll error:", err);
        ui.notifications.error("Failed to apply assist roll — see console.");
        btn.disabled = false; btn.style.opacity = ""; btn.style.cursor = "";
      }
    });
  });

  // ── Add Momentum / Threat to pool ────────────────────────────────────────
  // Visible to all users; permission enforced by game.settings.set.
  html.querySelectorAll(".sta2e-add-to-pool").forEach(btn => {
    // Already added on a previous render — lock the button immediately.
    if (message.getFlag("sta2e-toolkit", "poolAdded")) {
      btn.disabled      = true;
      btn.style.opacity = "0.4";
      btn.style.cursor  = "default";
      btn.textContent   = btn.dataset.pool === "momentum" ? "✓ Momentum Added" : "✓ Threat Added";
      btn.title         = "Already added to pool";
      return;
    }
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      btn.disabled      = true;
      btn.style.opacity = "0.5";
      btn.style.cursor  = "default";
      try {
        const pool    = btn.dataset.pool;
        const amount  = parseInt(btn.dataset.amount) || 0;
        const tokenId = btn.dataset.tokenId ?? null;
        const token   = tokenId ? canvas.tokens?.get(tokenId) : null;
        await CombatHUD._applyToPool(pool, amount, token);
        btn.textContent = pool === "momentum" ? "✓ Momentum Added" : "✓ Threat Added";
        // Persist so the button stays locked if the chat log is scrolled or reloaded.
        try { await message.update({ "flags.sta2e-toolkit.poolAdded": true }); } catch {}
      } catch(e) {
        console.error("STA2e Toolkit | add-to-pool error:", e);
        btn.disabled      = false;
        btn.style.opacity = "";
        btn.style.cursor  = "";
      }
    });
  });

  // ── Ground melee defense roll prompt ─────────────────────────────────────
  // Visible to all users — the defender (or their player) clicks to open the roller.
  html.querySelectorAll(".sta2e-melee-defense-roll").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tokenId = btn.dataset.tokenId;
      const token   = canvas.tokens?.get(tokenId);
      if (!token?.actor) {
        ui.notifications.warn("STA2e Toolkit | Melee defender token not found on scene.");
        return;
      }
      openPlayerRoller(token.actor, token, {
        officer:      readOfficerStats(token.actor),
        groundMode:   true,
        groundIsNpc:  CombatHUD.isGroundNpcActor(token.actor),
        difficulty:   0,
        defaultAttr:  "daring",
        defaultDisc:  "security",
        noPoolButton: true,
        taskLabel:    "Melee Defense",
        taskContext:  `Daring + Security · successes set the attacker's Difficulty`,
      });
    });
  });

  // ── Ground cover defense roll prompt ─────────────────────────────────────
  // Visible to all users — the defender (or their player) clicks to open the roller.
  html.querySelectorAll(".sta2e-cover-defense-roll").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tokenId = btn.dataset.tokenId;
      const token   = canvas.tokens?.get(tokenId);
      if (!token?.actor) {
        ui.notifications.warn("STA2e Toolkit | Cover defender token not found on scene.");
        return;
      }
      openPlayerRoller(token.actor, token, {
        officer:      readOfficerStats(token.actor),
        groundMode:   true,
        groundIsNpc:  CombatHUD.isGroundNpcActor(token.actor),
        difficulty:   0,
        defaultAttr:  "control",
        defaultDisc:  "security",
        noPoolButton: true,
        taskLabel:    "Cover Defense",
        taskContext:  `Control + Security · successes set the attacker's Difficulty`,
      });
    });
  });

  // ── Ship defense roll prompt (Evasive Action / Defensive Fire / Cover) ──────
  // Visible to all users — posted by _checkOpposedTask before the "enter successes" dialog.
  // Routes to openNpcRoller for NPC ships, openPlayerRoller for player ships.
  html.querySelectorAll(".sta2e-ship-defense-roll").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tokenId = btn.dataset.tokenId;
      const token   = canvas.tokens?.get(tokenId);
      if (!token?.actor) {
        ui.notifications.warn("STA2e Toolkit | Ship defense roll: token not found on scene.");
        return;
      }
      const actor     = token.actor;
      const isNpcDef  = CombatHUD.isNpcShip(actor);
      const stationId = btn.dataset.stationId;
      const officers  = stationId ? getStationOfficers(actor, stationId) : [];
      const officer   = officers.length ? readOfficerStats(officers[0]) : null;

      const rollerOpts = {
        officer,
        difficulty:   0,
        defaultAttr:  btn.dataset.defaultAttr ?? "daring",
        defaultDisc:  btn.dataset.defaultDisc ?? "conn",
        noPoolButton: true,
        taskLabel:    btn.dataset.taskLabel ?? "Ship Defense",
        taskContext:  `${btn.dataset.taskLabel ?? "Ship Defense"} · successes set the attacker's Difficulty`,
        stationId:    stationId ?? null,
        // NPC ships use crew quality when no officer is assigned
        crewQuality:  isNpcDef && !officer ? CombatHUD.getCrewQuality(actor) : null,
      };

      if (isNpcDef) {
        openNpcRoller(actor, token, rollerOpts);
      } else {
        openPlayerRoller(actor, token, rollerOpts);
      }
    });
  });

  // ── Ground combat counterattack — visible to all users ───────────────────
  html.querySelectorAll(".sta2e-ground-counterattack").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        const payload = JSON.parse(decodeURIComponent(btn.dataset.payload ?? "{}"));
        const { attackerTokenId, defenderTokenId, defenderActorId, defenderIsNpc } = payload;

        const defenderToken = canvas.tokens?.get(defenderTokenId);
        const defenderActor = defenderToken?.actor ?? game.actors?.get(defenderActorId);
        const attackerToken = canvas.tokens?.get(attackerTokenId);

        if (!defenderActor) {
          ui.notifications.warn("STA2e Toolkit | Counterattack: defender not found on scene.");
          return;
        }

        const weapons = defenderActor.items.filter(i => i.type === "characterweapon2e");
        if (!weapons.length) {
          ui.notifications.warn("STA2e Toolkit | Counterattack: defender has no weapons.");
          return;
        }

        // Pick weapon if multiple
        let chosenWeapon;
        if (weapons.length === 1) {
          chosenWeapon = weapons[0];
        } else {
          const hud = game.sta2eToolkit?.combatHud;
          const weaponBtns = weapons.map((w, i) => {
            const dmg = w.system?.damage ?? "?";
            const sev = w.system?.severity ?? 0;
            const qlts = hud ? hud._weaponQualityString(w) : "";
            return `
              <button class="sta2e-ctr-weapon" data-index="${i}"
                title="${w.name}&#10;Damage: ${dmg} · Severity: ${sev}${qlts ? "&#10;Qualities: " + qlts : ""}"
                style="width:44px;height:44px;
                  background:${LC.panel} url('${w.img}') center/contain no-repeat;
                  border:1px solid ${LC.border};border-radius:2px;
                  cursor:pointer;transition:border-color 0.15s,box-shadow 0.15s;">
              </button>`;
          }).join("");

          chosenWeapon = await new Promise(resolve => {
            const picker = new foundry.applications.api.DialogV2({
              window: { title: `${defenderActor.name} — Select Counterattack Weapon` },
              content: `
                <div style="font-family:${LC.font};padding:4px 0;">
                  <div style="font-size:10px;color:${LC.textDim};margin-bottom:10px;line-height:1.5;">
                    <strong style="color:${LC.red};">⚡ Counterattack</strong>
                    — automatic attack against
                    <strong>${attackerToken?.name ?? "attacker"}</strong>
                    (costs ${defenderIsNpc ? "2 Threat" : "2 Momentum"}).<br>
                    Select a weapon:
                  </div>
                  <div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0;">
                    ${weaponBtns}
                  </div>
                </div>`,
              buttons: [{ action: "cancel", label: "Cancel", icon: "fas fa-times", default: true }],
            });
            picker.render(true).then(() => {
              setTimeout(() => {
                const el = picker.element ?? document.querySelector(".app.dialog-v2");
                if (!el) { resolve(null); return; }
                el.querySelectorAll(".sta2e-ctr-weapon").forEach(wb => {
                  wb.addEventListener("mouseenter", () => {
                    wb.style.borderColor = LC.primary;
                    wb.style.boxShadow   = `0 0 6px ${LC.primary}`;
                  });
                  wb.addEventListener("mouseleave", () => {
                    wb.style.borderColor = LC.border;
                    wb.style.boxShadow   = "";
                  });
                  wb.addEventListener("click", () => {
                    const idx = parseInt(wb.dataset.index);
                    try { picker.close(); } catch {}
                    resolve(weapons[idx] ?? null);
                  });
                });
                Hooks.once("closeDialogV2", () => resolve(null));
              }, 60);
            });
          });
        }

        if (!chosenWeapon) return;

        // Spend 2 Momentum (player) or 2 Threat (NPC) for the counterattack
        const caGndPool    = defenderIsNpc ? "threat" : "momentum";
        const caGndTracker = game.STATracker?.constructor;
        if (caGndTracker) {
          const caGndCurrent = caGndTracker.ValueOf(caGndPool);
          if (caGndCurrent < 2) {
            ui.notifications.warn(`STA2e Toolkit: Not enough ${defenderIsNpc ? "Threat" : "Momentum"} to counterattack (need 2, have ${caGndCurrent}).`);
            return;
          }
          await caGndTracker.DoUpdateResource(caGndPool, caGndCurrent - 2);
        }

        btn.disabled      = true;
        btn.style.opacity = "0.5";
        btn.textContent   = "✓ Counterattack Initiated";

        // Target the attacker
        if (attackerToken) {
          attackerToken.setTarget(true, { user: game.user, releaseOthers: true, groupSelection: false });
        }

        // Auto-hit: build damage context and post ground damage card directly
        const attackerActor = attackerToken?.actor;
        if (!attackerActor) {
          ui.notifications.warn("STA2e Toolkit | Counterattack: attacker actor not found.");
          return;
        }
        const config    = getWeaponConfig(chosenWeapon);
        const hasStun   = chosenWeapon.system?.qualities?.stun   ?? false;
        const hasDeadly = chosenWeapon.system?.qualities?.deadly ?? false;
        const severity  = chosenWeapon.system?.severity ?? 0;
        const useStun   = hasStun && !hasDeadly;

        const profile    = CombatHUD.getGroundCombatProfile(attackerActor, attackerToken?.document);
        const protection = CombatHUD._getTargetProtection(attackerActor);
        const rawPotency = severity - protection;
        const potency    = severity > 0 ? Math.max(1, rawPotency) : 0;
        const hasBraklul = CombatHUD._hasBraklul(attackerActor);

        const targetData = [{
          tokenId:       attackerToken.id,
          actorId:       attackerActor.id,
          name:          attackerToken.name,
          npcType:       profile.npcType,
          isPlayerOwned: profile.isPlayerOwned,
          currentStress: attackerActor.system?.stress?.value ?? 0,
          maxStress:     attackerActor.system?.stress?.max   ?? 0,
          isProneCovered: false,
          useStun, isDual: hasStun && hasDeadly, severity, protection, hasBraklul, potency,
          weaponName:  chosenWeapon.name,
          weaponImg:   chosenWeapon.img,
          weaponColor: config?.color ?? "blue",
          weaponType:  config?.type  ?? "melee",
          damage:      chosenWeapon.system?.damage ?? 0,
          qualities:   chosenWeapon.system?.qualities ?? {},
        }];

        await ChatMessage.create({
          flags: { "sta2e-toolkit": { groundDamageCard: true } },
          content: CombatHUD._groundChatCard(
            defenderActor.name, chosenWeapon, targetData,
            true, useStun, false, null
          ),
          speaker: ChatMessage.getSpeaker({ token: defenderToken ?? null }),
        });

        setTimeout(async () => {
          try { await fireWeapon(config, true, defenderToken, [attackerToken]); }
          catch(e) { console.warn("STA2e Toolkit | Ground counterattack animation failed:", e); }
        }, 300);
      } catch(err) {
        console.error("STA2e Toolkit | Ground counterattack error:", err);
        ui.notifications.error("Failed to initiate counterattack — see console.");
      }
    });
  });

  if (!game.user.isGM) return;

  // ── Ship combat — Apply Damage buttons (GM only) ─────────────────────────
  if (message.flags?.["sta2e-toolkit"]?.damageCard) {
    html.querySelectorAll(".sta2e-extra-damage").forEach(input => {
      const controls     = input.closest(".sta2e-damage-controls");
      const btn          = controls?.querySelector(".sta2e-apply-damage");
      const finalDisplay = controls?.querySelector(".sta2e-final-display strong");
      const basePayload  = JSON.parse(decodeURIComponent(input.dataset.basePayload));
      const baseFinal    = basePayload.finalDamage;

      const update = () => {
        const extra    = parseInt(input.value) || 0;
        const newTotal = Math.max(0, baseFinal + extra);
        if (finalDisplay) finalDisplay.textContent = newTotal;
        if (btn) btn.dataset.payload = encodeURIComponent(JSON.stringify({ ...basePayload, finalDamage: newTotal }));
      };

      input.addEventListener("input",  update);
      input.addEventListener("change", update);
      input.addEventListener("mousedown", e => e.stopPropagation());
    });

    html.querySelectorAll(".sta2e-apply-damage").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const payload  = JSON.parse(decodeURIComponent(btn.dataset.payload));
          btn.disabled      = true;
          btn.textContent   = "✓ Applied";
          btn.style.opacity = "0.5";
          const controls = btn.closest(".sta2e-damage-controls");
          const input    = controls?.querySelector(".sta2e-extra-damage");
          if (input) input.disabled = true;

          await CombatHUD.applyDamage(payload);
        } catch(err) {
          console.error("STA2e Toolkit | applyDamage error:", err);
          ui.notifications.error("Failed to apply damage — see console for details.");
        }
      });
    });

    // ── Ram — Apply Damage to Both Ships ───────────────────────────────────
    if (message.flags?.["sta2e-toolkit"]?.ramResultCard) {
      html.querySelectorAll(".sta2e-apply-ram-both").forEach(btn => {
        const container = btn.closest(".sta2e-ram-combined-controls");
        const adjInput  = container?.querySelector(".sta2e-ram-adj");
        adjInput?.addEventListener("mousedown", e => e.stopPropagation());

        btn.addEventListener("click", async () => {
          try {
            const adj     = parseInt(adjInput?.value ?? "0") || 0;
            const tgtBase = JSON.parse(decodeURIComponent(btn.dataset.tgtPayload));
            const atkBase = JSON.parse(decodeURIComponent(btn.dataset.atkPayload));
            if (adj !== 0) {
              tgtBase.finalDamage = Math.max(0, tgtBase.finalDamage + adj);
              atkBase.finalDamage = Math.max(0, atkBase.finalDamage + adj);
            }
            btn.disabled      = true;
            btn.textContent   = "✓ Applied";
            btn.style.opacity = "0.5";
            if (adjInput) adjInput.disabled = true;

            await CombatHUD.applyDamage(tgtBase);
            await CombatHUD.applyDamage(atkBase);
          } catch(err) {
            console.error("STA2e Toolkit | applyRamBoth error:", err);
            ui.notifications.error("Failed to apply ram damage — see console for details.");
          }
        });
      });
    }
  }

  // ── Shaken D20 roll button (PC ships — Minor Damage table) ──────────────
  if (message.flags?.["sta2e-toolkit"]?.damageResult) {
    html.querySelectorAll(".sta2e-shaken-roll").forEach(btn => {
      btn.addEventListener("click", async () => {
        const tok   = canvas.tokens?.get(btn.dataset.tokenid);
        const actor = tok?.actor ?? game.actors.get(btn.dataset.actorid);

        // Roll D20
        const roll   = new Roll("1d20");
        await roll.evaluate();
        let rolled = roll.total;

        // Find result from range table
        let result = CombatHUD.SHAKEN_RESULTS.find(r => rolled >= r.range[0] && rolled <= r.range[1]);
        let rerolled = false;
        let firstRoll = rolled;

        // Handle "Roll Again" — re-roll once, cap on double
        if (result?.id === "roll_again") {
          const roll2 = new Roll("1d20");
          await roll2.evaluate();
          rolled   = roll2.total;
          rerolled = true;
          result   = CombatHUD.SHAKEN_RESULTS.find(r => rolled >= r.range[0] && rolled <= r.range[1]);
          if (result?.id === "roll_again") {
            result = CombatHUD.SHAKEN_RESULTS.find(r => r.id === "casualties");
          }
        }

        if (!result) return;

        btn.disabled      = true;
        btn.textContent   = `🎲 Rolled ${rerolled ? firstRoll + "→" + rolled : rolled} — ${result.label}`;
        btn.style.opacity = "0.6";

        // Apply mechanical effects
        if (actor) {
          if (result.id === "lose_power") {
            if (CombatHUD.hasReservePower(actor)) await CombatHUD.clearReservePower(actor);
            await CombatHUD.incrementRegainPowerUses(actor);
          }
          // Brace for Impact stays shaken — it limits the next major action,
          // so the GM clears it manually via the HUD shaken toggle.
          // All other results resolve the shaken condition immediately.
          if (result.id !== "brace") {
            await actor.update({ "system.shaken": false });
          }
        }

        await roll.toMessage({ flavor: `⚠️ Minor Damage D20` });

        // Casualties — roll random department for crew casualty complication
        let casualtiesDeptKey   = null;
        let casualtiesDeptLabel = null;
        if (result.id === "casualties" && actor) {
          const DEPTS   = ["command","conn","engineering","security","medicine","science"];
          const deptRoll = new Roll(`1d${DEPTS.length}`);
          await deptRoll.evaluate();
          casualtiesDeptKey   = DEPTS[deptRoll.total - 1];
          casualtiesDeptLabel = CombatHUD.deptLabel(casualtiesDeptKey);
          await CombatHUD.applyDeptStrain(actor, casualtiesDeptKey, 1);
          await deptRoll.toMessage({ flavor: `Casualties — Affected Department (1d${DEPTS.length})` });
        }

        ChatMessage.create({
          content: lcarsCard("⚠️ SHAKEN — MINOR DAMAGE", LC.yellow, `
            <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
              margin-bottom:4px;font-family:${LC.font};">${actor?.name ?? "Ship"}</div>
            ${rerolled ? `<div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};margin-bottom:3px;">
              Rolled ${firstRoll} (Roll Again) → re-rolled ${rolled}</div>` : ""}
            <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:5px;">
              <span style="font-size:30px;font-weight:700;color:${LC.yellow};
                font-family:${LC.font};">${rolled}</span>
              <span style="font-size:13px;font-weight:700;color:${LC.tertiary};
                font-family:${LC.font};">${result.label}</span>
            </div>
            <div style="font-size:10px;color:${LC.text};font-family:${LC.font};
              line-height:1.5;">${result.desc}</div>
            ${result.id === "lose_power" ? `
            <div style="margin-top:5px;padding:4px 6px;background:rgba(255,153,0,0.08);
              border-left:2px solid ${LC.orange};border-radius:2px;
              font-size:10px;color:${LC.orange};font-family:${LC.font};">
              ⚡ Reserve Power cleared. Regain Power Difficulty +1 this combat.
            </div>` : ""}
            ${result.id === "casualties" && casualtiesDeptLabel ? `
            <div style="margin-top:5px;padding:4px 6px;background:rgba(255,153,0,0.08);
              border-left:2px solid ${LC.orange};border-radius:2px;
              font-size:10px;color:${LC.orange};font-family:${LC.font};">
              💥 Crew Casualties — <strong>${casualtiesDeptLabel}</strong> dept
              complication range +1 on all tasks using that discipline.
            </div>` : ""}
          `),
          speaker: { alias: "STA2e Toolkit" },
        });

        game.sta2eToolkit?.combatHud?._refresh?.();
      });
    });

    // Manual shaken result chooser buttons
    html.querySelectorAll(".sta2e-shaken-choose").forEach(btn => {
      btn.addEventListener("click", async () => {
        const tok    = canvas.tokens?.get(btn.dataset.tokenid);
        const actor  = tok?.actor ?? game.actors.get(btn.dataset.actorid);
        const result = CombatHUD.SHAKEN_RESULTS.find(r => r.id === btn.dataset.resultid);
        if (!result) return;

        // Disable all shaken buttons in this card
        html.querySelectorAll(".sta2e-shaken-roll, .sta2e-shaken-choose").forEach(b => {
          b.disabled = true; b.style.opacity = "0.4";
        });
        btn.style.opacity = "0.8"; btn.style.borderColor = LC.tertiary;

        if (actor) {
          if (result.id === "lose_power") {
            if (CombatHUD.hasReservePower(actor)) await CombatHUD.clearReservePower(actor);
            await CombatHUD.incrementRegainPowerUses(actor);
          }
          if (result.id !== "brace") {
            await actor.update({ "system.shaken": false });
          }
        }

        let casualtiesDeptLabel = null;
        if (result.id === "casualties" && actor) {
          const DEPTS    = ["command","conn","engineering","security","medicine","science"];
          const deptRoll = new Roll(`1d${DEPTS.length}`);
          await deptRoll.evaluate();
          const deptKey  = DEPTS[deptRoll.total - 1];
          casualtiesDeptLabel = CombatHUD.deptLabel(deptKey);
          await CombatHUD.applyDeptStrain(actor, deptKey, 1);
          await deptRoll.toMessage({ flavor: `Casualties — Affected Department (1d${DEPTS.length})` });
        }

        ChatMessage.create({
          content: lcarsCard("⚠️ SHAKEN — MINOR DAMAGE", LC.yellow, `
            <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
              margin-bottom:4px;font-family:${LC.font};">${actor?.name ?? "Ship"}</div>
            <div style="font-size:9px;color:${LC.textDim};font-family:${LC.font};
              margin-bottom:3px;">GM choice</div>
            <div style="font-size:13px;font-weight:700;color:${LC.tertiary};
              font-family:${LC.font};margin-bottom:5px;">${result.label}</div>
            <div style="font-size:10px;color:${LC.text};font-family:${LC.font};
              line-height:1.5;">${result.desc}</div>
            ${result.id === "brace" ? `
            <div style="margin-top:5px;padding:4px 6px;background:rgba(255,204,102,0.08);
              border-left:2px solid ${LC.yellow};border-radius:2px;
              font-size:10px;color:${LC.yellow};font-family:${LC.font};">
              ⚠ Shaken status remains — clear manually in the HUD when the
              restricted turn has passed.
            </div>` : ""}
            ${result.id === "lose_power" ? `
            <div style="margin-top:5px;padding:4px 6px;background:rgba(255,153,0,0.08);
              border-left:2px solid ${LC.orange};border-radius:2px;
              font-size:10px;color:${LC.orange};font-family:${LC.font};">
              ⚡ Reserve Power cleared. Regain Power Difficulty +1 this combat.
            </div>` : ""}
            ${casualtiesDeptLabel ? `
            <div style="margin-top:5px;padding:4px 6px;background:rgba(255,153,0,0.08);
              border-left:2px solid ${LC.orange};border-radius:2px;
              font-size:10px;color:${LC.orange};font-family:${LC.font};">
              💥 Crew Casualties — <strong>${casualtiesDeptLabel}</strong> dept
              complication range +1.
            </div>` : ""}
          `),
          speaker: { alias: "STA2e Toolkit" },
        });

        game.sta2eToolkit?.combatHud?._refresh?.();
      });
    });

    // ── Devastating Attack button ───────────────────────────────────────────
    if (message.flags?.["sta2e-toolkit"]?.damageResult) {
      html.querySelectorAll(".sta2e-devastating-attack").forEach(btn => {
        // Wire the extra damage input above this button to update payload
        const controls     = btn.closest(".sta2e-damage-controls");
        const input        = controls?.querySelector(".sta2e-extra-damage");
        const finalDisplay = controls?.querySelector(".sta2e-final-display strong");
        if (input) {
          const basePayload = JSON.parse(decodeURIComponent(input.dataset.basePayload));
          const devPayload  = JSON.parse(decodeURIComponent(btn.dataset.payload));
          const baseFinal   = basePayload.finalDamage;
          const update = () => {
            const extra    = parseInt(input.value) || 0;
            const newTotal = Math.max(0, baseFinal + extra);
            if (finalDisplay) finalDisplay.textContent = newTotal;
            // Update both the apply-damage-style payload (for consistency) and the dev payload
            btn.dataset.payload = encodeURIComponent(JSON.stringify({ ...devPayload, halfDamage: newTotal }));
          };
          input.addEventListener("input",  update);
          input.addEventListener("change", update);
          input.addEventListener("mousedown", e => e.stopPropagation());
        }

        btn.addEventListener("click", async () => {
          try {
            const payload     = JSON.parse(decodeURIComponent(btn.dataset.payload));
            btn.disabled      = true;
            btn.textContent   = "✓ Devastating Attack Applied";
            btn.style.opacity = "0.5";
            if (input) input.disabled = true;
            await CombatHUD.applyDevastatingAttack(payload);
          } catch(err) {
            console.error("STA2e Toolkit | applyDevastatingAttack error:", err);
            ui.notifications.error("Failed to apply Devastating Attack — see console.");
          }
        });
      });

      // ── Area Attack — apply same damage to additional nearby starship tokens ──
      html.querySelectorAll(".sta2e-area-attack").forEach(btn => {
        btn.addEventListener("click", async () => {
          try {
            const payload   = JSON.parse(decodeURIComponent(btn.dataset.payload));
            btn.disabled    = true;
            btn.textContent = "Selecting targets…";
            btn.style.opacity = "0.7";
            await CombatHUD.openAreaTargetPicker(payload);
            btn.textContent   = "✓ Area Applied";
            btn.style.opacity = "0.5";
          } catch(err) {
            console.error("STA2e Toolkit | openAreaTargetPicker error:", err);
            ui.notifications.error("Failed to apply Area attack — see console.");
            btn.disabled  = false;
            btn.textContent = "AREA — APPLY TO ADDITIONAL TARGETS";
            btn.style.opacity = "1";
          }
        });
      });

    }
  }

  // ── Defensive Fire counterattack — outside all flag blocks so it fires
  // for damageCard, damageResult, and miss cards alike ──────────────────────
  if (game.user.isGM) {
    html.querySelectorAll(".sta2e-defensive-counterattack").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const payload       = JSON.parse(decodeURIComponent(btn.dataset.payload));
          const attackerToken = canvas.tokens.get(payload.attackerTokenId);
          const defenderToken = canvas.tokens.get(payload.defenderTokenId);
          const defenderActor = defenderToken?.actor ?? game.actors.get(payload.defenderActorId);

          if (!attackerToken || !defenderActor) {
            ui.notifications.warn("STA2e Toolkit: Could not find attacker or defender for counterattack. Make sure both ships are on the current scene.");
            return;
          }

          // Determine pool type — NPC ships spend Threat, player ships spend Momentum
          const isNpcDefender = CombatHUD.isNpcShip(defenderActor);
          const caPool        = isNpcDefender ? "threat" : "momentum";
          const Tracker       = game.STATracker?.constructor;
          if (Tracker) {
            const caPoolCurrent = Tracker.ValueOf(caPool);
            if (caPoolCurrent < 2) {
              ui.notifications.warn(`STA2e Toolkit: Not enough ${isNpcDefender ? "Threat" : "Momentum"} to counterattack (need 2, have ${caPoolCurrent}).`);
              return;
            }
          }

          // For Defensive Fire: only energy weapons (no torpedoes per rules)
          // For Evasive Action / Cover: any ship weapon
          const defType = payload.opposedDefenseType ?? "defensive-fire";
          const defenderWeapons = defenderActor.items.filter(i => {
            if (i.type !== "starshipweapon2e") return false;
            if (defType === "defensive-fire") return !(i.system?.qualities?.torpedo ?? false);
            return true;
          });

          if (!defenderWeapons.length) {
            ui.notifications.warn("STA2e Toolkit: No weapons found on defending ship for counterattack.");
            return;
          }

          // If only one weapon, use it directly — no need to ask
          let defWeapon;
          if (defenderWeapons.length === 1) {
            defWeapon = defenderWeapons[0];
          } else {
            // Multiple weapons — show weapon icon picker using the same HUD button style
            const hud = game.sta2eToolkit?.combatHud;
            defWeapon = await new Promise(resolve => {
              const weaponBtns = defenderWeapons.map(w => {
                const { total, breakdown } = hud
                  ? hud._weaponDamageBreakdown(w, defenderActor)
                  : { total: w.system?.damage ?? 0, breakdown: null };
                const dmgLabel  = breakdown ? `${total} (${breakdown})` : total;
                const range     = w.system?.range ?? "?";
                const qualities = hud ? hud._weaponQualityString(w) : "";
                return `
                  <button class="sta2e-cf-weapon"
                    data-index="${defenderWeapons.indexOf(w)}"
                    title="${w.name}&#10;Damage: ${dmgLabel}&#10;Range: ${range}&#10;Qualities: ${qualities}"
                    style="
                      width:44px;height:44px;
                      background:${LC.panel} url('${w.img}') center/contain no-repeat;
                      border:1px solid ${LC.border};border-radius:2px;
                      cursor:pointer;position:relative;
                      transition:border-color 0.15s,box-shadow 0.15s;
                    ">
                  </button>`;
              }).join("");

              const picker = new foundry.applications.api.DialogV2({
                window:  { title: `${defenderActor.name} — Select Counterattack Weapon` },
                content: `
                  <div style="font-family:${LC.font};padding:4px 0;">
                    <div style="font-size:10px;color:${LC.textDim};margin-bottom:10px;line-height:1.5;">
                      <strong style="color:${LC.red};">⚡ Counterattack</strong>
                      — automatic hit against <strong>${attackerToken.name}</strong> (costs 2 ${isNpcDefender ? "Threat" : "Momentum"}).<br>
                      Select the weapon to fire:
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0;">
                      ${weaponBtns}
                    </div>
                  </div>`,
                buttons: [
                  { action: "cancel", label: "Cancel", icon: "fas fa-times", default: true },
                ],
              });

              picker.render(true).then(() => {
                setTimeout(() => {
                  const el = picker.element ?? document.querySelector(".app.dialog-v2");
                  if (!el) { resolve(null); return; }

                  el.querySelectorAll(".sta2e-cf-weapon").forEach(wb => {
                    wb.addEventListener("mouseenter", () => {
                      wb.style.borderColor = LC.primary;
                      wb.style.boxShadow   = `0 0 6px ${LC.primary}`;
                    });
                    wb.addEventListener("mouseleave", () => {
                      wb.style.borderColor = LC.border;
                      wb.style.boxShadow   = "";
                    });
                    wb.addEventListener("click", () => {
                      const idx = parseInt(wb.dataset.index);
                      try { picker.close(); } catch {}
                      resolve(defenderWeapons[idx] ?? null);
                    });
                  });

                  // Cancel button resolves null
                  Hooks.once("closeDialogV2", () => resolve(null));
                }, 60);
              });
            });

            if (!defWeapon) return; // cancelled
          }

          // ── Area / Spread mode for counterattack (arrays & torpedo salvos) ──
          const caConfig    = getWeaponConfig(defWeapon);
          const caIsArray   = caConfig?.type === "beam"    && (caConfig?.isArray ?? false);
          const caIsSalvo   = caConfig?.type === "torpedo" && (caConfig?.salvo   ?? false);
          const caHasAreaQ  = defWeapon.system?.qualities?.area   ?? false;
          const caHasSpreadQ= defWeapon.system?.qualities?.spread ?? false;
          const caNeedsMode = caIsArray || caIsSalvo || caHasAreaQ || caHasSpreadQ;
          let caSalvoMode   = "area";
          if (caNeedsMode) {
            const caModeChoice = await foundry.applications.api.DialogV2.wait({
              window:  { title: `${defWeapon.name} — Counterattack Mode` },
              content: `
                <div style="font-family:${LC.font};padding:4px 0;">
                  <div style="font-size:11px;color:${LC.text};margin-bottom:8px;">
                    Choose how <strong style="color:${LC.primary};">${defWeapon.name}</strong> fires:
                  </div>
                  <div style="font-size:10px;color:${LC.textDim};line-height:1.6;padding:4px 8px;
                    border-left:3px solid ${LC.borderDim};border-radius:0 2px 2px 0;">
                    ⚡ <strong>Area</strong> — apply the same damage to additional nearby ships
                    after the roll (1 momentum / 1 threat each)<br>
                    ↔ <strong>Spread</strong> — reduces Devastating Attack cost from 2 → 1 ${isNpcDefender ? "threat" : "momentum"}
                  </div>
                </div>`,
              buttons: [
                { action: "area",   label: "⚡ Area",   icon: "fas fa-bolt",         default: true },
                { action: "spread", label: "↔ Spread",  icon: "fas fa-arrows-alt-h"               },
                { action: "cancel", label: "Cancel",     icon: "fas fa-times"                      },
              ],
            });
            if (!caModeChoice || caModeChoice === "cancel") {
              btn.disabled  = false;
              btn.textContent = "Counterattack";
              btn.style.opacity = "1";
              return;
            }
            caSalvoMode = caModeChoice;
          }

          btn.disabled      = true;
          btn.textContent   = "✓ Counterattack Fired";
          btn.style.opacity = "0.5";

          // Spend 2 Momentum (player) or 2 Threat (NPC) for the counterattack
          if (Tracker) {
            await Tracker.DoUpdateResource(caPool, Tracker.ValueOf(caPool) - 2);
          }

          // Auto-hit — pass the attacker token directly so no target selection needed
          await CombatHUD.resolveShipAttack(defenderToken, defWeapon, true, {
            salvoMode:       caSalvoMode,
            overrideTargets: [attackerToken],
          });
        } catch(err) {
          console.error("STA2e Toolkit | Ship counterattack error:", err);
          ui.notifications.error("Failed to apply counterattack — see console.");
        }
      });
    });
  }

  // ── Apply Shields button (Regen Shields result card) ────────────────────
  if (message.flags?.["sta2e-toolkit"]?.regenShieldCard) {
    const threatEl = html.querySelector(".sta2e-shield-threat");
    const totalEl  = html.querySelector(".sta2e-shield-total");
    const applyBtn = html.querySelector(".sta2e-apply-shields");
    if (threatEl && totalEl && applyBtn) {
      const base = JSON.parse(decodeURIComponent(applyBtn.dataset.payload)).baseRestore ?? 0;
      const update = () => {
        const bonus = Math.max(0, parseInt(threatEl.value) || 0) * 2;
        totalEl.textContent = `= ${base + bonus} shields`;
        totalEl.style.color = bonus > 0 ? "var(--sta2e-tertiary,#ffcc66)" : "var(--sta2e-text-dim,#888)";
      };
      threatEl.addEventListener("input", update);
      threatEl.addEventListener("mousedown", e => e.stopPropagation());
    }
  }
  if (game.user.isGM && message.flags?.["sta2e-toolkit"]?.regenShieldCard) {
    html.querySelectorAll(".sta2e-apply-shields").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const payload   = JSON.parse(decodeURIComponent(btn.dataset.payload));
          const tok       = canvas.tokens?.get(payload.tokenId);
          const actor     = tok?.actor ?? game.actors.get(payload.actorId);
          if (!actor) { ui.notifications.warn("Could not find actor."); return; }
          const threatEl  = btn.closest(".chat-message")?.querySelector(".sta2e-shield-threat");
          const threat    = Math.max(0, parseInt(threatEl?.value ?? "0") || 0);
          const restore   = (payload.baseRestore ?? 0) + (threat * 2);
          const current   = actor.system?.shields?.value ?? 0;
          const newVal    = Math.min(payload.maxShield ?? actor.system?.shields?.max ?? 0, current + restore);
          btn.disabled = true; btn.textContent = "✓ Applied"; btn.style.opacity = "0.5";
          if (threatEl) threatEl.disabled = true;
          // Consume Reserve Power — Regen Shields spends it
          await CombatHUD.clearReservePower(actor);
          await actor.update({ "system.shields.value": newVal });
          ChatMessage.create({
            content: lcarsCard("🛡️ SHIELDS REGENERATED", LC.green, `
              <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
              <div style="display:grid;grid-template-columns:repeat(${threat > 0 ? 3 : 2},1fr);gap:3px;text-align:center;">
                <div style="background:rgba(0,200,100,0.07);border:1px solid ${LC.borderDim};border-radius:2px;padding:3px;">
                  <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">Restored</div>
                  <div style="font-size:18px;font-weight:700;color:${LC.green};">+${restore}</div>
                </div>
                <div style="background:rgba(0,200,100,0.07);border:1px solid ${LC.borderDim};border-radius:2px;padding:3px;">
                  <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">Shields</div>
                  <div style="font-size:18px;font-weight:700;color:${LC.green};">${newVal}/${payload.maxShield}</div>
                </div>
                ${threat > 0 ? `<div style="background:rgba(255,153,0,0.07);border:1px solid ${LC.borderDim};border-radius:2px;padding:3px;">
                  <div style="font-size:8px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${LC.font};">Threat</div>
                  <div style="font-size:18px;font-weight:700;color:${LC.tertiary};">${threat}</div>
                </div>` : ""}
              </div>`),
            speaker: { alias: "STA2e Toolkit" },
          });
          game.sta2eToolkit?.combatHud?._refresh?.();
        } catch(err) {
          console.error("STA2e Toolkit | Apply shields:", err);
          ui.notifications.error("Failed to apply shields.");
        }
      });
    });
  }

  // ── Tractor Beam card buttons ────────────────────────────────────────────
  if (game.user.isGM && message.flags?.["sta2e-toolkit"]?.tractorBeamCard) {

    // ENGAGE — apply TMFX beam glow on source + attach target via Token Attacher
    html.querySelectorAll(".sta2e-tractor-engage").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const payload    = JSON.parse(decodeURIComponent(btn.dataset.payload));
          const sourceTok  = canvas.tokens?.get(payload.sourceTokenId);
          const targetTok  = canvas.tokens?.get(payload.targetTokenId);
          if (!sourceTok || !targetTok) {
            ui.notifications.warn("STA2e Toolkit: Both tokens must be on the current scene.");
            return;
          }

          btn.disabled     = true;
          btn.textContent  = "🔗 ENGAGED";
          btn.style.opacity = "0.6";
          btn.style.borderColor = LC.green;

          // Flag both tokens
          await CombatHUD.engageTractorBeam(sourceTok, targetTok);

          // TMFX persistent beam glow on source token
          try {
            await TokenMagic.addUpdateFilters(sourceTok, [{
              filterType: "glow",
              filterId:   "tractorBeam",
              outerStrength: 8,
              innerStrength: 3,
              color:      0x00aaff,
              quality:    0.5,
              padding:    10,
              animated: {
                time: { active: true, speed: 0.005, animType: "move" }
              }
            }]);
          } catch(e) { console.warn("STA2e | tractor TMFX:", e); }

          // Play persistent JB2A tractor beam effect
          await CombatHUD.playTractorBeamEffect(sourceTok, targetTok);

          // Snap target to behind the source immediately
          // Helper so we can call it again after a short delay (Foundry may grid-snap)
          const snapBehind = async (animate = true) => {
            const gridSize = canvas.grid?.size ?? 100;
            const srcW     = (sourceTok.document.width  ?? 1) * gridSize;
            const srcH     = (sourceTok.document.height ?? 1) * gridSize;
            const tgtW     = (targetTok.document.width  ?? 1) * gridSize;
            const tgtH     = (targetTok.document.height ?? 1) * gridSize;
            const srcRot   = sourceTok.document.rotation ?? 0;
            const towDist  = srcW * 0.5 + tgtW * 0.5 + gridSize * 0.2;
            const rotRad   = (srcRot * Math.PI) / 180;
            const behindX  = (sourceTok.x + srcW / 2) + Math.sin(rotRad) * towDist - tgtW / 2;
            const behindY  = (sourceTok.y + srcH / 2) - Math.cos(rotRad) * towDist - tgtH / 2;
            console.log(`STA2e | snapBehind rot=${srcRot} behind=(${behindX.toFixed(0)},${behindY.toFixed(0)})`);
            await targetTok.document.update({ x: behindX, y: behindY, rotation: srcRot },
              { animate }).catch(() => {});
          };
          await snapBehind(false);
          // Second snap after 300ms in case Foundry grid-snapping overrides us.
          // If Token Attacher is available, attach the target to the source after
          // the snap so TA stores the correct "behind" offset and handles all
          // subsequent movement natively (drag, keyboard, ruler, API calls).
          setTimeout(async () => {
            await snapBehind(false);
            if (_taAvailable()) {
              try {
                // attachElementToToken(element, parentToken, suppressNotification)
                // Both args are canvas PlaceableObjects. Offset is captured from
                // their current relative positions, so the target stays "behind".
                await window.tokenAttacher.attachElementToToken(targetTok, sourceTok, true);
                // Record that TA is managing movement so the hook fallback skips this pair.
                await sourceTok.document.setFlag("sta2e-toolkit", "tractorBeam", {
                  ...sourceTok.document.getFlag("sta2e-toolkit", "tractorBeam"),
                  usesTA: true,
                });
              } catch(e) { console.warn("STA2e | TA attach failed:", e); }
            }
          }, 300);

          ChatMessage.create({
            content: lcarsCard("🔗 TRACTOR BEAM ACTIVE", LC.primary, `
              <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${payload.sourceName}</div>
              <div style="font-size:13px;color:${LC.primary};font-weight:700;
                font-family:${LC.font};margin-bottom:4px;">
                🔗 ${payload.targetName} locked in tractor beam
              </div>
              <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};line-height:1.5;">
                Target follows source token movement.
                Break-free: Engines + Conn vs Difficulty ${payload.tractorStr}.
                Release manually via the Tractor Beam action or the HUD status badge.
              </div>`),
            speaker: { alias: "STA2e Toolkit" },
          });

          game.sta2eToolkit?.combatHud?._refresh?.();

        } catch(err) {
          console.error("STA2e Toolkit | Tractor beam engage:", err);
          ui.notifications.error("Tractor beam engage failed — see console.");
        }
      });
    });

    // RELEASE — detach and clear everything
    html.querySelectorAll(".sta2e-tractor-release").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const payload   = JSON.parse(decodeURIComponent(btn.dataset.payload));
          const sourceTok = canvas.tokens?.get(payload.sourceTokenId);
          const targetTok = canvas.tokens?.get(payload.targetTokenId);
          await CombatHUD.releaseTractorBeam(sourceTok, targetTok);
          btn.textContent  = "✕ Released";
          btn.style.opacity = "0.5";
          const engageBtn = btn.parentElement?.querySelector(".sta2e-tractor-engage");
          if (engageBtn) { engageBtn.disabled = true; engageBtn.style.opacity = "0.4"; }
          ChatMessage.create({
            content: lcarsCard("🔗 TRACTOR BEAM RELEASED", LC.textDim, `
              <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${payload.sourceName}</div>
              <div style="font-size:13px;color:${LC.text};font-family:${LC.font};">
                Tractor beam disengaged from ${payload.targetName}.
              </div>`),
            speaker: { alias: "STA2e Toolkit" },
          });
          game.sta2eToolkit?.combatHud?._refresh?.();
        } catch(err) {
          console.error("STA2e Toolkit | Tractor release:", err);
        }
      });
    });
  }

  // ── Ram Animation button ─────────────────────────────────────────────────
  if (game.user.isGM && message.flags?.["sta2e-toolkit"]?.ramResultCard) {
    html.querySelectorAll(".sta2e-ram-engage").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const { attackerTokenId, targetTokenId } = JSON.parse(decodeURIComponent(btn.dataset.payload));
          const atkTok = canvas.tokens?.get(attackerTokenId);
          const defTok = canvas.tokens?.get(targetTokenId);
          if (!atkTok || !defTok) {
            ui.notifications.warn("STA2e Toolkit: Both tokens must be on the current scene.");
            return;
          }

          btn.disabled     = true;
          btn.textContent  = "💥 ANIMATING...";
          btn.style.opacity = "0.7";

          const startPos = { x: atkTok.x, y: atkTok.y };
          const targPos  = { x: defTok.x, y: defTok.y };

          // Direction vector attacker → target
          const dx   = targPos.x - startPos.x;
          const dy   = targPos.y - startPos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const nx   = dx / dist;   // unit vector
          const ny   = dy / dist;

          // Stop short of target centre (half token width approx)
          const gridSize   = canvas.grid?.size ?? 100;
          const stopFrac   = Math.max(0, (dist - gridSize * 0.6) / dist);
          const impactPos  = {
            x: startPos.x + dx * stopFrac,
            y: startPos.y + dy * stopFrac,
          };

          // ── 1. Pre-ram red glow on attacker ──────────────────────────────
          try {
            await TokenMagic.addUpdateFilters(atkTok, [{
              filterType: "glow", filterId: "ramGlow",
              outerStrength: 14, innerStrength: 5, color: 0xff2200,
              quality: 0.5, padding: 10,
              animated: { time: { active: true, speed: 0.03, animType: "move" } }
            }]);
          } catch(e) {}
          await new Promise(r => setTimeout(r, 500));

          // ── 2. Rotate attacker to face target ────────────────────────────
          const angle = Math.atan2(dy, dx) * (180 / Math.PI) - 90;
          await atkTok.document.update({ rotation: angle });

          // ── 3. Arc toward target (straight line — no bezier for ram) ─────
          const ease      = t => t * t * (3 - 2 * t);
          const STEPS     = 30;
          const STEP_MS   = 14;
          for (let i = 1; i <= STEPS; i++) {
            const t  = ease(i / STEPS);
            await atkTok.document.update({
              x: startPos.x + (impactPos.x - startPos.x) * t,
              y: startPos.y + (impactPos.y - startPos.y) * t,
            });
            await new Promise(r => setTimeout(r, STEP_MS));
          }

          // ── 4. Impact flash on both tokens ───────────────────────────────
          try {
            await TokenMagic.addUpdateFilters(defTok, [{
              filterType: "glow", filterId: "ramImpact",
              outerStrength: 20, innerStrength: 8, color: 0xff4400,
              quality: 0.5, padding: 15,
              animated: { outerStrength: { active: true, val1: 20, val2: 0, loops: 1, loopDuration: 600 } }
            }]);
            // Shake attacker
            await TokenMagic.addUpdateFilters(atkTok, [{
              filterType: "shockwave", filterId: "ramShock",
              time: 0, speed: 0.5, amplitude: 8, wavelength: 50,
              radius: 100, padding: 20,
              animated: { time: { active: true, speed: 0.05, animType: "move" } }
            }]);
          } catch(e) {}
          await new Promise(r => setTimeout(r, 120));

          // ── 5. Bounce back halfway to origin ─────────────────────────────
          const bouncePos = {
            x: startPos.x + dx * stopFrac * 0.4,
            y: startPos.y + dy * stopFrac * 0.4,
          };
          for (let i = 1; i <= 16; i++) {
            const t = ease(i / 16);
            await atkTok.document.update({
              x: impactPos.x + (bouncePos.x - impactPos.x) * t,
              y: impactPos.y + (bouncePos.y - impactPos.y) * t,
            });
            await new Promise(r => setTimeout(r, 18));
          }

          // ── 6. Clean up filters ───────────────────────────────────────────
          await new Promise(r => setTimeout(r, 400));
          try {
            await TokenMagic.deleteFilters(atkTok, "ramGlow");
            await TokenMagic.deleteFilters(atkTok, "ramShock");
            setTimeout(() => { try { TokenMagic.deleteFilters(defTok, "ramImpact"); } catch {} }, 300);
          } catch(e) {}

          btn.textContent  = "✓ ANIMATED";
          btn.style.opacity = "0.5";

        } catch(err) {
          console.error("STA2e Toolkit | Ram animation error:", err);
          ui.notifications.error("Ram animation failed — see console.");
        }
      });
    });
  }

  // ── Impulse Engage button ────────────────────────────────────────────────
  if (message.flags?.["sta2e-toolkit"]?.impulseEngageCard) {
    if (impulseLocked) {
      html.querySelectorAll(".sta2e-impulse-engage").forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.textContent = "✓ ENGAGED";
      });
      return;
    }

    let impulsePayload;
    try {
      impulsePayload = JSON.parse(decodeURIComponent(
        html.querySelector(".sta2e-impulse-engage")?.dataset.payload ?? "{}"
      ));
    } catch {
      impulsePayload = {};
    }

    const canUseImpulse = hasExplicitAllowedUsers
      ? (game.user.isGM || allowedUserIds.includes(game.user.id))
      : getCardActorAccess(impulsePayload).canUse;
    if (!canUseImpulse) {
      html.querySelectorAll(".sta2e-impulse-engage").forEach(btn => btn.style.display = "none");
      return;
    }

    html.querySelectorAll(".sta2e-impulse-engage").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const payload = JSON.parse(decodeURIComponent(btn.dataset.payload));
          const tok     = canvas.tokens?.get(payload.tokenId);
          if (!tok) { ui.notifications.warn("Token not found on current scene."); return; }

          btn.disabled      = true;
          btn.textContent   = "🔴 ENGAGING...";
          btn.style.opacity = "0.7";

          const chosenDestination = await promptShipCardDestination({
            overlayId: "sta2e-impulse-overlay",
            title: "IMPULSE DESTINATION",
            color: "#ff3300",
            tokenId: tok.id,
            maxZones: 2,
          });

          if (!chosenDestination) {
            btn.disabled      = false;
            btn.textContent   = "🔴 ENGAGE IMPULSE";
            btn.style.opacity = "1";
            ui.notifications.info("STA2e Toolkit: Impulse aborted.");
            return;
          }

          if (game.user.isGM) {
            await runImpulseEngageCard(payload, chosenDestination);
          } else {
            game.socket.emit("module.sta2e-toolkit", {
              action: "runImpulseEngageCard",
              messageId: message.id,
              requesterUserId: game.user.id,
              payload,
              destination: chosenDestination,
            });
          }

          btn.textContent   = "✓ ENGAGED";
          btn.style.opacity = "0.5";
          await syncShipCardLock({ impulseEngageConsumed: true });
          return;

          const impulseSound = game.settings.get("sta2e-toolkit", "sndImpulseEngage") ?? "";

          // Step 1 — Pre-impulse red glow
          try {
            await TokenMagic.addUpdateFilters(tok, [{
              filterType: "glow", filterId: "impulseGlow",
              outerStrength: 12, innerStrength: 4, color: 0xff3300,
              quality: 0.5, padding: 10,
              animated: { time: { active: true, speed: 0.02, animType: "move" } }
            }, {
              filterType: "bulgepinch", filterId: "impulseCharge",
              padding: 20, strength: 0.1, radius: 150,
              animated: { strength: { active: true, val1: 0.03, val2: 0.1, speed: 0.06, animType: "cosOscillation" } }
            }]);
          } catch(e) { console.warn("STA2e | impulse pre-glow:", e); }
          await new Promise(r => setTimeout(r, 800));

          // Step 2 — Get destination via map click
          const startPos = { x: tok.x, y: tok.y };
          const destination = await new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.id    = "sta2e-impulse-overlay";
            overlay.style.cssText = `position:fixed;top:10px;left:50%;transform:translateX(-50%);
              background:rgba(0,0,0,0.75);color:#ff3300;border:1px solid #ff3300;
              padding:6px 18px;border-radius:4px;z-index:10000;
              font-family:'Arial Narrow',sans-serif;text-align:center;pointer-events:none;`;
            overlay.innerHTML = `<div style="font-size:13px;font-weight:700;letter-spacing:0.1em;">
              IMPULSE DESTINATION</div>
              <div style="font-size:10px;margin-top:2px;">Click to set destination · ESC to cancel</div>`;
            document.body.appendChild(overlay);
            canvas.app.view.style.cursor = "crosshair";

            const cleanup = () => {
              document.getElementById("sta2e-impulse-overlay")?.remove();
              canvas.stage.off("mousedown", clickHandler);
              document.removeEventListener("keydown", escHandler);
              canvas.app.view.style.cursor = "default";
            };
            const clickHandler = (event) => {
              cleanup();
              resolve({ x: event.interactionData.origin.x, y: event.interactionData.origin.y });
            };
            const escHandler = (event) => {
              if (event.key !== "Escape") return;
              cleanup();
              resolve(null);
            };
            canvas.stage.on("mousedown", clickHandler);
            document.addEventListener("keydown", escHandler);
          });

          if (!destination) {
            // Remove pre-glow if cancelled
            try { TokenMagic.deleteFilters(tok); } catch {}
            btn.disabled      = false;
            btn.textContent   = "🔴 ENGAGE IMPULSE";
            btn.style.opacity = "1";
            ui.notifications.info("STA2e Toolkit: Impulse aborted.");
            return;
          }

          // Step 4 — Play sound and arc to destination along a quadratic bezier curve
          if (impulseSound) {
            try { new Sequence().sound().file(impulseSound).volume(0.8).play(); } catch(e) {}
          }

          // Compute a bezier arc — control point is perpendicular to the midpoint,
          // offset by ~30% of the travel distance to give a natural banking curve
          const dx   = destination.x - startPos.x;
          const dy   = destination.y - startPos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const mx   = startPos.x + dx * 0.5;
          const my   = startPos.y + dy * 0.5;
          // Perpendicular offset (banking direction — always curves to the left of travel)
          const arcAmount = Math.min(dist * 0.3, 200);
          const px   = mx - (dy / dist) * arcAmount;
          const py   = my + (dx / dist) * arcAmount;

          // Animate along bezier with ease-in-out and high step count for smoothness
          // Ease function: smoothstep  s(t) = t²(3 - 2t)
          const ease        = t => t * t * (3 - 2 * t);
          const DURATION_MS = 700;   // total arc travel time
          const STEP_MS     = 16;    // ~60fps
          const STEPS       = Math.round(DURATION_MS / STEP_MS);

          for (let i = 1; i <= STEPS; i++) {
            const raw = i / STEPS;
            const t   = ease(raw);   // eased progress along curve
            const mt  = 1 - t;

            // Position on curve
            const bx = mt * mt * startPos.x + 2 * mt * t * px + t * t * destination.x;
            const by = mt * mt * startPos.y + 2 * mt * t * py + t * t * destination.y;

            // Tangent via derivative (use raw t for direction — avoids derivative going to 0 at ends)
            const rt  = Math.max(0.01, Math.min(0.99, raw));
            const rmt = 1 - rt;
            const tdx = 2 * rmt * (px - startPos.x) + 2 * rt * (destination.x - px);
            const tdy = 2 * rmt * (py - startPos.y) + 2 * rt * (destination.y - py);
            const tangentAngle = Math.atan2(tdy, tdx) * (180 / Math.PI) - 90;

            await tok.document.update({ x: bx, y: by, rotation: tangentAngle });
            await new Promise(r => setTimeout(r, STEP_MS));
          }
          // Snap exactly to destination
          const finalAngle = Math.atan2(destination.y - startPos.y, destination.x - startPos.x) * (180 / Math.PI) - 90;
          await tok.document.update({ x: destination.x, y: destination.y, rotation: finalAngle });

          // Step 5 — Clear glow, residual fade
          try {
            await TokenMagic.deleteFilters(tok, "impulseGlow");
            await TokenMagic.deleteFilters(tok, "impulseCharge");
            await TokenMagic.addUpdateFilters(tok, [{
              filterType: "glow", filterId: "impulseResidual",
              outerStrength: 6, innerStrength: 2, color: 0xff3300,
              quality: 0.5, padding: 10,
              animated: { outerStrength: { active: true, val1: 6, val2: 0, loops: 1, loopDuration: 800 } }
            }]);
            setTimeout(() => { try { TokenMagic.deleteFilters(tok, "impulseResidual"); } catch {} }, 1000);
          } catch(e) { console.warn("STA2e | impulse cleanup:", e); }

          btn.textContent   = "✓ ENGAGED";
          btn.style.opacity = "0.5";

        } catch(err) {
          console.error("STA2e Toolkit | Impulse engage error:", err);
          ui.notifications.error("Impulse animation failed — see console.");
          const tok2 = canvas.tokens?.get(JSON.parse(decodeURIComponent(btn.dataset.payload)).tokenId);
          if (tok2) try { TokenMagic.deleteFilters(tok2); } catch {}
        }
      });
    });
  }

  // ── Warp Engage button ───────────────────────────────────────────────────
  if (message.flags?.["sta2e-toolkit"]?.warpEngageCard) {
    if (warpLockState) {
      html.querySelectorAll(".sta2e-warp-engage, .sta2e-warp-flee").forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = "0.5";
      });
      html.querySelectorAll(".sta2e-warp-engage").forEach(btn => btn.textContent = warpLockState === "engage" ? "✓ ENGAGED" : "⚡ ENGAGE");
      html.querySelectorAll(".sta2e-warp-flee").forEach(btn => btn.textContent = warpLockState === "flee" ? "✓ FLED" : "🚀 FLEE");
      return;
    }

    let warpPayload;
    try {
      warpPayload = JSON.parse(decodeURIComponent(
        html.querySelector(".sta2e-warp-engage, .sta2e-warp-flee")?.dataset.payload ?? "{}"
      ));
    } catch {
      warpPayload = {};
    }

    const canUseWarp = hasExplicitAllowedUsers
      ? (game.user.isGM || allowedUserIds.includes(game.user.id))
      : getCardActorAccess(warpPayload).canUse;
    if (!canUseWarp) {
      html.querySelectorAll(".sta2e-warp-engage, .sta2e-warp-flee").forEach(btn => btn.style.display = "none");
      return;
    }

    html.querySelectorAll(".sta2e-warp-engage").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const payload = JSON.parse(decodeURIComponent(btn.dataset.payload));
          const tok     = canvas.tokens?.get(payload.tokenId);

          if (!tok) {
            ui.notifications.warn("STA2e Toolkit: Token not found on current scene — cannot run warp animation.");
            return;
          }

          btn.disabled     = true;
          btn.textContent  = "⚡ ENGAGING...";
          btn.style.opacity = "0.7";

          const chosenDestination = await promptShipCardDestination({
            overlayId: "sta2e-warp-overlay",
            title: "WARP DESTINATION",
            color: "#00a6fb",
            tokenId: tok.id,
            maxZones: tok.actor?.system?.systems?.engines?.value ?? null,
          });

          if (!chosenDestination) {
            btn.disabled    = false;
            btn.textContent = "⚡ ENGAGE";
            btn.style.opacity = "1";
            ui.notifications.info("STA2e Toolkit: Warp sequence aborted.");
            return;
          }

          if (game.user.isGM) {
            await runWarpEngageCard(payload, chosenDestination);
          } else {
            game.socket.emit("module.sta2e-toolkit", {
              action: "runWarpEngageCard",
              messageId: message.id,
              requesterUserId: game.user.id,
              payload,
              destination: chosenDestination,
            });
          }

          btn.textContent  = "✓ ENGAGED";
          btn.style.opacity = "0.5";
          await syncShipCardLock({ warpEngageConsumedAction: "engage" });
          return;

          // Read warp sound from settings
          const warpSound = game.settings.get("sta2e-toolkit", "sndWarpEngage") ?? "";

          // ── Run warp effect (adapted from warp speed macro) ───────────────
          const startPosition = { x: tok.x, y: tok.y };

          // Step 1 — Get destination via map click
          const destination = await new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.id    = "sta2e-warp-overlay";
            overlay.style.cssText = `position:fixed;top:10px;left:50%;transform:translateX(-50%);
              background:rgba(0,0,0,0.75);color:#00a6fb;border:1px solid #00a6fb;
              padding:6px 18px;border-radius:4px;z-index:10000;
              font-family:'Arial Narrow',sans-serif;text-align:center;pointer-events:none;`;
            overlay.innerHTML = `<div style="font-size:13px;font-weight:700;letter-spacing:0.1em;">
              WARP DESTINATION</div>
              <div style="font-size:10px;margin-top:2px;">Click to set destination · ESC to cancel</div>`;
            document.body.appendChild(overlay);
            canvas.app.view.style.cursor = "crosshair";

            const clickHandler = (event) => {
              cleanup();
              resolve({ x: event.interactionData.origin.x, y: event.interactionData.origin.y });
            };
            const escHandler = (event) => {
              if (event.key !== "Escape") return;
              cleanup();
              resolve(null);
            };
            const cleanup = () => {
              document.getElementById("sta2e-warp-overlay")?.remove();
              canvas.stage.off("mousedown", clickHandler);
              document.removeEventListener("keydown", escHandler);
              canvas.app.view.style.cursor = "default";
            };
            canvas.stage.on("mousedown", clickHandler);
            document.addEventListener("keydown", escHandler);
          });

          if (!destination) {
            btn.disabled    = false;
            btn.textContent = "⚡ ENGAGE";
            btn.style.opacity = "1";
            ui.notifications.info("STA2e Toolkit: Warp sequence aborted.");
            return;
          }

          // Step 2 — Pre-warp glow
          try {
            await TokenMagic.addUpdateFilters(tok, [{
              filterType: "glow", filterId: "warpGlow",
              outerStrength: 15, innerStrength: 5, color: 0x00a6fb,
              quality: 0.5, padding: 10,
              animated: { time: { active: true, speed: 0.01, animType: "move" } }
            }, {
              filterType: "bulgepinch", filterId: "warpCharge",
              padding: 30, strength: 0.15, radius: 200,
              animated: { strength: { active: true, val1: 0.05, val2: 0.15, speed: 0.05, animType: "cosOscillation" } }
            }]);
          } catch(e) { console.warn("STA2e | warp pre-glow:", e); }
          await new Promise(r => setTimeout(r, 1500));

          // Step 3 — Rotate toward destination
          try {
            const angle = Math.atan2(destination.y - startPosition.y, destination.x - startPosition.x) * (180 / Math.PI);
            const targetRotation = angle - 90;
            const orig   = tok.document.rotation || 0;
            const delta  = ((targetRotation - orig + 540) % 360) - 180;
            const steps  = 15;
            for (let i = 1; i <= steps; i++) {
              await tok.document.update({ rotation: orig + (delta / steps * i) });
              await new Promise(r => setTimeout(r, 20));
            }
            await tok.document.update({ rotation: targetRotation });
          } catch(e) { console.warn("STA2e | warp rotate:", e); }

          // Step 4 — Warp-in flash + blur
          try {
            await TokenMagic.addUpdateFilters(tok, [{
              filterType: "blur", filterId: "warpBlur", padding: 10, quality: 4, blur: 10,
              animated: { blur: { active: true, val1: 0, val2: 20, speed: 0.1, animType: "ramp" } },
            }]);
            new Sequence()
              .effect()
              .atLocation(tok)
              .scale(0.7)
              .fadeIn(200).fadeOut(300)
              .play();
            if (warpSound) {
              new Sequence().sound().file(warpSound).volume(0.8).play();
            }
          } catch(e) { console.warn("STA2e | warp flash:", e); }
          await new Promise(r => setTimeout(r, 1000));

          // Step 5 — Move token
          await tok.document.update({ alpha: 0 });
          await tok.document.update({ x: destination.x, y: destination.y });

          // Step 6 — Warp-out at destination
          try {
            new Sequence()
              .effect()
              .atLocation(tok)
              .scale(0.7)
              .fadeIn(200).fadeOut(300)
              .play();
          } catch(e) { console.warn("STA2e | warp exit:", e); }
          await new Promise(r => setTimeout(r, 300));
          await tok.document.update({ alpha: 1 });

          // Step 7 — Cleanup filters, residual glow
          try {
            await TokenMagic.deleteFilters(tok, "warpGlow");
            await TokenMagic.deleteFilters(tok, "warpCharge");
            await TokenMagic.deleteFilters(tok, "warpBlur");
            await TokenMagic.addUpdateFilters(tok, [{
              filterType: "glow", filterId: "warpResidualGlow",
              outerStrength: 5, innerStrength: 2, color: 0x00a6fb,
              quality: 0.5, padding: 10,
              animated: { outerStrength: { active: true, val1: 5, val2: 0, loops: 1, loopDuration: 1000 } }
            }]);
            setTimeout(() => { try { TokenMagic.deleteFilters(tok); } catch {} }, 1500);
          } catch(e) { console.warn("STA2e | warp cleanup:", e); }

          btn.textContent  = "✓ ENGAGED";
          btn.style.opacity = "0.5";

        } catch(err) {
          console.error("STA2e Toolkit | Warp engage error:", err);
          ui.notifications.error("Warp animation failed — see console.");
          // Ensure token is visible
          const tok2 = canvas.tokens?.get(JSON.parse(decodeURIComponent(btn.dataset.payload)).tokenId);
          if (tok2) try { await tok2.document.update({ alpha: 1 }); TokenMagic.deleteFilters(tok2); } catch {}
        }
      });
    });

    // ── FLEE button — warp to nearest edge and remove token ─────────────────
    html.querySelectorAll(".sta2e-warp-flee").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const payload = JSON.parse(decodeURIComponent(btn.dataset.payload));
          const tok     = canvas.tokens?.get(payload.tokenId);

          if (!tok) {
            ui.notifications.warn("STA2e Toolkit: Token not found on current scene — cannot run flee sequence.");
            return;
          }

          // Disable both buttons on this card
          btn.closest(".message-content")
            ?.querySelectorAll(".sta2e-warp-engage, .sta2e-warp-flee")
            .forEach(b => { b.disabled = true; b.style.opacity = "0.5"; });
          btn.textContent = "🚀 FLEEING...";

          if (game.user.isGM) {
            await runWarpFleeCard(payload);
          } else {
            game.socket.emit("module.sta2e-toolkit", {
              action: "runWarpFleeCard",
              messageId: message.id,
              requesterUserId: game.user.id,
              payload,
            });
          }

          ChatMessage.create({
            content: lcarsCard("🚀 SHIP FLED", LC.primary, `
              <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${payload.actorName ?? "Ship"}</div>
              <div style="font-size:11px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
                Has fled the battlefield and departed at warp speed.<br>
                Token removed from the current scene.
              </div>`),
            speaker: { alias: "STA2e Toolkit" },
          });
          await syncShipCardLock({ warpEngageConsumedAction: "flee" });
          return;

          const warpSound = game.settings.get("sta2e-toolkit", "sndWarpEngage") ?? "";

          // ── Compute nearest canvas edge ──────────────────────────────────
          const gridSize  = canvas.grid?.size ?? 100;
          const tokW      = (tok.document.width  ?? 1) * gridSize;
          const tokH      = (tok.document.height ?? 1) * gridSize;
          const cx        = tok.x + tokW / 2;
          const cy        = tok.y + tokH / 2;
          const sceneX    = canvas.dimensions?.sceneX      ?? 0;
          const sceneY    = canvas.dimensions?.sceneY      ?? 0;
          const sceneW    = canvas.dimensions?.sceneWidth  ?? canvas.scene.width;
          const sceneH    = canvas.dimensions?.sceneHeight ?? canvas.scene.height;

          const distLeft   = cx - sceneX;
          const distRight  = (sceneX + sceneW) - cx;
          const distTop    = cy - sceneY;
          const distBottom = (sceneY + sceneH) - cy;
          const minDist    = Math.min(distLeft, distRight, distTop, distBottom);

          // Direction target (far point for rotation angle) and off-canvas destination
          let rotTarget, fleeX, fleeY;
          const pad = tokW * 2 + 100;   // how far past the edge to place the "gone" position

          if (minDist === distLeft) {
            rotTarget = { x: sceneX - 500, y: tok.y };
            fleeX = sceneX - pad;  fleeY = tok.y;
          } else if (minDist === distRight) {
            rotTarget = { x: sceneX + sceneW + 500, y: tok.y };
            fleeX = sceneX + sceneW + pad;  fleeY = tok.y;
          } else if (minDist === distTop) {
            rotTarget = { x: tok.x, y: sceneY - 500 };
            fleeX = tok.x;  fleeY = sceneY - pad;
          } else {
            rotTarget = { x: tok.x, y: sceneY + sceneH + 500 };
            fleeX = tok.x;  fleeY = sceneY + sceneH + pad;
          }

          // Release tractor beam if this ship is involved in one
          const tractorState = CombatHUD.getTractorBeamState(tok);
          if (tractorState) {
            if (tractorState.targetTokenId) {
              // This ship is the tractoring source
              const targetTok = canvas.tokens?.get(tractorState.targetTokenId);
              await CombatHUD.releaseTractorBeam(tok, targetTok ?? null).catch(() => {});
            } else if (tractorState.sourceTokenId) {
              // This ship is being tractored — release from the source
              const sourceTok = canvas.tokens?.get(tractorState.sourceTokenId);
              if (sourceTok) await CombatHUD.releaseTractorBeam(sourceTok, tok).catch(() => {});
            }
          }

          // ── Step 1: Pre-warp glow ────────────────────────────────────────
          try {
            await TokenMagic.addUpdateFilters(tok, [{
              filterType: "glow", filterId: "warpGlow",
              outerStrength: 15, innerStrength: 5, color: 0x00a6fb,
              quality: 0.5, padding: 10,
              animated: { time: { active: true, speed: 0.01, animType: "move" } },
            }, {
              filterType: "bulgepinch", filterId: "warpCharge",
              padding: 30, strength: 0.15, radius: 200,
              animated: { strength: { active: true, val1: 0.05, val2: 0.15, speed: 0.05, animType: "cosOscillation" } },
            }]);
          } catch(e) { console.warn("STA2e | warp-flee pre-glow:", e); }
          await new Promise(r => setTimeout(r, 1500));

          // ── Step 2: Rotate toward nearest edge ───────────────────────────
          try {
            const angle         = Math.atan2(rotTarget.y - tok.y, rotTarget.x - tok.x) * (180 / Math.PI);
            const targetRotation = angle - 90;
            const orig  = tok.document.rotation || 0;
            const delta = ((targetRotation - orig + 540) % 360) - 180;
            const steps = 15;
            for (let i = 1; i <= steps; i++) {
              await tok.document.update({ rotation: orig + (delta / steps * i) });
              await new Promise(r => setTimeout(r, 20));
            }
            await tok.document.update({ rotation: targetRotation });
          } catch(e) { console.warn("STA2e | warp-flee rotate:", e); }

          // ── Step 3: Flash + blur + sound ─────────────────────────────────
          try {
            await TokenMagic.addUpdateFilters(tok, [{
              filterType: "blur", filterId: "warpBlur", padding: 10, quality: 4, blur: 10,
              animated: { blur: { active: true, val1: 0, val2: 20, speed: 0.1, animType: "ramp" } },
            }]);
            new Sequence().effect().atLocation(tok).scale(0.7).fadeIn(200).fadeOut(300).play();
            if (warpSound) new Sequence().sound().file(warpSound).volume(0.8).play();
          } catch(e) { console.warn("STA2e | warp-flee flash:", e); }
          await new Promise(r => setTimeout(r, 800));

          // ── Step 4: Animate token flying off the edge with fade ──────────
          const startX    = tok.x;
          const startY    = tok.y;
          const moveSteps = 20;
          const dxStep    = (fleeX - startX) / moveSteps;
          const dyStep    = (fleeY - startY) / moveSteps;
          for (let i = 1; i <= moveSteps; i++) {
            const alpha = Math.max(0, 1 - i / moveSteps);
            await tok.document.update({ x: startX + dxStep * i, y: startY + dyStep * i, alpha });
            await new Promise(r => setTimeout(r, 30));
          }

          // ── Step 5: Clean up filters then delete the token ───────────────
          try { await TokenMagic.deleteFilters(tok); } catch {}
          await tok.document.delete();

          ChatMessage.create({
            content: lcarsCard("🚀 FLED THE BATTLEFIELD", "#dc7800", `
              <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${payload.actorName}</div>
              <div style="font-size:11px;color:${LC.text};font-family:${LC.font};line-height:1.5;">
                Has fled the battlefield and departed at warp speed.<br>
                <span style="font-size:10px;color:#dc7800;">Token removed from scene.</span>
              </div>`),
            speaker: { alias: "STA2e Toolkit" },
          });

        } catch(err) {
          console.error("STA2e Toolkit | Warp flee error:", err);
          ui.notifications.error("Warp flee failed — see console.");
          const tok2 = canvas.tokens?.get(JSON.parse(decodeURIComponent(btn.dataset.payload)).tokenId);
          if (tok2) try { await tok2.document.update({ alpha: 1 }); TokenMagic.deleteFilters(tok2); } catch {}
        }
      });
    });
  }

  // ── Regain Power result card buttons ─────────────────────────────────────
  if (game.user.isGM && message.flags?.["sta2e-toolkit"]?.regainPowerCard) {

    // Grant Reserve Power button
    html.querySelectorAll(".sta2e-apply-reserve-power").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const payload = JSON.parse(decodeURIComponent(btn.dataset.payload));
          const tok     = canvas.tokens?.get(payload.tokenId);
          const actor   = tok?.actor ?? game.actors.get(payload.actorId);
          if (!actor) { ui.notifications.warn("Could not find actor."); return; }

          // Grant reserve power (path auto-detected from actor schema)
          await CombatHUD.grantReservePower(actor);

          btn.disabled = true;
          btn.textContent = "✓ Reserve Power Granted";
          btn.style.opacity = "0.5";
          const compBtn = btn.parentElement?.querySelector(".sta2e-apply-power-complication");
          if (compBtn) { compBtn.disabled = true; compBtn.style.opacity = "0.4"; }

          ChatMessage.create({
            content: lcarsCard("⚡ RESERVE POWER ACTIVE", LC.primary, `
              <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
              <div style="font-size:11px;color:${LC.green};font-family:${LC.font};">
                Reserve Power restored — available for Regen Shields or Reroute Power.
              </div>`),
            speaker: { alias: "STA2e Toolkit" },
          });
          game.sta2eToolkit?.combatHud?._refresh?.();
        } catch(err) {
          console.error("STA2e Toolkit | Reserve Power:", err);
          ui.notifications.error("Failed to grant reserve power — see console.");
        }
      });
    });

    // Complication button — power granted BUT a negative trait is added
    html.querySelectorAll(".sta2e-apply-power-complication").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const payload = JSON.parse(decodeURIComponent(btn.dataset.payload));
          const tok     = canvas.tokens?.get(payload.tokenId);
          const actor   = tok?.actor ?? game.actors.get(payload.actorId);
          if (!actor) { ui.notifications.warn("Could not find actor."); return; }

          // Ask which system the complication affects
          const SYSTEMS = ["communications","computers","engines","sensors","structure","weapons"];
          let capturedSystem = "engines";
          let capturedRange  = 1;

          const compResult = await foundry.applications.api.DialogV2.wait({
            window:  { title: `Regain Power — Complication` },
            content: `
              <div style="font-family:${LC.font};padding:4px 0;display:flex;flex-direction:column;gap:8px;">
                <div style="font-size:10px;color:${LC.textDim};line-height:1.5;">
                  Succeeded at Cost — Reserve Power is granted but a negative trait
                  is created representing strain on a ship system, increasing its
                  complication range.
                </div>
                <div>
                  <label style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
                    letter-spacing:0.08em;display:block;margin-bottom:4px;">Affected System</label>
                  <select id="comp-system"
                    style="width:100%;padding:4px 6px;background:${LC.panel};
                      border:1px solid ${LC.border};border-radius:2px;
                      color:${LC.text};font-family:${LC.font};font-size:11px;">
                    ${SYSTEMS.map(k => `<option value="${k}">${CombatHUD.systemLabel(k)}</option>`).join("")}
                  </select>
                </div>
                <div>
                  <label style="font-size:9px;color:${LC.textDim};text-transform:uppercase;
                    letter-spacing:0.08em;display:block;margin-bottom:4px;">
                    Complication Range Increase
                  </label>
                  <input id="comp-range" type="number" min="1" max="5" value="1"
                    style="width:60px;padding:4px 8px;background:${LC.panel};
                      border:1px solid ${LC.border};border-radius:2px;
                      color:${LC.orange};font-size:16px;font-weight:700;
                      font-family:${LC.font};text-align:center;" />
                </div>
              </div>`,
            buttons: [
              {
                action:   "apply",
                label:    "⚠ Apply Complication",
                icon:     "fas fa-exclamation-triangle",
                default:  true,
                callback: (event, b, dlg) => {
                  const el = dlg.element ?? b.closest(".app.dialog-v2");
                  capturedSystem = el?.querySelector("#comp-system")?.value ?? "engines";
                  capturedRange  = Math.max(1, parseInt(el?.querySelector("#comp-range")?.value ?? "1") || 1);
                },
              },
              { action: "cancel", label: "Cancel", icon: "fas fa-times" },
            ],
          });
          if (compResult !== "apply") return;

          // Grant reserve power (path auto-detected from actor schema)
          await CombatHUD.grantReservePower(actor);

          // Apply power strain as an injury item so it shows in the breach panel
          // and is automatically read by getSystemBreachPenalty → roller complication range
          const sysLabel = CombatHUD.systemLabel(capturedSystem);
          await CombatHUD.applyPowerStrain(actor, capturedSystem, capturedRange);

          btn.disabled = true;
          btn.textContent = "✓ Complication Applied";
          btn.style.opacity = "0.5";
          const powerBtn = btn.parentElement?.querySelector(".sta2e-apply-reserve-power");
          if (powerBtn) { powerBtn.disabled = true; powerBtn.style.opacity = "0.4"; }

          ChatMessage.create({
            content: lcarsCard("⚡ RESERVE POWER — COMPLICATION", LC.orange, `
              <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
              <div style="font-size:11px;color:${LC.green};font-family:${LC.font};margin-bottom:4px;">
                ⚡ Reserve Power restored.
              </div>
              <div style="font-size:11px;color:${LC.orange};font-family:${LC.font};margin-bottom:2px;">
                ⚠ Power Strain: ${sysLabel} (injury)
              </div>
              <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};">
                ${sysLabel} complication range increased by ${capturedRange}.
                Any task using ${sysLabel} will roll with this expanded complication range
                until the Power Strain injury is cleared.
              </div>`),
            speaker: { alias: "STA2e Toolkit" },
          });
          game.sta2eToolkit?.combatHud?._refresh?.();
        } catch(err) {
          console.error("STA2e Toolkit | Power complication:", err);
          ui.notifications.error("Failed to apply complication — see console.");
        }
      });
    });
  }

  // ── Apply Patch button (Damage Control result card) ───────────────────────
  if (game.user.isGM) {
    html.querySelectorAll(".sta2e-apply-patch").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const payload     = JSON.parse(decodeURIComponent(btn.dataset.payload));
          const token       = canvas.tokens?.get(payload.tokenId);
          const actor       = token?.actor ?? game.actors.get(payload.actorId);
          if (!actor) { ui.notifications.warn("STA2e Toolkit: Could not find actor for patch."); return; }

          btn.disabled      = true;
          btn.textContent   = "✓ Patch Applied";
          btn.style.opacity = "0.5";

          const count = payload.patchCount ?? 1;
          await CombatHUD.patchSystemBreach(actor, payload.systemKey, count);

          ChatMessage.create({
            content: lcarsCard("🔧 BREACH PATCHED", LC.green, `
              <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
              <div style="font-size:13px;font-weight:700;color:${LC.green};
                margin-bottom:4px;font-family:${LC.font};">
                ${payload.systemLabel} — ${count} breach${count !== 1 ? "es" : ""} patched
              </div>
              <div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};line-height:1.5;">
                No longer imposes Difficulty penalties. Breach${count !== 1 ? "es" : ""} remain
                on the sheet — proper repairs required outside of combat.
                A new breach on this system will undo the patch.
              </div>`),
            speaker: { alias: "STA2e Toolkit" },
          });
          ui.notifications.info(`STA2e Toolkit: ${count} ${payload.systemLabel} breach${count !== 1 ? "es" : ""} patched on ${actor.name}.`);
        } catch(err) {
          console.error("STA2e Toolkit | Apply patch error:", err);
          ui.notifications.error("Failed to apply patch — see console.");
        }
      });
    });
  }

  // ── Apply Trait button (Create Trait result card) ─────────────────────────
  if (message.flags?.["sta2e-toolkit"]?.traitResultCard) {
    // Wire potency live cost display update
    const potEl  = html.querySelector(".sta2e-trait-potency");
    const costEl = html.querySelector(".sta2e-trait-cost");
    const isNpcFlag = (() => {
      try {
        const btn = html.querySelector(".sta2e-apply-trait");
        const p = btn ? JSON.parse(decodeURIComponent(btn.dataset.payload)) : null;
        return p?.isNpc ?? false;
      } catch { return false; }
    })();
    const currency = isNpcFlag ? "Threat" : "Momentum";

    if (potEl && costEl) {
      const update = () => {
        const extra = Math.max(0, (parseInt(potEl.value) || 1) - 1);
        costEl.textContent = extra === 0
          ? "(base — no extra cost)"
          : `(costs ${extra * 2} ${currency})`;
        costEl.style.color = extra > 0
          ? "var(--sta2e-tertiary, #ffcc66)"
          : "var(--sta2e-text-dim, #888)";
      };
      potEl.addEventListener("input", update);
      potEl.addEventListener("mousedown", e => e.stopPropagation());
    }
    html.querySelector(".sta2e-trait-name")
      ?.addEventListener("mousedown", e => e.stopPropagation());
  }

  if (game.user.isGM) {
    html.querySelectorAll(".sta2e-apply-trait").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const payload  = JSON.parse(decodeURIComponent(btn.dataset.payload));
          const token    = canvas.tokens?.get(payload.tokenId);
          const actor    = token?.actor ?? game.actors.get(payload.actorId);
          if (!actor) { ui.notifications.warn("STA2e Toolkit: Could not find actor for trait."); return; }

          const controls = btn.closest(".chat-message") ?? btn.closest("div");
          const nameEl   = controls?.querySelector(".sta2e-trait-name");
          const potEl    = controls?.querySelector(".sta2e-trait-potency");
          const traitName    = nameEl?.value?.trim() ?? "";
          const traitPotency = Math.max(1, parseInt(potEl?.value ?? "1") || 1);

          if (!traitName) {
            ui.notifications.warn("STA2e Toolkit: Enter a trait name before applying.");
            return;
          }

          btn.disabled      = true;
          btn.textContent   = "✓ Trait Applied";
          btn.style.opacity = "0.5";
          if (nameEl) nameEl.disabled = true;
          if (potEl)  potEl.disabled  = true;

          const isNpc    = payload.isNpc ?? false;
          const currency = isNpc ? "Threat" : "Momentum";
          const extraCost = (traitPotency - 1) * 2;
          const costNote  = extraCost > 0 ? ` (${extraCost} ${currency} spent)` : "";
          const traitDesc = `[TRAIT — ${payload.stationLabel}] `
            + (traitPotency > 1 ? `Potency ${traitPotency}. ` : "")
            + `Invoke to assist tasks related to ${payload.stationLabel} station.`
            + (costNote ? ` ${costNote}.` : "");

          await actor.createEmbeddedDocuments("Item", [{
            name:   traitName,
            type:   "trait",
            system: { description: traitDesc, quantity: traitPotency },
          }]);

          ChatMessage.create({
            content: lcarsCard("✍️ TRAIT CREATED", LC.primary, `
              <div style="font-size:12px;font-weight:700;color:${LC.tertiary};
                margin-bottom:4px;font-family:${LC.font};">${actor.name}</div>
              <div style="font-size:14px;font-weight:700;color:${LC.text};
                margin-bottom:4px;font-family:${LC.font};">"${traitName}"</div>
              <div style="display:flex;gap:12px;font-size:10px;font-family:${LC.font};">
                <span style="color:${LC.textDim};">Station:
                  <strong style="color:${LC.text};">${payload.stationLabel}</strong></span>
                <span style="color:${LC.textDim};">Potency:
                  <strong style="color:${LC.tertiary};">${traitPotency}</strong></span>
                ${extraCost > 0 ? `<span style="color:${LC.textDim};">Cost:
                  <strong style="color:${LC.orange};">${extraCost} ${currency}</strong></span>` : ""}
              </div>`),
            speaker: { alias: "STA2e Toolkit" },
          });
          ui.notifications.info(`STA2e Toolkit: Trait "${traitName}" added to ${actor.name}.`);
        } catch(err) {
          console.error("STA2e Toolkit | Apply trait error:", err);
          ui.notifications.error("Failed to apply trait — see console.");
        }
      });

    });
  }
});


// ── Warp breach pulse animation ───────────────────────────────────────────────
// Injected once into the document head so the CSS keyframe is available.
if (!document.getElementById("sta2e-breach-pulse-style")) {
  const style = document.createElement("style");
  style.id = "sta2e-breach-pulse-style";
  style.textContent = `
    @keyframes sta2e-breach-pulse {
      from { box-shadow: 0 0 3px #ff3333; }
      to   { box-shadow: 0 0 10px #ff3333, 0 0 20px #ff000066; }
    }
  `;
  document.head.appendChild(style);
}

// ── updateCombat hook — auto-roll breach check at round start (GM only) ──────
// A round advance sets changes.round. A turn advance sets changes.turn (not round).
// We only want to fire when the round number itself ticked forward.
Hooks.on("updateCombat", async (combat, changes, options, userId) => {
  if (!game.user.isGM) return;
  // Round advances put "round" in changes; turn-only advances put "turn" in changes.
  // Bail out if this is a turn change or no round change.
  if (!("round" in changes)) return;
  if ("turn" in changes) return;   // simultaneous turn+round shouldn't trigger either
  if ((changes.round ?? 0) < 2) return; // skip round 1 (combat start)

  // Check token documents — breach state is now token-scoped, not actor-scoped
  const breachTokens = canvas.tokens?.placeables.filter(t =>
    t.document?.getFlag("sta2e-toolkit", "warpBreachImminent") === true
  ) ?? [];

  for (const token of breachTokens) {
    await new Promise(r => setTimeout(r, 600));
    await CombatHUD.rollBreachCheck(token.actor, token);
  }
});
