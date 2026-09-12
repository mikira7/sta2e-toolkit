/** Seeded, local planet textures. No image packs or external service required. */
import { createGasGiantMaterial, createRingMaterial, ringPlanetShadow, ringSurfaceTransmission, isIceGiantTexture, RING_BODY_SCALE, RING_STYLES } from "./gas-giant-material.js";
import { proceduralBodyDefaults, STELLAR_TEXTURES, STELLAR_COLORS } from "./procedural-body-types.js";
import { celestialPixelRows } from "./celestial-materials.js";
import { createGreenhouseClouds, createPlanetIce, createPlanetWeather, PLANET_CLOUD_STYLES } from "./planet-weather.js";
import { createPlanetGeology } from "./planet-geology.js";
import { createSolidSurfaceMaterial } from "./planet-surface-material.js";
import { createPlanetCities, PLANET_CITY_STYLES } from "./planet-cities.js";
import { planetLightDirection, planetIllumination } from "./planet-lighting.js";
export { PLANET_CLASS_DEFAULTS, proceduralBodyDefaults } from "./procedural-body-types.js";
export const PLANET_STYLES = {
  terrestrial: "Terrestrial", ocean: "Ocean", desert: "Desert",
  ice: "Ice", barren: "Barren", volcanic: "Volcanic", gas: "Gas giant",
  primordial: "Primordial", greenhouse: "Dense atmosphere", asteroid: "Asteroid / moonlet", star: "Star / brown dwarf",
};
const VERSION = 16;
export const PLANET_RESOLUTIONS = [1024, 2048, 4096];
export const PLANET_TEXTURES = {
  terrestrial: { continental: "Continents", archipelago: "Archipelagos", supercontinent: "Supercontinents", seasonal: "Variable / seasonal ice" },
  ocean: { archipelago: "Island chains", continental: "Scattered continents" },
  desert: { dunes: "Sand dunes", badlands: "Rocky badlands", salt: "Salt flats" },
  gas: { banded: "Cloud bands", turbulent: "Turbulent storms", smooth: "Soft bands", "ice-hazy": "Ice giant — hazy", "ice-stormy": "Ice giant — stormy", hot: "Hot Jupiter / plasma clouds" },
  ice: { glacial: "Glaciers", fractured: "Fractured ice", cratered: "Cratered ice" },
  barren: { cratered: "Cratered", rocky: "Rocky highlands", frozen: "Rogue / frozen rock" },
  volcanic: { fissures: "Lava fissures", calderas: "Lava fields" },
  primordial: { magma: "Geoplastic / molten crust", crust: "Primordial / cooling crust", developing: "Developing / early oceans" },
  greenhouse: { venus: "Reducing / Venus-like clouds", toxic: "Demon / Venus-like toxic clouds" },
  asteroid: { silicate: "Silicate rock", carbonaceous: "Dark carbonaceous rock", metallic: "Metal-rich rock", icy: "Icy rubble" },
  star: STELLAR_TEXTURES,
};
export const PLANET_COLOR_LABELS = {
  surfaceLow: "Lowlands / dark bands", surfaceHigh: "Highlands / light bands",
  rock: "Exposed rock", mineral: "Mineral deposits",
  ocean: "Water", cloud: "Clouds", ice: "Ice / snow", city: "City lights",
};
const palette = (label, surfaceLow, surfaceHigh, ocean = "#247aa6", cloud = "#edf2f8", ice = "#dce9ef", city = "#ffc56b") =>
  ({ label, colors: { surfaceLow, surfaceHigh, rock: surfaceLow, mineral: surfaceHigh, ocean, cloud, ice, city } });
const mineralPalette = (label, soil, dust, rock, mineral) => {
  const entry = palette(label, soil, dust);
  return { ...entry, colors: { ...entry.colors, rock, mineral }, mineralVariation: 75 };
};
const gasPalette = (label, gasColors, hot = false) => ({
  ...palette(label, gasColors[0], gasColors.at(-1), "#247aa6", gasColors.at(-1)), gasColors, hot,
});
const livingPalettes = {
  natural: palette("Blue oceans / green land", "#305b30", "#b4a37c"),
  emerald: palette("Green oceans / ochre land", "#807147", "#ccb990", "#219b73"),
  amethyst: palette("Purple oceans / green land", "#42552e", "#a69e72", "#8146b8"),
  alien: palette("Teal oceans / violet land", "#63416f", "#c19daf", "#218d9a", "#ebddf2"),
};
export const PLANET_PALETTES = {
  terrestrial: livingPalettes, ocean: livingPalettes,
  gas: {
    gold: gasPalette("Golden cream / copper / pearl", ["#483e39", "#925c3e", "#c19162", "#e0bf83", "#b9b6aa", "#f3e4cb"]),
    azure: gasPalette("Navy / teal / cyan / ice", ["#172c56", "#36508c", "#287e92", "#65b6be", "#9bbace", "#d5edf0"]),
    violet: gasPalette("Indigo / violet / rose / lavender", ["#302647", "#594478", "#925c98", "#c692a8", "#b3a7d9", "#ebe0f3"]),
    jade: gasPalette("Forest / jade / gold / mint", ["#233e3b", "#38685a", "#819468", "#c6b178", "#99c6aa", "#e1e8bd"]),
    rose: gasPalette("Burgundy / rose / apricot / cream", ["#432a3c", "#814251", "#b57479", "#dea78f", "#c9b6ad", "#f4dec7"]),
    peacock: gasPalette("Peacock: indigo / teal / jade / gold", ["#292c62", "#53549a", "#298b99", "#76b7a5", "#d5b770", "#eee1b5"]),
    opal: gasPalette("Opal: violet / blue / pink / pearl", ["#444663", "#7f79ac", "#7cbbc9", "#c9a0bd", "#e0c6a9", "#edf0dc"]),
    ember: gasPalette("Ember: crimson / orange / gold / white", ["#240d21", "#731d32", "#c63922", "#f97526", "#ffc455", "#fff3c1"], true),
    plasma: gasPalette("Plasma: indigo / violet / magenta / blue", ["#140e3c", "#42227f", "#963dae", "#db5db6", "#76c5f8", "#e6f8ff"], true),
    stellar: gasPalette("Stellar: wine / copper / amber / ivory", ["#30122b", "#823343", "#c66c3d", "#edb757", "#ffe2a4", "#fff9e5"], true),
    uranus: { ...gasPalette("Uranus-inspired pale cyan", ["#689899", "#80adae", "#94bcba", "#a5c9c5", "#b9d6cf", "#d5e5dd"]), ice: true },
    neptune: { ...gasPalette("Neptune-inspired blue-green", ["#477887", "#608f9f", "#78a7b3", "#8cb8bf", "#acd0d2", "#dce9e6"]), ice: true },
    coldTeal: { ...gasPalette("Cold teal / pearl", ["#517b80", "#709e9f", "#8bb6b2", "#a4c8c1", "#c0dbd1", "#e0eae0"]), ice: true },
  },
  desert: {
    ochre: palette("Ochre sands", "#895026", "#e0b77d"),
    red: palette("Rust red", "#823323", "#d27f4b"),
    ivory: palette("Ivory sands", "#a39b80", "#eee8c8", "#367c79"),
    charcoal: palette("Black sands", "#31313a", "#8d8996", "#57689c"),
    violet: palette("Mauve sands", "#6a426f", "#c0a1b0", "#359780"),
    mars: mineralPalette("Mars: rust / tan dust / basalt / pale minerals", "#854f36", "#cba27d", "#514f49", "#dfd0b4"),
    mesa: mineralPalette("Mesa: terracotta / sandstone / charcoal / cream", "#925439", "#dab17d", "#54504b", "#e9dbc1"),
    mineral: mineralPalette("Mineral desert: ochre / sand / slate / chalk", "#987d4c", "#c8b992", "#56676b", "#dedbd1"),
  },
  ice: {
    blue: palette("Blue ice", "#648caa", "#e1eff3"),
    white: palette("White ice", "#8c999f", "#f3f3ea"),
    pink: palette("Rose ice", "#986e98", "#edd0e1", "#703e9a", "#f5e5ed", "#f0d7e7"),
  },
  barren: {
    grey: palette("Grey rock", "#555451", "#b1aaa0"),
    copper: palette("Copper rock", "#773f2d", "#c58e66"),
    basalt: palette("Dark basalt", "#272a30", "#7c8791"),
    frozen: palette("Frozen rock / blue-grey frost", "#262a36", "#86939e"),
    lunar: mineralPalette("Lunar: grey regolith / basalt / pale ejecta", "#74716a", "#b2aa9a", "#41454a", "#d7d3c6"),
    iron: mineralPalette("Iron-rich: copper / ash / dark rock / cream", "#8f543d", "#afa493", "#44464a", "#d5c9b3"),
    mineral: mineralPalette("Mineral rock: umber / grey / slate / pale veins", "#776449", "#b6afa0", "#526668", "#dfd7c4"),
  },
  volcanic: {
    basalt: palette("Basalt / orange lava", "#242329", "#86533b", "#ed620e"),
    sulfur: palette("Sulfur / yellow lava", "#5a4d2d", "#d2b746", "#f4c825"),
    obsidian: palette("Obsidian / red lava", "#22202e", "#724954", "#e33c25"),
  },
  primordial: {
    molten: palette("Molten orange / dark crust", "#271d23", "#765244", "#fb8d22", "#c5a28b"),
    cooling: palette("Cooling basalt / steam", "#302e32", "#977e64", "#426f7b", "#d6c9b6"),
    young: palette("Young oceans / mineral continents", "#534b37", "#b19e6b", "#3e8190", "#e1d8c1"),
  },
  greenhouse: {
    venus: palette("Sulfur cream / ochre", "#997640", "#e5c995", "#bd7435", "#f6e5c0"),
    demon: palette("Demon copper / sulfur", "#583041", "#c58845", "#eb8b31", "#d7ba7b"),
    toxic: palette("Toxic olive / amber", "#525136", "#b0af65", "#cbb536", "#dddbab"),
  },
  asteroid: {
    stone: palette("Silicate grey / ochre", "#3e3a36", "#a79c8b"),
    carbon: palette("Carbonaceous charcoal", "#1f2024", "#575653"),
    metal: palette("Iron / nickel", "#46434a", "#bcb1a0"),
    frost: palette("Icy rubble", "#626e79", "#d7dfe0"),
  },
  star: { spectral: palette("Spectral-type colors", "#bb6e21", "#ffe8a3") },
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t, 0, 1));

