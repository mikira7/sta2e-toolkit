/**
 * sta2e-toolkit | region-logic-nodes.js
 *
 * The node catalog for the Region Logic behavior. Each node is a descriptor
 * (shape documented in region-logic-graph.js); adding a feature is one more
 * `registerRegionLogicNode` call, and nothing in the runner, the behavior or
 * the sheet changes.
 *
 * Every run happens on the active GM, so a node may write any document. The
 * context a run carries:
 *
 *   ctx.event      "tokenEnter" | "tokenExit" | "manual" | "doorChange"
 *   ctx.behavior   the RegionBehavior document
 *   ctx.region     its RegionDocument
 *   ctx.token      the token that moved (null for a manual run)
 *   ctx.movement   the movement data, when there is one
 *   ctx.user       the user who moved it (the GM for a manual or door run)
 *   ctx.door       the Wall, for a door run
 *   ctx.doorEvents what the door did: "unlocked", "opened"… (region-logic-doors.js)
 *
 * A node that keeps state keys it by `behavior.id` + `node.id`, so two nodes of
 * one type on one behavior never share it.
 */

import { runSwitch, waitUntilSeen, SWITCH_DEFAULTS } from "./door-light-behavior.js";
import { resolveDestinations, runRandomTeleport, playRegionSound } from "./random-teleport-behavior.js";
import { hasUsed, useMark, startedInside, cooldownBlocked, startCooldown } from "./region-token-uses.js";
import { DOOR_EVENTS } from "./region-logic-doors.js";
import { isDisabledValue, nodeConfig } from "./region-logic-graph.js";

const MODULE = "sta2e-toolkit";
/** Behavior flag holding each node's state, e.g. `regionLogic.switches.<nodeId>`. */
export const LOGIC_STATE_FLAG = "regionLogic";
/** {[behaviorId_nodeId]: true} on a token a Once Per Token node has let through. */
export const LOGIC_USED_FLAG = "regionLogicUsed";

/** @type {Map<string, object>} */
export const REGION_LOGIC_NODES = new Map();

/** Add (or replace) a node type. */
export function registerRegionLogicNode(desc) {
  REGION_LOGIC_NODES.set(desc.type, {
    category: "action", icon: "fa-solid fa-circle", inputs: ["in"], outputs: ["out"], defaults: {},
    ...desc,
  });
}

/** The per-node key for flags kept on a token or the behavior. */
export const nodeKey = (behavior, node) => `${behavior.id}_${node.id}`;

// ── Shared pieces ────────────────────────────────────────────────────────────

export const WHO = {
  any:     "Any token",
  visible: "Any token not hidden",
  players: "Player-owned tokens",
  others:  "Tokens no player owns",
};

/** Does a token count under a WHO choice? (Shared with the toolkit nodes.) */
export function whoMatches(token, who) { return _who(token, who); }

function _who(token, who) {
  if (!token) return false;
  if (who === "players") return !!token.hasPlayerOwner;
  if (who === "others") return !token.hasPlayerOwner;
  if (who === "visible") return !token.hidden;
  return true;
}

const DISPOSITIONS = { any: "Any", friendly: "Friendly", neutral: "Neutral", hostile: "Hostile", secret: "Secret" };
const _DISPOSITION_VALUE = { friendly: 1, neutral: 0, hostile: -1, secret: -2 };

/** Other tokens inside the Region that count, the token in hand excluded. */
function _othersInside(ctx, who) {
  const self = ctx.token;
  return [...(ctx.region?.tokens ?? [])]
    .filter(t => t !== self && t.id !== self?.id && _who(t, who));
}

const _sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The target pickers the switch nodes and Check State share. */
const TARGET_FIELDS = {
  doors: { key: "doors", label: "Doors", type: "uuids", docType: "Wall", layer: "walls", noun: "door",
    filter: doc => (doc.door ?? 0) > 0 },
  lights: { key: "lights", label: "Lights", type: "uuids", docType: "AmbientLight", layer: "lighting", noun: "light" },
  sounds: { key: "sounds", label: "Ambient Sounds", type: "uuids", docType: "AmbientSound", layer: "sounds",
    noun: "sound" },
};

// ── Triggers ─────────────────────────────────────────────────────────────────

registerRegionLogicNode({
  type: "tokenEnter", label: "Token Enters", category: "trigger", icon: "fa-solid fa-right-to-bracket",
  trigger: "tokenEnter", inputs: [],
  defaults: { who: "visible", waitSeen: true, ignoreDisplace: false },
  fields: [
    { key: "who", label: "Triggered By", type: "select", choices: WHO },
    { key: "waitSeen", label: "Wait until the token is seen to cross", type: "boolean" },
    { key: "ignoreDisplace", label: "Ignore displacement (GM drags)", type: "boolean" },
  ],
  summary: c => WHO[c.who] ?? c.who,
  accepts(ctx, c) {
    if (!_who(ctx.token, c.who)) return false;
    // Moving about inside is not an entry, whatever event the path raised.
    if (startedInside(ctx.token, ctx.region, ctx.movement)) return false;
    if (c.ignoreDisplace && ctx.movement?.passed?.waypoints?.at(-1)?.action === "displace") return false;
    return true;
  },
  async run({ ctx, config }) {
    if (config.waitSeen) await waitUntilSeen(ctx.token, ctx.region, true);
    return "out";
  },
});

registerRegionLogicNode({
  type: "tokenExit", label: "Token Leaves", category: "trigger", icon: "fa-solid fa-right-from-bracket",
  trigger: "tokenExit", inputs: [],
  defaults: { who: "visible", waitSeen: true },
  fields: [
    { key: "who", label: "Triggered By", type: "select", choices: WHO },
    { key: "waitSeen", label: "Wait until the token is seen to cross", type: "boolean" },
  ],
  summary: c => WHO[c.who] ?? c.who,
  accepts: (ctx, c) => _who(ctx.token, c.who),
  async run({ ctx, config }) {
    if (!config.waitSeen) return "out";
    await waitUntilSeen(ctx.token, ctx.region, false);
    // A path that only clipped the edge ends back inside: not a departure.
    return ctx.token?.regions?.has(ctx.region) ? null : "out";
  },
});

// A trigger raised for one node at a time (the timer) names it in ctx.nodeId.
const _onlyThisNode = (ctx, _c, node) => ctx.nodeId === node.id;

