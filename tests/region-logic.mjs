// node tests/region-logic.mjs
//
// Region Logic: the graph runner (ports, multiple inputs, branching, the step
// budget, errors), config defaults, trigger selection, the flow listing, and
// the graphs built from Door & Light Control and Random Teleport.
import assert from 'node:assert/strict';

const {
  normalizeGraph, mergeDefaults, triggerNodes, runGraph, flowOrder,
} = await import('../scripts/region-logic-graph.js');
const { graphFromDoorLight, graphFromRandomTeleport } = await import('../scripts/region-logic-convert.js');
const { isDisabledValue } = await import('../scripts/region-logic-graph.js');
const { doorEvents, rememberDoorState, forgetDoorStates, DOOR_STATE } = await import('../scripts/region-logic-doors.js');

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

/** A registry whose nodes log what ran into ctx.log. */
function registry(extra = {}) {
  const reg = new Map();
  const add = d => reg.set(d.type, { inputs: ['in'], outputs: ['out'], defaults: {}, ...d });
  add({ type: 'enter', category: 'trigger', trigger: 'tokenEnter', inputs: [],
    accepts: (ctx, c) => !c.only || ctx.who === c.only, run: () => 'out' });
  add({ type: 'manual', category: 'trigger', trigger: 'manual', inputs: [],
    accepts: (ctx, c, node) => !ctx.nodeId || ctx.nodeId === node.id, run: () => 'out' });
  add({ type: 'if', category: 'condition', outputs: ['yes', 'no'], defaults: { pass: true },
    run: ({ config }) => (config.pass ? 'yes' : 'no') });
  add({ type: 'log', defaults: { tag: 'x' },
    run: ({ ctx, config, input }) => { ctx.log.push(`${config.tag}:${input}`); return 'out'; } });
  add({ type: 'both', outputs: ['a', 'b'], run: () => ['a', 'b'] });
  add({ type: 'stop', run: () => null });
  add({ type: 'boom', run: () => { throw new Error('boom'); } });
  for (const [type, d] of Object.entries(extra)) add({ type, ...d });
  return reg;
}

const n = (id, type, config = {}) => ({ id, type, config });
const w = (from, to, out = 'out', input = 'in') => ({ from, out, to, in: input });

await check('normalizeGraph drops bad nodes, duplicates and dangling wires', () => {
  const g = normalizeGraph({
    nodes: [n('a', 'log'), n('a', 'log'), { id: '', type: 'log' }, { id: 'b' }, n('c', 'log'), null],
    wires: [w('a', 'c'), w('a', 'c'), w('a', 'zz'), { from: 'c', to: 'a' }],
  });
  assert.deepEqual(g.nodes.map(x => x.id), ['a', 'c']);
  assert.deepEqual(g.wires, [w('a', 'c'), w('c', 'a')]);   // a missing port defaults to out → in
  assert.deepEqual(normalizeGraph(null), { version: 1, nodes: [], wires: [] });
});

await check('mergeDefaults lays config over defaults without sharing them', () => {
  const defaults = { a: 1, nested: { b: 2, c: 3 }, list: [1, 2] };
  const out = mergeDefaults(defaults, { nested: { c: 9 }, extra: true });
  assert.deepEqual(out, { a: 1, nested: { b: 2, c: 9 }, list: [1, 2], extra: true });
  out.nested.b = 100; out.list.push(3);
  assert.equal(defaults.nested.b, 2);
  assert.deepEqual(defaults.list, [1, 2]);
  assert.deepEqual(mergeDefaults({ list: [1] }, { list: [] }).list, []);   // an array replaces
  assert.equal(mergeDefaults({ color: null }, { color: '#ff0000' }).color, '#ff0000');
});

await check('triggerNodes picks the event and asks accepts()', () => {
  const g = normalizeGraph({ nodes: [n('e1', 'enter'), n('e2', 'enter', { only: 'pc' }), n('m', 'manual'), n('l', 'log')] });
  const reg = registry();
  assert.deepEqual(triggerNodes(g, reg, 'tokenEnter', { who: 'npc' }).map(x => x.id), ['e1']);
  assert.deepEqual(triggerNodes(g, reg, 'tokenEnter', { who: 'pc' }).map(x => x.id), ['e1', 'e2']);
  assert.deepEqual(triggerNodes(g, reg, 'manual', {}).map(x => x.id), ['m']);
  assert.deepEqual(triggerNodes(g, reg, 'manual', { nodeId: 'nope' }).map(x => x.id), []);
});

