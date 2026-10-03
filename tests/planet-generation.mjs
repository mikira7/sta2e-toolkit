// Run: node --experimental-vm-modules tests/planet-generation.mjs
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";
import { deflateSync } from "node:zlib";

let nextId = 0, failEmbedded = false, dialogChoice = "create", replace = false, artworkMode = "existing";
let layout = "overview";
const created = [], deleted = [];
// Use this standalone process's context. A contextified global proxy makes the
// numerical renderer orders of magnitude slower than a browser's normal realm.
const context = globalThis;
Object.assign(context, {
  console, Uint8ClampedArray, setTimeout, Math,
  ActorSheet: class {},
  FormData: class { constructor(form) { this.data = form; } get(key) { return this.data.get(key); } entries() { return this.data.entries(); } },
  foundry: { utils: { randomID: () => `id${++nextId}`, deepClone: structuredClone }, applications: { api: {
    ApplicationV2: class {}, HandlebarsApplicationMixin: c => c,
    DialogV2: { wait: async options => {
      if (dialogChoice === "cancel") return null;
      return options.buttons[0].callback(null, null, { element: { querySelector: selector => ({
        value: selector.includes("layout") ? layout : selector.includes("background") ? "__random" : selector.includes("mode") ? (replace ? "replace" : "new") : artworkMode,
      }) } });
    } },
  } } },
  game: { user: { isGM: true }, release: { generation: 14 }, scenes: [], settings: { get: () => ({}) } },
  ui: { notifications: { info() {}, warn() {} } },
  CONST: { GRID_TYPES: { GRIDLESS: 0 }, DRAWING_FILL_TYPES: { NONE: 0, SOLID: 1 } },
  Scene: {
    create: async data => {
      const scene = { ...data, id: `scene${created.length}`, embedded: {},
        createEmbeddedDocuments: async (kind, docs) => { if (failEmbedded) throw new Error("injected failure"); scene.embedded[kind] = docs; },
        delete: async () => deleted.push(scene.id), view: async () => {},
      };
      created.push(scene); return scene;
    },
    deleteDocuments: async ids => deleted.push(...ids),
  },
});
const cache = new Map();
async function load(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const module = new vm.SourceTextModule(await readFile(url, "utf8"), { identifier: url.href });
  cache.set(url.href, module);
  await module.link(specifier => load(new URL(specifier, url)));
  return module;
}
const sceneModule = await load(new URL("../scripts/star-system-scene.js", import.meta.url));
await sceneModule.evaluate();
const generator = cache.get(new URL("../scripts/planet-generator.js", import.meta.url).href).namespace;
const sheet = cache.get(new URL("../scripts/star-system-sheet.js", import.meta.url).href).namespace;
const scenes = sceneModule.namespace;
const materials = cache.get(new URL("../scripts/gas-giant-material.js", import.meta.url).href).namespace;
const catalog = cache.get(new URL("../scripts/star-system-images.js", import.meta.url).href).namespace;
const climate = cache.get(new URL("../scripts/planet-weather.js", import.meta.url).href).namespace;
const surfaces = cache.get(new URL("../scripts/planet-surface-material.js", import.meta.url).href).namespace;
const settlements = cache.get(new URL("../scripts/planet-cities.js", import.meta.url).href).namespace;
const illumination = cache.get(new URL("../scripts/planet-lighting.js", import.meta.url).href).namespace;
assert.equal(generator.normalizePlanetRecipe({}).phaseAngle, 65);
assert.equal(generator.normalizePlanetRecipe({}).nightBrightness, 2);
assert.equal(generator.normalizePlanetRecipe({ phaseAngle: -1 }).phaseAngle, 0);
assert.equal(generator.normalizePlanetRecipe({ phaseAngle: 999 }).phaseAngle, 180);
assert.equal(generator.normalizePlanetRecipe({ nightBrightness: 99 }).nightBrightness, 20);
assert.equal(generator.normalizePlanetRecipe({ nightBrightness: -1 }).nightBrightness, 0);
assert.equal(generator.normalizePlanetRecipe({ cityStyle: "invalid" }).cityStyle, "auto");
const cityRecipes = [
  ...["organic", "grid", "circular", "domes"].map(cityStyle => ({ style: "barren", cityStyle })),
  { style: "ice", cityStyle: "auto" }, { style: "ice", cityStyle: "circular" },
  { style: "barren", cityStyle: "network" },
].map(r => generator.normalizePlanetRecipe({ seed: "colony-layouts", cities: 75, citySize: 85, clouds: 0, water: 0, phaseAngle: 95, axialTilt: 70, ...r }));
for (const r of cityRecipes) {
  assert.deepEqual(generator.normalizePlanetRecipe(JSON.stringify(r)), r, "Settlement and lighting settings survive persistence");
  const terrain = generator.createPlanetTerrain(r), ice = climate.createPlanetIce(r, terrain);
  const colonies = settlements.createPlanetCities(r, terrain, ice);
  if (r.style === "ice" && r.cityStyle === "auto") assert.equal(colonies.style, "domes");
  assert.equal(settlements.createPlanetCities({ ...r, cities: 0 }, terrain, ice), null);
  const dark = generator.renderPlanetPixels({ ...r, cities: 0 }, 128).pixels;
  const bright = generator.renderPlanetPixels(r, 128).pixels;
  assert.notDeepEqual(bright, dark, "Each layout emits city lights, including ice colonies");
  assert.deepEqual(bright, generator.renderPlanetPixels(r, 128, { view: "scene" }).pixels);
  assert.deepEqual(bright, (await generator.renderPlanetPixelsAsync(r, 128)).pixels);
  if (colonies.centers.length) {
    const c = colonies.centers[0], height = terrain.elevation(...c.center), frozen = ice.sample(...c.center, height);
    assert(colonies.sample(...c.center, height, frozen, -.5, .001) > 0, "Planned settlement centers emit at night");
    assert.equal(colonies.sample(...c.center, height, frozen, .5, .001), 0, "Settlements switch off in daylight");
    const smallerDensity = settlements.createPlanetCities({ ...r, cities: 30 }, terrain, ice);
    assert.deepEqual(smallerDensity.centers, colonies.centers.slice(0, smallerDensity.centers.length), "Increasing city density preserves existing colony positions");
    assert.notDeepEqual(bright, generator.renderPlanetPixels({ ...r, citySize: 10 }, 128).pixels, "Settlement size changes the rendered footprint");
  }
  if (r.cityStyle === "network") {
    assert(colonies.links.length > 0, "Linked circular cities connect nearby settlements");
    assert.equal(new Set(colonies.links.map(link => [link.a, link.b].sort((a, b) => a - b).join(":"))).size, colonies.links.length, "Each intercity road is drawn once");
    assert.deepEqual(colonies.links, settlements.createPlanetCities(r, terrain, ice).links, "Road routes are seeded and reproducible");
    for (const link of colonies.links) {
      assert(link.angle < .65 && link.angle > 0);
      const p = link.center, elevation = terrain.elevation(...p), frozen = ice.sample(...p, elevation);
      assert(colonies.sample(...p, elevation, frozen, -.5, .001) > .2, "The route between city rings emits light at night");
      assert.equal(colonies.sample(...p, elevation, frozen, .5, .001), 0, "Intercity roads fade in daylight");
      assert(Math.abs(Math.hypot(...p) - 1) < 1e-10, "Connections follow the sphere rather than screen-space lines");
    }
  } else assert.equal(colonies.links.length, 0, "Existing city layouts retain separate settlements");
}
const coastalNetwork = generator.normalizePlanetRecipe({ ...cityRecipes[6], style: "terrestrial", water: 60, iceCoverage: 0 });
const coastalTerrain = generator.createPlanetTerrain(coastalNetwork), coastalIce = climate.createPlanetIce(coastalNetwork, coastalTerrain);
const coastalCities = settlements.createPlanetCities(coastalNetwork, coastalTerrain, coastalIce);
for (const link of coastalCities.links) {
  const steps = Math.max(2, Math.ceil(link.angle / .012));
  for (let step = 1; step < steps; step++) {
    const t = link.angle * step / steps, p = link.start.map((v, i) => v * Math.cos(t) + link.tangent[i] * Math.sin(t));
    assert(coastalTerrain.elevation(...p) >= coastalTerrain.seaLevel, "Intercity routes avoid open water");
  }
}
const frozenOceanRecipe = generator.normalizePlanetRecipe({ style: "ocean", cities: 80, cityStyle: "domes", water: 100, iceCoverage: 100 });
const frozenOceanTerrain = generator.createPlanetTerrain(frozenOceanRecipe);
assert(settlements.createPlanetCities(frozenOceanRecipe, frozenOceanTerrain, climate.createPlanetIce(frozenOceanRecipe, frozenOceanTerrain)).centers.length > 0, "Domes can settle a frozen ocean");
const openOceanRecipe = { ...frozenOceanRecipe, iceCoverage: 0 };
assert.equal(settlements.createPlanetCities(openOceanRecipe, frozenOceanTerrain, climate.createPlanetIce(openOceanRecipe, frozenOceanTerrain)).centers.length, 0, "Domes cannot settle open water");
const shadowRecipe = generator.normalizePlanetRecipe({ style: "barren", texture: "rocky", water: 0, clouds: 0, cities: 0, craterDensity: 0, fissureDensity: 0, iceCoverage: 0, mountains: 0, nightBrightness: 0 });
const darkFraction = phaseAngle => {
  const pixels = generator.renderPlanetPixels({ ...shadowRecipe, phaseAngle }, 128).pixels;
  let dark = 0, total = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] === 255) { total++; if (pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0) dark++; }
  return dark / total;
};
assert(darkFraction(65) > darkFraction(43) + .1, "The new default shows a broader shadow");
assert(Math.abs(darkFraction(90) - .5) < .025, "A 90-degree sun angle produces a half-lit disc");
assert(darkFraction(0) < .01 && darkFraction(180) > .99, "Full and new phases have the expected lighting");
assert.equal(illumination.planetIllumination({ ...shadowRecipe, nightBrightness: 2 }, -.5, .8), .02);
for (const style of ["desert", "barren", "ice"]) {
  const r = generator.normalizePlanetRecipe({ style, texture: style === "ice" ? "fractured" : style === "desert" ? "badlands" : "rocky", seed: "surface-fissures", fissureDensity: 60, water: 0, clouds: 0, craterDensity: 0, canyons: 0, axialTilt: 70 });
  assert.deepEqual(generator.normalizePlanetRecipe(JSON.stringify(r)), r, "Fissure density survives persistence");
  assert.equal(generator.normalizePlanetRecipe({ ...r, fissureDensity: -5 }).fissureDensity, 0);
  assert.equal(generator.normalizePlanetRecipe({ ...r, fissureDensity: 200 }).fissureDensity, 100);
  const terrain = generator.createPlanetTerrain(r);
  assert.equal(terrain, generator.createPlanetTerrain({ ...r, fissureDensity: 0 }), "Fine fissures preserve elevations and drainage");
  const colors = Object.fromEntries(Object.entries(r.colors).map(([key, hex]) => [key, hex.slice(1).match(/../g).map(v => parseInt(v, 16))]));
  const material = density => surfaces.createSolidSurfaceMaterial({ ...r, fissureDensity: density }, terrain, colors);
  assert.equal(material(0).faults.length, 0, "Zero removes all fissures, including fractured ice");
  assert.equal(material(100).faults.length, 20);
  assert.deepEqual(material(40).faults, material(100).faults.slice(0, 8), "Density adds fissures without moving existing ones");
  assert(material(41).faults.at(-1).visibility > 0 && material(41).faults.at(-1).visibility < 1, "New fissures fade in between density steps");
  const field = material(60);
  for (const [a, b] of [[[ -1, 0, -1e-8], [-1, 0, 1e-8]], [[1e-8, 1, 0], [-1e-8, 1, 0]], [[1e-8, -1, 0], [-1e-8, -1, 0]]]) {
    const sample = p => field.sample(...p, terrain.elevation(...p), .5, null, { x: 0, y: .8, z: .6 });
    const left = sample(a), right = sample(b);
    assert(left.color.every((v, i) => Math.abs(v - right.color[i]) < .001), "Fissures cross seams and poles continuously");
  }
  const pixels = generator.renderPlanetPixels(r, 128).pixels;
  assert.notDeepEqual(pixels, generator.renderPlanetPixels({ ...r, fissureDensity: 0 }, 128).pixels, "Fissures are visible on each supported surface");
  assert.deepEqual(pixels, generator.renderPlanetPixels(r, 128, { view: "scene" }).pixels);
  assert.deepEqual(pixels, (await generator.renderPlanetPixelsAsync(r, 128)).pixels);
  if (style !== "ice") assert.deepEqual(generator.renderPlanetPixels({ ...r, water: 100, fissureDensity: 0 }, 64).pixels,
    generator.renderPlanetPixels({ ...r, water: 100, fissureDensity: 100 }, 64).pixels, "Opaque oceans hide surface fissures");
}
assert.equal(generator.normalizePlanetRecipe({ style: "ice", texture: "fractured", version: 13 }).fissureDensity, 70);
assert.equal(generator.normalizePlanetRecipe({ style: "ice", texture: "glacial", version: 13 }).fissureDensity, 25);
assert.equal(generator.normalizePlanetRecipe({ style: "desert", version: 13 }).fissureDensity, 0);
for (const style of ["gas", "star", "asteroid", "greenhouse", "terrestrial", "volcanic"]) assert.equal(generator.normalizePlanetRecipe({ style, fissureDensity: 100 }).fissureDensity, 0);
for (const style of ["desert", "barren"]) {
  const palettes = style === "desert" ? ["mars", "mesa", "mineral"] : ["lunar", "iron", "mineral"];
  for (const palette of palettes) {
    const r = generator.normalizePlanetRecipe({ style, palette, seed: "mineral-provinces", water: 0, clouds: 0, axialTilt: 70 });
    assert.equal(r.mineralVariation, 75, "New mineral palettes enable regional colors");
    assert.equal(new Set([r.colors.surfaceLow, r.colors.surfaceHigh, r.colors.rock, r.colors.mineral]).size, 4);
    assert.deepEqual(generator.normalizePlanetRecipe(JSON.stringify(r)), r, "Mineral colors and variation survive persistence");
    const plain = { ...r, mineralVariation: 0 };
    assert.equal(generator.createPlanetTerrain(r), generator.createPlanetTerrain(plain), "Mineral controls preserve terrain and drainage");
    const image = generator.renderPlanetPixels(r, 96).pixels;
    assert.notDeepEqual(image, generator.renderPlanetPixels(plain, 96).pixels, "Regional rock and deposits visibly vary surface color");
    assert.deepEqual(image, generator.renderPlanetPixels(r, 96, { view: "scene" }).pixels);
    assert.deepEqual(image, (await generator.renderPlanetPixelsAsync(r, 96)).pixels);
    const custom = generator.normalizePlanetRecipe({ ...r, customColors: true, colors: { ...r.colors, rock: "#102F4A", mineral: "#DBDEAE" } });
    assert.equal(custom.colors.rock, "#102f4a");
    assert.equal(custom.colors.mineral, "#dbdeae");
    assert.notDeepEqual(image, generator.renderPlanetPixels(custom, 96).pixels, "Both extra color roles are editable");
  }
  assert.equal(generator.normalizePlanetRecipe({ style, mineralVariation: -1 }).mineralVariation, 0);
  assert.equal(generator.normalizePlanetRecipe({ style, mineralVariation: 200 }).mineralVariation, 100);
}
assert.equal(generator.normalizePlanetRecipe({ style: "desert", palette: "red", version: 12 }).mineralVariation, 0, "Existing rust palettes keep their original material blend");
assert.equal(generator.normalizePlanetRecipe({ style: "gas", mineralVariation: 100 }).mineralVariation, 0);
assert.equal(generator.normalizePlanetRecipe({ style: "desert", palette: "mars", customColors: true, colors: { rock: "invalid" } }).colors.rock, generator.PLANET_PALETTES.desert.mars.colors.rock);
const surfaceRecipes = [
  { style: "desert", texture: "badlands", palette: "red" },
  { style: "desert", texture: "dunes", palette: "ochre" },
  { style: "desert", texture: "salt", palette: "ivory" },
  { style: "barren", texture: "rocky", palette: "grey" },
  { style: "barren", texture: "cratered", palette: "basalt" },
  { style: "ice", texture: "glacial", palette: "blue" },
  { style: "ice", texture: "fractured", palette: "white" },
  { style: "ice", texture: "cratered", palette: "blue" },
  { style: "terrestrial", texture: "continental" },
  { style: "volcanic", texture: "fissures" },
  { style: "primordial", texture: "magma" },
].map(r => generator.normalizePlanetRecipe({ seed: "surface-realism", mountains: 70, clouds: 0, water: 0, axialTilt: 70, ...r }));
for (const r of surfaceRecipes) {
  const terrain = generator.createPlanetTerrain(r);
  const colors = Object.fromEntries(Object.entries(r.colors).map(([key, hex]) => [key, hex.slice(1).match(/../g).map(channel => parseInt(channel, 16))]));
  const material = surfaces.createSolidSurfaceMaterial(r, terrain, colors);
  const sample = (p, light = { x: 0, y: .8, z: .6 }) => material.sample(...p, terrain.elevation(...p), .5, null, light, .003);
  let variedShade = false;
  for (let i = 0; i < 96; i++) {
    const y = 1 - (i + .5) / 48, radius = Math.sqrt(1 - y * y), angle = i * 2.4;
    const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
    const result = sample(p), opposite = sample(p, { x: 0, y: -.8, z: -.6 });
    assert(result.color.every(v => Number.isFinite(v) && v >= 0 && v <= 255));
    assert(result.shade > .5 && result.shade < 1.5, "Surface relief stays softly bounded");
    assert.deepEqual(result.color, opposite.color, "Lighting does not repaint regional material colors");
    variedShade ||= Math.abs(result.shade - opposite.shade) > .005;
  }
  assert(variedShade, "Terrain relief responds to light direction");
  for (const [a, b] of [[[ -1, 0, -1e-8], [-1, 0, 1e-8]], [[1e-8, 1, 0], [-1e-8, 1, 0]], [[1e-8, -1, 0], [-1e-8, -1, 0]]]) {
    const left = sample(a), right = sample(b);
    assert(left.color.every((v, i) => Math.abs(v - right.color[i]) < .001), "Surface colors and ice faults remain continuous across poles and longitude");
    assert(Math.abs(left.shade - right.shade) < .001);
  }
  const rendered = generator.renderPlanetPixels(r, 96).pixels;
  assert.deepEqual(rendered, generator.renderPlanetPixels(r, 96, { view: "scene" }).pixels, "Surface materials agree at matching view angles");
  assert.deepEqual(rendered, (await generator.renderPlanetPixelsAsync(r, 96)).pixels, "Surface preview and export share one renderer");
}
for (const cls of ["N", "Y"]) {
  const r = generator.normalizePlanetRecipe({ seed: "venus-clouds", axialTilt: 70, clouds: 0, water: 100, mountains: 100 }, { type: `Class-${cls}` });
  assert.equal(r.clouds, 100, "Dense atmospheres remain completely overcast");
  assert.equal(r.water + r.mountains, 0, "Surface features cannot puncture the cloud envelope");
  const colors = Object.fromEntries(Object.entries(r.colors).map(([key, hex]) => [key, hex.slice(1).match(/../g).map(channel => parseInt(channel, 16))]));
  const field = climate.createGreenhouseClouds(r, generator.createPlanetTerrain(r), colors);
  const repeat = climate.createGreenhouseClouds(r, generator.createPlanetTerrain(r), colors);
  const otherSeed = climate.createGreenhouseClouds(r, generator.createPlanetTerrain({ ...r, seed: "different-venus" }), colors);
  assert.deepEqual(field.sample(.6, 0, .8), repeat.sample(.6, 0, .8), "Cloud fronts are seeded and reproducible");
  assert.notDeepEqual(field.sample(.6, 0, .8), otherSeed.sample(.6, 0, .8), "Seeds vary greenhouse weather");
  for (const [a, b] of [
    [[-1, 0, -1e-9], [-1, 0, 1e-9]],
    [[1e-9, 1, 0], [-1e-9, 1, 0]],
    [[1e-9, -1, 0], [-1e-9, -1, 0]],
  ]) assert(field.sample(...a).every((v, i) => Math.abs(v - field.sample(...b)[i]) < .001), "Venus clouds are continuous across seams and poles");
  const image = generator.renderPlanetPixels(r, 96);
  assert.deepEqual(image.pixels, generator.renderPlanetPixels(r, 96, { view: "scene" }).pixels, "Greenhouse clouds match at equal camera angles");
  assert.deepEqual(image.pixels, (await generator.renderPlanetPixelsAsync(r, 96)).pixels, "Preview and export use identical greenhouse clouds");
  for (let y = 20; y < 76; y++) for (let x = 20; x < 76; x++) assert.equal(image.pixels[(y * 96 + x) * 4 + 3], 255, "No holes in the interior cloud deck");
  const custom = Object.fromEntries(Object.keys(colors).map(key => [key, [40, 100, 180]]));
  assert.deepEqual(climate.createGreenhouseClouds(r, generator.createPlanetTerrain(r), custom).sample(0, 0, 1), [40, 100, 180], "Custom atmospheric colors remain supported");
}
const climateRecipe = generator.normalizePlanetRecipe({ seed: "climate-tests", style: "terrestrial", water: 65, clouds: 45, iceCoverage: 0 });
const climateTerrain = generator.createPlanetTerrain(climateRecipe);
const iceLevels = [0, 10, 35, 70, 100];
const iceFields = iceLevels.map(iceCoverage => climate.createPlanetIce({ ...climateRecipe, iceCoverage }, climateTerrain));
const iceMeans = iceLevels.map(() => 0);
for (let i = 0; i < 3072; i++) {
  const y = 1 - (i + .5) / 1536, radius = Math.sqrt(1 - y * y), angle = i * Math.PI * (3 - Math.sqrt(5));
  const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
  const amounts = iceFields.map(field => field.sample(...p));
  amounts.forEach((amount, k) => { iceMeans[k] += amount / 3072; if (k) assert(amount >= amounts[k - 1], "Ice advances monotonically on the same terrain"); });
}
iceMeans.forEach((mean, i) => assert(Math.abs(mean - iceLevels[i] / 100) < .025, `Ice coverage ${iceLevels[i]}% approximates whole-sphere frozen area`));
assert.equal(generator.createPlanetTerrain({ ...climateRecipe, iceCoverage: 70, cloudStyle: "stormy" }), climateTerrain, "Climate controls preserve geography");
for (const key of ["iceCoverage", "cloudThickness", "storminess"]) {
  assert.equal(generator.normalizePlanetRecipe({ style: "terrestrial", [key]: -3 })[key], 0);
  assert.equal(generator.normalizePlanetRecipe({ style: "terrestrial", [key]: 150 })[key], 100);
}
assert.equal(generator.normalizePlanetRecipe({ style: "gas", iceCoverage: 75, hurricanes: 5 }).iceCoverage, 0);
assert.equal(generator.normalizePlanetRecipe({ style: "ice", iceCoverage: 0 }).iceCoverage, 100);
assert.equal(generator.normalizePlanetRecipe({ style: "terrestrial", texture: "seasonal" }).iceCoverage, 48);
assert.equal(generator.normalizePlanetRecipe({ style: "terrestrial", hurricanes: 99 }).hurricanes, 8);
assert.equal(generator.normalizePlanetRecipe({ style: "terrestrial", hurricanes: 2.9 }).hurricanes, 2);
assert.equal(generator.normalizePlanetRecipe({ cloudStyle: "invalid" }).cloudStyle, "mixed");
const hurricaneRecipe = generator.normalizePlanetRecipe({ seed: "warm-ocean", style: "ocean", water: 100, iceCoverage: 0, clouds: 45, cloudThickness: 75, storminess: 65, hurricanes: 3 });
const hurricaneTerrain = generator.createPlanetTerrain(hurricaneRecipe);
const weatherFor = r => climate.createPlanetWeather(r, hurricaneTerrain, climate.createPlanetIce(r, hurricaneTerrain));
const hurricaneWeather = weatherFor(hurricaneRecipe);
assert.equal(hurricaneWeather.hurricanes.length, 3, "Warm ocean can host the requested systems");
assert.deepEqual(hurricaneWeather.hurricanes, weatherFor(hurricaneRecipe).hurricanes, "Hurricane positions are reproducible");
for (const storm of hurricaneWeather.hurricanes) {
  assert(Math.abs(storm.center[1]) > .1 && Math.abs(storm.center[1]) < .6, "Hurricanes form away from the equator and poles");
  assert(hurricaneTerrain.elevation(...storm.center) < hurricaneTerrain.seaLevel);
  const wall = storm.center.map((v, i) => v + storm.east[i] * storm.radius * .24);
  const magnitude = Math.hypot(...wall);
  const eye = hurricaneWeather.sample(...storm.center).alpha;
  assert(eye < .05, "The hurricane eye is clear through all cloud layers");
  assert(hurricaneWeather.sample(...wall.map(v => v / magnitude)).alpha > eye + .5, "Eyewall is a dense cloud ring");
}
for (const changes of [{ clouds: 0 }, { cloudThickness: 0 }, { water: 0 }, { iceCoverage: 100 }]) {
  const weather = weatherFor({ ...hurricaneRecipe, ...changes });
  assert.equal(weather.hurricanes.length, 0, "Cloudless, dry, or frozen worlds do not generate hurricanes");
}
for (const changes of [{ clouds: 0 }, { cloudThickness: 0 }]) {
  assert.equal(weatherFor({ ...hurricaneRecipe, ...changes }).sample(0, 0, 1).alpha, 0);
  assert.equal(weatherFor({ ...hurricaneRecipe, ...changes }).sample(0, 0, 1).shadow, 0);
}
for (const cloudStyle of Object.keys(climate.PLANET_CLOUD_STYLES)) {
  const r = { ...hurricaneRecipe, cloudStyle, axialTilt: 70 };
  assert.deepEqual(generator.normalizePlanetRecipe(JSON.stringify(r)), r, "Weather settings survive persistence");
  const image = generator.renderPlanetPixels(r, 96);
  assert.deepEqual(image.pixels, generator.renderPlanetPixels(r, 96, { view: "scene" }).pixels, "Weather is shared between cameras");
  assert.deepEqual(image.pixels, (await generator.renderPlanetPixelsAsync(r, 96)).pixels);
  const weather = weatherFor(r);
  const a = weather.sample(-Math.cos(.4), Math.sin(.4), -1e-9), b = weather.sample(-Math.cos(.4), Math.sin(.4), 1e-9);
  assert(Math.abs(a.alpha - b.alpha) < .001, "Clouds cross the longitude seam continuously");
}
const quietWeather = weatherFor({ ...hurricaneRecipe, hurricanes: 0, storminess: 0 });
const strongWeather = weatherFor({ ...hurricaneRecipe, hurricanes: 0, storminess: 100 });
let strongerSamples = 0;
for (let i = 0; i < 256; i++) {
  const y = 1 - (i + .5) / 128, radius = Math.sqrt(1 - y * y), angle = i * 2.4;
  const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
  if (strongWeather.sample(...p).alpha > quietWeather.sample(...p).alpha + .001) strongerSamples++;
}
assert(strongerSamples > 5, "Storminess adds visible convective cloud density");
for (const { key, label } of catalog.STAR_SYSTEM_PLANET_IMAGE_TYPES) {
  assert(generator.PLANET_CLASS_DEFAULTS[key], `${label} has explicit procedural coverage`);
  assert(sheet.WORLD_TYPE_OPTIONS.some(type => key === "Belt" ? type === "Asteroid Belt" : type.startsWith(`Class-${key} `)), `${label} is selectable for planets and moons`);
  for (const notes of ["", "moon-scale"]) {
    const r = generator.normalizePlanetRecipe({}, { type: label, notes });
    assert.equal(r.style, generator.PLANET_CLASS_DEFAULTS[key].style);
    assert.deepEqual(generator.normalizePlanetRecipe(r), r, `${label} recipe is stable`);
    const pixels = generator.renderPlanetPixels(r, 48).pixels;
    assert(pixels.some((v, i) => i % 4 === 3 && v === 255), `${label} renders an opaque body`);
  }
}
for (const { key } of catalog.STAR_SYSTEM_STAR_IMAGE_TYPES) {
  const r = generator.normalizePlanetRecipe({}, { spectralType: key, luminosityType: "III" });
  assert.equal(r.style, "star"); assert.equal(r.texture, key);
  assert.equal(r.stellarLuminosity, "III");
  assert.deepEqual(generator.normalizePlanetRecipe(r), r);
  const pixels = generator.renderPlanetPixels(r, 64).pixels;
  assert(pixels.some((v, i) => i % 4 === 3 && v === 255));
  assert.equal(pixels[3], 0, `${key} leaves transparent corners`);
  assert.deepEqual(pixels, generator.renderPlanetPixels(r, 64).pixels);
  assert.deepEqual(generator.renderPlanetPixels({ ...r, axialTilt: 70 }, 64, { view: "scene" }).pixels, pixels);
}
for (const style of Object.keys(generator.PLANET_STYLES)) {
  const r = generator.normalizePlanetRecipe({ style });
  assert.deepEqual(generator.normalizePlanetRecipe(r), r, `${style} normalizes idempotently without a body record`);
}
assert.equal(generator.normalizePlanetRecipe({}, { type: "Class-I" }).texture, "hot");
assert.equal(generator.normalizePlanetRecipe({}, { type: "Class-D", notes: "captured moonlet (asteroid-scale)" }).style, "asteroid");
assert.equal(generator.normalizePlanetRecipe({}, { type: "Class-C", notes: "icy moonlet (asteroid-scale)" }).texture, "icy");
assert.equal(generator.normalizePlanetRecipe({}, { type: "Class-D (Icy/Rocky Barren)" }).texture, "cratered");
assert.equal(generator.normalizePlanetRecipe({}, { type: "Class-D (Icy/Rocky Barren)" }).style, "ice");
const asteroidRecipe = generator.normalizePlanetRecipe({ style: "asteroid", seed: "asteroid-tests" });
assert.equal(generator.normalizePlanetRecipe({ ...asteroidRecipe, rings: true, water: 100, clouds: 50, cities: 100 }).rings, false);
const asteroidPixels = generator.renderPlanetPixels(asteroidRecipe, 96).pixels;
assert.notDeepEqual(asteroidPixels, generator.renderPlanetPixels({ ...asteroidRecipe, seed: "another-rock" }, 96).pixels);
assert.notDeepEqual(asteroidPixels, generator.renderPlanetPixels({ ...asteroidRecipe, axialTilt: 0 }, 96, { view: "scene" }).pixels);
assert.deepEqual(asteroidPixels, (await generator.renderPlanetPixelsAsync(asteroidRecipe, 96)).pixels);
const occupiedRows = Array.from({ length: 96 }, (_, y) => Array.from({ length: 96 }, (_, x) => asteroidPixels[(y * 96 + x) * 4 + 3]).filter(a => a > 0).length);
assert(occupiedRows.filter(v => v > 0).length < 85, "Asteroid has an irregular compressed silhouette instead of a full globe");
const quietStar = generator.normalizePlanetRecipe({ style: "star", seed: "stellar-effects", stellarFlares: 0, stellarGlow: 0, lensFlare: 0 });
const quietPixels = generator.renderPlanetPixels(quietStar, 128).pixels;
const outsideStar = i => {
  const x = (i / 4 % 128 + .5 - 64) / (128 * .36), y = (Math.floor(i / 4 / 128) + .5 - 64) / (128 * .36);
  return x * x + y * y > 1.02;
};
for (let i = 0; i < quietPixels.length; i += 4) if (outsideStar(i)) assert.equal(quietPixels[i + 3], 0, "Turning all stellar effects off removes exterior light");
for (const field of ["stellarFlares", "stellarGlow", "lensFlare"]) {
  assert.equal(generator.normalizePlanetRecipe({ [field]: 200 })[field], 100);
  assert.equal(generator.normalizePlanetRecipe({ [field]: -5 })[field], 0);
  const effects = { ...quietStar, [field]: 100 };
  const pixels = generator.renderPlanetPixels(effects, 128).pixels;
  assert(pixels.some((v, i) => i % 4 === 3 && outsideStar(i - 3) && v > quietPixels[i] + 1), `${field} produces light beyond the limb`);
  assert.deepEqual(pixels, generator.renderPlanetPixels({ ...effects, axialTilt: 70 }, 128, { view: "scene" }).pixels);
  assert.deepEqual(generator.normalizePlanetRecipe(effects), effects, `${field} persists in recipes`);
}
assert.equal(generator.normalizePlanetRecipe({}, { spectralType: "Y" }).stellarFlares, 0, "Very cool dwarfs default to no solar loops");
assert(generator.normalizePlanetRecipe({}, { spectralType: "T-Tauri" }).stellarFlares > generator.normalizePlanetRecipe({}, { spectralType: "G" }).stellarFlares);

