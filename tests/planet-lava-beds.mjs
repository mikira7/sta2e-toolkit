// node --experimental-vm-modules tests/planet-lava-beds.mjs
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
assert.equal(normalizePlanetRecipe({ style: "barren" }).lavaBeds, 0, "Lava beds are optional for existing worlds");
for (const style of ["terrestrial", "ice", "gas"]) assert.equal(normalizePlanetRecipe({ style, lavaBeds: 90 }).lavaBeds, 0);
assert.equal(normalizePlanetRecipe({ style: "desert", lavaBeds: 90 }).lavaBeds, 90);
assert.equal(normalizePlanetRecipe({ style: "barren", lavaBeds: 900 }).lavaBeds, 100);
assert.equal(normalizePlanetRecipe({ style: "barren", lavaBeds: -10 }).lavaBeds, 0);
for (const seed of ["barren-1", "barren-2", "barren-3"]) {
  const recipe = normalizePlanetRecipe({ style: "barren", seed, lavaBeds: 75, water: 0, clouds: 0, iceCoverage: 0, axialTilt: 70 });
  assert.deepEqual(normalizePlanetRecipe(JSON.stringify(recipe)), recipe, "Lava control persists");
  const terrain = createPlanetTerrain(recipe), weaker = createPlanetTerrain({ ...recipe, lavaBeds: 25 }), off = createPlanetTerrain({ ...recipe, lavaBeds: 0 });
  assert.notEqual(terrain, off, "Terrain cache includes lava beds");
  assert.equal(terrain, createPlanetTerrain({ ...recipe, palette: "iron" }), "Changing palette preserves formations");
  assert.deepEqual(terrain.geology.lavaBeds, weaker.geology.lavaBeds, "Strength does not move beds");
  for (const bed of terrain.geology.lavaBeds) {
    const strong = terrain.geology.sample(...bed.center), weak = weaker.geology.sample(...bed.center);
    assert(strong.lavaBed > .7 && strong.flatten > .6, "Deposit interiors soften older relief");
    assert(strong.delta < 0 && strong.lavaBed > weak.lavaBed, "Strength deepens deposits at stable locations");
  }
  let count = 0;
  for (let i = 0; i < 2048; i++) {
    const y = 1 - (i + .5) / 1024, radius = Math.sqrt(1 - y * y), angle = i * 2.399963;
    const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)], landform = terrain.geology.sample(...p);
    assert(Object.values(landform).every(Number.isFinite));
    if (landform.lavaBed > .1) count++;
    assert(Math.abs(terrain.elevation(...p) - off.elevation(...p)) < .4);
  }
  assert(count > 50 && count < 1200, "Beds occupy distinct regional provinces");
  for (const [a, b] of [[[-1, 0, -1e-9], [-1, 0, 1e-9]], [[1e-9, 1, 0], [-1e-9, 1, 0]], [[1e-9, -1, 0], [-1e-9, -1, 0]]]) {
    assert(Math.abs(terrain.elevation(...a) - terrain.elevation(...b)) < 1e-6);
    const va = terrain.geology.sample(...a), vb = terrain.geology.sample(...b);
    for (const key of Object.keys(va)) assert(Math.abs(va[key] - vb[key]) < 1e-6, `Lava bed ${key} is continuous across poles and longitude`);
  }
  const image = renderPlanetPixels(recipe, 128).pixels;
  assert.notDeepEqual(image, renderPlanetPixels({ ...recipe, lavaBeds: 0 }, 128).pixels);
  assert.deepEqual(image, renderPlanetPixels(recipe, 128).pixels);
  assert.deepEqual(image, renderPlanetPixels(recipe, 128, { view: "scene" }).pixels);
  assert.deepEqual(image, (await renderPlanetPixelsAsync(recipe, 128)).pixels);
  const night = renderPlanetPixels({ ...recipe, phaseAngle: 180, nightBrightness: 0, cities: 0 }, 64).pixels;
  assert(night.every((v, i) => i % 4 === 3 || v === 0), "Ancient lava has no night-side glow");
  const flooded = { ...recipe, water: 100, craterDensity: 0, oceanShading: 0 };
  assert.deepEqual(renderPlanetPixels(flooded, 64).pixels, renderPlanetPixels({ ...flooded, lavaBeds: 0 }, 64).pixels, "Water hides submerged lava beds");
}
console.log("PASS: optional barren lava beds, persistence, stable strengths/cache, regional deposits, bounded relief, spherical continuity, matched exports, no glow, and submerged terrain.");
