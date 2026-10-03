// node --experimental-vm-modules tests/planet-biomes.mjs
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
const { createPlanetBiomes } = modules.get(new URL("../scripts/planet-biomes.js", import.meta.url).href).namespace;
const { BIOME_MAPS, BIOME_MAP_SIZE } = modules.get(new URL("../scripts/biome-texture-data.js", import.meta.url).href).namespace;
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const fieldFor = recipe => createPlanetBiomes(recipe, createPlanetTerrain(recipe), Object.fromEntries(Object.entries(recipe.colors).map(([k, v]) => [k, rgb(v)])));
assert.equal(BIOME_MAPS.length, 10);
for (const map of BIOME_MAPS) for (const channel of ["height", "albedo"]) {
  assert.equal(map[channel].length, BIOME_MAP_SIZE ** 2);
  assert(map[channel].every(v => Number.isFinite(v) && v >= 0 && v <= 1));
}
assert.equal(normalizePlanetRecipe({ style: "terrestrial" }).biomeDetail, 65);
for (const style of ["barren", "ice", "desert", "gas", "star"]) assert.equal(normalizePlanetRecipe({ style, biomeDetail: 75 }).biomeDetail, 0);
assert.equal(normalizePlanetRecipe({ style: "terrestrial", biomeDetail: -1 }).biomeDetail, 0);
assert.equal(normalizePlanetRecipe({ style: "terrestrial", biomeDetail: 150 }).biomeDetail, 100);
for (const seed of ["class-m-1", "class-m-2", "biome-proof"]) {
  const recipe = normalizePlanetRecipe({ seed, style: "terrestrial", crustPlates: "none", biomeDetail: 100, clouds: 0, water: 45, axialTilt: 70 });
  assert.deepEqual(normalizePlanetRecipe(JSON.stringify(recipe)), recipe);
  const terrain = createPlanetTerrain(recipe), field = fieldFor(recipe);
  assert.equal(terrain, createPlanetTerrain({ ...recipe, biomeDetail: 0 }), "Biome texture controls preserve coastlines and drainage");
  const maxima = Array(5).fill(0), latitudeTotals = [0, 0], count = [0, 0];
  let rangeCount = 0, summitCount = 0, foothillCount = 0;
  for (let i = 0; i < 4096; i++) {
    const y = 1 - (i + .5) / 2048, radius = Math.sqrt(1 - y * y), angle = i * 2.399963;
    const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)], elevation = terrain.elevation(...p);
    const value = field.sample(...p, elevation, .001);
    const range = terrain.mountainAt(...p), summit = terrain.mountainPeakAt(...p);
    if (range > .15) rangeCount++;
    if (summit > .15) summitCount++;
    if (range > .25 && summit < .05) {
      foothillCount++;
      assert.equal(value.snow, 0, "Low foothills remain exposed rock rather than inheriting summit snow");
    }
    assert(value.weights.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
    assert(Math.abs(value.weights.reduce((a, b) => a + b, 0) - 1) < 1e-6, "Biome blending conserves color energy");
    assert(value.color.every(v => Number.isFinite(v) && v >= 0 && v <= 280));
    assert(Number.isFinite(value.relief) && Math.abs(value.relief) < .04);
    if (elevation > terrain.seaLevel) value.weights.forEach((v, k) => { maxima[k] = Math.max(maxima[k], v); });
    const band = Math.abs(y) > .75 ? 1 : 0;
    latitudeTotals[band] += value.weights[3]; count[band]++;
  }
  assert(maxima.every(v => v > .15), `Every biome appears in land regions: ${seed} ${maxima}`);
  assert(rangeCount > summitCount * 1.4 && foothillCount > 100, "Mountain massifs have substantial shoulders around narrower summits");
  assert(latitudeTotals[1] / count[1] > latitudeTotals[0] / count[0] + .2, "Tundra follows colder latitude bands");
  const disabledSnow = fieldFor({ ...recipe, iceCoverage: 0 });
  for (let i = 0; i < 256; i++) {
    const y = 1 - (i + .5) / 128, radius = Math.sqrt(1 - y * y), angle = i * 2.399963;
    const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
    assert.equal(disabledSnow.sample(...p, terrain.elevation(...p)).snow, 0);
  }
  for (const [a, b] of [[[-1, 0, -1e-9], [-1, 0, 1e-9]], [[1e-9, 1, 0], [-1e-9, 1, 0]], [[1e-9, -1, 0], [-1e-9, -1, 0]]]) {
    const va = field.sample(...a, terrain.elevation(...a)), vb = field.sample(...b, terrain.elevation(...b));
    for (const key of ["relief", "humidity", "mountain", "snow"]) assert(Math.abs(va[key] - vb[key]) < 1e-6);
    for (let i = 0; i < 3; i++) assert(Math.abs(va.color[i] - vb.color[i]) < 1e-4);
  }
  const image = renderPlanetPixels(recipe, 128).pixels;
  assert.notDeepEqual(image, renderPlanetPixels({ ...recipe, biomeDetail: 0 }, 128).pixels);
  assert.deepEqual(image, renderPlanetPixels(recipe, 128, { view: "scene" }).pixels);
  assert.deepEqual(image, (await renderPlanetPixelsAsync(recipe, 128)).pixels);
  const night = renderPlanetPixels({ ...recipe, phaseAngle: 180, nightBrightness: 0, cities: 0 }, 64).pixels;
  assert(night.every((v, i) => i % 4 === 3 || night[i - i % 4 + 3] === 0 || v === 0), "Visible biome pixels have no baked light or emission");
  const flooded = { ...recipe, water: 100, iceCoverage: 0, rivers: 0 };
  assert.deepEqual(renderPlanetPixels(flooded, 64).pixels, renderPlanetPixels({ ...flooded, biomeDetail: 0 }, 64).pixels, "Textures do not change ocean appearance");
  const point = [.8, .6, 0], e = terrain.elevation(...point);
  const alien = fieldFor({ ...recipe, colors: { ...recipe.colors, surfaceLow: "#65317b", surfaceHigh: "#d4a7d9" } });
  assert.notDeepEqual(field.sample(...point, e).color, alien.sample(...point, e).color, "Textures respect custom biome colors");
  assert.deepEqual(field.sample(...point, e).weights, alien.sample(...point, e).weights, "Palette edits preserve biome placement");
}
// Equal base land colors isolate sediment hue changes from biome blending
// and brightness modulation. Desert variation should change chromaticity.
const desertRecipe = normalizePlanetRecipe({ style: "terrestrial", seed: "class-m-2", water: 0, mountains: 0, iceCoverage: 0, biomeDetail: 100 });
const desertTerrain = createPlanetTerrain(desertRecipe);
const desertField = fieldFor({ ...desertRecipe, colors: { ...desertRecipe.colors, surfaceLow: "#b6a079", surfaceHigh: "#b6a079" } });
const ratios = [];
for (let i = 0; i < 8192; i++) {
  const y = 1 - (i + .5) / 4096, radius = Math.sqrt(1 - y * y), angle = i * 2.399963;
  const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
  const value = desertField.sample(...p, desertTerrain.elevation(...p));
  if (value.weights[2] > .95) ratios.push(value.color[0] / value.color[1]);
}
assert(ratios.length > 100 && Math.max(...ratios) - Math.min(...ratios) > .04, "Deserts vary hue across sand and bedrock provinces, not only brightness");
console.log("PASS: biome maps, controls/persistence, all five climate regions, normalized blending, tundra latitude, snow toggle, spherical continuity, coastline/drainage preservation, palettes, paired exports, ocean isolation, and unlit night side.");