const recipe = generator.normalizePlanetRecipe({ seed: "test-seed", style: "terrestrial", resolution: 1024 });
const first = generator.renderPlanetPixels(recipe, 64);
assert.deepEqual(first.pixels, generator.renderPlanetPixels(recipe, 64).pixels, "Same seed reproduces pixels");
assert.notDeepEqual(first.pixels, generator.renderPlanetPixels({ ...recipe, seed: "different" }, 64).pixels);
assert.equal(first.pixels[3], 0, "Corners are transparent");
assert.equal(first.pixels[(32 * 64 + 32) * 4 + 3], 255, "Globe is opaque");
for (const style of Object.keys(generator.PLANET_STYLES)) {
  const pixels = generator.renderPlanetPixels({ ...recipe, style, rings: true }, 64).pixels;
  assert(pixels.some((v, i) => i % 4 === 3 && v > 0));
}
assert.equal(generator.normalizePlanetRecipe({}, { type: "Class-J (Jovian)" }).style, "gas");
assert.equal(generator.normalizePlanetRecipe("malformed", { type: "Class-P" }).style, "ice");
assert.equal(generator.normalizePlanetRecipe({ water: -10 }).water, 0);
assert.equal(generator.normalizePlanetRecipe({ clouds: 500 }).clouds, 100);
assert.equal(generator.normalizePlanetRecipe({ style: "ocean" }).water, 92);
assert.equal(generator.normalizePlanetRecipe({}, { type: "Class-K (Adaptable)" }).water, 3);
assert.equal(generator.normalizePlanetRecipe({}, { type: "Class-H (Desert)" }).water, 0);
assert.equal(generator.normalizePlanetRecipe({ version: 2, style: "desert", water: 62 }, { type: "Class-K" }).water, 3, "Legacy unused water settings migrate to traces on Class-K");
assert.equal(generator.normalizePlanetRecipe({ version: 2, style: "desert", water: 62 }).water, 0);
assert.equal(generator.normalizePlanetRecipe({ style: "gas", water: 30, mountains: 80, cities: 100, rivers: 50 }).cities, 0);
assert.equal(generator.normalizePlanetRecipe({ cities: -5 }).cities, 0);
assert.equal(generator.normalizePlanetRecipe({ mountains: 150 }).mountains, 100);
assert.equal(generator.normalizePlanetRecipe({ customColors: true, colors: { ocean: "not-a-color" } }).colors.ocean, "#247aa6");
assert.equal(generator.normalizePlanetRecipe({ customColors: true, colors: { ocean: "#aBcDeF" } }).colors.ocean, "#abcdef");
assert.deepEqual(generator.normalizePlanetRecipe(recipe), recipe, "Rich recipes normalize idempotently");
assert.notDeepEqual(generator.normalizePlanetRecipe({ style: "gas", palette: "jade" }).colors, generator.normalizePlanetRecipe({ style: "gas", palette: "violet" }).colors);
assert.equal(generator.normalizePlanetRecipe({ style: "desert", texture: "turbulent" }).texture, "dunes");
const terrainRecipe = { ...recipe, water: 40, rivers: 100, clouds: 0 };
const drainageTerrain = generator.createPlanetTerrain(terrainRecipe);
assert.equal(generator.createPlanetTerrain({ ...terrainRecipe, palette: "amethyst" }), drainageTerrain, "Changing colors preserves geography and drainage");
let riverEdges = 0;
for (let i = 0; i < drainageTerrain.drainage.next.length; i++) {
  const j = drainageTerrain.drainage.next[i];
  if (j < 0) continue;
  assert(drainageTerrain.drainage.heights[j] < drainageTerrain.drainage.heights[i], "Drainage edges always flow downhill");
  if (drainageTerrain.drainage.flow[i] >= drainageTerrain.drainage.threshold) riverEdges++;
}
assert(riverEdges > 0, "Wet worlds have river channels");
assert.equal(generator.createPlanetTerrain({ ...terrainRecipe, water: 0 }).drainage, null, "Dry worlds have no liquid rivers");
const traceTerrain = generator.createPlanetTerrain({ seed: "trace-water", style: "desert", water: 3, rivers: 0 });
let wetSamples = 0;
for (let i = 0; i < 1024; i++) {
  const y = 1 - (i + .5) / 512, radius = Math.sqrt(1 - y * y), angle = i * Math.PI * (3 - Math.sqrt(5));
  if (traceTerrain.elevation(Math.cos(angle) * radius, y, Math.sin(angle) * radius) < traceTerrain.seaLevel) wetSamples++;
}
assert(wetSamples > 10 && wetSamples < 65, "Trace-water coverage produces small basins across the sphere");
const ocean = { ...recipe, water: 100, clouds: 0, customColors: true };
const greenOcean = generator.renderPlanetPixels({ ...ocean, colors: { ocean: "#20bf50" } }, 64).pixels;
const purpleOcean = generator.renderPlanetPixels({ ...ocean, colors: { ocean: "#a030cf" } }, 64).pixels;
const centerPixel = (32 * 64 + 32) * 4;
assert(greenOcean[centerPixel + 1] > greenOcean[centerPixel + 2]);
assert(purpleOcean[centerPixel + 2] > purpleOcean[centerPixel + 1]);
assert.notDeepEqual(generator.renderPlanetPixels({ ...terrainRecipe, rivers: 0 }, 256).pixels, generator.renderPlanetPixels(terrainRecipe, 256).pixels, "River controls affect visible channels");
const rocky = { ...recipe, style: "barren", texture: "rocky", water: 0, clouds: 0, rivers: 0, cities: 0 };
const marsRecipe = generator.normalizePlanetRecipe({ seed: "mars-craters", texture: "badlands", palette: "red", craterDensity: 55, clouds: 0, axialTilt: 70 }, { type: "Class-K" });
assert.equal(marsRecipe.style, "desert");
assert.equal(marsRecipe.craterDensity, 55);
const geologyRecipe = generator.normalizePlanetRecipe({ ...marsRecipe, water: 3, rivers: 35, canyons: 70, impactBasins: 65, shieldVolcanoes: 65 });
assert.deepEqual(generator.normalizePlanetRecipe(JSON.stringify(geologyRecipe)), geologyRecipe, "Landform controls survive recipe persistence");
assert.equal(generator.createPlanetTerrain(marsRecipe).geology, null, "Existing recipes keep landforms off");
for (const key of ["canyons", "impactBasins", "shieldVolcanoes"]) {
  assert.equal(generator.normalizePlanetRecipe({ style: "desert", [key]: -5 })[key], 0);
  assert.equal(generator.normalizePlanetRecipe({ style: "desert", [key]: 200 })[key], 100);
  for (const style of ["gas", "star", "asteroid", "greenhouse"]) assert.equal(generator.normalizePlanetRecipe({ style, [key]: 100 })[key], 0);
  const r = { ...marsRecipe, water: 0, rivers: 0, craterDensity: 0, [key]: 80 };
  const terrain = generator.createPlanetTerrain(r), field = terrain.geology;
  const base = generator.createPlanetTerrain({ ...r, [key]: 0 });
  let changed = 0;
  for (let i = 0; i < 2048; i++) {
    const y = 1 - (i + .5) / 1024, radius = Math.sqrt(1 - y * y), angle = i * Math.PI * (3 - Math.sqrt(5));
    const p = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
    const landform = field.sample(...p), elevation = terrain.elevation(...p);
    assert(Number.isFinite(elevation));
    assert(Math.abs(elevation - base.elevation(...p)) < .4, "Landform elevations stay bounded");
    if (landform.canyon > .1) assert(elevation < base.elevation(...p), "Canyons lower terrain");
    if (Math.abs(elevation - base.elevation(...p)) > .005) changed++;
  }
  assert(changed > 5, "Each landform changes a visible area of the sphere");
  for (const [a, b] of [[[ -1, 0, -1e-8], [-1, 0, 1e-8]], [[1e-8, 1, 0], [-1e-8, 1, 0]], [[1e-8, -1, 0], [-1e-8, -1, 0]]]) {
    assert(Math.abs(terrain.elevation(...a) - terrain.elevation(...b)) < .001, "Geology is continuous across longitude and poles");
  }
  const image = generator.renderPlanetPixels(r, 96).pixels;
  assert.notDeepEqual(image, generator.renderPlanetPixels({ ...r, [key]: 0 }, 96).pixels, "Landforms affect artwork independently");
  assert.deepEqual(image, generator.renderPlanetPixels(r, 96, { view: "scene" }).pixels, "Landform lighting and terrain agree at matching camera angles");
  assert.deepEqual(image, (await generator.renderPlanetPixelsAsync(r, 96)).pixels);
}
const geologyTerrain = generator.createPlanetTerrain(geologyRecipe);
const repeatedGeology = generator.createPlanetTerrain({ ...geologyRecipe, palette: "ochre" });
assert.equal(geologyTerrain, repeatedGeology, "Palette changes preserve geology and drainage");
for (let i = 0; i < geologyTerrain.drainage.next.length; i++) {
  const j = geologyTerrain.drainage.next[i];
  if (j >= 0) assert(geologyTerrain.drainage.heights[j] < geologyTerrain.drainage.heights[i], "Rivers follow downhill paths through modified terrain");
}
const weakerGeology = generator.createPlanetTerrain({ ...geologyRecipe, canyons: 30, impactBasins: 30, shieldVolcanoes: 30 });
for (const key of ["canyons", "basins", "volcanoes"]) assert.deepEqual(geologyTerrain.geology[key], weakerGeology.geology[key], "Strength sliders preserve landform placement");
const volcano = geologyTerrain.geology.volcanoes[0];
const rimPoint = volcano.center.map((v, i) => v + volcano.along[i] * volcano.radius * .22);
const rimLength = Math.hypot(...rimPoint);
assert(geologyTerrain.geology.sample(...rimPoint.map(v => v / rimLength)).delta > geologyTerrain.geology.sample(...volcano.center).delta, "Shield volcanoes have a depressed summit caldera");
assert.deepEqual(generator.normalizePlanetRecipe(JSON.stringify(marsRecipe)), marsRecipe, "Crater density survives recipe persistence");
assert.equal(generator.normalizePlanetRecipe({ style: "barren", texture: "cratered" }).craterDensity, 50, "Old cratered recipes retain their impact count");
assert.equal(generator.normalizePlanetRecipe({ style: "desert", version: 9 }).craterDensity, 0, "Existing deserts stay crater-free until enabled");
for (const style of ["desert", "barren", "ice"]) {
  assert.equal(generator.normalizePlanetRecipe({ style, craterDensity: -5 }).craterDensity, 0);
  assert.equal(generator.normalizePlanetRecipe({ style, craterDensity: 120 }).craterDensity, 100);
  const r = { ...marsRecipe, style, texture: style === "ice" ? "glacial" : style === "barren" ? "rocky" : "badlands", water: 0, iceCoverage: 0 };
  const clear = generator.renderPlanetPixels({ ...r, craterDensity: 0 }, 128).pixels;
  const cratered = generator.renderPlanetPixels(r, 128).pixels;
  assert.notDeepEqual(cratered, clear, "Craters overlay any supported terrain texture");
  assert.notDeepEqual(cratered, generator.renderPlanetPixels({ ...r, craterDensity: 100 }, 128).pixels, "Density changes the visible impact field");
  assert.deepEqual(cratered, generator.renderPlanetPixels(r, 128).pixels, "Impact placement is reproducible");
  assert.deepEqual(cratered, generator.renderPlanetPixels(r, 128, { view: "scene" }).pixels, "Craters match between equal camera angles");
  assert.deepEqual(cratered, (await generator.renderPlanetPixelsAsync(r, 128)).pixels, "Export and preview agree for cratered worlds");
  assert.equal(generator.createPlanetTerrain({ ...r, craterDensity: 0 }), generator.createPlanetTerrain(r), "Crater density preserves underlying geography");
}
for (const style of ["gas", "star", "greenhouse", "terrestrial"]) assert.equal(generator.normalizePlanetRecipe({ style, craterDensity: 100 }).craterDensity, 0, "Unsupported appearances ignore crater density");
assert.notDeepEqual(generator.renderPlanetPixels({ ...rocky, mountains: 0 }, 64).pixels, generator.renderPlanetPixels({ ...rocky, mountains: 100 }, 64).pixels);
const dark = generator.renderPlanetPixels(rocky, 128).pixels;
const lit = generator.renderPlanetPixels({ ...rocky, cities: 100 }, 128).pixels;
let litPixels = 0;
for (let i = 0; i < dark.length; i += 4) {
  if (dark[i] === lit[i] && dark[i + 1] === lit[i + 1] && dark[i + 2] === lit[i + 2]) continue;
  litPixels++;
  const x = ((i / 4) % 128 + .5 - 64) / (128 * .48), y = (Math.floor(i / 4 / 128) + .5 - 64) / (128 * .48);
  const source = illumination.planetLightDirection(generator.normalizePlanetRecipe(rocky));
  const dot = source.y * y + source.z * Math.sqrt(Math.max(0, 1 - x * x - y * y));
  assert(dot < .15, "City lights appear only on the night side and at twilight");
}
assert(litPixels > 0, "Enabling cities produces visible lights");
assert.deepEqual(generator.renderPlanetPixels({ ...ocean, cities: 100 }, 64).pixels, generator.renderPlanetPixels({ ...ocean, cities: 0 }, 64).pixels, "City lights never appear in oceans");
assert.equal(generator.normalizePlanetRecipe({ resolution: 4096 }).resolution, 4096);
assert.equal(generator.normalizePlanetRecipe({ resolution: 99999 }).resolution, 2048);
assert.equal(generator.normalizePlanetRecipe({ axialTilt: -5 }).axialTilt, 0);
assert.equal(generator.normalizePlanetRecipe({ axialTilt: 250 }).axialTilt, 180);
assert.equal(generator.normalizePlanetRecipe({ ringDensity: 400 }).ringDensity, 100);
assert.equal(generator.normalizePlanetRecipe({ ringColor: "invalid", ringStyle: "dusty" }).ringColor, "#84745e");
const ringRecipe = generator.normalizePlanetRecipe({ seed: "rings-test", style: "gas", rings: true, ringStyle: "icy" });
const ringNoise = generator.createPlanetTerrain(ringRecipe).noise;
const materialColors = Object.fromEntries(Object.entries(ringRecipe.colors).map(([key, hex]) => [key, [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))]));
const gasWeather = generator.createPlanetTerrain(ringRecipe);
const bandedGas = materials.createGasGiantMaterial({ ...ringRecipe, texture: "banded" }, gasWeather, materialColors);
const smoothGas = materials.createGasGiantMaterial({ ...ringRecipe, texture: "smooth" }, gasWeather, materialColors);
const variance = values => { const mean = values.reduce((a, b) => a + b, 0) / values.length; return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length; };
const latitudeSamples = material => Array.from({ length: 80 }, (_, i) => { const lat = -1.1 + i / 79 * 2.2; return material.sample(0, Math.sin(lat), Math.cos(lat)).reduce((a, b) => a + b, 0); });
assert(variance(latitudeSamples(bandedGas)) > variance(latitudeSamples(smoothGas)), "Smooth gas preset has softer belt contrast");
const seamLeft = bandedGas.sample(-Math.cos(.4), Math.sin(.4), -1e-9);
const seamRight = bandedGas.sample(-Math.cos(.4), Math.sin(.4), 1e-9);
assert(seamLeft.every((value, i) => Math.abs(value - seamRight[i]) < .001), "Cloud field is continuous across the longitude seam");
assert.deepEqual(generator.renderPlanetPixels({ ...ringRecipe, axialTilt: 70 }, 64).pixels, generator.renderPlanetPixels({ ...ringRecipe, axialTilt: 70 }, 64, { view: "scene" }).pixels, "Clouds, storms and ring shadows agree when both cameras share an inclination");
const hotRecipe = generator.normalizePlanetRecipe({ seed: "hot-clouds", style: "gas", texture: "hot", palette: "ember", axialTilt: 70 });
assert.equal(hotRecipe.gasColors.length, 6);
assert.deepEqual(generator.normalizePlanetRecipe(hotRecipe), hotRecipe, "Hot multicolor recipe round-trips without changes");
for (const entry of Object.values(generator.PLANET_PALETTES.gas)) assert(entry.gasColors.length >= 4);
const customGas = generator.normalizePlanetRecipe({ ...hotRecipe, customColors: true, gasColors: ["#AA0000", "bad", "#00BB00", "#0000CC"] });
assert.deepEqual(customGas.gasColors, ["#aa0000", "#00bb00", "#0000cc"]);
assert.equal(generator.normalizePlanetRecipe({ ...customGas, gasColors: Array(12).fill("#123456") }).gasColors.length, 8);
assert(generator.normalizePlanetRecipe({ ...customGas, gasColors: [null, {}, "invalid"] }).gasColors.length >= 3);
const legacyGas = generator.normalizePlanetRecipe({ version: 4, style: "gas", customColors: true, colors: { surfaceLow: "#102030", surfaceHigh: "#90a0b0" } });
assert.deepEqual(legacyGas.gasColors, ["#102030", "#506070", "#90a0b0"]);
assert.deepEqual(generator.normalizePlanetRecipe(legacyGas), legacyGas);
assert.equal(generator.normalizePlanetRecipe({ hotGlow: 200 }).hotGlow, 100);
assert.equal(generator.normalizePlanetRecipe({ hotGlow: -1 }).hotGlow, 0);
for (let i = 0; i < 20; i++) {
  const seededHot = generator.normalizePlanetRecipe({ seed: `hot-${i}`, style: "gas", texture: "hot" });
  assert(["ember", "plasma", "stellar"].some(key => JSON.stringify(generator.PLANET_PALETTES.gas[key].gasColors) === JSON.stringify(seededHot.gasColors)), "Seeded hot worlds choose hot palettes");
}
const hotImage = generator.renderPlanetPixels(hotRecipe, 96);
assert.deepEqual(hotImage.pixels, generator.renderPlanetPixels(hotRecipe, 96, { view: "scene" }).pixels, "Hot cloud patterns and emission match across equal camera angles");
assert.deepEqual(hotImage.pixels, (await generator.renderPlanetPixelsAsync(hotRecipe, 96)).pixels);
const coldHotImage = generator.renderPlanetPixels({ ...hotRecipe, hotGlow: 0 }, 96);
let glowingNightPixels = 0;
for (let i = 0; i < hotImage.pixels.length; i += 4) {
  const x = ((i / 4) % 96 + .5 - 48) / (96 * .48), y = (Math.floor(i / 4 / 96) + .5 - 48) / (96 * .48);
  if (x * x + y * y >= 1) continue;
  const source = illumination.planetLightDirection(hotRecipe);
  const dot = source.y * y + source.z * Math.sqrt(1 - x * x - y * y);
  if (dot < 0 && hotImage.pixels.slice(i, i + 3).some((v, k) => v > coldHotImage.pixels[i + k] + 3)) glowingNightPixels++;
}
assert(glowingNightPixels > 10, "Hot clouds emit visible light on the unlit hemisphere");
assert.deepEqual(generator.renderPlanetPixels({ ...hotRecipe, texture: "banded", hotGlow: 0 }, 64).pixels,
  generator.renderPlanetPixels({ ...hotRecipe, texture: "banded", hotGlow: 100 }, 64).pixels, "Ordinary gas clouds do not emit light");
