/**
 * sta2e-toolkit | region-logic-graph.js
 *
 * The graph and its runner for the Region Logic behavior. A leaf with no
 * imports, so tests/region-logic.mjs can load it under node; everything that
 * touches Foundry lives in the node descriptors (region-logic-nodes.js), which
 * are passed in as a registry.
 *
 * A graph is
 *
 *   { version, nodes: [{id, type, x, y, config, title?}], wires: [{from, out, to, in}] }
 *
 * A wire runs from one node's OUTPUT port to one node's INPUT port. Most nodes
 * have a single input "in"; a node may declare several (the switch's on / off /
 * toggle), and its run() is told which one fired. x / y are for the editor.
 *
 * A descriptor is
 *
 *   { type, label, icon, category,            // trigger / condition / flow / action
 *     inputs, outputs, defaults,
 *     trigger?, accepts?(ctx, config, node),  // triggers only: which event, and whether this one fires
 *     summary?(config),
 *     run({ctx, node, config, input}) }       // → a port name, an array of them, or null to stop
 *
 * A returned entry may also be {port, ctx}: that branch carries its own
 * context. "Each Token Inside" returns one per token, so a Random Teleport
 * after it acts on that token and cannot overwrite another branch's.
 *
 * A run starts at every trigger node that accepts the event, all at once, and
 * follows the wires out of whatever port each node returns. Wires leaving one
 * port run in order, one after another. Every run has a step budget, so a loop
 * in the graph stops instead of hanging the GM's client.
 */

export const GRAPH_VERSION = 1;
export const MAX_STEPS = 200;

export function emptyGraph() {
  return { version: GRAPH_VERSION, nodes: [], wires: [] };
}

const _isPlain = v => !!v && typeof v === "object" && !Array.isArray(v);

