/**
 * sta2e-toolkit | hull-sections.js
 *
 * Reads a ship's shape from its token art's alpha, for painted hull damage.
 * A LEAF with NO IMPORTS (Node tests, browser preview). Run once per art
 * image and cached by the renderer — never per hit.
 *
 * Two products, used together by hull-damage-field.js:
 *
 *  1. A DISTANCE FIELD: for every hull pixel, how far it is to the nearest
 *     edge, and which edge pixel that is (an exact Euclidean transform with
 *     its feature transform, Felzenszwalb & Huttenlocher). Deck lines drawn as
 *     contours of it run parallel to the hull's outline on any shape.
 *
 *  2. SECTIONS: the hull cut where its LOCAL THICKNESS jumps, each piece
 *     classed as a `disc` (saucer), `long` (nacelle, pylon, neck/boom) or
 *     `block`. Local thickness is the radius of the largest disc inside the
 *     hull covering a pixel. A watershed of the plain distance field was tried
 *     first and fails on the very first ship: seen from above, a saucer's
 *     distance slides smoothly down its neck onto the secondary hull's plateau
 *     with no second peak to split at. Thickness has no such slope — every
 *     saucer pixel sits under the one big central disc, the neck only under
 *     discs its own width — so it steps at the saucer's rim, the pylons' ends
 *     and the nacelles' mounts, and only there.
 *
 * Top-down art only shows what does not overlap: a saucer drawn over its
 * engineering hull with no step in width between them is one section. That
 * costs nothing worse than the outline-following pattern of a `block`.
 */

const INF = 1e20;

function _dt1d(f, n, d, arg, v, z) {
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
    arg[q] = v[k];
  }
}

/**
 * Exact Euclidean distance to the nearest non-hull pixel, plus where that
 * pixel is. The image is framed by a one-pixel border of space, so a hull that
 * runs off the edge of its art still has an edge there.
 * @returns {{dist: Float32Array, nearX: Float32Array, nearY: Float32Array}}
 */
export function distanceField(alpha, W, H, threshold = 32) {
  const Wp = W + 2, Hp = H + 2;
  const n = Math.max(Wp, Hp);
  const f = new Float64Array(n), d = new Float64Array(n);
  const arg = new Int32Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const colD = new Float64Array(Wp * Hp), colArg = new Int32Array(Wp * Hp);
  const inside = (x, y) => x >= 1 && y >= 1 && x <= W && y <= H && alpha[(y - 1) * W + (x - 1)] >= threshold;

  for (let x = 0; x < Wp; x++) {
    for (let y = 0; y < Hp; y++) f[y] = inside(x, y) ? INF : 0;
    _dt1d(f, Hp, d, arg, v, z);
    for (let y = 0; y < Hp; y++) { colD[y * Wp + x] = d[y]; colArg[y * Wp + x] = arg[y]; }
  }
  const dist = new Float32Array(W * H), nearX = new Float32Array(W * H), nearY = new Float32Array(W * H);
  for (let y = 1; y <= H; y++) {
    for (let x = 0; x < Wp; x++) f[x] = colD[y * Wp + x];
    _dt1d(f, Wp, d, arg, v, z);
    for (let x = 1; x <= W; x++) {
      const i = (y - 1) * W + (x - 1);
      const ax = arg[x];
      dist[i] = d[x] >= INF * 0.5 ? 0 : Math.sqrt(d[x]);
      nearX[i] = ax - 1;
      nearY[i] = colArg[y * Wp + ax] - 1;
    }
  }
  return { dist, nearX, nearY };
}

/**
 * Local thickness: every hull pixel takes the radius of the LARGEST disc that
 * fits inside the hull and covers it. Discs are painted from the medial ridge
 * (pixels whose disc no neighbour's disc swallows), biggest first.
 */
export function localThickness(dist, alpha, W, H, threshold = 32) {
  const N = W * H;
  const thick = new Float32Array(N);
  const ridge = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const r = dist[i];
      if (alpha[i] < threshold || r <= 0) continue;
      let covered = false;
      for (let dy = -1; dy <= 1 && !covered; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const qx = x + dx, qy = y + dy;
          if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
          // q's disc contains p's whole disc, so p is not on the ridge.
          if (dist[qy * W + qx] >= r + Math.hypot(dx, dy) * 0.95) { covered = true; break; }
        }
      }
      if (!covered) ridge.push(i);
    }
  }
  ridge.sort((a, b) => dist[b] - dist[a]);
  for (const i of ridge) {
    const r = dist[i], r2 = r * r;
    const cx = i % W, cy = (i - cx) / W;
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= H) continue;
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy >= r2) continue;
        const x = cx + dx;
        if (x < 0 || x >= W) continue;
        const j = y * W + x;
        if (thick[j] < r && alpha[j] >= threshold) thick[j] = r;
      }
    }
  }
  for (let i = 0; i < N; i++) if (alpha[i] >= threshold && thick[i] <= 0) thick[i] = Math.max(0.5, dist[i]);
  return thick;
}

