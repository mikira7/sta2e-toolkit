/** Seeded, static scene artwork. No PIXI ticker or external image service required. */
import { createPlanetRenderProgress } from "./planet-render-progress.js";

export const STARFIELD_FLAG = "starSystemBackground";
const backgroundDirectory = () => `worlds/${game.world.id}/sta2e-procedural-backgrounds`;

/** Discover saved artwork, including files whose original scene was deleted. */
export async function getSavedStarfieldBackgrounds() {
  const saved = new Map();
  const directory = backgroundDirectory();
  try {
    const FP = foundry.applications.apps.FilePicker.implementation;
    const listing = await FP.browse("data", directory);
    for (const src of listing.files ?? []) {
      if (!/sta2e-starfield-[a-f0-9]+\.(webp|png)$/i.test(src)) continue;
      saved.set(src, { src, label: `Starfield ${src.split("/").pop().replace(/^sta2e-starfield-|\.(webp|png)$/gi, "")}`, recipe: null });
    }
  } catch { /* A new world has no generated-background directory yet. */ }
  for (const scene of game.scenes ?? []) {
    const recipe = scene.getFlag?.("sta2e-toolkit", STARFIELD_FLAG);
    if (!recipe) continue;
    const levels = scene.levels?.contents ?? scene.levels ?? [];
    const src = Array.from(levels).find(level => level.background?.src)?.background.src || scene.background?.src;
    if (!src) continue;
    const nebula = recipe.nebula ? ` — ${NEBULA_PALETTES[recipe.palette]?.label ?? "Nebula"}` : "";
    saved.set(src, { src, label: `${scene.name || "Starfield"}${nebula}`, recipe });
  }
  return Array.from(saved.values()).sort((a, b) => a.label.localeCompare(b.label));
}
export const NEBULA_PALETTES = Object.freeze({
  violet: { label: "Violet and blue", colors: [[105, 48, 155], [35, 100, 160]] },
  teal: { label: "Teal and emerald", colors: [[22, 120, 130], [60, 145, 92]] },
  amber: { label: "Amber and crimson", colors: [[170, 95, 35], [135, 35, 65]] },
  rose: { label: "Rose and indigo", colors: [[165, 55, 105], [55, 55, 150]] },
});

const clamp = (value, fallback, min, max) => {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
};
export function normalizeStarfieldRecipe(raw = {}) {
  return {
    version: 2,
    seed: String(raw.seed ?? "").trim().slice(0, 128) || "starfield",
    density: clamp(raw.density, 100, 0, 200),
    nebula: raw.nebula === true,
    palette: Object.hasOwn(NEBULA_PALETTES, raw.palette) ? raw.palette : "violet",
    strength: clamp(raw.strength, 55, 0, 100),
    resolution: Math.round(clamp(raw.resolution, 2048, 512, 4096)),
  };
}

function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}
function random(seed) {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const cell = (a, b) => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed;
    n = Math.imul(n ^ n >>> 13, 1274126177);
    return ((n ^ n >>> 16) >>> 0) / 4294967295;
  };
  const ease = t => t * t * (3 - 2 * t);
  const fx = ease(x - ix), fy = ease(y - iy);
  const top = cell(ix, iy) * (1 - fx) + cell(ix + 1, iy) * fx;
  const bottom = cell(ix, iy + 1) * (1 - fx) + cell(ix + 1, iy + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}
function cloud(x, y, seed) {
  let sum = 0, weight = .55;
  for (let octave = 0; octave < 5; octave++) {
    sum += noise(x, y, seed + octave * 7919) * weight;
    x *= 2.08; y *= 2.08; weight *= .5;
  }
  return sum;
}