export function planetSeedHash(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function normalizePlanetRecipe(raw = {}, body = {}) {
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = {}; } }
  raw ??= {};
  const inferred = proceduralBodyDefaults(body);
  if (!raw.style || raw.style === inferred.style) raw = { ...inferred, ...raw };
  const cls = String(body.type ?? "").match(/Class-([A-Z])/i)?.[1]?.toUpperCase();
  const style = inferred.style;
  const number = (v, fallback) => v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? fallback : clamp(Number(v), 0, 100);
  const selectedStyle = Object.hasOwn(PLANET_STYLES, raw.style) ? raw.style : style;
  const seed = String(raw.seed ?? body.id ?? "planet").slice(0, 128) || "planet";
  const textureKeys = Object.keys(PLANET_TEXTURES[selectedStyle]);
  const texture = textureKeys.includes(raw.texture) ? raw.texture : selectedStyle === "star" ? "G" : textureKeys[0];
  const palettes = PLANET_PALETTES[selectedStyle];
  const paletteKey = raw.palette === "seeded" || Object.hasOwn(palettes, raw.palette) ? raw.palette
    : ["terrestrial", "ocean"].includes(selectedStyle) ? "natural"
      : selectedStyle === "star" ? "spectral"
        : selectedStyle === "primordial" ? { magma: "molten", crust: "cooling", developing: "young" }[texture]
          : selectedStyle === "greenhouse" ? texture === "toxic" ? "demon" : "venus"
            : selectedStyle === "asteroid" ? { silicate: "stone", carbonaceous: "carbon", metallic: "metal", icy: "frost" }[texture] : "seeded";
  const paletteKeys = Object.keys(palettes).filter(key => selectedStyle !== "gas"
    || (raw.texture === "hot" ? palettes[key].hot : isIceGiantTexture(raw.texture) ? palettes[key].ice : !palettes[key].hot && !palettes[key].ice));
  const chosenPalette = palettes[paletteKey === "seeded" ? paletteKeys[planetSeedHash(`palette:${seed}`) % paletteKeys.length] : paletteKey];
  let colors = chosenPalette.colors;
  if (selectedStyle === "star") {
    const stellarColors = STELLAR_COLORS[texture];
    colors = { ...colors, surfaceLow: stellarColors[0], surfaceHigh: stellarColors[1], cloud: stellarColors[1] };
  }
  const customColors = raw.customColors === true;
  const gas = selectedStyle === "gas";
  const validHex = value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  let gasColors = chosenPalette.gasColors ?? [];
  if (gas && customColors) {
    const customRamp = Array.isArray(raw.gasColors) ? raw.gasColors.slice(0, 8).filter(validHex).map(value => value.toLowerCase()) : [];
    if (customRamp.length >= 3) gasColors = customRamp;
    else if (validHex(raw.colors?.surfaceLow) && validHex(raw.colors?.surfaceHigh)) {
      // Preserve the intent of older two-color custom recipes on upgrade.
      const low = [1, 3, 5].map(i => parseInt(raw.colors.surfaceLow.slice(i, i + 2), 16));
      const high = [1, 3, 5].map(i => parseInt(raw.colors.surfaceHigh.slice(i, i + 2), 16));
      gasColors = [0, .5, 1].map(t => `#${mix(low, high, t).map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`);
    }
  }
  const noSurface = ["gas", "star", "asteroid", "greenhouse"].includes(selectedStyle);
  const defaultWater = selectedStyle === "ocean" ? 92 : selectedStyle === "terrestrial" ? 62 : selectedStyle === "primordial" ? (raw.texture === "developing" ? 45 : raw.texture === "crust" ? 5 : 0) : cls === "K" ? 3 : 0;
  return {
    version: VERSION,
    seed,
    style: selectedStyle,
    texture,
    palette: paletteKey,
    customColors,
    mineralVariation: ["desert", "barren"].includes(selectedStyle) ? number(raw.mineralVariation, chosenPalette.mineralVariation ?? 0) : 0,
    gasColors,
    hotGlow: number(raw.hotGlow, 65),
    stellarLuminosity: String(raw.stellarLuminosity ?? body.luminosityType ?? "V").slice(0, 8),
    stellarFlares: number(raw.stellarFlares, texture === "T-Tauri" ? 70 : ["L", "T", "Y", "White Dwarf"].includes(texture) ? 0 : 35),
    stellarGlow: number(raw.stellarGlow, texture === "T-Tauri" ? 65 : ["L", "T", "Y"].includes(texture) ? 8 : 35),
    lensFlare: number(raw.lensFlare, 12),
    colors: Object.fromEntries(Object.keys(PLANET_COLOR_LABELS).map(key => [key,
      customColors && /^#[0-9a-f]{6}$/i.test(raw.colors?.[key]) ? raw.colors[key].toLowerCase() : colors[key]])),
    // Older dry-world recipes stored an unused 62% water value. Do not turn
    // those planets into oceans when migrating to the renderer that uses it.
    water: noSurface ? 0 : number(Number(raw.version) < 3 && !["terrestrial", "ocean"].includes(selectedStyle) ? undefined : raw.water, defaultWater),
    mountains: noSurface ? 0 : number(raw.mountains, selectedStyle === "ice" ? 70 : 55),
    craterDensity: ["desert", "barren", "ice"].includes(selectedStyle) ? number(raw.craterDensity, ["cratered", "frozen"].includes(texture) ? 50 : 0) : 0,
    fissureDensity: ["desert", "barren", "ice"].includes(selectedStyle) ? number(raw.fissureDensity, selectedStyle === "ice" ? texture === "fractured" ? 70 : 25 : 0) : 0,
    canyons: noSurface ? 0 : number(raw.canyons, 0),
    impactBasins: noSurface ? 0 : number(raw.impactBasins, 0),
    shieldVolcanoes: noSurface ? 0 : number(raw.shieldVolcanoes, 0),
    rivers: noSurface ? 0 : number(raw.rivers, ["terrestrial", "ocean"].includes(selectedStyle) ? 45 : cls === "K" ? 12 : 0),
    cities: noSurface ? 0 : number(raw.cities, 0),
    cityStyle: Object.hasOwn(PLANET_CITY_STYLES, raw.cityStyle) ? raw.cityStyle : "auto",
    citySize: number(raw.citySize, 55),
    phaseAngle: raw.phaseAngle === undefined || raw.phaseAngle === null || raw.phaseAngle === "" || !Number.isFinite(Number(raw.phaseAngle)) ? 65 : clamp(Number(raw.phaseAngle), 0, 180),
    nightBrightness: Math.min(20, number(raw.nightBrightness, 2)),
    iceCoverage: noSurface ? 0 : selectedStyle === "ice" ? 100 : number(raw.iceCoverage, texture === "seasonal" ? 48 : texture === "frozen" ? 35 : ["terrestrial", "ocean"].includes(selectedStyle) ? 8 : 0),
    cloudStyle: Object.hasOwn(PLANET_CLOUD_STYLES, raw.cloudStyle) ? raw.cloudStyle : "mixed",
    cloudThickness: noSurface ? 0 : number(raw.cloudThickness, 60),
    storminess: noSurface ? 0 : number(raw.storminess, ["terrestrial", "ocean"].includes(selectedStyle) ? 35 : 20),
    hurricanes: noSurface ? 0 : Math.min(8, Math.floor(number(raw.hurricanes, ["terrestrial", "ocean"].includes(selectedStyle) ? 1 : 0))),
    clouds: selectedStyle === "greenhouse" ? 100 : ["star", "asteroid"].includes(selectedStyle) ? 0 : number(raw.clouds, ["terrestrial", "ocean"].includes(selectedStyle) ? 42 : 0),
    rings: ["star", "asteroid"].includes(selectedStyle) ? false : typeof raw.rings === "boolean" ? raw.rings : String(body.rings).toLowerCase() === "yes",
    ringStyle: Object.hasOwn(RING_STYLES, raw.ringStyle) ? raw.ringStyle : "icy",
    ringDensity: number(raw.ringDensity, 85),
    ringColor: /^#[0-9a-f]{6}$/i.test(raw.ringColor) ? raw.ringColor.toLowerCase()
      : raw.ringStyle === "dusty" ? "#84745e" : raw.ringStyle === "narrow" ? "#a8aaa5" : "#cbbfa6",
    axialTilt: raw.axialTilt === undefined || !Number.isFinite(Number(raw.axialTilt)) ? 23.5 : clamp(Number(raw.axialTilt), 0, 180),
    resolution: PLANET_RESOLUTIONS.includes(Number(raw.resolution)) ? Number(raw.resolution) : 2048,
  };
}

function noiseFactory(seed) {
  const hash = (x, y, z) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1442695041) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  return (x, y, z) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const u = smooth(x - ix), v = smooth(y - iy), w = smooth(z - iz);
    return lerp(
      lerp(lerp(hash(ix, iy, iz), hash(ix + 1, iy, iz), u), lerp(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), u), v),
      lerp(lerp(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), u), lerp(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), u), v), w);
  };
}

