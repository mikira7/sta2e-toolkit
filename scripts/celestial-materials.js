/** Seeded stellar photospheres and irregular asteroid meshes, without image packs. */
import { createGasGiantMaterial } from "./gas-giant-material.js";
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const normalize = p => { const n = Math.hypot(...p) || 1; return p.map(v => v / n); };
const rotate = (p, sin, cos) => [p[0], -p[1] * sin + p[2] * cos, p[1] * cos + p[2] * sin];

export function* celestialPixelRows(recipe, size, terrain, { view = "portrait" } = {}) {
  const angle = (view === "scene" ? recipe.axialTilt : 70) * Math.PI / 180;
  const sin = Math.sin(angle), cos = Math.cos(angle);
  const pixels = new Uint8ClampedArray(size * size * 4);
  const colors = Object.fromEntries(Object.entries(recipe.colors).map(([k, hex]) => [k, rgb(hex)]));
  if (recipe.style === "asteroid") return yield* asteroidRows(recipe, size, terrain, colors, sin, cos, pixels);
  const { noise, fbm } = terrain;
  const brown = ["L", "T", "Y"].includes(recipe.texture), young = recipe.texture === "T-Tauri", white = recipe.texture === "White Dwarf";
  const gas = brown ? createGasGiantMaterial({ ...recipe, gasColors: [], texture: "turbulent" }, terrain, colors) : null;
  const brightness = { L: .85, T: .58, Y: .34 }[recipe.texture] ?? 1;
  const spots = Array.from({ length: white || brown ? 0 : young ? 18 : 7 }, (_, i) => {
    const lon = noise(i, 41, 17) * Math.PI * 2, y = (noise(i, 71, 37) - .5) * 1.1, radius = Math.sqrt(1 - y * y);
    return { p: [Math.cos(lon) * radius, y, Math.sin(lon) * radius], width: (young ? .05 : .018) + noise(i, 13, 91) * .035 };
  });
  const giants = /^(Ia|Ib|II|III)$/.test(recipe.stellarLuminosity);
  const grainScale = giants ? 44 : 95;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + .5 - size / 2) / (size * .36), y = (py + .5 - size / 2) / (size * .36);
      const d = Math.hypot(x, y), index = (py * size + px) * 4;
      let color, alpha;
      if (d <= 1) {
        const z = Math.sqrt(1 - d * d), p = rotate([x, y, z], sin, cos);
        if (brown) color = gas.sample(...p).map(v => v * brightness * (.38 + .62 * z ** .4));
        else {
          const cells = fbm(p[0] * grainScale + 7, p[1] * grainScale + 31, p[2] * grainScale + 53, 3);
          const activity = fbm(p[0] * 8 + 19, p[1] * 8 + 73, p[2] * 8 + 11, 3);
          color = mix(colors.surfaceLow, colors.surfaceHigh, white ? .95 + (cells - .5) * .05 : .65 + cells * .35);
          const granulation = white ? 1 : .8 + cells * .35 + (activity - .5) * (young ? .3 : .08);
          color = color.map(v => v * granulation * (.48 + .52 * z ** .35));
          for (const spot of spots) {
            const distance = Math.hypot(...p.map((v, i) => v - spot.p[i])) / spot.width;
            if (distance < 3) color = color.map(v => v * (1 - .78 * Math.exp(-distance * distance * 1.5)));
          }
        }
        alpha = clamp((1 - d) * size * .36);
      } else {
        // Compact remnant / dwarf halos stay restrained. Young stars have a
        // stronger irregular corona; it samples the same stellar meridian.
        const p = rotate([x / d, y / d, 0], sin, cos);
        const activity = noise(p[0] * 8 + 11, p[1] * 8 + 23, p[2] * 8 + 47);
        const reach = (young ? .19 : white ? .055 : brown ? .025 : .10) * (.6 + activity * .8);
        alpha = Math.exp(-(d - 1) / reach) * recipe.stellarGlow / 100 * (young ? .85 : brown ? .35 : .8) * clamp((1.37 - d) * 20);
        color = mix(colors.surfaceLow, colors.surfaceHigh, .65);
      }
      for (let c = 0; c < 3; c++) pixels[index + c] = color[c];
      pixels[index + 3] = alpha * 255;
    }
    if (py % 8 === 7) yield (py + 1) / size;
  }
  if (recipe.stellarFlares > 0) yield* stellarFlareRows(recipe, size, noise, colors, sin, cos, pixels);
  if (recipe.lensFlare > 0) {
    const strength = recipe.lensFlare / 100 * brightness;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x + .5 - size / 2) / (size / 2), ny = (y + .5 - size / 2) / (size / 2);
        const taper = Math.max(0, 1 - nx * nx) ** 2 * Math.max(0, 1 - ny * ny) ** 2;
        const streak = Math.exp(-((ny / .009) ** 2)) * .35 + Math.exp(-(((ny - nx * .42) / .006) ** 2)) * .08;
        const ring = Math.exp(-(((Math.hypot(nx, ny) - .84) / .018) ** 2)) * .025;
        addGlow(pixels, (y * size + x) * 4, colors.surfaceHigh, (streak + ring) * strength * taper);
      }
      if (y % 8 === 7) yield y / size;
    }
  }
  return { width: size, height: size, pixels };
}

