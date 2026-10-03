/** Seeded cooling rafts, molten cells and hot cores; shared by every camera. */
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
export function createPlanetLava(recipe, terrain, colors) {
  const strength = (recipe.lavaGlow ?? 75) / 100;
  const base = recipe.style === "primordial" && recipe.texture !== "magma" ? [235, 100, 24] : colors.ocean;
  const maximum = Math.max(1, ...base);
  const glow = base.map(v => v / maximum * 255);
  const crackTint = mix(glow, [255, 170, 38], .25);
  const crust = colors.surfaceLow.map(v => v * .38);
  const eruptive = recipe.style === "volcanic" || (recipe.style === "primordial" && recipe.texture === "magma");
  const vents = eruptive ? [
    ...(terrain.geology?.volcanoes ?? []).map(f => ({ ...f, power: recipe.shieldVolcanoes / 100 })),
    ...(terrain.geology?.superVolcanoes ?? []).map(f => ({ ...f, power: recipe.superVolcanoes / 100 })),
    ...(terrain.geology?.lavaBasins ?? []).map(f => ({ ...f, power: recipe.lavaBasins / 100 * .8 })),
  ] : [];
  return {
    sample(x, y, z, lava, footprint = 0) {
      if (!lava && !eruptive) return { color: base, emission: [0, 0, 0], cooling: 0, hotSpot: 0, coverage: 0 };
      const warp = (terrain.noise(x * 8 + 401, y * 8 + 43, z * 8 + 97) - .5) * .8;
      const cellScale = eruptive ? 14 : 32;
      const cells = terrain.fbm(x * cellScale + warp + 409, y * cellScale + 71, z * cellScale - warp + 29, 3);
      const fine = terrain.noise(x * 105 + 419, y * 105 + 61, z * 105 + 83);
      const resolved = 1 - smooth(.006, .030, footprint);
      const cooling = smooth(.49, .65, cells + (fine - .5) * (eruptive ? .04 : .10) * resolved);
      const cores = terrain.fbm(x * 23 + 431, y * 23 + 37, z * 23 + 73, 3);
      const hotSpot = smooth(eruptive ? .58 : .52, eruptive ? .72 : .67, cores + (fine - .5) * .09 * resolved) * (1 - cooling);
      // A broad warm shoulder surrounds each bright core; dark rafts receive
      // almost no thermal light. Filtering removes only the tiny fragments.
      const shoulder = smooth(.39, .60, cores) * (1 - cooling);
      const heat = (.20 + shoulder * .28 + hotSpot * .52) * (1 - cooling * .985);
      // Warped isosurfaces at two scales form branching cracks through solid
      // crust. Their warm shoulders survive filtering without enlarging cores.
      let seam = 0, seamHalo = 0, vent = 0, ventHalo = 0;
      if (eruptive) {
        const wx = (terrain.noise(x * 3 + 457, y * 3 + 19, z * 3 + 71) - .5) * 2.8;
        const wy = (terrain.noise(x * 3 + 461, y * 3 + 83, z * 3 + 31) - .5) * 2.8;
        const wz = (terrain.noise(x * 3 + 463, y * 3 + 41, z * 3 + 97) - .5) * 2.8;
        const broken = (terrain.fbm(x * 75 + 467, y * 75 + 53, z * 75 + 23, 2) - .5) * .10 * resolved;
        for (const scale of [8, 19]) {
          const d = Math.abs(terrain.noise(x * scale + wx + 443, y * scale + wy + 47, z * scale + wz + 61) - .5 + broken);
          const gate = smooth(.32, .60, terrain.noise(x * 4 + 449, y * 4 + 29, z * 4 + 83));
          const width = scale === 8 ? .016 : .008, filter = Math.min(.06, footprint * scale * .35);
          const core = (1 - smooth(width * .3, width + filter, d)) * width / (width + filter);
          seam = Math.max(seam, core * gate * (scale === 8 ? 1 : .55));
          seamHalo = Math.max(seamHalo, Math.exp(-((d / (width * 3 + filter)) ** 2)) * gate * .24);
        }
        for (const source of vents) {
          const d = Math.hypot(x - source.center[0], y - source.center[1], z - source.center[2]);
          const radius = .010 + source.power * .012;
          vent = Math.max(vent, Math.exp(-((d / Math.max(radius, footprint * .8)) ** 2)) * source.power);
          ventHalo = Math.max(ventHalo, Math.exp(-((d / (radius * 3.8)) ** 2)) * source.power);
        }
      }
      const color = mix(mix(base, mix(glow, [255, 232, 157], .72), hotSpot * .65), crust, cooling * .96);
      const tint = mix(glow, [255, 232, 157], hotSpot * (eruptive ? .38 : .78));
      const coverage = Math.sqrt(clamp(lava));
      const emission = tint.map((v, k) => {
        const moltenLight = v / 255 * heat * coverage * (eruptive ? 2.4 : 1.4);
        const crackLight = crackTint[k] / 255 * (seam * 2.5 + seamHalo * .45);
        const eruption = [1, .85, .70][k] * vent * 7 + glow[k] / 255 * ventHalo * .85;
        return 255 * (1 - Math.exp(-(moltenLight + crackLight + eruption) * strength));
      });
      return { color, emission, cooling, hotSpot, coverage: Math.max(lava, seam * .80, vent), seam, vent };
    },
  };
}
