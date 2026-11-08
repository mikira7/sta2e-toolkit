// node tests/tractor-tow.mjs
//
// Tractor tow geometry in tractor-tow.js: a rigid offset in the host's local
// frame, so the towed ship swings with the host and stays where it was put.
import assert from 'node:assert/strict';
import { captureTowOffset, towPose, towBox, legacyTowOffset, defaultTowDist, resolveTowOffset } from '../scripts/tractor-tow.js';

const G = 100;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
const box = (x, y, cells, rotation = 0, elevation = 0) => ({ x, y, w: cells * G, h: cells * G, rotation, elevation });
const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

// Round trip: capture then pose returns the original target, at awkward angles.
for (const rot of [0, 37, 90, 211, 359]) {
  const src = box(500, 400, 2, rot, 3);
  const tgt = box(180, 720, 1, 15, 7);
  const p = towPose(src, captureTowOffset(src, tgt), tgt);
  near(p.x, tgt.x, `x @${rot}`); near(p.y, tgt.y, `y @${rot}`);
  near(p.cx, tgt.x + 50, `cx @${rot}`);
  near(p.rotation, 15, `rotation @${rot}`); near(p.elevation, 7, `elevation @${rot}`);
}

// Legacy offset equals the old behindX/behindY formula at the cardinal angles.
for (const rot of [0, 90, 180, 270]) {
  const src = box(300, 300, 2, rot), tgt = box(0, 0, 1);
  const d = defaultTowDist(src, tgt, G);
  near(d, 170, 'default tow distance');
  const p = towPose(src, legacyTowOffset(d), tgt);
  const r = rot * Math.PI / 180, sc = centre(src);
  near(p.x, sc.x + Math.sin(r) * d - 50, `legacy x @${rot}`);
  near(p.y, sc.y - Math.cos(r) * d - 50, `legacy y @${rot}`);
}

// Rotating the host 90° swings the target 90° about the host centre.
{
  const src = box(1000, 1000, 3), tgt = box(1100, 700, 1);
  const p = towPose({ ...src, rotation: 90 }, captureTowOffset(src, tgt), tgt);
  const sc = centre(src), tc = centre(tgt);
  near(p.cx - sc.x, -(tc.y - sc.y), 'swing x'); near(p.cy - sc.y, tc.x - sc.x, 'swing y');
  near(p.rotation, 90, 'swing rotation');
}

// Rotation wraps into [0, 360).
near(towPose(box(0, 0, 1, 350), { lx: 0, ly: 0, drot: 30 }, box(0, 0, 1)).rotation, 20, 'wrap up');
near(towPose(box(0, 0, 1, 10), { lx: 0, ly: 0, drot: -30 }, box(0, 0, 1)).rotation, 340, 'wrap down');

// towBox reads FINAL (_source) values by default, the drawn ones on request.
// Core runs the first animation frame before updateToken hooks, so the
// document's own x/y holds where the host started — the bug this guards.
{
  const doc = { x: 10, y: 20, rotation: 0, elevation: 0, width: 2, height: 1,
    _source: { x: 500, y: 600, rotation: 90, elevation: 2, width: 2, height: 1 },
    getSize: ({ width, height }) => ({ width: width * 87, height: height * 100 }) };
  const fin = towBox(doc);
  assert.deepEqual([fin.x, fin.y, fin.rotation, fin.elevation, fin.w, fin.h], [500, 600, 90, 2, 174, 100]);
  const drawn = towBox(doc, { final: false });
  assert.deepEqual([drawn.x, drawn.y, drawn.rotation], [10, 20, 0]);
  // Without getSize, width × gridSize.
  const plain = towBox({ x: 0, y: 0, width: 3, height: 2 }, { gridSize: 50 });
  assert.deepEqual([plain.w, plain.h], [150, 100]);
}

// resolveTowOffset prefers the stored offset, else towDist, else the default.
{
  const src = box(0, 0, 2), tgt = box(0, 0, 1);
  assert.deepEqual(resolveTowOffset({ tow: { lx: 1, ly: 2, drot: 3, delev: 4 } }, src, tgt), { lx: 1, ly: 2, drot: 3, delev: 4 });
  near(resolveTowOffset({ towDist: 250 }, src, tgt).ly, -250, 'towDist');
  near(resolveTowOffset({}, src, tgt, G).ly, -170, 'default');
}

console.log('tractor-tow: all tests passed');
