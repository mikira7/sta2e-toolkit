// node --experimental-vm-modules tests/console-cinematic-vfx.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const filters = [], textures = [], gradients = [];
class Container {
  constructor() { this.children = []; this.position = { set: (x,y) => { this.x = x; this.y = y; } }; }
  addChild(child) { this.children.push(child); child.parent = this; }
  removeChild(child) { this.children = this.children.filter(c => c !== child); child.parent = null; }
  destroy(options) { this.destroys = (this.destroys ?? 0) + 1; if (options?.children) this.children.forEach(c => c.destroy()); }
}
class Graphics extends Container {
  beginFill() { return this; } drawRect() { return this; } endFill() { return this; }
  rect() { return this; } fill() { return this; }
}
class Sprite extends Container {
  constructor(texture) { super(); this.texture = texture; this.anchor = { set() {} }; }
}
class Filter {
  constructor(vertex, fragment, uniforms) {
    if (typeof vertex === "object" && vertex) {
      this.resources = { consoleUniforms: { uniforms: Object.fromEntries(Object.entries(vertex.resources.consoleUniforms).map(([k,v]) => [k,v.value])) } };
      this.glProgram = vertex.glProgram;
    } else {
      this.fragment = fragment; this.uniforms = uniforms;
      this.program = { glPrograms: { test: { program: "compiled" } } };
    }
    filters.push(this);
  }
  destroy() { this.destroys = (this.destroys ?? 0) + 1; }
}
const PIXI = { VERSION: "7.4.3", Container, Graphics, Sprite, Filter, BLEND_MODES: { ADD: "add" },
  GlProgram: { from: source => source },
  Texture: { from: () => { const texture = { destroy() { this.destroys = (this.destroys ?? 0) + 1; } }; textures.push(texture); return texture; } } };
let links = true;
const renderer = { gl: { LINK_STATUS: 1, getProgramParameter: () => links }, CONTEXT_UID: "test", shader: { generateProgram() {} } };
const context = vm.createContext({ console: { warn() {} }, PIXI, canvas: { app: { renderer } },
  document: { createElement: () => ({ getContext: () => ({
    createRadialGradient: () => ({ addColorStop: (offset, color) => gradients.push({ offset, color }) }),
    fillRect() {},
  }) }) } });
const mod = new vm.SourceTextModule(await readFile(new URL("../scripts/console-cinematic-vfx.js", import.meta.url),"utf8"), { context });
await mod.link(() => {}); await mod.evaluate(); const api = mod.namespace;

for (const version of ["7.4.3", "8.14.0"]) {
  PIXI.VERSION = version;
  const volume = api.createConsoleExplosionVolume(60,12345);
  assert.ok(volume, `volume available for PIXI ${version}`);
  const filter = filters.at(-1);
  const source = filter.fragment ?? filter.glProgram.fragment;
  assert.ok(source.includes("stepIndex<16"), "bounded volume integration");
  assert.ok(source.includes("transmission = 1.0-alpha"), "foreground smoke absorbs the interior");
  assert.ok(source.includes("texture2D"), "volume respects source alpha");
  assert.ok(source.includes(version.startsWith("7") ? "inputSize.xy / outputFrame.zw" : "uInputSize.xy / uOutputFrame.zw"));
  volume.update(.4);
  const uniforms = filter.uniforms ?? filter.resources.consoleUniforms.uniforms;
  assert.equal(uniforms.uProgress,.4); assert.equal(uniforms.uSeed,2345);
  volume.update(2); assert.equal(uniforms.uProgress,1);
  volume.update(-1); assert.equal(uniforms.uProgress,0);
  const display = volume.display; volume.destroy(); volume.destroy();
  assert.equal(filter.destroys,1); assert.equal(display.destroys,1);
}
PIXI.VERSION = "7.4.3"; links = false;
assert.equal(api.createConsoleExplosionVolume(60,1),null, "link failure chooses shaded fallback");
assert.equal(filters.at(-1).destroys,1, "failed shader released");
links = true;
delete renderer.gl;
assert.equal(api.createConsoleExplosionVolume(60,1),null, "non-WebGL chooses fallback");

const first = api.createConsoleElectricalBloom(60), second = api.createConsoleElectricalBloom(120);
assert.ok(first && second); assert.equal(textures.length,1, "all bursts share one soft glow texture");
assert.equal(gradients.at(-1).offset,1); assert.ok(gradients.at(-1).color.includes(",0)"), "glow edge fully transparent");
assert.equal(first.display.children.length,8, "aura, core, lens flare and five contact glows");
first.update(.2,.8); first.contact(0,10,20,.7);
assert.equal(first.display.children[3].x,10); assert.equal(first.display.children[3].y,20);
assert.ok(first.display.children.every(c => c.blendMode === "add"));
assert.ok(first.display.children[0].alpha > 0);
first.update(1,1); assert.ok(first.display.children.every(c => c.alpha === 0), "all lights fade completely");
first.destroy(); first.destroy(); second.destroy();
assert.equal(first.display.destroys,1); assert.ok(!textures[0].destroys, "per-burst cleanup preserves shared texture");
api.clearConsoleCinematicTextures(); assert.equal(textures[0].destroys,1);
api.createConsoleElectricalBloom(60); assert.equal(textures.length,2, "new canvas can recreate glow texture");
api.clearConsoleCinematicTextures();
console.log("Console cinematic checks passed: PIXI 7/8 volume resources, bounded ray marching, alpha mapping, fallback, soft shared glow, pulse/contact/fade and resource cleanup.");
