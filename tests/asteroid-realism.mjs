// node --experimental-vm-modules tests/asteroid-realism.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const cache = new Map();
async function load(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const mod = new vm.SourceTextModule(await readFile(url, "utf8"), { identifier: url.href });
  cache.set(url.href, mod);
  await mod.link(specifier => load(new URL(specifier, url)));
  return mod;
}
const mod = await load(new URL("../scripts/planet-generator.js", import.meta.url));
await mod.evaluate();
const { normalizePlanetRecipe, createPlanetTerrain, renderPlanetPixels, renderPlanetPixelsAsync } = mod.namespace;
const { createAsteroidMaterial, createAsteroidShadow } = cache.get(new URL("../scripts/asteroid-material.js", import.meta.url).href).namespace;
const alpha = pixels => pixels.filter((_, i) => i % 4 === 3);
for (const texture of ["silicate", "carbonaceous", "metallic", "icy"]) {
  const recipe = normalizePlanetRecipe({ style: "asteroid", texture, seed: `test-${texture}`, axialTilt: 70, phaseAngle: 45 });
  const colors = Object.fromEntries(Object.entries(recipe.colors).map(([key, hex]) => [key, [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))]));
  const terrain = createPlanetTerrain(recipe), material = createAsteroidMaterial(recipe, terrain, colors);
  let depressions = 0;
  for (const c of material.craters) {
    if (Math.hypot(...material.point(c.center)) < Math.hypot(...material.point(c.center, false)) - .0001) depressions++;
  }
  assert(depressions > material.craters.length * .8, "Impacts depress actual geometry, rather than just darkening a texture");
  for (const [a, b] of [ [[-1, 0, -1e-9], [-1, 0, 1e-9]], [[1e-9, 1, 0], [-1e-9, 1, 0]], [[1e-9, -1, 0], [-1e-9, -1, 0]] ]) {
    const pa = material.point(a), pb = material.point(b);
    assert(pa.every((v, i) => Math.abs(v - pb[i]) < 1e-6), "Geometry has no longitude or pole seam");
    const sa = material.sample(a, a, [0, .8, .6], [0, 0, 1], .003), sb = material.sample(b, b, [0, .8, .6], [0, 0, 1], .003);
    assert(sa.color.every((v, i) => Math.abs(v - sb.color[i]) < 1e-5));
    assert(Math.abs(sa.illumination - sb.illumination) < 1e-5);
  }
  const image = renderPlanetPixels(recipe, 96).pixels;
  assert.deepEqual(image, renderPlanetPixels(recipe, 96).pixels);
  assert.deepEqual(image, renderPlanetPixels(recipe, 96, { view: "scene" }).pixels);
  assert.deepEqual(image, (await renderPlanetPixelsAsync(recipe, 96)).pixels);
  const rotated = renderPlanetPixels(recipe, 96, { lightDirection: 180 }).pixels;
  assert.notDeepEqual(image, rotated, "Light direction changes the asteroid's shading and cast shadows");
  assert.deepEqual(alpha(image), alpha(rotated), "Light direction does not move the body or change its silhouette");
  assert(alpha(image).some(a => a > 0 && a < 255), "Silhouette has filtered transparency");
  const night = renderPlanetPixels({ ...recipe, phaseAngle: 180, nightBrightness: 0 }, 96).pixels;
  let visible = 0, lit = 0;
  for (let i = 0; i < night.length; i += 4) if (night[i + 3]) { visible++; if (night[i] + night[i + 1] + night[i + 2] > 5) lit++; }
  assert(lit / visible < .015, "Unlit asteroids do not glow (allowing tiny mesh-normal differences at the silhouette)");
  assert.notDeepEqual(image, renderPlanetPixels({ ...recipe, nightBrightness: 20 }, 96).pixels, "Night brightness control is respected");
  const recolored = { ...recipe, customColors: true, colors: { ...recipe.colors, surfaceLow: "#602010", surfaceHigh: "#e0a050" } };
  const colored = renderPlanetPixels(recolored, 96).pixels;
  assert.notDeepEqual(image, colored);
  assert.deepEqual(alpha(image), alpha(colored), "Custom colors preserve asteroid shape");
}
// A raised square blocks sunlight from the surface beneath it, while the
// surrounding plane and the upper face stay lit. This tests occlusion itself.
const vertices = [
  [-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0],
  [-.3, -.3, .3], [.3, -.3, .3], [.3, .3, .3], [-.3, .3, .3],
].map(p => ({ p }));
const shadow = createAsteroidShadow(vertices, [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7]], [0, 0, 1]);
assert.equal(shadow([0, 0, 0], [0, 0, 1]), 0, "Raised geometry casts a shadow");
assert.equal(shadow([.7, .7, 0], [0, 0, 1]), 1, "Unobstructed surface stays lit");
assert.equal(shadow([0, 0, .3], [0, 0, 1]), 1, "Sun-facing geometry does not shadow itself");
console.log("PASS: asteroid impact geometry, seams, material variants, deterministic views/exports, lighting, cast shadows, silhouette filtering and custom colors.");
