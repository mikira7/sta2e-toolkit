// node tests/noise-tiling.mjs
//
// buildNoiseTexture must TILE: the water and beam shaders sample it far outside
// 0..1 with REPEAT, so a jump between its right and left edges (or bottom and
// top) draws a straight seam on every repeat. It used to wrap its lattice at 64
// cells while only spanning 4, which left a ~46-level jump at the edge.
import assert from 'node:assert/strict';

let last;
globalThis.document = { createElement: () => ({ getContext: () => ({
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData: img => { last = img; },
}) }) };
globalThis.PIXI = { Texture: { from: () => ({ baseTexture: {} }) }, WRAP_MODES: { REPEAT: 1 } };
const { buildNoiseTexture } = await import('../scripts/starfield-common.js');

for (const [size, features] of [[128, 4], [256, 4], [256, 3]]) {
  buildNoiseTexture({ size, octaves: 4, features });
  const px = (x, y) => last.data[(y * size + x) * 4];
  let seamX = 0, seamY = 0, inner = 0;
  for (let i = 0; i < size; i++) {
    seamX += Math.abs(px(size - 1, i) - px(0, i));
    seamY += Math.abs(px(i, size - 1) - px(i, 0));
    inner += Math.abs(px(size >> 1, i) - px((size >> 1) - 1, i));
  }
  seamX /= size; seamY /= size; inner /= size;
  const limit = Math.max(1.5, inner * 4);
  assert.ok(seamX < limit && seamY < limit,
    `size ${size} features ${features}: edge jump ${seamX.toFixed(2)}/${seamY.toFixed(2)} vs neighbour ${inner.toFixed(2)}`);
}
console.log('noise-tiling: all tests passed');
