/** Palette-derived water colors from actual seeded seafloor elevation. */
const clamp = v => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export function createPlanetOcean(recipe, terrain, colors) {
  const living = ["terrestrial", "ocean"].includes(recipe.style), strength = (recipe.oceanShading ?? 80) / 100;
  const legacyDeep = colors.ocean.map(v => v * (living ? .42 : .28)), legacyShallow = mix(colors.ocean, colors.ice, .12);
  const shoal = mix(colors.ocean.map(v => v * 1.12), colors.ice, .22);
  const shelf = colors.ocean.map(v => v * 1.05), open = colors.ocean.map(v => v * .70), deep = colors.ocean.map(v => v * .37), abyss = colors.ocean.map(v => v * .23);
  const sample = elevation => {
    const depth = Math.max(0, terrain.oceanWaterline - elevation);
    const relativeDepth = clamp(depth / terrain.oceanDepthRange);
    const oldShelf = clamp(1 - (terrain.seaLevel - elevation) / (living ? .028 : .075));
    const legacy = mix(legacyDeep, legacyShallow, oldShelf * oldShelf * (living ? .65 : 1));
    let color = relativeDepth < .09 ? mix(shoal, shelf, smooth(0, .09, relativeDepth))
      : relativeDepth < .35 ? mix(shelf, open, smooth(.09, .35, relativeDepth))
        : relativeDepth < .78 ? mix(open, deep, smooth(.35, .78, relativeDepth))
          : mix(deep, abyss, smooth(.78, 1, relativeDepth));
    color = mix(legacy, color, strength);
    return { color, depth, relativeDepth };
  };
  return { sample };
}
