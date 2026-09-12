/** Regional surface materials and relief for solid worlds. Color describes
 * dust, rock, frost, and vegetation; directional relief supplies the detail.
 */
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
export function createSolidSurfaceMaterial(recipe, terrain, colors) {
  const { noise, fbm } = terrain;
  const mountains = recipe.mountains / 100;
  const icy = recipe.style === "ice", desert = recipe.style === "desert";
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
      let color, lava = 0, micro = 0;
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
      } else if (icy) {
        color = mix(colors.surfaceLow, colors.surfaceHigh, .84 + (region - .5) * .27);
        micro = (fine - .5) * .025;
      } else if (recipe.style === "barren") {
        const highlands = smooth(.37, .62, elevation + (region - .5) * .25);
        color = mix(colors.surfaceLow, colors.surfaceHigh, .28 + highlands * .42 + (region - .5) * .10);
      } else if (["terrestrial", "ocean"].includes(recipe.style)) {
        const latitude = Math.abs(y);
        const dryBelt = smooth(.15, .35, latitude) * (1 - smooth(.5, .72, latitude));
        const arid = clamp((region - .4) * 1.5 + dryBelt * .35);
        color = mix(colors.surfaceLow, colors.surfaceHigh, .12 + arid * .74);
        const rock = smooth(.61, .78, elevation) * mountains;
        color = mix(color, colors.surfaceHigh, rock * .55);
        if (recipe.water > 0) color = mix(colors.surfaceHigh, color, (elevation - terrain.seaLevel) / .012);
      } else {
        color = mix(colors.surfaceLow, colors.surfaceHigh, .35 + (region - .5) * .4 + (elevation - .5) * .35);
        if (recipe.style === "volcanic") {
          const fissure = 1 - smooth(.003, .02, Math.abs(region - .5));
          lava = recipe.texture === "calderas" ? smooth(.53, .67, elevation) : smooth(.46, .64, elevation) * fissure;
        } else if (recipe.style === "primordial") {
          lava = recipe.texture === "magma" ? smooth(.42, .57, elevation + (region - .5) * .12)
            : recipe.texture === "crust" ? (1 - smooth(.003, .022, Math.abs(region - .5))) * smooth(.48, .64, elevation) : 0;
        }
        const lavaColor = recipe.style === "primordial" && recipe.texture === "crust" ? [235, 100, 24] : colors.ocean;
        color = mix(color, lavaColor, lava);
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
        const smallSlope = ruggedness ? (ridge(x, y, z) - ridge(u, v, w)) * .004 * ruggedness : 0;
        const reliefStrength = (.007 + mountains * .022) * (icy ? .12 : desert ? .7 : 1);
        const landformSlope = ((landform?.delta ?? 0) - (uphill.landform?.delta ?? 0)) * (.12 - reliefStrength);
        const slope = ((elevation - uphill.elevation) * reliefStrength + landformSlope + smallSlope) / step;
        shade = clamp(1 + slope, .78, 1.22);
      }
      // Grain modulates reflectance very slightly. Relief, not white noise,
      // supplies the mountain detail; buried basin floors stay smooth.
      shade *= 1 + micro + (fine - .5) * .035 * (1 - flatten);
      return { color, shade, lava };
    },
  };
}
