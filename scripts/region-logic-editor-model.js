/**
 * sta2e-toolkit | region-logic-editor-model.js
 *
 * Everything the Region Logic editor does to a graph that is not DOM: node
 * geometry and port positions, wire paths, the edit operations, and the
 * starter templates. Imports only the two other leaves (region-logic-graph.js,
 * region-logic-convert.js), so tests/region-logic-editor.mjs loads it under
 * node.
 *
 * Every edit is pure: it takes a graph and returns a new one, so the editor's
 * undo history is a list of graphs and nothing is ever patched in place.
 *
 * Geometry is computed, never measured. A node is NODE_W wide; its height and
 * every port's position follow from how many inputs and outputs it has, and
 * the editor's stylesheet is sized from the same constants (written onto the
 * root as custom properties), so a wire always lands on its port dot.
 */

import { normalizeGraph, emptyGraph } from "./region-logic-graph.js";
import { graphFromDoorLight, graphFromRandomTeleport } from "./region-logic-convert.js";

export const NODE_W = 210;
export const HEAD_H = 30;
export const ROW_H = 22;
export const PAD = 6;
export const FOOT_H = 24;
export const GRID = 20;
export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 1.6;

/** Port names as they read on a node; "" shows the dot alone. */
export const PORT_LABELS = {
  in: "", out: "", yes: "yes", no: "no", first: "first time", again: "again",
  ready: "ready", blocked: "blocked", on: "on", off: "off", toggle: "toggle",
  each: "each token", none: "nobody", check: "check", set: "after set", done: "after all",
  disable: "disable", enable: "enable", pass: "pass", fail: "fail",
};

/** Ports that mean "it passed" draw green wires, the others red. */
export const PORT_TONE = { yes: "pos", first: "pos", ready: "pos", pass: "pos",
  no: "neg", again: "neg", blocked: "neg", fail: "neg" };

export const CATEGORIES = [
  { id: "trigger",   label: "Triggers" },
  { id: "condition", label: "Conditions" },
  { id: "flow",      label: "Timing" },
  { id: "action",    label: "Actions" },
];

const _clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/**
 * A node's ports. An unregistered type (a node from a removed extension) keeps
 * whatever ports its wires use, so loading it never drops a wire.
 */
export function nodePorts(node, desc, graph = null) {
  if (desc) return { inputs: [...(desc.inputs ?? [])], outputs: [...(desc.outputs ?? [])] };
  const inputs = new Set();
  const outputs = new Set();
  for (const w of graph?.wires ?? []) {
    if (w.to === node.id) inputs.add(w.in);
    if (w.from === node.id) outputs.add(w.out);
  }
  return { inputs: [...inputs], outputs: [...outputs] };
}

export function nodeHeight(ports) {
  const rows = Math.max(1, ports.inputs.length, ports.outputs.length);
  return HEAD_H + PAD + rows * ROW_H + PAD + FOOT_H;
}

/** Where a port's dot sits, in graph coordinates. side: "in" | "out". */
export function portPoint(node, ports, side, port) {
  const list = side === "in" ? ports.inputs : ports.outputs;
  const i = Math.max(0, list.indexOf(port));
  return {
    x: node.x + (side === "in" ? 0 : NODE_W),
    y: node.y + HEAD_H + PAD + i * ROW_H + ROW_H / 2,
  };
}

/** An SVG path from an output to an input, leaving and arriving horizontally. */
export function wirePath(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  const r = n => Math.round(n * 10) / 10;
  return `M ${r(a.x)} ${r(a.y)} C ${r(a.x + dx)} ${r(a.y)}, ${r(b.x - dx)} ${r(b.y)}, ${r(b.x)} ${r(b.y)}`;
}

export const snap = (v, grid = GRID) => Math.round(v / grid) * grid;

export const wireKey = w => `${w.from}|${w.out}|${w.to}|${w.in}`;

/** A readable id not yet in the graph: "chance", "chance2", "chance3"… */
export function newNodeId(graph, type, taken = null) {
  const ids = taken ?? new Set(graph.nodes.map(n => n.id));
  if (!ids.has(type)) return type;
  for (let i = 2; ; i++) if (!ids.has(`${type}${i}`)) return `${type}${i}`;
}

export function addNode(graph, type, x, y, config = {}) {
  const id = newNodeId(graph, type);
  const next = _clone(graph);
  next.nodes.push({ id, type, x: snap(x), y: snap(y), config: _clone(config) });
  return { graph: next, id };
}

/** Remove nodes and every wire touching them. */
export function removeNodes(graph, ids) {
  const drop = new Set(ids);
  const next = _clone(graph);
  next.nodes = next.nodes.filter(n => !drop.has(n.id));
  next.wires = next.wires.filter(w => !drop.has(w.from) && !drop.has(w.to));
  return next;
}

