/**
 * sta2e-toolkit | water-shore-field.js
 *
 * Bakes the per-Region SHORE TEXTURE the water shader reads. A LEAF with NO
 * IMPORTS (Node tests). Run once per Region shape, never per frame.
 *
 * The Region outline is the shoreline. Rasterised onto a coarse grid (a few
 * canvas px per cell), it becomes:
 *
 *  - R  = SIGNED distance to the shore: positive in the water, negative on the
 *         land, square-root encoded around 0.5 so the band the foam lives in
 *         keeps its precision in eight bits (linear encoding of a 20-square
 *         reach left foam on 15 px steps);
 *  - GB = the flow direction along the banks (for `followBanks` rivers);
 *  - A  = coverage: 255 inside the Region, 0 outside. This, not a PIXI mask, is
 *         what clips the water — a Graphics mask filled polygon by polygon
 *         cannot cut holes, so it would drown the islands.
 *
 * Three rules it rests on:
 *
 *  - **Even-odd rasterisation.** Foundry hands back a Region's outline as a set
 *    of polygons whose holes are polygons too; `regionContainsPoint` reads them
 *    even-odd, and so does this.
 *  - **Its own distance transform, with no frame.** hull-sections.js's
 *    `distanceField` frames the image in a border of "outside", which here would
 *    put a shore along every edge of the bake. Feature points are only ever the
 *    cells that really are land (or water, for the land side).
 *  - **Open edges.** With `openEdges`, cells outside the scene rect count as
 *    water for the distance (never for coverage), so an ocean or a river that
 *    runs off the map has no foam along the map border.
 */

const INF = 1e20;

/** Felzenszwalb–Huttenlocher squared distance of a sampled function, in 1D. */
function _dt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Exact Euclidean distance (in cells) from every cell to the nearest cell where
 * `feature(i)` is true. No frame: a grid with no feature at all is Infinity.
 */
export function edt(W, H, feature) {
  const n = Math.max(W, H);
  const f = new Float64Array(n), d = new Float64Array(n);
  const v = new Int32Array(n), z = new Float64Array(n + 1);
  const grid = new Float64Array(W * H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = feature(y * W + x) ? 0 : INF;
    _dt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y];
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x];
    _dt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) out[y * W + x] = d[x] >= INF * 0.5 ? Infinity : Math.sqrt(d[x]);
  }
  return out;
}

/**
 * Even-odd scanline fill of polygons (arrays of {x, y} in canvas px) onto a
 * grid whose cell (i, j) is centred at origin + (i + 0.5, j + 0.5) * cell.
 */
export function rasterizePolygons(polygons, W, H, originX, originY, cell) {
  const mask = new Uint8Array(W * H);
  const xs = [];
  for (let j = 0; j < H; j++) {
    const py = originY + (j + 0.5) * cell;
    xs.length = 0;
    for (const verts of polygons ?? []) {
      const m = verts?.length ?? 0;
      for (let a = 0, b = m - 1; a < m; b = a++) {
        const ya = verts[a].y, yb = verts[b].y;
        if ((ya > py) === (yb > py)) continue;
        xs.push(verts[a].x + (py - ya) / (yb - ya) * (verts[b].x - verts[a].x));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Cell centres strictly inside [x0, x1).
      const i0 = Math.max(0, Math.ceil((xs[k] - originX) / cell - 0.5));
      const i1 = Math.min(W - 1, Math.ceil((xs[k + 1] - originX) / cell - 0.5) - 1);
      for (let i = i0; i <= i1; i++) mask[j * W + i] ^= 1;
    }
  }
  return mask;
}

/** Separable box blur, radius r, edge-clamped. */
function _blur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const span = 2 * r + 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[y * W + Math.min(W - 1, Math.max(0, x + k))];
    tmp[y * W + x] = s / span;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(H - 1, Math.max(0, y + k)) * W + x];
    out[y * W + x] = s / span;
  }
  return out;
}

