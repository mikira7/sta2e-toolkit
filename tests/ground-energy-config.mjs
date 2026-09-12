// node --experimental-vm-modules tests/ground-energy-config.mjs
// Real config resolver and fireWeapon dispatch, isolated from ship dependencies.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../scripts/weapon-configs.js', import.meta.url), 'utf8');
const calls = [], assets = [];
let nativeEnabled = true;
const settingValues = new Map();
const chain = new Proxy({}, { get: (_o, key) => (...args) => {
  if (key === 'file') assets.push(args[0]);
  if (key === 'play') return Promise.resolve();
  return chain;
} });
const context = vm.createContext({ console, setTimeout, clearTimeout,
  Sequence: function() { return chain; },
  game: { settings: { get: (_m, key) => settingValues.get(key) }, modules: new Map([['sequencer', { active: true }]]) },
  foundry: { utils: { getProperty: (o, path) => path.split('.').reduce((v, k) => v?.[k], o) } },
  canvas: { ready: true, grid: { size: 100 } },
});
context.window = context;
const module = new vm.SourceTextModule(source, { context });
await module.link(specifier => {
  const match = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)].find(m => m[2] === specifier);
  const names = match[1].split(',').map(s => s.trim()).filter(Boolean);
  return new vm.SyntheticModule(names, function() {
    for (const name of names) this.setExport(name, name === 'fireNativeWeaponVFX'
      ? async (...args) => { calls.push(args); return nativeEnabled; }
      : name === 'getBeamVfxSettings' ? () => ({ eraColors: {}, groundPhaser: {} })
      : () => null);
  }, { context });
});
await module.evaluate();
const { getWeaponConfig, groundDisruptorFireMode, fireWeapon } = module.namespace;
const item = (name, mode, range = 'ranged') => ({ name, type: 'characterweapon2e',
  system: { range, hands: name.includes('Rifle') ? 2 : 1 },
  flags: { 'sta2e-toolkit': { groundFireMode: mode } } });
let count = 0;
for (const [name, profile, mode] of [
  ['Disruptor Pistol', 'disruptor', 'bolt'], ['Disruptor Rifle', 'disruptor', 'bolt'],
  ['Andorian Plasma Rifle', 'andorian', 'bolt'], ['Plasma Rifle', 'plasma', 'bolt'],
  ['Particle Rifle', 'particle', 'beam'], ['Phase Pistol', 'phase', 'beam'],
]) {
  const weapon = item(name), config = getWeaponConfig(weapon);
  assert.equal(config.family, 'ground-energy'); assert.equal(config.groundEnergyProfile, profile);
  assert.equal(config.groundFireMode, mode);
  await fireWeapon(config, true, {}, [{}], { weapon });
  assert.equal(calls.at(-1)[0].groundEnergyProfile, profile, 'ship era resolver altered ground config');
  count += 4;
}
for (const name of ['Disruptor Pistol', 'Disruptor Rifle']) {
  assert.equal(getWeaponConfig(item(name, 'beam')).groundFireMode, 'beam'); count++;
}
assert.equal(groundDisruptorFireMode(item('Disruptor', 'bad')), 'bolt'); count++;
assert.equal(getWeaponConfig(item('Pulse Grenade')).family, 'ground-pulse'); count++;
assert.equal(getWeaponConfig(item('Frag Grenade')).family, undefined); count++;
assert.equal(getWeaponConfig(item('Projectile Rifle')).family, undefined); count++;
assert.equal(getWeaponConfig(item('Phaser Type-2')).family, 'ground-phaser'); count++;
assert.equal(getWeaponConfig(item('Phaser Rifle', 'bolt')).family, 'ground-phaser-bolt'); count++;
assert.equal(getWeaponConfig(item('Disruptor Rifle')).groundEnergyScale, 1.35); count++;
assert.equal(getWeaponConfig(item('Disruptor Pistol')).groundEnergyScale, 1); count++;
// Current mode must use the disruptor's configured asset, never a phaser bolt.
nativeEnabled = false;
settingValues.set('animationOverrides', { groundWeapons: { disruptor: { animHit: 'fixture-disruptor.webm' } } });
await fireWeapon(getWeaponConfig(item('Disruptor Pistol')), false,
  { center: { x: 0, y: 0 }, document: {} }, [{ center: { x: 400, y: 0 }, document: {} }]);
assert(assets.includes('fixture-disruptor.webm'), 'Current disruptor took phaser bolt path'); count++;
console.log(`PASS: ${count} ground weapon mapping and dispatch assertions`);
