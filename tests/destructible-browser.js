import { generateObjectArt, loadObjectImage, cutRegion, measureRegion } from "../scripts/destructible-art.js";
import { normalizeDestructible, fracturePolygon, UNIT_POLYGON } from "../scripts/destructible-geometry.js";
import { requestObjectOperation, getDestructibleState, getDestructibleConfig, saveDestructibleConfig, registerDestructibleObjects } from "../scripts/destructible-objects.js";
import { objectPanelHtml, wireObjectPanel } from "../scripts/destructible-panel.js";
import { objectDamageRow, registerDestructibleCombat } from "../scripts/destructible-combat.js";
const results = document.querySelector("#results"), lines = [];
function assert(value, label) { if (!value) throw new Error(label); }
async function test(name, fn) { await fn(); lines.push(`PASS ${name}`); results.textContent = lines.join("\n"); }
class Collection extends Map { [Symbol.iterator]() { return this.values(); } find(fn) { return [...this].find(fn); } filter(fn) { return [...this].filter(fn); } }
const hooks = new Map();
window.Hooks = { on(name, fn) { const list = hooks.get(name) || []; list.push(fn); hooks.set(name, list); }, once(name, fn) { this.on(name, fn); } };
let serial = 0, failUpload = false, partialCreate = false;
const apply = (o, path, value) => { const parts = path.split("."); for (const p of parts.slice(0, -1)) o = o[p] ??= {}; o[parts.at(-1)] = structuredClone(value); };
const get = (o, path) => path.split(".").reduce((v, key) => v?.[key], o);
const scope = "sta2e-toolkit";
window.ui = { notifications: { info() {}, warn() {}, error: console.error } };
window.foundry = { utils: { randomID: () => `test${String(++serial).padStart(12, "0")}`, deepClone: value => structuredClone(value) }, applications: { apps: { FilePicker: { implementation: {
  createDirectory: async () => {}, upload: async (_storage, _path, file) => {
    if (failUpload) throw new Error("Injected upload failure");
    return { path: await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); }) };
  }, } } } } };
const actor = { id: "actor", img: "", flags: {}, updates: 0, getFlag(m, k) { return get(this.flags[m], k); }, async update(data) { this.updates++; for (const [k, v] of Object.entries(data)) apply(this, k, v); } };
const scene = { id: "scene", grid: { size: 100 }, flags: {}, tokens: new Collection(), getFlag(m, k) { return get(this.flags[m], k); }, async setFlag(m, k, v) { apply(this, `flags.${m}.${k}`, v); }, async createEmbeddedDocuments(_kind, data) {
  const made = []; for (const entry of data) { const token = makeToken(entry); made.push(token); if (partialCreate) { partialCreate = false; throw new Error("Injected partial token creation"); } } return made;
}, async deleteEmbeddedDocuments(_kind, ids) { for (const id of ids) this.tokens.delete(id); } };
function makeToken(data = {}) {
  const base = { _id: foundry.utils.randomID(), name: "Asteroid", actorId: actor.id, actorLink: true, x: 300, y: 200, width: 4, height: 4, rotation: 0, hidden: false, alpha: 1, flags: {}, texture: { src: actor.prototypeToken?.texture.src, scaleX: 1, scaleY: 1 }, ...data };
  const doc = { ...structuredClone(base), documentName: "Token", parent: scene, actor, get id() { return this._id; }, getFlag(m, k) { return get(this.flags[m], k); }, async update(values) { for (const [k, v] of Object.entries(values)) apply(this, k, v); }, updateSource(values) { for (const [k, v] of Object.entries(values)) apply(this, k, v); }, toObject() { const value = {}; for (const k of Object.keys(base)) value[k] = structuredClone(this[k]); return value; } };
  scene.tokens.set(doc.id, doc); return doc;
}
const gm1 = { id: "gm1", isGM: true, active: true }, gm2 = { id: "gm2", isGM: true, active: true };
const users = new Collection([[gm1.id, gm1], [gm2.id, gm2]]); users.activeGM = gm1;
const socketListeners = [];
window.game = { world: { id: "test" }, user: gm1, users, scenes: new Collection([[scene.id, scene]]), actors: new Collection([[actor.id, actor]]),
  socket: { on(_channel, fn) { socketListeners.push(fn); }, emit(_channel, msg) {
    // Simulate one elected GM and socket round-trip from a second client.
    if (msg.action === "destructibleRequest") queueMicrotask(async () => { game.user = gm1; await Promise.all(socketListeners.map(fn => fn(msg))); });
    if (msg.action === "destructibleReply") queueMicrotask(async () => { game.user = gm2; await Promise.all(socketListeners.map(fn => fn(msg))); });
  } }, sta2eToolkit: { CombatHUD: {} }, settings: { get: () => false }, messages: new Collection() };