/**
 * Replace the grid distance with the EXACT distance to the outline for cells
 * within a few cells of the shore.
 *
 * The grid transform measures cell centre to cell centre, so near the edge its
 * contours follow the raster's staircase. The coverage edge and the foam line
 * both sit on those contours, which drew a fine zigzag along every diagonal
 * shore. The polygons are in hand, so near the shore the distance is measured
 * to their segments instead.
 *
 * A segment can be the Region's outline past an OPEN map edge, which is not a
 * shore at all. The grid value there is large, so the refined value is only
 * taken when it agrees with the grid value to within the grid's own error.
 */
function _refineNearShore(signed, wet, polygons, W, H, originX, originY, c) {
  const band = 3 * c;
  const B = 16;                                   // cells per bucket side
  const bw = Math.ceil(W / B), bh = Math.ceil(H / B);
  const buckets = new Map();
  const segs = [];
  for (const verts of polygons ?? []) {
    const m = verts?.length ?? 0;
    for (let a = 0, b = m - 1; a < m; b = a++) {
      const s = [verts[b].x, verts[b].y, verts[a].x, verts[a].y];
      const id = segs.push(s) - 1;
      const i0 = Math.max(0, Math.floor((Math.min(s[0], s[2]) - band - originX) / c / B));
      const i1 = Math.min(bw - 1, Math.floor((Math.max(s[0], s[2]) + band - originX) / c / B));
      const j0 = Math.max(0, Math.floor((Math.min(s[1], s[3]) - band - originY) / c / B));
      const j1 = Math.min(bh - 1, Math.floor((Math.max(s[1], s[3]) + band - originY) / c / B));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const key = j * bw + i;
        let list = buckets.get(key);
        if (!list) buckets.set(key, list = []);
        list.push(id);
      }
    }
  }
  const tol = 1.5 * c;
  for (let j = 0; j < H; j++) {
    const py = originY + (j + 0.5) * c;
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const g = Math.abs(signed[k]);
      if (g > band) continue;
      const list = buckets.get(Math.floor(j / B) * bw + Math.floor(i / B));
      if (!list) continue;
      const px = originX + (i + 0.5) * c;
      let best = Infinity;
      for (const id of list) {
        const [ax, ay, bx, by] = segs[id];
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + t * dx - px, ey = ay + t * dy - py;
        const d2 = ex * ex + ey * ey;
        if (d2 < best) best = d2;
      }
      const exact = Math.sqrt(best);
      if (Math.abs(exact - g) <= tol) signed[k] = wet[k] ? exact : -exact;
    }
  }
}

/** Compass bearing (0 = up the map) → unit vector in canvas space (y down). */
export function bearingVector(deg) {
  const r = (Number(deg) || 0) * Math.PI / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
}

/** R channel encoding of a signed distance in px, over ±reach. */
export function encodeSigned(dPx, reachPx) {
  const t = Math.max(-1, Math.min(1, dPx / Math.max(1e-6, reachPx)));
  return Math.round((0.5 + 0.5 * Math.sign(t) * Math.sqrt(Math.abs(t))) * 255);
}

/** The inverse of `encodeSigned`, as the shader does it. */
export function decodeSigned(byte, reachPx) {
  const r = byte / 255 * 2 - 1;
  return Math.sign(r) * r * r * reachPx;
}

/**
 * Bake the shore texture for one Region.
 *
 * @param {Array<Array<{x:number,y:number}>>} polygons  even-odd outline set
 * @param {{x,y,width,height}} bounds   the Region's bounds, canvas px
 * @param {object} opts
 * @param {number} opts.cell        canvas px per cell
 * @param {number} opts.reach       signed-distance range encoded in R, px
 * @param {number} opts.pad         land margin baked round the bounds, px
 * @param {boolean} [opts.openEdges]
 * @param {{x,y,width,height}} [opts.sceneRect]
 * @param {{x:number,y:number}} [opts.flowDir]  unit vector the bank flow agrees with
 * @param {boolean} [opts.banks]    compute the bank tangent (else GB = flowDir)
 * @returns {{width, height, cell, originX, originY, reach, data: Uint8Array,
 *            signed: Float32Array, mask: Uint8Array}}
 */
