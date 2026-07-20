/**
 * Shared action definitions and talent checks for the STA2e combat HUD.
 */

export function hasCloakingDevice(actor) {
  return actor.items.some(i =>
    i.name.toLowerCase().includes("cloaking device")
  );
}

export function hasFastTargetingSystems(actor) {
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

export function hasChiefTacticalOfficer(actor) {
  if (!actor?.items) return false;
  const normalize = value => String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
  return actor.items.some(i => normalize(i.name) === "chief tactical officer");
}

// Attack Run: character talent — when the ship takes Attack Pattern, attacks
// against the ship do NOT reduce Difficulty. Checked on the Helm officer actor.
export function hasAttackRun(actor) {
  if (!actor) return false;
  return actor.items.some(i =>
    i.name.toLowerCase().includes("attack run")
  );
}

// Glancing Impact: character talent — when the ship succeeds at Evasive Action,
// the ship gains +2 Resistance until the start of the helm officer's next turn.
export function hasGlancingImpact(actor) {
  if (!actor) return false;
  return actor.items.some(i =>
    i.name.toLowerCase().includes("glancing impact")
  );
}

// ── Bridge Station Action Definitions ────────────────────────────────────────
// Each station has minor and major actions drawn from STA 2e Core.
// Actions with a handler key are interactive (toggle conditions, fire FX, etc.).
// Info-only actions (no key) display in the tab for reference.
export const STATION_SVG = {
  command:    "modules/sta2e-toolkit/assets/station-command.svg",
  comms:      "modules/sta2e-toolkit/assets/station-comms.svg",
  helm:       "modules/sta2e-toolkit/assets/station-helm.svg",
  navigator:  "modules/sta2e-toolkit/assets/station-navigation.svg",
  operations: "modules/sta2e-toolkit/assets/station-operations.svg",
  sensors:    "modules/sta2e-toolkit/assets/station-science.svg",
  tactical:   "modules/sta2e-toolkit/assets/station-tactical.svg",
  medical:    "modules/sta2e-toolkit/assets/station-medical.svg",
};

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
        tooltip: "Select a single energy weapon or torpedo weapon, choose a target, and make an Attack (p.306). Use the weapon buttons above to fire. Player torpedo attacks add 1 Threat; torpedo salvos add 3 Threat.",
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
export const GROUND_ACTIONS = {
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
export function _taAvailable() {
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