await check('runs follow the returned port, and a node knows which input fired', async () => {
  const g = normalizeGraph({
    nodes: [n('t', 'enter'), n('c', 'if', { pass: false }), n('y', 'log', { tag: 'Y' }), n('no', 'log', { tag: 'N' })],
    wires: [w('t', 'c'), w('c', 'y', 'yes', 'on'), w('c', 'no', 'no', 'off')],
  });
  const ctx = { log: [] };
  const reg = registry();
  const { trace } = await runGraph(g, reg, triggerNodes(g, reg, 'tokenEnter', ctx), ctx);
  assert.deepEqual(ctx.log, ['N:off']);
  assert.deepEqual(trace, ['t', 'c', 'no']);
});

await check('several ports and several wires run in order; null stops', async () => {
  const g = normalizeGraph({
    nodes: [n('t', 'enter'), n('f', 'both'), n('a1', 'log', { tag: 'a1' }), n('a2', 'log', { tag: 'a2' }),
      n('b', 'log', { tag: 'b' }), n('s', 'stop'), n('never', 'log', { tag: 'never' })],
    wires: [w('t', 'f'), w('f', 'a1', 'a'), w('f', 'a2', 'a'), w('f', 'b', 'b'), w('b', 's'), w('s', 'never')],
  });
  const ctx = { log: [] };
  const reg = registry();
  await runGraph(g, reg, triggerNodes(g, reg, 'tokenEnter', ctx), ctx);
  assert.deepEqual(ctx.log, ['a1:in', 'a2:in', 'b:in']);
});

await check('a loop stops at the step budget and is reported once', async () => {
  const g = normalizeGraph({ nodes: [n('t', 'enter'), n('l', 'log')], wires: [w('t', 'l'), w('l', 'l')] });
  const ctx = { log: [] };
  const errors = [];
  const reg = registry();
  const res = await runGraph(g, reg, triggerNodes(g, reg, 'tokenEnter', ctx), ctx,
    { maxSteps: 10, onError: e => errors.push(e.message) });
  assert.equal(res.exhausted, true);
  assert.equal(ctx.log.length, 9);
  assert.equal(errors.length, 1);
});

await check('a throwing node or unknown type stops only its branch', async () => {
  const g = normalizeGraph({
    nodes: [n('t', 'enter'), n('f', 'both'), n('x', 'boom'), n('after', 'log', { tag: 'after' }),
      n('u', 'mystery'), n('ok', 'log', { tag: 'ok' })],
    wires: [w('t', 'f'), w('f', 'x', 'a'), w('x', 'after'), w('f', 'u', 'b'), w('f', 'ok', 'b')],
  });
  const ctx = { log: [] };
  const errors = [];
  const reg = registry();
  await runGraph(g, reg, triggerNodes(g, reg, 'tokenEnter', ctx), ctx, { onError: e => errors.push(e.message) });
  assert.deepEqual(ctx.log, ['ok:in']);
  assert.deepEqual(errors, ['boom', 'Unknown node type "mystery"']);
});

await check('starts run at once, so a waiting trigger does not hold up another', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const reg = registry({ slow: { run: async ({ ctx }) => { await gate; ctx.log.push('slow'); return 'out'; } } });
  const g = normalizeGraph({
    nodes: [n('t1', 'enter'), n('t2', 'enter'), n('s', 'slow'), n('f', 'log', { tag: 'fast' })],
    wires: [w('t1', 's'), w('t2', 'f')],
  });
  const ctx = { log: [] };
  const done = runGraph(g, reg, triggerNodes(g, reg, 'tokenEnter', ctx), ctx);
  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(ctx.log, ['fast:in']);
  release();
  await done;
  assert.deepEqual(ctx.log, ['fast:in', 'slow']);
});

