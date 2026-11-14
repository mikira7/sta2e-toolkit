// node tests/water-shore-field.mjs
//
// The Water Surface shore bake: even-odd coverage (islands are land), a signed
// distance that is ~0 on the shore, positive in the water and negative on the
// land, open map edges that carry no shore, and bank tangents that run along a
// river rather than across it.
import assert from 'node:assert/strict';
import {
  bakeShoreField, rasterizePolygons, edt, encodeSigned, decodeSigned, bearingVector,
} from '../scripts/water-shore-field.js';

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const at = (f, px, py) => {
  const i = Math.floor((px - f.originX) / f.cell), j = Math.floor((py - f.originY) / f.cell);
  return j * f.width + i;
};

// ── EDT sanity ──
{
  const d = edt(5, 1, k => k === 0);
  assert.deepEqual([...d], [0, 1, 2, 3, 4]);
  assert.ok(edt(3, 3, () => false).every(v => v === Infinity), 'no features → Infinity');
}

// ── Island hole is land ──
{
  const polys = [rect(0, 0, 400, 400), rect(150, 150, 100, 100)];
  const m = rasterizePolygons(polys, 40, 40, 0, 0, 10);
  assert.equal(m[5 * 40 + 5], 1, 'open water is covered');
  assert.equal(m[20 * 40 + 20], 0, 'island centre is not covered');
  const f = bakeShoreField(polys, { x: 0, y: 0, width: 400, height: 400 },
    { cell: 10, reach: 300, pad: 50, openEdges: false });
  assert.equal(f.data[at(f, 200, 200) * 4 + 3], 0, 'island coverage 0');
  assert.equal(f.data[at(f, 50, 50) * 4 + 3], 255, 'water coverage 255');
  assert.ok(f.signed[at(f, 200, 200)] < 0, 'island is land side');
  // Water just off the island shore is close to it.
  assert.ok(f.signed[at(f, 135, 200)] > 0 && f.signed[at(f, 135, 200)] < 25, 'island shore foams');
}

// ── Signed distance: ~0 on the edge, + inside, − outside ──
{
  const f = bakeShoreField([rect(0, 0, 400, 400)], { x: 0, y: 0, width: 400, height: 400 },
    { cell: 4, reach: 300, pad: 80, openEdges: false });
  const inside = f.signed[at(f, 200, 200)];
  const edgeIn = f.signed[at(f, 2, 200)];
  const edgeOut = f.signed[at(f, -2, 200)];
  const out = f.signed[at(f, -60, 200)];
  assert.ok(Math.abs(inside - 198) <= 4, `centre ≈ 200 px from shore (${inside})`);
  assert.ok(Math.abs(edgeIn) <= 4 && Math.abs(edgeOut) <= 4, 'edge ≈ 0');
  assert.ok(edgeIn > 0 && edgeOut < 0, 'sign flips at the shore');
  assert.ok(Math.abs(out + 58) <= 4, `land side negative (${out})`);
  // Encoding round trip keeps precision near the shore.
  for (const d of [-30, -3, 0, 2, 25, 150]) {
    assert.ok(Math.abs(decodeSigned(encodeSigned(d, 300), 300) - d) < Math.max(1.5, Math.abs(d) * 0.08), `encode ${d}`);
  }
}

// ── Open edges: no shore along the map border ──
{
  const scene = { x: 0, y: 0, width: 1000, height: 600 };
  // An ocean filling the left half, running off the top, left and bottom.
  const polys = [rect(-50, -50, 550, 700)];
  const b = { x: -50, y: -50, width: 550, height: 700 };
  const open = bakeShoreField(polys, b, { cell: 10, reach: 400, pad: 60, openEdges: true, sceneRect: scene });
  const shut = bakeShoreField(polys, b, { cell: 10, reach: 400, pad: 60, openEdges: false, sceneRect: scene });
  const nearLeftEdge = at(open, 5, 300);
  assert.ok(open.signed[nearLeftEdge] > 300, `open: map border is not shore (${open.signed[nearLeftEdge]})`);
  assert.ok(shut.signed[nearLeftEdge] < 100, `shut: map border region edge is shore (${shut.signed[nearLeftEdge]})`);
  // The real shore at x = 500 still foams with open edges on.
  assert.ok(Math.abs(open.signed[at(open, 495, 300)]) < 12, 'interior shore kept');
}

// ── Near the shore the distance is exact, not the raster's staircase ──
{
  // A triangle whose hypotenuse runs at ~27° from (0,0) to (400,200).
  const tri = [{ x: 0, y: 0 }, { x: 400, y: 200 }, { x: 0, y: 200 }];
  const f = bakeShoreField([tri], { x: 0, y: 0, width: 400, height: 200 },
    { cell: 6, reach: 300, pad: 40, openEdges: false });
  const len = Math.hypot(400, 200);
  let worst = 0, checked = 0;
  for (let j = 0; j < f.height; j++) for (let i = 0; i < f.width; i++) {
    const px = f.originX + (i + 0.5) * f.cell, py = f.originY + (j + 0.5) * f.cell;
    if (px < 60 || px > 340) continue;                         // away from the corners
    const toLine = (400 * py - 200 * px) / len;                // + below the line (inside)
    if (Math.abs(toLine) > 12) continue;                       // the shore band
    worst = Math.max(worst, Math.abs(f.signed[j * f.width + i] - toLine));
    checked++;
  }
  assert.ok(checked > 50 && worst < 0.5, `exact near the slanted shore (worst ${worst.toFixed(2)} px over ${checked})`);
}

// ── Open edges never make a shore on the land side ──
{
  // A lake 100 px in from the left border; the land between must measure to the
  // lake, not to the off-map water past the border (which would put swash there).
  const scene = { x: 0, y: 0, width: 1000, height: 600 };
  const f = bakeShoreField([rect(100, 200, 300, 200)], { x: 100, y: 200, width: 300, height: 200 },
    { cell: 5, reach: 400, pad: 120, openEdges: true, sceneRect: scene });
  const nearBorder = f.signed[at(f, 5, 300)];
  assert.ok(nearBorder < -85, `land at the map border is far from shore (${nearBorder})`);
}

// ── Bank tangents run along a straight river ──
{
  // River running left→right, 100 px wide, bearing 90 (east).
  const polys = [rect(0, 200, 800, 100)];
  const dir = bearingVector(90);
  assert.ok(Math.abs(dir.x - 1) < 1e-9 && Math.abs(dir.y) < 1e-9, 'bearing 90 is +x');
  const f = bakeShoreField(polys, { x: 0, y: 200, width: 800, height: 100 },
    { cell: 5, reach: 200, pad: 40, openEdges: false, flowDir: dir, banks: true });
  for (const y of [215, 235, 265, 285]) {
    const k = at(f, 400, y);
    assert.ok(f.tx[k] > 0.95, `flow along the river at y=${y}: (${f.tx[k].toFixed(2)}, ${f.ty[k].toFixed(2)})`);
  }
  // And a north→south river with bearing 180 flows +y.
  const g = bakeShoreField([rect(200, 0, 100, 800)], { x: 200, y: 0, width: 100, height: 800 },
    { cell: 5, reach: 200, pad: 40, openEdges: false, flowDir: bearingVector(180), banks: true });
  assert.ok(g.ty[at(g, 220, 400)] > 0.95 && g.ty[at(g, 280, 400)] > 0.95, 'south-running river');
}

console.log('water-shore-field: all tests passed');