registerRegionLogicNode({
  type: "timer", label: "Timer", category: "trigger", icon: "fa-solid fa-stopwatch",
  trigger: "timer", inputs: [],
  defaults: { seconds: 30, whileOccupied: true, who: "visible" },
  fields: [
    { key: "seconds", label: "Every (s)", type: "number", min: 1, max: 86400, step: 1 },
    { key: "whileOccupied", label: "Only while a token is inside", type: "boolean",
      hint: "On: the clock starts when the first token walks in and stops when the last leaves." },
    { key: "who", label: "Counting", type: "select", choices: WHO, showIf: c => c.whileOccupied },
  ],
  summary: c => `Every ${c.seconds} s${c.whileOccupied ? " while occupied" : ""}`,
  accepts: _onlyThisNode,
  run: () => "out",
});

const COMBAT_WHEN = { round: "Each new round", turn: "A token inside starts its turn" };

registerRegionLogicNode({
  type: "combatTurn", label: "Combat Round / Turn", category: "trigger", icon: "fa-solid fa-hand-fist",
  trigger: "combat", inputs: [],
  defaults: { when: "round", who: "any" },
  fields: [
    { key: "when", label: "When", type: "select", choices: COMBAT_WHEN,
      hint: "A round has no token in hand: follow it with Each Token Inside to act on everyone here." },
    { key: "who", label: "Whose Turn", type: "select", choices: WHO, showIf: c => c.when === "turn" },
  ],
  summary: c => COMBAT_WHEN[c.when] ?? c.when,
  accepts(ctx, c) {
    if (c.when === "round") return ctx.combatEvent === "round";
    // A new round also starts its first turn.
    return !!ctx.token && _who(ctx.token, c.who) && !!ctx.token.regions?.has(ctx.region);
  },
  run: () => "out",
});

export const ALERT_LEVELS = { green: "Green", blue: "Blue", yellow: "Yellow", red: "Red" };

registerRegionLogicNode({
  type: "alertChange", label: "Alert Changes", category: "trigger", icon: "fa-solid fa-triangle-exclamation",
  trigger: "alert", inputs: [],
  defaults: { to: "red" },
  fields: [{ key: "to", label: "Goes To", type: "select", choices: { any: "Any alert", ...ALERT_LEVELS } }],
  summary: c => (c.to === "any" ? "Any change" : `To ${ALERT_LEVELS[c.to] ?? c.to} Alert`),
  accepts: (ctx, c) => c.to === "any" || ctx.alert === c.to,
  run: () => "out",
});

registerRegionLogicNode({
  type: "manual", label: "Button", category: "trigger", icon: "fa-solid fa-hand-pointer",
  trigger: "manual", inputs: [],
  defaults: { label: "Activate" },
  fields: [{ key: "label", label: "Button Label", type: "text" }],
  summary: c => `“${c.label}”`,
  // A manual run names one button, by node id or by label; naming none fires them all.
  accepts: (ctx, c, node) => (!ctx.nodeId && !ctx.label) || ctx.nodeId === node.id || ctx.label === c.label,
  run: () => "out",
});

/** Does a door list name this wall? Stored UUIDs may be relative to the behavior. */
function _doorListed(list, wall, behavior) {
  return list.some(uuid => {
    if (uuid === wall.uuid) return true;
    try { return fromUuidSync(uuid, { relative: behavior }) === wall; } catch { return false; }
  });
}

registerRegionLogicNode({
  type: "doorChange", label: "Door Changes", category: "trigger", icon: "fa-solid fa-door-closed",
  trigger: "doorChange", inputs: [],
  defaults: { doors: [], when: "unlocked" },
  fields: [
    { key: "doors", label: "Doors", type: "uuids", docType: "Wall", layer: "walls", noun: "door",
      filter: doc => (doc.door ?? 0) > 0,
      hint: "None picked: any door on this Region's scene." },
    { key: "when", label: "When It Is", type: "select", choices: DOOR_EVENTS },
  ],
  summary: c => `${DOOR_EVENTS[c.when] ?? c.when} · ${c.doors?.length
    ? `${c.doors.length} door${c.doors.length === 1 ? "" : "s"}` : "any door here"}`,
  accepts(ctx, c) {
    if (!ctx.door || !ctx.doorEvents?.includes(c.when)) return false;
    if (!c.doors?.length) return ctx.door.parent === ctx.region?.parent;
    return _doorListed(c.doors, ctx.door, ctx.behavior);
  },
  run: () => "out",
});

// ── Conditions ───────────────────────────────────────────────────────────────

registerRegionLogicNode({
  type: "tokenIs", label: "Token Is", category: "condition", icon: "fa-solid fa-user-check",
  outputs: ["yes", "no"],
  defaults: { who: "any", disposition: "any" },
  fields: [
    { key: "who", label: "Owner", type: "select", choices: WHO },
    { key: "disposition", label: "Disposition", type: "select", choices: DISPOSITIONS },
  ],
  summary: c => [c.who !== "any" && WHO[c.who], c.disposition !== "any" && DISPOSITIONS[c.disposition]]
    .filter(Boolean).join(", ") || "Any token",
  run({ ctx, config }) {
    const t = ctx.token;
    if (!t || !_who(t, config.who)) return "no";
    if (config.disposition !== "any" && t.disposition !== _DISPOSITION_VALUE[config.disposition]) return "no";
    return "yes";
  },
});

registerRegionLogicNode({
  type: "regionEmpty", label: "Nobody Else Inside", category: "condition", icon: "fa-solid fa-users-slash",
  outputs: ["yes", "no"],
  defaults: { who: "visible" },
  fields: [{ key: "who", label: "Counting", type: "select", choices: WHO }],
  summary: c => `Counting: ${WHO[c.who] ?? c.who}`,
  run: ({ ctx, config }) => (_othersInside(ctx, config.who).length ? "no" : "yes"),
});

registerRegionLogicNode({
  type: "tokenInside", label: "Token Still Inside", category: "condition", icon: "fa-solid fa-location-crosshairs",
  outputs: ["yes", "no"],
  run({ ctx }) {
    const t = ctx.token;
    if (!t || t.parent?.tokens?.get(t.id) !== t) return "no";   // gone
    return t.regions?.has(ctx.region) ? "yes" : "no";
  },
});

