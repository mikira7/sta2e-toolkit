// node --experimental-vm-modules tests/barren-textures.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const modules = new Map();
async function load(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const mod = new vm.SourceTextModule(await readFile(url, "utf8")); modules.set(url.href, mod);
  await mod.link(s => load(new URL(s, url))); return mod;
}
const generator = await load(new URL("../scripts/planet-generator.js", import.meta.url)); await generator.evaluate();
const { normalizePlanetRecipe, createPlanetTerrain, renderPlanetPixels } = generator.namespace;
const { createBarrenRockTexture, sampleBarrenImpactDetail } = modules.get(new URL("../scripts/barren-textures.js", import.meta.url).href).namespace;
const { createBarrenLandforms } = modules.get(new URL("../scripts/barren-landforms.js", import.meta.url).href).namespace;
const { BARREN_MAPS, BARREN_MAP_SIZE } = modules.get(new URL("../scripts/barren-texture-data.js", import.meta.url).href).namespace;
for (const map of BARREN_MAPS) {
  assert.equal(map.length, BARREN_MAP_SIZE ** 2);
  assert(map.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
}
const recipe = normalizePlanetRecipe({ style: "barren", seed: "texture-proof", craterDensity: 75 });
const field = createBarrenRockTexture(createPlanetTerrain(recipe).noise);
for (const seed of ["texture-proof", "barren-1", "barren-3"]) {
  const terrain = createPlanetTerrain({ ...recipe, seed });
  const landscape = createBarrenLandforms(terrain, createBarrenRockTexture(terrain.noise));
  let smoothCount = 0, roughCount = 0, smoothSlope = 0, roughSlope = 0;
  for (let i = 0; i < 4096; i++) {
    const y = 1 - (i + .5) / 2048, r = Math.sqrt(1 - y * y), angle = i * 2.399963;
    const p = [r * Math.cos(angle), y, r * Math.sin(angle)], value = landscape.sample(...p);
    assert(Object.values(value).every(Number.isFinite));
    assert(Math.abs(value.relief) < .12, "Regional relief is bounded");
    const next = [p[0] + .002, p[1], p[2]], length = Math.hypot(...next);
    const slope = Math.abs(value.relief - landscape.sample(...next.map(v => v / length)).relief);
    if (value.roughness < .12 && value.basin < .1 && value.scarp < .05) { smoothCount++; smoothSlope += slope; }
    if (value.roughness > .5) { roughCount++; roughSlope += slope; }
  }
  assert(smoothCount > 100 && roughCount > 100, "Every seed has extensive smooth and rugged provinces");
  assert(roughSlope / roughCount > smoothSlope / smoothCount * 1.5, "Highlands have materially stronger relief than regolith plains");
  for (const [a, b] of [[[-1, 0, -1e-9], [-1, 0, 1e-9]], [[1e-9, 1, 0], [-1e-9, 1, 0]], [[1e-9, -1, 0], [-1e-9, -1, 0]]]) {
    const va = landscape.sample(...a), vb = landscape.sample(...b);
    for (const key of Object.keys(va)) assert(Math.abs(va[key] - vb[key]) < 1e-6, `Regional ${key} is continuous at poles and longitude`);
  }
}
for (const [a, b] of [ [[-1, 0, -1e-9], [-1, 0, 1e-9]], [[1e-9, 1, 0], [-1e-9, 1, 0]], [[1e-9, -1, 0], [-1e-9, -1, 0]] ]) {
  assert(Math.abs(field(...a) - field(...b)) < 1e-6, "Baked mapping is continuous at the poles and longitude seam");
}
for (let id = 0; id < 4; id++) {
  for (let angle = 0; angle < Math.PI * 2; angle += .1) {
    assert(Math.abs(sampleBarrenImpactDetail(id, Math.cos(angle) * 1.4, Math.sin(angle) * 1.4, .7)) < .009, "Stamp boundaries return to neutral height");
  }
}
const base = renderPlanetPixels(recipe, 128).pixels;
assert.deepEqual(base, renderPlanetPixels(recipe, 128).pixels);
assert.notDeepEqual(base, renderPlanetPixels({ ...recipe, seed: "texture-proof-2" }, 128).pixels);
const night = renderPlanetPixels({ ...recipe, phaseAngle: 180, nightBrightness: 0, clouds: 0, cities: 0 }, 96).pixels;
assert(night.every((v, i) => i % 4 === 3 || v === 0), "Baked terrain introduces no baked-in light or emission on the night side");
console.log("PASS: baked map integrity, regional roughness contrast, bounded relief, spherical continuity, neutral stamp boundaries, deterministic seed variation, and unlit night side.");
