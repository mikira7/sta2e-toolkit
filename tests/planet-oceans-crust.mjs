// node --experimental-vm-modules tests/planet-oceans-crust.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const modules = new Map();
async function load(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const mod = new vm.SourceTextModule(await readFile(url, "utf8")); modules.set(url.href, mod);
  await mod.link(s => load(new URL(s, url))); return mod;
}
const mod = await load(new URL("../scripts/planet-generator.js", import.meta.url)); await mod.evaluate();
const { normalizePlanetRecipe, createPlanetTerrain, renderPlanetPixels, renderPlanetPixelsAsync } = mod.namespace;
const { createPlanetOcean } = modules.get(new URL("../scripts/planet-oceans.js", import.meta.url).href).namespace;
const colorsFor = recipe => Object.fromEntries(Object.entries(recipe.colors).map(([key, hex]) => [key, [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))]));
assert.equal(normalizePlanetRecipe({ style: "terrestrial" }).crustPlates, "auto");
assert.equal(normalizePlanetRecipe({ style: "barren" }).crustPlates, "none");
for (const style of ["gas", "star", "asteroid", "greenhouse"]) {
  const recipe = normalizePlanetRecipe({ style, crustPlates: "active", oceanShading: 100 });
  assert.equal(recipe.crustPlates, "none"); assert.equal(recipe.oceanShading, 0);
}
for (const seed of ["class-m-1", "class-m-2", "crust-3"]) {
  const r = normalizePlanetRecipe({ style: "terrestrial", seed, crustPlates: "active", oceanShading: 100, water: 62, clouds: 0, iceCoverage: 0, rivers: 40, axialTilt: 70 });
  assert.deepEqual(normalizePlanetRecipe(JSON.stringify(r)), r);
  const terrain = createPlanetTerrain(r), ancient = createPlanetTerrain({ ...r, crustPlates: "ancient" }), none = createPlanetTerrain({ ...r, crustPlates: "none" });
  assert.equal(none.crust, null);
  assert.equal(terrain.crust.mode, "active"); assert.equal(ancient.crust.mode, "ancient");
  assert.deepEqual(terrain.crust.plates, ancient.crust.plates, "Activity changes preserve crust provinces");
  assert.equal(terrain, createPlanetTerrain({ ...r, oceanShading: 0, palette: "alien" }), "Ocean colors/shading preserve tectonic terrain");
  let wet = 0, mountains = 0, ridges = 0, trenches = 0, changed = 0;
  for (let i = 0; i < 4096; i++) {
    const y = 1 - (i + .5) / 2048, radius = Math.sqrt(1 - y * y), angle = i * 2.399963;
    const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)], plate = terrain.crust.sample(...p), old = ancient.crust.sample(...p);
    assert(Object.values(plate).every(Number.isFinite));
    assert(Math.abs(plate.delta) < .20);
    for (const key of ["mountain", "ridge", "trench", "rift"]) assert(Math.abs(old[key] - plate[key] * .30) < 1e-7, "Ancient plate activity leaves softer remnants");
    const elevation = terrain.elevation(...p);
    wet += elevation < terrain.seaLevel;
    mountains += plate.mountain > .05; ridges += plate.ridge > .05; trenches += plate.trench > .05;
    changed += Math.abs(elevation - none.elevation(...p)) > .02;
  }
  assert(Math.abs(wet / 4096 - .62) < .025, "Plates preserve calibrated ocean coverage");
  assert(mountains > 10 && ridges > 10 && trenches > 10 && changed > 500, "Boundary motion shapes mountain belts, ridges, trenches, and crust provinces");
  for (let i = 0; i < terrain.drainage.next.length; i++) {
    const next = terrain.drainage.next[i];
    if (next >= 0) assert(terrain.drainage.heights[next] < terrain.drainage.heights[i], "Rivers follow the plated elevation field");
  }
  for (const [a, b] of [[[-1, 0, -1e-9], [-1, 0, 1e-9]], [[1e-9, 1, 0], [-1e-9, 1, 0]], [[1e-9, -1, 0], [-1e-9, -1, 0]]]) {
    const va = terrain.crust.sample(...a), vb = terrain.crust.sample(...b);
    for (const key of Object.keys(va)) assert(Math.abs(va[key] - vb[key]) < 1e-6);
    assert(Math.abs(terrain.elevation(...a) - terrain.elevation(...b)) < 1e-6);
  }
  const colors = colorsFor(r), ocean = createPlanetOcean(r, terrain, colors);
  let previous = Infinity;
  for (let i = 0; i <= 100; i++) {
    const elevation = terrain.oceanWaterline - terrain.oceanDepthRange * i / 100;
    const value = ocean.sample(elevation), lightness = value.color.reduce((a, b) => a + b, 0);
    assert(lightness <= previous + 1e-8, "Water darkens continuously with increasing depth"); previous = lightness;
  }
  const allOcean = createPlanetTerrain({ ...r, water: 100 });
  const oceanWorld = createPlanetOcean({ ...r, water: 100 }, allOcean, colors);
  assert(oceanWorld.sample(allOcean.oceanWaterline - .02).relativeDepth < oceanWorld.sample(allOcean.oceanWaterline - .20).relativeDepth, "Fully flooded worlds retain bathymetric variation despite the all-water sentinel");
  const legacy = createPlanetOcean({ ...r, oceanShading: 0 }, terrain, colors);
  for (const depth of [.001, .01, .04, .20]) {
    const elevation = terrain.seaLevel - depth, shelf = Math.max(0, Math.min(1, 1 - depth / .028));
    const expected = colors.ocean.map((v, k) => v * .42 + (v + (colors.ice[k] - v) * .12 - v * .42) * shelf * shelf * .65);
    legacy.sample(elevation).color.forEach((v, k) => assert(Math.abs(v - expected[k]) < 1e-7, "Disabling shading restores legacy water colors"));
  }
  const image = renderPlanetPixels(r, 96).pixels;
  assert.deepEqual(image, renderPlanetPixels(r, 96, { view: "scene" }).pixels);
  assert.deepEqual(image, (await renderPlanetPixelsAsync(r, 96)).pixels);
  assert.notDeepEqual(image, renderPlanetPixels({ ...r, oceanShading: 0 }, 96).pixels);
  assert.notDeepEqual(image, renderPlanetPixels({ ...r, crustPlates: "none" }, 96).pixels);
}
const decisions = new Set();
for (let i = 0; i < 16; i++) decisions.add(createPlanetTerrain({ style: "terrestrial", seed: `auto-plate-${i}`, crustPlates: "auto", water: 0, rivers: 0 }).crust?.mode ?? "none");
assert(decisions.has("active") && decisions.has("none"), "Seeded choice supports both plate-bearing and unplated worlds");
console.log("PASS: crust choices/persistence, stable activity/provinces, tectonic terrain, water coverage, downhill drainage, seams, monotonic ocean depths, flooded worlds, legacy shading, and paired exports.");
