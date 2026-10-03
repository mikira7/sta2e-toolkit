// node --experimental-vm-modules tests/planet-dense-clouds.mjs
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
const { createGreenhouseClouds } = modules.get(new URL("../scripts/planet-weather.js", import.meta.url).href).namespace;
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
for (const texture of ["venus", "toxic"]) {
  const recipe = normalizePlanetRecipe({ style: "greenhouse", texture, seed: "venus-clouds", phaseAngle: 55 });
  assert.equal(recipe.envelopeRelief, 75); assert.equal(recipe.clouds, 100);
  assert.equal(recipe.envelopeStorms, texture === "toxic" ? 70 : 35);
  assert.deepEqual(normalizePlanetRecipe(JSON.stringify(recipe)), recipe);
  const terrain = createPlanetTerrain(recipe), colors = Object.fromEntries(Object.entries(recipe.colors).map(([k, v]) => [k, rgb(v)]));
  const field = createGreenhouseClouds(recipe, terrain, colors);
  const off = createGreenhouseClouds({ ...recipe, envelopeRelief: 0 }, terrain, colors);
  const calm = createGreenhouseClouds({ ...recipe, envelopeStorms: 0 }, terrain, colors);
  const light = { x: 0, y: .8, z: .6 };
  let minShade = 1, maxShade = 1, redMin = 255, redMax = 0, changed = 0;
  for (let i = 0; i < 2048; i++) {
    const y = 1 - (i + .5) / 1024, radius = Math.sqrt(1 - y * y), angle = i * 2.399963;
    const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
    const sample = field.sampleSurface(...p, light, .002);
    assert(sample.color.every(v => Number.isFinite(v) && v >= 0 && v <= 255));
    assert(sample.shade >= .25 && sample.shade <= 1.23);
    assert.equal(off.sampleSurface(...p, light, .002).shade, 1);
    if (p[1] * .8 + p[2] * .6 < 0) assert.equal(sample.shade, 1);
    minShade = Math.min(minShade, sample.shade); maxShade = Math.max(maxShade, sample.shade);
    redMin = Math.min(redMin, sample.color[0]); redMax = Math.max(redMax, sample.color[0]);
    changed += Math.abs(sample.color[0] - calm.sampleSurface(...p, light, .002).color[0]) > 1;
    if (texture === "toxic") assert(sample.color[0] > sample.color[1] * 2, "Demon clouds favor deep crimson");
  }
  assert(minShade < .85 && maxShade > 1.04, "Raised clouds have lit slopes and dark troughs");
  assert(redMax - redMin > 15 && changed > 100);
  for (const [a, b] of [[[-1, 0, -1e-9], [-1, 0, 1e-9]], [[1e-9, 1, 0], [-1e-9, 1, 0]]]) {
    const left = field.sampleSurface(...a, light), right = field.sampleSurface(...b, light);
    assert(Math.abs(left.shade - right.shade) < 1e-5);
    assert(left.color.every((v, i) => Math.abs(v - right.color[i]) < 1e-4));
  }
  const image = renderPlanetPixels(recipe, 96).pixels;
  assert.notDeepEqual(image, renderPlanetPixels({ ...recipe, envelopeRelief: 0 }, 96).pixels);
  assert.deepEqual(image, (await renderPlanetPixelsAsync(recipe, 96)).pixels);
  for (let y = 25; y < 70; y++) for (let x = 25; x < 70; x++) assert.equal(image[(y * 96 + x) * 4 + 3], 255);
  const night = { ...recipe, phaseAngle: 180, nightBrightness: 0 };
  const nightPixels = renderPlanetPixels(night, 64).pixels;
  assert(nightPixels.every((v, i) => i % 4 === 3 || nightPixels[i - i % 4 + 3] === 0 || v === 0), "Dense clouds do not emit at night");
  const custom = Object.fromEntries(Object.keys(colors).map(k => [k, [35, 80, 155]]));
  assert.deepEqual(createGreenhouseClouds(recipe, terrain, custom).sample(0, 0, 1), [35, 80, 155]);
}
assert.equal(normalizePlanetRecipe({ style: "terrestrial", envelopeRelief: 100 }).envelopeRelief, 0);
console.log("PASS: dense-cloud controls, Venus/Demon palettes, turbulence, directional relief, dark troughs, opaque decks, seams, custom colors, night isolation and matched exports.");
