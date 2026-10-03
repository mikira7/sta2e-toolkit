// node --experimental-vm-modules tests/planet-lava-glow.mjs
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
const { createPlanetLava } = modules.get(new URL("../scripts/planet-lava.js", import.meta.url).href).namespace;
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
for (const style of ["volcanic", "primordial"]) {
  const recipe = normalizePlanetRecipe({ style, seed: "lava-glow", water: 0, clouds: 0, iceCoverage: 0, nightBrightness: 0 });
  assert.equal(recipe.lavaGlow, 75);
  assert.deepEqual(normalizePlanetRecipe(JSON.stringify(recipe)), recipe);
  const terrain = createPlanetTerrain(recipe), colors = Object.fromEntries(Object.entries(recipe.colors).map(([k, v]) => [k, rgb(v)]));
  assert.equal(terrain, createPlanetTerrain({ ...recipe, lavaGlow: 0 }));
  const field = createPlanetLava(recipe, terrain, colors), off = createPlanetLava({ ...recipe, lavaGlow: 0 }, terrain, colors);
  let hot = 0, cold = 0, brightest = 0, darkest = Infinity;
  for (let i = 0; i < 2048; i++) {
    const y = 1 - (i + .5) / 1024, radius = Math.sqrt(1 - y * y), angle = i * 2.399963;
    const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
    const sample = field.sample(...p, .8, .002);
    assert(sample.color.every(v => Number.isFinite(v) && v >= 0 && v <= 255));
    assert(sample.emission.every(v => Number.isFinite(v) && v >= 0 && v <= 255));
    hot = Math.max(hot, sample.hotSpot); cold = Math.max(cold, sample.cooling);
    brightest = Math.max(brightest, sample.emission[0]); darkest = Math.min(darkest, sample.emission[0]);
    assert.deepEqual(off.sample(...p, .8, .002).emission, [0, 0, 0]);
  }
  assert(hot > .8 && cold > .9 && brightest > 130 && darkest < 5, "Lava contains bright hot cores and dark cooling spots");
  if (style === "volcanic" || recipe.texture === "magma") {
    const vent = terrain.geology.volcanoes[0];
    const center = field.sample(...vent.center, 0);
    const displaced = vent.center.map((v, i) => v + vent.along[i] * .05), len = Math.hypot(...displaced);
    const halo = field.sample(...displaced.map(v => v / len), 0);
    assert(center.emission.every(v => v > 220), "Eruption cores approach white heat");
    assert(halo.emission[0] > 25 && halo.emission[0] < center.emission[0], "Warm halo surrounds eruption centers");
    assert.deepEqual(off.sample(...vent.center, 0).emission, [0, 0, 0]);
  }
  const a = field.sample(-1, 0, -1e-9, .8), b = field.sample(-1, 0, 1e-9, .8);
  assert(a.emission.every((v, i) => Math.abs(v - b.emission[i]) < 1e-4));
  const night = { ...recipe, phaseAngle: 180 };
  const image = renderPlanetPixels(night, 96).pixels;
  assert.deepEqual(image, (await renderPlanetPixelsAsync(night, 96)).pixels);
  assert(image.some((v, i) => i % 4 !== 3 && v > 0));
  assert(renderPlanetPixels({ ...night, lavaGlow: 0 }, 96).pixels.every((v, i) => i % 4 === 3 || v === 0), "Disabling glow gives a dark night side");
  for (const changes of [{ water: 100 }, { iceCoverage: 100 }]) {
    const hidden = { ...night, ...changes };
    assert.deepEqual(renderPlanetPixels(hidden, 64).pixels, renderPlanetPixels({ ...hidden, lavaGlow: 0 }, 64).pixels, "Water and ice hide lava glow");
  }
}
for (const texture of ["crust", "developing"]) {
  const recipe = normalizePlanetRecipe({ style: "primordial", texture });
  const colors = Object.fromEntries(Object.entries(recipe.colors).map(([k, v]) => [k, rgb(v)]));
  const field = createPlanetLava(recipe, createPlanetTerrain(recipe), colors);
  assert.deepEqual(field.sample(0, 0, 1, 0).emission, [0, 0, 0], "Cooling and developing worlds keep their quieter solid crust");
}
for (const style of ["barren", "desert", "gas"]) assert.equal(normalizePlanetRecipe({ style, lavaGlow: 100 }).lavaGlow, 0);
console.log("PASS: dark cooling crust, bright molten cores, zero/land emission, seeded seams, stable geography, night glow, water/ice occlusion and matched exports.");
