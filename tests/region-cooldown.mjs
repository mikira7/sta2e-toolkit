// node tests/region-cooldown.mjs
//
// The Region behavior cooldown in region-token-uses.js: blocked while the timer
// runs, then blocked while anyone else is still inside, ready once they leave.
import assert from 'node:assert/strict';

let now = 1_000_000;
Date.now = () => now;
globalThis.game = { user: { isGM: true }, scenes: [] };
globalThis.foundry = { data: { fields: { NumberField: class {} } } };

const { cooldownBlocked, startCooldown, clearCooldown, startedInside } = await import('../scripts/region-token-uses.js');

function behavior(uuid) {
  const flags = {};
  const region = { tokens: new Set() };
  return {
    uuid, parent: region,
    getFlag: (_m, k) => flags[k],
    canUserModify: () => true,
    update: async (u) => { for (const [k, v] of Object.entries(u)) flags[k.split('.').pop()] = v; },
  };
}
const tok = (id, hidden = false) => ({ id, hidden });

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

await check('no cooldown started: never blocked', () => {
  const b = behavior('B0');
  assert.equal(cooldownBlocked(b, tok('A')), false);
});

await check('blocked while the timer runs, ready after once the Region is empty', async () => {
  const b = behavior('B1');
  await startCooldown(b, 10);
  assert.equal(cooldownBlocked(b, tok('A')), 'cooling');
  now += 9_999;
  assert.equal(cooldownBlocked(b, tok('A')), 'cooling');
  now += 1;
  assert.equal(cooldownBlocked(b, tok('A')), false);
});

await check('still blocked after the timer while someone else is inside', async () => {
  const b = behavior('B2');
  const a = tok('A');
  b.parent.tokens.add(a);
  await startCooldown(b, 5);
  now += 6_000;
  const c = tok('C');
  b.parent.tokens.add(c);           // C has just entered
  assert.equal(cooldownBlocked(b, c), 'occupied');
  b.parent.tokens.delete(a);        // A leaves
  assert.equal(cooldownBlocked(b, c), false);
});

await check('tokens that do not count do not hold it', async () => {
  const b = behavior('B3');
  b.parent.tokens.add(tok('G', true));
  await startCooldown(b, 1);
  now += 2_000;
  assert.equal(cooldownBlocked(b, tok('A'), t => !t.hidden), false);
  assert.equal(cooldownBlocked(b, tok('A')), 'occupied');
});

await check('blocked at once, before the flag write lands', async () => {
  const b = behavior('B4');
  b.canUserModify = () => false;    // a client that cannot write the behavior
  await startCooldown(b, 3);
  assert.equal(cooldownBlocked(b, tok('A')), 'cooling');
});

await check('0 seconds starts nothing; Clear ends it at once', async () => {
  const b = behavior('B5');
  await startCooldown(b, 0);
  assert.equal(cooldownBlocked(b, tok('A')), false);
  b.parent.tokens.add(tok('X'));
  await startCooldown(b, 30);
  assert.equal(cooldownBlocked(b, tok('A')), 'cooling');
  await clearCooldown(b);
  assert.equal(cooldownBlocked(b, tok('A')), false);
});

await check('a move that starts inside the Region is not an entry', () => {
  const scene = {};
  const region = { parent: scene, inside: p => p.x >= 0 && p.x < 100 };
  const token = { parent: scene, testInsideRegion: (r, p) => r.inside(p) };
  assert.equal(startedInside(token, region, { origin: { x: 50, y: 0 } }), true);
  assert.equal(startedInside(token, region, { origin: { x: 150, y: 0 } }), false);
  assert.equal(startedInside(token, region, null), false);                 // created / dropped inside
  assert.equal(startedInside({ ...token, parent: {} }, region, { origin: { x: 50 } }), false);   // other scene
  const throws = { parent: scene, testInsideRegion: () => { throw new Error('x'); } };
  assert.equal(startedInside(throws, region, { origin: { x: 50 } }), false);
});

let failed = 0;
for (const [status, name, msg] of results) {
  console.log(`${status}  ${name}${msg ? ` — ${msg}` : ''}`);
  if (status === 'FAIL') failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
