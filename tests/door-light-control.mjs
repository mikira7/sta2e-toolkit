// node tests/door-light-control.mjs
//
// Door & Light Control: what each state switch writes — door states, light and
// sound on/off, and the save-on-ON / restore-on-OFF rule for light looks.
import assert from 'node:assert/strict';

const { planDoorLight, orderUpdates, groupUpdates, normalizeGroup } = await import('../scripts/door-light-plan.js');

const door  = (over = {}) => ({ uuid: 'W1', kind: 'door', isDoor: true, ds: 0, ...over });
const light = (over = {}) => ({ uuid: 'L1', kind: 'light', hidden: false, color: '#ffffff', alpha: 0.5, animation: null, ...over });
const sound = (over = {}) => ({ uuid: 'S1', kind: 'sound', hidden: true, ...over });

const results = [];
function check(name, fn) {
  try { fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

check('doors open, close and lock', () => {
  assert.deepEqual(planDoorLight({ targets: [door()], state: { door: 'open' }, activating: true }).updates,
    [{ uuid: 'W1', kind: 'door', changes: { ds: 1 } }]);
  assert.deepEqual(planDoorLight({ targets: [door({ ds: 1 })], state: { door: 'locked' }, activating: true }).updates[0].changes,
    { ds: 2 });
  assert.deepEqual(planDoorLight({ targets: [door({ ds: 1 })], state: { door: 'closed' }, activating: false }).updates[0].changes,
    { ds: 0 });
});

check('no change when already there, blank, or not a door', () => {
  assert.equal(planDoorLight({ targets: [door({ ds: 1 })], state: { door: 'open' }, activating: true }).updates.length, 0);
  assert.equal(planDoorLight({ targets: [door()], state: { door: '' }, activating: true }).updates.length, 0);
  assert.equal(planDoorLight({ targets: [door({ isDoor: false })], state: { door: 'open' }, activating: true }).updates.length, 0);
});

check('lights and sounds switch on and off', () => {
  const on = planDoorLight({ targets: [light({ hidden: true }), sound()], state: { light: 'on', sound: 'on' }, activating: true });
  assert.deepEqual(on.updates.map(u => u.changes), [{ hidden: false }, { hidden: false }]);
  const off = planDoorLight({ targets: [light(), sound({ hidden: false })], state: { light: 'off', sound: 'off' }, activating: false });
  assert.deepEqual(off.updates.map(u => u.changes), [{ hidden: true }, { hidden: true }]);
});

check('ON saves the look and applies it; OFF with blanks restores it', () => {
  const on = planDoorLight({ targets: [light()], state: { color: '#ff0000', alpha: 0.9, animation: 'pulse' }, activating: true });
  assert.deepEqual(on.updates[0].changes, { color: '#ff0000', alpha: 0.9, animation: 'pulse' });
  assert.deepEqual(on.saved.L1, { color: '#ffffff', alpha: 0.5, animation: null });

  const lit = light({ color: '#ff0000', alpha: 0.9, animation: 'pulse' });
  const off = planDoorLight({ targets: [lit], state: {}, activating: false, saved: on.saved });
  assert.deepEqual(off.updates[0].changes, { color: '#ffffff', alpha: 0.5, animation: null });
  assert.equal(off.saved.L1, undefined);
});

check('a second ON keeps the first saved look', () => {
  const saved = { L1: { color: '#ffffff', alpha: 0.5, animation: null } };
  const again = planDoorLight({ targets: [light({ color: '#ff0000' })], state: { color: '#00ff00' }, activating: true, saved });
  assert.deepEqual(again.saved.L1, saved.L1);
});

check('OFF with its own look uses it instead of the saved one', () => {
  const saved = { L1: { color: '#ffffff', alpha: 0.5, animation: null } };
  const off = planDoorLight({ targets: [light({ color: '#ff0000' })], state: { color: '#0000ff' }, activating: false, saved });
  assert.equal(off.updates[0].changes.color, '#0000ff');
  assert.equal(off.updates[0].changes.alpha, undefined);   // already 0.5
});

check('"none" animation clears it; OFF with nothing saved changes nothing', () => {
  const on = planDoorLight({ targets: [light({ animation: 'torch' })], state: { animation: 'none' }, activating: true });
  assert.deepEqual(on.updates[0].changes, { animation: null });
  assert.equal(planDoorLight({ targets: [light()], state: {}, activating: false }).updates.length, 0);
});

check('sequence order: forward, reverse when switching off, random', () => {
  const ups = ['a', 'b', 'c', 'd'].map(uuid => ({ uuid }));
  const ids = list => list.map(u => u.uuid).join('');
  assert.equal(ids(orderUpdates(ups, 'forward', true)), 'abcd');
  assert.equal(ids(orderUpdates(ups, 'forward', false)), 'abcd');
  assert.equal(ids(orderUpdates(ups, 'reverseOff', true)), 'abcd');
  assert.equal(ids(orderUpdates(ups, 'reverseOff', false)), 'dcba');
  const shuffled = orderUpdates(ups, 'random', true, () => 0);
  assert.equal(ids(shuffled), 'bcda');
  assert.equal([...ids(shuffled)].sort().join(''), 'abcd');
  assert.equal(ids(ups), 'abcd');   // input untouched
});

check('groups are cut from the list, per kind, before skipping', () => {
  const targets = [
    { uuid: 'W1', kind: 'door' },
    { uuid: 'L1', kind: 'light' }, { uuid: 'L2', kind: 'light' },
    { uuid: 'L3', kind: 'light' }, { uuid: 'L4', kind: 'light' }, { uuid: 'L5', kind: 'light' },
  ];
  const ids = groups => groups.map(g => g.map(u => u.uuid).join('+'));
  const all = targets.map(t => ({ uuid: t.uuid }));
  assert.deepEqual(ids(groupUpdates(all, targets, { perStep: 2 })), ['W1', 'L1+L2', 'L3+L4', 'L5']);
  // L2 already on: L1 stays alone in its pair rather than pulling L3 in.
  const someOn = all.filter(u => u.uuid !== 'L2');
  assert.deepEqual(ids(groupUpdates(someOn, targets, { perStep: 2 })), ['W1', 'L1', 'L3+L4', 'L5']);
  // A group with nothing to change is dropped.
  const noPair = all.filter(u => u.uuid !== 'L3' && u.uuid !== 'L4');
  assert.deepEqual(ids(groupUpdates(noPair, targets, { perStep: 2 })), ['W1', 'L1+L2', 'L5']);
  // 1 per step (and junk) is one at a time.
  assert.equal(groupUpdates(all, targets, { perStep: 1 }).length, 6);
  assert.equal(groupUpdates(all, targets, { perStep: 0 }).length, 6);
});

check('reversing groups keeps each group together', () => {
  const targets = ['L1', 'L2', 'L3', 'L4'].map(uuid => ({ uuid, kind: 'light' }));
  const groups = groupUpdates(targets.map(t => ({ uuid: t.uuid })), targets, { perStep: 2 });
  const back = orderUpdates(groups, 'reverseOff', false).map(g => g.map(u => u.uuid).join('+'));
  assert.deepEqual(back, ['L3+L4', 'L1+L2']);
});

check('picked groups: by number, across kinds, loose ones last', () => {
  const targets = [
    { uuid: 'W1', kind: 'door',  group: 2 },
    { uuid: 'L1', kind: 'light', group: 1 }, { uuid: 'L2', kind: 'light', group: 2 },
    { uuid: 'L3', kind: 'light', group: null }, { uuid: 'L4', kind: 'light', group: 1 },
    { uuid: 'S1', kind: 'sound', group: '10' }, { uuid: 'L5', kind: 'light', group: '' },
  ];
  const ids = groups => groups.map(g => g.map(u => u.uuid).join('+'));
  const all = targets.map(t => ({ uuid: t.uuid }));
  // 10 sorts after 2 as a number, not as text; loose L3 and L5 each step alone.
  assert.deepEqual(ids(groupUpdates(all, targets, { byTag: true })), ['L1+L4', 'W1+L2', 'S1', 'L3', 'L5']);
  // A numbered group with nothing to change costs no step.
  const noOne = all.filter(u => u.uuid !== 'L1' && u.uuid !== 'L4');
  assert.deepEqual(ids(groupUpdates(noOne, targets, { byTag: true })), ['W1+L2', 'S1', 'L3', 'L5']);
});

check('group numbers are normalised', () => {
  assert.equal(normalizeGroup(''), null);
  assert.equal(normalizeGroup(null), null);
  assert.equal(normalizeGroup(0), null);
  assert.equal(normalizeGroup('junk'), null);
  assert.equal(normalizeGroup('3'), 3);
  assert.equal(normalizeGroup(2.7), 2);
});

let failed = 0;
for (const [status, name, msg] of results) {
  console.log(`${status}  ${name}${msg ? ` — ${msg}` : ''}`);
  if (status === 'FAIL') failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
