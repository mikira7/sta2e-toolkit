/** GM-authoritative destructible token lifecycle. World actors remain reusable templates. */
import { normalizeDestructible, UNIT_POLYGON, fracturePolygon, allocateByArea, objectDamage, imageOffsetToScene, seededRandom } from "./destructible-geometry.js";
import { prepareObjectArt, loadObjectImage, measureRegion, cutRegion, uploadObjectArt } from "./destructible-art.js";
import { playDestructibleVfx } from "./destructible-vfx.js";

export const DESTRUCTIBLE_FLAG = "destructible";
const MODULE = "sta2e-toolkit", SOCKET = `module.${MODULE}`, JOURNAL = "destructibleOperations";
const pending = new Map();
let queue = Promise.resolve(), registered = false;
const id = () => foundry.utils.randomID();
const clone = value => foundry.utils.deepClone(value);
export function objectTokenDocument(value) {
  return value?.documentName === "Token" ? value : value?.document?.documentName === "Token" ? value.document : value?.isToken ? value.token : null;
}
export function getDestructibleConfig(value) {
  const doc = objectTokenDocument(value), actor = doc?.actor ?? value?.actor ?? value;
  const saved = doc?.getFlag?.(MODULE, DESTRUCTIBLE_FLAG);
  return normalizeDestructible(saved?.config ?? actor?.getFlag?.(MODULE, DESTRUCTIBLE_FLAG) ?? {});
}
export function isDestructible(value) { return getDestructibleConfig(value).enabled; }
export function getDestructibleState(value) {
  const doc = objectTokenDocument(value);
  return doc?.getFlag?.(MODULE, DESTRUCTIBLE_FLAG) ?? null;
}
export function destructibleDifficulty(value, fallback = 2) { return isDestructible(value) ? getDestructibleConfig(value).difficulty : fallback; }
export function fractureKind(type = "") {
  if (/torpedo|grenade|explos|blast|missile/i.test(type)) return "explosive";
  return /beam|phaser|disruptor/i.test(type) ? "beam" : "irregular";
}
function authority() {
  return game.users?.activeGM ?? Array.from(game.users ?? []).filter(u => u.active && u.isGM).sort((a, b) => a.id.localeCompare(b.id))[0];
}
function initialState(doc, config) {
  return {
    version: 1, config: clone(config), current: config.integrity, maximum: config.integrity,
    generation: 0, rootId: doc.id, parentId: null, ancestry: [], geometry: clone(UNIT_POLYGON),
    frame: { x: 0, y: 0, w: 1, h: 1 }, source: config.source || doc.texture?.src || "",
  };
}
export async function saveDestructibleConfig(value, settings) {
  if (!game.user?.isGM) throw new Error("Only a GM can configure destructible objects.");
  const config = normalizeDestructible(settings), doc = objectTokenDocument(value), actor = doc?.actor ?? value;
  if (!actor) throw new Error("Choose an actor or a scene token.");
  const previous = getDestructibleState(doc), old = getDestructibleConfig(value);
  const artworkChanged = !old.source || ["artwork", "preset", "seed", "darkColor", "lightColor", "source"].some(k => old[k] !== config[k]);
  const proto = doc ?? actor.prototypeToken;
  // Keep the original imported source separate from the padded, immutable saved artwork.
  if (config.enabled && artworkChanged) {
    if (previous?.generation > 0) throw new Error("Fragment artwork is inherited from its parent. Change durability settings here, or create a new object to generate different artwork.");
    const art = await prepareObjectArt(config, config.artwork === "existing" ? (config.source || proto?.texture?.src || actor.img) : null, proto.width / proto.height);
    config.source = await uploadObjectArt(art, `object-${id()}`);
  }
  if (doc) {
    const state = previous ? clone(previous) : initialState(doc, config);
    state.config = config;
    // Preserve damage when maximum Integrity changes; editing never silently repairs an object.
    state.current = Math.max(0, state.current + config.integrity - (old.integrity ?? state.maximum));
    state.maximum = Math.max(1, state.maximum + config.integrity - (old.integrity ?? state.maximum));
    if (artworkChanged && config.enabled) { state.source = config.source; state.geometry = clone(UNIT_POLYGON); state.frame = { x: 0, y: 0, w: 1, h: 1 }; }
    const update = { [`flags.${MODULE}.${DESTRUCTIBLE_FLAG}`]: state };
    if (config.enabled && artworkChanged) update["texture.src"] = config.source;
    await doc.update(update);
  } else {
    const update = { [`flags.${MODULE}.${DESTRUCTIBLE_FLAG}`]: config };
    if (config.enabled) update["prototypeToken.texture.src"] = config.source;
    await actor.update(update);
  }
  return config;
}

