/** Barren-world impact relief in fixed sphere coordinates. */
import { sampleBarrenImpactDetail } from "./barren-textures.js";
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function createBarrenCraters(recipe, terrain) {
  const { noise } = terrain;
  const craters = [];
  // Separate populations keep the old large-impact positions and add many
  // more small impacts. Density extends each seeded sequence independently.
  for (const small of [false, true]) {
    const count = Math.round(recipe.craterDensity * (small ? 24 : 2));
    for (let i = 0; i < count; i++) {
      const id = i + (small ? 8192 : 0);
      const angle = noise(id, 91, 37) * Math.PI * 2, y = noise(id, 83, 61) * 2 - 1;
      const horizontal = Math.sqrt(1 - y * y);
      const radius = small ? .003 + noise(id, 53, 47) ** 3 * .023 : .012 + noise(id, 53, 47) ** 3 * .16;
      const center = [Math.cos(angle) * horizontal, y, Math.sin(angle) * horizontal];
      const east = [-Math.sin(angle), 0, Math.cos(angle)];
      const north = [-y * Math.cos(angle), horizontal, -y * Math.sin(angle)];
      const fresh = .25 + noise(id, 23, 79) * .75;
      craters.push({ id, center, east, north, radius, fresh,
        phase: noise(id, 47, 17) * Math.PI * 2,
        depth: (.065 + fresh * .10) * (radius > .055 ? .65 : 1),
        complex: smooth(.045, .085, radius), reach: radius * 2.6 });
    }
  }
  // Larger impacts go down first; small bowls replace their
  // floors/rims locally. Cube cells bound the work even at maximum density.
  const ordered = [...craters].sort((a, b) => b.radius - a.radius);
  const grid = 16, bins = Array.from({ length: grid ** 3 }, () => []);
  const cell = v => clamp(Math.floor((v + 1) * grid / 2), 0, grid - 1);
  for (const crater of ordered) {
    const lo = crater.center.map(v => cell(v - crater.reach)), hi = crater.center.map(v => cell(v + crater.reach));
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) bins[(z * grid + y) * grid + x].push(crater);
  }
  const sample = (x, y, z, light, footprint = 0) => {
    const p = [x, y, z], l = [light.x, light.y, light.z];
    const incidence = dot(p, l);
    let albedo = 1, slopeX = 0, slopeY = 0, slopeZ = 0, shadow = 1, coverage = 0;
    for (const c of bins[(cell(z) * grid + cell(y)) * grid + cell(x)]) {
      const dx = x - c.center[0], dy = y - c.center[1], dz = z - c.center[2];
      if (dx * dx + dy * dy + dz * dz > c.reach ** 2) continue;
      const u = dot(p, c.east) / c.radius, v = dot(p, c.north) / c.radius;
      const distance = Math.hypot(u, v), angle = Math.atan2(v, u);
      const irregular = 1 + .014 * Math.sin(angle * 5 + c.phase) + .009 * Math.cos(angle * 9 - c.phase);
      const r = distance / irregular;
      const resolved = smooth(.35, 1.8, c.radius / Math.max(.00001, footprint));
      if (!resolved) continue;
      // A broad debris apron with broken radial rays, strongest on fresh
      // impacts. It fades well before the spatial-bin boundary.
      const rayPhase = angle * (7 + c.id % 11) + c.phase + Math.sin(angle * 3 - c.phase) * 2 + r * .18;
      const rays = Math.pow(.5 + .5 * Math.sin(rayPhase), 12) * smooth(.65, .95, c.fresh);
      const ejecta = smooth(.95, 1.08, r) * (1 - smooth(1.12, 2.45, r));
      const debris = ejecta ? .35 + noise(u * 4 + 41, v * 4 + 71, c.id * .71) * .65 : 0;
      albedo += ejecta * (.03 + rays * .14) * debris * c.fresh * resolved;
      if (r > 1.4) continue;
      const floorRadius = .12 + c.complex * .32;
      const t = clamp((r - floorRadius) / (1 - floorRadius));
      const bowl = -c.depth * (1 - t * t * (3 - 2 * t));
      const bowlSlope = r < 1 ? c.depth * 6 * t * (1 - t) / (1 - floorRadius) : 0;
      const rimWidth = .065 + (1 - c.fresh) * .075;
      const rim = Math.exp(-(((r - 1) / rimWidth) ** 2));
      const rimHeight = .008 + c.fresh * .011;
      const peak = Math.exp(-((r / .18) ** 2)) * c.complex * c.depth * .65;
      // Stamp data contains height only, so terraced and broken walls follow
      // the sun. Suppress stamp detail before its texels become subpixel.
      const detailWeight = (1 - smooth(.025, .13, footprint / c.radius)) * (.4 + c.fresh * .6);
      const detailScale = .008 * detailWeight;
      const detail = detailScale ? sampleBarrenImpactDetail(c.id, u, v, c.phase) : 0;
      const height = bowl + rimHeight * rim + peak + detail * detailScale;
      const step = .025;
      const du = detailScale ? (sampleBarrenImpactDetail(c.id, u + step, v, c.phase) - sampleBarrenImpactDetail(c.id, u - step, v, c.phase)) * detailScale / (2 * step) : 0;
      const dv = detailScale ? (sampleBarrenImpactDetail(c.id, u, v + step, c.phase) - sampleBarrenImpactDetail(c.id, u, v - step, c.phase)) * detailScale / (2 * step) : 0;
      const derivative = bowlSlope - 2 * (r - 1) / rimWidth ** 2 * rimHeight * rim - 2 * r / .18 ** 2 * peak;
      const interior = (1 - smooth(.85, 1.18, r)) * resolved;
      // Smooth sediment-covered floors interrupt the older relief below.
      const weight = (1 - smooth(1.12, 1.4, r)) * resolved;
      const radial = distance > 1e-6 ? c.east.map((n, k) => (n * u + c.north[k] * v) / distance) : [0, 0, 0];
      const projection = dot(radial, p);
      const detailSlope = c.east.map((n, i) => n * du + c.north[i] * dv);
      const detailProjection = dot(detailSlope, p);
      slopeX = slopeX * (1 - weight) + ((radial[0] - x * projection) * derivative + detailSlope[0] - x * detailProjection) * weight;
      slopeY = slopeY * (1 - weight) + ((radial[1] - y * projection) * derivative + detailSlope[1] - y * detailProjection) * weight;
      slopeZ = slopeZ * (1 - weight) + ((radial[2] - z * projection) * derivative + detailSlope[2] - z * detailProjection) * weight;
      albedo = albedo * (1 - interior) + (1 - .10 * (1 - c.fresh) + rim * .07 * c.fresh) * interior;
      coverage = Math.max(coverage, interior);
      // Intersect a ray toward the sun with the enclosing rim in the local
      // tangent plane. Low sunlight leaves a shadow on the crater floor.
      let visible = 1;
      if (r < .98) {
        const lu = dot(l, c.east), lv = dot(l, c.north), horizontalLight = Math.hypot(lu, lv);
        if (horizontalLight > .0001) {
          const along = (u * lu + v * lv) / horizontalLight;
          const travel = Math.max(0, -along + Math.sqrt(Math.max(0, along * along + irregular * irregular - distance * distance)));
          const clearance = height + travel * incidence / horizontalLight - rimHeight;
          visible = .12 + .88 * smooth(-.025, .015, clearance);
        }
      }
      shadow = shadow * (1 - weight) + visible * weight;
    }
    const length = Math.hypot(x - slopeX, y - slopeY, z - slopeZ);
    const normalLight = ((x - slopeX) * light.x + (y - slopeY) * light.y + (z - slopeZ) * light.z) / length;
    return { albedo: clamp(albedo, .7, 1.3), normalLight, shadow, coverage };
  };
  return { craters, sample };
}
