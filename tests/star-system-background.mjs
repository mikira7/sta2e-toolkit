// node --experimental-vm-modules tests/star-system-background.mjs [preview.png]
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import vm from "node:vm";
const modules = new Map();
async function load(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const module = new vm.SourceTextModule(await readFile(url, "utf8"));
  modules.set(url.href, module);
  await module.link(s => load(new URL(s, url))); return module;
}
const module = await load(new URL("../scripts/star-system-background.js", import.meta.url));
await module.evaluate();
const { normalizeStarfieldRecipe, starfieldDimensions, renderStarfieldPixels, saveStarfieldBackground, getSavedStarfieldBackgrounds } = module.namespace;
assert.equal(normalizeStarfieldRecipe({ density: Infinity }).density, 100);
assert.equal(normalizeStarfieldRecipe({ strength: -4 }).strength, 0);
assert.equal(normalizeStarfieldRecipe({ resolution: 90000 }).resolution, 4096);
assert.equal(normalizeStarfieldRecipe({ palette: "missing" }).palette, "violet");
assert.equal(starfieldDimensions(30000, 15000, 2048).height, 1024);
assert.equal(starfieldDimensions(30000, 30000, 4096).width, 4096);
const recipe = { seed: "stellar-background-test", resolution: 512 };
const plain = await renderStarfieldPixels(recipe, 6000, 4000);
assert.equal(plain.width, 512); assert.equal(plain.height, 341);
assert.deepEqual(plain.pixels, (await renderStarfieldPixels(recipe, 6000, 4000)).pixels, "Seed reproduces artwork");
assert.notDeepEqual(plain.pixels, (await renderStarfieldPixels({ ...recipe, seed: "another-field" }, 6000, 4000)).pixels);
const black = await renderStarfieldPixels({ ...recipe, density: 0 }, 6000, 4000);
assert(black.pixels.every((v, i) => v === [2, 4, 9, 255][i % 4]), "Zero density leaves a clean dark background");
assert(plain.pixels.some((v, i) => i % 4 === 0 && v > 160), "Bright stars render");
assert.deepEqual(plain.pixels, (await renderStarfieldPixels({ ...recipe, nebula: true, strength: 0 }, 6000, 4000)).pixels);
let preview;
for (const palette of ["violet", "teal", "amber", "rose"]) {
  const progress = [];
  const field = await renderStarfieldPixels({ ...recipe, nebula: true, palette }, 6000, 4000, { onProgress: n => progress.push(n) });
  assert.notDeepEqual(field.pixels, plain.pixels, `${palette} adds gas clouds`);
  assert(field.pixels.every((v, i) => i % 4 !== 3 || v === 255), "Opaque background");
  assert(progress.every((n, i) => !i || n >= progress[i - 1]), "Progress is monotonic");
  if (palette === "violet") preview = field;
}
// Upload failures must stop creation rather than silently creating a blank scene.
let uploaded, released = false;
globalThis.document = { createElement: () => ({
  width: 0, set height(value) { if (!value) released = true; },
  getContext: () => ({ putImageData() {} }), toBlob: callback => callback({ type: "image/webp" }),
}) };
globalThis.ImageData = class {};
globalThis.File = class { constructor(parts, name, options) { this.name = name; this.type = options.type; } };
globalThis.game = { world: { id: "test-world" } };
globalThis.foundry = { applications: { apps: { FilePicker: { implementation: {
  async createDirectory() {},
  async upload(source, directory, file) { uploaded = { source, directory, file }; return { path: `${directory}/${file.name}` }; },
} } } } };
const saved = await saveStarfieldBackground(recipe, 6000, 4000);
assert(saved.src.startsWith("worlds/test-world/sta2e-procedural-backgrounds/"));
assert.equal(uploaded.file.type, "image/webp"); assert(released, "Canvas memory released");
const same = await saveStarfieldBackground(recipe, 6000, 4000);
assert.equal(saved.src, same.src, "Identical recipes use identical filenames");
const orphan = "worlds/test-world/sta2e-procedural-backgrounds/sta2e-starfield-deadbeef.webp";
foundry.applications.apps.FilePicker.implementation.browse = async () => ({ files: [saved.src, saved.src, orphan, "unrelated.webp"] });
game.scenes = [{ name: "Original scene", levels: { contents: [{ background: { src: saved.src } }] },
  getFlag: () => saved.recipe }];
