/**
 * sta2e-toolkit | region-logic-behavior.js
 *
 * Region Logic — one Region behavior whose triggers, conditions and actions
 * are a graph of nodes the GM wires together, instead of a fixed form. It sits
 * beside Door & Light Control and Random Teleport (both stay in the Add
 * Behavior list); their switch and teleport engines are its Doors & Lights and
 * Random Teleport nodes, and each of their sheets has a Convert key that builds
 * the equivalent graph.
 *
 *   region-logic-graph.js     the graph and its runner (a leaf, tested under node)
 *   region-logic-nodes.js     the node catalog — one descriptor per node type
 *   region-logic-convert.js   Door & Light / Random Teleport → graph (a leaf)
 *   region-logic-editor.js    the visual editor (model in region-logic-editor-model.js)
 *
 * The graph is one ObjectField, `system.graph`. Core's auto-sheet renders no
 * input for an ObjectField (it has no _toInput), so the sheet's own form never
 * touches it; the panel injected here shows the flow and carries the buttons.
 *
 * Every run happens on the active GM (isActiveGM): Region events reach every
 * client and the others return at once. Manual buttons run on the GM who
 * presses them. Node state (switches, cooldowns) lives in behavior flags and
 * token flags keyed by node id, so it survives a reload.
 *
 * Registration needs the usual three agreeing pieces: module.json
 * documentTypes (re-read only when the world is LAUNCHED), the namespaced type
 * id, and i18n keys for the labels.
 */

import { isActiveGM } from "./gm-authority.js";
import { normalizeGraph, triggerNodes, runGraph, flowOrder, nodeConfig } from "./region-logic-graph.js";
import {
  REGION_LOGIC_NODES, LOGIC_STATE_FLAG, LOGIC_USED_FLAG, nodeKey, isLogicSwitchOn, isNodeDisabled, setNodesDisabled,
  setLogicSwitch, rearmFirstOnlyOnExit, switchStateWord, setLogicCounter, whoMatches,
} from "./region-logic-nodes.js";
import { handleRegionLogicSocket } from "./region-logic-nodes-toolkit.js";
import { graphFromDoorLight, graphFromRandomTeleport } from "./region-logic-convert.js";
import { DOOR_LIGHT_BEHAVIOR } from "./door-light-behavior.js";
import { RANDOM_TELEPORT_BEHAVIOR } from "./random-teleport-behavior.js";
import { resetUses, usedTokens, clearCooldown } from "./region-token-uses.js";
import { PORT_LABELS } from "./region-logic-editor-model.js";
import { doorEvents, rememberDoorState } from "./region-logic-doors.js";
import { openRegionLogicEditor } from "./region-logic-editor.js";

const MODULE = "sta2e-toolkit";
export const REGION_LOGIC_BEHAVIOR = `${MODULE}.regionLogic`;

const Base = foundry.data.regionBehaviors.RegionBehaviorType;

// ── Data model ───────────────────────────────────────────────────────────────

export class RegionLogicBehaviorType extends Base {
  static LOCALIZATION_PREFIXES = ["BEHAVIOR.TYPES.base"];

  static defineSchema() {
    const f = foundry.data.fields;
    return {
      graph: new f.ObjectField({ initial: () => ({ version: 1, nodes: [], wires: [] }) }),
    };
  }

  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: function(event) { return _onEvent(this, "tokenEnter", event); },
    [CONST.REGION_EVENTS.TOKEN_EXIT]:  function(event) { return _onEvent(this, "tokenExit", event); },
  };
}

// ── Running ──────────────────────────────────────────────────────────────────

async function _onEvent(system, eventName, event) {
  if (!isActiveGM()) return;
  const token = event.data?.token ?? null;
  if (eventName === "tokenExit") {
    try { await rearmFirstOnlyOnExit(system.parent, normalizeGraph(system.graph), token); }
    catch (err) { console.warn("STA2e Toolkit | Region Logic: could not re-arm First Token Only", err); }
  }
  return _run(system.parent, eventName, {
    token, movement: event.data?.movement ?? null, user: event.user ?? null,
  });
}

async function _run(behavior, eventName, extra = {}) {
  const graph = normalizeGraph(behavior.system.graph);
  const ctx = { event: eventName, behavior, region: behavior.parent, ...extra };
  const isDisabled = node => isNodeDisabled(behavior, node.id);
  const starts = triggerNodes(graph, REGION_LOGIC_NODES, eventName, ctx, { isDisabled });
  if (!starts.length) return null;
  return runGraph(graph, REGION_LOGIC_NODES, starts, ctx, {
    isDisabled,
    onError: (err, node) => console.error(
      `STA2e Toolkit | Region Logic "${behavior.name}": node ${node?.type} (${node?.id}) failed`, err),
  });
}

