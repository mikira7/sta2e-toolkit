/** Illustrative spherical plate provinces and relative boundary motion. */
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const PLANET_CRUST_TYPES = { auto: "Seeded choice", active: "Active crust plates", ancient: "Ancient / inactive plates", stagnant: "Single / stagnant crust", none: "No crust plates" };
export function createPlanetCrust(recipe, noise) {
  const mode = recipe.crustPlates === "auto" ? noise(307, 73, 41) > .25 ? "active" : "none" : recipe.crustPlates;
  if (!mode || mode === "none") return null;
  if (mode === "stagnant") return {
    mode, plates: [{ id: 0, center: [0, 0, 1], continental: true, velocity: [0, 0, 0] }], boundaries: [],
    sample: () => ({ delta: 0, continental: 1, mountain: 0, trench: 0, ridge: 0, rift: 0 }),
  };
  const count = recipe.texture === "archipelago" ? 20 : recipe.texture === "supercontinent" ? 12 : 16;
  const phase = noise(311, 19, 97) * Math.PI * 2, activity = mode === "ancient" ? .30 : 1;
  const continentalChance = recipe.texture === "archipelago" ? .28 : recipe.texture === "supercontinent" ? .65 : .48;
  const plates = Array.from({ length: count }, (_, i) => {
    const y = clamp(1 - (i + .5) * 2 / count + (noise(i, 313, 83) - .5) * .045, -.98, .98);
    const radius = Math.sqrt(1 - y * y), angle = phase + i * 2.399963229728653 + (noise(i, 317, 53) - .5) * .22;
    const center = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
    const east = [-Math.sin(angle), 0, Math.cos(angle)], north = [-y * Math.cos(angle), radius, -y * Math.sin(angle)];
    const driftAngle = noise(i, 331, 71) * Math.PI * 2, speed = .4 + noise(i, 337, 31) * .6;
    return { id: i, center, continental: noise(i, 347, 109) < continentalChance,
      velocity: east.map((n, k) => (n * Math.cos(driftAngle) + north[k] * Math.sin(driftAngle)) * speed) };
  });
  // Guarantee both crust provinces, even for a rare homogeneous seeded draw.
  if (!plates.some(p => p.continental)) plates[0].continental = true;
  if (plates.every(p => p.continental)) plates[count - 1].continental = false;
  const boundaries = [];
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
    const a = plates[i], b = plates[j], separation = a.center.map((v, k) => v - b.center[k]);
    const length = Math.hypot(...separation);
    const motion = a.velocity.reduce((sum, v, k) => sum + (v - b.velocity[k]) * separation[k] / length, 0);
    const compress = clamp(-motion * .65), spread = clamp(motion * .65);
    const land = Number(a.continental) + Number(b.continental);
    boundaries.push({ i, j, mountain: compress * (land === 2 ? 1 : land === 1 ? .72 : .18),
      trench: compress * (land === 1 ? 1 : land === 0 ? .65 : 0),
      ridge: spread * (land === 0 ? 1 : land === 1 ? .35 : 0), rift: spread * (land === 2 ? 1 : 0) });
  }
  const sample = (x, y, z) => {
    const scores = plates.map(p => x * p.center[0] + y * p.center[1] + z * p.center[2]);
    const best = Math.max(...scores), weights = scores.map(s => Math.exp((s - best) * 32));
    const total = weights.reduce((a, b) => a + b, 0);
    let continental = 0, mountain = 0, trench = 0, ridge = 0, rift = 0;
    for (let i = 0; i < count; i++) { weights[i] /= total; continental += weights[i] * Number(plates[i].continental); }
    for (const b of boundaries) {
      const contact = weights[b.i] * weights[b.j] * 4;
      if (contact < .00001) continue;
      mountain += contact * b.mountain; trench += contact * b.trench;
      ridge += contact * b.ridge; rift += contact * b.rift;
    }
    mountain = clamp(mountain) * activity; trench = clamp(trench) * activity;
    ridge = clamp(ridge) * activity; rift = clamp(rift) * activity;
    const delta = (continental - .45) * .14 + mountain * .055 + ridge * .040 - trench * .065 - rift * .030;
    return { delta, continental, mountain, trench, ridge, rift };
  };
  return { mode, plates, boundaries, sample };
}