registerRegionLogicNode({
  type: "chance", label: "Random Chance", category: "condition", icon: "fa-solid fa-dice",
  outputs: ["yes", "no"],
  defaults: { percent: 50 },
  fields: [{ key: "percent", label: "Chance (%)", type: "number", min: 0, max: 100, step: 1 }],
  summary: c => `${c.percent}%`,
  run: ({ config }) => (Math.random() * 100 < Number(config.percent) ? "yes" : "no"),
});

registerRegionLogicNode({
  type: "oncePerToken", label: "Once Per Token", category: "condition", icon: "fa-solid fa-1",
  outputs: ["first", "again"],
  summary: () => "First visit, or again",
  async run({ ctx, node }) {
    const token = ctx.token;
    if (!token) return "first";   // a button press has no token to mark
    const key = nodeKey(ctx.behavior, node);
    if (hasUsed(token, LOGIC_USED_FLAG, key)) return "again";
    try { await token.update(useMark(LOGIC_USED_FLAG, key)); }
    catch (err) { console.warn("STA2e Toolkit | Region Logic: could not mark token", err); }
    return "first";
  },
});

registerRegionLogicNode({
  type: "cooldown", label: "Cooldown", category: "condition", icon: "fa-solid fa-hourglass-half",
  outputs: ["ready", "blocked"],
  defaults: { seconds: 10, who: "visible" },
  fields: [
    { key: "seconds", label: "Seconds", type: "number", min: 0, max: 3600, step: 1 },
    { key: "who", label: "Region empties of", type: "select", choices: WHO },
  ],
  summary: c => `${c.seconds} s, then until empty`,
  run({ ctx, node, config }) {
    const seconds = Number(config.seconds) || 0;
    if (!(seconds > 0)) return "ready";
    const counts = t => _who(t, config.who);
    if (cooldownBlocked(ctx.behavior, ctx.token, counts, node.id)) return "blocked";
    startCooldown(ctx.behavior, seconds, node.id);
    return "ready";
  },
});

// Several tokens entering together start several runs at once, and a flag
// write takes a round trip: every run read the old state before the first write
// landed, so two tokens both found a Switch off, or both got past a node an
// earlier one had just disabled. A pending write is therefore held here from
// the moment it is asked for until the update resolves, and the readers below
// look here first — the same trick as the cooldown's `_local`.
const _pendingSwitch = new Map();     // `${behavior.uuid}#${nodeId}` → boolean
const _pendingDisabled = new Map();   // `${behavior.uuid}#${nodeId}` → flag value

const _pendingKey = (behavior, nodeId) => `${behavior?.uuid}#${nodeId}`;

/** Write a flag update with its values held in `pending` until it lands. */
async function _heldUpdate(behavior, pending, entries, update) {
  for (const [key, value] of entries) pending.set(key, value);
  try { await behavior.update(update); }
  finally { for (const [key, value] of entries) if (pending.get(key) === value) pending.delete(key); }
}

/**
 * Set a Switch node's remembered state. It lives where the door and light
 * switches keep theirs (`regionLogic.switches.<nodeId>.active`), so the
 * canvas badge, isLogicSwitchOn and the sheet panel read it with no special case.
 */
export async function setLogicSwitch(behavior, nodeId, active) {
  await _heldUpdate(behavior, _pendingSwitch, [[_pendingKey(behavior, nodeId), !!active]],
    { [`flags.${MODULE}.${LOGIC_STATE_FLAG}.switches.${nodeId}.active`]: !!active });
}

registerRegionLogicNode({
  type: "latch", label: "Switch", category: "condition", icon: "fa-solid fa-toggle-on",
  switchState: true,
  inputs: ["on", "off", "toggle", "check"],
  outputs: ["set", "yes", "no"],
  summary: () => "Remembers on or off",
  async run({ ctx, node, input }) {
    const on = isLogicSwitchOn(ctx.behavior, node.id);
    if (input === "check") return on ? "yes" : "no";
    const next = input === "on" ? true : input === "off" ? false : !on;
    if (next !== on) await setLogicSwitch(ctx.behavior, node.id, next);
    return "set";
  },
});

/**
 * Lets one token through and blocks everyone after it until it re-arms — for a
 * group walking in together, where every token raises its own Token Enters.
 * The claim is made synchronously, before anything awaits, so tokens arriving
 * in the same instant cannot both pass. Its state is a switch (`active` = used),
 * so it shows on the canvas and the sheet like one.
 *
 * Re-arm: when the Region has emptied (a Token Leaves that leaves nobody
 * counting inside — rearmFirstOnlyOnExit, called from the behavior), after a
 * number of seconds, or only by its own `reset` input, the editor's Re-arm key
 * or Reset on the sheet.
 */
const FIRST_REARM = {
  empty:   "When the Region empties",
  seconds: "After a number of seconds",
  never:   "Only when reset",
};

registerRegionLogicNode({
  type: "firstOnly", label: "First Token Only", category: "condition", icon: "fa-solid fa-person-walking-arrow-right",
  switchState: true, stateWords: ["USED", "ARMED"],
  inputs: ["in", "reset"],
  outputs: ["first", "blocked"],
  defaults: { rearm: "empty", who: "visible", seconds: 30 },
  fields: [
    { key: "rearm", label: "Re-arm", type: "select", choices: FIRST_REARM,
      hint: "Its Reset input, the Re-arm key here and Reset on the sheet re-arm it whatever this says." },
    { key: "who", label: "Region empties of", type: "select", choices: WHO, showIf: c => c.rearm === "empty" },
    { key: "seconds", label: "Seconds", type: "number", min: 1, max: 86400, step: 1,
      showIf: c => c.rearm === "seconds" },
  ],
  summary: c => (c.rearm === "seconds" ? `Re-arms after ${c.seconds} s` : FIRST_REARM[c.rearm] ?? c.rearm),
  async run({ ctx, node, config, input }) {
    const behavior = ctx.behavior;
    if (input === "reset") {
      if (isLogicSwitchOn(behavior, node.id)) await setLogicSwitch(behavior, node.id, false);
      return null;
    }
    if (isLogicSwitchOn(behavior, node.id)) {
      const at = Number(behavior.getFlag(MODULE, LOGIC_STATE_FLAG)?.switches?.[node.id]?.at) || 0;
      const expired = config.rearm === "seconds" && at && Date.now() - at >= (Number(config.seconds) || 0) * 1000;
      if (!expired) return "blocked";
    }
    // No await between the check above and this claim: _heldUpdate marks it
    // pending before it awaits, so a run arriving in the same instant is blocked.
    const path = `flags.${MODULE}.${LOGIC_STATE_FLAG}.switches.${node.id}`;
    await _heldUpdate(behavior, _pendingSwitch, [[_pendingKey(behavior, node.id), true]],
      { [`${path}.active`]: true, [`${path}.at`]: Date.now() });
    return "first";
  },
});

