import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../scripts/hazard-lightning-path.js', import.meta.url), 'utf8');
const { buildHazardLightningPath: build, sampleHazardLightningPath: sample } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
for (let seed = 0; seed < 100; seed++) {
  const path = build(250, 170, 300, seed);
  assert.deepEqual(path, build(250, 170, 300, seed), 'strike geometry remains deterministic');
  assert.deepEqual(sample(path, 0), { main: [], branches: [[], []] });
  for (const [i, branch] of path.branches.entries()) {
    assert.deepEqual(branch[0], path.main[i === 0 ? 3 : 6]);
    assert.equal(sample(path, branch[0].time).branches[i].length, 0, 'fork waits for its junction');
    assert.equal(sample(path, branch[0].time + .001).branches[i].length, 2);
  }
  const partial = sample(path, path.main[1].time / 2);
  assert.equal(partial.main.length, 2);
  assert.ok(Math.abs(partial.main[1].x - (path.main[0].x + path.main[1].x) / 2) < 1e-8);
  assert.deepEqual(sample(path, 1.65), path, 'all leaders finish within the reveal window');
  for (const points of [path.main, ...path.branches]) {
    for (let i = 1; i < points.length; i++) {
      assert.ok(points[i].time > points[i - 1].time);
      assert.ok(Number.isFinite(points[i].x) && Number.isFinite(points[i].y));
    }
  }
}
console.log('PASS: lightning growth, delayed forks, stable paths and complete reveal');