const rampRecipe = { ...ringRecipe, rings: false, customColors: true, gasColors: Array(6).fill("#444444") };
const neutralGas = generator.renderPlanetPixels(rampRecipe, 96).pixels;
// Each middle color must affect actual cloud pixels, not just the saved recipe.
for (const index of [1, 2, 3, 4]) {
  const gasColors = [...rampRecipe.gasColors]; gasColors[index] = "#00ff00";
  const variant = generator.renderPlanetPixels({ ...rampRecipe, gasColors }, 96).pixels;
  assert(variant.some((v, i) => i % 4 === 1 && v > neutralGas[i] + 5), `Cloud ramp color ${index + 1} is visible`);
}
const hotMaterial = materials.createGasGiantMaterial(hotRecipe, generator.createPlanetTerrain(hotRecipe), materialColors);
const hotSeamLeft = hotMaterial.sampleSurface(-Math.cos(.4), Math.sin(.4), -1e-9);
const hotSeamRight = hotMaterial.sampleSurface(-Math.cos(.4), Math.sin(.4), 1e-9);
for (const key of ["color", "emission"]) assert(hotSeamLeft[key].every((v, i) => Math.abs(v - hotSeamRight[key][i]) < .001));
for (const material of [bandedGas, hotMaterial]) {
  for (const pole of [-1, 1]) {
    const a = material.sample(1e-9, pole, 0), b = material.sample(0, pole, -1e-9);
    assert(a.every((v, i) => Number.isFinite(v) && Math.abs(v - b[i]) < .001), "Cloud colors converge at either pole regardless of longitude");
  }
}
const ringMaterial = materials.createRingMaterial(ringRecipe, ringNoise);
const iceRecipes = ["ice-hazy", "ice-stormy"].map(texture => generator.normalizePlanetRecipe({ seed: "ice-weather", style: "gas", texture, palette: "neptune", axialTilt: 70 }));
const iceMaterials = iceRecipes.map(r => materials.createGasGiantMaterial(r, generator.createPlanetTerrain(r), materialColors));
for (let index = 0; index < iceRecipes.length; index++) {
  const r = iceRecipes[index], material = iceMaterials[index];
  assert.deepEqual(generator.normalizePlanetRecipe(JSON.stringify(r)), r, "Ice-giant recipes persist and reopen unchanged");
  const pixels = generator.renderPlanetPixels(r, 96).pixels;
  assert.deepEqual(pixels, generator.renderPlanetPixels(r, 96, { view: "scene" }).pixels, "Ice-giant clouds agree across matching cameras");
  assert.notDeepEqual(pixels, generator.renderPlanetPixels({ ...r, seed: "other-ice-weather" }, 96).pixels);
  assert.notDeepEqual(pixels, generator.renderPlanetPixels({ ...r, texture: "banded" }, 96).pixels, "Ice atmosphere differs from a recolored Jovian texture");
  assert.equal(material.sampleSurface(0, 0, 1).emission, null, "Ice giants have no plasma emission");
  for (const pole of [-1, 1]) {
    const a = material.sample(1e-9, pole, 0), b = material.sample(0, pole, -1e-9);
    assert(a.every((v, i) => Number.isFinite(v) && Math.abs(v - b[i]) < .001), "Ice atmosphere is continuous at both poles");
  }
  const a = material.sample(-Math.cos(.4), Math.sin(.4), -1e-9), b = material.sample(-Math.cos(.4), Math.sin(.4), 1e-9);
  assert(a.every((v, i) => Math.abs(v - b[i]) < .001), "Ice clouds cross the longitude seam continuously");
  const reversed = generator.renderPlanetPixels({ ...r, customColors: true, gasColors: [...r.gasColors].reverse() }, 96).pixels;
  assert.notDeepEqual(pixels, reversed, "Custom ice-giant colors affect the image");
  for (const tilt of [0, 90, 180]) {
    const image = generator.renderPlanetPixels({ ...r, rings: true, axialTilt: tilt, ringStyle: "narrow" }, 64, { view: "scene" });
    assert.equal(image.pixels[3], 0);
    assert(image.pixels.some((v, i) => i % 4 === 3 && v === 255));
  }
  for (let i = 0; i < 12; i++) {
    const seeded = generator.normalizePlanetRecipe({ seed: `ice-${i}`, style: "gas", texture: r.texture });
    assert(["uranus", "neptune", "coldTeal"].some(key => JSON.stringify(generator.PLANET_PALETTES.gas[key].gasColors) === JSON.stringify(seeded.gasColors)), "Seeded ice atmosphere chooses an ice palette");
  }
}
assert(variance(latitudeSamples(iceMaterials[0])) < variance(latitudeSamples(iceMaterials[1])), "Hazy ice giants have lower atmospheric contrast than stormy ones");
assert(iceMaterials[1].storms.some(storm => storm.dark), "Stormy ice giant has a dark vortex");
assert(!iceMaterials[0].storms.some(storm => storm.dark), "Hazy ice giant keeps its quieter cloud profile");
const dustMaterial = materials.createRingMaterial({ ...ringRecipe, ringStyle: "dusty" }, ringNoise);
assert.equal(ringMaterial.opticalDepth(.5), 0, "The inner hole has no ring material");
assert.equal(ringMaterial.opticalDepth(1.1), 0, "Outside the rings is transparent");
assert(ringMaterial.opticalDepth(.79) > ringMaterial.opticalDepth(.66) * 3, "Dense and translucent ring regions differ");
assert(ringMaterial.opticalDepth(ringMaterial.division + .012) < ringMaterial.opticalDepth(.79) * .05, "The major division is a real gap");
assert(dustMaterial.opticalDepth(.79) < ringMaterial.opticalDepth(.79) * .2);
for (const tilt of [0, 23.5, 70, 90, 180]) {
  const image = generator.renderPlanetPixels({ ...ringRecipe, axialTilt: tilt }, 64, { view: "scene" });
  assert(image.pixels.some((value, i) => i % 4 === 3 && value > 0), `Rings render at ${tilt} degrees`);
  assert.equal(image.pixels[3], 0);
}
const edgeOn = generator.renderPlanetPixels({ ...ringRecipe, axialTilt: 90 }, 64, { view: "scene" });
assert(edgeOn.pixels[(32 * 64 + 57) * 4 + 3] > 0, "Edge-on rings remain visible outside the planet silhouette");
const light = materials.PLANET_LIGHT;
assert(materials.ringPlanetShadow(0, -light.y * .9, -light.z * .9) < .11, "Planet blocks sunlight behind it");
assert.equal(materials.ringPlanetShadow(0, light.y * .9, light.z * .9), 1, "Sunward rings are illuminated");
let shadowedSurface = 0;
for (let y = -.52; y < .54; y += .02) {
  const z = Math.sqrt(.54 ** 2 - y * y);
  if (materials.ringSurfaceTransmission(ringMaterial, 0, y, z, Math.sin(70 * Math.PI / 180), Math.cos(70 * Math.PI / 180)) < .8) shadowedSurface++;
}
assert(shadowedSurface > 0, "Projected rings cast a shadow on the globe");
assert.equal(generator.planetSceneBodyScale({ rings: "Yes", image: "old.webp" }), .68, "Existing configured ring composites retain their old size");
assert.equal(generator.planetSceneBodyScale({ rings: "Yes", image: "portrait.webp", sceneImage: "polar.webp", sceneImageSource: "portrait.webp", sceneBodyScale: .54 }), .54);
assert.equal(generator.planetSurfacePoint(0, 0, 1, 0).y, 1, "Pole-on camera sees north pole at center");
assert(Math.abs(generator.planetSurfacePoint(0, 0, 1, Math.PI / 2).y) < 1e-12, "Equatorial camera sees equator at center");
assert.deepEqual(first.pixels, generator.renderPlanetPixels({ ...recipe, axialTilt: 0 }, 64).pixels, "Axial tilt does not change the information portrait");
assert.deepEqual(first.pixels, generator.renderPlanetPixels({ ...recipe, axialTilt: 70 }, 64, { view: "scene" }).pixels, "Both views sample the same surface at the same inclination");
assert.notDeepEqual(first.pixels, generator.renderPlanetPixels({ ...recipe, axialTilt: 0 }, 64, { view: "scene" }).pixels);
assert.deepEqual(first.pixels, (await generator.renderPlanetPixelsAsync(recipe, 64)).pixels, "Cooperative export matches synchronous preview");
const polarRings = generator.renderPlanetPixels({ ...recipe, rings: true, axialTilt: 0 }, 64, { view: "scene" });
const sideRings = generator.renderPlanetPixels({ ...recipe, rings: true, axialTilt: 0 }, 64);
assert(polarRings.pixels[(4 * 64 + 32) * 4 + 3] > 0, "Pole-on rings extend above globe");
assert.equal(sideRings.pixels[(4 * 64 + 32) * 4 + 3], 0, "Side-view rings are foreshortened");
assert.equal(generator.planetSceneImage({ image: "custom.webp", sceneImage: "old-scene.webp", sceneImageSource: "old.webp" }), "custom.webp", "Replacing portrait invalidates old polar artwork");

