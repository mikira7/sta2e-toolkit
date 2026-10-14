// node tests/token-maker.mjs
//
// Token Maker maths: the source→output transform and its inverse, the auto
// fit, shape geometry, the magic-eraser flood fill, and output file naming.
// token-maker-compose.js is a leaf with no imports, so it loads as-is.
import assert from 'node:assert/strict';
import {
  applyMatrix, invertMatrix, subjectMatrix, baseScale, autoFit, shapeGeometry,
  floodFill, isWritableNextTo, tokenFileNames, rankPips, pipPlate, emblemDisc,
  rankInsignia, insigniaLabel, ENLISTED_RANKS, ADMIRAL_RANKS, OFFICER_RANKS, officerGradeFor,
} from '../scripts/token-maker-compose.js';

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

await check('identity-ish recipe centres the source and covers the output', () => {
  const m = subjectMatrix({ x: 0.5, y: 0.5, zoom: 1 }, 400, 800, 512);
  const [cx, cy] = applyMatrix(m, 200, 400);
  near(cx, 256); near(cy, 256);
  const [lx] = applyMatrix(m, 0, 400);
  near(lx, 0, 1e-9);                       // shorter side (width) exactly fills
  near(baseScale(400, 800, 512), 1.28);
});

await check('inverse round-trips under rotation, zoom and flip', () => {
  const m = subjectMatrix({ x: 0.3, y: 0.7, zoom: 1.7, rotation: 33, flipX: true }, 640, 480, 512);
  const inv = invertMatrix(m);
  for (const [x, y] of [[0, 0], [123, 456], [640, 480], [320, 10]]) {
    const [ox, oy] = applyMatrix(m, x, y);
    const [bx, by] = applyMatrix(inv, ox, oy);
    near(bx, x, 1e-6); near(by, y, 1e-6);
  }
});

await check('flip mirrors about the portrait centre', () => {
  const a = subjectMatrix({ x: 0.5, y: 0.5 }, 100, 100, 100);
  const b = subjectMatrix({ x: 0.5, y: 0.5, flipX: true }, 100, 100, 100);
  near(applyMatrix(a, 10, 50)[0], 10);
  near(applyMatrix(b, 10, 50)[0], 90);
});

await check('auto fit raises a tall portrait so its upper third is centred', () => {
  const f = autoFit(400, 800, 512);
  assert.equal(f.zoom, 1);
  const m = subjectMatrix(f, 400, 800, 512);
  near(applyMatrix(m, 200, 800 * 0.36)[1], 256, 1);
  assert.equal(autoFit(800, 400).y, 0.5, 'a wide image stays centred');
});

await check('shape geometry', () => {
  const c = shapeGeometry('circle', 512, 0.5);
  assert.deepEqual(c, { type: 'circle', cx: 256, cy: 256, r: 128 });
  const hex = shapeGeometry('hexagon', 512, 1);
  assert.equal(hex.points.length, 12);
  near(hex.points[0], 512); near(hex.points[1], 256);          // flat-topped: a vertex on the right
  const rr = shapeGeometry('rounded', 512, 1);
  assert.equal(rr.points.length, 4 * 7 * 2);
  assert.ok(rr.points.every(v => v >= -1e-9 && v <= 512 + 1e-9), 'stays inside the output');
  assert.equal(shapeGeometry('none', 512).type, 'none');
});

function img(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a] = fn(x, y); const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  }
  return { data, width: w, height: h };
}

await check('flood fill takes the connected background, not the subject or a detached patch', () => {
  // 10×10 white, a black 4×4 subject in the middle, and a white patch sealed inside it.
  const im = img(10, 10, (x, y) => {
    if (x >= 3 && x <= 6 && y >= 3 && y <= 6) return (x === 5 && y === 5) ? [255, 255, 255, 255] : [0, 0, 0, 255];
    return [250, 252, 255, 255];
  });
  const m = floodFill(im, 0, 0, 10);
  const count = m.reduce((a, v) => a + v, 0);
  assert.equal(count, 100 - 16, 'background only');
  assert.equal(m[5 * 10 + 5], 0, 'sealed patch untouched');
  assert.equal(m[4 * 10 + 4], 0, 'subject untouched');
});

