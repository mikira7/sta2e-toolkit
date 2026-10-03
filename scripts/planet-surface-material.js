/** Regional surface materials and relief for solid worlds. Color describes
 * dust, rock, frost, and vegetation; directional relief supplies the detail.
 */
import { createBarrenRockTexture } from "./barren-textures.js";
import { createBarrenLandforms } from "./barren-landforms.js";
import { createPlanetBiomes } from "./planet-biomes.js";
import { createMountainLighting } from "./planet-mountain-lighting.js";
import { createPlanetDeserts } from "./planet-deserts.js";
import { createPlanetVolcanic } from "./planet-volcanic.js";
import { createPlanetLava } from "./planet-lava.js";
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
export function createSolidSurfaceMaterial(recipe, terrain, colors) {
  const { noise, fbm } = terrain;
  const mountains = recipe.mountains / 100;
  const icy = recipe.style === "ice", desert = recipe.style === "desert";
  const living = ["terrestrial", "ocean"].includes(recipe.style);
  const hot = ["volcanic", "primordial"].includes(recipe.style);
  const lavaField = hot ? createPlanetLava(recipe, terrain, colors) : null;
  const mountainLighting = (living || desert || hot) && mountains && (recipe.mountainShadows ?? 70) > 0 ? createMountainLighting(recipe, terrain) : null;
  const desertField = desert && (recipe.desertDetail ?? 70) > 0 ? createPlanetDeserts(recipe, terrain, colors) : null;
  const biomeField = living && (recipe.biomeDetail ?? 65) > 0 ? createPlanetBiomes(recipe, terrain, colors) : null;
  const rockTexture = recipe.style === "barren" || hot ? createBarrenRockTexture(noise) : null;
  const barrenField = rockTexture ? createBarrenLandforms(terrain, rockTexture) : null;
  const volcanicField = hot && (recipe.volcanicDetail ?? 75) > 0 ? createPlanetVolcanic(recipe, terrain, colors, barrenField) : null;
  const wind = noise(91, 47, 13) * Math.PI * 2;
  const windX = Math.cos(wind), windZ = Math.sin(wind);
  const faultCount = ["desert", "barren", "ice"].includes(recipe.style) ? (recipe.fissureDensity ?? (icy ? recipe.texture === "fractured" ? 70 : 25 : 0)) / 5 : 0;
  const faults = Array.from({ length: Math.ceil(faultCount) }, (_, i) => {
    const y = noise(i, 53, 73) * 2 - 1, angle = noise(i, 37, 19) * Math.PI * 2, radius = Math.sqrt(1 - y * y);
    return { normal: [Math.cos(angle) * radius, y, Math.sin(angle) * radius], offset: (noise(i, 89, 23) - .5) * .65,
      visibility: clamp(faultCount - i), width: icy ? recipe.texture === "fractured" ? .006 : .003 : .003 + noise(i, 31, 97) * .003 };
  });
  const ridge = (x, y, z) => {
    const a = noise(x * 18 + 71, y * 18 + 43, z * 18 + 29) - .5;
    const b = noise(x * 43 + 19, y * 43 + 83, z * 43 + 61) - .5;
    // A smooth absolute value keeps ridgelines narrow without hard cusps.
    return 1 - Math.sqrt(a * a + .002) * 1.5 - Math.sqrt(b * b + .002) * .5;
  };
  return {
    faults,
    sample(x, y, z, elevation, fine, landform, light, footprint = 0) {
      const region = fbm(x * 2.3 + 13, y * 2.3 + 67, z * 2.3 + 31, 3);
      const sediment = (1 - smooth(.40, .62, elevation)) * (.6 + region * .4);
      const flatten = landform?.flatten ?? 0;
      let color, lava = 0, lavaEmission = null, micro = 0, mountain = 0, ridgeHeight = 0, inland = 1, barren = null, biome = null, desertSurface = null, volcanicSurface = null;
      if (desert) {
        // Dust mantles are broad and subdued; exposed darker rock forms
        // coherent provinces instead of bright outlines around every bump.
        const exposure = smooth(.46, .69, region + (elevation - .5) * .3);
        color = mix(colors.surfaceLow, colors.surfaceHigh, .79 - exposure * .48 + (region - .5) * .14);
        if (recipe.texture === "dunes") {
          const along = x * windX + z * windZ, across = -x * windZ + z * windX;
          const phase = along * 145 + Math.sin(across * 12 + y * 5) * 3.5 + (region - .5) * 18;
          const dune = Math.sin(phase) + Math.sin(phase * 2 + .7) * .25;
          const field = smooth(.32, .56, region) * sediment * (1 - flatten);
          // Fade fine ripples as their wavelength becomes subpixel.
          const resolved = 1 - smooth(.02, .065, footprint);
          micro = dune * field * resolved * .035;
        } else if (recipe.texture === "salt") {
          const salt = (1 - smooth(.38, .51, elevation)) * smooth(.30, .55, region);
          color = mix(color, mix(colors.surfaceHigh, colors.ice, .45), salt * .82);
        } else {
          const strata = Math.sin(elevation * 155 + region * 8) * .012;
          micro = strata * (1 - sediment) * (1 - flatten);
        }
        ridgeHeight = mountains ? terrain.mountainAt(x, y, z) : 0;
        if (desertField) {
          desertSurface = desertField.sample(x, y, z, elevation, footprint);
          color = mix(color, desertSurface.color, desertField.strength);
          micro *= 1 - desertField.strength;
        }
      } else if (icy) {
        color = mix(colors.surfaceLow, colors.surfaceHigh, .84 + (region - .5) * .27);
        micro = (fine - .5) * .025;
      } else if (recipe.style === "barren") {
        barren = barrenField.sample(x, y, z, footprint);
        const exposure = barren.highland * .22 + barren.roughness * .13;
        color = mix(colors.surfaceLow, colors.surfaceHigh, .37 + exposure + (region - .5) * .18);
        // Regolith buries small relief in some provinces; exposed formations
        // occur in patches and scarps, rather than covering the whole globe.
        color = color.map(v => v * (1 + (barren.bedrock - .5) * .10 * barren.roughness));
        micro = (fine - .5) * .018 * barren.roughness * (1 - smooth(.012, .04, footprint));
        if (landform?.lavaBed) {
          const bed = landform.lavaBed;
          const basalt = mix(colors.surfaceLow, colors.surfaceHigh, .10).map(v => v * .58);
          const weathering = (rockTexture(x, y, z, 2) - .5) * .10;
          const flow = (landform.lavaFlow / bed - .5) * .045 * (1 - smooth(.01, .05, footprint));
          color = mix(color, basalt.map(v => v * (1 + weathering + flow)), bed * .92);
          color = color.map(v => v * (1 - landform.lavaRille * .13 * (1 - smooth(.006, .03, footprint))));
          micro *= 1 - bed * .85;
        }
      } else if (living) {
        const latitude = Math.abs(y);
        const altitude = Math.max(0, elevation - Math.max(.42, terrain.seaLevel));
        const dryBelt = smooth(.12, .36, latitude) * (1 - smooth(.52, .72, latitude));
        const rain = fbm(x * 5.2 + 91, y * 5.2 + 29, z * 5.2 + 53, 3);
        const arid = smooth(.24, .72, .22 + dryBelt * .46 + (region - .5) * 2.8 + (rain - .5) * .65 + altitude * .55);
        const cold = smooth(.58, .9, latitude + altitude * .6);
        // Moist equatorial forest, dry subtropical interiors, and subdued
        // temperate/tundra transitions share the user's chosen palette.
        const vegetation = mix(colors.surfaceLow.map(v => v * .76), colors.surfaceLow, .45 + rain * .55);
        color = mix(vegetation, colors.surfaceHigh, arid * .93);
        color = mix(color, mix(colors.surfaceLow, colors.surfaceHigh, .48), cold * .65);
        inland = recipe.water > 0 ? smooth(0, .035, elevation - terrain.seaLevel) : 1;
        ridgeHeight = mountains ? terrain.mountainAt(x, y, z) : 0;
        mountain = ridgeHeight * mountains * inland;
        const rock = smooth(.12, .65, mountain) * .8;
        color = mix(color, mix(colors.surfaceHigh, colors.ice, .18), rock);
        // Snow lines descend toward the poles; the ice coverage control still
        // owns permanent ice and can explicitly disable all snow.
        const summit = recipe.iceCoverage > 0 && mountains ? terrain.mountainPeakAt(x, y, z) * mountains * inland : 0;
        const snow = recipe.iceCoverage > 0 ? smooth(.50, .82, summit + latitude * .22) * smooth(.08, .23, summit) : 0;
        color = mix(color, colors.ice, snow);
        micro = (fine - .5) * .09;
        if (biomeField) {
          biome = biomeField.sample(x, y, z, elevation, footprint);
          color = mix(color, biome.color, biome.strength);
          micro *= 1 - biome.strength * .90;
        }
        // Beaches are subpixel at orbital scale, never a bright continent outline.
        if (recipe.water > 0) color = mix(mix(colors.surfaceHigh, color, .55), color, (elevation - terrain.seaLevel) / .0015);
      } else {
        color = mix(colors.surfaceLow, colors.surfaceHigh, .35 + (region - .5) * .4 + (elevation - .5) * .35);
        if (recipe.style === "volcanic") {
          const fissure = 1 - smooth(.003, .02, Math.abs(region - .5));
          lava = recipe.texture === "calderas" ? smooth(.53, .67, elevation) : smooth(.46, .64, elevation) * fissure;
        } else if (recipe.style === "primordial") {
          lava = recipe.texture === "magma" ? smooth(.42, .57, elevation + (region - .5) * .12)
            : recipe.texture === "crust" ? (1 - smooth(.003, .022, Math.abs(region - .5))) * smooth(.48, .64, elevation) : 0;
        }
        if (volcanicField) {
          volcanicSurface = volcanicField.sample(x, y, z, elevation, landform, footprint);
          ridgeHeight = mountains ? terrain.mountainAt(x, y, z) : 0;
          color = mix(color, volcanicSurface.color, volcanicField.strength);
          const background = recipe.texture === "magma" ? .68 : recipe.texture === "calderas" ? .20 : .30;
          lava = lava * (1 - volcanicField.strength * (1 - background));
        }
        if (hot) {
          const activity = recipe.style === "primordial" ? recipe.texture === "developing" ? .22 : recipe.texture === "crust" ? .65 : 1 : 1;
          const basin = Math.max(landform?.lavaBasin ?? 0, landform?.superCaldera ?? 0, landform?.caldera ?? 0);
          const canyonStrength = recipe.canyons / 100;
          const canyon = canyonStrength ? smooth(.45, .95, (landform?.canyon ?? 0) / canyonStrength) * canyonStrength : 0;
          const molten = volcanicSurface?.lava ?? Math.max(basin, canyon, landform?.lavaRille ?? 0) * activity;
          lava = Math.max(lava * (1 - (landform?.lavaBed ?? 0) * .85), molten);
        }
        const lavaColor = recipe.style === "primordial" && recipe.texture === "crust" ? [235, 100, 24] : colors.ocean;
        const molten = lavaField?.sample(x, y, z, lava, footprint);
        lavaEmission = molten?.emission ?? null;
        lava = molten?.coverage ?? lava;
        color = mix(color, molten?.color ?? lavaColor, lava);
      }
      if ((desert || recipe.style === "barren") && recipe.mineralVariation > 0) {
        const strength = recipe.mineralVariation / 100;
        // Independent large-scale mineral fields prevent every pale deposit
        // from following the same boundary as the darker bedrock exposures.
        const exposure = smooth(.43, .65, region + (elevation - .5) * .25);
        const deposits = fbm(x * 3.4 + 97, y * 3.4 + 23, z * 3.4 + 59, 3);
        const mineral = smooth(.54, .68, deposits) * (.4 + sediment * .6) * .8;
        color = mix(color, colors.rock, exposure * strength);
        color = mix(color, colors.mineral, mineral * strength);
        if (landform?.lavaBed) {
          // Lava mantles bury most older exposed mineral deposits.
          const basalt = mix(colors.surfaceLow, colors.surfaceHigh, .10).map(v => v * .58);
          color = mix(color, basalt, landform.lavaBed * .65);
        }
      }
      if (desert && landform?.lavaBed) {
        const bed = landform.lavaBed;
        const basalt = mix(colors.surfaceLow, colors.surfaceHigh, .10).map(v => v * .60);
        const flow = (landform.lavaFlow / bed - .5) * .055 * (1 - smooth(.01, .05, footprint));
        color = mix(color, basalt.map(v => v * (1 + flow)), bed * .94);
        color = color.map(v => v * (1 - landform.lavaRille * .10));
        micro *= 1 - bed * .90;
      }
      if (landform?.giantBasin) {
        const dust = mix(colors.surfaceLow, colors.surfaceHigh, desert ? .65 : .48);
        color = mix(color, dust, landform.giantBasin * .35);
      }
      if (faults.length) {
        let fracture = 0, ridgeBank = 0;
        const warp = (fbm(x * 4 + 73, y * 4 + 11, z * 4 + 29, 3) - .5) * .13;
        for (const fault of faults) {
          const d = Math.abs(x * fault.normal[0] + y * fault.normal[1] + z * fault.normal[2] - fault.offset + warp);
          const width = fault.width, filter = Math.min(.018, footprint * .35);
          const line = (1 - smooth(width * .25, width + filter, d)) * width / (width + filter);
          fracture = Math.max(fracture, line * fault.visibility);
          ridgeBank = Math.max(ridgeBank, Math.exp(-(((d - width * 1.6) / (width * .6 + filter)) ** 2)) * fault.visibility);
        }
        const crackColor = icy ? colors.surfaceLow : mix(color.map(v => v * .45), colors.surfaceLow, .25);
        color = mix(color, crackColor, fracture * (icy ? recipe.texture === "fractured" ? .68 : .26 : .72));
        micro += ridgeBank * .035;
      }
      let shade = 1;
      if (mountains || landform) {
        const step = .003;
        const px = x + light.x * step, py = y + light.y * step, pz = z + light.z * step;
        const length = Math.hypot(px, py, pz), u = px / length, v = py / length, w = pz / length;
        const uphill = terrain.surfaceAt(u, v, w);
        const ruggedness = mountains * (1 - sediment * .8) * (1 - flatten) * (icy ? .3 : 1);
        const smallSlope = ruggedness && !barren ? (ridge(x, y, z) - ridge(u, v, w)) * .004 * ruggedness * (1 - (biome?.strength ?? 0)) : 0;
        const reliefStrength = (.007 + mountains * .022) * (icy ? .12 : desert ? .7 : 1);
        const landformSlope = ((landform?.delta ?? 0) - (uphill.landform?.delta ?? 0)) * (.12 - reliefStrength);
        const mountainSlope = living && mountains ? (ridgeHeight - terrain.mountainAt(u, v, w)) * mountains * inland * .009 * (1 - (biome?.strength ?? 0)) : 0;
        const slope = ((elevation - uphill.elevation) * reliefStrength + landformSlope + smallSlope + mountainSlope) / step;
        shade = clamp(1 + slope, .78, 1.22);
      }
      if (barren) {
        const step = Math.max(.0015, Math.min(.012, footprint * .5));
        const px = x + light.x * step, py = y + light.y * step, pz = z + light.z * step;
        const length = Math.hypot(px, py, pz);
        const next = barrenField.sample(px / length, py / length, pz / length, footprint);
        const slope = (barren.relief - next.relief) / step;
        shade *= clamp(1 + slope * (.10 + mountains * .16) * (1 - flatten), .65, 1.35);
      }
      if (biome) {
        const step = Math.max(.0015, Math.min(.012, footprint * .5));
        const px = x + light.x * step, py = y + light.y * step, pz = z + light.z * step;
        const length = Math.hypot(px, py, pz), u = px / length, v = py / length, w = pz / length;
        const next = biomeField.sample(u, v, w, terrain.elevation(u, v, w), footprint);
        const slope = (biome.relief - next.relief) / step;
        shade *= clamp(1 + slope * .28 * biome.strength * (1 - flatten), .76, 1.24);
      }
      if (desertSurface) {
        const step = Math.max(.0025, Math.min(.012, footprint * .6));
        const p = [x + light.x * step, y + light.y * step, z + light.z * step], length = Math.hypot(...p);
        const [u, v, w] = p.map(n => n / length);
        const next = desertField.sample(u, v, w, terrain.elevation(u, v, w), footprint);
        const slope = (desertSurface.relief - next.relief) / step;
        shade *= clamp(1 + slope * .25 * desertField.strength * (1 - flatten), .72, 1.25);
      }
      if (volcanicSurface) {
        const step = Math.max(.0025, Math.min(.012, footprint * .6));
        const p = [x + light.x * step, y + light.y * step, z + light.z * step], length = Math.hypot(...p);
        const [u, v, w] = p.map(n => n / length), nextSurface = terrain.surfaceAt(u, v, w);
        const next = volcanicField.sample(u, v, w, nextSurface.elevation, nextSurface.landform, footprint);
        shade *= clamp(1 + (volcanicSurface.relief - next.relief) / step * .28 * volcanicField.strength, .58, 1.30);
      }
      // Grain modulates reflectance very slightly. Relief, not white noise,
      // supplies the mountain detail; buried basin floors stay smooth.
      shade *= 1 + micro + (fine - .5) * (barren ? .008 : .035) * (1 - flatten);
      if (hot) shade = clamp(shade, .55, 1.45);
      const shadowMountain = ridgeHeight * (1 - (desertSurface?.salt ?? 0) * .95) * (1 - flatten * .95);
      const mountainShadow = mountainLighting?.sample(x, y, z, elevation, shadowMountain, light, footprint) ?? 1;
      return { color, shade, lava, lavaEmission, mountainShadow };
    },
  };
}
