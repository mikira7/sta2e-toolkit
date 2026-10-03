// node --experimental-vm-modules tests/planet-deserts.mjs
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
const { createPlanetDeserts } = modules.get(new URL("../scripts/planet-deserts.js", import.meta.url).href).namespace;
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
assert.equal(normalizePlanetRecipe({ style: "desert" }).desertDetail, 70);
assert.equal(normalizePlanetRecipe({ style: "desert" }).mountainShadows, 70);
assert.equal(normalizePlanetRecipe({ style: "desert", desertDetail: 200 }).desertDetail, 100);
assert.equal(normalizePlanetRecipe({ style: "barren", desertDetail: 90 }).desertDetail, 0);
for (const texture of ["dunes", "badlands", "salt"]) {
  const recipe = normalizePlanetRecipe({ style: "desert", seed: "desert-relief", texture, palette: "mars", mountains: 70, clouds: 0 });
  assert.deepEqual(normalizePlanetRecipe(JSON.stringify(recipe)), recipe);
  const terrain = createPlanetTerrain(recipe);
  assert.equal(terrain, createPlanetTerrain({ ...recipe, desertDetail: 0, mountainShadows: 0 }), "Detail preserves water basins, geology and drainage");
  const colors = Object.fromEntries(Object.entries(recipe.colors).map(([k, v]) => [k, rgb(v)]));
  const field = createPlanetDeserts(recipe, terrain, colors), ranges = [Infinity, -Infinity], maxima = { sand: 0, rock: 0, salt: 0, mesa: 0 };
  let wide = 0, peaks = 0;
  for (let i = 0; i < 4096; i++) {
    const y = 1 - (i + .5) / 2048, r = Math.sqrt(1 - y * y), angle = i * 2.399963;
    const p = [r * Math.cos(angle), y, r * Math.sin(angle)];
    const sample = field.sample(...p, terrain.elevation(...p), .002);
    assert(sample.color.every(Number.isFinite) && Number.isFinite(sample.relief));
    for (const key of Object.keys(maxima)) { assert(sample[key] >= 0 && sample[key] <= 1); maxima[key] = Math.max(maxima[key], sample[key]); }
    ranges[0] = Math.min(ranges[0], sample.color[0]); ranges[1] = Math.max(ranges[1], sample.color[0]);
    wide += terrain.mountainAt(...p) > .15; peaks += terrain.mountainPeakAt(...p) > .15;
  }
  assert(maxima.sand > .5 && maxima.rock > .5 && ranges[1] - ranges[0] > 20, "Sand and exposed rock have regional color variation");
  assert(wide > peaks * 1.5, "Desert mountains include broad shoulders and foothills");
  if (texture === "salt") assert(maxima.salt > .5);
  if (texture === "badlands") assert(maxima.mesa > .2);
  for (const y of [0, .7, .999999]) {
    const r = Math.sqrt(1 - y * y), p = [-r, y, 0], elevation = terrain.elevation(...p);
    const a = field.sample(-r, y, -1e-9, elevation), b = field.sample(-r, y, 1e-9, elevation);
    assert(Math.abs(a.relief - b.relief) < 1e-6);
    assert(a.color.every((v, i) => Math.abs(v - b.color[i]) < 1e-4));
  }
  const image = renderPlanetPixels(recipe, 96).pixels;
  assert.notDeepEqual(image, renderPlanetPixels({ ...recipe, desertDetail: 0 }, 96).pixels);
  assert.deepEqual(image, (await renderPlanetPixelsAsync(recipe, 96)).pixels);
  const dark = { ...recipe, phaseAngle: 180, nightBrightness: 0, cities: 0 };
  assert.deepEqual(renderPlanetPixels(dark, 96).pixels, renderPlanetPixels({ ...dark, desertDetail: 0 }, 96).pixels);
  const flooded = { ...recipe, water: 100, iceCoverage: 0 };
  assert.deepEqual(renderPlanetPixels(flooded, 96).pixels, renderPlanetPixels({ ...flooded, desertDetail: 0 }, 96).pixels);
  const custom = { ...recipe, customColors: true, colors: { ...recipe.colors, surfaceLow: "#391d67", surfaceHigh: "#9a62ca", rock: "#301947" } };
  assert.notDeepEqual(image, renderPlanetPixels(custom, 96).pixels, "Custom palettes remain effective");
}
console.log("PASS: desert controls, sand/rock/salt/mesas, regional colors, broader mountains, spherical seams, stable geography, custom palettes, night/ocean isolation and paired exports.");
