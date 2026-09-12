/** Pure, deterministic fracture geometry and damage arithmetic. Coordinates are image UVs. */
export const UNIT_POLYGON = [[0, 0], [1, 0], [1, 1], [0, 1]];
const clamp = (v, min, max, fallback) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback;
export function normalizeDestructible(value = {}) {
  const color = (v, fallback) => /^#[0-9a-f]{6}$/i.test(v ?? "") ? v : fallback;
  return {
    version: 1, enabled: value.enabled === true,
    preset: ["asteroid", "rock", "wall"].includes(value.preset) ? value.preset : "asteroid",
    artwork: value.artwork === "existing" ? "existing" : "procedural",
    seed: String(value.seed || "object-1").slice(0, 128),
    darkColor: color(value.darkColor, "#343137"), lightColor: color(value.lightColor, "#a49a86"),
    integrity: Math.floor(clamp(value.integrity, 1, 100000, 10)),
    resistance: clamp(value.resistance, 0, 100000, 0), difficulty: Math.floor(clamp(value.difficulty, 0, 10, 1)),
    beamPieces: Math.floor(clamp(value.beamPieces, 2, 8, 2)), blastPieces: Math.floor(clamp(value.blastPieces, 2, 8, 3)),
    maxDepth: Math.floor(clamp(value.maxDepth, 0, 6, 3)), minSize: clamp(value.minSize, .05, 10, .25),
    maxFragments: Math.floor(clamp(value.maxFragments, 2, 64, 32)),
    animation: value.animation !== false, duration: clamp(value.duration, 200, 3000, 850),
    separation: clamp(value.separation, 0, 2, .3),
    source: typeof value.source === "string" ? value.source : "",
  };
}
export function seededRandom(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function polygonArea(poly) {
  return Math.abs(poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
}
export function polygonBounds(poly) {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
export function clipHalfPlane(poly, nx, ny, offset) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = a[0] * nx + a[1] * ny - offset, db = b[0] * nx + b[1] * ny - offset;
    if (da <= 1e-10) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}
/** Convex partitions cover the parent exactly, with no duplicated texture area. */
export function fracturePolygon(poly, { seed, kind = "irregular", count = 2, angle = 0, impact = null } = {}) {
  const random = seededRandom(seed), bounds = polygonBounds(poly);
  if (kind === "explosive" && count === 2) kind = "irregular";
  if (kind === "explosive") {
    const center = impact ?? [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
    const start = random() * Math.PI * 2;
    const angles = Array.from({ length: count }, (_, i) => start + (i + (random() - .5) * .3) * Math.PI * 2 / count);
    return angles.map((a, i) => {
      const b = i + 1 < count ? angles[i + 1] : angles[0] + Math.PI * 2;
      let p = clipHalfPlane(poly, Math.sin(a), -Math.cos(a), center[0] * Math.sin(a) - center[1] * Math.cos(a));
      p = clipHalfPlane(p, -Math.sin(b), Math.cos(b), -center[0] * Math.sin(b) + center[1] * Math.cos(b));
      return p;
    }).filter(p => p.length >= 3 && polygonArea(p) > 1e-9);
  }
  const pieces = [poly];
  while (pieces.length < count) {
    pieces.sort((a, b) => polygonArea(b) - polygonArea(a));
    const p = pieces.shift();
    const a = kind === "beam" ? angle + Math.PI / 2 + (random() - .5) * .24 : random() * Math.PI * 2;
    const nx = Math.cos(a), ny = Math.sin(a), projections = p.map(v => v[0] * nx + v[1] * ny);
    const min = Math.min(...projections), max = Math.max(...projections), cut = min + (max - min) * (.35 + random() * .3);
    const pair = [clipHalfPlane(p, nx, ny, cut), clipHalfPlane(p, -nx, -ny, -cut)];
    if (pair.some(v => polygonArea(v) < 1e-9)) { pieces.push(p); break; }
    pieces.push(...pair);
  }
  return pieces;
}
/** Largest remainder allocation conserves integer Integrity and excess damage. */
export function allocateByArea(total, areas) {
  const sum = areas.reduce((a, b) => a + b, 0);
  if (!sum) return areas.map(() => 0);
  const exact = areas.map(a => Math.max(0, Math.floor(total)) * a / sum), result = exact.map(Math.floor);
  const order = exact.map((v, i) => ({ i, remainder: v - result[i] })).sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  let remaining = Math.floor(total) - result.reduce((a, b) => a + b, 0);
  for (const { i } of order) { if (remaining-- <= 0) break; result[i]++; }
  return result;
}
export function objectDamage({ rawDamage = 0, resistance = 0, piercing = false, useStun = false } = {}) {
  if (useStun) return 0;
  return Math.max(0, Math.floor(Number(rawDamage) || 0) - (piercing ? 0 : Math.max(0, Number(resistance) || 0)));
}
/** A local UV offset in a cropped image becomes a scene offset, including mirroring. */
export function imageOffsetToScene(dx, dy, width, height, rotation = 0, scaleX = 1, scaleY = 1) {
  const a = rotation * Math.PI / 180, x = dx * width * scaleX, y = dy * height * scaleY;
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
}