const raw = {
  isStarSystem: true, designation: "Test System", stars: [{ id: "star1", role: "Primary", spectralType: "G", image: "star.webp", procedural: JSON.stringify(generator.normalizePlanetRecipe({}, { spectralType: "G" })), sceneImage: "star-polar.webp", sceneImageSource: "star.webp", sceneBodyScale: .72 }],
  worlds: [{ id: "planet1", name: "Test Planet", type: "Class-M", orbitalAU: "1", rings: "Yes", image: "planet.webp", sceneImage: "planet-polar.webp", sceneImageSource: "planet.webp", sceneBodyScale: .54, procedural: JSON.stringify(recipe),
    moonRecords: Array.from({ length: 8 }, (_, i) => ({ id: `moon${i}`, name: `Moon ${i}`, type: "Class-D", image: "moon.webp", sceneImage: "moon-polar.webp", sceneImageSource: "moon.webp", procedural: JSON.stringify(recipe) })) }],
};
const normalized = sheet.normalizeStarSystemData(raw);
assert.equal(normalized.stars[0].procedural, raw.stars[0].procedural);
assert.equal(normalized.stars[0].sceneImage, "star-polar.webp");
assert.equal(normalized.worlds[0].procedural, JSON.stringify(recipe));
assert.equal(normalized.worlds[0].moonRecords[0].procedural, JSON.stringify(recipe));
assert.equal(normalized.worlds[0].sceneImage, "planet-polar.webp");
assert.equal(normalized.worlds[0].sceneBodyScale, "0.54");
assert.equal(normalized.worlds[0].moonRecords[0].sceneImage, "moon-polar.webp");
const form = new Map([
  ["starSystem.stars.0.id", "star1"], ["starSystem.stars.0.procedural", raw.stars[0].procedural],
  ["starSystem.stars.0.sceneImage", "star-polar.webp"], ["starSystem.stars.0.sceneImageSource", "star.webp"],
  ["starSystem.stars.0.sceneBodyScale", ".72"],
  ["starSystem.worlds.0.id", "planet1"], ["starSystem.worlds.0.procedural", JSON.stringify(recipe)],
  ["starSystem.worlds.0.sceneImage", "planet-polar.webp"], ["starSystem.worlds.0.sceneImageSource", "planet.webp"],
  ["starSystem.worlds.0.sceneBodyScale", "0.54"],
  ["starSystem.worlds.0.moonRecords.0.id", "moon1"], ["starSystem.worlds.0.moonRecords.0.procedural", JSON.stringify(recipe)],
  ["starSystem.worlds.0.moonRecords.0.sceneImage", "moon-polar.webp"], ["starSystem.worlds.0.moonRecords.0.sceneImageSource", "moon.webp"],
]);
const roundtrip = sheet.StarSystemActorSheet.prototype._dataFromForm.call({}, form).starSystem;
assert.equal(roundtrip.stars[0].procedural, raw.stars[0].procedural, "Sheet saves preserve stellar recipes");
assert.equal(roundtrip.stars[0].sceneImage, "star-polar.webp");
assert.equal(roundtrip.worlds[0].procedural, JSON.stringify(recipe), "Sheet saves preserve the recipe");
assert.equal(roundtrip.worlds[0].moonRecords[0].procedural, JSON.stringify(recipe));
assert.equal(roundtrip.worlds[0].sceneImageSource, "planet.webp");
assert.equal(roundtrip.worlds[0].sceneBodyScale, "0.54");
assert.equal(roundtrip.worlds[0].moonRecords[0].sceneImage, "moon-polar.webp");
const actor = { id: "system1", name: "Test System", getFlag: () => structuredClone(raw), setFlag: async () => {} };
for (const version of [13, 14]) {
  context.game.release.generation = version;
  const scene = await scenes.buildPlanetaryOverviewScene(actor, normalized, normalized.worlds[0], "background.webp");
  assert.equal(scene.embedded.Tile.length, 9);
  assert.equal(scene.embedded.Wall.length, 9 * 16);
  assert.equal(scene.flags["sta2e-toolkit"].starSystemSceneWorld, "planet1");
  assert.equal(version === 14 ? scene.levels[0].background.src : scene.background.src, "background.webp");
  const planet = scene.embedded.Tile[0];
  assert.equal(scene.embedded.Wall[0].c[0] - scene.width / 2, Math.round(planet.width / 2 * .9 * .54), "Body walls follow the smaller globe within the broad rings");
  assert.equal(planet.texture.src, "planet-polar.webp", "Overview uses polar planet texture");
  assert.equal(scene.embedded.Tile[1].texture.src, "moon-polar.webp", "Overview uses polar moon texture");
  assert.equal(planet.x, scene.width / 2 - (version === 13 ? planet.width / 2 : 0));
  for (const tile of scene.embedded.Tile) {
    const cx = tile.x + (version === 13 ? tile.width / 2 : 0);
    const cy = tile.y + (version === 13 ? tile.height / 2 : 0);
    assert(cx - tile.width / 2 >= 0 && cx + tile.width / 2 <= scene.width);
    assert(cy - tile.height / 2 >= 0 && cy + tile.height / 2 <= scene.height);
  }
}
const existingScene = (id, worldId, sceneLayout) => ({ id, name: id, getFlag: (_module, key) => key === "starSystemSceneActor" ? actor.id : key === "starSystemSceneWorld" ? worldId : key === "starSystemSceneLayout" ? sceneLayout : undefined });
context.game.scenes = [existingScene("old-system", null), existingScene("old-planet", "planet1"), existingScene("other-planet", "planet2")];
replace = true;
await scenes.createStarSystemMapScene(actor);
assert(created.at(-1).embedded.Tile.some(tile => tile.texture.src === "star-polar.webp"), "System map selects generated star scene art");
assert(created.at(-1).embedded.Tile.some(tile => tile.texture.src === "planet-polar.webp"), "System map uses polar planet texture");
assert(created.at(-1).embedded.Tile.some(tile => tile.texture.src === "moon-polar.webp"), "System map uses polar moon texture");
assert(deleted.includes("old-system"));
assert(!deleted.includes("old-planet"), "System replacement preserves planetary overviews");
await scenes.createPlanetaryOverviewScene(actor, "planet1");
assert(deleted.includes("old-planet"));
assert(!deleted.includes("other-planet"), "Only selected planet is replaced");
context.game.scenes.push(existingScene("old-encounter", "planet1", "encounter"));
deleted.length = 0;
layout = "encounter";
await scenes.createPlanetaryOverviewScene(actor, "planet1");
assert.deepEqual(deleted, ["old-encounter"], "Encounter replacement preserves legacy overview and other planets");
layout = "overview";

