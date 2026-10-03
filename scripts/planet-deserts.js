/** Regional sand seas, exposed badlands, mesas, and evaporite plains. */
import { BIOME_MAP_SIZE as size, BIOME_MAPS } from "./biome-texture-data.js";
import { createBarrenRockTexture } from "./barren-textures.js";
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
const wrap = v => (v % size + size) % size;
function sampleMap(map, u, v) {
  const x = u * size, y = v * size, a = Math.floor(x), b = Math.floor(y), tx = x - a, ty = y - b;
  const at = (i, j) => map[wrap(j) * size + wrap(i)];
  return (at(a, b) * (1 - tx) + at(a + 1, b) * tx) * (1 - ty) + (at(a, b + 1) * (1 - tx) + at(a + 1, b + 1) * tx) * ty;
}
export function createPlanetDeserts(recipe, terrain, colors) {
  const { noise, fbm } = terrain, rockTexture = createBarrenRockTexture(noise);
  const strength = (recipe.desertDetail ?? 70) / 100;
  const map = BIOME_MAPS[4 + Math.floor(noise(191, 31, 71) * 2) % 2];
  const phase = noise(211, 73, 19) * Math.PI * 2, cos = Math.cos(phase), sin = Math.sin(phase);
  const mesas = Array.from({ length: 12 }, (_, i) => {
    const y = noise(i, 223, 53) * 2 - 1, angle = noise(i, 227, 71) * Math.PI * 2, r = Math.sqrt(1 - y * y);
    return { center: [r * Math.cos(angle), y, r * Math.sin(angle)], radius: .06 + noise(i, 229, 19) * .12 };
  });
  const pale = mix(colors.surfaceHigh, colors.ice, .16);
  const ochre = colors.surfaceHigh.map((v, k) => v * [1.04, .95, .84][k]);
  const bedrock = mix(colors.rock, colors.surfaceLow, .35).map(v => v * .84);
  const saltColor = mix(colors.surfaceHigh, colors.ice, .58);
  return {
    strength, mesas,
    sample(x, y, z, elevation, footprint = 0) {
      const sediment = fbm(x * 3.1 + 191, y * 3.1 + 47, z * 3.1 + 113, 3);
      const exposure = fbm(x * 5.4 + 71, y * 5.4 + 197, z * 5.4 + 29, 3);
      const mountain = terrain.mountainAt(x, y, z) * recipe.mountains / 100;
      const lowland = 1 - smooth(.44, .62, elevation);
      const rock = smooth(.40, .65, exposure + (elevation - .5) * .65 + mountain * .30 + (recipe.texture === "badlands" ? .08 : -.04));
      const salt = recipe.texture === "salt" ? lowland * smooth(.32, .57, sediment) * (1 - rock * .75) : 0;
      const sand = (1 - rock) * (1 - salt);
      const a = x * cos - z * sin + (noise(x * 5 + 17, y * 5 + 61, z * 5 + 83) - .5) * .14;
      const b = y, c = x * sin + z * cos;
      const wx = a ** 4, wy = b ** 4, wz = c ** 4, total = wx + wy + wz || 1;
      const duneAt = channel => (sampleMap(channel, b * 1.4, c * 1.4) * wx + sampleMap(channel, a * 1.4, c * 1.4) * wy + sampleMap(channel, a * 1.4, b * 1.4) * wz) / total;
      const resolved = 1 - smooth(.007, .035, footprint);
      const dune = duneAt(map.height), duneColor = duneAt(map.albedo);
      const rocky = rockTexture(a, b, c, 1.7);
      let color = mix(mix(pale, ochre, smooth(.30, .70, sediment)), bedrock, rock * .80);
      color = mix(color, saltColor, salt * .90);
      color = color.map(v => v * (1 + ((duneColor - .5) * sand * .22 + (rocky - .5) * rock * .18) * resolved));
      let relief = (dune - .5) * sand * (recipe.texture === "dunes" ? .006 : .0025) * resolved
        + (rocky - .5) * rock * .007 * resolved + mountain * .012;
      let mesa = 0;
      if (recipe.texture !== "dunes") for (const m of mesas) {
        const distance = Math.hypot(x - m.center[0], y - m.center[1], z - m.center[2]);
        if (distance > m.radius * 1.35) continue;
        const irregular = (noise(x * 18 + 43, y * 18 + 97, z * 18 + 31) - .5) * .18;
        const plateau = 1 - smooth(.62, 1.05 + footprint / m.radius, distance / m.radius + irregular);
        mesa = Math.max(mesa, plateau * rock);
      }
      relief += mesa * .012;
      color = mix(color, mix(colors.surfaceHigh, bedrock, .55), mesa * .24);
      // Pale flats stay quiet while dune fields and rock provinces carry relief.
      relief *= 1 - salt * .85;
      return { color, relief, sand, rock, salt, mesa, mountain };
    },
  };
}