/**
 * Split the hull where its thickness changes fast. A pixel is a JOIN pixel
 * when its thickness differs from a hull pixel `span` px away (in any of the
 * four directions) by more than `jumpRel` of the larger value, and by more
 * than `jumpAbs` px. Comparing across a span rather than with the next pixel
 * matters: every junction has a fillet over which thickness SLIDES from the
 * saucer's 83 to the neck's 43 in a few pixels, a step no pixel-to-pixel ratio
 * sees, while a long taper changes by a fraction of a pixel per pixel. The
 * absolute floor stops a 6 px pylon splitting on the ±1 px rounding of its
 * discs. The rest is flooded into sections (4-connected), the join pixels go
 * to the nearest section, specks are folded into the neighbour they share the
 * longest border with, as is the smallest while there are more than
 * `maxSections`. `label[i]` is the section index of a hull pixel, -1 for space.
 */
export function segmentHull(thick, alpha, W, H, { threshold = 32, span = 3, jumpRel = 0.2, jumpAbs = 1.5, minAreaFrac = 0.004, maxSections = 12 } = {}) {
  const N = W * H;
  const region = new Int32Array(N).fill(-1);
  const isHull = (i) => alpha[i] >= threshold;
  const join = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!isHull(i)) continue;
    const x = i % W, y = (i - x) / W, t = thick[i];
    for (let k = 0; k < 4 && !join[i]; k++) {
      const qx = x + (k === 0 ? span : k === 1 ? -span : 0);
      const qy = y + (k === 2 ? span : k === 3 ? -span : 0);
      if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const q = qy * W + qx;
      if (!isHull(q)) continue;
      const diff = Math.abs(t - thick[q]);
      if (diff > jumpAbs && diff > jumpRel * Math.max(t, thick[q])) join[i] = 1;
    }
  }
  const area = [];
  let hullArea = 0;
  const stack = new Int32Array(N);
  const nb4 = (p, k) => {
    const x = p % W;
    const q = k === 0 ? (x > 0 ? p - 1 : -1) : k === 1 ? (x < W - 1 ? p + 1 : -1) : k === 2 ? p - W : p + W;
    return q >= 0 && q < N ? q : -1;
  };
  for (let s = 0; s < N; s++) {
    if (!isHull(s) || join[s] || region[s] >= 0) continue;
    const id = area.length;
    let top = 0, n = 0;
    stack[top++] = s; region[s] = id;
    while (top) {
      const p = stack[--top];
      n++;
      for (let k = 0; k < 4; k++) {
        const q = nb4(p, k);
        if (q < 0 || region[q] >= 0 || join[q] || !isHull(q)) continue;
        region[q] = id; stack[top++] = q;
      }
    }
    area.push(n);
    hullArea += n;
  }
  // Join pixels go to the nearest section (breadth-first from every section at once).
  let frontier = [];
  for (let i = 0; i < N; i++) if (region[i] >= 0) frontier.push(i);
  while (frontier.length) {
    const next = [];
    for (const p of frontier) {
      for (let k = 0; k < 4; k++) {
        const q = nb4(p, k);
        if (q < 0 || region[q] >= 0 || !isHull(q)) continue;
        region[q] = region[p]; area[region[p]]++; hullArea++;
        next.push(q);
      }
    }
    frontier = next;
  }
  // A part made only of join pixels (a sliver) is its own region.
  for (let s = 0; s < N; s++) {
    if (!isHull(s) || region[s] >= 0) continue;
    const id = area.length;
    let top = 0, n = 0;
    stack[top++] = s; region[s] = id;
    while (top) {
      const p = stack[--top];
      n++;
      for (let k = 0; k < 4; k++) {
        const q = nb4(p, k);
        if (q < 0 || region[q] >= 0 || !isHull(q)) continue;
        region[q] = id; stack[top++] = q;
      }
    }
    area.push(n);
    hullArea += n;
  }
  if (!hullArea) return { label: region, sections: [] };

  // Borders between regions, counted per touching pixel pair.
  const border = new Map();
  for (let i = 0; i < N; i++) {
    const a = region[i];
    if (a < 0) continue;
    const x = i % W;
    for (const j of [x < W - 1 ? i + 1 : -1, i + W < N ? i + W : -1]) {
      const b = j >= 0 ? region[j] : -1;
      if (b < 0 || b === a) continue;
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      border.set(key, (border.get(key) ?? 0) + 1);
    }
  }
  const parent = area.map((_, i) => i);
  const find = (c) => { while (parent[c] !== c) { parent[c] = parent[parent[c]]; c = parent[c]; } return c; };
  const minArea = Math.max(24, hullArea * minAreaFrac);
  const keep = new Set();                 // detached islands with nothing to fold into
  for (let guard = 0; guard < area.length; guard++) {
    const live = [];
    for (let c = 0; c < area.length; c++) if (find(c) === c) live.push(c);
    if (live.length <= 1) break;
    live.sort((a, b) => area[a] - area[b]);
    const cand = live.filter(c => !keep.has(c));
    const victim = cand.find(c => area[c] < minArea) ?? (live.length > maxSections ? cand[0] : null);
    if (victim == null) break;
    const shared = new Map();
    for (const [key, n] of border) {
      const a = find(Math.floor(key / 65536)), b = find(key % 65536);
      if (a === b) continue;
      const other = a === victim ? b : b === victim ? a : null;
      if (other != null) shared.set(other, (shared.get(other) ?? 0) + n);
    }
    let best = null, bestN = 0;
    for (const [o, n] of shared) if (n > bestN) { bestN = n; best = o; }
    if (best == null) { keep.add(victim); continue; }
    parent[victim] = best;
    area[best] += area[victim];
  }

  // Relabel 0..m-1 and measure.
  const label = new Int32Array(N).fill(-1);
  const remap = new Map();
  const acc = [];
  for (let i = 0; i < N; i++) {
    if (region[i] < 0) continue;
    const r = find(region[i]);
    let s = remap.get(r);
    if (s === undefined) {
      s = acc.length; remap.set(r, s);
      acc.push({ n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, peak: 0 });
    }
    label[i] = s;
    const a = acc[s], x = i % W, y = (i - x) / W;
    a.n++; a.sx += x; a.sy += y; a.sxx += x * x; a.syy += y * y; a.sxy += x * y;
    if (thick[i] > a.peak) a.peak = thick[i];
  }
  const sections = acc.map((a, id) => _describe(a, id));
  for (let i = 0; i < N; i++) {
    const s = label[i];
    if (s < 0) continue;
    const x = i % W;
    for (const j of [x < W - 1 ? i + 1 : -1, i + W < N ? i + W : -1]) {
      const t = j >= 0 ? label[j] : -1;
      if (t >= 0 && t !== s) {
        if (!sections[s].touches.includes(t)) sections[s].touches.push(t);
        if (!sections[t].touches.includes(s)) sections[t].touches.push(s);
      }
    }
  }
  return { label, sections };
}