/** Drop malformed nodes, duplicate ids and wires to nodes that do not exist. */
export function normalizeGraph(raw) {
  const nodes = [];
  const ids = new Set();
  for (const n of Array.isArray(raw?.nodes) ? raw.nodes : []) {
    if (typeof n?.id !== "string" || !n.id || ids.has(n.id) || typeof n.type !== "string") continue;
    ids.add(n.id);
    const node = {
      id: n.id, type: n.type,
      x: Number.isFinite(Number(n.x)) ? Number(n.x) : 0,
      y: Number.isFinite(Number(n.y)) ? Number(n.y) : 0,
      config: _isPlain(n.config) ? n.config : {},
    };
    // The editor's own name for a node, shown in place of the type's label.
    const title = typeof n.title === "string" ? n.title.trim().slice(0, 60) : "";
    if (title) node.title = title;
    nodes.push(node);
  }
  const wires = [];
  const seen = new Set();
  for (const w of Array.isArray(raw?.wires) ? raw.wires : []) {
    if (!ids.has(w?.from) || !ids.has(w?.to)) continue;
    const out = typeof w.out === "string" && w.out ? w.out : "out";
    const input = typeof w.in === "string" && w.in ? w.in : "in";
    const key = `${w.from}|${out}|${w.to}|${input}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wires.push({ from: w.from, out, to: w.to, in: input });
  }
  return { version: GRAPH_VERSION, nodes, wires };
}

/**
 * A node's config laid over its descriptor's defaults. Plain objects merge key
 * by key; arrays and values replace. Nothing in the result is shared with the
 * defaults, so a node may change its config without touching another's.
 */
export function mergeDefaults(defaults, config) {
  if (!_isPlain(defaults)) return _clone(config === undefined ? defaults : config);
  const out = {};
  const src = _isPlain(config) ? config : {};
  for (const key of new Set([...Object.keys(defaults), ...Object.keys(src)])) {
    const d = defaults[key];
    const c = src[key];
    out[key] = _isPlain(d) ? mergeDefaults(d, c) : _clone(c === undefined ? d : c);
  }
  return out;
}

function _clone(v) {
  if (Array.isArray(v)) return v.map(_clone);
  if (_isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, _clone(x)]));
  return v;
}

export function nodeConfig(node, desc) {
  return mergeDefaults(desc?.defaults ?? {}, node?.config);
}

/**
 * Is a stored "disabled" value in force? `true` is disabled until something
 * enables it again; a number is the time (ms) it re-enables itself, so a timed
 * disable needs no timer — it simply stops counting once the clock passes it.
 */
export function isDisabledValue(value, now = Date.now()) {
  if (value === true) return true;
  return typeof value === "number" && value > now;
}

/** The trigger nodes that fire for this event. A disabled trigger never fires. */
export function triggerNodes(graph, registry, event, ctx, { isDisabled } = {}) {
  return graph.nodes.filter(node => {
    const desc = registry.get(node.type);
    if (!desc || desc.trigger !== event) return false;
    if (isDisabled?.(node)) return false;
    try { return desc.accepts ? !!desc.accepts(ctx, nodeConfig(node, desc), node) : true; }
    catch { return false; }
  });
}

/**
 * Run the graph from the given start nodes. A start may instead be
 * {node, port}: that node is not run, and the run follows the wires out of
 * that port. It is how a node that waits on something outside the run (a Task
 * Roll waiting for a player) picks the flow up again later.
 * @returns {Promise<{steps: number, trace: string[], exhausted: boolean}>}
 *          trace is the node ids in the order they ran.
 */
export async function runGraph(graph, registry, starts, ctx, { maxSteps = MAX_STEPS, onError, isDisabled } = {}) {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const trace = [];
  let left = maxSteps;
  let exhausted = false;

  const visit = async (node, input, ctx) => {
    if (left <= 0) {
      if (!exhausted) onError?.(new Error(`Step limit of ${maxSteps} reached — is there a loop?`), node);
      exhausted = true;
      return;
    }
    left--;
    // Asked as each node is reached, not once up front: a node disabled earlier
    // in this same run (an Enable / Disable node) stops the branches after it.
    if (isDisabled?.(node)) return;
    const desc = registry.get(node.type);
    if (!desc) { onError?.(new Error(`Unknown node type "${node.type}"`), node); return; }
    trace.push(node.id);
    let ports;
    try { ports = await desc.run({ ctx, node, config: nodeConfig(node, desc), input }); }
    catch (err) { onError?.(err, node); return; }
    await follow(node, ports, ctx);
  };

  const follow = async (node, ports, ctx) => {
    if (ports == null || ports === false) return;
    for (const entry of [].concat(ports)) {
      const port = typeof entry === "string" ? entry : entry?.port;
      const branchCtx = typeof entry === "string" ? ctx : (entry?.ctx ?? ctx);
      if (!port) continue;
      for (const wire of graph.wires) {
        if (wire.from !== node.id || wire.out !== port) continue;
        const next = byId.get(wire.to);
        if (next) await visit(next, wire.in, branchCtx);
      }
    }
  };

  await Promise.all(starts.map(start => (start?.node && start.port
    ? follow(start.node, start.port, ctx)
    : visit(start, "in", ctx))));
  return { steps: maxSteps - left, trace, exhausted };
}

/**
 * Every node once, in the order a reader would follow the flow: depth first
 * from each trigger, then anything no trigger reaches. Each entry carries its
 * outgoing wires, for a listing.
 */
export function flowOrder(graph, registry) {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const seen = new Set();
  const out = [];
  const walk = node => {
    if (!node || seen.has(node.id)) return;
    seen.add(node.id);
    out.push({ node, wires: graph.wires.filter(w => w.from === node.id) });
    for (const w of graph.wires) if (w.from === node.id) walk(byId.get(w.to));
  };
  const isTrigger = n => registry.get(n.type)?.category === "trigger";
  for (const n of graph.nodes) if (isTrigger(n)) walk(n);
  for (const n of graph.nodes) walk(n);
  return out;
}