for (const version of [13, 14]) for (const mirror of [false, true]) for (const count of [0, 8, 50]) {
  context.game.release.generation = version;
  const world = { ...normalized.worlds[0], moonRecords: Array.from({ length: count }, (_, i) => ({ ...normalized.worlds[0].moonRecords[0], id: `moon${i}` })) };
  const scene = await scenes.buildPlanetaryEncounterScene(actor, normalized, world, "background.webp", { mirror });
  assert.equal(scene.width, 6000); assert.equal(scene.height, 4000);
  assert.equal(scene.embedded.Tile.length, count + 1);
  assert.equal(scene.embedded.Wall.length, (count + 1) * 16);
  assert.equal(scene.embedded.Drawing, undefined, "Encounter annotations default off");
  assert.equal(scene.flags["sta2e-toolkit"].starSystemSceneLayout, "encounter");
  assert.equal(version === 14 ? scene.levels[0].background.src : scene.background.src, "background.webp");
  const bodies = scene.embedded.Tile.map(tile => ({
    x: tile.x + (version === 13 ? tile.width / 2 : 0), y: tile.y + (version === 13 ? tile.height / 2 : 0), radius: tile.width / 2,
  }));
  assert.equal(bodies[0].x, mirror ? 4600 : 1400);
  for (const [i, body] of bodies.entries()) {
    assert(body.x - body.radius >= 0 && body.x + body.radius <= 6000);
    assert(body.y - body.radius >= 0 && body.y + body.radius <= 4000);
    for (const other of bodies.slice(i + 1)) assert(Math.hypot(body.x - other.x, body.y - other.y) > body.radius + other.radius, "Encounter bodies do not overlap");
  }
}
const noMoons = await scenes.buildPlanetaryEncounterScene(actor, normalized, normalized.worlds[0], "", { moons: false, labels: true, orbitRings: true, hoverNames: false });
assert.equal(noMoons.embedded.Tile.length, 1);
assert.equal(noMoons.embedded.Drawing.length, 1);
assert.equal(noMoons.flags["sta2e-toolkit"].starSystemHoverNames, false, "The hover preference is saved with the scene");
assert(noMoons.embedded.Tile[0].flags["sta2e-toolkit"].systemBody.name, "Hiding hover names retains body metadata and printed labels");
const annotated = await scenes.buildPlanetaryEncounterScene(actor, normalized, normalized.worlds[0], "", { labels: true, orbitRings: true });
assert.equal(annotated.flags["sta2e-toolkit"].starSystemHoverNames, true, "Other layouts retain hover names by default");
assert.equal(annotated.embedded.Drawing.length, normalized.worlds[0].moonRecords.length + 2);
deleted.length = 0;
failEmbedded = true;
await assert.rejects(scenes.buildPlanetaryEncounterScene(actor, normalized, normalized.worlds[0]), /injected failure/);
assert.deepEqual(deleted, [created.at(-1).id]);
deleted.length = 0;
await assert.rejects(scenes.createStarSystemMapScene(actor), /injected failure/);
assert.deepEqual(deleted, [created.at(-1).id], "Failed new scene is cleaned up; existing scene is retained");
await assert.rejects(scenes.createPlanetaryOverviewScene(actor, "planet1"), /injected failure/);
assert(!deleted.includes("old-planet"));
failEmbedded = false;
dialogChoice = "cancel";
const count = created.length;
assert.equal(await scenes.createPlanetaryOverviewScene(actor, "planet1"), null);
assert.equal(created.length, count);
context.game.user.isGM = false;
assert.equal(await scenes.createPlanetaryOverviewScene(actor, "planet1"), null);
assert.equal(created.length, count);