/**
 * Asks what a picked door, light, ambient sound or tile is doing right now —
 * "is the vault door still locked?" before posting a Task Roll — and leaves by
 * yes or no. It reads the documents as they stand, so a door the GM unlocked by
 * hand counts as unlocked. Several targets are combined by `match`.
 */
const CHECK_KINDS = { doors: "Door", lights: "Light", sounds: "Ambient Sound", tiles: "Tile" };
const CHECK_STATES = {
  doors:  { locked: "Locked", closed: "Closed (not locked)", shut: "Closed or locked", open: "Open" },
  lights: { on: "On", off: "Off" },
  sounds: { on: "On", off: "Off" },
  tiles:  { visible: "Visible", hidden: "Hidden" },
};
// Core's WALL_DOOR_STATES: CLOSED 0, OPEN 1, LOCKED 2.
const _DOOR_TEST = { locked: ds => ds === 2, closed: ds => ds === 0, shut: ds => ds !== 1, open: ds => ds === 1 };

/** Does one document show the asked-for state? */
export function docInState(kind, doc, state) {
  if (!doc) return false;
  if (kind === "doors") return !!_DOOR_TEST[state]?.(doc.ds ?? 0);
  if (kind === "tiles") return state === "hidden" ? !!doc.hidden : !doc.hidden;
  return state === "off" ? !!doc.hidden : !doc.hidden;   // lights and sounds
}

const CHECK_TARGETS = {
  ...TARGET_FIELDS,
  tiles: { key: "tiles", label: "Tiles", type: "uuids", docType: "Tile", layer: "tiles", noun: "tile" },
};

registerRegionLogicNode({
  type: "stateIs", label: "Check State", category: "condition", icon: "fa-solid fa-magnifying-glass",
  outputs: ["yes", "no"],
  defaults: { kind: "doors", doors: [], lights: [], sounds: [], tiles: [],
    doorState: "locked", lightState: "on", soundState: "on", tileState: "visible", match: "all" },
  fields: [
    { key: "kind", label: "Check", type: "select", choices: CHECK_KINDS },
    ...Object.entries(CHECK_TARGETS).map(([kind, f]) => ({ ...f, showIf: c => c.kind === kind })),
    { key: "doorState", label: "Is", type: "select", choices: CHECK_STATES.doors, showIf: c => c.kind === "doors" },
    { key: "lightState", label: "Is", type: "select", choices: CHECK_STATES.lights, showIf: c => c.kind === "lights" },
    { key: "soundState", label: "Is", type: "select", choices: CHECK_STATES.sounds, showIf: c => c.kind === "sounds" },
    { key: "tileState", label: "Is", type: "select", choices: CHECK_STATES.tiles, showIf: c => c.kind === "tiles" },
    { key: "match", label: "With several picked", type: "select",
      choices: { all: "Yes when all of them are", any: "Yes when any of them is" } },
  ],
  summary(c) {
    const state = _checkState(c);
    const n = c[c.kind]?.length ?? 0;
    const what = n ? `${n} ${(CHECK_KINDS[c.kind] ?? c.kind).toLowerCase()}${n === 1 ? "" : "s"}` : "Nothing picked";
    return `${what} ${n > 1 ? (c.match === "any" ? "any " : "all ") : ""}${CHECK_STATES[c.kind]?.[state] ?? state}`;
  },
  run({ ctx, config }) {
    const state = _checkState(config);
    const docs = (config[config.kind] ?? []).map(uuid => {
      try { return fromUuidSync(uuid, { relative: ctx.behavior }); } catch { return null; }
    }).filter(Boolean);
    if (!docs.length) return "no";
    const test = d => docInState(config.kind, d, state);
    return (config.match === "any" ? docs.some(test) : docs.every(test)) ? "yes" : "no";
  },
});

function _checkState(c) {
  return { doors: c.doorState, lights: c.lightState, sounds: c.soundState, tiles: c.tileState }[c.kind];
}

/**
 * A token left the Region: re-arm every First Token Only node set to re-arm
 * when it empties, if nobody counting is left inside. Active GM only.
 */
export async function rearmFirstOnlyOnExit(behavior, graph, leaving) {
  for (const node of graph.nodes) {
    if (node.type !== "firstOnly" || !isLogicSwitchOn(behavior, node.id)) continue;
    const config = nodeConfig(node, REGION_LOGIC_NODES.get("firstOnly"));
    if (config.rearm !== "empty") continue;
    const inside = [...(behavior.parent?.tokens ?? [])]
      .some(t => t !== leaving && t.id !== leaving?.id && _who(t, config.who));
    if (!inside) await setLogicSwitch(behavior, node.id, false);
  }
}

// ── Enabling and disabling nodes ─────────────────────────────────────────────
//
// A disabled node is skipped: a disabled trigger never fires, and a branch that
// reaches a disabled node stops there. The state is the behavior flag
// `regionLogic.disabled.<nodeId>`: true (until enabled again) or the time it
// re-enables itself (isDisabledValue in region-logic-graph.js).

/** Is this node disabled right now? */
export function isNodeDisabled(behavior, nodeId) {
  const key = _pendingKey(behavior, nodeId);
  if (_pendingDisabled.has(key)) return isDisabledValue(_pendingDisabled.get(key));
  return isDisabledValue(behavior?.getFlag(MODULE, LOGIC_STATE_FLAG)?.disabled?.[nodeId]);
}

/** When a timed disable ends (ms), or null when it is not timed. */
export function nodeDisabledUntil(behavior, nodeId) {
  const v = behavior?.getFlag(MODULE, LOGIC_STATE_FLAG)?.disabled?.[nodeId];
  return typeof v === "number" && v > Date.now() ? v : null;
}

/**
 * Disable or enable nodes in one write. `seconds` > 0 makes a disable timed.
 * Enabling writes false rather than deleting, which an update merges cleanly.
 */
