// node --experimental-vm-modules tests/planet-cloud-relief.mjs
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
const { createPlanetWeather, createPlanetIce } = modules.get(new URL("../scripts/planet-weather.js", import.meta.url).href).namespace;
const recipe = normalizePlanetRecipe({ style: "terrestrial", seed: "class-m-1", clouds: 45, cloudThickness: 75, iceCoverage: 0, hurricanes: 2, phaseAngle: 45 });
assert.equal(recipe.cloudRelief, 70);
assert.equal(normalizePlanetRecipe({ ...recipe, cloudRelief: 200 }).cloudRelief, 100);
assert.equal(normalizePlanetRecipe({ style: "gas", cloudRelief: 80 }).cloudRelief, 0);
assert.deepEqual(normalizePlanetRecipe(JSON.stringify(recipe)), recipe);
const terrain = createPlanetTerrain(recipe);
assert.equal(terrain, createPlanetTerrain({ ...recipe, cloudRelief: 0 }));
const weatherFor = r => createPlanetWeather(r, terrain, createPlanetIce(r, terrain));
for (const cloudStyle of ["mixed", "wispy", "layered", "stormy"]) {
  const full = weatherFor({ ...recipe, cloudStyle, cloudRelief: 100 });
  const flat = weatherFor({ ...recipe, cloudStyle, cloudRelief: 0 });
  let changes = 0, directional = 0, shadows = 0;
  for (let i = 0; i < 256; i++) {
    const y = 1 - (i + .5) / 128, radius = Math.sqrt(1 - y * y), angle = i * 2.399963;
    const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
    const a = full.sample(...p, { x: 0, y: 0, z: 1 }, .004);
    const b = flat.sample(...p, { x: 0, y: 0, z: 1 }, .004);
    const c = full.sample(...p, { x: 1, y: 0, z: 0 }, .004);
    assert.equal(a.alpha, b.alpha, "Relief preserves cloud placement, gaps, and coverage");
    assert(Number.isFinite(a.shade) && a.shade > 0 && a.shade < 1.7);
    assert(Number.isFinite(a.shadow) && a.shadow >= 0 && a.shadow <= .6);
    if (Math.abs(a.shade - b.shade) > .01) changes++;
    if (Math.abs(a.shade - c.shade) > .01) directional++;
    if (a.shadow > b.shadow + .01) shadows++;
  }
  assert(changes > 5 && directional > 5 && shadows > 5, `${cloudStyle} clouds have directional relief and ground shadows`);
  const a = full.sample(-1, 0, -1e-9, { x: -1, y: 0, z: 0 }, .004);
  const b = full.sample(-1, 0, 1e-9, { x: -1, y: 0, z: 0 }, .004);
  for (const key of ["alpha", "shade", "shadow"]) assert(Math.abs(a[key] - b[key]) < 1e-6);
}
const image = renderPlanetPixels(recipe, 96).pixels;
assert.notDeepEqual(image, renderPlanetPixels({ ...recipe, cloudRelief: 0 }, 96).pixels);
assert.deepEqual(image, (await renderPlanetPixelsAsync(recipe, 96)).pixels);
for (const settings of [{ clouds: 0 }, { cloudThickness: 0 }, { phaseAngle: 180 }]) {
  const r = { ...recipe, ...settings };
  assert.deepEqual(renderPlanetPixels(r, 96).pixels, renderPlanetPixels({ ...r, cloudRelief: 0 }, 96).pixels, "Clear skies and night ambient are unchanged");
}
console.log("PASS: cloud relief controls, directional billows/shadows, unchanged cover, all cloud styles, seams, night ambient, and paired exports.");
