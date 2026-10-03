// node --experimental-vm-modules tests/planet-giant-basins.mjs
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
for (const style of ["terrestrial", "gas", "ice", "star"]) assert.equal(normalizePlanetRecipe({ style, giantImpactBasin: 80 }).giantImpactBasin, 0);
for (const style of ["desert", "barren"]) {
  const recipe = normalizePlanetRecipe({ style, seed: "giant-basin", water: 0, clouds: 0, iceCoverage: 0, giantImpactBasin: 90, lavaBeds: 0, crustPlates: "stagnant" });
  assert.equal(normalizePlanetRecipe({ style }).giantImpactBasin, 0);
  assert.equal(normalizePlanetRecipe({ ...recipe, giantImpactBasin: 900 }).giantImpactBasin, 100);
  assert.deepEqual(normalizePlanetRecipe(JSON.stringify(recipe)), recipe);
  const terrain = createPlanetTerrain(recipe), weak = createPlanetTerrain({ ...recipe, giantImpactBasin: 30 }), off = createPlanetTerrain({ ...recipe, giantImpactBasin: 0 });
  assert.deepEqual(terrain.geology.giantImpact, weak.geology.giantImpact, "Strength preserves basin placement");
  assert.equal(terrain.crust.plates.length, 1); assert.equal(terrain.crust.boundaries.length, 0);
  const f = terrain.geology.giantImpact, center = f.center;
  const inside = terrain.surfaceAt(...center), outside = terrain.surfaceAt(...center.map(v => -v));
  assert(inside.landform.giantBasin > .8 && outside.landform.giantBasin === 0);
  assert(inside.elevation < off.elevation(...center) - .05, "Giant basin depresses lowlands");
  assert(inside.landform.flatten > .8);
  const offset = sign => { const p = center.map((v, i) => v + f.along[i] * .012 * sign), n = Math.hypot(...p); return p.map(v => v / n); };
  const a = offset(-1), b = offset(1);
  assert(Math.abs(terrain.elevation(...a) - terrain.elevation(...b)) < Math.abs(off.elevation(...a) - off.elevation(...b)) * .3, "Lowland relief is smoother than the original terrain");
  let basinArea = 0, scarp = 0;
  for (let i = 0; i < 2048; i++) {
    const y = 1 - (i + .5) / 1024, r = Math.sqrt(1 - y * y), angle = i * 2.399963;
    const p = [r * Math.cos(angle), y, r * Math.sin(angle)], s = terrain.surfaceAt(...p);
    assert(Number.isFinite(s.elevation)); basinArea += s.landform.giantBasin > .4; scarp = Math.max(scarp, s.landform.giantScarp);
    assert.equal(off.elevation(...p), createPlanetTerrain({ ...recipe, giantImpactBasin: 0, crustPlates: "none" }).elevation(...p), "Stagnant crust adds no active boundary relief");
  }
  assert(basinArea > 200 && basinArea < 1000 && scarp > .2, "Asymmetric lowlands cover a substantial part of the sphere and retain a broken boundary");
  const lava = createPlanetTerrain({ ...recipe, lavaBeds: 65 });
  assert(lava.geology.lavaBeds.length > 0);
  for (const mode of ["active", "ancient"]) assert(createPlanetTerrain({ ...recipe, crustPlates: mode }).crust.boundaries.length > 0);
  const wet = createPlanetTerrain({ ...recipe, water: 30, rivers: 80, lavaBeds: 50 });
  for (let i = 0; i < wet.drainage.next.length; i++) {
    const j = wet.drainage.next[i]; if (j >= 0) assert(wet.drainage.heights[j] < wet.drainage.heights[i]);
  }
  const left = terrain.surfaceAt(-1, 0, -1e-9), right = terrain.surfaceAt(-1, 0, 1e-9);
  assert(Math.abs(left.elevation - right.elevation) < 1e-6);
  const image = renderPlanetPixels({ ...recipe, lavaBeds: 65 }, 96).pixels;
  assert.notDeepEqual(image, renderPlanetPixels({ ...recipe, giantImpactBasin: 0, lavaBeds: 0 }, 96).pixels);
  assert.deepEqual(image, (await renderPlanetPixelsAsync({ ...recipe, lavaBeds: 65 }, 96)).pixels);
  const night = { ...recipe, lavaBeds: 65, phaseAngle: 180, nightBrightness: 0, cities: 0 };
  assert(renderPlanetPixels(night, 64).pixels.every((v, i) => i % 4 === 3 || v === 0), "Ancient volcanic flats have no glow");
}
console.log("PASS: giant lowland extent/depression/smoothing, stable basin placement, stagnant/active/ancient crust, desert/barren volcanic flats, downhill drainage, seams, persistence and non-emissive exports.");