let library = await getSavedStarfieldBackgrounds();
assert.equal(library.length, 2, "Saved files survive deletion of their scene and duplicate paths are removed");
assert.equal(library.find(entry => entry.src === saved.src).label, "Original scene");
assert.equal(library.find(entry => entry.src === saved.src).recipe.seed, recipe.seed);
game.scenes = [{ name: "Legacy scene", background: { src: saved.src }, getFlag: () => saved.recipe }];
foundry.applications.apps.FilePicker.implementation.browse = async () => { throw new Error("Folder unavailable"); };
library = await getSavedStarfieldBackgrounds();
assert.equal(library[0].src, saved.src, "Scene references remain reusable when browsing is unavailable");
game.scenes = [];
assert.equal((await getSavedStarfieldBackgrounds()).length, 0, "New worlds have an empty library");
foundry.applications.apps.FilePicker.implementation.upload = async () => ({});
await assert.rejects(saveStarfieldBackground(recipe, 6000, 4000), /Background upload failed/);
// Exercise the shared creation path against both Foundry background schemas.
globalThis.ActorSheet = class {};
foundry.applications.api = { ApplicationV2: class {}, HandlebarsApplicationMixin: c => c };
foundry.utils = { randomID: () => "test-id", deepClone: structuredClone };
game.settings = { get: () => ({}) };
globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0 }, DRAWING_FILL_TYPES: { SOLID: 1, NONE: 0 } };
let sceneCreates = 0;
globalThis.Scene = { create: async data => {
  sceneCreates++;
  return { ...data, createEmbeddedDocuments: async () => {}, delete: async () => {} };
} };
const sceneModule = await load(new URL("../scripts/star-system-scene.js", import.meta.url));
await sceneModule.evaluate();
const { buildPlanetaryEncounterScene } = sceneModule.namespace;
const actor = { id: "actor-id", name: "System" }, data = { designation: "Test system" };
const world = { id: "world-id", name: "Planet", type: "Class-M", image: "planet.webp" };
const build = options => buildPlanetaryEncounterScene(actor, data, world, "custom.webp", options);
for (const generation of [13, 14]) {
  game.release = { generation };
  foundry.applications.apps.FilePicker.implementation.upload = async () => ({ path: "generated.webp" });
  const scene = await build({ proceduralBackground: recipe });
  assert.equal(generation === 14 ? scene.levels[0].background.src : scene.background.src, "generated.webp");
  assert.equal(scene.flags["sta2e-toolkit"].starSystemBackground.seed, recipe.seed);
  const custom = await build({});
  assert.equal(generation === 14 ? custom.levels[0].background.src : custom.background.src, "custom.webp");
  assert.equal(custom.flags["sta2e-toolkit"].starSystemBackground, undefined);
  foundry.applications.apps.FilePicker.implementation.upload = async () => { throw new Error("Reuse must never upload"); };
  const reused = await build({ savedBackgroundRecipe: saved.recipe });
  assert.equal(generation === 14 ? reused.levels[0].background.src : reused.background.src, "custom.webp");
  assert.equal(reused.flags["sta2e-toolkit"].starSystemBackground.seed, recipe.seed);
}
const beforeFailure = sceneCreates;
foundry.applications.apps.FilePicker.implementation.upload = async () => ({});
await assert.rejects(build({ proceduralBackground: recipe }), /Background upload failed/);
assert.equal(sceneCreates, beforeFailure, "Failed background upload never creates a scene");
if (process.argv[2]) {
  const { width, height, pixels } = preview;
  const data = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) data.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const chunk = (type, bytes) => {
    const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    let crc = -1;
    for (const n of Buffer.concat([name, bytes])) { crc ^= n; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    length.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ -1) >>> 0);
    return Buffer.concat([length, name, bytes, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  await writeFile(process.argv[2], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(data)), chunk("IEND", Buffer.alloc(0))]));
}
console.log("PASS: seeded fields, palettes, saved library discovery, image reuse without uploads, v13/v14 scenes, and upload failures.");
