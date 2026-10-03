/** Seeded stellar photospheres and irregular asteroid meshes, without image packs. */
import { createGasGiantMaterial } from "./gas-giant-material.js";
import { createAsteroidMaterial, createAsteroidShadow } from "./asteroid-material.js";
import { planetLightDirection } from "./planet-lighting.js";
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const normalize = p => { const n = Math.hypot(...p) || 1; return p.map(v => v / n); };
const rotate = (p, sin, cos) => [p[0], -p[1] * sin + p[2] * cos, p[1] * cos + p[2] * sin];

export function* celestialPixelRows(recipe, size, terrain, { view = "portrait", lightDirection = 0 } = {}) {
  const angle = (view === "scene" ? recipe.axialTilt : 70) * Math.PI / 180;
  const sin = Math.sin(angle), cos = Math.cos(angle);
  const pixels = new Uint8ClampedArray(size * size * 4);
  const colors = Object.fromEntries(Object.entries(recipe.colors).map(([k, hex]) => [k, rgb(hex)]));
  if (recipe.style === "asteroid") return yield* asteroidRows(recipe, size, terrain, colors, sin, cos, pixels, lightDirection);
  const { noise, fbm } = terrain;
  const brown = ["L", "T", "Y"].includes(recipe.texture), young = recipe.texture === "T-Tauri", white = recipe.texture === "White Dwarf";
  const gas = brown ? createGasGiantMaterial({ ...recipe, gasColors: [], texture: "turbulent" }, terrain, colors) : null;
  const brightness = { L: .85, T: .58, Y: .34 }[recipe.texture] ?? 1;
  const peak = Math.max(1, ...colors.surfaceLow);
  const coronaColor = colors.surfaceLow.map(v => 255 * (v / peak) ** 2);
  const spots = Array.from({ length: white || brown ? 0 : young ? 18 : 7 }, (_, i) => {
    const lon = noise(i, 41, 17) * Math.PI * 2, y = (noise(i, 71, 37) - .5) * 1.1, radius = Math.sqrt(1 - y * y);
    return { p: [Math.cos(lon) * radius, y, Math.sin(lon) * radius], width: (young ? .05 : .018) + noise(i, 13, 91) * .035 };
  });
  const giants = /^(Ia|Ib|II|III)$/.test(recipe.stellarLuminosity);
  const grainScale = giants ? 44 : 95;
  const detail = (recipe.stellarDetail ?? 75) / 100;
  const activeRegions = !brown && !white ? Array.from({ length: 10 }, (_, i) => {
    const longitude = noise(i, 541, 29) * Math.PI * 2, y = (noise(i, 547, 83) - .5) * 1.4;
    const r = Math.sqrt(1 - y * y);
    return { center: [r * Math.cos(longitude), y, r * Math.sin(longitude)], radius: .035 + noise(i, 557, 41) * .050 };
  }) : [];
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
          const granulation = white ? 1 : .975 + (cells - .5) * .35 * (1 - detail * .92) + (activity - .5) * (young ? .3 : .08);
          color = color.map(v => v * granulation * (.48 + .52 * z ** .35));
          for (const spot of spots) {
            const distance = Math.hypot(...p.map((v, i) => v - spot.p[i])) / spot.width;
            if (distance < 3) color = color.map(v => v * (1 - .78 * Math.exp(-distance * distance * 1.5)));
          }
          if (detail) {
            const footprint = 1 / (size * .36 * Math.max(.18, z));
            const bend = (noise(p[0] * 7 + 503, p[1] * 7 + 41, p[2] * 7 + 79) - .5) * 2;
            const convection = fbm(p[0] * (giants ? 6 : 11) + bend + 509,
              p[1] * (giants ? 6 : 11) + 71, p[2] * (giants ? 6 : 11) - bend + 31, 2);
            const fine = noise(p[0] * grainScale + 521, p[1] * grainScale + 53, p[2] * grainScale + 17);
            const resolved = 1 - clamp((footprint - .004) / .024);
            const facula = clamp((activity - .48) * 3.8) * (.35 + convection * .65);
            const lane = clamp((.46 - convection) * 5);
            const heat = white ? 1.15 + (convection - .5) * .10
              : 1.20 + (convection - .5) * .28 + (fine - .5) * .025 * resolved + facula * .32 - lane * .04;
            const warm = colors.surfaceLow.map(v => 255 * (v / peak) ** 1.3);
            let cinematic = mix(white ? colors.surfaceLow : warm, colors.surfaceHigh, white ? .96 : .18 + convection * .65);
            cinematic = cinematic.map(v => {
              const radiance = v / 255 * heat * (.78 + .22 * z ** .35);
              return 255 * radiance / (1 + radiance * .12);
            });
            if (!white) {
              let active = 0, diffuse = 0;
              const filaments = .88 + noise(p[0] * 28 + 563, p[1] * 28 + 61, p[2] * 28 + 37) * .12;
              for (const region of activeRegions) {
                const distance = Math.hypot(...p.map((v, i) => v - region.center[i]));
                active = Math.max(active, Math.exp(-((distance / region.radius) ** 2)) * filaments);
                diffuse = Math.max(diffuse, Math.exp(-((distance / (region.radius * 3.2)) ** 2)));
              }
              const intensity = clamp(.06 + active * .65 + diffuse * .42 + facula * .16) * (.65 + recipe.stellarFlares / 100 * .35);
              cinematic = cinematic.map((v, k) => v + (255 - v) * [1, .95, .72][k] * intensity);
            }
            for (const spot of spots) {
              const distance = Math.hypot(...p.map((v, i) => v - spot.p[i])) / spot.width;
              if (distance > 3.5) continue;
              const umbra = Math.exp(-distance * distance * 1.8);
              const penumbra = Math.exp(-distance * distance * .38);
              cinematic = cinematic.map(v => v * (1 - umbra * .65 - penumbra * .20));
            }
            color = mix(color, cinematic, detail);
          }
        }
        if (!brown && !white && recipe.stellarGlow > 0) {
          const innerBloom = Math.exp(-(((1 - d) / .025) ** 2)) * recipe.stellarGlow / 100 * .35;
          color = color.map((v, k) => v + (255 - v) * colors.surfaceHigh[k] / 255 * innerBloom);
        }
        alpha = clamp((1 - d) * size * .36);
        if (!brown && !white && recipe.stellarGlow > 0 && alpha < 1) {
          // The corona lies underneath the antialiased photosphere. Compositing
          // both layers here prevents a transparent dark seam at the limb.
          const underAlpha = 1 - Math.exp(-5 * recipe.stellarGlow / 100);
          const underColor = mix(coronaColor, colors.surfaceHigh, .8);
          const combined = alpha + underAlpha * (1 - alpha);
          color = color.map((v, k) => (v * alpha + underColor[k] * underAlpha * (1 - alpha)) / combined);
          alpha = combined;
        }
      } else {
        // Compact remnant / dwarf halos stay restrained. Young stars have a
        // stronger irregular corona; it samples the same stellar meridian.
        const p = rotate([x / d, y / d, 0], sin, cos);
        const activity = noise(p[0] * 8 + 11, p[1] * 8 + 23, p[2] * 8 + 47);
        const reach = (young ? .21 : white ? .055 : brown ? .025 : .15) * (.6 + activity * .8);
        const limb = Math.exp(-(d - 1) / (brown ? .007 : .016));
        const streamers = .38 + activity ** 3 * .85;
        const strength = recipe.stellarGlow / 100;
        if (brown || white) {
          alpha = (limb * .60 + Math.exp(-(d - 1) / reach) * streamers * .55)
            * strength * (brown ? .35 : .9) * clamp((1.37 - d) * 20);
          color = mix(colors.surfaceLow, colors.surfaceHigh, .88);
        } else {
          const radiance = limb * 3 + Math.exp(-(d - 1) / reach) * (1.25 + streamers * 1.3);
          alpha = (1 - Math.exp(-radiance * strength * (young ? 1.2 : 1))) * clamp((1.37 - d) / .37) ** 1.5;
          color = mix(coronaColor, colors.surfaceHigh, limb * .8);
        }
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
        const streak = Math.exp(-((ny / .005) ** 2)) * .28 + Math.exp(-((ny / .024) ** 2)) * .10
          + Math.exp(-(((ny - nx * .42) / .004) ** 2)) * .045;
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
  const count = 16;
  const peak = Math.max(1, ...colors.surfaceLow);
  const plasma = colors.surfaceLow.map(v => 255 * (v / peak) ** 1.6);
  for (let i = 0; i < count; i++) {
    const visibility = clamp(activity * count - i);
    if (!visibility) continue;
    const longitude = i / count * Math.PI * 2 + (noise(i, 59, 17) - .5) * .45;
    const latitude = (noise(i, 31, 83) - .5) * 1.8;
    const center = [Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude)];
    const tangent = [-Math.sin(longitude), 0, Math.cos(longitude)];
    const width = .065 + noise(i, 13, 71) * .11, height = .06 + activity * (.13 + noise(i, 43, 91) * .22);
    const steps = Math.max(32, Math.ceil(radius * (width + height) * 2));
    const thickness = Math.max(1.7, radius * (.016 + activity * .024));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps * Math.PI, side = width * Math.cos(t);
      const footpoint = Math.exp(-((t / .20) ** 2)) + Math.exp(-(((Math.PI - t) / .20) ** 2));
      const raised = Math.sqrt(1 - side * side) + Math.sin(t) * height;
      const p = rotate(center.map((v, k) => v * raised + tangent[k] * side), sin, cos);
      const breadth = thickness * (.60 + Math.sin(t) * .55) * (.75 + noise(t * 5 + 17, i * 7 + 29, 61) * .5);
      const cx = size / 2 + p[0] * radius, cy = size / 2 + p[1] * radius;
      const extent = breadth * 4;
      for (let y = Math.max(0, Math.floor(cy - extent)); y <= Math.min(size - 1, Math.ceil(cy + extent)); y++) {
        for (let x = Math.max(0, Math.floor(cx - extent)); x <= Math.min(size - 1, Math.ceil(cx + extent)); x++) {
          const sx = (x + .5 - size / 2) / radius, sy = (y + .5 - size / 2) / radius;
          const disc = sx * sx + sy * sy;
          if (disc < 1 && p[2] < Math.sqrt(1 - disc) - .003) continue;
          const dx = (x + .5 - cx) / breadth, dy = (y + .5 - cy) / breadth;
          const distance = dx * dx + dy * dy;
          const mist = .25 + noise(t * 15 + i * 13, dx * 1.5 + 23, dy * 1.5 + 47) * .75;
          const alpha = Math.exp(-distance * .22) * mist * activity * visibility * (.40 + footpoint * .55) / Math.max(1, breadth);
          const index = (y * size + x) * 4;
          addGlow(pixels, index, plasma, alpha);
          const core = Math.exp(-distance * .85) * mist * activity * visibility * (.22 + footpoint * .55) / Math.max(1, breadth);
          addGlow(pixels, index, mix(colors.surfaceHigh, [255, 249, 230], .35), core);
        }
      }
    }
    yield (i + 1) / count;
  }
}

