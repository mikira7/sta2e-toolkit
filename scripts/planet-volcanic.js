/** Exposed basalt, ash mantles and localized molten terrain in body coordinates. */
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
export function createPlanetVolcanic(recipe, terrain, colors, land) {
  const strength = (recipe.volcanicDetail ?? 75) / 100;
  const activity = recipe.style === "primordial" ? recipe.texture === "developing" ? .22 : recipe.texture === "crust" ? .65 : 1 : 1;
  return {
    strength,
    sample(x, y, z, elevation, geology, footprint = 0) {
      const regional = terrain.fbm(x * 3.1 + 353, y * 3.1 + 47, z * 3.1 + 71, 3);
      const crust = land.sample(x, y, z, footprint);
      const mountain = terrain.mountainAt(x, y, z) * recipe.mountains / 100;
      const ash = (geology?.ash ?? 0) * (.45 + regional * .55);
      const sulfur = smooth(.54, .70, terrain.fbm(x * 5 + 367, y * 5 + 83, z * 5 + 29, 3))
        * (.18 + (geology?.volcano ?? 0) * .75 + (geology?.canyon ?? 0) * .45);
      let color = mix(colors.surfaceLow, colors.surfaceHigh, .28 + crust.highland * .25 + regional * .14);
      color = color.map(v => v * (1 + (crust.bedrock - .5) * .18 * crust.roughness));
      color = mix(color, mix(colors.cloud, colors.surfaceHigh, .5), ash * .45);
      color = mix(color, mix(colors.surfaceHigh, [183, 160, 65], .50), sulfur * .65);
      if (recipe.style === "volcanic" || (recipe.style === "primordial" && recipe.texture === "magma")) color = mix(color, colors.surfaceLow.map(v => v * (.65 + crust.highland * .25)), .65);
      const bed = geology?.lavaBed ?? 0;
      color = mix(color, colors.surfaceLow.map(v => v * .62), bed * .85);
      // Interior cooling rafts break up magma; walls and basin rims stay rock.
      const cooling = smooth(.42, .66, terrain.fbm(x * 28 + 379, y * 28 + 31, z * 28 + 97, 3));
      const basin = Math.max(geology?.lavaBasin ?? 0, geology?.superCaldera ?? 0, geology?.caldera ?? 0);
      const canyonStrength = recipe.canyons / 100;
      const canyon = canyonStrength ? smooth(.45, .95, (geology?.canyon ?? 0) / canyonStrength) * canyonStrength : 0;
      const channel = geology?.lavaRille ?? 0;
      const lava = clamp((basin * (.55 + (1 - cooling) * .40) + canyon * .85 + channel * .75) * activity);
      const flatten = geology?.flatten ?? 0;
      const relief = crust.relief * (1 - flatten * .94) + mountain * .025 * (1 - flatten)
        + (geology?.lavaFlow ?? 0) * .002 * (1 - smooth(.01, .04, footprint));
      return { color, relief, lava, sulfur, ash, mountain, activity };
    },
  };
}
