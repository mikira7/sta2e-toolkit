/** Synchronous baked height sampling shared by every planet view/export. */
import { BARREN_MAP_SIZE as size, BARREN_MAPS } from "./barren-texture-data.js";
const wrap = x => (x % size + size) % size;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
function sample(map, u, v, repeat = true) {
  const x = repeat ? u * size : clamp(u) * (size - 1), y = repeat ? v * size : clamp(v) * (size - 1);
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const at = (a, b) => map[(repeat ? wrap(b) : clamp(b, 0, size - 1)) * size + (repeat ? wrap(a) : clamp(a, 0, size - 1))];
  return (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
}
export function createBarrenRockTexture(noise) {
  const phase = noise(73, 91, 31) * Math.PI * 2, cos = Math.cos(phase), sin = Math.sin(phase);
  const offset = noise(19, 71, 53) * 8;
  const index = Math.floor(noise(41, 17, 93) * 3) % 3;
  const map = BARREN_MAPS[index], mapY = BARREN_MAPS[(index + 1) % 3], mapZ = BARREN_MAPS[(index + 2) % 3];
  return (x, y, z, scale = 1.35) => {
    // Continuous triplanar mapping: no longitude seam or stretched polar cap.
    const a = x * cos - z * sin, b = y, c = x * sin + z * cos;
    const wx = a ** 4, wy = b ** 4, wz = c ** 4, total = wx + wy + wz || 1;
    return (sample(map, b * scale + offset, c * scale) * wx + sample(mapY, a * scale, c * scale + offset) * wy + sample(mapZ, a * scale + offset, b * scale) * wz) / total;
  };
}
export function sampleBarrenImpactDetail(id, u, v, phase) {
  const cos = Math.cos(phase), sin = Math.sin(phase);
  return sample(BARREN_MAPS[3 + id % 4], (u * cos - v * sin) / 2.8 + .5, (u * sin + v * cos) / 2.8 + .5, false) - .5;
}
