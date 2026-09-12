/** Seeded, continuous landforms in body coordinates, shared by both cameras.
 * These are illustrative planetary-scale features, not a tectonic simulation.
 */
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const dot = (x, y, z, p) => x * p[0] + y * p[1] + z * p[2];

export function createPlanetGeology(recipe, noise) {
  const canyonStrength = recipe.canyons / 100, basinStrength = recipe.impactBasins / 100, volcanoStrength = recipe.shieldVolcanoes / 100;
  if (!canyonStrength && !basinStrength && !volcanoStrength) return null;
  const phase = Math.PI / 2 + (noise(31, 73, 19) - .5) * 1.2;
  const frame = (longitude, latitude, angle = 0) => {
    const c = Math.cos(latitude), s = Math.sin(latitude), u = Math.cos(longitude), v = Math.sin(longitude);
    const east = [-v, 0, u], north = [-s * u, c, -s * v];
    return { center: [c * u, s, c * v],
      along: east.map((n, i) => n * Math.cos(angle) + north[i] * Math.sin(angle)),
      across: north.map((n, i) => n * Math.cos(angle) - east[i] * Math.sin(angle)) };
  };
  const canyons = canyonStrength ? Array.from({ length: 3 }, (_, i) => ({
    ...frame(phase + i * 2.4, (noise(i, 51, 97) - .5) * .8, (noise(i, 17, 29) - .5) * .8),
    length: .48 + noise(i, 71, 43) * .22, width: .025 + noise(i, 83, 11) * .016, phase: noise(i, 41, 61) * 6.28,
  })) : [];
  const basins = basinStrength ? Array.from({ length: 3 }, (_, i) => ({
    ...frame(phase + .75 + i * 2.4, -.15 + (noise(i, 19, 41) - .5) * .6),
    radius: .19 + noise(i, 73, 83) * .11,
  })) : [];
  const volcanoes = volcanoStrength ? Array.from({ length: 4 }, (_, i) => ({
    ...frame(phase - .5 + i * 2.1, .45 + (noise(i, 13, 37) - .5) * .5),
    radius: .14 + noise(i, 59, 89) * .075,
  })) : [];
  const course = (u, p) => Math.sin(u * 9 + p) * .025 + Math.sin(u * 21 + p * .7) * .012;
  const sample = (x, y, z) => {
    let canyon = 0, basin = 0, volcano = 0, delta = 0, flatten = 0;
    for (const f of canyons) {
      if (dot(x, y, z, f.center) < .68) continue;
      const u = dot(x, y, z, f.along), v = dot(x, y, z, f.across);
      const width = f.width * (.8 + .2 * Math.sin(u * 31 + f.phase));
      const distance = Math.abs(v - course(u, f.phase)) / width;
      // A narrow floor nested inside wider sloping walls reads as a chasm,
      // with a shallow outer terrace rather than a single ink-like fissure.
      const main = ((1 - smooth(.35, 1.15, distance)) * .72 + (1 - smooth(1, 2, distance)) * .28)
        * (1 - smooth(f.length * .65, f.length, Math.abs(u)));
      let valley = main;
      // Narrow tributary chasms join the main rift at two seeded junctions.
      for (const side of [-1, 1]) {
        const start = side * f.length * .22, t = (u - start) / (side * .22);
        if (t < 0 || t > 1) continue;
        const branch = course(u, f.phase) + side * (.24 * t + .025 * Math.sin(t * 5));
        const mask = (1 - smooth(.45, 1.25, Math.abs(v - branch) / (width * .5))) * (1 - smooth(.65, 1, t));
        valley = Math.max(valley, mask * .8);
      }
      canyon = Math.max(canyon, valley * canyonStrength);
    }
    delta -= canyon * .20;
    flatten = canyon * .5;
    for (const f of basins) {
      const d = dot(x, y, z, f.center);
      if (d < 1 - (f.radius * 1.3) ** 2 / 2) continue;
      const u = dot(x, y, z, f.along), v = dot(x, y, z, f.across);
      const rough = noise(x * 25 + 17, y * 25 + 59, z * 25 + 31) - .5;
      const radius = Math.hypot(u, v) / f.radius + rough * .09;
      const floor = 1 - smooth(.55, 1, radius);
      const rim = Math.exp(-(((radius - 1) / .105) ** 2)) * (1 - smooth(1.12, 1.25, radius));
      delta += (-floor * .18 + rim * .035) * basinStrength;
      basin = Math.max(basin, floor * basinStrength);
      flatten = Math.max(flatten, basin * .75);
    }
    for (const f of volcanoes) {
      const d = dot(x, y, z, f.center);
      if (d < 1 - (f.radius * 1.15) ** 2 / 2) continue;
      const radius = Math.hypot(dot(x, y, z, f.along), dot(x, y, z, f.across)) / f.radius;
      const shield = (1 - smooth(.05, 1, radius)) ** 1.35;
      const caldera = 1 - smooth(.08, .19, radius);
      delta += (shield * .24 - caldera * .095) * volcanoStrength;
      volcano = Math.max(volcano, shield * volcanoStrength);
      flatten = Math.max(flatten, volcano * .75);
    }
    return { delta, flatten, canyon, basin, volcano };
  };
  return { sample, canyons, basins, volcanoes };
}
