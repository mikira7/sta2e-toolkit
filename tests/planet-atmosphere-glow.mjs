// node --experimental-vm-modules tests/planet-atmosphere-glow.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const modules = new Map();
async function load(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const mod = new vm.SourceTextModule(await readFile(url, "utf8"));
  modules.set(url.href, mod);
  await mod.link(s => load(new URL(s, url)));
  return mod;
}
const mod = await load(new URL("../scripts/planet-generator.js", import.meta.url));
await mod.evaluate();
const { normalizePlanetRecipe: normalize, renderPlanetPixels: render, renderPlanetPixelsAsync: renderAsync } = mod.namespace;
assert.equal(normalize({ style: "barren" }).atmosphereGlow, 0);
for (const style of ["star", "asteroid"]) assert.equal(normalize({ style, atmosphereGlow: 100 }).atmosphereGlow, 0);
assert.equal(normalize({ atmosphereGlow: 999 }).atmosphereGlow, 100);
assert.equal(normalize({ atmosphereGlow: -10 }).atmosphereGlow, 0);
assert.equal(normalize({ atmosphereColor: "#AABBCC" }).atmosphereColor, "#aabbcc");
assert.equal(normalize({ style: "terrestrial", atmosphereColor: "invalid" }).atmosphereColor, "#5bafff");
for (const style of ["terrestrial", "ocean", "desert", "ice", "barren", "volcanic", "primordial", "greenhouse", "gas"]) {
  const r = normalize({ style, seed: "atmosphere", atmosphereGlow: 80, clouds: 0, cities: 0, phaseAngle: 0, nightBrightness: 0 });
  const lit = render(r, 128).pixels;
  assert.notDeepEqual(lit, render({ ...r, atmosphereGlow: 0 }, 128).pixels, `${style} can have atmosphere without clouds`);
  assert.deepEqual(lit, (await renderAsync(r, 128)).pixels, `${style} synchronous and asynchronous exports agree`);
  assert.deepEqual(lit, render({ ...r, axialTilt: 70 }, 128, { view: "scene" }).pixels);
  const at = (x, c) => lit[(64 * 128 + x) * 4 + c];
  assert(at(125, 3) > at(126, 3), `${style} glow fades outward: ${at(125, 3)}, ${at(126, 3)} (strength ${r.atmosphereGlow}, rings ${r.rings})`);
  assert(at(126, 3) > 0, `${style} has an exterior halo under front illumination`);
  const red = render({ ...r, atmosphereColor: "#ff2200" }, 128).pixels;
  const blue = render({ ...r, atmosphereColor: "#0022ff" }, 128).pixels;
  const i = (64 * 128 + 126) * 4;
  assert(red[i] > blue[i] && blue[i + 2] > red[i + 2], `${style} exterior hue follows selected color`);
}
for (const style of ["terrestrial", "ocean", "desert", "ice", "barren", "gas"]) {
  const night = render(normalize({ style, atmosphereGlow: 100, phaseAngle: 180, nightBrightness: 0, clouds: 0, cities: 0 }), 96).pixels;
  assert(night.every((v, i) => i % 4 === 3 || night[i - i % 4 + 3] === 0 || v === 0), `${style} atmosphere does not self-illuminate`);
}
console.log("PASS: atmosphere defaults, cloud independence, exterior falloff and color, lighting, and matched exports/views.");
