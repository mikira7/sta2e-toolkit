// node tests/region-logic-editor.mjs
//
// The Region Logic editor's model: port geometry, wire rules, the edit
// operations (all pure — the input graph is never changed), fragments and
// duplication, view fitting and zoom, and the starter templates.
import assert from 'node:assert/strict';

const M = await import('../scripts/region-logic-editor-model.js');
const { normalizeGraph } = await import('../scripts/region-logic-graph.js');

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

/** The real node types' ports, which is all the model reads from a descriptor. */
const reg = new Map(Object.entries({
  tokenEnter: { inputs: [], outputs: ['out'] },
  tokenExit: { inputs: [], outputs: ['out'] },
  manual: { inputs: [], outputs: ['out'] },
  doorChange: { inputs: [], outputs: ['out'] },
  eachToken: { inputs: ['in'], outputs: ['each', 'none', 'done'] },
  latch: { inputs: ['on', 'off', 'toggle', 'check'], outputs: ['set', 'yes', 'no'] },
  toggleNodes: { inputs: ['disable', 'enable', 'toggle'], outputs: ['out'] },
  taskRoll: { inputs: ['in'], outputs: ['pass', 'fail'] },
  regionEmpty: { inputs: ['in'], outputs: ['yes', 'no'] },
  oncePerToken: { inputs: ['in'], outputs: ['first', 'again'] },
  cooldown: { inputs: ['in'], outputs: ['ready', 'blocked'] },
  chance: { inputs: ['in'], outputs: ['yes', 'no'] },
  switch: { inputs: ['on', 'off', 'toggle'], outputs: ['out'] },
  doors: { inputs: ['on', 'off', 'toggle'], outputs: ['out'] },
  lights: { inputs: ['on', 'off', 'toggle'], outputs: ['out'] },
  ambientSounds: { inputs: ['on', 'off', 'toggle'], outputs: ['out'] },
  teleport: { inputs: ['in'], outputs: ['out'] },
  chat: { inputs: ['in'], outputs: ['out'] },
  sound: { inputs: ['in'], outputs: ['out'] },
}));

const frozen = g => JSON.stringify(g);

await check('node height and port points follow the constants', () => {
  const node = { id: 's', type: 'switch', x: 100, y: 200 };
  const ports = M.nodePorts(node, reg.get('switch'));
  assert.equal(M.nodeHeight(ports), M.HEAD_H + M.PAD * 2 + 3 * M.ROW_H + M.FOOT_H);
  assert.deepEqual(M.portPoint(node, ports, 'in', 'off'),
    { x: 100, y: 200 + M.HEAD_H + M.PAD + M.ROW_H * 1.5 });
  assert.deepEqual(M.portPoint(node, ports, 'out', 'out'),
    { x: 100 + M.NODE_W, y: 200 + M.HEAD_H + M.PAD + M.ROW_H / 2 });
  // A trigger has no inputs and still gets one row.
  assert.equal(M.nodeHeight(M.nodePorts({}, reg.get('manual'))), M.HEAD_H + M.PAD * 2 + M.ROW_H + M.FOOT_H);
});

await check('an unknown type keeps the ports its wires use', () => {
  const g = { nodes: [{ id: 'a', type: 'gone' }, { id: 'b', type: 'chat' }],
    wires: [{ from: 'a', out: 'fizz', to: 'b', in: 'in' }, { from: 'b', out: 'out', to: 'a', in: 'buzz' }] };
  assert.deepEqual(M.nodePorts(g.nodes[0], null, g), { inputs: ['buzz'], outputs: ['fizz'] });
});

await check('wirePath leaves and arrives horizontally', () => {
  const d = M.wirePath({ x: 0, y: 0 }, { x: 200, y: 50 });
  assert.equal(d, 'M 0 0 C 100 0, 100 50, 200 50');
  // Going backwards still bows out at least 40 px each side.
  assert.equal(M.wirePath({ x: 100, y: 0 }, { x: 90, y: 0 }), 'M 100 0 C 140 0, 50 0, 90 0');
});

await check('addNode picks readable ids and snaps; the input graph is untouched', () => {
  let g = normalizeGraph({});
  const before = frozen(g);
  const a = M.addNode(g, 'chance', 33, 47, { percent: 10 });
  assert.equal(frozen(g), before);
  assert.equal(a.id, 'chance');
  assert.deepEqual(a.graph.nodes[0], { id: 'chance', type: 'chance', x: 40, y: 40, config: { percent: 10 } });
  const b = M.addNode(a.graph, 'chance', 0, 0);
  const c = M.addNode(b.graph, 'chance', 0, 0);
  assert.deepEqual([b.id, c.id], ['chance2', 'chance3']);
});

