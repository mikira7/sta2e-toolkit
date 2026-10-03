// node --experimental-vm-modules tests/planet-closeups.mjs [preview.png]
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import vm from "node:vm";
const modules = new Map();
async function load(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const mod = new vm.SourceTextModule(await readFile(url, "utf8")); modules.set(url.href, mod);
  await mod.link(s => load(new URL(s, url))); return mod;
}
const mod = await load(new URL("../scripts/planet-generator.js", import.meta.url)); await mod.evaluate();
const { normalizePlanetRecipe, renderPlanetPixels, renderPlanetPixelsAsync } = mod.namespace;
for (const style of ["terrestrial", "barren", "gas", "volcanic", "primordial", "greenhouse"]) {
  const recipe = normalizePlanetRecipe({ style, seed: "orbital-test", rings: style === "gas" });
  const full = renderPlanetPixels(recipe, 320, { view: "scene" });
  const radius = 320 * .48 * (recipe.rings ? .54 : 1);
  const viewport = { width: 128, height: 96, radius, cx: 64, cy: 128 };
  const crop = renderPlanetPixels(recipe, 320, { view: "scene", viewport });
  assert.equal(crop.width, 128); assert.equal(crop.height, 96);
  let maxError = 0;
  for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) for (let c = 0; c < 4; c++) {
    maxError = Math.max(maxError, Math.abs(crop.pixels[(y * 128 + x) * 4 + c] - full.pixels[((y + 32) * 320 + x + 96) * 4 + c]));
  }
  assert(maxError <= 1, `${style} crops retain the same geography, rings, and illumination at native scale`);
  assert.deepEqual(crop.pixels, (await renderPlanetPixelsAsync(recipe, 320, { view: "scene", viewport })).pixels);
}
const recipe = normalizePlanetRecipe({ style: "terrestrial", seed: "class-m-2", clouds: 35, iceCoverage: 0, water: 45, phaseAngle: 55 });
// Exact geometry of the low-orbit scene, reduced for a portable proof image.
const scale = 5, width = 1200, height = Math.round(1804 / scale);
const viewport = { width, height, radius: 14000 / scale, cx: 3000 / scale, cy: (16700 - 2196) / scale };
const image = renderPlanetPixels(recipe, width, { view: "scene", viewport });
assert(image.pixels.some((v, i) => i % 4 === 3 && v > 0), "Low orbit renders its visible terrain band");
assert(image.pixels.slice(0, width * 4).every((v, i) => i % 4 !== 3 || v === 0), "The crop preserves open space above the atmosphere");
if (process.argv[2]) {
  const data = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = (y * width + x) * 4, dst = y * (width * 4 + 1) + 1 + x * 4;
    const alpha = image.pixels[src + 3] / 255;
    for (let c = 0; c < 3; c++) data[dst + c] = image.pixels[src + c] * alpha + [2, 5, 12][c] * (1 - alpha);
    data[dst + 3] = 255;
  }
  const chunk = (type, bytes) => {
    const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    let crc = -1;
    for (const n of Buffer.concat([name, bytes])) { crc ^= n; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    length.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ -1) >>> 0);
    return Buffer.concat([length, name, bytes, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  await writeFile(process.argv[2], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(data)), chunk("IEND", Buffer.alloc(0))]));
}
console.log("PASS: native rectangular crops, matched whole-globe geography and rings, paired exports, and low-orbit geometry.");
