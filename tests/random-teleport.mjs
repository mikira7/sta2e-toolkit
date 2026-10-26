// node tests/random-teleport.mjs
//
// Random Teleport destination choice: skipping occupied Regions (and the
// fallback when all are full), no-repeat, and weighted frequencies.
import assert from 'node:assert/strict';

const { pickDestination, normalizeWeight } = await import('../scripts/random-teleport-pick.js');

// Small seeded PRNG (mulberry32) so the frequency checks are repeatable.
function seeded(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const A = { uuid: 'A' }, B = { uuid: 'B' }, C = { uuid: 'C' };

const results = [];
function check(name, fn) {
  try { fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

check('empty list gives null', () => {
  assert.equal(pickDestination([]), null);
  assert.equal(pickDestination(null), null);
});

check('occupied destinations are skipped', () => {
  const random = seeded(1);
  for (let i = 0; i < 500; i++) {
    const pick = pickDestination([A, B, C], { avoidOccupied: true, isOccupied: c => c !== B, random });
    assert.equal(pick, B);
  }
});

check('all occupied falls back to every destination', () => {
  const random = seeded(2);
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    seen.add(pickDestination([A, B, C], { avoidOccupied: true, isOccupied: () => true, random }).uuid);
  }
  assert.deepEqual([...seen].sort(), ['A', 'B', 'C']);
});

check('occupancy ignored when the option is off', () => {
  const random = seeded(3);
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    seen.add(pickDestination([A, B], { isOccupied: c => c === A, random }).uuid);
  }
  assert.ok(seen.has('A'));
});

check('no repeat never returns the last pick', () => {
  const random = seeded(4);
  let last = null;
  for (let i = 0; i < 1000; i++) {
    const pick = pickDestination([A, B, C], { lastUuid: last, random });
    assert.notEqual(pick.uuid, last);
    last = pick.uuid;
  }
});

check('no repeat is skipped when only one destination is left', () => {
  assert.equal(pickDestination([A], { lastUuid: 'A' }), A);
  // Occupancy first, then no-repeat: B is the only free one and was last.
  assert.equal(pickDestination([A, B], { avoidOccupied: true, isOccupied: c => c === A, lastUuid: 'B' }), B);
});

check('weights shape the frequencies', () => {
  const random = seeded(5);
  const weight = { A: 5, B: 1, C: 1 };
  const counts = { A: 0, B: 0, C: 0 };
  const N = 10000;
  for (let i = 0; i < N; i++) counts[pickDestination([A, B, C], { weightOf: c => weight[c.uuid], random }).uuid]++;
  assert.ok(Math.abs(counts.A / N - 5 / 7) < 0.02, `A ${counts.A}`);
  assert.ok(Math.abs(counts.B / N - 1 / 7) < 0.02, `B ${counts.B}`);
  assert.ok(Math.abs(counts.C / N - 1 / 7) < 0.02, `C ${counts.C}`);
});

check('weights are normalised', () => {
  assert.equal(normalizeWeight(undefined), 1);
  assert.equal(normalizeWeight(null), 1);
  assert.equal(normalizeWeight(''), 1);
  assert.equal(normalizeWeight('junk'), 1);
  assert.equal(normalizeWeight(0), 1);
  assert.equal(normalizeWeight(3.4), 3);
  assert.equal(normalizeWeight('7'), 7);
  assert.equal(normalizeWeight(99), 10);
});

let failed = 0;
for (const [status, name, msg] of results) {
  console.log(`${status}  ${name}${msg ? ` — ${msg}` : ''}`);
  if (status === 'FAIL') failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
