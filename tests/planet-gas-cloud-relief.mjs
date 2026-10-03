// node --experimental-vm-modules tests/planet-gas-cloud-relief.mjs
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
const { createGasGiantMaterial } = modules.get(new URL("../scripts/gas-giant-material.js", import.meta.url).href).namespace;
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const fieldFor = r => createGasGiantMaterial(r, createPlanetTerrain(r), Object.fromEntries(Object.entries(r.colors).map(([k, v]) => [k, rgb(v)])));
assert.equal(normalizePlanetRecipe({ style: "gas" }).gasCloudRelief, 70);
assert.equal(normalizePlanetRecipe({ style: "terrestrial", gasCloudRelief: 90 }).gasCloudRelief, 0);
assert.equal(normalizePlanetRecipe({ style: "gas", gasCloudRelief: 150 }).gasCloudRelief, 100);
for (const texture of ["banded", "turbulent", "smooth", "ice-hazy", "ice-stormy", "hot"]) {
  const recipe = normalizePlanetRecipe({ style: "gas", seed: "gas-relief", texture, phaseAngle: 50 });
  assert.deepEqual(normalizePlanetRecipe(JSON.stringify(recipe)), recipe);
  const full = fieldFor(recipe), flat = fieldFor({ ...recipe, gasCloudRelief: 0 });
  assert.deepEqual(full.belts, flat.belts); assert.deepEqual(full.storms, flat.storms);
  let directional = 0;
  for (let i = 0; i < 256; i++) {
    const y = 1 - (i + .5) / 128, radius = Math.sqrt(1 - y * y), angle = i * 2.399963;
    const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
    const a = full.sampleSurface(...p, { x: 0, y: 0, z: 1 }, .004);
    const b = full.sampleSurface(...p, { x: 1, y: 0, z: 0 }, .004);
    const old = flat.sampleSurface(...p, { x: 0, y: 0, z: 1 }, .004);
    assert.deepEqual(a.color, old.color, "Lighting preserves cloud colors and placement");
    assert.deepEqual(a.emission, old.emission, "Hot glow is independent of relief");
    assert.equal(old.shade, 1);
    assert(Number.isFinite(a.shade) && a.shade >= .29 && a.shade <= 1.25);
    if (p[2] <= 0) assert.equal(a.shade, 1, "Relief leaves night ambient unchanged");
    if (Math.abs(a.shade - b.shade) > .002) directional++;
  }
  assert(directional > 5, `${texture} cloud relief follows sunlight`);
  for (const y of [0, .7, .99999]) {
    const r = Math.sqrt(1 - y * y), light = { x: -1, y: 0, z: 0 };
    const a = full.sampleSurface(-r, y, -1e-9, light, .004), b = full.sampleSurface(-r, y, 1e-9, light, .004);
    assert(Math.abs(a.shade - b.shade) < 1e-5, "Relief wraps smoothly across longitude");
  }
  const image = renderPlanetPixels(recipe, 96).pixels;
  assert.notDeepEqual(image, renderPlanetPixels({ ...recipe, gasCloudRelief: 0 }, 96).pixels);
  assert.deepEqual(image, (await renderPlanetPixelsAsync(recipe, 96)).pixels);
  const night = { ...recipe, phaseAngle: 180 };
  assert.deepEqual(renderPlanetPixels(night, 96).pixels, renderPlanetPixels({ ...night, gasCloudRelief: 0 }, 96).pixels);
}
console.log("PASS: gas cloud controls, bands/storms/palettes, all atmosphere types, sun-directed relief, seams, emission/night preservation, and paired exports.");
