/** Catchments and closed drainage lakes, derived from the downhill river graph. */
export function buildRiverBasins(d, sea, order) {
  const basinIds = new Int32Array(d.next.length).fill(-1);
  const lakeLevels = new Float32Array(d.next.length).fill(-1);
  const lakes = new Float32Array(d.next.length);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k], j = d.next[i];
    basinIds[i] = j >= 0 ? basinIds[j] : i;
    if (j >= 0 || d.heights[i] <= sea + .008 || d.flow[i] < 20) continue;
    const x = i % d.width, y = Math.floor(i / d.width);
    let spill = Infinity;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if ((!ox && !oy) || y + oy < 0 || y + oy >= d.height) continue;
      spill = Math.min(spill, d.heights[(y + oy) * d.width + (x + ox + d.width) % d.width]);
    }
    // Keep water below the lowest rim, with a cap for small inland lakes.
    lakeLevels[i] = Math.min(spill - .0002, d.heights[i] + .012);
  }
  for (let i = 0; i < lakes.length; i++) {
    const level = lakeLevels[basinIds[i]];
    if (level > d.heights[i]) lakes[i] = Math.min(1, (level - d.heights[i]) / .003);
  }
  return { basinIds, lakeLevels, lakes };
}

export function lakeCoverage(d, gx, gy) {
  const x = Math.floor(gx), y = Math.floor(gy), u = gx - x, v = gy - y;
  const at = (cx, cy) => cy < 0 || cy >= d.height ? 0 : d.lakes[cy * d.width + (cx + d.width) % d.width];
  const value = (at(x, y) * (1 - u) + at(x + 1, y) * u) * (1 - v)
    + (at(x, y + 1) * (1 - u) + at(x + 1, y + 1) * u) * v;
  // Smooth shore transitions rather than revealing the drainage grid.
  const t = Math.max(0, Math.min(1, (value - .12) / .70));
  return t * t * (3 - 2 * t);
}