await check('flood fill tolerance and transparency', () => {
  const grad = img(20, 1, (x) => [x * 10, x * 10, x * 10, 255]);
  const tight = floodFill(grad, 0, 0, 1).reduce((a, v) => a + v, 0);
  const loose = floodFill(grad, 0, 0, 50).reduce((a, v) => a + v, 0);
  assert.ok(tight < loose, `${tight} < ${loose}`);
  const clear = img(5, 1, (x) => x < 3 ? [9, 9, 9, 0] : [9, 9, 9, 255]);
  assert.equal(floodFill(clear, 0, 0, 100).reduce((a, v) => a + v, 0), 3, 'transparent spreads only through transparent');
  assert.equal(floodFill(clear, 9, 0).reduce((a, v) => a + v, 0), 0, 'out of bounds is a no-op');
});

await check('writable folders exclude core, system and module paths', () => {
  assert.ok(isWritableNextTo('worlds/w/art/bob.webp'));
  assert.ok(isWritableNextTo('assets/portraits/bob.png'));
  for (const p of ['icons/svg/skull.svg', 'systems/sta/x.webp', 'modules/m/x.webp', 'https://x.com/a.png', 'bob.png', '']) {
    assert.ok(!isWritableNextTo(p), p);
  }
});

await check('token file names: next to the portrait, unique, with a mask sibling', () => {
  const a = tokenFileNames('assets/crew/Tharen%20Vosk.webp', []);
  assert.deepEqual(a, { dir: 'assets/crew', name: 'Tharen-Vosk_token.webp', mask: 'Tharen-Vosk_token.mask.png', fellBack: false });
  const b = tokenFileNames('assets/crew/bob.png', ['bob_token.webp', 'BOB_TOKEN-2.webp']);
  assert.equal(b.name, 'bob_token-3.webp');
  const c = tokenFileNames('systems/sta/assets/bob.png', [], 'worlds/w/sta2e-tokens');
  assert.equal(c.dir, 'worlds/w/sta2e-tokens');
  assert.equal(c.fellBack, true);
  const d = tokenFileNames('assets/crew/bob.png', ['bob_token.webp'], 'worlds/w/sta2e-tokens', { forceFallback: true });
  assert.deepEqual([d.dir, d.name, d.fellBack], ['worlds/w/sta2e-tokens', 'bob_token-2.webp', true]);
});

await check('rank text → insignia, all four kinds', () => {
  const O = (solid, hollow) => ({ kind: 'officer', solid, hollow });
  const A = (pips) => ({ kind: 'admiral', pips });
  const E = (chevrons, dots) => ({ kind: 'enlisted', chevrons, dots });
  const C = (bars) => ({ kind: 'cadet', bars });
  const cases = {
    'Ensign': O(1, 0), 'Ens.': O(1, 0),
    'Lieutenant (jg)': O(1, 1), 'Lt. JG': O(1, 1), 'LtJG': O(1, 1), 'Lieutenant Junior Grade': O(1, 1),
    'Lieutenant (Junior Grade)': O(1, 1), 'Lt (j.g.)': O(1, 1),
    'Lieutenant': O(2, 0), 'Lt.': O(2, 0),
    'Lieutenant Commander': O(2, 1), 'Lt. Cmdr': O(2, 1), 'Lt-Cdr': O(2, 1), 'LCDR': O(2, 1),
    'Commander': O(3, 0), 'Cmdr.': O(3, 0),
    'Captain': O(4, 0), 'Capt.': O(4, 0),
    'Chief Warrant Officer': O(0, 1),
    'Commodore': A(1), 'Rear Admiral (Lower Half)': A(1), 'Rear Admiral': A(2), 'RADM (Upper Half)': A(2),
    'Vice Admiral': A(3), 'Admiral': A(4), 'Fleet Admiral': A(5),
    'Petty Officer Third Class': E(1, 0), 'Petty Officer 2nd Class': E(2, 0), 'PO1': E(3, 0), 'Petty Officer': E(1, 0),
    'Chief Petty Officer': E(3, 1), 'CPO': E(3, 1), 'Senior Chief Petty Officer': E(3, 2), 'Master Chief': E(3, 3),
    'Cadet': C(1), 'Cadet, Second Year': C(2), 'Cadet 3rd Year': C(3), 'Cadet Fourth Year': C(4),
  };
  for (const [text, want] of Object.entries(cases)) assert.deepEqual(rankInsignia(text), want, text);
  for (const text of ['', 'Crewman', 'Yeoman', 'Chief Engineer', 'Chief Medical Officer', 'Science Officer']) {
    assert.equal(rankInsignia(text), null, text);
  }
  assert.equal(rankPips('Vice Admiral'), null, 'rankPips stays officer-only');
  assert.deepEqual(rankPips('Lieutenant'), O(2, 0));
  assert.equal(insigniaLabel(E(3, 1)), 'Chief Petty Officer');
  assert.equal(insigniaLabel(A(3)), 'Vice Admiral');
  assert.equal(insigniaLabel(O(2, 1)), 'Lieutenant Commander ○●●', 'grade name, hollow pips first as drawn');
  assert.equal(insigniaLabel(O(5, 2)), '○○●●●●●', 'an unnamed count still shows its pips');
  assert.equal(OFFICER_RANKS.length, 7);
  assert.deepEqual(OFFICER_RANKS.map(o => rankInsignia(o.name)), OFFICER_RANKS.map(o => O(o.solid, o.hollow)), 'every grade name parses back to its own pips');
  assert.equal(officerGradeFor(2, 1).name, 'Lieutenant Commander');
  assert.equal(officerGradeFor(0, 1).name, 'Chief Warrant Officer');
  assert.equal(officerGradeFor(4, 2), null);
  assert.equal(ENLISTED_RANKS.length, 6);
  assert.equal(ADMIRAL_RANKS.length, 5);
});