// Exercise the upload path without relying on a browser or a live world's files.
const uploads = [];
const encodedSizes = [];
context.game.user.isGM = true;
context.game.world = { id: "test-world" };
context.document = { createElement: () => ({ getContext: () => ({ putImageData() {} }), toBlob(callback) { encodedSizes.push([this.width, this.height]); callback({}); } }) };
context.ImageData = class {};
context.File = class { constructor(_parts, name, options) { this.name = name; this.type = options.type; } };
context.foundry.applications.apps = { FilePicker: { implementation: {
  createDirectory: async () => {}, upload: async (source, directory, file) => {
    uploads.push({ source, directory, file }); return { path: `${directory}/${file.name}` };
  },
} } };
const saved = await generator.saveProceduralPlanetImage({ id: "planet1" }, actor.id, recipe);
assert.equal(uploads[0].directory, "worlds/test-world/sta2e-procedural-planets");
assert(saved.image.endsWith(".webp"));
assert.equal(saved.procedural, JSON.stringify(recipe));
assert.equal(uploads.length, 2, "Apply uploads separate information and scene views");
assert.deepEqual(encodedSizes, [[1024, 1024], [1024, 1024]], "Both exports honor the selected texture size");
assert(saved.image.endsWith("-portrait.webp"));
assert(saved.sceneImage.endsWith("-scene.webp"));
assert.equal(saved.sceneImageSource, saved.image);
assert(generator.proceduralSceneImageIsCurrent(saved));
assert(!generator.proceduralSceneImageIsCurrent({ ...saved, procedural: JSON.stringify({ ...recipe, axialTilt: 50 }) }), "Changing tilt invalidates cached scene view");
const legacy = { id: "planet1", image: "sta2e-procedural-old.webp", procedural: JSON.stringify({ ...recipe, version: 1 }) };
let legacyData = { ...raw, worlds: [{ ...legacy, name: "Legacy", type: "Class-M", moonRecords: [] }] };
const legacyActor = { ...actor, getFlag: () => structuredClone(legacyData), setFlag: async (_module, _key, value) => { legacyData = value; } };
dialogChoice = "create";
replace = false;
await scenes.createPlanetaryOverviewScene(legacyActor, legacy.id);
assert.equal(legacyData.worlds[0].image, legacy.image, "Preparing a legacy polar view preserves information portrait");
assert.equal(legacyData.worlds[0].procedural, legacy.procedural, "Preparing a polar view preserves original recipe");
assert.equal(legacyData.worlds[0].sceneImageSource, legacy.image);
assert.equal(created.at(-1).embedded.Tile[0].texture.src, legacyData.worlds[0].sceneImage);
assert.equal(uploads.length, 3, "Only the missing scene view is uploaded");
await scenes.createPlanetaryOverviewScene(legacyActor, legacy.id);
assert.equal(uploads.length, 3, "A current polar texture is reused without rerendering");

