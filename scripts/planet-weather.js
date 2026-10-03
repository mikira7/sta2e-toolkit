/** Surface climate and layered weather in fixed planetary coordinates. */
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, value) => { const t = clamp((value - a) / (b - a)); return t * t * (3 - 2 * t); };
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const unit = p => { const length = Math.hypot(...p) || 1; return p.map(v => v / length); };
export const PLANET_CLOUD_STYLES = { mixed: "Mixed cloud layers", wispy: "High wispy clouds", layered: "Layered overcast", stormy: "Storm fronts" };
const iceCache = new WeakMap();

/** An unbroken Venus-inspired cloud deck. Shear stretches the markings into
 * sweeping streaks; sampling rotated 3D coordinates avoids longitude seams
 * and keeps the same weather attached to both portrait and polar views.
 */
export function createGreenhouseClouds(recipe, terrain, colors) {
  const { fbm } = terrain;
  const blend = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const demon = recipe.texture === "toxic";
  const turbulence = (recipe.envelopeStorms ?? (demon ? 70 : 35)) / 100;
  const relief = (recipe.envelopeRelief ?? 75) / 100;
  const light = blend(colors.surfaceHigh, colors.cloud, .42);
  const dark = blend(blend(colors.surfaceLow, colors.surfaceHigh, demon ? .12 : .58), colors.cloud, demon ? .08 : .18);
  const field = (x, y, z, footprint = 0) => {
      const flow = fbm(x * 2 + 53, y * 2 + 17, z * 2 + 71, 3) - .5;
      const eddy = fbm(x * 4 + 479, y * 4 + 31, z * 4 + 83, 3) - .5;
      const shear = y * 1.6 + y * y * y * 4.5 + flow * .65 + eddy * turbulence * (demon ? 2.8 : 1.4);
      const c = Math.cos(shear), s = Math.sin(shear);
      const u = x * c - z * s, v = x * s + z * c;
      const equator = 1 - y * y;
      // Broad bowed fronts and much finer wind-stretched haze, with gentle
      // polar spirals instead of a separate cyclone stamp or exposed terrain.
      const latitude = y + v * equator * .24 + flow * .12;
      const deck = fbm(u * 2.8 + 29, latitude * 12 + 61, v * 2.8 + 11, 4);
      const streaks = fbm(u * 9 + 83, latitude * 85 + flow * 2 + 37, v * 9 + 47, 3);
      const billows = fbm(x * 18 + flow * 3 + 487, y * 18 + 53, z * 18 + eddy * 3 + 17, 3);
      const storm = smooth(.43, .65, fbm(x * 5 + 491, y * 5 + 71, z * 5 + 29, 3)) * turbulence;
      const resolved = 1 - smooth(.008, .04, footprint);
      const marking = (deck - .5) * (demon ? 2.5 : 1.4) + (streaks - .5) * .18 * resolved
        + (billows - .5) * storm * .65;
      const haze = smooth(.72, .98, Math.abs(y));
      const color = blend(dark, light, clamp((demon ? .40 : .68) + marking * (1 - haze * .30)));
      const height = .003 + smooth(.32, .67, deck) * .003 + storm * (.004 + billows * .012)
        + (billows - .5) * .006 * resolved;
      return { color, height };
  };
  return {
    sample: (x, y, z) => field(x, y, z).color,
    sampleSurface(x, y, z, lightDirection, footprint = 0) {
      const current = field(x, y, z, footprint);
      const incidence = x * lightDirection.x + y * lightDirection.y + z * lightDirection.z;
      let shade = 1;
      const horizontal = Math.sqrt(Math.max(0, 1 - incidence * incidence));
      if (relief && incidence > 0 && horizontal > .01) {
        const direction = [(lightDirection.x - incidence * x) / horizontal,
          (lightDirection.y - incidence * y) / horizontal, (lightDirection.z - incidence * z) / horizontal];
        const offset = distance => unit([x + direction[0] * distance, y + direction[1] * distance, z + direction[2] * distance]);
        const step = Math.max(.0025, Math.min(.014, footprint * .6));
        const slope = (current.height - field(...offset(step), footprint).height) / step;
        const facing = clamp(1 + slope * horizontal * .95, .45, 1.22);
        let shadow = 0;
        if (incidence < .7) {
          for (const distance of [.012, .028]) {
            if (distance < step) continue;
            const obstruction = field(...offset(distance), footprint).height - current.height
              - distance * incidence / horizontal - distance * distance * .5;
            shadow = Math.max(shadow, smooth(0, .002 + footprint * .10, obstruction));
          }
        }
        shade = 1 + (facing * (1 - shadow * .42) - 1) * relief * smooth(0, .06, incidence);
      }
      return { color: current.color, shade };
    },
  };
}

