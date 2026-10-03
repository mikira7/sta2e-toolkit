// node --experimental-vm-modules tests/planet-realism.mjs [preview.png] [oceans|biomes|barren|lava|asteroid] [large]
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
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
const { normalizePlanetRecipe, createPlanetTerrain, renderPlanetPixels, renderPlanetPixelsAsync } = module.namespace;
const recipes = [
  { seed: "class-m-1" }, { seed: "class-m-2" },
  { seed: "class-m-1", clouds: 0 }, { seed: "class-m-2", clouds: 0 },
].map(r => normalizePlanetRecipe({ style: "terrestrial", phaseAngle: 38, ...r }));

const { createPlanetWeather, createPlanetIce } = modules.get(new URL("../scripts/planet-weather.js", import.meta.url).href).namespace;
for (const seed of ["class-m-1", "class-m-2", "coastal", "polar"]) {
  for (const water of [0, 10, 62, 92, 100]) {
    const r = normalizePlanetRecipe({ seed, style: "terrestrial", water, rivers: 0 });
    const terrain = createPlanetTerrain(r);
    let wet = 0;
    for (let i = 0; i < 4096; i++) {
      const y = 1 - (i + .5) / 2048, radius = Math.sqrt(1 - y * y), angle = i * 2.399963229728653;
      const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
      wet += terrain.elevation(...p) < terrain.seaLevel;
    }
    assert(Math.abs(wet / 4096 - water / 100) < .025, "Detailed coasts preserve requested global ocean coverage");
    const ice = createPlanetIce(r, terrain), weather = createPlanetWeather(r, terrain, ice);
    for (const [a, b] of [ [[-1, 0, -1e-9], [-1, 0, 1e-9]], [[1e-9, 1, 0], [-1e-9, 1, 0]], [[1e-9, -1, 0], [-1e-9, -1, 0]] ]) {
      assert(Math.abs(terrain.elevation(...a) - terrain.elevation(...b)) < 1e-6);
      assert(Math.abs(terrain.mountainAt(...a) - terrain.mountainAt(...b)) < 1e-6);
      assert(Math.abs(ice.sample(...a) - ice.sample(...b)) < 1e-6);
      assert(Math.abs(weather.sample(...a).alpha - weather.sample(...b).alpha) < 1e-6, "Weather and surface detail have no seam or pole discontinuity");
    }
  }
}
for (const r of recipes) {
  const image = renderPlanetPixels(r, 96).pixels;
  assert.deepEqual(image, renderPlanetPixels(r, 96).pixels, "Class M rendering is deterministic");
  assert.deepEqual(image, (await renderPlanetPixelsAsync(r, 96)).pixels);
  assert.deepEqual(image, renderPlanetPixels({ ...r, axialTilt: 70 }, 96, { view: "scene" }).pixels);
}
// With an entirely open ocean the sun reflection must follow the light, not
// the terrain seed or camera orientation, and must disappear on the night side.
const ocean = normalizePlanetRecipe({ style: "ocean", water: 100, clouds: 0, iceCoverage: 0, rivers: 0, cities: 0, phaseAngle: 60, nightBrightness: 0 });
const size = 128, radius = size * .48;
const brightnessAt = (image, x, y) => {
  const i = (Math.floor(size / 2 + y * radius) * size + Math.floor(size / 2 + x * radius)) * 4;
  return image[i] + image[i + 1] + image[i + 2];
};
const topLit = renderPlanetPixels(ocean, size).pixels;
const sideLit = renderPlanetPixels(ocean, size, { lightDirection: 90 }).pixels;
assert(brightnessAt(topLit, 0, -.5) > brightnessAt(topLit, .25, -.5) + 35, "Open water has a localized sun glint");
assert(brightnessAt(sideLit, .5, 0) > brightnessAt(sideLit, .5, .25) + 35, "Glint follows rotated illumination");
const night = renderPlanetPixels({ ...ocean, phaseAngle: 180 }, size).pixels;
assert(night.every((value, i) => i % 4 === 3 || night[i - i % 4 + 3] === 0 || value === 0), "Ocean and atmosphere do not emit on the unlit hemisphere");
console.log("PASS: Class M ocean coverage, spherical seams, deterministic views/exports, and directional ocean reflection.");

