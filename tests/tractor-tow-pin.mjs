// node tests/tractor-tow-pin.mjs
//
// The render pin in tractor-tow-pin.js: a towed token is drawn off its host's
// animated document pose, not its own (lagging) document.
import assert from 'node:assert/strict';
import { captureTowOffset, towBox } from '../scripts/tractor-tow.js';

const G = 100;
const hooks = {};
globalThis.Hooks = { on: (n, fn) => { (hooks[n] ??= []).push(fn); } };

class Point { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; } }
class Token {
  constructor(doc, isPreview = false) {
    this.document = doc; this.isPreview = isPreview;
    this.position = new Point(); this.mesh = { position: new Point(), angle: 0 };
    this.flagsSet = [];
    this.renderFlags = { set: (f) => this.flagsSet.push(f) };
  }
  get center() {
    const d = this.document;
    return new Point(d.x + d.width * G / 2, d.y + d.height * G / 2);
  }
  _refreshPosition() { this.position.set(this.document.x, this.document.y); this.mesh.position = this.center; }
  _refreshRotation() { this.mesh.angle = this.document.rotation; }
}
const tokens = new Map();
globalThis.foundry = { canvas: { placeables: { Token } } };
globalThis.canvas = { grid: { size: G }, tokens: { get: (id) => tokens.get(id) } };

const { registerTractorTowPin, towDrawnPose } = await import('../scripts/tractor-tow-pin.js');
registerTractorTowPin();

const hostDoc = { id: 'H', x: 0, y: 0, width: 2, height: 2, rotation: 0, elevation: 0, flags: {} };
const tgtDoc  = { id: 'T', x: 50, y: -150, width: 1, height: 1, rotation: 0, elevation: 0, flags: {} };
const tow = captureTowOffset(towBox(hostDoc, { final: false, gridSize: G }), towBox(tgtDoc, { final: false, gridSize: G }));
hostDoc.flags['sta2e-toolkit'] = { tractorBeam: { targetTokenId: 'T', behavior: 'tow', tow } };
tgtDoc.flags['sta2e-toolkit']  = { tractorBeam: { sourceTokenId: 'H', behavior: 'tow' } };
const host = new Token(hostDoc), tgt = new Token(tgtDoc);
tokens.set('H', host); tokens.set('T', tgt);

// Host animates 300px right; the target's document has not caught up yet.
hostDoc.x = 300;
tgt._refreshPosition();
assert.equal(tgt.position.x, 350); assert.equal(tgt.position.y, -150);
assert.equal(tgt.mesh.position.x, 400); assert.equal(tgt.mesh.position.y, -100);

// Host turns 90°: the target swings round and turns with it.
hostDoc.rotation = 90;
tgt._refreshPosition(); tgt._refreshRotation();
assert.equal(tgt.mesh.angle, 90);
// Offset from the host centre (400,100) was (0,-200); clockwise 90° makes it (200,0).
assert.ok(Math.abs(tgt.mesh.position.x - 600) < 1e-6, `swing x ${tgt.mesh.position.x}`);
assert.ok(Math.abs(tgt.mesh.position.y - 100) < 1e-6, `swing y ${tgt.mesh.position.y}`);

// The beam aims at the drawn centre, not the lagging document.
{
  const d = towDrawnPose(tgt);
  assert.ok(Math.abs(d.x - 600) < 1e-6 && Math.abs(d.y - 100) < 1e-6 && d.rotation === 90);
}

// A host refresh asks the target to redraw.
hooks.refreshToken[0](host, { refreshPosition: true });
assert.deepEqual(tgt.flagsSet.at(-1), { refreshPosition: true, refreshRotation: true });

// A drag ghost of the target is never pinned.
const ghost = new Token({ ...tgtDoc, x: 900, y: 900 }, true);
ghost._refreshPosition();
assert.equal(ghost.position.x, 900);

// Beam-only locks and released locks draw from their own document.
hostDoc.flags['sta2e-toolkit'].tractorBeam.behavior = 'beamOnly';
tgt._refreshPosition();
assert.equal(tgt.position.x, 50);
assert.equal(towDrawnPose(tgt), null);
hostDoc.flags['sta2e-toolkit'].tractorBeam.behavior = 'tow';
delete tgtDoc.flags['sta2e-toolkit'];
tgt._refreshPosition();
assert.equal(tgt.position.x, 50);

console.log('tractor-tow-pin: all tests passed');
