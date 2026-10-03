/** Regional regolith plains, broken highlands, and discontinuous scarps.
 * Sampled in sphere coordinates; no repeating latitude/longitude layout.
 */
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const dot = (x, y, z, p) => x * p[0] + y * p[1] + z * p[2];
export function createBarrenLandforms({ noise, fbm }, rock) {
  const scarps = Array.from({ length: 14 }, (_, i) => {
    const y = noise(i, 211, 43) * 1.8 - .9, angle = noise(i, 223, 71) * Math.PI * 2;
    const radius = Math.sqrt(1 - y * y), east = [-Math.sin(angle), 0, Math.cos(angle)];
    const north = [-y * Math.cos(angle), radius, -y * Math.sin(angle)], turn = noise(i, 227, 91) * Math.PI;
    return { center: [radius * Math.cos(angle), y, radius * Math.sin(angle)],
      along: east.map((n, k) => n * Math.cos(turn) + north[k] * Math.sin(turn)),
      across: north.map((n, k) => n * Math.cos(turn) - east[k] * Math.sin(turn)),
      length: .17 + noise(i, 229, 53) * .35, width: .012 + noise(i, 233, 17) * .022,
      phase: noise(i, 239, 37) * Math.PI * 2 };
  });
  const ancientImpacts = scarps.slice(0, 10).map((f, i) => ({ ...f,
    radius: .09 + noise(i, 251, 47) ** 2 * .20,
    wear: .35 + noise(i, 257, 83) * .50 }));
  const sample = (x, y, z, footprint = 0) => {
    // Warping changes direction and spacing locally, avoiding a tiled gravel
    // appearance. Independent provinces decide where exposed relief survives.
    const a = x + (noise(x * 4 + 53, y * 4 + 97, z * 4 + 17) - .5) * .32;
    const b = y + (noise(x * 4 + 79, y * 4 + 31, z * 4 + 109) - .5) * .32;
    const c = z + (noise(x * 4 + 113, y * 4 + 59, z * 4 + 41) - .5) * .32;
    const province = fbm(a * 3.6 + 137, b * 3.6 + 23, c * 3.6 + 71, 3);
    const highland = smooth(.39, .62, province);
    const dust = smooth(.43, .64, fbm(a * 6 + 47, b * 6 + 151, c * 6 + 83, 3));
    const roughness = highland * (1 - dust * .85);
    const crags = fbm(a * 24 + 19, b * 24 + 73, c * 24 + 131, 4) - .5;
    const resolved = 1 - smooth(.008, .045, footprint);
    const bedrock = rock(a, b, c, 1.35);
    let relief = (highland - .5) * .016 + crags * roughness * .040;
    relief += (bedrock - .5) * roughness * .016 * resolved;
    const rubble = fbm(a * 95 + 157, b * 95 + 61, c * 95 + 37, 2) - .5;
    relief += rubble * roughness * .0035 * (1 - smooth(.003, .012, footprint));
    let scarp = 0, basin = 0;
    for (const f of ancientImpacts) {
      if (dot(x, y, z, f.center) < 1 - (f.radius * 1.7) ** 2 / 2) continue;
      const u = dot(x, y, z, f.along), v = dot(x, y, z, f.across);
      const angle = Math.atan2(v, u);
      const irregular = 1 + Math.sin(angle * 5 + f.phase) * .08 + Math.sin(angle * 9 - f.phase) * .035;
      const distance = Math.hypot(u, v) / (f.radius * irregular);
      const floor = 1 - smooth(.4, .95, distance);
      const width = .13 + f.wear * .12;
      const rim = Math.exp(-(((distance - 1) / width) ** 2)) * (1 - smooth(1.35, 1.65, distance));
      const breaks = .3 + noise(x * 35 + 19, y * 35 + 163, z * 35 + 67) * .7;
      relief += (-floor * .015 + rim * .021 * breaks) * (1 - f.wear * .6);
      basin = Math.max(basin, floor * .65);
    }
    for (const f of scarps) {
      if (dot(x, y, z, f.center) < .75) continue;
      const u = dot(x, y, z, f.along), v = dot(x, y, z, f.across);
      const course = Math.sin(u * 11 + f.phase) * .035 + Math.sin(u * 29 - f.phase) * .012;
      const width = f.width + footprint * .4;
      const flank = (v - course) / width;
      const reach = 1 - smooth(f.length * .55, f.length, Math.abs(u));
      const broken = smooth(.28, .57, noise(x * 19 + 83, y * 19 + 37, z * 19 + 61));
      const mask = reach * (.25 + broken * .75) * (.35 + highland * .65);
      // An asymmetric ledge with a raised, fragmented crest and a broad foot.
      const crest = Math.exp(-((flank / .8) ** 2));
      const foot = Math.exp(-(((flank - 1.3) / 2.2) ** 2));
      relief += (crest * .009 + foot * .004) * mask;
      scarp = Math.max(scarp, crest * mask);
    }
    return { relief, highland, roughness, dust, scarp, bedrock, basin };
  };
  return { sample, scarps, ancientImpacts };
}