/** Convert a visible sphere point into the planet's fixed surface coordinates.
 * The information portrait looks from 20 degrees above the equator. Scene
 * cameras look down the orbital normal, offset from the pole by axial tilt.
 */
export function planetSurfacePoint(x, y, z, inclination) {
  return { x, y: -y * Math.sin(inclination) + z * Math.cos(inclination),
    z: y * Math.cos(inclination) + z * Math.sin(inclination) };
}

const terrainCache = new Map();

/** View-independent elevations and downhill drainage shared by both textures. */
export function createPlanetTerrain(recipe) {
  const r = normalizePlanetRecipe(recipe);
  const key = JSON.stringify([r.seed, r.style, r.texture, r.water, r.rivers, r.canyons, r.impactBasins, r.shieldVolcanoes]);
  if (terrainCache.has(key)) return terrainCache.get(key);
  const noise = noiseFactory(planetSeedHash(r.seed));
  const fbm = (x, y, z, octaves = 6) => {
    let value = 0, amplitude = .5, total = 0;
    for (let octave = 0; octave < octaves; octave++) {
      value += noise(x, y, z) * amplitude;
      total += amplitude;
      x = x * 2.03 + 13.1; y = y * 2.03 + 7.7; z = z * 2.03 + 5.3;
      amplitude *= .48;
    }
    return value / total;
  };
  const scale = { archipelago: 6, supercontinent: 1.8, badlands: 4.8, dunes: 2.6, rocky: 5, fractured: 4.5 }[r.texture] ?? 3.2;
  const warp = r.texture === "smooth" ? .3 : r.texture === "turbulent" ? 2 : 1.2;
  const baseElevation = (x, y, z) => fbm(
    x * scale + (noise(x * 2 + 91, y * 2 + 41, z * 2 + 13) - .5) * warp + 11,
    y * scale + (noise(x * 2 + 17, y * 2 + 71, z * 2 + 53) - .5) * warp + 19,
    z * scale + (noise(x * 2 + 43, y * 2 + 11, z * 2 + 89) - .5) * warp + 7);
  const geology = createPlanetGeology(r, noise);
  const surfaceAt = (x, y, z) => {
    const landform = geology?.sample(x, y, z);
    const base = baseElevation(x, y, z);
    return { elevation: landform ? base + (.5 - base) * landform.flatten + landform.delta : base, landform };
  };
  const elevation = geology ? (x, y, z) => surfaceAt(x, y, z).elevation : baseElevation;
  // Calibrate the sea level over the whole sphere. Even 3% water then has
  // actual basins, rather than a fixed threshold which may yield no water.
  let seaLevel = r.water === 100 ? 2 : -1;
  if (r.water > 0 && r.water < 100) {
    const samples = Array.from({ length: 2048 }, (_, i) => {
      const y = 1 - (i + .5) / 1024;
      const radius = Math.sqrt(1 - y * y), angle = i * Math.PI * (3 - Math.sqrt(5));
      return elevation(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    }).sort((a, b) => a - b);
    seaLevel = samples[Math.floor(r.water / 100 * (samples.length - 1))];
  }
  const drainage = r.rivers > 0 && r.water > 0 && r.water < 100
    ? buildDrainage(elevation, seaLevel, r.rivers) : null;
  const terrain = { noise, fbm, elevation, surfaceAt, geology, seaLevel, drainage,
    riverAt: (x, y, z) => drainage ? riverCoverage(drainage, x, y, z) : 0 };
  if (terrainCache.size >= 4) terrainCache.delete(terrainCache.keys().next().value);
  terrainCache.set(key, terrain);
  return terrain;
}

function buildDrainage(elevation, sea, density) {
  const width = 192, height = 96, count = width * height;
  const heights = new Float32Array(count), flow = new Float32Array(count).fill(1);
  const next = new Int32Array(count).fill(-1), dx = new Int8Array(count), dy = new Int8Array(count);
  for (let y = 0; y < height; y++) {
    const lat = (.5 - (y + .5) / height) * Math.PI, radius = Math.cos(lat);
    for (let x = 0; x < width; x++) {
      const lon = ((x + .5) / width - .5) * Math.PI * 2;
      heights[y * width + x] = elevation(Math.cos(lon) * radius, Math.sin(lat), Math.sin(lon) * radius);
    }
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (heights[i] <= sea) continue;
    const longitudeScale = Math.max(.05, Math.cos((.5 - (y + .5) / height) * Math.PI));
    let steepest = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if ((!ox && !oy) || y + oy < 0 || y + oy >= height) continue;
      const j = (y + oy) * width + (x + ox + width) % width;
      const slope = (heights[i] - heights[j]) / Math.hypot(ox * longitudeScale, oy);
      if (slope > steepest) { steepest = slope; next[i] = j; dx[i] = ox; dy[i] = oy; }
    }
  }
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => heights[b] - heights[a]);
  for (const i of order) if (next[i] >= 0) flow[next[i]] += flow[i];
  return { width, height, heights, flow, next, dx, dy, threshold: 100 - density * .85 };
}

function riverCoverage(d, x, y, z) {
  const gx = (Math.atan2(z, x) / (Math.PI * 2) + .5) * d.width - .5;
  const gy = (.5 - Math.asin(clamp(y, -1, 1)) / Math.PI) * d.height - .5;
  let coverage = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = Math.round(gx) + ox, cy = Math.round(gy) + oy;
    if (cy < 0 || cy >= d.height) continue;
    const i = cy * d.width + (cx + d.width) % d.width;
    if (d.next[i] < 0 || d.flow[i] < d.threshold) continue;
    const px = gx - cx, py = gy - cy;
    const t = clamp((px * d.dx[i] + py * d.dy[i]) / (d.dx[i] ** 2 + d.dy[i] ** 2), 0, 1);
    const distance = Math.hypot(px - t * d.dx[i], py - t * d.dy[i]);
    const width = Math.min(.22, .055 + Math.log2(d.flow[i] / d.threshold) * .025);
    coverage = Math.max(coverage, clamp((width + .035 - distance) / .07, 0, 1));
  }
  return coverage;
}