async function _behaviorFrom(behaviorOrUuid) {
  const behavior = typeof behaviorOrUuid === "string" ? await fromUuid(behaviorOrUuid) : behaviorOrUuid;
  if (behavior?.type !== REGION_LOGIC_BEHAVIOR) {
    ui.notifications?.warn("STA2e Toolkit | Not a Region Logic behavior.");
    return null;
  }
  return behavior;
}

/**
 * GM only. Press a Region Logic behavior's Button triggers: the one with this
 * label (or node id), or every button when omitted. Runs on this client.
 */
export async function fireRegionLogic(behaviorOrUuid, labelOrNodeId = null) {
  const behavior = await _behaviorFrom(behaviorOrUuid);
  if (!behavior) return null;
  if (!game.user.isGM) {
    ui.notifications?.warn("STA2e Toolkit | Only a GM can press a Region Logic button.");
    return null;
  }
  const graph = normalizeGraph(behavior.system.graph);
  const byId = labelOrNodeId && graph.nodes.some(n => n.id === labelOrNodeId);
  return _run(behavior, "manual", {
    token: null, user: game.user,
    nodeId: byId ? labelOrNodeId : null, label: byId ? null : labelOrNodeId,
  });
}

/** GM only. Replace a Region Logic behavior's graph. */
export async function setRegionLogicGraph(behaviorOrUuid, graph) {
  const behavior = await _behaviorFrom(behaviorOrUuid);
  if (!behavior || !game.user.isGM) return null;
  return behavior.update({ "system.graph": normalizeGraph(graph) });
}

/**
 * GM only. Clear every Once Per Token mark and cooldown this behavior's nodes
 * hold, and enable every disabled node. Switch states are left alone — the
 * buttons set those.
 * @returns {Promise<number>} How many tokens were reset.
 */
export async function resetRegionLogic(behaviorOrUuid) {
  const behavior = await _behaviorFrom(behaviorOrUuid);
  if (!behavior || !game.user.isGM) return 0;
  const graph = normalizeGraph(behavior.system.graph);
  let count = 0;
  for (const node of graph.nodes) {
    if (node.type === "oncePerToken") count += await resetUses({ id: nodeKey(behavior, node) }, LOGIC_USED_FLAG);
    if (node.type === "cooldown") await clearCooldown(behavior, node.id);
    if (node.type === "firstOnly" && isLogicSwitchOn(behavior, node.id)) await setLogicSwitch(behavior, node.id, false);
    if (node.type === "counter") await setLogicCounter(behavior, node.id, 0);
  }
  const disabled = graph.nodes.filter(n => isNodeDisabled(behavior, n.id)).map(n => n.id);
  await setNodesDisabled(behavior, disabled, false);
  return count;
}

/**
 * GM only. Enable or disable one node by id (seconds > 0 makes a disable
 * timed) — the macro side of the Enable / Disable node.
 */
export async function setRegionLogicNodeEnabled(behaviorOrUuid, nodeId, enabled, seconds = 0) {
  const behavior = await _behaviorFrom(behaviorOrUuid);
  if (!behavior || !game.user.isGM) return null;
  if (!normalizeGraph(behavior.system.graph).nodes.some(n => n.id === nodeId)) {
    ui.notifications?.warn(`STA2e Toolkit | No node "${nodeId}" in "${behavior.name}".`);
    return null;
  }
  return setNodesDisabled(behavior, [nodeId], !enabled, seconds);
}

// ── Task rolls ───────────────────────────────────────────────────────────────

/**
 * Pick a flow up again after a Task Roll node's roll: run on from that node's
 * pass or fail port, for the token the roll was made for. Called by the active
 * GM when the Working Results card is confirmed; also usable from a macro.
 */