await check('a {port, ctx} entry gives its branch its own context, branches in order', async () => {
  const reg = registry({
    each: { outputs: ['each', 'none'],
      run: ({ ctx }) => ctx.tokens.map(token => ({ port: 'each', ctx: { ...ctx, token } })) },
    act: { run: async ({ ctx }) => {
      await new Promise(r => setTimeout(r, ctx.token === 'A' ? 20 : 0));   // A is slow: order must still hold
      ctx.log.push(`start:${ctx.token}`);
      ctx.token = `${ctx.token}-moved`;                                     // like a teleport's landed token
      return 'out';
    } },
    after: { run: ({ ctx }) => { ctx.log.push(`after:${ctx.token}`); return 'out'; } },
  });
  const g = normalizeGraph({
    nodes: [n('t', 'enter'), n('e', 'each'), n('a', 'act'), n('z', 'after')],
    wires: [w('t', 'e'), w('e', 'a', 'each'), w('a', 'z')],
  });
  const ctx = { log: [], tokens: ['A', 'B'], token: null };
  await runGraph(g, reg, triggerNodes(g, reg, 'tokenEnter', ctx), ctx);
  assert.deepEqual(ctx.log, ['start:A', 'after:A-moved', 'start:B', 'after:B-moved']);
  assert.equal(ctx.token, null);   // the trigger's own context was never touched
});

await check('a disabled node: its trigger never fires, and a branch stops at it', async () => {
  const off = new Set();
  const isDisabled = node => off.has(node.id);
  const reg = registry({
    disabler: { run: ({ ctx }) => { off.add('second'); return 'out'; } },
  });
  const g = normalizeGraph({
    nodes: [n('t', 'enter'), n('t2', 'enter'), n('d', 'disabler'), n('first', 'log', { tag: '1' }),
      n('second', 'log', { tag: '2' })],
    wires: [w('t', 'first'), w('first', 'd'), w('d', 'second')],
  });
  off.add('t2');
  const ctx = { log: [] };
  const starts = triggerNodes(g, reg, 'tokenEnter', ctx, { isDisabled });
  assert.deepEqual(starts.map(x => x.id), ['t']);
  const { trace } = await runGraph(g, reg, starts, ctx, { isDisabled });
  assert.deepEqual(ctx.log, ['1:in']);          // disabled mid-run by the node before it
  assert.deepEqual(trace, ['t', 'first', 'd']);
  assert.equal(isDisabledValue(true), true);
  assert.equal(isDisabledValue(false), false);
  assert.equal(isDisabledValue(5000, 4000), true);
  assert.equal(isDisabledValue(5000, 5000), false);   // a timed disable has run out
  assert.equal(isDisabledValue(undefined), false);
});

await check('a {node, port} start resumes from that port without running the node', async () => {
  const reg = registry();
  const g = normalizeGraph({
    nodes: [n('t', 'enter'), n('c', 'if'), n('y', 'log', { tag: 'Y' }), n('no', 'log', { tag: 'N' })],
    wires: [w('t', 'c'), w('c', 'y', 'yes'), w('c', 'no', 'no')],
  });
  const ctx = { log: [] };
  const { trace } = await runGraph(g, reg, [{ node: g.nodes[1], port: 'no' }], ctx);
  assert.deepEqual(trace, ['no']);
  assert.deepEqual(ctx.log, ['N:in']);
});

await check('doorEvents: unlocked needs a known locked state before', () => {
  const { CLOSED, OPEN, LOCKED } = DOOR_STATE;
  assert.deepEqual(doorEvents(LOCKED, CLOSED), ['changed', 'closed', 'unlocked']);
  assert.deepEqual(doorEvents(LOCKED, OPEN), ['changed', 'opened', 'unlocked']);
  assert.deepEqual(doorEvents(CLOSED, LOCKED), ['changed', 'locked']);
  assert.deepEqual(doorEvents(OPEN, CLOSED), ['changed', 'closed']);
  assert.deepEqual(doorEvents(undefined, CLOSED), ['changed', 'closed']);   // never seen: not "unlocked"
  assert.deepEqual(doorEvents(OPEN, OPEN), []);
  forgetDoorStates();
  assert.equal(rememberDoorState('W', LOCKED), undefined);
  assert.equal(rememberDoorState('W', CLOSED), LOCKED);
  rememberDoorState('W', undefined);
  assert.equal(rememberDoorState('W', OPEN), undefined);
});