const rgb = hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));

function* planetPixelRows(recipe, requestedSize, { view = "portrait" } = {}) {
  const r = normalizePlanetRecipe(recipe);
  const size = clamp(Math.round(Number(requestedSize) || 512), 32, 4096);
  if (["star", "asteroid"].includes(r.style)) return yield* celestialPixelRows(r, size, createPlanetTerrain(r), { view });
  const pixels = new Uint8ClampedArray(size * size * 4);
  const terrain = createPlanetTerrain(r);
  const ice = createPlanetIce(r, terrain);
  const cities = createPlanetCities(r, terrain, ice);
  const weather = !["gas", "greenhouse"].includes(r.style) && r.clouds > 0 ? createPlanetWeather(r, terrain, ice) : null;
  const { noise, fbm, seaLevel: sea } = terrain;
  const colors = Object.fromEntries(Object.entries(r.colors).map(([key, value]) => [key, rgb(value)]));
  const deepWater = colors.ocean.map(v => v * .28), shallowWater = mix(colors.ocean, colors.ice, .12);
  const inclination = (view === "scene" ? r.axialTilt : 70) * Math.PI / 180;
  const sin = Math.sin(inclination), cos = Math.cos(inclination);
  const ringAspect = Math.max(Math.abs(cos), 1 / (size * .48));
  const bodyScale = r.rings ? RING_BODY_SCALE : 1;
  const radius = size * .48 * bodyScale;
  const center = size / 2;
  const habitable = ["terrestrial", "ocean"].includes(r.style);
  const envelope = r.style === "greenhouse";
  const atmosphere = habitable || r.style === "gas" || envelope || r.clouds > 0;
  const gas = r.style === "gas" ? createGasGiantMaterial(r, terrain, colors) : null;
  const greenhouse = envelope ? createGreenhouseClouds(r, terrain, colors) : null;
  const groundMaterial = gas || envelope ? null : createSolidSurfaceMaterial(r, terrain, colors);
  const sourceLight = planetLightDirection(r);
  const bodyLight = planetSurfacePoint(0, sourceLight.y, sourceLight.z, inclination);
  const rings = r.rings ? createRingMaterial(r, noise) : null;
  const hazeColor = gas || envelope || r.style === "primordial" ? mix(colors.surfaceHigh, colors.cloud, .45) : [53, 115, 193];
  const incidence = -sin * sourceLight.y + cos * sourceLight.z;
  // Density adds impacts to the same seeded layout, without moving existing
  // craters or rerolling the underlying terrain. Legacy cratered textures use 50.
  const craters = Array.from({ length: Math.round(r.craterDensity * 2) }, (_, i) => {
    const angle = noise(i, 91, 37) * Math.PI * 2;
    const y = noise(i, 83, 61) * 2 - 1;
    const distance = Math.sqrt(1 - y * y);
    const radius = .012 + noise(i, 53, 47) ** 3 * .16;
    return { x: Math.cos(angle) * distance, y, z: Math.sin(angle) * distance, radius, radius2: (radius * 1.2) ** 2 };
  });
  // Only consider craters intersecting the sample's octant, including edges.
  const craterBins = Array.from({ length: 8 }, (_, octant) => craters.filter(c =>
    [c.x, c.y, c.z].every((v, axis) => (octant & (1 << axis) ? v : -v) >= -c.radius * 1.2)));
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + .5 - center) / radius, y = (py + .5 - center) / radius;
      const d2 = x * x + y * y;
      const i = (py * size + px) * 4;
      let color = [0, 0, 0], alpha = 0;
      if (d2 <= 1) {
        const z = Math.sqrt(1 - d2);
        // Rotate the sampling coordinates, leaving screen-space light fixed.
        const sx = x, sy = -y * sin + z * cos, sz = y * cos + z * sin;
        const surface = gas || envelope ? null : terrain.surfaceAt(sx, sy, sz);
        const n = surface?.elevation ?? .5;
        const fine = gas || envelope ? .5 : .5 + (fbm(sx * 24 + 5, sy * 24 + 9, sz * 24 + 3, 3) - .5) * (1 - (surface?.landform?.flatten ?? 0) * .9);
        const wet = r.style !== "gas" && n < sea;
        let gasEmission = null, lava = 0, ground = null;
        if (r.style === "gas") {
          const surface = gas.sampleSurface(sx, sy, sz);
          color = surface.color;
          gasEmission = surface.emission;
        } else if (envelope) {
          color = greenhouse.sample(sx, sy, sz);
        } else if (!wet) {
          ground = groundMaterial.sample(sx, sy, sz, n, fine, surface.landform, bodyLight, 1 / (radius * Math.max(.15, z)));
          color = ground.color.map(v => v * ground.shade);
          lava = ground.lava;
        }
        const octant = (sx >= 0 ? 1 : 0) | (sy >= 0 ? 2 : 0) | (sz >= 0 ? 4 : 0);
        for (const crater of craterBins[octant]) {
          const dx = sx - crater.x, dy = sy - crater.y, dz = sz - crater.z;
          const distance2 = dx * dx + dy * dy + dz * dz;
          if (distance2 >= crater.radius2) continue;
          const distance = Math.sqrt(distance2) / crater.radius;
          const rim = Math.exp(-(((distance - 1) * 10) ** 2));
          const bowl = distance < 1 ? (1 - distance * distance) ** 2 : 0;
          const slope = (distance < 1 ? distance * (1 - distance * distance) : 0) - 14 * (distance - 1) * rim;
          const towardLight = (dx * bodyLight.x + dy * bodyLight.y + dz * bodyLight.z) / Math.max(.001, crater.radius * distance);
          // Lit and shaded bowl walls replace the uniformly bright circular
          // outline. Dusty ejecta tint the rim without making it luminous.
          const craterShade = clamp(1 - bowl * .10 - towardLight * slope * .55, .6, 1.3);
          color = mix(color, colors.surfaceHigh, rim * .045).map(v => v * craterShade);
        }
        if (r.style !== "gas" && !wet) {
          if (terrain.drainage) color = mix(color, shallowWater, terrain.riverAt(sx, sy, sz) * .85);
        }
        if (wet) {
          const shelf = clamp(1 - (sea - n) / .075, 0, 1);
          color = mix(deepWater, shallowWater, shelf * shelf);
        }
        const iceCover = ice.sample(sx, sy, sz, n);
        // Solid ice textures already have their own fractures/craters. Mixed
        // biomes get a separate snow and sea-ice layer over their terrain.
        if (iceCover && r.style !== "ice") color = mix(color, colors.ice.map(v => v * (.98 + (fine - .5) * .04) * (ground?.shade ?? 1)), iceCover);
        const cloud = weather?.sample(sx, sy, sz, bodyLight);
        const cloudCover = cloud?.alpha ?? 0;
        // Light faces the top of the texture, independently of the planet's pole.
        const lightDot = sourceLight.y * y + sourceLight.z * z;
        const light = planetIllumination(r, lightDot, z);
        const ringTransmission = rings ? ringSurfaceTransmission(rings, x * bodyScale, y * bodyScale, z * bodyScale, sin, cos, 2 / size, sourceLight) : 1;
        color = color.map(v => v * light * (.12 + .88 * ringTransmission) * (1 - (cloud?.shadow ?? 0) * Math.max(0, lightDot)));
        // Thermal glow remains visible in shadow; screen blending retains
        // color and cloud detail instead of clipping bright channels to white.
        if (gasEmission) color = color.map((v, k) => v + (255 - v) * gasEmission[k] / 255);
        if (lava && !wet) color = color.map((v, k) => Math.min(255, v + [255, 105, 22][k] * lava * .4 * (1 - iceCover)));
        if (r.texture === "frozen") color = color.map(v => v * .65);
        if (cities && lightDot < .15) {
          const emission = cities.sample(sx, sy, sz, n, iceCover, lightDot, 1 / (radius * Math.max(.15, z)));
          color = color.map((v, k) => Math.min(255, v + colors.city[k] * emission));
        }
        if (cloudCover) color = mix(color, colors.cloud.map(v => v * cloud.shade * light * (.12 + .88 * ringTransmission)), cloudCover);
        if (atmosphere) color = mix(color, hazeColor.map(v => v * light), Math.pow(1 - z, 3) * (gas ? .18 : .4));
        alpha = clamp((1 - Math.sqrt(d2)) * radius, 0, 1);
      } else if (atmosphere && d2 < 1.045) {
        color = gas || envelope ? hazeColor : [73, 145, 222];
        const limbLight = r.nightBrightness / 100 + (1 - r.nightBrightness / 100) * Math.max(0, sourceLight.y * y / Math.sqrt(d2));
        alpha = (1 - (d2 - 1) / .045) * (gas || envelope ? .08 : .28) * limbLight;
      }
      // Project the equatorial ring plane using the same axis as the surface.
      if (rings) {
        const rx = (px + .5 - center) / (size * .48);
        const screenY = (py + .5 - center) / (size * .48);
        const ry = screenY / ringAspect;
        const rr = Math.hypot(rx, ry);
        // A minimum pixel-thick projection gives edge-on rings finite coverage.
        const ringZ = ry * sin * (cos < 0 ? -1 : 1);
        const sphereZ = Math.sqrt(Math.max(0, bodyScale ** 2 - rx * rx - screenY * screenY));
        if (rr > .60 && rr < 1.01 && (d2 > 1 || ringZ > sphereZ)) {
          const footprint = .5 * Math.hypot(rx / rr, ry / (rr * ringAspect)) / (size * .48);
          const tau = rings.opticalDepth(rr, footprint);
          if (tau > 0) {
            const ringAlpha = 1 - Math.exp(-tau / Math.max(.10, Math.abs(cos)));
            const a = ringAlpha + alpha * (1 - ringAlpha);
            const illumination = (.30 + .70 * Math.sqrt(Math.abs(incidence))) * (incidence * cos < 0 ? .52 : 1);
            const shadow = ringPlanetShadow(rx, screenY, ringZ, bodyScale, sourceLight);
            const ring = rings.colorAt(rr).map(v => v * illumination * shadow);
            color = color.map((v, k) => (ring[k] * ringAlpha + v * alpha * (1 - ringAlpha)) / a);
            alpha = a;
          }
        }
      }
      pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = alpha * 255;
    }
    // High-resolution rendering can cooperate with the UI, eight rows at a time.
    if (py % 8 === 7) yield (py + 1) / size;
  }
  return { width: size, height: size, pixels };
}

