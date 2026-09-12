// Run: node --experimental-vm-modules tests/destructible-objects.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import Handlebars from "handlebars";

const context = vm.createContext({ console, Math, Number, String, Array, Object, Float32Array });
const geometry = new vm.SourceTextModule(await readFile(new URL("../scripts/destructible-geometry.js", import.meta.url), "utf8"), { context });
await geometry.link(() => {}); await geometry.evaluate();
const { UNIT_POLYGON, fracturePolygon, polygonArea, allocateByArea, normalizeDestructible, objectDamage, imageOffsetToScene } = geometry.namespace;
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
check("configuration defaults and clamps", () => {
  const c = normalizeDestructible(); assert.equal(c.integrity, 10); assert.equal(c.resistance, 0); assert.equal(c.difficulty, 1);
  assert.equal(c.maxDepth, 3); assert.equal(c.maxFragments, 32); assert.equal(c.minSize, .25);
  assert.equal(normalizeDestructible({ integrity: -1, maxFragments: Infinity, darkColor: '<script>' }).integrity, 1);
  assert.equal(normalizeDestructible({ darkColor: '<script>' }).darkColor, '#343137');
});
check("fracture area conservation over seeds, weapon types and recursive cuts", () => {
  for (const kind of ["beam", "explosive", "irregular"]) for (let seed = 0; seed < 35; seed++) for (let count = 2; count <= 8; count++) {
    const options = { kind, seed, count, angle: seed * .3 };
    const pieces = fracturePolygon(UNIT_POLYGON, options);
    assert.equal(pieces.length, count);
    assert.ok(Math.abs(pieces.reduce((s, p) => s + polygonArea(p), 0) - 1) < 1e-8);
    assert.equal(JSON.stringify(pieces), JSON.stringify(fracturePolygon(UNIT_POLYGON, options)));
    for (const piece of pieces) {
      const sub = fracturePolygon(piece, options);
      assert.ok(Math.abs(sub.reduce((s, p) => s + polygonArea(p), 0) - polygonArea(piece)) < 1e-8);
    }
  }
});
check("integer allocation conserves durability and handles dust", () => {
  assert.equal(JSON.stringify(allocateByArea(10, [3, 1])), '[8,2]');
  assert.equal(JSON.stringify(allocateByArea(1, [1, 1, 1])), '[1,0,0]');
  assert.equal(JSON.stringify(allocateByArea(10, [0, 0])), '[0,0]');
  for (let n = 0; n < 50; n++) assert.equal(allocateByArea(n, [1, 3, 7, 0]).reduce((a, b) => a + b, 0), n);
});
check("Resistance, Piercing, stun and blocked hits", () => {
  assert.equal(objectDamage({ rawDamage: 4, resistance: 6 }), 0);
  assert.equal(objectDamage({ rawDamage: 7, resistance: 2 }), 5);
  assert.equal(objectDamage({ rawDamage: 7, resistance: 2, piercing: true }), 7);
  assert.equal(objectDamage({ rawDamage: 100, useStun: true, piercing: true }), 0);
  assert.equal(objectDamage({ rawDamage: -3 }), 0);
});
check("rotation, reflections and unequal scale transform offsets", () => {
  const p = imageOffsetToScene(.25, .1, 400, 200, 90, -2, .5);
  assert.ok(Math.abs(p.x + 10) < 1e-8); assert.ok(Math.abs(p.y + 200) < 1e-8);
});
check("VFX template compiles with both object and original tabs", () => {});
const template = Handlebars.compile(await readFile(new URL("../templates/ship-vfx-anchors.hbs", import.meta.url), "utf8"));
const objectHtml = template({ isDestructibleTab: true, destructiblePanel: '<div id="object-test">Objects</div>' });
assert.ok(objectHtml.includes('id="object-test"')); assert.ok(!objectHtml.includes('class="sta2e-anchor-image-frame"'));
const normalHtml = template({ isDestructibleTab: false, isTractorTab: true });
assert.ok(!normalHtml.includes('id="object-test"')); assert.ok(normalHtml.includes('sta2e-anchor-image-frame'));
console.log(`${checks} groups passed (735 seeded fracture cases, with recursive partitions).`);
