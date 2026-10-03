// node --experimental-vm-modules tests/planet-ring-layers.mjs
// The 2.5D ring split and the viewport crop must both be exact re-arrangements
// of the whole-disc render, never a second look.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const modules = new Map();
async function load(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const module = new vm.SourceTextModule(await readFile(url, "utf8"), { identifier: url.href });
  modules.set(url.href, module);
  await module.link(specifier => load(new URL(specifier, url)));
  return module;
}
const module = await load(new URL("../scripts/planet-generator.js", import.meta.url));
await module.evaluate();
const { normalizePlanetRecipe, renderPlanetPixels } = module.namespace;

const SIZE = 160;
const cases = [
  { seed: "saturn", style: "gas", rings: true, axialTilt: 62 },
  { seed: "saturn", style: "gas", rings: true, axialTilt: 118 },
  { seed: "ringed-rock", style: "barren", rings: true, ringStyle: "dusty", axialTilt: 35 },
  { seed: "edge-on", style: "ice", rings: true, ringStyle: "narrow", axialTilt: 88 },
];

for (const raw of cases) {
  const recipe = normalizePlanetRecipe(raw);
  const all = renderPlanetPixels(recipe, SIZE, { view: "scene" });
  const back = renderPlanetPixels(recipe, SIZE, { view: "scene", ringLayer: "back" });
  const front = renderPlanetPixels(recipe, SIZE, { view: "scene", ringLayer: "front" });
  let worst = 0, frontPixels = 0, backRing = 0;
  for (let i = 0; i < all.pixels.length; i += 4) {
    const fa = front.pixels[i + 3] / 255, ba = back.pixels[i + 3] / 255;
    const a = fa + ba * (1 - fa);
    if (fa > 0) frontPixels++;
    worst = Math.max(worst, Math.abs(a * 255 - all.pixels[i + 3]));
    if (a < .05) continue;
    for (let k = 0; k < 3; k++) {
      const c = (front.pixels[i + k] * fa + back.pixels[i + k] * ba * (1 - fa)) / a;
      // Colour is only meaningful where the pixel has real coverage.
      if (all.pixels[i + 3] > 40) worst = Math.max(worst, Math.abs(c - all.pixels[i + k]) * Math.min(1, a));
    }
    if (ba > 0 && fa === 0) backRing++;
  }
  assert(frontPixels > 0, `${raw.seed}@${raw.axialTilt}: the near ring arc renders on the front layer`);
  assert(backRing > 0, `${raw.seed}@${raw.axialTilt}: the back layer is not empty`);
  assert(worst <= 3, `${raw.seed}@${raw.axialTilt}: front over back reproduces the single render (worst ${worst.toFixed(2)})`);
}

// The front layer never carries the globe: its centre is transparent unless the
// near ring crosses it.
{
  const recipe = normalizePlanetRecipe({ seed: "saturn", style: "gas", rings: true, axialTilt: 20 });
  const front = renderPlanetPixels(recipe, SIZE, { view: "scene", ringLayer: "front" });
  const c = (SIZE / 2 * SIZE + SIZE / 2) * 4;
  assert.equal(front.pixels[c + 3], 0, "The globe stays in the back layer");
}

// A viewport framing exactly the default disc reproduces the default render.
for (const raw of [cases[0], { seed: "class-m-1", style: "terrestrial" }]) {
  const recipe = normalizePlanetRecipe(raw);
  const bodyScale = recipe.rings ? .54 : 1;
  const whole = renderPlanetPixels(recipe, SIZE, { view: "scene" });
  const crop = renderPlanetPixels(recipe, SIZE, { view: "scene", viewport: { width: SIZE, height: SIZE, radius: SIZE * .48 * bodyScale, cx: SIZE / 2, cy: SIZE / 2 } });
  let worst = 0;
  for (let i = 0; i < whole.pixels.length; i++) worst = Math.max(worst, Math.abs(whole.pixels[i] - crop.pixels[i]));
  assert(worst <= 1, `${raw.seed}: full-frame viewport matches the whole-disc render (worst ${worst})`);
}

// A limb crop is non-square, and the globe fills its lower edge.
{
  const recipe = normalizePlanetRecipe({ seed: "class-m-1", style: "terrestrial" });
  const w = 200, h = 80, radius = 900;
  const limb = renderPlanetPixels(recipe, 512, { view: "scene", viewport: { width: w, height: h, radius, cx: w / 2, cy: h + radius - h * .6 } });
  assert.equal(limb.width, w);
  assert.equal(limb.height, h);
  assert.equal(limb.pixels.length, w * h * 4);
  assert.equal(limb.pixels[((h - 1) * w + w / 2) * 4 + 3], 255, "Bottom centre is solid globe");
  assert.equal(limb.pixels[(0 * w + 2) * 4 + 3], 0, "Top corner is open space");
}

// Ring view is face-on: the ring band is round, not squashed.
{
  const recipe = normalizePlanetRecipe({ seed: "saturn", style: "gas", rings: true, axialTilt: 70 });
  const top = renderPlanetPixels(recipe, SIZE, { view: "ring" });
  const alphaAt = (x, y) => top.pixels[(y * SIZE + x) * 4 + 3];
  const r = Math.round(SIZE * .48 * .8);
  const h = alphaAt(SIZE / 2 + r, SIZE / 2), v = alphaAt(SIZE / 2, SIZE / 2 + r);
  assert(h > 0 && v > 0, "A face-on ring covers both axes at the same radius");
}

console.log("planet-ring-layers: ok");