/** Pure synchronous renderer for previews and regression tests. */
export function renderPlanetPixels(recipe, requestedSize = 512, options = {}) {
  const rows = planetPixelRows(recipe, requestedSize, options);
  let step;
  do { step = rows.next(); } while (!step.done);
  return step.value;
}

export async function renderPlanetPixelsAsync(recipe, requestedSize = 512, options = {}) {
  const rows = planetPixelRows(recipe, requestedSize, options);
  let step;
  while (!(step = rows.next()).done) await new Promise(resolve => setTimeout(resolve, 0));
  return step.value;
}

function pixelsToCanvas(rendered) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = rendered.width;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable.");
  context.putImageData(new ImageData(rendered.pixels, rendered.width, rendered.height), 0, 0);
  return canvas;
}

function planetCanvas(recipe, size, options = {}) {
  return pixelsToCanvas(renderPlanetPixels(recipe, size, options));
}

export function isProceduralPlanet(body) {
  return !!body?.procedural && String(body?.image ?? "").includes("sta2e-procedural-");
}

export function proceduralSceneImageIsCurrent(body) {
  if (!isProceduralPlanet(body) || !body.sceneImage || body.sceneImageSource !== body.image) return false;
  const hash = planetSeedHash(JSON.stringify(normalizePlanetRecipe(body.procedural, body))).toString(16);
  return body.sceneImage.endsWith(`-${hash}-scene.webp`);
}

/** A separately supplied portrait invalidates its old procedural map texture. */
export function planetSceneImage(body) {
  return String(body?.sceneImage && body.sceneImageSource === body.image ? body.sceneImage : body?.image ?? "").trim();
}

/** Old configured composites use 68%; new wider rings leave a 54% globe. */
export function planetSceneBodyScale(body) {
  if (body?.sceneImage && body.sceneImageSource === body.image && Number(body.sceneBodyScale) > 0) return clamp(Number(body.sceneBodyScale), .3, 1);
  if (String(body?.rings).trim().toLowerCase() !== "yes") return 1;
  if (isProceduralPlanet(body)) {
    try { if (JSON.parse(body.procedural).version >= 4) return RING_BODY_SCALE; } catch { /* Legacy custom art. */ }
  }
  return .68;
}

