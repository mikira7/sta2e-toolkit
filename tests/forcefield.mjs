// node tests/forcefield.mjs
//
// Forcefield doors: which walls carry a field, when it is up, the config it
// resolves to, the quad that frames a wall, the contact test and the ramp.
import assert from 'node:assert/strict';

const {
  isForcefieldWall, isFieldUp, forcefieldConfig, wallQuad, nearestOnWall,
  moveHitsWall, rampPower, riseFlicker, hexToRgb, FF_STYLES, FF_STYLE_ORDER,
} = await import('../scripts/forcefield-data.js');

const wall = (over = {}, flags = { forcefield: true }) =>
  ({ id: 'W1', c: [0, 0, 200, 0], door: 1, ds: 0, flags: { 'sta2e-toolkit': flags }, ...over });

const results = [];
function check(name, fn) {
  try { fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

check('only flagged door walls carry a field', () => {
  assert.equal(isForcefieldWall(wall()), true);
  assert.equal(isForcefieldWall(wall({ door: 0 })), false);
  assert.equal(isForcefieldWall(wall({ door: 2 })), true);            // secret door
  assert.equal(isForcefieldWall(wall({}, {})), false);
  assert.equal(isForcefieldWall(wall({}, { forcefield: 'true' })), false);
  assert.equal(isForcefieldWall(null), false);
});

check('closed and locked are up, open is down', () => {
  assert.equal(isFieldUp(wall({ ds: 0 })), true);
  assert.equal(isFieldUp(wall({ ds: 2 })), true);
  assert.equal(isFieldUp(wall({ ds: 1 })), false);
  assert.equal(isFieldUp(wall({ ds: 0, door: 0 })), false);
});

check('config falls back to the style and clamps', () => {
  const c = forcefieldConfig(wall());
  assert.equal(c.style, 'starfleet');
  assert.deepEqual(c.color, hexToRgb(FF_STYLES.starfleet.color));
  assert.equal(c.intensity, 0.8);
  assert.equal(c.thickness, 0.3);
  assert.equal(c.above, false);
  assert.equal(c.radius, 0);
  const d = forcefieldConfig(wall({}, { forcefield: true, ffStyle: 'nope', ffIntensity: 400, ffThickness: 1, ffVolume: '' }));
  assert.equal(d.style, 'starfleet');
  assert.equal(d.intensity, 1);
  assert.equal(d.thickness, 0.05);
  assert.equal(d.volume, 0.8);
  // A legitimate 0 is kept.
  assert.equal(forcefieldConfig(wall({}, { forcefield: true, ffIntensity: 0 })).intensity, 0);
});

check('a custom colour wins and its core is lifted from it', () => {
  const c = forcefieldConfig(wall({}, { forcefield: true, ffColor: '#ff0000' }));
  assert.deepEqual(c.color, [1, 0, 0]);
  assert.equal(c.core[0], 1);
  assert.ok(c.core[1] > 0.7 && c.core[1] < 0.8);
  assert.deepEqual(forcefieldConfig(wall({}, { forcefield: true, ffColor: 'garbage' })).color,
    hexToRgb(FF_STYLES.starfleet.color));
  assert.deepEqual(hexToRgb('#0f0'), [0, 1, 0]);
});

check('every style resolves to a colour, core and pattern', () => {
  for (const id of FF_STYLE_ORDER) {
    const c = forcefieldConfig(wall({}, { forcefield: true, ffStyle: id }));
    assert.equal(c.color.length, 3, id);
    assert.equal(c.core.length, 3, id);
    assert.ok([0, 1, 2].includes(c.pattern), id);
  }
});

check('the quad frames the wall with a pad at each end', () => {
  const q = wallQuad([100, 100, 100, 300], 100, 0.3);
  assert.equal(q.seg, 200);
  assert.equal(q.thick, 30);
  assert.equal(q.pad, 15);
  assert.equal(q.length, 230);
  assert.ok(Math.abs(q.rotation - Math.PI / 2) < 1e-9);
  // The origin sits `pad` before the first end, along the wall.
  assert.ok(Math.abs(q.x - 100) < 1e-9 && Math.abs(q.y - 85) < 1e-9);
  assert.equal(wallQuad([5, 5, 5, 5], 100, 0.3), null);
  assert.equal(wallQuad(null, 100, 0.3), null);
  assert.ok(wallQuad([0, 0, 50, 0], 10, 0.05).thick >= 6);   // never a hairline
});

check('nearest point on a wall', () => {
  const n = nearestOnWall([0, 0, 200, 0], 50, 40);
  assert.deepEqual([n.x, n.y, n.dist, n.along], [50, 0, 40, 50]);
  assert.equal(nearestOnWall([0, 0, 200, 0], -50, 0).x, 0);
});

check('a move into the wall hits it; one beside it does not', () => {
  const c = [100, 0, 100, 300];
  // Stopped 30 px short of the field, heading at it: the reach finds it.
  const hit = moveHitsWall(c, { x: 0, y: 150 }, { x: 70, y: 150 }, 75);
  assert.ok(hit);
  assert.equal(hit.x, 100);
  assert.equal(hit.along, 150);
  assert.equal(moveHitsWall(c, { x: 0, y: 150 }, { x: 70, y: 150 }, 0), null);
  // Walking along beside it.
  assert.equal(moveHitsWall(c, { x: 70, y: 0 }, { x: 70, y: 280 }, 75), null);
  // Walking away from it.
  assert.equal(moveHitsWall(c, { x: 70, y: 150 }, { x: 0, y: 150 }, 75), null);
  // Past an end of the wall.
  assert.equal(moveHitsWall(c, { x: 0, y: 400 }, { x: 70, y: 400 }, 75), null);
  // No move.
  assert.equal(moveHitsWall(c, { x: 70, y: 150 }, { x: 70, y: 150 }, 75), null);
});

check('the ramp runs from where it is and settles', () => {
  const up = { from: 0, to: 1, start: 1000, ms: 500 };
  assert.equal(rampPower(up, 1000).power, 0);
  assert.equal(rampPower(up, 1000).moving, true);
  assert.ok(rampPower(up, 1250).power > 0.5);                  // eases out: past half by half time
  assert.equal(rampPower(up, 2000).power, 1);
  assert.equal(rampPower(up, 2000).moving, false);
  const down = { from: 0.6, to: 0, start: 0, ms: 400 };
  assert.ok(rampPower(down, 200).power > 0.3);                 // eases in: holds, then drains
  assert.equal(rampPower(down, 400).power, 0);
  assert.equal(rampPower(null, 0).power, 0);
});

check('the rise flickers early and is steady late', () => {
  for (let t = 0; t < 2000; t += 7) assert.equal(riseFlicker(0.7, 0.3, t), 1);
  let drops = 0;
  for (let t = 0; t < 2000; t += 7) if (riseFlicker(0.05, 0.3, t) < 1) drops++;
  assert.ok(drops > 10, `drops ${drops}`);
});

let failed = 0;
for (const [status, name, msg] of results) {
  console.log(`${status}  ${name}${msg ? ` — ${msg}` : ''}`);
  if (status === 'FAIL') failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