export async function setNodesDisabled(behavior, nodeIds, disabled, seconds = 0) {
  const value = disabled ? (seconds > 0 ? Date.now() + seconds * 1000 : true) : false;
  const update = {};
  for (const id of nodeIds) update[`flags.${MODULE}.${LOGIC_STATE_FLAG}.disabled.${id}`] = value;
  if (!nodeIds.length) return;
  await _heldUpdate(behavior, _pendingDisabled, nodeIds.map(id => [_pendingKey(behavior, id), value]), update);
}

registerRegionLogicNode({
  type: "toggleNodes", label: "Enable / Disable", category: "action", icon: "fa-solid fa-power-off",
  inputs: ["disable", "enable", "toggle"],
  defaults: { nodes: [], seconds: 0 },
  fields: [
    { key: "nodes", label: "Nodes", type: "nodes",
      hint: "A disabled trigger does not fire, and a flow that reaches a disabled node stops there." },
    { key: "seconds", label: "Re-enable After (s)", type: "number", min: 0, max: 86400, step: 1,
      hint: "Disable only. 0 keeps them disabled until something enables them — this node's Enable "
        + "input, the node's own Enable key in the editor, or Reset on the sheet." },
  ],
  summary(c) {
    const n = c.nodes?.length ?? 0;
    if (!n) return "No nodes picked";
    return `${n} node${n === 1 ? "" : "s"}${Number(c.seconds) > 0 ? ` · ${c.seconds} s` : ""}`;
  },
  async run({ ctx, config, input }) {
    const ids = (config.nodes ?? []).filter(Boolean);
    if (input === "toggle") {
      // Each one flips on its own, so a mixed set swaps over rather than lining up.
      const off = ids.filter(id => isNodeDisabled(ctx.behavior, id));
      const on = ids.filter(id => !off.includes(id));
      await setNodesDisabled(ctx.behavior, off, false);
      await setNodesDisabled(ctx.behavior, on, true, Number(config.seconds) || 0);
    } else {
      await setNodesDisabled(ctx.behavior, ids, input === "disable", Number(config.seconds) || 0);
    }
    return "out";
  },
});

// ── Flow ─────────────────────────────────────────────────────────────────────

registerRegionLogicNode({
  type: "wait", label: "Wait", category: "flow", icon: "fa-solid fa-clock",
  defaults: { ms: 1000 },
  fields: [{ key: "ms", label: "Milliseconds", type: "number", min: 0, max: 600000, step: 100 }],
  summary: c => `${(Number(c.ms) / 1000).toLocaleString()} s`,
  async run({ config }) {
    const ms = Math.max(0, Number(config.ms) || 0);
    if (ms) await _sleep(ms);
    return "out";
  },
});

registerRegionLogicNode({
  type: "eachToken", label: "Each Token Inside", category: "flow", icon: "fa-solid fa-users",
  outputs: ["each", "none", "done"],
  defaults: { who: "visible" },
  fields: [{ key: "who", label: "Counting", type: "select", choices: WHO,
    hint: "Runs what follows once per token, one after another, each acting on its own token. "
      + "Who is inside is taken when this node runs. After All fires once, when every token is done." }],
  summary: c => WHO[c.who] ?? c.who,
  run({ ctx, config }) {
    const tokens = [...(ctx.region?.tokens ?? [])].filter(t => _who(t, config.who));
    if (!tokens.length) return "none";
    // One branch per token, each with its own context: the runner follows
    // them in order, and a teleport's `ctx.token = landed` stays in its branch.
    // "done" comes last, and the runner follows ports in order, so it fires only
    // once every token's branch has finished — the place to disable a node that
    // each token still needs (disabling it inside the loop would stop at the first).
    return [...tokens.map(token => ({ port: "each", ctx: { ...ctx, token, movement: null } })), "done"];
  },
});

const PICK_PORTS = ["1", "2", "3", "4"];

registerRegionLogicNode({
  type: "pickOne", label: "Pick One", category: "flow", icon: "fa-solid fa-shuffle",
  outputs: PICK_PORTS,
  defaults: { count: 2 },
  fields: [{ key: "count", label: "Choose Among", type: "number", min: 2, max: 4, step: 1,
    hint: "Leaves by one of the first N outputs, at random, each as likely as the others." }],
  summary: c => `1 of ${_pickCount(c)}`,
  run: ({ config }) => PICK_PORTS[Math.floor(Math.random() * _pickCount(config))],
});

function _pickCount(c) { return Math.min(4, Math.max(2, Math.round(Number(c.count) || 2))); }

registerRegionLogicNode({
  type: "untilEmpty", label: "Wait Until Empty", category: "flow", icon: "fa-solid fa-door-open",
  outputs: ["out", "timeout"],
  defaults: { who: "visible", seconds: 0 },
  fields: [
    { key: "who", label: "Counting", type: "select", choices: WHO },
    { key: "seconds", label: "Give Up After (s)", type: "number", min: 0, max: 86400, step: 1,
      hint: "0 waits for as long as it takes. Giving up leaves by Timed Out." },
  ],
  summary: c => (Number(c.seconds) > 0 ? `Up to ${c.seconds} s` : "However long it takes"),
  async run({ ctx, config }) {
    const limit = Number(config.seconds) > 0 ? Date.now() + Number(config.seconds) * 1000 : Infinity;
    const occupied = () => [...(ctx.region?.tokens ?? [])].some(t => _who(t, config.who));
    while (occupied()) {
      if (Date.now() >= limit) return "timeout";
      await _sleep(500);
    }
    return "out";
  },
});

// ── Counting ─────────────────────────────────────────────────────────────────

const _pendingCount = new Map();   // `${behavior.uuid}#${nodeId}` → number

/** A Counter node's count. */
export function logicCounterValue(behavior, nodeId) {
  const key = _pendingKey(behavior, nodeId);
  if (_pendingCount.has(key)) return _pendingCount.get(key);
  return Number(behavior?.getFlag(MODULE, LOGIC_STATE_FLAG)?.counters?.[nodeId]) || 0;
}

/** Set a Counter node's count, held until the write lands (see _heldUpdate). */
export async function setLogicCounter(behavior, nodeId, value) {
  await _heldUpdate(behavior, _pendingCount, [[_pendingKey(behavior, nodeId), value]],
    { [`flags.${MODULE}.${LOGIC_STATE_FLAG}.counters.${nodeId}`]: value });
}

