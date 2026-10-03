// node --experimental-vm-modules tests/planet-volcanic.mjs
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
const { createPlanetVolcanic } = modules.get(new URL("../scripts/planet-volcanic.js", import.meta.url).href).namespace;
const { createBarrenRockTexture } = modules.get(new URL("../scripts/barren-textures.js", import.meta.url).href).namespace;
const { createBarrenLandforms } = modules.get(new URL("../scripts/barren-landforms.js", import.meta.url).href).namespace;
const { createPlanetWeather, createPlanetIce } = modules.get(new URL("../scripts/planet-weather.js", import.meta.url).href).namespace;
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
for (const style of ["barren", "desert", "gas", "terrestrial"]) {
  const r = normalizePlanetRecipe({ style, lavaBasins: 90, superVolcanoes: 90, toxicClouds: 90, volcanicDetail: 90 });
  for (const key of ["lavaBasins", "superVolcanoes", "toxicClouds", "volcanicDetail"]) assert.equal(r[key], 0);
}
for (const [style, texture] of [["volcanic", "fissures"], ["volcanic", "calderas"], ["primordial", "magma"], ["primordial", "crust"], ["primordial", "developing"]]) {
  const recipe = normalizePlanetRecipe({ style, texture, seed: "volcanic-relief", water: 0, clouds: 30, mountains: 75 });
  assert.equal(recipe.volcanicDetail, 75); assert.equal(recipe.mountainShadows, 70);
  assert.deepEqual(normalizePlanetRecipe(JSON.stringify(recipe)), recipe);
  assert.equal(normalizePlanetRecipe({ ...recipe, superVolcanoes: 900 }).superVolcanoes, 100);
  const terrain = createPlanetTerrain(recipe), geo = terrain.geology;
  const weaker = createPlanetTerrain({ ...recipe, lavaBasins: 20, superVolcanoes: 20 });
  assert.deepEqual(geo.lavaBasins, weaker.geology.lavaBasins);
  assert.deepEqual(geo.superVolcanoes, weaker.geology.superVolcanoes);
  assert.equal(terrain, createPlanetTerrain({ ...recipe, volcanicDetail: 0, toxicClouds: 0, mountainShadows: 0 }));
  for (const basin of geo.lavaBasins) {
    const sample = geo.sample(...basin.center);
    assert(sample.lavaBasin > .4 && sample.delta < 0 && sample.flatten > .35);
  }
  for (const caldera of geo.superVolcanoes) assert(geo.sample(...caldera.center).superCaldera > .3);
  const colors = Object.fromEntries(Object.entries(recipe.colors).map(([k, v]) => [k, rgb(v)]));
  const field = createPlanetVolcanic(recipe, terrain, colors, createBarrenLandforms(terrain, createBarrenRockTexture(terrain.noise))), weather = createPlanetWeather(recipe, terrain, createPlanetIce(recipe, terrain));
  let maxLava = 0, minLava = 1, maxSulfur = 0, wide = 0, peaks = 0, shadow = 0;
  for (let i = 0; i < 1024; i++) {
    const y = 1 - (i + .5) / 512, radius = Math.sqrt(1 - y * y), angle = i * 2.399963;
    const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)], surface = terrain.surfaceAt(...p);
    const sample = field.sample(...p, surface.elevation, surface.landform, .002);
    assert(sample.color.every(Number.isFinite) && Number.isFinite(sample.relief));
    assert(sample.lava >= 0 && sample.lava <= 1);
    maxLava = Math.max(maxLava, sample.lava); minLava = Math.min(minLava, sample.lava); maxSulfur = Math.max(maxSulfur, sample.sulfur);
    wide += terrain.mountainAt(...p) > .15; peaks += terrain.mountainPeakAt(...p) > .15;
    const cloud = weather.sample(...p, { x: 0, y: .8, z: .6 }, .002);
    assert(cloud.color?.every(Number.isFinite)); shadow = Math.max(shadow, cloud.shadow);
  }
  const activity = field.sample(0, 0, 1, .5, null).activity;
  assert(maxLava > .3 * activity && minLava === 0 && maxSulfur > .1, `Localized molten channels leave exposed sulfurous rock: ${style}/${texture}: ${maxLava}, ${minLava}, ${maxSulfur}`);
  assert(wide > peaks * 1.5 && shadow > .05);
  const p = [-1, 0, 0], n = terrain.elevation(...p);
  const a = field.sample(-1, 0, -1e-9, n, geo.sample(-1, 0, -1e-9));
  const b = field.sample(-1, 0, 1e-9, n, geo.sample(-1, 0, 1e-9));
  assert(Math.abs(a.relief - b.relief) < 1e-6); assert(Math.abs(a.lava - b.lava) < 1e-6);
  assert.equal(createPlanetWeather({ ...recipe, clouds: 0 }, terrain, createPlanetIce(recipe, terrain)).sample(...p).alpha, 0);
  const image = renderPlanetPixels(recipe, 64).pixels;
  assert.deepEqual(image, (await renderPlanetPixelsAsync(recipe, 64)).pixels);
  assert.notDeepEqual(image, renderPlanetPixels({ ...recipe, volcanicDetail: 0 }, 64).pixels);
  assert.notDeepEqual(image, renderPlanetPixels({ ...recipe, toxicClouds: 0 }, 64).pixels);
  const night = renderPlanetPixels({ ...recipe, phaseAngle: 180, nightBrightness: 0, clouds: 0 }, 64).pixels;
  assert(night.some((v, i) => i % 4 !== 3 && v > 0), "Molten lava emits at night");
  const flooded = { ...recipe, water: 100, clouds: 0, iceCoverage: 0 };
  assert.deepEqual(renderPlanetPixels(flooded, 64).pixels, renderPlanetPixels({ ...flooded, volcanicDetail: 0, mountainShadows: 0 }, 64).pixels);
}
console.log("PASS: volcanic/primordial terrain controls, stable calderas and lava basins, exposed crust/sulfur, broad mountains, volumetric toxic clouds, seams, disabled clouds, thermal night glow, water isolation and deterministic exports.");