/** Move nodes by a delta; `snapTo` rounds each landing point to the grid. */
export function moveNodes(graph, ids, dx, dy, snapTo = true) {
  const set = new Set(ids);
  const next = _clone(graph);
  for (const n of next.nodes) {
    if (!set.has(n.id)) continue;
    n.x = snapTo ? snap(n.x + dx) : n.x + dx;
    n.y = snapTo ? snap(n.y + dy) : n.y + dy;
  }
  return next;
}

/**
 * Why a wire may not be made, or null if it may. Ports must exist on their
 * nodes, a node may not feed itself, and a wire may not be made twice. Loops
 * through other nodes are allowed: the runner's step budget stops them.
 */
export function wireProblem(graph, registry, wire) {
  const from = graph.nodes.find(n => n.id === wire.from);
  const to = graph.nodes.find(n => n.id === wire.to);
  if (!from || !to) return "That node is gone.";
  if (from.id === to.id) return "A node cannot feed itself.";
  const fromPorts = nodePorts(from, registry.get(from.type), graph);
  const toPorts = nodePorts(to, registry.get(to.type), graph);
  if (!fromPorts.outputs.includes(wire.out)) return "No such output.";
  if (!toPorts.inputs.includes(wire.in)) return "That node has no such input.";
  if (graph.wires.some(w => wireKey(w) === wireKey(wire))) return "Already connected.";
  return null;
}

export function connect(graph, registry, wire) {
  if (wireProblem(graph, registry, wire)) return graph;
  const next = _clone(graph);
  next.wires.push({ from: wire.from, out: wire.out, to: wire.to, in: wire.in });
  return next;
}

export function disconnect(graph, key) {
  const next = _clone(graph);
  next.wires = next.wires.filter(w => wireKey(w) !== key);
  return next;
}

