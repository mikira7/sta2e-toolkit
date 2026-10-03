// node --experimental-vm-modules tests/planet-mountain-lighting.mjs
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
const { createMountainLighting } = modules.get(new URL("../scripts/planet-mountain-lighting.js", import.meta.url).href).namespace;
const recipe = normalizePlanetRecipe({ style: "terrestrial", seed: "class-m-1", mountains: 80, clouds: 0, iceCoverage: 0, cities: 0, phaseAngle: 55 });
assert.equal(recipe.mountainShadows, 70);
assert.equal(normalizePlanetRecipe({ ...recipe, mountainShadows: 150 }).mountainShadows, 100);
assert.equal(normalizePlanetRecipe({ style: "gas", mountainShadows: 100 }).mountainShadows, 0);
assert.deepEqual(normalizePlanetRecipe(JSON.stringify(recipe)), recipe);
const terrain = createPlanetTerrain(recipe);
assert.equal(terrain, createPlanetTerrain({ ...recipe, mountainShadows: 0 }), "Shadow controls preserve terrain and coasts");
// A sloped ridge rises toward +X: sunlight from that side shades this slope.
const hill = { seaLevel: .4, elevation: () => .6, mountainAt: x => .4 + x * 20 };
const lighting = createMountainLighting({ mountains: 100, mountainShadows: 100 }, hill);
const a = lighting.sample(0, 0, 1, .6, .4, { x: .98, y: 0, z: .2 }, .001);
const b = lighting.sample(0, 0, 1, .6, .4, { x: -.98, y: 0, z: .2 }, .001);
assert(a < .7 && b > 1, "Shadows and highlights follow the sun across the ridge");
assert.equal(lighting.sample(0, 0, 1, .6, .4, { x: .98, y: 0, z: -.2 }), 1, "Night-side ambient is untouched");
assert.equal(lighting.sample(0, 0, 1, .3, .4, { x: .98, y: 0, z: .2 }), 1, "Submerged ranges receive no mountain shading");
assert.equal(createMountainLighting({ mountains: 100, mountainShadows: 0 }, hill).sample(0, 0, 1, .6, .4, { x: .98, y: 0, z: .2 }), 1);
const flat = createMountainLighting({ mountains: 100, mountainShadows: 100 }, { ...hill, mountainAt: () => .4 });
assert.equal(flat.sample(0, 0, 1, .6, .4, { x: Math.sqrt(1 - .001 ** 2), y: 0, z: .001 }), 1, "Flat plateaus don't cast false horizon shadows");
const image = renderPlanetPixels(recipe, 96).pixels;
assert.notDeepEqual(image, renderPlanetPixels({ ...recipe, mountainShadows: 0 }, 96).pixels);
assert.deepEqual(image, (await renderPlanetPixelsAsync(recipe, 96)).pixels, "Preview and export agree");
for (const settings of [{ water: 100 }, { mountains: 0 }, { phaseAngle: 180 }]) {
  const r = { ...recipe, ...settings };
  assert.deepEqual(renderPlanetPixels(r, 96).pixels, renderPlanetPixels({ ...r, mountainShadows: 0 }, 96).pixels, "Ocean, mountain-free, and night-side renders are unchanged");
}
console.log("PASS: directional mountain shadows, ambient preservation, ocean isolation, stable geometry, and matched exports.");