function addGlow(pixels, index, color, alpha) {
  if (alpha < 1 / 1024) return;
  const oldAlpha = pixels[index + 3] / 255, nextAlpha = oldAlpha + alpha * (1 - oldAlpha);
  for (let k = 0; k < 3; k++) {
    const old = pixels[index + k] * oldAlpha;
    pixels[index + k] = Math.min(255, (old + color[k] * alpha * (1 - old / 255)) / nextAlpha);
  }
  pixels[index + 3] = nextAlpha * 255;
}

function* stellarFlareRows(recipe, size, noise, colors, sin, cos, pixels) {
  const activity = recipe.stellarFlares / 100, radius = size * .36;
  const count = 4 + Math.floor(activity * 12);
  for (let i = 0; i < count; i++) {
    const longitude = i / count * Math.PI * 2 + (noise(i, 59, 17) - .5) * .45;
    const latitude = (noise(i, 31, 83) - .5) * 1.8;
    const center = [Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude)];
    const tangent = [-Math.sin(longitude), 0, Math.cos(longitude)];
    const width = .055 + noise(i, 13, 71) * .09, height = .055 + activity * (.08 + noise(i, 43, 91) * .16);
    const steps = Math.max(32, Math.ceil(radius * (width + height) * 2));
    const thickness = Math.max(.65, radius * (.004 + activity * .005));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps * Math.PI, side = width * Math.cos(t);
      const raised = Math.sqrt(1 - side * side) + Math.sin(t) * height;
      const p = rotate(center.map((v, k) => v * raised + tangent[k] * side), sin, cos);
      const cx = size / 2 + p[0] * radius, cy = size / 2 + p[1] * radius;
      const extent = thickness * 3;
      for (let y = Math.max(0, Math.floor(cy - extent)); y <= Math.min(size - 1, Math.ceil(cy + extent)); y++) {
        for (let x = Math.max(0, Math.floor(cx - extent)); x <= Math.min(size - 1, Math.ceil(cx + extent)); x++) {
          const sx = (x + .5 - size / 2) / radius, sy = (y + .5 - size / 2) / radius;
          const disc = sx * sx + sy * sy;
          if (disc < 1 && p[2] < Math.sqrt(1 - disc) - .003) continue;
          const distance = ((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2) / (thickness * thickness);
          const alpha = Math.exp(-distance * .8) * activity * .24 / Math.max(1, thickness);
          addGlow(pixels, (y * size + x) * 4, mix(colors.surfaceHigh, [255, 234, 185], .2), alpha);
        }
      }
    }
    yield (i + 1) / count;
  }
}