export async function resumeRegionLogicTask({ behaviorUuid, nodeId, tokenUuid } = {}, passed, rollData = {}) {
  const behavior = behaviorUuid ? await fromUuid(behaviorUuid).catch(() => null) : null;
  if (behavior?.type !== REGION_LOGIC_BEHAVIOR || behavior.disabled) return null;
  const graph = normalizeGraph(behavior.system.graph);
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return null;   // the node was deleted while the roll was out
  const token = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
  const ctx = {
    event: "taskRoll", behavior, region: behavior.parent, token, movement: null, user: game.user,
    taskPassed: !!passed, taskSuccesses: rollData.confirmedSuccesses ?? null,
    taskMomentum: rollData.confirmedMomentum ?? null,
  };
  return runGraph(graph, REGION_LOGIC_NODES, [{ node, port: passed ? "pass" : "fail" }], ctx, {
    isDisabled: n => isNodeDisabled(behavior, n.id),
    onError: (err, n) => console.error(
      `STA2e Toolkit | Region Logic "${behavior.name}": node ${n?.type} (${n?.id}) failed`, err),
  });
}

/**
 * A Working Results card was confirmed. Keyed on the confirmed ROLL DATA, as
 * gear-damage-ui.js's complications hook is: the bare `confirmed` flag is
 * written before the result is known. A message flag makes sure one card
 * resumes its flow once, even if the hook fires again.
 */
async function _onTaskConfirmed(message, changes) {
  if (foundry.utils.getProperty(changes, `flags.${MODULE}.rollData.confirmed`) !== true) return;
  const rollData = message.flags?.[MODULE]?.rollData;
  const link = rollData?.regionLogicContext;
  if (!link || !isActiveGM()) return;
  if (message.getFlag(MODULE, "regionLogicResumed")) return;
  await message.setFlag(MODULE, "regionLogicResumed", true);
  try { await resumeRegionLogicTask(link, rollData.confirmedPassed === true, rollData); }
  catch (err) { console.error("STA2e Toolkit | Region Logic: resuming after a task roll failed", err); }
}

// ── Door triggers ────────────────────────────────────────────────────────────

/** Every enabled Region Logic behavior (on one scene, or any) that holds a node of this type. */
function _watchers(nodeType, scene = null) {
  const out = [];
  for (const s of scene ? [scene] : (game.scenes ?? [])) {
    for (const region of s.regions ?? []) {
      for (const behavior of region.behaviors ?? []) {
        if (behavior.type !== REGION_LOGIC_BEHAVIOR || behavior.disabled) continue;
        if (normalizeGraph(behavior.system.graph).nodes.some(n => n.type === nodeType)) out.push(behavior);
      }
    }
  }
  return out;
}

const _doorWatchers = () => _watchers("doorChange");

function _runAll(behaviors, eventName, extra, what) {
  for (const behavior of behaviors) {
    _run(behavior, eventName, { token: null, movement: null, user: game.user, ...extra })
      .catch(err => console.error(`STA2e Toolkit | Region Logic "${behavior.name}": ${what} trigger failed`, err));
  }
}

// ── Combat, alert and timer triggers ─────────────────────────────────────────

/** A new round, or a new turn: run Combat Round / Turn on the combat's scene. */
function _onUpdateCombat(combat, changes) {
  if (!isActiveGM() || !combat.started) return;
  const round = "round" in changes;
  if (!round && !("turn" in changes)) return;
  const scene = combat.scene ?? canvas?.scene;
  if (!scene) return;
  // Under the toolkit's round-robin initiative a new round parks on turns[0]
  // only until initiative-order.js clears it (nobody has acted yet), so that
  // first combatant has not started a turn. Its real turn arrives as a later
  // `turn` update, when someone is picked.
  let roundRobin = false;
  try { roundRobin = game.settings.get(MODULE, "initiativeRoundRobin") !== false; } catch { /* unset */ }
  const token = round && roundRobin ? null : (combat.combatant?.token ?? null);
  _runAll(_watchers("combatTurn", scene), "combat",
    { combat, combatEvent: round ? "round" : "turn", token }, "combat");
}

// The alert setting is written by whichever GM changes it, and only a real
// change counts (a second GM echoing the same value is not one). The first
// write in a world CREATES the Setting, so both hooks are watched.
let _lastAlert = null;

function _onAlertSetting(setting) {
  if (setting?.key !== "sta2e-toolkit.alertCondition") return;
  let level;
  try { level = game.settings.get(MODULE, "alertCondition"); } catch { return; }
  const prev = _lastAlert;
  _lastAlert = level;
  if (prev === level || !isActiveGM()) return;
  _runAll(_watchers("alertChange"), "alert", { alert: level, alertFrom: prev }, "alert");
}

// One clock for every Timer node, on the active GM. `_timerStart` holds when
// each node's current interval began; a "while occupied" timer is dropped from
// it when its Region empties, so it starts afresh on the next arrival.
const _timerStart = new Map();