await check('wireProblem: ports must exist, no self wires, no duplicates; loops are allowed', () => {
  const g = normalizeGraph({ nodes: [{ id: 'e', type: 'tokenEnter' }, { id: 'c', type: 'chance' },
    { id: 's', type: 'switch' }], wires: [{ from: 'e', to: 'c' }] });
  assert.equal(M.wireProblem(g, reg, { from: 'c', out: 'yes', to: 's', in: 'on' }), null);
  assert.match(M.wireProblem(g, reg, { from: 'c', out: 'maybe', to: 's', in: 'on' }), /output/);
  assert.match(M.wireProblem(g, reg, { from: 'c', out: 'yes', to: 'e', in: 'in' }), /no such input/);
  assert.match(M.wireProblem(g, reg, { from: 'c', out: 'yes', to: 'c', in: 'in' }), /itself/);
  assert.match(M.wireProblem(g, reg, { from: 'e', out: 'out', to: 'c', in: 'in' }), /Already/);
  const looped = M.connect(g, reg, { from: 's', out: 'out', to: 'c', in: 'in' });
  assert.equal(looped.wires.length, 2);
  assert.equal(M.connect(g, reg, { from: 'c', out: 'yes', to: 'c', in: 'in' }), g);   // refused: same graph back
});

await check('removeNodes drops their wires; disconnect drops one wire', () => {
  const g = normalizeGraph({ nodes: [{ id: 'e', type: 'tokenEnter' }, { id: 'c', type: 'chance' },
    { id: 'm', type: 'chat' }], wires: [{ from: 'e', to: 'c' }, { from: 'c', out: 'yes', to: 'm' }] });
  const before = frozen(g);
  const r = M.removeNodes(g, ['c']);
  assert.deepEqual(r.nodes.map(n => n.id), ['e', 'm']);
  assert.equal(r.wires.length, 0);
  const d = M.disconnect(g, M.wireKey(g.wires[1]));
  assert.deepEqual(d.wires, [g.wires[0]]);
  assert.equal(frozen(g), before);
});

await check('moveNodes shifts and snaps only the chosen nodes', () => {
  const g = normalizeGraph({ nodes: [{ id: 'a', type: 'chat', x: 40, y: 40 }, { id: 'b', type: 'chat', x: 0, y: 0 }] });
  const m = M.moveNodes(g, ['a'], 13, 27);
  assert.deepEqual([m.nodes[0].x, m.nodes[0].y, m.nodes[1].x], [60, 60, 0]);
  assert.deepEqual([M.moveNodes(g, ['a'], 13, 27, false).nodes[0].x], [53]);
});

await check('setPath / setNodeConfig write dotted paths without sharing', () => {
  const cfg = { sequence: { stepDelay: 0 } };
  const out = M.setPath(cfg, 'sequence.perStep', 2);
  assert.deepEqual(out, { sequence: { stepDelay: 0, perStep: 2 } });
  assert.deepEqual(cfg, { sequence: { stepDelay: 0 } });
  assert.deepEqual(M.setPath({}, 'on.color', null), { on: { color: null } });
  assert.equal(M.getPath({ a: { b: 3 } }, 'a.b'), 3);
  assert.equal(M.getPath({ a: null }, 'a.b'), undefined);
  const g = normalizeGraph({ nodes: [{ id: 's', type: 'switch' }] });
  const next = M.setNodeConfig(g, 's', 'doors', ['Scene.x.Wall.y']);
  assert.deepEqual(next.nodes[0].config, { doors: ['Scene.x.Wall.y'] });
  assert.deepEqual(g.nodes[0].config, {});
});

await check('titles are trimmed, capped and survive normalizeGraph; blank removes', () => {
  const g = normalizeGraph({ nodes: [{ id: 'a', type: 'chat' }] });
  const t = M.setNodeTitle(g, 'a', '  Bridge alarm  ');
  assert.equal(t.nodes[0].title, 'Bridge alarm');
  assert.equal(normalizeGraph(t).nodes[0].title, 'Bridge alarm');
  assert.equal(M.setNodeTitle(g, 'a', 'x'.repeat(80)).nodes[0].title.length, 60);
  assert.ok(!('title' in M.setNodeTitle(t, 'a', '   ').nodes[0]));
  assert.ok(!('title' in normalizeGraph({ nodes: [{ id: 'a', type: 'chat', title: 5 }] }).nodes[0]));
});

await check('node references follow a rename; outside ids are kept', () => {
  const g = normalizeGraph({ nodes: [{ id: 'teleport', type: 'teleport' }, { id: 'keep', type: 'chat' }] });
  const { graph } = M.insertFragment(g, { nodes: [
    { id: 'teleport', type: 'teleport' },
    { id: 'rest', type: 'toggleNodes', config: { nodes: ['teleport', 'keep'] } },
  ] });
  assert.deepEqual(graph.nodes.find(n => n.id === 'rest').config.nodes, ['teleport2', 'keep']);
  const dup = M.duplicateNodes(graph, ['rest']).graph;   // alone: still points at the originals
  assert.deepEqual(dup.nodes.at(-1).config.nodes, ['teleport2', 'keep']);
});