registerRegionLogicNode({
  type: "counter", label: "Counter", category: "condition", icon: "fa-solid fa-list-ol",
  inputs: ["in", "reset"],
  outputs: ["reached", "below"],
  defaults: { target: 3, resetOnReach: true },
  fields: [
    { key: "target", label: "Count To", type: "number", min: 1, max: 999, step: 1 },
    { key: "resetOnReach", label: "Start again from 0 when reached",  type: "boolean",
      hint: "On: every Nth pass leaves by Reached. Off: Reached once the count gets there, and every pass after." },
  ],
  summary: c => `${c.target}${c.resetOnReach ? ", then again" : ""}`,
  describeState: (behavior, node, c) => `Count ${logicCounterValue(behavior, node.id)} of ${c.target}`,
  async run({ ctx, node, config, input }) {
    if (input === "reset") { await setLogicCounter(ctx.behavior, node.id, 0); return null; }
    // Read and write with no await between, so tokens arriving together each count.
    const n = logicCounterValue(ctx.behavior, node.id) + 1;
    const reached = n >= (Number(config.target) || 1);
    await setLogicCounter(ctx.behavior, node.id, reached && config.resetOnReach ? 0 : n);
    return reached ? "reached" : "below";
  },
});

registerRegionLogicNode({
  type: "inCombat", label: "In Combat", category: "condition", icon: "fa-solid fa-shield-halved",
  outputs: ["yes", "no"],
  summary: () => "A combat is running on this scene",
  run({ ctx }) {
    const scene = ctx.region?.parent;
    const running = (game.combats ?? []).some(c => c.started && (!c.scene || c.scene === scene));
    return running ? "yes" : "no";
  },
});

// ── Task rolls ───────────────────────────────────────────────────────────────

const ATTRIBUTES = { control: "Control", daring: "Daring", fitness: "Fitness",
  insight: "Insight", presence: "Presence", reason: "Reason" };
const DISCIPLINES = { command: "Command", conn: "Conn", engineering: "Engineering",
  medicine: "Medicine", science: "Science", security: "Security" };

/**
 * Posts a Task Maker request card for the token in hand and STOPS — the run
 * cannot wait on a player for minutes in memory. The card carries
 * {behaviorUuid, nodeId, tokenUuid} through the roller into the Working Results
 * card's rollData (`regionLogicContext`), and when that card is confirmed the
 * active GM picks the flow up from this node's pass or fail port
 * (resumeRegionLogicTask in region-logic-behavior.js). So it survives a reload,
 * and anyone may roll it, not just the client that posted it.
 */
registerRegionLogicNode({
  type: "taskRoll", label: "Task Roll", category: "condition", icon: "fa-solid fa-dice-d20",
  outputs: ["pass", "fail"],
  defaults: { taskName: "Bypass the Lock", flavor: "", attrKey: "control", discKey: "engineering",
    difficulty: 2, complicationRange: 1 },
  fields: [
    { key: "taskName", label: "Task", type: "text" },
    { key: "flavor", label: "Description", type: "text" },
    { key: "attrKey", label: "Attribute", type: "select", choices: ATTRIBUTES },
    { key: "discKey", label: "Discipline", type: "select", choices: DISCIPLINES },
    { key: "difficulty", label: "Difficulty", type: "number", min: 0, max: 5, step: 1 },
    { key: "complicationRange", label: "Complication Range", type: "number", min: 1, max: 5, step: 1,
      hint: "Posts a task card for the token that started this flow (or the one Each Token Inside "
        + "hands it). The flow goes on from Pass or Fail once that roll is confirmed. A flow with "
        + "no token — a button, a door — posts nothing." },
  ],
  summary: c => `${ATTRIBUTES[c.attrKey] ?? c.attrKey} + ${DISCIPLINES[c.discKey] ?? c.discKey} · D${c.difficulty}`,
  async run({ ctx, node, config }) {
    const token = ctx.token;
    const actorId = token?.actorId ?? token?.actor?.id;
    if (!actorId) {
      console.warn(`STA2e Toolkit | Region Logic Task Roll (${node.id}): no token to roll for.`);
      return null;
    }
    const { postTaskRequestCard } = await import("./task-maker.js");
    await postTaskRequestCard({
      mode: "task", actorId, tokenId: token.id,
      taskName: config.taskName || "Task", flavor: config.flavor ?? "",
      attrKey: config.attrKey, discKey: config.discKey,
      difficulty: Number(config.difficulty) || 0, complicationRange: Number(config.complicationRange) || 1,
      regionLogic: { behaviorUuid: ctx.behavior.uuid, nodeId: node.id, tokenUuid: token.uuid },
    });
    return null;   // resumed from the confirmed card
  },
});

// ── Actions ──────────────────────────────────────────────────────────────────

// ── Field lists ──────────────────────────────────────────────────────────────
//
// A field is {key, label, type, hint?, showIf?(config), ...}. key is a dotted
// path into the node's config. Types: text, number (min/max/step, nullable),
// boolean, select (choices: an object or a function returning one; a "" key is
// the blank option; nullable stores null for it), audio, color (nullable),
// uuids (docType, layer, noun, filter?), and heading, which has no key. The
// editor renders them; nothing here touches the DOM.

function _animationChoices(blank) {
  const out = { "": blank, none: "None" };
  for (const [key, cfg] of Object.entries(CONFIG.Canvas?.lightAnimations ?? {})) {
    out[key] = game.i18n.localize(cfg.label ?? key);
  }
  return out;
}

function _transitionChoices() {
  const out = { "": game.i18n.localize("COMMON.None") };
  for (const [key, value] of Object.entries(CONFIG.Canvas?.sceneTransitions ?? {})) {
    out[key] = game.i18n.localize(value.label ?? `SCENE.Transition.Types.${key}`);
  }
  return out;
}

/**
 * The When Switched On / Off rows. `kinds` limits them to the targets a node
 * holds, so a Doors node shows no light colour.
 */
