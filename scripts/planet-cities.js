/** City-light layouts attached to the globe, independent of camera and sun. */
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const dot = (x, y, z, p) => x * p[0] + y * p[1] + z * p[2];
export const PLANET_CITY_STYLES = { auto: "Automatic for planet type", organic: "Organic / scattered cities", grid: "Planned street grids", circular: "Circular / concentric cities", network: "Linked circular cities", domes: "Domed colonies" };
export function createPlanetCities(recipe, terrain, ice) {
  if (!recipe.cities) return null;
  const { noise, seaLevel } = terrain;
  const style = recipe.cityStyle === "auto" ? ["barren", "ice"].includes(recipe.style) ? "domes" : "organic" : recipe.cityStyle;
  const network = style === "network";
  const iceSettlements = style === "domes" || style === "circular" || network;
  const density = recipe.cities / 100;
  const centers = [];
  if (style !== "organic") {
    const count = Math.ceil(recipe.cities * (network ? .8 : 1.6));
    const rotation = noise(41, 97, 13) * Math.PI * 2;
    // A density-independent candidate sequence preserves placed colonies when
    // the user adds more settlements. Only solid ground or supported ice qualifies.
    for (let i = 0; i < 4096 && centers.length < count; i++) {
      const y = noise(i, 71, 53) * 2 - 1, radius = Math.sqrt(1 - y * y), angle = i * 2.399963229728653 + rotation;
      const center = [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
      const elevation = terrain.elevation(...center), frozen = ice.sample(...center, elevation);
      if ((elevation < seaLevel && !(iceSettlements && frozen > .5)) || (!iceSettlements && frozen > .5)) continue;
      const size = (.010 + recipe.citySize * .00045) * (.65 + noise(i, 19, 83) * .7) * (network ? 1.5 : 1);
      if (centers.some(c => dot(...center, c.center) > 1 - ((size + c.radius) * .7) ** 2 / 2)) continue;
      centers.push({ center, east: [-Math.sin(angle), 0, Math.cos(angle)], north: [-y * Math.cos(angle), radius, -y * Math.sin(angle)], radius: size, phase: noise(i, 23, 61) * Math.PI * 2 });
    }
  }
  const links = [];
  if (network) {
    const seen = new Set();
    for (let i = 0; i < centers.length; i++) {
      const a = centers[i];
      const neighbors = centers.map((b, j) => ({ j, cosine: dot(...a.center, b.center) }))
        .filter(n => n.j !== i && n.cosine > Math.cos(.65)).sort((a, b) => b.cosine - a.cosine);
      let connections = 0;
      for (const neighbor of neighbors) {
        if (connections >= 2) break;
        const j = neighbor.j, key = `${Math.min(i, j)}:${Math.max(i, j)}`;
        if (seen.has(key)) { connections++; continue; }
        const b = centers[j], angle = Math.acos(Math.max(-1, Math.min(1, neighbor.cosine)));
        const tangent = b.center.map((v, k) => (v - a.center[k] * neighbor.cosine) / Math.sin(angle));
        const pointAt = t => a.center.map((v, k) => v * Math.cos(t) + tangent[k] * Math.sin(t));
        // Reject routes crossing open water instead of joining colonies with
        // floating roads. Pixel-level masking also clips coastlines precisely.
        const steps = Math.max(2, Math.ceil(angle / .012));
        let passable = true;
        for (let step = 1; step < steps; step++) {
          const p = pointAt(angle * step / steps), elevation = terrain.elevation(...p);
          if (elevation < seaLevel && ice.sample(...p, elevation) <= .5) { passable = false; break; }
        }
        if (!passable) continue;
        const [x, y, z] = a.center, [u, v, w] = tangent;
        links.push({ a: i, b: j, start: a.center, tangent, normal: [y * w - z * v, z * u - x * w, x * v - y * u],
          angle, center: pointAt(angle / 2), extent: Math.sin(angle / 2 + .025), cutoff: Math.cos(angle / 2 + .025), width: (a.radius + b.radius) * .018 });
        seen.add(key); connections++;
      }
    }
  }
  const bins = Array.from({ length: 8 }, (_, octant) => centers.filter(c => c.center.every((v, axis) => (octant & (1 << axis) ? v : -v) >= -c.radius * 1.2)));
  const linkBins = Array.from({ length: 8 }, (_, octant) => links.filter(link => link.center.every((v, axis) => (octant & (1 << axis) ? v : -v) >= -link.extent)));
  return {
    style, centers, links, iceSettlements,
    sample(x, y, z, elevation, frozen, lightDot, footprint) {
      const night = 1 - smooth(-.10, .15, lightDot);
      if (!night || (elevation < seaLevel && !(iceSettlements && frozen > .5)) || (!iceSettlements && frozen > .5)) return 0;
      if (style === "organic") {
        const coast = recipe.water > 0 ? clamp(1 - (elevation - seaLevel) / .07) : 0;
        const urban = noise(x * 14 + 57, y * 14 + 29, z * 14 + 83);
        const settled = clamp((urban - (.78 - density * .30 - coast * .12)) * 7);
        const streets = Math.pow(clamp((noise(x * 320 + 7, y * 320 + 3, z * 320 + 11) - .5) * 2), 3);
        return settled * streets * density * night * 5;
      }
      const octant = (x >= 0 ? 1 : 0) | (y >= 0 ? 2 : 0) | (z >= 0 ? 4 : 0);
      let emission = 0;
      for (const link of linkBins[octant]) {
        if (dot(x, y, z, link.center) < link.cutoff) continue;
        const along = Math.atan2(dot(x, y, z, link.tangent), dot(x, y, z, link.start));
        if (along < 0 || along > link.angle) continue;
        const across = Math.abs(dot(x, y, z, link.normal));
        const width = link.width + Math.min(.018, footprint * .45);
        const road = Math.exp(-((across / width) ** 2)) * link.width / width;
        emission = Math.max(emission, road * night * 1.65);
      }
      for (const c of bins[octant]) {
        if (dot(x, y, z, c.center) < 1 - (c.radius * 1.2) ** 2 / 2) continue;
        const east = dot(x, y, z, c.east) / c.radius, north = dot(x, y, z, c.north) / c.radius;
        const u = east * Math.cos(c.phase) - north * Math.sin(c.phase), v = east * Math.sin(c.phase) + north * Math.cos(c.phase);
        const r = Math.hypot(u, v), edge = 1 - smooth(.9, 1.15, r);
        const filter = Math.min(.28, footprint / c.radius * .45), width = .05 + filter;
        const ring = target => Math.exp(-(((r - target) / width) ** 2)) * .05 / width;
        const angle = Math.atan2(v, u);
        const spokes = Math.pow(.5 + .5 * Math.cos(angle * (style === "domes" ? 6 : 8)), 18) * (1 - smooth(.7, 1, r));
        let lights;
        if (style === "grid") {
          const road = Math.min(Math.abs(Math.sin(u * 12)), Math.abs(Math.sin(v * 12)));
          lights = (1 - smooth(.08, .20 + filter * 3, road)) * .55;
        } else if (network) {
          const avenues = Math.pow(.5 + .5 * Math.cos(angle * 6), 24) * smooth(.16, .25, r) * (1 - smooth(.82, .9, r));
          lights = ring(.84) + ring(.24) * .85 + avenues * .55 + Math.exp(-r * r * 100) * .3;
        } else if (style === "circular") lights = ring(.80) * .9 + ring(.46) * .7 + spokes * .4 + Math.exp(-r * r * 80) * .5;
        else lights = ring(.82) + spokes * .28 + Math.exp(-r * r * 4) * .24;
        emission = Math.max(emission, lights * edge * night * 1.8);
      }
      return emission;
    },
  };
}