/** The operation ID is stable for a chat row, so another GM or a retry uses the same transaction. */
export function requestObjectOperation(request) {
  if (!game.user?.isGM) return Promise.reject(new Error("Only a GM can apply object damage."));
  const gm = authority();
  if (!gm) return Promise.reject(new Error("An active GM is required."));
  const payload = { ...request, operationId: request.operationId || id(), requesterId: game.user.id };
  if (gm.id === game.user.id) return enqueue(payload);
  if (pending.has(payload.operationId)) return pending.get(payload.operationId).promise;
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  const timer = setTimeout(() => { pending.delete(payload.operationId); reject(new Error("The active GM has not replied. Retry this action; its operation ID prevents duplicate damage.")); }, 30000);
  pending.set(payload.operationId, { promise, resolve, reject, timer });
  game.socket.emit(SOCKET, { action: "destructibleRequest", payload });
  return promise;
}
function enqueue(payload) {
  const job = queue.catch(() => {}).then(() => applyOperation(payload));
  queue = job; return job;
}
async function persistOperation(scene, key, operation) { await scene.setFlag(MODULE, `${JOURNAL}.${key}`, operation); }
async function finishOperation(scene, key, operation) {
  if (operation.status === "complete") return operation.result;
  if (operation.spendResult && !operation.spendPaid) {
    const { consumeSpendForApply, readPool } = await import("./momentum-spend.js");
    const spend = JSON.parse(decodeURIComponent(operation.spendResult));
    if ((spend.poolUsed || 0) > readPool(spend.source || "momentum")) throw new Error("The Momentum/Threat pool changed. There are insufficient points to finish this object attack.");
    const consumed = await consumeSpendForApply({ dataset: { spendResult: operation.spendResult } });
    if (!consumed) throw new Error("Insufficient Momentum/Threat for this object attack.");
    operation.spendPaid = true;
    await persistOperation(scene, key, operation);
  }
  const parent = scene.tokens.get(operation.tokenId);
  if (operation.kind === "damage") {
    if (parent) await parent.update({ [`flags.${MODULE}.${DESTRUCTIBLE_FLAG}`]: operation.state });
  } else {
    const missing = operation.children.filter(data => !scene.tokens.get(data._id));
    // Explicit IDs make interrupted batch creation safe to resume.
    if (missing.length) await scene.createEmbeddedDocuments("Token", missing, { keepId: true });
    if (scene.tokens.get(operation.tokenId)) await scene.deleteEmbeddedDocuments("Token", [operation.tokenId]);
  }
  operation.status = "complete";
  // Keep a compact receipt forever, allowing even an old chat card to be deduplicated.
  await persistOperation(scene, key, { status: "complete", tokenId: operation.tokenId, result: operation.result });
  if (operation.effect) {
    const msg = { action: "destructibleVfx", sceneId: scene.id, operationId: key, ...operation.effect };
    game.socket.emit(SOCKET, msg);
    void playDestructibleVfx(msg).catch(err => console.warn("STA2e Toolkit | Object VFX:", err));
  }
  return operation.result;
}
async function resolveFragments(image, state, doc, payload, budget) {
  const config = state.config, pieces = [], random = seededRandom(payload.operationId);
  const grid = doc.parent.grid.size || 100;
  const sx = Number(doc.texture.scaleX ?? 1), sy = Number(doc.texture.scaleY ?? 1);
  const sourceWidth = doc.width * grid / state.frame.w, sourceHeight = doc.height * grid / state.frame.h;
  const center = { x: doc.x + doc.width * grid / 2, y: doc.y + doc.height * grid / 2 };
  const firing = payload.attackerTokenId ? doc.parent.tokens.get(payload.attackerTokenId) : null;
  const worldAngle = firing ? Math.atan2(center.y - (firing.y + firing.height * grid / 2), center.x - (firing.x + firing.width * grid / 2)) : 0;
  // Inverse of the rendered image transform, including unequal scale and reflections.
  const localAngle = worldAngle - (doc.rotation || 0) * Math.PI / 180;
  const angle = Math.atan2(Math.sin(localAngle) / (sourceHeight * (sy || 1)), Math.cos(localAngle) / (sourceWidth * (sx || 1)));
  const kind = payload.kind || fractureKind(payload.weaponType);
  async function split(geometry, maximum, excess, generation, path) {
    if (generation >= config.maxDepth || budget - pieces.length < 2) return;
    const count = Math.min(kind === "explosive" ? config.blastPieces : config.beamPieces, budget - pieces.length);
    const polygons = fracturePolygon(geometry, { seed: `${config.seed}:${payload.operationId}:${path}`, kind, count, angle });
    const measured = polygons.map(p => measureRegion(image, p));
    const integrity = allocateByArea(maximum, measured.map(m => m.area));
    const damage = allocateByArea(Math.ceil(excess), measured.map(m => m.area));
    for (let i = 0; i < polygons.length; i++) {
      const m = measured[i], max = integrity[i];
      if (max < 1 || !m.area || Math.min(m.frame.w * sourceWidth * Math.abs(sx), m.frame.h * sourceHeight * Math.abs(sy)) / grid < config.minSize) continue;
      if (damage[i] >= max) { await split(polygons[i], max, damage[i] - max, generation + 1, `${path}-${i}`); continue; }
      if (pieces.length >= budget) continue;
      pieces.push({ geometry: polygons[i], frame: m.frame, maximum: max, current: max - damage[i], generation: generation + 1 });
    }
    // Release the browser between generations when a high-damage hit makes many cuts.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  await split(state.geometry, state.maximum, payload.excess, state.generation, "root");
  const children = [], visuals = [];
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i], crop = cutRegion(image, piece.geometry, piece.frame);
    piece.frame = crop.frame;
    const src = await uploadObjectArt(crop.canvas, `fragment-${payload.operationId}-${i}`);
    const w = piece.frame.w * sourceWidth / grid, h = piece.frame.h * sourceHeight / grid;
    const offset = imageOffsetToScene(piece.frame.x + piece.frame.w / 2 - state.frame.x - state.frame.w / 2, piece.frame.y + piece.frame.h / 2 - state.frame.y - state.frame.h / 2, sourceWidth, sourceHeight, doc.rotation, sx, sy);
    const distance = Math.hypot(offset.x, offset.y) || 1;
    const separation = config.separation * grid * (config.preset === "asteroid" ? 1 : .4);
    const dx = (offset.x / distance || Math.cos(i * 2.4)) * separation, dy = (offset.y / distance || Math.sin(i * 2.4)) * separation;
    const rotation = (doc.rotation || 0) + (random() - .5) * (config.preset === "asteroid" ? 14 : 5);
    const data = doc.toObject();
    const childId = id();
    // A fragment is passive terrain. Do not clone combat effects, emitters, vision, or actor deltas.
    data._id = childId; data.actorLink = false; delete data.delta; delete data.actorData;
    data.name = `${doc.name} · ${i + 1}`; data.width = w; data.height = h;
    data.x = center.x + offset.x + dx - w * grid / 2; data.y = center.y + offset.y + dy - h * grid / 2;
    data.rotation = rotation; data.texture = { ...data.texture, src, fit: "contain", anchorX: .5, anchorY: .5 };
    data.sight = { ...data.sight, enabled: false }; data.light = { ...data.light, dim: 0, bright: 0 };
    data.bar1 = { attribute: null }; data.bar2 = { attribute: null };
    data.ring = { ...data.ring, enabled: false }; data.disposition = 0;
    data.flags = { [MODULE]: { [DESTRUCTIBLE_FLAG]: {
      version: 1, config: clone(config), source: state.source, ...piece,
      rootId: state.rootId, parentId: doc.id, ancestry: [...state.ancestry, doc.id], operationId: payload.operationId,
    } } };
    children.push(data);
    visuals.push({ tokenId: childId, src, width: w * grid, height: h * grid, scaleX: sx, scaleY: sy,
      x: center.x + offset.x + dx, y: center.y + offset.y + dy, dx, dy, rotation, startRotation: doc.rotation || 0, alpha: doc.hidden ? .45 : doc.alpha ?? 1, hidden: doc.hidden });
  }
  return { children, visuals, center };
}
async function applyOperation(payload) {
  if (authority()?.id !== game.user.id) throw new Error("The active GM changed. Retry the action.");
  if (!game.users.get(payload.requesterId)?.isGM) throw new Error("Object mutations require a GM.");
  const scene = game.scenes.get(payload.sceneId);
  if (!scene || !/^[a-zA-Z0-9_-]{1,180}$/.test(payload.operationId)) throw new Error("Invalid object operation.");
  const previous = scene.getFlag(MODULE, JOURNAL)?.[payload.operationId];
  if (previous) return { ...await finishOperation(scene, payload.operationId, clone(previous)), replayed: previous.status === "complete" };
  // Finish older pending work first; a stale parent must never start another fracture tree.
  for (const [key, op] of Object.entries(scene.getFlag(MODULE, JOURNAL) ?? {})) {
    if (op.status !== "complete") await finishOperation(scene, key, clone(op));
  }
  const doc = scene.tokens.get(payload.tokenId);
  if (!doc || !isDestructible(doc)) throw new Error("That destructible token no longer exists. Select a surviving fragment.");
  const config = getDestructibleConfig(doc), state = clone(getDestructibleState(doc) ?? initialState(doc, config));
  const amount = payload.mode === "split" ? state.current : payload.mode === "destroy" ? state.current : objectDamage({ ...payload, resistance: config.resistance });
  const before = state.current;
  state.current = Math.max(0, before - amount);
  const result = { before, after: state.current, damage: amount, fragments: [], destroyed: false };
  let operation;
  if (amount <= 0 || state.current > 0) {
    operation = { status: "prepared", kind: "damage", tokenId: doc.id, state, result };
  } else {
    let resolved = { children: [], visuals: [], center: { x: doc.x + doc.width * scene.grid.size / 2, y: doc.y + doc.height * scene.grid.size / 2 } };
    if (payload.mode !== "destroy") {
      const image = await loadObjectImage(state.source || doc.texture.src);
      const active = Array.from(scene.tokens).filter(t => t.id !== doc.id && getDestructibleState(t)?.rootId === state.rootId).length;
      resolved = await resolveFragments(image, state, doc, { ...payload, excess: Math.max(0, amount - before) }, Math.max(0, config.maxFragments - active));
    }
    result.fragments = resolved.children.map(c => c._id); result.destroyed = true;
    operation = { status: "prepared", kind: "replace", tokenId: doc.id, children: resolved.children, result,
      effect: config.animation ? { center: resolved.center, fragments: resolved.visuals, duration: config.duration, preset: config.preset, hidden: doc.hidden, color: config.lightColor } : null };
  }
  // No damage or token replacement is committed until every required texture exists.
  if (payload.spendResult) operation.spendResult = payload.spendResult;
  await persistOperation(scene, payload.operationId, operation);
  if (amount > 0 && payload.weaponType && canvas?.scene?.id === scene.id) {
    const hud = game.sta2eToolkit?.CombatHUD;
    try {
      const animation = { ...payload, finalDamage: amount, hullImpact: { shieldsDown: true, finalDamage: amount } };
      if (payload.ground) await hud?._playGroundAttackAnimation?.(animation);
      else await hud?._playShipAttackAnimation?.(animation);
    } catch (err) { console.warn("STA2e Toolkit | Object weapon animation:", err); }
  }
  return finishOperation(scene, payload.operationId, operation);
}