function _stateFields(side, kinds = ["doors", "lights", "sounds"]) {
  const blank = side === "on" ? "No change" : "Restore";
  const onOff = { "": "No change", on: "On", off: "Off" };
  const has = k => kinds.includes(k);
  return [
    { type: "heading", label: side === "on" ? "When Switched On" : "When Switched Off" },
    has("doors") && { key: `${side}.door`, label: "Doors", type: "select",
      choices: { "": "No change", open: "Open", closed: "Closed", locked: "Locked" } },
    has("lights") && { key: `${side}.light`, label: "Lights", type: "select", choices: onOff },
    has("sounds") && { key: `${side}.sound`, label: "Ambient Sounds", type: "select", choices: onOff },
    has("lights") && { key: `${side}.color`, label: "Light Colour", type: "color",
      hint: side === "on" ? "Blank leaves each light's colour alone." : "Blank restores the colour it had." },
    has("lights") && { key: `${side}.alpha`, label: "Colour Intensity", type: "number", min: 0, max: 1, step: 0.05,
      nullable: true, hint: side === "on" ? "0–1. Blank leaves it alone." : "0–1. Blank restores it." },
    has("lights") && { key: `${side}.animation`, label: "Light Animation", type: "select",
      choices: () => _animationChoices(blank) },
  ].filter(Boolean);
}

function _switchFields(kinds = ["doors", "lights", "sounds"], { waitField = false } = {}) {
  return [
    { type: "heading", label: "Targets" },
    ...kinds.map(k => TARGET_FIELDS[k]),
    ..._stateFields("on", kinds),
    ..._stateFields("off", kinds),
    { type: "heading", label: "Sequence" },
    { key: "sequence.startDelay", label: "Start Delay (ms)", type: "number", min: 0, max: 30000, step: 100,
      hint: "Switching on: wait this long before the first change." },
    { key: "sequence.endDelay", label: "End Delay (ms)", type: "number", min: 0, max: 60000, step: 100,
      hint: "Switching off: wait this long first. A token coming back in cancels the switch-off." },
    { key: "sequence.stepDelay", label: "Delay Between Each (ms)", type: "number", min: 0, max: 10000, step: 50,
      hint: "0 changes everything at once." },
    { key: "sequence.grouping", label: "Grouping", type: "select",
      choices: { count: "Items Per Step", tagged: "Sequence Group numbers" },
      showIf: c => Number(c.sequence?.stepDelay) > 0 },
    { key: "sequence.perStep", label: "Items Per Step", type: "number", min: 1, max: 20, step: 1,
      showIf: c => Number(c.sequence?.stepDelay) > 0 && c.sequence?.grouping !== "tagged" },
    { key: "sequence.offTiming", label: "Switching Off", type: "select",
      choices: { sequence: "Same sequence", instant: "All at once" },
      showIf: c => Number(c.sequence?.stepDelay) > 0 },
    { key: "sequence.order", label: "Sequence Order", type: "select",
      choices: { forward: "List order", reverseOff: "Reversed when off", random: "Random" },
      showIf: c => Number(c.sequence?.stepDelay) > 0 },
    waitField && { key: "waitDone", label: "Wait for it to finish before going on", type: "boolean",
      hint: "Off: the next node starts as soon as this one does, so doors and lights wired from one "
        + "port switch together. On: the next node waits for the whole sequence." },
  ].filter(Boolean);
}

/** A switch node as runSwitch's host, its state under the behavior flag. */
function _switchHost(ctx, node, config) {
  const behavior = ctx.behavior;
  const path = `flags.${MODULE}.${LOGIC_STATE_FLAG}.switches.${node.id}`;
  return {
    key: `${behavior.uuid}#${node.id}`,
    relative: behavior,
    config,
    read: () => behavior.getFlag(MODULE, LOGIC_STATE_FLAG)?.switches?.[node.id],
    write: raw => behavior.update({ [path]: raw }),
  };
}

/** Is a Region Logic switch node (Doors, Lights, Ambient Sounds, or the combined one) on? */
export function isLogicSwitchOn(behavior, nodeId) {
  const key = _pendingKey(behavior, nodeId);
  if (_pendingSwitch.has(key)) return _pendingSwitch.get(key);
  return !!behavior?.getFlag(MODULE, LOGIC_STATE_FLAG)?.switches?.[nodeId]?.active;
}

/** How a switch-state node names its state: ON / OFF, or the node's own `stateWords`. */
export function switchStateWord(desc, on) {
  const [yes, no] = desc?.stateWords ?? ["ON", "OFF"];
  return on ? yes : no;
}

/**
 * A token entering or leaving skips a switch already in the state it asks for:
 * presence flows send "on" for every token that walks in. Anything deliberate —
 * a button, a door, a passed Task Roll — re-applies it, which also re-asserts a
 * state someone changed by hand (a door the GM relocked while the node still
 * reads "on").
 */
const _skipIfSame = ctx => ctx.event === "tokenEnter" || ctx.event === "tokenExit";

const _plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const _wantFrom = input => (input === "on" ? true : input === "off" ? false : "toggle");

// The combined node: what Convert builds, and what flows made before the split
// hold. It stays registered so they keep working, but is left out of the
// palette (`hidden`). It always waits for its sequence, as the classic
// behavior does, and its doors, lights and sounds share one sequence — the
// only way Sequence Group numbers can step across kinds.
registerRegionLogicNode({
  type: "switch", label: "Doors, Lights & Sounds", category: "action", icon: "fa-solid fa-lightbulb",
  hidden: true, switchState: true,
  inputs: ["on", "off", "toggle"],
  defaults: SWITCH_DEFAULTS,
  fields: _switchFields(),
  summary(c) {
    const n = k => (c[k]?.length ?? 0);
    const parts = [n("doors") && _plural(n("doors"), "door"), n("lights") && _plural(n("lights"), "light"),
      n("sounds") && _plural(n("sounds"), "sound")].filter(Boolean);
    return parts.join(", ") || "Nothing picked";
  },
  async run({ ctx, node, config, input }) {
    await runSwitch(_switchHost(ctx, node, config), _wantFrom(input), { onlyIfChanged: _skipIfSame(ctx) });
    return "out";
  },
});

/**
 * One node per kind of target. Each keeps its own on / off state and queue, so
 * the lights can follow a different trigger from the doors. The other two
 * target lists are emptied before switching, so a config carried over from
 * the combined node can never reach past its own kind.
 */
