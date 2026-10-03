// node --experimental-vm-modules tests/stellar-cinematic.mjs
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
assert.equal(normalizePlanetRecipe({ style: "star" }).stellarDetail, 75);
assert.equal(normalizePlanetRecipe({ style: "terrestrial", stellarDetail: 100 }).stellarDetail, 0);
for (const texture of ["O", "B", "A", "F", "G", "K", "M", "White Dwarf", "T-Tauri", "L", "T", "Y"]) {
  const recipe = normalizePlanetRecipe({ style: "star", texture, seed: "cinematic-star", stellarGlow: 0, stellarFlares: 0, lensFlare: 0 });
  assert.deepEqual(normalizePlanetRecipe(JSON.stringify(recipe)), recipe);
  assert.equal(createPlanetTerrain(recipe), createPlanetTerrain({ ...recipe, stellarDetail: 0 }));
  const image = renderPlanetPixels(recipe, 96).pixels;
  assert.deepEqual(image, (await renderPlanetPixelsAsync(recipe, 96)).pixels);
  assert.deepEqual(image, renderPlanetPixels({ ...recipe, phaseAngle: 180, nightBrightness: 0 }, 96).pixels, "Stars supply their own light");
  if (["L", "T", "Y"].includes(texture)) assert.deepEqual(image, renderPlanetPixels({ ...recipe, stellarDetail: 0 }, 96).pixels);
  else assert.notDeepEqual(image, renderPlanetPixels({ ...recipe, stellarDetail: 0 }, 96).pixels);
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
    if (Math.hypot(x + .5 - 48, y + .5 - 48) > 96 * .36 + 1) assert.equal(image[(y * 96 + x) * 4 + 3], 0);
  }
  const colored = { ...recipe, customColors: true, colors: { ...recipe.colors, surfaceLow: "#262b83", surfaceHigh: "#a5cfff" } };
  assert.notDeepEqual(image, renderPlanetPixels(colored, 96).pixels, "Custom spectral colors remain effective");
  const active = { ...recipe, stellarFlares: 80, stellarGlow: 70, lensFlare: 20, axialTilt: 70 };
  const illuminated = renderPlanetPixels(active, 96).pixels;
  assert.notDeepEqual(image, illuminated);
  assert.deepEqual(illuminated, renderPlanetPixels(active, 96, { view: "scene" }).pixels);
}
const base = normalizePlanetRecipe({ style: "star", texture: "G", seed: "cinematic-star", stellarFlares: 0, stellarGlow: 0, lensFlare: 0 });
const exteriorAlpha = recipe => {
  const image = renderPlanetPixels(recipe, 128).pixels;
  let sum = 0;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (Math.hypot(x + .5 - 64, y + .5 - 64) > 128 * .36) sum += image[(y * 128 + x) * 4 + 3];
  }
  return sum;
};
assert(exteriorAlpha({ ...base, stellarGlow: 75 }) > exteriorAlpha({ ...base, stellarGlow: 25 }) * 1.5, "Corona strength increases exterior light");
assert(exteriorAlpha({ ...base, stellarFlares: 85 }) > exteriorAlpha({ ...base, stellarFlares: 25 }) * 2, "Flare strength increases the visible plasma envelope");
const seamless = renderPlanetPixels({ ...base, stellarGlow: 75 }, 320).pixels;
let limbSamples = 0;
for (let y = 0; y < 320; y++) for (let x = 0; x < 320; x++) {
  const d = Math.hypot(x + .5 - 160, y + .5 - 160) / (320 * .36);
  if (d < .994 || d > 1.005) continue;
  assert(seamless[(y * 320 + x) * 4 + 3] > 230, "Corona fills the antialiased photosphere edge without a transparent dark seam");
  limbSamples++;
}
assert(limbSamples > 100);
const surfaceMetrics = detail => {
  const size = 256, image = renderPlanetPixels({ ...base, stellarDetail: detail }, size).pixels;
  const luminance = (x, y) => {
    const i = (y * size + x) * 4;
    return image[i] * .2126 + image[i + 1] * .7152 + image[i + 2] * .0722;
  };
  let highFrequency = 0, brightness = 0, count = 0;
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    if (Math.hypot(x + .5 - size / 2, y + .5 - size / 2) > size * .36 * .75) continue;
    const current = luminance(x, y);
    highFrequency += Math.abs(current - (luminance(x - 1, y) + luminance(x + 1, y) + luminance(x, y - 1) + luminance(x, y + 1)) / 4);
    brightness += current; count++;
  }
  return { highFrequency: highFrequency / count, brightness: brightness / count };
};
const simpleSurface = surfaceMetrics(0), glowingSurface = surfaceMetrics(85);
assert(glowingSurface.highFrequency < simpleSurface.highFrequency * .75, `Fine speckle decreases: ${JSON.stringify({ simpleSurface, glowingSurface })}`);
assert(glowingSurface.brightness > simpleSurface.brightness + 8, `Diffuse photosphere glow increases surface luminance: ${JSON.stringify({ simpleSurface, glowingSurface })}`);
console.log("PASS: cinematic detail controls, all stellar types, restrained brown dwarfs, spectral colors, self illumination, disabled exterior glow, stronger flares/corona and deterministic paired exports.");
