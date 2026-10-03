/** Irregular rock geometry and impact relief, sampled in body coordinates. */
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = p => { const length = Math.hypot(...p) || 1; return p.map(v => v / length); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));

export function createAsteroidMaterial(recipe, { noise, fbm }, colors) {
  const icy = recipe.texture === "icy", carbon = recipe.texture === "carbonaceous", metal = recipe.texture === "metallic";
  const axes = [1, .60 + noise(79, 17, 41) * .23, .68 + noise(43, 59, 13) * .20];
  const direction = i => {
    const y = noise(i, 47, 13) * 2 - 1, lon = noise(i, 73, 31) * Math.PI * 2, r = Math.sqrt(1 - y * y);
    return [r * Math.cos(lon), y, r * Math.sin(lon)];
  };
  const facets = Array.from({ length: 14 }, (_, i) => ({ normal: direction(i + 2048), distance: .73 + noise(i, 71, 29) * .20 }));
  const baseRadius = p => {
    const broad = noise(p[0] * 2.3 + 31, p[1] * 2.3 + 17, p[2] * 2.3 + 79);
    const blocks = noise(p[0] * 6 + 13, p[1] * 6 + 53, p[2] * 6 + 97);
    let radius = .76 + broad * .28 + (blocks - .5) * .075;
    for (const f of facets) {
      const facing = dot(p, f.normal);
      if (facing > 0) radius = Math.min(radius, f.distance / facing);
    }
    return radius;
  };
  const craters = Array.from({ length: icy ? 60 : 110 }, (_, i) => ({
    center: direction(i), radius: .022 + noise(i, 23, 89) ** 3 * .25,
    depth: (icy ? .075 : .11) * (.45 + noise(i, 53, 41) * .55),
    fresh: noise(i, 19, 67),
  })).sort((a, b) => b.radius - a.radius);
  const grid = 12, bins = Array.from({ length: grid ** 3 }, () => []);
  const cell = v => clamp(Math.floor((v + 1) * grid / 2), 0, grid - 1);
  for (const c of craters) {
    const lo = c.center.map(v => cell(v - c.radius * 1.5)), hi = c.center.map(v => cell(v + c.radius * 1.5));
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) bins[(z * grid + y) * grid + x].push(c);
  }
  const impacts = (p, footprint = 0) => {
    let height = 0, floor = 0, ejecta = 0;
    const gradient = [0, 0, 0];
    for (const c of bins[(cell(p[2]) * grid + cell(p[1])) * grid + cell(p[0])]) {
      const delta = p.map((v, i) => v - c.center[i]), distance = Math.hypot(...delta), r = distance / c.radius;
      if (r >= 1.5) continue;
      const resolved = smooth(.3, 1.5, c.radius / Math.max(.00001, footprint));
      const t = clamp((r - .15) / .85), bowl = 1 - t * t * (3 - 2 * t);
      const rimWidth = .09 + (1 - c.fresh) * .05;
      const rim = Math.exp(-(((r - 1) / rimWidth) ** 2));
      const mask = 1 - smooth(1.2, 1.5, r);
      const h = -bowl * c.depth + rim * .016;
      const slope = (r < 1 ? c.depth * 6 * t * (1 - t) / .85 : 0) - rim * .032 * (r - 1) / rimWidth ** 2;
      // Small impacts cut into older ones instead of piling their rims up.
      const weight = (1 - smooth(.8, 1.2, r)) * resolved;
      height = height * (1 - weight) + h * c.radius * mask * resolved;
      const radial = delta.map(v => v / Math.max(distance, .000001));
      const projection = dot(radial, p);
      for (let k = 0; k < 3; k++) gradient[k] = gradient[k] * (1 - weight) + (radial[k] - projection * p[k]) * slope * mask * resolved;
      floor = Math.max(floor, bowl * resolved);
      ejecta = Math.max(ejecta, rim * c.fresh * resolved);
    }
    return { height, gradient, floor, ejecta };
  };
  const point = (p, impact = true) => {
    const radius = baseRadius(p) + (impact ? impacts(p).height : 0);
    return p.map((v, i) => v * axes[i] * radius);
  };
  const relief = p => {
    const coarse = fbm(p[0] * 22 + 71, p[1] * 22 + 13, p[2] * 22 + 47, 3);
    const fine = fbm(p[0] * 85 + 19, p[1] * 85 + 59, p[2] * 85 + 31, 3);
    // Angular exposed blocks embedded in finer regolith, rather than a
    // high-contrast speckle painted over an otherwise smooth potato shape.
    return Math.abs(coarse - .48) * .018 + (fine - .5) * .004;
  };
  const sample = (p, baseNormal, light, view, footprint) => {
    const impact = impacts(p, footprint);
    const normal = unit(baseNormal.map((v, i) => v - impact.gradient[i] / axes[i]));
    const sun = dot(normal, light);
    const region = fbm(p[0] * 4 + 37, p[1] * 4 + 19, p[2] * 4 + 73, 3);
    const regolith = fbm(p[0] * 32 + 3, p[1] * 32 + 11, p[2] * 32 + 29, 3);
    let color = mix(colors.surfaceLow, colors.surfaceHigh, .32 + region * .40 + (regolith - .5) * .16);
    color = mix(color, colors.surfaceLow, impact.floor * .10);
    color = mix(color, colors.surfaceHigh, impact.ejecta * .10);
    if (icy) {
      const frost = smooth(.45, .66, region + impact.floor * .09);
      color = mix(color, colors.surfaceHigh, frost * .65);
    }
    const step = .0025;
    const towardSun = unit(p.map((v, i) => v + light[i] * step));
    const rough = (relief(p) - relief(towardSun)) / step * (1 - impact.floor * .75) * (1 - smooth(.02, .06, footprint));
    const ambient = recipe.nightBrightness / 100;
    const diffuse = sun > 0 ? Math.max(0, sun + rough * smooth(0, .2, sun)) : 0;
    const illumination = ambient + (1 - ambient) * diffuse ** .9;
    let specular = 0;
    if (metal && sun > 0) {
      const half = unit(light.map((v, i) => v + view[i]));
      specular = Math.max(0, dot(normal, half)) ** 18 * .12 * (.6 + regolith * .4) * sun;
    }
    return { color, normal, illumination, specular, ambient,
      // Fine grains remain subdued, especially on dark carbon-rich surfaces.
      reflectance: 1 + (regolith - .5) * (carbon ? .07 : .12) };
  };
  return { axes, craters, point, impacts, sample };
}