/** Read a dotted path ("sequence.stepDelay") out of an object. */
export function getPath(obj, path) {
  return String(path).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** A copy of obj with the dotted path set; intermediate objects are created. */
export function setPath(obj, path, value) {
  const out = _clone(obj ?? {});
  const keys = String(path).split(".");
  let o = out;
  for (const k of keys.slice(0, -1)) {
    if (!o[k] || typeof o[k] !== "object" || Array.isArray(o[k])) o[k] = {};
    o = o[k];
  }
  o[keys.at(-1)] = _clone(value);
  return out;
}

/** Set one config value on one node. */
export function setNodeConfig(graph, id, path, value) {
  const next = _clone(graph);
  const node = next.nodes.find(n => n.id === id);
  if (node) node.config = setPath(node.config, path, value);
  return next;
}

/** Give a node its own title ("" puts back the type's name). */
export function setNodeTitle(graph, id, title) {
  const next = _clone(graph);
  const node = next.nodes.find(n => n.id === id);
  if (!node) return next;
  const t = String(title ?? "").trim().slice(0, 60);
  if (t) node.title = t;
  else delete node.title;
  return next;
}

/**
 * Add a fragment (another graph) to this one, its ids renamed where they clash
 * and every node shifted by (dx, dy).
 * @returns {{graph: object, ids: string[]}} The new nodes' ids.
 */
export function insertFragment(graph, fragment, dx = 0, dy = 0) {
  const frag = normalizeGraph(fragment);
  const next = _clone(graph);
  const taken = new Set(next.nodes.map(n => n.id));
  const rename = new Map();
  for (const n of frag.nodes) {
    const base = n.id.replace(/\d+$/, "") || n.type;
    const id = taken.has(n.id) ? newNodeId(next, base, taken) : n.id;
    taken.add(id);
    rename.set(n.id, id);
    next.nodes.push({ ...n, id, x: snap(n.x + dx), y: snap(n.y + dy), config: _clone(n.config) });
  }
  for (const w of frag.wires) next.wires.push({ ...w, from: rename.get(w.from), to: rename.get(w.to) });
  // A node that names other nodes (Enable / Disable's `nodes`) follows the
  // rename, so a template or a duplicated group still points at its own copies.
  // An id from outside the fragment is left as it is.
  for (const id of rename.values()) {
    const n = next.nodes.find(x => x.id === id);
    if (Array.isArray(n?.config?.nodes)) n.config.nodes = n.config.nodes.map(ref => rename.get(ref) ?? ref);
  }
  return { graph: next, ids: [...rename.values()] };
}

/** Copy nodes, with the wires that run between them, offset by one grid step. */
export function duplicateNodes(graph, ids, offset = GRID * 2) {
  const set = new Set(ids);
  const fragment = {
    nodes: graph.nodes.filter(n => set.has(n.id)),
    wires: graph.wires.filter(w => set.has(w.from) && set.has(w.to)),
  };
  return insertFragment(graph, fragment, offset, offset);
}

/**
 * The nearest grid point at or below (x, y) where a node of `height` would
 * not overlap any node already there, so a new node never lands on another.
 */
export function freeSpot(graph, registry, x, y, height = nodeHeight({ inputs: ["in"], outputs: ["out"] })) {
  const gap = GRID;
  const boxes = graph.nodes.map(n => ({
    x: n.x, y: n.y, w: NODE_W, h: nodeHeight(nodePorts(n, registry.get(n.type), graph)),
  }));
  let px = snap(x);
  let py = snap(y);
  for (let tries = 0; tries < 200; tries++) {
    const hit = boxes.find(b => px < b.x + b.w + gap && px + NODE_W + gap > b.x
      && py < b.y + b.h + gap && py + height + gap > b.y);
    if (!hit) return { x: px, y: py };
    py = snap(hit.y + hit.h + gap * 2);
  }
  return { x: px, y: py };
}

/** The box round every node, or null for an empty graph. */
export function graphBounds(graph, registry) {
  if (!graph.nodes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of graph.nodes) {
    const h = nodeHeight(nodePorts(n, registry.get(n.type), graph));
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + NODE_W); y1 = Math.max(y1, n.y + h);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Pan and zoom that fit the bounds into a viewport of w × h, with a margin. */
export function fitView(bounds, w, h, margin = 40) {
  if (!bounds || !(w > 0) || !(h > 0)) return { x: margin, y: margin, zoom: 1 };
  const zoom = Math.min(1.1, ZOOM_MAX, Math.max(ZOOM_MIN,
    Math.min((w - margin * 2) / Math.max(1, bounds.width), (h - margin * 2) / Math.max(1, bounds.height))));
  return {
    zoom,
    x: (w - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (h - bounds.height * zoom) / 2 - bounds.y * zoom,
  };
}

/** Zoom by a factor about a screen point, keeping that point still. */
export function zoomAbout(view, factor, sx, sy) {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom * factor));
  const k = zoom / view.zoom;
  return { zoom, x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k };
}

// ── Templates ────────────────────────────────────────────────────────────────

const C = [40, 300, 560, 820];
const node = (id, type, x, y, config = {}) => ({ id, type, x, y, config });
const wire = (from, to, out = "out", input = "in") => ({ from, out, to, in: input });

export const TEMPLATES = [
  {
    id: "presence", label: "Lights while occupied",
    hint: "Doors and lights switch on when a token walks in, and off when the last one leaves.",
    build: () => graphFromDoorLight({ trigger: "presence" }),
  },
  {
    id: "toggle", label: "Toggle on entry",
    hint: "Every token walking in flips the doors and lights.",
    build: () => graphFromDoorLight({ trigger: "toggle" }),
  },
  {
    id: "teleport", label: "Teleporter pad",
    hint: "A token walking in is sent to one of several destination Regions.",
    build: () => graphFromRandomTeleport({}),
  },
  {
    id: "doorTeleport", label: "Unlock to teleport",
    hint: "Unlocking a door sends every token inside this Region, one after another, to a destination.",
    build: () => ({
      nodes: [
        node("door", "doorChange", C[0], 0, { when: "unlocked" }),
        node("each", "eachToken", C[1], 0),
        node("teleport", "teleport", C[2], 0),
      ],
      wires: [wire("door", "each"), wire("each", "teleport", "each")],
    }),
  },
  {
    id: "lockIn", label: "Lock in, unlock to teleport",
    hint: "A token walking in locks the door and arms a Switch. Unlocking the door then teleports "
      + "whoever is inside, once: the Switch turns off until someone walks in again.",
    build: () => ({
      nodes: [
        node("enter", "tokenEnter", C[0], 0, { who: "players" }),
        node("door", "doorChange", C[0], 280, { when: "unlocked" }),
        node("latch", "latch", C[1], 100),
        node("each", "eachToken", C[2], 280, { who: "players" }),
        node("teleport", "teleport", C[3], 280),
        node("doors", "doors", C[3] + 260, 40, { on: { door: "locked" }, off: { door: "" }, waitDone: true }),
      ],
      wires: [
        wire("enter", "doors", "out", "on"), wire("enter", "latch", "out", "on"),
        wire("door", "latch", "out", "check"), wire("latch", "each", "yes"),
        wire("each", "teleport", "each"),
        wire("teleport", "latch", "out", "off"), wire("teleport", "doors", "out", "off"),
        // Nobody inside: reset anyway, or the Doors node stays "on" and the next
        // entry finds it already on and does not lock the door again.
        wire("each", "latch", "none", "off"), wire("each", "doors", "none", "off"),
      ],
    }),
  },
  {
    id: "lockInRest", label: "Lock in, teleport, then rest",
    hint: "A token walking in locks the door. Unlocking it teleports everyone inside, then the "
      + "locking, the unlock trigger and the teleport are disabled for a minute (0 = until enabled again).",
    build: () => ({
      nodes: [
        node("enter", "tokenEnter", C[0], 0, { who: "players" }),
        node("door", "doorChange", C[0], 280, { when: "unlocked" }),
        node("each", "eachToken", C[1], 280, { who: "players" }),
        node("teleport", "teleport", C[2], 280),
        node("doors", "doors", C[3], 0, { on: { door: "locked" }, off: { door: "" }, waitDone: true }),
        // The Door Changes trigger is disabled too: otherwise an unlock during the
        // rest would reach this node again and restart the timer.
        node("rest", "toggleNodes", C[3], 280, { nodes: ["door", "teleport", "doors"], seconds: 60 }),
      ],
      wires: [
        wire("enter", "doors", "out", "on"),
        wire("door", "each"), wire("each", "teleport", "each"),
        // After every token has gone: put the Doors node back to "off" (door left
        // as it is) so it can lock again later, THEN disable — in that order,
        // since a disabled Doors node would skip the reset.
        wire("each", "doors", "done", "off"), wire("each", "rest", "done", "disable"),
      ],
    }),
  },
  {
    id: "console", label: "Roll to bypass a lock",
    hint: "A token walking up rolls Control + Engineering. A pass unlocks the door (pick it on the "
      + "Doors node); either way the chat says how it went.",
    build: () => ({
      nodes: [
        node("enter", "tokenEnter", C[0], 0, { who: "players" }),
        node("task", "taskRoll", C[1], 0, { taskName: "Bypass the Lock", attrKey: "control",
          discKey: "engineering", difficulty: 2 }),
        // "closed" is unlocked but shut; the node re-applies it on every pass.
        node("doors", "doors", C[2], -60, { on: { door: "closed" }, off: { door: "" } }),
        node("passMsg", "chat", C[2], 120, { text: "{token} bypasses the lock.", gmOnly: false }),
        node("failMsg", "chat", C[2], 260, { text: "{token} fails to bypass the lock.", gmOnly: false }),
      ],
      wires: [
        wire("enter", "task"),
        wire("task", "doors", "pass", "on"), wire("task", "passMsg", "pass"),
        wire("task", "failMsg", "fail"),
      ],
    }),
  },
  {
    id: "alarm", label: "Tripwire alarm",
    hint: "The first time each player token walks in, the GM is told and a sound plays.",
    build: () => ({
      nodes: [
        node("enter", "tokenEnter", C[0], 0, { who: "players" }),
        node("once", "oncePerToken", C[1], 0),
        node("chat", "chat", C[2], 0, { text: "{token} tripped the alarm.", gmOnly: true }),
        node("sound", "sound", C[2], 140),
      ],
      wires: [wire("enter", "once"), wire("once", "chat", "first"), wire("once", "sound", "first")],
    }),
  },
  {
    id: "trap", label: "Random hazard",
    hint: "Each token walking in has a chance of setting something off.",
    build: () => ({
      nodes: [
        node("enter", "tokenEnter", C[0], 0),
        node("chance", "chance", C[1], 0, { percent: 30 }),
        node("chat", "chat", C[2], 0, { text: "{token} set something off!", gmOnly: true }),
      ],
      wires: [wire("enter", "chance"), wire("chance", "chat", "yes")],
    }),
  },
  {
    id: "button", label: "Control panel",
    hint: "Buttons on the sheet (or a macro) switch lights; tokens do nothing.",
    build: () => ({
      nodes: [
        node("manualOn", "manual", C[0], 0, { label: "Switch On" }),
        node("manualOff", "manual", C[0], 120, { label: "Switch Off" }),
        node("manual", "manual", C[0], 240, { label: "Toggle" }),
        node("lights", "lights", C[1] + 60, 100),
      ],
      wires: [wire("manualOn", "lights", "out", "on"), wire("manualOff", "lights", "out", "off"),
        wire("manual", "lights", "out", "toggle")],
    }),
  },
];

/**
 * Add a template to a graph: at the origin when the graph is empty, otherwise
 * below everything already there.
 */
export function insertTemplate(graph, registry, templateId) {
  const tpl = TEMPLATES.find(t => t.id === templateId);
  if (!tpl) return { graph, ids: [] };
  const frag = normalizeGraph(tpl.build());
  const bounds = graphBounds(graph, registry);
  const fb = graphBounds(frag, registry) ?? { x: 0, y: 0 };
  const dx = bounds ? bounds.x - fb.x : 0;
  const dy = bounds ? bounds.y + bounds.height + GRID * 4 - fb.y : 0;
  return insertFragment(graph ?? emptyGraph(), frag, dx, dy);
}