window.canvas = { ready: false, scene, grid: scene.grid, tokens: { get: id => { const doc = scene.tokens.get(id); return doc ? { id: doc.id, actor: doc.actor, document: doc, name: doc.name } : undefined; }, controlled: [] } };
registerDestructibleObjects(); registerDestructibleCombat();
for (const fn of hooks.get("ready") || []) fn();
const operation = (doc, damage, key, extra = {}) => requestObjectOperation({ sceneId: scene.id, tokenId: doc.id, operationId: key, rawDamage: damage, ...extra });
const create = (config = {}, tokenData = {}) => {
  const doc = makeToken(tokenData), c = normalizeDestructible({ enabled: true, source: actor.prototypeToken.texture.src, ...config });
  doc.flags[scope] = { destructible: { version: 1, config: c, current: c.integrity, maximum: c.integrity, rootId: doc.id, source: c.source, geometry: structuredClone(UNIT_POLYGON), frame: { x: 0, y: 0, w: 1, h: 1 }, generation: 0, ancestry: [] } }; return doc;
};
try {
  const image = generateObjectArt({ seed: "test-rock" });
  actor.prototypeToken = { width: 4, height: 4, texture: { src: image.toDataURL() } };
  actor.flags[scope] = { destructible: normalizeDestructible({ enabled: true, source: actor.prototypeToken.texture.src }) };
  await test("Generated presets are deterministic and have transparent silhouettes", async () => {
    for (const preset of ["asteroid", "rock", "wall"]) {
      const a = generateObjectArt({ preset, seed: "preview-5" }), b = generateObjectArt({ preset, seed: "preview-5" });
      assert(a.toDataURL() === b.toDataURL(), "determinism");
      const area = measureRegion(a, UNIT_POLYGON).area; assert(area > 1000 && area < 512 * 512, "silhouette");
      const figure = document.createElement("figure"), caption = document.createElement("figcaption"); caption.textContent = preset; figure.append(a, caption); document.querySelector("#gallery").append(figure);
    }
  });
  await test("Actual image regions survive recursive fractures", async () => {
    const pieces = fracturePolygon(UNIT_POLYGON, { seed: "cuts", kind: "beam", count: 3 });
    const composed = document.createElement("canvas"); composed.width = composed.height = 512;
    const context = composed.getContext("2d");
    for (const p of pieces) { const cut = cutRegion(image, p); context.drawImage(cut.canvas, cut.frame.x * 512, cut.frame.y * 512); }
    const source = image.getContext("2d").getImageData(0, 0, 512, 512).data, rebuilt = context.getImageData(0, 0, 512, 512).data;
    let mismatch = 0; for (let i = 0; i < source.length; i++) if (Math.abs(source[i] - rebuilt[i]) > 6) mismatch++;
    assert(mismatch / source.length < .01, `reconstruction mismatch ${mismatch}`);
  });
  await test("Independent Integrity, Resistance, Piercing, stun, and duplicate applications", async () => {
    const a = create({ resistance: 3 }), b = create();
    await operation(a, 2, "blocked"); assert(getDestructibleState(a).current === 10, "blocked hit");
    await operation(a, 5, "damage"); assert(getDestructibleState(a).current === 8, "resistance once");
    await operation(a, 5, "damage"); assert(getDestructibleState(a).current === 8, "duplicate damage");
    await operation(a, 3, "pierce", { piercing: true }); assert(getDestructibleState(a).current === 5, "piercing");
    await operation(a, 100, "stun", { useStun: true }); assert(getDestructibleState(a).current === 5, "stun");
    assert(getDestructibleState(b).current === 10 && actor.updates === 0, "base actor and sibling untouched");
  });
  await test("Exact destruction creates independently targetable unlinked fragments", async () => {
    const root = create({}, { rotation: 37, texture: { src: actor.prototypeToken.texture.src, scaleX: -1.4, scaleY: .8 } });
    const r = await operation(root, 10, "fracture", { kind: "beam" });
    assert(r.fragments.length === 2 && !scene.tokens.has(root.id), "replacement");
    const children = r.fragments.map(id => scene.tokens.get(id));
    assert(children.every(c => !c.actorLink && c.actorId === actor.id && c.texture.scaleX === -1.4), "unlinked and mirrored");
    assert(children.reduce((s, c) => s + getDestructibleState(c).maximum, 0) === 10, "integrity conservation");
    await operation(children[0], 1, "fragment-hit");
    assert(getDestructibleState(children[1]).current === getDestructibleState(children[1]).maximum, "sibling independent");
    const before = scene.tokens.size; await operation(root, 10, "fracture"); assert(scene.tokens.size === before, "duplicate replacement");
    let stale = false; try { await operation(root, 10, "stale"); } catch { stale = true; } assert(stale, "stale parent rejected");
  });
  await test("Excess damage vaporizes, limits terminate recursion, low Integrity becomes dust", async () => {
    for (const [config, damage, key] of [[{}, 10000, "vapor"], [{ maxDepth: 0 }, 10, "depth"], [{ minSize: 10 }, 10, "size"]]) {
      const r = await operation(create(config), damage, key); assert(r.fragments.length === 0, key);
    }
    const low = await operation(create({ integrity: 1 }), 1, "dust"); assert(low.fragments.length <= 1, "rounding dust");
    const root = create({ maxFragments: 2, blastPieces: 8 }); const r = await operation(root, 10, "cap", { kind: "explosive" }); assert(r.fragments.length <= 2, "cap");
  });
  await test("Upload failure leaves parent and Integrity unchanged", async () => {
    const root = create(); failUpload = true; let failed = false;
    try { await operation(root, 10, "upload-fail"); } catch { failed = true; } finally { failUpload = false; }
    assert(failed && scene.tokens.has(root.id) && getDestructibleState(root).current === 10, "unchanged after upload failure");
    await operation(root, 10, "upload-fail"); assert(!scene.tokens.has(root.id), "retry succeeds");
  });
  await test("Partial document creation recovers without duplicate fragments", async () => {
    const root = create(); partialCreate = true; let failed = false;
    try { await operation(root, 10, "partial"); } catch { failed = true; }
    assert(failed && scene.tokens.has(root.id), "parent retained");
    const prepared = scene.getFlag(scope, "destructibleOperations").partial; assert(prepared.status === "prepared", "recovery journal");
    const r = await operation(root, 10, "partial");
    assert(r.fragments.length === 2 && r.fragments.every(id => scene.tokens.has(id)), "exact replacement IDs");
    assert(!scene.tokens.has(root.id), "old parent removed");
  });
  await test("A second GM routes through the elected authority", async () => {
    const root = create(); game.user = gm2;
    await operation(root, 2, "remote-gm"); assert(getDestructibleState(root).current === 8, "remote damage");
    await operation(root, 2, "remote-gm"); assert(getDestructibleState(root).current === 8, "remote dedupe"); game.user = gm1;
  });
  await test("Token config snapshots remain independent of actor defaults", async () => {
    const root = create(); const originalUpdates = actor.updates;
    await saveDestructibleConfig(root, { ...getDestructibleConfig(root), resistance: 5 });
    assert(actor.updates === originalUpdates && getDestructibleConfig(root).resistance === 5, "token-only save");
    actor.flags[scope].destructible.resistance = 9; assert(getDestructibleConfig(root).resistance === 5, "snapshot");
  });
  await test("Object chat rows and the VFX tab render using real browser DOM", async () => {
    const root = create(), row = objectDamageRow({ tokenId: root.id, name: '<Rock>', rawDamage: 3 }, { id: "beam", name: "Phaser", system: {} });
    assert(row.includes("Integrity 10") && row.includes("&lt;Rock&gt;") && !row.includes("APPLY INJURY"), "object row");
    const editor = { actor, objectToken: root, objectSettings: getDestructibleConfig(root), textureSrc: root.texture.src, render() {} };
    const source = await fetch("../templates/ship-vfx-anchors.hbs").then(r => r.text());
    document.querySelector("#panel").innerHTML = Handlebars.compile(source)({ actorName: root.name, textureSrc: "Generated asteroid", isDestructibleTab: true, destructiblePanel: objectPanelHtml(editor), tabs: [{ id: "destructible", label: "Destructible Object", active: true }] });
    editor.element = document.querySelector("#panel"); wireObjectPanel(editor);
  });
  results.className = "pass"; lines.push(`${lines.length} browser groups passed.`); results.textContent = lines.join("\n");
  await fetch("/test-results", { method: "POST", body: JSON.stringify({ passed: true, results: lines }) });
} catch (error) {
  console.error(error); results.className = "fail"; lines.push(`FAIL ${error.stack}`); results.textContent = lines.join("\n");
  await fetch("/test-results", { method: "POST", body: JSON.stringify({ passed: false, results: lines }) });
}