await check('flowOrder lists triggers first, depth first, then unreached nodes', () => {
  const g = normalizeGraph({
    nodes: [n('orphan', 'log'), n('c', 'if'), n('t', 'enter'), n('y', 'log')],
    wires: [w('t', 'c'), w('c', 'y', 'yes')],
  });
  assert.deepEqual(flowOrder(g, registry()).map(e => e.node.id), ['t', 'c', 'y', 'orphan']);
});

// ── Conversion ───────────────────────────────────────────────────────────────

const ports = g => g.wires.map(x => `${x.from}.${x.out}>${x.to}.${x.in}`).sort();

await check('Door & Light presence: enter → on, leave → nobody else inside → off, plus buttons', () => {
  const g = graphFromDoorLight({ trigger: 'presence', triggerBy: 'players', onLeave: 'off',
    doors: ['Scene.s.Wall.w'], lights: ['Scene.s.AmbientLight.l'], sounds: [],
    sequence: { stepDelay: 200 }, on: { light: 'on' }, off: { light: 'off' } });
  assert.deepEqual(ports(g), [
    'empty.yes>switch.off', 'enter.out>switch.on', 'exit.out>empty.in',
    'manualOff.out>switch.off', 'manualOn.out>switch.on',
  ]);
  const sw = g.nodes.find(x => x.id === 'switch');
  assert.deepEqual(sw.config.doors, ['Scene.s.Wall.w']);
  assert.equal(sw.config.sequence.stepDelay, 200);
  assert.equal(g.nodes.find(x => x.id === 'enter').config.who, 'players');
  assert.equal(g.nodes.find(x => x.id === 'empty').config.who, 'players');
  assert.ok(g.nodes.every(x => !('port' in x)));
  assert.deepEqual(normalizeGraph(g).wires.length, g.wires.length);   // survives normalising
});

await check('Door & Light toggle with once and cooldown gates the toggle input', () => {
  const g = graphFromDoorLight({ trigger: 'toggle', oncePerToken: true, cooldown: 5 });
  assert.deepEqual(ports(g), [
    'cooldown.ready>switch.toggle', 'enter.out>once.in', 'manualOff.out>switch.off',
    'manualOn.out>switch.on', 'once.first>cooldown.in',
  ]);
  assert.equal(g.nodes.find(x => x.id === 'cooldown').config.seconds, 5);
});

await check('Door & Light manual has only the buttons; Keep As Is drops the leave branch', () => {
  assert.deepEqual(ports(graphFromDoorLight({ trigger: 'manual' })),
    ['manualOff.out>switch.off', 'manualOn.out>switch.on']);
  const keep = graphFromDoorLight({ trigger: 'presence', onLeave: 'keep' });
  assert.ok(!keep.nodes.some(x => x.id === 'exit'));
});

await check('Random Teleport: any token, no wait, ignores displacement, keeps its settings', () => {
  const g = graphFromRandomTeleport({ destinations: ['Scene.s.Region.a', 'Scene.s.Region.b'], delay: 1500,
    noRepeat: false, oncePerToken: true, transition: { type: 'fade', duration: 900 } });
  assert.deepEqual(ports(g), ['enter.out>once.in', 'once.first>teleport.in']);
  assert.deepEqual(g.nodes.find(x => x.id === 'enter').config, { who: 'any', waitSeen: false, ignoreDisplace: true });
  const tp = g.nodes.find(x => x.id === 'teleport').config;
  assert.deepEqual(tp.destinations, ['Scene.s.Region.a', 'Scene.s.Region.b']);
  assert.equal(tp.delay, 1500);
  assert.equal(tp.noRepeat, false);
  assert.deepEqual(tp.transition, { type: 'fade', duration: 900 });
});

let failed = 0;
for (const [status, name, msg] of results) {
  console.log(`${status}  ${name}${msg ? ` — ${msg}` : ''}`);
  if (status === 'FAIL') failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