function* asteroidRows(recipe, size, terrain, colors, sin, cos, pixels, lightDirection) {
  const rows = 80, columns = 160, vertices = [], triangles = [];
  const depth = new Float32Array(size * size).fill(-Infinity);
  const material = createAsteroidMaterial(recipe, terrain, colors);
  const baseLight = planetLightDirection(recipe), turn = (Number(lightDirection) || 0) * Math.PI / 180;
  const light = rotate([-baseLight.y * Math.sin(turn), baseLight.y * Math.cos(turn), baseLight.z], sin, cos);
  const view = rotate([0, 0, 1], sin, cos);
  for (let row = 0; row <= rows; row++) {
    const lat = -Math.PI / 2 + row / rows * Math.PI;
    for (let col = 0; col < columns; col++) {
      const lon = col / columns * Math.PI * 2;
      const direction = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
      const p = material.point(direction), base = material.point(direction, false);
      const screen = rotate(p, sin, cos);
      vertices.push({ p, base, direction, screen: [size / 2 + screen[0] * size * .44, size / 2 + screen[1] * size * .44, screen[2]], normal: [0, 0, 0] });
    }
    if (row % 8 === 7) yield row / rows * .1;
  }
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const a = row * columns + col, b = row * columns + (col + 1) % columns, c = a + columns, d = b + columns;
    triangles.push([a, c, b], [b, c, d]);
  }
  for (const ids of triangles) {
    // Base normals describe the larger shape. The per-pixel material adds
    // impact slopes once, so small bowls stay crisp between mesh vertices.
    const [a, b, c] = ids.map(i => vertices[i].base), u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i]);
    let normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (normal.reduce((sum, value, i) => sum + value * a[i], 0) < 0) normal = normal.map(n => -n);
    for (const id of ids) vertices[id].normal = vertices[id].normal.map((v, i) => v + normal[i]);
  }
  // Longitude vertices meet at one physical pole; share its normal to avoid
  // the old triangular pinwheel at the ends of the mesh.
  for (const offset of [0, rows * columns]) {
    const normal = [0, 0, 0];
    for (let col = 0; col < columns; col++) for (let k = 0; k < 3; k++) normal[k] += vertices[offset + col].normal[k];
    for (let col = 0; col < columns; col++) vertices[offset + col].normal = normal;
  }
  for (const v of vertices) v.normal = normalize(v.normal);
  const shadowAt = createAsteroidShadow(vertices, triangles, light, size);
  yield .15;
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
      const surface = material.sample(p, normal, light, view, 1 / (size * .44 * Math.max(.15, normal.reduce((sum, v, k) => sum + v * view[k], 0))));
      const shadow = shadowAt(interpolate("p"), surface.normal);
      const illumination = surface.ambient + (surface.illumination - surface.ambient) * shadow;
      for (let k = 0; k < 3; k++) pixels[index * 4 + k] = surface.color[k] * illumination * surface.reflectance + colors.cloud[k] * surface.specular * shadow;
      pixels[index * 4 + 3] = 255;
    }
    if (++count % 128 === 0) yield .15 + count / triangles.length * .80;
  }
  // Filter only the silhouette in premultiplied color. Interior rock detail
  // stays sharp, and transparent edge pixels never carry a black fringe.
  const source = pixels.slice();
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const index = (y * size + x) * 4;
      const neighbors = [index - 4, index + 4, index - size * 4, index + size * 4];
      if (neighbors.every(i => source[i + 3] === source[index + 3])) continue;
      let alpha = source[index + 3] * .5;
      const color = [0, 1, 2].map(k => source[index + k] * source[index + 3] * .5);
      for (const i of neighbors) {
        alpha += source[i + 3] * .125;
        for (let k = 0; k < 3; k++) color[k] += source[i + k] * source[i + 3] * .125;
      }
      for (let k = 0; k < 3; k++) pixels[index + k] = alpha ? color[k] / alpha : 0;
      pixels[index + 3] = alpha;
    }
    if (y % 8 === 7) yield .95 + y / size * .05;
  }
  return { width: size, height: size, pixels };
}