await check('insignia plates lay out for every kind', () => {
  const adm = pipPlate(512, { kind: 'admiral', pips: 4 });
  assert.equal(adm.kind, 'admiral');
  assert.equal(adm.pips.length, 4);
  assert.ok(adm.pips.every(p => Math.abs(p.x) + p.r <= adm.w / 2 + 1e-9));
  const enl = pipPlate(512, { kind: 'enlisted', chevrons: 3, dots: 2 });
  assert.deepEqual([enl.kind, enl.chevrons, enl.dots], ['enlisted', 3, 2]);
  assert.ok(enl.w > pipPlate(512, { kind: 'enlisted', chevrons: 3, dots: 0 }).w, 'dots widen the tab');
  assert.equal(pipPlate(512, { kind: 'enlisted', chevrons: 0, dots: 0 }), null);
  const cad = pipPlate(512, { kind: 'cadet', bars: 9 });
  assert.equal(cad.bars.length, 4, 'clamped to four years');
  const old = pipPlate(512, { solid: 2, hollow: 1 });
  assert.equal(old.kind, 'officer', 'the older {solid, hollow} shape still reads as an officer');
  for (const p of [adm, enl, cad, old]) near(Math.hypot(p.cx - 256, p.cy - 256) / 256, 0.9, 1e-9);
});

await check('pip plate sits bottom-left on the tangent, hollow pips first', () => {
  assert.equal(pipPlate(512, { solid: 0, hollow: 0 }), null);
  const p = pipPlate(512, { solid: 2, hollow: 1 });
  assert.ok(p.cx < 256 && p.cy > 256, 'bottom left');
  near(Math.hypot(p.cx - 256, p.cy - 256) / 256, 0.9, 1e-9);
  near(p.angle, Math.PI / 4);
  assert.deepEqual(p.pips.map(x => x.hollow), [true, false, false]);
  assert.ok(p.pips.every(x => Math.abs(x.x) + x.r <= p.w / 2 + 1e-9), 'pips inside the plate');
  assert.equal(pipPlate(512, { solid: 9, hollow: 9 }).pips.length, 6, 'clamped');
  const q = pipPlate(512, { solid: 2, hollow: 1 }, { dist: 0.76, scale: 0.82 });
  near(Math.hypot(q.cx - 256, q.cy - 256) / 256, 0.76, 1e-9);
  near(q.pips[0].r, p.pips[0].r * 0.82, 1e-9);
});

await check('emblem disc sits bottom-right, opposite the pips, inside the token', () => {
  const e = emblemDisc(512, { dist: 0.735, r: 0.193 });
  assert.ok(e.cx > 256 && e.cy > 256, 'bottom right');
  near(Math.hypot(e.cx - 256, e.cy - 256) / 256, 0.735, 1e-9);
  near(e.r, 0.193 * 256, 1e-9);
  assert.ok(e.cx + e.r <= 512 && e.cy + e.r <= 512, 'inside the square');
  const d = emblemDisc(512);
  assert.ok(d.cx + d.r <= 512, 'default placement inside too');
  const p = pipPlate(512, { solid: 1, hollow: 0 });
  assert.ok(p.cx < 256 && e.cx > 256, 'pips on the other side');
});

let failed = 0;
for (const [status, name, msg] of results) {
  if (status === 'FAIL') failed++;
  console.log(`${status}  ${name}${msg ? `\n      ${msg}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