export function bakeShoreField(polygons, bounds, {
  cell = 8, reach = 400, pad = 100, openEdges = true, sceneRect = null,
  flowDir = { x: 1, y: 0 }, banks = false,
} = {}) {
  const c = Math.max(1, cell);
  const originX = Math.floor((bounds.x - pad) / c) * c;
  const originY = Math.floor((bounds.y - pad) / c) * c;
  const W = Math.max(2, Math.ceil((bounds.x + bounds.width + pad - originX) / c));
  const H = Math.max(2, Math.ceil((bounds.y + bounds.height + pad - originY) / c));

  const mask = rasterizePolygons(polygons, W, H, originX, originY, c);

  // Water for the distance's sake: the Region, plus off-map cells when open.
  const wet = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    const py = originY + (j + 0.5) * c;
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      let w = mask[k];
      if (!w && openEdges && sceneRect) {
        const px = originX + (i + 0.5) * c;
        if (px < sceneRect.x || px > sceneRect.x + sceneRect.width
          || py < sceneRect.y || py > sceneRect.y + sceneRect.height) w = 1;
      }
      wet[k] = w;
    }
  }

  const toLand = edt(W, H, k => !wet[k]);
  // The land side measures to the REGION's water only. Off-map water is there
  // so the sea has no shore at the map border; counted here, it would put a
  // band of swash along the border of the land beside it.
  const toWater = edt(W, H, k => !!mask[k]);
  const signed = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    // Half a cell either side of the edge, so the shore sits between cells.
    signed[k] = wet[k]
      ? (Number.isFinite(toLand[k]) ? toLand[k] - 0.5 : INF) * c
      : -(Number.isFinite(toWater[k]) ? Math.max(0, toWater[k] - 0.5) : INF) * c;
    if (!Number.isFinite(signed[k]) || Math.abs(signed[k]) > reach) signed[k] = Math.sign(signed[k] || 1) * reach;
  }
  _refineNearShore(signed, wet, polygons, W, H, originX, originY, c);

  // Bank tangent: perpendicular to the blurred distance gradient, signed to
  // agree with the GM's flow bearing. Near the centreline the gradient fades
  // to nothing, so it blends back to the bearing there.
  let tx = null, ty = null;
  const fd = { x: Number(flowDir?.x) || 0, y: Number(flowDir?.y) || 0 };
  if (banks) {
    const r = Math.max(1, Math.round(Math.min(W, H) / 64));
    const smooth = _blur(_blur(signed, W, H, r), W, H, r);
    tx = new Float32Array(W * H); ty = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const gx = (smooth[j * W + Math.min(W - 1, i + 1)] - smooth[j * W + Math.max(0, i - 1)]) / (2 * c);
      const gy = (smooth[Math.min(H - 1, j + 1) * W + i] - smooth[Math.max(0, j - 1) * W + i]) / (2 * c);
      let ux = -gy, uy = gx;
      const len = Math.hypot(ux, uy);
      if (len > 1e-6) { ux /= len; uy /= len; }
      if (ux * fd.x + uy * fd.y < 0) { ux = -ux; uy = -uy; }
      const w = Math.min(1, len / 0.3);
      let bx = fd.x + (ux - fd.x) * w, by = fd.y + (uy - fd.y) * w;
      const bl = Math.hypot(bx, by) || 1;
      tx[k] = bx / bl; ty[k] = by / bl;
    }
  }

  const data = new Uint8Array(W * H * 4);
  for (let k = 0; k < W * H; k++) {
    data[k * 4] = encodeSigned(signed[k], reach);
    const fx = tx ? tx[k] : fd.x, fy = ty ? ty[k] : fd.y;
    data[k * 4 + 1] = Math.round((0.5 + 0.5 * fx) * 255);
    data[k * 4 + 2] = Math.round((0.5 + 0.5 * fy) * 255);
    data[k * 4 + 3] = mask[k] ? 255 : 0;
  }
  return { width: W, height: H, cell: c, originX, originY, reach, data, signed, mask, tx, ty };
}