function* asteroidRows(recipe, size, { noise, fbm }, colors, sin, cos, pixels) {
  const rows = 28, columns = 56, vertices = [], triangles = [];
  const depth = new Float32Array(size * size).fill(-Infinity);
  const craterCount = recipe.texture === "icy" ? 15 : 28;
  const craters = Array.from({ length: craterCount }, (_, i) => {
    const y = noise(i, 47, 13) * 2 - 1, lon = noise(i, 73, 31) * Math.PI * 2, radius = Math.sqrt(1 - y * y);
    return { p: [radius * Math.cos(lon), y, radius * Math.sin(lon)], size: .045 + noise(i, 23, 89) ** 2 * .18 };
  });
  for (let row = 0; row <= rows; row++) {
    const lat = -Math.PI / 2 + row / rows * Math.PI;
    for (let col = 0; col < columns; col++) {
      const lon = col / columns * Math.PI * 2;
      const direction = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
      const lump = .82 + noise(direction[0] * 2.3 + 31, direction[1] * 2.3 + 17, direction[2] * 2.3 + 79) * .23;
      const p = direction.map((v, i) => v * [1, .72, .83][i] * lump);
      const screen = rotate(p, sin, cos);
      vertices.push({ p, direction, screen: [size / 2 + screen[0] * size * .44, size / 2 + screen[1] * size * .44, screen[2]], normal: [0, 0, 0] });
    }
  }
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const a = row * columns + col, b = row * columns + (col + 1) % columns, c = a + columns, d = b + columns;
    triangles.push([a, c, b], [b, c, d]);
  }
  for (const ids of triangles) {
    const [a, b, c] = ids.map(i => vertices[i].p), u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i]);
    let normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (normal.reduce((sum, value, i) => sum + value * a[i], 0) < 0) normal = normal.map(n => -n);
    for (const id of ids) vertices[id].normal = vertices[id].normal.map((v, i) => v + normal[i]);
  }
  for (const v of vertices) v.normal = rotate(normalize(v.normal), sin, cos);
  let count = 0;
  for (const ids of triangles) {
    const verts = ids.map(i => vertices[i]), [a, b, c] = verts.map(v => v.screen);
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 1e-7) continue;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const w0 = ((b[1] - c[1]) * (x + .5 - c[0]) + (c[0] - b[0]) * (y + .5 - c[1])) / denominator;
      const w1 = ((c[1] - a[1]) * (x + .5 - c[0]) + (a[0] - c[0]) * (y + .5 - c[1])) / denominator;
      const w2 = 1 - w0 - w1;
      if (Math.min(w0, w1, w2) < -1e-6) continue;
      const weights = [w0, w1, w2], z = a[2] * w0 + b[2] * w1 + c[2] * w2, index = y * size + x;
      if (z <= depth[index]) continue;
      depth[index] = z;
      const interpolate = key => [0, 1, 2].map(axis => verts.reduce((sum, v, i) => sum + v[key][axis] * weights[i], 0));
      const p = normalize(interpolate("direction")), normal = normalize(interpolate("normal"));
      const grain = fbm(p[0] * 42 + 3, p[1] * 42 + 11, p[2] * 42 + 29, 4);
      const mineral = fbm(p[0] * 5 + 37, p[1] * 5 + 19, p[2] * 5 + 73, 3);
      let light = .08 + .92 * Math.max(0, -.52 * normal[1] + .854 * normal[2]);
      for (const crater of craters) {
        const d = Math.hypot(...p.map((v, i) => v - crater.p[i])) / crater.size;
        if (d < 1.3) light *= 1 - .36 * Math.exp(-d * d * 3) + .20 * Math.exp(-(((d - 1) * 9) ** 2));
      }
      let color = mix(colors.surfaceLow, colors.surfaceHigh, mineral * .8 + grain * .2);
      if (recipe.texture === "metallic") {
        const specular = Math.max(0, -.27 * normal[1] + .963 * normal[2]) ** 35 * .22 * grain;
        color = mix(color, colors.cloud, specular);
      }
      for (let k = 0; k < 3; k++) pixels[index * 4 + k] = color[k] * light * (.75 + grain * .5);
      pixels[index * 4 + 3] = 255;
    }
    if (++count % 64 === 0) yield count / triangles.length;
  }
  return { width: size, height: size, pixels };
}