function _registerKindSwitch({ type, label, icon, kind, noun }) {
  const blankLists = { doors: [], lights: [], sounds: [] };
  registerRegionLogicNode({
    type, label, category: "action", icon, switchState: true,
    inputs: ["on", "off", "toggle"],
    defaults: { ...SWITCH_DEFAULTS, waitDone: false },
    fields: _switchFields([kind], { waitField: true }),
    summary: c => (c[kind]?.length ? _plural(c[kind].length, noun) : `No ${noun}s picked`),
    async run({ ctx, node, config, input }) {
      const cfg = { ...config, ...blankLists, [kind]: config[kind] ?? [] };
      const done = runSwitch(_switchHost(ctx, node, cfg), _wantFrom(input), { onlyIfChanged: _skipIfSame(ctx) });
      if (config.waitDone) await done;
      else done.catch(err => console.error(`STA2e Toolkit | Region Logic: ${label} node (${node.id}) failed`, err));
      return "out";
    },
  });
}

_registerKindSwitch({ type: "doors", label: "Doors", icon: "fa-solid fa-door-open", kind: "doors", noun: "door" });
_registerKindSwitch({ type: "lights", label: "Lights", icon: "fa-solid fa-lightbulb", kind: "lights", noun: "light" });
_registerKindSwitch({ type: "ambientSounds", label: "Ambient Sounds", icon: "fa-solid fa-music", kind: "sounds",
  noun: "sound" });

registerRegionLogicNode({
  type: "teleport", label: "Random Teleport", category: "action", icon: "fa-solid fa-shuffle",
  defaults: {
    destinations: [], placement: "random", snap: true, avoidOccupied: true, noRepeat: true, delay: 0,
    departSound: "", arriveSound: "", soundVolume: 0.8, soundAudience: "all",
    transition: { type: null, duration: 1500 },
  },
  fields: [
    { key: "destinations", label: "Destinations", type: "uuids", docType: "Region", layer: "regions", noun: "Region",
      hint: "Select Regions on the canvas and press Add Selected, or paste a Region's UUID — it may be on "
        + "another scene. A destination's Teleport Weight (its own Region Config) makes it more likely." },
    { key: "placement", label: "Placement", type: "select", choices: {
      random:   "BEHAVIOR.TYPES.teleportToken.PLACEMENTS.random.label",
      center:   "BEHAVIOR.TYPES.teleportToken.PLACEMENTS.center.label",
      relative: "BEHAVIOR.TYPES.teleportToken.PLACEMENTS.relative.label",
    } },
    { key: "snap", label: "Snap to Grid", type: "boolean" },
    { key: "avoidOccupied", label: "Avoid Occupied", type: "boolean",
      hint: "Skip destinations that already hold a token, unless every one does." },
    { key: "noRepeat", label: "No Repeat", type: "boolean",
      hint: "Never send a token where this node sent it last time, unless it is the only one left." },
    { key: "delay", label: "Teleport Delay (ms)", type: "number", min: 0, max: 30000, step: 100 },
    { type: "heading", label: "Sound" },
    { key: "departSound", label: "Departure Sound", type: "audio" },
    { key: "arriveSound", label: "Arrival Sound", type: "audio" },
    { key: "soundVolume", label: "Volume", type: "number", min: 0, max: 1, step: 0.05 },
    { key: "soundAudience", label: "Who Hears It", type: "select",
      choices: { all: "Everyone", owners: "The token's owners" } },
    { type: "heading", label: "Another Scene" },
    { key: "transition.type", label: "Transition", type: "select", nullable: true, choices: _transitionChoices },
    { key: "transition.duration", label: "Transition (ms)", type: "number", min: 0, max: 10000, step: 100 },
  ],
  summary: c => `${c.destinations?.length ?? 0} destination${c.destinations?.length === 1 ? "" : "s"}`,
  async run({ ctx, node, config }) {
    if (!ctx.token) return null;
    const destinations = resolveDestinations(config.destinations, ctx.behavior);
    if (!destinations.length) return null;
    // No movement means no mover — a button, a door, Each Token Inside. Pull the
    // token's player (if any) along with it, and leave the GM's view alone.
    const moved = !!ctx.movement;
    const landed = await runRandomTeleport({
      key: nodeKey(ctx.behavior, node), config, destinations, region: ctx.region,
      token: ctx.token, movement: ctx.movement,
      user: moved ? (ctx.user ?? game.user) : _ownerOf(ctx.token),
      viewSelf: moved,
    });
    if (!landed) return null;
    ctx.token = landed;   // later nodes act on the token where it landed
    return "out";
  },
});

registerRegionLogicNode({
  type: "sound", label: "Play Sound", category: "action", icon: "fa-solid fa-volume-high",
  defaults: { src: "", volume: 0.8, audience: "all" },
  fields: [
    { key: "src", label: "Sound", type: "audio" },
    { key: "volume", label: "Volume", type: "number", min: 0, max: 1, step: 0.05 },
    { key: "audience", label: "Who Hears It", type: "select",
      choices: { all: "Everyone", owners: "The token's owners" } },
  ],
  summary: c => (c.src ? c.src.split("/").pop() : "No sound picked"),
  run({ ctx, config }) {
    playRegionSound({ soundVolume: config.volume, soundAudience: config.audience }, config.src, ctx.token);
    return "out";
  },
});

/** The player who owns a token — active ones first — else this GM. */
function _ownerOf(token) {
  const owners = game.users.filter(u => !u.isGM && token.testUserPermission?.(u, "OWNER"));
  return owners.find(u => u.active) ?? owners[0] ?? game.user;
}

const _esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

registerRegionLogicNode({
  type: "chat", label: "Chat Message", category: "action", icon: "fa-solid fa-comment",
  defaults: { text: "", gmOnly: true },
  fields: [
    { key: "text", label: "Text ({token} = the token's name)", type: "text" },
    { key: "gmOnly", label: "Whisper to GMs only", type: "boolean" },
  ],
  summary: c => (c.text ? `${c.gmOnly ? "GM: " : ""}${c.text}` : "No text"),
  async run({ ctx, config }) {
    if (!config.text) return "out";
    const content = _esc(config.text).replaceAll("{token}", _esc(ctx.token?.name ?? ""));
    const data = { content, speaker: { alias: ctx.behavior?.name || "Region" } };
    if (config.gmOnly) data.whisper = game.users.filter(u => u.isGM).map(u => u.id);
    await ChatMessage.create(data);
    return "out";
  },
});