// Full scene workflow: blank stars and belts get paired procedural artwork.
const generatedStarRecipe = generator.normalizePlanetRecipe({ resolution: 1024 }, { spectralType: "K" });
const generatedBeltRecipe = generator.normalizePlanetRecipe({ resolution: 1024 }, { type: "Asteroid Belt" });
let generatedData = { isStarSystem: true, designation: "Procedural catalog", stars: [{ id: "newstar", spectralType: "K", procedural: JSON.stringify(generatedStarRecipe) }],
  worlds: [{ id: "newbelt", name: "Belt", type: "Asteroid Belt", orbitalAU: "2", procedural: JSON.stringify(generatedBeltRecipe) }] };
const generatedActor = { ...actor, id: "catalog-system", getFlag: () => structuredClone(generatedData), setFlag: async (_module, _key, data) => { generatedData = data; } };
artworkMode = "missing";
const beforeCatalogUploads = uploads.length;
await scenes.createStarSystemMapScene(generatedActor);
assert.equal(uploads.length - beforeCatalogUploads, 4, "Missing star and asteroid belt each upload two views");
assert.equal(JSON.parse(generatedData.stars[0].procedural).style, "star");
assert.equal(JSON.parse(generatedData.worlds[0].procedural).style, "asteroid");
assert.equal(Number(generatedData.stars[0].sceneBodyScale), .72);
const beltTiles = created.at(-1).embedded.Tile.filter(tile => tile.flags["sta2e-toolkit"].systemBody.kind === "belt");
assert.equal(beltTiles.length, 24);
assert(beltTiles.every(tile => tile.texture.src === generatedData.worlds[0].sceneImage));
assert(new Set(beltTiles.map(tile => tile.rotation)).size > 10, "Generated belt rocks have varied orientation");
assert(created.at(-1).embedded.Tile.some(tile => tile.texture.src === generatedData.stars[0].sceneImage));
await scenes.createStarSystemMapScene(generatedActor);
assert.equal(uploads.length - beforeCatalogUploads, 4, "Current star and asteroid textures are reused");
artworkMode = "existing";
dialogChoice = "cancel";
const previousUploadCount = uploads.length;
assert.equal(await generator.promptProceduralPlanet({ id: "planet1", type: "Class-M" }, actor.id), null);
assert.equal(uploads.length, previousUploadCount, "Cancel does not upload");
context.foundry.applications.apps.FilePicker.implementation.upload = async () => { throw new Error("upload failed"); };
await assert.rejects(generator.saveProceduralPlanetImage({ id: "planet1" }, actor.id, recipe), /upload failed/);

