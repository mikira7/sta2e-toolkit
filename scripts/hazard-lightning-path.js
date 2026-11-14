/** CPU counterpart of the hazard shader's advancing leaders, for PIXI lines.
 * Arrival times belong to vertices: forks cannot start before their junction.
 * Geometry is generated once per strike and never re-randomized during growth.
 */
const hash = (x, y) => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

function leader(start, heading, seed, scale) {
  const points = [{ ...start }];
  let angle = heading;
  for (let j = 0; j < 10; j++) {
    const last = points.at(-1);
    angle = angle * .75 + heading * .25 + (hash(seed, j) - .5) * 1.7;
    const step = (.045 + .045 * hash(j, seed + 7)) * scale;
    points.push({ x: last.x + Math.cos(angle) * step,
      y: last.y + Math.sin(angle) * step,
      time: last.time + .035 + .065 * hash(seed + 31, j) });
  }
  return points;
}

export function buildHazardLightningPath(x, y, radius, seed) {
  const angle = hash(seed, 0) * Math.PI * 2;
  const main = leader({ x, y, time: 0 }, angle, seed, radius);
  const forkAngle = angle + (hash(seed, 4) > .5 ? 1 : -1) * (.55 + hash(seed, 5));
  const branches = [leader(main[3], forkAngle, seed + 91, radius * .65),
    leader(main[6], angle - 1, seed + 173, radius * .4)];
  return { main, branches };
}

export function sampleHazardLightningPath(path, age) {
  const sample = points => {
    if (age <= points[0].time) return [];
    const visible = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (age >= b.time) { visible.push(b); continue; }
      const t = (age - a.time) / (b.time - a.time);
      visible.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      break;
    }
    return visible;
  };
  return { main: sample(path.main), branches: path.branches.map(sample) };
}