/**
 * Shape statistics → kind. Elongation is the ratio of the principal axes;
 * roundness is the section's thickest disc against the radius of a disc of
 * the same area (1 for a disc, ~0.89 for a square, far less for anything thin).
 */
function _describe(a, id) {
  const n = a.n;
  const cx = a.sx / n, cy = a.sy / n;
  const sxx = a.sxx / n - cx * cx, syy = a.syy / n - cy * cy, sxy = a.sxy / n - cx * cy;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
  const axis = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const elongation = Math.sqrt(l1 / l2);
  const roundness = a.peak / Math.sqrt(n / Math.PI);
  let kind = "block";
  if (elongation >= 2.4) kind = "long";
  else if (elongation <= 1.3 && roundness >= 0.9) kind = "disc";
  return {
    id, kind, area: n, cx, cy, axis, elongation, roundness, peak: a.peak,
    length: 4 * Math.sqrt(l1), width: 4 * Math.sqrt(l2), touches: [],
  };
}

/**
 * Everything at once: the distance field, local thickness, and the sections.
 * @returns {{W, H, dist, nearX, nearY, thick, label: Int32Array, sections: object[]}}
 */
export function analyzeHull(alpha, W, H, opts = {}) {
  const threshold = opts.threshold ?? 32;
  const { dist, nearX, nearY } = distanceField(alpha, W, H, threshold);
  const thick = localThickness(dist, alpha, W, H, threshold);
  const { label, sections } = segmentHull(thick, alpha, W, H, { ...opts, threshold });
  return { W, H, dist, nearX, nearY, thick, label, sections };
}

/** Section index under (or nearest to) a field pixel; -1 if none in reach. */
export function sectionAt(hull, x, y, reach = 6) {
  if (!hull) return -1;
  const { W, H, label } = hull;
  const xi = Math.round(x), yi = Math.round(y);
  for (let r = 0; r <= reach; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = xi + dx, py = yi + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const l = label[py * W + px];
        if (l >= 0) return l;
      }
    }
  }
  return -1;
}
