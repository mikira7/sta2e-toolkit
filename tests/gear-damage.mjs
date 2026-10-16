// node tests/gear-damage.mjs
//
// Damaged / broken gear: which items it applies to, the per-kind wording, the
// legacy forcefield flag, and the weapon gate. gear-damage.js is a leaf, so it
// loads under node with a few Foundry globals stubbed.
import assert from 'node:assert/strict';

const warnings = [];
globalThis.ui = { notifications: { warn: (m) => warnings.push(m) } };
globalThis.game = { settings: { get: () => 'Personal Forcefield, Personal Shield' } };
globalThis.foundry = { utils: { getProperty: (o, k) => k.split('.').reduce((v, p) => v?.[p], o) } };

const { isDamageable, isGearDamaged, gearKind, gearDamageWords, assertWeaponUsable, gearDamageChanged, setGearDamaged,
  storedGearDamagePotency, setGearDamagePotency, gearDamagePotencyChanged } =
  await import('../scripts/gear-damage.js');

function item(type, name, flags = {}) {
  const store = { ...flags };
  return {
    type, name, isOwner: true,
    getFlag: (_m, k) => store[k],
    setFlag: async (_m, k, v) => { store[k] = v; },
    update: async (u) => {
      for (const [k, v] of Object.entries(u)) {
        if (k.includes('-=')) delete store[k.split('-=')[1]];
        else store[k.split('.').pop()] = v;
      }
    },
    _store: store,
  };
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

await check('applies to character weapons, armour and gear — not ship weapons', () => {
  assert.equal(isDamageable(item('characterweapon2e', 'Phaser')), true);
  assert.equal(isDamageable(item('armor', 'Body Armor')), true);
  assert.equal(isDamageable(item('item', 'Tricorder')), true);
  assert.equal(isDamageable(item('starshipweapon2e', 'Phaser Array')), false);
  assert.equal(isDamageable(item('talent', 'Bold')), false);
});

await check('kind and wording follow the item', () => {
  assert.equal(gearKind(item('characterweapon2e', 'Phaser')), 'weapon');
  assert.equal(gearKind(item('armor', '  personal  FORCEFIELD ')), 'forcefield');
  assert.equal(gearKind(item('armor', 'Body Armor')), 'armor');
  assert.equal(gearDamageWords(item('characterweapon2e', 'x')).state, 'Broken');
  assert.equal(gearDamageWords(item('item', 'Personal Shield')).fix, 'Recharge');
  assert.equal(gearDamageWords(item('armor', 'Vest')).fixed, 'repaired');
});

await check('the old forcefield flag still reads as damaged, and repair clears both', async () => {
  const ff = item('armor', 'Personal Forcefield', { forcefieldBurntOut: true });
  assert.equal(isGearDamaged(ff), true);
  await setGearDamaged(ff, false);
  assert.equal(isGearDamaged(ff), false);
  await setGearDamaged(ff, true);
  assert.equal(ff._store.gearDamaged, true);
});

await check('a broken weapon is refused with a notice; a working one passes', () => {
  warnings.length = 0;
  assert.equal(assertWeaponUsable(item('characterweapon2e', 'Phaser')), true);
  assert.equal(assertWeaponUsable(item('characterweapon2e', 'Phaser', { gearDamaged: true })), false);
  assert.equal(warnings.length, 1);
  // Damaged armour is not a weapon — the gate ignores it.
  assert.equal(assertWeaponUsable(item('armor', 'Vest', { gearDamaged: true })), true);
});

await check('change detection sees both set and unset spellings', () => {
  assert.equal(gearDamageChanged({ flags: { 'sta2e-toolkit': { gearDamaged: true } } }), true);
  assert.equal(gearDamageChanged({ flags: { 'sta2e-toolkit': { '-=gearDamaged': null } } }), true);
  assert.equal(gearDamageChanged({ flags: { 'sta2e-toolkit': { '-=forcefieldBurntOut': null } } }), true);
  assert.equal(gearDamageChanged({ name: 'x' }), false);
});

await check('potency: set with the damage, clamped 1-5, cleared on repair; 0 when working', async () => {
  const w = item('characterweapon2e', 'Phaser');
  assert.equal(storedGearDamagePotency(w), 0);
  await setGearDamaged(w, true, { potency: 3 });
  assert.equal(storedGearDamagePotency(w), 3);
  await setGearDamagePotency(w, 9);
  assert.equal(storedGearDamagePotency(w), 5);
  await setGearDamaged(w, false);
  assert.equal(w._store.gearDamagePotency, undefined);
  await setGearDamaged(w, true);
  assert.equal(storedGearDamagePotency(w), 1);
});

await check('potency changes are told apart from state changes', () => {
  const c = { flags: { 'sta2e-toolkit': { gearDamagePotency: 2 } } };
  assert.equal(gearDamagePotencyChanged(c), true);
  assert.equal(gearDamageChanged(c), false);
});

let failed = 0;
for (const [status, name, msg] of results) {
  if (status === 'FAIL') failed++;
  console.log(`${status}  ${name}${msg ? `\n      ${msg}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