export async function saveProceduralPlanetImage(body, actorId, recipe, { sceneOnly = false } = {}) {
  if (!game.user?.isGM) throw new Error("Only the GM can generate body artwork.");
  const normalized = normalizePlanetRecipe(recipe, body);
  const safe = value => String(value).replace(/[^A-Za-z0-9_-]/g, "");
  if (!safe(actorId) || !safe(body.id)) throw new Error("A saved system and body are required.");
  const hash = planetSeedHash(JSON.stringify(normalized)).toString(16);
  // Immutable recipe filenames preserve art in scenes already created from a prior seed.
  const stem = `sta2e-procedural-${safe(actorId)}-${safe(body.id)}-${hash}`;
  const FP = foundry.applications.apps.FilePicker.implementation;
  const dir = `worlds/${game.world.id}/sta2e-procedural-planets`;
  try { await FP.createDirectory("data", dir); } catch { /* Upload reports inaccessible directories. */ }
  const uploadView = async view => {
    const canvas = pixelsToCanvas(await renderPlanetPixelsAsync(normalized, normalized.resolution, { view }));
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", .98));
    canvas.width = canvas.height = 0; // Release the backing store before the next view.
    if (!blob) throw new Error("Could not encode the body image.");
    const result = await FP.upload("data", dir, new File([blob], `${stem}-${view}.webp`, { type: "image/webp" }), {}, { notify: false });
    if (!result?.path) throw new Error("Artwork upload failed. Check the world's file upload permissions.");
    return result.path;
  };
  const image = sceneOnly ? body.image : await uploadView("portrait");
  const sceneImage = await uploadView("scene");
  return {
    ...(sceneOnly ? {} : { image, procedural: JSON.stringify(normalized), rings: normalized.rings ? "Yes" : "No" }),
    sceneImage, sceneImageSource: image, sceneBodyScale: normalized.style === "star" ? .72 : normalized.style === "asteroid" ? .85 : normalized.rings ? RING_BODY_SCALE : 1,
  };
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Returns artwork only on Apply; Cancel never uploads or changes the actor. */
export async function promptProceduralPlanet(body, actorId) {
  const initial = normalizePlanetRecipe(body.procedural || {}, body);
  let result = null;
  const read = root => normalizePlanetRecipe({
    seed: root.querySelector('[name="seed"]').value,
    style: root.querySelector('[name="style"]').value,
    texture: root.querySelector('[name="texture"]').value,
    palette: root.querySelector('[name="palette"]').value,
    customColors: root.querySelector('[name="customColors"]').checked,
    mineralVariation: root.querySelector('[name="mineralVariation"]').value,
    gasColors: Array.from({ length: Number(root.querySelector('[name="gasColorCount"]').value) }, (_, i) => root.querySelector(`[name="gasColor-${i}"]`).value),
    hotGlow: root.querySelector('[name="hotGlow"]').value,
    colors: Object.fromEntries(Object.keys(PLANET_COLOR_LABELS).map(key => [key, root.querySelector(`[name="color-${key}"]`).value])),
    water: root.querySelector('[name="water"]').value,
    mountains: root.querySelector('[name="mountains"]').value,
    craterDensity: root.querySelector('[name="craterDensity"]').value,
    fissureDensity: root.querySelector('[name="fissureDensity"]').value,
    canyons: root.querySelector('[name="canyons"]').value,
    impactBasins: root.querySelector('[name="impactBasins"]').value,
    shieldVolcanoes: root.querySelector('[name="shieldVolcanoes"]').value,
    rivers: root.querySelector('[name="rivers"]').value,
    cities: root.querySelector('[name="cities"]').value,
    cityStyle: root.querySelector('[name="cityStyle"]').value,
    citySize: root.querySelector('[name="citySize"]').value,
    phaseAngle: root.querySelector('[name="phaseAngle"]').value,
    nightBrightness: root.querySelector('[name="nightBrightness"]').value,
    clouds: root.querySelector('[name="clouds"]').value,
    iceCoverage: root.querySelector('[name="iceCoverage"]').value,
    cloudStyle: root.querySelector('[name="cloudStyle"]').value,
    cloudThickness: root.querySelector('[name="cloudThickness"]').value,
    storminess: root.querySelector('[name="storminess"]').value,
    hurricanes: root.querySelector('[name="hurricanes"]').value,
    rings: root.querySelector('[name="rings"]').checked,
    ringStyle: root.querySelector('[name="ringStyle"]').value,
    ringDensity: root.querySelector('[name="ringDensity"]').value,
    ringColor: root.querySelector('[name="ringColor"]').value,
    axialTilt: root.querySelector('[name="axialTilt"]').value,
    resolution: root.querySelector('[name="resolution"]').value,
    stellarLuminosity: initial.stellarLuminosity,
    stellarFlares: root.querySelector('[name="stellarFlares"]').value,
    stellarGlow: root.querySelector('[name="stellarGlow"]').value,
    lensFlare: root.querySelector('[name="lensFlare"]').value,
  }, body);
  await foundry.applications.api.DialogV2.wait({
    modal: true,
    window: { title: `Procedural Body — ${body.name || body.role || "Unnamed body"}` },
    position: { width: 640 },
    content: `<div class="sta2e-planet-generator">
      <div class="sta2e-planet-previews">
        <figure><div data-planet-preview="portrait" role="img" aria-label="Side view for information"></div><figcaption>Information • Side view</figcaption></figure>
        <figure><div data-planet-preview="scene" role="img" aria-label="Polar view for scene maps"></div><figcaption>Scene map • Polar / tilted view</figcaption></figure>
      </div>
      <p>Two views of the same body. The seed and controls reproduce its surface, atmosphere, and shape.</p>
      <p data-celestial-help></p>
      <label>Seed <input name="seed" maxlength="128" value="${escapeHtml(initial.seed)}"></label>
      <button type="button" data-new-seed><i class="fas fa-dice"></i> New seed</button>
      <label>Appearance <select name="style">${Object.entries(PLANET_STYLES).map(([key, label]) => `<option value="${key}" ${key === initial.style ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <details open><summary>Colors and texture</summary><div class="sta2e-planet-options">
        <label>Texture <select name="texture"></select></label>
        <label>Palette <select name="palette"></select></label>
        <label><input name="customColors" type="checkbox" ${initial.customColors ? "checked" : ""}> Customize colors</label>
        <div data-gas-options>
          <label>Cloud colors <select name="gasColorCount">${[3, 4, 5, 6, 7, 8].map(count => `<option value="${count}" ${count === (initial.gasColors.length || 6) ? "selected" : ""}>${count} colors</option>`).join("")}</select></label>
          <div class="sta2e-planet-colors">${Array.from({ length: 8 }, (_, i) => `<label data-gas-color="${i}">Cloud color ${i + 1}<input type="color" name="gasColor-${i}" value="${initial.gasColors[i] ?? "#fff3df"}"></label>`).join("")}</div>
          <p>Colors blend in order through dark belts, middle clouds, and bright zones. Enable Customize colors to choose 3–8 colors.</p>
          <label data-hot-glow>Cloud glow <input name="hotGlow" type="range" min="0" max="100" value="${initial.hotGlow}"><output data-value-for="hotGlow"></output></label>
          <p data-hot-help>Hot Jupiter adds a stylized fire / plasma appearance with glowing plumes and filaments. Try Ember, Plasma, or Stellar palettes. Glow at 0 uses reflected light only.</p>
          <p data-ice-help>Ice giants show atmospheric haze, subdued bands, and pale clouds. Hazy gives a calmer Uranus-inspired appearance; Stormy adds darker vortices and bright companion clouds. Try the Uranus, Neptune, or Cold teal palettes.</p>
        </div>
        <div class="sta2e-planet-colors">${Object.entries(PLANET_COLOR_LABELS).map(([key, label]) => `<label>${label}<input type="color" name="color-${key}" value="${initial.colors[key]}"></label>`).join("")}</div>
        <p data-solid-help>Water can be blue, green, purple, or any custom color. For volcanic worlds it also colors lava.</p>
        <div data-mineral-options>
          <label>Rock / mineral variation <input name="mineralVariation" type="range" min="0" max="100" value="${initial.mineralVariation}"><output data-value-for="mineralVariation"></output></label>
          <p>Mix exposed rock and pale or colored mineral deposits with the soil and dust colors. 0 keeps the base soil palette; higher values reveal stronger regional contrasts. Try Mars, Mesa, Mineral desert, Lunar, or Iron-rich. Enable Customize colors to edit Exposed rock and Mineral deposits. Colors preserve the terrain and landform positions.</p>
        </div>
      </div></details>
      <details data-star-options open><summary>Solar flares and glow</summary><div class="sta2e-planet-options">
        <label>Solar flares <input name="stellarFlares" type="range" min="0" max="100" value="${initial.stellarFlares}"><output data-value-for="stellarFlares"></output></label>
        <label>Corona / glow <input name="stellarGlow" type="range" min="0" max="100" value="${initial.stellarGlow}"><output data-value-for="stellarGlow"></output></label>
        <label>Lens flare <input name="lensFlare" type="range" min="0" max="100" value="${initial.lensFlare}"><output data-value-for="lensFlare"></output></label>
        <p>Solar flares form bright loops anchored to the star. Glow adds a soft halo; lens flare adds subtle camera streaks. Each can be turned off at 0. These effects are baked into the artwork.</p>
      </div></details>
      <details><summary>Surface, water, and civilization</summary><div class="sta2e-planet-options">
        <label>Surface water <input name="water" type="range" min="0" max="100" value="${initial.water}"><output data-value-for="water"></output></label>
        <label>Ice coverage <input name="iceCoverage" type="range" min="0" max="100" value="${initial.iceCoverage}"><output data-value-for="iceCoverage"></output></label>
        <p>Ice coverage is the approximate fraction of the whole surface frozen, including sea ice. It grows from the poles and favors high terrain. 0 removes snow and ice from mixed biomes; 100 freezes the surface. For mixed ice and exposed terrain, use a terrestrial, ocean, desert, or rocky appearance; the Ice appearance remains entirely icy.</p>
        <label>Mountains <input name="mountains" type="range" min="0" max="100" value="${initial.mountains}"><output data-value-for="mountains"></output></label>
        <label data-crater-control>Crater density <input name="craterDensity" type="range" min="0" max="100" value="${initial.craterDensity}"><output data-value-for="craterDensity"></output></label>
        <p data-crater-help>Desert, barren, and icy worlds can mix impact craters with any terrain texture. 0 removes craters; higher values add more to the same landscape. For a Mars-like Class-K world, try Desert, Badlands, the Mars palette, and 30–60 crater density with low cloud cover.</p>
        <label>River density <input name="rivers" type="range" min="0" max="100" value="${initial.rivers}"><output data-value-for="rivers"></output></label>
        <label>City lights <input name="cities" type="range" min="0" max="100" value="${initial.cities}"><output data-value-for="cities"></output></label>
        <div data-city-options>
          <label>Settlement layout <select name="cityStyle">${Object.entries(PLANET_CITY_STYLES).map(([key, label]) => `<option value="${key}" ${initial.cityStyle === key ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          <label>Settlement size <input name="citySize" type="range" min="0" max="100" value="${initial.citySize}"><output data-value-for="citySize"></output></label>
          <p>Automatic uses domed colonies on barren and ice worlds, and organic city clusters elsewhere. Linked circular cities have small central rings, radial avenues, large outer rings, and illuminated routes joining nearby cities. Planned grids, circular cities, and domes use discrete settlements; Size controls their visible footprint. Domes and circular layouts can occupy frozen terrain, including solid sea ice. Linked routes avoid open water. Lights fade in daylight and beneath clouds; settlements are exaggerated for visibility from orbit.</p>
        </div>
        <p>Water fills low basins on solid worlds; Class-K defaults to traces (3%). Rivers need water and follow downhill paths. City lights appear on land near the night side and are off at 0; this does not change the population record.</p>
      </div></details>
      <details data-geology-options open><summary>Canyons and landforms</summary><div class="sta2e-planet-options">
        <div data-fissure-options>
          <label>Fissure density <input name="fissureDensity" type="range" min="0" max="100" value="${initial.fissureDensity}"><output data-value-for="fissureDensity"></output></label>
          <p>Add narrow cracks with dark interiors and subtle raised edges to desert, barren, and icy worlds. 0 removes fissures, including the cracks in Fractured ice; higher values add more to the same seeded pattern. These fine surface markings do not change elevation or river routes. Water, snow cover, and clouds can hide them.</p>
        </div>
        <label>Canyon strength <input name="canyons" type="range" min="0" max="100" value="${initial.canyons}"><output data-value-for="canyons"></output></label>
        <label>Impact basins <input name="impactBasins" type="range" min="0" max="100" value="${initial.impactBasins}"><output data-value-for="impactBasins"></output></label>
        <label>Shield volcanoes <input name="shieldVolcanoes" type="range" min="0" max="100" value="${initial.shieldVolcanoes}"><output data-value-for="shieldVolcanoes"></output></label>
        <p>Add branching chasms, broad depressed basins with raised rims, and wide volcanic mountains with summit calderas. 0 disables a feature; higher values strengthen its relief without moving it. Landforms change elevations, water basins, and river routes. Water, ice, and clouds can hide them. Volcanoes here represent solid mountains, without glowing lava.</p>
        <p>For a Mars-like Class-K, try Badlands with the Mars palette, Canyon strength 65, Impact basins 45, Shield volcanoes 40, and Crater density 30. Use low water and cloud cover to expose the geology. Features are exaggerated for visibility from space.</p>
      </div></details>
      <details data-weather-options open><summary>Clouds and weather</summary><div class="sta2e-planet-options">
        <label>Cloud pattern <select name="cloudStyle">${Object.entries(PLANET_CLOUD_STYLES).map(([key, label]) => `<option value="${key}" ${key === initial.cloudStyle ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label>Cloud cover <input name="clouds" type="range" min="0" max="100" value="${initial.clouds}"><output data-value-for="clouds"></output></label>
        <label>Cloud thickness <input name="cloudThickness" type="range" min="0" max="100" value="${initial.cloudThickness}"><output data-value-for="cloudThickness"></output></label>
        <label>Storminess <input name="storminess" type="range" min="0" max="100" value="${initial.storminess}"><output data-value-for="storminess"></output></label>
        <label>Hurricane systems <input name="hurricanes" type="range" min="0" max="8" step="1" value="${initial.hurricanes}"><output data-value-for="hurricanes"></output></label>
        <p>Mix low cloud decks, thin high clouds, and bright storm towers with soft ground shadows. Thickness controls opacity; storminess adds convective clouds. Cover or thickness at 0 clears all clouds. Hurricanes have eyes and spiral bands and need unfrozen tropical water; a world may support fewer than requested. Weather is a static artistic snapshot, shared by both views.</p>
      </div></details>
      <details data-planet-lighting-options><summary>Sunlight and shadow</summary><div class="sta2e-planet-options">
        <label>Sun angle <input name="phaseAngle" type="range" min="0" max="180" value="${initial.phaseAngle}"><output data-value-for="phaseAngle"></output></label>
        <label>Night-side brightness <input name="nightBrightness" type="range" min="0" max="20" value="${initial.nightBrightness}"><output data-value-for="nightBrightness"></output></label>
        <p>Sun angle controls the visible day/night split: 0° is fully lit, 90° is half lit, and higher angles form a crescent. The default 65° exposes a broader night side. Night-side brightness adds faint surface visibility; 0 gives an unlit surface. City lights and thermal glow remain visible in darkness. Lighting, clouds, and ring shadows share the same sun direction in both views.</p>
      </div></details>
      <details><summary>Rings, view, and export quality</summary><div class="sta2e-planet-options">
      <label><input name="rings" type="checkbox" ${initial.rings ? "checked" : ""}> Planetary rings</label>
      <label>Ring structure <select name="ringStyle">${Object.entries(RING_STYLES).map(([key, label]) => `<option value="${key}" ${initial.ringStyle === key ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label>Ring density <input name="ringDensity" type="range" min="0" max="100" value="${initial.ringDensity}"><output data-value-for="ringDensity"></output></label>
      <label>Ring color <input name="ringColor" type="color" value="${initial.ringColor}"></label>
      <label>Axial tilt (scene view) <input name="axialTilt" type="number" min="0" max="180" step="0.5" value="${initial.axialTilt}">°</label>
      <p>0° looks straight down the north pole; 90° looks along the equator; 180° looks down the south pole. The information portrait keeps its side view.</p>
      <label>Texture quality <select name="resolution">${PLANET_RESOLUTIONS.map(size => `<option value="${size}" ${initial.resolution === size ? "selected" : ""}>${size / 1024}K (${size} × ${size})${size === 2048 ? " — recommended" : ""}</option>`).join("")}</select></label>
      <p>Previews use reduced resolution. 4K takes longer and uses more texture memory; exported artwork includes the full surface detail.</p>
      </div></details>
      <p>Appearance controls change artwork; planet classification and survey details remain editable on the sheet.</p>
    </div>`,
    render: (_event, dialog) => {
      const root = dialog.element;
      const populateChoices = recipe => {
        root.querySelector('[name="texture"]').innerHTML = Object.entries(PLANET_TEXTURES[recipe.style]).map(([key, label]) => `<option value="${key}" ${key === recipe.texture ? "selected" : ""}>${label}</option>`).join("");
        root.querySelector('[name="palette"]').innerHTML = `<option value="seeded" ${recipe.palette === "seeded" ? "selected" : ""}>Seeded variation</option>` + Object.entries(PLANET_PALETTES[recipe.style]).map(([key, value]) => `<option value="${key}" ${key === recipe.palette ? "selected" : ""}>${value.label}</option>`).join("");
      };
      const preview = () => {
        const recipe = read(root);
        const gas = recipe.style === "gas", hot = gas && recipe.texture === "hot";
        const stellar = recipe.style === "star", asteroid = recipe.style === "asteroid", envelope = recipe.style === "greenhouse";
        const noSurface = gas || stellar || asteroid || envelope;
        root.querySelector('[data-city-options]').hidden = noSurface;
        root.querySelector('[name="cityStyle"]').disabled = noSurface || !recipe.cities;
        const plannedCities = recipe.cityStyle === "auto" ? ["barren", "ice"].includes(recipe.style) : recipe.cityStyle !== "organic";
        root.querySelector('[name="citySize"]').disabled = noSurface || !recipe.cities || !plannedCities;
        root.querySelector('[data-value-for="citySize"]').textContent = `${recipe.citySize}`;
        root.querySelector('[data-planet-lighting-options]').hidden = stellar || asteroid;
        for (const key of ["phaseAngle", "nightBrightness"]) {
          root.querySelector(`[name="${key}"]`).disabled = stellar || asteroid;
          root.querySelector(`[data-value-for="${key}"]`).textContent = `${recipe[key]}${key === "phaseAngle" ? "°" : "%"}`;
        }
        root.querySelector('[name="iceCoverage"]').disabled = noSurface || recipe.style === "ice";
        root.querySelector('[data-value-for="iceCoverage"]').textContent = `${recipe.iceCoverage}%`;
        const crateredSurface = ["desert", "barren", "ice"].includes(recipe.style);
        root.querySelector('[data-crater-control]').hidden = !crateredSurface;
        root.querySelector('[data-crater-help]').hidden = !crateredSurface;
        root.querySelector('[name="craterDensity"]').disabled = !crateredSurface;
        root.querySelector('[data-value-for="craterDensity"]').textContent = `${recipe.craterDensity}`;
        root.querySelector('[data-fissure-options]').hidden = !crateredSurface;
        root.querySelector('[name="fissureDensity"]').disabled = !crateredSurface;
        root.querySelector('[data-value-for="fissureDensity"]').textContent = `${recipe.fissureDensity}`;
        root.querySelector('[data-geology-options]').hidden = noSurface;
        for (const key of ["canyons", "impactBasins", "shieldVolcanoes"]) {
          root.querySelector(`[name="${key}"]`).disabled = noSurface;
          root.querySelector(`[data-value-for="${key}"]`).textContent = `${recipe[key]}`;
        }
        root.querySelector('[data-weather-options]').hidden = noSurface;
        root.querySelector('[name="cloudStyle"]').disabled = noSurface || !recipe.clouds;
        for (const key of ["cloudThickness", "storminess", "hurricanes"]) {
          root.querySelector(`[name="${key}"]`).disabled = noSurface || !recipe.clouds || (key !== "cloudThickness" && !recipe.cloudThickness)
            || (key === "hurricanes" && (!recipe.water || recipe.iceCoverage === 100));
          root.querySelector(`[data-value-for="${key}"]`).textContent = `${recipe[key]}${key === "hurricanes" ? "" : "%"}`;
        }
        root.querySelector('[data-star-options]').hidden = !stellar;
        for (const key of ["stellarFlares", "stellarGlow", "lensFlare"]) {
          root.querySelector(`[name="${key}"]`).disabled = !stellar;
          root.querySelector(`[data-value-for="${key}"]`).textContent = `${recipe[key]}%`;
        }
        const help = root.querySelector('[data-celestial-help]');
        help.hidden = !stellar && !asteroid;
        help.textContent = stellar ? "Stars have luminous surfaces and coronas; brown dwarfs have dim cloud decks. The spectral texture controls artwork; the sheet's spectral classification and luminosity remain unchanged. Brown-dwarf colors are illustrative."
          : "Asteroids and captured moonlets have irregular rocky silhouettes. For an asteroid belt, this rock is repeated with varied placement and size around its scene orbit.";
        root.querySelector('[data-gas-options]').hidden = !gas;
        root.querySelector('[data-solid-help]').hidden = gas || stellar || asteroid || envelope;
        const mineralSurface = ["desert", "barren"].includes(recipe.style);
        root.querySelector('[data-mineral-options]').hidden = !mineralSurface;
        root.querySelector('[name="mineralVariation"]').disabled = !mineralSurface;
        root.querySelector('[data-value-for="mineralVariation"]').textContent = `${recipe.mineralVariation}`;
        root.querySelector('[data-hot-glow]').hidden = !hot;
        root.querySelector('[data-hot-help]').hidden = !hot;
        root.querySelector('[data-ice-help]').hidden = !gas || !isIceGiantTexture(recipe.texture);
        root.querySelector('[name="hotGlow"]').disabled = !hot;
        root.querySelector('[data-value-for="hotGlow"]').textContent = `${recipe.hotGlow}%`;
        const count = root.querySelector('[name="gasColorCount"]');
        count.disabled = !recipe.customColors || !gas;
        if (gas) count.value = recipe.gasColors.length;
        for (let i = 0; i < 8; i++) {
          const input = root.querySelector(`[name="gasColor-${i}"]`);
          input.disabled = !gas || !recipe.customColors || i >= recipe.gasColors.length;
          input.parentElement.hidden = !gas || i >= recipe.gasColors.length;
          if (gas && i < recipe.gasColors.length) input.value = recipe.gasColors[i];
        }
        for (const key of Object.keys(PLANET_COLOR_LABELS)) {
          const input = root.querySelector(`[name="color-${key}"]`);
          input.disabled = !recipe.customColors;
          input.value = recipe.colors[key];
          input.parentElement.hidden = ["rock", "mineral"].includes(key) ? !mineralSurface
            : gas ? key !== "cloud" : (stellar || asteroid || envelope) && !["surfaceLow", "surfaceHigh", "cloud"].includes(key);
        }
        for (const key of ["water", "mountains", "rivers", "cities", "clouds"]) {
          root.querySelector(`[data-value-for="${key}"]`).textContent = `${recipe[key]}%`;
          root.querySelector(`[name="${key}"]`).disabled = gas || stellar || asteroid || envelope || (key === "rivers" && !recipe.water);
        }
        root.querySelector('[data-value-for="ringDensity"]').textContent = `${recipe.ringDensity}%`;
        root.querySelector('[name="rings"]').disabled = stellar || asteroid;
        root.querySelector('[name="rings"]').checked = recipe.rings;
        for (const key of ["ringStyle", "ringDensity", "ringColor"]) root.querySelector(`[name="${key}"]`).disabled = !recipe.rings;
        for (const view of ["portrait", "scene"]) root.querySelector(`[data-planet-preview="${view}"]`).replaceChildren(planetCanvas(recipe, 256, { view }));
      };
      populateChoices(initial);
      root.querySelectorAll('input, select:not([name="style"]):not([name="texture"]):not([name="palette"]):not([name="resolution"])').forEach(input => input.addEventListener("change", preview));
      root.querySelector('[name="texture"]').addEventListener("change", event => {
        const style = root.querySelector('[name="style"]').value;
        if (style === "ice" && event.currentTarget.value === "fractured"
          && Number(root.querySelector('[name="fissureDensity"]').value) === 0) root.querySelector('[name="fissureDensity"]').value = 70;
        if (["barren", "ice"].includes(style) && ["cratered", "frozen"].includes(event.currentTarget.value)
          && Number(root.querySelector('[name="craterDensity"]').value) === 0) root.querySelector('[name="craterDensity"]').value = 50;
        if (style === "terrestrial" && event.currentTarget.value === "seasonal") root.querySelector('[name="iceCoverage"]').value = 48;
        if (style === "star") {
          const defaults = normalizePlanetRecipe({ style, texture: event.currentTarget.value });
          for (const key of ["stellarFlares", "stellarGlow"]) root.querySelector(`[name="${key}"]`).value = defaults[key];
        }
        if (style === "asteroid" && !root.querySelector('[name="customColors"]').checked) root.querySelector('[name="palette"]').value = { silicate: "stone", carbonaceous: "carbon", metallic: "metal", icy: "frost" }[event.currentTarget.value];
        if (["primordial", "greenhouse"].includes(style)) {
          const defaults = normalizePlanetRecipe({ style, texture: event.currentTarget.value });
          if (!root.querySelector('[name="customColors"]').checked) root.querySelector('[name="palette"]').value = defaults.palette;
          if (style === "primordial") root.querySelector('[name="water"]').value = defaults.water;
        }
        if (isIceGiantTexture(event.currentTarget.value) && !root.querySelector('[name="customColors"]').checked) {
          const paletteInput = root.querySelector('[name="palette"]');
          if (paletteInput.value !== "seeded" && !PLANET_PALETTES.gas[paletteInput.value]?.ice) paletteInput.value = event.currentTarget.value === "ice-hazy" ? "uranus" : "neptune";
        }
        if (event.currentTarget.value === "hot" && !root.querySelector('[name="customColors"]').checked) {
          const paletteInput = root.querySelector('[name="palette"]');
          if (paletteInput.value !== "seeded" && !PLANET_PALETTES.gas[paletteInput.value]?.hot) paletteInput.value = "ember";
        }
        preview();
      });
      root.querySelector('[name="palette"]').addEventListener("change", () => {
        root.querySelector('[name="customColors"]').checked = false;
        const defaults = normalizePlanetRecipe({ style: root.querySelector('[name="style"]').value, palette: root.querySelector('[name="palette"]').value, seed: root.querySelector('[name="seed"]').value }, body);
        root.querySelector('[name="mineralVariation"]').value = defaults.mineralVariation;
        preview();
      });
      root.querySelector('[name="style"]').addEventListener("change", event => {
        const defaults = normalizePlanetRecipe({ style: event.currentTarget.value, seed: root.querySelector('[name="seed"]').value }, body);
        populateChoices(defaults);
        root.querySelector('[name="customColors"]').checked = false;
        for (const key of ["water", "mountains", "mineralVariation", "craterDensity", "fissureDensity", "canyons", "impactBasins", "shieldVolcanoes", "rivers", "cities", "cityStyle", "citySize", "clouds", "iceCoverage", "cloudStyle", "cloudThickness", "storminess", "hurricanes"]) root.querySelector(`[name="${key}"]`).value = defaults[key];
        preview();
      });
      root.querySelector("[data-new-seed]").addEventListener("click", () => {
        root.querySelector('[name="seed"]').value = foundry.utils.randomID(12);
        preview();
      });
      preview();
    },
    buttons: [
      { action: "apply", label: "Apply Artwork", icon: "fas fa-check", default: true,
        callback: (_event, _button, dialog) => { result = read(dialog.element); } },
      { action: "cancel", label: "Cancel" },
    ],
  });
  if (!result) return null;
  ui.notifications.info(`STA2e Toolkit: Rendering ${result.resolution / 1024}K information and scene views for ${body.name || body.role || "body"}…`);
  return saveProceduralPlanetImage(body, actorId, result);
}