export function registerDestructibleObjects() {
  if (registered) return; registered = true;
  Hooks.on("preCreateToken", (doc, data) => {
    if (data.flags?.[MODULE]?.[DESTRUCTIBLE_FLAG]) return;
    const config = getDestructibleConfig(doc);
    if (!config.enabled) return;
    const state = initialState(doc, config); state.rootId = doc.id || data._id || id();
    doc.updateSource({ [`flags.${MODULE}.${DESTRUCTIBLE_FLAG}`]: state, actorLink: false,
      "sight.enabled": false, "light.dim": 0, "light.bright": 0, "ring.enabled": false,
      "bar1.attribute": null, "bar2.attribute": null, disposition: 0,
      ...(config.source ? { "texture.src": config.source } : {}) });
  });
  const recover = () => {
    if (authority()?.id !== game.user.id) return;
    const work = async () => {
      for (const scene of game.scenes) for (const [key, op] of Object.entries(scene.getFlag(MODULE, JOURNAL) ?? {})) {
        if (op.status !== "complete") await finishOperation(scene, key, clone(op));
      }
    };
    queue = queue.catch(() => {}).then(work).catch(err => { console.error("STA2e Toolkit | Destructible recovery:", err); ui.notifications.error("A destructible replacement needs recovery. Retry its damage action after correcting the reported error."); });
  };
  Hooks.on("canvasReady", recover); Hooks.on("userConnected", recover);
  Hooks.once("ready", () => {
    game.socket.on(SOCKET, async msg => {
      if (msg.action === "destructibleVfx") { void playDestructibleVfx(msg).catch(console.warn); return; }
      if (msg.action === "destructibleReply" && msg.requesterId === game.user.id) {
        const entry = pending.get(msg.operationId); if (!entry) return;
        clearTimeout(entry.timer); pending.delete(msg.operationId);
        if (msg.error) entry.reject(new Error(msg.error)); else entry.resolve(msg.result);
      }
      if (msg.action === "destructibleRequest" && authority()?.id === game.user.id) {
        const p = msg.payload ?? {}; let result, error;
        try { result = await enqueue(p); } catch (err) { error = err.message; }
        game.socket.emit(SOCKET, { action: "destructibleReply", operationId: p.operationId, requesterId: p.requesterId, result, error });
      }
    });
    recover();
  });
}