function _tickTimers() {
  if (!isActiveGM()) { _timerStart.clear(); return; }
  const now = Date.now();
  const seen = new Set();
  for (const behavior of _watchers("timer")) {
    for (const node of normalizeGraph(behavior.system.graph).nodes) {
      if (node.type !== "timer" || isNodeDisabled(behavior, node.id)) continue;
      const config = nodeConfig(node, REGION_LOGIC_NODES.get("timer"));
      const key = `${behavior.uuid}#${node.id}`;
      if (config.whileOccupied
        && ![...(behavior.parent?.tokens ?? [])].some(t => whoMatches(t, config.who))) continue;
      seen.add(key);
      const start = _timerStart.get(key);
      if (start == null) { _timerStart.set(key, now); continue; }
      if (now - start < Math.max(1, Number(config.seconds) || 1) * 1000) continue;
      _timerStart.set(key, now);
      _run(behavior, "timer", { token: null, movement: null, user: game.user, nodeId: node.id })
        .catch(err => console.error(`STA2e Toolkit | Region Logic "${behavior.name}": timer failed`, err));
    }
  }
  for (const key of _timerStart.keys()) if (!seen.has(key)) _timerStart.delete(key);
}

function _seedDoorStates() {
  for (const scene of game.scenes ?? []) {
    for (const wall of scene.walls ?? []) if ((wall.door ?? 0) > 0) rememberDoorState(wall.uuid, wall.ds);
  }
}

/**
 * A door changed state. Every client records it (see region-logic-doors.js);
 * the active GM runs the Door Changes triggers it raises. A door can be watched
 * from a Region on another scene, so every scene's behaviors are asked.
 */
function _onUpdateWall(wall, changes) {
  if (!("ds" in changes)) return;
  const prev = rememberDoorState(wall.uuid, wall.ds);
  if (!isActiveGM()) return;
  const events = doorEvents(prev, wall.ds);
  if (!events.length) return;
  for (const behavior of _doorWatchers()) {
    _run(behavior, "doorChange", { token: null, movement: null, user: game.user, door: wall, doorEvents: events })
      .catch(err => console.error(`STA2e Toolkit | Region Logic "${behavior.name}": door trigger failed`, err));
  }
}

// ── Converting a classic behavior ────────────────────────────────────────────

/** A target list as absolute UUIDs, resolved against the behavior that stored them. */
function _absolute(uuids, relative) {
  return [...(uuids ?? [])].map(uuid => {
    try { return fromUuidSync(uuid, { relative })?.uuid ?? uuid; } catch { return uuid; }
  });
}

/**
 * GM only. Build a Region Logic behavior on the same Region that does what a
 * Door & Light Control or Random Teleport behavior does, then disable the
 * original (re-enable it to go back). A switch that is on stays on.
 * @returns {Promise<RegionBehavior|null>} The new behavior.
 */
export async function convertToRegionLogic(behaviorOrUuid) {
  const old = typeof behaviorOrUuid === "string" ? await fromUuid(behaviorOrUuid) : behaviorOrUuid;
  if (!game.user.isGM || !old?.parent) return null;
  const sys = old.toObject().system;
  let graph;
  const flags = {};
  if (old.type === DOOR_LIGHT_BEHAVIOR) {
    for (const key of ["doors", "lights", "sounds"]) sys[key] = _absolute(sys[key], old);
    graph = graphFromDoorLight(sys);
    const state = old.getFlag(MODULE, "doorLight");
    if (state) flags[LOGIC_STATE_FLAG] = { switches: { switch: state } };
  } else if (old.type === RANDOM_TELEPORT_BEHAVIOR) {
    sys.destinations = _absolute(sys.destinations, old);
    graph = graphFromRandomTeleport(sys);
  } else {
    ui.notifications?.warn("STA2e Toolkit | Only Door & Light Control and Random Teleport convert.");
    return null;
  }
  const label = game.i18n.localize(CONFIG.RegionBehavior.typeLabels[old.type] ?? old.type)
    .replace(/\s*\(STA Toolkit\)\s*$/, "");
  const [created] = await old.parent.createEmbeddedDocuments("RegionBehavior", [{
    type: REGION_LOGIC_BEHAVIOR, name: `${old.name || label} (Logic)`,
    system: { graph }, flags: { [MODULE]: flags },
  }]);
  await old.update({ disabled: true });
  return created ?? null;
}

