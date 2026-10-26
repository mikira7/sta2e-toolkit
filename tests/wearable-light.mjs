// node tests/wearable-light.mjs
//
// Worn flashlights: which items count, which actor is lit, and the token-light
// plan (save the own light, re-light on a setting change, restore it).
import assert from 'node:assert/strict';

const settings = { flashlightItems: 'Flashlight, Wrist Beacon', flashlightBright: 3, flashlightDim: 6,
  flashlightAngle: 120, flashlightColor: '#fff1d0', personalShieldItems: 'Personal Forcefield' };
globalThis.game = { settings: { get: (_m, k) => settings[k] }, user: { isGM: true }, users: [] };
globalThis.foundry = { utils: { getProperty: (o, k) => k.split('.').reduce((v, p) => v?.[p], o) } };

const { isLightItem, activeWornLight, planTokenLight, flashlightLightData } =
  await import('../scripts/wearable-light.js');

const item = (type, name, flags = {}) => ({ type, name, getFlag: (_m, k) => flags[k] });

const results = [];
function check(name, fn) {
  try { fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

check('items match by trimmed, case-insensitive name; weapons never count', () => {
  assert.equal(isLightItem(item('item', '  wrist   beacon ')), true);
  assert.equal(isLightItem(item('item', 'Tricorder')), false);
  assert.equal(isLightItem(item('characterweapon2e', 'Flashlight')), false);
});

check('only a worn, unbroken flashlight lights the actor', () => {
  const off = item('item', 'Flashlight');
  const on = item('item', 'Flashlight', { worn: true });
  const broken = item('item', 'Flashlight', { worn: true, gearDamaged: true });
  assert.equal(activeWornLight({ items: [off] }), null);
  assert.equal(activeWornLight({ items: [broken] }), null);
  assert.equal(activeWornLight({ items: [off, on] }), on);
});

check('light data comes from the settings, arc included', () => {
  const l = flashlightLightData();
  assert.equal(l.angle, 120); assert.equal(l.bright, 3); assert.equal(l.dim, 6);
});

const want = flashlightLightData();
const own = { bright: 1, dim: 2, angle: 360, color: '#ff0000' };

check('putting it on saves the own light and writes the cone', () => {
  const p = planTokenLight({ wearing: true, current: own, baseline: null, want });
  assert.deepEqual(p.light, want);
  assert.deepEqual(p.baseline, own);
});

check('already lit and unchanged: nothing to write', () => {
  assert.equal(planTokenLight({ wearing: true, current: { ...want }, baseline: own, want }), null);
});

check('a setting change re-lights without touching the baseline', () => {
  const p = planTokenLight({ wearing: true, current: { ...want, dim: 4 }, baseline: own, want });
  assert.deepEqual(p.light, want);
  assert.equal(p.baseline, undefined);
});

check('taking it off restores the own light and drops the baseline', () => {
  const p = planTokenLight({ wearing: false, current: want, baseline: own, want });
  assert.deepEqual(p.light, own);
  assert.equal(p.baseline, null);
});

check('never lit by us: nothing to do', () => {
  assert.equal(planTokenLight({ wearing: false, current: own, baseline: undefined, want }), null);
});

for (const [s, n, e] of results) console.log(`${s}  ${n}${e ? `\n      ${e}` : ''}`);
if (results.some(r => r[0] === 'FAIL')) process.exit(1);