await check('duplicateNodes copies the inner wires only, with fresh ids', () => {
  const g = normalizeGraph({ nodes: [{ id: 'e', type: 'tokenEnter' }, { id: 'c', type: 'chance', x: 300 },
    { id: 'm', type: 'chat', x: 600 }], wires: [{ from: 'e', to: 'c' }, { from: 'c', out: 'yes', to: 'm' }] });
  const { graph, ids } = M.duplicateNodes(g, ['c', 'm']);
  assert.deepEqual(ids, ['c2', 'm2']);   // named after the originals
  assert.equal(graph.nodes.length, 5);
  assert.equal(graph.wires.length, 3);
  assert.deepEqual(graph.wires[2], { from: 'c2', out: 'yes', to: 'm2', in: 'in' });
  assert.equal(graph.nodes.find(n => n.id === 'c2').x, 340);
});

await check('insertFragment renames only clashing ids and keeps the wires on them', () => {
  const g = normalizeGraph({ nodes: [{ id: 'enter', type: 'tokenEnter' }] });
  const { graph, ids } = M.insertFragment(g, {
    nodes: [{ id: 'enter', type: 'tokenEnter' }, { id: 'tele', type: 'teleport', x: 260 }],
    wires: [{ from: 'enter', to: 'tele' }],
  }, 0, 200);
  assert.deepEqual(ids, ['enter2', 'tele']);
  assert.deepEqual(graph.wires, [{ from: 'enter2', out: 'out', to: 'tele', in: 'in' }]);
  assert.equal(graph.nodes[1].y, 200);
});

await check('freeSpot steps below every node in the way', () => {
  const h = M.nodeHeight({ inputs: ['in'], outputs: ['out'] });
  const g = normalizeGraph({ nodes: [{ id: 'a', type: 'chat', x: 0, y: 0 }, { id: 'b', type: 'chat', x: 0, y: 200 }] });
  assert.deepEqual(M.freeSpot(normalizeGraph({}), reg, 13, 7), { x: 20, y: 0 });
  const spot = M.freeSpot(g, reg, 0, 10, h);
  assert.equal(spot.x, 0);
  assert.ok(spot.y >= 200 + h + M.GRID, `landed at ${spot.y}, inside b`);
  assert.deepEqual(M.freeSpot(g, reg, 600, 0, h), { x: 600, y: 0 });   // clear to the right
});

await check('fitView centres the bounds; zoomAbout keeps the pointer still', () => {
  const v = M.fitView({ x: 0, y: 0, width: 400, height: 200 }, 880, 480);
  assert.equal(v.zoom, 1.1);
  assert.ok(Math.abs(v.x - (880 - 440) / 2) < 1e-9);
  const tiny = M.fitView({ x: 0, y: 0, width: 20000, height: 100 }, 800, 600);
  assert.equal(tiny.zoom, M.ZOOM_MIN);
  const view = { x: 10, y: 20, zoom: 1 };
  const z = M.zoomAbout(view, 2, 110, 120);
  // The graph point under (110, 120) was (100, 100) and still is.
  assert.deepEqual([(110 - z.x) / z.zoom, (120 - z.y) / z.zoom], [100, 100]);
  assert.equal(M.zoomAbout(view, 100, 0, 0).zoom, M.ZOOM_MAX);
});

await check('every template builds a valid graph whose wires fit their ports', () => {
  for (const tpl of M.TEMPLATES) {
    const g = normalizeGraph(tpl.build());
    assert.ok(g.nodes.length, tpl.id);
    assert.equal(g.wires.length, tpl.build().wires.length, `${tpl.id} lost a wire`);
    for (const w of g.wires) {
      const probe = { ...g, wires: g.wires.filter(x => x !== w) };
      assert.equal(M.wireProblem(probe, reg, w), null, `${tpl.id}: ${M.wireKey(w)}`);
    }
    assert.ok(g.nodes.some(n => ['tokenEnter', 'tokenExit', 'manual', 'doorChange'].includes(n.type)), `${tpl.id} has no trigger`);
  }
});

await check('insertTemplate goes to the origin when empty, below the flow otherwise', () => {
  const first = M.insertTemplate(normalizeGraph({}), reg, 'teleport');
  assert.deepEqual(first.ids, ['enter', 'teleport']);
  assert.equal(first.graph.nodes[0].y, 0);
  const second = M.insertTemplate(first.graph, reg, 'trap');
  const bottom = M.graphBounds(first.graph, reg);
  const added = second.graph.nodes.filter(n => second.ids.includes(n.id));
  assert.ok(added.every(n => n.y >= bottom.y + bottom.height), 'overlaps the existing flow');
  assert.ok(second.ids.includes('enter2'));
  assert.deepEqual(M.insertTemplate(first.graph, reg, 'nope').ids, []);
});

let failed = 0;
for (const [status, name, msg] of results) {
  console.log(`${status}  ${name}${msg ? ` — ${msg}` : ''}`);
  if (status === 'FAIL') failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