if (process.argv[2]) {
  const previews = process.argv[3] === "atmospheres" ? [
    { style: "terrestrial", atmosphereGlow: 0 },
    { style: "terrestrial", atmosphereGlow: 80 },
    { style: "desert", atmosphereGlow: 0, clouds: 0 },
    { style: "desert", atmosphereGlow: 80, clouds: 0 },
  ].map(r => normalizePlanetRecipe({ seed: "class-m-1", phaseAngle: 55, ...r })) : process.argv[3] === "cinematic-stars" ? [
    { texture: "G", stellarDetail: 0 },
    { texture: "G", stellarDetail: 85 },
    { texture: "O", stellarDetail: 85 },
    { texture: "T-Tauri", stellarDetail: 85, stellarFlares: 75, stellarGlow: 65 },
  ].map(r => normalizePlanetRecipe({ style: "star", seed: "cinematic-star", stellarFlares: 60, stellarGlow: 55, lensFlare: 18, ...r })) : process.argv[3] === "dense-clouds" ? [
    { texture: "venus", palette: "venus", envelopeRelief: 0 },
    { texture: "venus", palette: "venus", envelopeRelief: 85 },
    { texture: "toxic", palette: "demon", envelopeRelief: 85 },
    { texture: "toxic", palette: "inferno", envelopeRelief: 85 },
  ].map(r => normalizePlanetRecipe({ style: "greenhouse", seed: "venus-clouds", phaseAngle: 55, ...r })) : process.argv[3] === "primordial-reference" ? [
    { style: "volcanic", texture: "fissures", palette: "basalt", phaseAngle: 55 },
    { style: "volcanic", texture: "fissures", palette: "basalt", phaseAngle: 180 },
    { style: "primordial", texture: "magma", phaseAngle: 55 },
    { style: "primordial", texture: "magma", phaseAngle: 180 },
  ].map(r => normalizePlanetRecipe({ seed: "volcanic-relief", lavaBasins: 70, superVolcanoes: 65, shieldVolcanoes: 80, lavaGlow: 90, water: 0, iceCoverage: 0, clouds: 12, cloudThickness: 45, nightBrightness: 0, mountains: 75, ...r })) : process.argv[3] === "volcanic-reference" ? [
    { texture: "fissures", palette: "basalt", phaseAngle: 55 },
    { texture: "fissures", palette: "basalt", phaseAngle: 180 },
    { texture: "calderas", palette: "obsidian", phaseAngle: 55 },
    { texture: "calderas", palette: "obsidian", phaseAngle: 180 },
  ].map(r => normalizePlanetRecipe({ style: "volcanic", seed: "volcanic-relief", lavaBasins: 70, superVolcanoes: 65, shieldVolcanoes: 80, lavaGlow: 90, water: 0, iceCoverage: 0, clouds: 12, cloudThickness: 45, nightBrightness: 0, mountains: 75, ...r })) : process.argv[3] === "lava-glow" ? [
    { style: "volcanic", texture: "calderas", palette: "basalt", phaseAngle: 45 },
    { style: "volcanic", texture: "calderas", palette: "basalt", phaseAngle: 180 },
    { style: "primordial", texture: "magma", phaseAngle: 45 },
    { style: "primordial", texture: "magma", phaseAngle: 180 },
  ].map(r => normalizePlanetRecipe({ seed: "volcanic-relief", lavaBasins: 80, superVolcanoes: 65, lavaGlow: 85, water: 0, iceCoverage: 0, clouds: 0, nightBrightness: 0, mountains: 75, ...r })) : process.argv[3] === "volcanic" ? [
    { style: "volcanic", texture: "fissures", palette: "basalt", volcanicDetail: 0, lavaBasins: 0, superVolcanoes: 0, shieldVolcanoes: 0, lavaBeds: 0, canyons: 0, toxicClouds: 0, mountainShadows: 0 },
    { style: "volcanic", texture: "fissures", palette: "basalt" },
    { style: "primordial", texture: "crust", volcanicDetail: 0, lavaBasins: 0, superVolcanoes: 0, shieldVolcanoes: 0, lavaBeds: 0, canyons: 0, toxicClouds: 0, mountainShadows: 0 },
    { style: "primordial", texture: "crust" },
  ].map(r => normalizePlanetRecipe({ seed: "volcanic-relief", water: 0, iceCoverage: 0, clouds: 25, mountains: 75, phaseAngle: 45, ...r })) : process.argv[3] === "giant-basins" ? [
    { style: "desert", texture: "badlands", palette: "mars", giantImpactBasin: 0, lavaBeds: 0 },
    { style: "desert", texture: "badlands", palette: "mars", giantImpactBasin: 90, lavaBeds: 60 },
    { style: "barren", texture: "cratered", palette: "lunar", giantImpactBasin: 0, lavaBeds: 0 },
    { style: "barren", texture: "cratered", palette: "lunar", giantImpactBasin: 90, lavaBeds: 60 },
  ].map(r => normalizePlanetRecipe({ seed: "giant-basin", crustPlates: "stagnant", craterDensity: 35, mountains: 60, clouds: 0, water: 0, iceCoverage: 0, phaseAngle: 40, ...r })) : process.argv[3] === "deserts" ? [
    { texture: "badlands", palette: "mars", desertDetail: 0, mountainShadows: 0 },
    { texture: "badlands", palette: "mars", desertDetail: 70, mountainShadows: 70 },
    { texture: "dunes", palette: "ochre", desertDetail: 0, mountainShadows: 0 },
    { texture: "dunes", palette: "ochre", desertDetail: 70, mountainShadows: 70 },
  ].map(r => normalizePlanetRecipe({ style: "desert", seed: "desert-relief", mountains: 70, clouds: 0, phaseAngle: 40, ...r })) : process.argv[3] === "gas-clouds" ? [
    { texture: "turbulent", palette: "gold", gasCloudRelief: 0 },
    { texture: "turbulent", palette: "gold", gasCloudRelief: 70 },
    { texture: "banded", palette: "azure", gasCloudRelief: 0 },
    { texture: "banded", palette: "azure", gasCloudRelief: 70 },
  ].map(r => normalizePlanetRecipe({ style: "gas", seed: "gas-relief", phaseAngle: 50, ...r })) : process.argv[3] === "clouds" ? [
    { seed: "class-m-1", cloudRelief: 0 },
    { seed: "class-m-1", cloudRelief: 70 },
    { seed: "class-m-2", cloudRelief: 0, cloudStyle: "stormy" },
    { seed: "class-m-2", cloudRelief: 70, cloudStyle: "stormy" },
  ].map(r => normalizePlanetRecipe({ style: "terrestrial", clouds: 45, cloudThickness: 75, storminess: 65, phaseAngle: 45, ...r })) : process.argv[3] === "rivers" ? [
    { seed: "class-m-1", rivers: 0, riverBasins: 0 },
    { seed: "class-m-1", rivers: 80, riverBasins: 80 },
    { seed: "class-m-2", rivers: 0, riverBasins: 0 },
    { seed: "class-m-2", rivers: 80, riverBasins: 80 },
  ].map(r => normalizePlanetRecipe({ style: "terrestrial", clouds: 0, iceCoverage: 0, water: 45, phaseAngle: 35, ...r })) : process.argv[3] === "mountains" ? [
    { seed: "class-m-1", mountainShadows: 0 },
    { seed: "class-m-1", mountainShadows: 70 },
    { seed: "class-m-2", mountainShadows: 0 },
    { seed: "class-m-2", mountainShadows: 70 },
  ].map(r => normalizePlanetRecipe({ style: "terrestrial", clouds: 0, phaseAngle: 55, mountains: 80, ...r })) : process.argv[3] === "oceans" ? [
    { seed: "class-m-1", crustPlates: "none", oceanShading: 0 },
    { seed: "class-m-1", crustPlates: "none", oceanShading: 100 },
    { seed: "class-m-2", crustPlates: "none", oceanShading: 100 },
    { seed: "class-m-2", crustPlates: "active", oceanShading: 100 },
  ].map(r => normalizePlanetRecipe({ style: "terrestrial", clouds: 0, phaseAngle: 35, ...r })) : process.argv[3] === "biomes" ? [
    { seed: "class-m-1", biomeDetail: 0 },
    { seed: "class-m-1", biomeDetail: 100 },
    { seed: "class-m-2", biomeDetail: 0 },
    { seed: "class-m-2", biomeDetail: 100 },
  ].map(r => normalizePlanetRecipe({ style: "terrestrial", clouds: 0, phaseAngle: 38, mountains: 70, ...r })) : process.argv[3] === "lava" ? [
    { seed: "barren-1", palette: "lunar", lavaBeds: 0 },
    { seed: "barren-1", palette: "lunar", lavaBeds: 75 },
    { seed: "barren-3", palette: "iron", lavaBeds: 0 },
    { seed: "barren-3", palette: "iron", lavaBeds: 75 },
  ].map(r => normalizePlanetRecipe({ style: "barren", phaseAngle: 42, craterDensity: 40, ...r })) : process.argv[3] === "barren" ? [
    { seed: "barren-1", palette: "lunar", texture: "cratered" },
    { seed: "barren-2", palette: "grey", texture: "cratered" },
    { seed: "barren-3", palette: "iron", texture: "rocky", craterDensity: 65 },
    { seed: "barren-4", palette: "basalt", texture: "cratered", phaseAngle: 70 },
  ].map(r => normalizePlanetRecipe({ style: "barren", phaseAngle: 42, ...r })) : process.argv[3] === "asteroid" ? [
    { seed: "asteroid-1", texture: "silicate" }, { seed: "asteroid-2", texture: "carbonaceous" },
    { seed: "asteroid-3", texture: "metallic" }, { seed: "asteroid-4", texture: "icy" },
  ].map(r => normalizePlanetRecipe({ style: "asteroid", phaseAngle: 45, ...r })) : recipes;
  const size = process.argv[4] === "large" ? 960 : 480, width = size * 2, height = size * 2;
  const data = Buffer.alloc((width * 4 + 1) * height);
  for (let k = 0; k < previews.length; k++) {
    const start = performance.now();
    const image = renderPlanetPixels(previews[k], size);
    console.log(`Render ${k + 1}: ${Math.round(performance.now() - start)} ms`);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4, dst = (Math.floor(k / 2) * size + y) * (width * 4 + 1) + 1 + (k % 2 * size + x) * 4;
      const a = image.pixels[src + 3] / 255;
      for (let c = 0; c < 3; c++) data[dst + c] = image.pixels[src + c] * a + [4, 7, 13][c] * (1 - a);
      data[dst + 3] = 255;
    }
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