/** Calibrate a coldness threshold over equal-area samples. Raising coverage
 * advances the same ice boundary instead of rerolling terrain or snow patches.
 */
export function createPlanetIce(recipe, terrain) {
  const coverage = recipe.iceCoverage / 100;
  if (coverage <= 0 || coverage >= 1) return { sample: () => coverage <= 0 ? 0 : 1 };
  const key = `${recipe.iceCoverage}:${recipe.mountains}`;
  let cache = iceCache.get(terrain);
  if (!cache) { cache = new Map(); iceCache.set(terrain, cache); }
  if (cache.has(key)) return cache.get(key);
  const coldness = (x, y, z, elevation = terrain.elevation(x, y, z)) => {
    const altitude = Math.max(0, elevation - Math.max(.52, terrain.seaLevel));
    return Math.abs(y) + altitude * .45 * recipe.mountains / 100
      + (terrain.noise(x * 7 + 11, y * 7 + 41, z * 7 + 79) - .5) * .09
      + (["terrestrial", "ocean"].includes(recipe.style) ? (terrain.fbm(x * 55 + 31, y * 55 + 73, z * 55 + 19, 3) - .5) * .035 : 0);
  };
  const samples = Array.from({ length: 2048 }, (_, i) => {
    const y = 1 - (i + .5) / 1024, radius = Math.sqrt(1 - y * y), angle = i * Math.PI * (3 - Math.sqrt(5));
    return coldness(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  }).sort((a, b) => a - b);
  const threshold = samples[Math.floor((1 - coverage) * (samples.length - 1))];
  const edge = ["terrestrial", "ocean"].includes(recipe.style) ? .006 : .02;
  const field = { sample: (x, y, z, elevation) => smooth(threshold - edge, threshold + edge, coldness(x, y, z, elevation)) };
  if (cache.size >= 8) cache.delete(cache.keys().next().value);
  cache.set(key, field);
  return field;
}

export function createPlanetWeather(recipe, terrain, ice) {
  const { noise, fbm, seaLevel } = terrain;
  const amount = recipe.clouds / 100, thickness = recipe.cloudThickness / 100;
  const relief = (recipe.cloudRelief ?? 70) / 100;
  const storminess = recipe.storminess / 100;
  const wispy = recipe.cloudStyle === "wispy", layered = recipe.cloudStyle === "layered", stormy = recipe.cloudStyle === "stormy";
  const living = ["terrestrial", "ocean"].includes(recipe.style);
  const toxic = ["volcanic", "primordial"].includes(recipe.style) ? (recipe.toxicClouds ?? 65) / 100 : 0;
  const cloudColor = [1, 3, 5].map(i => parseInt(recipe.colors.cloud.slice(i, i + 2), 16));
  const blend = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
  // Latitude-dependent shear turns large moisture systems into long bowed
  // fronts. Detail breaks the fronts into cloud streets and convective cells.
  // Sampling a 3D field avoids a longitude seam or a singularity at the poles.
  const moistureAt = (x, y, z, flow, octaves = 4) => {
    if (!living) return fbm(x * 6 + flow * 2.8 + 71, y * 8 + 42, z * 6 + flow * 2 + 23, octaves);
    const shear = y * 1.8 + (flow - .5) * 2;
    const c = Math.cos(shear), s = Math.sin(shear);
    const u = x * c - z * s, v = x * s + z * c;
    const latitude = y + (flow - .5) * .35;
    const front = fbm(u * 4.5 + 71, latitude * 10 + 42, v * 4.5 + 23, 4);
    const broad = noise(x * 3 + 93, y * 3 + 27, z * 3 + 61);
    const tropics = Math.exp(-((latitude / .17) ** 2));
    const dry = Math.exp(-(((Math.abs(latitude) - .43) / .16) ** 2));
    return front * .78 + broad * .22 + tropics * .035 - dry * .045;
  };
  const hurricanes = [];
  // Tropical systems need a patch of open water, not just one wet pixel. The
  // requested count is an upper limit on dry or heavily frozen worlds.
  if (amount > 0 && thickness > 0 && recipe.water > 0 && recipe.iceCoverage < 100) {
    for (let i = 0; i < 384 && hurricanes.length < recipe.hurricanes; i++) {
      const latitude = (.14 + noise(i, 67, 19) * .46) * (i % 2 ? -1 : 1);
      const longitude = i < 32 ? Math.PI / 2 + (noise(i, 31, 73) - .5) * 2.2 : noise(i, 31, 73) * Math.PI * 2;
      const center = [Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude)];
      const east = [-Math.sin(longitude), 0, Math.cos(longitude)];
      const north = [-Math.sin(latitude) * Math.cos(longitude), Math.cos(latitude), -Math.sin(latitude) * Math.sin(longitude)];
      const radius = living ? .075 + noise(i, 43, 89) * .045 : .14 + noise(i, 43, 89) * .075;
      if (hurricanes.some(h => dot(center, h.center) > Math.cos(radius + h.radius))) continue;
      const patch = [center, ...[east, north].flatMap(axis => [-1, 1].map(sign => unit(center.map((v, k) => v + axis[k] * sign * radius * .6))))];
      if (patch.some(p => terrain.elevation(...p) >= seaLevel || ice.sample(...p) > .1)) continue;
      hurricanes.push({ center, east, north, radius, spin: latitude > 0 ? 1 : -1, phase: noise(i, 11, 53) * Math.PI * 2 });
    }
  }
  const densityAt = (x, y, z) => {
    const flow = fbm(x * 2.5 + 73, y * 2.5 + 41, z * 2.5 + 23, 3);
    const moisture = moistureAt(x, y, z, flow);
    const detail = fbm(x * 42 + 17, y * 42 + 53, z * 42 + 89, 3);
    const billows = living || toxic ? fbm(x * 135 + 51, y * 135 + 19, z * 135 + 73, 2) : .5;
    const threshold = .76 - amount * .58;
    const low = smooth(threshold - .05, threshold + .10, moisture + (detail - .5) * (living ? .22 : .18) + (billows - .5) * .075);
    const shear = y * 3 + flow, c = Math.cos(shear), s = Math.sin(shear);
    const cirrus = fbm((x * c - z * s) * 19 + 31, y * 75 + 13, (x * s + z * c) * 19 + 61, 3);
    const high = smooth(threshold, threshold + .16, moisture) * Math.pow(clamp((cirrus - .35) * 2.8), 2);
    const cells = smooth(.50, .70, moisture) * smooth(.35, .72, detail) * storminess;
    let tau = low * (wispy ? .35 : layered ? 2.2 : 1.2) + high * (wispy ? 1.4 : .45) + cells * (stormy ? 4 : 2.4);
    let plume = 0;
    if (toxic && terrain.geology) {
      // A short wind offset stretches volcanic haze away from its source.
      const p = unit([x + .025 * Math.sin(flow * 6), y - .015, z + .025 * Math.cos(flow * 6)]);
      const source = terrain.geology.sample(...p);
      plume = Math.max(source.volcano * .55, source.caldera, source.superCaldera * .85) * toxic * amount;
      tau += plume * (1.5 + billows * 2);
    }
    let cycloneHeight = 0;
    for (const hurricane of hurricanes) {
      const point = [x, y, z];
      if (dot(point, hurricane.center) < Math.cos(hurricane.radius * 1.4)) continue;
      const u = dot(point, hurricane.east) / hurricane.radius, v = dot(point, hurricane.north) / hurricane.radius;
      const radius = Math.hypot(u, v);
      const outer = 1 - smooth(.8, 1.35, radius);
      const eye = smooth(.10, .20, radius);
      const wall = Math.exp(-(((radius - .24 - (detail - .5) * .025) / .075) ** 2));
      const angle = Math.atan2(v, u);
      const arms = Math.pow(.5 + .5 * Math.cos(angle * 2 + hurricane.spin * (radius * 7 + Math.sin(radius * 5) * .8) + hurricane.phase + (detail - .5) * 3), 2);
      const shield = (1 - smooth(.3, .8, radius)) * (.4 + detail * .35);
      const breakup = smooth(.24, .6, detail);
      const cyclone = (arms * .85 * breakup + wall * 1.6 + shield) * outer * eye * (.65 + detail * .7);
      // Clear the eye in every layer, and let spiral rainbands replace the
      // background deck rather than painting a flat disc on top of it.
      tau = tau * (1 - outer * .92) * eye + cyclone * 3.4;
      cycloneHeight = Math.max(cycloneHeight, cyclone);
    }
    const alpha = 1 - Math.exp(-tau * thickness * 1.8);
    const height = (low * .45 + cells * .70 + plume * 1.3 + Math.min(1.5, cycloneHeight) * .5) * thickness * (wispy ? .0015 : .007)
      + alpha * (.5 + billows * .5) * (wispy ? .0005 : .0025);
    return { alpha, height, low, flow, threshold, detail, billows, cells, cycloneHeight, plume };
  };
  const sample = (x, y, z, light = { x: 0, y: 0, z: 1 }, footprint = 0) => {
    if (!amount || !thickness) return { alpha: 0, shade: 1, shadow: 0 };
    const { alpha, height, low, flow, threshold, detail, billows, cells, cycloneHeight, plume } = densityAt(x, y, z);
    // A displaced low deck gives ground shadows a sunward offset. This is a
    // shallow-layer approximation, not a second full ray-marched atmosphere.
    let shadow = 0;
    if (!wispy && low < .96) {
      const p = unit([x + light.x * .018, y + light.y * .018, z + light.z * .018]);
      const displaced = moistureAt(...p, flow, 3);
      shadow = smooth(threshold - .05, threshold + .10, displaced) * thickness * .24;
    }
    let shade = .78 + detail * .23 + (billows - .5) * .12 + cells * .10 + Math.min(1, cycloneHeight) * .10;
    const incidence = x * light.x + y * light.y + z * light.z;
    if (relief && incidence > 0) {
      const horizontal = Math.sqrt(Math.max(0, 1 - incidence * incidence));
      if (horizontal > .01) {
        const direction = [(light.x - incidence * x) / horizontal, (light.y - incidence * y) / horizontal, (light.z - incidence * z) / horizontal];
        const offset = distance => unit([x + direction[0] * distance, y + direction[1] * distance, z + direction[2] * distance]);
        const step = Math.max(.0025, Math.min(.012, footprint * .6));
        const facing = densityAt(...offset(step));
        const slope = (height - facing.height) / step;
        // Lit billow edges and shaded lee sides share one actual density field.
        const lighting = clamp(1 + slope * horizontal * 1.7, .48, 1.28);
        const occlusion = smooth(.0003, .003, facing.height - height - step * incidence / horizontal);
        shade *= 1 + (lighting * (1 - occlusion * .30) - 1) * relief;
        // Intersect the sunlight with a raised cloud deck. Low sunlight casts
        // a longer shadow; cloud gaps and cyclone eyes remain open in it.
        const distance = Math.min(.065, (.006 + height) * horizontal / Math.max(.12, incidence));
        const caster = densityAt(...offset(distance));
        const castShadow = caster.alpha * thickness * (wispy ? .12 : .52) * smooth(0, .06, incidence);
        shadow += (castShadow - shadow) * relief;
      } else {
        shadow += (alpha * thickness * (wispy ? .12 : .52) - shadow) * relief;
      }
    }
    const chemistry = toxic ? noise(x * 4 + 389, y * 4 + 73, z * 4 + 31) : 0;
    const fumes = blend([145, 139, 100], [209, 184, 81], smooth(.32, .67, chemistry));
    const ashColor = blend(fumes, [91, 83, 79], clamp(plume * 2));
    return { alpha, shade, shadow, ...(toxic ? { color: blend(cloudColor, ashColor, toxic * .75) } : {}) };
  };
  return { sample, hurricanes };
}