/** Bounded image dimensions preserve the scene's aspect ratio, even on 30k maps. */
export function starfieldDimensions(width, height, resolution) {
  width = clamp(width, 6000, 1, 30000); height = clamp(height, 4000, 1, 30000);
  const scale = clamp(resolution, 2048, 512, 4096) / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Pure RGBA renderer; yielding between row batches keeps the browser responsive. */
export async function renderStarfieldPixels(raw, width, height, { onProgress = () => {} } = {}) {
  const recipe = normalizeStarfieldRecipe(raw);
  ({ width, height } = starfieldDimensions(width, height, recipe.resolution));
  const pixels = new Uint8ClampedArray(width * height * 4);
  const seed = hash(recipe.seed), rng = random(seed);
  const colors = NEBULA_PALETTES[recipe.palette].colors;
  // Sample turbulent gas on a smaller lattice, then interpolate at image resolution.
  const step = 6, gw = Math.ceil(width / step) + 1, gh = Math.ceil(height / step) + 1;
  const gas = new Float32Array(gw * gh), tint = new Float32Array(gw * gh);
  const offset = rng() * 100, angle = rng() * Math.PI, ca = Math.cos(angle), sa = Math.sin(angle);
  if (recipe.nebula && recipe.strength > 0) {
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const nx = (x * step - width / 2) / Math.max(width, height);
        const ny = (y * step - height / 2) / Math.max(width, height);
        const u = nx * ca - ny * sa, v = nx * sa + ny * ca;
        const warp = noise(u * 5 + offset, v * 5 + offset, seed) - .5;
        const bank = Math.exp(-Math.pow((v + warp * .28) / .24, 2));
        const detail = cloud(u * 7 + offset, v * 7 + offset, seed);
        gas[y * gw + x] = Math.pow(Math.max(0, detail - .22), 1.6) * bank * recipe.strength / 55;
        tint[y * gw + x] = noise(u * 4 + offset, v * 4 + offset, seed + 37);
      }
      if (y % 32 === 0) { onProgress(.25 * y / gh); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
  }
  const sample = (field, x, y) => {
    const gx = Math.floor(x / step), gy = Math.floor(y / step), fx = x / step - gx, fy = y / step - gy;
    const i = gy * gw + gx;
    return (field[i] * (1 - fx) + field[i + 1] * fx) * (1 - fy)
      + (field[i + gw] * (1 - fx) + field[i + gw + 1] * fx) * fy;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const haze = recipe.nebula ? sample(gas, x, y) : 0;
      const mix = haze ? sample(tint, x, y) : 0;
      for (let c = 0; c < 3; c++) pixels[i + c] = [2, 4, 9][c] + haze * (colors[0][c] * mix + colors[1][c] * (1 - mix));
      pixels[i + 3] = 255;
    }
    if (y % 64 === 0) { onProgress(.25 + .55 * y / height); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  // An independent stream keeps star positions stable when nebula settings change.
  const stars = random(seed ^ 0x51a7);
  const count = Math.round(width * height / 850 * recipe.density / 100);
  for (let n = 0; n < count; n++) {
    const sx = stars() * width, sy = stars() * height, bright = stars();
    const radius = bright > .985 ? 1.8 : bright > .9 ? 1.05 : .65;
    const color = stars() < .2 ? [180, 210, 255] : stars() < .18 ? [255, 220, 180] : [235, 240, 255];
    const power = 65 + Math.pow(bright, 3) * 190;
    const extent = Math.ceil(radius * 2);
    for (let y = Math.max(0, Math.floor(sy) - extent); y <= Math.min(height - 1, Math.floor(sy) + extent); y++) {
      for (let x = Math.max(0, Math.floor(sx) - extent); x <= Math.min(width - 1, Math.floor(sx) + extent); x++) {
        const d2 = (x - sx) ** 2 + (y - sy) ** 2;
        const glow = Math.exp(-d2 / (radius * radius)) * power;
        const i = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) pixels[i + c] += glow * color[c] / 255;
      }
    }
    if (n % 1000 === 0) { onProgress(.8 + .1 * n / Math.max(count, 1)); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  onProgress(.9);
  return { width, height, pixels };
}

export async function saveStarfieldBackground(raw, sceneWidth, sceneHeight) {
  const recipe = normalizeStarfieldRecipe(raw);
  const progress = createPlanetRenderProgress("Generating scene starfield");
  let canvas;
  try {
    const image = await renderStarfieldPixels(recipe, sceneWidth, sceneHeight, {
      onProgress: value => progress.update(value * 100, "Rendering stars and nebula…"),
    });
    canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create the starfield canvas.");
    context.putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0);
    progress.update(92, "Encoding background…");
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", .95));
    if (!blob) throw new Error("Could not encode the starfield background.");
    const FP = foundry.applications.apps.FilePicker.implementation;
    const directory = backgroundDirectory();
    try { await FP.createDirectory("data", directory); } catch { /* Upload reports inaccessible directories. */ }
    const fingerprint = hash(JSON.stringify([recipe, image.width, image.height])).toString(16);
    const extension = blob.type === "image/png" ? "png" : "webp";
    progress.update(96, "Saving background…");
    const result = await FP.upload("data", directory,
      new File([blob], `sta2e-starfield-${fingerprint}.${extension}`, { type: blob.type }), {}, { notify: false });
    if (!result?.path) throw new Error("Background upload failed. Check the world's file upload permissions.");
    progress.complete();
    return { src: result.path, recipe };
  } catch (error) { progress.fail(); throw error; }
  finally { if (canvas) canvas.width = canvas.height = 0; }
}
