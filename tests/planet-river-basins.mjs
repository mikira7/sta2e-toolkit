// node --experimental-vm-modules tests/planet-river-basins.mjs
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
const recipe = normalizePlanetRecipe({ style: "terrestrial", seed: "class-m-1", water: 45, rivers: 80, clouds: 0, iceCoverage: 0 });
assert.equal(recipe.riverBasins, 55);
assert.equal(normalizePlanetRecipe({ style: "gas", riverBasins: 90 }).riverBasins, 0);
assert.equal(normalizePlanetRecipe({ ...recipe, riverBasins: 200 }).riverBasins, 100);
assert.deepEqual(normalizePlanetRecipe(JSON.stringify(recipe)), recipe);
const terrain = createPlanetTerrain(recipe), d = terrain.drainage;
assert.equal(terrain, createPlanetTerrain({ ...recipe, riverBasins: 0 }), "Basin appearance preserves geography and drainage");
let lakes = 0, junctions = 0;
const incoming = new Uint8Array(d.next.length);
for (let i = 0; i < d.next.length; i++) {
  const j = d.next[i], root = d.basinIds[i];
  assert(root >= 0 && d.next[root] === -1, "Every catchment has a drainage outlet");
  if (j >= 0) {
    assert(d.heights[j] < d.heights[i]);
    assert.equal(d.basinIds[i], d.basinIds[j], "Tributaries share the downstream catchment");
    assert(d.flow[j] >= d.flow[i]); incoming[j]++;
  }
  if (d.lakes[i] > 0) {
    lakes++;
    assert(d.heights[i] > terrain.seaLevel && d.lakeLevels[root] > d.heights[i]);
  }
}
for (const n of incoming) if (n > 1) junctions++;
assert(lakes > 0 && junctions > 0, "Drainage includes lakes and merging tributaries");
for (let i = 0; i < 1000; i++) {
  const y = 1 - (i + .5) / 500, r = Math.sqrt(1 - y * y), angle = i * 2.399963;
  const sample = terrain.riverSample(r * Math.cos(angle), y, r * Math.sin(angle), .005);
  for (const value of Object.values(sample)) assert(Number.isFinite(value) && value >= 0 && value <= 1);
}
const a = terrain.riverSample(-1, 0, -1e-9), b = terrain.riverSample(-1, 0, 1e-9);
for (const key of Object.keys(a)) assert(Math.abs(a[key] - b[key]) < 1e-6, "River and lake coverage wraps the longitude seam");
const image = renderPlanetPixels(recipe, 128).pixels;
assert.notDeepEqual(image, renderPlanetPixels({ ...recipe, riverBasins: 0 }, 128).pixels);
assert.deepEqual(image, (await renderPlanetPixelsAsync(recipe, 128)).pixels);
for (const settings of [{ water: 0 }, { water: 100 }, { rivers: 0 }]) {
  const r = { ...recipe, ...settings };
  assert.equal(createPlanetTerrain(r).drainage, null);
  assert.deepEqual(renderPlanetPixels(r, 64).pixels, renderPlanetPixels({ ...r, riverBasins: 0 }, 64).pixels);
}
console.log("PASS: merging downhill rivers, catchment outlets, closed-basin lakes, seams, controls, stable geography, and matched exports.");
