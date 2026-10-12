/** Screen corners are normalized to region bounds: TL, TR, BR, BL. */
export function validScreenCorners(points) {
  if (!Array.isArray(points) || points.length !== 4
      || points.some(p => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = points[i], b = points[(i + 1) % 4], c = points[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-8 || (sign && Math.sign(cross) !== sign)) return false;
    sign = Math.sign(cross);
  }
  return true;
}

/** Project the unit square onto a convex quadrilateral using a homography. */
export function screenProjection(points) {
  if (!validScreenCorners(points)) return null;
  const [a, b, c, d] = points;
  const dx = a.x - b.x + c.x - d.x, dy = a.y - b.y + c.y - d.y;
  const bx = b.x - c.x, by = b.y - c.y, cx = d.x - c.x, cy = d.y - c.y;
  const det = bx * cy - cx * by;
  const g = (dx * cy - cx * dy) / det, h = (bx * dy - dx * by) / det;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return {
      x: ((b.x - a.x + g * b.x) * u + (d.x - a.x + h * d.x) * v + a.x) / w,
      y: ((b.y - a.y + g * b.y) * u + (d.y - a.y + h * d.y) * v + a.y) / w,
    };
  };
}

/** A subdivided projective surface; UVs preserve the existing image framing. */
export function alignedImageGeometry(corners, bounds, imageWidth, imageHeight, cfg, steps = 48) {
  const project = screenProjection(corners);
  if (!project || !(bounds.width > 0 && bounds.height > 0)) return null;
  const sx = bounds.width / imageWidth, sy = bounds.height / imageHeight;
  const fit = cfg.imageFit === "cover" ? Math.max(sx, sy)
    : cfg.imageFit === "contain" ? Math.min(sx, sy) : 1;
  const width = (cfg.imageFit === "stretch" ? 1 : imageWidth * fit / bounds.width) * cfg.imageScale;
  const height = (cfg.imageFit === "stretch" ? 1 : imageHeight * fit / bounds.height) * cfg.imageScale;
  const left = (1 - width) / 2 + cfg.imageOffsetX, top = (1 - height) / 2 + cfg.imageOffsetY;
  const x0 = Math.max(0, left), y0 = Math.max(0, top);
  const x1 = Math.min(1, left + width), y1 = Math.min(1, top + height);
  if (x1 <= x0 || y1 <= y0) return null;
  const vertices = new Float32Array((steps + 1) ** 2 * 2);
  const uvs = new Float32Array(vertices.length), indices = new Uint16Array(steps * steps * 6);
  for (let y = 0; y <= steps; y++) for (let x = 0; x <= steps; x++) {
    const u = x0 + (x1 - x0) * x / steps, v = y0 + (y1 - y0) * y / steps;
    const p = project(u, v), i = (y * (steps + 1) + x) * 2;
    vertices[i] = bounds.x + p.x * bounds.width;
    vertices[i + 1] = bounds.y + p.y * bounds.height;
    uvs[i] = (u - left) / width;
    uvs[i + 1] = (v - top) / height;
    if (x < steps && y < steps) {
      const k = (y * steps + x) * 6, n = i / 2;
      indices.set([n, n + 1, n + steps + 1, n + 1, n + steps + 2, n + steps + 1], k);
    }
  }
  return { vertices, uvs, indices };
}