// 2.5D rings, ring Regions, and the close-up orbital layouts.
{
  const uploaded = [];
  context.foundry.applications.apps.FilePicker.implementation.upload = async (_source, directory, file) => {
    uploaded.push(file.name); return { path: `${directory}/${file.name}` };
  };
  const ringRecipe = generator.normalizePlanetRecipe({ seed: "ringed", style: "gas", rings: true, axialTilt: 60, resolution: 1024 });
  const art = await generator.saveProceduralPlanetImage({ id: "ringed1" }, actor.id, ringRecipe);
  assert(art.sceneImage.endsWith("-scene.webp") && art.sceneRingFront.endsWith("-scene-ring.webp"), "Ringed scene art is split into back and front layers");
  assert.equal(uploaded.length, 3);
  assert(generator.proceduralSceneImageIsCurrent(art));
  assert(!generator.proceduralSceneImageIsCurrent({ ...art, sceneRingFront: "" }), "Pre-split ringed art is regenerated once");
  assert.equal(generator.planetSceneRingFront(art), art.sceneRingFront);
  assert.equal(generator.planetSceneRingFront({ ...art, sceneImageSource: "custom.webp" }), "", "Replaced portrait art drops the stale front layer");
  const ringed = { ...normalized.worlds[0], id: "ringed1", ...art };
  context.game.release.generation = 14;
  const encounter = await scenes.buildPlanetaryEncounterScene(actor, normalized, ringed, "", {});
  const front = encounter.embedded.Tile.find(tile => tile.flags["sta2e-toolkit"].planetRingFront);
  assert(front && front.elevation > 0 && front.texture.src === art.sceneRingFront, "The near ring arc is raised above tokens");
  assert.equal(encounter.embedded.Tile.filter(tile => tile.texture.src === art.sceneImage).length, 1);
  const [region] = encounter.embedded.Region;
  assert.deepEqual(region.shapes.map(shape => shape.hole), [false, true], "The ring Region is an annulus");
  const extent = generator.ringVisibleExtent(ringRecipe);
  assert(extent.inner > .61 && extent.outer <= 1 && extent.inner < extent.outer, "The Region fits the visible band, not the material's limits");
  assert.equal(region.shapes[0].radiusX, Math.round(2600 * .48 * extent.outer));
  assert.equal(region.shapes[0].radiusY, Math.round(2600 * .48 * extent.outer * Math.cos(Math.PI / 3)), "The Region is squashed by the axial tilt");
  assert.equal(region.shapes[1].radiusX, Math.round(2600 * .48 * extent.inner), "The hole starts where the ring shows");
  assert.deepEqual(region.behaviors.map(behavior => behavior.type), ["sta2e-toolkit.difficultTerrain", "sta2e-toolkit.sensorShroud"]);
  assert(region.flags["sta2e-toolkit"].planetRing);
  const quiet = await scenes.buildPlanetaryEncounterScene(actor, normalized, ringed, "", { ringTerrain: false });
  assert.equal(quiet.embedded.Region[0].behaviors.length, 0, "Ring terrain can be switched off, keeping the wake Region");
  const plain = await scenes.buildPlanetaryEncounterScene(actor, normalized, normalized.worlds[0], "", {});
  assert.equal(plain.embedded.Region, undefined, "Custom ring art gets no guessed Region");

  const high = await scenes.buildPlanetaryHighOrbitScene(actor, normalized, ringed, "", { focusMoon: normalized.worlds[0].moonRecords.at(-1).id });
  assert.equal(high.flags["sta2e-toolkit"].starSystemSceneLayout, "highOrbit");
  const focusTile = high.embedded.Tile.find(tile => tile.width === 1300);
  assert.equal(focusTile.flags["sta2e-toolkit"].systemBody.name, normalized.worlds[0].moonRecords.at(-1).name || "moon");
  for (const tile of high.embedded.Tile) {
    assert(tile.x - tile.width / 2 >= 0 && tile.x + tile.width / 2 <= 6000 && tile.y - tile.height / 2 >= 0 && tile.y + tile.height / 2 <= 4000, "High orbit bodies stay on the map");
  }

  const low = await scenes.buildPlanetaryLowOrbitScene(actor, normalized, ringed, "", {});
  assert(uploaded.at(-1).endsWith("-low-orbit.webp"));
  const band = low.embedded.Tile[0];
  assert.equal(low.flags["sta2e-toolkit"].starSystemHoverNames, false, "Low-orbit scenes default to hidden hover names");
  assert.equal(band.width, 6000);
  assert(band.height < 4000 && band.y + band.height / 2 === 4000, "The limb band sits along the bottom edge");
  assert.equal(low.embedded.Wall.length, 24);
  const lowQuality = generator.normalizePlanetRecipe(ringed.procedural, ringed).resolution;
  const lowWidth = Math.min(4096, Math.max(3000, lowQuality * 2));
  assert.deepEqual(encodedSizes.at(-1), [lowWidth, Math.round(band.height * lowWidth / 6000)], "Low orbit uses the selected quality for a detailed cropped render");

  const plane = await scenes.buildPlanetaryRingPlaneScene(actor, normalized, ringed, "", { mirror: true });
  assert(uploaded.at(-1).endsWith("-ring-plane-r.webp"));
  assert.equal(plane.embedded.Region.length, 1);
  assert.equal(plane.embedded.Region[0].shapes[0].radiusX, plane.embedded.Region[0].shapes[0].radiusY, "The ring plane is seen face-on");
  assert.equal(await scenes.buildPlanetaryRingPlaneScene(actor, normalized, normalized.worlds[0], "", {}), null, "Ring Plane needs procedural rings");
  assert.equal(await scenes.buildPlanetaryLowOrbitScene(actor, normalized, normalized.worlds[0], "", {}), null, "Low Orbit needs a procedural recipe");
}
{
  const hooks = new Map(), listeners = new Map();
  const board = { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  const originalDocument = context.document;
  let tooltip;
  context.document = { body: { appendChild: element => { tooltip = element; } }, createElement: () => ({ hidden: true, isConnected: true, style: {} }) };
  context.Hooks = { on: (name, callback) => hooks.set(name, callback) };
  context.canvas = { app: { view: board }, canvasCoordinatesFromClient: p => p };
  scenes.registerStarSystemMapHover();
  for (const [layout, preference, enabled] of [["lowOrbit", undefined, false], ["lowOrbit", true, true], ["encounter", false, false], ["encounter", undefined, true]]) {
    const flags = { starSystemSceneActor: "system", starSystemSceneLayout: layout, starSystemHoverNames: preference };
    context.canvas.scene = { getFlag: (_module, key) => flags[key], tiles: [{ x: 150, y: 150, width: 100, height: 100, getFlag: () => ({ name: "Test planet" }) }] };
    hooks.get("canvasReady")();
    assert.equal(listeners.has("pointermove"), enabled, "The persisted hover option controls cursor tooltips, including legacy low orbit");
    if (enabled) {
      listeners.get("pointermove")({ clientX: 150, clientY: 150 });
      assert.equal(tooltip.textContent, "Test planet"); assert.equal(tooltip.hidden, false);
    } else if (tooltip) assert.equal(tooltip.hidden, true, "Switching scenes clears the previous tooltip");
    hooks.get("canvasTearDown")();
    assert.equal(listeners.size, 0);
  }
  context.document = originalDocument;
}
console.log("PASS: complete planet/moon/star catalog, asteroids and belts, stellar flares/glow/lens effects, ice giants, gas colors, ring structure/shadows, terrain, paired views, persistence, v13/v14 scenes, rollback, cancellation, uploads, and scene hover preferences.");

// Optional contact sheet for visual inspection; writes only to the supplied path.
if (process.argv[2]) {
  const variants = [
    ...["gold", "azure", "violet", "jade"].map(palette => ({ style: "gas", palette, texture: "turbulent" })),
    ...["ochre", "red", "ivory", "charcoal"].map(palette => ({ style: "desert", palette, texture: "badlands", mountains: 85 })),
    { style: "terrestrial", palette: "emerald", clouds: 10, rivers: 100 },
    { style: "terrestrial", palette: "amethyst", clouds: 10, rivers: 100 },
    { style: "desert", palette: "red", texture: "badlands", water: 3, rivers: 100 },
    { style: "terrestrial", palette: "natural", texture: "continental", water: 35, clouds: 0, mountains: 100, rivers: 100, cities: 100 },
  ];
  const gasVariants = [
    { texture: "banded" }, { texture: "turbulent" }, { texture: "smooth" }, { texture: "banded", palette: "azure" },
    { rings: true, ringStyle: "icy", texture: "smooth" }, { rings: true, ringStyle: "dusty" },
    { rings: true, ringStyle: "narrow" }, { rings: true, palette: "violet" },
    ...[0, 23.5, 65, 90].map(axialTilt => ({ rings: true, axialTilt, view: "scene" })),
  ].map(variant => ({ style: "gas", palette: "gold", ...variant }));
  const hotVariants = [
    ...["gold", "peacock", "opal", "azure"].map(palette => ({ palette, texture: "turbulent" })),
    ...["ember", "plasma", "stellar"].map(palette => ({ palette, texture: "hot" })),
    { palette: "ember", texture: "hot", hotGlow: 100 },
    ...["ember", "plasma", "stellar"].map(palette => ({ palette, texture: "hot", view: "scene" })),
    { palette: "peacock", texture: "turbulent", rings: true, view: "scene" },
  ].map(variant => ({ style: "gas", ...variant }));
  const iceVariants = [
    { texture: "ice-hazy", palette: "uranus" }, { texture: "ice-stormy", palette: "neptune" },
    { texture: "ice-hazy", palette: "coldTeal" }, { texture: "ice-stormy", palette: "uranus" },
    { texture: "ice-hazy", palette: "uranus", view: "scene", axialTilt: 0 },
    { texture: "ice-stormy", palette: "neptune", view: "scene", axialTilt: 23.5 },
    { texture: "ice-hazy", palette: "coldTeal", view: "scene", axialTilt: 98 },
    { texture: "ice-stormy", palette: "uranus", view: "scene", axialTilt: 180 },
    { texture: "ice-hazy", palette: "uranus", rings: true, ringStyle: "narrow" },
    { texture: "ice-stormy", palette: "neptune", rings: true, ringStyle: "dusty" },
    { texture: "ice-hazy", palette: "coldTeal", rings: true, ringStyle: "narrow", view: "scene", axialTilt: 45 },
    { texture: "ice-stormy", palette: "neptune", rings: true, ringStyle: "narrow", view: "scene", axialTilt: 90 },
  ].map(variant => ({ style: "gas", ...variant }));
  const coverageVariants = [
    ...["E", "F", "G", "N", "Y", "Q", "R"].map(cls => generator.normalizePlanetRecipe({ seed: "coverage" }, { type: `Class-${cls}` })),
    { style: "ice", texture: "cratered" },
    ...["silicate", "carbonaceous", "metallic", "icy"].map(texture => ({ style: "asteroid", texture })),
  ];
  const stellarVariants = catalog.STAR_SYSTEM_STAR_IMAGE_TYPES.map(({ key }) => generator.normalizePlanetRecipe({ seed: "stellar-preview" }, { spectralType: key }));
  const weatherVariants = [
    ...[0, 15, 40, 70].map(iceCoverage => ({ style: "terrestrial", seed: "climate-preview", iceCoverage, clouds: 0 })),
    ...["wispy", "mixed", "layered", "stormy"].map(cloudStyle => ({ style: "terrestrial", seed: "climate-preview", cloudStyle, clouds: 45, iceCoverage: 15, hurricanes: 0, storminess: 65 })),
    { ...hurricaneRecipe, hurricanes: 1 }, { ...hurricaneRecipe, hurricanes: 3 },
    { ...hurricaneRecipe, hurricanes: 3, view: "scene", axialTilt: 30 },
    { style: "desert", seed: "climate-preview", water: 12, iceCoverage: 40, clouds: 25 },
  ];
  const effectVariants = [
    { stellarFlares: 0, stellarGlow: 0, lensFlare: 0 },
    { stellarFlares: 85, stellarGlow: 0, lensFlare: 0 },
    { stellarFlares: 85, stellarGlow: 70, lensFlare: 0 },
    { stellarFlares: 85, stellarGlow: 70, lensFlare: 65 },
  ].map(variant => ({ style: "star", texture: "G", seed: "flare-comparison", ...variant }));
  const venusVariants = ["portrait", "scene"].flatMap(view => ["N", "Y"].map(cls => ({ ...generator.normalizePlanetRecipe({ seed: "venus-clouds" }, { type: `Class-${cls}` }), view })));
  const craterVariants = [0, 45, 100].map(craterDensity => ({ ...marsRecipe, water: 0, rivers: 0, mountains: 35, craterDensity }));
  craterVariants.push({ ...rocky, seed: "mars-craters", craterDensity: 80 });
  const geologyVariants = [
    {}, { canyons: 85 }, { impactBasins: 85 }, { shieldVolcanoes: 85 },
    { canyons: 70, impactBasins: 60, shieldVolcanoes: 65, craterDensity: 30 },
    { canyons: 70, impactBasins: 60, shieldVolcanoes: 65, craterDensity: 30, view: "scene", axialTilt: 25 },
    { style: "barren", texture: "rocky", palette: "grey", canyons: 85, impactBasins: 60, shieldVolcanoes: 65, craterDensity: 30 },
    { canyons: 75, impactBasins: 70, shieldVolcanoes: 50, water: 3, rivers: 70, iceCoverage: 8 },
  ].map(v => ({ ...marsRecipe, water: 0, rivers: 0, mountains: 20, craterDensity: 0, ...v }));
  const surfaceVariants = [
    ...surfaceRecipes.slice(0, 3), { ...surfaceRecipes[0], canyons: 70, impactBasins: 50, shieldVolcanoes: 60, craterDensity: 45 },
    { ...surfaceRecipes[3], craterDensity: 85 }, surfaceRecipes[4], surfaceRecipes[5], surfaceRecipes[6],
    surfaceRecipes[7], { ...surfaceRecipes[8], water: 62, clouds: 15, rivers: 65, iceCoverage: 12 }, surfaceRecipes[9], surfaceRecipes[10],
  ];
  const mineralVariants = [
    ...["red", "mars", "mesa", "mineral"].map(palette => ({ style: "desert", texture: "badlands", palette })),
    ...["grey", "lunar", "iron", "mineral"].map(palette => ({ style: "barren", texture: "rocky", palette })),
  ].map(r => ({ seed: "mineral-provinces", mountains: 40, craterDensity: 40, canyons: 40, water: 0, clouds: 0, ...r }));
  const fissureVariants = [
    ...[0, 40, 100].map(fissureDensity => ({ style: "desert", texture: "badlands", palette: "mars", fissureDensity })),
    { style: "desert", texture: "badlands", palette: "mars", fissureDensity: 100, view: "scene", axialTilt: 25 },
    ...[0, 75].map(fissureDensity => ({ style: "barren", texture: "rocky", palette: "grey", fissureDensity })),
    ...[0, 75].map(fissureDensity => ({ style: "ice", texture: "fractured", palette: "white", fissureDensity })),
  ].map(r => ({ seed: "surface-fissures", mountains: 35, mineralVariation: 30, water: 0, clouds: 0, craterDensity: 0, ...r }));
  const cityVariants = [
    ...cityRecipes.slice(0, 4), cityRecipes[4], cityRecipes[5],
    { ...surfaceRecipes[0], phaseAngle: 43, nightBrightness: 10 },
    { ...surfaceRecipes[0], phaseAngle: 65, nightBrightness: 2 },
  ];
  const networkVariants = [
    { style: "barren", palette: "grey" }, { style: "ice", texture: "glacial", palette: "white" },
    { style: "desert", texture: "badlands", palette: "mars" }, { style: "barren", palette: "grey", view: "scene", axialTilt: 25 },
  ].map(r => ({ ...cityRecipes[6], citySize: 95, cities: 80, ...r }));
  const selectedVariants = process.argv[3] === "network" ? networkVariants : process.argv[3] === "cities" ? cityVariants : process.argv[3] === "fissures" ? fissureVariants : process.argv[3] === "minerals" ? mineralVariants : process.argv[3] === "surfaces" ? surfaceVariants : process.argv[3] === "geology" ? geologyVariants : process.argv[3] === "craters" ? craterVariants : process.argv[3] === "venus" ? venusVariants : process.argv[3] === "weather" ? weatherVariants : process.argv[3] === "effects" ? effectVariants : process.argv[3] === "coverage" ? coverageVariants : process.argv[3] === "stars" ? stellarVariants : process.argv[3] === "ice" ? iceVariants : process.argv[3] === "hot" ? hotVariants : process.argv[3] === "gas" ? gasVariants : variants;
  const size = process.argv[4] === "small" ? 256 : ["gas", "hot"].includes(process.argv[3]) ? 512 : 384, width = size * 4, height = size * Math.ceil(selectedVariants.length / 4);
  const data = Buffer.alloc((width * 4 + 1) * height);
  for (let k = 0; k < selectedVariants.length; k++) {
    const variant = selectedVariants[k];
    const rendered = generator.renderPlanetPixels({ seed: "preview-5", ...variant }, size, { view: variant.view ?? "portrait" });
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4, dst = ((Math.floor(k / 4) * size + y) * (width * 4 + 1)) + 1 + (k % 4 * size + x) * 4;
      const a = rendered.pixels[src + 3] / 255;
      for (let c = 0; c < 3; c++) data[dst + c] = rendered.pixels[src + c] * a + [5, 9, 18][c] * (1 - a);
      data[dst + 3] = 255;
    }
  }
  const crc32 = b => {
    let crc = -1;
    for (const n of b) { crc ^= n; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    return (crc ^ -1) >>> 0;
  };
  const chunk = (type, bytes) => {
    const name = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4);
    len.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
    return Buffer.concat([len, name, bytes, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  await writeFile(process.argv[2], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(data)), chunk("IEND", Buffer.alloc(0))]));
  console.log(`Preview: ${process.argv[2]}`);
}
