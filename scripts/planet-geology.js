/** Seeded, continuous landforms in body coordinates, shared by both cameras.
 * These are illustrative planetary-scale features, not a tectonic simulation.
 */
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const dot = (x, y, z, p) => x * p[0] + y * p[1] + z * p[2];

export function createPlanetGeology(recipe, noise) {
  const canyonStrength = recipe.canyons / 100, basinStrength = recipe.impactBasins / 100, volcanoStrength = recipe.shieldVolcanoes / 100;
  const dryGeology = ["desert", "barren"].includes(recipe.style);
  const hotGeology = ["volcanic", "primordial"].includes(recipe.style);
  const lavaStrength = dryGeology || hotGeology ? (recipe.lavaBeds ?? 0) / 100 : 0;
  const lavaBasinStrength = hotGeology ? (recipe.lavaBasins ?? 0) / 100 : 0;
  const superStrength = hotGeology ? (recipe.superVolcanoes ?? 0) / 100 : 0;
  const giantStrength = dryGeology ? (recipe.giantImpactBasin ?? 0) / 100 : 0;
  if (!canyonStrength && !basinStrength && !volcanoStrength && !lavaStrength && !giantStrength && !lavaBasinStrength && !superStrength) return null;
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
  const lavaBeds = lavaStrength ? Array.from({ length: 5 }, (_, i) => ({
    ...frame(phase + .25 + i * 2.4, (noise(i, 107, 43) - .5) * 1.6, noise(i, 127, 71) * Math.PI),
    length: .32 + noise(i, 109, 83) * .14,
    width: .18 + noise(i, 137, 59) * .10,
    phase: noise(i, 149, 31) * Math.PI * 2,
  })) : [];
  const lavaBasins = lavaBasinStrength ? Array.from({ length: 4 }, (_, i) => ({
    ...frame(phase + .9 + i * 2.2, (noise(i, 307, 43) - .5) * 1.5),
    radius: .20 + noise(i, 311, 71) * .15, phase: noise(i, 313, 59) * Math.PI * 2,
  })) : [];
  const superVolcanoes = superStrength ? Array.from({ length: 2 }, (_, i) => ({
    ...frame(phase - .7 + i * 2.8, (noise(i, 317, 83) - .5) * 1.2),
    radius: .27 + noise(i, 331, 97) * .10, phase: noise(i, 337, 31) * Math.PI * 2,
  })) : [];
  const giantImpact = giantStrength ? {
    ...frame(phase + .4, (noise(173, 59, 31) - .5) * .9, noise(179, 43, 71) * Math.PI),
    radius: 1.30 + noise(181, 29, 83) * .14,
    phase: noise(191, 47, 61) * Math.PI * 2,
  } : null;
  const course = (u, p) => Math.sin(u * 9 + p) * .025 + Math.sin(u * 21 + p * .7) * .012;
  const sample = (x, y, z) => {
    let canyon = 0, basin = 0, volcano = 0, delta = 0, flatten = 0, lavaBed = 0, lavaFlow = 0, lavaRille = 0;
    let lavaBasin = 0, superCaldera = 0, caldera = 0, ash = 0;
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
      const summit = 1 - smooth(.08, .19, radius);
      delta += (shield * .24 - summit * .095) * volcanoStrength;
      caldera = Math.max(caldera, summit * volcanoStrength);
      volcano = Math.max(volcano, shield * volcanoStrength);
      flatten = Math.max(flatten, volcano * .75);
    }
    for (const f of lavaBeds) {
      if (dot(x, y, z, f.center) < .72) continue;
      const u = dot(x, y, z, f.along), v = dot(x, y, z, f.across);
      const bend = Math.sin(u * 9 + f.phase) * .035 + Math.sin(u * 23 - f.phase) * .012;
      const nu = u / f.length, nv = (v - bend) / f.width;
      const angle = Math.atan2(nv, nu);
      // Uneven lobes interrupt the oval footprint without a hard border.
      const edge = 1 + Math.sin(angle * 3 + f.phase) * .13 + Math.sin(angle * 7 - f.phase) * .06;
      const distance = Math.hypot(nu, nv) / edge;
      const deposit = (1 - smooth(.72, 1.10, distance)) * lavaStrength;
      if (!deposit) continue;
      // Broad flow fronts and a meandering collapsed channel supply subdued
      // relief. They are solid terrain, with no emissive material component.
      const fronts = Math.sin(nu * 25 + Math.sin(nv * 5 + f.phase) * 2 + f.phase);
      const resolvedFront = fronts * .5 + .5;
      const channel = Math.abs(v - bend - Math.sin(u * 14 + f.phase) * .018);
      const rille = (1 - smooth(.002, .009, channel)) * (1 - smooth(.65, 1, Math.abs(nu))) * deposit;
      delta += deposit * (-.055 + fronts * .004) - rille * .009;
      flatten = Math.max(flatten, deposit * .88);
      if (deposit > lavaBed) { lavaBed = deposit; lavaFlow = resolvedFront * deposit; }
      lavaRille = Math.max(lavaRille, rille);
    }
    for (const [features, strength, superSized] of [[lavaBasins, lavaBasinStrength, false], [superVolcanoes, superStrength, true]]) {
      for (const f of features) {
        if (dot(x, y, z, f.center) < 1 - (f.radius * 1.6) ** 2 / 2) continue;
        const u = dot(x, y, z, f.along), v = dot(x, y, z, f.across), angle = Math.atan2(v, u);
        const edge = 1 + Math.sin(angle * 3 + f.phase) * .14 + Math.sin(angle * 7 - f.phase) * .05;
        const d = Math.hypot(u, v) / (f.radius * edge);
        const floor = (1 - smooth(.55, .93, d)) * strength;
        const rim = Math.exp(-(((d - 1) / (superSized ? .12 : .09)) ** 2)) * strength;
        const breaks = .45 + noise(x * 18 + 347, y * 18 + 61, z * 18 + 23) * .55;
        delta += -floor * (superSized ? .14 : .10) + rim * breaks * (superSized ? .070 : .024);
        flatten = Math.max(flatten, floor * .90);
        if (superSized) {
          superCaldera = Math.max(superCaldera, floor);
          volcano = Math.max(volcano, rim);
          ash = Math.max(ash, (1 - smooth(1.05, 1.55, d)) * strength);
        } else lavaBasin = Math.max(lavaBasin, floor);
      }
    }
    let giantBasin = 0, giantScarp = 0;
    if (giantImpact) {
      const f = giantImpact;
      const angle = Math.atan2(dot(x, y, z, f.across), dot(x, y, z, f.along));
      const radius = f.radius * (1 + Math.cos(angle * 2 + f.phase) * .10 + (noise(x * 3 + 71, y * 3 + 31, z * 3 + 97) - .5) * .10);
      const distance = Math.acos(clamp(dot(x, y, z, f.center), -1, 1)) / radius;
      const floor = 1 - smooth(.68, 1.10, distance);
      const rim = Math.exp(-(((distance - 1.04) / .10) ** 2));
      const broken = .30 + noise(x * 8 + 29, y * 8 + 73, z * 8 + 41) * .70;
      giantBasin = floor * giantStrength; giantScarp = rim * broken * giantStrength;
      delta += -giantBasin * .18 + giantScarp * .018;
      flatten = Math.max(flatten, giantBasin * .94);
    }
    return { delta, flatten, canyon, basin, volcano, caldera, lavaBed, lavaFlow, lavaRille, lavaBasin, superCaldera, ash, giantBasin, giantScarp };
  };
  return { sample, canyons, basins, volcanoes, lavaBeds, lavaBasins, superVolcanoes, giantImpact };
}