// ── Sheet panel ──────────────────────────────────────────────────────────────

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

/** The flow as a readable list: each node, its summary, and where it leads. */
function _flowHtml(behavior, graph) {
  if (!graph.nodes.length) return `<p class="hint" style="margin:0;">No nodes yet.</p>`;
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const name = n => esc(n.title || (REGION_LOGIC_NODES.get(n.type)?.label ?? n.type));
  return flowOrder(graph, REGION_LOGIC_NODES).map(({ node, wires }) => {
    const desc = REGION_LOGIC_NODES.get(node.type);
    const config = nodeConfig(node, desc);
    let summary = "";
    try { summary = desc?.summary?.(config) ?? ""; } catch { /* a summary must never break the sheet */ }
    if (desc?.switchState) summary += ` · ${switchStateWord(desc, isLogicSwitchOn(behavior, node.id))}`;
    if (isNodeDisabled(behavior, node.id)) summary += " · DISABLED";
    const trigger = desc?.category === "trigger";
    const links = wires.map(w => {
      const to = byId.get(w.to);
      const from = PORT_LABELS[w.out] ?? w.out;
      const into = PORT_LABELS[w.in] ?? w.in;
      return `<div style="padding-left:1.6em;opacity:0.8;">${from ? `${esc(from)} ` : ""}→ ${name(to)}`
        + `${into ? ` <em>(${esc(into)})</em>` : ""}</div>`;
    }).join("");
    return `<div style="min-width:0;${trigger ? "margin-top:4px;" : ""}">
      <div style="display:flex;gap:6px;align-items:baseline;min-width:0;">
        <i class="${esc(desc?.icon ?? "fa-solid fa-question")}" style="flex:0 0 1.2em;text-align:center;"></i>
        <strong style="flex:0 0 auto;">${name(node)}</strong>
        <span style="flex:1 1 auto;min-width:0;opacity:0.75;overflow:hidden;text-overflow:ellipsis;
          white-space:nowrap;">${esc(summary)}</span>
      </div>${links}</div>`;
  }).join("");
}