/** A small directional depth map gives cliffs and crater rims cast shadows. */
export function createAsteroidShadow(vertices, triangles, light, resolution = 256) {
  const side = unit(Math.abs(light[1]) < .9 ? [light[2], 0, -light[0]] : [0, -light[2], light[1]]);
  const up = [light[1] * side[2] - light[2] * side[1], light[2] * side[0] - light[0] * side[2], light[0] * side[1] - light[1] * side[0]];
  const size = Math.min(1024, Math.max(256, Math.round(resolution))), scale = size * .44;
  const depth = new Float32Array(size * size).fill(-Infinity);
  const projected = vertices.map(v => [size / 2 + dot(v.p, side) * scale, size / 2 + dot(v.p, up) * scale, dot(v.p, light)]);
  for (const ids of triangles) {
    const [a, b, c] = ids.map(i => projected[i]);
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const u = ((b[1] - c[1]) * (x + .5 - c[0]) + (c[0] - b[0]) * (y + .5 - c[1])) / denominator;
      const v = ((c[1] - a[1]) * (x + .5 - c[0]) + (a[0] - c[0]) * (y + .5 - c[1])) / denominator;
      if (Math.min(u, v, 1 - u - v) < -1e-6) continue;
      depth[y * size + x] = Math.max(depth[y * size + x], a[2] * u + b[2] * v + c[2] * (1 - u - v));
    }
  }
  return (p, normal) => {
    const x = size / 2 + dot(p, side) * scale - .5, y = size / 2 + dot(p, up) * scale - .5;
    const sx = Math.floor(x), sy = Math.floor(y), tx = x - sx, ty = y - sy;
    // Slope bias avoids self-shadow stripes on steep but unobstructed faces.
    const bias = .002 + (.5 + 1.5 * (1 - Math.max(0, dot(normal, light)))) / scale;
    const z = dot(p, light) + bias;
    let visible = 0;
    for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) {
      const ix = sx + ox, iy = sy + oy, weight = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty);
      if (ix < 0 || iy < 0 || ix >= size || iy >= size || depth[iy * size + ix] <= z) visible += weight;
    }
    return visible;
  };
}
