// node --experimental-vm-modules tests/planet-render-progress.mjs
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
const { normalizePlanetRecipe, renderPlanetPixels, renderPlanetPixelsAsync } = mod.namespace;
for (const style of ["terrestrial", "gas", "star", "asteroid"]) {
  const recipe = normalizePlanetRecipe({ style, seed: "render-progress" });
  const values = [];
  const output = await renderPlanetPixelsAsync(recipe, 64, { onProgress: value => values.push(value) });
  assert.equal(values[0], 0); assert.equal(values.at(-1), 1);
  assert(values.length > 2, `${style} reports intermediate render progress`);
  assert(values.every((v, i) => v >= 0 && v <= 1 && (!i || v >= values[i - 1])), "Render progress is bounded and monotonic");
  assert.deepEqual(output.pixels, renderPlanetPixels(recipe, 64).pixels, "Reporting progress leaves image pixels unchanged");
}
const values = [];
const crop = await renderPlanetPixelsAsync({ style: "terrestrial", seed: "render-progress" }, 64,
  { viewport: { width: 64, height: 91, radius: 80, cx: 32, cy: 120 }, onProgress: v => values.push(v) });
assert.equal(crop.height, 91); assert.equal(values.at(-1), 1, "Crops finish even when their final row is not a yield boundary");
assert(values.some(v => v > .8 && v < 1), "Crop progress uses its actual height");
console.log("PASS: incremental progress for all renderers and rectangular crops, monotonic completion, and unchanged pixels.");
