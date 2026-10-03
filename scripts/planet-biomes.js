/** Climate-selected, palette-preserving Class M biome textures. */
import { BIOME_MAP_SIZE as size, BIOME_MAPS } from "./biome-texture-data.js";
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
const wrap = v => (v % size + size) % size;
function mapSample(map, u, v) {
  const x = u * size, y = v * size, ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const at = (a, b) => map[wrap(b) * size + wrap(a)];
  return (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
}
export function createPlanetBiomes(recipe, terrain, colors) {
  const { noise, fbm } = terrain;
  const strength = (recipe.biomeDetail ?? 65) / 100, mountains = recipe.mountains / 100;
  const phase = noise(163, 71, 37) * Math.PI * 2, cos = Math.cos(phase), sin = Math.sin(phase);
  const offset = noise(173, 31, 83) * 5;
  const variants = Array.from({ length: 5 }, (_, i) => Math.floor(noise(i, 179, 53) * 2) % 2);
  const palette = [
    colors.surfaceLow.map(v => v * .72),
    mix(colors.surfaceLow, colors.surfaceHigh, .22),
    mix(colors.surfaceHigh, colors.surfaceLow, .06),
    mix(colors.surfaceLow, colors.surfaceHigh, .50),
    mix(colors.surfaceHigh, colors.ice, .18),
  ];
  const sample = (x, y, z, elevation, footprint = 0) => {
    const latitude = Math.abs(y), altitude = Math.max(0, elevation - Math.max(.42, terrain.seaLevel));
    const inland = recipe.water > 0 ? smooth(0, .035, elevation - terrain.seaLevel) : 1;
    const mountain = mountains ? terrain.mountainAt(x, y, z) * mountains * inland : 0;
    const rain = fbm(x * 5.2 + 91, y * 5.2 + 29, z * 5.2 + 53, 3);
    const regionalRain = fbm(x * 2.3 + 13, y * 2.3 + 67, z * 2.3 + 31, 3);
    const dryBelt = smooth(.12, .36, latitude) * (1 - smooth(.52, .72, latitude));
    const humidity = clamp(.62 + (rain - .5) * 1.6 + (regionalRain - .5) * 1.5 - dryBelt * .38 - altitude * .28);
    const cold = smooth(.53, .88, latitude + altitude * .6);
    const alpine = smooth(.07, .50, mountain) * .88;
    const desert = (1 - smooth(.20, .48, humidity)) * (1 - cold) * (1 - alpine);
    const tundra = cold * (1 - alpine);
    const remaining = Math.max(0, 1 - alpine - desert - tundra);
    const forest = smooth(.46, .70, humidity) * remaining;
    const grassland = remaining - forest;
    const weights = [forest, grassland, desert, tundra, alpine];
    // Rotate and warp all three dimensions. Triplanar projection preserves
    // polar detail without a longitude seam or a single visible tile direction.
    const a = x * cos - z * sin + (noise(x * 5 + 97, y * 5 + 43, z * 5 + 11) - .5) * .18;
    const b = y + (noise(x * 5 + 19, y * 5 + 157, z * 5 + 59) - .5) * .18;
    const c = x * sin + z * cos + (noise(x * 5 + 71, y * 5 + 23, z * 5 + 167) - .5) * .18;
    // Independent, broad sediment and exposure fields vary hue as well as
    // brightness: pale sand sheets, ochre dunes, and darker bedrock provinces.
    const sand = fbm(a * 3.1 + 191, b * 3.1 + 47, c * 3.1 + 113, 3);
    const exposure = smooth(.46, .67, fbm(a * 6.7 + 71, b * 6.7 + 197, c * 6.7 + 29, 3) + altitude * .30);
    const paleSand = mix(colors.surfaceHigh, colors.ice, .18);
    const ochre = colors.surfaceHigh.map((v, k) => v * [1.06, .92, .77][k]);
    const bedrock = mix(colors.surfaceHigh, colors.surfaceLow, .12).map(v => v * .68);
    const desertColor = mix(mix(paleSand, ochre, smooth(.32, .66, sand)), bedrock, exposure * .65);
    const wx = x ** 4, wy = y ** 4, wz = z ** 4, total = wx + wy + wz || 1;
    const scales = [3.4, 1.7, 1.4, 2, 1.6], heights = [.0006, .0012, .003, .0009, .019];
    const resolved = 1 - smooth(.006, .030, footprint);
    const closeDetail = 1 - smooth(.0008, .004, footprint);
    let color = [0, 0, 0], relief = mountain * .016;
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] < .001) continue;
      const map = BIOME_MAPS[i * 2 + variants[i]], s = scales[i];
      const lookup = data => (mapSample(data, b * s + offset, c * s) * wx + mapSample(data, a * s, c * s + offset) * wy + mapSample(data, a * s + offset, b * s) * wz) / total;
      const albedo = lookup(map.albedo), height = lookup(map.height);
      // Nested biome detail becomes visible as the camera approaches. It uses
      // the same spherical mapping and seed, and fades before it is subpixel.
      const nested = data => (mapSample(data, b * s * 4 + offset, c * s * 4) * wx + mapSample(data, a * s * 4, c * s * 4 + offset) * wy + mapSample(data, a * s * 4 + offset, b * s * 4) * wz) / total;
      const fineAlbedo = closeDetail > 0 ? nested(map.albedo) - .5 : 0;
      const fineHeight = closeDetail > 0 ? nested(map.height) - .5 : 0;
      // Regional hue variation survives downsampling; texture contrasts fade
      // before they become noisy pixels. Maps contain no baked illumination.
      const contrast = Math.max(-.35, Math.min(.35, (albedo - .56) * 2.8)) * (i === 2 || i === 4 ? .24 : .32) * resolved;
      const local = i === 0 ? mix(palette[0], palette[1], smooth(.56, .68, albedo) * .18 * resolved) : i === 2 ? desertColor : palette[i];
      for (let k = 0; k < 3; k++) color[k] += local[k] * (1 + contrast + fineAlbedo * closeDetail * .45) * weights[i];
      relief += ((height - .5) * resolved + fineHeight * closeDetail * .30) * heights[i] * weights[i];
    }
    const summit = recipe.iceCoverage > 0 && mountains ? terrain.mountainPeakAt(x, y, z) * mountains * inland : 0;
    const snow = recipe.iceCoverage > 0 ? smooth(.47, .80, summit + latitude * .22) * smooth(.08, .23, summit) : 0;
    color = mix(color, colors.ice, snow);
    return { color, relief, weights, humidity, mountain, snow, strength };
  };
  return { sample, variants, strength };
}
