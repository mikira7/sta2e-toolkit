/** Browser-only artwork preparation. No scene/actor mutations or uploads during previews. */
import { normalizeDestructible, seededRandom, polygonBounds, UNIT_POLYGON } from "./destructible-geometry.js";

export function makeCanvas(width, height) {
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(width)); c.height = Math.max(1, Math.round(height)); return c;
}
export async function loadObjectImage(src) {
  if (!src || /\.(?:gif|webm|mp4|m4v|mov)(?:[?#]|$)/i.test(src)) throw new Error("Choose a readable static PNG, JPEG, SVG, or WebP token image.");
  const img = new Image(); img.crossOrigin = "anonymous";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { img.src = ""; reject(new Error("Object artwork took too long to load.")); }, 15000);
    img.onload = () => { clearTimeout(timer); resolve(); };
    img.onerror = () => { clearTimeout(timer); reject(new Error("Could not read object artwork. Check its path and cross-origin image permissions.")); };
    img.src = src;
  });
  const c = makeCanvas(img.naturalWidth, img.naturalHeight);
  // Bound memory even when imported artwork is enormous.
  const factor = Math.min(1, 1024 / Math.max(c.width, c.height));
  c.width = Math.max(1, Math.round(c.width * factor)); c.height = Math.max(1, Math.round(c.height * factor));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  try { ctx.getImageData(0, 0, 1, 1); } catch { throw new Error("This image cannot be cut into fragments. Use artwork stored in Foundry's data directory."); }
  return c;
}
const rgb = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
const smooth = t => t * t * (3 - 2 * t);
function noiseField(random) {
  const n = 64, values = Float32Array.from({ length: n * n }, random);
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
    const v = (a, b) => values[((b % n + n) % n) * n + ((a % n + n) % n)];
    return (v(ix, iy) * (1 - fx) + v(ix + 1, iy) * fx) * (1 - fy) + (v(ix, iy + 1) * (1 - fx) + v(ix + 1, iy + 1) * fx) * fy;
  };
}
export function generateObjectArt(settings, size = 512) {
  const config = normalizeDestructible(settings), random = seededRandom(config.seed);
  const c = makeCanvas(size, size), ctx = c.getContext("2d"), pixels = ctx.createImageData(size, size);
  const noise = noiseField(random), dark = rgb(config.darkColor), light = rgb(config.lightColor);
  const lobes = Array.from({ length: 5 }, () => random() * Math.PI * 2);
  const craters = Array.from({ length: config.preset === "asteroid" ? 16 : 6 }, () => ({ x: random() * 1.4 - .7, y: random() * 1.4 - .7, r: .035 + random() * .12 }));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1, angle = Math.atan2(v, u);
    const radius = .82 + lobes.reduce((s, p, i) => s + Math.sin(angle * (i + 2) + p) * .022, 0);
    const dist = Math.hypot(u, v / (config.preset === "rock" ? .77 : .89));
    const wall = config.preset === "wall";
    const edge = wall ? Math.min(.94 - Math.abs(u), .34 - Math.abs(v)) : radius - dist;
    if (edge <= 0) continue;
    const detail = noise(u * 32 + 40, v * 32 + 40) * .13 + noise(u * 12 + 20, v * 12 + 20) * .23;
    let shade = wall ? .5 + detail : .34 + Math.sqrt(Math.max(0, 1 - (dist / radius) ** 2)) * .38 - u * .2 - v * .18 + detail;
    if (wall) {
      const row = Math.floor((v + .34) * 14), mortarX = ((u + 1 + (row % 2) * .15) * 3.3) % 1;
      const mortarY = ((v + .34) * 14) % 1;
      if (mortarX < .025 || mortarY < .065) shade *= .38;
      shade *= Math.min(1, edge * 65 + .3);
    } else {
      for (const crater of craters) {
        const d = Math.hypot(u - crater.x, v - crater.y) / crater.r;
        if (d < 1.2) shade += d < .8 ? -.16 * (1 - d * .6) : .1 * (1 - Math.abs(1 - d) * 5);
      }
    }
    shade = Math.max(0, Math.min(1, shade));
    const i = (y * size + x) * 4;
    for (let k = 0; k < 3; k++) pixels.data[i + k] = dark[k] + (light[k] - dark[k]) * shade;
    pixels.data[i + 3] = Math.min(255, edge * size * 255);
  }
  ctx.putImageData(pixels, 0, 0); return c;
}
/** Pad to the token footprint so subsequent crops have an unambiguous image transform. */
export async function prepareObjectArt(config, source, aspect = 1) {
  const image = config.artwork === "existing" ? await loadObjectImage(source) : generateObjectArt(config);
  const a = Math.min(16, Math.max(1 / 16, aspect));
  const c = makeCanvas(a >= 1 ? 512 : 512 * a, a >= 1 ? 512 / a : 512);
  const ctx = c.getContext("2d"), fit = Math.min(c.width / image.width, c.height / image.height);
  ctx.drawImage(image, (c.width - image.width * fit) / 2, (c.height - image.height * fit) / 2, image.width * fit, image.height * fit);
  if (!measureRegion(c, UNIT_POLYGON).area) throw new Error("Object artwork is entirely transparent.");
  return c;
}
export function cutRegion(image, polygon, frame = null) {
  const b = frame ?? polygonBounds(polygon);
  const x = Math.max(0, Math.floor(b.x * image.width)), y = Math.max(0, Math.floor(b.y * image.height));
  const right = Math.min(image.width, Math.ceil((b.x + b.w) * image.width)), bottom = Math.min(image.height, Math.ceil((b.y + b.h) * image.height));
  const c = makeCanvas(right - x, bottom - y), ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.beginPath(); polygon.forEach(([u, v], i) => ctx[i ? "lineTo" : "moveTo"](u * image.width - x, v * image.height - y)); ctx.closePath(); ctx.clip();
  ctx.drawImage(image, -x, -y);
  return { canvas: c, frame: { x: x / image.width, y: y / image.height, w: c.width / image.width, h: c.height / image.height } };
}
/** Alpha-weighted area ignores the empty corners of imported images. */
export function measureRegion(image, polygon) {
  const { canvas: c, frame } = cutRegion(image, polygon), pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let area = 0, minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const alpha = pixels[(y * c.width + x) * 4 + 3]; area += alpha / 255;
    if (alpha > 8) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  }
  if (maxX < 0) return { area: 0, frame: { x: 0, y: 0, w: 0, h: 0 } };
  return { area, frame: { x: frame.x + minX / image.width, y: frame.y + minY / image.height, w: (maxX - minX + 1) / image.width, h: (maxY - minY + 1) / image.height } };
}
export async function uploadObjectArt(c, key) {
  const FP = foundry.applications.apps.FilePicker.implementation;
  const dir = `worlds/${game.world.id}/sta2e-destructibles`;
  try { await FP.createDirectory("data", dir); } catch { /* Upload supplies the actionable error. */ }
  const blob = await new Promise(resolve => c.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode destructible artwork.");
  const name = String(key).replace(/[^a-zA-Z0-9_-]/g, "");
  const result = await FP.upload("data", dir, new File([blob], `${name}.png`, { type: "image/png" }), {}, { notify: false });
  if (!result?.path) throw new Error("Could not save destructible artwork. Check world file-upload permissions.");
  return result.path;
}
