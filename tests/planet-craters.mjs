// node --experimental-vm-modules tests/planet-craters.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const cache = new Map();
async function load(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const mod = new vm.SourceTextModule(await readFile(url, "utf8"), { identifier: url.href });
  cache.set(url.href, mod);
  await mod.link(specifier => load(new URL(specifier, url)));
  return mod;
}
const mod = await load(new URL("../scripts/planet-generator.js", import.meta.url));
await mod.evaluate();
const { normalizePlanetRecipe, createPlanetTerrain, renderPlanetPixels, renderPlanetPixelsAsync } = mod.namespace;
const { createBarrenCraters } = cache.get(new URL("../scripts/planet-craters.js", import.meta.url).href).namespace;
const unit = p => { const length = Math.hypot(...p); return p.map(v => v / length); };
const light = p => ({ x: p[0], y: p[1], z: p[2] });
let shadedFloors = 0, litWalls = 0;
for (const seed of ["barren-1", "barren-2", "barren-3", "barren-4"]) {
  const recipe = normalizePlanetRecipe({ style: "barren", seed, craterDensity: 50, axialTilt: 70 });
  const terrain = createPlanetTerrain(recipe), field = createBarrenCraters(recipe, terrain);
  const dense = createBarrenCraters({ ...recipe, craterDensity: 100 }, terrain);
  const lookup = new Map(dense.craters.map(c => [c.id, c]));
  for (const c of field.craters) assert.deepEqual(c, lookup.get(c.id), "Density adds impacts without relocating or resizing existing craters");
  assert(field.craters.filter(c => c.radius < .02).length > field.craters.filter(c => c.radius > .06).length * 4, "Small impacts substantially outnumber large impacts");
  const empty = createBarrenCraters({ ...recipe, craterDensity: 0 }, terrain);
  assert.equal(empty.craters.length, 0);
  assert.deepEqual(empty.sample(0, 0, 1, light([0, 0, 1])), { albedo: 1, normalLight: 1, shadow: 1, coverage: 0 });
  for (const c of field.craters.filter(c => c.radius > .06)) {
    const overhead = light(c.center), low = light(unit(c.center.map((v, i) => v * .015 + c.east[i])));
    const zenith = field.sample(...c.center, overhead), grazing = field.sample(...c.center, low);
    if (zenith.shadow > grazing.shadow + .3) shadedFloors++;
    const wall = unit(c.center.map((v, i) => v + c.east[i] * c.radius * .7));
    const eastLight = light(unit(c.center.map((v, i) => v * .5 + c.east[i])));
    const westLight = light(unit(c.center.map((v, i) => v * .5 - c.east[i])));
    const east = field.sample(...wall, eastLight), west = field.sample(...wall, westLight);
    if (Math.abs(east.normalLight - west.normalLight) > .08) litWalls++;
    assert.equal(east.albedo, west.albedo, "Moving the sun changes relief, not ejecta placement or surface color");
    assert.equal(field.sample(...c.center, overhead, 1).coverage, 0, "Unresolved impacts fade out instead of aliasing");
  }
  for (let i = 0; i < 512; i++) {
    const y = 1 - (i + .5) / 256, r = Math.sqrt(1 - y * y), a = i * 2.4;
    const value = field.sample(Math.cos(a) * r, y, Math.sin(a) * r, light([0, .8, .6]));
    assert(Object.values(value).every(Number.isFinite));
    assert(value.albedo >= .7 && value.albedo <= 1.3 && value.shadow >= 0 && value.shadow <= 1);
    assert(value.normalLight >= -1.000001 && value.normalLight <= 1.000001);
  }
  for (const [a, b] of [ [[-1, 0, -1e-9], [-1, 0, 1e-9]], [[1e-9, 1, 0], [-1e-9, 1, 0]], [[1e-9, -1, 0], [-1e-9, -1, 0]] ]) {
    const va = field.sample(...a, light([0, .8, .6])), vb = field.sample(...b, light([0, .8, .6]));
    for (const key of Object.keys(va)) assert(Math.abs(va[key] - vb[key]) < 1e-5, `Craters remain continuous across sphere seams and spatial bins: ${seed} ${key} ${a}: ${va[key]} vs ${vb[key]}`);
  }
  const image = renderPlanetPixels(recipe, 128).pixels;
  assert.deepEqual(image, renderPlanetPixels(recipe, 128).pixels);
  assert.deepEqual(image, renderPlanetPixels(recipe, 128, { view: "scene" }).pixels);
  assert.deepEqual(image, (await renderPlanetPixelsAsync(recipe, 128)).pixels);
  const flooded = { ...recipe, water: 100, iceCoverage: 0 };
  assert.deepEqual(renderPlanetPixels(flooded, 64).pixels, renderPlanetPixels({ ...flooded, craterDensity: 0 }, 64).pixels, "Water hides submerged impact relief");
}
assert(shadedFloors > 5, "Crater floors darken under low-angle sunlight");
assert(litWalls > 5, "Crater walls respond to the direction of the sun");
console.log("PASS: crater distributions, stable density, low-sun shadows, directional relief, filtering, seams, submerged impacts, and matching views/exports.");