function _injectLogicPanel(app, html) {
  const doc = app?.document ?? app?.object ?? null;
  if (doc?.type !== REGION_LOGIC_BEHAVIOR || !game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".sta2e-logic-panel")) return;   // idempotency guard

  const graph = normalizeGraph(doc.system.graph);
  const buttons = graph.nodes.filter(n => n.type === "manual");
  const used = graph.nodes.filter(n => n.type === "oncePerToken")
    .reduce((sum, n) => sum + usedTokens(LOGIC_USED_FLAG, nodeKey(doc, n)).length, 0);

  const panel = document.createElement("div");
  panel.className = "form-group sta2e-logic-panel";
  panel.innerHTML = `
    <div style="flex:0 0 100%;display:flex;flex-direction:column;gap:6px;min-width:0;">
      <div style="display:flex;align-items:center;gap:6px;">
        <strong style="flex:1 1 auto;">Flow <span style="opacity:0.65;font-weight:normal;">(STA Toolkit)</span></strong>
        <button type="button" data-sta2e-edit style="flex:0 0 auto;width:auto;">
          <i class="fa-solid fa-diagram-project"></i> Open Flow Editor</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">${_flowHtml(doc, graph)}</div>
      ${buttons.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">${buttons.map(n => `
        <button type="button" data-sta2e-fire="${esc(n.id)}" style="flex:1 1 9em;min-width:0;">
          <i class="fa-solid fa-hand-pointer"></i> ${esc(nodeConfig(n, REGION_LOGIC_NODES.get("manual")).label)}
        </button>`).join("")}</div>` : ""}
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="flex:1 1 auto;opacity:0.75;">${used} token${used === 1 ? "" : "s"} marked by Once Per Token</span>
        <button type="button" data-sta2e-reset style="flex:0 0 auto;width:auto;">
          <i class="fa-solid fa-rotate-left"></i> Reset Uses, Cooldowns &amp; Disabled</button>
      </div>
      <p class="hint" style="overflow-wrap:anywhere;">Build the flow in the editor. From a macro:
        game.sta2eToolkit.fireRegionLogic("${esc(doc.uuid)}", "&lt;button label&gt;").</p>
    </div>`;

  for (const btn of panel.querySelectorAll("[data-sta2e-fire]")) {
    btn.addEventListener("click", async () => {
      await fireRegionLogic(doc, btn.dataset.sta2eFire);
      app.render?.();
    });
  }
  panel.querySelector("[data-sta2e-edit]")?.addEventListener("click", () => openRegionLogicEditor(doc));
  panel.querySelector("[data-sta2e-reset]")?.addEventListener("click", async () => {
    const n = await resetRegionLogic(doc);
    ui.notifications.info(`Reset ${n} token${n === 1 ? "" : "s"}, every cooldown and every disabled node.`);
    app.render?.();
  });

  const anchor = root.querySelector(".form-group");
  if (anchor) anchor.before(panel);
  else (root.querySelector("form") ?? root).prepend(panel);
}

/** A Convert key on the classic Door & Light Control and Random Teleport sheets. */
function _injectConvertKey(app, html) {
  const doc = app?.document ?? app?.object ?? null;
  if (![DOOR_LIGHT_BEHAVIOR, RANDOM_TELEPORT_BEHAVIOR].includes(doc?.type) || !game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".sta2e-logic-convert")) return;   // idempotency guard

  const row = document.createElement("div");
  row.className = "form-group sta2e-logic-convert";
  row.innerHTML = `
    <div style="flex:0 0 100%;display:flex;align-items:center;gap:6px;min-width:0;">
      <span style="flex:1 1 auto;min-width:0;opacity:0.75;">Rebuild this as a Region Logic flow.</span>
      <button type="button" style="flex:0 0 auto;width:auto;">
        <i class="fa-solid fa-diagram-project"></i> Convert to Region Logic</button>
    </div>`;
  row.querySelector("button").addEventListener("click", async () => {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Convert to Region Logic" },
      content: `<p>Adds a Region Logic behavior to this Region that does the same thing, using the
        settings last saved, and disables this one. Re-enable this one and delete the new one to go
        back.</p>`,
    });
    if (!ok) return;
    const created = await convertToRegionLogic(doc);
    if (!created) return;
    ui.notifications.info(`Created "${created.name}" and disabled "${doc.name}".`);
    app.close?.();
    created.sheet?.render(true);
  });
  const last = root.querySelectorAll(".form-group");
  (last[last.length - 1] ?? root).after(row);
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerRegionLogicBehavior() {
  const type = REGION_LOGIC_BEHAVIOR;
  CONFIG.RegionBehavior.dataModels[type] = RegionLogicBehaviorType;
  CONFIG.RegionBehavior.typeLabels[type] = `TYPES.RegionBehavior.${type}`;
  CONFIG.RegionBehavior.typeHints[type]  = `TYPES.HINTS.RegionBehavior.${type}`;
  CONFIG.RegionBehavior.typeIcons[type]  = "fa-solid fa-diagram-project";

  // A type missing from game.model will never be offered — say so. Wrapped:
  // this runs in init.
  try {
    const known = getDocumentClass("RegionBehavior")?.TYPES ?? [];
    if (!known.includes(type)) {
      console.warn(
        `STA2e Toolkit | ${type} not in game.model.RegionBehavior — Region Logic will not appear `
        + "in the Add Behavior list. Check module.json documentTypes.RegionBehavior, then fully restart the world.",
      );
    }
  } catch { /* diagnostic only */ }

  Hooks.once("ready", _seedDoorStates);
  Hooks.once("ready", () => {
    try { _lastAlert = game.settings.get(MODULE, "alertCondition"); } catch { /* not registered */ }
    setInterval(_tickTimers, 1000);
  });
  Hooks.on("updateSetting", _onAlertSetting);
  Hooks.on("createSetting", _onAlertSetting);
  Hooks.on("updateCombat", _onUpdateCombat);
  // The camera pan for chosen players. A listener of its own on the module
  // channel, as destructible-objects.js has; registered here, in init.
  game.socket?.on(`module.${MODULE}`, msg => {
    try { handleRegionLogicSocket(msg); } catch (err) { console.warn("STA2e Toolkit | Region Logic socket", err); }
  });
  Hooks.on("createWall", wall => { if ((wall.door ?? 0) > 0) rememberDoorState(wall.uuid, wall.ds); });
  Hooks.on("deleteWall", wall => rememberDoorState(wall.uuid, undefined));
  Hooks.on("updateWall", _onUpdateWall);
  Hooks.on("updateChatMessage", _onTaskConfirmed);
  Hooks.on("renderRegionBehaviorConfig", _injectLogicPanel);
  Hooks.on("renderRegionBehaviorConfig", _injectConvertKey);
}
